import { describe, expect, it } from "vitest";
import {
  RELAY_MAX_BYTES, allowedCodes, isAllowedDestination, isAllowedRedirect, relayKeysByCode, relayStock,
} from "../../../supabase/functions/stock-relay/index";

// Direcciones de mentira: nunca la de una UNGET real.
const DESTINO = "https://script.google.com/macros/s/AKfycbPRUEBA_relay-0123456789/exec";
const ECHO = "https://script.googleusercontent.com/macros/echo?user_content_key=abc&lib=x";
const SUPABASE = "https://supabase.prueba";

type Call = { url: string; init?: RequestInit };

/** fetch simulado: Supabase responde `verify`, Google responde con redirección y luego `google`. */
function fakeFetch(options: {
  verify?: unknown;
  verifyStatus?: number;
  verifyThrows?: boolean;
  googleThrows?: boolean;
  location?: string | null;
  google?: { status: number; text: string };
}) {
  const calls: Call[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith(SUPABASE)) {
      if (options.verifyThrows) throw new Error("sin red");
      return new Response(JSON.stringify(options.verify ?? {}), { status: options.verifyStatus ?? 200 });
    }
    if (options.googleThrows) throw new Error("sin red");
    if (url.startsWith("https://script.google.com/")) {
      if (options.location === null) return new Response(options.google?.text ?? "OK:1", { status: options.google?.status ?? 200 });
      return new Response(null, { status: 302, headers: { Location: options.location ?? ECHO } });
    }
    return new Response(options.google?.text ?? "OK:1 registros", { status: options.google?.status ?? 200 });
  }) as typeof fetch;
  return { calls, doFetch };
}

const permitido = { "06506": { protegido: true, permitido: true, motivo: "ACEPTADO" } };

function request(overrides: { destino?: string; params?: string; body?: string; method?: string; headers?: Record<string, string> } = {}) {
  const params = overrides.params ?? new URLSearchParams({
    equipo: "PC-FARMACIA", equipo_id: "win-abc", clave: "06506-AAAA-BBBB-CCCC", omit_zero_stock: "1", reported_almcods: "06506F01",
  }).toString();
  const method = overrides.method ?? "POST";
  return new Request("https://servicio.prueba/stock", {
    method,
    headers: { "X-Toolkit-Destino": overrides.destino ?? DESTINO, "X-Toolkit-Params": params, "Content-Type": "application/json", ...overrides.headers },
    body: method === "POST" ? (overrides.body ?? '[{"almcod":"06506F01","saldo":5}]') : undefined,
  });
}

const env = (doFetch: typeof fetch) => ({ supabaseUrl: SUPABASE, anonKey: "anon", fetch: doFetch });

describe("destinos permitidos", () => {
  it("acepta solo Web App de Apps Script", () => {
    expect(isAllowedDestination(DESTINO)).toBe(true);
    expect(isAllowedDestination("https://script.google.com/a/macros/diresa.gob.pe/s/AKfycbPRUEBA_relay-0123456789/exec")).toBe(true);
    expect(isAllowedDestination("http://script.google.com/macros/s/AKfycbPRUEBA_relay-0123456789/exec")).toBe(false);
    expect(isAllowedDestination("https://script.google.com.atacante.com/macros/s/AKfycbPRUEBA_relay-0123456789/exec")).toBe(false);
    expect(isAllowedDestination("https://script.google.com/macros/s/AKfycbPRUEBA_relay-0123456789/exec?x=1")).toBe(false);
    expect(isAllowedDestination("https://script.google.com/macros/s/AKfycbPRUEBA_relay-0123456789/dev")).toBe(false);
    expect(isAllowedDestination("https://ejemplo.com/exec")).toBe(false);
    expect(isAllowedDestination("")).toBe(false);
  });

  it("sigue solo redirecciones a servidores de Apps Script", () => {
    expect(isAllowedRedirect(ECHO)).toBe(true);
    expect(isAllowedRedirect("https://accounts.google.com/ServiceLogin")).toBe(false);
    expect(isAllowedRedirect("http://script.googleusercontent.com/x")).toBe(false);
    expect(isAllowedRedirect("https://user:pw@script.googleusercontent.com/x")).toBe(false);
    expect(isAllowedRedirect("no es url")).toBe(false);
  });
});

describe("claves", () => {
  it("agrupa las claves por código como el servicio de conexión", () => {
    expect(relayKeysByCode(" 06506-aaaa-bbbb-cccc ; 030S05-DDDD-EEEE-FFFF")).toEqual({
      "06506": "06506-AAAA-BBBB-CCCC",
      "030S05": "030S05-DDDD-EEEE-FFFF",
    });
    expect(relayKeysByCode("")).toEqual({});
    expect(relayKeysByCode("ab-cd")).toEqual({});
  });

  it("solo cuenta códigos protegidos y permitidos", () => {
    expect(allowedCodes({
      "06506": { protegido: true, permitido: true },
      "06519": { protegido: true, permitido: false, motivo: "OTRO_EQUIPO" },
      "06474": { protegido: false, permitido: true },
    })).toEqual(["06506"]);
    expect(allowedCodes(null)).toEqual([]);
    expect(allowedCodes([])).toEqual([]);
  });
});

