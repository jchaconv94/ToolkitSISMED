from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "components" / "SheetSearchModule.tsx"
GAS = ROOT / "services" / "gasConnectionService.ts"
DOC = ROOT / "docs" / "DESKTOP_INTEGRATION_SISMED_2.0.md"
AGENTS = ROOT / "AGENTS.md"


def one_sub(text, pattern, repl, label, flags=0):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise RuntimeError(f"{label}: esperado=1 encontrado={n}")
    return new


def one_replace(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: esperado=1 encontrado={n}")
    return text.replace(old, new, 1)


text = SHEET.read_text(encoding="utf-8")

# 1. Fuente de inventario: solo Google Sheets / Apps Script.
text = one_replace(text, 'import { supabaseService, supabase } from "../services/supabaseClient";\n', '', 'import supabase')
text = one_sub(
    text,
    r'\n  // Supabase Sync States\n.*?\n  // Filtros Avanzados \(Sidebar Derecha\)',
    '\n\n  // Filtros Avanzados (Sidebar Derecha)',
    'estados de historial Supabase',
    re.S,
)
text = one_sub(
    text,
    r'\n  const \[filterMovementsUnit, setFilterMovementsUnit\].*?\n  >\("with"\);',
    '',
    'estados filtro movimientos',
    re.S,
)

# 2. Seleccionar una tarjeta no debe disparar persistencia del dataset.
text = one_sub(
    text,
    r'\n    if \(\n      sources\.length > 0 &&\n      selectedSourceId !== "" &&\n      !sources\.find\(\(s\) => s\.id === selectedSourceId\)\n    \) \{\n      setSelectedSourceId\(""\);\n    \}\n  \}, \[scriptUrls, sources, data, selectedSourceId, user, isConfigLoading, lastGlobalSync\]\);',
    '''\n  }, [scriptUrls, sources, data, user, isConfigLoading, lastGlobalSync]);\n\n  // Estado puramente visual: validar la selección sin reescribir miles de filas en IndexedDB.\n  useEffect(() => {\n    if (\n      sources.length > 0 &&\n      selectedSourceId !== "" &&\n      !sources.find((s) => s.id === selectedSourceId)\n    ) {\n      setSelectedSourceId("");\n    }\n  }, [sources, selectedSourceId]);''',
    'dependencia selectedSourceId',
)

# 3. Eliminar historial/autoregistro de stock en Supabase desde Consulta Stock.
text = one_sub(
    text,
    r'\n  const loadSupabaseSyncs = async \(forceIds\?: string\[\]\) => \{.*?\n  // Función ultra-resiliente para obtener JSON de Web App de Google Apps Script con diagnóstico y proxies',
    '\n\n  // Conexión resiliente para obtener JSON de Google Apps Script.',
    'funciones historial Supabase',
    re.S,
)

# 4. Cold start: metadatos primero, tarjetas inmediatas, inventario en grupos de 8 hojas.
old = '''          // 1. INTENTO DE DELTA SYNC INTELIGENTE (si no es forzado y ya tenemos datos)\n          if (!forceFullRefresh) {\n            const currentSourcesForThisUrl = sources.filter((s) => s.urlIndex === urlIndex);\n            const hasExistingData =\n              currentSourcesForThisUrl.length > 0 &&\n              data.some((d) => currentSourcesForThisUrl.some((s) => s.id === d.sourceId));\n\n            if (hasExistingData) {'''
new = '''          // 1. METADATA PRIMERO. Sin caché mostramos el directorio antes de descargar\n          // todos los medicamentos. Con caché se mantiene el delta-sync normal.\n          if (!forceFullRefresh) {\n            const currentSourcesForThisUrl = sources.filter((s) => s.urlIndex === urlIndex);\n            const hasExistingData =\n              currentSourcesForThisUrl.length > 0 &&\n              data.some((d) => currentSourcesForThisUrl.some((s) => s.id === d.sourceId));\n\n            if (!hasExistingData) {\n              const initialMetadata = await fetchGasMetadata(config.url, { timeoutMs: 15000 });\n              if (initialMetadata && initialMetadata.length > 0) {\n                const previewSources: SheetSource[] = initialMetadata.map((meta) => {\n                  const uniqueSourceId = `${urlIndex}_${meta.id}`;\n                  const assignment = allAssignments.find(\n                    (a) => a.sheetUrl === config.url && a.sheetName === meta.name,\n                  );\n                  const facility = assignment\n                    ? allFacilities.find((f) => f.code === assignment.facilityCode)\n                    : null;\n\n                  return {\n                    id: uniqueSourceId,\n                    name: facility?.name || meta.name,\n                    urlIndex,\n                    lastUpdate: meta.lastUpdate || "",\n                    lastUpdateTime: parseDataDate(meta.lastUpdate || "") || undefined,\n                    equipmentDate: meta.equipmentDate || "",\n                    equipmentDateTime: parseDataDate(meta.equipmentDate || "") || undefined,\n                  };\n                });\n\n                setSources((prev) => [\n                  ...prev.filter((source) => source.urlIndex !== urlIndex),\n                  ...previewSources,\n                ]);\n\n                const names = initialMetadata.map((meta) => meta.name).filter(Boolean);\n                const batches: string[][] = [];\n                const INITIAL_BATCH_SIZE = 8;\n                for (let i = 0; i < names.length; i += INITIAL_BATCH_SIZE) {\n                  batches.push(names.slice(i, i + INITIAL_BATCH_SIZE));\n                }\n\n                const batchResults = await Promise.allSettled(\n                  batches.map((batch) =>\n                    fetchGasSelectiveSheets(config.url, batch, { timeoutMs: 30000 }),\n                  ),\n                );\n                const allBatchesSucceeded = batchResults.every(\n                  (result) => result.status === "fulfilled" && Array.isArray(result.value),\n                );\n                if (allBatchesSucceeded) {\n                  sheetsPayload = batchResults.flatMap((result) =>\n                    result.status === "fulfilled" ? result.value : [],\n                  );\n                  isSelective = true;\n                }\n              }\n            }\n\n            if (hasExistingData) {'''
text = one_replace(text, old, new, 'cold start metadata-first')

# Eliminar auto registerSync después de la descarga.
text = one_sub(
    text,
    r'\n        // Auto sync tras descargar información\n        try \{.*?\n        \} catch \(syncErr\) \{.*?\n        \}',
    '',
    'registerSync automático',
    re.S,
)
# No consultar historial al montar.
text = one_sub(
    text,
    r'\n        if \(supabase\) \{\n          loadSupabaseSyncs\(\)\.catch\(\(e\) => console\.warn\(e\)\);\n        \}',
    '',
    'historial al montar',
)

# 5. Remover filtro "Últimos movimientos" ligado a Supabase.
text = one_sub(
    text,
    r'\n      // \d+\. Movements limit filter.*?\n      \}',
    '',
    'lógica filtro movimientos',
    re.S,
)
for token in ('    filterMovementsUnit,\n', '    filterMovementsValue,\n', '    filterMovementsCondition,\n', '    supabaseSyncs,\n'):
    text = text.replace(token, '')
text = one_sub(
    text,
    r'\n\s*\{\/\* Filter Section: Movements Date Limit \*\/\}\n\s*\{renderRangeFilter\(\n\s*filterMovementsUnit,.*?\n\s*\)\}',
    '',
    'UI filtro movimientos',
    re.S,
)
text = text.replace(' || filterMovementsValue > 0', '')
text = re.sub(r'\n\s*setFilterMovements(?:Unit|Value|Condition)\([^;]+;', '', text)

# 6. Tarjetas/captura sin syncRecord de Supabase.
text = re.sub(r'\n\s*const syncRecord = supabaseSyncs\[[^\n]+\];', '', text)
text = re.sub(r'\n\s*syncRecordDate: syncRecord\?\.sync_date,', '', text)
text = re.sub(r'\n\s*hasSyncRecord: !!syncRecord,', '', text)
# onShowHistory puede ser de una o varias líneas.
text = re.sub(r'\n\s*onShowHistory=\{.*?handleShowSyncHistory\(.*?\)\s*\}', '', text, flags=re.S)

# 7. Vista tabla: eliminar columna/celda de últimos movimientos.
text = re.sub(r'\n\s*<th[^>]*>\s*Últimos Movimientos\s*</th>', '', text)
text = re.sub(r'\n\s*\{\/\* Últimos Movimientos \*\/\}.*?</td>', '', text, flags=re.S)

# 8. Eliminar modal de historial Supabase.
text = one_sub(
    text,
    r'\n\s*\{\/\* Modal de Historial de Sincronización Supabase \*\/\}.*?\n\s*\{\/\* Deficiency Capture Modal \(Preview & Image Generation\) \*\/\}',
    '\n\n      {/* Deficiency Capture Modal (Preview & Image Generation) */}',
    'modal historial',
    re.S,
)

# Estas referencias no deben existir ya en Consulta Stock.
for forbidden in (
    'supabaseService', 'supabaseSyncs', 'loadSupabaseSyncs', 'handleShowSyncHistory',
    'filterMovementsUnit', 'filterMovementsValue', 'filterMovementsCondition',
    'isSyncHistoryModalOpen', 'selectedFacilitySyncHistory', 'activeHistoryFacility'
):
    if forbidden in text:
        raise RuntimeError(f'referencia legacy restante: {forbidden}')

SHEET.write_text(text, encoding="utf-8")

# 9. Conexión GAS directa: quitar proxies públicos de terceros.
gas = GAS.read_text(encoding="utf-8")
gas = gas.replace(
    ' * Servicio de conexión ultra-resiliente y diagnóstico para Google Apps Script Web Apps.\n * Implementa reintentos secuenciales, rotación de proxies CORS y análisis semántico de errores.',
    ' * Servicio de conexión resiliente y diagnóstico para Google Apps Script Web Apps.\n * Usa conexión directa y un reintento anti-caché; no envía URLs ni stock a proxies CORS públicos.',
)
gas = gas.replace(
    ' * Consulta resiliente con reintentos secuenciales y rotación de proxies.',
    ' * Consulta resiliente mediante conexión directa y un único reintento directo.',
)
gas = one_sub(
    gas,
    r'\n  // Estrategia 3: proxies CORS como último respaldo\..*?\n  throw new Error\(lastDiagnostic\);',
    '\n\n  throw new Error(lastDiagnostic);',
    'proxies CORS',
    re.S,
)
GAS.write_text(gas, encoding="utf-8")

# 10. Regla explícita para futuras IAs.
agents = AGENTS.read_text(encoding="utf-8")
guard = ('\n> **FRONTERA CRÍTICA DE STOCK (no mezclar):** `SIG_SEARCH` / `SheetSearchModule` '
         '(**Consulta Stock**) usa exclusivamente **Google Sheets → Google Apps Script → IndexedDB** '
         'para medicamentos, lotes, saldos, vencimientos y actualización. `STOCK_MONITORING` / '
         '`IpressStockModule` (**Monitoreo de Stock**) usa **Supabase (`stock_actual`)** y es independiente. '
         '**No introducir fallbacks cruzados, no leer `stock_actual` desde Consulta Stock y no registrar sus '
         'hojas en `stock_sync_history`.** Supabase puede alojar configuración general, pero no es la fuente '
         'de inventario de `SIG_SEARCH`.\n')
marker = '> **Lee la sección 8 antes de escribir cualquier componente o utilidad.**'
pos = agents.find(marker)
if pos < 0:
    raise RuntimeError('marcador AGENTS no encontrado')
end = agents.find('\n', pos)
agents = agents[:end+1] + guard + agents[end+1:]
AGENTS.write_text(agents, encoding="utf-8")

doc = DOC.read_text(encoding="utf-8")
doc_guard = ('\n> ## Regla de arquitectura: Consulta Stock y Monitoreo Stock son independientes\n'
             '> - **Consulta Stock (`SIG_SEARCH` / `SheetSearchModule`)**: Google Sheets → Google Apps Script → IndexedDB → web. No consume `stock_actual` ni `stock_sync_history` como fuente de inventario.\n'
             '> - **Monitoreo de Stock (`STOCK_MONITORING` / `IpressStockModule`)**: Supabase (`stock_actual`) → web. Es un módulo independiente.\n'
             '> - No crear fallbacks cruzados entre ambos módulos.\n\n')
first = doc.find('\n')
if first < 0:
    raise RuntimeError('documento integración sin encabezado')
doc = doc[:first+1] + doc_guard + doc[first+1:]
doc = re.sub(
    r'\*\s*\*\*`SheetSearchModule`\*\*.*?Apps Script.*?(?=\n\*|\n##|\Z)',
    '* **`SheetSearchModule`**: consulta Google Sheets mediante Apps Script y usa IndexedDB como caché local. Supabase no es fuente de inventario de este módulo.\n',
    doc,
    flags=re.S,
)
DOC.write_text(doc, encoding="utf-8")

print('Cambios aplicados; continuar con lint, tests y build.')
