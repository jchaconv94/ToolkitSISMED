import { describe, expect, it } from "vitest";
import { buildItems, essentialRows, groupByIpress, parseTformdetHistory, summarize, type AvailabilityRow, type ParsedTformdet } from "./availabilityReport";
import type { ScopeRule } from "./availabilityConfig";
import {
  availableOf, backfillMonths, currentMonthKey, evaluatedCounts, historyRecordsOf, historyRows, historySeries, indexHistory, lastMonthsOf, planHistorySave,
  previousMonth, previousYearMonth, recordPct, rowsAtMonth, yearMonths,
  type HistoryData, type HistoryOptions,
} from "./availabilityHistory";

const LEVELS = { optimo: 90, alto: 80, regular: 70 };
const ALL_RULE: ScopeRule = { normostock: true, sobrestock: true, substock: false, sinRotacion: "no" };
const DME_RULE: ScopeRule = { normostock: true, sobrestock: true, substock: false, sinRotacion: "vital" };

const row = (code: string, med: string, consumption: number[], stock: number, microred = "MR1", extra: Partial<AvailabilityRow> = {}): AvailabilityRow => ({
  red: "BELLAVISTA", microred, code, ipressCode: code.slice(0, 5), name: `EESS ${code}`, category: "I-2",
  medCode: med, description: `PRODUCTO ${med}`, form: "TAB", price: 1, medtip: "M", medpet: "P", medest: "S",
  consumption, stock, ...extra,
});

// Un establecimiento con cada situación: desabastecido, substock, normostock, sobrestock y sin rotación.
const ROWS: AvailabilityRow[] = [
  row("06499", "00001", [10, 10, 10], 0), // desabastecido
  row("06499", "00002", [10, 10, 10], 5), // substock (0,5 meses)
  row("06499", "00003", [10, 10, 10], 30), // normostock (3 meses)
  row("06499", "00004", [10, 10, 10], 100), // sobrestock (10 meses)
  row("06499", "00005", [0, 0, 0], 8), // sin rotación (vital)
  row("06499", "00006", [0, 0, 0], 8), // sin rotación (no vital)
  row("06503", "00001", [4, 4, 4], 10, "MR2"),
  row("06503", "00003", [4, 4, 4], 0, "MR2"),
  row("06504", "00003", [2, 2, 2], 6, "MR2"),
];
const VITALS = new Set(["00005"]);

