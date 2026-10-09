import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { TableSearch } from "./ui/kit";
import { InfoTip } from "./ui/InfoTip";
import { CodeChip, P } from "./AvailabilityReports";
import { isOutOfAnalysis, outByDefault, prefsFromSelection, type SitePrefs } from "../services/availabilitySites";
import { formatNumber } from "../services/numberFormat";

export interface SiteOption {
  code: string;
  name: string;
  /** Microred (o «UNGET · microred» si hay varias UNGET). */
  group: string;
  category?: string;
}

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Casilla con estado intermedio (para marcar o desmarcar un grupo entero). */
const Check: React.FC<{ checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }> = ({ checked, indeterminate = false, onChange, label }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-teal-600" />;
};

/**
 * «Establecimientos del análisis» (2026-10-09): lista para dejar establecimientos fuera del
 * cálculo de disponibilidad. Los centros de salud mental comunitario vienen desmarcados.
 */
export const AvailabilitySitesDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  sites: SiteOption[];
  prefs: SitePrefs;
  onApply: (prefs: SitePrefs) => void;
}> = ({ open, onClose, sites, prefs, onApply }) => {
  const initialOut = useMemo(() => new Set(sites.filter((s) => isOutOfAnalysis(s.code, s.name, prefs)).map((s) => s.code)), [sites, prefs]);
  const [out, setOut] = useState<Set<string>>(initialOut);
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) { setOut(new Set(initialOut)); setQuery(""); } }, [open, initialOut]);

  const q = fold(query.trim());
  const visible = q ? sites.filter((s) => fold(`${s.code} ${s.name} ${s.group}`).includes(q)) : sites;
  const groups = useMemo(() => {
    const m = new Map<string, SiteOption[]>();
    for (const s of visible) { const l = m.get(s.group); if (l) l.push(s); else m.set(s.group, [s]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")).map(([group, list]) => [group, list.sort((a, b) => a.name.localeCompare(b.name, "es"))] as const);
  }, [visible]);

  const inside = sites.length - sites.filter((s) => out.has(s.code)).length;
  const defaults = sites.filter((s) => outByDefault(s.name)).map((s) => s.code);
  const isDefault = out.size === defaults.length && defaults.every((c) => out.has(c));
  const toggle = (codes: string[], makeOut: boolean) => setOut((cur) => {
    const next = new Set(cur);
    for (const c of codes) if (makeOut) next.add(c); else next.delete(c);
    return next;
  });
  const allVisibleIn = visible.every((s) => !out.has(s.code));

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Establecimientos del análisis"
      subtitle="Los desmarcados no cuentan en la disponibilidad ni en los demás reportes; se ven aparte."
      top={
        <div className="shrink-0 space-y-2.5 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <TableSearch value={query} onChange={setQuery} placeholder="Buscar establecimiento o microred…" className="md:max-w-none" />
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-slate-600"><b className="text-slate-900">{formatNumber(inside)} de {formatNumber(sites.length)}</b> en el análisis</span>
            <InfoTip title="Establecimientos del análisis" align="right">
              <P>Los centros de salud mental comunitario salen desmarcados por omisión: el tablero nacional de DIGEMID no los cuenta en la disponibilidad de medicamentos esenciales.</P>
              <P>La selección es personal y queda en este equipo: no cambia lo que ven los demás. El historial guarda todos los establecimientos y aparta los desmarcados al mostrarlos.</P>
            </InfoTip>
            <button type="button" onClick={() => toggle(visible.map((s) => s.code), allVisibleIn)} className="shrink-0 rounded-lg px-2 py-1 font-bold text-teal-700 hover:bg-teal-50">
              {allVisibleIn ? "Desmarcar todos" : "Marcar todos"}
            </button>
            <button type="button" onClick={() => setOut(new Set(defaults))} disabled={isDefault} aria-label="Restablecer" title="Volver a la selección de omisión" className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40">
              <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Restablecer</span>
            </button>
          </div>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={dialogSecondaryButton}>Cancelar</button>
          {inside === 0 && <span className="hidden items-center gap-1.5 text-[12.5px] font-semibold text-red-700 md:ml-auto md:flex"><AlertTriangle className="h-4 w-4" />Marque al menos un establecimiento</span>}
          <button type="button" disabled={inside === 0} onClick={() => { onApply(prefsFromSelection(sites, out, prefs)); onClose(); }} className={dialogPrimaryButton}>
            <CheckCircle2 className="h-4 w-4" />Aplicar
          </button>
        </>
      }
    >
      {groups.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-slate-500">Ningún establecimiento coincide con la búsqueda.</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([group, list]) => {
            const outCount = list.filter((s) => out.has(s.code)).length;
            return (
              <div key={group} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                  <Check checked={outCount === 0} indeterminate={outCount > 0 && outCount < list.length} onChange={() => toggle(list.map((s) => s.code), outCount === 0)} label={`Todo ${group}`} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-black uppercase tracking-wider text-slate-500">{group}</span>
                  <span className="shrink-0 text-[12px] font-bold text-slate-400">{list.length - outCount} de {list.length}</span>
                </label>
                <div className="divide-y divide-slate-100">
                  {list.map((s) => {
                    const isIn = !out.has(s.code);
                    return (
                      <label key={s.code} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-50">
                        <Check checked={isIn} onChange={() => toggle([s.code], isIn)} label={s.name} />
                        <CodeChip code={s.code} />
                        <span className={`min-w-0 flex-1 truncate text-[13.5px] font-semibold ${isIn ? "text-slate-900" : "text-slate-400"}`}>{s.name}</span>
                        {outByDefault(s.name) && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Salud mental</span>}
                        {s.category && <span className="hidden w-10 shrink-0 text-right text-[11.5px] text-slate-400 sm:block">{s.category}</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ResponsiveDialog>
  );
};
