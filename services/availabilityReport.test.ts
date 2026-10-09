import { describe, expect, it } from "vitest";
import { StockStatus } from "../types";
import {
  DEFAULT_SUMMARY, averageConsumption, buildItems, classifyAvailability, cutDateOf, essentialRows, groupByIpress, isEstablishmentCode, parseTformdetHistory, ipressCodeOf, parseAvailabilitySheet, parseLotsSheet, summarize, tformdetLastMonth, wholeMonthsBetween,
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
    const vital = { ...DEFAULT_SUMMARY, rule: { ...DEFAULT_SUMMARY.rule, sinRotacion: "vital" as const }, vitalCodes: new Set(["00002"]) };
    expect(summarize(essItems, vital).establishments[0].available).toBe(2);
    // Sin rotación encendido para todos: también cuenta en «todos los productos».
    expect(summarize(buildItems(rows), { ...DEFAULT_SUMMARY, rule: { ...DEFAULT_SUMMARY.rule, sinRotacion: "yes" } }).establishments[0].available).toBe(3);
  });

  it("corte a un decimal y límites configurables", () => {
    // 6,03 meses: sin cortar es Sobrestock; cortado a 6,0 es Normostock.
    expect(classifyAvailability(603, 100).status).toBe(StockStatus.SOBRESTOCK);
    expect(classifyAvailability(603, 100, { truncate: true, subMax: 2, sobreMin: 6 }).status).toBe(StockStatus.NORMOSTOCK);
    expect(classifyAvailability(250, 100, { truncate: false, subMax: 3, sobreMin: 6 }).status).toBe(StockStatus.SUBSTOCK);
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
    // Suma de ítems: 2 disponibles de 3.
    expect(summarize(buildItems(rows), { ...DEFAULT_SUMMARY, aggregate: "sum" }).pct).toBeCloseTo(66.67, 1);
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

  it("arma la disponibilidad desde el TFORMDET de varios meses", () => {
    const H = ["ANNOMES", "CODIGO_PRE", "EESS", "CODIGO_MED", "DESCRIPCION MED", "MEDLOTE", "FEC_EXP", "PRECIO", "VENTA", "SIS", "INTERSAN", "EXO", "SOAT", "CREDHOSP", "OTR_CONV", "REINGRE", "STOCK_FIN", "MEDFF", "MEDTIP", "MEDPET", "MEDEST"];
    const r = (m: string, pre: string, med: string, lot: string, venta: number, sis: number, exo: number, stock: number) =>
      [m, pre, "FARM", med, "PRODUCTO", lot, "31/12/2027", 1.5, venta, sis, 0, exo, 0, 0, 0, 99, stock, "TABLET", "M", "P", "S"];
    const parsed = parseTformdetHistory([H,
      r("202608", "06502F01", "143", "L1", 5, 5, 7, 30),
      r("202609", "06502F01", "143", "L1", 0, 4, 0, 20),
      r("202609", "06502F02", "143", "L2", 2, 0, 0, 10),
      r("202609", "030S05", "143", "L9", 1, 1, 0, 50), // almacén: fuera
      r("202608", "06503", "00200", "L3", 0, 0, 0, 0), // sin stock ni consumo en el periodo: fuera
      r("202608", "06504", "00300", "L4", 3, 0, 0, 0), // consumo sin stock al corte: Desabastecido
    ]);
    expect(parsed.months).toEqual(["202608", "202609"]);
    expect(parsed.skippedCodes).toEqual(["030S05"]);
    // El almacén no entra en el cálculo, pero se guarda su stock del mes de corte.
    expect(parsed.rows.some((x) => x.code === "030S05")).toBe(false);
    expect(parsed.warehouse).toHaveLength(1);
    expect(parsed.warehouse[0]).toMatchObject({ code: "030S05", medCode: "00143", stock: 50 });
    expect(parsed.warehouse[0].lots.map((l) => l.lot)).toEqual(["L9"]);
    expect(parsed.hasClassification).toBe(true);
    const f1 = parsed.rows.find((x) => x.code === "06502F01")!;
    // EXO es consumo (entregado exonerado de pago); REINGRE no. Stock del último mes.
    expect(f1.consumption).toEqual([17, 4]);
    expect(f1.stock).toBe(20);
    expect(parsed.rows.find((x) => x.code === "06503")).toBeUndefined();
    expect(parsed.rows.find((x) => x.code === "06504")!.stock).toBe(0);
    const ipress = groupByIpress(parsed.rows).find((x) => x.code === "06502")!;
    expect(ipress.consumption).toEqual([17, 6]);
    expect(ipress.stock).toBe(30);
    expect(parsed.lots.get("06502F02|00143")!.map((l) => l.lot)).toEqual(["L2"]);
    // Sin la columna OTRAS_SAL no hay otras salidas.
    expect(f1.otherOut).toBeUndefined();
    expect(isEstablishmentCode("06502F01")).toBe(true);
    expect(isEstablishmentCode("030S05")).toBe(false);
  });

  it("guarda las otras salidas (OTRAS_SAL) aparte del consumo y las suma por IPRESS", () => {
    const H = ["ANNOMES", "CODIGO_PRE", "EESS", "CODIGO_MED", "DESCRIPCION MED", "VENTA", "EXO", "OTRAS_SAL", "STOCK_FIN"];
    const parsed = parseTformdetHistory([H,
      ["202608", "06520F01", "FARM", "143", "P", 5, 1, 40, 100],
      ["202609", "06520F01", "FARM", "143", "P", 6, 0, 30, 80],
      ["202609", "06520F02", "PUESTO", "143", "P", 9, 0, 0, 20],
    ]);
    const f1 = parsed.rows.find((x) => x.code === "06520F01")!;
    expect(f1.consumption).toEqual([6, 6]);
    expect(f1.otherOut).toEqual([40, 30]);
    expect(groupByIpress(parsed.rows)[0].otherOut).toEqual([40, 30]);
  });

  it("guarda las salidas que no son consumo por tipo y mes, y las suma por IPRESS (punto F)", () => {
    const H = ["ANNOMES", "CODIGO_PRE", "EESS", "CODIGO_MED", "DESCRIPCION MED", "VENTA", "DEVOL", "VENCIDO", "DISTRI", "OTRAS_SAL", "SAL_CONINS", "STOCK_FIN"];
    const parsed = parseTformdetHistory([H,
      ["202608", "06520F01", "FARM", "143", "P", 0, 10, 0, 0, 0, 5, 50],
      ["202609", "06520F01", "FARM", "143", "P", 0, 0, 2, 0, 0, 0, 48],
      ["202609", "06520F02", "PUESTO", "143", "P", 0, 4, 0, 0, 0, 0, 6],
      ["202609", "06520F02", "PUESTO", "200", "Q", 0, 0, 0, 0, 0, 0, 9],
    ]);
    expect(parsed.outflowColumns).toEqual(["DEVOL", "DISTRI", "VENCIDO", "OTRAS_SAL"]);
    const f1 = parsed.rows.find((x) => x.code === "06520F01")!;
    // Solo las que tuvieron algo; SAL_CONINS es informativa y no resta del stock.
    expect(f1.outflows).toEqual({ DEVOL: [10, 0], VENCIDO: [0, 2] });
    expect(parsed.rows.find((x) => x.medCode === "00200")!.outflows).toBeUndefined();
    const ipress = groupByIpress(parsed.rows).find((x) => x.medCode === "00143")!;
    expect(ipress.outflows).toEqual({ DEVOL: [10, 4], VENCIDO: [0, 2] });
    expect(f1.outflows).toEqual({ DEVOL: [10, 0], VENCIDO: [0, 2] }); // sumar no toca la fila original
  });

  it("guarda los registros del último mes del TFORMDET para el Excel", () => {
    const sheet = [["ANNOMES", "CODIGO_PRE", "CODIGO_MED", "MEDLOTE", "MEDREGSAN", "VENTA", "STOCK_FIN"],
      ["202608", "06503", "143", "L1", "EE-1", 5, 30],
      ["202609", "06503", "143", "L1", "EE-1", 4, 26],
      ["202609", "030S05", "143", "L9", "EE-1", 1, 50],
      ["202609", 6502, "00200", "L2", "EN-2", 0, 10]];
    const last = tformdetLastMonth(sheet)!;
    expect(last.month).toBe("202609");
    expect(last.header).toEqual(["CODIGO_PRE", "CODIGO_MED", "MEDLOTE", "MEDREGSAN", "VENTA", "STOCK_FIN"]);
    expect(last.rows).toEqual([["06503", "00143", "L1", "EE-1", 4, 26], ["06502", "00200", "L2", "EN-2", 0, 10]]);
    expect(tformdetLastMonth([["A", "B"]])).toBeNull();
  });

  it("avisa si el archivo no es de disponibilidad", () => {
    expect(() => parseAvailabilitySheet([["A", "B"], [1, 2]])).toThrow(/encabezados/);
  });
});

