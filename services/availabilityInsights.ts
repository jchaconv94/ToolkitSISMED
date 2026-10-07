import { StockStatus } from "../types";
import type { AvailabilityItem, Lot, WarehouseItem } from "./availabilityReport";

/**
 * Reportes de análisis del módulo Disponibilidad (2026-10-07), calculados en el navegador a
 * partir de los mismos ítems del cálculo de disponibilidad (una fila por establecimiento y
 * producto). Nada se guarda.
 *
 * - Riesgo de vencimiento por lote (FEFO): los lotes se consumen del que vence primero al
 *   último, al ritmo del CPA; lo que no alcanza a usarse antes de su fecha está en riesgo.
 * - Consumos irregulares: picos (un mes con 3 veces o más el promedio de los demás) y
 *   variabilidad XYZ por el coeficiente de variación.
 * - Clasificación ABC (valor consumido) cruzada con XYZ.
 * - Sobrestock inmovilizado: unidades por encima de lo que se usa en el límite de sobrestock
 *   (6 meses), valorizadas a su precio.
 * - Redistribución sugerida: de quien tiene excedente a quien está desabastecido o en substock.
 * - Dónde falta: por producto, en cuántos establecimientos falta y quién podría cubrirlo.
 * - Almacén: cuánto de la necesidad de los establecimientos cubre el stock del almacén.
 */

const DAY_MS = 86400000;
const MONTH_DAYS = 30.4375;

/** Meses (con decimales) que faltan para una fecha. Negativo si ya pasó. */
export const monthsUntil = (date: Date, today: Date): number => (date.getTime() - today.getTime()) / (MONTH_DAYS * DAY_MS);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------ Riesgo de vencimiento */

export type ExpiryBucket = "EXPIRED" | "M3" | "M6" | "M12" | "LATER";
export const EXPIRY_BUCKETS: ExpiryBucket[] = ["EXPIRED", "M3", "M6", "M12", "LATER"];
export const EXPIRY_BUCKET_LABEL: Record<ExpiryBucket, string> = {
  EXPIRED: "Vencido",
  M3: "0 a 3 meses",
  M6: "3 a 6 meses",
  M12: "6 a 12 meses",
  LATER: "Más de 12 meses",
};

export const expiryBucketOf = (months: number): ExpiryBucket =>
  months <= 0 ? "EXPIRED" : months <= 3 ? "M3" : months <= 6 ? "M6" : months <= 12 ? "M12" : "LATER";

export interface LotRiskRow {
  item: AvailabilityItem;
  lot: Lot;
  /** Meses hasta el vencimiento del lote (0 si ya venció). */
  monthsToExpiry: number;
  /** Unidades del lote que se alcanzan a usar antes de que venza. */
  usable: number;
  /** Unidades que vencerían sin usarse. */
  atRisk: number;
  value: number;
  bucket: ExpiryBucket;
}

/**
 * Lotes de un ítem en riesgo, consumiéndolos del que vence primero al último (FEFO). Cada lote
 * solo puede usarse hasta su fecha: CPA × meses hasta vencer, menos lo que ya se usó de los
 * lotes anteriores en ese tiempo.
 */
export const lotRiskOf = (item: AvailabilityItem, today: Date): LotRiskRow[] => {
  const lots = item.lots.filter((l) => l.expiry && l.balance > 0).slice().sort((a, b) => a.expiry!.getTime() - b.expiry!.getTime());
  const out: LotRiskRow[] = [];
  let consumed = 0;
  for (const lot of lots) {
    const m = monthsUntil(lot.expiry!, today);
    const capacity = Math.max(0, item.cpa * Math.max(0, m) - consumed);
    const usable = Math.min(lot.balance, capacity);
    consumed += usable;
    const atRisk = Math.round(lot.balance - usable);
    if (atRisk > 0) {
      out.push({ item, lot, monthsToExpiry: Math.max(0, m), usable: Math.round(usable), atRisk, value: atRisk * (item.price || 0), bucket: expiryBucketOf(m) });
    }
  }
  return out;
};

