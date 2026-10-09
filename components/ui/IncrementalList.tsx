import React, { useEffect, useRef, useState } from "react";

/**
 * Listas del celular: no se paginan, se cargan al bajar (pedido del usuario, 2026-10-03).
 *
 * `useIncrementalCount` dice cuántos elementos mostrar y `LoadMoreSentinel`, puesto al final
 * de la lista, pide los siguientes cuando el usuario se acerca al fondo. En escritorio la
 * misma tabla se pagina con `TablePagination`.
 */

/** Cuántos elementos mostrar. Vuelve al primer tramo cuando cambia `resetKey` (búsqueda, filtro). */
export const useIncrementalCount = (total: number, resetKey: unknown, step = 50) => {
  const [count, setCount] = useState(step);
  useEffect(() => setCount(step), [resetKey, step]);
  return {
    count: Math.min(count, total),
    hasMore: count < total,
    loadMore: () => setCount(current => current + step),
    /** Muestra al menos `n` elementos (para llegar a uno que está más abajo). */
    showAtLeast: (n: number) => setCount(current => Math.max(current, Math.ceil(n / step) * step)),
  };
};

/** Marca invisible al final de la lista: al acercarse a ella se cargan los siguientes. */
export const LoadMoreSentinel: React.FC<{
  hasMore: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number;
  itemLabel?: string;
}> = ({ hasMore, onLoadMore, shown, total, itemLabel = "registros" }) => {
  const ref = useRef<HTMLDivElement>(null);
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore.current();
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, shown]);

  if (total === 0) return null;
  return (
    <div ref={ref} className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-400">
      {hasMore ? (
        // Respaldo por si el navegador no avisa al llegar al fondo.
        <button type="button" onClick={onLoadMore} className="font-bold text-teal-700">
          Cargar más · {shown.toLocaleString("es-PE")} de {total.toLocaleString("es-PE")} {itemLabel}
        </button>
      ) : (
        <span>{total.toLocaleString("es-PE")} {itemLabel} · fin de la lista</span>
      )}
    </div>
  );
};
