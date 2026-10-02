/**
 * Claves de envío: solo la PC vinculada puede enviar el stock de su establecimiento.
 *
 * El informático SISMED genera una clave por establecimiento. La PC donde la configura
 * queda vinculada en su primer envío; cualquier otra se bloquea y avisa aquí, donde se
 * decide «Ignorar» o «Cambiar a este equipo». Los establecimientos sin clave envían como
 * siempre.
 *
 * Todo pasa por funciones del servidor que exigen sesión y aplican la jurisdicción
 * (`supabase/SUPABASE_CLAVES_DE_ENVIO.sql`). No hay camino local: un registro de claves
 * que solo existe en un navegador no protege nada.
 */

import { supabase } from "./supabaseClient";
import { getSessionToken } from "./api";

export type SendAttemptResult = "ACEPTADO" | "SIN_CLAVE" | "CLAVE_INCORRECTA" | "OTRO_EQUIPO";

export interface SendKeyAlert {
  id: number;
  at: string;
  deviceName?: string | null;
  rows?: number | null;
  result: SendAttemptResult;
}

export interface SendKeyRow {
  code: string;
  name: string;
  type?: string | null;
  ungetId?: string | null;
  ungetName?: string | null;
  hasKey: boolean;
  keyHint?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  deviceName?: string | null;
  boundAt?: string | null;
  lastOkAt?: string | null;
  lastOkRows?: number | null;
  blockedToday: number;
  alert?: SendKeyAlert | null;
}

export interface SendAttempt {
  id: number;
  at: string;
  deviceName?: string | null;
  rows?: number | null;
  result: SendAttemptResult;
  resolvedAt?: string | null;
}

export type SendKeyState = "blocked" | "protected" | "waiting" | "none";

/**
 * Estado de un establecimiento. El bloqueo pendiente manda sobre todo lo demás: es lo que
 * el informático tiene que resolver.
 */
export const sendKeyState = (row: SendKeyRow): SendKeyState => {
  if (!row.hasKey) return "none";
  if (row.alert) return "blocked";
  if (!row.deviceName) return "waiting";
  return "protected";
};

export const SEND_KEY_STATE_LABEL: Record<SendKeyState, string> = {
  blocked: "Intento bloqueado",
  protected: "Protegido",
  waiting: "Esperando primer envío",
  none: "Sin clave",
};

export const ATTEMPT_RESULT_LABEL: Record<SendAttemptResult, string> = {
  ACEPTADO: "Aceptado",
  SIN_CLAVE: "Bloqueado · sin clave",
  CLAVE_INCORRECTA: "Bloqueado · clave incorrecta",
  OTRO_EQUIPO: "Bloqueado · otra PC",
};

/** «Hace 5 min», «Hace 3 h», «Ayer 19:11» o la fecha. */
export const relativeTime = (value?: string | null, now: Date = new Date()): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "Hace un momento";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const hora = date.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (hours < 48) return `Ayer ${hora}`;
  return date.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

// ---------------------------------------------------------------------------
//  Servidor
// ---------------------------------------------------------------------------

export const callSendKeysRpc = async <T>(
  fn: string,
  params: Record<string, unknown> = {},
  script = "SUPABASE_CLAVES_DE_ENVIO.sql",
): Promise<T> => {
  if (!supabase) throw new Error("Claves de envío necesita conexión con el servidor.");
  const token = getSessionToken();
  if (!token) throw new Error("Su sesión expiró. Vuelva a iniciar sesión.");
  const { data, error } = await supabase.rpc(fn, { p_token: token, ...params });
  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message || "")) {
      throw new Error(`Falta instalar esta función en la base de datos (${script}).`);
    }
    throw new Error(error.message || "No se pudo completar la operación.");
  }
  return data as T;
};

export const sendKeysApi = {
  overview: async (): Promise<SendKeyRow[]> => {
    const rows = await callSendKeysRpc<SendKeyRow[] | null>("app_send_keys_overview");
    return (rows || []).map((row) => ({ ...row, blockedToday: Number(row.blockedToday || 0), alert: row.alert || null }));
  },
  history: async (code: string): Promise<SendAttempt[]> =>
    (await callSendKeysRpc<SendAttempt[] | null>("app_send_key_history", { p_code: code })) || [],
  /** Devuelve la clave en claro. Es la única vez que existe fuera del Toolkit. */
  generate: (code: string) => callSendKeysRpc<string>("app_send_key_generate", { p_code: code }),
  ignore: (code: string) => callSendKeysRpc<void>("app_send_key_ignore", { p_code: code }),
  rebind: (attemptId: number) => callSendKeysRpc<void>("app_send_key_rebind", { p_attempt_id: attemptId }),
  revoke: (code: string) => callSendKeysRpc<void>("app_send_key_revoke", { p_code: code }),
};
