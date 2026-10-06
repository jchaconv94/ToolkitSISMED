import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Building2, CalendarClock, CheckCircle2, ChevronRight, Download, FileSpreadsheet, Loader2, MoreVertical, RefreshCw, Settings2, Upload, X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { userFullName } from "../services/sessionDisplay";
import { api } from "../services/api";
import { StockStatus } from "../types";
import {
  DME_LEVEL_LABEL, buildItems, essentialRows, groupByIpress, summarize,
  type EstablishmentInfo,
  type AvailabilityItem, type AvailabilityScope, type EstablishmentSummary, type Lot, type TformdetMonthSheet, type MicroredSummary, type ParsedAvailability,
} from "../services/availabilityReport";
import { STATUS_LABEL, monthLabel } from "../services/availabilityExport";
import { exportAvailabilityExcel } from "../services/availabilityExportClient";
import { formatOneDecimal, type DmeLevel } from "../services/stockStatus";
import { availabilityConfigApi, classifyOptionsOf, describeFormula, factoryConfig, summaryOptionsOf, vitalCodeSet, type AvailabilityConfig } from "../services/availabilityConfig";
import { AvailabilityConfigDialog } from "./AvailabilityConfigDialog";
import { formatNumber } from "../services/numberFormat";
import { tformdetFromSheet, type TformdetFileResult } from "../services/tformdetFile";
import {
  EmptyState, KpiCard, KpiStrip, MobileFilterButton, SheetGroupTitle, SheetOption, SortButton, TableSearch, ariaSort, filterInputClass, useTableSort, type Tone,
} from "./ui/kit";
import { TablePagination } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { BottomSheet } from "./ui/BottomSheet";
import { CustomSelect } from "./ui/CustomSelect";
import { useIsDesktop } from "./ui/useIsDesktop";
import { stickyBarClass, useStickyBar } from "./ui/useStickyBar";
import { FloatingTableHead, headAlignClass, tableHeadCellClass, tableHeadTextClass, useFloatingTableHead, type HeadAlign } from "./ui/FloatingTableHead";

/**
 * Disponibilidad de productos por establecimiento (2026-10-06). Se suben el archivo de
 * disponibilidad del SISMED (por farmacia o por IPRESS) y, si se quiere, el TFORMDET; todo se
 * calcula en el navegador con `services/availabilityReport.ts`. La vista principal toma todos
 * los productos; «Medicamentos esenciales» es el indicador DME de la ficha 28.
 */

type Tab = "eess" | "mr" | "meds";
const PAGE_SIZE = 25;

const LEVEL_TONE: Record<DmeLevel, Tone> = { OPTIMO: "success", ALTO: "info", REGULAR: "warning", BAJO: "danger" };
const LEVEL_CHIP: Record<DmeLevel, string> = {
  OPTIMO: "bg-emerald-50 text-emerald-700",
  ALTO: "bg-teal-50 text-teal-700",
  REGULAR: "bg-amber-50 text-amber-700",
  BAJO: "bg-red-50 text-red-700",
};
const LEVEL_BAR: Record<DmeLevel, string> = { OPTIMO: "bg-emerald-500", ALTO: "bg-teal-500", REGULAR: "bg-amber-500", BAJO: "bg-red-500" };
const STATUS_CHIP: Record<StockStatus, string> = {
  [StockStatus.NORMOSTOCK]: "bg-emerald-50 text-emerald-700",
  [StockStatus.SUBSTOCK]: "bg-amber-50 text-amber-700",
  [StockStatus.SOBRESTOCK]: "bg-blue-50 text-blue-700",
  [StockStatus.DESABASTECIDO]: "bg-red-50 text-red-700",
  [StockStatus.SIN_ROTACION]: "bg-slate-100 text-slate-600",
};
const STATUS_ORDER = [StockStatus.DESABASTECIDO, StockStatus.SUBSTOCK, StockStatus.NORMOSTOCK, StockStatus.SOBRESTOCK, StockStatus.SIN_ROTACION];
const LEVELS: DmeLevel[] = ["OPTIMO", "ALTO", "REGULAR", "BAJO"];

const pctText = (pct: number) => `${pct.toFixed(1).replace(".", ",")} %`;
const dateText = (d: Date | null) => (d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "—");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const LevelChip: React.FC<{ level: DmeLevel }> = ({ level }) => (
  <span className={`inline-flex rounded-md px-2 py-0.5 text-[11.5px] font-bold ${LEVEL_CHIP[level]}`}>{DME_LEVEL_LABEL[level]}</span>
);
const StatusPill: React.FC<{ status: StockStatus }> = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>
);
const PctBar: React.FC<{ pct: number; level: DmeLevel }> = ({ pct, level }) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${LEVEL_BAR[level]}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    <span className="w-14 text-right font-mono text-[13px] font-bold text-slate-800">{pctText(pct)}</span>
  </div>
);
const CodeChip: React.FC<{ code: string }> = ({ code }) => (
  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-500">{code}</span>
);

/** Lee la primera hoja de un Excel como filas. */
/** Lectura con SheetJS: respaldo si el lector rápido o el Worker fallan. */
const readSheet = async (file: File): Promise<unknown[][]> => {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { dense: true, cellDates: true, cellNF: false, cellHTML: false, cellText: false, cellStyles: false });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
};

