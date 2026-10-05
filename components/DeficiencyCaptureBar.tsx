import React, { useState } from "react";
import {
  Camera,
  Download,
  Copy,
  CheckSquare,
  Square,
  AlertTriangle,
  X,
  Eye,
  ChevronDown,
  ChevronUp,
  Layers,
} from "lucide-react";

interface DeficiencyCaptureBarProps {
  selectedCount: number;
  totalVisibleCount: number;
  deficiencyCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onAutoSelectDeficiencies: () => void;
  onOpenPreview: () => void;
  onDirectDownload: () => void;
  onDirectCopy: () => void;
  onExit: () => void;
  isGenerating?: boolean;
}

export const DeficiencyCaptureBar: React.FC<DeficiencyCaptureBarProps> = ({
  selectedCount,
  totalVisibleCount,
  deficiencyCount,
  onSelectAll,
  onDeselectAll,
  onAutoSelectDeficiencies,
  onOpenPreview,
  onDirectDownload,
  onDirectCopy,
  onExit,
  isGenerating = false,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);

  // If minimized, show a sleek floating pill that doesn't block the view of cards below
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="bg-slate-900/95 backdrop-blur-md text-white px-3.5 py-2 rounded-full shadow-2xl border border-slate-700/80 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
              <Camera className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-black tracking-tight text-white">
              {selectedCount} de {totalVisibleCount} seleccionados
            </span>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 text-white px-3 py-1 rounded-full text-xs font-bold transition-all shadow-xs cursor-pointer"
            title="Mostrar panel completo de acciones de captura"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            <span>Mostrar barra de captura</span>
          </button>

          <button
            type="button"
            onClick={onExit}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            title="Salir del modo captura"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] w-[95%] max-w-6xl animate-in slide-in-from-bottom-4 duration-200">
      <div className="bg-slate-900/95 backdrop-blur-md text-white px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-700/80 flex flex-wrap md:flex-nowrap items-center justify-between gap-3">
        {/* Left Section: Identity & Count Badge */}
        <div className="flex items-center justify-between w-full md:w-auto gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white shadow-sm shrink-0">
              <Camera className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] font-black uppercase tracking-wider text-rose-400 leading-tight">
                Modo Captura
              </span>
              <div className="flex items-center gap-1 leading-tight">
                <span className="text-xs sm:text-sm font-black text-white whitespace-nowrap">
                  {selectedCount}{" "}
                  <span className="text-slate-400 font-medium text-xs">
                    de {totalVisibleCount}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Quick buttons on mobile */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              type="button"
              onClick={() => setIsMinimized(true)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Ocultar barra para ver recuadros"
            >
              <ChevronDown className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={onExit}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Salir"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Center Section: Quick Selection Toggles (EN UNA SOLA FILA ESTRICTA) */}
        <div className="flex items-center flex-nowrap justify-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onAutoSelectDeficiencies}
            className="flex items-center gap-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs whitespace-nowrap shrink-0"
            title="Seleccionar automáticamente los que tienen advertencias o están desconectados"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span>Deficiencias ({deficiencyCount})</span>
          </button>

          {selectedCount < totalVisibleCount ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs whitespace-nowrap shrink-0"
            >
              <CheckSquare className="h-3.5 w-3.5 text-teal-400 shrink-0" />
              <span>Todos ({totalVisibleCount})</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onDeselectAll}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs whitespace-nowrap shrink-0"
            >
              <Square className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>Limpiar selección</span>
            </button>
          )}
        </div>

        {/* Right Section: Export Actions & Controls */}
        <div className="flex items-center flex-nowrap justify-end gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={onOpenPreview}
            disabled={selectedCount === 0 || isGenerating}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 border border-slate-700 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40 cursor-pointer shadow-3xs whitespace-nowrap shrink-0"
            title="Abrir vista previa y opciones de exportación A4"
          >
            <Eye className="h-3.5 w-3.5 text-teal-400" />
            <span>Vista Previa</span>
          </button>

          <button
            type="button"
            onClick={onDirectCopy}
            disabled={selectedCount === 0 || isGenerating}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-3 py-1.5 rounded-xl text-xs font-black transition-all shadow-md disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            title="Copiar imagen directamente para WhatsApp (Ctrl + V)"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copiar (WhatsApp)</span>
          </button>

          <button
            type="button"
            onClick={onDirectDownload}
            disabled={selectedCount === 0 || isGenerating}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white px-3 py-1.5 rounded-xl text-xs font-black transition-all shadow-md disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            title="Descargar imagen PNG en alta resolución"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Descargar PNG</span>
          </button>

          <div className="hidden md:flex items-center pl-1 border-l border-slate-700/80 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsMinimized(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
              title="Ocultar barra temporalmente para ver todos los recuadros de abajo"
            >
              <ChevronDown className="h-4 w-4" />
              <span>Ocultar</span>
            </button>

            <button
              type="button"
              onClick={onExit}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Salir del modo captura"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

