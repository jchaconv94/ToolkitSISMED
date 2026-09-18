/**
 * Normalización de una fila de stock leída de Google Sheets.
 *
 * Vive fuera de `SheetSearchModule` porque la captura en segundo plano
 * (`scripts/backgroundStockSync.ts`) tiene que construir exactamente la misma fila que la
 * aplicación: si el proceso automático agrupara los medicamentos de otra forma, cada
 * ejecución compararía contra una foto distinta y el historial mostraría movimientos que
 * no ocurrieron.
 */

/** Valor de una columna admitiendo variantes de nombre (mayúsculas, guiones, acentos). */
export const getRowFieldValue = (row: any, ...fieldPatterns: string[]): string => {
  if (!row || typeof row !== "object") return "";
  for (const pattern of fieldPatterns) {
    if (row[pattern]) return String(row[pattern]);
  }
  const keys = Object.keys(row);
  for (const pattern of fieldPatterns) {
    const patNorm = pattern.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matchingKey = keys.find((k) => k.toUpperCase().replace(/[^A-Z0-9]/g, "") === patNorm);
    if (matchingKey && row[matchingKey]) return String(row[matchingKey]);
  }
  return "";
};

export const formatDate = (dateValue: any): string => {
  if (!dateValue) return "";
  const str = String(dateValue).trim();
  
  // Si ya tiene formato D/M/YYYY, DD/M/YYYY, D/MM/YYYY o DD/MM/YYYY
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    return `${day}/${month}/${year}`;
  }
  
  try {
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (e) {}
  return str;
};

/**
 * Fila de stock lista para comparar: conserva las columnas de la hoja y añade las claves
 * que usan el historial y la tabla (código, nombre y fechas en DD/MM/YYYY).
 */
export const normalizeRowData = (
  row: any,
  lastUpdateStr: string,
  equipmentDateStr: string,
  uniqueSourceId: string,
) => {
  if (!row || typeof row !== "object") return null;

  const idVal =
    getRowFieldValue(
      row,
      "ID_Producto",
      "ID_PRODUCTO",
      "CODIGO_SIG",
      "CODIGO",
      "COD_SISMED",
      "ID",
      "COD_MED",
      "COD_PROD",
    ) || row.ID_Producto || "";

  const nameVal =
    getRowFieldValue(
      row,
      "Nombre",
      "NOMBRE",
      "DESCRIPCION",
      "PRODUCTO",
      "MEDICAMENTO",
      "DENOMINACION",
      "NOMBRE_PRODUCTO",
      "DESC_PRODUCTO",
      "MEDICAMENTO_INSUMO",
      "DESC_ALM",
    ) || row.Nombre || "";

  const rawUltima =
    getRowFieldValue(
      row,
      "ULTIMA_ACTUALIZACION",
      "ULTIMA ACTUALIZACION",
      "Ultima_Actualizacion",
    ) || lastUpdateStr;
  const rawEquipo =
    getRowFieldValue(
      row,
      "FECHA_DEL_EQUIPO",
      "FECHA DEL EQUIPO",
      "Fecha_Del_Equipo",
    ) || equipmentDateStr;
  const fecVencim = getRowFieldValue(
    row,
    "Fec_Vencim",
    "FEC_VENCIM",
    "FECHA_VENCIMIENTO",
    "FECHA_VENCIM",
  );

  const hasKeys = Object.keys(row).length > 0;
  if (!hasKeys) return null;

  const hasContent =
    idVal ||
    nameVal ||
    row.Saldo !== undefined ||
    row.SALDO !== undefined ||
    row.Stock !== undefined ||
    Object.values(row).some(
      (v) => v !== undefined && v !== null && String(v).trim() !== "",
    );

  if (!hasContent) return null;

  return {
    ...row,
    ID_Producto: idVal,
    Nombre: nameVal,
    Fec_Vencim: formatDate(fecVencim || row.Fec_Vencim),
    Ultima_Actualizacion: formatDate(rawUltima),
    FECHA_DEL_EQUIPO: formatDate(rawEquipo),
    sourceId: uniqueSourceId,
  };
};

/** Fechas de cabecera de la hoja: la primera fila las repite en todas las filas. */
export const readSheetHeadDates = (
  rows: any[],
): { lastUpdate: string; equipmentDate: string } => {
  const firstRow = (Array.isArray(rows) ? rows[0] : null) || {};
  return {
    lastUpdate: getRowFieldValue(
      firstRow,
      "ULTIMA ACTUALIZACION",
      "ULTIMA_ACTUALIZACION",
      "ULTIMA ACTUALIZACIÓN",
      "Ultima_Actualizacion",
    ),
    equipmentDate: getRowFieldValue(
      firstRow,
      "FECHA DEL EQUIPO",
      "FECHA_DEL_EQUIPO",
      "Fecha_Del_Equipo",
    ),
  };
};

/**
 * Filas de una hoja listas para usar: descarta las vacías y devuelve también las fechas
 * de cabecera. Es el único camino que deben usar la aplicación y la captura automática.
 */
export const normalizeSheetRows = (
  rows: any[],
  uniqueSourceId: string,
): { rows: any[]; lastUpdate: string; equipmentDate: string } => {
  const list = Array.isArray(rows) ? rows : [];
  const { lastUpdate, equipmentDate } = readSheetHeadDates(list);
  return {
    rows: list
      .map((row) => normalizeRowData(row, lastUpdate, equipmentDate, uniqueSourceId))
      .filter((row): row is Record<string, any> => row !== null),
    lastUpdate,
    equipmentDate,
  };
};
