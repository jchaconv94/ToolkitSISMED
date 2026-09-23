/**
 * Consolidación del stock de una IPRESS con sus farmacias y puestos comunales.
 *
 * Replica, fila por fila, lo que hace Sync SISMED en el ToolKit de escritorio cuando se
 * marca «Consolidar farmacias» (`toolskit/sismed_sync.py`, bloque «6. Consolidación»), para
 * que el Excel consolidado que se descarga de la web sea el mismo que habría llegado a la
 * hoja si la PC enviara consolidado:
 *
 * - Se juntan las filas que coinciden en **IPRESS + producto + lote + vencimiento + fuente
 *   de financiamiento + tipo de suministro**. Lotes, vencimientos, financiamientos o tipos
 *   de suministro distintos nunca se mezclan.
 * - Los saldos se **suman**. De precio se toma **el mayor** del grupo.
 * - El resto de datos (nombre, SIGA, registro sanitario…) se toma de la primera fila.
 * - La fila queda a nombre de la farmacia principal: `06519F01`, o `030S0501` en un almacén.
 */

import { readStockField, parseStockAmount } from "./stockNetworkSearch";
import { sheetOwnerCodeOf } from "./facilityCodes";

/**
 * ALMCOD de la fila consolidada, igual que `_consolidated_almcod` del escritorio: un almacén
 * (seis caracteres con letras) lleva `01`; una IPRESS, `F01`.
 */
export const consolidatedAlmcod = (facilityCode: string): string => {
  const code = String(facilityCode || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!code) return "";
  return code.length === 6 && /[A-Z]/.test(code) ? `${code}01` : `${code}F01`;
};

const campo = (row: any, ...nombres: string[]) => readStockField(row, ...nombres).trim();

/**
 * Filas consolidadas, con los mismos nombres de columna que las de la hoja para que el
 * Excel se arme igual en los dos modos. `Saldo`, `Precio_Det` y `Precio_Cab` salen como
 * número.
 *
 * `descripcion` es el nombre con el que se rotula la fila consolidada; se le añade
 * « (CONSOLIDADO)», como hace el escritorio.
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
        ALMCOD: consolidatedAlmcod(ipress),
        DESC_ALM: nombre ? `${nombre} (CONSOLIDADO)` : "(CONSOLIDADO)",
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
