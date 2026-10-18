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

/**
 * Última conexión de un establecimiento que ya no está en línea. Se anota cuando su PC se
 * desconecta: el servicio solo conoce las conectadas, y sin esto la web no podía decir
 * desde cuándo falta una PC.
 */
export interface SeenRow {
  code: string;
  name: string;
  ungetId: string | null;
  equipo: string;
  version: string;
  /** Último momento en que se supo de la PC (ms). */
  at: number;
}

/** La última conexión que dejó cada código de una PC que se va. */
export const seenRowsFor = (info: PcInfo, codes: PcCode[], lastPing: number | null): SeenRow[] =>
  codes.map((c) => ({
    code: c.code, name: c.name, ungetId: c.ungetId ?? null, equipo: info.equipo, version: info.version,
    at: Math.max(info.since, lastPing ?? 0),
  }));

/** Las últimas conexiones que puede ver un usuario (su jurisdicción, o todas si es admin). */
export const seenFor = (web: Pick<WebInfo, "isAdmin" | "ungetIds">, seen: SeenRow[]): SeenRow[] =>
  seen.filter((row) => canSee(web, row));

// ---------------------------------------------------------------------------------------
//  Backups (etapa 2)
// ---------------------------------------------------------------------------------------

/**
 * Tamaño de cada parte que sube el Toolkit. R2 exige al menos 5 MiB salvo en la última.
 *
 * Era 20 MiB. El Toolkit (`requests`) manda cada parte de un solo envío y, mientras envía,
 * solo espera el tiempo de conexión (15 s): una parte de 20 MiB exigía ~11 Mbps de subida, y
 * en el hospital, Barranca y Nuevo Lima fallaba con «The write operation timed out»
 * (2026-10-16). Con 5 MiB basta ~3 Mbps, sin cambiar el Toolkit de ninguna PC.
 */
export const BACKUP_PART_SIZE = 5 * 1024 * 1024;
/**
 * Lo más grande que se acepta por parte. Sigue en 20 MiB para no rechazar la subida de una
 * PC que recibió el tamaño anterior justo antes de publicar el cambio.
 */
export const BACKUP_PART_MAX_BYTES = 20 * 1024 * 1024;
/**
 * Partes que el Toolkit 2.3.8 o posterior sube a la vez, cada una por su conexión (de 1 a 8).
 * Una sola conexión no pasaba de ~0,5 Mbps en el Hospital II-E Bellavista, que mide 4,1 Mbps
 * de subida con varias (2026-10-16). Bajarlo aquí alivia la red del establecimiento sin sacar
 * otro Toolkit; los anteriores lo ignoran y suben de una en una.
 */
export const BACKUP_PARALLEL = 4;
/** Un backup que nadie descargó se borra a la hora (la regla del bucket lo haría al día). */
export const BACKUP_TTL_MS = 60 * 60 * 1000;
/** Tamaño máximo aceptado: el hospital pesa 70–150 MB; se deja margen. */
export const BACKUP_MAX_BYTES = 600 * 1024 * 1024;

export type BackupStatus = "requested" | "uploading" | "ready" | "failed";

/**
 * «request»: alguien pidió el backup y la PC lo sube (el de siempre; sin `kind` es este).
 *   Al terminar de subir pasa a ser la copia del establecimiento (`promoted`).
 * «copy»: la PC sube sola cada backup nuevo del SISMED y queda como copia del establecimiento.
 * «copy_download»: alguien baja esa copia; usa el mismo archivo, que no se borra al terminar.
 *   Si era un pedido y la PC informó el mismo backup que ya estaba en la nube, queda `reused`.
 */
export type BackupJobKind = "request" | "copy" | "copy_download";

export interface BackupJob {
  id: string;
  kind?: BackupJobKind;
  code: string;
  /** UNGET del establecimiento (copias): para saber quién puede verla con la PC apagada. */
  ungetId?: string | null;
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
  /** Pedido que la PC iba a subir con el mismo backup de la nube: se baja la copia. */
  reused?: boolean;
  /** Pedido ya subido que quedó como copia: su archivo es de la copia y no se borra al bajarlo. */
  promoted?: boolean;
  /** Con qué id se registra en Supabase la descarga de la copia (el del pedido ya se cerró). */
  reportId?: string;
}

