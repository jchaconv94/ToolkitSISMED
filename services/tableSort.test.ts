import { describe, expect, it } from "vitest";
import { compareSortValues, nextSort, sortRows } from "./tableSort";

describe("orden de tablas", () => {
  const rows = [
    { name: "P.S. 10 Ñuñunga", n: 3, d: "2026-10-02" },
    { name: "p.s. 2 Ángel", n: 12, d: "" },
    { name: "C.S. Bellavista", n: null as number | null, d: "2026-09-30" },
  ];
  const getters = { name: (r: typeof rows[0]) => r.name, n: (r: typeof rows[0]) => r.n, d: (r: typeof rows[0]) => r.d };

  it("textos en español, sin mayúsculas ni tildes, con números naturales", () => {
    expect(sortRows(rows, { key: "name", dir: "asc" }, getters).map((r) => r.name)).toEqual(["C.S. Bellavista", "p.s. 2 Ángel", "P.S. 10 Ñuñunga"]);
    expect(compareSortValues("árbol", "Arbol")).toBe(0);
  });

  it("números como números y los vacíos siempre al final, en ambos sentidos", () => {
    expect(sortRows(rows, { key: "n", dir: "asc" }, getters).map((r) => r.n)).toEqual([3, 12, null]);
    expect(sortRows(rows, { key: "n", dir: "desc" }, getters).map((r) => r.n)).toEqual([12, 3, null]);
    expect(sortRows(rows, { key: "d", dir: "desc" }, getters).map((r) => r.d)).toEqual(["2026-10-02", "2026-09-30", ""]);
  });

  it("sin orden quedan como llegaron", () => {
    expect(sortRows(rows, null, getters)).toBe(rows);
  });

  it("tres toques: sentido natural, el contrario y sin orden", () => {
    const a = nextSort(null, "n", "desc");
    expect(a).toEqual({ key: "n", dir: "desc" });
    const b = nextSort(a, "n", "desc");
    expect(b).toEqual({ key: "n", dir: "asc" });
    expect(nextSort(b, "n", "desc")).toBeNull();
    expect(nextSort(b, "name")).toEqual({ key: "name", dir: "asc" });
  });
});
