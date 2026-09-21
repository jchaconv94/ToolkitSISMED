import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  Package,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import {
  findConnectionForAssignment,
  readAssignedSheetRows,
} from "../services/assignedSheetReader";
import {
  describePharmacyCode,
  isLinkedToSheet,
  resolveFacilitySheet,
  rowsBelongingToFacility,
  showsPharmacyColumn,
  type FacilitySheetLink,
} from "../services/facilitySheetLink";
import { PharmacyCodeCell } from "./ui/PharmacyCodeCell";
import { listUngetSheets } from "../services/ungetSheetCatalog";
import {
  DEFAULT_STOCK_COLUMN_KEYS,
  STOCK_COLUMNS,
} from "../services/stockColumns";
import { pickOneConnectionPerUnget } from "../services/ungetConnections";
import { StockAssignment } from "../types";

type StockSource = "SYNC" | "SHEET";
type ExpirationFilter = "ALL" | "EXPIRED" | "EXPIRING";
type StockRow = Record<string, unknown>;

const EXPIRATION_FILTER_OPTIONS: Array<{ value: ExpirationFilter; label: string }> = [
  { value: "ALL", label: "Todos los registros" },
  { value: "EXPIRING", label: "Por vencer este mes" },
  { value: "EXPIRED", label: "Productos vencidos" }
];

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const readValue = (row: StockRow, aliases: string[]) => {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) return row[alias];
  }
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    const matchingKey = keys.find(key => normalizeKey(key) === normalizedAlias);
    if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) return row[matchingKey];
  }
  return "";
};

const normalizeRow = (row: StockRow): StockRow => ({
  ...Object.fromEntries(STOCK_COLUMNS.map(column => [column.key, readValue(row, column.aliases)])),
  TIPSUM: readValue(row, ["TIPSUM", "tipsum"]),
  FFINAN: readValue(row, ["FFINAN", "ffinan"])
});

const parseNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/,/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
};

