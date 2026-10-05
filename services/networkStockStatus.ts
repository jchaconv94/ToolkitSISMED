/**
 * «Stock actualizado» de Inicio: cuántos establecimientos de la jurisdicción tienen su hoja
 * de stock al día, con retraso o sin actualizar, según la «última actualización» de cada
 * pestaña de Google Sheets (lo mismo que muestra Consulta Stock).
 *
 * - Las conexiones son las de `selectVisibleStockConnections`, la regla de Consulta Stock.
 * - Solo se leen los encabezados de cada pestaña (metadatos), nunca los lotes.
 * - El último resultado se guarda en el navegador, por usuario, para mostrarlo al instante
 *   la próxima vez mientras se recalcula en segundo plano.
 */

import type { User } from "../types";
import { api } from "./api";
import { fetchGasWithResilience, type GasSheetMetadata } from "./gasConnectionService";
import { fetchSheetsMetadataViaApi, hasSheetsApiKey, isFacilitySheet } from "./sheetsApiService";
import { parseSheetDateTime } from "./stockSyncHistory";
import { alignConfigsWithOfficialUngets, resolveStockLevel, selectVisibleStockConnections } from "./stockConnectionScope";
import { isVirtualSheetUrl } from "./ungetConnections";
import { syncBucketOf } from "./syncBuckets";

export interface NetworkStockStatus {
  /** «toda la red», o el nombre de su DIRESA, OGESS o UNGET. */
  scope: string;
  total: number;
  /** Hoja actualizada en la última hora (los cortes de Consulta Stock, `syncBucketOf`). */
  upToDate: number;
  /** Entre 1 y 24 horas. */
  late: number;
  /** Más de un día, o sin fecha de actualización. */
  stale: number;
  /** Cuándo se calculó (ms). */
  at: number;
}

/** Niveles que ven la red; el personal de un establecimiento ve su propio stock. */
export const NETWORK_LEVELS = ["GLOBAL", "DIRESA", "OGESS", "UNGET"];

export const summarizeSheetUpdates = (lastUpdates: number[], now: number) => {
  const result = { total: lastUpdates.length, upToDate: 0, late: 0, stale: 0 };
  lastUpdates.forEach((at) => {
    const bucket = syncBucketOf(at, now);
    if (bucket === "al-dia") result.upToDate += 1;
    else if (bucket === "retraso") result.late += 1;
    else result.stale += 1;
  });
  return result;
};

/** Pestañas que son establecimientos: con código en el nombre o ALMCOD. */
export const facilityLastUpdates = (metadata: GasSheetMetadata[]): number[] =>
  (metadata || [])
    .filter((meta) => isFacilitySheet(meta) && (meta.codigoIpress || meta.almcod))
    .map((meta) => parseSheetDateTime(meta.lastUpdate));

const loadMetadata = async (config: any): Promise<GasSheetMetadata[]> => {
  const spreadsheetId = String(config?.spreadsheetId || "").trim();
  if (spreadsheetId && hasSheetsApiKey()) {
    try {
      return await fetchSheetsMetadataViaApi(spreadsheetId, { skipRowCounts: true });
    } catch (err) {
      if (!config?.url || isVirtualSheetUrl(config.url)) throw err;
    }
  }
  if (config?.url && !isVirtualSheetUrl(config.url)) {
    // Petición propia, sin la caché compartida de `fetchGasMetadata`: compartir esos mismos
    // objetos con Consulta Stock mientras carga le dejaba el directorio vacío.
    const sep = config.url.includes("?") ? "&" : "?";
    const result = await fetchGasWithResilience(`${config.url}${sep}action=getMetadata&_t=${Date.now()}`);
    return Array.isArray(result) ? result.filter((item: any) => item && typeof item === "object" && item.name && !Array.isArray(item.data)) : [];
  }
  throw new Error(`La conexión de ${config?.name || "una UNGET"} no tiene hoja ni Web App.`);
};

const idOf = (user: User, field: "diresaId" | "ogessId" | "ungetId") =>
  (user.personnelData as any)?.[field] || (user.facilityData as any)?.[field] || (user as any)[field];

/**
 * Calcula el estado de la red del usuario. Devuelve `null` si su nivel no ve la red. Las
 * UNGET cuya hoja no responde no cuentan; si no responde ninguna, falla.
 */
export async function loadNetworkStockStatus(user: User, now = Date.now()): Promise<NetworkStockStatus | null> {
  const level = String(resolveStockLevel(user.role, user.jurisdictionLevel)).toUpperCase();
  if (!NETWORK_LEVELS.includes(level)) return null;

  const [ungets, rawConfigs, users] = await Promise.all([api.getUngets(), api.getAllUngetConfigs(), api.getUsers()]);
  const userUngetId = idOf(user, "ungetId");
  const configs = selectVisibleStockConnections({
    level,
    username: user.username,
    userDiresaId: idOf(user, "diresaId"),
    userOgessId: idOf(user, "ogessId"),
    userUngetId,
    myUnget: (ungets || []).find((u: any) => String(u.id) === String(userUngetId)) || null,
    allConfigs: alignConfigsWithOfficialUngets(rawConfigs || [], ungets || []),
    ungets: ungets || [],
    users: users || [],
  });

  const results = await Promise.allSettled(configs.map(loadMetadata));
  const ok = results.filter((r): r is PromiseFulfilledResult<GasSheetMetadata[]> => r.status === "fulfilled");
  if (configs.length > 0 && ok.length === 0) throw new Error("Ninguna hoja de stock respondió.");
  const lastUpdates = ok.flatMap((r) => facilityLastUpdates(r.value));

  let scope = "toda la red";
  if (level === "UNGET") scope = (ungets || []).find((u: any) => String(u.id) === String(userUngetId))?.name || "su UNGET";
  if (level === "OGESS") scope = (await api.getOgess()).find((o: any) => String(o.id) === String(idOf(user, "ogessId")))?.name || "su OGESS";
  if (level === "DIRESA") scope = (await api.getDiresas()).find((d: any) => String(d.id) === String(idOf(user, "diresaId")))?.name || "su DIRESA";

  return { scope, ...summarizeSheetUpdates(lastUpdates, now), at: now };
}

// --- Último resultado guardado en el navegador -----------------------------------------

const cacheKey = (username: string) => `toolkit.inicio.red.${username}`;

export const readCachedNetworkStatus = (username: string): NetworkStockStatus | null => {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(username)) || "null");
    return value && typeof value.total === "number" ? value : null;
  } catch {
    return null;
  }
};

export const saveCachedNetworkStatus = (username: string, status: NetworkStockStatus | null) => {
  try {
    if (status) localStorage.setItem(cacheKey(username), JSON.stringify(status));
    else localStorage.removeItem(cacheKey(username));
  } catch { /* Sin almacenamiento: se recalcula cada vez. */ }
};
