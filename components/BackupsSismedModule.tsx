import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, Download, FolderDown, Gauge, History, Loader2, RefreshCw, Search, Wifi, WifiOff, X,
} from "lucide-react";
import { useBackupManager } from "../contexts/BackupManagerContext";
import { backupModuleApi, formatMegabytes } from "../services/backupConnection";
import {
  ActivityItem, ActivityKind, BackupActivityRow, BackupOverviewRow, BackupRowView, SHOW_FILTER_LABEL, ShowFilter,
  activityFromRequest, buildBackupRows, filterBackupRows, isActive, limaDay, planState, showFilterCounts, summarizeBackups, whoLabel,
} from "../services/backupModule";
import { relativeTime } from "../services/sendKeys";
import {
  ImmunizationEmptyState, ImmunizationKpiCard, ImmunizationKpiStrip, ImmunizationStatusChip, ImmunizationTableHeader, ImmunizationTone,
  immunizationFilterInputClass,
} from "./ui/immunization";
import { TablePagination } from "./ui/TablePagination";
import { ModuleHeaderPortal } from "./ui/ModuleHeaderSlot";
import { BackupConsumptionTab } from "./BackupConsumptionTab";

const PAGE_SIZE = 10;
const FILTERS: ShowFilter[] = ["all", "online", "ready", "today", "offline"];

const limaTime = (value: string) =>
  new Date(value).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });

/** «Hoy 10:31», «Ayer 17:40» o «Hace 14 días». */
const whenLabel = (value?: string | null, now = Date.now()) => {
  if (!value) return "Nunca";
  const day = limaDay(value);
  if (day === limaDay(now)) return `Hoy ${limaTime(value)}`;
  if (day === limaDay(now - 86400000)) return `Ayer ${limaTime(value)}`;
  const days = Math.max(2, Math.round((now - new Date(value).getTime()) / 86400000));
  return `Hace ${days} días`;
};

const chipFor = (row: BackupRowView): { label: string; tone: ImmunizationTone } | null => {
  const job = row.job;
  if (job) {
    if (job.phase === "requested") return { label: "Esperando PC", tone: "info" };
    if (job.phase === "uploading") return { label: "Subiendo", tone: "info" };
    if (job.phase === "downloading") return { label: "Descargando", tone: "info" };
    if (job.phase === "saving") return { label: "Guardando", tone: "info" };
    if (job.phase === "done") return { label: "Descargado", tone: "success" };
    if (job.phase === "failed" && job.failure === "error") return { label: "Falló", tone: "danger" };
    if (job.phase === "failed" && job.failure === "paused") return { label: "Pausado por consumo", tone: "danger" };
  }
  if (row.quotaUsed) return { label: "Cupo del día usado", tone: "warning" };
  return null;
};

const Bar: React.FC<{ value: number; total: number; label: string; tone?: "teal" | "emerald" }> = ({ value, total, label, tone = "teal" }) => {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="w-full max-w-[210px] space-y-1">
      <div className="flex justify-between text-[11.5px] text-slate-500"><span className="truncate">{label}</span><b className="font-mono text-slate-700">{pct}%</b></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${tone === "emerald" ? "bg-emerald-500" : "bg-teal-500"}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
};

