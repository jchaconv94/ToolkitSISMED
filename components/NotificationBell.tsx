import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, Ban, Bell, Boxes, CheckCircle2, ChevronRight, Database, FileSpreadsheet, HardDriveDownload, Pill, RefreshCw,
  Settings, ShieldAlert,
} from "lucide-react";
import type { AppModule } from "../types";
import { useNotifications } from "../contexts/NotificationsContext";
import { Notice, NoticeIcon, badgeLabel, noticeWhen } from "../services/notifications";
import { requestBackupsTab } from "../services/backupModule";
import { toneIconClass } from "./ui/kit";

/**
 * Campanita de avisos de la cabecera. En escritorio abre un panel bajo el botón; en el
 * celular, una pantalla completa. Los datos y las reglas: `contexts/NotificationsContext.tsx`
 * y `services/notifications.ts`.
 */

const ICONS: Record<NoticeIcon, React.ElementType> = {
  shield: ShieldAlert,
  database: Database,
  settings: Settings,
  file: FileSpreadsheet,
  download: HardDriveDownload,
  ban: Ban,
  pill: Pill,
  boxes: Boxes,
};

const useIsDesktop = () => {
  const query = "(min-width: 768px)";
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return Boolean(desktop);
};

/** Repinta cada 30 s, para que «hace X» no se quede quieto con el panel abierto. */
const useTick = (active: boolean) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, [active]);
};

const NoticeRow: React.FC<{ notice: Notice; unseen: boolean; when: string; onAction: (notice: Notice) => void }> = ({ notice, unseen, when, onAction }) => {
  const Icon = ICONS[notice.icon];
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl ${toneIconClass[notice.tone]} ${unseen ? "" : "opacity-60"}`}>
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        {unseen && <span aria-label="Sin ver" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-2 ring-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={unseen ? "" : "opacity-60"}>
          <p className="text-[13.5px] font-bold leading-snug text-slate-900">{notice.title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{notice.detail}</p>
        </div>
        {/* Abajo: cuándo, a la izquierda, y la acción como texto, a la derecha. */}
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className={`text-[11px] font-semibold text-slate-400 ${unseen ? "" : "opacity-60"}`}>{when}</span>
          <button
            type="button"
            onClick={() => onAction(notice)}
            className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded text-[12.5px] font-bold text-teal-700 hover:text-teal-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {notice.action.label}
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
};

const NoticeList: React.FC<{ onAction: (notice: Notice) => void }> = ({ onAction }) => {
  const { notices, isUnseen, sinceOf, checking, lastChecked } = useNotifications();
  const now = new Date();
  if (notices.length === 0) {
    if (checking && !lastChecked) {
      return (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] font-semibold text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin text-teal-600" /> Revisando avisos…
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/80">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <div>
          <p className="text-[14px] font-black text-slate-800">Todo en orden</p>
          <p className="mt-1 text-[12.5px] text-slate-500">No hay nada que requiera tu atención.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {notices.map((notice) => (
        <NoticeRow
          key={notice.id}
          notice={notice}
          unseen={isUnseen(notice)}
          when={noticeWhen(notice.at || sinceOf(notice), now)}
          onAction={onAction}
        />
      ))}
    </ul>
  );
};

const PanelFooter: React.FC = () => {
  const { failures, checking, lastChecked, refresh } = useNotifications();
  return (
    <div className="shrink-0 border-t border-slate-100 bg-slate-50">
      {failures.length > 0 && (
        <div className="space-y-0.5 border-b border-slate-100 px-4 py-2 text-[11.5px] font-semibold text-amber-700">
          {failures.map((text) => <p key={text}>{text}</p>)}
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2.5 text-[11.5px] text-slate-500">
        <span className="min-w-0 flex-1 truncate">
          {checking ? "Revisando…" : lastChecked ? `Actualizado ${noticeWhen(lastChecked)} · se revisan cada 15 minutos` : "Se revisan al entrar y cada 15 minutos."}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={checking}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>
    </div>
  );
};

export const NotificationBell: React.FC<{ onNavigate: (module: AppModule) => void }> = ({ onNavigate }) => {
  const notifications = useNotifications();
  const { enabled, notices, unseen, markAllSeen } = notifications;
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useTick(open);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Clic fuera y Escape cierran.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Al abrir, el foco entra en el panel.
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  // Sin sesión o sin ninguna fuente de avisos, no hay campana.
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  if (!enabled) return null;

  const onAction = (notice: Notice) => {
    if (notice.action.tab === "consumo") requestBackupsTab("consumo");
    close(false);
    onNavigate(notice.action.module);
  };

  const badge = badgeLabel(unseen);
  const markButton = (label: string) => (
    <button
      type="button"
      onClick={markAllSeen}
      disabled={unseen === 0}
      className="shrink-0 rounded-md px-1.5 py-1 text-[12px] font-bold text-teal-700 hover:bg-teal-50 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unseen ? `Avisos: ${unseen} sin ver` : "Avisos"}
        title="Avisos"
        className={`relative grid h-9 w-9 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 md:h-10 md:w-10 md:border ${
          open
            ? "text-teal-700 md:border-teal-200 md:bg-teal-50"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:border-slate-200 md:bg-white md:text-slate-600 md:hover:bg-slate-50"
        }`}
      >
        <Bell aria-hidden="true" className="h-5 w-5 md:h-[18px] md:w-[18px]" />
        {badge && (
          <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9.5px] font-black leading-none text-white ring-2 ring-white md:-right-1 md:-top-1 md:h-5 md:min-w-5 md:text-[10.5px]">
            {badge}
          </span>
        )}
      </button>

      {open && desktop && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Avisos"
          tabIndex={-1}
          className="absolute right-0 top-full z-[1100] mt-2 flex max-h-[min(640px,calc(100dvh-96px))] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 outline-none animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-[15px] font-black text-slate-900">Avisos</p>
            {notices.length > 0 && <span className="rounded-full bg-teal-600 px-2 text-[11px] font-bold text-white">{notices.length}</span>}
            <span className="ml-auto">{markButton("Marcar todo como visto")}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NoticeList onAction={onAction} />
          </div>
          <PanelFooter />
        </div>
      )}

      {/* En el celular va al body: la cabecera tiene desenfoque y encerraría un `fixed`. */}
      {open && !desktop && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Avisos"
          tabIndex={-1}
          className="fixed inset-0 z-[3000] flex flex-col bg-white pt-[env(safe-area-inset-top)] outline-none animate-in fade-in duration-150"
        >
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-100 px-2">
            <button
              type="button"
              onClick={() => close()}
              aria-label="Volver"
              className="grid h-10 w-10 place-items-center rounded-full text-teal-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <ArrowLeft className="h-[22px] w-[22px]" />
            </button>
            <h2 className="flex-1 text-[17px] font-bold text-slate-900">Avisos</h2>
            <span className="pr-2">{markButton("Marcar vistos")}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NoticeList onAction={onAction} />
          </div>
          <div className="pb-[env(safe-area-inset-bottom)]">
            <PanelFooter />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
