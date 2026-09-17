/**
 * Servicio de conexión resiliente y diagnóstico para Google Apps Script Web Apps.
 * Usa conexión directa con reintentos ante fallos pasajeros; no envía URLs ni stock a proxies CORS públicos.
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

export interface GasDiagnosis {
  error: string;
  diagnostic: string;
  /** Fallo pasajero de Google: conviene reintentar y conservar los datos guardados. */
  transient: boolean;
}

/** Error de una consulta a la Web App, con el diagnóstico ya resuelto. */
export class GasRequestError extends Error {
  readonly transient: boolean;
  readonly diagnostic: string;

  constructor(diagnosis: GasDiagnosis) {
    super(`${diagnosis.error}: ${diagnosis.diagnostic}`);
    this.name = "GasRequestError";
    this.transient = diagnosis.transient;
    this.diagnostic = diagnosis.diagnostic;
  }
}

/**
 * La Web App responde en dos saltos: `script.google.com/.../exec` (ejecuta el script)
 * redirige a `script.googleusercontent.com/macros/echo` (entrega el resultado). Un 404
 * en el segundo salto es un fallo pasajero de Google: la implementación existe. Una
 * implementación inexistente responde 404 en el primer salto, sin redirección.
 */
const isGoogleEchoUrl = (url?: string) =>
  String(url || "").includes("script.googleusercontent.com");

export const GAS_TRANSIENT_ERROR = "Google no respondió (error temporal)";

export function diagnoseGasResponse(
  status: number,
  responseText: string,
  errorObj?: any,
  finalUrl?: string,
): GasDiagnosis {
  const text = (responseText || "").toLowerCase();

  if (status === 404 && isGoogleEchoUrl(finalUrl)) {
    return {
      error: GAS_TRANSIENT_ERROR,
      diagnostic:
        "Google Apps Script ejecutó la consulta pero no entregó la respuesta (404 temporal). La URL es válida; se reintentará automáticamente.",
      transient: true,
    };
  }

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
      transient: false,
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
      transient: false,
    };
  }

  if (status >= 500) {
    return {
      error: GAS_TRANSIENT_ERROR,
      diagnostic: `El servidor de Google respondió con error ${status}. Se reintentará automáticamente.`,
      transient: true,
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
      transient: false,
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
      transient: true,
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
      transient: true,
    };
  }

  return {
    error: "Error de conexión / CORS",
    diagnostic:
      errorObj?.message ||
      "No se pudo establecer conexión con los servidores de Google Apps Script. Verifique su conexión o intente nuevamente.",
    transient: true,
  };
}

/**
 * Etiqueta corta para la tarjeta de UNGET a partir del mensaje guardado en
 * `connectionErrors`. `warning` = pasajero (se reintenta solo), `danger` = requiere acción.
 */
export function getGasErrorLabel(message?: string): { label: string; tone: "warning" | "danger" } {
  const text = String(message || "");
  if (text.includes(GAS_TRANSIENT_ERROR)) return { label: "Google no respondió", tone: "warning" };
  if (text.includes("Tiempo de espera")) return { label: "Tiempo de espera agotado", tone: "warning" };
  if (text.includes("cuota")) return { label: "Límite de Google", tone: "warning" };
  if (text.includes("(404)")) return { label: "URL no encontrada (404)", tone: "danger" };
  if (text.includes("Privado")) return { label: "Permisos privados", tone: "danger" };
  return { label: "Error de consulta", tone: "danger" };
}

/** Espera entre reintentos de fallos pasajeros (ms). Hay tantos reintentos como valores. */
const GAS_RETRY_DELAYS_MS = [2000, 5000];

const GAS_SCRIPT_ERROR_PREFIX = "Error desde Google Apps Script";

