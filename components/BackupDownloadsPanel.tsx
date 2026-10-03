import React, { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Copy, FolderDown, FolderOpen, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useBackupManager } from "../contexts/BackupManagerContext";
import { formatMegabytes } from "../services/backupConnection";
import { BackupJobView, isActive } from "../services/backupModule";

/** Texto y avance de un pedido en el panel. */
const progressOf = (job: BackupJobView): { text: string; pct: number | null } => {
  if (job.phase === "requested") return { text: job.detail || "Esperando a la PC…", pct: null };
  if (job.phase === "uploading") {
    const pct = job.size ? Math.round(((job.sent || 0) / job.size) * 100) : 0;
    return { text: `La PC está subiendo · ${formatMegabytes(job.sent || 0)} de ${formatMegabytes(job.size || 0)}`, pct };
  }
  if (job.phase === "downloading") {
    const pct = job.size ? Math.round(((job.received || 0) / job.size) * 100) : 0;
    return { text: `Descargando · ${formatMegabytes(job.received || 0)} de ${formatMegabytes(job.size || 0)}`, pct };
  }
  if (job.phase === "saving") return { text: "Comprobando la huella y guardando…", pct: 100 };
  return { text: job.detail || "", pct: null };
};

/**
 * Descargas de backups en curso y terminadas. Está en toda la aplicación (abajo a la
 * derecha), así que se ve aunque la persona cambie de módulo.
 */
export const BackupDownloadsPanel: React.FC = () => {
  const manager = useBackupManager();
  const [collapsed, setCollapsed] = useState(false);
  // Solo los pedidos reales: los rechazos por cupo o por consumo se ven en la tabla.
  const items = Object.values(manager.jobs)
    .filter((job) => job.job || job.phase === "requested")
    .filter((job) => !(job.phase === "failed" && job.failure !== "error"))
    .sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.at - a.at);
  if (items.length === 0) return null;
  const active = items.filter(isActive).length;

  const copy = async (name?: string) => {
    if (!name) return;
    try {
      await navigator.clipboard.writeText(name);
      toast.success("Nombre del archivo copiado.");
    } catch {
      toast.error("No se pudo copiar.");
    }
  };

  return createPortal(
    <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[9000] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)] md:inset-x-auto md:bottom-4 md:right-4 md:w-[340px]">
      <div className="flex items-center gap-2 bg-slate-900 px-4 py-2.5 text-white">
        <FolderDown className="h-4 w-4" />
        <span className="text-[13px] font-bold">Descargas</span>
        <span className="rounded-full bg-white/15 px-2 text-[11px] font-bold">{active ? `${active} en curso` : items.length}</span>
        <button type="button" aria-label={collapsed ? "Mostrar" : "Ocultar"} onClick={() => setCollapsed(!collapsed)} className="ml-auto rounded p-0.5 text-white/70 hover:text-white">
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {active === 0 && (
          <button type="button" aria-label="Cerrar" onClick={() => items.forEach((job) => manager.dismiss(job.code))} className="rounded p-0.5 text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <ul className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto">
            {items.map((job) => {
              const { text, pct } = progressOf(job);
              if (job.phase === "done") {
                return (
                  <li key={job.code} className="flex items-center gap-2 px-4 py-3 text-[12.5px]">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-slate-800">{job.savedName || job.name}</b>
                      <span className="text-[11px] text-slate-500">
                        {job.savedIn === "Descargas" ? "En la carpeta de descargas del navegador" : `Guardado en la carpeta «${job.savedIn}»`}
                        {job.size ? ` · ${formatMegabytes(job.size)}` : ""}
                      </span>
                    </span>
                    <button type="button" title="Copiar el nombre del archivo" onClick={() => void copy(job.savedName)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                      <Copy className="h-4 w-4" />
                    </button>
                  </li>
                );
              }
              if (job.phase === "failed") {
                return (
                  <li key={job.code} className="flex items-start gap-2 px-4 py-3 text-[12.5px]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <span className="min-w-0 flex-1">
                      <b className="block text-slate-800">{job.code}</b>
                      <span className="text-[11px] text-red-700">{text}</span>
                    </span>
                    <button type="button" aria-label="Quitar" onClick={() => manager.dismiss(job.code)} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                  </li>
                );
              }
              return (
                <li key={job.code} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <b className="truncate text-slate-800">{job.code}{job.name ? ` · ${job.name}` : ""}</b>
                    {pct != null ? <span className="font-mono text-[11px] text-slate-500">{pct}%</span> : <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all ${job.phase === "downloading" || job.phase === "saving" ? "bg-emerald-500" : "bg-teal-500"}`} style={{ width: `${pct ?? 4}%` }} />
                  </div>
                  <p className="text-[11px] text-slate-500">{text}</p>
                </li>
              );
            })}
          </ul>

          {(manager.folderSupported || manager.folderNeedsPermission) && (
            <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11.5px] text-slate-600">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {manager.folderNeedsPermission ? (
                <>
                  <span className="min-w-0 flex-1 truncate">Falta permiso para «{manager.folder}»</span>
                  <button type="button" onClick={() => void manager.grantFolder()} className="font-bold text-teal-700 hover:underline">Dar permiso</button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">Se guardan en {manager.folder ? <b>«{manager.folder}»</b> : "Descargas"}</span>
                  <button type="button" onClick={() => void manager.chooseFolder()} className="font-bold text-teal-700 hover:underline">{manager.folder ? "Cambiar" : "Elegir carpeta"}</button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
};
