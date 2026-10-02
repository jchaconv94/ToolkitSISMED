/**
 * Reglas del servicio de conexión que no dependen de Cloudflare, para poder probarlas.
 */

/** Establecimiento aceptado para una PC (lo devuelve app_backup_pc_auth). */
export interface PcCode {
  code: string;
  ungetId: string | null;
  name: string;
}

/** Lo que el servicio recuerda de cada conexión (cabe en el adjunto de 2 KB del socket). */
export interface PcInfo {
  role: "pc";
  codes: PcCode[];
  device: string;
  equipo: string;
  version: string;
  since: number;
}

export interface WebInfo {
  role: "web";
  id: string;
  username: string;
  isAdmin: boolean;
  ungetIds: string[];
  /** Sesión con la que entró; el servicio la usa para registrar sus pedidos en Supabase. */
  token: string;
}

/** Una PC sin «ping» en este tiempo se da por desconectada aunque el socket siga abierto. */
export const PC_SILENCE_MS = 150_000;

/** Clave de envío por código: «030S05-XXXX-XXXX-XXXX» → 030S05. Igual que el Toolkit. */
export const keysByCode = (value: string | null | undefined): Record<string, string> => {
  const mapping: Record<string, string> = {};
  String(value || "")
    .split(/[\s,;]+/)
    .map((k) => k.replace(/\s/g, "").toUpperCase())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((key) => {
      const code = key.split("-")[0];
      if (/^[0-9A-Z]{5,6}$/.test(code)) mapping[code] = key;
    });
  return mapping;
};

/** ¿Puede este usuario de la web ver (y pedirle cosas a) este establecimiento? */
export const canSee = (web: Pick<WebInfo, "isAdmin" | "ungetIds">, code: Pick<PcCode, "ungetId">): boolean =>
  web.isAdmin || (code.ungetId != null && web.ungetIds.includes(code.ungetId));

/** ¿Sigue viva la PC? `lastPing` es la hora del último «ping» que respondió el servicio. */
export const isAlive = (pc: Pick<PcInfo, "since">, lastPing: number | null, now: number): boolean =>
  now - Math.max(pc.since, lastPing ?? 0) <= PC_SILENCE_MS;

export interface OnlineRow {
  code: string;
  name: string;
  ungetId: string | null;
  equipo: string;
  version: string;
  since: number;
  lastSeen: number;
}

/** Lista de establecimientos conectados que ve un usuario, uno por fila. */
export const onlineFor = (
  web: Pick<WebInfo, "isAdmin" | "ungetIds">,
  pcs: Array<{ info: PcInfo; lastPing: number | null }>,
  now: number,
): OnlineRow[] => {
  const rows = new Map<string, OnlineRow>();
  pcs.forEach(({ info, lastPing }) => {
    if (!isAlive(info, lastPing, now)) return;
    const lastSeen = Math.max(info.since, lastPing ?? 0);
    info.codes.forEach((c) => {
      if (!canSee(web, c)) return;
      const previous = rows.get(c.code);
      if (previous && previous.lastSeen >= lastSeen) return;
      rows.set(c.code, { code: c.code, name: c.name, ungetId: c.ungetId, equipo: info.equipo, version: info.version, since: info.since, lastSeen });
    });
  });
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
};

// ---------------------------------------------------------------------------------------
//  Backups (etapa 2)
// ---------------------------------------------------------------------------------------

/** Tamaño de cada parte que sube el Toolkit. R2 exige al menos 5 MiB salvo en la última. */
export const BACKUP_PART_SIZE = 20 * 1024 * 1024;
/** Un backup que nadie descargó se borra a la hora (la regla del bucket lo haría al día). */
export const BACKUP_TTL_MS = 60 * 60 * 1000;
/** Tamaño máximo aceptado: el hospital pesa 70–150 MB; se deja margen. */
export const BACKUP_MAX_BYTES = 600 * 1024 * 1024;

export type BackupStatus = "requested" | "uploading" | "ready" | "failed";

export interface BackupJob {
  id: string;
  code: string;
  web: string;
  /** Sesión de quien lo pidió: solo esa persona actualiza el pedido en Supabase. */
  webToken: string;
  /** Quién lo pidió: si recarga la página o vuelve a entrar, el pedido se le vuelve a mostrar. */
  username: string;
  /** Bytes que la PC ya subió (para mostrar el avance al volver). */
  sent?: number;
  /** Enlace de descarga, cuando ya está en la nube. */
  downloadUrl?: string;
  uploadToken: string;
  downloadToken: string;
  status: BackupStatus;
  createdAt: number;
  name?: string;
  size?: number;
  sha256?: string;
  modified?: string;
  key?: string;
  uploadId?: string;
  reason?: string;
}

