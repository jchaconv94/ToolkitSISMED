import localforage from "localforage";
import { SheetSource, SIGData, UngetConfig } from "../types";

// Configurar instancia aislada de localforage para Stock SIG
const stockStore = localforage.createInstance({
  name: "ToolkitSISMED",
  storeName: "sig_stock_cache",
  description: "Caché de alto rendimiento para datos de existencias de Google Sheets",
});

export interface CachedStockData {
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

const parseCachedDate = (value?: string | null): number => {
  if (!value) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  // Formato habitual del SISMED / Google Sheets: DD/MM/YYYY HH:MM:SS
  const match = raw.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (match) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
    const d = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    const ts = d.getTime();
    if (!Number.isNaN(ts)) return ts;
  }

  const native = new Date(raw).getTime();
  return Number.isNaN(native) ? 0 : native;
};

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
        sources,
        data,
        lastSync: lastSyncIso,
        savedAt: Date.now(),
      };
      await stockStore.setItem(`stock_${username}`, payload);
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
   */
  async loadStockData(username: string): Promise<CachedStockData | null> {
    if (!username) return null;
    try {
      const cached = await stockStore.getItem<CachedStockData>(`stock_${username}`);
      if (cached && Array.isArray(cached.data) && Array.isArray(cached.sources)) {
        const repairedSources = repairCachedSources(cached.sources, cached.data);
        const repaired: CachedStockData = {
          ...cached,
          sources: repairedSources,
        };

        // Si se reparó el source, persistir una sola vez la versión corregida. Así el
        // siguiente arranque ya no necesita inspeccionar las filas para reconstruir fechas.
        if (repairedSources.some((source, index) => source !== cached.sources[index])) {
          const repairedPayload: CachedStockData = {
            ...repaired,
            savedAt: Date.now(),
          };
          await stockStore.setItem(`stock_${username}`, repairedPayload);
        }

        // Marcar la versión cargada como la última persistida para que un cambio puramente
        // visual no provoque de inmediato otra serialización masiva del mismo dataset.
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
      await stockStore.removeItem(`stock_${username}`);
      await stockStore.removeItem(`urls_${username}`);
    } catch {}
  },
};
