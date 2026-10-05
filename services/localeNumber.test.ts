import { describe, expect, it } from "vitest";
import { detectCsvDelimiter, parseLocaleNumber } from "./localeNumber";

describe("parseLocaleNumber", () => {
  it("coma decimal: no multiplica por 100", () => {
    expect(parseLocaleNumber("12,5", ",")).toBe(12.5);
    expect(parseLocaleNumber("0,35", ",")).toBe(0.35);
    expect(parseLocaleNumber("1.234,5", ",")).toBe(1234.5);
    expect(parseLocaleNumber("1 234", ",")).toBe(1234);
  });

  it("punto decimal", () => {
    expect(parseLocaleNumber("12.5", ".")).toBe(12.5);
    expect(parseLocaleNumber("1,234.5", ".")).toBe(1234.5);
  });

  it("automático", () => {
    expect(parseLocaleNumber("0,35")).toBe(0.35);
    expect(parseLocaleNumber("2 193,5")).toBe(2193.5);
    expect(parseLocaleNumber("1,234.5")).toBe(1234.5);
    expect(parseLocaleNumber("21 300")).toBe(21300);
    expect(parseLocaleNumber(42)).toBe(42);
  });

  it("texto que no es número da NaN", () => {
    expect(parseLocaleNumber("abc")).toBeNaN();
    expect(parseLocaleNumber("")).toBeNaN();
    expect(parseLocaleNumber(null)).toBeNaN();
  });
});

describe("detectCsvDelimiter", () => {
  it("reconoce punto y coma, tabulador y coma", () => {
    expect(detectCsvDelimiter("MED COD;DESCRIPCION;PRECIO\n00143;X;0,35")).toBe(";");
    expect(detectCsvDelimiter("MED COD\tDESCRIPCION\n")).toBe("\t");
    expect(detectCsvDelimiter("MED COD,DESCRIPCION\n")).toBe(",");
  });
});
