/**
 * Módulo «Backups SISMED» (etapa 4): reglas de la pantalla, sin nada visual, para probarlas.
 *
 * Una fila junta tres fuentes: la lista de Supabase (app_backup_overview: establecimientos que
 * pueden enviar backup, último descargado y cupo del día), las PC conectadas ahora (servicio de
 * Cloudflare) y el pedido en curso de esa persona, si hay.
 */

import type { BackupCopyRow, BackupQuota, OnlinePc, SeenPc, UsageItem, UsageReading } from "./backupConnection";
import type { Tone } from "../components/ui/kit";
import { compareVersions } from "./toolkitDevices";

export interface BackupOverviewRow {
  code: string;
  name: string;
  ungetId?: string | null;
  ungetName?: string | null;
  /** Último backup descargado (cualquier usuario). */
  lastAt?: string | null;
  lastBy?: string | null;
  /** Pedidos de hoy del establecimiento, de todos los usuarios (en curso o descargados). */
  today: number;
  /** Los de hoy de quien consulta: el cupo es por usuario. Sin el SQL nuevo no llega. */
  mine?: number;
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
  /** Nombre del establecimiento, para el nombre del archivo y el panel de descargas. */
  facility?: string;
  /** Es la descarga de la copia del día: no hay paso de subida. */
  copy?: boolean;
  /** Desde cuándo y desde cuántos bytes se mide la velocidad del paso en curso. */
  phaseAt?: number;
  phaseBase?: number;
  at: number;
}

export const ACTIVE_PHASES: JobPhase[] = ["requested", "uploading", "downloading", "saving"];
export const isActive = (job?: BackupJobView | null) => Boolean(job && ACTIVE_PHASES.includes(job.phase));

/**
 * Avance de un pedido en una sola barra, de 0 a 100 %, que nunca retrocede.
 *
 * El pedido tiene dos tramos: la PC sube el backup a la nube y después el navegador lo baja.
 * Antes cada tramo llenaba su propia barra: la subida (rápida) llegaba al 100 % y la barra
 * volvía a cero para la descarga, y parecía que ya había terminado (2026-10-16). Ahora la
 * subida es la primera mitad y la descarga la segunda.
 */
export const jobProgress = (job: BackupJobView): { pct: number | null; step: 1 | 2 | null } => {
  const part = (value = 0) => (job.size ? Math.min(1, Math.max(0, value / job.size)) : 0);
  if (job.phase === "uploading") return { pct: Math.floor(part(job.sent) * 50), step: 1 };
  // La copia del día ya está en la nube: solo se descarga, de 0 a 100 %.
  if (job.phase === "downloading" && job.copy) return { pct: Math.floor(part(job.received) * 100), step: null };
  if (job.phase === "downloading") return { pct: 50 + Math.floor(part(job.received) * 50), step: 2 };
  if (job.phase === "saving") return { pct: 100, step: 2 };
  return { pct: null, step: null };
};

const doneOf = (job: BackupJobView) =>
  job.phase === "uploading" ? job.sent || 0 : job.phase === "downloading" ? job.received || 0 : 0;

/**
 * Anota desde cuándo se mide la velocidad: al empezar cada paso (subida o descarga). Si en el
 * primer segundo llega un salto (al volver a entrar, el servicio reenvía lo que ya se subió),
 * se vuelve a medir desde ahí para no mostrar una velocidad imposible.
 */
export const trackPhase = (previous: BackupJobView, next: BackupJobView, now: number): BackupJobView => {
  const restart = next.phase !== previous.phase || next.phaseAt == null;
  const burst = !restart && doneOf(next) !== doneOf(previous) && now - (next.phaseAt ?? now) < 1000;
  return restart || burst ? { ...next, phaseAt: now, phaseBase: doneOf(next) } : next;
};

/** Velocidad del paso en curso y lo que le falta. Sin datos suficientes (menos de 3 s), nada. */
export const jobSpeed = (job: BackupJobView, now: number = Date.now()): { mbps: number; secondsLeft: number } | null => {
  if ((job.phase !== "uploading" && job.phase !== "downloading") || !job.size || job.phaseAt == null) return null;
  const elapsed = (now - job.phaseAt) / 1000;
  const moved = doneOf(job) - (job.phaseBase || 0);
  if (elapsed < 3 || moved <= 0) return null;
  const rate = moved / elapsed;
  return { mbps: (rate * 8) / 1e6, secondsLeft: Math.max(0, (job.size - doneOf(job)) / rate) };
};

