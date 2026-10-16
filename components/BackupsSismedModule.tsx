import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, Download, FolderDown, Gauge, History, Loader2, RefreshCw, SlidersHorizontal, Wifi, WifiOff, X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useBackupManager } from "../contexts/BackupManagerContext";
import { backupModuleApi, formatMegabytes } from "../services/backupConnection";
import {
  ActivityItem, ActivityKind, BackupActivityRow, BackupOverviewRow, BackupRowView, SHOW_FILTER_LABEL, ShowFilter,
  activityFromRequest, buildBackupRows, copyLabel, lastConnectionLabel, filterBackupRows, isActive, jobProgress, jobSpeed, limaDay, planState, rowsOfUnget, showFilterCounts, summarizeBackups,
  ungetOptions, whoLabel, BACKUPS_TAB_EVENT, takeRequestedBackupsTab,
} from "../services/backupModule";
import { getUserJurisdictionScope } from "../services/jurisdictionService";
import { showsTerritory } from "../services/orgTabs";
import { relativeTime } from "../services/sendKeys";
import {
  EmptyState, KpiCard, KpiStrip, StatusChip, TableHeaderCell, TableSearch, Tone,
  useTableSort,
} from "./ui/kit";
import { TablePagination, usePageSize } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { BottomSheet } from "./ui/BottomSheet";
import { CustomSelect } from "./ui/CustomSelect";
import { stickyBarClass, useStickyBar } from "./ui/useStickyBar";
import { BackupDownloadAllModal, DownloadAllItem } from "./BackupDownloadAllModal";
import { FloatingActionButton } from "./ui/FloatingActionButton";
import { BackupConsumptionTab } from "./BackupConsumptionTab";

const DEFAULT_PAGE_SIZE = 10;
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

const chipFor = (row: BackupRowView): { label: string; tone: Tone } | null => {
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
  // Con copia, «Descargar» funciona aunque el cupo esté usado: el estado habla de la copia.
  if (row.copy) return { label: "Copia lista", tone: "success" };
  if (row.quotaUsed) return { label: "Cupo del día usado", tone: "warning" };
  return null;
};

/** Una sola barra para subida y descarga (`jobProgress`): no se llena dos veces. */
const Bar: React.FC<{ pct: number; label: string }> = ({ pct, label }) => (
  <div className="w-full max-w-[210px] space-y-1">
    <div className="flex justify-between text-[11.5px] text-slate-500"><span className="truncate">{label}</span><b className="font-mono text-slate-700">{pct}%</b></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} /></div>
  </div>
);

