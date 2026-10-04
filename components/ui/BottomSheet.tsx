import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Cuánto hay que arrastrar hacia abajo (px) para cerrar, o la velocidad que basta con un gesto rápido. */
const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 0.6; // px por ms

/**
 * Panel que sube desde abajo en el celular (filtros, detalle de un registro: AGENTS.md §8).
 * Con `centeredOnDesktop`, en escritorio se abre como ventana centrada, para usar el mismo
 * detalle en las dos vistas.
 *
 * Se cierra con la X, tocando fuera, con Esc o **deslizándolo hacia abajo con el dedo**
 * (pedido del usuario, 2026-10-03): el gesto se toma cuando el contenido está arriba del
 * todo, así no pelea con el desplazamiento del propio panel. `hideTitle` deja el título solo
 * para lectores de pantalla, cuando el contenido ya dice qué es.
 */
export const BottomSheet: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  centeredOnDesktop?: boolean;
  hideTitle?: boolean;
  /** Solo con `centeredOnDesktop`: ventana más ancha en escritorio (detalle con dos columnas). */
  wide?: boolean;
}> = ({ open, title, onClose, children, centeredOnDesktop = false, hideTitle = false, wide = false }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTime: number; dy: number; active: boolean } | null>(null);

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

  const setOffset = (dy: number, animate: boolean) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = animate ? "transform 180ms ease-out" : "none";
    panel.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };

  const onTouchStart = (event: React.TouchEvent) => {
    // Solo si el contenido está arriba: si no, el dedo está desplazando la lista.
    if ((panelRef.current?.scrollTop ?? 0) > 0) return;
    drag.current = { startY: event.touches[0].clientY, startTime: Date.now(), dy: 0, active: false };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const state = drag.current;
    if (!state) return;
    const dy = event.touches[0].clientY - state.startY;
    if (!state.active && dy < 6) return; // hacia arriba o casi nada: es desplazamiento normal
    state.active = true;
    state.dy = Math.max(0, dy);
    setOffset(state.dy, false);
  };
  const onTouchEnd = () => {
    const state = drag.current;
    drag.current = null;
    if (!state?.active) return;
    const velocity = state.dy / Math.max(1, Date.now() - state.startTime);
    if (state.dy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
      setOffset(window.innerHeight, true);
      window.setTimeout(onClose, 160);
    } else {
      setOffset(0, true);
    }
  };

  return createPortal(
    <div className={`fixed inset-0 z-[9400] flex items-end bg-slate-900/50 backdrop-blur-sm ${centeredOnDesktop ? "md:items-center md:justify-center md:p-6" : ""}`} onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={`max-h-[85vh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom duration-200 ${centeredOnDesktop ? `${wide ? "md:max-w-2xl" : "md:max-w-xl"} md:rounded-2xl md:pb-5` : ""}`}
      >
        {hideTitle ? (
          // Sin título, la X va en la fila de la barrita y no ocupa una fila propia.
          <div className="sticky top-0 z-10 flex h-11 items-center justify-center bg-white px-4">
            <div className={`h-1.5 w-12 rounded-full bg-slate-300 ${centeredOnDesktop ? "md:hidden" : ""}`} />
            <h2 className="sr-only">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
        ) : (
          <div className="sticky top-0 z-10 bg-white px-4 pb-2 pt-2.5">
            <div className={`mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300 ${centeredOnDesktop ? "md:hidden" : ""}`} />
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-black text-slate-900">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
          </div>
        )}
        <div className="px-4 pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