export interface LotRiskReport {
  rows: LotRiskRow[];
  value: number;
  units: number;
  byBucket: Record<ExpiryBucket, { value: number; lots: number }>;
  /** Valor en riesgo dentro de 12 meses (lo que todavía se puede mover). */
  urgentValue: number;
  urgentLots: number;
  /** Lotes de productos que no se consumen en el periodo (CPA 0): todo su saldo está en riesgo. */
  noUseLots: number;
  noUseValue: number;
}

export const lotRiskReport = (items: AvailabilityItem[], today: Date): LotRiskReport => {
  const rows = items.flatMap((it) => lotRiskOf(it, today)).sort((a, b) => b.value - a.value || a.monthsToExpiry - b.monthsToExpiry);
  const byBucket = Object.fromEntries(EXPIRY_BUCKETS.map((b) => [b, { value: 0, lots: 0 }])) as LotRiskReport["byBucket"];
  let urgentValue = 0, urgentLots = 0, noUseLots = 0, noUseValue = 0;
  for (const r of rows) {
    byBucket[r.bucket].value += r.value;
    byBucket[r.bucket].lots++;
    if (r.bucket !== "LATER") { urgentValue += r.value; urgentLots++; }
    if (r.item.cpa <= 0) { noUseLots++; noUseValue += r.value; }
  }
  return { rows, value: sum(rows.map((r) => r.value)), units: sum(rows.map((r) => r.atRisk)), byBucket, urgentValue, urgentLots, noUseLots, noUseValue };
};

/* ------------------------------------------------------------ Consumo: picos y XYZ */

export type Xyz = "X" | "Y" | "Z";

/** Coeficiente de variación del consumo mensual (desviación ÷ promedio). */
export const variationOf = (consumption: number[]): number => {
  const n = consumption.length;
  if (!n) return 0;
  const mean = sum(consumption) / n;
  if (mean <= 0) return 0;
  const sd = Math.sqrt(sum(consumption.map((v) => (v - mean) ** 2)) / n);
  return sd / mean;
};

export const xyzOf = (cv: number, hasUse = true): Xyz => (!hasUse ? "Z" : cv < 0.5 ? "X" : cv <= 1 ? "Y" : "Z");

export const XYZ_LABEL: Record<Xyz, string> = { X: "Estable", Y: "Variable", Z: "Irregular" };

export interface PeakRow {
  item: AvailabilityItem;
  /** Índice del mes del pico. */
  peakIndex: number;
  peak: number;
  /** Promedio de los demás meses. */
  othersAverage: number;
  /** Cuántas veces el pico supera el promedio de los demás meses. */
  ratio: number;
  cv: number;
  xyz: Xyz;
  /** Valor del consumo del mes del pico. */
  value: number;
}

export const PEAK_MIN_UNITS = 20;
export const PEAK_MIN_RATIO = 3;
export const PEAK_MIN_MONTHS = 3;

/** Pico de consumo: un mes con 3 veces o más el promedio de los demás, 20 unidades o más y al menos 3 meses con consumo. */
export const peakOf = (item: AvailabilityItem): PeakRow | null => {
  const c = item.consumption;
  if (c.length < 2) return null;
  const withUse = c.filter((v) => v > 0).length;
  if (withUse < PEAK_MIN_MONTHS) return null;
  let peakIndex = 0;
  c.forEach((v, i) => { if (v > c[peakIndex]) peakIndex = i; });
  const peak = c[peakIndex];
  const others = c.filter((_, i) => i !== peakIndex);
  const othersAverage = sum(others) / others.length;
  const ratio = othersAverage > 0 ? peak / othersAverage : Infinity;
  if (peak < PEAK_MIN_UNITS || ratio < PEAK_MIN_RATIO) return null;
  const cv = variationOf(c);
  return { item, peakIndex, peak, othersAverage, ratio, cv, xyz: xyzOf(cv), value: peak * (item.price || 0) };
};

