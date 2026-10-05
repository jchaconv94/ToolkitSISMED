import { CSSProperties, useEffect, useRef, useState } from "react";

/** Clases de una barra de buscador y filtros que se queda arriba al bajar (solo en el celular). */
export const stickyBarClass = "sticky -top-2.5 z-20";

const scrollParentOf = (node: HTMLElement): HTMLElement | Window => {
  let current = node.parentElement;
  while (current) {
    if (/(auto|scroll)/.test(getComputedStyle(current).overflowY)) return current;
    current = current.parentElement;
  }
  return window;
};

/**
 * Barra del buscador y los filtros de una tabla en el celular (AGENTS.md §8): al bajar se queda
 * arriba y, mientras está pegada, ocupa **todo el ancho de la pantalla**, sin bordes ni esquinas,
 * como la cabecera de la app (pedido del usuario, 2026-10-05).
 *
 * Se usa con `stickyBarClass` (más el `md:static` o `sm:static` que corresponda): la barra solo
 * se estira cuando de verdad está pegada, así que en escritorio, donde es estática, no hace nada.
 *
 *   const bar = useStickyBar<HTMLDivElement>();
 *   <div ref={bar.ref} style={bar.style} className={`${stickyBarClass} bg-white md:static`}>…</div>
 */
export const useStickyBar = <T extends HTMLElement>() => {
  // Ref de función: la barra puede aparecer después (al terminar de cargar) y hay que engancharla.
  const [node, ref] = useState<T | null>(null);
  const [edges, setEdges] = useState<{ left: number; right: number } | null>(null);
  /** Relleno propio de la barra (sin pegar): una barra sin relleno, fuera de una tarjeta, lo gana al pegarse. */
  const basePadding = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!node) { setEdges(null); return; }
    const root = scrollParentOf(node);
    let frame = 0;

    const measure = () => {
      frame = 0;
      const style = getComputedStyle(node);
      const parent = node.parentElement;
      if (style.position !== "sticky" || !parent) { setEdges(null); return; }
      if (!node.style.marginLeft) {
        basePadding.current = {
          x: Math.min(parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingRight) || 0),
          y: Math.min(parseFloat(style.paddingTop) || 0, parseFloat(style.paddingBottom) || 0),
        };
      }
      const rootTop = root instanceof Window ? 0 : root.getBoundingClientRect().top;
      const rootPadding = root instanceof Window ? 0 : parseFloat(getComputedStyle(root).paddingTop) || 0;
      const top = parseFloat(style.top) || 0;
      const barTop = node.getBoundingClientRect().top;
      // El navegador mide el `top` desde el borde o desde el relleno del área que se desplaza:
      // se aceptan las dos posiciones.
      const stuck = (Math.abs(barTop - (rootTop + top)) < 1.5 || Math.abs(barTop - (rootTop + rootPadding + top)) < 1.5)
        && (root instanceof Window ? window.scrollY : root.scrollTop) > 0;
      if (!stuck) { setEdges(null); return; }
      // Desde el contenido del contenedor hasta los bordes de la pantalla.
      const box = parent.getBoundingClientRect();
      const parentStyle = getComputedStyle(parent);
      const left = box.left + parseFloat(parentStyle.borderLeftWidth) + parseFloat(parentStyle.paddingLeft);
      const right = document.documentElement.clientWidth - (box.right - parseFloat(parentStyle.borderRightWidth) - parseFloat(parentStyle.paddingRight));
      setEdges(prev => (prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.right - right) < 0.5 ? prev : { left, right }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };

    measure();
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [node]);

  const style: CSSProperties | undefined = edges
    ? {
        marginLeft: -edges.left,
        marginRight: -edges.right,
        paddingLeft: Math.max(basePadding.current.x, 12),
        paddingRight: Math.max(basePadding.current.x, 12),
        paddingTop: Math.max(basePadding.current.y, 8),
        paddingBottom: Math.max(basePadding.current.y, 8),
        borderRadius: 0,
        backgroundColor: "#ffffff",
        boxShadow: "0 1px 0 0 rgb(226 232 240), 0 6px 12px -8px rgb(15 23 42 / 0.18)",
      }
    : undefined;

  return { ref, style, stuck: Boolean(edges) };
};
