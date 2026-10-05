import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronRight, Clock, Copy, Database, History, KeyRound,
  Loader2, Monitor, MonitorSmartphone, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ATTEMPT_RESULT_LABEL, SEND_KEY_STATE_LABEL, SendAttempt, SendKeyRow, SendKeyState, relativeTime, sendKeyState, sendKeysApi,
} from "../services/sendKeys";
import {
  DeviceState, REPORT_WINDOW_DAYS, SismedFilter, SismedState, ToolkitDevice, activeDevices, compareVersions, latestSismedVersion,
  sismedState, sismedVersionsInUse, toolkitDevicesApi,
} from "../services/toolkitDevices";
import {
  ESTABLISHMENT_FILTER_LABEL, EstablishmentFilter, EstablishmentRow, filterEstablishments, lastSendAt, latestDevice,
  mergeEstablishments, pendingAlerts, summarizeEstablishments, toolkitState,
} from "../services/sendKeyEstablishments";
import {
  EmptyState, KpiCard, KpiStrip, MobileFilterButton, SheetGroupTitle, SheetOption, TableHeaderCell, TableSearch, formatDate,
  filterInputClass, useTableSort,
} from "./ui/kit";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import { TablePagination } from "./ui/TablePagination";
import { BottomSheet } from "./ui/BottomSheet";
import { stickyBarClass, useStickyBar } from "./ui/useStickyBar";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { useDropdownPosition } from "../hooks/useDropdownPosition";



const PAGE_SIZE = 10;

const STATE_STYLE: Record<SendKeyState, { chip: string; icon: React.ElementType; bar: string; tile: string; text: string }> = {
  blocked: { chip: "border-red-200 bg-red-50 text-red-700", icon: ShieldAlert, bar: "bg-red-500", tile: "bg-red-100 text-red-700", text: "text-red-700" },
  protected: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: ShieldCheck, bar: "bg-emerald-500", tile: "bg-emerald-100 text-emerald-700", text: "text-emerald-700" },
  waiting: { chip: "border-amber-200 bg-amber-50 text-amber-700", icon: Clock, bar: "bg-amber-500", tile: "bg-amber-100 text-amber-700", text: "text-amber-700" },
  none: { chip: "border-slate-200 bg-slate-100 text-slate-600", icon: ShieldOff, bar: "bg-slate-400", tile: "bg-slate-100 text-slate-500", text: "text-slate-600" },
};

