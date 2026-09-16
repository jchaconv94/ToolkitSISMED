
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
  | 'DASHBOARD'
  | 'ANALYSIS'
  | 'ANALYSIS_EXCLUSIONS'
  | 'ADMIN_USERS'
  | 'ADMIN_ROLES'
  | 'ADMIN_FACILITIES'
  | 'ADMIN_PARAMS'
  | 'ADMIN_MIGRATION'
  | 'PROFILE'
  | 'REDISTRIBUTION'
  | 'SIG_SEARCH'
  | 'ADMIN_CATALOGS'
  | 'ADMIN_STOCK_ASSIGN'
  | 'IPRESS_STOCK'
  | 'STOCK_MONITORING'
  | 'ADMIN_SYNC_DEVICES'
  | 'IMMUNIZATION_CATALOG'
  | 'IMMUNIZATION_INITIAL_INVENTORY'
  | 'IMMUNIZATION_STOCK'
  | 'IMMUNIZATION_STOCK_QUERY'
  | 'IMMUNIZATION_INCOMES'
  | 'IMMUNIZATION_INCOME_ORIGINS'
  | 'IMMUNIZATION_DISTRIBUTIONS'
  | 'IMMUNIZATION_CONSUMPTION'
  | 'IMMUNIZATION_RETURNS'
  | 'IMMUNIZATION_ADJUSTMENTS'
  | 'IMMUNIZATION_CLOSURES'
  | 'IMMUNIZATION_REPORTS'
  | 'IMMUNIZATION_CONFIG';

export const AVAILABLE_MODULES: { id: AppModule; label: string; description: string }[] = [
  { id: 'DASHBOARD', label: 'Análisis de Requerimiento', description: 'Vista principal y resumen de indicadores' },
  { id: 'ANALYSIS_EXCLUSIONS', label: 'Lista de Exclusiones', description: 'Medicamentos excluidos del análisis por establecimiento' },
  { id: 'ANALYSIS', label: 'Análisis Inteligente', description: 'Módulo de análisis de requerimientos' },
  { id: 'SIG_SEARCH', label: 'Consulta Stock', description: 'Buscador de stock SIG' },
  { id: 'REDISTRIBUTION', label: 'Redistribución', description: 'Módulo de redistribución de medicamentos' },
  { id: 'IPRESS_STOCK', label: 'Stock SISMED', description: 'Stock propio de la IPRESS, sincronizado o asignado por hoja (solo lectura)' },
  { id: 'STOCK_MONITORING', label: 'Monitoreo de Stock', description: 'Directorio territorial del stock sincronizado de los establecimientos' },
  { id: 'ADMIN_USERS', label: 'Gestión de Usuarios', description: 'Administración de cuentas de usuario' },
  { id: 'ADMIN_ROLES', label: 'Configuración de Roles', description: 'Gestión de roles y permisos' },
  { id: 'ADMIN_FACILITIES', label: 'Establecimientos', description: 'Gestión de la organización y establecimientos' },
  { id: 'ADMIN_CATALOGS', label: 'Regímenes y Profesiones', description: 'Gestión de regímenes laborales y profesiones' },
  { id: 'ADMIN_PARAMS', label: 'Parámetros del Sistema', description: 'Configuraciones generales del sistema' },
  { id: 'ADMIN_MIGRATION', label: 'Migración (Supabase)', description: 'Herramientas de migración de datos' },
  { id: 'ADMIN_STOCK_ASSIGN', label: 'Asignar Stock', description: 'Asignación de vistas de stock a usuarios IPRESS' },
  { id: 'ADMIN_SYNC_DEVICES', label: 'Dispositivos Sync', description: 'Gestión de dispositivos autorizados de Sync SISMED 2.0' },
  { id: 'PROFILE', label: 'Perfil de Usuario', description: 'Configuración del perfil personal' }
  ,{ id: 'IMMUNIZATION_CATALOG', label: 'Catálogo Biológico', description: 'Catálogo maestro de vacunas, jeringas y diluyentes' },
  { id: 'IMMUNIZATION_INITIAL_INVENTORY', label: 'Inventario Inicial', description: 'Carga manual o Excel del inventario inicial por lote' },
  { id: 'IMMUNIZATION_STOCK', label: 'Stock Biológico', description: 'Stock de inmunizaciones agrupado por producto y detallado por lote' },
  { id: 'IMMUNIZATION_STOCK_QUERY', label: 'Consulta de Stock Biológico', description: 'Consulta territorial de solo lectura del stock de UNGET e IPRESS' },
  { id: 'IMMUNIZATION_INCOMES', label: 'Ingresos Regionales', description: 'Registro de ingresos nuevos de biológicos al almacén regional DIRESA' },
  { id: 'IMMUNIZATION_INCOME_ORIGINS', label: 'Orígenes de Ingreso', description: 'Catálogo administrable de orígenes para ingresos regionales' },
  { id: 'IMMUNIZATION_DISTRIBUTIONS', label: 'Distribuciones', description: 'Distribución jerárquica de biológicos DIRESA -> UNGET -> IPRESS' },
  { id: 'IMMUNIZATION_CONSUMPTION', label: 'Consumo IPRESS', description: 'Registro de consumos por comprobante con varios productos/lotes' },
  { id: 'IMMUNIZATION_RETURNS', label: 'Devoluciones y Bajas', description: 'Registro de bajas, devoluciones y transferencias IPRESS hacia UNGET' },
  { id: 'IMMUNIZATION_ADJUSTMENTS', label: 'Reajustes de Stock', description: 'Correcciones auditadas por conteo físico' },
  { id: 'IMMUNIZATION_CLOSURES', label: 'Cierre Mensual', description: 'Precierre IPRESS y cierre definitivo mensual por UNGET' },
  { id: 'IMMUNIZATION_REPORTS', label: 'Reportes Inmunizaciones', description: 'Reportes parciales y consolidados del movimiento biológico' },
  { id: 'IMMUNIZATION_CONFIG', label: 'Configuración Inmunizaciones', description: 'Configuraciones y catálogos auxiliares de inmunizaciones' },
];

