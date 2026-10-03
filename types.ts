
export type DashboardViewMode = 'INITIAL' | 'PROJECTED_SIMPLE' | 'PROJECTED_ADJUSTED';

export enum StockStatus {
  DESABASTECIDO = "DESABASTECIDO", // Stock = 0
  SUBSTOCK = "SUBSTOCK", // MED > 0 y < 2 (Alerta de Pedido)
  NORMOSTOCK = "NORMOSTOCK", // MED >= 2 y <= 6
  SOBRESTOCK = "SOBRESTOCK", // MED > 6
  SIN_ROTACION = "SIN ROTACIÓN" // Stock > 0 y CPM = 0
}

export interface MedicationInput {
  id: string;
  code?: string;
  name: string;
  currentStock: number;
  monthlyConsumption: number[]; // Array of last 12 meses
  unitPrice: number;
  medtip?: string;
  medpet?: string;
  medest?: string;
  ff?: string;
}

export interface AnalyzedMedication {
  id: string; 
  code?: string;
  name: string;
  currentStock: number; 
  unitPrice: number;
  
  // Details
  medtip?: string;
  medpet?: string;
  medest?: string;
  ff?: string;

  // Analysis results (SISMED 2026 IPRESS)
  cpm: number; // Consumo Promedio AJUSTADO (Sin picos)
  cpmExcludingLows?: number; // Consumo Promedio AJUSTADO (Sin picos Y sin bajos)
  rawCpm: number; // Consumo Promedio SIMPLE (Con picos, para referencia)
  monthsOfProvision: number; // MED (Meses de Existencia Disponible)
  displayCpm?: number; // Active CPA for current horizon mode
  status: StockStatus; 
  expirationRisk: string; 
  quantityToOrder: number; 
  estimatedInvestment: number; 
  
  // Anomaly Audit
  anomalyDetails: string; 
  hasSpikes: boolean; // Flag para UI
  spikesCount: number; // Cuántos meses se eliminaron
  spikeThreshold: number; // El valor máximo permitido (Valores mayores a este se pintan de amarillo)
  
  // Low Consumption Audit
  hasLows?: boolean; // Flag para UI (Consumos muy bajos)
  lowThreshold?: number; // El valor mínimo (Valores menores a este se pintan de otro color)

  // Low Rotation Flag
  isSporadic: boolean; // NEW: Indica si es de baja rotación para mostrar etiqueta visual

  // User Selection Memory
  selectedCpaMode?: 'ADJUSTED' | 'SIMPLE'; // Persist user choice
  excludedIndices?: number[]; // Persist manually excluded months

  // Historical context for export
  originalHistory: number[];
}

export interface AdditionalItem {
  id: string;
  name: string;
  quantity: number;
  observation?: string;
  sismedCode?: string; // Optional SISMED Code
  ff?: string; // Optional Pharmaceutical Form
}

export interface AuraAnalysisResult {
  medications: AnalyzedMedication[];
  indicators: {
    dmeScore: number; // % Disponibilidad Medicamentos Esenciales
    status: 'OPTIMO' | 'ALTO' | 'REGULAR' | 'BAJO'; 
    totalItems: number;
    availableItems: number; // Numerador
  };
  executiveSummary: string;
  timestamp: string;
  referenceDate?: string; // Fecha de Corte (YYYY-MM)
  analysisConfig?: {
    vaccinesExcluded: boolean; // Tracks if vaccines were filtered at input
    customExclusionsExcluded?: boolean; // Tracks if custom facility exclusions were filtered
    customExclusionsCount?: number;
  };
  microred?: string;
  codEess?: string;
  establishmentName?: string;
  category?: string;
}

