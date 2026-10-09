import { StockStatus } from "../types";
import { monthsOfStock, truncateOneDecimal, type DmeLevel } from "./stockStatus";
import type { ScopeRule } from "./availabilityConfig";
import { FUSED_CODE_GROUPS } from "./fusedCodes";

/**
 * Disponibilidad de productos por establecimiento (módulo «Disponibilidad», 2026-10-06).
 *
 * Reproduce el reporte en Excel del usuario («DISPONIBILIDAD DE MED POR IPRESS») con las
 * reglas acordadas:
 *
 * - CPA = consumo de los 12 meses ÷ meses con consumo (ficha 28 de DIGEMID).
 * - Meses de provisión = stock ÷ CPA. Por omisión **no** se cortan a un decimal (el usuario lo
 *   pidió para este módulo, 2026-10-06; el Análisis sí corta); es configurable.
 * - Todo lo configurable (qué situaciones cuentan, límites de meses, niveles, cómo se juntan
 *   microred y UNGET) viene de `services/availabilityConfig.ts`.
 * - Situación: Desabastecido (stock 0), Sin rotación (stock > 0 y CPA 0), Substock (< 2),
 *   Normostock (2 a 6) y Sobrestock (> 6). No existe «Sin consumo» (decisión del usuario).
 * - Disponibilidad = (Normostock + Sobrestock) ÷ total de ítems. Sin rotación cuenta en el
 *   total y no como disponible, salvo los medicamentos **vitales** en la vista de esenciales
 *   (ficha 28, RM 1288-2018-MINSA), cuando se tenga esa lista.
 * - La vista principal toma **todos los productos**. La DME (ficha 28) sale del mismo cálculo
 *   con `essentialRows`: medicamentos (M) que no son de estrategia (EST «S» o «_»), del
 *   petitorio o del listado de códigos fusionados, y con las presentaciones de una misma DCI
 *   **fusionadas** en su código destino (`services/fusedCodes.ts`, listado de DIGEMID): en
 *   cada establecimiento se suman stock y consumo de cada mes, y la situación se calcula una
 *   sola vez sobre esa suma.
 * - Nivel: Óptimo ≥ 90 %, Alto ≥ 80 %, Regular ≥ 70 %, Bajo < 70 %.
 * - Microred y UNGET: promedio de sus establecimientos (ficha 28).
 *
 * El archivo por farmacia trae una fila por farmacia (`06502F01`, `06502F02`…): la IPRESS
 * es la suma de sus farmacias (comprobado contra la hoja «DISPO x IPRESS» del usuario).
 */

export interface AvailabilityRow {
  /** Códigos que se sumaron en esta fila (fusión de la DME); vacío si no se fusionó nada. */
  fusedFrom?: string[];
  red: string;
  microred: string;
  /** Código de la farmacia o del establecimiento, como viene en el archivo. */
  code: string;
  /** Código de la IPRESS (los 5 primeros dígitos de una farmacia `06502F01`). */
  ipressCode: string;
  name: string;
  category: string;
  medCode: string;
  description: string;
  form: string;
  price: number;
  medtip: string;
  medpet: string;
  medest: string;
  /** Consumo de los 12 meses, del más antiguo al mes de corte. */
  consumption: number[];
  /**
   * Otras salidas (OTRAS_SAL del TFORMDET) por mes, alineadas con `consumption`. No son consumo:
   * en una F01 son, sobre todo, lo que entrega a sus puestos comunales. Solo las trae el TFORMDET.
   */
  otherOut?: number[];
  /**
   * Salidas que no son consumo, por columna del TFORMDET y por mes (punto F de la auditoría):
   * devoluciones, distribución, vencidos, otras salidas… Solo las que tuvieron algo.
   */
  outflows?: Record<string, number[]>;
  stock: number;
}

export interface ParsedAvailability {
  rows: AvailabilityRow[];
  /** Meses de consumo como `AAAAMM`, del más antiguo al de corte. */
  months: string[];
  /** ¿El archivo trae farmacias (códigos con «F»)? */
  hasPharmacies: boolean;
}

export interface Lot {
  lot: string;
  expiry: Date | null;
  balance: number;
  /** Farmacia o establecimiento donde está el lote (06502F02), si se conoce. */
  site?: string;
}

export interface AvailabilityItem extends AvailabilityRow {
  cpa: number;
  months: number;
  status: StockStatus;
  nearestExpiry: Date | null;
  lots: Lot[];
  /** Meses que faltan para el vencimiento más próximo. */
  monthsToExpiry: number | null;
  /** Los meses de provisión pasan el vencimiento más próximo: se vencería antes de usarse. */
  expiryRisk: boolean;
  /**
   * Solo en el riesgo de vencimiento de una F01 que abastece a sus puestos (`asSupplier`): el CPA
   * de lo dispensado; `cpa` lleva entonces también lo que entrega a sus puestos.
   */
  dispensedCpa?: number;
}

export interface StatusCounts {
  desabastecido: number;
  substock: number;
  normostock: number;
  sobrestock: number;
  sinRotacion: number;
  total: number;
  available: number;
}

