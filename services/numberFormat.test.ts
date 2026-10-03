import { describe, expect, it } from "vitest";
import { formatNumber } from "./numberFormat";

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
