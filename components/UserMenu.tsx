import React, { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, Download, LogOut, MapPin, Share, SquarePlus, UserCircle, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useInstallApp } from "../services/installApp";
import { BrandMark } from "./ui/BrandLogo";
import { User } from "../types";
import { api } from "../services/api";
import { userFullName, userInitial } from "../services/sessionDisplay";
import { useJurisdiction } from "./WelcomeToast";

/**
 * Usuario de la sesión, a la derecha de la cabecera.
 *
 * Reúne lo que antes estaba repartido entre el pie del lateral (perfil y cerrar sesión) y
 * la píldora del establecimiento de la cabecera. En el teléfono queda solo el avatar.
 */

export const UserAvatar: React.FC<{ user: User | null; size?: "sm" | "lg" }> = ({ user, size = "sm" }) => (
  <span
    aria-hidden="true"
    className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 font-black text-white shadow-sm ${
      size === "lg" ? "h-11 w-11 text-[15px]" : "h-9 w-9 text-[13px]"
    }`}
  >
    {userInitial(user)}
  </span>
);

/** Nombre del rol tal como se configuró en Administración → Roles; si no llega, el código. */
export const useRoleLabel = (user: User | null): string => {
  const [label, setLabel] = useState<string>(user?.role || "");
  useEffect(() => {
    if (!user) return;
    let vigente = true;
    setLabel(user.role);
    api.getRolesConfig()
      .then(roles => {
        const found = roles.find(r => r.role === user.role);
        if (vigente && found?.label) setLabel(found.label);
      })
      .catch(() => { /* Se queda con el código del rol. */ });
    return () => { vigente = false; };
  }, [user?.role]);
  return label;
};

interface UserMenuProps {
  user: User;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ user, onOpenProfile, onLogout }) => {
  const [open, setOpen] = useState(false);
  const installApp = useInstallApp();
  const [iosHelp, setIosHelp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const roleLabel = useRoleLabel(user);
  const { jurisdictionLabel, jurisdictionName } = useJurisdiction(user);
  const fullName = userFullName(user);
  const facility = user.facilityData;
  const showFacility = Boolean(facility?.name) && facility?.name !== jurisdictionName;

  // Se cierra al hacer clic fuera o con Escape (y el foco vuelve al botón).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
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

  // Al abrir, el foco entra en la primera opción para poder seguir con el teclado.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menú de ${fullName}`}
        className={`flex items-center gap-2.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 md:border md:py-1 md:pl-1 md:pr-3 ${
          open ? "md:border-teal-200 md:bg-teal-50/60" : "md:border-slate-200 md:bg-white md:hover:border-slate-300 md:hover:bg-slate-50"
        }`}
      >
        <UserAvatar user={user} />
        <span className="hidden min-w-0 text-left leading-tight md:block">
          <span className="block max-w-[180px] truncate text-[13px] font-bold text-slate-800">{fullName}</span>
          <span className="block max-w-[180px] truncate text-[11px] font-medium text-slate-500">{roleLabel}</span>
        </span>
        <ChevronDown className={`hidden h-4 w-4 shrink-0 text-slate-400 transition-transform md:block ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Opciones del usuario"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-[1100] mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="flex items-center gap-3 px-4 pb-3 pt-4">
            <UserAvatar user={user} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-black text-slate-900">{fullName}</p>
              <p className="truncate text-[12px] font-medium text-slate-500">
                {roleLabel}
                <span className="text-slate-300"> · </span>
                <span className="font-mono text-[11.5px]">{user.username}</span>
              </p>
            </div>
          </div>

          <div className="mx-3 mb-2 space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
              <div className="min-w-0">
                <p className="text-[10.5px] font-black uppercase tracking-wider text-slate-400">{jurisdictionLabel}</p>
                <p className="text-[12.5px] font-bold leading-snug text-slate-700">{jurisdictionName}</p>
              </div>
            </div>
            {showFacility && (
              <div className="flex items-start gap-2.5">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="text-[10.5px] font-black uppercase tracking-wider text-slate-400">Establecimiento</p>
                  <p className="text-[12.5px] font-bold leading-snug text-slate-700">
                    {facility?.name}
                    {facility?.code && <span className="ml-1.5 rounded bg-white px-1 py-px font-mono text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">{facility.code}</span>}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onOpenProfile)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:bg-slate-100"
            >
              <UserCircle className="h-[18px] w-[18px] text-slate-500" />
              Perfil de usuario
            </button>
            {installApp.available && (
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(() => { if (installApp.needsInstructions) setIosHelp(true); else void installApp.install(); })}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-teal-700 hover:bg-teal-50 focus:outline-none focus-visible:bg-teal-50"
              >
                <Download className="h-[18px] w-[18px]" />
                Instalar app
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onLogout)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus-visible:bg-red-50"
            >
              <LogOut className="h-[18px] w-[18px]" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
      {iosHelp && createPortal(
        <div className="fixed inset-0 z-[9600] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-6" onClick={() => setIosHelp(false)}>
          <div role="dialog" aria-modal="true" aria-label="Instalar en iPhone o iPad" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0f2233]"><BrandMark size={30} tone="dark" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-black text-slate-900">Instalar Toolkit SISMED</p>
                <p className="text-[12.5px] text-slate-500">Quedará en su pantalla de inicio, como una app.</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setIosHelp(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <ol className="space-y-3 text-[13.5px] text-slate-700">
              <li className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-sky-600"><Share className="h-[18px] w-[18px]" /></span><span>Toque <b>Compartir</b> en la barra de Safari.</span></li>
              <li className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><SquarePlus className="h-[18px] w-[18px]" /></span><span>Elija <b>Agregar a inicio</b>.</span></li>
              <li className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 font-black text-teal-700">3</span><span>Confirme con <b>Agregar</b>.</span></li>
            </ol>
            <button type="button" onClick={() => setIosHelp(false)} className="mt-5 h-11 w-full rounded-xl bg-slate-900 text-[14px] font-bold text-white">Entendido</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
