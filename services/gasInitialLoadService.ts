import {
  fetchGasMetadata,
  fetchGasSelectiveSheets,
  fetchGasWithResilience,
} from "./gasConnectionService";

const withCacheBuster = (rawUrl: string) => {
  const sep = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${sep}_t=${Date.now()}`;
};

/**
 * Primera carga de Consulta Stock.
 *
 * En una instalación/navegador sin caché, antes se pedía el libro completo en una sola
 * ejecución de Apps Script. Con muchas IPRESS esa ejecución debe leer todas las pestañas
 * secuencialmente y el usuario espera hasta recibir el JSON completo.
 *
 * Ahora primero obtenemos metadata ligera y dividimos las pestañas en lotes pequeños. Se
 * procesan como máximo dos lotes en paralelo para mejorar el tiempo total sin bombardear
 * Google Apps Script. Si metadata o algún lote falla, conservamos el fallback completo
 * existente para no sacrificar disponibilidad.
 */
export async function fetchGasInitialWorkbook(
  rawUrl: string,
  options: {
    timeoutMs?: number;
    batchSize?: number;
    concurrency?: number;
  } = {},
): Promise<any> {
  const cleanUrl = (rawUrl || "").trim();
  if (!cleanUrl) return [];

  const timeoutMs = options.timeoutMs || 30_000;
  const batchSize = Math.max(1, Math.min(options.batchSize || 6, 10));
  const concurrency = Math.max(1, Math.min(options.concurrency || 2, 3));

  try {
    const metadata = await fetchGasMetadata(cleanUrl, {
      timeoutMs: Math.min(timeoutMs, 15_000),
      force: true,
    });

    const sheetNames = Array.from(
      new Set(
        (metadata || [])
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean),
      ),
    );

    if (sheetNames.length === 0) {
      return await fetchGasWithResilience(withCacheBuster(cleanUrl), { timeoutMs });
    }

    const batches: string[][] = [];
    for (let i = 0; i < sheetNames.length; i += batchSize) {
      batches.push(sheetNames.slice(i, i + batchSize));
    }

    const results: any[][] = new Array(batches.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= batches.length) return;

        const payload = await fetchGasSelectiveSheets(cleanUrl, batches[index], {
          timeoutMs,
        });

        if (!Array.isArray(payload)) {
          throw new Error(`Respuesta inválida al cargar lote ${index + 1}.`);
        }
        results[index] = payload;
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()),
    );

    return results.flat();
  } catch (error) {
    console.warn(
      "Carga inicial por lotes no disponible; se usará la descarga completa de compatibilidad:",
      error,
    );
    return await fetchGasWithResilience(withCacheBuster(cleanUrl), { timeoutMs: 35_000 });
  }
}
