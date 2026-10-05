import { describe, expect, it } from "vitest";
import { buildNetworkSummary, buildPharmacySummary } from "./homeSummary";
import type { SendKeyRow } from "./sendKeys";

const now = new Date("2026-10-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const key = (code: string, lastOkAt: string | null): SendKeyRow => ({ code, name: code, hasKey: true, lastOkAt, blockedToday: 0 });

describe("resumen de la red", () => {
  it("separa al día (24 h), con retraso (hasta el umbral) y sin actualizar (o nunca)", () => {
    const keys = [key("a", hoursAgo(2)), key("b", hoursAgo(30)), key("c", hoursAgo(70)), key("d", hoursAgo(100)), key("e", null)];
    expect(buildNetworkSummary(keys, [], 3, now)).toEqual({ total: 5, upToDate: 1, late: 2, stale: 2 });
  });

  it("usa el último reporte de la PC cuando no hay envío con clave", () => {
    const devices = [{ code: "e", name: "e", devices: [{ deviceName: "PC", version: "2.2.4", lastSeen: hoursAgo(1) }] }];
    expect(buildNetworkSummary([key("e", null)], devices as any, 3, now).upToDate).toBe(1);
  });
});

describe("resumen de farmacia", () => {
  it("cuenta lotes vencidos, por vencer (según la ventana) y al día, solo con saldo", () => {
    const rows = [
      { Id_Producto: "1", Nombre: "A", Lote: "L1", Fec_Vencim: "01/09/2026", Saldo: "10" },
      { Id_Producto: "1", Nombre: "A", Lote: "L2", Fec_Vencim: "01/11/2026", Saldo: "5" },
      { Id_Producto: "2", Nombre: "B", Lote: "L3", Fec_Vencim: "01/09/2026", Saldo: "0" },
      { Id_Producto: "3", Nombre: "C", Lote: "L4", Fec_Vencim: "01/12/2027", Saldo: "8" },
    ];
    expect(buildPharmacySummary(rows as any, 123, 90, now)).toEqual({ expired: 1, expiring: 1, ok: 1, lastUpdateAt: 123 });
    // Con una ventana más corta (Parámetros), el lote del 1 de noviembre ya no está «por vencer».
    expect(buildPharmacySummary(rows as any, 123, 15, now)).toEqual({ expired: 1, expiring: 0, ok: 2, lastUpdateAt: 123 });
  });
});