describe("historial de disponibilidad: conteos", () => {
  const items = buildItems(ROWS);

  it("cuenta cada situación por establecimiento; los vitales sin rotación solo en la DME", () => {
    const all = historyRecordsOf(items, "202609", "all", VITALS);
    const ess = historyRecordsOf(items, "202609", "essential", VITALS);
    expect(all.find((r) => r.code === "06499")).toMatchObject({ desabastecido: 1, substock: 1, normostock: 1, sobrestock: 1, sinRotacion: 2, sinRotacionVital: 0, total: 6 });
    expect(ess.find((r) => r.code === "06499")).toMatchObject({ sinRotacion: 2, sinRotacionVital: 1, total: 6 });
    expect(all.map((r) => r.code)).toEqual(["06499", "06503", "06504"]);
  });

  it("disponibles según la regla: «solo vitales» no cuenta en todos los productos", () => {
    const [eess] = historyRecordsOf(items, "202609", "essential", VITALS);
    expect(availableOf(eess, DME_RULE, "essential")).toBe(3); // normo + sobre + 1 vital
    expect(availableOf(eess, DME_RULE, "all")).toBe(2);
    expect(availableOf(eess, { ...ALL_RULE, substock: true, sinRotacion: "yes" }, "all")).toBe(5);
    expect(recordPct({ ...eess, total: 0 }, ALL_RULE, "all")).toBeNull();
  });

  it("DME con «solo vitales»: los sin rotación que no son vitales salen del total (ficha 28)", () => {
    const [eess] = historyRecordsOf(items, "202609", "essential", VITALS);
    // 6 ítems: 2 sin rotación, 1 vital. Se evalúan 5; disponibles normo + sobre + el vital.
    expect(evaluatedCounts(eess, DME_RULE, "essential")).toMatchObject({ total: 5, sinRotacion: 1, sinRotacionVital: 1 });
    expect(recordPct(eess, DME_RULE, "essential")).toBeCloseTo(60, 10);
    // Con otra regla no se toca nada.
    expect(evaluatedCounts(eess, ALL_RULE, "essential")).toBe(eess);
  });

  it.each(["average", "sum"] as const)("reproduce el porcentaje del tablero (%s) para la UNGET, cada microred y cada establecimiento", (aggregate) => {
    const opts: HistoryOptions = { rules: { all: ALL_RULE, essential: DME_RULE }, aggregate, levels: LEVELS };
    for (const view of ["all", "essential"] as const) {
      const summary = summarize(items, { rule: opts.rules[view], vitalCodes: view === "essential" ? VITALS : undefined, levels: LEVELS, aggregate });
      const index = indexHistory(historyRecordsOf(items, "202609", view, VITALS));
      expect(historySeries(index, view, ["202609"], null, opts)[0].pct).toBeCloseTo(summary.pct, 10);
      const micro = historyRows(index, view, ["202609"], (code) => ROWS.find((r) => r.code === code)!.microred, (k) => ({ name: k, group: "" }), opts);
      for (const m of summary.microredes) expect(micro.find((r) => r.key === m.microred)!.pct[0]).toBeCloseTo(m.pct, 10);
      const est = historyRows(index, view, ["202609"], (code) => code, (k) => ({ name: k, group: "" }), opts);
      for (const e of summary.establishments) expect(est.find((r) => r.key === e.code)!.pct[0]).toBeCloseTo(e.pct, 10);
    }
  });

  it("cada fila trae también el mismo mes del año anterior", () => {
    const opts: HistoryOptions = { rules: { all: ALL_RULE, essential: DME_RULE }, aggregate: "average", levels: LEVELS };
    const index = indexHistory([
      ...historyRecordsOf(items, "202609", "all"),
      ...historyRecordsOf(items.filter((i) => i.code === "06504"), "202509", "all"),
    ]);
    const rows = historyRows(index, "all", ["202608", "202609"], (c) => c, (k) => ({ name: k, group: "" }), opts);
    const r = rows.find((x) => x.key === "06504")!;
    expect(r.pct).toEqual([null, 100]);
    expect(r.previous).toEqual([null, 100]);
    expect(rows.find((x) => x.key === "06499")!.previous).toEqual([null, null]);
  });

  it("un mes sin datos queda sin punto y cuenta cuántos establecimientos tiene cada mes", () => {
    const opts: HistoryOptions = { rules: { all: ALL_RULE, essential: DME_RULE }, aggregate: "average", levels: LEVELS };
    const index = indexHistory(historyRecordsOf(items, "202609", "all"));
    const series = historySeries(index, "all", ["202608", "202609"], (c) => c !== "06504", opts);
    expect(series[0]).toEqual({ pct: null, establishments: 0 });
    expect(series[1].establishments).toBe(2);
  });
});

