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

/**
 * Número tal como lo muestra la hoja (locale es_ES): la coma es decimal y el punto separa
 * miles. `Number("6,4125")` daba NaN y por eso la valorización del historial salía en 0.
 */
export const parseSheetNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;

  let normalized = cleaned;
  if (cleaned.includes(",")) {
    // La coma es el decimal; los puntos que queden son separadores de miles.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Versión del detalle guardado en `changes_metadata`. */
export const STOCK_SNAPSHOT_VERSION = 2;

export interface StockSnapshotEntry {
  /** Cantidad total del medicamento y lote. */
  q: number;
  /** Nombre, necesario para mostrar los productos que desaparecen. */
  n?: string;
  /** Fecha de vencimiento tal como se ve en la hoja. */
  v?: string;
}

export type StockSnapshot = Record<string, StockSnapshotEntry>;

const readItemField = (item: any, keys: string[]): string => {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

const itemQuantity = (item: any): number =>
  parseSheetNumber(
    item?.Saldo !== undefined && item?.Saldo !== null && String(item.Saldo).trim() !== ""
      ? item.Saldo
      : item?.Saldo_Fisico ?? item?.Stock ?? 0,
  );

/**
 * Clave del historial: medicamento + lote. El tipo de suministro y la fuente de
 * financiamiento se suman, para que una reclasificación no parezca una salida y una entrada.
 */
export const stockItemKey = (item: any): string => {
  const codigo =
    readItemField(item, [
      "ID_Producto",
      "medcod",
      "Codigo_Sismed",
      "CODIGO_SISMED",
      "CODIGO_SIG",
      "Codigo",
      "ID",
      "Id",
    ]) || "SIN_CODIGO";
  const lote = readItemField(item, ["Lote", "LOTE", "lote"]) || "N/A";
  return `${codigo}|${lote}`;
};

/** Foto compacta del stock: solo lo necesario para comparar con la próxima lectura. */
export const buildStockSnapshot = (items: any[]): StockSnapshot => {
  const snapshot: StockSnapshot = {};
  for (const item of items || []) {
    if (!item) continue;
    const key = stockItemKey(item);
    const quantity = itemQuantity(item);
    const existing = snapshot[key];
    if (existing) {
      existing.q += quantity;
      continue;
    }
    snapshot[key] = {
      q: quantity,
      n: readItemField(item, ["Nombre", "Descripcion", "Medicamento"]) || undefined,
      v: readItemField(item, ["Fec_Vencim", "Fecha_Vencimiento", "Vencimiento"]) || undefined,
    };
  }
  return snapshot;
};

/**
 * Foto guardada en un registro anterior. Admite el formato antiguo, que agrupaba también
 * por tipo de suministro y fuente de financiamiento. Devuelve null si el registro no
 * trae detalle utilizable.
 */
export const readStockSnapshot = (changesMetadata?: string | null): StockSnapshot | null => {
  if (!changesMetadata) return null;
  let parsed: any;
  try {
    parsed = typeof changesMetadata === "string" ? JSON.parse(changesMetadata) : changesMetadata;
  } catch {
    return null;
  }
  const raw = parsed?.items_snapshot;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const entries = Object.entries(raw as Record<string, any>);
  if (entries.length === 0) return null;

  const snapshot: StockSnapshot = {};
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    // Formato antiguo: clave con tipo de suministro y fuente, y cantidad en `qty`.
    const [codigo = "", lote = ""] = key.split("|");
    const normalizedKey = parsed?.snapshot_version === STOCK_SNAPSHOT_VERSION ? key : `${codigo}|${lote}`;
    const quantity = parseSheetNumber(value.q ?? value.qty ?? 0);
    const existing = snapshot[normalizedKey];
    if (existing) {
      existing.q += quantity;
      continue;
    }
    snapshot[normalizedKey] = {
      q: quantity,
      n: value.n ?? value.name ?? undefined,
      v: value.v ?? value.vto ?? undefined,
    };
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
};

/** Un medicamento y lote que subió o bajó de cantidad. */
export interface StockMovement {
  id: string;
  codigo: string;
  lote: string;
  name: string;
  vto?: string;
  previousQty: number;
  currentQty: number;
  change: number;
}

/**
 * Movimientos entre dos fotos: solo medicamentos cuya cantidad cambió. Un lote que aparece
 * o desaparece con cantidad 0, o una reclasificación, no son movimientos.
 */
export const diffStockSnapshots = (
  previous: StockSnapshot,
  current: StockSnapshot,
): StockMovement[] => {
  const movements: StockMovement[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const key of keys) {
    const previousQty = previous[key]?.q || 0;
    const currentQty = current[key]?.q || 0;
    if (previousQty === currentQty) continue;

    const [codigo = "", lote = ""] = key.split("|");
    const entry = current[key] || previous[key];
    movements.push({
      id: key,
      codigo,
      lote,
      name: entry?.n || codigo || key,
      vto: entry?.v,
      previousQty,
      currentQty,
      change: currentQty - previousQty,
    });
  }

  return movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
};

/**
 * Fecha del último movimiento real de un establecimiento. Un registro de referencia
 * inicial (`has_changes` en falso) no es un movimiento y no debe mostrarse como tal.
 */
export const getLastMovementDate = (record?: {
  sync_date?: string;
  has_changes?: boolean;
  last_modification_date?: string;
} | null): string | undefined => {
  if (!record) return undefined;
  if (record.last_modification_date) return record.last_modification_date;
  return record.has_changes ? record.sync_date : undefined;
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

/**
 * Programmatically computes a quick, non-cryptographic checksum/hash representing
 * the exact items and quantities in a stock list.
 * Any change in stock, products, batches, or expiration dates will yield a different hash value.
 */
export const computeStockHash = (products: any[]): string => {
  // Agrupar por las mismas claves que usamos en el diff (codigo, lote, tipsum, ffinan)
  // para que si hay filas duplicadas se sumen, y no dependa del orden
  const grouped: Record<string, number> = {};
  
  for (const item of products) {
    if (!item) continue;
    const id = String(item.ID_Producto || item.medcod || item.Codigo_Sismed || item.CODIGO_SIG || item.Nombre || "UNKNOWN").trim();
    const lot = String(item.Lote || "N/A").trim();
    const tipsum = String(item.TIPSUM || "N/A").trim();
    const ffinan = String(item.FFINAN || "N/A").trim();
    
    const qty =
      Number(
        item.Saldo !== undefined
          ? item.Saldo
          : item.Saldo_Fisico || item.Stock || 0,
      ) || 0;
      
    const key = `${id}|${lot}|${tipsum}|${ffinan}`;
    grouped[key] = (grouped[key] || 0) + qty;
  }

  // Ordenar las claves para asegurar un hash determinista
  const sortedKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  
  let stateStr = "";
  for (const key of sortedKeys) {
    stateStr += `${key}:${grouped[key]}|`;
  }

  // DJB2 simple hashing algorithm
  let hash = 5381;
  for (let i = 0; i < stateStr.length; i++) {
    hash = (hash * 33) ^ stateStr.charCodeAt(i);
  }
  return `v1:${(hash >>> 0).toString(36)}`;
};

/** Qué hacer con una lectura de stock frente al último registro guardado. */
export type StockSyncAction = "skip" | "baseline" | "insert";

export interface StockSyncDecision {
  action: StockSyncAction;
  movements: StockMovement[];
  /** Por qué no se guarda nada: el stock es idéntico, o cambió sin mover cantidades. */
  reason?: "sin-cambios" | "sin-movimientos";
}

/**
 * Única regla de decisión del historial, compartida por la aplicación y por la captura
 * en segundo plano (`scripts/backgroundStockSync.ts`):
 *
 * - `insert`: algún medicamento y lote subió o bajó de cantidad. Es el único caso que
 *   genera un movimiento.
 * - `baseline`: no hay foto anterior utilizable, así que se guarda una referencia inicial
 *   (`has_changes` en falso) para poder comparar la próxima vez.
 * - `skip`: no hay nada que guardar.
 */
export const decideStockSyncAction = (input: {
  previous?: { stock_hash?: string; changes_metadata?: string | null } | null;
  snapshot: StockSnapshot;
  stockHash: string;
}): StockSyncDecision => {
  const previousSnapshot = input.previous ? readStockSnapshot(input.previous.changes_metadata) : null;

  if (!previousSnapshot) {
    // Sin foto anterior no se puede saber qué cambió; solo se evita repetir la referencia
    // cuando el stock es idéntico al del último registro.
    if (input.previous && input.previous.stock_hash === input.stockHash) {
      return { action: "skip", movements: [], reason: "sin-cambios" };
    }
    return { action: "baseline", movements: [] };
  }

  const movements = diffStockSnapshots(previousSnapshot, input.snapshot);
  return movements.length === 0
    ? { action: "skip", movements: [], reason: "sin-movimientos" }
    : { action: "insert", movements };
};

/** Totales que acompañan a cada registro del historial. */
export const computeStockTotals = (
  items: any[],
  snapshot: StockSnapshot,
): { totalStock: number; totalValue: number } => {
  const totalStock = Object.values(snapshot).reduce((sum, entry) => sum + entry.q, 0);
  // Los precios llegan como los muestra la hoja ("6,4125"), así que `Number()` daba NaN
  // y la valorización se guardaba en 0.
  const totalValue = (items || []).reduce((sum, item) => {
    if (!item) return sum;
    const quantity = parseSheetNumber(
      item.Saldo !== undefined && item.Saldo !== null && String(item.Saldo).trim() !== ""
        ? item.Saldo
        : item.Saldo_Fisico ?? item.Stock ?? 0,
    );
    const price = parseSheetNumber(item.Precio_Det || item.Precio_Cab || item.Precio || 0);
    return sum + quantity * price;
  }, 0);
  return { totalStock, totalValue: Number(totalValue.toFixed(2)) };
};

/** Detalle guardado en `changes_metadata`: totales, movimientos y foto para comparar. */
export const buildStockSyncMetadata = (input: {
  snapshot: StockSnapshot;
  movements: StockMovement[];
  totalStock: number;
  totalValue: number;
}): string =>
  JSON.stringify({
    snapshot_version: STOCK_SNAPSHOT_VERSION,
    total_stock: input.totalStock,
    total_value: input.totalValue,
    changes: input.movements,
    items_snapshot: input.snapshot,
  // Postgres rechaza los bytes nulos que a veces trae la hoja.
  }).replace(/\0/g, "");

/**
 * Intentos de guardado, del más completo al más pequeño. Si el detalle no entra, se recorta
 * antes que perder la foto: sin ella la próxima lectura no podría comparar y volvería a
 * marcar cambios inexistentes.
 */
export const buildStockSyncMetadataAttempts = (input: {
  snapshot: StockSnapshot;
  movements: StockMovement[];
  totalStock: number;
  totalValue: number;
}): Array<string | undefined> => [
  buildStockSyncMetadata(input),
  buildStockSyncMetadata({ ...input, movements: input.movements.slice(0, 50) }),
  buildStockSyncMetadata({ ...input, movements: [] }),
  undefined,
];
