/**
 * Captura del historial de stock en segundo plano, sin que nadie tenga la aplicación abierta.
 *
 * Se ejecuta en GitHub Actions (`.github/workflows/historial-en-segundo-plano.yml`) y hace
 * lo mismo que la aplicación cuando alguien abre Consulta Stock:
 *
 *   1. lee las UNGET configuradas con su hoja de cálculo (`unget_configs.spreadsheet_id`);
 *   2. pide a Google Sheets API la lista de pestañas y su última actualización;
 *   3. descarga por CSV solo las hojas que cambiaron desde el último registro;
 *   4. guarda en `stock_sync_history` únicamente los medicamentos que subieron o bajaron.
 *
 * Las reglas se comparten con la aplicación (`services/stockSyncHistory.ts` y
 * `services/stockRowNormalizer.ts`): si este proceso agrupara el stock de otra forma, cada
 * ejecución compararía contra una foto distinta y el historial mostraría movimientos falsos.
 *
 * Las fechas de las hojas vienen en hora de Perú, así que el proceso debe correr con
 * `TZ=America/Lima`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  a1Range,
  batchGetRanges,
  facilityCodeFromSheetName,
  listSheetTabs,
} from "../services/sheetsApiService";
import { fetchSheetRowsDirect, readHeadMetadata } from "../services/sheetsDirectService";
import { normalizeSheetRows } from "../services/stockRowNormalizer";
import {
  buildStockSnapshot,
  buildStockSyncMetadataAttempts,
  computeStockHash,
  computeStockTotals,
  decideStockSyncAction,
  getSyncDateCutoffIso,
  parseSheetDateTime,
  pickLatestSyncs,
  resolveSyncDateIso,
  type StockMovement,
  type StockSnapshot,
} from "../services/stockSyncHistory";

/**
 * Falta algo por configurar (un secreto, un usuario). No es un fallo del proceso: se avisa
 * y se termina bien, para no llenar de correos de error mientras se termina de configurar.
 */
export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

/** Autor que aparece en el historial cuando el registro lo hizo este proceso. */
export const BACKGROUND_SYNC_AUTHOR = "Captura automática";
/** Hojas leídas a la vez. El CSV no consume cuota, pero conviene no dispararlas todas. */
const SHEET_CONCURRENCY = 4;
/** Tope por consulta; coincide con el máximo por defecto de PostgREST en Supabase. */
const LATEST_SYNCS_LIMIT = 1000;
/** Margen para no releer una hoja por diferencias de segundos al guardar la fecha. */
export const SHEET_CHANGE_TOLERANCE_MS = 60 * 1000;

export interface JobSheet {
  spreadsheetId: string;
  gid: string;
  title: string;
  /** Clave del historial: la misma que usa la aplicación (código de IPRESS o gid). */
  establishmentId: string;
  /** Última actualización tal como la muestra la hoja (DD/MM/YYYY HH:mm:ss). */
  lastUpdate: string;
}

/**
 * Una hoja se descarga solo si pudo cambiar desde el último registro guardado. Sin registro
 * previo, o sin fecha legible, se lee: no hay forma de descartarla.
 */
export const shouldReadSheet = (
  sheet: Pick<JobSheet, "lastUpdate">,
  latest?: { sync_date?: string } | null,
): boolean => {
  if (!latest?.sync_date) return true;
  const sheetMs = parseSheetDateTime(sheet.lastUpdate);
  if (!sheetMs) return true;
  const recordMs = Date.parse(latest.sync_date);
  if (!Number.isFinite(recordMs)) return true;
  return sheetMs > recordMs + SHEET_CHANGE_TOLERANCE_MS;
};

/** Ejecuta las tareas con un tope de tareas simultáneas, conservando el orden del resultado. */
export const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> => {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
};

/** Libros de cálculo a revisar, sin repetir los que comparten varias conexiones UNGET. */
export const groupBooksBySpreadsheet = (
  configs: Array<{ unget_name?: string | null; spreadsheet_id?: string | null }>,
): Array<{ spreadsheetId: string; names: string[] }> => {
  const books = new Map<string, Set<string>>();
  for (const config of configs) {
    const spreadsheetId = String(config?.spreadsheet_id || "").trim();
    if (!spreadsheetId) continue;
    const names = books.get(spreadsheetId) || new Set<string>();
    names.add(String(config?.unget_name || "UNGET").trim());
    books.set(spreadsheetId, names);
  }
  return Array.from(books.entries()).map(([spreadsheetId, names]) => ({
    spreadsheetId,
    names: Array.from(names),
  }));
};

