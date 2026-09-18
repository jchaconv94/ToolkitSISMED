import { describe, it, expect } from "vitest";
import {
  MAINTENANCE_DEFAULT_MESSAGE,
  isMaintenanceActive,
  isUserAllowedDuringMaintenance,
  maintenanceMessage,
  parseAllowedUsers,
  shouldBlockForMaintenance,
} from "./maintenanceMode";

const encendido = { maintenanceMode: true };
const apagado = { maintenanceMode: false };

describe("isMaintenanceActive", () => {
  it("solo está activo si se encendió explícitamente", () => {
    expect(isMaintenanceActive(encendido)).toBe(true);
    expect(isMaintenanceActive(apagado)).toBe(false);
    expect(isMaintenanceActive({})).toBe(false);
    expect(isMaintenanceActive(null)).toBe(false);
  });
});

describe("parseAllowedUsers", () => {
  it("admite comas, punto y coma y saltos de línea", () => {
    expect(parseAllowedUsers("bellavista, picota")).toEqual(["bellavista", "picota"]);
    expect(parseAllowedUsers("bellavista\npicota;mirian")).toEqual(["bellavista", "picota", "mirian"]);
  });

  it("ignora espacios y mayúsculas, y no deja huecos", () => {
    expect(parseAllowedUsers("  MARISCAL , , picota  ")).toEqual(["mariscal", "picota"]);
    expect(parseAllowedUsers("")).toEqual([]);
    expect(parseAllowedUsers(null)).toEqual([]);
  });
});

describe("isUserAllowedDuringMaintenance", () => {
  it("los administradores entran siempre", () => {
    for (const role of ["ADMIN", "Administrador", "GLOBAL", "SUPERADMIN", "ADMIN_GENERAL"]) {
      expect(isUserAllowedDuringMaintenance({ username: "x", role }, encendido)).toBe(true);
    }
  });

  it("un usuario autorizado para pruebas entra aunque no sea administrador", () => {
    const config = { maintenanceMode: true, maintenanceAllowedUsers: "bellavista, mirian" };
    expect(isUserAllowedDuringMaintenance({ username: "bellavista", role: "UNGET" }, config)).toBe(true);
    expect(isUserAllowedDuringMaintenance({ username: "BELLAVISTA", role: "UNGET" }, config)).toBe(true);
    expect(isUserAllowedDuringMaintenance({ username: "picota", role: "UNGET" }, config)).toBe(false);
  });

  it("sin usuario no entra nadie", () => {
    expect(isUserAllowedDuringMaintenance(null, encendido)).toBe(false);
    expect(isUserAllowedDuringMaintenance({ username: "", role: "UNGET" }, encendido)).toBe(false);
  });
});

describe("shouldBlockForMaintenance", () => {
  it("con el mantenimiento apagado no se bloquea a nadie", () => {
    expect(shouldBlockForMaintenance({ username: "picota", role: "UNGET" }, apagado)).toBe(false);
    expect(shouldBlockForMaintenance(null, apagado)).toBe(false);
  });

  it("encendido, bloquea a quien no esté autorizado, incluido el visitante sin sesión", () => {
    expect(shouldBlockForMaintenance({ username: "picota", role: "UNGET" }, encendido)).toBe(true);
    expect(shouldBlockForMaintenance(null, encendido)).toBe(true);
    expect(shouldBlockForMaintenance({ username: "jordan", role: "ADMIN" }, encendido)).toBe(false);
  });
});

describe("maintenanceMessage", () => {
  it("usa el mensaje configurado y, si no hay, uno por defecto", () => {
    expect(maintenanceMessage({ maintenanceMessage: "Volvemos a las 6." })).toBe("Volvemos a las 6.");
    expect(maintenanceMessage({ maintenanceMessage: "   " })).toBe(MAINTENANCE_DEFAULT_MESSAGE);
    expect(maintenanceMessage(null)).toBe(MAINTENANCE_DEFAULT_MESSAGE);
  });
});
