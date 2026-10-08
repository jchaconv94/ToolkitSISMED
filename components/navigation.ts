import {
  Activity,
  ArrowRightLeft,
  Ban,
  BarChart2,
  Boxes,
  Briefcase,
  Building2,
  Columns3,
  Database,
  FileSpreadsheet,
  HardDriveDownload,
  Home,
  KeyRound,
  LucideIcon,
  Pill,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";
import { AppModule } from "../types";

/**
 * Mapa de navegación de la aplicación: secciones, herramientas y su orden.
 *
 * Es la única fuente para el lateral de escritorio, la pantalla de Inicio, la miga de
 * pan de la cabecera y la barra inferior del teléfono (pestañas y pantallas de sección). Antes cada menú tenía su propia lista y se desordenaban entre sí.
 * Un módulo nuevo se agrega aquí (además de los otros lugares de AGENTS.md §4).
 */

export type NavTint = "teal" | "cyan" | "violet" | "slate";

export interface NavItem {
  module: AppModule;
  /** Nombre completo, el del menú y la cabecera. */
  label: string;
  /** Nombre corto, para espacios estrechos (íconos en el teléfono). */
  shortLabel: string;
  /** Una línea que dice para qué sirve. */
  description: string;
  icon: LucideIcon;
  /**
   * Funciona sin internet: trabaja con lo que se sube y se guarda en este equipo (modo sin
   * internet, 2026-10-08). Una herramienta nueva que no guarda nada en la base de datos debe
   * llevarlo, y probarse con la red cortada.
   */
  offline?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  /** Nombre corto, el de la pestaña de la barra inferior del teléfono. */
  shortLabel: string;
  icon: LucideIcon;
  tint: NavTint;
  items: NavItem[];
}

export const NAV_HOME: NavItem = {
  module: "HOME",
  label: "Inicio",
  shortLabel: "Inicio",
  description: "Pantalla de inicio con acceso a todas las herramientas",
  icon: Home,
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "farmacia",
    label: "Farmacia",
    shortLabel: "Farmacia",
    icon: Pill,
    tint: "teal",
    items: [
      { module: "DASHBOARD", label: "Análisis de Requerimiento", shortLabel: "Análisis", description: "Requerimiento por establecimiento", icon: BarChart2, offline: true },
      { module: "ANALYSIS_EXCLUSIONS", label: "Lista de Exclusiones", shortLabel: "Exclusiones", description: "Medicamentos fuera del análisis", icon: Ban },
      { module: "AVAILABILITY", label: "Disponibilidad", shortLabel: "Disponibilidad", description: "Disponibilidad y DME por establecimiento", icon: Activity, offline: true },
      { module: "REDISTRIBUTION", label: "Redistribución", shortLabel: "Redistribución", description: "Canjes entre establecimientos", icon: ArrowRightLeft, offline: true },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    shortLabel: "Stock",
    icon: Boxes,
    tint: "cyan",
    items: [
      { module: "SIG_SEARCH", label: "Consulta Stock", shortLabel: "Consulta", description: "Stock de toda la red", icon: Database },
      { module: "IPRESS_STOCK", label: "Stock SISMED", shortLabel: "Stock SISMED", description: "Stock de su establecimiento", icon: FileSpreadsheet },
      { module: "ADMIN_STOCK_ASSIGN", label: "Columnas de Stock", shortLabel: "Columnas", description: "Columnas que ve cada establecimiento", icon: Columns3 },
    ],
  },
  {
    id: "herramientas",
    label: "Herramientas",
    shortLabel: "Herramientas",
    icon: Wrench,
    tint: "violet",
    items: [
      { module: "ADMIN_BACKUPS", label: "Backups SISMED", shortLabel: "Backups", description: "Descargar backups con un clic", icon: HardDriveDownload },
      { module: "ADMIN_SEND_KEYS", label: "Claves de envío", shortLabel: "Claves", description: "PC autorizada por establecimiento", icon: KeyRound },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    shortLabel: "Admin",
    icon: Settings,
    tint: "slate",
    items: [
      { module: "ADMIN_USERS", label: "Gestión de Usuarios", shortLabel: "Usuarios", description: "Cuentas y accesos", icon: Users },
      { module: "ADMIN_ROLES", label: "Configuración de Roles", shortLabel: "Roles", description: "Permisos por rol", icon: Shield },
      { module: "ADMIN_FACILITIES", label: "Establecimientos", shortLabel: "Establecimientos", description: "DIRESA, UNGET e IPRESS", icon: Building2 },
      { module: "ADMIN_CATALOGS", label: "Regímenes y Profesiones", shortLabel: "Regímenes", description: "Catálogos de personal", icon: Briefcase },
      { module: "ADMIN_PARAMS", label: "Parámetros del Sistema", shortLabel: "Parámetros", description: "Configuración general", icon: SlidersHorizontal },
    ],
  },
];

/** Clases de cada tinte. Escritas enteras para que Tailwind las encuentre al compilar. */
export const NAV_TINT_CLASSES: Record<NavTint, { chip: string; chipHover: string; accent: string; solid: string }> = {
  teal: { chip: "bg-teal-50 text-teal-700", chipHover: "group-hover:bg-teal-100", accent: "text-teal-600", solid: "bg-teal-600" },
  cyan: { chip: "bg-cyan-50 text-cyan-700", chipHover: "group-hover:bg-cyan-100", accent: "text-cyan-600", solid: "bg-cyan-600" },
  violet: { chip: "bg-violet-50 text-violet-700", chipHover: "group-hover:bg-violet-100", accent: "text-violet-600", solid: "bg-violet-600" },
  slate: { chip: "bg-slate-100 text-slate-700", chipHover: "group-hover:bg-slate-200", accent: "text-slate-600", solid: "bg-slate-700" },
};

/** Secciones con solo las herramientas que el usuario puede abrir; las vacías no aparecen. */
export const visibleNavSections = (hasPermission: (module: AppModule) => boolean): NavSection[] =>
  NAV_SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => hasPermission(item.module)) }))
    .filter(section => section.items.length > 0);

/** Sección visible con ese identificador, o `null` si no existe o el usuario no ve ninguna de sus herramientas. */
export const findVisibleNavSection = (
  sectionId: string | null,
  hasPermission: (module: AppModule) => boolean,
): NavSection | null =>
  sectionId ? visibleNavSections(hasPermission).find(section => section.id === sectionId) || null : null;

/** Sección a la que pertenece un módulo, o `null` (Inicio y Perfil no tienen sección). */
export const findNavSection = (module: AppModule): NavSection | null =>
  NAV_SECTIONS.find(section => section.items.some(item => item.module === module)) || null;

/** ¿Se puede usar sin internet? Inicio siempre (muestra lo último guardado). */
export const worksOffline = (module: AppModule): boolean =>
  module === NAV_HOME.module || Boolean(findNavItem(module)?.offline);

/** Herramientas que el usuario puede abrir sin internet, en el orden del menú. */
export const offlineNavItems = (hasPermission: (module: AppModule) => boolean): NavItem[] =>
  visibleNavSections(hasPermission).flatMap(section => section.items.filter(item => item.offline));

/** Entrada de navegación de un módulo, o `null` si no está en el menú. */
export const findNavItem = (module: AppModule): NavItem | null => {
  if (module === NAV_HOME.module) return NAV_HOME;
  for (const section of NAV_SECTIONS) {
    const item = section.items.find(entry => entry.module === module);
    if (item) return item;
  }
  return null;
};
