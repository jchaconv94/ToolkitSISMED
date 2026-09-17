from pathlib import Path

path = Path(__file__).resolve().parent / "patch_consulta_stock_phase4.py"
s = path.read_text(encoding="utf-8")

old = '''# Modal completo de historial Supabase.
s = regex_once(
    s,
    r'\\n      \\{\\/\\* Modal de Historial de Sincronización Supabase \\*\\/\\}.*?\\n      \\{\\/\\* Modal de Expiración \\*\\/\\}',
    '\\n\\n      {/* Modal de Expiración */}',
    'modal historial Supabase',
)
'''

new = '''# Modal completo de historial Supabase. Se elimina hasta el siguiente comentario JSX
# de nivel superior para no depender del orden concreto de los otros modales.
modal_marker = '      {/* Modal de Historial de Sincronización Supabase */}'
modal_start = s.find(modal_marker)
if modal_start < 0:
    raise RuntimeError('No se encontró el modal historial Supabase')
next_marker_match = re.search(r'\\n      \\{\\/\\* [^\\n]+ \\*\\/\\}', s[modal_start + len(modal_marker):])
if not next_marker_match:
    raise RuntimeError('No se encontró el siguiente bloque después del modal Supabase')
modal_end = modal_start + len(modal_marker) + next_marker_match.start()
s = s[:modal_start] + s[modal_end:]
'''

if old not in s:
    raise RuntimeError("No se encontró el bloque del modal que debía ajustarse")
s = s.replace(old, new, 1)

anchor = '''# Verificación estricta: Consulta Stock ya no debe tener acoplamiento directo al historial
# de Supabase. api.* se conserva porque configuración/usuarios/jurisdicción sí viven allí.
'''
extra = '''# Retirar resets de los filtros de movimientos en botones "Limpiar" / "Restablecer".
s, movement_reset_count = re.subn(
    r'\\n\\s*setFilterMovementsUnit\\("hours"\\);\\n\\s*setFilterMovementsValue\\(0\\);\\n\\s*setFilterMovementsCondition\\("with"\\);',
    '',
    s,
)
if movement_reset_count == 0:
    raise RuntimeError('No se encontraron resets de filtro de movimientos para limpiar')

'''
if anchor not in s:
    raise RuntimeError("No se encontró el ancla para limpiar resets de movimientos")
s = s.replace(anchor, extra + anchor, 1)

path.write_text(s, encoding="utf-8")
print("Patch script ajustado.")