describe("fecha del stock (punto E de la auditoría)", () => {
  it("es el último día del mes de corte", () => {
    expect(cutDateOf("202609")).toEqual(new Date(2026, 8, 30));
    expect(cutDateOf("202602")).toEqual(new Date(2026, 1, 28));
    expect(cutDateOf("202402")).toEqual(new Date(2024, 1, 29));
    expect(cutDateOf("202612")).toEqual(new Date(2026, 11, 31));
  });

  it("sin un mes reconocible usa la fecha de respaldo", () => {
    const hoy = new Date(2026, 9, 9);
    expect(cutDateOf(undefined, hoy)).toBe(hoy);
    expect(cutDateOf("", hoy)).toBe(hoy);
    expect(cutDateOf("202613", hoy)).toBe(hoy);
    expect(cutDateOf("set 2026", hoy)).toBe(hoy);
  });

  it("los meses al vencimiento se cuentan desde el cierre del corte, no desde hoy", () => {
    // Un TFORMDET de junio revisado en octubre: el lote vence el 31/12/2026.
    const rows = [{
      red: "R", microred: "M", code: "00001", ipressCode: "00001", name: "P.S.", category: "I-1", medCode: "01000", description: "P", form: "", price: 1,
      medtip: "M", medpet: "P", medest: "S", consumption: [10, 10, 10], stock: 60,
    }];
    const lots = new Map([["00001|01000", [{ lot: "L1", expiry: new Date(2026, 11, 31), balance: 60 }]]]);
    const desdeCorte = buildItems(rows, lots, cutDateOf("202606"))[0];
    const desdeHoy = buildItems(rows, lots, new Date(2026, 9, 9))[0];
    expect(desdeCorte.monthsToExpiry).toBe(6);     // del 30/06 al 31/12
    expect(desdeCorte.expiryRisk).toBe(false);     // 6 meses de stock alcanzan
    expect(desdeHoy.monthsToExpiry).toBe(2);       // contado desde hoy parecía a punto de vencer
    expect(desdeHoy.expiryRisk).toBe(true);
  });
});
