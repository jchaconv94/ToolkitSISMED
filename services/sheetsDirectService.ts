/**
 * Lectura directa de Google Sheets para Consulta Stock.
 *
 * Descarga una pestaña como CSV desde el endpoint de exportación de Google Sheets. El CSV
 * trae los textos tal como se ven en la hoja (equivalente a `getDisplayValues()` de
 * STOCK_WEBAPP.gs): fechas DD/MM/YYYY y decimales con coma, sin conversiones.
 *
 * Motivo: la Web App de Apps Script ejecuta en 1-2 s, pero Google falla con frecuencia al
 * entregar su respuesta (404 tras 20-60 s). La exportación directa responde en ~1 s.
 *
 * Requisito: la hoja debe estar compartida como "Cualquier persona con el enlace: Lector".
 * Si no lo está, o Google falla, quien llama usa Apps Script como respaldo. La fuente de
 * stock sigue siendo Google Sheets; nada de aquí usa Supabase.
 */

import type { GasSheetMetadata } from "./gasConnectionService";

const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;
const GID_PATTERN = /^\d+$/;
export const DIRECT_SHEET_TIMEOUT_MS = 15_000;
const DIRECT_RETRY_DELAY_MS = 1_000;
const DIRECT_HEAD_CONCURRENCY = 6;
/** Encabezado + primera fila: suficiente para las fechas de actualización de la tarjeta. */
const HEAD_RANGE = "A1:AZ2";

export class DirectSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectSheetError";
  }
}

export const canReadSheetDirect = (spreadsheetId?: string, gid?: string): boolean =>
  !!spreadsheetId &&
  SPREADSHEET_ID_PATTERN.test(spreadsheetId) &&
  !!gid &&
  GID_PATTERN.test(gid);