const formatStockDate = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const parts = raw.split(/[\/-]/).map(part => Number(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return raw;
  const [first, second, third] = parts;
  if (first > 1000) return `${String(third).padStart(2, "0")}/${String(second).padStart(2, "0")}/${first}`;
  return `${String(first).padStart(2, "0")}/${String(second).padStart(2, "0")}/${third < 100 ? third + 2000 : third}`;
};

const getExpirationState = (row: StockRow): Exclude<ExpirationFilter, "ALL"> | "NORMAL" => {
  if (parseNumber(row.Saldo) <= 0) return "NORMAL";
  const raw = String(row.Fec_Vencim ?? "").trim();
  const parts = raw.split(/[\/-]/).map(part => Number(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "NORMAL";

  const [first, second, third] = parts;
  const year = first > 1000 ? first : third < 100 ? third + 2000 : third;
  const month = second - 1;
  const day = first > 1000 ? third : first;
  const expiration = new Date(year, month, day, 23, 59, 59, 999);
  if (Number.isNaN(expiration.getTime())) return "NORMAL";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (expiration < today) return "EXPIRED";
  if (expiration.getMonth() === today.getMonth() && expiration.getFullYear() === today.getFullYear()) return "EXPIRING";
  return "NORMAL";
};



export const AssignedIpressStockModule: React.FC = () => {
  const { user } = useAuth();
  const legacyUser = user as (typeof user & { facilityCode?: string });
  const facilityCode = user?.personnelData?.facilityCode || user?.facilityData?.code || legacyUser?.facilityCode;
  const facilityName = user?.facilityData?.name || facilityCode || "Mi establecimiento";
  const ungetId = user?.personnelData?.ungetId || user?.facilityData?.ungetId || (legacyUser as any)?.ungetId;

  const [rows, setRows] = useState<StockRow[]>([]);
  const [assignment, setAssignment] = useState<StockAssignment | null>(null);
  const [link, setLink] = useState<FacilitySheetLink | null>(null);
  /** Solo para poner nombre a cada ALMCOD en la columna «Código IPRESS». */
  const [facilities, setFacilities] = useState<Array<{ code?: string; name?: string }>>([]);
  const [source, setSource] = useState<StockSource | null>(null);
  const [lastUpdate, setLastUpdate] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");
  const [expirationFilter, setExpirationFilter] = useState<ExpirationFilter>("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadStock = useCallback(async (showSuccess = false) => {
    if (!facilityCode) {
      setRows([]);
      setAssignment(null);
      setSource(null);
      setErrorMessage("El usuario no está vinculado a un código de establecimiento IPRESS.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setPage(1);
    setErrorMessage("");
    try {
      const [nativeRows, assignments, conexiones] = await Promise.all([
        api.getStockActual([facilityCode]),
        api.getMyStockAssignments(facilityCode),
        // La conexión vigente de la UNGET: su URL puede haber cambiado desde que se
        // creó la asignación, o puede que ya solo lea por hoja de cálculo.
        api.getAllUngetConfigs()
      ]);

      // Los nombres de las farmacias son un adorno de la tabla: si no se pueden leer, la
      // columna muestra solo el código en vez de impedir que se vea el stock.
      api.getFacilities()
        .then(lista => setFacilities(lista || []))
        .catch(err => console.warn("No se pudo leer el registro de establecimientos:", err));
      const currentAssignment = (assignments[0] || null) as StockAssignment | null;
      setAssignment(currentAssignment);
      setLink(null);

      if (nativeRows.length > 0) {
        setRows(nativeRows.map(row => normalizeRow(row as StockRow)));
        setSource("SYNC");
        const updateTimes = nativeRows
          .map(row => String(row.ultima_actualizacion || row.updated_at || ""))
          .filter(Boolean)
          .sort();
        setLastUpdate(updateTimes.at(-1) || "");
        if (showSuccess) toast.success("Stock sincronizado actualizado");
        return;
      }

      // La conexión es la de **su** UNGET, no la que quedó guardada en la asignación: así el
      // establecimiento encuentra su hoja aunque nadie le haya asignado nada.
      const conexion =
        pickOneConnectionPerUnget(conexiones).find(
          c => ungetId && String(c.ungetId || "") === String(ungetId),
        ) || findConnectionForAssignment(currentAssignment, conexiones);

      if (!conexion && !currentAssignment) {
        setRows([]);
        setSource(null);
        setLastUpdate("");
        setErrorMessage(
          "Este establecimiento todavía no tiene stock sincronizado, y su UNGET no tiene una conexión configurada.",
        );
        return;
      }

      // El vínculo se deduce del código: la pestaña cuyo código coincide con el del
      // establecimiento. Ver services/facilitySheetLink.ts.
      let vinculo: FacilitySheetLink | null = null;
      try {
        vinculo = resolveFacilitySheet(facilityCode, await listUngetSheets(conexion, { withRowCounts: false }));
      } catch (err) {
        // Sin catálogo de pestañas no hay vínculo que deducir; queda la asignación guardada.
        console.warn("No se pudieron listar las hojas de la UNGET:", err);
      }
      setLink(vinculo);

      // La asignación guardada solo sirve de red cuando **no se pudo deducir nada**, es
      // decir cuando no hubo forma de leer las pestañas. Si las pestañas se leyeron y
      // ninguna es suya, la hoja guardada es justamente la que no hay que abrir: era de
      // otro establecimiento, y leerla le enseñaría el stock ajeno como si fuera el propio.
      const sheetName = vinculo
        ? (isLinkedToSheet(vinculo) ? vinculo.sheet?.name || "" : "")
        : currentAssignment?.sheetName || "";

      if (!sheetName) {
        setRows([]);
        setSource(null);
        setLastUpdate("");
        setErrorMessage(
          vinculo?.message ||
            "Este establecimiento todavía no tiene stock sincronizado ni una hoja de cálculo que le corresponda.",
        );
        return;
      }

      const sheetRows = (await readAssignedSheetRows(
        { sheetName, sheetUrl: currentAssignment?.sheetUrl, ungetId: ungetId || currentAssignment?.ungetId },
        conexion,
      )) as StockRow[];
      if (sheetRows.length === 0) {
        throw new Error(`No se encontró la hoja “${sheetName}” o no contiene registros.`);
      }

      // La IPRESS ve su hoja entera —sus puestos comunales son suyos—; un puesto comunal
      // solo las filas de su propio ALMCOD.
      const propias = rowsBelongingToFacility(sheetRows, facilityCode, row =>
        String(readValue(row, ["ALMCOD", "almcod"]) ?? ""),
      );

      setRows(propias.map(normalizeRow));
      setSource("SHEET");
      const updateTimes = propias
        .map(row => String(readValue(row, ["ULTIMA_ACTUALIZACION", "Ultima_Actualizacion", "FECHA_DEL_EQUIPO"])))
        .filter(Boolean)
        .sort();
      setLastUpdate(updateTimes.at(-1) || "");
      if (showSuccess) toast.success("Hoja actualizada");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el stock asignado.";
      setRows([]);
      setSource(null);
      setLastUpdate("");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [facilityCode, ungetId]);

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  useEffect(() => {
    setPage(1);
  }, [search, source, expirationFilter]);

  const visibleColumns = useMemo(() => {
    const requested = assignment?.visibleColumns?.length ? assignment.visibleColumns : DEFAULT_STOCK_COLUMN_KEYS;
    const requestedKeys = new Set(requested.map(normalizeKey));
    const selected = STOCK_COLUMNS.filter(column =>
      requestedKeys.has(normalizeKey(column.key)) || column.aliases.some(alias => requestedKeys.has(normalizeKey(alias)))
    );
    return selected.length > 0 ? selected : STOCK_COLUMNS.filter(column => DEFAULT_STOCK_COLUMN_KEYS.includes(column.key));
  }, [assignment]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    return rows.filter(row => {
      if (expirationFilter !== "ALL" && getExpirationState(row) !== expirationFilter) return false;
      if (!query) return true;
      return visibleColumns.some(column => String(row[column.key] ?? "").toLocaleLowerCase("es").includes(query));
    });
  }, [rows, search, visibleColumns, expirationFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const metrics = useMemo(() => ({
    lots: rows.length,
    expiring: rows.filter(row => getExpirationState(row) === "EXPIRING").length,
    expired: rows.filter(row => getExpirationState(row) === "EXPIRED").length
  }), [rows]);

  const allowedKeys = useMemo(() => new Set(visibleColumns.map(column => column.key)), [visibleColumns]);
  const canShow = (key: string) => allowedKeys.has(key);

  /**
   * La hoja de una IPRESS trae todas sus farmacias mezcladas, separadas solo por el ALMCOD.
   * La columna «Código IPRESS» las distingue, y aparece solo cuando hay más de una: en el
   * envío consolidado sería una constante repetida.
   */
  const showsPharmacy = useMemo(
    () => showsPharmacyColumn(rows, row => String(row.ALMCOD ?? "")),
    [rows],
  );
  const pharmacyLabelOf = (row: StockRow) => describePharmacyCode(String(row.ALMCOD ?? ""), facilities);

  const exportStock = () => {
    if (filteredRows.length === 0) {
      toast.info("No hay registros para exportar");
      return;
    }
    const exportRows = filteredRows.map(row => Object.fromEntries([
      // Igual que en pantalla: solo cuando hay más de una farmacia en la hoja.
      ...(showsPharmacy
        ? [["Código IPRESS", pharmacyLabelOf(row).code], ["Farmacia", pharmacyLabelOf(row).name]]
        : []),
      ...visibleColumns.map(column => [column.label, row[column.key] ?? ""])
    ]));
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = visibleColumns.map(column => ({ wch: column.key === "Nombre" ? 48 : 18 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock SISMED");
    XLSX.writeFile(workbook, `STOCK_SISMED_${facilityCode || "IPRESS"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-teal-50 p-3 text-teal-700"><FileSpreadsheet className="h-6 w-6" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-slate-900">Stock SISMED</h2>
                <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">Solo lectura</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">Existencia propia del establecimiento, sin acceso al stock de otras IPRESS.</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-slate-600">
                <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-teal-600" />{facilityName}</span>
                {facilityCode && <span className="font-mono text-slate-400">IPRESS {facilityCode}</span>}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => void loadStock(true)} disabled={loading || !facilityCode} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        {source && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs">
            <span className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-black ${source === "SYNC" ? "bg-cyan-50 text-cyan-700" : "bg-violet-50 text-violet-700"}`}>
              {source === "SYNC" ? <Database className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
              {source === "SYNC"
                ? "Sincronización SISMED 2.0"
                : `Hoja: ${link?.sheet?.name || assignment?.sheetName}`}
            </span>
            {source === "SHEET" && link?.status === "dentro-de-su-ipress" && (
              <span className="text-slate-500">Puesto comunal: su stock viene dentro de la hoja de su IPRESS, separado por su ALMCOD.</span>
            )}
            {lastUpdate && <span className="text-slate-500">Última actualización: <strong className="text-slate-700">{lastUpdate}</strong></span>}
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center rounded-2xl border border-slate-200 bg-white py-20 shadow-sm"><div className="h-9 w-9 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" /></div>
      ) : errorMessage ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" />
          <h3 className="mt-3 font-black text-amber-950">Stock no disponible</h3>
          <p className="mx-auto mt-1 max-w-2xl text-sm leading-6 text-amber-800">{errorMessage}</p>
          {facilityCode && (
            <p className="mt-2 text-xs text-amber-700">
              {link?.status === "codigo-no-reconocido"
                ? "El administrador puede corregir el código en Administración → Establecimientos."
                : "La hoja se reconoce por el código del establecimiento; pida a su UNGET que publique la pestaña con su código."}
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="flex flex-wrap gap-3">
            <Metric icon={<Package className="h-4 w-4" />} label="Lotes" value={metrics.lots.toLocaleString("es-PE")} tone="teal" />
            <Metric icon={<Clock className="h-4 w-4" />} label="Por vencer" value={metrics.expiring.toLocaleString("es-PE")} tone="amber" />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Vencidos" value={metrics.expired.toLocaleString("es-PE")} tone="red" />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full max-w-2xl">
                <label className="relative block">
                  <span className="sr-only">Buscar medicamento en el stock</span>
                  <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar medicamento en esta hoja..." className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-28 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100" />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda" className="absolute right-[92px] top-2.5 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                  )}
                </label>
                <button type="button" aria-expanded={filtersOpen} aria-haspopup="menu" onClick={() => setFiltersOpen(open => !open)} className="absolute right-1.5 top-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50">
                  <Filter className="h-3.5 w-3.5 text-teal-600" /> Filtros
                  {expirationFilter !== "ALL" && <span className="h-2 w-2 rounded-full bg-teal-500" />}
                </button>
                {filtersOpen && (
                  <div className="absolute right-0 top-12 z-40 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    {EXPIRATION_FILTER_OPTIONS.map(option => (
                      <button key={option.value} type="button" onClick={() => { setExpirationFilter(option.value); setFiltersOpen(false); }} className={`w-full rounded-lg px-3 py-2 text-left text-xs font-bold ${expirationFilter === option.value ? "bg-teal-50 text-teal-700" : "text-slate-600 hover:bg-slate-50"}`}>{option.label}</button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
                {metrics.expired > 0 && <button type="button" onClick={() => setExpirationFilter("EXPIRED")} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-100 bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"><AlertTriangle className="h-3.5 w-3.5" />{metrics.expired} Vencidos</button>}
                {metrics.expiring > 0 && <button type="button" onClick={() => setExpirationFilter("EXPIRING")} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50"><Clock className="h-3.5 w-3.5" />{metrics.expiring} Por vencer</button>}
                <button type="button" onClick={exportStock} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4 text-emerald-600" />Exportar Stock</button>
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">No se encontraron registros con el criterio indicado.</div>
            ) : (
              <div className="max-h-[calc(100vh-410px)] overflow-auto custom-scrollbar">
                <table className="block min-w-full text-left sm:table">
                  <thead className="sticky top-0 z-20 hidden bg-slate-50 shadow-sm sm:table-header-group">
                    <tr>
                      {showsPharmacy && <TableHeader>Código IPRESS</TableHeader>}
                      <TableHeader>Cód. SISMED / SIGA</TableHeader>
                      <TableHeader className="min-w-[300px]">Descripción del producto</TableHeader>
                      <TableHeader align="right">Saldo</TableHeader>
                      <TableHeader>Lote / Venc.</TableHeader>
                      <TableHeader>Tipo Sum.</TableHeader>
                      <TableHeader>F. Finan.</TableHeader>
                      {canShow("FECHA_DEL_EQUIPO") && <TableHeader>Fecha del equipo</TableHeader>}
                      {canShow("ULTIMA_ACTUALIZACION") && <TableHeader>Última actualización</TableHeader>}
                    </tr>
                  </thead>
                  <tbody className="block bg-slate-50 p-3 sm:table-row-group sm:divide-y sm:divide-slate-100 sm:bg-white sm:p-0">
                    {visibleRows.map((row, index) => (
                      <tr key={`${String(row.Id_Producto)}-${String(row.Lote)}-${(page - 1) * pageSize + index}`} className="mb-3 block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:bg-teal-50/40 sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:p-0 sm:shadow-none">
                        <td className="block sm:hidden">
                          {showsPharmacy && (
                            <div className="mb-2 border-b border-slate-100 pb-2">
                              <PharmacyCodeCell label={pharmacyLabelOf(row)} />
                            </div>
                          )}
                          <div className="mb-2 flex items-start justify-between">
                            <div className="flex flex-col">
                              <span className="mb-1 w-fit rounded border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-black text-teal-700">{canShow("Id_Producto") ? String(row.Id_Producto || "—") : "—"}</span>
                              <span className="text-[10px] font-bold text-slate-400">{canShow("CODIGO_SIG") ? String(row.CODIGO_SIG || "—") : "—"}</span>
                            </div>
                            <div className="text-right"><span className="block text-[9px] font-black uppercase text-slate-400">Saldo</span><span className="text-xl font-black text-teal-600">{canShow("Saldo") ? parseNumber(row.Saldo).toLocaleString("es-PE") : "—"}</span></div>
                          </div>
                          <div className="mb-2 text-sm font-bold leading-snug text-slate-900">{canShow("Nombre") ? String(row.Nombre || "—") : "—"}</div>
                          {canShow("Reg_Sanitario") && <div className="mb-2 text-[10px] text-slate-400">RS: {String(row.Reg_Sanitario || "S/N")}</div>}
                          <div className="flex items-end justify-between gap-3 text-[10px]">
                            <div className="font-mono text-slate-500"><div><strong className="text-slate-400">Lote:</strong> {canShow("Lote") ? String(row.Lote || "—") : "—"}</div><div><strong className="text-slate-400">Vence:</strong> {canShow("Fec_Vencim") ? formatStockDate(row.Fec_Vencim) : "—"}</div></div>
                            <div className="flex gap-1.5"><TypeBadge tone="indigo" value={canShow("DESC_TIPSUM") ? String(row.TIPSUM || row.DESC_TIPSUM || "—") : "—"} title={String(row.DESC_TIPSUM || "")} /><TypeBadge tone="amber" value={canShow("DESC_FFINAN") ? String(row.FFINAN || row.DESC_FFINAN || "—") : "—"} title={String(row.DESC_FFINAN || "")} /></div>
                          </div>
                          {(canShow("FECHA_DEL_EQUIPO") || canShow("ULTIMA_ACTUALIZACION")) && (
                            <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                              {canShow("FECHA_DEL_EQUIPO") && <div><strong className="text-slate-500">Equipo:</strong> {String(row.FECHA_DEL_EQUIPO || "—")}</div>}
                              {canShow("ULTIMA_ACTUALIZACION") && <div><strong className="text-slate-500">Actualizado:</strong> {String(row.ULTIMA_ACTUALIZACION || "—")}</div>}
                            </div>
                          )}
                        </td>
                        {showsPharmacy && (
                          <td className="hidden whitespace-nowrap px-4 py-3 align-top sm:table-cell">
                            <PharmacyCodeCell label={pharmacyLabelOf(row)} />
                          </td>
                        )}
                        <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-500 sm:table-cell"><div className="font-bold text-slate-700">{canShow("Id_Producto") ? String(row.Id_Producto || "—") : "—"}</div><div className="mt-0.5 text-[10px] text-slate-400">{canShow("CODIGO_SIG") ? String(row.CODIGO_SIG || "—") : "—"}</div></td>
                        <td className="hidden px-4 py-3 text-sm font-medium text-slate-900 sm:table-cell">{canShow("Nombre") ? String(row.Nombre || "—") : "—"}{canShow("Reg_Sanitario") && <div className="mt-0.5 max-w-sm truncate text-[10px] font-normal text-slate-400" title={String(row.Reg_Sanitario || "")}>RS: {String(row.Reg_Sanitario || "S/N")}</div>}</td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-right text-sm font-black text-slate-900 sm:table-cell">{canShow("Saldo") ? parseNumber(row.Saldo).toLocaleString("es-PE") : "—"}</td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-500 sm:table-cell"><span className="font-mono text-slate-700">{canShow("Lote") ? String(row.Lote || "—") : "—"}</span><div className="mt-0.5 text-[10px]">Vence: {canShow("Fec_Vencim") ? formatStockDate(row.Fec_Vencim) : "—"}</div></td>
                        <td className="hidden whitespace-nowrap px-4 py-3 sm:table-cell"><TypeBadge tone="indigo" value={canShow("DESC_TIPSUM") ? String(row.TIPSUM || row.DESC_TIPSUM || "—") : "—"} title={String(row.DESC_TIPSUM || "")} /></td>
                        <td className="hidden whitespace-nowrap px-4 py-3 sm:table-cell"><TypeBadge tone="amber" value={canShow("DESC_FFINAN") ? String(row.FFINAN || row.DESC_FFINAN || "—") : "—"} title={String(row.DESC_FFINAN || "")} /></td>
                        {canShow("FECHA_DEL_EQUIPO") && <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-500 sm:table-cell">{String(row.FECHA_DEL_EQUIPO || "—")}</td>}
                        {canShow("ULTIMA_ACTUALIZACION") && <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-500 sm:table-cell">{String(row.ULTIMA_ACTUALIZACION || "—")}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filteredRows.length > pageSize && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <span className="text-xs text-slate-500">Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
                <div className="flex gap-2">
                  <button type="button" aria-label="Página anterior" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" aria-label="Página siguiente" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: string; tone: "teal" | "amber" | "red" }> = ({ icon, label, value, tone }) => {
  const tones = {
    teal: { icon: "bg-teal-50 text-teal-600", label: "text-teal-600" },
    amber: { icon: "border border-amber-100 bg-amber-50 text-amber-600", label: "text-amber-600" },
    red: { icon: "border border-red-100 bg-red-50 text-red-500", label: "text-red-500" }
  };
  return (
    <div className="flex min-w-[145px] items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone].icon}`}>{icon}</div>
      <div><div className="text-lg font-black leading-none text-slate-800">{value}</div><div className={`mt-1 text-[10px] font-bold uppercase leading-none ${tones[tone].label}`}>{label}</div></div>
    </div>
  );
};

const TableHeader: React.FC<{ children: React.ReactNode; align?: "left" | "right"; className?: string }> = ({ children, align = "left", className = "" }) => (
  <th scope="col" className={`sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</th>
);

const TypeBadge: React.FC<{ tone: "indigo" | "amber"; value: string; title: string }> = ({ tone, value, title }) => (
  <span title={title} className={`inline-flex max-w-[110px] truncate rounded-md border px-2 py-1 text-[10px] font-bold uppercase ${tone === "indigo" ? "border-indigo-100 bg-indigo-50 text-indigo-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
    {value}
  </span>
);
