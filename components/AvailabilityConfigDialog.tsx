import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Ban, Calculator, Check, Droplets, FileSpreadsheet, HeartPulse, Info, Layers, Loader2, Pencil, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import {
  DEFAULT_AVAILABILITY_FORMULA, EXCLUSION_REASON_LABEL, availabilityConfigApi, classifyOptionsOf, diffFusedGroups, dmeExcludedCodes, parseFusedCodesSheet, summaryOptionsOf, vitalCodeSet,
  type AvailabilityConfig, type AvailabilityFormula, type CodeEntry, type ExcludedEntry, type ExclusionReason, type FusedCatalog, type FusedGroups, type ScopeRule, type SinRotacionRule,
} from "../services/availabilityConfig";
import { StockStatus } from "../types";
import { buildItems, essentialRows, isLargeVolume, summarize, type AvailabilityRow, type Lot } from "../services/availabilityReport";
import type { VitalProduct } from "../services/vitalProducts";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import { TableSearch, inputClass } from "./ui/kit";
import { TablePagination } from "./ui/TablePagination";

/**
 * Configuración del módulo Disponibilidad (aprobada el 2026-10-06): fórmula, códigos
 * fusionados de DIGEMID, productos vitales y, desde el 2026-10-09, la regla de las soluciones
 * de gran volumen de la ficha 28. Solo el administrador la abre; vale para todos.
 */

type Tab = "formula" | "largeVolume" | "excluded" | "fused" | "vitals";
const PAGE = 25;
/** Las listas de gran volumen y de excluidos van de 10 en 10 (pedido del usuario). */
const LIST_PAGE = 10;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const padCode = (v: string) => {
  const s = v.trim().toUpperCase();
  return /^\d+$/.test(s) && s.length < 5 ? s.padStart(5, "0") : s;
};
const pctText = (p: number) => `${p.toFixed(1).replace(".", ",")} %`;
const monthsLabel = (n: number) => `${String(n).replace(".", ",")} ${n === 1 ? "mes" : "meses"}`;
const dateText = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-teal-600" : "bg-slate-200"}`}>
    <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}>{on && <Check className="h-3 w-3 text-teal-600" />}</span>
  </button>
);

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-bold transition-colors ${v === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
      ))}
    </div>
  );
}

const NumberBox: React.FC<{ value: number; onChange: (v: number) => void; suffix: string; label: string; step?: number }> = ({ value, onChange, suffix, label, step = 1 }) => (
  <label className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5">
    <input type="number" aria-label={label} value={value} step={step} min={0} onChange={(e) => onChange(Number(e.target.value))} className="w-12 bg-transparent text-right font-mono text-[13px] font-bold text-slate-800 outline-none" />
    <span className="text-[12px] font-semibold text-slate-400">{suffix}</span>
  </label>
);

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <p className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400">{title}</p>
    <div className="divide-y divide-slate-100">{children}</div>
  </div>
);
const Row: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
    <div className="min-w-0 flex-1"><p className="text-[13.5px] font-bold text-slate-800">{title}</p>{hint && <p className="text-[12px] text-slate-500">{hint}</p>}</div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

/* ------------------------------------------------------------------ Fórmula */

type Preview = { current: [number, number]; draft: [number, number] } | null;

/** Cómo cambia la disponibilidad con el borrador, antes de guardar. */
const PreviewCard: React.FC<{ preview: Preview }> = ({ preview }) =>
  preview ? (
    <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
      <p className="text-[11px] font-black uppercase tracking-widest text-teal-700">Con los archivos cargados</p>
      {(["Todos los productos", "DME de la UNGET"] as const).map((label, i) => (
        <div key={label} className="mt-3">
          <p className="text-[12px] text-slate-500">{label}</p>
          <p className="text-[20px] font-black text-slate-900">
            {pctText(preview.current[i])}
            {Math.abs(preview.current[i] - preview.draft[i]) > 0.05 && <><span className="mx-1 text-[14px] text-slate-400">→</span><span className="text-teal-700">{pctText(preview.draft[i])}</span></>}
          </p>
        </div>
      ))}
      <p className="mt-3 text-[11.5px] text-slate-500">Cambia al mover los interruptores, antes de guardar.</p>
    </div>
  ) : (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[12.5px] text-slate-500">Cargue y calcule los archivos para ver aquí cómo cambia la disponibilidad antes de guardar.</div>
  );

