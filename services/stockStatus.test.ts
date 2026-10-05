import { describe, expect, it } from "vitest";
import { analysisFilterValue, classifyStock, computeDmeIndicators, formatOneDecimal, monthsOfStock, truncateOneDecimal } from "./stockStatus";
import { StockStatus } from "../types";

describe("classifyStock (regla DIGEMID)", () => {
  it("stock 0 es desabastecido, tenga o no consumo", () => {
    expect(classifyStock(0, 10).status).toBe(StockStatus.DESABASTECIDO);
    expect(classifyStock(0, 0).status).toBe(StockStatus.DESABASTECIDO);
  });

  it("sin consumo y con stock es sin rotación", () => {
    expect(classifyStock(15, 0).status).toBe(StockStatus.SIN_ROTACION);
    expect(classifyStock(15, 0).months).toBe(Infinity);
  });

  it("substock, normostock y sobrestock por meses de existencia", () => {
    expect(classifyStock(10, 10).status).toBe(StockStatus.SUBSTOCK);
    expect(classifyStock(20, 10).status).toBe(StockStatus.NORMOSTOCK);
    expect(classifyStock(60, 10).status).toBe(StockStatus.NORMOSTOCK);
    expect(classifyStock(61, 10).status).toBe(StockStatus.SOBRESTOCK);
  });

  it("corta los meses a un decimal, sin redondear", () => {
    // 59 / 30 = 1,967 → 1,9: todavía no llega a 2 meses.
    expect(classifyStock(59, 30).status).toBe(StockStatus.SUBSTOCK);
    expect(classifyStock(60, 30).status).toBe(StockStatus.NORMOSTOCK);
    // 181 / 30 = 6,03 → 6,0.
    expect(classifyStock(181, 30).status).toBe(StockStatus.NORMOSTOCK);
    // 6,15 → 6,1.
    expect(classifyStock(61.5, 10).status).toBe(StockStatus.SOBRESTOCK);
  });

  it("el pedido sugerido (CPA × 6 hacia arriba) no vuelve Sobrestock al ítem", () => {
    const cpa = 10.3;
    const stock = 5;
    const pedido = Math.ceil(cpa * 6 - stock); // 57 → 62 / 10,3 = 6,02 → 6,0
    expect(classifyStock(stock + pedido, cpa).status).toBe(StockStatus.NORMOSTOCK);
  });

  it("monthsOfStock, truncateOneDecimal y formatOneDecimal", () => {
    expect(monthsOfStock(0, 0)).toBe(0);
    expect(monthsOfStock(30, 10)).toBe(3);
    expect(truncateOneDecimal(2.96)).toBe(2.9);
    expect(truncateOneDecimal(2.3)).toBe(2.3);
    expect(truncateOneDecimal(Infinity)).toBe(Infinity);
    expect(formatOneDecimal(10.3333)).toBe("10.3");
    expect(formatOneDecimal(1.96)).toBe("1.9");
    expect(formatOneDecimal(Infinity)).toBe("-");
  });
});

describe("computeDmeIndicators", () => {
  const esencial = { medtip: "M", medpet: "P", medest: "_" };
  it("cuenta Normostock y Sobrestock sobre los esenciales, con Sin rotación en el denominador", () => {
    const r = computeDmeIndicators([
      { ...esencial, status: StockStatus.NORMOSTOCK },
      { ...esencial, status: StockStatus.SOBRESTOCK },
      { ...esencial, status: StockStatus.SIN_ROTACION },
      { ...esencial, status: StockStatus.DESABASTECIDO },
      { medtip: "I", medpet: "P", medest: "_", status: StockStatus.NORMOSTOCK },
    ]);
    expect(r.totalItems).toBe(4);
    expect(r.availableItems).toBe(2);
    expect(r.dmeScore).toBe(50);
    expect(r.status).toBe("BAJO");
  });
  it("sin esenciales da 0", () => {
    expect(computeDmeIndicators([]).dmeScore).toBe(0);
  });
});

describe("analysisFilterValue", () => {
  it("agrupa meses y CPA por un decimal cortado", () => {
    expect(analysisFilterValue({ monthsOfProvision: 2.9666 }, "monthsOfProvision")).toBe("2.9");
    expect(analysisFilterValue({ cpm: 10.3333 }, "cpm")).toBe("10.3");
    expect(analysisFilterValue({ monthsOfProvision: Infinity }, "monthsOfProvision")).toBe("-");
    expect(analysisFilterValue({ ff: "TAB" }, "ff")).toBe("TAB");
    expect(analysisFilterValue({ isSporadic: true }, "isSporadic")).toBe("Baja Rotación");
  });
});
