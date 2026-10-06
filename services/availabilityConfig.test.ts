import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY_FORMULA, diffFusedGroups, normalizeFormula, normalizeFusedCatalog, parseFusedCodesSheet } from "./availabilityConfig";
import { DEFAULT_VITAL_PRODUCTS } from "./vitalProducts";

describe("configuración de disponibilidad", () => {
  it("la fórmula de fábrica: sin cortar, Sin rotación solo vitales en la DME", () => {
    expect(DEFAULT_AVAILABILITY_FORMULA.truncate).toBe(false);
    expect(DEFAULT_AVAILABILITY_FORMULA.essential.sinRotacion).toBe("vital");
    expect(DEFAULT_AVAILABILITY_FORMULA.all.sinRotacion).toBe("no");
  });

  it("normaliza lo que llega de la base", () => {
    const f = normalizeFormula({ all: { sinRotacion: "vital", substock: true }, subMax: 3, sobreMin: 1, levels: { optimo: 95, alto: 99, regular: 50 }, aggregate: "sum" });
    expect(f.all.sinRotacion).toBe("no"); // «vital» no aplica a todos los productos
    expect(f.all.substock).toBe(true);
    expect(f.sobreMin).toBe(3); // nunca por debajo del límite de Substock
    expect(f.levels).toEqual({ optimo: 95, alto: 95, regular: 50 });
    expect(f.aggregate).toBe("sum");
    expect(normalizeFormula(null)).toEqual(DEFAULT_AVAILABILITY_FORMULA);
  });

  it("lee el listado de DIGEMID y compara versiones", () => {
    const groups = parseFusedCodesSheet([
      ["MEDCOD", "NOMBRE", "TIPO", "PETITORIO", "ESTADO", "MEDCOD_FUSIONADO", "NOMBRE_2"],
      ["96", "AAS 81", "M", "P", "C", "91", "AAS 100 mg TABLETA"],
      ["91", "AAS 100", "M", "P", "C", "91", "AAS 100 mg TABLETA"],
      ["00786", "AMOX 120", "M", "P", "C", "00794", "AMOX 60 mL"],
    ]);
    expect(groups["00091"]).toEqual({ name: "AAS 100 mg TABLETA", codes: ["00091", "00096"] });
    const d = diffFusedGroups({ "00091": { name: "", codes: ["00091"] }, "01044": { name: "", codes: ["01044", "18048"] } }, groups);
    expect(d).toEqual({ added: ["00794"], changed: ["00091"], removed: ["01044"] });
    expect(() => parseFusedCodesSheet([["A"]])).toThrow(/MEDCOD_FUSIONADO/);
  });

  it("un grupo siempre incluye su propio código destino", () => {
    expect(normalizeFusedCatalog({ version: "x", groups: { "91": { name: "AAS", codes: ["96"] } } })!.groups["00091"].codes).toEqual(["00091", "00096"]);
  });

  it("los 114 vitales de la RM 1288-2018", () => {
    expect(DEFAULT_VITAL_PRODUCTS).toHaveLength(114);
    expect(DEFAULT_VITAL_PRODUCTS.find((v) => v.n === 14)!.codes).toEqual(["00910"]);
  });
});