/** «2,1 Mbps · faltan ~4 min» */
export const speedLabel = ({ mbps, secondsLeft }: { mbps: number; secondsLeft: number }) =>
  `${mbps < 10 ? mbps.toFixed(1).replace(".", ",") : Math.round(mbps)} Mbps · ${
    secondsLeft < 60 ? "falta menos de 1 min" : `faltan ~${Math.round(secondsLeft / 60)} min`
  }`;

/** Día calendario de Perú de una fecha (AAAA-MM-DD). */
export const limaDay = (value: string | number | Date) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Lima" });

const limaClock = (value: number) =>
  new Date(value).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });

/** Última conexión de una PC desconectada: «Hoy 10:31», «Ayer 17:40» o «02/10/2026 08:15». */
export const lastConnectionLabel = (at: number, now: number = Date.now()): string => {
  const day = limaDay(at);
  if (day === limaDay(now)) return `Hoy ${limaClock(at)}`;
  if (day === limaDay(now - 86400000)) return `Ayer ${limaClock(at)}`;
  const date = new Date(at).toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" });
  return `${date} ${limaClock(at)}`;
};

/**
 * «Copia de hoy 08:12», «Copia de ayer 08:12» o «Copia del 14/10 08:12». La hora es la de subida
 * a la nube, con el reloj del servicio: la fecha de la PC no sirve, porque a fin de mes la
 * adelantan para cerrar en el SISMED (antes salía «Copia del 25/10» siendo 17; 2026-10-18).
 */
export const copyLabel = (copy: Pick<BackupCopyRow, "uploadedAt">, now: number = Date.now()): string => {
  const day = limaDay(copy.uploadedAt);
  const time = limaClock(copy.uploadedAt);
  if (day === limaDay(now)) return `Copia de hoy ${time}`;
  if (day === limaDay(now - 86400000)) return `Copia de ayer ${time}`;
  return `Copia del ${day.slice(8, 10)}/${day.slice(5, 7)} ${time}`;
};

export interface BackupRowView extends BackupOverviewRow {
  online: boolean;
  /** En línea: la PC conectada. Desconectada: la última que se conectó, si se sabe. */
  equipo?: string;
  version?: string;
  /** En línea: su último ping. Desconectada: su última conexión, si el servicio la anotó. */
  lastSeen?: number;
  job?: BackupJobView;
  /** Copia del día en la nube, si hay: se baja aunque la PC esté apagada. */
  copy?: BackupCopyRow;
  downloadedToday: boolean;
  quotaUsed: boolean;
  /** El botón «Descargar» sirve: baja la copia si hay, o pide uno nuevo a la PC. */
  canDownload: boolean;
  /** Se puede pedir uno nuevo a la PC (en línea, con cupo y sin pausa por consumo). */
  canRequestNew: boolean;
}

export const buildBackupRows = (
  overview: BackupOverviewRow[],
  online: OnlinePc[],
  jobs: Record<string, BackupJobView>,
  paused: boolean,
  now: number = Date.now(),
  seen: Record<string, SeenPc> = {},
  copies: Record<string, BackupCopyRow> = {},
): BackupRowView[] => {
  const pcs = new Map(online.map((pc) => [pc.code, pc]));
  const today = limaDay(now);
  return overview.map((row) => {
    const pc = pcs.get(row.code);
    const last = pc ? undefined : seen[row.code];
    const job = jobs[row.code];
    const quotaUsed = (row.mine ?? row.today) >= row.limit;
    const copy = copies[row.code];
    const canRequestNew = Boolean(pc) && !isActive(job) && !quotaUsed && !paused;
    return {
      ...row,
      online: Boolean(pc),
      equipo: pc?.equipo ?? (last?.equipo || undefined),
      version: pc?.version ?? (last?.version || undefined),
      lastSeen: pc?.lastSeen ?? last?.at,
      job,
      copy,
      downloadedToday: Boolean(row.lastAt && limaDay(row.lastAt) === today),
      quotaUsed,
      // Bajar la copia no usa el cupo ni le pide nada a la PC (decisión del 2026-10-16).
      canDownload: copy ? !isActive(job) : canRequestNew,
      canRequestNew,
    };
  });
};

/**
 * Desde esta versión la PC sube sola cada backup nuevo del SISMED: la copia ya es el más reciente.
 *
 * La 2.3.10 ya intentaba subir cada uno, pero antes de ofrecerlo comprobaba el zip con un método
 * que no puede leer un zip con contraseña, y el del SISMED la tiene: lo daba por dañado y no subía
 * ninguno. La copia solo cambiaba cuando la web se lo pedía a la PC, y luego «Descargar» entregaba
 * esa copia vieja (caso del hospital: la del 19/10 hasta el 21/10). Corregido en el Toolkit 2.4.4.
 */
