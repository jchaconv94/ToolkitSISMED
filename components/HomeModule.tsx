import React, { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, LayoutGrid } from "lucide-react";
import { AppModule } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { greetingFor, limaLongDate, userFirstName } from "../services/sessionDisplay";
import { NAV_TINT_CLASSES, visibleNavSections } from "./navigation";
import { EmptyState } from "./ui/kit";

/**
 * Inicio: saludo y todas las herramientas que el usuario puede abrir, por sección.
 * Las secciones y su orden salen de `navigation.ts`, igual que el lateral.
 */

/** El saludo cambia solo si la pantalla queda abierta de la mañana a la tarde. */
const useNow = (intervalMs = 60_000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

export const HomeModule: React.FC<{ onNavigate: (module: AppModule) => void }> = ({ onNavigate }) => {
  const { user, hasPermission } = useAuth();
  const now = useNow();
  const sections = visibleNavSections(hasPermission);

  return (
    <div className="pb-6 pt-3 sm:pt-5 lg:px-3">
      <div className="mb-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
          <CalendarDays className="h-3.5 w-3.5 text-teal-600" />
          {limaLongDate(now)}
        </p>
        <h1 className="text-[24px] font-black leading-tight tracking-tight text-slate-900 sm:text-[28px]">
          {greetingFor(now)}, <span className="text-teal-700">{userFirstName(user)}</span>
        </h1>
        <p className="mt-1 text-[13.5px] text-slate-500">¿Qué necesita hacer hoy?</p>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon={<LayoutGrid className="h-6 w-6" />}
            title="Todavía no tiene herramientas asignadas"
            description="Pida al administrador que le dé acceso a las que necesita."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {sections.map((section, index) => {
            const tint = NAV_TINT_CLASSES[section.tint];
            const SectionIcon = section.icon;
            return (
              <section
                key={section.id}
                aria-labelledby={`inicio-${section.id}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="mb-3.5 flex items-center gap-2">
                  <SectionIcon className={`h-4 w-4 ${tint.accent}`} />
                  <h2 id={`inicio-${section.id}`} className="text-[12px] font-black uppercase tracking-wider text-slate-500">
                    {section.label}
                  </h2>
                  <span className="ml-auto text-[11.5px] font-semibold text-slate-400">
                    {section.items.length} {section.items.length === 1 ? "herramienta" : "herramientas"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.module}
                        type="button"
                        onClick={() => onNavigate(item.module)}
                        className="group relative flex min-w-0 flex-col items-start rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-md hover:shadow-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                      >
                        <span className={`mb-2.5 grid h-9 w-9 place-items-center rounded-xl transition-colors ${tint.chip} ${tint.chipHover}`}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <ArrowUpRight className="absolute right-2.5 top-2.5 h-4 w-4 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                        <span className="max-w-full break-words text-[13px] font-bold leading-tight text-slate-800">{item.label}</span>
                        <span className="mt-1 text-[11.5px] leading-snug text-slate-500">{item.description}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
