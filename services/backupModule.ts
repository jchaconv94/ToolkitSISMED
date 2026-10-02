/**
 * Módulo «Backups SISMED» (etapa 4): reglas de la pantalla, sin nada visual, para probarlas.
 *
 * Una fila junta tres fuentes: la lista de Supabase (app_backup_overview: establecimientos que
 * pueden enviar backup, último descargado y cupo del día), las PC conectadas ahora (servicio de
 * Cloudflare) y el pedido en curso de esa persona, si hay.
 */

import type { BackupQuota, OnlinePc, UsageItem, UsageReading } from "./backupConnection";
import type { ImmunizationTone } from "../components/ui/immunization";

export interface BackupOverviewRow {
  code: string;
  name: string;
  ungetId?: string | null;
  ungetName?: string | null;
  /** Último backup descargado (cualquier usuario). */
  lastAt?: string | null;
  lastBy?: string | null;
  /** Pedidos de hoy que cuentan para el cupo (en curso o descargados). */
  today: number;
  limit: number;
}

export type JobPhase = "requested" | "uploading" | "downloading" | "saving" | "done" | "failed";

/** Un pedido de backup visto desde la web. */
export interface BackupJobView {
  code: string;
  job?: string;
  phase: JobPhase;
  failure?: "quota" | "paused" | "error";
  name?: string;
  size?: number;
  /** Bytes que subió la PC. */
  sent?: number;
  /** Bytes que ya bajó el navegador. */
  received?: number;
  detail?: string;
  quota?: BackupQuota;
  /** Dónde quedó guardado: nombre de la carpeta elegida o «Descargas». */
  savedIn?: string;
  savedName?: string;
  at: number;
}

export const ACTIVE_PHASES: JobPhase[] = ["requested", "uploading", "downloading", "saving"];
export const isActive = (job?: BackupJobView | null) => Boolean(job && ACTIVE_PHASES.includes(job.phase));

/** Día calendario de Perú de una fecha (AAAA-MM-DD). */
export const limaDay = (value: string | number | Date) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Lima" });

export interface BackupRowView extends BackupOverviewRow {
  online: boolean;
  equipo?: string;
  version?: string;
  lastSeen?: number;
  job?: BackupJobView;
  downloadedToday: boolean;
  quotaUsed: boolean;
  canDownload: boolean;
}

export const buildBackupRows = (
  overview: BackupOverviewRow[],
  online: OnlinePc[],
  jobs: Record<string, BackupJobView>,
  paused: boolean,
  now: number = Date.now(),
): BackupRowView[] => {
  const pcs = new Map(online.map((pc) => [pc.code, pc]));
  const today = limaDay(now);
  return overview.map((row) => {
    const pc = pcs.get(row.code);
    const job = jobs[row.code];
    const quotaUsed = row.today >= row.limit;
    return {
      ...row,
      online: Boolean(pc),
      equipo: pc?.equipo,
      version: pc?.version,
      lastSeen: pc?.lastSeen,
      job,
      downloadedToday: Boolean(row.lastAt && limaDay(row.lastAt) === today),
      quotaUsed,
      canDownload: Boolean(pc) && !isActive(job) && !quotaUsed && !paused,
    };
  });
};

export type ShowFilter = "all" | "online" | "ready" | "today" | "offline";

export const SHOW_FILTER_LABEL: Record<ShowFilter, string> = {
  all: "Todos",
  online: "En línea",
  ready: "Para descargar",
  today: "Descargados hoy",
  offline: "Desconectados",
};

const matches = (row: BackupRowView, filter: ShowFilter) =>
  filter === "all" ? true
    : filter === "online" ? row.online
      : filter === "ready" ? row.canDownload
        : filter === "today" ? row.downloadedToday
          : !row.online;

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** En línea primero, luego por nombre. */
export const filterBackupRows = (rows: BackupRowView[], search: string, filter: ShowFilter): BackupRowView[] => {
  const needle = normalize(search);
  return rows
    .filter((row) => matches(row, filter) && (!needle || normalize(`${row.name} ${row.code} ${row.equipo || ""}`).includes(needle)))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "es", { numeric: true }));
};

