import { describe, expect, it } from "vitest";
import { findMesKey, mesNumberOfHeader, TEMPLATE_MONTH_HEADERS } from "./requirementMonths";

describe("columnas de meses del requerimiento", () => {
  it("reconoce MES01 y también MES_1, MES 1 y Mes-12", () => {
    expect(mesNumberOfHeader("MES01")).toBe(1);
    expect(mesNumberOfHeader("MES_1")).toBe(1);
    expect(mesNumberOfHeader("MES 1")).toBe(1);
    expect(mesNumberOfHeader("Mes-12")).toBe(12);
    expect(mesNumberOfHeader("MES_10")).toBe(10);
  });

  it("no confunde otras columnas", () => {
    expect(mesNumberOfHeader("MESES_PROV")).toBeNull();
    expect(mesNumberOfHeader("MES13")).toBeNull();
    expect(mesNumberOfHeader("MES00")).toBeNull();
    expect(mesNumberOfHeader("SUMAMES")).toBeNull();
  });

  it("MES_1 no se toma como MES_10 ni MES_11", () => {
    const keys = ["MES_10", "MES_11", "MES_1", "MES_12"];
    expect(findMesKey(keys, 1)).toBe("MES_1");
    expect(findMesKey(keys, 10)).toBe("MES_10");
  });

  it("la plantilla trae MES01 … MES12, que el sistema reconoce", () => {
    expect(TEMPLATE_MONTH_HEADERS[0]).toBe("MES01");
    expect(TEMPLATE_MONTH_HEADERS[11]).toBe("MES12");
    expect(TEMPLATE_MONTH_HEADERS.map(mesNumberOfHeader)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
