import localforage from "localforage";
import type { ParsedTformdet, TformdetMonthSheet } from "./availabilityReport";

/**
 * TFORMDET guardado en este equipo (2026-10-08, pedido del usuario: «que los datos que se suban
 * sean persistentes, para no estar recargando la página y subiendo otra vez el archivo»). Vive
 * en IndexedDB del navegador, por usuario, y no sale del equipo: es el primer paso para que el
 * módulo funcione sin internet.
 *
 * IndexedDB guarda los Map y las fechas tal cual (clonado estructurado), así que el archivo
 * vuelve exactamente como se leyó, sin volver a procesarlo.
 */

export interface StoredTformdet {
  name: string;
  savedAt: string;
  data: ParsedTformdet;
  last: TformdetMonthSheet | null;
}

/** Cambios del usuario al plan de redistribución, ligados al archivo con que se hicieron. */
export interface StoredPlanEdits {
  file: string;
  edits: Record<string, unknown>;
}

/** Solo IndexedDB: la reserva de localStorage no guarda Map ni fechas, y no tiene espacio. */
const store = localforage.createInstance({ name: "toolkit-sismed", storeName: "disponibilidad", driver: localforage.INDEXEDDB });

const fileKey = (user: string) => `tformdet:${user || "anon"}`;
const planKey = (user: string) => `plan:${user || "anon"}`;

/** Lo que identifica al archivo guardado: si cambia, los cambios del plan ya no corresponden. */
export const fileSignature = (f: Pick<StoredTformdet, "name" | "savedAt">) => `${f.name}|${f.savedAt}`;

export const availabilityStore = {
  async loadFile(user: string): Promise<StoredTformdet | null> {
    try {
      const saved = await store.getItem<StoredTformdet>(fileKey(user));
      return saved && saved.data && Array.isArray(saved.data.rows) ? saved : null;
    } catch {
      return null;
    }
  },
  async saveFile(user: string, file: StoredTformdet): Promise<boolean> {
    try {
      await store.setItem(fileKey(user), file);
      return true;
    } catch {
      return false; // sin espacio o modo privado: se sigue trabajando, solo no se guarda
    }
  },
  async clear(user: string): Promise<void> {
    try {
      await Promise.all([store.removeItem(fileKey(user)), store.removeItem(planKey(user))]);
    } catch {
      /* nada que limpiar */
    }
  },
  async loadPlan(user: string, signature: string): Promise<Record<string, unknown> | null> {
    try {
      const saved = await store.getItem<StoredPlanEdits>(planKey(user));
      return saved && saved.file === signature ? saved.edits : null;
    } catch {
      return null;
    }
  },
  async savePlan(user: string, signature: string, edits: Record<string, unknown>): Promise<void> {
    try {
      await store.setItem(planKey(user), { file: signature, edits } satisfies StoredPlanEdits);
    } catch {
      /* no se pudo guardar: los cambios siguen en pantalla */
    }
  },
};