const waitForRetry = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const parseGasPayload = (raw: string): any => {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && parsed.error) {
      throw new Error(`${GAS_SCRIPT_ERROR_PREFIX}: ${parsed.error}`);
    }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (parsed.contents && typeof parsed.contents === "string") {
        try {
          const inner = JSON.parse(parsed.contents);
          if (inner && typeof inner === "object" && inner.error) {
            throw new Error(`${GAS_SCRIPT_ERROR_PREFIX}: ${inner.error}`);
          }
          if (Array.isArray(inner) || typeof inner === "object") return inner;
        } catch (e: any) {
          if (e?.message?.includes(GAS_SCRIPT_ERROR_PREFIX)) throw e;
        }
      }
      return parsed;
    }
  } catch (e: any) {
    if (e?.message?.includes(GAS_SCRIPT_ERROR_PREFIX)) throw e;
  }
  return null;
};

/**
 * Consulta directa a la Web App con reintentos solo ante fallos pasajeros.
 *
 * Google Apps Script devuelve con frecuencia un 404 temporal en el salto de entrega
 * (más aún mientras las hojas se están escribiendo). Esos fallos, los tiempos de espera
 * y los errores 5xx se reintentan con espera creciente; una URL inexistente, una Web App
 * privada o un error devuelto por el propio script se informan de inmediato.
 */
export async function fetchGasWithResilience(
  rawUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal; retryDelaysMs?: number[] } = {}
): Promise<any> {
  const cleanUrl = (rawUrl || "").trim();
  if (!cleanUrl) {
    throw new Error("La URL de conexión está vacía.");
  }

  const timeoutMs = options.timeoutMs || 50000;
  const retryDelays = options.retryDelaysMs ?? GAS_RETRY_DELAYS_MS;
  const maxAttempts = retryDelays.length + 1;
  let lastDiagnosis: GasDiagnosis = {
    error: "Error de conexión / CORS",
    diagnostic: "No se pudo conectar con la Web App.",
    transient: true,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) break;

    // Los reintentos cambian la URL para no reutilizar una respuesta intermedia.
    const sep = cleanUrl.includes("?") ? "&" : "?";
    const url = attempt === 1 ? cleanUrl : `${cleanUrl}${sep}_t=${Date.now()}&_retry=${attempt - 1}`;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        signal: controller.signal,
        redirect: "follow",
      });
      const text = await res.text().catch(() => "");
      if (res.ok) {
        const parsed = parseGasPayload(text);
        if (parsed) return parsed;
      }
      lastDiagnosis = diagnoseGasResponse(res.status, text, undefined, res.url);
    } catch (err: any) {
      if (err?.message?.includes(GAS_SCRIPT_ERROR_PREFIX)) throw err;
      lastDiagnosis = diagnoseGasResponse(0, "", err);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (!lastDiagnosis.transient) break;
    if (attempt < maxAttempts) {
      console.warn(
        `Apps Script: intento ${attempt}/${maxAttempts} falló (${lastDiagnosis.error}); reintentando.`,
      );
      await waitForRetry(retryDelays[attempt - 1], options.signal);
    }
  }

  throw new GasRequestError(lastDiagnosis);
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
const metadataInflight = new Map<string, Promise<GasSheetMetadata[]>>();
/**
 * Tiempo por intento. Apps Script encola ejecuciones y a veces responde pasados los 30 s;
 * cortar antes solo suma otra ejecución a la cola.
 */
export const GAS_REQUEST_TIMEOUT_MS = 45_000;
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
 * - Si falla, lanza `GasRequestError`: quien llama decide conservar los datos guardados.
 *   Ya no se recurre a descargar el libro completo.
 */
