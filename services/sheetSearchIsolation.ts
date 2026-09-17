// Consulta Stock (SIG_SEARCH) usa Google Sheets + Apps Script como única fuente de stock.
//
// Este adaptador existe como puente de compatibilidad mientras se elimina gradualmente la
// antigua UI de historial que Gemini mezcló con Supabase. Evita cualquier lectura/escritura
// en stock_sync_history desde SheetSearchModule sin tocar Monitoreo de Stock, que mantiene
// su arquitectura independiente basada en Supabase.

export const sheetSearchSupabase: null = null;

export const sheetSearchSyncService = {
  async getLatestSyncs(_establishmentIds?: string[]) {
    return {} as Record<string, never>;
  },

  async getHistoryForEstablishment(_facilityId: string, _limit = 15) {
    return [] as any[];
  },

  async registerSync(_args: {
    establishmentId: string;
    establishmentName: string;
    currentStock: any[];
    author: string;
    sheetLastUpdateDate?: string | number;
  }): Promise<{
    success: boolean;
    record?: any;
    hasChangesSinceLast: boolean;
    message?: string;
  }> {
    return {
      success: false,
      record: undefined,
      hasChangesSinceLast: false,
      message: "Consulta Stock usa Google Sheets y no registra snapshots en Supabase.",
    };
  },
};
