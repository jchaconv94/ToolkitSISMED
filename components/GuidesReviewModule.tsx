import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Upload,
  Warehouse,
} from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { formatNumber } from "../services/numberFormat";
import { monthFull } from "../services/availabilityExport";
import { GUIDE_STATE_ORDER, looksLikeWarehouse, reviewGuides, reviewMonths, type GuideLine, type GuideState, type ReviewSite } from "../services/guidesReview";
import { buildGuidesReviewWorkbook, guidesReviewFileName, siteCode } from "../services/guidesReviewExport";
import type { IciSource, SourceData, WarehouseSource } from "../services/guidesReviewLoad";
import { applyNote, loadNotes, loadRecentNotes, noteKey, rememberNote, saveNotes, saveRecentNotes, suggestedNotes, type ReviewNotes } from "../services/guidesReviewNotes";
import { loadSource } from "../services/guidesReviewClient";
import {
  SOURCE_FILES,
  SOURCE_NAME,
  filesFromFolder,
  filesFromList,
  folderPermission,
  folderPickerSupported,
  forgetFolder,
  loadCopy,
  missingFiles,
  pickFolder,
  rememberFolder,
  sameFolder,
  saveCopy,
  savedFolder,
  uploadProblem,
  type FolderHandle,
  type SourceFiles,
  type SourceKind,
} from "../services/guidesReviewSources";
import { EmptyState, MobileFilterButton, SheetGroupTitle, SheetOption, StatusChip, TableSearch, UnderlineTabs, useTableSort } from "./ui/kit";
import { CustomSelect } from "./ui/CustomSelect";
import { BottomSheet } from "./ui/BottomSheet";
import { SortableTableHead, useFloatingTableHead, type SortableHeadColumn } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { stickyBarClass, useStickyBar } from "./ui/useStickyBar";
import { useIsDesktop } from "./ui/useIsDesktop";
import { GuideResultBar, GuideStateKpis, GuidesReviewDetail } from "./GuidesReviewDetail";
import { GuidesReviewLines } from "./GuidesReviewLines";

/**
 * Revisión de guías (2026-10-28): lo que el almacén de la UNGET envió a cada establecimiento en
 * un mes frente a lo que el establecimiento ingresó en su ICI, por producto (como la hoja CONTROL
 * del Excel del usuario, con sus mismas columnas), con los lotes en el detalle. Lee los DBF
 * de dos SISMED (el del almacén y el donde se importa el ICI) desde su carpeta DATOS o subidos;
 * todo se calcula en este equipo y no se guarda nada en la base. Reglas en
 * `services/guidesReview.ts` y docs/REVISION_GUIAS.md.
 */

/** Un establecimiento revisado, con su nombre y microred del registro de Establecimientos. */
export interface ReviewItem {
  site: ReviewSite;
  name: string;
  microred: string;
}

type Origin = "folder" | "files";
/** Por qué se revisa con la copia guardada y no con lo recién leído de la carpeta. */
type CopyReason = "checking" | "permission" | "unreachable" | "unreadable";
type Loaded<T> = {
  data: T;
  folder: FolderHandle | null;
  origin: Origin;
  /** Cuándo se leyó del SISMED (ms). */
  readAt: number;
  /** Última vez que se comprobó la carpeta y estaba igual (ms); null si aún no se comprueba. */
  checkedAt: number | null;
  stamp: string;
  copy: CopyReason | null;
};
type Slot = { status: "empty" | "permission" | "loading" | "error"; folder: FolderHandle | null; message?: string };
/** Qué establecimientos se ven: todos, con diferencias, sin ICI o los que tienen un estado. */
type Show = "all" | "differences" | "noIci" | GuideState;

const SHOW_LABEL: Record<Show, string> = {
  all: "Todos",
  differences: "Con diferencias",
  complete: "Todo completo",
  short: "Con incompletos",
  notReceived: "Con productos que no ingresaron",
  extra: "Con sobrantes",
  notSent: "Con ingresos sin guía",
  noIci: "Sin ICI del mes",
};

const SHOW_TEST: Record<Show, (site: ReviewSite) => boolean> = {
  all: () => true,
  differences: (s) => Boolean(s.iciCode) && s.differences > 0,
  complete: (s) => Boolean(s.iciCode) && s.differences === 0,
  short: (s) => Boolean(s.iciCode) && s.counts.short > 0,
  notReceived: (s) => Boolean(s.iciCode) && s.counts.notReceived > 0,
  extra: (s) => Boolean(s.iciCode) && s.counts.extra > 0,
  notSent: (s) => Boolean(s.iciCode) && s.counts.notSent > 0,
  noIci: (s) => !s.iciCode,
};
const SHOW_ORDER: Show[] = ["all", "differences", ...GUIDE_STATE_ORDER, "noIci"];

/** Tipos de MALMACEN que son almacenes (no tienen ICI): L logístico, A/S almacén y subalmacén, V virtual. */
const WAREHOUSE_TYPES = new Set(["L", "A", "S", "V"]);
const ESTABLISHMENT_TYPES = new Set(["P", "C", "H"]);

/** `202609` → «Setiembre 2026». */
const monthText = (key: string) => {
  const text = monthFull(key);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Nombre, tamaño y fecha de cada archivo: cambia cuando el SISMED los guarda. */
const filesStamp = (files: SourceFiles) => Object.keys(files).sort().map((name) => `${name}:${files[name].size}:${files[name].lastModified}`).join("|");

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

const pad = (n: number) => String(n).padStart(2, "0");
const hourOf = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** «hoy a las 15:20» o «el 28/10/2026 a las 15:20». */
const when = (ms: number) => {
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return `hoy a las ${hourOf(ms)}`;
  return `el ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} a las ${hourOf(ms)}`;
};
const SHORT_NAME: Record<SourceKind, string> = { warehouse: "almacén", ici: "ICI" };
const SHOWN_REASONS = new Set<CopyReason>(["permission", "unreachable", "unreadable"]);

/** Una fuente que se revisa con la copia guardada, para el aviso de arriba. */
type CopyNotice = { kind: SourceKind; reason: CopyReason; readAt: number };

/** Una frase por motivo: si las dos carpetas tienen el mismo, se dice una vez. */
const noticeTexts = (notices: CopyNotice[]) => {
  const reasons = [...new Set(notices.map((n) => n.reason))];
  return reasons.map((reason) => {
    const group = notices.filter((n) => n.reason === reason);
    const both = group.length > 1;
    const folder = both ? "las carpetas de los dos SISMED" : `la carpeta del ${SOURCE_NAME[group[0].kind]}`;
    const times = [...new Set(group.map((n) => when(n.readAt)))];
    const copy = times.length === 1
      ? `${both ? "las copias guardadas" : "la copia guardada"} ${times[0]}`
      : `las copias guardadas (${group.map((n) => `${SHORT_NAME[n.kind]} ${when(n.readAt)}`).join("; ")})`;
    if (reason === "permission") return `El navegador pide permiso para volver a leer ${folder}; mientras tanto se revisa con ${copy}.`;
    if (reason === "unreadable") return `No se pudo leer ahora ${folder} (el SISMED puede estar guardando); se revisa con ${copy}.`;
    const subject = both ? "Las carpetas de los dos SISMED no responden" : `La carpeta del ${SOURCE_NAME[group[0].kind]} no responde`;
    return `${subject}: la PC puede estar apagada o sin red. Se revisa con ${copy} y, cuando vuelva${both ? "n" : ""} a responder, se actualiza sola.`;
  });
};

const NO_MICRORED = "__none__";

type SortKey = "name" | "guides" | "products" | "result" | "review";

/**
 * Columnas de la tabla de establecimientos (rehecha el 2026-10-30: con las diez columnas de la
 * hoja CONTROL, «Salida 96 · Ingreso 99 · Completo 85» no se entendía a simple vista). Cada fila
 * se lee como una frase: cuántas guías, cuántos productos salieron e ingresaron, cómo ingresó cada
 * producto (`GuideResultBar`) y cuánto falta revisar. Las cifras por estado siguen en el Excel.
 */
const COLUMNS: SortableHeadColumn<SortKey>[] = [
  { key: "name", label: "Establecimiento" },
  { key: "guides", label: "Guías", align: "center", fit: true, title: "Guías de salida del almacén en el mes" },
  { key: "products", label: "Productos", align: "center", fit: true, title: "Productos que salieron en las guías del mes y que el establecimiento ingresó en su ICI" },
  { key: "result", label: "Cómo ingresó cada producto", title: "Ordena por la cantidad de productos con diferencias" },
  { key: "review", label: "Revisión", fit: true, title: "Diferencias que faltan revisar: las que aún no tienen observación" },
];

const CodeChip: React.FC<{ code: string }> = ({ code }) => <span className="inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{code}</span>;

const ACTION_CLASS = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";

/** Orden de las microredes: alfabético, «Sin microred» al final. */
const microredOrder = (a: string, b: string) => (a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b, "es"));