const env = (name: string): string => String(process.env[name] || "").trim();

const log = (...parts: unknown[]) => console.log(...parts);

/**
 * Cliente de Supabase para un proceso sin navegador.
 *
 * Camino recomendado: un usuario dedicado de la aplicación; `app_login` devuelve el token
 * que leen las políticas RLS, así que el proceso solo puede hacer lo que ese usuario puede.
 * Si en cambio se configura la clave `service_role`, se usa esa, que salta RLS.
 */
export const connectToSupabase = async (): Promise<{
  client: SupabaseClient;
  close: () => Promise<void>;
}> => {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
  if (!url) throw new MissingConfigError("Falta SUPABASE_URL.");

  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey) {
    log("Supabase: clave de servicio.");
    return {
      client: createClient(url, serviceRoleKey, { auth: { persistSession: false } }),
      close: async () => {},
    };
  }

  const anonKey = env("SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY");
  const username = env("SYNC_USERNAME");
  const password = env("SYNC_PASSWORD");
  if (!anonKey || !username || !password) {
    throw new MissingConfigError(
      "Faltan credenciales: configure SUPABASE_SERVICE_ROLE_KEY, o SUPABASE_ANON_KEY con SYNC_USERNAME y SYNC_PASSWORD.",
    );
  }

  const loginClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await loginClient.rpc("app_login", {
    p_username: username,
    p_password: password,
  });
  if (error) throw new Error(`No se pudo iniciar sesión: ${error.message}`);
  if (!data) throw new Error(`Usuario o contraseña incorrectos para ${username}.`);

  const token = String(data);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: {
      // Las políticas RLS leen el token de esta cabecera, igual que en el navegador.
      fetch: ((input: any, init: any = {}) => {
        const headers = new Headers(init?.headers);
        headers.set("x-session-token", token);
        return fetch(input, { ...init, headers });
      }) as typeof fetch,
    },
  });
  log(`Supabase: sesión iniciada como ${username}.`);
  return {
    client,
    close: async () => {
      try {
        await loginClient.rpc("app_logout", { p_token: token });
      } catch {
        // Si falla, el token caduca solo a las 12 horas.
      }
    },
  };
};

/**
 * Último registro por establecimiento, ignorando los que tienen fecha futura.
 *
 * Una sola consulta para todas las IPRESS del libro. PostgREST devuelve como mucho 1000
 * filas, así que si el lote llega a ese tope se vuelve a preguntar por los que faltan: una
 * IPRESS con muchos movimientos podría llenar el lote y ocultar a las demás.
 */
const fetchLatestSyncs = async (
  client: SupabaseClient,
  establishmentIds: string[],
): Promise<Record<string, { establishment_id: string; sync_date: string }>> => {
  const latest: Record<string, { establishment_id: string; sync_date: string }> = {};
  if (establishmentIds.length === 0) return latest;
  const cutoff = getSyncDateCutoffIso();

  const { data, error } = await client
    .from("stock_sync_history")
    .select("establishment_id,sync_date")
    .in("establishment_id", establishmentIds)
    .lte("sync_date", cutoff)
    .order("sync_date", { ascending: false })
    .limit(LATEST_SYNCS_LIMIT);
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);

  const rows = (data || []) as Array<{ establishment_id: string; sync_date: string }>;
  Object.assign(latest, pickLatestSyncs(rows));
  if (rows.length < LATEST_SYNCS_LIMIT) return latest;

  for (const id of establishmentIds.filter((id) => !latest[id])) {
    const { data: one, error: oneError } = await client
      .from("stock_sync_history")
      .select("establishment_id,sync_date")
      .eq("establishment_id", id)
      .lte("sync_date", cutoff)
      .order("sync_date", { ascending: false })
      .limit(1);
    if (oneError) throw new Error(`No se pudo leer el historial de ${id}: ${oneError.message}`);
    const row = (one || [])[0] as { establishment_id: string; sync_date: string } | undefined;
    if (row) latest[id] = row;
  }
  return latest;
};

/** Pestañas del libro con su última actualización, en dos peticiones a la API. */
const readBookSheets = async (spreadsheetId: string, apiKey: string): Promise<JobSheet[]> => {
  const tabs = await listSheetTabs(spreadsheetId, { apiKey, force: true });
  if (tabs.length === 0) return [];

  const heads = await batchGetRanges(
    spreadsheetId,
    tabs.map((tab) => a1Range(tab.title, "A1:AZ2")),
    { apiKey },
  );

  return tabs.map((tab, index) => {
    const head = readHeadMetadata(heads[index] || []);
    return {
      spreadsheetId,
      gid: tab.gid,
      title: tab.title,
      establishmentId: facilityCodeFromSheetName(tab.title, head.almcod) || tab.gid,
      lastUpdate: head.lastUpdate,
    };
  });
};

