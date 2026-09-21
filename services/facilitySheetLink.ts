/**
 * Vínculo entre un establecimiento y su pestaña de stock, **deducido del código**.
 *
 * Hasta ahora el vínculo se elegía a mano en dos pantallas distintas y se guardaba en
 * `facility_stock_assignments`. Eso permitía guardar cualquier combinación: el 20/09/2026 se
 * asignó el P.C. Los Olivos a la hoja del C.S. Cuzco y el sistema lo aceptó, porque las dos
 * comprobaciones que había —la UNGET de la conexión y que la pestaña exista— se cumplían.
 * Una asignación equivocada no falla: muestra el stock de otro establecimiento como si fuera
 * el propio, y nadie se entera.
 *
 * La corrección no es una validación más. El dato que decide ya está en los dos extremos:
 * la pestaña lleva el código en su nombre (`C.S. NUEVO LIMA-06519`) o en el `ALMCOD` de su
 * primera fila, y el establecimiento lleva el suyo en Establecimientos. Si los dos códigos
 * dicen lo mismo, el vínculo es ese y no hay nada que elegir. Así que **no se guarda: se
 * deduce cada vez**. Lo que sigue guardándose en la asignación son las columnas visibles,
 * que sí son una decisión de quien administra.
 *
 * Deducirlo además arregla solo lo que antes había que mantener a mano: la UNGET renombra una
 * pestaña, cambia de libro o registra un establecimiento nuevo, y el vínculo se rehace sin
 * que nadie toque nada.
 *
 * Los códigos se interpretan con `services/facilityCodes.ts`, que es la regla única.
 */

import { facilityCodeOf, parseFacilityCode, sheetOwnerCodeOf } from "./facilityCodes";
import { facilityCodeFromSheetName } from "./sheetsApiService";
import type { UngetSheet } from "./ungetSheetCatalog";

export type FacilitySheetLinkStatus =
  /** Hay una pestaña con su código: ese es su stock. */
  | "vinculada"
  /**
   * Es un puesto comunal (`F02` en adelante). No tiene pestaña propia ni debe tenerla: su
   * stock viaja dentro de la hoja de su IPRESS, separado por ALMCOD.
   */
  | "dentro-de-su-ipress"
  /** Su UNGET no publica ninguna pestaña con su código. */
  | "sin-hoja"
  /** Dos o más pestañas dicen ser del mismo establecimiento. */
  | "ambigua"
  /** El código registrado no encaja en ningún formato conocido. */
  | "codigo-no-reconocido";

export interface FacilitySheetLink {
  status: FacilitySheetLinkStatus;
  /** Pestaña de la que leer. `null` en todo lo que no sea un vínculo resuelto. */
  sheet: UngetSheet | null;
  /** Las pestañas que reclaman el código. Solo interesa cuando el estado es `ambigua`. */
  candidates: UngetSheet[];
  /** Código de la hoja que le corresponde: el suyo, o el de su IPRESS si es puesto comunal. */
  ownerCode: string;
  /** Explicación para la pantalla, en el idioma del proyecto. */
  message: string;
}

/**
 * Código del establecimiento dueño de una pestaña.
 *
 * Se prueba primero el nombre, que es lo que declara la UNGET, y luego el ALMCOD de la
 * primera fila. Hacen falta los dos: Tocache tiene una pestaña llamada `ALM SISMED-030S0`,
 * con el código cortado a cinco caracteres, que sola no se reconoce; su ALMCOD sí lo dice
 * entero. Y al revés, una pestaña vacía no tiene ALMCOD pero sí nombre.
 *
 * El código del nombre se vuelve a leer aquí en vez de fiarse del `codigoIpress` que trae la
 * metadata: las Web App que las UNGET no han vuelto a desplegar no lo envían, y sin esto el
 * vínculo dependería de que cada informático actualizara su Apps Script.
 */
export const sheetOwnerCode = (sheet: Pick<UngetSheet, "name" | "codigoIpress" | "almcod">): string => {
  const delNombre = String(sheet?.codigoIpress || "").trim() || facilityCodeFromSheetName(sheet?.name || "");
  return sheetOwnerCodeOf(delNombre) || sheetOwnerCodeOf(sheet?.almcod) || "";
};

const mensaje = (status: FacilitySheetLinkStatus, ownerCode: string, sheet: UngetSheet | null): string => {
  switch (status) {
    case "vinculada":
      return `Vinculada automáticamente por código a la hoja «${sheet?.name}».`;
    case "dentro-de-su-ipress":
      return `Es un puesto comunal: su stock viaja dentro de la hoja «${sheet?.name}», la de su IPRESS ${ownerCode}, separado por su ALMCOD.`;
    case "sin-hoja":
      return `Su UNGET todavía no publica ninguna hoja con el código ${ownerCode}. Mientras tanto este establecimiento no verá stock.`;
    case "ambigua":
      return `Hay más de una hoja con el código ${ownerCode}. Pida a su UNGET que deje una sola, porque no se puede saber cuál es la buena.`;
    default:
      return "El código registrado no tiene un formato reconocible, así que no se puede emparejar con ninguna hoja. Corríjalo en Administración → Establecimientos.";
  }
};

const construir = (
  status: FacilitySheetLinkStatus,
  ownerCode: string,
  sheet: UngetSheet | null,
  candidates: UngetSheet[] = [],
): FacilitySheetLink => ({ status, sheet, candidates, ownerCode, message: mensaje(status, ownerCode, sheet) });

