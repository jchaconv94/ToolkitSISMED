import { strFromU8, unzipSync } from "fflate";

/**
 * Lector rápido de la primera hoja de un .xlsx grande (la consulta TFORMDET de 12 meses:
 * ~200 000 filas × 45 columnas). SheetJS arma un objeto por celda con estilos y formatos y
 * tarda ~20 s; aquí solo se descomprime la hoja y sus textos y se recorre el XML. Devuelve las
 * filas como arreglos (la primera fila del archivo es la 0), igual que
 * `sheet_to_json(..., { header: 1, raw: true, defval: null })`. Las fechas quedan como número
 * de serie (el TFORMDET trae FEC_EXP como texto). Si algo no cuadra, lanza y quien llama usa
 * SheetJS.
 */

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.indexOf("&") < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
        e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e.toLowerCase()]);

/** Texto de un <si> o un <is>: une todos sus <t> (los de formato enriquecido incluidos). */
const textOf = (xml: string) => {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out += m[1];
  return decode(out);
};

/** «AB» → 27 (base 1). */
const colIndex = (ref: string) => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
};

const firstSheetPath = (files: Record<string, Uint8Array>) => {
  const wb = files["xl/workbook.xml"] && strFromU8(files["xl/workbook.xml"]);
  const rels = files["xl/_rels/workbook.xml.rels"] && strFromU8(files["xl/_rels/workbook.xml.rels"]);
  const rid = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1] ?? wb?.match(/<sheet\b[^>]*\bid="([^"]+)"/)?.[1];
  if (rid && rels) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  return "xl/worksheets/sheet1.xml";
};

export const readFirstSheetFast = (data: ArrayBuffer | Uint8Array): unknown[][] => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const meta = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  const sheetPath = firstSheetPath(meta);
  const files = unzipSync(bytes, { filter: (f) => f.name === sheetPath || f.name === "xl/sharedStrings.xml" });
  if (!files[sheetPath]) throw new Error("No se encontró la hoja en el archivo.");

  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const sst = strFromU8(files["xl/sharedStrings.xml"]);
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    for (let m = re.exec(sst); m; m = re.exec(sst)) shared.push(m[1] ? textOf(m[1]) : "");
  }

  const xml = strFromU8(files[sheetPath]);
  const rows: unknown[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let nextRow = 0;
  for (let rm = rowRe.exec(xml); rm; rm = rowRe.exec(xml)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    const r = rAttr ? Number(rAttr[1]) - 1 : nextRow;
    nextRow = r + 1;
    const body = rm[2];
    if (!body) continue;
    const row: unknown[] = [];
    let nextCol = 0;
    cellRe.lastIndex = 0;
    for (let cm = cellRe.exec(body); cm; cm = cellRe.exec(body)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs);
      const c = ref ? colIndex(ref[1]) - 1 : nextCol;
      nextCol = c + 1;
      const inner = cm[2];
      if (!inner) continue;
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1];
      let value: unknown = null;
      if (type === "inlineStr") {
        value = textOf(inner);
      } else {
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        if (v === undefined) continue;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "str" || type === "e") value = decode(v);
        else if (type === "b") value = v === "1";
        else value = Number(v);
      }
      while (row.length < c) row.push(null);
      row[c] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = row;
  }
  // Mismo ancho para todas las filas, como `defval: null`.
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  for (const row of rows) while (row.length < width) row.push(null);
  return rows;
};
