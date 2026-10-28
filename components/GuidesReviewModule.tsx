import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  PackageX,
  RefreshCw,
  Search,
  Truck,
  Upload,
  Warehouse,
} from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { formatNumber } from "../services/numberFormat";
import { monthFull } from "../services/availabilityExport";
import { looksLikeWarehouse, reviewGuides, reviewMonths, type GuideLine, type GuideState, type ReviewSite } from "../services/guidesReview";
import { buildGuidesReviewWorkbook, guidesReviewFileName, siteCode } from "../services/guidesReviewExport";
import type { IciSource, WarehouseSource } from "../services/guidesReviewLoad";
import { applyNote, loadNotes, loadRecentNotes, noteKey, rememberNote, saveNotes, saveRecentNotes, suggestedNotes, type ReviewNotes } from "../services/guidesReviewNotes";
import { loadSource } from "../services/guidesReviewClient";
import {
  SOURCE_FILES,
  filesFromFolder,
  filesFromList,
  folderPermission,
  folderPickerSupported,
  missingFiles,
  pickFolder,
  sameFolder,
  savedFolder,
  type FolderHandle,
  type SourceFiles,
  type SourceKind,
} from "../services/guidesReviewSources";
import { EmptyState, KpiCard, KpiStrip, MobileFilterButton, SheetGroupTitle, SheetOption, StatusChip, TableSearch, UnderlineTabs, useTableSort, type Tone } from "./ui/kit";
import { CustomSelect } from "./ui/CustomSelect";
import { BottomSheet } from "./ui/BottomSheet";
import { SortableTableHead, useFloatingTableHead, type SortableHeadColumn } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { stickyBarClass, useStickyBar } from "./ui/useStickyBar";
import { useIsDesktop } from "./ui/useIsDesktop";
import { GuidesReviewDetail } from "./GuidesReviewDetail";
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

type Loaded<T> = { data: T; folder: FolderHandle | null };
type Slot = { status: "empty" | "permission" | "loading" | "error"; folder: FolderHandle | null; message?: string };
type Show = "all" | "differences" | "short" | "extra" | "notSent" | "ok" | "noIci";

const SHOW_LABEL: Record<Show, string> = {
  all: "Todos",
  differences: "Con diferencias",
  short: "Faltan o no ingresó",
  extra: "Sobran",
  notSent: "No se dio salida",
  ok: "Todo ingresó",
  noIci: "Sin ICI del mes",
};

const SHOW_TEST: Record<Show, (site: ReviewSite) => boolean> = {
  all: () => true,
  differences: (s) => Boolean(s.iciCode) && s.differences > 0,
  short: (s) => Boolean(s.iciCode) && s.counts.short + s.counts.notReceived > 0,
  extra: (s) => Boolean(s.iciCode) && s.counts.extra > 0,
  notSent: (s) => Boolean(s.iciCode) && s.counts.notSent > 0,
  ok: (s) => Boolean(s.iciCode) && s.differences === 0,
  noIci: (s) => !s.iciCode,
};

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

const NO_MICRORED = "__none__";

type SortKey = "name" | "guides" | "sentProducts" | "receivedProducts" | "complete" | "notSent" | "extra" | "short" | "notReceived" | "observed";

/** Las columnas de la hoja CONTROL del Excel del usuario, en su mismo orden. */
const COLUMNS: SortableHeadColumn<SortKey>[] = [
  { key: "name", label: "Establecimiento" },
  { key: "guides", label: "Nº guías", align: "center", fit: true, title: "Guías de salida del almacén en el mes" },
  { key: "sentProducts", label: "Salida med", align: "center", fit: true, title: "Productos que salieron del almacén en el mes" },
  { key: "receivedProducts", label: "Ingreso med", align: "center", fit: true, title: "Productos que el establecimiento ingresó en su ICI" },
  { key: "complete", label: "Completo", align: "center", fit: true, title: "Ingresó lo mismo que salió" },
  { key: "notSent", label: "No salida", align: "center", fit: true, title: "Ingresó un producto que el almacén no le dio salida en el mes" },
  { key: "extra", label: "Sobra", align: "center", fit: true, title: "Ingresó más de lo que salió" },
  { key: "short", label: "Falta", align: "center", fit: true, title: "Ingresó menos de lo que salió" },
  { key: "notReceived", label: "No ingresó", align: "center", fit: true, title: "Salió del almacén y no lo ingresó" },
  { key: "observed", label: "Observados", align: "center", fit: true, title: "Diferencias con observación" },
];

