import { describe, expect, it } from "vitest";
import { StockStatus } from "../types";
import {
  averageConsumption, buildItems, essentialRows, groupByIpress, ipressCodeOf, parseAvailabilitySheet, parseLotsSheet, summarize, wholeMonthsBetween,
} from "./availabilityReport";

const HEADER = ["RED", "MICRORED", "COD EESS", "ESTABLECIMIENTO", "CAT", "MED COD", "DESCRIPCION DEL PRODUCTO", "MEDFF", "PRECIO", "MEDTIP", "MEDPET", "MEDEST",
  202510, 202511, 202512, 202601, 202602, 202603, 202604, 202605, 202606, 202607, 202608, 202609, "STOCK_FIN"];
const row = (code: string, name: string, med: string, cons: number[], stock: number, tip = "M", pet = "P", est = "S") =>
  ["BELLAVISTA", "MR1", code, name, "I-2", med, `PRODUCTO ${med}`, "TABLET", 1, tip, pet, est, ...cons, stock];
const zeros = Array(12).fill(0);

describe("disponibilidad", () => {
  it("lee el archivo, rellena códigos y toma los 12 meses", () => {
    const parsed = parseAvailabilitySheet([["TÍTULO"], HEADER, row("06499", "P.S. A", "143", [...zeros.slice(1), 10], 5)]);
    expect(parsed.months[0]).toBe("202510");
    expect(parsed.months[11]).toBe("202609");
    expect(parsed.rows[0].medCode).toBe("00143");
    expect(parsed.rows[0].consumption[11]).toBe(10);
    expect(parsed.hasPharmacies).toBe(false);
  });

  it("CPA solo con los meses que tienen consumo", () => {
    expect(averageConsumption([10, 0, 20, 0])).toBe(15);
    expect(averageConsumption([0, 0])).toBe(0);
  });

  it("junta las farmacias en su IPRESS", () => {
    expect(ipressCodeOf("06502F03")).toBe("06502");
    const { rows } = parseAvailabilitySheet([HEADER,
      row("06502F01", "FARM. HOSP. ALMACEN", "00143", [...zeros.slice(1), 10], 5),
      row("06502F02", "FARM. HOSP. EMERGENCIA", "00143", [...zeros.slice(1), 4], 3)]);
    const grouped = groupByIpress(rows, (c) => (c === "06502" ? "HOSP. BELLAVISTA" : undefined));
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ code: "06502", name: "HOSP. BELLAVISTA", stock: 8 });
    expect(grouped[0].consumption[11]).toBe(14);
  });

  it("clasifica con meses cortados a un decimal y sin «Sin consumo»", () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      row("06499", "A", "00001", [...zeros.slice(2), 100, 100], 196), // 1,96 → Substock
      row("06499", "A", "00002", zeros, 0), // stock 0 sin consumo → Desabastecido
      row("06499", "A", "00003", zeros, 4), // Sin rotación
      row("06499", "A", "00004", [...zeros.slice(1), 10], 70)]); // 7 → Sobrestock
    const items = buildItems(rows);
    expect(items.map((i) => i.status)).toEqual([StockStatus.SUBSTOCK, StockStatus.DESABASTECIDO, StockStatus.SIN_ROTACION, StockStatus.SOBRESTOCK]);
  });

  it("disponibilidad: Normo + Sobre ÷ total; Sin rotación solo si es vital (esenciales)", () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      row("06499", "A", "00001", [...zeros.slice(1), 10], 30), // Normo
      row("06499", "A", "00002", zeros, 4), // Sin rotación
      row("06499", "A", "00003", [...zeros.slice(1), 10], 0), // Desab
      row("06499", "A", "00004", [...zeros.slice(1), 10], 30, "I", "_", "_")]); // insumo: solo en «todos»
    const all = summarize(buildItems(rows));
    expect(all.establishments[0]).toMatchObject({ total: 4, available: 2, pct: 50, level: "BAJO" });
    const essItems = buildItems(essentialRows(rows, {}));
    expect(summarize(essItems).establishments[0]).toMatchObject({ total: 3, available: 1 });
    expect(summarize(essItems, new Set(["00002"])).establishments[0].available).toBe(2);
  });

  it("microred y UNGET: promedio de sus establecimientos", () => {
    const { rows } = parseAvailabilitySheet([HEADER,
      row("00001", "A", "00001", [...zeros.slice(1), 10], 30),
      row("00002", "B", "00001", [...zeros.slice(1), 10], 30),
      row("00002", "B", "00002", [...zeros.slice(1), 10], 0)]);
    const rep = summarize(buildItems(rows));
    expect(rep.establishments.map((e) => e.pct)).toEqual([100, 50]);
    expect(rep.microredes[0].pct).toBe(75);
    expect(rep.pct).toBe(75);
    expect(rep.level).toBe("REGULAR");
  });

  it("lotes del TFORMDET: vencimiento más próximo y riesgo", () => {
    const lots = parseLotsSheet([
      ["CODIGO_PRE", "CODIGO_MED", "MEDLOTE", "FEC_EXP", "SALDO", "STOCK_FIN"],
      ["06502F01", "00143", "L2", "31/12/2027", 0, 50],
      ["06502F02", "00143", "L1", "30/04/2027", 0, 10],
      ["06502F02", "00143", "L0", "30/01/2027", 5, 0],
    ]);
    expect(lots.get("06502F02|00143")).toHaveLength(1);
    const { rows } = parseAvailabilitySheet([HEADER,
      row("06502F01", "FARM", "00143", [...zeros.slice(1), 10], 50),
      row("06502F02", "FARM", "00143", [...zeros.slice(1), 1], 10)]);
    const today = new Date(2026, 9, 6);
    const ipress = buildItems(groupByIpress(rows), lots, today)[0];
    expect(ipress.lots.map((l) => l.lot)).toEqual(["L1", "L2"]);
    expect(ipress.monthsToExpiry).toBe(6);
    // 60 de stock ÷ CPA 11 = 5,4 meses: no pasa los 6 meses al vencimiento.
    expect(ipress.expiryRisk).toBe(false);
    const pharmacy = buildItems(rows, lots, today)[1];
    expect(pharmacy.months).toBe(10);
    expect(pharmacy.expiryRisk).toBe(true);
  });

  it("meses enteros como DATEDIF", () => {
    expect(wholeMonthsBetween(new Date(2026, 9, 6), new Date(2027, 1, 28))).toBe(4);
    expect(wholeMonthsBetween(new Date(2026, 9, 6), new Date(2026, 10, 5))).toBe(0);
  });

  it("DME: fusiona las presentaciones en su código destino y deja fuera las estrategias", () => {
    const groups = { "00091": { name: "AAS 100 mg TABLETA", codes: ["00091", "00096"] } };
    const { rows } = parseAvailabilitySheet([HEADER,
      row("06499", "A", "00091", [...zeros.slice(1), 10], 0),
      row("06499", "A", "00096", [...zeros.slice(2), 5, 10], 40, "M", "_", "S"), // fuera del petitorio, pero en el listado
      row("06499", "A", "00500", [...zeros.slice(1), 10], 30, "M", "P", "E"), // estrategia
      row("06499", "A", "00600", [...zeros.slice(1), 10], 30, "M", "_", "S")]); // ni petitorio ni listado
    const fused = essentialRows(rows, groups);
    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({ medCode: "00091", stock: 40, description: "AAS 100 mg TABLETA", fusedFrom: ["00091", "00096"] });
    expect(fused[0].consumption.slice(-2)).toEqual([5, 20]);
    // Por separado, el 00091 era Desabastecido; fusionado tiene 40 de stock y CPA 12,5: 3,2 meses.
    expect(buildItems(fused)[0].status).toBe(StockStatus.NORMOSTOCK);
  });

  it("avisa si el archivo no es de disponibilidad", () => {
    expect(() => parseAvailabilitySheet([["A", "B"], [1, 2]])).toThrow(/encabezados/);
  });
});
