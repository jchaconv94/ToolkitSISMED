from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "components" / "SheetSearchModule.tsx"
GAS = ROOT / "services" / "gasConnectionService.ts"
DOC = ROOT / "docs" / "DESKTOP_INTEGRATION_SISMED_2.0.md"
AGENTS = ROOT / "AGENTS.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: se esperaba 1 coincidencia y se encontraron {count}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, repl: str, label: str, flags=0) -> str:
    updated, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: se esperaba 1 coincidencia y se encontraron {count}")
    return updated


# -----------------------------------------------------------------------------
# 1) Consulta Stock: Google Sheets + Apps Script + IndexedDB, sin historial Supabase
# -----------------------------------------------------------------------------
text = SHEET.read_text(encoding="utf-8")

text = replace_once(
    text,
    'import { supabaseService, supabase } from "../services/supabaseClient";\n',
    '',
    'import Supabase',
)

# Estados de historial de Supabase.
text = sub_once(
    text,
    r'\n  // Supabase Sync States\n.*?\n  // Filtros Avanzados \(Sidebar Derecha\)',
    '\n\n  // Filtros Avanzados (Sidebar Derecha)',
    'estados Supabase',
    flags=re.S,
)

# Estados del filtro "Últimos movimientos" (dependía de stock_sync_history de Supabase).
text = sub_once(
    text,
    r'\n  const \[filterMovementsUnit, setFilterMovementsUnit\].*?\n  >\("with"\);',
    '',
    'estados filtro movimientos',
    flags=re.S,
)

# Separar persistencia de datos de la validación puramente visual de selectedSourceId.
old_effect = '''  useEffect(() => {\n    if (!user || isConfigLoading) return; // IMPORTANTE: No guardar si aún estamos cargando la config inicial\n\n    // Guardar en IndexedDB sin límites de 5MB\n    stockStorageService.saveUrls(user.username, scriptUrls).catch(() => {});\n    stockStorageService.saveStockData(user.username, sources, data, lastGlobalSync).catch(() => {});'''
if old_effect not in text:
    raise RuntimeError('inicio efecto persistencia no encontrado')

# Quitar del efecto de persistencia la validación de selección y selectedSourceId de dependencias.
text = sub_once(
    text,
    r'(  useEffect\(\(\) => \{\n    if \(!user \|\| isConfigLoading\) return;.*?localStorage\.setItem\(\n        `aura_sig_urls_\$\{user\.username\}`,\n        JSON\.stringify\(scriptUrls\),\n      \);\n    \} catch \(e\) \{\n      console\.warn\("Storage quota exceeded for URLs\.", e\);\n    \}\n)\n    if \(\n      sources\.length > 0 &&\n      selectedSourceId !== "" &&\n      !sources\.find\(\(s\) => s\.id === selectedSourceId\)\n    \) \{\n      setSelectedSourceId\(""\);\n    \}\n  \}, \[scriptUrls, sources, data, selectedSourceId, user, isConfigLoading, lastGlobalSync\]\);',
    r'''\1  }, [scriptUrls, sources, data, user, isConfigLoading, lastGlobalSync]);\n\n  // Cambiar de IPRESS es un estado visual: no debe provocar una reescritura del stock en IndexedDB.\n  useEffect(() => {\n    if (\n      sources.length > 0 &&\n      selectedSourceId !== "" &&\n      !sources.find((s) => s.id === selectedSourceId)\n    ) {\n      setSelectedSourceId("");\n    }\n  }, [sources, selectedSourceId]);''',
    'separar persistencia y selección',
    flags=re.S,
)

# Eliminar funciones de historial/autoregistro Supabase dentro de Consulta Stock.
text = sub_once(
    text,
    r'\n  const loadSupabaseSyncs = async \(forceIds\?: string\[\]\) => \{.*?\n  // Función ultra-resiliente para obtener JSON de Web App de Google Apps Script con diagnóstico y proxies',
    '\n\n  // Conexión resiliente para obtener JSON de Google Apps Script.',
    'funciones Supabase de Consulta Stock',
    flags=re.S,
)

