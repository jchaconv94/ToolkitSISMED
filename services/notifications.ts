/**
 * Campanita de avisos: qué avisos tiene la persona, calculados de los datos de ahora.
 *
 * Ningún aviso se guarda en la base. Cada revisión (al entrar, cada 15 minutos o a mano)
 * vuelve a leer las fuentes y arma la lista desde cero: un aviso desaparece solo en cuanto
 * su causa se resuelve. Lo único que se recuerda, en el navegador y por usuario, es qué
 * avisos ya vio y desde cuándo está cada uno a la vista.
 *
 * Fuentes:
 *   - Técnicos (permiso Claves de envío): intentos bloqueados, establecimientos sin enviar,
 *     Toolkit y SISMED desactualizados. Mismas reglas que `AdminSendKeysModule`.
 *   - Consumo de Backups SISMED (solo el administrador): la lectura del servicio de Cloudflare.
 *   - Farmacia (Stock SISMED con establecimiento): su propia hoja de stock.
 *
 * Todo lo de aquí es lógica pura, sin pantalla ni red; los componentes están en
 * `components/NotificationBell.tsx` y la carga en `contexts/NotificationsContext.tsx`.
 */

import type { AppModule } from "../types";
import type { Tone } from "../components/ui/kit";
import type { SendKeyRow } from "./sendKeys";
import { type ToolkitDeviceRow, latestSismedVersion, sismedState } from "./toolkitDevices";
import { lastSendAt, latestDevice, mergeEstablishments, pendingAlerts, toolkitState } from "./sendKeyEstablishments";
import type { UsageReading } from "./backupConnection";
import { type StockRow, parseExpiryDate, parseStockNumber } from "./assignedIpressStock";

export const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
//  Parámetros
// ---------------------------------------------------------------------------

export interface NoticeThresholds {
  /** Días sin enviar el stock a partir de los cuales se avisa. */
  staleDays: number;
  /** Ventana de «lotes por vencer», en días. */
  expiryDays: number;
}

export const DEFAULT_NOTICE_THRESHOLDS: NoticeThresholds = { staleDays: 3, expiryDays: 90 };

export const NOTICE_THRESHOLD_LIMITS = {
  staleDays: { min: 1, max: 30 },
  expiryDays: { min: 7, max: 365 },
} as const;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Valores guardados (o lo que llegue) dentro de sus límites; lo que falte, por omisión. */
export const normalizeThresholds = (raw?: Partial<Record<keyof NoticeThresholds, unknown>> | null): NoticeThresholds => ({
  staleDays: clampInt(raw?.staleDays, NOTICE_THRESHOLD_LIMITS.staleDays.min, NOTICE_THRESHOLD_LIMITS.staleDays.max, DEFAULT_NOTICE_THRESHOLDS.staleDays),
  expiryDays: clampInt(raw?.expiryDays, NOTICE_THRESHOLD_LIMITS.expiryDays.min, NOTICE_THRESHOLD_LIMITS.expiryDays.max, DEFAULT_NOTICE_THRESHOLDS.expiryDays),
});

// ---------------------------------------------------------------------------
//  Avisos
// ---------------------------------------------------------------------------

export type NoticeId =
  | "claves-bloqueadas"
  | "stock-sin-actualizar"
  | "toolkit-desactualizado"
  | "sismed-antiguo"
  | "backups-consumo"
  | "lotes-vencidos"
  | "lotes-por-vencer"
  | "sin-stock"
  | "mi-stock-sin-actualizar";

export type NoticeIcon = "shield" | "database" | "settings" | "file" | "download" | "ban" | "pill" | "boxes";

export type NoticeSource = "claves" | "backups" | "farmacia";

export const NOTICE_SOURCE_FAILURE: Record<NoticeSource, string> = {
  claves: "No se pudieron revisar los envíos de stock.",
  backups: "No se pudo medir el consumo de Backups SISMED.",
  farmacia: "No se pudo leer el stock de tu establecimiento.",
};

