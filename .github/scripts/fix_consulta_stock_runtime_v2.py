from pathlib import Path
import re


def read_text(path: str):
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    return text, nl


def write_text(path: str, text: str):
    Path(path).write_bytes(text.encode("utf-8"))


def adapt(value: str, nl: str) -> str:
    return value.replace("\r\n", "\n").replace("\n", nl)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: se esperaba 1 coincidencia y se encontraron {count}")
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# 1) Tipos: conservar nombre real de hoja, conteo metadata y código estable IPRESS
# -----------------------------------------------------------------------------
types, nl = read_text("types.ts")
old = adapt("""  equipmentDate?: string;
  equipmentDateTime?: number;
}""", nl)
new = adapt("""  equipmentDate?: string;
  equipmentDateTime?: number;
  /** Nombre real de la pestaña en Google Sheets; no usar el nombre visual para consultar GAS. */
  sheetName?: string;
  /** Cantidad de filas reportada por getMetadata; permite mostrar el conteo sin descargar el stock. */
  rowCount?: number;
  /** Código estable de IPRESS usado como llave preferente del historial en Supabase. */
  facilityCode?: string;
}""", nl)
if "sheetName?: string;" not in types:
    types = replace_once(types, old, new, "ampliar SheetSource")
write_text("types.ts", types)


# -----------------------------------------------------------------------------
# 2) Cache v4: v3 puede contener sources sin sheetName/facilityCode y datasets parciales
# -----------------------------------------------------------------------------
storage, snl = read_text("services/stockStorageService.ts")
storage = storage.replace("const STOCK_DATA_CACHE_VERSION = 3;", "const STOCK_DATA_CACHE_VERSION = 4;", 1)
storage = storage.replace(
    'const LEGACY_STOCK_DATA_KEY_PREFIXES = ["stock_", "stock_v2_"];',
    'const LEGACY_STOCK_DATA_KEY_PREFIXES = ["stock_", "stock_v2_", "stock_v3_"];',
    1,
)
storage = storage.replace(
    " * v3 fuerza una reconstrucción completa desde Google Sheets después de detectar cachés\n * históricas con fechas de vencimiento que podían conservar día/mes intercambiados.",
    " * v4 reconstruye solo el directorio ligero desde metadata y evita reutilizar sources v3\n * que no conocían el nombre real de hoja, rowCount ni la llave estable del historial.",
    1,
)
storage = storage.replace(
    " * v3 usa un key nuevo. Si el usuario solo tiene un key antiguo, se limpia y se devuelve",
    " * v4 usa un key nuevo. Si el usuario solo tiene un key antiguo, se limpia y se devuelve",
    1,
)
write_text("services/stockStorageService.ts", storage)


# -----------------------------------------------------------------------------
# 3) GAS: endpoint exacto de una sola hoja para carga bajo demanda
# -----------------------------------------------------------------------------
gas, gnl = read_text("services/gasConnectionService.ts")
if "export async function fetchGasSingleSheet" not in gas:
    marker = adapt("""/**
 * Descarga selectiva únicamente de las hojas que cambiaron.
 */
export async function fetchGasSelectiveSheets(""", gnl)
    addition = adapt("""/**
 * Descarga una sola hoja mediante el endpoint exacto getStock.
 * Es la ruta preferida cuando el usuario abre un establecimiento: evita leer el libro completo.
 */
export async function fetchGasSingleSheet(
  rawUrl: string,
  sheetName: string,
  options: { timeoutMs?: number } = {}
): Promise<any> {
  const cleanUrl = normalizeGasBaseUrl(rawUrl || "");
  const cleanSheetName = (sheetName || "").trim();
  if (!cleanUrl || !cleanSheetName) return [];

  const sep = cleanUrl.includes("?") ? "&" : "?";
  const singleUrl = `${cleanUrl}${sep}action=getStock&sheet=${encodeURIComponent(cleanSheetName)}&_t=${Date.now()}`;
  return await fetchGasWithResilience(singleUrl, {
    timeoutMs: options.timeoutMs || 25000,
  });
}

/**
 * Descarga selectiva únicamente de las hojas que cambiaron.
 */
export async function fetchGasSelectiveSheets(""", gnl)
    gas = replace_once(gas, marker, addition, "agregar fetchGasSingleSheet")