/** Ordena dentro de cada microred, sin perder el orden que eligió la persona. */
const byMicrored = (list: ReviewItem[]) => list.map((item, i) => ({ item, i })).sort((a, b) => microredOrder(a.item.microred, b.item.microred) || a.i - b.i).map((x) => x.item);

/** Diferencias del establecimiento que ya tienen observación. */
const observedCount = (site: ReviewSite, notes: ReviewNotes) => site.rows.filter((r) => r.state !== "complete" && notes[noteKey(site.destination, r.product)]).length;

export const GuidesReviewModule: React.FC = () => {
  const { user, can } = useAuth();
  const username = user?.username || "";
  const canExport = can("GUIDES_REVIEW", "export");
  const isDesktop = useIsDesktop();
  const pickerSupported = folderPickerSupported();

  const [warehouse, setWarehouse] = useState<Loaded<WarehouseSource> | null>(null);
  const [ici, setIci] = useState<Loaded<IciSource> | null>(null);
  const [slots, setSlots] = useState<Record<SourceKind, Slot>>({ warehouse: { status: "empty", folder: null }, ici: { status: "empty", folder: null } });
  const [uploadMode, setUploadMode] = useState(!pickerSupported);
  const [view, setView] = useState<"load" | "results">("load");
  const [month, setMonth] = useState("");
  const [registry, setRegistry] = useState<Map<string, { name: string; microred: string }>>(new Map());

  /** La última carpeta de cada tarjeta, para notar si se eligió la misma para las dos. */
  const folders = useRef<Record<SourceKind, FolderHandle | null>>({ warehouse: null, ici: null });
  /** Lo último de cada fuente, para leerlo dentro de las lecturas sin esperar a que se pinte. */
  const latest = useRef<{ warehouse: Loaded<WarehouseSource> | null; ici: Loaded<IciSource> | null }>({ warehouse: null, ici: null });
  /** Lectura en curso de cada carpeta: al abrir y al volver a la ventana no se lee dos veces. */
  const inflight = useRef<Record<SourceKind, Promise<boolean> | null>>({ warehouse: null, ici: null });

  const setSlot = useCallback((kind: SourceKind, slot: Slot) => {
    folders.current[kind] = slot.folder;
    setSlots((current) => ({ ...current, [kind]: slot }));
  }, []);

  const put = useCallback((kind: SourceKind, value: Loaded<SourceData> | null) => {
    if (kind === "warehouse") {
      latest.current.warehouse = value as Loaded<WarehouseSource> | null;
      setWarehouse(value as Loaded<WarehouseSource> | null);
    } else {
      latest.current.ici = value as Loaded<IciSource> | null;
      setIci(value as Loaded<IciSource> | null);
    }
  }, []);

  const patch = useCallback((kind: SourceKind, change: Partial<Loaded<SourceData>>) => {
    const have = latest.current[kind];
    if (have) put(kind, { ...have, ...change } as Loaded<SourceData>);
  }, [put]);

  /** Un error deja la tarjeta sin datos: no se revisa con lo leído antes de otra carpeta. */
  const fail = useCallback((kind: SourceKind, folder: FolderHandle | null, message: string) => {
    put(kind, null);
    setSlot(kind, { status: "error", folder, message });
    return false;
  }, [put, setSlot]);

  /** Lo leído va a la pantalla y, como copia, a este equipo (para cuando la carpeta no responda). */
  const keep = useCallback((kind: SourceKind, data: SourceData, folder: FolderHandle | null, stamp: string) => {
    const now = Date.now();
    const origin: Origin = folder ? "folder" : "files";
    put(kind, { data, folder, origin, readAt: now, checkedAt: now, stamp, copy: null });
    setSlot(kind, { status: "empty", folder });
    void saveCopy(username, kind, { data, readAt: now, stamp, origin });
    if (folder) void rememberFolder(username, kind, folder);
    else void forgetFolder(username, kind);
  }, [put, setSlot, username]);

  /** Lee una carpeta recién elegida o archivos subidos; devuelve si se pudo. */
  const readNew = useCallback(async (kind: SourceKind, files: SourceFiles, folder: FolderHandle | null): Promise<boolean> => {
    const missing = missingFiles(kind, files);
    if (missing.length) {
      const where = folder ? `la carpeta «${folder.name}»` : "los archivos elegidos";
      return fail(kind, folder, `No se encontró ${missing.join(" ni ")} en ${where}. Elija la carpeta DATOS del ${SOURCE_NAME[kind]}.`);
    }
    setSlot(kind, { status: "loading", folder });
    try {
      keep(kind, await loadSource({ kind, files }), folder, filesStamp(files));
      return true;
    } catch (err) {
      return fail(kind, folder, (err as Error).message || "No se pudieron leer los archivos del SISMED.");
    }
  }, [fail, keep, setSlot]);

  const readPickedFolder = useCallback(async (kind: SourceKind, folder: FolderHandle) => {
    setSlot(kind, { status: "loading", folder });
    let files: SourceFiles;
    try {
      files = await filesFromFolder(folder, kind);
    } catch {
      return fail(kind, folder, `No se pudo abrir la carpeta «${folder.name}». Vuelva a elegirla.`);
    }
    const ok = await readNew(kind, files, folder);
    if (!ok && kind === "warehouse" && (await sameFolder(folder, folders.current.ici))) {
      setSlots((current) => ({ ...current, warehouse: { ...current.warehouse, message: `${current.warehouse.message ?? ""} Es la misma carpeta que eligió para el SISMED del ICI.`.trim() } }));
    }
    return ok;
  }, [fail, readNew, setSlot]);

  /**
   * Vuelve a leer la carpeta que ya se usa: al abrir, al volver a la ventana o con un clic
   * (`manual`, que avisa lo que pasó). Si los archivos no cambiaron no se vuelven a leer. Si la
   * carpeta no responde (la PC del almacén apagada) o el SISMED está guardando, se sigue con lo
   * leído antes; sin nada leído, la tarjeta muestra el error.
   */
  const refreshFolder = useCallback((kind: SourceKind, folder: FolderHandle, manual: boolean): Promise<boolean> => {
    const running = inflight.current[kind];
    if (running) return running;
    const run = (async () => {
      const have = latest.current[kind];
      if (!have) setSlot(kind, { status: "loading", folder });
      let files: SourceFiles | null;
      try {
        files = await filesFromFolder(folder, kind);
      } catch {
        files = null;
      }
      if (!files || missingFiles(kind, files).length) {
        if (!have) return fail(kind, folder, `No se pudo abrir la carpeta «${folder.name}». Si está en otra PC de la red, revise que esté encendida; si cambió de lugar, vuelva a elegirla.`);
        patch(kind, { copy: "unreachable" });
        if (manual) toast.error(`La carpeta del ${SOURCE_NAME[kind]} no responde. Se sigue con la copia guardada ${when(have.readAt)}.`);
        return false;
      }
      const stamp = filesStamp(files);
      if (have && have.stamp === stamp) {
        patch(kind, { copy: null, checkedAt: Date.now() });
        return true;
      }
      try {
        keep(kind, await loadSource({ kind, files }), folder, stamp);
        return true;
      } catch (err) {
        const message = (err as Error).message || "No se pudieron leer los archivos del SISMED.";
        if (!have) return fail(kind, folder, message);
        patch(kind, { copy: "unreadable" });
        if (manual) toast.error(message);
        return false;
      }
    })();
    inflight.current[kind] = run;
    void run.finally(() => { inflight.current[kind] = null; });
    return run;
  }, [fail, keep, patch, setSlot]);

  // Al abrir: primero la copia guardada (la revisión de un mes dura varios días y la PC del
  // almacén puede estar apagada), y en seguida las carpetas de la última vez. Si el navegador
  // aún da permiso, se leen solas; si no, se sigue con la copia hasta que se dé un clic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kinds: SourceKind[] = ["warehouse", "ici"];
      const [copies, handles] = await Promise.all([
        Promise.all(kinds.map((kind) => loadCopy(username, kind))),
        Promise.all(kinds.map((kind) => savedFolder(username, kind))),
      ]);
      if (cancelled) return;
      kinds.forEach((kind, i) => {
        const copy = copies[i];
        if (!copy) return;
        const folder = copy.origin === "folder" ? handles[i] : null;
        put(kind, { data: copy.data, folder, origin: copy.origin, readAt: copy.readAt, checkedAt: null, stamp: copy.stamp, copy: folder ? "checking" : null });
        setSlot(kind, { status: "empty", folder });
      });
      const fromCopies = copies.every(Boolean);
      if (fromCopies) setView("results");
      await Promise.all(kinds.map(async (kind, i) => {
        const folder = handles[i];
        if (!folder || copies[i]?.origin === "files") return;
        if ((await folderPermission(folder, false)) !== "granted") {
          if (cancelled) return;
          if (copies[i]) patch(kind, { copy: "permission" });
          else setSlot(kind, { status: "permission", folder });
          return;
        }
        if (!cancelled) await refreshFolder(kind, folder, false);
      }));
      if (!cancelled && !fromCopies && latest.current.warehouse && latest.current.ici) setView("results");
    })();
    return () => { cancelled = true; };
  }, [username, put, patch, setSlot, refreshFolder]);

  // Trabajo progresivo (pedido del usuario): se importa el ICI de un establecimiento en el SISMED
  // y, al volver a esta ventana, se vuelven a leer las carpetas que cambiaron. Sin avisos de
  // carga ni errores: si el SISMED está guardando o la PC no responde, se queda lo leído y se
  // intenta la próxima vez (y cada minuto mientras alguna carpeta no responda).
  const warehouseFolder = warehouse?.folder ?? null;
  const iciFolder = ici?.folder ?? null;
  useEffect(() => {
    if (!warehouseFolder && !iciFolder) return;
    let busy = false;
    let last = 0;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || busy || Date.now() - last < 3000) return;
      busy = true;
      last = Date.now();
      try {
        for (const [kind, folder] of [["warehouse", warehouseFolder], ["ici", iciFolder]] as const) {
          if (!folder || (await folderPermission(folder, false)) !== "granted") continue;
          await refreshFolder(kind, folder, false);
        }
      } finally {
        busy = false;
      }
    };
    const onVisible = () => void refresh();
    const retry = window.setInterval(() => {
      const waiting = [latest.current.warehouse, latest.current.ici].some((s) => s?.copy === "unreachable" || s?.copy === "unreadable");
      if (waiting) void refresh();
    }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [warehouseFolder, iciFolder, refreshFolder]);

  /** Vuelve a leer las carpetas con un clic (el navegador puede pedir permiso). */
  const rereadAll = useCallback(async () => {
    const targets = (["warehouse", "ici"] as const).flatMap((kind) => {
      const folder = latest.current[kind]?.folder;
      return folder ? [{ kind, folder }] : [];
    });
    if (!targets.length) return;
    // Los permisos se piden juntos: el clic solo vale para pedirlos al momento.
    const allowed = await Promise.all(targets.map((t) => folderPermission(t.folder, true)));
    const ok = await Promise.all(targets.map((t, i) => (allowed[i] === "granted" ? refreshFolder(t.kind, t.folder, true) : Promise.resolve(false))));
    if (allowed.some((state) => state !== "granted")) toast.error("El navegador no dio permiso para leer la carpeta del SISMED.");
    else if (ok.every(Boolean)) toast.success("Se volvió a leer el SISMED.");
    if (!latest.current.warehouse || !latest.current.ici) setView("load");
  }, [refreshFolder]);

  // Nombre y microred del registro de Establecimientos (con su copia sin internet).
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getFacilities(), api.getMicroredes().catch(() => [])])
      .then(([facilities, microredes]) => {
        if (cancelled) return;
        const mr = new Map(microredes.map((m) => [m.id, (m.name || "").trim()]));
        setRegistry(new Map(facilities.map((f) => [String(f.code).trim(), { name: f.name, microred: (f.microredId && mr.get(f.microredId)) || "" }])));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const months = useMemo(() => (warehouse && ici ? reviewMonths(warehouse.data.warehouse, ici.data.ici) : []), [warehouse, ici]);
  // El mes que se estaba revisando sigue elegido al volver otro día.
  const monthKey = `revision-guias-mes:${username || "anon"}`;
  useEffect(() => {
    if (months.includes(month)) return;
    let saved = "";
    try {
      saved = localStorage.getItem(monthKey) || "";
    } catch {
      /* sin almacenamiento: el más reciente */
    }
    setMonth(months.includes(saved) ? saved : months[0] ?? "");
  }, [months, month, monthKey]);
  const chooseMonth = useCallback((value: string) => {
    setMonth(value);
    try {
      localStorage.setItem(monthKey, value);
    } catch {
      /* sin almacenamiento */
    }
  }, [monthKey]);

  const notices = useMemo<CopyNotice[]>(() => (["warehouse", "ici"] as const).flatMap((kind) => {
    const source = kind === "warehouse" ? warehouse : ici;
    return source?.copy && SHOWN_REASONS.has(source.copy) ? [{ kind, reason: source.copy, readAt: source.readAt }] : [];
  }), [warehouse, ici]);

  /** Desde cuándo está lo que se revisa, para la cabecera. */
  const freshness = useMemo(() => {
    const sources = [["warehouse", warehouse], ["ici", ici]] as const;
    const checked = sources.map(([, s]) => (s?.origin === "folder" && !s.copy ? s.checkedAt : null));
    if (checked.every((at): at is number => at !== null)) return `leído a las ${hourOf(Math.min(...checked))}`;
    return sources.flatMap(([kind, s]) => {
      if (!s) return [];
      if (s.origin === "files") return [`${SHORT_NAME[kind]}: archivos subidos ${when(s.readAt)}`];
      if (s.copy) return [`${SHORT_NAME[kind]}: copia guardada ${when(s.readAt)}`];
      return [`${SHORT_NAME[kind]}: leído a las ${hourOf(s.checkedAt ?? s.readAt)}`];
    }).join(" · ");
  }, [warehouse, ici]);

  const places = warehouse?.data.places;
  const products = warehouse?.data.products;
  const productName = useCallback((code: string) => products?.get(code) || code, [products]);

  const isWarehouse = useCallback((code: string) => {
    const type = places?.get(code)?.type || "";
    if (WAREHOUSE_TYPES.has(type)) return true;
    if (ESTABLISHMENT_TYPES.has(type)) return false;
    return looksLikeWarehouse(code);
  }, [places]);

  const items = useMemo<ReviewItem[]>(() => {
    if (!warehouse || !ici || !month) return [];
    return reviewGuides(warehouse.data.warehouse, ici.data.ici, month, isWarehouse).map((site) => {
      const info = registry.get(site.destination) || (site.iciCode ? registry.get(site.iciCode) : undefined);
      return { site, name: info?.name || places?.get(site.destination)?.name || site.destination, microred: info?.microred || "" };
    }).sort((a, b) => microredOrder(a.microred, b.microred) || a.name.localeCompare(b.name, "es"));
  }, [warehouse, ici, month, isWarehouse, registry, places]);

  // Líneas de las guías del mes a los establecimientos revisados (no a otros almacenes).
  const monthLines = useMemo(() => {
    if (!warehouse || !month) return [];
    const destinations = new Set(items.map((i) => i.site.destination));
    return warehouse.data.warehouse.lines.filter((l) => l.month === month && destinations.has(l.destination));
  }, [warehouse, month, items]);

  /* ------------------------------------------------------------ Observaciones */

  const [notes, setNotes] = useState<ReviewNotes>({});
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadRecentNotes(username).then((list) => { if (!cancelled) setRecent(list); });
    return () => { cancelled = true; };
  }, [username]);
  const notesScope = warehouse && month ? `${warehouse.data.warehouse.code}|${month}` : "";
  useEffect(() => {
    setNotes({});
    if (!notesScope) return;
    let cancelled = false;
    const [code, m] = notesScope.split("|");
    void loadNotes(username, code, m).then((loaded) => { if (!cancelled) setNotes(loaded); });
    return () => { cancelled = true; };
  }, [username, notesScope]);
  const changeNotes = useCallback((keys: string[], text: string) => {
    if (!notesScope) return;
    const [code, m] = notesScope.split("|");
    setNotes((current) => {
      const next = applyNote(current, keys, text);
      void saveNotes(username, code, m, next).then((ok) => { if (!ok) toast.error("No se pudo guardar la observación en este equipo."); });
      return next;
    });
    if (text.trim()) {
      setRecent((current) => {
        const next = rememberNote(current, text);
        void saveRecentNotes(username, next);
        return next;
      });
    }
  }, [username, notesScope]);
  const suggestions = useMemo(() => suggestedNotes(recent), [recent]);

  // Al volver a leer, avisa qué establecimientos ya tienen su ICI del mes.
  const iciSeen = useRef<{ month: string; codes: Set<string> } | null>(null);
  useEffect(() => {
    const codes = new Set(items.filter((i) => i.site.iciCode).map((i) => i.site.destination));
    const previous = iciSeen.current;
    if (previous && previous.month === month) {
      const added = items.filter((i) => i.site.iciCode && !previous.codes.has(i.site.destination));
      if (added.length === 1) toast.success(`${added[0].name}: su ICI ya está en el SISMED y se revisó.`);
      else if (added.length > 1) toast.success(`${formatNumber(added.length)} establecimientos más ya tienen su ICI y se revisaron.`);
    }
    iciSeen.current = { month, codes };
  }, [items, month]);

  const warehouseCode = warehouse?.data.warehouse.code || "";
  const warehouseName = places?.get(warehouseCode)?.name || registry.get(warehouseCode)?.name || "Almacén";
  const monthLabel = month ? monthText(month) : "";

  /* ---------------------------------------------------------------- Exportar */

  const exportExcel = async (only?: ReviewItem, list: ReviewItem[] = items) => {
    if (!warehouse || !month) return;
    try {
      const workbook = buildGuidesReviewWorkbook({
        warehouseName,
        warehouseCode,
        monthLabel,
        generatedAt: new Date(),
        sites: list.map(({ site, name, microred }) => ({ site, name, microred })),
        lines: warehouse.data.warehouse.lines.filter((l) => l.month === month),
        productName,
        only: only?.site.destination,
        notes,
      });
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        guidesReviewFileName(warehouseCode, month, only ? `${siteCode(only.site)} ${only.name}` : undefined),
      );
    } catch (err) {
      console.error(err);
      toast.error("No se pudo preparar el Excel.");
    }
  };

  /* ---------------------------------------------------------------- Pantallas */

  const ready = Boolean(warehouse && ici && month);

  if (view === "results" && ready) {
    return (
      <ReviewResults
        items={items}
        months={months}
        month={month}
        onMonth={chooseMonth}
        monthLabel={monthLabel}
        warehouseName={warehouseName}
        warehouseCode={warehouseCode}
        productName={productName}
        isDesktop={isDesktop}
        canExport={canExport}
        onExport={exportExcel}
        canReread={Boolean(warehouse?.folder || ici?.folder)}
        onReread={rereadAll}
        onChangeSources={() => setView("load")}
        freshness={freshness}
        notices={notices}
        iciLive={Boolean(ici?.folder && !ici.copy)}
        lines={monthLines}
        notes={notes}
        onNote={changeNotes}
        suggestions={suggestions}
      />
    );
  }

  return (
    <LoadScreen
      warehouse={warehouse}
      ici={ici}
      slots={slots}
      uploadMode={uploadMode}
      pickerSupported={pickerSupported}
      onUploadMode={setUploadMode}
      months={months}
      month={month}
      onMonth={chooseMonth}
      warehouseName={warehouseName}
      onPick={async (kind) => {
        const folder = await pickFolder(kind);
        if (folder) await readPickedFolder(kind, folder);
      }}
      onAllow={async (kind, folder) => {
        if ((await folderPermission(folder, true)) === "granted") await refreshFolder(kind, folder, true);
        else if (latest.current[kind]) toast.error("El navegador no dio permiso para leer la carpeta.");
        else setSlot(kind, { status: "permission", folder, message: "El navegador no dio permiso para leer la carpeta." });
      }}
      onFiles={(kind, list) => {
        const files = [...list];
        const problem = uploadProblem(kind, files.map((f) => f.name));
        if (problem) fail(kind, null, problem);
        else void readNew(kind, filesFromList(files, kind), null);
      }}
      onReview={() => setView("results")}
    />
  );
};