const Detail: React.FC<{ row: BackupRowView }> = ({ row }) => {
  const job = row.job;
  const pct = job ? jobProgress(job).pct : null;
  const speed = job ? jobSpeed(job) : null;
  const left = speed ? (speed.secondsLeft < 60 ? "falta < 1 min" : `faltan ~${Math.round(speed.secondsLeft / 60)} min`) : null;
  if (job?.phase === "uploading" && job.size) return <Bar pct={pct ?? 0} label={`1 de 2 · La PC sube · ${left || formatMegabytes(job.size)}`} />;
  if (job?.phase === "downloading" && job.size && job.copy) return <Bar pct={pct ?? 0} label={`Copia del día · ${left || formatMegabytes(job.size)}`} />;
  if (job?.phase === "downloading" && job.size) return <Bar pct={pct ?? 0} label={`2 de 2 · Descargando · ${left || formatMegabytes(job.size)}`} />;
  if (job?.phase === "requested" || job?.phase === "saving") {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />{job.phase === "saving" ? "Comprobando la huella…" : job.copy ? "Preparando la copia…" : "Esperando a la PC…"}</span>;
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
  if (row.copy) {
    return (
      <div className="text-[11.5px] text-slate-500">
        <div className="font-semibold text-emerald-700">{copyLabel(row.copy)}</div>
        <div>{formatMegabytes(row.copy.size)} · lista en la nube</div>
      </div>
    );
  }
  if (row.quotaUsed) {
    return (
      <div className="text-[11.5px] text-slate-500">
        <div><b className="font-semibold text-slate-700">Ya usó su cupo</b> · {row.mine ?? row.today} de {row.limit} hoy</div>
        <div>Podrá pedir otro mañana</div>
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
    <div className="text-[11px] text-slate-400">
      {row.lastSeen
        ? row.online ? relativeTime(new Date(row.lastSeen).toISOString()) : `Últ. conexión: ${lastConnectionLabel(row.lastSeen)}`
        : "—"}
    </div>
  </div>
);

type Tab = "backups" | "consumo";

export const BackupsSismedModule: React.FC = () => {
  const manager = useBackupManager();
  // La pestaña sale del rol de la sesión, no de lo que diga el servicio: así no aparece
  // ni desaparece al conectar. Los datos de Consumo los sigue protegiendo Supabase.
  const auth = useAuth();
  const isAdmin = auth.user?.role === "ADMIN";
  // Descargar gasta el cupo diario: se puede apagar por rol (Configuración de Roles).
  const canDownload = auth.can("ADMIN_BACKUPS", "download");
  // La campana de avisos puede pedir abrir directamente «Consumo».
  const [tab, setTab] = useState<Tab>(() => takeRequestedBackupsTab() || "backups");
  useEffect(() => {
    const open = () => { const requested = takeRequestedBackupsTab(); if (requested) setTab(requested); };
    window.addEventListener(BACKUPS_TAB_EVENT, open);
    return () => window.removeEventListener(BACKUPS_TAB_EVENT, open);
  }, []);
  const [overview, setOverview] = useState<BackupOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ShowFilter>("all");
  const [unget, setUnget] = useState("all");
  const [page, setPage] = useState(1);
  const [PAGE_SIZE, setPageSize] = usePageSize("backups", DEFAULT_PAGE_SIZE);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<BackupActivityRow[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchBar = useStickyBar<HTMLDivElement>();

  useEffect(() => manager.attach(), [manager.attach]);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const [rows, today] = await Promise.all([backupModuleApi.overview(), backupModuleApi.activity()]);
      setOverview(rows.map((r: any) => ({ ...r, today: Number(r.today) || 0, mine: r.mine == null ? undefined : Number(r.mine) || 0, limit: Number(r.limit) || 1 })));
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
  const rows = useMemo(
    () => buildBackupRows(overview, manager.online, manager.jobs, paused, Date.now(), manager.seen, manager.copies),
    [overview, manager.online, manager.jobs, paused, manager.seen, manager.copies],
  );
  // Filtro por UNGET para quien ve más de una (DIRESA, OGESS y el administrador; la misma
  // regla de Establecimientos). Con una sola UNGET a la vista no hay nada que elegir.
  const ungets = useMemo(() => ungetOptions(rows), [rows]);
  const showUngetFilter = showsTerritory(getUserJurisdictionScope(auth.user).level, "UNGET", isAdmin) && ungets.length > 1;
  const ungetFilter = showUngetFilter && ungets.some((u) => u.key === unget) ? unget : "all";
  const scopedRows = useMemo(() => rowsOfUnget(rows, ungetFilter), [rows, ungetFilter]);
  // Con todas las UNGET a la vista, cada fila dice de cuál es.
  const showUngetName = showUngetFilter && ungetFilter === "all";
  const summary = useMemo(() => summarizeBackups(scopedRows), [scopedRows]);
  const counts = useMemo(() => showFilterCounts(scopedRows), [scopedRows]);
  const filteredRows = useMemo(() => filterBackupRows(scopedRows, search, filter), [scopedRows, search, filter]);
  // Orden al tocar las cabeceras de la tabla (el mismo en el celular, aunque allí no hay cabeceras).
  const { sorted: filtered, sort, headSort } = useTableSort(filteredRows, {
    name: (r) => r.name,
    equipo: (r) => r.equipo,
    signal: (r) => (r.online ? Date.now() : r.lastSeen ?? null),
    estado: (r) => chipFor(r)?.label,
    lastAt: (r) => (r.lastAt ? new Date(r.lastAt).getTime() : null),
  }, { firstDir: { signal: "desc", lastAt: "desc" } });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // En el celular no hay páginas: la lista crece al bajar.
  const mobileList = useIncrementalCount(filtered.length, `${search}|${filter}|${ungetFilter}`, 20);
  const mobileRows = filtered.slice(0, mobileList.count);
  useEffect(() => { setPage(1); }, [search, filter, ungetFilter, sort]);

  const activityItems = useMemo(
    () => [...activity.map((a) => activityFromRequest(a, manager.username)), ...manager.events].sort((a, b) => b.at - a.at),
    [activity, manager.events, manager.username],
  );
  // El número de «Actividad» cuenta solo lo nuevo desde la última vez que se abrió.
  const seenKey = `backups-actividad-vista:${manager.username || ""}`;
  const [activitySeenAt, setActivitySeenAt] = useState(() => {
    try { return Number(localStorage.getItem(seenKey)) || 0; } catch { return 0; }
  });
  const unseenActivity = activityItems.filter((item) => item.at > activitySeenAt).length;
  const openActivity = () => {
    const now = Math.max(Date.now(), ...activityItems.map((item) => item.at));
    setActivitySeenAt(now);
    try { localStorage.setItem(seenKey, String(now)); } catch { /* sin almacenamiento: vuelve a contar en la próxima visita */ }
    setFiltersOpen(false);
    setActivityOpen(true);
  };
  const plan = planState(manager.usage);
  const onlineCount = rows.filter((r) => r.online).length;
  // «Descargar todos»: los en línea que hoy se pueden pedir, dentro de la UNGET elegida.
  const downloadable = useMemo(() => scopedRows.filter((r) => r.canDownload), [scopedRows]);
  const anyJobActive = Object.values(manager.jobs).some(isActive);
  const [confirmAll, setConfirmAll] = useState(false);
  const downloadAll = (items: DownloadAllItem[]) => {
    setConfirmAll(false);
    manager.requestMany(items.map((i) => ({ code: i.code, facility: i.name, copy: i.copy })));
  };

  const refresh = () => {
    manager.refresh();
    void load();
  };

  // Con copia del día, «Descargar» la baja de la nube (aunque la PC esté apagada) y
  // «Pedir uno nuevo» pide el backup de este momento a la PC, como siempre.
  const action = (row: BackupRowView, full = false) => !canDownload ? null : (
    <span className={`inline-flex items-center justify-end gap-1.5 ${full ? "w-full" : ""}`}>
      {row.copy && row.canRequestNew && (
        <button
          type="button"
          onClick={() => manager.request(row.code, row.name)}
          title="Pedir uno nuevo a la PC (usa el cupo del día)"
          aria-label="Pedir uno nuevo a la PC"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-teal-700"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        disabled={!row.canDownload}
        onClick={() => (row.copy ? manager.requestCopy(row.code, row.name) : manager.request(row.code, row.name))}
        title={row.copy ? `Bajar la ${copyLabel(row.copy).toLowerCase()} (no usa el cupo)` : undefined}
        className={`inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-teal-600 px-3.5 text-xs font-bold text-white hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 ${full ? "flex-1" : ""}`}
      >
        {isActive(row.job) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar
      </button>
    </span>
  );

  return (
    <div className="space-y-4 pb-24">
      {isAdmin && (
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

      {tab === "consumo" && isAdmin ? <BackupConsumptionTab /> : (
        <>
          <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
            <KpiCard watermark tone={manager.status === "closed" ? "danger" : "info"} icon={<Wifi />} label="PC en línea ahora" value={manager.status === "open" ? `${summary.online} / ${summary.total}` : "—"} hint={manager.status === "connecting" ? "conectando con el servicio…" : manager.status !== "open" ? "sin conexión con el servicio" : summary.total - summary.online ? `${summary.total - summary.online} desconectadas` : "todas conectadas"} onClick={() => setFilter(filter === "online" ? "all" : "online")} active={filter === "online"} />
            <KpiCard watermark tone="success" icon={<CheckCircle2 />} label="Descargados hoy" value={summary.downloadedToday} hint={`de ${summary.total} establecimientos`} onClick={() => setFilter(filter === "today" ? "all" : "today")} active={filter === "today"} />
            <KpiCard watermark tone="neutral" icon={<History />} label="Sin backup en 7 días" value={summary.stale} hint={summary.stale ? "pídalos esta semana" : "todos al día"} />
            <KpiCard watermark tone={plan.tone} icon={<Gauge />} label="Plan gratuito" value={plan.value} progress={plan.ratio} progressMarks={[0.7, 0.8]} hint={plan.hint} />
          </KpiStrip>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm md:overflow-hidden">
            <div ref={searchBar.ref} style={searchBar.style} className={`${stickyBarClass} flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-white p-3 sm:px-4 md:static`}>
              <TableSearch value={search} onChange={setSearch} placeholder="Buscar establecimiento, código o PC" />
              {/* Celular: un solo botón que abre los filtros abajo. */}
              <button type="button" onClick={() => setFiltersOpen(true)} aria-label="Filtros" className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 md:hidden">
                <SlidersHorizontal className="h-4 w-4" />
                {(filter !== "all" || ungetFilter !== "all" || unseenActivity > 0) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-2 ring-white" />}
              </button>
              <div className="ml-auto hidden gap-2 md:flex">
                {showUngetFilter && (
                  <CustomSelect
                    size="md" prefix="UNGET" ariaLabel="UNGET" containerClassName="w-56" searchable searchPlaceholder="Buscar UNGET…"
                    value={ungetFilter} onChange={setUnget}
                    options={[{ value: "all", label: "Todas", count: rows.length }, ...ungets.map((u) => ({ value: u.key, label: u.name, count: u.count }))]}
                  />
                )}
                <CustomSelect
                  size="md" prefix="Mostrar" ariaLabel="Mostrar" containerClassName="w-56"
                  value={filter} onChange={(v) => setFilter(v as ShowFilter)}
                  options={FILTERS.map((f) => ({ value: f, label: f === "all" ? "Todos" : SHOW_FILTER_LABEL[f], count: counts[f] }))}
                />
                <button type="button" onClick={refresh} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <RefreshCw className={`h-4 w-4 text-teal-600 ${manager.status === "connecting" ? "animate-spin" : ""}`} />Actualizar
                </button>
                <button type="button" onClick={openActivity} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <Activity className="h-4 w-4" />Actividad
                  {unseenActivity > 0 && <span className="rounded-full bg-teal-600 px-1.5 text-[10.5px] text-white">{unseenActivity}</span>}
                </button>
                {canDownload && (
                  <button
                    type="button"
                    disabled={downloadable.length === 0}
                    onClick={() => setConfirmAll(true)}
                    title={downloadable.length === 0 ? "No hay copias del día ni establecimientos en línea para descargar ahora" : undefined}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-bold text-white hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <Download className="h-4 w-4" />Descargar todos
                    {downloadable.length > 0 && <span className="rounded-full bg-white/20 px-1.5 text-[10.5px]">{downloadable.length}</span>}
                  </button>
                )}
              </div>
            </div>

            <BottomSheet open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
              {showUngetFilter && (
                <>
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">UNGET</p>
                  <div className="mb-4 space-y-1">
                    {[{ key: "all", name: "Todas", count: rows.length }, ...ungets].map((u) => (
                      <button key={u.key} type="button" onClick={() => { setUnget(u.key); setFiltersOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[14px] font-semibold ${ungetFilter === u.key ? "bg-teal-50 text-teal-800" : "text-slate-700 hover:bg-slate-50"}`}>
                        <span className="min-w-0 truncate">{u.name}</span>
                        <span className={`text-[12px] font-bold ${ungetFilter === u.key ? "text-teal-700" : "text-slate-400"}`}>{u.count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">Mostrar</p>
              <div className="space-y-1">
                {FILTERS.map((f) => (
                  <button key={f} type="button" onClick={() => { setFilter(f); setFiltersOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[14px] font-semibold ${filter === f ? "bg-teal-50 text-teal-800" : "text-slate-700 hover:bg-slate-50"}`}>
                    <span>{f === "all" ? "Todos" : SHOW_FILTER_LABEL[f]}</span>
                    <span className={`text-[12px] font-bold ${filter === f ? "text-teal-700" : "text-slate-400"}`}>{counts[f]}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => { refresh(); setFiltersOpen(false); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700">
                  <RefreshCw className="h-4 w-4 text-teal-600" />Actualizar
                </button>
                <button type="button" onClick={openActivity} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700">
                  <Activity className="h-4 w-4" />Actividad
                  {unseenActivity > 0 && <span className="rounded-full bg-teal-600 px-1.5 text-[10.5px] text-white">{unseenActivity}</span>}
                </button>
              </div>
            </BottomSheet>

            {loading ? (
              <div className="flex h-48 items-center justify-center gap-2 text-sm font-semibold text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-teal-600" /> Cargando establecimientos…</div>
            ) : loadError ? (
              <EmptyState
                icon={<AlertTriangle className="h-6 w-6" />}
                title="No se pudo cargar la lista"
                description={loadError}
                action={<button type="button" onClick={() => { setLoading(true); void load(); }} className="h-10 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white">Reintentar</button>}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
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
                        <TableHeaderCell sort={headSort("name")}>Establecimiento</TableHeaderCell>
                        <TableHeaderCell sort={headSort("equipo")}>Equipo</TableHeaderCell>
                        <TableHeaderCell sort={headSort("signal")}>Señal</TableHeaderCell>
                        <TableHeaderCell sort={headSort("estado")}>Estado</TableHeaderCell>
                        <TableHeaderCell>Backup</TableHeaderCell>
                        <TableHeaderCell sort={headSort("lastAt")}>Último descargado</TableHeaderCell>
                        <TableHeaderCell align="right"><span className="sr-only">Acciones</span></TableHeaderCell>
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
                              {showUngetName && row.ungetName && <span className="text-[11px] text-slate-400"> · {row.ungetName}</span>}
                            </td>
                            <td className="px-4 py-2">
                              {row.equipo ? <><div className={`font-semibold ${row.online ? "text-slate-700" : "text-slate-500"}`}>{row.equipo}</div><div className="font-mono text-[11px] text-slate-400">Toolkit v{row.version || "?"}</div></> : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-2"><Signal row={row} /></td>
                            <td className="px-4 py-2">{chip ? <StatusChip label={chip.label} tone={chip.tone} /> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-4 py-2"><Detail row={row} /></td>
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

                {/* Celular: tarjetas; la lista crece al bajar. */}
                <div className="space-y-2 p-3 md:hidden">
                  {mobileRows.map((row) => {
                    const chip = chipFor(row);
                    return (
                      <div key={row.code} className={`space-y-2.5 rounded-2xl border border-slate-200 p-3 text-[13px] ${row.online ? "bg-white" : "bg-slate-50/60"}`}>
                        {/* Pocos datos: código, nombre y la PC en segundo plano; el detalle solo con un pedido en curso. */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-mono text-[11px] text-teal-700">{row.code}</span>
                            {showUngetName && row.ungetName && <span className="text-[11px] text-slate-400"> · {row.ungetName}</span>}
                            <div className="truncate font-black text-slate-800">{row.name}</div>
                            {row.equipo && <div className="truncate text-[11.5px] text-slate-400">{row.equipo} · Toolkit v{row.version || "?"}</div>}
                            {!row.online && row.lastSeen && <div className="truncate text-[11.5px] text-slate-400">Últ. conexión: {lastConnectionLabel(row.lastSeen)}</div>}
                          </div>
                          {chip ? <StatusChip label={chip.label} tone={chip.tone} /> : row.online
                            ? <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />En línea</span>
                            : <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-slate-400"><WifiOff className="h-3.5 w-3.5" />Desconectada</span>}
                        </div>
                        {(row.job || row.copy) && <Detail row={row} />}
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[11.5px] text-slate-500">Último: {whenLabel(row.lastAt)}{row.lastBy ? ` · ${whoLabel(row.lastBy, manager.username)}` : ""}</span>
                          {action(row)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="md:hidden">
                  <LoadMoreSentinel hasMore={mobileList.hasMore} onLoadMore={mobileList.loadMore} shown={mobileList.count} total={filtered.length} itemLabel="establecimientos" />
                </div>

                <div className="hidden md:block">
                  <TablePagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="establecimientos" />
                </div>
              </>
            )}
          </div>
        </>
      )}

      {activityOpen && <ActivityDrawer items={activityItems} onClose={() => setActivityOpen(false)} />}

      {tab === "backups" && canDownload && downloadable.length > 0 && !anyJobActive && (
        <FloatingActionButton icon={<Download />} label={`Descargar todos (${downloadable.length})`} onClick={() => setConfirmAll(true)} />
      )}
      {confirmAll && (
        <BackupDownloadAllModal
          items={downloadable.map((r) => ({
            code: r.code, name: r.name, ungetName: showUngetName ? r.ungetName || undefined : undefined,
            copy: Boolean(r.copy), hint: r.copy ? copyLabel(r.copy) : "Se pide a la PC",
          }))}
          onClose={() => setConfirmAll(false)}
          onDownload={downloadAll}
        />
      )}
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
