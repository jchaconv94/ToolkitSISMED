import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDropdownPosition } from "../hooks/useDropdownPosition";
import { AlertTriangle, CheckCircle2, CircleHelp, Clock, Database, Loader2, Monitor, MonitorSmartphone, Search } from "lucide-react";
import { relativeTime } from "../services/sendKeys";
import {
  DEVICE_STATE_LABEL, DeviceFilter, DeviceState, REPORT_WINDOW_DAYS, SismedFilter, SismedState, ToolkitDevice, ToolkitDeviceRow,
  activeDevices, compareVersions, deviceState, filterDevices, latestSismedVersion, sismedState, sismedVersionsInUse,
  summarizeDevices, toolkitDevicesApi,
} from "../services/toolkitDevices";
import {
  ImmunizationEmptyState, ImmunizationKpiCard, ImmunizationTableHeader, formatImmunizationDate, immunizationFilterInputClass,
} from "./ui/immunization";
import { TablePagination } from "./ui/TablePagination";

const PAGE_SIZE = 10;

const STYLE: Record<DeviceState, { chip: string; icon: React.ElementType; bar: string; tile: string; text: string }> = {
  current: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2, bar: "bg-emerald-500", tile: "bg-emerald-100 text-emerald-700", text: "text-emerald-700" },
  outdated: { chip: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle, bar: "bg-amber-500", tile: "bg-amber-100 text-amber-700", text: "text-amber-700" },
  none: { chip: "border-slate-200 bg-slate-100 text-slate-600", icon: CircleHelp, bar: "bg-slate-400", tile: "bg-slate-100 text-slate-500", text: "text-slate-600" },
};

const FILTERS: Array<{ id: DeviceFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "current", label: "Al día" },
  { id: "outdated", label: "Desactualizados" },
  { id: "none", label: "Sin reportar" },
];

const MOBILE_KPIS: Array<{ id: DeviceFilter; label: string; value: "reporting" | DeviceState; text: string; bar: string }> = [
  { id: "all", label: "Reportan", value: "reporting", text: "text-teal-700", bar: "bg-teal-500" },
  { id: "current", label: "Al día", value: "current", text: "text-emerald-700", bar: "bg-emerald-500" },
  { id: "outdated", label: "Desactualiz.", value: "outdated", text: "text-amber-700", bar: "bg-amber-500" },
  { id: "none", label: "Sin reportar", value: "none", text: "text-slate-700", bar: "bg-slate-400" },
];

const VersionChip: React.FC<{ version?: string | null; state: DeviceState; small?: boolean }> = ({ version, state, small }) =>
  version ? (
    <span className={`rounded-md font-mono font-bold ${small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs"} ${state === "outdated" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
      v{version}
    </span>
  ) : small ? null : <span className="text-slate-400">—</span>;

/** Versión del SISMED de una PC con la fecha de esa versión debajo. */
const SismedChip: React.FC<{ device?: ToolkitDevice; state: SismedState; small?: boolean }> = ({ device, state, small }) => {
  if (!device?.sismedVersion) {
    if (small) return null;
    return <span className="text-slate-400" title={device?.sismedRaw || undefined}>{device?.sismedRaw || "—"}</span>;
  }
  const chip = (
    <span className={`rounded-md font-mono font-bold ${small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs"} ${state === "outdated" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
      {small ? "SISMED " : ""}v{device.sismedVersion}
    </span>
  );
  if (small) return chip;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {chip}
      {device.sismedDate && <span className="text-[11px] text-slate-500">{formatImmunizationDate(device.sismedDate)}</span>}
    </span>
  );
};

const POPOVER_WIDTH = 280;

/**
 * Otras PC que enviaron el mismo establecimiento en los últimos 30 días. Al tocarlo muestra
 * cuáles son: sirve para descubrir una copia vieja del SISMED en otra máquina.
 */
