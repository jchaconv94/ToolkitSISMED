import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Search, X } from "lucide-react";

export interface DownloadAllItem {
  code: string;
  name: string;
  /** Solo cuando hay varias UNGET a la vista. */
  ungetName?: string;
  /** Hay copia del día: se baja de la nube sin pedir nada a la PC. */
  copy?: boolean;
  /** «Copia de hoy 08:12» o «Se pide a la PC». */
  hint?: string;
}

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * «Descargar todos» de Backups SISMED: se eligen los establecimientos en línea, uno por uno,
 * como en la exportación de Consulta Stock. Empiezan todos marcados.
 */
export const BackupDownloadAllModal: React.FC<{
  items: DownloadAllItem[];
  onClose: () => void;
  onDownload: (items: DownloadAllItem[]) => void;
}> = ({ items, onClose, onDownload }) => {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.map((i) => i.code)));
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return term
      ? items.filter((i) => normalize(`${i.name} ${i.code} ${i.ungetName || ""}`).includes(term))
      : items;
  }, [items, search]);
  const selected = items.filter((i) => chosen.has(i.code));

  const toggle = (code: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const markVisible = (mark: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const i of visible) {
        if (mark) next.add(i.code);
        else next.delete(i.code);
      }
      return next;
    });

  return createPortal(
    <div className="fixed inset-0 z-[999999] flex items-end justify-center bg-black/45 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center px-6 pb-4 pt-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-100 bg-teal-50 text-teal-600">
            <Download className="h-6 w-6" />
          </span>
          <h3 className="mt-3 text-[16px] font-black tracking-tight text-slate-900">Descargar backups</h3>
          <p className="mt-1 text-[12.5px] text-slate-500">Copias del día y establecimientos en línea con cupo.</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 p-2">
              <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-teal-500">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar nombre o código"
                  className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
              <button type="button" onClick={() => markVisible(true)} className="shrink-0 px-1 text-[11px] font-bold text-teal-700 hover:underline">Todos</button>
              <span className="select-none text-slate-300">|</span>
              <button type="button" onClick={() => markVisible(false)} className="shrink-0 px-1 text-[11px] font-bold text-slate-500 hover:underline">Ninguno</button>
            </div>

            <div className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">Ningún establecimiento coincide.</p>
              ) : (
                visible.map((item) => {
                  const on = chosen.has(item.code);
                  return (
                    <label
                      key={item.code}
                      className={`flex cursor-pointer select-none items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-slate-50 ${on ? "" : "opacity-60"}`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(item.code)} className="sr-only" />
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white"}`}>
                        {on && <Check className="h-3 w-3 stroke-[3]" />}
                      </span>
                      <span className="w-[68px] shrink-0 rounded-md border border-teal-100 bg-teal-50 py-0.5 text-center font-mono text-[10.5px] font-bold text-teal-700">
                        {item.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-slate-800">{item.name}</span>
                        {(item.hint || item.ungetName) && (
                          <span className="block truncate text-[10.5px] font-semibold">
                            {item.hint && <span className={item.copy ? "text-emerald-700" : "text-slate-400"}>{item.hint}</span>}
                            {item.hint && item.ungetName && <span className="text-slate-300"> · </span>}
                            {item.ungetName && <span className="text-slate-400">{item.ungetName}</span>}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
          <span className="text-[12px] font-bold text-slate-600">{selected.length} de {items.length}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => onDownload(selected)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-[13px] font-bold text-white hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <Download className="h-4 w-4" /> Descargar {selected.length || ""}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
