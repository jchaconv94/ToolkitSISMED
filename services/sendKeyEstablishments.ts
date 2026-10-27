/**
 * Pestaña «Establecimientos» de Claves de envío: une, por código, la clave de envío de cada
 * establecimiento con las PC que reportan su versión del Toolkit y del SISMED.
 *
 * Antes eran dos pestañas (Claves y Equipos) con una fila por establecimiento cada una.
 */

import { SendKeyRow, SendKeyState, sendKeyState } from "./sendKeys";
import {
  DeviceState, SismedFilter, ToolkitDevice, ToolkitDeviceRow, activeDevices, deviceState, latestSismedVersion, sismedState,
} from "./toolkitDevices";

export interface EstablishmentRow extends SendKeyRow {
  /** PC que enviaron el establecimiento, la más reciente primero. */
  devices: ToolkitDevice[];
}

/** La lista manda la de claves (todos los establecimientos de la jurisdicción); se le suman las PC. */
export const mergeEstablishments = (keys: SendKeyRow[], devices: ToolkitDeviceRow[]): EstablishmentRow[] => {
  const byCode = new Map(devices.map((row) => [row.code, row.devices]));
  return keys.map((row) => ({ ...row, devices: byCode.get(row.code) || [] }));
};

/** La PC más reciente que reportó en los últimos 30 días, si hay. */
export const latestDevice = (row: EstablishmentRow, now: Date = new Date()): ToolkitDevice | undefined =>
  activeDevices(row, now)[0];

export const toolkitState = (row: EstablishmentRow, latest: string | null, now: Date = new Date()): DeviceState =>
  deviceState(row, latest, now);

/** Último envío conocido: el aceptado con clave o, si no tiene, el último reporte de su PC. */
export const lastSendAt = (row: EstablishmentRow, now: Date = new Date()): string | null =>
  row.lastOkAt || latestDevice(row, now)?.lastSeen || null;

export type EstablishmentFilter = "all" | "alerts" | "protected" | "waiting" | "none" | "toolkitOutdated" | "toolkitNone";

export const ESTABLISHMENT_FILTER_LABEL: Record<EstablishmentFilter, string> = {
  all: "Todos",
  alerts: "Con intento bloqueado",
  protected: "Protegidos",
  waiting: "Esperando primer envío",
  none: "Sin clave",
  toolkitOutdated: "Toolkit desactualizado",
  toolkitNone: "Toolkit sin reportar",
};

export interface EstablishmentSummary {
  total: number;
  protectedCount: number;
  none: number;
  waiting: number;
  toolkitOutdated: number;
  reporting: number;
  sismedOutdated: number;
  counts: Record<EstablishmentFilter, number>;
}

const matchesFilter = (row: EstablishmentRow, filter: EstablishmentFilter, latest: string | null, now: Date): boolean => {
  const key = sendKeyState(row);
  switch (filter) {
    case "all": return true;
    case "alerts": return key === "blocked";
    case "protected": return key !== "none";
    case "waiting": return key === "waiting";
    case "none": return key === "none";
    case "toolkitOutdated": return toolkitState(row, latest, now) === "outdated";
    case "toolkitNone": return toolkitState(row, latest, now) === "none";
  }
};

const FILTERS = Object.keys(ESTABLISHMENT_FILTER_LABEL) as EstablishmentFilter[];

