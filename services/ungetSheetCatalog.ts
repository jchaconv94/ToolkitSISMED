/**
 * Pestañas disponibles en la conexión de una UNGET.
 *
 * Lo usa Administración → Asignar Stock para ofrecer las hojas que se pueden asignar a un
 * establecimiento. Antes ese módulo pedía la lista con un `fetch` crudo a
 * `<url>?action=getSheets`, lo que traía dos problemas:
 *
 * 1. Daba por hecho que la conexión es una Web App de Apps Script. En cuanto una UNGET
 *    configura su hoja y retira la Web App, su URL pasa a ser `sheets://<id>` y esa
 *    petición falla siempre: la UNGET se quedaba sin poder asignar nada.
 * 2. Se saltaba `gasConnectionService`, así que no reintentaba ante los 404 temporales con
 *    los que Google responde a menudo, ni tenía tiempo de espera propio.
 *
 * Aquí se usa el mismo orden que Consulta Stock: primero el libro por la API de Google
 * Sheets, y si no, la Web App. Las pestañas que no son establecimientos quedan fuera.
 */

import { fetchGasMetadata, type GasSheetMetadata } from "./gasConnectionService";
import { fetchSheetsMetadataViaApi, getSheetsApiKey, isFacilitySheet } from "./sheetsApiService";
import { isVirtualSheetUrl } from "./ungetConnections";

export interface UngetSheet {
  /** Identificador de la pestaña dentro del libro (gid). */
  id: string;
  name: string;
}

export interface UngetSheetSource {
  url?: string | null;
  spreadsheetId?: string | null;
}

const toSheets = (metadata: GasSheetMetadata[]): UngetSheet[] =>
  (metadata || [])
    .filter(isFacilitySheet)
    .map((meta) => ({ id: String(meta.id || ""), name: String(meta.name || "").trim() }))
    .filter((sheet) => sheet.name);

export async function listUngetSheets(
  connection: UngetSheetSource | null | undefined,
  options: { force?: boolean; apiKey?: string } = {},
): Promise<UngetSheet[]> {
  const spreadsheetId = String(connection?.spreadsheetId || "").trim();
  const url = String(connection?.url || "").trim();
  const apiKey = options.apiKey ?? getSheetsApiKey();
  let lastError: unknown = null;

  if (spreadsheetId && apiKey) {
    try {
      return toSheets(
        await fetchSheetsMetadataViaApi(spreadsheetId, { apiKey, force: options.force }),
      );
    } catch (error) {
      lastError = error;
      console.warn("No se pudieron listar las pestañas por la API de Google Sheets:", error);
    }
  }

  if (url && !isVirtualSheetUrl(url)) {
    return toSheets(await fetchGasMetadata(url, { force: options.force }));
  }

  if (lastError) throw lastError;
  throw new Error(
    "Esta UNGET no tiene hoja de cálculo configurada ni Web App que consultar. Pida a su informático que configure la conexión en Consulta Stock.",
  );
}

/** Si una asignación sigue apuntando a una pestaña que existe en el libro. */
export const assignmentSheetExists = (
  sheetName: string | null | undefined,
  sheets: UngetSheet[] | null | undefined,
): boolean => {
  const buscada = String(sheetName || "").trim();
  if (!buscada) return false;
  return (sheets || []).some((sheet) => sheet.name === buscada);
};
