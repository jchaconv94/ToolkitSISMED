import { StockStatus } from "../types";
import { dmeLevelOf, type AvailabilityItem, type AvailabilityRow, type LevelThresholds, type ParsedTformdet } from "./availabilityReport";
import type { ScopeRule } from "./availabilityConfig";
import type { DmeLevel } from "./stockStatus";
import { callSendKeysRpc } from "./sendKeys";
import { withOfflineCache } from "./offlineCache";

/**
 * Historial de disponibilidad (2026-10-09, pedido del usuario): cada mes que se guarda desde el
 * reporte del mes queda en Supabase por establecimiento (IPRESS, farmacias sumadas) y vista
 * (todos los productos o medicamentos esenciales). Se guardan los conteos por situación, no los
 * productos: así el porcentaje se recalcula con la fórmula vigente (qué situaciones cuentan,
 * niveles, promedio o suma) y la microred y la UNGET salen del registro actual.
 *
 * Lo que no se puede recalcular sin el detalle (límites de 2 y 6 meses, corte a un decimal,
 * listas de vitales y fusionados) queda anotado en cada guardado (`HistorySave`).
 */

export type HistoryView = "all" | "essential";
export const HISTORY_VIEWS: HistoryView[] = ["all", "essential"];
/** Meses de consumo con que se calcula cada mes guardado: siempre 12 (decisión del usuario). */
export const HISTORY_WINDOW = 12;
export const HISTORY_SQL = "SUPABASE_DISPONIBILIDAD_HISTORIAL.sql";

export interface HistoryCounts {
  desabastecido: number;
  substock: number;
  normostock: number;
  sobrestock: number;
  sinRotacion: number;
  /** Sin rotación que son vitales: cuentan en la DME si la regla es «solo vitales». */
  sinRotacionVital: number;
  total: number;
}

export interface HistoryRecord extends HistoryCounts {
  code: string;
  /** «YYYYMM». */
  month: string;
  view: HistoryView;
  /** Posición de su guardado en `HistoryData.saves` (quién y cuándo). */
  save?: number;
}

/** Quién guardó cada mes, cuándo y con qué reglas. */
export interface HistorySave {
  month: string;
  savedBy: string;
  savedByName: string;
  savedAt: string;
  establishments: number;
  subMax: number;
  sobreMin: number;
  truncate: boolean;
  fusedVersion: string;
  /** Mes de corte del TFORMDET con que se calculó (un mes llenado hacia atrás sale de uno posterior). */
  sourceCut: string;
}

export interface HistoryData {
  records: HistoryRecord[];
  saves: HistorySave[];
  /** Todos los meses con algo guardado en la jurisdicción (para elegir el año). */
  months: string[];
}

/* ------------------------------------------------------------ Meses */

export const yearMonths = (year: number): string[] => Array.from({ length: 12 }, (_, i) => `${year}${String(i + 1).padStart(2, "0")}`);
export const previousYearMonth = (month: string) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
export const previousMonth = (month: string) => {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(4, 6));
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`;
};

/** Mes actual en Lima, «YYYYMM»: ese mes y los siguientes no se guardan (están en curso). */
export const currentMonthKey = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")?.value}${parts.find((p) => p.type === "month")?.value}`;
};

/* ------------------------------------------------------------ Ventana de 12 meses */

/**
 * Filas de un mes como si fuera el corte: el consumo de los 12 meses que terminan en él y el
 * stock al cierre de ese mes. Lo que ese mes no tenía stock ni consumo en su ventana no se
 * evalúa, igual que al corte (`parseTformdetHistory`).
 */
export const rowsAtMonth = (rows: AvailabilityRow[], k: number, window = HISTORY_WINDOW): AvailabilityRow[] => {
  const from = Math.max(0, k - window + 1);
  const out: AvailabilityRow[] = [];
  for (const r of rows) {
    const consumption = r.consumption.slice(from, k + 1);
    const stock = r.stockByMonth ? r.stockByMonth[k] ?? 0 : k === r.consumption.length - 1 ? r.stock : 0;
    if (stock <= 0 && !consumption.some((c) => c > 0)) continue;
    out.push({ ...r, consumption, stock });
  }
  return out;
};

/**
 * Meses anteriores al corte que se pueden guardar con un TFORMDET de más de 12 meses: los que
 * tienen sus 12 meses de consumo dentro del archivo (índices en `months`).
 */
export const backfillMonths = (months: string[], window = HISTORY_WINDOW): number[] => {
  const out: number[] = [];
  for (let k = window - 1; k < months.length - 1; k++) out.push(k);
  return out;
};

