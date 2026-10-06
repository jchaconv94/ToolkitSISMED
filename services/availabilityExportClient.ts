import { saveAs } from "file-saver";
import { availabilityFileName, availabilityWorkbookBuffer, type AvailabilityExportParams } from "./availabilityExport";

/** Genera el Excel en un Worker para no paralizar la página; sin Worker, en la página. */
const buildBuffer = async (params: AvailabilityExportParams): Promise<ArrayBuffer> => {
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
        worker.postMessage(params);
      } catch {
        resolve(null);
        worker.terminate();
      }
    });
    if (reply?.ok && reply.buffer) return reply.buffer;
    if (reply && !reply.ok) throw new Error(reply.message || "No se pudo generar el Excel.");
  }
  return availabilityWorkbookBuffer(params);
};

export const exportAvailabilityExcel = async (params: AvailabilityExportParams) => {
  const buffer = await buildBuffer(params);
  saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), availabilityFileName(params));
};