const OtherPcs: React.FC<{ row: ToolkitDeviceRow; latest: string | null; latestSismed: string | null }> = ({ row, latest, latestSismed }) => {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuStyles } = useDropdownPosition(open, { align: "left", customWidth: POPOVER_WIDTH });
  const devices = activeDevices(row);
  if (devices.length < 2) return null;
  const others = devices.length - 1;

  return (
    <span ref={triggerRef} className="inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
      >
        +{others} PC
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
            <ul className="divide-y divide-slate-100">
              {devices.map((device, index) => {
                const outdated = Boolean(latest && device.version && compareVersions(device.version, latest) < 0);
                const sismedOutdated = Boolean(latestSismed && device.sismedVersion && compareVersions(device.sismedVersion, latestSismed) < 0);
                return (
                  <li key={`${device.deviceName}-${index}`} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Monitor className={`h-4 w-4 shrink-0 ${index === 0 ? "text-teal-600" : "text-slate-400"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-slate-800">{device.deviceName || "PC sin nombre"}</span>
                      <span className="block text-[11px] text-slate-500">
                        {index === 0 ? "La más reciente · " : ""}{relativeTime(device.lastSeen)}
                      </span>
                      {device.sismedVersion && (
                        <span className={`block text-[11px] font-semibold ${sismedOutdated ? "text-amber-700" : "text-slate-500"}`}>
                          SISMED v{device.sismedVersion}
                        </span>
                      )}
                    </span>
                    {device.version && (
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${outdated ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                        v{device.version}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>,
        document.body,
      )}
    </span>
  );
};

export const AdminToolkitDevicesTab: React.FC<{ onLatestVersion?: (version: string | null) => void }> = ({ onLatestVersion }) => {
  const [rows, setRows] = useState<ToolkitDeviceRow[]>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [sismedFilter, setSismedFilter] = useState<SismedFilter>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const [data, version] = await Promise.all([toolkitDevicesApi.overview(), toolkitDevicesApi.latestRelease()]);
      setRows(data);
      setLatest(version);
      onLatestVersion?.(version);
    } catch (error: any) {
      setLoadError(error?.message || "No se pudieron cargar los equipos.");
    } finally {
      setLoading(false);
    }
  }, [onLatestVersion]);

  useEffect(() => { void load(); }, [load]);

  const latestSismed = useMemo(() => latestSismedVersion(rows), [rows]);
  const sismedVersions = useMemo(() => sismedVersionsInUse(rows), [rows]);
  const summary = useMemo(() => summarizeDevices(rows, latest, undefined, latestSismed), [rows, latest, latestSismed]);
  const filtered = useMemo(
    () => filterDevices(rows, latest, search, filter, undefined, sismedFilter, latestSismed),
    [rows, latest, search, filter, sismedFilter, latestSismed],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, filter, sismedFilter]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-teal-600" /> Cargando equipos…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
        <ImmunizationEmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="No se pudieron cargar los equipos"
          description={loadError}
          action={<button type="button" onClick={() => { setLoading(true); void load(); }} className="h-10 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white">Reintentar</button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Celular: mosaico de una fila y franja del SISMED, para que la lista se vea sin desplazarse. */}
      <div className="space-y-2 md:hidden">
        <div className="grid grid-cols-4 gap-1.5">
          {MOBILE_KPIS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setFilter(k.id)}
              className={`relative overflow-hidden rounded-xl border bg-white px-1 py-2 text-center shadow-sm ${
                filter === k.id ? "border-teal-500 ring-2 ring-teal-500/20" : "border-slate-200"
              }`}
            >
              <span className={`absolute inset-x-0 top-0 h-0.5 ${k.bar}`} />
              <span className={`block text-xl font-black leading-tight ${k.text}`}>{summary[k.value]}</span>
              <span className="block text-[9.5px] font-black uppercase leading-tight tracking-tight text-slate-500">{k.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSismedFilter(sismedFilter === "outdated" ? "all" : "outdated")}
          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] ${
            sismedFilter === "outdated" ? "border-amber-400 bg-amber-100 ring-2 ring-amber-400/20" : "border-amber-200 bg-amber-50"
          }`}
        >
          <Database className="h-4 w-4 shrink-0 text-amber-600" />
          <b className="text-amber-800">{summary.sismedOutdated} SISMED desactualizado{summary.sismedOutdated === 1 ? "" : "s"}</b>
          <span className="ml-auto shrink-0 text-amber-700">{latestSismed ? `vigente v${latestSismed}` : "sin reportes"}</span>
        </button>
      </div>

      <div className="hidden gap-3 md:grid md:grid-cols-3 lg:grid-cols-5">
        <ImmunizationKpiCard watermark tone="info" icon={<MonitorSmartphone />} label="Equipos que reportan" value={summary.reporting} onClick={() => setFilter("all")} active={filter === "all"} />
        <ImmunizationKpiCard watermark tone="success" icon={<CheckCircle2 />} label="Al día" value={summary.current} onClick={() => setFilter("current")} active={filter === "current"} />
        <ImmunizationKpiCard watermark tone="warning" icon={<AlertTriangle />} label="Desactualizados" value={summary.outdated} onClick={() => setFilter("outdated")} active={filter === "outdated"} />
        <ImmunizationKpiCard watermark tone="neutral" icon={<CircleHelp />} label="Sin reportar" value={summary.none} onClick={() => setFilter("none")} active={filter === "none"} />
        <div className="flex [&>*]:w-full">
          <ImmunizationKpiCard
            watermark
            tone="warning"
            icon={<Database />}
            label="SISMED desactualizado"
            value={summary.sismedOutdated}
            hint={latestSismed ? `Vigente: v${latestSismed}` : "Aún sin reportes"}
            onClick={() => setSismedFilter(sismedFilter === "outdated" ? "all" : "outdated")}
            active={sismedFilter === "outdated"}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:px-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar establecimiento, código o PC" className={`${immunizationFilterInputClass} pl-9`} />
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
          <select
            value={sismedFilter}
            onChange={(e) => setSismedFilter(e.target.value as SismedFilter)}
            aria-label="Versión del SISMED"
            className={`${immunizationFilterInputClass} sm:ml-auto sm:w-52`}
          >
            <option value="all">SISMED: todas</option>
            <option value="outdated">SISMED desactualizado</option>
            {sismedVersions.map((v) => (
              <option key={v} value={`v:${v}`}>SISMED v{v}{v === latestSismed ? " (vigente)" : ""}</option>
            ))}
            <option value="none">SISMED sin dato</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <ImmunizationEmptyState
            icon={<MonitorSmartphone className="h-6 w-6" />}
            title={rows.length === 0 ? "No hay establecimientos en su jurisdicción" : "Ningún establecimiento coincide"}
            description={rows.length === 0 ? "Registre sus IPRESS y almacenes en Establecimientos." : "Pruebe con otra búsqueda o filtro."}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <ImmunizationTableHeader>Establecimiento</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Equipo</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Toolkit</ImmunizationTableHeader>
                    <ImmunizationTableHeader>SISMED</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Último reporte</ImmunizationTableHeader>
                    <ImmunizationTableHeader>Estado</ImmunizationTableHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((row) => {
                    const state = deviceState(row, latest);
                    const device = activeDevices(row)[0];
                    const style = STYLE[state];
                    const Icon = style.icon;
                    return (
                      <tr key={row.code} className="h-14 hover:bg-slate-50/60">
                        <td className="px-4 py-2">
                          <div className="font-bold text-slate-800">{row.name}</div>
                          <div className="font-mono text-[11px] text-teal-700">{row.code}</div>
                        </td>
                        <td className="px-4 py-2">
                          {device ? (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                              <Monitor className="h-4 w-4 text-slate-400" />{device.deviceName || "PC sin nombre"} <OtherPcs row={row} latest={latest} latestSismed={latestSismed} />
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-2"><VersionChip version={device?.version} state={state} /></td>
                        <td className="px-4 py-2"><SismedChip device={device} state={sismedState(row, latestSismed)} /></td>
                        <td className="px-4 py-2 text-slate-500">{device ? relativeTime(device.lastSeen) : "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${style.chip}`}>
                            <Icon className="h-3.5 w-3.5" />{DEVICE_STATE_LABEL[state]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-3 md:hidden">
              {pageRows.map((row) => {
                const state = deviceState(row, latest);
                const device = activeDevices(row)[0];
                const style = STYLE[state];
                const Icon = style.icon;
                return (
                  <div key={row.code} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <span className={`absolute inset-y-0 left-0 w-1 ${style.bar}`} />
                    <div className="flex items-center gap-3 p-3 pl-4">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.tile}`}><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-black text-slate-800">{row.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="rounded bg-teal-50 px-1.5 font-mono text-[10.5px] font-bold text-teal-700">{row.code}</span>
                          <span className={`truncate text-[10.5px] font-bold ${style.text}`}>{DEVICE_STATE_LABEL[state]}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <VersionChip version={device?.version} state={state} small />
                        <SismedChip device={device} state={sismedState(row, latestSismed)} small />
                      </span>
                    </div>
                    <div className="mb-3 ml-4 mr-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
                      <span className="flex min-w-0 items-center gap-1"><Monitor className="h-3.5 w-3.5 shrink-0" />{device ? <b className="truncate text-slate-700">{device.deviceName || "PC sin nombre"}</b> : "Sin datos"} <OtherPcs row={row} latest={latest} latestSismed={latestSismed} /></span>
                      <span className="flex shrink-0 items-center gap-1"><Clock className="h-3 w-3" />{device ? relativeTime(device.lastSeen) : "Nunca"}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <TablePagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="establecimientos" />
          </>
        )}
      </div>

      <p className="px-1 text-[11.5px] text-slate-500">
        «Sin reportar»: la PC tiene una versión anterior a la 2.1.10 o no ha sincronizado en los últimos {REPORT_WINDOW_DAYS} días.
        {" "}SISMED: la versión vigente es la más alta que reporta alguna PC; la informan los Toolkit posteriores a la 2.2.0.
      </p>
    </div>
  );
};
