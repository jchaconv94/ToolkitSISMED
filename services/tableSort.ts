/**
 * Orden de las tablas al tocar una cabecera: reglas puras, sin nada visual, para probarlas.
 * La pieza visual y el hook están en `components/ui/kit.tsx` (`useTableSort`,
 * `TableHeaderCell sort`, `SortButton`).
 */

export type SortDir = "asc" | "desc";
export type TableSort<K extends string = string> = { key: K; dir: SortDir } | null;
export type SortValue = string | number | boolean | Date | null | undefined;

const isBlank = (v: SortValue) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && Number.isNaN(v));

const asComparable = (v: SortValue): number | string => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as number | string;
};

/**
 * Compara dos valores de celda: números como números, fechas por su hora, textos en español
 * sin distinguir mayúsculas ni tildes y con los números dentro del texto en orden natural
 * («P.S. 2» antes que «P.S. 10»). Los vacíos no entran aquí: siempre van al final.
 */
export const compareSortValues = (a: SortValue, b: SortValue): number => {
  const va = asComparable(a);
  const vb = asComparable(b);
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
};

/** Filas ordenadas por la columna elegida. Sin orden, quedan como llegaron. Los vacíos, al final. */
export const sortRows = <T, K extends string>(
  rows: T[],
  sort: TableSort<K>,
  getters: Partial<Record<K, (row: T) => SortValue>>,
): T[] => {
  const get = sort ? getters[sort.key] : undefined;
  if (!sort || !get) return rows;
  const mult = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      const blankA = isBlank(a.value);
      const blankB = isBlank(b.value);
      if (blankA || blankB) return blankA === blankB ? a.index - b.index : blankA ? 1 : -1;
      return compareSortValues(a.value, b.value) * mult || a.index - b.index;
    })
    .map((x) => x.row);
};

/**
 * Siguiente orden al tocar una columna: primero en su sentido natural (`firstDir`), luego el
 * contrario y, al tercer toque, sin orden (vuelve al de siempre).
 */
export const nextSort = <K extends string>(current: TableSort<K>, key: K, firstDir: SortDir = "asc"): TableSort<K> => {
  if (!current || current.key !== key) return { key, dir: firstDir };
  if (current.dir === firstDir) return { key, dir: firstDir === "asc" ? "desc" : "asc" };
  return null;
};