export const summarizeEstablishments = (
  rows: EstablishmentRow[],
  latest: string | null,
  now: Date = new Date(),
  latestSismed: string | null = latestSismedVersion(rows, now),
): EstablishmentSummary => {
  const counts = Object.fromEntries(FILTERS.map((f) => [f, rows.filter((row) => matchesFilter(row, f, latest, now)).length])) as Record<EstablishmentFilter, number>;
  return {
    total: rows.length,
    protectedCount: counts.protected,
    none: counts.none,
    waiting: counts.waiting,
    toolkitOutdated: counts.toolkitOutdated,
    reporting: rows.length - counts.toolkitNone,
    sismedOutdated: rows.filter((row) => sismedState(row, latestSismed, now) === "outdated").length,
    counts,
  };
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const matchesSismed = (row: EstablishmentRow, filter: SismedFilter, latestSismed: string | null, now: Date): boolean => {
  if (filter === "all") return true;
  if (filter === "outdated" || filter === "none") return sismedState(row, latestSismed, now) === filter;
  return latestDevice(row, now)?.sismedVersion === filter.slice(2);
};

/** Búsqueda (nombre, código o PC), estado y versión del SISMED. Los que piden atención van primero. */
export const filterEstablishments = (
  rows: EstablishmentRow[],
  latest: string | null,
  search: string,
  filter: EstablishmentFilter,
  sismedFilter: SismedFilter = "all",
  now: Date = new Date(),
  latestSismed: string | null = latestSismedVersion(rows, now),
): EstablishmentRow[] => {
  const needle = normalize(search);
  const order: Record<SendKeyState, number> = { blocked: 0, waiting: 1, protected: 2, none: 3 };
  return rows
    .filter((row) => {
      if (!matchesFilter(row, filter, latest, now)) return false;
      if (!matchesSismed(row, sismedFilter, latestSismed, now)) return false;
      if (!needle) return true;
      const pcs = row.devices.map((d) => d.deviceName || "").join(" ");
      return normalize(`${row.name} ${row.code} ${row.deviceName || ""} ${pcs}`).includes(needle);
    })
    .sort((a, b) => order[sendKeyState(a)] - order[sendKeyState(b)] || a.name.localeCompare(b.name, "es", { numeric: true }));
};

/** Por qué «Cambiar a este equipo» puede ser un error. */
export interface RebindWarnings {
  /**
   * Otros establecimientos que ya envía una PC con el mismo nombre que la del intento: vinculada
   * (`bound`) o que los envió en los últimos 30 días. La web solo conoce el nombre de la PC, no su
   * identificador, así que dos PC con el mismo nombre se confunden: es un aviso, no un bloqueo.
   */
  otherEstablishments: { code: string; name: string; bound: boolean }[];
  /** El intento manda menos de la mitad de los lotes del último envío aceptado. */
  fewerRows: { attempt: number; current: number } | null;
}

/** Con menos lotes que esto, la diferencia no dice nada (un puesto pequeño varía mucho). */
const FEWER_ROWS_MIN = 20;

/**
 * Señales de que la PC del intento bloqueado no es la nueva PC del establecimiento. Caso real
 * (P.S. Ledoy, 2026-10-27): su SISMED tenía por error stock del Almacén Bellavista y su Toolkit
 * intentaba enviarlo; «Cambiar a este equipo» habría reemplazado 516 lotes del almacén por 14.
 */
export const rebindWarnings = (row: SendKeyRow, rows: EstablishmentRow[], now: Date = new Date()): RebindWarnings => {
  const pc = normalize(row.alert?.deviceName || "");
  const otherEstablishments = pc
    ? rows
      .filter((other) => other.code !== row.code)
      .flatMap((other) => {
        const bound = normalize(other.deviceName || "") === pc;
        const sends = activeDevices(other, now).some((d) => normalize(d.deviceName || "") === pc);
        return bound || sends ? [{ code: other.code, name: other.name, bound }] : [];
      })
      .sort((a, b) => Number(b.bound) - Number(a.bound) || a.name.localeCompare(b.name, "es", { numeric: true }))
    : [];
  const attempt = row.alert?.rows;
  const current = row.lastOkRows;
  const fewerRows = attempt != null && current != null && current >= FEWER_ROWS_MIN && attempt < current / 2
    ? { attempt, current }
    : null;
  return { otherEstablishments, fewerRows };
};

export const hasRebindRisk = (warnings: RebindWarnings | null | undefined): boolean =>
  Boolean(warnings && (warnings.otherEstablishments.length > 0 || warnings.fewerRows));

/** Intentos bloqueados sin revisar, el más reciente primero (para la campana). */
export const pendingAlerts = (rows: SendKeyRow[]): SendKeyRow[] =>
  rows.filter((row) => row.alert).sort((a, b) => String(b.alert!.at).localeCompare(String(a.alert!.at)));
