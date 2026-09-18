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
import { readHeadMetadata } from "./sheetsDirectService";

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

  const values = await batchGetRanges(spreadsheetId, ranges, {
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
  });

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