export interface ConsumptionReport {
  peaks: PeakRow[];
  xyz: Record<Xyz, number>;
  /** Picos por mes, para ver si se concentran en un mes. */
  peaksByMonth: number[];
}

export const consumptionReport = (items: AvailabilityItem[]): ConsumptionReport => {
  const xyz: Record<Xyz, number> = { X: 0, Y: 0, Z: 0 };
  const peaks: PeakRow[] = [];
  const months = items[0]?.consumption.length ?? 0;
  const peaksByMonth = Array(months).fill(0);
  for (const it of items) {
    if (!it.consumption.some((v) => v > 0)) continue;
    xyz[xyzOf(variationOf(it.consumption))]++;
    const p = peakOf(it);
    if (p) { peaks.push(p); peaksByMonth[p.peakIndex]++; }
  }
  peaks.sort((a, b) => b.value - a.value || b.ratio - a.ratio);
  return { peaks, xyz, peaksByMonth };
};

/* ------------------------------------------------------------ ABC × XYZ */

export type Abc = "A" | "B" | "C";

export interface AbcProduct {
  medCode: string;
  description: string;
  /** Valor consumido en el periodo, en soles. */
  value: number;
  units: number;
  /** Consumo mensual sumado de todos los establecimientos. */
  consumption: number[];
  share: number;
  cumulative: number;
  abc: Abc;
  cv: number;
  xyz: Xyz;
  establishments: number;
}

/** ABC por valor consumido (A hasta el 80 % acumulado, B hasta el 95 %), sumando todos los establecimientos. */
export const abcXyzReport = (items: AvailabilityItem[]) => {
  const byMed = new Map<string, AbcProduct>();
  for (const it of items) {
    const units = sum(it.consumption);
    let p = byMed.get(it.medCode);
    if (!p) {
      p = { medCode: it.medCode, description: it.description, value: 0, units: 0, consumption: Array(it.consumption.length).fill(0), share: 0, cumulative: 0, abc: "C", cv: 0, xyz: "Z", establishments: 0 };
      byMed.set(it.medCode, p);
    }
    p.value += units * (it.price || 0);
    p.units += units;
    p.establishments++;
    it.consumption.forEach((v, i) => { p!.consumption[i] = (p!.consumption[i] || 0) + v; });
  }
  const products = [...byMed.values()].filter((p) => p.units > 0).sort((a, b) => b.value - a.value);
  const total = sum(products.map((p) => p.value));
  let acc = 0;
  const counts: Record<Abc, { products: number; value: number }> = { A: { products: 0, value: 0 }, B: { products: 0, value: 0 }, C: { products: 0, value: 0 } };
  const matrix: Record<string, number> = {};
  for (const p of products) {
    p.share = total ? p.value / total : 0;
    // La clase se decide por el acumulado antes de sumar el producto: el que cruza el 80 % sigue siendo A.
    p.abc = acc < 0.8 ? "A" : acc < 0.95 ? "B" : "C";
    acc += p.share;
    p.cumulative = acc;
    p.cv = variationOf(p.consumption);
    p.xyz = xyzOf(p.cv, p.units > 0);
    counts[p.abc].products++;
    counts[p.abc].value += p.value;
    matrix[`${p.abc}${p.xyz}`] = (matrix[`${p.abc}${p.xyz}`] || 0) + 1;
  }
  return { products, total, counts, matrix };
};

/* ------------------------------------------------------------ Sobrestock inmovilizado */

export interface OverstockRow {
  item: AvailabilityItem;
  /** Unidades que necesita para el límite de sobrestock (CPA × meses). */
  needed: number;
  /** Unidades de más. */
  excess: number;
  value: number;
}

