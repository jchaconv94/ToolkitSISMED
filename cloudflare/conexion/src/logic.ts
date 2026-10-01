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