export const AUTO_COPY_VERSION = "2.4.4";

/**
 * Por debajo de esta versión la fila dice «actualizar» en ámbar. Sigue en la 2.3.10 hasta que se
 * publique la 2.4.4: antes no hay a qué actualizar. Al publicarla, igualarla a `AUTO_COPY_VERSION`.
 */
export const UPDATE_HINT_VERSION = "2.3.10";

/** Toolkit conocido y anterior a `UPDATE_HINT_VERSION`: la fila lo dice en ámbar con «actualizar». */
export const isOldToolkit = (version?: string): boolean =>
  Boolean(version) && compareVersions(version, UPDATE_HINT_VERSION) < 0;

/**
 * «Pedir a la PC» solo tiene sentido con copia en la nube y un Toolkit que no sube solo cada backup
 * nuevo: la 2.3.9 sube únicamente el de la mañana y de la 2.3.10 a la 2.4.3 no sube ninguno (ver
 * `AUTO_COPY_VERSION`). Con un Toolkit que sí los sube la copia ya es el último backup y el botón
 * sobra (decisión del usuario del 2026-10-18); sin copia, «Descargar» ya se lo pide a la PC.
 */
export const asksPcForNewer = (row: Pick<BackupRowView, "copy" | "version">): boolean =>
  Boolean(row.copy) && compareVersions(row.version, AUTO_COPY_VERSION) < 0;

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

// El filtro por UNGET se comparte con Claves de envío: vive en `ungetFilter.ts`.
export { ungetKeyOf, ungetOptions, rowsOfUnget, type UngetOption } from "./ungetFilter";

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
export const planState = (usage: UsageReading | null): { value: string; tone: Tone; ratio: number | null; hint: string } => {
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
  status: "REQUESTED" | "UPLOADING" | "READY" | "DOWNLOADED" | "FAILED" | "EXPIRED" | "COPY_DOWNLOADED";
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

/** Motivo con que el servicio cierra un pedido atendido con la copia de la nube (`cloudflare/conexion`). */
export const REUSED_REASON = "Ya estaba en la nube";

/** Un pedido del registro, como línea de la actividad. */
export const activityFromRequest = (row: BackupActivityRow, me?: string | null): ActivityItem => {
  const mine = row.username === me;
  const pedido = mine ? "lo pediste tú" : `lo pidió ${row.username}`;
  const base = { key: `${row.id}-${row.status}`, at: new Date(row.at).getTime() };
  switch (row.status) {
    case "COPY_DOWNLOADED":
      return { ...base, kind: "download", tone: "ok", text: `${row.code} · copia de la nube ${row.fileName || ""}${row.size ? ` (${megabytes(row.size)})` : ""} · ${mine ? "la descargaste tú" : `la descargó ${row.username}`}` };
    case "DOWNLOADED":
      return { ...base, kind: "download", tone: "ok", text: `${row.code} · ${row.fileName || "backup"}${row.size ? ` (${megabytes(row.size)})` : ""} · ${mine ? "lo descargaste tú" : `lo descargó ${row.username}`}` };
    case "FAILED":
      // El servicio lo atendió con la copia de la nube, sin volver a subirlo (2026-10-18).
      if (row.reason?.startsWith(REUSED_REASON)) return { ...base, kind: "download", tone: "info", text: `${row.code} · ya estaba en la nube: se bajó la copia · ${pedido}` };
      return { ...base, kind: "warning", tone: "warn", text: `${row.code} · falló: ${row.reason || "sin detalle"} · ${pedido}` };
    case "EXPIRED":
      return { ...base, kind: "warning", tone: "warn", text: `${row.code} · venció sin descargarse · ${pedido}` };
    default:
      return { ...base, kind: "download", tone: "info", text: `${row.code} · en curso · ${pedido}` };
  }
};

// --- Abrir una pestaña desde fuera --------------------------------------------------------

/**
 * La campana de avisos abre el módulo directamente en «Consumo». Queda anotado para cuando
 * el módulo se monte y, si ya estaba abierto, se le avisa con un evento.
 */
let requestedTab: "consumo" | null = null;
export const BACKUPS_TAB_EVENT = "backups-sismed:tab";

export const requestBackupsTab = (tab: "consumo") => {
  requestedTab = tab;
  try { window.dispatchEvent(new CustomEvent(BACKUPS_TAB_EVENT, { detail: tab })); } catch { /* sin ventana */ }
};

export const takeRequestedBackupsTab = (): "consumo" | null => {
  const tab = requestedTab;
  requestedTab = null;
  return tab;
};
