import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Plus, Trash2, Shield, FileSpreadsheet, Check, Edit2, Save, X, ChevronDown, AlertTriangle, Link2, Link2Off } from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { listUngetSheets, type UngetSheet } from "../services/ungetSheetCatalog";
import { findConnectionForAssignment } from "../services/assignedSheetReader";
import { isLinkedToSheet, resolveFacilitySheet } from "../services/facilitySheetLink";

const SearchableSelect = ({ label, value, onChange, options, disabled, loading, placeholder }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter((o: any) => o.label.toLowerCase().includes(searchQuery.toLowerCase()));
  const selectedOption = options.find((o: any) => o.value === value);

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div 
        className={`w-full min-h-10 px-3 py-2 border border-gray-300 rounded-md bg-white flex justify-between items-center cursor-pointer ${disabled ? 'bg-gray-100 opacity-50 cursor-not-allowed' : 'hover:border-blue-400'}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className="truncate flex-1 text-sm">{loading ? 'Cargando...' : selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 ml-2 flex-shrink-0" />
      </div>
      
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg flex flex-col" style={{ maxHeight: '300px' }}>
          <div className="p-2 border-b border-gray-100 shrink-0">
             <div className="relative">
                 <Search className="w-4 h-4 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                 <input
                   type="text"
                   autoFocus
                   placeholder="Buscar..."
                   className="w-full pl-8 pr-2 py-1.5 text-sm border-b border-transparent focus:border-blue-500 focus:outline-none bg-gray-50 rounded"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   onClick={(e) => e.stopPropagation()}
                 />
             </div>
          </div>
          <div className="overflow-auto flex-1 p-1">
            {filteredOptions.length === 0 ? (
               <div className="p-3 text-sm text-gray-500 text-center">No se encontraron resultados</div>
            ) : (
               filteredOptions.map((opt: any) => (
                 <div
                   key={opt.value}
                   className={`px-3 py-2 text-sm rounded cursor-pointer hover:bg-blue-50 ${opt.value === value ? 'bg-blue-100 font-medium text-blue-700' : 'text-gray-700'}`}
                   onClick={() => {
                     onChange(opt.value);
                     setIsOpen(false);
                     setSearchQuery("");
                   }}
                 >
                   {opt.label}
                 </div>
               ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Definición de las columnas que vienen del Google Sheet (SIGData)
const AVAILABLE_COLUMNS = [
  { key: "ALMCOD", label: "Código Almacén", defaultState: false },
  { key: "DESC_ALM", label: "Almacén", defaultState: true },
  { key: "Id_Producto", label: "Código SISMED", defaultState: true },
  { key: "CODIGO_SIG", label: "Código SIGA", defaultState: true },
  { key: "Nombre", label: "Descripción / Nombre", defaultState: true },
  { key: "Lote", label: "Lote", defaultState: true },
  { key: "Fec_Vencim", label: "Fec. Vencimiento", defaultState: true },
  { key: "Reg_Sanitario", label: "Reg. Sanitario", defaultState: true },
  { key: "DESC_TIPSUM", label: "Tipo de Suministro", defaultState: true },
  { key: "DESC_FFINAN", label: "Fuente Financiamiento", defaultState: true },
  { key: "Saldo", label: "Stock / Saldo", defaultState: true },
  { key: "Precio_Det", label: "Precio Detalle", defaultState: false },
  { key: "Precio_Cab", label: "Precio Paquete", defaultState: false },
];

const normalizeName = (name: string): string => {
  if (!name) return "";
  let n = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(UNGET|UNGETS|OGESS|DIRESA|IPRESS)\b/g, "");
    
  n = n.replace(/\bMARICAL\b/g, "MARISCAL");
  n = n.replace(/\bMARISCAL\s+C\.?/g, "MARISCAL CACERES");

  return n.replace(/[^A-Z0-9]/g, "").trim();
};

const alignConfigsWithOfficialUngets = (configs: any[], ungs: any[]): any[] => {
  if (!ungs || ungs.length === 0) return configs;
  return configs.map(config => {
    const configNorm = normalizeName(config.name);
    const matching = ungs.find(u => 
      (config.ungetId && String(u.id) === String(config.ungetId)) ||
      u.name === config.name || 
      normalizeName(u.name) === configNorm
    );
    if (matching) {
      return {
        ...config,
        ungetId: matching.id,
        name: matching.name
      };
    }
    return config;
  });
};

export const AdminStockAssignmentModule: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [facilities, setFacilities] = useState<any[]>([]);
  const [ungetConfigs, setUngetConfigs] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Solución de ámbitos organizacionales para segmentar la visualización
  const userDiresaId = currentUser?.personnelData?.diresaId || currentUser?.facilityData?.diresaId || (currentUser as any)?.diresaId;
  const userOgessId = currentUser?.personnelData?.ogessId || currentUser?.facilityData?.ogessId || (currentUser as any)?.ogessId;
  const userUngetId = currentUser?.personnelData?.ungetId || currentUser?.facilityData?.ungetId || (currentUser as any)?.ungetId;
  const userMicroredId = currentUser?.personnelData?.microredId || currentUser?.facilityData?.microredId || (currentUser as any)?.microredId;
  const userFacilityCode = currentUser?.personnelData?.facilityCode || currentUser?.facilityData?.code || (currentUser as any)?.facilityCode;

  const getJurisdictionLevel = (): string => {
    if (!currentUser) return '';
    const userRole = currentUser.role;
    const config = roles.find(r => r.role === userRole);
    if (config?.jurisdictionLevel) {
      return config.jurisdictionLevel;
    }
    const r = (userRole || '').toUpperCase();
    if (r === 'ADMIN' || r === 'GLOBAL' || r.includes('SUPER') || r.includes('GENERAL') || r === 'ADMINISTRADOR') return 'GLOBAL';
    if (r.includes('DIRESA')) return 'DIRESA';
    if (r.includes('OGESS')) return 'OGESS';
    if (r.includes('UNGET')) return 'UNGET';
    if (r.includes('MICRORED')) return 'MICRORED';
    if (r.includes('FARMACIA') || r.includes('IPRESS') || r.includes('PERSONAL')) return 'IPRESS';
    return '';
  };

  const getFilteredAssignments = () => {
    const level = getJurisdictionLevel();
    return assignments.filter(assig => {
      const f = facilities.find(fac => fac.code === assig.facilityCode);
      if (!f) return false;

      if (level === 'GLOBAL') return true;
      if (level === 'MICRORED' && userMicroredId) return f.microredId === userMicroredId;
      if (level === 'UNGET' && userUngetId) return f.ungetId === userUngetId;
      if (level === 'OGESS' && userOgessId) return f.ogessId === userOgessId;
      if (level === 'DIRESA' && userDiresaId) return f.diresaId === userDiresaId;
      if (level === 'IPRESS' && userFacilityCode) return f.code === userFacilityCode;

      // Fallback
      if (userMicroredId) return f.microredId === userMicroredId;
      if (userUngetId) return f.ungetId === userUngetId;
      if (userOgessId) return f.ogessId === userOgessId;
      if (userDiresaId) return f.diresaId === userDiresaId;
      if (userFacilityCode) return f.code === userFacilityCode;

      return false;
    });
  };

  const activeAssignments = getFilteredAssignments();

  // Form State
  const [selectedFacilityCode, setSelectedFacilityCode] = useState("");
  const [selectedConnectionUrl, setSelectedConnectionUrl] = useState(""); // This is the Google App Script URL
  const [availableSheets, setAvailableSheets] = useState<UngetSheet[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignmentsSearch, setAssignmentsSearch] = useState("");
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** Conexión elegida: de ella sale la UNGET que acota los establecimientos ofrecidos. */
  const conexionSeleccionada = ungetConfigs.find((c: any) => c.url === selectedConnectionUrl);

  /**
   * La hoja ya no se elige: se deduce del código del establecimiento. Ver
   * `services/facilitySheetLink.ts`. Esta pantalla solo decide las columnas visibles.
   */
  const vinculo = useMemo(
    () => (selectedFacilityCode ? resolveFacilitySheet(selectedFacilityCode, availableSheets) : null),
    [selectedFacilityCode, availableSheets],
  );

  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    AVAILABLE_COLUMNS.filter(c => c.defaultState).map(c => c.key)
  );

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const loadData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      if (currentUser?.username) {
        const [allFacilities, officialUngets] = await Promise.all([
          api.getFacilities(),
          api.getUngets()
        ]);
        setFacilities(allFacilities);

        let configs = [];
        const role = currentUser.role;
        let level = '';
        const r = (role || '').toUpperCase();
        if (r === 'ADMIN' || r === 'GLOBAL' || r.includes('SUPER') || r.includes('GENERAL') || r === 'ADMINISTRADOR') level = 'GLOBAL';
        else if (r.includes('DIRESA')) level = 'DIRESA';
        else if (r.includes('OGESS')) level = 'OGESS';
        else if (r.includes('UNGET')) level = 'UNGET';
        else if (r.includes('MICRORED')) level = 'MICRORED';
        else if (r.includes('FARMACIA') || r.includes('IPRESS') || r.includes('PERSONAL')) level = 'IPRESS';

        const userDiresaId = currentUser.personnelData?.diresaId || currentUser.facilityData?.diresaId || (currentUser as any).diresaId;
        const userOgessId = currentUser.personnelData?.ogessId || currentUser.facilityData?.ogessId || (currentUser as any).ogessId;

        if (level === 'GLOBAL' || level === 'DIRESA' || level === 'OGESS' || level === 'UNGET' || level === 'MICRORED') {
          try {
            const [allConfigs, allUsers] = await Promise.all([
              api.getAllUngetConfigs(),
              api.getUsers()
            ]);
            
            configs = allConfigs.filter(config => {
              if (config.username === currentUser.username) return true;
              if (level === 'GLOBAL') return true;
              
              const creator = allUsers.find(u => u.username === config.username);
              if (!creator) return false;
              
              const creatorDiresaId = creator.personnelData?.diresaId || creator.facilityData?.diresaId || (creator as any).diresaId;
              const creatorOgessId = creator.personnelData?.ogessId || creator.facilityData?.ogessId || (creator as any).ogessId;
              const creatorUngetId = creator.personnelData?.ungetId || creator.facilityData?.ungetId || (creator as any).ungetId;
              const creatorMicroredId = creator.personnelData?.microredId || creator.facilityData?.microredId || (creator as any).microredId;
              
              if (level === 'DIRESA' && userDiresaId) return creatorDiresaId === userDiresaId;
              if (level === 'OGESS' && userOgessId) return creatorOgessId === userOgessId;
              if (level === 'UNGET' && userUngetId) return creatorUngetId === userUngetId;
              if (level === 'MICRORED' && userMicroredId) return creatorMicroredId === userMicroredId;
              return false;
            });
          } catch (err) {
            configs = await api.getUngetConfigs(currentUser.username);
          }
        } else {
          configs = await api.getUngetConfigs(currentUser.username);
        }

        // Align and unique by official UNGET names to prevent duplicates
        const aligned = alignConfigsWithOfficialUngets(configs, officialUngets);
        const uniqueConfigs: any[] = [];
        const seenNames = new Set<string>();
        for (const c of aligned) {
          const uName = c.name.toUpperCase();
          if (!seenNames.has(uName)) {
            seenNames.add(uName);
            uniqueConfigs.push(c);
          }
        }
        setUngetConfigs(uniqueConfigs);

        const pastAssignments = await api.getAllStockAssignments();
        setAssignments(pastAssignments);

        try {
          const allRoles = await api.getRolesConfig();
          setRoles(allRoles);
        } catch (roleError) {
          console.warn("Could not load roles configs, falling back to key checking", roleError);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar datos");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectionChange = async (url: string) => {
    setSelectedConnectionUrl(url);
    setAvailableSheets([]);
    if (!url) return;

    setLoadingSheets(true);
    toast.info("Leyendo hojas de la conexión...", { duration: 2000 });
    try {
      const sheets = await listUngetSheets(ungetConfigs.find((c: any) => c.url === url));
      setAvailableSheets(sheets);
      toast.success(`Se encontraron ${sheets.length} hojas (establecimientos).`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "No se pudieron leer las hojas de esta conexión.");
    } finally {
      setLoadingSheets(false);
    }
  };

  const handleToggleColumn = (key: string) => {
    setVisibleColumns(prev => 
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    );
  };

  const resetForm = () => {
    setSelectedFacilityCode("");
    setSelectedConnectionUrl("");
    setAvailableSheets([]);
    setEditingId(null);
    setVisibleColumns(AVAILABLE_COLUMNS.filter(c => c.defaultState).map(c => c.key));
  };

  const handleEditAssignment = (assig: any) => {
    setEditingId(assig.id);
    setSelectedFacilityCode(assig.facilityCode);
    setVisibleColumns(assig.visibleColumns || []);

    // La conexión vigente de la UNGET, no la URL que quedó guardada en la asignación: esa
    // cambia cuando la UNGET vuelve a desplegar su Web App o pasa a leer su hoja directa,
    // y entonces la edición leía de una dirección que ya no sirve.
    const conexion = findConnectionForAssignment(assig, ungetConfigs);
    setSelectedConnectionUrl(conexion?.url || assig.sheetUrl);

    setLoadingSheets(true);
    listUngetSheets(conexion || { url: assig.sheetUrl })
      .then(setAvailableSheets)
      .catch((err: any) => {
        console.error(err);
        toast.error(err?.message || "No se pudieron leer las hojas de esta conexión.");
      })
      .finally(() => setLoadingSheets(false));
  };

  const handleSave = async () => {
    if (!selectedFacilityCode) return toast.error("Seleccione un establecimiento");
    if (!selectedConnectionUrl) return toast.error("Seleccione una conexión");
    if (visibleColumns.length === 0) return toast.error("Seleccione al menos una columna visible");

    const conexion = ungetConfigs.find((c: any) => c.url === selectedConnectionUrl);

    // La comprobación que de verdad protege: el desplegable ya filtra, pero el estado puede
    // quedar desparejado si se elige el establecimiento antes que la conexión.
    const ungetDeLaConexion = String(conexion?.ungetId || "").trim();
    const establecimiento = facilities.find((f: any) => f.code === selectedFacilityCode);
    if (ungetDeLaConexion && establecimiento && String(establecimiento.ungetId || "") !== ungetDeLaConexion) {
      return toast.error(
        `"${establecimiento.name}" no pertenece a la UNGET de esta conexión. Elija la conexión de su propia UNGET, o corrija el establecimiento en Administración → Establecimientos.`,
      );
    }

    setIsSaving(true);
    try {
      const result = await api.saveStockColumnPreferences({
        adminUsername: currentUser?.username || "",
        facilityCode: selectedFacilityCode,
        // Informativos: el vínculo real se deduce del código en cada lectura.
        sheetName: vinculo?.sheet?.name || "",
        sheetUrl: selectedConnectionUrl,
        // La asignación pertenece a la UNGET: su URL puede cambiar y no debe romperla.
        ungetId: conexion?.ungetId || undefined,
        visibleColumns,
      });

      if (result.success) {
        toast.success("Columnas visibles guardadas");
        resetForm();
        await loadData(true);
      } else {
        toast.error(result.message || "Error al guardar");
      }
    } catch(e) {
      toast.error("Error interno");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    try {
      const result = await api.deleteStockAssignment(itemToDelete);
      if (result.success) {
        toast.success("Asignación eliminada");
        await loadData(true);
      } else {
        toast.error(result.message || "Error al eliminar");
      }
    } catch(e) {
      toast.error("Error interno");
    } finally {
      setItemToDelete(null);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Cargando módulo...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Columnas visibles del stock por establecimiento</h2>
            <p className="text-sm text-gray-500">La hoja de cada establecimiento se reconoce sola por su código. Aquí se decide qué columnas podrá consultar en “Stock SISMED”.</p>
          </div>
        </div>

        {ungetConfigs.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg flex items-start gap-3">
            <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No tiene configuraciones de stock disponibles</p>
              <p className="text-sm mt-1">Primero debe ir al módulo "Consulta Stock" y guardar URLs de conexiones. Estas URLs luego aparecerán aquí para poder asignarlas a otros usuarios.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 mt-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SearchableSelect
                  label="1. UNGET / Conexión"
                  value={selectedConnectionUrl}
                  onChange={handleConnectionChange}
                  placeholder="-- Seleccionar Conexión --"
                  options={ungetConfigs.map(c => ({ value: c.url, label: c.name }))}
                />

                <SearchableSelect
                  label="2. Establecimiento de Salud"
                  value={selectedFacilityCode}
                  onChange={setSelectedFacilityCode}
                  placeholder="-- Seleccionar --"
                  disabled={!selectedConnectionUrl}
                  loading={loadingSheets}
                  options={(() => {
                    const level = getJurisdictionLevel();
                    // La conexión elegida manda: solo se ofrecen los establecimientos de esa
                    // UNGET. Antes el desplegable se filtraba únicamente por la jurisdicción
                    // de quien asigna, así que un administrador podía colgar una IPRESS de
                    // Tocache de una hoja de Bellavista, y ese usuario acababa viendo el
                    // stock de otro establecimiento.
                    const ungetDeLaConexion = String(conexionSeleccionada?.ungetId || "").trim();
                    return facilities
                      .filter(f => {
                        if (ungetDeLaConexion && String(f.ungetId || "") !== ungetDeLaConexion) return false;

                        // Filtrar por ámbito/nivel de jurisdicción del usuario
                        if (level === 'GLOBAL') return true;
                        if (level === 'MICRORED' && userMicroredId) return f.microredId === userMicroredId;
                        if (level === 'UNGET' && userUngetId) return f.ungetId === userUngetId;
                        if (level === 'OGESS' && userOgessId) return f.ogessId === userOgessId;
                        if (level === 'DIRESA' && userDiresaId) return f.diresaId === userDiresaId;
                        if (level === 'IPRESS' && userFacilityCode) return f.code === userFacilityCode;

                        // Fallback por jerarquías asignadas
                        if (userMicroredId) return f.microredId === userMicroredId;
                        if (userUngetId) return f.ungetId === userUngetId;
                        if (userOgessId) return f.ogessId === userOgessId;
                        if (userDiresaId) return f.diresaId === userDiresaId;
                        if (userFacilityCode) return f.code === userFacilityCode;

                        return false;
                      })
                      .map(f => ({ value: f.code, label: `${f.name} (${f.code})` }));
                  })()}
                />
              </div>

              {/* La hoja no se elige: se deduce del código del establecimiento. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">3. Hoja vinculada (automática)</label>
                {!selectedFacilityCode ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    Elija una conexión y un establecimiento: su hoja se reconoce sola por el código.
                  </div>
                ) : loadingSheets ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500 animate-pulse">
                    Leyendo las hojas de la conexión...
                  </div>
                ) : (
                  <div
                    className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2.5 ${
                      isLinkedToSheet(vinculo)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {isLinkedToSheet(vinculo)
                      ? <Link2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      : <Link2Off className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    <div>
                      {vinculo?.sheet && (
                        <p className="font-semibold flex items-center gap-1.5">
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          {vinculo.sheet.name}
                        </p>
                      )}
                      <p className={vinculo?.sheet ? "text-xs mt-0.5" : ""}>{vinculo?.message}</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">4. Columnas visibles para el establecimiento</label>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {AVAILABLE_COLUMNS.map(col => (
                    <div 
                      key={col.key} 
                      onClick={() => handleToggleColumn(col.key)}
                      className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded border border-gray-200 hover:bg-gray-100 transition-colors select-none"
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center border ${visibleColumns.includes(col.key) ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                        {visibleColumns.includes(col.key) && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <span className="text-sm font-medium text-gray-700">{col.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !selectedFacilityCode || !selectedConnectionUrl || visibleColumns.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors cursor-pointer"
                >
                  {isSaving ? (
                     <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : (
                     editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />
                  )}
                  {isSaving ? "Guardando..." : (editingId ? "Guardar Cambios" : "Guardar Columnas")}
                </button>
                {editingId && (
                  <button
                    onClick={resetForm}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 font-medium transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    Cancelar
                  </button>
                )}
              </div>
            </div>

            {/* Asignaciones Activas */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 h-full flex flex-col">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3 shrink-0">
                <Shield className="w-4 h-4 text-blue-600" />
                Establecimientos configurados ({activeAssignments.length})
              </h3>
              
              <div className="relative mb-3 shrink-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar asignación..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={assignmentsSearch}
                  onChange={(e) => setAssignmentsSearch(e.target.value)}
                />
              </div>

              <div className="space-y-3 overflow-y-auto max-h-[320px] pr-2 flex-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                {activeAssignments.filter(assig => {
                   const facilityName = facilities.find(f => f.code === assig.facilityCode)?.name || "";
                   const fullSearchText = `${assig.facilityCode} ${facilityName} ${assig.sheetName}`.toLowerCase();
                   return fullSearchText.includes(assignmentsSearch.toLowerCase());
                }).length === 0 ? (
                  <p className="text-sm text-gray-500 italic text-center py-4">
                    {assignmentsSearch ? "No hay coincidencias" : "No hay asignaciones creadas"}
                  </p>
                ) : (
                  activeAssignments.filter(assig => {
                   const facilityName = facilities.find(f => f.code === assig.facilityCode)?.name || "";
                   const fullSearchText = `${assig.facilityCode} ${facilityName} ${assig.sheetName}`.toLowerCase();
                   return fullSearchText.includes(assignmentsSearch.toLowerCase());
                  }).map(assig => {
                    const facilityName = facilities.find(f => f.code === assig.facilityCode)?.name || assig.facilityCode;
                    const isEditing = editingId === assig.id;
                    return (
                      <div key={assig.id} className={`bg-white p-3 rounded-lg border shadow-sm relative group ${isEditing ? 'border-blue-400 ring-1 ring-blue-400' : 'border-gray-200'}`}>
                        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <button 
                            onClick={() => handleEditAssignment(assig)}
                            className="p-1 hover:bg-blue-50 text-blue-500 rounded cursor-pointer"
                            title="Editar asignación"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setItemToDelete(assig.id)}
                            className="p-1 hover:bg-red-50 text-red-500 rounded cursor-pointer"
                            title="Eliminar asignación"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <p className="text-sm font-bold text-gray-900 mb-0.5">{facilityName}</p>
                        <p className="text-xs text-gray-500 mb-2 truncate pr-14 flex items-center gap-1">
                          <FileSpreadsheet className="w-3 h-3 flex-shrink-0" />
                          <span className="font-mono">{assig.facilityCode}</span>
                          {assig.sheetName && <span className="truncate">· {assig.sheetName}</span>}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {assig.visibleColumns.slice(0, 3).map((col: string) => {
                             const c = AVAILABLE_COLUMNS.find(ac => ac.key === col);
                             return c ? <span key={col} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{c.label}</span> : null;
                          })}
                          {assig.visibleColumns.length > 3 && (
                             <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">+{assig.visibleColumns.length - 3}</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {itemToDelete && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 mx-auto">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 text-center mb-2">¿Eliminar la configuración de columnas?</h3>
              <p className="text-sm text-gray-500 text-center mb-6">El establecimiento seguirá viendo su hoja, porque el vínculo se deduce de su código, pero volverá a las columnas por omisión.</p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setItemToDelete(null)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors cursor-pointer"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
