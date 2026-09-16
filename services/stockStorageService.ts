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

export const stockStorageService = {
  /**
   * Guarda el dataset completo de existencias en IndexedDB (sin límites de 5MB).
   */
  async saveStockData(
    username: string,
    sources: SheetSource[],
    data: SIGData[],
    lastSync: Date | null
  ): Promise<boolean> {
    if (!username) return false;
    try {
      const payload: CachedStockData = {
        sources,
        data,
        lastSync: lastSync ? lastSync.toISOString() : null,
        savedAt: Date.now(),
      };
      await stockStore.setItem(`stock_${username}`, payload);
      return true;
    } catch (err) {
      console.warn("Error guardando datos en IndexedDB localforage:", err);
      return false;
    }
  },

  /**
   * Carga inmediatamente el dataset de existencias en caché desde IndexedDB.
   */
  async loadStockData(username: string): Promise<CachedStockData | null> {
    if (!username) return null;
    try {
      const cached = await stockStore.getItem<CachedStockData>(`stock_${username}`);
      if (cached && Array.isArray(cached.data) && Array.isArray(cached.sources)) {
        return cached;
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
      await stockStore.removeItem(`stock_${username}`);
      await stockStore.removeItem(`urls_${username}`);
    } catch {}
  },
};
