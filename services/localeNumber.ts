/**
 * Lectura de números escritos a mano o exportados como texto (CSV del SISMED, celdas de texto
 * en Excel). `Number("12,5")` da `NaN` y la lectura de CSV de `xlsx` convertía «12,5» en 125
 * y «0,35» en 35 (precio por 100); «1 234» daba `NaN` y se tomaba como 0.
 *
 * `decimal`:
 * - `","`: coma decimal; el punto y el espacio separan miles (CSV separado por «;»).
 * - `"."`: punto decimal; la coma y el espacio separan miles (CSV separado por «,»).
 * - `"auto"`: si aparecen los dos signos, el último es el decimal; si solo hay coma, es decimal.
 *
 * Devuelve `NaN` si el texto no es un número, para que quien llama pueda avisar.
 */
export type DecimalMark = "," | "." | "auto";

export const parseLocaleNumber = (value: unknown, decimal: DecimalMark = "auto"): number => {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return NaN;
  let text = String(value).replace(/[\s  ]/g, "");
  if (text === "") return NaN;

  let mark = decimal;
  if (mark === "auto") {
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    mark = lastComma > lastDot ? "," : ".";
  }
  text = mark === ","
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");

  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : NaN;
};

/** Separador de un CSV, mirando su primera línea: «;», tabulador o «,». */
export const detectCsvDelimiter = (text: string): ";" | "\t" | "," => {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const semicolons = count(";");
  const tabs = count("\t");
  const commas = count(",");
  if (semicolons >= tabs && semicolons >= commas && semicolons > 0) return ";";
  if (tabs >= commas && tabs > 0) return "\t";
  return ",";
};
