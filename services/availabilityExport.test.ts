import { describe, expect, it } from "vitest";
import { StockStatus } from "../types";
import { buildItems, parseAvailabilitySheet, summarize } from "./availabilityReport";
import { buildAvailabilityWorkbook } from "./availabilityExport";

const HEADER = ["RED", "MICRORED", "COD EESS", "ESTABLECIMIENTO", "CAT", "MED COD", "DESCRIPCION DEL PRODUCTO", "MEDFF", "PRECIO", "MEDTIP", "MEDPET", "MEDEST", 202608, 202609, "STOCK_FIN"];

describe("Excel de disponibilidad", () => {
  it("pinta la situación de cada fila sin teñir el resto de la columna", () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "00001", "UNO", "TAB", 1, "M", "P", "S", 10, 10, 30],
      ["R", "MR", "06503", "P.S. A", "I-1", "00002", "DOS", "TAB", 1, "M", "P", "S", 10, 10, 0]]);
    const items = buildItems(rows);
    const report = summarize(items);
    const wb = buildAvailabilityWorkbook({
      report, pharmacyItems: null, months: ["202608", "202609"], scope: "all", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s", preparedBy: "Ana Pérez", preparedByRole: "Químico Farmacéutico",
    });
    const ws = wb.getWorksheet("Productos por establecimiento")!;
    const header = (ws.getRow(5).values as unknown[]).map(String);
    const col = header.indexOf("Situación");
    const fills = [6, 7].map((r) => (ws.getCell(r, col).fill as { fgColor?: { argb?: string } })?.fgColor?.argb);
    expect(items.map((i) => i.status)).toEqual([StockStatus.NORMOSTOCK, StockStatus.DESABASTECIDO]);
    expect(fills[0]).not.toBe(fills[1]);
    // La columna del producto conserva el fondo propio de cada fila (alternado), no el de la situación.
    expect((ws.getCell(6, 7).fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb).not.toBe(fills[0]);
    // Sin almacén no hay hoja «Almacén».
    expect(wb.getWorksheet("Almacén")).toBeUndefined();
    // Portada: nombre y profesión del responsable.
    const cover = wb.getWorksheet("Resumen")!;
    expect(cover.getCell(4, 9).value).toBe("Ana Pérez");
    expect(cover.getCell(5, 9).value).toBe("Químico Farmacéutico");
  });

  it("muestra el stock del almacén en «Atención» y en su hoja", () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "00002", "DOS", "TAB", 1, "M", "P", "S", 10, 10, 0]]);
    const report = summarize(buildItems(rows));
    const wb = buildAvailabilityWorkbook({
      report, pharmacyItems: null, months: ["202608", "202609"], scope: "all", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s",
      warehouse: [{ code: "030S05", name: "ALMACEN", medCode: "00002", description: "DOS", price: 2, stock: 120, lots: [] }],
    });
    const at = wb.getWorksheet("Atención")!;
    const head = (at.getRow(5).values as unknown[]).map(String);
    expect(at.getCell(6, head.indexOf("Stock en almacén")).value).toBe(120);
    const wh = wb.getWorksheet("Almacén")!;
    const whHead = (wh.getRow(5).values as unknown[]).map(String);
    expect(wh.getCell(6, whHead.indexOf("Stock")).value).toBe(120);
    expect(wh.getCell(6, whHead.indexOf("EESS desabastecidos")).value).toBe(1);
    expect(wh.getCell(6, whHead.indexOf("Faltan para 2 meses (unid.)")).value).toBe(20);
  });
});