export interface EstablishmentSummary extends StatusCounts {
  code: string;
  name: string;
  microred: string;
  red: string;
  category: string;
  pct: number;
  level: DmeLevel;
}

export interface MicroredSummary {
  microred: string;
  establishments: number;
  counts: StatusCounts;
  pct: number;
  level: DmeLevel;
}

export interface AvailabilityReport {
  items: AvailabilityItem[];
  establishments: EstablishmentSummary[];
  microredes: MicroredSummary[];
  pct: number;
  level: DmeLevel;
  counts: StatusCounts;
}

export type AvailabilityScope = "all" | "essential";

const normHeader = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HEADERS: Record<string, string[]> = {
  red: ["RED"],
  microred: ["MICRORED", "MICRO RED"],
  code: ["COD EESS", "CODIGO EESS", "COD ESTABLECIMIENTO", "CODIGO PRE", "COD PRE"],
  name: ["ESTABLECIMIENTO", "EESS", "NOMBRE EESS"],
  category: ["CAT", "CATEGORIA"],
  medCode: ["MED COD", "MEDCOD", "CODIGO MED", "COD MED"],
  description: ["DESCRIPCION DEL PRODUCTO", "DESCRIPCION", "DESCRIPCION MED", "PRODUCTO"],
  form: ["MEDFF", "F F", "FF", "FORMA FARMACEUTICA"],
  price: ["PRECIO"],
  medtip: ["MEDTIP", "TIPO"],
  medpet: ["MEDPET", "PET"],
  medest: ["MEDEST", "EST"],
  stock: ["STOCK FIN", "STOCK", "STOCK FINAL", "SALDO"],
};

const toNumber = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  const n = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const text = (v: unknown) => String(v ?? "").trim();

/** Rellena con ceros un código de solo dígitos: 143 → «00143». */
const padCode = (v: unknown, size = 5) => {
  const s = text(v).toUpperCase();
  return /^\d+$/.test(s) && s.length < size ? s.padStart(size, "0") : s;
};

/** Código de la IPRESS de una farmacia: `06502F01` → `06502`. */
export const ipressCodeOf = (code: string): string => {
  const m = /^(\d{5})F\d{2}$/i.exec(code.trim());
  return m ? m[1] : code.trim();
};

/** Encabezado de mes → `AAAAMM` (acepta 202609, «2026-09», una fecha de Excel o un Date). */
const monthKey = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}${String(v.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = text(v);
  let m = /^(20\d{2})[-/ ]?(0[1-9]|1[0-2])$/.exec(s);
  if (m) return `${m[1]}${m[2]}`;
  m = /^(20\d{2})-(0[1-9]|1[0-2])-\d{2}/.exec(s);
  if (m) return `${m[1]}${m[2]}`;
  return null;
};

/**
 * Lee la hoja de disponibilidad (por farmacia o por IPRESS) ya convertida en filas. Busca la
 * fila de encabezados entre las 15 primeras (el reporte del usuario tiene un título arriba).
 */
export const parseAvailabilitySheet = (sheet: unknown[][]): ParsedAvailability => {
  const headerIdx = sheet.slice(0, 15).findIndex((row) => {
    const cells = (row || []).map(normHeader);
    return HEADERS.medCode.some((h) => cells.includes(h)) && HEADERS.code.some((h) => cells.includes(h));
  });
  if (headerIdx < 0) {
    throw new Error("No se encontró la fila de encabezados (COD EESS, MED COD…). Revise que sea el archivo de disponibilidad del SISMED.");
  }
  const header = sheet[headerIdx].map(normHeader);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  const monthCols: Array<{ idx: number; key: string }> = [];
  sheet[headerIdx].forEach((cell, idx) => {
    const key = monthKey(cell);
    if (key) monthCols.push({ idx, key });
  });
  if (monthCols.length === 0) throw new Error("No se encontraron las columnas de consumo mensual (202510, 202511…).");
  if (col.stock === undefined) throw new Error("No se encontró la columna de stock (STOCK_FIN).");
  monthCols.sort((a, b) => a.key.localeCompare(b.key));
  const last12 = monthCols.slice(-12);

  const rows: AvailabilityRow[] = [];
  for (const raw of sheet.slice(headerIdx + 1)) {
    if (!raw) continue;
    const code = padCode(raw[col.code]);
    const medCode = padCode(raw[col.medCode]);
    if (!code || !medCode) continue;
    rows.push({
      red: text(raw[col.red]),
      microred: text(raw[col.microred]),
      code,
      ipressCode: ipressCodeOf(code),
      name: text(raw[col.name]),
      category: text(raw[col.category]),
      medCode,
      description: text(raw[col.description]),
      form: text(raw[col.form]),
      price: toNumber(raw[col.price]),
      medtip: text(raw[col.medtip]).toUpperCase(),
      medpet: text(raw[col.medpet]).toUpperCase(),
      medest: text(raw[col.medest]).toUpperCase(),
      consumption: last12.map((m) => Math.max(0, toNumber(raw[m.idx]))),
      stock: Math.max(0, toNumber(raw[col.stock])),
    });
  }
  return { rows, months: last12.map((m) => m.key), hasPharmacies: rows.some((r) => r.code !== r.ipressCode) };
};

/** Fecha de vencimiento del TFORMDET: «31/07/2027», un Date o un número de serie de Excel. */
const parseExpiry = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text(v));
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
};

