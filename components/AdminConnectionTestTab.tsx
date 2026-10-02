import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, CloudUpload, Download, Gauge, Loader2, Monitor, Plug, PlugZap,
  RefreshCw, Send, Server, Timer,
} from "lucide-react";
import { relativeTime } from "../services/sendKeys";
import {
  BackupQuota, OnlinePc, UsageItem, UsageReading, applyPresence, connectionUrl, formatMegabytes, parseServerMessage, sha256Hex,
} from "../services/backupConnection";
import { ImmunizationEmptyState, ImmunizationKpiCard, ImmunizationStatusChip, ImmunizationTableHeader, ImmunizationTone } from "./ui/immunization";

type Status = "connecting" | "open" | "closed";

interface BackupState {
  job?: string;
  phase: "requested" | "uploading" | "downloading" | "done" | "failed";
  /** Por qué falló: el cupo del día, la pausa por consumo u otro motivo. */
  failure?: "quota" | "paused" | "error";
  name?: string;
  size?: number;
  sent?: number;
  detail?: string;
  quota?: BackupQuota;
}

interface LogLine {
  at: number;
  text: string;
  tone: "ok" | "warn" | "info";
}

const limaTime = (at: string) =>
  new Date(at).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Pestaña de prueba de Backups SISMED. Solo la ve el administrador. Muestra el consumo del
 * plan gratuito, las PC del piloto conectadas en tiempo real y permite pedirles el backup.
 */