write_text("services/gasConnectionService.ts", gas)


# -----------------------------------------------------------------------------
# 4) Supabase: últimos movimientos sin descargar changes_metadata/items_snapshot gigantes
# -----------------------------------------------------------------------------
supa, unl = read_text("services/supabaseClient.ts")
start = supa.index("  async getLatestSyncs(")
end = supa.index("  /**\n   * Fetch full sync history log", start)
segment = supa[start:end]
light_select = '.select("id,establishment_id,establishment_name,sync_date,record_count,stock_hash,has_changes,changed_items_count,sync_author,created_at,last_modification_date")'
segment = segment.replace('.select("*")', light_select)
supa = supa[:start] + segment + supa[end:]
write_text("services/supabaseClient.ts", supa)


# -----------------------------------------------------------------------------
# 5) Consulta Stock: metadata-first real, historial estable y stock bajo demanda
# -----------------------------------------------------------------------------
sheet, qnl = read_text("components/SheetSearchModule.tsx")

# Importar fetch exacto de una hoja.
sheet = sheet.replace(
    adapt("""  fetchGasMetadata,
  fetchGasSelectiveSheets,
}""", qnl),
    adapt("""  fetchGasMetadata,
  fetchGasSelectiveSheets,
  fetchGasSingleSheet,
}""", qnl),
    1,
)

# Helpers de identidad estable.
if "const getHistoryKeysForSource" not in sheet:
    marker = "const alignConfigsWithOfficialUngets"
    idx = sheet.index(marker)
    helper = adapt("""const getCleanSourceId = (sourceId: string): string =>
  sourceId.includes("_") ? sourceId.split("_").slice(1).join("_") : sourceId;

const extractFacilityCodeFromSheetName = (name?: string): string => {
  const match = String(name || "").trim().match(/-([A-Z0-9]+)\\s*$/i);
  return match?.[1]?.toUpperCase() || "";
};

const getHistoryKeysForSource = (source: SheetSource): string[] =>
  Array.from(
    new Set(
      [source.facilityCode, source.id, getCleanSourceId(source.id)]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

""", qnl)
    sheet = sheet[:idx] + helper + sheet[idx:]

# loadSupabaseSyncs: incluir código estable y devolver el mapa resuelto.
start = sheet.index("  const loadSupabaseSyncs = async (")
end = sheet.index("  const handleShowSyncHistory", start)
new_load = adapt("""  const loadSupabaseSyncs = async (forceSources?: SheetSource[]) => {
    if (!supabase) return {} as Record<string, any>;
    const targetSources = forceSources || sources;
    if (targetSources.length === 0) return {} as Record<string, any>;

    setIsCheckingLatestSyncs(true);
    try {
      const allPossibleIds = Array.from(
        new Set(targetSources.flatMap((source) => getHistoryKeysForSource(source))),
      );
      const latestSyncs = await supabaseService.getLatestSyncs(allPossibleIds);
      const mappedSyncs: Record<string, any> = { ...latestSyncs };

      targetSources.forEach((source) => {
        const candidates = getHistoryKeysForSource(source)
          .map((key) => latestSyncs[key])
          .filter(Boolean)
          .sort(
            (a, b) =>
              new Date(b.sync_date || 0).getTime() -
              new Date(a.sync_date || 0).getTime(),
          );
        const record = candidates[0];
        if (!record) return;
        mappedSyncs[source.id] = record;
        getHistoryKeysForSource(source).forEach((key) => {
          if (!mappedSyncs[key]) mappedSyncs[key] = record;
        });
      });

      setSupabaseSyncs((prev) => ({ ...prev, ...mappedSyncs }));
      return mappedSyncs;
    } catch (e) {
      console.warn("Error cargando historial de Supabase:", e);
      return {} as Record<string, any>;
    } finally {
      setIsCheckingLatestSyncs(false);
    }
  };

""", qnl)
sheet = sheet[:start] + new_load + sheet[end:]

