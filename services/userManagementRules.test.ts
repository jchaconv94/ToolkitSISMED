import { describe, it, expect } from "vitest";
import { canAssignRole, levelWeight } from "./userManagementRules";

const informatico = { callerIsAdmin: false, callerLevel: "UNGET" };

describe("canAssignRole", () => {
  it("el ADMIN puede asignar cualquier rol", () => {
    expect(canAssignRole({ callerIsAdmin: true, targetRole: "ADMIN", targetLevel: "GLOBAL" })).toBe(true);
  });

  it("el informático de UNGET asigna roles de niveles inferiores", () => {
    expect(canAssignRole({ ...informatico, targetRole: "RESPONSABLE_FARMACIA", targetLevel: "IPRESS" })).toBe(true);
    expect(canAssignRole({ ...informatico, targetRole: "JEFE_MICRORED", targetLevel: "MICRORED" })).toBe(true);
  });

  it("puede crear coordinadores de su mismo nivel, pero no otro informático", () => {
    expect(canAssignRole({ ...informatico, targetRole: "COORDINADOR_UNGET", targetLevel: "UNGET" })).toBe(true);
    expect(canAssignRole({ ...informatico, targetRole: "INFORMATICO_UNGET", targetLevel: "UNGET" })).toBe(false);
  });

  it("nunca asigna niveles superiores ni ADMIN", () => {
    expect(canAssignRole({ ...informatico, targetRole: "COORDINADOR_DIRESA", targetLevel: "DIRESA" })).toBe(false);
    expect(canAssignRole({ ...informatico, targetRole: "ADMIN", targetLevel: "IPRESS" })).toBe(false);
    expect(canAssignRole({ ...informatico, targetRole: "SUPERVISOR", targetLevel: "GLOBAL" })).toBe(false);
  });

  it("sin nivel configurado no ofrece nada", () => {
    expect(canAssignRole({ ...informatico, targetRole: "NUEVO", targetLevel: "" })).toBe(false);
    expect(canAssignRole({ callerIsAdmin: false, callerLevel: "", targetRole: "X", targetLevel: "IPRESS" })).toBe(false);
  });

  it("el peso de nivel no distingue mayúsculas", () => {
    expect(levelWeight("unget")).toBe(40);
    expect(levelWeight(undefined)).toBe(-1);
  });
});
