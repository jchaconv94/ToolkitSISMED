import { createClient } from "@supabase/supabase-js";
import {
  STOCK_SNAPSHOT_VERSION,
  STOCK_SYNC_LIGHT_COLUMNS,
  buildStockSnapshot,
  diffStockSnapshots,
  parseSheetNumber,
  readStockSnapshot,
  type StockMovement,
  findGroupsWithoutSync,
  getSyncDateCutoffIso,
  pickLatestSyncs,
  resolveSyncDateIso,
} from "./stockSyncHistory";

// Supabase Connection Configuration
// If environment variables are not yet provided, we will fail gracefully and allow offline or mock checks
// @ts-ignore
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
// @ts-ignore
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** Clave donde vive el token de sesión emitido por `app_login`. */
export const SESSION_TOKEN_KEY = "aura_session_token";

/**
 * Adjunta el token de sesión a todas las peticiones.
 *
 * Las políticas RLS lo leen desde la cabecera `x-session-token` para distinguir a un
 * usuario con sesión iniciada de un visitante cualquiera de internet. Sin esto, la clave
 * `anon` —que viaja en el bundle publicado— bastaría para leer y escribir los datos.
 *
 * Se hace con un `fetch` propio y no con `global.headers` porque el token cambia al
 * iniciar y cerrar sesión, y las cabeceras fijas se congelan al crear el cliente.
 */
const fetchWithSessionToken: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  try {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (token) headers.set("x-session-token", token);
  } catch {
    // Sin sessionStorage la petición sale sin token y las políticas la rechazarán.
  }
  return fetch(input, { ...init, headers });
};

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fetchWithSessionToken } })
    : null;

/**
 * Programmatically computes a quick, non-cryptographic checksum/hash representing
 * the exact items and quantities in a stock list.
 * Any change in stock, products, batches, or expiration dates will yield a different hash value.
 */
export const computeStockHash = (products: any[]): string => {
  // Agrupar por las mismas claves que usamos en el diff (codigo, lote, tipsum, ffinan)
  // para que si hay filas duplicadas se sumen, y no dependa del orden
  const grouped: Record<string, number> = {};
  
  for (const item of products) {
    if (!item) continue;
    const id = String(item.ID_Producto || item.medcod || item.Codigo_Sismed || item.CODIGO_SIG || item.Nombre || "UNKNOWN").trim();
    const lot = String(item.Lote || "N/A").trim();
    const tipsum = String(item.TIPSUM || "N/A").trim();
    const ffinan = String(item.FFINAN || "N/A").trim();
    
    const qty =
      Number(
        item.Saldo !== undefined
          ? item.Saldo
          : item.Saldo_Fisico || item.Stock || 0,
      ) || 0;
      
    const key = `${id}|${lot}|${tipsum}|${ffinan}`;
    grouped[key] = (grouped[key] || 0) + qty;
  }

  // Ordenar las claves para asegurar un hash determinista
  const sortedKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  
  let stateStr = "";
  for (const key of sortedKeys) {
    stateStr += `${key}:${grouped[key]}|`;
  }

  // DJB2 simple hashing algorithm
  let hash = 5381;
  for (let i = 0; i < stateStr.length; i++) {
    hash = (hash * 33) ^ stateStr.charCodeAt(i);
  }
  return `v1:${(hash >>> 0).toString(36)}`;
};

/**
 * Compares two stock lists to find exactly which items changed and by how much
 */
export interface StockDifference {
  id: string;
  name: string;
  previousQty: number;
  currentQty: number;
  change: number;
  type: "added" | "removed" | "modified";
}