describe("historial de disponibilidad: meses", () => {
  it("año, mes anterior y mismo mes del año anterior", () => {
    expect(yearMonths(2026)[0]).toBe("202601");
    expect(yearMonths(2026)[11]).toBe("202612");
    expect(previousYearMonth("202609")).toBe("202509");
    expect(previousMonth("202601")).toBe("202512");
    expect(previousMonth("202610")).toBe("202609");
  });

  it("el mes en curso es el de Lima, no el de la computadora", () => {
    // 1 de noviembre a las 03:00 UTC: en Lima todavía es 31 de octubre.
    expect(currentMonthKey(new Date("2026-11-01T03:00:00Z"))).toBe("202610");
    expect(currentMonthKey(new Date("2026-11-01T06:00:00Z"))).toBe("202611");
  });

  it("cada mes se calcula con su stock y los 12 meses de consumo que terminan en él", () => {
    const r = row("06499", "00001", [1, 2, 3, 4, 5], 9, "MR1", { stockByMonth: [5, 6, 7, 8, 9] });
    const [m] = rowsAtMonth([r], 2, 2);
    expect(m.consumption).toEqual([2, 3]);
    expect(m.stock).toBe(7);
    // Sin stock ese mes y sin consumo en su ventana: no se evalúa.
    const idle = row("06499", "00002", [5, 0, 0, 0, 0], 0, "MR1", { stockByMonth: [3, 0, 0, 0, 0] });
    expect(rowsAtMonth([idle], 3, 2)).toHaveLength(0);
    expect(rowsAtMonth([idle], 0, 2)).toHaveLength(1);
  });

  it("meses que se pueden llenar hacia atrás: los que tienen sus 12 meses dentro del archivo", () => {
    const months = Array.from({ length: 24 }, (_, i) => String(202410 + i));
    expect(backfillMonths(months)).toEqual(Array.from({ length: 12 }, (_, i) => 11 + i));
    expect(backfillMonths(months.slice(0, 12))).toEqual([]);
    expect(backfillMonths(months.slice(0, 13))).toEqual([11]);
  });

  it("el reporte del mes usa solo los últimos 12 meses del archivo", () => {
    const months = Array.from({ length: 14 }, (_, i) => (i < 3 ? `20250${7 + i}` : i < 6 ? `20251${i - 3}` : `20260${i - 5}`)).map((m) => m.slice(0, 6));
    expect(months[13]).toBe("202608");
    const used = row("06499", "00001", [...Array(13).fill(0), 6], 4, "MR1", { stockByMonth: Array(14).fill(4) });
    const old = row("06499", "00002", [9, 9, ...Array(12).fill(0)], 0, "MR1", { stockByMonth: [5, 0, ...Array(12).fill(0)] });
    const once = row("06499", "00003", [9, ...Array(13).fill(0)], 0, "MR1", { stockByMonth: [0, 0, 7, ...Array(11).fill(0)] });
    const data = { rows: [used, old, once], months, hasPharmacies: false, warehouse: [], lots: new Map(), hasClassification: true, skippedCodes: [], reportedMonths: { "06499": months } } as ParsedTformdet;
    const t = lastMonthsOf(data);
    expect(t.months).toEqual(months.slice(2));
    expect(t.rows.map((r) => r.medCode)).toEqual(["00001"]);
    expect(t.rows[0].consumption).toHaveLength(12);
    expect(t.rows[0].stockByMonth).toHaveLength(12);
    // El que solo tuvo consumo antes de la ventana sale; el que tuvo stock dentro de ella queda aparte.
    expect(t.dormantRows!.map((r) => r.medCode)).toEqual(["00003"]);
    expect(t.reportedMonths!["06499"]).toHaveLength(12);
    // Con 12 meses o menos, el archivo queda tal cual.
    const short = { ...data, months: months.slice(0, 12) };
    expect(lastMonthsOf(short)).toBe(short);
  });
});

describe("historial de disponibilidad: qué se guarda", () => {
  const items = buildItems(ROWS);
  const existing: HistoryData = {
    records: [
      { code: "06499", month: "202609", view: "all", desabastecido: 1, substock: 0, normostock: 1, sobrestock: 0, sinRotacion: 0, sinRotacionVital: 0, total: 2 },
      { code: "06510", month: "202609", view: "all", desabastecido: 1, substock: 0, normostock: 1, sobrestock: 0, sinRotacion: 0, sinRotacionVital: 0, total: 2 },
      { code: "06999", month: "202609", view: "all", desabastecido: 1, substock: 0, normostock: 1, sobrestock: 0, sinRotacion: 0, sinRotacionVital: 0, total: 2 },
    ],
    saves: [
      { month: "202609", savedBy: "a", savedByName: "ANA", savedAt: "2026-10-03T10:00:00Z", establishments: 2, subMax: 2, sobreMin: 6, truncate: false, fusedVersion: "", sourceCut: "202609" },
      { month: "202609", savedBy: "b", savedByName: "BETO", savedAt: "2026-10-05T10:00:00Z", establishments: 1, subMax: 2, sobreMin: 6, truncate: false, fusedVersion: "", sourceCut: "202609" },
      { month: "202608", savedBy: "a", savedByName: "ANA", savedAt: "2026-09-05T10:00:00Z", establishments: 3, subMax: 2, sobreMin: 6, truncate: false, fusedVersion: "", sourceCut: "202608" },
    ],
    months: ["202608", "202609"],
  };
  const base = {
    month: "202609",
    window: 12,
    items: { all: items, essential: items },
    vitals: VITALS,
    nameOf: (code: string) => `EESS ${code}`,
    inRegistry: (code: string) => code !== "06504",
    inScope: (code: string) => code !== "06503" && code !== "06999",
    reported: () => true,
    existing,
    now: new Date("2026-10-09T15:00:00Z"),
  };

  it("deja fuera lo que no está en el registro o en la jurisdicción, con su motivo", () => {
    const plan = planHistorySave(base);
    expect(plan.establishments).toBe(1);
    expect(plan.records.map((r) => `${r.code}|${r.view}`)).toEqual(["06499|all", "06499|essential"]);
    expect(plan.excluded).toEqual([
      { code: "06504", name: "EESS 06504", reason: "registry" },
      { code: "06503", name: "EESS 06503", reason: "scope" },
    ]);
  });

  it("un establecimiento que no informó ese mes no se guarda (saldría todo desabastecido)", () => {
    const plan = planHistorySave({ ...base, inScope: () => true, inRegistry: () => true, reported: (code) => code !== "06503" });
    expect(plan.excluded).toEqual([{ code: "06503", name: "EESS 06503", reason: "unreported" }]);
    expect(plan.establishments).toBe(2);
  });

  it("avisa qué se reemplaza y conserva los guardados que no vienen en el archivo (solo de su jurisdicción)", () => {
    const plan = planHistorySave(base);
    expect(plan.previous.map((s) => s.savedByName)).toEqual(["BETO", "ANA"]);
    expect(plan.kept).toEqual(["06510"]);
    expect(plan.savedEstablishments).toBe(3);
  });

  it("sin clasificación solo se guarda «todos los productos»", () => {
    const plan = planHistorySave({ ...base, items: { all: items, essential: null } });
    expect(plan.essentialMissing).toBe(true);
    expect(plan.records.every((r) => r.view === "all")).toBe(true);
  });

  it("no deja guardar el mes en curso ni un mes con menos de 12 meses de consumo", () => {
    expect(planHistorySave(base).blocked).toBeNull();
    expect(planHistorySave({ ...base, month: "202610" }).blocked).toBe("open-month");
    expect(planHistorySave({ ...base, window: 8 }).blocked).toBe("window");
  });
});

