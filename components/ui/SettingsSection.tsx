import React from "react";

/**
 * Página de ajustes (Parámetros del Sistema): secciones por lo que afectan y un renglón por
 * parámetro, con su explicación a la izquierda y el campo a la derecha (debajo en el celular).
 */
export const SettingsSection: React.FC<{
  icon: React.ReactNode;
  /** Clases del cuadrito del ícono, p. ej. "bg-teal-50 text-teal-700". */
  iconClass: string;
  title: string;
  subtitle: string;
  /** Borde ámbar: ajustes delicados, como el modo mantenimiento. */
  warning?: boolean;
  children: React.ReactNode;
}> = ({ icon, iconClass, title, subtitle, warning, children }) => (
  <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${warning ? "border-amber-200" : "border-slate-200"}`}>
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 md:px-5">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px] ${iconClass}`}>{icon}</span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-black text-slate-900">{title}</h3>
        <p className="text-[12.5px] text-slate-500">{subtitle}</p>
      </div>
    </div>
    <div className="divide-y divide-slate-100">{children}</div>
  </section>
);

export const SettingsRow: React.FC<{
  label: string;
  help: React.ReactNode;
  /** Muestra la etiqueta «Cambiado» mientras no se guarde. */
  changed?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, help, changed, htmlFor, children }) => (
  <div className="flex flex-col gap-2.5 px-4 py-4 md:flex-row md:items-center md:justify-between md:gap-6 md:px-5">
    <div className="min-w-0 md:max-w-[60%]">
      <label htmlFor={htmlFor} className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-slate-900">
        {label}
        {changed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-800">Cambiado</span>}
      </label>
      <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{help}</p>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/** Campo numérico corto de un ajuste, con su unidad al lado. */
export const settingsNumberClass =
  "h-11 w-24 rounded-xl border border-slate-200 bg-white px-3 text-center text-sm font-bold text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:bg-slate-50 disabled:text-slate-400";
