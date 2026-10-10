/*
 * Service worker de Toolkit SISMED.
 *
 * 2026-10-03: nació solo para que el navegador ofrezca «Instalar app».
 * 2026-10-08: modo sin internet. Al instalarse guarda todos los archivos de la app (la lista
 * la escribe el build: `offlinePrecache` en vite.config.ts), así la app abre sin internet y
 * las herramientas que trabajan en el navegador funcionan aunque nunca se hayan abierto antes.
 *
 * - Páginas: primero la red (así siempre carga la versión recién publicada); si no responde en
 *   unos segundos, la guardada.
 * - Archivos de la app (con nombre único por versión): primero los guardados.
 * - Letras de Google Fonts: se guardan la primera vez que se usan.
 * - Datos (Supabase, Google Sheets, Cloudflare): nunca se guardan aquí; van siempre a la red.
 *
 * Al publicar una versión nueva, este archivo cambia, el navegador lo instala solo y se
 * borran las copias viejas (se conserva la anterior, por si una pestaña abierta la usa).
 */

const VERSION = "20261010172702-54300efa2e";
const PRECACHE = ["apple-touch-icon.png","assets/NotoSans-Bold-D7La9DZe.ttf","assets/NotoSans-Regular-BJuaR_yQ.ttf","assets/availabilityExport.worker-DBG6y6__.js","assets/html2canvas.esm-QH1iLAAe.js","assets/index-ChiJvV3o.js","assets/index-sznSGRG1.css","assets/index.es-B_K5cTG3.js","assets/purify.es-C_uT9hQ1.js","assets/tformdetReader.worker-DbGLFKbR.js","favicon.svg","icon-192.png","icon-512.png","icon-maskable-512.png","index.html","manifest.webmanifest"];

const APP_PREFIX = "toolkit-sismed-app-";
const APP_CACHE = APP_PREFIX + VERSION;
const FONT_CACHE = "toolkit-sismed-fuentes";
const KEEP_APP_CACHES = 2;
const NAV_TIMEOUT_MS = 4000;
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Work+Sans:wght@600;800&display=swap";

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

// Sin `ignoreVary`, la copia no sirve: los servidores marcan los archivos con «Vary: Origin» y
// el navegador pide el JS y el CSS principales con cabecera Origin (son `crossorigin`), que la
// copia guardada al instalar no lleva. Comprobado el 2026-10-08: sin esto la app no abría sin
// internet. El contenido es el mismo venga de donde venga la petición.
const MATCH = { ignoreSearch: true, ignoreVary: true };

/** Deja guardadas las letras desde la instalación (si hay internet); si falla, se guardan al usarse. */
const warmFonts = async () => {
  try {
    const cache = await caches.open(FONT_CACHE);
    const response = await fetch(FONTS_CSS, { mode: "cors" });
    if (!response.ok) return;
    await cache.put(FONTS_CSS, response.clone());
    const css = await response.text();
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
    await Promise.all(urls.map(async (url) => {
      if (await cache.match(url)) return;
      const font = await fetch(url, { mode: "cors" });
      if (font.ok) await cache.put(url, font);
    }));
  } catch {
    /* sin internet al instalar: se guardan cuando se usen */
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (PRECACHE.length) {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(PRECACHE.map((path) => new Request(scopeUrl(path), { cache: "reload" })));
    }
    await warmFonts();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // VERSION empieza con la fecha del build: ordenar por nombre deja las más nuevas al final.
    const old = (await caches.keys()).filter((name) => name.startsWith(APP_PREFIX) && name !== APP_CACHE).sort().reverse();
    await Promise.all(old.slice(KEEP_APP_CACHES - 1).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("tiempo agotado")), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

/** Página de la app (cualquier ruta): la red primero; sin respuesta, la guardada. */
const navigate = async (request) => {
  try {
    const response = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
    // GitHub Pages responde las rutas internas con 404.html, que es la misma app.
    if (response.ok || response.status === 404) return response;
    const cached = await caches.match(scopeUrl("index.html"), MATCH);
    return cached || response;
  } catch {
    const cached = await caches.match(scopeUrl("index.html"), MATCH);
    return cached || Response.error();
  }
};

/** Archivo de la app: el guardado primero; si no está, de la red (y se guarda). */
const appFile = async (request) => {
  const cached = await caches.match(request, MATCH);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(APP_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

/** Letras: lo guardado al instante y se actualiza por detrás. */
const fontFile = async (request) => {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    event.respondWith(request.mode === "navigate" ? navigate(request) : appFile(request));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(fontFile(request));
  }
  // Lo demás (Supabase, Google, Cloudflare) va directo a la red.
});
