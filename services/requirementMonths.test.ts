import { describe, expect, it } from "vitest";
import { currentCorte, findMesKey, formatCorteDate, isCorteFromPastMonth, mesNumberOfHeader, TEMPLATE_MONTH_HEADERS } from "./requirementMonths";

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

describe("mes de corte", () => {
  const octubre = new Date(2026, 9, 4);

  it("se escribe en palabras", () => {
    expect(formatCorteDate("2026-09")).toBe("SETIEMBRE 2026");
    expect(formatCorteDate("2026-10")).toBe("OCTUBRE 2026");
    expect(formatCorteDate("otro")).toBe("otro");
  });

  it("el mes en curso", () => {
    expect(currentCorte(octubre)).toBe("2026-10");
  });

  it("avisa solo si el corte es de un mes ya pasado", () => {
    expect(isCorteFromPastMonth("2026-09", octubre)).toBe(true);
    expect(isCorteFromPastMonth("2025-12", octubre)).toBe(true);
    expect(isCorteFromPastMonth("2026-10", octubre)).toBe(false);
    expect(isCorteFromPastMonth("2026-11", octubre)).toBe(false);
    expect(isCorteFromPastMonth("", octubre)).toBe(false);
  });
});