/** Nombre del zip como lo genera el SISMED: BKDA<AAAAMMDD><HHMM>.zip (o BKDH…). */
export const isBackupName = (name: unknown): name is string =>
  typeof name === "string" && /^BKD[AH]\d{8,12}\.zip$/i.test(name);

/** Dónde vive el zip en R2 mientras está de paso. */
export const backupKey = (job: Pick<BackupJob, "id" | "code">, name: string) => `backups/${job.code}/${job.id}/${name}`;

export const isExpired = (job: Pick<BackupJob, "createdAt" | "kind">, now: number) =>
  now - job.createdAt > (job.kind === "copy" ? COPY_JOB_TTL_MS : BACKUP_TTL_MS);

// ---------------------------------------------------------------------------------------
//  Copia en la nube (2026-10-16; desde el 2026-10-18, cada backup nuevo): la PC sube sola
//  cada backup que genera el SISMED y en la nube queda solo el más reciente
// ---------------------------------------------------------------------------------------

/** La copia sube por una sola conexión: va en segundo plano y no debe saturar la red. */
export const COPY_PARALLEL = 1;
/** Nadie la espera: en una línea lenta puede tardar más que un pedido. */
export const COPY_JOB_TTL_MS = 3 * 60 * 60 * 1000;
/**
 * Cuánto se guarda una copia si no llega otra. Si la PC se conecta a diario, la del día
 * siguiente la reemplaza antes. La regla del bucket para `copias/` debe dejarla al menos esto
 * (docs/BACKUPS_SISMED.md); si borra antes, la web lo nota al pedirla y ofrece una nueva.
 */
export const COPY_KEEP_MS = 48 * 60 * 60 * 1000;
/**
 * Con el almacenamiento de R2 en este nivel ya no se aceptan copias nuevas. Era 70 %; el
 * 2026-10-18 el usuario lo subió a 85 % para que entre toda la región (en R2 queda una sola
 * copia por establecimiento). Para las copias el almacenamiento solo cuenta contra este tope,
 * no contra la pausa general del 80 %; los demás límites del plan sí las pausan.
 */
export const COPY_STORAGE_LIMIT = 0.85;

export interface BackupCopy {
  code: string;
  ungetId: string | null;
  name: string;
  size: number;
  sha256: string;
  modified: string;
  key: string;
  uploadedAt: number;
  /**
   * Cuándo se pidió la subida que la dejó (reloj del servicio). Ordena dos subidas que terminan
   * en desorden; la fecha de la PC no sirve para eso, porque a fin de mes la cambian.
   */
  startedAt?: number;
  equipo?: string;
  /** Dirección pública del servicio, para armar el enlace de descarga. */
  origin?: string;
}

/** La copia vive aparte de los pedidos, para que la regla del bucket pueda tratarla distinto. */
export const copyKey = (job: Pick<BackupJob, "id" | "code">, name: string) => `copias/${job.code}/${job.id}/${name}`;

export const copyIsStale = (copy: Pick<BackupCopy, "uploadedAt">, now: number) => now - copy.uploadedAt > COPY_KEEP_MS;

type BackupMeta = { name: string; size: number; sha256: string; modified?: string };

const sameBackup = (copy: BackupCopy, meta: BackupMeta) =>
  copy.name === meta.name && copy.size === meta.size && copy.sha256 === meta.sha256;

/**
 * ¿La copia de la nube ya sirve en lugar de este backup? Solo si es el mismo archivo.
 *
 * Antes también si la copia tenía una fecha más nueva, pero esa fecha es la del reloj de la PC:
 * a fin de mes la adelantan para cerrar en el SISMED y luego la regresan, y un backup «del 25»
 * hacía rechazar como más viejos todos los backups reales de los días siguientes (2026-10-18).
 * Desde el Toolkit 2.3.10 la PC ofrece el último backup que apareció en la carpeta: confiamos
 * en ese orden, no en la fecha.
 */
export const copyCovers = (copy: BackupCopy | null | undefined, meta: BackupMeta, now: number): boolean =>
  Boolean(copy) && !copyIsStale(copy!, now) && sameBackup(copy!, meta);

/**
 * ¿La copia vigente salió de una subida pedida después que esta? Entonces esta no la reemplaza
 * (dos subidas que terminan en desorden). Se mira cuándo se pidió cada una, con el reloj del servicio.
 */
