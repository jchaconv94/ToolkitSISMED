/**
 * Hojas de Google Sheets que repiten el stock de un mismo establecimiento.
 *
 * Pasa cuando un establecimiento tiene dos pestañas: una vieja que ya no se actualiza (como
 * las «ALM SISMED-030S05» que creaban versiones anteriores del script de Google) y la
 * vigente, o cuando su PC envió a los libros de dos UNGET. Consulta Stock muestra las dos, y
 * la exportación de toda la región las juntaba en un mismo Excel: el 13/10/2026 el almacén
 * 030S08 salía dos veces, con saldos distintos en algún lote porque una copia era vieja.
 *
 * La regla: cada establecimiento se exporta una sola vez, con su hoja **actualizada más
 * recientemente**. Decisión del usuario del 2026-10-13.
 */

import { sheetOwnerCodeOf } from "./facilityCodes";

/**
 * Código del establecimiento al que pertenece una hoja, el mismo con el que el script de
 * Google decide en qué pestaña escribir: el de la IPRESS (sus farmacias y puestos comparten
 * pestaña) o el del almacén.
 *
 * Se prueban, en orden, el ALMCOD de sus filas y el código del nombre de la pestaña. Sin
 * ninguno, vacío: una hoja sin código no se compara con nadie.
 */
export const sheetEstablishmentKey = (...codes: Array<string | null | undefined>): string => {
  for (const raw of codes) {
    const code = String(raw || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!code) continue;
    return sheetOwnerCodeOf(code) || code;
  }
  return "";
};

export interface SheetForDedup {
  id: string;
  /** Código del establecimiento (`sheetEstablishmentKey`). */
  key: string;
  /** Última actualización que escribió el script en la hoja. */
  lastUpdateTime?: number;
  /** Fecha del equipo que envió, si no hay la anterior. */
  equipmentDateTime?: number;
}

const freshness = (sheet: SheetForDedup) => [sheet.lastUpdateTime || 0, sheet.equipmentDateTime || 0];

const fresher = (a: SheetForDedup, b: SheetForDedup) => {
  const [aUpdate, aEquipment] = freshness(a);
  const [bUpdate, bEquipment] = freshness(b);
  return aUpdate !== bUpdate ? aUpdate > bUpdate : aEquipment > bEquipment;
};

/**
 * Hojas que repiten el establecimiento de otra: id de la repetida → id de la que se usa.
 *
 * Se usa la actualizada más recientemente; con la misma fecha, la primera de la lista, para
 * que el resultado no dependa de nada más que del orden en que llegan.
 */
export const findRepeatedSheets = (sheets: SheetForDedup[]): Map<string, string> => {
  const best = new Map<string, SheetForDedup>();
  for (const sheet of sheets) {
    if (!sheet.key) continue;
    const current = best.get(sheet.key);
    if (!current || fresher(sheet, current)) best.set(sheet.key, sheet);
  }
  const repeated = new Map<string, string>();
  for (const sheet of sheets) {
    const kept = sheet.key ? best.get(sheet.key) : undefined;
    if (kept && kept.id !== sheet.id) repeated.set(sheet.id, kept.id);
  }
  return repeated;
};
