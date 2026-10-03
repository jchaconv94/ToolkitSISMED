import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
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
  formatStockDate,
  getExpirationState,
  loadAssignedIpressStock,
  parseStockNumber,
  type StockRow,
} from "../services/assignedIpressStock";
import {
  describePharmacyCode,
  showsPharmacyColumn,
  type FacilitySheetLink,
} from "../services/facilitySheetLink";
import { PharmacyCodeCell } from "./ui/PharmacyCodeCell";
import { EmptyState, KpiCard, StatusChip, TableHeaderCell as HeaderCell, filterInputClass, toneIconClass } from "./ui/kit";
import {
  DEFAULT_STOCK_COLUMN_KEYS,
  STOCK_COLUMNS,
} from "../services/stockColumns";
import { StockAssignment } from "../types";

type ExpirationFilter = "ALL" | "EXPIRED" | "EXPIRING";

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

// La lectura y el formato de las filas viven en services/assignedIpressStock.ts: los avisos
// de la campana leen el mismo stock por el mismo camino.
const parseNumber = parseStockNumber;

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
  /** Pestaña de la que se leyó el stock; vacía mientras no haya stock que mostrar. */
  const [loadedSheet, setLoadedSheet] = useState("");
  const [lastUpdate, setLastUpdate] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");
  const [expirationFilter, setExpirationFilter] = useState<ExpirationFilter>("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadStock = useCallback(async (showSuccess = false) => {
    if (!facilityCode) {
      setRows([]);
      setAssignment(null);
      setLoadedSheet("");
      setErrorMessage("El usuario no está vinculado a un código de establecimiento IPRESS.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setPage(1);
    setErrorMessage("");
    try {
      // Los nombres de las farmacias son un adorno de la tabla: si no se pueden leer, la
      // columna muestra solo el código en vez de impedir que se vea el stock.
      api.getFacilities()
        .then(lista => setFacilities(lista || []))
        .catch(err => console.warn("No se pudo leer el registro de establecimientos:", err));
      setLink(null);

      // Conexión de su UNGET, pestaña que le corresponde y filas propias: ver
      // services/assignedIpressStock.ts.
      const result = await loadAssignedIpressStock(facilityCode, ungetId);
      setAssignment(result.assignment);
      setLink(result.link);
      setRows(result.rows);
      setLoadedSheet(result.sheetName);
      setLastUpdate(result.lastUpdate);
      if (result.message) {
        setErrorMessage(result.message);
        return;
      }
      if (showSuccess) toast.success("Hoja actualizada");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el stock asignado.";
      setRows([]);
      setLoadedSheet("");
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
  }, [search, loadedSheet, expirationFilter]);

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

  const sheetLabel = link?.sheet?.name || assignment?.sheetName || "";
  const toggleFilter = (value: ExpirationFilter) => setExpirationFilter(current => (current === value ? "ALL" : value));
  const textOrDash = (key: string, ...values: unknown[]) => {
    if (!canShow(key)) return "";
    return values.map(value => String(value ?? "").trim()).find(Boolean) || "";
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* El título ya está en la cabecera de la app: aquí solo va de quién es la hoja. */}
      <section className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${toneIconClass.info}`}><Building2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[14px] font-black text-slate-900">{facilityName}</p>
            {facilityCode && <span className="shrink-0 font-mono text-xs font-bold text-slate-400">{facilityCode}</span>}
            <span className="hidden shrink-0 sm:inline"><StatusChip label="Solo lectura" tone="success" /></span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-slate-500">
            {loadedSheet ? (
              <>
                <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-slate-400" />
                <span className="hidden sm:inline">{sheetLabel}{lastUpdate && " · "}</span>
                {lastUpdate ? <>Actualizada <strong className="font-bold text-slate-700">{lastUpdate}</strong></> : <span className="sm:hidden">{sheetLabel}</span>}
              </>
            ) : loading ? "Leyendo la hoja…" : "Sin hoja"}
          </p>
          {link?.status === "dentro-de-su-ipress" && (
            <p className="mt-0.5 text-[11px] text-slate-400">Puesto comunal: su stock viene dentro de la hoja de su IPRESS, separado por su ALMCOD.</p>
          )}
        </div>
        <button type="button" onClick={() => void loadStock(true)} disabled={loading || !facilityCode} aria-label="Actualizar" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">Actualizar</span>
        </button>
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
          {/* Los indicadores son también el filtro: tocar uno muestra solo esos lotes. */}
          <section className="grid grid-cols-3 gap-2 sm:max-w-2xl sm:gap-3">
            <KpiCard compact label="Lotes" value={metrics.lots.toLocaleString("es-PE")} icon={<Package />} tone="info" onClick={() => setExpirationFilter("ALL")} active={expirationFilter === "ALL"} />
            <KpiCard compact label="Por vencer" value={metrics.expiring.toLocaleString("es-PE")} icon={<Clock />} tone="warning" onClick={() => toggleFilter("EXPIRING")} active={expirationFilter === "EXPIRING"} />
            <KpiCard compact label="Vencidos" value={metrics.expired.toLocaleString("es-PE")} icon={<AlertTriangle />} tone="danger" onClick={() => toggleFilter("EXPIRED")} active={expirationFilter === "EXPIRED"} />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 p-3 sm:p-4">
              <label className="relative min-w-0 flex-1 sm:max-w-xl">
                <span className="sr-only">Buscar en el stock</span>
                <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar producto, código o lote" className={`${filterInputClass} bg-slate-50 pl-10 pr-9 focus:bg-white`} />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-2.5 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                )}
              </label>
              <span className="ml-auto hidden text-xs font-semibold text-slate-400 lg:inline">
                {filteredRows.length.toLocaleString("es-PE")} {filteredRows.length === 1 ? "lote" : "lotes"}
              </span>
              <button type="button" onClick={exportStock} aria-label="Exportar a Excel" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <Download className="h-4 w-4 text-emerald-600" /><span className="hidden sm:inline">Exportar</span>
              </button>
            </div>

            {expirationFilter !== "ALL" && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs font-semibold text-slate-600">
                <span>Mostrando solo <strong>{expirationFilter === "EXPIRED" ? "vencidos" : "por vencer este mes"}</strong></span>
                <button type="button" onClick={() => setExpirationFilter("ALL")} className="font-bold text-teal-700 hover:underline">Ver todos</button>
              </div>
            )}

            {filteredRows.length === 0 ? (
              <EmptyState icon={<Search className="h-5 w-5" />} title="Sin resultados" description="No hay lotes que coincidan con la búsqueda o el filtro." />
            ) : (
              <>
                {/* Celular: una tarjeta compacta por lote. */}
                <ul className="divide-y divide-slate-100 sm:hidden">
                  {visibleRows.map((row, index) => {
                    const state = getExpirationState(row);
                    const tipo = textOrDash("DESC_TIPSUM", row.TIPSUM, row.DESC_TIPSUM);
                    const fuente = textOrDash("DESC_FFINAN", row.FFINAN, row.DESC_FFINAN);
                    return (
                      <li key={`${String(row.Id_Producto)}-${String(row.Lote)}-${(page - 1) * pageSize + index}`} className="flex gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          {showsPharmacy && <PharmacyCodeCell label={pharmacyLabelOf(row)} className="mb-1" />}
                          <p className="text-[14px] font-bold leading-snug text-slate-900">{canShow("Nombre") ? String(row.Nombre || "—") : "—"}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
                            {canShow("Id_Producto") && <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] font-bold text-slate-700">{String(row.Id_Producto || "—")}</span>}
                            {canShow("Lote") && <span>Lote <span className="font-mono text-slate-700">{String(row.Lote || "—")}</span></span>}
                            {canShow("Fec_Vencim") && <span>Vence {formatStockDate(row.Fec_Vencim)}</span>}
                            {state !== "NORMAL" && <ExpiryChip state={state} />}
                          </p>
                          {(tipo || fuente) && (
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              {tipo && <span title={String(row.DESC_TIPSUM || "")}>{tipo}</span>}
                              {tipo && fuente && <span className="text-slate-300">·</span>}
                              {fuente && <span title={String(row.DESC_FFINAN || "")}>{fuente}</span>}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-lg font-black leading-tight ${state === "EXPIRED" ? "text-red-600" : "text-slate-900"}`}>{canShow("Saldo") ? parseNumber(row.Saldo).toLocaleString("es-PE") : "—"}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Saldo</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Escritorio: tabla. */}
                <div className="hidden max-h-[calc(100vh-330px)] overflow-auto custom-scrollbar sm:block">
                  <table className="min-w-full text-left">
                    <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
                      <tr>
                        {showsPharmacy && <HeaderCell>Código IPRESS</HeaderCell>}
                        <HeaderCell>Cód. SISMED / SIGA</HeaderCell>
                        <HeaderCell>Descripción del producto</HeaderCell>
                        <HeaderCell align="right">Saldo</HeaderCell>
                        <HeaderCell>Lote / Vencimiento</HeaderCell>
                        <HeaderCell>Tipo sum.</HeaderCell>
                        <HeaderCell>F. finan.</HeaderCell>
                        {canShow("FECHA_DEL_EQUIPO") && <HeaderCell>Fecha del equipo</HeaderCell>}
                        {canShow("ULTIMA_ACTUALIZACION") && <HeaderCell>Última actualización</HeaderCell>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows.map((row, index) => {
                        const state = getExpirationState(row);
                        const tipo = textOrDash("DESC_TIPSUM", row.TIPSUM, row.DESC_TIPSUM);
                        const fuente = textOrDash("DESC_FFINAN", row.FFINAN, row.DESC_FFINAN);
                        return (
                          <tr key={`${String(row.Id_Producto)}-${String(row.Lote)}-${(page - 1) * pageSize + index}`} className="hover:bg-teal-50/40">
                            {showsPharmacy && <td className="whitespace-nowrap px-4 py-3"><PharmacyCodeCell label={pharmacyLabelOf(row)} /></td>}
                            <td className="whitespace-nowrap px-4 py-3">
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-bold text-slate-700">{canShow("Id_Producto") ? String(row.Id_Producto || "—") : "—"}</span>
                              {canShow("CODIGO_SIG") && row.CODIGO_SIG ? <div className="mt-1 font-mono text-[11px] text-slate-400">{String(row.CODIGO_SIG)}</div> : null}
                            </td>
                            <td className="min-w-[280px] px-4 py-3">
                              <p className="text-[13.5px] font-semibold text-slate-900">{canShow("Nombre") ? String(row.Nombre || "—") : "—"}</p>
                              {canShow("Reg_Sanitario") && row.Reg_Sanitario ? <p className="mt-0.5 max-w-sm truncate text-[11px] text-slate-400" title={String(row.Reg_Sanitario)}>RS: {String(row.Reg_Sanitario)}</p> : null}
                            </td>
                            <td className={`whitespace-nowrap px-4 py-3 text-right text-[15px] font-black ${state === "EXPIRED" ? "text-red-600" : "text-slate-900"}`}>{canShow("Saldo") ? parseNumber(row.Saldo).toLocaleString("es-PE") : "—"}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-[13px]">
                              <span className="font-mono text-slate-700">{canShow("Lote") ? String(row.Lote || "—") : "—"}</span>
                              <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
                                {canShow("Fec_Vencim") ? formatStockDate(row.Fec_Vencim) : "—"}
                                {state !== "NORMAL" && <ExpiryChip state={state} />}
                              </div>
                            </td>
                            <td className="max-w-[160px] truncate px-4 py-3 text-[12px] text-slate-600" title={String(row.DESC_TIPSUM || "")}>{tipo || <span className="text-slate-300">—</span>}</td>
                            <td className="max-w-[160px] truncate px-4 py-3 text-[12px] text-slate-600" title={String(row.DESC_FFINAN || "")}>{fuente || <span className="text-slate-300">—</span>}</td>
                            {canShow("FECHA_DEL_EQUIPO") && <td className="whitespace-nowrap px-4 py-3 text-[12px] text-slate-500">{String(row.FECHA_DEL_EQUIPO || "—")}</td>}
                            {canShow("ULTIMA_ACTUALIZACION") && <td className="whitespace-nowrap px-4 py-3 text-[12px] text-slate-500">{String(row.ULTIMA_ACTUALIZACION || "—")}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
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

/** Estado del lote: el color acompaña al texto, nunca va solo. */
const ExpiryChip: React.FC<{ state: "EXPIRED" | "EXPIRING" }> = ({ state }) => (
  <span className={`rounded-full border px-2 py-px text-[10.5px] font-black ${state === "EXPIRED" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
    {state === "EXPIRED" ? "Vencido" : "Por vencer"}
  </span>
);
