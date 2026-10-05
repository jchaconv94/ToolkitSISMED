import { describe, expect, it } from "vitest";
import { establishmentCodeVariants, normalizeExclusionCode } from "./requirementExclusionService";

describe("códigos de la Lista de Exclusiones", () => {
  it("compara sin ceros a la izquierda", () => {
    expect(normalizeExclusionCode("00143")).toBe(normalizeExclusionCode("143"));
    expect(normalizeExclusionCode(143)).toBe("143");
    expect(normalizeExclusionCode(" 0a12 ")).toBe("A12");
    expect(normalizeExclusionCode("0")).toBe("0");
  });

  it("busca el establecimiento con y sin ceros", () => {
    expect(establishmentCodeVariants("6528").sort()).toEqual(["06528", "6528"]);
    expect(establishmentCodeVariants("06528").sort()).toEqual(["06528", "6528"]);
    expect(establishmentCodeVariants("")).toEqual([]);
  });
});
