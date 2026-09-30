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
 *
 * La versión del SISMED la lee el Toolkit de DATOS\MCONFIG.DBF (fila SIS / AB) y la manda en
 * la misma consulta (`supabase/SUPABASE_EQUIPOS_SISMED.sql`). Como del SISMED no hay un sitio
 * oficial que diga cuál es la última, se toma como vigente la más alta que reporte alguna PC.
 */

import { callSendKeysRpc } from "./sendKeys";

export interface ToolkitDevice {
  deviceName?: string | null;
  version?: string | null;
  /** Valor tal cual está en MCONFIG, p. ej. `V2.5.3 vf 12/01/2026`. */
  sismedRaw?: string | null;
  /** `2.5.3`, separado del valor anterior por la base. */
  sismedVersion?: string | null;
  /** `2026-01-12`. */
  sismedDate?: string | null;
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

/** La versión de SISMED más alta que reporta alguna PC activa: es la que se toma como vigente. */
export const latestSismedVersion = (rows: ToolkitDeviceRow[], now: Date = new Date()): string | null => {
  let latest: string | null = null;
  rows.forEach((row) => activeDevices(row, now).forEach((d) => {
    if (d.sismedVersion && (!latest || compareVersions(d.sismedVersion, latest) > 0)) latest = d.sismedVersion;
  }));
  return latest;
};

export type SismedState = "current" | "outdated" | "none";

/**
 * SISMED del establecimiento según la PC que lo envió por última vez. «none» si esa PC no
 * informó su SISMED (Toolkit anterior o MCONFIG ilegible).
 */
export const sismedState = (row: ToolkitDeviceRow, latestSismed: string | null, now: Date = new Date()): SismedState => {
  const device = activeDevices(row, now)[0];
  if (!device?.sismedVersion) return "none";
  if (!latestSismed) return "current";
  return compareVersions(device.sismedVersion, latestSismed) >= 0 ? "current" : "outdated";
};

/** Versiones de SISMED que envían las PC activas, la más nueva primero, para el filtro. */
export const sismedVersionsInUse = (rows: ToolkitDeviceRow[], now: Date = new Date()): string[] => {
  const versions = new Set<string>();
  rows.forEach((row) => {
    const version = activeDevices(row, now)[0]?.sismedVersion;
    if (version) versions.add(version);
  });
  return Array.from(versions).sort((a, b) => compareVersions(b, a));
};

export interface DeviceSummary {
  reporting: number;
  current: number;
  outdated: number;
  none: number;
  sismedOutdated: number;
}

export const summarizeDevices = (
  rows: ToolkitDeviceRow[],
  latest: string | null,
  now: Date = new Date(),
  latestSismed: string | null = latestSismedVersion(rows, now),
): DeviceSummary => {
  const summary: DeviceSummary = { reporting: 0, current: 0, outdated: 0, none: 0, sismedOutdated: 0 };
  rows.forEach((row) => {
    const state = deviceState(row, latest, now);
    summary[state] += 1;
    if (state !== "none") summary.reporting += 1;
    if (sismedState(row, latestSismed, now) === "outdated") summary.sismedOutdated += 1;
  });
  return summary;
};

export type DeviceFilter = "all" | DeviceState;

/** Filtro de SISMED: todas, las desactualizadas, sin dato o una versión concreta (`v:2.5.3`). */
export type SismedFilter = "all" | "outdated" | "none" | `v:${string}`;

const matchesSismed = (row: ToolkitDeviceRow, filter: SismedFilter, latestSismed: string | null, now: Date): boolean => {
  if (filter === "all") return true;
  if (filter === "outdated" || filter === "none") return sismedState(row, latestSismed, now) === filter;
  return activeDevices(row, now)[0]?.sismedVersion === filter.slice(2);
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Búsqueda y filtro. Primero los desactualizados, luego sin reportar, luego al día. */
export const filterDevices = (
  rows: ToolkitDeviceRow[],
  latest: string | null,
  search: string,
  filter: DeviceFilter,
  now: Date = new Date(),
  sismedFilter: SismedFilter = "all",
  latestSismed: string | null = latestSismedVersion(rows, now),
): ToolkitDeviceRow[] => {
  const needle = normalize(search);
  const order: Record<DeviceState, number> = { outdated: 0, none: 1, current: 2 };
  return rows
    .filter((row) => {
      const state = deviceState(row, latest, now);
      if (filter !== "all" && state !== filter) return false;
      if (!matchesSismed(row, sismedFilter, latestSismed, now)) return false;
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
