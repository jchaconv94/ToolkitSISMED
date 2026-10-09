import React from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { DialogRow, DialogSection, ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { CodeChip, LevelChip, pctText } from "./AvailabilityReports";
import { dmeLevelOf } from "../services/availabilityReport";
import { monthFull } from "../services/availabilityExport";
import type { AvailabilityFormula } from "../services/availabilityConfig";
import { EXCLUDED_LABEL, HISTORY_WINDOW, type HistorySavePlan } from "../services/availabilityHistory";
import { formatNumber } from "../services/numberFormat";

const two = (n: number) => String(n).padStart(2, "0");
/** «05/10/2026 a las 10:30». */
const dateTime = (iso: string) => {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} a las ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Ventana para guardar el mes de corte del reporte en el historial (2026-10-09). Antes de guardar
 * dice qué se guarda, qué se reemplaza (y de quién) y qué queda fuera, con el motivo.
 */
export const AvailabilityHistorySaveDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  plan: HistorySavePlan | null;
  /** Meses anteriores que se pueden llenar con el mismo archivo (TFORMDET de más de 12 meses). */
  backfill: Array<{ plan: HistorySavePlan; selected: boolean }>;
  onToggleBackfill: (month: string) => void;
  pcts: { all: number | null; essential: number | null };
  formula: AvailabilityFormula;
  monthsInFile: number;
  busy: boolean;
  onSave: () => void;
}> = ({ open, onClose, plan, backfill, onToggleBackfill, pcts, formula, monthsInFile, busy, onSave }) => {
  if (!plan) return null;
  const extra = backfill.filter((b) => b.selected).length;
  const month = monthFull(plan.month);
  const last = plan.previous[0];
  const level = (v: number) => <LevelChip level={dmeLevelOf(v, formula.levels)} />;
  const canSave = !plan.blocked && plan.establishments > 0;
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={`Guardar ${month} en el historial`}
      subtitle="Se guarda el resultado de cada establecimiento en las dos vistas. El detalle por producto queda en el TFORMDET."
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={dialogSecondaryButton}>Cancelar</button>
          <button type="button" onClick={onSave} disabled={!canSave || busy} className={dialogPrimaryButton}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{extra ? `Guardar ${extra + 1} meses` : plan.previous.length ? `Reemplazar ${month}` : `Guardar ${month}`}
          </button>
        </>
      }
    >
      {plan.blocked && (
        <p className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {plan.blocked === "open-month"
            ? `${capital(month)} aún no termina: se puede guardar cuando cierre el mes.`
            : `Hacen falta ${HISTORY_WINDOW} meses de consumo y el TFORMDET trae ${monthsInFile}. Descárguelo del Toolkit con 12 meses o más.`}
        </p>
      )}
      {last && !plan.blocked && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <p className="flex items-start gap-2.5 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{capital(month)} ya está guardado: {formatNumber(plan.savedEstablishments)} establecimientos, la última vez por {last.savedByName} el {dateTime(last.savedAt)}.</span>
          </p>
          <p className="mt-1 pl-[26px]">
            Se reemplazan los {formatNumber(plan.establishments)} de este archivo.
            {plan.kept.length > 0 && ` Los ${formatNumber(plan.kept.length)} guardados que no vienen en este archivo se conservan.`}
          </p>
        </div>
      )}
      <DialogSection title="Qué se guarda">
        <DialogRow label="Mes">{capital(month)}</DialogRow>
        <DialogRow label="Establecimientos">{formatNumber(plan.establishments)}</DialogRow>
        <DialogRow label="Todos los productos">{pcts.all !== null ? <span className="flex items-center gap-2">{pctText(pcts.all)} {level(pcts.all)}</span> : "—"}</DialogRow>
        <DialogRow label="Medicamentos esenciales">
          {plan.essentialMissing ? <span className="text-amber-700">No se guarda: el TFORMDET no trae la clasificación (Toolkit 2.2.5)</span> : pcts.essential !== null ? <span className="flex items-center gap-2">{pctText(pcts.essential)} {level(pcts.essential)}</span> : "—"}
        </DialogRow>
        <DialogRow label="Límites">Substock por debajo de {formula.subMax} meses · Sobrestock por encima de {formula.sobreMin} · {formula.truncate ? "meses cortados a un decimal" : "meses sin cortar"}</DialogRow>
      </DialogSection>
      {plan.excluded.length > 0 && (
        <DialogSection title={`No se guardan (${plan.excluded.length})`} className="mt-4">
          {plan.excluded.map((e) => (
            <div key={e.code} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <CodeChip code={e.code} />
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{e.name}</span>
              <span className={`shrink-0 text-[12px] font-semibold ${e.reason === "unreported" ? "text-amber-700" : "text-slate-500"}`}>{EXCLUDED_LABEL[e.reason]}</span>
            </div>
          ))}
        </DialogSection>
      )}
      {backfill.length > 0 && !plan.blocked && (
        <DialogSection title={`Meses anteriores (${backfill.length})`} className="mt-4">
          <p className="flex items-start gap-2.5 px-4 py-3 text-[12.5px] text-slate-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
            El TFORMDET trae más de {HISTORY_WINDOW} meses: estos meses tienen sus {HISTORY_WINDOW} meses de consumo en el archivo y se calculan igual que el corte. Los que ya están guardados se reemplazan solo si los marca.
          </p>
          {backfill.map(({ plan: p, selected }) => (
            <label key={p.month} className={`flex items-center gap-3 px-4 py-2.5 text-[13px] ${p.establishments ? "cursor-pointer hover:bg-slate-50" : "opacity-50"}`}>
              <input type="checkbox" checked={selected} disabled={busy || !p.establishments} onChange={() => onToggleBackfill(p.month)} className="h-4 w-4 shrink-0 accent-teal-600" />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-slate-800">{capital(monthFull(p.month))}</span>
                <span className="block text-[12px] text-slate-500">
                  {formatNumber(p.establishments)} establecimientos{p.excluded.length ? ` · ${p.excluded.length} no se guardan` : ""}
                </span>
              </span>
              <span className={`shrink-0 text-right text-[12px] font-semibold ${p.previous.length ? "text-amber-700" : "text-slate-500"}`}>
                {p.previous.length ? `Guardado por ${p.previous[0].savedByName}` : "Sin guardar"}
              </span>
            </label>
          ))}
        </DialogSection>
      )}
    </ResponsiveDialog>
  );
};
