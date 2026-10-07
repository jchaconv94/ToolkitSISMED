import { describe, expect, it } from "vitest";
import { StockStatus } from "../types";
import type { AvailabilityItem } from "./availabilityReport";
import {
  abcXyzReport, asSupplier, consumptionReport, internalTransfers, isSeparateSite, siteGapReport, lotRiskOf, pharmacyKind, overstockReport, peakOf, productGapReport, redistributionReport, variationOf, warehouseReport, xyzOf,
} from "./availabilityInsights";

const today = new Date(2026, 9, 7);
const inMonths = (m: number) => new Date(today.getTime() + m * 30.4375 * 86400000);

const item = (over: Partial<AvailabilityItem>): AvailabilityItem => ({
  red: "BELLAVISTA", microred: "MR1", code: "00001", ipressCode: "00001", name: "P.S. UNO", category: "I-1",
  medCode: "01000", description: "PRODUCTO", form: "", price: 1, medtip: "M", medpet: "P", medest: "S",
  consumption: Array(12).fill(10), stock: 0, cpa: 10, months: 0, status: StockStatus.DESABASTECIDO,
  nearestExpiry: null, lots: [], monthsToExpiry: null, expiryRisk: false,
  ...over,
});

describe("riesgo de vencimiento por lote (FEFO)", () => {
  it("usa primero el lote que vence antes y deja en riesgo lo que no alcanza", () => {
    const it = item({ cpa: 10, stock: 70, price: 2, lots: [
      { lot: "B", expiry: inMonths(12), balance: 30 },
      { lot: "A", expiry: inMonths(2), balance: 40 },
    ] });
    const rows = lotRiskOf(it, today);
    expect(rows).toHaveLength(1);
    expect(rows[0].lot.lot).toBe("A");
    expect(rows[0].usable).toBe(20);
    expect(rows[0].atRisk).toBe(20);
    expect(rows[0].value).toBe(40);
  });

  it("el segundo lote solo puede usar el tiempo que deja libre el primero", () => {
    const it = item({ cpa: 10, lots: [
      { lot: "A", expiry: inMonths(3), balance: 30 },
      { lot: "B", expiry: inMonths(4), balance: 30 },
    ] });
    const rows = lotRiskOf(it, today);
    expect(rows.map((r) => [r.lot.lot, r.atRisk])).toEqual([["B", 20]]);
  });

  it("sin consumo todo el saldo está en riesgo", () => {
    expect(lotRiskOf(item({ cpa: 0, lots: [{ lot: "A", expiry: inMonths(20), balance: 15 }] }), today)[0].atRisk).toBe(15);
  });
});

describe("consumo irregular", () => {
  it("marca un pico de 3 veces el promedio de los demás meses", () => {
    const p = peakOf(item({ consumption: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 60] }));
    expect(p?.peakIndex).toBe(11);
    expect(p?.ratio).toBe(6);
  });

  it("un consumo parejo desde que empezó a usarse no es pico ni irregular", () => {
    const it = item({ consumption: [0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30] });
    expect(peakOf(it)).toBeNull();
    const r = consumptionReport([it]);
    expect(r.peaks).toHaveLength(0);
    expect(r.classified[0].xyz).toBe("X");
  });

  it("los meses en cero no bajan el promedio de comparación", () => {
    const p = peakOf(item({ consumption: [0, 0, 5, 0, 5, 0, 5, 0, 0, 0, 0, 40] }));
    expect(p?.othersAverage).toBe(5);
    expect(p?.ratio).toBe(8);
  });

  it("no marca pico con pocos meses de consumo o pocas unidades", () => {
    expect(peakOf(item({ consumption: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 60] }))).toBeNull();
    expect(peakOf(item({ consumption: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 10] }))).toBeNull();
  });

  it("XYZ por coeficiente de variación", () => {
    expect(variationOf(Array(12).fill(5))).toBe(0);
    expect(xyzOf(0.3)).toBe("X");
    expect(xyzOf(0.8)).toBe("Y");
    expect(xyzOf(1.5)).toBe("Z");
  });
});

describe("ABC por valor consumido", () => {
  it("A junta el 80 % del valor", () => {
    const data = abcXyzReport([
      item({ medCode: "A", price: 80, consumption: Array(12).fill(1) }),
      item({ medCode: "B", price: 15, consumption: Array(12).fill(1) }),
      item({ medCode: "C", price: 5, consumption: Array(12).fill(1) }),
    ]);
    expect(data.products.map((p) => `${p.medCode}${p.abc}${p.xyz}`)).toEqual(["AAX", "BBX", "CCX"]);
  });
});

