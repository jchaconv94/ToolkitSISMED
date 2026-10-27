import { describe, expect, it } from "vitest";
import { buildNetworkExpiry } from "./networkExpiry";
import { buildNetworkExpiryWorkbook, networkExpiryFileName, quantityCell } from "./networkExpiryExport";

const NOW = new Date(2026, 9, 27, 10, 30);

const data = buildNetworkExpiry(
  [
    {
      id: "a",
      name: "P.S. Challual",
      code: "35635",
      rows: [
        { Fec_Vencim: "20/10/2026", Saldo: "40", ID_Producto: "05555", Nombre: "INSULINA NPH", Lote: "C33", Precio_Det: "24.5", ALMCOD: "35635F02", DESC_ALM: "PUESTO LA FLOR" },
        { Fec_Vencim: "10/11/2026", Saldo: "120", ID_Producto: "01234", Nombre: "PARACETAMOL 500 mg", Lote: "A12", Precio_Det: "0,2", ALMCOD: "35635" },
      ],
    },
  ],
  90,
  NOW,
);

describe("buildNetworkExpiryWorkbook", () => {
  const workbook = buildNetworkExpiryWorkbook(data, { scope: "Bellavista", windowDays: 90, generatedAt: NOW });

  it("trae primero el resumen por producto, lo más urgente arriba", () => {
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Por producto", "Lotes", "Por establecimiento"]);
    const sheet = workbook.getWorksheet("Por producto")!;
    expect(sheet.getRow(5).getCell(2).value).toBe("INSULINA NPH");
    expect(sheet.getRow(5).getCell(3).value).toBe(1);
    expect(sheet.getRow(5).getCell(9).value).toEqual(new Date(Date.UTC(2026, 9, 20)));
    expect(sheet.getRow(6).getCell(2).value).toBe("PARACETAMOL 500 mg");
  });

  it("tiene la hoja de lotes con números y fechas de verdad", () => {
    const sheet = workbook.getWorksheet("Lotes")!;
    expect(sheet.getRow(4).values).toEqual([
      undefined, "Código producto", "Producto", "Establecimiento", "Código", "Farmacia", "Lote", "Vence", "Días", "Situación", "Saldo", "Precio", "Valor",
    ]);
    const first = sheet.getRow(5);
    expect(first.getCell(2).value).toBe("INSULINA NPH");
    expect(first.getCell(3).value).toBe("P.S. Challual");
    expect(first.getCell(5).value).toBe("35635F02 PUESTO LA FLOR");
    expect(first.getCell(7).value).toEqual(new Date(Date.UTC(2026, 9, 20)));
    expect(first.getCell(8).value).toBe(-7);
    expect(first.getCell(9).value).toBe("Vencido");
    expect(first.getCell(10).value).toBe(40);
    expect(first.getCell(12).value).toBeCloseTo(980);
    expect(sheet.getRow(6).getCell(9).value).toBe("Por vencer");
    expect(String(sheet.getCell("A2").value)).toContain("Bellavista");
  });

  it("resume por establecimiento", () => {
    const row = workbook.getWorksheet("Por establecimiento")!.getRow(5);
    expect(row.getCell(1).value).toBe("P.S. Challual");
    expect(row.getCell(3).value).toBe(1);
    expect(row.getCell(5).value).toBe(1);
    expect(row.getCell(7).value).toBeCloseTo(1004);
  });

  it("no escribe la «u» de unidades", () => {
    const sheet = workbook.getWorksheet("Lotes")!;
    sheet.eachRow((row) => row.eachCell((cell) => expect(String(cell.numFmt ?? "")).not.toMatch(/"u"|\bu\b/)));
  });
});

describe("quantityCell", () => {
  it("un entero no lleva el punto suelto («60.»)", () => {
    expect(quantityCell(60)).toEqual({ value: 60, numFmt: "#,##0" });
    expect(quantityCell(59.99999999)).toEqual({ value: 60, numFmt: "#,##0" });
  });

  it("un decimal conserva hasta tres decimales", () => {
    expect(quantityCell(2.5)).toEqual({ value: 2.5, numFmt: "#,##0.###" });
    expect(quantityCell(2773.125)).toEqual({ value: 2773.125, numFmt: "#,##0.###" });
  });

  it("en el Excel, el saldo entero sale sin punto y el decimal con sus decimales", () => {
    const mixed = buildNetworkExpiry(
      [{ id: "b", name: "C.S. Juan Guerra", code: "06530", rows: [
        { Fec_Vencim: "20/10/2026", Saldo: "60", ID_Producto: "01", Nombre: "A", Lote: "L1", Precio_Det: "1" },
        { Fec_Vencim: "21/10/2026", Saldo: "2.5", ID_Producto: "02", Nombre: "B", Lote: "L2", Precio_Det: "1" },
      ] }],
      90,
      NOW,
    );
    const lots = buildNetworkExpiryWorkbook(mixed, { scope: "Bellavista", windowDays: 90, generatedAt: NOW }).getWorksheet("Lotes")!;
    expect(lots.getRow(5).getCell(10).value).toBe(60);
    expect(lots.getRow(5).getCell(10).numFmt).toBe("#,##0");
    expect(lots.getRow(6).getCell(10).value).toBe(2.5);
    expect(lots.getRow(6).getCell(10).numFmt).toBe("#,##0.###");
  });
});

describe("networkExpiryFileName", () => {
  it("sin tildes ni espacios", () => {
    expect(networkExpiryFileName("Bellavista", NOW)).toBe("Vencimientos_Bellavista_2026-10-27.xlsx");
    expect(networkExpiryFileName("Juanjuí Huallaga", NOW)).toBe("Vencimientos_Juanjui_Huallaga_2026-10-27.xlsx");
  });
});