describe("historial de disponibilidad: relleno hacia atrás", () => {
  // TFORMDET de 14 meses con farmacias, un producto que deja de moverse y otro que aparece tarde.
  const H = ["ANNOMES", "CODIGO_PRE", "EESS", "CODIGO_MED", "DESCRIPCION MED", "VENTA", "SIS", "STOCK_FIN", "MEDTIP", "MEDPET", "MEDEST"];
  const months = Array.from({ length: 14 }, (_, i) => { const d = new Date(2025, 6 + i, 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const sheet: unknown[][] = [H];
  months.forEach((m, i) => {
    sheet.push([m, "06502F01", "HOSP", "143", "P", 10 + i, 2, 40 - i, "M", "P", "S"]);
    sheet.push([m, "06502F02", "PUESTO", "143", "P", i % 3, 0, 5, "M", "P", "S"]);
    sheet.push([m, "06503", "PS", "200", "Q", i < 4 ? 8 : 0, 0, i < 6 ? 10 : 0, "M", "P", "S"]); // deja de moverse
    if (i >= 9) sheet.push([m, "06503", "PS", "300", "R", 3, 0, 12, "M", "X", "S"]); // aparece tarde, fuera del petitorio
  });
  const full = parseTformdetHistory(sheet);

  it("el mes de corte por el camino del relleno es igual al del tablero (últimos 12 meses)", () => {
    const trimmed = lastMonthsOf(full);
    const cut = full.months.length - 1;
    const viaTablero = buildItems(groupByIpress(trimmed.rows));
    const viaRelleno = buildItems(rowsAtMonth(groupByIpress([...full.rows, ...(full.dormantRows ?? [])]), cut));
    expect(historyRecordsOf(viaRelleno, months[cut], "all")).toEqual(historyRecordsOf(viaTablero, months[cut], "all"));
    const essTablero = buildItems(essentialRows(groupByIpress(trimmed.rows)));
    const essRelleno = buildItems(essentialRows(rowsAtMonth(groupByIpress([...full.rows, ...(full.dormantRows ?? [])]), cut)));
    expect(historyRecordsOf(essRelleno, months[cut], "essential")).toEqual(historyRecordsOf(essTablero, months[cut], "essential"));
  });

  it("solo los meses con 12 meses de consumo en el archivo, con su propio stock", () => {
    expect(backfillMonths(full.months)).toEqual([11, 12]);
    const base = groupByIpress([...full.rows, ...(full.dormantRows ?? [])]);
    const at11 = rowsAtMonth(base, 11);
    const hosp = at11.find((r) => r.code === "06502" && r.medCode === "00143")!;
    expect(hosp.consumption).toHaveLength(12);
    expect(hosp.stock).toBe(40 - 11 + 5);
    // 00200 tuvo stock hasta el mes 5 y consumo hasta el 3: en el mes 11 todavía tiene consumo en su ventana.
    expect(at11.some((r) => r.medCode === "00200")).toBe(true);
    expect(at11.some((r) => r.medCode === "00300")).toBe(true);
  });
});