/** Nombre del zip como lo genera el SISMED: BKDA<AAAAMMDD><HHMM>.zip (o BKDH…). */
export const isBackupName = (name: unknown): name is string =>
  typeof name === "string" && /^BKD[AH]\d{8,12}\.zip$/i.test(name);

/** Dónde vive el zip en R2 mientras está de paso. */
export const backupKey = (job: Pick<BackupJob, "id" | "code">, name: string) => `backups/${job.code}/${job.id}/${name}`;

export const isExpired = (job: Pick<BackupJob, "createdAt">, now: number) => now - job.createdAt > BACKUP_TTL_MS;

/** Datos del backup que manda el Toolkit, validados. */
export const parseBackupMeta = (data: any): { name: string; size: number; sha256: string; modified: string } | null => {
  if (!data || !isBackupName(data.name)) return null;
  const size = Number(data.size);
  if (!Number.isFinite(size) || size <= 0 || size > BACKUP_MAX_BYTES) return null;
  if (typeof data.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(data.sha256)) return null;
  return { name: data.name, size, sha256: data.sha256.toLowerCase(), modified: String(data.modified || "").slice(0, 40) };
};

// ---------------------------------------------------------------------------------------
//  Consumo del plan gratuito (etapa 3)
// ---------------------------------------------------------------------------------------

/** Por encima de esto se avisa; desde PAUSE se rechazan pedidos nuevos. */
export const USAGE_WARN = 0.7;
export const USAGE_PAUSE = 0.8;
/** Cada cuánto se vuelve a preguntar a Cloudflare (solo si alguien lo necesita). */
export const USAGE_REFRESH_MS = 10 * 60 * 1000;

export type UsageKey = "workers" | "doRequests" | "doDuration" | "r2ClassA" | "r2ClassB" | "r2Storage";

/**
 * Límites gratuitos (documentación de Cloudflare, 2026-10). Los diarios vuelven a cero a
 * las 00:00 UTC; los de R2, cada mes. En Workers y Durable Objects el plan gratuito no
 * cobra: al pasarse, falla. Lo único que podría cobrar es R2.
 */
export const FREE_LIMITS: Record<UsageKey, { label: string; limit: number; period: "day" | "month" }> = {
  workers: { label: "Peticiones al servicio (día)", limit: 100_000, period: "day" },
  doRequests: { label: "Mensajes de conexión (día)", limit: 100_000, period: "day" },
  doDuration: { label: "Tiempo activo, GB-s (día)", limit: 13_000, period: "day" },
  r2ClassA: { label: "R2 escrituras, clase A (mes)", limit: 1_000_000, period: "month" },
  r2ClassB: { label: "R2 lecturas, clase B (mes)", limit: 10_000_000, period: "month" },
  r2Storage: { label: "R2 almacenamiento, GB", limit: 10, period: "month" },
};

export interface UsageItem {
  key: UsageKey;
  label: string;
  used: number | null;
  limit: number;
  /** used / limit; null si Cloudflare no respondió ese dato. */
  ratio: number | null;
}

export type UsageLevel = "ok" | "warn" | "paused" | "unknown";

export interface UsageReading {
  at: number;
  items: UsageItem[];
  level: UsageLevel;
  /** El dato más alto, para el aviso. */
  worst: UsageItem | null;
  /** Mensajes de conexión por día (UTC), los últimos 7, para el gráfico del administrador. */
  daily?: Array<{ date: string; requests: number }>;
  error?: string;
}

/** Operaciones de R2 por clase, según la tabla de precios. Lo que no es B ni gratis, es A. */
const R2_CLASS_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
const R2_FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);

export const r2OperationClass = (actionType: string): "A" | "B" | "free" =>
  R2_FREE.has(actionType) ? "free" : R2_CLASS_B.has(actionType) ? "B" : "A";

export const utcDayStart = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const utcMonthStart = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

