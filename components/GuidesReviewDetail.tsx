import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleHelp, Download, MessageSquarePlus, PackageCheck, PackageX, X } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { EmptyState, KpiCard, StatusChip, TableSearch, useTableSort, type Tone } from "./ui/kit";
import { SortableTableHead, useFloatingTableHead, type SortableHeadColumn } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { formatNumber } from "../services/numberFormat";
import { GUIDE_STATES, GUIDE_STATE_LABEL, type GuideLine, type GuideState, type ReviewLot, type ReviewRow } from "../services/guidesReview";
import { siteCode } from "../services/guidesReviewExport";
import { noteKey, type ReviewNotes } from "../services/guidesReviewNotes";
import type { ReviewItem } from "./GuidesReviewModule";

/**
 * Un establecimiento de Revisión de guías, en una ventana: cada producto con lo que el almacén
 * envió y lo que ingresó en su ICI (sumando sus lotes), sus lotes y su observación, y en otra
 * pestaña las guías de salida del almacén con su detalle. ‹ › (o las flechas del teclado) pasan
 * al anterior o siguiente de la lista, en la misma ventana (nada de ventana sobre ventana,
 * AGENTS.md §8).
 *
 * Observaciones (2026-10-28, pedido del usuario: «a veces son bastantes… tiene que ser más
 * optimizado»): se marcan varios productos y se les pone la misma de una vez, escribiéndola o
 * con un clic en una de las ya usadas.
 */

export const GUIDE_STATE_TONE: Record<GuideState, Tone> = { short: "danger", notReceived: "danger", extra: "warning", notSent: "info", complete: "success" };

const n = (value: number) => formatNumber(value, 3);
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const CodeChip: React.FC<{ code: string }> = ({ code }) => <span className="inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{code}</span>;

/** Dónde salió: las guías del mes, o la última anterior si este mes no hubo. */
export const guideText = (row: ReviewRow) =>
  row.guides.length ? `Guía ${row.guides.join(", ")}` : row.previous ? `Antes: guía ${row.previous.guide} del ${day(row.previous.date)}` : "Nunca lo envió el almacén";

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

const Checkbox: React.FC<{ checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }> = ({ checked, indeterminate = false, onChange, label }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-teal-600"
    />
  );
};

