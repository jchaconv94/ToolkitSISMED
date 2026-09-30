import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import {
  compareVersions, deviceState, filterDevices, latestDesktopVersion, summarizeDevices, ToolkitDeviceRow,
} from "./toolkitDevices";

const ahora = new Date("2026-09-30T12:00:00Z");
const hace = (dias: number) => new Date(ahora.getTime() - dias * 86400000).toISOString();
const fila = (code: string, name: string, devices: ToolkitDeviceRow["devices"] = []): ToolkitDeviceRow => ({ code, name, devices });

const alDia = fila("030S05", "ALMACÉN BELLAVISTA", [{ deviceName: "PC-ALMACEN", version: "2.2.0", lastSeen: hace(0) }]);
const vieja = fila("06515", "C.S. SAN RAFAEL", [{ deviceName: "FARMACIA-SR", version: "2.1.10", lastSeen: hace(2) }]);
const nunca = fila("06503", "P.S. BUENOS AIRES");
const dormida = fila("06508", "P.S. SAN PABLO", [{ deviceName: "PC-SP", version: "2.2.0", lastSeen: hace(45) }]);

describe("compareVersions", () => {
  it("compara como números, no como texto", () => {
    expect(compareVersions("2.2.0", "2.1.10")).toBe(1);
    expect(compareVersions("2.1.10", "2.1.9")).toBe(1);
    expect(compareVersions("2.10.10", "3.0.0")).toBe(-1);
    expect(compareVersions("2.2", "2.2.0")).toBe(0);
  });
});

describe("deviceState", () => {
  it("al día, desactualizado y sin reportar", () => {
    expect(deviceState(alDia, "2.2.0", ahora)).toBe("current");
    expect(deviceState(vieja, "2.2.0", ahora)).toBe("outdated");
    expect(deviceState(nunca, "2.2.0", ahora)).toBe("none");
  });
  it("una PC que no reporta hace más de 30 días cuenta como sin reportar", () => {
    expect(deviceState(dormida, "2.2.0", ahora)).toBe("none");
  });
  it("manda la PC que envió más recientemente", () => {
    const dos = fila("06519", "C.S. NUEVO LIMA", [
      { deviceName: "PC-NUEVA", version: "2.2.0", lastSeen: hace(0) },
      { deviceName: "PC-VIEJA", version: "2.1.10", lastSeen: hace(5) },
    ]);
    expect(deviceState(dos, "2.2.0", ahora)).toBe("current");
  });
  it("sin versión publicada conocida no marca a nadie como desactualizado", () => {
    expect(deviceState(vieja, null, ahora)).toBe("current");
  });
});

describe("summarizeDevices y filterDevices", () => {
  const todos = [alDia, nunca, vieja, dormida];
  it("cuenta cada estado", () => {
    expect(summarizeDevices(todos, "2.2.0", ahora)).toEqual({ reporting: 2, current: 1, outdated: 1, none: 2 });
  });
  it("ordena desactualizados primero y filtra", () => {
    expect(filterDevices(todos, "2.2.0", "", "all", ahora).map((r) => r.code)).toEqual(["06515", "06503", "06508", "030S05"]);
    expect(filterDevices(todos, "2.2.0", "", "outdated", ahora).map((r) => r.code)).toEqual(["06515"]);
    expect(filterDevices(todos, "2.2.0", "almacen", "all", ahora).map((r) => r.code)).toEqual(["030S05"]);
    expect(filterDevices(todos, "2.2.0", "farmacia-sr", "all", ahora).map((r) => r.code)).toEqual(["06515"]);
  });
});

describe("latestDesktopVersion", () => {
  it("toma la mayor versión de escritorio publicada", () => {
    expect(latestDesktopVersion([
      { tag_name: "desktop-v2.1.9" },
      { tag_name: "desktop-v2.2.0" },
      { tag_name: "desktop-v2.1.10" },
      { tag_name: "desktop-v2.3.0", draft: true },
      { tag_name: "web-v9" },
    ])).toBe("2.2.0");
    expect(latestDesktopVersion({ message: "rate limit" })).toBeNull();
  });
});