const Count: React.FC<{ value: number; tone: Tone }> = ({ value, tone }) =>
  value > 0 ? <StatusChip tone={tone} label={formatNumber(value)} /> : <span className="text-[13px] text-slate-300">0</span>;

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
  /** Tamaño y fecha de los archivos leídos: si no cambiaron, no se vuelven a leer. */
  const stamps = useRef<Record<SourceKind, string>>({ warehouse: "", ici: "" });
  const [readAt, setReadAt] = useState<Date | null>(null);

  const setSlot = (kind: SourceKind, slot: Slot) => {
    folders.current[kind] = slot.folder;
    setSlots((current) => ({ ...current, [kind]: slot }));
  };

  /** Un error deja la tarjeta sin datos: no se revisa con lo leído antes de otra carpeta. */
  const fail = (kind: SourceKind, folder: FolderHandle | null, message: string) => {
    if (kind === "warehouse") setWarehouse(null);
    else setIci(null);
    setSlot(kind, { status: "error", folder, message });
    return false;
  };

  /** Lee los archivos de una de las dos fuentes; devuelve si se pudo. */
  const read = useCallback(async (kind: SourceKind, files: SourceFiles, folder: FolderHandle | null): Promise<boolean> => {
    const missing = missingFiles(kind, files);
    if (missing.length) {
      const where = folder ? `la carpeta «${folder.name}»` : "los archivos elegidos";
      return fail(kind, folder, `No se encontró ${missing.join(" ni ")} en ${where}. Elija la carpeta DATOS del SISMED.`);
    }
    setSlot(kind, { status: "loading", folder });
    try {
      const data = await loadSource({ kind, files });
      if (data.kind === "warehouse") setWarehouse({ data, folder });
      else setIci({ data, folder });
      stamps.current[kind] = filesStamp(files);
      setReadAt(new Date());
      setSlot(kind, { status: "empty", folder });
      return true;
    } catch (err) {
      return fail(kind, folder, (err as Error).message || "No se pudieron leer los archivos del SISMED.");
    }
  }, []);

  const readFolder = useCallback(async (kind: SourceKind, folder: FolderHandle) => {
    setSlot(kind, { status: "loading", folder });
    let files: SourceFiles;
    try {
      files = await filesFromFolder(folder, kind);
    } catch {
      return fail(kind, folder, `No se pudo abrir la carpeta «${folder.name}». Vuelva a elegirla.`);
    }
    const ok = await read(kind, files, folder);
    if (!ok && kind === "warehouse" && (await sameFolder(folder, folders.current.ici))) {
      setSlots((current) => ({ ...current, warehouse: { ...current.warehouse, message: `${current.warehouse.message ?? ""} Es la misma carpeta que eligió para el SISMED del ICI.`.trim() } }));
    }
    return ok;
  }, [read]);

  // Las carpetas de la última vez: si el navegador aún da permiso, se leen solas y se pasa
  // directo al resultado; si no, cada tarjeta pide un clic para volver a leerla.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kinds: SourceKind[] = ["warehouse", "ici"];
      const results = await Promise.all(kinds.map(async (kind) => {
        const folder = await savedFolder(username, kind);
        if (!folder || cancelled) return false;
        if ((await folderPermission(folder, false)) !== "granted") {
          if (!cancelled) setSlot(kind, { status: "permission", folder });
          return false;
        }
        return cancelled ? false : readFolder(kind, folder);
      }));
      if (!cancelled && results.every(Boolean)) setView("results");
    })();
    return () => { cancelled = true; };
  }, [username, readFolder]);

  // Trabajo progresivo (pedido del usuario): se importa el ICI de un establecimiento en el SISMED
  // y, al volver a esta ventana, se vuelven a leer las carpetas que cambiaron. Sin avisos de
  // carga ni errores: si el SISMED está escribiendo, se queda lo leído y se intenta la próxima vez.
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
          let files: SourceFiles;
          try {
            files = await filesFromFolder(folder, kind);
          } catch {
            continue;
          }
          const stamp = filesStamp(files);
          if (missingFiles(kind, files).length || stamp === stamps.current[kind]) continue;
          try {
            const data = await loadSource({ kind, files });
            if (data.kind === "warehouse") setWarehouse({ data, folder });
            else setIci({ data, folder });
            stamps.current[kind] = stamp;
            setReadAt(new Date());
          } catch {
            /* se queda lo leído antes */
          }
        }
      } finally {
        busy = false;
      }
    };
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [warehouseFolder, iciFolder]);

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
  useEffect(() => {
    if (!months.includes(month)) setMonth(months[0] ?? "");
  }, [months, month]);

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
        onMonth={setMonth}
        monthLabel={monthLabel}
        warehouseName={warehouseName}
        warehouseCode={warehouseCode}
        productName={productName}
        isDesktop={isDesktop}
        canExport={canExport}
        onExport={exportExcel}
        canReread={Boolean(warehouse?.folder && ici?.folder)}
        onReread={async () => {
          const ok = await Promise.all([
            warehouse?.folder ? readFolder("warehouse", warehouse.folder) : Promise.resolve(false),
            ici?.folder ? readFolder("ici", ici.folder) : Promise.resolve(false),
          ]);
          if (ok.every(Boolean)) toast.success("Se volvió a leer el SISMED.");
          else setView("load");
        }}
        onChangeSources={() => setView("load")}
        readAt={readAt}
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
      onMonth={setMonth}
      warehouseName={warehouseName}
      onPick={async (kind) => {
        const folder = await pickFolder(username, kind);
        if (folder) await readFolder(kind, folder);
      }}
      onAllow={async (kind, folder) => {
        if ((await folderPermission(folder, true)) === "granted") await readFolder(kind, folder);
        else setSlot(kind, { status: "permission", folder, message: "El navegador no dio permiso para leer la carpeta." });
      }}
      onFiles={(kind, list) => void read(kind, filesFromList(list, kind), null)}
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
        <p className="flex-1 text-[12px] text-slate-500">{both ? "Solo los meses que están en los dos SISMED." : "Elija primero las dos carpetas."}</p>
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
        Los archivos se leen en este equipo: no se suben a internet.{" "}
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

