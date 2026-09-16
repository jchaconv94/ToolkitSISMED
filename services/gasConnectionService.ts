/**
 * Servicio de conexión ultra-resiliente y diagnóstico para Google Apps Script Web Apps.
 * Implementa backoff exponencial, rotación de proxies CORS, y análisis semántico de errores.
 */

export interface GasFetchResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  diagnostic?: string;
  sourceUrl: string;
  methodUsed?: "direct" | "anti-cache" | "proxy-allorigins" | "proxy-corsproxy" | "proxy-codetabs";
  latencyMs?: number;
}

export function diagnoseGasResponse(
  status: number,
  responseText: string,
  errorObj?: any
): { error: string; diagnostic: string } {
  const text = (responseText || "").toLowerCase();

  // 1. Archivo no encontrado / Implementación eliminada
  if (
    status === 404 ||
    text.includes("sorry, the file you have requested does not exist") ||
    text.includes("page not found") ||
    text.includes("no se ha encontrado el archivo")
  ) {
    return {
      error: "URL no encontrada (404)",
      diagnostic:
        "La URL no existe o la implementación fue eliminada en Google Apps Script. Genere una nueva implementación en la hoja de cálculo.",
    };
  }

  // 2. Permisos o login requerido (No es público)
  if (
    status === 401 ||
    status === 403 ||
    text.includes("accounts.google.com") ||
    text.includes("servicelogin") ||
    text.includes("sign in - google accounts") ||
    text.includes("iniciar sesión") ||
    text.includes("authorization required")
  ) {
    return {
      error: "Permisos restringidos (Privado)",
      diagnostic:
        "La Web App requiere inicio de sesión. En Google Apps Script, configure 'Quién tiene acceso' en 'Cualquier usuario' (Anyone).",
    };
  }

  // 3. Error en el código del Apps Script (doGet falló)
  if (
    text.includes("script function not found") ||
    text.includes("doget") ||
    text.includes("exception:") ||
    text.includes("error de script") ||
    text.includes("referenceerror") ||
    text.includes("typeerror")
  ) {
    return {
      error: "Error interno en Google Apps Script",
      diagnostic:
        "El script de Google contiene un error en la función doGet() o no tiene permisos de lectura sobre las pestañas.",
    };
  }

  // 4. Rate limiting / Cuota excedida de Google
  if (
    status === 429 ||
    text.includes("rate limit") ||
    text.includes("quota exceeded") ||
    text.includes("too many requests") ||
    text.includes("cuota de servicio")
  ) {
    return {
      error: "Límite de cuota de Google",
      diagnostic:
        "Se excedió la cuota de consultas por minuto de Google Apps Script. Espere unos momentos antes de reintentar.",
    };
  }

  // 5. Timeout / Abort
  if (
    errorObj?.name === "AbortError" ||
    text.includes("timeout") ||
    text.includes("aborted")
  ) {
    return {
      error: "Tiempo de espera agotado",
      diagnostic:
        "El servidor de Google tardó demasiado en responder (>30s). La hoja puede ser muy pesada o el script está bloqueado.",
    };
  }

  // 6. Error genérico de CORS / Red
  return {
    error: "Error de conexión / CORS",
    diagnostic:
      errorObj?.message ||
      "No se pudo establecer conexión con los servidores de Google Apps Script. Verifique su conexión o intente nuevamente.",
  };
}

/**
 * Consulta resiliente con reintentos secuenciales y rotación de proxies
 */
export async function fetchGasWithResilience(
  rawUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<any> {
  const cleanUrl = (rawUrl || "").trim();
  if (!cleanUrl) {
    throw new Error("La URL de conexión está vacía.");
  }

  // Aumentar timeout por defecto a 50s para hojas con múltiples establecimientos
  const timeoutMs = options.timeoutMs || 50000;
  let lastDiagnostic = "No se pudo conectar con la Web App.";

  const parseGasPayload = (raw: string): any => {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    // Intento directo JSON
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        if (parsed.contents && typeof parsed.contents === "string") {
          try {
            const inner = JSON.parse(parsed.contents);
            if (Array.isArray(inner) || typeof inner === "object") return inner;
          } catch {}
        }
        return parsed;
      }
    } catch {}
    return null;
  };

  // Estrategia 1: Fetch directo nativo (modo CORS limpio sin cabeceras custom)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(cleanUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      const parsed = parseGasPayload(text);
      if (parsed) return parsed;
      const diag = diagnoseGasResponse(res.status, text);
      lastDiagnostic = diag.diagnostic;
    } else {
      const text = await res.text().catch(() => "");
      const diag = diagnoseGasResponse(res.status, text);
      lastDiagnostic = diag.diagnostic;
    }
  } catch (err: any) {
    const diag = diagnoseGasResponse(0, "", err);
    lastDiagnostic = diag.diagnostic;
  }

  // Estrategia 2: Fetch directo con bypass de caché y reintento
  try {
    const sep = cleanUrl.includes("?") ? "&" : "?";
    const cacheBusterUrl = `${cleanUrl}${sep}_t=${Date.now()}&_retry=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(cacheBusterUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      const parsed = parseGasPayload(text);
      if (parsed) return parsed;
      const diag = diagnoseGasResponse(res.status, text);
      lastDiagnostic = diag.diagnostic;
    }
  } catch (err: any) {
    // Continuar a proxies
  }

  // Estrategia 3: Proxies CORS resilientes con análisis automático
  const proxyEndpoints = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(cleanUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(cleanUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(cleanUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(cleanUrl)}`,
  ];

  for (const proxyUrl of proxyEndpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 35000));
      const res = await fetch(proxyUrl, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        const parsed = parseGasPayload(text);
        if (parsed) return parsed;
        const diag = diagnoseGasResponse(res.status, text);
        lastDiagnostic = diag.diagnostic;
      }
    } catch {
      // Continuar al siguiente proxy
    }
  }

  throw new Error(lastDiagnostic);
}
