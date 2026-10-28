import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleHelp, Download, PackageCheck, PackageX, X } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { EmptyState, KpiCard, StatusChip, TableSearch, UnderlineTabs, useTableSort, type Tone } from "./ui/kit";
import { CustomSelect } from "./ui/CustomSelect";
import { SortableTableHead, useFloatingTableHead, type SortableHeadColumn } from "./ui/FloatingTableHead";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { formatNumber } from "../services/numberFormat";
import { GUIDE_STATES, GUIDE_STATE_LABEL, type GuideLine, type GuideState, type ReviewRow } from "../services/guidesReview";
import { siteCode } from "../services/guidesReviewExport";
import { noteKey, type ReviewNotes } from "../services/guidesReviewNotes";
import type { ReviewItem } from "./GuidesReviewModule";

/**
 * Un establecimiento de Revisión de guías, en una ventana, con dos pestañas: sus productos (lo
 * que el almacén envió y lo que ingresó en su ICI, sumando lotes) y las guías del almacén. ‹ ›
 * (o las flechas del teclado) pasan al establecimiento anterior o siguiente.
 *
 * Rehecho el 2026-10-28 con las prácticas de Carbon y PatternFly, tras un primer diseño que el
 * usuario rechazó por ineficiente (filas de botones siempre visibles, lotes apilados en la fila):
 * - **Acciones en lote**: al marcar productos, la barra del buscador se reemplaza en su lugar
 *   por la de acciones («N marcados», la observación y Cancelar), sin agregar paneles.
 * - La observación se escribe en un **campo con autocompletar** que sugiere las ya usadas y deja
 *   escribir una nueva.
 * - «Mostrar» es un filtro: va en una lista desplegable junto al buscador.
 * - **Revelación progresiva**: la fila muestra un resumen de los lotes y, al tocar el producto,
 *   la misma ventana pasa a su detalle (lotes, guías y observación) con ← y ‹ ›; nada de
 *   ventana sobre ventana (AGENTS.md §8).
 */

export const GUIDE_STATE_TONE: Record<GuideState, Tone> = { short: "danger", notReceived: "danger", extra: "warning", notSent: "info", complete: "success" };

const n = (value: number) => formatNumber(value, 3);
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const round = (value: number) => Math.round(value * 1000) / 1000;

const CodeChip: React.FC<{ code: string }> = ({ code }) => <span className="inline-block rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{code}</span>;

/** Dónde salió: las guías del mes, o la última anterior si este mes no hubo. */
export const guideText = (row: ReviewRow) =>
  row.guides.length ? `Guía ${row.guides.join(", ")}` : row.previous ? `Antes: guía ${row.previous.guide} del ${day(row.previous.date)}` : "Nunca lo envió el almacén";

