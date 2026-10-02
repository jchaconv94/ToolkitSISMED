import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import {
  filterEstablishments, lastSendAt, mergeEstablishments, pendingAlerts, summarizeEstablishments,
} from "./sendKeyEstablishments";
import { SendKeyRow } from "./sendKeys";
import { ToolkitDeviceRow } from "./toolkitDevices";

const ahora = new Date("2026-10-02T12:00:00Z");
const hace = (dias: number) => new Date(ahora.getTime() - dias * 86400000).toISOString();
const clave = (parcial: Partial<SendKeyRow>): SendKeyRow => ({ code: "06519", name: "C.S. Nuevo Lima", hasKey: false, blockedToday: 0, ...parcial });

const claves: SendKeyRow[] = [
  clave({ code: "030S05", name: "Almacén Bellavista", hasKey: true, deviceName: "PC-ALMACEN",
    alert: { id: 9, at: "2026-10-02T10:00:00Z", deviceName: "PC-NUEVA", result: "OTRO_EQUIPO" } }),
  clave({ code: "06519", name: "C.S. Bellavista", hasKey: true, deviceName: "FARMACIA-01", lastOkAt: hace(0) }),
  clave({ code: "06525", name: "P.S. Cuzco", hasKey: true, deviceName: "ACER-JORDAN",
    alert: { id: 7, at: "2026-10-02T08:00:00Z", deviceName: "DESKTOP-8KQ2", result: "OTRO_EQUIPO" } }),
  clave({ code: "06531", name: "P.S. Huingoyacu", hasKey: true }),
  clave({ code: "06533", name: "P.S. Nuevo Lima" }),
];

const equipos: ToolkitDeviceRow[] = [
  { code: "030S05", name: "Almacén Bellavista", devices: [{ deviceName: "PC-ALMACEN", version: "2.2.3", sismedVersion: "2.6.1", lastSeen: hace(0) }] },
  { code: "06519", name: "C.S. Bellavista", devices: [{ deviceName: "FARMACIA-01", version: "2.2.2", sismedVersion: "2.6.1", lastSeen: hace(0) }] },
  { code: "06525", name: "P.S. Cuzco", devices: [{ deviceName: "ACER-JORDAN", version: "2.2.3", sismedVersion: "2.5.8", lastSeen: hace(1) }] },
  { code: "06533", name: "P.S. Nuevo Lima", devices: [{ deviceName: "NLIMA-PC", version: "2.1.10", sismedVersion: "2.6.1", lastSeen: hace(3) }] },
  { code: "99999", name: "Fuera de la lista", devices: [{ deviceName: "X", version: "2.2.3", lastSeen: hace(0) }] },
];

const filas = mergeEstablishments(claves, equipos);

describe("mergeEstablishments", () => {
  it("manda la lista de claves y le suma las PC por código", () => {
    expect(filas.map((f) => f.code)).toEqual(["030S05", "06519", "06525", "06531", "06533"]);
    expect(filas[0].devices[0].deviceName).toBe("PC-ALMACEN");
    expect(filas.find((f) => f.code === "06531")?.devices).toEqual([]);
  });
});

describe("summarizeEstablishments", () => {
  it("cuenta protegidos, sin clave, Toolkit y SISMED desactualizados", () => {
    const s = summarizeEstablishments(filas, "2.2.3", ahora);
    expect(s.total).toBe(5);
    expect(s.protectedCount).toBe(4);
    expect(s.none).toBe(1);
    expect(s.waiting).toBe(1);
    expect(s.toolkitOutdated).toBe(2); // 06519 (2.2.2) y 06533 (2.1.10)
    expect(s.reporting).toBe(4);
    expect(s.sismedOutdated).toBe(1); // 06525: 2.5.8 frente a 2.6.1
    expect(s.counts.alerts).toBe(2);
  });
});

describe("filterEstablishments", () => {
  it("bloqueados primero, luego esperando, protegidos y sin clave", () => {
    expect(filterEstablishments(filas, "2.2.3", "", "all", "all", ahora).map((f) => f.code))
      .toEqual(["030S05", "06525", "06531", "06519", "06533"]);
  });
  it("filtra por estado, por SISMED y busca también por el nombre de cualquier PC", () => {
    expect(filterEstablishments(filas, "2.2.3", "", "toolkitOutdated", "all", ahora).map((f) => f.code)).toEqual(["06519", "06533"]);
    expect(filterEstablishments(filas, "2.2.3", "", "all", "outdated", ahora).map((f) => f.code)).toEqual(["06525"]);
    expect(filterEstablishments(filas, "2.2.3", "", "all", "v:2.6.1", ahora).map((f) => f.code)).toEqual(["030S05", "06519", "06533"]);
    expect(filterEstablishments(filas, "2.2.3", "nlima-pc", "all", "all", ahora).map((f) => f.code)).toEqual(["06533"]);
    expect(filterEstablishments(filas, "2.2.3", "cuzco", "alerts", "all", ahora).map((f) => f.code)).toEqual(["06525"]);
  });
});

describe("filterEstablishments · casos heredados de Claves y Equipos", () => {
  it("ordena los números como números y busca sin tildes", () => {
    const n = (name: string) => ({ ...clave({ name, code: name }), devices: [] });
    expect(filterEstablishments([n("P.S. 10"), n("P.S. 2"), n("P.S. 1")], null, "", "all", "all", ahora).map((r) => r.name)).toEqual(["P.S. 1", "P.S. 2", "P.S. 10"]);
    expect(filterEstablishments(filas, "2.2.3", "almacen", "all", "all", ahora).map((f) => f.code)).toEqual(["030S05"]);
  });
  it("una PC que no reporta hace más de 30 días cuenta como SISMED sin dato y Toolkit sin reportar", () => {
    const dormida = mergeEstablishments([clave({ code: "06508", name: "P.S. San Pablo", hasKey: true, deviceName: "PC-SP" })],
      [{ code: "06508", name: "P.S. San Pablo", devices: [{ deviceName: "PC-SP", version: "2.2.3", sismedVersion: "2.7.0", lastSeen: hace(45) }] }]);
    expect(filterEstablishments(dormida, "2.2.3", "", "all", "none", ahora)).toHaveLength(1);
    expect(filterEstablishments(dormida, "2.2.3", "", "toolkitNone", "all", ahora)).toHaveLength(1);
  });
});

describe("lastSendAt y pendingAlerts", () => {
  it("sin clave, el último envío es el último reporte de su PC", () => {
    expect(lastSendAt(filas[1], ahora)).toBe(hace(0));
    expect(lastSendAt(filas[4], ahora)).toBe(hace(3));
    expect(lastSendAt(filas[3], ahora)).toBeNull();
  });
  it("la campana lista los bloqueos del más reciente al más antiguo", () => {
    expect(pendingAlerts(claves).map((r) => r.code)).toEqual(["030S05", "06525"]);
  });
});
