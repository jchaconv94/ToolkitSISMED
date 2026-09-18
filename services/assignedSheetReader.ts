/**
 * Lectura del stock de una hoja asignada a un establecimiento.
 *
 * La asignación guarda el nombre de la pestaña, pero **no debe depender de la URL** con la
 * que se creó: la conexión de una UNGET cambia de URL al configurar su hoja, al volver a
 * desplegar su Web App o al cambiar de libro. Aquí se resuelve la conexión vigente de esa
 * UNGET y se lee por el mejor camino disponible:
 *
 *   1. si la UNGET tiene hoja de cálculo configurada, se lee la pestaña del libro;
 *   2. si no, se pide al Web App de Apps Script, como se hacía antes.
 *
 * Ver docs/REVISION_MODELO_CONEXIONES_2026-09-18.md (apartado 2.3).
 */

import { a1Range, batchGetRanges, hasSheetsApiKey } from "./sheetsApiService";
import { csvRowsToObjects, parseCsv } from "./sheetsDirectService";
import { assignmentBelongsToConnection } from "./ungetConnections";

export const ASSIGNED_SHEET_TIMEOUT_MS = 20_000;

export interface AssignmentRef {
  sheetName: string;
  sheetUrl?: string | null;
  ungetId?: string | null;
}

export interface ConnectionRef {
  ungetId?: string | null;
  url?: string | null;
  spreadsheetId?: string;
}

/** Fila tal como viene de la hoja, con sus columnas originales. */
export type AssignedSheetRow = Record<string, any>;

/**
 * Extrae las filas de la pestaña pedida dentro de la respuesta del Web App, que puede venir
 * como lista de hojas, como lista de filas o con las filas en `data`.
 */
export const findAssignedSheetRows = (payload: unknown, sheetName: string): AssignedSheetRow[] => {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root.sheets)
      ? root.sheets
      : [];

  if (candidates.length > 0) {
    const sheets = candidates.filter((item) => item && typeof item === "object") as Array<
      Record<string, unknown>
    >;
    const targetName = String(sheetName || "").trim().toLocaleLowerCase("es");
    const selected =
      sheets.find((sheet) => String(sheet.name ?? "").trim().toLocaleLowerCase("es") === targetName) ||
      sheets.find((sheet) => String(sheet.id ?? "").trim().toLocaleLowerCase("es") === targetName);
    if (selected && Array.isArray(selected.data)) return selected.data as AssignedSheetRow[];

    const looksLikeRows = !sheets.some((sheet) => Array.isArray(sheet.data));
    if (looksLikeRows) return sheets as AssignedSheetRow[];
  }

  if (Array.isArray(root.data)) return root.data as AssignedSheetRow[];
  return [];
};

/** La conexión vigente de la UNGET a la que pertenece la asignación. */
export const findConnectionForAssignment = <T extends ConnectionRef>(
  assignment: AssignmentRef | null | undefined,
  connections: T[] | null | undefined,
): T | null =>
  (connections || []).find((connection) => assignmentBelongsToConnection(assignment, connection)) || null;

const esUrlVirtual = (url?: string | null) => String(url || "").startsWith("sheets://");

/**
 * URL de Web App utilizable: la de la conexión vigente y, si esa ya no es una Web App, la
 * que quedó guardada en la asignación.
 */
export const webAppUrlForAssignment = (
  assignment: AssignmentRef | null | undefined,
  connection: ConnectionRef | null | undefined,
): string => {
  const vigente = String(connection?.url || "").trim();
  if (vigente && !esUrlVirtual(vigente)) return vigente;
  const guardada = String(assignment?.sheetUrl || "").trim();
  return guardada && !esUrlVirtual(guardada) ? guardada : "";
};

/** Petición selectiva al Web App: una sola pestaña, no el libro entero. */
export const buildWebAppStockUrl = (url: string, sheetName: string): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sheets");
    parsed.searchParams.set("action", "getStock");
    parsed.searchParams.set("sheet", sheetName);
    parsed.searchParams.set("_t", String(Date.now()));
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}action=getStock&sheet=${encodeURIComponent(sheetName)}&_t=${Date.now()}`;
  }
};

/** Pestaña por nombre en formato CSV, sin necesitar su identificador ni clave de API. */
const fetchSheetCsvByName = async (
  spreadsheetId: string,
  sheetName: string,
  timeoutMs: number,
): Promise<string> => {
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", credentials: "omit", signal: controller.signal });
    if (!res.ok) throw new Error(`La hoja respondió HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Filas de la hoja asignada. Prefiere leer el libro directamente; si la UNGET no tiene hoja
 * configurada, usa su Web App.
 */
export async function readAssignedSheetRows(
  assignment: AssignmentRef,
  connection: ConnectionRef | null | undefined,
  options: { timeoutMs?: number } = {},
): Promise<AssignedSheetRow[]> {
  const timeoutMs = options.timeoutMs ?? ASSIGNED_SHEET_TIMEOUT_MS;
  const spreadsheetId = String(connection?.spreadsheetId || "").trim();

  if (spreadsheetId) {
    if (hasSheetsApiKey()) {
      try {
        const [values] = await batchGetRanges(spreadsheetId, [a1Range(assignment.sheetName, "A:AZ")], {
          timeoutMs,
        });
        const filas = csvRowsToObjects(values || []);
        if (filas.length > 0) return filas;
      } catch {
        // Sin cuota o sin permiso: queda el CSV, que no consume cuota.
      }
    }
    try {
      const filas = csvRowsToObjects(
        parseCsv(await fetchSheetCsvByName(spreadsheetId, assignment.sheetName, timeoutMs)),
      );
      if (filas.length > 0) return filas;
    } catch {
      // Si la hoja no se deja leer, todavía puede quedar la Web App.
    }
  }

  const url = webAppUrlForAssignment(assignment, connection);
  if (!url) {
    throw new Error(
      "La UNGET de este establecimiento no tiene una conexión utilizable. Pida que configure el enlace de su hoja de cálculo.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildWebAppStockUrl(url, assignment.sheetName), {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`La conexión respondió HTTP ${response.status}`);
    const payload: unknown = await response.json();
    return findAssignedSheetRows(payload, assignment.sheetName);
  } finally {
    clearTimeout(timer);
  }
}
