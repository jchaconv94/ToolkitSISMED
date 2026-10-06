import { parseTformdetHistory, tformdetLastMonth, type ParsedTformdet, type TformdetMonthSheet } from "./availabilityReport";

/** Lo que el módulo Disponibilidad necesita de la consulta TFORMDET. */
export interface TformdetFileResult {
  data: ParsedTformdet;
  /** Registros del mes de corte, para la hoja del Excel. */
  last: TformdetMonthSheet | null;
}

/** ¿La hoja es la consulta TFORMDET del Toolkit? (trae ANNOMES o CODIGO_PRE en la cabecera). */
export const isTformdetSheet = (sheet: unknown[][]) =>
  sheet.slice(0, 15).some((row) => (row || []).some((c) => /^ANN?OMES$|^CODIGO_PRE$/i.test(String(c ?? "").trim())));

/** Arma el cálculo desde las filas de la hoja. El mes de un TFORMDET sin ANNOMES sale del nombre del archivo. */
export const tformdetFromSheet = (sheet: unknown[][], fileName: string): TformdetFileResult => {
  if (!isTformdetSheet(sheet)) throw new Error("Suba la consulta TFORMDET del Toolkit de escritorio (Consulta TFORMDET).");
  const fallbackMonth = (fileName.match(/(20\d{2})(0[1-9]|1[0-2])/g) || []).pop();
  return { data: parseTformdetHistory(sheet, { fallbackMonth }), last: tformdetLastMonth(sheet) };
};
