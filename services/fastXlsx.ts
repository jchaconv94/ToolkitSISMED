import { Unzip, UnzipInflate, strFromU8, unzipSync } from "fflate";

/**
 * Lector rápido de la primera hoja de un .xlsx grande (la consulta TFORMDET de 12 meses:
 * ~200 000 filas × 45 columnas). SheetJS arma un objeto por celda con estilos y formatos y
 * tarda ~20 s; aquí solo se descomprime la hoja y sus textos y se recorre el XML. Devuelve las
 * filas como arreglos (la primera fila del archivo es la 0), igual que
 * `sheet_to_json(..., { header: 1, raw: true, defval: null })`. Las fechas quedan como número
 * de serie (el TFORMDET trae FEC_EXP como texto). Si algo no cuadra, lanza y quien llama usa
 * SheetJS.
 *
 * La hoja se descomprime y se recorre **por trozos** (2026-10-09): un TFORMDET de 21 o 24 meses
 * escrito por el Toolkit 2.3.1 (XlsxWriter en memoria constante, con los textos dentro de cada
 * celda) pasa de 600 MB sin comprimir, y armarlo como un solo texto superaba el largo máximo de
 * un texto en el navegador (~512 MB): el archivo no se leía.
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

/** Cada cuánto se entrega el archivo comprimido al descompresor: así la hoja sale en trozos. */
const INPUT_STEP = 1 << 20;

export const readFirstSheetFast = (data: ArrayBuffer | Uint8Array, options: { inputStep?: number } = {}): unknown[][] => {
  const step = options.inputStep ?? INPUT_STEP;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const meta = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" });
  const sheetPath = firstSheetPath(meta);

  const shared: string[] = [];
  if (meta["xl/sharedStrings.xml"]) {
    const sst = strFromU8(meta["xl/sharedStrings.xml"]);
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    for (let m = re.exec(sst); m; m = re.exec(sst)) shared.push(m[1] ? textOf(m[1]) : "");
  }

  // Los textos que salen de un trozo lo mantendrían vivo en memoria (V8 guarda los recortes
  // largos como referencia al texto original): se copian una vez y se reutilizan.
  const pool = new Map<string, string>();
  const keep = (text: string) => {
    if (text.length < 13) return text;
    let kept = pool.get(text);
    if (kept === undefined) {
      kept = JSON.parse(JSON.stringify(text)) as string;
      pool.set(kept, kept);
    }
    return kept;
  };

  const rows: unknown[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let nextRow = 0;
  const parseRows = (xml: string) => {
    rowRe.lastIndex = 0;
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
          value = keep(textOf(inner));
        } else {
          const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
          if (v === undefined) continue;
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "str" || type === "e") value = keep(decode(v));
          else if (type === "b") value = v === "1";
          else value = Number(v);
        }
        while (row.length < c) row.push(null);
        row[c] = value;
      }
      while (rows.length < r) rows.push([]);
      rows[r] = row;
    }
  };

  // La hoja llega en trozos: se procesan las filas completas y lo que queda de la última pasa
  // al trozo siguiente.
  const decoder = new TextDecoder();
  let carry = "";
  let found = false;
  let finished = false;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (file.name !== sheetPath) return;
    found = true;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      carry += decoder.decode(chunk, { stream: !final });
      if (final) {
        parseRows(carry);
        carry = "";
        finished = true;
        return;
      }
      const cut = carry.lastIndexOf("</row>");
      if (cut < 0) return;
      parseRows(carry.slice(0, cut + 6));
      carry = carry.slice(cut + 6);
    };
    file.start();
  };
  for (let i = 0; i < bytes.length; i += step) unzip.push(bytes.subarray(i, i + step), i + step >= bytes.length);
  if (!found) throw new Error("No se encontró la hoja en el archivo.");
  if (!finished) throw new Error("La hoja del archivo está incompleta.");

  // Mismo ancho para todas las filas, como `defval: null`.
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  for (const row of rows) while (row.length < width) row.push(null);
  return rows;
};
