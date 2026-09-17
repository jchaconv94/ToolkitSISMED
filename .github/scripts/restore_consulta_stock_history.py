from pathlib import Path
import subprocess

OLD_COMMIT = "b29d2f220976f77633dc4edc0796c8fd9b6e48eb"
SHEET_PATH = Path("components/SheetSearchModule.tsx")


def read_raw(path: Path):
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    return text, nl


def write_raw(path: Path, text: str):
    path.write_bytes(text.encode("utf-8"))


def with_nl(value: str, nl: str) -> str:
    return value.replace("\r\n", "\n").replace("\n", nl)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: se esperaba 1 coincidencia y se encontraron {count}")
    return source.replace(old, new, 1)


# Guardar la versión actual porque contiene la optimización metadata-first.
current_text, _ = read_raw(SHEET_PATH)

# Restaurar como base la última versión que todavía tenía el historial completo.
old_raw = subprocess.check_output([
    "git", "show", f"{OLD_COMMIT}:components/SheetSearchModule.tsx"
])
text = old_raw.decode("utf-8")
nl = "\r\n" if "\r\n" in text else "\n"

# 1) Mantener metadata-first de la versión optimizada actual.
current_marker = current_text.index("// 1. METADATA PRIMERO")
cold_start = current_text.index("            if (!hasExistingData) {", current_marker)
cold_end = current_text.index("            if (hasExistingData) {", cold_start)
cold_block = with_nl(current_text[cold_start:cold_end], nl)

old_comment = "          // 1. INTENTO DE DELTA SYNC INTELIGENTE (si no es forzado y ya tenemos datos)"
new_comment = (
    "          // 1. METADATA PRIMERO. Sin caché mostramos el directorio antes de descargar" + nl
    + "          // todos los medicamentos. Con caché se mantiene el delta-sync normal."
)
text = replace_once(text, old_comment, new_comment, "comentario metadata-first")

marker = "            if (hasExistingData) {"
idx = text.index(marker, text.index("const hasExistingData"))
text = text[:idx] + cold_block + text[idx:]

# Consultar el historial apenas aparecen las tarjetas por metadata, sin bloquear Google Sheets.
preview_anchor = (
    "                setSources((prev) => [" + nl
    + "                  ...prev.filter((source) => source.urlIndex !== urlIndex)," + nl
    + "                  ...previewSources," + nl
    + "                ]);" + nl
)
preview_new = preview_anchor + (
    nl
    + "                if (supabase) {" + nl
    + "                  void loadSupabaseSyncs(previewSources.map((source) => source.id));" + nl
    + "                }" + nl
)
text = replace_once(text, preview_anchor, preview_new, "consulta historial tras metadata")

# 2) Estado específico para la consulta de historial.
state_anchor = "  const [isLoadingHistory, setIsLoadingHistory] = useState(false);" + nl
state_new = state_anchor + "  const [isCheckingLatestSyncs, setIsCheckingLatestSyncs] = useState(false);" + nl
text = replace_once(text, state_anchor, state_new, "estado historial")

# 3) Separar selección visual del efecto de persistencia de miles de filas.
old_tail = (
    "    if (" + nl
    + "      sources.length > 0 &&" + nl
    + "      selectedSourceId !== \"\" &&" + nl
    + "      !sources.find((s) => s.id === selectedSourceId)" + nl
    + "    ) {" + nl
    + "      setSelectedSourceId(\"\");" + nl
    + "    }" + nl
    + "  }, [scriptUrls, sources, data, selectedSourceId, user, isConfigLoading, lastGlobalSync]);" + nl + nl
    + "  const loadSupabaseSyncs"
)
new_tail = (
    "  }, [scriptUrls, sources, data, user, isConfigLoading, lastGlobalSync]);" + nl + nl
    + "  // La selección es estado visual y no debe provocar persistencia masiva en IndexedDB." + nl
    + "  useEffect(() => {" + nl
    + "    if (" + nl
    + "      sources.length > 0 &&" + nl
    + "      selectedSourceId !== \"\" &&" + nl
    + "      !sources.find((s) => s.id === selectedSourceId)" + nl
    + "    ) {" + nl
    + "      setSelectedSourceId(\"\");" + nl
    + "    }" + nl
    + "  }, [sources, selectedSourceId]);" + nl + nl
    + "  const loadSupabaseSyncs"
)
text = replace_once(text, old_tail, new_tail, "separar persistencia y selección")