/** Arma la lectura a partir de lo que respondió Cloudflare (null = ese dato falló). */
export const buildUsage = (
  values: Partial<Record<UsageKey, number | null>>,
  now: number,
  error?: string,
  daily?: Array<{ date: string; requests: number }>,
): UsageReading => {
  const items = (Object.keys(FREE_LIMITS) as UsageKey[]).map((key) => {
    const { label, limit } = FREE_LIMITS[key];
    const raw = values[key];
    const used = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return { key, label, used, limit, ratio: used == null ? null : used / limit };
  });
  const known = items.filter((i) => i.ratio != null);
  const worst = known.reduce<UsageItem | null>((top, i) => (!top || (i.ratio as number) > (top.ratio as number) ? i : top), null);
  const top = worst?.ratio ?? null;
  const level: UsageLevel = top == null ? "unknown" : top >= USAGE_PAUSE ? "paused" : top >= USAGE_WARN ? "warn" : "ok";
  return { at: now, items, level, worst, ...(daily ? { daily } : {}), ...(error ? { error } : {}) };
};

/**
 * ¿Se acepta un pedido nuevo? Solo se pausa con una lectura que diga 80 % o más. Si
 * Cloudflare no responde se deja pasar: en Workers pasarse no cobra, y R2 tiene además
 * la regla de borrado a 1 día y la alerta de $1.
 */
export const usageBlocks = (reading: UsageReading | null) => reading?.level === "paused";

/** Texto del aviso para la web. */
export const usageMessage = (reading: UsageReading | null): string | null => {
  if (!reading || !reading.worst || reading.level === "ok" || reading.level === "unknown") return null;
  const pct = Math.round((reading.worst.ratio as number) * 100);
  const when = FREE_LIMITS[reading.worst.key].period === "day" ? "mañana a las 19:00 (hora de Perú)" : "el 1 del próximo mes";
  return reading.level === "paused"
    ? `Pausado para no salir de lo gratuito: ${reading.worst.label} al ${pct} %. Se reanuda ${when}.`
    : `Atención: ${reading.worst.label} al ${pct} % de lo gratuito. Al 80 % se pausan los pedidos.`;
};

// ---------------------------------------------------------------------------------------
//  Cupo de descargas por día (etapa 3; lo cuenta Supabase, app_backup_request_start)
// ---------------------------------------------------------------------------------------

export interface Quota {
  ok: boolean;
  limit: number;
  used: number;
  last?: { username: string; status: string; at: string } | null;
}

const limaTime = (at: string) =>
  new Date(at).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });

/** Por qué no se pudo pedir, dicho para la persona. */
export const quotaMessage = (quota: Quota): string => {
  const cupo = quota.limit === 1 ? "1 backup por día" : `${quota.limit} backups por día`;
  const last = quota.last;
  if (last && last.status !== "DOWNLOADED") {
    const admite = quota.limit === 1 ? "Se admite 1 backup por día" : `Se admiten ${quota.limit} backups por día`;
    return `Ya hay un backup de este establecimiento en curso: lo pidió ${last.username} a las ${limaTime(last.at)}. ${admite}.`;
  }
  const who = last ? `; el último lo descargó ${last.username} a las ${limaTime(last.at)}` : "";
  return `Hoy ya se usó el cupo de este establecimiento (${cupo})${who}. Se podrá pedir otro mañana.`;
};

/**
 * Lo que ve cada uno del consumo: el administrador, todo; los demás, solo el estado (cuánto
 * falta para la pausa), sin las cifras de Cloudflare.
 */
export const usageFor = (reading: UsageReading, isAdmin: boolean): UsageReading =>
  isAdmin ? reading : {
    at: reading.at,
    level: reading.level,
    items: [],
    worst: reading.worst ? { ...reading.worst, used: null, limit: 0 } : null,
  };

/** Mensajes que hay que volver a mandar a la web para que muestre un pedido en curso. */
export const jobMessages = (job: Pick<BackupJob, "id" | "code" | "status" | "name" | "size" | "sha256" | "modified" | "sent" | "downloadUrl">): unknown[] => {
  const base = { job: job.id, code: job.code };
  const messages: unknown[] = [{ t: "backup_requested", ...base }];
  if (job.name && job.size) {
    messages.push({ t: "backup_meta", ...base, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified });
    if (job.status === "uploading" && job.sent) messages.push({ t: "backup_progress", ...base, sent: job.sent, total: job.size });
  }
  if (job.status === "ready" && job.downloadUrl) {
    messages.push({ t: "backup_ready", ...base, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified, downloadUrl: job.downloadUrl });
  }
  return messages;
};
