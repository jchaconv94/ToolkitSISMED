from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"No se encontró bloque esperado: {label}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, repl: str, label: str, flags=re.S) -> str:
    result, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Se esperaba 1 coincidencia para {label}, se encontraron {count}")
    return result


# -----------------------------------------------------------------------------
# 1) SheetSearchModule: Consulta Stock = Google Sheets / Apps Script solamente.
# -----------------------------------------------------------------------------
path = ROOT / "components" / "SheetSearchModule.tsx"
s = path.read_text(encoding="utf-8")

s = replace_once(
    s,
    'import { supabaseService, supabase } from "../services/supabaseClient";\n',
    '',
    'import directo de Supabase',
)

# Estado y filtros que pertenecían al historial de Supabase.
s = regex_once(
    s,
    r'\n  // Supabase Sync States\n.*?\n  // Filtros Avanzados \(Sidebar Derecha\)',
    '\n\n  // Filtros Avanzados (Sidebar Derecha)',
    'estados de historial Supabase',
)

s = regex_once(
    s,
    r'\n  const \[filterMovementsUnit, setFilterMovementsUnit\].*?\n  // Estados para dropdowns de filtros personalizados',
    '\n\n  // Estados para dropdowns de filtros personalizados',
    'filtros de últimos movimientos',
)

# La selección de una tarjeta es estado puramente visual: no debe disparar persistencia.
s = replace_once(
    s,
    '  }, [scriptUrls, sources, data, selectedSourceId, user, isConfigLoading, lastGlobalSync]);',
    '  }, [scriptUrls, sources, data, user, isConfigLoading, lastGlobalSync]);',
    'dependencias de persistencia',
)

# Quitar lectura/escritura de historial Supabase desde Consulta Stock.
s = regex_once(
    s,
    r'\n  const loadSupabaseSyncs = async .*?\n  // Función ultra-resiliente para obtener JSON de Web App de Google Apps Script con diagnóstico y proxies',
    '\n\n  // Función ultra-resiliente para obtener JSON de Web App de Google Apps Script con diagnóstico y proxies',
    'funciones de historial Supabase',
)

# Helper local para la primera carga. Usa el endpoint selectivo que ya existe y evita
# una única respuesta gigante con todo el libro.
helper = r'''

  const fetchSheetsInBatches = async (
    rawUrl: string,
    sheetNames: string[],
    batchSize: number = 6,
  ): Promise<any[]> => {
    const uniqueNames = Array.from(
      new Set(sheetNames.map((name) => name.trim()).filter(Boolean)),
    );
    if (uniqueNames.length === 0) return [];

    const batches: string[][] = [];
    for (let i = 0; i < uniqueNames.length; i += batchSize) {
      batches.push(uniqueNames.slice(i, i + batchSize));
    }

    const result: any[] = [];
    // Dos lotes simultáneos: mejora el tiempo total sin disparar demasiadas ejecuciones
    // concurrentes de Apps Script.
    for (let i = 0; i < batches.length; i += 2) {
      const pair = batches.slice(i, i + 2);
      const responses = await Promise.all(
        pair.map((batch) =>
          fetchGasSelectiveSheets(rawUrl, batch, { timeoutMs: 30000 }),
        ),
      );
      responses.forEach((response) => {
        if (Array.isArray(response)) result.push(...response);
      });
    }

    return result;
  };
'''
s = replace_once(
    s,
    '\n  const fetchData = async (\n',
    helper + '\n  const fetchData = async (\n',
    'inserción de carga por lotes',
)

