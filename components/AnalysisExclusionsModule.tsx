import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Ban, 
  Plus, 
  UploadCloud, 
  Download, 
  FileSpreadsheet, 
  Search, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  AlertTriangle, 
  Building2, 
  FileText, 
  RefreshCw, 
  X, 
  Layers, 
  Info,
  ChevronDown,
  MoreHorizontal
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { HealthFacility, RequirementExclusionItem } from "../types";
import { requirementExclusionService } from "../services/requirementExclusionService";
import { filterFacilitiesByJurisdiction, getUserJurisdictionScope } from "../services/jurisdictionService";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import { TablePagination } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { BottomSheet } from "./ui/BottomSheet";
import { FloatingActionButton } from "./ui/FloatingActionButton";
import { noticeWhen } from "../services/notifications";
import { 
  KpiCard, 
  KpiStrip, 
  formatDate, 
  TableHeaderCell as HeaderCell, 
  FormField as Field, 
  inputClass, 
  filterInputClass, 
  EmptyState
} from "./ui/kit";

/** Una acción en el panel inferior del celular. */
const SheetAction: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }> = ({ icon, label, onClick, disabled, danger }) => (
  <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold hover:bg-slate-50 disabled:opacity-40 ${danger ? "text-rose-700" : "text-slate-700"}`}>
    {icon}{label}
  </button>
);

export const AnalysisExclusionsModule: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "ADMIN";

  const userScope = useMemo(() => getUserJurisdictionScope(user), [user]);

  // Facilities list
  const [facilities, setFacilities] = useState<HealthFacility[]>([]);
  const [selectedFacilityCode, setSelectedFacilityCode] = useState<string>("");
  const [facilitySearch, setFacilitySearch] = useState<string>("");
  const [isFacilityDropdownOpen, setIsFacilityDropdownOpen] = useState(false);

  const canChangeFacility = useMemo(() => {
    return facilities.length > 1 && userScope.level !== "IPRESS";
  }, [facilities.length, userScope.level]);

  // Exclusions state
  const [exclusions, setExclusions] = useState<RequirementExclusionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Modal manual item
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RequirementExclusionItem | null>(null);
  const [formData, setFormData] = useState({
    sismedCode: "",
    description: "",
    presentation: "",
    reason: ""
  });
  const [isSaving, setIsSaving] = useState(false);

  // Excel Actions Dropdown
  const [isExcelDropdownOpen, setIsExcelDropdownOpen] = useState(false);
  const excelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (excelDropdownRef.current && !excelDropdownRef.current.contains(event.target as Node)) {
        setIsExcelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Modal Excel Upload
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedPreview, setParsedPreview] = useState<{
    items: RequirementExclusionItem[];
    totalRows: number;
    validCount: number;
    invalidCount: number;
    errors: string[];
  } | null>(null);
  const [isProcessingExcel, setIsProcessingExcel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Confirmation dialogs
  const [deleteTarget, setDeleteTarget] = useState<RequirementExclusionItem | null>(null);
  const [isClearAllDialogOpen, setIsClearAllDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Cargar lista de establecimientos segun jurisdiccion
  useEffect(() => {
    const loadFacilities = async () => {
      try {
        const facs = await api.getFacilities();
        const allowedFacs = filterFacilitiesByJurisdiction(facs, user);
        setFacilities(allowedFacs);

        // Seleccionar establecimiento inicial
        const userFacilityCode = user?.facilityData?.code || user?.personnelData?.facilityCode;
        if (userFacilityCode && allowedFacs.some(f => f.code === userFacilityCode)) {
          setSelectedFacilityCode(userFacilityCode);
        } else if (allowedFacs.length > 0) {
          setSelectedFacilityCode(allowedFacs[0].code);
        }
      } catch (e) {
        console.error("Error al cargar establecimientos", e);
        toast.error("Error al cargar lista de establecimientos");
      }
    };
    loadFacilities();
  }, [user]);

  // Cargar exclusiones del establecimiento seleccionado
  const loadExclusions = async () => {
    if (!selectedFacilityCode) return;
    setIsLoading(true);
    try {
      const data = await requirementExclusionService.getExclusionsByFacility(selectedFacilityCode);
      setExclusions(data);
    } catch (err) {
      console.error("Error loading exclusions", err);
      toast.error("Error al cargar la lista de exclusiones");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadExclusions();
  }, [selectedFacilityCode]);

  // Establecimiento seleccionado actual
  const currentFacility = useMemo(() => {
    return facilities.find(f => f.code === selectedFacilityCode) || {
      code: selectedFacilityCode,
      name: "Establecimiento no especificado",
      category: ""
    };
  }, [facilities, selectedFacilityCode]);

  // Filtrado de establecimientos para el selector
  const filteredFacilities = useMemo(() => {
    if (!facilitySearch.trim()) return facilities;
    const term = facilitySearch.toLowerCase();
    return facilities.filter(
      f => f.code.toLowerCase().includes(term) || f.name.toLowerCase().includes(term)
    );
  }, [facilities, facilitySearch]);

  // Filtrado de la tabla de exclusiones
  const filteredExclusions = useMemo(() => {
    if (!searchTerm.trim()) return exclusions;
    const term = searchTerm.toLowerCase();
    return exclusions.filter(
      item =>
        item.sismedCode.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        (item.presentation && item.presentation.toLowerCase().includes(term)) ||
        (item.reason && item.reason.toLowerCase().includes(term))
    );
  }, [exclusions, searchTerm]);

  // KPIs
  const totalCount = exclusions.length;
  const withReasonCount = exclusions.filter(e => e.reason && e.reason.trim().length > 0).length;
  /** El cambio más reciente de la lista (alta o edición), o vacío si no hay registros. */
  const lastUpdatedAt = useMemo(() => {
    const dates = exclusions.map(e => e.updatedAt || e.createdAt).filter(Boolean) as string[];
    dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return dates[0] || "";
  }, [exclusions]);

  // Escritorio: páginas numeradas. Celular: la lista crece al bajar.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [searchTerm, selectedFacilityCode]);
  const pageRows = filteredExclusions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const mobileList = useIncrementalCount(filteredExclusions.length, `${searchTerm}|${selectedFacilityCode}`, 20);
  const [actionsOpen, setActionsOpen] = useState(false);

  // --- HANDLERS MANUAL ITEM ---
  const handleOpenNewItem = () => {
    setEditingItem(null);
    setFormData({ sismedCode: "", description: "", presentation: "", reason: "" });
    setIsItemModalOpen(true);
  };

  const handleOpenEditItem = (item: RequirementExclusionItem) => {
    setEditingItem(item);
    setFormData({
      sismedCode: item.sismedCode,
      description: item.description,
      presentation: item.presentation || "",
      reason: item.reason || ""
    });
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sismedCode.trim() || !formData.description.trim()) {
      toast.error("El código SISMED y la descripción son obligatorios");
      return;
    }

    setIsSaving(true);
    const tid = toast.loading(editingItem ? "Actualizando medicamento..." : "Guardando en lista de exclusión...");
    try {
      const res = await requirementExclusionService.saveExclusion({
        id: editingItem?.id,
        establishmentCode: selectedFacilityCode,
        sismedCode: formData.sismedCode.trim(),
        description: formData.description.trim().toUpperCase(),
        presentation: formData.presentation.trim().toUpperCase(),
        reason: formData.reason.trim(),
        createdBy: user?.username || "Usuario"
      });

      if (res.success) {
        toast.success(editingItem ? "Medicamento actualizado" : "Medicamento agregado a la lista", { id: tid });
        setIsItemModalOpen(false);
        await loadExclusions();
      } else {
        toast.error(res.message || "No se pudo guardar el medicamento", { id: tid });
      }
    } catch (err: any) {
      toast.error(err.message || "Error al procesar", { id: tid });
    } finally {
      setIsSaving(false);
    }
  };

  // --- HANDLER DELETE ---
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const tid = toast.loading("Eliminando medicamento...");
    try {
      await requirementExclusionService.deleteExclusion(
        deleteTarget.id || "",
        deleteTarget.establishmentCode,
        deleteTarget.sismedCode
      );
      toast.success("Medicamento eliminado de la lista", { id: tid });
      setDeleteTarget(null);
      await loadExclusions();
    } catch (err) {
      toast.error("Error al eliminar medicamento", { id: tid });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setIsDeleting(true);
    const tid = toast.loading("Vaciando lista de exclusión...");
    try {
      await requirementExclusionService.clearExclusionsByFacility(selectedFacilityCode);
      toast.success("Lista de exclusión vaciada correctamente", { id: tid });
      setIsClearAllDialogOpen(false);
      await loadExclusions();
    } catch (err) {
      toast.error("Error al vaciar la lista", { id: tid });
    } finally {
      setIsDeleting(false);
    }
  };

  // --- HANDLERS EXCEL UPLOAD ---
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setIsProcessingExcel(true);
    try {
      const parsed = await requirementExclusionService.parseExclusionExcel(
        file,
        selectedFacilityCode,
        user?.username
      );
      setParsedPreview(parsed);
      if (parsed.validCount === 0) {
        toast.error("No se encontraron filas válidas en el archivo Excel");
      } else {
        toast.success(`Archivo leído: ${parsed.validCount} medicamentos listos para importar`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al procesar el archivo Excel");
      setParsedPreview(null);
    } finally {
      setIsProcessingExcel(false);
    }
  };

  const handleConfirmExcelImport = async () => {
    if (!parsedPreview || parsedPreview.items.length === 0) return;
    setIsSaving(true);
    const tid = toast.loading(`Importando ${parsedPreview.items.length} medicamentos...`);
    try {
      const res = await requirementExclusionService.saveExclusionsBatch(
        selectedFacilityCode,
        parsedPreview.items,
        user?.username
      );

      if (res.success) {
        toast.success(
          `Importación exitosa: ${res.count} medicamentos procesados${
            res.duplicatesCount > 0 ? ` (${res.duplicatesCount} duplicados unificados)` : ""
          }`,
          { id: tid }
        );
        setIsUploadModalOpen(false);
        setUploadedFile(null);
        setParsedPreview(null);
        await loadExclusions();
      } else {
        toast.error(res.message || "Error durante la importación", { id: tid });
      }
    } catch (err: any) {
      toast.error(err.message || "Error al guardar los datos", { id: tid });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-24 animate-in fade-in duration-300 md:pb-12">
      {/* Sin cabecera propia: el título ya está en la cabecera de la app. */}
      <KpiStrip cols="md:grid-cols-3">
        <KpiCard watermark tone={totalCount > 0 ? "warning" : "neutral"} icon={<Ban />} label="Total excluidos" value={totalCount} hint="medicamentos fuera del análisis" />
        <KpiCard watermark tone="info" icon={<FileText />} label="Con motivo detallado" value={withReasonCount} hint={totalCount - withReasonCount ? `${totalCount - withReasonCount} sin motivo registrado` : "todos con motivo"} />
        <KpiCard watermark tone="neutral" icon={<Layers />} label="Última actualización" value={lastUpdatedAt ? formatDate(lastUpdatedAt) : "—"} hint={lastUpdatedAt ? noticeWhen(lastUpdatedAt) : "sin registros"} />
      </KpiStrip>

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Barra: buscador, establecimiento (solo quien supervisa varios) y acciones. */}
        <div className="flex items-center gap-2 border-b border-slate-100 p-3 md:px-4">
          <div className="relative min-w-0 flex-1 md:max-w-xs">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar por código, descripción o motivo..."
              className={filterInputClass + " pl-9 pr-8"}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {canChangeFacility && (
            <div className="hidden w-72 md:block">
            {/* Custom dropdown selector */}
            <div className="relative">
              <button
                type="button"
                disabled={!canChangeFacility}
                onClick={() => canChangeFacility && setIsFacilityDropdownOpen(!isFacilityDropdownOpen)}
                className={`w-full flex items-center justify-between text-left h-11 px-3.5 rounded-xl border border-slate-200 font-bold text-slate-800 text-sm transition-colors outline-none ${
                  canChangeFacility
                    ? "bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer focus:ring-4 focus:ring-teal-100 focus:border-teal-500"
                    : "bg-slate-50/50 cursor-default opacity-90"
                }`}
              >
                <span className="truncate">
                  {currentFacility.name} {currentFacility.category ? `(${currentFacility.category})` : ""}
                </span>
                {canChangeFacility ? (
                  <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${isFacilityDropdownOpen ? "rotate-180" : ""}`} />
                ) : (
                  <span className="text-[10px] text-slate-400 font-normal shrink-0 px-2 py-0.5 rounded bg-slate-100">
                    Fijo
                  </span>
                )}
              </button>

              {canChangeFacility && isFacilityDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-20" 
                    onClick={() => setIsFacilityDropdownOpen(false)} 
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white rounded-xl border border-slate-200 shadow-xl max-h-72 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-2 border-b border-slate-100 bg-slate-50">
                      <div className="relative">
                        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={facilitySearch}
                          onChange={e => setFacilitySearch(e.target.value)}
                          placeholder="Buscar establecimiento o código..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white outline-none focus:border-teal-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto divide-y divide-slate-100 py-1">
                      {filteredFacilities.length === 0 ? (
                        <div className="px-4 py-3 text-center text-xs text-slate-400">
                          No se encontraron establecimientos
                        </div>
                      ) : (
                        filteredFacilities.map(f => (
                          <button
                            key={f.code}
                            type="button"
                            onClick={() => {
                              setSelectedFacilityCode(f.code);
                              setIsFacilityDropdownOpen(false);
                              setFacilitySearch("");
                            }}
                            className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between hover:bg-teal-50/80 transition-colors ${
                              f.code === selectedFacilityCode ? "bg-teal-50 text-teal-900 font-bold" : "text-slate-700"
                            }`}
                          >
                            <span className="truncate pr-2">{f.name}</span>
                            <span className="font-mono text-[10px] text-slate-400 shrink-0 px-1.5 py-0.5 rounded bg-slate-100">
                              {f.code}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            </div>
          )}

          <div className="ml-auto hidden items-center gap-2 md:flex">
            {exclusions.length > 0 && (
              <button
                onClick={() => setIsClearAllDialogOpen(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vaciar lista
              </button>
            )}
            <div className="relative shrink-0" ref={excelDropdownRef}>
              <button
                type="button"
                onClick={() => setIsExcelDropdownOpen(!isExcelDropdownOpen)}
                className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 whitespace-nowrap"
              >
                <FileSpreadsheet className="h-4 w-4 text-teal-600" />
                <span>Opciones Excel</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isExcelDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {isExcelDropdownOpen && (
                <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-slate-200 shadow-xl p-1.5 z-30 animate-in fade-in slide-in-from-top-2 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setIsExcelDropdownOpen(false);
                      setUploadedFile(null);
                      setParsedPreview(null);
                      setIsUploadModalOpen(true);
                    }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold text-teal-700 hover:bg-teal-50 transition-colors"
                  >
                    <UploadCloud className="h-4 w-4 text-teal-600 shrink-0" />
                    <div className="flex flex-col">
                      <span>Carga Masiva Excel</span>
                      <span className="text-[10px] text-teal-600/70 font-normal">Importar medicamentos en lote</span>
                    </div>
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsExcelDropdownOpen(false);
                      requirementExclusionService.downloadTemplate();
                    }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100/80 transition-colors"
                  >
                    <Download className="h-4 w-4 text-slate-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-bold">Descargar Plantilla</span>
                      <span className="text-[10px] text-slate-400 font-normal">Formato Excel de ejemplo</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsExcelDropdownOpen(false);
                      requirementExclusionService.exportExclusionsToExcel(exclusions, currentFacility.name, selectedFacilityCode);
                    }}
                    disabled={exclusions.length === 0}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-bold">Exportar Lista (.xlsx)</span>
                      <span className="text-[10px] text-slate-400 font-normal">Guardar medicamentos excluidos</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleOpenNewItem}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-xs font-bold text-white whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Nuevo medicamento</span>
            </button>
          </div>

          {/* Celular: el botón principal es flotante (abajo); «…» abre el resto de acciones. */}
          <FloatingActionButton icon={<Plus />} label="Nuevo medicamento" onClick={handleOpenNewItem} />
          <button type="button" onClick={() => setActionsOpen(true)} aria-label="Más acciones" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 md:hidden">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>

        {/* Celular, quien supervisa varios: de qué establecimiento es la lista; tocar abre el cambio. */}
        {canChangeFacility && (
          <button type="button" onClick={() => setActionsOpen(true)} className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2 text-left text-[12.5px] text-slate-600 md:hidden">
            <Building2 className="h-4 w-4 shrink-0 text-teal-600" />
            <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{currentFacility.name}</span>
            <span className="font-mono text-[11px] text-slate-400">{selectedFacilityCode}</span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        )}

        <BottomSheet open={actionsOpen} title="Acciones" onClose={() => setActionsOpen(false)}>
          {canChangeFacility && (
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Establecimiento</p>
            {/* Custom dropdown selector */}
            <div className="relative">
              <button
                type="button"
                disabled={!canChangeFacility}
                onClick={() => canChangeFacility && setIsFacilityDropdownOpen(!isFacilityDropdownOpen)}
                className={`w-full flex items-center justify-between text-left h-11 px-3.5 rounded-xl border border-slate-200 font-bold text-slate-800 text-sm transition-colors outline-none ${
                  canChangeFacility
                    ? "bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer focus:ring-4 focus:ring-teal-100 focus:border-teal-500"
                    : "bg-slate-50/50 cursor-default opacity-90"
                }`}
              >
                <span className="truncate">
                  {currentFacility.name} {currentFacility.category ? `(${currentFacility.category})` : ""}
                </span>
                {canChangeFacility ? (
                  <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${isFacilityDropdownOpen ? "rotate-180" : ""}`} />
                ) : (
                  <span className="text-[10px] text-slate-400 font-normal shrink-0 px-2 py-0.5 rounded bg-slate-100">
                    Fijo
                  </span>
                )}
              </button>

              {canChangeFacility && isFacilityDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-20" 
                    onClick={() => setIsFacilityDropdownOpen(false)} 
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white rounded-xl border border-slate-200 shadow-xl max-h-72 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-2 border-b border-slate-100 bg-slate-50">
                      <div className="relative">
                        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={facilitySearch}
                          onChange={e => setFacilitySearch(e.target.value)}
                          placeholder="Buscar establecimiento o código..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white outline-none focus:border-teal-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto divide-y divide-slate-100 py-1">
                      {filteredFacilities.length === 0 ? (
                        <div className="px-4 py-3 text-center text-xs text-slate-400">
                          No se encontraron establecimientos
                        </div>
                      ) : (
                        filteredFacilities.map(f => (
                          <button
                            key={f.code}
                            type="button"
                            onClick={() => {
                              setSelectedFacilityCode(f.code);
                              setIsFacilityDropdownOpen(false);
                              setFacilitySearch("");
                            }}
                            className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between hover:bg-teal-50/80 transition-colors ${
                              f.code === selectedFacilityCode ? "bg-teal-50 text-teal-900 font-bold" : "text-slate-700"
                            }`}
                          >
                            <span className="truncate pr-2">{f.name}</span>
                            <span className="font-mono text-[10px] text-slate-400 shrink-0 px-1.5 py-0.5 rounded bg-slate-100">
                              {f.code}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            </div>
          )}
          <div className="space-y-1">
            <SheetAction icon={<UploadCloud className="h-5 w-5 text-teal-600" />} label="Carga masiva Excel" onClick={() => { setActionsOpen(false); setUploadedFile(null); setParsedPreview(null); setIsUploadModalOpen(true); }} />
            <SheetAction icon={<Download className="h-5 w-5 text-slate-500" />} label="Descargar plantilla" onClick={() => { setActionsOpen(false); requirementExclusionService.downloadTemplate(); }} />
            <SheetAction icon={<FileSpreadsheet className="h-5 w-5 text-emerald-600" />} label="Exportar lista (.xlsx)" disabled={exclusions.length === 0} onClick={() => { setActionsOpen(false); requirementExclusionService.exportExclusionsToExcel(exclusions, currentFacility.name, selectedFacilityCode); }} />
            <SheetAction icon={<RefreshCw className="h-5 w-5 text-teal-600" />} label="Actualizar" onClick={() => { setActionsOpen(false); void loadExclusions(); }} />
            {exclusions.length > 0 && (
              <SheetAction icon={<Trash2 className="h-5 w-5 text-rose-600" />} label="Vaciar lista" danger onClick={() => { setActionsOpen(false); setIsClearAllDialogOpen(true); }} />
            )}
          </div>
        </BottomSheet>

        {/* Tabla (escritorio) */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/75">
                <HeaderCell align="left">N°</HeaderCell>
                <HeaderCell align="left">Código SISMED</HeaderCell>
                <HeaderCell align="left">Descripción del Medicamento</HeaderCell>
                <HeaderCell align="left">Presentación</HeaderCell>
                <HeaderCell align="left">Motivo de Exclusión</HeaderCell>
                <HeaderCell align="left">Fecha Registro</HeaderCell>
                <HeaderCell align="right">Acciones</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-teal-600 mb-2" />
                    <span className="text-sm font-semibold">Cargando medicamentos excluidos...</span>
                  </td>
                </tr>
              ) : filteredExclusions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12">
                    <EmptyState
                      title={searchTerm ? "No se encontraron coincidencias" : "Sin medicamentos excluidos"}
                      description={
                        searchTerm
                          ? "Intente con otro término de búsqueda o limpie el filtro."
                          : "Este establecimiento no tiene medicamentos en su lista de exclusión. Utilice el botón 'Nuevo Medicamento' o 'Carga Masiva Excel' para agregar productos."
                      }
                      action={
                        !searchTerm ? (
                          <button
                            onClick={handleOpenNewItem}
                            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-xs font-bold text-white shadow-sm transition-colors"
                          >
                            <Plus className="h-4 w-4" />
                            Agregar Primer Medicamento
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                pageRows.map((item, index) => (
                  <tr
                    key={item.id || item.sismedCode}
                    className="hover:bg-slate-50/80 transition-colors group"
                  >
                    <td className="px-4 py-3.5 text-xs font-semibold text-slate-400">
                      {(page - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center font-mono text-xs font-bold px-2 py-1 rounded-md bg-slate-100 text-slate-800 border border-slate-200">
                        {item.sismedCode}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs font-bold text-slate-900 max-w-xs md:max-w-md">
                      <span className="line-clamp-2">{item.description}</span>
                    </td>
                    <td className="px-4 py-3.5 text-xs font-semibold text-slate-600">
                      {item.presentation || <span className="text-slate-300">---</span>}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-600 max-w-xs">
                      {item.reason ? (
                        <span className="line-clamp-2 italic text-slate-700 bg-amber-50/70 border border-amber-200/50 px-2 py-1 rounded text-[11px]">
                          {item.reason}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[11px]">Sin motivo registrado</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-500 font-semibold">
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString("es-PE") : "---"}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100">
                        <button
                          onClick={() => handleOpenEditItem(item)}
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(item)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={filteredExclusions.length} onPageChange={setPage} itemLabel="medicamentos" />
        </div>

        {/* Celular: tarjetas; la lista crece al bajar. */}
        <div className="md:hidden">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm font-semibold text-slate-400"><RefreshCw className="h-5 w-5 animate-spin text-teal-600" /> Cargando…</div>
          ) : filteredExclusions.length === 0 ? (
            <EmptyState
              title={searchTerm ? "No se encontraron coincidencias" : "Sin medicamentos excluidos"}
              description={searchTerm ? "Intente con otro término de búsqueda." : "Agregue un medicamento con el botón «+» o desde la carga masiva."}
            />
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {filteredExclusions.slice(0, mobileList.count).map(item => (
                  <li key={item.id || item.sismedCode} className="px-4 py-3">
                    {/* Sin fecha de registro: en el celular se confundía con la de vencimiento. */}
                    <p className="text-[14px] font-bold leading-snug text-slate-900">{item.description}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      <span className="font-mono text-teal-700">{item.sismedCode}</span>
                      {item.presentation && <> · {item.presentation}</>}
                    </p>
                    {item.reason && <p className="mt-1 text-[12px] italic text-slate-500">«{item.reason}»</p>}
                    {/* Acciones grandes y separadas, fáciles de tocar. */}
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <button onClick={() => handleOpenEditItem(item)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-700 active:bg-slate-50">
                        <Edit3 className="h-4 w-4 text-teal-600" /> Editar
                      </button>
                      <button onClick={() => setDeleteTarget(item)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 text-[13px] font-bold text-rose-600 active:bg-rose-50">
                        <Trash2 className="h-4 w-4" /> Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <LoadMoreSentinel hasMore={mobileList.hasMore} onLoadMore={mobileList.loadMore} shown={mobileList.count} total={filteredExclusions.length} itemLabel="medicamentos" />
            </>
          )}
        </div>
      </div>

      {/* MODAL REGISTRO / EDICIÓN MANUAL */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-teal-100/80 text-teal-800">
                  <Ban className="h-5 w-5 text-teal-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingItem ? "Editar Medicamento Excluido" : "Nuevo Medicamento a Excluir"}
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold">
                    Establecimiento: {currentFacility.name} ({selectedFacilityCode})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsItemModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <Field label="Código SISMED" required hint="Ej: 00143">
                    <input
                      type="text"
                      required
                      value={formData.sismedCode}
                      onChange={e => setFormData({ ...formData, sismedCode: e.target.value })}
                      placeholder="00000"
                      className={inputClass + " font-mono font-bold uppercase"}
                      autoFocus
                    />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Presentación / Forma" hint="Ej: TABLETA, AMPOLLA">
                    <input
                      type="text"
                      value={formData.presentation}
                      onChange={e => setFormData({ ...formData, presentation: e.target.value })}
                      placeholder="TABLETA / FRASCO..."
                      className={inputClass + " uppercase"}
                    />
                  </Field>
                </div>
              </div>

              <Field label="Descripción del Medicamento" required hint="Nombre genérico + concentración">
                <input
                  type="text"
                  required
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="PARACETAMOL 500 MG..."
                  className={inputClass + " uppercase font-bold"}
                />
              </Field>

              <Field label="Motivo de Exclusión (Opcional)" hint="Justificación técnica o administrativa">
                <textarea
                  rows={3}
                  value={formData.reason}
                  onChange={e => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Ej: Manejado por programa presupuestal / No corresponde a cartera de servicios..."
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-800 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100 placeholder:text-slate-400"
                />
              </Field>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsItemModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-xs font-semibold text-white shadow-sm disabled:opacity-50 transition-colors"
                >
                  {isSaving ? "Guardando..." : editingItem ? "Actualizar Medicamento" : "Guardar Medicamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CARGA MASIVA EXCEL */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-teal-100/80 text-teal-800">
                  <UploadCloud className="h-5 w-5 text-teal-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Carga Masiva de Medicamentos Excluidos (.xlsx)
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold">
                    Establecimiento: {currentFacility.name} ({selectedFacilityCode})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-teal-500 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/50 hover:bg-teal-50/20 transition-all"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <FileSpreadsheet className="h-10 w-10 text-teal-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-800">
                  {uploadedFile ? uploadedFile.name : "Seleccione o arrastre su archivo Excel"}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Formatos soportados: .xlsx, .xls con columnas (CODIGO_MED, DESCRIPCION, PRESENTACION, MOTIVO)
                </p>
              </div>

              {/* Botón de plantilla rápida */}
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs">
                <span className="text-slate-600 font-semibold">¿Aún no tiene el formato adecuado?</span>
                <button
                  type="button"
                  onClick={() => requirementExclusionService.downloadTemplate()}
                  className="text-teal-700 hover:text-teal-800 font-bold flex items-center gap-1 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar Plantilla Oficial
                </button>
              </div>

              {/* Vista Previa */}
              {parsedPreview && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Resumen de Validación
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                      {parsedPreview.validCount} medicamentos listos
                    </span>
                  </div>

                  {parsedPreview.errors.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                      <div className="font-bold flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        {parsedPreview.invalidCount} fila(s) omitida(s) por datos incompletos:
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-700">
                        {parsedPreview.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tabla preview */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 sticky top-0 font-bold text-slate-700 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Código</th>
                          <th className="px-3 py-2">Descripción</th>
                          <th className="px-3 py-2">Presentación</th>
                          <th className="px-3 py-2">Motivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedPreview.items.slice(0, 20).map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono font-bold text-slate-800">{it.sismedCode}</td>
                            <td className="px-3 py-1.5 text-slate-900 font-semibold truncate max-w-xs">{it.description}</td>
                            <td className="px-3 py-1.5 text-slate-600">{it.presentation || "-"}</td>
                            <td className="px-3 py-1.5 text-slate-500 italic text-[11px]">{it.reason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedPreview.items.length > 20 && (
                    <p className="text-[11px] text-slate-400 text-center italic">
                      Mostrando las primeras 20 de {parsedPreview.items.length} filas detectadas.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!parsedPreview || parsedPreview.validCount === 0 || isSaving}
                onClick={handleConfirmExcelImport}
                className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-xs font-semibold text-white shadow-sm disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {isSaving ? "Guardando en base de datos..." : `Importar ${parsedPreview?.validCount || 0} Medicamentos`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIÁLOGOS DE CONFIRMACIÓN */}
      <ConfirmationDialog
        isOpen={!!deleteTarget}
        title="¿Eliminar medicamento de la lista?"
        description={`Se quitará "${deleteTarget?.description}" (${deleteTarget?.sismedCode}) de la lista de exclusiones de ${currentFacility.name}. Este medicamento volverá a ser evaluado en el Análisis de Requerimiento.`}
        confirmLabel="Eliminar de la lista"
        tone="danger"
        isConfirming={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmationDialog
        isOpen={isClearAllDialogOpen}
        title="¿Vaciar toda la lista de exclusión?"
        description={`Esta acción eliminará los ${exclusions.length} medicamentos configurados para ${currentFacility.name}. Todos los medicamentos volverán a ser analizados en el requerimiento mensual.`}
        confirmLabel="Sí, vaciar lista"
        tone="danger"
        isConfirming={isDeleting}
        onConfirm={handleConfirmClearAll}
        onCancel={() => setIsClearAllDialogOpen(false)}
      />
    </div>
  );
};
