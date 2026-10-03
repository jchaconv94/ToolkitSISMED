/**
 * Stock SISMED de un establecimiento: la carga y la lectura de sus filas.
 *
 * Es el mismo camino que usa «Stock SISMED» (`components/AssignedIpressStockModule.tsx`) y
 * que usan los avisos de la campana para el responsable de farmacia: la conexión de **su**
 * UNGET, la pestaña que le corresponde por su código (`facilitySheetLink`), la lectura de la
 * hoja (`assignedSheetReader`) y solo las filas de su propio ALMCOD. Estaba escrito dentro
 * del módulo; vive aquí para que los dos lean exactamente lo mismo.
 *
 * El inventario sale solo de Google Sheets. No se lee `stock_actual` (ver AGENTS.md).
 */

import { api } from "./api";
import { findConnectionForAssignment, readAssignedSheetRows } from "./assignedSheetReader";
import { isLinkedToSheet, resolveFacilitySheet, rowsBelongingToFacility, type FacilitySheetLink } from "./facilitySheetLink";
import { STOCK_COLUMNS } from "./stockColumns";
import { listUngetSheets } from "./ungetSheetCatalog";
import { pickOneConnectionPerUnget } from "./ungetConnections";
import type { StockAssignment } from "../types";

export type StockRow = Record<string, unknown>;

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Valor de una columna que puede venir escrita de varias formas (`Saldo`, `SALDO`…). */
export const readStockValue = (row: StockRow, aliases: string[]) => {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) return row[alias];
  }
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    const matchingKey = keys.find(key => normalizeKey(key) === normalizedAlias);
    if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) return row[matchingKey];
  }
  return "";
};

/** Fila con las claves del catálogo de columnas (`Saldo`, `Fec_Vencim`, `Nombre`…). */
export const normalizeStockRow = (row: StockRow): StockRow => ({
  ...Object.fromEntries(STOCK_COLUMNS.map(column => [column.key, readStockValue(row, column.aliases)])),
  TIPSUM: readStockValue(row, ["TIPSUM", "tipsum"]),
  FFINAN: readStockValue(row, ["FFINAN", "ffinan"])
});

/** Número de la hoja: admite `1,5` y `1,234`. Lo que no se entiende cuenta como 0. */
export const parseStockNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/,/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
};