# Reemplazar el bloque delta-sync por metadata-first. En una caché vacía, las tarjetas
# aparecen con nombre/estado/fechas antes de terminar de descargar todos los medicamentos.
metadata_block = r'''          // 1. METADATA FIRST: dibuja las tarjetas rápido y luego actualiza solo datos necesarios.
          const currentSourcesForThisUrl = sources.filter(
            (source) => source.urlIndex === urlIndex,
          );
          const hasExistingData =
            currentSourcesForThisUrl.length > 0 &&
            data.some((row) =>
              currentSourcesForThisUrl.some((source) => source.id === row.sourceId),
            );

          let metadataList: any[] | null = null;
          try {
            metadataList = await fetchGasMetadata(config.url, {
              timeoutMs: 15000,
              force: forceFullRefresh,
            });
          } catch (metadataError) {
            console.warn(
              `No se pudo precargar metadata de ${config.name || config.url}:`,
              metadataError,
            );
          }

          if (metadataList && metadataList.length > 0) {
            const metadataSources: SheetSource[] = metadataList.map((meta) => {
              const uniqueSourceId = `${urlIndex}_${meta.id}`;
              let displayName = meta.name;

              if (allAssignments.length > 0 && allFacilities.length > 0) {
                const matchingAssignment = allAssignments.find(
                  (assignment) =>
                    assignment.sheetUrl === config.url &&
                    assignment.sheetName === meta.name,
                );
                if (matchingAssignment) {
                  const matchingFacility = allFacilities.find(
                    (facility) => facility.code === matchingAssignment.facilityCode,
                  );
                  if (matchingFacility) displayName = matchingFacility.name;
                }
              }

              const lastUpdate = String(meta.lastUpdate || "").trim();
              const equipmentDate = String(meta.equipmentDate || "").trim();

              return {
                id: uniqueSourceId,
                name: displayName,
                urlIndex,
                lastUpdate,
                lastUpdateTime: parseDataDate(lastUpdate) || undefined,
                equipmentDate,
                equipmentDateTime: parseDataDate(equipmentDate) || undefined,
                rowCount: Number(meta.rowCount || 0),
                facilityCode: String(meta.codigoIpress || "").trim() || undefined,
              };
            });

            // Mostrar inmediatamente las IPRESS con su estado, aunque los medicamentos
            // sigan descargándose en segundo plano.
            setSources((prev) => {
              const previousForUrl = new Map(
                prev
                  .filter((source) => source.urlIndex === urlIndex)
                  .map((source) => [source.id, source]),
              );
              const hydrated = metadataSources.map((source) => ({
                ...previousForUrl.get(source.id),
                ...source,
              }));
              return [
                ...prev.filter((source) => source.urlIndex !== urlIndex),
                ...hydrated,
              ];
            });

            if (hasExistingData && !forceFullRefresh) {
              const changedSheetNames: string[] = [];
              const unchangedSourceIds = new Set<string>();

              metadataList.forEach((meta) => {
                const sourceId = `${urlIndex}_${meta.id}`;
                const existing = currentSourcesForThisUrl.find(
                  (source) => source.id === sourceId || source.name === meta.name,
                );
                const hasSheetData =
                  !!existing && data.some((row) => row.sourceId === existing.id);

                const metaLastStr = String(meta.lastUpdate || "").trim();
                const existingLastStr = String(existing?.lastUpdate || "").trim();
                const metaEqStr = String(meta.equipmentDate || "").trim();
                const existingEqStr = String(existing?.equipmentDate || "").trim();

                const metaLastTs = parseDataDate(metaLastStr);
                const existingLastTs =
                  existing?.lastUpdateTime || parseDataDate(existingLastStr);
                const metaEqTs = parseDataDate(metaEqStr);
                const existingEqTs =
                  existing?.equipmentDateTime || parseDataDate(existingEqStr);

                const lastUpdateMatches =
                  metaLastStr || existingLastStr
                    ? metaLastTs > 0 && existingLastTs > 0
                      ? metaLastTs === existingLastTs
                      : metaLastStr === existingLastStr
                    : true;
                const equipmentDateMatches =
                  metaEqStr || existingEqStr
                    ? metaEqTs > 0 && existingEqTs > 0
                      ? metaEqTs === existingEqTs
                      : metaEqStr === existingEqStr
                    : true;

                if (
                  existing &&
                  hasSheetData &&
                  lastUpdateMatches &&
                  equipmentDateMatches
                ) {
                  unchangedSourceIds.add(existing.id);
                } else {
                  changedSheetNames.push(meta.name);
                }
              });

              if (changedSheetNames.length === 0 && unchangedSourceIds.size > 0) {
                const hydratedUnchanged = metadataSources.filter((source) =>
                  unchangedSourceIds.has(source.id),
                );
                accumulatedSources.push(...hydratedUnchanged);
                accumulatedData.push(
                  ...data.filter((row) =>
                    unchangedSourceIds.has(row.sourceId || ""),
                  ),
                );
                setConnectionErrors((prev) => {
                  const updated = { ...prev };
                  delete updated[config.url];
                  return updated;
                });
                return;
              }

              if (changedSheetNames.length > 0) {
                try {
                  const selectiveResult = await fetchSheetsInBatches(
                    config.url,
                    changedSheetNames,
                  );
                  if (selectiveResult.length > 0) {
                    sheetsPayload = selectiveResult;
                    isSelective = unchangedSourceIds.size > 0;
                  }
                } catch (selectiveError) {
                  console.warn(
                    `Falló la descarga selectiva de ${config.name || config.url}; se usará fallback completo.`,
                    selectiveError,
                  );
                }
              }
            } else {
              // Primera carga (o actualización forzada): metadata ya está visible; descargar
              // las hojas en lotes pequeños en vez de esperar una sola respuesta gigante.
              try {
                const initialResult = await fetchSheetsInBatches(
                  config.url,
                  metadataList.map((meta) => meta.name),
                );
                if (initialResult.length > 0) {
                  sheetsPayload = initialResult;
                }
              } catch (initialError) {
                console.warn(
                  `Falló la carga inicial por lotes de ${config.name || config.url}; se usará fallback completo.`,
                  initialError,
                );
              }
            }
          }

'''
s = regex_once(
    s,
    r'          // 1\. INTENTO DE DELTA SYNC INTELIGENTE .*?\n          // Si no fue selectivo o es carga inicial/completa',
    metadata_block + '          // Si metadata/selectivo no estuvo disponible, mantener compatibilidad con backends antiguos.\n',
    'bloque metadata/delta sync',
)