export const copyIsNewer = (copy: BackupCopy, job: { createdAt?: number }, now: number): boolean =>
  !copyIsStale(copy, now) && copy.startedAt != null && job.createdAt != null && copy.startedAt > job.createdAt;

/** ¿Se acepta la copia que ofrece la PC? No si la nube ya la tiene (o una más nueva) ni si el espacio se acaba. */
export const copyOfferVerdict = (
  existing: BackupCopy | null | undefined,
  meta: BackupMeta,
  reading: UsageReading | null,
  uploading: boolean,
  now: number,
): { accept: true } | { accept: false; reason: string } => {
  if (copyCovers(existing, meta, now)) return { accept: false, reason: "La nube ya tiene esta copia" };
  if (uploading) return { accept: false, reason: "Ya se está subiendo una copia de este establecimiento" };
  const storage = reading?.items.find((item) => item.key === "r2Storage")?.ratio ?? 0;
  const otherPaused = reading?.items.some((item) => item.key !== "r2Storage" && (item.ratio ?? 0) >= USAGE_PAUSE) ?? false;
  if (otherPaused || storage >= COPY_STORAGE_LIMIT) {
    return { accept: false, reason: "La nube está cerca del límite gratuito: por ahora no se guardan copias" };
  }
  return { accept: true };
};

export interface CopyRow {
  code: string;
  name: string;
  size: number;
  modified: string;
  uploadedAt: number;
}

/** Las copias que puede ver alguien (su jurisdicción), sin las vencidas. */
export const copyRowsFor = (web: Pick<WebInfo, "isAdmin" | "ungetIds">, copies: BackupCopy[], now: number): CopyRow[] =>
  copies
    .filter((copy) => canSee(web, copy) && !copyIsStale(copy, now))
    .map(({ code, name, size, modified, uploadedAt }) => ({ code, name, size, modified, uploadedAt }));

/** Cuándo despertar para borrar la copia que vence primero (null si no hay). */
export const nextCopyExpiry = (copies: Pick<BackupCopy, "uploadedAt">[]): number | null =>
  copies.length ? Math.min(...copies.map((copy) => copy.uploadedAt + COPY_KEEP_MS)) + 1000 : null;

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
export const quotaMessage = (quota: Quota, username?: string): string => {
  const cupo = quota.limit === 1 ? "1 backup por día" : `${quota.limit} backups por día`;
  const last = quota.last;
  // El cupo es por usuario: el último pedido es casi siempre de quien pide, pero si el SQL
  // del cupo por usuario no está aplicado puede ser de otro, y entonces se nombra.
  const mine = !last || !username || last.username === username;
  if (last && last.status !== "DOWNLOADED") {
    return mine
      ? `Ya tiene un backup de este establecimiento en curso, pedido a las ${limaTime(last.at)}.`
      : `Ya hay un backup de este establecimiento en curso: lo pidió ${last.username} a las ${limaTime(last.at)}.`;
  }
  if (mine) {
    const when = last ? `; el último lo descargó a las ${limaTime(last.at)}` : "";
    return `Hoy ya usó su cupo de este establecimiento (${cupo} por usuario)${when}. Podrá pedir otro mañana.`;
  }
  return `Hoy ya se usó el cupo de este establecimiento (${cupo}); el último lo descargó ${last.username} a las ${limaTime(last.at)}. Se podrá pedir otro mañana.`;
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
export const jobMessages = (job: Pick<BackupJob, "id" | "code" | "kind" | "status" | "name" | "size" | "sha256" | "modified" | "sent" | "downloadUrl">): unknown[] => {
  const base = { job: job.id, code: job.code };
  const messages: unknown[] = [{ t: "backup_requested", ...base }];
  if (job.name && job.size) {
    messages.push({ t: "backup_meta", ...base, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified });
    if (job.status === "uploading" && job.sent) messages.push({ t: "backup_progress", ...base, sent: job.sent, total: job.size });
  }
  if (job.status === "ready" && job.downloadUrl) {
    messages.push({ t: "backup_ready", ...base, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified, downloadUrl: job.downloadUrl,
      ...(job.kind === "copy_download" ? { copy: true } : {}) });
  }
  return messages;
};
