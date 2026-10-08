import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SW_PRECACHE_PLACEHOLDER, SW_VERSION_PLACEHOLDER, fillServiceWorker, precacheEntries } from "./precacheManifest";

describe("archivos que guarda el service worker", () => {
  it("guarda todo el build menos el propio sw.js, 404.html y los mapas", () => {
    const files = [
      "index.html", "404.html", "sw.js", "manifest.webmanifest", "favicon.svg",
      "assets/index-abc.js", "assets/index-abc.js.map", "assets/tformdetReader.worker-x.js",
      "assets\\availabilityExport.worker-y.js", ".DS_Store",
    ];
    expect(precacheEntries(files)).toEqual([
      "assets/availabilityExport.worker-y.js",
      "assets/index-abc.js",
      "assets/tformdetReader.worker-x.js",
      "favicon.svg",
      "index.html",
      "manifest.webmanifest",
    ]);
  });

  it("escribe la versión y la lista en public/sw.js", () => {
    const template = readFileSync("public/sw.js", "utf8");
    expect(template).toContain(SW_VERSION_PLACEHOLDER);
    expect(template).toContain(SW_PRECACHE_PLACEHOLDER);
    const filled = fillServiceWorker(template, "20261008-abc", ["index.html", "assets/a.js"]);
    expect(filled).toContain('const VERSION = "20261008-abc";');
    expect(filled).toContain('const PRECACHE = ["index.html","assets/a.js"];');
    expect(filled).not.toContain(SW_PRECACHE_PLACEHOLDER);
  });

  it("falla el build si el service worker perdió sus marcadores", () => {
    expect(() => fillServiceWorker("self.addEventListener('fetch', () => {});", "v", ["index.html"])).toThrow(/sin internet/);
  });
});
