import { describe, expect, it } from "vitest";
import type { GuideLine, ReviewSite } from "./guidesReview";
import { buildGuidesReviewWorkbook, guidesReviewFileName, siteReview } from "./guidesReviewExport";

const site = (destination: string, iciCode: string | null, rows: ReviewSite["rows"]): ReviewSite => {
  const counts = { short: 0, notReceived: 0, extra: 0, notSent: 0, complete: 0 };
  rows.forEach((r) => counts[r.state]++);
  return { destination, iciCode, guides: [...new Set(rows.flatMap((r) => r.guides))], rows, counts, differences: rows.length - counts.complete };
};
const line = (destination: string, guide: string, product: string, lot: string, quantity: number): GuideLine =>
  ({ date: "2026-09-14", month: "202609", guide, destination, concept: "04", product, lot, quantity });

const libertad = site("06516", "06516", [
  { product: "19421", lot: "L1", sent: 20, received: 20, state: "complete", guides: ["0001552"], previous: null },
  { product: "19422", lot: "L2", sent: 10, received: 6, state: "short", guides: ["0001552"], previous: null },
  { product: "19423", lot: "L3", sent: 0, received: 5, state: "notSent", guides: [], previous: { date: "2026-07-17", guide: "0001259" } },
]);
const nuevoLima = site("06519", null, [{ product: "19421", lot: "L1", sent: 4, received: 0, state: "notReceived", guides: ["0001560"], previous: null }]);
const input = {
  warehouseName: "ALM. ANEXO BELLAVISTA",
  warehouseCode: "030S05",
  monthLabel: "Setiembre 2026",
  generatedAt: new Date(2026, 9, 28, 15, 0),
  sites: [{ site: libertad, name: "P.S. LA LIBERTAD", microred: "SAN RAFAEL" }, { site: nuevoLima, name: "C.S. NUEVO LIMA", microred: "BAJO BIAVO" }],
  lines: [line("06516", "0001552", "19421", "L1", 20), line("06516", "0001552", "19422", "L2", 10), line("06519", "0001560", "19421", "L1", 4)],
  productName: (code: string) => `Producto ${code}`,
};

const values = (sheet: { getRow: (n: number) => { values: unknown } }, row: number) => (sheet.getRow(row).values as unknown[]).slice(1);

describe("Excel de Revisión de guías", () => {
  it("resumen, detalle por producto y lote y las guías del mes", () => {
    const workbook = buildGuidesReviewWorkbook(input);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Resumen", "Detalle", "Guías de salida"]);
    const resumen = workbook.getWorksheet("Resumen")!;
    expect(values(resumen, 5)).toEqual(["SAN RAFAEL", "06516", "P.S. LA LIBERTAD", 1, 3, 1, 1, 0, 0, 1, "Con diferencias"]);
    expect(values(resumen, 6).at(-1)).toBe("Sin ICI del mes");
    const detalle = workbook.getWorksheet("Detalle")!;
    expect(detalle.rowCount).toBe(4 + 4);
    expect(values(detalle, 6).slice(0, 10)).toEqual(["06516", "P.S. LA LIBERTAD", "19422", "Producto 19422", "L2", 10, 6, -4, "Falta", "0001552"]);
    expect(values(detalle, 7).slice(8, 11)).toEqual(["No se dio salida", "", "0001259"]);
    // Sin ICI no hay «Ingresó» ni diferencia que mostrar.
    expect(values(detalle, 8).slice(6, 9)).toEqual([undefined, undefined, "Sin ICI del mes"]);
    expect(workbook.getWorksheet("Guías de salida")!.rowCount).toBe(4 + 3);
  });

  it("con `only`, solo ese establecimiento y sus guías", () => {
    const workbook = buildGuidesReviewWorkbook({ ...input, only: "06519" });
    expect(workbook.getWorksheet("Resumen")!.rowCount).toBe(5);
    expect(workbook.getWorksheet("Guías de salida")!.rowCount).toBe(5);
    expect(String(workbook.getWorksheet("Resumen")!.getCell("A2").value)).toContain("C.S. NUEVO LIMA (06519)");
  });

  it("nombre del archivo sin tildes ni espacios", () => {
    expect(guidesReviewFileName("030S05", "202609")).toBe("Revision_guias_030S05_2026-09.xlsx");
    expect(guidesReviewFileName("030S05", "202609", "06506 C.S. Consuelo de Juanjuí")).toBe("Revision_guias_030S05_2026-09_06506_C_S_Consuelo_de_Juanjui.xlsx");
    expect(siteReview(libertad)).toBe("Con diferencias");
  });
});