export async function fetchGasMetadata(
  rawUrl: string,
  options: { timeoutMs?: number; force?: boolean } = {}
): Promise<GasSheetMetadata[]> {
  const cleanUrl = normalizeGasBaseUrl(rawUrl || "");
  if (!cleanUrl) throw new Error("La URL de conexión está vacía.");

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
    // Con `force` (reintento manual) la URL es única para no recibir la respuesta fallida.
    const cacheBucket = options.force ? Date.now() : Math.floor(Date.now() / METADATA_CACHE_TTL_MS);
    const metaUrl = `${cleanUrl}${sep}action=getMetadata&_t=${cacheBucket}`;

    try {
      const result = await fetchGasWithResilience(metaUrl, {
        timeoutMs: Math.max(options.timeoutMs || 0, GAS_REQUEST_TIMEOUT_MS),
      });

      if (Array.isArray(result) && result.length > 0) {
        const cacheMetadata = (metadata: GasSheetMetadata[]) => {
          metadataCache.set(cleanUrl, {
            value: metadata,
            expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
          });
          return metadata;
        };

        const isMetadata = result.every(
          (item: any) =>
            item &&
            typeof item === "object" &&
            item.name &&
            (item.lastUpdate !== undefined || item.rowCount !== undefined || !item.data)
        );
        if (isMetadata) {
          return cacheMetadata(result as GasSheetMetadata[]);
        }

        // Compatibilidad con implementaciones GAS antiguas que ignoran action=getMetadata
        // y devuelven el libro completo. Reutilizamos esa misma respuesta en vez de
        // descartarla y volver a descargar todo el archivo una segunda vez.
        const isLegacyWorkbook = result.every(
          (item: any) =>
            item &&
            typeof item === "object" &&
            item.name &&
            item.id !== undefined &&
            Array.isArray(item.data),
        );
        if (isLegacyWorkbook) {
          const normalizeKey = (value: string) =>
            String(value || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "");
          const readRowValue = (row: Record<string, any>, aliases: string[]) => {
            const wanted = new Set(aliases.map(normalizeKey));
            const key = Object.keys(row || {}).find((candidate) => wanted.has(normalizeKey(candidate)));
            const value = key ? row[key] : "";
            return value === undefined || value === null ? "" : String(value).trim();
          };

          const metadata = result
            .map((item: any): GasSheetMetadata => {
              const firstRow = Array.isArray(item.data) && item.data.length > 0 ? item.data[0] : {};
              const sheetName = String(item.name || "").trim();
              const almcod = readRowValue(firstRow, ["ALMCOD", "ALM_COD"]);
              const suffix = sheetName.match(/-([A-Z0-9]+)\s*$/i)?.[1]?.toUpperCase() || "";
              return {
                id: String(item.id || ""),
                name: sheetName,
                lastUpdate: readRowValue(firstRow, [
                  "ULTIMA_ACTUALIZACION",
                  "ULTIMA ACTUALIZACION",
                  "ULTIMA ACTUALIZACIÓN",
                  "Ultima_Actualizacion",
                ]),
                equipmentDate: readRowValue(firstRow, [
                  "FECHA_DEL_EQUIPO",
                  "FECHA DEL EQUIPO",
                  "Fecha_Del_Equipo",
                ]),
                almcod,
                codigoIpress: suffix || (almcod ? almcod.substring(0, 5) : ""),
                rowCount: Array.isArray(item.data) ? item.data.length : 0,
              };
            })
            .filter((item: GasSheetMetadata) => item.id && item.name);

          if (metadata.length > 0) return cacheMetadata(metadata);
        }
      }
      throw new GasRequestError({
        error: "Respuesta inesperada de la Web App",
        diagnostic:
          "La Web App respondió, pero no devolvió el listado de hojas. Verifique que la implementación publicada corresponda a backend/STOCK_WEBAPP.gs.",
        transient: false,
      });
    } catch (e: any) {
      console.warn("Apps Script: no se pudo obtener la metadata de las hojas:", e?.message || e);
      throw e;
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
    timeoutMs: options.timeoutMs || GAS_REQUEST_TIMEOUT_MS,
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
    timeoutMs: options.timeoutMs || GAS_REQUEST_TIMEOUT_MS,
  });
}
