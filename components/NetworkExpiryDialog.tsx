import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Clock, Download, Package, Wallet } from "lucide-react";
import { saveAs } from "file-saver";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { EmptyState, KpiCard, SortButton, StatusChip, TableSearch, ariaSort, useTableSort } from "./ui/kit";
import { FloatingTableHead, headAlignClass, tableHeadCellClass, tableHeadTextClass, useFloatingTableHead, type HeadAlign } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { useIsDesktop } from "./ui/useIsDesktop";
import { formatNumber } from "../services/numberFormat";
import {
  describeExpiryDays,
  filterNetworkExpiry,
  groupExpiryByProduct,
  type ExpiryFilter,
  type ExpiryProduct,
  type ExpiryProductLot,
  type NetworkExpiry,
} from "../services/networkExpiry";
import { buildNetworkExpiryWorkbook, networkExpiryFileName } from "../services/networkExpiryExport";

/**
 * Vencimientos de la red (Consulta Stock, pedido del usuario del 2026-10-27).
 *
 * Una fila por producto con sus totales en la red; al tocarlo, **la misma ventana** pasa a su
 * detalle: cada lote y en qué establecimiento está, con «← Volver» y ‹ › (o las flechas del
 * teclado) para pasar al producto anterior o siguiente. Nada de filas que se despliegan hacia
 * abajo ni de ventana sobre ventana (decisión del usuario; Nielsen Norman Group desaconseja
 * apilar ventanas). Las cifras son las de la tabla de establecimientos (`services/networkExpiry.ts`).
 */

/** Soles siempre con dos decimales: «S/ 2 141,25», «S/ 532,50». */
const money = (value: number) => {
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  return `${value < 0 ? "-" : ""}S/ ${formatNumber(Number(whole))},${cents}`;
};
const day = (date: Date) => date.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;
const daysTone = (status: "expired" | "expiring", days: number) => (status === "expired" ? "text-rose-600" : days <= 30 ? "text-amber-600" : "text-slate-500");
/** La farmacia o el puesto del lote; nada si es la del propio establecimiento (su código). */
const pharmacyLabel = (lot: ExpiryProductLot) => lot.pharmacyName || (lot.pharmacy && lot.pharmacy !== lot.siteCode ? lot.pharmacy : "");

const EMPTY: NetworkExpiry = { sites: [], expiredLots: 0, expiringLots: 0, expiredValue: 0, expiringValue: 0, expiredSites: 0, expiringSites: 0, sitesWithoutData: 0 };

const FILTERS: { value: ExpiryFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "expired", label: "Vencidos" },
  { value: "expiring", label: "Por vencer" },
];

type ListSortKey = "name" | "sites" | "expired" | "expiring" | "balance" | "value" | "first";

const LIST_COLUMNS: HeadColumn<ListSortKey>[] = [
  { key: "name", label: "Producto" },
  { key: "sites", label: "EESS", align: "center", fit: true, title: "Establecimientos de salud con el producto vencido o por vencer" },
  { key: "expired", label: "Vencidos", align: "center", fit: true },
  { key: "expiring", label: "Por vencer", align: "center", fit: true },
  { key: "balance", label: "Stock", align: "center", fit: true },
  { key: "value", label: "Valor", align: "center", fit: true },
  { key: "first", label: "Vence primero", align: "center", fit: true },
];

const CodeChip: React.FC<{ code: string }> = ({ code }) =>
  code ? <span className="inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{code}</span> : null;

const CountChip: React.FC<{ value: number; tone: "danger" | "warning" }> = ({ value, tone }) =>
  value > 0 ? <StatusChip tone={tone} label={formatNumber(value)} /> : <span className="text-slate-300">0</span>;

const ExpiryCell: React.FC<{ date: Date; days: number; status: "expired" | "expiring" }> = ({ date, days, status }) => (
  <div className="whitespace-nowrap">
    <p className="text-[13px] font-semibold text-slate-800">{day(date)}</p>
    <p className={`text-[11px] font-semibold ${daysTone(status, days)}`}>{describeExpiryDays(days)}</p>
  </div>
);

/**
 * Columna de las tablas de la ventana. `fit`: del ancho justo de su contenido, en una línea,
 * para que el nombre (producto o establecimiento) se quede con el resto del ancho.
 */
