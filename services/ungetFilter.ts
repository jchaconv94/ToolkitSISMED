/**
 * Filtro por UNGET de las listas de establecimientos (Backups SISMED, Claves de envío).
 * Quién lo ve lo decide `showsTerritory` de `orgTabs.ts`, la misma regla de Establecimientos.
 */

export interface UngetRef {
  ungetId?: string | null;
  ungetName?: string | null;
}

/** UNGET de una fila: su id o, si el servicio no lo trae, su nombre. */
export const ungetKeyOf = (row: UngetRef): string =>
  String(row.ungetId || row.ungetName || "").trim();

export interface UngetOption {
  key: string;
  name: string;
  count: number;
}

/**
 * UNGET de los establecimientos de la lista, por nombre, con cuántos tiene cada una. Es el
 * filtro de los usuarios que ven más de una UNGET (DIRESA, OGESS, administrador) en Backups
 * SISMED y Claves de envío: sus opciones salen de lo que ya ven, así nadie elige una UNGET ajena.
 */
export const ungetOptions = (rows: Array<UngetRef>): UngetOption[] => {
  const byKey = new Map<string, UngetOption>();
  for (const row of rows) {
    const key = ungetKeyOf(row);
    if (!key) continue;
    const current = byKey.get(key);
    if (current) current.count += 1;
    else byKey.set(key, { key, name: String(row.ungetName || row.ungetId || "").trim(), count: 1 });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
};

/** Solo los establecimientos de esa UNGET; «all» los deja todos. */
export const rowsOfUnget = <T extends UngetRef>(rows: T[], unget: string): T[] =>
  unget === "all" ? rows : rows.filter((row) => ungetKeyOf(row) === unget);
