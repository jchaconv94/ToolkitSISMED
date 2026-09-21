import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Layers, ShieldCheck } from "lucide-react";
import { User } from "../types";
import { api } from "../services/api";

/**
 * Saludo de bienvenida al iniciar sesión.
 *
 * Era un modal a pantalla completa con un botón «Comenzar Gestión»: obligaba a hacer clic
 * para empezar a trabajar y no aportaba nada que no se vea en el propio panel. Ahora es un
 * aviso en la esquina superior derecha que se va solo a los cinco segundos.
 *
 * La resolución de la jurisdicción se conserva igual que la tenía el modal —es lo único
 * que sí informaba: de qué UNGET, OGESS o DIRESA depende la sesión—, y se muestra en el
 * propio aviso en cuanto llega, sin retrasar su aparición.
 */

const saludoPorHora = (): string => {
  const hora = new Date().getHours();
  if (hora < 12) return "Buenos días";
  if (hora < 18) return "Buenas tardes";
  return "Buenas noches";
};

/** Ámbito de la sesión: la misma cascada que usaba el modal. */
const useJurisdiction = (user: User) => {
  const [jurisdictionName, setJurisdictionName] = useState<string>("Cargando...");
  const [jurisdictionLabel, setJurisdictionLabel] = useState<string>("Establecimiento Activo");

  useEffect(() => {
    const resolveJurisdiction = async () => {
      try {
        const p = user.personnelData;
        if (!p) {
          setJurisdictionLabel('Establecimiento Activo');
          setJurisdictionName(user.facilityData?.name || 'Red de Salud');
          return;
        }

        // Get Role Configurations to find exact jurisdictionLevel
        const roles = await api.getRolesConfig();
        const userRoleConfig = roles.find(r => r.role === user.role);
        const level = (userRoleConfig?.jurisdictionLevel || user.role || '').toUpperCase();

        if (level === 'GLOBAL' || level === 'ADMIN' || level === 'SUPERADMIN') {
          setJurisdictionLabel('Jurisdicción');
          setJurisdictionName('Área Nacional');
          return;
        }

        if (level === 'DIRESA' && p.diresaId) {
          setJurisdictionLabel('DIRESA Activa');
          const diresas = await api.getDiresas();
          const found = diresas.find(d => d.id === p.diresaId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        if (level === 'OGESS' && p.ogessId) {
          setJurisdictionLabel('OGESS Activa');
          const ogess = await api.getOgess();
          const found = ogess.find(o => o.id === p.ogessId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        if (level === 'UNGET' && p.ungetId) {
          setJurisdictionLabel('UNGET Activa');
          const ungets = await api.getUngets();
          const found = ungets.find(u => u.id === p.ungetId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        if (level === 'MICRORED' && p.microredId) {
          setJurisdictionLabel('Microred Activa');
          const microredes = await api.getMicroredes();
          const found = microredes.find(m => m.id === p.microredId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        // Fallback checks using role name directly if userRoleConfig wasn't explicitly matching level
        const roleStr = String(user.role).toUpperCase();
        if (roleStr === 'DIRESA') {
          setJurisdictionLabel('DIRESA Activa');
          if (p.diresaId) {
            const diresas = await api.getDiresas();
            const found = diresas.find(d => d.id === p.diresaId);
            if (found) {
              setJurisdictionName(found.name);
              return;
            }
          }
        }

        if (roleStr === 'OGESS') {
          setJurisdictionLabel('OGESS Activa');
          if (p.ogessId) {
            const ogess = await api.getOgess();
            const found = ogess.find(o => o.id === p.ogessId);
            if (found) {
              setJurisdictionName(found.name);
              return;
            }
          }
        }

        if (roleStr === 'UNGET') {
          setJurisdictionLabel('UNGET Activa');
          if (p.ungetId) {
            const ungets = await api.getUngets();
            const found = ungets.find(u => u.id === p.ungetId);
            if (found) {
              setJurisdictionName(found.name);
              return;
            }
          }
        }

        if (roleStr === 'MICRORED') {
          setJurisdictionLabel('Microred Activa');
          if (p.microredId) {
            const microredes = await api.getMicroredes();
            const found = microredes.find(m => m.id === p.microredId);
            if (found) {
              setJurisdictionName(found.name);
              return;
            }
          }
        }

        // Catch-all hierarchy fallback matching the deepest available ID
        if (p.microredId) {
          setJurisdictionLabel('Microred Activa');
          const microredes = await api.getMicroredes();
          const found = microredes.find(m => m.id === p.microredId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        if (p.ungetId) {
          setJurisdictionLabel('UNGET Activa');
          const ungets = await api.getUngets();
          const found = ungets.find(u => u.id === p.ungetId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        if (p.ogessId) {
          setJurisdictionLabel('OGESS Activa');
          const ogess = await api.getOgess();
          const found = ogess.find(o => o.id === p.ogessId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        if (p.diresaId) {
          setJurisdictionLabel('DIRESA Activa');
          const diresas = await api.getDiresas();
          const found = diresas.find(d => d.id === p.diresaId);
          if (found) {
            setJurisdictionName(found.name);
            return;
          }
        }

        setJurisdictionLabel('Establecimiento Activo');
        setJurisdictionName(user.facilityData?.name || p.facilityCode || 'Red de Salud');
      } catch (err) {
        console.error("Error resolving jurisdiction", err);
        setJurisdictionLabel('Establecimiento Activo');
        setJurisdictionName(user.facilityData?.name || 'Red de Salud');
      }
    };

    resolveJurisdiction();
    resolveJurisdiction();
  }, [user]);

  return { jurisdictionName, jurisdictionLabel };
};

const WelcomeToastContent: React.FC<{ user: User }> = ({ user }) => {
  const { jurisdictionName, jurisdictionLabel } = useJurisdiction(user);
  const nombre = user.personnelData?.firstName || user.username;

  return (
    <div className="w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center gap-3 bg-slate-900 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400">
          <Layers className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black tracking-tight text-white">
            {saludoPorHora()}, <span className="text-teal-400">{nombre}</span>
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Sesión iniciada
          </p>
        </div>
      </div>

      <div className="space-y-1.5 px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-teal-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {jurisdictionLabel}
          </span>
          <span className="ml-auto truncate font-black text-slate-800">{jurisdictionName}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rol</span>
          <span className="ml-auto truncate font-black text-slate-800">{user.role}</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Lanza el aviso. Va arriba a la derecha aunque el resto de avisos de la aplicación salgan
 * arriba en el centro: es un saludo, no debe taparle a nadie lo que estaba mirando.
 */
export const showWelcomeToast = (user: User): void => {
  if (!user) return;
  toast.custom(() => <WelcomeToastContent user={user} />, {
    position: "top-right",
    duration: 5000,
  });
};
