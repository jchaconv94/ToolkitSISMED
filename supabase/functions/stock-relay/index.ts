/**
 * stock-relay · Camino de respaldo para el envío de stock del Toolkit de escritorio.
 *
 * Algunas redes de establecimientos (PRONATEL) bloquean `script.google.com`: desvían su DNS a
 * una IP interna y cortan la conexión por nombre. El Toolkit, si no llega a Google, manda el
 * mismo envío aquí y este servicio lo pasa al mismo Apps Script de la UNGET, de servidor a
 * servidor. Google Sheets sigue siendo la fuente del stock: aquí no se guarda nada.
 *
 * Este archivo es el único código del reenvío y lo usan dos servicios:
 *   - Cloudflare (`cloudflare/conexion`, ruta POST /stock), que lo importa;
 *   - Supabase Edge Functions (función `stock-relay`), que lo publica tal cual.
 * Por eso no importa nada y solo usa fetch, Request y Response.
 *
 * Petición del Toolkit (POST, cuerpo = el mismo JSON que iría a Google):
 *   X-Toolkit-Destino  dirección del Apps Script (solo Web App de script.google.com)
 *   X-Toolkit-Params   los mismos parámetros que van en la URL a Google (clave, equipo_id, ...),
 *                      en una cabecera para que la clave no quede en registros de direcciones
 *
 * Respuesta:
 *   - Lo que respondió Google, con su código HTTP y la cabecera `X-Relay: ok`.
 *   - Si el reenvío no se pudo hacer: JSON {error, message, final} con `X-Relay-Error`.
 *     `final: true` = el otro camino de respaldo daría lo mismo (clave, destino); el Toolkit
 *     no lo intenta.
 *
 * Solo pasa una PC con clave de envío vigente para esa PC (`app_send_key_verify`, la misma
 * consulta que usa el Apps Script). Si Supabase no responde, no se reenvía.
 */

export interface RelayEnv {
  supabaseUrl: string;
  anonKey: string;
  fetch?: typeof fetch;
}

export const RELAY_MAX_BYTES = 32 * 1024 * 1024;
const PARAMS_MAX_CHARS = 16_000;
const MAX_REDIRECTS = 3;

/** Web App de Apps Script: cuenta común o de Google Workspace. Nada más. */
const DESTINATION = /^https:\/\/script\.google\.com\/(?:macros|a\/macros\/[A-Za-z0-9.-]{1,100})\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;
/** Google responde un POST a la Web App con una redirección a su servidor de contenidos. */
const REDIRECT_HOSTS = new Set(["script.google.com", "script.googleusercontent.com"]);

export const isAllowedDestination = (value: string | null | undefined) => DESTINATION.test(String(value || "").trim());

export const isAllowedRedirect = (value: string | null | undefined) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && REDIRECT_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Igual que `keysByCode` del servicio de conexión: la clave de cada código empieza con «código-». */
export const relayKeysByCode = (value: string | null | undefined): Record<string, string> => {
  const mapping: Record<string, string> = {};
  String(value || "")
    .split(/[\s,;]+/)
    .map((k) => k.replace(/\s/g, "").toUpperCase())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((key) => {
      const code = key.split("-")[0];
      if (/^[0-9A-Z]{5,6}$/.test(code)) mapping[code] = key;
    });
  return mapping;
};

type VerifyResult = Record<string, { protegido?: boolean; permitido?: boolean; motivo?: string }>;

/** Códigos cuya clave es la vigente y que esta PC puede enviar. */
export const allowedCodes = (result: unknown): string[] => {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  return Object.entries(result as VerifyResult)
    .filter(([, r]) => Boolean(r && r.protegido && r.permitido))
    .map(([code]) => code)
    .sort();
};

const relayError = (status: number, error: string, message: string, final: boolean) =>
  new Response(JSON.stringify({ error, message, final }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Relay-Error": error, "Cache-Control": "no-store" },
  });

