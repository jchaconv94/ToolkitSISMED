/**
 * Equipos del Toolkit: qué versión del Toolkit SISMED de escritorio tiene cada PC.
 *
 * Desde la versión 2.1.10 el Toolkit consulta la clave de envío antes de cada envío, y en
 * esa misma consulta la web anota la PC, el establecimiento y la versión
 * (`supabase/SUPABASE_EQUIPOS_TOOLKIT.sql`). Las versiones anteriores no consultan nada, así
 * que sus establecimientos aparecen «Sin reportar».
 *
 * La última versión publicada se toma de las releases de GitHub, igual que el actualizador
 * del Toolkit.
 */

import { callSendKeysRpc } from "./sendKeys";

export interface ToolkitDevice {
  deviceName?: string | null;
  version?: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface ToolkitDeviceRow {
  code: string;
  name: string;
  ungetId?: string | null;
  ungetName?: string | null;
  /** Más reciente primero. */
  devices: ToolkitDevice[];
}

export type DeviceState = "current" | "outdated" | "none";

export const DEVICE_STATE_LABEL: Record<DeviceState, string> = {
  current: "Al día",
  outdated: "Desactualizado",
  none: "Sin reportar",
};

/** Una PC que no reporta en este tiempo deja de contar para el establecimiento. */
export const REPORT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compara versiones como números: 2.2.0 es más nueva que 2.1.10. */
export const compareVersions = (a?: string | null, b?: string | null): number => {
  const pa = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

/** PC que reportaron en los últimos 30 días, la más reciente primero. */
export const activeDevices = (row: ToolkitDeviceRow, now: Date = new Date()): ToolkitDevice[] =>
  row.devices.filter((d) => d.lastSeen && now.getTime() - new Date(d.lastSeen).getTime() <= REPORT_WINDOW_DAYS * DAY_MS);

/**
 * Estado del establecimiento según la PC que lo envió por última vez. Sin versión publicada
 * conocida, cualquier PC que reporta cuenta como al día.
 */
export const deviceState = (row: ToolkitDeviceRow, latest: string | null, now: Date = new Date()): DeviceState => {
  const device = activeDevices(row, now)[0];
  if (!device) return "none";
  if (!latest) return "current";
  if (!device.version) return "outdated";
  return compareVersions(device.version, latest) >= 0 ? "current" : "outdated";
};

export interface DeviceSummary {
  reporting: number;
  current: number;
  outdated: number;
  none: number;
}

export const summarizeDevices = (rows: ToolkitDeviceRow[], latest: string | null, now: Date = new Date()): DeviceSummary => {
  const summary: DeviceSummary = { reporting: 0, current: 0, outdated: 0, none: 0 };
  rows.forEach((row) => {
    const state = deviceState(row, latest, now);
    summary[state] += 1;
    if (state !== "none") summary.reporting += 1;
  });
  return summary;
};

export type DeviceFilter = "all" | DeviceState;

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Búsqueda y filtro. Primero los desactualizados, luego sin reportar, luego al día. */
export const filterDevices = (
  rows: ToolkitDeviceRow[],
  latest: string | null,
  search: string,
  filter: DeviceFilter,
  now: Date = new Date(),
): ToolkitDeviceRow[] => {
  const needle = normalize(search);
  const order: Record<DeviceState, number> = { outdated: 0, none: 1, current: 2 };
  return rows
    .filter((row) => {
      const state = deviceState(row, latest, now);
      if (filter !== "all" && state !== filter) return false;
      if (!needle) return true;
      const pcs = row.devices.map((d) => d.deviceName || "").join(" ");
      return normalize(`${row.name} ${row.code} ${pcs}`).includes(needle);
    })
    .sort((a, b) =>
      order[deviceState(a, latest, now)] - order[deviceState(b, latest, now)]
      || a.name.localeCompare(b.name, "es", { numeric: true }));
};

const RELEASES_URL = "https://api.github.com/repos/jchaconv94/ToolkitSISMED/releases?per_page=20";
const TAG = /^desktop-v(\d+(?:\.\d+){1,3})$/i;

/** Última versión de escritorio publicada en una lista de releases de GitHub. */
export const latestDesktopVersion = (releases: unknown): string | null => {
  if (!Array.isArray(releases)) return null;
  let latest: string | null = null;
  releases.forEach((release: any) => {
    if (!release || release.draft || release.prerelease) return;
    const match = TAG.exec(String(release.tag_name || ""));
    if (match && (!latest || compareVersions(match[1], latest) > 0)) latest = match[1];
  });
  return latest;
};

export const toolkitDevicesApi = {
  overview: async (): Promise<ToolkitDeviceRow[]> => {
    const rows = await callSendKeysRpc<ToolkitDeviceRow[] | null>("app_toolkit_devices_overview", {}, "SUPABASE_EQUIPOS_TOOLKIT.sql");
    return (rows || []).map((row) => ({ ...row, devices: Array.isArray(row.devices) ? row.devices : [] }));
  },
  /** Si GitHub no responde, la pestaña sigue funcionando sin comparar versiones. */
  latestRelease: async (): Promise<string | null> => {
    try {
      const response = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) return null;
      return latestDesktopVersion(await response.json());
    } catch {
      return null;
    }
  },
};
