import { loadSourceData, type SourceData, type SourceRequest } from "./guidesReviewLoad";

/** Lee en un worker para no congelar la página; si el navegador no puede, aquí mismo. */
export const loadSource = (request: SourceRequest): Promise<SourceData> =>
  new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./guidesReview.worker.ts", import.meta.url), { type: "module" });
    } catch {
      loadSourceData(request).then(resolve, reject);
      return;
    }
    worker.onmessage = (e: MessageEvent<{ ok: true; result: SourceData } | { ok: false; message: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      loadSourceData(request).then(resolve, reject);
    };
    worker.postMessage(request);
  });
