import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Clock, Download } from "lucide-react";
import { saveAs } from "file-saver";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { EmptyState, KpiCard, StatusChip, TableHeaderCell, TableSearch, useTableSort } from "./ui/kit";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { useIsDesktop } from "./ui/useIsDesktop";
import { formatNumber } from "../services/numberFormat";
import { describeExpiryDays, filterNetworkExpiry, type ExpiryFilter, type ExpiryLot, type ExpirySite, type NetworkExpiry } from "../services/networkExpiry";
import { buildNetworkExpiryWorkbook, networkExpiryFileName } from "../services/networkExpiryExport";

/**
 * Vencimientos de la red (Consulta Stock, pedido del usuario del 2026-10-27): arriba los
 * totales de vencidos y por vencer, y debajo cada establecimiento con sus cifras; al tocarlo se
 * despliegan sus lotes. Filtro, buscador y Excel de lo que se ve. Las cifras son las de la tabla
 * de establecimientos (misma regla, `services/networkExpiry.ts`).
 */

/** Soles siempre con dos decimales: «S/ 2 141,25», «S/ 532,50». */
const money = (value: number) => {
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  return `${value < 0 ? "-" : ""}S/ ${formatNumber(Number(whole))},${cents}`;
};
const day = (date: Date) => date.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;
const daysTone = (lot: ExpiryLot) => (lot.status === "expired" ? "text-rose-600" : lot.days <= 30 ? "text-amber-600" : "text-slate-500");
const pharmacyLabel = (lot: ExpiryLot) => lot.pharmacyName || lot.pharmacy;

const FILTERS: { value: ExpiryFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "expired", label: "Vencidos" },
  { value: "expiring", label: "Por vencer" },
];

const SiteCounts: React.FC<{ site: ExpirySite }> = ({ site }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {site.expiredLots > 0 && <StatusChip tone="danger" label={plural(site.expiredLots, "vencido", "vencidos")} />}
    {site.expiringLots > 0 && <StatusChip tone="warning" label={plural(site.expiringLots, "por vencer", "por vencer")} />}
  </div>
);

const ProductCell: React.FC<{ lot: ExpiryLot }> = ({ lot }) => (
  <div className="min-w-0">
    <p className="text-[13px] font-semibold text-slate-800">{lot.productName || "Sin nombre"}</p>
    {lot.productCode && <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{lot.productCode}</span>}
  </div>
);