const sliceRow = (r: AvailabilityRow, from: number): AvailabilityRow => ({
  ...r,
  consumption: r.consumption.slice(from),
  otherOut: r.otherOut?.slice(from),
  outflows: r.outflows && Object.fromEntries(Object.entries(r.outflows).map(([k, v]) => [k, v.slice(from)])),
  stockByMonth: r.stockByMonth?.slice(from),
});

/**
 * El TFORMDET recortado a sus últimos 12 meses: el reporte del mes siempre se calcula con 12
 * meses de consumo (decisión del usuario del 2026-10-09), aunque el archivo traiga más. Los
 * meses anteriores solo sirven para llenar el historial hacia atrás. Lo que en esos 12 meses no
 * tuvo consumo ni stock al corte deja de evaluarse, como al leer el archivo.
 */
export const lastMonthsOf = <T extends ParsedTformdet>(data: T, window = HISTORY_WINDOW): T => {
  if (data.months.length <= window) return data;
  const from = data.months.length - window;
  const months = data.months.slice(from);
  const rows: AvailabilityRow[] = [];
  const dormantRows: AvailabilityRow[] = [];
  for (const r of [...data.rows, ...(data.dormantRows ?? [])]) {
    const t = sliceRow(r, from);
    const evaluated = t.stock > 0 || t.consumption.some((c) => c > 0);
    if (evaluated) rows.push(t);
    else if (t.stockByMonth?.some((v) => v > 0)) dormantRows.push(t);
  }
  const reportedMonths = data.reportedMonths && Object.fromEntries(Object.entries(data.reportedMonths).map(([code, list]) => [code, list.filter((m) => m >= months[0])]));
  return { ...data, months, rows, dormantRows, reportedMonths };
};

/* ------------------------------------------------------------ Conteos y porcentaje */

const emptyCounts = (): HistoryCounts => ({ desabastecido: 0, substock: 0, normostock: 0, sobrestock: 0, sinRotacion: 0, sinRotacionVital: 0, total: 0 });

const isVital = (item: AvailabilityItem, vitals?: ReadonlySet<string>) =>
  !!vitals && (vitals.has(item.medCode) || !!item.fusedFrom?.some((c) => vitals.has(c)));

/**
 * Conteos por establecimiento de un mes, de los ítems de nivel IPRESS de una vista. Los vitales
 * solo se cuentan en la DME, como en el tablero (`summaryOptionsOf`).
 */
export const historyRecordsOf = (items: AvailabilityItem[], month: string, view: HistoryView, vitals?: ReadonlySet<string>): HistoryRecord[] => {
  const byCode = new Map<string, HistoryCounts>();
  for (const it of items) {
    const c = byCode.get(it.code) ?? emptyCounts();
    c.total++;
    if (it.status === StockStatus.DESABASTECIDO) c.desabastecido++;
    else if (it.status === StockStatus.SUBSTOCK) c.substock++;
    else if (it.status === StockStatus.NORMOSTOCK) c.normostock++;
    else if (it.status === StockStatus.SOBRESTOCK) c.sobrestock++;
    else {
      c.sinRotacion++;
      if (view === "essential" && isVital(it, vitals)) c.sinRotacionVital++;
    }
    byCode.set(it.code, c);
  }
  return [...byCode].map(([code, c]) => ({ code, month, view, ...c })).sort((a, b) => a.code.localeCompare(b.code));
};

/**
 * Conteos que entran en la evaluación con la regla: con «vital» (DME, ficha 28) los sin
 * rotación que no son vitales no se evalúan, así que salen del total. Se recalcula con lo
 * guardado, porque cada mes guarda aparte sus sin rotación vitales.
 */
export const evaluatedCounts = (c: HistoryCounts, rule: ScopeRule, view: HistoryView): HistoryCounts => {
  if (rule.sinRotacion !== "vital") return c;
  const vital = view === "essential" ? c.sinRotacionVital : 0;
  return { ...c, sinRotacion: vital, sinRotacionVital: vital, total: c.total - (c.sinRotacion - vital) };
};

export const availableOf = (counts: HistoryCounts, rule: ScopeRule, view: HistoryView) => {
  const c = evaluatedCounts(counts, rule, view);
  return (rule.normostock ? c.normostock : 0) +
    (rule.sobrestock ? c.sobrestock : 0) +
    (rule.substock ? c.substock : 0) +
    (rule.sinRotacion === "yes" || rule.sinRotacion === "vital" ? c.sinRotacion : 0);
};

export const recordPct = (counts: HistoryCounts, rule: ScopeRule, view: HistoryView): number | null => {
  const total = evaluatedCounts(counts, rule, view).total;
  return total ? (availableOf(counts, rule, view) / total) * 100 : null;
};

