import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Monitor, Plug, PlugZap, RefreshCw, Send } from "lucide-react";
import { relativeTime } from "../services/sendKeys";
import { OnlinePc, applyPresence, connectionUrl, parseServerMessage } from "../services/backupConnection";
import { ImmunizationEmptyState, ImmunizationTableHeader } from "./ui/immunization";

type Status = "connecting" | "open" | "closed";

interface LogLine {
  at: number;
  text: string;
  tone: "ok" | "warn" | "info";
}

/**
 * Pestaña de prueba de la conexión inmediata (etapa 1 de Backups SISMED). Solo la ve el
 * administrador. Muestra qué PC del piloto están conectadas en tiempo real y mide cuánto
 * tarda un aviso en ir a la PC y volver.
 */
export const AdminConnectionTestTab: React.FC = () => {
  const [status, setStatus] = useState<Status>("connecting");
  const [rows, setRows] = useState<OnlinePc[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
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
      if (message.t === "presence") {
        addLog(`${message.codes.join(", ")} ${message.online ? "se conectó" : "se desconectó"}${message.equipo ? ` (${message.equipo})` : ""}.`, message.online ? "ok" : "warn");
        setRows((prev) => applyPresence(prev, message));
        if (message.online) ws.send(JSON.stringify({ t: "list" }));
      }
      if (message.t === "ping_result") {
        setPending((prev) => {
          const next = { ...prev };
          delete next[message.id];
          return next;
        });
        addLog(message.ok
          ? `Aviso a ${message.code} respondido en ${message.rtt} ms${message.equipo ? ` por ${message.equipo}` : ""}.`
          : `Aviso a ${message.code} no entregado: ${message.reason || "sin respuesta"}.`, message.ok ? "ok" : "warn");
      }
    };
    ws.onclose = () => {
      setStatus("closed");
      wsRef.current = null;
      retryRef.current = window.setTimeout(connect, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    // Refresca la lista cada 30 s para detectar PC que se quedaron sin señal.
    const refresh = window.setInterval(() => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ t: "list" })), 30000);
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
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const id = `${code}-${Date.now()}`;
    setPending((prev) => ({ ...prev, [id]: Date.now() }));
    ws.send(JSON.stringify({ t: "ping", id, code }));
    window.setTimeout(() => setPending((prev) => {
      if (!(id in prev)) return prev;
      addLog(`Aviso a ${code} sin respuesta en 30 s.`, "warn");
      const next = { ...prev };
      delete next[id];
      return next;
    }), 30000);
  };

  const busy = (code: string) => Object.keys(pending).some((id) => id.startsWith(`${code}-`));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${
          status === "open" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : status === "connecting" ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {status === "open" ? <PlugZap className="h-4 w-4" /> : status === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          {status === "open" ? "Servicio conectado" : status === "connecting" ? "Conectando…" : "Sin conexión · reintentando"}
        </span>
        <p className="text-[12.5px] text-slate-500">
          Prueba de la etapa 1 de Backups SISMED. Solo la ve el administrador. Las PC aparecen si su establecimiento está en el piloto y el Toolkit tiene la clave de envío.
        </p>
        <button type="button" onClick={() => wsRef.current?.send(JSON.stringify({ t: "list" }))} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <ImmunizationEmptyState icon={<Monitor className="h-6 w-6" />} title="Ninguna PC conectada" description="Cuando el Toolkit de una PC del piloto se conecte, aparecerá aquí al instante." />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50">
              <tr>
                <ImmunizationTableHeader>Establecimiento</ImmunizationTableHeader>
                <ImmunizationTableHeader>Equipo</ImmunizationTableHeader>
                <ImmunizationTableHeader>Toolkit</ImmunizationTableHeader>
                <ImmunizationTableHeader>Conectada desde</ImmunizationTableHeader>
                <ImmunizationTableHeader>Última señal</ImmunizationTableHeader>
                <ImmunizationTableHeader align="right">Prueba</ImmunizationTableHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.code} className="h-14">
                  <td className="px-4 py-2">
                    <div className="font-bold text-slate-800">{row.name}</div>
                    <div className="font-mono text-[11px] text-teal-700">{row.code}</div>
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-700">{row.equipo || "PC sin nombre"}</td>
                  <td className="px-4 py-2 font-mono text-xs">v{row.version || "?"}</td>
                  <td className="px-4 py-2 text-slate-500">{relativeTime(new Date(row.since).toISOString())}</td>
                  <td className="px-4 py-2 text-slate-500">{relativeTime(new Date(row.lastSeen).toISOString())}</td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" disabled={busy(row.code) || status !== "open"} onClick={() => sendPing(row.code)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-teal-600 px-3 text-xs font-bold text-white disabled:opacity-50">
                      {busy(row.code) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar aviso de prueba
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-500">Registro</p>
        {log.length === 0 ? <p className="text-[12.5px] text-slate-400">Sin eventos todavía.</p> : (
          <ul className="space-y-1 font-mono text-[12px]">
            {log.map((line) => (
              <li key={`${line.at}-${line.text}`} className={line.tone === "ok" ? "text-emerald-700" : line.tone === "warn" ? "text-amber-700" : "text-slate-600"}>
                {new Date(line.at).toLocaleTimeString("es-PE")} · {line.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