const FormulaTab: React.FC<{ formula: AvailabilityFormula; onChange: (f: AvailabilityFormula) => void; preview: Preview }> = ({ formula: f, onChange, preview }) => {
  const setRule = (scope: "all" | "essential", patch: Partial<ScopeRule>) => onChange({ ...f, [scope]: { ...f[scope], ...patch } });
  const situations: Array<[Exclude<keyof ScopeRule, "sinRotacion" | "largeVolume">, string, string]> = [
    ["normostock", "Normostock", `${f.subMax} a ${f.sobreMin} meses`],
    ["sobrestock", "Sobrestock", `más de ${f.sobreMin} meses`],
    ["substock", "Substock", `menos de ${f.subMax} meses`],
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400">Qué cuenta como disponible</p>
          <div className="grid grid-cols-[1fr_88px_120px] items-center gap-2 bg-slate-50/60 px-4 py-2 text-[10.5px] font-black uppercase tracking-wider text-slate-400 sm:grid-cols-[1fr_130px_150px]">
            <span>Situación</span><span className="text-center">Todos los productos</span><span className="text-center">Esenciales (DME)</span>
          </div>
          <div className="divide-y divide-slate-100">
            {situations.map(([key, label, hint]) => (
              <div key={key} className="grid grid-cols-[1fr_88px_120px] items-center gap-2 px-4 py-3 sm:grid-cols-[1fr_130px_150px]">
                <span><span className="block text-[13.5px] font-bold text-slate-800">{label}</span><span className="text-[12px] text-slate-500">{hint}</span></span>
                <span className="flex justify-center"><Switch on={f.all[key]} onChange={(v) => setRule("all", { [key]: v })} label={`${label} en todos los productos`} /></span>
                <span className="flex justify-center"><Switch on={f.essential[key]} onChange={(v) => setRule("essential", { [key]: v })} label={`${label} en la DME`} /></span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_88px_120px] items-center gap-2 px-4 py-3 sm:grid-cols-[1fr_130px_150px]">
              <span><span className="block text-[13.5px] font-bold text-slate-800">Sin rotación</span><span className="text-[12px] text-slate-500">stock sin consumo en el periodo</span></span>
              <span className="flex justify-center"><Switch on={f.all.sinRotacion === "yes"} onChange={(v) => setRule("all", { sinRotacion: v ? "yes" : "no" })} label="Sin rotación en todos los productos" /></span>
              <span className="flex justify-center">
                <Segmented<SinRotacionRule> value={f.essential.sinRotacion} onChange={(v) => setRule("essential", { sinRotacion: v })} options={[["no", "No"], ["vital", "Vitales"], ["yes", "Sí"]]} />
              </span>
            </div>
            <div className="grid grid-cols-[1fr_88px_120px] items-center gap-2 px-4 py-3 sm:grid-cols-[1fr_130px_150px]">
              <span><span className="block text-[13.5px] font-bold text-slate-800">Desabastecido</span><span className="text-[12px] text-slate-500">stock 0: nunca disponible</span></span>
              <span className="text-center text-[12px] font-bold text-slate-400">No</span><span className="text-center text-[12px] font-bold text-slate-400">No</span>
            </div>
          </div>
        </div>
        <Card title="Cálculo">
          <Row title="Cortar los meses a un decimal" hint={f.truncate ? "Encendido: 6,03 meses cuenta como 6,0 (Normostock)" : "Apagado: se compara el valor exacto (6,03 meses = Sobrestock)"}>
            <Switch on={f.truncate} onChange={(v) => onChange({ ...f, truncate: v })} label="Cortar los meses a un decimal" />
          </Row>
          <Row title="Límites de la situación" hint="Substock por debajo de · Sobrestock por encima de">
            <NumberBox value={f.subMax} onChange={(v) => onChange({ ...f, subMax: v })} suffix="meses" label="Substock por debajo de" step={0.5} />
            <NumberBox value={f.sobreMin} onChange={(v) => onChange({ ...f, sobreMin: v })} suffix="meses" label="Sobrestock por encima de" step={0.5} />
          </Row>
          <Row title="Microred y UNGET" hint="Cómo se juntan los establecimientos">
            <Segmented<"average" | "sum"> value={f.aggregate} onChange={(v) => onChange({ ...f, aggregate: v })} options={[["average", "Promedio de establecimientos"], ["sum", "Suma de ítems"]]} />
          </Row>
        </Card>
        <Card title="Niveles">
          <Row title="Óptimo · Alto · Regular" hint="Desde qué porcentaje; por debajo de Regular es Bajo">
            <NumberBox value={f.levels.optimo} onChange={(v) => onChange({ ...f, levels: { ...f.levels, optimo: v } })} suffix="%" label="Óptimo desde" />
            <NumberBox value={f.levels.alto} onChange={(v) => onChange({ ...f, levels: { ...f.levels, alto: v } })} suffix="%" label="Alto desde" />
            <NumberBox value={f.levels.regular} onChange={(v) => onChange({ ...f, levels: { ...f.levels, regular: v } })} suffix="%" label="Regular desde" />
          </Row>
        </Card>
      </div>
      <div className="space-y-4">
        <PreviewCard preview={preview} />
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-[12px] text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>La ficha 28 cuenta Normostock y Sobrestock. En Sin rotación «solo se considera a los medicamentos vitales»: con «Vitales», esos cuentan como disponibles y los demás sin rotación no entran en el total. Las soluciones de 1 L o más tienen su propio límite (pestaña «Gran volumen»).</span>
        </div>
        <button type="button" onClick={() => onChange(DEFAULT_AVAILABILITY_FORMULA)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:bg-slate-50">
          <RotateCcw className="h-4 w-4" />Restablecer ficha 28
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Listas guardadas (gran volumen y excluidos) */

/**
 * Agregar o editar un medicamento de una lista: el código SISMED y su nombre. El nombre se
 * completa solo con el del TFORMDET cargado o el del listado de códigos fusionados; si no está
 * en ninguno, se escribe.
 */
const CodeEntryDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  initial: { code: string; name: string; reason?: ExclusionReason } | null;
  withReason?: boolean;
  nameOf: (code: string) => string | undefined;
  /** Por qué no se puede usar ese código (ya está en la lista, o en otra), o nada. */
  taken: (code: string) => string | null;
  onSave: (entry: { code: string; name: string; reason: ExclusionReason }) => void;
}> = ({ open, onClose, title, subtitle, initial, withReason = false, nameOf, taken, onSave }) => {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState<ExclusionReason>("strategic");
  const [autoName, setAutoName] = useState("");
  useEffect(() => {
    if (!open) return;
    setCode(initial?.code ?? "");
    setName(initial?.name ?? "");
    setReason(initial?.reason ?? "strategic");
    setAutoName("");
  }, [open, initial]);
  const editing = !!initial;
  const padded = padCode(code);
  const changedCode = padded !== (initial?.code ?? "");
  // Al escribir otro código, el nombre se completa solo (si no se escribió otro a mano).
  useEffect(() => {
    if (!open || !changedCode) return;
    const found = padded.length >= 5 ? nameOf(padded) || "" : "";
    if (!name || name === autoName || (editing && name === initial?.name)) { setName(found); setAutoName(found); }
  }, [padded]); // eslint-disable-line react-hooks/exhaustive-deps
  const duplicate = changedCode && !!padded ? taken(padded) : null;
  const valid = /^\d{5}$/.test(padded) && !duplicate;
  const label = "mb-1.5 block text-[12.5px] font-bold text-slate-700";
  const choice = (on: boolean) => `rounded-xl border px-3 py-2 text-[12.5px] font-bold ${on ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;
  return (
    <ResponsiveDialog open={open} onClose={onClose} title={title} subtitle={subtitle}
      footer={<><button type="button" onClick={onClose} className={`${dialogSecondaryButton} md:ml-auto`}>Cancelar</button><button type="button" disabled={!valid} onClick={() => onSave({ code: padded, name: name.trim(), reason })} className={`${dialogPrimaryButton} md:!ml-0`}><Check className="h-4 w-4" />{editing ? "Listo" : "Agregar"}</button></>}>
      <div className="space-y-4">
        <label className="block">
          <span className={label}>Código SISMED</span>
          <input autoFocus={!editing} value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} font-mono`} placeholder="08166" inputMode="numeric" />
          {duplicate && <span className="mt-1 block text-[12px] font-semibold text-amber-700">{duplicate}</span>}
        </label>
        <label className="block">
          <span className={label}>Medicamento</span>
          <input autoFocus={editing} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="SOLUCION DE LACTATO SODICO COMPUESTA (LACTATO RINGER) 1 L INYECTABLE" />
          <span className="mt-1 block text-[12px] text-slate-500">{autoName && name === autoName ? "Se completó con el TFORMDET cargado o el listado de fusionados." : "Se completa solo si el código está en el TFORMDET cargado o en el listado de fusionados."}</span>
        </label>
        {withReason && (
          <div>
            <span className={label}>Motivo</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EXCLUSION_REASON_LABEL) as ExclusionReason[]).map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className={choice(reason === r)}>{EXCLUSION_REASON_LABEL[r]}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
};

const iconButton = "grid h-8 w-8 place-items-center rounded-lg text-slate-400 [display:inline-grid]";

/** Nombre de un código en el archivo cargado o en el listado de fusionados. */
const nameLookup = (rows: AvailabilityRow[] | null, groups: FusedGroups) => {
  const byCode = new Map<string, string>();
  for (const r of rows ?? []) if (!byCode.has(r.medCode)) byCode.set(r.medCode, r.description);
  return (code: string) => groups[code]?.name || byCode.get(code) || Object.entries(groups).find(([, g]) => g.codes.includes(code))?.[1].name;
};

/** Solo mientras la lista todavía no está en la base (rige la de fábrica): se ve una vez, hasta guardar. */
const SavedStatus: React.FC<{ stored: boolean; fromServer: boolean }> = ({ stored, fromServer }) =>
  fromServer && !stored ? (
    <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] font-semibold text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" />Lista de fábrica: todavía no está guardada en Supabase. Pulse «Guardar».</p>
  ) : null;

type ListStatus = { stored: boolean; fromServer: boolean };

/** Pide confirmación antes de eliminar (pedido del usuario: nada se elimina sin preguntar). */
const useConfirmDelete = () => {
  const [pending, setPending] = useState<{ title: string; description: string; run: () => void } | null>(null);
  const dialog = (
    <ConfirmationDialog
      isOpen={!!pending}
      title={pending?.title ?? ""}
      description={pending?.description ?? ""}
      confirmLabel="Sí, eliminar"
      cancelLabel="No"
      tone="danger"
      onConfirm={() => { pending?.run(); setPending(null); }}
      onCancel={() => setPending(null)}
    />
  );
  return [setPending, dialog] as const;
};
const SAVE_HINT = "Se quita de la lista; queda eliminado en la base al pulsar «Guardar».";

/* ------------------------------------------------------------------ Gran volumen */

/** Texto de la ficha: va en la columna derecha (y arriba en el celular). */
const LargeVolumeNote: React.FC<{ months: number; className?: string }> = ({ months, className = "" }) => (
  <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`}>
    <p className="flex items-center gap-2 text-[13px] font-bold text-slate-900"><Droplets className="h-4 w-4 shrink-0 text-sky-700" />Ficha 28 · Consideraciones</p>
    <p className="mt-2 text-[12px] italic leading-relaxed text-slate-600">«Para un medicamento que corresponde a una solución de gran volumen (igual o mayor 1 litro) la disponibilidad se considera con un mes de existencia disponible.»</p>
    <p className="mt-2 text-[12px] leading-relaxed text-slate-500">Con la regla, los medicamentos de la lista cuentan como Normostock desde {monthsLabel(months)} de existencia.</p>
  </div>
);

const LargeVolumeTab: React.FC<{ formula: AvailabilityFormula; onChange: (f: AvailabilityFormula) => void; preview: Preview; rows: AvailabilityRow[] | null; groups: FusedGroups; status: ListStatus }> = ({ formula: f, onChange, preview, rows, groups, status }) => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CodeEntry | "new" | null>(null);
  const months = Math.min(f.subMax, f.largeVolumeMonths);
  const codes = useMemo(() => f.largeVolumeList.map((e) => e.code), [f.largeVolumeList]);
  const excluded = useMemo(() => dmeExcludedCodes(f), [f]);
  const nameOf = useMemo(() => nameLookup(rows, groups), [rows, groups]);
  // Filas del archivo cargado: las de la DME, o las de todos los productos si no hay clasificación.
  const source = useMemo(() => {
    if (!rows) return null;
    const dme = essentialRows(rows, groups, excluded);
    return dme.length ? dme : rows.filter((r) => !excluded.has(r.medCode));
  }, [rows, groups, excluded]);
  // De cada medicamento de la lista: en cuántos establecimientos del archivo está y en cuántos
  // pasa de Substock a Normostock con la regla.
  const stats = useMemo(() => {
    if (!source) return null;
    const set = new Set(codes);
    const candidates = source.filter((r) => set.has(r.medCode));
    const base = { truncate: f.truncate, subMax: f.subMax, sobreMin: f.sobreMin };
    const without = buildItems(candidates, undefined, new Date(), base);
    const withRule = buildItems(candidates, undefined, new Date(), { ...base, largeVolumeMonths: f.largeVolumeMonths, largeVolumeCodes: codes });
    const m = new Map<string, { sites: number; changed: number }>();
    without.forEach((it, i) => {
      const e = m.get(it.medCode) || { sites: 0, changed: 0 };
      e.sites++;
      if (it.status === StockStatus.SUBSTOCK && withRule[i].status === StockStatus.NORMOSTOCK) e.changed++;
      m.set(it.medCode, e);
    });
    return m;
  }, [source, codes, f.truncate, f.subMax, f.sobreMin, f.largeVolumeMonths]);
  // Medicamentos del archivo que dicen 1 L o más y no están en la lista: se avisan, no entran solos.
  const suggestions = useMemo(() => {
    const out = new Map<string, CodeEntry>();
    const set = new Set(codes);
    for (const r of source ?? []) if (r.medtip === "M" && isLargeVolume(r.description) && !set.has(r.medCode) && !out.has(r.medCode)) out.set(r.medCode, { code: r.medCode, name: r.description });
    return [...out.values()];
  }, [source, codes]);
  const q = norm(search.trim());
  const shown = f.largeVolumeList.filter((e) => !q || norm(`${e.code} ${e.name}`).includes(q));
  useEffect(() => setPage(1), [q]);
  const changed = stats ? [...stats.values()].reduce((a, s) => a + s.changed, 0) : 0;
  const setRule = (scope: "all" | "essential", v: boolean) => onChange({ ...f, [scope]: { ...f[scope], largeVolume: v } });
  const setList = (list: CodeEntry[]) => onChange({ ...f, largeVolumeList: list });
  const [confirmDelete, confirmDialog] = useConfirmDelete();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-4">
        <LargeVolumeNote months={months} className="lg:hidden" />
        <Card title="Regla">
          <Row title="Aplicar en" hint="Todos los productos · Esenciales (DME)">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-500">Todos <Switch on={!!f.all.largeVolume} onChange={(v) => setRule("all", v)} label="Gran volumen en todos los productos" /></span>
            <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-500">DME <Switch on={!!f.essential.largeVolume} onChange={(v) => setRule("essential", v)} label="Gran volumen en la DME" /></span>
          </Row>
          <Row title="Normostock desde" hint={`Para los demás, ${monthsLabel(f.subMax)} (límite de Substock de la pestaña Fórmula)`}>
            <NumberBox value={f.largeVolumeMonths} onChange={(v) => onChange({ ...f, largeVolumeMonths: Math.max(0, Math.min(f.subMax, v)) })} suffix="meses" label="Normostock desde" step={0.5} />
          </Row>
        </Card>
        {suggestions.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="px-1 text-[12.5px] font-bold text-amber-900">{suggestions.length === 1 ? "1 medicamento del archivo dice 1 L o más y no está en la lista" : `${suggestions.length} medicamentos del archivo dicen 1 L o más y no están en la lista`}</p>
            <div className="mt-2 divide-y divide-amber-100 overflow-hidden rounded-xl border border-amber-100 bg-white">
              {suggestions.map((s) => (
                <div key={s.code} className="flex items-center gap-3 px-3 py-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-500">{s.code}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-slate-800">{s.name}</span>
                  <button type="button" onClick={() => setList([...f.largeVolumeList, s])} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />Agregar</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <EntryTable
          search={search} onSearch={setSearch} placeholder="Buscar medicamento o código…" onAdd={() => setEditing("new")}
          empty={f.largeVolumeList.length === 0 ? "La lista está vacía: la regla no se aplica a ningún medicamento." : null}
          head={<><th className="px-2 py-3 text-center" title="Establecimientos del archivo cargado donde está">EESS</th><th className="w-24 px-2 py-3 text-center">Pasan a Normostock</th></>}
          rows={shown.slice((page - 1) * LIST_PAGE, page * LIST_PAGE).map((e) => {
            const st = stats?.get(e.code);
            return {
              key: e.code, code: e.code, name: e.name || nameOf(e.code) || "",
              action: (
                <span className="inline-flex">
                  <button type="button" onClick={() => setEditing(e)} aria-label={`Editar ${e.code}`} title="Editar código y nombre" className={`${iconButton} hover:bg-slate-100 hover:text-slate-700`}><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => confirmDelete({ title: "¿Eliminar este medicamento de la lista?", description: `${e.code} ${e.name || nameOf(e.code) || ""}. ${SAVE_HINT}`, run: () => setList(f.largeVolumeList.filter((x) => x.code !== e.code)) })} aria-label={`Quitar ${e.code}`} title="Eliminar de la lista" className={`${iconButton} hover:bg-red-50 hover:text-red-600`}><Trash2 className="h-4 w-4" /></button>
                </span>
              ),
              cells: <>
                <td className="px-2 text-center font-mono text-[12.5px] text-slate-600">{st?.sites || "—"}</td>
                <td className={`px-2 text-center font-mono text-[12.5px] font-bold ${st?.changed ? "text-emerald-700" : "text-slate-300"}`}>{st?.changed || "—"}</td>
              </>,
              chips: null,
              detail: !stats ? "Cargue el TFORMDET para ver en cuántos establecimientos está" : st ? <>{st.sites} establecimientos{st.changed > 0 && <> · <b className="text-emerald-700">{st.changed}</b> pasan a Normostock</>}</> : "No está en el archivo cargado",
            };
          })}
          pagination={<TablePagination page={page} pageSize={LIST_PAGE} total={shown.length} onPageChange={setPage} itemLabel="medicamentos" />}
        />
      </div>
      <div className="space-y-4">
        <PreviewCard preview={preview} />
        <LargeVolumeNote months={months} className="hidden lg:block" />
        <SavedStatus {...status} />
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-[12px] text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            {f.largeVolumeList.length} {f.largeVolumeList.length === 1 ? "medicamento" : "medicamentos"} en la lista.
            {stats && (f.essential.largeVolume || f.all.largeVolume
              ? <> Con {monthsLabel(months)}, {changed} {changed === 1 ? "ítem pasa" : "ítems pasan"} de Substock a Normostock en el archivo cargado.</>
              : <> La regla está apagada; encendida, {changed} {changed === 1 ? "ítem pasaría" : "ítems pasarían"} de Substock a Normostock.</>)}
          </span>
        </div>
      </div>
      {confirmDialog}
      <CodeEntryDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Agregar solución de gran volumen" : "Editar solución de gran volumen"}
        subtitle="Medicamento en solución de 1 L o más (ficha 28)"
        initial={editing === "new" || !editing ? null : editing}
        nameOf={nameOf}
        taken={(code) => (excluded.has(code) ? "Ese código está en «Excluidos de la DME»." : codes.includes(code) ? "Ese código ya está en la lista." : null)}
        onSave={({ code, name }) => {
          const entry = { code, name };
          setList(editing === "new" || !editing ? [...f.largeVolumeList, entry] : f.largeVolumeList.map((x) => (x.code === editing.code ? entry : x)));
          setEditing(null);
        }}
      />
    </div>
  );
};

/**
 * Tabla de una lista a mano: buscador y «Agregar» en una línea, tabla en escritorio y tarjetas
 * en el celular. Cada fila trae sus celdas propias y su acción.
 */
const EntryTable: React.FC<{
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  onAdd: () => void;
  empty: string | null;
  head: React.ReactNode;
  rows: Array<{ key: string; code: string; name: string; dim?: boolean; action: React.ReactNode; cells: React.ReactNode; chips: React.ReactNode; detail: React.ReactNode }>;
  pagination: React.ReactNode;
}> = ({ search, onSearch, placeholder, onAdd, empty, head, rows, pagination }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex items-center gap-2 border-b border-slate-100 p-3">
      <TableSearch value={search} onChange={onSearch} placeholder={placeholder} className="md:max-w-none" />
      <button type="button" onClick={onAdd} aria-label="Agregar medicamento" title="Agregar medicamento" className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[13px] font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Agregar</span></button>
    </div>
    {empty ? (
      <p className="px-4 py-6 text-center text-[12.5px] text-slate-500">{empty}</p>
    ) : (
      <>
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.map((r) => (
            <div key={r.key} className={`flex items-start gap-3 px-4 py-3 ${r.dim ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-500">{r.code}</span>{r.chips}</div>
                <p className={`mt-1 text-[13px] font-semibold leading-snug ${r.name ? "text-slate-900" : "text-slate-400"}`}>{r.name || "Sin nombre"}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">{r.detail}</p>
              </div>
              {r.action}
            </div>
          ))}
        </div>
        <div className="scrollbar-x hidden overflow-x-auto md:block">
          <table className="w-full min-w-[560px]">
            <thead><tr className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wide text-slate-500"><th className="px-3 py-3">Código</th><th className="px-3 py-3">Medicamento</th>{head}<th className="px-1 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className={`h-12 ${r.dim ? "opacity-60" : ""}`}>
                  <td className="px-3"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-500">{r.code}</span></td>
                  <td className={`min-w-[190px] px-3 py-2 text-[12.5px] font-semibold leading-snug ${r.name ? "text-slate-900" : "text-slate-400"}`}>{r.name || "Sin nombre"}</td>
                  {r.cells}
                  <td className="whitespace-nowrap px-1 text-right">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination}
      </>
    )}
  </div>
);