# Carga inicial: metadata primero para pintar tarjetas de inmediato, luego hojas en lotes.
needle = '''          // 1. INTENTO DE DELTA SYNC INTELIGENTE (si no es forzado y ya tenemos datos)\n          if (!forceFullRefresh) {\n            const currentSourcesForThisUrl = sources.filter((s) => s.urlIndex === urlIndex);\n            const hasExistingData =\n              currentSourcesForThisUrl.length > 0 &&\n              data.some((d) => currentSourcesForThisUrl.some((s) => s.id === d.sourceId));\n\n            if (hasExistingData) {'''
replacement = '''          // 1. METADATA PRIMERO. En una instalación sin caché, las tarjetas aparecen\n          // inmediatamente y el inventario se descarga después en grupos pequeños.\n          // En aperturas posteriores se mantiene el delta-sync existente.\n          if (!forceFullRefresh) {\n            const currentSourcesForThisUrl = sources.filter((s) => s.urlIndex === urlIndex);\n            const hasExistingData =\n              currentSourcesForThisUrl.length > 0 &&\n              data.some((d) => currentSourcesForThisUrl.some((s) => s.id === d.sourceId));\n\n            if (!hasExistingData) {\n              const initialMetadata = await fetchGasMetadata(config.url, { timeoutMs: 15000 });\n              if (initialMetadata && initialMetadata.length > 0) {\n                const previewSources: SheetSource[] = initialMetadata.map((meta) => {\n                  const uniqueSourceId = `${urlIndex}_${meta.id}`;\n                  const assignment = allAssignments.find(\n                    (a) => a.sheetUrl === config.url && a.sheetName === meta.name,\n                  );\n                  const facility = assignment\n                    ? allFacilities.find((f) => f.code === assignment.facilityCode)\n                    : null;\n\n                  return {\n                    id: uniqueSourceId,\n                    name: facility?.name || meta.name,\n                    urlIndex,\n                    lastUpdate: meta.lastUpdate || "",\n                    lastUpdateTime: parseDataDate(meta.lastUpdate || "") || undefined,\n                    equipmentDate: meta.equipmentDate || "",\n                    equipmentDateTime: parseDataDate(meta.equipmentDate || "") || undefined,\n                  };\n                });\n\n                // Mostrar el directorio antes de terminar de bajar todos los medicamentos.\n                setSources((prev) => [\n                  ...prev.filter((source) => source.urlIndex !== urlIndex),\n                  ...previewSources,\n                ]);\n\n                const names = initialMetadata.map((meta) => meta.name).filter(Boolean);\n                const batches: string[][] = [];\n                const INITIAL_BATCH_SIZE = 8;\n                for (let i = 0; i < names.length; i += INITIAL_BATCH_SIZE) {\n                  batches.push(names.slice(i, i + INITIAL_BATCH_SIZE));\n                }\n\n                const batchResults = await Promise.allSettled(\n                  batches.map((batch) =>\n                    fetchGasSelectiveSheets(config.url, batch, { timeoutMs: 30000 }),\n                  ),\n                );\n\n                const allBatchesSucceeded = batchResults.every(\n                  (result) => result.status === "fulfilled" && Array.isArray(result.value),\n                );\n\n                if (allBatchesSucceeded) {\n                  sheetsPayload = batchResults.flatMap((result) =>\n                    result.status === "fulfilled" ? result.value : [],\n                  );\n                  isSelective = true;\n                }\n              }\n            }\n\n            if (hasExistingData) {'''
text = replace_once(text, needle, replacement, 'metadata-first cold start')

# Eliminar auto-registro de las hojas de Consulta Stock en stock_sync_history.
text = sub_once(
    text,
    r'\n        // Auto sync tras descargar información\n        try \{.*?\n        \} catch \(syncErr\) \{.*?\n        \}',
    '',
    'auto registerSync Supabase',
    flags=re.S,
)

