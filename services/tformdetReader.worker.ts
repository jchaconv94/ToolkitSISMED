import { readFirstSheetFast } from "./fastXlsx";
import { tformdetFromSheet } from "./tformdetFile";

/**
 * Lee la consulta TFORMDET fuera de la pantalla (2026-10-06): un archivo de 12 meses tardaba
 * ~20 s con SheetJS y congelaba la página. Aquí se usa el lector rápido (~6 s). Si el lector
 * rápido falla, se responde `retry` y el módulo lo intenta con SheetJS.
 */
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (message: unknown) => void };

ctx.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; name: string }>) => {
  let sheet: unknown[][];
  try {
    sheet = readFirstSheetFast(e.data.buffer);
  } catch (err) {
    ctx.postMessage({ ok: false, retry: true, message: (err as Error)?.message });
    return;
  }
  try {
    ctx.postMessage({ ok: true, result: tformdetFromSheet(sheet, e.data.name) });
  } catch (err) {
    ctx.postMessage({ ok: false, retry: false, message: (err as Error)?.message || "No se pudo leer el archivo." });
  }
};
