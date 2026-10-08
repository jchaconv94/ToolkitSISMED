import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_SESSION_DAYS,
  clearStoredSession,
  keptSession,
  keptSessionUsable,
  markSessionValidated,
  pendingLogoutToken,
  readSessionToken,
  readStoredUser,
  setLoginNotice,
  setPendingLogoutToken,
  startStoredSession,
  takeLoginNotice,
  writeSessionToken,
} from "./sessionStore";

const memoria = () => {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
    removeItem: (k: string) => { datos.delete(k); },
  };
};

let local: ReturnType<typeof memoria>;
let session: ReturnType<typeof memoria>;
const usuario = JSON.stringify({ username: "ana", role: "FARMACIA" });

beforeEach(() => {
  local = memoria();
  session = memoria();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
});
afterEach(() => vi.unstubAllGlobals());

describe("plazo sin internet de la sesión mantenida", () => {
  const ahora = new Date("2026-10-08T12:00:00Z");
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 86400000).toISOString();

  it("abre hasta el último día del plazo y no después", () => {
    expect(OFFLINE_SESSION_DAYS).toBeGreaterThan(30); // los establecimientos se conectan cada mes
    expect(keptSessionUsable({ username: "ana", validatedAt: hace(31) }, ahora)).toBe(true);
    expect(keptSessionUsable({ username: "ana", validatedAt: hace(OFFLINE_SESSION_DAYS) }, ahora)).toBe(true);
    expect(keptSessionUsable({ username: "ana", validatedAt: hace(OFFLINE_SESSION_DAYS + 1) }, ahora)).toBe(false);
  });

  it("no abre con datos incompletos o una fecha que no se entiende", () => {
    expect(keptSessionUsable(null, ahora)).toBe(false);
    expect(keptSessionUsable({ username: "", validatedAt: hace(1) }, ahora)).toBe(false);
    expect(keptSessionUsable({ username: "ana", validatedAt: "ayer" }, ahora)).toBe(false);
  });
});

describe("dónde se guarda la sesión", () => {
  it("sin la casilla, en la pestaña: cerrar el navegador la cierra", () => {
    writeSessionToken("t1");
    startStoredSession(usuario, false);
    expect(session.datos.get("aura_auth_user")).toBe(usuario);
    expect(session.datos.get("aura_session_token")).toBe("t1");
    expect(local.datos.size).toBe(0);
    expect(keptSession()).toBeNull();
  });

  it("con la casilla, en el equipo, con la fecha de la comprobación", () => {
    writeSessionToken("t1"); // el token llega antes de saber si se mantiene
    startStoredSession(usuario, true, new Date("2026-10-08T12:00:00Z"));
    expect(session.datos.size).toBe(0);
    expect(local.datos.get("aura_auth_user")).toBe(usuario);
    expect(local.datos.get("aura_session_token")).toBe("t1");
    expect(keptSession()).toEqual({ username: "ana", validatedAt: "2026-10-08T12:00:00.000Z" });
    // Al reabrir el navegador (pestaña vacía), se lee del equipo.
    expect(readSessionToken()).toBe("t1");
    expect(readStoredUser()).toBe(usuario);
  });

  it("un token renovado se guarda donde está la sesión", () => {
    writeSessionToken("t1");
    startStoredSession(usuario, true);
    writeSessionToken("t2");
    expect(local.datos.get("aura_session_token")).toBe("t2");
    expect(session.datos.has("aura_session_token")).toBe(false);
  });

  it("cada comprobación con el servidor vuelve a empezar la cuenta de días", () => {
    startStoredSession(usuario, true, new Date("2026-09-01T00:00:00Z"));
    markSessionValidated(new Date("2026-10-08T00:00:00Z"));
    expect(keptSession()?.validatedAt).toBe("2026-10-08T00:00:00.000Z");
  });

  it("sin sesión mantenida, comprobar no crea una", () => {
    startStoredSession(usuario, false);
    markSessionValidated();
    expect(keptSession()).toBeNull();
  });

  it("cerrar sesión borra todo, en la pestaña y en el equipo", () => {
    writeSessionToken("t1");
    startStoredSession(usuario, true);
    session.setItem("aura_auth_user", usuario);
    clearStoredSession();
    expect(readStoredUser()).toBeNull();
    expect(readSessionToken()).toBeNull();
    expect(keptSession()).toBeNull();
    expect(local.datos.size).toBe(0);
  });

  it("no lee del equipo un token que quedó sin sesión mantenida", () => {
    local.setItem("aura_session_token", "huerfano");
    local.setItem("aura_auth_user", usuario);
    expect(readSessionToken()).toBeNull();
    expect(readStoredUser()).toBeNull();
  });
});

describe("cierre pendiente y aviso del inicio de sesión", () => {
  it("guarda el token de una sesión cerrada sin internet hasta avisar al servidor", () => {
    setPendingLogoutToken("t9");
    expect(pendingLogoutToken()).toBe("t9");
    clearStoredSession(); // cerrar sesión no lo borra: falta avisar al servidor
    expect(pendingLogoutToken()).toBe("t9");
    setPendingLogoutToken(null);
    expect(pendingLogoutToken()).toBeNull();
  });

  it("el aviso se muestra una sola vez", () => {
    setLoginNotice("Su sesión venció.");
    expect(takeLoginNotice()).toBe("Su sesión venció.");
    expect(takeLoginNotice()).toBeNull();
  });
});

describe("sin almacenamiento disponible", () => {
  it("no falla", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => startStoredSession(usuario, true)).not.toThrow();
    expect(readStoredUser()).toBeNull();
    expect(keptSession()).toBeNull();
  });
});
