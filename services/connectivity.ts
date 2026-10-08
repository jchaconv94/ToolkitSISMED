/**
 * ¿Hay internet? (2026-10-08, modo sin internet).
 *
 * El navegador avisa cuando el equipo pierde la red (`navigator.onLine` y los eventos
 * `online`/`offline`), pero no cuando está conectado a una red sin salida a internet, que es
 * lo común en un establecimiento: el cable está puesto y nada responde. Por eso también
 * cuentan las peticiones reales a Supabase (`services/supabaseClient.ts`): si una responde,
 * hay conexión; si una falla por la red, se hace una comprobación corta y, si también falla,
 * se marca sin conexión y se vuelve a comprobar cada pocos segundos hasta que vuelva.
 */

type Listener = (online: boolean) => void;
/** Devuelve `true` si el servidor respondió (cualquier respuesta, aunque sea un error). */
export type ConnectivityProbe = () => Promise<boolean>;

const RETRY_MS = 15000;

let online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
const listeners = new Set<Listener>();
let probe: ConnectivityProbe | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let checking: Promise<void> | null = null;

export const isOnline = (): boolean => online;

export const setOnline = (value: boolean): void => {
  if (value) stopRetrying();
  else scheduleRetry();
  if (value === online) return;
  online = value;
  listeners.forEach((listener) => listener(value));
};

export const subscribeConnectivity = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Cómo comprobar si el servidor responde (lo pone `supabaseClient`). */
export const setConnectivityProbe = (next: ConnectivityProbe | null) => {
  probe = next;
};

const runProbe = async (): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (!probe) return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  try {
    return await probe();
  } catch {
    return false;
  }
};

function stopRetrying() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    setOnline(await runProbe());
  }, RETRY_MS);
}

/** Una petición respondió: hay conexión. */
export const reportNetworkSuccess = (): void => setOnline(true);

/**
 * Una petición falló por la red. No basta para declarar «sin conexión» (puede ser un corte de
 * un segundo): se comprueba una vez y solo si también falla se marca.
 */
export const reportNetworkFailure = (): Promise<void> => {
  if (!online) return Promise.resolve();
  checking ??= runProbe()
    .then((ok) => setOnline(ok))
    .finally(() => {
      checking = null;
    });
  return checking;
};

/** ¿Este error es de red (sin respuesta del servidor)? */
export const isNetworkError = (error: unknown): boolean => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if ((error as { code?: string } | null)?.code === "OFFLINE") return true;
  const text = String((error as { message?: string } | null)?.message ?? error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected/i.test(text);
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}
