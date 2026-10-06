import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { readFirstSheetFast } from "./fastXlsx";
import { isTformdetSheet, tformdetFromSheet } from "./tformdetFile";

const workbook = async (rows: unknown[][]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hoja");
  rows.forEach((r, i) => r.forEach((v, j) => { if (v !== null) ws.getCell(i + 1, j + 1).value = v as ExcelJS.CellValue; }));
  return new Uint8Array(await wb.xlsx.writeBuffer());
};

describe("lector rápido de xlsx", () => {
  it("lee igual que SheetJS: textos con ceros, números, vacíos y entidades", async () => {
    const buf = await workbook([
      ["ANNOMES", "CODIGO_PRE", "CODIGO_MED", "DESCRIPCION MED", "STOCK_FIN", "PRECIO"],
      ["202609", "06503", "00143", "ACIDO FOLICO 500 µg <0.5 mg> & \"x\"", 26, 1.5],
      ["202609", "06502F01", null, "OTRO", 0, null],
    ]);
    const fast = readFirstSheetFast(buf);
    const wb = XLSX.read(buf, { dense: true });
    const slow = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    expect(fast).toEqual(slow);
    expect(fast[1][1]).toBe("06503");
    expect(fast[1][3]).toBe("ACIDO FOLICO 500 µg <0.5 mg> & \"x\"");
  });

  it("solo acepta la consulta TFORMDET", () => {
    expect(isTformdetSheet([["ANNOMES", "CODIGO_PRE"]])).toBe(true);
    expect(() => tformdetFromSheet([["RED", "MICRORED"], ["A", "B"]], "x.xlsx")).toThrow(/TFORMDET/);
  });
});
