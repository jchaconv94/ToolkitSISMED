import React from "react";
import { Activity, AlertTriangle, CheckCircle2, Lock, Package, XCircle } from "lucide-react";

/**
 * Piezas visuales compartidas por los módulos de Inmunizaciones.
 *
 * Antes cada módulo redefinía lo mismo: `SummaryCard` estaba escrito cuatro veces con
 * firmas distintas, `MetricCard` dos, y la clase de los inputs se repetía en nueve
 * archivos. Eso hacía que cualquier ajuste visual se aplicara solo a la pantalla que se
 * tocaba y el conjunto se fuera separando.
 *
 * Guía de referencia: `docs/UX_PLAN_INMUNIZACIONES.md`.
 */

/** Campos de formulario. Alto 44 px, según el plan UX. */
export const immunizationInputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition-shadow placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-500";

/** Listas desplegables de formulario. */
export const immunizationSelectClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-400";

/** Campos dentro de una barra de filtros. Más compactos que los de formulario. */
export const immunizationFilterInputClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition-shadow placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-500";

/** Normaliza para buscar sin tildes ni mayúsculas. */
export const normalizeImmunizationText = (value: string) => value
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .trim();

/**
 * Color con significado operativo, no decorativo.
 *
 * emerald: aplicado, vigente · amber: pendiente, advertencia · red: vencido, error
 * teal: información del módulo · slate: neutro · oscuro: periodo cerrado o bloqueado
 */
export type ImmunizationTone = "neutral" | "success" | "warning" | "danger" | "info" | "locked";

const toneIcon: Record<ImmunizationTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
  danger: "bg-red-50 text-red-700 ring-1 ring-red-200/80",
  info: "bg-teal-50 text-teal-700 ring-1 ring-teal-200/80",
  locked: "bg-slate-900 text-slate-100 ring-1 ring-slate-800"
};

const toneTopBar: Record<ImmunizationTone, string> = {
  neutral: "bg-slate-300",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-teal-500",
  locked: "bg-slate-800"
};

const toneFilled: Record<ImmunizationTone, string> = {
  neutral: "border-slate-200 bg-white text-slate-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  info: "border-teal-200 bg-teal-50 text-teal-800",
  locked: "border-slate-300 bg-slate-900 text-white"
};

const toneChip: Record<ImmunizationTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-teal-200 bg-teal-50 text-teal-700",
  locked: "border-slate-300 bg-slate-900 text-white"
};

const toneWatermark: Record<ImmunizationTone, { gradient: string; icon: string; value: string }> = {
  neutral: { gradient: "from-slate-100", icon: "text-slate-500", value: "text-slate-700" },
  success: { gradient: "from-emerald-50", icon: "text-emerald-600", value: "text-emerald-700" },
  warning: { gradient: "from-amber-50", icon: "text-amber-600", value: "text-amber-700" },
  danger: { gradient: "from-red-50", icon: "text-red-600", value: "text-red-600" },
  info: { gradient: "from-teal-50", icon: "text-teal-600", value: "text-teal-700" },
  locked: { gradient: "from-slate-200", icon: "text-slate-700", value: "text-slate-900" }
};

const defaultToneIcons: Record<ImmunizationTone, React.ReactNode> = {
  neutral: <Package className="h-5 w-5" />,
  success: <CheckCircle2 className="h-5 w-5" />,
  warning: <AlertTriangle className="h-5 w-5" />,
  danger: <XCircle className="h-5 w-5" />,
  info: <Activity className="h-5 w-5" />,
  locked: <Lock className="h-5 w-5" />
};

/**
 * Tarjeta de indicador / KPI.
 */