const Diff: React.FC<{ value: number; muted?: boolean }> = ({ value, muted }) => (
  <span className={`font-bold ${muted || !value ? "text-slate-300" : value > 0 ? "text-amber-700" : "text-red-600"}`}>{muted ? "—" : `${value > 0 ? "+" : ""}${n(value)}`}</span>
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

/**
 * Campo de la observación con autocompletar (combobox editable): sugiere las ya usadas, filtra
 * mientras se escribe y ofrece al final «Usar "…"» para una nueva. Enter pone la resaltada (la
 * primera que coincide); Escape cierra la lista.
 */
const NoteCombobox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  suggestions: string[];
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onCancel?: () => void;
  placeholder?: string;
}> = ({ value, onChange, onSubmit, suggestions, inputRef, onCancel, placeholder = "Escriba o elija una observación" }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = value.trim();
  const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const matches = suggestions.filter((s) => !typed || plain(s).includes(plain(typed)));
  const exact = matches.some((s) => plain(s) === plain(typed));
  // Como el «crear opción» de PatternFly: primero las que coinciden y, al final, la escrita.
  const options = typed && !exact ? [...matches, typed] : matches;
  const createAt = typed && !exact ? options.length - 1 : -1;
  useEffect(() => setActive(0), [value]);

  const choose = (text: string) => {
    setOpen(false);
    onSubmit(text);
  };
  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); const pick = open && options[active] ? options[active] : typed; if (pick) choose(pick); }
          else if (e.key === "Escape") { e.stopPropagation(); if (open) setOpen(false); else onCancel?.(); }
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
      {open && options.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 top-11 z-40 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((option, i) => (
            <li
              key={`${option}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(option); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-[13px] ${i === active ? "bg-teal-50 text-teal-800" : "text-slate-700"}`}
            >
              {i === createAt ? <>Usar «<b>{option}</b>»</> : option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

type Show = "differences" | "pending" | "all";
type SortKey = "product" | "sent" | "received" | "diff" | "state" | "lots" | "note";

const COLUMNS: SortableHeadColumn<SortKey>[] = [
  { key: "product", label: "Producto" },
  { key: "sent", label: "Enviado", align: "center", fit: true },
  { key: "received", label: "Ingresó", align: "center", fit: true },
  { key: "diff", label: "Diferencia", align: "center", fit: true },
  { key: "state", label: "Estado", align: "center", fit: true },
  { key: "lots", label: "Lotes", align: "center", fit: true, title: "Toque el producto para ver cada lote" },
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

/** Resumen de los lotes en la fila: el número si es uno, «N lotes» si son varios. */
const lotSummary = (row: ReviewRow) => (row.lots.length === 1 ? row.lots[0].lot || "Sin lote" : `${row.lots.length} lotes`);

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
  const [show, setShow] = useState<Show>(site.differences ? "differences" : "all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("revision-guias-detalle", 10);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  /** Producto abierto (su posición en la lista de la tabla), o null para ver la lista. */
  const [productAt, setProductAt] = useState<number | null>(null);
  const [productNote, setProductNote] = useState("");
  const batchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShow(site.differences ? "differences" : "all");
    setQuery("");
    setSelected(new Set());
    setDraft("");
    setProductAt(null);
  }, [site]);

  const noteOf = (product: string) => notes[noteKey(site.destination, product)] ?? "";
  const differenceRows = site.rows.filter((r) => r.state !== "complete");
  const pendingCount = differenceRows.filter((r) => !noteOf(r.product)).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return site.rows.filter((row) => {
      const note = notes[noteKey(site.destination, row.product)] ?? "";
      if (show !== "all" && row.state === "complete") return false;
      if (show === "pending" && note) return false;
      return !q || row.product.includes(q) || row.lots.some((l) => l.lot.toLowerCase().includes(q)) || productName(row.product).toLowerCase().includes(q) || note.toLowerCase().includes(q);
    });
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
  const { tableRef, floating } = useFloatingTableHead([signature, page, pageSize, isDesktop, sorted, productAt]);

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
  const selectedKeys = [...selected].map((product) => noteKey(site.destination, product));
  const selectedHaveNote = selectedKeys.some((key) => notes[key]);
  const cancelBatch = () => { setSelected(new Set()); setDraft(""); };
  const applyBatch = (text: string) => {
    if (!selected.size) return;
    onNote(selectedKeys, text);
    cancelBatch();
  };

  // Detalle de un producto, en la misma ventana.
  const product = productAt !== null ? sorted[productAt] : undefined;
  useEffect(() => {
    if (productAt !== null && !sorted[productAt]) setProductAt(null);
  }, [productAt, sorted]);
  const productCode = product?.product;
  const savedNote = productCode ? noteOf(productCode) : "";
  useEffect(() => setProductNote(savedNote), [productCode, savedNote]);
  const productLines = useMemo(() => (productCode ? lines.filter((l) => l.product === productCode).sort((a, b) => b.date.localeCompare(a.date) || b.guide.localeCompare(a.guide)) : []), [productCode, lines]);
  const openProduct = (row: ReviewRow) => setProductAt(sorted.indexOf(row));
  const saveProductNote = (text: string) => {
    if (!productCode) return;
    setProductNote(text);
    onNote([noteKey(site.destination, productCode)], text);
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
  const guideHead = useFloatingTableHead([guideSignature, guidePage, guidePageSize, isDesktop, guideSort.sorted, productAt]);

  // ‹ › y las flechas: entre productos si hay uno abierto, si no entre establecimientos.
  const go = (offset: number) => {
    if (productAt !== null) {
      const next = productAt + offset;
      if (next >= 0 && next < sorted.length) setProductAt(next);
      return;
    }
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
  const position = product ? productAt! : index;
  const total = product ? sorted.length : items.length;
  const unit = product ? "Producto" : "Establecimiento";

  const showOptions: Array<{ value: Show; label: string; count: number }> = [
    { value: "differences", label: "Con diferencia", count: site.differences },
    { value: "pending", label: "Sin observación", count: pendingCount },
    { value: "all", label: "Todos", count: site.rows.length },
  ];
  const stat = "rounded-xl border border-slate-200 bg-white px-3 py-2.5";
  const statLabel = "text-[10px] font-black uppercase tracking-wider text-slate-400";
  const sectionTitle = "mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500";
  const smallHead = "bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500";

  return (
    <ResponsiveDialog
      open
      onClose={onClose}
      size="2xl"
      title={product ? productName(product.product) : item.name}
      subtitle={product
        ? `${product.product} · ${item.name}`
        : `${siteCode(site)} · ${item.microred || "Sin microred"} · ${site.guides.length} ${site.guides.length === 1 ? "guía" : "guías"} del almacén en ${monthLabel.toLowerCase()}`}
      onBack={product ? () => setProductAt(null) : undefined}
      backLabel="Volver a los productos"
      headerAside={
        <>
          <button type="button" onClick={() => go(-1)} disabled={position <= 0} aria-label={`${unit} anterior`} className={arrow}><ChevronLeft className="h-5 w-5" /></button>
          <span className="hidden whitespace-nowrap text-xs font-semibold text-slate-500 sm:inline">{formatNumber(position + 1)} de {formatNumber(total)}</span>
          <button type="button" onClick={() => go(1)} disabled={position >= total - 1} aria-label={`${unit} siguiente`} className={arrow}><ChevronRight className="h-5 w-5" /></button>
        </>
      }
      footer={product ? (
        <button type="button" onClick={() => setProductAt(null)} className={dialogSecondaryButton}>Volver a los productos</button>
      ) : (
        <>
          <button type="button" onClick={onClose} className={dialogSecondaryButton}>Cerrar</button>
          {onExport && (
            <button type="button" onClick={() => void exportExcel()} disabled={exporting} className={dialogPrimaryButton}>
              <Download className="h-4 w-4" />
              {exporting ? "Preparando..." : "Excel del establecimiento"}
            </button>
          )}
        </>
      )}
    >
      {product ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={stat}><p className={statLabel}>Enviado</p><p className="mt-0.5 text-lg font-black text-slate-900">{product.sent ? n(product.sent) : "—"}</p></div>
            <div className={stat}><p className={statLabel}>Ingresó</p><p className="mt-0.5 text-lg font-black text-slate-900">{noIci ? "—" : product.received ? n(product.received) : "—"}</p></div>
            <div className={stat}><p className={statLabel}>Diferencia</p><p className="mt-0.5 text-lg"><Diff value={round(product.received - product.sent)} muted={noIci} /></p></div>
            <div className={stat}><p className={statLabel}>Estado</p><div className="mt-1">{stateChip(product.state)}</div></div>
          </div>

          <section>
            <p className={sectionTitle}>Observación</p>
            <div className="flex flex-col gap-2 md:flex-row">
              <NoteCombobox value={productNote} onChange={setProductNote} onSubmit={saveProductNote} suggestions={suggestions} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => saveProductNote(productNote)}
                  disabled={!productNote.trim() || productNote.trim() === savedNote}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40 md:flex-none"
                >
                  <Check className="h-4 w-4" /> Guardar
                </button>
                {savedNote && (
                  <button type="button" onClick={() => saveProductNote("")} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Quitar</button>
                )}
              </div>
            </div>
          </section>

          <section>
            <p className={sectionTitle}>{product.lots.length === 1 ? "Lote" : `Lotes (${product.lots.length})`}</p>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className={smallHead}>
                  <tr>
                    <th className="px-4 py-2.5">Lote</th>
                    <th className="px-3 py-2.5 text-center">Enviado</th>
                    <th className="px-3 py-2.5 text-center">Ingresó</th>
                    <th className="px-3 py-2.5 text-center">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {product.lots.map((lot) => (
                    <tr key={lot.lot} className="h-12 border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-[12.5px] text-slate-800">{lot.lot || "Sin lote"}</td>
                      <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{lot.sent ? n(lot.sent) : "—"}</td>
                      <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{noIci ? "—" : lot.received ? n(lot.received) : "—"}</td>
                      <td className="px-3 py-2 text-center text-[13px]"><Diff value={round(lot.received - lot.sent)} muted={noIci} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <p className={sectionTitle}>Guías del almacén en {monthLabel.toLowerCase()}</p>
            {productLines.length ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className={smallHead}>
                    <tr>
                      <th className="px-4 py-2.5">Fecha registro</th>
                      <th className="px-3 py-2.5 text-center">Guía</th>
                      <th className="px-3 py-2.5 text-center">Cantidad</th>
                      <th className="px-3 py-2.5 text-center">Lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productLines.map((l, i) => (
                      <tr key={`${l.guide}|${l.lot}|${i}`} className="h-12 border-t border-slate-100">
                        <td className="px-4 py-2 text-[13px] text-slate-700">{day(l.date)}</td>
                        <td className="px-3 py-2 text-center font-mono text-[12.5px] text-slate-700">{l.guide}</td>
                        <td className="px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{n(l.quantity)}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-slate-700">{l.lot || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
                El almacén no le dio salida este mes. {product.previous ? `La última fue la guía ${product.previous.guide} del ${day(product.previous.date)}.` : "No hay guías anteriores con este producto."}
              </p>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          {noIci ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">
              Falta importar el ICI de {monthLabel.toLowerCase()} de este establecimiento en el SISMED: no se puede comparar. Al importarlo y volver a esta ventana, se revisa solo.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard watermark tone="success" icon={<PackageCheck />} label="Completos" value={formatNumber(counts.complete)} hint="enviado = ingresado" />
              <KpiCard watermark tone="info" icon={<CircleHelp />} label="No se dio salida" value={formatNumber(counts.notSent)} hint="sin guía del almacén este mes" />
              <KpiCard watermark tone="warning" label="Sobran" value={formatNumber(counts.extra)} hint="ingresó más" />
              <KpiCard watermark tone="danger" icon={<PackageX />} label="Faltan / no ingresó" value={formatNumber(counts.short + counts.notReceived)} hint="ingresó menos" />
            </div>
          )}

          <UnderlineTabs
            label="Ver"
            value={tab}
            onChange={setTab}
            tabs={[{ id: "products", label: "Productos", count: site.rows.length }, { id: "guides", label: "Guías del almacén", count: lines.length }]}
          />

          {tab === "products" ? (
            <>
              {selected.size > 0 ? (
                // Barra de acciones en lote: reemplaza a la del buscador mientras haya productos marcados.
                <div className="flex flex-col gap-2 rounded-xl bg-teal-700 p-2 md:flex-row md:items-center md:pl-4">
                  <div className="flex items-center justify-between gap-2 md:contents">
                    <p className="shrink-0 text-[13px] font-bold text-white">{selected.size === 1 ? "1 marcado" : `${formatNumber(selected.size)} marcados`}</p>
                    <button type="button" onClick={cancelBatch} className="flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-bold text-teal-50 hover:bg-teal-600 md:order-last">
                      <X className="h-4 w-4" /> Cancelar
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-1 gap-2">
                    <NoteCombobox value={draft} onChange={setDraft} onSubmit={applyBatch} suggestions={suggestions} inputRef={batchInput} onCancel={cancelBatch} placeholder="Observación para los marcados" />
                    <button type="button" onClick={() => applyBatch(draft)} disabled={!draft.trim()} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-sm font-bold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                      <Check className="h-4 w-4" /> Poner
                    </button>
                    {selectedHaveNote && (
                      <button type="button" onClick={() => applyBatch("")} className="h-10 shrink-0 rounded-xl border border-teal-400 px-3 text-sm font-bold text-white hover:bg-teal-600">Quitar</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <TableSearch value={query} onChange={setQuery} placeholder="Buscar producto, código, lote u observación" />
                  {!noIci && (
                    <CustomSelect
                      size="md"
                      prefix={isDesktop ? "Mostrar" : undefined}
                      value={show}
                      onChange={(v) => setShow((v as Show) || "all")}
                      options={showOptions.map((o) => ({ value: o.value, label: o.label, count: o.count }))}
                      containerClassName={isDesktop ? "w-64 shrink-0" : "w-40 shrink-0"}
                      menuMinWidth={220}
                    />
                  )}
                </div>
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
                      trailing="Abrir"
                      leading={<Checkbox checked={allShown} indeterminate={!allShown && someShown} onChange={toggleAll} label="Marcar todos los de la lista" />}
                    />
                    <tbody>
                      {rows.map((row) => {
                        const note = noteOf(row.product);
                        const isSelected = selected.has(row.product);
                        return (
                          <tr key={row.product} onClick={() => openProduct(row)} className={`h-14 cursor-pointer border-t border-slate-100 ${isSelected ? "bg-teal-50/70" : "hover:bg-slate-50"}`}>
                            <td className="px-3 py-2 text-center"><Checkbox checked={isSelected} onChange={() => toggle(row.product)} label={`Marcar ${productName(row.product)}`} /></td>
                            <td className="px-4 py-2">
                              <p className="text-[13.5px] font-semibold text-slate-900">{productName(row.product)}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-slate-500"><CodeChip code={row.product} /> {guideText(row)}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{row.sent ? n(row.sent) : "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-center text-[13px] font-semibold text-slate-800">{noIci ? "—" : row.received ? n(row.received) : "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-center text-[13px]"><Diff value={round(row.received - row.sent)} muted={noIci} /></td>
                            <td className="px-3 py-2 text-center">{stateChip(row.state)}</td>
                            <td className={`whitespace-nowrap px-3 py-2 text-center text-[12.5px] ${row.lots.length === 1 ? "font-mono text-slate-700" : "font-semibold text-teal-700"}`}>{lotSummary(row)}</td>
                            <td className="px-4 py-2">
                              <p className={`line-clamp-2 max-w-[240px] text-[12.5px] ${note ? "font-semibold text-slate-800" : "text-slate-300"}`}>{note || "—"}</p>
                            </td>
                            <td className="px-2 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
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
                    const note = noteOf(row.product);
                    const isSelected = selected.has(row.product);
                    return (
                      <div key={row.product} onClick={() => openProduct(row)} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 shadow-sm ${isSelected ? "border-teal-300 bg-teal-50/70" : "border-slate-200 bg-white"}`}>
                        <span className="pt-0.5"><Checkbox checked={isSelected} onChange={() => toggle(row.product)} label={`Marcar ${productName(row.product)}`} /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-[14px] font-semibold text-slate-900">{productName(row.product)}</p>
                            {stateChip(row.state)}
                          </div>
                          <p className="mt-1.5 text-xs text-slate-500">
                            Enviado <b className="text-slate-700">{row.sent ? n(row.sent) : "—"}</b> · Ingresó <b className="text-slate-700">{noIci || !row.received ? "—" : n(row.received)}</b> · {lotSummary(row)}
                          </p>
                          {note && <p className="mt-1 text-[12.5px] font-semibold text-slate-800">{note}</p>}
                        </div>
                        <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
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
                  <EmptyState icon={<PackageCheck className="h-6 w-6" />} title={guideQuery.trim() ? `Sin resultados para «${guideQuery.trim()}»` : "El almacén no le envió guías este mes"} />
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
      )}
    </ResponsiveDialog>
  );
};
