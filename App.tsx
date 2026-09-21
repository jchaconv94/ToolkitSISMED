
import React, { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { InputSection } from './components/InputSection';
import { MedicationInput, AuraAnalysisResult, StockStatus, AdditionalItem, AppModule, QuickFilterOption, AnalyzedMedication, DashboardViewMode, HealthFacility, Microred } from './types';
import { api } from './services/api';
import { analyzeInventoryWithAura } from './services/auraService';
import { generateFullReportPDF } from './services/pdfService';
import { 
  Info, FileText, Lock, ShieldCheck, ShieldAlert, ListFilter, Building2, Calendar, Clock, Network,
  BarChart2, FilterX, RefreshCw, Search, Database, Activity, Syringe, ClipboardList, Package,
  PackageSearch, ArrowDownLeft, Truck, Receipt, RotateCcw, SlidersHorizontal, CalendarCheck,
  Settings, Users, Shield, Building, FolderKanban, DatabaseBackup, FileSpreadsheet, Smartphone, User
} from 'lucide-react';

// NEW IMPORTS
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav'; // Nuevo import
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from 'sonner';

// Lazy loaded components para optimizar el bundle inicial
import { Dashboard } from './components/Dashboard';
import { AnalysisTable } from './components/AnalysisTable';
import { ReportOptionsModal } from './components/ReportOptionsModal';
import { ReviewWarningModal } from './components/ReviewWarningModal';
import { ManualEntryModal } from './components/ManualEntryModal';
import { SuccessModal } from './components/SuccessModal';
import { LoginScreen } from './components/LoginScreen';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { maintenanceMessage, shouldBlockForMaintenance } from './services/maintenanceMode';
import { AdminPanel } from './components/AdminPanel';
import { UserProfile } from './components/UserProfile';
import { WelcomeModal } from './components/WelcomeModal';
import { RedistributionModule } from './components/RedistributionModule';
import { SheetSearchModule } from './components/SheetSearchModule';
import { AdminStockAssignmentModule } from './components/AdminStockAssignmentModule';
import { AssignedIpressStockModule } from './components/AssignedIpressStockModule';
import { StockMonitoringModule } from './components/IpressStockModule';
import { AnalysisExclusionsModule } from './components/AnalysisExclusionsModule';
import { ImmunizationAdjustmentsModule } from './components/ImmunizationAdjustmentsModule';
import { ImmunizationCatalogModule } from './components/ImmunizationCatalogModule';
import { ImmunizationClosuresModule } from './components/ImmunizationClosuresModule';
import { ImmunizationConsumptionModule } from './components/ImmunizationConsumptionModule';
import { ImmunizationDistributionsModule } from './components/ImmunizationDistributionsModule';
import { ImmunizationIncomesModule } from './components/ImmunizationIncomesModule';
import { ImmunizationIncomeOriginsModule } from './components/ImmunizationIncomeOriginsModule';
import { ImmunizationConfigModule } from './components/ImmunizationConfigModule';
import { ImmunizationInitialInventoryModule } from './components/ImmunizationInitialInventoryModule';
import { ImmunizationReportsModule } from './components/ImmunizationReportsModule';
import { ImmunizationReturnsModule } from './components/ImmunizationReturnsModule';
import { ImmunizationStockModule } from './components/ImmunizationStockModule';
import { ImmunizationStockQueryModule } from './components/ImmunizationStockQueryModule';
import { APP_BASE, moduleForPath, pathForModule } from './services/appRoutes';

const SuspenseFallback = () => (
    <div className="flex-1 flex h-full w-full items-center justify-center p-8 bg-gray-50/50">
        <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600"></div>
            <p className="text-gray-500 font-medium text-sm animate-pulse">Cargando módulo...</p>
        </div>
    </div>
);

const STORAGE_KEY = 'aura_data_v1';
const REVIEW_KEY = 'aura_reviews_v1';
const ADDITIONAL_ITEMS_KEY = 'aura_additional_v1';
const WELCOME_KEY = 'aura_welcome_shown_session'; // Clave de sesión

const formatCorteDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const parts = dateStr.trim().split('-');
    if (parts.length === 2) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const months = [
            'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
            'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
        ];
        if (monthNum >= 1 && monthNum <= 12) {
            return `${months[monthNum - 1]} ${year}`;
        }
    }
    return dateStr;
};

// --- MAIN APP COMPONENT WRAPPED IN AUTH CONTEXT ---
const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <Toaster position="top-center" closeButton theme="light" style={{ zIndex: 2147483647 }} toastOptions={{ style: { zIndex: 2147483647, color: '#1e293b' }, className: 'text-slate-800' }} />
                <AuthenticatedApp />
            </AuthProvider>
        </ErrorBoundary>
    );
};

