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
