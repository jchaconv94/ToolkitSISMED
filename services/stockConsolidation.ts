/**
 * Consolidación del stock de una IPRESS con sus farmacias y puestos comunales.
 *
 * Replica, fila por fila, lo que hace Sync SISMED en el ToolKit de escritorio cuando se
 * marca «Consolidar farmacias» (`toolskit/sismed_sync.py`, bloque «6. Consolidación»), para
 * que el Excel consolidado de la web sume igual que la PC:
 *
 * - Se juntan las filas que coinciden en **IPRESS + producto + lote + vencimiento + fuente
 *   de financiamiento + tipo de suministro**. Lotes, vencimientos, financiamientos o tipos
 *   de suministro distintos nunca se mezclan.
 * - Los saldos se **suman**. De precio se toma **el mayor** del grupo.
 * - El resto de datos (nombre, SIGA, registro sanitario…) se toma de la primera fila.
 * - La fila queda con el código de la IPRESS (`06519`) y su nombre, sin sufijo de farmacia:
 *   a diferencia del escritorio, que la rotula `06519F01` y « (CONSOLIDADO)», el Excel de la
 *   web muestra el establecimiento tal cual.
 */

import { readStockField, parseStockAmount } from "./stockNetworkSearch";
import { sheetOwnerCodeOf } from "./facilityCodes";

const campo = (row: any, ...nombres: string[]) => readStockField(row, ...nombres).trim();

/**
 * Filas consolidadas, con los mismos nombres de columna que las de la hoja para que el
 * Excel se arme igual en los dos modos. `Saldo`, `Precio_Det` y `Precio_Cab` salen como
 * número.
 *
 * `descripcion` es el nombre con el que se rotula la fila consolidada. Si no se da, se usa el
 * de la fila, sin la marca « (CONSOLIDADO)» con la que la envía el escritorio.
 */
export const consolidateStockRows = (
  rows: any[] | null | undefined,
  almcodOf: (row: any) => string,
  descripcion = "",
): any[] => {
  const grupos = new Map<string, any>();

  for (const row of rows || []) {
    if (!row) continue;
    const ipress = sheetOwnerCodeOf(almcodOf(row));
    const clave = [
      ipress,
      campo(row, "ID_Producto", "ID_PRODUCTO", "COD_SISMED"),
      campo(row, "Lote", "LOTE"),
      campo(row, "Fec_Vencim", "VENCIMIENTO", "FEC_VENCIM"),
      campo(row, "FFINAN"),
      campo(row, "TIPSUM"),
    ].join("|");

    const saldo = parseStockAmount(readStockField(row, "Saldo", "SALDO"));
    const precioDet = parseStockAmount(readStockField(row, "Precio_Det", "PRECIO_COMPRA"));
    const precioCab = parseStockAmount(readStockField(row, "Precio_Cab", "PRECIO_REF"));

    const existente = grupos.get(clave);
    if (!existente) {
      const nombre = descripcion || campo(row, "DESC_ALM").replace(/\s*\(CONSOLIDADO\)\s*$/i, "");
      grupos.set(clave, {
        ...row,
        ALMCOD: ipress,
        DESC_ALM: nombre,
        Saldo: saldo,
        Precio_Det: precioDet,
        Precio_Cab: precioCab,
      });
    } else {
      existente.Saldo += saldo;
      existente.Precio_Det = Math.max(existente.Precio_Det, precioDet);
      existente.Precio_Cab = Math.max(existente.Precio_Cab, precioCab);
    }
  }

  return Array.from(grupos.values());
};