/** Fecha de vencimiento como `dd/mm/aaaa` (acepta `aaaa-mm-dd` y años de dos cifras). */
export const formatStockDate = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const parts = raw.split(/[\/-]/).map(part => Number(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return raw;
  const [first, second, third] = parts;
  if (first > 1000) return `${String(third).padStart(2, "0")}/${String(second).padStart(2, "0")}/${first}`;
  return `${String(first).padStart(2, "0")}/${String(second).padStart(2, "0")}/${third < 100 ? third + 2000 : third}`;
};

/** Vencimiento de un lote: el último instante de ese día. `null` si la fecha no se entiende. */
export const parseExpiryDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  const parts = raw.split(/[\/-]/).map(part => Number(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  const [first, second, third] = parts;
  const year = first > 1000 ? first : third < 100 ? third + 2000 : third;
  const month = second - 1;
  const day = first > 1000 ? third : first;
  const expiration = new Date(year, month, day, 23, 59, 59, 999);
  return Number.isNaN(expiration.getTime()) ? null : expiration;
};

export type ExpirationState = "EXPIRED" | "EXPIRING" | "NORMAL";

/**
 * Vencido, por vencer o normal. «Por vencer» es que vence de hoy a `expiryDays` días, el
 * mismo umbral de Parámetros del Sistema que usa la campana: así la pantalla y el aviso
 * cuentan los mismos lotes. Un lote sin saldo nunca cuenta.
 */
export const getExpirationState = (row: StockRow, expiryDays: number, now: Date = new Date()): ExpirationState => {
  if (parseStockNumber(row.Saldo) <= 0) return "NORMAL";
  const expiration = parseExpiryDate(row.Fec_Vencim);
  if (!expiration) return "NORMAL";

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (expiration < today) return "EXPIRED";
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + expiryDays);
  windowEnd.setHours(23, 59, 59, 999);
  return expiration <= windowEnd ? "EXPIRING" : "NORMAL";
};

/**
 * Momento de una «Última actualización» de la hoja: `dd/mm/aaaa hh:mm:ss` (el formato de
 * Google Sheets en español) o ISO. 0 si no se entiende. Mismas reglas que Consulta Stock.
 */
export const parseUpdateTimestamp = (value?: string | null): number => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(/\s+/);
  const datePart = parts[0].replace(",", "");
  const timePart = parts[1] || "00:00:00";
  const paddedTime = timePart.split(":").map(p => p.padStart(2, "0")).join(":");
  const dateMatch = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${paddedTime}`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const UPDATE_FIELDS = ["ULTIMA_ACTUALIZACION", "Ultima_Actualizacion", "FECHA_DEL_EQUIPO"];

export interface AssignedStockResult {
  assignment: StockAssignment | null;
  link: FacilitySheetLink | null;
  /** Filas propias, ya normalizadas. */
  rows: StockRow[];
  /** Pestaña leída; vacía si no hay stock que mostrar. */
  sheetName: string;
  /** «Última actualización» tal como la muestra el módulo. */
  lastUpdate: string;
  /** La más reciente de esas fechas, en milisegundos (0 si ninguna se entiende). */
  lastUpdateAt: number;
  /** Por qué no hay stock que mostrar, cuando no es un error de lectura. */
  message: string;
}

const empty = (message: string, extra: Partial<AssignedStockResult> = {}): AssignedStockResult => ({
  assignment: null, link: null, rows: [], sheetName: "", lastUpdate: "", lastUpdateAt: 0, message, ...extra,
});

/**
 * Lee el Stock SISMED del establecimiento. Devuelve `message` cuando no hay hoja que leer
 * (sin conexión, sin pestaña propia) y lanza un error si la lectura falla.
 */
export async function loadAssignedIpressStock(
  facilityCode: string | null | undefined,
  ungetId: string | null | undefined,
): Promise<AssignedStockResult> {
  if (!facilityCode) return empty("El usuario no está vinculado a un código de establecimiento IPRESS.");

  const [assignments, conexiones] = await Promise.all([
    api.getMyStockAssignments(facilityCode),
    // La conexión vigente de la UNGET: su URL puede haber cambiado desde que se
    // creó la asignación, o puede que ya solo lea por hoja de cálculo.
    api.getAllUngetConfigs()
  ]);
  const assignment = (assignments[0] || null) as StockAssignment | null;

  // La conexión es la de **su** UNGET, no la que quedó guardada en la asignación: así el
  // establecimiento encuentra su hoja aunque nadie le haya asignado nada.
  const conexion =
    pickOneConnectionPerUnget(conexiones).find(
      c => ungetId && String(c.ungetId || "") === String(ungetId),
    ) || findConnectionForAssignment(assignment, conexiones);

  if (!conexion && !assignment) {
    return empty("La UNGET de este establecimiento no tiene una conexión de stock configurada.", { assignment });
  }

  // El vínculo se deduce del código: la pestaña cuyo código coincide con el del
  // establecimiento. Ver services/facilitySheetLink.ts.
  let link: FacilitySheetLink | null = null;
  try {
    link = resolveFacilitySheet(facilityCode, await listUngetSheets(conexion, { withRowCounts: false }));
  } catch (err) {
    // Sin catálogo de pestañas no hay vínculo que deducir; queda la asignación guardada.
    console.warn("No se pudieron listar las hojas de la UNGET:", err);
  }

  // La asignación guardada solo sirve de red cuando **no se pudo deducir nada**, es
  // decir cuando no hubo forma de leer las pestañas. Si las pestañas se leyeron y
  // ninguna es suya, la hoja guardada es justamente la que no hay que abrir: era de
  // otro establecimiento, y leerla le enseñaría el stock ajeno como si fuera el propio.
  const sheetName = link
    ? (isLinkedToSheet(link) ? link.sheet?.name || "" : "")
    : assignment?.sheetName || "";

  if (!sheetName) {
    return empty(link?.message || "Este establecimiento todavía no tiene una hoja de cálculo que le corresponda.", { assignment, link });
  }

  const sheetRows = (await readAssignedSheetRows(
    { sheetName, sheetUrl: assignment?.sheetUrl, ungetId: ungetId || assignment?.ungetId },
    conexion,
  )) as StockRow[];
  if (sheetRows.length === 0) {
    throw new Error(`No se encontró la hoja “${sheetName}” o no contiene registros.`);
  }

  // La IPRESS ve su hoja entera —sus puestos comunales son suyos—; un puesto comunal
  // solo las filas de su propio ALMCOD.
  const propias = rowsBelongingToFacility(sheetRows, facilityCode, row =>
    String(readStockValue(row, ["ALMCOD", "almcod"]) ?? ""),
  );

  const updateTimes = propias
    .map(row => String(readStockValue(row, UPDATE_FIELDS)))
    .filter(Boolean);
  return {
    assignment,
    link,
    rows: propias.map(normalizeStockRow),
    sheetName,
    lastUpdate: [...updateTimes].sort().at(-1) || "",
    lastUpdateAt: updateTimes.reduce((max, value) => Math.max(max, parseUpdateTimestamp(value)), 0),
    message: "",
  };
}
