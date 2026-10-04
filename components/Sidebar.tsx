import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppModule } from '../types';
import { BrandLogo, BrandMark } from './ui/BrandLogo';
import { NavItem, visibleNavSections } from './navigation';

interface SidebarProps {
  currentView: AppModule;
  setCurrentView: (view: AppModule) => void;
  isCollapsed: boolean;
  hasPermission: (module: AppModule) => boolean;
}

/**
 * Lateral de escritorio: las secciones de `navigation.ts`, planas y sin acordeones.
 *
 * - La marca lleva a Inicio (no hay un ítem «Inicio» aparte).
 * - Se contrae y expande con el botón de la cabecera (`App.tsx`); siempre arranca contraído.
 * - Contraído, al pasar el mouse (o llegar con el teclado) por un ícono, este crece
 *   y se estira en una pastilla teal con el nombre, como los botones de acción de Análisis.
 *   La pastilla va en un portal porque el `<nav>` recorta lo que sale por su borde; se puede
 *   tocar (lleva al módulo) y se queda mientras el mouse está encima (WCAG 1.4.13).
 */

type Pill = { item: NavItem; top: number; left: number; size: number };

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  isCollapsed,
  hasPermission
}) => {
  const sections = visibleNavSections(hasPermission);
  const [pill, setPill] = useState<Pill | null>(null);
  const [pillOpen, setPillOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const showPill = (item: NavItem, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPill({ item, top: r.top, left: r.left, size: r.height });
  };
  const hidePill = () => {
    setPill(null);
    setPillOpen(false);
  };

  // Un cuadro después de montar la pastilla se abre, para que la transición se vea.
  useEffect(() => {
    if (!pill) return;
    const frame = requestAnimationFrame(() => setPillOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [pill?.item.module]);

  // Al desplazar el menú, expandirlo o cambiar de módulo, la pastilla quedaría fuera de lugar.
  useEffect(() => {
    if (!pill) return;
    const nav = navRef.current;
    nav?.addEventListener('scroll', hidePill, { passive: true });
    window.addEventListener('resize', hidePill);
    return () => {
      nav?.removeEventListener('scroll', hidePill);
      window.removeEventListener('resize', hidePill);
    };
  }, [pill]);
  useEffect(hidePill, [isCollapsed, currentView]);

  const go = (module: AppModule) => {
    hidePill();
    setCurrentView(module);
  };

  const renderItem = (item: NavItem) => {
    const active = currentView === item.module;
    const Icon = item.icon;
    if (isCollapsed) {
      return (
        <button
          key={item.module}
          type="button"
          onClick={() => go(item.module)}
          onMouseEnter={(e) => showPill(item, e.currentTarget)}
          onFocus={(e) => showPill(item, e.currentTarget)}
          onBlur={hidePill}
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
          className={`mx-auto grid h-11 w-11 place-items-center rounded-xl transition-colors focus-visible:outline-none ${
            active ? 'bg-teal-500/15 text-teal-300' : 'text-slate-400'
          }`}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
        </button>
      );
    }
    return (
      <button
        key={item.module}
        type="button"
        onClick={() => go(item.module)}
        aria-current={active ? 'page' : undefined}
        className={`flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${
          active ? 'bg-teal-500/15 text-teal-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  const PillIcon = pill?.item.icon;

  return (
    <aside
      className={`relative z-[100002] flex h-full shrink-0 flex-col bg-slate-900 py-4 transition-[width] duration-300 ${
        isCollapsed ? 'w-[76px]' : 'w-[260px]'
      }`}
    >
      {/* Marca: lleva a Inicio */}
      <button
        type="button"
        onClick={() => go('HOME')}
        aria-label="Ir a Inicio"
        title="Ir a Inicio"
        className={`mb-5 flex h-9 shrink-0 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${
          isCollapsed ? 'mx-auto justify-center' : 'mx-3 px-2'
        }`}
      >
        {isCollapsed ? <BrandMark size={34} tone="dark" animation="hover" /> : <BrandLogo size={16} tone="dark" animation="hover" />}
      </button>

      <nav
        ref={navRef}
        aria-label="Navegación principal"
        className={`flex-1 overflow-y-auto overflow-x-hidden ${isCollapsed ? 'px-2' : 'px-3'}`}
      >
        <div className={isCollapsed ? 'space-y-3' : 'space-y-4'}>
          {sections.map((section, index) => (
            <div
              key={section.id}
              role="group"
              aria-label={section.label}
              className={
                isCollapsed
                  ? `flex flex-col items-center gap-1 ${index ? 'border-t border-white/10 pt-3' : ''}`
                  : 'space-y-0.5'
              }
            >
              {!isCollapsed && (
                <p className="px-3 pb-1 text-[10.5px] font-black uppercase tracking-widest text-slate-500">{section.label}</p>
              )}
              {section.items.map(renderItem)}
            </div>
          ))}
        </div>
      </nav>

      {isCollapsed && pill && PillIcon && createPortal(
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => go(pill.item.module)}
          onMouseLeave={hidePill}
          className={`fixed z-[100003] flex items-center overflow-hidden rounded-xl bg-teal-500 text-white transition-[box-shadow,transform] duration-300 ease-out motion-reduce:transition-none ${
            pillOpen ? 'scale-105 shadow-lg shadow-black/30' : 'scale-100 shadow-none'
          }`}
          style={{ top: pill.top, left: pill.left, height: pill.size, transformOrigin: 'left center' }}
        >
          <span className="grid shrink-0 place-items-center" style={{ width: pill.size, height: pill.size }}>
            <PillIcon className={`shrink-0 transition-transform duration-300 motion-reduce:transition-none ${pillOpen ? 'scale-125' : ''}`} style={{ width: 18, height: 18 }} />
          </span>
          <span
            className={`overflow-hidden whitespace-nowrap text-[13.5px] font-bold transition-all duration-300 ease-out motion-reduce:transition-none ${
              pillOpen ? 'max-w-[16rem] pr-4 opacity-100' : 'max-w-0 pr-0 opacity-0'
            }`}
          >
            {pill.item.label}
          </span>
        </button>,
        document.body
      )}
    </aside>
  );
};
