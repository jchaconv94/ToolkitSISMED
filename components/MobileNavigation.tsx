import React from "react";
import { ChevronRight } from "lucide-react";
import { AppModule } from "../types";
import { NAV_HOME, NAV_TINT_CLASSES, NavSection, findNavSection } from "./navigation";

/**
 * Navegación del teléfono (por debajo de `md`): la barra inferior de pestañas y la
 * pantalla de cada sección. Todo sale de `navigation.ts`, igual que el lateral de
 * escritorio y el Inicio; aquí no hay una lista propia de módulos.
 *
 * Perfil y Cerrar sesión están en el menú del avatar de la cabecera (`UserMenu`).
 */

/** Pestaña que corresponde a la pantalla actual: Inicio, una sección o ninguna (Perfil). */
export const activeMobileTab = (currentView: AppModule, openSectionId: string | null): string | null => {
  if (currentView === "HOME") return openSectionId || NAV_HOME.module;
  return findNavSection(currentView)?.id || null;
};

interface MobileTabBarProps {
  sections: NavSection[];
  activeTab: string | null;
  onHome: () => void;
  onSection: (sectionId: string) => void;
}

export const MobileTabBar: React.FC<MobileTabBarProps> = ({ sections, activeTab, onHome, onSection }) => {
  const tabs = [
    { id: NAV_HOME.module as string, label: NAV_HOME.shortLabel, icon: NAV_HOME.icon, onClick: onHome },
    ...sections.map(section => ({ id: section.id, label: section.shortLabel, icon: section.icon, onClick: () => onSection(section.id) })),
  ];

  return (
    <nav
      aria-label="Secciones"
      className="flex shrink-0 border-t border-slate-200 bg-white/95 px-2 pt-2 backdrop-blur md:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      {tabs.map(({ id, label, icon: Icon, onClick }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl pb-0.5 text-[10.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
              active ? "text-teal-700" : "text-slate-400 active:text-slate-600"
            }`}
          >
            <span className={`grid h-8 w-14 max-w-full place-items-center rounded-full transition-colors ${active ? "bg-teal-50" : ""}`}>
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="max-w-full truncate leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

/** Pantalla de una sección: sus herramientas permitidas, en una lista. */
export const MobileSectionScreen: React.FC<{ section: NavSection; onNavigate: (module: AppModule) => void }> = ({ section, onNavigate }) => {
  const tint = NAV_TINT_CLASSES[section.tint];
  return (
    <div className="pb-6 pt-3 animate-in fade-in duration-200">
      <p className="mb-3 px-1 text-[13px] text-slate-500">Elija una herramienta</p>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        {section.items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.module}
              type="button"
              onClick={() => onNavigate(item.module)}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none ${
                index ? "border-t border-slate-100" : ""
              }`}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tint.chip}`}>
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-slate-900">{item.label}</span>
                <span className="block truncate text-[12.5px] text-slate-500">{item.description}</span>
              </span>
              <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
