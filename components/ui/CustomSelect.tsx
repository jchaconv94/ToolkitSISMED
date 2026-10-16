import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

/**
 * Combobox del sistema: el desplegable con buscador que reemplaza al `<select>` nativo en
 * toda la app (pedido del usuario del 2026-10-16: «un combobox más profesional, con buscador
 * y un estilo que vaya con el diseño»).
 *
 * - Buscador sin tildes ni mayúsculas, visible cuando hay más de 6 opciones (`searchable`).
 * - Teclado: ↑ ↓ recorren, Enter elige, Esc cierra, Inicio y Fin; escribir con el combo
 *   cerrado lo abre y busca.
 * - Cada opción puede llevar una cifra (`count`) y una línea de apoyo (`hint`).
 * - `prefix` antepone una etiqueta en el disparador: «UNGET: Bellavista».
 * - `size`: `sm` (compacto, el de siempre), `md` (barra de filtros, como `filterInputClass`)
 *   y `lg` (formulario, como `inputClass`).
 * - El menú va en un portal, encima de cualquier ventana, y se abre hacia arriba si abajo no
 *   cabe.
 *
 * Para un filtro en una barra: `<CustomSelect size="md" prefix="Estado" containerClassName="w-56" …/>`.
 */

export interface Option {
  value: string;
  label: string | React.ReactNode;
  /** Cifra que acompaña a la opción (cuántos establecimientos, filas…). */
  count?: number;
  /** Línea secundaria bajo la etiqueta. */
  hint?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  /** Clases extra del disparador (alto, bordes…). */
  className?: string;
  /** Clases del contenedor; por omisión ocupa todo el ancho (`w-full`). */
  containerClassName?: string;
  loading?: boolean;
  /** Forzar el buscador. Si no se indica, aparece con más de 6 opciones. */
  searchable?: boolean;
  searchPlaceholder?: string;
  ariaLabel?: string;
  /** Etiqueta antes del valor elegido en el disparador: «UNGET: Bellavista». */
  prefix?: string;
  size?: "sm" | "md" | "lg";
  /** Ancho mínimo del menú, para etiquetas largas en disparadores angostos. */
  menuMinWidth?: number;
}

const SIZE: Record<NonNullable<CustomSelectProps["size"]>, { trigger: string; option: string; text: string }> = {
  sm: { trigger: "px-3 py-2 text-xs", option: "text-xs", text: "text-xs" },
  md: { trigger: "h-10 px-3 text-sm", option: "text-[13px]", text: "text-sm" },
  lg: { trigger: "h-11 px-3 text-sm", option: "text-[13.5px]", text: "text-sm" },
};

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Texto plano de una etiqueta, para buscar aunque la etiqueta sea un nodo de React. */
const textOf = (label: React.ReactNode): string => {
  if (label === null || label === undefined || typeof label === "boolean") return "";
  if (typeof label === "string" || typeof label === "number") return String(label);
  if (Array.isArray(label)) return label.map(textOf).join(" ");
  if (React.isValidElement(label)) return textOf((label.props as { children?: React.ReactNode }).children);
  return "";
};

const formatCount = (n: number) => n.toLocaleString("es-PE").replace(/,/g, " ");

const MENU_MAX = 320;

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Seleccionar…",
  disabled = false,
  className = "",
  containerClassName = "w-full",
  loading = false,
  searchable,
  searchPlaceholder = "Buscar…",
  ariaLabel,
  prefix,
  size = "sm",
  menuMinWidth = 200,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const sz = SIZE[size];

  const isSearchable = searchable ?? options.length > 6;
  const selected = options.find((o) => String(o.value) === String(value));
  const shown = useMemo(() => {
    const needle = normalize(query);
    if (!isSearchable || !needle) return options;
    return options.filter((o) => normalize(`${textOf(o.label)} ${o.hint || ""}`).includes(needle));
  }, [options, query, isSearchable]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openMenu = (initialQuery = "") => {
    if (disabled) return;
    setQuery(initialQuery);
    const index = options.findIndex((o) => String(o.value) === String(value));
    setActive(index >= 0 && !initialQuery ? index : 0);
    setOpen(true);
  };

  // Posición: debajo del disparador, o encima si abajo no cabe.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, menuMinWidth);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < Math.min(MENU_MAX, 220) && above > below;
      setPlace(
        up
          ? { left, width, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(MENU_MAX, above) }
          : { left, width, top: rect.bottom + 6, maxHeight: Math.min(MENU_MAX, below) },
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, menuMinWidth]);

  // Clic fuera: cierra sin robar el foco a lo que se tocó.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  useEffect(() => {
    if (open) (isSearchable ? searchRef.current : listRef.current)?.focus();
  }, [open, isSearchable]);

  useEffect(() => { setActive(0); }, [query]);

  // La opción activa siempre a la vista.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (option?: Option) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };

  const move = (step: number) => {
    if (shown.length === 0) return;
    let next = active;
    for (let i = 0; i < shown.length; i++) {
      next = (next + step + shown.length) % shown.length;
      if (!shown[next]?.disabled) break;
    }
    setActive(next);
  };

  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(Math.max(0, shown.length - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); choose(shown[active]); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") close(false);
  };

  const onTriggerKey = (event: React.KeyboardEvent) => {
    if (open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    } else if (isSearchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openMenu(event.key);
    }
  };

  const menu = open && !disabled && (
    <div
      ref={menuRef}
      onKeyDown={onMenuKey}
      /* El menú va al final de `body`: su z-index compite con el de los modales de la app,
         que llegan hasta 2147483646. Un menú anclado a su disparador siempre va encima. */
      className="fixed z-[2147483647] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 animate-in fade-in-50 zoom-in-95 duration-100"
      style={place}
    >
      {isSearchable && (
        <div className="shrink-0 border-b border-slate-100 p-2">
          <div className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-100">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto p-1.5 outline-none"
      >
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-slate-400">Ninguna opción coincide</p>
        ) : (
          shown.map((option, index) => {
            const isSelected = String(option.value) === String(value);
            const isActive = index === active;
            return (
              <div
                key={String(option.value)}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 ${sz.option} ${
                  option.disabled ? "cursor-not-allowed opacity-40" : ""
                } ${isActive ? "bg-slate-100" : ""} ${isSelected ? "font-bold text-teal-800" : "font-medium text-slate-700"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint && <span className="block truncate text-[11px] font-normal text-slate-400">{option.hint}</span>}
                </span>
                {option.count !== undefined && (
                  <span className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular-nums ${isSelected ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                    {formatCount(option.count)}
                  </span>
                )}
                <Check className={`h-3.5 w-3.5 shrink-0 text-teal-600 ${isSelected ? "" : "invisible"}`} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className={`relative ${containerClassName}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border font-bold outline-none transition-all ${sz.trigger} ${
          disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            : open
              ? "border-teal-500 bg-white text-slate-900 ring-4 ring-teal-100"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 focus-visible:border-teal-500 focus-visible:ring-4 focus-visible:ring-teal-100"
        } ${className}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-left">
          {prefix && <span className="shrink-0 font-semibold text-slate-400">{prefix}:</span>}
          <span className="truncate">
            {selected ? selected.label : <span className="font-normal text-slate-400">{placeholder}</span>}
          </span>
          {selected?.count !== undefined && (
            <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-slate-400">{formatCount(selected.count)}</span>
          )}
        </span>
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-teal-600" />
        ) : (
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180 text-teal-600" : "text-slate-400"}`} />
        )}
      </button>
      {typeof document !== "undefined" && createPortal(menu, document.body)}
    </div>
  );
};
