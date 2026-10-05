/**
 * Qué conexiones de stock (una por UNGET, en `unget_configs`) le tocan a cada usuario.
 *
 * Vivía dentro de `SheetSearchModule` (Consulta Stock). Se trajo aquí sin cambiar nada para
 * que el resumen de Inicio cuente exactamente los mismos establecimientos que Consulta
 * Stock: si la regla estuviera repetida, tarde o temprano dirían números distintos.
 */

import { normalizeUngetName } from "./ungetConnections";

export type StockLevel = "GLOBAL" | "DIRESA" | "OGESS" | "UNGET" | "MICRORED" | "IPRESS" | string;

/** Nivel de jurisdicción: el configurado en el rol y, si falta, el que sugiere su nombre. */
export const resolveStockLevel = (role?: string | null, jurisdictionLevel?: string | null): StockLevel => {
  if (jurisdictionLevel) return jurisdictionLevel;
  const r = String(role || "").toUpperCase();
  if (r === "ADMIN" || r === "GLOBAL" || r.includes("SUPER") || r.includes("GENERAL") || r === "ADMINISTRADOR") return "GLOBAL";
  if (r.includes("DIRESA")) return "DIRESA";
  if (r.includes("OGESS")) return "OGESS";
  if (r.includes("UNGET") || r.includes("RED")) return "UNGET";
  if (r.includes("MICRORED")) return "MICRORED";
  return "IPRESS";
};

/** Pone a cada conexión el nombre e id oficiales de su UNGET (Establecimientos). */
export const alignConfigsWithOfficialUngets = (configs: any[], ungs: any[]): any[] => {
  if (!ungs || ungs.length === 0) return configs;
  return configs.map((config) => {
    const configNorm = normalizeUngetName(config.name);
    const matching = ungs.find(
      (u) =>
        (config.ungetId && String(u.id) === String(config.ungetId)) ||
        u.name === config.name ||
        normalizeUngetName(u.name) === configNorm,
    );
    if (matching) {
      return { ...config, ungetId: matching.id, name: matching.name };
    }
    return config;
  });
};

const ungetIdOf = (u: any): string | undefined =>
  u?.personnelData?.ungetId || u?.facilityData?.ungetId || u?.ungetId || u?.personnel?.ungetId;

/**
 * Conexiones que ve el usuario (ya alineadas con `alignConfigsWithOfficialUngets`):
 * - GLOBAL: todas.
 * - DIRESA / OGESS: las propias y las de las UNGET de su DIRESA / OGESS.
 * - UNGET, MICRORED, IPRESS: las propias; si no tiene, la de su UNGET (por id, por nombre o
 *   porque la creó alguien de su misma UNGET).
 */
export const selectVisibleStockConnections = (params: {
  level: StockLevel;
  username: string;
  userDiresaId?: string | null;
  userOgessId?: string | null;
  userUngetId?: string | null;
  /** Su UNGET registrada, si se encontró. */
  myUnget?: { id: string; name: string } | null;
  allConfigs: any[];
  ungets: any[];
  users: any[];
}): any[] => {
  const { level, username, userDiresaId, userOgessId, userUngetId, myUnget, allConfigs, ungets, users } = params;
  const ungetOf = (config: any) =>
    ungets.find(
      (u) =>
        (config.ungetId && String(u.id) === String(config.ungetId)) ||
        normalizeUngetName(u.name) === normalizeUngetName(config.name),
    );

  if (level === "GLOBAL") return allConfigs;
  if (level === "DIRESA") {
    return allConfigs.filter((config) => {
      if (config.username === username) return true;
      const ungetObj = ungetOf(config);
      return !!(ungetObj && userDiresaId && String(ungetObj.diresaId) === String(userDiresaId));
    });
  }
  if (level === "OGESS") {
    return allConfigs.filter((config) => {
      if (config.username === username) return true;
      const ungetObj = ungetOf(config);
      return !!(ungetObj && userOgessId && String(ungetObj.ogessId) === String(userOgessId));
    });
  }

  const myOwn = allConfigs.filter((config) => config.username === username);
  const inherited = allConfigs.filter((config) => {
    if (config.ungetId && userUngetId && String(config.ungetId) === String(userUngetId)) return true;
    if (myUnget) {
      if (config.ungetId && String(config.ungetId) === String(myUnget.id)) return true;
      if (
        normalizeUngetName(config.name) === normalizeUngetName(myUnget.name) ||
        String(config.name || "").toUpperCase().includes(String(myUnget.name || "").toUpperCase())
      )
        return true;
    }
    const creatorUngetId = ungetIdOf(users.find((u) => u.username === config.username));
    return !!(creatorUngetId && userUngetId && String(creatorUngetId) === String(userUngetId));
  });
  return myOwn.length > 0 ? myOwn : inherited;
};
