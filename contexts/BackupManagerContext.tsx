/**
 * Gestor de Backups SISMED para toda la aplicación.
 *
 * Vive arriba del todo (no dentro del módulo) para que una descarga siga aunque la persona
 * cambie de módulo. Mantiene la conexión con el servicio de Cloudflare mientras el módulo
 * esté abierto o haya pedidos en curso, baja cada backup listo (retomando si se corta),
 * comprueba la huella, lo guarda y avisa al servicio para que lo borre de la nube.
 *
 * Si se recarga la página o se vuelve a entrar, el servicio le reenvía sus pedidos en curso
 * y la descarga se retoma.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "./AuthContext";
import { OnlinePc, ServerMessage, UsageReading, applyPresence, connectionUrl, parseServerMessage } from "../services/backupConnection";
import { ActivityItem, BackupJobView, isActive } from "../services/backupModule";
import {
  chooseSaveFolder, downloadWithResume, folderPickerSupported, getSaveFolder, grantSaveFolder, saveBackup, savedFileName, verifyBackup,
} from "../services/backupDownloader";
import { BackupDownloadsPanel } from "../components/BackupDownloadsPanel";

type Status = "idle" | "connecting" | "open" | "closed";

export interface BackupManager {
  enabled: boolean;
  status: Status;
  username: string | null;
  isAdmin: boolean;
  online: OnlinePc[];
  usage: UsageReading | null;
  jobs: Record<string, BackupJobView>;
  /** Conexiones y desconexiones de esta sesión (para el panel Actividad). */
  events: ActivityItem[];
  /** Sube cada vez que termina un pedido: el módulo vuelve a pedir su lista. */
  version: number;
  folder: string | null;
  folderSupported: boolean;
  folderNeedsPermission: boolean;
  request: (code: string) => void;
  refresh: () => void;
  refreshUsage: () => void;
  dismiss: (code: string) => void;
  chooseFolder: () => Promise<void>;
  grantFolder: () => Promise<void>;
  /** El módulo lo llama al abrirse: mantiene la conexión mientras esté a la vista. */
  attach: () => () => void;
}

const BackupManagerContext = createContext<BackupManager | null>(null);

/** Hay pedidos sin terminar: al volver a abrir la aplicación hay que reconectar para retomarlos. */
const PENDING_KEY = "backups-sismed:pendientes";
const MAX_DOWNLOADS = 2;
const CLOSE_AFTER_MS = 30000;

const readPending = () => {
  try { return localStorage.getItem(PENDING_KEY) === "1"; } catch { return false; }
};
const writePending = (value: boolean) => {
  try { value ? localStorage.setItem(PENDING_KEY, "1") : localStorage.removeItem(PENDING_KEY); } catch { /* sin almacenamiento */ }
};

