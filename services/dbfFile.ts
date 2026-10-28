/**
 * Lector de tablas DBF del SISMED (dBase III / FoxPro) en el navegador, sin librerías.
 *
 * El SISMED guarda sus datos en archivos `.DBF` de la carpeta `DATOS` (TMOVIM, TMOVIMDET,
 * TFORMDET…). Revisión de guías los lee directo de esa carpeta o de los archivos subidos, en
 * este equipo: nada sale a internet.
 *
 * Formato: cabecera de 32 bytes (cantidad de registros en 4, largo de la cabecera en 8, largo
 * de cada registro en 10), un descriptor de 32 bytes por campo hasta el byte 0x0D y luego los
 * registros de largo fijo; el primer byte de cada registro es `*` si está borrado. El texto va
 * en Windows-1252 (página de códigos 0x03 del SISMED).
 *
 * Solo se decodifican los campos que se piden y se puede descartar un registro antes de
 * decodificarlo entero (`where`): un TFORMDET de varios meses pesa cientos de MB y solo
 * interesa un mes.
 */

export interface DbfField {
  name: string;
  type: string;
  /** Posición dentro del registro (el byte 0 es la marca de borrado). */
  offset: number;
  length: number;
  decimals: number;
}

export interface DbfTable {
  fields: DbfField[];
  /** Registros que se pueden leer (sin pasar del final del archivo). */
  recordCount: number;
  headerLength: number;
  recordLength: number;
  bytes: Uint8Array;
}

export type DbfValue = string | number | boolean | null;

export class DbfError extends Error {}

const decoder = (() => {
  try {
    return new TextDecoder("windows-1252");
  } catch {
    return new TextDecoder("latin1");
  }
})();

const ascii = (bytes: Uint8Array, start: number, length: number) => {
  let text = "";
  for (let i = start; i < start + length; i++) text += String.fromCharCode(bytes[i]);
  return text;
};

/** Abre una tabla DBF. Lanza `DbfError` si el archivo no es una tabla DBF. */
export const openDbf = (data: ArrayBuffer | Uint8Array): DbfTable => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 33) throw new DbfError("El archivo está vacío o no es una tabla DBF.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength < 33 || recordLength < 1 || headerLength > bytes.length) throw new DbfError("El archivo no es una tabla DBF.");

  const fields: DbfField[] = [];
  let offset = 1;
  for (let pos = 32; pos + 32 <= headerLength && bytes[pos] !== 0x0d; pos += 32) {
    let end = pos;
    while (end < pos + 11 && bytes[end] !== 0) end++;
    const name = ascii(bytes, pos, end - pos).trim().toUpperCase();
    const type = String.fromCharCode(bytes[pos + 11]).toUpperCase();
    const length = bytes[pos + 16];
    fields.push({ name, type, offset, length, decimals: bytes[pos + 17] });
    offset += length;
  }
  if (!fields.length) throw new DbfError("La tabla DBF no tiene campos.");
  const available = Math.floor((bytes.length - headerLength) / recordLength);
  return { fields, recordCount: Math.max(0, Math.min(declared, available)), headerLength, recordLength, bytes };
};

export const dbfField = (table: DbfTable, name: string): DbfField | undefined => table.fields.find((f) => f.name === name.toUpperCase());

/** Texto de un campo, sin los espacios de relleno. */
export const readText = (table: DbfTable, start: number, field: DbfField): string => {
  const from = start + field.offset;
  let end = from + field.length;
  while (end > from && (table.bytes[end - 1] === 0x20 || table.bytes[end - 1] === 0)) end--;
  let begin = from;
  while (begin < end && table.bytes[begin] === 0x20) begin++;
  return begin === end ? "" : decoder.decode(table.bytes.subarray(begin, end));
};

const readValue = (table: DbfTable, start: number, field: DbfField): DbfValue => {
  const { bytes } = table;
  const at = start + field.offset;
  switch (field.type) {
    case "C":
      return readText(table, start, field);
    case "N":
    case "F": {
      const text = ascii(bytes, at, field.length).trim();
      if (!text || text.startsWith("*")) return 0;
      const value = Number(text.replace(",", "."));
      return Number.isFinite(value) ? value : 0;
    }
    case "D": {
      const text = ascii(bytes, at, 8).trim();
      return /^\d{8}$/.test(text) && text !== "00000000" ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
    }
    case "T": {
      // Fecha y hora de Visual FoxPro: día juliano y milisegundos. Se devuelve solo la fecha.
      const julian = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getInt32(0, true);
      if (julian <= 0) return null;
      return new Date((julian - 2440588) * 86_400_000).toISOString().slice(0, 10);
    }
    case "L": {
      const c = String.fromCharCode(bytes[at]).toUpperCase();
      return c === "T" || c === "Y" ? true : c === "F" || c === "N" ? false : null;
    }
    case "I":
      return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getInt32(0, true);
    case "B":
      return new DataView(bytes.buffer, bytes.byteOffset + at, 8).getFloat64(0, true);
    case "Y":
      return Number(new DataView(bytes.buffer, bytes.byteOffset + at, 8).getBigInt64(0, true)) / 10000;
    default:
      // Memos e imágenes: el SISMED no los usa en estas tablas.
      return null;
  }
};

const requireField = (table: DbfTable, name: string) => {
  const field = dbfField(table, name);
  if (!field) throw new DbfError(`La tabla no tiene el campo ${name}.`);
  return field;
};

/**
 * Recorre los registros vigentes (sin los borrados) y devuelve solo los campos pedidos.
 * `where` recibe una función para leer el texto de cualquier campo y descarta el registro
 * antes de decodificar lo demás.
 */
export function* dbfRecords<K extends string>(
  table: DbfTable,
  names: readonly K[],
  where?: (text: (name: string) => string) => boolean,
): Generator<Record<K, DbfValue>> {
  const fields = names.map((name) => requireField(table, name));
  const lookup = new Map<string, DbfField>();
  const fieldFor = (name: string) => {
    let field = lookup.get(name);
    if (!field) {
      field = requireField(table, name);
      lookup.set(name, field);
    }
    return field;
  };
  for (let i = 0; i < table.recordCount; i++) {
    const start = table.headerLength + i * table.recordLength;
    if (table.bytes[start] === 0x2a) continue; // «*»: registro borrado
    if (where && !where((name) => readText(table, start, fieldFor(name)))) continue;
    const record = {} as Record<K, DbfValue>;
    fields.forEach((field, j) => {
      record[names[j]] = readValue(table, start, field);
    });
    yield record;
  }
}
