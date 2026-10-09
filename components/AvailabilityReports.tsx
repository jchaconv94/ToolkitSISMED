import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowRight, ChevronDown, Boxes, Building2, CalendarClock, ChevronRight, PackageX, Download, RotateCcw, Repeat2, Store, TrendingUp, Warehouse, X } from "lucide-react";
import { StockStatus } from "../types";
import type { DmeLevel } from "../services/stockStatus";
import { formatOneDecimal } from "../services/stockStatus";
import { formatNumber } from "../services/numberFormat";
import { STATUS_LABEL, buildTableWorkbook, monthLabel, type TableSheet } from "../services/availabilityExport";
import { saveAs } from "file-saver";
import {
  TFORMDET_OUTFLOWS,
  DME_LEVEL_LABEL, averageConsumption, type AvailabilityItem, type AvailabilityRow, type ClassifyOptions, type SummaryOptions, dmeLevelOf, type AvailabilityReport, type StatusCounts, type EstablishmentSummary, type LevelThresholds, type MicroredSummary, type WarehouseItem,
} from "../services/availabilityReport";
import {
  isStill,
  EXPIRY_BUCKETS, EXPIRY_BUCKET_LABEL, isSeparateSite, pharmacyKind, XYZ_LABEL, abcXyzReport, consumptionReport, lotRiskOf, lotRiskReport, overstockAtRisk, overstockReport, planUsage, productGapReport, redistributionPlan, siteGapReport, warehouseReport,
  type AbcProduct, type ClassifiedItem, type LotRiskRow, type OverstockRow, type PeakRow, type PlanRow, type PlanSource, type ProductGap, type SiteGapRow, type WarehouseRow,
} from "../services/availabilityInsights";
import { EmptyState, KpiCard, KpiStrip, SortButton, TableSearch, ariaSort, filterInputClass, useTableSort, type Tone } from "./ui/kit";
import { TablePagination } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { useIsDesktop } from "./ui/useIsDesktop";
import { BottomSheet } from "./ui/BottomSheet";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import { FloatingTableHead, headAlignClass, tableHeadCellClass, tableHeadTextClass, useFloatingTableHead, type HeadAlign } from "./ui/FloatingTableHead";
import {
  ChartCard, Donut, EvolutionChart, Gauge, HBars, InfoTip, LEVEL_COLOR, LEVEL_SOFT, LevelColumns, MonthlyBars, RankingChart, STATUS_COLOR, Sparkline, StackBar, TipBox, useChartTip,
} from "./AvailabilityCharts";
import { availabilityEvolution, type EvolutionEntity } from "../services/availabilityEvolution";

/**
 * Pantallas de reporte del módulo Disponibilidad (2026-10-07). Cada pestaña recibe el mismo
 * contexto (`ReportContext`) y calcula lo suyo con `services/availabilityInsights.ts`.
 * Las explicaciones van detrás de un ícono «i» (pedido del usuario), sin dirigirse a nadie.
 */

export interface ReportContext {
  report: AvailabilityReport;
  /** Disponibilidad por farmacia y puesto comunal (F01, F02…), si el archivo los trae. */
  pharmacy: AvailabilityReport | null;
  /** Tipo del registro de Establecimientos (PUESTO_COMUNAL, FARMACIA…). */
  facilityType: (code: string) => string | undefined;
  months: string[];
  levels: LevelThresholds;
  subMax: number;
  sobreMin: number;
  /** Fecha del stock: cierre del mes de corte. Los meses al vencimiento se cuentan desde aquí (punto E). */
  asOf: Date;
  /** ¿El TFORMDET cargado trae las salidas que no son consumo? (los guardados antes del punto F, no). */
  hasOutflows: boolean;
  /** Para la evolución mes a mes: filas por IPRESS de la vista y la fórmula. `null` si el TFORMDET guardado no trae el stock de cada mes. */
  evolution: { rows: AvailabilityRow[]; classify: ClassifyOptions; summary: SummaryOptions } | null;
  warehouse: WarehouseItem[];
  /** Porcentaje del otro alcance (todos ↔ esenciales), si se pudo calcular. */
  otherPct: number | null;
  scopeLabel: string;
  otherLabel: string;
  openEstablishment: (code: string) => void;
  /** Abre el panel de un producto; `list` es la lista en que está, para pasar al anterior o al siguiente. */
  openProduct: (item: AvailabilityItem, list?: AvailabilityItem[]) => void;
  /**
   * Cambia cada ítem de un establecimiento con farmacias por los de sus farmacias (F01, F02…):
   * los lotes son de cada farmacia y se consumen al ritmo de cada una, así que el riesgo de
   * vencimiento se calcula por farmacia, no sumado.
   */
  byPharmacy: (items: AvailabilityItem[]) => AvailabilityItem[];
  goTab: (tab: ReportTab) => void;
  /** Cambios del usuario al plan de redistribución; viven en el módulo para no perderse al cambiar de pestaña. */
  planEdits: PlanEdits;
  setPlanEdits: React.Dispatch<React.SetStateAction<PlanEdits>>;
  /** Para el título de los Excel: «UNGET Bellavista · set 2026». */
  reportTitle: string;
}

/** Lo que el usuario cambió en una fila del plan: no distribuirla o la cantidad de cada fuente. */
export interface PlanEdit {
  excluded?: boolean;
  qty?: Record<string, number>;
}
export type PlanEdits = Record<string, PlanEdit>;

export type ReportTab = "summary" | "evolution" | "establishments" | "gaps" | "expiry" | "consumption" | "abc" | "overstock" | "redistribution" | "warehouse";

const PAGE_SIZE = 25;
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
export const monthShort = (key: string) => `${MONTH_SHORT[Number(key.slice(4, 6)) - 1] ?? key.slice(4, 6)}${key.slice(2, 4)}`;

export const LEVEL_TONE: Record<DmeLevel, Tone> = { OPTIMO: "success", ALTO: "info", REGULAR: "warning", BAJO: "danger" };
const LEVELS: DmeLevel[] = ["OPTIMO", "ALTO", "REGULAR", "BAJO"];
const STATUS_ORDER = [StockStatus.DESABASTECIDO, StockStatus.SUBSTOCK, StockStatus.NORMOSTOCK, StockStatus.SOBRESTOCK, StockStatus.SIN_ROTACION];
const STATUS_CHIP: Record<StockStatus, string> = {
  [StockStatus.NORMOSTOCK]: "bg-emerald-50 text-emerald-700",
  [StockStatus.SUBSTOCK]: "bg-amber-50 text-amber-700",
  [StockStatus.SOBRESTOCK]: "bg-blue-50 text-blue-700",
  [StockStatus.DESABASTECIDO]: "bg-red-50 text-red-700",
  [StockStatus.SIN_ROTACION]: "bg-slate-100 text-slate-600",
};
const LEVEL_CHIP: Record<DmeLevel, string> = {
  OPTIMO: "bg-emerald-50 text-emerald-700",
  ALTO: "bg-teal-50 text-teal-700",
  REGULAR: "bg-amber-50 text-amber-700",
  BAJO: "bg-red-50 text-red-700",
};

export const pctText = (pct: number) => `${pct.toFixed(1).replace(".", ",")} %`;
export const money = (v: number) => `S/ ${formatNumber(Math.round(v))}`;
/** Soles en corto para etiquetas de gráficos: S/ 398 mil, S/ 1,2 M. */
export const moneyShort = (v: number) => (Math.abs(v) >= 1e6 ? `S/ ${formatNumber(v / 1e6, 1)} M` : Math.abs(v) >= 1e5 ? `S/ ${formatNumber(v / 1e3)} mil` : `S/ ${formatNumber(Math.round(v))}`);
const dec = (v: number) => (Number.isFinite(v) ? formatOneDecimal(v).replace(".", ",") : "—");
export const dateText = (d: Date | null) => (d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "—");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const LevelChip: React.FC<{ level: DmeLevel }> = ({ level }) => (
  <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${LEVEL_CHIP[level]}`}>{DME_LEVEL_LABEL[level]}</span>
);
export const StatusPill: React.FC<{ status: StockStatus }> = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>
);
export const CodeChip: React.FC<{ code: string }> = ({ code }) => (
  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-500">{code}</span>
);
const PctBar: React.FC<{ pct: number; color: string; text?: string; width?: string }> = ({ pct, color, text, width = "w-20" }) => (
  <div className="inline-flex items-center gap-2 align-middle">
    <div className={`h-1.5 ${width} overflow-hidden rounded-full bg-slate-100`}><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} /></div>
    <span className="w-14 text-right font-mono text-[13px] font-bold text-slate-800">{text ?? pctText(pct)}</span>
  </div>
);
/** «Establecimiento › F02 Puesto» para una farmacia o puesto comunal; el nombre, para el establecimiento. */
const siteLabel = (ctx: ReportContext, it: AvailabilityItem) => {
  if (it.code === it.ipressCode) return it.name;
  const parent = ctx.report.establishments.find((x) => x.code === it.ipressCode)?.name;
  return `${parent ?? it.ipressCode} › ${it.code.slice(5)} ${it.name}`;
};

/** ¿Es un puesto comunal (o una F02+ sin tipo)? Se evalúa aparte de la F01. */
const separateOf = (ctx: ReportContext) => (code: string) => isSeparateSite(code, ctx.facilityType(code));

const ProductCell: React.FC<{ code: string; description: string; sub?: string }> = ({ code, description, sub }) => (
  <span className="flex min-w-0 items-start gap-2">
    <CodeChip code={code} />
    <span className="min-w-0">
      <span className="block text-[13px] font-semibold leading-snug text-slate-900">{description}</span>
      {sub && <span className="block truncate text-[11.5px] text-slate-500">{sub}</span>}
    </span>
  </span>
);
const statusParts = (c: { desabastecido: number; substock: number; normostock: number; sobrestock: number; sinRotacion: number }) => [
  { label: "Desabastecido", value: c.desabastecido, color: STATUS_COLOR[StockStatus.DESABASTECIDO] },
  { label: "Substock", value: c.substock, color: STATUS_COLOR[StockStatus.SUBSTOCK] },
  { label: "Normostock", value: c.normostock, color: STATUS_COLOR[StockStatus.NORMOSTOCK] },
  { label: "Sobrestock", value: c.sobrestock, color: STATUS_COLOR[StockStatus.SOBRESTOCK] },
  { label: "Sin rotación", value: c.sinRotacion, color: STATUS_COLOR[StockStatus.SIN_ROTACION] },
];

const KIND_CHIP: Record<string, string> = {
  Principal: "bg-teal-50 text-teal-700",
  "Puesto comunal": "bg-cyan-50 text-cyan-700",
  "Farmacia del hospital": "bg-slate-100 text-slate-600",
  "Sin tipo": "bg-amber-50 text-amber-700",
};
const KindChip: React.FC<{ kind: string | null }> = ({ kind }) =>
  kind ? <span title={kind === "Sin tipo" ? "No tiene tipo en el registro de Establecimientos: se evalúa como puesto comunal" : undefined} className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${KIND_CHIP[kind] ?? "bg-cyan-50 text-cyan-700"}`}>{kind}</span> : null;

/** Farmacias y puestos comunales de cada establecimiento, solo donde hay más de una (F01, F02…). */
export const pharmacyGroups = (pharmacy: AvailabilityReport | null): Map<string, EstablishmentSummary[]> => {
  const map = new Map<string, EstablishmentSummary[]>();
  if (!pharmacy) return map;
  for (const p of pharmacy.establishments) {
    const ipress = p.code.slice(0, 5);
    if (p.code === ipress) continue;
    map.set(ipress, [...(map.get(ipress) || []), p]);
  }
  for (const [k, list] of map) {
    if (list.length < 2) map.delete(k);
    else list.sort((a, b) => a.code.localeCompare(b.code));
  }
  return map;
};

/** Las cinco situaciones como columnas (con su color) y el total de ítems: iguales en establecimientos y microredes. */
function situationColumns<T>(countsOf: (row: T) => StatusCounts): Column<T>[] {
  const col = (key: keyof StatusCounts, label: string, cls: string): Column<T> => ({
    key, label, align: "right", firstDir: "desc", sort: (r) => countsOf(r)[key],
    render: (r) => <span className={`font-mono ${cls}`}>{formatNumber(countsOf(r)[key])}</span>,
  });
  return [
    col("desabastecido", "Desab.", "font-bold text-red-600"),
    col("substock", "Sub", "text-amber-600"),
    col("normostock", "Normo", "text-emerald-700"),
    col("sobrestock", "Sobre", "text-blue-600"),
    col("sinRotacion", "Sin rot.", "text-slate-500"),
    col("total", "Ítems", "font-bold text-slate-800"),
  ];
}

/**
 * Al tocar un indicador o un gráfico que filtra la tabla, la pantalla baja hasta la tabla para
 * que se vea lo filtrado (pedido del usuario: «presiono y no pasa nada»).
 */