# En el montaje ya no se carga historial Supabase.
text = sub_once(
    text,
    r'\n        if \(supabase\) \{\n          loadSupabaseSyncs\(\)\.catch\(\(e\) => console\.warn\(e\)\);\n        \}',
    '',
    'loadSupabaseSyncs al montar',
)

# Quitar filtro de antigüedad de "últimos movimientos" y sus dependencias.
text = sub_once(
    text,
    r'\n      // \d+\. Movements limit filter.*?\n      \}',
    '',
    'filtro movimientos',
    flags=re.S,
)
for token in [
    '    filterMovementsUnit,\n',
    '    filterMovementsValue,\n',
    '    filterMovementsCondition,\n',
    '    supabaseSyncs,\n',
]:
    text = text.replace(token, '')

# Captura de establecimientos: la fecha de movimiento de Supabase no forma parte de Consulta Stock.
text = re.sub(r'\n\s*const syncRecord = supabaseSyncs\[[^\n]+\];', '', text)
text = re.sub(r'\n\s*syncRecordDate: syncRecord\?\.sync_date,', '', text)
text = re.sub(r'\n\s*hasSyncRecord: !!syncRecord,', '', text)
text = text.replace('    supabaseSyncs,\n', '')

# Tarjetas: no ofrecer historial Supabase desde Consulta Stock.
text = re.sub(r'\n\s*onShowHistory=\{\([^\n]*\) => handleShowSyncHistory\([^\n]*\)\}', '', text)
text = re.sub(r'\n\s*onShowHistory=\{\(e\) => handleShowSyncHistory\([^\n]*\)\}', '', text)

# Filtro visual de movimientos en el panel avanzado.
text = sub_once(
    text,
    r'\n\s*\{\/\* Filter Section: Movements Date Limit \*\/\}\n\s*\{renderRangeFilter\(\n\s*filterMovementsUnit,.*?\n\s*\)\}',
    '',
    'UI filtro movimientos',
    flags=re.S,
)
text = text.replace(' || filterMovementsValue > 0', '')
text = re.sub(r'\n\s*setFilterMovements(Unit|Value|Condition)\([^;]+;', '', text)

# Columna "Últimos Movimientos" de la vista tabla (era stock_sync_history).
text = re.sub(
    r'\n\s*<th[^>]*>\s*Últimos Movimientos\s*</th>',
    '',
    text,
)
# La celda se identifica por el comentario que la precede en la tabla.
text = re.sub(
    r'\n\s*\{\/\* Últimos Movimientos \*\/\}.*?</td>',
    '',
    text,
    flags=re.S,
)

# Modal completo de historial Supabase.
text = sub_once(
    text,
    r'\n\s*\{\/\* Modal de Historial de Sincronización Supabase \*\/\}.*?\n\s*\{\/\* Deficiency Capture Modal \(Preview & Image Generation\) \*\/\}',
    '\n\n      {/* Deficiency Capture Modal (Preview & Image Generation) */}',
    'modal historial Supabase',
    flags=re.S,
)

# Asegurar que no queden referencias directas al historial Supabase en este módulo.
for forbidden in [
    'supabaseService',
    'supabaseSyncs',
    'loadSupabaseSyncs',
    'handleShowSyncHistory',
    'filterMovementsUnit',
    'filterMovementsValue',
    'filterMovementsCondition',
    'isSyncHistoryModalOpen',
    'selectedFacilitySyncHistory',
    'activeHistoryFacility',
]:
    if forbidden in text:
        raise RuntimeError(f'Referencia Supabase/legacy restante en SheetSearchModule: {forbidden}')

SHEET.write_text(text, encoding="utf-8")