/* ------------------------------------------------------------------ Excluidos de la DME */

const EXCLUSION_TONE: Record<ExclusionReason, string> = {
  strategic: "bg-amber-50 text-amber-800",
  national: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-500",
};

const ExcludedNote: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`}>
    <p className="flex items-center gap-2 text-[13px] font-bold text-slate-900"><Ban className="h-4 w-4 shrink-0 text-amber-700" />Ficha 28 · Criterios de exclusión</p>
    <p className="mt-2 text-[12px] italic leading-relaxed text-slate-600">«Medicamento que corresponde a la atención exclusiva para Intervención Estratégica de Salud Pública. Basado en el listado comunicado por DGIESP […] (exclusión automática para todos los EESS evaluados).»</p>
  </div>
);

const ExcludedTab: React.FC<{ formula: AvailabilityFormula; onChange: (f: AvailabilityFormula) => void; preview: Preview; rows: AvailabilityRow[] | null; groups: FusedGroups; status: ListStatus }> = ({ formula: f, onChange, preview, rows, groups, status }) => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ExcludedEntry | "new" | null>(null);
  const nameOf = useMemo(() => nameLookup(rows, groups), [rows, groups]);
  // En cuántos establecimientos del archivo cargado entraría cada uno en la DME.
  const sitesOf = useMemo(() => {
    const m = new Map<string, number>();
    if (!rows) return null;
    for (const r of essentialRows(rows, groups)) {
      const codes = [r.medCode, ...(r.fusedFrom ?? [])];
      for (const e of f.dmeExcluded) if (codes.includes(e.code)) m.set(e.code, (m.get(e.code) || 0) + 1);
    }
    return m;
  }, [rows, groups, f.dmeExcluded]);
  const q = norm(search.trim());
  const shown = f.dmeExcluded.filter((e) => !q || norm(`${e.code} ${e.name} ${EXCLUSION_REASON_LABEL[e.reason]}`).includes(q));
  useEffect(() => setPage(1), [q]);
  const items = sitesOf ? [...sitesOf.values()].reduce((a, n) => a + n, 0) : 0;
  const setList = (list: ExcludedEntry[]) => onChange({ ...f, dmeExcluded: list });
  const [confirmDelete, confirmDialog] = useConfirmDelete();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-4">
        <ExcludedNote className="lg:hidden" />
        <EntryTable
          search={search} onSearch={setSearch} placeholder="Buscar medicamento, código o motivo…" onAdd={() => setEditing("new")}
          empty={f.dmeExcluded.length === 0 ? "No hay medicamentos excluidos: la DME evalúa todos." : null}
          head={<><th className="px-3 py-3 text-center">Motivo</th><th className="px-3 py-3 text-center" title="Establecimientos del archivo cargado donde estaría en la DME">EESS</th></>}
          rows={shown.slice((page - 1) * LIST_PAGE, page * LIST_PAGE).map((e) => ({
            key: e.code, code: e.code, name: e.name || nameOf(e.code) || "",
            action: (
              <span className="inline-flex">
                <button type="button" onClick={() => setEditing(e)} aria-label={`Editar ${e.code}`} title="Editar código, nombre y motivo" className={`${iconButton} hover:bg-slate-100 hover:text-slate-700`}><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => confirmDelete({ title: "¿Eliminar este medicamento de los excluidos?", description: `${e.code} ${e.name || nameOf(e.code) || ""}. Volverá a evaluarse en la DME. ${SAVE_HINT}`, run: () => setList(f.dmeExcluded.filter((x) => x.code !== e.code)) })} aria-label={`Quitar ${e.code}`} title="Eliminar de los excluidos" className={`${iconButton} hover:bg-red-50 hover:text-red-600`}><Trash2 className="h-4 w-4" /></button>
              </span>
            ),
            cells: <>
              <td className="px-3 text-center"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${EXCLUSION_TONE[e.reason]}`}>{EXCLUSION_REASON_LABEL[e.reason]}</span></td>
              <td className="px-3 text-center font-mono text-[12.5px] text-slate-600">{sitesOf ? sitesOf.get(e.code) || "—" : "—"}</td>
            </>,
            chips: <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${EXCLUSION_TONE[e.reason]}`}>{EXCLUSION_REASON_LABEL[e.reason]}</span>,
            detail: sitesOf ? (sitesOf.get(e.code) ? `Sale de la DME en ${sitesOf.get(e.code)} establecimientos del archivo` : "No está en el archivo cargado") : "Cargue el TFORMDET para ver en cuántos establecimientos está",
          }))}
          pagination={<TablePagination page={page} pageSize={LIST_PAGE} total={shown.length} onPageChange={setPage} itemLabel="medicamentos" />}
        />
      </div>
      <div className="space-y-4">
        <PreviewCard preview={preview} />
        <ExcludedNote className="hidden lg:block" />
        <SavedStatus {...status} />
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-[12px] text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>{f.dmeExcluded.length} {f.dmeExcluded.length === 1 ? "medicamento excluido" : "medicamentos excluidos"}.{sitesOf ? ` En el archivo cargado salen ${items} ${items === 1 ? "ítem" : "ítems"} de la DME.` : ""}</span>
        </div>
      </div>
      {confirmDialog}
      <CodeEntryDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Agregar medicamento excluido" : "Editar medicamento excluido"}
        subtitle="No entra en la DME en ningún establecimiento"
        initial={editing === "new" || !editing ? null : editing}
        withReason
        nameOf={nameOf}
        taken={(code) => (f.dmeExcluded.some((e) => e.code === code) ? "Ese código ya está en la lista." : null)}
        onSave={({ code, name, reason }) => {
          const entry = { code, name, reason };
          setList(editing === "new" || !editing ? [...f.dmeExcluded, entry] : f.dmeExcluded.map((x) => (x.code === editing.code ? entry : x)));
          setEditing(null);
        }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ Códigos fusionados */

const GroupEditor: React.FC<{ initial: { target: string; name: string; codes: string[] } | null; open: boolean; onClose: () => void; onSave: (g: { target: string; name: string; codes: string[] }) => void }> = ({ initial, open, onClose, onSave }) => {
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [codes, setCodes] = useState("");
  useEffect(() => {
    if (!open) return;
    setTarget(initial?.target ?? "");
    setName(initial?.name ?? "");
    setCodes((initial?.codes ?? []).join(", "));
  }, [open, initial]);
  const submit = () => {
    const t = padCode(target);
    const list = [...new Set([t, ...codes.split(/[\s,;]+/).map(padCode).filter(Boolean)])];
    if (!t) return toast.error("Indique el código destino.");
    if (list.length < 2) return toast.error("Un grupo necesita al menos otro código que se sume al destino.");
    onSave({ target: t, name: name.trim(), codes: list.sort() });
  };
  return (
    <ResponsiveDialog open={open} onClose={onClose} title={initial ? "Editar grupo" : "Nuevo grupo"} subtitle="Códigos fusionados de la DME"
      footer={<><button type="button" onClick={onClose} className={`${dialogSecondaryButton} md:ml-auto`}>Cancelar</button><button type="button" onClick={submit} className={`${dialogPrimaryButton} md:!ml-0`}>Listo</button></>}>
      <div className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-[12.5px] font-bold text-slate-700">Código destino</span><input value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!initial} className={`${inputClass} font-mono`} placeholder="00091" /></label>
        <label className="block"><span className="mb-1.5 block text-[12.5px] font-bold text-slate-700">Medicamento</span><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="ACIDO ACETILSALICILICO 100 mg TABLETA" /></label>
        <label className="block"><span className="mb-1.5 block text-[12.5px] font-bold text-slate-700">Códigos que se suman</span><textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-[13px] outline-none focus:border-teal-500" placeholder="00091, 00096" /><span className="mt-1 block text-[12px] text-slate-500">Separados por coma o espacio. El código destino se incluye solo.</span></label>
      </div>
    </ResponsiveDialog>
  );
};

const versionFromFile = (name: string) => {
  const m = /(\d{4})[_-](\d{2})[_ -]*V?(\d+(?:\.\d+)*)/i.exec(name);
  return m ? `${m[1]}_${m[2]} V${m[3]}` : name.replace(/\.[^.]+$/, "");
};

const FusedTab: React.FC<{ catalog: FusedCatalog; onChange: (c: FusedCatalog) => void; prev: FusedCatalog | null; meta?: { updatedBy?: string | null; updatedAt?: string | null } }> = ({ catalog, onChange, prev, meta }) => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ file: string; groups: FusedGroups; version: string } | null>(null);
  const [editing, setEditing] = useState<{ target: string; name: string; codes: string[] } | null | "new">(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => Object.entries(catalog.groups).sort(([a], [b]) => a.localeCompare(b)), [catalog]);
  const q = norm(search.trim());
  const rows = useMemo(() => entries.filter(([t, g]) => !q || norm(`${t} ${g.name} ${g.codes.join(" ")}`).includes(q)), [entries, q]);
  useEffect(() => setPage(1), [q]);
  const codeCount = entries.reduce((a, [, g]) => a + g.codes.length, 0);

  const onFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheetName = wb.SheetNames.find((n) => /fusion/i.test(n)) || wb.SheetNames[0];
      const groups = parseFusedCodesSheet(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null }));
      setPending({ file: file.name, groups, version: versionFromFile(file.name) });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo leer el listado.");
    }
  };

  if (pending) {
    const d = diffFusedGroups(catalog.groups, pending.groups);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-teal-700" />
          <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-bold text-slate-900">{pending.file}</p><p className="text-[12px] text-slate-500">{Object.keys(pending.groups).length} grupos · {Object.values(pending.groups).reduce((a, g) => a + g.codes.length, 0)} códigos</p></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {([["Grupos nuevos", d.added.length, "text-emerald-700"], ["Grupos que cambian", d.changed.length, "text-amber-700"], ["Grupos que salen", d.removed.length, "text-red-700"]] as const).map(([l, n, c]) => (
            <div key={l} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[12px] text-slate-500">{l}</p><p className={`text-[24px] font-black ${c}`}>{n}</p></div>
          ))}
        </div>
        <label className="block"><span className="mb-1.5 block text-[12.5px] font-bold text-slate-700">Nombre de la versión</span><input value={pending.version} onChange={(e) => setPending({ ...pending, version: e.target.value })} className={inputClass} /></label>
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-[12.5px] text-slate-600">Al guardar, este listado reemplaza al {catalog.version} para todos. El anterior queda guardado y se puede volver a él.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPending(null)} className={dialogSecondaryButton}>Cancelar</button>
          <button type="button" onClick={() => { onChange({ version: pending.version.trim() || "Sin nombre", groups: pending.groups }); setPending(null); }} className={`${dialogPrimaryButton} md:!ml-0`}>Usar este listado</button>
        </div>
      </div>
    );
  }

  const [confirmDelete, confirmDialog] = useConfirmDelete();
  const removeGroup = (target: string) => confirmDelete({
    title: "¿Eliminar este grupo de códigos fusionados?",
    description: `${target} ${catalog.groups[target]?.name ?? ""}. ${SAVE_HINT}`,
    run: () => {
      const groups = { ...catalog.groups };
      delete groups[target];
      onChange({ ...catalog, groups });
    },
  });

  return (
    <div className="space-y-4">
      <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center">
        <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 md:grid"><FileSpreadsheet className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-slate-900">Listado vigente: {catalog.version}</p>
          <p className="text-[12px] text-slate-500">{entries.length} grupos · {codeCount} códigos{meta?.updatedAt ? ` · guardado por ${meta.updatedBy || "—"} el ${dateText(meta.updatedAt)}` : " · de fábrica"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {prev && <button type="button" onClick={() => onChange(prev)} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 hover:bg-slate-50"><RotateCcw className="h-4 w-4" />Volver a {prev.version}</button>}
          <button type="button" onClick={() => fileInput.current?.click()} className="flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-[13px] font-bold text-white hover:bg-teal-700"><Upload className="h-4 w-4" />Cargar listado nuevo de DIGEMID</button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <TableSearch value={search} onChange={setSearch} placeholder="Buscar código o medicamento…" className="md:max-w-none" />
          <button type="button" onClick={() => setEditing("new")} className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[13px] font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Nuevo grupo</span></button>
        </div>
        <div className="scrollbar-x overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Medicamento</th><th className="px-4 py-3">Códigos que se suman</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice((page - 1) * PAGE, page * PAGE).map(([target, g]) => (
                <tr key={target} className="h-14">
                  <td className="px-4"><span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[12px] font-bold text-teal-700">{target}</span></td>
                  <td className="px-4 text-[13px] font-semibold text-slate-900">{g.name || "—"}</td>
                  <td className="px-4"><div className="flex flex-wrap gap-1">{g.codes.map((c) => <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-500">{c}</span>)}</div></td>
                  <td className="px-4 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setEditing({ target, ...g })} aria-label={`Editar grupo ${target}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 [display:inline-grid]"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => removeGroup(target)} aria-label={`Quitar grupo ${target}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 [display:inline-grid]"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} pageSize={PAGE} total={rows.length} onPageChange={setPage} itemLabel="grupos" />
      </div>
      <GroupEditor
        open={editing !== null}
        initial={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSave={(g) => { onChange({ ...catalog, groups: { ...catalog.groups, [g.target]: { name: g.name, codes: g.codes } } }); setEditing(null); }}
      />
      {confirmDialog}
    </div>
  );
};

