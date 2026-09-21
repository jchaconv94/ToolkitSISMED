import React, { useState, useEffect } from 'react';
import {
  PackageSearch, 
  BarChart2, 
  ArrowRightLeft, 
  Settings, 
  ShieldCheck, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  UserCircle,
  LogOut,
  Layers,
  Database,
  FileSpreadsheet,
  Users,
  Shield,
  Building2,
  Sliders,
  Briefcase,
  RefreshCw,
  Syringe,
  ClipboardList,
  ArrowDownToLine,
  Boxes,
  Truck,
  Scale,
  BarChart3,
  Activity,
  ArchiveX,
  CalendarCheck,
  Ban
} from 'lucide-react';
import { AppModule, User } from '../types';

interface SidebarProps {
  currentView: AppModule;
  setCurrentView: (view: AppModule) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  user: User | null;
  logout: () => void;
  hasPermission: (module: AppModule) => boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  isCollapsed,
  setIsCollapsed,
  user,
  logout,
  hasPermission
}) => {
  const [isAdminExpanded, setIsAdminExpanded] = useState(false);
  const [isImmunizationExpanded, setIsImmunizationExpanded] = useState(false);
  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);
  
  useEffect(() => {
    if (currentView.startsWith('ADMIN') && !isCollapsed) {
      setIsAdminExpanded(true);
    }
    if (currentView.startsWith('IMMUNIZATION') && !isCollapsed) {
      setIsImmunizationExpanded(true);
    }
    if ((currentView === 'DASHBOARD' || currentView === 'ANALYSIS_EXCLUSIONS') && !isCollapsed) {
      setIsAnalysisExpanded(true);
    }
  }, [currentView, isCollapsed]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);

  const toggleAnalysis = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setIsAnalysisExpanded(true);
    } else {
      setIsAnalysisExpanded(!isAnalysisExpanded);
    }
  };

  const toggleAdmin = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setIsAdminExpanded(true);
    } else {
      setIsAdminExpanded(!isAdminExpanded);
    }
  };

  const toggleImmunization = () => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setIsImmunizationExpanded(true);
    } else {
      setIsImmunizationExpanded(!isImmunizationExpanded);
    }
  };

  return (
    <div 
      className={`relative flex flex-col bg-gray-950 border-r border-white/5 transition-all duration-300 z-[100002] ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Branding Header */}
      <div className={`flex items-center h-16 border-b border-white/5 mx-1 mt-2 transition-all duration-300 ${isCollapsed ? 'justify-center' : 'justify-between px-3'}`}>
        <div className="flex items-center gap-2 overflow-hidden shrink-0">
          <div className="relative shrink-0 flex items-center justify-center">
            <Layers className="h-7 w-7 text-cyan-400" strokeWidth={2.5} />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col whitespace-nowrap justify-center mt-0.5 animate-in fade-in duration-300">
              <div className="flex items-center gap-1 mt-0.5">
                <h1 className="text-[16px] font-black text-white tracking-tight leading-none flex items-baseline">
                  ToolKit <span className="font-bold text-gray-400 ml-1">SISMED</span>
                </h1>
                <span className="text-[8px] font-bold text-cyan-400 px-1 py-0.5 bg-cyan-500/10 rounded border border-cyan-500/20 leading-none self-center ml-0.5 shrink-0">WEB</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Toggle Button */}
        {!isCollapsed ? (
          <button 
            onClick={toggleCollapse}
            className="flex items-center justify-center rounded-lg p-1.5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      
      {/* Absolute toggle button when collapsed */}
      {isCollapsed && (
        <button 
          onClick={toggleCollapse}
          className="absolute -right-3 top-7 flex items-center justify-center w-6 h-6 bg-gray-800 border border-gray-700 rounded-full hover:bg-gray-700 text-gray-400 hover:text-white transition-colors z-50 shadow-md"
        >
          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </button>
      )}

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-2">
        {(hasPermission('DASHBOARD') || hasPermission('ANALYSIS_EXCLUSIONS')) && (
          <div className="flex flex-col gap-1">
            <button
              onClick={toggleAnalysis}
              className={`w-full flex items-center py-3 rounded-xl transition-all duration-300 group ${
                currentView === 'DASHBOARD' || currentView === 'ANALYSIS_EXCLUSIONS'
                  ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              } ${isCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}
              title={isCollapsed ? "Análisis" : ""}
            >
              {isCollapsed ? (
                <BarChart2 className={`h-5 w-5 shrink-0 ${currentView === 'DASHBOARD' || currentView === 'ANALYSIS_EXCLUSIONS' ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <BarChart2 className={`h-5 w-5 shrink-0 ${currentView === 'DASHBOARD' || currentView === 'ANALYSIS_EXCLUSIONS' ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
                    <span className="font-semibold text-sm">Análisis</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isAnalysisExpanded ? 'rotate-180 text-teal-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
                </>
              )}
            </button>

            {/* Sub-menu */}
            {!isCollapsed && isAnalysisExpanded && (
              <div className="flex flex-col gap-1 pl-4 mt-1 animate-in slide-in-from-top-2 fade-in duration-200">
                <div className="pl-3 border-l-2 border-white/10 flex flex-col gap-1">
                  {hasPermission('DASHBOARD') && (
                    <button
                      onClick={() => setCurrentView('DASHBOARD')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'DASHBOARD'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <BarChart2 className="h-4 w-4 shrink-0" />
                      Análisis Requerimiento
                    </button>
                  )}
                  {hasPermission('ANALYSIS_EXCLUSIONS') && (
                    <button
                      onClick={() => setCurrentView('ANALYSIS_EXCLUSIONS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ANALYSIS_EXCLUSIONS'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Ban className="h-4 w-4 shrink-0 text-rose-400" />
                      Lista de Exclusiones
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {hasPermission('REDISTRIBUTION') && (
          <button
            onClick={() => setCurrentView('REDISTRIBUTION')}
            className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all duration-300 group ${
              currentView === 'REDISTRIBUTION'
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            } ${isCollapsed ? 'justify-center px-0' : 'px-3'}`}
            title={isCollapsed ? "Redistribución" : ""}
          >
            <ArrowRightLeft className={`h-5 w-5 shrink-0 ${currentView === 'REDISTRIBUTION' ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
            {!isCollapsed && <span className="font-semibold text-sm">Redistribución</span>}
          </button>
        )}

        {hasPermission('SIG_SEARCH') && (
          <button
            onClick={() => setCurrentView('SIG_SEARCH')}
            className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all duration-300 group ${
              currentView === 'SIG_SEARCH'
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            } ${isCollapsed ? 'justify-center px-0' : 'px-3'}`}
            title={isCollapsed ? "Consulta Stock" : ""}
          >
            <Database className={`h-5 w-5 shrink-0 ${currentView === 'SIG_SEARCH' ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
            {!isCollapsed && <span className="font-semibold text-sm">Consulta Stock</span>}
          </button>
        )}

        {hasPermission('IPRESS_STOCK') && (
          <button
            onClick={() => setCurrentView('IPRESS_STOCK')}
            className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all duration-300 group ${
              currentView === 'IPRESS_STOCK'
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            } ${isCollapsed ? 'justify-center px-0' : 'px-3'}`}
            title={isCollapsed ? "Stock SISMED" : ""}
          >
            <FileSpreadsheet className={`h-5 w-5 shrink-0 ${currentView === 'IPRESS_STOCK' ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
            {!isCollapsed && <span className="font-semibold text-sm">Stock SISMED</span>}
          </button>
        )}

        {hasPermission('STOCK_MONITORING') && (
          <button
            onClick={() => setCurrentView('STOCK_MONITORING')}
            className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all duration-300 group ${
              currentView === 'STOCK_MONITORING'
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            } ${isCollapsed ? 'justify-center px-0' : 'px-3'}`}
            title={isCollapsed ? "Monitoreo de Stock" : ""}
          >
            <Layers className={`h-5 w-5 shrink-0 ${currentView === 'STOCK_MONITORING' ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
            {!isCollapsed && <span className="font-semibold text-sm">Monitoreo de Stock</span>}
          </button>
        )}

        {(hasPermission('IMMUNIZATION_CATALOG') || hasPermission('IMMUNIZATION_INITIAL_INVENTORY') || hasPermission('IMMUNIZATION_STOCK') || hasPermission('IMMUNIZATION_STOCK_QUERY') || hasPermission('IMMUNIZATION_INCOMES') || hasPermission('IMMUNIZATION_INCOME_ORIGINS') || hasPermission('IMMUNIZATION_DISTRIBUTIONS') || hasPermission('IMMUNIZATION_CONSUMPTION') || hasPermission('IMMUNIZATION_RETURNS') || hasPermission('IMMUNIZATION_ADJUSTMENTS') || hasPermission('IMMUNIZATION_CLOSURES') || hasPermission('IMMUNIZATION_REPORTS') || hasPermission('IMMUNIZATION_CONFIG')) && (
          <div className="flex flex-col gap-1">
            <button
              onClick={toggleImmunization}
              className={`w-full flex items-center py-3 rounded-xl transition-all duration-300 group ${
                currentView.startsWith('IMMUNIZATION')
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              } ${isCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}
              title={isCollapsed ? "Inmunizaciones" : ""}
            >
              {isCollapsed ? (
                <Syringe className={`h-5 w-5 shrink-0 ${currentView.startsWith('IMMUNIZATION') ? 'text-cyan-400' : 'group-hover:text-cyan-400 transition-colors'}`} />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Syringe className={`h-5 w-5 shrink-0 ${currentView.startsWith('IMMUNIZATION') ? 'text-cyan-400' : 'group-hover:text-cyan-400 transition-colors'}`} />
                    <span className="font-semibold text-sm">Inmunizaciones</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isImmunizationExpanded ? 'rotate-180 text-cyan-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
                </>
              )}
            </button>

            {!isCollapsed && isImmunizationExpanded && (
              <div className="flex flex-col gap-1 pl-4 mt-1 animate-in slide-in-from-top-2 fade-in duration-200">
                <div className="pl-3 border-l-2 border-white/10 flex flex-col gap-1">
                  {hasPermission('IMMUNIZATION_CATALOG') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_CATALOG')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_CATALOG' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      Catálogo Biológico
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_INITIAL_INVENTORY') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_INITIAL_INVENTORY')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_INITIAL_INVENTORY' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <ClipboardList className="h-4 w-4 shrink-0" />
                      Inventario Inicial
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_STOCK') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_STOCK')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_STOCK' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Boxes className="h-4 w-4 shrink-0" />
                      Stock Biológico
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_STOCK_QUERY') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_STOCK_QUERY')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_STOCK_QUERY' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <PackageSearch className="h-4 w-4 shrink-0" />
                      Consulta de Stock
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_INCOMES') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_INCOMES')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_INCOMES' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <ArrowDownToLine className="h-4 w-4 shrink-0" />
                      Ingresos Regionales
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_DISTRIBUTIONS') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_DISTRIBUTIONS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_DISTRIBUTIONS' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Truck className="h-4 w-4 shrink-0" />
                      Distribuciones
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_CONSUMPTION') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_CONSUMPTION')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_CONSUMPTION' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Activity className="h-4 w-4 shrink-0" />
                      Consumo IPRESS
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_RETURNS') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_RETURNS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_RETURNS' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <ArchiveX className="h-4 w-4 shrink-0" />
                      Devoluciones y Bajas
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_ADJUSTMENTS') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_ADJUSTMENTS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_ADJUSTMENTS' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Scale className="h-4 w-4 shrink-0" />
                      Reajustes
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_CLOSURES') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_CLOSURES')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_CLOSURES' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <CalendarCheck className="h-4 w-4 shrink-0" />
                      Cierre Mensual
                    </button>
                  )}
                  {hasPermission('IMMUNIZATION_REPORTS') && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_REPORTS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_REPORTS' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <BarChart3 className="h-4 w-4 shrink-0" />
                      Reportes
                    </button>
                  )}
                  {(hasPermission('IMMUNIZATION_CONFIG') || hasPermission('IMMUNIZATION_INCOME_ORIGINS')) && (
                    <button
                      onClick={() => setCurrentView('IMMUNIZATION_CONFIG')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'IMMUNIZATION_CONFIG' || currentView === 'IMMUNIZATION_INCOME_ORIGINS' ? 'text-cyan-400 bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Sliders className="h-4 w-4 shrink-0" />
                      Configuración
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {(hasPermission('ADMIN_USERS') || hasPermission('ADMIN_ROLES') || hasPermission('ADMIN_FACILITIES') || hasPermission('ADMIN_PARAMS') || hasPermission('ADMIN_MIGRATION') || hasPermission('ADMIN_CATALOGS')) && (
          <div className="flex flex-col gap-1">
            <button
              onClick={toggleAdmin}
              className={`w-full flex items-center py-3 rounded-xl transition-all duration-300 group ${
                currentView.startsWith('ADMIN')
                  ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              } ${isCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}
               title={isCollapsed ? "Administración" : ""}
            >
              {isCollapsed ? (
                <Settings className={`h-5 w-5 shrink-0 ${currentView.startsWith('ADMIN') ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Settings className={`h-5 w-5 shrink-0 ${currentView.startsWith('ADMIN') ? 'text-teal-400' : 'group-hover:text-teal-400 transition-colors'}`} />
                    <span className="font-semibold text-sm">Administración</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isAdminExpanded ? 'rotate-180 text-teal-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
                </>
              )}
            </button>
            
            {/* Sub-menu */}
            {!isCollapsed && isAdminExpanded && (
              <div className="flex flex-col gap-1 pl-4 mt-1 animate-in slide-in-from-top-2 fade-in duration-200">
                <div className="pl-3 border-l-2 border-white/10 flex flex-col gap-1">
                  {hasPermission('ADMIN_USERS') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_USERS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_USERS'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      Gestión de Usuarios
                    </button>
                  )}
                  {hasPermission('ADMIN_ROLES') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_ROLES')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_ROLES'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Shield className="h-4 w-4 shrink-0" />
                      Configuración de Roles
                    </button>
                  )}
                  {hasPermission('ADMIN_FACILITIES') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_FACILITIES')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_FACILITIES'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Building2 className="h-4 w-4 shrink-0" />
                      Establecimientos
                    </button>
                  )}
                  {hasPermission('ADMIN_PARAMS') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_PARAMS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_PARAMS'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Sliders className="h-4 w-4 shrink-0" />
                      Parámetros Sistema
                    </button>
                  )}
                  {hasPermission('ADMIN_CATALOGS') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_CATALOGS')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_CATALOGS'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Briefcase className="h-4 w-4 shrink-0" />
                      Regímenes y Profesiones
                    </button>
                  )}
                  {hasPermission('ADMIN_MIGRATION') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_MIGRATION')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_MIGRATION'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Database className="h-4 w-4 shrink-0" />
                      Migrar Datos (Supabase)
                    </button>
                  )}
                  {hasPermission('ADMIN_STOCK_ASSIGN') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_STOCK_ASSIGN')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_STOCK_ASSIGN'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      Columnas de Stock
                    </button>
                  )}
                  {hasPermission('ADMIN_SYNC_DEVICES') && (
                    <button
                      onClick={() => setCurrentView('ADMIN_SYNC_DEVICES')}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                        currentView === 'ADMIN_SYNC_DEVICES'
                          ? 'text-teal-400 bg-white/5'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <RefreshCw className="h-4 w-4 shrink-0" />
                      Dispositivos Sync
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User Footer */}
      <div className="p-3 mt-auto border-t border-white/5">
        <div className={`flex items-center ${isCollapsed ? 'justify-center flex-col gap-3' : 'justify-between'} bg-gray-900/50 rounded-xl p-2 border border-white/5`}>
          <button 
             onClick={() => setCurrentView('PROFILE')}
             className={`flex items-center gap-3 group hover:bg-white/5 p-1.5 rounded-lg transition-all flex-1 min-w-0 ${isCollapsed ? 'justify-center' : ''}`}
             title={isCollapsed ? "Perfil" : ""}
          >
            <div className="bg-gradient-to-br from-teal-500 to-emerald-600 p-[2px] rounded-full shrink-0">
              <div className="bg-gray-900 rounded-full p-0.5">
                  <UserCircle className="h-6 w-6 text-gray-200" />
              </div>
            </div>
            {!isCollapsed && (
              <div className="flex flex-col text-left overflow-hidden">
                <span className="text-xs font-bold text-white group-hover:text-teal-400 transition-colors truncate">
                    {user?.personnelData?.firstName || user?.username}
                </span>
                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider truncate">
                    {user?.role}
                </span>
              </div>
            )}
          </button>
          
          <button 
             onClick={logout} 
             className={`p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0 ${isCollapsed ? 'w-full flex justify-center' : ''}`}
             title="Cerrar Sesión"
          >
             <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