export const compareStockLists = (
  prevList: any[],
  currList: any[],
): StockDifference[] => {
  const prevMap = new Map<string, any>();
  prevList.forEach((item) => {
    const key = `${item.ID_Producto || item.Nombre || ""}:${item.Lote || ""}`;
    prevMap.set(key, item);
  });

  const currMap = new Map<string, any>();
  currList.forEach((item) => {
    const key = `${item.ID_Producto || item.Nombre || ""}:${item.Lote || ""}`;
    currMap.set(key, item);
  });

  const differences: StockDifference[] = [];

  // Find modifications and additions
  currList.forEach((currItem) => {
    const key = `${currItem.ID_Producto || currItem.Nombre || ""}:${currItem.Lote || ""}`;
    const currQty = Number(
      currItem.Saldo !== undefined
        ? currItem.Saldo
        : currItem.Saldo_Fisico || currItem.Stock || 0,
    );
    const name =
      currItem.Nombre || currItem.Descripcion || "Producto Desconocido";
    const id = currItem.ID_Producto || currItem.Nombre || "";

    if (!prevMap.has(key)) {
      differences.push({
        id,
        name,
        previousQty: 0,
        currentQty: currQty,
        change: currQty,
        type: "added",
      });
    } else {
      const prevItem = prevMap.get(key);
      const prevQty = Number(
        prevItem.Saldo !== undefined
          ? prevItem.Saldo
          : prevItem.Saldo_Fisico || prevItem.Stock || 0,
      );
      if (prevQty !== currQty) {
        differences.push({
          id,
          name,
          previousQty: prevQty,
          currentQty: currQty,
          change: currQty - prevQty,
          type: "modified",
        });
      }
    }
  });

  // Find removals
  prevList.forEach((prevItem) => {
    const key = `${prevItem.ID_Producto || prevItem.Nombre || ""}:${prevItem.Lote || ""}`;
    if (!currMap.has(key)) {
      const prevQty = Number(
        prevItem.Saldo !== undefined
          ? prevItem.Saldo
          : prevItem.Saldo_Fisico || prevItem.Stock || 0,
      );
      const name =
        prevItem.Nombre || prevItem.Descripcion || "Producto Desconocido";
      const id = prevItem.ID_Producto || prevItem.Nombre || "";
      differences.push({
        id,
        name,
        previousQty: prevQty,
        currentQty: 0,
        change: -prevQty,
        type: "removed",
      });
    }
  });

  return differences;
};

// Interface definition matching database table row
export interface StockSyncRecord {
  id?: string;
  establishment_id: string;
  establishment_name: string;
  sync_date: string;
  record_count: number;
  stock_hash: string;
  has_changes: boolean;
  changed_items_count: number;
  sync_author: string;
  created_at?: string;
  changes_metadata?: string; // Stored as JSON string list of differences
  last_modification_date?: string; // Added to track when the last modification happened
}

/** Tope explícito por consulta; coincide con el máximo por defecto de PostgREST en Supabase. */
const LATEST_SYNCS_BULK_LIMIT = 1000;
/** IDs por consulta `in.(...)`, para no exceder el largo de URL con muchos establecimientos. */
const LATEST_SYNCS_ID_CHUNK = 100;
const LATEST_SYNCS_MAX_FALLBACK_QUERIES = 60;
const LATEST_SYNCS_FALLBACK_CONCURRENCY = 6;

/**
 * Service to manage Supabase synchronization state
 */
