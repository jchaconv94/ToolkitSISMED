import { describe, expect, it } from "vitest";
import { findRepeatedSheets, sheetEstablishmentKey } from "./stockSheetDuplicates";

describe("sheetEstablishmentKey", () => {
  it("usa el código con el que el script elige la pestaña", () => {
    expect(sheetEstablishmentKey("030S0801")).toBe("030S08");
    expect(sheetEstablishmentKey("06574F0201")).toBe("06574");
    expect(sheetEstablishmentKey("06574")).toBe("06574");
  });

  it("sin ALMCOD, toma el código del nombre de la pestaña", () => {
    expect(sheetEstablishmentKey("", undefined, "030S08")).toBe("030S08");
    expect(sheetEstablishmentKey("-", "06519")).toBe("06519");
  });

  it("una hoja sin código no tiene clave", () => {
    expect(sheetEstablishmentKey("", null, undefined)).toBe("");
  });
});

describe("findRepeatedSheets", () => {
  it("de dos hojas del mismo almacén deja la actualizada más recientemente", () => {
    const repetidas = findRepeatedSheets([
      { id: "0_11", key: "030S08", lastUpdateTime: 100 },
      { id: "0_12", key: "06574", lastUpdateTime: 50 },
      { id: "3_40", key: "030S08", lastUpdateTime: 300 },
    ]);
    expect([...repetidas]).toEqual([["0_11", "3_40"]]);
  });

  it("sin fecha de actualización decide la del equipo; empatadas, la primera", () => {
    expect([
      ...findRepeatedSheets([
        { id: "a", key: "06519", equipmentDateTime: 10 },
        { id: "b", key: "06519", equipmentDateTime: 20 },
      ]),
    ]).toEqual([["a", "b"]]);
    expect([
      ...findRepeatedSheets([
        { id: "a", key: "06519", lastUpdateTime: 5 },
        { id: "b", key: "06519", lastUpdateTime: 5 },
      ]),
    ]).toEqual([["b", "a"]]);
  });

  it("establecimientos distintos y hojas sin código no se tocan", () => {
    expect(
      findRepeatedSheets([
        { id: "a", key: "06519", lastUpdateTime: 1 },
        { id: "b", key: "06520", lastUpdateTime: 2 },
        { id: "c", key: "" },
        { id: "d", key: "" },
      ]).size,
    ).toBe(0);
  });
});
