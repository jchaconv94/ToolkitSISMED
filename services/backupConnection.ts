/**
 * Conexión inmediata con el Toolkit de escritorio (backups SISMED · etapa 1).
 *
 * La web abre un WebSocket con el servicio «sismed-conexion» de Cloudflare
 * (`cloudflare/conexion`) usando la sesión del usuario. El servicio responde con las PC
 * conectadas de su jurisdicción y reenvía los avisos a la PC al instante.
 */

import { getSessionToken } from "./api";
import { callSendKeysRpc } from "./sendKeys";

/** Se puede cambiar con VITE_BACKUP_CONNECTION_URL para probar contra un servicio local. */
export const CONNECTION_URL: string =
  (import.meta as any).env?.VITE_BACKUP_CONNECTION_URL || "wss://sismed-conexion.jchaconvillacis.workers.dev/web";

export interface OnlinePc {
  code: string;
  name: string;
  ungetId: string | null;
  equipo: string;
  version: string;
  since: number;
  lastSeen: number;
}

/** Un dato del plan gratuito de Cloudflare (lo mide el servicio cada 10 minutos). */
export interface UsageItem {
  key: string;
  label: string;
  used: number | null;
  limit: number;
  ratio: number | null;
}

export interface UsageReading {
  at: number;
  items: UsageItem[];
  level: "ok" | "warn" | "paused" | "unknown";
  worst: UsageItem | null;
  /** Solo el administrador: mensajes de conexión por día, los últimos 7. */
  daily?: Array<{ date: string; requests: number }>;
  error?: string;
}

/** Cupo de descargas del establecimiento en el día. */
export interface BackupQuota {
  ok?: boolean;
  limit: number;
  used: number;
  last?: { username: string; status: string; at: string } | null;
}

export type ServerMessage =
  | { t: "hello"; username: string; isAdmin: boolean }
  | { t: "list"; rows: OnlinePc[] }
  | { t: "presence"; online: boolean; codes: string[]; equipo?: string }
  | { t: "ping_result"; id: string; code: string; ok: boolean; rtt?: number; reason?: string; equipo?: string }
  | { t: "backup_requested"; job: string; code: string; quota?: BackupQuota }
  | { t: "backup_meta"; job: string; code: string; name: string; size: number; sha256: string; modified: string }
  | { t: "backup_progress"; job: string; code: string; sent: number; total: number }
  | { t: "backup_ready"; job: string; code: string; name: string; size: number; sha256: string; modified?: string; downloadUrl: string }
  | { t: "backup_failed"; job?: string; code: string; reason: string; quota?: BackupQuota; usage?: UsageReading }
  | { t: "usage"; usage: UsageReading; message: string | null };

export const connectionUrl = (token: string | null = getSessionToken()): string | null =>
  token ? `${CONNECTION_URL}?token=${encodeURIComponent(token)}` : null;

/** Interpreta un mensaje del servicio; descarta lo que no reconoce. */
export const parseServerMessage = (raw: unknown): ServerMessage | null => {
  if (typeof raw !== "string") return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data.t === "string" ? (data as ServerMessage) : null;
  } catch {
    return null;
  }
};

/** Aplica un aviso de presencia a la lista: una PC que se va sale de la lista al instante. */
export const applyPresence = (rows: OnlinePc[], message: Extract<ServerMessage, { t: "presence" }>): OnlinePc[] =>
  message.online ? rows : rows.filter((row) => !message.codes.includes(row.code));

/** Huella SHA-256 en hexadecimal, para comprobar que el backup llegó idéntico. */
export const sha256Hex = async (data: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const formatMegabytes = (bytes: number) => `${(bytes / 1048576).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`;

const RULES_SQL = "SUPABASE_BACKUPS_REGLAS.sql";

/** Ajustes de Backups SISMED (Parámetros del Sistema; solo el administrador). */
export const backupSettingsApi = {
  get: () => callSendKeysRpc<{ dailyLimit: number; updatedBy: string | null; updatedAt: string | null }>("app_backup_settings_get", {}, RULES_SQL),
  save: (dailyLimit: number) => callSendKeysRpc<void>("app_backup_settings_save", { p_daily_limit: dailyLimit }, RULES_SQL),
};

const MODULE_SQL = "SUPABASE_BACKUPS_MODULO.sql";

/** Datos del módulo Backups SISMED (cada función exige el permiso del módulo). */
export const backupModuleApi = {
  overview: async () => (await callSendKeysRpc<any[] | null>("app_backup_overview", {}, MODULE_SQL)) || [],
  activity: async () => (await callSendKeysRpc<any[] | null>("app_backup_activity", {}, MODULE_SQL)) || [],
  /** Solo el administrador. */
  monthByUnget: async () =>
    (await callSendKeysRpc<Array<{ ungetId: string; unget: string; downloaded: number; failed: number; bytes: number; lastAt: string | null }> | null>(
      "app_backup_month_by_unget", {}, MODULE_SQL)) || [],
};
