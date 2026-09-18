/**
 * Modo mantenimiento: la aplicación queda cerrada salvo para quien tenga que trabajar en
 * ella. Se enciende y se apaga desde Administración → Parámetros, sin desplegar nada.
 *
 * Quién puede entrar mientras está encendido:
 *   - los administradores del sistema;
 *   - los usuarios autorizados para pruebas, uno por línea o separados por comas.
 *
 * Todo lo demás ve la pantalla de mantenimiento. No sustituye a los permisos: es una
 * barrera temporal mientras se trabaja.
 */

export interface MaintenanceConfig {
  maintenanceMode?: boolean;
  maintenanceAllowedUsers?: string;
  maintenanceMessage?: string;
}

export interface MaintenanceUser {
  username?: string;
  role?: string;
}

export const MAINTENANCE_DEFAULT_MESSAGE =
  "Estamos trabajando en el sistema. Volveremos a habilitarlo en cuanto termine el mantenimiento.";

export const isMaintenanceActive = (config?: MaintenanceConfig | null): boolean =>
  config?.maintenanceMode === true;

/** Los roles que administran el sistema entran siempre. */
const isAdminRole = (role?: string): boolean => {
  const r = String(role || "").toUpperCase();
  if (!r) return false;
  return (
    r === "ADMIN" ||
    r === "ADMINISTRADOR" ||
    r === "GLOBAL" ||
    r.includes("SUPER") ||
    r.includes("GENERAL")
  );
};

/** Lista de autorizados para pruebas: admite comas, punto y coma o una por línea. */
export const parseAllowedUsers = (lista?: string | null): string[] =>
  String(lista || "")
    .split(/[\n,;]+/)
    .map((nombre) => nombre.trim().toLowerCase())
    .filter(Boolean);

export const isUserAllowedDuringMaintenance = (
  user?: MaintenanceUser | null,
  config?: MaintenanceConfig | null,
): boolean => {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  const usuario = String(user.username || "").trim().toLowerCase();
  if (!usuario) return false;
  return parseAllowedUsers(config?.maintenanceAllowedUsers).includes(usuario);
};

/** Si a este usuario hay que mostrarle la pantalla de mantenimiento en vez de la aplicación. */
export const shouldBlockForMaintenance = (
  user?: MaintenanceUser | null,
  config?: MaintenanceConfig | null,
): boolean => isMaintenanceActive(config) && !isUserAllowedDuringMaintenance(user, config);

export const maintenanceMessage = (config?: MaintenanceConfig | null): string =>
  String(config?.maintenanceMessage || "").trim() || MAINTENANCE_DEFAULT_MESSAGE;
