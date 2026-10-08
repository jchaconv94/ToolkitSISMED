import { afterEach, describe, expect, it } from "vitest";
import { setOfflineCacheStore, withOfflineCache, type CacheStore } from "./offlineCache";

const memoria = (): CacheStore & { datos: Map<string, unknown> } => {
  const datos = new Map<string, unknown>();
  return {
    datos,
    getItem: async <T,>(k: string) => (datos.has(k) ? (datos.get(k) as T) : null),
    setItem: async <T,>(k: string, v: T) => { datos.set(k, v); return v; },
  };
};

afterEach(() => setOfflineCacheStore(null));

describe("copia en este equipo de los catálogos", () => {
  it("con internet devuelve lo leído y lo guarda", async () => {
    const store = memoria();
    setOfflineCacheStore(store);
    expect(await withOfflineCache("catalogo:x", async () => [1, 2])).toEqual([1, 2]);
    expect(store.datos.get("catalogo:x")).toEqual([1, 2]);
  });

  it("sin internet devuelve la última copia guardada", async () => {
    const store = memoria();
    setOfflineCacheStore(store);
    await withOfflineCache("catalogo:x", async () => ["registro real"]);
    const sinRed = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await withOfflineCache("catalogo:x", sinRed)).toEqual(["registro real"]);
  });

  it("sin internet y sin copia, vuelve a lanzar el error (no inventa datos)", async () => {
    setOfflineCacheStore(memoria());
    await expect(withOfflineCache("catalogo:y", () => Promise.reject(new Error("sin red")))).rejects.toThrow("sin red");
  });

  it("si el almacenamiento falla, lo leído igual se devuelve", async () => {
    setOfflineCacheStore({
      getItem: () => Promise.reject(new Error("bloqueado")),
      setItem: () => Promise.reject(new Error("sin espacio")),
    });
    expect(await withOfflineCache("catalogo:z", async () => "ok")).toBe("ok");
    await expect(withOfflineCache("catalogo:z", () => Promise.reject(new Error("sin red")))).rejects.toThrow("sin red");
  });

  it("cada catálogo tiene su copia", async () => {
    const store = memoria();
    setOfflineCacheStore(store);
    await withOfflineCache("catalogo:a", async () => "A");
    await withOfflineCache("catalogo:b", async () => "B");
    expect(await withOfflineCache("catalogo:a", () => Promise.reject(new Error()))).toBe("A");
  });
});