# Los sources construidos desde el payload también conservan rowCount para la UI/caché.
s = replace_once(
    s,
    '                equipmentDate: equipmentDateStr,\n                equipmentDateTime: equipmentDateTime || undefined,\n              });',
    '                equipmentDate: equipmentDateStr,\n                equipmentDateTime: equipmentDateTime || undefined,\n                rowCount: Array.isArray(sheet.data) ? sheet.data.length : 0,\n              });',
    'rowCount en sources descargados',
)

# Quitar auto-registro de datos Google Sheets en el historial de Supabase.
s = regex_once(
    s,
    r'\n      if \(supabase && accumulatedSources\.length > 0\) \{.*?\n      \}\n\n      if \(accumulatedData\.length === 0',
    '\n\n      if (accumulatedData.length === 0',
    'auto-sync de Consulta Stock hacia Supabase',
)

# En montaje no consultar historial Supabase.
s = regex_once(
    s,
    r'        fetchData\(undefined, true\);\n        if \(supabase\) \{\n          loadSupabaseSyncs\(\)\.catch\(\(e\) => console\.warn\(e\)\);\n        \}',
    '        fetchData(undefined, true);',
    'carga de Supabase al montar',
)

# Filtro de movimientos basado en Supabase y dependencias asociadas.
s = regex_once(
    s,
    r'\n      // Movements limit filter\n      if \(filterMovementsValue > 0\) \{.*?\n      \}\n\n      // Expiration filter',
    '\n\n      // Expiration filter',
    'filtro de movimientos Supabase',
)
s = regex_once(
    s,
    r'\n    filterMovementsUnit,\n    filterMovementsValue,\n    filterMovementsCondition,\n    supabaseSyncs,',
    '',
    'dependencias de movimientos Supabase',
)

# Captura de deficiencias: solo datos provenientes de la hoja.
s = replace_once(s, '        const syncRecord = supabaseSyncs[id];\n', '', 'syncRecord captura')
s = replace_once(
    s,
    '          isMismatchEquipmentDate: isMismatch,\n          syncRecordDate: syncRecord?.sync_date,\n          hasSyncRecord: !!syncRecord,\n',
    '          isMismatchEquipmentDate: isMismatch,\n',
    'campos Supabase en captura',
)
s = replace_once(
    s,
    '  }, [selectedCaptureIds, sources, data, supabaseSyncs]);',
    '  }, [selectedCaptureIds, sources, data]);',
    'dependencia Supabase captura',
)