/**
 * Lotes con saldo del TFORMDET, agrupados por «código de farmacia|código del producto». El
 * saldo es STOCK_FIN (stock al cierre del mes), como la hoja «ICI x FARM STOCK >0».
 */
export const parseLotsSheet = (sheet: unknown[][]): Map<string, Lot[]> => {
  const headerIdx = sheet.slice(0, 15).findIndex((row) => (row || []).map(normHeader).includes("MEDLOTE"));
  if (headerIdx < 0) throw new Error("No se encontró la columna MEDLOTE. Revise que sea el TFORMDET del SISMED.");
  const header = sheet[headerIdx].map(normHeader);
  const at = (name: string) => header.indexOf(name);
  const cPre = at("CODIGO PRE"), cMed = at("CODIGO MED"), cLot = at("MEDLOTE"), cExp = at("FEC EXP");
  const cStock = at("STOCK FIN") >= 0 ? at("STOCK FIN") : at("SALDO");
  if ([cPre, cMed, cLot, cStock].some((i) => i < 0)) {
    throw new Error("Al TFORMDET le faltan columnas: CODIGO_PRE, CODIGO_MED, MEDLOTE o STOCK_FIN.");
  }
  const lots = new Map<string, Lot[]>();
  for (const raw of sheet.slice(headerIdx + 1)) {
    if (!raw) continue;
    const balance = toNumber(raw[cStock]);
    if (balance <= 0) continue;
    const key = `${padCode(raw[cPre])}|${padCode(raw[cMed])}`;
    const list = lots.get(key) || [];
    list.push({ lot: text(raw[cLot]), expiry: cExp >= 0 ? parseExpiry(raw[cExp]) : null, balance });
    lots.set(key, list);
  }
  for (const list of lots.values()) {
    list.sort((a, b) => (a.expiry?.getTime() ?? Infinity) - (b.expiry?.getTime() ?? Infinity));
  }
  return lots;
};

/**
 * Junta las farmacias de cada IPRESS: suma consumo y stock por producto. `nameOf` da el
 * nombre oficial de la IPRESS (del registro de Establecimientos); sin él se usa el de la
 * fila con el código propio o el de la primera farmacia que no sea «FARM.».
 */
