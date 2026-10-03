import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search, X } from "lucide-react";
import { AppModule } from "../types";
import { NAV_HOME, NAV_TINT_CLASSES, NavItem, NavTint, visibleNavSections } from "./navigation";
import { searchTools } from "./toolSearchFilter";

/**
 * Buscador de herramientas (paso 4 de la reestructuración, 2026-10-03).
 *
 * Solo busca herramientas del menú, y solo las que el usuario puede abrir: sale de
 * `navigation.ts`, igual que la barra lateral y el Inicio. Se abre con el campo de la
 * cabecera, con la lupa en el teléfono o con Ctrl+K / ⌘K desde cualquier pantalla.
 */

interface ToolSearchProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: AppModule) => void;
  hasPermission: (module: AppModule) => boolean;
}

export const ToolSearchDialog: React.FC<ToolSearchProps> = ({ open, onClose, onNavigate, hasPermission }) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const sections = useMemo(() => visibleNavSections(hasPermission), [hasPermission]);
  const results = useMemo(() => searchTools(sections, query, NAV_HOME), [sections, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = previo;
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (item: NavItem) => {
    onClose();
    onNavigate(item.module);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      choose(results[active].item);
    }
  };

  // Agrupa por sección conservando el orden de los resultados.
  let lastSection: string | null = null;

  return createPortal(
    <div className="fixed inset-0 z-[9500] flex items-start justify-center bg-slate-900/50 backdrop-blur-sm md:p-6 md:pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar herramienta"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl md:h-auto md:max-h-[70vh] md:max-w-xl md:rounded-2xl md:border md:border-slate-200 animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 pt-[env(safe-area-inset-top)] md:pt-0">
          <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar herramienta"
            aria-label="Buscar herramienta"
            role="combobox"
            aria-expanded="true"
            aria-controls="buscador-resultados"
            aria-activedescendant={results[active] ? `buscador-${results[active].item.module}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[12px] font-bold text-slate-500 hover:bg-slate-100 md:hidden">
            Cancelar
          </button>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:block">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul ref={listRef} id="buscador-resultados" role="listbox" className="flex-1 overflow-y-auto p-2 md:flex-none">
          {results.length === 0 && (
            <li className="px-4 py-10 text-center text-[13px] text-slate-500">
              No hay herramientas que coincidan con «{query.trim()}».
            </li>
          )}
          {results.map(({ item, sectionLabel, tint }, index) => {
            const header = sectionLabel !== lastSection ? sectionLabel : null;
            lastSection = sectionLabel;
            const Icon = item.icon;
            const on = index === active;
            return (
              <React.Fragment key={item.module}>
                {header && (
                  <li role="presentation" className="px-3 pb-1 pt-3 text-[10.5px] font-black uppercase tracking-widest text-slate-400 first:pt-1">
                    {header}
                  </li>
                )}
                <li
                  id={`buscador-${item.module}`}
                  role="option"
                  aria-selected={on}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${on ? "bg-slate-100" : ""}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${NAV_TINT_CLASSES[tint as NavTint].chip}`}>
                    <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-slate-900">{item.label}</span>
                    <span className="block truncate text-[12px] text-slate-500">{item.description}</span>
                  </span>
                  {on && <CornerDownLeft aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-slate-400 md:block" />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        <div className="hidden items-center gap-4 border-t border-slate-100 px-4 py-2.5 text-[11px] font-semibold text-slate-400 md:flex">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> moverse</span>
          <span><Kbd>Enter</Kbd> abrir</span>
          <span><Kbd>Esc</Kbd> cerrar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[10.5px] text-slate-500">{children}</kbd>
);

/** Atajo Ctrl+K / ⌘K para abrir el buscador desde cualquier pantalla. */
export const useToolSearchShortcut = (onOpen: () => void) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
};

/** El campo de la cabecera de escritorio: parece un buscador y abre el diálogo. */
export const ToolSearchTrigger: React.FC<{ onOpen: () => void; className?: string }> = ({ onOpen, className = "" }) => {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-[13px] text-slate-400 transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${className}`}
    >
      <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Buscar herramienta</span>
      <span className="hidden shrink-0 rounded border border-slate-200 bg-white px-1.5 text-[10.5px] font-semibold text-slate-400 lg:inline">{isMac ? "⌘ K" : "Ctrl K"}</span>
    </button>
  );
};
