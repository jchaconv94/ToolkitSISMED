import { describe, expect, it } from "vitest";
import { facilityLastUpdates, summarizeSheetUpdates } from "./networkStockStatus";

const now = new Date(2026, 9, 5, 12, 0, 0).getTime();
const hoursAgo = (h: number) => now - h * 3600_000;

describe("stock actualizado de la red", () => {
  it("con los cortes de Consulta Stock: 1 h al día, 24 h con retraso, más (o sin fecha) sin actualizar", () => {
    expect(summarizeSheetUpdates([hoursAgo(0.5), hoursAgo(2), hoursAgo(23), hoursAgo(30), 0], now))
      .toEqual({ total: 5, upToDate: 1, late: 2, stale: 2 });
  });

  it("cuenta solo las pestañas de establecimientos y lee su última actualización", () => {
    const metadata = [
      { id: "1", name: "C.S. MORALES-00002", codigoIpress: "00002", lastUpdate: "05/10/2026 10:00:00" },
      { id: "2", name: "P.S. CUZCO-06514", almcod: "06514", lastUpdate: "" },
      { id: "3", name: "Resumen", lastUpdate: "05/10/2026 10:00:00" },
    ];
    const updates = facilityLastUpdates(metadata as any);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toBe(new Date(2026, 9, 5, 10, 0, 0).getTime());
    expect(updates[1]).toBe(0);
  });
});
