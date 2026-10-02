import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import { DownloadError, downloadWithResume, savedFileName, verifyBackup } from "./backupDownloader";
import { sha256Hex } from "./backupConnection";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/** Respuesta que entrega `chunk` y luego, si `cut`, corta la conexión. */
const respond = (chunk: Uint8Array, status: number, cut = false) => {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) { sent = true; controller.enqueue(chunk); return; }
      if (cut) controller.error(new Error("corte de red"));
      else controller.close();
    },
  });
  return new Response(body, { status });
};

afterEach(() => vi.unstubAllGlobals());

describe("downloadWithResume", () => {
  it("retoma con Range desde el último byte después de un corte", async () => {
    const file = bytes(1000);
    const ranges: Array<string | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const range = (init.headers as Record<string, string>).Range;
      ranges.push(range);
      if (!range) return respond(file.slice(0, 400), 200, true); // se corta a los 400
      const from = Number(/bytes=(\d+)-/.exec(range)![1]);
      return respond(file.slice(from), 206);
    }));
    const progress: number[] = [];
    const data = await downloadWithResume("https://x/download", 1000, (n) => progress.push(n), { wait: async () => undefined });
    expect(ranges).toEqual([undefined, "bytes=400-"]);
    expect(progress.at(-1)).toBe(1000);
    expect(Array.from(data)).toEqual(Array.from(file));
  });

  it("si el servidor ignora el Range, empieza de nuevo sin mezclar bytes", async () => {
    const file = bytes(300);
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++call === 1 ? respond(file.slice(0, 100), 200, true) : respond(file, 200))));
    const data = await downloadWithResume("https://x/download", 300, () => undefined, { wait: async () => undefined });
    expect(Array.from(data)).toEqual(Array.from(file));
  });

  it("un permiso vencido o un backup borrado no se reintenta", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 410 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadWithResume("https://x/download", 10, () => undefined, { wait: async () => undefined })).rejects.toBeInstanceOf(DownloadError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("se rinde tras varios cortes seguidos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(downloadWithResume("https://x/download", 10, () => undefined, { wait: async () => undefined })).rejects.toThrow(/demasiadas veces/);
  });
});

describe("verifyBackup y nombre", () => {
  it("acepta solo el archivo con la misma huella y tamaño", async () => {
    const file = bytes(64);
    const sha = await sha256Hex(file.buffer.slice(0) as ArrayBuffer);
    expect(await verifyBackup(file, 64, sha)).toBe(true);
    expect(await verifyBackup(file, 65, sha)).toBe(false);
    const dañado = file.slice(); dañado[3] ^= 1;
    expect(await verifyBackup(dañado, 64, sha)).toBe(false);
  });
  it("el código va delante del nombre del SISMED", () => {
    expect(savedFileName("06525", "BKDA202610021300.zip")).toBe("06525_BKDA202610021300.zip");
  });
});
