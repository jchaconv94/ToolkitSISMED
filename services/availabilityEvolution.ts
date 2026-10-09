import { buildItems, summarize, type AvailabilityRow, type ClassifyOptions, type SummaryOptions } from "./availabilityReport";
import type { DmeLevel } from "./stockStatus";

/**
 * Disponibilidad mes a mes (2026-10-09, pendiente anotado el 2026-10-06 a pedido del usuario).
 *
 * Para cada mes del TFORMDET se calcula la disponibilidad como si ese mes fuera el corte:
 * - stock = STOCK_FIN de ese mes (`stockByMonth`);
 * - CPA = consumo de los 12 meses que terminan en ese mes (o los que haya en el archivo antes de
 *   él: `window` dice cuántos se usaron), con la misma regla de la ficha 28;
 * - no se evalúa lo que ese mes no tenía stock ni consumo en su ventana, igual que al corte.
 * Todo lo demás (situaciones que cuentan, niveles, promedio o suma) es la fórmula configurada.
 */

export const EVOLUTION_WINDOW = 12;

export interface EvolutionEntity {
  code: string;
  name: string;
  microred: string;
  /** Porcentaje de cada mes (`null`: ese mes no tenía productos evaluados). */
  pct: Array<number | null>;
}

export interface AvailabilityEvolution {
  months: string[];
  /** Meses de consumo con que se calculó el CPA de cada mes (12 = completo). */
  windows: number[];
  unget: number[];
  levels: DmeLevel[];
  microredes: EvolutionEntity[];
  establishments: EvolutionEntity[];
}

/** Filas de un mes: consumo de su ventana y stock de ese mes; sin stock ni consumo, fuera. */
export const rowsForMonth = (rows: AvailabilityRow[], k: number, window = EVOLUTION_WINDOW): AvailabilityRow[] => {
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

export const availabilityEvolution = (
  rows: AvailabilityRow[],
  months: string[],
  opts: { classify: ClassifyOptions; summary: SummaryOptions; window?: number },
): AvailabilityEvolution => {
  const window = opts.window ?? EVOLUTION_WINDOW;
  const unget: number[] = [];
  const levels: DmeLevel[] = [];
  const windows: number[] = [];
  const mr = new Map<string, EvolutionEntity>();
  const est = new Map<string, EvolutionEntity>();
  const asOf = new Date();
  months.forEach((_, k) => {
    windows.push(Math.min(window, k + 1));
    const report = summarize(buildItems(rowsForMonth(rows, k, window), undefined, asOf, opts.classify), opts.summary);
    unget.push(report.pct);
    levels.push(report.level);
    for (const m of report.microredes) {
      const e = mr.get(m.microred) ?? { code: m.microred, name: m.microred, microred: m.microred, pct: months.map(() => null) };
      e.pct[k] = m.pct;
      mr.set(m.microred, e);
    }
    for (const e of report.establishments) {
      const x = est.get(e.code) ?? { code: e.code, name: e.name, microred: e.microred, pct: months.map(() => null) };
      x.pct[k] = e.pct;
      est.set(e.code, x);
    }
  });
  return { months, windows, unget, levels, microredes: [...mr.values()], establishments: [...est.values()] };
};
