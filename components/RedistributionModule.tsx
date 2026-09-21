import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import localforage from 'localforage';
import { Upload, FileSpreadsheet, Search, ArrowRightLeft, Building2, Package, AlertCircle, X, ArrowRight, Merge, Split, CheckCircle2, Circle, Filter, ChevronLeft, ChevronRight, Sparkles, TrendingUp, TrendingDown, AlertTriangle, ClipboardList, Trash2, MousePointerClick, ChevronDown, ChevronUp, Check, Download, Maximize, Minimize, Edit2, RefreshCw, Calendar } from 'lucide-react';

// Hook para persistir estado en localStorage
function useLocalStorage<T>(key: string, initialValue: T) {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.warn(`Error reading localStorage key "${key}":`, error);
            return initialValue;
        }
    });

    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.warn(`Error setting localStorage key "${key}":`, error);
        }
    };

    return [storedValue, setValue] as const;
}

const MultiSelectFilter = ({
    title,
    options,
    selectedValues,
    onChange,
    portalTarget
}: {
    title: string;
    options: { value: string; label: string }[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
    portalTarget?: HTMLElement | null;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [tempSelected, setTempSelected] = useState<string[]>(selectedValues);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLDivElement>(null);
    const [menuStyles, setMenuStyles] = useState<React.CSSProperties>({});

    useEffect(() => {
        if (isOpen) {
            setTempSelected(selectedValues);
            setSearchTerm('');
        }
    }, [isOpen, selectedValues]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        const updatePosition = () => {
            if (isOpen && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const dropdownWidth = 200; // min-w-[200px]
                let left = rect.left + rect.width / 2 - dropdownWidth / 2;
                
                // Prevent left overflow
                if (left < 16) left = 16;
                // Prevent right overflow
                if (left + dropdownWidth > window.innerWidth - 16) {
                    left = window.innerWidth - dropdownWidth - 16;
                }

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
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, portalTarget]);

    const filteredOptions = options.filter(o => o.label.toLowerCase().includes(searchTerm.toLowerCase()));
    const allSelected = filteredOptions.length > 0 && filteredOptions.every(o => tempSelected.includes(o.value));

    const toggleSelectAll = () => {
        if (allSelected) {
            setTempSelected(prev => prev.filter(v => !filteredOptions.some(o => o.value === v)));
        } else {
            setTempSelected(prev => Array.from(new Set([...prev, ...filteredOptions.map(o => o.value)])));
        }
    };

    const toggleOption = (value: string) => {
        setTempSelected(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
    };

    const handleAccept = () => {
        onChange(tempSelected);
        setIsOpen(false);
    };

    const handleCancel = () => {
        setIsOpen(false);
    };

    const isFilterActive = useMemo(() => {
        if (selectedValues.length === 0) return false;
        if (options.length === 0) return false;
        if (selectedValues.length !== options.length) return true;
        return !options.every(o => selectedValues.includes(o.value));
    }, [selectedValues, options]);

    return (
        <div className="relative inline-flex items-center justify-center w-full h-full" ref={triggerRef}>
            <div
                className="flex items-center justify-center gap-1 cursor-pointer w-full h-full hover:bg-slate-100 transition-colors p-2"
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
            >
                <span>{title}</span>
                <Filter className={`h-3 w-3 ${isFilterActive ? 'text-indigo-600 fill-indigo-600' : 'text-slate-300'}`} />
            </div>

            {isOpen && createPortal(
                <div
                    ref={dropdownRef}
                    className="fixed min-w-[200px] bg-white border border-slate-200 shadow-xl rounded-xl z-[100000] p-2 font-normal text-left text-xs text-slate-700 animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-2"
                    style={{ ...menuStyles, visibility: Object.keys(menuStyles).length === 0 ? 'hidden' : 'visible' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <input
                        type="text"
                        placeholder="Buscar..."
                        className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors ${allSelected ? 'font-bold text-indigo-700 bg-indigo-50/50' : ''}`}
                        onClick={toggleSelectAll}
                    >
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${allSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300'}`}>
                            {allSelected && <Check className="w-2.5 h-2.5" />}
                        </div>
                        <span>(Seleccionar todo)</span>
                    </div>
                    <div className="h-px bg-slate-100 shrink-0"></div>
                    <div className="overflow-y-auto custom-scrollbar flex-1 min-h-0">
                        {filteredOptions.map(opt => {
                            const isSelected = tempSelected.includes(opt.value);
                            return (
                                <div
                                    key={opt.value}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors ${isSelected ? 'font-bold text-indigo-700 bg-indigo-50/50' : ''}`}
                                    onClick={() => toggleOption(opt.value)}
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300'}`}>
                                        {isSelected && <Check className="w-2.5 h-2.5" />}
                                    </div>
                                    <span className="truncate">{opt.label}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-slate-100 shrink-0">
                        <button className="flex-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-xs" onClick={handleAccept}>ACEPTAR</button>
                        <button className="flex-1 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs" onClick={handleCancel}>Cancelar</button>
                    </div>
                </div>,
                portalTarget || document.body
            )}
        </div>
    );
};
import * as XLSX from 'xlsx';
import { calculateAdjustedCPM } from '../services/auraService';
import { AvailabilityRecord, RedistributionItem } from '../types';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { NumberFilter, NumberFilterState } from './NumberFilter';

interface RedistributionModuleProps {
    onBack?: () => void;
}

export const RedistributionModule: React.FC<RedistributionModuleProps> = ({ onBack }) => {
    const { systemConfig } = useAuth();
    // --- STATE INITIALIZATION ---
    const [isLoaded, setIsLoaded] = useState(false);
    const [records, setRecords] = useState<AvailabilityRecord[]>([]);
    const [selectedMicrored, setSelectedMicrored] = useState<string[]>(['ALL']);
    const [selectedEstablishment, setSelectedEstablishment] = useState<string[]>([]);
    const [selectedSituacion, setSelectedSituacion] = useState<string[]>([]);
    const [selectedEstablecimientoFilter, setSelectedEstablecimientoFilter] = useState<string[]>([]);
    const [selectedStockFilter, setSelectedStockFilter] = useState<NumberFilterState | null>(null);
    const [selectedSumaConsFilter, setSelectedSumaConsFilter] = useState<NumberFilterState | null>(null);
    const [selectedMesesConsFilter, setSelectedMesesConsFilter] = useState<NumberFilterState | null>(null);
    const [selectedCpaFilter, setSelectedCpaFilter] = useState<NumberFilterState | null>(null);
    const [selectedMesesFilter, setSelectedMesesFilter] = useState<NumberFilterState | null>(null);
    const [selectedProductCode, setSelectedProductCode] = useState<string>('');
    const [selectedProductName, setSelectedProductName] = useState<string>('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- FULLSCREEN STATE ---
    const tableContainerRef = React.useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    };

    // --- CONSOLIDATION STATE ---
    const [isConsolidateModalOpen, setIsConsolidateModalOpen] = useState(false);
    const [consolidationSelection, setConsolidationSelection] = useState<Set<string>>(new Set());

    // --- REVIEW STATE ---
    const [reviewedProducts, setReviewedProducts] = useState<Set<string>>(new Set());
    const [productSearch, setProductSearch] = useLocalStorage<string>('aura_productSearch', '');
    const [statusFilter, setStatusFilter] = useLocalStorage<string[]>('aura_statusFilter', []);
    const [reviewFilter, setReviewFilter] = useLocalStorage<string[]>('aura_reviewFilter', []);
    const [tipoFilter, setTipoFilter] = useLocalStorage<string[]>('aura_tipoFilter', []);
    const [petFilter, setPetFilter] = useLocalStorage<string[]>('aura_petFilter', []);
    const [estFilter, setEstFilter] = useLocalStorage<string[]>('aura_estFilter', []);
    const [stockFilter, setStockFilter] = useLocalStorage<NumberFilterState | null>('aura_stockFilter', null);
    const [cpaFilter, setCpaFilter] = useLocalStorage<NumberFilterState | null>('aura_cpaFilter', null);
    const [monthsFilter, setMonthsFilter] = useLocalStorage<NumberFilterState | null>('aura_monthsFilter', null);

    // --- CONFIRMATION MODAL STATE ---
    const [isReviewConfirmOpen, setIsReviewConfirmOpen] = useState(false);
    const [pendingNextProductCode, setPendingNextProductCode] = useState<string | null>(null);
    const [autoReviewEnabled, setAutoReviewEnabled] = useState(false);

    // --- DETAIL MODAL STATE ---
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedDetailItem, setSelectedDetailItem] = useState<RedistributionItem | null>(null);
    const [modalCpaMode, setModalCpaMode] = useState<'ADJUSTED' | 'SIMPLE'>('ADJUSTED');
    const [modalExcludedIndices, setModalExcludedIndices] = useState<number[]>([]);
    const [modalEstimation, setModalEstimation] = useState<number>(0);
    const [cpaAdjustments, setCpaAdjustments] = useState<Record<string, Record<string, { mode: 'ADJUSTED' | 'SIMPLE', excludedIndices: number[], cpa: number }>>>({});

    useEffect(() => {
        if (selectedDetailItem && selectedProductCode) {
            setModalEstimation(0); // Reset estimation when item changes
            const adj = cpaAdjustments[selectedProductCode]?.[selectedDetailItem.codEess];
            
            // Determine default mode based on spikes
            const history = selectedDetailItem.monthlyConsumption || Array(12).fill(0);
            const analysis = calculateAdjustedCPM(history);
            const isEqual = analysis.adjusted.toFixed(1) === analysis.raw.toFixed(1);
            const noSpikes = (analysis.spikes || 0) === 0;
            const autoMode = (isEqual || noSpikes) ? 'SIMPLE' : 'ADJUSTED';

            if (adj) {
                // Migration/Correction: If it was saved as SIMPLE but it has spikes and no manual exclusions,
                // it's likely a bug-induced state from a previous version. Reset to ADJUSTED.
                if (adj.mode === 'SIMPLE' && !isEqual && !noSpikes && adj.excludedIndices.length === 0) {
                    setModalCpaMode('ADJUSTED');
                } else {
                    setModalCpaMode(adj.mode);
                }
                setModalExcludedIndices(adj.excludedIndices);
            } else {
                setModalCpaMode(autoMode);
                setModalExcludedIndices([]);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDetailItem?.codEess, selectedProductCode]);

    // --- UPLOAD CONFIRMATION MODAL ---
    const [isConfirmUploadModalOpen, setIsConfirmUploadModalOpen] = useState(false);
    const [isConfirmImportModalOpen, setIsConfirmImportModalOpen] = useState(false);
    const [estSearchTerm, setEstSearchTerm] = useState('');
    const [isEstDropdownOpen, setIsEstDropdownOpen] = useState(false);
    const [mrSearchTerm, setMrSearchTerm] = useState('');
    const [isMrDropdownOpen, setIsMrDropdownOpen] = useState(false);
    const mrTriggerRef = useRef<HTMLDivElement>(null);
    const [isProductListMrDropdownOpen, setIsProductListMrDropdownOpen] = useState(false);
    const productListMrTriggerRef = useRef<HTMLDivElement>(null);
    const productListEstTriggerRef = useRef<HTMLDivElement>(null);
    const [isGlobalSearchModalOpen, setIsGlobalSearchModalOpen] = useState(false);
    const [isProductListModalOpen, setIsProductListModalOpen] = useState(false);
    const [globalSearchTerm, setGlobalSearchTerm] = useState('');
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [isUploadSectionCollapsed, setIsUploadSectionCollapsed] = useState(false);

    useEffect(() => {
        if (records.length > 0) {
            setIsUploadSectionCollapsed(true);
        }
    }, [records.length]);

    // --- CLEAR SEARCH ON CLOSE ---
    const prevGlobalModalOpen = React.useRef(isGlobalSearchModalOpen);

    useEffect(() => {
        if (prevGlobalModalOpen.current && !isGlobalSearchModalOpen) {
            // Modal transicionó a cerrado
            setGlobalSearchTerm('');

            if (selectedProductCode && !selectedMicrored.includes('ALL')) {
                setSimulationData(prev => {
                    const productData = prev[selectedProductCode];
                    if (!productData) return prev;

                    const newData = { ...prev };
                    const newProductData = { ...productData };
                    let hasChanges = false;

                    // Limpiar 'Estimar' de establecimientos extra-microred (los de "TODA LA RED")
                    records.forEach(r => {
                        if (r.medCode === selectedProductCode && !selectedMicrored.includes(r.microred)) {
                            if (newProductData[r.codEess]) {
                                delete newProductData[r.codEess];
                                hasChanges = true;
                            }
                        }
                    });

                    if (hasChanges) {
                        newData[selectedProductCode] = newProductData;
                        return newData;
                    }
                    return prev;
                });
            }
        }
        prevGlobalModalOpen.current = isGlobalSearchModalOpen;
    }, [isGlobalSearchModalOpen, selectedProductCode, selectedMicrored, records]);

    // --- TRANSFER LIST STATE ---
    const [transferList, setTransferList] = useState<{
        id: string;
        productCode: string;
        productName: string;
        quantity: number;
        originCod: string;
        originName: string;
        destinationCod: string;
        destinationName: string;
    }[]>([]);

    const [simulationData, setSimulationData] = useState<Record<string, Record<string, { qty: number, input: string }>>>({});
    const [isTransferListOpen, setIsTransferListOpen] = useState(false);
    const [editingTransferId, setEditingTransferId] = useState<string | null>(null);
    const [editingTransferQty, setEditingTransferQty] = useState<string>('');
    const [quickTransferSource, setQuickTransferSource] = useState<RedistributionItem | null>(null);
    const [quickTransferDestination, setQuickTransferDestination] = useState<RedistributionItem | null>(null);
    const [isQuickTransferConfirmOpen, setIsQuickTransferConfirmOpen] = useState(false);
    const [quickTransferQty, setQuickTransferQty] = useState<string>('');

    // --- LOAD FROM LOCALFORAGE ---
    useEffect(() => {
        const loadData = async () => {
            try {
                const savedRecords = await localforage.getItem<AvailabilityRecord[]>('aura_records');
                if (savedRecords && Array.isArray(savedRecords)) setRecords(savedRecords);

                const savedMicrored = await localforage.getItem<any>('aura_selectedMicrored');
                if (savedMicrored) {
                    if (typeof savedMicrored === 'string') {
                        setSelectedMicrored([savedMicrored]);
                    } else if (Array.isArray(savedMicrored)) {
                        setSelectedMicrored(savedMicrored);
                    }
                }

                const savedEstablishment = await localforage.getItem<any>('aura_selectedEstablishment');
                if (savedEstablishment) {
                    if (typeof savedEstablishment === 'string') {
                        setSelectedEstablishment([savedEstablishment]);
                    } else if (Array.isArray(savedEstablishment)) {
                        setSelectedEstablishment(savedEstablishment);
                    }
                }

                const savedProductCode = await localforage.getItem<string>('aura_selectedProductCode');
                if (savedProductCode) setSelectedProductCode(savedProductCode);

                const savedProductName = await localforage.getItem<string>('aura_selectedProductName');
                if (savedProductName) setSelectedProductName(savedProductName);

                const savedConsolidation = await localforage.getItem<string[]>('aura_consolidationSelection');
                if (savedConsolidation && Array.isArray(savedConsolidation)) setConsolidationSelection(new Set(savedConsolidation));

                const savedReviewed = await localforage.getItem<string[]>('aura_reviewedProducts');
                if (savedReviewed && Array.isArray(savedReviewed)) setReviewedProducts(new Set(savedReviewed));

                const savedTransferList = await localforage.getItem<any[]>('aura_transferList');
                if (savedTransferList && Array.isArray(savedTransferList)) setTransferList(savedTransferList);

                const savedSimulation = await localforage.getItem<any>('aura_simulationData');
                if (savedSimulation && typeof savedSimulation === 'object' && !Array.isArray(savedSimulation)) setSimulationData(savedSimulation);

                const savedCpaAdjustments = await localforage.getItem<any>('aura_cpaAdjustments');
                if (savedCpaAdjustments && typeof savedCpaAdjustments === 'object' && !Array.isArray(savedCpaAdjustments)) setCpaAdjustments(savedCpaAdjustments);
            } catch (e) {
                console.error("Error loading data from localforage", e);
            } finally {
                setIsLoaded(true);
            }
        };
        loadData();
    }, []);

    // --- SYNC TO LOCALFORAGE ---
    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_records', records).catch(e => console.warn("Could not save records to localforage", e));
    }, [records, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_selectedMicrored', selectedMicrored).catch(() => { });
    }, [selectedMicrored, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_selectedEstablishment', selectedEstablishment).catch(() => { });
    }, [selectedEstablishment, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_selectedProductCode', selectedProductCode).catch(() => { });
    }, [selectedProductCode, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_selectedProductName', selectedProductName).catch(() => { });
    }, [selectedProductName, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_consolidationSelection', Array.from(consolidationSelection)).catch(() => { });
    }, [consolidationSelection, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_reviewedProducts', Array.from(reviewedProducts)).catch(() => { });
    }, [reviewedProducts, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_transferList', transferList).catch(() => { });
    }, [transferList, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_simulationData', simulationData).catch(() => { });
    }, [simulationData, isLoaded]);

    useEffect(() => {
        if (!isLoaded) return;
        localforage.setItem('aura_cpaAdjustments', cpaAdjustments).catch(() => { });
    }, [cpaAdjustments, isLoaded]);

    // --- 1. FILE UPLOAD ---
    const importInputRef = React.useRef<HTMLInputElement>(null);

    const handleExportSession = async () => {
        try {
            setLoading(true);
            const exportData: any = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                localforage: {},
                localStorage: {}
            };

            // Get localforage data
            exportData.localforage.aura_records = await localforage.getItem('aura_records');
            exportData.localforage.aura_selectedMicrored = await localforage.getItem('aura_selectedMicrored');
            exportData.localforage.aura_selectedEstablishment = await localforage.getItem('aura_selectedEstablishment');
            exportData.localforage.aura_selectedProductCode = await localforage.getItem('aura_selectedProductCode');
            exportData.localforage.aura_selectedProductName = await localforage.getItem('aura_selectedProductName');
            exportData.localforage.aura_consolidationSelection = await localforage.getItem('aura_consolidationSelection');
            exportData.localforage.aura_reviewedProducts = await localforage.getItem('aura_reviewedProducts');
            exportData.localforage.aura_transferList = await localforage.getItem('aura_transferList');
            exportData.localforage.aura_simulationData = await localforage.getItem('aura_simulationData');
            exportData.localforage.aura_cpaAdjustments = await localforage.getItem('aura_cpaAdjustments');

            // Get localStorage data
            const lsKeys = [
                'aura_productSearch',
                'aura_statusFilter',
                'aura_reviewFilter',
                'aura_tipoFilter',
                'aura_petFilter',
                'aura_estFilter',
                'aura_stockFilter',
                'aura_cpaFilter',
                'aura_monthsFilter'
            ];
            
            lsKeys.forEach(key => {
                const val = window.localStorage.getItem(key);
                if (val) {
                    exportData.localStorage[key] = JSON.parse(val);
                }
            });

            // Create and download file
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `Toolkit_Respaldo_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            
            toast.success("Sesión exportada correctamente");
        } catch (error) {
            console.error("Error exporting session:", error);
            toast.error("Error al exportar la sesión");
        } finally {
            setLoading(false);
        }
    };

    const handleImportSession = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setLoading(true);
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const content = e.target?.result as string;
                    const importedData = JSON.parse(content);

                    if (!importedData.localforage || !importedData.localforage.aura_records || !Array.isArray(importedData.localforage.aura_records)) {
                        throw new Error("Formato de archivo inválido");
                    }

                    if (importedData.localforage.aura_records.length === 0) {
                        throw new Error("El archivo de respaldo está vacío (no contiene registros).");
                    }

                    // Restore localforage
                    for (const [key, value] of Object.entries(importedData.localforage)) {
                        if (value !== undefined && value !== null) {
                            await localforage.setItem(key, value);
                        } else {
                            await localforage.removeItem(key);
                        }
                    }

                    // Restore localStorage
                    if (importedData.localStorage) {
                        for (const [key, value] of Object.entries(importedData.localStorage)) {
                            window.localStorage.setItem(key, JSON.stringify(value));
                        }
                    }

                    // Update state variables directly
                    if (importedData.localforage.aura_records) setRecords(importedData.localforage.aura_records);
                    if (importedData.localforage.aura_selectedMicrored) {
                        if (typeof importedData.localforage.aura_selectedMicrored === 'string') {
                            setSelectedMicrored([importedData.localforage.aura_selectedMicrored]);
                        } else if (Array.isArray(importedData.localforage.aura_selectedMicrored)) {
                            setSelectedMicrored(importedData.localforage.aura_selectedMicrored);
                        }
                    }
                    if (importedData.localforage.aura_selectedEstablishment) {
                        if (typeof importedData.localforage.aura_selectedEstablishment === 'string') {
                            setSelectedEstablishment([importedData.localforage.aura_selectedEstablishment]);
                        } else if (Array.isArray(importedData.localforage.aura_selectedEstablishment)) {
                            setSelectedEstablishment(importedData.localforage.aura_selectedEstablishment);
                        }
                    }
                    if (importedData.localforage.aura_selectedProductCode) setSelectedProductCode(importedData.localforage.aura_selectedProductCode);
                    if (importedData.localforage.aura_selectedProductName) setSelectedProductName(importedData.localforage.aura_selectedProductName);
                    if (importedData.localforage.aura_consolidationSelection) setConsolidationSelection(new Set(importedData.localforage.aura_consolidationSelection));
                    if (importedData.localforage.aura_reviewedProducts) setReviewedProducts(new Set(importedData.localforage.aura_reviewedProducts));
                    if (importedData.localforage.aura_transferList) setTransferList(importedData.localforage.aura_transferList);
                    if (importedData.localforage.aura_simulationData) setSimulationData(importedData.localforage.aura_simulationData);
                    if (importedData.localforage.aura_cpaAdjustments) setCpaAdjustments(importedData.localforage.aura_cpaAdjustments);

                    if (importedData.localStorage) {
                        if (importedData.localStorage.aura_productSearch !== undefined) setProductSearch(importedData.localStorage.aura_productSearch);
                        if (importedData.localStorage.aura_statusFilter !== undefined) setStatusFilter(importedData.localStorage.aura_statusFilter);
                        if (importedData.localStorage.aura_reviewFilter !== undefined) setReviewFilter(importedData.localStorage.aura_reviewFilter);
                        if (importedData.localStorage.aura_tipoFilter !== undefined) setTipoFilter(importedData.localStorage.aura_tipoFilter);
                        if (importedData.localStorage.aura_petFilter !== undefined) setPetFilter(importedData.localStorage.aura_petFilter);
                        if (importedData.localStorage.aura_estFilter !== undefined) setEstFilter(importedData.localStorage.aura_estFilter);
                        if (importedData.localStorage.aura_stockFilter !== undefined) setStockFilter(importedData.localStorage.aura_stockFilter);
                        if (importedData.localStorage.aura_cpaFilter !== undefined) setCpaFilter(importedData.localStorage.aura_cpaFilter);
                        if (importedData.localStorage.aura_monthsFilter !== undefined) setMonthsFilter(importedData.localStorage.aura_monthsFilter);
                    }

                    toast.success("Sesión importada correctamente.");
                    setLoading(false);

                    // Reset the file input so the same file can be imported again
                    if (importInputRef.current) {
                        importInputRef.current.value = '';
                    }

                } catch (error: any) {
                    console.error("Error parsing imported session:", error);
                    toast.error(error.message || "Error al leer el archivo de respaldo");
                    setLoading(false);
                }
            };
            reader.readAsText(file);
        } catch (error: any) {
            console.error("Error importing session:", error);
            toast.error(error.message || "Error al importar la sesión");
            setLoading(false);
        }
        
        // Reset input
        if (importInputRef.current) importInputRef.current.value = '';
    };

    const clearRedistributionData = () => {
        setRecords([]);
        setSelectedMicrored([]);
        setSelectedEstablishment([]);
        setSelectedProductCode('');
        setSelectedProductName('');
        setConsolidationSelection(new Set());
        setReviewedProducts(new Set());
        setTransferList([]);
        setSimulationData({});
        setProductSearch('');
        setStatusFilter([]);
        setReviewFilter([]);
        setTipoFilter([]);
        setPetFilter([]);
        setEstFilter([]);
        setStockFilter(null);
        setCpaFilter(null);
        setMonthsFilter(null);
        setSelectedSituacion([]);
        setSelectedEstablecimientoFilter([]);
        setSelectedStockFilter(null);
        setSelectedSumaConsFilter(null);
        setSelectedMesesConsFilter(null);
        setSelectedCpaFilter(null);
        setSelectedMesesFilter(null);
        setCpaAdjustments({});
        
        localforage.removeItem('aura_records');
        localforage.removeItem('aura_selectedMicrored');
        localforage.removeItem('aura_selectedEstablishment');
        localforage.removeItem('aura_selectedProductCode');
        localforage.removeItem('aura_selectedProductName');
        localforage.removeItem('aura_consolidationSelection');
        localforage.removeItem('aura_reviewedProducts');
        localforage.removeItem('aura_transferList');
        localforage.removeItem('aura_simulationData');
        localforage.removeItem('aura_cpaAdjustments');
        window.localStorage.removeItem('aura_productSearch');
        window.localStorage.removeItem('aura_statusFilter');
        window.localStorage.removeItem('aura_reviewFilter');
        window.localStorage.removeItem('aura_tipoFilter');
        window.localStorage.removeItem('aura_petFilter');
        window.localStorage.removeItem('aura_estFilter');
        window.localStorage.removeItem('aura_stockFilter');
        window.localStorage.removeItem('aura_cpaFilter');
        window.localStorage.removeItem('aura_monthsFilter');
    };

    const renderModal = (modalContent: React.ReactNode) => {
        const target = isFullscreen && tableContainerRef.current ? tableContainerRef.current : document.body;
        return createPortal(modalContent, target);
    };

    const processFile = (file: File, lastMonth: number, lastYear: number) => {
        setLoading(true);
        setError(null);

        // Simulate processing delay for animation
        setTimeout(() => {
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const bstr = evt.target?.result;
                    const wb = XLSX.read(bstr, { type: 'binary' });
                    const wsname = wb.SheetNames[0];
                    const ws = wb.Sheets[wsname];

                    // Use header: "A" to get data with column letters (A, B, C...) as keys
                    const rawData = XLSX.utils.sheet_to_json(ws, { header: "A" }) as Record<string, any>[];

                    // 1. Find Header Row
                    let headerRowIndex = -1;
                    const colMap: Record<string, string> = {}; // Map Field Name -> Column Letter (e.g., "STOCK" -> "K")

                    // Define required headers for each format (with variations)
                    const requiredNew = [
                        ["RED"],
                        ["MICRORED"],
                        ["COD EESS", "COD. EESS"],
                        ["ESTABLECIMIENTO", "EESS"],
                        ["PRODUCTO", "DESCRIPCION"],
                        ["STOCK"],
                        ["MES_1"]
                    ];
                    const requiredOld = [
                        ["COD EESS", "COD. EESS"],
                        ["ESTABLECIMIENTO", "EESS"],
                        ["PRODUCTO", "DESCRIPCION"],
                        ["STOCK"],
                        ["CPA"]
                    ];

                    for (let i = 0; i < Math.min(20, rawData.length); i++) {
                        const row = rawData[i];
                        const values = Object.values(row).map(v => String(v).toUpperCase().trim());

                        const hasNew = requiredNew.every(variations => variations.some(v => values.some(val => val.includes(v))));
                        const hasOld = requiredOld.every(variations => variations.some(v => values.some(val => val.includes(v))));

                        if (hasNew || hasOld) {
                            headerRowIndex = i;
                            // Build Column Map
                            Object.entries(row).forEach(([key, val]) => {
                                const header = String(val).toUpperCase().trim();
                                colMap[header] = key;
                            });
                            break;
                        }
                    }

                    if (headerRowIndex === -1) {
                        throw new Error("Estructura inválida: El archivo no contiene las columnas necesarias. Verifique que sea la plantilla correcta.");
                    }

                    // 2. Process Data Rows (Start after header)
                    const parsedRecords: AvailabilityRecord[] = [];
                    const consumptionCols = ['O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

                    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                        const row = rawData[i];

                        const getVal = (headerPart: string) => {
                            const key = Object.keys(colMap).find(k => k === headerPart) || Object.keys(colMap).find(k => k.includes(headerPart));
                            return key ? row[colMap[key]] : undefined;
                        };

                        const getValExact = (headerExact: string) => {
                            const key = Object.keys(colMap).find(k => k === headerExact);
                            return key ? row[colMap[key]] : undefined;
                        };

                        // Basic Validation: Must have Microred and Med Code
                        const microred = getVal("MICRORED");
                        const medCode = getVal("COD PRODUCTO") || getVal("CODIGO PRODUCTO") || getVal("MED COD") || getVal("CODIGO") || getVal("COD");

                        if (!microred || !medCode) continue;

                        const stock = Number(getVal("STOCK") || 0);
                        const cpa = Number(getVal("CPA") || 0);

                        // Fix Months Provision
                        let monthsProvision = Number(getVal("MES PROV") || getVal("MESES") || 0);
                        if ((monthsProvision === 0 || isNaN(monthsProvision)) && cpa > 0) {
                            monthsProvision = stock / cpa;
                        }

                        // 3. Calculate Consumption from Columns
                        let consumptionSum = 0;
                        let consumptionMonths = 0;
                        const monthlyConsumption: number[] = [];

                        // Check if we have MES_1...MES_12 columns
                        const mesCols = ['MES_1', 'MES_2', 'MES_3', 'MES_4', 'MES_5', 'MES_6', 'MES_7', 'MES_8', 'MES_9', 'MES_10', 'MES_11', 'MES_12'];
                        const hasMesCols = mesCols.some(col => colMap[col]);

                        if (hasMesCols) {
                            // Map MES_1...MES_12 to actual months based on lastMonth
                            // MES_1 is the oldest, MES_12 is the newest (lastMonth)
                            // lastMonth is 1-indexed (1=Jan, 12=Dec)
                            
                            // We need to store the consumption in a way that the UI can display them correctly
                            // based on the selected lastMonth.
                            // Let's store them in an array where index 0 is Jan, index 11 is Dec.
                            const consumptionByMonth = new Array(12).fill(0);
                            
                            for (let m = 0; m < 12; m++) {
                                const colName = `MES_${m + 1}`;
                                const val = Number(getVal(colName) || 0);
                                
                                // Calculate the actual month index (0-11)
                                // lastMonth is 1-based, so lastMonth-1 is the index of the newest month.
                                // MES_12 corresponds to lastMonth-1
                                // MES_1 corresponds to (lastMonth - 12 + 12) % 12
                                
                                const monthIndex = (lastMonth - 1 - (11 - m) + 12) % 12;
                                consumptionByMonth[monthIndex] = val;
                                
                                consumptionSum += val;
                                if (val > 0) consumptionMonths++;
                            }
                            
                            // Replace monthlyConsumption with the ordered array
                            monthlyConsumption.push(...consumptionByMonth);
                        } else {
                            // Fallback to old consumption columns
                            consumptionCols.forEach(colKey => {
                                const val = Number(row[colKey]);
                                if (!isNaN(val)) {
                                    consumptionSum += val;
                                    if (val > 0) consumptionMonths++;
                                    monthlyConsumption.push(val);
                                } else {
                                    monthlyConsumption.push(0);
                                }
                            });
                        }

                        // --- NEW CALCULATION LOGIC (User Request) ---
                        // CPA = Total Consumption / Months with Consumption
                        let calculatedCpa = Number(getVal("CPA") || 0);
                        if (calculatedCpa === 0 && consumptionMonths > 0) {
                            calculatedCpa = consumptionSum / consumptionMonths;
                        }

                        // Months Provision = Stock / Calculated CPA
                        let calculatedMonthsProvision = Number(getVal("MES PROV") || getVal("MESES") || 0);
                        if (calculatedMonthsProvision === 0 && calculatedCpa > 0.01) {
                            calculatedMonthsProvision = stock / calculatedCpa;
                        } else if (stock > 0 && calculatedCpa <= 0.01) {
                            calculatedMonthsProvision = 999; // Infinite provision if stock > 0 but no consumption
                        }

                        // Recalculate Status based on new metrics (User Request: ALWAYS CALCULATE)
                        let calculatedStatus = '';

                        if (stock === 0) {
                            calculatedStatus = 'Desabastecido';
                        } else if (calculatedCpa <= 0.01) {
                            calculatedStatus = 'Sin Rotación';
                        } else if (calculatedMonthsProvision < 2) {
                            calculatedStatus = 'SubStock';
                        } else if (calculatedMonthsProvision > 6) {
                            calculatedStatus = 'SobreStock';
                        } else {
                            calculatedStatus = 'NormoStock';
                        }

                        parsedRecords.push({
                            ue: String(getVal("UE") || ''),
                            red: String(getVal("RED") || ''),
                            microred: String(microred),
                            codEess: String(getVal("COD EESS") || getVal("COD. EESS") || ''),
                            establishmentName: String(getVal("ESTABLECIMIENTO") || getVal("EESS") || ''),
                            category: String(getVal("CAT") || ''),
                            medCode: String(medCode),
                            medName: String(getVal("DESCRIPCION") || getVal("PRODUCTO") || ''),
                            ff: String(getVal("F.F") || ''),
                            price: Number(getVal("PRECIO") || 0),
                            type: String(getValExact("TIPO") || ''),
                            pet: String(getValExact("PET") || ''),
                            est: String(getValExact("EST") || ''),
                            stock: stock,
                            cpa: calculatedCpa, // Use Calculated CPA
                            monthsProvision: calculatedMonthsProvision, // Use Calculated Months
                            status: calculatedStatus,
                            expiryDate: String(getVal("VENCIMIENTO") || getVal("VENC") || ''),
                            consumptionSum: consumptionSum,
                            consumptionMonths: consumptionMonths,
                            monthlyConsumption: monthlyConsumption
                        });
                    }

                    setRecords(parsedRecords);
                    setLoading(false);
                    toast.success("Archivo procesado correctamente");
                } catch (err: any) {
                    console.error(err);
                    setError("Error al procesar el archivo: " + err.message);
                    toast.error("Error al procesar el archivo");
                    setLoading(false);
                }
            };
            reader.readAsBinaryString(file);
        }, 500);
    };

    const [isLastMonthModalOpen, setIsLastMonthModalOpen] = useState(false);
    const [fileToProcess, setFileToProcess] = useState<File | null>(null);
    // lastMonthYear should be YYYY-MM
    const [lastMonthYear, setLastMonthYear] = useState<string>(
        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    );
    const [detectedMonthsCount, setDetectedMonthsCount] = useState<number>(12);

    const downloadTemplate = () => {
        const header = [
          "RED", "MICRORED", "COD EESS", "ESTABLECIMIENTO", "CAT",
          "MED COD", "DESCRIPCION DEL PRODUCTO", "MEDFF", "PRECIO",
          "MEDTIP", "MEDPET", "MEDEST",
          "MES_1", "MES_2", "MES_3", "MES_4", "MES_5", "MES_6",
          "MES_7", "MES_8", "MES_9", "MES_10", "MES_11", "MES_12", "STOCK_FIN"
        ];

        const ws = XLSX.utils.json_to_sheet([], { header });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
        XLSX.writeFile(wb, "Plantilla_Disponibilidad.xlsx");
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate File Extension
        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
            toast.error("Formato de archivo incorrecto. Por favor suba un archivo Excel (.xlsx o .xls).");
            return;
        }

        // Auto-detect month from headers
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = ev.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // Only take the first few rows to find headers quickly
                const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });
                
                let detectedCount = 12;
                if (jsonData.length > 0) {
                    for (let i = 0; i < Math.min(jsonData.length, 5); i++) {
                        const row = jsonData[i];
                        if (Array.isArray(row)) {
                            const numKeys = row.filter(k => /^\d{6}$/.test(String(k).trim())).sort();
                            if (numKeys.length > 0) {
                                detectedCount = numKeys.length;
                                const lastYyyyMm = String(numKeys[numKeys.length - 1]).trim();
                                const year = lastYyyyMm.substring(0, 4);
                                const month = lastYyyyMm.substring(4, 6);
                                setLastMonthYear(`${year}-${month}`);
                                break;
                            } else {
                                const monthNames = [
                                    ['enero', 'ene', 'mes01', 'mes1'], ['febrero', 'feb', 'mes02', 'mes2'], ['marzo', 'mar', 'mes03', 'mes3'],
                                    ['abril', 'abr', 'mes04', 'mes4'], ['mayo', 'may', 'mes05', 'mes5'], ['junio', 'jun', 'mes06', 'mes6'],
                                    ['julio', 'jul', 'mes07', 'mes7'], ['agosto', 'ago', 'mes08', 'mes8'], ['setiembre', 'septiembre', 'set', 'sep', 'mes09', 'mes9'],
                                    ['octubre', 'oct', 'mes10'], ['noviembre', 'nov', 'mes11'], ['diciembre', 'dic', 'mes12']
                                ];
                                
                                const findKey = (keys: string[]) => row.find(k => typeof k === 'string' && keys.some(key => k.toLowerCase().includes(key.toLowerCase())));
                                let countFound = 0;
                                monthNames.forEach(names => {
                                    if (findKey(names)) countFound++;
                                });
                                if (countFound > 0) {
                                    detectedCount = countFound;
                                    break;
                                }
                            }
                        }
                    }
                }
                setDetectedMonthsCount(detectedCount);
            } catch (err) {
                // Ignore parsing errors here, it will fallback to current month
            }
            
            setFileToProcess(file);
            setIsLastMonthModalOpen(true);
        };
        reader.readAsBinaryString(file);
    };

    const confirmFileProcessing = () => {
        if (fileToProcess) {
            // Parse YYYY-MM to month (1-12) and year
            const [year, month] = lastMonthYear.split('-').map(Number);
            processFile(fileToProcess, month, year);
            setIsLastMonthModalOpen(false);
            setFileToProcess(null);
        }
    };


    // --- 2. FILTERS ---
    const microredOptions = useMemo(() => {
        const unique = new Set(records.map(r => r.microred));
        return Array.from(unique).sort();
    }, [records]);

    const productOptions = useMemo(() => {
        if (selectedMicrored.length === 0) return [];

        let filtered = records;
        if (!selectedMicrored.includes('ALL')) {
            filtered = filtered.filter(r => selectedMicrored.includes(r.microred));
        }
        if (selectedEstablishment.length > 0) {
            filtered = filtered.filter(r => selectedEstablishment.includes(r.codEess));
        }

        // Aggregate data by product code
        const productMap = new Map<string, {
            name: string;
            totalStock: number;
            monthlyVector: number[];
            type: string;
            pet: string;
            est: string;
        }>();

        filtered.forEach(r => {
            if (!productMap.has(r.medCode)) {
                productMap.set(r.medCode, {
                    name: r.medName,
                    totalStock: 0,
                    monthlyVector: Array(12).fill(0),
                    type: r.type || '',
                    pet: r.pet || '',
                    est: r.est || ''
                });
            }
            const entry = productMap.get(r.medCode)!;
            entry.totalStock += r.stock;

            // Sum monthly consumption vector to calculate consolidated CPA correctly
            if (Array.isArray(r.monthlyConsumption) && r.monthlyConsumption.length === 12) {
                for (let i = 0; i < 12; i++) {
                    entry.monthlyVector[i] += Number(r.monthlyConsumption[i]) || 0;
                }
            }
        });

        return Array.from(productMap.entries()).map(([code, data]) => {
            // Calculate consolidated metrics based on summed vector
            const totalConsumption = data.monthlyVector.reduce((a, b) => a + b, 0);
            const activeMonths = data.monthlyVector.filter(v => v > 0).length;

            const cpa = activeMonths > 0 ? (totalConsumption / activeMonths) : 0;
            const months = cpa > 0 ? (data.totalStock / cpa) : (data.totalStock > 0 ? 999 : 0);

            let status = 'NormoStock';
            if (data.totalStock === 0) {
                status = 'Desabastecido';
            } else if (cpa <= 0.01) {
                status = 'Sin Rotación';
            } else if (months < 2) {
                status = 'SubStock';
            } else if (months > 6) {
                status = 'SobreStock';
            }

            return {
                code,
                name: data.name,
                cpa: cpa,
                months: months,
                activeMonths: activeMonths,
                status: status,
                type: data.type,
                pet: data.pet,
                est: data.est,
                totalStock: data.totalStock,
                monthlyVector: data.monthlyVector
            };
        }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }, [records, selectedMicrored, selectedEstablishment]);

    const filteredProductOptions = useMemo(() => {
        let result = productOptions;

        // 1. Text Search
        if (productSearch) {
            const lower = String(productSearch || '').toLowerCase();
            result = result.filter(p =>
                String(p.name || '').toLowerCase().includes(lower) ||
                String(p.code || '').toLowerCase().includes(lower)
            );
        }

        // 2. Status Filter
        if (statusFilter.length > 0) {
            result = result.filter(p => statusFilter.includes(p.status));
        }

        // 3. Review Filter
        if (reviewFilter.length > 0) {
            result = result.filter(p => {
                const isReviewed = reviewedProducts.has(p.code);
                return (isReviewed && reviewFilter.includes('REVIEWED')) || (!isReviewed && reviewFilter.includes('PENDING'));
            });
        }

        if (tipoFilter.length > 0) {
            result = result.filter(p => tipoFilter.includes(String(p.type || '').toUpperCase()));
        }

        if (petFilter.length > 0) {
            result = result.filter(p => petFilter.includes(String(p.pet || '').toUpperCase()));
        }

        if (estFilter.length > 0) {
            result = result.filter(p => estFilter.includes(String(p.est || '').toUpperCase()));
        }

        const applyNumberFilter = (value: number, filter: NumberFilterState | null, stringValue: string) => {
            if (!filter) return true;
            if (filter.type === 'list') {
                if (filter.listValues.length === 0) return true;
                return filter.listValues.includes(stringValue);
            } else {
                const v1 = Number(filter.value1);
                const v2 = Number(filter.value2);
                switch (filter.condition) {
                    case 'EQUALS': return value === v1;
                    case 'NOT_EQUALS': return value !== v1;
                    case 'GREATER_THAN': return value > v1;
                    case 'GREATER_THAN_OR_EQUAL': return value >= v1;
                    case 'LESS_THAN': return value < v1;
                    case 'LESS_THAN_OR_EQUAL': return value <= v1;
                    case 'BETWEEN': return value >= v1 && value <= v2;
                    default: return true;
                }
            }
        };

        if (stockFilter) {
            result = result.filter(p => applyNumberFilter(p.totalStock, stockFilter, String(p.totalStock)));
        }

        if (cpaFilter) {
            result = result.filter(p => applyNumberFilter(p.cpa, cpaFilter, p.cpa.toFixed(1)));
        }

        if (monthsFilter) {
            result = result.filter(p => applyNumberFilter(p.months, monthsFilter, p.months === 999 ? '∞' : p.months.toFixed(1)));
        }

        return result;
    }, [productOptions, productSearch, statusFilter, reviewFilter, reviewedProducts, tipoFilter, petFilter, estFilter, stockFilter, cpaFilter, monthsFilter]);

    const microredStats = useMemo(() => {
        if (selectedMicrored.length === 0) return null;
        const mrRecords = selectedMicrored.includes('ALL') ? records : records.filter(r => selectedMicrored.includes(r.microred));
        const establishments = new Set(mrRecords.map(r => r.codEess)).size;
        const totalItems = mrRecords.length;
        const uniqueProducts = new Set(mrRecords.map(r => r.medCode)).size;
        return { establishments, totalItems, uniqueProducts };
    }, [selectedMicrored, records]);

    const establishmentOptions = useMemo(() => {
        if (selectedMicrored.length === 0) return [];
        const mrRecords = selectedMicrored.includes('ALL') ? records : records.filter(r => selectedMicrored.includes(r.microred));
        const establishments = Array.from(new Map(mrRecords.map(r => [r.codEess, r.establishmentName])).entries())
            .map(([cod, name]) => ({ cod, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return establishments;
    }, [records, selectedMicrored]);

    const handleEstablishmentChange = (establishmentCod: string) => {
        if (establishmentCod === 'ALL') {
            setSelectedEstablishment([]);
            setSelectedEstablecimientoFilter([]);
            setSelectedStockFilter(null);
            setSelectedSumaConsFilter(null);
            setSelectedMesesConsFilter(null);
            setSelectedCpaFilter(null);
            setSelectedMesesFilter(null);
            setSelectedSituacion([]);
            return;
        }
        
        let newSelection = [...selectedEstablishment];
        
        if (newSelection.includes(establishmentCod)) {
            newSelection = newSelection.filter(e => e !== establishmentCod);
        } else {
            newSelection.push(establishmentCod);
        }
        
        setSelectedEstablishment(newSelection);
        setSelectedEstablecimientoFilter([]);
        setSelectedStockFilter(null);
        setSelectedSumaConsFilter(null);
        setSelectedMesesConsFilter(null);
        setSelectedCpaFilter(null);
        setSelectedMesesFilter(null);
        setSelectedSituacion([]);
        setSelectedProductCode('');
        setSelectedProductName('');
        setProductSearch('');
        setStatusFilter([]);
        setReviewFilter([]);
        setTipoFilter([]);
        setPetFilter([]);
        setEstFilter([]);
        setStockFilter(null);
        setCpaFilter(null);
        setMonthsFilter(null);
    };
    const handleMicroredChange = (microred: string) => {
        if (microred === 'ALL') {
            setSelectedMicrored(['ALL']);
            setSelectedEstablishment([]);
            setSelectedEstablecimientoFilter([]);
            setSelectedStockFilter(null);
            setSelectedSumaConsFilter(null);
            setSelectedMesesConsFilter(null);
            setSelectedCpaFilter(null);
            setSelectedMesesFilter(null);
            setSelectedSituacion([]);
            setProductSearch('');
            setStatusFilter([]);
            setReviewFilter([]);
            setTipoFilter([]);
            setPetFilter([]);
            setEstFilter([]);
            setStockFilter(null);
            setCpaFilter(null);
            setMonthsFilter(null);
            return;
        }
        
        let newSelection = [...selectedMicrored];
        if (newSelection.includes('ALL')) {
            newSelection = [];
        }
        
        if (newSelection.includes(microred)) {
            newSelection = newSelection.filter(m => m !== microred);
        } else {
            newSelection.push(microred);
        }
        
        if (newSelection.length === 0) {
            newSelection = ['ALL'];
        }
        
        setSelectedMicrored(newSelection);
        setSelectedEstablishment([]);
        setSelectedEstablecimientoFilter([]);
        setSelectedStockFilter(null);
        setSelectedSumaConsFilter(null);
        setSelectedMesesConsFilter(null);
        setSelectedCpaFilter(null);
        setSelectedMesesFilter(null);
        setSelectedSituacion([]);
        setSelectedProductCode('');
        setSelectedProductName('');
        setProductSearch('');
        setStatusFilter([]);
        setReviewFilter([]);
        setTipoFilter([]);
        setPetFilter([]);
        setEstFilter([]);
        setStockFilter(null);
        setCpaFilter(null);
        setMonthsFilter(null);
    };

    const calculateNeed = (stock: number, cpa: number, status: string, consumptionMonths: number): number => {
        const stockNum = Number(stock);
        const cpaNum = Number(cpa);
        const monthsNum = Number(consumptionMonths);

        // Formula: NEED = (CPA * 6) - STOCK
        if (status === "Sin Rotación") return 0;

        // Calculate with precision
        let need = (cpaNum * 6) - stockNum;

        // Apply adjustment for regular consumption (consumptionMonths > 6)
        if (monthsNum > 6) {
            need = Math.round(need) + Math.round(cpaNum);
        } else {
            need = Math.round(need);
        }

        // If balance is positive and status is SobreStock, consider balance 0
        // Case insensitive check for status
        if (need > 0 && String(status).toLowerCase() === "sobrestock") {
            return 0;
        }

        return need;
    };

    const handleProductChange = (productCode: string) => {
        setSelectedProductCode(productCode);
        setSelectedSituacion([]);
        setSelectedEstablecimientoFilter([]);
        setSelectedStockFilter(null);
        setSelectedSumaConsFilter(null);
        setSelectedMesesConsFilter(null);
        setSelectedCpaFilter(null);
        setSelectedMesesFilter(null);

        // Find and set product name
        const product = productOptions.find(p => p.code === productCode);
        if (product) setSelectedProductName(product.name);

        if (!productCode) {
            setSelectedProductName('');
            return;
        }
    };

    const baseRedistributionData = useMemo(() => {
        if (!selectedProductCode || selectedMicrored.length === 0 || records.length === 0) return [];

        const allEstablishments: { cod: string, name: string, microred: string }[] = Array.from(new Set(
            records
                .filter(r => selectedMicrored.includes('ALL') || selectedMicrored.includes(r.microred))
                .map(r => JSON.stringify({ cod: r.codEess, name: r.establishmentName, microred: r.microred }))
        )).map(s => JSON.parse(s));


        if (systemConfig.warehouseCode && systemConfig.warehouseName) {
            if (!allEstablishments.find(e => e.cod === systemConfig.warehouseCode)) {
                allEstablishments.push({
                    cod: systemConfig.warehouseCode,
                    name: systemConfig.warehouseName,
                    microred: 'ALMACEN'
                });
            }
        }

        const productRecords = records.filter(r =>
            r.medCode === selectedProductCode && (
                selectedMicrored.includes('ALL') ||
                selectedMicrored.includes(r.microred)
            )
        );

        const transfersForProduct = transferList.filter(t => t.productCode === selectedProductCode);
        const simDataForProduct = simulationData[selectedProductCode] || {};
        const cpaAdjForProduct = cpaAdjustments[selectedProductCode] || {};

        const initialData: RedistributionItem[] = allEstablishments.map(eess => {
            const r = productRecords.find(pr => pr.codEess === eess.cod);

            const transferQty = transfersForProduct.filter(t => t.originCod === eess.cod).reduce((sum, t) => sum + t.quantity, 0);
            const receivedQty = transfersForProduct.filter(t => t.destinationCod === eess.cod).reduce((sum, t) => sum + t.quantity, 0);

            const simQty = simDataForProduct[eess.cod]?.qty || 0;
            const simInput = simDataForProduct[eess.cod]?.input || '';

            const isWarehouse = eess.cod === systemConfig.warehouseCode;

            if (r) {
                const history = Array.isArray(r.monthlyConsumption) ? r.monthlyConsumption : Array(12).fill(0);
                const analysis = calculateAdjustedCPM(history);
                const noSpikes = (analysis.spikes || 0) === 0;
                const isEqual = analysis.adjusted.toFixed(1) === analysis.raw.toFixed(1);
                const defaultMode = (noSpikes || isEqual) ? 'SIMPLE' : 'ADJUSTED';

                let currentCpa = defaultMode === 'SIMPLE' ? analysis.raw : analysis.adjusted;
                let currentMode: 'ADJUSTED' | 'SIMPLE' = defaultMode;
                let currentMonthsProvision = 0;
                let currentStatus = '';

                const adjustment = cpaAdjForProduct[eess.cod];
                if (adjustment) {
                    currentCpa = adjustment.cpa;
                    currentMode = adjustment.mode;
                }

                if (currentCpa > 0.01) {
                    currentMonthsProvision = r.stock / currentCpa;
                } else if (r.stock > 0) {
                    currentMonthsProvision = 999;
                } else {
                    currentMonthsProvision = 0;
                }

                if (r.stock === 0) {
                    currentStatus = 'Desabastecido';
                } else if (currentCpa <= 0.01) {
                    currentStatus = 'Sin Rotación';
                } else if (currentMonthsProvision < 2) {
                    currentStatus = 'SubStock';
                } else if (currentMonthsProvision > 6) {
                    currentStatus = 'SobreStock';
                } else {
                    currentStatus = 'NormoStock';
                }

                const need = calculateNeed(r.stock, currentCpa, currentStatus, Number(r.consumptionMonths || 0));

                return {
                    codEess: r.codEess,
                    establishmentName: r.establishmentName,
                    microred: r.microred,
                    stock: r.stock,
                    cpa: currentCpa,
                    monthsProvision: currentMonthsProvision,
                    status: currentStatus,
                    transferQty,
                    receivedQty,
                    need: need,
                    consumptionSum: r.consumptionSum || 0,
                    consumptionMonths: r.consumptionMonths || 0,
                    monthlyConsumption: Array.isArray(r.monthlyConsumption) ? r.monthlyConsumption : Array(12).fill(0),
                    simulationQty: simQty,
                    simulationInput: simInput,
                    isWarehouse,
                    cpaMode: currentMode
                };
            } else {
                return {
                    codEess: eess.cod,
                    establishmentName: eess.name,
                    microred: eess.microred,
                    stock: 0,
                    cpa: 0,
                    monthsProvision: 0,
                    status: 'Sin Stock',
                    transferQty,
                    receivedQty,
                    need: 0,
                    consumptionSum: 0,
                    consumptionMonths: 0,
                    monthlyConsumption: Array(12).fill(0),
                    simulationQty: simQty,
                    simulationInput: simInput,
                    isWarehouse,
                    cpaMode: 'SIMPLE'
                };
            }
        });

        const baseNamesMap: Record<string, string> = {};
        allEstablishments.forEach(e => {
            const cod = String(e.cod || '');
            if (cod.endsWith('F01')) {
                baseNamesMap[cod.substring(0, 5)] = String(e.name || '');
            }
        });

        initialData.forEach(item => {
            const cod = String(item.codEess || '');
            let sortName = String(item.establishmentName || '');
            if (/F\d{2}$/.test(cod)) {
                const baseCod = cod.substring(0, 5);
                if (baseNamesMap[baseCod]) {
                    sortName = baseNamesMap[baseCod];
                }
            }
            (item as any)._sortName = sortName;
        });

        initialData.sort((a, b) => {
            if (a.isWarehouse) return -1;
            if (b.isWarehouse) return 1;

            // If multiple microreds are selected, group by Microred first
            if (selectedMicrored.includes('ALL') || selectedMicrored.length > 1) {
                const microredA = String(a.microred || '');
                const microredB = String(b.microred || '');
                if (microredA !== microredB) {
                    return microredA.localeCompare(microredB);
                }
            }

            const nameA = (a as any)._sortName;
            const nameB = (b as any)._sortName;

            if (nameA === nameB) {
                return String(a.codEess || '').localeCompare(String(b.codEess || ''));
            }
            return nameA.localeCompare(nameB);
        });

        initialData.forEach(item => {
            delete (item as any)._sortName;
        });

        return initialData;
    }, [records, selectedMicrored, selectedProductCode, transferList, simulationData, cpaAdjustments, systemConfig]);

    // Memoized data for Global Search Modal
    const globalNetworkData = useMemo(() => {
        if (!selectedProductCode || records.length === 0) return [];

        // Get all establishments that have this product across the entire network, excluding the selected microred
        const productRecords = records.filter(r =>
            r.medCode === selectedProductCode &&
            r.stock > 0 &&
            (!selectedMicrored.includes('ALL') ? !selectedMicrored.includes(r.microred) : true)
        );

        const transfersForProduct = transferList.filter(t => t.productCode === selectedProductCode);
        const simDataForProduct = simulationData[selectedProductCode] || {};
        const cpaAdjForProduct = cpaAdjustments[selectedProductCode] || {};

        return productRecords.map(r => {
            const transferQty = transfersForProduct.filter(t => t.originCod === r.codEess).reduce((sum, t) => sum + t.quantity, 0);
            const receivedQty = transfersForProduct.filter(t => t.destinationCod === r.codEess).reduce((sum, t) => sum + t.quantity, 0);

            const simQty = simDataForProduct[r.codEess]?.qty || 0;
            const simInput = simDataForProduct[r.codEess]?.input || '';

            const history = Array.isArray(r.monthlyConsumption) ? r.monthlyConsumption : Array(12).fill(0);
            const analysis = calculateAdjustedCPM(history);
            const noSpikes = (analysis.spikes || 0) === 0;
            const isEqual = analysis.adjusted.toFixed(1) === analysis.raw.toFixed(1);
            const defaultMode = (noSpikes || isEqual) ? 'SIMPLE' : 'ADJUSTED';

            let currentCpa = defaultMode === 'SIMPLE' ? analysis.raw : analysis.adjusted;
            let currentMode: 'ADJUSTED' | 'SIMPLE' = defaultMode;
            let currentMonthsProvision = 0;
            let currentStatus = '';

            const adjustment = cpaAdjForProduct[r.codEess];
            if (adjustment) {
                currentCpa = adjustment.cpa;
                currentMode = adjustment.mode;
            }

            if (currentCpa > 0.01) {
                currentMonthsProvision = r.stock / currentCpa;
            } else if (r.stock > 0) {
                currentMonthsProvision = 999;
            } else {
                currentMonthsProvision = 0;
            }

            if (r.stock === 0) {
                currentStatus = 'Desabastecido';
            } else if (currentCpa <= 0.01) {
                currentStatus = 'Sin Rotación';
            } else if (currentMonthsProvision < 2) {
                currentStatus = 'SubStock';
            } else if (currentMonthsProvision > 6) {
                currentStatus = 'SobreStock';
            } else {
                currentStatus = 'NormoStock';
            }

            return {
                codEess: r.codEess,
                establishmentName: r.establishmentName,
                microred: r.microred,
                stock: r.stock,
                cpa: currentCpa,
                monthsProvision: currentMonthsProvision,
                status: currentStatus,
                transferQty,
                receivedQty,
                need: calculateNeed(r.stock, currentCpa, currentStatus, Number(r.consumptionMonths || 0)),
                consumptionSum: r.consumptionSum || 0,
                consumptionMonths: r.consumptionMonths || 0,
                monthlyConsumption: Array.isArray(r.monthlyConsumption) ? r.monthlyConsumption : Array(12).fill(0),
                simulationQty: simQty,
                simulationInput: simInput,
                cpaMode: currentMode,
                isWarehouse: false
            };
        }).sort((a, b) => b.stock - a.stock);
    }, [selectedProductCode, records, transferList, simulationData, cpaAdjustments]);

    const redistributionData = useMemo(() => {
        let result = baseRedistributionData;

        if (consolidationSelection.size > 0) {
            const processedSecondaries = new Set<string>();
            const workingData = baseRedistributionData.map(item => ({
                ...item,
                monthlyConsumption: Array.isArray(item.monthlyConsumption) ? [...item.monthlyConsumption] : Array(12).fill(0)
            }));

            workingData.forEach(item => {
                if (consolidationSelection.has(item.codEess)) {
                    const safeCodEess = String(item.codEess || '');
                    const baseCode = safeCodEess.substring(0, 5);
                    const principalCode = baseCode + 'F01';
                    const principalItem = workingData.find(p => p.codEess === principalCode);

                    if (principalItem) {
                        processedSecondaries.add(item.codEess);

                        principalItem.stock += item.stock;

                        if (Array.isArray(principalItem.monthlyConsumption) && Array.isArray(item.monthlyConsumption)) {
                            for (let i = 0; i < 12; i++) {
                                principalItem.monthlyConsumption[i] = (Number(principalItem.monthlyConsumption[i]) || 0) + (Number(item.monthlyConsumption[i]) || 0);
                            }
                            principalItem.consumptionSum = principalItem.monthlyConsumption.reduce((a, b) => a + b, 0);
                            principalItem.consumptionMonths = principalItem.monthlyConsumption.filter(v => v > 0).length;
                            if (principalItem.consumptionMonths > 0) {
                                principalItem.cpa = (principalItem.consumptionSum || 0) / principalItem.consumptionMonths;
                            } else {
                                principalItem.cpa = 0;
                            }
                        } else {
                            principalItem.cpa += item.cpa;
                            principalItem.consumptionSum = (principalItem.consumptionSum || 0) + (item.consumptionSum || 0);
                            principalItem.consumptionMonths = Math.max(principalItem.consumptionMonths || 0, item.consumptionMonths || 0);
                        }

                        if (principalItem.cpa > 0.01) {
                            principalItem.monthsProvision = principalItem.stock / principalItem.cpa;
                        } else {
                            principalItem.monthsProvision = principalItem.stock > 0 ? 999 : 0;
                        }

                        if (principalItem.stock === 0) principalItem.status = 'Desabastecido';
                        else if (principalItem.cpa <= 0.01) principalItem.status = 'Sin Rotación';
                        else if (principalItem.monthsProvision < 2) principalItem.status = 'SubStock';
                        else if (principalItem.monthsProvision > 6) principalItem.status = 'SobreStock';
                        else principalItem.status = 'NormoStock';

                        const baseNeed = calculateNeed(principalItem.stock, principalItem.cpa, principalItem.status, principalItem.consumptionMonths || 0);
                        let baseRedist = 0;
                        if (principalItem.status === 'SobreStock' && principalItem.monthsProvision > 6) {
                            baseRedist = Math.floor(principalItem.stock - (6 * principalItem.cpa));
                        }
                        principalItem.need = baseNeed > 0 ? baseNeed : (baseRedist > 0 ? -baseRedist : 0);

                        principalItem.isConsolidated = true;
                    }
                }
            });

            result = workingData.filter(item => !processedSecondaries.has(item.codEess));
        }

        // Filter warehouse visibility
        return result.filter(item => {
            if (item.isWarehouse) {
                // Show only if there's an active origin selection or active transfers/received
                return quickTransferSource !== null || (item.transferQty || 0) > 0 || (item.receivedQty || 0) > 0;
            }
            return true;
        });
    }, [baseRedistributionData, consolidationSelection, quickTransferSource]);

    const filteredRedistributionData = useMemo(() => {
        return redistributionData.filter(item => {
            if (selectedSituacion.length > 0 && !selectedSituacion.includes(item.status || 'N/A')) return false;
            if (selectedEstablecimientoFilter.length > 0 && !selectedEstablecimientoFilter.includes(item.establishmentName || 'N/A')) return false;
            
            const applyNumberFilter = (value: number, filter: NumberFilterState | null, stringValue: string) => {
                if (!filter) return true;
                if (filter.type === 'list') {
                    if (filter.listValues.length === 0) return true;
                    return filter.listValues.includes(stringValue);
                } else {
                    const v1 = Number(filter.value1);
                    const v2 = Number(filter.value2);
                    switch (filter.condition) {
                        case 'EQUALS': return value === v1;
                        case 'NOT_EQUALS': return value !== v1;
                        case 'GREATER_THAN': return value > v1;
                        case 'GREATER_THAN_OR_EQUAL': return value >= v1;
                        case 'LESS_THAN': return value < v1;
                        case 'LESS_THAN_OR_EQUAL': return value <= v1;
                        case 'BETWEEN': return value >= v1 && value <= v2;
                        default: return true;
                    }
                }
            };

            if (!applyNumberFilter(item.stock, selectedStockFilter, String(item.stock))) return false;
            if (!applyNumberFilter(item.consumptionSum || 0, selectedSumaConsFilter, String(item.consumptionSum || 0))) return false;
            if (!applyNumberFilter(item.consumptionMonths || 0, selectedMesesConsFilter, String(item.consumptionMonths || 0))) return false;
            if (!applyNumberFilter(item.cpa, selectedCpaFilter, item.cpa.toFixed(1))) return false;
            
            const itemMesesStr = item.monthsProvision === 999 ? '∞' : item.monthsProvision.toFixed(1);
            if (!applyNumberFilter(item.monthsProvision, selectedMesesFilter, itemMesesStr)) return false;

            return true;
        });
    }, [redistributionData, selectedSituacion, selectedEstablecimientoFilter, selectedStockFilter, selectedSumaConsFilter, selectedMesesConsFilter, selectedCpaFilter, selectedMesesFilter]);

    const situacionOptions = useMemo(() => Array.from(new Set(redistributionData.map(item => item.status || 'N/A'))).map(s => ({ value: s, label: s })), [redistributionData]);
    const establecimientoOptions = useMemo(() => Array.from(new Set(redistributionData.map(item => item.establishmentName || 'N/A'))).map(e => ({ value: e, label: e })), [redistributionData]);
    const mesesOptions = useMemo(() => {
        const uniqueValues = Array.from(new Set(redistributionData.map(item => item.monthsProvision === 999 ? '∞' : item.monthsProvision.toFixed(1))));
        return uniqueValues.sort((a, b) => {
            if (a === '∞') return 1;
            if (b === '∞') return -1;
            return parseFloat(a) - parseFloat(b);
        }).map(s => ({ value: s, label: s }));
    }, [redistributionData]);

    const prevSituacionOptions = React.useRef<string[]>([]);
    const prevEstablecimientoOptions = React.useRef<string[]>([]);

    useEffect(() => {
        const currentSituacion = situacionOptions.map(o => o.value);
        if (currentSituacion.length > 0) {
            const newOptions = currentSituacion.filter(o => !prevSituacionOptions.current.includes(o));
            setSelectedSituacion(prev => {
                if (prev.length === 0) return currentSituacion;
                if (newOptions.length > 0) {
                    return Array.from(new Set([...prev, ...newOptions]));
                }
                return prev;
            });
        }
        prevSituacionOptions.current = currentSituacion;

        const currentEstablecimiento = establecimientoOptions.map(o => o.value);
        if (currentEstablecimiento.length > 0) {
            const newOptions = currentEstablecimiento.filter(o => !prevEstablecimientoOptions.current.includes(o));
            setSelectedEstablecimientoFilter(prev => {
                if (prev.length === 0) return currentEstablecimiento;
                if (newOptions.length > 0) {
                    return Array.from(new Set([...prev, ...newOptions]));
                }
                return prev;
            });
        }
        prevEstablecimientoOptions.current = currentEstablecimiento;
    }, [situacionOptions, establecimientoOptions]);

    const handleSimulationChange = (codEess: string, value: string) => {
        let numValue = 0;

        if (value === '' || value === '-') {
            numValue = 0;
        } else {
            const parsed = parseInt(value);
            if (!isNaN(parsed)) {
                numValue = parsed;
            } else {
                return; // Invalid input (e.g. letters), ignore
            }
        }

        setSimulationData(prev => ({
            ...prev,
            [selectedProductCode]: {
                ...(prev[selectedProductCode] || {}),
                [codEess]: { qty: numValue, input: value }
            }
        }));
    };

    // --- CONSOLIDATION HANDLERS ---
    const handleOpenConsolidateModal = () => {
        if (baseRedistributionData.length === 0) {
            toast.error("No hay datos para consolidar.");
            return;
        }
        setIsConsolidateModalOpen(true);
    };

    const toggleConsolidation = (codEess: string) => {
        setConsolidationSelection(prev => {
            const next = new Set(prev);
            if (next.has(codEess)) {
                next.delete(codEess);
            } else {
                next.add(codEess);
            }
            return next;
        });
    };

    const toggleGroupConsolidation = (secondaries: RedistributionItem[]) => {
        setConsolidationSelection(prev => {
            const next = new Set(prev);
            const allSelected = secondaries.every(s => prev.has(s.codEess));

            if (allSelected) {
                secondaries.forEach(s => next.delete(s.codEess));
            } else {
                secondaries.forEach(s => next.add(s.codEess));
            }
            return next;
        });
    };

    const applyConsolidationSelection = () => {
        setIsConsolidateModalOpen(false);
        toast.success("Vista actualizada");
    };

    const handleQuickConsolidation = (e: React.MouseEvent, principalCodEess: string) => {
        e.stopPropagation();
        const baseCode = String(principalCodEess || '').substring(0, 5);
        const secondaries = baseRedistributionData.filter(item =>
            String(item.codEess || '').startsWith(baseCode) && item.codEess !== principalCodEess
        );

        if (secondaries.length > 0) {
            setConsolidationSelection(prev => {
                const next = new Set(prev);
                let added = false;
                secondaries.forEach(s => {
                    if (!next.has(s.codEess)) {
                        next.add(s.codEess);
                        added = true;
                    }
                });

                if (!added) {
                    secondaries.forEach(s => next.delete(s.codEess));
                }

                return next;
            });

            // To avoid stale closures and React strict mode issues with toasts inside updaters
            const isAdding = secondaries.some(s => !consolidationSelection.has(s.codEess));
            if (!isAdding) {
                toast.info("Consolidación rápida removida", { duration: 2000 });
            } else {
                toast.success("Farmacias consolidadas rápidamente", { duration: 2000 });
            }
        } else {
            toast.info("No hay farmacias secundarias en este establecimiento", { duration: 2000 });
        }
    };

    const toggleProductReview = (productCode: string) => {
        setReviewedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productCode)) {
                next.delete(productCode);
            } else {
                next.add(productCode);
            }
            return next;
        });
    };

    // --- 4. TRANSFER LOGIC ---

    const handleNavigateProduct = (direction: 'prev' | 'next') => {
        if (!selectedProductCode) return;

        const currentIndex = filteredProductOptions.findIndex(p => p.code === selectedProductCode);
        if (currentIndex === -1) return;

        const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

        if (newIndex >= 0 && newIndex < filteredProductOptions.length) {
            const nextProductCode = filteredProductOptions[newIndex].code;

            // Logic for NEXT direction
            if (direction === 'next') {
                const isAlreadyReviewed = reviewedProducts.has(selectedProductCode);

                if (!isAlreadyReviewed) {
                    if (autoReviewEnabled) {
                        // Auto-mark and navigate
                        setReviewedProducts(prev => new Set(prev).add(selectedProductCode));
                        handleProductChange(nextProductCode);
                    } else {
                        // Show modal
                        setPendingNextProductCode(nextProductCode);
                        setIsReviewConfirmOpen(true);
                    }
                    return;
                }
            }

            // Default navigation (Prev or Next if already reviewed)
            handleProductChange(nextProductCode);
        }
    };

    const handleConfirmReviewNavigation = (shouldMarkReviewed: boolean) => {
        if (shouldMarkReviewed && selectedProductCode) {
            setReviewedProducts(prev => new Set(prev).add(selectedProductCode));
        }

        if (pendingNextProductCode) {
            handleProductChange(pendingNextProductCode);
        }

        setIsReviewConfirmOpen(false);
        setPendingNextProductCode(null);
    };

    const handleOpenDetailModal = (item: RedistributionItem) => {
        setSelectedDetailItem(item);
        setIsDetailModalOpen(true);
    };

    const handleNavigateDetailItem = (direction: 'prev' | 'next') => {
        if (!selectedDetailItem) return;

        let currentList = redistributionData;
        if (isGlobalSearchModalOpen) {
            currentList = globalNetworkData.filter(item =>
                item.establishmentName.toLowerCase().includes(globalSearchTerm.toLowerCase()) ||
                item.codEess.toLowerCase().includes(globalSearchTerm.toLowerCase())
            );
        }

        const currentIndex = currentList.findIndex(item => item.codEess === selectedDetailItem.codEess);
        if (currentIndex === -1) return;

        const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

        if (newIndex >= 0 && newIndex < currentList.length) {
            setSelectedDetailItem(currentList[newIndex]);
        }
    };

    // --- SMART REDISTRIBUTION LOGIC ---
    // Removed as per user request

    // --- QUICK TRANSFER LOGIC ---
    const handleQuickTransferClick = (item: RedistributionItem, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent opening detail modal

        // If clicking the same source, deselect
        if (quickTransferSource?.codEess === item.codEess) {
            setQuickTransferSource(null);
            return;
        }

        // If no source selected, select this as source
        if (!quickTransferSource) {
            if (item.stock <= 0) {
                toast.error("Este establecimiento no tiene stock para transferir.");
                return;
            }
            setQuickTransferSource(item);
            toast.info(`Origen seleccionado: ${item.establishmentName}. Ahora seleccione el destino.`);
            return;
        }

        // If source selected, this is the destination
        if (quickTransferSource) {
            if (quickTransferSource.codEess === item.codEess) return; // Should be handled by deselect above but safety check

            // Set destination and open modal
            setQuickTransferDestination(item);

            // Calculate suggested quantity
            const maxTransfer = quickTransferSource.stock;
            const currentNeed = item.need || 0;
            const suggestedQty = currentNeed > 0 ? Math.min(maxTransfer, currentNeed) : 1;

            setQuickTransferQty(suggestedQty.toString());
            setIsQuickTransferConfirmOpen(true);
        }
    };

    const confirmQuickTransfer = () => {
        if (!quickTransferSource || !quickTransferDestination) return;

        const qty = parseInt(quickTransferQty);
        const maxTransfer = quickTransferSource.stock;

        if (isNaN(qty) || qty <= 0) {
            toast.error("Cantidad inválida.");
            return;
        }
        if (qty > maxTransfer) {
            toast.error(`No puede transferir más del stock disponible (${maxTransfer}).`);
            return;
        }

        // Add to list
        const newTransfer = {
            id: Date.now().toString(),
            productCode: selectedProductCode,
            productName: selectedProductName,
            quantity: qty,
            originCod: quickTransferSource.codEess,
            originName: quickTransferSource.establishmentName,
            destinationCod: quickTransferDestination.codEess,
            destinationName: quickTransferDestination.establishmentName
        };

        setTransferList(prev => [...prev, newTransfer]);

        toast.success("Transferencia agregada a la lista");

        // Reset state
        setQuickTransferSource(null);
        setQuickTransferDestination(null);
        setIsQuickTransferConfirmOpen(false);
        setQuickTransferQty('');
    };

    const cancelQuickTransfer = () => {
        setQuickTransferDestination(null);
        setIsQuickTransferConfirmOpen(false);
        setQuickTransferQty('');
        // We keep the source selected so they can choose another destination if they want
    };

    const removeTransferFromList = (id: string) => {
        const transfer = transferList.find(t => t.id === id);
        if (transfer) {
            toast.info("Transferencia revertida");
        }
        setTransferList(prev => prev.filter(t => t.id !== id));
    };

    const startEditingTransfer = (id: string, currentQty: number) => {
        setEditingTransferId(id);
        setEditingTransferQty(currentQty.toString());
    };

    const cancelEditingTransfer = () => {
        setEditingTransferId(null);
        setEditingTransferQty('');
    };

    const saveEditedTransfer = () => {
        if (!editingTransferId) return;
        
        const newQty = parseInt(editingTransferQty, 10);
        if (isNaN(newQty) || newQty <= 0) {
            toast.error("Ingrese una cantidad válida mayor a 0");
            return;
        }

        setTransferList(prev => prev.map(t => {
            if (t.id === editingTransferId) {
                return { ...t, quantity: newQty };
            }
            return t;
        }));
        
        toast.success("Cantidad actualizada correctamente");
        setEditingTransferId(null);
        setEditingTransferQty('');
    };

    const exportTransferList = () => {
        if (transferList.length === 0) return;

        const exportData = transferList.map(t => ({
            'COD. MED': t.productCode,
            'DESCRIPCION MED': t.productName,
            'CANTIDAD': t.quantity,
            'COD. EESS ORIGEN': t.originCod,
            'EESS ORIGEN': t.originName,
            'COD. EESS DESTINO': t.destinationCod,
            'EESS DESTINO': t.destinationName
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Distribución");
        const mrName = selectedMicrored.includes('ALL') ? 'Todas' : selectedMicrored.length === 1 ? selectedMicrored[0] : 'Varias';
        XLSX.writeFile(wb, `Lista_Distribucion_${mrName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    // --- 5. EXPORT FUNCTIONS ---
    // Removed as per user request

    const handleDownloadFilteredProducts = () => {
        if (filteredProductOptions.length === 0) {
            toast.error('No hay productos para descargar');
            return;
        }

        const exportData = filteredProductOptions.map(p => ({
            'Código': p.code,
            'Descripción': p.name,
            'TIPO': p.type || '',
            'PET': p.pet || '',
            'EST': p.est || '',
            'Mes 1': p.monthlyVector?.[0] || 0,
            'Mes 2': p.monthlyVector?.[1] || 0,
            'Mes 3': p.monthlyVector?.[2] || 0,
            'Mes 4': p.monthlyVector?.[3] || 0,
            'Mes 5': p.monthlyVector?.[4] || 0,
            'Mes 6': p.monthlyVector?.[5] || 0,
            'Mes 7': p.monthlyVector?.[6] || 0,
            'Mes 8': p.monthlyVector?.[7] || 0,
            'Mes 9': p.monthlyVector?.[8] || 0,
            'Mes 10': p.monthlyVector?.[9] || 0,
            'Mes 11': p.monthlyVector?.[10] || 0,
            'Mes 12': p.monthlyVector?.[11] || 0,
            'STOCK': p.totalStock,
            'CPA': Number(p.cpa).toFixed(2),
            'Meses': p.months === 999 ? '>99' : Number(p.months).toFixed(1),
            'Situación': p.status
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths
        ws['!cols'] = [
            { wch: 8 },   // Código
            { wch: 60 },  // Descripción
            { wch: 5 },   // TIPO
            { wch: 5 },   // PET
            { wch: 5 },   // EST
            { wch: 6 },   // Mes 1
            { wch: 6 },   // Mes 2
            { wch: 6 },   // Mes 3
            { wch: 6 },   // Mes 4
            { wch: 6 },   // Mes 5
            { wch: 6 },   // Mes 6
            { wch: 6 },   // Mes 7
            { wch: 6 },   // Mes 8
            { wch: 6 },   // Mes 9
            { wch: 7 },   // Mes 10
            { wch: 7 },   // Mes 11
            { wch: 7 },   // Mes 12
            { wch: 8 },   // STOCK
            { wch: 8 },   // CPA
            { wch: 8 },   // Meses
            { wch: 15 }   // Situación
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Productos Filtrados");
        
        const mrName = selectedMicrored.includes('ALL') ? 'Todas' : selectedMicrored.length === 1 ? selectedMicrored[0] : 'Varias';
        const fileName = `Productos_${mrName}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
        toast.success('Listado descargado correctamente');
    };

    const modalDynamicData = useMemo(() => {
        if (!selectedDetailItem) return null;

        const history = selectedDetailItem.monthlyConsumption || Array(12).fill(0);
        const analysis = calculateAdjustedCPM(history);
        
        let activeCpm = 0;

        if (modalExcludedIndices.length === 0) {
            activeCpm = modalCpaMode === 'SIMPLE' ? analysis.raw : analysis.adjusted;
        } else {
            const valuesToAverage: number[] = [];
            history.forEach((val, idx) => {
                if (val === 0) return;
                if (modalExcludedIndices.includes(idx)) return;

                if (modalCpaMode === 'SIMPLE') {
                    valuesToAverage.push(val);
                } else {
                    if (analysis.isSporadic) {
                        valuesToAverage.push(val);
                    } else {
                        if (val <= analysis.threshold) {
                            valuesToAverage.push(val);
                        }
                    }
                }
            });

            activeCpm = valuesToAverage.length > 0
                ? valuesToAverage.reduce((a, b) => a + b, 0) / valuesToAverage.length
                : 0;
        }

        const activeMonths = activeCpm > 0 
            ? selectedDetailItem.stock / activeCpm 
            : (selectedDetailItem.stock > 0 ? 999 : 0);

        let activeStatus = '';
        if (selectedDetailItem.stock === 0) {
            activeStatus = 'Desabastecido';
        } else if (activeCpm <= 0.01) {
            activeStatus = 'Sin Rotación';
        } else if (activeMonths < 2) {
            activeStatus = 'SubStock';
        } else if (activeMonths > 6) {
            activeStatus = 'SobreStock';
        } else {
            activeStatus = 'NormoStock';
        }

        return {
            cpm: activeCpm,
            months: activeMonths,
            status: activeStatus,
            analysis
        };
    }, [selectedDetailItem, modalCpaMode, modalExcludedIndices]);

    // Logic to determine if Adjusted and Simple CPA are effectively equal
    const isModalAdjustedEqualSimple = useMemo(() => {
        if (!modalDynamicData) return false;
        
        const isEqual = modalDynamicData.analysis.adjusted.toFixed(1) === modalDynamicData.analysis.raw.toFixed(1);
        const noSpikes = (modalDynamicData.analysis.spikes || 0) === 0;
        
        return isEqual || noSpikes;
    }, [modalDynamicData]);

    // Force SIMPLE mode if they are equal or no spikes
    useEffect(() => {
        if (isModalAdjustedEqualSimple && modalCpaMode !== 'SIMPLE') {
            setModalCpaMode('SIMPLE');
        }
    }, [isModalAdjustedEqualSimple, modalCpaMode]);

    useEffect(() => {
        if (selectedDetailItem && selectedProductCode && modalDynamicData) {
            setCpaAdjustments(curr => {
                const currentAdj = curr[selectedProductCode]?.[selectedDetailItem.codEess];
                if (currentAdj?.mode === modalCpaMode && 
                    currentAdj?.excludedIndices.join(',') === modalExcludedIndices.join(',') &&
                    currentAdj?.cpa === modalDynamicData.cpm) {
                    return curr;
                }
                return {
                    ...curr,
                    [selectedProductCode]: {
                        ...curr[selectedProductCode],
                        [selectedDetailItem.codEess]: {
                            mode: modalCpaMode,
                            excludedIndices: modalExcludedIndices,
                            cpa: modalDynamicData.cpm
                        }
                    }
                };
            });
        }
    }, [selectedDetailItem, selectedProductCode, modalCpaMode, modalExcludedIndices, modalDynamicData]);

    // --- KEYBOARD NAVIGATION ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isDetailModalOpen) return;
            if (e.key === 'ArrowLeft') {
                handleNavigateDetailItem('prev');
            } else if (e.key === 'ArrowRight') {
                handleNavigateDetailItem('next');
            } else if (e.key === 'Escape') {
                setIsDetailModalOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDetailModalOpen, handleNavigateDetailItem]);

    // --- RENDER ---
    if (!isLoaded) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-500 font-medium">Cargando datos guardados...</p>
                </div>
            </div>
        );
    }

    const renderProductListTable = (showMicroredFilter: boolean = false) => {
        const portalTarget = isFullscreen && tableContainerRef.current ? tableContainerRef.current : document.body;
        return (
        <>
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center gap-4">
                <div className="flex items-center gap-2.5 shrink-0">
                    <div className="p-1.5 bg-indigo-50 rounded-lg">
                        <Package className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-800 leading-tight">Lista de Productos</span>
                        <span className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">{filteredProductOptions.length} disponibles</span>
                    </div>
                </div>

                {/* Spacer to push filters to the right */}
                <div className="flex-1" />

                {showMicroredFilter && (
                    /* Microred Filter (Searchable Dropdown) */
                    <div className="flex-1 max-w-[240px] flex items-center gap-2">
                        <div className="relative flex-1 group">
                            <div
                                onClick={() => setIsProductListMrDropdownOpen(!isProductListMrDropdownOpen)}
                                className={`w-full pl-4 pr-10 py-2 text-[11px] bg-white border ${isProductListMrDropdownOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200'} rounded-xl text-gray-900 font-bold transition-all cursor-pointer shadow-sm flex items-center justify-between min-h-[34px]`}
                            >
                                <span className="truncate">
                                    {selectedMicrored.includes('ALL') 
                                        ? 'TODAS LAS MICROREDES' 
                                        : selectedMicrored.length > 0 
                                            ? selectedMicrored.length === 1 ? selectedMicrored[0] : `${selectedMicrored.length} seleccionadas`
                                            : '-- Seleccione Microred --'}
                                </span>
                                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isProductListMrDropdownOpen ? 'rotate-180' : ''}`} />
                            </div>

                            {isProductListMrDropdownOpen && createPortal(
                                <>
                                    <div
                                        className="fixed inset-0 z-[99999]"
                                        onClick={() => setIsProductListMrDropdownOpen(false)}
                                    />
                                    <div 
                                        className="fixed mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-[100000] overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200"
                                        style={{
                                            top: productListMrTriggerRef.current ? productListMrTriggerRef.current.getBoundingClientRect().bottom : 0,
                                            left: productListMrTriggerRef.current ? productListMrTriggerRef.current.getBoundingClientRect().left : 0,
                                            width: productListMrTriggerRef.current ? productListMrTriggerRef.current.getBoundingClientRect().width : 'auto',
                                            visibility: productListMrTriggerRef.current ? 'visible' : 'hidden'
                                        }}
                                    >
                                        <div className="p-2 border-b border-gray-100 bg-gray-50">
                                            <div className="relative">
                                                <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    placeholder="Buscar microred..."
                                                    className="w-full pl-8 pr-3 py-1.5 text-[10px] bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                    value={mrSearchTerm}
                                                    onChange={(e) => setMrSearchTerm(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-[200px] overflow-y-auto py-1 custom-scrollbar">
                                            <button
                                                onClick={() => {
                                                    handleMicroredChange('ALL');
                                                    setIsProductListMrDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-[10px] hover:bg-indigo-50 transition-colors flex items-center gap-2 ${selectedMicrored.includes('ALL') ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-700'}`}
                                            >
                                                <Building2 className="h-3 w-3 opacity-50" />
                                                TODAS LAS MICROREDES
                                            </button>
                                            {microredOptions
                                                .filter(mr => mr.toLowerCase().includes(mrSearchTerm.toLowerCase()))
                                                .map(mr => (
                                                    <button
                                                        key={mr}
                                                        onClick={() => {
                                                            handleMicroredChange(mr);
                                                            setIsProductListMrDropdownOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 text-[10px] hover:bg-indigo-50 transition-colors flex items-center gap-2 ${selectedMicrored.includes(mr) ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-700'}`}
                                                    >
                                                        <div className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${selectedMicrored.includes(mr) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                                                            {selectedMicrored.includes(mr) && <Check className="h-2 w-2 text-white" />}
                                                        </div>
                                                        <span className="truncate">{mr}</span>
                                                    </button>
                                                ))
                                            }
                                            {microredOptions.filter(mr => mr.toLowerCase().includes(mrSearchTerm.toLowerCase())).length === 0 && (
                                                <div className="px-3 py-4 text-center text-[10px] text-gray-400 italic">
                                                    No se encontraron resultados
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>,
                                document.body
                            )}
                        </div>
                    </div>
                )}

                {/* Establishment Filter (Searchable Dropdown) */}
                <div className="flex-1 max-w-[320px] flex items-center gap-2">
                    <div className="relative flex-1 group" ref={productListEstTriggerRef}>
                        <div
                            onClick={() => !(selectedMicrored.length === 0) && setIsEstDropdownOpen(!isEstDropdownOpen)}
                            className={`w-full pl-4 pr-10 py-2 text-[11px] bg-white border ${isEstDropdownOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200'} rounded-xl text-gray-900 font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-between min-h-[34px] ${selectedMicrored.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <span className="truncate">
                                {selectedEstablishment.length === 0
                                    ? '-- Todos los Establecimientos --'
                                    : selectedEstablishment.length === 1
                                        ? establishmentOptions.find(e => e.cod === selectedEstablishment[0])?.name
                                        : `${selectedEstablishment.length} seleccionados`}
                            </span>
                            <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isEstDropdownOpen ? 'rotate-180' : ''}`} />
                        </div>

                        {isEstDropdownOpen && createPortal(
                            <>
                                <div
                                    className="fixed inset-0 z-[99999]"
                                    onClick={() => setIsEstDropdownOpen(false)}
                                />
                                <div 
                                    className="fixed mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-[100000] overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200"
                                    style={{
                                        top: productListEstTriggerRef.current ? productListEstTriggerRef.current.getBoundingClientRect().bottom : 0,
                                        left: productListEstTriggerRef.current ? productListEstTriggerRef.current.getBoundingClientRect().left : 0,
                                        width: productListEstTriggerRef.current ? productListEstTriggerRef.current.getBoundingClientRect().width : 'auto',
                                        visibility: productListEstTriggerRef.current ? 'visible' : 'hidden'
                                    }}
                                >
                                    <div className="p-2 border-b border-gray-100 bg-gray-50">
                                        <div className="relative">
                                            <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="text"
                                                autoFocus
                                                placeholder="Buscar establecimiento..."
                                                className="w-full pl-8 pr-3 py-1.5 text-[10px] bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                value={estSearchTerm}
                                                onChange={(e) => setEstSearchTerm(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto py-1 custom-scrollbar">
                                        <button
                                            onClick={() => {
                                                handleEstablishmentChange('ALL');
                                                setIsEstDropdownOpen(false);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-[10px] hover:bg-indigo-50 transition-colors flex items-center gap-2 ${selectedEstablishment.length === 0 ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-700'}`}
                                        >
                                            <Building2 className="h-3 w-3 opacity-50" />
                                            -- Todos los Establecimientos --
                                        </button>
                                        {establishmentOptions
                                            .filter(e => e.name.toLowerCase().includes(estSearchTerm.toLowerCase()))
                                            .map(est => (
                                                <button
                                                    key={est.cod}
                                                    onClick={() => {
                                                        handleEstablishmentChange(est.cod);
                                                        setIsEstDropdownOpen(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-[10px] hover:bg-indigo-50 transition-colors flex items-center gap-2 ${selectedEstablishment.includes(est.cod) ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-700'}`}
                                                >
                                                    <div className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${selectedEstablishment.includes(est.cod) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                                                        {selectedEstablishment.includes(est.cod) && <Check className="h-2 w-2 text-white" />}
                                                    </div>
                                                    <span className="truncate">{est.name}</span>
                                                </button>
                                            ))
                                        }
                                        {establishmentOptions.filter(e => e.name.toLowerCase().includes(estSearchTerm.toLowerCase())).length === 0 && (
                                            <div className="px-3 py-4 text-center text-[10px] text-gray-400 italic">
                                                No se encontraron resultados
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>,
                            document.body
                        )}
                    </div>
                    {selectedEstablishment.length > 0 && (
                        <button
                            onClick={() => handleEstablishmentChange('ALL')}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all shrink-0 border border-transparent hover:border-red-100"
                            title="Limpiar filtro"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Search Input */}
                <div className="flex-1 max-w-xs relative group">
                    <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-700 font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all shadow-sm"
                    />
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <div className="text-xs text-gray-500 font-normal">
                        {reviewedProducts.size} rev.
                    </div>
                    <button
                        onClick={handleDownloadFilteredProducts}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-transparent hover:border-emerald-100 flex items-center gap-1"
                        title="Descargar listado filtrado"
                    >
                        <Download className="h-4 w-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Excel</span>
                    </button>
                </div>
            </div>
            <div className="overflow-y-auto flex-1 p-0 custom-scrollbar">
                {productOptions.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm italic p-4">
                        Seleccione una Microred para ver los productos
                    </div>
                ) : (
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50/80 text-slate-500 font-bold text-xs uppercase tracking-widest sticky top-0 z-10 backdrop-blur-sm border-b border-slate-100">
                            <tr>
                                <th className="p-0 align-middle w-16 text-center">
                                    <MultiSelectFilter
                                        title="Rev."
                                        options={[
                                            { value: 'REVIEWED', label: 'Revisados' },
                                            { value: 'PENDING', label: 'Pendientes' }
                                        ]}
                                        selectedValues={reviewFilter}
                                        onChange={setReviewFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-2 w-20 text-left align-middle">Código</th>
                                <th className="p-2 text-left align-middle max-w-[350px]">Descripción</th>
                                <th className="p-0 align-middle w-16 text-center">
                                    <MultiSelectFilter
                                        title="TIPO"
                                        options={Array.from(new Set(productOptions.map(p => String(p.type || '').toUpperCase()).filter(Boolean))).sort().map(val => ({ value: val, label: val }))}
                                        selectedValues={tipoFilter}
                                        onChange={setTipoFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-0 align-middle w-14 text-center">
                                    <MultiSelectFilter
                                        title="PET"
                                        options={Array.from(new Set(productOptions.map(p => String(p.pet || '').toUpperCase()).filter(Boolean))).sort().map(val => ({ value: val, label: val }))}
                                        selectedValues={petFilter}
                                        onChange={setPetFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-0 align-middle w-14 text-center">
                                    <MultiSelectFilter
                                        title="EST"
                                        options={Array.from(new Set(productOptions.map(p => String(p.est || '').toUpperCase()).filter(Boolean))).sort().map(val => ({ value: val, label: val }))}
                                        selectedValues={estFilter}
                                        onChange={setEstFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-0 align-middle w-16 text-center text-blue-700 bg-blue-50/50">
                                    <NumberFilter
                                        title="STOCK"
                                        options={Array.from(new Set(productOptions.map(p => String(p.totalStock)))).sort((a, b) => Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                        filterState={stockFilter}
                                        onChange={setStockFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-0 align-middle w-16 text-center">
                                    <NumberFilter
                                        title="CPA"
                                        options={Array.from(new Set(productOptions.map(p => p.cpa.toFixed(1)))).sort((a, b) => Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                        filterState={cpaFilter}
                                        onChange={setCpaFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-0 align-middle w-16 text-center">
                                    <NumberFilter
                                        title="MESES"
                                        options={Array.from(new Set(productOptions.map(p => p.months === 999 ? '∞' : p.months.toFixed(1)))).sort((a, b) => a === '∞' ? 1 : b === '∞' ? -1 : Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                        filterState={monthsFilter}
                                        onChange={setMonthsFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                                <th className="p-0 align-middle w-32 text-center">
                                    <MultiSelectFilter
                                        title="Situación"
                                        options={[
                                            { value: 'NormoStock', label: 'NormoStock' },
                                            { value: 'SobreStock', label: 'SobreStock' },
                                            { value: 'SubStock', label: 'SubStock' },
                                            { value: 'Desabastecido', label: 'Desabastecido' },
                                            { value: 'Sin Rotación', label: 'Sin Rotación' }
                                        ]}
                                        selectedValues={statusFilter}
                                        onChange={setStatusFilter}
                                        portalTarget={portalTarget}
                                    />
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredProductOptions.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-4 text-center text-gray-400 italic text-xs">
                                        No se encontraron productos
                                    </td>
                                </tr>
                            ) : (
                                filteredProductOptions.map((prod) => {
                                    const isSelected = selectedProductCode === prod.code;
                                    const isReviewed = reviewedProducts.has(prod.code);

                                    let statusColor = "bg-slate-100 text-slate-600";
                                    if (prod.status === "NormoStock") statusColor = "bg-emerald-50 text-emerald-700 border-emerald-100";
                                    if (prod.status === "SobreStock") statusColor = "bg-indigo-50 text-indigo-700 border-indigo-100";
                                    if (prod.status === "SubStock") statusColor = "bg-amber-50 text-amber-700 border-amber-100";
                                    if (prod.status === "Desabastecido") statusColor = "bg-rose-50 text-rose-700 border-rose-100";
                                    if (prod.status === "Sin Rotación") statusColor = "bg-slate-200 text-slate-700 border-slate-300";

                                    return (
                                        <tr
                                            key={prod.code}
                                            className={`
                                        cursor-pointer transition-all duration-200 border-b border-slate-50
                                        ${isSelected ? 'bg-indigo-50/80 text-indigo-900' : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'}
                                    `}
                                            onClick={() => {
                                                handleProductChange(prod.code);
                                                if (isProductListModalOpen) {
                                                    setIsProductListModalOpen(false);
                                                }
                                            }}
                                        >
                                            <td className="p-2 text-center" onClick={(e) => { e.stopPropagation(); toggleProductReview(prod.code); }}>
                                                {isReviewed ? (
                                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                                ) : (
                                                    <Circle className="h-4 w-4 text-slate-200 mx-auto hover:text-slate-400 transition-colors" />
                                                )}
                                            </td>
                                            <td className="p-2 font-mono text-sm font-bold text-slate-500">{prod.code}</td>
                                            <td className="p-2 text-xs font-medium text-slate-800 truncate max-w-[350px]" title={prod.name}>{prod.name}</td>
                                            <td className="p-2 text-center text-xs text-slate-500 font-mono">{prod.type}</td>
                                            <td className="p-2 text-center text-xs text-slate-500 font-bold">{prod.pet}</td>
                                            <td className="p-2 text-center text-xs text-slate-500 font-bold">{prod.est}</td>
                                            <td className="p-2 text-center text-sm font-mono font-bold text-blue-700 bg-blue-50/30">{prod.totalStock}</td>
                                            <td className="p-2 text-center text-sm font-mono">{prod.cpa.toFixed(1)}</td>
                                            <td className="p-2 text-center text-sm font-mono font-bold">{prod.months === 999 ? '∞' : prod.months.toFixed(1)}</td>
                                            <td className="p-2 text-center">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter border ${statusColor}`}>
                                                    {prod.status}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </>
        );
    };

    return (
        <div className={`w-full mx-auto ${isFullscreen ? 'p-0 max-w-none' : 'p-6 max-w-[98%] space-y-6 animate-in fade-in duration-300'}`}>

            {/* HEADER */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <ArrowRightLeft className="h-6 w-6 text-teal-600" />
                        Módulo de Redistribución
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">
                        Gestión de transferencias entre establecimientos por Microred
                    </p>
                </div>
            </div>

            {/* UPLOAD SECTION */}
            <div className={`bg-white rounded-2xl shadow-lg border border-gray-100 transition-all hover:shadow-xl relative ${isUploadSectionCollapsed && records.length > 0 ? 'p-4' : 'p-8'}`}>
                {records.length > 0 && !loading && (
                    <button
                        onClick={() => setIsUploadSectionCollapsed(!isUploadSectionCollapsed)}
                        className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full transition-colors z-20"
                        title={isUploadSectionCollapsed ? "Expandir" : "Contraer"}
                    >
                        {isUploadSectionCollapsed ? <ChevronDown className="h-5 w-5 text-gray-500" /> : <ChevronUp className="h-5 w-5 text-gray-500" />}
                    </button>
                )}

                {isUploadSectionCollapsed && records.length > 0 && !loading ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="bg-indigo-50 p-2 rounded-lg">
                                <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-900">Archivo de Disponibilidad</h3>
                                <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-xs font-bold text-green-600">{records.length.toLocaleString()} registros</span>
                                    <span className="text-[10px] text-gray-400">•</span>
                                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                                        Validados correctamente
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 mr-10">
                            <button 
                                onClick={handleExportSession}
                                className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Exportar Avance"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => setIsConfirmImportModalOpen(true)}
                                className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Importar Avance"
                            >
                                <Upload className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => setIsConfirmUploadModalOpen(true)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Cargar nuevo archivo"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-center mt-8 sm:mt-0">

                        {loading ? (
                            <div className="py-12 flex flex-col items-center animate-in fade-in zoom-in duration-500">
                                <div className="relative">
                                    <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <FileSpreadsheet className="h-8 w-8 text-indigo-600 animate-pulse" />
                                    </div>
                                </div>
                                <h3 className="mt-6 text-xl font-bold text-gray-900">Procesando Archivo Excel</h3>
                                <p className="text-gray-500 mt-2 text-sm">Validando estructura y cargando registros...</p>
                            </div>
                        ) : (
                            <>
                                <div
                                    className="w-full max-w-2xl mx-auto border-2 border-dashed border-indigo-200 rounded-xl p-10 bg-indigo-50/30 hover:bg-indigo-50 transition-all group cursor-pointer relative"
                                    onClick={() => {
                                        if (records.length > 0) {
                                            setIsConfirmUploadModalOpen(true);
                                        } else {
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        accept=".xlsx, .xls"
                                        onChange={handleFileUpload}
                                        onClick={(e) => e.stopPropagation()}
                                        className="hidden"
                                    />
                                    <div className="flex flex-col items-center gap-4 group-hover:scale-105 transition-transform duration-300">
                                        <div className="bg-white p-4 rounded-full shadow-md group-hover:shadow-lg transition-shadow">
                                            <FileSpreadsheet className="h-10 w-10 text-indigo-600" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-900">Cargar Archivo de Disponibilidad</h3>
                                            <p className="text-sm text-gray-500 mt-1">Arrastre su archivo Excel aquí o haga clic para buscar</p>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-indigo-600 font-medium bg-indigo-100 px-3 py-1 rounded-full">
                                            <Sparkles className="h-3 w-3" />
                                            <span>Formato .xlsx o .xls requerido</span>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); downloadTemplate(); }}
                                            className="text-xs text-slate-500 hover:text-indigo-600 underline mt-2"
                                        >
                                            Descargar Plantilla Estándar
                                        </button>

                                        {/* Export/Import Session Buttons */}
                                        <div className="flex flex-row gap-4 mt-6 z-10">
                                            {records.length > 0 && (
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        e.preventDefault();
                                                        handleExportSession(); 
                                                    }}
                                                    className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 rounded-lg text-sm font-bold transition-all shadow-sm"
                                                    title="Exportar avance actual para continuar en otra PC"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    Exportar Avance
                                                </button>
                                            )}
                                            <button 
                                                onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    e.preventDefault();
                                                    if (records.length > 0) {
                                                        setIsConfirmImportModalOpen(true);
                                                    } else {
                                                        importInputRef.current?.click(); 
                                                    }
                                                }}
                                                className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 rounded-lg text-sm font-bold transition-all shadow-sm"
                                                title="Importar avance desde un archivo de respaldo"
                                            >
                                                <Upload className="w-4 h-4" />
                                                Importar Avance
                                            </button>
                                            <input 
                                                type="file" 
                                                ref={importInputRef} 
                                                accept=".json" 
                                                onChange={handleImportSession} 
                                                onClick={(e) => e.stopPropagation()}
                                                className="hidden" 
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Last Month Selection Modal */}
                                {isLastMonthModalOpen && (
                                    <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border-t-4 border-teal-600">
                                            <div className="p-6 sm:p-8 flex flex-col items-center text-center">
                                                <div className="bg-teal-100 p-4 rounded-full mb-4">
                                                    <Calendar className="h-8 w-8 text-teal-700" />
                                                </div>
                                                <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">Confirme la Fecha del Reporte</h3>
                                                <p className="text-xs sm:text-sm text-gray-500 mb-6">Para realizar un cálculo preciso, el sistema necesita saber a qué mes corresponde la última columna de datos.</p>
                                                
                                                <div className="w-full bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6 shadow-sm">
                                                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-center gap-1 mb-4">
                                                        MES DE CORTE (MES {detectedMonthsCount})
                                                    </label>
                                                    <input 
                                                        type="month"
                                                        value={lastMonthYear}
                                                        onChange={(e) => setLastMonthYear(e.target.value)}
                                                        className="w-full text-center px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-gray-900 font-bold text-lg shadow-sm bg-white hover:bg-gray-50 transition-colors cursor-pointer cursor-text"
                                                    />
                                                </div>

                                                <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex gap-3 text-left mb-6 w-full">
                                                    <span className="text-blue-600 shrink-0">ℹ️</span>
                                                    <p className="text-xs text-blue-800"><strong>Nota:</strong> Si descargó el reporte hoy, la fecha por defecto suele ser correcta.</p>
                                                </div>
                                                
                                                <button 
                                                    onClick={confirmFileProcessing}
                                                    className="w-full py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-bold flex items-center justify-center gap-2 transition-all shadow-md transform hover:scale-[1.02]"
                                                >
                                                    <Check className="h-5 w-5" />
                                                    Confirmar y Cargar Datos
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {records.length > 0 && (
                                    <div className="mt-8 flex items-center gap-6 animate-in slide-in-from-bottom-4 duration-500">
                                        <div className="text-center px-6 py-3 bg-green-50 rounded-xl border border-green-100">
                                            <span className="block text-3xl font-bold text-green-600">{records.length.toLocaleString()}</span>
                                            <span className="text-xs font-bold text-green-800 uppercase tracking-wider">Registros Cargados</span>
                                        </div>
                                        <div className="h-10 w-px bg-gray-200"></div>
                                        <div className="text-left">
                                            <p className="text-sm text-gray-600 flex items-center gap-2">
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                Datos validados correctamente
                                            </p>
                                            <p className="text-xs text-gray-400 mt-1">Listo para análisis de redistribución</p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {error && (
                            <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-xl text-sm flex items-center gap-3 border border-red-100 animate-in shake duration-300">
                                <AlertCircle className="h-5 w-5 shrink-0" />
                                <span className="font-medium">{error}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {records.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* MICRORED SELECTOR */}
                    <div className="md:col-span-3 bg-white p-5 rounded-xl shadow-sm border border-gray-200 min-h-[220px] flex flex-col relative z-30">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5 text-indigo-500" />
                            Seleccionar Microred
                        </label>

                        <div className="relative mb-3" ref={mrTriggerRef}>
                            <div
                                onClick={() => setIsMrDropdownOpen(!isMrDropdownOpen)}
                                className={`w-full pl-3 pr-10 py-2 bg-gray-50 border ${isMrDropdownOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200'} rounded-xl text-sm text-gray-900 font-bold transition-all cursor-pointer flex items-center justify-between min-h-[38px]`}
                            >
                                <span className="truncate">
                                    {selectedMicrored.includes('ALL') 
                                        ? 'TODAS LAS MICROREDES' 
                                        : selectedMicrored.length > 0 
                                            ? selectedMicrored.length === 1 ? selectedMicrored[0] : `${selectedMicrored.length} seleccionadas`
                                            : '-- Seleccione Microred --'}
                                </span>
                                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isMrDropdownOpen ? 'rotate-180' : ''}`} />
                            </div>

                            {isMrDropdownOpen && createPortal(
                                <>
                                    <div className="fixed inset-0 z-[99999]" onClick={() => setIsMrDropdownOpen(false)} />
                                    <div 
                                        className="fixed mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-[100000] overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200"
                                        style={{
                                            top: mrTriggerRef.current ? mrTriggerRef.current.getBoundingClientRect().bottom : 0,
                                            left: mrTriggerRef.current ? mrTriggerRef.current.getBoundingClientRect().left : 0,
                                            width: mrTriggerRef.current ? mrTriggerRef.current.getBoundingClientRect().width : 'auto',
                                            visibility: mrTriggerRef.current ? 'visible' : 'hidden'
                                        }}
                                    >
                                        <div className="p-2 border-b border-gray-100 bg-gray-50">
                                            <div className="relative">
                                                <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    placeholder="Buscar microred..."
                                                    className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                    value={mrSearchTerm}
                                                    onChange={(e) => setMrSearchTerm(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-[200px] overflow-y-auto py-1 custom-scrollbar">
                                            <button
                                                onClick={() => {
                                                    handleMicroredChange('ALL');
                                                    setIsMrDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-indigo-50 transition-colors flex items-center gap-2 ${selectedMicrored.includes('ALL') ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-700'}`}
                                            >
                                                <Building2 className="h-3.5 w-3.5 opacity-50" />
                                                TODAS LAS MICROREDES
                                            </button>
                                            {microredOptions
                                                .filter(mr => mr.toLowerCase().includes(mrSearchTerm.toLowerCase()))
                                                .map(mr => (
                                                    <button
                                                        key={mr}
                                                        onClick={() => {
                                                            handleMicroredChange(mr);
                                                            setIsMrDropdownOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 text-[11px] hover:bg-indigo-50 transition-colors flex items-center gap-2 ${selectedMicrored.includes(mr) ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-700'}`}
                                                    >
                                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selectedMicrored.includes(mr) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                                                            {selectedMicrored.includes(mr) && <Check className="h-2.5 w-2.5 text-white" />}
                                                        </div>
                                                        <span className="truncate">{mr}</span>
                                                    </button>
                                                ))
                                            }
                                        </div>
                                    </div>
                                </>,
                                document.body
                            )}
                        </div>

                        {/* Stats Summary */}
                        <div className="flex-1 bg-gray-50/50 rounded-xl p-3 border border-gray-100 flex flex-col justify-center gap-2">
                            {selectedMicrored.length > 0 && microredStats ? (
                                <>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-500 font-medium">Establecimientos:</span>
                                        <span className="font-bold text-gray-900 bg-white px-2 py-0.5 rounded-lg border border-gray-100 shadow-sm min-w-[32px] text-center">{microredStats.establishments}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-500 font-medium">Total Productos:</span>
                                        <span className="font-bold text-gray-900 bg-white px-2 py-0.5 rounded-lg border border-gray-100 shadow-sm min-w-[32px] text-center">{microredStats.uniqueProducts}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-500 font-medium">Registros:</span>
                                        <span className="font-bold text-gray-900 bg-white px-2 py-0.5 rounded-lg border border-gray-100 shadow-sm min-w-[32px] text-center">{microredStats.totalItems.toLocaleString()}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center text-gray-400 text-[11px] italic">
                                    Seleccione una microred para ver el resumen.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* PRODUCT REVIEW TABLE (REPLACES DROPDOWN) */}
                    <div className="md:col-span-9 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[220px] relative z-20">
                        {renderProductListTable(false)}
                    </div>
                </div>
            )}

            {/* REDISTRIBUTION TABLE */}
            {selectedMicrored.length > 0 && records.length > 0 && (
                <div ref={tableContainerRef} className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col ${isFullscreen ? 'h-screen w-screen fixed inset-0 z-[105000]' : 'max-h-[85vh]'}`}>
                    {(() => {
                        const dropdownPortalTarget = isFullscreen && tableContainerRef.current ? tableContainerRef.current : document.body;
                        return (
                            <>
                    <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                        <h3 className="font-bold text-gray-800 flex items-center gap-3">
                            {(() => {
                                const selectedProduct = productOptions.find(p => p.code === selectedProductCode);
                                const isReviewed = reviewedProducts.has(selectedProductCode);
                                return selectedProduct ? (
                                    <>
                                        <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-md text-sm font-mono border border-indigo-200 shadow-sm">{selectedProduct.code}</span>
                                        <span className="truncate max-w-2xl text-lg sm:text-xl text-gray-900 tracking-tight" title={selectedProduct.name}>{selectedProduct.name}</span>
                                        {isReviewed && (
                                            <div title="Revisado">
                                                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    "Matriz de Redistribución"
                                );
                            })()}
                        </h3>
                        <div className="flex items-center gap-3">
                            {/* Navigation Arrows */}
                            {selectedProductCode && (
                                <div className="flex items-center bg-white rounded-full p-1 border border-gray-200 shadow-sm mr-2 ring-1 ring-black/5">
                                    <button
                                        onClick={() => handleNavigateProduct('prev')}
                                        disabled={filteredProductOptions.findIndex(p => p.code === selectedProductCode) <= 0}
                                        className="flex items-center justify-center w-8 h-8 rounded-full text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-600 transition-all"
                                        title="Producto Anterior"
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </button>
                                    <div className="w-px h-4 bg-gray-200 mx-1"></div>
                                    <button
                                        onClick={() => handleNavigateProduct('next')}
                                        disabled={filteredProductOptions.findIndex(p => p.code === selectedProductCode) >= filteredProductOptions.length - 1}
                                        className="flex items-center justify-center w-8 h-8 rounded-full text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-600 transition-all"
                                        title="Siguiente Producto"
                                    >
                                        <ChevronRight className="h-5 w-5" />
                                    </button>
                                </div>
                            )}

                            {/* Consolidate Button - Only show if there are secondary pharmacies */}
                            {baseRedistributionData.some(item => /F\d{2}$/.test(String(item.codEess || '')) && !String(item.codEess || '').endsWith('F01')) && (
                                <button
                                    onClick={handleOpenConsolidateModal}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors shadow-sm"
                                >
                                    <Merge className="h-4 w-4" />
                                    <span className="hidden sm:inline">Consolidar</span>
                                </button>
                            )}

                            {/* Global Search Button - Only show if source is selected and not in 'ALL' view */}
                            {quickTransferSource && !selectedMicrored.includes('ALL') && (
                                <button
                                    onClick={() => setIsGlobalSearchModalOpen(true)}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white border border-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-sm animate-in zoom-in-95 duration-200"
                                    title="Buscar destino en toda la red"
                                >
                                    <Search className="h-4 w-4" />
                                    <span className="hidden sm:inline">Buscar Destino en Red</span>
                                </button>
                            )}

                            <button
                                onClick={() => setIsTransferListOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs font-bold hover:bg-gray-900 transition-colors shadow-sm relative"
                                title="Ver Lista de Distribución"
                            >
                                <ClipboardList className="h-4 w-4" />
                                <span className="hidden sm:inline">Lista de Distribución</span>
                                {transferList.length > 0 && (
                                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">
                                        {transferList.length}
                                    </span>
                                )}
                            </button>

                            {isFullscreen && (
                                <button
                                    onClick={() => setIsProductListModalOpen(true)}
                                    className="flex items-center justify-center p-1.5 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition-colors border border-indigo-300"
                                    title="Buscar producto"
                                >
                                    <Search className="h-4 w-4" />
                                </button>
                            )}

                            <button
                                onClick={toggleFullscreen}
                                className="flex items-center justify-center p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors border border-gray-300"
                                title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                            >
                                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                            </button>

                            <div className="text-xs text-gray-500 ml-2 border-l pl-3 border-gray-300 font-medium">
                                {filteredRedistributionData.length} Est.
                            </div>
                        </div>
                    </div>
                    <div className="overflow-auto flex-1 custom-scrollbar">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-100 text-gray-700 font-bold uppercase text-xs sticky top-0 z-10 shadow-sm">
                                <tr>

                                    <th className="p-3 border-b text-left">
                                        <div className="flex items-center gap-1">
                                            Establecimiento
                                            <MultiSelectFilter
                                                title=""
                                                options={establecimientoOptions}
                                                selectedValues={selectedEstablecimientoFilter}
                                                onChange={setSelectedEstablecimientoFilter}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center text-blue-700 bg-blue-50/50">
                                        <div className="flex items-center justify-center gap-1">
                                            Stock
                                            <NumberFilter
                                                title=""
                                                options={Array.from(new Set(redistributionData.map(item => String(item.stock)))).sort((a, b) => Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                                filterState={selectedStockFilter}
                                                onChange={setSelectedStockFilter}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center bg-gray-50 text-gray-600 font-semibold text-[10px] uppercase tracking-wider">
                                        <div className="flex items-center justify-center gap-1">
                                            Suma Cons.
                                            <NumberFilter
                                                title=""
                                                options={Array.from(new Set(redistributionData.map(item => String(item.consumptionSum || 0)))).sort((a, b) => Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                                filterState={selectedSumaConsFilter}
                                                onChange={setSelectedSumaConsFilter}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center bg-gray-50 text-gray-600 font-semibold text-[10px] uppercase tracking-wider">
                                        <div className="flex items-center justify-center gap-1">
                                            Meses Cons.
                                            <NumberFilter
                                                title=""
                                                options={Array.from(new Set(redistributionData.map(item => String(item.consumptionMonths || 0)))).sort((a, b) => Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                                filterState={selectedMesesConsFilter}
                                                onChange={setSelectedMesesConsFilter}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            CPA
                                            <NumberFilter
                                                title=""
                                                options={Array.from(new Set(redistributionData.map(item => item.cpa.toFixed(1)))).sort((a, b) => Number(a) - Number(b)).map(val => ({ value: val, label: val }))}
                                                filterState={selectedCpaFilter}
                                                onChange={setSelectedCpaFilter}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            Meses
                                            <NumberFilter
                                                title=""
                                                options={mesesOptions}
                                                filterState={selectedMesesFilter}
                                                onChange={setSelectedMesesFilter}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            Situación
                                            <MultiSelectFilter
                                                title=""
                                                options={situacionOptions}
                                                selectedValues={selectedSituacion}
                                                onChange={setSelectedSituacion}
                                                portalTarget={dropdownPortalTarget}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-3 border-b text-center bg-gray-200 text-gray-800">Balance</th>
                                    <th className="p-3 border-b text-center bg-purple-50 text-purple-800 border-l border-purple-200 w-20">Estimar</th>
                                    <th className="p-3 border-b text-center bg-yellow-50 text-yellow-800 border-l border-yellow-200 w-16">Sale</th>
                                    <th className="p-3 border-b text-center bg-green-50 text-green-800 border-l border-green-200 w-16">Entra</th>
                                    <th className="p-3 border-b text-center bg-blue-50 text-blue-800 border-l border-blue-200">N. Stock</th>
                                    <th className="p-3 border-b text-center bg-blue-50 text-blue-800">N. Meses</th>
                                    <th className="p-3 border-b text-center text-gray-500 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredRedistributionData.length > 0 ? (
                                    filteredRedistributionData.map((item, index) => {
                                    const showMicroredHeader = selectedMicrored.includes('ALL') &&
                                        !item.isWarehouse &&
                                        (index === 0 || filteredRedistributionData[index - 1].microred !== item.microred || filteredRedistributionData[index - 1].isWarehouse);

                                    const newStock = item.stock - (item.transferQty || 0) + (item.receivedQty || 0) + (item.simulationQty || 0);
                                    const newMonths = item.cpa > 0 ? (newStock / item.cpa) : (newStock > 0 ? 999 : 0);

                                    // Recalculate Need based on New Stock
                                    const currentNeed = calculateNeed(newStock, item.cpa, item.status, Number(item.consumptionMonths || 0));

                                    // Check if record is effectively empty (no stock, no cpa, no consumption)
                                    const isGhost = item.stock === 0 && item.cpa === 0 && item.consumptionSum === 0;

                                    // Status Color Logic
                                    let statusColor = "bg-gray-100 text-gray-600";
                                    if (item.status === "NormoStock") statusColor = "bg-green-100 text-green-800";
                                    if (item.status === "SobreStock") statusColor = "bg-indigo-100 text-indigo-800";
                                    if (item.status === "SubStock") statusColor = "bg-orange-100 text-orange-800";
                                    if (item.status === "Desabastecido") statusColor = "bg-red-100 text-red-800";
                                    if (item.status === "Sin Rotación") statusColor = "bg-slate-200 text-slate-700";

                                    // Indentation Logic for Secondary Pharmacies (e.g., F02, F03...)
                                    // Check if code ends with Fxx where xx > 01
                                    const isSecondary = /F\d{2}$/.test(String(item.codEess || '')) && !String(item.codEess || '').endsWith('F01');

                                    const isExternal = !selectedMicrored.includes('ALL') && !selectedMicrored.includes(item.microred || '') && !item.isWarehouse;
                                    const isSelected = quickTransferSource?.codEess === item.codEess;

                                    const isPrincipal = !isSecondary && !item.isWarehouse;
                                    const hasSecondaries = isPrincipal && baseRedistributionData.some(s =>
                                        String(s.codEess || '').startsWith(String(item.codEess).substring(0, 5)) && s.codEess !== item.codEess
                                    );

                                    // --- SMART ANALYSIS BADGES ---
                                    let analysisBadge = null;

                                    // 1. Dead Stock (Donor)
                                    if (item.stock > 0 && (item.consumptionMonths || 0) <= 1) {
                                        analysisBadge = (
                                            <div className="ml-2 text-red-500" title="Sin Rotación: Candidato a Donante Total">
                                                <AlertTriangle className="h-4 w-4" />
                                            </div>
                                        );
                                    }
                                    // 2. High Rotation (Receiver)
                                    else if (item.status !== 'SobreStock' && (item.consumptionMonths || 0) >= 6) {
                                        analysisBadge = (
                                            <div className="ml-2 text-emerald-600" title="Alta Rotación: Buen candidato para recibir stock">
                                                <TrendingUp className="h-4 w-4" />
                                            </div>
                                        );
                                    }
                                    // 3. Overstock Donor
                                    else if (item.status === 'SobreStock' && item.monthsProvision > 6) {
                                        analysisBadge = (
                                            <div className="ml-2 text-blue-500" title="Excedente: Candidato a Donante">
                                                <TrendingDown className="h-4 w-4" />
                                            </div>
                                        );
                                    }

                                    return (
                                        <React.Fragment key={item.codEess}>
                                            {showMicroredHeader && (
                                                <tr className="bg-slate-100 border-y border-slate-200">
                                                    <td colSpan={15} className="px-4 py-2 font-bold text-slate-700 text-xs uppercase tracking-wider">
                                                        MICRORED: {item.microred}
                                                    </td>
                                                </tr>
                                            )}
                                            <tr
                                                className={`
                                        transition-colors cursor-pointer group
                                        ${item.isWarehouse
                                                    ? 'bg-slate-50 border-l-4 border-l-indigo-500'
                                                    : isExternal
                                                        ? 'bg-purple-50/30 border-l-4 border-l-purple-400'
                                                        : quickTransferSource?.codEess === item.codEess
                                                            ? 'bg-indigo-50 ring-2 ring-indigo-500 ring-inset'
                                                            : quickTransferSource
                                                                ? 'hover:bg-green-100 hover:ring-2 hover:ring-green-500 hover:ring-inset cursor-crosshair'
                                                                : 'hover:bg-blue-100'
                                                }
                                    `}
                                            onClick={() => !item.isWarehouse && handleOpenDetailModal(item)}
                                        >
                                            <td className={`p-3 pr-4 font-medium relative whitespace-nowrap text-xs ${isPrincipal ? 'font-black text-gray-900 pl-11' : 'text-gray-700'} ${isSecondary ? 'pl-20 text-gray-600 italic' : ''}`} title={`${item.codEess} - ${item.establishmentName}`}>
                                                <div className="flex items-center">
                                                    {hasSecondaries && (
                                                        <div
                                                            className={`absolute left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 scale-90 group-hover:scale-100 z-10 p-1 rounded border cursor-pointer shadow-sm ${item.isConsolidated
                                                                ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-600 hover:text-white'
                                                                : 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-600 hover:text-white'
                                                                }`}
                                                            title={item.isConsolidated ? "Deshacer Consolidación" : "Consolidación Rápida (Unificar secundarias)"}
                                                            onClick={(e) => handleQuickConsolidation(e, item.codEess)}
                                                        >
                                                            {item.isConsolidated ? <Split className="h-3.5 w-3.5" /> : <Merge className="h-3.5 w-3.5" />}
                                                        </div>
                                                    )}
                                                    <span>{item.establishmentName}</span>
                                                    {isExternal && (
                                                        <span className="shrink-0 ml-2 px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded uppercase tracking-wider border border-purple-200">
                                                            EXT
                                                        </span>
                                                    )}
                                                    {analysisBadge}
                                                </div>
                                            </td>
                                            <td className="p-3 text-center font-mono text-sm font-bold text-blue-700 bg-blue-50/30 group-hover:bg-transparent">{isGhost ? '' : item.stock}</td>

                                            {/* CONSUMPTION DATA */}
                                            <td className={`p-3 text-center font-mono text-sm ${isSelected ? 'text-indigo-700 font-bold' : 'text-gray-500 bg-gray-50 group-hover:bg-transparent'}`}>
                                                {isGhost ? '' : (item.consumptionSum || 0)}
                                            </td>
                                            <td className={`p-3 text-center font-mono text-sm ${isSelected ? 'text-indigo-700 font-bold' : 'text-gray-500 bg-gray-50 group-hover:bg-transparent'}`}>
                                                {isGhost ? '' : (item.consumptionMonths || 0)}
                                            </td>

                                            <td className="p-3 text-center font-mono text-sm">
                                                {isGhost ? '' : (
                                                    <div className="flex items-center justify-center gap-1">
                                                        {item.cpa.toFixed(1)}
                                                        {item.cpaMode === 'SIMPLE' ? (
                                                            <span className="text-[8px] font-bold text-blue-500 bg-blue-50 px-1 py-0.5 rounded uppercase tracking-tighter" title="CPA Simple">SIM</span>
                                                        ) : (
                                                            <span className="text-[8px] font-bold text-teal-500 bg-teal-50 px-1 py-0.5 rounded uppercase tracking-tighter" title="CPA Ajustado">AJU</span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3 text-center font-mono font-bold text-sm">
                                                {isGhost ? '' : (item.monthsProvision === 999 ? '∞' : item.monthsProvision.toFixed(1))}
                                            </td>
                                            <td className="p-3 text-center">
                                                {!isGhost && (
                                                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${statusColor}`}>
                                                        {item.status}
                                                    </span>
                                                )}
                                            </td>

                                            {/* NECESIDAD / EXCEDENTE / BALANCE */}
                                            <td className={`p-3 text-center font-mono font-bold text-sm ${isSelected ? 'text-indigo-700' :
                                                (currentNeed || 0) > 0 ? 'text-blue-600 bg-blue-50 group-hover:bg-transparent' :
                                                    (currentNeed || 0) < 0 ? 'text-red-600 bg-red-50 group-hover:bg-transparent' : 'text-gray-400 bg-gray-50 group-hover:bg-transparent'
                                                }`} title={`Stock: ${newStock}, CPA: ${item.cpa}, MesesCons: ${item.consumptionMonths}, Status: ${item.status}, NeedCalc: ${currentNeed}`}>
                                                {isGhost ? '' : ((currentNeed || 0) !== 0 ? (currentNeed || 0) : '-')}
                                            </td>

                                            {/* ESTIMAR (Simulation Input) */}
                                            <td className={`p-2 text-center border-l border-purple-100 ${isSelected ? '' : 'bg-purple-50 group-hover:bg-transparent'}`} onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="text" // text to allow "-"
                                                    value={item.simulationInput !== undefined ? item.simulationInput : (item.simulationQty === 0 ? '' : item.simulationQty)}
                                                    onChange={(e) => handleSimulationChange(item.codEess, e.target.value)}
                                                    placeholder="+/-"
                                                    className={`w-16 p-1 text-center border rounded focus:ring-2 focus:ring-purple-500 outline-none text-sm font-bold ${(item.simulationQty || 0) < 0 ? 'text-red-600 border-red-300 bg-red-50' :
                                                        (item.simulationQty || 0) > 0 ? 'text-blue-600 border-blue-300 bg-blue-50' : 'border-gray-300 text-gray-600'
                                                        }`}
                                                    disabled={isGhost}
                                                />
                                            </td>

                                            {/* SALE (Read Only) */}
                                            <td className={`p-3 text-center border-l border-yellow-100 text-sm ${isSelected ? '' : 'bg-yellow-50 group-hover:bg-transparent'}`}>
                                                {(item.transferQty || 0) > 0 ? (
                                                    <span className="font-bold text-yellow-700">-{item.transferQty}</span>
                                                ) : (
                                                    <span className="text-gray-300">-</span>
                                                )}
                                            </td>

                                            {/* ENTRA (Read Only) */}
                                            <td className={`p-3 text-center border-l border-green-100 text-sm ${isSelected ? '' : 'bg-green-50 group-hover:bg-transparent'}`}>
                                                {(item.receivedQty || 0) > 0 ? (
                                                    <span className="font-bold text-green-700">+{item.receivedQty}</span>
                                                ) : (
                                                    <span className="text-gray-300">-</span>
                                                )}
                                            </td>

                                            {/* CALCULATED */}
                                            <td className={`p-3 text-center font-mono font-bold text-sm border-l border-blue-100 ${isSelected ? 'text-indigo-900' :
                                                newStock < 0 ? 'text-red-600 bg-red-50 group-hover:bg-transparent' : 'text-blue-900 bg-blue-50/30 group-hover:bg-transparent'
                                                }`}>
                                                {newStock === 0 ? '' : newStock}
                                            </td>
                                            <td className={`p-3 text-center font-mono font-bold text-sm border-l border-blue-100 ${isSelected ? 'text-indigo-900' :
                                                'text-blue-900 bg-blue-50/30 group-hover:bg-transparent'
                                                }`}>
                                                <div className="flex items-center justify-center gap-2">
                                                    <span>{newStock === 0 ? '' : (newMonths === 999 ? '∞' : newMonths.toFixed(1))}</span>
                                                    {newStock > 0 && (
                                                        <div
                                                            className={`w-3 h-3 rounded-full shadow-sm border border-white ${newMonths === 999 ? 'bg-gray-500' :
                                                                newMonths > 6 ? 'bg-indigo-500' :
                                                                    newMonths >= 2 ? 'bg-green-500' :
                                                                        newMonths > 0 ? 'bg-orange-500' : 'bg-red-500'
                                                                }`}
                                                            title={
                                                                newMonths === 999 ? 'Sin Rotación Estimado' :
                                                                    newMonths > 6 ? 'SobreStock Estimado' :
                                                                        newMonths >= 2 ? 'NormoStock Estimado' :
                                                                            newMonths > 0 ? 'SubStock Estimado' : 'Desabastecido Estimado'
                                                            }
                                                        ></div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* QUICK TRANSFER ACTION */}
                                            <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={(e) => handleQuickTransferClick(item, e)}
                                                    className={`
                                                p-1.5 rounded-lg transition-all shadow-sm border
                                                ${quickTransferSource?.codEess === item.codEess
                                                            ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
                                                            : quickTransferSource
                                                                ? 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100 hover:scale-105'
                                                                : 'bg-white text-gray-400 border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200'
                                                        }
                                            `}
                                                    title={quickTransferSource ? (quickTransferSource.codEess === item.codEess ? "Cancelar Selección" : "Transferir Aquí") : "Seleccionar como Origen"}
                                                >
                                                    <MousePointerClick className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                        </React.Fragment>
                                    );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={15} className="p-20 text-center">
                                            <div className="flex flex-col items-center justify-center gap-4 text-gray-400">
                                                <div className="p-4 bg-gray-50 rounded-full border border-gray-100 shadow-inner">
                                                    <Package className="h-10 w-10 opacity-20" />
                                                </div>
                                                <div className="max-w-xs">
                                                    <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-1">
                                                        {selectedProductCode ? "Sin resultados" : "Esperando selección"}
                                                    </p>
                                                    <p className="text-xs italic leading-relaxed">
                                                        {selectedProductCode 
                                                            ? "No se encontraron establecimientos con datos para este producto con los filtros actuales." 
                                                            : "Seleccione un producto de la lista superior para visualizar su matriz de redistribución y balance de stock."}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                            </>
                        );
                    })()}
                </div>
            )}

            {/* QUICK TRANSFER CONFIRMATION MODAL */}
            {isQuickTransferConfirmOpen && quickTransferSource && quickTransferDestination && renderModal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[110000] p-4 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-gray-800 transform transition-all scale-100">
                        {/* Premium Header */}
                        <div className="relative p-6 pb-0 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white tracking-tight">
                                Confirmar Transferencia
                            </h3>
                            <button
                                onClick={cancelQuickTransfer}
                                className="text-gray-500 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded-full"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Product Line: Code + Name */}
                            <div className="flex items-center gap-3 bg-gray-800/50 p-4 rounded-xl border border-gray-700/50">
                                <span className="bg-teal-500/20 text-teal-400 px-2 py-1 rounded text-sm font-mono font-bold border border-teal-500/30 shrink-0">
                                    {selectedProductCode}
                                </span>
                                <div className="text-white text-lg font-bold leading-tight truncate" title={selectedProductName}>
                                    {selectedProductName}
                                </div>
                            </div>

                            {/* Origin & Destination Cards */}
                            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
                                {/* Origin Card */}
                                <div className="bg-gray-800/80 p-5 rounded-xl border border-indigo-500/30 flex flex-col relative overflow-hidden group hover:border-indigo-500/50 transition-colors">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                                    <div className="mb-4">
                                        <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mb-1.5 opacity-80">De (Origen)</div>
                                        <div className="text-white font-bold text-lg leading-snug line-clamp-2" title={quickTransferSource.establishmentName}>
                                            {quickTransferSource.establishmentName}
                                        </div>
                                    </div>
                                    <div className="mt-auto pt-3 border-t border-gray-700/50">
                                        <div className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Stock Disponible</div>
                                        <div className="text-3xl font-mono font-bold text-indigo-400">{quickTransferSource.stock}</div>
                                    </div>
                                </div>

                                {/* Arrow */}
                                <div className="flex items-center justify-center text-gray-600 px-1">
                                    <ArrowRight className="h-6 w-6" />
                                </div>

                                {/* Destination Card */}
                                <div className="bg-gray-800/80 p-5 rounded-xl border border-green-500/30 flex flex-col text-right relative overflow-hidden group hover:border-green-500/50 transition-colors">
                                    <div className="absolute top-0 right-0 w-1 h-full bg-green-500"></div>
                                    <div className="mb-4">
                                        <div className="text-[10px] text-green-400 font-bold uppercase tracking-widest mb-1.5 opacity-80">A (Destino)</div>
                                        <div className="text-white font-bold text-lg leading-snug line-clamp-2" title={quickTransferDestination.establishmentName}>
                                            {quickTransferDestination.establishmentName}
                                        </div>
                                    </div>
                                    <div className="mt-auto pt-3 border-t border-gray-700/50">
                                        <div className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Necesidad</div>
                                        <div className="text-3xl font-mono font-bold text-green-400">{(quickTransferDestination.need || 0) > 0 ? quickTransferDestination.need : 0}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Input Section */}
                            <div className="text-center py-2">
                                <label className="block text-xs font-bold text-gray-500 mb-4 uppercase tracking-widest">Cantidad a Transferir</label>
                                <div className="relative inline-block group">
                                    <input
                                        type="number"
                                        value={quickTransferQty}
                                        onChange={(e) => setQuickTransferQty(e.target.value)}
                                        className="w-48 bg-transparent text-6xl font-bold text-center text-white border-b-2 border border-gray-700 focus:border-indigo-500 outline-none pb-2 transition-all placeholder-gray-800 font-mono group-hover:border-gray-600"
                                        placeholder="0"
                                        autoFocus
                                        min="1"
                                        max={quickTransferSource.stock}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') confirmQuickTransfer();
                                            if (e.key === 'Escape') cancelQuickTransfer();
                                        }}
                                    />
                                </div>
                                <div className="text-xs text-gray-600 mt-4 font-medium">
                                    Presione <span className="text-gray-400 font-bold">Enter</span> para confirmar
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <button
                                    onClick={cancelQuickTransfer}
                                    className="px-4 py-3 bg-gray-800 text-gray-300 rounded-xl font-bold hover:bg-gray-700 transition-all border border-gray-700 text-sm"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={confirmQuickTransfer}
                                    className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 text-sm"
                                >
                                    <span>Confirmar</span>
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TRANSFER LIST MODAL */}
            {isTransferListOpen && renderModal(
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110000] p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden border border-gray-200 flex flex-col max-h-[85vh]">
                        <div className="bg-gray-900 text-white p-4 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-2">
                                <ClipboardList className="h-5 w-5 text-teal-400" />
                                <h3 className="font-bold text-lg">LISTA DE DISTRIBUCIÓN</h3>
                            </div>
                            <button onClick={() => setIsTransferListOpen(false)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-0">
                            {transferList.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                                    <ClipboardList className="h-12 w-12 mb-3 opacity-20" />
                                    <p>No hay transferencias registradas aún.</p>
                                    <p className="text-sm mt-1">Utilice el botón de acción en la tabla para agregar transferencias.</p>
                                </div>
                            ) : (
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-100 text-gray-700 font-bold uppercase text-xs sticky top-0 z-10">
                                        <tr>
                                            <th className="p-3 border-b">Producto</th>
                                            <th className="p-3 border-b text-center">Cant.</th>
                                            <th className="p-3 border-b">Origen</th>
                                            <th className="p-3 border-b">Destino</th>
                                            <th className="p-3 border-b text-center">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {transferList.map((t) => (
                                            <tr key={t.id} className="hover:bg-gray-50">
                                                <td className="p-3">
                                                    <div className="font-bold text-gray-800">{t.productName}</div>
                                                    <div className="font-mono text-xs text-gray-500">{t.productCode}</div>
                                                </td>
                                                <td className="p-3 text-center font-bold text-lg text-indigo-600">
                                                    {editingTransferId === t.id ? (
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={editingTransferQty}
                                                            onChange={(e) => setEditingTransferQty(e.target.value)}
                                                            className="w-20 text-center border border-indigo-300 rounded-md py-1 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') saveEditedTransfer();
                                                                if (e.key === 'Escape') cancelEditingTransfer();
                                                            }}
                                                        />
                                                    ) : (
                                                        t.quantity
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <div className="text-gray-800">{t.originName}</div>
                                                    <div className="font-mono text-xs text-gray-500">{t.originCod}</div>
                                                </td>
                                                <td className="p-3">
                                                    <div className="text-gray-800">{t.destinationName}</div>
                                                    <div className="font-mono text-xs text-gray-500">{t.destinationCod}</div>
                                                </td>
                                                <td className="p-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {editingTransferId === t.id ? (
                                                            <>
                                                                <button
                                                                    onClick={saveEditedTransfer}
                                                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                                    title="Guardar"
                                                                >
                                                                    <Check className="h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    onClick={cancelEditingTransfer}
                                                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                                    title="Cancelar"
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => startEditingTransfer(t.id, t.quantity)}
                                                                    className="p-1.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                                    title="Editar"
                                                                >
                                                                    <Edit2 className="h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => removeTransferFromList(t.id)}
                                                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                                    title="Eliminar"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        <div className="bg-gray-50 p-4 flex justify-between items-center border-t border-gray-200 shrink-0">
                            <div className="text-sm text-gray-600 font-medium">
                                Total Transferencias: <span className="font-bold text-gray-900">{transferList.length}</span>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setIsTransferListOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cerrar</button>
                                <button
                                    onClick={exportTransferList}
                                    disabled={transferList.length === 0}
                                    className="px-4 py-2 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <FileSpreadsheet className="h-4 w-4" />
                                    Exportar Lista
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* CONSOLIDATION MODAL */}
            {isConsolidateModalOpen && renderModal(
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110000] p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-200 flex flex-col max-h-[80vh]">
                        <div className="bg-gray-900 text-white p-4 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-2">
                                <Merge className="h-5 w-5 text-amber-400" />
                                <h3 className="font-bold text-lg">CONSOLIDAR FARMACIAS</h3>
                            </div>
                            <button onClick={() => setIsConsolidateModalOpen(false)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="p-6 overflow-y-auto">
                            <p className="text-sm text-gray-600 mb-4">
                                Seleccione las farmacias secundarias que desea unificar con su farmacia principal.
                                Los stocks y consumos se sumarán a la principal.
                            </p>

                            <div className="space-y-6">
                                {/* Group by Base Code */}
                                {Object.entries(
                                    baseRedistributionData.reduce((acc, item) => {
                                        const safeCodEess = String(item.codEess || '');
                                        const baseCode = safeCodEess.substring(0, 5);
                                        if (!acc[baseCode]) acc[baseCode] = [];
                                        acc[baseCode].push(item);
                                        return acc;
                                    }, {} as Record<string, RedistributionItem[]>)
                                ).filter(([_, group]) => group.length > 1).map(([baseCode, group]) => {
                                    const principal = group.find(i => String(i.codEess || '').endsWith('F01')) || group[0];
                                    const secondaries = group.filter(i => i !== principal);

                                    if (secondaries.length === 0) return null;

                                    return (
                                        <div key={baseCode} className="border border-gray-200 rounded-lg overflow-hidden">
                                            <div className="bg-gray-100 p-3 font-bold text-sm text-gray-800 flex justify-between items-center">
                                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={secondaries.length > 0 && secondaries.every(s => consolidationSelection.has(s.codEess))}
                                                        onChange={() => toggleGroupConsolidation(secondaries)}
                                                        className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                                                    />
                                                    <span>Principal: {principal.establishmentName}</span>
                                                </label>
                                                <span className="font-mono text-xs bg-gray-200 px-2 py-0.5 rounded">{principal.codEess}</span>
                                            </div>
                                            <div className="divide-y divide-gray-100">
                                                {secondaries.map(sec => (
                                                    <label key={sec.codEess} className="flex items-center gap-3 p-3 hover:bg-amber-50 cursor-pointer transition-colors">
                                                        <input
                                                            type="checkbox"
                                                            checked={consolidationSelection.has(sec.codEess)}
                                                            onChange={() => toggleConsolidation(sec.codEess)}
                                                            className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                                                        />
                                                        <div className="flex-1">
                                                            <div className="text-sm font-medium text-gray-700">{sec.establishmentName}</div>
                                                            <div className="text-xs text-gray-400 font-mono">{sec.codEess}</div>
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            Stock: {sec.stock} | CPA: {sec.cpa.toFixed(1)}
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Empty State if no groups found */}
                                {Object.values(baseRedistributionData.reduce((acc, item) => {
                                    const safeCodEess = String(item.codEess || '');
                                    const baseCode = safeCodEess.substring(0, 5);
                                    if (!acc[baseCode]) acc[baseCode] = [];
                                    acc[baseCode].push(item);
                                    return acc;
                                }, {} as Record<string, RedistributionItem[]>)).every(g => g.length <= 1) && (
                                        <div className="text-center py-8 text-gray-400 italic">
                                            No se encontraron establecimientos con múltiples farmacias en esta vista.
                                        </div>
                                    )
                                }
                            </div>
                        </div>

                        <div className="bg-gray-50 p-4 flex justify-end gap-3 border-t border-gray-200 shrink-0">
                            <button onClick={() => setIsConsolidateModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
                            <button onClick={applyConsolidationSelection} className="px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm">Aplicar Consolidación</button>
                        </div>
                    </div>
                </div>
            )}

            {/* REVIEW CONFIRMATION MODAL */}
            {isReviewConfirmOpen && renderModal(
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110000] p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200">
                        <div className="p-6 text-center">
                            <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle2 className="h-8 w-8 text-indigo-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">¿Marcar como Revisado?</h3>
                            <p className="text-sm text-gray-600 mb-6">
                                Estás pasando al siguiente producto. ¿Deseas marcar <strong>{productOptions.find(p => p.code === selectedProductCode)?.name || selectedProductCode}</strong> como revisado antes de continuar?
                            </p>

                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={() => handleConfirmReviewNavigation(true)}
                                    className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                                >
                                    Sí, marcar y continuar
                                </button>
                                <button
                                    onClick={() => handleConfirmReviewNavigation(false)}
                                    className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                                >
                                    No, solo continuar
                                </button>

                                <label className="flex items-center justify-center gap-2 mt-2 cursor-pointer text-xs text-gray-500 hover:text-indigo-600 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={autoReviewEnabled}
                                        onChange={(e) => setAutoReviewEnabled(e.target.checked)}
                                        className="rounded border border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    No volver a preguntar (marcar automáticamente al avanzar)
                                </label>

                                <button
                                    onClick={() => setIsReviewConfirmOpen(false)}
                                    className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 font-medium mt-2"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* CONFIRMATION MODAL FOR IMPORT */}
            {isConfirmImportModalOpen && renderModal(
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
                    <div className="bg-gray-900 p-6 rounded-lg shadow-xl max-w-md w-full">
                        <h2 className="text-xl font-bold text-white mb-4">Confirmar nueva carga</h2>
                        <p className="text-gray-300 mb-6">
                            Subir un nuevo archivo borrará todos los datos actuales de redistribución (registros, selecciones, transferencias, simulación). ¿Está seguro de continuar?
                        </p>
                        <div className="flex justify-end gap-4">
                            <button
                                onClick={() => {
                                    setIsConfirmImportModalOpen(false);
                                }}
                                className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    setIsConfirmImportModalOpen(false);
                                    clearRedistributionData();
                                    setTimeout(() => {
                                        importInputRef.current?.click();
                                    }, 100);
                                }}
                                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500 font-bold"
                            >
                                Confirmar y Cargar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CONFIRMATION MODAL */}
            {isConfirmUploadModalOpen && renderModal(
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
                    <div className="bg-gray-900 p-6 rounded-lg shadow-xl max-w-md w-full">
                        <h2 className="text-xl font-bold text-white mb-4">Confirmar nueva carga</h2>
                        <p className="text-gray-300 mb-6">
                            Subir un nuevo archivo borrará todos los datos actuales de redistribución (registros, selecciones, transferencias, simulación). ¿Está seguro de continuar?
                        </p>
                        <div className="flex justify-end gap-4">
                            <button
                                onClick={() => {
                                    setIsConfirmUploadModalOpen(false);
                                }}
                                className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    setIsConfirmUploadModalOpen(false);
                                    clearRedistributionData();
                                    setTimeout(() => {
                                        fileInputRef.current?.click();
                                    }, 100);
                                }}
                                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
                            >
                                Confirmar y Cargar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* GLOBAL SEARCH MODAL */}
            {isGlobalSearchModalOpen && renderModal(
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95%] overflow-hidden border border-gray-200 flex flex-col max-h-[85vh]">
                        <div className="bg-indigo-900 text-white p-5 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-800 rounded-lg">
                                    <Search className="h-5 w-5 text-indigo-300" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg leading-tight">BUSCAR DESTINO EN TODA LA RED</h3>
                                    <p className="text-xs text-indigo-300 font-medium">Seleccione un establecimiento de otra microred como destino</p>
                                </div>
                            </div>
                            <button onClick={() => setIsGlobalSearchModalOpen(false)} className="text-indigo-300 hover:text-white transition-colors"><X className="h-6 w-6" /></button>
                        </div>

                        <div className="p-4 bg-gray-50 border-b border-gray-200 shrink-0">
                            <div className="relative group">
                                <Search className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                                <input
                                    type="text"
                                    autoFocus
                                    placeholder="Buscar por nombre o código de establecimiento..."
                                    value={globalSearchTerm}
                                    onChange={(e) => setGlobalSearchTerm(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-700 font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-sm"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                            {globalNetworkData.filter(item =>
                                item.establishmentName.toLowerCase().includes(globalSearchTerm.toLowerCase()) ||
                                item.codEess.toLowerCase().includes(globalSearchTerm.toLowerCase())
                            ).length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                                    <Search className="h-12 w-12 mb-3 opacity-20" />
                                    <p className="font-medium">No se encontraron establecimientos con stock</p>
                                    <p className="text-sm mt-1">Intente con otro término de búsqueda</p>
                                </div>
                            ) : (
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-[10px] tracking-wider sticky top-0 z-10 border-b border-gray-200">
                                        <tr>
                                            <th className="p-4">Establecimiento</th>
                                            <th className="p-4 text-center">Stock</th>
                                            <th className="p-4 text-center border-l bg-gray-50/50">Suma Cons.</th>
                                            <th className="p-4 text-center bg-gray-50/50">Meses Cons.</th>
                                            <th className="p-4 text-center border-l">CPA</th>
                                            <th className="p-4 text-center">Meses</th>
                                            <th className="p-4 text-center">Situación</th>
                                            <th className="p-4 text-center bg-gray-200/50 border-x">Balance</th>
                                            <th className="p-4 text-center text-purple-700 bg-purple-50/50">Estimar</th>
                                            <th className="p-4 text-center text-yellow-700 bg-yellow-50/50 border-l border-yellow-100/50">Sale</th>
                                            <th className="p-4 text-center text-green-700 bg-green-50/50 border-l border-green-100/50">Entra</th>
                                            <th className="p-4 text-center text-blue-800 bg-blue-50/50 border-l border-blue-100/50">N. Stock</th>
                                            <th className="p-4 text-center text-blue-800 bg-blue-50/50">N. Meses</th>
                                            <th className="p-4 text-center border-l">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {globalNetworkData
                                            .filter(item =>
                                                item.establishmentName.toLowerCase().includes(globalSearchTerm.toLowerCase()) ||
                                                item.codEess.toLowerCase().includes(globalSearchTerm.toLowerCase())
                                            )
                                            .map((item) => (
                                                <tr
                                                    key={item.codEess}
                                                    className="hover:bg-indigo-50/50 transition-colors cursor-pointer group"
                                                    onClick={() => {
                                                        setSelectedDetailItem(item);
                                                        setIsDetailModalOpen(true);
                                                    }}
                                                >
                                                    <td className="p-4">
                                                        <div className="font-bold text-gray-900">{item.establishmentName}</div>
                                                        <div className="flex gap-2 items-center">
                                                            <div className="font-mono text-[10px] text-gray-500">{item.codEess}</div>
                                                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] font-bold uppercase">
                                                                {item.microred}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-center font-mono font-bold text-indigo-600">{item.stock}</td>
                                                    <td className="p-3 text-center font-mono text-xs text-gray-500 bg-gray-50 group-hover:bg-transparent">{item.consumptionSum || 0}</td>
                                                    <td className="p-3 text-center font-mono text-xs text-gray-500 bg-gray-50 group-hover:bg-transparent">{item.consumptionMonths || 0}</td>
                                                    <td className="p-3 text-center font-mono">{item.cpa.toFixed(1)}</td>
                                                    <td className="p-3 text-center font-mono font-bold">
                                                        {item.monthsProvision === 999 ? '∞' : item.monthsProvision.toFixed(1)}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${item.status === 'NormoStock' ? 'bg-green-100 text-green-700' :
                                                            item.status === 'SobreStock' ? 'bg-indigo-100 text-indigo-700' :
                                                                item.status === 'SubStock' ? 'bg-orange-100 text-orange-700' :
                                                                    'bg-red-100 text-red-700'
                                                            }`}>
                                                            {item.status}
                                                        </span>
                                                    </td>
                                                    <td className={`p-3 text-center font-mono font-bold ${(item.need || 0) > 0 ? 'text-blue-600 bg-blue-50 group-hover:bg-transparent' :
                                                        (item.need || 0) < 0 ? 'text-red-600 bg-red-50 group-hover:bg-transparent' :
                                                            'text-gray-400 bg-gray-50 group-hover:bg-transparent'
                                                        }`}>
                                                        {(item.need || 0) !== 0 ? (item.need || 0) : '-'}
                                                    </td>
                                                    <td className="p-2 text-center border-l border-purple-100 bg-purple-50 group-hover:bg-transparent" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="text"
                                                            value={item.simulationInput !== undefined ? item.simulationInput : (item.simulationQty === 0 ? '' : item.simulationQty)}
                                                            onChange={(e) => handleSimulationChange(item.codEess, e.target.value)}
                                                            placeholder="+/-"
                                                            className={`w-16 p-1 text-center border rounded focus:ring-2 focus:ring-purple-500 outline-none text-xs font-bold ${(item.simulationQty || 0) < 0 ? 'text-red-600 border-red-300 bg-red-50' :
                                                                (item.simulationQty || 0) > 0 ? 'text-blue-600 border-blue-300 bg-blue-50' : 'border-gray-300 text-gray-600'
                                                                }`}
                                                        />
                                                    </td>
                                                    <td className="p-3 text-center border-l border-yellow-100 bg-yellow-50 group-hover:bg-transparent">
                                                        {(item.transferQty || 0) > 0 ? (
                                                            <span className="font-bold text-yellow-700">-{item.transferQty}</span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center border-l border-green-100 bg-green-50 group-hover:bg-transparent">
                                                        {(item.receivedQty || 0) > 0 ? (
                                                            <span className="font-bold text-green-700">+{item.receivedQty}</span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center font-mono font-bold border-l border-blue-100 text-blue-900 bg-blue-50/30 group-hover:bg-transparent">
                                                        {(() => {
                                                            const nStock = item.stock + (item.simulationInput !== undefined ? (Number(item.simulationInput) || 0) : (item.simulationQty || 0)) - (item.transferQty || 0) + (item.receivedQty || 0);
                                                            return nStock < 0 ? <span className="text-red-600">{nStock}</span> : (nStock === 0 ? '' : nStock);
                                                        })()}
                                                    </td>
                                                    <td className="p-3 text-center font-mono font-bold border-l border-blue-100 text-blue-900 bg-blue-50/30 group-hover:bg-transparent">
                                                        <div className="flex items-center justify-center gap-2">
                                                            {(() => {
                                                                const nStock = item.stock + (item.simulationInput !== undefined ? (Number(item.simulationInput) || 0) : (item.simulationQty || 0)) - (item.transferQty || 0) + (item.receivedQty || 0);
                                                                const nMonths = item.cpa > 0 ? nStock / item.cpa : (nStock > 0 ? 999 : 0);
                                                                const displayMonths = nStock <= 0 ? '' : (nMonths === 999 ? '∞' : nMonths.toFixed(1));

                                                                return (
                                                                    <>
                                                                        <span>{displayMonths}</span>
                                                                        {nStock > 0 && (
                                                                            <div
                                                                                className={`w-3 h-3 rounded-full shadow-sm border border-white ${nMonths === 999 ? 'bg-gray-500' :
                                                                                    nMonths > 6 ? 'bg-indigo-500' :
                                                                                        nMonths >= 2 ? 'bg-green-500' :
                                                                                            nMonths > 0 ? 'bg-orange-500' : 'bg-red-500'
                                                                                    }`}
                                                                            ></div>
                                                                        )}
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-center border-l bg-gray-50 group-hover:bg-transparent" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={() => {
                                                                setQuickTransferDestination(item);
                                                                setIsGlobalSearchModalOpen(false);
                                                                setIsQuickTransferConfirmOpen(true);
                                                                toast.success(`Destino seleccionado: ${item.establishmentName}`);
                                                            }}
                                                            className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition-all shadow-sm border border-green-100"
                                                            title="Seleccionar como Destino"
                                                        >
                                                            <MousePointerClick className="h-4 w-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
                            <button
                                onClick={() => setIsGlobalSearchModalOpen(false)}
                                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PRODUCT LIST MODAL */}
            {isProductListModalOpen && renderModal(
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[5000] p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95%] overflow-hidden border border-gray-200 flex flex-col max-h-[85vh]">
                        <div className="bg-indigo-900 text-white p-5 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-800 rounded-lg">
                                    <Package className="h-5 w-5 text-indigo-300" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg leading-tight">LISTA DE PRODUCTOS</h3>
                                    <p className="text-xs text-indigo-300 font-medium">Seleccione un producto para ver su redistribución</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsProductListModalOpen(false)}
                                className="p-2 text-indigo-300 hover:text-white hover:bg-indigo-800 rounded-xl transition-all"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50/50 relative">
                            {renderProductListTable(true)}
                        </div>

                        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end shrink-0">
                            <button
                                onClick={() => setIsProductListModalOpen(false)}
                                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* DETAIL MODAL */}
            {
                isDetailModalOpen && selectedDetailItem && renderModal(
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-7xl overflow-hidden border border-gray-800 flex flex-col max-h-[95vh]">
                            {/* Header */}
                            <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900 z-10">
                                <div className="flex-1 min-w-0 mr-4">
                                    {/* Product Line */}
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded text-sm font-mono font-bold border border-teal-500/30 shrink-0">
                                            {selectedProductCode}
                                        </span>
                                        <h2 className="text-xl font-bold text-white leading-tight truncate" title={selectedProductName}>
                                            {selectedProductName}
                                        </h2>
                                    </div>

                                    {/* Establishment Line */}
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-500 text-sm font-mono font-bold bg-gray-800 px-2 py-0.5 rounded shrink-0">
                                            {selectedDetailItem.codEess}
                                        </span>
                                        <p className="text-gray-300 text-base truncate" title={selectedDetailItem.establishmentName}>
                                            {selectedDetailItem.establishmentName}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                    {/* Navigation */}
                                    <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
                                        {(() => {
                                            let currentList = redistributionData;
                                            if (isGlobalSearchModalOpen) {
                                                currentList = globalNetworkData.filter(item =>
                                                    item.establishmentName.toLowerCase().includes(globalSearchTerm.toLowerCase()) ||
                                                    item.codEess.toLowerCase().includes(globalSearchTerm.toLowerCase())
                                                );
                                            }
                                            const currentIndex = currentList.findIndex(i => i.codEess === selectedDetailItem.codEess);
                                            
                                            return (
                                                <>
                                                    <button
                                                        onClick={() => handleNavigateDetailItem('prev')}
                                                        disabled={currentIndex <= 0}
                                                        className="p-2 hover:bg-gray-700 rounded-md text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                                                        title="Establecimiento Anterior"
                                                    >
                                                        <ChevronLeft className="h-5 w-5" />
                                                    </button>
                                                    <div className="w-px h-5 bg-gray-700 mx-1"></div>
                                                    <button
                                                        onClick={() => handleNavigateDetailItem('next')}
                                                        disabled={currentIndex >= currentList.length - 1 || currentIndex === -1}
                                                        className="p-2 hover:bg-gray-700 rounded-md text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                                                        title="Siguiente Establecimiento"
                                                    >
                                                        <ChevronRight className="h-5 w-5" />
                                                    </button>
                                                </>
                                            );
                                        })()}
                                    </div>

                                    <button
                                        onClick={() => setIsDetailModalOpen(false)}
                                        className="text-gray-500 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded-lg"
                                    >
                                        <X className="h-6 w-6" />
                                    </button>
                                </div>
                            </div>

                            {/* Scrollable Body */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {/* KPI Cards */}
                                <div className="p-5 grid grid-cols-2 md:grid-cols-5 gap-3 bg-gray-900/50 border-b border-gray-800">
                                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700">
                                        <div className="text-gray-400 text-xs font-bold uppercase mb-1">Stock Actual</div>
                                        <div className="text-2xl font-bold text-white">{selectedDetailItem.stock}</div>
                                    </div>
                                    
                                    {/* CPA ADJUSTED CARD */}
                                    <button 
                                        onClick={() => !isModalAdjustedEqualSimple && setModalCpaMode('ADJUSTED')}
                                        disabled={isModalAdjustedEqualSimple}
                                        className={`p-3 rounded-xl border flex flex-col justify-center transition-all relative overflow-hidden group text-left ${
                                            modalCpaMode === 'ADJUSTED' 
                                            ? 'bg-teal-900/20 border-teal-500 shadow-md ring-1 ring-teal-500/50' 
                                            : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                                        } ${isModalAdjustedEqualSimple ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                                    >
                                        <div className="flex justify-between items-center w-full mb-1">
                                            <div className="flex flex-col">
                                                <span className={`${modalCpaMode === 'ADJUSTED' ? 'text-teal-400' : 'text-gray-400'} text-xs font-bold uppercase`}>CPA Ajustado</span>
                                                {isModalAdjustedEqualSimple && (
                                                    <span className="text-[9px] text-gray-500 font-medium">Sin atípicos</span>
                                                )}
                                            </div>
                                            {modalCpaMode === 'ADJUSTED' && <CheckCircle2 className="h-3.5 w-3.5 text-teal-500" />}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-2xl font-bold ${modalCpaMode === 'ADJUSTED' ? 'text-teal-400' : 'text-gray-500'}`}>
                                                {modalDynamicData?.analysis.adjusted.toFixed(1)}
                                            </span>
                                        </div>
                                    </button>

                                    {/* CPA SIMPLE CARD */}
                                    <button 
                                        onClick={() => setModalCpaMode('SIMPLE')}
                                        className={`p-3 rounded-xl border flex flex-col justify-center transition-all relative overflow-hidden group text-left ${
                                            modalCpaMode === 'SIMPLE' 
                                            ? 'bg-blue-900/20 border-blue-500 shadow-md ring-1 ring-blue-500/50' 
                                            : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                                        }`}
                                    >
                                        <div className="flex justify-between items-center w-full mb-1">
                                            <span className={`${modalCpaMode === 'SIMPLE' ? 'text-blue-400' : 'text-gray-400'} text-xs font-bold uppercase`}>CPA Simple</span>
                                            {modalCpaMode === 'SIMPLE' && <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-2xl font-bold ${modalCpaMode === 'SIMPLE' ? 'text-blue-400' : 'text-gray-500'} ${(modalDynamicData?.analysis.spikes || 0) > 0 && modalCpaMode !== 'SIMPLE' ? 'line-through decoration-red-500/50' : ''}`}>
                                                {modalDynamicData?.analysis.raw.toFixed(1)}
                                            </span>
                                            {(modalDynamicData?.analysis.spikes || 0) > 0 && modalCpaMode !== 'SIMPLE' && (
                                                <MousePointerClick className="h-3.5 w-3.5 text-gray-500 opacity-50" />
                                            )}
                                        </div>
                                    </button>

                                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700">
                                        <div className="text-gray-400 text-xs font-bold uppercase mb-1">Meses Disp.</div>
                                        <div className="text-2xl font-bold text-blue-400">
                                            {modalDynamicData?.months === 999 ? '∞' : modalDynamicData?.months.toFixed(1)}
                                        </div>
                                    </div>
                                    <div className={`p-3 rounded-xl border ${modalDynamicData?.status === 'NormoStock' ? 'bg-green-900/20 border-green-800' :
                                        modalDynamicData?.status === 'SobreStock' ? 'bg-indigo-900/20 border-indigo-800' :
                                            modalDynamicData?.status === 'SubStock' ? 'bg-orange-900/20 border-orange-800' :
                                                'bg-red-900/20 border-red-800'
                                        }`}>
                                        <div className="text-gray-400 text-xs font-bold uppercase mb-1">Situación</div>
                                        <div className={`text-xl font-bold truncate ${modalDynamicData?.status === 'NormoStock' ? 'text-green-400' :
                                            modalDynamicData?.status === 'SobreStock' ? 'text-indigo-400' :
                                                modalDynamicData?.status === 'SubStock' ? 'text-orange-400' :
                                                    'text-red-400'
                                            }`}>
                                            {modalDynamicData?.status}
                                        </div>
                                    </div>
                                </div>

                                {/* Consumption Table */}
                                <div className="p-5 overflow-x-auto">
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-3 gap-4">
                                        <h3 className="text-white text-sm font-bold flex items-center gap-2">
                                            <FileSpreadsheet className="h-4 w-4 text-teal-500" />
                                            Histórico de Consumo (Últimos 12 Meses)
                                        </h3>
                                        <div className="flex gap-3">
                                            <div className="bg-gray-800 px-2.5 py-1 rounded-lg border border-gray-700 flex items-center gap-2">
                                                <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">Suma Total</span>
                                                <span className="text-white font-mono font-bold text-lg leading-none">{selectedDetailItem.consumptionSum}</span>
                                            </div>
                                            <div className="bg-gray-800 px-2.5 py-1 rounded-lg border border-gray-700 flex items-center gap-2">
                                                <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">Meses con Consumo</span>
                                                <span className="text-white font-mono font-bold text-lg leading-none">{selectedDetailItem.consumptionMonths}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="border border-gray-700 rounded-lg overflow-hidden">
                                        <div className="grid grid-cols-12 divide-x divide-gray-700 bg-gray-950 text-gray-400 text-sm font-bold uppercase text-center">
                                            {Array.from({ length: 12 }).map((_, i) => {
                                                // Extract month and year from lastMonthYear (YYYY-MM)
                                                const [selectedYear, selectedMonth] = lastMonthYear.split('-').map(Number);
                                                
                                                // Calculate the month index (0-11) and the corresponding year
                                                // We are looking at the 12 months ending in selectedMonth/selectedYear
                                                // The sequence starts 11 months before selectedMonth
                                                let monthIndex = (selectedMonth - 12 + i) % 12;
                                                if (monthIndex < 0) monthIndex += 12;
                                                
                                                // Calculate year for this specific month
                                                // If monthIndex is greater than selectedMonth-1, it belongs to the previous year
                                                let year = selectedYear;
                                                if (monthIndex > (selectedMonth - 1)) {
                                                    year -= 1;
                                                }
                                                
                                                const monthNames = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
                                                const yearShort = String(year).slice(-2);
                                                
                                                return <div key={i} className="py-2 px-1">{`${monthNames[monthIndex]} ${yearShort}`}</div>;
                                            })}
                                        </div>
                                        <div className="grid grid-cols-12 divide-x divide-gray-700 bg-gray-900 text-white font-mono text-base font-bold text-center">
                                            {selectedDetailItem.monthlyConsumption && selectedDetailItem.monthlyConsumption.length === 12 ? (
                                                selectedDetailItem.monthlyConsumption.map((val, i) => {
                                                    const isExcluded = modalExcludedIndices.includes(i);
                                                    const isSpike = modalDynamicData?.analysis.isSporadic ? false : val > (modalDynamicData?.analysis.threshold || 0);
                                                    const isLow = val > 0 && val < (modalDynamicData?.analysis.lowThreshold || 0);
                                                    
                                                    let bgColor = '';
                                                    let textColor = val === 0 ? 'text-gray-600' : 'text-white';
                                                    
                                                    if (isExcluded) {
                                                        bgColor = 'bg-gray-800/50';
                                                        textColor = 'text-gray-500 line-through';
                                                    } else if (modalCpaMode === 'ADJUSTED') {
                                                        if (isSpike) {
                                                            bgColor = 'bg-rose-900/30';
                                                            textColor = 'text-rose-400';
                                                        } else if (isLow) {
                                                            bgColor = 'bg-amber-900/30';
                                                            textColor = 'text-amber-400';
                                                        }
                                                    }

                                                    return (
                                                        <div 
                                                            key={i} 
                                                            className={`py-3 px-1 cursor-pointer hover:bg-gray-800 transition-colors relative group ${bgColor} ${textColor}`}
                                                            onClick={() => {
                                                                if (val === 0) return;
                                                                setModalExcludedIndices(prev => 
                                                                    prev.includes(i) ? prev.filter(idx => idx !== i) : [...prev, i]
                                                                );
                                                            }}
                                                            title={val === 0 ? 'Sin consumo' : isExcluded ? 'Click para incluir' : 'Click para excluir'}
                                                        >
                                                            {val}
                                                            {val > 0 && (
                                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/50 transition-opacity">
                                                                    {isExcluded ? <Check className="h-4 w-4 text-green-400" /> : <X className="h-4 w-4 text-red-400" />}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="col-span-12 p-4 text-gray-500 italic">
                                                    No hay datos de consumo mensual disponibles.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Audit Criteria & Estimation */}
                                <div className="p-5 grid grid-cols-1 md:grid-cols-[1fr_400px] gap-5">
                                    <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-4 text-xs text-gray-300">
                                        <div className="flex items-center gap-2 text-amber-400 font-bold mb-2">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            <span>Criterio de Auditoría (Ficha 30)</span>
                                        </div>
                                        <ul className="space-y-1 list-disc list-inside text-gray-400">
                                            <li>Se calculó la mediana histórica de los meses con movimiento.</li>
                                            <li>El umbral de tolerancia se fijó en <span className="font-bold text-white">{modalDynamicData?.analysis.threshold.toFixed(1)}</span> unidades.</li>
                                            
                                            {/* DYNAMIC: Low consumption only if relevant */}
                                            {(modalDynamicData?.analysis.lowThreshold || 0) > 0 && (modalDynamicData?.analysis.lows || 0) > 0 && (
                                                <li>
                                                    {modalCpaMode === 'ADJUSTED' ? (
                                                        <>Los meses pintados en <span className="bg-yellow-600/50 text-yellow-300 px-1 rounded font-bold">AMARILLO</span> se resaltan por ser consumos muy bajos (menores a <span className="font-bold text-white">{modalDynamicData?.analysis.lowThreshold.toFixed(1)}</span>).</>
                                                    ) : (
                                                        <>Se detectaron consumos muy bajos (menores a <span className="font-bold text-white">{modalDynamicData?.analysis.lowThreshold.toFixed(1)}</span>).</>
                                                    )}
                                                </li>
                                            )}
                                            
                                            {/* DYNAMIC: Manual mode text */}
                                            {modalCpaMode === 'SIMPLE' && (
                                                <li><span className="font-bold text-white">MODO MANUAL ACTIVO:</span> Se están considerando todos los meses (incluso atípicos) para el cálculo.</li>
                                            )}
                                            
                                            {/* DYNAMIC: Manual exclusion text */}
                                            {modalExcludedIndices.length > 0 && (
                                                <li>EXCLUSIÓN MANUAL: Se han excluido <span className="font-bold text-white">{modalExcludedIndices.length}</span> mes(es) del cálculo por decisión del usuario (tachados).</li>
                                            )}

                                            {/* DYNAMIC: Red spike exclusion text (only in ADJUSTED mode) */}
                                            {modalCpaMode === 'ADJUSTED' && (modalDynamicData?.analysis.spikes || 0) > 0 && (
                                                <li>Los meses pintados de <span className="bg-red-900/50 text-red-300 px-1 rounded font-bold">ROJO</span> se excluyen del cálculo.</li>
                                            )}
                                        </ul>
                                    </div>

                                    {/* NEW: ESTIMATION SECTION */}
                                    <div className="bg-indigo-900/10 border border-indigo-500/30 rounded-xl p-4 text-xs">
                                        <div className="flex items-center gap-2 text-indigo-400 font-bold mb-3">
                                            <Sparkles className="h-3.5 w-3.5" />
                                            <span>Simulador de Abastecimiento</span>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="text-gray-400 text-xs font-bold uppercase block mb-1">Balance Actual</label>
                                                    <div className={`text-xl font-bold ${
                                                        (() => {
                                                            const balance = calculateNeed(
                                                                selectedDetailItem.stock, 
                                                                modalDynamicData?.cpm || 0, 
                                                                modalDynamicData?.status || '', 
                                                                Number(selectedDetailItem.consumptionMonths || 0)
                                                            );
                                                            if (balance > 0) return 'text-blue-400';
                                                            if (balance < 0) return 'text-red-400';
                                                            return 'text-white';
                                                        })()
                                                    }`}>
                                                        {(() => {
                                                            const balance = calculateNeed(
                                                                selectedDetailItem.stock, 
                                                                modalDynamicData?.cpm || 0, 
                                                                modalDynamicData?.status || '', 
                                                                Number(selectedDetailItem.consumptionMonths || 0)
                                                            );
                                                            return balance === 0 ? '-' : balance;
                                                        })()}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-indigo-300 text-xs font-bold uppercase block mb-1">Cantidad a Estimar</label>
                                                    <input 
                                                        type="number"
                                                        value={modalEstimation || ''}
                                                        onChange={(e) => setModalEstimation(Number(e.target.value))}
                                                        placeholder="Ej: 50"
                                                        className="w-full bg-gray-800 border border-indigo-500/50 rounded-lg px-2 py-1.5 text-white font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                                    />
                                                </div>
                                            </div>

                                            <div className="bg-indigo-500/5 rounded-lg p-2.5 border border-indigo-500/20 flex flex-col justify-between">
                                                <div className="space-y-2">
                                                    <div>
                                                        <label className="text-gray-400 text-xs font-bold uppercase block mb-0.5">Nuevo Stock</label>
                                                        <div className="text-xl font-bold text-white">
                                                            {selectedDetailItem.stock + (modalEstimation || 0)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-2 pt-2 border-t border-indigo-500/10">
                                                    <label className="text-gray-400 text-xs font-bold uppercase block mb-0.5">Nuevos Meses</label>
                                                    <div className={`text-xl font-bold ${
                                                        (() => {
                                                            const newStock = selectedDetailItem.stock + (modalEstimation || 0);
                                                            const cpm = modalDynamicData?.cpm || 0;
                                                            const newMonths = cpm > 0 ? newStock / cpm : (newStock > 0 ? 999 : 0);
                                                            
                                                            if (newMonths === 0) return 'text-red-400';
                                                            if (newMonths < 2) return 'text-orange-400';
                                                            if (newMonths <= 6) return 'text-green-400';
                                                            return 'text-indigo-400';
                                                        })()
                                                    }`}>
                                                        {(() => {
                                                            const newStock = selectedDetailItem.stock + (modalEstimation || 0);
                                                            const cpm = modalDynamicData?.cpm || 0;
                                                            const newMonths = cpm > 0 ? newStock / cpm : (newStock > 0 ? 999 : 0);
                                                            return newMonths === 999 ? '∞' : newMonths.toFixed(1);
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="p-5 border-t border-gray-800 bg-gray-900 z-10 flex justify-between items-center">
                                <div className="flex gap-3">
                                    {!selectedDetailItem.isWarehouse && (
                                        <button
                                            onClick={() => {
                                                if (isGlobalSearchModalOpen) {
                                                    // If global search is open, this is a destination
                                                    setQuickTransferDestination(selectedDetailItem);
                                                    setIsDetailModalOpen(false);
                                                    setIsGlobalSearchModalOpen(false);
                                                    setIsQuickTransferConfirmOpen(true);
                                                    toast.success(`Destino seleccionado: ${selectedDetailItem.establishmentName}`);
                                                } else {
                                                    // Otherwise, this is a source
                                                    setQuickTransferSource(selectedDetailItem);
                                                    setIsDetailModalOpen(false);
                                                    toast.success(`Origen seleccionado: ${selectedDetailItem.establishmentName}`);
                                                }
                                            }}
                                            className={`px-6 py-2 ${isGlobalSearchModalOpen ? 'bg-green-600 hover:bg-green-700 shadow-green-500/20' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20'} text-white font-bold rounded-lg transition-colors flex items-center gap-2 shadow-lg`}
                                        >
                                            <MousePointerClick className="h-4 w-4" />
                                            {isGlobalSearchModalOpen ? 'Transferir a este destino' : 'Transferir desde aquí'}
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={() => setIsDetailModalOpen(false)}
                                    className="px-6 py-2 bg-white text-gray-900 font-bold rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* TRANSFER MODAL REMOVED */}
        </div >
    );
};

