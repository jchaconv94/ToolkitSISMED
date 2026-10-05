import { describe, expect, it } from "vitest";
import { buildPharmacySummary } from "./homeSummary";

const now = new Date("2026-10-05T12:00:00Z");

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
