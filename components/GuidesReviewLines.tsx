import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EmptyState, MobileFilterButton, SheetGroupTitle, SheetOption, StatusChip, TableSearch, useTableSort } from "./ui/kit";
import { CustomSelect } from "./ui/CustomSelect";
import { BottomSheet } from "./ui/BottomSheet";
import { SortableTableHead, useFloatingTableHead, type SortableHeadColumn } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { stickyBarClass, useStickyBar } from "./ui/useStickyBar";
import { formatNumber } from "../services/numberFormat";
import { GUIDE_STATES, GUIDE_STATE_LABEL, GUIDE_STATE_ORDER, type GuideLine, type GuideState } from "../services/guidesReview";
import { GUIDE_STATE_TONE } from "./GuidesReviewDetail";

/**
 * Las guías de salida del almacén en el mes, línea por línea (la hoja «Guias_de_salida» del Excel
 * del usuario): fecha de registro, guía, establecimiento, producto, cantidad y lote, con el
 * estado del producto en el ICI del establecimiento. Tocar una línea abre su establecimiento.
 */

type StateFilter = "all" | GuideState | "noIci";

const STATE_FILTER_LABEL: Record<StateFilter, string> = { all: "Todos", ...GUIDE_STATE_LABEL, noIci: "Sin ICI del mes" };
const STATE_FILTER_ORDER: StateFilter[] = ["all", ...GUIDE_STATE_ORDER, "noIci"];

type SortKey = "date" | "guide" | "site" | "product" | "quantity" | "lot" | "state";

const COLUMNS: SortableHeadColumn<SortKey>[] = [
  { key: "date", label: "Fecha registro", align: "center", fit: true },
  { key: "guide", label: "Guía", align: "center", fit: true },
  { key: "site", label: "Establecimiento" },
  { key: "product", label: "Producto" },
  { key: "quantity", label: "Cantidad", align: "center", fit: true },
  { key: "lot", label: "Lote", align: "center", fit: true },
  { key: "state", label: "Estado", align: "center", fit: true, title: "Estado del producto en el ICI del establecimiento" },
];

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const CodeChip: React.FC<{ code: string }> = ({ code }) => <span className="inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{code}</span>;

