import { describe, expect, it } from "vitest";
import { canCreateInOrgTab, orgTabsForLevel, showsTerritory } from "./orgTabs";
import { getUserJurisdictionScope } from "./jurisdictionService";
import type { User } from "../types";

const user = (role: string, jurisdictionLevel?: User["jurisdictionLevel"]) => ({ role, jurisdictionLevel }) as unknown as User;

describe("orgTabsForLevel", () => {
  it("cada nivel ve el suyo hacia abajo", () => {
    expect(orgTabsForLevel("GLOBAL")).toEqual(["DIRESA", "OGESS", "UNGET", "MICRORED", "IPRESS"]);
    expect(orgTabsForLevel("OGESS")).toEqual(["OGESS", "UNGET", "MICRORED", "IPRESS"]);
    expect(orgTabsForLevel("UNGET")).toEqual(["UNGET", "MICRORED", "IPRESS"]);
    expect(orgTabsForLevel("MICRORED")).toEqual(["MICRORED", "IPRESS"]);
    expect(orgTabsForLevel("IPRESS")).toEqual(["IPRESS"]);
  });

  it("un rol con otro nombre (COORDINADOR) toma las pestañas de su nivel, no se queda sin ninguna", () => {
    expect(orgTabsForLevel(getUserJurisdictionScope(user("COORDINADOR", "UNGET")).level)).toEqual(["UNGET", "MICRORED", "IPRESS"]);
    expect(orgTabsForLevel(getUserJurisdictionScope(user("COORDINADOR", "DIRESA")).level)).toHaveLength(5);
    // Sin nivel asignado ni nombre que lo diga: al menos ve los establecimientos.
    expect(orgTabsForLevel(getUserJurisdictionScope(user("COORDINADOR")).level)).toEqual(["IPRESS"]);
  });

  it("los roles de siempre siguen viendo lo mismo", () => {
    expect(orgTabsForLevel(getUserJurisdictionScope(user("ADMIN")).level)).toHaveLength(5);
    expect(orgTabsForLevel(getUserJurisdictionScope(user("DIRESA")).level)).toHaveLength(5);
    expect(orgTabsForLevel(getUserJurisdictionScope(user("OGESS")).level)).toEqual(["OGESS", "UNGET", "MICRORED", "IPRESS"]);
    expect(orgTabsForLevel(getUserJurisdictionScope(user("UNGET")).level)).toEqual(["UNGET", "MICRORED", "IPRESS"]);
  });
});

describe("canCreateInOrgTab", () => {
  it("el ADMIN crea en todas", () => {
    expect(canCreateInOrgTab("GLOBAL", "DIRESA", true)).toBe(true);
  });

  it("los demás solo por debajo de su nivel, como antes por nombre de rol", () => {
    expect(canCreateInOrgTab("GLOBAL", "DIRESA", false)).toBe(false);
    expect(canCreateInOrgTab("GLOBAL", "OGESS", false)).toBe(true);
    expect(canCreateInOrgTab("OGESS", "OGESS", false)).toBe(false);
    expect(canCreateInOrgTab("OGESS", "UNGET", false)).toBe(true);
    expect(canCreateInOrgTab("UNGET", "UNGET", false)).toBe(false);
    expect(canCreateInOrgTab("UNGET", "MICRORED", false)).toBe(true);
    expect(canCreateInOrgTab("UNGET", "IPRESS", false)).toBe(true);
  });

  it("microred y establecimiento no crean", () => {
    expect(canCreateInOrgTab("MICRORED", "IPRESS", false)).toBe(false);
    expect(canCreateInOrgTab("IPRESS", "IPRESS", false)).toBe(false);
  });
});

describe("showsTerritory", () => {
  it("el ADMIN ve todos los filtros", () => {
    expect(["DIRESA", "OGESS", "UNGET", "MICRORED"].every((f) => showsTerritory("GLOBAL", f as "DIRESA", true))).toBe(true);
  });

  it("los demás solo los de debajo de su nivel", () => {
    expect(showsTerritory("GLOBAL", "DIRESA", false)).toBe(false);
    expect(showsTerritory("GLOBAL", "OGESS", false)).toBe(true);
    expect(showsTerritory("OGESS", "OGESS", false)).toBe(false);
    expect(showsTerritory("OGESS", "UNGET", false)).toBe(true);
    // Un COORDINADOR de UNGET: sin OGESS ni UNGET, con microred.
    expect(showsTerritory("UNGET", "OGESS", false)).toBe(false);
    expect(showsTerritory("UNGET", "UNGET", false)).toBe(false);
    expect(showsTerritory("UNGET", "MICRORED", false)).toBe(true);
    expect(showsTerritory("MICRORED", "MICRORED", false)).toBe(false);
    expect(showsTerritory("IPRESS", "MICRORED", false)).toBe(false);
  });
});
