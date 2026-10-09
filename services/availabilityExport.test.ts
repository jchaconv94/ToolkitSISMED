import { describe, expect, it } from "vitest";
import { StockStatus } from "../types";
import { buildItems, parseAvailabilitySheet, summarize } from "./availabilityReport";
import { buildAvailabilityWorkbook } from "./availabilityExport";

const HEADER = ["RED", "MICRORED", "COD EESS", "ESTABLECIMIENTO", "CAT", "MED COD", "DESCRIPCION DEL PRODUCTO", "MEDFF", "PRECIO", "MEDTIP", "MEDPET", "MEDEST", 202608, 202609, "STOCK_FIN"];

describe("Excel de disponibilidad", () => {
  it("pinta la situación de cada fila sin teñir el resto de la columna", async () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "00001", "UNO", "TAB", 1, "M", "P", "S", 10, 10, 30],
      ["R", "MR", "06503", "P.S. A", "I-1", "00002", "DOS", "TAB", 1, "M", "P", "S", 10, 10, 0]]);
    const items = buildItems(rows);
    const report = summarize(items);
    const wb = await buildAvailabilityWorkbook({
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
    expect(cover.getCell(2, 10).value).toBe("Ana Pérez");
    expect(cover.getCell(3, 10).value).toBe("Químico Farmacéutico");
  });

  it("muestra el stock del almacén en «Atención» y en su hoja", async () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "00002", "DOS", "TAB", 1, "M", "P", "S", 10, 10, 0]]);
    const report = summarize(buildItems(rows));
    const wb = await buildAvailabilityWorkbook({
      report, pharmacyItems: null, months: ["202608", "202609"], scope: "all", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s",
      warehouse: [{ code: "030S05", name: "ALMACEN", medCode: "00002", description: "DOS", price: 2, stock: 120, lots: [] }],
    });
    const at = wb.getWorksheet("Atención")!;
    // Atención y Almacén llevan tarjetas arriba: la tabla empieza en la fila 10.
    const head = (at.getRow(10).values as unknown[]).map(String);
    expect(at.getCell(11, head.indexOf("Stock en almacén")).value).toBe(120);
    const wh = wb.getWorksheet("Almacén")!;
    const whHead = (wh.getRow(10).values as unknown[]).map(String);
    expect(wh.getCell(11, whHead.indexOf("Stock")).value).toBe(120);
    expect(wh.getCell(11, whHead.indexOf("EESS desabastecidos")).value).toBe(1);
    expect(wh.getCell(11, whHead.indexOf("Faltan para 2 meses (unid.)")).value).toBe(20);
  });

  it("usa el riesgo de vencimiento de la web (FEFO) en vez del criterio simple", async () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "00001", "UNO", "TAB", 1, "M", "P", "S", 10, 10, 30],
      ["R", "MR", "06503", "P.S. A", "I-1", "00003", "TRES", "TAB", 1, "M", "P", "S", 10, 10, 30]]);
    const report = summarize(buildItems(rows));
    const wb = await buildAvailabilityWorkbook({
      report, pharmacyItems: null, months: ["202608", "202609"], scope: "all", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s",
      expiryRisk: { "06503|00003": { units: 12, value: 12 } },
    });
    const ws = wb.getWorksheet("Productos por establecimiento")!;
    const header = (ws.getRow(5).values as unknown[]).map(String);
    const col = header.indexOf("Riesgo de vencimiento");
    expect(ws.getCell(6, col).value).toBe("");
    expect(ws.getCell(7, col).value).toBe("12 u");
    const at = wb.getWorksheet("Atención")!;
    const head = (at.getRow(10).values as unknown[]).map(String);
    expect(at.getCell(11, head.indexOf("Motivo")).value).toBe("Vencen 12 u sin usarse");
  });

  it("la metodología dice qué establecimientos quedaron fuera y explica la regla de 1 litro", async () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "05873", "SODIO CLORURO 1 L 900 mg/100 mL (0.9 %)", "INY", 1, "M", "P", "S", 10, 10, 15]]);
    const items = buildItems(rows, undefined, new Date(), { truncate: false, subMax: 2, sobreMin: 6, largeVolumeMonths: 1 });
    expect(items[0].status).toBe(StockStatus.NORMOSTOCK);
    const wb = await buildAvailabilityWorkbook({
      report: summarize(items), pharmacyItems: null, months: ["202608", "202609"], scope: "essential", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s", largeVolumeMonths: 1,
      outside: [{ code: "31456", name: "C.S.M.C. BELLAVISTA", pct: 73.17 }],
    });
    const me = wb.getWorksheet("Metodología")!;
    const text: string[] = [];
    me.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") text.push(cell.value); }));
    const all = text.join(" | ");
    expect(all).toMatch(/Fuera del análisis/);
    expect(all).toMatch(/C\.S\.M\.C\. BELLAVISTA \(31456, 73,2 %\)/);
    expect(all).toMatch(/Soluciones de gran volumen/);
    expect(all).toMatch(/Soluciones de 1 L o más: desde 1/);
  });
});