export interface HistoryOptions {
  rules: Record<HistoryView, ScopeRule>;
  aggregate: "average" | "sum";
  levels: LevelThresholds;
}

/* ------------------------------------------------------------ Índice y series */

/** vista → mes → establecimiento → conteos. */
export type HistoryIndex = Map<HistoryView, Map<string, Map<string, HistoryCounts>>>;

export const indexHistory = (records: HistoryRecord[]): HistoryIndex => {
  const index: HistoryIndex = new Map(HISTORY_VIEWS.map((v) => [v, new Map()]));
  for (const r of records) {
    const byMonth = index.get(r.view);
    if (!byMonth) continue;
    const byCode = byMonth.get(r.month) ?? new Map<string, HistoryCounts>();
    byCode.set(r.code, r);
    byMonth.set(r.month, byCode);
  }
  return index;
};

export interface HistoryPoint {
  pct: number | null;
  /** Establecimientos con datos ese mes. */
  establishments: number;
}

/** Porcentaje de un conjunto de establecimientos un mes: promedio de establecimientos o suma de ítems, como el tablero. */
const pctOfCodes = (byCode: Map<string, HistoryCounts> | undefined, codes: ((code: string) => boolean) | null, view: HistoryView, opts: HistoryOptions): HistoryPoint => {
  if (!byCode) return { pct: null, establishments: 0 };
  const rule = opts.rules[view];
  const pcts: number[] = [];
  let available = 0, total = 0;
  for (const [code, c] of byCode) {
    if (codes && !codes(code)) continue;
    const p = recordPct(c, rule, view);
    if (p === null) continue;
    pcts.push(p);
    available += availableOf(c, rule, view);
    total += evaluatedCounts(c, rule, view).total;
  }
  if (!pcts.length) return { pct: null, establishments: 0 };
  const pct = opts.aggregate === "sum" ? (available / total) * 100 : pcts.reduce((a, b) => a + b, 0) / pcts.length;
  return { pct, establishments: pcts.length };
};

export const historySeries = (index: HistoryIndex, view: HistoryView, months: string[], codes: ((code: string) => boolean) | null, opts: HistoryOptions): HistoryPoint[] =>
  months.map((m) => pctOfCodes(index.get(view)?.get(m), codes, view, opts));

export interface HistoryEntityRow {
  key: string;
  name: string;
  /** Microred (de un establecimiento) o UNGET (de una microred). */
  group: string;
  pct: Array<number | null>;
  /** Mismo mes del año anterior, para la variación. */
  previous: Array<number | null>;
}

/**
 * Filas por establecimiento o por grupo (microred, UNGET): `keyOf` da a qué fila va cada
 * establecimiento (`null` lo deja fuera).
 */
export const historyRows = (
  index: HistoryIndex,
  view: HistoryView,
  months: string[],
  keyOf: (code: string) => string | null,
  describe: (key: string) => { name: string; group: string },
  opts: HistoryOptions,
): HistoryEntityRow[] => {
  const keys = new Set<string>();
  const byMonth = index.get(view);
  const allMonths = [...months, ...months.map(previousYearMonth)];
  for (const m of allMonths) for (const code of byMonth?.get(m)?.keys() ?? []) { const k = keyOf(code); if (k !== null) keys.add(k); }
  return [...keys].map((key) => {
    const belongs = (code: string) => keyOf(code) === key;
    const { name, group } = describe(key);
    return {
      key, name, group,
      pct: months.map((m) => pctOfCodes(byMonth?.get(m), belongs, view, opts).pct),
      previous: months.map((m) => pctOfCodes(byMonth?.get(previousYearMonth(m)), belongs, view, opts).pct),
    };
  }).sort((a, b) => a.group.localeCompare(b.group, "es") || a.name.localeCompare(b.name, "es"));
};

export const levelOfPct = (pct: number, opts: HistoryOptions): DmeLevel => dmeLevelOf(pct, opts.levels);

/* ------------------------------------------------------------ Guardar un mes */

export type ExcludedReason = "registry" | "scope" | "unreported";
export const EXCLUDED_LABEL: Record<ExcludedReason, string> = {
  registry: "No está en el registro de Establecimientos",
  scope: "Fuera de su jurisdicción",
  unreported: "No informó ese mes",
};