/** Sobrestock: lo que supera CPA × límite (6 meses) es excedente; su valor es dinero inmovilizado. */
export const overstockReport = (items: AvailabilityItem[], sobreMin: number) => {
  const rows: OverstockRow[] = [];
  for (const it of items) {
    if (it.status !== StockStatus.SOBRESTOCK) continue;
    const needed = it.cpa * sobreMin;
    const excess = Math.floor(it.stock - needed);
    if (excess <= 0) continue;
    rows.push({ item: it, needed: Math.ceil(needed), excess, value: excess * (it.price || 0) });
  }
  rows.sort((a, b) => b.value - a.value);
  const byEstablishment = new Map<string, { code: string; name: string; microred: string; value: number; items: number }>();
  for (const r of rows) {
    const e = byEstablishment.get(r.item.code) || { code: r.item.code, name: r.item.name, microred: r.item.microred, value: 0, items: 0 };
    e.value += r.value;
    e.items++;
    byEstablishment.set(r.item.code, e);
  }
  return {
    rows,
    value: sum(rows.map((r) => r.value)),
    units: sum(rows.map((r) => r.excess)),
    establishments: [...byEstablishment.values()].sort((a, b) => b.value - a.value),
  };
};

/* ------------------------------------------------------------ Redistribución */

export interface TransferRow {
  from: AvailabilityItem;
  to: AvailabilityItem;
  quantity: number;
  sameMicrored: boolean;
  value: number;
}

/**
 * Sugerencias de redistribución: a cada establecimiento desabastecido o en substock (con
 * consumo) le da el excedente de otro que tenga el mismo producto en sobrestock, prefiriendo
 * la misma microred. Lleva lo justo para llegar al mínimo (CPA × límite de substock).
 */
export const redistributionReport = (items: AvailabilityItem[], subMax: number, sobreMin: number) => {
  const donors = new Map<string, Array<{ item: AvailabilityItem; left: number }>>();
  for (const it of items) {
    if (it.status !== StockStatus.SOBRESTOCK) continue;
    const left = Math.floor(it.stock - it.cpa * sobreMin);
    if (left <= 0) continue;
    const list = donors.get(it.medCode) || [];
    list.push({ item: it, left });
    donors.set(it.medCode, list);
  }
  const needs = items
    .filter((i) => (i.status === StockStatus.DESABASTECIDO || i.status === StockStatus.SUBSTOCK) && i.cpa > 0)
    .sort((a, b) => a.months - b.months || b.cpa - a.cpa);
  const rows: TransferRow[] = [];
  for (const need of needs) {
    const want = Math.ceil(need.cpa * subMax - need.stock);
    if (want <= 0) continue;
    const pool = (donors.get(need.medCode) || []).filter((d) => d.left > 0 && d.item.code !== need.code);
    if (!pool.length) continue;
    pool.sort((a, b) => Number(b.item.microred === need.microred) - Number(a.item.microred === need.microred) || b.left - a.left);
    const donor = pool[0];
    const quantity = Math.min(donor.left, want);
    donor.left -= quantity;
    rows.push({ from: donor.item, to: need, quantity, sameMicrored: donor.item.microred === need.microred, value: quantity * (need.price || 0) });
  }
  rows.sort((a, b) => Number(b.to.status === StockStatus.DESABASTECIDO) - Number(a.to.status === StockStatus.DESABASTECIDO) || b.value - a.value);
  return {
    rows,
    value: sum(rows.map((r) => r.value)),
    sameMicrored: rows.filter((r) => r.sameMicrored).length,
    covered: rows.filter((r) => r.to.status === StockStatus.DESABASTECIDO).length,
  };
};

/* ------------------------------------------------------------ Dónde falta (por producto) */

export interface ProductGap {
  medCode: string;
  description: string;
  establishments: number;
  desabastecido: number;
  substock: number;
  normostock: number;
  sobrestock: number;
  sinRotacion: number;
  /** Porcentaje de establecimientos donde está desabastecido o en substock. */
  gapPct: number;
  /** Establecimientos con excedente que podrían cubrir. */
  donors: number;
  warehouseStock: number;
  items: AvailabilityItem[];
}

