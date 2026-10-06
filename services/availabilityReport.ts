import { StockStatus } from "../types";
import { classifyStock, type DmeLevel } from "./stockStatus";
import { FUSED_CODE_GROUPS } from "./fusedCodes";

/**
 * Disponibilidad de productos por establecimiento (módulo «Disponibilidad», 2026-10-06).
 *
 * Reproduce el reporte en Excel del usuario («DISPONIBILIDAD DE MED POR IPRESS») con las
 * reglas acordadas:
 *
 * - CPA = consumo de los 12 meses ÷ meses con consumo (ficha 28 de DIGEMID).
 * - Meses de provisión = stock ÷ CPA, **cortados a un decimal** (`classifyStock`, la misma
 *   regla del Análisis de Requerimiento).
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
      });
    } else {
      g.consumption = g.consumption.map((v, i) => v + (r.consumption[i] || 0));
      g.stock += r.stock;
    }
  }
  return [...groups.values()];
};

/** CPA de la ficha 28: consumo ÷ meses con consumo (sin consumo, 0). */
export const averageConsumption = (consumption: number[]): number => {
  const withUse = consumption.filter((v) => v > 0);
  return withUse.length ? withUse.reduce((a, b) => a + b, 0) / withUse.length : 0;
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
export const buildItems = (rows: AvailabilityRow[], lots?: Map<string, Lot[]>, today = new Date()): AvailabilityItem[] => {
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
    const { months, status } = classifyStock(r.stock, cpa);
    const codes = r.fusedFrom?.length ? r.fusedFrom : [r.medCode];
    const list = lots ? codes.flatMap((med) => lotsOf(r.code, med)).sort(byExpiry) : [];
    const nearestExpiry = list.find((l) => l.expiry)?.expiry ?? null;
    const monthsToExpiry = nearestExpiry ? wholeMonthsBetween(today, nearestExpiry) : null;
    const expiryRisk = monthsToExpiry !== null && Number.isFinite(months) && r.stock > 0 && months > monthsToExpiry;
    return { ...r, cpa, months, status, nearestExpiry, lots: list, monthsToExpiry, expiryRisk };
  });
};

export const dmeLevelOf = (pct: number): DmeLevel => (pct >= 90 ? "OPTIMO" : pct >= 80 ? "ALTO" : pct >= 70 ? "REGULAR" : "BAJO");

export const DME_LEVEL_LABEL: Record<DmeLevel, string> = { OPTIMO: "Óptimo", ALTO: "Alto", REGULAR: "Regular", BAJO: "Bajo" };

const emptyCounts = (): StatusCounts => ({ desabastecido: 0, substock: 0, normostock: 0, sobrestock: 0, sinRotacion: 0, total: 0, available: 0 });

/** ¿Cuenta como disponible? Normostock y Sobrestock; Sin rotación solo si es vital. */
const isAvailable = (item: AvailabilityItem, vitalCodes?: ReadonlySet<string>) =>
  item.status === StockStatus.NORMOSTOCK ||
  item.status === StockStatus.SOBRESTOCK ||
  (item.status === StockStatus.SIN_ROTACION && !!vitalCodes?.has(item.medCode));

const countItems = (items: AvailabilityItem[], vitalCodes?: ReadonlySet<string>): StatusCounts => {
  const c = emptyCounts();
  for (const it of items) {
    c.total++;
    if (it.status === StockStatus.DESABASTECIDO) c.desabastecido++;
    else if (it.status === StockStatus.SUBSTOCK) c.substock++;
    else if (it.status === StockStatus.NORMOSTOCK) c.normostock++;
    else if (it.status === StockStatus.SOBRESTOCK) c.sobrestock++;
    else c.sinRotacion++;
    if (isAvailable(it, vitalCodes)) c.available++;
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

/**
 * Resúmenes por establecimiento, microred y UNGET. `items` deben ser de nivel IPRESS (una
 * fila por establecimiento y producto): todos los productos, o los de `essentialRows` para la
 * DME. `vitalCodes` (solo DME): Sin rotación de esos códigos cuenta como disponible.
 */
export const summarize = (items: AvailabilityItem[], vitalCodes?: ReadonlySet<string>): AvailabilityReport => {
  const inScope = items;
  const byCode = new Map<string, AvailabilityItem[]>();
  for (const it of inScope) {
    const list = byCode.get(it.code) || [];
    list.push(it);
    byCode.set(it.code, list);
  }
  const establishments: EstablishmentSummary[] = [...byCode.entries()].map(([code, list]) => {
    const counts = countItems(list, vitalCodes);
    const pct = counts.total ? (counts.available / counts.total) * 100 : 0;
    const first = list[0];
    return { ...counts, code, name: first.name, microred: first.microred, red: first.red, category: first.category, pct, level: dmeLevelOf(pct) };
  });
  establishments.sort((a, b) => a.microred.localeCompare(b.microred, "es") || a.code.localeCompare(b.code));

  const byMicrored = new Map<string, EstablishmentSummary[]>();
  for (const e of establishments) {
    const list = byMicrored.get(e.microred) || [];
    list.push(e);
    byMicrored.set(e.microred, list);
  }
  const microredes: MicroredSummary[] = [...byMicrored.entries()].map(([microred, list]) => {
    const pct = average(list.map((e) => e.pct));
    return { microred, establishments: list.length, counts: list.reduce((acc, e) => addCounts(acc, e), emptyCounts()), pct, level: dmeLevelOf(pct) };
  });
  microredes.sort((a, b) => a.microred.localeCompare(b.microred, "es"));

  const pct = average(establishments.map((e) => e.pct));
  return {
    items: inScope,
    establishments,
    microredes,
    pct,
    level: dmeLevelOf(pct),
    counts: establishments.reduce((acc, e) => addCounts(acc, e), emptyCounts()),
  };
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
        fusedFrom: target ? [r.medCode] : [],
      });
    } else {
      g.consumption = g.consumption.map((v, i) => v + (r.consumption[i] || 0));
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
