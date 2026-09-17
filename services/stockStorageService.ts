import localforage from "localforage";
import { SheetSource, SIGData, UngetConfig } from "../types";
import { parseSheetDateTime } from "./stockSyncHistory";

// Configurar instancia aislada de localforage para Stock SIG
const stockStore = localforage.createInstance({
  name: "ToolkitSISMED",
  storeName: "sig_stock_cache",
  description: "Caché de alto rendimiento para datos de existencias de Google Sheets",
});

/**
 * Versión del esquema de caché de Consulta Stock.
 *
 * v4 reconstruye solo el directorio ligero desde metadata y evita reutilizar sources v3
 * que no conocían el nombre real de hoja, rowCount ni la llave estable del historial.
 */
const STOCK_DATA_CACHE_VERSION = 4;
const STOCK_DATA_CACHE_KEY_PREFIX = `stock_v${STOCK_DATA_CACHE_VERSION}_`;
const LEGACY_STOCK_DATA_KEY_PREFIXES = ["stock_", "stock_v2_", "stock_v3_"];

export interface CachedStockData {
  cacheVersion: number;
  sources: SheetSource[];
  data: SIGData[];
  lastSync: string | null;
  savedAt: number;
}

type LastSavedRefs = {
  sources: SheetSource[];
  data: SIGData[];
  lastSync: string | null;
};

/**
 * El módulo de Consulta puede volver a ejecutar el efecto de persistencia por cambios
 * puramente visuales (por ejemplo, seleccionar otra IPRESS). Guardar nuevamente miles
 * de filas en IndexedDB en esos casos es trabajo innecesario.
 *
 * Se comparan referencias de los arrays, no un hash parcial del contenido: así nunca se
 * omite una escritura cuando React realmente entrega un dataset nuevo.
 */
const lastSavedRefsByUser = new Map<string, LastSavedRefs>();

const stockCacheKey = (username: string) => `${STOCK_DATA_CACHE_KEY_PREFIX}${username}`;

const removeLegacyBrowserStockCache = (username: string) => {
  if (!username || typeof localStorage === "undefined") return;
  try {
    // Estos keys pertenecen al caché antiguo de Consulta Stock. No se elimina la URL
    // configurada (`aura_sig_urls_*`) porque sigue siendo necesaria para reconectar con
    // Google Apps Script y volver a descargar la fuente oficial.
    localStorage.removeItem(`aura_sig_sources_${username}`);
    localStorage.removeItem(`aura_sig_data_${username}`);
    localStorage.removeItem(`aura_sig_lastsync_${username}`);
  } catch {
    // Algunos navegadores pueden bloquear localStorage; IndexedDB seguirá funcionando.
  }
};

const removeLegacyIndexedDbStockCache = async (username: string) => {
  for (const prefix of LEGACY_STOCK_DATA_KEY_PREFIXES) {
    try {
      await stockStore.removeItem(`${prefix}${username}`);
    } catch {
      // Si falla una limpieza legacy, el nuevo key versionado sigue aislado.
    }
  }
};

// Formato habitual del SISMED / Google Sheets: DD/MM/YYYY HH:MM:SS (nunca MM/DD).
const parseCachedDate = parseSheetDateTime;

const normalizeFieldName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const readRowValue = (row: Record<string, unknown>, aliases: string[]): string => {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== "") {
      return String(row[alias]).trim();
    }
  }

  const normalizedAliases = new Set(aliases.map(normalizeFieldName));
  const matchingKey = Object.keys(row).find((key) => normalizedAliases.has(normalizeFieldName(key)));
  if (!matchingKey) return "";

  const value = row[matchingKey];
  return value === undefined || value === null ? "" : String(value).trim();
};

/**
 * Recupera fechas desde las propias filas cacheadas cuando una versión antigua guardó
 * el source sin lastUpdate/lastUpdateTime. Esto permite reparar el estado de la tarjeta
 * sin volver a descargar cientos de registros desde Google Sheets.
 */
const getSourceDatesFromCachedRows = (
  sourceId: string,
  rowsBySource: Map<string, SIGData[]>,
): { lastUpdate: string; equipmentDate: string } => {
  const rows = rowsBySource.get(sourceId) || [];

  for (const rawRow of rows) {
    const row = rawRow as unknown as Record<string, unknown>;
    const lastUpdate = readRowValue(row, [
      "ULTIMA_ACTUALIZACION",
      "ULTIMA ACTUALIZACION",
      "Ultima_Actualizacion",
      "ultima_actualizacion",
    ]);
    const equipmentDate = readRowValue(row, [
      "FECHA_DEL_EQUIPO",
      "FECHA DEL EQUIPO",
      "Fecha_Del_Equipo",
      "fecha_equipo",
    ]);

    if (lastUpdate || equipmentDate) {
      return { lastUpdate, equipmentDate };
    }
  }

  return { lastUpdate: "", equipmentDate: "" };
};

