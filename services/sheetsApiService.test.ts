import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  SheetsApiError,
  __resetSheetsApiCache,
  a1Range,
  batchGetRanges,
  facilityCodeFromSheetName,
  fetchSheetsMetadataViaApi,
  listSheetTabs,
} from "./sheetsApiService";

const ID = "1vic6MeMiA5Jk4_UWx8nI462yXe8irgxAoMncJiekOOA";
const KEY = "AIza-clave-de-prueba";

type FakeResponse = { status: number; body: unknown };
const fakeFetch = (responses: Array<FakeResponse | Error>) => {
  const queue = [...responses];
  const mock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch llamado más veces de lo esperado");
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body),
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

const tabsBody = {
  sheets: [
    { properties: { sheetId: 121569872, title: "HOSP. BELLAVISTA-06502", index: 1, hidden: false } },
    { properties: { sheetId: 1621530450, title: "FARM - P.S. LIMON-06505", index: 0, hidden: false } },
  ],
};
const HEADERS = ["ALMCOD", "DESC_ALM", "ID_Producto", "Saldo", "FECHA DEL EQUIPO", "ULTIMA ACTUALIZACION"];

beforeEach(() => __resetSheetsApiCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a1Range / facilityCodeFromSheetName", () => {
  it("escapa comillas simples en el nombre de la pestaña", () => {
    expect(a1Range("FARM - P.S. LIMON-06505", "A1:AZ2")).toBe("'FARM - P.S. LIMON-06505'!A1:AZ2");
    expect(a1Range("P.S. D'ANGELO-06599", "A:A")).toBe("'P.S. D''ANGELO-06599'!A:A");
  });

  it("aplica las mismas reglas que getFacilityCode_ del backend", () => {
    expect(facilityCodeFromSheetName("FARM - P.S. SANTA ELENA-06523")).toBe("06523");
    expect(facilityCodeFromSheetName("ALM. ANEXO BELLAVISTA - SAN MARTIN-030S05")).toBe("030S05");
    expect(facilityCodeFromSheetName("SAL SISMED", "06502F01")).toBe("06502");
    expect(facilityCodeFromSheetName("HOJA", "")).toBe("");
  });
});

