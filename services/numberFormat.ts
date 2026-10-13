/**
 * Números para la pantalla: miles separados por espacio y coma decimal (21 300; 2 193,5).
 *
 * `toLocaleString("es-PE")` usa coma para los miles y punto para los decimales, y junto a
 * los porcentajes con coma decimal («21,30 %») un «21,300» se leía como veintiuno con tres.
 * Se arma a mano para que la coma signifique siempre lo mismo.
 */
export const formatNumber = (value: number, maxDecimals = 0): string => {
  if (!Number.isFinite(value)) return "—";
  const [whole, decimals] = Math.abs(value).toFixed(maxDecimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const trimmed = decimals?.replace(/0+$/, "");
  return `${value < 0 ? "-" : ""}${grouped}${trimmed ? `,${trimmed}` : ""}`;
};

/**
 * Número leído de una celda de Google Sheets, venga con punto o con coma decimal.
 *
 * La hoja entrega los números como texto, en el formato del idioma de cada libro: unos
 * libros muestran `2773.125` y otros `2773,125`. El Toolkit los escribe sin separador de
 * miles, así que **un solo signo es siempre el decimal**; si vienen los dos (`1.234,5`,
 * `1,234.5`), el decimal es el último, y si un signo se repite (`1.234.567`), separa miles.
 *
 * Antes había dos lectores, cada uno con su error: el de Consulta Stock tomaba un punto
 * seguido de tres cifras como separador de miles (`2773.125` salía 2773125 en el Excel
 * consolidado) y el de Stock SISMED hacía lo mismo con la coma (`0,324` salía 324).
 */
export const parseSheetNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value ?? "").replace(/[\s ]/g, "");
  if (!text) return 0;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  const repeated = (sign: string, last: number) => text.indexOf(sign) !== last;
  const decimal =
    lastDot >= 0 && lastComma >= 0
      ? lastDot > lastComma ? "." : ","
      : lastDot >= 0
        ? repeated(".", lastDot) ? "" : "."
        : lastComma >= 0 && !repeated(",", lastComma) ? "," : "";
  const thousands = decimal === "." ? "," : decimal === "," ? "." : lastDot >= 0 ? "." : ",";
  text = text.split(thousands).join("");
  if (decimal === ",") text = text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
};
