import { StockStatus } from "../types";

/**
 * Regla única del estado de stock del Análisis de Requerimiento, según DIGEMID (indicadores de
 * disponibilidad, Ficha N.° 28 de los Convenios de Gestión):
 *
 * | Estado        | Condición                                   |
 * |---------------|---------------------------------------------|
 * | Desabastecido | stock = 0                                   |
 * | Sin rotación  | CPMA = 0 y stock > 0                        |
 * | Substock      | meses de existencia (MED) > 0 y < 2         |
 * | Normostock    | MED ≥ 2 y ≤ 6                               |
 * | Sobrestock    | MED > 6                                     |
 *
 * Los meses se comparan **sin redondear** (decisión del usuario, 2026-10-05): 1,96 meses es
 * Substock aunque en pantalla se lea «2,0». Antes la regla estaba copiada en seis lugares y
 * unos redondeaban y otros no, así que la tabla, el detalle y el PDF daban estados distintos
 * para el mismo producto.
 */

/** Meses de existencia disponible (MED): stock / CPA. Sin consumo y con stock, infinito. */
export const monthsOfStock = (stock: number, cpa: number): number =>
  cpa > 0 ? stock / cpa : stock > 0 ? Infinity : 0;

/** MED redondeado a un decimal, como se muestra en pantalla (no se usa para clasificar). */
export const roundMonths = (months: number): number =>
  Number.isFinite(months) ? Math.round(months * 10) / 10 : months;

export const classifyStock = (stock: number, cpa: number): { months: number; status: StockStatus } => {
  const months = monthsOfStock(stock, cpa);
  let status: StockStatus;
  if (stock <= 0) status = StockStatus.DESABASTECIDO;
  else if (cpa <= 0) status = StockStatus.SIN_ROTACION;
  else if (months > 6) status = StockStatus.SOBRESTOCK;
  else if (months >= 2) status = StockStatus.NORMOSTOCK;
  else status = StockStatus.SUBSTOCK;
  return { months, status };
};

/** ¿Cuenta para el indicador DME? Medicamento (M) del petitorio (P) con MEDEST «_» o «S». */
export const isEssentialMedication = (m: { medtip?: string; medpet?: string; medest?: string }): boolean => {
  const est = (m.medest || "").toUpperCase().trim();
  return (m.medtip || "").toUpperCase().trim() === "M"
    && (m.medpet || "").toUpperCase().trim() === "P"
    && (est === "_" || est === "S");
};

export type DmeLevel = "OPTIMO" | "ALTO" | "REGULAR" | "BAJO";

/**
 * Disponibilidad de medicamentos esenciales: (Normostock + Sobrestock) / esenciales evaluados.
 * Los Sin rotación cuentan en el denominador y no en el numerador.
 */
export const computeDmeIndicators = (items: Array<{ status: StockStatus; medtip?: string; medpet?: string; medest?: string }>) => {
  const essentials = items.filter(isEssentialMedication);
  const totalItems = essentials.length;
  const availableItems = essentials.filter(m => m.status === StockStatus.NORMOSTOCK || m.status === StockStatus.SOBRESTOCK).length;
  const dmeScore = totalItems > 0 ? (availableItems / totalItems) * 100 : 0;
  const status: DmeLevel = dmeScore >= 90 ? "OPTIMO" : dmeScore >= 80 ? "ALTO" : dmeScore >= 70 ? "REGULAR" : "BAJO";
  return { dmeScore, status, totalItems, availableItems };
};