/* ==================================================================== Carga */

const LoadScreen: React.FC<{
  warehouse: Loaded<WarehouseSource> | null;
  ici: Loaded<IciSource> | null;
  slots: Record<SourceKind, Slot>;
  uploadMode: boolean;
  pickerSupported: boolean;
  onUploadMode: (upload: boolean) => void;
  months: string[];
  month: string;
  onMonth: (month: string) => void;
  warehouseName: string;
  onPick: (kind: SourceKind) => Promise<void>;
  onAllow: (kind: SourceKind, folder: FolderHandle) => Promise<void>;
  onFiles: (kind: SourceKind, files: FileList) => void;
  onReview: () => void;
}> = ({ warehouse, ici, slots, uploadMode, pickerSupported, onUploadMode, months, month, onMonth, warehouseName, onPick, onAllow, onFiles, onReview }) => {
  const both = Boolean(warehouse && ici);
  const noCommonMonth = both && months.length === 0;

  const warehouseSummary = warehouse && (() => {
    const data = warehouse.data.warehouse;
    const guides = new Set(data.lines.map((l) => l.guide)).size;
    const oldest = data.months[data.months.length - 1];
    return {
      title: warehouseName,
      hint: `${data.code} · ${plural(guides, "guía de salida", "guías de salida")} desde ${monthText(oldest).toLowerCase()}`,
    };
  })();

  /** Copia guardada o archivos subidos: se dice en la tarjeta, con el clic para leer la carpeta. */
  const statusOf = (kind: SourceKind, source: Loaded<SourceData> | null): CardStatus | null => {
    if (!source) return null;
    if (source.origin === "files") return { text: `Archivos subidos ${when(source.readAt)}.` };
    const copy = `Copia guardada ${when(source.readAt)}.`;
    const folder = source.folder;
    const action = (label: string) => (folder ? { label, run: () => void onAllow(kind, folder) } : undefined);
    if (source.copy === "permission") return { warn: true, text: `${copy} El navegador pide permiso para leer la carpeta.`, action: action("Leer la carpeta") };
    if (source.copy === "unreachable") return { warn: true, text: `${copy} La carpeta no responde: la PC puede estar apagada o sin red.`, action: action("Reintentar") };
    if (source.copy === "unreadable") return { warn: true, text: `${copy} No se pudo leer la carpeta ahora.`, action: action("Reintentar") };
    return null;
  };

  const iciSummary = ici && (() => {
    const data = ici.data.ici;
    const codes = new Set<string>();
    data.codes.forEach((set) => set.forEach((c) => codes.add(c)));
    const shown = data.months.slice(0, 3).map((m) => monthText(m).toLowerCase());
    const rest = data.months.length - shown.length;
    return {
      title: `ICI de ${plural(codes.size, "establecimiento o farmacia", "establecimientos y farmacias")}`,
      hint: `Meses: ${shown.join(", ")}${rest > 0 ? ` y ${plural(rest, "más", "más")}` : ""}`,
    };
  })();

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24 md:pb-0">
      <div>
        <h2 className="text-lg font-black text-slate-900">Revisar las guías del almacén</h2>
        <p className="text-[13px] text-slate-500">Compara lo que el almacén envió a cada establecimiento con lo que el establecimiento ingresó en su ICI, por producto.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SourceCard
          kind="warehouse"
          icon={<Warehouse className="h-5 w-5" />}
          title="SISMED del almacén"
          description="Las guías de salida a los establecimientos"
          slot={slots.warehouse}
          loaded={warehouseSummary || null}
          status={statusOf("warehouse", warehouse)}
          uploadMode={uploadMode}
          onPick={onPick}
          onAllow={onAllow}
          onFiles={onFiles}
        />
        <SourceCard
          kind="ici"
          icon={<FileSpreadsheet className="h-5 w-5" />}
          title="SISMED del ICI"
          description="Donde se importa el ICI de cada establecimiento"
          slot={slots.ici}
          loaded={iciSummary || null}
          status={statusOf("ici", ici)}
          uploadMode={uploadMode}
          onPick={onPick}
          onAllow={onAllow}
          onFiles={onFiles}
        />
      </div>

      {noCommonMonth && warehouse && ici && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p>
            Los dos SISMED no tienen ningún mes en común: el almacén tiene guías hasta {monthText(warehouse.data.warehouse.months[0]).toLowerCase()} y
            el TFORMDET tiene el ICI hasta {monthText(ici.data.ici.months[0]).toLowerCase()}. Revise que eligió las carpetas correctas.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <CustomSelect
          size="md"
          prefix="Mes"
          value={month}
          onChange={onMonth}
          disabled={!months.length}
          placeholder="Mes"
          options={months.map((m) => ({ value: m, label: monthText(m) }))}
          containerClassName="md:w-64"
        />
        <p className="flex-1 text-[12px] text-slate-500">{both ? "Solo los meses que están en los dos SISMED." : "Elija primero los dos SISMED."}</p>
        <button
          type="button"
          onClick={onReview}
          disabled={!both || !month}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowDownUp className="h-4 w-4" /> Revisar
        </button>
      </div>

      <p className="text-center text-[12px] text-slate-400">
        Los archivos se leen en este equipo y no se suben a internet. Lo leído queda guardado aquí: si la PC del almacén se apaga, se sigue revisando con esa copia.{" "}
        {pickerSupported && (uploadMode ? (
          <button type="button" onClick={() => onUploadMode(false)} className="font-bold text-teal-700 hover:underline">Elegir las carpetas</button>
        ) : (
          <>¿No puede elegir la carpeta? <button type="button" onClick={() => onUploadMode(true)} className="font-bold text-teal-700 hover:underline">Suba los archivos</button></>
        ))}
        {!pickerSupported && "Este navegador no puede abrir carpetas: suba los archivos (en Chrome o Edge se elige la carpeta una vez)."}
      </p>
    </div>
  );
};