# 4) Cargar últimos movimientos desde Supabase en paralelo.
start = text.index("  const loadSupabaseSyncs = async (forceIds?: string[]) => {")
end = text.index("  const handleShowSyncHistory", start)
load_block = with_nl(
    '''  const loadSupabaseSyncs = async (forceIds?: string[]) => {
    if (!supabase) return;
    const sheetIds = forceIds || sources.map((s) => s.id);
    if (sheetIds.length === 0) return;

    setIsCheckingLatestSyncs(true);
    try {
      const allPossibleIds = new Set<string>();
      sheetIds.forEach((id) => {
        allPossibleIds.add(id);
        if (id.includes("_")) {
          allPossibleIds.add(id.split("_").slice(1).join("_"));
        }
      });

      const latestSyncs = await supabaseService.getLatestSyncs(Array.from(allPossibleIds));
      const mappedSyncs: Record<string, any> = { ...latestSyncs };

      // Compatibilidad con historiales guardados con o sin el prefijo urlIndex_.
      sheetIds.forEach((id) => {
        const cleanId = id.includes("_") ? id.split("_").slice(1).join("_") : id;
        const record = latestSyncs[id] || latestSyncs[cleanId];
        if (record) {
          mappedSyncs[id] = record;
          mappedSyncs[cleanId] = record;
        }
      });

      setSupabaseSyncs((prev) => ({ ...prev, ...mappedSyncs }));
    } catch (e) {
      console.warn("Error cargando historial de Supabase:", e);
    } finally {
      setIsCheckingLatestSyncs(false);
    }
  };

''',
    nl,
)
text = text[:start] + load_block + text[end:]

# 5) Llevar al historial solo hojas realmente descargadas/cambiadas.
arrays_old = (
    "      let accumulatedData: SIGData[] = [];" + nl
    + "      let accumulatedSources: SheetSource[] = [];" + nl
)
arrays_new = arrays_old + (
    "      let historyData: SIGData[] = [];" + nl
    + "      let historySources: SheetSource[] = [];" + nl
)
text = replace_once(text, arrays_old, arrays_new, "arrays historial")

payload_idx = text.index("          if (Array.isArray(sheetsPayload)) {")
selective_idx = text.index("            if (isSelective) {", payload_idx)
history_collect = with_nl(
    '''            // El historial usa únicamente snapshots derivados del stock recién leído de Google Sheets.
            historySources.push(...thisSources);
            historyData.push(...thisData);

''',
    nl,
)
text = text[:selective_idx] + history_collect + text[selective_idx:]

# 6) Registrar/comparar snapshots en segundo plano: Supabase no debe retrasar la sincronización GAS.
sync_start = text.index("      if (supabase && accumulatedSources.length > 0) {")
sync_end = text.index("      if (accumulatedData.length === 0", sync_start)
background_sync = with_nl(
    '''      if (supabase && historySources.length > 0) {
        const sourcesForHistory = [...historySources];
        const dataForHistory = [...historyData];
        setIsCheckingLatestSyncs(true);

        void (async () => {
          try {
            const syncPromises = sourcesForHistory.map((sheet) => {
              const sheetItems = dataForHistory.filter((r) => r.sourceId === sheet.id);
              const userAuthor = user?.username || "AutoSync";
              return supabaseService.registerSync({
                establishmentId: sheet.id,
                establishmentName: sheet.name,
                currentStock: sheetItems,
                author: userAuthor,
                sheetLastUpdateDate: sheet.lastUpdateTime
                  ? new Date(sheet.lastUpdateTime).toISOString()
                  : undefined,
              });
            });

            const results = await Promise.allSettled(syncPromises);
            setSupabaseSyncs((prev) => {
              const updated = { ...prev };
              results.forEach((res, i) => {
                if (res.status !== "fulfilled" || !res.value.success || !res.value.record) return;

                const recordToSave = { ...res.value.record };
                if (recordToSave.has_changes && !recordToSave.last_modification_date) {
                  recordToSave.last_modification_date = recordToSave.sync_date;
                }

                const rawId = sourcesForHistory[i]?.id;
                if (!rawId) return;
                const cleanId = rawId.includes("_")
                  ? rawId.split("_").slice(1).join("_")
                  : rawId;
                updated[rawId] = recordToSave;
                updated[cleanId] = recordToSave;
              });
              return updated;
            });
          } catch (err) {
            console.warn("Error registrando historial de cambios en segundo plano:", err);
          } finally {
            setIsCheckingLatestSyncs(false);
          }
        })();
      }

''',
    nl,
)
text = text[:sync_start] + background_sync + text[sync_end:]

# 7) Reingreso rápido: respetar caché reciente, pero cargar historial independientemente.
mount_old = with_nl(
    '''      if (scriptUrls.length > 0) {
        // Siempre hacemos fetch de manera silenciosa para no bloquear la pantalla, como sugirió el usuario.
        fetchData(undefined, true);
        if (supabase) {
          loadSupabaseSyncs().catch((e) => console.warn(e));
        }
      } else {''',
    nl,
)
mount_new = with_nl(
    '''      if (scriptUrls.length > 0) {
        const hasCachedDataset = sources.length > 0 && data.length > 0;
        const lastSyncAgeMs = lastGlobalSync
          ? Date.now() - lastGlobalSync.getTime()
          : Number.POSITIVE_INFINITY;
        const CACHE_RECHECK_WINDOW_MS = 5 * 60 * 1000;

        if (!hasCachedDataset || lastSyncAgeMs >= CACHE_RECHECK_WINDOW_MS) {
          fetchData(undefined, true);
        }
        if (supabase && sources.length > 0) {
          loadSupabaseSyncs().catch((e) => console.warn(e));
        }
      } else {''',
    nl,
)
text = replace_once(text, mount_old, mount_new, "reingreso rápido con historial")

