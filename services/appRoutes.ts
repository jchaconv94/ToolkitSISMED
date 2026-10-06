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
  HOME: "/inicio",
  DASHBOARD: "/analisis",
  ANALYSIS: "/analisis-inteligente",
  ANALYSIS_EXCLUSIONS: "/analisis/exclusiones",
  AVAILABILITY: "/disponibilidad",
  SIG_SEARCH: "/consulta-stock",
  REDISTRIBUTION: "/redistribucion",
  IPRESS_STOCK: "/stock-sismed",
  PROFILE: "/perfil",

  ADMIN_USERS: "/administracion/usuarios",
  ADMIN_ROLES: "/administracion/roles",
  ADMIN_FACILITIES: "/administracion/establecimientos",
  ADMIN_CATALOGS: "/administracion/regimenes-profesiones",
  ADMIN_PARAMS: "/administracion/parametros",
  ADMIN_STOCK_ASSIGN: "/administracion/asignar-stock",
  ADMIN_SEND_KEYS: "/administracion/claves-de-envio",
  ADMIN_BACKUPS: "/administracion/backups-sismed"
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
export const pathForModule = (module: AppModule): string => `${APP_BASE}${RUTAS[module] || RUTAS.HOME}`;

/**
 * Módulo que corresponde a una dirección, o `null` si no reconoce ninguna.
 *
 * Acepta la dirección con o sin el prefijo de publicación, porque en desarrollo y en
 * producción la aplicación cuelga de rutas distintas. La raíz es Inicio.
 */
export const moduleForPath = (pathname: string): AppModule | null => {
  let ruta = normalizar(pathname);
  if (ruta.startsWith(`${APP_BASE}/`)) ruta = ruta.slice(APP_BASE.length);
  if (ruta === APP_BASE || ruta === "" || ruta === "/") return "HOME";
  return MODULOS_POR_RUTA.get(ruta) || null;
};

/**
 * Pantalla de una sección en el teléfono (la lista de herramientas de «Stock», etc.).
 *
 * No es un módulo: es Inicio con la sección abierta, `/inicio?seccion=stock`. Va en la
 * dirección para que forme parte del historial y la flecha «volver» (y el botón atrás de
 * Android) regrese de una herramienta a la sección desde la que se abrió.
 */
const PARAMETRO_SECCION = "seccion";

/** Dirección de la pantalla de una sección. */
export const pathForSection = (sectionId: string): string =>
  `${pathForModule("HOME")}?${PARAMETRO_SECCION}=${encodeURIComponent(sectionId)}`;

/** Dirección de una vista: la del módulo o, en Inicio con una sección abierta, la de la sección. */
export const pathForView = (module: AppModule, sectionId: string | null): string =>
  module === "HOME" && sectionId ? pathForSection(sectionId) : pathForModule(module);

/** Sección abierta según la consulta de la dirección (`?seccion=stock`), o `null`. */
export const sectionForSearch = (search: string): string | null => {
  try {
    const valor = new URLSearchParams(search).get(PARAMETRO_SECCION);
    return valor && valor.trim() ? valor.trim() : null;
  } catch {
    return null;
  }
};

/**
 * Vista que corresponde a una dirección completa: el módulo y, solo en Inicio, la sección
 * abierta. Una dirección desconocida es Inicio sin sección.
 */
export const viewForLocation = (pathname: string, search: string): { module: AppModule; section: string | null } => {
  const module = moduleForPath(pathname) || "HOME";
  return { module, section: module === "HOME" ? sectionForSearch(search) : null };
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
