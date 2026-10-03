import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Download,
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
  type ExpirationState,
  parseStockNumber,
  type StockRow,
} from "../services/assignedIpressStock";
import {
  describePharmacyCode,
  showsPharmacyColumn,
  type FacilitySheetLink,
} from "../services/facilitySheetLink";
import { PharmacyCodeCell } from "./ui/PharmacyCodeCell";
import { EmptyState, KpiCard, KpiStrip, TableHeaderCell as HeaderCell, filterInputClass } from "./ui/kit";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { ExpiryDate, LotDetailSheet, LotMobileItem } from "./StockLotParts";
import { TablePagination } from "./ui/TablePagination";
import { noticeSettingsApi } from "../services/noticeSettings";
import { DAY_MS, DEFAULT_NOTICE_THRESHOLDS, type NoticeThresholds, noticeWhen } from "../services/notifications";
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
  /** Lote abierto en el detalle (al tocar una fila o una tarjeta). */
  const [detail, setDetail] = useState<StockRow | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState(0);
  /** Ventana de «por vencer» y días sin actualizar: los mismos parámetros que usa la campana. */
  const [thresholds, setThresholds] = useState<NoticeThresholds>(DEFAULT_NOTICE_THRESHOLDS);
  const expiryDays = thresholds.expiryDays;
  const pageSize = 50;

  useEffect(() => {
    let vigente = true;
    void noticeSettingsApi.getOrDefault().then(value => { if (vigente) setThresholds(value); });
    return () => { vigente = false; };
  }, []);

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
      setLastUpdateAt(result.lastUpdateAt);
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
      setLastUpdateAt(0);
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
      if (expirationFilter !== "ALL" && getExpirationState(row, expiryDays) !== expirationFilter) return false;
      if (!query) return true;
      return visibleColumns.some(column => String(row[column.key] ?? "").toLocaleLowerCase("es").includes(query));
    });
  }, [rows, search, visibleColumns, expirationFilter, expiryDays]);

  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  // En el celular no hay páginas: la lista crece al bajar.
  const mobileList = useIncrementalCount(filteredRows.length, `${search}|${expirationFilter}|${loadedSheet}`);
  const mobileRows = filteredRows.slice(0, mobileList.count);
  const metrics = useMemo(() => ({
    lots: rows.length,
    expiring: rows.filter(row => getExpirationState(row, expiryDays) === "EXPIRING").length,
    expired: rows.filter(row => getExpirationState(row, expiryDays) === "EXPIRED").length
  }), [rows, expiryDays]);

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

  const [updateDate, updateTime] = lastUpdate.split(" ");
  const isStale = lastUpdateAt > 0 && Date.now() - lastUpdateAt >= thresholds.staleDays * DAY_MS;
  const toggleFilter = (value: ExpirationFilter) => setExpirationFilter(current => (current === value ? "ALL" : value));
  const textOrDash = (key: string, ...values: unknown[]) => {
    if (!canShow(key)) return "";
    return values.map(value => String(value ?? "").trim()).find(Boolean) || "";
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
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
          <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
            <KpiCard watermark tone="info" icon={<Package />} label="Lotes" value={metrics.lots.toLocaleString("es-PE")} hint="en la hoja del establecimiento" onClick={() => setExpirationFilter("ALL")} active={expirationFilter === "ALL"} />
            <KpiCard watermark tone="warning" icon={<Clock />} label="Por vencer" value={metrics.expiring.toLocaleString("es-PE")} hint={`en los próximos ${expiryDays} días`} onClick={() => toggleFilter("EXPIRING")} active={expirationFilter === "EXPIRING"} />
            <KpiCard watermark tone="danger" icon={<AlertTriangle />} label="Vencidos" value={metrics.expired.toLocaleString("es-PE")} hint="todavía con saldo" onClick={() => toggleFilter("EXPIRED")} active={expirationFilter === "EXPIRED"} />
            {/* Ámbar con el mismo umbral de días sin actualizar que usa la campana. */}
            <KpiCard watermark tone={isStale ? "warning" : "neutral"} icon={<CalendarClock />} label="Última actualización" value={updateDate || "—"} hint={lastUpdateAt ? `${updateTime ? `a las ${updateTime.slice(0, 5)} · ` : ""}${noticeWhen(lastUpdateAt)}` : "sin fecha en la hoja"} />
          </KpiStrip>

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
              <span className="ml-auto" />
              <button type="button" onClick={() => void loadStock(true)} disabled={loading || !facilityCode} aria-label="Actualizar" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                <RefreshCw className={`h-4 w-4 text-teal-600 ${loading ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Actualizar</span>
              </button>
              <button type="button" onClick={exportStock} aria-label="Exportar a Excel" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <Download className="h-4 w-4 text-emerald-600" /><span className="hidden sm:inline">Exportar</span>
              </button>
            </div>

            {expirationFilter !== "ALL" && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs font-semibold text-slate-600">
                <span>Mostrando solo <strong>{expirationFilter === "EXPIRED" ? "vencidos" : `por vencer en ${expiryDays} días`}</strong></span>
                <button type="button" onClick={() => setExpirationFilter("ALL")} className="font-bold text-teal-700 hover:underline">Ver todos</button>
              </div>
            )}

            {filteredRows.length === 0 ? (
              <EmptyState icon={<Search className="h-5 w-5" />} title="Sin resultados" description="No hay lotes que coincidan con la búsqueda o el filtro." />
            ) : (
              <>
                {/* Celular: una tarjeta compacta por lote. */}
                <ul className="divide-y divide-slate-100 sm:hidden">
                  {mobileRows.map((row, index) => (
                    <LotMobileItem
                      key={`${String(row.Id_Producto)}-${String(row.Lote)}-${index}`}
                      row={row}
                      state={getExpirationState(row, expiryDays)}
                      onOpen={() => setDetail(row)}
                      canShow={canShow}
                      pharmacy={showsPharmacy ? pharmacyLabelOf(row) : null}
                    />
                  ))}
                </ul>
                <div className="sm:hidden">
                  <LoadMoreSentinel hasMore={mobileList.hasMore} onLoadMore={mobileList.loadMore} shown={mobileList.count} total={filteredRows.length} itemLabel="lotes" />
                </div>

                {/* Escritorio: tabla. */}
                <div className="hidden max-h-[calc(100vh-370px)] min-h-[320px] overflow-auto custom-scrollbar sm:block">
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
                        const state = getExpirationState(row, expiryDays);
                        const tipo = textOrDash("DESC_TIPSUM", row.TIPSUM, row.DESC_TIPSUM);
                        const fuente = textOrDash("DESC_FFINAN", row.FFINAN, row.DESC_FFINAN);
                        return (
                          <tr key={`${String(row.Id_Producto)}-${String(row.Lote)}-${(page - 1) * pageSize + index}`} tabIndex={0} onClick={() => setDetail(row)} onKeyDown={(e) => { if (e.key === "Enter") setDetail(row); }} title="Ver el detalle del lote" className="cursor-pointer hover:bg-teal-50/40 focus:bg-teal-50/40 focus:outline-none">
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
                              <div className="mt-1 text-[12px] text-slate-500">
                                {canShow("Fec_Vencim") ? <ExpiryDate value={row.Fec_Vencim} state={state} /> : "—"}
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

            <div className="hidden sm:block">
              <TablePagination page={page} pageSize={pageSize} total={filteredRows.length} onPageChange={setPage} itemLabel="lotes" />
            </div>
          </section>
        </>
      )}

      <LotDetailSheet
        row={detail}
        state={detail ? getExpirationState(detail, expiryDays) : "NORMAL"}
        onClose={() => setDetail(null)}
        canShow={canShow}
        pharmacy={detail && showsPharmacy ? pharmacyLabelOf(detail) : null}
      />
    </div>
  );
};
