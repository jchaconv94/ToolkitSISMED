/*
 * Service worker mínimo de Toolkit SISMED (2026-10-03).
 *
 * Existe solo porque los navegadores lo piden para ofrecer «Instalar app». No guarda
 * nada en caché: cada pedido va a la red, así la app instalada siempre carga la versión
 * recién publicada (igual que en el navegador) y nunca sirve datos viejos.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Sin respondWith: el navegador hace el pedido normal a la red.
});
