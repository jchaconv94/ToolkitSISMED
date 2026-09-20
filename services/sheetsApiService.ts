/**
 * Google Sheets API v4 con clave de API, para Consulta Stock.
 *
 * Sustituye a la Web App de Apps Script en lo único que seguía aportando: la lista de
 * pestañas de cada UNGET. Además trae los encabezados de todas las pestañas en una sola
 * petición, en vez de una por pestaña.
 *
 * Solo lee hojas compartidas como "Cualquiera con el enlace: Lector". La clave viaja en la
 * web restringida por dominio y a esta API. El stock completo de una IPRESS se sigue leyendo
 * por CSV (`sheetsDirectService`), que no consume cuota.
 *
 * Cuotas (documentación de Google): 300 lecturas por minuto por proyecto y 60 por usuario.
 * Ante 403/429 quien llama vuelve al CSV directo o a Apps Script.
 */

import type { GasSheetMetadata } from "./gasConnectionService";
import { facilityCodeOf } from "./facilityCodes";
import { fetchSheetsMetadataDirect, readHeadMetadata } from "./sheetsDirectService";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const SHEETS_API_TIMEOUT_MS = 20_000;
/** La lista de pestañas cambia poco: se reutiliza durante 30 minutos. */
export const TABS_CACHE_TTL_MS = 30 * 60 * 1000;
/** Rangos por petición: la URL de batchGet tiene un límite práctico de tamaño. */
const BATCH_RANGES_PER_REQUEST = 40;

export const getSheetsApiKey = (): string => {
  try {
    return String((import.meta as any).env?.VITE_GOOGLE_SHEETS_API_KEY || "").trim();
  } catch {
    return "";
  }
};

export const hasSheetsApiKey = (): boolean => getSheetsApiKey().length > 0;

export class SheetsApiError extends Error {
  readonly status: number;
  /** 429 o cuota agotada: conviene esperar y usar el CSV directo mientras tanto. */
  readonly quotaExceeded: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SheetsApiError";
    this.status = status;
    this.quotaExceeded = status === 429;
  }
}

export interface SheetTab {
  gid: string;
  title: string;
  index: number;
  hidden: boolean;
}

type CacheEntry = { value: SheetTab[]; expiresAt: number };
const tabsCache = new Map<string, CacheEntry>();
const tabsInflight = new Map<string, Promise<SheetTab[]>>();

/** Referencia de rango A1 con el nombre de la pestaña entre comillas simples. */
export const a1Range = (title: string, range: string): string =>
  `'${String(title).replace(/'/g, "''")}'!${range}`;

