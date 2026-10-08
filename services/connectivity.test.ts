import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El estado vive en el módulo: cada prueba usa uno nuevo.
const fresh = async () => {
  vi.resetModules();
  return import("./connectivity");
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("detección de conexión", () => {
  it("una petición fallida no basta: se comprueba antes de marcar sin conexión", async () => {
    const c = await fresh();
    c.setConnectivityProbe(async () => true); // el servidor responde: fue un corte de un segundo
    await c.reportNetworkFailure();
    expect(c.isOnline()).toBe(true);
  });

  it("si la comprobación también falla, se marca sin conexión y se avisa", async () => {
    const c = await fresh();
    const avisos: boolean[] = [];
    c.subscribeConnectivity((online) => avisos.push(online));
    c.setConnectivityProbe(async () => false);
    await c.reportNetworkFailure();
    expect(c.isOnline()).toBe(false);
    expect(avisos).toEqual([false]);
  });

  it("sin conexión, vuelve a comprobar cada pocos segundos hasta que vuelve", async () => {
    const c = await fresh();
    let responde = false;
    c.setConnectivityProbe(async () => responde);
    await c.reportNetworkFailure();
    expect(c.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(15000);
    expect(c.isOnline()).toBe(false);
    responde = true;
    await vi.advanceTimersByTimeAsync(15000);
    expect(c.isOnline()).toBe(true);
  });

  it("una respuesta cualquiera marca con conexión al instante", async () => {
    const c = await fresh();
    c.setConnectivityProbe(async () => false);
    await c.reportNetworkFailure();
    c.reportNetworkSuccess();
    expect(c.isOnline()).toBe(true);
  });

  it("varias fallas a la vez hacen una sola comprobación", async () => {
    const c = await fresh();
    const probe = vi.fn(async () => false);
    c.setConnectivityProbe(probe);
    await Promise.all([c.reportNetworkFailure(), c.reportNetworkFailure(), c.reportNetworkFailure()]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("dejar de escuchar no recibe más avisos", async () => {
    const c = await fresh();
    const avisos: boolean[] = [];
    const dejar = c.subscribeConnectivity((online) => avisos.push(online));
    dejar();
    c.setOnline(false);
    expect(avisos).toEqual([]);
  });
});

describe("errores de red", () => {
  it("reconoce los mensajes de los navegadores y no los del servidor", async () => {
    const c = await fresh();
    expect(c.isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(c.isNetworkError({ message: "TypeError: NetworkError when attempting to fetch resource." })).toBe(true);
    expect(c.isNetworkError({ message: "Load failed" })).toBe(true);
    expect(c.isNetworkError({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" })).toBe(false);
    expect(c.isNetworkError(null)).toBe(false);
  });
});
