import type { UserJurisdictionScope } from "./jurisdictionService";

/**
 * Pestañas de Administración → Establecimientos según el nivel territorial del rol.
 *
 * Antes salían del nombre del rol (ADMIN, DIRESA, OGESS, UNGET): un rol nuevo como COORDINADOR
 * se quedaba sin pestañas y veía «No tiene accesos asignados…» aunque tuviera el módulo
 * (2026-10-12). Ahora manda el nivel de jurisdicción del rol (Configuración de Roles), con la
 * misma cascada de `getUserJurisdictionScope`: cada uno ve su nivel hacia abajo.
 */
export type OrgTab = "DIRESA" | "OGESS" | "UNGET" | "MICRORED" | "IPRESS";

export const ORG_TABS: OrgTab[] = ["DIRESA", "OGESS", "UNGET", "MICRORED", "IPRESS"];

/** Posición de cada nivel en el orden de las pestañas (GLOBAL abarca desde la DIRESA). */
const LEVEL_INDEX: Record<UserJurisdictionScope["level"], number> = { GLOBAL: 0, OGESS: 1, UNGET: 2, MICRORED: 3, IPRESS: 4 };

/** Pestañas que ve: las de su nivel hacia abajo. */
export const orgTabsForLevel = (level: UserJurisdictionScope["level"]): OrgTab[] => ORG_TABS.slice(LEVEL_INDEX[level]);

/**
 * ¿Puede crear en esta pestaña? El ADMIN, en todas; DIRESA (GLOBAL), OGESS y UNGET, en los
 * niveles por debajo del suyo; microred y establecimiento, en ninguna. Es la regla que antes
 * se aplicaba por nombre de rol. Encima sigue la acción «crear» del rol (`can`).
 */
export const canCreateInOrgTab = (level: UserJurisdictionScope["level"], tab: OrgTab, isAdmin: boolean): boolean => {
  if (isAdmin) return true;
  if (level === "MICRORED" || level === "IPRESS") return false;
  return ORG_TABS.indexOf(tab) > LEVEL_INDEX[level];
};

/**
 * ¿Se muestra el filtro o la columna de este nivel territorial? Solo los que están por debajo
 * del nivel del usuario: el suyo y los de arriba son siempre el mismo (a un usuario de UNGET le
 * sobran «Todas las OGESS», «Todas las UNGET» y las columnas UNGET y OGESS; pedido del usuario
 * del 2026-10-12). El ADMIN, todos.
 */
export const showsTerritory = (level: UserJurisdictionScope["level"], filter: Exclude<OrgTab, "IPRESS">, isAdmin: boolean): boolean =>
  isAdmin || ORG_TABS.indexOf(filter) > LEVEL_INDEX[level];
