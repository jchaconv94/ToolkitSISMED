import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    getUngets: async () => [
      { id: "u1", name: "UNGET A", diresaId: "d1" },
      { id: "u2", name: "UNGET B", diresaId: "d1" },
    ],
    getAllUngetConfigs: async () => [
      { id: "c1", name: "UNGET A", ungetId: "u1", url: "https://script.fake/a", username: "a" },
      { id: "c2", name: "UNGET B", ungetId: "u2", url: "https://script.fake/b", username: "b" },
    ],
    getUsers: async () => [],
    getOgess: async () => [],
    getDiresas: async () => [{ id: "d1", name: "DIRESA SAN MARTIN" }],
  },
}));

const gasCalls: Array<{ url: string; options: any }> = [];
let releaseSlow: (value: unknown) => void = () => undefined;
vi.mock("./gasConnectionService", () => ({
  fetchGasWithResilience: (url: string, options: any) => {
    gasCalls.push({ url, options });
    if (url.includes("/b")) return new Promise((resolve) => { releaseSlow = resolve; });
    return Promise.resolve([{ id: "1", name: "C.S. UNO-00001", codigoIpress: "00001", lastUpdate: "05/10/2026 11:30:00" }]);
  },
}));

import { facilityLastUpdates, loadNetworkStockStatus, summarizeSheetUpdates } from "./networkStockStatus";

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
      // El código solo en el nombre de la pestaña: Consulta Stock la muestra, aquí también cuenta.
      { id: "4", name: "P.S. LA FLOR-06520", lastUpdate: "05/10/2026 09:00:00" },
      // Sin código pero con filas (lectura con conteo): Consulta Stock también la muestra.
      { id: "5", name: "FARMACIA CENTRAL", rowCount: 40, lastUpdate: "" },
      { id: "6", name: "Hoja 3", rowCount: 0, lastUpdate: "" },
    ];
    const updates = facilityLastUpdates(metadata as any);
    expect(updates).toHaveLength(4);
    expect(updates[0]).toBe(new Date(2026, 9, 5, 10, 0, 0).getTime());
    expect(updates[1]).toBe(0);
  });

  it("con una DIRESA entrega cifras parciales sin esperar a la hoja más lenta, y sin reintentos", async () => {
    const partials: any[] = [];
    const done = loadNetworkStockStatus(
      { username: "dir", role: "DIRESA", jurisdictionLevel: "DIRESA", personnelData: { diresaId: "d1" } } as any,
      now,
      (partial) => partials.push(partial),
    );
    await vi.waitFor(() => expect(partials).toHaveLength(1));
    expect(partials[0]).toMatchObject({ scope: "DIRESA SAN MARTIN", total: 1, upToDate: 1, pending: 1 });
    expect(gasCalls.every((call) => call.options.retryDelaysMs.length === 0 && call.options.timeoutMs <= 30_000)).toBe(true);

    releaseSlow([{ id: "2", name: "C.S. DOS-00002", codigoIpress: "00002", lastUpdate: "04/10/2026 08:00:00" }]);
    const status = await done;
    expect(status).toMatchObject({ total: 2, upToDate: 1, stale: 1 });
    expect(status?.pending).toBeUndefined();
  });
});
