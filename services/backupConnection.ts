/**
 * Conexión inmediata con el Toolkit de escritorio (backups SISMED · etapa 1).
 *
 * La web abre un WebSocket con el servicio «sismed-conexion» de Cloudflare
 * (`cloudflare/conexion`) usando la sesión del usuario. El servicio responde con las PC
 * conectadas de su jurisdicción y reenvía los avisos a la PC al instante.
 */

import { getSessionToken } from "./api";

export const CONNECTION_URL = "wss://sismed-conexion.jchaconvillacis.workers.dev/web";

export interface OnlinePc {
  code: string;
  name: string;
  ungetId: string | null;
  equipo: string;
  version: string;
  since: number;
  lastSeen: number;
}

export type ServerMessage =
  | { t: "hello"; username: string; isAdmin: boolean }
  | { t: "list"; rows: OnlinePc[] }
  | { t: "presence"; online: boolean; codes: string[]; equipo?: string }
  | { t: "ping_result"; id: string; code: string; ok: boolean; rtt?: number; reason?: string; equipo?: string };

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
