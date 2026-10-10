import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY_FORMULA, DEFAULT_DME_EXCLUDED, classifyOptionsOf, describeFormula, dmeExcludedCodes, diffFusedGroups, normalizeFormula, normalizeFusedCatalog, parseFusedCodesSheet } from "./availabilityConfig";
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

  it("gran volumen (ficha 28, consideración a): de fábrica solo en la DME, desde 1 mes", () => {
    // Una fórmula guardada antes de la regla no la trae: vale la de la ficha 28.
    const old = normalizeFormula({ all: { normostock: true }, essential: { sinRotacion: "vital" }, subMax: 2, sobreMin: 6 });
    expect(old.essential.largeVolume).toBe(true);
    expect(old.all.largeVolume).toBe(false);
    expect(old.largeVolumeMonths).toBe(1);
    // Nunca por encima del límite de Substock.
    expect(normalizeFormula({ subMax: 2, largeVolumeMonths: 5 }).largeVolumeMonths).toBe(2);
    expect(classifyOptionsOf(old, "essential").largeVolumeMonths).toBe(1);
    expect(classifyOptionsOf(old, "all").largeVolumeMonths).toBeUndefined();
    expect(describeFormula(old, "essential")).toMatch(/soluciones de 1 L o más: Normostock desde 1 mes/);
    expect(describeFormula(old, "all")).not.toMatch(/1 L/);
    // Las listas a mano: con sus ceros y sin repetidos.
    // Antes se guardaban solo códigos; ahora código y nombre. Las dos formas se leen.
    const manual = normalizeFormula({ largeVolumeAdd: ["8166", "08166", 5873, { code: "6517", name: " YODO POVIDONA 1 L " }], largeVolumeSkip: "x" });
    expect(manual.largeVolumeAdd).toEqual([{ code: "08166", name: "" }, { code: "05873", name: "" }, { code: "06517", name: "YODO POVIDONA 1 L" }]);
    expect(manual.largeVolumeSkip).toEqual([]);
    expect(old.largeVolumeAdd).toEqual([]);
    expect(classifyOptionsOf(manual, "essential").largeVolumeAdd).toEqual(["08166", "05873", "06517"]);
    expect(describeFormula(manual, "essential")).toMatch(/3 agregados a mano/);
    // Nombres cambiados a mano de los reconocidos por la presentación: con sus ceros y sin vacíos.
    expect(old.largeVolumeNames).toEqual({});
    expect(normalizeFormula({ largeVolumeNames: { "3789": " DEXTROSA 5 % 1 L ", "08166": "", "05598": 7 } }).largeVolumeNames).toEqual({ "03789": "DEXTROSA 5 % 1 L" });
    expect(normalizeFormula({ largeVolumeNames: ["03789"] }).largeVolumeNames).toEqual({});
  });

  it("excluidos de la DME: la lista de fábrica si no hay una guardada; una vacía se respeta", () => {
    const old = normalizeFormula({ subMax: 2 });
    expect(old.dmeExcluded).toEqual(DEFAULT_DME_EXCLUDED);
    expect(DEFAULT_DME_EXCLUDED).toHaveLength(15);
    expect(dmeExcludedCodes(old).has("05873")).toBe(true);
    expect(describeFormula(old, "essential")).toMatch(/15 medicamentos excluidos/);
    expect(describeFormula(old, "all")).not.toMatch(/excluidos/);
    expect(normalizeFormula({ dmeExcluded: [] }).dmeExcluded).toEqual([]);
    // Con sus ceros, sin repetidos y con «Otro motivo» si el motivo no se reconoce.
    const saved = normalizeFormula({ dmeExcluded: [{ code: "5253", name: "OXITOCINA", reason: "strategic" }, { code: "05253", reason: "national" }, { code: "1467", reason: "x" }, "3576"] });
    expect(saved.dmeExcluded).toEqual([
      { code: "05253", name: "OXITOCINA", reason: "strategic" },
      { code: "01467", name: "", reason: "other" },
      { code: "03576", name: "", reason: "other" },
    ]);
  });
});
