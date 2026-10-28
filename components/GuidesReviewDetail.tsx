import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleHelp, Download, PackageCheck, PackageX } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { EmptyState, KpiCard, StatusChip, TableSearch, useTableSort, type Tone } from "./ui/kit";
import { SortableTableHead, useFloatingTableHead, type SortableHeadColumn } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { formatNumber } from "../services/numberFormat";
import { GUIDE_STATES, GUIDE_STATE_LABEL, type GuideState, type ReviewLot, type ReviewRow } from "../services/guidesReview";
import { siteCode } from "../services/guidesReviewExport";
import type { ReviewItem } from "./GuidesReviewModule";

/**
 * Un establecimiento de Revisión de guías, en una ventana: cada producto con lo que el almacén
 * envió y lo que ingresó en su ICI (sumando sus lotes), y los lotes de cada uno. ‹ › (o las flechas del teclado) pasan al anterior o
 * siguiente de la lista, en la misma ventana (nada de ventana sobre ventana, AGENTS.md §8).
 */

export const GUIDE_STATE_TONE: Record<GuideState, Tone> = { short: "danger", notReceived: "danger", extra: "warning", notSent: "info", complete: "success" };

const n = (value: number) => formatNumber(value, 3);
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const CodeChip: React.FC<{ code: string }> = ({ code }) => <span className="inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{code}</span>;

/** Dónde salió: las guías del mes, o la última anterior si este mes no hubo. */
export const guideText = (row: ReviewRow) =>
  row.guides.length ? row.guides.join(", ") : row.previous ? `Antes: guía ${row.previous.guide} del ${day(row.previous.date)}` : "Nunca lo envió el almacén";

/** Un lote: su número y cuánto salió e ingresó con él (una sola cifra si coinciden). */
const lotText = (lot: ReviewLot) => (lot.sent === lot.received ? n(lot.sent) : `env. ${lot.sent ? n(lot.sent) : "0"} · ing. ${lot.received ? n(lot.received) : "0"}`);

const LotList: React.FC<{ lots: ReviewLot[]; noIci: boolean }> = ({ lots, noIci }) => (
  <div className="space-y-0.5">
    {lots.map((lot) => (
      <p key={lot.lot} className="whitespace-nowrap text-[12px] text-slate-500">
        <span className="font-mono text-slate-700">{lot.lot || "Sin lote"}</span> · {noIci ? n(lot.sent) : lotText(lot)}
      </p>
    ))}
  </div>
);

type SortKey = "product" | "sent" | "received" | "diff" | "state" | "lots" | "guide";

const COLUMNS: SortableHeadColumn<SortKey>[] = [
  { key: "product", label: "Producto" },
  { key: "sent", label: "Enviado", align: "center", fit: true },
  { key: "received", label: "Ingresó", align: "center", fit: true },
  { key: "diff", label: "Diferencia", align: "center", fit: true },
  { key: "state", label: "Estado", align: "center", fit: true },
  { key: "lots", label: "Lotes", fit: true, title: "Cada lote con lo que salió del almacén y lo que ingresó el establecimiento" },
  { key: "guide", label: "Guía", title: "Guía de salida del almacén" },
];