/**
 * La pestaña que le corresponde a un establecimiento dentro del libro de su UNGET.
 *
 * No se pasa la lista completa de libros a propósito: la pestaña tiene que estar en el libro
 * de **su** UNGET. Quien llama ya resolvió esa conexión, y así dos UNGET con establecimientos
 * de códigos parecidos no pueden pisarse.
 */
export const resolveFacilitySheet = (
  facilityCode: string | null | undefined,
  sheets: UngetSheet[] | null | undefined,
): FacilitySheetLink => {
  const parsed = parseFacilityCode(facilityCode);
  if (parsed.kind === "desconocido") return construir("codigo-no-reconocido", "", null);

  const ownerCode = parsed.ipressCode || parsed.facilityCode;
  const candidates = (sheets || []).filter((sheet) => sheet && sheetOwnerCode(sheet) === ownerCode);

  if (candidates.length === 0) return construir("sin-hoja", ownerCode, null);
  if (candidates.length > 1) return construir("ambigua", ownerCode, null, candidates);

  const [sheet] = candidates;
  return construir(
    parsed.kind === "puesto-comunal" ? "dentro-de-su-ipress" : "vinculada",
    ownerCode,
    sheet,
  );
};

/** Nombre de la pestaña de la que leer, o cadena vacía si el vínculo no se resolvió. */
export const linkedSheetName = (link: FacilitySheetLink | null | undefined): string =>
  link?.sheet?.name || "";

/** Si el vínculo apunta a una pestaña de la que se puede leer. */
export const isLinkedToSheet = (link: FacilitySheetLink | null | undefined): boolean =>
  link?.status === "vinculada" || link?.status === "dentro-de-su-ipress";

/**
 * Filas que le corresponden a un establecimiento dentro de la hoja que lee.
 *
 * Una hoja trae todas las farmacias de la IPRESS mezcladas, separadas por el ALMCOD de cada
 * fila. El reparto **no es simétrico**, y es a propósito:
 *
 * - La **IPRESS** se queda con la hoja entera, sus puestos comunales incluidos. Es su
 *   inventario: los puestos comunales son suyos y quien la dirige tiene que verlos. Por eso
 *   la tabla de stock lleva la columna con el ALMCOD y el nombre de cada farmacia.
 * - Un **puesto comunal** solo ve lo suyo. Su usuario existe para su propio stock, no para
 *   el del establecimiento entero.
 *
 * Las filas sin ALMCOD legible se le dejan a la IPRESS —el envío consolidado no lo trae— y no
 * al puesto comunal, porque sin código nada dice que sean suyas.
 */
export const rowsBelongingToFacility = <T extends Record<string, any>>(
  rows: T[] | null | undefined,
  facilityCode: string | null | undefined,
  almcodOf: (row: T) => string,
): T[] => {
  const propio = facilityCodeOf(facilityCode);
  if (!propio || parseFacilityCode(facilityCode).kind !== "puesto-comunal") return rows || [];
  return (rows || []).filter((row) => facilityCodeOf(almcodOf(row)) === propio);
};

/** Cómo se rotula el ALMCOD de una fila en la columna «Código IPRESS». */
export interface PharmacyLabel {
  /** Código del establecimiento al que pertenece la fila (`06528`, `06528F02`, `030S05`). */
  code: string;
  /** Su nombre registrado. Vacío si no está en Establecimientos. */
  name: string;
  /**
   * Es una farmacia que SISMED numera pero que nadie registró como establecimiento. Se
   * muestra igual, marcada: es la señal de que falta darla de alta.
   */
  unregistered: boolean;
}

/**
 * Rótulo del ALMCOD de una fila: el código del establecimiento y su nombre.
 *
 * Se muestra el código **registrado**, no el ALMCOD crudo, porque es el que se busca y el
 * que aparece en Establecimientos: `06528F0101` se rotula `06528`, y `06528F0201` como
 * `06528F02`. Un ALMCOD que no se entiende se muestra tal cual, que dice más que un guion.
 */
export const describePharmacyCode = (
  almcod: string | null | undefined,
  facilities: Array<{ code?: string | null; name?: string | null }> | null | undefined,
): PharmacyLabel => {
  const parsed = parseFacilityCode(almcod);
  const code = parsed.facilityCode || String(almcod || "").trim().toUpperCase();
  const registrado = parsed.facilityCode
    ? (facilities || []).find(
        (f) => String(f?.code || "").trim().toUpperCase() === parsed.facilityCode,
      )
    : undefined;

  return {
    code,
    name: String(registrado?.name || "").trim(),
    unregistered: !registrado && parsed.kind === "puesto-comunal",
  };
};

/**
 * Si vale la pena mostrar la columna «Código IPRESS».
 *
 * Solo cuando las filas son de más de una farmacia. En el envío consolidado todas traen el
 * mismo ALMCOD —o ninguno—, así que la columna sería una constante repetida ocupando ancho.
 */
export const showsPharmacyColumn = <T>(
  rows: T[] | null | undefined,
  almcodOf: (row: T) => string,
): boolean => {
  const vistos = new Set<string>();
  for (const row of rows || []) {
    const code = facilityCodeOf(almcodOf(row));
    if (code) vistos.add(code);
    if (vistos.size > 1) return true;
  }
  return false;
};
