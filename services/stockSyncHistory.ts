/**
 * Reglas puras del historial de Consulta Stock (`stock_sync_history`).
 *
 * No tocan Supabase ni el navegador para poder probarlas. El historial se construye
 * exclusivamente con stock leído de Google Sheets; nada de aquí usa `stock_actual`.
 */

/**
 * Columnas reales de `stock_sync_history`, sin `changes_metadata` (80-190 KB por fila).
 * La tabla NO tiene `created_at`: pedirla hace que PostgREST responda 400 y todas las
 * tarjetas queden en "Sin verificar".
 */
export const STOCK_SYNC_LIGHT_COLUMNS =
  "id,establishment_id,establishment_name,sync_date,record_count,stock_hash,has_changes,changed_items_count,sync_author";

/**
 * Margen para equipos con el reloj algo adelantado. Un registro posterior a
 * "ahora + margen" es un dato erróneo (fecha DD/MM invertida o reloj mal configurado):
 * si se tomara como el último, quedaría "último" durante días y todo cambio nuevo se
 * compararía contra él.
 */
export const FUTURE_SYNC_TOLERANCE_MS = 15 * 60 * 1000;

export const getSyncDateCutoffIso = (now: number = Date.now()): string =>
  new Date(now + FUTURE_SYNC_TOLERANCE_MS).toISOString();

const DMY_DATE_PREFIX = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/;
const DMY_DATE_TIME =
  /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;

/**
 * Fecha de Google Sheets / SISMED en milisegundos (hora local).
 *
 * `DD/MM/YYYY [HH:mm[:ss]]` se interpreta siempre como día/mes. Un texto con esa forma
 * que no se pueda leer devuelve 0: pasarlo a `new Date()` lo leería como MM/DD.
 * Cualquier otro texto (ISO) usa el parser nativo. Devuelve 0 si no es una fecha válida.
 */
export const parseSheetDateTime = (value?: string | null): number => {
  if (!value) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  const match = raw.match(DMY_DATE_TIME);
  if (match) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
    const d = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    // Rechaza desbordes como 31/02 que Date convierte silenciosamente en marzo.
    if (d.getDate() !== Number(day) || d.getMonth() !== Number(month) - 1) return 0;
    return d.getTime();
  }
  if (DMY_DATE_PREFIX.test(raw)) return 0;

  const native = new Date(raw).getTime();
  return Number.isNaN(native) ? 0 : native;
};

/**
 * `sync_date` que se guardará para un snapshot: la última actualización de la hoja o,
 * si falta, es ilegible o está en el futuro, el momento actual.
 */
export const resolveSyncDateIso = (
  sheetLastUpdate?: string | null,
  now: number = Date.now(),
): string => {
  const parsed = parseSheetDateTime(sheetLastUpdate);
  if (!parsed || parsed > now + FUTURE_SYNC_TOLERANCE_MS) {
    return new Date(now).toISOString();
  }
  return new Date(parsed).toISOString();
};

export interface StockSyncDatedRow {
  establishment_id: string;
  sync_date: string;
  has_changes?: boolean;
  last_modification_date?: string;
}

const isUsableSyncDate = (syncDate: string, now: number): number | null => {
  const ts = Date.parse(syncDate);
  if (!Number.isFinite(ts) || ts > now + FUTURE_SYNC_TOLERANCE_MS) return null;
  return ts;
};

/** Registro válido más reciente de una lista (ignora fechas futuras o ilegibles). */
export const findLatestValidSync = <T extends StockSyncDatedRow>(
  rows: T[],
  now: number = Date.now(),
): T | undefined => {
  let latest: T | undefined;
  let latestTs = -Infinity;
  for (const row of rows) {
    const ts = isUsableSyncDate(row.sync_date, now);
    if (ts !== null && ts > latestTs) {
      latest = row;
      latestTs = ts;
    }
  }
  return latest;
};

/**
 * Último registro válido por `establishment_id`, con `last_modification_date` igual a la
 * fecha del registro con cambios más reciente que venga en `rows`.
 */
export const pickLatestSyncs = <T extends StockSyncDatedRow>(
  rows: T[],
  now: number = Date.now(),
): Record<string, T> => {
  const usable = rows
    .map((row) => ({ row, ts: isUsableSyncDate(row.sync_date, now) }))
    .filter((item): item is { row: T; ts: number } => item.ts !== null)
    .sort((a, b) => b.ts - a.ts);

  const latest: Record<string, T> = {};
  for (const { row } of usable) {
    const id = row.establishment_id;
    if (!latest[id]) latest[id] = { ...row };
    if (row.has_changes && !latest[id].last_modification_date) {
      latest[id].last_modification_date = row.sync_date;
    }
  }
  return latest;
};

/**
 * Grupos de claves (una por establecimiento) que todavía no tienen ningún registro en
 * `latest`. Sin grupos, cada clave pendiente es su propio grupo.
 */
export const findGroupsWithoutSync = (
  ids: string[],
  latest: Record<string, unknown>,
  keyGroups?: string[][],
): string[][] => {
  const wanted = new Set(ids);
  const groups = keyGroups
    ? keyGroups.map((group) => group.filter((key) => wanted.has(key)))
    : ids.map((id) => [id]);
  return groups.filter(
    (group) => group.length > 0 && !group.some((key) => latest[key]),
  );
};