export interface SheetResult {
  establishmentId: string;
  title: string;
  action: "insert" | "baseline" | "skip" | "empty" | "error";
  movements?: number;
  message?: string;
}

/** Inserta el registro recortando el detalle si no entra, igual que `registerSync`. */
const insertHistoryRecord = async (
  client: SupabaseClient,
  input: {
    establishmentId: string;
    establishmentName: string;
    syncDate: string;
    recordCount: number;
    stockHash: string;
    movements: StockMovement[];
    snapshot: StockSnapshot;
    totals: { totalStock: number; totalValue: number };
  },
): Promise<void> => {
  const payload = {
    establishment_id: input.establishmentId,
    establishment_name: input.establishmentName,
    sync_date: input.syncDate,
    record_count: input.recordCount,
    stock_hash: input.stockHash,
    has_changes: input.movements.length > 0,
    changed_items_count: input.movements.length,
    sync_author: BACKGROUND_SYNC_AUTHOR,
  };

  const attempts = buildStockSyncMetadataAttempts({
    snapshot: input.snapshot,
    movements: input.movements,
    totalStock: input.totals.totalStock,
    totalValue: input.totals.totalValue,
  });

  let lastError: any = null;
  for (const changesMetadata of attempts) {
    const { error } = await client
      .from("stock_sync_history")
      .insert([{ ...payload, changes_metadata: changesMetadata }]);
    if (!error) return;
    lastError = error;
  }
  throw new Error(lastError?.message || "No se pudo guardar el registro.");
};

/**
 * Quita la foto de stock del registro anterior una vez que hay uno más nuevo.
 *
 * `items_snapshot` pesa unos 44 KB por IPRESS y solo sirve para comparar con la lectura
 * siguiente: guardarlo en cada registro llenaría la base en pocas semanas. Los movimientos
 * y los totales, que son lo que muestra el historial, se conservan intactos.
 */
const prunePreviousSnapshot = async (
  client: SupabaseClient,
  previous: any,
  newSyncDate: string,
): Promise<void> => {
  if (!previous?.id || !previous.changes_metadata) return;
  // Si el registro nuevo quedó con fecha anterior, el viejo sigue siendo el de referencia.
  if (Date.parse(previous.sync_date) >= Date.parse(newSyncDate)) return;
  try {
    const parsed = JSON.parse(previous.changes_metadata);
    if (!parsed || typeof parsed !== "object" || !parsed.items_snapshot) return;
    delete parsed.items_snapshot;
    parsed.snapshot_pruned = true;
    const { error } = await client
      .from("stock_sync_history")
      .update({ changes_metadata: JSON.stringify(parsed) })
      .eq("id", previous.id);
    if (error) log(`  aviso: no se pudo aligerar el registro anterior (${error.message}).`);
  } catch {
    // Un detalle ilegible se deja como está.
  }
};

/** Descarga una hoja y guarda su registro si hubo movimientos. */
const processSheet = async (
  client: SupabaseClient,
  sheet: JobSheet,
  dryRun: boolean,
): Promise<SheetResult> => {
  const base = { establishmentId: sheet.establishmentId, title: sheet.title };
  try {
    const rawRows = await fetchSheetRowsDirect(sheet.spreadsheetId, sheet.gid);
    const { rows: items, lastUpdate } = normalizeSheetRows(rawRows, sheet.gid);
    if (items.length === 0) return { ...base, action: "empty" };

    const { data: previousRows, error: previousError } = await client
      .from("stock_sync_history")
      .select("*")
      .eq("establishment_id", sheet.establishmentId)
      .lte("sync_date", getSyncDateCutoffIso())
      .order("sync_date", { ascending: false })
      .limit(1);
    if (previousError) throw new Error(previousError.message);

    const previous = (previousRows || [])[0];
    const snapshot = buildStockSnapshot(items);
    const stockHash = computeStockHash(items);
    const decision = decideStockSyncAction({ previous, snapshot, stockHash });
    if (decision.action === "skip") return { ...base, action: "skip" };
    if (dryRun) return { ...base, action: decision.action, movements: decision.movements.length };

    const sheetDate = parseSheetDateTime(lastUpdate || sheet.lastUpdate);
    const syncDate = resolveSyncDateIso(sheetDate ? new Date(sheetDate).toISOString() : undefined);
    await insertHistoryRecord(client, {
      establishmentId: sheet.establishmentId,
      establishmentName: sheet.title,
      syncDate,
      recordCount: items.length,
      stockHash,
      movements: decision.movements,
      snapshot,
      totals: computeStockTotals(items, snapshot),
    });
    await prunePreviousSnapshot(client, previous, syncDate);
    return { ...base, action: decision.action, movements: decision.movements.length };
  } catch (err: any) {
    return { ...base, action: "error", message: err?.message || String(err) };
  }
};

