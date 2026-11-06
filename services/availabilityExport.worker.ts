import { availabilityWorkbookBuffer, productsWorkbookBuffer, type AvailabilityExportParams, type ProductsExportParams } from "./availabilityExport";

/**
 * Arma y serializa el Excel de Disponibilidad fuera de la pantalla (2026-10-06): con el detalle
 * por producto y el TFORMDET del mes son ~40 000 filas y la página quedaba paralizada. También
 * las descargas de una sola hoja (`{ products }`, 2026-11-06).
 */
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };

ctx.onmessage = async (e: MessageEvent<AvailabilityExportParams | { products: ProductsExportParams }>) => {
  try {
    const data = e.data;
    const buffer = "products" in data ? await productsWorkbookBuffer(data.products) : await availabilityWorkbookBuffer(data);
    ctx.postMessage({ ok: true, buffer }, [buffer]);
  } catch (err) {
    ctx.postMessage({ ok: false, message: (err as Error)?.message || "No se pudo generar el Excel." });
  }
};
