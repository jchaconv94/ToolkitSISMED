import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { strToU8, zipSync } from "fflate";
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

  it("lee por trozos la hoja con textos en línea (Toolkit 2.3.1, XlsxWriter en memoria constante)", () => {
    // Un .xlsx mínimo como el que escribe el Toolkit: textos dentro de cada celda, sin tabla común.
    const cell = (ref: string, v: unknown) => (typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`);
    const rows: unknown[][] = [["ANNOMES", "CODIGO_PRE", "CODIGO_MED", "DESCRIPCION MED", "STOCK_FIN"]];
    for (let i = 0; i < 400; i++) rows.push(["202609", `065${String(i % 50).padStart(2, "0")}`, String(i).padStart(5, "0"), `PRODUCTO DE NOMBRE LARGO &amp; NÚMERO ${i % 7}`, i * 3]);
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(`${String.fromCharCode(65 + j)}${i + 1}`, v)).join("")}</row>`)
      .join("")}<row r="402"/></sheetData></worksheet>`;
    const file = zipSync({
      "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
      "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    const whole = readFirstSheetFast(file);
    // Trozos de 7 bytes: casi todas las filas y celdas quedan partidas entre dos trozos.
    expect(readFirstSheetFast(file, { inputStep: 7 })).toEqual(whole);
    const wb = XLSX.read(file, { dense: true });
    const slow = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    // Igual que SheetJS, salvo la fila vacía del final, que el lector rápido no agrega (como siempre).
    expect(whole).toEqual(slow.slice(0, whole.length));
    expect(slow.slice(whole.length).every((r) => r.every((v) => v === null))).toBe(true);
    expect(whole[1]).toEqual(["202609", "06500", "00000", "PRODUCTO DE NOMBRE LARGO & NÚMERO 0", 0]);
    expect(tformdetFromSheet(whole, "x.xlsx").data.months).toEqual(["202609"]);
  });

  it("solo acepta la consulta TFORMDET", () => {
    expect(isTformdetSheet([["ANNOMES", "CODIGO_PRE"]])).toBe(true);
    expect(() => tformdetFromSheet([["RED", "MICRORED"], ["A", "B"]], "x.xlsx")).toThrow(/TFORMDET/);
  });
});