/** Lo que se dice bajo lo leído: de cuándo es la copia o los archivos subidos. */
type CardStatus = { text: string; warn?: boolean; action?: { label: string; run: () => void } };

const FileChip: React.FC<{ name: string; optional?: boolean }> = ({ name, optional }) => (
  <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${optional ? "border-dashed border-slate-300 text-slate-500" : "border-slate-300 bg-slate-50 text-slate-800"}`}>{name}</span>
);

const SourceCard: React.FC<{
  kind: SourceKind;
  icon: React.ReactNode;
  title: string;
  description: string;
  slot: Slot;
  loaded: { title: string; hint: string } | null;
  status: CardStatus | null;
  uploadMode: boolean;
  onPick: (kind: SourceKind) => Promise<void>;
  onAllow: (kind: SourceKind, folder: FolderHandle) => Promise<void>;
  onFiles: (kind: SourceKind, files: FileList) => void;
}> = ({ kind, icon, title, description, slot, loaded, status, uploadMode, onPick, onAllow, onFiles }) => {
  const input = useRef<HTMLInputElement>(null);
  const files = SOURCE_FILES[kind];
  const names = [...files.required, ...files.optional].map((name) => name.replace(/\.DBF$/, "")).join(", ").replace(/, ([^,]*)$/, " y $1");
  const choose = () => (uploadMode ? input.current?.click() : void onPick(kind));
  const chooseLabel = uploadMode ? "Subir archivos" : "Elegir carpeta";
  const ChooseIcon = uploadMode ? Upload : FolderOpen;

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <input
        ref={input}
        type="file"
        multiple
        accept=".dbf,.DBF"
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(kind, event.target.files);
          event.target.value = "";
        }}
      />
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">{icon}</div>
        <div className="min-w-0">
          <p className="text-[15px] font-black text-slate-900">{title}</p>
          <p className="text-[13px] text-slate-500">{description}</p>
        </div>
      </div>

      {slot.status === "loading" ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[13px] font-semibold text-slate-600">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-teal-600" />
          Leyendo {names}…
        </div>
      ) : loaded && slot.status !== "error" ? (
        <div className={`mt-4 rounded-xl border px-3 py-2.5 ${status?.warn ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-center gap-3">
            {status?.warn ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[13px] font-bold ${status?.warn ? "text-amber-900" : "text-emerald-800"}`} title={loaded.title}>{loaded.title}</p>
              <p className={`truncate text-[11.5px] ${status?.warn ? "text-amber-800" : "text-emerald-700"}`}>{loaded.hint}</p>
            </div>
            <button type="button" onClick={choose} className="shrink-0 text-xs font-bold text-teal-700 hover:underline">Cambiar</button>
          </div>
          {status && (
            <p className={`mt-1.5 text-[11.5px] ${status.warn ? "text-amber-900" : "text-emerald-700"}`}>
              {status.text}
              {status.action && (
                <>
                  {" "}
                  <button type="button" onClick={status.action.run} className="font-bold text-teal-700 hover:underline">{status.action.label}</button>
                </>
              )}
            </p>
          )}
        </div>
      ) : slot.status === "permission" && slot.folder ? (
        <>
          <p className="mt-4 text-[12px] text-slate-500">
            La carpeta <b className="font-mono">{slot.folder.name}</b> de la última vez. El navegador pide permiso para volver a leerla.
          </p>
          {slot.message && <p className="mt-1 text-[12px] font-semibold text-red-600">{slot.message}</p>}
          <button type="button" onClick={() => void onAllow(kind, slot.folder!)} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-bold text-white hover:bg-teal-700">
            <RefreshCw className="h-4 w-4" /> Leer la carpeta
          </button>
          <button type="button" onClick={choose} className="mt-2 text-center text-xs font-bold text-teal-700 hover:underline">{uploadMode ? "Subir archivos" : "Elegir otra carpeta"}</button>
        </>
      ) : (
        <>
          {slot.status === "error" && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700">{slot.message}</p>
          )}
          {uploadMode ? (
            <div className="mt-4 text-[12px] text-slate-500">
              <p>Elija estos archivos de la carpeta <b className="font-mono">DATOS</b> del {SOURCE_NAME[kind]}; se pueden marcar juntos.</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {files.required.map((name) => <FileChip key={name} name={name} />)}
                {files.optional.map((name) => <FileChip key={name} name={name} optional />)}
              </div>
              {files.optional.length > 0 && <p className="mt-1.5 text-[11.5px] text-slate-400">Los de borde punteado son opcionales: dan los nombres de establecimientos y productos.</p>}
            </div>
          ) : slot.status !== "error" && (
            <p className="mt-4 text-[12px] text-slate-500">La carpeta <b className="font-mono">DATOS</b> del SISMED. Se leen {names}.</p>
          )}
          <button type="button" onClick={choose} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-bold text-white hover:bg-teal-700">
            <ChooseIcon className="h-4 w-4" /> {chooseLabel}
          </button>
        </>
      )}
    </div>
  );
};

/* ================================================================ Resultado */

const ReviewResults: React.FC<{
  items: ReviewItem[];
  months: string[];
  month: string;
  onMonth: (month: string) => void;
  monthLabel: string;
  warehouseName: string;
  warehouseCode: string;
  productName: (code: string) => string;
  isDesktop: boolean;
  canExport: boolean;
  onExport: (only?: ReviewItem, list?: ReviewItem[]) => Promise<void>;
  canReread: boolean;
  onReread: () => Promise<void>;
  onChangeSources: () => void;
  /** Desde cuándo está lo que se revisa («leído a las 15:20», «almacén: copia guardada…»). */
  freshness: string;
  /** Fuentes que se revisan con la copia guardada porque la carpeta no se pudo leer. */
  notices: CopyNotice[];
  /** ¿Se relee solo el SISMED del ICI al volver a la ventana? */
  iciLive: boolean;
  lines: GuideLine[];
  notes: ReviewNotes;
  onNote: (keys: string[], text: string) => void;
  suggestions: string[];
}> = ({ items, months, month, onMonth, monthLabel, warehouseName, warehouseCode, productName, isDesktop, canExport, onExport, canReread, onReread, onChangeSources, freshness, notices, iciLive, lines, notes, onNote, suggestions }) => {
  const [tab, setTab] = useState<"sites" | "lines">("sites");
  const [show, setShow] = useState<Show>("all");
  const [microred, setMicrored] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("revision-guias", 20);
  const [open, setOpen] = useState<{ list: ReviewItem[]; index: number } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<"export" | "reread" | null>(null);
  const toolbar = useStickyBar<HTMLDivElement>();

  useEffect(() => setOpen(null), [month]);

  const withIci = items.filter((i) => i.site.iciCode);
  const totals = useMemo(() => {
    const t = { complete: 0, short: 0, extra: 0, notReceived: 0, notSent: 0 };
    items.forEach(({ site }) => {
      if (!site.iciCode) return;
      t.complete += site.counts.complete;
      t.short += site.counts.short;
      t.extra += site.counts.extra;
      t.notReceived += site.counts.notReceived;
      t.notSent += site.counts.notSent;
    });
    return t;
  }, [items]);
  const showCount = (value: Show) => items.filter((i) => SHOW_TEST[value](i.site)).length;
  const noIci = items.length - withIci.length;

  const microreds = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((i) => counts.set(i.microred || NO_MICRORED, (counts.get(i.microred || NO_MICRORED) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => (a[0] === NO_MICRORED ? 1 : b[0] === NO_MICRORED ? -1 : a[0].localeCompare(b[0], "es")));
  }, [items]);
  useEffect(() => {
    if (microred && !microreds.some(([m]) => m === microred)) setMicrored("");
  }, [microreds, microred]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => SHOW_TEST[show](i.site)
      && (!microred || (i.microred || NO_MICRORED) === microred)
      && (!q || i.name.toLowerCase().includes(q) || i.site.destination.toLowerCase().includes(q) || (i.site.iciCode ?? "").toLowerCase().includes(q) || i.microred.toLowerCase().includes(q)));
  }, [items, show, microred, query]);

  const { sorted: bySort, headSort } = useTableSort<ReviewItem, SortKey>(
    filtered,
    {
      name: (i) => i.name,
      guides: (i) => i.site.guides.length,
      products: (i) => i.site.sentProducts,
      result: (i) => (i.site.iciCode ? i.site.differences : null),
      review: (i) => (i.site.iciCode ? i.site.differences - observedCount(i.site, notes) : null),
    },
    { firstDir: { guides: "desc", products: "desc", result: "desc", review: "desc" } },
  );
  // Siempre agrupado por microred, como la hoja CONTROL; el orden elegido rige dentro de cada una.
  const sorted = useMemo(() => byMicrored(bySort), [bySort]);
  const groupStats = useMemo(() => {
    const stats = new Map<string, { sites: number; differences: number; noIci: number }>();
    sorted.forEach(({ site, microred: m }) => {
      const s = stats.get(m) ?? { sites: 0, differences: 0, noIci: 0 };
      s.sites++;
      if (!site.iciCode) s.noIci++;
      else if (site.differences) s.differences++;
      stats.set(m, s);
    });
    return stats;
  }, [sorted]);
  const signature = `${month}|${show}|${microred}|${query}|${sorted.length}|${tab}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature, 20);
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);
  const { tableRef, floating } = useFloatingTableHead([signature, page, pageSize, isDesktop, sorted]);

  const toggle = (value: Show) => { setTab("sites"); setShow((current) => (current === value ? "all" : value)); };
  const filterActive = show !== "all" || Boolean(microred);

  const stateMaps = useMemo(() => new Map(items.filter((i) => i.site.iciCode).map((i) => [i.site.destination, new Map(i.site.rows.map((r) => [r.product, r.state]))])), [items]);
  const stateOf = useCallback((destination: string, product: string): GuideState | undefined => stateMaps.get(destination)?.get(product), [stateMaps]);
  const linesOf = useMemo(() => {
    const map = new Map<string, GuideLine[]>();
    lines.forEach((l) => {
      if (!map.has(l.destination)) map.set(l.destination, []);
      map.get(l.destination)!.push(l);
    });
    return map;
  }, [lines]);
  const siteList = useMemo(() => items.map((i) => ({ destination: i.site.destination, name: i.name, code: siteCode(i.site) })).sort((a, b) => a.name.localeCompare(b.name, "es")), [items]);
  const openSite = (destination: string) => {
    const index = items.findIndex((i) => i.site.destination === destination);
    if (index >= 0) setOpen({ list: items, index });
  };

  const runExport = async () => {
    setBusy("export");
    try {
      await onExport(undefined, sorted);
    } finally {
      setBusy(null);
    }
  };
  const runReread = async () => {
    setBusy("reread");
    try {
      await onReread();
    } finally {
      setBusy(null);
    }
  };

  const showOptions = SHOW_ORDER.filter((value) => value === "all" || value === show || showCount(value) > 0);

  /**
   * Cuánto falta revisar: «Todo bien» si todo ingresó completo; si hay diferencias, cuántas
   * faltan observar, y «Revisado» cuando todas tienen observación. Sin ámbar ni violeta: esos
   * colores son de los estados.
   */
  const reviewStatus = (site: ReviewSite) => {
    if (!site.iciCode) return <span className="text-[13px] text-slate-300">—</span>;
    if (!site.differences) {
      return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Todo bien</span>;
    }
    const done = observedCount(site, notes);
    const of = `${formatNumber(done)} de ${formatNumber(site.differences)} con observación`;
    if (done === site.differences) {
      return (
        <div className="whitespace-nowrap">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-700"><Check className="h-4 w-4" />Revisado</p>
          <p className="text-[11.5px] text-slate-500">{of}</p>
        </div>
      );
    }
    return (
      <div className="whitespace-nowrap">
        <p className="text-[13px] font-bold text-slate-800">{formatNumber(site.differences - done)} por revisar</p>
        <p className="text-[11.5px] text-slate-500">{of}</p>
      </div>
    );
  };
  const productsCell = (site: ReviewSite) => (
    <div className="whitespace-nowrap text-[13px] text-slate-600">
      <p><b className="font-bold text-slate-900">{formatNumber(site.sentProducts)}</b> enviados</p>
      {site.iciCode && <p><b className="font-bold text-slate-900">{formatNumber(site.receivedProducts)}</b> ingresados</p>}
    </div>
  );
  const groupLabel = (m: string) => {
    const stats = groupStats.get(m);
    const parts = [plural(stats?.sites ?? 0, "establecimiento", "establecimientos")];
    if (stats?.differences) parts.push(`${formatNumber(stats.differences)} con diferencias`);
    if (stats?.noIci) parts.push(`${formatNumber(stats.noIci)} sin ICI`);
    return parts.join(" · ");
  };

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-black text-slate-900 md:truncate">
            {warehouseName} <span className="font-mono text-[13px] font-semibold text-slate-400">{warehouseCode}</span>
          </p>
          <p className="text-[12.5px] text-slate-500">
            Guías de salida de {monthLabel.toLowerCase()} frente al ICI de cada establecimiento · por producto{freshness ? ` · ${freshness}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CustomSelect size="md" prefix="Mes" value={month} onChange={onMonth} options={months.map((m) => ({ value: m, label: monthText(m) }))} containerClassName="min-w-0 flex-1 md:w-56 md:flex-none" />
          {canExport && (
            <button type="button" onClick={() => void runExport()} disabled={busy === "export" || !sorted.length} className="hidden h-10 shrink-0 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50 md:flex">
              {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => (isDesktop ? setMenuOpen((value) => !value) : setActionsOpen(true))}
              aria-label="Más acciones"
              aria-expanded={isDesktop ? menuOpen : undefined}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            >
              {busy === "reread" ? <RefreshCw className="h-4 w-4 animate-spin text-teal-600" /> : <MoreHorizontal className="h-5 w-5" />}
            </button>
            {menuOpen && isDesktop && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {canReread && (
                    <button type="button" disabled={busy !== null} onClick={() => { setMenuOpen(false); void runReread(); }} className={ACTION_CLASS}>
                      <RefreshCw className="h-4 w-4 text-teal-600" /> Volver a leer el SISMED
                    </button>
                  )}
                  <button type="button" onClick={() => { setMenuOpen(false); onChangeSources(); }} className={ACTION_CLASS}>
                    <FolderOpen className="h-4 w-4 text-teal-600" /> Cambiar las carpetas
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {notices.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 space-y-0.5">
              {noticeTexts(notices).map((text) => <p key={text}>{text}</p>)}
            </div>
          </div>
          {canReread && (
            <button
              type="button"
              onClick={() => void runReread()}
              disabled={busy !== null}
              className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${busy === "reread" ? "animate-spin" : ""}`} />
              {notices.some((n) => n.reason === "permission") ? "Leer el SISMED" : "Reintentar"}
            </button>
          )}
        </div>
      )}

      <GuideStateKpis counts={totals} active={tab === "sites" && (GUIDE_STATE_ORDER as string[]).includes(show) ? (show as GuideState) : null} onToggle={toggle} />

      <UnderlineTabs
        label="Ver"
        value={tab}
        onChange={setTab}
        tabs={[{ id: "sites", label: "Establecimientos", count: items.length }, { id: "lines", label: "Guías de salida", count: lines.length }]}
      />

      {tab === "lines" ? (
        <GuidesReviewLines lines={lines} sites={siteList} stateOf={stateOf} productName={productName} isDesktop={isDesktop} onOpenSite={openSite} monthLabel={monthLabel} />
      ) : (
        <>
          {noIci > 0 && show !== "noIci" && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              <p className="min-w-0 flex-1">
                {noIci === 1 ? "A un establecimiento le falta" : `A ${formatNumber(noIci)} establecimientos les falta`} importar el ICI de {monthLabel.toLowerCase()} en el SISMED del ICI.
                {iciLive ? " Al importarlo y volver a esta ventana, se revisa solo." : ""}
              </p>
              <button type="button" onClick={() => setShow("noIci")} className="shrink-0 text-xs font-bold text-teal-700 hover:underline">Ver</button>
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm md:overflow-hidden">
            <div ref={toolbar.ref} style={toolbar.style} className={`${stickyBarClass} flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-white p-3 md:static`}>
              <TableSearch value={query} onChange={setQuery} placeholder="Buscar establecimiento o código" />
              <MobileFilterButton onClick={() => setFiltersOpen(true)} active={filterActive} />
              {isDesktop && (
                <>
                  <CustomSelect
                    size="md"
                    prefix="Microred"
                    value={microred}
                    onChange={setMicrored}
                    options={[{ value: "", label: "Todas", count: items.length }, ...microreds.map(([m, count]) => ({ value: m, label: m === NO_MICRORED ? "Sin microred" : m, count }))]}
                    containerClassName="w-60 shrink-0"
                    menuMinWidth={260}
                  />
                  <CustomSelect
                    size="md"
                    prefix="Mostrar"
                    value={show}
                    onChange={(value) => setShow((value as Show) || "all")}
                    options={showOptions.map((value) => ({ value, label: SHOW_LABEL[value], count: value === "all" ? items.length : showCount(value) }))}
                    containerClassName="w-60 shrink-0"
                    menuMinWidth={240}
                  />
                </>
              )}
            </div>

            <BottomSheet open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
              <SheetGroupTitle first>Mostrar</SheetGroupTitle>
              <div className="space-y-1">
                {showOptions.map((value) => (
                  <SheetOption key={value} active={show === value} label={SHOW_LABEL[value]} count={value === "all" ? items.length : showCount(value)} onClick={() => { setShow(value); setFiltersOpen(false); }} />
                ))}
              </div>
              {microreds.length > 1 && (
                <>
                  <SheetGroupTitle>Microred</SheetGroupTitle>
                  <div className="space-y-1">
                    <SheetOption active={!microred} label="Todas" count={items.length} onClick={() => { setMicrored(""); setFiltersOpen(false); }} />
                    {microreds.map(([m, count]) => (
                      <SheetOption key={m} active={microred === m} label={m === NO_MICRORED ? "Sin microred" : m} count={count} onClick={() => { setMicrored(m); setFiltersOpen(false); }} />
                    ))}
                  </div>
                </>
              )}
            </BottomSheet>

            {filterActive && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs font-semibold text-slate-600">
                <span>
                  Mostrando <strong>{SHOW_LABEL[show].toLowerCase()}</strong>
                  {microred && <> · microred <strong>{microred === NO_MICRORED ? "sin microred" : microred}</strong></>}
                </span>
                <button type="button" onClick={() => { setShow("all"); setMicrored(""); }} className="font-bold text-teal-700 hover:underline">Ver todos</button>
              </div>
            )}

            {sorted.length === 0 ? (
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title={items.length ? "Sin resultados" : `El almacén no envió guías a establecimientos en ${monthLabel.toLowerCase()}`}
                description={items.length ? "No hay establecimientos que coincidan con la búsqueda o el filtro." : "Elija otro mes."}
              />
            ) : isDesktop ? (
              <>
                <table ref={tableRef} className="w-full text-left text-sm">
                  <SortableTableHead columns={COLUMNS} headSort={headSort} floating={floating} trailing="Abrir" />
                  <tbody>
                    {rows.map((item, i) => {
                      const { site } = item;
                      const newGroup = i === 0 || rows[i - 1].microred !== item.microred;
                      return (
                        <React.Fragment key={site.destination}>
                          {newGroup && (
                            <tr className="border-t border-slate-200 bg-slate-50/80">
                              <td colSpan={COLUMNS.length + 1} className="px-4 py-2">
                                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">{item.microred || "Sin microred"}</span>
                                <span className="ml-2 text-[11.5px] text-slate-500">{groupLabel(item.microred)}</span>
                              </td>
                            </tr>
                          )}
                          <tr onClick={() => setOpen({ list: sorted, index: sorted.indexOf(item) })} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="text-[13.5px] font-semibold text-slate-900">{item.name}</p>
                              <CodeChip code={siteCode(site)} />
                            </td>
                            <td className="px-3 py-3 text-center text-[13px] font-bold text-slate-900">{formatNumber(site.guides.length)}</td>
                            <td className="px-3 py-3">{productsCell(site)}</td>
                            <td className="w-[38%] px-4 py-3">
                              {site.iciCode ? <GuideResultBar counts={site.counts} /> : <StatusChip tone="neutral" label={`Falta importar su ICI de ${monthLabel.toLowerCase()}`} />}
                            </td>
                            <td className="px-4 py-3">{reviewStatus(site)}</td>
                            <td className="px-2 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="establecimientos" />
              </>
            ) : (
              <div className="space-y-2 bg-slate-50 p-2">
                {rows.map((item, index) => {
                  const { site } = item;
                  const newGroup = index === 0 || rows[index - 1].microred !== item.microred;
                  return (
                    <React.Fragment key={site.destination}>
                      {newGroup && (
                        <p className="px-2 pb-0.5 pt-2 text-[11px] font-black uppercase tracking-wider text-slate-600">
                          {item.microred || "Sin microred"} <span className="font-semibold normal-case tracking-normal text-slate-400">· {groupLabel(item.microred)}</span>
                        </p>
                      )}
                      <button type="button" onClick={() => setOpen({ list: sorted, index })} className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500">
                            <span className="font-mono">{siteCode(site)}</span> · {plural(site.guides.length, "guía", "guías")} · {formatNumber(site.sentProducts)} enviados{site.iciCode ? ` · ${formatNumber(site.receivedProducts)} ingresados` : ""}
                          </p>
                          <div className="mt-2.5">
                            {site.iciCode ? <GuideResultBar counts={site.counts} /> : <StatusChip tone="neutral" label={`Falta importar su ICI de ${monthLabel.toLowerCase()}`} />}
                          </div>
                          {site.iciCode && (
                            <div className="mt-2 border-t border-slate-100 pt-2">{reviewStatus(site)}</div>
                          )}
                        </div>
                        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                      </button>
                    </React.Fragment>
                  );
                })}
                <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="establecimientos" />
              </div>
            )}
          </section>
        </>
      )}

      <BottomSheet open={actionsOpen} title="Acciones" onClose={() => setActionsOpen(false)}>
        <div className="space-y-1">
          {canExport && (
            <button type="button" disabled={busy !== null || !sorted.length} onClick={() => { setActionsOpen(false); void runExport(); }} className={ACTION_CLASS}>
              <Download className="h-5 w-5 text-teal-600" /> Descargar Excel
            </button>
          )}
          {canReread && (
            <button type="button" disabled={busy !== null} onClick={() => { setActionsOpen(false); void runReread(); }} className={ACTION_CLASS}>
              <RefreshCw className="h-5 w-5 text-teal-600" /> Volver a leer el SISMED
            </button>
          )}
          <button type="button" onClick={() => { setActionsOpen(false); onChangeSources(); }} className={ACTION_CLASS}>
            <FolderOpen className="h-5 w-5 text-teal-600" /> Cambiar las carpetas
          </button>
        </div>
      </BottomSheet>

      {open && open.list[open.index] && (
        <GuidesReviewDetail
          items={open.list}
          index={open.index}
          onIndex={(index) => setOpen((current) => (current ? { ...current, index } : current))}
          onClose={() => setOpen(null)}
          productName={productName}
          monthLabel={monthLabel}
          isDesktop={isDesktop}
          lines={linesOf.get(open.list[open.index].site.destination) ?? []}
          notes={notes}
          onNote={onNote}
          suggestions={suggestions}
          onExport={canExport ? (item) => onExport(item) : undefined}
        />
      )}
    </div>
  );
};
