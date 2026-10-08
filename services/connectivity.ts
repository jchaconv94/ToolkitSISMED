/**
 * ¿Hay internet? (2026-10-08, modo sin internet).
 *
 * El navegador avisa cuando el equipo pierde la red (`navigator.onLine` y los eventos
 * `online`/`offline`), pero no cuando está conectado a una red sin salida a internet, que es
 * lo común en un establecimiento: el cable está puesto y nada responde. Por eso también
 * cuentan las peticiones reales: si una petición a Supabase falla por la red, se marca sin
 * conexión; si una responde, se marca con conexión.
 */

type Listener = (online: boolean) => void;

let online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
const listeners = new Set<Listener>();

export const isOnline = (): boolean => online;

export const setOnline = (value: boolean): void => {
  if (value === online) return;
  online = value;
  listeners.forEach((listener) => listener(value));
};

export const subscribeConnectivity = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}
