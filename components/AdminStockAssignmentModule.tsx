import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Check,
  ChevronDown,
  FileSpreadsheet,
  Link2,
  Link2Off,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Table2,
} from "lucide-react";
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
  STOCK_COLUMN_GROUPS,
} from "../services/stockColumns";

interface OpcionDeSelector {
  value: string;
  label: string;
  /** Distintivo al margen del nombre. Se pinta como chip y solo dentro de la lista. */
  hint?: string;
}

const SearchableSelect = ({
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: OpcionDeSelector[];
  disabled?: boolean;
  placeholder: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const consulta = searchQuery.trim().toLocaleLowerCase("es");
  const filteredOptions = options.filter(o =>
    `${o.label} ${o.hint || ""}`.toLocaleLowerCase("es").includes(consulta),
  );
  const selectedOption = options.find(o => o.value === value);

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        className={`flex h-11 w-full items-center justify-between rounded-xl border px-3.5 text-sm transition-colors ${
          disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
            : `cursor-pointer bg-white ${isOpen ? "border-teal-500 ring-4 ring-teal-100" : "border-slate-200 hover:border-slate-300"}`
        }`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className={`truncate ${selectedOption ? "font-semibold text-slate-800" : "text-slate-400"}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" style={{ maxHeight: "320px" }}>
          <div className="shrink-0 border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                autoFocus
                placeholder="Buscar..."
                className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-2 text-sm outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-teal-100"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-400">No se encontraron resultados</div>
            ) : (
              filteredOptions.map(opt => (
                <div
                  key={opt.value}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    opt.value === value ? "bg-teal-50 font-semibold text-teal-800" : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchQuery("");
                  }}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="shrink-0 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                      {opt.hint}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Rótulo numerado de cada paso, para que el orden se lea de un vistazo. */
const Paso = ({ numero, titulo, children }: { numero: number; titulo: string; children?: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-900 text-[10px] font-black text-white">
        {numero}
      </span>
      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{titulo}</span>
    </div>
    {children}
  </div>
);

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
      return { ...config, ungetId: matching.id, name: matching.name };
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
   * vive donde de verdad se usa: en el desplegable donde ya se busca. Va como chip y solo
   * dentro de la lista: pegada al nombre ensuciaba el campo una vez elegido.
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

  const tieneColumnasPropias = hasCustomStockColumns(filaDelEstablecimiento?.visibleColumns);

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
    // El establecimiento elegido pertenecía a la UNGET anterior: dejarlo puesto mostraría
    // un vínculo que no es el suyo.
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

  const opcionesDeEstablecimiento = useMemo<OpcionDeSelector[]>(() => {
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
        label: `${f.name} (${f.code})`,
        hint: conColumnasPropias.has(f.code) ? "propias" : undefined,
      }));
  }, [facilities, conexionSeleccionada, conColumnasPropias, roles, currentUser]);

  if (isLoading) {
    return (
      <div className="flex justify-center rounded-2xl border border-slate-200 bg-white py-20 shadow-sm">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  const sinConexiones = ungetConfigs.length === 0;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-teal-50 p-3 text-teal-700"><SlidersHorizontal className="h-6 w-6" /></div>
            <div>
              <h2 className="text-xl font-black text-slate-900">Columnas visibles del stock</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                La hoja de cada establecimiento se reconoce sola por su código. Aquí solo se decide
                qué columnas podrá consultar en “Stock SISMED”.
              </p>
            </div>
          </div>
          {selectedFacilityCode && (
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5">
              <Table2 className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-black text-slate-900">{visibleColumns.length}</span>
              <span className="text-xs font-bold text-slate-500">de {STOCK_COLUMNS.length} columnas</span>
            </div>
          )}
        </div>
      </section>

      {sinConexiones ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <Sparkles className="mx-auto h-9 w-9 text-amber-600" />
          <h3 className="mt-3 font-black text-amber-950">No hay conexiones de stock disponibles</h3>
          <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-amber-800">
            Primero vaya a “Consulta Stock” y guarde la conexión de su UNGET. En cuanto exista,
            aparecerá aquí para poder elegir sus establecimientos.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Paso numero={1} titulo="UNGET / Conexión" />
                <SearchableSelect
                  value={selectedConnectionUrl}
                  onChange={handleConnectionChange}
                  placeholder="Seleccionar conexión..."
                  options={ungetConfigs.map(c => ({ value: c.url, label: c.name }))}
                />
              </div>

              <div className="space-y-2">
                <Paso numero={2} titulo="Establecimiento de salud" />
                {/* Sin indicador de carga: los establecimientos ya están en memoria desde
                    que se abrió el módulo. Lo que tarda es leer las hojas, y eso lo
                    informa el paso 3. */}
                <SearchableSelect
                  value={selectedFacilityCode}
                  onChange={setSelectedFacilityCode}
                  placeholder={selectedConnectionUrl ? "Seleccionar establecimiento..." : "Elija antes una conexión"}
                  disabled={!selectedConnectionUrl}
                  options={opcionesDeEstablecimiento}
                />
              </div>
            </div>

            {/* La hoja no se elige: se deduce del código del establecimiento. */}
            <div className="space-y-2">
              <Paso numero={3} titulo="Hoja vinculada">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Automática
                </span>
              </Paso>
              {!selectedFacilityCode ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3.5 text-sm text-slate-500">
                  Elija una conexión y un establecimiento: su hoja se reconoce sola por el código.
                </div>
              ) : loadingSheets ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-semibold text-slate-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                  Leyendo las hojas de la conexión...
                </div>
              ) : (
                <div
                  className={`flex items-start gap-2.5 rounded-xl border px-4 py-3.5 text-sm ${
                    isLinkedToSheet(vinculo)
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  {isLinkedToSheet(vinculo)
                    ? <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
                    : <Link2Off className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div className="min-w-0">
                    {vinculo?.sheet && (
                      <p className="flex items-center gap-1.5 font-black">
                        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{vinculo.sheet.name}</span>
                      </p>
                    )}
                    <p className={vinculo?.sheet ? "mt-0.5 text-xs leading-relaxed" : "leading-relaxed"}>{vinculo?.message}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Paso numero={4} titulo="Columnas que verá el establecimiento">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setVisibleColumns(STOCK_COLUMNS.map(c => c.key))}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    Todas
                  </button>
                  <span className="text-slate-200">|</span>
                  <button
                    type="button"
                    onClick={() => setVisibleColumns(DEFAULT_STOCK_COLUMN_KEYS)}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    Por omisión
                  </button>
                  <span className="text-slate-200">|</span>
                  <button
                    type="button"
                    onClick={() => setVisibleColumns([])}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    Ninguna
                  </button>
                </div>
              </Paso>

              {/* Dos columnas de familias, no de casillas: lo que alargaba el recuadro era que
                  cada familia ocupara una banda entera para dos o tres casillas. Con
                  `columns-2` el navegador reparte las familias y equilibra la altura solo;
                  `break-inside-avoid` impide que una familia se parta entre columnas. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 md:columns-2 md:gap-4">
                {STOCK_COLUMN_GROUPS.map(grupo => {
                  const columnas = STOCK_COLUMNS.filter(c => c.group === grupo);
                  if (columnas.length === 0) return null;
                  return (
                    <div key={grupo} className="mb-3.5 break-inside-avoid last:mb-0">
                      <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{grupo}</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {columnas.map(col => {
                          const marcada = visibleColumns.includes(col.key);
                          return (
                            <button
                              key={col.key}
                              type="button"
                              onClick={() => handleToggleColumn(col.key)}
                              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                                marcada
                                  ? "border-teal-500/60 bg-teal-50 shadow-sm"
                                  : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors ${
                                marcada ? "border-teal-600 bg-teal-600" : "border-slate-300 bg-white"
                              }`}>
                                {marcada && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                              </span>
                              <span className={`truncate text-[13px] font-bold ${marcada ? "text-teal-900" : "text-slate-600"}`}>
                                {col.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
            <p className={`text-xs ${visibleColumns.length === 0 ? "font-bold text-amber-600" : "text-slate-500"}`}>
              {visibleColumns.length === 0
                ? "Deje al menos una columna visible para poder guardar."
                : !selectedFacilityCode
                ? "Elija un establecimiento para guardar sus columnas."
                : tieneColumnasPropias
                  ? "Este establecimiento tiene columnas propias elegidas."
                  : "Este establecimiento usa las columnas por omisión."}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              {tieneColumnasPropias && (
                <button
                  type="button"
                  onClick={() => guardarColumnas(DEFAULT_STOCK_COLUMN_KEYS)}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  title="Deja este establecimiento con las mismas columnas que ve cualquier otro"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restablecer por omisión
                </button>
              )}
              <button
                type="button"
                onClick={() => guardarColumnas(visibleColumns)}
                disabled={isSaving || !selectedFacilityCode || !selectedConnectionUrl || visibleColumns.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSaving
                  ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <Save className="h-4 w-4" />}
                {isSaving ? "Guardando..." : "Guardar columnas"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
