import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppModule } from '../types';
import { BrandLogo, BrandMark } from './ui/BrandLogo';
import { NavItem, NavSection, NavTint, visibleNavSections } from './navigation';

/**
 * Color de cada sección en el lateral oscuro (el mismo tinte que en Inicio). Clases escritas
 * enteras para que Tailwind las encuentre al compilar.
 */
const DARK_TINT: Record<NavTint, { label: string; dot: string; tile: string; tileHover: string }> = {
  teal: { label: 'text-teal-300', dot: 'bg-teal-400', tile: 'bg-teal-400/15 text-teal-300', tileHover: 'group-hover:bg-teal-400/25' },
  cyan: { label: 'text-cyan-300', dot: 'bg-cyan-400', tile: 'bg-cyan-400/15 text-cyan-300', tileHover: 'group-hover:bg-cyan-400/25' },
  violet: { label: 'text-violet-300', dot: 'bg-violet-400', tile: 'bg-violet-400/15 text-violet-300', tileHover: 'group-hover:bg-violet-400/25' },
  slate: { label: 'text-slate-300', dot: 'bg-slate-400', tile: 'bg-slate-400/15 text-slate-300', tileHover: 'group-hover:bg-slate-400/25' },
};

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
 * - Expandido, cada sección lleva su color (punto en el título y cuadrito del ícono) y el
 *   módulo abierto es una pastilla teal sólida, la misma del menú contraído.
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
  const pillRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  const showPill = (item: NavItem, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    anchorRef.current = el;
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

  // La pastilla se quedaba pegada: si el mouse salía del ícono antes de que se dibujara,
  // nunca entraba en ella y su `onMouseLeave` no llegaba; y al volver a la ventana, el
  // ícono recuperaba el foco y la mostraba otra vez. Mientras está abierta se vigila el
  // puntero: si no está sobre la pastilla ni sobre su ícono, se cierra. También al salir
  // el mouse de la ventana o al perder la ventana el foco.
  useEffect(() => {
    if (!pill) return;
    const onMove = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (pillRef.current?.contains(target) || anchorRef.current?.contains(target))) return;
      hidePill();
    };
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) hidePill(); };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onOut);
    window.addEventListener('blur', hidePill);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', hidePill);
    };
  }, [pill]);

  const go = (module: AppModule) => {
    hidePill();
    setCurrentView(module);
  };

  const renderItem = (item: NavItem, section: NavSection) => {
    const active = currentView === item.module;
    const Icon = item.icon;
    if (isCollapsed) {
      return (
        <button
          key={item.module}
          type="button"
          onClick={() => go(item.module)}
          onMouseEnter={(e) => showPill(item, e.currentTarget)}
          // Solo con el teclado: tras un clic el ícono conserva el foco y, al volver a la
          // ventana, lo recuperaba y mostraba la pastilla con el mouse en otra parte.
          onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) showPill(item, e.currentTarget); }}
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
        className={`group flex h-10 w-full items-center gap-3 rounded-xl px-1.5 text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${
          active ? 'bg-teal-500 font-bold text-white shadow-md shadow-black/20' : 'font-medium text-slate-300 hover:bg-white/10 hover:text-white'
        }`}
      >
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition motion-reduce:transition-none ${
            active ? 'bg-white/20 text-white' : `${DARK_TINT[section.tint].tile} ${DARK_TINT[section.tint].tileHover} group-hover:translate-x-0.5`
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className={`truncate transition-transform motion-reduce:transition-none ${active ? '' : 'group-hover:translate-x-0.5'}`}>{item.label}</span>
      </button>
    );
  };

  const PillIcon = pill?.item.icon;

  return (
    <aside
      className={`relative z-[100002] flex h-full shrink-0 flex-col bg-slate-900 transition-[width] duration-300 ${
        isCollapsed ? 'w-[76px]' : 'w-[260px]'
      }`}
    >
      {/* Marca: lleva a Inicio. A la altura de la cabecera, con la línea que la continúa. */}
      <div className="flex h-16 shrink-0 items-center border-b border-white/10">
        <button
          type="button"
          onClick={() => go('HOME')}
          aria-label="Ir a Inicio"
          title="Ir a Inicio"
          className={`flex h-10 shrink-0 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${
            isCollapsed ? 'mx-auto justify-center px-1' : 'mx-3 px-2'
          }`}
        >
          {isCollapsed ? <BrandMark size={34} tone="dark" animation="hover" /> : <BrandLogo size={16} tone="dark" animation="hover" />}
        </button>
      </div>

      <nav
        ref={navRef}
        aria-label="Navegación principal"
        className={`flex-1 overflow-y-auto overflow-x-hidden py-4 ${isCollapsed ? 'px-2' : 'px-3'}`}
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
                <p className={`flex items-center gap-2 px-2 pb-1.5 text-[11px] font-black uppercase tracking-widest ${DARK_TINT[section.tint].label}`}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DARK_TINT[section.tint].dot}`} />
                  {section.label}
                </p>
              )}
              {section.items.map(item => renderItem(item, section))}
            </div>
          ))}
        </div>
      </nav>

      {isCollapsed && pill && PillIcon && createPortal(
        <button
          ref={pillRef}
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
