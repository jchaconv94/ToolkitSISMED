import React, { useMemo, useState } from "react";
import { Building2, Check, Download, FileSpreadsheet, Info, Loader2, Network, Search, Store } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import type { ProductsExportKind } from "../services/availabilityExport";

export type AvailabilityExportKind = "full" | ProductsExportKind;

export interface ExportSite {
  code: string;
  name: string;
  /** Microred (o «UNGET · Microred» con varias UNGET): agrupa la lista. */
  group: string;
  /** Fuera del análisis: no cuenta en la disponibilidad, pero sí sale en las hojas de productos. */
  outside?: boolean;
}

const KINDS: Array<{ id: AvailabilityExportKind; icon: React.ReactNode; title: string; text: string }> = [
  { id: "full", icon: <FileSpreadsheet className="h-5 w-5" />, title: "Reporte completo", text: "Portada con gráficos, hallazgos, establecimientos, microredes, productos y metodología." },
  { id: "establishments", icon: <Building2 className="h-5 w-5" />, title: "Productos por establecimiento", text: "Una hoja: cada producto de cada establecimiento." },
  { id: "pharmacies", icon: <Store className="h-5 w-5" />, title: "Productos por farmacia", text: "Una hoja: cada farmacia y puesto comunal por separado." },
  { id: "network", icon: <Network className="h-5 w-5" />, title: "Consolidado por red", text: "Una hoja: cada producto con la red sumada (consumo, stock, lotes y situación)." },
];

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const Box: React.FC<{ on: boolean; partial?: boolean }> = ({ on, partial }) => (
  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${on || partial ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white"}`}>
    {on ? <Check className="h-3 w-3 stroke-[3]" /> : partial ? <span className="h-0.5 w-2 rounded bg-white" /> : null}
  </span>
);

/**
 * Exportar el Excel de Disponibilidad (2026-11-06, pedido del usuario): el reporte completo de
 * siempre o una sola hoja de productos —por establecimiento, por farmacia o consolidada por red,
 * como el «Por Red» del Toolkit de escritorio pero con todas las columnas—, y los
 * establecimientos que no se quieren incluir. Los que se quitan no salen y no cuentan en la
 * microred ni en la red: todo se recalcula sin ellos. La elección se recuerda mientras el módulo
 * está abierto.
 */
export const AvailabilityExportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  sites: ExportSite[];
  hasPharmacies: boolean;
  scopeLabel: string;
  kind: AvailabilityExportKind;
  onKind: (kind: AvailabilityExportKind) => void;
  excluded: ReadonlySet<string>;
  onExcluded: (next: Set<string>) => void;
  busy: boolean;
  onExport: () => void;
}> = ({ open, onClose, sites, hasPharmacies, scopeLabel, kind, onKind, excluded, onExcluded, busy, onExport }) => {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return term ? sites.filter((s) => normalize(`${s.name} ${s.code} ${s.group}`).includes(term)) : sites;
  }, [sites, search]);
  const groups = useMemo(() => {
    const m = new Map<string, ExportSite[]>();
    for (const s of visible) {
      const list = m.get(s.group);
      if (list) list.push(s); else m.set(s.group, [s]);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [visible]);
  const chosen = sites.filter((s) => !excluded.has(s.code)).length;
  const set = (codes: string[], include: boolean) => {
    const next = new Set(excluded);
    for (const c of codes) if (include) next.delete(c); else next.add(c);
    onExcluded(next);
  };
  const quitados = sites.filter((s) => excluded.has(s.code));

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="xl"
      title="Exportar Excel"
      subtitle={scopeLabel}
      footer={
        <>
          <span className="hidden min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-500 md:block">
            {quitados.length ? `Sin ${quitados.length === 1 ? quitados[0].name : `${quitados.length} establecimientos`}` : "Todos los establecimientos"}
          </span>
          <button type="button" onClick={onClose} disabled={busy} className={dialogSecondaryButton}>Cancelar</button>
          <button type="button" onClick={onExport} disabled={busy || chosen === 0} className={dialogPrimaryButton}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{busy ? "Generando el Excel…" : "Descargar Excel"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section>
          <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-400">Qué descargar</p>
          <div role="radiogroup" aria-label="Qué descargar" className="space-y-2">
            {KINDS.map((k) => {
              const disabled = k.id === "pharmacies" && !hasPharmacies;
              const on = kind === k.id && !disabled;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => onKind(k.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border bg-white p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-teal-500 ring-1 ring-teal-500" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500"}`}>{k.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold text-slate-900">{k.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{disabled ? "El TFORMDET no trae farmacias ni puestos comunales." : k.text}</span>
                  </span>
                  <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? "border-teal-600" : "border-slate-300"}`}>
                    {on && <span className="h-2 w-2 rounded-full bg-teal-600" />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>Los establecimientos que se quitan no salen en el Excel y no cuentan en la microred ni en la red: las cifras se recalculan sin ellos.</span>
          </p>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Establecimientos</p>
            <span className="text-[12px] font-bold text-slate-500">{chosen} de {sites.length}</span>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 p-2">
              <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-teal-500">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar establecimiento, código o microred"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
              <button type="button" onClick={() => set(visible.map((s) => s.code), true)} className="shrink-0 px-1 text-[11.5px] font-bold text-teal-700 hover:underline">Todos</button>
              <span className="select-none text-slate-300">|</span>
              <button type="button" onClick={() => set(visible.map((s) => s.code), false)} className="shrink-0 px-1 text-[11.5px] font-bold text-slate-500 hover:underline">Ninguno</button>
            </div>
            <div className="md:max-h-[52vh] md:overflow-y-auto">
              {groups.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12.5px] text-slate-400">Ningún establecimiento coincide.</p>
              ) : (
                groups.map(([group, list]) => {
                  const inGroup = list.filter((s) => !excluded.has(s.code)).length;
                  return (
                    <div key={group}>
                      <button
                        type="button"
                        onClick={() => set(list.map((s) => s.code), inGroup < list.length)}
                        className="flex w-full items-center gap-3 border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-left"
                      >
                        <Box on={inGroup === list.length} partial={inGroup > 0 && inGroup < list.length} />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-black uppercase tracking-wide text-slate-500">{group}</span>
                        <span className="shrink-0 text-[11.5px] font-bold text-slate-400">{inGroup} de {list.length}</span>
                      </button>
                      {list.map((s) => {
                        const on = !excluded.has(s.code);
                        return (
                          <label key={s.code} className={`flex cursor-pointer select-none items-center gap-3 border-b border-slate-100 px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-slate-50 ${on ? "" : "opacity-60"}`}>
                            <input type="checkbox" checked={on} onChange={() => set([s.code], !on)} className="sr-only" />
                            <Box on={on} />
                            <span className="w-[58px] shrink-0 rounded-md border border-teal-100 bg-teal-50 py-0.5 text-center font-mono text-[10.5px] font-bold text-teal-700">{s.code}</span>
                            <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${on ? "text-slate-800" : "text-slate-500 line-through decoration-slate-300"}`}>{s.name}</span>
                            {s.outside && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">Fuera del análisis</span>}
                          </label>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>
    </ResponsiveDialog>
  );
};
