import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AppModule } from '../types';
import { BrandLogo, BrandMark } from './ui/BrandLogo';
import { NAV_HOME, NavItem, visibleNavSections } from './navigation';

interface SidebarProps {
  currentView: AppModule;
  setCurrentView: (view: AppModule) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  hasPermission: (module: AppModule) => boolean;
}

/**
 * Lateral de escritorio: Inicio y las secciones de `navigation.ts`, planas y sin
 * acordeones. Contraído muestra solo los íconos (con su nombre como `title`).
 * El usuario, el perfil y cerrar sesión están en la cabecera.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  isCollapsed,
  setIsCollapsed,
  hasPermission
}) => {
  const sections = visibleNavSections(hasPermission);

  const renderItem = (item: NavItem) => {
    const active = currentView === item.module;
    const Icon = item.icon;
    const tone = active
      ? 'bg-teal-500/15 text-teal-300'
      : isCollapsed
        ? 'text-slate-400 hover:bg-white/5 hover:text-white'
        : 'text-slate-300 hover:bg-white/5 hover:text-white';
    return (
      <button
        key={item.module}
        type="button"
        onClick={() => setCurrentView(item.module)}
        aria-current={active ? 'page' : undefined}
        aria-label={isCollapsed ? item.label : undefined}
        title={isCollapsed ? item.label : undefined}
        className={`flex items-center rounded-xl text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${
          isCollapsed ? 'mx-auto h-10 w-11 justify-center' : 'h-9 w-full gap-3 px-3 text-left'
        } ${tone}`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        {!isCollapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  return (
    <aside
      className={`relative z-[100002] flex h-full shrink-0 flex-col bg-slate-900 py-4 transition-[width] duration-300 ${
        isCollapsed ? 'w-[76px]' : 'w-[260px]'
      }`}
    >
      {/* Marca */}
      <div className={`flex h-9 shrink-0 items-center ${isCollapsed ? 'justify-center' : 'justify-between pl-5 pr-3'} mb-5`}>
        {isCollapsed ? (
          <BrandMark size={34} tone="dark" animation="hover" />
        ) : (
          <>
            <BrandLogo size={16} tone="dark" animation="hover" />
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              aria-label="Contraer menú"
              title="Contraer menú"
              className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Contraído, el botón para expandir asoma por el borde, como antes. */}
      {isCollapsed && (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          aria-label="Expandir menú"
          title="Expandir menú"
          className="absolute -right-3 top-[26px] z-50 grid h-6 w-6 place-items-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 shadow-md transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
        >
          <ChevronRight className="ml-px h-3.5 w-3.5" />
        </button>
      )}

      <nav aria-label="Navegación principal" className={`flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.25)_transparent] ${isCollapsed ? 'px-2' : 'px-3'}`}>
        <div className="pb-3">{renderItem(NAV_HOME)}</div>

        <div className={isCollapsed ? 'space-y-3' : 'space-y-4'}>
          {sections.map(section => (
            <div
              key={section.id}
              role="group"
              aria-label={section.label}
              className={isCollapsed ? 'flex flex-col items-center gap-1 border-t border-white/10 pt-3' : 'space-y-0.5'}
            >
              {!isCollapsed && (
                <p className="px-3 pb-1 text-[10.5px] font-black uppercase tracking-widest text-slate-500">{section.label}</p>
              )}
              {section.items.map(renderItem)}
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
};
