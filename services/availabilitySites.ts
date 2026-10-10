/**
 * Establecimientos del análisis de disponibilidad (2026-10-09; por jurisdicción desde el
 * 2026-10-10, pedido del usuario: «igualito como se manejan los establecimientos»). Los
 * establecimientos fuera del análisis no cuentan en la disponibilidad de la microred ni de la
 * UNGET, ni en los demás reportes, y se ven aparte («Fuera del análisis»).
 *
 * Los centros de salud mental comunitario van fuera por omisión: el tablero nacional de
 * DIGEMID no los incluye en la disponibilidad de medicamentos esenciales (comprobado con
 * Bellavista, agosto 2026). Se reconocen por el nombre, que viene igual en el registro de
 * Establecimientos y en el TFORMDET («C.S.M.C. BELLAVISTA»).
 *
 * La lista es una sola y vive en Supabase (`supabase/SUPABASE_DISPONIBILIDAD_ESTABLECIMIENTOS.sql`):
 * cada uno la ve en su jurisdicción (ADMIN y DIRESA todo; OGESS sus UNGET; UNGET sus
 * establecimientos…) y la cambian el ADMIN, la DIRESA y cada UNGET en lo suyo. Solo se guardan
 * las decisiones que difieren de lo de omisión. El historial guarda todos los establecimientos y
 * aparta los de fuera al mostrarlos.
 */

import { callSendKeysRpc } from "./sendKeys";
import { withOfflineCache } from "./offlineCache";

export const SITES_SQL = "SUPABASE_DISPONIBILIDAD_ESTABLECIMIENTOS.sql";

/** Decisión guardada de un establecimiento: dentro o fuera, quién y cuándo. */
export interface SiteDecision {
  inAnalysis: boolean;
  updatedByName: string;
  updatedAt: string;
}

/** Código → decisión. Un establecimiento sin decisión sigue la regla de omisión. */
export type SiteDecisions = Map<string, SiteDecision>;

export interface SitesState {
  decisions: SiteDecisions;
  /** ¿Puede cambiar la lista? (lo dice el servidor). */
  canEdit: boolean;
  /** "missing-sql": sin el SQL solo rige la regla de omisión y no se puede cambiar. */
  status: "loading" | "ready" | "missing-sql" | "error";
  /** Lo que se ve es la última copia guardada en este equipo (sin internet). */
  offline: boolean;
}

export const EMPTY_SITES: SitesState = { decisions: new Map(), canEdit: false, status: "loading", offline: false };

/** «C.S.M.C. BELLAVISTA», «CSMC …», «CENTRO DE SALUD MENTAL COMUNITARIO …». */
export const isMentalHealthCenter = (name?: string) => !!name && /(^|[^A-Z])C\.?\s*S\.?\s*M\.?\s*C(\.|[^A-Z]|$)|SALUD\s+MENTAL/i.test(name);

export const outByDefault = (name?: string) => isMentalHealthCenter(name);

/** ¿Va fuera del análisis? */
export const isOutOfAnalysis = (code: string, name: string | undefined, decisions: SiteDecisions) => {
  const d = decisions.get(code);
  return d ? !d.inAnalysis : outByDefault(name);
};

/**
 * Cambios para el servidor a partir de la lista marcada en la ventana: por cada
 * establecimiento listado cuya decisión cambia, `true` (dentro), `false` (fuera) o `null`
 * (volver a lo de omisión: se borra la decisión). Lo que queda igual no se envía.
 */
export const siteChanges = (
  sites: Array<{ code: string; name?: string }>,
  outCodes: ReadonlySet<string>,
  decisions: SiteDecisions,
): Array<[string, boolean | null]> => {
  const changes: Array<[string, boolean | null]> = [];
  for (const s of sites) {
    const inside = !outCodes.has(s.code);
    const target = inside === !outByDefault(s.name) ? null : inside;
    const current = decisions.get(s.code)?.inAnalysis ?? null;
    if (target !== current) changes.push([s.code, target]);
  }
  return changes;
};

type WireItem = [string, boolean, string, string];

export const availabilitySitesApi = {
  /** Las decisiones de la jurisdicción. Sin internet, la última copia de este equipo (por usuario). */
  list: async (username: string): Promise<{ decisions: SiteDecisions; canEdit: boolean }> => {
    const data = await withOfflineCache(`disponibilidad-establecimientos:${username}`, async () =>
      (await callSendKeysRpc<{ items?: WireItem[]; canEdit?: boolean } | null>("app_availability_sites_list", {}, SITES_SQL)) || {});
    return {
      decisions: new Map((data.items ?? []).map(([code, inAnalysis, updatedByName, updatedAt]) => [code, { inAnalysis: !!inAnalysis, updatedByName: updatedByName || "", updatedAt: updatedAt || "" }])),
      canEdit: !!data.canEdit,
    };
  },
  save: (changes: Array<[string, boolean | null]>) =>
    callSendKeysRpc<{ saved: number; rejected: string[] }>("app_availability_sites_save", { p_items: changes }, SITES_SQL),
};
