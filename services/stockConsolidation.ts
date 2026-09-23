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
 * - La fila queda con el código de la IPRESS (`06519`) y el nombre de su farmacia principal,
 *   limpio (ver `exportDescAlm`): a diferencia del escritorio, que la rotula `06519F01` y
 *   « (CONSOLIDADO)», el Excel de la web muestra el establecimiento tal cual.
 */

import { readStockField, parseStockAmount } from "./stockNetworkSearch";
import { facilityCodeOf, parseFacilityCode, sheetOwnerCodeOf } from "./facilityCodes";

const campo = (row: any, ...nombres: string[]) => readStockField(row, ...nombres).trim();

const esPuestoComunal = (almcod: string) => parseFacilityCode(almcod).kind === "puesto-comunal";

/**
 * Código con el que sale cada farmacia en el Excel: el del establecimiento (`06519`,
 * `030S05`), y el del puesto comunal con su `F0x` (`06519F02`). El `01` final que agrega
 * SISMED no se muestra, y la farmacia principal (`F01`) es el propio establecimiento.
 */
export const exportAlmcod = (almcod: string): string =>
  facilityCodeOf(almcod) || String(almcod || "").trim();

/**
 * Nombre con el que sale cada farmacia en el Excel: el que envía SISMED, sin la marca
 * « (CONSOLIDADO)» de los envíos consolidados. El «FARM - » delante solo lo conservan los
 * puestos comunales; en la farmacia principal el nombre es el del establecimiento.
 */
export const exportDescAlm = (desc: string, almcod: string): string => {
  const sinMarca = String(desc || "").replace(/\s*\(CONSOLIDADO\)\s*$/i, "").trim();
  return esPuestoComunal(almcod) ? sinMarca : sinMarca.replace(/^FARM(?:ACIA)?\.?\s*-\s*/i, "").trim();
};

/**
 * Filas consolidadas, con los mismos nombres de columna que las de la hoja para que el
 * Excel se arme igual en los dos modos. `Saldo`, `Precio_Det` y `Precio_Cab` salen como
 * número.
 *
 * `descripcion` es el nombre con el que se rotula la fila consolidada. Si no se da, se usa el
 * de la farmacia principal del establecimiento, limpio; y si en lo recibido solo hay puestos
 * comunales, el de la fila.
 */
export const consolidateStockRows = (
  rows: any[] | null | undefined,
  almcodOf: (row: any) => string,
  descripcion = "",
): any[] => {
  const grupos = new Map<string, any>();

  // Nombre de cada establecimiento, sacado de su farmacia principal: un lote que solo tiene
  // un puesto comunal no debe quedar rotulado con el nombre del puesto.
  const nombrePrincipal = new Map<string, string>();
  for (const row of rows || []) {
    if (!row) continue;
    const almcod = almcodOf(row);
    const ipress = sheetOwnerCodeOf(almcod);
    if (nombrePrincipal.has(ipress) || esPuestoComunal(almcod)) continue;
    const nombre = exportDescAlm(campo(row, "DESC_ALM"), almcod);
    if (nombre) nombrePrincipal.set(ipress, nombre);
  }

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
      grupos.set(clave, {
        ...row,
        ALMCOD: ipress,
        DESC_ALM:
          descripcion ||
          nombrePrincipal.get(ipress) ||
          exportDescAlm(campo(row, "DESC_ALM"), almcodOf(row)),
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
