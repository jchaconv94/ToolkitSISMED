/**
 * «Accesos frecuentes» de Inicio: las herramientas que cada persona abre más.
 *
 * Se cuenta en el navegador, por usuario (`localStorage`); no se guarda en la base. Si el
 * navegador no deja guardar o todavía no hay historial, se completan con las sugeridas
 * para lo que esa persona puede abrir.
 */

import type { AppModule } from "../types";

type Counts = Partial<Record<AppModule, { n: number; at: number }>>;

const keyFor = (username: string) => `toolkit.frecuentes.${username}`;

/** Inicio y Perfil no son herramientas: no cuentan. */
const NOT_A_TOOL: AppModule[] = ["HOME", "PROFILE", "ANALYSIS"];

export const loadCounts = (username: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): Counts => {
  if (!username || !storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(username)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const recordToolUse = (username: string, module: AppModule, now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): void => {
  if (!username || !storage || NOT_A_TOOL.includes(module)) return;
  const counts = loadCounts(username, storage);
  const prev = counts[module];
  counts[module] = { n: (prev?.n || 0) + 1, at: now };
  try { storage.setItem(keyFor(username), JSON.stringify(counts)); } catch { /* Sin espacio o bloqueado: no pasa nada. */ }
};

/**
 * Las `limit` más usadas entre las que puede abrir (`available`, en el orden del menú):
 * primero por cantidad de usos, luego la más reciente. Si faltan, se completan con
 * `suggested` y después con el orden del menú.
 */
export const topTools = (counts: Counts, available: AppModule[], suggested: AppModule[], limit = 4): AppModule[] => {
  const allowed = available.filter((module) => !NOT_A_TOOL.includes(module));
  const used = allowed
    .filter((module) => (counts[module]?.n || 0) > 0)
    .sort((a, b) => (counts[b]!.n - counts[a]!.n) || (counts[b]!.at - counts[a]!.at));
  const result: AppModule[] = [];
  [...used, ...suggested.filter((module) => allowed.includes(module)), ...allowed].forEach((module) => {
    if (result.length < limit && !result.includes(module)) result.push(module);
  });
  return result;
};

/** Sugeridas mientras no hay historial: lo más usado en la operación diaria. */
export const SUGGESTED_TOOLS: AppModule[] = ["SIG_SEARCH", "IPRESS_STOCK", "DASHBOARD", "ADMIN_BACKUPS", "REDISTRIBUTION", "ANALYSIS_EXCLUSIONS"];

function safeStorage(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