export type ImmunizationProductType = string;

export interface ImmunizationProductTypeItem {
  id?: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}
export type ImmunizationOwnerType = 'DIRESA' | 'UNGET' | 'IPRESS';
export type ImmunizationInventoryStatus = 'DRAFT' | 'CLOSED';
export type ImmunizationInventorySourceType = 'MANUAL' | 'EXCEL' | 'MIXED' | 'INITIAL_PROVISION';
export type ImmunizationMonthlyClosureOwnerType = 'UNGET' | 'IPRESS';
export type ImmunizationMonthlyClosureStatus = 'PRE_CLOSED' | 'FINAL_CLOSED' | 'REOPENED';

export interface ImmunizationProduct {
  id?: string;
  codigoSismed: string;
  descripcion: string;
  tipoProducto: ImmunizationProductType;
  dosisUnidad: number;
  isActive: boolean;
  observacion?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationInitialInventory {
  id?: string;
  ownerType: ImmunizationOwnerType;
  ungetId?: string;
  facilityCode?: string;
  period: string;
  status: ImmunizationInventoryStatus;
  sourceType: ImmunizationInventorySourceType;
  isInitialProvision?: boolean;
  createdBy?: string;
  closedBy?: string;
  closedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationInitialInventoryItem {
  id?: string;
  inventoryId?: string;
  productId: string;
  codigoSismedSnapshot: string;
  excelDescriptionSnapshot?: string;
  lote: string;
  expirationDate: string;
  quantity: number;
  unitPrice: number;
  fundingSource: string;
  supplyType: string;
  observation?: string;
  product?: ImmunizationProduct;
}

export interface ImmunizationStockLayer {
  id: string;
  ownerType: ImmunizationOwnerType;
  regionalWarehouseId?: string;
  ungetId?: string;
  facilityCode?: string;
  productId: string;
  product?: ImmunizationProduct;
  lote: string;
  expirationDate: string;
  unitPrice: number;
  fundingSource: string;
  supplyType: string;
  sourceMovementId?: string;
  currentQuantity: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationStockMovement {
  id?: string;
  movementType: string;
  ownerType: ImmunizationOwnerType;
  regionalWarehouseId?: string;
  ungetId?: string;
  facilityCode?: string;
  productId: string;
  stockLayerId?: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  period: string;
  reason?: string;
  observation?: string;
  batchId?: string;
  consumedDoses?: number;
  dosesApplied?: number;
  dosesLost?: number;
  lossFactor?: number;
  createdBy?: string;
  createdAt?: string;
}

export interface ImmunizationConsumptionInput {
  stockLayerId: string;
  period: string;
  consumptionQuantity: number;
  dosesApplied: number;
  observation?: string;
}

export interface ImmunizationConsumptionItemInput {
  stockLayerId: string;
  consumptionQuantity: number;
  dosesApplied: number;
  observation?: string;
}

export interface ImmunizationConsumptionBatchInput {
  period: string;
  referenceDocument?: string;
  consumptionDate?: string;
  activityType?: string;
  observation?: string;
  items: ImmunizationConsumptionItemInput[];
}

export type ImmunizationIncomeSourceType = 'CENARES' | 'OGESS' | 'REGIONAL_WAREHOUSE' | 'UNGET_TRANSFER' | 'OTHER';
export type ImmunizationIncomeStatus = 'DRAFT' | 'APPLIED' | 'VOIDED';

export interface ImmunizationIncomeBatch {
  id?: string;
  ownerType: 'DIRESA' | 'UNGET';
  regionalWarehouseId?: string;
  ungetId?: string;
  period: string;
  sourceType: ImmunizationIncomeSourceType;
  sourceUngetId?: string;
  sourceName?: string;
  referenceDocument?: string;
  incomeDate?: string;
  status: ImmunizationIncomeStatus;
  observation?: string;
  createdBy?: string;
  appliedBy?: string;
  appliedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationIncomeOrigin {
  id?: string;
  name: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationIncomeItem {
  id?: string;
  incomeId?: string;
  productId: string;
  codigoSismedSnapshot: string;
  lote: string;
  expirationDate: string;
  quantity: number;
  unitPrice: number;
  fundingSource: string;
  supplyType: string;
  observation?: string;
  stockLayerId?: string;
  product?: ImmunizationProduct;
}

export type ImmunizationDistributionStatus = 'DRAFT' | 'SENT' | 'RECEIVED' | 'OBSERVED' | 'VOIDED';
export type ImmunizationDistributionCriterion = 'CONSUMPTION' | 'AVAILABILITY' | 'CAMPAIGN' | 'REGULAR' | 'OTHER';
export type ImmunizationDistributionFlow = 'DIRESA_UNGET' | 'UNGET_IPRESS';
export type ImmunizationReceptionReason =
  | 'FALTANTE_FISICO'
  | 'SOBRANTE_FISICO'
  | 'LOTE_NO_COINCIDE'
  | 'VENCIMIENTO_NO_COINCIDE'
  | 'PRODUCTO_DETERIORADO'
  | 'OTRO';

export interface ImmunizationReceptionItemInput {
  itemId: string;
  receivedQuantity: number;
}

export interface ImmunizationReceptionInput {
  reason?: ImmunizationReceptionReason;
  observation?: string;
  items: ImmunizationReceptionItemInput[];
}

export interface ImmunizationDistributionBatch {
  id?: string;
  flowType?: ImmunizationDistributionFlow;
  originOwnerType?: 'DIRESA' | 'UNGET';
  destinationOwnerType?: 'UNGET' | 'IPRESS';
  regionalWarehouseId?: string;
  originUngetId?: string;
  destinationUngetId?: string;
  ungetId: string;
  destinationFacilityCode: string;
  period: string;
  criterion: ImmunizationDistributionCriterion;
  status: ImmunizationDistributionStatus;
  isInitialProvision?: boolean;
  referenceDocument?: string;
  observation?: string;
  createdBy?: string;
  sentBy?: string;
  sentAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  receptionReason?: string;
  receptionObservation?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationDistributionItem {
  id?: string;
  distributionId?: string;
  productId: string;
  sourceStockLayerId: string;
  codigoSismedSnapshot: string;
  lote: string;
  expirationDate: string;
  quantity: number;
  unitPrice: number;
  fundingSource: string;
  supplyType: string;
  observation?: string;
  receivedQuantity?: number;
  destinationStockLayerId?: string;
  product?: ImmunizationProduct;
}

export type ImmunizationReturnType = 'DISPOSAL' | 'RETURN' | 'TRANSFER';
export type ImmunizationReturnStatus = 'SENT' | 'RECEIVED' | 'OBSERVED' | 'VOIDED';
export type ImmunizationReturnReason =
  | 'VENCIDO'
  | 'DETERIORADO'
  | 'RUPTURA'
  | 'CADENA_FRIO'
  | 'DEVOLUCION'
  | 'TRANSFERENCIA'
  | 'OTRO';

export interface ImmunizationReturnBatch {
  id?: string;
  returnType: ImmunizationReturnType;
  status: ImmunizationReturnStatus;
  originUngetId: string;
  originFacilityCode: string;
  suggestedDestinationFacilityCode?: string;
  period: string;
  movementDate?: string;
  referenceDocument?: string;
  reason: ImmunizationReturnReason;
  observation?: string;
  createdBy?: string;
  sentAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  receptionReason?: string;
  receptionObservation?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImmunizationReturnItem {
  id?: string;
  returnId?: string;
  productId: string;
  sourceStockLayerId: string;
  codigoSismedSnapshot: string;
  lote: string;
  expirationDate: string;
  quantity: number;
  unitPrice: number;
  fundingSource: string;
  supplyType: string;
  observation?: string;
  receivedQuantity?: number;
  destinationStockLayerId?: string;
  product?: ImmunizationProduct;
}

export interface ImmunizationReturnReceptionItemInput {
  itemId: string;
  receivedQuantity: number;
}

export interface ImmunizationReturnReceptionInput {
  reason?: string;
  observation?: string;
  items: ImmunizationReturnReceptionItemInput[];
}

export interface ImmunizationAdjustment {
  id?: string;
  ownerType: ImmunizationOwnerType;
  ungetId?: string;
  facilityCode?: string;
  period: string;
  status: 'APPLIED' | 'VOIDED';
  reason: string;
  observation: string;
  createdBy?: string;
  createdAt?: string;
}

export interface ImmunizationAdjustmentItem {
  id?: string;
  adjustmentId?: string;
  productId: string;
  stockLayerId?: string;
  lote: string;
  expirationDate: string;
  systemQuantity: number;
  physicalQuantity: number;
  differenceQuantity: number;
  unitPrice: number;
  fundingSource: string;
  supplyType: string;
  operationType?: 'QUANTITY' | 'NEW_LAYER' | 'RECLASSIFY_SOURCE' | 'RECLASSIFY_TARGET';
  reclassificationKey?: string;
  product?: ImmunizationProduct;
}

export interface ImmunizationMonthlyClosure {
  id?: string;
  ownerType: ImmunizationMonthlyClosureOwnerType;
  period: string;
  ungetId?: string;
  facilityCode?: string;
  status: ImmunizationMonthlyClosureStatus;
  observation?: string;
  preclosedBy?: string;
  preclosedAt?: string;
  closedBy?: string;
  closedAt?: string;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockAssignment {
  id?: string;
  adminUsername: string;
  facilityCode: string;
  sheetName: string;
  sheetUrl: string;
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
