import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, WifiOff } from "lucide-react";
import type { AppModule } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { offlineNavItems, type NavItem } from "./navigation";
import { BottomSheet } from "./ui/BottomSheet";
import { useIsDesktop } from "./ui/useIsDesktop";
import { useOnline } from "./ui/useOnline";

/** Lista de herramientas que funcionan sin internet, para abrirlas desde el aviso. */
export const OfflineToolList: React.FC<{ items: NavItem[]; onNavigate: (module: AppModule) => void }> = ({ items, onNavigate }) => (
  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
    {items.map((item) => (
      <li key={item.module}>
        <button
          type="button"
          onClick={() => onNavigate(item.module)}
          className="group flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <item.icon aria-hidden="true" className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold text-slate-900">{item.label}</span>
            <span className="block truncate text-[12px] text-slate-500">{item.description}</span>
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600" />
        </button>
      </li>
    ))}
  </ul>
);

const OfflineDetail: React.FC<{ onNavigate: (module: AppModule) => void }> = ({ onNavigate }) => {
  const { hasPermission } = useAuth();
  const items = offlineNavItems(hasPermission);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-slate-600">
        Se puede seguir trabajando con lo guardado en este equipo. Lo que necesita internet se activa solo cuando vuelve la conexión.
      </p>
      {items.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Funcionan sin internet</p>
          <OfflineToolList items={items} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
};

/**
 * Aviso «Sin conexión» de la cabecera (modo sin internet, 2026-10-08). Solo aparece sin
 * internet: en escritorio, una pastilla ámbar que abre un panel bajo ella; en el celular, el
 * ícono, que abre un panel inferior. Dice qué herramientas siguen funcionando.
 */
export const OfflineIndicator: React.FC<{ onNavigate: (module: AppModule) => void }> = ({ onNavigate }) => {
  const online = useOnline();
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (online) setOpen(false); }, [online]);
  useEffect(() => {
    if (!open || !desktop) return;
    const onPointer = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, desktop]);

  if (online) return null;
  const go = (module: AppModule) => { setOpen(false); onNavigate(module); };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Sin conexión a internet"
        title="Sin conexión a internet"
        className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 md:flex md:w-auto md:gap-1.5 md:px-3"
      >
        <WifiOff aria-hidden="true" className="h-[18px] w-[18px]" />
        <span className="hidden text-[13px] font-bold md:inline">Sin conexión</span>
      </button>
      {open && desktop && (
        <div
          role="dialog"
          aria-label="Sin conexión a internet"
          className="absolute right-0 top-full z-[1100] mt-2 w-[380px] max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/15 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <p className="mb-2 flex items-center gap-2 text-[15px] font-black text-slate-900">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-50 text-amber-700"><WifiOff aria-hidden="true" className="h-4 w-4" /></span>
            Sin conexión a internet
          </p>
          <OfflineDetail onNavigate={go} />
        </div>
      )}
      {!desktop && (
        <BottomSheet open={open} title="Sin conexión a internet" onClose={() => setOpen(false)}>
          <OfflineDetail onNavigate={go} />
        </BottomSheet>
      )}
    </div>
  );
};

/**
 * Lo que se ve en una herramienta que necesita internet cuando no lo hay. Se abre sola en
 * cuanto vuelve la conexión, porque el módulo se vuelve a pintar.
 */
export const OfflineToolNotice: React.FC<{ label: string; onNavigate: (module: AppModule) => void }> = ({ label, onNavigate }) => {
  const { hasPermission } = useAuth();
  const items = offlineNavItems(hasPermission);
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-5 py-10 text-center md:py-16">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        <WifiOff aria-hidden="true" className="h-8 w-8" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[20px] font-black text-slate-900">{label} necesita internet</h3>
        <p className="text-[14px] leading-relaxed text-slate-600">Se abrirá sola en cuanto vuelva la conexión.</p>
      </div>
      {items.length > 0 && (
        <div className="w-full text-left">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Funcionan sin internet</p>
          <OfflineToolList items={items} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
};
