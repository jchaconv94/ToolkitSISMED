import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArchiveX,
  ArrowDownToLine,
  ArrowRightLeft,
  Ban,
  BarChart2,
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  CalendarCheck,
  ClipboardList,
  Database,
  FileSpreadsheet,
  LineChart,
  Menu,
  PackageSearch,
  RefreshCw,
  Scale,
  Settings,
  Shield,
  ShieldCheck,
  Sliders,
  Truck,
  UserCircle,
  Users,
  X
} from 'lucide-react';
import { AppModule } from '../types';

interface MobileNavProps {
  currentView: AppModule;
  setCurrentView: (view: AppModule) => void;
  hasPermission: (module: AppModule) => boolean;
}

type Entrada = { module: AppModule; label: string; icon: React.ReactNode };
type Grupo = { titulo: string; entradas: Entrada[] };

const icono = (Componente: React.ComponentType<{ className?: string }>) => <Componente className="h-5 w-5 shrink-0" />;

/** El menú completo, con la misma estructura y orden que el lateral de escritorio. */
const GRUPOS: Grupo[] = [
  {
    titulo: 'Farmacia',
    entradas: [
      { module: 'DASHBOARD', label: 'Análisis Requerimiento', icon: icono(BarChart2) },
      { module: 'ANALYSIS_EXCLUSIONS', label: 'Lista de Exclusiones', icon: icono(Ban) },
      { module: 'REDISTRIBUTION', label: 'Redistribución', icon: icono(ArrowRightLeft) },
      { module: 'SIG_SEARCH', label: 'Consulta Stock', icon: icono(Database) },
      { module: 'IPRESS_STOCK', label: 'Stock SISMED', icon: icono(FileSpreadsheet) },
      { module: 'STOCK_MONITORING', label: 'Monitoreo de Stock', icon: icono(LineChart) }
    ]
  },
  {
    titulo: 'Inmunizaciones',
    entradas: [
      { module: 'IMMUNIZATION_CATALOG', label: 'Catálogo Biológico', icon: icono(ShieldCheck) },
      { module: 'IMMUNIZATION_INITIAL_INVENTORY', label: 'Inventario Inicial', icon: icono(ClipboardList) },
      { module: 'IMMUNIZATION_STOCK', label: 'Stock Biológico', icon: icono(Boxes) },
      { module: 'IMMUNIZATION_STOCK_QUERY', label: 'Consulta de Stock', icon: icono(PackageSearch) },
      { module: 'IMMUNIZATION_INCOMES', label: 'Ingresos Regionales', icon: icono(ArrowDownToLine) },
      { module: 'IMMUNIZATION_DISTRIBUTIONS', label: 'Distribuciones', icon: icono(Truck) },
      { module: 'IMMUNIZATION_CONSUMPTION', label: 'Consumo IPRESS', icon: icono(Activity) },
      { module: 'IMMUNIZATION_RETURNS', label: 'Devoluciones y Bajas', icon: icono(ArchiveX) },
      { module: 'IMMUNIZATION_ADJUSTMENTS', label: 'Reajustes de Stock', icon: icono(Scale) },
      { module: 'IMMUNIZATION_CLOSURES', label: 'Cierre Mensual', icon: icono(CalendarCheck) },
      { module: 'IMMUNIZATION_REPORTS', label: 'Reportes', icon: icono(BarChart3) },
      { module: 'IMMUNIZATION_CONFIG', label: 'Configuración', icon: icono(Sliders) }
    ]
  },
  {
    titulo: 'Administración',
    entradas: [
      { module: 'ADMIN_USERS', label: 'Gestión de Usuarios', icon: icono(Users) },
      { module: 'ADMIN_ROLES', label: 'Configuración de Roles', icon: icono(Shield) },
      { module: 'ADMIN_FACILITIES', label: 'Establecimientos', icon: icono(Building2) },
      { module: 'ADMIN_CATALOGS', label: 'Regímenes y Profesiones', icon: icono(Briefcase) },
      { module: 'ADMIN_PARAMS', label: 'Parámetros del Sistema', icon: icono(Sliders) },
      { module: 'ADMIN_STOCK_ASSIGN', label: 'Columnas de Stock', icon: icono(ShieldCheck) },
      { module: 'ADMIN_SYNC_DEVICES', label: 'Dispositivos Sync', icon: icono(RefreshCw) },
      { module: 'ADMIN_MIGRATION', label: 'Migración (Supabase)', icon: icono(Database) }
    ]
  }
];

/**
 * Accesos de la barra inferior, por orden de prioridad.
 *
 * Solo entran los cuatro primeros que el usuario tenga permitidos: más botones en una
 * pantalla de teléfono se solapan y quedan ilegibles. El resto del menú vive en el panel
 * lateral, que se abre con el botón `Menú`.
 */