export const BackupManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, hasPermission } = useAuth();
  const enabled = isAuthenticated && hasPermission("ADMIN_BACKUPS");

  const [status, setStatus] = useState<Status>("idle");
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [online, setOnline] = useState<OnlinePc[]>([]);
  const [usage, setUsage] = useState<UsageReading | null>(null);
  const [jobs, setJobs] = useState<Record<string, BackupJobView>>({});
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const [version, setVersion] = useState(0);
  const [attached, setAttached] = useState(0);
  const [folder, setFolder] = useState<string | null>(null);
  const [folderNeedsPermission, setFolderNeedsPermission] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | undefined>(undefined);
  const closeRef = useRef<number | undefined>(undefined);
  const downloading = useRef(new Set<string>());
  const queue = useRef<Array<Extract<ServerMessage, { t: "backup_ready" }>>>([]);
  // Al abrir la aplicación con pedidos sin terminar se conecta para retomarlos; el servicio
  // los reenvía al conectarse, así que pasado un momento ya no hace falta mantenerla abierta.
  const [resuming, setResuming] = useState(readPending);

  const anyActive = useMemo(() => Object.values(jobs).some(isActive), [jobs]);
  const keepOpen = enabled && (attached > 0 || anyActive || resuming);

  useEffect(() => {
    if (!resuming || status !== "open") return;
    const timer = window.setTimeout(() => setResuming(false), 10000);
    return () => window.clearTimeout(timer);
  }, [resuming, status]);

  useEffect(() => { void getSaveFolder().then((h) => setFolder(h?.name || null)); }, []);
  useEffect(() => { if (enabled) writePending(anyActive); }, [anyActive, enabled]);

  const setJob = useCallback((code: string, patch: Partial<BackupJobView>) =>
    setJobs((prev) => ({ ...prev, [code]: { ...(prev[code] || { code, phase: "requested", at: Date.now() }), ...patch, code } })), []);

  const addEvent = (text: string, tone: ActivityItem["tone"]) =>
    setEvents((prev) => [{ key: `${Date.now()}-${text}`, at: Date.now(), kind: "connection" as const, tone, text }, ...prev].slice(0, 100));

  const send = useCallback((message: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  /** Baja, comprueba, guarda y confirma. Hasta dos a la vez; el resto espera turno. */
  const pump = useCallback(() => {
    while (downloading.current.size < MAX_DOWNLOADS && queue.current.length) {
      const ready = queue.current.shift()!;
      if (downloading.current.has(ready.job)) continue;
      downloading.current.add(ready.job);
      void (async () => {
        setJob(ready.code, { job: ready.job, phase: "downloading", name: ready.name, size: ready.size, received: 0, detail: undefined });
        try {
          let last = 0;
          const data = await downloadWithResume(ready.downloadUrl, ready.size, (received) => {
            // Una actualización por cada ~1 % basta para la barra.
            if (received - last >= ready.size / 100 || received === ready.size) {
              last = received;
              setJob(ready.code, { received });
            }
          });
          setJob(ready.code, { phase: "saving" });
          if (!(await verifyBackup(data, ready.size, ready.sha256))) throw new Error("la huella no coincide: el archivo llegó dañado");
          const name = savedFileName(ready.code, ready.name);
          const saved = await saveBackup(data, name);
          if (saved.needsPermission) setFolderNeedsPermission(true);
          send({ t: "backup_done", job: ready.job });
          setJob(ready.code, { phase: "done", savedIn: saved.savedIn, savedName: name, at: Date.now() });
          setVersion((v) => v + 1);
        } catch (error) {
          setJob(ready.code, { phase: "failed", failure: "error", detail: `La descarga falló: ${String((error as Error).message || error)}`, at: Date.now() });
          setVersion((v) => v + 1);
        } finally {
          downloading.current.delete(ready.job);
          pump();
        }
      })();
    }
  }, [send, setJob]);

  const onMessage = useCallback((message: ServerMessage) => {
    switch (message.t) {
      case "hello":
        setUsername(message.username);
        setIsAdmin(message.isAdmin);
        break;
      case "list":
        setOnline(message.rows);
        break;
      case "presence":
        addEvent(`${message.codes.join(", ")} ${message.online ? "se conectó" : "se desconectó"}${message.equipo ? ` (${message.equipo})` : ""}`, message.online ? "info" : "warn");
        setOnline((prev) => applyPresence(prev, message));
        if (message.online) send({ t: "list" });
        break;
      case "usage":
        setUsage(message.usage);
        break;
      case "backup_requested":
        setJob(message.code, { job: message.job, phase: "requested", failure: undefined, quota: message.quota, detail: "Esperando a la PC…", at: Date.now() });
        break;
      case "backup_meta":
        setJob(message.code, { job: message.job, phase: "uploading", name: message.name, size: message.size, sent: 0, detail: undefined });
        break;
      case "backup_progress":
        setJob(message.code, { phase: "uploading", sent: message.sent });
        break;
      case "backup_ready":
        queue.current.push(message);
        pump();
        break;
      case "backup_failed": {
        const failure = message.quota ? "quota" : message.usage ? "paused" : "error";
        setJob(message.code, { job: message.job, phase: "failed", failure, quota: message.quota, detail: message.reason, at: Date.now() });
        if (message.usage) setUsage(message.usage);
        if (failure !== "error") toast.warning(message.reason);
        setVersion((v) => v + 1);
        break;
      }
      default:
        break;
    }
  }, [pump, send, setJob]);

  const connect = useCallback(() => {
    const url = connectionUrl();
    if (!url) return;
    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setStatus("open");
    ws.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message) onMessage(message);
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("closed");
      retryRef.current = window.setTimeout(() => setStatus((s) => (s === "closed" ? "idle" : s)), 5000);
    };
  }, [onMessage]);

  // Abre la conexión cuando hace falta y la cierra un rato después de que deje de hacer falta.
  useEffect(() => {
    window.clearTimeout(closeRef.current);
    if (keepOpen) {
      if (!wsRef.current && status === "idle") connect();
      return;
    }
    if (wsRef.current) {
      closeRef.current = window.setTimeout(() => {
        const ws = wsRef.current;
        wsRef.current = null;
        if (ws) { ws.onclose = null; ws.close(); }
        setStatus("idle");
      }, CLOSE_AFTER_MS);
    }
  }, [keepOpen, status, connect]);

  // Al cerrar sesión se olvida todo.
  useEffect(() => {
    if (enabled) return;
    window.clearTimeout(retryRef.current);
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) { ws.onclose = null; ws.close(); }
    setStatus("idle");
    setJobs({});
    setOnline([]);
    setEvents([]);
  }, [enabled]);

  // Mientras haya pedidos en curso, el navegador pregunta antes de cerrar la pestaña.
  useEffect(() => {
    if (!anyActive) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyActive]);

  const request = useCallback((code: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      toast.error("Sin conexión con el servicio. Espere unos segundos y vuelva a intentar.");
      return;
    }
    setJob(code, { job: undefined, phase: "requested", failure: undefined, name: undefined, size: undefined, sent: 0, received: 0, detail: "Pidiendo…", at: Date.now() });
    send({ t: "backup_request", code });
  }, [send, setJob]);

  const attach = useCallback(() => {
    setAttached((n) => n + 1);
    return () => setAttached((n) => Math.max(0, n - 1));
  }, []);

  const value: BackupManager = {
    enabled,
    status,
    username,
    isAdmin,
    online,
    usage,
    jobs,
    events,
    version,
    folder,
    folderSupported: folderPickerSupported(),
    folderNeedsPermission,
    request,
    refresh: () => send({ t: "list" }),
    refreshUsage: () => send({ t: "usage" }),
    dismiss: (code) => setJobs((prev) => {
      if (isActive(prev[code])) return prev;
      const next = { ...prev };
      delete next[code];
      return next;
    }),
    chooseFolder: async () => {
      const name = await chooseSaveFolder();
      if (name) { setFolder(name); setFolderNeedsPermission(false); }
    },
    grantFolder: async () => { if (await grantSaveFolder()) setFolderNeedsPermission(false); },
    attach,
  };

  return (
    <BackupManagerContext.Provider value={value}>
      {children}
      {enabled && <BackupDownloadsPanel />}
    </BackupManagerContext.Provider>
  );
};

export const useBackupManager = (): BackupManager => {
  const context = useContext(BackupManagerContext);
  if (!context) throw new Error("useBackupManager fuera de BackupManagerProvider");
  return context;
};
