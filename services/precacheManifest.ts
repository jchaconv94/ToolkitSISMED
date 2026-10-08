/**
 * Qué guarda el service worker al instalarse (modo sin internet, 2026-10-08): todos los
 * archivos del build, para que cualquier herramienta abra sin internet aunque nunca se haya
 * abierto antes en ese equipo (incluidos los Web Workers que leen el TFORMDET y arman el
 * Excel). Lo usa el plugin `offlinePrecache` de `vite.config.ts`.
 *
 * Fuera: el propio `sw.js` (el navegador lo baja aparte para buscar versiones nuevas),
 * `404.html` (copia de `index.html` para GitHub Pages) y los mapas de código.
 */
export const precacheEntries = (files: string[]): string[] =>
  [...new Set(files.map((file) => file.replace(/\\/g, "/").replace(/^\.?\//, "")))]
    .filter((file) => file && file !== "sw.js" && file !== "404.html" && !file.endsWith(".map") && !file.split("/").some((part) => part.startsWith(".")))
    .sort();

/** Marcadores de `public/sw.js` que el build reemplaza. */
export const SW_VERSION_PLACEHOLDER = 'const VERSION = "dev";';
export const SW_PRECACHE_PLACEHOLDER = "const PRECACHE = [];";

/**
 * Escribe la versión y la lista en el service worker. Falla si faltan los marcadores: un
 * `sw.js` que no guarda nada dejaría la app sin funcionar sin internet sin que nadie lo note.
 */
export const fillServiceWorker = (template: string, version: string, entries: string[]): string => {
  if (!template.includes(SW_VERSION_PLACEHOLDER) || !template.includes(SW_PRECACHE_PLACEHOLDER)) {
    throw new Error("public/sw.js no tiene los marcadores de VERSION y PRECACHE: la app no funcionaría sin internet.");
  }
  return template
    .replace(SW_VERSION_PLACEHOLDER, `const VERSION = ${JSON.stringify(version)};`)
    .replace(SW_PRECACHE_PLACEHOLDER, `const PRECACHE = ${JSON.stringify(entries)};`);
};
