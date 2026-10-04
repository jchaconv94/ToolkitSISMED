/**
 * Columnas de consumo mensual del Excel de requerimiento.
 *
 * El archivo oficial del SISMED trae `MES01 … MES12`, pero la «Plantilla Estándar» que
 * descargaba el propio sistema traía `MES_1 … MES_12`, y esas no se reconocían: al cargarla,
 * todos los consumos quedaban en 0. Aquí se reconocen las dos formas (y `MES 1`, `Mes-01`…).
 */

/** Nombres de las columnas de meses de la plantilla que descarga el sistema. */
export const TEMPLATE_MONTH_HEADERS = Array.from({ length: 12 }, (_, i) => `MES${String(i + 1).padStart(2, "0")}`);

/**
 * Si la cabecera es «MES» + número de mes (MES01, MES_1, MES 1, Mes-12…), devuelve ese número
 * (1 a 12); si no, null.
 */
export const mesNumberOfHeader = (header: string): number | null => {
  const clean = String(header ?? "").toLowerCase().replace(/[\s _\-.]+/g, "");
  const match = /^mes0?(\d{1,2})$/.exec(clean);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 12 ? n : null;
};

/** La columna del mes `n` (1 a 12) en esta fila, escrita como «MES» + número. */
export const findMesKey = (keys: string[], n: number): string | undefined =>
  keys.find((key) => mesNumberOfHeader(key) === n);
