import localforage from "localforage";

/**
 * Copia en este equipo de lo que las herramientas sin internet leen de Supabase (2026-10-08,
 * modo sin internet): el registro de establecimientos, microredes y UNGET, la configuración de
 * Disponibilidad, las profesiones y los parámetros. Cada lectura buena se guarda; si la
 * siguiente falla (sin internet), se usa la guardada. Así Disponibilidad calcula sin internet
 * con la misma fórmula y el mismo registro que con internet.
 *
 * Solo catálogos que no son sensibles: nunca usuarios, claves ni stock.
 */

export interface CacheStore {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
}

/** Solo IndexedDB: guarda los objetos tal cual y tiene espacio de sobra. */
const defaultStore = (): CacheStore =>
  localforage.createInstance({ name: "toolkit-sismed", storeName: "respaldo", driver: localforage.INDEXEDDB });

let store: CacheStore | null = null;
const getStore = (): CacheStore => (store ??= defaultStore());

/** Solo para las pruebas. */
export const setOfflineCacheStore = (next: CacheStore | null) => {
  store = next;
};

/**
 * Lee con `load`; si responde, guarda la copia y la devuelve. Si falla, devuelve la última
 * copia guardada; si no hay ninguna, vuelve a lanzar el error.
 */
export const withOfflineCache = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
  let value: T;
  try {
    value = await load();
  } catch (error) {
    let saved: T | null = null;
    try {
      saved = await getStore().getItem<T>(key);
    } catch {
      /* sin almacenamiento: no hay copia */
    }
    if (saved !== null && saved !== undefined) return saved;
    throw error;
  }
  try {
    await getStore().setItem(key, value);
  } catch {
    /* sin espacio o modo privado: se sigue sin copia */
  }
  return value;
};
