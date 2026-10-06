import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Code2, ExternalLink, FileSpreadsheet, Link as LinkIcon, Loader2, Lock, RefreshCw, Save } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";

/**
 * Engranaje de una UNGET en Consulta Stock (rediseño aprobado el 2026-10-06): la conexión
 * completa de esa UNGET, con la hoja de cálculo como vía principal y la Web App como respaldo
 * plegado. Antes solo ofrecía la Web App y, en las conexiones de lectura directa, ponía la
 * dirección interna de la hoja (`sheets://…`) en su campo, así que «Probar» siempre fallaba.
 *
 * Solo dibuja: guardar, probar y quién puede cambiarla (`readOnly`, AGENTS.md §7 bis) se
 * resuelven en `SheetSearchModule`.
 */
export const StockConnectionDetailDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  name: string;
  subtitle?: string;
  kind: "direct" | "gas" | "none";
  /** Etiqueta del último error de lectura, si lo hubo. */
  errorLabel?: string;
  errorTitle?: string;
  /** Establecimientos leídos de esta conexión. */
  establishmentCount: number;
  owner?: string;
  orphan: boolean;
  /** Conexión de otra cuenta: se prueba, no se cambia. */
  readOnly: boolean;
  spreadsheetInput: string;
  onSpreadsheetChange: (value: string) => void;
  spreadsheetUrl?: string;
  spreadsheetCheck: { ok: boolean; message: string } | null;
  checkingSpreadsheet: boolean;
  onCheckSpreadsheet: () => void;
  webAppOpen: boolean;
  onToggleWebApp: () => void;
  webAppInput: string;
  onWebAppChange: (value: string) => void;
  testingWebApp: boolean;
  onTestWebApp: () => void;
  webAppTest: { success: boolean; message: string } | null;
  onShareHelp: () => void;
  onWebAppGuide: () => void;
  saving: boolean;
  onSave: () => void;
}> = (p) => {
  const input = "h-11 w-full rounded-xl border border-slate-200 px-3 text-[14px] text-slate-800 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";
  const locked = p.readOnly ? "bg-slate-100 text-slate-500" : "bg-white";
  const ownerText = p.orphan ? `Sin responsable${p.owner ? ` (${p.owner})` : ""}` : p.owner || "usted";

  return (
    <ResponsiveDialog
      open={p.open}
      onClose={p.onClose}
      busy={p.saving}
      title={`Conexión de ${p.name}`}
      subtitle={p.subtitle}
      footer={p.readOnly ? (
        <button type="button" onClick={p.onClose} className={`${dialogSecondaryButton} flex-1 md:ml-auto md:flex-none`}>Cerrar</button>
      ) : (
        <>
          <button type="button" onClick={p.onClose} disabled={p.saving} className={`${dialogSecondaryButton} md:ml-auto`}>Cancelar</button>
          <button type="button" onClick={p.onSave} disabled={p.saving} className={`${dialogPrimaryButton} md:!ml-0`}>
            {p.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {p.saving ? "Guardando…" : "Guardar y sincronizar"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {p.readOnly && (
          <div className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>La mantiene <b>{p.owner}</b>, el informático de esta UNGET. Usted puede probarla para saber por qué no conecta, pero no cambiarla.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-3">
          {p.kind === "direct" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-bold text-teal-700"><FileSpreadsheet className="h-3 w-3" />Lectura directa</span>
          ) : p.kind === "gas" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-700"><Code2 className="h-3 w-3" />Solo Apps Script</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500"><AlertCircle className="h-3 w-3" />Sin hoja configurada</span>
          )}
          {p.errorLabel ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700" title={p.errorTitle}><AlertTriangle className="h-3 w-3" />{p.errorLabel}</span>
          ) : p.establishmentCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />Conectada · {p.establishmentCount} establecimiento{p.establishmentCount === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="ml-auto text-[11.5px] text-slate-500">Responsable: <b className={p.orphan ? "text-amber-700" : "text-slate-700"}>{ownerText}</b></span>
        </div>

        <div>
          <label htmlFor="stock-connection-detail-sheet" className="mb-1.5 block text-[12.5px] font-bold text-slate-700">Enlace de la hoja de cálculo</label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="stock-connection-detail-sheet"
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={p.spreadsheetInput}
                onChange={(e) => p.onSpreadsheetChange(e.target.value)}
                readOnly={p.readOnly}
                className={`${input} ${locked} pl-9`}
              />
            </div>
            <button
              type="button"
              onClick={p.onCheckSpreadsheet}
              disabled={p.checkingSpreadsheet || !p.spreadsheetInput.trim()}
              className="h-11 shrink-0 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-50"
            >
              {p.checkingSpreadsheet ? "Probando…" : "Probar"}
            </button>
            {p.spreadsheetUrl && (
              <a href={p.spreadsheetUrl} target="_blank" rel="noreferrer" title="Abrir la hoja" aria-label="Abrir la hoja" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-slate-500">
            Compártala como «Cualquiera con el enlace: Lector».{" "}
            <button type="button" onClick={p.onShareHelp} className="font-bold text-teal-700 hover:underline">Cómo se hace</button>
          </p>
        </div>
        {p.spreadsheetCheck && (
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-semibold ${p.spreadsheetCheck.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {p.spreadsheetCheck.ok ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-px h-4 w-4 shrink-0" />}
            <span>{p.spreadsheetCheck.message}{!p.spreadsheetCheck.ok && p.readOnly && p.owner ? ` Pídale a ${p.owner} que la revise.` : ""}</span>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button type="button" onClick={p.onToggleWebApp} aria-expanded={p.webAppOpen} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50">
            <Code2 className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-slate-700">Web App de Apps Script</span>
              <span className="block text-[11.5px] text-slate-500">Opcional · respaldo si la hoja no se puede compartir</span>
            </span>
            {!p.webAppOpen && (
              <span className="hidden shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500 sm:inline">
                {p.webAppInput.trim() ? "Configurada" : "Sin configurar"}
              </span>
            )}
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${p.webAppOpen ? "rotate-180" : ""}`} />
          </button>
          {p.webAppOpen && (
            <div className="space-y-2.5 border-t border-slate-100 px-3 pb-3 pt-3">
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://script.google.com/macros/s/.../exec"
                  aria-label="URL de la Web App"
                  value={p.webAppInput}
                  onChange={(e) => p.onWebAppChange(e.target.value)}
                  readOnly={p.readOnly}
                  className={`${input} ${locked} min-w-0 flex-1 font-mono text-[12.5px]`}
                />
                <button
                  type="button"
                  onClick={p.onTestWebApp}
                  disabled={p.testingWebApp || !p.webAppInput.trim()}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${p.testingWebApp ? "animate-spin" : ""}`} />Probar
                </button>
              </div>
              {p.webAppTest && (
                <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-semibold ${p.webAppTest.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {p.webAppTest.success ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-px h-4 w-4 shrink-0" />}
                  {p.webAppTest.message}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11.5px] text-slate-500">Debe terminar en /exec y tener acceso «Cualquier persona».</p>
                <button type="button" onClick={p.onWebAppGuide} className="shrink-0 text-[12px] font-bold text-teal-700 hover:underline">Cómo crearla</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
};
