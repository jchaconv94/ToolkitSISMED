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

/** Intentos bloqueados sin revisar, el más reciente primero (para la campana). */
export const pendingAlerts = (rows: SendKeyRow[]): SendKeyRow[] =>
  rows.filter((row) => row.alert).sort((a, b) => String(b.alert!.at).localeCompare(String(a.alert!.at)));
