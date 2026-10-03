import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Páginas visibles alrededor de la actual: 1 … 4 5 6 … 12. */
const visiblePages = (page: number, totalPages: number): Array<number | "…"> => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: Array<number | "…"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
};

/**
 * Pie de tabla con «Mostrando 1–10 de 22» y los botones de página numerados. Toda tabla del
 * sistema se pagina con este componente, también en el celular: ahí el texto va arriba y
 * los números debajo, a todo el ancho.
 */
export const TablePagination: React.FC<{
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}> = ({ page, pageSize, total, onPageChange, itemLabel = "registros" }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const arrow = "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent sm:h-8 sm:w-8";

  return (
    <div className="flex flex-col items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-500 sm:flex-row sm:justify-between sm:gap-3 sm:px-4">
      <span>
        Mostrando <b className="text-slate-700">{from}–{to}</b> de <b className="text-slate-700">{total.toLocaleString("es-PE")}</b> {itemLabel}
      </span>
      {totalPages > 1 && (
        <nav aria-label="Paginación" className="flex items-center gap-1">
          <button type="button" className={arrow} disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {visiblePages(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-0.5 text-slate-400">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                className={`h-9 min-w-9 rounded-lg px-2 text-xs font-bold transition-colors sm:h-8 sm:min-w-8 ${
                  p === page ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button type="button" className={arrow} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Página siguiente">
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
};
