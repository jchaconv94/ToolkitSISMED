
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnalyzedMedication, StockStatus, QuickFilterOption, DashboardViewMode } from '../types';
import { 
  Zap, 
  TrendingUp, 
  FileSpreadsheet,
  CheckCircle,
  Filter,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertOctagon,
  Maximize2,
  Minimize2,
  Layout,
  ListFilter,
  ShoppingCart,
  Timer,
  ChevronDown,
  Play
} from 'lucide-react';
import { utils, writeFile } from 'xlsx';
import { ConsumptionModal } from './ConsumptionModal';

interface AnalysisTableProps {
  medications: AnalyzedMedication[]; // The FILTERED list to display
  allMedications: AnalyzedMedication[]; // The FULL list for generating filter options
  referenceDate?: string;
  onMedicationUpdate: (id: string, quantity: number, mode?: 'ADJUSTED' | 'SIMPLE', excludedIndices?: number[]) => void;
  
  // Lifted State Props
  searchTerm: string;
  onSearchChange: (term: string) => void;
  activeFilters: Record<string, string[]>;
  onFilterChange: (filters: Record<string, string[]>) => void;
  
  // Action Handler
  onDownloadReport: () => void;

  // New Item-Level Review Props
  reviewedIds: Set<string>;
  onToggleReview: (id: string, isReviewed: boolean) => void;

  // Full Screen Props
  reviewProgress: number;
  reviewedCount: number;
  totalToReview: number;
  
  // Controlled Full Screen State
  isFullScreen: boolean;
  onToggleFullScreen: (isFull: boolean) => void;

  // Quick Filter Props
  quickFilter: QuickFilterOption;
  onQuickFilterChange: (filter: QuickFilterOption) => void;
  
  // Additional Items Props
  additionalItemsCount?: number;
  onOpenAdditionalModal?: () => void;

  // View Mode / Horizon Prop
  viewMode?: DashboardViewMode;
}

// Columns that can be filtered
type FilterKey = 'ff' | 'medtip' | 'medpet' | 'medest' | 'status' | 'currentStock' | 'cpm' | 'rawCpm' | 'monthsOfProvision' | 'anomalyDetails' | 'quantityToOrder' | 'isSporadic';

