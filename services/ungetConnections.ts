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

/**
 * Todas las claves con las que se puede reconocer una UNGET: por identificador y por
 * nombre. Mientras haya filas sin `unget_id`, una conexión puede coincidir por una u otra.
 */
export const ungetConnectionKeys = (connection: UngetConnection): string[] => {
  const keys: string[] = [];
  const id = String(connection?.ungetId || "").trim();
  if (id) keys.push(`id:${id}`);
  const nombre = normalizeUngetName(connection?.name);
  if (nombre) keys.push(`nombre:${nombre}`);
  return keys;
};

/**
 * Si la caché de establecimientos sigue sirviendo para esta lista de conexiones.
 *
 * Cada establecimiento se guarda apuntando a **la posición** de su UNGET en la lista
 * (`urlIndex`, y su `id` es `posición_hoja`). Si la lista cambia de orden o de tamaño, esas
 * posiciones pasan a señalar a otra UNGET: el 18/09/2026, al consolidar de 15 conexiones a
 * 7, las hojas de Bellavista aparecieron dentro de Huallaga. Cuando esto devuelve falso
 * hay que reconstruir los establecimientos, no reutilizarlos.
 */
export const cachedSourcesStillMatch = (
  previous: UngetConnection[] | null | undefined,
  next: UngetConnection[] | null | undefined,
): boolean => {
  const anterior = previous || [];
  const actual = next || [];
  if (anterior.length !== actual.length) return false;
  return anterior.every((connection, posicion) => {
    const claves = ungetConnectionKeys(connection);
    const enMismaPosicion = ungetConnectionKeys(actual[posicion]);
    return claves.length > 0 && claves.some((clave) => enMismaPosicion.includes(clave));
  });
};

/** Cómo lee su stock una UNGET, para mostrarlo en la lista de conexiones. */
export type UngetConnectionMode = "directa" | "apps-script" | "sin-hoja";

/**
 * `sheets://<id>` no es una dirección que se pueda pedir: es la marca de que la conexión
 * lee el libro directamente, sin Web App.
 */
export const isVirtualSheetUrl = (url?: string | null): boolean =>
  String(url || "").startsWith("sheets://");

export const describeConnectionMode = (
  connection: UngetConnection,
  isVirtualUrl: (url?: string) => boolean,
): UngetConnectionMode => {
  if (connection?.spreadsheetId) return "directa";
  const url = String(connection?.url || "").trim();
  return url && !isVirtualUrl(url) ? "apps-script" : "sin-hoja";
};

/** Estado de conexión de una UNGET registrada, incluyendo «nadie la ha configurado». */
export type UngetConnectionState = UngetConnectionMode | "sin-conexion";

export interface UngetConnectionStatus {
  state: UngetConnectionState;
  /** Quién editó la conexión por última vez. Vacío mientras no haya conexión. */
  maintainer?: string;
  connection?: UngetConnection;
}

/**
 * Estado de conexión de cada UNGET **registrada en Establecimientos**, por identificador.
 *
 * Es la vista que faltaba: hasta ahora el estado solo se veía desde Consulta Stock, que
 * parte de las conexiones, así que una UNGET sin conexión sencillamente no aparecía. Aquí
 * se parte de las UNGET, de modo que las que nadie configuró quedan a la vista.
 *
 * El emparejamiento admite las dos identidades que conviven en `unget_configs`: el
 * identificador oficial y, mientras haya filas sin él, el nombre normalizado. Cuando varias
 * filas apuntan a la misma UNGET se conserva una sola, con el mismo criterio que usa la
 * lista de conexiones (`pickOneConnectionPerUnget`): manda la que tiene hoja de cálculo.
 */
export const buildUngetConnectionStatus = (
  ungets: Array<{ id?: string | null; name?: string | null }> | null | undefined,
  connections: UngetConnection[] | null | undefined,
  context: { currentUsername?: string; ungetIdByUsername?: Record<string, string | undefined> } = {},
): Map<string, UngetConnectionStatus> => {
  const porClave = new Map<string, UngetConnection[]>();
  for (const connection of connections || []) {
    if (!connection) continue;
    for (const clave of ungetConnectionKeys(connection)) {
      const lista = porClave.get(clave) || [];
      lista.push(connection);
      porClave.set(clave, lista);
    }
  }

  const estados = new Map<string, UngetConnectionStatus>();
  for (const unget of ungets || []) {
    const id = String(unget?.id || "").trim();
    if (!id) continue;

    const claves = [`id:${id}`];
    const nombre = normalizeUngetName(unget?.name);
    if (nombre) claves.push(`nombre:${nombre}`);

    const candidatas: UngetConnection[] = [];
    for (const clave of claves) {
      for (const connection of porClave.get(clave) || []) {
        if (!candidatas.includes(connection)) candidatas.push(connection);
      }
    }

    // Se les fija el identificador de esta UNGET para que todas compartan clave y quede
    // una sola; así una fila sin `unget_id` también puede ganar por tener hoja.
    const elegida = pickOneConnectionPerUnget(
      candidatas.map((connection) => ({ ...connection, ungetId: id, __original: connection })),
      context,
    )[0]?.__original as UngetConnection | undefined;

    if (!elegida) {
      estados.set(id, { state: "sin-conexion" });
      continue;
    }

    estados.set(id, {
      state: describeConnectionMode(elegida, isVirtualSheetUrl),
      maintainer: String(elegida.username || "").trim() || undefined,
      connection: elegida,
    });
  }

  return estados;
};

/**
 * Si una asignación IPRESS ↔ hoja pertenece a esta conexión.
 *
 * Se compara por UNGET, no por URL: la URL de una conexión cambia al configurar su hoja o
 * al volver a desplegar su Web App, y entonces las asignaciones quedaban huérfanas sin que
 * nadie se enterara. Mientras haya asignaciones sin `ungetId`, se sigue admitiendo la URL.
 */
export const assignmentBelongsToConnection = (
  assignment: { ungetId?: string | null; sheetUrl?: string | null } | null | undefined,
  connection: { ungetId?: string | null; url?: string | null } | null | undefined,
): boolean => {
  if (!assignment || !connection) return false;
  const deLaAsignacion = String(assignment.ungetId || "").trim();
  const deLaConexion = String(connection.ungetId || "").trim();
  if (deLaAsignacion && deLaConexion) return deLaAsignacion === deLaConexion;
  const url = String(assignment.sheetUrl || "").trim();
  return !!url && url === String(connection.url || "").trim();
};