# -----------------------------------------------------------------------------
# 2) GAS: solo conexión directa. No exponer URLs/datos a proxies CORS públicos.
# -----------------------------------------------------------------------------
gas = GAS.read_text(encoding="utf-8")
gas = gas.replace(
    ' * Servicio de conexión ultra-resiliente y diagnóstico para Google Apps Script Web Apps.\n * Implementa reintentos secuenciales, rotación de proxies CORS y análisis semántico de errores.',
    ' * Servicio de conexión resiliente y diagnóstico para Google Apps Script Web Apps.\n * Usa conexión directa y un reintento directo con anti-caché; no envía datos a proxies CORS públicos.',
)
gas = gas.replace(
    ' * Consulta resiliente con reintentos secuenciales y rotación de proxies.',
    ' * Consulta resiliente mediante conexión directa y un único reintento directo.',
)
gas = sub_once(
    gas,
    r'\n  // Estrategia 3: proxies CORS como último respaldo\..*?\n  throw new Error\(lastDiagnostic\);',
    '\n\n  throw new Error(lastDiagnostic);',
    'proxies CORS públicos',
    flags=re.S,
)
GAS.write_text(gas, encoding="utf-8")


# -----------------------------------------------------------------------------
# 3) Documentar la frontera arquitectónica para que futuras IAs no mezclen módulos.
# -----------------------------------------------------------------------------
agents = AGENTS.read_text(encoding="utf-8")
architecture_guard = '''\n> **FRONTERA CRÍTICA DE STOCK (no mezclar):** `SIG_SEARCH` / `SheetSearchModule` (**Consulta Stock**) usa exclusivamente **Google Sheets → Google Apps Script → IndexedDB** para datos de medicamentos, lotes, saldos, fechas y estado de actualización. `STOCK_MONITORING` / `IpressStockModule` (**Monitoreo de Stock**) usa **Supabase (`stock_actual`)** y es un producto funcionalmente independiente. **No introducir fallbacks cruzados, no leer `stock_actual` desde Consulta Stock y no registrar las hojas de Consulta Stock en `stock_sync_history`.** Supabase puede seguir alojando configuración general de la aplicación, pero no es la fuente de inventario de `SIG_SEARCH`.\n'''
marker = '> **Lee la sección 8 antes de escribir cualquier componente o utilidad.**'
idx = agents.find(marker)
if idx < 0:
    raise RuntimeError('marcador AGENTS no encontrado')
line_end = agents.find('\n', idx)
agents = agents[:line_end+1] + architecture_guard + agents[line_end+1:]
AGENTS.write_text(agents, encoding="utf-8")

doc = DOC.read_text(encoding="utf-8")
doc_guard = '''\n> ## Regla de arquitectura: Consulta Stock y Monitoreo Stock son independientes\n> - **Consulta Stock (`SIG_SEARCH` / `SheetSearchModule`)**: Google Sheets → Google Apps Script → IndexedDB → interfaz web. No consume `stock_actual` ni `stock_sync_history` para su inventario.\n> - **Monitoreo de Stock (`STOCK_MONITORING` / `IpressStockModule`)**: Supabase (`stock_actual`) → interfaz web. Es la evolución 2.0 de monitoreo, pero no reemplaza ni alimenta Consulta Stock.\n> - No crear fallbacks cruzados entre ambos módulos. Compartir estilos o componentes visuales no convierte sus fuentes de datos en una sola arquitectura.\n\n'''
first_break = doc.find('\n')
if first_break < 0:
    raise RuntimeError('documento de integración sin encabezado')
doc = doc[:first_break+1] + doc_guard + doc[first_break+1:]
# Neutralizar la afirmación histórica conflictiva si todavía existe.
doc = re.sub(
    r'\*\s*\*\*`SheetSearchModule`\*\*.*?Apps Script.*?(?=\n\*|\n##|\Z)',
    '* **`SheetSearchModule`**: consulta Google Sheets mediante Apps Script y usa IndexedDB como caché local. Supabase no es fuente de inventario de este módulo.\n',
    doc,
    flags=re.S,
)
DOC.write_text(doc, encoding="utf-8")

print('Optimización aplicada. Ejecutar npm run lint, npm test y npm run build.')
