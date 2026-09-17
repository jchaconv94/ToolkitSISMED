import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DirectSheetError,
  checkSpreadsheetAccess,
  extractSpreadsheetId,
  buildSheetExportUrl,
  canReadSheetDirect,
  csvRowsToObjects,
  fetchSheetRowsDirect,
  fetchSheetsMetadataDirect,
  parseCsv,
} from "./sheetsDirectService";

const SPREADSHEET_ID = "1vic6MeMiA5Jk4_UWx8nI462yXe8irgxAoMncJiekOOA";
const HEADERS =
  "ALMCOD,DESC_ALM,ID_Producto,CODIGO_SIG,Nombre,Lote,Fec_Vencim,Reg_Sanitario,TIPSUM,DESC_TIPSUM,FFINAN,DESC_FFINAN,Saldo,Precio_Det,Precio_Cab,FECHA DEL EQUIPO,ULTIMA ACTUALIZACION";
const LIMON_ROW =
  '06505F0101,FARM - P.S. LIMON,32251,351000024812,"VACUNA ANTIVARICELA, 0.5 mL",BA202412070,07/12/2026,SIN_REG_SAN,CI,SISMED-COMPRA UNIDAD EJECUTORA (CI),ROR,Recursos Ordinarios (ROR),1,"6,4125","7,125",16/09/2026 11:06:40,16/09/2026 11:06:47';

type FakeResponse = { status: number; contentType: string; body: string };
const fakeFetch = (responses: Array<FakeResponse | Error>) => {
  const queue = [...responses];
  const mock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch llamado más veces de lo esperado");
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: new Headers({ "content-type": next.contentType }),
      text: async () => next.body,
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};
const csvResponse = (body: string): FakeResponse => ({ status: 200, contentType: "text/csv", body });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseCsv", () => {
  it("respeta comillas, comas y saltos de línea dentro de una celda", () => {
    const rows = parseCsv('a,b,c\r\n"x, y","dijo ""hola""","línea 1\nlínea 2"\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'dijo "hola"', "línea 1\nlínea 2"],
    ]);
  });

  it("ignora el BOM y conserva celdas vacías", () => {
    expect(parseCsv("﻿a,,c\n1,,")).toEqual([
      ["a", "", "c"],
      ["1", "", ""],
    ]);
  });
});

describe("csvRowsToObjects", () => {
  it("usa las mismas reglas que processSheet_: encabezados recortados, sin columnas ni filas vacías", () => {
    const rows = csvRowsToObjects([
      [" Lote ", "", "Saldo"],
      ["L1", "ignorar", "5"],
      ["", "", ""],
      ["L2", "", "0"],
    ]);
    expect(rows).toEqual([
      { Lote: "L1", Saldo: "5" },
      { Lote: "L2", Saldo: "0" },
    ]);
  });

  it("conserva los textos tal como se ven en la hoja (DD/MM y decimales con coma)", () => {
    const [row] = csvRowsToObjects(parseCsv(`${HEADERS}\n${LIMON_ROW}`));
    expect(row.Fec_Vencim).toBe("07/12/2026");
    expect(row.Precio_Det).toBe("6,4125");
    expect(row.Nombre).toBe("VACUNA ANTIVARICELA, 0.5 mL");
    expect(row["ULTIMA ACTUALIZACION"]).toBe("16/09/2026 11:06:47");
    expect(row.CODIGO_SIG).toBe("351000024812");
  });
});

