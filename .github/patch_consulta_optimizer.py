from pathlib import Path

p = Path('.github/apply_consulta_stock_optimization_v2.py')
s = p.read_text(encoding='utf-8')
old = '''text = one_sub(\n    text,\n    r'\\n        // Auto sync tras descargar información\\n        try \\{.*?\\n        \\} catch \\(syncErr\\) \\{.*?\\n        \\}',\n    '',\n    'registerSync automático',\n    re.S,\n)'''
new = '''text = one_sub(\n    text,\n    r'\\n      if \\(supabase && accumulatedSources\\.length > 0\\) \\{.*?(?=\\n      if \\(accumulatedData\\.length)',\n    '',\n    'registerSync automático',\n    re.S,\n)'''
if old not in s:
    raise RuntimeError('No se encontró el bloque registerSync del aplicador v2')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('Aplicador v2 corregido.')
