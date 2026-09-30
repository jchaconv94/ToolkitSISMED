import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowRightLeft, Download, MonitorSmartphone, CheckCircle2, ChevronRight, Clock, Copy, History, KeyRound,
  Loader2, Monitor, PlugZap, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldOff, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ATTEMPT_RESULT_LABEL, SEND_KEY_STATE_LABEL, SendAttempt, SendKeyFilter, SendKeyRow, SendKeyState,
  filterSendKeys, relativeTime, sendKeyState, sendKeysApi, summarizeSendKeys,
} from "../services/sendKeys";
import {
  ImmunizationEmptyState, ImmunizationKpiCard, ImmunizationTableHeader, formatImmunizationDate,
  immunizationFilterInputClass,
} from "./ui/immunization";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import { TablePagination } from "./ui/TablePagination";
import { AdminToolkitDevicesTab } from "./AdminToolkitDevicesTab";
import { AdminConnectionTestTab } from "./AdminConnectionTestTab";
import { useAuth } from "../contexts/AuthContext";

type ModuleTab = "keys" | "devices" | "connection";

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: React.ElementType }> = [
  { id: "keys", label: "Claves", icon: KeyRound },
  { id: "devices", label: "Equipos", icon: MonitorSmartphone },
];

/** Prueba de la conexión inmediata (Backups SISMED, etapa 1): solo el administrador. */
const CONNECTION_TAB = { id: "connection" as ModuleTab, label: "Conexión (prueba)", icon: PlugZap };

/** Claves de envío y, en otra pestaña, qué versión del Toolkit tiene cada PC. */
export const AdminSendKeysModule: React.FC = () => {
  const [tab, setTab] = useState<ModuleTab>("keys");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const { user } = useAuth();
  const tabs = user?.role === "ADMIN" ? [...MODULE_TABS, CONNECTION_TAB] : MODULE_TABS;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 sm:justify-between">
      <div className="flex min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-1 sm:inline-flex sm:flex-none" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-[12.5px] font-bold transition-colors sm:flex-none ${
              tab === id ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
        {tab === "devices" && latestVersion && (
          <div
            title={`Última versión publicada del Toolkit: ${latestVersion}`}
            className="hidden h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 text-xs text-teal-800 sm:flex"
          >
            <Download className="h-4 w-4" />
            Última versión publicada: <b>{latestVersion}</b>
          </div>
        )}
      </div>
      {tab === "keys" && <SendKeysPanel />}
      {tab === "devices" && <AdminToolkitDevicesTab onLatestVersion={setLatestVersion} />}
      {tab === "connection" && user?.role === "ADMIN" && <AdminConnectionTestTab />}
    </div>
  );
};

const PAGE_SIZE = 10;

const STATE_STYLE: Record<SendKeyState, { chip: string; icon: React.ElementType; bar: string; tile: string; text: string }> = {
  blocked: { chip: "border-red-200 bg-red-50 text-red-700", icon: ShieldAlert, bar: "bg-red-500", tile: "bg-red-100 text-red-700", text: "text-red-700" },
  protected: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: ShieldCheck, bar: "bg-emerald-500", tile: "bg-emerald-100 text-emerald-700", text: "text-emerald-700" },
  waiting: { chip: "border-amber-200 bg-amber-50 text-amber-700", icon: Clock, bar: "bg-amber-500", tile: "bg-amber-100 text-amber-700", text: "text-amber-700" },
  none: { chip: "border-slate-200 bg-slate-100 text-slate-600", icon: ShieldOff, bar: "bg-slate-400", tile: "bg-slate-100 text-slate-500", text: "text-slate-600" },
};

const FILTERS: Array<{ id: SendKeyFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "protected", label: "Protegidos" },
  { id: "alerts", label: "Con alertas" },
  { id: "none", label: "Sin clave" },
];