describe("relayStock", () => {
  it("reenvía a Google con los mismos parámetros y devuelve su respuesta", async () => {
    const { calls, doFetch } = fakeFetch({ verify: permitido, google: { status: 200, text: "OK:1 registros en hojas: X(1)" } });
    const response = await relayStock(request(), env(doFetch));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Relay")).toBe("ok");
    expect(await response.text()).toBe("OK:1 registros en hojas: X(1)");

    const verify = calls[0];
    expect(verify.url).toBe(`${SUPABASE}/rest/v1/rpc/app_send_key_verify`);
    expect(JSON.parse(String(verify.init?.body))).toEqual({ p_items: [{ code: "06506", key: "06506-AAAA-BBBB-CCCC" }], p_device_id: "win-abc" });

    const post = calls[1];
    const url = new URL(post.url);
    expect(`${url.origin}${url.pathname}`).toBe(DESTINO);
    expect(url.searchParams.get("clave")).toBe("06506-AAAA-BBBB-CCCC");
    expect(url.searchParams.get("equipo_id")).toBe("win-abc");
    expect(url.searchParams.get("reported_almcods")).toBe("06506F01");
    expect(post.init?.method).toBe("POST");
    expect(post.init?.redirect).toBe("manual");
    expect(new TextDecoder().decode(post.init?.body as ArrayBuffer)).toBe('[{"almcod":"06506F01","saldo":5}]');

    expect(calls[2].url).toBe(ECHO);
    expect(calls[2].init?.method).toBe("GET");
  });

  it("pasa también los errores de Google, con su código", async () => {
    const { doFetch } = fakeFetch({ verify: permitido, location: null, google: { status: 500, text: "Error interno" } });
    const response = await relayStock(request(), env(doFetch));
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Relay")).toBe("ok");
  });

  it("rechaza sin tocar Google si la clave no es válida", async () => {
    const { calls, doFetch } = fakeFetch({ verify: { "06506": { protegido: true, permitido: false, motivo: "CLAVE_INCORRECTA" } } });
    const response = await relayStock(request(), env(doFetch));
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Relay-Error")).toBe("CLAVE_NO_VALIDA");
    expect((await response.json()).final).toBe(true);
    expect(calls.some((c) => c.url.startsWith("https://script.google.com/"))).toBe(false);
  });

  it("un establecimiento sin clave registrada no habilita el reenvío", async () => {
    const { doFetch } = fakeFetch({ verify: { "06506": { protegido: false, permitido: true } } });
    const response = await relayStock(request(), env(doFetch));
    expect(response.headers.get("X-Relay-Error")).toBe("CLAVE_NO_VALIDA");
  });

  it("sin clave o sin equipo no consulta nada", async () => {
    const { calls, doFetch } = fakeFetch({ verify: permitido });
    const sinClave = await relayStock(request({ params: "equipo_id=win-abc" }), env(doFetch));
    expect(sinClave.headers.get("X-Relay-Error")).toBe("SIN_CLAVE");
    const sinEquipo = await relayStock(request({ params: "clave=06506-AAAA-BBBB-CCCC" }), env(doFetch));
    expect(sinEquipo.headers.get("X-Relay-Error")).toBe("SIN_CLAVE");
    expect(calls).toHaveLength(0);
  });

  it("si Supabase no responde, no reenvía y deja probar el otro camino", async () => {
    for (const options of [{ verifyThrows: true }, { verifyStatus: 500 }]) {
      const { calls, doFetch } = fakeFetch({ verify: permitido, ...options });
      const response = await relayStock(request(), env(doFetch));
      expect(response.status).toBe(503);
      expect((await response.json()).final).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it("rechaza destinos que no son Apps Script", async () => {
    const { calls, doFetch } = fakeFetch({ verify: permitido });
    const response = await relayStock(request({ destino: "https://interno.prueba/admin" }), env(doFetch));
    expect(response.status).toBe(400);
    expect((await response.json()).final).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("no sigue una redirección al inicio de sesión de Google", async () => {
    const { calls, doFetch } = fakeFetch({ verify: permitido, location: "https://accounts.google.com/ServiceLogin?continue=x" });
    const response = await relayStock(request(), env(doFetch));
    expect(response.headers.get("X-Relay-Error")).toBe("REDIRECCION_NO_PERMITIDA");
    expect(calls.some((c) => c.url.startsWith("https://accounts.google.com"))).toBe(false);
  });

  it("si Google no responde, deja probar el otro camino", async () => {
    const { doFetch } = fakeFetch({ verify: permitido, googleThrows: true });
    const response = await relayStock(request(), env(doFetch));
    expect(response.status).toBe(502);
    expect((await response.json()).final).toBe(false);
  });

  it("rechaza envíos demasiado grandes antes de consultar", async () => {
    const { calls, doFetch } = fakeFetch({ verify: permitido });
    const response = await relayStock(request({ headers: { "Content-Length": String(RELAY_MAX_BYTES + 1) } }), env(doFetch));
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("solo acepta POST y necesita configuración", async () => {
    const { doFetch } = fakeFetch({ verify: permitido });
    expect((await relayStock(request({ method: "GET" }), env(doFetch))).status).toBe(405);
    const sinConfig = await relayStock(request(), { supabaseUrl: "", anonKey: "", fetch: doFetch });
    expect(sinConfig.status).toBe(503);
  });
});