export const groupByIpress = (rows: AvailabilityRow[], nameOf?: (code: string) => string | undefined): AvailabilityRow[] => {
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.code === r.ipressCode) names.set(r.ipressCode, r.name);
    else if (!names.has(r.ipressCode) && !/^FARM/i.test(r.name)) names.set(r.ipressCode, r.name);
  }
  const groups = new Map<string, AvailabilityRow>();
  for (const r of rows) {
    const key = `${r.ipressCode}|${r.medCode}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        ...r,
        code: r.ipressCode,
        name: nameOf?.(r.ipressCode) || names.get(r.ipressCode) || r.ipressCode,
        consumption: [...r.consumption],
        otherOut: r.otherOut && [...r.otherOut],
        outflows: copyOutflows(r.outflows),
      });
    } else {
      g.consumption = g.consumption.map((v, i) => v + (r.consumption[i] || 0));
      g.otherOut = sumSeries(g.otherOut, r.otherOut);
      g.outflows = sumOutflows(g.outflows, r.outflows);
      g.stock += r.stock;
    }
  }
  return [...groups.values()];
};

/** Suma mes a mes dos series (otras salidas); si falta una, queda la otra. */
export const sumSeries = (a?: number[], b?: number[]): number[] | undefined =>
  !a ? b && [...b] : !b ? a : a.map((v, i) => v + (b[i] || 0));

/** Suma, columna por columna, las salidas que no son consumo de dos filas (punto F). */
export const sumOutflows = (a?: Record<string, number[]>, b?: Record<string, number[]>): Record<string, number[]> | undefined => {
  if (!a || !b) return a ? copyOutflows(a) : b && copyOutflows(b);
  const out = copyOutflows(a)!;
  for (const [column, series] of Object.entries(b)) out[column] = sumSeries(out[column], series)!;
  return out;
};
const copyOutflows = (o?: Record<string, number[]>) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));

/** CPA de la ficha 28: consumo ÷ meses con consumo (sin consumo, 0). */
export const averageConsumption = (consumption: number[]): number => {
  const withUse = consumption.filter((v) => v > 0);
  return withUse.length ? withUse.reduce((a, b) => a + b, 0) / withUse.length : 0;
};

/**
 * Fecha del stock: el último día del mes de corte («202609» → 30/09/2026), porque STOCK_FIN es el
 * saldo al cierre del mes. Los meses al vencimiento se cuentan desde aquí y no desde hoy (punto E
 * de la auditoría, 2026-10-09): con un TFORMDET de meses atrás, contar desde hoy le restaba al
 * lote los meses que ya pasaron y lo marcaba en riesgo de más. Sin mes reconocible, `fallback`.
 */
export const cutDateOf = (cut: string | null | undefined, fallback: Date = new Date()): Date => {
  const m = /^(\d{4})(\d{2})$/.exec(String(cut ?? "").trim());
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? new Date(Number(m[1]), month, 0) : fallback;
};

/** Meses enteros entre dos fechas, como DATEDIF(…, "M") de Excel. */
export const wholeMonthsBetween = (from: Date, to: Date): number => {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
};

const byExpiry = (a: Lot, b: Lot) => (a.expiry?.getTime() ?? Infinity) - (b.expiry?.getTime() ?? Infinity);

/**
 * Situación y vencimientos de cada producto. Los lotes se buscan por farmacia y código; una
 * fila de IPRESS toma los de todas sus farmacias, y una fila fusionada (DME) los de todos los
 * códigos que se sumaron en ella.
 */
export interface ClassifyOptions {
  truncate: boolean;
  subMax: number;
  sobreMin: number;
}

export const DEFAULT_CLASSIFY: ClassifyOptions = { truncate: false, subMax: 2, sobreMin: 6 };

/** Situación de un producto con los límites configurados. */
export const classifyAvailability = (stock: number, cpa: number, opts: ClassifyOptions = DEFAULT_CLASSIFY): { months: number; status: StockStatus } => {
  const months = monthsOfStock(stock, cpa);
  const m = opts.truncate ? truncateOneDecimal(months) : months;
  let status: StockStatus;
  if (stock <= 0) status = StockStatus.DESABASTECIDO;
  else if (cpa <= 0) status = StockStatus.SIN_ROTACION;
  else if (m > opts.sobreMin) status = StockStatus.SOBRESTOCK;
  else if (m >= opts.subMax) status = StockStatus.NORMOSTOCK;
  else status = StockStatus.SUBSTOCK;
  return { months: opts.truncate ? m : months, status };
};

export const buildItems = (rows: AvailabilityRow[], lots?: Map<string, Lot[]>, today = new Date(), opts: ClassifyOptions = DEFAULT_CLASSIFY): AvailabilityItem[] => {
  // Lotes por IPRESS, armados una sola vez (recorrerlos por cada fila tardaba demasiado).
  const byIpress = new Map<string, Lot[]>();
  if (lots) {
    for (const [key, list] of lots) {
      const [pre, med] = key.split("|");
      const ipressKey = `${ipressCodeOf(pre)}|${med}`;
      if (ipressKey === key) continue;
      byIpress.set(ipressKey, [...(byIpress.get(ipressKey) || []), ...list]);
    }
  }
  const lotsOf = (code: string, medCode: string) => [...(lots?.get(`${code}|${medCode}`) || []), ...(byIpress.get(`${code}|${medCode}`) || [])];
  return rows.map((r) => {
    const cpa = averageConsumption(r.consumption);
    const { months, status } = classifyAvailability(r.stock, cpa, opts);
    const codes = r.fusedFrom?.length ? r.fusedFrom : [r.medCode];
    const list = lots ? codes.flatMap((med) => lotsOf(r.code, med)).sort(byExpiry) : [];
    const nearestExpiry = list.find((l) => l.expiry)?.expiry ?? null;
    const monthsToExpiry = nearestExpiry ? wholeMonthsBetween(today, nearestExpiry) : null;
    const expiryRisk = monthsToExpiry !== null && Number.isFinite(months) && r.stock > 0 && months > monthsToExpiry;
    return { ...r, cpa, months, status, nearestExpiry, lots: list, monthsToExpiry, expiryRisk };
  });
};

export interface LevelThresholds { optimo: number; alto: number; regular: number }
export const DEFAULT_LEVELS: LevelThresholds = { optimo: 90, alto: 80, regular: 70 };

export const dmeLevelOf = (pct: number, t: LevelThresholds = DEFAULT_LEVELS): DmeLevel =>
  pct >= t.optimo ? "OPTIMO" : pct >= t.alto ? "ALTO" : pct >= t.regular ? "REGULAR" : "BAJO";

export const DME_LEVEL_LABEL: Record<DmeLevel, string> = { OPTIMO: "Óptimo", ALTO: "Alto", REGULAR: "Regular", BAJO: "Bajo" };

const emptyCounts = (): StatusCounts => ({ desabastecido: 0, substock: 0, normostock: 0, sobrestock: 0, sinRotacion: 0, total: 0, available: 0 });

export const DEFAULT_RULE: ScopeRule = { normostock: true, sobrestock: true, substock: false, sinRotacion: "no" };

/** ¿Cuenta como disponible según la regla? Desabastecido nunca. */
export const isAvailable = (item: AvailabilityItem, rule: ScopeRule, vitalCodes?: ReadonlySet<string>) => {
  switch (item.status) {
    case StockStatus.NORMOSTOCK: return rule.normostock;
    case StockStatus.SOBRESTOCK: return rule.sobrestock;
    case StockStatus.SUBSTOCK: return rule.substock;
    case StockStatus.SIN_ROTACION:
      return rule.sinRotacion === "yes" || (rule.sinRotacion === "vital" && (!!vitalCodes?.has(item.medCode) || !!item.fusedFrom?.some((c) => vitalCodes?.has(c))));
    default: return false;
  }
};

const countItems = (items: AvailabilityItem[], rule: ScopeRule, vitalCodes?: ReadonlySet<string>): StatusCounts => {
  const c = emptyCounts();
  for (const it of items) {
    c.total++;
    if (it.status === StockStatus.DESABASTECIDO) c.desabastecido++;
    else if (it.status === StockStatus.SUBSTOCK) c.substock++;
    else if (it.status === StockStatus.NORMOSTOCK) c.normostock++;
    else if (it.status === StockStatus.SOBRESTOCK) c.sobrestock++;
    else c.sinRotacion++;
    if (isAvailable(it, rule, vitalCodes)) c.available++;
  }
  return c;
};

const addCounts = (a: StatusCounts, b: StatusCounts): StatusCounts => ({
  desabastecido: a.desabastecido + b.desabastecido,
  substock: a.substock + b.substock,
  normostock: a.normostock + b.normostock,
  sobrestock: a.sobrestock + b.sobrestock,
  sinRotacion: a.sinRotacion + b.sinRotacion,
  total: a.total + b.total,
  available: a.available + b.available,
});

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export interface SummaryOptions {
  rule: ScopeRule;
  /** Códigos vitales: cuentan si la regla de Sin rotación es «vital». */
  vitalCodes?: ReadonlySet<string>;
  levels: LevelThresholds;
  /** Microred y UNGET: promedio de establecimientos o suma de ítems. */
  aggregate: "average" | "sum";
}

export const DEFAULT_SUMMARY: SummaryOptions = { rule: DEFAULT_RULE, levels: DEFAULT_LEVELS, aggregate: "average" };

const pctOf = (c: StatusCounts) => (c.total ? (c.available / c.total) * 100 : 0);

/**
 * Resúmenes por establecimiento, microred y UNGET. `items` deben ser de nivel IPRESS (una
 * fila por establecimiento y producto): todos los productos, o los de `essentialRows` para la
 * DME.
 */
export const summarize = (items: AvailabilityItem[], opts: SummaryOptions = DEFAULT_SUMMARY): AvailabilityReport => {
  const { rule, vitalCodes, levels, aggregate } = opts;
  const inScope = items;
  const byCode = new Map<string, AvailabilityItem[]>();
  for (const it of inScope) {
    const list = byCode.get(it.code) || [];
    list.push(it);
    byCode.set(it.code, list);
  }
  const establishments: EstablishmentSummary[] = [...byCode.entries()].map(([code, list]) => {
    const counts = countItems(list, rule, vitalCodes);
    const pct = pctOf(counts);
    const first = list[0];
    return { ...counts, code, name: first.name, microred: first.microred || "Sin microred", red: first.red, category: first.category, pct, level: dmeLevelOf(pct, levels) };
  });
  establishments.sort((a, b) => a.microred.localeCompare(b.microred, "es") || a.code.localeCompare(b.code));

  const byMicrored = new Map<string, EstablishmentSummary[]>();
  for (const e of establishments) {
    const list = byMicrored.get(e.microred) || [];
    list.push(e);
    byMicrored.set(e.microred, list);
  }
  const microredes: MicroredSummary[] = [...byMicrored.entries()].map(([microred, list]) => {
    const counts = list.reduce((acc, e) => addCounts(acc, e), emptyCounts());
    const pct = aggregate === "sum" ? pctOf(counts) : average(list.map((e) => e.pct));
    return { microred, establishments: list.length, counts, pct, level: dmeLevelOf(pct, levels) };
  });
  microredes.sort((a, b) => a.microred.localeCompare(b.microred, "es"));

  const counts = establishments.reduce((acc, e) => addCounts(acc, e), emptyCounts());
  const pct = aggregate === "sum" ? pctOf(counts) : average(establishments.map((e) => e.pct));
  return { items: inScope, establishments, microredes, pct, level: dmeLevelOf(pct, levels), counts };
};

/** Código destino de cada código fusionado. */
const buildFusionIndex = (groups: Record<string, { name: string; codes: string[] }>) => {
  const index = new Map<string, string>();
  for (const [target, g] of Object.entries(groups)) for (const code of g.codes) index.set(code, target);
  return index;
};
const DEFAULT_FUSION_INDEX = buildFusionIndex(FUSED_CODE_GROUPS);

/**
 * Filas de la DME (ficha 28): medicamentos (M) que no son de estrategia (EST «S» o «_»), del
 * petitorio (PET «P») o incluidos en el listado de códigos fusionados, con las presentaciones
 * de un mismo grupo sumadas en su código destino, por establecimiento (o farmacia).
 */
export const essentialRows = (
  rows: AvailabilityRow[],
  groups: Record<string, { name: string; codes: string[] }> = FUSED_CODE_GROUPS,
): AvailabilityRow[] => {
  const index = groups === FUSED_CODE_GROUPS ? DEFAULT_FUSION_INDEX : buildFusionIndex(groups);
  const out = new Map<string, AvailabilityRow>();
  for (const r of rows) {
    const target = index.get(r.medCode);
    if (r.medtip !== "M" || !(r.medest === "S" || r.medest === "_") || !(r.medpet === "P" || target)) continue;
    const medCode = target || r.medCode;
    const key = `${r.code}|${medCode}`;
    const g = out.get(key);
    if (!g) {
      out.set(key, {
        ...r,
        medCode,
        description: target && target !== r.medCode ? groups[target].name : r.description,
        medpet: "P",
        consumption: [...r.consumption],
        otherOut: r.otherOut && [...r.otherOut],
        outflows: copyOutflows(r.outflows),
        fusedFrom: target ? [r.medCode] : [],
      });
    } else {
      g.consumption = g.consumption.map((v, i) => v + (r.consumption[i] || 0));
      g.otherOut = sumSeries(g.otherOut, r.otherOut);
      g.outflows = sumOutflows(g.outflows, r.outflows);
      g.stock += r.stock;
      if (target) {
        g.fusedFrom = [...(g.fusedFrom || []), r.medCode];
        if (target !== r.medCode) g.description = groups[target].name;
        else g.description = r.description;
      }
    }
  }
  return [...out.values()];
};

/* ------------------------------------------------------------ TFORMDET de varios meses */

/**
 * Consumo del mes, igual que el reporte de Disponibilidad del Toolkit de escritorio
 * (`disponibilidad_report_manager.py`): VENTA + SIS + INTERSAN + EXO + SOAT + CREDHOSP + OTR_CONV.
 * EXO es lo que se entregó exonerado de pago: es consumo (decisión del usuario del 2026-10-07).
 * REINGRE, DEFNAC y OTRAS_SAL no cuentan.
 */
export const TFORMDET_CONSUMPTION_COLUMNS = ["VENTA", "SIS", "INTERSAN", "EXO", "SOAT", "CREDHOSP", "OTR_CONV"] as const;

/**
 * Salidas del TFORMDET que no son consumo (punto F de la auditoría, 2026-10-09), con su nombre
 * para la pantalla. Distinguen el producto que de verdad no se mueve del que sale por otra vía
 * (lo devuelve, lo distribuye, se vence). Todas restan del stock. FAC_PERD, DEV_VEN y DEV_MERMA
 * no se usan en la operación (el usuario, 2026-10-09) y no se muestran.
 */
export const TFORMDET_OUTFLOWS: ReadonlyArray<{ column: string; label: string }> = [
  { column: "DEVOL", label: "Devoluciones" },
  { column: "DISTRI", label: "Distribución" },
  { column: "TRANSF", label: "Transferencias" },
  { column: "VENCIDO", label: "Vencidos" },
  { column: "MERMA", label: "Merma" },
  { column: "OTRAS_SAL", label: "Otras salidas" },
  { column: "DEFNAC", label: "Defensa nacional" },
  { column: "VENTAINST", label: "Venta institucional" },
];
// SAL_CONINS, SAL_REGULA e ING_REGULA no van: son columnas informativas que no restan del stock
// (comprobado el 2026-10-09: en las 196 866 filas de un TFORMDET de 12 meses, STOCK_FIN = SALDO +
// INGRE + REINGRE − consumo − estas salidas, sin ellas). Sumarlas contaría dos veces.

export interface EstablishmentInfo {
  name?: string;
  /** Tipo del registro de Establecimientos (PUESTO_COMUNAL, FARMACIA…). */
  type?: string;
  microred?: string;
  red?: string;
  category?: string;
}

/** Stock de un almacén (030S05…) por producto al cierre del último mes del TFORMDET. */
export interface WarehouseItem {
  code: string;
  name: string;
  medCode: string;
  description: string;
  price: number;
  stock: number;
  /** Lotes con saldo, del vencimiento más próximo al más lejano. */
  lots: Lot[];
}

export interface ParsedTformdet extends ParsedAvailability {
  /** Stock de los almacenes (códigos que no son establecimientos) al cierre del último mes. */
  warehouse: WarehouseItem[];
  /** Lotes con saldo del último mes, para el vencimiento más próximo. */
  lots: Map<string, Lot[]>;
  /** ¿Trae MEDTIP/MEDPET/MEDEST? (consulta TFORMDET del Toolkit 2.2.5 o posterior). */
  hasClassification: boolean;
  /** Códigos que no son establecimientos (almacenes como 030S05) y se dejaron fuera. */
  skippedCodes: string[];
  /** Columnas de salidas que no son consumo que trae el archivo. Falta en lo guardado antes del punto F. */
  outflowColumns?: string[];
}

/** Código de establecimiento o de farmacia: `06503`, `06502F01`. Los almacenes (`030S05`) no. */
export const isEstablishmentCode = (code: string) => /^\d{5}(F\d{2})?$/i.test(code.trim());

/** Registros del TFORMDET de un mes tal como vienen, para revisarlos en el Excel. */
export interface TformdetMonthSheet {
  /** AAAAMM, si el archivo trae ANNOMES. */
  month?: string;
  header: string[];
  rows: unknown[][];
}

/**
 * Del TFORMDET (uno o varios meses) se queda con los registros del último mes, con todas sus
 * columnas: lotes, registro sanitario, ingresos, consumos por tipo, stock. Los almacenes
 * (030S05) se dejan fuera, como en el cálculo. Devuelve null si no es un TFORMDET.
 */
export const tformdetLastMonth = (sheet: unknown[][]): TformdetMonthSheet | null => {
  const headerIdx = sheet.slice(0, 15).findIndex((row) => {
    const cells = (row || []).map(normHeader);
    return cells.includes("CODIGO PRE") && cells.includes("CODIGO MED");
  });
  if (headerIdx < 0) return null;
  const rawHeader = sheet[headerIdx].map((c) => text(c));
  const header = rawHeader.map(normHeader);
  const cMonth = header.indexOf("ANNOMES") >= 0 ? header.indexOf("ANNOMES") : header.indexOf("ANOMES");
  const cPre = header.indexOf("CODIGO PRE"), cMed = header.indexOf("CODIGO MED");
  const body = sheet.slice(headerIdx + 1).filter((r) => r && r.length && isEstablishmentCode(padCode(r[cPre])));
  let month: string | undefined;
  if (cMonth >= 0) {
    for (const r of body) {
      const m = text(r[cMonth]);
      if (/^\d{6}$/.test(m) && (!month || m > month)) month = m;
    }
  }
  const rows = month ? body.filter((r) => text(r[cMonth]) === month) : body;
  // Sin la columna ANNOMES: en esta hoja todo es del mismo mes.
  const keep = rawHeader.map((_, i) => i).filter((i) => i !== cMonth && rawHeader[i] !== "");
  return {
    month,
    header: keep.map((i) => rawHeader[i]),
    rows: rows.map((r) => keep.map((i) => (i === cPre || i === cMed ? padCode(r[i]) : r[i] ?? null))),
  };
};

/**
 * Lee la consulta TFORMDET del Toolkit (uno o varios meses, columna ANNOMES) y arma una fila por
 * farmacia y producto: el consumo de cada mes, el stock al cierre del último mes y los lotes
 * con saldo de ese mes. `fallbackMonth` es el mes de un TFORMDET de un solo periodo, que no
 * trae ANNOMES (se toma del nombre del archivo).
 */
export const parseTformdetHistory = (
  sheet: unknown[][],
  options: { fallbackMonth?: string; info?: (code: string) => EstablishmentInfo | undefined } = {},
): ParsedTformdet => {
  const headerIdx = sheet.slice(0, 15).findIndex((row) => {
    const cells = (row || []).map(normHeader);
    return cells.includes("CODIGO PRE") && cells.includes("CODIGO MED") && cells.includes("STOCK FIN");
  });
  if (headerIdx < 0) throw new Error("No se encontraron las columnas CODIGO_PRE, CODIGO_MED y STOCK_FIN. Revise que sea la consulta TFORMDET.");
  const header = sheet[headerIdx].map(normHeader);
  const at = (name: string) => header.indexOf(name);
  const cMonth = at("ANNOMES") >= 0 ? at("ANNOMES") : at("ANOMES");
  const cPre = at("CODIGO PRE"), cMed = at("CODIGO MED"), cStock = at("STOCK FIN");
  const cName = at("EESS"), cDesc = at("DESCRIPCION MED"), cPrice = at("PRECIO");
  const cLot = at("MEDLOTE"), cExp = at("FEC EXP");
  const cTip = at("MEDTIP"), cPet = at("MEDPET"), cEst = at("MEDEST"), cFf = at("MEDFF");
  const cCons = TFORMDET_CONSUMPTION_COLUMNS.map((c) => at(normHeader(c)));
  const cOther = at("OTRAS SAL");
  const cOut = TFORMDET_OUTFLOWS.map(({ column }) => ({ column, index: at(normHeader(column)) })).filter((c) => c.index >= 0);
  if (cMonth < 0 && !options.fallbackMonth) {
    throw new Error("El TFORMDET no trae la columna ANNOMES y no se pudo saber de qué mes es. Descárguelo con un rango de meses en el Toolkit.");
  }

  interface Acc {
    row: Omit<AvailabilityRow, "consumption" | "stock">;
    consumption: Map<string, number>;
    otherOut: Map<string, number>;
    outflows: Map<string, Map<string, number>>;
    stock: Map<string, number>;
    price: Map<string, number>;
  }
  const groups = new Map<string, Acc>();
  const monthSet = new Set<string>();
  const skipped = new Set<string>();
  const lotRows: Array<{ month: string; key: string; lot: Lot }> = [];
  const warehouseRows: Array<{ month: string; raw: unknown[]; code: string; medCode: string }> = [];

  for (const raw of sheet.slice(headerIdx + 1)) {
    if (!raw) continue;
    const code = padCode(raw[cPre]);
    const medCode = padCode(raw[cMed]);
    if (!code || !medCode) continue;
    const month = cMonth >= 0 ? (monthKey(raw[cMonth]) || text(raw[cMonth])) : options.fallbackMonth!;
    if (!isEstablishmentCode(code)) {
      // El almacén no entra en la disponibilidad, pero su stock sirve para ver si puede cubrir.
      skipped.add(code);
      warehouseRows.push({ month, raw, code, medCode });
      continue;
    }
    monthSet.add(month);
    const key = `${code}|${medCode}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        row: {
          red: "", microred: "", code, ipressCode: ipressCodeOf(code), name: text(raw[cName]), category: "",
          medCode, description: text(raw[cDesc]), form: cFf >= 0 ? text(raw[cFf]) : "", price: 0,
          medtip: cTip >= 0 ? text(raw[cTip]).toUpperCase() : "",
          medpet: cPet >= 0 ? text(raw[cPet]).toUpperCase() : "",
          medest: cEst >= 0 ? text(raw[cEst]).toUpperCase() : "",
        },
        consumption: new Map(), otherOut: new Map(), outflows: new Map(), stock: new Map(), price: new Map(),
      };
      groups.set(key, g);
    }
    const used = cCons.reduce((sum, i) => sum + (i >= 0 ? Math.max(0, toNumber(raw[i])) : 0), 0);
    g.consumption.set(month, (g.consumption.get(month) || 0) + used);
    if (cOther >= 0) g.otherOut.set(month, (g.otherOut.get(month) || 0) + Math.max(0, toNumber(raw[cOther])));
    for (const { column, index } of cOut) {
      const v = Math.max(0, toNumber(raw[index]));
      if (!v) continue;
      const byMonth = g.outflows.get(column) || new Map<string, number>();
      byMonth.set(month, (byMonth.get(month) || 0) + v);
      g.outflows.set(column, byMonth);
    }
    const stock = Math.max(0, toNumber(raw[cStock]));
    g.stock.set(month, (g.stock.get(month) || 0) + stock);
    if (cPrice >= 0) g.price.set(month, toNumber(raw[cPrice]));
    if (stock > 0 && cLot >= 0) lotRows.push({ month, key, lot: { lot: text(raw[cLot]), expiry: cExp >= 0 ? parseExpiry(raw[cExp]) : null, balance: stock, site: code } });
  }
  if (!groups.size) throw new Error("El TFORMDET no trae productos de establecimientos.");

  const months = [...monthSet].sort();
  const last = months[months.length - 1];
  const rows: AvailabilityRow[] = [];
  for (const g of groups.values()) {
    const consumption = months.map((m) => g.consumption.get(m) || 0);
    const stock = g.stock.get(last) || 0;
    // Sin stock al corte y sin consumo en todo el periodo: no se evalúa. Así lo deja fuera el
    // archivo de disponibilidad del SISMED (comprobado con agosto 2026 de Bellavista: con esta
    // regla coinciden las 11 444 filas por farmacia, las 8 691 por IPRESS y el 71,68 %).
    if (stock === 0 && consumption.every((c) => c === 0)) continue;
    const info = options.info?.(g.row.ipressCode);
    const priceMonth = [...g.price.keys()].sort().pop();
    rows.push({
      ...g.row,
      name: g.row.code === g.row.ipressCode ? info?.name || g.row.name : g.row.name,
      microred: info?.microred || "",
      red: info?.red || "",
      category: info?.category || "",
      price: priceMonth ? g.price.get(priceMonth) || 0 : 0,
      consumption,
      otherOut: cOther >= 0 ? months.map((m) => g.otherOut.get(m) || 0) : undefined,
      outflows: g.outflows.size ? Object.fromEntries([...g.outflows].map(([column, byMonth]) => [column, months.map((m) => byMonth.get(m) || 0)])) : undefined,
      stock,
    });
  }

  const lots = new Map<string, Lot[]>();
  for (const { month, key, lot } of lotRows) {
    if (month !== last) continue;
    const list = lots.get(key) || [];
    list.push(lot);
    lots.set(key, list);
  }
  for (const list of lots.values()) list.sort(byExpiry);

  // Almacenes: solo el mes de corte, sumando los lotes de cada producto.
  const whMap = new Map<string, WarehouseItem>();
  for (const { month, raw, code, medCode } of warehouseRows) {
    if (month !== last) continue;
    const stock = Math.max(0, toNumber(raw[cStock]));
    const key = `${code}|${medCode}`;
    let w = whMap.get(key);
    if (!w) {
      w = { code, name: cName >= 0 ? text(raw[cName]) : "", medCode, description: cDesc >= 0 ? text(raw[cDesc]) : "", price: 0, stock: 0, lots: [] };
      whMap.set(key, w);
    }
    w.stock += stock;
    if (cPrice >= 0 && toNumber(raw[cPrice]) > 0) w.price = toNumber(raw[cPrice]);
    if (stock > 0 && cLot >= 0) w.lots.push({ lot: text(raw[cLot]), expiry: cExp >= 0 ? parseExpiry(raw[cExp]) : null, balance: stock });
  }
  const warehouse = [...whMap.values()].filter((w) => w.stock > 0);
  for (const w of warehouse) w.lots.sort(byExpiry);
  warehouse.sort((a, b) => a.code.localeCompare(b.code) || a.description.localeCompare(b.description, "es"));

  return {
    rows,
    months,
    hasPharmacies: rows.some((r) => r.code !== r.ipressCode),
    lots,
    warehouse,
    hasClassification: cTip >= 0 && cPet >= 0 && cEst >= 0,
    skippedCodes: [...skipped].sort(),
    outflowColumns: cOut.map((c) => c.column),
  };
};
