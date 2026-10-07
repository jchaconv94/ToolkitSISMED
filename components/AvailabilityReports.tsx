import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, Boxes, Building2, CalendarClock, ChevronRight, PackageX, Repeat2, TrendingUp, Warehouse, X } from "lucide-react";
import { StockStatus } from "../types";
import type { DmeLevel } from "../services/stockStatus";
import { formatOneDecimal } from "../services/stockStatus";
import { formatNumber } from "../services/numberFormat";
import { STATUS_LABEL, monthLabel } from "../services/availabilityExport";
import {
  DME_LEVEL_LABEL, averageConsumption, type AvailabilityItem, type AvailabilityReport, type StatusCounts, type EstablishmentSummary, type LevelThresholds, type MicroredSummary, type WarehouseItem,
} from "../services/availabilityReport";
import {
  EXPIRY_BUCKETS, EXPIRY_BUCKET_LABEL, XYZ_LABEL, abcXyzReport, consumptionReport, lotRiskOf, lotRiskReport, overstockReport, productGapReport, redistributionReport, warehouseReport,
  type AbcProduct, type ClassifiedItem, type LotRiskRow, type OverstockRow, type PeakRow, type ProductGap, type TransferRow, type WarehouseRow,
} from "../services/availabilityInsights";
import { EmptyState, KpiCard, KpiStrip, SortButton, TableSearch, ariaSort, useTableSort, type Tone } from "./ui/kit";
import { TablePagination } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { useIsDesktop } from "./ui/useIsDesktop";
import { BottomSheet } from "./ui/BottomSheet";
import { FloatingTableHead, headAlignClass, tableHeadCellClass, tableHeadTextClass, useFloatingTableHead, type HeadAlign } from "./ui/FloatingTableHead";
import {
  ChartCard, Donut, Gauge, HBars, InfoTip, LEVEL_COLOR, LevelColumns, MonthlyBars, RankingChart, STATUS_COLOR, Sparkline, StackBar, TipBox, useChartTip,
} from "./AvailabilityCharts";

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
  today: Date;
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
}

export type ReportTab = "summary" | "establishments" | "gaps" | "expiry" | "consumption" | "abc" | "overstock" | "redistribution" | "warehouse";

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