/** Lotes de un establecimiento, desplegados bajo su fila (escritorio). */
const LotsTable: React.FC<{ site: ExpirySite }> = ({ site }) => {
  const showPharmacy = site.pharmacies > 1;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <TableHeaderCell>Producto</TableHeaderCell>
            {showPharmacy && <TableHeaderCell align="center">Farmacia</TableHeaderCell>}
            <TableHeaderCell align="center">Lote</TableHeaderCell>
            <TableHeaderCell align="center">Vence</TableHeaderCell>
            <TableHeaderCell align="center">Situación</TableHeaderCell>
            <TableHeaderCell align="center">Saldo</TableHeaderCell>
            <TableHeaderCell align="center">Valor</TableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {site.lots.map((lot, index) => (
            <tr key={`${lot.productCode}-${lot.lot}-${lot.pharmacy}-${index}`} className="border-t border-slate-100">
              <td className="px-4 py-2.5"><ProductCell lot={lot} /></td>
              {showPharmacy && <td className="px-4 py-2.5 text-center text-xs text-slate-600">{pharmacyLabel(lot) || "—"}</td>}
              <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-700">{lot.lot || "—"}</td>
              <td className="px-4 py-2.5 text-center">
                <p className="text-[13px] font-semibold text-slate-800">{day(lot.expiry)}</p>
                <p className={`text-[11px] font-semibold ${daysTone(lot)}`}>{describeExpiryDays(lot.days)}</p>
              </td>
              <td className="px-4 py-2.5 text-center"><StatusChip tone={lot.status === "expired" ? "danger" : "warning"} label={lot.status === "expired" ? "Vencido" : "Por vencer"} /></td>
              <td className="px-4 py-2.5 text-center text-[13px] font-semibold text-slate-800">{formatNumber(lot.balance, 3)}</td>
              <td className="px-4 py-2.5 text-center text-[13px] text-slate-700">{lot.value > 0 ? money(lot.value) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Lotes de un establecimiento en el celular. */
const LotsList: React.FC<{ site: ExpirySite }> = ({ site }) => (
  <div className="space-y-2 border-t border-slate-100 bg-slate-50 p-3">
    {site.lots.map((lot, index) => (
      <div key={`${lot.productCode}-${lot.lot}-${lot.pharmacy}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
        <ProductCell lot={lot} />
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="text-slate-500">Lote <b className="font-mono text-slate-700">{lot.lot || "—"}</b></span>
          <span className="text-right text-slate-500">Vence <b className="text-slate-700">{day(lot.expiry)}</b></span>
          <span className="text-slate-500">Stock <b className="text-slate-700">{formatNumber(lot.balance, 3)}</b></span>
          <span className={`text-right font-semibold ${daysTone(lot)}`}>{describeExpiryDays(lot.days)}</span>
          {site.pharmacies > 1 && pharmacyLabel(lot) && <span className="col-span-2 text-slate-500">Farmacia <b className="text-slate-700">{pharmacyLabel(lot)}</b></span>}
          {lot.value > 0 && <span className="col-span-2 text-slate-500">Valor <b className="text-slate-700">{money(lot.value)}</b></span>}
        </div>
      </div>
    ))}
  </div>
);

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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Mientras se busca, todo viene desplegado; aquí se guardan los que el usuario cerró.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("vencimientos-red", 10);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) return;
    setFilter("all");
    setQuery("");
    setExpanded(new Set());
    setCollapsed(new Set());
  }, [open]);
  useEffect(() => setCollapsed(new Set()), [query]);

  const empty: NetworkExpiry = { sites: [], expiredLots: 0, expiringLots: 0, expiredValue: 0, expiringValue: 0, expiredSites: 0, expiringSites: 0, sitesWithoutData: 0 };
  const source = data ?? empty;
  // Los indicadores siguen a la búsqueda pero no al filtro: así uno no deja al otro en cero.
  const searched = useMemo(() => filterNetworkExpiry(source, "all", query), [source, query]);
  const visible = useMemo(() => filterNetworkExpiry(source, filter, query), [source, filter, query]);
  const ordered = useMemo(
    () =>
      [...visible.sites].sort(
        (a, b) => b.expiredLots - a.expiredLots || b.expiringLots - a.expiringLots || b.expiredValue + b.expiringValue - (a.expiredValue + a.expiringValue),
      ),
    [visible],
  );
  const { sorted, headSort } = useTableSort(
    ordered,
    {
      name: (site) => site.name,
      expired: (site) => site.expiredLots,
      expiring: (site) => site.expiringLots,
      value: (site) => site.expiredValue + site.expiringValue,
    },
    { firstDir: { expired: "desc", expiring: "desc", value: "desc" } },
  );

  const signature = `${filter}|${query}|${sorted.length}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature, 20);
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);

  const searching = query.trim().length > 0;
  const isOpen = (id: string) => (searching ? !collapsed.has(id) : expanded.has(id));
  const toggle = (id: string) => {
    const flip = (set: Set<string>) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };
    if (searching) setCollapsed(flip);
    else setExpanded(flip);
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const now = new Date();
      const workbook = buildNetworkExpiryWorkbook({ ...visible, sites: sorted }, { scope, windowDays, generatedAt: now });
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), networkExpiryFileName(scope, now));
    } finally {
      setExporting(false);
    }
  };

  const siteTotal = (site: ExpirySite) => site.expiredValue + site.expiringValue;

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Vencimientos"
      subtitle={`${scope} · lotes con saldo vencidos o que vencen en los próximos ${windowDays} días`}
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
      <div className="space-y-4">
        {/* Dos indicadores: en cuadrícula también en el celular (en una tira deslizable dejaban un hueco). */}
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            watermark
            tone="danger"
            icon={<AlertTriangle />}
            label="Vencidos"
            value={plural(searched.expiredLots, "lote", "lotes")}
            hint={`${money(searched.expiredValue)} · ${plural(searched.expiredSites, "establecimiento", "establecimientos")}`}
            onClick={() => setFilter((current) => (current === "expired" ? "all" : "expired"))}
            active={filter === "expired"}
          />
          <KpiCard
            watermark
            tone="warning"
            icon={<Clock />}
            label="Por vencer"
            value={plural(searched.expiringLots, "lote", "lotes")}
            hint={`${money(searched.expiringValue)} · ${plural(searched.expiringSites, "establecimiento", "establecimientos")}`}
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
          <TableSearch value={query} onChange={setQuery} placeholder="Buscar establecimiento, producto o lote" />
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
                  ? "Prueba con otro nombre, código o lote."
                  : `Ningún establecimiento a la vista tiene lotes con saldo vencidos o que venzan en los próximos ${windowDays} días.`
              }
            />
          </div>
        ) : isDesktop ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <TableHeaderCell sort={headSort("name")}>Establecimiento</TableHeaderCell>
                  <TableHeaderCell align="center" sort={headSort("expired")}>Vencidos</TableHeaderCell>
                  <TableHeaderCell align="center" sort={headSort("expiring")}>Por vencer</TableHeaderCell>
                  <TableHeaderCell align="center" sort={headSort("value")}>Valor</TableHeaderCell>
                  <th className="w-10" aria-label="Desplegar" />
                </tr>
              </thead>
              <tbody>
                {rows.map((site) => {
                  const opened = isOpen(site.id);
                  return (
                    <React.Fragment key={site.id}>
                      <tr onClick={() => toggle(site.id)} aria-expanded={opened} className="h-14 cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <p className="text-[14px] font-bold text-slate-900">{site.name}</p>
                          {site.code && <p className="font-mono text-[11px] text-slate-500">{site.code}</p>}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {site.expiredLots > 0 ? <StatusChip tone="danger" label={formatNumber(site.expiredLots)} /> : <span className="text-slate-300">0</span>}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {site.expiringLots > 0 ? <StatusChip tone="warning" label={formatNumber(site.expiringLots)} /> : <span className="text-slate-300">0</span>}
                        </td>
                        <td className="px-4 py-2 text-center text-[13px] font-semibold text-slate-800">{siteTotal(site) > 0 ? money(siteTotal(site)) : "—"}</td>
                        <td className="px-2 py-2 text-slate-400">{opened ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      </tr>
                      {opened && (
                        <tr>
                          <td colSpan={5} className="bg-slate-50/70 px-4 pb-4 pt-1">
                            <LotsTable site={site} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="establecimientos" />
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((site) => {
              const opened = isOpen(site.id);
              return (
                <div key={site.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button type="button" onClick={() => toggle(site.id)} aria-expanded={opened} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-slate-900">{site.name}</p>
                      {site.code && <p className="font-mono text-[11px] text-slate-500">{site.code}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <SiteCounts site={site} />
                        {siteTotal(site) > 0 && <span className="text-xs font-semibold text-slate-600">{money(siteTotal(site))}</span>}
                      </div>
                    </div>
                    {opened ? <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-slate-400" /> : <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />}
                  </button>
                  {opened && <LotsList site={site} />}
                </div>
              );
            })}
            <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="establecimientos" />
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
};
