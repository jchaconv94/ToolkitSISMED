import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GAS_TRANSIENT_ERROR,
  GasRequestError,
  diagnoseGasResponse,
  fetchGasMetadata,
  fetchGasWithResilience,
  getGasErrorLabel,
} from "./gasConnectionService";

const EXEC_URL = "https://script.google.com/macros/s/AKfyTEST/exec";
const ECHO_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=abc";
const GOOGLE_404_HTML = "<!DOCTYPE html><html lang=\"es\"><head><title>No se encontró la página</title></head></html>";

type FakeResponse = { status: number; url: string; body: string };
const fakeFetch = (responses: FakeResponse[]) => {
  const queue = [...responses];
  const mock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch llamado más veces de lo esperado");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      url: next.url,
      text: async () => next.body,
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gasConnectionService", () => {
  it("diagnoses 404 Google Page Not Found response properly", () => {
    const html404 = `<!DOCTYPE html><html><head><title>Page Not Found</title></head><body>Sorry, the file you have requested does not exist.</body></html>`;
    const diag = diagnoseGasResponse(404, html404);
    expect(diag.error).toContain("404");
    expect(diag.diagnostic).toContain("La URL no existe o la implementación fue eliminada");
    expect(diag.transient).toBe(false);
  });

  it("trata como temporal el 404 del salto de entrega de Google (googleusercontent)", () => {
    const diag = diagnoseGasResponse(404, GOOGLE_404_HTML, undefined, ECHO_URL);
    expect(diag.error).toBe(GAS_TRANSIENT_ERROR);
    expect(diag.transient).toBe(true);
    expect(diag.diagnostic).not.toContain("La URL no existe");
  });

  it("un 404 sin redirección sigue siendo una URL inexistente", () => {
    const diag = diagnoseGasResponse(404, GOOGLE_404_HTML, undefined, EXEC_URL);
    expect(diag.error).toContain("(404)");
    expect(diag.transient).toBe(false);
  });

  it("trata los errores 5xx de Google como temporales", () => {
    const diag = diagnoseGasResponse(503, "<html>Service Unavailable</html>");
    expect(diag.transient).toBe(true);
    expect(diag.diagnostic).toContain("503");
  });

  it("diagnoses Google Login / permissions required response", () => {
    const htmlLogin = `<!DOCTYPE html><html><body><a href="https://accounts.google.com/ServiceLogin">Sign in to Google</a></body></html>`;
    const diag = diagnoseGasResponse(200, htmlLogin);
    expect(diag.error).toContain("Privado");
    expect(diag.diagnostic).toContain("Cualquier usuario");
    expect(diag.transient).toBe(false);
  });

  it("diagnoses Apps Script internal runtime exception in doGet", () => {
    const htmlErr = `Error de script: ReferenceError: SpreadsheetApp is not defined in doGet`;
    const diag = diagnoseGasResponse(200, htmlErr);
    expect(diag.error).toContain("Error interno");
    expect(diag.diagnostic).toContain("doGet()");
    expect(diag.transient).toBe(false);
  });

  it("diagnoses AbortError timeout properly", () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    const diag = diagnoseGasResponse(0, "", abortErr);
    expect(diag.error).toContain("Tiempo de espera agotado");
    expect(diag.transient).toBe(true);
  });

  it("diagnoses Rate Limit response properly", () => {
    const diag = diagnoseGasResponse(429, "Too Many Requests. Quota exceeded.");
    expect(diag.error).toContain("cuota");
    expect(diag.transient).toBe(true);
  });
});

describe("getGasErrorLabel", () => {
  it("distingue fallos temporales (ámbar) de fallos que requieren acción (rojo)", () => {
    const transient = new GasRequestError(diagnoseGasResponse(404, "", undefined, ECHO_URL));
    expect(getGasErrorLabel(transient.message)).toEqual({ label: "Google no respondió", tone: "warning" });

    const notFound = new GasRequestError(diagnoseGasResponse(404, "", undefined, EXEC_URL));
    expect(getGasErrorLabel(notFound.message)).toEqual({ label: "URL no encontrada (404)", tone: "danger" });

    const privateApp = new GasRequestError(diagnoseGasResponse(403, ""));
    expect(getGasErrorLabel(privateApp.message).label).toBe("Permisos privados");

    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeout = new GasRequestError(diagnoseGasResponse(0, "", aborted));
    expect(getGasErrorLabel(timeout.message).tone).toBe("warning");

    expect(getGasErrorLabel("Failed to fetch")).toEqual({ label: "Error de consulta", tone: "danger" });
    expect(getGasErrorLabel(undefined).label).toBe("Error de consulta");
  });
});