export const ImmunizationKpiCard: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: ImmunizationTone;
  hint?: string;
  filled?: boolean;
  compact?: boolean;
  onClick?: () => void;
  active?: boolean;
  /** Ícono grande y tenue de fondo, con franja lateral y degradado del tono. */
  watermark?: boolean;
  /** Solo con `watermark`: barra de avance de 0 a 1, del color del tono. */
  progress?: number | null;
  /** Marcas sobre la barra (de 0 a 1), por ejemplo un umbral de aviso. */
  progressMarks?: number[];
}> = ({ label, value, icon, tone = "neutral", hint, filled, compact = false, onClick, active, watermark, progress, progressMarks = [] }) => {
  if (watermark) {
    const isInteractive = Boolean(onClick);
    const Container = isInteractive ? "button" : "div";
    return (
      <Container
        {...(isInteractive ? { type: "button", onClick } : {})}
        className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${toneWatermark[tone].gradient} to-white p-4 text-left shadow-sm transition-all duration-200 ${
          active ? "border-teal-500 ring-2 ring-teal-500/20" : "border-slate-200/90"
        } ${isInteractive ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""}`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${toneTopBar[tone]}`} />
        <span className={`pointer-events-none absolute -bottom-4 -right-3 opacity-[0.09] [&>svg]:h-24 [&>svg]:w-24 ${toneWatermark[tone].icon}`}>
          {icon || defaultToneIcons[tone]}
        </span>
        <div className="relative min-w-0">
          <p className="line-clamp-2 text-[11px] font-black uppercase leading-tight tracking-wider text-slate-500 sm:truncate">{label}</p>
          <p className={`mt-1 truncate text-2xl font-black leading-tight sm:text-[28px] ${toneWatermark[tone].value}`}>{value}</p>
          {progress !== undefined && (
            <div
              className="relative mb-1.5 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
            >
              {progress != null && (
                <div className={`h-full rounded-full ${toneTopBar[tone]}`} style={{ width: `${Math.min(100, Math.max(progress * 100, 2))}%` }} />
              )}
              {progressMarks.map((mark) => (
                <span key={mark} className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${mark * 100}%` }} />
              ))}
            </div>
          )}
          {hint && <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{hint}</p>}
        </div>
      </Container>
    );
  }

  if (filled) {
    return (
      <div className={`rounded-2xl border px-3.5 py-3 ${toneFilled[tone]}`}>
        <p className="text-[10px] font-black uppercase tracking-wider opacity-70">{label}</p>
        <p className="mt-0.5 truncate text-lg font-black">{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] font-semibold opacity-70">{hint}</p>}
      </div>
    );
  }

  const renderIcon = icon || defaultToneIcons[tone];

  if (compact) {
    const isInteractive = Boolean(onClick);
    const Container = isInteractive ? "button" : "div";
    return (
      <Container
        {...(isInteractive ? { type: "button", onClick } : {})}
        className={`group relative overflow-hidden rounded-xl border bg-white px-3.5 py-2.5 shadow-2xs transition-all duration-150 text-left flex flex-col justify-between ${
          active
            ? "border-teal-500 ring-2 ring-teal-500/20 shadow-xs"
            : "border-slate-200/90 hover:border-slate-300"
        } ${isInteractive ? "cursor-pointer" : ""}`}
      >
        <div className={`absolute top-0 left-0 right-0 h-0.5 ${toneTopBar[tone]}`} />
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
              {label}
            </p>
            <p className="mt-0.5 truncate text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight">
              {value}
            </p>
          </div>
          {renderIcon && (
            <div className={`shrink-0 rounded-lg p-1.5 shadow-2xs ${toneIcon[tone]}`}>
              <div className="[&>svg]:h-4 [&>svg]:w-4">{renderIcon}</div>
            </div>
          )}
        </div>
        {hint && (
          <div className="mt-1 pt-1 border-t border-slate-100 flex items-center text-[10px] font-medium text-slate-400">
            <span className="truncate">{hint}</span>
          </div>
        )}
      </Container>
    );
  }

  const isInteractive = Boolean(onClick);
  const Container = isInteractive ? "button" : "div";

  return (
    <Container
      {...(isInteractive ? { type: "button", onClick } : {})}
      className={`group relative overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-all duration-200 text-left flex flex-col justify-between h-full ${
        active
          ? "border-teal-500 ring-2 ring-teal-500/20 shadow-md -translate-y-0.5"
          : "border-slate-200/90 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      } ${isInteractive ? "cursor-pointer" : ""}`}
    >
      {/* Dynamic top color accent line */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${toneTopBar[tone]}`} />

      <div className="flex items-start justify-between gap-3 pt-0.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 transition-colors group-hover:text-slate-700">
            {label}
          </p>
          <p className="mt-1.5 truncate text-2xl font-black text-slate-900 tracking-tight">
            {value}
          </p>
        </div>

        {renderIcon && (
          <div className={`shrink-0 rounded-xl p-2.5 shadow-2xs transition-transform duration-200 group-hover:scale-105 ${toneIcon[tone]}`}>
            {renderIcon}
          </div>
        )}
      </div>

      {hint && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center text-xs font-semibold text-slate-400">
          <span className="truncate">{hint}</span>
        </div>
      )}
    </Container>
  );
};

/**
 * Cabecera estándar de módulo: icono, título, distintivos, una línea de descripción y
 * el ámbito operativo. Las acciones van a la derecha.
 */
export const ImmunizationPageHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  scopeLabel?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: ImmunizationTone;
}> = ({ icon, title, description, scopeLabel, badges, actions, tone = "info" }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-start gap-4 min-w-0">
        <div className={`rounded-2xl p-3 shrink-0 ${toneIcon[tone]}`}>{icon}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black text-slate-900">{title}</h2>
            {badges}
          </div>
          {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">{description}</p>}
          {scopeLabel && <p className="mt-2 text-xs font-black text-teal-700">{scopeLabel}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 self-start xl:self-center">{actions}</div>}
    </div>
  </section>
);

/** Distintivo de estado. El texto siempre acompaña al color, nunca al revés. */
export const ImmunizationStatusChip: React.FC<{
  label: string;
  tone?: ImmunizationTone;
}> = ({ label, tone = "neutral" }) => (
  <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${toneChip[tone]}`}>
    {label}
  </span>
);

/**
 * Celda de cabecera de tabla.
 *
 * Existían cinco versiones de esto repartidas por los módulos, con distinto relleno y
 * tamaño de letra. Una construía la clase de alineación por interpolación, que Tailwind
 * no puede detectar al compilar.
 */
export const ImmunizationTableHeader: React.FC<{
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}> = ({ children, align = "left" }) => (
  <th
    className={`px-4 py-3 text-[10px] font-black uppercase tracking-wide text-slate-500 ${
      align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
    }`}
  >
    {children}
  </th>
);

/** Campo de formulario con su etiqueta y la marca de obligatorio. */
export const ImmunizationField: React.FC<{
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, required, hint, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-black text-slate-700">
      {label} {required && <span className="text-red-500">*</span>}
    </span>
    {children}
    {hint && <span className="mt-1 block text-[11px] font-semibold text-slate-400">{hint}</span>}
  </label>
);

/** Fecha corta: `15/07/2026`. Devuelve `-` cuando no hay valor o no es una fecha. */
export const formatImmunizationDate = (value?: string) => {
  if (!value) return "-";
  const normalizado = value.includes("T") ? value : `${value}T00:00:00`;
  const fecha = new Date(normalizado);
  return Number.isNaN(fecha.getTime()) ? value : fecha.toLocaleDateString("es-PE");
};

/** Fecha y hora: `15/07/26, 14:30`. */
export const formatImmunizationDateTime = (value?: string) => {
  if (!value) return "-";
  const fecha = new Date(value);
  if (Number.isNaN(fecha.getTime())) return "-";
  return fecha.toLocaleString("es-PE", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
  });
};

/** Cantidad con separador de miles y hasta dos decimales. */
export const formatImmunizationNumber = (value: number, decimales = 2) =>
  Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: decimales });

/** Importe en soles. */
export const formatImmunizationCurrency = (value: number) =>
  `S/ ${Number(value || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Hoy en el formato que espera un `<input type="date">`. */
export const todayInputValue = () => new Date().toISOString().slice(0, 10);

/** Dato suelto etiqueta/valor, para cabeceras de detalle y resúmenes de una fila. */
export const ImmunizationInfoPill: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 font-black text-slate-900">{value}</p>
  </div>
);

/** Estado vacío: qué pasa y qué puede hacer el usuario a continuación. */
export const ImmunizationEmptyState: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, description, icon, action }) => (
  <div className="flex flex-col items-center gap-3 p-10 text-center">
    {icon && <span className="rounded-2xl bg-slate-100 p-3 text-slate-400">{icon}</span>}
    <div>
      <p className="text-sm font-black text-slate-600">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
    {action}
  </div>
);

/** Banner de bloqueo informativo cuando el establecimiento aún no cuenta con inventario inicial cerrado ni remesa inicial recibida. */
export const ImmunizationUninitializedFacilityBanner: React.FC<{
  ownerType?: "IPRESS" | "UNGET";
  facilityName?: string;
  onNavigateToInventory?: () => void;
  onNavigateToDistributions?: () => void;
}> = ({ ownerType = "IPRESS", facilityName, onNavigateToInventory, onNavigateToDistributions }) => (
  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900 shadow-sm">
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3.5">
        <div className="rounded-xl bg-amber-200/80 p-2.5 text-amber-800 shrink-0">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-base font-black text-amber-950">
            {ownerType === "IPRESS"
              ? `Establecimiento ${facilityName ? `(${facilityName}) ` : ""}pendiente de apertura`
              : "UNGET pendiente de inventario inicial"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            {ownerType === "IPRESS"
              ? "Para registrar operaciones (consumos, devoluciones, reajustes y cierre mensual), el establecimiento debe contar con su Inventario Inicial cerrado, o recibir una Remesa Inicial de apertura enviada por su UNGET."
              : "Para registrar operaciones en la UNGET, se requiere registrar y cerrar el Inventario Inicial biológico."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {onNavigateToInventory && (
          <button
            type="button"
            onClick={onNavigateToInventory}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-800"
          >
            <Package className="h-4 w-4" />
            Ir a Inventario Inicial
          </button>
        )}
        {onNavigateToDistributions && ownerType === "IPRESS" && (
          <button
            type="button"
            onClick={onNavigateToDistributions}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400 bg-white px-4 py-2.5 text-xs font-bold text-amber-900 shadow-sm transition hover:bg-amber-100"
          >
            <Activity className="h-4 w-4" />
            Ver Distribuciones
          </button>
        )}
      </div>
    </div>
  </div>
);