type HeadColumn<K extends string> = { key: K; label: string; align?: HeadAlign; fit?: boolean; title?: string };

/**
 * Cabecera de una tabla de la ventana con su franja que se queda arriba al bajar
 * (`FloatingTableHead`, como en las demás tablas: nada de `sticky` en el `<thead>`).
 */
const TableHead = <K extends string>({
  columns,
  headSort,
  floating,
  trailing,
}: {
  columns: HeadColumn<K>[];
  headSort: (key: K) => { dir: "asc" | "desc" | null; onSort: () => void };
  floating: ReturnType<typeof useFloatingTableHead>["floating"];
  /** Columna final sin título (la flecha de la fila). */
  trailing?: string;
}) => {
  const content = (column: HeadColumn<K>) => {
    const sort = headSort(column.key);
    return <SortButton label={column.label} dir={sort.dir} onClick={sort.onSort} />;
  };
  return (
    <>
      <FloatingTableHead state={floating} padding="px-3" cells={columns.map((column, index) => ({ key: column.key, index, align: column.align, content: content(column) }))} />
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              title={column.title}
              aria-sort={ariaSort(headSort(column.key).dir)}
              className={`py-3 ${column.fit ? "w-px whitespace-nowrap px-3" : "px-4"} ${tableHeadCellClass} ${tableHeadTextClass} ${headAlignClass(column.align)}`}
            >
              {content(column)}
            </th>
          ))}
          {trailing !== undefined && <th className={`w-10 ${tableHeadCellClass}`} aria-label={trailing} />}
        </tr>
      </thead>
    </>
  );
};

