/**
 * Arma una tabla DBF (dBase III) en memoria para las pruebas, con el mismo formato que las del
 * SISMED: así se prueba el lector sin guardar archivos con datos de establecimientos.
 */
export type DbfFieldSpec = [name: string, type: "C" | "N" | "D" | "L", length: number, decimals?: number];

const encodeLatin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0) & 0xff));

export const buildDbf = (fields: DbfFieldSpec[], rows: Array<Record<string, string | number>>, options: { deleted?: number[] } = {}): Uint8Array => {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f[2], 0);
  const bytes = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x03;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  bytes[29] = 0x03;
  fields.forEach(([name, type, length, decimals = 0], i) => {
    const at = 32 + i * 32;
    bytes.set(encodeLatin1(name.slice(0, 10)), at);
    bytes[at + 11] = type.charCodeAt(0);
    bytes[at + 16] = length;
    bytes[at + 17] = decimals;
  });
  bytes[headerLength - 1] = 0x0d;
  rows.forEach((row, r) => {
    const start = headerLength + r * recordLength;
    bytes.fill(0x20, start, start + recordLength);
    if (options.deleted?.includes(r)) bytes[start] = 0x2a;
    let offset = 1;
    fields.forEach(([name, type, length, decimals = 0]) => {
      const value = row[name];
      let cell = "";
      if (value !== undefined && value !== "") {
        if (type === "N") cell = (typeof value === "number" ? value.toFixed(decimals) : value).padStart(length);
        else if (type === "D") cell = String(value).replace(/-/g, "");
        else cell = String(value).padEnd(length);
      }
      bytes.set(encodeLatin1(cell.slice(0, length)), start + offset);
      offset += length;
    });
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes;
};
