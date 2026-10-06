
import React, { useState, useRef } from 'react';
import { toast } from 'sonner';
import { findMesKey, TEMPLATE_MONTH_HEADERS } from '../services/requirementMonths';
import { DecimalMark, detectCsvDelimiter, parseLocaleNumber } from '../services/localeNumber';
import { isVaccineProduct } from '../services/vaccines';
import { Trash2, Activity, Upload, FileSpreadsheet, Calendar, Check, AlertCircle, AlertTriangle, X, Syringe, Settings2, Play, RefreshCw, Download, ChevronDown, ChevronUp, CheckCircle, Ban, ListFilter, Building2 } from 'lucide-react';
import { read, utils, writeFile } from 'xlsx';
import { MedicationInput, HealthFacility, Microred, RequirementExclusionItem, AuraAnalysisResult, AdditionalItem } from '../types';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { normalizeExclusionCode, requirementExclusionService } from '../services/requirementExclusionService';
import { getUserJurisdictionScope } from '../services/jurisdictionService';
import { SortButton, ariaSort, useTableSort } from './ui/kit';

interface InputSectionProps {
  onAnalyze: (
    data: MedicationInput[], 
    referenceDate: string, 
    excludeVaccines: boolean,
    metadata?: {
      microred?: string;
      codEess?: string;
      establishmentName?: string;
      category?: string;
    }
  ) => void;
  onReset: () => void;
  isAnalyzing: boolean;
  hasAnalyzedData: boolean; // Prop to know if there is active data
  analysisResult?: any;
  // PROPS FOR LIFTED STATE
  currentItems: MedicationInput[];
  onItemsChange: (items: MedicationInput[]) => void;
  onResultChange?: (res: any | null) => void;
  reviewedIds?: Set<string>;
  onReviewedIdsChange?: (ids: Set<string>) => void;
  additionalItems?: any[];
  onAdditionalItemsChange?: (items: any[]) => void;
}

// Sample data with spikes for demonstration
const SAMPLE_DATA: MedicationInput[] = [
  {
    id: '00143',
    name: 'Paracetamol 500mg (Con Pico Anormal)',
    currentStock: 1000,
    unitPrice: 0.10,
    monthlyConsumption: [450, 480, 460, 2000, 460, 450, 455, 460, 470, 480, 450, 460],
    ff: 'TABLETA',
    medtip: 'MED',
    medpet: '01',
    medest: 'S',
  },
  {
    id: '02312',
    name: 'Amoxicilina 500mg (Estable)',
    currentStock: 0,
    unitPrice: 0.50,
    monthlyConsumption: [200, 210, 190, 220, 200, 205, 195, 200, 210, 190, 200, 210],
    ff: 'TABLETA',
    medtip: 'MED',
    medpet: '01',
    medest: 'N',
  },
  {
    id: '05432',
    name: 'Ibuprofeno 400mg (Varios Picos)',
    currentStock: 150, 
    unitPrice: 0.20,
    monthlyConsumption: [100, 500, 110, 105, 500, 110, 100, 105, 110, 115, 120, 110],
    ff: 'TABLETA',
    medtip: 'MED',
    medpet: '01',
    medest: 'S',
  }
];


const ACCION_TONES = {
  teal: { idle: 'text-teal-700 bg-teal-50 border-teal-100', active: 'sm:group-hover:bg-teal-600 sm:group-hover:text-white sm:group-hover:border-teal-600 sm:group-focus-visible:bg-teal-600 sm:group-focus-visible:text-white sm:group-focus-visible:ring-teal-300', label: 'text-slate-600' },
  emerald: { idle: 'text-emerald-700 bg-emerald-50 border-emerald-100', active: 'sm:group-hover:bg-emerald-600 sm:group-hover:text-white sm:group-hover:border-emerald-600 sm:group-focus-visible:bg-emerald-600 sm:group-focus-visible:text-white sm:group-focus-visible:ring-emerald-300', label: 'text-slate-600' },
  indigo: { idle: 'text-indigo-700 bg-indigo-50 border-indigo-100', active: 'sm:group-hover:bg-indigo-600 sm:group-hover:text-white sm:group-hover:border-indigo-600 sm:group-focus-visible:bg-indigo-600 sm:group-focus-visible:text-white sm:group-focus-visible:ring-indigo-300', label: 'text-slate-600' },
  red: { idle: 'text-red-600 bg-red-50 border-red-100', active: 'sm:group-hover:bg-red-600 sm:group-hover:text-white sm:group-hover:border-red-600 sm:group-focus-visible:bg-red-600 sm:group-focus-visible:text-white sm:group-focus-visible:ring-red-300', label: 'text-red-600' },
} as const;

/**
 * Acción de la franja del archivo: ícono grande (44 px) que en escritorio, al pasar el mouse
 * o llegar con Tab, se estira y muestra su texto (200 ms, sin movimiento si el equipo pide
 * reducirlo). En el celular no hay «pasar el mouse»: el texto va siempre debajo del ícono.
 */
const AccionExpandible: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone: keyof typeof ACCION_TONES;
  onClick: (e: React.MouseEvent) => void;
}> = ({ icon, label, tone, onClick }) => {
  const t = ACCION_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="group flex min-w-0 flex-1 flex-col items-center gap-1 outline-none sm:flex-none"
    >
      <span
        className={`flex h-11 items-center justify-center overflow-hidden rounded-xl border px-[11px] transition-all duration-200 motion-reduce:transition-none sm:group-hover:shadow-md sm:group-focus-visible:shadow-md sm:group-focus-visible:ring-2 sm:group-focus-visible:ring-offset-1 ${t.idle} ${t.active}`}
      >
        {icon}
        <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-sm font-bold opacity-0 transition-all duration-200 motion-reduce:transition-none sm:inline sm:group-hover:ml-2 sm:group-hover:max-w-[200px] sm:group-hover:opacity-100 sm:group-focus-visible:ml-2 sm:group-focus-visible:max-w-[200px] sm:group-focus-visible:opacity-100">
          {label}
        </span>
      </span>
      <span className={`text-center text-[10px] font-bold leading-tight sm:hidden ${t.label}`}>{label}</span>
    </button>
  );
};