export const supabaseService = {
  /**
   * Último registro válido de historial por establecimiento.
   *
   * `keyGroups` (opcional) agrupa las claves que pertenecen a un mismo establecimiento
   * (facilityCode e IDs legacy) para no repetir consultas cuando ya se encontró una.
   */
  async getLatestSyncs(
    establishmentIds?: string[],
    keyGroups?: string[][],
  ): Promise<Record<string, StockSyncRecord>> {
    if (!supabase) return {};
    const client = supabase;
    const cutoffIso = getSyncDateCutoffIso();
    try {
      if (establishmentIds && establishmentIds.length > 0) {
        const uniqueIds = Array.from(new Set(establishmentIds.filter(Boolean)));
        if (uniqueIds.length === 0) return {};

        const latestMap: Record<string, StockSyncRecord> = {};
        let truncated = false;

        for (let i = 0; i < uniqueIds.length; i += LATEST_SYNCS_ID_CHUNK) {
          const chunk = uniqueIds.slice(i, i + LATEST_SYNCS_ID_CHUNK);
          const { data, error } = await client
            .from("stock_sync_history")
            .select(STOCK_SYNC_LIGHT_COLUMNS)
            .in("establishment_id", chunk)
            .lte("sync_date", cutoffIso)
            .order("sync_date", { ascending: false })
            .limit(LATEST_SYNCS_BULK_LIMIT);

          if (error) throw error;
          const rows = (data || []) as StockSyncRecord[];
          Object.assign(latestMap, pickLatestSyncs(rows));
          if (rows.length >= LATEST_SYNCS_BULK_LIMIT) truncated = true;
        }

        // Las hojas se actualizan constantemente, así que las filas recientes de unas pocas
        // IPRESS pueden llenar el tope. Quien aparece en el lote ya trae su último registro
        // (el orden es descendente); solo los ausentes se consultan por separado.
        if (truncated) {
          const pendingGroups = findGroupsWithoutSync(uniqueIds, latestMap, keyGroups)
            .slice(0, LATEST_SYNCS_MAX_FALLBACK_QUERIES);
          const queue = [...pendingGroups];
          const worker = async () => {
            for (let group = queue.shift(); group; group = queue.shift()) {
              const { data, error } = await client
                .from("stock_sync_history")
                .select(STOCK_SYNC_LIGHT_COLUMNS)
                .in("establishment_id", group)
                .lte("sync_date", cutoffIso)
                .order("sync_date", { ascending: false })
                .limit(1);
              if (error) {
                console.error("Historial Supabase: no se pudo leer", group, error.message);
                continue;
              }
              Object.assign(latestMap, pickLatestSyncs((data || []) as StockSyncRecord[]));
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(LATEST_SYNCS_FALLBACK_CONCURRENCY, queue.length) }, worker),
          );
        }

        return latestMap;
      }

      // Sin IDs: consulta general acotada, conservada por compatibilidad.
      const { data, error } = await client
        .from("stock_sync_history")
        .select(STOCK_SYNC_LIGHT_COLUMNS)
        .lte("sync_date", cutoffIso)
        .order("sync_date", { ascending: false })
        .limit(10000);

      if (error) throw error;
      return pickLatestSyncs((data || []) as StockSyncRecord[]);
    } catch (e: any) {
      // Supabase no debe bloquear la consulta de stock, pero el fallo tiene que verse:
      // un 400 silencioso dejó todas las tarjetas en "Sin verificar".
      console.error(
        "Historial Supabase: error al consultar stock_sync_history:",
        e?.message || e,
      );
      return {};
    }
  },

  /**
   * Fetch full sync history log for a single establishment
   */
  async getHistoryForEstablishment(
    facilityId: string,
    limit = 15,
  ): Promise<StockSyncRecord[]> {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from("stock_sync_history")
        .select("*")
        .eq("establishment_id", facilityId)
        .order("sync_date", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn(`Error compiling history for '${facilityId}':`, e);
      return [];
    }
  },

  /**
   * Registers a sync snapshot.
   * If there's a previous sync, compares it to detect actual inventory changes.
   */
  async registerSync({
    establishmentId,
    establishmentName,
    currentStock,
    author,
    sheetLastUpdateDate,
  }: {
    establishmentId: string;
    establishmentName: string;
    currentStock: any[];
    author: string;
    sheetLastUpdateDate?: string;
  }): Promise<{
    success: boolean;
    record?: StockSyncRecord;
    hasChangesSinceLast: boolean;
    message?: string;
  }> {
    if (!supabase) {
      return {
        success: false,
        hasChangesSinceLast: false,
        message: "Supabase client not configured.",
      };
    }

    const client = supabase;

    try {
      const stockHash = computeStockHash(currentStock);

      // Fecha de la última actualización de la hoja. Una fecha ilegible o futura ya no
      // rompe el registro (`new Date(...).toISOString()` lanzaba RangeError) ni se guarda
      // en el futuro; en esos casos se usa el momento actual.
      const finalSyncDate = resolveSyncDateIso(sheetLastUpdateDate);

      // 1. Último registro válido. Los que tienen fecha futura se ignoran: si no, cada
      // cambio nuevo se compararía contra ese snapshot hasta que llegue su fecha.
      const { data: previousRecords, error: prevError } = await supabase
        .from("stock_sync_history")
        .select("*")
        .eq("establishment_id", establishmentId)
        .lte("sync_date", getSyncDateCutoffIso())
        .order("sync_date", { ascending: false })
        .limit(1);

      if (prevError) throw prevError;

      const latestRecord = previousRecords && previousRecords[0];

      // Foto compacta del stock actual: medicamento + lote, sumando tipo de suministro y
      // fuente de financiamiento.
      const snapshot = buildStockSnapshot(currentStock);
      const totalStock = Object.values(snapshot).reduce((sum, entry) => sum + entry.q, 0);
      // Los precios llegan como los muestra la hoja ("6,4125"), así que `Number()` daba NaN
      // y la valorización se guardaba en 0.
      const totalValue = (currentStock || []).reduce((sum, item) => {
        if (!item) return sum;
        const quantity = parseSheetNumber(
          item.Saldo !== undefined && item.Saldo !== null && String(item.Saldo).trim() !== ""
            ? item.Saldo
            : item.Saldo_Fisico ?? item.Stock ?? 0,
        );
        const price = parseSheetNumber(item.Precio_Det || item.Precio_Cab || item.Precio || 0);
        return sum + quantity * price;
      }, 0);

      const previousSnapshot = latestRecord
        ? readStockSnapshot(latestRecord.changes_metadata)
        : null;

      const buildMetadata = (movements: StockMovement[]) =>
        JSON.stringify({
          snapshot_version: STOCK_SNAPSHOT_VERSION,
          total_stock: totalStock,
          total_value: Number(totalValue.toFixed(2)),
          changes: movements,
          items_snapshot: snapshot,
        }).replace(/ /g, ""); // Postgres rechaza bytes nulos.

      const insertRecord = async (movements: StockMovement[]) => {
        const payload: StockSyncRecord = {
          establishment_id: establishmentId,
          establishment_name: establishmentName,
          sync_date: finalSyncDate,
          record_count: currentStock.length,
          stock_hash: stockHash,
          has_changes: movements.length > 0,
          changed_items_count: movements.length,
          sync_author: author || "Sistema",
        };

        // Si el detalle no entra, se recorta antes que perder la foto: sin ella la próxima
        // lectura no podría comparar y volvería a marcar cambios inexistentes.
        const attempts = [
          buildMetadata(movements),
          buildMetadata(movements.slice(0, 50)),
          buildMetadata([]),
          undefined,
        ];
        let lastError: any = null;

        for (const changesMetadata of attempts) {
          try {
            const { data, error } = await client
              .from("stock_sync_history")
              .insert([{ ...payload, changes_metadata: changesMetadata }])
              .select();
            if (error) throw error;
            return data && data[0] ? data[0] : { ...payload, changes_metadata: changesMetadata };
          } catch (insertError: any) {
            lastError = insertError;
            console.warn(
              `Historial: el registro de ${establishmentId} no entró con todo el detalle, se reintenta con menos:`,
              insertError?.message || insertError,
            );
          }
        }
        throw lastError;
      };

      // Sin foto anterior utilizable no se puede saber qué cambió. Se guarda una referencia
      // inicial, que no cuenta como movimiento, y la próxima lectura ya podrá comparar.
      if (!previousSnapshot) {
        if (latestRecord && latestRecord.stock_hash === stockHash) {
          return {
            success: true,
            record: latestRecord,
            hasChangesSinceLast: false,
            message: "Sin cambios desde el último registro.",
          };
        }
        const record = await insertRecord([]);
        return {
          success: true,
          record,
          hasChangesSinceLast: false,
          message: "Referencia inicial de stock registrada.",
        };
      }

      // Solo se guardan aumentos o disminuciones de stock por medicamento y lote.
      const movements = diffStockSnapshots(previousSnapshot, snapshot);
      if (movements.length === 0) {
        return {
          success: true,
          record: latestRecord,
          hasChangesSinceLast: false,
          message: "Sin movimientos de stock.",
        };
      }

      const record = await insertRecord(movements);
      return {
        success: true,
        record,
        hasChangesSinceLast: true,
        message: `Movimientos registrados: ${movements.length} medicamento(s) con variación de stock.`,
      };
    } catch (e: any) {
      console.error(
        "CRITICAL Error registering sync in Supabase for " +
          establishmentId +
          ":",
        e,
      );
      // Even if there's a critical error (like network down), we don't want the UI to hang on "Sin verificar" forever
      // if we at least read the local sheet correctly. But returning success: false is appropriate.
      return { success: false, hasChangesSinceLast: false, message: e.message };
    }
  },
};
