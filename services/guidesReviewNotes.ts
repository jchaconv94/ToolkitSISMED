import localforage from "localforage";

/**
 * Observaciones de Revisión de guías (2026-10-28, pedido del usuario): una por producto de cada
 * establecimiento y mes («CORRECCIÓN DE LOTE», «INVENTARIO 09/09/2026»…), como la columna
 * «Detallar medicamentos sobrantes y faltantes» de su Excel. Se guardan **solo en este equipo**
 * (IndexedDB, por usuario, almacén y mes; decisión del usuario): funcionan sin internet y salen
 * en el Excel. Las que ya se usaron quedan como sugerencias para ponerlas con un clic.
 */

/** Observación por `destino|producto`. */
export type ReviewNotes = Record<string, string>;

/** Las que el usuario ya escribía en su Excel: sugerencias hasta que use las suyas. */
export const DEFAULT_NOTES = [
  "CORRECCIÓN DE LOTE",
  "AJUSTE DE INVENTARIO",
  "INVENTARIO",
  "PARA VENTA",
  "CANJE POR FECHA DE VENCIMIENTO",
  "CORRECCIÓN DE FECHA DE VENCIMIENTO",
  "SOBRANTE DE INVENTARIO",
  "REGULARIZACIÓN DE INGRESO",
  "INGRESO NO VÁLIDO",
];

const MAX_SUGGESTIONS = 12;

export const noteKey = (destination: string, product: string) => `${destination}|${product}`;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" }) === 0;

/** Pone la misma observación a varios productos; un texto vacío la quita. */
export const applyNote = (notes: ReviewNotes, keys: string[], text: string): ReviewNotes => {
  const next = { ...notes };
  const value = clean(text);
  keys.forEach((key) => {
    if (value) next[key] = value;
    else delete next[key];
  });
  return next;
};

/** Las recién usadas primero, sin repetir (sin distinguir mayúsculas ni tildes). */
export const rememberNote = (recent: string[], text: string): string[] => {
  const value = clean(text);
  if (!value) return recent;
  return [value, ...recent.filter((note) => !same(note, value))].slice(0, MAX_SUGGESTIONS);
};

/** Sugerencias: las usadas por la persona y, completando, las de su Excel. */
export const suggestedNotes = (recent: string[]): string[] => {
  const list = [...recent];
  DEFAULT_NOTES.forEach((note) => {
    if (list.length < MAX_SUGGESTIONS && !list.some((n) => same(n, note))) list.push(note);
  });
  return list;
};

const store = localforage.createInstance({ name: "toolkit-sismed", storeName: "revision-guias-notas", driver: localforage.INDEXEDDB });
const notesKey = (user: string, warehouse: string, month: string) => `notas:${user || "anon"}:${warehouse}:${month}`;
const recentKey = (user: string) => `usadas:${user || "anon"}`;

export const loadNotes = async (user: string, warehouse: string, month: string): Promise<ReviewNotes> => {
  try {
    return (await store.getItem<ReviewNotes>(notesKey(user, warehouse, month))) || {};
  } catch {
    return {};
  }
};

export const saveNotes = async (user: string, warehouse: string, month: string, notes: ReviewNotes) => {
  try {
    if (Object.keys(notes).length) await store.setItem(notesKey(user, warehouse, month), notes);
    else await store.removeItem(notesKey(user, warehouse, month));
    return true;
  } catch {
    return false;
  }
};

export const loadRecentNotes = async (user: string): Promise<string[]> => {
  try {
    return (await store.getItem<string[]>(recentKey(user))) || [];
  } catch {
    return [];
  }
};

export const saveRecentNotes = async (user: string, recent: string[]) => {
  try {
    await store.setItem(recentKey(user), recent);
  } catch {
    /* sin almacenamiento: las sugerencias de fábrica siguen */
  }
};