describe("listSheetTabs", () => {
  it("lista las pestañas ordenadas y reutiliza la respuesta", async () => {
    const mock = fakeFetch([{ status: 200, body: tabsBody }]);
    const tabs = await listSheetTabs(ID, { apiKey: KEY });
    expect(tabs.map((t) => `${t.gid}:${t.title}`)).toEqual([
      "1621530450:FARM - P.S. LIMON-06505",
      "121569872:HOSP. BELLAVISTA-06502",
    ]);
    await listSheetTabs(ID, { apiKey: KEY });
    expect(mock).toHaveBeenCalledTimes(1);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain(`/v4/spreadsheets/${ID}?`);
    expect(url).toContain("key=" + KEY);
    expect(url).toContain("fields=sheets.properties");
  });

  it("traduce 403 y 429 a errores accionables", async () => {
    fakeFetch([{ status: 403, body: { error: { message: "The caller does not have permission" } } }]);
    const forbidden = await listSheetTabs(ID, { apiKey: KEY }).catch((e) => e);
    expect(forbidden).toBeInstanceOf(SheetsApiError);
    expect(forbidden.status).toBe(403);
    expect(forbidden.message).toContain("compartida");

    __resetSheetsApiCache();
    fakeFetch([{ status: 429, body: { error: { message: "Quota exceeded" } } }]);
    const quota = await listSheetTabs(ID, { apiKey: KEY, force: true }).catch((e) => e);
    expect(quota.quotaExceeded).toBe(true);
  });

  it("no consulta sin clave", async () => {
    const mock = fakeFetch([]);
    await expect(listSheetTabs(ID, { apiKey: "" })).rejects.toBeInstanceOf(SheetsApiError);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("batchGetRanges", () => {
  it("pide varios rangos en una petición y devuelve [] para los vacíos", async () => {
    const mock = fakeFetch([
      { status: 200, body: { valueRanges: [{ values: [["a", "b"], ["1", 2]] }, {}] } },
    ]);
    const values = await batchGetRanges(ID, ["'A'!A1:B2", "'B'!A1:B2"], { apiKey: KEY });
    expect(values).toEqual([[["a", "b"], ["1", "2"]], []]);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("values:batchGet");
    expect(url).toContain("valueRenderOption=FORMATTED_VALUE");
    expect(url).toContain("dateTimeRenderOption=FORMATTED_STRING");
    expect((url.match(/ranges=/g) || []).length).toBe(2);
  });

  it("divide en varias peticiones cuando hay muchos rangos", async () => {
    const mock = fakeFetch([
      { status: 200, body: { valueRanges: Array.from({ length: 40 }, () => ({ values: [["x"]] })) } },
      { status: 200, body: { valueRanges: Array.from({ length: 5 }, () => ({ values: [["y"]] })) } },
    ]);
    const values = await batchGetRanges(ID, Array.from({ length: 45 }, (_, i) => `'T${i}'!A1`), { apiKey: KEY });
    expect(values).toHaveLength(45);
    expect(values[44]).toEqual([["y"]]);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchSheetsMetadataViaApi", () => {
  it("arma la metadata como getMetadata de Apps Script con dos peticiones", async () => {
    const mock = fakeFetch([
      { status: 200, body: tabsBody },
      {
        status: 200,
        body: {
          valueRanges: [
            // LIMON: encabezado + primera fila, luego columna A completa (sin conteo conocido)
            { values: [HEADERS, ["06505F0101", "FARM - P.S. LIMON", "32251", "1", "16/09/2026 11:06:40", "16/09/2026 11:06:47"]] },
            { values: [["ALMCOD"], ["06505F0101"], ["06505F0101"], ["06505F0101"], [""]] },
            // HOSP: solo encabezado (conteo ya conocido)
            { values: [HEADERS, ["06502F01", "HOSP", "00143", "478", "17/09/2026 11:11:40", "17/09/2026 11:11:44"]] },
          ],
        },
      },
    ]);

    const metadata = await fetchSheetsMetadataViaApi(ID, {
      apiKey: KEY,
      knownRowCounts: { "121569872": 997 },
    });

    expect(metadata).toEqual([
      {
        id: "1621530450",
        name: "FARM - P.S. LIMON-06505",
        lastUpdate: "16/09/2026 11:06:47",
        equipmentDate: "16/09/2026 11:06:40",
        almcod: "06505F0101",
        codigoIpress: "06505",
        rowCount: 3,
        spreadsheetId: ID,
      },
      {
        id: "121569872",
        name: "HOSP. BELLAVISTA-06502",
        lastUpdate: "17/09/2026 11:11:44",
        equipmentDate: "17/09/2026 11:11:40",
        almcod: "06502F01",
        codigoIpress: "06502",
        rowCount: 997,
        spreadsheetId: ID,
      },
    ]);
    expect(mock).toHaveBeenCalledTimes(2);
    // URLSearchParams codifica los espacios como "+".
    const batchUrl = decodeURIComponent(String(mock.mock.calls[1][0])).replace(/\+/g, " ");
    expect(batchUrl).toContain("'FARM - P.S. LIMON-06505'!A1:AZ2");
    expect(batchUrl).toContain("'FARM - P.S. LIMON-06505'!A:A");
    expect(batchUrl).not.toContain("'HOSP. BELLAVISTA-06502'!A:A");
  });

  it("una pestaña vacía queda con fechas vacías y 0 filas", async () => {
    fakeFetch([
      { status: 200, body: { sheets: [{ properties: { sheetId: 7, title: "NUEVA-06599", index: 0 } }] } },
      { status: 200, body: { valueRanges: [{}, {}] } },
    ]);
    const [meta] = await fetchSheetsMetadataViaApi(ID, { apiKey: KEY });
    expect(meta).toMatchObject({ id: "7", name: "NUEVA-06599", lastUpdate: "", equipmentDate: "", rowCount: 0, codigoIpress: "06599" });
  });
});
