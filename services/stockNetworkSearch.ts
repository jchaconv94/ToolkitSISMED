/**
 * Búsqueda de un producto en todas las hojas de una UNGET.
 *
 * Responde a «¿quién tiene este medicamento y cuánto?» sin obligar a abrir las hojas una
 * por una. El resultado se consolida **por código de farmacia** (`ALMCOD`), no por
 * establecimiento: una IPRESS puede tener varios puestos comunales, cada uno con su propio
 * `ALMCOD` y su propio stock, y juntarlos escondería de quién es cada saldo.
 *
 * La lógica vive aquí, fuera del componente, porque decidir qué stock hay dónde es una
 * regla de negocio: se puede probar sin navegador y no depende de cómo se pinte la tabla.
 */

/** Lectura tolerante de una columna: la hoja las escribe con nombres que varían. */
export const readStockField = (row: any, ...fieldPatterns: string[]): string => {
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

/** Texto comparable: sin tildes, sin mayúsculas y sin signos. */
export const normalizeStockText = (value?: string | null): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Saldo como número.
 *
 * La hoja los manda como texto y no siempre con punto decimal: hay coma en algunas
 * columnas de precio y separador de miles en otras. Un `Number()` a secas devolvía `NaN` y
 * el consolidado salía en cero sin que nada avisara.
 */
export const parseStockAmount = (value?: string | number | null): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const texto = String(value ?? "").trim();
  if (!texto) return 0;
  const limpio = texto.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : 0;
};

export interface StockLotDetail {
  lote: string;
  vencimiento: string;
  saldo: number;
  tipoSuministro: string;
  fuenteFinanciamiento: string;
  registroSanitario: string;
  precio: string;
  /** Pestaña de la que salió, para poder abrirla desde el resultado. */
  sourceId: string;
}

export interface StockNetworkRow {
  /** Clave estable de la fila, para React y para saber cuál está desplegada. */
  id: string;
  /** Código de farmacia tal como viene en la hoja (`06505F0101`). */
  almcod: string;
  codigoSismed: string;
  codigoSiga: string;
  producto: string;
  /** Suma de todos los lotes de ese producto en ese código de farmacia. */
  total: number;
  lotes: StockLotDetail[];
}

const leerProducto = (row: any) => readStockField(row, "Nombre", "DESC_ITEM", "DESCRIPCION");
const leerSismed = (row: any) => readStockField(row, "ID_Producto", "ID_PRODUCTO", "COD_SISMED");
const leerSiga = (row: any) => readStockField(row, "CODIGO_SIG", "SIGA", "CODIGO_SIGA");

/**
 * Si una fila responde a lo que se buscó.
 *
 * Se admite buscar por nombre, por código SISMED o por código SIGA. Con varias palabras
 * tienen que aparecer **todas**, en cualquier orden: quien escribe «paracetamol 500» no
 * quiere ver todos los paracetamoles ni todo lo que lleve 500.
 */
export const stockRowMatches = (row: any, term: string): boolean => {
  const buscado = normalizeStockText(term);
  if (!buscado) return false;
  const palabras = buscado.split(" ").filter(Boolean);
  const heno = normalizeStockText(
    `${leerProducto(row)} ${leerSismed(row)} ${leerSiga(row)}`,
  );
  return palabras.every((palabra) => heno.includes(palabra));
};

/**
 * Filas consolidadas que responden a la búsqueda.
 *
 * Se agrupa por código de farmacia + producto, y dentro quedan los lotes, ordenados por
 * vencimiento para que el que caduca antes se lea primero. Las filas salen de mayor a menor
 * saldo: quien busca dónde hay stock quiere ver primero dónde hay más.
 */
export const searchNetworkStock = (
  rows: any[] | null | undefined,
  term: string,
): StockNetworkRow[] => {
  if (!normalizeStockText(term)) return [];

  const porClave = new Map<string, StockNetworkRow>();

  for (const row of rows || []) {
    if (!row || !stockRowMatches(row, term)) continue;

    const almcod = readStockField(row, "ALMCOD", "ALM_COD", "ALM COD").trim().toUpperCase();
    const codigoSismed = leerSismed(row).trim();
    const producto = leerProducto(row).trim();
    const clave = `${almcod}|${codigoSismed || producto}`;

    let fila = porClave.get(clave);
    if (!fila) {
      fila = {
        id: clave,
        almcod,
        codigoSismed,
        codigoSiga: leerSiga(row).trim(),
        producto,
        total: 0,
        lotes: [],
      };
      porClave.set(clave, fila);
    }

    const saldo = parseStockAmount(readStockField(row, "Saldo", "SALDO"));
    fila.total += saldo;
    fila.lotes.push({
      lote: readStockField(row, "Lote", "LOTE").trim(),
      vencimiento: readStockField(row, "Fec_Vencim", "VENCIMIENTO", "FEC_VENCIM").trim(),
      saldo,
      tipoSuministro: readStockField(row, "DESC_TIPSUM", "TIPO_SUMINISTRO", "TIPSUM").trim(),
      fuenteFinanciamiento: readStockField(row, "DESC_FFINAN", "FF", "FFINAN").trim(),
      registroSanitario: readStockField(row, "Reg_Sanitario", "REG_SANITARIO").trim(),
      precio: readStockField(row, "Precio_Det", "PRECIO_COMPRA").trim(),
      sourceId: String(row.sourceId || ""),
    });
  }

  const alFinal = (valor: string) => (valor ? valor : "9999-99-99");
  for (const fila of porClave.values()) {
    fila.lotes.sort((a, b) =>
      ordenarPorVencimiento(alFinal(a.vencimiento), alFinal(b.vencimiento)),
    );
  }

  return Array.from(porClave.values()).sort(
    (a, b) => b.total - a.total || a.producto.localeCompare(b.producto),
  );
};

/**
 * Compara dos vencimientos escritos como texto.
 *
 * La hoja los manda en `d/m/aaaa`, así que compararlos como cadenas pone «31/12/2027»
 * antes que «9/1/2026». Se pasan a `aaaammdd` antes de comparar.
 */
const ordenarPorVencimiento = (a: string, b: string): number => {
  const aComparable = (valor: string): string => {
    const partes = valor.split(/[/\-]/).map((parte) => parte.trim());
    if (partes.length !== 3) return valor;
    const [uno, dos, tres] = partes;
    // `aaaa-mm-dd` ya viene ordenable; `d/m/aaaa` hay que darle la vuelta.
    if (uno.length === 4) return `${uno}${dos.padStart(2, "0")}${tres.padStart(2, "0")}`;
    return `${tres}${dos.padStart(2, "0")}${uno.padStart(2, "0")}`;
  };
  return aComparable(a).localeCompare(aComparable(b));
};

/** Cuántos establecimientos distintos aparecen en un resultado. */
export const countPharmaciesInResults = (rows: StockNetworkRow[] | null | undefined): number =>
  new Set((rows || []).map((fila) => fila.almcod).filter(Boolean)).size;