# 8) Etiquetas de UI y estado de historial real.
button_old = with_nl(
    '''              {isLoading || isSilentSyncing
                ? "Sincronizando..."
                : "Sincronizar"}''',
    nl,
)
button_new = with_nl(
    '''              {isLoading
                ? "Sincronizando..."
                : isSilentSyncing
                  ? "Verificando..."
                  : "Sincronizar"}''',
    nl,
)
text = replace_once(text, button_old, button_new, "texto botón sincronizar")

card_check_old = "                                  isCheckingSync: isLoading || isSilentSyncing," + nl
card_check_new = "                                  isCheckingSync: isCheckingLatestSyncs," + nl
text = replace_once(text, card_check_old, card_check_new, "estado historial en tarjeta")

write_raw(SHEET_PATH, text)

# 9) Revertir el intento anterior de ocultar el historial en la tarjeta compartida/captura.
subprocess.run(
    [
        "git", "checkout", "origin/main", "--",
        "components/EstablishmentCard.tsx",
        "components/DeficiencyCaptureModal.tsx",
    ],
    check=True,
)

# 10) getLatestSyncs: una consulta Supabase para todos los IDs en vez de N consultas.
svc_path = Path("services/supabaseClient.ts")
svc, svc_nl = read_raw(svc_path)
svc_start = svc.index("      if (establishmentIds && establishmentIds.length > 0) {")
svc_end = svc.index("      // Fallback: Query the latest records generally", svc_start)
svc_bulk = with_nl(
    '''      if (establishmentIds && establishmentIds.length > 0) {
        const uniqueIds = Array.from(new Set(establishmentIds.filter(Boolean)));
        if (uniqueIds.length === 0) return latestMap;

        // Una sola consulta para todos los establecimientos; se conserva el más reciente de cada uno.
        const { data, error } = await supabase
          .from("stock_sync_history")
          .select("*")
          .in("establishment_id", uniqueIds)
          .order("sync_date", { ascending: false });

        if (error) throw error;
        (data || []).forEach((row: StockSyncRecord) => {
          if (!latestMap[row.establishment_id]) {
            latestMap[row.establishment_id] = row;
          }
          if (
            row.has_changes &&
            !latestMap[row.establishment_id].last_modification_date
          ) {
            latestMap[row.establishment_id].last_modification_date = row.sync_date;
          }
        });
        return latestMap;
      }

''',
    svc_nl,
)
svc = svc[:svc_start] + svc_bulk + svc[svc_end:]
write_raw(svc_path, svc)

# 11) Corregir la documentación arquitectónica para futuras modificaciones.
agents_path = Path("AGENTS.md")
agents, _ = read_raw(agents_path)
agents_old = "**No introducir fallbacks cruzados, no leer `stock_actual` desde Consulta Stock y no registrar sus hojas en `stock_sync_history`.** Supabase puede alojar configuración general, pero no es la fuente de inventario de `SIG_SEARCH`."
agents_new = "**No introducir fallbacks cruzados y no leer `stock_actual` desde Consulta Stock.** Supabase **sí** se usa en Consulta Stock para el historial/auditoría en `stock_sync_history`: los snapshots se construyen exclusivamente a partir del stock leído de Google Sheets y nunca sustituyen la fuente de inventario de `SIG_SEARCH`."
if agents_old not in agents:
    raise RuntimeError("No se encontró la regla de arquitectura en AGENTS.md")
write_raw(agents_path, agents.replace(agents_old, agents_new, 1))

docs_path = Path("docs/DESKTOP_INTEGRATION_SISMED_2.0.md")
docs, _ = read_raw(docs_path)
docs_old = "**Consulta Stock (`SIG_SEARCH` / `SheetSearchModule`)**: Google Sheets → Google Apps Script → IndexedDB → web. No consume `stock_actual` ni `stock_sync_history` como fuente de inventario."
docs_new = "**Consulta Stock (`SIG_SEARCH` / `SheetSearchModule`)**: Google Sheets → Google Apps Script → IndexedDB → web para el inventario. No consume `stock_actual`. Supabase `stock_sync_history` se usa únicamente para guardar y consultar el historial/auditoría de cambios derivados de esos snapshots de Google Sheets."
if docs_old not in docs:
    raise RuntimeError("No se encontró la regla de Consulta Stock en la documentación")
write_raw(docs_path, docs.replace(docs_old, docs_new, 1))