export const InputSection: React.FC<InputSectionProps> = ({ 
    onAnalyze, 
    onReset, 
    isAnalyzing, 
    hasAnalyzedData,
    analysisResult,
    currentItems,
    onItemsChange,
    onResultChange,
    reviewedIds,
    onReviewedIdsChange,
    additionalItems,
    onAdditionalItemsChange
}) => {
  const { user, can } = useAuth();
  // Acciones que el rol puede usar (Configuración de Roles).
  const canAn = {
    analyze: can('DASHBOARD', 'analyze'), importProgress: can('DASHBOARD', 'importProgress'),
    exportProgress: can('DASHBOARD', 'exportProgress'), clear: can('DASHBOARD', 'clear'),
  };

  const userFacilityCode = React.useMemo(() => {
    return (user?.facilityData?.code || user?.personnelData?.facilityCode || '').trim().replace(/^0+/, '');
  }, [user]);

  const currentStorageKey = React.useMemo(() => {
    return userFacilityCode ? `aura_data_v1_${userFacilityCode}` : 'aura_data_v1';
  }, [userFacilityCode]);

  const currentInputKey = React.useMemo(() => {
    return userFacilityCode ? `aura_input_data_v1_${userFacilityCode}` : 'aura_input_data_v1';
  }, [userFacilityCode]);

  const currentReviewKey = React.useMemo(() => {
    return userFacilityCode ? `aura_reviews_v1_${userFacilityCode}` : 'aura_reviews_v1';
  }, [userFacilityCode]);

  const currentAdditionalKey = React.useMemo(() => {
    return userFacilityCode ? `aura_additional_v1_${userFacilityCode}` : 'aura_additional_v1';
  }, [userFacilityCode]);

  // Use Props instead of Local State
  const items = currentItems;
  const setItems = onItemsChange;

  // Vista previa de lo cargado: se ordena tocando sus cabeceras.
  const previewSort = useTableSort(items, {
    code: (item) => item.id,
    name: (item) => item.name,
    stock: (item) => item.currentStock,
    months: (item) => item.monthlyConsumption.filter(v => v > 0).length,
  }, { firstDir: { stock: 'desc', months: 'desc' } });

  const [isUploadSectionCollapsed, setIsUploadSectionCollapsed] = useState(() => hasAnalyzedData);
  const [tempItems, setTempItems] = useState<MedicationInput[]>([]); // Store items temporarily while asking for date
  
  // Modal State
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isVaccineModalOpen, setIsVaccineModalOpen] = useState(false); // NEW: Vaccine & Exclusion Config Modal
  const [excludeVaccinesSelection, setExcludeVaccinesSelection] = useState(true); // Default selection
  const [excludeCustomListSelection, setExcludeCustomListSelection] = useState(true); // Default selection for custom establishment exclusion list
  const [customExclusionItems, setCustomExclusionItems] = useState<RequirementExclusionItem[]>([]);
  const [customExclusionCount, setCustomExclusionCount] = useState<number>(0);
  const [detectedMonthsCount, setDetectedMonthsCount] = useState<number>(12);
  const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
  const [showClearWarning, setShowClearWarning] = useState(false); 
  
  // Imported metadata states
  const [importedMicrored, setImportedMicrored] = useState<string>('');
  const [importedCodEess, setImportedCodEess] = useState<string>('');
  const [importedEstablishmentName, setImportedEstablishmentName] = useState<string>('');
  const [importedCategory, setImportedCategory] = useState<string>('');
  const [showReanalysisWarning, setShowReanalysisWarning] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // States to hold official database facilities and microreds for metadata mapping and correction
  const [dbFacilities, setDbFacilities] = useState<HealthFacility[]>([]);
  const [dbMicroredes, setDbMicroredes] = useState<Microred[]>([]);

  // User facility fallback values
  const userFacility = user?.facilityData;
  const userPersonnel = user?.personnelData;

  const displayCodEess = React.useMemo(() => {
    return importedCodEess || userFacility?.code || userPersonnel?.facilityCode || '';
  }, [importedCodEess, userFacility, userPersonnel]);

  const displayEstablishmentName = React.useMemo(() => {
    if (importedEstablishmentName) return importedEstablishmentName;
    if (userFacility?.name) return userFacility.name;
    if (displayCodEess && dbFacilities.length > 0) {
      const norm = displayCodEess.trim().replace(/^0+/, '');
      const fac = dbFacilities.find(f => f.code.trim().replace(/^0+/, '') === norm);
      if (fac?.name) return fac.name;
    }
    return '';
  }, [importedEstablishmentName, userFacility, displayCodEess, dbFacilities]);

  const displayCategory = React.useMemo(() => {
    if (importedCategory) return importedCategory;
    if (userFacility?.category) return userFacility.category;
    if (displayCodEess && dbFacilities.length > 0) {
      const norm = displayCodEess.trim().replace(/^0+/, '');
      const fac = dbFacilities.find(f => f.code.trim().replace(/^0+/, '') === norm);
      if (fac?.category) return fac.category;
    }
    return '';
  }, [importedCategory, userFacility, displayCodEess, dbFacilities]);

  const displayMicrored = React.useMemo(() => {
    if (importedMicrored) return importedMicrored;
    const mrId = userFacility?.microredId || userPersonnel?.microredId;
    if (mrId && dbMicroredes.length > 0) {
      const mr = dbMicroredes.find(m => m.id === mrId);
      if (mr?.name) return mr.name;
    }
    if (displayCodEess && dbFacilities.length > 0) {
      const norm = displayCodEess.trim().replace(/^0+/, '');
      const fac = dbFacilities.find(f => f.code.trim().replace(/^0+/, '') === norm);
      if (fac?.microredId && dbMicroredes.length > 0) {
        const mr = dbMicroredes.find(m => m.id === fac.microredId);
        if (mr?.name) return mr.name;
      }
    }
    return '';
  }, [importedMicrored, userFacility, userPersonnel, displayCodEess, dbFacilities, dbMicroredes]);

  // Fetch facilities and microredes on mount
  React.useEffect(() => {
    const fetchDbData = async () => {
      try {
        const [facilities, microredes] = await Promise.all([
          api.getFacilities(),
          api.getMicroredes()
        ]);
        if (facilities) setDbFacilities(facilities);
        if (microredes) setDbMicroredes(microredes);
      } catch (err) {
        console.error('Error fetching facilities or microredes for lookup:', err);
      }
    };
    fetchDbData();
  }, []);

  // Automated lookup/correction: when importedCodEess is set or DB records load,
  // find the corresponding official facility name and official microred name.
  React.useEffect(() => {
    if (importedCodEess && dbFacilities.length > 0) {
      const normCod = importedCodEess.trim().replace(/^0+/, '');
      const facility = dbFacilities.find(f => f.code.trim().replace(/^0+/, '') === normCod);
      if (facility) {
        // Correct/override establishment name with the official DB name
        if (facility.name && facility.name !== importedEstablishmentName) {
          setImportedEstablishmentName(facility.name);
        }
        // Correct/override microred with the official DB microred
        if (facility.microredId && dbMicroredes.length > 0) {
          const mr = dbMicroredes.find(m => m.id === facility.microredId);
          if (mr && mr.name && mr.name !== importedMicrored) {
            setImportedMicrored(mr.name);
          }
        }
      }
    }
  }, [importedCodEess, dbFacilities, dbMicroredes, importedEstablishmentName, importedMicrored]);

  // Default to CURRENT month
  const [referenceDate, setReferenceDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 7);
  });

  // Sync state if there is already an analysisResult loaded (e.g. page reload)
  React.useEffect(() => {
    if (analysisResult) {
      if (analysisResult.establishmentName) setImportedEstablishmentName(analysisResult.establishmentName);
      if (analysisResult.codEess) setImportedCodEess(analysisResult.codEess);
      if (analysisResult.microred) setImportedMicrored(analysisResult.microred);
      if (analysisResult.category) setImportedCategory(analysisResult.category);
      if (analysisResult.referenceDate) setReferenceDate(analysisResult.referenceDate);
      setIsUploadSectionCollapsed(true);
    }
  }, [analysisResult]);

  // Collapsed state synchronization: collapse as soon as there are items loaded
  React.useEffect(() => {
    if (items.length > 0) {
      setIsUploadSectionCollapsed(true);
    } else {
      setIsUploadSectionCollapsed(false);
    }
  }, [items.length]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- EXPORT PROGRESS ---
  const handleExportSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const exportData: any = {
        version: "1.0",
        source: "aura-pharma-ipress-requirement",
        timestamp: new Date().toISOString(),
        localStorage: {
          aura_data_v1: window.localStorage.getItem(currentStorageKey) || window.localStorage.getItem('aura_data_v1'),
          aura_reviews_v1: window.localStorage.getItem(currentReviewKey) || window.localStorage.getItem('aura_reviews_v1'),
          aura_additional_v1: window.localStorage.getItem(currentAdditionalKey) || window.localStorage.getItem('aura_additional_v1'),
          aura_input_data_v1: window.localStorage.getItem(currentInputKey) || window.localStorage.getItem('aura_input_data_v1'),
        },
        rawInputItems: items,
        metadata: {
          importedMicrored,
          importedCodEess,
          importedEstablishmentName,
          importedCategory,
          referenceDate
        }
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `Requerimiento_IPRESS_Avance_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();

      toast.success("Avance del requerimiento exportado correctamente");
    } catch (error) {
      console.error("Error exporting session:", error);
      toast.error("Error al exportar el avance");
    }
  };

  // --- IMPORT PROGRESS ---
  const handleImportSession = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingFile(true);
      setUploadError(null);
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const importedData = JSON.parse(content);

          if (importedData.source !== "aura-pharma-ipress-requirement") {
            throw new Error("El archivo no corresponde a un respaldo de Requerimiento IPRESS.");
          }

          if (!importedData.localStorage) {
            throw new Error("Formato de archivo inválido de respaldo.");
          }

          // Primero se valida todo y solo después se escribe. Antes se reemplazaba el avance
          // guardado y luego se revisaba el establecimiento: el usuario veía «El respaldo
          // pertenece a…», pero su propio análisis ya se había perdido.
          const saved = importedData.localStorage;
          const parseSaved = <T,>(value: unknown, label: string): T | null => {
            if (!value) return null;
            try {
              return JSON.parse(String(value)) as T;
            } catch {
              throw new Error(`El respaldo está dañado (${label}).`);
            }
          };
          const restoredResult = parseSaved<AuraAnalysisResult>(saved.aura_data_v1, "análisis");
          const restoredReviews = parseSaved<string[]>(saved.aura_reviews_v1, "validaciones");
          const restoredAdditional = parseSaved<AdditionalItem[]>(saved.aura_additional_v1, "ítems adicionales");
          if (saved.aura_input_data_v1) parseSaved<unknown>(saved.aura_input_data_v1, "datos cargados");

          if (importedData.metadata) {
            const userScope = getUserJurisdictionScope(user);
            if (userScope.level === 'IPRESS') {
              const userFacilityCode = user?.facilityData?.code || user?.personnelData?.facilityCode;
              const userFacilityName = user?.facilityData?.name || dbFacilities.find(f => f.code === userFacilityCode)?.name || '';
              const fileCod = importedData.metadata.importedCodEess;
              const fileEst = importedData.metadata.importedEstablishmentName;

              const normalizeCode = (c?: string) => String(c ?? '').trim().replace(/^0+/, '');
              const activeNorm = normalizeCode(userFacilityCode);
              const fileNorm = normalizeCode(fileCod);

              if (fileNorm && activeNorm && fileNorm !== activeNorm) {
                throw new Error(`El respaldo pertenece a "${fileEst || fileCod}" (CÓD: ${fileCod}), pero su usuario está asignado a "${userFacilityName || activeNorm}" (CÓD: ${userFacilityCode}). Como personal de Farmacia / IPRESS solo puede importar requerimientos de su propio establecimiento.`);
              }
            }
          }

          // Todo en orden: ahora sí se reemplaza el avance guardado.
          const writeKey = (key: string, value: unknown) => {
            if (value) window.localStorage.setItem(key, String(value));
            else window.localStorage.removeItem(key);
          };
          writeKey(currentStorageKey, saved.aura_data_v1);
          writeKey(currentReviewKey, saved.aura_reviews_v1);
          writeKey(currentAdditionalKey, saved.aura_additional_v1);
          const rawItems = importedData.rawInputItems || [];
          writeKey(currentInputKey, saved.aura_input_data_v1 || (rawItems.length > 0 ? JSON.stringify(rawItems) : null));

          setItems(rawItems);
          onResultChange?.(restoredResult);
          onReviewedIdsChange?.(new Set(restoredReviews || []));
          onAdditionalItemsChange?.(restoredAdditional || []);

          if (importedData.metadata) {
            setImportedMicrored(importedData.metadata.importedMicrored || '');
            setImportedCodEess(importedData.metadata.importedCodEess || '');
            setImportedEstablishmentName(importedData.metadata.importedEstablishmentName || '');
            setImportedCategory(importedData.metadata.importedCategory || '');
            setReferenceDate(importedData.metadata.referenceDate || '');
          }

          setIsUploadSectionCollapsed(!!importedData.localStorage.aura_data_v1);
          toast.success("Avance del requerimiento importado correctamente");
        } catch (error: any) {
          console.error("Error parsing backup file:", error);
          setUploadError(`Error al importar respaldo: ${error.message || "Estructura inválida"}`);
          toast.error("Archivo de respaldo inválido");
        } finally {
          setIsProcessingFile(false);
          if (importInputRef.current) importInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    } catch (error) {
      console.error("Error reading file:", error);
      setIsProcessingFile(false);
      toast.error("Error al leer el archivo de respaldo");
    }
  };

  const processData = (parsedItems: MedicationInput[]) => {
      onReset(); // Clear previous analysis (and items via App.tsx logic) when new data is processed
      setTempItems(parsedItems);
      setIsDateModalOpen(true); // Open modal immediately after parsing
  };

  const loadSampleData = () => {
    processData(SAMPLE_DATA);
  };

    const downloadTemplate = () => {
    const header = [
      "RED", "MICRORED", "COD EESS", "ESTABLECIMIENTO", "CAT",
      "MED COD", "DESCRIPCION DEL PRODUCTO", "MEDFF", "PRECIO",
      "MEDTIP", "MEDPET", "MEDEST",
      // MES01 … MES12, como el archivo del SISMED. Antes eran MES_1 … MES_12 y el propio
      // sistema no las reconocía al cargar la plantilla (los consumos quedaban en 0).
      ...TEMPLATE_MONTH_HEADERS, "STOCK_FIN"
    ];

    const ws = utils.json_to_sheet([], { header });
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Plantilla Requerimiento");
    writeFile(wb, "Plantilla_Requerimiento.xlsx");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canAn.analyze) {
      toast.error('Su rol no puede cargar archivos para el análisis.');
      return;
    }

    setUploadError(null);
    setIsProcessingFile(true);

    // Simulate processing delay for animation
    setTimeout(async () => {
        try {
          const data = await file.arrayBuffer();
          // CSV: se lee como texto, sin que `xlsx` interprete los valores. Si no, «0,35» se leía
          // como 35, «1 234» como NaN y el código «00143» como 143. Los números se leen después
          // con la regla de su separador (CSV con «;» → coma decimal).
          const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
          let decimalMark: DecimalMark = 'auto';
          let workbook;
          if (isCsv) {
            let text: string;
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(data);
            } catch {
              text = new TextDecoder('windows-1252').decode(data);
            }
            const delimiter = detectCsvDelimiter(text);
            decimalMark = delimiter === ';' ? ',' : '.';
            workbook = read(text, { type: 'string', raw: true, FS: delimiter });
          } else {
            workbook = read(data, { type: 'array' });
          }
          let unreadableCells = 0;
          /** Número de una celda; lo que no se puede leer cuenta para el aviso y vale 0. */
          const cellNumber = (value: unknown): number => {
            if (value === undefined || value === null || String(value).trim() === '') return 0;
            const parsed = parseLocaleNumber(value, decimalMark);
            if (Number.isNaN(parsed)) { unreadableCells++; return 0; }
            return parsed;
          };
          
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            setUploadError("Error al procesar el archivo: El archivo no contiene hojas válidas.");
            setIsProcessingFile(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }

          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          const jsonData = utils.sheet_to_json<any>(worksheet);
          
          // Validate required headers
          if (jsonData.length === 0) {
            setUploadError("Error al procesar el archivo: El archivo está vacío.");
            setIsProcessingFile(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
          
            const REQUIRED_HEADERS = [
              'codigo_med', 'descrip', 'medtip', 'medpet', 'mes01', 'mes02', 'mes03', 
              'mes04', 'mes05', 'mes06', 'mes07', 'mes08', 'mes09', 'mes10', 'mes11', 
              'mes12', 'precio', 'stock', 'sumames', 'cuenta', 'cpa', 'meses_prov', 
              'situacion', 'ff', 'medest'
            ];
          
          const fileHeaders = Object.keys(jsonData[0]).map(h => h.toLowerCase().trim());
          
          let hasValidStructure = false;
          const hasOfficialSismed = ['codigo', 'descrip'].every(req => fileHeaders.some(h => h.includes(req))) || Object.keys(jsonData[0]).some(k => k.toLowerCase().includes('mes01'));
          const hasConsolidated = ['med cod', 'descripcion del producto'].every(req => fileHeaders.some(h => h.includes(req)));
          
          if (hasOfficialSismed || hasConsolidated) {
            hasValidStructure = true;
          }

          if (!hasValidStructure) {
            setUploadError("Error al procesar el archivo: Estructura inválida. El archivo no contiene las columnas necesarias (Ej: CODIGO_MED / MED COD, DESCRIPCION). Verifique que sea la plantilla correcta.");
            setIsProcessingFile(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }

          // Extract general establishment metadata from the first few rows
          let mrTemp = '';
          let codTemp = '';
          let estTemp = '';
          let catTemp = '';

          for (const row of jsonData) {
            const findRowKey = (keys: string[], exclude: string[] = []) => Object.keys(row).find(k => {
                const cleanedK = k.toLowerCase().replace(/[\s\u00a0_]+/g, ' ').trim();
                if (exclude.some(ex => cleanedK.includes(ex.toLowerCase()))) return false;
                return keys.some(key => {
                    const cleanedKey = key.toLowerCase();
                    return cleanedK === cleanedKey || cleanedK.includes(cleanedKey);
                });
            });
            
            const mrKey = findRowKey(['microred', 'micro red', 'micro-red', 'microrred']);
            const codKey = findRowKey(['cod eess', 'codeess', 'cod_eess', 'codigo de eess', 'codigo eess', 'codigo_eess', 'cod_est', 'cod_ipress']);
            const estKey = findRowKey(['establecimiento', 'nombre de establecimiento', 'nombre_establecimiento', 'eess', 'ipress', 'nombre eess'], ['cod', 'codigo']);
            const catKey = findRowKey(['cat', 'categoria', 'categoria del establecimiento', 'categoria_establecimiento', 'categoria eess']);

            if (mrKey && !mrTemp) mrTemp = String(row[mrKey] || '').trim();
            if (codKey && !codTemp) codTemp = String(row[codKey] || '').trim();
            if (estKey && !estTemp) estTemp = String(row[estKey] || '').trim();
            if (catKey && !catTemp) catTemp = String(row[catKey] || '').trim();

            if (mrTemp && codTemp && estTemp && catTemp) break;
          }

          // Validate establishment restriction for IPRESS / Farmacia users
          let fileCodToValidate = codTemp;
          let fileEstToValidate = estTemp;

          if (!fileCodToValidate && fileEstToValidate && dbFacilities.length > 0) {
            const normEst = fileEstToValidate.toLowerCase().trim();
            const fac = dbFacilities.find(f => f.name.toLowerCase().trim() === normEst || f.name.toLowerCase().includes(normEst));
            if (fac) {
              fileCodToValidate = fac.code;
            }
          }

          const userScope = getUserJurisdictionScope(user);
          if (userScope.level === 'IPRESS') {
            const userFacilityCode = user?.facilityData?.code || user?.personnelData?.facilityCode;
            const userFacilityName = user?.facilityData?.name || dbFacilities.find(f => f.code === userFacilityCode)?.name || '';

            const normalizeCode = (c?: string) => (c || '').trim().replace(/^0+/, '');
            const activeNorm = normalizeCode(userFacilityCode);
            const fileNorm = normalizeCode(fileCodToValidate);

            if (fileNorm && activeNorm && fileNorm !== activeNorm) {
              const errorMsg = `Acceso denegado: El archivo cargado pertenece a "${fileEstToValidate || fileCodToValidate}" (CÓD: ${fileCodToValidate}), pero su usuario está asignado a "${userFacilityName || activeNorm}" (CÓD: ${userFacilityCode}). Como personal de Farmacia / IPRESS solo puede procesar requerimientos de su propio establecimiento.`;
              setUploadError(errorMsg);
              setIsProcessingFile(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
              toast.error("El archivo pertenece a otro establecimiento");
              return;
            }
          }

          setImportedMicrored(mrTemp);
          setImportedCodEess(codTemp);
          setImportedEstablishmentName(estTemp);
          setImportedCategory(catTemp);

          // Detect last month and count from headers
          let detectedCount = 12;
          if (jsonData.length > 0) {
            for (const row of jsonData) {
                const numKeys = Object.keys(row).filter(k => /^\d{6}$/.test(String(k).trim())).sort();
                if (numKeys.length > 0) {
                    detectedCount = numKeys.length;
                    const lastYyyyMm = String(numKeys[numKeys.length - 1]).trim();
                    const year = lastYyyyMm.substring(0, 4);
                    const month = lastYyyyMm.substring(4, 6);
                    setReferenceDate(`${year}-${month}`);
                    break;
                } else {
                    const monthNames = [
                        ['enero', 'ene', 'mes01', 'mes1'], ['febrero', 'feb', 'mes02', 'mes2'], ['marzo', 'mar', 'mes03', 'mes3'],
                        ['abril', 'abr', 'mes04', 'mes4'], ['mayo', 'may', 'mes05', 'mes5'], ['junio', 'jun', 'mes06', 'mes6'],
                        ['julio', 'jul', 'mes07', 'mes7'], ['agosto', 'ago', 'mes08', 'mes8'], ['setiembre', 'septiembre', 'set', 'sep', 'mes09', 'mes9'],
                        ['octubre', 'oct', 'mes10'], ['noviembre', 'nov', 'mes11'], ['diciembre', 'dic', 'mes12']
                    ];
                    
                    const findKey = (keys: string[]) => Object.keys(row).find(k => keys.some(key => k.toLowerCase().includes(key.toLowerCase())));
                    let countFound = 0;
                    monthNames.forEach((names, i) => {
                        if (findMesKey(Object.keys(row), i + 1) || findKey(names)) countFound++;
                    });
                    if (countFound > 0) {
                        detectedCount = countFound;
                    }
                    // Relies on default date if no YYYYMM format exists
                    break;
                }
            }
          }
          setDetectedMonthsCount(detectedCount);

          const rawData = utils.sheet_to_json<any>(worksheet, { header: "A" });

          const parsedItems: MedicationInput[] = jsonData.map((row: any, index: number): MedicationInput | null => {
            const findKey = (keys: string[]) => Object.keys(row).find(k => keys.some(key => k.toLowerCase().includes(key.toLowerCase())));
            const findExactKey = (keys: string[]) => Object.keys(row).find(k => keys.some(key => k.toLowerCase() === key.toLowerCase()));

            const nameKey = findKey(['descrip', 'medicamento', 'nombre', 'descripcion del producto']);
            const stockKey = findExactKey(['stock', 'stock_actual', 'stk', 'stock_fin']) || findKey(['stock']);
            const priceKey = findKey(['precio', 'costo', 'unit']);
            
            // Precise matching for the real SISMED medication code (to prevent grabbing "COD EESS")
            const rowKeys = Object.keys(row);
            
            // Helper to clean and normalize headers
            const cleanHeader = (str: string) => {
                return str.toLowerCase()
                    .replace(/[\s\u00a0_]+/g, ' ') // replace multiple spaces, non-breaking spaces, underscores with single space
                    .trim();
            };

            let codeKey = rowKeys.find(k => {
                const cleaned = cleanHeader(k);
                return ['med cod', 'medcod', 'cod med', 'codmed', 'codigo med', 'codigomed', 'codigo sismed', 'cod sismed', 'cod_sismed', 'cod_med', 'codigo de medicamento', 'cod_prod', 'codigo de producto'].includes(cleaned);
            });
            
            if (!codeKey) {
                // Secondary fallback containing both "med" and "cod", avoiding establishment/EESS keywords
                codeKey = rowKeys.find(k => {
                    const cleaned = cleanHeader(k);
                    const isEstablishment = cleaned.includes('eess') || cleaned.includes('establecimiento') || cleaned.includes('ipress') || cleaned.includes('red') || cleaned.includes('microred') || cleaned.includes('unget') || cleaned.includes('ogess') || cleaned.includes('diresa') || cleaned.includes('dias') || cleaned.includes('user') || cleaned.includes('usuario');
                    const hasMed = cleaned.includes('med') || cleaned.includes('sismed') || cleaned.includes('prod') || cleaned.includes('item');
                    const hasCod = cleaned.includes('cod') || cleaned.includes('code') || cleaned.includes('codigo');
                    return !isEstablishment && hasMed && hasCod;
                });
            }

            if (!codeKey) {
                // Third level fallback, strictly avoiding common establishment/EESS/IPRESS/User keywords
                codeKey = rowKeys.find(k => {
                    const cleaned = cleanHeader(k);
                    const isEstablishment = cleaned.includes('eess') || cleaned.includes('establecimiento') || cleaned.includes('ipress') || cleaned.includes('red') || cleaned.includes('microred') || cleaned.includes('unget') || cleaned.includes('ogess') || cleaned.includes('diresa') || cleaned.includes('dias') || cleaned.includes('user') || cleaned.includes('usuario');
                    return !isEstablishment && (cleaned.includes('codigo') || cleaned.includes('cod') || cleaned.includes('code'));
                });
            }

            const ffKey = findKey(['ff', 'forma', 'presentacion', 'farmaceutica', 'medff']);
            const tipKey = findKey(['tip', 'tipo', 'medtip']);
            const petKey = findKey(['pet', 'petitorio', 'medpet']);
            
            let estValue = undefined;
            // Safe access for rawData lookahead
            if (rawData && rawData[index + 1] && rawData[index + 1]['AH']) {
                estValue = rawData[index + 1]['AH'];
            } 
            if (!estValue) {
                const estKey = findKey(['estrategico', 'medest', 'situacion', 'condicion']);
                if (estKey) estValue = row[estKey];
            }

            const name = nameKey ? row[nameKey] : `Item ${index + 1}`;
            const stock = stockKey ? cellNumber(row[stockKey]) : 0;
            const price = priceKey ? cellNumber(row[priceKey]) : 0;
            const code = codeKey ? String(row[codeKey]).trim() : (Date.now() + index).toString();
            
            let months: number[] = [];
            const numKeys = Object.keys(row).filter(k => /^\d{6}$/.test(String(k).trim())).sort();

            if (numKeys.length > 0) {
                const targetKeys = numKeys.slice(-12);
                targetKeys.forEach(k => {
                    months.push(cellNumber(row[k]));
                });
            } else {
                const monthNames = [
                    ['enero', 'ene', 'mes01', 'mes1'], ['febrero', 'feb', 'mes02', 'mes2'], ['marzo', 'mar', 'mes03', 'mes3'],
                    ['abril', 'abr', 'mes04', 'mes4'], ['mayo', 'may', 'mes05', 'mes5'], ['junio', 'jun', 'mes06', 'mes6'],
                    ['julio', 'jul', 'mes07', 'mes7'], ['agosto', 'ago', 'mes08', 'mes8'], ['setiembre', 'septiembre', 'set', 'sep', 'mes09', 'mes9'],
                    ['octubre', 'oct', 'mes10'], ['noviembre', 'nov', 'mes11'], ['diciembre', 'dic', 'mes12']
                ];
                monthNames.forEach((names, i) => {
                    // Primero «MES» + número (MES01, MES_1…); si no, por el nombre del mes.
                    const key = findMesKey(rowKeys, i + 1) || findKey(names);
                    if (key) {
                        months.push(cellNumber(row[key]));
                    } else {
                        months.push(0); 
                    }
                });
            }

            if (!nameKey && !stockKey && !codeKey) return null;

            return {
              id: code,
              code: code,
              name: String(name),
              currentStock: isNaN(stock) ? 0 : stock,
              unitPrice: isNaN(price) ? 0 : price,
              monthlyConsumption: months,
              ff: ffKey ? String(row[ffKey]) : undefined,
              medtip: tipKey ? String(row[tipKey]) : undefined,
              medpet: petKey ? String(row[petKey]) : undefined,
              medest: estValue ? String(estValue) : undefined,
            };
          }).filter((item): item is MedicationInput => item !== null);

          if (unreadableCells > 0) {
            toast.warning(`${unreadableCells} ${unreadableCells === 1 ? 'celda con un número que no se pudo leer' : 'celdas con números que no se pudieron leer'}; se tomaron como 0. Revise el archivo.`);
          }

          if (parsedItems.length === 0) {
            setUploadError("Error al procesar el archivo: No se detectaron filas válidas con información de medicamentos.");
            setIsProcessingFile(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }

          setUploadError(null);
          setIsProcessingFile(false);
          processData(parsedItems);
          if (fileInputRef.current) fileInputRef.current.value = '';

        } catch (err: any) {
          console.error("Error parsing Excel:", err);
          setUploadError(`Error al procesar el archivo: ${err.message}`);
          setIsProcessingFile(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, 800); // 800ms delay for animation
  };

  const triggerFileUpload = () => {
    if (!canAn.analyze) return;
    // Check if we have analyzed data that might be lost
    if (hasAnalyzedData) {
        setShowOverwriteWarning(true);
    } else {
        fileInputRef.current?.click();
    }
  };

  const confirmOverwrite = () => {
      setShowOverwriteWarning(false);
      // Clear the existing data to allow a fresh upload
      setItems([]);
      onReset(); // This triggers the reset in App.tsx which clears analyzed data
      setUploadError(null);
      setIsUploadSectionCollapsed(false);
      
      // Reset metadata
      setImportedMicrored('');
      setImportedCodEess('');
      setImportedEstablishmentName('');
      setImportedCategory('');
      
      // Use setTimeout to ensure the modal state updates before triggering the click
      setTimeout(() => {
          if (fileInputRef.current) {
              fileInputRef.current.value = ''; // Reset input value
              fileInputRef.current.click();
          }
      }, 100);
  };

  const handleConfirmDate = () => {
    setItems(tempItems);
    setTempItems([]);
    setIsDateModalOpen(false);
  };

  // --- CLEAR LOGIC ---
  const handleClearClick = () => {
      // Show confirmation modal
      setShowClearWarning(true);
  };

  const confirmClearAll = () => {
      setItems([]); // Clear input items
      onReset(); // Clear analysis result
      setShowClearWarning(false);
      setIsUploadSectionCollapsed(false);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Reset metadata
      setImportedMicrored('');
      setImportedCodEess('');
      setImportedEstablishmentName('');
      setImportedCategory('');
  };

  // --- ANALYSIS EXECUTION LOGIC (WITH VACCINE AND CUSTOM EXCLUSION CHECK) ---
  const prepareAnalysisModal = async () => {
      const userFacilityCode = user?.facilityData?.code || user?.personnelData?.facilityCode || '';
      const effectiveCode = (importedCodEess || userFacilityCode).trim();
      if (effectiveCode) {
          try {
              const list = await requirementExclusionService.getExclusions(effectiveCode);
              setCustomExclusionItems(list);
              setCustomExclusionCount(list.length);
          } catch (e) {
              console.warn("Error fetching exclusions:", e);
              setCustomExclusionItems([]);
              setCustomExclusionCount(0);
          }
      } else {
          setCustomExclusionItems([]);
          setCustomExclusionCount(0);
      }
      setExcludeVaccinesSelection(true); // Default true
      setExcludeCustomListSelection(true); // Default true
      setIsVaccineModalOpen(true);
  };

  const handleExecuteClick = () => {
      if (hasAnalyzedData) {
          setShowReanalysisWarning(true);
      } else {
          prepareAnalysisModal();
      }
  };

  const confirmReanalysis = () => {
      setShowReanalysisWarning(false);
      prepareAnalysisModal();
  };

  const handleRunAnalysis = () => {
      let finalData = [...items];
      const excludeVaccines = excludeVaccinesSelection;
      const excludeCustom = excludeCustomListSelection;
      
      if (excludeVaccines) {
          finalData = finalData.filter(item => !isVaccineProduct(item.name));
      }

      if (excludeCustom && customExclusionItems.length > 0) {
          // Códigos completados con sus ceros en los dos lados: «00143» de la lista y 143 del Excel.
          const excludedCodes = new Set(
              customExclusionItems.map(item => normalizeExclusionCode(item.sismedCode))
          );
          finalData = finalData.filter(item => !excludedCodes.has(normalizeExclusionCode(item.id)));
      }

      const totalExcluded = items.length - finalData.length;
      if (totalExcluded > 0) {
          toast.info(`Se han excluido ${totalExcluded} ítems del análisis según las opciones seleccionadas.`);
      }

      // Pass the excludeVaccines decision and parsed metadata to App.tsx so it knows the data is already filtered
      onAnalyze(finalData, referenceDate, excludeVaccines, {
          microred: displayMicrored,
          codEess: displayCodEess,
          establishmentName: displayEstablishmentName,
          category: displayCategory
      });
      setIsVaccineModalOpen(false);
      setIsUploadSectionCollapsed(true);
  };

  return (
    <>
    <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        onClick={(e) => e.stopPropagation()}
        className="hidden" 
        accept=".xlsx, .xls, .csv"
    />
    
    <input 
        type="file" 
        ref={importInputRef} 
        onChange={handleImportSession} 
        onClick={(e) => e.stopPropagation()}
        className="hidden" 
        accept=".json"
    />

    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 transition-all relative ${isUploadSectionCollapsed && items.length > 0 ? 'p-4' : 'p-3 sm:p-6'} mb-4 sm:mb-6 ${items.length === 0 && !hasAnalyzedData ? 'max-sm:flex-1 max-sm:flex max-sm:flex-col max-sm:mb-0' : ''}`}>
      
      {items.length > 0 && !isProcessingFile && (
          <button
              onClick={() => setIsUploadSectionCollapsed(!isUploadSectionCollapsed)}
              className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full transition-colors z-20"
              title={isUploadSectionCollapsed ? "Expandir" : "Contraer"}
          >
              {isUploadSectionCollapsed ? <ChevronDown className="h-5 w-5 text-gray-500" /> : <ChevronUp className="h-5 w-5 text-gray-500" />}
          </button>
      )}

      {isUploadSectionCollapsed && items.length > 0 ? (
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-4 pr-10 sm:pr-0">
                  <div className="bg-teal-50 p-2 rounded-lg shrink-0">
                      <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                  </div>
                  {hasAnalyzedData ? (
                      // Con resultados, los datos del establecimiento y el corte están abajo, en
                      // «Resultados del Análisis»: aquí no se repiten.
                      <div>
                          <h3 className="text-sm font-bold text-gray-900">Requerimiento cargado</h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                              <span className="text-xs font-bold text-teal-600">{items.length.toLocaleString()} registros</span>
                              <span className="text-[10px] text-gray-400">•</span>
                              <span className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                                  <CheckCircle className="h-3.5 w-3.5 text-green-500 fill-green-50" />
                                  Validado correctamente
                              </span>
                          </div>
                      </div>
                  ) : (
                      // Antes de analizar no hay «Resultados»: aquí sigue diciendo de quién es.
                      <div>
                          <h3 className="text-sm font-bold text-gray-900">
                              {displayEstablishmentName ? displayEstablishmentName.toUpperCase() : "Requerimiento IPRESS Cargado"}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                              {displayCodEess && <span className="text-[10px] text-slate-600 font-bold bg-slate-100 px-1.5 py-0.5 rounded">CÓD: {displayCodEess}</span>}
                              {displayCategory && <span className="text-[10px] text-slate-600 font-bold bg-slate-100 px-1.5 py-0.5 rounded">CAT: {displayCategory}</span>}
                              {displayMicrored && <span className="text-[10px] text-teal-850 font-bold bg-teal-100/70 px-1.5 py-0.5 rounded">MR: {displayMicrored}</span>}
                              <span className="text-xs font-bold text-teal-600">{items.length.toLocaleString()} registros</span>
                              <span className="text-[10px] text-gray-400">•</span>
                              <span className="text-xs text-gray-500">Corte: <strong className="text-gray-700">{referenceDate}</strong></span>
                              <span className="text-[10px] text-gray-400">•</span>
                              <span className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                                  <CheckCircle className="h-3.5 w-3.5 text-green-500 fill-green-50" />
                                  Validado correctamente
                              </span>
                          </div>
                      </div>
                  )}
              </div>
              {/* Acciones: íconos grandes que al pasar el mouse (o con Tab) muestran su texto; en
                  el celular el texto va siempre debajo. «Limpiar todo» va aparte, en rojo, para
                  que no se toque por error junto a las demás. */}
              <div className="flex w-full items-start justify-between gap-2 border-t border-gray-100 pt-3 sm:mr-12 sm:w-auto sm:items-center sm:justify-end sm:border-0 sm:pt-0">
                  {canAn.analyze && <AccionExpandible
                      icon={<RefreshCw className="h-5 w-5" />}
                      label="Cargar nuevo archivo"
                      tone="teal"
                      onClick={triggerFileUpload}
                  />}
                  {canAn.importProgress && <AccionExpandible
                      icon={<Upload className="h-5 w-5" />}
                      label="Importar avance"
                      tone="emerald"
                      onClick={(e) => {
                          e.stopPropagation();
                          importInputRef.current?.click();
                      }}
                  />}
                  {hasAnalyzedData && canAn.exportProgress && (
                      <AccionExpandible
                          icon={<Download className="h-5 w-5" />}
                          label="Exportar avance"
                          tone="indigo"
                          onClick={handleExportSession}
                      />
                  )}
                  {canAn.clear && <span className="mt-2 h-8 w-px shrink-0 bg-gray-200 sm:mx-1 sm:mt-0 sm:h-7" />}
                  {canAn.clear && <AccionExpandible
                      icon={<Trash2 className="h-5 w-5" />}
                      label="Limpiar todo"
                      tone="red"
                      onClick={handleClearClick}
                  />}
              </div>
          </div>
      ) : (
          <div className="mb-0 flex flex-col items-center max-sm:flex-1">
            {isProcessingFile ? (
                <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm flex flex-col items-center justify-center min-h-[300px] animate-in fade-in duration-300">
                    <div className="relative mb-6">
                        <div className="absolute inset-0 border-4 border-teal-100 rounded-full"></div>
                        <div className="absolute inset-0 border-4 border-teal-600 rounded-full border-t-transparent animate-spin"></div>
                        <div className="w-16 h-16 flex items-center justify-center bg-white rounded-full">
                            <FileSpreadsheet className="h-6 w-6 text-teal-600" />
                        </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Procesando Archivo Excel</h3>
                    <p className="text-sm text-slate-500">Validando estructura y cargando registros...</p>
                </div>
            ) : (
                <div 
                    className={`w-full max-w-2xl mx-auto border-2 border-dashed rounded-xl px-4 py-6 sm:p-10 text-center max-sm:flex-1 max-sm:flex max-sm:flex-col max-sm:justify-center transition-all cursor-pointer relative overflow-hidden group 
                        ${isDragging 
                            ? 'border-teal-500 bg-teal-50 scale-[1.02]' 
                            : 'border-teal-200 hover:border-teal-400 hover:bg-slate-50'}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) {
                            const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                            handleFileUpload(fakeEvent);
                        }
                    }}
                    onClick={triggerFileUpload}
                >
                    <div className="flex flex-col items-center gap-3 sm:gap-4 sm:group-hover:scale-105 transition-transform duration-300">
                        <div className="bg-white p-3 sm:p-4 rounded-full shadow-md group-hover:shadow-lg transition-shadow">
                            <FileSpreadsheet className="h-8 w-8 sm:h-10 sm:w-10 text-teal-600" />
                        </div>
                        
                        <div className="text-center">
                            <h3 className="text-base sm:text-lg font-bold text-gray-900">Cargar Requerimiento IPRESS</h3>
                            {/* En el celular no se arrastra: se toca. */}
                            <p className="text-sm text-gray-500 mt-1 sm:hidden">Toque para elegir su archivo Excel</p>
                            <p className="text-sm text-gray-500 mt-1 hidden sm:block">Arrastre su archivo Excel aquí o haga clic para buscar</p>
                        </div>
    
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-teal-700 font-medium bg-teal-100 px-3 py-1 rounded-full">
                            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                            <span>Formato .xlsx o .xls</span>
                        </div>
    
                        <button
                            onClick={(e) => { e.stopPropagation(); downloadTemplate(); }}
                            className="text-xs text-slate-500 hover:text-teal-600 underline py-1 sm:py-0 sm:mt-2"
                        >
                            Descargar Plantilla Estándar
                        </button>
    
                        <div className="mt-2 sm:mt-4 w-full flex flex-col sm:flex-row sm:flex-wrap gap-2.5 sm:gap-4 justify-center items-stretch sm:items-center z-10">
                            {canAn.analyze && <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    triggerFileUpload();
                                }}
                                className="bg-white border border-teal-200 text-teal-700 hover:bg-teal-50 hover:border-teal-300 w-full sm:w-auto justify-center px-4 h-11 sm:h-auto sm:py-2 font-bold text-sm rounded-xl sm:rounded-lg transition-all flex items-center gap-2 shadow-sm"
                            >
                                <Upload className="h-4 w-4" />
                                Subir Archivo
                            </button>}

                            {hasAnalyzedData && canAn.exportProgress && (
                                <button 
                                    onClick={handleExportSession}
                                    className="bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 w-full sm:w-auto justify-center px-4 h-11 sm:h-auto sm:py-2 font-bold text-sm rounded-xl sm:rounded-lg transition-all flex items-center gap-2 shadow-sm"
                                    title="Exportar avance actual para continuar en otra PC"
                                >
                                    <Download className="h-4 w-4 text-indigo-650" />
                                    <span>Exportar Avance</span>
                                </button>
                            )}

                            {canAn.importProgress && <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    importInputRef.current?.click();
                                }}
                                className="bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 w-full sm:w-auto justify-center px-4 h-11 sm:h-auto sm:py-2 font-bold text-sm rounded-xl sm:rounded-lg transition-all flex items-center gap-2 shadow-sm"
                                title="Importar avance guardado en archivo JSON"
                            >
                                <Upload className="h-4 w-4 text-emerald-600" />
                                <span>Importar Avance</span>
                            </button>}
                        </div>
                    </div>
                </div>
            )}
            
            {uploadError && !isProcessingFile && (
                <div className="w-full max-w-2xl mt-4 bg-red-50 text-red-700 p-4 rounded-xl border border-red-100 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <p className="text-sm font-medium">{uploadError}</p>
                </div>
            )}
          </div>
      )}

      {/* Item Preview */}
      {items.length > 0 && !hasAnalyzedData && (
        <div className="space-y-4 mt-4 pt-4 border-t border-dashed border-gray-200 animate-in fade-in duration-500">
          {/* Sin título: la franja de arriba ya dice de qué establecimiento es, el corte,
              cuántos registros hay y tiene «Limpiar todo». */}
          
          {/* Scrollable Table Container for Mobile */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 max-h-60 overflow-y-auto max-w-5xl mx-auto shadow-sm overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th aria-sort={ariaSort(previewSort.dirOf('code'))} className="px-3 py-2 text-left font-bold text-gray-600 text-xs uppercase tracking-wider whitespace-nowrap"><SortButton label="Código" dir={previewSort.dirOf('code')} onClick={() => previewSort.toggle('code')} /></th>
                  <th aria-sort={ariaSort(previewSort.dirOf('name'))} className="px-3 py-2 text-left font-bold text-gray-600 text-xs uppercase tracking-wider min-w-[150px]"><SortButton label="Descripción" dir={previewSort.dirOf('name')} onClick={() => previewSort.toggle('name')} /></th>
                  <th aria-sort={ariaSort(previewSort.dirOf('stock'))} className="px-3 py-2 text-right font-bold text-gray-600 text-xs uppercase tracking-wider whitespace-nowrap"><SortButton label="Stock" dir={previewSort.dirOf('stock')} onClick={() => previewSort.toggle('stock')} /></th>
                  <th aria-sort={ariaSort(previewSort.dirOf('months'))} className="px-3 py-2 text-center font-bold text-gray-600 text-xs uppercase tracking-wider whitespace-nowrap"><SortButton label="Meses" dir={previewSort.dirOf('months')} onClick={() => previewSort.toggle('months')} /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {previewSort.sorted.map((item, index) => (
                  <tr key={`${item.id}-${index}`} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-xs font-mono text-gray-500 font-medium w-24 whitespace-nowrap">{item.id}</td>
                    <td className="px-3 py-1.5 text-gray-900 truncate max-w-[150px] sm:max-w-[300px] text-xs font-medium" title={item.name}>{item.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-gray-700 whitespace-nowrap">{item.currentStock.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-center text-xs text-gray-500 whitespace-nowrap">
                      {item.monthlyConsumption.filter(v => v > 0).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center pt-2">
            <button
              onClick={handleExecuteClick}
              disabled={isAnalyzing || !canAn.analyze}
              title={canAn.analyze ? undefined : 'Su rol no puede ejecutar el análisis'}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 bg-teal-600 text-white font-bold text-sm rounded-full hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
            >
              {isAnalyzing ? (
                <>
                  <Activity className="h-4 w-4 animate-spin" />
                  Calculando CPA...
                </>
              ) : (
                <>
                  <Activity className="h-4 w-4" />
                  Ejecutar Análisis
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* ANALYSIS CONFIGURATION MODAL (EXCLUSIONS) */}
    {isVaccineModalOpen && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                {/* Modal Header */}
                <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-teal-900 p-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-xl backdrop-blur-sm text-teal-300">
                            <Settings2 className="h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="text-base sm:text-lg font-bold text-white leading-tight">
                                Configuración de Análisis
                            </h3>
                            <p className="text-xs text-teal-200/80">
                                Criterios de exclusión y depuración de ítems
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsVaccineModalOpen(false)}
                        className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5 sm:p-6 space-y-4">
                    <p className="text-xs text-gray-500 leading-relaxed">
                        Seleccione las opciones de exclusión que se aplicarán a los <strong className="text-gray-800">{items.length} ítems</strong> cargados antes de calcular el requerimiento:
                    </p>

                    <div className="space-y-3">
                        {/* Option 1: Exclude Vaccines */}
                        <div
                            onClick={() => setExcludeVaccinesSelection(!excludeVaccinesSelection)}
                            className={`w-full flex items-start justify-between p-4 rounded-xl transition-all cursor-pointer border-2 select-none ${
                                excludeVaccinesSelection 
                                ? 'bg-teal-50/70 border-teal-500 shadow-sm ring-1 ring-teal-500/20' 
                                : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-xl transition-colors mt-0.5 ${
                                    excludeVaccinesSelection ? 'bg-teal-500 text-white shadow-sm' : 'bg-gray-100 text-gray-400'
                                }`}>
                                     <Syringe className="h-5 w-5" />
                                </div>
                                <div className="text-left">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-bold text-sm ${excludeVaccinesSelection ? 'text-teal-950' : 'text-gray-700'}`}>
                                            Excluir vacunas, toxoides y diluyentes
                                        </span>
                                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-200">
                                            Recomendado
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Omite los productos cuyo nombre dice VACUNA, VAC., TOXOIDE o DILUYENTE.
                                    </p>
                                </div>
                            </div>
                            <div className={`h-6 w-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ml-2 mt-1 ${
                                excludeVaccinesSelection ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300 bg-white'
                            }`}>
                                {excludeVaccinesSelection && <Check className="h-4 w-4 stroke-[3]" />}
                            </div>
                        </div>

                        {/* Option 2: Exclude Custom Establishment List */}
                        <div
                            onClick={() => setExcludeCustomListSelection(!excludeCustomListSelection)}
                            className={`w-full flex items-start justify-between p-4 rounded-xl transition-all cursor-pointer border-2 select-none ${
                                excludeCustomListSelection 
                                ? 'bg-rose-50/70 border-rose-500 shadow-sm ring-1 ring-rose-500/20' 
                                : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-xl transition-colors mt-0.5 ${
                                    excludeCustomListSelection ? 'bg-rose-500 text-white shadow-sm' : 'bg-gray-100 text-gray-400'
                                }`}>
                                     <Ban className="h-5 w-5" />
                                </div>
                                <div className="text-left">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`font-bold text-sm ${excludeCustomListSelection ? 'text-rose-950' : 'text-gray-700'}`}>
                                            Excluir Lista Personalizada del Establecimiento
                                        </span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                            customExclusionCount > 0 
                                                ? 'bg-rose-100 text-rose-800 border-rose-200' 
                                                : 'bg-gray-100 text-gray-600 border-gray-200'
                                        }`}>
                                            {customExclusionCount} {customExclusionCount === 1 ? 'medicamento' : 'medicamentos'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {customExclusionCount > 0 
                                            ? `Se excluirán automáticamente los medicamentos configurados en la Lista de Exclusiones de ${importedEstablishmentName || user?.facilityData?.name || 'este establecimiento'}.`
                                            : `No hay medicamentos registrados en la lista de exclusión de este establecimiento (${importedCodEess || user?.facilityData?.code || user?.personnelData?.facilityCode || 'Sin código'}).`
                                        }
                                    </p>
                                </div>
                            </div>
                            <div className={`h-6 w-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ml-2 mt-1 ${
                                excludeCustomListSelection ? 'bg-rose-600 border-rose-600 text-white' : 'border-gray-300 bg-white'
                            }`}>
                                {excludeCustomListSelection && <Check className="h-4 w-4 stroke-[3]" />}
                            </div>
                        </div>
                    </div>

                    {/* Summary Info */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4 text-slate-500" />
                            <span>Total ítems en archivo: <strong className="text-slate-800 font-bold">{items.length}</strong></span>
                        </div>
                        <div className="text-right">
                            <span className="text-teal-700 font-semibold">
                                {excludeVaccinesSelection || (excludeCustomListSelection && customExclusionCount > 0) ? 'Filtros activos' : 'Sin exclusiones'}
                            </span>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button 
                            onClick={() => setIsVaccineModalOpen(false)}
                            className="flex-1 py-2.5 px-4 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={handleRunAnalysis}
                            className="flex-1 py-2.5 px-4 text-sm font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                        >
                            <Play className="h-4 w-4 fill-current" />
                            Ejecutar Análisis
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* MANDATORY DATE MODAL */}
    {isDateModalOpen && (
      <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border-t-4 border-teal-600">
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            
            <div className="bg-teal-100 p-4 rounded-full mb-4">
               <Calendar className="h-8 w-8 text-teal-700" />
            </div>

            <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">
              Confirme la Fecha del Reporte
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 mb-6">
              Para realizar un cálculo preciso, el sistema necesita saber a qué mes corresponde la última columna de datos.
            </p>

            <div className="w-full bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6 shadow-sm">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-center gap-1 mb-4">
                    Mes de Corte (Mes {detectedMonthsCount})
                </label>
                <input 
                    type="month" 
                    value={referenceDate}
                    onChange={(e) => setReferenceDate(e.target.value)}
                    className="w-full text-center px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-gray-900 font-bold text-lg shadow-sm bg-white hover:bg-gray-50 transition-colors cursor-pointer cursor-text"
                />
            </div>
            
            <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex gap-3 text-left mb-6">
               <AlertCircle className="h-5 w-5 text-blue-600 shrink-0" />
               <p className="text-xs text-blue-800">
                  <strong>Nota:</strong> Si descargó el reporte hoy, la fecha por defecto suele ser correcta.
               </p>
            </div>

            <button
              onClick={handleConfirmDate}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-all shadow-md transform hover:scale-[1.02]"
            >
              <Check className="h-5 w-5" />
              Confirmar y Cargar Datos
            </button>
          </div>
        </div>
      </div>
    )}

    {/* OVERWRITE WARNING MODAL */}
    {showOverwriteWarning && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                <div className="bg-amber-500 p-4 flex justify-between items-center text-white">
                    <div className="flex items-center gap-2">
                         <AlertTriangle className="h-6 w-6" />
                         <h3 className="font-bold text-lg">¡Atención! Datos no guardados</h3>
                    </div>
                    <button onClick={() => setShowOverwriteWarning(false)} className="hover:bg-amber-600 p-1 rounded transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                
                <div className="p-6">
                    <p className="text-gray-700 mb-4 text-sm leading-relaxed">
                        Actualmente hay un análisis realizado en pantalla. 
                        <br/><br/>
                        <strong>Si sube un nuevo archivo, los resultados actuales se perderán permanentemente</strong> si no los ha exportado (PDF/Excel).
                    </p>
                    <p className="text-gray-500 text-xs italic mb-6">
                        ¿Desea continuar y sobrescribir los datos actuales?
                    </p>
                    
                    <div className="flex gap-3 justify-end">
                        <button 
                            onClick={() => setShowOverwriteWarning(false)}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={confirmOverwrite}
                            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-bold text-sm hover:bg-amber-700 transition-colors shadow-sm"
                        >
                            Continuar y Sobrescribir
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* REANALYSIS WARNING MODAL */}
    {showReanalysisWarning && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                <div className="bg-amber-500 p-4 flex justify-between items-center text-white">
                    <div className="flex items-center gap-2">
                         <AlertTriangle className="h-6 w-6" />
                         <h3 className="font-bold text-lg">Reiniciar Análisis</h3>
                    </div>
                    <button onClick={() => setShowReanalysisWarning(false)} className="hover:bg-amber-600 p-1 rounded transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                
                <div className="p-6">
                    <p className="text-gray-700 mb-4 text-sm leading-relaxed">
                        Ya existe un análisis generado. Si vuelve a ejecutarlo:
                    </p>
                    <ul className="list-disc list-inside text-xs text-amber-800 bg-amber-50 p-3 rounded border border-amber-100 mb-6 space-y-1">
                        <li>Se perderá el <strong>progreso de la auditoría</strong>.</li>
                        <li>Se restablecerán las <strong>validaciones manuales</strong>.</li>
                        <li>Los datos volverán a su estado calculado original.</li>
                    </ul>
                    <p className="text-gray-500 text-xs italic mb-6">
                        ¿Está seguro que desea volver a calcular y perder los cambios actuales?
                    </p>
                    
                    <div className="flex gap-3 justify-end">
                        <button 
                            onClick={() => setShowReanalysisWarning(false)}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={confirmReanalysis}
                            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-bold text-sm hover:bg-amber-700 transition-colors shadow-sm flex items-center gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Sí, Reiniciar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* CLEAR ALL WARNING MODAL */}
    {showClearWarning && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                <div className="bg-red-600 p-4 flex justify-between items-center text-white">
                    <div className="flex items-center gap-2">
                         <Trash2 className="h-6 w-6" />
                         <h3 className="font-bold text-lg">Eliminar Datos</h3>
                    </div>
                    <button onClick={() => setShowClearWarning(false)} className="hover:bg-red-700 p-1 rounded transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                
                <div className="p-6">
                    <p className="text-gray-700 mb-4 text-sm leading-relaxed">
                        Esta acción eliminará <strong>todos los items cargados</strong> y el <strong>análisis generado</strong> actualmente.
                    </p>
                    <p className="text-red-600 font-bold text-xs mb-6 bg-red-50 p-3 rounded border border-red-100 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Esta acción no se puede deshacer.
                    </p>
                    
                    <div className="flex gap-3 justify-end">
                        <button 
                            onClick={() => setShowClearWarning(false)}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={confirmClearAll}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-sm hover:bg-red-700 transition-colors shadow-sm"
                        >
                            Sí, Eliminar Todo
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )}
    </>
  );
};