# Indicador de filtros activos y sección de filtro de movimientos.
s = replace_once(
    s,
    '                        filterHasPendingExpirations ||\n                        filterDateValue > 0 ||\n                        filterMovementsValue > 0) && (',
    '                        filterHasPendingExpirations ||\n                        filterDateValue > 0) && (',
    'indicador filtro movimientos',
)
s = regex_once(
    s,
    r'\n                  \{\/\* Filter Section: Movements Date Limit \*\/\}\n                  \{renderRangeFilter\(\n                    filterMovementsUnit,.*?\n                  \)\}',
    '',
    'UI filtro últimos movimientos',
)

# Tarjeta grid: eliminar lookup/historial Supabase y aprovechar metadata para rowCount/código.
s = regex_once(
    s,
    r'\n                                const cleanSheetId = .*?\n                                const syncRecord = .*?;\n',
    '\n',
    'lookup Supabase de tarjeta grid',
)
s = replace_once(
    s,
    '                                  code: code || "",\n',
    '                                  code: code || sheet.facilityCode || "",\n',
    'facilityCode metadata en tarjeta',
)
s = replace_once(
    s,
    '                                  totalItems: sheetData.length,\n                                  syncRecordDate: syncRecord?.sync_date,\n                                  hasSyncRecord: !!syncRecord,\n                                  isCheckingSync: isLoading || isSilentSyncing,\n',
    '                                  totalItems: sheetData.length || sheet.rowCount || 0,\n',
    'datos Supabase de tarjeta',
)
s = replace_once(
    s,
    '                                    onClick={() => handleSelectSheet(sheet.id)}\n                                    onShowHistory={() => handleShowSyncHistory(sheet.id, sheet.name)}\n',
    '                                    onClick={() => handleSelectSheet(sheet.id)}\n',
    'handler historial de tarjeta',
)

# Tabla: retirar columna y celda de "Últimos Movimientos" (era Supabase, no Google Sheets).
s = regex_once(
    s,
    r'\n                                      <th\n                                        scope="col"\n                                        className="px-5 py-3 font-black text-center sticky top-0 bg-slate-50 z-10 text-slate-500 uppercase tracking-wider"\n                                      >\n                                        <span>Últimos Movimientos<\/span>\n                                      <\/th>',
    '',
    'cabecera Últimos Movimientos',
)
s = regex_once(
    s,
    r'\n                                          <td className="px-5 py-3 whitespace-nowrap text-center">\n                                            \{\(\(\) => \{\n                                              const syncRecord =.*?\n                                            \}\)\(\)\}\n                                          <\/td>',
    '',
    'celda Últimos Movimientos',
)

# Modal completo de historial Supabase.
s = regex_once(
    s,
    r'\n      \{\/\* Modal de Historial de Sincronización Supabase \*\/\}.*?\n      \{\/\* Modal de Expiración \*\/\}',
    '\n\n      {/* Modal de Expiración */}',
    'modal historial Supabase',
)

# Verificación estricta: Consulta Stock ya no debe tener acoplamiento directo al historial
# de Supabase. api.* se conserva porque configuración/usuarios/jurisdicción sí viven allí.
for forbidden in [
    'supabaseService',
    'supabaseSyncs',
    'loadSupabaseSyncs',
    'handleShowSyncHistory',
    'filterMovements',
    'isSyncHistoryModalOpen',
    'selectedFacilitySyncHistory',
    'activeHistoryFacility',
]:
    if forbidden in s:
        raise RuntimeError(f"Quedó una referencia de Supabase no deseada: {forbidden}")

path.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# 2) EstablishmentCard: retirar la fila visual "Últimos movimientos" de Supabase.
# -----------------------------------------------------------------------------
path = ROOT / "components" / "EstablishmentCard.tsx"
s = path.read_text(encoding="utf-8")

for field in [
    '  syncRecordDate?: string | null;\n',
    '  hasSyncRecord?: boolean;\n',
    '  isCheckingSync?: boolean;\n',
]:
    s = replace_once(s, field, '', f'campo {field.strip()}')