describe("fetchGasWithResilience", () => {
  it("reintenta el 404 temporal de Google y devuelve la respuesta válida", async () => {
    const mock = fakeFetch([
      { status: 404, url: ECHO_URL, body: GOOGLE_404_HTML },
      { status: 200, url: ECHO_URL, body: JSON.stringify([{ id: "1", name: "Hoja" }]) },
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await fetchGasWithResilience(`${EXEC_URL}?action=getMetadata`, {
      retryDelaysMs: [0, 0],
    });

    expect(result).toEqual([{ id: "1", name: "Hoja" }]);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1][0])).toContain("_retry=1");
  });

  it("agota los reintentos y lanza un error temporal legible", async () => {
    const mock = fakeFetch([
      { status: 404, url: ECHO_URL, body: GOOGLE_404_HTML },
      { status: 404, url: ECHO_URL, body: GOOGLE_404_HTML },
      { status: 404, url: ECHO_URL, body: GOOGLE_404_HTML },
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const error = await fetchGasWithResilience(EXEC_URL, { retryDelaysMs: [0, 0] }).catch((e) => e);

    expect(error).toBeInstanceOf(GasRequestError);
    expect(error.transient).toBe(true);
    expect(error.message).toContain(GAS_TRANSIENT_ERROR);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("no reintenta una URL inexistente", async () => {
    const mock = fakeFetch([{ status: 404, url: EXEC_URL, body: GOOGLE_404_HTML }]);

    const error = await fetchGasWithResilience(EXEC_URL, { retryDelaysMs: [0, 0] }).catch((e) => e);

    expect(error).toBeInstanceOf(GasRequestError);
    expect(error.transient).toBe(false);
    expect(error.message).toContain("(404)");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("propaga de inmediato el error devuelto por el propio script", async () => {
    const mock = fakeFetch([
      { status: 200, url: ECHO_URL, body: JSON.stringify({ error: "Hoja no encontrada" }) },
    ]);

    await expect(
      fetchGasWithResilience(EXEC_URL, { retryDelaysMs: [0, 0] }),
    ).rejects.toThrow("Hoja no encontrada");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchGasMetadata", () => {
  const metadata = [
    {
      id: "1621530450",
      name: "FARM - P.S. LIMON-06505",
      lastUpdate: "16/09/2026 11:06:47",
      equipmentDate: "16/09/2026 11:06:40",
      almcod: "06505F0101",
      codigoIpress: "06505",
      rowCount: 284,
    },
  ];

  it("devuelve la metadata y la reutiliza durante unos segundos", async () => {
    const url = `${EXEC_URL}?meta=ok`;
    const mock = fakeFetch([{ status: 200, url: ECHO_URL, body: JSON.stringify(metadata) }]);

    await expect(fetchGasMetadata(url)).resolves.toEqual(metadata);
    await expect(fetchGasMetadata(url)).resolves.toEqual(metadata);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String(mock.mock.calls[0][0])).toContain("action=getMetadata");
  });

  it("lanza el error en vez de devolver null (ya no hay descarga completa de respaldo)", async () => {
    const url = `${EXEC_URL}?meta=missing`;
    fakeFetch([{ status: 404, url: EXEC_URL, body: GOOGLE_404_HTML }]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetchGasMetadata(url)).rejects.toBeInstanceOf(GasRequestError);
  });

  it("rechaza respuestas que no son un listado de hojas", async () => {
    const url = `${EXEC_URL}?meta=weird`;
    fakeFetch([{ status: 200, url: ECHO_URL, body: JSON.stringify({ ok: true }) }]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetchGasMetadata(url)).rejects.toThrow("Respuesta inesperada");
  });
});
