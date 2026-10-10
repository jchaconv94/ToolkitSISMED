import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCcw } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { TableSearch } from "./ui/kit";
import { InfoTip } from "./ui/InfoTip";
import { CodeChip, P, dateText } from "./AvailabilityReports";
import { isOutOfAnalysis, outByDefault, siteChanges, type SiteDecisions } from "../services/availabilitySites";
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
const Check: React.FC<{ checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void; label: string }> = ({ checked, indeterminate = false, disabled = false, onChange, label }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-teal-600 disabled:cursor-default disabled:opacity-60" />;
};

/**
 * «Establecimientos del análisis» (2026-10-09; por jurisdicción desde el 2026-10-10): la lista
 * de establecimientos que cuentan en la disponibilidad. Es una sola: la ven igual todos los que
 * ven esos establecimientos y la cambian la DIRESA y la UNGET de cada uno. Los centros de salud
 * mental comunitario vienen desmarcados.
 */
export const AvailabilitySitesDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  sites: SiteOption[];
  decisions: SiteDecisions;
  /** ¿Puede cambiar este establecimiento? (su rol y su jurisdicción). */
  canEditSite: (code: string) => boolean;
  /** Por qué no se puede cambiar (sin SQL, sin internet, sin permiso). */
  notice?: string;
  onApply: (changes: Array<[string, boolean | null]>) => Promise<boolean>;
}> = ({ open, onClose, sites, decisions, canEditSite, notice, onApply }) => {
  const initialOut = useMemo(() => new Set(sites.filter((s) => isOutOfAnalysis(s.code, s.name, decisions)).map((s) => s.code)), [sites, decisions]);
  const [out, setOut] = useState<Set<string>>(initialOut);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setOut(new Set(initialOut)); setQuery(""); } }, [open, initialOut]);

  const editable = useMemo(() => new Set(sites.filter((s) => canEditSite(s.code)).map((s) => s.code)), [sites, canEditSite]);
  const anyEditable = editable.size > 0;
  const q = fold(query.trim());
  const visible = q ? sites.filter((s) => fold(`${s.code} ${s.name} ${s.group}`).includes(q)) : sites;
  const groups = useMemo(() => {
    const m = new Map<string, SiteOption[]>();
    for (const s of visible) { const l = m.get(s.group); if (l) l.push(s); else m.set(s.group, [s]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")).map(([group, list]) => [group, list.sort((a, b) => a.name.localeCompare(b.name, "es"))] as const);
  }, [visible]);

  const inside = sites.length - sites.filter((s) => out.has(s.code)).length;
  const toggle = (codes: string[], makeOut: boolean) => setOut((cur) => {
    const next = new Set(cur);
    for (const c of codes) if (editable.has(c)) { if (makeOut) next.add(c); else next.delete(c); }
    return next;
  });
  const visibleEditable = visible.filter((s) => editable.has(s.code));
  const allVisibleIn = visibleEditable.every((s) => !out.has(s.code));
  // Restablecer: lo de omisión (solo los C.S.M.C. fuera) en lo que puede cambiar.
  const restore = () => setOut((cur) => {
    const next = new Set(cur);
    for (const s of sites) if (editable.has(s.code)) { if (outByDefault(s.name)) next.add(s.code); else next.delete(s.code); }
    return next;
  });
  const changes = siteChanges(sites.filter((s) => editable.has(s.code)), out, decisions);
  const isDefault = sites.every((s) => !editable.has(s.code) || out.has(s.code) === outByDefault(s.name));
  // Último cambio guardado entre los establecimientos de la lista.
  const last = sites.map((s) => decisions.get(s.code)).filter((d): d is NonNullable<typeof d> => !!d?.updatedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const apply = async () => {
    if (!changes.length) return onClose();
    setBusy(true);
    const ok = await onApply(changes);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Establecimientos del análisis"
      subtitle="Los desmarcados no cuentan en la disponibilidad ni en los demás reportes; se ven aparte."
      top={
        <div className="shrink-0 space-y-2.5 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <TableSearch value={query} onChange={setQuery} placeholder="Buscar establecimiento o microred…" className="md:max-w-none" />
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-slate-600"><b className="text-slate-900">{formatNumber(inside)} de {formatNumber(sites.length)}</b> en el análisis</span>
            <InfoTip title="Establecimientos del análisis" align="right">
              <P>La lista es una sola: la ven igual todos los que ven estos establecimientos. La cambian la DIRESA y la UNGET de cada establecimiento, cada una en su jurisdicción.</P>
              <P>Los centros de salud mental comunitario salen desmarcados por omisión: el tablero nacional de DIGEMID no los cuenta en la disponibilidad de medicamentos esenciales.</P>
              <P>El historial guarda todos los establecimientos y aparta los desmarcados al mostrarlos.</P>
            </InfoTip>
            {anyEditable && (
              <>
                <button type="button" onClick={() => toggle(visibleEditable.map((s) => s.code), allVisibleIn)} className="shrink-0 rounded-lg px-2 py-1 font-bold text-teal-700 hover:bg-teal-50">
                  {allVisibleIn ? "Desmarcar todos" : "Marcar todos"}
                </button>
                <button type="button" onClick={restore} disabled={isDefault} aria-label="Restablecer" title="Volver a la selección de omisión" className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Restablecer</span>
                </button>
              </>
            )}
          </div>
          {notice && <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-600"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{notice}</p>}
        </div>
      }
      footer={
        anyEditable ? (
          <>
            <button type="button" onClick={onClose} disabled={busy} className={dialogSecondaryButton}>Cancelar</button>
            {inside === 0 ? (
              <span className="hidden items-center gap-1.5 text-[12.5px] font-semibold text-red-700 md:ml-auto md:flex"><AlertTriangle className="h-4 w-4" />Marque al menos un establecimiento</span>
            ) : last ? (
              <span className="hidden truncate text-[12px] text-slate-400 md:ml-auto md:block">Último cambio: {last.updatedByName} · {dateText(new Date(last.updatedAt))}</span>
            ) : null}
            <button type="button" disabled={inside === 0 || busy} onClick={apply} className={dialogPrimaryButton}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{changes.length ? "Guardar" : "Listo"}
            </button>
          </>
        ) : (
          <>
            {last && <span className="hidden truncate text-[12px] text-slate-400 md:block">Último cambio: {last.updatedByName} · {dateText(new Date(last.updatedAt))}</span>}
            <button type="button" onClick={onClose} className={`${dialogSecondaryButton} flex-1 md:ml-auto md:flex-none`}>Cerrar</button>
          </>
        )
      }
    >
      {groups.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-slate-500">Ningún establecimiento coincide con la búsqueda.</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([group, list]) => {
            const outCount = list.filter((s) => out.has(s.code)).length;
            const groupEditable = list.some((s) => editable.has(s.code));
            return (
              <div key={group} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <label className={`flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 ${groupEditable ? "cursor-pointer" : ""}`}>
                  <Check checked={outCount === 0} indeterminate={outCount > 0 && outCount < list.length} disabled={!groupEditable} onChange={() => toggle(list.map((s) => s.code), outCount === 0)} label={`Todo ${group}`} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-black uppercase tracking-wider text-slate-500">{group}</span>
                  <span className="shrink-0 text-[12px] font-bold text-slate-400">{list.length - outCount} de {list.length}</span>
                </label>
                <div className="divide-y divide-slate-100">
                  {list.map((s) => {
                    const isIn = !out.has(s.code);
                    const canEdit = editable.has(s.code);
                    return (
                      <label key={s.code} title={!canEdit && anyEditable ? "Es de otra jurisdicción" : undefined} className={`flex min-h-[44px] items-center gap-3 px-4 py-2 ${canEdit ? "cursor-pointer hover:bg-slate-50" : ""}`}>
                        <Check checked={isIn} disabled={!canEdit} onChange={() => toggle([s.code], isIn)} label={s.name} />
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
