
import { formatCorteDate } from "./services/requirementMonths";
import React, { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { InputSection } from './components/InputSection';
import { MedicationInput, AuraAnalysisResult, StockStatus, AdditionalItem, AppModule, QuickFilterOption, AnalyzedMedication, DashboardViewMode, HealthFacility, Microred } from './types';
import { api } from './services/api';
import { analyzeInventoryWithAura } from './services/auraService';
import { generateFullReportPDF } from './services/pdfService';
import { 
  Info, FileText, Lock, ShieldCheck, ShieldAlert, ListFilter, Building2, Calendar, Clock, Network, Tag,
  ArrowLeft, Home, UserCircle2, Search
} from 'lucide-react';

// NEW IMPORTS
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/Sidebar';
import { MobileSectionScreen, MobileTabBar, activeMobileTab } from './components/MobileNavigation';
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
import { MODULE_HEADER_SLOT_ID } from './components/ui/ModuleHeaderSlot';
import { HomeModule } from './components/HomeModule';
import { UserMenu } from './components/UserMenu';
import { ToolSearchDialog, ToolSearchTrigger, useToolSearchShortcut } from './components/ToolSearch';
import { findNavItem, findNavSection, findVisibleNavSection, NAV_TINT_CLASSES, visibleNavSections } from './components/navigation';
import { BrandBootScreen, BrandLogo } from './components/ui/BrandLogo';
import { UserProfile } from './components/UserProfile';
import { showWelcomeToast } from './components/WelcomeToast';
import { RedistributionModule } from './components/RedistributionModule';
import { SheetSearchModule } from './components/SheetSearchModule';
import { AdminStockAssignmentModule } from './components/AdminStockAssignmentModule';
import { AdminSendKeysModule } from './components/AdminSendKeysModule';
import { BackupsSismedModule } from './components/BackupsSismedModule';
import { BackupManagerProvider } from './contexts/BackupManagerContext';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { NotificationBell } from './components/NotificationBell';
import { AssignedIpressStockModule } from './components/AssignedIpressStockModule';
import { AnalysisExclusionsModule } from './components/AnalysisExclusionsModule';
import { ModuleHeaderProvider, type ModuleHeaderOverride } from './contexts/ModuleHeaderContext';
import { APP_BASE, moduleForPath, pathForModule, pathForView, viewForLocation } from './services/appRoutes';

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
/**
 * Marca de que ya se felicitó por este análisis.
 *
 * Tiene que sobrevivir a salir y volver a entrar al módulo: al volver, el análisis se
 * recupera de `localStorage` y la revisión aparece completa desde el primer render, así
 * que sin esta marca el modal de «¡Auditoría Completada!» salía cada vez.
 */
const SUCCESS_SHOWN_KEY = 'aura_success_shown_v1';
const WELCOME_KEY = 'aura_welcome_shown_session'; // Clave de sesión

// --- MAIN APP COMPONENT WRAPPED IN AUTH CONTEXT ---
const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <Toaster position="top-center" closeButton theme="light" style={{ zIndex: 2147483647 }} toastOptions={{ style: { zIndex: 2147483647, color: '#1e293b' }, className: 'text-slate-800' }} />
                <BackupManagerProvider>
                    <NotificationsProvider>
                        <AuthenticatedApp />
                    </NotificationsProvider>
                </BackupManagerProvider>
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
    //
    // `section` es la pantalla de una sección del teléfono (Inicio con `?seccion=stock`).
    // Solo cuenta en Inicio: abrir cualquier módulo la cierra.
    const [nav, setNav] = useState<{ module: AppModule; section: string | null }>(
        () => viewForLocation(window.location.pathname, window.location.search)
    );
    const currentView = nav.module;
    const openSectionId = nav.module === 'HOME' ? nav.section : null;
    const setCurrentView = useCallback((module: AppModule) => setNav({ module, section: null }), []);
    const openSectionScreen = useCallback((section: string) => setNav({ module: 'HOME', section }), []);

    // La direccion del navegador sigue a la vista, sin agregar una entrada por render.
    // Solo con sesion iniciada: sin ella la direccion debe ser la raiz.
    useEffect(() => {
        if (!isAuthenticated) return;
        const destino = pathForView(currentView, openSectionId);
        // Se compara con la consulta incluida: la pantalla de una sección comparte ruta con Inicio.
        const actual = window.location.pathname + (currentView === 'HOME' ? window.location.search : '');
        if (actual === destino) return;
        // `paso` cuenta las pantallas recorridas dentro de la aplicación: con él la flecha
        // «volver» sabe si hay a dónde regresar sin salirse de la app.
        const paso = typeof window.history.state?.paso === 'number' ? window.history.state.paso + 1 : 1;
        window.history.pushState({ view: currentView, paso }, '', destino);
    }, [currentView, openSectionId, isAuthenticated]);

    // Al cerrar sesion, la direccion vuelve a la raiz y la vista al inicio.
    //
    // Este componente no se desmonta al salir: solo cambia lo que muestra. Sin esto la
    // ruta del ultimo modulo quedaba en la barra del navegador, y el siguiente usuario
    // entraba directo a la pantalla del anterior.
    useEffect(() => {
        if (isAuthenticated || isLoading) return;
        setCurrentView('HOME');
        if (window.location.pathname !== APP_BASE) {
            window.history.replaceState({}, '', APP_BASE);
        }
    }, [isAuthenticated, isLoading]);

    // Botones de atras y adelante del navegador.
    useEffect(() => {
        const alNavegar = () => setNav(viewForLocation(window.location.pathname, window.location.search));
        window.addEventListener('popstate', alNavegar);
        return () => window.removeEventListener('popstate', alNavegar);
    }, []);

    // Flecha «volver» de la cabecera: regresa a la pantalla anterior de la app. Si se
    // entró directo a un módulo (enlace o recarga), no hay pantalla anterior propia y
    // volver al navegador sacaría al usuario de la app: entonces va al Inicio.
    // Título del nivel en que está el módulo (ver contexts/ModuleHeaderContext.tsx).
    const [moduleHeader, setModuleHeader] = useState<ModuleHeaderOverride | null>(null);

    const volver = useCallback(() => {
        // Dentro de un nivel del módulo (UNGET u hoja de Consulta Stock), la flecha de la
        // cabecera sube un nivel; el módulo ya no tiene flecha propia.
        if (moduleHeader?.onBack) {
            moduleHeader.onBack();
            return;
        }
        if (typeof window.history.state?.paso === 'number' && window.history.state.paso > 0) window.history.back();
        else setCurrentView('HOME');
    }, [setCurrentView, moduleHeader]);

    // Buscador de herramientas: campo de la cabecera, lupa en el teléfono y Ctrl+K.
    const [buscadorAbierto, setBuscadorAbierto] = useState(false);
    const abrirBuscador = useCallback(() => {
        if (isAuthenticated) setBuscadorAbierto(true);
    }, [isAuthenticated]);
    useToolSearchShortcut(abrirBuscador);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    
    const wasSidebarCollapsedRef = React.useRef(false);

    // Welcome Modal State

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

    // El saludo de bienvenida, una vez por sesión. Es un aviso que se va solo, no un modal
    // que haya que cerrar para empezar a trabajar.
    useEffect(() => {
        if (isAuthenticated && user && !isLoading) {
            const hasShown = sessionStorage.getItem(WELCOME_KEY);
            if (!hasShown) {
                showWelcomeToast(user);
                sessionStorage.setItem(WELCOME_KEY, 'true');
            }
        }
    }, [isAuthenticated, isLoading, user]);

    // Si la vista no está permitida (un enlace viejo, un rol que cambió), se vuelve a
    // Inicio, que todo usuario con sesión puede ver.
    useEffect(() => {
        if (isAuthenticated && !isLoading && user && !hasPermission(currentView)) {
            setCurrentView('HOME');
        }
    }, [currentView, isAuthenticated, isLoading, user, hasPermission, setCurrentView]);

    // Teléfono: secciones de la barra inferior y la que está abierta, si el usuario la ve.
    const mobileSections = visibleNavSections(hasPermission);
    const openSection = findVisibleNavSection(openSectionId, hasPermission);

    // Cabecera: «Sección › Herramienta», o solo el título en Inicio y Perfil.
    const headerSection = findNavSection(currentView);
    const headerTitle = currentView === 'PROFILE'
        ? 'Perfil de Usuario'
        : findNavItem(currentView)?.label || 'Toolkit SISMED';
    const HeaderIcon = currentView === 'PROFILE' ? UserCircle2 : findNavItem(currentView)?.icon || Home;
    const headerTint = NAV_TINT_CLASSES[headerSection?.tint || 'teal'];

    // If loading, show spinner
    if (isLoading) {
        return <BrandBootScreen />;
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
            <Suspense fallback={<BrandBootScreen />}>
                <LoginScreen />
            </Suspense>
        );
    }

    // --- RENDER MAIN LAYOUT ---
    return (
        <ModuleHeaderProvider value={setModuleHeader}>
        <div className="flex h-[100dvh] bg-gray-50/50 overflow-hidden">
            <div className="hidden md:flex">
                <Sidebar 
                    currentView={currentView}
                    setCurrentView={setCurrentView}
                    isCollapsed={isSidebarCollapsed}
                    setIsCollapsed={setIsSidebarCollapsed}
                    hasPermission={hasPermission}
                />
            </div>

            <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden relative">
                {/* Cabecera: miga de pan, acciones del módulo y el usuario */}
                <header className="sticky top-0 z-[1000] flex h-14 shrink-0 items-center gap-x-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-sm sm:px-6 md:h-16 lg:px-8">
                    {/* Teléfono, en Inicio: la marca; con una sección abierta, su nombre y la flecha. */}
                    {currentView === 'HOME' && (
                        <div className="flex min-w-0 items-center gap-2 md:hidden">
                            {openSection ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={volver}
                                        aria-label="Volver"
                                        title="Volver"
                                        className="-ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                                    >
                                        <ArrowLeft className="h-5 w-5" />
                                    </button>
                                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${NAV_TINT_CLASSES[openSection.tint].chip}`}>
                                        <openSection.icon aria-hidden="true" className="h-[18px] w-[18px]" />
                                    </span>
                                    <h2 className="truncate text-base font-black text-slate-900">{openSection.label}</h2>
                                </>
                            ) : (
                                <h2 className="flex items-center">
                                    <BrandLogo size={16} tone="light" />
                                </h2>
                            )}
                        </div>
                    )}
                    <div className={`min-w-0 items-center gap-2 ${currentView === 'HOME' ? 'hidden md:flex' : 'flex'}`}>
                        {currentView !== 'HOME' && (
                            <button
                                type="button"
                                onClick={volver}
                                aria-label="Volver"
                                title="Volver"
                                className="-ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>
                        )}
                        <span className={`${moduleHeader ? 'hidden sm:grid' : 'grid'} h-8 w-8 shrink-0 place-items-center rounded-xl md:h-9 md:w-9 ${headerTint.chip}`}>
                            <HeaderIcon aria-hidden="true" className="h-[18px] w-[18px]" />
                        </span>
                        {moduleHeader ? (
                            <>
                                <div className="min-w-0 leading-tight sm:hidden">
                                    {moduleHeader.subtitle && <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">{moduleHeader.subtitle}</p>}
                                    <h2 className="truncate text-[15px] font-black text-slate-900">{moduleHeader.title}</h2>
                                </div>
                                <h2 className="hidden truncate text-base font-black text-slate-900 sm:block sm:text-[18px]">{headerTitle}</h2>
                            </>
                        ) : (
                            <h2 className="truncate text-base font-black text-slate-900 sm:text-[18px]">{headerTitle}</h2>
                        )}
                    </div>
                    <div className="mx-4 hidden min-w-0 flex-1 justify-center md:flex">
                        <ToolSearchTrigger onOpen={abrirBuscador} className="w-full max-w-[420px]" />
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0 md:gap-3">
                        <div id={MODULE_HEADER_SLOT_ID} className="flex shrink-0 items-center gap-2 empty:hidden" />
                        <button
                                type="button"
                                onClick={abrirBuscador}
                                aria-label="Buscar herramienta"
                                title="Buscar herramienta"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 md:hidden"
                            >
                                <Search className="h-5 w-5" />
                            </button>
                        {user && <NotificationBell onNavigate={setCurrentView} />}
                        {user && (
                            <UserMenu user={user} onOpenProfile={() => setCurrentView('PROFILE')} onLogout={logout} />
                        )}
                    </div>
                </header>
                <ToolSearchDialog
                    open={buscadorAbierto}
                    onClose={() => setBuscadorAbierto(false)}
                    onNavigate={setCurrentView}
                    hasPermission={hasPermission}
                />

                {/* CONTENT AREA SWITCHER */}
                <main className="flex-1 overflow-y-auto w-full px-3 sm:px-5 2xl:px-6 pt-2.5 sm:pt-3 pb-6">
                    <div className="mx-auto max-w-[1600px] h-full">
                        <ErrorBoundary>
                            <Suspense fallback={<SuspenseFallback />}>
                                {currentView === 'HOME' && openSection && (
                                    <div className="md:hidden">
                                        <MobileSectionScreen section={openSection} onNavigate={setCurrentView} />
                                    </div>
                                )}
                                {currentView === 'HOME' && (
                                    <div className={openSection ? 'hidden md:block' : undefined}>
                                        <HomeModule onNavigate={setCurrentView} />
                                    </div>
                                )}
                                {currentView === 'DASHBOARD' && <AnalysisModule />}
                                {currentView === 'ANALYSIS_EXCLUSIONS' && <AnalysisExclusionsModule />}
                                {currentView === 'REDISTRIBUTION' && <RedistributionModule />}
                                {currentView === 'SIG_SEARCH' && <SheetSearchModule />}
                                {currentView === 'IPRESS_STOCK' && <AssignedIpressStockModule />}
                                {currentView === 'ADMIN_STOCK_ASSIGN' && <AdminStockAssignmentModule />}
                                {currentView === 'ADMIN_SEND_KEYS' && <AdminSendKeysModule />}
                                {currentView === 'ADMIN_BACKUPS' && <BackupsSismedModule />}
                                {currentView.startsWith('ADMIN') && !['ADMIN_STOCK_ASSIGN', 'ADMIN_SEND_KEYS', 'ADMIN_BACKUPS'].includes(currentView) && <AdminPanel currentView={currentView} />}
                                {currentView === 'PROFILE' && <UserProfile />}
                            </Suspense>
                        </ErrorBoundary>
                    </div>
                </main>

                {/* Teléfono: barra inferior de pestañas (Inicio y una por sección). */}
                <MobileTabBar
                    sections={mobileSections}
                    activeTab={activeMobileTab(currentView, openSection?.id || null)}
                    onHome={() => setCurrentView('HOME')}
                    onSection={openSectionScreen}
                />

            </div>
        </div>
        </ModuleHeaderProvider>
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

  const currentSuccessKey = useMemo(() => {
    return userFacilityCode ? `${SUCCESS_SHOWN_KEY}_${userFacilityCode}` : SUCCESS_SHOWN_KEY;
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
      // Análisis nuevo: vuelve a haber una felicitación pendiente.
      try {
        localStorage.removeItem(currentSuccessKey);
      } catch {}
    } catch (err: any) {
      console.error(err);
      setError("Error al procesar los datos matemáticos. Verifique que su archivo no esté corrupto.");
    } finally {
      setLoading(false);
    }
    // `currentSuccessKey` va en las dependencias: cambia con el establecimiento activo, y
    // sin él este callback borraría la marca del establecimiento anterior.
  }, [currentSuccessKey]);

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
    try {
      localStorage.removeItem(currentSuccessKey);
    } catch {}
    setInputData([]); // Clear input data on reset
  }, [handleToggleFullScreen, currentSuccessKey]);

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

  // Todos los ítems con el estado, los meses y el CPA del modo elegido (Stock inicial o
  // Proyectado). La tabla los muestra así, y los filtros por columna sacan de aquí sus
  // opciones y conteos: antes los sacaban del estado original y no cuadraban con la tabla.
  const horizonMedications = useMemo(() => {
    if (!result) return [];
    return result.medications.map(m => {
        const { activeCpm, months, status } = calculateHorizonMetrics(m, dashboardViewMode);
        return {
            ...m,
            displayCpm: activeCpm,
            status,
            monthsOfProvision: months
        };
    });
  }, [result, dashboardViewMode, calculateHorizonMetrics]);

  const filteredMedications = useMemo(() => {
    if (!result) return [];

    let items = horizonMedications;

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
  }, [result, horizonMedications, searchTerm, activeFilters, quickFilter, reviewedIds, dashboardScopeFilter]);

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

  /**
   * La felicitación se da **una vez por análisis**, al terminar de validarlo.
   *
   * Antes la marca vivía en un `useRef` que se reiniciaba cada vez que cambiaba `result`.
   * Eso incluye volver a entrar al módulo: el análisis se recupera de `localStorage`, la
   * revisión ya está completa desde el primer render y el modal salía otra vez. Ahora la
   * marca se guarda con el análisis y solo se borra donde de verdad empieza uno nuevo
   * —`handleAnalyze` y `handleReset`—, que es lo que el usuario entiende por «terminar el
   * análisis».
   */
  useEffect(() => {
    if (!isReviewComplete || totalToReview === 0) return;
    try {
      if (localStorage.getItem(currentSuccessKey)) return;
      localStorage.setItem(currentSuccessKey, '1');
    } catch {
      // Sin `localStorage` se felicita igualmente: molesta menos que no avisar nunca.
    }
    setShowSuccessModal(true);
  }, [isReviewComplete, totalToReview, currentSuccessKey]);

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

             {!isFullScreen && (() => {
                // Cabecera de resultados (pautas de NN/g, Carbon, Material y WCAG):
                // - los datos del establecimiento en una línea de texto, no en pastillas de
                //   colores (las pastillas parecen botones y los colores no significaban nada);
                // - la validación y la descarga juntas, porque el informe depende de terminar;
                // - el avance contado en ítems, y el porqué de que «Descargar» esté bloqueado.
                const pendientes = Math.max(0, totalToReview - reviewedCount);
                const corte = result.referenceDate ? formatCorteDate(result.referenceDate) : '';
                const corteBonito = corte ? corte.charAt(0) + corte.slice(1).toLowerCase() : '';
                return (
                <div className="flex flex-col gap-5 border-b border-gray-200 pb-5 lg:flex-row lg:items-stretch lg:justify-between 2xl:pb-6">
                    <div className="min-w-0 self-center">
                        <h2 className="text-2xl 2xl:text-3xl font-bold text-gray-900 tracking-tight">Resultados del Análisis</h2>
                        {activeEstName && (
                            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[15px] font-bold text-slate-800">
                                <Building2 className="h-4 w-4 text-teal-600" />
                                {activeEstName.toUpperCase()}
                                {activeCodEess && <span className="font-mono text-xs font-bold text-slate-400">{activeCodEess}</span>}
                            </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
                            {result.category && (
                                <>
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Tag className="h-3.5 w-3.5 text-slate-400" />Categoría <b className="text-slate-800">{result.category}</b></span>
                                </>
                            )}
                            {activeMicrored && (
                                <>
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Network className="h-3.5 w-3.5 text-slate-400" />Microred <b className="text-slate-800">{activeMicrored}</b></span>
                                </>
                            )}
                            {corteBonito && (
                                <>
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Calendar className="h-3.5 w-3.5 text-slate-400" />Corte <b className="text-slate-800">{corteBonito}</b></span>
                                </>
                            )}
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Clock className="h-3.5 w-3.5 text-slate-400" />Generado {new Date(result.timestamp).toLocaleString('es-PE', { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                    </div>

                    <div className={`w-full rounded-2xl border bg-white p-4 shadow-sm transition-colors duration-300 lg:w-[460px] ${isReviewComplete ? 'border-teal-200' : 'border-amber-200'}`}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className={`rounded-lg p-2 ${isReviewComplete ? 'bg-teal-100 text-teal-600' : 'bg-amber-100 text-amber-600'}`}>
                                    {isReviewComplete ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                                </span>
                                <div>
                                    <h4 className={`text-xs font-black uppercase tracking-wider ${isReviewComplete ? 'text-teal-700' : 'text-amber-700'}`}>
                                        {isReviewComplete ? 'Validación completa' : 'Validación en curso'}
                                    </h4>
                                    <p className="mt-0.5 text-[13px] text-slate-600">
                                        <b className="text-slate-900">{reviewedCount}</b> de {totalToReview} ítems validados
                                    </p>
                                </div>
                            </div>
                            <span className={`text-2xl font-black ${isReviewComplete ? 'text-teal-600' : 'text-amber-500'}`}>{reviewProgress}%</span>
                        </div>
                        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
                            <div className={`h-full rounded-full transition-all duration-500 ${isReviewComplete ? 'bg-teal-500' : 'bg-amber-500'}`} style={{ width: `${reviewProgress}%` }} />
                        </div>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            {!isReviewComplete && (
                                <button
                                    onClick={() => setQuickFilter(quickFilter === 'PENDING' ? 'ALL' : 'PENDING')}
                                    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${quickFilter === 'PENDING' ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                                >
                                    <ListFilter className="h-4 w-4" />
                                    {quickFilter === 'PENDING' ? 'Mostrando pendientes · Ver todos' : `Ver pendientes (${pendientes})`}
                                </button>
                            )}
                            <button
                                onClick={handleDownloadClick}
                                className={`inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-bold transition-colors ${isReviewComplete ? 'bg-teal-600 text-white shadow-sm hover:bg-teal-700' : 'border border-gray-200 bg-gray-50 text-gray-400'}`}
                            >
                                {isReviewComplete ? <FileText className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                                Descargar informe PDF
                            </button>
                        </div>
                        {!isReviewComplete && (
                            <p className="mt-2 text-[11px] text-slate-500">
                                El informe se habilita al validar {pendientes === 1 ? 'el ítem que falta' : `los ${pendientes} ítems que faltan`}.
                            </p>
                        )}
                    </div>
                </div>
                );
             })()}
            
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
                allMedications={horizonMedications}
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
