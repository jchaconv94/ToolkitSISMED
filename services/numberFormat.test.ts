import { describe, expect, it } from "vitest";
import { formatNumber, parseSheetNumber } from "./numberFormat";

describe("formatNumber", () => {
  it("miles con espacio y coma decimal", () => {
    expect(formatNumber(21300)).toBe("21 300");
    expect(formatNumber(100000)).toBe("100 000");
    expect(formatNumber(2193.5, 1)).toBe("2 193,5");
    expect(formatNumber(950)).toBe("950");
  });
  it("sin ceros sobrantes ni números rotos", () => {
    expect(formatNumber(12, 1)).toBe("12");
    expect(formatNumber(0.4, 1)).toBe("0,4");
    expect(formatNumber(-1500)).toBe("-1 500");
    expect(formatNumber(Number.NaN)).toBe("—");
  });
});

describe("parseSheetNumber", () => {
  it("un solo signo es el decimal, sea punto o coma", () => {
    // Precio detalle con tres decimales: el caso que salía ×1000 en el Excel consolidado.
    expect(parseSheetNumber("2773.125")).toBeCloseTo(2773.125);
    expect(parseSheetNumber("1344.375")).toBeCloseTo(1344.375);
    expect(parseSheetNumber("2773,125")).toBeCloseTo(2773.125);
    // Coma con tres o más decimales: el caso que Stock SISMED leía como miles.
    expect(parseSheetNumber("0,324")).toBeCloseTo(0.324);
    expect(parseSheetNumber("6,4125")).toBeCloseTo(6.4125);
    expect(parseSheetNumber("3081.25")).toBeCloseTo(3081.25);
    expect(parseSheetNumber("27")).toBe(27);
  });
  it("con los dos signos, el último es el decimal; uno repetido separa miles", () => {
    expect(parseSheetNumber("1.234,5")).toBeCloseTo(1234.5);
    expect(parseSheetNumber("1,234.5")).toBeCloseTo(1234.5);
    expect(parseSheetNumber("1,234,567.25")).toBeCloseTo(1234567.25);
    expect(parseSheetNumber("1.234.567")).toBe(1234567);
    expect(parseSheetNumber("1 250")).toBe(1250);
  });
  it("lo ilegible es cero, no NaN", () => {
    expect(parseSheetNumber(7)).toBe(7);
    expect(parseSheetNumber(-3.5)).toBe(-3.5);
    expect(parseSheetNumber("-2,5")).toBe(-2.5);
    expect(parseSheetNumber("sin dato")).toBe(0);
    expect(parseSheetNumber("")).toBe(0);
    expect(parseSheetNumber(null)).toBe(0);
    expect(parseSheetNumber(undefined)).toBe(0);
    expect(parseSheetNumber(Number.NaN)).toBe(0);
  });
});
