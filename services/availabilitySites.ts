/**
 * Establecimientos del análisis de disponibilidad (2026-10-09, pedido del usuario): cada persona
 * puede dejar establecimientos fuera del cálculo. Los desmarcados no cuentan en la disponibilidad
 * de la microred ni de la UNGET, ni en los demás reportes, y se ven aparte («Fuera del análisis»).
 *
 * Los centros de salud mental comunitario salen desmarcados por omisión: el tablero nacional de
 * DIGEMID no los incluye en la disponibilidad de medicamentos esenciales (comprobado con
 * Bellavista, agosto 2026). Se reconocen por el nombre, que viene igual en el registro de
 * Establecimientos y en el TFORMDET («C.S.M.C. BELLAVISTA»).
 *
 * La selección es personal y se guarda en este navegador, por usuario: no cambia lo que ven los
 * demás ni lo que se guarda en el historial (que guarda todos y los aparta al mostrarlos).
 */

/** Lo que la persona cambió respecto de lo de omisión. */
export interface SitePrefs {
  /** Desmarcados a mano. */
  out: string[];
  /** Marcados a mano aunque por omisión van fuera (un centro de salud mental). */
  in: string[];
}

export const EMPTY_SITE_PREFS: SitePrefs = { out: [], in: [] };

/** «C.S.M.C. BELLAVISTA», «CSMC …», «CENTRO DE SALUD MENTAL COMUNITARIO …». */
export const isMentalHealthCenter = (name?: string) => !!name && /(^|[^A-Z])C\.?\s*S\.?\s*M\.?\s*C(\.|[^A-Z]|$)|SALUD\s+MENTAL/i.test(name);

export const outByDefault = (name?: string) => isMentalHealthCenter(name);

/** ¿Va fuera del análisis? */
export const isOutOfAnalysis = (code: string, name: string | undefined, prefs: SitePrefs) =>
  prefs.out.includes(code) || (outByDefault(name) && !prefs.in.includes(code));

/**
 * Preferencias que resultan de la lista marcada en la ventana. Solo se anota lo que difiere de lo
 * de omisión, y se conserva lo anotado de establecimientos que no estaban en la lista (los de
 * otro archivo o de otro año del historial).
 */
export const prefsFromSelection = (
  sites: Array<{ code: string; name?: string }>,
  outCodes: ReadonlySet<string>,
  previous: SitePrefs,
): SitePrefs => {
  const listed = new Set(sites.map((s) => s.code));
  const out = previous.out.filter((c) => !listed.has(c));
  const inside = previous.in.filter((c) => !listed.has(c));
  for (const s of sites) {
    const def = outByDefault(s.name);
    const isOut = outCodes.has(s.code);
    if (isOut && !def) out.push(s.code);
    if (!isOut && def) inside.push(s.code);
  }
  return { out: [...new Set(out)].sort(), in: [...new Set(inside)].sort() };
};

const keyFor = (username: string) => `toolkit.disponibilidad.establecimientos.${username}`;
const safeStorage = (): Storage | null => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};
const codeList = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : []);

export const loadSitePrefs = (username: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): SitePrefs => {
  if (!username || !storage) return EMPTY_SITE_PREFS;
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(username)) || "{}");
    return { out: codeList(parsed?.out), in: codeList(parsed?.in) };
  } catch {
    return EMPTY_SITE_PREFS;
  }
};

export const saveSitePrefs = (username: string, prefs: SitePrefs, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()): boolean => {
  if (!username || !storage) return false;
  try {
    if (!prefs.out.length && !prefs.in.length) storage.removeItem(keyFor(username));
    else storage.setItem(keyFor(username), JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
};