// --- AUTHENTICATED LOGIC WRAPPER ---
const AuthenticatedApp: React.FC = () => {
    const { isAuthenticated, isLoading, user, logout, hasPermission, systemConfig } = useAuth();
    // Durante el mantenimiento, la pantalla deja pasar al acceso para administradores.
    const [mostrarAccesoEnMantenimiento, setMostrarAccesoEnMantenimiento] = useState(false);
    // La vista inicial sale de la direccion, para que un enlace compartido abra donde debe.
    const [currentView, setCurrentView] = useState<AppModule>(
        () => moduleForPath(window.location.pathname) || 'DASHBOARD'
    );

    // La direccion del navegador sigue a la vista, sin agregar una entrada por render.
    // Solo con sesion iniciada: sin ella la direccion debe ser la raiz.
    useEffect(() => {
        if (!isAuthenticated) return;
        const destino = pathForModule(currentView);
        if (window.location.pathname === destino) return;
        window.history.pushState({ view: currentView }, '', destino);
    }, [currentView, isAuthenticated]);

    // Al cerrar sesion, la direccion vuelve a la raiz y la vista al inicio.
    //
    // Este componente no se desmonta al salir: solo cambia lo que muestra. Sin esto la
    // ruta del ultimo modulo quedaba en la barra del navegador, y el siguiente usuario
    // entraba directo a la pantalla del anterior.
    useEffect(() => {
        if (isAuthenticated || isLoading) return;
        setCurrentView('DASHBOARD');
        if (window.location.pathname !== APP_BASE) {
            window.history.replaceState({}, '', APP_BASE);
        }
    }, [isAuthenticated, isLoading]);

    // Botones de atras y adelante del navegador.
    useEffect(() => {
        const alNavegar = () => setCurrentView(moduleForPath(window.location.pathname) || 'DASHBOARD');
        window.addEventListener('popstate', alNavegar);
        return () => window.removeEventListener('popstate', alNavegar);
    }, []);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    
    const wasSidebarCollapsedRef = React.useRef(false);

    // Welcome Modal State
    const [showWelcome, setShowWelcome] = useState(false);

    // Listen for advanced filters toggled event to collapse/restore sidebar menu
    useEffect(() => {
        const handleAdvFiltersToggle = (e: any) => {
            const isOpen = e.detail?.open;
            if (isOpen) {
                wasSidebarCollapsedRef.current = isSidebarCollapsed;
                setIsSidebarCollapsed(true);
            } else {
                setIsSidebarCollapsed(wasSidebarCollapsedRef.current);
            }
        };
        window.addEventListener('toggle-advanced-filters', handleAdvFiltersToggle);
        return () => {
            window.removeEventListener('toggle-advanced-filters', handleAdvFiltersToggle);
        };
    }, [isSidebarCollapsed]);

    // Effect to trigger welcome modal ONCE per session
    useEffect(() => {
        if (isAuthenticated && user && !isLoading) {
            const hasShown = sessionStorage.getItem(WELCOME_KEY);
            if (!hasShown) {
                setShowWelcome(true);
                sessionStorage.setItem(WELCOME_KEY, 'true');
            }
        }
    }, [isAuthenticated, isLoading, user]);

    // Ensure currentView is allowed, if not switch to an allowed module
    useEffect(() => {
        if (isAuthenticated && !isLoading && user && !hasPermission(currentView)) {
            if (hasPermission('DASHBOARD')) setCurrentView('DASHBOARD');
            else if (hasPermission('ANALYSIS_EXCLUSIONS')) setCurrentView('ANALYSIS_EXCLUSIONS');
            else if (hasPermission('IMMUNIZATION_STOCK')) setCurrentView('IMMUNIZATION_STOCK');
                            else if (hasPermission('IMMUNIZATION_STOCK_QUERY')) setCurrentView('IMMUNIZATION_STOCK_QUERY');
            else if (hasPermission('IMMUNIZATION_INCOMES')) setCurrentView('IMMUNIZATION_INCOMES');
            else if (hasPermission('IMMUNIZATION_INCOME_ORIGINS')) setCurrentView('IMMUNIZATION_INCOME_ORIGINS');
            else if (hasPermission('IMMUNIZATION_DISTRIBUTIONS')) setCurrentView('IMMUNIZATION_DISTRIBUTIONS');
            else if (hasPermission('IMMUNIZATION_CONSUMPTION')) setCurrentView('IMMUNIZATION_CONSUMPTION');
            else if (hasPermission('IMMUNIZATION_INITIAL_INVENTORY')) setCurrentView('IMMUNIZATION_INITIAL_INVENTORY');
            else if (hasPermission('IMMUNIZATION_CATALOG')) setCurrentView('IMMUNIZATION_CATALOG');
            else if (hasPermission('IMMUNIZATION_ADJUSTMENTS')) setCurrentView('IMMUNIZATION_ADJUSTMENTS');
            else if (hasPermission('IMMUNIZATION_CLOSURES')) setCurrentView('IMMUNIZATION_CLOSURES');
            else if (hasPermission('IMMUNIZATION_REPORTS')) setCurrentView('IMMUNIZATION_REPORTS');
            else if (hasPermission('IPRESS_STOCK')) setCurrentView('IPRESS_STOCK');
            else if (hasPermission('STOCK_MONITORING')) setCurrentView('STOCK_MONITORING');
            else if (hasPermission('REDISTRIBUTION')) setCurrentView('REDISTRIBUTION');
            else if (hasPermission('SIG_SEARCH')) setCurrentView('SIG_SEARCH');
            else if (hasPermission('ADMIN_STOCK_ASSIGN')) setCurrentView('ADMIN_STOCK_ASSIGN');
            else if (hasPermission('ADMIN_USERS')) setCurrentView('ADMIN_USERS');
            else if (hasPermission('ADMIN_ROLES')) setCurrentView('ADMIN_ROLES');
            else if (hasPermission('ADMIN_FACILITIES')) setCurrentView('ADMIN_FACILITIES');
            else if (hasPermission('ADMIN_CATALOGS')) setCurrentView('ADMIN_CATALOGS');
            else if (hasPermission('ADMIN_PARAMS')) setCurrentView('ADMIN_PARAMS');
            else if (hasPermission('ADMIN_MIGRATION')) setCurrentView('ADMIN_MIGRATION');
            else if (hasPermission('PROFILE')) setCurrentView('PROFILE');
        }
    }, [currentView, isAuthenticated, isLoading, user, hasPermission]);

    const moduleHeaderInfo = useMemo(() => {
        switch (currentView) {
            case 'DASHBOARD':
                return { title: 'Análisis de Requerimiento', description: 'Vista principal y resumen de indicadores de requerimiento', icon: <BarChart2 className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ANALYSIS_EXCLUSIONS':
                return { title: 'Lista de Exclusiones', description: 'Medicamentos excluidos del análisis por establecimiento', icon: <FilterX className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600" /> };
            case 'REDISTRIBUTION':
                return { title: 'Módulo de Redistribución', description: 'Redistribución y transferencia de medicamentos entre IPRESS', icon: <RefreshCw className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'SIG_SEARCH':
                return { title: 'Consulta Stock', description: 'Buscador de existencias en el catálogo SIG', icon: <Search className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IPRESS_STOCK':
                return { title: 'Stock SISMED', description: 'Stock propio de la IPRESS, sincronizado o asignado por hoja (solo lectura)', icon: <Database className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'STOCK_MONITORING':
                return { title: 'Monitoreo de Stock SISMED', description: 'Directorio territorial del stock sincronizado de los establecimientos', icon: <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_CATALOG':
                return { title: 'Catálogo Biológico', description: 'Catálogo maestro de vacunas, jeringas y diluyentes', icon: <Syringe className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_INITIAL_INVENTORY':
                return { title: 'Inventario Inicial', description: 'Carga el stock físico por lote de productos biológicos.', icon: <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_STOCK':
                return { title: 'Stock Biológico', description: 'Stock de inmunizaciones agrupado por producto y detallado por lote', icon: <Package className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_STOCK_QUERY':
                return { title: 'Consulta de Stock Biológico', description: 'Consulta territorial de solo lectura del stock de UNGET e IPRESS', icon: <PackageSearch className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_INCOMES':
                return { title: 'Ingresos Regionales', description: 'Registro de ingresos nuevos de biológicos al almacén regional DIRESA', icon: <ArrowDownLeft className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_INCOME_ORIGINS':
                return { title: 'Orígenes de Ingreso', description: 'Catálogo administrable de orígenes para ingresos regionales', icon: <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_DISTRIBUTIONS':
                return { title: 'Distribuciones', description: 'Distribución jerárquica de biológicos DIRESA -> UNGET -> IPRESS', icon: <Truck className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_CONSUMPTION':
                return { title: 'Consumo IPRESS', description: 'Registro de consumos por comprobante con varios productos/lotes', icon: <Receipt className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_RETURNS':
                return { title: 'Devoluciones y Bajas', description: 'Registro de bajas, devoluciones y transferencias IPRESS hacia UNGET', icon: <RotateCcw className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_ADJUSTMENTS':
                return { title: 'Reajustes de Stock', description: 'Correcciones auditadas por conteo físico', icon: <SlidersHorizontal className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_CLOSURES':
                return { title: 'Cierre Mensual', description: 'Precierre IPRESS y cierre definitivo mensual por UNGET', icon: <CalendarCheck className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_REPORTS':
                return { title: 'Reportes Inmunizaciones', description: 'Reportes parciales y consolidados del movimiento biológico', icon: <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'IMMUNIZATION_CONFIG':
                return { title: 'Configuración Inmunizaciones', description: 'Configuraciones y catálogos auxiliares de inmunizaciones', icon: <Settings className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_USERS':
                return { title: 'Gestión de Usuarios', description: 'Administración de cuentas de usuario y credenciales', icon: <Users className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_ROLES':
                return { title: 'Configuración de Roles', description: 'Gestión de roles y permisos del sistema', icon: <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_FACILITIES':
                return { title: 'Establecimientos', description: 'Gestión de la organización y establecimientos', icon: <Building className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_CATALOGS':
                return { title: 'Regímenes y Profesiones', description: 'Gestión de regímenes laborales y profesiones del personal', icon: <FolderKanban className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_PARAMS':
                return { title: 'Parámetros del Sistema', description: 'Configuraciones generales del sistema', icon: <Settings className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_MIGRATION':
                return { title: 'Migración (Supabase)', description: 'Herramientas de migración y verificación de datos', icon: <DatabaseBackup className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_STOCK_ASSIGN':
                return { title: 'Columnas de Stock por Establecimiento', description: 'Columnas visibles del stock; la hoja se reconoce sola por el código', icon: <FileSpreadsheet className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'ADMIN_SYNC_DEVICES':
                return { title: 'Dispositivos Sync', description: 'Gestión de dispositivos autorizados de Sync SISMED 2.0', icon: <Smartphone className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            case 'PROFILE':
                return { title: 'Perfil de Usuario', description: 'Configuración de perfil e información personal', icon: <User className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
            default:
                if (currentView.startsWith('ADMIN')) {
                    return { title: 'Panel de Administración', description: 'Módulo de administración y configuración', icon: <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
                }
                return { title: 'ToolKit SISMED', description: 'Sistema de Gestión de Inmunizaciones y Medicamentos', icon: <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-teal-600" /> };
        }
    }, [currentView]);

    // If loading, show spinner
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
            </div>
        );
    }

    // Mantenimiento: solo entran los administradores y los autorizados para pruebas.
    // Se enciende y se apaga desde Administración → Parámetros.
    const enMantenimiento = shouldBlockForMaintenance(user, systemConfig);
    if (enMantenimiento && !(!isAuthenticated && mostrarAccesoEnMantenimiento)) {
        return (
            <MaintenanceScreen
                message={maintenanceMessage(systemConfig)}
                isAuthenticated={isAuthenticated}
                onLogout={logout}
                onGoToLogin={() => setMostrarAccesoEnMantenimiento(true)}
            />
        );
    }

    // If not authenticated, show Login
    if (!isAuthenticated) {
        return (
            <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center bg-gray-50">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
                </div>
            }>
                <LoginScreen />
            </Suspense>
        );
    }

    // --- RENDER MAIN LAYOUT ---
    return (
        <div className="flex h-[100dvh] bg-gray-50/50 overflow-hidden">
            <div className="hidden md:flex">
                <Sidebar 
                    currentView={currentView}
                    setCurrentView={setCurrentView}
                    isCollapsed={isSidebarCollapsed}
                    setIsCollapsed={setIsSidebarCollapsed}
                    user={user}
                    logout={logout}
                    hasPermission={hasPermission}
                />
            </div>

            <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden relative">
                {/* Global Header */}
                <header className="bg-white/90 border-b border-gray-200 sticky top-0 z-[1000] backdrop-blur-sm shadow-xs min-h-[52px] py-1.5 sm:py-2 px-4 sm:px-6 flex items-center justify-between transition-all duration-300 shrink-0">
                     <div className="flex items-center gap-3 min-w-0">
                        <div className="p-1.5 sm:p-2 rounded-xl bg-teal-50 text-teal-700 border border-teal-100/80 shrink-0 shadow-2xs">
                            {moduleHeaderInfo.icon}
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base sm:text-lg font-black text-slate-900 leading-tight truncate">
                                {moduleHeaderInfo.title}
                            </h2>
                            {moduleHeaderInfo.description && (
                                <p className="text-xs text-slate-500 font-medium truncate hidden sm:block mt-0.5">
                                    {moduleHeaderInfo.description}
                                </p>
                            )}
                        </div>
                     </div>
                     <div className="flex items-center gap-2.5 text-xs sm:text-sm text-gray-500 font-medium bg-slate-100/80 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full border border-slate-200/80 shadow-2xs shrink-0 ml-3">
                         <span className="w-2 h-2 rounded-full bg-teal-500 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_8px_rgba(20,184,166,0.6)]"></span>
                         <span className="truncate max-w-[130px] sm:max-w-[220px] font-bold text-slate-700">{user?.facilityData?.name || 'ToolKit SISMED'}</span>
                     </div>
                </header>

                {/* CONTENT AREA SWITCHER */}
                <main className="flex-1 overflow-y-auto w-full px-3 sm:px-5 2xl:px-6 pt-2.5 sm:pt-3 pb-16 md:pb-6 lg:pb-6">
                    <div className="mx-auto max-w-[1600px] h-full">
                        <ErrorBoundary>
                            <Suspense fallback={<SuspenseFallback />}>
                                {currentView === 'DASHBOARD' && <AnalysisModule />}
                                {currentView === 'ANALYSIS_EXCLUSIONS' && <AnalysisExclusionsModule />}
                                {currentView === 'REDISTRIBUTION' && <RedistributionModule />}
                                {currentView === 'SIG_SEARCH' && <SheetSearchModule />}
                                {currentView === 'IPRESS_STOCK' && <AssignedIpressStockModule />}
                                {currentView === 'STOCK_MONITORING' && <StockMonitoringModule />}
                                {currentView === 'IMMUNIZATION_CATALOG' && <ImmunizationCatalogModule />}
                                {currentView === 'IMMUNIZATION_INITIAL_INVENTORY' && <ImmunizationInitialInventoryModule />}
                                {currentView === 'IMMUNIZATION_STOCK' && <ImmunizationStockModule />}
                                {currentView === 'IMMUNIZATION_STOCK_QUERY' && <ImmunizationStockQueryModule />}
	                                {currentView === 'IMMUNIZATION_INCOMES' && <ImmunizationIncomesModule />}
	                                {currentView === 'IMMUNIZATION_INCOME_ORIGINS' && <ImmunizationIncomeOriginsModule />}
                                {currentView === 'IMMUNIZATION_DISTRIBUTIONS' && <ImmunizationDistributionsModule />}
                                {currentView === 'IMMUNIZATION_CONSUMPTION' && <ImmunizationConsumptionModule />}
                                {currentView === 'IMMUNIZATION_RETURNS' && <ImmunizationReturnsModule />}
                                {currentView === 'IMMUNIZATION_ADJUSTMENTS' && <ImmunizationAdjustmentsModule />}
                                {currentView === 'IMMUNIZATION_CLOSURES' && <ImmunizationClosuresModule />}
                                {currentView === 'IMMUNIZATION_REPORTS' && <ImmunizationReportsModule />}
                                {currentView === 'IMMUNIZATION_CONFIG' && <ImmunizationConfigModule />}
                                {currentView === 'ADMIN_STOCK_ASSIGN' && <AdminStockAssignmentModule />}
                                {currentView.startsWith('ADMIN') && currentView !== 'ADMIN_STOCK_ASSIGN' && <AdminPanel currentView={currentView} />}
                                {currentView === 'PROFILE' && <UserProfile />}
                            </Suspense>
                        </ErrorBoundary>
                    </div>
                </main>

                <MobileNav 
                    currentView={currentView} 
                    setCurrentView={setCurrentView} 
                    hasPermission={hasPermission} 
                />

                <Suspense fallback={null}>
                    {showWelcome && user && <WelcomeModal user={user} onClose={() => setShowWelcome(false)} />}
                </Suspense>
            </div>
        </div>
    );
};

// --- ANALYSIS MODULE (Original App Logic) ---
// Extracted to keep App.tsx clean
const AnalysisModule: React.FC = () => {
  // NEW: Get User Context
  const { user } = useAuth();

  const userFacilityCode = useMemo(() => {
    return (user?.facilityData?.code || user?.personnelData?.facilityCode || '').trim().replace(/^0+/, '');
  }, [user]);

  const currentStorageKey = useMemo(() => {
    return userFacilityCode ? `${STORAGE_KEY}_${userFacilityCode}` : STORAGE_KEY;
  }, [userFacilityCode]);

  const currentInputKey = useMemo(() => {
    return userFacilityCode ? `aura_input_data_v1_${userFacilityCode}` : 'aura_input_data_v1';
  }, [userFacilityCode]);

  const currentReviewKey = useMemo(() => {
    return userFacilityCode ? `${REVIEW_KEY}_${userFacilityCode}` : REVIEW_KEY;
  }, [userFacilityCode]);

  const currentAdditionalKey = useMemo(() => {
    return userFacilityCode ? `${ADDITIONAL_ITEMS_KEY}_${userFacilityCode}` : ADDITIONAL_ITEMS_KEY;
  }, [userFacilityCode]);

  // Initialize state from LocalStorage if available for the active facility
  const [result, setResult] = useState<AuraAnalysisResult | null>(() => {
    try {
      const savedData = localStorage.getItem(currentStorageKey) || (!userFacilityCode ? localStorage.getItem(STORAGE_KEY) : null);
      if (!savedData) return null;
      const parsed = JSON.parse(savedData) as AuraAnalysisResult;
      const resultCod = parsed?.codEess?.trim().replace(/^0+/, '');
      if (userFacilityCode && resultCod && resultCod !== userFacilityCode) {
        return null;
      }
      return parsed;
    } catch (e) {
      console.error("Error loading from local storage", e);
      return null;
    }
  });

  // NEW: Detect if current loaded data has legacy UUID-style IDs from old session
  const hasLegacyUuidCodes = useMemo(() => {
    if (!result || !result.medications || result.medications.length === 0) return false;
    return result.medications.some(m => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id));
  }, [result]);

  // --- NEW: LIFTED STATE FOR INPUT DATA ---
  const [inputData, setInputData] = useState<MedicationInput[]>(() => {
    try {
      const savedInput = localStorage.getItem(currentInputKey) || (!userFacilityCode ? localStorage.getItem('aura_input_data_v1') : null);
      return savedInput ? JSON.parse(savedInput) : [];
    } catch (e) {
      console.error("Error loading input data", e);
      return [];
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DB lookup for facility & microred metadata fallback
  const [dbFacilities, setDbFacilities] = useState<HealthFacility[]>([]);
  const [dbMicroredes, setDbMicroredes] = useState<Microred[]>([]);

  useEffect(() => {
    const fetchDb = async () => {
      try {
        const [facs, mrs] = await Promise.all([
          api.getFacilities(),
          api.getMicroredes()
        ]);
        if (facs) setDbFacilities(facs);
        if (mrs) setDbMicroredes(mrs);
      } catch (e) {
        console.error("Error fetching db in AnalysisModule", e);
      }
    };
    fetchDb();
  }, []);

  const activeCodEess = useMemo(() => {
    return result?.codEess || user?.facilityData?.code || user?.personnelData?.facilityCode || '';
  }, [result, user]);

  const activeEstName = useMemo(() => {
    if (result?.establishmentName) return result.establishmentName;
    if (user?.facilityData?.name) return user.facilityData.name;
    if (activeCodEess && dbFacilities.length > 0) {
      const norm = activeCodEess.trim().replace(/^0+/, '');
      const fac = dbFacilities.find(f => f.code.trim().replace(/^0+/, '') === norm);
      if (fac?.name) return fac.name;
    }
    return '';
  }, [result, user, activeCodEess, dbFacilities]);

  const activeMicrored = useMemo(() => {
    if (result?.microred) return result.microred;
    const mrId = user?.facilityData?.microredId || user?.personnelData?.microredId;
    if (mrId && dbMicroredes.length > 0) {
      const mr = dbMicroredes.find(m => m.id === mrId);
      if (mr?.name) return mr.name;
    }
    if (activeCodEess && dbFacilities.length > 0) {
      const norm = activeCodEess.trim().replace(/^0+/, '');
      const fac = dbFacilities.find(f => f.code.trim().replace(/^0+/, '') === norm);
      if (fac?.microredId && dbMicroredes.length > 0) {
        const mr = dbMicroredes.find(m => m.id === fac.microredId);
        if (mr?.name) return mr.name;
      }
    }
    return '';
  }, [result, user, activeCodEess, dbFacilities, dbMicroredes]);

  // --- LIFTED STATE FOR FILTERING ---
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  
  // NEW: Quick Filter State replacing showOnlyPending
  const [quickFilter, setQuickFilter] = useState<QuickFilterOption>('ALL');

  // --- REVIEW SYSTEM STATE ---
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => {
      try {
          const saved = localStorage.getItem(currentReviewKey) || (!userFacilityCode ? localStorage.getItem(REVIEW_KEY) : null);
          return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch (e) {
          return new Set();
      }
  });

  const [showReviewWarning, setShowReviewWarning] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  
  // --- ADDITIONAL ITEMS STATE ---
  const [additionalItems, setAdditionalItems] = useState<AdditionalItem[]>(() => {
      try {
          const saved = localStorage.getItem(currentAdditionalKey) || (!userFacilityCode ? localStorage.getItem(ADDITIONAL_ITEMS_KEY) : null);
          return saved ? JSON.parse(saved) : [];
      } catch (e) {
          return [];
      }
  });
  const [isManualEntryModalOpen, setIsManualEntryModalOpen] = useState(false);

  // --- FULL SCREEN STATE & NATIVE API LOGIC ---
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // --- DASHBOARD VIEW MODE PERSPECTIVE (INITIAL vs PROJECTED_SIMPLE vs PROJECTED_ADJUSTED) ---
  const [dashboardViewMode, setDashboardViewMode] = useState<DashboardViewMode>('INITIAL');
  // --- DASHBOARD SCOPE FILTER (ALL vs DME) ---
  const [dashboardScopeFilter, setDashboardScopeFilter] = useState<'ALL' | 'DME'>('ALL');

  // Handler to toggle NATIVE Fullscreen
  const handleToggleFullScreen = useCallback((targetState: boolean) => {
      const elem = document.documentElement; // Target the whole page

      if (targetState) {
          // Request Native Fullscreen
          if (elem.requestFullscreen) {
              elem.requestFullscreen().catch(err => console.error("Error enabling full-screen mode:", err));
          } else if ((elem as any).webkitRequestFullscreen) { /* Safari */
              (elem as any).webkitRequestFullscreen();
          } else if ((elem as any).msRequestFullscreen) { /* IE11 */
              (elem as any).msRequestFullscreen();
          }
      } else {
          // Exit Native Fullscreen
          if (document.exitFullscreen && document.fullscreenElement) {
              document.exitFullscreen().catch(err => console.error("Error exiting full-screen mode:", err));
          } else if ((document as any).webkitExitFullscreen) { /* Safari */
              (document as any).webkitExitFullscreen();
          } else if ((document as any).msExitFullscreen) { /* IE11 */
              (document as any).msExitFullscreen();
          }
      }
  }, []);

  // Listen for browser fullscreen changes (e.g. user presses ESC)
  useEffect(() => {
      const handleFullScreenChange = () => {
          const isNativeFullScreen = !!document.fullscreenElement || 
                                     !!(document as any).webkitFullscreenElement || 
                                     !!(document as any).msFullscreenElement;
          setIsFullScreen(isNativeFullScreen);
      };

      document.addEventListener('fullscreenchange', handleFullScreenChange);
      document.addEventListener('webkitfullscreenchange', handleFullScreenChange);
      document.addEventListener('msfullscreenchange', handleFullScreenChange);

      return () => {
          document.removeEventListener('fullscreenchange', handleFullScreenChange);
          document.removeEventListener('webkitfullscreenchange', handleFullScreenChange);
          document.removeEventListener('msfullscreenchange', handleFullScreenChange);
      };
  }, []);

  // Sync state when facility/user switches
  useEffect(() => {
    try {
      let savedDataStr = localStorage.getItem(currentStorageKey);
      let parsedResult: AuraAnalysisResult | null = savedDataStr ? JSON.parse(savedDataStr) : null;

      // Legacy migration check if scoped key not found
      if (!parsedResult && userFacilityCode) {
        const legacyStr = localStorage.getItem(STORAGE_KEY);
        if (legacyStr) {
          const legacyParsed = JSON.parse(legacyStr) as AuraAnalysisResult;
          const legacyCod = legacyParsed?.codEess?.trim().replace(/^0+/, '');
          if (legacyCod === userFacilityCode) {
            parsedResult = legacyParsed;
            localStorage.setItem(currentStorageKey, legacyStr);
          } else {
            // Unscoped legacy key belonged to another establishment! Clear legacy keys.
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem('aura_input_data_v1');
            localStorage.removeItem(REVIEW_KEY);
            localStorage.removeItem(ADDITIONAL_ITEMS_KEY);
          }
        }
      }

      // Strict mismatch check: if parsedResult belongs to a different facility code than active user, reset
      if (parsedResult?.codEess && userFacilityCode) {
        const resultCod = parsedResult.codEess.trim().replace(/^0+/, '');
        if (resultCod !== userFacilityCode) {
          console.warn(`Mismatched establishment data in cache (stored: ${resultCod}, active user: ${userFacilityCode}). Resetting.`);
          parsedResult = null;
        }
      }

      setResult(parsedResult);

      let savedInputStr = localStorage.getItem(currentInputKey);
      setInputData(savedInputStr ? JSON.parse(savedInputStr) : []);

      let savedReviewStr = localStorage.getItem(currentReviewKey);
      setReviewedIds(savedReviewStr ? new Set(JSON.parse(savedReviewStr)) : new Set());

      let savedAddStr = localStorage.getItem(currentAdditionalKey);
      setAdditionalItems(savedAddStr ? JSON.parse(savedAddStr) : []);
    } catch (e) {
      console.error("Error syncing state for user facility:", e);
    }
  }, [userFacilityCode, currentStorageKey, currentInputKey, currentReviewKey, currentAdditionalKey]);

  // PERSIST RESULT
  useEffect(() => {
    if (result) {
      try {
          localStorage.setItem(currentStorageKey, JSON.stringify(result));
      } catch (e) {
          console.warn('Storage quota exceeded on main result.', e);
      }
    } else {
      localStorage.removeItem(currentStorageKey);
    }
  }, [result, currentStorageKey]);

  // PERSIST INPUT DATA
  useEffect(() => {
    try {
      if (inputData && inputData.length > 0) {
        localStorage.setItem(currentInputKey, JSON.stringify(inputData));
      } else {
        localStorage.removeItem(currentInputKey);
      }
    } catch (e) {
      console.warn('Storage quota exceeded on input data.', e);
    }
  }, [inputData, currentInputKey]);

  // PERSIST REVIEWED IDS
  useEffect(() => {
      try {
          localStorage.setItem(currentReviewKey, JSON.stringify(Array.from(reviewedIds)));
      } catch(e) { console.warn(e); }
  }, [reviewedIds, currentReviewKey]);

  // PERSIST ADDITIONAL ITEMS
  useEffect(() => {
      try {
          localStorage.setItem(currentAdditionalKey, JSON.stringify(additionalItems));
      } catch(e) { console.warn(e); }
  }, [additionalItems, currentAdditionalKey]);

  const handleAnalyze = useCallback(async (
    data: MedicationInput[], 
    referenceDate: string, 
    vaccinesExcluded: boolean,
    metadata?: {
      microred?: string;
      codEess?: string;
      establishmentName?: string;
      category?: string;
    }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const analysisResult = await analyzeInventoryWithAura(data, referenceDate, vaccinesExcluded);
      
      // Inject imported metadata if available
      if (metadata) {
        analysisResult.microred = metadata.microred || undefined;
        analysisResult.codEess = metadata.codEess || undefined;
        analysisResult.establishmentName = metadata.establishmentName || undefined;
        analysisResult.category = metadata.category || undefined;
      }

      setResult(analysisResult);
      setSearchTerm('');
      setActiveFilters({});
      
      // Reset reviews and additional items on NEW analysis
      setReviewedIds(new Set()); 
      localStorage.removeItem(REVIEW_KEY);
      
      setAdditionalItems([]);
      localStorage.removeItem(ADDITIONAL_ITEMS_KEY);

      setQuickFilter('ALL');
      setShowSuccessModal(false);
    } catch (err: any) {
      console.error(err);
      setError("Error al procesar los datos matemáticos. Verifique que su archivo no esté corrupto.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
    setSearchTerm('');
    setActiveFilters({});
    setError(null);
    
    setReviewedIds(new Set());
    localStorage.removeItem(REVIEW_KEY);

    handleToggleFullScreen(false); // Exit fullscreen on reset
    setQuickFilter('ALL');
    
    setAdditionalItems([]);
    localStorage.removeItem(ADDITIONAL_ITEMS_KEY);

    setShowSuccessModal(false);
    setInputData([]); // Clear input data on reset
  }, [handleToggleFullScreen]);

  // UPDATED HANDLER: Now accepts CPA Mode and Excluded Indices
  const handleMedicationUpdate = useCallback((id: string, newQuantity: number, mode?: 'ADJUSTED' | 'SIMPLE', excludedIndices?: number[]) => {
    setResult((prev) => {
      if (!prev) return null;
      const updatedMedications = prev.medications.map((m) =>
        m.id === id
          ? {
              ...m,
              quantityToOrder: newQuantity,
              estimatedInvestment: newQuantity * m.unitPrice,
              selectedCpaMode: mode || m.selectedCpaMode, // Save the mode
              excludedIndices: excludedIndices !== undefined ? excludedIndices : m.excludedIndices // Save excluded indices
            }
          : m
      );
      return {
        ...prev,
        medications: updatedMedications,
      };
    });
  }, []);

  const handleToggleReview = useCallback((id: string, isReviewed: boolean) => {
      setReviewedIds(prev => {
          const next = new Set(prev);
          if (isReviewed) next.add(id);
          else next.delete(id);
          return next;
      });
  }, []);

  const handleAddAdditionalItem = (item: AdditionalItem) => {
      setAdditionalItems(prev => [...prev, item]);
  };

  const handleRemoveAdditionalItem = (id: string) => {
      setAdditionalItems(prev => prev.filter(i => i.id !== id));
  };

  const calculateHorizonMetrics = useCallback((item: AnalyzedMedication, mode: DashboardViewMode) => {
    const rawCpm = item.rawCpm || 0;
    const excludedIndices = item.excludedIndices || [];
    let activeCpm = 0;

    const useSimple = (mode === 'INITIAL' || mode === 'PROJECTED_SIMPLE') 
      || (item.selectedCpaMode === 'SIMPLE');

    if (excludedIndices.length === 0) {
      activeCpm = useSimple ? rawCpm : (item.cpm || 0);
    } else {
      // Manual/Recalculated CPM based on excluded indices
      const history = item.originalHistory || [];
      const threshold = item.spikeThreshold || 0;
      const isSporadic = item.isSporadic;
      const valuesToAverage: number[] = [];

      history.forEach((val, idx) => {
        if (val === 0) return; // Ignore zeros
        if (excludedIndices.includes(idx)) return; // Excluded by user

        if (useSimple) {
          valuesToAverage.push(val);
        } else {
          // ADJUSTED MODE
          if (isSporadic) {
            valuesToAverage.push(val);
          } else {
            if (val <= threshold) {
              valuesToAverage.push(val);
            }
          }
        }
      });

      activeCpm = valuesToAverage.length > 0
        ? valuesToAverage.reduce((a, b) => a + b, 0) / valuesToAverage.length
        : 0;
    }

    let evalStock = item.currentStock || 0;

    if (mode === 'PROJECTED_SIMPLE' || mode === 'PROJECTED_ADJUSTED') {
      const isValidated = reviewedIds.has(item.id);
      const reqVal = (isValidated && item.quantityToOrder > 0) ? item.quantityToOrder : 0;
      evalStock += reqVal;
    }

    const months = activeCpm > 0 ? evalStock / activeCpm : (evalStock > 0 ? Infinity : 0);

    let status = StockStatus.NORMOSTOCK;
    if (evalStock === 0) {
      status = StockStatus.DESABASTECIDO;
    } else if (activeCpm === 0 && evalStock > 0) {
      status = StockStatus.SIN_ROTACION;
    } else if (months > 6) {
      status = StockStatus.SOBRESTOCK;
    } else if (months >= 2 && months <= 6) {
      status = StockStatus.NORMOSTOCK;
    } else {
      status = StockStatus.SUBSTOCK;
    }

    return { activeCpm, evalStock, months, status };
  }, [reviewedIds]);

  const filteredMedications = useMemo(() => {
    if (!result) return [];
    
    // Recalculate status, months of provision, and display CPA dynamically for all medications based on active horizon mode
    let items = result.medications.map(m => {
        const { activeCpm, months, status } = calculateHorizonMetrics(m, dashboardViewMode);
        return {
            ...m,
            displayCpm: activeCpm,
            status,
            monthsOfProvision: months
        };
    });

    // Scope filter (DME vs ALL) from Diagnóstico de Disponibilidad
    if (dashboardScopeFilter === 'DME') {
        items = items.filter(m => {
            const isMed = (m.medtip || '').toUpperCase().trim() === 'M';
            const isPet = (m.medpet || '').toUpperCase().trim() === 'P';
            const est = (m.medest || '').toUpperCase().trim();
            return isMed && isPet && (est === '_' || est === 'S');
        });
    }

    // QUICK FILTER LOGIC
    if (quickFilter === 'PENDING') {
        items = items.filter(m => 
            m.status !== StockStatus.SOBRESTOCK && 
            m.status !== StockStatus.SIN_ROTACION &&
            !reviewedIds.has(m.id)
        );
    } else if (quickFilter === 'REQ_POSITIVE') {
        items = items.filter(m => m.quantityToOrder > 0);
    } else if (quickFilter === 'REQ_ZERO') {
        items = items.filter(m => m.quantityToOrder === 0);
    }

    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.name.toLowerCase().includes(lower) ||
            item.id.toLowerCase().includes(lower) ||
            (item.code && item.code.toLowerCase().includes(lower))
        );
    }

    if (Object.keys(activeFilters).length > 0) {
        items = items.filter(item => {
            return Object.entries(activeFilters).every(([key, values]) => {
                const filterValues = values as string[];
                if (!filterValues || filterValues.length === 0) return true;
                let itemValue = String((item as any)[key] || '-');
                if (key === 'isSporadic') {
                    itemValue = item.isSporadic ? "Baja Rotación" : "Rotación Normal";
                }
                return filterValues.includes(itemValue);
            });
        });
    }
    
    // Sort items alphabetically by name
    return [...items].sort((a, b) => (a.name || '').trim().localeCompare((b.name || '').trim(), 'es', { sensitivity: 'base' }));
  }, [result, searchTerm, activeFilters, quickFilter, reviewedIds, dashboardViewMode, dashboardScopeFilter, calculateHorizonMetrics]);

  const dashboardMedications = useMemo(() => {
    if (!result) return [];
    
    let items = result.medications.map(m => {
        const { activeCpm, months, status } = calculateHorizonMetrics(m, dashboardViewMode);
        return {
            ...m,
            displayCpm: activeCpm,
            status,
            monthsOfProvision: months
        };
    });

    if (quickFilter === 'PENDING') {
        items = items.filter(m => 
            m.status !== StockStatus.SOBRESTOCK && 
            m.status !== StockStatus.SIN_ROTACION &&
            !reviewedIds.has(m.id)
        );
    } else if (quickFilter === 'REQ_POSITIVE') {
        items = items.filter(m => m.quantityToOrder > 0);
    } else if (quickFilter === 'REQ_ZERO') {
        items = items.filter(m => m.quantityToOrder === 0);
    }

    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.name.toLowerCase().includes(lower) ||
            item.id.toLowerCase().includes(lower) ||
            (item.code && item.code.toLowerCase().includes(lower))
        );
    }

    if (Object.keys(activeFilters).length > 0) {
        items = items.filter(item => {
            return Object.entries(activeFilters).every(([key, values]) => {
                if (key === 'status') return true; // Ignore status filter for dashboard chart calculations
                const filterValues = values as string[];
                if (!filterValues || filterValues.length === 0) return true;
                let itemValue = String((item as any)[key] || '-');
                if (key === 'isSporadic') {
                    itemValue = item.isSporadic ? "Baja Rotación" : "Rotación Normal";
                }
                return filterValues.includes(itemValue);
            });
        });
    }

    return items;
  }, [result, searchTerm, activeFilters, quickFilter, reviewedIds, dashboardViewMode, calculateHorizonMetrics]);

  // UPDATE: Calculates dashboard metrics according to horizon (INITIAL vs PROJECTED) and scope (ALL vs DME)
  const dashboardResult = useMemo(() => {
    if (!result) return null;

    // Use dashboardMedications which keeps status distribution intact even when status filter is active
    let currentItems = dashboardMedications;

    // Apply Scope Filter (DME)
    if (dashboardScopeFilter === 'DME') {
      currentItems = currentItems.filter(m => {
        const isMed = (m.medtip || '').toUpperCase().trim() === 'M';
        const isPet = (m.medpet || '').toUpperCase().trim() === 'P';
        const est = (m.medest || '').toUpperCase().trim();
        return isMed && isPet && (est === '_' || est === 'S');
      });
    }
    
    // Filter essential medications for DME indicator in UI
    const essentialMedications = currentItems.filter(m => {
        const isMed = (m.medtip || '').toUpperCase().trim() === 'M';
        const isPet = (m.medpet || '').toUpperCase().trim() === 'P';
        const est = (m.medest || '').toUpperCase().trim();
        const isEst = est === '_' || est === 'S';
        return isMed && isPet && isEst;
    });

    const totalEssentialItems = essentialMedications.length;
    
    const availableEssentialItems = essentialMedications.filter(m => 
        m.status === StockStatus.NORMOSTOCK || 
        m.status === StockStatus.SOBRESTOCK
    ).length;
    
    const dmeScore = totalEssentialItems > 0 ? (availableEssentialItems / totalEssentialItems) * 100 : 0;
    
    let indicatorStatus: 'OPTIMO' | 'ALTO' | 'REGULAR' | 'BAJO' = 'BAJO';
    if (dmeScore >= 90) indicatorStatus = 'OPTIMO';
    else if (dmeScore >= 80) indicatorStatus = 'ALTO';
    else if (dmeScore >= 70) indicatorStatus = 'REGULAR';

    return {
        ...result,
        medications: currentItems,
        indicators: {
            dmeScore,
            status: indicatorStatus,
            totalItems: totalEssentialItems,
            availableItems: availableEssentialItems
        }
    };
  }, [result, dashboardMedications, dashboardScopeFilter]);

  const { reviewProgress, isReviewComplete, reviewedCount, totalToReview } = useMemo(() => {
      if (!result) return { reviewProgress: 0, isReviewComplete: false, reviewedCount: 0, totalToReview: 0 };
      const itemsWithStatus = result.medications.map(m => {
          const { months, status } = calculateHorizonMetrics(m, dashboardViewMode);
          return {
              ...m,
              status,
              monthsOfProvision: months
          };
      });
      const itemsRequiringReview = itemsWithStatus.filter(m => 
          m.status !== StockStatus.SOBRESTOCK && 
          m.status !== StockStatus.SIN_ROTACION
      );
      const totalCount = itemsRequiringReview.length;
      if (totalCount === 0) {
          return { reviewProgress: 100, isReviewComplete: true, reviewedCount: 0, totalToReview: 0 };
      }
      const revCount = itemsRequiringReview.filter(m => reviewedIds.has(m.id)).length;
      const progress = Math.round((revCount / totalCount) * 100);
      return {
          reviewProgress: progress,
          isReviewComplete: revCount === totalCount,
          reviewedCount: revCount,
          totalToReview: totalCount
      };
  }, [result, reviewedIds, dashboardViewMode, calculateHorizonMetrics]);

  const prevIsReviewCompleteRef = useRef<boolean>(false);
  const hasShownSuccessModalRef = useRef<boolean>(false);

  // Reset completion modal state when a new analysis result is loaded
  useEffect(() => {
    prevIsReviewCompleteRef.current = false;
    hasShownSuccessModalRef.current = false;
  }, [result]);

  useEffect(() => {
    if (isReviewComplete && totalToReview > 0) {
      if (!prevIsReviewCompleteRef.current && !hasShownSuccessModalRef.current) {
        setShowSuccessModal(true);
        hasShownSuccessModalRef.current = true;
      }
    } else if (!isReviewComplete) {
      hasShownSuccessModalRef.current = false;
    }
    prevIsReviewCompleteRef.current = isReviewComplete;
  }, [isReviewComplete, totalToReview]);

  const handleDownloadClick = () => {
      if (isReviewComplete) {
          setIsReportModalOpen(true);
      } else {
          setShowReviewWarning(true);
      }
  };

  const handleGenerateReport = async (excludeVaccines: boolean, excludeNoSupply: boolean) => {
    if (!dashboardResult) return;
    let finalMedications = [...dashboardResult.medications];
    if (excludeVaccines) {
        finalMedications = finalMedications.filter(m => {
            const name = m.name.toUpperCase();
            return !name.includes("VACUNA") && !name.includes("DILUYENTE");
        });
    }
    if (excludeNoSupply) {
        finalMedications = finalMedications.filter(m => m.quantityToOrder > 0);
    }

    // Ordenar alfabéticamente por DESCRIPCIÓN (A - Z)
    finalMedications.sort((a, b) => {
        const comp = (a.name || '').trim().localeCompare((b.name || '').trim(), 'es', { sensitivity: 'base', numeric: true });
        if (comp !== 0) return comp;
        return (a.id || '').localeCompare(b.id || '');
    });
    
    const establishmentName = user?.facilityData?.name || 'ESTABLECIMIENTO DE SALUD';
    const responsibleName = user?.personnelData ? `${user.personnelData.firstName} ${user.personnelData.lastName}` : (user?.username || '');
    await generateFullReportPDF(dashboardResult, finalMedications, additionalItems, establishmentName, responsibleName, dashboardViewMode);
    
    setIsReportModalOpen(false);
  };

  return (
    <div className={`pb-12 ${isFullScreen ? 'max-w-none px-0' : 'max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8 py-4 2xl:py-8 space-y-4 2xl:space-y-8'}`}>
        {!isFullScreen && !result && !loading && (
          <div className="bg-white border border-teal-100 rounded-2xl p-6 2xl:p-8 flex gap-6 shadow-sm animate-in fade-in slide-in-from-top-4">
            <div className="bg-teal-50 p-4 rounded-full h-fit shrink-0">
              <Info className="h-8 w-8 text-teal-600" />
            </div>
            <div>
              <h2 className="text-xl 2xl:text-2xl font-bold text-gray-900">Módulo de Análisis Inteligente</h2>
              <p className="text-gray-600 mt-2 max-w-3xl leading-relaxed text-sm 2xl:text-base">
                Cargue su archivo Excel de requerimiento descargado del SISMED, para que el sistema lo analice.
              </p>
            </div>
          </div>
        )}

        <div className={isFullScreen ? 'hidden' : 'block'}>
            <InputSection 
                onAnalyze={handleAnalyze} 
                isAnalyzing={loading} 
                onReset={handleReset} 
                hasAnalyzedData={!!result}
                analysisResult={result}
                currentItems={inputData}
                onItemsChange={setInputData}
                onResultChange={setResult}
                reviewedIds={reviewedIds}
                onReviewedIdsChange={setReviewedIds}
                additionalItems={additionalItems}
                onAdditionalItemsChange={setAdditionalItems}
            />
        </div>

        {error && !isFullScreen && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <Info className="h-5 w-5" />
            {error}
          </div>
        )}

        {result && dashboardResult && (
          <div className={`space-y-4 2xl:space-y-8 ${!isFullScreen ? 'animate-in fade-in slide-in-from-bottom-4 duration-700' : ''}`}>
             {!isFullScreen && hasLegacyUuidCodes && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
                    <div className="flex gap-3 sm:gap-4 items-start">
                        <div className="bg-amber-100 text-amber-700 p-2.5 rounded-xl shrink-0">
                            <Info className="h-5 sm:h-6 w-5 sm:w-6" />
                        </div>
                        <div>
                            <h4 className="font-black text-amber-900 text-base">⚠️ Historial con Códigos Desactualizados (UUID)</h4>
                            <p className="text-amber-800 text-xs sm:text-sm mt-1 leading-relaxed max-w-4xl">
                                Los datos actuales corresponden a una carga previa que usó identificadores temporales (UUID). Para visualizar los códigos reales y únicos de medicamentos de la columna <strong>F ("MED COD")</strong>, simplemente vuelve a cargar tu archivo de SISMED en la sección de arriba. El sistema actualizará de inmediato la base de datos con los códigos reales.
                            </p>
                        </div>
                    </div>
                </div>
             )}

             {!isFullScreen && (
                <div className="flex flex-col xl:flex-row items-end xl:items-center justify-between gap-6 border-b border-gray-200 pb-4 2xl:pb-6">
                    <div>
                        <h2 className="text-2xl 2xl:text-3xl font-bold text-gray-900 tracking-tight">Resultados del Análisis</h2>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            {/* ESTABLECIMIENTO Y CÓDIGO */}
                            {activeEstName && (
                                <div className="flex items-center gap-1.5 text-teal-900 bg-teal-50/80 border border-teal-100 rounded-lg px-2.5 py-1 tracking-tight font-extrabold text-xs">
                                    <Building2 className="h-3.5 w-3.5 text-teal-600 animate-pulse" />
                                    <span>
                                        {activeCodEess ? `${activeCodEess} - ` : ''}
                                        {activeEstName.toUpperCase()}
                                    </span>
                                </div>
                            )}

                            {/* MICRORED */}
                            {activeMicrored && (
                                <div className="flex items-center gap-1.5 text-teal-800 bg-teal-50/50 border border-teal-100 rounded-lg px-2.5 py-1 text-xs font-semibold">
                                    <Network className="h-3.5 w-3.5 text-teal-600" />
                                    <span>MR: <span className="font-bold text-teal-800">{activeMicrored.toUpperCase()}</span></span>
                                </div>
                            )}

                            {/* CORTE */}
                            {result.referenceDate && (
                                <div className="flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide">
                                    <Calendar className="h-3.5 w-3.5 text-amber-600" />
                                    <span>CORTE: {formatCorteDate(result.referenceDate)}</span>
                                </div>
                            )}

                            {/* GENERADO */}
                            <div className="flex items-center gap-1.5 text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-medium">
                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                <span>Generado: {new Date(result.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-stretch gap-4 w-full xl:w-auto">
                        <div className={`rounded-2xl border p-4 w-full sm:w-[360px] flex flex-col justify-between gap-3 shadow-sm transition-all duration-300 ${isReviewComplete ? 'bg-white border-teal-200' : 'bg-white border-amber-200'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${isReviewComplete ? 'bg-teal-100 text-teal-600' : 'bg-amber-100 text-amber-600'}`}>
                                        {isReviewComplete ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                                    </div>
                                    <div>
                                        <h4 className={`text-xs font-black uppercase tracking-wider ${isReviewComplete ? 'text-teal-700' : 'text-amber-700'}`}>{isReviewComplete ? 'Auditoría Finalizada' : 'Auditoría en Curso'}</h4>
                                        <div className="text-[10px] text-gray-500 font-medium mt-0.5">{isReviewComplete ? 'Todos los ítems validados' : `${reviewedCount} de ${totalToReview} ítems revisados`}</div>
                                    </div>
                                </div>
                                <span className={`text-2xl font-black ${isReviewComplete ? 'text-teal-500' : 'text-amber-500'}`}>{reviewProgress}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden border border-gray-100">
                                <div className={`h-full transition-all duration-500 rounded-full ${isReviewComplete ? 'bg-teal-500' : 'bg-amber-500'}`} style={{ width: `${reviewProgress}%` }} />
                            </div>
                            {!isReviewComplete && (
                                <button onClick={() => setQuickFilter(quickFilter === 'PENDING' ? 'ALL' : 'PENDING')} className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${quickFilter === 'PENDING' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-gray-50 text-gray-600 hover:bg-amber-50 hover:text-amber-700 border border-gray-200 hover:border-amber-200'}`}>
                                    <ListFilter className="h-3.5 w-3.5" />
                                    {quickFilter === 'PENDING' ? "Mostrando Solo Pendientes" : "Filtrar Pendientes de Validar"}
                                </button>
                            )}
                        </div>

                        <button onClick={handleDownloadClick} className={`group relative flex items-center justify-center gap-3 px-6 py-4 rounded-2xl transition-all shadow-md font-bold text-sm overflow-hidden w-full sm:w-auto ${isReviewComplete ? 'bg-gray-900 text-white hover:bg-black hover:shadow-xl hover:-translate-y-0.5' : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'}`}>
                            <div className="flex flex-col items-center">
                                {isReviewComplete ? <FileText className="h-6 w-6 mb-1" /> : <Lock className="h-6 w-6 mb-1" />}
                                <span>Descargar</span>
                                <span className="text-[10px] opacity-70 font-normal">Informe PDF</span>
                            </div>
                            {isReviewComplete && <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent z-20" />}
                        </button>
                    </div>
                </div>
            )}
            
            {!isFullScreen && (
                <Dashboard 
                    result={dashboardResult} 
                    viewMode={dashboardViewMode}
                    onViewModeChange={setDashboardViewMode}
                    scopeFilter={dashboardScopeFilter}
                    onScopeFilterChange={setDashboardScopeFilter}
                    selectedStatusFilter={activeFilters.status && activeFilters.status.length > 0 ? (activeFilters.status[0] as StockStatus) : null}
                    onStatusFilterChange={(status) => {
                      setActiveFilters(prev => {
                        const next = { ...prev };
                        if (!status) {
                          delete next.status;
                        } else {
                          next.status = [status];
                        }
                        return next;
                      });
                    }}
                />
            )}
            
            <AnalysisTable 
                medications={filteredMedications} 
                allMedications={result.medications}
                referenceDate={result.referenceDate} 
                viewMode={dashboardViewMode}
                onMedicationUpdate={handleMedicationUpdate}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                activeFilters={activeFilters}
                onFilterChange={setActiveFilters}
                onDownloadReport={handleDownloadClick}
                reviewedIds={reviewedIds}
                onToggleReview={handleToggleReview}
                reviewProgress={reviewProgress}
                reviewedCount={reviewedCount}
                totalToReview={totalToReview}
                isFullScreen={isFullScreen}
                onToggleFullScreen={handleToggleFullScreen}
                quickFilter={quickFilter}
                onQuickFilterChange={setQuickFilter}
                additionalItemsCount={additionalItems.length}
                onOpenAdditionalModal={() => setIsManualEntryModalOpen(true)}
            />
          </div>
        )}

        <Suspense fallback={null}>
            <ReportOptionsModal isOpen={isReportModalOpen} onClose={() => setIsReportModalOpen(false)} onConfirm={handleGenerateReport} totalItems={filteredMedications.length} vaccinesAlreadyExcluded={result?.analysisConfig?.vaccinesExcluded ?? false} />
            <ReviewWarningModal isOpen={showReviewWarning} onClose={() => setShowReviewWarning(false)} progress={reviewProgress} />
            <SuccessModal isOpen={showSuccessModal} onClose={() => setShowSuccessModal(false)} onDownload={handleDownloadClick} />
            <ManualEntryModal isOpen={isManualEntryModalOpen} onClose={() => setIsManualEntryModalOpen(false)} items={additionalItems} onAdd={handleAddAdditionalItem} onRemove={handleRemoveAdditionalItem} />
        </Suspense>
    </div>
  );
};

export default App;