const repairCachedSources = (sources: SheetSource[], data: SIGData[]): SheetSource[] => {
  const rowsBySource = new Map<string, SIGData[]>();
  for (const row of data) {
    const sourceId = String(row.sourceId || "").trim();
    if (!sourceId) continue;
    const list = rowsBySource.get(sourceId);
    if (list) list.push(row);
    else rowsBySource.set(sourceId, [row]);
  }

  return sources.map((source) => {
    const fallbackDates =
      source.lastUpdate && source.equipmentDate
        ? { lastUpdate: "", equipmentDate: "" }
        : getSourceDatesFromCachedRows(source.id, rowsBySource);

    const repairedLastUpdate = source.lastUpdate || fallbackDates.lastUpdate || undefined;
    const repairedEquipmentDate = source.equipmentDate || fallbackDates.equipmentDate || undefined;
    const repairedLastUpdateTime =
      source.lastUpdateTime || parseCachedDate(repairedLastUpdate || null) || undefined;
    const repairedEquipmentDateTime =
      source.equipmentDateTime || parseCachedDate(repairedEquipmentDate || null) || undefined;

    if (
      repairedLastUpdate === source.lastUpdate &&
      repairedEquipmentDate === source.equipmentDate &&
      repairedLastUpdateTime === source.lastUpdateTime &&
      repairedEquipmentDateTime === source.equipmentDateTime
    ) {
      return source;
    }

    return {
      ...source,
      lastUpdate: repairedLastUpdate,
      equipmentDate: repairedEquipmentDate,
      lastUpdateTime: repairedLastUpdateTime,
      equipmentDateTime: repairedEquipmentDateTime,
    };
  });
};

export const stockStorageService = {
  /**
   * Guarda el dataset completo de existencias en IndexedDB (sin límites de 5MB).
   * Evita reescribir el mismo dataset cuando solo cambió el estado de la interfaz.
   */
  async saveStockData(
    username: string,
    sources: SheetSource[],
    data: SIGData[],
    lastSync: Date | null
  ): Promise<boolean> {
    if (!username) return false;

    const lastSyncIso = lastSync ? lastSync.toISOString() : null;
    const previous = lastSavedRefsByUser.get(username);
    if (
      previous &&
      previous.sources === sources &&
      previous.data === data &&
      previous.lastSync === lastSyncIso
    ) {
      return true;
    }

    try {
      const payload: CachedStockData = {
        cacheVersion: STOCK_DATA_CACHE_VERSION,
        sources,
        data,
        lastSync: lastSyncIso,
        savedAt: Date.now(),
      };
      await stockStore.setItem(stockCacheKey(username), payload);
      lastSavedRefsByUser.set(username, {
        sources,
        data,
        lastSync: lastSyncIso,
      });
      return true;
    } catch (err) {
      console.warn("Error guardando datos en IndexedDB localforage:", err);
      return false;
    }
  },

  /**
   * Carga inmediatamente el dataset de existencias en caché desde IndexedDB.
   * También repara cachés creadas por versiones antiguas que guardaban la fecha en texto
   * o solamente dentro de las filas, pero no el timestamp usado por las tarjetas.
   *
   * v4 usa un key nuevo. Si el usuario solo tiene un key antiguo, se limpia y se devuelve
   * null para obligar a Consulta Stock a reconstruirse desde Google Sheets / Apps Script.
   */
  async loadStockData(username: string): Promise<CachedStockData | null> {
    if (!username) return null;
    try {
      const currentKey = stockCacheKey(username);
      const cached = await stockStore.getItem<CachedStockData>(currentKey);

      if (!cached || cached.cacheVersion !== STOCK_DATA_CACHE_VERSION) {
        lastSavedRefsByUser.delete(username);
        await stockStore.removeItem(currentKey);
        await removeLegacyIndexedDbStockCache(username);
        removeLegacyBrowserStockCache(username);
        return null;
      }

      // Limpieza preventiva: una vez existe v3, los keys previos ya no tienen utilidad.
      await removeLegacyIndexedDbStockCache(username);
      removeLegacyBrowserStockCache(username);

      if (Array.isArray(cached.data) && Array.isArray(cached.sources)) {
        const repairedSources = repairCachedSources(cached.sources, cached.data);
        const repaired: CachedStockData = {
          ...cached,
          cacheVersion: STOCK_DATA_CACHE_VERSION,
          sources: repairedSources,
        };

        if (repairedSources.some((source, index) => source !== cached.sources[index])) {
          const repairedPayload: CachedStockData = {
            ...repaired,
            savedAt: Date.now(),
          };
          await stockStore.setItem(currentKey, repairedPayload);
        }

        lastSavedRefsByUser.set(username, {
          sources: repairedSources,
          data: cached.data,
          lastSync: cached.lastSync || null,
        });

        return repaired;
      }
    } catch (err) {
      console.warn("Error cargando datos de IndexedDB localforage:", err);
    }
    return null;
  },

  /**
   * Guarda las configuraciones de URLs de UNGET.
   */
  async saveUrls(username: string, configs: UngetConfig[]): Promise<boolean> {
    if (!username) return false;
    try {
      await stockStore.setItem(`urls_${username}`, configs);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Carga las configuraciones de URLs desde IndexedDB.
   */
  async loadUrls(username: string): Promise<UngetConfig[] | null> {
    if (!username) return null;
    try {
      const configs = await stockStore.getItem<UngetConfig[]>(`urls_${username}`);
      if (Array.isArray(configs)) return configs;
    } catch {}
    return null;
  },

  /**
   * Limpia la caché del usuario.
   */
  async clearCache(username: string): Promise<void> {
    if (!username) return;
    try {
      lastSavedRefsByUser.delete(username);
      await stockStore.removeItem(stockCacheKey(username));
      await removeLegacyIndexedDbStockCache(username);
      await stockStore.removeItem(`urls_${username}`);
      removeLegacyBrowserStockCache(username);
    } catch {}
  },
};