async function verify(env: RelayEnv, doFetch: typeof fetch, keys: Record<string, string>, device: string): Promise<string[]> {
  const items = Object.entries(keys).map(([code, key]) => ({ code, key }));
  const response = await doFetch(`${env.supabaseUrl}/rest/v1/rpc/app_send_key_verify`, {
    method: "POST",
    // Solo `apikey`, como el resto del servicio: la clave nueva de Supabase no es un JWT.
    headers: { apikey: env.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_items: items, p_device_id: device }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return allowedCodes(await response.json());
}

/** Envía a Google siguiendo solo las redirecciones de Apps Script (POST → GET, como un navegador). */
async function toGoogle(doFetch: typeof fetch, destination: string, body: ArrayBuffer): Promise<Response> {
  let response = await doFetch(destination, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    redirect: "manual",
  });
  for (let hop = 0; hop < MAX_REDIRECTS && response.status >= 300 && response.status < 400; hop += 1) {
    const location = response.headers.get("Location");
    const next = location ? new URL(location, destination).toString() : "";
    if (!isAllowedRedirect(next)) {
      throw new RelayStop(502, "REDIRECCION_NO_PERMITIDA",
        "Google respondió con una redirección fuera de Apps Script (¿la Web App pide iniciar sesión?). Revise que esté publicada para «Cualquier persona».", true);
    }
    response = await doFetch(next, { method: "GET", redirect: "manual" });
  }
  if (response.status >= 300 && response.status < 400) {
    throw new RelayStop(502, "DEMASIADAS_REDIRECCIONES", "Google respondió con demasiadas redirecciones.", false);
  }
  return response;
}

class RelayStop extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly final: boolean) {
    super(message);
  }
}

export async function relayStock(request: Request, env: RelayEnv): Promise<Response> {
  const doFetch = env.fetch ?? fetch;
  if (request.method !== "POST") return relayError(405, "METODO_NO_PERMITIDO", "Use POST.", true);
  if (!env.supabaseUrl || !env.anonKey) {
    return relayError(503, "SERVICIO_SIN_CONFIGURAR", "El reenvío no tiene acceso a la verificación de claves.", false);
  }

  const destination = String(request.headers.get("X-Toolkit-Destino") || "").trim();
  if (!isAllowedDestination(destination)) {
    return relayError(400, "DESTINO_NO_VALIDO", "La dirección configurada no es una Web App de Google Apps Script.", true);
  }

  const rawParams = String(request.headers.get("X-Toolkit-Params") || "");
  if (rawParams.length > PARAMS_MAX_CHARS) return relayError(431, "PARAMETROS_DEMASIADO_LARGOS", "Los parámetros del envío son demasiado largos.", true);
  const params = new URLSearchParams(rawParams);
  const keys = relayKeysByCode(params.get("clave"));
  const device = String(params.get("equipo_id") || "").trim().slice(0, 120);
  if (!device || Object.keys(keys).length === 0) {
    return relayError(403, "SIN_CLAVE", "El camino de respaldo solo funciona en una PC con clave de envío configurada.", true);
  }

  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > RELAY_MAX_BYTES) {
    return relayError(413, "ENVIO_DEMASIADO_GRANDE", `El envío supera ${RELAY_MAX_BYTES / 1024 / 1024} MB.`, true);
  }

  let allowed: string[];
  try {
    allowed = await verify(env, doFetch, keys, device);
  } catch {
    return relayError(503, "VERIFICACION_NO_DISPONIBLE", "No se pudo verificar la clave de envío; se reintentará.", false);
  }
  if (!allowed.length) {
    return relayError(403, "CLAVE_NO_VALIDA", "La clave de envío no es la vigente o está vinculada a otra PC.", true);
  }

  // Se lee entero para que Google reciba el largo exacto (sin partes sueltas): pocos MB.
  const body = await request.arrayBuffer();
  if (body.byteLength > RELAY_MAX_BYTES) {
    return relayError(413, "ENVIO_DEMASIADO_GRANDE", `El envío supera ${RELAY_MAX_BYTES / 1024 / 1024} MB.`, true);
  }

  const query = params.toString();
  let upstream: Response;
  try {
    upstream = await toGoogle(doFetch, query ? `${destination}?${query}` : destination, body);
  } catch (error) {
    if (error instanceof RelayStop) return relayError(error.status, error.code, error.message, error.final);
    return relayError(502, "GOOGLE_NO_RESPONDE", "El servicio de respaldo no pudo comunicarse con Google.", false);
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Relay": "ok", "Cache-Control": "no-store" },
  });
}

// Supabase Edge Functions (Deno). En Cloudflare `Deno` no existe y esto no corre.
const deno = (globalThis as { Deno?: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): unknown } }).Deno;
if (deno && typeof deno.serve === "function") {
  deno.serve((request) => relayStock(request, {
    supabaseUrl: deno.env.get("SUPABASE_URL") || "",
    anonKey: deno.env.get("SUPABASE_ANON_KEY") || "",
  }));
}
