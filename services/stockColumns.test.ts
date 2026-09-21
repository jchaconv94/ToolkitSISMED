import { describe, it, expect } from "vitest";
import {
  DEFAULT_STOCK_COLUMN_KEYS,
  hasCustomStockColumns,
  isDefaultStockColumnSet,
  STOCK_COLUMNS,
} from "./stockColumns";

describe("STOCK_COLUMNS", () => {
  it("no repite claves", () => {
    const claves = STOCK_COLUMNS.map((c) => c.key);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("cada columna se reconoce al menos por su propia clave", () => {
    // Los encabezados llegan tal como los escribió quien hizo la hoja, así que una columna
    // se busca por varios nombres; el suyo propio tiene que estar entre ellos.
    for (const columna of STOCK_COLUMNS) {
      expect(columna.aliases).toContain(columna.key);
    }
  });

  it("están las diecisiete columnas que publica la hoja", () => {
    // El encabezado real de una hoja SISMED. TIPSUM y FFINAN no llevan casilla propia: sus
    // códigos ya se muestran dentro de «Tipo de suministro» y «Fuente financiamiento».
    expect(STOCK_COLUMNS.map((c) => c.key)).toEqual([
      "ALMCOD",
      "DESC_ALM",
      "Id_Producto",
      "CODIGO_SIG",
      "Nombre",
      "Lote",
      "Fec_Vencim",
      "Reg_Sanitario",
      "DESC_TIPSUM",
      "DESC_FFINAN",
      "Saldo",
      "Precio_Det",
      "Precio_Cab",
      "FECHA_DEL_EQUIPO",
      "ULTIMA_ACTUALIZACION",
    ]);
  });

  it("las fechas se reconocen tal como vienen escritas en la hoja", () => {
    // El encabezado llega con espacios («FECHA DEL EQUIPO») y la tilde de «ACTUALIZACIÓN»
    // aparece o no según quién hiciera la hoja. Si un alias falla, la columna sale vacía
    // sin que nada avise.
    const equipo = STOCK_COLUMNS.find((c) => c.key === "FECHA_DEL_EQUIPO");
    expect(equipo?.aliases).toContain("FECHA DEL EQUIPO");
    const actualizacion = STOCK_COLUMNS.find((c) => c.key === "ULTIMA_ACTUALIZACION");
    expect(actualizacion?.aliases).toEqual(
      expect.arrayContaining(["ULTIMA ACTUALIZACION", "ULTIMA ACTUALIZACIÓN"]),
    );
  });

  it("las dos columnas nuevas no se activan solas", () => {
    // Son datos de control, no de stock: quien las quiera, las marca.
    expect(DEFAULT_STOCK_COLUMN_KEYS).not.toContain("FECHA_DEL_EQUIPO");
    expect(DEFAULT_STOCK_COLUMN_KEYS).not.toContain("ULTIMA_ACTUALIZACION");
  });

  it("las de omisión son las que trae marcadas el catálogo", () => {
    expect(DEFAULT_STOCK_COLUMN_KEYS).toEqual([
      "DESC_ALM",
      "Id_Producto",
      "CODIGO_SIG",
      "Nombre",
      "Lote",
      "Fec_Vencim",
      "Reg_Sanitario",
      "DESC_TIPSUM",
      "DESC_FFINAN",
      "Saldo",
    ]);
  });
});

describe("isDefaultStockColumnSet", () => {
  it("reconoce el conjunto de omisión sin importar el orden", () => {
    expect(isDefaultStockColumnSet(DEFAULT_STOCK_COLUMN_KEYS)).toBe(true);
    expect(isDefaultStockColumnSet([...DEFAULT_STOCK_COLUMN_KEYS].reverse())).toBe(true);
  });

  it("una columna de más o de menos ya son columnas propias", () => {
    expect(isDefaultStockColumnSet([...DEFAULT_STOCK_COLUMN_KEYS, "ALMCOD"])).toBe(false);
    expect(isDefaultStockColumnSet(DEFAULT_STOCK_COLUMN_KEYS.slice(1))).toBe(false);
  });

  it("una lista vacía o ausente no es el conjunto de omisión", () => {
    expect(isDefaultStockColumnSet([])).toBe(false);
    expect(isDefaultStockColumnSet(null)).toBe(false);
  });
});

describe("hasCustomStockColumns", () => {
  it("solo es cierto cuando se eligió algo distinto", () => {
    expect(hasCustomStockColumns([...DEFAULT_STOCK_COLUMN_KEYS, "ALMCOD"])).toBe(true);
    expect(hasCustomStockColumns(DEFAULT_STOCK_COLUMN_KEYS)).toBe(false);
  });

  it("una fila sin columnas guardadas NO tiene columnas propias", () => {
    // Es la diferencia con `isDefaultStockColumnSet`: al leer el stock, una lista vacía
    // recurre a las de omisión, así que ese establecimiento ve lo mismo que cualquier otro
    // y marcarlo en el desplegable sería mentir.
    expect(hasCustomStockColumns([])).toBe(false);
    expect(hasCustomStockColumns(null)).toBe(false);
    expect(hasCustomStockColumns(undefined)).toBe(false);
  });
});
