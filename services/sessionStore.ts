/**
 * Dónde vive la sesión en el navegador (2026-10-08, «Mantener sesión iniciada»).
 *
 * - Sin la casilla, el usuario y el token van en `sessionStorage`: cerrar el navegador cierra
 *   la sesión, como siempre.
 * - Con la casilla (marcada por omisión), van en `localStorage` y además se anota cuándo se
 *   comprobó la sesión con el servidor por última vez. Así la sesión sobrevive a cerrar el
 *   navegador y la app abre sin internet hasta `OFFLINE_SESSION_DAYS` días desde esa última
 *   comprobación. Cada vez que hay internet la cuenta vuelve a empezar.
 *
 * El token también se renueva en el servidor (`app_session_keep`, en
 * `supabase/SUPABASE_SESION_MANTENIDA.sql`) por el mismo plazo, para que al volver la conexión
 * siga valiendo. Sin ese SQL el token dura 12 horas y, con internet, se pide entrar otra vez.
 *
 * Este archivo no importa nada de la app: lo usan `supabaseClient` y `api` sin ciclos.
 */

export const AUTH_USER_KEY = "aura_auth_user";
/** Clave donde vive el token de sesión emitido por `app_login`. */
export const SESSION_TOKEN_KEY = "aura_session_token";
const KEPT_KEY = "aura_session_kept";
/** Token de una sesión que se cerró sin internet: se avisa al servidor al volver la conexión. */
const PENDING_LOGOUT_KEY = "aura_pending_logout";
/** Mensaje para la pantalla de inicio de sesión (p. ej., «su sesión venció»). */
const LOGIN_NOTICE_KEY = "aura_login_notice";

/**
 * Días que la app abre sin internet desde la última vez que se comprobó la sesión. Los
 * establecimientos se conectan una vez al mes: 45 días les deja dos semanas de margen
 * (decisión del usuario del 2026-10-08: «de 30 a más»).
 */
export const OFFLINE_SESSION_DAYS = 45;

export interface KeptSession {
  username: string;
  /** Última vez que el servidor confirmó la sesión (ISO). */
  validatedAt: string;
}

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const local = (): KeyValue | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
const session = (): KeyValue | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};
const get = (store: KeyValue | null, key: string): string | null => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const set = (store: KeyValue | null, key: string, value: string | null) => {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    /* sin almacenamiento: no se guarda */
  }
};

/** ¿La sesión guardada todavía abre sin internet? Regla pura, con pruebas. */
export const keptSessionUsable = (kept: KeptSession | null, now: Date, days = OFFLINE_SESSION_DAYS): boolean => {
  if (!kept?.username || !kept.validatedAt) return false;
  const validated = Date.parse(kept.validatedAt);
  if (!Number.isFinite(validated)) return false;
  return now.getTime() - validated <= days * 24 * 60 * 60 * 1000;
};

/** Hasta cuándo abre sin internet (para mostrarlo). */
export const keptSessionUntil = (kept: KeptSession, days = OFFLINE_SESSION_DAYS): Date =>
  new Date(Date.parse(kept.validatedAt) + days * 24 * 60 * 60 * 1000);

export const keptSession = (): KeptSession | null => {
  const raw = get(local(), KEPT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KeptSession;
    return parsed && typeof parsed.username === "string" ? parsed : null;
  } catch {
    return null;
  }
};

/** La sesión se guarda en `localStorage` solo si está mantenida. */
const current = (): KeyValue | null => (keptSession() ? local() : session());

export const readSessionToken = (): string | null => get(session(), SESSION_TOKEN_KEY) ?? (keptSession() ? get(local(), SESSION_TOKEN_KEY) : null);

export const writeSessionToken = (token: string | null) => {
  set(current(), SESSION_TOKEN_KEY, token);
  if (token === null) set(local(), SESSION_TOKEN_KEY, null);
};

export const readStoredUser = (): string | null => get(session(), AUTH_USER_KEY) ?? (keptSession() ? get(local(), AUTH_USER_KEY) : null);

export const writeStoredUser = (userJson: string) => set(current(), AUTH_USER_KEY, userJson);

/**
 * Empieza una sesión tras entrar: deja el usuario y el token en el almacenamiento que toca y,
 * si se mantiene, anota la comprobación de ahora.
 */
export const startStoredSession = (userJson: string, keep: boolean, now: Date = new Date()) => {
  const token = readSessionToken();
  clearStoredSession();
  if (keep) set(local(), KEPT_KEY, JSON.stringify({ username: JSON.parse(userJson)?.username || "", validatedAt: now.toISOString() } satisfies KeptSession));
  const store = keep ? local() : session();
  set(store, AUTH_USER_KEY, userJson);
  if (token) set(store, SESSION_TOKEN_KEY, token);
};

/** El servidor acaba de confirmar la sesión: vuelve a empezar la cuenta de días. */
export const markSessionValidated = (now: Date = new Date()) => {
  const kept = keptSession();
  if (kept) set(local(), KEPT_KEY, JSON.stringify({ ...kept, validatedAt: now.toISOString() }));
};

export const clearStoredSession = () => {
  for (const store of [session(), local()]) {
    set(store, AUTH_USER_KEY, null);
    set(store, SESSION_TOKEN_KEY, null);
  }
  set(local(), KEPT_KEY, null);
};

export const pendingLogoutToken = (): string | null => get(local(), PENDING_LOGOUT_KEY);
export const setPendingLogoutToken = (token: string | null) => set(local(), PENDING_LOGOUT_KEY, token);

export const takeLoginNotice = (): string | null => {
  const notice = get(session(), LOGIN_NOTICE_KEY);
  set(session(), LOGIN_NOTICE_KEY, null);
  return notice;
};
export const setLoginNotice = (notice: string) => set(session(), LOGIN_NOTICE_KEY, notice);
