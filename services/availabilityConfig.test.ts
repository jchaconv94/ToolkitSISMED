import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY_FORMULA, DEFAULT_DME_EXCLUDED, DEFAULT_LARGE_VOLUME, classifyOptionsOf, describeFormula, dmeExcludedCodes, diffFusedGroups, normalizeFormula, normalizeFusedCatalog, parseFusedCodesSheet } from "./availabilityConfig";
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
    expect(describeFormula(old, "essential")).toMatch(/soluciones de gran volumen: Normostock desde 1 mes/);
    expect(describeFormula(old, "all")).not.toMatch(/gran volumen/);
    // La lista de fábrica, si la fórmula guardada no trae la suya.
    expect(old.largeVolumeList).toEqual(DEFAULT_LARGE_VOLUME);
    expect(classifyOptionsOf(old, "essential").largeVolumeCodes).toEqual(DEFAULT_LARGE_VOLUME.map((e) => e.code));
    expect(describeFormula(old, "essential")).toMatch(new RegExp(`${DEFAULT_LARGE_VOLUME.length} soluciones de gran volumen`));
    // Ninguna de fábrica repite un excluido de la DME.
    expect(DEFAULT_LARGE_VOLUME.filter((e) => DEFAULT_DME_EXCLUDED.some((x) => x.code === e.code))).toEqual([]);
    // La guardada manda (con sus ceros y sin repetidos); una vacía se respeta.
    const saved = normalizeFormula({ largeVolumeList: ["8166", { code: "08166", name: "X" }, { code: "3789", name: " DEXTROSA 5 % 1 L " }] });
    expect(saved.largeVolumeList).toEqual([{ code: "08166", name: "" }, { code: "03789", name: "DEXTROSA 5 % 1 L" }]);
    expect(normalizeFormula({ largeVolumeList: [] }).largeVolumeList).toEqual([]);
    // Lo que se agregó o quitó a mano con la regla anterior (2026-10-09) no se pierde.
    const legacy = normalizeFormula({ largeVolumeAdd: [{ code: "99999", name: "SOLUCION X" }], largeVolumeSkip: ["08013"] });
    expect(legacy.largeVolumeList.map((e) => e.code)).not.toContain("08013");
    expect(legacy.largeVolumeList.at(-1)).toEqual({ code: "99999", name: "SOLUCION X" });
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
