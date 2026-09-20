import { AppModule } from "../types";

/**
 * Rutas de la aplicación.
 *
 * Cada módulo tiene su propia dirección, de modo que se pueda compartir un enlace,
 * recargar sin perder la pantalla y usar los botones de atrás y adelante del navegador.
 *
 * No se usa una librería de rutas: la aplicación ya navega con un único estado
 * `currentView`, así que basta con traducir ese estado a una dirección y viceversa.
 */

/** Prefijo bajo el que se publica la aplicación (`base` en `vite.config.ts`). */
export const APP_BASE = "/ToolkitSISMED";

const RUTAS: Record<AppModule, string> = {
  DASHBOARD: "/analisis",
  ANALYSIS: "/analisis-inteligente",
  ANALYSIS_EXCLUSIONS: "/analisis/exclusiones",
  SIG_SEARCH: "/consulta-stock",
  REDISTRIBUTION: "/redistribucion",
  IPRESS_STOCK: "/stock-sismed",
  STOCK_MONITORING: "/monitoreo-stock",
  PROFILE: "/perfil",

  IMMUNIZATION_CATALOG: "/inmunizaciones/catalogo",
  IMMUNIZATION_INITIAL_INVENTORY: "/inmunizaciones/inventario-inicial",
  IMMUNIZATION_STOCK: "/inmunizaciones/stock",
  IMMUNIZATION_STOCK_QUERY: "/inmunizaciones/consulta-stock",
  IMMUNIZATION_INCOMES: "/inmunizaciones/ingresos",
  IMMUNIZATION_INCOME_ORIGINS: "/inmunizaciones/origenes-ingreso",
  IMMUNIZATION_DISTRIBUTIONS: "/inmunizaciones/distribuciones",
  IMMUNIZATION_CONSUMPTION: "/inmunizaciones/consumo",
  IMMUNIZATION_RETURNS: "/inmunizaciones/devoluciones",
  IMMUNIZATION_ADJUSTMENTS: "/inmunizaciones/reajustes",
  IMMUNIZATION_CLOSURES: "/inmunizaciones/cierre-mensual",
  IMMUNIZATION_REPORTS: "/inmunizaciones/reportes",
  IMMUNIZATION_CONFIG: "/inmunizaciones/configuracion",

  ADMIN_USERS: "/administracion/usuarios",
  ADMIN_ROLES: "/administracion/roles",
  ADMIN_FACILITIES: "/administracion/establecimientos",
  ADMIN_CATALOGS: "/administracion/regimenes-profesiones",
  ADMIN_PARAMS: "/administracion/parametros",
  ADMIN_MIGRATION: "/administracion/migracion",
  ADMIN_STOCK_ASSIGN: "/administracion/asignar-stock",
  ADMIN_SYNC_DEVICES: "/administracion/dispositivos"
};

const MODULOS_POR_RUTA = new Map<string, AppModule>(
  (Object.entries(RUTAS) as Array<[AppModule, string]>).map(([modulo, ruta]) => [ruta, modulo])
);

/** Quita barras sobrantes para que `/a/b/` y `/a/b` sean la misma ruta. */
const normalizar = (ruta: string) => {
  const limpia = ruta.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return limpia.startsWith("/") ? limpia : `/${limpia}`;
};

/** Dirección completa de un módulo, lista para el navegador. */
export const pathForModule = (module: AppModule): string => `${APP_BASE}${RUTAS[module] || RUTAS.DASHBOARD}`;

/**
 * Módulo que corresponde a una dirección, o `null` si no reconoce ninguna.
 *
 * Acepta la dirección con o sin el prefijo de publicación, porque en desarrollo y en
 * producción la aplicación cuelga de rutas distintas.
 */
export const moduleForPath = (pathname: string): AppModule | null => {
  let ruta = normalizar(pathname);
  if (ruta === APP_BASE || ruta === "") return null;
  if (ruta.startsWith(`${APP_BASE}/`)) ruta = ruta.slice(APP_BASE.length);
  return MODULOS_POR_RUTA.get(ruta) || null;
};

/** Dónde se deja escrito a qué vino el usuario al cambiar de módulo. */
const CLAVE_INTENCION = "toolkit_intencion_navegacion";

/**
 * Lleva la aplicación a otro módulo desde cualquier componente.
 *
 * `App.tsx` mantiene la vista en un único estado y la sincroniza con la dirección del
 * navegador, escuchando `popstate`. Cambiar la dirección y avisar por ahí evita tener que
 * pasar una función de navegación por toda la cadena de componentes, que en administración
 * atraviesa pantallas muy grandes.
 *
 * `intent` es un recado de un solo uso para el módulo de destino: lo recoge con
 * `takeNavigationIntent()` al montarse, y sirve para abrirlo en la pantalla que hace falta
 * en vez de dejar al usuario buscándola.
 */
export const navigateToModule = (module: AppModule, intent?: string): void => {
  if (intent) {
    try {
      window.sessionStorage.setItem(CLAVE_INTENCION, intent);
    } catch {
      // Sin almacenamiento de sesión se navega igual; solo se pierde el recado.
    }
  }
  window.history.pushState({ view: module }, "", pathForModule(module));
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/** Recoge el recado de navegación y lo borra, para que no se repita al volver a entrar. */
export const takeNavigationIntent = (): string | null => {
  try {
    const intencion = window.sessionStorage.getItem(CLAVE_INTENCION);
    if (intencion) window.sessionStorage.removeItem(CLAVE_INTENCION);
    return intencion;
  } catch {
    return null;
  }
};

/** Recado: abrir Consulta Stock con el panel de conexiones desplegado. */
export const INTENT_OPEN_STOCK_CONNECTIONS = "consulta-stock:conexiones";
