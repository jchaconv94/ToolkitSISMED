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
 * Los meses se comparan **redondeados a un decimal**, que es como se muestran en pantalla, en el
 * detalle, en el PDF y en el Excel. Antes la regla estaba copiada en seis lugares y unos
 * redondeaban y otros no: con stock 59 y CPA 30 (1,967 meses) la tabla decía Substock y el
 * detalle y el PDF Normostock; y el propio pedido sugerido (CPA × 6, redondeado hacia arriba)
 * dejaba el ítem en 6,02 meses y la vista proyectada lo marcaba Sobrestock.
 */

/** Meses de existencia disponible (MED): stock / CPA. Sin consumo y con stock, infinito. */
export const monthsOfStock = (stock: number, cpa: number): number =>
  cpa > 0 ? stock / cpa : stock > 0 ? Infinity : 0;

/** MED redondeado a un decimal, el valor con que se compara y se muestra. */
export const roundMonths = (months: number): number =>
  Number.isFinite(months) ? Math.round(months * 10) / 10 : months;

export const classifyStock = (stock: number, cpa: number): { months: number; status: StockStatus } => {
  const months = monthsOfStock(stock, cpa);
  const rounded = roundMonths(months);
  let status: StockStatus;
  if (stock <= 0) status = StockStatus.DESABASTECIDO;
  else if (cpa <= 0) status = StockStatus.SIN_ROTACION;
  else if (rounded > 6) status = StockStatus.SOBRESTOCK;
  else if (rounded >= 2) status = StockStatus.NORMOSTOCK;
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