export const main = async (): Promise<void> => {
  const startedAt = Date.now();
  const apiKey = env("GOOGLE_SHEETS_API_KEY") || env("VITE_GOOGLE_SHEETS_API_KEY");
  if (!apiKey) {
    throw new MissingConfigError(
      "Falta GOOGLE_SHEETS_API_KEY: una clave de Google Sheets API sin restricción de sitio web.",
    );
  }
  const dryRun = env("DRY_RUN") === "1";
  if (dryRun) log("Modo prueba: no se guardará nada en Supabase.");

  const { client, close } = await connectToSupabase();
  try {
    const { data: configs, error } = await client
      .from("unget_configs")
      .select("unget_name,url,spreadsheet_id");
    if (error) throw new Error(`No se pudieron leer las UNGET: ${error.message}`);

    const books = groupBooksBySpreadsheet(configs || []);
    const sinHoja = (configs || []).filter((c: any) => !String(c?.spreadsheet_id || "").trim());
    log(
      `UNGET configuradas: ${(configs || []).length}. Libros a revisar: ${books.length}. ` +
        `Sin hoja de cálculo configurada: ${sinHoja.length}` +
        (sinHoja.length ? ` (${sinHoja.map((c: any) => c.unget_name).join(", ")})` : ""),
    );

    const totals = { leidas: 0, movimientos: 0, referencias: 0, sinCambios: 0, errores: 0 };

    for (const book of books) {
      const etiqueta = book.names.join(" / ");
      let sheets: JobSheet[] = [];
      try {
        sheets = await readBookSheets(book.spreadsheetId, apiKey);
      } catch (err: any) {
        totals.errores += 1;
        log(`[${etiqueta}] no se pudo leer el libro: ${err?.message || err}`);
        continue;
      }

      const latest = await fetchLatestSyncs(
        client,
        Array.from(new Set(sheets.map((sheet) => sheet.establishmentId))),
      );
      const pending = sheets.filter((sheet) => shouldReadSheet(sheet, latest[sheet.establishmentId]));
      log(
        `[${etiqueta}] ${sheets.length} hojas, ${pending.length} con cambios desde el último registro.`,
      );

      const results = await runWithConcurrency(
        pending.map((sheet) => () => processSheet(client, sheet, dryRun)),
        SHEET_CONCURRENCY,
      );

      totals.leidas += results.length;
      for (const result of results) {
        if (result.action === "insert") {
          totals.movimientos += 1;
          log(`  ${result.title}: ${result.movements} medicamento(s) con variación.`);
        } else if (result.action === "baseline") {
          totals.referencias += 1;
          log(`  ${result.title}: referencia inicial guardada.`);
        } else if (result.action === "error") {
          totals.errores += 1;
          log(`  ${result.title}: error -> ${result.message}`);
        } else {
          totals.sinCambios += 1;
        }
      }
    }

    log(
      `Resumen: ${totals.leidas} hojas leídas, ${totals.movimientos} con movimientos, ` +
        `${totals.referencias} referencias iniciales, ${totals.sinCambios} sin cambios, ` +
        `${totals.errores} con error, en ${((Date.now() - startedAt) / 1000).toFixed(1)} s.`,
    );
  } finally {
    await close();
  }
};

/** Solo se ejecuta al invocarlo directamente; las pruebas importan las funciones sueltas. */
const runningAsScript = process.argv[1]
  ? process.argv[1].replace(/\\/g, "/").endsWith("scripts/backgroundStockSync.ts")
  : false;
if (runningAsScript) {
  main().catch((err) => {
    if (err instanceof MissingConfigError) {
      // Todavía sin configurar: se avisa sin marcar la ejecución como fallida.
      log(err.message, "La captura no se ejecutó; ver docs/CAPTURA_HISTORIAL_SEGUNDO_PLANO.md.");
      return;
    }
    console.error("La captura en segundo plano falló:", err?.message || err);
    process.exit(1);
  });
}
