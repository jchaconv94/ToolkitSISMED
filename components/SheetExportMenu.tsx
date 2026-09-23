import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronDown, Download, Layers } from "lucide-react";
import { useDropdownPosition } from "../hooks/useDropdownPosition";

export type SheetExportMode = "consolidado" | "detallado";

const MENU_WIDTH = 288;

const OPCIONES = [
  {
    modo: "consolidado" as const,
    titulo: "Consolidado",
    detalle: "Farmacias y puestos comunales sumados por lote, como «Consolidar farmacias» del Toolkit",
    Icono: Layers,
  },
  {
    modo: "detallado" as const,
    titulo: "Por farmacia",
    detalle: "Una fila por farmacia y lote, con el código de cada una",
    Icono: Building2,
  },
];

/**
 * Botón «Exportar Stock» con la elección de modo para hojas con puestos comunales.
 *
 * El menú se pinta en `document.body` con posición fija: dentro de la barra quedaba
 * recortado por la tarjeta (`overflow-hidden`) y tapado por la cabecera sticky de la tabla.
 */
export const SheetExportMenu: React.FC<{ onExport: (modo: SheetExportMode) => void }> = ({ onExport }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { triggerRef, menuStyles } = useDropdownPosition(isOpen, { align: "right", customWidth: MENU_WIDTH });

  return (
    <div ref={triggerRef} className="shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold transition-all shrink-0 whitespace-nowrap cursor-pointer"
      >
        <Download className="h-4 w-4 text-emerald-600 shrink-0" />
        Exportar Stock
        <ChevronDown
          className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
            <div
              role="menu"
              style={{ ...menuStyles, width: MENU_WIDTH }}
              className="fixed z-[9999] bg-white border border-slate-200 rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.05)] overflow-y-auto divide-y divide-slate-100 py-1 animate-in fade-in slide-in-from-top-2 duration-150 text-left"
            >
              {OPCIONES.map(({ modo, titulo, detalle, Icono }) => (
                <button
                  key={modo}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onExport(modo);
                  }}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <Icono className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 leading-tight">
                      {titulo}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium leading-normal">{detalle}</span>
                  </div>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};