export const GuidesReviewLines: React.FC<{
  lines: GuideLine[];
  sites: Array<{ destination: string; name: string; code: string }>;
  /** Estado del producto en el ICI del establecimiento; undefined si no tiene ICI del mes. */
  stateOf: (destination: string, product: string) => GuideState | undefined;
  productName: (code: string) => string;
  isDesktop: boolean;
  onOpenSite: (destination: string) => void;
  monthLabel: string;
}> = ({ lines, sites, stateOf, productName, isDesktop, onOpenSite, monthLabel }) => {
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("");
  const [state, setState] = useState<StateFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("revision-guias-lineas", 20);
  const toolbar = useStickyBar<HTMLDivElement>();

  const names = useMemo(() => new Map(sites.map((s) => [s.destination, s])), [sites]);
  const stateCounts = useMemo(() => {
    const counts = new Map<StateFilter, number>();
    lines.forEach((l) => {
      if (site && l.destination !== site) return;
      const key = stateOf(l.destination, l.product) ?? "noIci";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [lines, site, stateOf]);
  const scoped = site ? lines.filter((l) => l.destination === site).length : lines.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => (!site || l.destination === site)
      && (state === "all" || (stateOf(l.destination, l.product) ?? "noIci") === state)
      && (!q || l.guide.includes(q) || l.product.includes(q) || l.lot.toLowerCase().includes(q) || l.destination.toLowerCase().includes(q)
        || productName(l.product).toLowerCase().includes(q) || (names.get(l.destination)?.name ?? "").toLowerCase().includes(q)));
  }, [lines, site, state, query, stateOf, productName, names]);

  const { sorted, headSort } = useTableSort<GuideLine, SortKey>(
    filtered,
    {
      date: (l) => l.date,
      guide: (l) => l.guide,
      site: (l) => names.get(l.destination)?.name ?? l.destination,
      product: (l) => productName(l.product),
      quantity: (l) => l.quantity,
      lot: (l) => l.lot,
      state: (l) => { const s = stateOf(l.destination, l.product); return s ? GUIDE_STATES.indexOf(s) : 99; },
    },
    { initial: { key: "date", dir: "desc" }, firstDir: { date: "desc", quantity: "desc" } },
  );
  const signature = `${query}|${site}|${state}|${sorted.length}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature, 30);
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);
  const { tableRef, floating } = useFloatingTableHead([signature, page, pageSize, isDesktop, sorted]);

  const chip = (l: GuideLine) => {
    const s = stateOf(l.destination, l.product);
    return s ? <StatusChip tone={GUIDE_STATE_TONE[s]} label={GUIDE_STATE_LABEL[s]} /> : <StatusChip tone="neutral" label="Sin ICI" />;
  };
  const stateOptions = STATE_FILTER_ORDER.filter((key) => key === "all" || key === state || (stateCounts.get(key) ?? 0) > 0);
  const siteOptions = [{ value: "", label: "Todos", count: lines.length }, ...sites.map((s) => ({ value: s.destination, label: s.name, hint: s.code, count: lines.filter((l) => l.destination === s.destination).length }))];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm md:overflow-hidden">
      <div ref={toolbar.ref} style={toolbar.style} className={`${stickyBarClass} flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-white p-3 md:static`}>
        <TableSearch value={query} onChange={setQuery} placeholder="Buscar guía, producto, lote o establecimiento" />
        <MobileFilterButton onClick={() => setFiltersOpen(true)} active={Boolean(site) || state !== "all"} />
        {isDesktop && (
          <>
            <CustomSelect size="md" prefix="Establecimiento" value={site} onChange={setSite} options={siteOptions} searchable containerClassName="w-72 shrink-0" menuMinWidth={320} />
            <CustomSelect
              size="md"
              prefix="Estado"
              value={state}
              onChange={(v) => setState((v as StateFilter) || "all")}
              options={stateOptions.map((key) => ({ value: key, label: STATE_FILTER_LABEL[key], count: key === "all" ? scoped : stateCounts.get(key) ?? 0 }))}
              containerClassName="w-56 shrink-0"
            />
          </>
        )}
      </div>

      <BottomSheet open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
        <SheetGroupTitle first>Estado</SheetGroupTitle>
        <div className="space-y-1">
          {stateOptions.map((key) => (
            <SheetOption key={key} active={state === key} label={STATE_FILTER_LABEL[key]} count={key === "all" ? scoped : stateCounts.get(key) ?? 0} onClick={() => { setState(key); setFiltersOpen(false); }} />
          ))}
        </div>
        <SheetGroupTitle>Establecimiento</SheetGroupTitle>
        <div className="space-y-1">
          {siteOptions.map((o) => (
            <SheetOption key={o.value || "all"} active={site === o.value} label={o.label} count={o.count} onClick={() => { setSite(o.value); setFiltersOpen(false); }} />
          ))}
        </div>
      </BottomSheet>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title={lines.length ? "Sin resultados" : `El almacén no envió guías a establecimientos en ${monthLabel.toLowerCase()}`}
          description={lines.length ? "No hay líneas que coincidan con la búsqueda o el filtro." : "Elija otro mes."}
        />
      ) : isDesktop ? (
        <>
          <table ref={tableRef} className="w-full text-left text-sm">
            <SortableTableHead columns={COLUMNS} headSort={headSort} floating={floating} />
            <tbody>
              {rows.map((l, i) => {
                const info = names.get(l.destination);
                return (
                  <tr key={`${l.guide}|${l.product}|${l.lot}|${i}`} onClick={() => onOpenSite(l.destination)} className="h-14 cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] text-slate-700">{day(l.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-[12.5px] text-slate-700">{l.guide}</td>
                    <td className="px-4 py-2">
                      <p className="text-[13px] font-semibold text-slate-800">{info?.name ?? l.destination}</p>
                      <CodeChip code={l.destination} />
                    </td>
                    <td className="px-4 py-2">
                      <p className="text-[13.5px] font-semibold text-slate-900">{productName(l.product)}</p>
                      <CodeChip code={l.product} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{formatNumber(l.quantity, 3)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-slate-700">{l.lot || "—"}</td>
                    <td className="px-3 py-2 text-center">{chip(l)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="líneas" />
        </>
      ) : (
        <div className="space-y-2 bg-slate-50 p-2">
          {rows.map((l, i) => {
            const info = names.get(l.destination);
            return (
              <button key={`${l.guide}|${l.product}|${l.lot}|${i}`} type="button" onClick={() => onOpenSite(l.destination)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[14px] font-semibold text-slate-900">{productName(l.product)}</p>
                  {chip(l)}
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-600">{info?.name ?? l.destination}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {day(l.date)} · Guía <b className="font-mono text-slate-700">{l.guide}</b> · Cantidad <b className="text-slate-700">{formatNumber(l.quantity, 3)}</b> · Lote <b className="font-mono text-slate-700">{l.lot || "—"}</b>
                </p>
              </button>
            );
          })}
          <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="líneas" />
        </div>
      )}
    </section>
  );
};