describe("sobrestock, redistribución y faltantes", () => {
  const donor = item({ code: "00002", name: "DONANTE", stock: 100, cpa: 10, months: 10, status: StockStatus.SOBRESTOCK, price: 2 });
  const needy = item({ code: "00003", name: "RECIBE", stock: 0, cpa: 10, months: 0, status: StockStatus.DESABASTECIDO });
  const far = item({ code: "00004", name: "OTRA MICRORED", microred: "MR2", stock: 0, cpa: 5, status: StockStatus.DESABASTECIDO });

  it("el excedente es lo que pasa de 6 meses de consumo", () => {
    const r = overstockReport([donor], 6);
    expect(r.rows[0].excess).toBe(40);
    expect(r.value).toBe(80);
  });

  it("redistribuye lo justo para llegar al mínimo sin bajar del límite al que entrega", () => {
    const r = redistributionReport([donor, needy, far], 2, 6);
    expect(r.rows.map((t) => [t.to.name, t.quantity])).toEqual([["RECIBE", 20], ["OTRA MICRORED", 10]]);
    expect(r.sameMicrored).toBe(1);
  });

  it("cuenta dónde falta y quién tiene excedente", () => {
    const [g] = productGapReport([donor, needy, far], [{ code: "030S05", name: "ALMACEN", medCode: "01000", description: "", price: 1, stock: 50, lots: [] }]);
    expect(g.desabastecido).toBe(2);
    expect(g.donors).toBe(1);
    expect(g.warehouseStock).toBe(50);
  });

  it("almacén: cobertura de la necesidad de los establecimientos", () => {
    const r = warehouseReport([{ code: "030S05", name: "ALMACEN", medCode: "01000", description: "", price: 1, stock: 15, lots: [] }], [donor, needy, far], 2);
    expect(r.rows[0].inNeed).toBe(2);
    expect(r.rows[0].needUnits).toBe(30);
    expect(r.rows[0].coverage).toBe(50);
  });
});

describe("farmacias del hospital y puestos comunales", () => {
  it("F01 y las farmacias del hospital se suman; los puestos comunales y las sin tipo van aparte", () => {
    expect(isSeparateSite("06502F01", undefined)).toBe(false);
    expect(isSeparateSite("06502F02", "FARMACIA")).toBe(false);
    expect(isSeparateSite("06528F02", "PUESTO_COMUNAL")).toBe(true);
    expect(isSeparateSite("06528F03", undefined)).toBe(true);
    expect(isSeparateSite("06502", undefined)).toBe(false);
  });

  it("nombra el tipo de cada farmacia", () => {
    expect(pharmacyKind("06502F01")).toBe("Principal");
    expect(pharmacyKind("06502F02", "FARMACIA")).toBe("Farmacia del hospital");
    expect(pharmacyKind("06528F02", "PUESTO_COMUNAL")).toBe("Puesto comunal");
    expect(pharmacyKind("06528F03")).toBe("Sin tipo");
    expect(pharmacyKind("06502")).toBeNull();
  });

  it("la F01 que abastece a sus puestos cuenta lo que les entrega en su ritmo de salida", () => {
    // Dispensa 10 al mes y entrega 20 a sus puestos (OTRAS_SAL): para el vencimiento salen 30.
    const f01 = item({ code: "06520F01", ipressCode: "06520", cpa: 10, otherOut: Array(12).fill(20), lots: [{ lot: "A", expiry: inMonths(3), balance: 90 }] });
    expect(lotRiskOf(f01, today)[0].atRisk).toBe(60);
    const supplier = asSupplier(f01);
    expect(supplier.cpa).toBe(30);
    expect(supplier.dispensedCpa).toBe(10);
    expect(lotRiskOf(supplier, today)).toHaveLength(0);
    // Sin otras salidas no cambia nada.
    expect(asSupplier(item({ cpa: 10 }))).toEqual(item({ cpa: 10 }));
  });
});

describe("puestos comunales escondidos en la cifra del establecimiento", () => {
  const puesto = (code: string, over: Partial<AvailabilityItem>) => item({ code, ipressCode: code.slice(0, 5), medCode: "02149", ...over });
  const isSeparate = (code: string) => isSeparateSite(code, undefined);
  const f01 = puesto("06528F01", { stock: 586, cpa: 100, months: 5.86, status: StockStatus.NORMOSTOCK });
  const f02 = puesto("06528F02", { stock: 0, cpa: 15, months: 0, status: StockStatus.DESABASTECIDO });
  const f03 = puesto("06528F03", { stock: 10, cpa: 30, months: 0.33, status: StockStatus.SUBSTOCK });

  it("encuentra el puesto desabastecido que la cifra sumada no muestra", () => {
    const ipress = puesto("06528", { stock: 596, cpa: 145, months: 4.1, status: StockStatus.NORMOSTOCK });
    const rows = siteGapReport([ipress], [f01, f02, f03], isSeparate);
    // Solo el desabastecido (el substock no), con su F01 al lado.
    expect(rows.map((r) => [r.item.code, r.main?.code])).toEqual([["06528F02", "06528F01"]]);
    // Si el establecimiento ya figura como faltante, no se repite aquí.
    expect(siteGapReport([{ ...ipress, status: StockStatus.SUBSTOCK }], [f01, f02], isSeparate)).toHaveLength(0);
    // Las farmacias del hospital no son puestos.
    expect(siteGapReport([ipress], [f01, f02], (c) => isSeparateSite(c, "FARMACIA"))).toHaveLength(0);
  });

  it("la F01 entrega a sus puestos lo justo para 2 meses y se queda con 2 meses de lo suyo", () => {
    const rows = internalTransfers([f01, f02, f03], 2, isSeparate);
    // Le sobran 586 − 100 × 2 = 386: primero al desabastecido (30), luego al substock (50).
    expect(rows.map((r) => [r.to.code, r.quantity, r.internal])).toEqual([["06528F02", 30, true], ["06528F03", 50, true]]);
    // Sin excedente en la F01 no hay sugerencia.
    expect(internalTransfers([{ ...f01, stock: 150 }, f02], 2, isSeparate)).toHaveLength(0);
  });
});