s = replace_once(s, '  onShowHistory?: (e: React.MouseEvent) => void;\n', '', 'prop onShowHistory')
s = replace_once(s, '  onShowHistory,\n', '', 'destructuring onShowHistory')
for field in [
    '    syncRecordDate,\n',
    '    hasSyncRecord,\n',
    '    isCheckingSync,\n',
]:
    s = replace_once(s, field, '', f'destructuring {field.strip()}')

s = regex_once(
    s,
    r'\n  const formattedSyncDate = syncRecordDate.*?\n    : null;\n',
    '\n',
    'formattedSyncDate',
)
s = regex_once(
    s,
    r'\n          \{\/\* Movements / Supabase Row \*\/\}.*?\n          <\/div>\n        <\/div>\n      <\/div>\n\n      \{\/\* Bottom Row: Consultar Stock \+ items \*\/\}',
    '\n        </div>\n      </div>\n\n      {/* Bottom Row: Consultar Stock + items */}',
    'fila visual Supabase en EstablishmentCard',
)

# FileClock solo pertenecía a esa fila en este componente.
s = s.replace('  FileClock,\n', '')

for forbidden in ['syncRecordDate', 'hasSyncRecord', 'isCheckingSync', 'onShowHistory', 'Supabase Row']:
    if forbidden in s:
        raise RuntimeError(f"EstablishmentCard aún contiene {forbidden}")

path.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# 3) SheetSource: metadata ligera puede indicar registros/código antes de descargar filas.
# -----------------------------------------------------------------------------
path = ROOT / "types.ts"
s = path.read_text(encoding="utf-8")
s = replace_once(
    s,
    '  equipmentDateTime?: number;\n}',
    '  equipmentDateTime?: number;\n  rowCount?: number;\n  facilityCode?: string;\n}',
    'campos metadata SheetSource',
)
path.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# 4) Documento corto para que futuras IAs no vuelvan a mezclar los dos módulos.
# -----------------------------------------------------------------------------
doc = ROOT / "docs" / "ARQUITECTURA_MODULOS_STOCK.md"
doc.write_text(
    '''# Arquitectura de módulos de Stock SISMED\n\n## Regla principal\n\n`Consulta Stock` y `Monitoreo de Stock` son módulos independientes. No son dos vistas de la misma fuente de datos y no deben usarse como fallback entre sí.\n\n## Consulta Stock (`SIG_SEARCH`)\n\nComponente principal: `components/SheetSearchModule.tsx`.\n\nFlujo de inventario:\n\n```text\nToolkit-OGM → Google Sheets → Google Apps Script → Consulta Stock → IndexedDB\n```\n\n- La fuente de medicamentos, lotes, saldos, vencimientos y fechas de actualización es Google Sheets.\n- Apps Script expone `getMetadata` y lectura selectiva por hojas.\n- IndexedDB es solo caché del navegador para acelerar aperturas posteriores.\n- No se escribe el inventario de este módulo en `stock_actual` ni en un historial de sincronización de Supabase.\n- Supabase puede seguir almacenando configuración de usuarios, permisos, jurisdicción y URLs; eso no lo convierte en fuente del stock de este módulo.\n\n## Monitoreo de Stock (`STOCK_MONITORING`)\n\nComponente principal: `components/IpressStockModule.tsx`.\n\nFlujo de inventario:\n\n```text\nToolkit-OGM / Sync SISMED 2.0 → Supabase `stock_actual` → Monitoreo de Stock\n```\n\n- Su fuente de stock es Supabase.\n- No debe consultar Google Sheets como fallback de inventario.\n- Su historial, dispositivos y lógica de sincronización pertenecen a este flujo 2.0.\n\n## Prohibición de cruce\n\nAntes de modificar cualquiera de estos módulos, verificar la fuente de datos correspondiente. Una mejora en `Consulta Stock` no debe cambiar `IpressStockModule`, y una mejora de Sync SISMED 2.0 no debe hacer que `SheetSearchModule` consulte `stock_actual`.\n''',
    encoding='utf-8',
)

print('Parche phase4 aplicado correctamente.')
