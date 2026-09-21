/**
 * Catálogo único de las columnas de stock de SISMED.
 *
 * Es la lista de columnas que llegan de la hoja de Google Sheets (`SIGData`), la que el
 * administrador marca en «Columnas de Stock» y la que «Stock SISMED» pinta para el
 * establecimiento. Las tres son la misma lista, y hasta ahora estaban escritas tres veces:
 * `AVAILABLE_COLUMNS` era idéntica carácter por carácter en `AdminStockAssignmentModule` y
 * en `AdminOrganizationModule`, y `STOCK_COLUMNS` repetía el catálogo en
 * `AssignedIpressStockModule` con los alias añadidos y las etiquetas en otra
 * capitalización. Agregar una columna obligaba a acordarse de los tres sitios, y las
 * etiquetas ya habían empezado a divergir.
 *
 * Los alias existen porque el encabezado llega tal como lo escribió quien hizo la hoja:
 * `Id_Producto`, `ID_Producto`, `medcod`… Por eso una columna se reconoce por varios
 * nombres y no solo por su clave.
 */

export interface StockColumn {
  /** Clave con la que se guarda en `facility_stock_assignments.visible_columns`. */
  key: string;
  label: string;
  /** Nombres con los que esa columna puede venir escrita en la hoja. */
  aliases: string[];
  /** Si se muestra cuando el establecimiento no tiene columnas propias elegidas. */
  defaultState: boolean;
  numeric?: boolean;
  currency?: boolean;
}

export const STOCK_COLUMNS: StockColumn[] = [
  { key: "ALMCOD", label: "Código almacén", aliases: ["ALMCOD", "almcod"], defaultState: false },
  { key: "DESC_ALM", label: "Almacén", aliases: ["DESC_ALM", "desc_alm"], defaultState: true },
  { key: "Id_Producto", label: "Código SISMED", aliases: ["Id_Producto", "ID_Producto", "id_producto", "medcod"], defaultState: true },
  { key: "CODIGO_SIG", label: "Código SIGA", aliases: ["CODIGO_SIG", "codigo_sig"], defaultState: true },
  { key: "Nombre", label: "Descripción / Nombre", aliases: ["Nombre", "NOMBRE", "xnom"], defaultState: true },
  { key: "Lote", label: "Lote", aliases: ["Lote", "LOTE", "lote"], defaultState: true },
  { key: "Fec_Vencim", label: "Fec. vencimiento", aliases: ["Fec_Vencim", "FEC_VENCIM", "fecha"], defaultState: true },
  { key: "Reg_Sanitario", label: "Reg. sanitario", aliases: ["Reg_Sanitario", "REG_SANITARIO", "medregsan"], defaultState: true },
  { key: "DESC_TIPSUM", label: "Tipo de suministro", aliases: ["DESC_TIPSUM", "tipsum_des", "TIPSUM"], defaultState: true },
  { key: "DESC_FFINAN", label: "Fuente financiamiento", aliases: ["DESC_FFINAN", "ffinan_des", "FFINAN"], defaultState: true },
  { key: "Saldo", label: "Stock / Saldo", aliases: ["Saldo", "SALDO", "saldo"], defaultState: true, numeric: true },
  { key: "Precio_Det", label: "Precio detalle", aliases: ["Precio_Det", "PRECIO_DET", "precio_det"], defaultState: false, numeric: true, currency: true },
  { key: "Precio_Cab", label: "Precio paquete", aliases: ["Precio_Cab", "PRECIO_CAB", "preciocab"], defaultState: false, numeric: true, currency: true },
];

/** Las que ve un establecimiento que no tiene columnas propias elegidas. */
export const DEFAULT_STOCK_COLUMN_KEYS = STOCK_COLUMNS.filter((c) => c.defaultState).map((c) => c.key);

/**
 * Si un conjunto de columnas es exactamente el de omisión.
 *
 * Sirve para no crear una fila en `facility_stock_assignments` que no diga nada, y para
 * marcar en pantalla los establecimientos que sí eligieron algo distinto.
 */
export const isDefaultStockColumnSet = (keys: string[] | null | undefined): boolean => {
  const elegidas = new Set(keys || []);
  return (
    elegidas.size === DEFAULT_STOCK_COLUMN_KEYS.length &&
    DEFAULT_STOCK_COLUMN_KEYS.every((key) => elegidas.has(key))
  );
};

/**
 * Si un establecimiento eligió columnas distintas de las de omisión.
 *
 * Una lista **vacía no cuenta**: `AssignedIpressStockModule` recurre a las de omisión
 * cuando la fila no trae columnas, así que ese establecimiento ve lo mismo que cualquier
 * otro y marcarlo como «columnas propias» sería mentir.
 */
export const hasCustomStockColumns = (keys: string[] | null | undefined): boolean =>
  !!keys?.length && !isDefaultStockColumnSet(keys);
