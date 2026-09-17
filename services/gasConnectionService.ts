/**
 * Servicio de conexión resiliente y diagnóstico para Google Apps Script Web Apps.
 * Usa conexión directa y un reintento anti-caché; no envía URLs ni stock a proxies CORS públicos.
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

  if (
    errorObj?.name === "AbortError" ||
    text.includes("timeout") ||
    text.includes("aborted")
  ) {
    return {
      error: "Tiempo de espera agotado",
      diagnostic:
        "El servidor de Google tardó demasiado en responder. La hoja puede ser muy pesada o el script está bloqueado.",
    };
  }

  return {
    error: "Error de conexión / CORS",
    diagnostic:
      errorObj?.message ||
      "No se pudo establecer conexión con los servidores de Google Apps Script. Verifique su conexión o intente nuevamente.",
  };
}

/**
 * Consulta resiliente mediante conexión directa y un único reintento directo.
 */
export async function fetchGasWithResilience(
  rawUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<any> {
  const cleanUrl = (rawUrl || "").trim();
  if (!cleanUrl) {
    throw new Error("La URL de conexión está vacía.");
  }

  const timeoutMs = options.timeoutMs || 50000;
  let lastDiagnostic = "No se pudo conectar con la Web App.";

  const parseGasPayload = (raw: string): any => {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.error) {
        throw new Error(`Error desde Google Apps Script: ${parsed.error}`);
      }
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        if (parsed.contents && typeof parsed.contents === "string") {
          try {
            const inner = JSON.parse(parsed.contents);
            if (inner && typeof inner === "object" && inner.error) {
              throw new Error(`Error desde Google Apps Script: ${inner.error}`);
            }
            if (Array.isArray(inner) || typeof inner === "object") return inner;
          } catch {}
        }
        return parsed;
      }
    } catch (e: any) {
      if (e.message && e.message.includes("Error desde Google Apps Script")) {
        throw e;
      }
    }
    return null;
  };

  // Estrategia 1: fetch directo.
  try {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(cleanUrl, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        signal: controller.signal,
        redirect: "follow",
      });

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
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  } catch (err: any) {
    const diag = diagnoseGasResponse(0, "", err);
    lastDiagnostic = diag.diagnostic;
  }

  // Estrategia 2: reintento directo con bypass de caché.
  try {
    const sep = cleanUrl.includes("?") ? "&" : "?";
    const cacheBusterUrl = `${cleanUrl}${sep}_t=${Date.now()}&_retry=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(cacheBusterUrl, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        signal: controller.signal,
        redirect: "follow",
      });

      if (res.ok) {
        const text = await res.text();
        try {
          const parsed = parseGasPayload(text);
          if (parsed) return parsed;
        } catch (e: any) {
          if (e.message && e.message.includes("Error desde Google Apps Script")) {
            throw e;
          }
        }
        const diag = diagnoseGasResponse(res.status, text);
        lastDiagnostic = diag.diagnostic;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Error desde Google Apps Script")) {
      throw err;
    }
  }


  throw new Error(lastDiagnostic);
}

export interface GasSheetMetadata {
  id: string;
  name: string;
  lastUpdate?: string;
  equipmentDate?: string;
  almcod?: string;
  codigoIpress?: string;
  rowCount?: number;
}

type MetadataCacheEntry = {
  value: GasSheetMetadata[];
  expiresAt: number;
};

// Varias pantallas pueden pedir los mismos metadatos casi al mismo tiempo. Compartir la
// promesa evita golpear Apps Script dos o tres veces por una sola apertura del módulo.
const metadataCache = new Map<string, MetadataCacheEntry>();
const metadataInflight = new Map<string, Promise<GasSheetMetadata[] | null>>();
const METADATA_CACHE_TTL_MS = 20_000;

const normalizeGasBaseUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl.trim());
    ["action", "sheet", "sheets", "_t", "t", "_retry"].forEach((param) =>
      parsed.searchParams.delete(param),
    );
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
};

/**
 * Consulta ligera de metadatos de las hojas de cálculo.
 *
 * - Reutiliza durante 20 s una respuesta ya obtenida.
 * - Comparte peticiones concurrentes a la misma Web App.
 * - No descarga registros de stock.
 */
export async function fetchGasMetadata(
  rawUrl: string,
  options: { timeoutMs?: number; force?: boolean } = {}
): Promise<GasSheetMetadata[] | null> {
  const cleanUrl = normalizeGasBaseUrl(rawUrl || "");
  if (!cleanUrl) return null;

  const now = Date.now();
  if (!options.force) {
    const cached = metadataCache.get(cleanUrl);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const pending = metadataInflight.get(cleanUrl);
    if (pending) return pending;
  }

  const request = (async () => {
    const sep = cleanUrl.includes("?") ? "&" : "?";
    // Bucket temporal: evita una URL distinta por cada milisegundo y permite que capas de
    // red intermedias reutilicen brevemente una respuesta sin dejar datos obsoletos.
    const cacheBucket = Math.floor(Date.now() / METADATA_CACHE_TTL_MS);
    const metaUrl = `${cleanUrl}${sep}action=getMetadata&_t=${cacheBucket}`;

    try {
      const result = await fetchGasWithResilience(metaUrl, {
        timeoutMs: options.timeoutMs || 18000,
      });

      if (Array.isArray(result) && result.length > 0) {
        const isMetadata = result.every(
          (item: any) =>
            item &&
            typeof item === "object" &&
            item.name &&
            (item.lastUpdate !== undefined || item.rowCount !== undefined || !item.data)
        );
        if (isMetadata) {
          const metadata = result as GasSheetMetadata[];
          metadataCache.set(cleanUrl, {
            value: metadata,
            expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
          });
          return metadata;
        }
      }
      return null;
    } catch (e) {
      console.warn("No se pudo obtener metadatos ligeros de GAS, usando fallback completo:", e);
      return null;
    } finally {
      metadataInflight.delete(cleanUrl);
    }
  })();

  metadataInflight.set(cleanUrl, request);
  return request;
}

/**
 * Descarga una sola hoja mediante el endpoint exacto getStock.
 * Es la ruta preferida cuando el usuario abre un establecimiento: evita leer el libro completo.
 */
export async function fetchGasSingleSheet(
  rawUrl: string,
  sheetName: string,
  options: { timeoutMs?: number } = {}
): Promise<any> {
  const cleanUrl = normalizeGasBaseUrl(rawUrl || "");
  const cleanSheetName = (sheetName || "").trim();
  if (!cleanUrl || !cleanSheetName) return [];

  const sep = cleanUrl.includes("?") ? "&" : "?";
  const singleUrl = `${cleanUrl}${sep}action=getStock&sheet=${encodeURIComponent(cleanSheetName)}&_t=${Date.now()}`;
  return await fetchGasWithResilience(singleUrl, {
    timeoutMs: options.timeoutMs || 25000,
  });
}

/**
 * Descarga selectiva únicamente de las hojas que cambiaron.
 */
export async function fetchGasSelectiveSheets(
  rawUrl: string,
  sheetNames: string[],
  options: { timeoutMs?: number } = {}
): Promise<any> {
  const cleanUrl = normalizeGasBaseUrl(rawUrl || "");
  const uniqueNames = Array.from(new Set(sheetNames.map((name) => name.trim()).filter(Boolean)));
  if (!cleanUrl || uniqueNames.length === 0) return [];

  const sep = cleanUrl.includes("?") ? "&" : "?";
  const sheetsParam = encodeURIComponent(uniqueNames.join(","));
  const selectiveUrl = `${cleanUrl}${sep}sheets=${sheetsParam}&_t=${Date.now()}`;

  return await fetchGasWithResilience(selectiveUrl, {
    timeoutMs: options.timeoutMs || 35000,
  });
}
