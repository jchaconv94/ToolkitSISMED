import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "../../services/tableSort";

/**
 * Encabezado de tabla que se queda arriba al bajar.
 *
 * No se usa `position: sticky` en el `<thead>`: pegado así se queda dentro de la tarjeta, con
 * sus bordes, y en pantalla completa deja un hueco encima. Esta pieza mide las columnas
 * reales y, cuando el encabezado sale de la vista, dibuja una franja fija a todo el ancho del
 * área que hace scroll (el `<main>` de la app o el contenedor de la pantalla completa), con
 * cada título en la misma posición que su columna.
 *
 * Uso: `const { tableRef, floating } = useFloatingTableHead([deps])`, `ref={tableRef}` en la
 * `<table>` y `<FloatingTableHead state={floating} cells={…} />` dentro de la tarjeta.
 */

export type FloatingHeadState = {
  top: number;
  left: number;
  width: number;
  height: number;
  cols: Array<{ left: number; width: number }>;
  /**
   * Parte visible de la tabla cuando su contenedor se desplaza de lado (relativa al área):
   * las columnas que quedan fuera no se dibujan en el encabezado fijo.
   */
  clip?: { left: number; width: number };
};

export type HeadAlign = "left" | "right" | "center";

/** Fondo y línea inferior de cada `<th>`: el mismo en todas las tablas de stock. */
export const tableHeadCellClass = "bg-slate-50 shadow-[inset_0_-1px_0_rgb(226_232_240)]";
/** Letra de los títulos de columna. */
export const tableHeadTextClass = "text-[10px] leading-tight font-black uppercase tracking-wide text-slate-500";

export const headAlignClass = (align: HeadAlign = "left") =>
  align === "right" ? "text-right justify-end" : align === "center" ? "text-center justify-center" : "text-left justify-start";

/** El contenedor que hace scroll. */
const scrollParentOf = (el: HTMLElement): HTMLElement | null => {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    // Solo cuenta si de verdad desplaza en vertical: un contenedor con desplazamiento
    // lateral (overflow-x) también figura como «auto» en vertical, pero no se mueve.
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
};

export const useFloatingTableHead = (deps: React.DependencyList) => {
  const tableRef = useRef<HTMLTableElement>(null);
  const [floating, setFloating] = useState<FloatingHeadState | null>(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) {
      setFloating(null);
      return;
    }
    const update = () => {
      const thead = table.tHead;
      if (!thead || !table.isConnected || table.offsetParent === null) {
        setFloating((prev) => (prev ? null : prev));
        return;
      }
      const scroller = scrollParentOf(table);
      const area = scroller ? scroller.getBoundingClientRect() : { top: 0, left: 0 };
      const width = scroller ? scroller.clientWidth : document.documentElement.clientWidth;
      const head = thead.getBoundingClientRect();
      const body = table.getBoundingClientRect();
      if (head.top >= area.top || body.bottom < area.top + head.height * 2) {
        setFloating((prev) => (prev ? null : prev));
        return;
      }
      const cols = Array.from(thead.rows[0]?.cells ?? []).map((cell) => {
        const r = cell.getBoundingClientRect();
        return { left: r.left - area.left, width: r.width };
      });
      // Contenedor con desplazamiento lateral entre la tabla y el área: recorta el encabezado.
      let clip: FloatingHeadState["clip"];
      let node = table.parentElement;
      while (node && node !== scroller) {
        const { overflowX } = getComputedStyle(node);
        if ((overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") && node.scrollWidth > node.clientWidth) {
          const r = node.getBoundingClientRect();
          clip = { left: r.left - area.left, width: node.clientWidth };
          break;
        }
        node = node.parentElement;
      }
      const next: FloatingHeadState = { top: area.top, left: area.left, width, height: head.height, cols, clip };
      setFloating((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    update();
    // En captura: llega el scroll de cualquier contenedor (el del área y el horizontal de la tabla).
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, deps);

  return { tableRef, floating };
};

export const FloatingTableHead: React.FC<{
  state: FloatingHeadState | null;
  /** Qué dibujar sobre cada columna: `index` es la posición del `<th>` en la fila. */
  cells: Array<{ key: string; index: number; content: React.ReactNode; align?: HeadAlign }>;
  /** Relleno horizontal de las celdas, el mismo que el de los `<th>` de la tabla. */
  padding?: string;
}> = ({ state, cells, padding = "px-2.5" }) => {
  if (!state) return null;
  return (
    <div
      className="fixed z-30 overflow-hidden border-b border-slate-200 bg-slate-50 shadow-[0_6px_12px_-8px_rgba(15,23,42,0.25)]"
      style={{ top: state.top, left: state.left, width: state.width, height: state.height }}
    >
      <div
        className="absolute inset-y-0 overflow-hidden"
        style={state.clip ? { left: state.clip.left, width: state.clip.width } : { left: 0, right: 0 }}
      >
        {cells.map((cell) => {
          const pos = state.cols[cell.index];
          if (!pos) return null;
          return (
            <div
              key={cell.key}
              className={`absolute inset-y-0 flex items-center ${padding} ${tableHeadTextClass} ${headAlignClass(cell.align)}`}
              style={{ left: pos.left - (state.clip?.left ?? 0), width: pos.width }}
            >
              {cell.content}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export type { SortDir };

/** Título de columna que ordena al tocarlo, con la flecha del sentido actual. */
export const SortHeadButton: React.FC<{ label: string; dir: SortDir | null; onClick: () => void }> = ({ label, dir, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-slate-800 ${dir ? "text-teal-700" : ""}`}
  >
    {label}
    {dir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : dir === "desc" ? (
      <ArrowDown className="h-3 w-3" />
    ) : (
      <ArrowUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
    )}
  </button>
);

// La regla vive en services/tableSort.ts (con pruebas); se reexporta para quien ya la usaba aquí.
export { nextSort } from "../../services/tableSort";