// --- HELPER: Recalculate Status Dynamically ---
const calculateDynamicMetrics = (item: AnalyzedMedication) => {
    let activeCpm = 0;
    const excludedIndices = item.excludedIndices || [];
    let mode = item.selectedCpaMode || 'ADJUSTED';

    if (excludedIndices.length === 0) {
        activeCpm = mode === 'SIMPLE' ? item.rawCpm : item.cpm;
    } else {
        // Manual Recalculation
        const history = item.originalHistory;
        const threshold = item.spikeThreshold || 0;
        const isSporadic = item.isSporadic;
        
        const valuesToAverage: number[] = [];

        history.forEach((val, idx) => {
            if (val === 0) return; // Ignore zeros
            if (excludedIndices.includes(idx)) return; // User excluded

            if (mode === 'SIMPLE') {
                valuesToAverage.push(val);
            } else {
                // ADJUSTED MODE
                if (isSporadic) {
                    // Sporadic: No spike exclusion, just average active months
                    valuesToAverage.push(val);
                } else {
                    // Normal: Exclude spikes
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
    
    // Calculate Months
    const activeMonths = activeCpm > 0 
        ? item.currentStock / activeCpm 
        : (item.currentStock > 0 ? Infinity : 0);

    const roundedMonths = isFinite(activeMonths) ? parseFloat(activeMonths.toFixed(1)) : Infinity;

    // Calculate Status
    let activeStatus = StockStatus.NORMOSTOCK;
    if (item.currentStock === 0) {
        activeStatus = StockStatus.DESABASTECIDO;
    } else if (activeCpm === 0 && item.currentStock > 0) {
        activeStatus = StockStatus.SIN_ROTACION;
    } else if (roundedMonths > 6) {
        activeStatus = StockStatus.SOBRESTOCK;
    } else if (roundedMonths >= 2 && roundedMonths <= 6) {
        activeStatus = StockStatus.NORMOSTOCK;
    } else {
        activeStatus = StockStatus.SUBSTOCK;
    }

    return { activeCpm, activeMonths, activeStatus };
};

export const AnalysisTable: React.FC<AnalysisTableProps> = React.memo(({ 
  medications, 
  allMedications, 
  referenceDate, 
  onMedicationUpdate,
  searchTerm,
  onSearchChange,
  activeFilters,
  onFilterChange,
  onDownloadReport,
  reviewedIds,
  onToggleReview,
  reviewProgress,
  reviewedCount,
  totalToReview,
  isFullScreen,
  onToggleFullScreen,
  quickFilter,
  onQuickFilterChange,
  additionalItemsCount = 0,
  onOpenAdditionalModal,
  viewMode = 'PROJECTED_ADJUSTED'
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMedicationId, setSelectedMedicationId] = useState<string | null>(null);
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
  const [isMainFilterOpen, setIsMainFilterOpen] = useState(false); // State for the main header filter dropdown
  
  const itemsPerPage = isFullScreen ? 15 : 10; // Show more items in full screen
  const mainFilterRef = useRef<HTMLDivElement>(null); // Ref for main header filter
  const mainFilterDropdownRef = useRef<HTMLDivElement>(null); // Ref for main header filter dropdown

  // 'medications' prop is already filtered. We just handle pagination here.
  const filteredItems = medications;

  // Pagination logic
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = filteredItems.slice(startIndex, startIndex + itemsPerPage);

  // Close dropdowns when clicking outside and update position
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Main header filter
      if (
          mainFilterRef.current && !mainFilterRef.current.contains(event.target as Node) &&
          (!mainFilterDropdownRef.current || !mainFilterDropdownRef.current.contains(event.target as Node))
      ) {
          setIsMainFilterOpen(false);
      }
    };

    const updatePosition = () => {
        if (isMainFilterOpen && mainFilterRef.current && mainFilterDropdownRef.current) {
            const rect = mainFilterRef.current.getBoundingClientRect();
            const dropdownWidth = 224; // w-56
            const left = rect.left + dropdownWidth > window.innerWidth 
                ? window.innerWidth - dropdownWidth - 16 
                : rect.left;
            
            mainFilterDropdownRef.current.style.top = `${rect.bottom + 4}px`;
            mainFilterDropdownRef.current.style.left = `${left}px`;
        }
    };

    document.addEventListener("mousedown", handleClickOutside);
    if (isMainFilterOpen) {
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        // Initial position update
        updatePosition();
    }

    return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
    };
  }, [isMainFilterOpen]);

  // NOTE: Manual Escape listener removed. 
  // We now rely on the 'fullscreenchange' event in the parent component to handle exit.

  // Get Unique Values for Filters (Using ALL medications to show all options)
  const getUniqueValues = (key: FilterKey): { value: string; count: number }[] => {
    const values = allMedications.map(m => {
        if (key === 'isSporadic') {
             return m.isSporadic ? "Baja Rotación" : "Rotación Normal";
        }
        return String((m as any)[key] || '-');
    });
    
    const unique = Array.from(new Set(values)).sort();
    // Count occurrences in the FULL list
    return unique.map((val: string) => ({
      value: val,
      count: values.filter(v => v === val).length
    }));
  };

  const handleStartAnalysis = () => {
    const pendingMedication = filteredItems.find(item => {
        const rawCpm = item.rawCpm || 0;
        const rawStock = item.currentStock || 0;
        const rawMonths = rawCpm > 0 ? rawStock / rawCpm : (rawStock > 0 ? Infinity : 0);
        const isRawOverstock = rawMonths > 6 || (rawCpm === 0 && rawStock > 0);

        const isOverstock = item.status === StockStatus.SOBRESTOCK;
        const isNoRotation = item.status === StockStatus.SIN_ROTACION;
        const needsReview = (!isOverstock && !isNoRotation) || !isRawOverstock || item.quantityToOrder > 0;
        const isReviewed = reviewedIds.has(item.id);
        return needsReview && !isReviewed;
    });

    if (pendingMedication) {
        setSelectedMedicationId(pendingMedication.id);
    } else if (filteredItems.length > 0) {
        setSelectedMedicationId(filteredItems[0].id);
    }
  };

  const handleFilterToggle = (key: string, value: string) => {
    const current = activeFilters[key] || [];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    
    const newFilters = { ...activeFilters };
    if (updated.length === 0) {
      delete newFilters[key];
    } else {
      newFilters[key] = updated;
    }
    
    onFilterChange(newFilters);
    setCurrentPage(1); // Reset to page 1 on filter change
  };

  const clearFilter = (key: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[key];
    onFilterChange(newFilters);
  };

  // Ensure current page is valid if items change
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
        setCurrentPage(1);
    }
  }, [filteredItems.length, totalPages, currentPage]);

  // --- SMART NAVIGATION LOGIC ---
  const currentIndex = selectedMedicationId 
    ? filteredItems.findIndex(m => m.id === selectedMedicationId) 
    : -1;

  // 1. Absolute Next/Prev (for manual arrows)
  const prevItemId = currentIndex > 0 ? filteredItems[currentIndex - 1].id : null;
  const nextItemId = currentIndex >= 0 && currentIndex < filteredItems.length - 1 
      ? filteredItems[currentIndex + 1].id 
      : null;

  // 2. Smart "Next To Review" (Skip to next item that needs review and is NOT Reviewed)
  // Look ahead from current index
  const nextReviewItem = currentIndex >= 0 
      ? filteredItems.slice(currentIndex + 1).find(m => {
          const rawCpm = m.rawCpm || 0;
          const rawStock = m.currentStock || 0;
          const rawMonths = rawCpm > 0 ? rawStock / rawCpm : (rawStock > 0 ? Infinity : 0);
          const isRawOverstock = rawMonths > 6 || (rawCpm === 0 && rawStock > 0);

          const isOverstock = m.status === StockStatus.SOBRESTOCK;
          const isNoRotation = m.status === StockStatus.SIN_ROTACION;
          const itemNeedsReview = (!isOverstock && !isNoRotation) || !isRawOverstock || m.quantityToOrder > 0;
          return itemNeedsReview && !reviewedIds.has(m.id);
        })
      : null;

  const selectedMedication = selectedMedicationId 
    ? filteredItems.find(m => m.id === selectedMedicationId) || null 
    : null;


  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleExportExcel = () => {
    const exportData = filteredItems.map(m => {
      const activeCpm = m.displayCpm ?? m.cpm;
      const activeMonths = m.monthsOfProvision;
      const activeStatus = m.status;
      const totalConsumption = m.originalHistory ? m.originalHistory.reduce((a, b) => a + b, 0) : 0;
      
      const row: any = {
        CODIGO: m.id,
        MEDICAMENTO: m.name,
        FF: m.ff || '-',
        TIPO: m.medtip || '-',
        PET: m.medpet || '-',
        EST: m.medest || '-',
      };
      if (m.originalHistory && m.originalHistory.length > 0) {
        m.originalHistory.forEach((val, idx) => {
            row[`MES_${String(idx + 1).padStart(2, '0')}`] = val;
        });
      }
      row.PRECIO_UNIT = m.unitPrice;
      row.STOCK_ACTUAL = m.currentStock;
      row.SUMA_CONSUMO = totalConsumption;
      
      // Export Dynamic Values
      row.CPA_UTILIZADO = activeCpm;
      row.MESES_DISPONIBLES = isFinite(activeMonths) ? activeMonths : "Infinito";
      row.ESTADO_CALCULADO = activeStatus;

      row.ES_BAJA_ROTACION = m.isSporadic ? "SI" : "NO";
      row.TIENE_PICOS = m.hasSpikes ? "SI" : "NO";
      row.RIESGO_VENC = m.expirationRisk;
      row.REQUERIMIENTO = m.quantityToOrder;
      row.INVERSION_EST = m.estimatedInvestment;
      row.DETALLE_AJUSTE = m.anomalyDetails || "-";
      row.MODO_CPA_SELECCIONADO = m.selectedCpaMode || "AUTO";
      row.REVISADO = reviewedIds.has(m.id) ? "SI" : "NO";

      return row;
    });

    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Requerimiento_IPRESS_CPA");
    const wscols = [
      {wch: 12}, {wch: 40}, {wch: 15}, {wch: 8}, {wch: 8}, {wch: 8},
      {wch: 8}, {wch: 8}, {wch: 8}, {wch: 8}, {wch: 8}, {wch: 8}, 
      {wch: 8}, {wch: 8}, {wch: 8}, {wch: 8}, {wch: 8}, {wch: 8},
      {wch: 12}, {wch: 12}, {wch: 12}, {wch: 15}, 
      {wch: 15}, {wch: 15}, // CPA & Meses
      {wch: 12}, {wch: 12}, {wch: 10},
      {wch: 12}, {wch: 20}, {wch: 12}, {wch: 15}, {wch: 15}, {wch: 50}, {wch: 15}, {wch: 10}
    ];
    ws['!cols'] = wscols;
    writeFile(wb, `Requerimiento_IPRESS_CPA_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const getStatusBadge = (status: StockStatus) => {
    switch (status) {
      case StockStatus.DESABASTECIDO:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-800 border border-red-200 whitespace-nowrap">Desabastecido</span>;
      case StockStatus.SUBSTOCK:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200 whitespace-nowrap">SubStock</span>;
      case StockStatus.NORMOSTOCK:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">NormoStock</span>;
      case StockStatus.SOBRESTOCK:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-800 border border-indigo-200 whitespace-nowrap">SobreStock</span>;
      case StockStatus.SIN_ROTACION:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-800 border border-gray-200 whitespace-nowrap">Sin Rotación</span>;
      default:
        return null;
    }
  };

  // Helper to render sortable/filterable headers
  const RenderHeader = ({ 
      label, 
      field, 
      align = 'left',
      className = '',
      textColor = 'text-gray-500'
  }: { 
      label: string, 
      field?: FilterKey, 
      align?: 'left'|'center'|'right',
      className?: string,
      textColor?: string
  }) => {
    const isActive = field && activeFilters[field]?.length > 0;
    const isOpen = openFilterDropdown === field;
    const triggerRef = useRef<HTMLTableHeaderCellElement>(null);
    const localDropdownRef = useRef<HTMLDivElement>(null);
    const [menuStyles, setMenuStyles] = useState<React.CSSProperties>({});
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setSearchTerm('');
        }
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen && 
                localDropdownRef.current && !localDropdownRef.current.contains(event.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
                setOpenFilterDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        const updatePosition = () => {
            if (isOpen && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const dropdownWidth = 224; // w-56 is 14rem = 224px
                const left = rect.left + dropdownWidth > window.innerWidth 
                    ? window.innerWidth - dropdownWidth - 16 
                    : rect.left;
                
                setMenuStyles({
                    top: rect.bottom + 4,
                    left: left,
                    maxHeight: window.innerHeight - rect.bottom - 20
                });
            }
        };

        if (isOpen) {
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
        }

        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [isOpen]);
    
    return (
        <th ref={triggerRef} scope="col" className={`px-2 py-2 2xl:px-3 2xl:py-3 text-${align} text-xs font-bold ${textColor} uppercase tracking-wider relative ${className}`}>
            <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
                <span className="whitespace-nowrap">{label}</span>
                {field && (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpenFilterDropdown(isOpen ? null : field);
                        }}
                        className={`p-0.5 rounded hover:bg-gray-200 transition-colors ${isActive ? 'bg-teal-100 text-teal-700' : 'text-gray-400'}`}
                    >
                        <Filter className="h-3 w-3" />
                    </button>
                )}
            </div>

            {/* Dropdown Menu */}
            {isOpen && field && createPortal(
                <div ref={localDropdownRef} className="fixed z-[120000] bg-white border border-gray-200 rounded-lg shadow-xl w-56 p-2 text-left font-normal normal-case flex flex-col" style={menuStyles}>
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-100 shrink-0">
                        <span className="text-xs font-bold text-gray-700">Filtrar por {label}</span>
                        {isActive && (
                            <button onClick={() => clearFilter(field)} className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1">
                                <X className="h-3 w-3" /> Borrar
                            </button>
                        )}
                    </div>
                    <div className="relative mb-2 shrink-0">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="w-full pl-7 pr-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                    <div className="overflow-y-auto space-y-1 flex-1 min-h-0 custom-scrollbar">
                        {getUniqueValues(field)
                            .filter(opt => opt.value.toLowerCase().includes(searchTerm.toLowerCase()))
                            .map((opt) => (
                            <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-xs text-gray-600">
                                <input 
                                    type="checkbox" 
                                    className="h-4 w-4 rounded border border-gray-300 text-teal-600 focus:ring-teal-500 bg-white accent-teal-600 cursor-pointer shadow-sm"
                                    style={{ colorScheme: 'light' }}
                                    checked={activeFilters[field]?.includes(opt.value) || false}
                                    onChange={() => handleFilterToggle(field, opt.value)}
                                />
                                <span className="flex-1 truncate">{opt.value}</span>
                                <span className="text-gray-400 text-[10px]">({opt.count})</span>
                            </label>
                        ))}
                        {getUniqueValues(field).filter(opt => opt.value.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                            <div className="text-center py-2 text-gray-400 text-xs italic">
                                No hay resultados
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </th>
    );
  };

  // Main Filter Display Label Logic
  const getFilterLabel = (filter: QuickFilterOption) => {
      switch(filter) {
          case 'PENDING': return 'Pendientes';
          case 'REQ_POSITIVE': return 'Con Req.';
          case 'REQ_ZERO': return 'Sin Req.';
          default: return 'Todos';
      }
  };

  const containerClasses = isFullScreen 
    ? "fixed inset-0 z-[105000] bg-white flex flex-col h-screen w-screen animate-in fade-in duration-200"
    : "bg-white shadow-lg rounded-xl border border-gray-200 overflow-visible flex flex-col transition-colors duration-300";

  return (
    <>
    <div className={containerClasses}>
      {/* ... (Header code remains unchanged) ... */}
      
      {/* FULL SCREEN DEDICATED HEADER */}
      {isFullScreen && (
          <div className="bg-gray-900 text-white px-4 py-2 sm:px-6 sm:py-3 flex items-center justify-between shadow-md shrink-0 border-b border-gray-800 transition-all duration-300">
              
              {/* LEFT SIDE: Title + Search + Actions - Optimized for fluid width */}
              <div className="flex items-center gap-3 lg:gap-6 flex-1 min-w-0">
                  
                  {/* Branding/Title - Hide text on mobile, Compact on Tablet */}
                  <div className="flex items-center gap-2 shrink-0">
                      <div className="bg-teal-500/20 p-1.5 sm:p-2 rounded-lg">
                           <Layout className="h-4 w-4 sm:h-5 sm:w-5 text-teal-400" />
                      </div>
                      <div className="hidden sm:block">
                          <h2 className="font-bold text-sm sm:text-base lg:text-lg leading-none whitespace-nowrap">Modo Auditoría</h2>
                          <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{filteredItems.length} ítems</p>
                      </div>
                  </div>

                  {/* Search Bar - Responsive Flex Width */}
                  <div className="relative flex-1 max-w-[140px] sm:max-w-[200px] md:max-w-xs lg:max-w-md ml-0 sm:ml-2">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-500" />
                      <input 
                        type="text" 
                        placeholder="Buscar..." 
                        className="pl-8 sm:pl-9 pr-3 py-1.5 sm:py-2 text-xs sm:text-sm bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none w-full text-white placeholder-gray-500 transition-all"
                        value={searchTerm}
                        onChange={(e) => {
                            onSearchChange(e.target.value);
                            setCurrentPage(1); 
                        }}
                        autoFocus
                      />
                  </div>

                  {/* Action Buttons Container - Hide Text on Laptops (XL breakpoint for full text) */}
                  <div className="flex items-center gap-2 relative" ref={mainFilterRef}>
                      <button 
                        onClick={() => setIsMainFilterOpen(!isMainFilterOpen)}
                        className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition-all ${
                            quickFilter !== 'ALL'
                            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' 
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
                        }`}
                        title="Filtrar Lista"
                      >
                         <ListFilter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                         <span className="hidden xl:inline">{getFilterLabel(quickFilter) === 'Pendientes' ? 'Pendientes de Validar' : getFilterLabel(quickFilter)}</span>
                         <span className="inline xl:hidden">{getFilterLabel(quickFilter)}</span>
                         <ChevronDown className={`h-3 w-3 transition-transform ${isMainFilterOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isMainFilterOpen && createPortal(
                          <div ref={mainFilterDropdownRef} className="fixed z-[120000] bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-gray-900 animate-in fade-in zoom-in-95 duration-100 w-56" style={{
                              top: mainFilterRef.current ? mainFilterRef.current.getBoundingClientRect().bottom + 4 : 0,
                              left: mainFilterRef.current 
                                ? (mainFilterRef.current.getBoundingClientRect().left + 224 > window.innerWidth 
                                    ? window.innerWidth - 224 - 16 
                                    : mainFilterRef.current.getBoundingClientRect().left) 
                                : 0,
                          }}>
                              <div className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider">
                                  Vistas Disponibles
                              </div>
                              <button 
                                  onClick={() => { onQuickFilterChange('ALL'); setIsMainFilterOpen(false); }}
                                  className={`w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-gray-50 transition-colors flex items-center justify-between ${quickFilter === 'ALL' ? 'text-teal-600 bg-teal-50' : 'text-gray-700'}`}
                              >
                                  Todos
                                  {quickFilter === 'ALL' && <CheckCircle className="h-3.5 w-3.5" />}
                              </button>
                              <button 
                                  onClick={() => { onQuickFilterChange('PENDING'); setIsMainFilterOpen(false); }}
                                  className={`w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-gray-50 transition-colors flex items-center justify-between ${quickFilter === 'PENDING' ? 'text-amber-600 bg-amber-50' : 'text-gray-700'}`}
                              >
                                  Pendientes de Validar
                                  {quickFilter === 'PENDING' && <CheckCircle className="h-3.5 w-3.5" />}
                              </button>
                              <div className="border-t border-gray-100 my-1"></div>
                              <button 
                                  onClick={() => { onQuickFilterChange('REQ_POSITIVE'); setIsMainFilterOpen(false); }}
                                  className={`w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-gray-50 transition-colors flex items-center justify-between ${quickFilter === 'REQ_POSITIVE' ? 'text-teal-600 bg-teal-50' : 'text-gray-700'}`}
                              >
                                  Con Requerimiento ({'>'}0)
                                  {quickFilter === 'REQ_POSITIVE' && <CheckCircle className="h-3.5 w-3.5" />}
                              </button>
                              <button 
                                  onClick={() => { onQuickFilterChange('REQ_ZERO'); setIsMainFilterOpen(false); }}
                                  className={`w-full text-left px-4 py-2.5 text-xs font-medium hover:bg-gray-50 transition-colors flex items-center justify-between ${quickFilter === 'REQ_ZERO' ? 'text-gray-800 bg-gray-100' : 'text-gray-700'}`}
                              >
                                  Sin Requerimiento (0)
                                  {quickFilter === 'REQ_ZERO' && <CheckCircle className="h-3.5 w-3.5" />}
                              </button>
                          </div>,
                          document.body
                      )}
                  </div>
                  {/* ... (Additional Items Button) ... */}
                   {onOpenAdditionalModal && (
                      <button 
                        onClick={onOpenAdditionalModal}
                        className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-bold transition-all ml-2 ${
                            additionalItemsCount > 0
                            ? 'bg-purple-900/50 text-purple-300 border border-purple-700 hover:bg-purple-900 shadow-[0_0_10px_rgba(168,85,247,0.2)]' 
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
                        }`}
                        title="Gestionar Adicionales"
                      >
                         <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                         <span className="hidden xl:inline">Adicionales</span>
                         {additionalItemsCount > 0 && (
                             <span className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1 font-bold">
                                 {additionalItemsCount}
                             </span>
                         )}
                      </button>
                  )}
              </div>

              {/* RIGHT SIDE: Progress + Exit */}
              <div className="flex items-center gap-3 sm:gap-6 ml-3 shrink-0">
                  <button 
                      onClick={handleStartAnalysis}
                      className="flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 bg-teal-600 hover:bg-teal-500 hover:scale-[1.05] active:scale-95 text-white rounded-lg transition-all shadow-[0_0_12px_rgba(20,184,166,0.3)] shrink-0 group animate-pulse"
                      title="Comenzar análisis del primer ítem pendiente"
                  >
                      <Play className="h-4 w-4 fill-current group-hover:scale-110 transition-transform" />
                  </button>

                  <div className="hidden md:flex items-center gap-3 sm:gap-6">
                      <div className="text-right hidden lg:block">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-0.5">
                              Progreso
                          </div>
                          <div className="flex items-center justify-end gap-2">
                              <span className={`text-lg font-black ${reviewProgress === 100 ? 'text-teal-400' : 'text-amber-400'}`}>
                                  {reviewProgress}%
                              </span>
                              <span className="text-[10px] text-gray-500">
                                  ({reviewedCount}/{totalToReview})
                              </span>
                          </div>
                      </div>
                      <div className="w-16 sm:w-24 lg:w-32 h-1.5 sm:h-2 bg-gray-800 rounded-full overflow-hidden">
                           <div 
                              className={`h-full transition-all duration-500 ${reviewProgress === 100 ? 'bg-teal-500' : 'bg-amber-500'}`}
                              style={{ width: `${reviewProgress}%` }}
                           />
                      </div>
                  </div>

                  <button 
                      onClick={() => onToggleFullScreen(false)}
                      className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs sm:text-sm font-medium transition-colors text-gray-300 hover:text-white border border-gray-700"
                  >
                      <Minimize2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span className="hidden sm:inline">Salir</span>
                  </button>
              </div>
          </div>
      )}

      {/* FILTER ACTIVE BANNER (For Normal View) */}
      {!isFullScreen && quickFilter !== 'ALL' && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between animate-in slide-in-from-top-2">
              <span className="text-amber-800 text-xs font-bold flex items-center gap-2">
                  <ListFilter className="h-4 w-4" />
                  Filtro activo: {getFilterLabel(quickFilter)} ({filteredItems.length} ítems)
              </span>
              <button onClick={() => onQuickFilterChange('ALL')} className="text-xs text-amber-900 underline hover:text-amber-700">
                  Mostrar Todos
              </button>
          </div>
      )}

      {/* STANDARD HEADER (Hidden in Full Screen) */}
      {!isFullScreen && (
        <div className="px-4 py-4 border-b border-gray-200 bg-gray-50 flex flex-col gap-4">
            {/* Top Row: Title */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h3 className="text-lg font-bold text-gray-900 flex flex-wrap items-center gap-2">
                    Matriz de Requerimiento
                    <span className="text-xs font-normal text-gray-500 bg-white px-2 py-1 rounded border border-gray-200 whitespace-nowrap">
                        {filteredItems.length} items
                    </span>
                </h3>
            </div>

            {/* Bottom Row: Search & Actions */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 w-full">
                
                {/* Search Bar & Primary Actions */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                    <div className="relative w-full lg:w-96">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-6 text-gray-400" />
                        <input 
                            type="text" 
                            placeholder="Buscar por código o descripción..." 
                            className="pl-9 pr-4 py-2.5 sm:py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none w-full bg-white text-gray-900 shadow-sm"
                            value={searchTerm}
                            onChange={(e) => {
                                onSearchChange(e.target.value);
                                setCurrentPage(1); 
                            }}
                        />
                    </div>

                    <button 
                        onClick={handleStartAnalysis}
                        className="flex justify-center items-center gap-2 px-4 py-2.5 sm:py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-lg transition-all shadow-sm whitespace-nowrap shrink-0 group transform hover:scale-[1.02]"
                        title="Comenzar análisis del primer ítem pendiente"
                    >
                        <Play className="h-4 w-4 fill-current group-hover:scale-110 transition-transform" />
                        <span>Comenzar Análisis</span>
                    </button>
                </div>
                
                {/* Buttons */}
                <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 shrink-0 lg:ml-auto">
                     {/* Manual Entry Button */}
                    {onOpenAdditionalModal && (
                        <button 
                            onClick={onOpenAdditionalModal}
                            className="flex justify-center items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 text-sm font-medium rounded-lg transition-colors shadow-sm border border-purple-200 whitespace-nowrap col-span-1"
                            title="Agregar ítems adicionales"
                        >
                            <ShoppingCart className="h-4 w-4" />
                            <span className="block sm:hidden xl:block">Adicionales</span>
                            <span className="hidden sm:block xl:hidden">Adic.</span>
                            {additionalItemsCount > 0 && (
                                <span className="bg-purple-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                    {additionalItemsCount}
                                </span>
                            )}
                        </button>
                    )}

                    <button 
                        onClick={() => onToggleFullScreen(true)}
                        className="flex justify-center items-center gap-2 px-3 py-2 bg-white hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-lg transition-colors shadow-sm border border-gray-300 whitespace-nowrap col-span-1"
                        title="Modo Pantalla Completa (Auditoría)"
                    >
                        <Maximize2 className="h-4 w-4" />
                        <span className="block sm:hidden">Pantalla Completa</span>
                    </button>

                    <button 
                        onClick={handleExportExcel}
                        className="flex justify-center items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm whitespace-nowrap col-span-2 sm:col-span-1 sm:w-auto"
                    >
                        <FileSpreadsheet className="h-4 w-4" />
                        <span>Exportar Excel</span>
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* TABLE */}
      <div className={`overflow-x-auto ${isFullScreen ? 'flex-1 overflow-y-auto bg-white p-4' : 'min-h-[400px]'}`}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 relative z-10">
            <tr>
              <RenderHeader label="Código" />
              <RenderHeader label="Medicamento" field="isSporadic" />
              <RenderHeader label="F.F." field="ff" />
              <RenderHeader label="Tipo" field="medtip" />
              <RenderHeader label="Pet" field="medpet" />
              <RenderHeader label="Est" field="medest" />
              
              <RenderHeader label="Stock" field="currentStock" align="right" />
              
              <RenderHeader 
                label={(viewMode === 'INITIAL' || viewMode === 'PROJECTED_SIMPLE') ? 'CPA (Simple)' : 'CPA (Ajust.)'} 
                field={(viewMode === 'INITIAL' || viewMode === 'PROJECTED_SIMPLE') ? 'rawCpm' : 'cpm'} 
                align="right" 
                className={`border-b-2 whitespace-nowrap ${(viewMode === 'INITIAL' || viewMode === 'PROJECTED_SIMPLE') ? 'border-blue-500' : 'border-teal-500'}`} 
                textColor={(viewMode === 'INITIAL' || viewMode === 'PROJECTED_SIMPLE') ? 'text-blue-600' : 'text-teal-600'} 
              />
              
              <RenderHeader label="Meses Prov." field="monthsOfProvision" align="right" />
              <RenderHeader label="Estado" field="status" align="center" />
              <RenderHeader label="Detalle Ajuste" field="anomalyDetails" />
              <RenderHeader label="Requerimiento" field="quantityToOrder" align="right" />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 relative z-0">
            {currentItems.length > 0 ? (
              currentItems.map((item) => {
                const activeMonths = item.monthsOfProvision ?? 0;
                const activeStatus = item.status;

                const isOverstock = activeStatus === StockStatus.SOBRESTOCK;
                const isNoRotation = activeStatus === StockStatus.SIN_ROTACION;
                
                const rawCpm = item.rawCpm || 0;
                const rawStock = item.currentStock || 0;
                const rawMonths = rawCpm > 0 ? rawStock / rawCpm : (rawStock > 0 ? Infinity : 0);
                const isRawOverstock = rawMonths > 6 || (rawCpm === 0 && rawStock > 0);

                const needsReview = (!isOverstock && !isNoRotation) || !isRawOverstock || item.quantityToOrder > 0;
                const isReviewed = reviewedIds.has(item.id);
                const showReviewedState = isReviewed && needsReview;
                
                return (
                <tr 
                  key={item.id} 
                  onClick={() => setSelectedMedicationId(item.id)}
                  className={`transition-colors group cursor-pointer ${
                      showReviewedState ? 'bg-teal-50/30 hover:bg-teal-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-sm font-bold text-gray-700 font-mono">
                    {item.id}
                  </td>
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900 truncate max-w-[200px] sm:max-w-[300px]" title={item.name}>{item.name}</div>
                        {item.isSporadic && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 whitespace-nowrap gap-1">
                                <Timer className="h-3 w-3" />
                                Baja Rotación
                            </span>
                        )}
                        {item.medtip === 'M' && item.medpet === 'P' && (item.medest === 'S' || item.medest === '_') && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 whitespace-nowrap gap-1">
                                Esencial
                            </span>
                        )}
                        {/* CPA Selection Indicator */}
                        {item.selectedCpaMode === 'SIMPLE' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">
                                MANUAL
                            </span>
                        )}
                    </div>
                    {/* ... (Price) ... */}
                    <div className="flex gap-2 text-xs text-gray-400 mt-0.5">
                       <span>S/ {(item.unitPrice || 0).toFixed(2)}</span>
                    </div>
                  </td>

                  {/* ... (FF, Type, Pet, Est) ... */}
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-xs text-gray-600">
                    {item.ff ? <span className="bg-gray-100 px-2 py-1 rounded border border-gray-200">{item.ff}</span> : '-'}
                  </td>
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-xs text-gray-600">
                    {item.medtip || '-'}
                  </td>
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-xs text-gray-600">
                    {item.medpet || '-'}
                  </td>
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-xs text-gray-600">
                    {item.medest || '-'}
                  </td>

                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-right text-gray-900 font-mono">
                    <span className="text-base font-bold">{(item.currentStock || 0).toLocaleString()}</span>
                  </td>
                  
                  {/* CPA Column */}
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-right">
                    <div className="flex flex-col items-end">
                        {(viewMode === 'INITIAL' || viewMode === 'PROJECTED_SIMPLE') ? (
                             <>
                                <span className="text-base font-bold text-blue-700 font-mono">
                                    {(item.displayCpm ?? item.rawCpm ?? 0).toFixed(1)}
                                </span>
                                {item.hasSpikes && (
                                     <span className="text-xs text-gray-400" title="CPA Ajustado (Automático)">
                                        Ajust: {(item.cpm || 0).toFixed(1)}
                                     </span>
                                )}
                             </>
                        ) : item.selectedCpaMode === 'SIMPLE' ? (
                             <>
                                <span className="text-base font-bold text-blue-700 font-mono">
                                    {(item.rawCpm || 0).toFixed(1)}
                                </span>
                                <span className="text-xs text-gray-400" title="CPA Ajustado (Automático)">
                                    Ajust: {(item.cpm || 0).toFixed(1)}
                                </span>
                             </>
                        ) : (
                             <>
                                <span className="text-base font-bold text-teal-700 font-mono">
                                    {(item.displayCpm ?? item.cpm ?? 0).toFixed(1)}
                                </span>
                                {item.hasSpikes && (
                                     <span className="text-xs text-gray-400 line-through decoration-red-400" title={`Promedio Simple (con picos): ${(item.rawCpm || 0).toFixed(1)}`}>
                                        {(item.rawCpm || 0).toFixed(1)}
                                     </span>
                                )}
                             </>
                        )}
                    </div>
                  </td>

                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-right font-mono">
                    <span className={`text-base font-bold ${
                        activeMonths < 2 ? 'text-amber-600' : 
                        activeMonths > 12 ? 'text-blue-600' : 'text-gray-600'
                    }`}>
                        {isFinite(activeMonths || 0) ? (activeMonths || 0).toFixed(1) : '∞'}
                    </span>
                  </td>

                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center">
                      {getStatusBadge(item.status)}
                    </div>
                  </td>
                  
                  <td className="px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap">
                    {item.hasSpikes ? (
                      <div 
                        className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-100 w-fit group-hover:bg-amber-100 transition-colors"
                        title="Ver detalle del cálculo"
                      >
                          <Zap className="h-3 w-3" />
                          <span className="truncate max-w-[150px]">
                            {item.anomalyDetails}
                          </span>
                      </div>
                    ) : (
                      <span 
                        className="text-xs text-gray-400 flex items-center gap-1 group-hover:text-gray-600"
                        title="Ver historial estable"
                      >
                          <CheckCircle className="h-3 w-3" /> Estable
                      </span>
                    )}
                  </td>

                  <td className={`px-2 py-2 2xl:px-3 2xl:py-3 whitespace-nowrap text-right border-l ${showReviewedState ? 'bg-teal-50 border-teal-200' : 'bg-gray-50/50 border-transparent'}`}>
                      {needsReview ? (
                          <div className="flex flex-col items-end justify-center min-h-[2.5rem]">
                              <div className="flex items-center justify-end gap-3">
                                  
                                  {/* Fixed width container for the icon to ensure vertical alignment */}
                                  <div className="w-5 flex justify-center">
                                      {showReviewedState && (
                                          <div className="text-teal-600" title="Validado por Farmacia">
                                              <ShieldCheck className="h-5 w-5" />
                                          </div>
                                      )}
                                      {!showReviewedState && (
                                          <div className="text-amber-500 animate-pulse" title="Pendiente de Revisión">
                                              <AlertOctagon className="h-5 w-5" />
                                          </div>
                                      )}
                                  </div>

                                  {/* Min width on quantity to prevent icon shift */}
                                  <span className={`text-sm font-bold px-2 rounded min-w-[3.5rem] text-right block ${item.quantityToOrder > 0 ? 'text-teal-700 bg-teal-50' : 'text-gray-500 bg-gray-100'}`}>
                                      {item.quantityToOrder > 0 ? `+${item.quantityToOrder.toLocaleString()}` : '0'}
                                  </span>
                              </div>
                              <span className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                  <TrendingUp className="h-3 w-3" />
                                  S/ {(item.estimatedInvestment || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                              </span>
                          </div>
                      ) : (
                          <span className="text-xs text-gray-300 italic">No requiere</span>
                      )}
                  </td>
                </tr>
              )})
            ) : (
              <tr>
                <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Search className="h-8 w-8 text-gray-300" />
                    <p>No se encontraron medicamentos con los filtros actuales.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination (Unchanged) */}
      {totalPages > 1 && (
        <div className={`${isFullScreen ? 'bg-white border-t border-gray-200 px-6 py-4' : 'bg-gray-50 px-4 sm:px-6 py-3 border-t border-gray-200'} flex items-center justify-between shrink-0`}>
             {/* ... (Pagination Code) ... */}
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Mostrando <span className="font-medium">{startIndex + 1}</span> a <span className="font-medium">{Math.min(startIndex + itemsPerPage, filteredItems.length)}</span> de <span className="font-medium">{filteredItems.length}</span>
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium ${currentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                      <span className="sr-only">Anterior</span>
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    
                    <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                      {currentPage} / {totalPages}
                    </span>

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium ${currentPage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                      <span className="sr-only">Siguiente</span>
                      <ChevronRight className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </nav>
                </div>
              </div>
              {/* Mobile Pagination */}
              <div className="flex sm:hidden justify-between w-full items-center">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`relative inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 ${currentPage === 1 ? 'opacity-50' : ''}`}
                >
                  Anterior
                </button>
                <span className="text-xs text-gray-700 font-medium">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`ml-3 relative inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 ${currentPage === totalPages ? 'opacity-50' : ''}`}
                >
                  Siguiente
                </button>
              </div>
        </div>
      )}
    </div>
    
    {/* Use conditional rendering to force unmount on open/close for fresh state */}
    {selectedMedication && (
        <ConsumptionModal 
            medication={selectedMedication} 
            isOpen={true} 
            onClose={() => setSelectedMedicationId(null)} 
            referenceDate={referenceDate}
            onUpdate={onMedicationUpdate}
            // Review Props
            isReviewed={reviewedIds.has(selectedMedication.id)}
            onToggleReview={onToggleReview}
            // Smart Navigation
            nextReviewId={nextReviewItem?.id}
            onNavigate={(id) => setSelectedMedicationId(id)}
            prevItemId={prevItemId}
            nextItemId={nextItemId}
        />
    )}
    </>
  );
});