const BARRA_INFERIOR: Entrada[] = [
  { module: 'DASHBOARD', label: 'Análisis', icon: icono(BarChart2) },
  { module: 'IMMUNIZATION_STOCK', label: 'Biológico', icon: icono(Boxes) },
  { module: 'IPRESS_STOCK', label: 'Stock', icon: icono(FileSpreadsheet) },
  { module: 'SIG_SEARCH', label: 'Consulta', icon: icono(Database) },
  { module: 'REDISTRIBUTION', label: 'Canjes', icon: icono(ArrowRightLeft) },
  { module: 'ADMIN_USERS', label: 'Admin', icon: icono(Settings) }
];

export const MobileNav: React.FC<MobileNavProps> = ({ currentView, setCurrentView, hasPermission }) => {
  const [menuAbierto, setMenuAbierto] = useState(false);

  // Con el panel abierto no debe desplazarse el contenido de atrás.
  useEffect(() => {
    if (!menuAbierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previo; };
  }, [menuAbierto]);

  const gruposVisibles = GRUPOS
    .map(grupo => ({ ...grupo, entradas: grupo.entradas.filter(entrada => hasPermission(entrada.module)) }))
    .filter(grupo => grupo.entradas.length > 0);

  const accesos = BARRA_INFERIOR.filter(entrada => hasPermission(entrada.module)).slice(0, 4);

  const irA = (module: AppModule) => {
    setCurrentView(module);
    setMenuAbierto(false);
  };

  const estiloAcceso = (activo: boolean) =>
    `flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors ${
      activo ? 'text-teal-600' : 'text-gray-400'
    }`;

  return (
    <>
      {menuAbierto && (
        <div className="fixed inset-0 z-[6000] md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMenuAbierto(false)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />

          <nav className="absolute inset-y-0 left-0 flex w-[90%] max-w-sm flex-col bg-[#0f172a] shadow-2xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-base font-black text-white">ToolKit SISMED</p>
                <p className="text-[11px] font-semibold text-gray-400">Menú de navegación</p>
              </div>
              <button
                type="button"
                onClick={() => setMenuAbierto(false)}
                aria-label="Cerrar menú"
                className="rounded-xl p-2 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              {gruposVisibles.map(grupo => (
                <div key={grupo.titulo} className="mb-5">
                  <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-wider text-gray-500">{grupo.titulo}</p>
                  <div className="flex flex-col gap-1">
                    {grupo.entradas.map(entrada => {
                      const activo = currentView === entrada.module;
                      return (
                        <button
                          key={entrada.module}
                          type="button"
                          onClick={() => irA(entrada.module)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors ${
                            activo ? 'bg-white/10 text-cyan-400' : 'text-gray-300 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {entrada.icon}
                          {entrada.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => irA('PROFILE')}
              className={`flex items-center gap-3 border-t border-white/10 px-5 py-4 text-left text-sm font-semibold ${
                currentView === 'PROFILE' ? 'text-cyan-400' : 'text-gray-300'
              }`}
            >
              <UserCircle className="h-5 w-5 shrink-0" />
              Perfil de Usuario
            </button>
          </nav>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-[5000] flex items-stretch gap-1 border-t border-gray-200 bg-white px-2 pb-5 pt-2 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.1)] md:hidden">
        {accesos.map(entrada => {
          const activo = currentView === entrada.module
            || (entrada.module === 'ADMIN_USERS' && currentView.startsWith('ADMIN'));
          return (
            <button key={entrada.module} type="button" onClick={() => irA(entrada.module)} className={estiloAcceso(activo)}>
              <div className={`rounded-xl p-1.5 ${activo ? 'bg-teal-50' : ''}`}>{entrada.icon}</div>
              <span className="text-[10px] font-semibold leading-none">{entrada.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCurrentView('PROFILE')}
          className={estiloAcceso(currentView === 'PROFILE')}
        >
          <div className={`rounded-xl p-1.5 ${currentView === 'PROFILE' ? 'bg-teal-50' : ''}`}>
            <UserCircle className="h-5 w-5 shrink-0" />
          </div>
          <span className="text-[10px] font-semibold leading-none">Perfil</span>
        </button>

        <button
          type="button"
          onClick={() => setMenuAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={menuAbierto}
          className={estiloAcceso(false)}
        >
          <div className="rounded-xl p-1.5">
            <Menu className="h-5 w-5 shrink-0" />
          </div>
          <span className="text-[10px] font-semibold leading-none">Menú</span>
        </button>
      </div>
    </>
  );
};