# handleShowSyncHistory: probar código IPRESS, id actual y gid legado; si no existe, cargar solo esa hoja y sembrar historial.
start = sheet.index("  const handleShowSyncHistory = async (")
end = sheet.index("  // Función ultra-resiliente", start)
new_history = adapt("""  const handleShowSyncHistory = async (source: SheetSource) => {
    if (!supabase) {
      toast.error("Supabase no está configurado.");
      return;
    }

    setActiveHistoryFacility({ id: source.id, name: source.name });
    setIsSyncHistoryModalOpen(true);
    setSelectedFacilitySyncHistory([]);
    setIsLoadingHistory(true);

    try {
      const keys = getHistoryKeysForSource(source);
      const historyResults = await Promise.all(
        keys.map((key) => supabaseService.getHistoryForEstablishment(key)),
      );
      let history = historyResults
        .flat()
        .filter(
          (row, index, arr) =>
            index === arr.findIndex((other) => other.id === row.id),
        )
        .sort(
          (a, b) =>
            new Date(b.sync_date || 0).getTime() -
            new Date(a.sync_date || 0).getTime(),
        );

      if (history.length === 0) {
        const loaded = await loadSingleSourceStock(source.id, true);
        if (loaded) {
          const stableId = source.facilityCode || getCleanSourceId(source.id);
          history = await supabaseService.getHistoryForEstablishment(stableId);
        }
      }

      setSelectedFacilitySyncHistory(history || []);
      if (history.length > 0) {
        const latest = history[0];
        setSupabaseSyncs((prev) => ({
          ...prev,
          [source.id]: latest,
          ...Object.fromEntries(keys.map((key) => [key, latest])),
        }));
      }
    } catch (e) {
      console.error("Error al cargar historial:", e);
      toast.error("Error al cargar el historial de cambios.");
    } finally {
      setIsLoadingHistory(false);
    }
  };

""", qnl)
sheet = sheet[:start] + new_history + sheet[end:]

# Cold start metadata: conservar identidad, conteo y no descargar las 22 hojas de golpe.
preview_start = sheet.index("                const previewSources: SheetSource[] = initialMetadata.map((meta) => {")
preview_end = sheet.index("                if (supabase) {", preview_start)
preview_block = sheet[preview_start:preview_end]
preview_block = preview_block.replace(
    "                    equipmentDateTime: parseDataDate(meta.equipmentDate || \"\") || undefined,",
    adapt("""                    equipmentDateTime: parseDataDate(meta.equipmentDate || "") || undefined,
                    sheetName: meta.name,
                    rowCount: meta.rowCount || 0,
                    facilityCode:
                      assignment?.facilityCode ||
                      meta.codigoIpress ||
                      extractFacilityCodeFromSheetName(meta.name) ||
                      undefined,""", qnl),
    1,
)
sheet = sheet[:preview_start] + preview_block + sheet[preview_end:]

sheet = sheet.replace(
    "                  void loadSupabaseSyncs(previewSources.map((source) => source.id));",
    "                  void loadSupabaseSyncs(previewSources);",
    1,
)

# Quitar el preload masivo de 22 hojas. Metadata ya hace utilizable la pantalla.
batch_start = sheet.index("                const names = initialMetadata.map((meta) => meta.name).filter(Boolean);")
batch_end = sheet.index("            if (hasExistingData) {", batch_start)
replacement = adapt("""                accumulatedSources.push(...previewSources);
                setConnectionErrors((prev) => {
                  const updated = { ...prev };
                  delete updated[config.url];
                  return updated;
                });
                return;
              }
            }

""", qnl)
sheet = sheet[:batch_start] + replacement + sheet[batch_end:]

# En delta-sync, una hoja que aún no fue abierta no debe disparar descarga masiva.
anchor = adapt("""                  const metaEqTs = parseDataDate(metaEqStr);
                  const existingEqTs = existing?.equipmentDateTime || parseDataDate(existingEqStr);

                  // Evaluate lastUpdate match strictly""", qnl)
