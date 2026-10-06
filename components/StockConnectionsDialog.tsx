import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, ChevronDown, Code2,
  FileSpreadsheet, Link as LinkIcon, Lock, MoreVertical, Pencil, Plus, RefreshCw, Trash2, UserX, X,
} from "lucide-react";
import { CustomSelect } from "./ui/CustomSelect";
import { useIsDesktop } from "./ui/useIsDesktop";
import { dialogPrimaryButton, dialogSecondaryButton } from "./ui/ResponsiveDialog";

/**
 * Ventana «Conexiones de stock» de Consulta Stock (rediseño aprobado el 2026-10-06).
 *
 * - Escritorio: lista de conexiones a la izquierda y el formulario a la derecha.
 * - Celular: pantalla completa con la lista; «Nueva conexión» (botón flotante) y «Editar»
 *   (menú ⋯ de la tarjeta) abren el formulario en su propia pantalla.
 *
 * Solo dibuja: el estado y las reglas (quién edita cada conexión, AGENTS.md §7 bis) siguen en
 * `SheetSearchModule`, que entrega cada fila ya resuelta en `rows`.
 */
export interface StockConnectionRow {
  key: string;
  name: string;
  slug: string;
  urlText: string;
  kind: "direct" | "gas" | "none";
  errorLabel?: string;
  errorTitle?: string;
  /** Su responsable ya no está activo. */
  orphan: boolean;
  /** Cuenta que la mantiene, si no es la del usuario. */
  owner?: string;
  /** ¿Puede el usuario editarla o quitarla? (`canEditConnection`) */
  editable: boolean;
}