export const buildSheetExportUrl = (spreadsheetId: string, gid: string, range?: string): string => {
  const params = new URLSearchParams({ format: "csv", gid });
  if (range) params.set("range", range);
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?${params.toString()}`;
};

/**
 * ID del libro a partir del enlace completo de Google Sheets o del ID pelado.
 * Devuelve "" si no se reconoce.
 */
export const extractSpreadsheetId = (input?: string | null): string => {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  const candidate = fromUrl || raw.split("?")[0].split("#")[0].trim();
  return SPREADSHEET_ID_PATTERN.test(candidate) ? candidate : "";
};

/**
 * Comprueba que el libro se pueda leer sin iniciar sesión, es decir, compartido como
 * "Cualquiera con el enlace: Lector". Lee una sola celda de la primera pestaña.
 */
export async function checkSpreadsheetAccess(
  spreadsheetId: string,
  options: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!SPREADSHEET_ID_PATTERN.test(spreadsheetId)) {
    return { ok: false, message: "El enlace no parece de una hoja de cálculo de Google." };
  }
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:csv&tq=${encodeURIComponent("select * limit 1")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DIRECT_SHEET_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", credentials: "omit", signal: controller.signal });
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && contentType.includes("text/csv")) {
      return { ok: true, message: "Hoja accesible: la lectura directa quedará activada." };
    }
    if (res.status === 404) {
      return { ok: false, message: "No se encontró esa hoja de cálculo. Revise el enlace." };
    }
    return {
      ok: false,
      message:
        "La hoja no es accesible con el enlace. En Google Sheets, use Compartir y elija \"Cualquiera con el enlace\" como Lector.",
    };
  } catch (err: any) {
    return {
      ok: false,
      message:
        err?.name === "AbortError"
          ? "Google tardó demasiado en responder. Intente de nuevo."
          : "No se pudo comprobar la hoja. Verifique el enlace y que esté compartida como lector.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** CSV (RFC 4180): comillas, comillas escapadas y saltos de línea dentro de una celda. */
export const parseCsv = (text: string): string[][] => {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/**
 * Filas CSV → objetos por encabezado, con las mismas reglas que `processSheet_` del backend:
 * encabezados recortados, columnas sin encabezado omitidas y filas vacías descartadas.
 */
export const csvRowsToObjects = (rows: string[][]): Record<string, string>[] => {
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => String(header || "").trim());
  const result: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    const item: Record<string, string> = {};
    let hasData = false;
    headers.forEach((header, c) => {
      if (!header) return;
      const value = values[c] ?? "";
      item[header] = value;
      if (!hasData && value.trim() !== "") hasData = true;
    });
    if (hasData) result.push(item);
  }
  return result;
};

const waitMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Descarga un CSV; reintenta una vez ante fallos de red o de servidor. */
const fetchCsv = async (url: string, timeoutMs: number): Promise<string> => {
  let lastError = "No se pudo leer la hoja directamente.";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal,
      });
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("text/csv")) {
        return await res.text();
      }
      // 4xx o una página HTML: hoja privada, pestaña inexistente o ID inválido. No mejora
      // reintentando; quien llama recurre a Apps Script.
      if ((res.status >= 400 && res.status < 500 && res.status !== 429) || res.ok) {
        throw new DirectSheetError(
          `Google Sheets no entregó la hoja (${res.status}${res.ok ? ", no es CSV" : ""}). Verifique que esté compartida como lector con el enlace.`,
        );
      }
      lastError = `Google Sheets respondió ${res.status}.`;
    } catch (err: any) {
      if (err instanceof DirectSheetError) throw err;
      lastError =
        err?.name === "AbortError"
          ? "Google Sheets tardó demasiado en responder."
          : err?.message || lastError;
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 1) await waitMs(DIRECT_RETRY_DELAY_MS);
  }

  throw new DirectSheetError(lastError);
};

/** Stock completo de una pestaña, leído directamente de Google Sheets. */
export async function fetchSheetRowsDirect(
  spreadsheetId: string,
  gid: string,
  options: { timeoutMs?: number } = {},
): Promise<Record<string, string>[]> {
  if (!canReadSheetDirect(spreadsheetId, gid)) {
    throw new DirectSheetError("La hoja no tiene identificador para lectura directa.");
  }
  const text = await fetchCsv(
    buildSheetExportUrl(spreadsheetId, gid),
    options.timeoutMs ?? DIRECT_SHEET_TIMEOUT_MS,
  );
  const rows = parseCsv(text);
  if (rows.length === 0 || rows[0].every((header) => !header.trim())) {
    throw new DirectSheetError("La hoja no tiene encabezados.");
  }
  return csvRowsToObjects(rows);
}

const normalizeKey = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const LAST_UPDATE_KEYS = new Set(
  ["ULTIMA ACTUALIZACION", "ULTIMA_ACTUALIZACION", "ULTIMA_ACT", "ULT_ACT", "FECHA_ACTUALIZACION"].map(normalizeKey),
);
const EQUIPMENT_DATE_KEYS = new Set(["FECHA DEL EQUIPO", "FECHA_EQUIPO"].map(normalizeKey));
const ALMCOD_KEYS = new Set(["ALMCOD", "ALM_COD"].map(normalizeKey));

const readByKeys = (row: Record<string, string> | undefined, keys: Set<string>): string => {
  if (!row) return "";
  const key = Object.keys(row).find((candidate) => keys.has(normalizeKey(candidate)));
  return key ? String(row[key] ?? "").trim() : "";
};

/** Hoja ya conocida (de la caché) que se puede consultar directamente. */
export interface DirectSheetRef {
  gid: string;
  sheetName: string;
  spreadsheetId: string;
  rowCount?: number;
  codigoIpress?: string;
  lastUpdate?: string;
  equipmentDate?: string;
}

/**
 * Metadata equivalente a `getMetadata`, leyendo solo el encabezado y la primera fila de cada
 * hoja conocida. No descubre hojas nuevas (eso sigue a cargo de Apps Script) y conserva el
 * `rowCount` guardado. Una hoja que falla mantiene sus valores guardados; si fallan todas,
 * lanza `DirectSheetError`.
 */
export async function fetchSheetsMetadataDirect(
  refs: DirectSheetRef[],
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<GasSheetMetadata[]> {
  const readable = refs.filter((ref) => canReadSheetDirect(ref.spreadsheetId, ref.gid));
  if (readable.length === 0) {
    throw new DirectSheetError("Ninguna hoja tiene identificador para lectura directa.");
  }

  const results: GasSheetMetadata[] = new Array(readable.length);
  let succeeded = 0;
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < readable.length) {
      const index = nextIndex++;
      const ref = readable[index];
      const cached: GasSheetMetadata = {
        id: ref.gid,
        name: ref.sheetName,
        lastUpdate: ref.lastUpdate || "",
        equipmentDate: ref.equipmentDate || "",
        codigoIpress: ref.codigoIpress,
        rowCount: ref.rowCount,
        spreadsheetId: ref.spreadsheetId,
      };
      try {
        const text = await fetchCsv(
          buildSheetExportUrl(ref.spreadsheetId, ref.gid, HEAD_RANGE),
          options.timeoutMs ?? DIRECT_SHEET_TIMEOUT_MS,
        );
        const firstRow = csvRowsToObjects(parseCsv(text))[0];
        results[index] = {
          ...cached,
          lastUpdate: readByKeys(firstRow, LAST_UPDATE_KEYS),
          equipmentDate: readByKeys(firstRow, EQUIPMENT_DATE_KEYS),
          almcod: readByKeys(firstRow, ALMCOD_KEYS) || undefined,
          rowCount: firstRow ? ref.rowCount : 0,
        };
        succeeded++;
      } catch (err: any) {
        console.warn(`Lectura directa: no se pudo leer "${ref.sheetName}":`, err?.message || err);
        results[index] = cached;
      }
    }
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? DIRECT_HEAD_CONCURRENCY, readable.length));
  await Promise.all(Array.from({ length: concurrency }, worker));

  if (succeeded === 0) {
    throw new DirectSheetError("No se pudo leer ninguna hoja directamente desde Google Sheets.");
  }
  return results;
}