export const AdminConnectionTestTab: React.FC = () => {
  const [status, setStatus] = useState<Status>("connecting");
  const [rows, setRows] = useState<OnlinePc[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [backups, setBackups] = useState<Record<string, BackupState>>({});
  const [usage, setUsage] = useState<UsageReading | null>(null);
  const setBackup = (code: string, patch: Partial<BackupState>) =>
    setBackups((prev) => ({ ...prev, [code]: { ...(prev[code] || { phase: "requested" }), ...patch } as BackupState }));
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | undefined>(undefined);

  const addLog = (text: string, tone: LogLine["tone"] = "info") =>
    setLog((prev) => [{ at: Date.now(), text, tone }, ...prev].slice(0, 50));

  const connect = useCallback(() => {
    const url = connectionUrl();
    if (!url) {
      setStatus("closed");
      addLog("No hay sesión iniciada.", "warn");
      return;
    }
    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus("open");
      addLog("Conectado al servicio de conexión inmediata.", "ok");
    };
    ws.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.t === "list") setRows(message.rows);
      if (message.t === "usage") setUsage(message.usage);
      if (message.t === "presence") {
        addLog(`${message.codes.join(", ")} ${message.online ? "se conectó" : "se desconectó"}${message.equipo ? ` (${message.equipo})` : ""}.`, message.online ? "info" : "warn");
        setRows((prev) => applyPresence(prev, message));
        if (message.online) ws.send(JSON.stringify({ t: "list" }));
      }
      if (message.t === "backup_requested") {
        setBackup(message.code, { job: message.job, phase: "requested", failure: undefined, quota: message.quota, detail: "Esperando a la PC…" });
        addLog(`${message.code} · pedido aceptado${message.quota ? ` (${message.quota.used} de ${message.quota.limit} hoy)` : ""}.`);
      }
      if (message.t === "backup_meta") {
        setBackup(message.code, { phase: "uploading", name: message.name, size: message.size, sent: 0, detail: undefined });
        addLog(`${message.code} · la PC envía ${message.name} (${formatMegabytes(message.size)}).`);
      }
      if (message.t === "backup_progress") setBackup(message.code, { sent: message.sent });
      if (message.t === "backup_failed") {
        const failure = message.quota ? "quota" : message.usage ? "paused" : "error";
        setBackup(message.code, { phase: "failed", failure, quota: message.quota, detail: message.reason });
        if (message.usage) setUsage(message.usage);
        addLog(`${message.code} · ${message.reason}`, "warn");
      }
      if (message.t === "backup_ready") void downloadBackup(ws, message);
      if (message.t === "ping_result") {
        setPending((prev) => {
          const next = { ...prev };
          delete next[message.id];
          return next;
        });
        addLog(message.ok
          ? `${message.code} · aviso respondido en ${message.rtt} ms${message.equipo ? ` por ${message.equipo}` : ""}.`
          : `${message.code} · aviso no entregado: ${message.reason || "sin respuesta"}.`, message.ok ? "ok" : "warn");
      }
    };
    ws.onclose = () => {
      setStatus("closed");
      wsRef.current = null;
      retryRef.current = window.setTimeout(connect, 5000);
    };
  }, []);

  /** Descarga, comprueba la huella y guarda. Solo entonces le dice al servicio que lo borre. */
  const downloadBackup = async (ws: WebSocket, ready: { job: string; code: string; name: string; size: number; sha256: string; downloadUrl: string }) => {
    setBackup(ready.code, { phase: "downloading", detail: "Comprobando la huella…" });
    try {
      const response = await fetch(ready.downloadUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      const hash = await sha256Hex(data);
      if (data.byteLength !== ready.size || hash !== ready.sha256) throw new Error("la huella no coincide: el archivo llegó dañado");
      const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = ready.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      ws.send(JSON.stringify({ t: "backup_done", job: ready.job }));
      setBackup(ready.code, { phase: "done", name: ready.name, size: ready.size, detail: undefined });
      addLog(`${ready.code} · ${ready.name} descargado y verificado; borrado de la nube.`, "ok");
    } catch (error) {
      setBackup(ready.code, { phase: "failed", failure: "error", detail: `La descarga falló: ${String((error as Error).message || error)}` });
      addLog(`${ready.code} · la descarga falló: ${String((error as Error).message || error)}`, "warn");
    }
  };

  const send = (message: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const requestBackup = (code: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    setBackup(code, { job: undefined, phase: "requested", failure: undefined, name: undefined, size: undefined, sent: 0, detail: "Pidiendo…" });
    send({ t: "backup_request", code });
  };

  useEffect(() => {
    connect();
    // Refresca la lista cada 30 s para detectar PC que se quedaron sin señal.
    const refresh = window.setInterval(() => send({ t: "list" }), 30000);
    return () => {
      window.clearInterval(refresh);
      window.clearTimeout(retryRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [connect]);

  const sendPing = (code: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const id = `${code}-${Date.now()}`;
    setPending((prev) => ({ ...prev, [id]: Date.now() }));
    send({ t: "ping", id, code });
    window.setTimeout(() => setPending((prev) => {
      if (!(id in prev)) return prev;
      addLog(`${code} · aviso sin respuesta en 30 s.`, "warn");
      const next = { ...prev };
      delete next[id];
      return next;
    }), 30000);
  };

  const busy = (code: string) => Object.keys(pending).some((id) => id.startsWith(`${code}-`));
  const canRequest = (code: string) => {
    const state = backups[code];
    if (status !== "open") return false;
    if (state && ["requested", "uploading", "downloading"].includes(state.phase)) return false;
    return !(state?.phase === "failed" && state.failure === "quota");
  };

  const actions = (row: OnlinePc) => (
    <div className="inline-flex gap-2">
      <button
        type="button"
        title="Enviar aviso de prueba"
        aria-label="Enviar aviso de prueba"
        disabled={busy(row.code) || status !== "open"}
        onClick={() => sendPing(row.code)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy(row.code) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
      <button
        type="button"
        disabled={!canRequest(row.code)}
        onClick={() => requestBackup(row.code)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-xs font-bold text-white hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <Download className="h-4 w-4" /> Pedir backup
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${
          status === "open" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : status === "connecting" ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {status === "open" ? <PlugZap className="h-4 w-4" /> : status === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          {status === "open" ? "Servicio conectado" : status === "connecting" ? "Conectando…" : "Sin conexión · reintentando"}
        </span>
        <span className="text-[13px] font-semibold text-slate-700">{rows.length === 1 ? "1 PC en línea" : `${rows.length} PC en línea`}</span>
        <span className="hidden text-[12px] text-slate-400 sm:inline">Prueba de Backups SISMED · solo administrador</span>
        <button type="button" aria-label="Actualizar" onClick={() => send({ t: "list" })} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {usage && <UsageTiles reading={usage} onRefresh={() => send({ t: "usage" })} />}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <ImmunizationEmptyState icon={<Monitor className="h-6 w-6" />} title="Ninguna PC conectada" description="Cuando el Toolkit de una PC del piloto se conecte, aparecerá aquí al instante." />
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50">
                <tr>
                  <ImmunizationTableHeader>Establecimiento</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Equipo</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Señal</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Estado</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Backup</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="right">Acciones</ImmunizationTableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.code} className="h-[60px]">
                    <td className="px-4 py-2"><Facility row={row} /></td>
                    <td className="px-4 py-2"><Equipment row={row} /></td>
                    <td className="px-4 py-2"><Signal row={row} /></td>
                    <td className="px-4 py-2"><BackupChip state={backups[row.code]} /></td>
                    <td className="px-4 py-2"><BackupDetail state={backups[row.code]} /></td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">{actions(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <div key={row.code} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-[13px] shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <Facility row={row} />
                  <BackupChip state={backups[row.code]} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Equipment row={row} />
                  <Signal row={row} />
                </div>
                {backups[row.code] && <BackupDetail state={backups[row.code]} />}
                <div className="flex justify-end">{actions(row)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3">
          <Activity className="h-4 w-4 text-slate-400" />
          <span className="text-[13px] font-black text-slate-700">Actividad</span>
          <span className="text-[11px] text-slate-400">{log.length === 1 ? "1 evento" : `${log.length} eventos`}</span>
        </div>
        {log.length === 0 ? (
          <p className="border-t border-slate-100 px-4 py-3 text-[12.5px] text-slate-400">Sin eventos todavía.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
            {log.map((line) => (
              <li key={`${line.at}-${line.text}`} className="flex items-start gap-3 px-4 py-2 text-[12.5px]">
                {line.tone === "ok" ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-500" />
                  : line.tone === "warn" ? <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-500" />
                    : <Clock3 className="mt-px h-4 w-4 shrink-0 text-slate-400" />}
                <span className="w-16 shrink-0 font-mono text-[11.5px] leading-5 text-slate-400">{new Date(line.at).toLocaleTimeString("es-PE", { hour12: false })}</span>
                <span className="min-w-0 text-slate-700">{line.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const Facility: React.FC<{ row: OnlinePc }> = ({ row }) => (
  <div className="min-w-0">
    <div className="font-bold text-slate-800">{row.name}</div>
    <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-teal-700">{row.code}</span>
  </div>
);

const Equipment: React.FC<{ row: OnlinePc }> = ({ row }) => (
  <div className="min-w-0">
    <div className="truncate font-semibold text-slate-700">{row.equipo || "PC sin nombre"}</div>
    <div className="font-mono text-[11px] text-slate-400">Toolkit v{row.version || "?"}</div>
  </div>
);

const Signal: React.FC<{ row: OnlinePc }> = ({ row }) => (
  <div className="text-right md:text-left">
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />En línea</span>
    <div className="text-[11px] text-slate-400" title={`Conectada ${relativeTime(new Date(row.since).toISOString()).toLowerCase()}`}>
      {relativeTime(new Date(row.lastSeen).toISOString())}
    </div>
  </div>
);

const chipFor = (state: BackupState): { label: string; tone: ImmunizationTone } => {
  if (state.phase === "done") return { label: "Descargado", tone: "success" };
  if (state.phase === "failed") {
    if (state.failure === "quota") return { label: "Cupo del día usado", tone: "warning" };
    if (state.failure === "paused") return { label: "Pausado por consumo", tone: "danger" };
    return { label: "Falló", tone: "danger" };
  }
  if (state.phase === "uploading") return { label: "Subiendo", tone: "info" };
  if (state.phase === "downloading") return { label: "Descargando", tone: "info" };
  return { label: "Esperando PC", tone: "info" };
};

const BackupChip: React.FC<{ state?: BackupState }> = ({ state }) => {
  if (!state) return <span className="text-slate-300">—</span>;
  const chip = chipFor(state);
  return <span className="shrink-0"><ImmunizationStatusChip label={chip.label} tone={chip.tone} /></span>;
};

const BackupDetail: React.FC<{ state?: BackupState }> = ({ state }) => {
  if (!state) return <span className="text-[12px] text-slate-400">Sin pedir</span>;
  if (state.phase === "uploading") {
    const pct = state.size ? Math.round(((state.sent || 0) / state.size) * 100) : 0;
    return (
      <div className="w-full max-w-[220px] space-y-1">
        <div className="flex justify-between text-[11.5px] text-slate-500">
          <span className="truncate font-mono">{state.size ? formatMegabytes(state.size) : ""}</span>
          <span className="font-mono font-bold text-slate-700">{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }
  if (state.phase === "done") {
    return (
      <div className="min-w-0 text-[11.5px] text-slate-500">
        <div className="truncate font-mono text-slate-700">{state.name}</div>
        <div>{state.size ? formatMegabytes(state.size) : ""} · huella verificada</div>
      </div>
    );
  }
  if (state.phase === "failed" && state.failure === "quota" && state.quota) {
    const last = state.quota.last;
    return (
      <div className="text-[11.5px] text-slate-500" title={state.detail}>
        {last ? <div><b className="font-semibold text-slate-700">{last.username}</b> a las {limaTime(last.at)}</div> : null}
        <div>{state.quota.used} de {state.quota.limit} hoy · otro mañana</div>
      </div>
    );
  }
  if (state.phase === "failed") {
    return <p className="line-clamp-2 max-w-[260px] text-[11.5px] text-slate-500" title={state.detail}>{state.detail}</p>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />{state.detail}
    </span>
  );
};

// --- Consumo del plan gratuito -----------------------------------------------------------

const toneOf = (ratio: number | null): ImmunizationTone => (ratio == null ? "neutral" : ratio >= 0.8 ? "danger" : ratio >= 0.7 ? "warning" : "info");
const number = (n: number) => n.toLocaleString("es-PE", { maximumFractionDigits: n < 100 ? 1 : 0 });
const percent = (ratio: number | null) => (ratio == null ? "—" : `${Math.round(ratio * 100)} %`);
const withState = (ratio: number | null, hint: string) =>
  ratio != null && ratio >= 0.8 ? `Pausado · ${hint}` : ratio != null && ratio >= 0.7 ? `Cerca del tope · ${hint}` : hint;

/** Cuatro indicadores: los tres límites diarios y R2 (el más alto de sus tres datos del mes). */
const UsageTiles: React.FC<{ reading: UsageReading; onRefresh: () => void }> = ({ reading, onRefresh }) => {
  const get = (key: string) => reading.items.find((i) => i.key === key);
  const of = (item?: UsageItem, unit = "") => (item?.used == null ? "sin dato" : `${number(item.used)} de ${number(item.limit)}${unit}`);
  const r2 = ["r2ClassA", "r2ClassB", "r2Storage"].map(get).filter((i): i is UsageItem => Boolean(i));
  const r2Ratio = r2.some((i) => i.ratio != null) ? Math.max(...r2.map((i) => i.ratio ?? 0)) : null;
  const r2Hint = r2.every((i) => i.used == null) ? "sin dato"
    : `escrituras ${number(get("r2ClassA")?.used ?? 0)} · lecturas ${number(get("r2ClassB")?.used ?? 0)} · ${number(get("r2Storage")?.used ?? 0)} GB`;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <Gauge className="h-4 w-4 text-slate-400" />
        <span className="text-[12px] font-black uppercase tracking-wider text-slate-500">Plan gratuito de Cloudflare</span>
        <span className="text-[11.5px] text-slate-400">· se pausa al 80 % · medido {new Date(reading.at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
        {reading.error && <span className="text-[11.5px] font-semibold text-amber-700" title={reading.error}>· sin medición completa</span>}
        <button type="button" onClick={onRefresh} className="ml-auto text-[12px] font-bold text-teal-700 hover:underline">Volver a medir</button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Conexiones hoy", icon: <PlugZap />, ratio: get("doRequests")?.ratio ?? null, hint: of(get("doRequests")) },
          { label: "Peticiones hoy", icon: <Server />, ratio: get("workers")?.ratio ?? null, hint: of(get("workers")) },
          { label: "Tiempo activo hoy", icon: <Timer />, ratio: get("doDuration")?.ratio ?? null, hint: of(get("doDuration"), " GB-s") },
          { label: "Nube R2 del mes", icon: <CloudUpload />, ratio: r2Ratio, hint: r2Hint },
        ].map((k) => (
          <ImmunizationKpiCard key={k.label} watermark tone={toneOf(k.ratio)} icon={k.icon} label={k.label} value={percent(k.ratio)} hint={withState(k.ratio, k.hint)} />
        ))}
      </div>
    </section>
  );
};