insert = adapt("""                  const metaEqTs = parseDataDate(metaEqStr);
                  const existingEqTs = existing?.equipmentDateTime || parseDataDate(existingEqStr);

                  // Si la hoja todavía no fue abierta, refrescamos solo metadata. El stock se carga bajo demanda.
                  if (existing && !hasSheetData) {
                    unchangedSources.push({
                      ...existing,
                      sheetName: existing.sheetName || meta.name,
                      rowCount: meta.rowCount ?? existing.rowCount,
                      facilityCode:
                        existing.facilityCode ||
                        meta.codigoIpress ||
                        extractFacilityCodeFromSheetName(meta.name) ||
                        undefined,
                      lastUpdate: metaLastStr || existing.lastUpdate,
                      lastUpdateTime: metaLastTs || existing.lastUpdateTime,
                      equipmentDate: metaEqStr || existing.equipmentDate,
                      equipmentDateTime: metaEqTs || existing.equipmentDateTime,
                    });
                    return;
                  }

                  // Evaluate lastUpdate match strictly""", qnl)
sheet = replace_once(sheet, anchor, insert, "evitar descarga de hojas no abiertas")

# Sources provenientes de una descarga real también conservan identidad estable.
needle = adapt("""              thisSources.push({
                id: uniqueSourceId,
                name: displayName,
                urlIndex,
                lastUpdate: lastUpdateStr,""", qnl)
replacement = adapt("""              thisSources.push({
                id: uniqueSourceId,
                name: displayName,
                urlIndex,
                sheetName: sheet.name,
                rowCount: Array.isArray(sheet.data) ? sheet.data.length : 0,
                facilityCode: extractFacilityCodeFromSheetName(sheet.name) || undefined,
                lastUpdate: lastUpdateStr,""", qnl)
sheet = replace_once(sheet, needle, replacement, "identidad source descargado")

# Registrar historial con llave estable, no con urlIndex_gid mutable.
needle = adapt("""            const syncPromises = sourcesForHistory.map((sheet) => {
              const sheetItems = dataForHistory.filter((r) => r.sourceId === sheet.id);
              const userAuthor = user?.username || "AutoSync";
              return supabaseService.registerSync({
                establishmentId: sheet.id,""", qnl)
replacement = adapt("""            const syncPromises = sourcesForHistory.map((sheet) => {
              const sheetItems = dataForHistory.filter((r) => r.sourceId === sheet.id);
              const userAuthor = user?.username || "AutoSync";
              const stableHistoryId = sheet.facilityCode || getCleanSourceId(sheet.id);
              return supabaseService.registerSync({
                establishmentId: stableHistoryId,""", qnl)
sheet = replace_once(sheet, needle, replacement, "llave estable historial background")

# Un cache metadata-only también cuenta como cache válido para evitar golpear GAS de nuevo al reingresar.
sheet = sheet.replace(
    "        const hasCachedDataset = sources.length > 0 && data.length > 0;",
    "        const hasCachedDataset = sources.length > 0;",
    1,
)