/** Detalle de un producto: sus lotes en toda la red y en qué establecimiento está cada uno. */
const ProductDetail: React.FC<{ product: ExpiryProduct; isDesktop: boolean }> = ({ product, isDesktop }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("vencimientos-producto", 10);
  const { sorted, headSort } = useTableSort(
    product.lots,
    {
      site: (lot) => lot.siteName,
      pharmacy: (lot) => pharmacyLabel(lot),
      lot: (lot) => lot.lot,
      expiry: (lot) => lot.expiry.getTime(),
      status: (lot) => (lot.status === "expired" ? 0 : 1),
      balance: (lot) => lot.balance,
      value: (lot) => lot.value,
    },
    { firstDir: { balance: "desc", value: "desc" } },
  );
  const mobile = useIncrementalCount(sorted.length, product.key, 20);
  useEffect(() => setPage(1), [product.key]);
  // Farmacia solo si algún lote está en una farmacia o puesto distinto de su establecimiento.
  const showPharmacy = product.lots.some((lot) => pharmacyLabel(lot));
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);
  const { tableRef, floating } = useFloatingTableHead([product.key, page, pageSize, isDesktop, sorted]);
  const columns: HeadColumn<"site" | "pharmacy" | "lot" | "expiry" | "status" | "balance" | "value">[] = [
    { key: "site", label: "Establecimiento" },
    ...(showPharmacy ? [{ key: "pharmacy" as const, label: "Farmacia" }] : []),
    { key: "lot", label: "Lote", align: "center", fit: true },
    { key: "expiry", label: "Vence", align: "center", fit: true },
    { key: "status", label: "Situación", align: "center", fit: true },
    { key: "balance", label: "Saldo", align: "center", fit: true },
    { key: "value", label: "Valor", align: "center", fit: true },
  ];

  return (
    <div className="space-y-4">
      {/* En el celular la cabecera corta el nombre: aquí va completo. */}
      <div className="md:hidden">
        <p className="text-[15px] font-black leading-snug text-slate-900">{product.name || "Producto sin nombre"}</p>
        <CodeChip code={product.code} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard watermark tone="danger" icon={<AlertTriangle />} label="Vencidos" value={plural(product.expiredLots, "lote", "lotes")} hint={money(product.expiredValue)} />
        <KpiCard watermark tone="warning" icon={<Clock />} label="Por vencer" value={plural(product.expiringLots, "lote", "lotes")} hint={money(product.expiringValue)} />
        <KpiCard watermark tone="info" icon={<Package />} label="Stock" value={formatNumber(product.balance, 3)} hint={`en ${plural(product.sites, "establecimiento", "establecimientos")}`} />
        <KpiCard watermark tone="neutral" icon={<Wallet />} label="Valor" value={money(product.expiredValue + product.expiringValue)} hint="vencido y por vencer" />
      </div>

      {isDesktop ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table ref={tableRef} className="w-full text-left text-sm">
            <TableHead columns={columns} headSort={headSort} floating={floating} />
            <tbody>
              {rows.map((lot, index) => (
                <tr key={`${lot.siteId}-${lot.lot}-${lot.pharmacy}-${index}`} className="h-14 border-t border-slate-100">
                  <td className="px-4 py-2">
                    <p className="text-[13.5px] font-bold text-slate-900">{lot.siteName}</p>
                    {lot.siteCode && <p className="font-mono text-[11px] text-slate-500">{lot.siteCode}</p>}
                  </td>
                  {showPharmacy && <td className="px-4 py-2 text-xs text-slate-600">{pharmacyLabel(lot) || "—"}</td>}
                  <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-slate-700">{lot.lot || "—"}</td>
                  <td className="px-3 py-2 text-center"><ExpiryCell date={lot.expiry} days={lot.days} status={lot.status} /></td>
                  <td className="px-3 py-2 text-center">
                    <StatusChip tone={lot.status === "expired" ? "danger" : "warning"} label={lot.status === "expired" ? "Vencido" : "Por vencer"} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{formatNumber(lot.balance, 3)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] text-slate-700">{lot.value > 0 ? money(lot.value) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="lotes" />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((lot, index) => (
            <div key={`${lot.siteId}-${lot.lot}-${lot.pharmacy}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-slate-900">{lot.siteName}</p>
                  {lot.siteCode && <p className="font-mono text-[11px] text-slate-500">{lot.siteCode}</p>}
                </div>
                <StatusChip tone={lot.status === "expired" ? "danger" : "warning"} label={lot.status === "expired" ? "Vencido" : "Por vencer"} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">Lote <b className="font-mono text-slate-700">{lot.lot || "—"}</b></span>
                <span className="text-right text-slate-500">Vence <b className="text-slate-700">{day(lot.expiry)}</b></span>
                <span className="text-slate-500">Stock <b className="text-slate-700">{formatNumber(lot.balance, 3)}</b></span>
                <span className={`text-right font-semibold ${daysTone(lot.status, lot.days)}`}>{describeExpiryDays(lot.days)}</span>
                {showPharmacy && pharmacyLabel(lot) && <span className="col-span-2 text-slate-500">Farmacia <b className="text-slate-700">{pharmacyLabel(lot)}</b></span>}
                {lot.value > 0 && <span className="col-span-2 text-slate-500">Valor <b className="text-slate-700">{money(lot.value)}</b></span>}
              </div>
            </div>
          ))}
          <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="lotes" />
        </div>
      )}
    </div>
  );
};

export const NetworkExpiryDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  /** UNGET o red, para el título y el Excel. */
  scope: string;
  data: NetworkExpiry | null;
  windowDays: number;
  canExport: boolean;
}> = ({ open, onClose, scope, data, windowDays, canExport }) => {
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<ExpiryFilter>("all");
  const [query, setQuery] = useState("");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("vencimientos-red", 10);
  const [exporting, setExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);

  useEffect(() => {
    if (open) return;
    setFilter("all");
    setQuery("");
    setDetailKey(null);
  }, [open]);

  const source = data ?? EMPTY;
  // Los indicadores siguen a la búsqueda pero no al filtro: así uno no deja al otro en cero.
  const searched = useMemo(() => filterNetworkExpiry(source, "all", query), [source, query]);
  const searchedProducts = useMemo(() => groupExpiryByProduct(searched), [searched]);
  const visible = useMemo(() => filterNetworkExpiry(source, filter, query), [source, filter, query]);
  const products = useMemo(() => groupExpiryByProduct(visible), [visible]);
  // El detalle muestra todos los lotes del producto en la red, sin el filtro ni la búsqueda.
  const allProducts = useMemo(() => new Map(groupExpiryByProduct(source).map((product) => [product.key, product])), [source]);

  const { sorted, headSort } = useTableSort(
    products,
    {
      name: (product) => product.name,
      sites: (product) => product.sites,
      expired: (product) => product.expiredLots,
      expiring: (product) => product.expiringLots,
      balance: (product) => product.balance,
      value: (product) => product.expiredValue + product.expiringValue,
      first: (product) => product.first.expiry.getTime(),
    },
    { firstDir: { sites: "desc", expired: "desc", expiring: "desc", balance: "desc", value: "desc" } },
  );

  const signature = `${filter}|${query}|${sorted.length}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature, 20);
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);
  const { tableRef, floating } = useFloatingTableHead([detailKey, page, pageSize, isDesktop, sorted]);

  const detail = detailKey ? allProducts.get(detailKey) ?? null : null;
  const position = detail ? sorted.findIndex((product) => product.key === detail.key) : -1;
  const scroller = () => contentRef.current?.parentElement ?? null;

  const openDetail = (key: string) => {
    listScroll.current = scroller()?.scrollTop ?? 0;
    setDetailKey(key);
  };
  const goTo = (offset: number) => {
    const next = sorted[position + offset];
    if (next) setDetailKey(next.key);
  };
  // Al abrir un detalle se empieza arriba; al volver, la lista queda donde estaba.
  useLayoutEffect(() => {
    const element = scroller();
    if (element) element.scrollTop = detailKey ? 0 : listScroll.current;
  }, [detailKey]);
  useEffect(() => {
    if (!detail) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") goTo(-1);
      if (event.key === "ArrowRight") goTo(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportExcel = async () => {
    setExporting(true);
    try {
      const now = new Date();
      const workbook = buildNetworkExpiryWorkbook(visible, { scope, windowDays, generatedAt: now });
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), networkExpiryFileName(scope, now));
    } finally {
      setExporting(false);
    }
  };

  const productTotal = (product: ExpiryProduct) => product.expiredValue + product.expiringValue;
  const expiredProducts = searchedProducts.filter((product) => product.expiredLots > 0).length;
  const expiringProducts = searchedProducts.filter((product) => product.expiringLots > 0).length;
  const searching = query.trim().length > 0;
  const arrow = "grid h-9 w-9 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent";

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      size="2xl"
      title={detail ? detail.name || "Producto sin nombre" : "Vencimientos"}
      subtitle={
        detail
          ? `${detail.code ? `Código ${detail.code} · ` : ""}${scope} · todos sus lotes vencidos o por vencer`
          : `${scope} · lotes con saldo vencidos o que vencen en los próximos ${windowDays} días`
      }
      onBack={detail ? () => setDetailKey(null) : undefined}
      backLabel="Volver a los productos"
      headerAside={
        detail && position >= 0 ? (
          <>
            <button type="button" onClick={() => goTo(-1)} disabled={position <= 0} aria-label="Producto anterior" className={arrow}>
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="hidden whitespace-nowrap text-xs font-semibold text-slate-500 sm:inline">
              {formatNumber(position + 1)} de {formatNumber(sorted.length)}
            </span>
            <button type="button" onClick={() => goTo(1)} disabled={position >= sorted.length - 1} aria-label="Producto siguiente" className={arrow}>
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : undefined
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={dialogSecondaryButton}>Cerrar</button>
          {canExport && (
            <button type="button" onClick={() => void exportExcel()} disabled={exporting || sorted.length === 0} className={dialogPrimaryButton}>
              <Download className="h-4 w-4" />
              {exporting ? "Preparando..." : "Descargar Excel"}
            </button>
          )}
        </>
      }
    >
      <div ref={contentRef}>
        {detail ? (
          <ProductDetail product={detail} isDesktop={isDesktop} />
        ) : (
          <div className="space-y-4">
            {/* Dos indicadores: en cuadrícula también en el celular (en una tira deslizable dejaban un hueco). */}
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                watermark
                tone="danger"
                icon={<AlertTriangle />}
                label="Vencidos"
                value={plural(searched.expiredLots, "lote", "lotes")}
                hint={`${money(searched.expiredValue)} · ${plural(expiredProducts, "producto", "productos")} en ${plural(searched.expiredSites, "establecimiento", "establecimientos")}`}
                onClick={() => setFilter((current) => (current === "expired" ? "all" : "expired"))}
                active={filter === "expired"}
              />
              <KpiCard
                watermark
                tone="warning"
                icon={<Clock />}
                label="Por vencer"
                value={plural(searched.expiringLots, "lote", "lotes")}
                hint={`${money(searched.expiringValue)} · ${plural(expiringProducts, "producto", "productos")} en ${plural(searched.expiringSites, "establecimiento", "establecimientos")}`}
                onClick={() => setFilter((current) => (current === "expiring" ? "all" : "expiring"))}
                active={filter === "expiring"}
              />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Situación">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    aria-pressed={filter === option.value}
                    className={`flex h-full flex-1 items-center justify-center rounded-lg px-3 text-xs font-bold transition-colors md:flex-none ${
                      filter === option.value ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <TableSearch value={query} onChange={setQuery} placeholder="Buscar producto, código, lote o establecimiento" />
            </div>

            {source.sitesWithoutData > 0 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {plural(source.sitesWithoutData, "establecimiento todavía no tiene", "establecimientos todavía no tienen")} su stock cargado y no
                {source.sitesWithoutData === 1 ? " entra" : " entran"} en este resumen. Sincroniza para incluirlos.
              </p>
            )}

            {sorted.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <EmptyState
                  icon={<CalendarClock className="h-6 w-6" />}
                  title={searching ? `Sin resultados para «${query.trim()}»` : "Sin lotes vencidos ni por vencer"}
                  description={
                    searching
                      ? "Prueba con otro nombre, código, lote o establecimiento."
                      : `Ningún establecimiento a la vista tiene lotes con saldo vencidos o que venzan en los próximos ${windowDays} días.`
                  }
                />
              </div>
            ) : isDesktop ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <table ref={tableRef} className="w-full text-left text-sm">
                  <TableHead columns={LIST_COLUMNS} headSort={headSort} floating={floating} trailing="Ver detalle" />
                  <tbody>
                    {rows.map((product) => (
                      <tr
                        key={product.key}
                        tabIndex={0}
                        onClick={() => openDetail(product.key)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(product.key); } }}
                        className="h-14 cursor-pointer border-t border-slate-100 outline-none transition-colors hover:bg-slate-50 focus-visible:bg-teal-50/60"
                      >
                        <td className="px-4 py-2">
                          <p className="text-[13.5px] font-semibold text-slate-900">{product.name || "Sin nombre"}</p>
                          <CodeChip code={product.code} />
                        </td>
                        <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-700">{formatNumber(product.sites)}</td>
                        <td className="px-3 py-2 text-center"><CountChip value={product.expiredLots} tone="danger" /></td>
                        <td className="px-3 py-2 text-center"><CountChip value={product.expiringLots} tone="warning" /></td>
                        <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{formatNumber(product.balance, 3)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] text-slate-700">{productTotal(product) > 0 ? money(productTotal(product)) : "—"}</td>
                        <td className="px-3 py-2 text-center"><ExpiryCell date={product.first.expiry} days={product.first.days} status={product.first.status} /></td>
                        <td className="px-2 py-2 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="productos" />
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((product) => (
                  <button
                    key={product.key}
                    type="button"
                    onClick={() => openDetail(product.key)}
                    className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-slate-900">{product.name || "Sin nombre"}</p>
                      <CodeChip code={product.code} />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {product.expiredLots > 0 && <StatusChip tone="danger" label={plural(product.expiredLots, "vencido", "vencidos")} />}
                        {product.expiringLots > 0 && <StatusChip tone="warning" label={plural(product.expiringLots, "por vencer", "por vencer")} />}
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">
                        {plural(product.sites, "establecimiento", "establecimientos")} · Stock {formatNumber(product.balance, 3)}
                        {productTotal(product) > 0 ? ` · ${money(productTotal(product))}` : ""}
                      </p>
                      <p className={`text-xs font-semibold ${daysTone(product.first.status, product.first.days)}`}>
                        {describeExpiryDays(product.first.days)} · {day(product.first.expiry)}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                  </button>
                ))}
                <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="productos" />
              </div>
            )}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
};
