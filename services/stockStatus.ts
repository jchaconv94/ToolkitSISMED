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
 * Los meses se **cortan a un decimal, sin redondear** (decisión del usuario, 2026-10-05), y
 * con ese valor se clasifica y se muestra: 1,96 → 1,9 (Substock: no llega a 2 meses);
 * 2,96 → 2,9; 6,02 → 6,0 (Normostock: así el pedido sugerido, redondeado hacia arriba en
 * unidades, no vuelve Sobrestock al ítem en la vista proyectada). El CPA se muestra igual.
 * Antes la regla estaba copiada en seis lugares y unos redondeaban y otros no, así que la
 * tabla, el detalle y el PDF daban estados distintos para el mismo producto.
 */

/** Meses de existencia disponible (MED): stock / CPA. Sin consumo y con stock, infinito. */
export const monthsOfStock = (stock: number, cpa: number): number =>
  cpa > 0 ? stock / cpa : stock > 0 ? Infinity : 0;

/**
 * Corta a un decimal, sin redondear: 2,96 → 2,9. El pequeño margen evita que un número que
 * en la computadora queda como 2,2999999 se corte a 2,2.
 */
export const truncateOneDecimal = (value: number): number =>
  Number.isFinite(value) ? Math.trunc(value * 10 + (value >= 0 ? 1e-9 : -1e-9)) / 10 : value;

/** Meses o CPA para mostrar: un decimal cortado; infinito (sin consumo) como «-». */
export const formatOneDecimal = (value: number | null | undefined): string => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? truncateOneDecimal(n).toFixed(1) : "-";
};

export const classifyStock = (stock: number, cpa: number): { months: number; status: StockStatus } => {
  const months = monthsOfStock(stock, cpa);
  const cut = truncateOneDecimal(months);
  let status: StockStatus;
  if (stock <= 0) status = StockStatus.DESABASTECIDO;
  else if (cpa <= 0) status = StockStatus.SIN_ROTACION;
  else if (cut > 6) status = StockStatus.SOBRESTOCK;
  else if (cut >= 2) status = StockStatus.NORMOSTOCK;
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

/** Columnas de la Matriz cuyo filtro agrupa por el valor cortado a un decimal. */
const ONE_DECIMAL_FILTER_KEYS = new Set(["cpm", "rawCpm", "monthsOfProvision"]);

/**
 * Valor con que una fila aparece en el filtro de una columna de la Matriz de Requerimiento. Los
 * meses y el CPA se agrupan por su valor cortado a un decimal (antes salían 10,333333…).
 */
export const analysisFilterValue = (item: Record<string, unknown>, key: string): string => {
  if (key === "isSporadic") return item.isSporadic ? "Baja Rotación" : "Rotación Normal";
  const value = item[key];
  if (ONE_DECIMAL_FILTER_KEYS.has(key)) {
    return value === undefined || value === null || value === "" ? "-" : formatOneDecimal(Number(value));
  }
  return String(value || "-");
};