# Carga bajo demanda de una sola hoja al abrir un establecimiento.
old_select = adapt("""  const handleSelectSheet = (sourceId: string) => {
    if (isTableFullscreen) {
      setStockModalSourceId(sourceId);
      setStockModalSearchTerm("");
    } else {
      setSelectedSourceId(sourceId);
      setViewLevel("data");
      setSearchTerm("");
    }
  };
""", qnl)
new_select = adapt("""  const loadSingleSourceStock = async (
    sourceId: string,
    registerHistory: boolean = true,
  ): Promise<boolean> => {
    if (data.some((row) => row.sourceId === sourceId)) return true;

    const source = sources.find((item) => item.id === sourceId);
    if (!source) return false;
    const config = scriptUrls[source.urlIndex];
    if (!config?.url) return false;

    const assignment = allAssignments.find(
      (item) =>
        item.sheetUrl === config.url &&
        ((source.facilityCode && item.facilityCode === source.facilityCode) ||
          (source.sheetName && item.sheetName === source.sheetName)),
    );
    const realSheetName = source.sheetName || assignment?.sheetName || source.name;

    try {
      const payload = await fetchGasSingleSheet(config.url, realSheetName, {
        timeoutMs: 25000,
      });
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("La hoja no devolvió datos válidos.");
      }

      const sheetPayload = payload[0];
      const rows = Array.isArray(sheetPayload.data) ? sheetPayload.data : [];
      const firstRow = rows[0] || {};
      const lastUpdateStr = getRowFieldValue(
        firstRow,
        "ULTIMA ACTUALIZACION",
        "ULTIMA_ACTUALIZACION",
        "ULTIMA ACTUALIZACIÓN",
        "Ultima_Actualizacion",
      );
      const equipmentDateStr = getRowFieldValue(
        firstRow,
        "FECHA DEL EQUIPO",
        "FECHA_DEL_EQUIPO",
        "Fecha_Del_Equipo",
      );
      const validData = rows
        .map((row: any) =>
          normalizeRowData(
            row,
            lastUpdateStr,
            equipmentDateStr,
            sourceId,
          ),
        )
        .filter((row: any): row is SIGData => row !== null);

      const stableFacilityCode =
        source.facilityCode ||
        assignment?.facilityCode ||
        extractFacilityCodeFromSheetName(sheetPayload.name || realSheetName) ||
        undefined;
      const updatedSource: SheetSource = {
        ...source,
        sheetName: sheetPayload.name || realSheetName,
        rowCount: validData.length,
        facilityCode: stableFacilityCode,
        lastUpdate: lastUpdateStr || source.lastUpdate,
        lastUpdateTime: parseDataDate(lastUpdateStr) || source.lastUpdateTime,
        equipmentDate: equipmentDateStr || source.equipmentDate,
        equipmentDateTime:
          parseDataDate(equipmentDateStr) || source.equipmentDateTime,
      };

      setSources((prev) =>
        prev.map((item) => (item.id === sourceId ? updatedSource : item)),
      );
      setData((prev) => [
        ...prev.filter((row) => row.sourceId !== sourceId),
        ...validData,
      ]);

      if (supabase && registerHistory && validData.length > 0) {
        const stableHistoryId =
          stableFacilityCode || getCleanSourceId(sourceId);
        void supabaseService
          .registerSync({
            establishmentId: stableHistoryId,
            establishmentName: source.name,
            currentStock: validData,
            author: user?.username || "ConsultaStock",
            sheetLastUpdateDate: updatedSource.lastUpdateTime
              ? new Date(updatedSource.lastUpdateTime).toISOString()
              : undefined,
          })
          .then((result) => {
            if (!result.success || !result.record) return;
            setSupabaseSyncs((prev) => ({
              ...prev,
              [sourceId]: result.record,
              [stableHistoryId]: result.record,
            }));
          })
          .catch((err) =>
            console.warn("No se pudo actualizar el historial en segundo plano:", err),
          );
      }

      return true;
    } catch (err: any) {
      console.error("Error cargando una hoja bajo demanda:", err);
      toast.error(
        `No se pudo cargar ${source.name}: ${err?.message || "Error de conexión"}`,
      );
      return false;
    }
  };

  const handleSelectSheet = async (sourceId: string) => {
    const loaded = await loadSingleSourceStock(sourceId, true);
    if (!loaded) return;

    if (isTableFullscreen) {
      setStockModalSourceId(sourceId);
      setStockModalSearchTerm("");
    } else {
      setSelectedSourceId(sourceId);
      setViewLevel("data");
      setSearchTerm("");
    }
  };
""", qnl)
sheet = replace_once(sheet, old_select, new_select, "carga bajo demanda")

# La tarjeta muestra rowCount de metadata aunque la hoja aún no se haya abierto.
sheet = sheet.replace(
    "                                  totalItems: sheetData.length,",
    "                                  totalItems: sheetData.length > 0 ? sheetData.length : sheet.rowCount || 0,",
    1,
)

# Resolver historial por código estable además de ids legados.
sheet = sheet.replace(
    "                                const syncRecord = supabaseSyncs[sheet.id] || supabaseSyncs[cleanSheetId] || (code ? supabaseSyncs[code] : undefined);",
    "                                const syncRecord = supabaseSyncs[sheet.id] || (sheet.facilityCode ? supabaseSyncs[sheet.facilityCode] : undefined) || supabaseSyncs[cleanSheetId] || (code ? supabaseSyncs[code] : undefined);",
    1,
)

sheet = sheet.replace(
    "                                    onShowHistory={() => handleShowSyncHistory(sheet.id, sheet.name)}",
    "                                    onShowHistory={() => handleShowSyncHistory(sheet)}",
    1,
)

write_text("components/SheetSearchModule.tsx", sheet)

print("Corrección Consulta Stock runtime v2 aplicada.")
