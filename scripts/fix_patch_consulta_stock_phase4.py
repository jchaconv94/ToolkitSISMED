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

path.write_text(s.replace(old, new, 1), encoding="utf-8")
print("Patch script ajustado.")