/** Qué es una farmacia de un establecimiento: F01 es la principal; las demás, según el registro. */
export const pharmacyKind = (code: string, type?: string): string | null => {
  if (!/F\d{2}$/i.test(code)) return null;
  if (/F01$/i.test(code)) return "Principal";
  if (type === "PUESTO_COMUNAL") return "Puesto comunal";
  if (type === "FARMACIA") return "Farmacia";
  return null;
};
const KindChip: React.FC<{ kind: string | null }> = ({ kind }) =>
  kind ? <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${kind === "Principal" ? "bg-teal-50 text-teal-700" : "bg-cyan-50 text-cyan-700"}`}>{kind}</span> : null;

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

/**
 * Tabla de un reporte: buscador y filtros arriba; en escritorio, encabezado fijo, orden por
 * columnas y paginación; en el celular, tarjetas que cargan al bajar.
 */
/**
 * Alineación de todas las tablas de reportes (pedido del usuario, 2026-10-07): los nombres
 * (producto, establecimiento, microred, quién entrega/recibe) a la izquierda; todo lo demás
 * —números, códigos, fechas, estados, barras— centrado en su columna.
 */
const TEXT_COLUMNS = new Set(["description", "name", "microred", "from", "to"]);
const alignOf = (key: string): HeadAlign => (TEXT_COLUMNS.has(key) ? "left" : "center");

export function ReportTable<T>({ title, info, rows, columns, rowKey, card, onRowClick, itemLabel, searchOf, placeholder, toolbar, minWidth = 900, subRows, subLabel = "subregistros", anchorRef }: {
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
                      <tr onClick={onRowClick ? () => onRowClick(row, sorted) : undefined} className={`h-14 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""} ${open ? "bg-teal-50/40" : ""}`}>
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
                        <tr key={rowKey(kid)} onClick={onRowClick ? () => onRowClick(kid, kids!) : undefined} className={`h-12 bg-slate-50/70 ${onRowClick ? "cursor-pointer hover:bg-teal-50/60" : ""}`}>
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
              <div key={key} className="rounded-2xl border border-slate-200 bg-white">
                <div onClick={onRowClick ? () => onRowClick(row, sorted) : undefined} className={`p-3.5 ${onRowClick ? "cursor-pointer active:bg-slate-50" : ""}`}>
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
                          <div key={rowKey(kid)} onClick={onRowClick ? () => onRowClick(kid, kids!) : undefined} className="rounded-xl border border-slate-200 bg-white p-3 active:bg-slate-50">{card(kid)}</div>
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
export function Pills<V extends string>({ value, options, onChange }: { value: V; options: Array<{ value: V; label: string; count?: number }>; onChange: (v: V) => void }) {
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
      <P>Cada lote se revisa por separado. Los lotes se usan del que vence primero al último, al ritmo del consumo promedio mensual (CPA). En un establecimiento con farmacias o puestos comunales, cada uno con sus propios lotes y su propio CPA.</P>
      <P>Lo que no alcanza a usarse antes de su fecha de vencimiento queda en riesgo, y se valoriza a su precio.</P>
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
      <P>Para cada establecimiento desabastecido o en substock (con consumo), busca otro que tenga el mismo producto con excedente (más de {sobreMin} meses), primero en la misma microred.</P>
      <P>La cantidad es lo justo para llegar a {subMax} meses de consumo, sin dejar al que entrega por debajo de {sobreMin} meses.</P>
    </>
  ),
  gaps: (subMax: number) => (
    <>
      <P>Por cada producto: en cuántos establecimientos está desabastecido o con menos de {subMax} meses de stock.</P>
      <P><b>Les sobra:</b> cuántos establecimientos tienen ese producto en sobrestock (más de lo que usan en 6 meses) y podrían pasar una parte a donde falta.</P>
      <P><b>Almacén:</b> el stock del almacén al cierre del mes.</P>
      <P><b>Se pueden cubrir:</b> productos desabastecidos que tienen de dónde sacarse: algún establecimiento al que le sobra o stock en el almacén.</P>
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
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(report.items), ctx.today), [ctx.byPharmacy, report.items, ctx.today]);
  const over = useMemo(() => overstockReport(report.items, ctx.sobreMin), [report.items, ctx.sobreMin]);
  const redis = useMemo(() => redistributionReport(report.items, ctx.subMax, ctx.sobreMin), [report.items, ctx.subMax, ctx.sobreMin]);
  const wh = useMemo(() => warehouseReport(ctx.warehouse, report.items, ctx.subMax), [ctx.warehouse, report.items, ctx.subMax]);
  const c = report.counts;
  const ranges: Record<DmeLevel, string> = { OPTIMO: `≥ ${lv.optimo} %`, ALTO: `${lv.alto} – ${lv.optimo} %`, REGULAR: `${lv.regular} – ${lv.alto} %`, BAJO: `< ${lv.regular} %` };
  const mrRows = [...report.microredes].sort((a, b) => b.pct - a.pct);
  const alerts: Array<{ tab: ReportTab; icon: React.ReactNode; tone: string; label: string; value: string; hint: string }> = [
    { tab: "expiry", icon: <CalendarClock className="h-5 w-5" />, tone: "bg-red-50 text-red-600", label: "Vence sin usarse en 12 meses", value: money(risk.urgentValue), hint: `${formatNumber(risk.urgentLots)} lotes` },
    { tab: "overstock", icon: <PackageX className="h-5 w-5" />, tone: "bg-blue-50 text-blue-600", label: "Sobrestock inmovilizado", value: money(over.value), hint: `${formatNumber(over.rows.length)} productos` },
    { tab: "redistribution", icon: <Repeat2 className="h-5 w-5" />, tone: "bg-teal-50 text-teal-700", label: "Redistribuciones sugeridas", value: formatNumber(redis.rows.length), hint: `${formatNumber(redis.covered)} cubren un desabastecido` },
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
      options={[{ value: "ALL", label: "Todos" }, ...LEVELS.map((l) => ({ value: l, label: DME_LEVEL_LABEL[l], count: view === "eess" ? levelCounts[l] : undefined }))]}
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
  return view === "eess" ? (
    <ReportTable
      rows={eess}
      minWidth={1150}
      subRows={(r) => pharmaciesOf.get(r.code)}
      subLabel="farmacias y puestos"
      columns={eessColumns}
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
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(items), ctx.today), [ctx.byPharmacy, items, ctx.today]);
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

/** Arma la navegación anterior/siguiente de un panel sobre la lista de la tabla de donde se abrió. */
export function drawerNav<T>(current: T, list: T[], open: (item: T) => void): DrawerNav | undefined {
  const index = list.indexOf(current);
  if (index < 0 || list.length < 2) return undefined;
  return { index, total: list.length, prev: () => index > 0 && open(list[index - 1]), next: () => index < list.length - 1 && open(list[index + 1]) };
}

/** Teclas del panel: Esc cierra; ← y → pasan al registro anterior o siguiente (no mientras se escribe). */
const useDrawerKeys = (active: boolean, onClose: () => void, nav?: DrawerNav) => {
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

export const ProductDrawer: React.FC<{ ctx: ReportContext; item: AvailabilityItem | null; onClose: () => void; nav?: DrawerNav }> = ({ ctx, item, onClose, nav }) => {
  useDrawerKeys(!!item, onClose, nav);
  if (!item) return null;
  // Los lotes de un establecimiento con farmacias se muestran y evalúan por farmacia.
  const sites = ctx.byPharmacy([item]);
  const bySite = sites.length > 1 || sites[0] !== item;
  const lotRows = sites.flatMap((site) => {
    const risk = new Map(lotRiskOf(site, ctx.today).map((r) => [r.lot, r]));
    return site.lots.map((lot) => ({ site, lot, risk: risk.get(lot) }));
  }).sort((a, b) => (a.lot.expiry?.getTime() ?? Infinity) - (b.lot.expiry?.getTime() ?? Infinity));
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
            {stat("Meses", dec(item.months))}
            {stat("Precio", item.price ? `S/ ${formatNumber(item.price, 2)}` : "—")}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">Consumo mensual</h4>
              <InfoTip title="Consumo mensual"><P>Unidades consumidas cada mes. La línea punteada es el CPA: el promedio de los meses con consumo. En rojo, el mes (o los meses) de mayor consumo.</P></InfoTip>
            </div>
            <MonthlyBars values={item.consumption} labels={ctx.months.map(monthShort)} cpa={item.cpa} highlight={peakMonths} height={190} />
          </div>
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
                    <tr>{bySite && <th className="px-3 py-2 text-left">Farmacia</th>}<th className="px-3 py-2 text-center">Lote</th><th className="px-3 py-2 text-center">Vence</th><th className="px-3 py-2 text-center">Saldo</th><th className="px-3 py-2 text-center">Se usa</th><th className="px-3 py-2 text-center">En riesgo</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lotRows.map(({ site, lot: l, risk: r }, i) => {
                      return (
                        <tr key={i} className={r ? "bg-red-50/50" : ""}>
                          {bySite && (
                            <td className="max-w-[150px] px-3 py-2" title={`${site.code} · ${site.name} · CPA ${dec(site.cpa)}`}>
                              <span className="block font-mono text-[11px] font-bold text-slate-500">{site.code.length > 5 ? site.code.slice(5) : site.code}</span>
                              <span className="block truncate text-[11.5px] text-slate-600">{site.name}</span>
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
              <h4 className="mb-2 text-[11.5px] font-black uppercase tracking-wider text-slate-500">En otros establecimientos</h4>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {others.slice(0, 12).map((o) => (
                  <div key={o.code} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{o.name}<span className="ml-1.5 font-normal text-slate-400">{o.microred}</span></span>
                    <span className="font-mono text-slate-600">{formatNumber(o.stock)} u · {dec(o.months)} m</span>
                    <StatusPill status={o.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

/* ---------------------------------------------------------------- ¿Dónde falta? */

export const GapsReport: React.FC<{ ctx: ReportContext; onProduct: (g: ProductGap, list?: ProductGap[]) => void }> = ({ ctx, onProduct }) => {
  const { anchor, toTable } = useTableAnchor();
  const products = useMemo(() => productGapReport(ctx.report.items, ctx.warehouse), [ctx.report.items, ctx.warehouse]);
  const [filter, setFilter] = useState<"ALL" | "DESAB" | "WIDE" | "DONOR" | "COVER">("DESAB");
  const withDesab = products.filter((p) => p.desabastecido > 0);
  const solvable = withDesab.filter((p) => p.donors > 0 || p.warehouseStock > 0);
  const n = ctx.report.establishments.length;
  const wide = withDesab.filter((p) => p.desabastecido >= Math.max(2, n * 0.25));
  const donorsDesab = withDesab.filter((p) => p.donors > 0);
  // Los indicadores y las pastillas filtran lo mismo, y siempre sobre los productos desabastecidos.
  const byFilter = { ALL: products, DESAB: withDesab, WIDE: wide, DONOR: donorsDesab, COVER: solvable };
  const rows = byFilter[filter];
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
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="danger" icon={<PackageX />} label="Productos desabastecidos" value={formatNumber(withDesab.length)} hint="faltan en al menos un establecimiento" onClick={() => { setFilter("DESAB"); toTable(); }} active={filter === "DESAB"} />
        <KpiCard watermark tone="warning" icon={<Building2 />} label="Faltan en muchos" value={formatNumber(wide.length)} hint="en 1 de cada 4 establecimientos o más" onClick={() => { setFilter("WIDE"); toTable(); }} active={filter === "WIDE"} />
        <KpiCard watermark tone="info" icon={<Repeat2 />} label="A otro le sobra" value={formatNumber(donorsDesab.length)} hint="otro establecimiento tiene de más y puede pasarlo" onClick={() => { setFilter("DONOR"); toTable(); }} active={filter === "DONOR"} />
        <KpiCard watermark tone="success" icon={<Warehouse />} label="Se pueden cubrir" value={formatNumber(solvable.length)} hint="con lo que le sobra a otro o con el almacén" onClick={() => { setFilter("COVER"); toTable(); }} active={filter === "COVER"} />
      </KpiStrip>
      <ChartCard title="Productos que faltan en más establecimientos" info={INFO.gaps(ctx.subMax)}>
        <HBars
          labelWidth="w-44 md:w-80"
          rows={withDesab.slice(0, 12).map((p) => ({ key: p.medCode, label: p.description, sub: p.donors || p.warehouseStock ? `a ${p.donors} les sobra · almacén ${formatNumber(p.warehouseStock)}` : "a ningún establecimiento le sobra · sin almacén", value: p.desabastecido, color: STATUS_COLOR[StockStatus.DESABASTECIDO], text: `${p.desabastecido} de ${p.establishments}` }))}
          onSelect={(k) => { const p = products.find((x) => x.medCode === k); if (p) onProduct(p); }}
        />
      </ChartCard>
      <ReportTable
        anchorRef={anchor}
        title="Productos"
        info={INFO.gaps(ctx.subMax)}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.medCode}
        itemLabel="productos"
        searchOf={(r) => `${r.medCode} ${r.description}`}
        placeholder="Buscar producto o código…"
        onRowClick={(r, rows) => onProduct(r, rows)}
        toolbar={<Pills value={filter} onChange={setFilter} options={[{ value: "DESAB", label: "Desabastecidos", count: withDesab.length }, { value: "WIDE", label: "Faltan en muchos", count: wide.length }, { value: "DONOR", label: "A otro le sobra", count: donorsDesab.length }, { value: "COVER", label: "Se pueden cubrir", count: solvable.length }, { value: "ALL", label: "Todos", count: products.length }]} />}
        card={(p) => (
          <>
            <ProductCell code={p.medCode} description={p.description} />
            <StackBar parts={statusParts(p)} className="mt-2 h-2 w-full" />
            <p className="mt-1.5 text-[12px] text-slate-500"><b className="text-red-600">{p.desabastecido}</b> desab. · {p.substock} sub · de {p.establishments} · a <b className="text-blue-700">{p.donors}</b> les sobra · almacén {formatNumber(p.warehouseStock)}</p>
          </>
        )}
      />
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
  const risk = useMemo(() => lotRiskReport(ctx.byPharmacy(ctx.report.items), ctx.today), [ctx.byPharmacy, ctx.report.items, ctx.today]);
  const [bucket, setBucket] = useState<"URGENT" | "ALL" | "NOUSE" | (typeof EXPIRY_BUCKETS)[number]>("URGENT");
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
  const rows = risk.rows.filter((r) => bucket === "ALL" || (bucket === "URGENT" ? r.bucket !== "LATER" : bucket === "NOUSE" ? r.item.cpa <= 0 : r.bucket === bucket));
  const bucketColor: Record<string, string> = { EXPIRED: "#7f1d1d", M3: "#dc2626", M6: "#f97316", M12: "#f59e0b", LATER: "#94a3b8" };
  const whereOf = (it: AvailabilityItem) => {
    if (it.code === it.ipressCode) return it.name;
    const parent = ctx.report.establishments.find((x) => x.code === it.ipressCode)?.name;
    return `${parent ?? it.ipressCode} › ${it.code.slice(5)} ${it.name}`;
  };
  const columns: Column<LotRiskRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.item.description, render: (r) => <ProductCell code={r.item.medCode} description={r.item.description} sub={whereOf(r.item)} /> },
    { key: "lot", label: "Lote", render: (r) => <span className="font-mono text-[12px]">{r.lot.lot || "—"}</span> },
    { key: "expiry", label: "Vence", sort: (r) => r.lot.expiry?.getTime() ?? null, render: (r) => <span className="whitespace-nowrap">{dateText(r.lot.expiry)}<span className="block text-[11px] text-slate-400">{r.bucket === "EXPIRED" ? "vencido" : `en ${dec(r.monthsToExpiry)} meses`}</span></span> },
    { key: "balance", label: "Saldo", align: "right", sort: (r) => r.lot.balance, firstDir: "desc", render: (r) => <span className="font-mono">{formatNumber(r.lot.balance)}</span> },
    { key: "cpa", label: "CPA", align: "right", sort: (r) => r.item.cpa, render: (r) => <span className="font-mono">{dec(r.item.cpa)}</span> },
    { key: "usable", label: "Se usa", align: "right", render: (r) => <span className="font-mono text-slate-500">{formatNumber(r.usable)}</span> },
    { key: "atRisk", label: "En riesgo", align: "right", sort: (r) => r.atRisk, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-red-700">{formatNumber(r.atRisk)}</span> },
    { key: "value", label: "Valor", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono font-bold text-slate-900">{money(r.value)}</span> },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="danger" icon={<CalendarClock />} label="Vence sin usarse en 12 meses" value={money(risk.urgentValue)} hint={`${formatNumber(risk.urgentLots)} lotes`} onClick={() => { setBucket("URGENT"); toTable(); }} active={bucket === "URGENT"} />
        <KpiCard watermark tone="danger" label="En los próximos 3 meses" value={money(risk.byBucket.M3.value + risk.byBucket.EXPIRED.value)} hint={`${risk.byBucket.M3.lots + risk.byBucket.EXPIRED.lots} lotes, incluye vencidos`} onClick={() => { setBucket("M3"); toTable(); }} active={bucket === "M3"} />
        <KpiCard watermark tone="neutral" label="De productos sin consumo" value={money(risk.noUseValue)} hint={`${formatNumber(risk.noUseLots)} lotes sin rotación`} onClick={() => { setBucket("NOUSE"); toTable(); }} active={bucket === "NOUSE"} />
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
        rowKey={(r) => `${r.item.code}|${r.item.medCode}|${r.lot.lot}|${r.lot.expiry?.getTime()}`}
        itemLabel="lotes"
        searchOf={(r) => `${r.item.medCode} ${r.item.description} ${whereOf(r.item)} ${r.lot.lot}`}
        placeholder="Buscar producto, lote o establecimiento…"
        onRowClick={(r, rows) => ctx.openProduct(r.item, rows.map((x) => x.item))}
        minWidth={1050}
        toolbar={<Pills value={bucket} onChange={setBucket} options={[{ value: "URGENT", label: "12 meses" }, ...EXPIRY_BUCKETS.map((b) => ({ value: b, label: EXPIRY_BUCKET_LABEL[b], count: risk.byBucket[b].lots })), { value: "NOUSE", label: "Sin consumo" }, { value: "ALL", label: "Todos" }]} />}
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
  const redis = useMemo(() => redistributionReport(ctx.report.items, ctx.subMax, ctx.sobreMin), [ctx.report.items, ctx.subMax, ctx.sobreMin]);
  const movable = redis.rows.reduce((a, r) => a + r.quantity * (r.from.price || 0), 0);
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
        <KpiCard watermark tone="info" icon={<PackageX />} label="Dinero inmovilizado" value={money(data.value)} hint={`excedente sobre ${ctx.sobreMin} meses de consumo`} />
        <KpiCard watermark tone="info" label="Productos con excedente" value={formatNumber(data.rows.length)} hint={`${formatNumber(data.units)} unidades de más`} />
        <KpiCard watermark tone="success" icon={<Repeat2 />} label="Se puede mover a donde falta" value={money(movable)} hint={`${formatNumber(redis.rows.length)} redistribuciones`} onClick={() => ctx.goTab("redistribution")} />
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

export const RedistributionReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const data = useMemo(() => redistributionReport(ctx.report.items, ctx.subMax, ctx.sobreMin), [ctx.report.items, ctx.subMax, ctx.sobreMin]);
  const [filter, setFilter] = useState<"ALL" | "DESAB" | "SAME">("ALL");
  const rows = data.rows.filter((r) => filter === "ALL" || (filter === "DESAB" ? r.to.status === StockStatus.DESABASTECIDO : r.sameMicrored));
  const byDonor = useMemo(() => {
    const m = new Map<string, { name: string; n: number; value: number }>();
    for (const r of data.rows) { const e = m.get(r.from.code) || { name: r.from.name, n: 0, value: 0 }; e.n++; e.value += r.value; m.set(r.from.code, e); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [data]);
  const byReceiver = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of data.rows) { const e = m.get(r.to.code) || { name: r.to.name, n: 0 }; e.n++; m.set(r.to.code, e); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [data]);
  const columns: Column<TransferRow>[] = [
    { key: "description", label: "Producto", sort: (r) => r.to.description, render: (r) => <ProductCell code={r.to.medCode} description={r.to.description} /> },
    { key: "from", label: "Entrega", sort: (r) => r.from.name, render: (r) => <span className="block max-w-[220px]"><span className="block truncate font-semibold text-slate-800">{r.from.name}</span><span className="block text-[11.5px] text-blue-700">{formatNumber(r.from.stock)} u · {dec(r.from.months)} meses</span></span> },
    { key: "arrow", label: "", render: () => <ArrowRight className="h-4 w-4 text-slate-300" /> },
    { key: "to", label: "Recibe", sort: (r) => r.to.name, render: (r) => <span className="block max-w-[220px]"><span className="block truncate font-semibold text-slate-800">{r.to.name}</span><span className="block text-[11.5px] text-slate-500">{formatNumber(r.to.stock)} u · CPA {dec(r.to.cpa)}</span></span> },
    { key: "status", label: "Situación", sort: (r) => STATUS_ORDER.indexOf(r.to.status), render: (r) => <StatusPill status={r.to.status} /> },
    { key: "quantity", label: "Cantidad", align: "right", sort: (r) => r.quantity, firstDir: "desc", render: (r) => <span className="font-mono text-[14px] font-black text-teal-700">{formatNumber(r.quantity)}</span> },
    { key: "same", label: "Microred", sort: (r) => Number(r.sameMicrored), render: (r) => <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${r.sameMicrored ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{r.sameMicrored ? "Misma" : "Otra"}</span> },
    { key: "value", label: "Valor", align: "right", sort: (r) => r.value, firstDir: "desc", render: (r) => <span className="font-mono">{money(r.value)}</span> },
  ];
  return (
    <div className="space-y-4">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="info" icon={<Repeat2 />} label="Redistribuciones sugeridas" value={formatNumber(data.rows.length)} hint="de excedente a donde falta" onClick={() => { setFilter("ALL"); toTable(); }} active={filter === "ALL"} />
        <KpiCard watermark tone="danger" icon={<PackageX />} label="Cubren un desabastecido" value={formatNumber(data.covered)} hint="el que recibe tiene stock 0" onClick={() => { setFilter("DESAB"); toTable(); }} active={filter === "DESAB"} />
        <KpiCard watermark tone="success" icon={<Building2 />} label="Dentro de la misma microred" value={formatNumber(data.sameMicrored)} hint={`${pctText(data.rows.length ? (data.sameMicrored / data.rows.length) * 100 : 0)} del total`} onClick={() => { setFilter("SAME"); toTable(); }} active={filter === "SAME"} />
        <KpiCard watermark tone="neutral" label="Valor a mover" value={money(data.value)} hint="a precio del producto" />
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Quién entrega más" info={INFO.redistribution(ctx.subMax, ctx.sobreMin)}>
          <HBars labelWidth="w-36 md:w-56" rows={byDonor.map(([code, e]) => ({ key: code, label: e.name, value: e.n, color: "#3b82f6", text: `${e.n}` }))} onSelect={ctx.openEstablishment} />
        </ChartCard>
        <ChartCard title="Quién recibe más">
          <HBars labelWidth="w-36 md:w-56" rows={byReceiver.map(([code, e]) => ({ key: code, label: e.name, value: e.n, color: "#0d9488", text: `${e.n}` }))} onSelect={ctx.openEstablishment} />
        </ChartCard>
      </div>
      <ReportTable
        anchorRef={anchor}
        title="Sugerencias"
        info={INFO.redistribution(ctx.subMax, ctx.sobreMin)}
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.from.code}|${r.to.code}|${r.to.medCode}`}
        itemLabel="sugerencias"
        searchOf={(r) => `${r.to.medCode} ${r.to.description} ${r.from.name} ${r.to.name}`}
        placeholder="Buscar producto o establecimiento…"
        onRowClick={(r, rows) => ctx.openProduct(r.to, rows.map((x) => x.to))}
        minWidth={1100}
        card={(r) => (
          <>
            <ProductCell code={r.to.medCode} description={r.to.description} />
            <div className="mt-2 flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{r.from.name}</span>
              <span className="flex shrink-0 items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 font-mono font-black text-teal-700">{formatNumber(r.quantity)}<ArrowRight className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1 truncate text-right font-semibold text-slate-700">{r.to.name}</span>
            </div>
          </>
        )}
      />
    </div>
  );
};

/* ---------------------------------------------------------------- Almacén */

export const WarehouseReport: React.FC<{ ctx: ReportContext }> = ({ ctx }) => {
  const { anchor, toTable } = useTableAnchor();
  const data = useMemo(() => warehouseReport(ctx.warehouse, ctx.report.items, ctx.subMax), [ctx.warehouse, ctx.report.items, ctx.subMax]);
  const [filter, setFilter] = useState<"NEED" | "ALL" | "NODEMAND" | "EXPIRY">("NEED");
  const soon = (r: WarehouseRow) => !!r.nearestExpiry && r.nearestExpiry.getTime() - ctx.today.getTime() < 183 * 86400000;
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