/** Lee la consulta TFORMDET en segundo plano con el lector rápido; si no se puede, con SheetJS. */
const readTformdetFile = async (file: File): Promise<TformdetFileResult> => {
  if (typeof Worker !== "undefined") {
    const buffer = await file.arrayBuffer();
    const reply = await new Promise<{ ok: boolean; retry?: boolean; message?: string; result?: TformdetFileResult }>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("../services/tformdetReader.worker.ts", import.meta.url), { type: "module" });
      } catch {
        resolve({ ok: false, retry: true });
        return;
      }
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
      worker.onerror = () => { resolve({ ok: false, retry: true }); worker.terminate(); };
      worker.postMessage({ buffer, name: file.name }, [buffer]);
    });
    if (reply.ok && reply.result) return reply.result;
    if (!reply.retry) throw new Error(reply.message || "No se pudo leer el archivo.");
  }
  return tformdetFromSheet(await readSheet(file), file.name);
};

/* ---------------------------------------------------------------- Tabla de escritorio */

interface Column<T> {
  key: string;
  label: string;
  align?: HeadAlign;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
}

function DesktopTable<T>({ rows, columns, sortHead, rowKey, resetKey, itemLabel, onRowClick }: {
  rows: T[];
  columns: Column<T>[];
  sortHead: (key: string) => { dir: "asc" | "desc" | null; onSort: () => void } | undefined;
  rowKey: (row: T) => string;
  resetKey: unknown;
  itemLabel: string;
  onRowClick?: (row: T) => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const { tableRef, floating } = useFloatingTableHead([page, rows.length, resetKey]);
  const head = (c: Column<T>) => {
    const s = c.sortable ? sortHead(c.key) : undefined;
    return s ? <SortButton label={c.label} dir={s.dir} onClick={s.onSort} /> : c.label;
  };
  return (
    <>
      <FloatingTableHead state={floating} padding="px-3" cells={columns.map((c, index) => ({ key: c.key, index, content: head(c), align: c.align }))} />
      <div className="scrollbar-x overflow-x-auto">
        <table ref={tableRef} className="w-full min-w-[900px]">
          <thead>
            <tr>
              {columns.map((c) => {
                const s = c.sortable ? sortHead(c.key) : undefined;
                return (
                  <th key={c.key} aria-sort={s ? ariaSort(s.dir) : undefined} className={`${tableHeadCellClass} ${tableHeadTextClass} px-3 py-3 ${headAlignClass(c.align)}`}>{head(c)}</th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((row) => (
              <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`h-14 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 text-[13px] text-slate-700 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} itemLabel={itemLabel} />
    </>
  );
}

/* ---------------------------------------------------------------- Carga de archivos */

const DropZone: React.FC<{
  title: string;
  hint: string;
  optional?: boolean;
  fileName?: string;
  detail?: string;
  onFile: (file: File) => void;
  onClear?: () => void;
  busy?: boolean;
}> = ({ title, hint, optional, fileName, detail, onFile, onClear, busy }) => {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const done = !!fileName;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={`flex flex-col items-center rounded-2xl border-2 border-dashed p-5 text-center transition-colors md:p-6 ${over ? "border-teal-400 bg-teal-50/60" : done ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-white"}`}
    >
      <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <span className={`mb-3 grid h-12 w-12 place-items-center rounded-2xl ${done ? "bg-emerald-100 text-emerald-700" : "bg-teal-50 text-teal-700"}`}>
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : done ? <CheckCircle2 className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
      </span>
      <p className="text-[14.5px] font-bold text-slate-900">
        {title}{optional && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">Opcional</span>}
      </p>
      <p className="mt-1 max-w-xs text-[12.5px] text-slate-500">{hint}</p>
      {done ? (
        <div className="mt-3 flex max-w-full items-center gap-1.5 rounded-lg bg-white py-1 pl-3 pr-1 text-[12.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <FileSpreadsheet className="h-4 w-4 shrink-0" /><span className="truncate">{fileName}</span>
          {detail && <span className="shrink-0 text-slate-500">· {detail}</span>}
          {onClear && (
            <button type="button" onClick={onClear} aria-label="Quitar archivo" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="mt-4 h-10 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-50">
          Elegir archivo
        </button>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- Módulo */

export const AvailabilityModule: React.FC = () => {
  const { can, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isDesktop = useIsDesktop();

  const [dispFile, setDispFile] = useState<{ name: string; data: ParsedAvailability } | null>(null);
  const [lotsFile, setLotsFile] = useState<{ name: string; data: Map<string, Lot[]> } | null>(null);
  /** Registros del TFORMDET del mes de corte, tal como vienen: van en una hoja del Excel. */
  const [tformdetSheet, setTformdetSheet] = useState<TformdetMonthSheet | null>(null);
  const [reading, setReading] = useState<"disp" | "lots" | null>(null);
  const [calculated, setCalculated] = useState(false);
  const [registry, setRegistry] = useState<Map<string, EstablishmentInfo>>(new Map());
  /** De dónde salió el archivo principal y si trae la clasificación de productos. */
  const [source, setSource] = useState<{ kind: "disponibilidad" | "tformdet"; classified: boolean; skipped: string[] } | null>(null);

  const [scope, setScope] = useState<AvailabilityScope>("all");
  const [tab, setTab] = useState<Tab>("eess");
  const [search, setSearch] = useState("");
  const [microred, setMicrored] = useState("ALL");
  const [level, setLevel] = useState<DmeLevel | null>(null);
  const [establishment, setEstablishment] = useState("ALL");
  const [status, setStatus] = useState<StockStatus | "ALL">("ALL");
  const [riskOnly, setRiskOnly] = useState(false);
  const [byPharmacy, setByPharmacy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [config, setConfig] = useState<AvailabilityConfig>(() => factoryConfig());
  const [configOpen, setConfigOpen] = useState(false);
  const sticky = useStickyBar<HTMLDivElement>();

  useEffect(() => {
    availabilityConfigApi.load().then(setConfig);
  }, []);

  useEffect(() => {
    // Nombre, microred y red (UNGET) de cada IPRESS, del registro de Establecimientos: el archivo
    // por farmacia no trae el nombre del hospital y el TFORMDET no trae microred ni red.
    Promise.all([api.getFacilities(), api.getMicroredes().catch(() => []), api.getUngets().catch(() => [])])
      .then(([facilities, microredes, ungets]) => {
        const mr = new Map(microredes.map((m) => [m.id, m]));
        const ug = new Map(ungets.map((u) => [u.id, u.name]));
        setRegistry(new Map(facilities.map((f) => {
          const m = f.microredId ? mr.get(f.microredId) : undefined;
          const unget = f.ungetId || m?.ungetId;
          return [String(f.code).trim(), { name: f.name, microred: m?.name || "", red: (unget && ug.get(unget)) || "", category: f.category || "" }];
        })));
      })
      .catch(() => undefined);
  }, []);

  const handleDispFile = async (file: File) => {
    setReading("disp");
    try {
      // Solo la consulta TFORMDET del Toolkit (uno o varios meses): trae consumo, stock y lotes.
      const { data, last } = await readTformdetFile(file);
      setDispFile({ name: file.name, data });
      setLotsFile({ name: file.name, data: data.lots });
      setTformdetSheet(last);
      setSource({ kind: "tformdet", classified: data.hasClassification, skipped: data.skippedCodes });
      if (!data.hasClassification) setScope("all");
      setCalculated(false);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo leer el archivo.");
    } finally {
      setReading(null);
    }
  };

  // Filas por IPRESS (las farmacias sumadas): no dependen de la fórmula.
  const baseRows = useMemo(() => {
    if (!dispFile || !calculated) return null;
    // El TFORMDET no trae microred ni red: salen del registro de Establecimientos.
    const rows = dispFile.data.rows.map((r) => {
      if (r.microred && r.red) return r;
      const info = registry.get(r.ipressCode);
      return info ? { ...r, microred: r.microred || info.microred || "", red: r.red || info.red || "", category: r.category || info.category || "" } : r;
    });
    return {
      ipress: groupByIpress(rows, (code) => registry.get(code)?.name),
      pharmacy: dispFile.data.hasPharmacies ? rows : null,
    };
  }, [dispFile, calculated, registry]);

  // Todos los productos y, del mismo cálculo, la DME con los códigos fusionados.
  const vitalCodes = useMemo(() => vitalCodeSet(config.vitals), [config.vitals]);
  const computed = useMemo(() => {
    if (!baseRows) return null;
    const lots = lotsFile?.data;
    const opts = classifyOptionsOf(config.formula);
    const groups = config.fused.groups;
    const today = new Date();
    return {
      all: buildItems(baseRows.ipress, lots, today, opts),
      essential: buildItems(essentialRows(baseRows.ipress, groups), lots, today, opts),
      pharmacyAll: baseRows.pharmacy ? buildItems(baseRows.pharmacy, lots, today, opts) : null,
      pharmacyEssential: baseRows.pharmacy ? buildItems(essentialRows(baseRows.pharmacy, groups), lots, today, opts) : null,
    };
  }, [baseRows, lotsFile, config.formula, config.fused]);

  const ipressItems = useMemo<AvailabilityItem[]>(() => (computed ? (scope === "all" ? computed.all : computed.essential) : []), [computed, scope]);
  const pharmacyItems = computed ? (scope === "all" ? computed.pharmacyAll : computed.pharmacyEssential) : null;
  const report = useMemo(() => summarize(ipressItems, summaryOptionsOf(config.formula, scope, vitalCodes)), [ipressItems, config.formula, scope, vitalCodes]);

  const months = dispFile?.data.months ?? [];
  const cut = months[months.length - 1];
  const reds = useMemo(() => [...new Set(ipressItems.map((i) => i.red).filter(Boolean))], [ipressItems]);
  const title = reds.length === 1 ? `UNGET ${reds[0]}` : "Todas las redes";
  const levelCounts = useMemo(() => {
    const c: Record<DmeLevel, number> = { OPTIMO: 0, ALTO: 0, REGULAR: 0, BAJO: 0 };
    report.establishments.forEach((e) => c[e.level]++);
    return c;
  }, [report]);
  const microredOptions = useMemo(() => [...new Set(report.establishments.map((e) => e.microred))].sort((a, b) => a.localeCompare(b, "es")), [report]);

  // Filas de cada pestaña
  const q = norm(search.trim());
  const eessRows = useMemo(() => report.establishments.filter((e) =>
    (microred === "ALL" || e.microred === microred) && (!level || e.level === level) && (!q || norm(`${e.code} ${e.name}`).includes(q))), [report, microred, level, q]);
  const mrRows = useMemo(() => report.microredes.filter((m) => (!level || m.level === level) && (!q || norm(m.microred).includes(q))), [report, level, q]);
  const medSource = byPharmacy && pharmacyItems ? pharmacyItems : report.items;
  const medRows = useMemo(() => medSource.filter((i) =>
    (microred === "ALL" || i.microred === microred) &&
    (establishment === "ALL" || i.code === establishment || i.ipressCode === establishment) &&
    (status === "ALL" || i.status === status) &&
    (!riskOnly || i.expiryRisk) &&
    (!q || norm(`${i.medCode} ${i.description}`).includes(q))), [medSource, microred, establishment, status, riskOnly, q]);

  const eessSort = useTableSort(eessRows, {
    microred: (r) => r.microred, name: (r) => r.name, desabastecido: (r) => r.desabastecido, substock: (r) => r.substock, normostock: (r) => r.normostock,
    sobrestock: (r) => r.sobrestock, sinRotacion: (r) => r.sinRotacion, total: (r) => r.total, pct: (r) => r.pct,
  }, { firstDir: { pct: "desc", desabastecido: "desc" } });
  const mrSort = useTableSort(mrRows, {
    microred: (r) => r.microred, establishments: (r) => r.establishments, desabastecido: (r) => r.counts.desabastecido, total: (r) => r.counts.total, pct: (r) => r.pct,
  }, { firstDir: { pct: "desc" } });
  const medSort = useTableSort(medRows, {
    name: (r) => r.name, medCode: (r) => r.medCode, description: (r) => r.description, stock: (r) => r.stock, cpa: (r) => r.cpa,
    months: (r) => (Number.isFinite(r.months) ? r.months : Number.MAX_SAFE_INTEGER), status: (r) => STATUS_ORDER.indexOf(r.status),
    expiry: (r) => r.nearestExpiry?.getTime() ?? null, lots: (r) => r.lots.length,
  }, { firstDir: { stock: "desc", months: "desc" } });

  const activeRows = tab === "eess" ? eessSort.sorted : tab === "mr" ? mrSort.sorted : medSort.sorted;
  const mobile = useIncrementalCount(activeRows.length, `${tab}|${scope}|${search}|${microred}|${level}|${establishment}|${status}|${riskOnly}|${byPharmacy}`);
  const filtersActive = microred !== "ALL" || !!level || (tab === "meds" && (establishment !== "ALL" || status !== "ALL" || riskOnly));

  const resetFilters = () => { setMicrored("ALL"); setLevel(null); setEstablishment("ALL"); setStatus("ALL"); setRiskOnly(false); };
  const openEstablishment = (code: string) => { resetFilters(); setSearch(""); setEstablishment(code); setTab("meds"); };

  /** Profesión de quien genera el reporte, para la portada del Excel. */
  const professionOf = async (): Promise<string | undefined> => {
    const p = user?.personnelData;
    if (!p) return undefined;
    if (p.professionData?.name) return p.professionData.name;
    if (!p.professionId) return undefined;
    const list = await api.getProfessions().catch(() => []);
    return list.find((x) => x.id === p.professionId)?.name;
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    const notice = toast.loading("Generando el Excel…");
    try {
      // El porcentaje del otro alcance va como referencia en el resumen.
      const otherScope: AvailabilityScope = scope === "all" ? "essential" : "all";
      const otherItems = computed && (otherScope === "all" || source?.classified !== false) ? (otherScope === "all" ? computed.all : computed.essential) : null;
      const otherScopePct = otherItems && otherItems.length ? summarize(otherItems, summaryOptionsOf(config.formula, otherScope, vitalCodes)).pct : null;
      await exportAvailabilityExcel({
        report, otherScopePct, pharmacyItems, months, scope, title,
        formulaText: describeFormula(config.formula, scope),
        levels: config.formula.levels,
        fusedVersion: config.fused.version,
        source: `${dispFile?.name || ""} (${source?.kind === "tformdet" ? "TFORMDET" : "archivo de disponibilidad"})`,
        preparedBy: user ? userFullName(user) : undefined,
        preparedByRole: await professionOf(),
        tformdet: tformdetSheet,
      });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar el Excel.");
    } finally {
      toast.dismiss(notice);
      setExporting(false);
    }
  };

  /* ------------------------------------------------------------ Pantalla de carga */
  if (!calculated) {
    const d = dispFile?.data;
    const ipressCount = d ? new Set(d.rows.map((r) => r.ipressCode)).size : 0;
    const pharmacyCount = d ? new Set(d.rows.map((r) => r.code)).size : 0;
    return (
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-2 md:px-0 md:pb-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-[18px] font-black text-slate-900">Calcular la disponibilidad</h2>
            {isAdmin && (
              <button type="button" onClick={() => setConfigOpen(true)} className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-50">
                <Settings2 className="h-4 w-4" />Configuración
              </button>
            )}
          </div>
          <p className="mt-1 text-[13px] text-slate-500">Suba la consulta TFORMDET del Toolkit. Se calcula por producto, establecimiento, microred y UNGET; los medicamentos esenciales salen del mismo cálculo.</p>
          <div className="mt-5">
            <DropZone
              title="Consulta TFORMDET"
              hint="Descárguela del Toolkit de escritorio con los meses que quiera: se calcula con todos. Los lotes y vencimientos salen del último mes."
              fileName={dispFile?.name}
              detail={d ? `${formatNumber(d.rows.length)} filas` : undefined}
              onFile={handleDispFile}
              onClear={() => { setDispFile(null); setCalculated(false); setLotsFile(null); setTformdetSheet(null); setSource(null); }}
              busy={reading === "disp"}
            />
          </div>
          {reading === "disp" && (
            <p className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-teal-600" />Leyendo el archivo… un TFORMDET de 12 meses puede tardar medio minuto.</p>
          )}
          {source?.kind === "tformdet" && !source.classified && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Este TFORMDET no trae la clasificación de los productos (MEDTIP, MEDPET, MEDEST): se calcula la disponibilidad de todos los productos, pero no la de medicamentos esenciales. Descárguelo con el <b>Toolkit 2.2.5</b> o posterior.</span>
            </div>
          )}
          {d && cut && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-600">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
              <span>
                Mes de corte: <b className="text-slate-900">{monthLabel(cut)}</b> · consumo de {monthLabel(months[0])} a {monthLabel(cut)} ·{" "}
                {months.length} {months.length === 1 ? "mes" : "meses"} · {d.hasPharmacies ? `${pharmacyCount} farmacias en ${ipressCount} establecimientos` : `${ipressCount} establecimientos`}
                {source?.skipped.length ? ` · sin contar ${source.skipped.join(", ")} (no son establecimientos)` : ""}
              </span>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <button type="button" disabled={!dispFile || !!reading} onClick={() => { resetFilters(); setSearch(""); setTab("eess"); setCalculated(true); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto">
              <Activity className="h-4 w-4" />Calcular disponibilidad
            </button>
          </div>
        </div>
        <AvailabilityConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} config={config} onSaved={setConfig} previewRows={null} />
      </div>
    );
  }

  /* ------------------------------------------------------------ Resultados */
  const lv = config.formula.levels;
  const tabs: Array<{ id: Tab; label: string; short: string }> = [
    { id: "eess", label: "Establecimientos", short: "Establec." },
    { id: "mr", label: "Microredes", short: "Microredes" },
    { id: "meds", label: "Productos", short: "Productos" },
  ];
  const scopeSwitch = (
    <div className="flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Productos evaluados">
      {([["all", "Todos los productos", "Todos"], ["essential", "Medicamentos esenciales", "Esenciales (DME)"]] as const).map(([id, label, short]) => (
        <button key={id} type="button" role="tab" aria-selected={scope === id} disabled={id === "essential" && source?.classified === false} title={id === "essential" && source?.classified === false ? "El TFORMDET no trae la clasificación de productos (Toolkit 2.2.5)" : undefined} onClick={() => setScope(id)} className={`disabled:cursor-not-allowed disabled:opacity-40 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-bold transition-colors md:flex-none md:px-4 ${scope === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          <span className="md:hidden">{short}</span><span className="hidden md:inline">{label}</span>
        </button>
      ))}
    </div>
  );
  const tabSwitch = (
    <div className="flex shrink-0 rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => { setTab(t.id); if (t.id !== "meds") setEstablishment("ALL"); }} className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-bold transition-colors md:flex-none md:px-4 ${tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          <span className="md:hidden">{t.short}</span><span className="hidden md:inline">{t.label}</span>
        </button>
      ))}
    </div>
  );
  const establishmentOptions = [{ value: "ALL", label: "Todos los establecimientos" }, ...report.establishments.map((e) => ({ value: e.code, label: `${e.code} · ${e.name}` }))];

  const eessColumns: Column<EstablishmentSummary>[] = [
    { key: "microred", label: "Microred", sortable: true, render: (r) => <span className="text-[12.5px] text-slate-500">{r.microred}</span> },
    { key: "name", label: "Establecimiento", sortable: true, render: (r) => <span className="flex items-center gap-2"><CodeChip code={r.code} /><span className="font-semibold text-slate-900">{r.name}</span></span> },
    { key: "desabastecido", label: "Desab.", align: "right", sortable: true, render: (r) => <span className="font-mono text-red-600">{r.desabastecido}</span> },
    { key: "substock", label: "Sub", align: "right", sortable: true, render: (r) => <span className="font-mono">{r.substock}</span> },
    { key: "normostock", label: "Normo", align: "right", sortable: true, render: (r) => <span className="font-mono">{r.normostock}</span> },
    { key: "sobrestock", label: "Sobre", align: "right", sortable: true, render: (r) => <span className="font-mono">{r.sobrestock}</span> },
    { key: "sinRotacion", label: "Sin rot.", align: "right", sortable: true, render: (r) => <span className="font-mono">{r.sinRotacion}</span> },
    { key: "total", label: "Total", align: "right", sortable: true, render: (r) => <span className="font-mono font-bold text-slate-800">{r.total}</span> },
    { key: "pct", label: "Disponibilidad", sortable: true, render: (r) => <PctBar pct={r.pct} level={r.level} /> },
    { key: "level", label: "Nivel", render: (r) => <LevelChip level={r.level} /> },
  ];
  const mrColumns: Column<MicroredSummary>[] = [
    { key: "microred", label: "Microred", sortable: true, render: (r) => <span className="font-semibold text-slate-900">{r.microred}</span> },
    { key: "establishments", label: "Establec.", align: "right", sortable: true, render: (r) => <span className="font-mono">{r.establishments}</span> },
    { key: "desabastecido", label: "Desab.", align: "right", sortable: true, render: (r) => <span className="font-mono text-red-600">{r.counts.desabastecido}</span> },
    { key: "sub", label: "Sub", align: "right", render: (r) => <span className="font-mono">{r.counts.substock}</span> },
    { key: "normo", label: "Normo", align: "right", render: (r) => <span className="font-mono">{r.counts.normostock}</span> },
    { key: "sobre", label: "Sobre", align: "right", render: (r) => <span className="font-mono">{r.counts.sobrestock}</span> },
    { key: "sinrot", label: "Sin rot.", align: "right", render: (r) => <span className="font-mono">{r.counts.sinRotacion}</span> },
    { key: "total", label: "Total", align: "right", sortable: true, render: (r) => <span className="font-mono font-bold text-slate-800">{r.counts.total}</span> },
    { key: "pct", label: "Disponibilidad", sortable: true, render: (r) => <PctBar pct={r.pct} level={r.level} /> },
    { key: "level", label: "Nivel", render: (r) => <LevelChip level={r.level} /> },
  ];
  const medColumns: Column<AvailabilityItem>[] = [
    ...(establishment === "ALL" || byPharmacy ? [{ key: "name", label: byPharmacy ? "Farmacia" : "Establecimiento", sortable: true, render: (r: AvailabilityItem) => <span className="block max-w-[200px] truncate text-[12.5px] text-slate-500" title={r.name}>{r.name}</span> }] : []),
    { key: "medCode", label: "Código", sortable: true, render: (r) => <CodeChip code={r.medCode} /> },
    { key: "description", label: "Producto", sortable: true, render: (r) => <span><span className="font-semibold text-slate-900">{r.description}</span>{(r.fusedFrom?.length ?? 0) > 1 && <span className="ml-2 whitespace-nowrap rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-bold text-teal-700" title={`Suma de los códigos ${r.fusedFrom!.join(", ")}`}>{r.fusedFrom!.length} códigos fusionados</span>}</span> },
    { key: "stock", label: "Stock", align: "right", sortable: true, render: (r) => <span className="font-mono">{formatNumber(r.stock)}</span> },
    { key: "cpa", label: "CPA", align: "right", sortable: true, render: (r) => <span className="font-mono">{formatOneDecimal(r.cpa).replace(".", ",")}</span> },
    { key: "months", label: "Meses", align: "right", sortable: true, render: (r) => <span className="font-mono font-bold text-slate-800">{formatOneDecimal(r.months).replace(".", ",")}</span> },
    { key: "status", label: "Situación", sortable: true, render: (r) => <StatusPill status={r.status} /> },
    ...(lotsFile ? [
      { key: "expiry", label: "Vence primero", sortable: true, render: (r: AvailabilityItem) => <span className="whitespace-nowrap text-slate-600">{dateText(r.nearestExpiry)}</span> },
      { key: "lots", label: "Lotes", align: "right" as const, sortable: true, render: (r: AvailabilityItem) => <span className="font-mono" title={r.lots.map((l) => `${l.lot} · ${dateText(l.expiry)} · ${l.balance}`).join("\n")}>{r.lots.length}</span> },
      { key: "risk", label: "", render: (r: AvailabilityItem) => r.expiryRisk ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-50 px-2 py-0.5 text-[11.5px] font-bold text-red-700" title={`Vence en ${r.monthsToExpiry} meses y alcanza para ${formatOneDecimal(r.months)}`}><AlertTriangle className="h-3 w-3" />Vence antes de usarse</span> : null },
    ] : []),
  ];

  const filterSheet = (
    <BottomSheet open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
      {tab !== "mr" && (
        <>
          <SheetGroupTitle first>Microred</SheetGroupTitle>
          <SheetOption active={microred === "ALL"} label="Todas" onClick={() => setMicrored("ALL")} />
          {microredOptions.map((m) => <SheetOption key={m} active={microred === m} label={m} onClick={() => setMicrored(m)} />)}
        </>
      )}
      {tab !== "meds" && (
        <>
          <SheetGroupTitle first={tab === "mr"}>Nivel</SheetGroupTitle>
          <SheetOption active={!level} label="Todos" onClick={() => setLevel(null)} />
          {LEVELS.map((l) => <SheetOption key={l} active={level === l} label={DME_LEVEL_LABEL[l]} count={tab === "eess" ? levelCounts[l] : undefined} onClick={() => setLevel(l)} />)}
        </>
      )}
      {tab === "meds" && (
        <>
          <SheetGroupTitle>Situación</SheetGroupTitle>
          <SheetOption active={status === "ALL"} label="Todas" onClick={() => setStatus("ALL")} />
          {STATUS_ORDER.map((s) => <SheetOption key={s} active={status === s} label={STATUS_LABEL[s]} onClick={() => setStatus(s)} />)}
          {lotsFile && (
            <>
              <SheetGroupTitle>Vencimiento</SheetGroupTitle>
              <SheetOption active={!riskOnly} label="Todos" onClick={() => setRiskOnly(false)} />
              <SheetOption active={riskOnly} label="Solo los que vencen antes de usarse" onClick={() => setRiskOnly(true)} />
            </>
          )}
        </>
      )}
      {filtersActive && (
        <button type="button" onClick={resetFilters} className="mt-4 h-11 w-full rounded-xl border border-slate-200 text-sm font-bold text-slate-700">Quitar filtros</button>
      )}
    </BottomSheet>
  );

  const actionsSheet = (
    <BottomSheet open={actionsOpen} title="Acciones" onClose={() => setActionsOpen(false)}>
      {can("AVAILABILITY", "export") && (
        <button type="button" onClick={() => { setActionsOpen(false); handleExport(); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 active:bg-slate-100">
          <Download className="h-5 w-5" />Exportar Excel
        </button>
      )}
      <button type="button" onClick={() => { setActionsOpen(false); setCalculated(false); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 active:bg-slate-100">
        <RefreshCw className="h-5 w-5" />Otros archivos
      </button>
      {isAdmin && (
        <button type="button" onClick={() => { setActionsOpen(false); setConfigOpen(true); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 active:bg-slate-100">
          <Settings2 className="h-5 w-5" />Configuración
        </button>
      )}
      {pharmacyItems && tab === "meds" && (
        <button type="button" onClick={() => { setActionsOpen(false); setByPharmacy(!byPharmacy); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 active:bg-slate-100">
          <Building2 className="h-5 w-5" />{byPharmacy ? "Ver por establecimiento" : "Ver por farmacia"}
        </button>
      )}
    </BottomSheet>
  );

  const mobileCards = (
    <div className="space-y-2.5 p-3 md:hidden">
      {tab === "eess" && (eessSort.sorted.slice(0, mobile.count)).map((e) => (
        <button key={e.code} type="button" onClick={() => openEstablishment(e.code)} className="block w-full rounded-2xl border border-slate-200 bg-white p-3.5 text-left">
          <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-900">{e.name}</p><LevelChip level={e.level} /><ChevronRight className="h-4 w-4 text-slate-300" /></div>
          <p className="text-[12px] text-slate-500">{e.code} · {e.microred}</p>
          <div className="mt-2"><PctBar pct={e.pct} level={e.level} /></div>
          <p className="mt-1.5 text-[11.5px] text-slate-500"><b className="text-red-600">{e.desabastecido}</b> desab. · {e.substock} sub · {e.normostock} normo · {e.sobrestock} sobre · {e.sinRotacion} sin rot.</p>
        </button>
      ))}
      {tab === "mr" && mrSort.sorted.slice(0, mobile.count).map((m) => (
        <button key={m.microred} type="button" onClick={() => { resetFilters(); setMicrored(m.microred); setTab("eess"); }} className="block w-full rounded-2xl border border-slate-200 bg-white p-3.5 text-left">
          <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-900">{m.microred}</p><LevelChip level={m.level} /><ChevronRight className="h-4 w-4 text-slate-300" /></div>
          <p className="text-[12px] text-slate-500">{m.establishments} establecimientos · {m.counts.total} ítems</p>
          <div className="mt-2"><PctBar pct={m.pct} level={m.level} /></div>
        </button>
      ))}
      {tab === "meds" && medSort.sorted.slice(0, mobile.count).map((i) => (
        <div key={`${i.code}|${i.medCode}`} className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-start gap-2"><CodeChip code={i.medCode} /><p className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-slate-900">{i.description}</p></div>
          {(i.fusedFrom?.length ?? 0) > 1 && <p className="mt-1 text-[11.5px] font-semibold text-teal-700">Fusiona {i.fusedFrom!.join(", ")}</p>}
          {(establishment === "ALL" || byPharmacy) && <p className="mt-1 truncate text-[12px] text-slate-500">{i.name}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-slate-600">
            <StatusPill status={i.status} />
            <span>Stock <b className="font-mono text-slate-800">{formatNumber(i.stock)}</b></span>
            <span>CPA <b className="font-mono text-slate-800">{formatOneDecimal(i.cpa).replace(".", ",")}</b></span>
            <span>Meses <b className="font-mono text-slate-800">{formatOneDecimal(i.months).replace(".", ",")}</b></span>
          </div>
          {lotsFile && i.lots.length > 0 && (
            <p className="mt-1.5 text-[12px] text-slate-500">Vence primero {dateText(i.nearestExpiry)} · {i.lots.length} lote{i.lots.length === 1 ? "" : "s"}
              {i.expiryRisk && <span className="ml-1.5 font-bold text-red-700">· vence antes de usarse</span>}
            </p>
          )}
        </div>
      ))}
      {activeRows.length === 0 && <EmptyState title="Sin resultados" description="Ningún registro coincide con la búsqueda o los filtros." />}
      <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={activeRows.length} itemLabel="registros" />
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px] px-0 pb-24 pt-2 md:px-0 md:pb-8">
      {/* Cabecera */}
      <div className="mb-4 flex flex-col gap-3 px-4 md:flex-row md:items-center md:px-0">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-black text-slate-900">{title}{cut ? ` · ${monthLabel(cut)}` : ""}</h2>
          <p className="text-[12.5px] text-slate-500">
            {scope === "essential" ? `Medicamentos esenciales (sin estrategias) con códigos fusionados de DIGEMID ${config.fused.version}` : "Todos los productos"} · meses {config.formula.truncate ? "cortados a un decimal" : "sin cortar"}
            {source?.kind === "tformdet" ? ` · desde el TFORMDET (${months.length} ${months.length === 1 ? "mes" : "meses"})` : lotsFile ? " · con lotes del TFORMDET" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 [&>div:first-child]:flex-1 md:[&>div:first-child]:flex-none">
          {scopeSwitch}
          {isAdmin && (
            <button type="button" onClick={() => setConfigOpen(true)} title="Configuración" aria-label="Configuración" className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 md:grid">
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => setCalculated(false)} className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 md:flex">
            <RefreshCw className="h-4 w-4" />Otros archivos
          </button>
          {can("AVAILABILITY", "export") && (
            <button type="button" onClick={handleExport} disabled={exporting} className="hidden h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-60 md:flex">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{exporting ? "Generando…" : "Exportar Excel"}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 md:px-0">
        <KpiStrip cols="md:grid-cols-3 xl:grid-cols-5">
          <KpiCard watermark tone={LEVEL_TONE[report.level]} icon={<Activity />} label={scope === "essential" ? "DME de la UNGET" : "Disponibilidad"} value={pctText(report.pct)} hint={`${DME_LEVEL_LABEL[report.level]} · promedio de ${report.establishments.length} establecimientos`} progress={report.pct} />
          {LEVELS.map((l) => (
            <KpiCard
              key={l}
              watermark
              tone={LEVEL_TONE[l]}
              icon={<Building2 />}
              label={DME_LEVEL_LABEL[l]}
              value={String(levelCounts[l])}
              hint={l === "OPTIMO" ? `establecimientos ≥ ${lv.optimo} %` : l === "ALTO" ? `establecimientos ${lv.alto} – ${lv.optimo} %` : l === "REGULAR" ? `establecimientos ${lv.regular} – ${lv.alto} %` : `establecimientos < ${lv.regular} %`}
              onClick={() => { setLevel(level === l ? null : l); setTab("eess"); }}
              active={level === l}
            />
          ))}
        </KpiStrip>
      </div>

      <div className="mt-4 border-y border-slate-200 bg-white md:mt-5 md:overflow-hidden md:rounded-2xl md:border md:shadow-sm">
        <div ref={sticky.ref} style={sticky.style} className={`${stickyBarClass} md:static flex flex-col gap-2 border-b border-slate-100 bg-white p-3 md:flex-row md:flex-wrap md:items-center`}>
          {tabSwitch}
          <div className="flex min-w-0 flex-1 items-center gap-2 md:min-w-[320px]">
            <TableSearch value={search} onChange={setSearch} placeholder={tab === "meds" ? "Buscar producto o código…" : tab === "mr" ? "Buscar microred…" : "Buscar establecimiento…"} />
            <MobileFilterButton onClick={() => setFiltersOpen(true)} active={filtersActive} />
            <button type="button" onClick={() => setActionsOpen(true)} aria-label="Acciones" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 md:hidden"><MoreVertical className="h-4 w-4" /></button>
          </div>
          {/* Filtros a la vista en escritorio */}
          <div className="hidden flex-wrap items-center gap-2 md:flex md:w-full">
            {tab !== "mr" && (
              <div className="w-44 shrink-0"><CustomSelect value={microred} onChange={setMicrored} ariaLabel="Microred" className="h-10 text-[13px]" options={[{ value: "ALL", label: "Todas las microredes" }, ...microredOptions.map((m) => ({ value: m, label: m }))]} /></div>
            )}
            {tab === "meds" ? (
              <>
                <div className="w-56 shrink-0"><CustomSelect value={establishment} onChange={setEstablishment} ariaLabel="Establecimiento" className="h-10 text-[13px]" options={establishmentOptions} /></div>
                <div className="w-48 shrink-0"><CustomSelect value={status} onChange={(v) => setStatus(v as StockStatus | "ALL")} ariaLabel="Situación" className="h-10 text-[13px]" options={[{ value: "ALL", label: "Todas las situaciones" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} /></div>
                {lotsFile && (
                  <button type="button" onClick={() => setRiskOnly(!riskOnly)} className={`${filterInputClass} !w-auto shrink-0 px-4 text-[13px] whitespace-nowrap font-semibold ${riskOnly ? "border-red-300 bg-red-50 text-red-700" : "text-slate-600"}`}>Vencen antes de usarse</button>
                )}
                {pharmacyItems && (
                  <button type="button" onClick={() => setByPharmacy(!byPharmacy)} className={`${filterInputClass} !w-auto shrink-0 px-4 text-[13px] whitespace-nowrap font-semibold ${byPharmacy ? "border-teal-300 bg-teal-50 text-teal-700" : "text-slate-600"}`}>Por farmacia</button>
                )}
              </>
            ) : (
              <div className="w-44 shrink-0"><CustomSelect value={level ?? "ALL"} onChange={(v) => setLevel(v === "ALL" ? null : (v as DmeLevel))} ariaLabel="Nivel" className="h-10 text-[13px]" options={[{ value: "ALL", label: "Todos los niveles" }, ...LEVELS.map((l) => ({ value: l, label: DME_LEVEL_LABEL[l] }))]} /></div>
            )}
          </div>
        </div>
        {tab === "meds" && establishment !== "ALL" && (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-teal-50/50 px-4 py-2 text-[12.5px] text-teal-800">
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{establishmentOptions.find((o) => o.value === establishment)?.label}</span>
            <button type="button" onClick={() => setEstablishment("ALL")} className="shrink-0 font-bold hover:underline">Ver todos</button>
          </div>
        )}

        {isDesktop ? (
          activeRows.length === 0 ? (
            <div className="p-6"><EmptyState title="Sin resultados" description="Ningún registro coincide con la búsqueda o los filtros." /></div>
          ) : tab === "eess" ? (
            <DesktopTable rows={eessSort.sorted} columns={eessColumns} sortHead={(k) => eessSort.headSort(k as any)} rowKey={(r) => r.code} resetKey={`${scope}|${search}|${microred}|${level}`} itemLabel="establecimientos" onRowClick={(r) => openEstablishment(r.code)} />
          ) : tab === "mr" ? (
            <DesktopTable rows={mrSort.sorted} columns={mrColumns} sortHead={(k) => mrSort.headSort(k as any)} rowKey={(r) => r.microred} resetKey={`${scope}|${search}|${level}`} itemLabel="microredes" onRowClick={(r) => { resetFilters(); setMicrored(r.microred); setTab("eess"); }} />
          ) : (
            <DesktopTable rows={medSort.sorted} columns={medColumns} sortHead={(k) => medSort.headSort(k as any)} rowKey={(r) => `${r.code}|${r.medCode}`} resetKey={`${scope}|${search}|${microred}|${establishment}|${status}|${riskOnly}|${byPharmacy}`} itemLabel="productos" />
          )
        ) : mobileCards}

        <p className="border-t border-slate-100 px-4 py-2.5 text-[11.5px] text-slate-500">
          {describeFormula(config.formula, scope)}{!config.fromServer && " Configuración de fábrica."}
        </p>
      </div>

      {filterSheet}
      <AvailabilityConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSaved={setConfig}
        previewRows={baseRows?.ipress ?? null}
        lots={lotsFile?.data}
      />
      {actionsSheet}
    </div>
  );
};

export default AvailabilityModule;

