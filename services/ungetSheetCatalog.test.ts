import { describe, it, expect, vi, afterEach } from "vitest";
import { listUngetSheets } from "./ungetSheetCatalog";
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

describe("listUngetSheets sin conteo de filas", () => {
  /** Igual que la lectura por API de arriba, pero registrando los rangos pedidos. */
  const stubLibro = (rangos: string[]) =>
    stubFetch((url) => {
      if (url.includes("values:batchGet")) {
        const pedidos = Array.from(new URL(url).searchParams.getAll("ranges"));
        rangos.push(...pedidos);
        return {
          ok: true,
          status: 200,
          headers: { get: (): string => "application/json" },
          text: async () =>
            JSON.stringify({ valueRanges: pedidos.map(() => ({ values: [["ALMCOD"], ["06502F0101"]] })) }),
        };
      }
      if (url.includes("sheets.googleapis.com")) {
        return {
          ok: true,
          status: 200,
          headers: { get: (): string => "application/json" },
          text: async () =>
            JSON.stringify({
              sheets: [
                { properties: { sheetId: 10, title: "HOSP. BELLAVISTA-06502", index: 0 } },
                { properties: { sheetId: 11, title: "C.S. NUEVO LIMA-06519", index: 1 } },
              ],
            }),
        };
      }
      throw new Error(`URL inesperada: ${url}`);
    });

  it("no pide la columna A de cada pestaña, que es lo caro de la llamada", async () => {
    // Contar filas obliga a descargar `A:A` entera de cada pestaña —miles de lotes— para un
    // dato que el vínculo por código no usa.
    const rangos: string[] = [];
    stubLibro(rangos);

    await listUngetSheets(
      { url: `sheets://${LIBRO}`, spreadsheetId: LIBRO },
      { force: true, apiKey: "AIza-clave-de-prueba", withRowCounts: false },
    );

    expect(rangos.some((rango) => rango.includes("A:A"))).toBe(false);
    expect(rangos).toHaveLength(2); // solo la cabecera de cada pestaña
  });

  it("por omisión sí las cuenta, para no cambiarle el comportamiento a Consulta Stock", async () => {
    const rangos: string[] = [];
    stubLibro(rangos);

    await listUngetSheets(
      { url: `sheets://${LIBRO}`, spreadsheetId: LIBRO },
      { force: true, apiKey: "AIza-clave-de-prueba" },
    );

    expect(rangos.filter((rango) => rango.includes("A:A"))).toHaveLength(2);
  });

  it("sigue reconociendo el código de cada pestaña sin el conteo", async () => {
    stubLibro([]);
    const sheets = await listUngetSheets(
      { url: `sheets://${LIBRO}`, spreadsheetId: LIBRO },
      { force: true, apiKey: "AIza-clave-de-prueba", withRowCounts: false },
    );
    expect(sheets.map((s) => s.codigoIpress)).toEqual(["06502", "06519"]);
  });
});
