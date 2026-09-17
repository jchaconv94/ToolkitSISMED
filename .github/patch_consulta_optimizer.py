from pathlib import Path

p = Path('.github/apply_consulta_stock_optimization_v2.py')
s = p.read_text(encoding='utf-8')

old = '''text = one_sub(\n    text,\n    r'\\n        // Auto sync tras descargar información\\n        try \\{.*?\\n        \\} catch \\(syncErr\\) \\{.*?\\n        \\}',\n    '',\n    'registerSync automático',\n    re.S,\n)'''
new = '''text = one_sub(\n    text,\n    r'\\n      if \\(supabase && accumulatedSources\\.length > 0\\) \\{.*?(?=\\n      if \\(accumulatedData\\.length)',\n    '',\n    'registerSync automático',\n    re.S,\n)'''
if old not in s:
    raise RuntimeError('No se encontró el bloque registerSync del aplicador v2')
s = s.replace(old, new, 1)

old_filter = "r'\\n      // \\d+\\. Movements limit filter.*?\\n      \\}',"
new_filter = "r'\\n      // Movements limit filter\\n      if \\(filterMovementsValue > 0\\) \\{.*?\\n      \\}',"
if old_filter not in s:
    raise RuntimeError('No se encontró el patrón del filtro de movimientos en el aplicador v2')
s = s.replace(old_filter, new_filter, 1)

old_ui = "r'\\n\\s*\\{\\/\\* Filter Section: Movements Date Limit \\*\\/\\}\\n\\s*\\{renderRangeFilter\\(\\n\\s*filterMovementsUnit,.*?\\n\\s*\\)\\}',"
new_ui = "r'\\n\\s*\\{/\\* Filter Section: Movements Date Limit \\*/\\}.*?\\\"SIN MOVIMIENTOS\\\",\\n\\s*\\)\\}',"
if old_ui not in s:
    raise RuntimeError('No se encontró el patrón UI de movimientos en el aplicador v2')
s = s.replace(old_ui, new_ui, 1)

old_header = "r'\\n\\s*<th[^>]*>\\s*Últimos Movimientos\\s*</th>',"
new_header = "r'\\n\\s*<th[^>]*>.*?<span>Últimos Movimientos</span>.*?</th>',"
if old_header not in s:
    raise RuntimeError('No se encontró el patrón cabecera Últimos Movimientos')
s = s.replace(old_header, new_header, 1)

needle = "text = re.sub(r'\\n\\s*const syncRecord = supabaseSyncs\\[[^\\n]+\\];', '', text)"
replacement = needle + '''
text = re.sub(r'\\n\\s*const cleanSheetId = sheet\\.id\\.includes\\(\\\"_\\\"\\).*?;', '', text)
text = re.sub(r'\\n\\s*const syncRecord = supabaseSyncs\\[sheet\\.id\\] \\|\\| supabaseSyncs\\[cleanSheetId\\] \\|\\| \\(code \\? supabaseSyncs\\[code\\] : undefined\\);', '', text)
text = re.sub(r'\\n\\s*<td className=\\\"px-5 py-3 whitespace-nowrap text-center\\\">\\s*\\{\\(\\(\\) => \\{\\s*const syncRecord =\\s*supabaseSyncs\\[sheet\\.id\\];.*?\\}\\)\\(\\)\\}\\s*</td>', '', text, flags=re.S)
text = text.replace(', supabaseSyncs]', ']')
text = text.replace('supabaseSyncs,\\n', '')'''
if needle not in s:
    raise RuntimeError('No se encontró limpieza syncRecord')
s = s.replace(needle, replacement, 1)

# Si queda una referencia, imprimir su línea exacta antes de la guardia para corregirla con precisión.
guard = "# Estas referencias no deben existir ya en Consulta Stock."
debug = '''if 'supabaseSyncs' in text:\n    print('DEBUG supabaseSyncs restante:')\n    for i, line in enumerate(text.splitlines(), 1):\n        if 'supabaseSyncs' in line:\n            print(f'{i}: {line}')\n\n'''
if guard not in s:
    raise RuntimeError('No se encontró guardia final')
s = s.replace(guard, debug + guard, 1)

p.write_text(s, encoding='utf-8')
print('Aplicador v2 corregido.')
