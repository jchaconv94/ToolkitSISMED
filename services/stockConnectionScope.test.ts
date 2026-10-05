import { describe, expect, it } from "vitest";
import { alignConfigsWithOfficialUngets, resolveStockLevel, selectVisibleStockConnections } from "./stockConnectionScope";

const ungets = [
  { id: "u1", name: "UNGET TARAPOTO", diresaId: "d1", ogessId: "o1" },
  { id: "u2", name: "UNGET BELLAVISTA", diresaId: "d1", ogessId: "o1" },
  { id: "u3", name: "UNGET MOYOBAMBA", diresaId: "d1", ogessId: "o2" },
];
const configs = [
  { name: "UNGET TARAPOTO", ungetId: "u1", username: "info1" },
  { name: "unget bellavista", username: "info2" },
  { name: "UNGET MOYOBAMBA", ungetId: "u3", username: "info3" },
];
const users = [
  { username: "info1", personnelData: { ungetId: "u1" } },
  { username: "info2", personnelData: { ungetId: "u2" } },
  { username: "info3", personnelData: { ungetId: "u3" } },
];
const aligned = alignConfigsWithOfficialUngets(configs, ungets);
const names = (list: any[]) => list.map((c) => c.name).sort();

describe("nivel de jurisdicción", () => {
  it("usa el configurado en el rol y, si falta, lo deduce del nombre", () => {
    expect(resolveStockLevel("ADMIN", "OGESS")).toBe("OGESS");
    expect(resolveStockLevel("ADMIN", null)).toBe("GLOBAL");
    expect(resolveStockLevel("INFORMATICO_DIRESA", "")).toBe("DIRESA");
    expect(resolveStockLevel("JEFE OGESS", undefined)).toBe("OGESS");
    expect(resolveStockLevel("INFORMATICO UNGET", undefined)).toBe("UNGET");
    expect(resolveStockLevel("FARMACIA", undefined)).toBe("IPRESS");
  });
});

describe("conexiones de stock visibles", () => {
  it("alinea nombre e id con la UNGET oficial", () => {
    expect(aligned[1]).toMatchObject({ name: "UNGET BELLAVISTA", ungetId: "u2" });
  });

  it("GLOBAL ve todas", () => {
    expect(selectVisibleStockConnections({ level: "GLOBAL", username: "x", allConfigs: aligned, ungets, users })).toHaveLength(3);
  });

  it("OGESS ve las UNGET de su OGESS; DIRESA, las de su DIRESA", () => {
    expect(names(selectVisibleStockConnections({ level: "OGESS", username: "x", userOgessId: "o1", allConfigs: aligned, ungets, users })))
      .toEqual(["UNGET BELLAVISTA", "UNGET TARAPOTO"]);
    expect(selectVisibleStockConnections({ level: "DIRESA", username: "x", userDiresaId: "d1", allConfigs: aligned, ungets, users })).toHaveLength(3);
  });

  it("UNGET ve la de su UNGET aunque la haya creado otra cuenta", () => {
    const visible = selectVisibleStockConnections({ level: "UNGET", username: "nuevo", userUngetId: "u2", myUnget: ungets[1], allConfigs: aligned, ungets, users });
    expect(names(visible)).toEqual(["UNGET BELLAVISTA"]);
  });

  it("si tiene conexión propia, ve solo la propia", () => {
    const visible = selectVisibleStockConnections({ level: "UNGET", username: "info3", userUngetId: "u2", allConfigs: aligned, ungets, users });
    expect(names(visible)).toEqual(["UNGET MOYOBAMBA"]);
  });

  it("sin datos de su jurisdicción no ve nada", () => {
    expect(selectVisibleStockConnections({ level: "OGESS", username: "x", allConfigs: aligned, ungets, users })).toEqual([]);
  });
});