const SourceCard: React.FC<{
  kind: SourceKind;
  icon: React.ReactNode;
  title: string;
  description: string;
  slot: Slot;
  loaded: { title: string; hint: string } | null;
  uploadMode: boolean;
  onPick: (kind: SourceKind) => Promise<void>;
  onAllow: (kind: SourceKind, folder: FolderHandle) => Promise<void>;
  onFiles: (kind: SourceKind, files: FileList) => void;
}> = ({ kind, icon, title, description, slot, loaded, uploadMode, onPick, onAllow, onFiles }) => {
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
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-emerald-800" title={loaded.title}>{loaded.title}</p>
            <p className="truncate text-[11.5px] text-emerald-700">{loaded.hint}</p>
          </div>
          <button type="button" onClick={choose} className="shrink-0 text-xs font-bold text-teal-700 hover:underline">Cambiar</button>
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
          {slot.status === "error" ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700">{slot.message}</p>
          ) : (
            <p className="mt-4 text-[12px] text-slate-500">
              {uploadMode ? <>Los archivos {names} de la carpeta <b className="font-mono">DATOS</b> del SISMED.</> : <>La carpeta <b className="font-mono">DATOS</b> del SISMED. Se leen {names}.</>}
            </p>
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
  /** Hora de la última lectura del SISMED. */
  readAt: Date | null;
  lines: GuideLine[];
  notes: ReviewNotes;
  onNote: (keys: string[], text: string) => void;
  suggestions: string[];
}> = ({ items, months, month, onMonth, monthLabel, warehouseName, warehouseCode, productName, isDesktop, canExport, onExport, canReread, onReread, onChangeSources, readAt, lines, notes, onNote, suggestions }) => {
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
      sentProducts: (i) => i.site.sentProducts,
      receivedProducts: (i) => (i.site.iciCode ? i.site.receivedProducts : null),
      complete: (i) => (i.site.iciCode ? i.site.counts.complete : null),
      short: (i) => (i.site.iciCode ? i.site.counts.short : null),
      extra: (i) => (i.site.iciCode ? i.site.counts.extra : null),
      notReceived: (i) => (i.site.iciCode ? i.site.counts.notReceived : null),
      notSent: (i) => (i.site.iciCode ? i.site.counts.notSent : null),
      observed: (i) => (i.site.iciCode && i.site.differences ? observedCount(i.site, notes) / i.site.differences : null),
    },
    { firstDir: { guides: "desc", sentProducts: "desc", receivedProducts: "desc", complete: "desc", short: "desc", extra: "desc", notReceived: "desc", notSent: "desc" } },
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

  const showOptions = (Object.keys(SHOW_LABEL) as Show[]).filter((value) => value === "all" || value === show || showCount(value) > 0);
  const readText = readAt ? `leído a las ${String(readAt.getHours()).padStart(2, "0")}:${String(readAt.getMinutes()).padStart(2, "0")}` : "";

  const observedChip = (site: ReviewSite) => {
    if (!site.iciCode || !site.differences) return <span className="text-[13px] text-slate-300">—</span>;
    const done = observedCount(site, notes);
    return <StatusChip tone={done === site.differences ? "success" : done ? "warning" : "neutral"} label={`${formatNumber(done)} de ${formatNumber(site.differences)}`} />;
  };
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
            Guías de salida de {monthLabel.toLowerCase()} frente al ICI de cada establecimiento · por producto{readText ? ` · ${readText}` : ""}
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

      <KpiStrip cols="md:grid-cols-5">
        <KpiCard watermark tone="neutral" icon={<Truck />} label="Establecimientos" value={formatNumber(items.length)} hint={`${formatNumber(showCount("differences"))} con diferencias · ${formatNumber(noIci)} sin ICI`} onClick={() => toggle("differences")} active={tab === "sites" && show === "differences"} />
        <KpiCard watermark tone="success" icon={<PackageCheck />} label="Completos" value={formatNumber(totals.complete)} hint="productos" onClick={() => toggle("ok")} active={tab === "sites" && show === "ok"} />
        <KpiCard watermark tone="info" icon={<CircleHelp />} label="No se dio salida" value={formatNumber(totals.notSent)} hint="ingresó sin guía del almacén" onClick={() => toggle("notSent")} active={tab === "sites" && show === "notSent"} />
        <KpiCard watermark tone="warning" label="Sobran" value={formatNumber(totals.extra)} hint="el EESS ingresó más" onClick={() => toggle("extra")} active={tab === "sites" && show === "extra"} />
        <KpiCard watermark tone="danger" icon={<PackageX />} label="Faltan / no ingresó" value={formatNumber(totals.short + totals.notReceived)} hint="el EESS ingresó menos" onClick={() => toggle("short")} active={tab === "sites" && show === "short"} />
      </KpiStrip>

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
                {canReread ? " Al importarlo y volver a esta ventana, se revisa solo." : ""}
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
                          <tr onClick={() => setOpen({ list: sorted, index: sorted.indexOf(item) })} className="h-14 cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2">
                              <p className="text-[13.5px] font-semibold text-slate-900">{item.name}</p>
                              <CodeChip code={siteCode(site)} />
                            </td>
                            <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-700">{formatNumber(site.guides.length)}</td>
                            <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-700">{formatNumber(site.sentProducts)}</td>
                            {site.iciCode ? (
                              <>
                                <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-700">{formatNumber(site.receivedProducts)}</td>
                                <td className="px-3 py-2 text-center"><Count value={site.counts.complete} tone="success" /></td>
                                <td className="px-3 py-2 text-center"><Count value={site.counts.notSent} tone="info" /></td>
                                <td className="px-3 py-2 text-center"><Count value={site.counts.extra} tone="warning" /></td>
                                <td className="px-3 py-2 text-center"><Count value={site.counts.short} tone="danger" /></td>
                                <td className="px-3 py-2 text-center"><Count value={site.counts.notReceived} tone="danger" /></td>
                                <td className="px-3 py-2 text-center">{observedChip(site)}</td>
                              </>
                            ) : (
                              <td colSpan={7} className="px-3 py-2 text-center"><StatusChip tone="warning" label={`Falta importar su ICI de ${monthLabel.toLowerCase()}`} /></td>
                            )}
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
                  const done = observedCount(site, notes);
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
                            <span className="font-mono">{siteCode(site)}</span> · {plural(site.guides.length, "guía", "guías")} · salida {formatNumber(site.sentProducts)}{site.iciCode ? ` · ingreso ${formatNumber(site.receivedProducts)}` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {!site.iciCode ? (
                              <StatusChip tone="warning" label={`Falta importar su ICI de ${monthLabel.toLowerCase()}`} />
                            ) : site.differences === 0 ? (
                              <StatusChip tone="success" label="Todo ingresó" />
                            ) : (
                              <>
                                {site.counts.notSent > 0 && <StatusChip tone="info" label={`${formatNumber(site.counts.notSent)} no salida`} />}
                                {site.counts.extra > 0 && <StatusChip tone="warning" label={`${formatNumber(site.counts.extra)} sobra`} />}
                                {site.counts.short > 0 && <StatusChip tone="danger" label={`${formatNumber(site.counts.short)} falta`} />}
                                {site.counts.notReceived > 0 && <StatusChip tone="danger" label={`${formatNumber(site.counts.notReceived)} no ingresó`} />}
                                <StatusChip tone={done === site.differences ? "success" : "neutral"} label={`${formatNumber(done)} de ${formatNumber(site.differences)} observados`} />
                              </>
                            )}
                          </div>
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
