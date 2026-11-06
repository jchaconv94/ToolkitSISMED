import { saveAs } from "file-saver";
import {
  availabilityFileName, availabilityWorkbookBuffer, productsFileName, productsWorkbookBuffer,
  type AvailabilityExportParams, type ProductsExportParams,
} from "./availabilityExport";

/** Genera el Excel en un Worker para no paralizar la página; sin Worker, en la página. */
const buildBuffer = async (message: unknown, fallback: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> => {
  if (typeof Worker !== "undefined") {
    const reply = await new Promise<{ ok: boolean; buffer?: ArrayBuffer; message?: string } | null>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./availabilityExport.worker.ts", import.meta.url), { type: "module" });
      } catch {
        resolve(null);
        return;
      }
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
      worker.onerror = () => { resolve(null); worker.terminate(); };
      try {
        worker.postMessage(message);
      } catch {
        resolve(null);
        worker.terminate();
      }
    });
    if (reply?.ok && reply.buffer) return reply.buffer;
    if (reply && !reply.ok) throw new Error(reply.message || "No se pudo generar el Excel.");
  }
  return fallback();
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const exportAvailabilityExcel = async (params: AvailabilityExportParams) => {
  const buffer = await buildBuffer(params, () => availabilityWorkbookBuffer(params));
  saveAs(new Blob([buffer], { type: XLSX_TYPE }), availabilityFileName(params));
};

/** Una sola hoja de productos: por establecimiento, por farmacia o consolidada por red. */
export const exportProductsExcel = async (params: ProductsExportParams) => {
  const buffer = await buildBuffer({ products: params }, () => productsWorkbookBuffer(params));
  saveAs(new Blob([buffer], { type: XLSX_TYPE }), productsFileName(params));
};
