import { describe, expect, it } from "vitest";
import { AVAILABLE_MODULES } from "../types";
import {
  MODULE_ACTIONS, allowedActionCount, isActionAllowed, parseDeniedActions, setActionAllowed, setAllActionsAllowed,
} from "./moduleActions";

describe("acciones por rol", () => {
  it("un rol sin acciones negadas puede hacerlo todo", () => {
    expect(isActionAllowed([], "ADMIN_USERS", "delete")).toBe(true);
    expect(isActionAllowed(undefined, "ADMIN_USERS", "delete")).toBe(true);
  });

  it("apaga y enciende una acción", () => {
    const denied = setActionAllowed([], "ADMIN_USERS", "delete", false);
    expect(denied).toEqual(["ADMIN_USERS:delete"]);
    expect(isActionAllowed(denied, "ADMIN_USERS", "delete")).toBe(false);
    expect(isActionAllowed(denied, "ADMIN_USERS", "edit")).toBe(true);
    expect(setActionAllowed(denied, "ADMIN_USERS", "delete", true)).toEqual([]);
    // Apagar dos veces no la duplica.
    expect(setActionAllowed(denied, "ADMIN_USERS", "delete", false)).toEqual(["ADMIN_USERS:delete"]);
  });

  it("marca o quita todas las de un módulo sin tocar las de otros", () => {
    const denied = setAllActionsAllowed(["ADMIN_FACILITIES:delete"], "ADMIN_USERS", false);
    expect(allowedActionCount(denied, "ADMIN_USERS")).toEqual({ allowed: 0, total: MODULE_ACTIONS.ADMIN_USERS!.length });
    expect(denied).toContain("ADMIN_FACILITIES:delete");
    expect(setAllActionsAllowed(denied, "ADMIN_USERS", true)).toEqual(["ADMIN_FACILITIES:delete"]);
  });

  it("lee lo que llega de la base", () => {
    expect(parseDeniedActions(["A:b", 3, null])).toEqual(["A:b"]);
    expect(parseDeniedActions(null)).toEqual([]);
  });

  it("solo hay acciones de módulos que existen, con identificadores únicos", () => {
    const modules = new Set(AVAILABLE_MODULES.map(m => m.id));
    for (const [module, actions] of Object.entries(MODULE_ACTIONS)) {
      expect(modules.has(module as any)).toBe(true);
      const ids = actions!.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
