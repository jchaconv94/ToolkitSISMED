import type { AppModule } from "../types";

/**
 * Acciones configurables de cada módulo (Configuración de Roles, 2026-10-06).
 *
 * Un rol con el módulo activo puede verlo siempre; estas son las acciones que, además, se
 * pueden apagar por rol. Se guarda la lista de acciones **negadas**
 * (`roles_config.denied_actions`, `supabase/SUPABASE_ROLES_ACCIONES.sql`), así un rol que
 * nunca se tocó conserva todas sus acciones.
 *
 * Apagar una acción **solo quita**: las reglas que ya existían en cada pantalla (por ejemplo,
 * que solo el Administrador total elimina usuarios) se siguen cumpliendo encima de esto.
 *
 * Para añadir una acción: agréguela aquí y use `can(módulo, acción)` de `useAuth()` en el botón.
 */
export interface ModuleAction {
  /** Identificador estable: se guarda en la base como "MODULO:id". No lo cambie. */
  id: string;
  label: string;
  hint?: string;
  /** Solo exporta o descarga: no cambia datos. */
  readOnly?: boolean;
}

export const MODULE_ACTIONS: Partial<Record<AppModule, ModuleAction[]>> = {
  DASHBOARD: [
    { id: "analyze", label: "Cargar archivo y ejecutar análisis" },
    { id: "importProgress", label: "Importar avance" },
    { id: "exportProgress", label: "Exportar avance", readOnly: true },
    { id: "clear", label: "Limpiar todo" },
    { id: "additional", label: "Ítems adicionales" },
    { id: "editRequirement", label: "Revisar y editar el requerimiento", hint: "Validar ítems, cambiar cantidades y meses" },
    { id: "exportExcel", label: "Exportar Excel", readOnly: true },
    { id: "pdf", label: "Descargar informe PDF", readOnly: true },
  ],
  ANALYSIS_EXCLUSIONS: [
    { id: "create", label: "Añadir medicamento" },
    { id: "edit", label: "Editar" },
    { id: "delete", label: "Eliminar" },
    { id: "import", label: "Carga masiva desde Excel" },
    { id: "export", label: "Exportar lista", readOnly: true },
    { id: "clear", label: "Vaciar lista" },
  ],
  AVAILABILITY: [
    { id: "export", label: "Exportar Excel", readOnly: true },
    { id: "saveHistory", label: "Guardar y quitar meses del historial", hint: "Solo en su jurisdicción, y nunca el responsable de un establecimiento" },
    { id: "sites", label: "Elegir los establecimientos del análisis", hint: "Solo DIRESA y UNGET, en su jurisdicción" },
  ],
  SIG_SEARCH: [
    { id: "connections", label: "Configurar conexiones de stock", hint: "Además, cada conexión solo la edita su responsable" },
    { id: "export", label: "Exportar stock", readOnly: true },
    { id: "updateReport", label: "Reporte de actualización", readOnly: true },
    { id: "photoReport", label: "Foto de deficiencias", readOnly: true },
  ],
  IPRESS_STOCK: [
    { id: "export", label: "Exportar a Excel", readOnly: true },
  ],
  REDISTRIBUTION: [
    { id: "load", label: "Cargar archivo" },
    { id: "importProgress", label: "Importar avance" },
    { id: "exportProgress", label: "Exportar avance", readOnly: true },
    { id: "consolidate", label: "Consolidar" },
    { id: "transfer", label: "Transferir" },
    { id: "editTransfers", label: "Editar o eliminar transferencias" },
    { id: "exportList", label: "Exportar lista", readOnly: true },
  ],
  ADMIN_STOCK_ASSIGN: [
    { id: "save", label: "Guardar columnas" },
    { id: "reset", label: "Restablecer por omisión" },
  ],
  ADMIN_SEND_KEYS: [
    { id: "generate", label: "Generar clave" },
    { id: "regenerate", label: "Regenerar o retirar clave" },
    { id: "switchDevice", label: "Cambiar de equipo" },
    { id: "ignore", label: "Ignorar intentos bloqueados" },
  ],
  ADMIN_BACKUPS: [
    { id: "download", label: "Descargar backup", readOnly: true, hint: "Gasta el cupo diario del establecimiento" },
  ],
  ADMIN_USERS: [
    { id: "create", label: "Crear usuario" },
    { id: "edit", label: "Editar usuario" },
    { id: "toggle", label: "Activar o desactivar" },
    { id: "delete", label: "Eliminar permanentemente", hint: "Además, solo el Administrador total" },
    { id: "export", label: "Exportar Excel", readOnly: true },
  ],
  ADMIN_ROLES: [
    { id: "create", label: "Crear rol" },
    { id: "edit", label: "Editar nombre y nivel" },
    { id: "permissions", label: "Cambiar módulos y acciones" },
  ],
  ADMIN_PARAMS: [
    { id: "maintenance", label: "Modo mantenimiento" },
    { id: "save", label: "Guardar parámetros" },
  ],
  ADMIN_FACILITIES: [
    { id: "create", label: "Crear", hint: "DIRESA, OGESS, UNGET, microred y establecimiento" },
    { id: "edit", label: "Editar" },
    { id: "delete", label: "Eliminar", hint: "Además, solo el Administrador total" },
  ],
  ADMIN_CATALOGS: [
    { id: "create", label: "Crear" },
    { id: "edit", label: "Editar" },
    { id: "delete", label: "Eliminar", hint: "Además, solo el Administrador total" },
  ],
};

export const actionKey = (module: AppModule | string, action: string): string => `${module}:${action}`;

export const actionsOf = (module: AppModule | string): ModuleAction[] =>
  MODULE_ACTIONS[module as AppModule] || [];

/** ¿Puede el rol usar esta acción? Sí, salvo que esté en su lista de negadas. */
export const isActionAllowed = (denied: readonly string[] | null | undefined, module: AppModule | string, action: string): boolean =>
  !(denied || []).includes(actionKey(module, action));

/** Cuántas acciones del módulo tiene permitidas el rol, y de cuántas. */
export const allowedActionCount = (denied: readonly string[] | null | undefined, module: AppModule | string) => {
  const actions = actionsOf(module);
  return { allowed: actions.filter(a => isActionAllowed(denied, module, a.id)).length, total: actions.length };
};

/** Lista de negadas tras encender o apagar una acción. */
export const setActionAllowed = (denied: readonly string[] | null | undefined, module: AppModule | string, action: string, allowed: boolean): string[] => {
  const key = actionKey(module, action);
  const rest = (denied || []).filter(k => k !== key);
  return allowed ? rest : [...rest, key];
};

/** Lista de negadas tras encender o apagar todas las acciones de un módulo. */
export const setAllActionsAllowed = (denied: readonly string[] | null | undefined, module: AppModule | string, allowed: boolean): string[] => {
  const prefix = `${module}:`;
  const rest = (denied || []).filter(k => !k.startsWith(prefix));
  return allowed ? rest : [...rest, ...actionsOf(module).map(a => actionKey(module, a.id))];
};

/** Normaliza lo que llega de la base (jsonb) a una lista de textos. */
export const parseDeniedActions = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