const Detail: React.FC<{ row: BackupRowView; me: string | null }> = ({ row, me }) => {
  const job = row.job;
  if (job?.phase === "uploading" && job.size) return <Bar value={job.sent || 0} total={job.size} label={`La PC sube · ${formatMegabytes(job.size)}`} />;
  if (job?.phase === "downloading" && job.size) return <Bar value={job.received || 0} total={job.size} label={`Descargando · ${formatMegabytes(job.size)}`} tone="emerald" />;
  if (job?.phase === "requested" || job?.phase === "saving") {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />{job.phase === "saving" ? "Comprobando la huella…" : "Esperando a la PC…"}</span>;
  }
  if (job?.phase === "done") {
    return (
      <div className="min-w-0 text-[11.5px] text-slate-500">
        <div className="truncate font-mono text-slate-700">{job.savedName || job.name}</div>
        <div>{job.size ? `${formatMegabytes(job.size)} · ` : ""}huella verificada</div>
      </div>
    );
  }
  if (job?.phase === "failed" && job.failure !== "quota") return <p className="line-clamp-2 max-w-[260px] text-[11.5px] text-slate-500" title={job.detail}>{job.detail}</p>;
  if (row.quotaUsed) {
    return (
      <div className="text-[11.5px] text-slate-500">
        {row.downloadedToday && row.lastAt ? <div><b className="font-semibold text-slate-700">{whoLabel(row.lastBy, me)}</b> a las {limaTime(row.lastAt)}</div> : <div>Hay un pedido en curso</div>}
        <div>{row.today} de {row.limit} hoy · otro mañana</div>
      </div>
    );
  }
  return <span className="text-[12px] text-slate-400">{row.online ? "Listo para pedir" : "La PC debe estar encendida"}</span>;
};

