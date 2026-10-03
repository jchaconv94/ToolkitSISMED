import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "warning" | "danger" | "success";
  isConfirming?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const toneStyles = {
  warning: {
    iconBackground: "bg-amber-100",
    iconColor: "text-amber-700",
    accent: "bg-amber-500",
    confirm: "bg-teal-600 hover:bg-teal-700 focus:ring-teal-200"
  },
  danger: {
    iconBackground: "bg-red-100",
    iconColor: "text-red-700",
    accent: "bg-red-500",
    confirm: "bg-red-600 hover:bg-red-700 focus:ring-red-200"
  },
  success: {
    iconBackground: "bg-emerald-100",
    iconColor: "text-emerald-700",
    accent: "bg-emerald-500",
    confirm: "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-200"
  }
} as const;

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "warning",
  isConfirming = false,
  children,
  onConfirm,
  onCancel
}) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const styles = toneStyles[tone];

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => confirmButtonRef.current?.focus(), 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isConfirming) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isConfirming, onCancel]);

  if (!isOpen) return null;
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200000] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !isConfirming) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-3 duration-200"
      >
        <div className={`h-1.5 w-full ${styles.accent}`} />
        <button
          type="button"
          onClick={onCancel}
          disabled={isConfirming}
          aria-label="Cerrar confirmacion"
          className="absolute right-4 top-5 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="px-6 pb-5 pt-7 sm:px-7">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${styles.iconBackground}`}>
            <Icon className={`h-7 w-7 ${styles.iconColor}`} />
          </div>
          <h2 id="confirmation-dialog-title" className="mt-5 pr-8 text-xl font-black tracking-tight text-slate-900">
            {title}
          </h2>
          <p id="confirmation-dialog-description" className="mt-2 text-sm leading-relaxed text-slate-600">
            {description}
          </p>
          {children && <div className="mt-5">{children}</div>}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className={`inline-flex min-w-36 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-white shadow-sm transition-colors focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${styles.confirm}`}
          >
            {isConfirming && <Loader2 className="h-4 w-4 animate-spin" />}
            {isConfirming ? "Procesando..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
};
