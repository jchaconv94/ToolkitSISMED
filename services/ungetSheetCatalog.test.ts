import { describe, it, expect, vi, afterEach } from "vitest";
import { assignmentSheetExists, listUngetSheets } from "./ungetSheetCatalog";
import { __resetSheetsApiCache } from "./sheetsApiService";

const LIBRO = "1vic6MeMiA5Jk4_UWx8nI462yXe8irgxAoMncJiekOOA";
const WEBAPP = "https://script.google.com/macros/s/abc/exec";

/** Respuesta de Apps Script a `action=getMetadata`. */
const metadataGas = [
  { id: "10", name: "HOSP. BELLAVISTA-06502", rowCount: 500 },
  { id: "11", name: "Sheet3", rowCount: 0 },
];

const stubFetch = (handler: (url: string) => any) => {
  const mock = vi.fn(async (input: any) => handler(String(input)));
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetSheetsApiCache();
});

describe("listUngetSheets", () => {
  it("lee las pestañas por la Web App y deja fuera las que no son establecimientos", async () => {
    const mock = stubFetch((url) => {
      if (!url.includes("script.google.com")) throw new Error(`URL inesperada: ${url}`);
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: (): string => "application/json" },
        text: async () => JSON.stringify(metadataGas),
      };
    });

    const sheets = await listUngetSheets({ url: WEBAPP });
    expect(sheets).toEqual([{ id: "10", name: "HOSP. BELLAVISTA-06502" }]);
    expect(mock.mock.calls.length).toBeGreaterThan(0);
  });

  it("una UNGET sin Web App se lee por su libro, que antes era imposible", async () => {
    // Era el fallo: con `sheets://<id>` el módulo hacía fetch a esa dirección y siempre
    // fallaba, así que esa UNGET no podía asignar ninguna hoja.
    stubFetch((url) => {
      if (url.includes("values:batchGet")) {
        return {
          ok: true,
          status: 200,
          headers: { get: (): string => "application/json" },
          text: async () =>
            JSON.stringify({ valueRanges: [{ values: [["ALMCOD"], ["06502F01"]] }, { values: [["a"], ["b"]] }] }),
        };
      }
      if (url.includes("sheets.googleapis.com")) {
        return {
          ok: true,
          status: 200,
          headers: { get: (): string => "application/json" },
          text: async () =>
            JSON.stringify({ sheets: [{ properties: { sheetId: 10, title: "HOSP. BELLAVISTA-06502", index: 0 } }] }),
        };
      }
      throw new Error(`URL inesperada: ${url}`);
    });

    const sheets = await listUngetSheets(
      { url: `sheets://${LIBRO}`, spreadsheetId: LIBRO },
      { force: true, apiKey: "AIza-clave-de-prueba" },
    );
    expect(sheets.map((s) => s.name)).toEqual(["HOSP. BELLAVISTA-06502"]);
  });

  it("sin clave de API, una conexión que solo tiene hoja no puede listar pestañas", async () => {
    // Es el límite real del modelo, no un descuido: descubrir las pestañas de un libro
    // necesita la API. En producción la clave está; en local no, y conviene que se note.
    await expect(
      listUngetSheets({ url: `sheets://${LIBRO}`, spreadsheetId: LIBRO }, { apiKey: "" }),
    ).rejects.toThrow(/no tiene hoja|Web App/i);
  });

  it("una conexión sin hoja ni Web App lo dice, en vez de fallar sin explicación", async () => {
    await expect(
      listUngetSheets({ url: `sheets://${LIBRO}` }, { apiKey: "" }),
    ).rejects.toThrow(/no tiene hoja/i);
    await expect(listUngetSheets(null, { apiKey: "" })).rejects.toThrow(/no tiene hoja/i);
  });
});

describe("assignmentSheetExists", () => {
  const sheets = [
    { id: "10", name: "HOSP. BELLAVISTA-06502" },
    { id: "11", name: "uchiza" },
  ];

  it("reconoce la pestaña que sigue en el libro", () => {
    expect(assignmentSheetExists("uchiza", sheets)).toBe(true);
  });

  it("detecta la asignación que quedó apuntando al vacío", () => {
    // Caso real de Tocache: la asignación apuntaba a `ALM SISMED-030S0`, que ya no existe.
    expect(assignmentSheetExists("ALM SISMED-030S0", sheets)).toBe(false);
  });

  it("no da por buena una asignación sin pestaña", () => {
    expect(assignmentSheetExists("", sheets)).toBe(false);
    expect(assignmentSheetExists("uchiza", [])).toBe(false);
    expect(assignmentSheetExists(null, null)).toBe(false);
  });
});