export const useTableAnchor = () => {
  const anchor = React.useRef<HTMLElement>(null);
  const toTable = () => requestAnimationFrame(() => anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  return { anchor, toTable };
};

/* ---------------------------------------------------------------- Tabla de reporte */

export interface Column<T> {
  key: string;
  label: string;
  align?: HeadAlign;
  sort?: (row: T) => string | number | null;
  firstDir?: "asc" | "desc";
  render: (row: T) => React.ReactNode;
}

/* ---------------------------------------------------------------- Excel de una tabla */

/** Columna del Excel de una tabla: un dato por celda (código y nombre por separado). */
export interface ExcelColumn<T> {
  header: string;
  width?: number;
  /** "int", "dec1", "pct", "money", "date" o un formato de Excel. */
  fmt?: string;
  align?: "left" | "center" | "right";
  value: (row: T) => unknown;
}
export interface ExcelSpec<T> {
  /** Nombre de la hoja y del archivo. */
  name: string;
  title: string;
  subtitle?: string;
  columns: ExcelColumn<T>[];
}

/** Infinito (sin consumo) va vacío en el Excel. */
const xNum = (v: number) => (Number.isFinite(v) ? v : "");
const xProduct = <T,>(get: (r: T) => { medCode: string; description: string }): ExcelColumn<T>[] => [
  { header: "Código SISMED", width: 13, value: (r) => get(r).medCode },
  { header: "Producto", width: 50, align: "left", value: (r) => get(r).description },
];
const xSite = <T,>(ctx: ReportContext, get: (r: T) => AvailabilityItem): ExcelColumn<T>[] => [
  { header: "Cód. establecimiento", width: 14, value: (r) => get(r).code },
  { header: "Establecimiento", width: 40, align: "left", value: (r) => siteLabel(ctx, get(r)) },
  { header: "Microred", width: 22, align: "left", value: (r) => get(r).microred },
];
const xMonths = <T,>(ctx: ReportContext, get: (r: T) => number[]): ExcelColumn<T>[] =>
  ctx.months.map((m, i) => ({ header: monthLabel(m), width: 10, fmt: "int", value: (r: T) => get(r)[i] ?? 0 }));
const xCounts = <T,>(get: (r: T) => Pick<StatusCounts, "desabastecido" | "substock" | "normostock" | "sobrestock" | "sinRotacion" | "total">): ExcelColumn<T>[] => [
  { header: "Desabastecido", width: 13, fmt: "int", value: (r) => get(r).desabastecido },
  { header: "Substock", width: 10, fmt: "int", value: (r) => get(r).substock },
  { header: "Normostock", width: 11, fmt: "int", value: (r) => get(r).normostock },
  { header: "Sobrestock", width: 11, fmt: "int", value: (r) => get(r).sobrestock },
  { header: "Sin rotación", width: 11, fmt: "int", value: (r) => get(r).sinRotacion },
  { header: "Ítems", width: 9, fmt: "int", value: (r) => get(r).total },
];

/** Descarga lo que muestra la tabla (con su búsqueda, filtro y orden) en un Excel de una hoja. */
const downloadTableExcel = async <T,>(spec: ExcelSpec<T>, rows: T[]) => {
  const wb = buildTableWorkbook([{
    name: spec.name,
    title: spec.title,
    subtitle: [spec.subtitle, `${formatNumber(rows.length)} registros`, `descargado el ${new Date().toLocaleDateString("es-PE")}`].filter(Boolean).join(" · "),
    columns: spec.columns.map((c) => ({ header: c.header, width: c.width ?? 12, fmt: c.fmt, align: c.align })),
    rows: rows.map((r) => spec.columns.map((c) => c.value(r))),
  }]);
  const buffer = await wb.xlsx.writeBuffer();
  const file = [spec.name, spec.subtitle].filter(Boolean).join("_").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_");
  saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${file}.xlsx`);
};

/**
 * Tabla de un reporte: buscador y filtros arriba; en escritorio, encabezado fijo, orden por
 * columnas y paginación; en el celular, tarjetas que cargan al bajar.
 */
/**
 * Alineación de todas las tablas de reportes (pedido del usuario, 2026-10-07): los nombres
 * (producto, establecimiento, microred, quién entrega/recibe) a la izquierda; todo lo demás
 * —números, códigos, fechas, estados, barras— centrado en su columna.
 */
const TEXT_COLUMNS = new Set(["description", "name", "microred", "from", "to", "site"]);
const alignOf = (key: string): HeadAlign => (TEXT_COLUMNS.has(key) ? "left" : "center");

export function ReportTable<T>({ title, info, rows, columns, rowKey, card, onRowClick, itemLabel, searchOf, placeholder, toolbar, minWidth = 900, subRows, subLabel = "subregistros", anchorRef, excel }: {
  title?: string;
  info?: React.ReactNode;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  card: (row: T) => React.ReactNode;
  /** Recibe también todas las filas filtradas y ordenadas, para recorrerlas desde el detalle. */
  onRowClick?: (row: T, rows: T[]) => void;
  itemLabel: string;
  searchOf?: (row: T) => string;
  placeholder?: string;
  toolbar?: React.ReactNode;
  minWidth?: number;
  /** Filas hijas que se despliegan bajo una fila (las farmacias de un establecimiento). */
  subRows?: (row: T) => T[] | undefined;
  /** Cómo se llaman las filas hijas en el celular («farmacias»). */
  subLabel?: string;
  /** Para bajar hasta la tabla cuando un indicador la filtra (`useTableAnchor`). */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Botón «Excel»: descarga lo que muestra la tabla (pedido del usuario: un Excel por pestaña). */
  excel?: ExcelSpec<T>;
}) {
  const isDesktop = useIsDesktop();
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const toggleRow = (key: string) => setOpenRows((cur) => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [search, setSearch] = useState("");
  const q = norm(search.trim());
  const filtered = useMemo(() => (q && searchOf ? rows.filter((r) => norm(searchOf(r)).includes(q)) : rows), [rows, q, searchOf]);
  const getters = useMemo(() => Object.fromEntries(columns.filter((c) => c.sort).map((c) => [c.key, c.sort!])) as Record<string, (r: T) => string | number | null>, [columns]);
  const firstDir = useMemo(() => Object.fromEntries(columns.filter((c) => c.firstDir).map((c) => [c.key, c.firstDir!])), [columns]);
  const { sorted, headSort } = useTableSort(filtered, getters, { firstDir });
  const [page, setPage] = useState(1);
  // La página vuelve a 1 solo si cambian de verdad las filas (búsqueda, filtro u orden), no
  // cuando la pantalla se vuelve a dibujar al abrir un detalle.
  const signature = `${q}|${sorted.length}|${sorted.length ? rowKey(sorted[0]) : ""}|${sorted.length ? rowKey(sorted[sorted.length - 1]) : ""}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature);
  const { tableRef, floating } = useFloatingTableHead([page, sorted.length, isDesktop]);
  // La tabla sigue al panel que se abrió desde ella (punto G): ver `drawerFollower`.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const rowEls = React.useRef(new Map<string, HTMLElement>());
  const live = React.useRef({ sorted, rowKey, showAtLeast: mobile.showAtLeast });
  live.current = { sorted, rowKey, showAtLeast: mobile.showAtLeast };
  const ownFollower = React.useRef<DrawerFollower | null>(null);
  useEffect(() => () => { if (drawerFollower === ownFollower.current) drawerFollower = null; }, []);
  const refRow = (key: string) => (el: HTMLElement | null) => { if (el) rowEls.current.set(key, el); else rowEls.current.delete(key); };
  const openRow = (row: T, list: T[]) => {
    if (!onRowClick) return;
    let lastKey = rowKey(row);
    const follower: DrawerFollower = {
      length: list.length,
      list: null,
      index: (i) => {
        const target = list[i];
        if (target === undefined) return;
        const { sorted: rows, rowKey: keyOf, showAtLeast } = live.current;
        lastKey = keyOf(target);
        const pos = rows.findIndex((r) => keyOf(r) === lastKey);
        if (pos >= 0) { setPage(Math.floor(pos / PAGE_SIZE) + 1); showAtLeast(pos + 1); }
      },
      close: () => {
        const key = lastKey;
        setFlashKey(key);
        // Si el registro no está a la vista, se lleva al centro (y no queda pegado a la barra del celular).
        window.setTimeout(() => {
          const el = rowEls.current.get(key);
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.top < 120 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 50);
        window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 2200);
      },
    };
    drawerFollower = ownFollower.current = follower;
    onRowClick(row, list);
  };
  // El resaltado pinta las celdas (no la fila), así no choca con el fondo de la fila desplegada.
  const flash = (key: string) => `[&>td]:transition-colors [&>td]:duration-700 ${flashKey === key ? "[&>td]:bg-teal-100" : ""}`;
  const head = (c: Column<T>) => {
    if (!c.sort) return c.label;
    const s = headSort(c.key);
    return <SortButton label={c.label} dir={s.dir} onClick={s.onSort} />;
  };
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <section ref={anchorRef} className="scroll-mt-14 border-y border-slate-200 bg-white md:overflow-hidden md:rounded-2xl md:border md:shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 p-3 md:flex-row md:flex-wrap md:items-center">
        {title && (
          <div className="flex items-center gap-1.5 md:mr-2">
            <h3 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">{title}</h3>
            {info && <InfoTip title={title}>{info}</InfoTip>}
          </div>
        )}
        {searchOf && <TableSearch value={search} onChange={setSearch} placeholder={placeholder || "Buscar…"} className="md:min-w-[280px]" />}
        {toolbar}
        {excel && (
          <button type="button" onClick={() => downloadTableExcel(excel, sorted)} disabled={!sorted.length} title="Descargar en Excel lo que muestra la tabla" className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-4 w-4 text-teal-700" />Excel
          </button>
        )}
        <span className="text-[12px] font-semibold text-slate-400 md:ml-auto">{formatNumber(sorted.length)} {itemLabel}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="p-6"><EmptyState title="Sin resultados" description="Ningún registro coincide con la búsqueda o los filtros." /></div>
      ) : isDesktop ? (
        <>
          <FloatingTableHead state={floating} padding="px-3" cells={[...(subRows ? [{ key: "__expand", index: 0, content: "" }] : []), ...columns.map((c, index) => ({ key: c.key, index: index + (subRows ? 1 : 0), content: head(c), align: alignOf(c.key) }))]} />
          <div className="scrollbar-x overflow-x-auto">
            <table ref={tableRef} className="w-full" style={{ minWidth }}>
              <thead>
                <tr>
                  {subRows && <th className={`${tableHeadCellClass} w-10 px-2 py-3`} aria-label="Desplegar" />}
                  {columns.map((c) => (
                    <th key={c.key} aria-sort={c.sort ? ariaSort(headSort(c.key).dir) : undefined} className={`${tableHeadCellClass} ${tableHeadTextClass} px-3 py-3 ${headAlignClass(alignOf(c.key))}`}>{head(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((row) => {
                  const key = rowKey(row);
                  const kids = subRows?.(row);
                  const open = !!kids?.length && openRows.has(key);
                  const cells = (r: T, child: boolean) => columns.map((c, ci) => (
                    <td key={c.key} className={`px-3 py-2 text-[13px] text-slate-700 ${alignOf(c.key) === "center" ? "whitespace-nowrap text-center" : ""} ${child && ci === 0 ? "pl-8" : ""}`}>{c.render(r)}</td>
                  ));
                  return (
                    <React.Fragment key={key}>
                      <tr ref={refRow(key)} onClick={onRowClick ? () => openRow(row, sorted) : undefined} className={`h-14 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""} ${open ? "bg-teal-50/40" : ""} ${flash(key)}`}>
                        {subRows && (
                          <td className="w-10 px-2 py-2">
                            {kids?.length ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleRow(key); }}
                                aria-expanded={open}
                                aria-label={open ? "Ocultar farmacias" : "Ver farmacias"}
                                title={open ? "Ocultar" : `Ver sus ${kids.length} ${subLabel}`}
                                className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${open ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-teal-50 hover:text-teal-700"}`}
                              >
                                <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
                              </button>
                            ) : null}
                          </td>
                        )}
                        {cells(row, false)}
                      </tr>
                      {open && kids!.map((kid) => (
                        <tr key={rowKey(kid)} ref={refRow(rowKey(kid))} onClick={onRowClick ? () => openRow(kid, kids!) : undefined} className={`h-12 bg-slate-50/70 ${onRowClick ? "cursor-pointer hover:bg-teal-50/60" : ""} ${flash(rowKey(kid))}`}>
                          <td className="relative w-10 px-2"><span className="absolute inset-y-0 left-1/2 w-px bg-teal-200" /></td>
                          {cells(kid, true)}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={sorted.length} onPageChange={setPage} itemLabel={itemLabel} />
        </>
      ) : (
        <div className="space-y-2.5 p-3">
          {sorted.slice(0, mobile.count).map((row) => {
            const key = rowKey(row);
            const kids = subRows?.(row);
            const open = !!kids?.length && openRows.has(key);
            return (
              <div key={key} ref={refRow(key)} className={`rounded-2xl border transition-colors duration-700 ${flashKey === key ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white"}`}>
                <div onClick={onRowClick ? () => openRow(row, sorted) : undefined} className={`p-3.5 ${onRowClick ? "cursor-pointer active:bg-slate-50" : ""}`}>
                  {card(row)}
                </div>
                {!!kids?.length && (
                  <>
                    <button type="button" onClick={() => toggleRow(key)} aria-expanded={open} className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-[12.5px] font-bold text-teal-700">
                      {open ? "Ocultar" : `Ver sus ${kids.length} ${subLabel}`}<ChevronRight className={`h-4 w-4 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
                    </button>
                    {open && (
                      <div className="space-y-2 border-t border-slate-100 bg-slate-50 p-2.5">
                        {kids.map((kid) => (
                          <div key={rowKey(kid)} ref={refRow(rowKey(kid))} onClick={onRowClick ? () => openRow(kid, kids!) : undefined} className={`rounded-xl border p-3 transition-colors duration-700 active:bg-slate-50 ${flashKey === rowKey(kid) ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white"}`}>{card(kid)}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel={itemLabel} />
        </div>
      )}
    </section>
  );
}

/** Opciones en pastillas para filtrar una tabla. */
/**
 * Filtro de una tabla. En escritorio es un combo, para que buscador, filtro y botones queden en
 * una sola línea (pedido del usuario del 2026-10-08: «no bajes a la segunda fila»); en el
 * celular, pastillas que se deslizan.
 */
export function Pills<V extends string>({ value, options, onChange }: { value: V; options: Array<{ value: V; label: string; count?: number }>; onChange: (v: V) => void }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value as V)} aria-label="Filtrar" className={`${filterInputClass} !w-auto min-w-[150px] shrink-0 cursor-pointer`}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.count !== undefined ? ` (${formatNumber(o.count)})` : ""}</option>)}
      </select>
    );
  }
  return (
    <div className="hide-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-bold transition-colors ${value === o.value ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
        >
          {o.label}{o.count !== undefined && <span className={`ml-1.5 ${value === o.value ? "text-teal-100" : "text-slate-400"}`}>{formatNumber(o.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Explicaciones */

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="mt-1.5 block first:mt-0">{children}</span>;
const Ex: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="mt-2 block rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">{children}</span>;

const INFO = {
  availability: (lv: LevelThresholds) => (
    <>
      <P>Porcentaje de productos con stock suficiente: los que están en normostock o sobrestock, sobre el total de productos evaluados.</P>
      <P>La de la UNGET es el promedio de sus establecimientos. Niveles: Óptimo desde {lv.optimo} %, Alto desde {lv.alto} %, Regular desde {lv.regular} % y Bajo por debajo.</P>
    </>
  ),
  situations: (subMax: number, sobreMin: number) => (
    <>
      <P><b>Meses de provisión</b> = stock ÷ CPA (consumo promedio de los meses con consumo).</P>
      <P><b>Desabastecido:</b> stock 0. <b>Substock:</b> menos de {subMax} meses. <b>Normostock:</b> de {subMax} a {sobreMin} meses. <b>Sobrestock:</b> más de {sobreMin} meses. <b>Sin rotación:</b> tiene stock pero no se consumió en el periodo.</P>
    </>
  ),
  ranking: <P>Cada barra es un establecimiento, de mayor a menor disponibilidad. El color de fondo marca el nivel. Al tocar una barra se abre el establecimiento.</P>,
  expiry: (
    <>
      <P>Cada lote se revisa por separado. Los lotes se usan del que vence primero al último, al ritmo del consumo promedio mensual (CPA). Los puestos comunales se evalúan cada uno con sus propios lotes y su propio CPA; las farmacias del hospital (F01 y las de tipo farmacia) se suman, porque el stock se mueve entre ellas dentro del mismo local.</P>
      <P>Una F01 que abastece a sus puestos comunales entrega parte de su stock como <b>otras salidas</b>, que no son consumo. Para el vencimiento, su CPA suma lo que dispensa y lo que entrega a sus puestos, porque ese stock también sale de ella.</P>
      <P>Lo que no alcanza a usarse antes de su fecha de vencimiento queda en riesgo, y se valoriza a su precio.</P>
      <P>En la tabla de lotes, <b>Por consumir</b> son las unidades del lote que alcanzan a usarse a ese ritmo antes de su fecha de vencimiento, y <b>En riesgo</b>, las que vencerían sin usarse.</P>
      <P>Los meses que faltan para vencer se cuentan desde el <b>cierre del mes de corte</b>, que es la fecha del stock del TFORMDET, y no desde hoy.</P>
      <Ex>CPA 10 al mes. Lote A: 40 unidades, vence en 2 meses → se usan 20, quedan <b>20 en riesgo</b>. Lote B: 30 unidades, vence en 12 meses → se usan las 30 (alcanza el tiempo).</Ex>
    </>
  ),
  peaks: (
    <>
      <P>Un <b>pico</b> es un mes cuyo consumo es 3 veces o más el promedio de los <b>otros meses con consumo</b> (con 20 unidades o más y al menos 3 meses con consumo). Los meses en cero no cuentan, y si el consumo más alto se repite en varios meses no es un pico: es lo habitual.</P>
      <P>Puede ser un brote, una campaña, una salida grande o un error de registro. Un pico sube el CPA y puede hacer pedir de más.</P>
    </>
  ),
  xyz: (
    <>
      <P>Mide qué tan parejo es el consumo mes a mes (coeficiente de variación: desviación ÷ promedio), contando desde el primer mes con consumo: un producto que se empezó a usar hace poco no es irregular por los meses en que aún no se usaba.</P>
      <P><b>X, estable:</b> menos de 0,5. <b>Y, variable:</b> de 0,5 a 1. <b>Z, irregular:</b> más de 1. En los Z el CPA predice mal lo que se va a usar.</P>
    </>
  ),
  abc: (
    <>
      <P>Ordena los productos por el valor consumido en el periodo (unidades × precio), sumando todos los establecimientos.</P>
      <P><b>A:</b> los que juntan el 80 % del valor. <b>B:</b> el 15 % siguiente. <b>C:</b> el 5 % restante.</P>
      <P>Cruzado con la variabilidad (X, Y, Z): los <b>A-X</b> se programan con precisión; los <b>A-Z</b> son caros e impredecibles y conviene vigilarlos de cerca.</P>
    </>
  ),
  overstock: (sobreMin: number) => (
    <>
      <P>Un producto está en sobrestock cuando tiene stock para más de {sobreMin} meses.</P>
      <P>Lo que pasa de {sobreMin} meses de consumo es <b>excedente</b>: unidades compradas que no se van a usar pronto. Su valor (excedente × precio) es <b>dinero inmovilizado</b>, que además corre el riesgo de vencerse.</P>
      <Ex>CPA 10 al mes y stock 100. Para {sobreMin} meses bastan {10 * sobreMin}. Excedente: {100 - 10 * sobreMin} unidades. A S/ 2 cada una: <b>S/ {2 * (100 - 10 * sobreMin)} inmovilizados</b>. Ese excedente puede redistribuirse a donde falta.</Ex>
    </>
  ),
  redistribution: (subMax: number, sobreMin: number) => (
    <>
      <P>Es un plan: no mueve nada hasta que se registre en el SISMED. Cada fila es un establecimiento (o puesto comunal) desabastecido o en substock, con consumo, y lo que <b>necesita</b> para llegar a {subMax} meses de consumo.</P>
      <P>La sugerencia inicial cubre esa necesidad en este orden: un puesto comunal, de su F01 (que se queda con {subMax} meses de lo que dispensa); un establecimiento, primero del <b>excedente de otros</b> (lo que pasa de {sobreMin} meses, primero de la misma microred) y lo que falte, <b>del almacén</b>.</P>
      <P>Las cantidades se pueden cambiar y una fila se puede quitar del plan. Cada fuente tiene un saldo («le quedan»): si se asigna más de lo que tiene, se marca en rojo. Nada se cuenta dos veces.</P>
    </>
  ),

  gaps: (subMax: number) => (
    <>
      <P>Por cada producto: en cuántos establecimientos está desabastecido o con menos de {subMax} meses de stock.</P>
      <P><b>Les sobra:</b> cuántos establecimientos tienen ese producto en sobrestock (más de lo que usan en 6 meses) y podrían pasar una parte a donde falta.</P>
      <P><b>Almacén:</b> el stock del almacén al cierre del mes.</P>
      <P><b>Se pueden cubrir:</b> productos desabastecidos que tienen de dónde sacarse: algún establecimiento al que le sobra o stock en el almacén.</P>
      <P><b>Faltan en un puesto:</b> puestos comunales desabastecidos de un producto que su establecimiento, sumando todas sus farmacias, no tiene como faltante. No bajan la disponibilidad del establecimiento, pero el puesto no lo tiene.</P>
    </>
  ),
  warehouse: (subMax: number) => (
    <>
      <P>Stock del almacén al cierre del mes de corte. El almacén no cuenta en la disponibilidad.</P>
      <P><b>Lo necesitan:</b> establecimientos desabastecidos o en substock de ese producto. <b>Cobertura:</b> qué parte de lo que les falta para llegar a {subMax} meses cubre el almacén. <b>Meses para la red:</b> cuánto duraría el stock del almacén con el consumo de todos los establecimientos.</P>
    </>
  ),
};

/* ---------------------------------------------------------------- Resumen */

export const SummaryReport: React.FC<{ ctx: ReportContext; levelCounts: Record<DmeLevel, number>; onLevel: (l: DmeLevel) => void; onMicrored: (m: string) => void }> = ({ ctx, levelCounts, onLevel, onMicrored }) => {
  const { report, levels: lv } = ctx;
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(report.items), ctx.asOf), [ctx.byPharmacy, report.items, ctx.asOf]);
  const over = useMemo(() => overstockReport(report.items, ctx.sobreMin), [report.items, ctx.sobreMin]);
  // Punto D: el dinero del sobrestock que además vence en 12 meses ya está en la otra tarjeta.
  const overlap = useMemo(() => overstockAtRisk(over.rows, risk.rows), [over, risk]);
  const redis = useMemo(() => {
    const plan = redistributionPlan({ items: report.items, pharmacyItems: ctx.pharmacy?.items ?? [], warehouse: ctx.warehouse, subMax: ctx.subMax, sobreMin: ctx.sobreMin, isSeparate: separateOf(ctx) });
    return { needs: plan.rows.length, covered: plan.rows.filter((r) => r.sources.reduce((a, x) => a + x.qty, 0) >= r.need).length };
  }, [report.items, ctx]);
  const wh = useMemo(() => warehouseReport(ctx.warehouse, report.items, ctx.subMax), [ctx.warehouse, report.items, ctx.subMax]);
  const c = report.counts;
  const ranges: Record<DmeLevel, string> = { OPTIMO: `≥ ${lv.optimo} %`, ALTO: `${lv.alto} – ${lv.optimo} %`, REGULAR: `${lv.regular} – ${lv.alto} %`, BAJO: `< ${lv.regular} %` };
  const mrRows = [...report.microredes].sort((a, b) => b.pct - a.pct);
  const alerts: Array<{ tab: ReportTab; icon: React.ReactNode; tone: string; label: string; value: string; hint: string }> = [
    { tab: "expiry", icon: <CalendarClock className="h-5 w-5" />, tone: "bg-red-50 text-red-600", label: "Vence sin usarse en 12 meses", value: money(risk.urgentValue), hint: `${formatNumber(risk.urgentLots)} lotes · al ${dateText(ctx.asOf)}` },
    { tab: "overstock", icon: <PackageX className="h-5 w-5" />, tone: "bg-blue-50 text-blue-600", label: "Sobrestock inmovilizado", value: money(over.value - overlap.value), hint: overlap.value > 0 ? `sin ${money(overlap.value)} que ya vencen` : `${formatNumber(over.rows.length)} productos` },
    { tab: "redistribution", icon: <Repeat2 className="h-5 w-5" />, tone: "bg-teal-50 text-teal-700", label: "Plan de redistribución", value: formatNumber(redis.needs), hint: `necesidades · ${formatNumber(redis.covered)} se cubren por completo` },
    { tab: "warehouse", icon: <Warehouse className="h-5 w-5" />, tone: "bg-amber-50 text-amber-700", label: "Almacén puede cubrir", value: formatNumber(wh.canCover), hint: `productos · ${money(wh.value)} en almacén` },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone={LEVEL_TONE[report.level]} icon={<TrendingUp />} label={`Disponibilidad · ${ctx.scopeLabel}`} value={pctText(report.pct)} hint={`Nivel ${DME_LEVEL_LABEL[report.level]} · ${report.establishments.length} establecimientos`} progress={report.pct / 100} />
        {ctx.otherPct !== null ? (
          <KpiCard watermark tone="info" icon={<TrendingUp />} label={ctx.otherLabel} value={pctText(ctx.otherPct)} hint="del mismo archivo y corte" progress={ctx.otherPct / 100} />
        ) : (
          <KpiCard watermark tone="neutral" icon={<TrendingUp />} label={ctx.otherLabel} value="—" hint="el archivo no trae la clasificación" />
        )}
        <KpiCard watermark tone="danger" icon={<Building2 />} label="Establecimientos en nivel bajo" value={`${levelCounts.BAJO} de ${report.establishments.length}`} hint={`${levelCounts.REGULAR} regular · ${levelCounts.ALTO} alto · ${levelCounts.OPTIMO} óptimo`} onClick={() => onLevel("BAJO")} />
        <KpiCard watermark tone="danger" icon={<AlertTriangle />} label="Ítems desabastecidos" value={formatNumber(c.desabastecido)} hint={`${pctText(c.total ? (c.desabastecido / c.total) * 100 : 0)} de ${formatNumber(c.total)} ítems`} onClick={() => ctx.goTab("gaps")} />
      </KpiStrip>

      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Disponibilidad de la UNGET" info={INFO.availability(lv)} className="lg:col-span-5">
          <Gauge pct={report.pct} level={report.level} levels={lv} caption={`Nivel ${DME_LEVEL_LABEL[report.level]} · ${report.establishments.length} establecimientos`} />
        </ChartCard>
        <ChartCard title="Situación de los ítems" info={INFO.situations(ctx.subMax, ctx.sobreMin)} className="lg:col-span-7">
          <Donut
            centerValue={formatNumber(c.total)}
            centerLabel="ítems"
            segments={[
              { key: "n", label: "Normostock", value: c.normostock, color: STATUS_COLOR[StockStatus.NORMOSTOCK] },
              { key: "o", label: "Sobrestock", value: c.sobrestock, color: STATUS_COLOR[StockStatus.SOBRESTOCK] },
              { key: "s", label: "Substock", value: c.substock, color: STATUS_COLOR[StockStatus.SUBSTOCK] },
              { key: "r", label: "Sin rotación", value: c.sinRotacion, color: STATUS_COLOR[StockStatus.SIN_ROTACION] },
              { key: "d", label: "Desabastecido", value: c.desabastecido, color: STATUS_COLOR[StockStatus.DESABASTECIDO] },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {alerts.map((a) => (
          <button key={a.tab} type="button" onClick={() => ctx.goTab(a.tab)} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md md:p-4">
            <span className={`hidden h-11 w-11 shrink-0 place-items-center rounded-xl sm:grid ${a.tone}`}>{a.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10.5px] font-black uppercase leading-tight tracking-wider text-slate-500 md:truncate md:text-[11px]">{a.label}</span>
              <span className="block truncate text-[17px] font-black text-slate-900 md:text-[20px]">{a.value}</span>
              <span className="block truncate text-[12px] text-slate-500">{a.hint}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600" />
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Establecimientos por nivel" className="lg:col-span-5">
          <LevelColumns counts={levelCounts} ranges={ranges} labels={DME_LEVEL_LABEL} onSelect={onLevel} />
        </ChartCard>
        <ChartCard title="Disponibilidad por microred" className="lg:col-span-7">
          <HBars
            rows={mrRows.map((m) => ({ key: m.microred, label: m.microred, sub: `${m.establishments} establecimientos`, value: m.pct, color: LEVEL_COLOR[m.level], text: pctText(m.pct) }))}
            max={100}
            marks={[lv.regular, lv.alto, lv.optimo]}
            onSelect={onMicrored}
          />
        </ChartCard>
      </div>

      <ChartCard title="Ranking de establecimientos" info={INFO.ranking}>
        <RankingChart rows={report.establishments.map((e) => ({ key: e.code, label: e.name, pct: e.pct, level: e.level }))} levels={lv} labels={DME_LEVEL_LABEL} onSelect={ctx.openEstablishment} />
      </ChartCard>
    </div>
  );
};

/* ---------------------------------------------------------------- Establecimientos y microredes */

export const EstablishmentsReport: React.FC<{
  ctx: ReportContext;
  view: "eess" | "mr";
  onView: (v: "eess" | "mr") => void;
  level: DmeLevel | "ALL";
  onLevel: (l: DmeLevel | "ALL") => void;
  microred: string;
  onMicrored: (m: string) => void;
  levelCounts: Record<DmeLevel, number>;
}> = ({ ctx, view, onView, level, onLevel, microred, onMicrored, levelCounts }) => {
  const { report } = ctx;
  const microreds = useMemo(() => [...new Set(report.establishments.map((e) => e.microred))].sort((a, b) => a.localeCompare(b, "es")), [report]);
  const eess = report.establishments.filter((e) => (level === "ALL" || e.level === level) && (microred === "ALL" || e.microred === microred));
  const pharmaciesOf = useMemo(() => pharmacyGroups(ctx.pharmacy), [ctx.pharmacy]);
  const [showUntyped, setShowUntyped] = useState(false);
  const untyped = useMemo(() => (ctx.pharmacy?.establishments ?? []).filter((p) => pharmacyKind(p.code, ctx.facilityType(p.code)) === "Sin tipo"), [ctx]);
  const mrs = report.microredes.filter((m) => level === "ALL" || m.level === level);
  const switcher = (
    <div className="flex shrink-0 rounded-xl bg-slate-100 p-1">
      {([["eess", "Establecimientos"], ["mr", "Microredes"]] as const).map(([id, label]) => (
        <button key={id} type="button" onClick={() => onView(id)} className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-bold md:flex-none ${view === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>
      ))}
    </div>
  );
  const levelPills = (
    <Pills<DmeLevel | "ALL">
      value={level}
      onChange={onLevel}
      options={[{ value: "ALL", label: "Todos los niveles" }, ...LEVELS.map((l) => ({ value: l, label: `Nivel ${DME_LEVEL_LABEL[l].toLowerCase()}`, count: view === "eess" ? levelCounts[l] : undefined }))]}
    />
  );
  const eessColumns: Column<EstablishmentSummary>[] = [
    { key: "name", label: "Establecimiento", sort: (r) => r.name, render: (r) => (
      <span className="flex items-center gap-2">
        <CodeChip code={r.code} />
        <span className="font-semibold text-slate-900">{r.name}</span>
        <KindChip kind={pharmacyKind(r.code, ctx.facilityType(r.code))} />
        {pharmaciesOf.get(r.code) && <span className="whitespace-nowrap text-[11.5px] font-semibold text-slate-400">{pharmaciesOf.get(r.code)!.length} farmacias</span>}
      </span>
    ) },
    { key: "microred", label: "Microred", sort: (r) => r.microred, render: (r) => <span className="text-[12.5px] text-slate-500">{r.microred}</span> },
    { key: "mix", label: "Situación", render: (r) => <StackBar parts={statusParts(r)} className="h-2.5 w-32" /> },
    ...situationColumns<EstablishmentSummary>((r) => r),
    { key: "pct", label: "Disponibilidad", sort: (r) => r.pct, firstDir: "desc", render: (r) => <PctBar pct={r.pct} color={LEVEL_COLOR[r.level]} /> },
    { key: "level", label: "Nivel", render: (r) => <LevelChip level={r.level} /> },
    { key: "go", label: "", render: () => <ChevronRight className="h-4 w-4 text-slate-300" /> },
  ];
  const mrColumns: Column<MicroredSummary>[] = [
    { key: "microred", label: "Microred", sort: (r) => r.microred, render: (r) => <span className="font-semibold text-slate-900">{r.microred}</span> },
    { key: "establishments", label: "Establec.", align: "right", sort: (r) => r.establishments, render: (r) => <span className="font-mono">{r.establishments}</span> },
    { key: "mix", label: "Situación", render: (r) => <StackBar parts={statusParts(r.counts)} className="h-2.5 w-32" /> },
    ...situationColumns<MicroredSummary>((r) => r.counts),
    { key: "pct", label: "Disponibilidad", sort: (r) => r.pct, firstDir: "desc", render: (r) => <PctBar pct={r.pct} color={LEVEL_COLOR[r.level]} /> },
    { key: "level", label: "Nivel", render: (r) => <LevelChip level={r.level} /> },
  ];
  const untypedBanner = untyped.length > 0 && (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <b>{untyped.length} {untyped.length === 1 ? "farmacia no tiene" : "farmacias no tienen"} tipo en el registro de Establecimientos</b> y se evalúan como puestos comunales. Regístrelas como puesto comunal o farmacia para que el cálculo sea exacto.{" "}
        <button type="button" onClick={() => setShowUntyped(!showUntyped)} className="font-bold underline underline-offset-2">{showUntyped ? "Ocultar" : "Ver cuáles"}</button>
        {showUntyped && <span className="mt-1.5 block">{untyped.map((p) => `${p.code} ${p.name}`).join(" · ")}</span>}
      </span>
    </div>
  );
  return (
    <div className="space-y-3">
      {untypedBanner}
      {view === "eess" ? (
    <ReportTable
      rows={eess}
      minWidth={1150}
      subRows={(r) => pharmaciesOf.get(r.code)}
      subLabel="farmacias y puestos"
      columns={eessColumns}
      excel={{ name: "Establecimientos", title: "Disponibilidad por establecimiento", subtitle: ctx.reportTitle, columns: [
          { header: "Código", width: 10, value: (r) => r.code }, { header: "Establecimiento", width: 40, align: "left", value: (r) => r.name }, { header: "Microred", width: 24, align: "left", value: (r) => r.microred },
          ...xCounts((r: EstablishmentSummary) => r), { header: "Disponibilidad", width: 13, fmt: "pct", value: (r) => r.pct / 100 }, { header: "Nivel", width: 11, value: (r) => DME_LEVEL_LABEL[r.level] },
        ] }}
      rowKey={(r) => r.code}
      itemLabel="establecimientos"
      searchOf={(r) => `${r.code} ${r.name} ${r.microred}`}
      placeholder="Buscar establecimiento…"
      onRowClick={(r) => ctx.openEstablishment(r.code)}
      toolbar={
        <>
          {switcher}
          {levelPills}
          {microreds.length > 1 && (
            <select value={microred} onChange={(e) => onMicrored(e.target.value)} aria-label="Microred" className="h-9 rounded-full border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-600">
              <option value="ALL">Todas las microredes</option>
              {microreds.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </>
      }
      card={(e) => (
        <>
          <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-900">{e.name}</p><LevelChip level={e.level} /><ChevronRight className="h-4 w-4 text-slate-300" /></div>
          <p className="flex items-center gap-1.5 text-[12px] text-slate-500">{e.code} · {e.microred}<KindChip kind={pharmacyKind(e.code, ctx.facilityType(e.code))} /></p>
          <div className="mt-2"><PctBar pct={e.pct} color={LEVEL_COLOR[e.level]} width="flex-1" /></div>
          <StackBar parts={statusParts(e)} className="mt-2 h-2 w-full" />
          <p className="mt-1.5 text-[11.5px] text-slate-500"><b className="text-red-600">{e.desabastecido}</b> desabastecidos · {e.substock} en substock · {e.total} ítems</p>
        </>
      )}
    />
  ) : (
    <ReportTable
      rows={mrs}
      minWidth={1100}
      columns={mrColumns}
      excel={{ name: "Microredes", title: "Disponibilidad por microred", subtitle: ctx.reportTitle, columns: [
          { header: "Microred", width: 28, align: "left", value: (r) => r.microred }, { header: "Establecimientos", width: 14, fmt: "int", value: (r) => r.establishments },
          ...xCounts((r: MicroredSummary) => r.counts), { header: "Disponibilidad", width: 13, fmt: "pct", value: (r) => r.pct / 100 }, { header: "Nivel", width: 11, value: (r) => DME_LEVEL_LABEL[r.level] },
        ] }}
      rowKey={(r) => r.microred}
      itemLabel="microredes"
      searchOf={(r) => r.microred}
      placeholder="Buscar microred…"
      onRowClick={(r) => { onMicrored(r.microred); onView("eess"); }}
      toolbar={<>{switcher}{levelPills}</>}
      card={(m) => (
        <>
          <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-900">{m.microred}</p><LevelChip level={m.level} /><ChevronRight className="h-4 w-4 text-slate-300" /></div>
          <p className="text-[12px] text-slate-500">{m.establishments} establecimientos · {m.counts.total} ítems</p>
          <div className="mt-2"><PctBar pct={m.pct} color={LEVEL_COLOR[m.level]} width="flex-1" /></div>
        </>
      )}
    />
      )}
    </div>
  );
};

/** Barras de situaciones: al pasar el mouse muestran su parte del total y al tocarlas filtran la tabla. */
const SituationBars: React.FC<{
  parts: Array<{ key: string; label: string; value: number; color: string }>;
  total: number;
  active: string;
  onSelect: (key: string) => void;
}> = ({ parts, total, active, onSelect }) => {
  const tip = useChartTip();
  const any = parts.some((p) => p.key === active);
  return (
    <div className="space-y-1">
      {tip.layer}
      {parts.map((p) => {
        const share = (p.value / Math.max(1, total)) * 100;
        const on = active === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onSelect(p.key)}
            aria-pressed={on}
            {...tip.bind(<TipBox title={p.label} color={p.color} rows={[["Ítems", formatNumber(p.value)], ["Del total", pctText(share)]]} note={on ? "Clic para quitar el filtro" : "Clic para ver estos productos"} />)}
            className={`group block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-slate-100 ring-1 ring-slate-300" : "hover:bg-slate-50"} ${any && !on ? "opacity-55" : ""}`}
          >
            <span className="flex items-center gap-2 text-[12.5px]">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
              <span className="flex-1 font-semibold text-slate-700">{p.label}</span>
              <span className="font-mono font-bold text-slate-900">{formatNumber(p.value)}</span>
              <span className="w-12 text-right font-mono text-[11.5px] text-slate-400">{pctText(share)}</span>
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full transition-[filter] group-hover:brightness-110" style={{ width: `${share}%`, background: p.color }} />
            </span>
          </button>
        );
      })}
    </div>
  );
};




/**
 * Título del detalle que es a la vez la lista desplegable de sus farmacias (todo el
 * establecimiento, F01, F02…): la cabecera queda igual que la de cualquier establecimiento.
 * En escritorio un desplegable (con buscador si son más de 6); en el celular, panel inferior.
 */
const PharmacyTitleMenu: React.FC<{
  title: string;
  current: string;
  options: Array<{ code: string; name: string; hint: string; pct: number; level: DmeLevel }>;
  onSelect: (code: string) => void;
}> = ({ title, current, options, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const isDesktop = useIsDesktop();
  const box = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !isDesktop) return;
    const close = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [open, isDesktop]);
  const nq = norm(q.trim());
  const shown = nq ? options.filter((o) => norm(`${o.name} ${o.hint}`).includes(nq)) : options;
  const list = (
    <div className="space-y-0.5">
      {options.length > 6 && <div className="mb-2"><TableSearch value={q} onChange={setQ} placeholder="Buscar farmacia…" className="!max-w-none" /></div>}
      {shown.map((o) => {
        const on = o.code === current;
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => { setOpen(false); setQ(""); if (!on) onSelect(o.code); }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${on ? "bg-teal-50" : "hover:bg-slate-50"}`}
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-bold ${on ? "text-teal-800" : "text-slate-800"}`}>{o.name}</span>
              <span className="block truncate text-[11.5px] text-slate-500">{o.hint}</span>
            </span>
            <span className="font-mono text-[13px] font-black" style={{ color: LEVEL_COLOR[o.level] }}>{pctText(o.pct)}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <div ref={box} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Ver por farmacia"
        className="group -ml-1.5 flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-slate-100"
      >
        <h2 className="truncate text-[20px] font-black text-slate-900">{title}</h2>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:text-slate-700 ${open ? "rotate-180" : ""}`} />
      </button>
      {isDesktop ? (
        open && (
          <div role="listbox" className="absolute left-0 top-10 z-40 max-h-[380px] w-[360px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            <p className="px-3 pb-1.5 pt-1 text-[11px] font-black uppercase tracking-wider text-slate-400">Ver por farmacia</p>
            {list}
          </div>
        )
      ) : (
        <BottomSheet open={open} title="Ver por farmacia" onClose={() => setOpen(false)}>{list}</BottomSheet>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- Detalle de un establecimiento */

export const EstablishmentDetail: React.FC<{ ctx: ReportContext; code: string; onClose: () => void; onSwitch: (code: string) => void }> = ({ ctx, code, onClose, onSwitch }) => {
  const { anchor, toTable } = useTableAnchor();
  // Un establecimiento (06502) o una de sus farmacias o puestos comunales (06502F02).
  const source = ctx.report.establishments.some((x) => x.code === code) ? ctx.report : ctx.pharmacy ?? ctx.report;
  const e = source.establishments.find((x) => x.code === code);
  const items = useMemo(() => source.items.filter((i) => i.code === code), [source.items, code]);
  const ipressCode = code.slice(0, 5);
  const siblings = useMemo(() => pharmacyGroups(ctx.pharmacy).get(ipressCode) ?? [], [ctx.pharmacy, ipressCode]);
  const parent = ctx.report.establishments.find((x) => x.code === ipressCode);
  const [status, setStatus] = useState<StockStatus | "ALL" | "RISK">("ALL");
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(items), ctx.asOf), [ctx.byPharmacy, items, ctx.asOf]);
  const riskKeys = useMemo(() => new Set(risk.rows.map((r) => r.item.medCode)), [risk]);
  const monthlyValue = useMemo(() => ctx.months.map((_, i) => items.reduce((a, it) => a + (it.consumption[i] || 0) * (it.price || 0), 0)), [items, ctx.months]);
  const avgValue = monthlyValue.filter((v) => v > 0).reduce((a, b) => a + b, 0) / Math.max(1, monthlyValue.filter((v) => v > 0).length);
  if (!e) return <EmptyState title="Establecimiento no encontrado" description="No está en el cálculo actual." />;
  const rows = items.filter((i) => status === "ALL" || (status === "RISK" ? riskKeys.has(i.medCode) : i.status === status));
  const columns: Column<AvailabilityItem>[] = [
    { key: "description", label: "Producto", sort: (r) => r.description, render: (r) => <ProductCell code={r.medCode} description={r.description} /> },
    { key: "trend", label: `Consumo ${monthShort(ctx.months[0])} – ${monthShort(ctx.months[ctx.months.length - 1])}`, render: (r) => <Sparkline values={r.consumption} /> },
    { key: "stock", label: "Stock", align: "right", sort: (r) => r.stock, firstDir: "desc", render: (r) => <span className="font-mono">{formatNumber(r.stock)}</span> },
    { key: "cpa", label: "CPA", align: "right", sort: (r) => r.cpa, firstDir: "desc", render: (r) => <span className="font-mono">{dec(r.cpa)}</span> },
    { key: "months", label: "Meses", align: "right", sort: (r) => (Number.isFinite(r.months) ? r.months : 1e9), firstDir: "desc", render: (r) => <span className="font-mono font-bold text-slate-800">{dec(r.months)}</span> },
    { key: "status", label: "Situación", sort: (r) => STATUS_ORDER.indexOf(r.status), render: (r) => <StatusPill status={r.status} /> },
    { key: "expiry", label: "Vence primero", sort: (r) => r.nearestExpiry?.getTime() ?? null, render: (r) => <span className="whitespace-nowrap text-slate-600">{dateText(r.nearestExpiry)}{riskKeys.has(r.medCode) && <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-red-600" />}</span> },
  ];
  return (
    <div className="space-y-4">
      <section className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5 md:pr-14">
        <button type="button" onClick={onClose} aria-label="Cerrar" title="Cerrar" className="absolute right-3 top-3 hidden h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 md:grid">
          <X className="h-5 w-5" />
        </button>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><CodeChip code={e.code} /><LevelChip level={e.level} /><KindChip kind={pharmacyKind(e.code, ctx.facilityType(e.code))} /></div>
            {siblings.length > 0 && parent ? (
              <PharmacyTitleMenu
                title={e.name}
                current={code}
                options={[parent, ...siblings].map((f) => ({
                  code: f.code,
                  name: f.code === ipressCode ? "Todo el establecimiento" : f.name,
                  hint: f.code === ipressCode ? `${f.name} · ${siblings.length} farmacias sumadas` : [f.code, pharmacyKind(f.code, ctx.facilityType(f.code))].filter(Boolean).join(" · "),
                  pct: f.pct,
                  level: f.level,
                }))}
                onSelect={onSwitch}
              />
            ) : (
              <h2 className="mt-1 text-[20px] font-black text-slate-900">{e.name}</h2>
            )}
            <p className="text-[12.5px] text-slate-500">{code !== ipressCode && parent ? `${parent.name} · ` : ""}Microred {e.microred}{e.category ? ` · ${e.category}` : ""} · {e.total} ítems evaluados</p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Disponibilidad</p>
            <p className="text-[32px] font-black leading-none" style={{ color: LEVEL_COLOR[e.level] }}>{pctText(e.pct)}</p>
          </div>
        </div>
      </section>

      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="danger" label="Desabastecidos" value={formatNumber(e.desabastecido)} hint={`de ${e.total} ítems`} onClick={() => { setStatus(StockStatus.DESABASTECIDO); toTable(); }} active={status === StockStatus.DESABASTECIDO} />
        <KpiCard watermark tone="warning" label="Substock" value={formatNumber(e.substock)} hint={`menos de ${ctx.subMax} meses`} onClick={() => { setStatus(StockStatus.SUBSTOCK); toTable(); }} active={status === StockStatus.SUBSTOCK} />
        <KpiCard watermark tone="info" label="Sobrestock" value={formatNumber(e.sobrestock)} hint={`más de ${ctx.sobreMin} meses`} onClick={() => { setStatus(StockStatus.SOBRESTOCK); toTable(); }} active={status === StockStatus.SOBRESTOCK} />
        <KpiCard watermark tone="danger" icon={<CalendarClock />} label="Vence sin usarse" value={money(risk.value)} hint={`${risk.rows.length} lotes`} onClick={() => { setStatus("RISK"); toTable(); }} active={status === "RISK"} />
      </KpiStrip>

      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Consumo mensual valorizado" info={<P>Suma de lo consumido cada mes por todos los productos del establecimiento, en soles (unidades × precio). La línea es el promedio de los meses con consumo.</P>} className="lg:col-span-8">
          <MonthlyBars values={monthlyValue} labels={ctx.months.map(monthShort)} cpa={avgValue} lineLabel="Promedio" format={moneyShort} fullFormat={money} slot={60} />
        </ChartCard>
        <ChartCard title="Situación de los ítems" info={INFO.situations(ctx.subMax, ctx.sobreMin)} className="lg:col-span-4">
          <SituationBars
            parts={STATUS_ORDER.map((st) => ({ key: st, label: STATUS_LABEL[st], value: items.filter((i) => i.status === st).length, color: STATUS_COLOR[st] }))}
            total={e.total}
            active={status}
            onSelect={(k) => { setStatus(status === k ? "ALL" : (k as StockStatus)); toTable(); }}
          />
        </ChartCard>
      </div>

      <ReportTable
        anchorRef={anchor}
        rows={rows}
        columns={columns}
        excel={{ name: "Productos", title: `Productos de ${e.name}`, subtitle: ctx.reportTitle, columns: [
          ...xProduct((r: AvailabilityItem) => r), { header: "Stock", width: 10, fmt: "int", value: (r) => r.stock }, { header: "CPA", width: 9, fmt: "dec1", value: (r) => r.cpa },
          { header: "Meses", width: 9, fmt: "dec1", value: (r) => xNum(r.months) }, { header: "Situación", width: 14, value: (r) => STATUS_LABEL[r.status] }, { header: "Vence primero", width: 13, fmt: "date", value: (r) => r.nearestExpiry ?? "" },
          ...xMonths(ctx, (r: AvailabilityItem) => r.consumption),
        ] }}
        rowKey={(r) => r.medCode}
        itemLabel="productos"
        searchOf={(r) => `${r.medCode} ${r.description}`}
        placeholder="Buscar producto o código…"
        onRowClick={(r, rows) => ctx.openProduct(r, rows)}
        toolbar={
          <Pills<StockStatus | "ALL" | "RISK">
            value={status}
            onChange={setStatus}
            options={[{ value: "ALL", label: "Todos", count: items.length }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], count: items.filter((i) => i.status === s).length })), { value: "RISK", label: "Vence sin usarse", count: riskKeys.size }]}
          />
        }
        card={(i) => (
          <>
            <ProductCell code={i.medCode} description={i.description} />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-slate-600">
              <StatusPill status={i.status} />
              <span>Stock <b className="font-mono text-slate-800">{formatNumber(i.stock)}</b></span>
              <span>CPA <b className="font-mono text-slate-800">{dec(i.cpa)}</b></span>
              <span>Meses <b className="font-mono text-slate-800">{dec(i.months)}</b></span>
            </div>
            <div className="mt-2"><Sparkline values={i.consumption} width={260} height={28} /></div>
          </>
        )}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- Recorrer la tabla desde un panel */

export interface DrawerNav { index: number; total: number; prev: () => void; next: () => void }

/**
 * La tabla sigue al panel (punto G de la auditoría, 2026-10-09). La tabla de donde se abrió un
 * panel queda como «seguidora»: al pasar de registro con ‹ ›, salta a la página donde está el
 * registro abierto, y al cerrar el panel lo resalta un momento. La lista que recibe el panel
 * es la misma de la tabla, en el mismo orden (a veces convertida: filas → productos), así que la
 * posición en una es la posición en la otra. Se ata a la primera lista del mismo largo que
 * navega, para no moverse con un panel abierto desde otro panel (otra lista).
 */
interface DrawerFollower { length: number; list: unknown[] | null; index: (i: number) => void; close: () => void }
let drawerFollower: DrawerFollower | null = null;
const followDrawerIndex = (list: unknown[], i: number) => {
  const f = drawerFollower;
  if (!f || f.length !== list.length || (f.list && f.list !== list)) return;
  f.list = list;
  f.index(i);
};
const followDrawerClose = () => drawerFollower?.close();

/** Arma la navegación anterior/siguiente de un panel sobre la lista de la tabla de donde se abrió. */
export function drawerNav<T>(current: T, list: T[], open: (item: T) => void): DrawerNav | undefined {
  const index = list.indexOf(current);
  if (index < 0 || list.length < 2) return undefined;
  const go = (i: number) => { open(list[i]); followDrawerIndex(list, i); };
  return { index, total: list.length, prev: () => index > 0 && go(index - 1), next: () => index < list.length - 1 && go(index + 1) };
}

/** Teclas del panel: Esc cierra; ← y → pasan al registro anterior o siguiente (no mientras se escribe). */
const useDrawerKeys = (active: boolean, onClose: () => void, nav?: DrawerNav) => {
  // Al cerrar el panel, la tabla de donde se abrió resalta el último registro visto.
  useEffect(() => (active ? followDrawerClose : undefined), [active]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
      if (e.key === "Escape") onClose();
      else if (!typing && nav && e.key === "ArrowLeft") { e.preventDefault(); nav.prev(); }
      else if (!typing && nav && e.key === "ArrowRight") { e.preventDefault(); nav.next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose, nav]);
};

/** Botones ‹ 3 de 112 › del encabezado de un panel. */
const DrawerNavButtons: React.FC<{ nav?: DrawerNav }> = ({ nav }) => {
  if (!nav) return null;
  const btn = "grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex shrink-0 items-center gap-0.5" title="También con las flechas ← y → del teclado">
      <button type="button" onClick={nav.prev} disabled={nav.index === 0} aria-label="Anterior" className={btn}><ChevronRight className="h-5 w-5 rotate-180" /></button>
      <span className="min-w-[64px] text-center font-mono text-[12px] font-bold text-slate-500">{formatNumber(nav.index + 1)} de {formatNumber(nav.total)}</span>
      <button type="button" onClick={nav.next} disabled={nav.index === nav.total - 1} aria-label="Siguiente" className={btn}><ChevronRight className="h-5 w-5" /></button>
    </div>
  );
};

/* ---------------------------------------------------------------- Detalle de un producto (panel lateral) */

/**
 * Salidas que no son consumo de un producto (punto F de la auditoría, 2026-10-09): distingue el
 * producto sin consumo que de verdad no se mueve del que sale por otra vía (lo devuelve, lo
 * distribuye, se vence). Una fila por tipo de salida, un dato por celda.
 */
const OutflowsSection: React.FC<{ ctx: ReportContext; item: AvailabilityItem }> = ({ ctx, item }) => {
  const noUse = item.cpa <= 0;
  const heading = (
    <div className="mb-2 flex items-center gap-1.5">
      <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">Otras salidas (no son consumo)</h4>
      <InfoTip title="Otras salidas"><P>Salidas del TFORMDET que no cuentan como consumo: devoluciones, distribución, vencidos, merma y otras salidas. No suben el CPA; sirven para saber si un producto sin consumo igual sale del establecimiento por otra vía.</P></InfoTip>
    </div>
  );
  if (!ctx.hasOutflows) {
    return noUse ? (
      <div>{heading}<p className="rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-500">Para verlas, vuelva a cargar el TFORMDET: el que está guardado es de antes de que la web las leyera.</p></div>
    ) : null;
  }
  const rows = TFORMDET_OUTFLOWS.flatMap(({ column, label }) => {
    const series = item.outflows?.[column];
    const total = series?.reduce((a, b) => a + b, 0) ?? 0;
    if (!series || total <= 0) return [];
    const last = series.reduce((at, v, i) => (v > 0 ? i : at), -1);
    return [{ column, label, total, months: series.filter((v) => v > 0).length, last: last >= 0 ? monthLabel(ctx.months[last]) : "—" }];
  });
  if (!rows.length) {
    return noUse && item.stock > 0 ? (
      <div>
        {heading}
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />No tuvo consumo ni otras salidas en los {ctx.months.length} meses: el stock no se mueve.
        </p>
      </div>
    ) : null;
  }
  const total = rows.reduce((a, r) => a + r.total, 0);
  return (
    <div>
      {heading}
      {noUse && (
        <p className="mb-2 rounded-xl bg-teal-50 px-3 py-2.5 text-[13px] font-semibold text-teal-800">
          Sin consumo, pero salió por otra vía: {formatNumber(total)} u en los {ctx.months.length} meses.
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2 text-left">Tipo</th><th className="px-3 py-2 text-center">Unidades</th><th className="px-3 py-2 text-center">Meses con salida</th><th className="px-3 py-2 text-center">Última salida</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.column}>
                <td className="px-3 py-2 text-slate-700" title={`Columna ${r.column} del TFORMDET`}>{r.label}</td>
                <td className="px-3 py-2 text-center font-mono">{formatNumber(r.total)}</td>
                <td className="px-3 py-2 text-center font-mono">{r.months}</td>
                <td className="px-3 py-2 text-center">{r.last}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-800">
              <tr><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-center font-mono">{formatNumber(total)}</td><td colSpan={2} /></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export const ProductDrawer: React.FC<{ ctx: ReportContext; item: AvailabilityItem | null; onClose: () => void; nav?: DrawerNav }> = ({ ctx, item, onClose, nav }) => {
  useDrawerKeys(!!item, onClose, nav);
  if (!item) return null;
  // Los lotes de un establecimiento con farmacias se muestran y evalúan por farmacia.
  const units = ctx.byPharmacy([item]);
  const lotRows = units.flatMap((unit) => {
    const risk = new Map(lotRiskOf(unit, ctx.asOf).map((r) => [r.lot, r]));
    return unit.lots.map((lot) => ({ unit, lot, risk: risk.get(lot) }));
  }).sort((a, b) => (a.lot.expiry?.getTime() ?? Infinity) - (b.lot.expiry?.getTime() ?? Infinity));
  const bySite = new Set(lotRows.map((r) => r.lot.site ?? r.unit.code)).size > 1;
  const siteName = (code: string) => ctx.pharmacy?.establishments.find((x) => x.code === code)?.name ?? code;
  const others = ctx.report.items
    .filter((i) => i.medCode === item.medCode && i.code !== item.code && i.code !== item.code.slice(0, 5))
    .sort((a, b) => STATUS_ORDER.indexOf(b.status) - STATUS_ORDER.indexOf(a.status) || b.stock - a.stock);
  const peak = Math.max(...item.consumption);
  const peakMonths = peak > 0 ? item.consumption.map((v, i) => (v === peak ? i : -1)).filter((i) => i >= 0) : null;
  const stat = (label: string, value: React.ReactNode) => (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10.5px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 font-mono text-[17px] font-black text-slate-900">{value}</p>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[100000] flex justify-end bg-slate-900/40 md:backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-label={item.description} className="flex h-full w-full flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200 md:w-[620px]">
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3.5 md:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><CodeChip code={item.medCode} /><StatusPill status={item.status} /></div>
            <h3 className="mt-1 text-[16px] font-black leading-snug text-slate-900">{item.description}</h3>
            <p className="truncate text-[12.5px] text-slate-500">{item.name} · {item.microred}</p>
          </div>
          <DrawerNavButtons nav={nav} />
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat("Stock", formatNumber(item.stock))}
            {stat("CPA", dec(item.cpa))}
            {stat("Meses de stock", dec(item.months))}
            {stat("Precio", item.price ? `S/ ${formatNumber(item.price, 2)}` : "—")}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">Consumo mensual</h4>
              <InfoTip title="Consumo mensual"><P>Unidades consumidas cada mes. La línea punteada es el CPA: el promedio de los meses con consumo. En rojo, el mes (o los meses) de mayor consumo.</P></InfoTip>
            </div>
            <MonthlyBars values={item.consumption} labels={ctx.months.map(monthShort)} cpa={item.cpa} highlight={peakMonths} height={190} />
          </div>
          <OutflowsSection ctx={ctx} item={item} />
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">Lotes, del que vence primero</h4>
              <InfoTip title="Lotes" align="right">{INFO.expiry}</InfoTip>
            </div>
            {lotRows.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-500">Sin lotes con saldo.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <tr>{bySite && <th className="px-3 py-2 text-left">Farmacia</th>}<th className="px-3 py-2 text-center">Lote</th><th className="px-3 py-2 text-center">Vence</th><th className="px-3 py-2 text-center">Saldo</th><th className="px-3 py-2 text-center">Por consumir</th><th className="px-3 py-2 text-center">En riesgo</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lotRows.map(({ unit, lot: l, risk: r }, i) => {
                      const site = l.site ?? unit.code;
                      return (
                        <tr key={i} className={r ? "bg-red-50/50" : ""}>
                          {bySite && (
                            <td className="max-w-[150px] px-3 py-2" title={`${site} · ${siteName(site)} · se evalúa con el CPA de ${unit.name} (${dec(unit.cpa)}${unit.dispensedCpa !== undefined ? `, con lo que entrega a sus puestos; solo dispensado ${dec(unit.dispensedCpa)}` : ""})`}>
                              <span className="block font-mono text-[11px] font-bold text-slate-500">{site.length > 5 ? site.slice(5) : site}</span>
                              <span className="block truncate text-[11.5px] text-slate-600">{siteName(site)}</span>
                            </td>
                          )}
                          <td className="px-3 py-2 text-center font-mono">{l.lot || "—"}</td>
                          <td className="px-3 py-2 text-center">{dateText(l.expiry)}</td>
                          <td className="px-3 py-2 text-center font-mono">{formatNumber(l.balance)}</td>
                          <td className="px-3 py-2 text-center font-mono">{formatNumber(r ? r.usable : l.balance)}</td>
                          <td className="px-3 py-2 text-center font-mono font-bold text-red-700">{r ? formatNumber(r.atRisk) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {others.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">En otros establecimientos</h4>
                <InfoTip title="En otros establecimientos" align="right"><P>El mismo producto en los demás establecimientos, primero los que más lo necesitan.</P><P><b>Stock</b>: unidades al cierre del mes de corte. <b>Meses de stock</b>: cuántos meses le alcanza a ese ritmo de consumo (stock ÷ CPA). Sin consumo no se puede calcular y se muestra «—».</P></InfoTip>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2 text-left">Establecimiento</th><th className="px-3 py-2 text-center">Stock</th><th className="px-3 py-2 text-center">Meses de stock</th><th className="px-3 py-2 text-center">Situación</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {others.slice(0, 12).map((o) => (
                      <tr key={o.code}>
                        <td className="max-w-[220px] px-3 py-2">
                          <span className="block truncate font-semibold text-slate-700">{o.name}</span>
                          <span className="block truncate text-[11.5px] text-slate-400">{o.microred}</span>
                        </td>
                        <td className="px-3 py-2 text-center font-mono">{formatNumber(o.stock)}</td>
                        <td className="px-3 py-2 text-center font-mono" title={Number.isFinite(o.months) ? undefined : "Sin consumo: no se puede calcular"}>{Number.isFinite(o.months) ? dec(o.months) : "—"}</td>
                        <td className="px-3 py-2 text-center"><StatusPill status={o.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

/* ---------------------------------------------------------------- Evolución mes a mes */

/** Meses con menos historial de consumo que este no se muestran: su CPA no es confiable. */
const EVOLUTION_MIN_WINDOW = 6;
const pp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatOneDecimal(Math.abs(v)).replace(".", ",")} pp`;

const LevelPct: React.FC<{ pct: number | null; levelOf: (v: number) => DmeLevel; dim?: boolean }> = ({ pct, levelOf, dim }) => {
  if (pct === null) return <span className="text-slate-300">—</span>;
  const l = levelOf(pct);
  return <span className={`inline-block min-w-[54px] rounded-md px-1.5 py-0.5 text-center font-mono text-[12px] font-bold ${dim ? "opacity-60" : ""}`} style={{ background: LEVEL_SOFT[l], color: LEVEL_COLOR[l] }}>{dec(pct)}</span>;
};

const Delta: React.FC<{ value: number | null }> = ({ value }) =>
  value === null ? <span className="text-slate-300">—</span> : <span className={`font-mono text-[12.5px] font-bold ${value > 0.05 ? "text-emerald-700" : value < -0.05 ? "text-red-700" : "text-slate-500"}`}>{pp(value)}</span>;

export const EvolutionReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const input = ctx.evolution;
  const ev = useMemo(() => (input && ctx.months.length > 1 ? availabilityEvolution(input.rows, ctx.months, input) : null), [input, ctx.months]);
  const levelOf = (v: number) => dmeLevelOf(v, ctx.levels);
  if (ctx.months.length < 2) {
    return <div className="rounded-2xl border border-slate-200 bg-white"><EmptyState title="Hace falta un TFORMDET de varios meses" description="La evolución compara la disponibilidad de cada mes. Descargue la consulta TFORMDET con un rango de meses en el Toolkit." /></div>;
  }
  if (!ev) {
    return <div className="rounded-2xl border border-slate-200 bg-white"><EmptyState title="Vuelva a cargar el TFORMDET" description="El que está guardado en este equipo es de antes de la evolución y no trae el stock de cada mes." /></div>;
  }
  const n = ev.months.length;
  const minWindow = Math.min(EVOLUTION_MIN_WINDOW, n);
  const first = Math.max(ev.windows.findIndex((w) => w >= minWindow), n - 12, 0);
  const idx = ev.months.map((_, k) => k).filter((k) => k >= first);
  const partial = idx.map((k) => ev.windows[k] < 12);
  const values = idx.map((k) => ev.unget[k]);
  const last = values[values.length - 1], firstVal = values[0];
  const worst = idx.reduce((w, k) => (ev.unget[k] < ev.unget[w] ? k : w), idx[0]);
  const delta = (e: EvolutionEntity) => {
    const a = e.pct[idx[0]], b = e.pct[idx[idx.length - 1]];
    return a === null || b === null ? null : b - a;
  };
  const establishments = [...ev.establishments].sort((a, b) => (delta(a) ?? 0) - (delta(b) ?? 0));
  const microredes = [...ev.microredes].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const monthCols: Column<EvolutionEntity>[] = idx.map((k, i) => ({
    key: `m${ev.months[k]}`, label: monthShort(ev.months[k]), sort: (r) => r.pct[k], firstDir: "desc",
    render: (r) => <LevelPct pct={r.pct[k]} levelOf={levelOf} dim={partial[i]} />,
  }));
  const someParcial = partial.some(Boolean);
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone={LEVEL_TONE[levelOf(last)]} label="Disponibilidad al corte" value={pctText(last)} hint={`${monthLabel(ev.months[n - 1])} · nivel ${DME_LEVEL_LABEL[levelOf(last)]}`} />
        <KpiCard watermark tone="neutral" label={`Hace ${idx.length - 1} ${idx.length - 1 === 1 ? "mes" : "meses"}`} value={pctText(firstVal)} hint={monthLabel(ev.months[idx[0]])} />
        <KpiCard watermark tone={last - firstVal > 0.05 ? "success" : last - firstVal < -0.05 ? "danger" : "neutral"} label="Variación" value={pp(last - firstVal)} hint={`de ${monthLabel(ev.months[idx[0]])} a ${monthLabel(ev.months[n - 1])}`} />
        <KpiCard watermark tone={LEVEL_TONE[levelOf(ev.unget[worst])]} label="Peor mes" value={pctText(ev.unget[worst])} hint={monthLabel(ev.months[worst])} />
      </KpiStrip>
      <ChartCard
        title="Disponibilidad mes a mes"
        info={<><P>Cada mes se calcula como si fuera el corte: con su stock al cierre del mes y el consumo de los 12 meses anteriores (CPA), con la misma fórmula del tablero.</P><P>Se muestran hasta los últimos 12 meses que tengan al menos {EVOLUTION_MIN_WINDOW} meses de consumo en el archivo; con menos, el CPA no es confiable. Para 12 meses completos hacen falta 24 meses de TFORMDET.</P></>}
      >
        <EvolutionChart labels={idx.map((k) => monthShort(ev.months[k]))} values={values} partial={partial} windows={idx.map((k) => ev.windows[k])} levels={ctx.levels} levelLabels={DME_LEVEL_LABEL} levelOf={levelOf} />
        {someParcial && (
          <p className="mt-2 text-[12px] text-slate-500">
            Puntos claros y línea punteada: CPA con menos de 12 meses de consumo (el archivo empieza en {monthLabel(ev.months[0])}). Con 24 meses de TFORMDET salen completos.
          </p>
        )}
      </ChartCard>
      {microredes.length > 1 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-slate-100 p-3">
            <h3 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">Microredes mes a mes</h3>
          </div>
          <div className="scrollbar-x overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="bg-slate-50 text-[10.5px] font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left">Microred</th>
                  {idx.map((k) => <th key={k} className="px-2 py-2.5 text-center">{monthShort(ev.months[k])}</th>)}
                  <th className="px-3 py-2.5 text-center">Variación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {microredes.map((m) => (
                  <tr key={m.code} className="h-12">
                    <td className="px-3 py-2 font-semibold text-slate-800">{m.name}</td>
                    {idx.map((k, i) => <td key={k} className="px-2 py-2 text-center"><LevelPct pct={m.pct[k]} levelOf={levelOf} dim={partial[i]} /></td>)}
                    <td className="px-3 py-2 text-center"><Delta value={delta(m)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <ReportTable
        title="Establecimientos mes a mes"
        info={<P>Primero los que más bajaron entre el primer y el último mes. Clic en un establecimiento para abrirlo.</P>}
        rows={establishments}
        columns={[
          { key: "name", label: "Establecimiento", sort: (r) => r.name, render: (r) => <span className="block max-w-[240px]"><span className="block truncate font-semibold text-slate-800">{r.name}</span><span className="block truncate text-[11.5px] text-slate-500">{r.microred}</span></span> },
          ...monthCols,
          { key: "delta", label: "Variación", sort: (r) => delta(r), render: (r) => <Delta value={delta(r)} /> },
        ]}
        rowKey={(r) => r.code}
        itemLabel="establecimientos"
        searchOf={(r) => `${r.code} ${r.name} ${r.microred}`}
        placeholder="Buscar establecimiento o microred…"
        onRowClick={(r) => ctx.openEstablishment(r.code)}
        minWidth={300 + idx.length * 78}
        excel={{ name: "Evolución", title: "Disponibilidad mes a mes por establecimiento", subtitle: `${ctx.reportTitle} · ${ctx.scopeLabel}`, columns: [
          { header: "Código", width: 9, value: (r) => r.code }, { header: "Establecimiento", width: 34, value: (r) => r.name }, { header: "Microred", width: 18, value: (r) => r.microred },
          ...idx.map((k) => ({ header: monthLabel(ev.months[k]), width: 10, fmt: "dec1" as const, value: (r: EvolutionEntity) => r.pct[k] ?? "" })),
          { header: "Variación (pp)", width: 12, fmt: "dec1" as const, value: (r) => delta(r) ?? "" },
        ] }}
        card={(r) => (
          <>
            <p className="font-semibold text-slate-800">{r.name}</p>
            <p className="text-[12px] text-slate-500">{r.microred}</p>
            <div className="mt-2 flex items-center justify-between text-[12.5px]">
              <span className="flex items-center gap-2">{monthShort(ev.months[idx[0]])} <LevelPct pct={r.pct[idx[0]]} levelOf={levelOf} dim={partial[0]} /> → {monthShort(ev.months[n - 1])} <LevelPct pct={r.pct[n - 1]} levelOf={levelOf} /></span>
              <Delta value={delta(r)} />
            </div>
          </>
        )}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- ¿Dónde falta? */

export const GapsReport: React.FC<{ ctx: ReportContext; onProduct: (g: ProductGap, list?: ProductGap[]) => void }> = ({ ctx, onProduct }) => {
  const { anchor, toTable } = useTableAnchor();
  const products = useMemo(() => productGapReport(ctx.report.items, ctx.warehouse), [ctx.report.items, ctx.warehouse]);
  const [filter, setFilter] = useState<"ALL" | "DESAB" | "WIDE" | "DONOR" | "COVER" | "SITE">("DESAB");
  const siteGaps = useMemo(() => siteGapReport(ctx.report.items, ctx.pharmacy?.items ?? [], separateOf(ctx)), [ctx]);
  const siteWithMain = siteGaps.filter((r) => (r.main?.stock ?? 0) > 0).length;
  const withDesab = products.filter((p) => p.desabastecido > 0);
  const solvable = withDesab.filter((p) => p.donors > 0 || p.warehouseStock > 0);
  const n = ctx.report.establishments.length;
  const wide = withDesab.filter((p) => p.desabastecido >= Math.max(2, n * 0.25));
  const donorsDesab = withDesab.filter((p) => p.donors > 0);
  // Los indicadores y las pastillas filtran lo mismo, y siempre sobre los productos desabastecidos.
  const byFilter = { ALL: products, DESAB: withDesab, WIDE: wide, DONOR: donorsDesab, COVER: solvable, SITE: [] };
  const rows = byFilter[filter];
  const siteColumns: Column<SiteGapRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} /> },
    { key: "site", label: "Puesto comunal", sort: (r) => r.item.name, render: (r) => <span className="block max-w-[260px]"><span className="block truncate font-semibold text-slate-800">{r.item.name}</span><span className="block truncate text-[11.5px] text-slate-400">{siteLabel(ctx, r.establishment)} › {r.item.code.slice(5)}</span></span> },
    { key: "stock", label: "Stock", sort: (r) => r.item.stock, render: (r) => <span className="font-mono font-bold text-red-600">{formatNumber(r.item.stock)}</span> },
    { key: "cpa", label: "CPA", sort: (r) => r.item.cpa, firstDir: "desc", render: (r) => <span className="font-mono">{dec(r.item.cpa)}</span> },
    { key: "main", label: "Su F01 tiene", sort: (r) => r.main?.stock ?? 0, firstDir: "desc", render: (r) => (r.main?.stock ? <span className="whitespace-nowrap"><span className="block font-mono font-bold text-blue-700">{formatNumber(r.main.stock)} u</span><span className="block text-[11px] text-slate-400">{dec(r.main.months)} meses</span></span> : <span className="text-slate-300">0</span>) },
    { key: "status", label: "Establecimiento", sort: (r) => STATUS_ORDER.indexOf(r.establishment.status), render: (r) => <StatusPill status={r.establishment.status} /> },
  ];
  const pills = <Pills value={filter} onChange={setFilter} options={[{ value: "DESAB", label: "Desabastecidos", count: withDesab.length }, { value: "WIDE", label: "Faltan en muchos", count: wide.length }, { value: "DONOR", label: "A otro le sobra", count: donorsDesab.length }, { value: "COVER", label: "Se pueden cubrir", count: solvable.length }, ...(ctx.pharmacy ? [{ value: "SITE" as const, label: "Faltan en un puesto", count: siteGaps.length }] : []), { value: "ALL", label: "Todos", count: products.length }]} />;
  const columns: Column<ProductGap>[] = [
    { key: "description", label: "Producto", sort: (r) => r.description, render: (r) => <ProductCell code={r.medCode} description={r.description} /> },
    { key: "mix", label: "En los establecimientos", render: (r) => <StackBar parts={statusParts(r)} className="h-2.5 w-44" /> },
    { key: "desabastecido", label: "Desab.", align: "right", sort: (r) => r.desabastecido, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-red-600">{r.desabastecido}</span> },
    { key: "substock", label: "Sub", align: "right", sort: (r) => r.substock, firstDir: "desc", render: (r) => <span className="font-mono">{r.substock}</span> },
    { key: "establishments", label: "Establec.", align: "right", sort: (r) => r.establishments, firstDir: "desc", render: (r) => <span className="font-mono text-slate-500">{r.establishments}</span> },
    { key: "donors", label: "Les sobra", align: "right", sort: (r) => r.donors, firstDir: "desc", render: (r) => <span className={`font-mono ${r.donors ? "font-bold text-blue-700" : "text-slate-300"}`}>{r.donors}</span> },
    { key: "warehouseStock", label: "Almacén", align: "right", sort: (r) => r.warehouseStock, firstDir: "desc", render: (r) => <span className={`font-mono ${r.warehouseStock ? "font-bold text-amber-700" : "text-slate-300"}`}>{formatNumber(r.warehouseStock)}</span> },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols={ctx.pharmacy ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-2 xl:grid-cols-4"}>
        <KpiCard watermark tone="danger" icon={<PackageX />} label="Productos desabastecidos" value={formatNumber(withDesab.length)} hint="faltan en al menos un establecimiento" onClick={() => { setFilter("DESAB"); toTable(); }} active={filter === "DESAB"} />
        <KpiCard watermark tone="warning" icon={<Building2 />} label="Faltan en muchos" value={formatNumber(wide.length)} hint="en 1 de cada 4 establecimientos o más" onClick={() => { setFilter("WIDE"); toTable(); }} active={filter === "WIDE"} />
        <KpiCard watermark tone="info" icon={<Repeat2 />} label="A otro le sobra" value={formatNumber(donorsDesab.length)} hint="otro establecimiento tiene de más y puede pasarlo" onClick={() => { setFilter("DONOR"); toTable(); }} active={filter === "DONOR"} />
        <KpiCard watermark tone="success" icon={<Warehouse />} label="Se pueden cubrir" value={formatNumber(solvable.length)} hint="con lo que le sobra a otro o con el almacén" onClick={() => { setFilter("COVER"); toTable(); }} active={filter === "COVER"} />
        {ctx.pharmacy && <KpiCard watermark tone="info" icon={<Store />} label="Faltan en un puesto" value={formatNumber(siteGaps.length)} hint={`el establecimiento sí los tiene · ${formatNumber(siteWithMain)} los tiene su F01`} onClick={() => { setFilter("SITE"); toTable(); }} active={filter === "SITE"} />}
      </KpiStrip>
      <ChartCard title="Productos que faltan en más establecimientos" info={INFO.gaps(ctx.subMax)}>
        <HBars
          labelWidth="w-44 md:w-80"
          rows={withDesab.slice(0, 12).map((p) => ({ key: p.medCode, label: p.description, sub: p.donors || p.warehouseStock ? `a ${p.donors} les sobra · almacén ${formatNumber(p.warehouseStock)}` : "a ningún establecimiento le sobra · sin almacén", value: p.desabastecido, color: STATUS_COLOR[StockStatus.DESABASTECIDO], text: `${p.desabastecido} de ${p.establishments}` }))}
          onSelect={(k) => { const p = products.find((x) => x.medCode === k); if (p) onProduct(p); }}
        />
      </ChartCard>
      {filter === "SITE" ? (
        <ReportTable
          anchorRef={anchor}
          title="Faltan en un puesto"
          info={INFO.gaps(ctx.subMax)}
          rows={siteGaps}
          columns={siteColumns}
          excel={{ name: "Faltan en un puesto", title: "Puestos comunales desabastecidos que su establecimiento no muestra", subtitle: ctx.reportTitle, columns: [
          ...xProduct((r: SiteGapRow) => r.item), { header: "Cód. puesto", width: 12, value: (r) => r.item.code }, { header: "Puesto comunal", width: 36, align: "left", value: (r) => r.item.name },
          { header: "Establecimiento", width: 34, align: "left", value: (r) => r.establishment.name }, { header: "Stock", width: 9, fmt: "int", value: (r) => r.item.stock }, { header: "CPA", width: 9, fmt: "dec1", value: (r) => r.item.cpa },
          { header: "Stock en su F01", width: 13, fmt: "int", value: (r) => r.main?.stock ?? 0 }, { header: "Meses en su F01", width: 13, fmt: "dec1", value: (r) => (r.main ? xNum(r.main.months) : "") }, { header: "Situación del establecimiento", width: 18, value: (r) => STATUS_LABEL[r.establishment.status] },
        ] }}
          rowKey={(r) => `${r.item.code}|${r.item.medCode}`}
          itemLabel="puestos"
          searchOf={(r) => `${r.item.medCode} ${r.item.description} ${r.item.name} ${r.establishment.name}`}
          placeholder="Buscar producto o puesto…"
          onRowClick={(r, rows) => ctx.openProduct(r.establishment, rows.map((x) => x.establishment))}
          toolbar={pills}
          card={(r) => (
            <>
              <ProductCell code={r.item.medCode} description={r.item.description} />
              <p className="mt-1.5 text-[12px] text-slate-500"><b className="text-slate-700">{r.item.name}</b> · stock <b className="text-red-600">{formatNumber(r.item.stock)}</b> · CPA {dec(r.item.cpa)}</p>
              <p className="text-[12px] text-slate-500">Su F01 tiene <b className="text-blue-700">{formatNumber(r.main?.stock ?? 0)} u</b> · establecimiento en {STATUS_LABEL[r.establishment.status].toLowerCase()}</p>
            </>
          )}
        />
      ) : (
        <ReportTable
          anchorRef={anchor}
          title="Productos"
          info={INFO.gaps(ctx.subMax)}
          rows={rows}
          columns={columns}
          excel={{ name: "Dónde falta", title: "Productos que faltan en los establecimientos", subtitle: ctx.reportTitle, columns: [
          ...xProduct((r: ProductGap) => r), ...xCounts((r: ProductGap) => ({ ...r, total: r.establishments })),
          { header: "Les sobra", width: 10, fmt: "int", value: (r) => r.donors }, { header: "Stock en almacén", width: 14, fmt: "int", value: (r) => r.warehouseStock },
        ] }}
          rowKey={(r) => r.medCode}
          itemLabel="productos"
          searchOf={(r) => `${r.medCode} ${r.description}`}
          placeholder="Buscar producto o código…"
          onRowClick={(r, rows) => onProduct(r, rows)}
          toolbar={pills}
          card={(p) => (
            <>
              <ProductCell code={p.medCode} description={p.description} />
              <StackBar parts={statusParts(p)} className="mt-2 h-2 w-full" />
              <p className="mt-1.5 text-[12px] text-slate-500"><b className="text-red-600">{p.desabastecido}</b> desab. · {p.substock} sub · de {p.establishments} · a <b className="text-blue-700">{p.donors}</b> les sobra · almacén {formatNumber(p.warehouseStock)}</p>
            </>
          )}
        />
      )}
    </div>
  );
};

/** Panel de un producto en todos los establecimientos (desde «¿Dónde falta?»). */
export const ProductGapDrawer: React.FC<{ ctx: ReportContext; gap: ProductGap | null; onClose: () => void; nav?: DrawerNav }> = ({ ctx, gap, onClose, nav }) => {
  useDrawerKeys(!!gap, onClose, nav);
  if (!gap) return null;
  const rows = [...gap.items].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.months - b.months);
  const total = gap.items[0]?.consumption.map((_, i) => gap.items.reduce((a, it) => a + (it.consumption[i] || 0), 0)) ?? [];
  // CPA de la red: el promedio de los totales mensuales (meses con consumo), comparable con las barras.
  const cpa = averageConsumption(total);
  return (
    <div className="fixed inset-0 z-[100000] flex justify-end bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-label={gap.description} className="flex h-full w-full flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200 md:w-[620px]">
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3.5 md:px-5">
          <div className="min-w-0 flex-1">
            <CodeChip code={gap.medCode} />
            <h3 className="mt-1 text-[16px] font-black leading-snug text-slate-900">{gap.description}</h3>
            <p className="text-[12.5px] text-slate-500">{gap.establishments} establecimientos · almacén {formatNumber(gap.warehouseStock)}</p>
          </div>
          <DrawerNavButtons nav={nav} />
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-5">
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">Consumo de la red</h4>
              <InfoTip title="Consumo de la red"><P>Cada barra es el total de unidades consumidas en el mes, sumando todos los establecimientos que tienen el producto.</P><P>La línea es el CPA de la red: el promedio de esos totales en los meses con consumo.</P></InfoTip>
            </div>
            <MonthlyBars values={total} labels={ctx.months.map(monthShort)} cpa={cpa} lineLabel="CPA de la red" height={170} />
          </div>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rows.map((o) => (
              <button key={o.code} type="button" onClick={() => ctx.openProduct(o, rows)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[12.5px] hover:bg-slate-50">
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-800">{o.name}</span><span className="block text-[11.5px] text-slate-400">{o.microred}</span></span>
                <span className="text-right font-mono text-slate-600">{formatNumber(o.stock)} u<br /><span className="text-[11px] text-slate-400">{dec(o.months)} meses</span></span>
                <StatusPill status={o.status} />
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
};

/* ---------------------------------------------------------------- Riesgo de vencimiento */

export const ExpiryReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(ctx.report.items), ctx.asOf), [ctx.byPharmacy, ctx.report.items, ctx.asOf]);
  const [bucket, setBucket] = useState<"URGENT" | "ALL" | "NOUSE" | "STILL" | (typeof EXPIRY_BUCKETS)[number]>("URGENT");
  const byEst = useMemo(() => {
    const m = new Map<string, { name: string; value: number; lots: number }>();
    for (const r of risk.rows) {
      if (r.bucket === "LATER") continue;
      const ipress = r.item.ipressCode;
      const e = m.get(ipress) || { name: ctx.report.establishments.find((x) => x.code === ipress)?.name ?? r.item.name, value: 0, lots: 0 };
      e.value += r.value; e.lots++;
      m.set(ipress, e);
    }
    return [...m.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10);
  }, [risk]);
  const rows = risk.rows.filter((r) => bucket === "ALL" || (bucket === "URGENT" ? r.bucket !== "LATER" : bucket === "NOUSE" ? r.item.cpa <= 0 : bucket === "STILL" ? isStill(r.item) : r.bucket === bucket));
  const bucketColor: Record<string, string> = { EXPIRED: "#7f1d1d", M3: "#dc2626", M6: "#f97316", M12: "#f59e0b", LATER: "#94a3b8" };
  const whereOf = (it: AvailabilityItem) => siteLabel(ctx, it);
  const columns: Column<LotRiskRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} sub={whereOf(r.item)} /> },
    { key: "lot", label: "Lote", render: (r) => <span className="font-mono text-[12px]">{r.lot.lot || "—"}</span> },
    { key: "expiry", label: "Vence", sort: (r) => r.lot.expiry?.getTime() ?? null, render: (r) => <span className="whitespace-nowrap">{dateText(r.lot.expiry)}<span className="block text-[11px] text-slate-400">{r.bucket === "EXPIRED" ? "vencido" : `en ${dec(r.monthsToExpiry)} meses`}</span></span> },
    { key: "balance", label: "Saldo", align: "right", sort: (r) => r.lot.balance, firstDir: "desc", render: (r) => <span className="font-mono">{formatNumber(r.lot.balance)}</span> },
    { key: "cpa", label: "CPA", align: "right", sort: (r) => r.item.cpa, render: (r) => <span className="font-mono">{dec(r.item.cpa)}{r.item.dispensedCpa !== undefined && <span className="block font-sans text-[11px] text-slate-400" title={`Solo dispensado: ${dec(r.item.dispensedCpa)}`}>con entregas a puestos</span>}</span> },
    { key: "usable", label: "Por consumir", align: "right", render: (r) => <span className="font-mono text-slate-500">{formatNumber(r.usable)}</span> },
    { key: "atRisk", label: "En riesgo", align: "right", sort: (r) => r.atRisk, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-red-700">{formatNumber(r.atRisk)}</span> },
    { key: "value", label: "Valor", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-slate-900">{money(r.value)}</span> },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="danger" icon={<CalendarClock />} label="Vence sin usarse en 12 meses" value={money(risk.urgentValue)} hint={`${formatNumber(risk.urgentLots)} lotes · al ${dateText(ctx.asOf)}`} onClick={() => { setBucket("URGENT"); toTable(); }} active={bucket === "URGENT"} />
        <KpiCard watermark tone="danger" label="En los próximos 3 meses" value={money(risk.byBucket.M3.value + risk.byBucket.EXPIRED.value)} hint={`${risk.byBucket.M3.lots + risk.byBucket.EXPIRED.lots} lotes, incluye vencidos`} onClick={() => { setBucket("M3"); toTable(); }} active={bucket === "M3"} />
        <KpiCard watermark tone="neutral" label="De productos sin consumo" value={money(risk.noUseValue)} hint={ctx.hasOutflows ? `${money(risk.stillValue)} no se mueven nada` : `${formatNumber(risk.noUseLots)} lotes sin rotación`} onClick={() => { setBucket("NOUSE"); toTable(); }} active={bucket === "NOUSE" || bucket === "STILL"} />
        <KpiCard watermark tone="warning" label="Total en riesgo" value={money(risk.value)} hint={`${formatNumber(risk.units)} unidades · ${formatNumber(risk.rows.length)} lotes`} onClick={() => { setBucket("ALL"); toTable(); }} active={bucket === "ALL"} />
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Valor en riesgo según cuándo vence" info={INFO.expiry} className="lg:col-span-5">
          <HBars
            labelWidth="w-28"
            rows={EXPIRY_BUCKETS.map((b) => ({ key: b, label: EXPIRY_BUCKET_LABEL[b], sub: `${risk.byBucket[b].lots} lotes`, value: risk.byBucket[b].value, color: bucketColor[b], text: money(risk.byBucket[b].value) }))}
            onSelect={(k) => { setBucket(k as (typeof EXPIRY_BUCKETS)[number]); toTable(); }}
          />
        </ChartCard>
        <ChartCard title="Establecimientos con más valor en riesgo (12 meses)" className="lg:col-span-7">
          <HBars labelWidth="w-36 md:w-52" rows={byEst.map(([code, e]) => ({ key: code, label: e.name, sub: `${e.lots} lotes`, value: e.value, color: "#dc2626", text: money(e.value) }))} onSelect={ctx.openEstablishment} />
        </ChartCard>
      </div>
      <ReportTable
        anchorRef={anchor}
        title="Lotes en riesgo"
        info={INFO.expiry}
        rows={rows}
        columns={columns}
        excel={{ name: "Vencimientos", title: "Lotes en riesgo de vencer sin usarse", subtitle: ctx.reportTitle, columns: [
          ...xSite(ctx, (r: LotRiskRow) => r.item), ...xProduct((r: LotRiskRow) => r.item), { header: "Lote", width: 14, value: (r) => r.lot.lot },
          { header: "Vence", width: 12, fmt: "date", value: (r) => r.lot.expiry ?? "" }, { header: "Meses al vencimiento", width: 12, fmt: "dec1", value: (r) => r.monthsToExpiry },
          { header: "Saldo", width: 10, fmt: "int", value: (r) => r.lot.balance }, { header: "CPA", width: 9, fmt: "dec1", value: (r) => r.item.cpa }, { header: "Por consumir", width: 11, fmt: "int", value: (r) => r.usable },
          { header: "En riesgo", width: 10, fmt: "int", value: (r) => r.atRisk }, { header: "Precio", width: 10, fmt: "money", value: (r) => r.item.price || 0 }, { header: "Valor en riesgo", width: 13, fmt: "money", value: (r) => r.value },
        ] }}
        rowKey={(r) => `${r.item.code}|${r.item.medCode}|${r.lot.lot}|${r.lot.expiry?.getTime()}`}
        itemLabel="lotes"
        searchOf={(r) => `${r.item.medCode} ${r.item.description} ${whereOf(r.item)} ${r.lot.lot}`}
        placeholder="Buscar producto, lote o establecimiento…"
        onRowClick={(r, rows) => ctx.openProduct(r.item, rows.map((x) => x.item))}
        minWidth={1050}
        toolbar={<Pills value={bucket} onChange={setBucket} options={[{ value: "URGENT", label: "Próximos 12 meses" }, ...EXPIRY_BUCKETS.map((b) => ({ value: b, label: EXPIRY_BUCKET_LABEL[b], count: risk.byBucket[b].lots })), { value: "NOUSE", label: "Sin consumo" }, ...(ctx.hasOutflows ? [{ value: "STILL" as const, label: "Sin ningún movimiento", count: risk.stillLots }] : []), { value: "ALL", label: "Todos" }]} />}
        card={(r) => (
          <>
            <ProductCell code={r.item.medCode} description={r.item.description} sub={whereOf(r.item)} />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-600">
              <span>Lote <b className="font-mono">{r.lot.lot}</b></span>
              <span>Vence <b>{dateText(r.lot.expiry)}</b></span>
              <span className="font-bold text-red-700">{formatNumber(r.atRisk)} en riesgo · {money(r.value)}</span>
            </div>
          </>
        )}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- Consumos irregulares */

export const ConsumptionReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const data = useMemo(() => consumptionReport(ctx.report.items), [ctx.report.items]);
  const [xyz, setXyz] = useState<"ALL" | "X" | "Y" | "Z">("ALL");
  const totalXyz = data.xyz.X + data.xyz.Y + data.xyz.Z;
  const rows = data.peaks;
  const classRows = useMemo(() => data.classified.filter((c) => c.xyz === xyz), [data, xyz]);
  const classColumns: Column<ClassifiedItem>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.name} /> },
    { key: "trend", label: "Consumo mensual", render: (r) => <Sparkline values={r.item.consumption} width={140} /> },
    { key: "months", label: "Meses con consumo", align: "right", sort: (r) => r.monthsWithUse, firstDir: "desc", render: (r) => <span className="font-mono">{r.monthsWithUse} de {r.item.consumption.length}</span> },
    { key: "cpa", label: "CPA", align: "right", sort: (r) => r.item.cpa, firstDir: "desc", render: (r) => <span className="font-mono">{dec(r.item.cpa)}</span> },
    { key: "cv", label: "Variación", align: "right", sort: (r) => r.cv, firstDir: "desc", render: (r) => <span className="font-mono font-bold">{(Math.floor(r.cv * 100) / 100).toFixed(2).replace(".", ",")}</span> },
    { key: "status", label: "Situación", sort: (r) => STATUS_ORDER.indexOf(r.item.status), render: (r) => <StatusPill status={r.item.status} /> },
  ];
  const xyzTitle: Record<"X" | "Y" | "Z", string> = { X: "Consumo estable (X)", Y: "Consumo variable (Y)", Z: "Consumo irregular (Z)" };
  const columns: Column<PeakRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.name} /> },
    { key: "trend", label: "Consumo mensual", render: (r) => <Sparkline values={r.item.consumption} highlight={r.peakIndex} width={140} /> },
    { key: "month", label: "Mes del pico", sort: (r) => r.peakIndex, render: (r) => <span className="whitespace-nowrap">{monthLabel(ctx.months[r.peakIndex])}</span> },
    { key: "peak", label: "Pico", align: "right", sort: (r) => r.peak, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-red-700">{formatNumber(r.peak)}</span> },
    { key: "avg", label: "Otros meses con consumo", align: "right", sort: (r) => r.othersAverage, render: (r) => <span className="font-mono">{dec(r.othersAverage)}</span> },
    { key: "ratio", label: "Veces", align: "right", sort: (r) => (Number.isFinite(r.ratio) ? r.ratio : 1e9), firstDir: "desc", render: (r) => <span className="font-mono font-bold">{Number.isFinite(r.ratio) ? `×${dec(r.ratio)}` : "—"}</span> },
    { key: "xyz", label: "Tipo", sort: (r) => r.xyz, render: (r) => <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-bold text-slate-600">{r.xyz} · {XYZ_LABEL[r.xyz]}</span> },
    { key: "value", label: "Valor del pico", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono">{money(r.value)}</span> },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="danger" icon={<TrendingUp />} label="Picos de consumo" value={formatNumber(data.peaks.length)} hint="un mes con 3 veces lo habitual" onClick={() => { setXyz("ALL"); toTable(); }} active={xyz === "ALL"} />
        <KpiCard watermark tone="success" label="Consumo estable (X)" value={formatNumber(data.xyz.X)} hint={`${pctText(totalXyz ? (data.xyz.X / totalXyz) * 100 : 0)} de los ítems con consumo`} onClick={() => { setXyz("X"); toTable(); }} active={xyz === "X"} />
        <KpiCard watermark tone="warning" label="Consumo variable (Y)" value={formatNumber(data.xyz.Y)} hint={`${pctText(totalXyz ? (data.xyz.Y / totalXyz) * 100 : 0)} de los ítems con consumo`} onClick={() => { setXyz("Y"); toTable(); }} active={xyz === "Y"} />
        <KpiCard watermark tone="danger" label="Consumo irregular (Z)" value={formatNumber(data.xyz.Z)} hint={`${pctText(totalXyz ? (data.xyz.Z / totalXyz) * 100 : 0)} de los ítems con consumo`} onClick={() => { setXyz("Z"); toTable(); }} active={xyz === "Z"} />
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Picos por mes" info={INFO.peaks} className="lg:col-span-7">
          <MonthlyBars values={data.peaksByMonth} labels={ctx.months.map(monthShort)} color="#dc2626" />
        </ChartCard>
        <ChartCard title="Qué tan parejo es el consumo" info={INFO.xyz} className="lg:col-span-5">
          <Donut
            centerValue={formatNumber(totalXyz)}
            centerLabel="ítems con consumo"
            selected={xyz === "ALL" ? null : xyz}
            onSelect={(k) => { setXyz(xyz === k ? "ALL" : (k as "X" | "Y" | "Z")); toTable(); }}
            segments={[
              { key: "X", label: "X · Estable", value: data.xyz.X, color: "#10b981" },
              { key: "Y", label: "Y · Variable", value: data.xyz.Y, color: "#f59e0b" },
              { key: "Z", label: "Z · Irregular", value: data.xyz.Z, color: "#dc2626" },
            ]}
          />
        </ChartCard>
      </div>
      {xyz !== "ALL" ? (
        <ReportTable
        anchorRef={anchor}
          key={xyz}
          title={xyzTitle[xyz]}
          info={INFO.xyz}
          rows={classRows}
          columns={classColumns}
          excel={{ name: "Consumo por tipo", title: xyzTitle[xyz], subtitle: ctx.reportTitle, columns: [
          ...xSite(ctx, (r: ClassifiedItem) => r.item), ...xProduct((r: ClassifiedItem) => r.item), { header: "Tipo", width: 10, value: (r) => `${r.xyz} · ${XYZ_LABEL[r.xyz]}` },
          { header: "Meses con consumo", width: 12, fmt: "int", value: (r) => r.monthsWithUse }, { header: "CPA", width: 9, fmt: "dec1", value: (r) => r.item.cpa }, { header: "Variación", width: 10, fmt: "0.00", value: (r) => r.cv },
          { header: "Situación", width: 14, value: (r) => STATUS_LABEL[r.item.status] }, ...xMonths(ctx, (r: ClassifiedItem) => r.item.consumption),
        ] }}
          rowKey={(r) => `${r.item.code}|${r.item.medCode}`}
          itemLabel="ítems"
          searchOf={(r) => `${r.item.medCode} ${r.item.description} ${r.item.name}`}
          placeholder="Buscar producto o establecimiento…"
          onRowClick={(r, rows) => ctx.openProduct(r.item, rows.map((x) => x.item))}
          toolbar={<button type="button" onClick={() => setXyz("ALL")} className="h-9 shrink-0 rounded-full border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50">Volver a los picos</button>}
          minWidth={1000}
          card={(r) => (
            <>
              <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.name} />
              <div className="mt-2 flex items-center gap-3"><Sparkline values={r.item.consumption} width={150} /><span className="text-[12px] text-slate-600">{r.monthsWithUse} meses con consumo · variación {(Math.floor(r.cv * 100) / 100).toFixed(2).replace(".", ",")}</span></div>
            </>
          )}
        />
      ) : (
        <ReportTable
        anchorRef={anchor}
        title="Picos de consumo"
        info={INFO.peaks}
        rows={rows}
        columns={columns}
        excel={{ name: "Picos de consumo", title: "Picos de consumo", subtitle: ctx.reportTitle, columns: [
          ...xSite(ctx, (r: PeakRow) => r.item), ...xProduct((r: PeakRow) => r.item), { header: "Mes del pico", width: 12, value: (r) => monthLabel(ctx.months[r.peakIndex]) },
          { header: "Pico", width: 10, fmt: "int", value: (r) => r.peak }, { header: "Promedio otros meses", width: 13, fmt: "dec1", value: (r) => r.othersAverage }, { header: "Veces", width: 9, fmt: "dec1", value: (r) => xNum(r.ratio) },
          { header: "Tipo", width: 10, value: (r) => `${r.xyz} · ${XYZ_LABEL[r.xyz]}` }, { header: "Valor del pico", width: 13, fmt: "money", value: (r) => r.value }, ...xMonths(ctx, (r: PeakRow) => r.item.consumption),
        ] }}
        rowKey={(r) => `${r.item.code}|${r.item.medCode}`}
        itemLabel="picos"
        searchOf={(r) => `${r.item.medCode} ${r.item.description} ${r.item.name}`}
        placeholder="Buscar producto o establecimiento…"
        onRowClick={(r, rows) => ctx.openProduct(r.item, rows.map((x) => x.item))}
        minWidth={1050}
        card={(r) => (
          <>
            <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.name} />
            <div className="mt-2 flex items-center gap-3"><Sparkline values={r.item.consumption} highlight={r.peakIndex} width={150} /><span className="text-[12px] text-slate-600"><b className="text-red-700">{formatNumber(r.peak)}</b> en {monthShort(ctx.months[r.peakIndex])} · ×{dec(r.ratio)}</span></div>
          </>
        )}
      />
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- ABC × XYZ */

export const AbcReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const data = useMemo(() => abcXyzReport(ctx.report.items), [ctx.report.items]);
  const [cell, setCell] = useState<string | null>(null);
  const rows = data.products.filter((p) => !cell || `${p.abc}${p.xyz}` === cell);
  const heat = (n: number) => {
    const max = Math.max(1, ...Object.values(data.matrix));
    const t = n / max;
    return `rgba(13, 148, 136, ${0.08 + t * 0.82})`;
  };
  const advice: Record<string, string> = {
    AX: "Programar con precisión", AY: "Revisar cada mes", AZ: "Vigilar de cerca",
    BX: "Programación regular", BY: "Revisión periódica", BZ: "Stock de seguridad",
    CX: "Pedido simple", CY: "Pedido simple", CZ: "Pedir solo si se usa",
  };
  const columns: Column<AbcProduct>[] = [
    { key: "description", label: "Producto", sort: (r) => r.description, render: (r) => <ProductCell code={r.medCode} description={r.description} /> },
    { key: "class", label: "Clase", sort: (r) => `${r.abc}${r.xyz}`, render: (r) => <span className="rounded-md bg-teal-50 px-2 py-0.5 font-mono text-[12px] font-black text-teal-800">{r.abc}{r.xyz}</span> },
    { key: "trend", label: "Consumo de la red", render: (r) => <Sparkline values={r.consumption} width={140} /> },
    { key: "units", label: "Unidades", align: "right", sort: (r) => r.units, firstDir: "desc", render: (r) => <span className="font-mono">{formatNumber(r.units)}</span> },
    { key: "value", label: "Valor consumido", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-slate-900">{money(r.value)}</span> },
    { key: "share", label: "% del valor", align: "right", sort: (r) => r.share, firstDir: "desc", render: (r) => <span className="font-mono">{pctText(r.share * 100)}</span> },
    { key: "cumulative", label: "Acumulado", align: "right", sort: (r) => r.cumulative, render: (r) => <span className="font-mono text-slate-500">{pctText(r.cumulative * 100)}</span> },
    { key: "establishments", label: "Establec.", align: "right", sort: (r) => r.establishments, firstDir: "desc", render: (r) => <span className="font-mono">{r.establishments}</span> },
  ];
  const share = (k: "A" | "B" | "C") => (data.total ? (data.counts[k].value / data.total) * 100 : 0);
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="info" icon={<Boxes />} label="Valor consumido" value={money(data.total)} hint={`${formatNumber(data.products.length)} productos en ${ctx.months.length} meses`} onClick={() => { setCell(null); toTable(); }} active={!cell} />
        <KpiCard watermark tone="danger" label="Clase A" value={formatNumber(data.counts.A.products)} hint={`productos · ${pctText(share("A"))} del valor`} />
        <KpiCard watermark tone="warning" label="Clase B" value={formatNumber(data.counts.B.products)} hint={`productos · ${pctText(share("B"))} del valor`} />
        <KpiCard watermark tone="neutral" label="Clase C" value={formatNumber(data.counts.C.products)} hint={`productos · ${pctText(share("C"))} del valor`} />
      </KpiStrip>
      <ChartCard title="Matriz ABC × XYZ" info={INFO.abc}>
        <div className="scrollbar-x overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-[120px_repeat(3,1fr)] gap-2">
            <span />
            {(["X", "Y", "Z"] as const).map((x) => (
              <span key={x} className="text-center text-[12px] font-black text-slate-600">{x} · {XYZ_LABEL[x]}</span>
            ))}
            {(["A", "B", "C"] as const).map((a) => (
              <React.Fragment key={a}>
                <span className="flex flex-col justify-center text-[12px] font-black text-slate-600">Clase {a}<span className="font-semibold text-slate-400">{pctText(share(a))} del valor</span></span>
                {(["X", "Y", "Z"] as const).map((x) => {
                  const k = `${a}${x}`;
                  const n = data.matrix[k] || 0;
                  const dark = n / Math.max(1, ...Object.values(data.matrix)) > 0.5;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => { setCell(cell === k ? null : k); toTable(); }}
                      className={`rounded-xl px-4 py-4 text-left transition-transform hover:scale-[1.02] ${cell === k ? "ring-2 ring-slate-900" : ""}`}
                      style={{ background: heat(n) }}
                    >
                      <span className={`block font-mono text-[12px] font-black ${dark ? "text-white/80" : "text-teal-900/70"}`}>{k}</span>
                      <span className={`block text-[26px] font-black leading-tight ${dark ? "text-white" : "text-slate-900"}`}>{formatNumber(n)}</span>
                      <span className={`block text-[11.5px] font-semibold ${dark ? "text-white/85" : "text-slate-600"}`}>{advice[k]}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </ChartCard>
      <ReportTable
        anchorRef={anchor}
        title={cell ? `Productos ${cell}` : "Productos por valor consumido"}
        info={INFO.abc}
        rows={rows}
        columns={columns}
        excel={{ name: "Clasificación ABC", title: cell ? `Productos ${cell}` : "Productos por valor consumido (ABC × XYZ)", subtitle: ctx.reportTitle, columns: [
          ...xProduct((r: AbcProduct) => r), { header: "Clase", width: 8, value: (r) => `${r.abc}${r.xyz}` }, { header: "Unidades", width: 11, fmt: "int", value: (r) => r.units },
          { header: "Valor consumido", width: 14, fmt: "money", value: (r) => r.value }, { header: "% del valor", width: 11, fmt: "pct", value: (r) => r.share }, { header: "Acumulado", width: 11, fmt: "pct", value: (r) => r.cumulative },
          { header: "Establecimientos", width: 13, fmt: "int", value: (r) => r.establishments }, ...xMonths(ctx, (r: AbcProduct) => r.consumption),
        ] }}
        rowKey={(r) => r.medCode}
        itemLabel="productos"
        searchOf={(r) => `${r.medCode} ${r.description}`}
        placeholder="Buscar producto o código…"
        minWidth={1050}
        card={(r) => (
          <>
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><ProductCell code={r.medCode} description={r.description} /></div><span className="rounded-md bg-teal-50 px-2 py-0.5 font-mono text-[12px] font-black text-teal-800">{r.abc}{r.xyz}</span></div>
            <p className="mt-1.5 text-[12px] text-slate-600">{money(r.value)} · {pctText(r.share * 100)} del valor · {formatNumber(r.units)} u</p>
          </>
        )}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- Sobrestock inmovilizado */

export const OverstockReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const data = useMemo(() => overstockReport(ctx.report.items, ctx.sobreMin), [ctx.report.items, ctx.sobreMin]);
  // Lo mismo que propone el plan de redistribución: el excedente que va a otros establecimientos.
  const movableNeeds = useMemo(() => {
    const plan = redistributionPlan({ items: ctx.report.items, pharmacyItems: ctx.pharmacy?.items ?? [], warehouse: ctx.warehouse, subMax: ctx.subMax, sobreMin: ctx.sobreMin, isSeparate: separateOf(ctx) });
    let value = 0, needs = 0;
    for (const r of plan.rows) {
      const donated = r.sources.filter((x) => plan.pools[x.pool]?.kind === "donor").reduce((a, x) => a + x.qty, 0);
      if (donated > 0) { needs++; value += donated * (r.to.price || 0); }
    }
    return { value, needs };
  }, [ctx]);
  const movable = movableNeeds.value;
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(ctx.report.items), ctx.asOf), [ctx.byPharmacy, ctx.report.items, ctx.asOf]);
  const overlap = useMemo(() => overstockAtRisk(data.rows, risk.rows), [data, risk]);
  const example = data.rows.find((r) => r.item.cpa >= 5 && r.value > 50) || data.rows[0];
  const columns: Column<OverstockRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.name} /> },
    { key: "stock", label: "Stock", align: "right", sort: (r) => r.item.stock, firstDir: "desc", render: (r) => <span className="font-mono">{formatNumber(r.item.stock)}</span> },
    { key: "cpa", label: "CPA", align: "right", sort: (r) => r.item.cpa, render: (r) => <span className="font-mono">{dec(r.item.cpa)}</span> },
    { key: "months", label: "Meses", align: "right", sort: (r) => r.item.months, firstDir: "desc", render: (r) => <span className="font-mono font-bold">{dec(r.item.months)}</span> },
    { key: "split", label: `Necesita ${ctx.sobreMin} meses · excedente`, render: (r) => (
      <span className="mx-auto flex h-2.5 w-44 overflow-hidden rounded-full bg-slate-100">
        <span className="bg-emerald-400" style={{ width: `${(r.needed / r.item.stock) * 100}%` }} />
        <span className="bg-blue-500" style={{ width: `${(r.excess / r.item.stock) * 100}%` }} />
      </span>
    ) },
    { key: "excess", label: "Excedente", align: "right", sort: (r) => r.excess, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-blue-700">{formatNumber(r.excess)}</span> },
    { key: "value", label: "Inmovilizado", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-slate-900">{money(r.value)}</span> },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="info" icon={<PackageX />} label="Dinero inmovilizado" value={money(data.value)} hint={overlap.value > 0 ? `de ello ${money(overlap.value)} vence en 12 meses` : `excedente sobre ${ctx.sobreMin} meses de consumo`} />
        <KpiCard watermark tone="info" label="Productos con excedente" value={formatNumber(data.rows.length)} hint={`${formatNumber(data.units)} unidades de más`} />
        <KpiCard watermark tone="success" icon={<Repeat2 />} label="Se puede mover a donde falta" value={money(movable)} hint={`a ${formatNumber(movableNeeds.needs)} necesidades del plan`} onClick={() => ctx.goTab("redistribution")} />
        <KpiCard watermark tone="neutral" icon={<Building2 />} label="Establecimientos con excedente" value={formatNumber(data.establishments.length)} hint={data.establishments[0] ? `el mayor: ${data.establishments[0].name}` : ""} />
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Cómo se calcula" info={INFO.overstock(ctx.sobreMin)} className="lg:col-span-5">
          {example ? (
            <div>
              <p className="text-[13px] font-semibold text-slate-800">{example.item.description}</p>
              <p className="text-[12px] text-slate-500">{example.item.name} · CPA {dec(example.item.cpa)} al mes</p>
              <div className="mt-4 flex h-12 overflow-hidden rounded-xl text-[12px] font-bold text-white">
                <span className="flex items-center justify-center bg-emerald-500 px-2" style={{ width: `${(example.needed / example.item.stock) * 100}%` }}>{formatNumber(example.needed)}</span>
                <span className="flex items-center justify-center bg-blue-500 px-2" style={{ width: `${(example.excess / example.item.stock) * 100}%` }}>{formatNumber(example.excess)}</span>
              </div>
              <div className="mt-2 flex justify-between text-[11.5px] text-slate-500">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Lo que usa en {ctx.sobreMin} meses</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />Excedente</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2"><p className="text-[10.5px] font-black uppercase text-slate-400">Stock</p><p className="font-mono text-[16px] font-black">{formatNumber(example.item.stock)}</p></div>
                <div className="rounded-xl bg-slate-50 p-2"><p className="text-[10.5px] font-black uppercase text-slate-400">Excedente</p><p className="font-mono text-[16px] font-black text-blue-700">{formatNumber(example.excess)}</p></div>
                <div className="rounded-xl bg-slate-50 p-2"><p className="text-[10.5px] font-black uppercase text-slate-400">× precio</p><p className="font-mono text-[16px] font-black">{money(example.value)}</p></div>
              </div>
            </div>
          ) : <EmptyState title="Sin sobrestock" description="Ningún producto pasa el límite." />}
        </ChartCard>
        <ChartCard title="Dinero inmovilizado por establecimiento" className="lg:col-span-7">
          <HBars labelWidth="w-36 md:w-52" rows={data.establishments.slice(0, 10).map((e) => ({ key: e.code, label: e.name, sub: `${e.items} productos · ${e.microred}`, value: e.value, color: "#3b82f6", text: money(e.value) }))} onSelect={ctx.openEstablishment} />
        </ChartCard>
      </div>
      <ReportTable
        title="Productos con excedente"
        info={INFO.overstock(ctx.sobreMin)}
        rows={data.rows}
        columns={columns}
        excel={{ name: "Sobrestock", title: "Productos con excedente (sobrestock inmovilizado)", subtitle: ctx.reportTitle, columns: [
          ...xSite(ctx, (r: OverstockRow) => r.item), ...xProduct((r: OverstockRow) => r.item), { header: "Stock", width: 10, fmt: "int", value: (r) => r.item.stock },
          { header: "CPA", width: 9, fmt: "dec1", value: (r) => r.item.cpa }, { header: "Meses", width: 9, fmt: "dec1", value: (r) => xNum(r.item.months) }, { header: `Necesita (${ctx.sobreMin} meses)`, width: 13, fmt: "int", value: (r) => r.needed },
          { header: "Excedente", width: 11, fmt: "int", value: (r) => r.excess }, { header: "Precio", width: 10, fmt: "money", value: (r) => r.item.price || 0 }, { header: "Inmovilizado", width: 13, fmt: "money", value: (r) => r.value },
        ] }}
        rowKey={(r) => `${r.item.code}|${r.item.medCode}`}
        itemLabel="productos"
        searchOf={(r) => `${r.item.medCode} ${r.item.description} ${r.item.name}`}
        placeholder="Buscar producto o establecimiento…"
        onRowClick={(r, rows) => ctx.openProduct(r.item, rows.map((x) => x.item))}
        minWidth={1050}
        card={(r) => (
          <>
            <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.name} />
            <p className="mt-1.5 text-[12px] text-slate-600">Stock {formatNumber(r.item.stock)} · {dec(r.item.months)} meses · <b className="text-blue-700">{formatNumber(r.excess)} de más</b> · <b>{money(r.value)}</b></p>
          </>
        )}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- Redistribución */

interface PlanView extends PlanRow {
  excluded: boolean;
  covered: number;
  short: number;
}

const PlanQty: React.FC<{ value: number; max: number; over: boolean; disabled?: boolean; onChange: (v: number) => void }> = ({ value, max, over, disabled, onChange }) => (
  <input
    type="number"
    min={0}
    max={max}
    value={value}
    disabled={disabled}
    onClick={(e) => e.stopPropagation()}
    onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
    className={`h-8 w-[72px] rounded-lg border px-2 text-center font-mono text-[13px] font-bold outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-40 ${over ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-800"}`}
  />
);

export const RedistributionReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const isSeparate = useMemo(() => separateOf(ctx), [ctx]);
  // Sugerencia inicial: internas, luego excedente de otros establecimientos y lo que falte, del almacén.
  const plan = useMemo(
    () => redistributionPlan({ items: ctx.report.items, pharmacyItems: ctx.pharmacy?.items ?? [], warehouse: ctx.warehouse, subMax: ctx.subMax, sobreMin: ctx.sobreMin, isSeparate }),
    [ctx.report.items, ctx.pharmacy, ctx.warehouse, ctx.subMax, ctx.sobreMin, isSeparate],
  );
  const { planEdits: edits, setPlanEdits: setEdits } = ctx;
  const views: PlanView[] = useMemo(() => plan.rows.map((r) => {
    const e = edits[r.key];
    // Fuentes de la sugerencia más las que el usuario agregó desde el panel.
    const extra = Object.keys(e?.qty ?? {}).filter((k) => !r.sources.some((x) => x.pool === k)).map((k) => ({ pool: k, qty: 0 }));
    const sources = [...r.sources, ...extra].map((x) => ({ ...x, qty: e?.qty?.[x.pool] ?? x.qty }));
    const covered = sources.reduce((a, x) => a + x.qty, 0);
    return { ...r, sources, excluded: !!e?.excluded, covered, short: Math.max(0, r.need - covered) };
  }), [plan, edits]);
  const used = useMemo(() => planUsage(views), [views]);
  const leftOf = (pool: string) => (plan.pools[pool]?.capacity ?? 0) - (used[pool] || 0);
  // Una fila nunca recibe más de lo que necesita: el tope de cada fuente es lo que falta con las demás.
  const roomFor = (v: PlanView, x: PlanSource) => Math.max(0, v.need - (v.covered - x.qty));
  const setQty = (v: PlanView, pool: string, n: number) => {
    const x = v.sources.find((s) => s.pool === pool);
    const value = Math.min(n, x ? roomFor(v, x) : Math.max(0, v.need - v.covered));
    setEdits((cur) => ({ ...cur, [v.key]: { ...cur[v.key], qty: { ...cur[v.key]?.qty, [pool]: value } } }));
  };
  const setExcluded = (row: string, v: boolean) => setEdits((cur) => ({ ...cur, [row]: { ...cur[row], excluded: v } }));
  const edited = Object.keys(edits).length > 0;
  const overPools = Object.keys(used).filter((k) => leftOf(k) < 0);

  const active = views.filter((v) => !v.excluded);
  const sum = (list: PlanView[], kind: string) => list.reduce((a, v) => a + v.sources.filter((x) => plan.pools[x.pool]?.kind === kind).reduce((b, x) => b + x.qty, 0), 0);
  const donorUnits = sum(active, "donor"), whUnits = sum(active, "warehouse"), internalUnits = sum(active, "internal");
  const shortRows = active.filter((v) => v.short > 0);
  const [filter, setFilter] = useState<"ALL" | "DONOR" | "WAREHOUSE" | "INTERNAL" | "SHORT">("ALL");
  const has = (v: PlanView, kind: string) => v.sources.some((x) => plan.pools[x.pool]?.kind === kind && x.qty > 0);
  // Las filas que no se distribuyen siguen en la tabla (en gris y sin marcar), para volver a marcarlas.
  // «Mostrar»: todas, solo las que van en el plan o solo las que se quitaron (pedido del usuario:
  // los filtros ayudan a ver lo desmarcado, pero tienen que decir claramente qué muestran).
  const [show, setShow] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [confirmReset, setConfirmReset] = useState(false);
  const rows = views.filter((v) => (show === "ALL" || (show === "OUT" ? v.excluded : !v.excluded)) && (filter === "ALL" || (!v.excluded && (filter === "SHORT" ? v.short > 0 : has(v, filter === "DONOR" ? "donor" : filter === "WAREHOUSE" ? "warehouse" : "internal")))));

  const byDonor = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const v of active) for (const x of v.sources) {
      const pool = plan.pools[x.pool];
      if (pool?.kind !== "donor" || !x.qty) continue;
      const e = m.get(pool.item.code) || { name: pool.item.name, n: 0 }; e.n++; m.set(pool.item.code, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [active, plan]);
  const byReceiver = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const v of active) if (!v.site && v.covered > 0) { const e = m.get(v.to.code) || { name: v.to.name, n: 0 }; e.n++; m.set(v.to.code, e); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [active]);

  const whereOf = (it: AvailabilityItem) => siteLabel(ctx, it);
  const units = (v: PlanView, kind: string) => v.sources.filter((x) => plan.pools[x.pool]?.kind === kind).reduce((a, x) => a + x.qty, 0);
  const stateOf = (v: PlanView): [string, string] => v.excluded ? ["No se distribuye", "bg-slate-100 text-slate-500"] : v.short === 0 ? ["Cubierto", "bg-emerald-50 text-emerald-700"] : v.covered > 0 ? ["Parcial", "bg-amber-50 text-amber-700"] : ["Sin cubrir", "bg-red-50 text-red-700"];
  const overRow = (v: PlanView) => !v.excluded && v.sources.some((x) => x.qty > 0 && leftOf(x.pool) < 0);
  // Una fila, un dato por celda (NN/g, Carbon, PatternFly): el detalle y la edición, en el panel.
  const columns: Column<PlanView>[] = [
    { key: "description", label: "Producto", sort: (r) => r.to.description, render: (r) => <span className={r.excluded ? "opacity-45" : ""}><ProductCell code={r.to.medCode} description={r.to.description} /></span> },
    { key: "to", label: "Recibe", sort: (r) => r.to.name, render: (r) => <span className={`block max-w-[240px] ${r.excluded ? "opacity-45" : ""}`}><span className="block truncate font-semibold text-slate-800">{r.site ? whereOf(r.to) : r.to.name}</span><span className="block text-[11.5px] text-slate-500">{formatNumber(r.to.stock)} u · CPA {dec(r.to.cpa)}</span></span> },
    { key: "status", label: "Situación", sort: (r) => STATUS_ORDER.indexOf(r.to.status), render: (r) => <StatusPill status={r.to.status} /> },
    { key: "need", label: "Necesita", sort: (r) => r.need, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-slate-900">{formatNumber(r.need)}</span> },
    { key: "others", label: "De otros", sort: (r) => units(r, "donor") + units(r, "internal"), firstDir: "desc", render: (r) => { const n = units(r, "donor") + units(r, "internal"); return <span className={`font-mono ${n ? "font-bold text-blue-700" : "text-slate-300"}`}>{formatNumber(n)}</span>; } },
    { key: "warehouse", label: "Del almacén", sort: (r) => units(r, "warehouse"), firstDir: "desc", render: (r) => { const n = units(r, "warehouse"); return <span className={`font-mono ${n ? "font-bold text-amber-700" : "text-slate-300"}`}>{formatNumber(n)}</span>; } },
    { key: "short", label: "Falta", sort: (r) => (r.excluded ? -1 : r.short), firstDir: "desc", render: (r) => <span className={`font-mono ${!r.excluded && r.short ? "font-bold text-red-600" : "text-slate-300"}`}>{r.excluded ? "—" : formatNumber(r.short)}</span> },
    { key: "state", label: "Estado", sort: (r) => (r.excluded ? 3 : r.short === 0 ? 0 : r.covered > 0 ? 1 : 2), render: (r) => { const [label, cls] = stateOf(r); return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${overRow(r) ? "bg-red-600 text-white" : cls}`}>{overRow(r) ? "Revisar" : label}</span>; } },
    // La casilla solo marca o desmarca; el resto de la fila abre el panel.
    { key: "include", label: "Distribuir", sort: (r) => Number(!r.excluded), render: (r) => <label onClick={(e) => e.stopPropagation()} className="-m-3 inline-flex cursor-pointer p-3" title={r.excluded ? "Volver a incluir en el plan" : "Quitar del plan"}><input type="checkbox" checked={!r.excluded} onChange={(e) => setExcluded(r.key, !e.target.checked)} className="h-4 w-4 cursor-pointer accent-teal-600" aria-label="Distribuir" /></label> },
  ];
  const [openKey, setOpenKey] = useState<{ key: string; list: string[] } | null>(null);
  const openView = openKey ? views.find((v) => v.key === openKey.key) ?? null : null;

  const download = async () => {
    const lines = active.flatMap((v) => v.sources.filter((x) => x.qty > 0).map((x) => ({ v, x, pool: plan.pools[x.pool] })));
    const toCols = (who: string) => [
      { header: who, width: 34, align: "left" as const }, { header: "Cód. entrega", width: 12 },
      { header: "Recibe", width: 34, align: "left" as const }, { header: "Cód. recibe", width: 12 },
      { header: "Código SISMED", width: 12 }, { header: "Producto", width: 48, align: "left" as const },
      { header: "Cantidad", width: 11, fmt: "int" }, { header: "Precio", width: 10, fmt: "money" }, { header: "Valor", width: 12, fmt: "money" },
    ];
    const toRow = (l: (typeof lines)[number]) => [l.pool.item.name, l.pool.item.code, l.v.site ? whereOf(l.v.to) : l.v.to.name, l.v.to.code, l.v.to.medCode, l.v.to.description, l.x.qty, l.v.to.price || 0, l.x.qty * (l.v.to.price || 0)];
    const byGiver = (a: (typeof lines)[number], b: (typeof lines)[number]) => a.pool.item.name.localeCompare(b.pool.item.name, "es") || a.v.to.name.localeCompare(b.v.to.name, "es") || a.v.to.description.localeCompare(b.v.to.description, "es");
    const subtitle = `Plan de redistribución · ${ctx.reportTitle} · generado el ${new Date().toLocaleDateString("es-PE")}. Es un plan: se ejecuta al registrar los movimientos en el SISMED.`;
    const sheets: TableSheet[] = [
      { name: "Entre establecimientos", title: "Entregas entre establecimientos", subtitle, columns: toCols("Entrega"), rows: lines.filter((l) => l.pool.kind === "donor").sort(byGiver).map(toRow) },
      { name: "Desde el almacén", title: "Pedido al almacén", subtitle, columns: toCols("Almacén"), rows: lines.filter((l) => l.pool.kind === "warehouse").sort(byGiver).map(toRow) },
      { name: "Internas F01 - puesto", title: "Internas: de la F01 a sus puestos comunales", subtitle, columns: toCols("Entrega (F01)"), rows: lines.filter((l) => l.pool.kind === "internal").sort(byGiver).map(toRow) },
      {
        name: "Sin cubrir", title: "Lo que el plan no alcanza a cubrir", subtitle,
        columns: [{ header: "Establecimiento", width: 36, align: "left" }, { header: "Código", width: 10 }, { header: "Código SISMED", width: 12 }, { header: "Producto", width: 48, align: "left" }, { header: "Situación", width: 14 }, { header: "Necesita", width: 11, fmt: "int" }, { header: "Cubierto", width: 11, fmt: "int" }, { header: "Falta", width: 10, fmt: "int" }],
        rows: shortRows.map((v) => [v.site ? whereOf(v.to) : v.to.name, v.to.code, v.to.medCode, v.to.description, STATUS_LABEL[v.to.status], v.need, v.covered, v.short]),
      },
    ];
    const buffer = await buildTableWorkbook(sheets).xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Plan_redistribucion_${ctx.reportTitle.replace(/[^\w]+/g, "_")}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-3 xl:grid-cols-5">
        <KpiCard watermark tone="info" icon={<Repeat2 />} label="Necesidades" value={formatNumber(active.length)} hint={`${formatNumber(active.length - shortRows.length)} cubiertas${views.length > active.length ? ` · ${formatNumber(views.length - active.length)} sin distribuir` : ` · ${formatNumber(active.filter((v) => v.to.status === StockStatus.DESABASTECIDO).length)} desabastecidas`}`} onClick={() => { setFilter("ALL"); toTable(); }} active={filter === "ALL"} />
        <KpiCard watermark tone="success" icon={<Building2 />} label="De otros establecimientos" value={`${formatNumber(donorUnits)} u`} hint={`en ${formatNumber(active.filter((v) => has(v, "donor")).length)} necesidades · su excedente`} onClick={() => { setFilter("DONOR"); toTable(); }} active={filter === "DONOR"} />
        <KpiCard watermark tone="warning" icon={<Warehouse />} label="Del almacén" value={`${formatNumber(whUnits)} u`} hint={`completa ${formatNumber(active.filter((v) => has(v, "warehouse")).length)} necesidades`} onClick={() => { setFilter("WAREHOUSE"); toTable(); }} active={filter === "WAREHOUSE"} />
        <KpiCard watermark tone="info" icon={<Store />} label="Internas F01 → puesto" value={`${formatNumber(internalUnits)} u`} hint={`${formatNumber(active.filter((v) => has(v, "internal")).length)} puestos`} onClick={() => { setFilter("INTERNAL"); toTable(); }} active={filter === "INTERNAL"} />
        <KpiCard watermark tone="danger" icon={<PackageX />} label="Sin cubrir" value={formatNumber(shortRows.length)} hint={`faltan ${formatNumber(shortRows.reduce((a, v) => a + v.short, 0))} u`} onClick={() => { setFilter("SHORT"); toTable(); }} active={filter === "SHORT"} />
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Establecimientos con más excedente para transferir" info={<><P>Establecimientos en sobrestock que más productos transfieren en el plan. El número es la cantidad de productos que entregan.</P><P>Excedente: lo que tienen por encima de {ctx.sobreMin} meses de consumo.</P></>}>
          <HBars labelWidth="w-36 md:w-56" rows={byDonor.map(([code, e]) => ({ key: code, label: e.name, value: e.n, color: "#3b82f6", text: `${e.n}` }))} onSelect={ctx.openEstablishment} />
        </ChartCard>
        <ChartCard title="Establecimientos con más productos por recibir" info={<P>Establecimientos desabastecidos o en substock que más productos reciben en el plan, de otros establecimientos o del almacén. El número es la cantidad de productos.</P>}>
          <HBars labelWidth="w-36 md:w-56" rows={byReceiver.map(([code, e]) => ({ key: code, label: e.name, value: e.n, color: "#0d9488", text: `${e.n}` }))} onSelect={ctx.openEstablishment} />
        </ChartCard>
      </div>
      {overPools.length > 0 && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] text-red-800">
          En {overPools.length === 1 ? "una fuente" : `${overPools.length} fuentes`} se asigna más de lo que tiene{overPools.length === 1 ? "" : "n"} para dar. Baje las cantidades marcadas en rojo antes de descargar el Excel.
        </p>
      )}
      <ReportTable
        anchorRef={anchor}
        title="Plan de redistribución"
        info={INFO.redistribution(ctx.subMax, ctx.sobreMin)}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        itemLabel="necesidades"
        searchOf={(r) => `${r.to.medCode} ${r.to.description} ${r.to.name} ${r.sources.map((x) => plan.pools[x.pool]?.item.name).join(" ")}`}
        placeholder="Buscar producto o establecimiento…"
        onRowClick={(r, list) => setOpenKey({ key: r.key, list: list.map((x) => x.key) })}
        minWidth={1100}
        toolbar={(
          <div className="flex shrink-0 items-center gap-2">
            {/* Un combo en la misma línea del buscador (pedido del usuario: nada que salte a otra fila). */}
            <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Qué filas mostrar" className={`${filterInputClass} !w-auto min-w-[150px] cursor-pointer`}>
              <option value="ALL">Todas ({formatNumber(views.length)})</option>
              <option value="IN">Incluidas ({formatNumber(active.length)})</option>
              <option value="OUT">Excluidas ({formatNumber(views.length - active.length)})</option>
            </select>
            {edited && (
              <button type="button" onClick={() => setConfirmReset(true)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50" title="Deshacer mis cambios: el plan vuelve a como lo calculó el sistema">
                <RotateCcw className="h-4 w-4" />Deshacer
              </button>
            )}
            {/* El mismo botón «Excel» de las demás pestañas (pedido del usuario); este trae el plan en varias hojas. */}
            <button type="button" onClick={download} disabled={overPools.length > 0 || !active.length} title={overPools.length ? "Hay fuentes con más asignado de lo que tienen: corríjalas antes de descargar" : "Descargar el plan en Excel (entregas, pedido al almacén, internas y sin cubrir)"} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-4 w-4 text-teal-700" />Excel
            </button>
          </div>
        )}
        card={(r) => {
          const [label, cls] = stateOf(r);
          return (
            <>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1"><ProductCell code={r.to.medCode} description={r.to.description} /></span>
                  <label onClick={(e) => e.stopPropagation()} className="-m-2 inline-flex cursor-pointer p-2"><input type="checkbox" checked={!r.excluded} onChange={(e) => setExcluded(r.key, !e.target.checked)} className="h-5 w-5 cursor-pointer accent-teal-600" aria-label="Distribuir" /></label>
              </div>
              <p className="mt-1.5 truncate text-[12px] font-semibold text-slate-700">{r.site ? whereOf(r.to) : r.to.name}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-500">
                <span>Necesita <b className="text-slate-900">{formatNumber(r.need)}</b></span>
                <span className={`ml-auto whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${overRow(r) ? "bg-red-600 text-white" : cls}`}>{overRow(r) ? "Revisar" : label}</span>
              </div>
            </>
          );
        }}
      />
      <ConfirmationDialog
        isOpen={confirmReset}
        tone="warning"
        title="Deshacer mis cambios"
        description={`Se pierden los cambios que hiciste en ${formatNumber(Object.keys(edits).length)} ${Object.keys(edits).length === 1 ? "fila" : "filas"} (cantidades y filas quitadas) y el plan vuelve a como lo calculó el sistema.`}
        confirmLabel="Deshacer"
        onConfirm={() => { setEdits({}); setConfirmReset(false); }}
        onCancel={() => setConfirmReset(false)}
      />
      {openView && (
        <PlanDrawer
          ctx={ctx}
          view={openView}
          plan={plan}
          leftOf={leftOf}
          onQty={(pool, n) => setQty(openView, pool, n)}
          onExcluded={(v) => setExcluded(openView.key, v)}
          onReset={() => setEdits((cur) => { const next = { ...cur }; delete next[openView.key]; return next; })}
          edited={!!edits[openView.key]}
          onClose={() => setOpenKey(null)}
          nav={openKey ? drawerNav(openKey.key, openKey.list, (key) => setOpenKey({ key, list: openKey.list })) : undefined}
        />
      )}
    </div>
  );
};

/** Panel de una necesidad del plan: de dónde sale cada parte y quién más puede dar. */
const PlanDrawer: React.FC<{
  ctx: ReportContext;
  view: PlanView;
  plan: ReturnType<typeof redistributionPlan>;
  leftOf: (pool: string) => number;
  onQty: (pool: string, n: number) => void;
  onExcluded: (v: boolean) => void;
  onReset: () => void;
  edited: boolean;
  onClose: () => void;
  nav?: DrawerNav;
}> = ({ ctx, view: v, plan, leftOf, onQty, onExcluded, onReset, edited, onClose, nav }) => {
  useDrawerKeys(true, onClose, nav);
  const assigned = new Map(v.sources.map((x) => [x.pool, x.qty]));
  // Quién puede dar: su F01 si es un puesto; si no, todos los establecimientos con excedente de ese producto y el almacén.
  const candidates = Object.values(plan.pools)
    .filter((p) => p.medCode === v.to.medCode && (v.site ? p.kind === "internal" && p.item.ipressCode === v.to.ipressCode : p.kind !== "internal" && p.item.code !== v.to.code))
    .sort((a, b) => Number((assigned.get(b.key) ?? 0) > 0) - Number((assigned.get(a.key) ?? 0) > 0) || Number(a.kind === "warehouse") - Number(b.kind === "warehouse") || Number(b.item.microred === v.to.microred) - Number(a.item.microred === v.to.microred) || leftOf(b.key) - leftOf(a.key));
  const where = v.site ? siteLabel(ctx, v.to) : v.to.name;
  // En un portal: dentro de la pestaña, el fondo oscuro dejaba una franja blanca arriba.
  return createPortal(
    <div className="fixed inset-0 z-[100000] flex justify-end bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-label={v.to.description} className="flex h-full w-full flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200 md:w-[620px]">
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3.5 md:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><CodeChip code={v.to.medCode} /><StatusPill status={v.to.status} /></div>
            <h3 className="mt-1 text-[16px] font-black leading-snug text-slate-900">{v.to.description}</h3>
            <p className="truncate text-[12.5px] text-slate-500">Recibe: {where}{v.to.microred ? ` · ${v.to.microred}` : ""}</p>
          </div>
          <DrawerNavButtons nav={nav} />
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Stock", formatNumber(v.to.stock)], ["CPA", dec(v.to.cpa)], ["Necesita", formatNumber(v.need)], [v.excluded ? "No se distribuye" : v.short ? "Falta" : "Cubierto", v.excluded ? "—" : formatNumber(v.short || v.covered)]].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10.5px] font-black uppercase tracking-wider text-slate-400">{label}</p>
                <p className="mt-0.5 font-mono text-[17px] font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">De dónde sale</h4>
              <InfoTip title="De dónde sale"><P>Viene calculado. Primero, el excedente de otros establecimientos (lo que les sobra por encima de {ctx.sobreMin} meses, primero de la misma microred); lo que falte, del almacén. Un puesto comunal recibe de su F01.</P><P>Se puede cambiar cualquier cantidad o elegir a otro que también tenga excedente. «Le queda» descuenta lo que ya se le asignó en todo el plan.</P></InfoTip>
            </div>
            {candidates.length ? (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-50 text-[10.5px] font-black uppercase tracking-wider text-slate-500">
                    <tr><th className="px-3 py-2 text-left">Quién entrega</th><th className="px-2 py-2 text-center">Puede dar</th><th className="px-2 py-2 text-center">Le queda</th><th className="px-3 py-2 text-center">Asignado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((p) => {
                      const qty = assigned.get(p.key) ?? 0;
                      const left = leftOf(p.key);
                      return (
                        <tr key={p.key} className={qty > 0 ? "bg-teal-50/40" : ""}>
                          <td className="px-3 py-2">
                            <span className="block font-semibold text-slate-800">{p.kind === "warehouse" ? `Almacén · ${p.item.name}` : p.kind === "internal" ? `${siteLabel(ctx, p.item).split(" › ")[0]} · F01` : p.item.name}</span>
                            <span className="block text-[11px] text-slate-400">{p.kind === "warehouse" ? "almacén" : p.kind === "internal" ? "su farmacia principal" : `${p.item.microred || "—"}${p.item.microred === v.to.microred ? " · misma microred" : ""} · ${dec(p.item.months)} meses de stock`}</span>
                          </td>
                          <td className="px-2 py-2 text-center font-mono text-slate-600">{formatNumber(p.capacity)}</td>
                          <td className={`px-2 py-2 text-center font-mono ${left < 0 ? "font-bold text-red-600" : "text-slate-500"}`}>{formatNumber(left)}</td>
                          <td className="px-3 py-2 text-center"><PlanQty value={qty} max={Math.max(0, v.need - (v.covered - qty))} over={left < 0 && qty > 0} disabled={v.excluded} onChange={(n) => onQty(p.key, n)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-[12.5px] text-slate-500">Ningún establecimiento tiene excedente de este producto y el almacén no tiene stock.</p>
            )}
            {candidates.some((p) => leftOf(p.key) < 0 && (assigned.get(p.key) ?? 0) > 0) && <p className="mt-2 text-[12px] font-semibold text-red-600">Se asigna más de lo que le queda a alguien (en rojo). Baje esa cantidad.</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 md:px-5">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700"><input type="checkbox" checked={!v.excluded} onChange={(e) => onExcluded(!e.target.checked)} className="h-4 w-4 accent-teal-600" />Distribuir</label>
          {edited && <button type="button" onClick={onReset} className="ml-auto flex h-9 items-center gap-1.5 rounded-full border border-slate-200 px-3.5 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50"><RotateCcw className="h-4 w-4" />Volver a la sugerencia</button>}
        </div>
      </aside>
    </div>,
    document.body,
  );
};

/* ---------------------------------------------------------------- Almacén */

export const WarehouseReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const data = useMemo(() => warehouseReport(ctx.warehouse, ctx.report.items, ctx.subMax), [ctx.warehouse, ctx.report.items, ctx.subMax]);
  const [filter, setFilter] = useState<"NEED" | "ALL" | "NODEMAND" | "EXPIRY">("NEED");
  const soon = (r: WarehouseRow) => !!r.nearestExpiry && r.nearestExpiry.getTime() - ctx.asOf.getTime() < 183 * 86400000;
  const rows = data.rows.filter((r) => filter === "ALL" || (filter === "NEED" ? r.inNeed > 0 : filter === "EXPIRY" ? soon(r) : r.networkMonths === Infinity));
  if (!ctx.warehouse.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><EmptyState title="Sin almacén en el archivo" description="El TFORMDET no trae registros de almacén (códigos como 030S05)." /></div>;
  }
  const columns: Column<WarehouseRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} sub={r.item.code} /> },
    { key: "stock", label: "Stock", align: "right", sort: (r) => r.item.stock, firstDir: "desc", render: (r) => <span className="font-mono font-bold">{formatNumber(r.item.stock)}</span> },
    { key: "value", label: "Valor", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono">{money(r.value)}</span> },
    { key: "expiry", label: "Vence primero", sort: (r) => r.nearestExpiry?.getTime() ?? null, render: (r) => <span className={`whitespace-nowrap ${soon(r) ? "font-bold text-red-700" : "text-slate-600"}`}>{dateText(r.nearestExpiry)}</span> },
    { key: "inNeed", label: "Lo necesitan", align: "right", sort: (r) => r.inNeed, firstDir: "desc", render: (r) => (r.inNeed ? <span className="block leading-tight"><b className="font-mono text-slate-900">{r.inNeed}</b>{r.desabastecido > 0 && <span className="block text-[11px] text-red-600">{r.desabastecido} sin stock</span>}</span> : <span className="font-mono text-slate-300">0</span>) },
    { key: "coverage", label: "Cobertura", sort: (r) => r.coverage, firstDir: "desc", render: (r) => (r.inNeed ? <PctBar pct={r.coverage} color={r.coverage >= 100 ? "#10b981" : "#f59e0b"} text={`${Math.round(r.coverage)} %`} /> : <span className="text-slate-300">—</span>) },
    { key: "networkMonths", label: "Meses para la red", align: "right", sort: (r) => (Number.isFinite(r.networkMonths) ? r.networkMonths : 1e9), firstDir: "desc", render: (r) => <span className="font-mono">{Number.isFinite(r.networkMonths) ? dec(r.networkMonths) : "sin consumo"}</span> },
  ];
  const top = data.rows.filter((r) => r.inNeed > 0).slice(0, 10);
  const soonValue = data.rows.filter(soon).reduce((a, r) => a + r.value, 0);
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="info" icon={<Warehouse />} label="Stock en almacén" value={money(data.value)} hint={`${formatNumber(data.products)} productos al cierre del mes`} onClick={() => { setFilter("ALL"); toTable(); }} active={filter === "ALL"} />
        <KpiCard watermark tone="success" icon={<Repeat2 />} label="Puede cubrir faltantes" value={formatNumber(data.canCover)} hint="productos que algún establecimiento necesita" onClick={() => { setFilter("NEED"); toTable(); }} active={filter === "NEED"} />
        <KpiCard watermark tone="danger" icon={<CalendarClock />} label="Vence en 6 meses" value={money(soonValue)} hint={`${data.rows.filter(soon).length} productos`} onClick={() => { setFilter("EXPIRY"); toTable(); }} active={filter === "EXPIRY"} />
        <KpiCard watermark tone="neutral" label="Sin consumo en la red" value={formatNumber(data.withoutDemand)} hint="ningún establecimiento lo usa" onClick={() => { setFilter("NODEMAND"); toTable(); }} active={filter === "NODEMAND"} />
      </KpiStrip>
      <ChartCard title="Productos del almacén que más establecimientos necesitan" info={INFO.warehouse(ctx.subMax)}>
        <HBars
          labelWidth="w-44 md:w-80"
          rows={top.map((r) => ({ key: r.item.medCode, label: r.item.description, sub: `almacén ${formatNumber(r.item.stock)} · cubre ${Math.round(r.coverage)} %`, value: r.inNeed, color: r.coverage >= 100 ? "#10b981" : "#f59e0b", text: `${r.inNeed}` }))}
        />
      </ChartCard>
      <ReportTable
        anchorRef={anchor}
        title="Stock del almacén"
        info={INFO.warehouse(ctx.subMax)}
        rows={rows}
        columns={columns}
        excel={{ name: "Almacén", title: "Stock del almacén y cuánto cubre", subtitle: ctx.reportTitle, columns: [
          { header: "Almacén", width: 12, value: (r) => r.item.code }, ...xProduct((r: WarehouseRow) => r.item), { header: "Stock", width: 10, fmt: "int", value: (r) => r.item.stock },
          { header: "Valor", width: 12, fmt: "money", value: (r) => r.value }, { header: "Vence primero", width: 13, fmt: "date", value: (r) => r.nearestExpiry ?? "" }, { header: "Lo necesitan", width: 12, fmt: "int", value: (r) => r.inNeed },
          { header: "Desabastecidos", width: 13, fmt: "int", value: (r) => r.desabastecido }, { header: "Necesitan (unid.)", width: 13, fmt: "int", value: (r) => r.needUnits }, { header: "Cobertura", width: 11, fmt: "pct", value: (r) => (r.inNeed ? r.coverage / 100 : "") },
          { header: "Meses para la red", width: 13, fmt: "dec1", value: (r) => xNum(r.networkMonths) },
        ] }}
        rowKey={(r) => `${r.item.code}|${r.item.medCode}`}
        itemLabel="productos"
        searchOf={(r) => `${r.item.medCode} ${r.item.description}`}
        placeholder="Buscar producto o código…"
        minWidth={1050}
        card={(r) => (
          <>
            <ProductCell code={r.item.medCode} description={r.item.description} />
            <p className="mt-1.5 text-[12px] text-slate-600">Stock <b>{formatNumber(r.item.stock)}</b> · {money(r.value)} · vence {dateText(r.nearestExpiry)}</p>
            {r.inNeed > 0 && <p className="text-[12px] text-slate-600">Lo necesitan <b>{r.inNeed}</b> · cubre {Math.round(r.coverage)} %</p>}
          </>
        )}
      />
    </div>
  );
};