export const productGapReport = (items: AvailabilityItem[], warehouse: WarehouseItem[] = []) => {
  const wh = new Map<string, number>();
  for (const w of warehouse) wh.set(w.medCode, (wh.get(w.medCode) || 0) + w.stock);
  const byMed = new Map<string, ProductGap>();
  for (const it of items) {
    let g = byMed.get(it.medCode);
    if (!g) {
      g = { medCode: it.medCode, description: it.description, establishments: 0, desabastecido: 0, substock: 0, normostock: 0, sobrestock: 0, sinRotacion: 0, gapPct: 0, donors: 0, warehouseStock: wh.get(it.medCode) || 0, items: [] };
      byMed.set(it.medCode, g);
    }
    g.establishments++;
    g.items.push(it);
    if (it.status === StockStatus.DESABASTECIDO) g.desabastecido++;
    else if (it.status === StockStatus.SUBSTOCK) g.substock++;
    else if (it.status === StockStatus.NORMOSTOCK) g.normostock++;
    else if (it.status === StockStatus.SOBRESTOCK) { g.sobrestock++; g.donors++; }
    else g.sinRotacion++;
  }
  const products = [...byMed.values()];
  for (const g of products) g.gapPct = g.establishments ? ((g.desabastecido + g.substock) / g.establishments) * 100 : 0;
  products.sort((a, b) => b.desabastecido - a.desabastecido || b.substock - a.substock || a.description.localeCompare(b.description, "es"));
  return products;
};

/* ------------------------------------------------------------ Almacén */

export interface WarehouseRow {
  item: WarehouseItem;
  value: number;
  nearestExpiry: Date | null;
  /** Establecimientos desabastecidos o en substock (con consumo) de ese producto. */
  inNeed: number;
  desabastecido: number;
  /** Unidades que necesitan para llegar al mínimo (CPA × límite de substock). */
  needUnits: number;
  /** Porcentaje de esa necesidad que cubre el almacén (tope 100). */
  coverage: number;
  /** Meses que alcanza el stock del almacén para el consumo de toda la red. */
  networkMonths: number;
}

export const warehouseReport = (warehouse: WarehouseItem[], items: AvailabilityItem[], subMax: number) => {
  const byMed = new Map<string, AvailabilityItem[]>();
  for (const it of items) {
    const list = byMed.get(it.medCode) || [];
    list.push(it);
    byMed.set(it.medCode, list);
  }
  const rows: WarehouseRow[] = warehouse.map((w) => {
    const list = byMed.get(w.medCode) || [];
    const needing = list.filter((i) => (i.status === StockStatus.DESABASTECIDO || i.status === StockStatus.SUBSTOCK) && i.cpa > 0);
    const needUnits = Math.ceil(sum(needing.map((i) => Math.max(0, i.cpa * subMax - i.stock))));
    const networkCpa = sum(list.map((i) => i.cpa));
    return {
      item: w,
      value: w.stock * (w.price || 0),
      nearestExpiry: w.lots.find((l) => l.expiry)?.expiry ?? null,
      inNeed: needing.length,
      desabastecido: needing.filter((i) => i.status === StockStatus.DESABASTECIDO).length,
      needUnits,
      coverage: needUnits > 0 ? Math.min(100, (w.stock / needUnits) * 100) : 0,
      networkMonths: networkCpa > 0 ? w.stock / networkCpa : Infinity,
    };
  });
  rows.sort((a, b) => b.inNeed - a.inNeed || b.value - a.value);
  return {
    rows,
    value: sum(rows.map((r) => r.value)),
    products: rows.length,
    canCover: rows.filter((r) => r.inNeed > 0).length,
    withoutDemand: rows.filter((r) => !byMed.has(r.item.medCode)).length,
  };
};