const apiFetch = async (url: string, timeoutMs: number): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "omit",
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const apiMessage = body?.error?.message || `HTTP ${res.status}`;
      if (res.status === 403) {
        throw new SheetsApiError(
          `Google Sheets API rechazó la petición (${apiMessage}). Revise que la hoja esté compartida como lector con el enlace y que la clave permita este sitio.`,
          403,
        );
      }
      if (res.status === 404) {
        throw new SheetsApiError("No se encontró la hoja de cálculo. Revise el enlace.", 404);
      }
      if (res.status === 429) {
        throw new SheetsApiError(
          "Se alcanzó la cuota de la API de Google Sheets; se usará la lectura directa mientras tanto.",
          429,
        );
      }
      throw new SheetsApiError(`Google Sheets API respondió ${res.status}: ${apiMessage}`, res.status);
    }
    return body;
  } catch (err: any) {
    if (err instanceof SheetsApiError) throw err;
    throw new SheetsApiError(
      err?.name === "AbortError"
        ? "Google Sheets API tardó demasiado en responder."
        : err?.message || "No se pudo conectar con Google Sheets API.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Pestañas del libro (id, nombre y orden), como `getSheetList_` del backend.
 * Una sola petición, reutilizada durante 30 minutos salvo `force`.
 */
export async function listSheetTabs(
  spreadsheetId: string,
  options: { apiKey?: string; force?: boolean; timeoutMs?: number } = {},
): Promise<SheetTab[]> {
  const apiKey = options.apiKey ?? getSheetsApiKey();
  if (!apiKey) throw new SheetsApiError("No hay clave de Google Sheets API configurada.", 0);
  if (!spreadsheetId) throw new SheetsApiError("Falta el identificador de la hoja de cálculo.", 0);

  const now = Date.now();
  if (!options.force) {
    const cached = tabsCache.get(spreadsheetId);
    if (cached && cached.expiresAt > now) return cached.value;
    const pending = tabsInflight.get(spreadsheetId);
    if (pending) return pending;
  }

  const request = (async () => {
    try {
      const params = new URLSearchParams({
        fields: "sheets.properties(sheetId,title,index,hidden)",
        key: apiKey,
      });
      const body = await apiFetch(
        `${API_BASE}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
        options.timeoutMs ?? SHEETS_API_TIMEOUT_MS,
      );
      const tabs: SheetTab[] = (body?.sheets || [])
        .map((sheet: any) => sheet?.properties)
        .filter((p: any) => p && p.sheetId !== undefined && p.title)
        .map((p: any) => ({
          gid: String(p.sheetId),
          title: String(p.title),
          index: Number(p.index) || 0,
          hidden: !!p.hidden,
        }))
        .sort((a: SheetTab, b: SheetTab) => a.index - b.index);
      tabsCache.set(spreadsheetId, { value: tabs, expiresAt: Date.now() + TABS_CACHE_TTL_MS });
      return tabs;
    } finally {
      tabsInflight.delete(spreadsheetId);
    }
  })();

  tabsInflight.set(spreadsheetId, request);
  return request;
}

/**
 * Varios rangos en una sola petición. Devuelve las filas de cada rango en el mismo orden;
 * un rango vacío devuelve []. Los textos llegan tal como se ven en la hoja.
 */
export async function batchGetRanges(
  spreadsheetId: string,
  ranges: string[],
  options: { apiKey?: string; timeoutMs?: number } = {},
): Promise<string[][][]> {
  const apiKey = options.apiKey ?? getSheetsApiKey();
  if (!apiKey) throw new SheetsApiError("No hay clave de Google Sheets API configurada.", 0);
  if (ranges.length === 0) return [];

  const result: string[][][] = [];
  for (let i = 0; i < ranges.length; i += BATCH_RANGES_PER_REQUEST) {
    const chunk = ranges.slice(i, i + BATCH_RANGES_PER_REQUEST);
    const params = new URLSearchParams({
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
      majorDimension: "ROWS",
      key: apiKey,
    });
    chunk.forEach((range) => params.append("ranges", range));
    const body = await apiFetch(
      `${API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`,
      options.timeoutMs ?? SHEETS_API_TIMEOUT_MS,
    );
    const valueRanges: any[] = Array.isArray(body?.valueRanges) ? body.valueRanges : [];
    chunk.forEach((_, index) => {
      const values = valueRanges[index]?.values;
      result.push(
        Array.isArray(values)
          ? values.map((row: any[]) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
          : [],
      );
    });
  }
  return result;
}

/**
 * Código oficial del establecimiento, con las mismas reglas que `getFacilityCode_` del
 * backend: sufijo del nombre de la pestaña y, si no, los 5 dígitos iniciales del ALMCOD.
 */
export const facilityCodeFromSheetName = (sheetName: string, almcod?: string): string => {
  const suffix = String(sheetName || "").trim().match(/-([A-Z0-9]+)\s*$/i)?.[1];
  if (suffix) return suffix.toUpperCase();
  const code = String(almcod || "").trim().toUpperCase();
  if (!code) return "";
  const numeric = code.match(/^(\d{5})(?=[A-Z]|\d{2,}$)/)?.[1];
  if (numeric) return numeric;
  return code.length >= 5 ? code.substring(0, 5) : code;
};

/**
 * Establecimiento registrado que corresponde a un código leído de una pestaña.
 *
 * Primero busca la coincidencia exacta. Si no la hay, admite que el registro lleve el
 * sufijo interno, pero **solo cuando no hay ambigüedad**: si dos establecimientos se
 * reducen al mismo código oficial no se elige ninguno, porque mostrar el nombre equivocado
 * es peor que no mostrar ninguno.
 */
export const findFacilityByCode = <T extends { code?: string | null }>(
  code: string | null | undefined,
  facilities: T[] | null | undefined,
): T | null => {
  const buscado = String(code || "").trim().toUpperCase();
  if (!buscado) return null;

  const lista = (facilities || []).filter(Boolean);
  const exacto = lista.find((f) => String(f?.code || "").trim().toUpperCase() === buscado);
  if (exacto) return exacto;

  const porOficial = lista.filter((f) => facilityCodeOf(f?.code).toUpperCase() === buscado);
  return porOficial.length === 1 ? porOficial[0] : null;
};

/**
 * Si una pestaña corresponde a un establecimiento.
 *
 * El libro de una UNGET puede tener pestañas que no son establecimientos: la `Sheet3` que
 * Google crea sola, una copia de trabajo, una hoja de pruebas. Hasta ahora todas salían en
 * Consulta Stock como una tarjeta más, con «Sin datos» y «0 items», y había que saber de
 * antemano cuáles ignorar.
 *
 * Se descarta una pestaña solo cuando fallan **las tres** señales a la vez: no lleva código
 * de establecimiento en el nombre, no tiene `ALMCOD` en su cabecera y se sabe con certeza
 * que no tiene filas. Con que cumpla una, se conserva.
 *
 * El orden importa: un establecimiento real con el stock vacío tiene el código en el nombre
 * y sigue apareciendo, que es justo lo que debe pasar. Y si no se sabe cuántas filas tiene
 * —la lectura directa no siempre lo trae— tampoco se oculta: sin certeza, se muestra.
 */
export const isFacilitySheet = (meta: {
  name?: string;
  almcod?: string;
  codigoIpress?: string;
  rowCount?: number;
}): boolean => {
  const codigo =
    String(meta?.codigoIpress || "").trim() || facilityCodeFromSheetName(meta?.name || "");
  if (codigo) return true;
  if (String(meta?.almcod || "").trim()) return true;
  if (meta?.rowCount === undefined) return true;
  return meta.rowCount > 0;
};

/**
 * Nombre de un establecimiento para mostrar en pantalla.
 *
 * Quita el código pegado al final (`C.S. NUEVO LIMA-06519`) y el prefijo `FARM -`. Cada
 * pantalla de Consulta Stock lo resolvía por su cuenta recortando por el **último** guion,
 * repetido once veces. Eso valía para los nombres de pestaña, pero la tarjeta ya puede
 * mostrar el nombre oficial del registro, y uno como «P.S. NUEVO TARAPOTO - ANEXO» se
 * quedaba a medias. Aquí solo se quita un código del final, no cualquier guion.
 */
export const describeSheetName = (name?: string | null): string => {
  const limpio = String(name || "").trim();
  const sinCodigo = limpio.replace(/-[A-Z0-9]+\s*$/i, "").trim();
  return (sinCodigo || limpio).replace(/^FARM\s*-\s*/i, "").trim() || limpio;
};

/** Conteo de filas ya conocido por pestaña, para no volver a pedirlo en cada sincronización. */
export type KnownRowCounts = Record<string, number | undefined>;

/**
 * Metadata equivalente a `getMetadata` de Apps Script, sin Apps Script:
 * lista de pestañas (1 petición, en caché 30 min) + encabezado y primera fila de todas las
 * pestañas (1 petición). Las pestañas sin conteo conocido piden además su columna A para
 * contar filas, solo la primera vez.
 */
export async function fetchSheetsMetadataViaApi(
  spreadsheetId: string,
  options: {
    apiKey?: string;
    force?: boolean;
    knownRowCounts?: KnownRowCounts;
    timeoutMs?: number;
  } = {},
): Promise<GasSheetMetadata[]> {
  const tabs = await listSheetTabs(spreadsheetId, {
    apiKey: options.apiKey,
    force: options.force,
    timeoutMs: options.timeoutMs,
  });
  if (tabs.length === 0) return [];

  const known = options.knownRowCounts || {};
  const ranges: string[] = [];
  const rangeOwner: Array<{ gid: string; kind: "head" | "count" }> = [];
  tabs.forEach((tab) => {
    ranges.push(a1Range(tab.title, "A1:AZ2"));
    rangeOwner.push({ gid: tab.gid, kind: "head" });
    if (known[tab.gid] === undefined) {
      ranges.push(a1Range(tab.title, "A:A"));
      rangeOwner.push({ gid: tab.gid, kind: "count" });
    }
  });

  let values: string[][][];
  try {
    values = await batchGetRanges(spreadsheetId, ranges, {
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
    });
  } catch (err: any) {
    // La lista de pestañas ya se obtuvo; lo que falló es la lectura de valores, que es la
    // parte que consume cuota. Leer las cabeceras por CSV no consume ninguna, así que una
    // UNGET sin Web App sigue cargando en vez de quedarse sin ninguna vía. Este era el
    // único camino de una UNGET que configuró su hoja y retiró su Apps Script.
    console.warn(
      "Google Sheets API no entregó los valores; se leen las cabeceras por CSV:",
      err?.message || err,
    );
    return await fetchSheetsMetadataDirect(
      tabs.map((tab) => ({
        gid: tab.gid,
        sheetName: tab.title,
        spreadsheetId,
        rowCount: known[tab.gid],
        codigoIpress: facilityCodeFromSheetName(tab.title),
      })),
      { timeoutMs: options.timeoutMs },
    );
  }

  const heads = new Map<string, string[][]>();
  const counts = new Map<string, number>();
  values.forEach((rows, index) => {
    const owner = rangeOwner[index];
    if (!owner) return;
    if (owner.kind === "head") heads.set(owner.gid, rows);
    else counts.set(owner.gid, Math.max(0, rows.filter((row) => String(row[0] ?? "").trim() !== "").length - 1));
  });

  return tabs.map((tab) => {
    const head = readHeadMetadata(heads.get(tab.gid) || []);
    return {
      id: tab.gid,
      name: tab.title,
      lastUpdate: head.lastUpdate,
      equipmentDate: head.equipmentDate,
      almcod: head.almcod || undefined,
      codigoIpress: facilityCodeFromSheetName(tab.title, head.almcod),
      rowCount: counts.get(tab.gid) ?? known[tab.gid],
      spreadsheetId,
    };
  });
}

/** Solo para pruebas. */
export const __resetSheetsApiCache = () => {
  tabsCache.clear();
  tabsInflight.clear();
};