export const StockConnectionsDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  rows: StockConnectionRow[];
  dirty: boolean;
  maxUrlsAllowed?: number | null;
  saving: boolean;
  onSave: () => void;
  // Formulario
  editingIndex: number | null;
  showUngetField: boolean;
  ungetValue: string;
  onUngetChange: (value: string) => void;
  ungetOptions: { value: string; label: string }[];
  editingUngetName: string;
  spreadsheetInput: string;
  onSpreadsheetChange: (value: string) => void;
  spreadsheetCheck: { ok: boolean; message: string } | null;
  checkingSpreadsheet: boolean;
  onCheckSpreadsheet: () => void;
  webAppOpen: boolean;
  onToggleWebApp: () => void;
  webAppInput: string;
  onWebAppChange: (value: string) => void;
  /** Devuelve `true` si la conexión entró a la lista. */
  onSubmit: () => boolean;
  onCancelForm: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onShareHelp: () => void;
  onWebAppGuide: () => void;
}> = (props) => {
  const { open, onClose, rows, dirty, maxUrlsAllowed, saving, onSave, editingIndex } = props;
  const isDesktop = useIsDesktop();
  const [formOpen, setFormOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!open) { setFormOpen(false); setMenuIndex(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, [open]);

  if (!open) return null;

  const editing = editingIndex !== null;
  const showForm = isDesktop || formOpen || editing;
  const hasLimit = typeof maxUrlsAllowed === "number" && maxUrlsAllowed > 0;
  const countText = `${rows.length} configurada${rows.length === 1 ? "" : "s"}${hasLimit ? ` · máximo ${maxUrlsAllowed}` : ""}`;

  const closeForm = () => { props.onCancelForm(); setFormOpen(false); };
  const submit = () => { if (props.onSubmit()) setFormOpen(false); };

  const kindChip = (row: StockConnectionRow) =>
    row.kind === "direct" ? (
      <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-bold text-teal-700"><FileSpreadsheet className="h-3 w-3" />Lectura directa</span>
    ) : row.kind === "gas" ? (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-700" title="Configure la hoja de cálculo para leer sin Apps Script."><Code2 className="h-3 w-3" />Solo Apps Script</span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500"><AlertCircle className="h-3 w-3" />Sin hoja configurada</span>
    );

  const card = (row: StockConnectionRow, index: number) => (
    <div
      key={row.key}
      className={`rounded-2xl border bg-white p-3.5 transition-colors ${editingIndex === index ? "border-teal-500 ring-2 ring-teal-500/20" : "border-slate-200"}`}
    >
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${row.errorLabel ? "bg-red-50 text-red-600" : "bg-teal-50 text-teal-700"}`}>
          <Building2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[14px] font-bold text-slate-900">{row.name}</p>
            {row.slug && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-slate-500">{row.slug}</span>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-slate-400">{row.urlText}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {kindChip(row)}
            {row.errorLabel && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700" title={row.errorTitle}>
                <AlertTriangle className="h-3 w-3" />{row.errorLabel}
              </span>
            )}
            {row.orphan ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">
                <UserX className="h-3 w-3" />Sin responsable{row.owner ? ` (${row.owner})` : ""}{row.editable ? " · puede adoptarla" : ""}
              </span>
            ) : row.owner ? (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500"
                title={row.editable ? undefined : `Solo ${row.owner} puede modificar esta conexión`}
              >
                {!row.editable && <Lock className="h-3 w-3" />}De {row.owner}
              </span>
            ) : null}
          </div>
        </div>
        {row.editable && (isDesktop ? (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => props.onEdit(index)} title="Editar conexión" aria-label={`Editar ${row.name}`} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => props.onRemove(index)} title="Quitar de la lista" aria-label={`Quitar ${row.name}`} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setMenuIndex(index)} aria-label={`Acciones de ${row.name}`} className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 active:bg-slate-100">
            <MoreVertical className="h-5 w-5" />
          </button>
        ))}
      </div>
    </div>
  );

  const list = (
    <>
      {isDesktop && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Conexiones configuradas · {rows.length}</p>
          {hasLimit && <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">Máximo {maxUrlsAllowed}</span>}
        </div>
      )}
      {rows.length > 0 ? (
        <div className="space-y-2.5">{rows.map(card)}</div>
      ) : (
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-200 bg-white px-6 py-10 text-center">
          <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-slate-50 text-slate-300"><LinkIcon className="h-5 w-5" /></span>
          <p className="text-[14px] font-bold text-slate-600">Todavía no hay conexiones</p>
          <p className="mt-1 max-w-[240px] text-[12.5px] text-slate-400">
            {isDesktop ? "Añada la primera con el enlace de la hoja de su UNGET." : "Toque «Nueva conexión» y pegue el enlace de la hoja de su UNGET."}
          </p>
        </div>
      )}
    </>
  );

  const inputBase = "h-11 w-full rounded-xl border border-slate-200 px-3 text-[14px] text-slate-800 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

  const form = (
    <div className="space-y-4">
      {props.showUngetField && (
        <div>
          <span className="mb-1.5 block text-[12.5px] font-bold text-slate-700">UNGET</span>
          {editing ? (
            <input type="text" value={props.editingUngetName} disabled aria-label="UNGET de la conexión" className={`${inputBase} cursor-not-allowed bg-slate-100 font-semibold text-slate-500`} />
          ) : props.ungetOptions.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] font-semibold text-amber-700">Todas las UNGET de su jurisdicción ya están configuradas.</p>
          ) : (
            <CustomSelect
              value={props.ungetValue}
              onChange={props.onUngetChange}
              placeholder="Seleccionar UNGET..."
              ariaLabel="UNGET de la conexión"
              className="h-11 text-[14px]"
              options={props.ungetOptions}
            />
          )}
        </div>
      )}
      <div>
        <label htmlFor="stock-connection-sheet" className="mb-1.5 block text-[12.5px] font-bold text-slate-700">Enlace de la hoja de cálculo</label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="stock-connection-sheet"
              type="url"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={props.spreadsheetInput}
              onChange={(e) => props.onSpreadsheetChange(e.target.value)}
              className={`${inputBase} bg-white pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={props.onCheckSpreadsheet}
            disabled={props.checkingSpreadsheet || !props.spreadsheetInput.trim()}
            className="h-11 shrink-0 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-50"
          >
            {props.checkingSpreadsheet ? "Probando…" : "Probar"}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-slate-500">
          Compártala como «Cualquiera con el enlace: Lector».{" "}
          <button type="button" onClick={props.onShareHelp} className="font-bold text-teal-700 hover:underline">Cómo se hace</button>
        </p>
      </div>
      {props.spreadsheetCheck && (
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-semibold ${props.spreadsheetCheck.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {props.spreadsheetCheck.ok ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0" /> : <AlertCircle className="mt-px h-4 w-4 shrink-0" />}
          {props.spreadsheetCheck.message}
        </div>
      )}
      {/* La Web App es respaldo: se pliega para no confundir a quien configura por primera vez. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <button type="button" onClick={props.onToggleWebApp} aria-expanded={props.webAppOpen} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50">
          <Code2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold text-slate-700">Web App de Apps Script</span>
            <span className="block text-[11.5px] text-slate-500">Opcional · solo si la hoja no se puede compartir</span>
          </span>
          {props.webAppInput.trim() && !props.webAppOpen && <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">Configurada</span>}
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${props.webAppOpen ? "rotate-180" : ""}`} />
        </button>
        {props.webAppOpen && (
          <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-3">
            <input
              type="url"
              placeholder="https://script.google.com/..."
              aria-label="URL de la Web App"
              value={props.webAppInput}
              onChange={(e) => props.onWebAppChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className={`${inputBase} bg-white font-mono text-[12.5px]`}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11.5px] text-slate-500">Con la hoja configurada, la Web App solo se usa como respaldo.</p>
              <button type="button" onClick={props.onWebAppGuide} className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-teal-700 hover:underline">
                Ver guía paso a paso<ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const submitLabel = editing ? "Actualizar en la lista" : "Añadir a la lista";
  const submitIcon = editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />;
  const menuRow = menuIndex !== null ? rows[menuIndex] : null;

  // Celular: la pantalla del formulario reemplaza a la de la lista.
  const mobileForm = !isDesktop && showForm;

  return createPortal(
    <div
      className="fixed inset-0 z-[110000] flex bg-white md:items-center md:justify-center md:bg-slate-900/50 md:p-6 md:backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Conexiones de stock" className="relative flex h-full w-full flex-col bg-white md:h-auto md:max-h-[90vh] md:max-w-5xl md:overflow-hidden md:rounded-2xl md:shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 md:zoom-in-95 md:slide-in-from-bottom-0">
        {/* Cabecera */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-2 md:gap-3 md:px-6 md:py-4">
          {mobileForm ? (
            <button type="button" onClick={closeForm} aria-label="Volver a la lista" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 md:order-last md:h-9 md:w-9 md:text-slate-400">
              <X className="h-5 w-5" />
            </button>
          )}
          <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 md:grid"><FileSpreadsheet className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[17px] font-black text-slate-900">{mobileForm ? (editing ? "Editar conexión" : "Nueva conexión") : "Conexiones de stock"}</h3>
            <p className="truncate text-[12.5px] text-slate-500">
              {mobileForm ? "Conexiones de stock" : isDesktop ? "Vincule la hoja de cálculo de cada UNGET" : countText}
            </p>
          </div>
        </div>

        {/* Cuerpo */}
        {isDesktop ? (
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] overflow-hidden bg-slate-50">
            <div className="min-h-[360px] overflow-y-auto p-6">{list}</div>
            <div className="overflow-y-auto border-l border-slate-200 bg-white p-6">
              <p className="mb-4 text-[15px] font-black text-slate-900">{editing ? "Editar conexión" : "Nueva conexión"}</p>
              {form}
              <div className="mt-5 flex gap-2">
                {editing && <button type="button" onClick={closeForm} className={dialogSecondaryButton}>Cancelar</button>}
                <button type="button" onClick={submit} className={`${dialogPrimaryButton} !ml-0 !flex-1`}>{submitIcon}{submitLabel}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 p-3 pb-24">
            {mobileForm ? <div className="p-1">{form}</div> : list}
          </div>
        )}

        {/* Botón flotante del celular */}
        {!isDesktop && !mobileForm && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="absolute right-4 flex h-14 items-center gap-2 rounded-2xl bg-teal-600 px-5 text-sm font-bold text-white shadow-lg shadow-teal-900/20 transition active:scale-95"
            style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
          >
            <Plus className="h-5 w-5" />Nueva conexión
          </button>
        )}

        {/* Pie */}
        <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-3">
          {mobileForm ? (
            <>
              <button type="button" onClick={closeForm} className={dialogSecondaryButton}>Cancelar</button>
              <button type="button" onClick={submit} className={dialogPrimaryButton}>{submitIcon}{submitLabel}</button>
            </>
          ) : (
            <>
              {dirty && (
                <p className="hidden items-center gap-1.5 text-[12.5px] font-semibold text-amber-700 md:flex">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />Cambios sin guardar
                </p>
              )}
              <button type="button" onClick={onClose} disabled={saving} className={`${dialogSecondaryButton} hidden md:ml-auto md:block`}>Cerrar sin guardar</button>
              <button type="button" onClick={onSave} disabled={saving} className={`${dialogPrimaryButton} md:!ml-0`}>
                <RefreshCw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
                {saving ? "Guardando…" : "Guardar y sincronizar"}
              </button>
            </>
          )}
        </div>

        {/* Menú ⋯ de una conexión (celular) */}
        {!isDesktop && menuRow && (
          <div className="absolute inset-0 z-10 flex items-end bg-slate-900/40" onMouseDown={() => setMenuIndex(null)}>
            <div className="w-full rounded-t-3xl bg-white px-3 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-8 duration-200" onMouseDown={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
              <div className="px-2 pb-2">
                <p className="truncate text-[15px] font-black text-slate-900">{menuRow.name}</p>
                <p className="truncate text-[12px] text-slate-500">{[menuRow.slug, menuRow.owner ? `de ${menuRow.owner}` : "tuya"].filter(Boolean).join(" · ")}</p>
              </div>
              <button type="button" onClick={() => { const i = menuIndex!; setMenuIndex(null); props.onEdit(i); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 active:bg-slate-100">
                <Pencil className="h-5 w-5" />Editar conexión
              </button>
              <button type="button" onClick={() => { const i = menuIndex!; setMenuIndex(null); props.onRemove(i); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-red-600 active:bg-red-50">
                <Trash2 className="h-5 w-5" />Quitar de la lista
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
