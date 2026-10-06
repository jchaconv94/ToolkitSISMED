import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Ventana de formulario o de detalle (pedido del usuario, 2026-10-04: «los modals también se
 * adaptan al teléfono»).
 *
 * - Celular: pantalla completa, como una app: arriba la X y el título, en medio el contenido
 *   con su desplazamiento y abajo los botones fijos.
 * - Escritorio: la misma ventana, centrada (`size`: "md" formulario corto, "lg" con columnas,
 *   "xl" configuración con pestañas y tablas).
 *
 * `top` va fijo bajo el título (p. ej. el avance de un asistente). Con `onSubmit` la ventana es
 * un `<form>`: los botones del pie pueden ser `type="submit"`.
 */
export const ResponsiveDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  top?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  onSubmit?: (event: React.FormEvent) => void;
  /** Mientras guarda, la X, Escape y el fondo no cierran. */
  busy?: boolean;
}> = ({ open, onClose, title, subtitle, children, footer, top, size = "md", onSubmit, busy = false }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, busy]);

  if (!open) return null;

  const panelClass = `flex h-full w-full flex-col bg-white md:h-auto md:max-h-[90vh] md:overflow-hidden md:rounded-2xl md:shadow-2xl ${size === "xl" ? "md:max-w-5xl" : size === "lg" ? "md:max-w-3xl" : "md:max-w-lg"} animate-in fade-in slide-in-from-bottom-4 duration-200 md:zoom-in-95 md:slide-in-from-bottom-0`;
  const content = (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-2 md:px-5 md:py-3.5">
        <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 md:order-last md:h-9 md:w-9 md:text-slate-400">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-black text-slate-900">{title}</h3>
          {subtitle && <p className="truncate text-[12.5px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {top}
      <div className="flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-4 py-4 md:px-6">{children}</div>
      <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-3">
        {footer}
      </div>
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[110000] flex bg-white md:items-center md:justify-center md:bg-slate-900/50 md:p-6 md:backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      {onSubmit ? (
        <form role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit} className={panelClass}>{content}</form>
      ) : (
        <div role="dialog" aria-modal="true" aria-label={title} className={panelClass}>{content}</div>
      )}
    </div>,
    document.body,
  );
};

/** Bloque blanco con título pequeño, para agrupar filas dentro de una ventana. */
export const DialogSection: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({ title, children, className = "" }) => (
  <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>
    {title && <p className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400">{title}</p>}
    <div className="divide-y divide-slate-100">{children}</div>
  </div>
);

/** Fila «etiqueta / valor» de una ventana de detalle. */
export const DialogRow: React.FC<{ label: string; children: React.ReactNode; icon?: React.ReactNode }> = ({ label, children, icon }) => (
  <div className="flex items-center gap-3 px-4 py-3">
    {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
    <div className="min-w-0 flex-1">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="break-words text-[15px] font-semibold text-slate-900">{children}</div>
    </div>
  </div>
);

/** Botones del pie: secundario (contorno) y principal (teal). */
export const dialogSecondaryButton = "h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50";
export const dialogPrimaryButton = "flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 md:ml-auto md:flex-none";
