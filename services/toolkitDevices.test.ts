import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import {
  compareVersions, deviceState, latestDesktopVersion, latestSismedVersion, sismedState, sismedVersionsInUse, ToolkitDeviceRow,
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

describe("versión del SISMED", () => {
  const nueva = fila("06519", "C.S. NUEVO LIMA", [{ deviceName: "PC-NL", version: "2.2.1", sismedVersion: "2.5.3", lastSeen: hace(0) }]);
  const atrasada = fila("06515", "C.S. SAN RAFAEL", [{ deviceName: "FARMACIA-SR", version: "2.2.1", sismedVersion: "2.5.1", lastSeen: hace(1) }]);
  const sinDato = fila("06503", "P.S. BUENOS AIRES", [{ deviceName: "PC-BA", version: "2.2.0", lastSeen: hace(1) }]);
  // Una PC dormida no fija la vigente, aunque tuviera una versión mayor.
  const dormidaNueva = fila("06508", "P.S. SAN PABLO", [{ deviceName: "PC-SP", sismedVersion: "2.6.0", lastSeen: hace(45) }]);
  const todos = [nueva, atrasada, sinDato, dormidaNueva];

  it("la vigente es la más alta que reporta alguna PC activa", () => {
    expect(latestSismedVersion(todos, ahora)).toBe("2.5.3");
    expect(latestSismedVersion([sinDato], ahora)).toBeNull();
  });
  it("al día, desactualizado y sin dato", () => {
    expect(sismedState(nueva, "2.5.3", ahora)).toBe("current");
    expect(sismedState(atrasada, "2.5.3", ahora)).toBe("outdated");
    expect(sismedState(sinDato, "2.5.3", ahora)).toBe("none");
    expect(sismedState(dormidaNueva, "2.5.3", ahora)).toBe("none");
  });
  it("versiones en uso para el filtro, la más nueva primero", () => {
    expect(sismedVersionsInUse(todos, ahora)).toEqual(["2.5.3", "2.5.1"]);
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
