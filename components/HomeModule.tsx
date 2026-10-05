import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Database, LayoutGrid, Pill } from "lucide-react";
import { AppModule } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useNotifications } from "../contexts/NotificationsContext";
import { greetingFor, limaLongDate, userFirstName } from "../services/sessionDisplay";
import { SUGGESTED_TOOLS, loadCounts, topTools } from "../services/frequentTools";
import { NAV_TINT_CLASSES, NavItem, NavTint, visibleNavSections } from "./navigation";
import { EmptyState } from "./ui/kit";

/**
 * Inicio (rediseño del 2026-10-05, sobre la referencia del usuario):
 *   - Saludo, y a su costado un resumen compacto en blanco con marca de agua: el envío de
 *     stock de la red (quien tiene Claves de envío) o su propio stock (responsable de
 *     farmacia). Los datos son los de la campanita (`useNotifications`): Inicio no lee nada.
 *   - Accesos frecuentes en recuadros (los que esa persona más abre, `frequentTools`).
 *   - Todas las herramientas por sección, en listas con flecha.
 * Las secciones y su orden salen de `navigation.ts`, igual que el lateral.
 */

/** El saludo cambia solo si la pantalla queda abierta de la mañana a la tarde. */
const useNow = (intervalMs = 60_000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

const SECTION_TITLE: Record<NavTint, { text: string; dot: string }> = {
  teal: { text: "text-teal-700", dot: "bg-teal-500" },
  cyan: { text: "text-cyan-700", dot: "bg-cyan-500" },
  violet: { text: "text-violet-700", dot: "bg-violet-500" },
  slate: { text: "text-slate-600", dot: "bg-slate-400" },
};

type Figure = { value: number; label: string; text: string; bar: string; module: AppModule };

/** «revisado hace 10 min»: de cuándo es el resultado que se muestra (puede ser el guardado). */
const checkedAgo = (at: number, now: Date) => {
  const minutes = Math.max(0, Math.round((now.getTime() - at) / 60_000));
  if (minutes < 1) return "revisado recién";
  if (minutes < 60) return `revisado hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `revisado hace ${hours} h` : "revisado hace más de un día";
};

/** Mientras llega el primer resultado: el recuadro con su forma, en gris. */
const SummarySkeleton = () => (
  <section aria-label="Cargando el estado del stock" className="animate-pulse rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
    <div className="h-3.5 w-44 rounded bg-slate-200" />
    <div className="mt-1.5 h-3 w-28 rounded bg-slate-100" />
    <div className="mt-3 h-2 rounded-full bg-slate-100" />
    <div className="mt-3 grid grid-cols-3 gap-3">
      {[0, 1, 2].map(i => <div key={i} className="h-5 w-20 rounded bg-slate-100" />)}
    </div>
  </section>
);

const daysAgo = (ms: number, now: Date) => {
  if (!ms) return null;
  const days = Math.floor((now.getTime() - ms) / 86_400_000);
  return days <= 0 ? "Actualizado hoy" : `Actualizado hace ${days} ${days === 1 ? "día" : "días"}`;
};

/**
 * Barra del resumen: cada tramo con algo dentro ocupa al menos el 12 % del ancho, para que
 * 3 lotes vencidos se vean junto a 221 al día. Un tramo en cero no se dibuja.
 */
const barShares = (values: number[]) => {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (!total) return values.map(() => 0);
  const raw = values.map(v => (v > 0 ? Math.max(v / total, 0.12) : 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(r => r / sum);
};

/** Resumen al costado del saludo: título, barra y tres números con su descripción al lado. */
const SummaryCard: React.FC<{
  title: string;
  hint?: string | null;
  link: { label: string; module: AppModule };
  figures: Figure[];
  watermark: React.ElementType;
  onNavigate: (module: AppModule) => void;
}> = ({ title, hint, link, figures, watermark: Watermark, onNavigate }) => {
  const shares = barShares(figures.map(f => f.value));
  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <Watermark aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 rotate-[-12deg] text-slate-100" strokeWidth={1.5} />
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-black text-slate-900">{title}</h2>
          {hint && <p className="truncate text-[12px] text-slate-500">{hint}</p>}
        </div>
        <button type="button" onClick={() => onNavigate(link.module)} className="flex shrink-0 items-center gap-0.5 text-[12.5px] font-bold text-teal-700 hover:text-teal-800">
          {link.label}<ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="relative mt-3 flex h-2 gap-1" aria-hidden="true">
        {shares.some(Boolean)
          ? figures.map((f, i) => (shares[i] > 0 ? <span key={f.label} className={`rounded-full ${f.bar}`} style={{ flex: shares[i] }} /> : null))
          : <span className="flex-1 rounded-full bg-slate-100" />}
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-3">
        {figures.map(f => (
          <button key={f.label} type="button" onClick={() => onNavigate(f.module)} className={`flex min-w-0 items-baseline gap-1.5 rounded-md text-left transition-opacity hover:opacity-75 ${f.value === 0 ? "opacity-50" : ""}`}>
            <span className={`text-[22px] font-black leading-none ${f.text}`}>{f.value}</span>
            <span className="truncate text-[12.5px] font-semibold text-slate-500">{f.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

/** Recuadro de acceso frecuente: al pasar el mouse sube, se marca y aparece su flecha. */
const FrequentCard: React.FC<{ item: NavItem; tint: NavTint; onClick: () => void; delay: number }> = ({ item, tint, onClick, delay }) => {
  const Icon = item.icon;
  const classes = NAV_TINT_CLASSES[tint];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[140px] flex-col justify-between gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 fill-mode-both hover:-translate-y-1 hover:border-teal-300 hover:shadow-lg hover:shadow-slate-900/5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 md:min-h-[164px] md:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className={`grid h-11 w-11 place-items-center rounded-2xl transition-all duration-200 group-hover:scale-110 ${classes.chip} ${classes.chipHover}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="absolute right-4 top-4 grid h-8 w-8 translate-x-1 -translate-y-1 place-items-center rounded-full bg-teal-600 text-white opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:opacity-100">
        <ArrowUpRight className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-[15px] font-bold leading-snug text-slate-900">{item.label}</span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-slate-500">{item.description}</span>
      </span>
    </button>
  );
};

