import React from "react";
import { Wrench, LogOut, ShieldCheck } from "lucide-react";

interface MaintenanceScreenProps {
  /** Mensaje configurado en Administración → Parámetros. */
  message: string;
  /** Hay una sesión abierta que no está autorizada a entrar. */
  isAuthenticated: boolean;
  onLogout?: () => void;
  /** Deja pasar al formulario de acceso, para administradores y autorizados. */
  onGoToLogin?: () => void;
}

/**
 * Pantalla que sustituye a la aplicación mientras el mantenimiento está encendido.
 *
 * Quien tiene permiso para entrar nunca la ve; a los demás les explica qué pasa y con quién
 * hablar, sin dejarles pasar.
 */
export const MaintenanceScreen: React.FC<MaintenanceScreenProps> = ({
  message,
  isAuthenticated,
  onLogout,
  onGoToLogin,
}) => (
  <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-6">
    <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-sm p-8 sm:p-10 text-center">
      <div className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-6">
        <Wrench className="h-7 w-7" />
      </div>

      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        ToolKit SISMED Web
      </p>
      <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-2 tracking-tight">
        Sistema en mantenimiento
      </h1>

      <p className="text-sm text-slate-500 font-medium leading-relaxed mt-4">{message}</p>

      <div className="mt-8 pt-6 border-t border-slate-100 text-left">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-300 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
            Durante el mantenimiento solo entran los administradores y los usuarios autorizados
            para pruebas. Si necesita acceso, comuníquese con el administrador del sistema:
          </p>
        </div>
        {/* El contacto va en su propia línea: dentro del párrafo quedaba a un costado. */}
        <p className="text-[11px] font-bold text-slate-600 mt-2 pl-6">
          956606972 — Ing. Jordan Chacón Villacís
        </p>
      </div>

      {isAuthenticated ? (
        <button
          onClick={onLogout}
          className="mt-8 w-full sm:w-auto px-6 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-2"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      ) : (
        <button
          onClick={onGoToLogin}
          className="mt-8 text-[11px] font-black uppercase tracking-wider text-slate-400 hover:text-teal-600 transition-colors"
        >
          Soy administrador
        </button>
      )}
    </div>
  </div>
);
