import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import { useIsDesktop } from "./useIsDesktop";

/**
 * Explicación detrás de un ícono «i»: en escritorio, un recuadro flotante bajo el ícono que se
 * dibuja sobre toda la página (portal) y se acomoda dentro de la pantalla, para que no lo corte
 * un panel lateral ni una tarjeta; en el celular, un panel inferior.
 */
export const InfoTip: React.FC<{
  title: string;
  children: React.ReactNode;
  align?: "left" | "right";
  /** En escritorio también se abre al pasar el mouse (se cierra al salir). */
  hover?: boolean;
  /** Tamaño del ícono: `sm` para ir junto a un texto de formulario. */
  size?: "sm" | "md";
}> = ({ title, children, hover = false, size = "md" }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const isDesktop = useIsDesktop();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const WIDTH = 340;
  const leaveTimer = useRef<number | undefined>(undefined);
  const hoverProps = hover && isDesktop
    ? {
        onMouseEnter: () => { window.clearTimeout(leaveTimer.current); setOpen(true); },
        // Un respiro para pasar del ícono al recuadro sin que se cierre.
        onMouseLeave: () => { leaveTimer.current = window.setTimeout(() => setOpen(false), 150); },
      }
    : {};
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left - 12), window.innerWidth - WIDTH - 8);
    const up = r.bottom + 260 > window.innerHeight && r.top > 280;
    setPos({ left, top: up ? r.top - 8 : r.bottom + 8, up });
  };
  useEffect(() => {
    if (!open || !isDesktop) return;
    place();
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    const hide = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="relative inline-flex align-middle normal-case tracking-normal" {...hoverProps}>
      <button
        ref={btn}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label={`Qué es: ${title}`}
        aria-expanded={open}
        className={`grid ${size === "sm" ? "h-5 w-5" : "h-6 w-6"} place-items-center rounded-full transition-colors ${open ? "bg-teal-50 text-teal-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}
      >
        <Info className={size === "sm" ? "h-[15px] w-[15px]" : "h-4 w-4"} />
      </button>
      {isDesktop ? (
        open && pos && createPortal(
          <span
            ref={pop}
            {...hoverProps}
            role="dialog"
            aria-label={title}
            className="fixed z-[100003] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-left text-[12.5px] font-normal leading-relaxed text-slate-600 shadow-xl"
            style={{ left: pos.left, top: pos.top, width: WIDTH, transform: pos.up ? "translateY(-100%)" : undefined }}
          >
            <span className="mb-1.5 block text-[13px] font-black text-slate-900">{title}</span>
            {children}
          </span>,
          document.body,
        )
      ) : (
        <BottomSheet open={open} title={title} onClose={() => setOpen(false)}>
          <div className="pb-4 text-[14px] leading-relaxed text-slate-600">{children}</div>
        </BottomSheet>
      )}
    </span>
  );
};