describe("canReadSheetDirect / buildSheetExportUrl", () => {
  it("exige un ID de libro válido y un gid numérico", () => {
    expect(canReadSheetDirect(SPREADSHEET_ID, "1621530450")).toBe(true);
    expect(canReadSheetDirect(undefined, "1621530450")).toBe(false);
    expect(canReadSheetDirect(SPREADSHEET_ID, "0_1621530450")).toBe(false);
    expect(canReadSheetDirect("corto", "1")).toBe(false);
    expect(canReadSheetDirect("../../evil?x=1&aaaaaaaaaaaaaaaaaaaa", "1")).toBe(false);
  });

  it("arma la URL de exportación CSV con rango opcional", () => {
    expect(buildSheetExportUrl(SPREADSHEET_ID, "121569872")).toBe(
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=121569872`,
    );
    expect(buildSheetExportUrl(SPREADSHEET_ID, "1", "A1:AZ2")).toContain("&range=A1%3AAZ2");
  });
});

describe("fetchSheetRowsDirect", () => {
  it("devuelve las filas de la pestaña", async () => {
    const mock = fakeFetch([csvResponse(`${HEADERS}\n${LIMON_ROW}\n`)]);
    const rows = await fetchSheetRowsDirect(SPREADSHEET_ID, "1621530450");
    expect(rows).toHaveLength(1);
    expect(rows[0].ID_Producto).toBe("32251");
    expect(String(mock.mock.calls[0][0])).toContain("gid=1621530450");
    expect(mock.mock.calls[0][1]?.credentials).toBe("omit");
  });

  it("no reintenta si la hoja es privada o la pestaña no existe (HTML / 4xx)", async () => {
    const mock = fakeFetch([{ status: 400, contentType: "text/html", body: "<!DOCTYPE html>" }]);
    await expect(fetchSheetRowsDirect(SPREADSHEET_ID, "999")).rejects.toBeInstanceOf(DirectSheetError);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("rechaza una página HTML aunque llegue con 200", async () => {
    fakeFetch([{ status: 200, contentType: "text/html; charset=utf-8", body: "<html>login</html>" }]);
    await expect(fetchSheetRowsDirect(SPREADSHEET_ID, "1")).rejects.toThrow("compartida");
  });

  it("reintenta una vez ante un fallo de red", async () => {
    vi.useFakeTimers();
    try {
      const mock = fakeFetch([new TypeError("Failed to fetch"), csvResponse(`${HEADERS}\n${LIMON_ROW}`)]);
      const pending = fetchSheetRowsDirect(SPREADSHEET_ID, "1");
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toHaveLength(1);
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no consulta si falta el identificador del libro", async () => {
    const mock = fakeFetch([]);
    await expect(fetchSheetRowsDirect("", "1")).rejects.toBeInstanceOf(DirectSheetError);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("fetchSheetsMetadataDirect", () => {
  const refs = [
    { gid: "1621530450", sheetName: "FARM - P.S. LIMON-06505", spreadsheetId: SPREADSHEET_ID, rowCount: 284, codigoIpress: "06505", lastUpdate: "15/09/2026 08:00:00", equipmentDate: "15/09/2026 07:59:00" },
    { gid: "121569872", sheetName: "HOSP. BELLAVISTA-06502", spreadsheetId: SPREADSHEET_ID, rowCount: 997, codigoIpress: "06502", lastUpdate: "16/09/2026 10:00:00", equipmentDate: "16/09/2026 09:59:00" },
  ];

  it("lee las fechas de la primera fila y conserva rowCount y código", async () => {
    const mock = fakeFetch([
      csvResponse(`${HEADERS}\n${LIMON_ROW}`),
      csvResponse(`${HEADERS}\n06502F01,HOSP,1,2,X,L,01/01/2027,R,CN,D,DYT,D,3,"1,0","1,0",17/09/2026 11:11:40,17/09/2026 11:11:44`),
    ]);

    const metadata = await fetchSheetsMetadataDirect(refs, { concurrency: 1 });

    expect(metadata).toEqual([
      expect.objectContaining({ id: "1621530450", name: "FARM - P.S. LIMON-06505", lastUpdate: "16/09/2026 11:06:47", equipmentDate: "16/09/2026 11:06:40", almcod: "06505F0101", rowCount: 284, codigoIpress: "06505", spreadsheetId: SPREADSHEET_ID }),
      expect.objectContaining({ id: "121569872", lastUpdate: "17/09/2026 11:11:44", rowCount: 997 }),
    ]);
    expect(String(mock.mock.calls[0][0])).toContain("range=A1%3AAZ2");
  });

  it("una hoja fallida conserva sus valores guardados", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeFetch([
      csvResponse(`${HEADERS}\n${LIMON_ROW}`),
      { status: 400, contentType: "text/html", body: "<html>" },
    ]);

    const metadata = await fetchSheetsMetadataDirect(refs, { concurrency: 1 });

    expect(metadata[1]).toEqual(
      expect.objectContaining({ id: "121569872", lastUpdate: "16/09/2026 10:00:00", rowCount: 997 }),
    );
  });

  it("lanza error si no se pudo leer ninguna hoja", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeFetch([
      { status: 403, contentType: "text/html", body: "<html>" },
      { status: 403, contentType: "text/html", body: "<html>" },
    ]);
    await expect(fetchSheetsMetadataDirect(refs, { concurrency: 1 })).rejects.toBeInstanceOf(DirectSheetError);
  });

  it("marca rowCount 0 si la hoja quedó sin filas de datos", async () => {
    fakeFetch([csvResponse(`${HEADERS}\n`)]);
    const [meta] = await fetchSheetsMetadataDirect([refs[0]]);
    expect(meta.rowCount).toBe(0);
    expect(meta.lastUpdate).toBe("");
  });
});

describe("extractSpreadsheetId", () => {
  it("acepta el enlace completo de Google Sheets", () => {
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=0`)).toBe(SPREADSHEET_ID);
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?usp=sharing`)).toBe(SPREADSHEET_ID);
  });

  it("acepta el ID pelado y descarta lo que no lo es", () => {
    expect(extractSpreadsheetId(SPREADSHEET_ID)).toBe(SPREADSHEET_ID);
    expect(extractSpreadsheetId(" " + SPREADSHEET_ID + " ")).toBe(SPREADSHEET_ID);
    expect(extractSpreadsheetId("https://script.google.com/macros/s/AKfycbwsBW522vGhqZTkfs70/exec")).toBe("");
    expect(extractSpreadsheetId("corto")).toBe("");
    expect(extractSpreadsheetId("")).toBe("");
    expect(extractSpreadsheetId(null)).toBe("");
  });
});

describe("checkSpreadsheetAccess", () => {
  it("confirma una hoja compartida como lector con el enlace", async () => {
    const mock = fakeFetch([csvResponse("ALMCOD,Saldo\n06505F0101,1")]);
    await expect(checkSpreadsheetAccess(SPREADSHEET_ID)).resolves.toEqual({
      ok: true,
      message: expect.stringContaining("accesible"),
    });
    expect(String(mock.mock.calls[0][0])).toContain("/gviz/tq");
  });

  it("explica qué hacer cuando la hoja es privada", async () => {
    fakeFetch([{ status: 401, contentType: "text/html", body: "<html>login</html>" }]);
    const result = await checkSpreadsheetAccess(SPREADSHEET_ID);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cualquiera con el enlace");
  });

  it("avisa si el enlace no corresponde a una hoja existente", async () => {
    fakeFetch([{ status: 404, contentType: "text/html", body: "<html>" }]);
    await expect(checkSpreadsheetAccess(SPREADSHEET_ID)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("No se encontró") });
  });

  it("rechaza un identificador inválido sin consultar a Google", async () => {
    const mock = fakeFetch([]);
    await expect(checkSpreadsheetAccess("corto")).resolves.toMatchObject({ ok: false });
    expect(mock).not.toHaveBeenCalled();
  });
});
