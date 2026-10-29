import { describe, expect, it } from "vitest";
import type { GuideLine, ReviewRow, ReviewSite } from "./guidesReview";
import { buildGuidesReviewWorkbook, guidesReviewFileName, missingDetail, siteReview } from "./guidesReviewExport";

const site = (destination: string, iciCode: string | null, rows: ReviewRow[]): ReviewSite => {
  const counts = { short: 0, notReceived: 0, extra: 0, notSent: 0, complete: 0 };
  rows.forEach((r) => counts[r.state]++);
  return {
    destination,
    iciCode,
    guides: [...new Set(rows.flatMap((r) => r.guides))],
    rows,
    counts,
    differences: rows.length - counts.complete,
    sentProducts: rows.filter((r) => r.sent).length,
    receivedProducts: rows.filter((r) => r.received).length,
  };
};
const line = (destination: string, guide: string, product: string, lot: string, quantity: number): GuideLine =>
  ({ date: "2026-09-14", month: "202609", guide, destination, concept: "04", product, lot, quantity });

const libertad = site("06516", "06516", [
  { product: "19421", sent: 20, received: 20, state: "complete", lots: [{ lot: "L1", sent: 20, received: 20 }], guides: ["0001552"], previous: null },
  { product: "19422", sent: 10, received: 11, state: "extra", lots: [{ lot: "L2", sent: 10, received: 6 }, { lot: "L9", sent: 0, received: 5 }], guides: ["0001552"], previous: null },
  { product: "19423", sent: 0, received: 5, state: "notSent", lots: [{ lot: "L3", sent: 0, received: 5 }], guides: [], previous: { date: "2026-07-17", guide: "0001259" } },
]);
const nuevoLima = site("06519", null, [{ product: "19421", sent: 4, received: 0, state: "notReceived", lots: [{ lot: "L1", sent: 4, received: 0 }], guides: ["0001560"], previous: null }]);
const input = {
  warehouseName: "ALM. ANEXO BELLAVISTA",
  warehouseCode: "030S05",
  monthLabel: "Setiembre 2026",
  generatedAt: new Date(2026, 9, 28, 15, 0),
  sites: [{ site: libertad, name: "P.S. LA LIBERTAD", microred: "SAN RAFAEL" }, { site: nuevoLima, name: "C.S. NUEVO LIMA", microred: "BAJO BIAVO" }],
  lines: [line("06516", "0001552", "19421", "L1", 20), line("06516", "0001552", "19422", "L2", 10), line("06519", "0001560", "19421", "L1", 4)],
  productName: (code: string) => `Producto ${code}`,
  notes: { "06516|19423": "CORRECCIÓN DE LOTE" },
};

const values = (sheet: { getRow: (n: number) => { values: unknown } }, row: number) => (sheet.getRow(row).values as unknown[]).slice(1);

describe("Excel de Revisión de guías", () => {
  it("resumen con las columnas de la hoja CONTROL, detalle por producto, lotes y guías del mes", () => {
    const workbook = buildGuidesReviewWorkbook(input);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Resumen", "Detalle", "Lotes", "Guías de salida"]);
    const resumen = workbook.getWorksheet("Resumen")!;
    expect(values(resumen, 4)).toEqual(["Microred", "Código", "Establecimiento", "Nº guías", "Salida med", "Ingreso med", "Completo", "Incompleto", "No ingresó", "Sobra", "Sin guía", "Revisión", "Detalle faltante", "Detalle no ingresado", "Observados"]);
    expect(values(resumen, 5)).toEqual(["SAN RAFAEL", "06516", "P.S. LA LIBERTAD", 1, 2, 3, 1, 0, 0, 1, 1, "Con diferencias", "", "", 1]);
    // Sin ICI solo se sabe lo que salió.
    expect(values(resumen, 6)).toEqual(["BAJO BIAVO", "06519", "C.S. NUEVO LIMA", 1, 1, undefined, undefined, undefined, undefined, undefined, undefined, "Sin ICI del mes", "", "", 0]);
    const detalle = workbook.getWorksheet("Detalle")!;
    expect(detalle.rowCount).toBe(4 + 4);
    expect(values(detalle, 6).slice(0, 10)).toEqual(["06516", "P.S. LA LIBERTAD", "19422", "Producto 19422", 10, 11, 1, "Sobra", "L2: salió 10, ingresó 6; L9: sin guía, ingresó 5", "0001552"]);
    expect(values(detalle, 7).slice(7, 11)).toEqual(["Sin guía", "L3: sin guía, ingresó 5", "", "0001259"]);
    expect(values(detalle, 7).at(-1)).toBe("CORRECCIÓN DE LOTE");
    expect(values(detalle, 8).slice(5, 9)).toEqual([undefined, undefined, "Sin ICI del mes", "L1: 4"]);
    const lotes = workbook.getWorksheet("Lotes")!;
    expect(lotes.rowCount).toBe(4 + 5);
    expect(values(lotes, 7)).toEqual(["06516", "P.S. LA LIBERTAD", "19422", "Producto 19422", "L9", 0, 5, 5, "Sin guía", "Sobra"]);
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

  it("detalle faltante y no ingresado como la hoja CONTROL", () => {
    const s = site("06506", "06506", [
      { product: "03519", sent: 30, received: 20, state: "short", lots: [], guides: ["1"], previous: null },
      { product: "33891", sent: 12.5, received: 0, state: "notReceived", lots: [], guides: ["1"], previous: null },
      { product: "05884", sent: 4, received: 0, state: "notReceived", lots: [], guides: ["1"], previous: null },
    ]);
    expect(missingDetail(s, (c) => `MED ${c}`, "short")).toBe("- MED 03519: 10");
    expect(missingDetail(s, (c) => `MED ${c}`, "notReceived")).toBe("- MED 33891: 12,5; - MED 05884: 4");
    expect(missingDetail({ ...s, iciCode: null }, (c) => c, "notReceived")).toBe("");
  });
});
