import { describe, expect, it } from "vitest";
import { StockStatus } from "../types";
import { buildItems, networkItems, parseAvailabilitySheet, summarize } from "./availabilityReport";
import { buildAvailabilityWorkbook, buildProductsWorkbook, productsFileName } from "./availabilityExport";

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
    const col = header.indexOf("Vencen sin usarse");
    expect(ws.getCell(6, col).value).toBe("");
    expect(ws.getCell(7, col).value).toBe(12);
    const at = wb.getWorksheet("Atención")!;
    const head = (at.getRow(10).values as unknown[]).map(String);
    expect(at.getCell(11, head.indexOf("Motivo")).value).toBe("Vencen sin usarse: 12");
  });

  it("la metodología dice qué establecimientos quedaron fuera y explica la regla de 1 litro", async () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "08166", "SOLUCION DE LACTATO SODICO COMPUESTA (LACTATO RINGER) 1 L", "INY", 1, "M", "P", "S", 10, 10, 15]]);
    const items = buildItems(rows, undefined, new Date(), { truncate: false, subMax: 2, sobreMin: 6, largeVolumeMonths: 1, largeVolumeCodes: ["08166"] });
    expect(items[0].status).toBe(StockStatus.NORMOSTOCK);
    const wb = await buildAvailabilityWorkbook({
      report: summarize(items), pharmacyItems: null, months: ["202608", "202609"], scope: "essential", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s", largeVolumeMonths: 1,
      largeVolumeList: [{ code: "08166", name: "SOLUCION DE LACTATO SODICO COMPUESTA (LACTATO RINGER) 1 L INYECTABLE" }],
      outside: [{ code: "31456", name: "C.S.M.C. BELLAVISTA", pct: 73.17 }],
    });
    const me = wb.getWorksheet("Metodología")!;
    const text: string[] = [];
    me.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") text.push(cell.value); }));
    const all = text.join(" | ");
    expect(all).toMatch(/Fuera del análisis/);
    expect(all).toMatch(/C\.S\.M\.C\. BELLAVISTA \(31456, 73,2 %\)/);
    expect(all).toMatch(/Soluciones de gran volumen/);
    expect(all).toMatch(/Soluciones de gran volumen: desde 1/);
    expect(all).toMatch(/En este reporte: 08166 SOLUCION DE LACTATO/);
  });

  it("los de fuera del análisis se listan al final de Establecimientos, sin puesto", async () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      ["R", "MR", "06503", "P.S. A", "I-1", "00091", "ACIDO ACETILSALICILICO 100 mg TAB", "TAB", 1, "M", "P", "S", 10, 10, 15]]);
    const items = buildItems(rows, undefined, new Date(), { truncate: false, subMax: 2, sobreMin: 6 });
    const wb = await buildAvailabilityWorkbook({
      report: summarize(items), pharmacyItems: null, months: ["202608", "202609"], scope: "all", title: "UNGET X", formulaText: "f",
      levels: { optimo: 90, alto: 80, regular: 70 }, source: "s",
      outside: [{ code: "31456", name: "C.S.M.C. BELLAVISTA", pct: 73.17, microred: "MR", total: 41 }],
    });
    const es = wb.getWorksheet("Establecimientos")!;
    const codes: Array<[unknown, unknown, unknown]> = [];
    es.eachRow((row) => codes.push([row.getCell(1).value, row.getCell(3).value, row.getCell(13).value]));
    const inside = codes.findIndex(([, code]) => code === "06503");
    const out = codes.findIndex(([, code]) => code === "31456");
    expect(inside).toBeGreaterThan(-1);
    expect(out).toBeGreaterThan(inside);
    expect(codes[out][0]).toBe("—");
    expect(codes[out][2]).toBe("Fuera del análisis");
  });
});


describe("Excel de una sola hoja", () => {
  const { rows } = parseAvailabilitySheet([HEADER,
    ["R", "MR", "06503", "P.S. A", "I-1", "00001", "UNO", "TAB", 1, "M", "P", "S", 10, 10, 0],
    ["R", "MR", "06504", "P.S. B", "I-1", "00001", "UNO", "TAB", 1, "M", "P", "S", 5, 5, 40]]);
  const items = buildItems(rows);
  const base = { months: ["202608", "202609"], scope: "all" as const, title: "UNGET X", preparedBy: "Ana Pérez" };

  it("el consolidado por red trae las columnas de la hoja de productos, sin las del establecimiento", async () => {
    const wb = await buildProductsWorkbook({ ...base, kind: "network", items: networkItems(items), excluded: ["P.S. C"] });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Consolidado por red"]);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(5).values as unknown[]).slice(1).map(String);
    expect(header.slice(0, 8)).toEqual(["Red", "Código", "Producto", "F.F.", "Precio", "Tipo", "Pet.", "Est."]);
    expect(header).toContain("Situación");
    expect(header).toContain("Detalle de lotes (lote · vence · saldo)");
    expect(header).not.toContain("Establecimiento");
    // Una fila por producto con la red sumada: consumo 15 al mes y stock 40.
    const row = (ws.getRow(6).values as unknown[]).slice(1);
    expect(row.slice(0, 3)).toEqual(["R", "00001", "UNO"]);
    expect(row[header.indexOf("Stock")]).toBe(40);
    expect(row[header.indexOf("CPA")]).toBe(15);
    expect(String(ws.getCell(2, 1).value)).toContain("sin P.S. C");
  });

  it("por establecimiento es la misma hoja del reporte completo, sola", async () => {
    const wb = await buildProductsWorkbook({ ...base, kind: "establishments", items });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Productos por establecimiento"]);
    expect((wb.worksheets[0].getRow(5).values as unknown[]).slice(1, 5).map(String)).toEqual(["Red", "Microred", "Código EESS", "Establecimiento"]);
    expect(wb.worksheets[0].rowCount).toBe(7);
  });

  it("nombre del archivo según lo que se descarga", () => {
    expect(productsFileName({ ...base, kind: "network" })).toBe("DISPONIBILIDAD_PRODUCTOS_POR_RED_UNGET_X_202609.xlsx");
    expect(productsFileName({ ...base, scope: "essential", kind: "pharmacies" })).toBe("DISPONIBILIDAD_DME_POR_FARMACIA_UNGET_X_202609.xlsx");
  });
});

