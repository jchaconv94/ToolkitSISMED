import { loadSourceData, type SourceRequest } from "./guidesReviewLoad";

/**
 * Lee los DBF del SISMED fuera de la pantalla: un TFORMDET de varios meses pesa cientos de MB
 * y leerlo en la página la congelaría.
 */
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (message: unknown) => void };

ctx.onmessage = async (e: MessageEvent<SourceRequest>) => {
  try {
    ctx.postMessage({ ok: true, result: await loadSourceData(e.data) });
  } catch (err) {
    ctx.postMessage({ ok: false, message: (err as Error)?.message || "No se pudieron leer los archivos del SISMED." });
  }
};
