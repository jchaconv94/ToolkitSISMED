import { describe, expect, it } from "vitest";
import { isVaccineProduct } from "./vaccines";

describe("isVaccineProduct", () => {
  it("reconoce vacunas, abreviaturas, toxoides y diluyentes", () => {
    expect(isVaccineProduct("VACUNA BCG")).toBe(true);
    expect(isVaccineProduct("VAC. ANTIAMARILICA")).toBe(true);
    expect(isVaccineProduct("VAC ANTIPOLIO ORAL")).toBe(true);
    expect(isVaccineProduct("TOXOIDE TETANICO")).toBe(true);
    expect(isVaccineProduct("DILUYENTE PARA VACUNA BCG")).toBe(true);
    expect(isVaccineProduct("vacuna antihepatitis b")).toBe(true);
  });

  it("no confunde otros productos", () => {
    expect(isVaccineProduct("PARACETAMOL 500 MG TAB")).toBe(false);
    expect(isVaccineProduct("BOLSA COLECTORA VACIA")).toBe(false);
    expect(isVaccineProduct("JERINGA DESCARTABLE")).toBe(false);
    expect(isVaccineProduct("")).toBe(false);
  });
});
