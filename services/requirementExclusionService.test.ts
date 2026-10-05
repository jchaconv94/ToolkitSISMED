import { describe, expect, it } from "vitest";
import { establishmentCodeVariants, normalizeExclusionCode } from "./requirementExclusionService";

describe("códigos de la Lista de Exclusiones", () => {
  it("completa con ceros a la izquierda los códigos que llegan incompletos", () => {
    expect(normalizeExclusionCode("200")).toBe("00200");
    expect(normalizeExclusionCode(143)).toBe("00143");
    expect(normalizeExclusionCode("00200")).toBe("00200");
    expect(normalizeExclusionCode(" a12 ")).toBe("A12");
  });

  it("busca el establecimiento tal como llegó y completado", () => {
    expect(establishmentCodeVariants("6528").sort()).toEqual(["06528", "6528"]);
    expect(establishmentCodeVariants("06528")).toEqual(["06528"]);
    expect(establishmentCodeVariants("")).toEqual([]);
  });
});
