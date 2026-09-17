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

const repairCachedSources = (sources: SheetSource[]): SheetSource[] =>
  sources.map((source) => {
    const repairedLastUpdateTime =
      source.lastUpdateTime || parseCachedDate(source.lastUpdate || null) || undefined;
    const repairedEquipmentDateTime =
      source.equipmentDateTime || parseCachedDate(source.equipmentDate || null) || undefined;

    if (
      repairedLastUpdateTime === source.lastUpdateTime &&
      repairedEquipmentDateTime === source.equipmentDateTime
    ) {
      return source;
    }

    return {
      ...source,
      lastUpdateTime: repairedLastUpdateTime,
      equipmentDateTime: repairedEquipmentDateTime,
    };
  });

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
   * pero no el timestamp usado por las tarjetas de estado (evita falsos "Sin datos").
   */
  async loadStockData(username: string): Promise<CachedStockData | null> {
    if (!username) return null;
    try {
      const cached = await stockStore.getItem<CachedStockData>(`stock_${username}`);
      if (cached && Array.isArray(cached.data) && Array.isArray(cached.sources)) {
        const repairedSources = repairCachedSources(cached.sources);
        const repaired: CachedStockData = {
          ...cached,
          sources: repairedSources,
        };

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