/* ------------------------------------------------------------------ Vitales */

const VitalsTab: React.FC<{ vitals: VitalProduct[]; onChange: (v: VitalProduct[]) => void }> = ({ vitals, onChange }) => {
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const missing = vitals.filter((v) => v.codes.length === 0).length;
  const q = norm(search.trim());
  const rows = vitals.filter((v) => (!onlyMissing || v.codes.length === 0) && (!q || norm(`${v.n} ${v.name} ${v.concentration} ${v.codes.join(" ")}`).includes(q)));
  const setCodes = (n: number, codes: string[]) => onChange(vitals.map((v) => (v.n === n ? { ...v, codes } : v)));
  const [confirmDelete, confirmDialog] = useConfirmDelete();
  const add = (v: VitalProduct) => {
    const codes = value.split(/[\s,;]+/).map(padCode).filter(Boolean);
    if (codes.length) setCodes(v.n, [...new Set([...v.codes, ...codes])]);
    setAdding(null);
    setValue("");
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600"><HeartPulse className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-slate-900">Listado Nacional de Productos Farmacéuticos Vitales · RM 1288-2018-MINSA</p>
          <p className="text-[12px] text-slate-500">{vitals.length} productos · {vitals.length - missing} con código SISMED{missing > 0 && <> · <b className="text-amber-700">{missing} sin código</b> (revisar)</>}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center">
          <TableSearch value={search} onChange={setSearch} placeholder="Buscar producto o código…" className="md:max-w-none" />
          <Segmented<"all" | "missing"> value={onlyMissing ? "missing" : "all"} onChange={(v) => setOnlyMissing(v === "missing")} options={[["all", "Todos"], ["missing", `Sin código (${missing})`]]} />
        </div>
        <div className="scrollbar-x max-h-[52vh] overflow-auto">
          <table className="w-full min-w-[720px]">
            <thead><tr className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wide text-slate-500"><th className="px-4 py-3">N°</th><th className="px-4 py-3">Producto vital</th><th className="px-4 py-3">Concentración</th><th className="px-4 py-3">F.F.</th><th className="px-4 py-3">Códigos SISMED</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((v) => (
                <tr key={v.n} className="h-14 align-middle">
                  <td className="px-4 font-mono text-[12px] text-slate-400">{v.n}</td>
                  <td className="px-4 text-[13px] font-semibold text-slate-900">{v.name}{v.presentation && <span className="block text-[11.5px] font-normal text-slate-400">{v.presentation}</span>}</td>
                  <td className="px-4 text-[12.5px] text-slate-600">{v.concentration || "—"}</td>
                  <td className="px-4 text-[12px] text-slate-500">{v.form}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {v.codes.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded bg-slate-100 py-0.5 pl-1.5 pr-0.5 font-mono text-[11px] font-bold text-slate-600">
                          {c}<button type="button" onClick={() => confirmDelete({ title: "¿Quitar este código del vital?", description: `${c} de ${v.name}. ${SAVE_HINT}`, run: () => setCodes(v.n, v.codes.filter((x) => x !== c)) })} aria-label={`Quitar ${c}`} className="grid h-4 w-4 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      {v.codes.length === 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">Sin código</span>}
                      {adding === v.n ? (
                        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(v); if (e.key === "Escape") setAdding(null); }} onBlur={() => add(v)} placeholder="00910" className="h-6 w-20 rounded border border-teal-300 px-1.5 font-mono text-[11px] outline-none" />
                      ) : (
                        <button type="button" onClick={() => { setAdding(v.n); setValue(""); }} className="inline-flex h-6 items-center gap-0.5 rounded border border-dashed border-slate-300 px-1.5 text-[11px] font-bold text-slate-500 hover:border-teal-400 hover:text-teal-700"><Plus className="h-3 w-3" />Código</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
};

/* ------------------------------------------------------------------ Ventana */

export const AvailabilityConfigDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  config: AvailabilityConfig;
  onSaved: (config: AvailabilityConfig) => void;
  /** Filas por IPRESS de los archivos cargados, para la vista previa. */
  previewRows: AvailabilityRow[] | null;
  lots?: Map<string, Lot[]>;
}> = ({ open, onClose, config, onSaved, previewRows }) => {
  const [tab, setTab] = useState<Tab>("formula");
  const [formula, setFormula] = useState(config.formula);
  const [fused, setFused] = useState(config.fused);
  const [vitals, setVitals] = useState(config.vitals);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormula(config.formula);
    setFused(config.fused);
    setVitals(config.vitals);
  }, [open, config]);

  // La regla de gran volumen y los excluidos se guardan dentro de la fórmula, pero tienen su propia
  // pestaña. Una lista que todavía no está en la base (rige la de fábrica) cuenta como cambio sin
  // guardar, para que «Guardar» la deje en Supabase.
  const lvOf = (f: AvailabilityFormula) => JSON.stringify([f.all.largeVolume, f.essential.largeVolume, f.largeVolumeMonths, f.largeVolumeList]);
  const editedLargeVolume = lvOf(formula) !== lvOf(config.formula);
  const editedExcluded = JSON.stringify(formula.dmeExcluded) !== JSON.stringify(config.formula.dmeExcluded);
  const dirtyLargeVolume = editedLargeVolume || (config.fromServer && !config.stored.largeVolume);
  const dirtyExcluded = editedExcluded || (config.fromServer && !config.stored.excluded);
  const dirtyFormula = JSON.stringify(formula) !== JSON.stringify(config.formula) || dirtyLargeVolume || dirtyExcluded;
  const restOf = (f: AvailabilityFormula) => JSON.stringify({ ...f, largeVolumeMonths: 0, largeVolumeList: [], dmeExcluded: [], all: { ...f.all, largeVolume: false }, essential: { ...f.essential, largeVolume: false } });
  const dirtyFormulaRest = restOf(formula) !== restOf(config.formula);
  const dirtyFused = fused !== config.fused;
  const dirtyVitals = JSON.stringify(vitals) !== JSON.stringify(config.vitals);
  const dirty = dirtyFormula || dirtyFused || dirtyVitals;

  // Vista previa: el mismo cálculo del módulo con la fórmula, el listado y los vitales del borrador.
  const preview = useMemo(() => {
    if (!open || !previewRows) return null;
    const pct = (f: AvailabilityFormula, groups: FusedGroups, vit: VitalProduct[]): [number, number] => {
      const today = new Date();
      const vc = vitalCodeSet(vit);
      return [
        summarize(buildItems(previewRows, undefined, today, classifyOptionsOf(f, "all")), summaryOptionsOf(f, "all", vc)).pct,
        summarize(buildItems(essentialRows(previewRows, groups, dmeExcludedCodes(f)), undefined, today, classifyOptionsOf(f, "essential")), summaryOptionsOf(f, "essential", vc)).pct,
      ];
    };
    return { current: pct(config.formula, config.fused.groups, config.vitals), draft: pct(formula, fused.groups, vitals) };
  }, [open, previewRows, config, formula, fused, vitals]);

  const save = async () => {
    setSaving(true);
    try {
      if (dirtyFormula) await availabilityConfigApi.saveFormula(formula);
      if (dirtyFused) await availabilityConfigApi.saveFused(fused);
      if (dirtyVitals) await availabilityConfigApi.saveVitals(vitals);
      onSaved(await availabilityConfigApi.load());
      toast.success("Configuración guardada en Supabase. Se aplica a todos los usuarios.");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  const tabs: Array<[Tab, string, React.ReactNode, boolean]> = [
    ["formula", "Fórmula", <Calculator key="f" className="h-4 w-4" />, dirtyFormulaRest],
    ["largeVolume", "Gran volumen", <Droplets key="g" className="h-4 w-4" />, dirtyLargeVolume],
    ["excluded", "Excluidos de la DME", <Ban key="e" className="h-4 w-4" />, dirtyExcluded],
    ["fused", "Códigos fusionados", <Layers key="c" className="h-4 w-4" />, dirtyFused],
    ["vitals", "Vitales", <HeartPulse key="v" className="h-4 w-4" />, dirtyVitals],
  ];

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      busy={saving}
      size="xl"
      title="Configuración de disponibilidad"
      subtitle="Vale para todos los que usan el módulo · solo la cambia el Administrador"
      top={
        <div className="scrollbar-x flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 md:px-6">
          {tabs.map(([id, label, icon, changed]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[13.5px] font-bold transition-colors ${tab === id ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {icon}{label}{changed && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </button>
          ))}
        </div>
      }
      footer={
        <>
          {!config.fromServer ? (
            <p className="hidden text-[12.5px] font-semibold text-amber-700 md:block">Falta ejecutar SUPABASE_DISPONIBILIDAD_CONFIGURACION.sql para poder guardar.</p>
          ) : dirty ? (
            <p className="hidden items-center gap-1.5 text-[12.5px] font-semibold text-amber-700 md:flex"><span className="h-2 w-2 rounded-full bg-amber-500" />Cambios sin guardar</p>
          ) : null}
          <button type="button" onClick={onClose} disabled={saving} className={`${dialogSecondaryButton} md:ml-auto`}>{dirty ? "Descartar" : "Cerrar"}</button>
          <button type="button" onClick={save} disabled={!dirty || saving || !config.fromServer} className={`${dialogPrimaryButton} md:!ml-0`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      {tab === "formula" && <FormulaTab formula={formula} onChange={setFormula} preview={preview} />}
      {tab === "largeVolume" && <LargeVolumeTab formula={formula} onChange={setFormula} preview={preview} rows={previewRows} groups={fused.groups} status={{ stored: config.stored.largeVolume, fromServer: config.fromServer }} />}
      {tab === "excluded" && <ExcludedTab formula={formula} onChange={setFormula} preview={preview} rows={previewRows} groups={fused.groups} status={{ stored: config.stored.excluded, fromServer: config.fromServer }} />}
      {tab === "fused" && <FusedTab catalog={fused} onChange={setFused} prev={config.fusedPrev} meta={config.meta.fused} />}
      {tab === "vitals" && <VitalsTab vitals={vitals} onChange={setVitals} />}
    </ResponsiveDialog>
  );
};
