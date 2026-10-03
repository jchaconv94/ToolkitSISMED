import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Panel que sube desde abajo, para los filtros del celular (AGENTS.md §8: «filtros →
 * bottom sheet»). Se cierra con la X, tocando fuera o con Esc.
 */
export const BottomSheet: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, title, onClose, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9400] flex items-end bg-slate-900/50 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <div className="sticky top-0 z-10 bg-white px-4 pb-2 pt-2.5">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-black text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="px-4 pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