export const HomeModule: React.FC<{ onNavigate: (module: AppModule) => void }> = ({ onNavigate }) => {
  const { user, hasPermission } = useAuth();
  const { network, networkPending, pharmacySummary } = useNotifications();
  const now = useNow();
  const sections = visibleNavSections(hasPermission);

  // Herramienta → su sección, para el color de los recuadros frecuentes.
  const items = useMemo(() => sections.flatMap(section => section.items.map(item => ({ item, tint: section.tint }))), [sections]);
  const frequent = useMemo(() => {
    const modules = topTools(loadCounts(user?.username || ""), items.map(x => x.item.module), SUGGESTED_TOOLS, 4);
    return modules.map(module => items.find(x => x.item.module === module)!).filter(Boolean);
  }, [items, user?.username]);

  // La red manda sobre el stock propio: quien ve la red (DIRESA, OGESS, UNGET o global) la ve.
  const summary = network ? (
    <SummaryCard
      title={`Stock actualizado · ${network.scope}`}
      hint={`${network.total} ${network.total === 1 ? "establecimiento" : "establecimientos"} · ${
        network.pending ? `faltan ${network.pending} UNGET por responder` : checkedAgo(network.at, now)
      }`}
      link={{ label: "Ver Consulta Stock", module: "SIG_SEARCH" }}
      watermark={Database}
      onNavigate={onNavigate}
      figures={[
        { value: network.upToDate, label: "Al día", text: "text-emerald-600", bar: "bg-emerald-400", module: "SIG_SEARCH" },
        { value: network.late, label: "Con retraso", text: "text-amber-600", bar: "bg-amber-400", module: "SIG_SEARCH" },
        { value: network.stale, label: "Sin actualizar", text: "text-red-600", bar: "bg-red-400", module: "SIG_SEARCH" },
      ]}
    />
  ) : networkPending ? (
    <SummarySkeleton />  ) : pharmacySummary && hasPermission("IPRESS_STOCK") ? (
    <SummaryCard
      title={`Tu stock${user?.facilityData?.name ? ` · ${user.facilityData.name}` : ""}`}
      hint={daysAgo(pharmacySummary.lastUpdateAt, now)}
      link={{ label: "Ver mi stock", module: "IPRESS_STOCK" }}
      watermark={Pill}
      onNavigate={onNavigate}
      figures={[
        { value: pharmacySummary.expired, label: "Lotes vencidos", text: "text-red-600", bar: "bg-red-400", module: "IPRESS_STOCK" },
        { value: pharmacySummary.expiring, label: "Por vencer", text: "text-amber-600", bar: "bg-amber-400", module: "IPRESS_STOCK" },
        { value: pharmacySummary.ok, label: "Lotes al día", text: "text-emerald-600", bar: "bg-emerald-400", module: "IPRESS_STOCK" },
      ]}
    />
  ) : null;

  // En escritorio, dos columnas: las secciones se reparten alternadas para que queden parejas.
  const columns = [sections.filter((_, i) => i % 2 === 0), sections.filter((_, i) => i % 2 === 1)].filter(c => c.length);

  return (
    <div className="space-y-6 pb-6 pt-3 sm:pt-5 md:space-y-8 lg:px-3">
      <div className={`grid items-center gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300 ${summary ? "lg:grid-cols-[minmax(0,1fr)_500px] lg:gap-8" : ""}`}>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-500">{limaLongDate(now)}</p>
          <h1 className="mt-1 text-[26px] font-black leading-tight tracking-tight text-slate-900 sm:text-[34px]">
            {greetingFor(now)}, <span className="text-teal-600">{userFirstName(user)}</span>
          </h1>
          <p className="mt-0.5 text-[14.5px] text-slate-500">¿Qué necesita hacer hoy?</p>
        </div>
        {summary}
      </div>

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon={<LayoutGrid className="h-6 w-6" />}
            title="Todavía no tiene herramientas asignadas"
            description="Pida al administrador que le dé acceso a las que necesita."
          />
        </div>
      ) : (
        <>
          {frequent.length > 1 && (
            <section aria-labelledby="inicio-frecuentes">
              <h2 id="inicio-frecuentes" className="mb-3 text-[16px] font-black text-slate-900">Accesos frecuentes</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
                {frequent.map(({ item, tint }, index) => (
                  <FrequentCard key={item.module} item={item} tint={tint} delay={index * 50} onClick={() => onNavigate(item.module)} />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="inicio-todas">
            <h2 id="inicio-todas" className="mb-3 text-[16px] font-black text-slate-900">Todas las herramientas</h2>
            <div className={`grid items-start gap-4 md:gap-5 ${columns.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {columns.map((column, c) => (
                <div key={c} className="space-y-4 md:space-y-5">
                  {column.map(section => {
                    const title = SECTION_TITLE[section.tint];
                    const tint = NAV_TINT_CLASSES[section.tint];
                    return (
                      <div key={section.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between px-4 pb-1 pt-3.5 md:px-5">
                          <h3 className={`flex items-center gap-2 text-[12px] font-black uppercase tracking-widest ${title.text}`}>
                            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${title.dot}`} />{section.label}
                          </h3>
                          <span className="text-[12px] font-semibold text-slate-400">
                            {section.items.length} {section.items.length === 1 ? "herramienta" : "herramientas"}
                          </span>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {section.items.map(item => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.module}
                                type="button"
                                onClick={() => onNavigate(item.module)}
                                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none md:px-5"
                              >
                                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors ${tint.chip} ${tint.chipHover}`}>
                                  <Icon className="h-[18px] w-[18px]" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[14.5px] font-bold text-slate-900">{item.label}</span>
                                  <span className="block truncate text-[13px] text-slate-500">{item.description}</span>
                                </span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