export interface Notice {
  id: NoticeId;
  source: NoticeSource;
  tone: Tone;
  icon: NoticeIcon;
  title: string;
  detail: string;
  action: { label: string; module: AppModule; tab?: "consumo" };
  /**
   * Resumen del contenido. Si cambia (otro número, otros establecimientos), el aviso
   * vuelve a contar como no visto.
   */
  signature: string;
  /** Cuándo ocurrió la causa, si se sabe (p. ej. el intento bloqueado). */
  at?: string | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const andMore = (shown: string[], total: number) =>
  total > shown.length ? `${shown.join(", ")} y ${total - shown.length} más` : shown.join(" y ");

/** Huella corta de una lista larga (lotes): basta para notar que cambió. */
export const hashText = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// --- Técnicos --------------------------------------------------------------------------

export interface TechnicalInput {
  keys: SendKeyRow[];
  /** Si las PC no se pudieron leer, llega vacío y solo cuentan las claves. */
  devices: ToolkitDeviceRow[];
  /** Última versión publicada del Toolkit; `null` si GitHub no respondió. */
  latestToolkit: string | null;
  thresholds: NoticeThresholds;
  now?: Date;
}

export const buildTechnicalNotices = ({ keys, devices, latestToolkit, thresholds, now = new Date() }: TechnicalInput): Notice[] => {
  const notices: Notice[] = [];
  const rows = mergeEstablishments(keys, devices);

  // 1. Intentos bloqueados sin revisar (ni ignorados ni resueltos).
  const alerts = pendingAlerts(keys);
  if (alerts.length) {
    const first = alerts[0];
    const device = first.alert?.deviceName ? ` · equipo ${first.alert.deviceName}` : "";
    notices.push({
      id: "claves-bloqueadas",
      source: "claves",
      tone: "danger",
      icon: "shield",
      title: plural(alerts.length, "PC no autorizada intentó enviar stock", `${alerts.length} PC no autorizadas intentaron enviar stock`),
      detail: `${first.name} (${first.code})${device}${alerts.length > 1 ? ` y ${alerts.length - 1} más` : ""}`,
      action: { label: "Revisar", module: "ADMIN_SEND_KEYS" },
      signature: alerts.map((row) => `${row.code}:${row.alert?.id}`).sort().join(","),
      at: first.alert?.at || null,
    });
  }

  // 2. Establecimientos cuyo último envío conocido es más viejo que el umbral. Los que
  //    nunca enviaron no cuentan: eso ya lo dice «Esperando primer envío».
  const limit = thresholds.staleDays * DAY_MS;
  const stale = rows
    .map((row) => ({ row, last: lastSendAt(row, now) }))
    .filter(({ last }) => last && now.getTime() - new Date(last).getTime() > limit)
    .sort((a, b) => String(a.last).localeCompare(String(b.last)));
  if (stale.length) {
    notices.push({
      id: "stock-sin-actualizar",
      source: "claves",
      tone: "warning",
      icon: "database",
      title: `${stale.length} ${plural(stale.length, "establecimiento", "establecimientos")} sin actualizar su stock`,
      detail: `${andMore(stale.slice(0, 2).map(({ row }) => row.name), stale.length)} · hace más de ${thresholds.staleDays} ${plural(thresholds.staleDays, "día", "días")}`,
      action: { label: "Ver", module: "ADMIN_SEND_KEYS" },
      signature: `${thresholds.staleDays}:${stale.map(({ row }) => row.code).sort().join(",")}`,
    });
  }

  // 3. Toolkit desactualizado: la PC más reciente de cada establecimiento, contra la
  //    versión publicada. Sin versión publicada conocida no hay con qué comparar.
  if (latestToolkit) {
    const outdated = rows.filter((row) => toolkitState(row, latestToolkit, now) === "outdated");
    if (outdated.length) {
      const versions = Array.from(new Set(outdated.map((row) => latestDevice(row, now)?.version).filter(Boolean) as string[]));
      notices.push({
        id: "toolkit-desactualizado",
        source: "claves",
        tone: "info",
        icon: "settings",
        title: `${outdated.length} PC con el Toolkit desactualizado`,
        detail: versions.length
          ? `${plural(outdated.length, "Tiene", "Tienen")} ${versions.slice(0, 3).join(", ")}; la vigente es ${latestToolkit}`
          : `La vigente es ${latestToolkit}`,
        action: { label: "Ver", module: "ADMIN_SEND_KEYS" },
        signature: `${latestToolkit}:${outdated.map((row) => row.code).sort().join(",")}`,
      });
    }
  }

  // 4. SISMED antiguo: contra la versión más alta que reporta alguna PC.
  const latestSismed = latestSismedVersion(rows, now);
  const oldSismed = rows.filter((row) => sismedState(row, latestSismed, now) === "outdated");
  if (oldSismed.length && latestSismed) {
    const first = oldSismed[0];
    const firstVersion = latestDevice(first, now)?.sismedVersion;
    notices.push({
      id: "sismed-antiguo",
      source: "claves",
      tone: "info",
      icon: "file",
      title: `${oldSismed.length} PC con una versión antigua del SISMED`,
      detail: `${first.name} usa v${firstVersion}${oldSismed.length > 1 ? ` y ${oldSismed.length - 1} más` : ""} · la vigente es v${latestSismed}`,
      action: { label: "Ver", module: "ADMIN_SEND_KEYS" },
      signature: `${latestSismed}:${oldSismed.map((row) => row.code).sort().join(",")}`,
    });
  }

  return notices;
};

// --- Backups ---------------------------------------------------------------------------

/** Desde aquí se avisa; desde `BACKUP_PAUSE_RATIO` el servicio pausa las descargas. */
export const BACKUP_WARN_RATIO = 0.7;
export const BACKUP_PAUSE_RATIO = 0.8;

export const buildBackupNotice = (usage: UsageReading | null | undefined): Notice | null => {
  const worst = usage?.worst;
  const ratio = worst?.ratio;
  if (!usage || usage.level === "unknown" || !worst || ratio == null || !Number.isFinite(ratio)) return null;
  const paused = usage.level === "paused" || ratio >= BACKUP_PAUSE_RATIO;
  if (!paused && ratio < BACKUP_WARN_RATIO) return null;
  const pct = Math.round(ratio * 100);
  return {
    id: "backups-consumo",
    source: "backups",
    tone: paused ? "danger" : "warning",
    icon: "download",
    title: `Backups: el plan gratuito va al ${pct} %`,
    detail: paused
      ? `${worst.label}. Las descargas están en pausa hasta que baje el consumo`
      : `${worst.label}. Al 80 % se pausan las descargas`,
    action: { label: "Ver consumo", module: "ADMIN_BACKUPS", tab: "consumo" },
    signature: `${paused ? "pausa" : "aviso"}:${worst.key}`,
  };
};

// --- Farmacia --------------------------------------------------------------------------

export interface PharmacyInput {
  /** Filas propias ya normalizadas (`Nombre`, `Lote`, `Fec_Vencim`, `Saldo`, `Id_Producto`). */
  rows: StockRow[];
  /** La «Última actualización» más reciente de la hoja, en milisegundos (0 si no hay). */
  lastUpdateAt: number;
  thresholds: NoticeThresholds;
  now?: Date;
}

const productName = (row: StockRow) => String(row.Nombre || row.Id_Producto || "Producto sin nombre").trim();
const lotKey = (row: StockRow) => `${String(row.Id_Producto ?? "")}|${String(row.Lote ?? "")}|${String(row.Fec_Vencim ?? "")}`;
const monthYear = (date: Date) => `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;

export const buildPharmacyNotices = ({ rows, lastUpdateAt, thresholds, now = new Date() }: PharmacyInput): Notice[] => {
  const notices: Notice[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today.getTime() + thresholds.expiryDays * DAY_MS);
  windowEnd.setHours(23, 59, 59, 999);

  const withStock = rows
    .map((row) => ({ row, expiry: parseExpiryDate(row.Fec_Vencim), stock: parseStockNumber(row.Saldo) }))
    .filter(({ stock }) => stock > 0);

  // 5. Vencidos con saldo: el que venció primero va primero.
  const expired = withStock.filter(({ expiry }) => expiry && expiry < today).sort((a, b) => a.expiry!.getTime() - b.expiry!.getTime());
  if (expired.length) {
    const first = expired[0].row;
    const lot = String(first.Lote || "").trim();
    notices.push({
      id: "lotes-vencidos",
      source: "farmacia",
      tone: "danger",
      icon: "ban",
      title: `${expired.length} ${plural(expired.length, "lote vencido", "lotes vencidos")} todavía en stock`,
      detail: `${productName(first)}${lot ? ` (${lot})` : ""}${expired.length > 1 ? ` y ${expired.length - 1} más` : ""}`,
      action: { label: "Ver", module: "IPRESS_STOCK" },
      signature: `${expired.length}:${hashText(expired.map(({ row }) => lotKey(row)).sort().join(","))}`,
    });
  }

  // 6. Por vencer dentro de la ventana: el más próximo va primero.
  const expiring = withStock
    .filter(({ expiry }) => expiry && expiry >= today && expiry <= windowEnd)
    .sort((a, b) => a.expiry!.getTime() - b.expiry!.getTime());
  if (expiring.length) {
    const first = expiring[0];
    notices.push({
      id: "lotes-por-vencer",
      source: "farmacia",
      tone: "warning",
      icon: "pill",
      title: `${expiring.length} ${plural(expiring.length, "lote vence", "lotes vencen")} en los próximos ${thresholds.expiryDays} días`,
      detail: `El primero: ${productName(first.row)}, ${monthYear(first.expiry!)}`,
      action: { label: "Ver", module: "IPRESS_STOCK" },
      signature: `${thresholds.expiryDays}:${expiring.length}:${hashText(expiring.map(({ row }) => lotKey(row)).sort().join(","))}`,
    });
  }

  // 7. Medicamentos sin stock: el producto (todas sus filas) suma cero.
  const byProduct = new Map<string, { name: string; total: number }>();
  rows.forEach((row) => {
    const key = String(row.Id_Producto || row.Nombre || "").trim();
    if (!key) return;
    const current = byProduct.get(key) || { name: productName(row), total: 0 };
    current.total += parseStockNumber(row.Saldo);
    byProduct.set(key, current);
  });
  const empty = Array.from(byProduct.entries())
    .filter(([, p]) => p.total <= 0)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "es"));
  if (empty.length) {
    notices.push({
      id: "sin-stock",
      source: "farmacia",
      tone: "neutral",
      icon: "boxes",
      title: `${empty.length} ${plural(empty.length, "medicamento", "medicamentos")} sin stock`,
      detail: `${empty[0][1].name}${empty.length > 1 ? ` y ${empty.length - 1} más` : ""}`,
      action: { label: "Ver", module: "IPRESS_STOCK" },
      signature: `${empty.length}:${hashText(empty.map(([key]) => key).sort().join(","))}`,
    });
  }

  // 8. La hoja propia lleva días sin actualizarse.
  if (lastUpdateAt > 0) {
    const days = Math.floor((now.getTime() - lastUpdateAt) / DAY_MS);
    if (now.getTime() - lastUpdateAt > thresholds.staleDays * DAY_MS) {
      notices.push({
        id: "mi-stock-sin-actualizar",
        source: "farmacia",
        tone: "warning",
        icon: "database",
        title: `Tu stock no se actualiza hace ${days} ${plural(days, "día", "días")}`,
        detail: "Revisa que el Sync SISMED esté encendido en la PC de farmacia",
        action: { label: "Ver", module: "IPRESS_STOCK" },
        // La misma actualización vieja no vuelve a avisar cada día que pasa.
        signature: `${thresholds.staleDays}:${lastUpdateAt}`,
      });
    }
  }

  return notices;
};

// ---------------------------------------------------------------------------
//  Visto / sin ver
// ---------------------------------------------------------------------------

export interface NoticeMemory {
  /** id → firma con la que se marcó como visto. */
  seen: Record<string, string>;
  /** id → desde cuándo está a la vista (ms). Se olvida cuando el aviso desaparece. */
  since: Record<string, number>;
}

export const EMPTY_MEMORY: NoticeMemory = { seen: {}, since: {} };

/** Sin ver: nunca se marcó, o su contenido cambió desde que se marcó. */
export const isUnseen = (notice: Notice, memory: NoticeMemory): boolean => memory.seen[notice.id] !== notice.signature;

export const unseenCount = (notices: Notice[], memory: NoticeMemory): number =>
  notices.filter((notice) => isUnseen(notice, memory)).length;

/** Texto del distintivo rojo: nada en 0, «9+» por encima de 9. */
export const badgeLabel = (count: number): string => (count <= 0 ? "" : count > 9 ? "9+" : String(count));

export const markSeen = (memory: NoticeMemory, notices: Notice[]): NoticeMemory => ({
  ...memory,
  seen: { ...memory.seen, ...Object.fromEntries(notices.map((n) => [n.id, n.signature])) },
});

/**
 * Anota desde cuándo está cada aviso. Los que ya no están se olvidan, salvo los de una
 * fuente que esta vez no respondió (`keepSources`): su aviso no se resolvió, solo no se vio.
 */
export const trackSince = (
  memory: NoticeMemory,
  notices: Notice[],
  now: number,
  keep: (id: string) => boolean = () => false,
): NoticeMemory => {
  const since: Record<string, number> = {};
  Object.entries(memory.since).forEach(([id, at]) => { if (keep(id)) since[id] = at; });
  notices.forEach((n) => { since[n.id] = memory.since[n.id] ?? now; });
  return { ...memory, since };
};

/** Fuente de cada aviso, para no olvidar los de una fuente que falló. */
export const NOTICE_SOURCE_OF: Record<NoticeId, NoticeSource> = {
  "claves-bloqueadas": "claves",
  "stock-sin-actualizar": "claves",
  "toolkit-desactualizado": "claves",
  "sismed-antiguo": "claves",
  "backups-consumo": "backups",
  "lotes-vencidos": "farmacia",
  "lotes-por-vencer": "farmacia",
  "sin-stock": "farmacia",
  "mi-stock-sin-actualizar": "farmacia",
};

const MEMORY_PREFIX = "avisos:";

export const loadNoticeMemory = (username: string): NoticeMemory => {
  try {
    const raw = localStorage.getItem(MEMORY_PREFIX + username);
    if (!raw) return EMPTY_MEMORY;
    const data = JSON.parse(raw);
    return {
      seen: data && typeof data.seen === "object" && data.seen ? data.seen : {},
      since: data && typeof data.since === "object" && data.since ? data.since : {},
    };
  } catch {
    return EMPTY_MEMORY;
  }
};

export const saveNoticeMemory = (username: string, memory: NoticeMemory): void => {
  try {
    localStorage.setItem(MEMORY_PREFIX + username, JSON.stringify(memory));
  } catch {
    /* sin almacenamiento: los avisos se siguen viendo, solo no se recuerda lo visto */
  }
};

// ---------------------------------------------------------------------------
//  Tiempo
// ---------------------------------------------------------------------------

/** «ahora», «hace 25 min», «hace 3 h», «ayer», «hace 4 días». */
export const noticeWhen = (at: number | string | null | undefined, now: Date = new Date()): string => {
  if (at === null || at === undefined || at === "") return "";
  const time = typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - time) / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((startToday.getTime() - time) / DAY_MS);
  if (days <= 1) return "ayer";
  return `hace ${days} días`;
};