export interface RequirementExclusionItem {
  id?: string;
  establishmentCode: string;
  sismedCode: string;
  description: string;
  presentation?: string;
  reason?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChartDataPoint {
  name: string;
  value: number;
}

// --- NEW AUTHENTICATION & ADMIN TYPES ---

export type UserRole = string;

export type AppModule =
  | 'HOME'
  | 'DASHBOARD'
  | 'ANALYSIS'
  | 'ANALYSIS_EXCLUSIONS'
  | 'ADMIN_USERS'
  | 'ADMIN_ROLES'
  | 'ADMIN_FACILITIES'
  | 'ADMIN_PARAMS'
  | 'PROFILE'
  | 'REDISTRIBUTION'
  | 'SIG_SEARCH'
  | 'ADMIN_CATALOGS'
  | 'ADMIN_STOCK_ASSIGN'
  | 'IPRESS_STOCK'
  | 'ADMIN_SEND_KEYS'
  | 'ADMIN_BACKUPS';

export const AVAILABLE_MODULES: { id: AppModule; label: string; description: string }[] = [
  { id: 'HOME', label: 'Inicio', description: 'Pantalla de inicio con acceso a todas las herramientas' },
  { id: 'DASHBOARD', label: 'Análisis de Requerimiento', description: 'Vista principal y resumen de indicadores' },
  { id: 'ANALYSIS_EXCLUSIONS', label: 'Lista de Exclusiones', description: 'Medicamentos excluidos del análisis por establecimiento' },
  { id: 'ANALYSIS', label: 'Análisis Inteligente', description: 'Módulo de análisis de requerimientos' },
  { id: 'SIG_SEARCH', label: 'Consulta Stock', description: 'Buscador de stock SIG' },
  { id: 'REDISTRIBUTION', label: 'Redistribución', description: 'Módulo de redistribución de medicamentos' },
  { id: 'IPRESS_STOCK', label: 'Stock SISMED', description: 'Stock propio de la IPRESS, leído de la hoja de Google Sheets asignada (solo lectura)' },
  { id: 'ADMIN_USERS', label: 'Gestión de Usuarios', description: 'Administración de cuentas de usuario' },
  { id: 'ADMIN_ROLES', label: 'Configuración de Roles', description: 'Gestión de roles y permisos' },
  { id: 'ADMIN_FACILITIES', label: 'Establecimientos', description: 'Gestión de la organización y establecimientos' },
  { id: 'ADMIN_CATALOGS', label: 'Regímenes y Profesiones', description: 'Gestión de regímenes laborales y profesiones' },
  { id: 'ADMIN_PARAMS', label: 'Parámetros del Sistema', description: 'Configuraciones generales del sistema' },
  { id: 'ADMIN_STOCK_ASSIGN', label: 'Columnas de Stock', description: 'Columnas visibles del stock de cada establecimiento' },
  { id: 'ADMIN_SEND_KEYS', label: 'Claves de envío', description: 'Solo la PC vinculada puede enviar el stock de su establecimiento a Google Sheets' },
  { id: 'ADMIN_BACKUPS', label: 'Backups SISMED', description: 'Descargar con un clic el backup del SISMED de los establecimientos de su jurisdicción' },
  { id: 'PROFILE', label: 'Perfil de Usuario', description: 'Configuración del perfil personal' }
];

export interface StockAssignment {
  id?: string;
  adminUsername: string;
  facilityCode: string;
  sheetName: string;
  sheetUrl: string;
  // La asignación pertenece a la UNGET: su URL puede cambiar sin romperla.
  ungetId?: string;
  visibleColumns: string[];
  createdAt?: string;
}

export interface Diresa {
  id: string;
  name: string;
  ruc?: string;
  department?: string;
  province?: string;
  district?: string;
  legalAddress?: string;
  website?: string;
  socialMedia?: string;
  phone?: string;
  email?: string;
}

export interface Ogess {
  id: string;
  name: string;
  diresaId: string;
  code?: string;
  ruc?: string;
  department?: string;
  province?: string;
  district?: string;
  legalAddress?: string;
  website?: string;
  socialMedia?: string;
  phone?: string;
  email?: string;
}

export interface Unget {
  id: string;
  name: string;
  ogessId?: string;
  diresaId?: string;
  region?: string;
  legalAddress?: string;
  website?: string;
  socialMedia?: string;
  phone?: string;
  email?: string;
  department?: string;
  province?: string;
  district?: string;
}

export interface Microred {
  id: string;
  name: string;
  ungetId: string;
  location?: string;
  legalAddress?: string;
  website?: string;
  socialMedia?: string;
  phone?: string;
  email?: string;
}

export interface HealthFacility {
  code: string; // Codigo IPRESS
  name: string;
  type?: string; 
  category: string;
  microredId?: string;
  ungetId?: string; // Link to Unget
  ogessId?: string;
  diresaId?: string;
  legalAddress?: string;
  website?: string;
  socialMedia?: string;
  phone?: string;
  email?: string;
  department?: string;
  province?: string;
  district?: string;
}

export interface LaborRegime {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface Profession {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface Personnel {
  id: string; // Internal ID
  firstName: string;
  lastName: string;
  dni: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  laborRegime?: string; // Régimen Laboral (Legacy or name)
  laborRegimeId?: string; // Dynamic relation
  professionId?: string; // Dynamic relation
  laborRegimeData?: LaborRegime;
  professionData?: Profession;
  facilityCode?: string; // Optional if assigned higher up
  microredId?: string;
  ungetId?: string;
  ogessId?: string;
  diresaId?: string;
}

export interface User {
  username: string;
  role: UserRole;
  personnelId: string;
  isActive: boolean;
  personnelData?: Personnel; // Hydrated data
  facilityData?: HealthFacility; // Hydrated data
  permissions: AppModule[]; // Computed from Role
  maxUrlsAllowed?: number;
  jurisdictionLevel?: 'GLOBAL' | 'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS';
}

export interface SystemConfig {
  verificationDelaySeconds: number; // Tiempo de espera para el botón de validar
  // Modo mantenimiento: cierra la aplicación salvo para administradores y autorizados.
  maintenanceMode?: boolean;
  maintenanceAllowedUsers?: string; // Usuarios de prueba, separados por comas o líneas
  maintenanceMessage?: string;
  apiUrl?: string; // NUEVO: URL dinámica del backend
  warehouseCode?: string; // NUEVO: Código del Almacén General
  warehouseName?: string; // NUEVO: Nombre del Almacén General
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  systemConfig: SystemConfig; // Configuración global disponible en el contexto
}

export interface RoleConfig {
  role: UserRole;
  oldRole?: UserRole; // Internal use to know if role was renamed
  label: string;
  allowedModules: AppModule[];
  maxUrlsAllowed?: number;
  jurisdictionLevel?: 'GLOBAL' | 'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS' | '';
}

// --- FILTER TYPES ---
export type QuickFilterOption = 'ALL' | 'PENDING' | 'REQ_POSITIVE' | 'REQ_ZERO';

// --- REDISTRIBUTION MODULE TYPES ---

export interface AvailabilityRecord {
  ue: string;
  red: string;
  microred: string;
  codEess: string;
  establishmentName: string;
  category: string;
  medCode: string;
  medName: string;
  ff: string;
  price: number;
  type: string;
  pet: string; // Petitorio?
  est: string; // Estrategico?
  stock: number;
  cpa: number;
  monthsProvision: number;
  status: string; // Situacion (NormoStock, etc.)
  expiryDate?: string; // Fecha mas prox vencimiento
  consumptionSum?: number; // Suma de consumos
  consumptionMonths?: number; // Meses con consumo
  monthlyConsumption?: number[]; // Array of 12 months consumption
}

export interface RedistributionItem {
  codEess: string;
  establishmentName: string;
  stock: number;
  cpa: number;
  monthsProvision: number;
  status: string;
  // Redistribution fields
  transferQty: number; // Cantidad a transferir (negativo = sale, positivo = entra)
  receivedQty: number; // Cantidad recibida (redundante con transferQty pero útil para UI explicita)
  need?: number; // Necesidad calculada
  consumptionSum?: number;
  consumptionMonths?: number;
  monthlyConsumption?: number[];
  isConsolidated?: boolean;
  simulationQty?: number; // Cantidad simulada (positivo o negativo)
  simulationInput?: string; // Input raw para manejar estados intermedios (ej: "-")
  isWarehouse?: boolean;
  microred?: string;
  cpaMode?: 'ADJUSTED' | 'SIMPLE';
}

export interface UngetConfig {
  url: string;
  name: string;
  id?: string;
  ungetId?: string;
  username?: string;
  /**
   * ID del libro de Google Sheets de la UNGET. Permite leer las pestañas directamente,
   * sin pasar por Apps Script. Requiere la hoja compartida como lector con el enlace.
   */
  spreadsheetId?: string;
}

export interface SheetSource {
  id: string;
  name: string;
  urlIndex: number;
  lastUpdate?: string;
  lastUpdateTime?: number;
  equipmentDate?: string;
  equipmentDateTime?: number;
  /** Nombre real de la pestaña en Google Sheets; no usar el nombre visual para consultar GAS. */
  sheetName?: string;
  /** Cantidad de filas reportada por getMetadata; permite mostrar el conteo sin descargar el stock. */
  rowCount?: number;
  /** ALMCOD de la cabecera, informado por getMetadata: permite mostrar el código sin descargar el stock. */
  almcod?: string;
  /** Código estable de IPRESS usado como llave preferente del historial en Supabase. */
  facilityCode?: string;
  /** ID del libro de Google Sheets (lo informa getMetadata); permite leer la pestaña directamente. */
  spreadsheetId?: string;
}

export interface SIGData {
  ALMCOD?: string;
  DESC_ALM?: string;
  ID_Producto?: string;
  CODIGO_SIG?: string;
  Nombre?: string;
  Lote?: string;
  Fec_Vencim?: string;
  Reg_Sanitario?: string;
  TIPSUM?: string;
  DESC_TIPSUM?: string;
  FFINAN?: string;
  DESC_FFINAN?: string;
  Saldo?: string;
  Precio_Det?: string;
  Precio_Cab?: string;
  ULTIMA_ACTUALIZACION?: string;
  Ultima_Actualizacion?: string;
  FECHA_DEL_EQUIPO?: string;
  sourceId?: string;
  [key: string]: any;
}
