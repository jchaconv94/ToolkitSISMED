/**
 * Carga del Stock SISMED de un establecimiento (la usan el módulo y la campana de avisos).
 * Se simulan la base, el catálogo de pestañas y la lectura de la hoja.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyStockAssignments, getAllUngetConfigs, listUngetSheets, readAssignedSheetRows } = vi.hoisted(() => ({
  getMyStockAssignments: vi.fn(),
  getAllUngetConfigs: vi.fn(),
  listUngetSheets: vi.fn(),
  readAssignedSheetRows: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null, api: { getMyStockAssignments, getAllUngetConfigs } }));
vi.mock("./ungetSheetCatalog", () => ({ listUngetSheets }));
vi.mock("./assignedSheetReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assignedSheetReader")>()),
  readAssignedSheetRows,
}));

import { getExpirationState, loadAssignedIpressStock } from "./assignedIpressStock";

const conexion = { id: "c1", ungetId: "U1", url: "https://script.google.com/x", spreadsheetId: "S1", username: "info" };

beforeEach(() => {
  vi.clearAllMocks();
  getMyStockAssignments.mockResolvedValue([]);
  getAllUngetConfigs.mockResolvedValue([conexion]);
  listUngetSheets.mockResolvedValue([{ id: "1", name: "C.S. NUEVO LIMA-06519", codigoIpress: "06519" }]);
});

describe("loadAssignedIpressStock", () => {
  it("sin código de establecimiento no lee nada", async () => {
    const r = await loadAssignedIpressStock("", "U1");
    expect(r.message).toMatch(/no está vinculado/);
    expect(getAllUngetConfigs).not.toHaveBeenCalled();
  });

  it("lee la pestaña de su código con la conexión de su UNGET y normaliza las filas", async () => {
    readAssignedSheetRows.mockResolvedValue([
      { ALMCOD: "06519", NOMBRE: "Amoxicilina", LOTE: "L1", FEC_VENCIM: "01/01/2027", SALDO: "10", ULTIMA_ACTUALIZACION: "02/10/2026 08:00:00" },
      { ALMCOD: "06519", NOMBRE: "Paracetamol", LOTE: "P1", FEC_VENCIM: "01/01/2027", SALDO: "5", ULTIMA_ACTUALIZACION: "01/10/2026 08:00:00" },
    ]);
    const r = await loadAssignedIpressStock("06519", "U1");
    expect(readAssignedSheetRows).toHaveBeenCalledWith(expect.objectContaining({ sheetName: "C.S. NUEVO LIMA-06519", ungetId: "U1" }), conexion);
    expect(r.message).toBe("");
    expect(r.sheetName).toBe("C.S. NUEVO LIMA-06519");
    expect(r.rows[0]).toMatchObject({ Nombre: "Amoxicilina", Lote: "L1", Saldo: "10", Fec_Vencim: "01/01/2027" });
    // Igual que el módulo: el texto mayor al ordenar; y además el instante más reciente.
    expect(r.lastUpdate).toBe("02/10/2026 08:00:00");
    expect(r.lastUpdateAt).toBe(new Date("2026-10-02T08:00:00").getTime());
  });

  it("si su pestaña no existe, explica y no abre la hoja guardada de otro", async () => {
    getMyStockAssignments.mockResolvedValue([{ sheetName: "OTRA-06500", ungetId: "U1" }]);
    listUngetSheets.mockResolvedValue([{ id: "2", name: "OTRA-06500", codigoIpress: "06500" }]);
    const r = await loadAssignedIpressStock("06519", "U1");
    expect(r.rows).toEqual([]);
    expect(r.message).not.toBe("");
    expect(readAssignedSheetRows).not.toHaveBeenCalled();
  });

  it("sin conexión ni asignación lo dice", async () => {
    getAllUngetConfigs.mockResolvedValue([]);
    const r = await loadAssignedIpressStock("06519", "U1");
    expect(r.message).toMatch(/no tiene una conexión/);
  });

  it("una hoja vacía es un error de lectura", async () => {
    readAssignedSheetRows.mockResolvedValue([]);
    await expect(loadAssignedIpressStock("06519", "U1")).rejects.toThrow(/no contiene registros/);
  });
});

describe("getExpirationState", () => {
  const hoy = new Date("2026-10-15T10:00:00");
  it("vencido, por vencer dentro de la ventana o normal; sin saldo nunca vence", () => {
    expect(getExpirationState({ Saldo: "3", Fec_Vencim: "01/09/2026" }, 90, hoy)).toBe("EXPIRED");
    expect(getExpirationState({ Saldo: "3", Fec_Vencim: "2026-10-15" }, 90, hoy)).toBe("EXPIRING");
    expect(getExpirationState({ Saldo: "3", Fec_Vencim: "2027-01-13" }, 90, hoy)).toBe("EXPIRING");
    expect(getExpirationState({ Saldo: "3", Fec_Vencim: "2027-01-14" }, 90, hoy)).toBe("NORMAL");
    expect(getExpirationState({ Saldo: "0", Fec_Vencim: "01/09/2026" }, 90, hoy)).toBe("NORMAL");
  });
  it("la ventana sale del parámetro", () => {
    expect(getExpirationState({ Saldo: "3", Fec_Vencim: "2026-11-20" }, 30, hoy)).toBe("NORMAL");
    expect(getExpirationState({ Saldo: "3", Fec_Vencim: "2026-11-20" }, 60, hoy)).toBe("EXPIRING");
  });
});
