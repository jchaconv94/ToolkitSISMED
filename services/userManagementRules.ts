/**
 * Quién puede asignar qué rol en Gestión de Usuarios.
 *
 * El ADMIN puede todo. Un usuario con acceso a Gestión de Usuarios que no es ADMIN —el
 * informático de una UNGET, por ejemplo— solo puede dar roles de un nivel de jurisdicción
 * **inferior** al suyo, con una excepción acordada el 2026-09-29: puede crear
 * **coordinadores** de su mismo nivel. Nunca puede crear a otro de su mismo rol ni a nadie
 * de un nivel superior.
 *
 * La misma regla la aplica el servidor en `app_manage_save_user`
 * (`supabase/SUPABASE_USUARIOS_POR_JURISDICCION.sql`). La pantalla la usa para no ofrecer
 * lo que el guardado va a rechazar: si cambias una, cambia la otra.
 */

export type JurisdictionLevel = "GLOBAL" | "DIRESA" | "OGESS" | "UNGET" | "MICRORED" | "IPRESS" | "";

export const LEVEL_WEIGHTS: Record<string, number> = {
  GLOBAL: 100,
  DIRESA: 80,
  OGESS: 60,
  UNGET: 40,
  MICRORED: 20,
  IPRESS: 0,
};

export const levelWeight = (level?: string | null): number =>
  LEVEL_WEIGHTS[String(level || "").toUpperCase()] ?? -1;

/** Rol que un usuario puede crear en su mismo nivel. */
export const isPeerAssignableRole = (role?: string | null): boolean =>
  String(role || "").toUpperCase().includes("COORDINADOR");

export const canAssignRole = (params: {
  callerIsAdmin: boolean;
  callerLevel?: string | null;
  targetRole?: string | null;
  targetLevel?: string | null;
}): boolean => {
  const { callerIsAdmin, callerLevel, targetRole, targetLevel } = params;
  if (callerIsAdmin) return true;
  if (String(targetRole || "").toUpperCase() === "ADMIN") return false;

  const caller = levelWeight(callerLevel);
  const target = levelWeight(targetLevel);
  // Sin nivel configurado no se puede saber si es inferior: no se ofrece.
  if (caller < 0 || target < 0 || target >= LEVEL_WEIGHTS.GLOBAL) return false;

  return target < caller || (target === caller && isPeerAssignableRole(targetRole));
};
