import { describe, expect, it } from "vitest";
import {
  clearStoredDevice,
  deviceLoginMessage,
  deviceNameFrom,
  isValidPin,
  readStoredDevice,
  saveStoredDevice,
  shouldForgetDevice,
} from "./deviceAccess";

const memoria = () => {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
    removeItem: (k: string) => { datos.delete(k); },
  };
};

const equipo = { id: "d1", secret: "x".repeat(43), kind: "pin" as const, username: "ana", displayName: "Ana" };

describe("equipo guardado", () => {
  it("guarda, lee y olvida", () => {
    const store = memoria();
    expect(readStoredDevice(store)).toBeNull();
    saveStoredDevice(equipo, store);
    expect(readStoredDevice(store)).toEqual(equipo);
    clearStoredDevice(store);
    expect(readStoredDevice(store)).toBeNull();
  });

  it("descarta datos dañados o incompletos", () => {
    const store = memoria();
    store.setItem("toolkit_acceso_rapido", "{no es json");
    expect(readStoredDevice(store)).toBeNull();
    store.setItem("toolkit_acceso_rapido", JSON.stringify({ ...equipo, secret: "corta" }));
    expect(readStoredDevice(store)).toBeNull();
    store.setItem("toolkit_acceso_rapido", JSON.stringify({ ...equipo, kind: "otro" }));
    expect(readStoredDevice(store)).toBeNull();
  });

  it("sin nombre para saludar usa el usuario", () => {
    const store = memoria();
    store.setItem("toolkit_acceso_rapido", JSON.stringify({ ...equipo, displayName: "" }));
    expect(readStoredDevice(store)?.displayName).toBe("ana");
  });
});

describe("PIN", () => {
  it("exige exactamente 4 dígitos", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });
});

describe("mensajes de ingreso", () => {
  it("dice cuántos intentos quedan", () => {
    expect(deviceLoginMessage({ ok: false, reason: "pin", remaining: 3 })).toBe("PIN incorrecto. Le quedan 3 intentos.");
    expect(deviceLoginMessage({ ok: false, reason: "pin", remaining: 1 })).toBe("PIN incorrecto. Le queda 1 intento.");
  });

  it("olvida el equipo salvo cuando solo se equivocó de PIN", () => {
    expect(shouldForgetDevice({ ok: false, reason: "pin", remaining: 2 })).toBe(false);
    expect(shouldForgetDevice({ ok: false, reason: "bloqueado" })).toBe(true);
    expect(shouldForgetDevice({ ok: false, reason: "equipo" })).toBe(true);
    expect(shouldForgetDevice({ ok: false, reason: "usuario" })).toBe(true);
    expect(shouldForgetDevice({ ok: true, token: "t", username: "ana" })).toBe(false);
  });
});

describe("nombre del equipo", () => {
  it("reconoce sistema y navegador", () => {
    expect(deviceNameFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36")).toBe("Windows · Chrome");
    expect(deviceNameFrom("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("Windows · Edge");
    expect(deviceNameFrom("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceNameFrom("")).toBe("Equipo");
  });
});
