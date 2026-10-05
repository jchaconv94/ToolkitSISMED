import { describe, expect, it } from "vitest";
import { classifyStock, computeDmeIndicators, monthsOfStock, roundMonths } from "./stockStatus";
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

  it("compara los meses sin redondear", () => {
    // 59 / 30 = 1,967: aunque se lea «2,0», todavía no llega a 2 meses.
    expect(classifyStock(59, 30).status).toBe(StockStatus.SUBSTOCK);
    expect(classifyStock(60, 30).status).toBe(StockStatus.NORMOSTOCK);
    // 181 / 30 = 6,03: pasa de 6 meses.
    expect(classifyStock(181, 30).status).toBe(StockStatus.SOBRESTOCK);
  });

  it("monthsOfStock y roundMonths", () => {
    expect(monthsOfStock(0, 0)).toBe(0);
    expect(monthsOfStock(30, 10)).toBe(3);
    expect(roundMonths(1.96)).toBe(2);
    expect(roundMonths(Infinity)).toBe(Infinity);
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