export const GuidesReviewDetail: React.FC<{
  items: ReviewItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  productName: (code: string) => string;
  monthLabel: string;
  isDesktop: boolean;
  onExport?: (item: ReviewItem) => Promise<void>;
}> = ({ items, index, onIndex, onClose, productName, monthLabel, isDesktop, onExport }) => {
  const item = items[index];
  const site = item.site;
  const [show, setShow] = useState<"differences" | "all">(site.differences ? "differences" : "all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("revision-guias-detalle", 10);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setShow(site.differences ? "differences" : "all");
    setQuery("");
  }, [site]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return site.rows.filter((row) => (show === "all" || row.state !== "complete")
      && (!q || row.product.includes(q) || row.lots.some((l) => l.lot.toLowerCase().includes(q)) || productName(row.product).toLowerCase().includes(q)));
  }, [site, show, query, productName]);

  const { sorted, headSort } = useTableSort<ReviewRow, SortKey>(
    filtered,
    {
      product: (r) => productName(r.product),
      lots: (r) => r.lots.length,
      sent: (r) => r.sent,
      received: (r) => r.received,
      diff: (r) => r.received - r.sent,
      state: (r) => GUIDE_STATES.indexOf(r.state),
      guide: (r) => r.guides[0] ?? r.previous?.guide ?? "",
    },
    { initial: { key: "state", dir: "asc" }, firstDir: { sent: "desc", received: "desc", lots: "desc" } },
  );
  const signature = `${site.destination}|${show}|${query}|${sorted.length}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature, 20);
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);
  const { tableRef, floating } = useFloatingTableHead([signature, page, pageSize, isDesktop, sorted]);

  const go = (offset: number) => {
    const next = index + offset;
    if (next >= 0 && next < items.length) onIndex(next);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportExcel = async () => {
    if (!onExport) return;
    setExporting(true);
    try {
      await onExport(item);
    } finally {
      setExporting(false);
    }
  };

  const arrow = "grid h-9 w-9 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent";
  const counts = site.counts;
  const noIci = !site.iciCode;

  return (
    <ResponsiveDialog
      open
      onClose={onClose}
      size="2xl"
      title={item.name}
      subtitle={`${siteCode(site)} · ${item.microred || "Sin microred"} · ${site.guides.length} ${site.guides.length === 1 ? "guía" : "guías"} del almacén en ${monthLabel.toLowerCase()}`}
      headerAside={
        <>
          <button type="button" onClick={() => go(-1)} disabled={index <= 0} aria-label="Establecimiento anterior" className={arrow}><ChevronLeft className="h-5 w-5" /></button>
          <span className="hidden whitespace-nowrap text-xs font-semibold text-slate-500 sm:inline">{formatNumber(index + 1)} de {formatNumber(items.length)}</span>
          <button type="button" onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Establecimiento siguiente" className={arrow}><ChevronRight className="h-5 w-5" /></button>
        </>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={dialogSecondaryButton}>Cerrar</button>
          {onExport && (
            <button type="button" onClick={() => void exportExcel()} disabled={exporting} className={dialogPrimaryButton}>
              <Download className="h-4 w-4" />
              {exporting ? "Preparando..." : "Excel del establecimiento"}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {noIci ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">
            El SISMED del ICI no tiene el ICI de {monthLabel.toLowerCase()} de este establecimiento: no se puede comparar. Abajo está lo que le envió el almacén.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard watermark tone="success" icon={<PackageCheck />} label="Completos" value={formatNumber(counts.complete)} hint="enviado = ingresado" />
            <KpiCard watermark tone="info" icon={<CircleHelp />} label="No se dio salida" value={formatNumber(counts.notSent)} hint="sin guía del almacén este mes" />
            <KpiCard watermark tone="warning" label="Sobran" value={formatNumber(counts.extra)} hint="ingresó más" />
            <KpiCard watermark tone="danger" icon={<PackageX />} label="Faltan / no ingresó" value={formatNumber(counts.short + counts.notReceived)} hint="ingresó menos" />
          </div>
        )}

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {!noIci && (
            <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Mostrar">
              {([["differences", `Con diferencia (${formatNumber(site.differences)})`], ["all", `Todos (${formatNumber(site.rows.length)})`]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setShow(value)}
                  aria-pressed={show === value}
                  className={`flex h-full flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-xs font-bold transition-colors md:flex-none ${show === value ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <TableSearch value={query} onChange={setQuery} placeholder="Buscar producto, código o lote" />
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white">
            <EmptyState
              icon={<PackageCheck className="h-6 w-6" />}
              title={query.trim() ? `Sin resultados para «${query.trim()}»` : "Todo lo que envió el almacén ingresó completo"}
              description={query.trim() ? "Prueba con otro producto, código o lote." : "Cada producto coincide con el ICI del establecimiento."}
            />
          </div>
        ) : isDesktop ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table ref={tableRef} className="w-full text-left text-sm">
              <SortableTableHead columns={COLUMNS} headSort={headSort} floating={floating} />
              <tbody>
                {rows.map((row) => {
                  const diff = Math.round((row.received - row.sent) * 1000) / 1000;
                  return (
                    <tr key={row.product} className="h-14 border-t border-slate-100 align-middle">
                      <td className="px-4 py-2">
                        <p className="text-[13.5px] font-semibold text-slate-900">{productName(row.product)}</p>
                        <CodeChip code={row.product} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{row.sent ? n(row.sent) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{noIci ? "—" : row.received ? n(row.received) : "—"}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-center text-[13px] font-bold ${noIci || !diff ? "text-slate-300" : diff > 0 ? "text-amber-700" : "text-red-600"}`}>
                        {noIci ? "—" : `${diff > 0 ? "+" : ""}${n(diff)}`}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {noIci ? <StatusChip tone="neutral" label="Sin ICI" /> : <StatusChip tone={GUIDE_STATE_TONE[row.state]} label={GUIDE_STATE_LABEL[row.state]} />}
                      </td>
                      <td className="px-3 py-2"><LotList lots={row.lots} noIci={noIci} /></td>
                      <td className={`px-4 py-2 text-[12.5px] ${row.guides.length ? "text-slate-700" : "text-slate-500"}`}>{guideText(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="productos" />
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.product} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[14px] font-semibold text-slate-900">{productName(row.product)}</p>
                  {noIci ? <StatusChip tone="neutral" label="Sin ICI" /> : <StatusChip tone={GUIDE_STATE_TONE[row.state]} label={GUIDE_STATE_LABEL[row.state]} />}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>Enviado <b className="text-slate-700">{row.sent ? n(row.sent) : "—"}</b></span>
                  <span className="text-right">Ingresó <b className="text-slate-700">{noIci || !row.received ? "—" : n(row.received)}</b></span>
                  <span className="col-span-2">Código <b className="font-mono text-slate-700">{row.product}</b> · {row.guides.length ? `Guía ${guideText(row)}` : guideText(row)}</span>
                  <div className="col-span-2 mt-1 border-t border-slate-100 pt-1.5">
                    <p className="mb-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{row.lots.length === 1 ? "Lote" : "Lotes"}</p>
                    <LotList lots={row.lots} noIci={noIci} />
                  </div>
                </div>
              </div>
            ))}
            <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="productos" />
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
};