const Signal: React.FC<{ row: BackupRowView; align?: "left" | "right" }> = ({ row, align = "left" }) => (
  <div className={align === "right" ? "text-right" : ""}>
    {row.online
      ? <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />En línea</span>
      : <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-400"><WifiOff className="h-3.5 w-3.5" />Desconectada</span>}
    <div className="text-[11px] text-slate-400">{row.online && row.lastSeen ? relativeTime(new Date(row.lastSeen).toISOString()) : "—"}</div>
  </div>
);

type Tab = "backups" | "consumo";

export const BackupsSismedModule: React.FC = () => {
  const manager = useBackupManager();
  const [tab, setTab] = useState<Tab>("backups");
  const [overview, setOverview] = useState<BackupOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ShowFilter>("all");
  const [page, setPage] = useState(1);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<BackupActivityRow[]>([]);

  useEffect(() => manager.attach(), [manager.attach]);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const [rows, today] = await Promise.all([backupModuleApi.overview(), backupModuleApi.activity()]);
      setOverview(rows.map((r: any) => ({ ...r, today: Number(r.today) || 0, limit: Number(r.limit) || 1 })));
      setActivity(today);
    } catch (error: any) {
      setLoadError(error?.message || "No se pudo cargar la lista de establecimientos.");
    } finally {
      setLoading(false);
    }
  }, []);

  // También cuando termina un pedido (descargado, fallido o rechazado).
  useEffect(() => { void load(); }, [load, manager.version]);

  const paused = manager.usage?.level === "paused";
  const rows = useMemo(() => buildBackupRows(overview, manager.online, manager.jobs, paused), [overview, manager.online, manager.jobs, paused]);
  const summary = useMemo(() => summarizeBackups(rows), [rows]);
  const counts = useMemo(() => showFilterCounts(rows), [rows]);
  const filtered = useMemo(() => filterBackupRows(rows, search, filter), [rows, search, filter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, filter]);

  const activityItems = useMemo(
    () => [...activity.map((a) => activityFromRequest(a, manager.username)), ...manager.events].sort((a, b) => b.at - a.at),
    [activity, manager.events, manager.username],
  );
  const plan = planState(manager.usage);
  const onlineCount = rows.filter((r) => r.online).length;

  const refresh = () => {
    manager.refresh();
    void load();
  };

  const action = (row: BackupRowView, full = false) => (
    <button
      type="button"
      disabled={!row.canDownload}
      onClick={() => manager.request(row.code)}
      className={`inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-teal-600 px-3.5 text-xs font-bold text-white hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 ${full ? "w-full" : ""}`}
    >
      {isActive(row.job) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar
    </button>
  );

  return (
    <div className="space-y-4 pb-24">
      <ModuleHeaderPortal>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-bold sm:px-3 ${
            manager.status === "open" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : manager.status === "connecting" ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-red-200 bg-red-50 text-red-700"
          }`}>
            {manager.status === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className={`h-2 w-2 rounded-full ${manager.status === "open" ? "bg-emerald-500" : "bg-red-500"}`} />}
            {manager.status === "open"
              ? <><span className="hidden sm:inline">Conectado · {onlineCount === 1 ? "1 PC en línea" : `${onlineCount} PC en línea`}</span><span className="sm:hidden">{onlineCount} PC</span></>
              : manager.status === "connecting" ? <span>Conectando…</span> : <span>Sin conexión</span>}
          </span>
          <button type="button" aria-label="Actualizar" onClick={refresh} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </ModuleHeaderPortal>

      {manager.isAdmin && (
        <div className="flex">
          <div className="flex min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-1 sm:inline-flex sm:flex-none" role="tablist">
            {([["backups", "Backups", FolderDown], ["consumo", "Consumo", Gauge]] as const).map(([id, label, Icon]) => (
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
        </div>
      )}

      {tab === "consumo" && manager.isAdmin ? <BackupConsumptionTab /> : (
        <>
          <ImmunizationKpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
            <ImmunizationKpiCard watermark tone="info" icon={<Wifi />} label="PC en línea ahora" value={`${summary.online} / ${summary.total}`} hint={summary.total - summary.online ? `${summary.total - summary.online} desconectadas` : "todas conectadas"} onClick={() => setFilter(filter === "online" ? "all" : "online")} active={filter === "online"} />
            <ImmunizationKpiCard watermark tone="success" icon={<CheckCircle2 />} label="Descargados hoy" value={summary.downloadedToday} hint={`de ${summary.total} establecimientos`} onClick={() => setFilter(filter === "today" ? "all" : "today")} active={filter === "today"} />
            <ImmunizationKpiCard watermark tone="neutral" icon={<History />} label="Sin backup en 7 días" value={summary.stale} hint={summary.stale ? "pídalos esta semana" : "todos al día"} />
            <ImmunizationKpiCard watermark tone={plan.tone} icon={<Gauge />} label="Plan gratuito" value={plan.value} progress={plan.ratio} progressMarks={[0.7, 0.8]} hint={plan.hint} />
          </ImmunizationKpiStrip>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:px-4">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar establecimiento, código o PC" className={`${immunizationFilterInputClass} pl-9`} />
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <select value={filter} onChange={(e) => setFilter(e.target.value as ShowFilter)} aria-label="Mostrar" className={`${immunizationFilterInputClass} flex-1 sm:w-56 sm:flex-none`}>
                  {FILTERS.map((f) => <option key={f} value={f}>{f === "all" ? "Mostrar: todos" : SHOW_FILTER_LABEL[f]} ({counts[f]})</option>)}
                </select>
                <button type="button" onClick={() => setActivityOpen(true)} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <Activity className="h-4 w-4" />Actividad
                  {activityItems.length > 0 && <span className="rounded-full bg-teal-600 px-1.5 text-[10.5px] text-white">{activityItems.length}</span>}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex h-48 items-center justify-center gap-2 text-sm font-semibold text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-teal-600" /> Cargando establecimientos…</div>
            ) : loadError ? (
              <ImmunizationEmptyState
                icon={<AlertTriangle className="h-6 w-6" />}
                title="No se pudo cargar la lista"
                description={loadError}
                action={<button type="button" onClick={() => { setLoading(true); void load(); }} className="h-10 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white">Reintentar</button>}
              />
            ) : filtered.length === 0 ? (
              <ImmunizationEmptyState
                icon={<FolderDown className="h-6 w-6" />}
                title={rows.length === 0 ? "Ningún establecimiento puede enviar backup todavía" : "Ningún establecimiento coincide"}
                description={rows.length === 0 ? "Aparecen aquí los establecimientos de su jurisdicción con clave de envío y habilitados para backups." : "Pruebe con otra búsqueda o filtro."}
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <ImmunizationTableHeader>Establecimiento</ImmunizationTableHeader>
                        <ImmunizationTableHeader>Equipo</ImmunizationTableHeader>
                        <ImmunizationTableHeader>Señal</ImmunizationTableHeader>
                        <ImmunizationTableHeader>Estado</ImmunizationTableHeader>
                        <ImmunizationTableHeader>Backup</ImmunizationTableHeader>
                        <ImmunizationTableHeader>Último descargado</ImmunizationTableHeader>
                        <ImmunizationTableHeader align="right"><span className="sr-only">Acciones</span></ImmunizationTableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pageRows.map((row) => {
                        const chip = chipFor(row);
                        return (
                          <tr key={row.code} className={`h-[60px] ${row.online ? "" : "bg-slate-50/50"}`}>
                            <td className="px-4 py-2">
                              <div className="font-bold text-slate-800">{row.name}</div>
                              <span className="font-mono text-[11px] text-teal-700">{row.code}</span>
                            </td>
                            <td className="px-4 py-2">
                              {row.equipo ? <><div className="font-semibold text-slate-700">{row.equipo}</div><div className="font-mono text-[11px] text-slate-400">Toolkit v{row.version || "?"}</div></> : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-2"><Signal row={row} /></td>
                            <td className="px-4 py-2">{chip ? <ImmunizationStatusChip label={chip.label} tone={chip.tone} /> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-4 py-2"><Detail row={row} me={manager.username} /></td>
                            <td className="px-4 py-2 text-[12px] text-slate-500">
                              {whenLabel(row.lastAt)}{row.lastBy ? ` · ${whoLabel(row.lastBy, manager.username)}` : ""}
                            </td>
                            <td className="px-4 py-2 text-right">{action(row)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 p-3 md:hidden">
                  {pageRows.map((row) => {
                    const chip = chipFor(row);
                    return (
                      <div key={row.code} className={`space-y-2.5 rounded-2xl border border-slate-200 p-3 text-[13px] ${row.online ? "bg-white" : "bg-slate-50/60"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-black text-slate-800">{row.name}</div>
                            <span className="font-mono text-[11px] text-teal-700">{row.code}</span>
                          </div>
                          {chip ? <ImmunizationStatusChip label={chip.label} tone={chip.tone} /> : <Signal row={row} align="right" />}
                        </div>
                        <Detail row={row} me={manager.username} />
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[11.5px] text-slate-500">Último: {whenLabel(row.lastAt)}{row.lastBy ? ` · ${whoLabel(row.lastBy, manager.username)}` : ""}</span>
                          {action(row)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <TablePagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="establecimientos" />
              </>
            )}
          </div>
        </>
      )}

      {activityOpen && <ActivityDrawer items={activityItems} onClose={() => setActivityOpen(false)} />}
    </div>
  );
};