const StateChip: React.FC<{ state: SendKeyState; small?: boolean }> = ({ state, small }) => {
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border font-bold ${style.chip} ${small ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]"}`}>
      <Icon className={small ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {SEND_KEY_STATE_LABEL[state]}
    </span>
  );
};

type PendingAction =
  | { kind: "regenerate"; row: SendKeyRow }
  | { kind: "revoke"; row: SendKeyRow }
  | { kind: "rebind"; row: SendKeyRow };

const SendKeysPanel: React.FC = () => {
  const [rows, setRows] = useState<SendKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SendKeyFilter>("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [history, setHistory] = useState<SendAttempt[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [newKey, setNewKey] = useState<{ row: SendKeyRow; key: string } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      setRows(await sendKeysApi.overview());
    } catch (error: any) {
      setLoadError(error?.message || "No se pudieron cargar las claves de envío.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  useEffect(() => {
    if (selected?.hasKey) void loadHistory(selected.code);
    else setHistory([]);
  }, [selected?.code, selected?.hasKey, loadHistory]);

  const summary = useMemo(() => summarizeSendKeys(rows), [rows]);
  const filtered = useMemo(() => filterSendKeys(rows, search, filter), [rows, search, filter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, filter]);

  // El aviso de arriba muestra el bloqueo más reciente; el resto se ve con «Con alertas».
  const alerts = useMemo(
    () => rows.filter((r) => r.alert).sort((a, b) => String(b.alert!.at).localeCompare(String(a.alert!.at))),
    [rows]
  );
  const topAlert = alerts[0] || null;
  const showUnget = useMemo(() => new Set(rows.map((r) => r.ungetId || "")).size > 1, [rows]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
      if (selectedCode) void loadHistory(selectedCode);
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
      if (selectedCode === row.code) void loadHistory(row.code);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo generar la clave.");
    } finally {
      setBusy(false);
    }
  };

  const ignore = (row: SendKeyRow) => run(() => sendKeysApi.ignore(row.code), `Aviso de ${row.name} ignorado.`);

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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-teal-600" /> Cargando claves de envío…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
        <ImmunizationEmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="No se pudieron cargar las claves de envío"
          description={loadError}
          action={<button type="button" onClick={() => { setLoading(true); void load(); }} className="h-10 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white">Reintentar</button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ImmunizationKpiCard watermark tone="success" icon={<ShieldCheck />} label="Protegidos" value={`${summary.protectedCount} / ${summary.total}`} onClick={() => setFilter("protected")} active={filter === "protected"} />
        <ImmunizationKpiCard watermark tone="danger" icon={<ShieldAlert />} label="Intentos bloqueados hoy" value={summary.blockedToday} onClick={() => setFilter("alerts")} active={filter === "alerts"} />
        <ImmunizationKpiCard watermark tone="warning" icon={<Clock />} label="Esperando primer envío" value={summary.waiting} />
        <ImmunizationKpiCard watermark tone="neutral" icon={<ShieldOff />} label="Sin clave" value={summary.none} onClick={() => setFilter("none")} active={filter === "none"} />
      </div>

      {topAlert?.alert && (
        <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-3.5 sm:p-4 lg:flex-row lg:items-center">
          <div className="flex flex-1 gap-3 text-[13px] text-red-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <span>
              <b>{topAlert.alert.deviceName || "Una PC sin identificar"}</b> intentó enviar el stock de{" "}
              <b>{topAlert.name}</b> {relativeTime(topAlert.alert.at).toLowerCase()} y fue bloqueado
              {topAlert.deviceName ? <> · el establecimiento está vinculado a <b>{topAlert.deviceName}</b></> : null}.
              {alerts.length > 1 && (
                <button type="button" onClick={() => setFilter("alerts")} className="ml-1 font-bold underline underline-offset-2">
                  y {alerts.length - 1} aviso{alerts.length - 1 === 1 ? "" : "s"} más
                </button>
              )}
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2 lg:flex">
            <button type="button" disabled={busy} onClick={() => void ignore(topAlert)} className="h-9 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">
              Ignorar
            </button>
            <button type="button" disabled={busy} onClick={() => setPending({ kind: "rebind", row: topAlert })} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60">
              <ArrowRightLeft className="h-4 w-4" /> Cambiar a este equipo
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:px-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar establecimiento o código" className={`${immunizationFilterInputClass} pl-9`} />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors ${
                  filter === f.id ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <ImmunizationEmptyState
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
                    <ImmunizationTableHeader>Establecimiento</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Estado</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Equipo vinculado</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Último envío</ImmunizationTableHeader>
                    <ImmunizationTableHeader align="right"><span className="sr-only">Acciones</span></ImmunizationTableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((row) => {
                    const state = sendKeyState(row);
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
                          {row.deviceName
                            ? <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><Monitor className="h-4 w-4 text-slate-400" />{row.deviceName}</span>
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{row.hasKey ? relativeTime(row.lastOkAt) : "—"}</td>
                        <td className="px-4 py-2 text-right">
                          {state === "none" ? (
                            <button type="button" disabled={busy} onClick={() => void generate(row)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-60">
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

            {/* Móvil */}
            <div className="space-y-2 p-3 md:hidden">
              {pageRows.map((row) => {
                const state = sendKeyState(row);
                const style = STATE_STYLE[state];
                const Icon = style.icon;
                return (
                  <div key={row.code} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <span className={`absolute inset-y-0 left-0 w-1 ${style.bar}`} />
                    <button type="button" disabled={state === "none"} onClick={() => setSelectedCode(row.code)} className="flex w-full items-center gap-3 p-3 pl-4 text-left">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.tile}`}><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-black text-slate-800">{row.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="rounded bg-teal-50 px-1.5 font-mono text-[10.5px] font-bold text-teal-700">{row.code}</span>
                          <span className={`truncate text-[10.5px] font-bold ${style.text}`}>{SEND_KEY_STATE_LABEL[state]}</span>
                        </span>
                      </span>
                      {state !== "none" && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
                    </button>
                    {state === "none" ? (
                      <div className="px-3 pb-3 pl-4">
                        <button type="button" disabled={busy} onClick={() => void generate(row)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-teal-600 text-xs font-bold text-white disabled:opacity-60">
                          <KeyRound className="h-3.5 w-3.5" /> Generar clave
                        </button>
                      </div>
                    ) : (
                      <div className="mb-3 ml-4 mr-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
                        <span className="flex min-w-0 items-center gap-1"><Monitor className="h-3.5 w-3.5 shrink-0" />{row.deviceName ? <b className="truncate text-slate-700">{row.deviceName}</b> : "Sin equipo aún"}</span>
                        <span className="flex shrink-0 items-center gap-1"><Clock className="h-3 w-3" />{row.deviceName ? relativeTime(row.lastOkAt) : "Esperando envío"}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <TablePagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="establecimientos" />
          </>
        )}
      </div>

      {selected && selected.hasKey && (
        <DetailDrawer
          row={selected}
          history={history}
          historyLoading={historyLoading}
          busy={busy}
          onClose={() => setSelectedCode(null)}
          onIgnore={() => void ignore(selected)}
          onRebind={() => setPending({ kind: "rebind", row: selected })}
          onRegenerate={() => setPending({ kind: "regenerate", row: selected })}
          onRevoke={() => setPending({ kind: "revoke", row: selected })}
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

const DetailDrawer: React.FC<{
  row: SendKeyRow;
  history: SendAttempt[];
  historyLoading: boolean;
  busy: boolean;
  onClose: () => void;
  onIgnore: () => void;
  onRebind: () => void;
  onRegenerate: () => void;
  onRevoke: () => void;
}> = ({ row, history, historyLoading, busy, onClose, onIgnore, onRebind, onRegenerate, onRevoke }) => {
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
                Vinculado el {formatImmunizationDate(row.boundAt || undefined)}
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