const Segmented = <T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) => (
  <div className="hide-scrollbar flex h-10 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm md:w-fit" role="group" aria-label={label}>
    {options.map(([option, text]) => (
      <button
        key={option}
        type="button"
        onClick={() => onChange(option)}
        aria-pressed={value === option}
        className={`flex h-full flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-xs font-bold transition-colors md:flex-none ${value === option ? "bg-teal-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
      >
        {text}
      </button>
    ))}
  </div>
);

/** Barra para poner la misma observación a los productos marcados. */
const NoteBar: React.FC<{
  count: number;
  value: string;
  onValue: (value: string) => void;
  onApply: (text: string) => void;
  onClear: (() => void) | null;
  onCancel: () => void;
  suggestions: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
}> = ({ count, value, onValue, onApply, onClear, onCancel, suggestions, inputRef }) => (
  <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-3">
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <p className="shrink-0 text-[13px] font-bold text-teal-900">{count === 1 ? "1 producto marcado" : `${formatNumber(count)} productos marcados`}</p>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onApply(value);
          if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
        }}
        placeholder="Escriba la observación o elija una de abajo"
        className="h-10 min-w-0 flex-1 rounded-xl border border-teal-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => onApply(value)} disabled={!value.trim()} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40 md:flex-none">
          <Check className="h-4 w-4" /> Poner
        </button>
        {onClear && (
          <button type="button" onClick={onClear} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Quitar</button>
        )}
        <button type="button" onClick={onCancel} aria-label="Desmarcar" className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {suggestions.map((note) => (
        <button key={note} type="button" onClick={() => onApply(note)} className="rounded-full border border-teal-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-teal-800 hover:border-teal-400 hover:bg-teal-50">
          {note}
        </button>
      ))}
    </div>
  </div>
);

type SortKey = "product" | "sent" | "received" | "diff" | "state" | "lots" | "note";

const COLUMNS: SortableHeadColumn<SortKey>[] = [
  { key: "product", label: "Producto" },
  { key: "sent", label: "Enviado", align: "center", fit: true },
  { key: "received", label: "Ingresó", align: "center", fit: true },
  { key: "diff", label: "Diferencia", align: "center", fit: true },
  { key: "state", label: "Estado", align: "center", fit: true },
  { key: "lots", label: "Lotes", fit: true, title: "Cada lote con lo que salió del almacén y lo que ingresó el establecimiento" },
  { key: "note", label: "Observación" },
];

type GuideSortKey = "date" | "guide" | "product" | "quantity" | "lot" | "state";

const GUIDE_COLUMNS: SortableHeadColumn<GuideSortKey>[] = [
  { key: "date", label: "Fecha registro", align: "center", fit: true },
  { key: "guide", label: "Guía", align: "center", fit: true },
  { key: "product", label: "Producto" },
  { key: "quantity", label: "Cantidad", align: "center", fit: true },
  { key: "lot", label: "Lote", align: "center", fit: true },
  { key: "state", label: "Estado del producto", align: "center", fit: true },
];

export const GuidesReviewDetail: React.FC<{
  items: ReviewItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  productName: (code: string) => string;
  monthLabel: string;
  isDesktop: boolean;
  /** Guías de salida del mes a este establecimiento. */
  lines: GuideLine[];
  notes: ReviewNotes;
  onNote: (keys: string[], text: string) => void;
  suggestions: string[];
  onExport?: (item: ReviewItem) => Promise<void>;
}> = ({ items, index, onIndex, onClose, productName, monthLabel, isDesktop, lines, notes, onNote, suggestions, onExport }) => {
  const item = items[index];
  const site = item.site;
  const noIci = !site.iciCode;
  const [tab, setTab] = useState<"products" | "guides">("products");
  const [show, setShow] = useState<"differences" | "pending" | "all">(site.differences ? "differences" : "all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("revision-guias-detalle", 10);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const noteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShow(site.differences ? "differences" : "all");
    setQuery("");
    setSelected(new Set());
    setDraft("");
  }, [site]);

  const noteOf = (row: ReviewRow) => notes[noteKey(site.destination, row.product)] ?? "";
  const differenceRows = site.rows.filter((r) => r.state !== "complete");
  const observed = differenceRows.filter((r) => noteOf(r)).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return site.rows.filter((row) => (show === "all" || (row.state !== "complete" && (show === "differences" || !notes[noteKey(site.destination, row.product)])))
      && (!q || row.product.includes(q) || row.lots.some((l) => l.lot.toLowerCase().includes(q)) || productName(row.product).toLowerCase().includes(q)
        || (notes[noteKey(site.destination, row.product)] ?? "").toLowerCase().includes(q)));
  }, [site, show, query, productName, notes]);

  const { sorted, headSort } = useTableSort<ReviewRow, SortKey>(
    filtered,
    {
      product: (r) => productName(r.product),
      lots: (r) => r.lots.length,
      sent: (r) => r.sent,
      received: (r) => r.received,
      diff: (r) => r.received - r.sent,
      state: (r) => GUIDE_STATES.indexOf(r.state),
      note: (r) => notes[noteKey(site.destination, r.product)] ?? "",
    },
    { initial: { key: "state", dir: "asc" }, firstDir: { sent: "desc", received: "desc", lots: "desc" } },
  );
  const signature = `${site.destination}|${show}|${query}|${sorted.length}|${tab}`;
  useEffect(() => setPage(1), [signature]);
  const mobile = useIncrementalCount(sorted.length, signature, 20);
  const rows = isDesktop ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted.slice(0, mobile.count);
  const { tableRef, floating } = useFloatingTableHead([signature, page, pageSize, isDesktop, sorted, selected.size > 0]);

  const toggle = (product: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(product)) next.delete(product);
    else next.add(product);
    return next;
  });
  const allShown = sorted.length > 0 && sorted.every((r) => selected.has(r.product));
  const someShown = sorted.some((r) => selected.has(r.product));
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    if (allShown) sorted.forEach((r) => next.delete(r.product));
    else sorted.forEach((r) => next.add(r.product));
    return next;
  });
  const pendingRows = differenceRows.filter((r) => !noteOf(r));
  const selectedKeys = [...selected].map((product) => noteKey(site.destination, product));
  const selectedHaveNote = selectedKeys.some((key) => notes[key]);

  const apply = (text: string) => {
    if (!selected.size) return;
    onNote(selectedKeys, text);
    setSelected(new Set());
    setDraft("");
  };
  /** Tocar la observación de una fila la marca sola y deja escribir la suya. */
  const editRow = (row: ReviewRow) => {
    setSelected(new Set([row.product]));
    setDraft(noteOf(row));
    window.setTimeout(() => noteInput.current?.focus(), 0);
  };

  // Guías del almacén a este establecimiento.
  const [guideQuery, setGuideQuery] = useState("");
  const stateOf = useMemo(() => new Map(site.rows.map((r) => [r.product, r.state])), [site]);
  const guideRows = useMemo(() => {
    const q = guideQuery.trim().toLowerCase();
    return lines.filter((l) => !q || l.guide.includes(q) || l.product.includes(q) || l.lot.toLowerCase().includes(q) || productName(l.product).toLowerCase().includes(q));
  }, [lines, guideQuery, productName]);
  const guideSort = useTableSort<GuideLine, GuideSortKey>(
    guideRows,
    {
      date: (l) => l.date,
      guide: (l) => l.guide,
      product: (l) => productName(l.product),
      quantity: (l) => l.quantity,
      lot: (l) => l.lot,
      state: (l) => GUIDE_STATES.indexOf(stateOf.get(l.product) ?? "complete"),
    },
    { initial: { key: "date", dir: "desc" }, firstDir: { date: "desc", quantity: "desc" } },
  );
  const guideSignature = `${site.destination}|${guideQuery}|${guideSort.sorted.length}|${tab}`;
  const [guidePage, setGuidePage] = useState(1);
  const [guidePageSize, setGuidePageSize] = usePageSize("revision-guias-detalle-guias", 10);
  useEffect(() => setGuidePage(1), [guideSignature]);
  const guideMobile = useIncrementalCount(guideSort.sorted.length, guideSignature, 20);
  const guideVisible = isDesktop ? guideSort.sorted.slice((guidePage - 1) * guidePageSize, guidePage * guidePageSize) : guideSort.sorted.slice(0, guideMobile.count);
  const guideHead = useFloatingTableHead([guideSignature, guidePage, guidePageSize, isDesktop, guideSort.sorted]);

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
  const stateChip = (state: GuideState | undefined) =>
    noIci || !state ? <StatusChip tone="neutral" label="Sin ICI" /> : <StatusChip tone={GUIDE_STATE_TONE[state]} label={GUIDE_STATE_LABEL[state]} />;

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
            El SISMED del ICI no tiene el ICI de {monthLabel.toLowerCase()} de este establecimiento: no se puede comparar. Al importarlo en el SISMED y volver a esta ventana, se revisa solo.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard watermark tone="success" icon={<PackageCheck />} label="Completos" value={formatNumber(counts.complete)} hint="enviado = ingresado" />
            <KpiCard watermark tone="info" icon={<CircleHelp />} label="No se dio salida" value={formatNumber(counts.notSent)} hint="sin guía del almacén este mes" />
            <KpiCard watermark tone="warning" label="Sobran" value={formatNumber(counts.extra)} hint="ingresó más" />
            <KpiCard watermark tone="danger" icon={<PackageX />} label="Faltan / no ingresó" value={formatNumber(counts.short + counts.notReceived)} hint="ingresó menos" />
          </div>
        )}

        <Segmented
          label="Ver"
          value={tab}
          onChange={setTab}
          options={[["products", `Productos (${formatNumber(site.rows.length)})`], ["guides", `Guías del almacén (${formatNumber(lines.length)})`]]}
        />

        {tab === "products" ? (
          <>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              {!noIci && (
                <Segmented
                  label="Mostrar"
                  value={show}
                  onChange={setShow}
                  options={[
                    ["differences", `Con diferencia (${formatNumber(site.differences)})`],
                    ["pending", `Sin observación (${formatNumber(pendingRows.length)})`],
                    ["all", `Todos (${formatNumber(site.rows.length)})`],
                  ]}
                />
              )}
              <TableSearch value={query} onChange={setQuery} placeholder="Buscar producto, código, lote u observación" />
            </div>

            {selected.size > 0 ? (
              <NoteBar
                count={selected.size}
                value={draft}
                onValue={setDraft}
                onApply={apply}
                onClear={selectedHaveNote ? () => apply("") : null}
                onCancel={() => { setSelected(new Set()); setDraft(""); }}
                suggestions={suggestions}
                inputRef={noteInput}
              />
            ) : (
              !noIci && differenceRows.length > 0 && (
                <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-slate-200 px-3 py-2.5 text-[12.5px] text-slate-500 md:flex-row md:items-center">
                  <MessageSquarePlus className="hidden h-4 w-4 shrink-0 text-slate-400 md:block" />
                  <p className="flex-1">
                    <b className="text-slate-700">{formatNumber(observed)} de {formatNumber(differenceRows.length)}</b> diferencias con observación. Marque productos con la casilla para ponerles la misma de una vez (se guardan en este equipo).
                  </p>
                  {pendingRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(pendingRows.map((r) => r.product)))}
                      className="shrink-0 self-start rounded-xl border border-teal-200 bg-white px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-50 md:self-auto"
                    >
                      Marcar las {formatNumber(pendingRows.length)} sin observación
                    </button>
                  )}
                </div>
              )
            )}

            {sorted.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <EmptyState
                  icon={<PackageCheck className="h-6 w-6" />}
                  title={query.trim() ? `Sin resultados para «${query.trim()}»` : show === "pending" ? "Todas las diferencias tienen observación" : "Todo lo que envió el almacén ingresó completo"}
                  description={query.trim() ? "Prueba con otro producto, código o lote." : show === "pending" ? "Puede revisarlas en «Con diferencia»." : "Cada producto coincide con el ICI del establecimiento."}
                />
              </div>
            ) : isDesktop ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <table ref={tableRef} className="w-full text-left text-sm">
                  <SortableTableHead
                    columns={COLUMNS}
                    headSort={headSort}
                    floating={floating}
                    leading={<Checkbox checked={allShown} indeterminate={!allShown && someShown} onChange={toggleAll} label="Marcar todos los de la lista" />}
                  />
                  <tbody>
                    {rows.map((row) => {
                      const diff = Math.round((row.received - row.sent) * 1000) / 1000;
                      const note = noteOf(row);
                      const isSelected = selected.has(row.product);
                      return (
                        <tr key={row.product} onClick={() => toggle(row.product)} className={`h-14 cursor-pointer border-t border-slate-100 align-middle ${isSelected ? "bg-teal-50/70" : "hover:bg-slate-50"}`}>
                          <td className="px-3 py-2 text-center"><Checkbox checked={isSelected} onChange={() => toggle(row.product)} label={`Marcar ${productName(row.product)}`} /></td>
                          <td className="px-4 py-2">
                            <p className="text-[13.5px] font-semibold text-slate-900">{productName(row.product)}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-slate-500"><CodeChip code={row.product} /> {guideText(row)}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{row.sent ? n(row.sent) : "—"}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{noIci ? "—" : row.received ? n(row.received) : "—"}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-center text-[13px] font-bold ${noIci || !diff ? "text-slate-300" : diff > 0 ? "text-amber-700" : "text-red-600"}`}>
                            {noIci ? "—" : `${diff > 0 ? "+" : ""}${n(diff)}`}
                          </td>
                          <td className="px-3 py-2 text-center">{stateChip(row.state)}</td>
                          <td className="px-3 py-2"><LotList lots={row.lots} noIci={noIci} /></td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); editRow(row); }}
                              title={note || "Poner observación"}
                              className={`line-clamp-2 max-w-[220px] text-left text-[12.5px] ${note ? "font-semibold text-slate-800" : "text-slate-300 hover:text-teal-700"}`}
                            >
                              {note || (row.state === "complete" ? "—" : "Poner observación")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <TablePagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="productos" />
              </div>
            ) : (
              <div className="space-y-2">
                {sorted.length > 1 && (
                  <label className="flex items-center gap-2 px-1 text-[12.5px] font-semibold text-slate-600">
                    <Checkbox checked={allShown} indeterminate={!allShown && someShown} onChange={toggleAll} label="Marcar todos los de la lista" />
                    Marcar los {formatNumber(sorted.length)} de la lista
                  </label>
                )}
                {rows.map((row) => {
                  const note = noteOf(row);
                  const isSelected = selected.has(row.product);
                  return (
                    <div key={row.product} onClick={() => toggle(row.product)} className={`rounded-2xl border p-3 shadow-sm ${isSelected ? "border-teal-300 bg-teal-50/70" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start gap-2.5">
                        <span className="pt-0.5"><Checkbox checked={isSelected} onChange={() => toggle(row.product)} label={`Marcar ${productName(row.product)}`} /></span>
                        <p className="min-w-0 flex-1 text-[14px] font-semibold text-slate-900">{productName(row.product)}</p>
                        {stateChip(row.state)}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 pl-6 text-xs text-slate-500">
                        <span>Enviado <b className="text-slate-700">{row.sent ? n(row.sent) : "—"}</b></span>
                        <span className="text-right">Ingresó <b className="text-slate-700">{noIci || !row.received ? "—" : n(row.received)}</b></span>
                        <span className="col-span-2">Código <b className="font-mono text-slate-700">{row.product}</b> · {guideText(row)}</span>
                        <div className="col-span-2 mt-1 border-t border-slate-100 pt-1.5">
                          <p className="mb-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{row.lots.length === 1 ? "Lote" : "Lotes"}</p>
                          <LotList lots={row.lots} noIci={noIci} />
                        </div>
                        {(note || row.state !== "complete") && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); editRow(row); }} className="col-span-2 mt-1 rounded-lg bg-slate-50 px-2 py-1.5 text-left text-[12.5px]">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Observación </span>
                            <span className={note ? "font-semibold text-slate-800" : "text-teal-700"}>{note || "Poner observación"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <LoadMoreSentinel hasMore={mobile.hasMore} onLoadMore={mobile.loadMore} shown={mobile.count} total={sorted.length} itemLabel="productos" />
              </div>
            )}
          </>
        ) : (
          <>
            <TableSearch value={guideQuery} onChange={setGuideQuery} placeholder="Buscar guía, producto, código o lote" />
            {guideSort.sorted.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <EmptyState icon={<PackageCheck className="h-6 w-6" />} title={guideQuery.trim() ? `Sin resultados para «${guideQuery.trim()}»` : "El almacén no le envió guías este mes"} description="" />
              </div>
            ) : isDesktop ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <table ref={guideHead.tableRef} className="w-full text-left text-sm">
                  <SortableTableHead columns={GUIDE_COLUMNS} headSort={guideSort.headSort} floating={guideHead.floating} />
                  <tbody>
                    {guideVisible.map((l, i) => (
                      <tr key={`${l.guide}|${l.product}|${l.lot}|${i}`} className="h-14 border-t border-slate-100">
                        <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] text-slate-700">{day(l.date)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-[12.5px] text-slate-700">{l.guide}</td>
                        <td className="px-4 py-2">
                          <p className="text-[13.5px] font-semibold text-slate-900">{productName(l.product)}</p>
                          <CodeChip code={l.product} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{n(l.quantity)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-slate-700">{l.lot || "—"}</td>
                        <td className="px-3 py-2 text-center">{stateChip(stateOf.get(l.product))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination page={guidePage} pageSize={guidePageSize} total={guideSort.sorted.length} onPageChange={setGuidePage} onPageSizeChange={setGuidePageSize} itemLabel="líneas" />
              </div>
            ) : (
              <div className="space-y-2">
                {guideVisible.map((l, i) => (
                  <div key={`${l.guide}|${l.product}|${l.lot}|${i}`} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[14px] font-semibold text-slate-900">{productName(l.product)}</p>
                      {stateChip(stateOf.get(l.product))}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {day(l.date)} · Guía <b className="font-mono text-slate-700">{l.guide}</b> · Cantidad <b className="text-slate-700">{n(l.quantity)}</b> · Lote <b className="font-mono text-slate-700">{l.lot || "—"}</b>
                    </p>
                  </div>
                ))}
                <LoadMoreSentinel hasMore={guideMobile.hasMore} onLoadMore={guideMobile.loadMore} shown={guideMobile.count} total={guideSort.sorted.length} itemLabel="líneas" />
              </div>
            )}
          </>
        )}
      </div>
    </ResponsiveDialog>
  );
};
