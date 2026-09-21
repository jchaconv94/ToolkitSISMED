import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Plus, Shield, FileSpreadsheet, Check, Save, ChevronDown, RotateCcw, Link2, Link2Off } from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { listUngetSheets, type UngetSheet } from "../services/ungetSheetCatalog";
import { isLinkedToSheet, resolveFacilitySheet } from "../services/facilitySheetLink";
import {
  DEFAULT_STOCK_COLUMN_KEYS,
  hasCustomStockColumns,
  isDefaultStockColumnSet,
  STOCK_COLUMNS,
} from "../services/stockColumns";

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

/** Marca que lleva en el desplegable un establecimiento con columnas propias elegidas. */
const MARCA_COLUMNAS_PROPIAS = " — columnas propias";

const normalizeName = (name: string): string => {
  if (!name) return "";
  let n = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

  // Form State
  const [selectedFacilityCode, setSelectedFacilityCode] = useState("");
  const [selectedConnectionUrl, setSelectedConnectionUrl] = useState(""); // This is the Google App Script URL
  const [availableSheets, setAvailableSheets] = useState<UngetSheet[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_STOCK_COLUMN_KEYS);

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

  /**
   * Establecimientos que eligieron columnas distintas de las de omisión.
   *
   * Sustituye al panel «Establecimientos configurados», que en el modelo anterior listaba
   * asignaciones de hoja. Hoy no hay nada que asignar —la hoja se deduce del código— y lo
   * único que distingue a un establecimiento de otro son sus columnas, así que la marca
   * vive donde de verdad se usa: en el desplegable donde ya se busca.
   */
  const conColumnasPropias = useMemo(() => {
    const codigos = new Set<string>();
    for (const fila of assignments) {
      if (fila?.facilityCode && hasCustomStockColumns(fila.visibleColumns)) {
        codigos.add(String(fila.facilityCode));
      }
    }
    return codigos;
  }, [assignments]);

  const filaDelEstablecimiento = useMemo(
    () => assignments.find(a => a.facilityCode === selectedFacilityCode) || null,
    [assignments, selectedFacilityCode],
  );

  /**
   * Al elegir un establecimiento se cargan las columnas que ya tuviera guardadas.
   *
   * Antes esto solo pasaba al pulsar el lápiz del panel lateral, así que elegirlo desde el
   * desplegable y guardar sobrescribía en silencio lo que ese establecimiento tenía.
   */
  useEffect(() => {
    if (!selectedFacilityCode) return;
    setVisibleColumns(
      filaDelEstablecimiento?.visibleColumns?.length
        ? filaDelEstablecimiento.visibleColumns
        : DEFAULT_STOCK_COLUMN_KEYS,
    );
  }, [selectedFacilityCode, filaDelEstablecimiento]);

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const loadData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      if (currentUser?.username) {
        // Nada de esto depende de lo demás, así que va junto: antes las asignaciones y los
        // roles se esperaban en serie, después del bloque de conexiones.
        const [allFacilities, officialUngets, pastAssignments, allRoles] = await Promise.all([
          api.getFacilities(),
          api.getUngets(),
          api.getAllStockAssignments(),
          api.getRolesConfig().catch(roleError => {
            console.warn("Could not load roles configs, falling back to key checking", roleError);
            return [] as any[];
          }),
        ]);
        setFacilities(allFacilities);
        setAssignments(pastAssignments);
        setRoles(allRoles);

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
    // El establecimiento elegido pertenecía a la UNGET anterior: dejarlo puesto
    // mostraría un vínculo que no es el suyo.
    setSelectedFacilityCode("");
    setVisibleColumns(DEFAULT_STOCK_COLUMN_KEYS);
    if (!url) return;

    setLoadingSheets(true);
    try {
      // Sin conteo de filas: aquí solo hace falta el nombre y el código de cada pestaña,
      // y contar obliga a descargar la columna A entera de todas ellas.
      const sheets = await listUngetSheets(
        ungetConfigs.find((c: any) => c.url === url),
        { withRowCounts: false },
      );
      setAvailableSheets(sheets);
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

  /**
   * Guarda las columnas del establecimiento elegido.
   *
   * No se borra la fila para volver a las columnas de omisión: se guardan las de omisión.
   * Borrarla se llevaría por delante el `sheetName`/`facilityCode` con el que Consulta
   * Stock pone el nombre oficial en la tarjeta de esa pestaña, y para el establecimiento
   * el resultado sería exactamente el mismo.
   */
  const guardarColumnas = async (columnas: string[]) => {
    if (!selectedFacilityCode) return toast.error("Seleccione un establecimiento");
    if (!selectedConnectionUrl) return toast.error("Seleccione una conexión");
    if (columnas.length === 0) return toast.error("Seleccione al menos una columna visible");

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
        // Referencia de la última hoja reconocida. Si el vínculo no se pudo deducir se
        // manda vacío y la API conserva el que ya hubiera; no lo borra.
        sheetName: vinculo?.sheet?.name || "",
        sheetUrl: selectedConnectionUrl,
        // La asignación pertenece a la UNGET: su URL puede cambiar y no debe romperla.
        ungetId: conexion?.ungetId || undefined,
        visibleColumns: columnas,
      });

      if (result.success) {
        setVisibleColumns(columnas);
        toast.success(
          isDefaultStockColumnSet(columnas)
            ? "Restablecidas las columnas por omisión"
            : "Columnas visibles guardadas",
        );
        // Se conserva el establecimiento elegido: así se ve enseguida cómo queda su marca.
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

  const opcionesDeEstablecimiento = useMemo(() => {
    const level = getJurisdictionLevel();
    // La conexión elegida manda: solo se ofrecen los establecimientos de esa UNGET. Antes
    // el desplegable se filtraba únicamente por la jurisdicción de quien asigna, así que un
    // administrador podía colgar una IPRESS de Tocache de una hoja de Bellavista, y ese
    // usuario acababa viendo el stock de otro establecimiento.
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
      .map(f => ({
        value: f.code,
        // La marca va en la etiqueta a propósito: el buscador del desplegable filtra por
        // ella, así que escribir «propias» los deja a todos a la vista.
        label: `${f.name} (${f.code})${conColumnasPropias.has(f.code) ? MARCA_COLUMNAS_PROPIAS : ""}`,
      }));
  }, [facilities, conexionSeleccionada, conColumnasPropias, roles, currentUser]);

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
          <div className="space-y-4 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SearchableSelect
                label="1. UNGET / Conexión"
                value={selectedConnectionUrl}
                onChange={handleConnectionChange}
                placeholder="-- Seleccionar Conexión --"
                options={ungetConfigs.map(c => ({ value: c.url, label: c.name }))}
              />

              {/* Sin `loading`: los establecimientos ya están en memoria desde que se abrió
                  el módulo. Lo que tarda es leer las hojas, y eso lo informa el paso 3. */}
              <SearchableSelect
                label="2. Establecimiento de Salud"
                value={selectedFacilityCode}
                onChange={setSelectedFacilityCode}
                placeholder="-- Seleccionar --"
                disabled={!selectedConnectionUrl}
                options={opcionesDeEstablecimiento}
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
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <label className="block text-sm font-medium text-gray-700">4. Columnas visibles para el establecimiento</label>
                {selectedFacilityCode && (
                  <span className="text-xs text-gray-500">
                    {hasCustomStockColumns(filaDelEstablecimiento?.visibleColumns)
                      ? "Este establecimiento tiene columnas propias elegidas."
                      : "Este establecimiento usa las columnas por omisión."}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {STOCK_COLUMNS.map(col => (
                  <div 
                    key={col.key} 
                    onClick={() => handleToggleColumn(col.key)}
                    className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded border border-gray-200 hover:bg-gray-100 transition-colors select-none"
                  >
                    <div className={`w-5 h-5 shrink-0 rounded flex items-center justify-center border ${visibleColumns.includes(col.key) ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                      {visibleColumns.includes(col.key) && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <span className="text-sm font-medium text-gray-700">{col.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={() => guardarColumnas(visibleColumns)}
                disabled={isSaving || !selectedFacilityCode || !selectedConnectionUrl || visibleColumns.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors cursor-pointer"
              >
                {isSaving ? (
                   <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                   filaDelEstablecimiento ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />
                )}
                {isSaving ? "Guardando..." : "Guardar Columnas"}
              </button>

              {hasCustomStockColumns(filaDelEstablecimiento?.visibleColumns) && (
                <button
                  onClick={() => guardarColumnas(DEFAULT_STOCK_COLUMN_KEYS)}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 font-medium transition-colors cursor-pointer"
                  title="Deja este establecimiento con las mismas columnas que ve cualquier otro"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restablecer por omisión
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