const StateChip: React.FC<{ state: SendKeyState }> = ({ state }) => {
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  return (
    <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${style.chip}`}>
      <Icon className="h-3.5 w-3.5" />
      {SEND_KEY_STATE_LABEL[state]}
    </span>
  );
};

/** Versión en un chip: verde si está al día, ámbar si no. */
const Version: React.FC<{ version?: string | null; outdated: boolean; prefix?: string }> = ({ version, outdated, prefix = "" }) =>
  version ? (
    <span className={`whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-xs font-bold ${outdated ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
      {prefix}v{version}
    </span>
  ) : null;

const ToolkitVersion: React.FC<{ device?: ToolkitDevice; state: DeviceState; prefix?: string }> = ({ device, state, prefix }) =>
  device?.version ? <Version version={device.version} outdated={state === "outdated"} prefix={prefix} /> : null;

const SismedVersion: React.FC<{ device?: ToolkitDevice; state: SismedState; withDate?: boolean; prefix?: string }> = ({ device, state, withDate, prefix }) => {
  if (!device?.sismedVersion) return null;
  const chip = <Version version={device.sismedVersion} outdated={state === "outdated"} prefix={prefix} />;
  if (!withDate || !device.sismedDate) return chip;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {chip}
      <span className="text-[11px] text-slate-500">{formatDate(device.sismedDate)}</span>
    </span>
  );
};

const Dash = () => <span className="text-slate-400">—</span>;

type PendingAction =
  | { kind: "regenerate"; row: SendKeyRow }
  | { kind: "revoke"; row: SendKeyRow }
  | { kind: "rebind"; row: SendKeyRow };

/** Claves de envío y las PC de cada establecimiento, en una sola pestaña. */
export const AdminSendKeysModule: React.FC = () => {

  const [keys, setKeys] = useState<SendKeyRow[]>([]);
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof toolkitDevicesApi.overview>>>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [newKey, setNewKey] = useState<{ row: SendKeyRow; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      // Las PC y la versión publicada completan la vista; si fallan, las claves se siguen viendo.
      const [keyRows, deviceRows, version] = await Promise.all([
        sendKeysApi.overview(),
        toolkitDevicesApi.overview().catch((error) => {
          console.warn("No se pudieron cargar las PC del Toolkit.", error);
          return [];
        }),
        toolkitDevicesApi.latestRelease(),
      ]);
      setKeys(keyRows);
      setDevices(deviceRows);
      setLatest(version);
    } catch (error: any) {
      setLoadError(error?.message || "No se pudieron cargar los establecimientos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => mergeEstablishments(keys, devices), [keys, devices]);
  const latestSismed = useMemo(() => latestSismedVersion(rows), [rows]);
  const alerts = useMemo(() => pendingAlerts(keys), [keys]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
      return true;
    } catch (error: any) {
      toast.error(error?.message || "No se pudo completar la operación.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const generate = async (row: SendKeyRow) => {
    setBusy(true);
    try {
      const key = await sendKeysApi.generate(row.code);
      setNewKey({ row, key });
      await load();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo generar la clave.");
    } finally {
      setBusy(false);
    }
  };

  const ignore = (row: SendKeyRow) => run(() => sendKeysApi.ignore(row.code), `Aviso de ${row.name} ignorado.`);
  const ignoreAll = () => run(
    () => Promise.all(alerts.map((row) => sendKeysApi.ignore(row.code))),
    alerts.length === 1 ? "Aviso ignorado." : `${alerts.length} avisos ignorados.`,
  );

  const confirmPending = async () => {
    if (!pending) return;
    const { kind, row } = pending;
    if (kind === "regenerate") {
      setPending(null);
      await generate(row);
      return;
    }
    const ok = kind === "revoke"
      ? await run(() => sendKeysApi.revoke(row.code), `${row.name} vuelve a enviar sin clave.`)
      : await run(() => sendKeysApi.rebind(row.alert!.id), `${row.alert?.deviceName || "La PC"} es ahora el equipo de ${row.name}.`);
    if (ok) setPending(null);
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.key);
      toast.success("Clave copiada.");
    } catch {
      toast.error("No se pudo copiar. Selecciónela y cópiela a mano.");
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-teal-600" /> Cargando establecimientos…
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
            <EmptyState
              icon={<AlertTriangle className="h-6 w-6" />}
              title="No se pudieron cargar los establecimientos"
              description={loadError}
              action={<button type="button" onClick={() => { setLoading(true); void load(); }} className="h-10 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white">Reintentar</button>}
            />
          </div>
        ) : (
          <EstablishmentsPanel
            rows={rows}
            latest={latest}
            latestSismed={latestSismed}
            busy={busy}
            onGenerate={(row) => void generate(row)}
            onIgnore={(row) => void ignore(row)}
            onPending={setPending}
            alerts={alerts}
            onIgnoreAll={() => void ignoreAll()}
          />
        )}

      {newKey && <NewKeyModal row={newKey.row} secret={newKey.key} onCopy={() => void copyKey()} onClose={() => setNewKey(null)} />}

      <ConfirmationDialog
        isOpen={Boolean(pending)}
        isConfirming={busy}
        tone={pending?.kind === "rebind" ? "warning" : "danger"}
        title={
          pending?.kind === "rebind" ? "Cambiar a este equipo"
            : pending?.kind === "regenerate" ? "Regenerar clave"
            : "Retirar clave"
        }
        description={
          pending?.kind === "rebind"
            ? `${pending.row.alert?.deviceName || "La PC del intento"} pasará a ser la única que puede enviar el stock de ${pending.row.name}.${pending.row.deviceName ? ` ${pending.row.deviceName} dejará de poder enviar.` : ""} Úselo solo si cambiaron la PC o reinstalaron el SISMED.`
            : pending?.kind === "regenerate"
              ? `La clave actual de ${pending.row.name} dejará de valer. Tendrá que configurar la nueva en el Toolkit, y la PC que la use primero quedará vinculada.`
              : pending
                ? `${pending.row.name} volverá a enviar sin clave, desde cualquier PC, como antes. Se borra también su historial de envíos.`
                : ""
        }
        confirmLabel={pending?.kind === "rebind" ? "Cambiar equipo" : pending?.kind === "regenerate" ? "Regenerar" : "Retirar clave"}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};

const FILTER_ORDER: EstablishmentFilter[] = ["all", "alerts", "protected", "waiting", "none", "toolkitOutdated", "toolkitNone"];

const EstablishmentsPanel: React.FC<{
  rows: EstablishmentRow[];
  latest: string | null;
  latestSismed: string | null;
  busy: boolean;
  onGenerate: (row: SendKeyRow) => void;
  onIgnore: (row: SendKeyRow) => void;
  onPending: (action: PendingAction) => void;
  alerts: SendKeyRow[];
  onIgnoreAll: () => void;
}> = ({ rows, latest, latestSismed, busy, onGenerate, onIgnore, onPending, alerts, onIgnoreAll }) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EstablishmentFilter>("all");
  const [sismedFilter, setSismedFilter] = useState<SismedFilter>("all");
  const [page, setPage] = useState(1);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [history, setHistory] = useState<SendAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const summary = useMemo(() => summarizeEstablishments(rows, latest, undefined, latestSismed), [rows, latest, latestSismed]);
  const sismedVersions = useMemo(() => sismedVersionsInUse(rows), [rows]);
  const filteredRows = useMemo(
    () => filterEstablishments(rows, latest, search, filter, sismedFilter, undefined, latestSismed),
    [rows, latest, search, filter, sismedFilter, latestSismed],
  );
  // Orden por cabecera: sobre las filas filtradas y antes de paginar; la lista del celular usa el mismo.
  const { sorted: filtered, sort, headSort } = useTableSort(
    filteredRows,
    {
      name: (r) => r.name,
      clave: (r) => SEND_KEY_STATE_LABEL[sendKeyState(r)],
      equipo: (r) => r.deviceName || latestDevice(r)?.deviceName || null,
      toolkit: (r) => latestDevice(r)?.version || null,
      sismed: (r) => latestDevice(r)?.sismedVersion || null,
      lastSend: (r) => { const at = lastSendAt(r); return at ? new Date(at).getTime() : null; },
    },
    { firstDir: { toolkit: "desc", sismed: "desc", lastSend: "desc" } },
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, filter, sismedFilter, sort]);
  // En el celular no hay páginas: la lista crece al bajar.
  const mobileList = useIncrementalCount(filtered.length, `${search}|${filter}|${sismedFilter}`, 20);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchBar = useStickyBar<HTMLDivElement>();

  const showUnget = useMemo(() => new Set(rows.map((r) => r.ungetId || "")).size > 1, [rows]);
  const selected = useMemo(() => rows.find((r) => r.code === selectedCode) || null, [rows, selectedCode]);

  const loadHistory = useCallback(async (code: string) => {
    setHistoryLoading(true);
    try {
      setHistory(await sendKeysApi.history(code));
    } catch (error: any) {
      toast.error(error?.message || "No se pudo cargar el historial.");
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // También recarga al cambiar el estado de la fila (ignorar, cambiar de equipo…).
  useEffect(() => {
    if (selected?.hasKey) void loadHistory(selected.code);
    else setHistory([]);
  }, [selected, loadHistory]);

  const toggle = (next: EstablishmentFilter) => setFilter(filter === next ? "all" : next);

  return (
    <div className="space-y-4 pb-6">
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        <KpiCard watermark tone="success" icon={<ShieldCheck />} label="Protegidos" value={`${summary.protectedCount} / ${summary.total}`} hint="con clave de envío" onClick={() => toggle("protected")} active={filter === "protected"} />
        <KpiCard watermark tone="neutral" icon={<ShieldOff />} label="Sin clave" value={summary.none} hint={summary.waiting ? `${summary.waiting} esperando primer envío` : "envían desde cualquier PC"} onClick={() => toggle("none")} active={filter === "none"} />
        <KpiCard watermark tone="warning" icon={<MonitorSmartphone />} label="Toolkit desactualizado" value={summary.toolkitOutdated} hint={latest ? `vigente: v${latest}` : "versión publicada desconocida"} onClick={() => toggle("toolkitOutdated")} active={filter === "toolkitOutdated"} />
        <KpiCard watermark tone="warning" icon={<Database />} label="SISMED desactualizado" value={summary.sismedOutdated} hint={latestSismed ? `vigente: v${latestSismed}` : "aún sin reportes"} onClick={() => setSismedFilter(sismedFilter === "outdated" ? "all" : "outdated")} active={sismedFilter === "outdated"} />
      </KpiStrip>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm md:overflow-hidden">
        {/* Intentos bloqueados: solo aparece si hay alguno sin revisar. Cada uno se resuelve en su detalle. */}
        {alerts.length > 0 && (
          <div className="flex items-start gap-3 border-b border-red-100 bg-red-50/70 px-4 py-2.5 text-[12.5px] text-red-800 md:items-center">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 md:mt-0" />
            {/* En el celular las acciones van debajo del texto, a la izquierda; en escritorio, a la derecha. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-3">
              <span className="font-semibold">{alerts.length === 1 ? "1 intento de envío bloqueado sin revisar" : `${alerts.length} intentos de envío bloqueados sin revisar`}</span>
              <span className="flex items-center gap-4 md:ml-auto md:gap-3">
                <button type="button" onClick={() => setFilter("alerts")} className="font-bold text-red-700 hover:underline">Ver</button>
                <button type="button" disabled={busy} onClick={onIgnoreAll} className="font-bold text-slate-500 hover:underline disabled:opacity-60">Ignorar todos</button>
              </span>
            </div>
          </div>
        )}
        <div ref={searchBar.ref} style={searchBar.style} className={`${stickyBarClass} flex items-center gap-2 border-b border-slate-100 bg-white p-3 md:static md:px-4`}>
          <TableSearch value={search} onChange={setSearch} placeholder="Buscar establecimiento, código o PC" />
          {/* Celular: un botón abre los filtros abajo. */}
          <MobileFilterButton onClick={() => setFiltersOpen(true)} active={filter !== "all" || sismedFilter !== "all"} />
          <div className="ml-auto hidden gap-2 md:flex">
            <select value={filter} onChange={(e) => setFilter(e.target.value as EstablishmentFilter)} aria-label="Estado" className={`${filterInputClass} sm:w-60`}>
              {FILTER_ORDER.map((f) => (
                <option key={f} value={f}>{f === "all" ? "Estado: todos" : ESTABLISHMENT_FILTER_LABEL[f]} ({summary.counts[f]})</option>
              ))}
            </select>
            <select value={sismedFilter} onChange={(e) => setSismedFilter(e.target.value as SismedFilter)} aria-label="Versión del SISMED" className={`${filterInputClass} sm:w-52`}>
              <option value="all">SISMED: todas</option>
              <option value="outdated">SISMED desactualizado</option>
              {sismedVersions.map((v) => (
                <option key={v} value={`v:${v}`}>SISMED v{v}{v === latestSismed ? " (vigente)" : ""}</option>
              ))}
              <option value="none">SISMED sin dato</option>
            </select>
          </div>
        </div>

        <BottomSheet open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
          <SheetGroupTitle first>Estado</SheetGroupTitle>
          <div className="space-y-1">
            {FILTER_ORDER.map((f) => (
              <SheetOption key={f} active={filter === f} label={f === "all" ? "Todos" : ESTABLISHMENT_FILTER_LABEL[f]} count={summary.counts[f]} onClick={() => { setFilter(f); setFiltersOpen(false); }} />
            ))}
          </div>
          <SheetGroupTitle>Versión del SISMED</SheetGroupTitle>
          <div className="space-y-1">
            {([["all", "Todas"], ["outdated", "Desactualizado"], ...sismedVersions.map((v) => [`v:${v}`, `v${v}${v === latestSismed ? " (vigente)" : ""}`]), ["none", "Sin dato"]] as Array<[SismedFilter, string]>).map(([value, label]) => (
              <SheetOption key={value} active={sismedFilter === value} label={label} onClick={() => { setSismedFilter(value); setFiltersOpen(false); }} />
            ))}
          </div>
        </BottomSheet>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-6 w-6" />}
            title={rows.length === 0 ? "No hay establecimientos en su jurisdicción" : "Ningún establecimiento coincide"}
            description={rows.length === 0 ? "Registre sus IPRESS y almacenes en Establecimientos." : "Pruebe con otra búsqueda o filtro."}
          />
        ) : (
          <>
            {/* Escritorio */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <TableHeaderCell sort={headSort("name")}>Establecimiento</TableHeaderCell>
                    <TableHeaderCell sort={headSort("clave")}>Clave</TableHeaderCell>
                    <TableHeaderCell sort={headSort("equipo")}>Equipo</TableHeaderCell>
                    <TableHeaderCell sort={headSort("toolkit")}>Toolkit</TableHeaderCell>
                    <TableHeaderCell sort={headSort("sismed")}>SISMED</TableHeaderCell>
                    <TableHeaderCell sort={headSort("lastSend")}>Último envío</TableHeaderCell>
                    <TableHeaderCell align="right"><span className="sr-only">Acciones</span></TableHeaderCell>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((row) => {
                    const state = sendKeyState(row);
                    const device = latestDevice(row);
                    const pc = row.deviceName || device?.deviceName;
                    return (
                      <tr key={row.code} className="h-14 hover:bg-slate-50/60">
                        <td className="px-4 py-2">
                          <div className="font-bold text-slate-800">{row.name}</div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="font-mono text-teal-700">{row.code}</span>
                            {showUnget && row.ungetName && <span className="text-slate-400">{row.ungetName}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2"><StateChip state={state} /></td>
                        <td className="px-4 py-2">
                          {pc ? (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                              <Monitor className="h-4 w-4 shrink-0 text-slate-400" />{pc}
                              <OtherPcs row={row} latest={latest} latestSismed={latestSismed} />
                            </span>
                          ) : <Dash />}
                        </td>
                        <td className="px-4 py-2"><ToolkitVersion device={device} state={toolkitState(row, latest)} /> {!device?.version && <Dash />}</td>
                        <td className="px-4 py-2"><SismedVersion device={device} state={sismedState(row, latestSismed)} withDate /> {!device?.sismedVersion && <Dash />}</td>
                        <td className="px-4 py-2 text-slate-500">{relativeTime(lastSendAt(row))}</td>
                        <td className="px-4 py-2 text-right">
                          {state === "none" ? (
                            <button type="button" disabled={busy} onClick={() => onGenerate(row)} className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60">
                              <KeyRound className="h-3.5 w-3.5" /> Generar clave
                            </button>
                          ) : (
                            <button type="button" onClick={() => setSelectedCode(row.code)} className="inline-flex items-center text-xs font-bold text-teal-700 hover:text-teal-800">
                              Ver <ChevronRight className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Móvil: tarjetas con lo esencial; el resto, al tocar (detalle). */}
            <div className="space-y-2 p-3 md:hidden">
              {filtered.slice(0, mobileList.count).map((row) => {
                const state = sendKeyState(row);
                const device = latestDevice(row);
                const pc = row.deviceName || device?.deviceName;
                const tk = toolkitState(row, latest) === "outdated";
                const sm = sismedState(row, latestSismed) === "outdated";
                return (
                  <div key={row.code} className="rounded-2xl border border-slate-200 bg-white p-3 text-[13px]">
                    <button type="button" disabled={state === "none"} onClick={() => setSelectedCode(row.code)} className="flex w-full items-start justify-between gap-2 text-left">
                      <span className="min-w-0">
                        <span className="font-mono text-[11px] text-teal-700">{row.code}</span>
                        <span className="block truncate font-black text-slate-800">{row.name}</span>
                        {pc && (
                          <span className="block text-[11.5px] leading-snug text-slate-400">
                            {pc}
                            {device?.version && <> · <span className={tk ? "font-semibold text-amber-700" : ""}>Toolkit v{device.version}</span></>}
                            {device?.sismedVersion && <> · <span className={sm ? "font-semibold text-amber-700" : ""}>SISMED v{device.sismedVersion}</span></>}
                          </span>
                        )}
                      </span>
                      <StateChip state={state} />
                    </button>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11.5px] text-slate-500">Último envío: {relativeTime(lastSendAt(row))}</span>
                      {state === "none" && (
                        <button type="button" disabled={busy} onClick={() => onGenerate(row)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-bold text-white disabled:opacity-60">
                          <KeyRound className="h-3.5 w-3.5" /> Generar clave
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="md:hidden">
              <LoadMoreSentinel hasMore={mobileList.hasMore} onLoadMore={mobileList.loadMore} shown={mobileList.count} total={filtered.length} itemLabel="establecimientos" />
            </div>

            <div className="hidden md:block">
            <TablePagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="establecimientos" />
            </div>
          </>
        )}
      </div>

      <p className="px-1 text-[11.5px] text-slate-500">
        Toolkit y SISMED: los informa la PC al enviar el stock (Toolkit 2.1.10 o posterior), en los últimos {REPORT_WINDOW_DAYS} días.
        {" "}La versión vigente del SISMED es la más alta que reporta alguna PC.
      </p>

      {selected && selected.hasKey && (
        <DetailDrawer
          row={selected}
          latest={latest}
          latestSismed={latestSismed}
          history={history}
          historyLoading={historyLoading}
          busy={busy}
          onClose={() => setSelectedCode(null)}
          onIgnore={() => onIgnore(selected)}
          onRebind={() => onPending({ kind: "rebind", row: selected })}
          onRegenerate={() => onPending({ kind: "regenerate", row: selected })}
          onRevoke={() => onPending({ kind: "revoke", row: selected })}
        />
      )}
    </div>
  );
};

/** Una opción de filtro en el panel inferior del celular. */
const POPOVER_WIDTH = 280;

/**
 * Otras PC que enviaron el mismo establecimiento en los últimos 30 días. Al tocarlo muestra
 * cuáles son: sirve para descubrir una copia vieja del SISMED en otra máquina.
 */
const OtherPcs: React.FC<{ row: EstablishmentRow; latest: string | null; latestSismed: string | null }> = ({ row, latest, latestSismed }) => {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuStyles } = useDropdownPosition(open, { align: "left", customWidth: POPOVER_WIDTH });
  const devices = activeDevices(row);
  if (devices.length < 2) return null;

  return (
    <span ref={triggerRef} className="inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
      >
        +{devices.length - 1} PC
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            style={{ ...menuStyles, width: POPOVER_WIDTH }}
            className="fixed z-[9999] overflow-y-auto rounded-2xl border border-slate-200 bg-white text-left shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.05)] animate-in fade-in slide-in-from-top-2 duration-150"
          >
            <p className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
              PC que enviaron {row.code} · últimos {REPORT_WINDOW_DAYS} días
            </p>
            <DeviceList devices={devices} latest={latest} latestSismed={latestSismed} />
          </div>
        </>,
        document.body,
      )}
    </span>
  );
};

/** PC de un establecimiento, la más reciente primero, con su versión del Toolkit y del SISMED. */
const DeviceList: React.FC<{ devices: ToolkitDevice[]; latest: string | null; latestSismed: string | null }> = ({ devices, latest, latestSismed }) => (
  <ul className="divide-y divide-slate-100">
    {devices.map((device, index) => {
      const outdated = Boolean(latest && device.version && compareVersions(device.version, latest) < 0);
      const sismedOutdated = Boolean(latestSismed && device.sismedVersion && compareVersions(device.sismedVersion, latestSismed) < 0);
      return (
        <li key={`${device.deviceName}-${index}`} className="flex items-center gap-2.5 px-4 py-2.5">
          <Monitor className={`h-4 w-4 shrink-0 ${index === 0 ? "text-teal-600" : "text-slate-400"}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold text-slate-800">{device.deviceName || "PC sin nombre"}</span>
            <span className="block text-[11px] text-slate-500">{index === 0 ? "La más reciente · " : ""}{relativeTime(device.lastSeen)}</span>
            {device.sismedVersion && (
              <span className={`block text-[11px] font-semibold ${sismedOutdated ? "text-amber-700" : "text-slate-500"}`}>SISMED v{device.sismedVersion}</span>
            )}
          </span>
          {device.version && <Version version={device.version} outdated={outdated} />}
        </li>
      );
    })}
  </ul>
);

const DetailDrawer: React.FC<{
  row: EstablishmentRow;
  latest: string | null;
  latestSismed: string | null;
  history: SendAttempt[];
  historyLoading: boolean;
  busy: boolean;
  onClose: () => void;
  onIgnore: () => void;
  onRebind: () => void;
  onRegenerate: () => void;
  onRevoke: () => void;
}> = ({ row, latest, latestSismed, history, historyLoading, busy, onClose, onIgnore, onRebind, onRegenerate, onRevoke }) => {
  const devices = activeDevices(row);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200000] flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="relative overflow-hidden bg-slate-900 px-5 py-5 text-white sm:px-6">
          <KeyRound className="pointer-events-none absolute -bottom-6 right-12 h-28 w-28 text-teal-400 opacity-10" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase text-teal-300">
                <KeyRound className="h-3.5 w-3.5" /> Clave de envío · <span className="font-mono">{row.code}</span>
              </p>
              <h2 className="mt-1 truncate text-lg font-black leading-tight">{row.name}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          {row.deviceName ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Equipo vinculado</p>
              <p className="mt-1 flex items-center gap-2 text-base font-black text-slate-900"><Monitor className="h-5 w-5 text-emerald-700" />{row.deviceName}</p>
              <p className="mt-1 text-xs text-slate-500">
                Vinculado el {formatDate(row.boundAt || undefined)}
                {row.lastOkAt && <> · último envío {relativeTime(row.lastOkAt).toLowerCase()}{row.lastOkRows != null && <> ({row.lastOkRows} lotes)</>}</>}
              </p>
            </section>
          ) : (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-700">Esperando primer envío</p>
              <p className="mt-1 text-xs text-slate-600">
                La primera PC que envíe con la clave <b className="font-mono">…{row.keyHint}</b> quedará vinculada.
              </p>
            </section>
          )}

          {row.alert && (
            <section className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-red-700">Intento bloqueado</p>
              <p className="mt-1 flex items-center gap-2 text-[15px] font-black text-slate-900"><Monitor className="h-5 w-5 text-red-600" />{row.alert.deviceName || "PC sin identificar"}</p>
              <p className="mt-1 text-xs text-slate-500">
                {relativeTime(row.alert.at)}{row.alert.rows != null && <> · {row.alert.rows} lotes</>} · {ATTEMPT_RESULT_LABEL[row.alert.result].replace("Bloqueado · ", "")}
              </p>
              <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
                <button type="button" disabled={busy} onClick={onIgnore} className="h-10 rounded-xl border border-red-200 bg-white px-4 text-[13px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">Ignorar</button>
                <button type="button" disabled={busy} onClick={onRebind} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 text-[13px] font-bold text-white hover:bg-red-700 disabled:opacity-60">
                  <ArrowRightLeft className="h-4 w-4" /> Cambiar a este equipo
                </button>
              </div>
            </section>
          )}

          {devices.length > 0 && (
            <section>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500"><MonitorSmartphone className="h-3.5 w-3.5" />PC que envían · últimos {REPORT_WINDOW_DAYS} días</p>
              <div className="overflow-hidden rounded-2xl border border-slate-100"><DeviceList devices={devices} latest={latest} latestSismed={latestSismed} /></div>
            </section>
          )}

          <section>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500"><History className="h-3.5 w-3.5" />Últimos envíos</p>
            {historyLoading ? (
              <p className="flex items-center gap-2 py-3 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
            ) : history.length === 0 ? (
              <p className="py-3 text-xs text-slate-400">Todavía no hay envíos con esta clave.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {history.map((a) => {
                  const ok = a.result === "ACEPTADO";
                  return (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-[12.5px]">
                      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" />}
                      <span className="w-20 shrink-0 text-slate-500 sm:w-24">{relativeTime(a.at)}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{a.deviceName || "PC sin identificar"}</span>
                      <span className={`shrink-0 text-right ${ok ? "text-emerald-700" : "text-red-700"}`}>
                        {ok ? `Aceptado${a.rows != null ? ` · ${a.rows} lotes` : ""}` : a.resolvedAt ? "Bloqueado · ignorado" : "Bloqueado"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
          <button type="button" disabled={busy} onClick={onRegenerate} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className="h-4 w-4" /> Regenerar clave
          </button>
          <button type="button" disabled={busy} onClick={onRevoke} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-red-200 text-[12.5px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">
            <Trash2 className="h-4 w-4" /> Retirar clave
          </button>
        </footer>
      </aside>
    </div>,
    document.body
  );
};

const NewKeyModal: React.FC<{ row: SendKeyRow; secret: string; onCopy: () => void; onClose: () => void }> = ({ row, secret, onCopy, onClose }) =>
  createPortal(
    <div className="fixed inset-0 z-[200001] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="relative flex items-center justify-between overflow-hidden bg-gradient-to-r from-teal-700 to-cyan-600 px-5 py-5 sm:px-6">
          <KeyRound className="pointer-events-none absolute -bottom-6 right-14 h-24 w-24 text-white opacity-10" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white"><KeyRound className="h-5 w-5" /></span>
            <div>
              <h2 className="text-[17px] font-black text-white">Clave de envío generada</h2>
              <p className="text-[12.5px] text-teal-50">{row.name} · {row.code}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="relative rounded-lg p-1 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 overflow-y-auto p-5 sm:p-6">
          <div className="flex flex-col gap-3 rounded-2xl bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <span className="select-all break-all font-mono text-lg font-bold tracking-wider text-teal-300 sm:text-xl">{secret}</span>
            <button type="button" onClick={onCopy} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 text-[13px] font-black text-slate-900 hover:bg-teal-400">
              <Copy className="h-4 w-4" /> Copiar
            </button>
          </div>
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Se muestra <b>una sola vez</b>. Si se pierde, genera otra: la anterior deja de valer.</span>
          </div>
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Cómo configurarla</p>
            {[
              "Abre el Toolkit de escritorio en la PC del establecimiento.",
              "Ve a Sync SISMED y pega la clave en «Clave de envío».",
              "Inicia la sincronización. Esa PC queda vinculada en el primer envío.",
            ].map((step, i) => (
              <div key={step} className="flex items-start gap-3 py-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-black text-white">{i + 1}</span>
                <span className="text-[13.5px] text-slate-700">{step}</span>
              </div>
            ))}
          </div>
        </div>
        <footer className="flex justify-end border-t border-slate-100 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} className="h-11 rounded-xl bg-teal-600 px-6 text-[13px] font-black text-white hover:bg-teal-700">Listo</button>
        </footer>
      </div>
    </div>,
    document.body
  );