export interface HistorySavePlan {
  month: string;
  records: HistoryRecord[];
  establishments: number;
  excluded: Array<{ code: string; name: string; reason: ExcludedReason }>;
  /** Guardados anteriores de ese mes (se reemplazan los establecimientos de este archivo). */
  previous: HistorySave[];
  /** Establecimientos distintos ya guardados ese mes (uno puede venir de dos guardados: una vista en cada uno). */
  savedEstablishments: number;
  /** Establecimientos ya guardados ese mes que no vienen en este archivo: se conservan. */
  kept: string[];
  /** El archivo no trae la clasificación: solo se guarda «todos los productos». */
  essentialMissing: boolean;
  /** Por qué no se puede guardar. */
  blocked: null | "open-month" | "window";
}

export const planHistorySave = (input: {
  month: string;
  /** Meses de consumo con que se calculó (12 = completo). */
  window: number;
  items: Record<HistoryView, AvailabilityItem[] | null>;
  vitals?: ReadonlySet<string>;
  nameOf: (code: string) => string | undefined;
  inRegistry: (code: string) => boolean;
  inScope: (code: string) => boolean;
  reported: (code: string) => boolean;
  existing: HistoryData | null;
  now?: Date;
}): HistorySavePlan => {
  const { month } = input;
  const excluded: HistorySavePlan["excluded"] = [];
  const keep = (code: string) => {
    const reason: ExcludedReason | null = !input.inRegistry(code) ? "registry" : !input.inScope(code) ? "scope" : !input.reported(code) ? "unreported" : null;
    if (reason && !excluded.some((e) => e.code === code)) excluded.push({ code, name: input.nameOf(code) || code, reason });
    return !reason;
  };
  const records = HISTORY_VIEWS.flatMap((view) => {
    const items = input.items[view];
    return items ? historyRecordsOf(items, month, view, input.vitals).filter((r) => keep(r.code)) : [];
  });
  const codes = new Set(records.map((r) => r.code));
  const savedCodes = new Set((input.existing?.records ?? []).filter((r) => r.month === month).map((r) => r.code));
  const blocked = month >= currentMonthKey(input.now) ? "open-month" : input.window < HISTORY_WINDOW ? "window" : null;
  return {
    month,
    records,
    establishments: codes.size,
    excluded: excluded.sort((a, b) => a.reason.localeCompare(b.reason) || a.code.localeCompare(b.code)),
    previous: (input.existing?.saves ?? []).filter((s) => s.month === month).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    savedEstablishments: savedCodes.size,
    kept: [...savedCodes].filter((c) => !codes.has(c) && input.inScope(c)).sort(),
    essentialMissing: !input.items.essential,
    blocked,
  };
};

/* ------------------------------------------------------------ Supabase */

type WireRecord = [string, string, HistoryView, number, number, number, number, number, number, number, number];

const fromWire = (r: WireRecord): HistoryRecord => ({
  code: r[0], month: r[1], view: r[2],
  desabastecido: r[3], substock: r[4], normostock: r[5], sobrestock: r[6], sinRotacion: r[7], sinRotacionVital: r[8], total: r[9],
  save: r[10],
});

const toWire = (r: HistoryRecord) => [r.code, r.view, r.desabastecido, r.substock, r.normostock, r.sobrestock, r.sinRotacion, r.sinRotacionVital, r.total];

export const availabilityHistoryApi = {
  /**
   * Lo guardado entre dos meses, ya recortado por la jurisdicción de quien pregunta (lo hace el
   * servidor). Vuelve como arreglos compactos: dos años de toda la DIRESA pasan de las 1 000
   * filas que Supabase devuelve por consulta. La copia sin internet va por usuario: otro usuario
   * del mismo equipo no debe ver la jurisdicción del anterior.
   */
  list: (username: string, from: string, to: string): Promise<HistoryData> =>
    withOfflineCache(`disponibilidad-historial:${username}:${from}:${to}`, async () => {
      const data = await callSendKeysRpc<{ records?: WireRecord[]; saves?: HistorySave[]; months?: string[] } | null>("app_availability_history_list", { p_from: from, p_to: to }, HISTORY_SQL);
      return { records: (data?.records ?? []).map(fromWire), saves: data?.saves ?? [], months: data?.months ?? [] };
    }),
  save: (plan: HistorySavePlan, meta: { subMax: number; sobreMin: number; truncate: boolean; fusedVersion: string; sourceCut: string }) =>
    callSendKeysRpc<{ saved: number; rejected: Array<{ code: string; reason: string }> }>("app_availability_history_save", {
      p_month: plan.month,
      p_rows: plan.records.map(toWire),
      p_meta: meta,
    }, HISTORY_SQL),
  remove: (month: string) => callSendKeysRpc<number>("app_availability_history_remove", { p_month: month }, HISTORY_SQL),
};