const KIND_FILTERS: Array<{ id: "all" | ActivityKind; label: string }> = [
  { id: "all", label: "Todo" },
  { id: "download", label: "Descargas" },
  { id: "warning", label: "Avisos" },
  { id: "connection", label: "Conexiones" },
];

/** Lo que pasó hoy: pedidos del registro (de todos en su jurisdicción) y conexiones de esta sesión. */
const ActivityDrawer: React.FC<{ items: ActivityItem[]; onClose: () => void }> = ({ items, onClose }) => {
  const [kind, setKind] = useState<"all" | ActivityKind>("all");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);

  return createPortal(
    <div className="fixed inset-0 z-[200000] flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Activity className="h-5 w-5 text-slate-400" />
          <div>
            <p className="text-[15px] font-black text-slate-800">Actividad</p>
            <p className="text-[11.5px] text-slate-400">Hoy · solo sus establecimientos</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-5 py-2.5">
          {KIND_FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setKind(f.id)} className={`shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-bold ${kind === f.id ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{f.label}</button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-slate-400">Sin actividad todavía.</p>
        ) : (
          <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
            {shown.map((item) => (
              <li key={item.key} className="flex items-start gap-3 px-5 py-3 text-[12.5px]">
                {item.tone === "ok" ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-500" />
                  : item.tone === "warn" ? <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-500" />
                    : <Clock3 className="mt-px h-4 w-4 shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1 text-slate-700">{item.text}</span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{new Date(item.at).toLocaleTimeString("es-PE", { hour12: false })}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>,
    document.body,
  );
};
