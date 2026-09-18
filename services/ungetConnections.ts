/**
 * Reglas de identidad de las conexiones de stock de una UNGET.
 *
 * La tabla `unget_configs` guarda la conexión por usuario y por nombre escrito a mano, así
 * que la misma UNGET puede tener varias filas: la del informático de la UNGET y la de
 * `admin`. El modelo acordado es **una UNGET, una conexión** (ver
 * `docs/REVISION_MODELO_CONEXIONES_2026-09-18.md`), y mientras la base no lo garantice,
 * la aplicación elige una sola para no mostrar la misma UNGET dos veces ni leer su stock
 * por el camino lento.
 */

/** Nombre comparable: sin tildes, sin «UNGET/OGESS/…» y sin las erratas conocidas. */
export const normalizeUngetName = (name?: string | null): string => {
  if (!name) return "";
  let n = String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\b(UNGET|UNGETS|OGESS|DIRESA|IPRESS)\b/g, "");

  n = n.replace(/\bMARICAL\b/g, "MARISCAL");
  // La C tiene que ir suelta. Sin el paréntesis final, "MARISCAL CACERES" se convertía en
  // "MARISCAL CACERESACERES" y dejaba de coincidir consigo mismo.
  n = n.replace(/\bMARISCAL\s+C\.?(?![A-Z])/g, "MARISCAL CACERES");

  return n.replace(/[^A-Z0-9]/g, "").trim();
};

export interface UngetConnection {
  name: string;
  url?: string;
  username?: string;
  ungetId?: string | null;
  spreadsheetId?: string;
  [key: string]: any;
}

/** Clave de agrupación: el identificador oficial de la UNGET y, si falta, su nombre. */
export const ungetConnectionKey = (connection: UngetConnection): string => {
  const id = String(connection?.ungetId || "").trim();
  return id ? `id:${id}` : `nombre:${normalizeUngetName(connection?.name)}`;
};

/**
 * Cuál de dos conexiones de la misma UNGET se queda. En orden:
 *
 * 1. la que tiene hoja de cálculo, porque es la que lee directo y rápido;
 * 2. la del informático de esa UNGET, que es quien debe mantenerla;
 * 3. la del propio usuario, para que vea lo que él configuró;
 * 4. la primera que llegó, para que el resultado no dependa del orden.
 */
const connectionScore = (
  connection: UngetConnection,
  context: { currentUsername?: string; ungetIdByUsername?: Record<string, string | undefined> },
): number => {
  let score = 0;
  if (connection?.spreadsheetId) score += 8;

  const owner = String(connection?.username || "").trim();
  const ownerUngetId = owner ? context.ungetIdByUsername?.[owner] : undefined;
  const connectionUngetId = String(connection?.ungetId || "").trim();
  if (ownerUngetId && connectionUngetId && String(ownerUngetId) === connectionUngetId) score += 4;

  if (context.currentUsername && owner === context.currentUsername) score += 2;
  return score;
};

/**
 * Una conexión por UNGET, conservando el orden de aparición.
 *
 * `ungetIdByUsername` dice a qué UNGET pertenece cada usuario (sale de Establecimientos),
 * para poder preferir la conexión de su propio informático.
 */
export const pickOneConnectionPerUnget = <T extends UngetConnection>(
  connections: T[],
  context: { currentUsername?: string; ungetIdByUsername?: Record<string, string | undefined> } = {},
): T[] => {
  const chosen = new Map<string, T>();
  for (const connection of connections || []) {
    if (!connection) continue;
    const key = ungetConnectionKey(connection);
    const previous = chosen.get(key);
    if (!previous) {
      chosen.set(key, connection);
      continue;
    }
    if (connectionScore(connection, context) > connectionScore(previous, context)) {
      chosen.set(key, connection);
    }
  }
  return Array.from(chosen.values());
};

/** Cómo lee su stock una UNGET, para mostrarlo en la lista de conexiones. */
export type UngetConnectionMode = "directa" | "apps-script" | "sin-hoja";

export const describeConnectionMode = (
  connection: UngetConnection,
  isVirtualUrl: (url?: string) => boolean,
): UngetConnectionMode => {
  if (connection?.spreadsheetId) return "directa";
  const url = String(connection?.url || "").trim();
  return url && !isVirtualUrl(url) ? "apps-script" : "sin-hoja";
};