export const showFilterCounts = (rows: BackupRowView[]) =>
  Object.fromEntries((Object.keys(SHOW_FILTER_LABEL) as ShowFilter[]).map((f) => [f, rows.filter((r) => matches(r, f)).length])) as Record<ShowFilter, number>;

export const STALE_DAYS = 7;

export interface BackupSummary {
  total: number;
  online: number;
  downloadedToday: number;
  /** Sin backup descargado en los últimos 7 días (o nunca). */
  stale: number;
}

export const summarizeBackups = (rows: BackupRowView[], now: number = Date.now()): BackupSummary => {
  const limit = now - STALE_DAYS * 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    online: rows.filter((r) => r.online).length,
    downloadedToday: rows.filter((r) => r.downloadedToday).length,
    stale: rows.filter((r) => !r.lastAt || new Date(r.lastAt).getTime() < limit).length,
  };
};

/** Estado del plan gratuito para quien no es administrador: sin cifras de Cloudflare. */
export const planState = (usage: UsageReading | null): { value: string; tone: ImmunizationTone; ratio: number | null; hint: string } => {
  const ratio = usage?.worst?.ratio ?? null;
  if (!usage || usage.level === "unknown") return { value: "Sin medición", tone: "neutral", ratio: null, hint: "aún no se pudo medir" };
  if (usage.level === "paused") return { value: "Pausado", tone: "danger", ratio, hint: "las descargas están en pausa" };
  if (usage.level === "warn") return { value: "Cerca del tope", tone: "warning", ratio, hint: "al 80 % se pausan las descargas" };
  return { value: "Disponible", tone: "info", ratio, hint: "se pausa al 80 %" };
};

/** Quién descargó, dicho para la persona: «tú» si fue ella. */
export const whoLabel = (by: string | null | undefined, me: string | null | undefined) =>
  !by ? "" : by === me ? "tú" : by;

// --- Actividad --------------------------------------------------------------------------

export interface BackupActivityRow {
  id: string;
  code: string;
  name?: string | null;
  username: string;
  status: "REQUESTED" | "UPLOADING" | "READY" | "DOWNLOADED" | "FAILED" | "EXPIRED";
  fileName?: string | null;
  size?: number | null;
  reason?: string | null;
  equipo?: string | null;
  at: string;
}

export type ActivityKind = "download" | "warning" | "connection";

export interface ActivityItem {
  key: string;
  at: number;
  kind: ActivityKind;
  tone: "ok" | "warn" | "info";
  text: string;
}

const megabytes = (bytes?: number | null) =>
  bytes ? `${(bytes / 1048576).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB` : "";

/** Un pedido del registro, como línea de la actividad. */
export const activityFromRequest = (row: BackupActivityRow, me?: string | null): ActivityItem => {
  const mine = row.username === me;
  const pedido = mine ? "lo pediste tú" : `lo pidió ${row.username}`;
  const base = { key: `${row.id}-${row.status}`, at: new Date(row.at).getTime() };
  switch (row.status) {
    case "DOWNLOADED":
      return { ...base, kind: "download", tone: "ok", text: `${row.code} · ${row.fileName || "backup"}${row.size ? ` (${megabytes(row.size)})` : ""} · ${mine ? "lo descargaste tú" : `lo descargó ${row.username}`}` };
    case "FAILED":
      return { ...base, kind: "warning", tone: "warn", text: `${row.code} · falló: ${row.reason || "sin detalle"} · ${pedido}` };
    case "EXPIRED":
      return { ...base, kind: "warning", tone: "warn", text: `${row.code} · venció sin descargarse · ${pedido}` };
    default:
      return { ...base, kind: "download", tone: "info", text: `${row.code} · en curso · ${pedido}` };
  }
};
