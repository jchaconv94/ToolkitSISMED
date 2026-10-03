import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, PlugZap, Server, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { useBackupManager } from "../contexts/BackupManagerContext";
import { UsageItem, backupModuleApi, formatMegabytes } from "../services/backupConnection";
import { limaDay } from "../services/backupModule";
import { StatusChip, TableHeaderCell, Tone } from "./ui/kit";
import { TablePagination } from "./ui/TablePagination";
import { LoadMoreSentinel, useIncrementalCount } from "./ui/IncrementalList";
import { formatNumber } from "../services/numberFormat";

/** Porcentaje con coma decimal y dos decimales: 0,25 %. es-PE usaría punto, por eso se arma a mano. */
const percent = (ratio: number) => `${(ratio * 100).toFixed(2).replace(".", ",")} %`;

const number = (n: number) => formatNumber(n, n < 100 ? 1 : 0);

/** Mes siguiente, para «se reinicia el 1 de noviembre». */
const nextMonthName = (now = new Date()) =>
  new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString("es-PE", { month: "long" }).toLowerCase();

const toneOf = (ratio: number | null): Tone => (ratio == null ? "neutral" : ratio >= 0.8 ? "danger" : ratio >= 0.7 ? "warning" : "info");
const BAR: Record<string, string> = { danger: "bg-red-500", warning: "bg-amber-500", info: "bg-teal-500", neutral: "bg-slate-300" };
const VALUE: Record<string, string> = { danger: "text-red-600", warning: "text-amber-700", info: "text-teal-700", neutral: "text-slate-400" };
const ICON: Record<string, string> = { danger: "bg-red-50 text-red-700", warning: "bg-amber-50 text-amber-700", info: "bg-teal-50 text-teal-700", neutral: "bg-slate-100 text-slate-500" };

/** Un límite del plan gratuito: % con barra, cifra, qué cuenta, cuándo se reinicia y si podría cobrar. */
const LimitCard: React.FC<{ icon: React.ReactNode; label: string; ratio: number | null; used: string; what: string; reset: string; charges: boolean }> = ({ icon, label, ratio, used, what, reset, charges }) => {
  const tone = toneOf(ratio);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm md:p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${BAR[tone]}`} />
      <div className="flex items-start gap-3">
        <span className={`rounded-xl p-2.5 ${ICON[tone]}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className={`text-[26px] font-black leading-none md:text-[30px] ${VALUE[tone]}`}>{ratio == null ? "—" : percent(ratio)}</span>
            {tone === "warning" && <StatusChip label="Cerca del tope" tone="warning" />}
            {tone === "danger" && <StatusChip label="Pausado" tone="danger" />}
          </div>
        </div>
      </div>
      <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio == null ? undefined : Math.round(ratio * 100)}>
        {ratio != null && <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${Math.min(100, Math.max(ratio * 100, 1.5))}%` }} />}
        <span className="absolute inset-y-0 left-[70%] w-0.5 bg-white" />
        <span className="absolute inset-y-0 left-[80%] w-0.5 bg-white" />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[10.5px] font-semibold text-slate-400"><span className="truncate">{used}</span><span className="shrink-0">aviso 70 % · pausa 80 %</span></div>
      {/* Celular: una sola línea; escritorio: el detalle en tres columnas. */}
      <p className="mt-3 border-t border-slate-100 pt-2.5 text-[12px] text-slate-500 md:hidden">
        Se reinicia {reset.charAt(0).toLowerCase() + reset.slice(1)} · <span className={`font-semibold ${charges ? "text-amber-700" : "text-slate-700"}`}>{charges ? "Podría cobrar" : "No cobra"}</span>
      </p>
      <dl className="mt-4 hidden grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-[12px] md:grid">
        <div><dt className="text-slate-400">Qué cuenta</dt><dd className="font-semibold text-slate-700">{what}</dd></div>
        <div><dt className="text-slate-400">Se reinicia</dt><dd className="font-semibold text-slate-700">{reset}</dd></div>
        <div><dt className="text-slate-400">Si se pasa</dt><dd className={`font-semibold ${charges ? "text-amber-700" : "text-slate-700"}`}>{charges ? "Podría cobrar" : "No cobra: se detiene"}</dd></div>
      </dl>
    </div>
  );
};

const DAY_LABEL = (date: string, today: string) =>
  date === today ? "Hoy" : new Date(`${date}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: "short" }).replace(".", "");

/**
 * Columnas de un solo dato: mensajes de conexión por día, con las líneas del aviso (70 %) y de
 * la pausa (80 %). La escala se ajusta a los datos; si el consumo está lejos del límite, las
 * líneas quedan fuera y se dice.
 */
const DailyChart: React.FC<{ daily: Array<{ date: string; requests: number }>; limit: number }> = ({ daily, limit }) => {
  const today = new Date().toISOString().slice(0, 10);
  const top = Math.max(...daily.map((d) => d.requests), 1);
  const max = top >= limit * 0.6 ? limit : Math.max(10, Math.ceil((top * 1.25) / 10) * 10);
  const h = 190, w = 560, left = 52, bottom = 22, slot = (w - left) / Math.max(daily.length, 1);
  const y = (v: number) => h - bottom - (v / max) * (h - bottom - 12);
  const ticks = [0, max / 2, max];
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Mensajes de conexión por día, últimos 7 días">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={left - 8} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{number(Math.round(t))}</text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = left + i * slot + slot / 2 - 12;
          const top = y(d.requests);
          const isToday = d.date === today;
          const pct = d.requests / limit;
          return (
            <g key={d.date}>
              <title>{`${DAY_LABEL(d.date, today)}: ${number(d.requests)} mensajes (${percent(pct)} del límite)`}</title>
              <rect x={x - 6} y={12} width={36} height={h - bottom - 12} fill="transparent" />
              {d.requests > 0 && (
                <path d={`M${x},${h - bottom} V${Math.min(top + 4, h - bottom)} q0,-4 4,-4 h16 q4,0 4,4 V${h - bottom} Z`} fill={pct >= 0.8 ? "#ef4444" : pct >= 0.7 ? "#f59e0b" : isToday ? "#14b8a6" : "#99f6e4"} />
              )}
              <text x={x + 12} y={h - 7} textAnchor="middle" className={`text-[10px] ${isToday ? "fill-slate-700 font-bold" : "fill-slate-400"}`}>{DAY_LABEL(d.date, today)}</text>
              {isToday && <text x={x + 12} y={top - 6} textAnchor="middle" className="fill-slate-700 text-[10px] font-bold">{number(d.requests)}</text>}
            </g>
          );
        })}
        {max >= limit * 0.7 && (
          <>
            <line x1={left} x2={w} y1={y(limit * 0.7)} y2={y(limit * 0.7)} stroke="#f59e0b" strokeWidth="1" />
            <text x={left + 4} y={y(limit * 0.7) - 4} className="fill-slate-500 text-[9.5px]">aviso 70 %</text>
            <line x1={left} x2={w} y1={y(limit * 0.8)} y2={y(limit * 0.8)} stroke="#ef4444" strokeWidth="1" />
            <text x={left + 4} y={y(limit * 0.8) - 4} className="fill-slate-500 text-[9.5px]">pausa 80 %</text>
          </>
        )}
      </svg>
      {max < limit * 0.7 && (
        <p className="mt-1 text-[11.5px] text-slate-500">Lejos del límite: el día más alto llegó al {percent(top / limit)} de {number(limit)}.</p>
      )}
    </>
  );
};

type MonthRow = Awaited<ReturnType<typeof backupModuleApi.monthByUnget>>[number];

const MONTH_PAGE = 10;

const lastLabel = (lastAt: string | null) =>
  lastAt ? (limaDay(lastAt) === limaDay(Date.now()) ? "Hoy" : new Date(lastAt).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" })) : "Nunca";

/** Pestaña «Consumo» (solo el administrador): el plan gratuito de Cloudflare al detalle. */
export const BackupConsumptionTab: React.FC = () => {
  const manager = useBackupManager();
  const usage = manager.usage;
  const [month, setMonth] = useState<MonthRow[] | null>(null);
  const [monthError, setMonthError] = useState("");
  const [monthPage, setMonthPage] = useState(1);
  const monthRows = month || [];
  const monthMobile = useIncrementalCount(monthRows.length, monthRows.length, 10);

  useEffect(() => {
    backupModuleApi.monthByUnget()
      .then((rows) => setMonth(rows.map((r) => ({ ...r, downloaded: Number(r.downloaded) || 0, failed: Number(r.failed) || 0, bytes: Number(r.bytes) || 0 }))))
      .catch((error) => setMonthError(error?.message || "No se pudo cargar el resumen del mes."));
  }, [manager.version]);

  const get = (key: string) => usage?.items.find((i) => i.key === key);
  const used = (item?: UsageItem, unit = "") => (item?.used == null ? "sin dato" : `${number(item.used)} de ${number(item.limit)}${unit}`);
  const r2 = ["r2ClassA", "r2ClassB", "r2Storage"].map(get).filter((i): i is UsageItem => Boolean(i));
  const r2Ratio = r2.some((i) => i.ratio != null) ? Math.max(...r2.map((i) => i.ratio ?? 0)) : null;
  const r2Used = r2.every((i) => i.used == null) ? "sin dato"
    : `escrituras ${number(get("r2ClassA")?.used ?? 0)} · lecturas ${number(get("r2ClassB")?.used ?? 0)} · ${number(get("r2Storage")?.used ?? 0)} GB`;
  const resetDay = "Hoy a las 19:00";
  const resetMonth = `1 de ${nextMonthName()}`;

  const level = usage?.level || "unknown";
  const worst = usage?.worst;
  const banner = level === "paused"
    ? { tone: "border-red-200 bg-red-50/70", icon: <ShieldAlert className="h-5 w-5" />, iconTone: "bg-red-100 text-red-700", title: "Descargas en pausa", titleTone: "text-red-900", textTone: "text-red-800" }
    : level === "warn"
      ? { tone: "border-amber-200 bg-amber-50/70", icon: <AlertTriangle className="h-5 w-5" />, iconTone: "bg-amber-100 text-amber-700", title: "Cerca del tope", titleTone: "text-amber-900", textTone: "text-amber-800" }
      : level === "unknown"
        ? { tone: "border-slate-200 bg-white", icon: <AlertTriangle className="h-5 w-5" />, iconTone: "bg-slate-100 text-slate-500", title: "Sin medición", titleTone: "text-slate-800", textTone: "text-slate-600" }
        : { tone: "border-emerald-200 bg-emerald-50/70", icon: <ShieldCheck className="h-5 w-5" />, iconTone: "bg-emerald-100 text-emerald-700", title: "Sin riesgo de cobro", titleTone: "text-emerald-900", textTone: "text-emerald-800" };
  const bannerText = level === "unknown"
    ? `Cloudflare no respondió las métricas${usage?.error ? ` (${usage.error})` : ""}. Las descargas siguen permitidas.`
    : level === "paused"
      ? <>Un límite llegó al 80 %: <b>{worst?.label}, {percent(worst?.ratio || 0)}</b>. Se reanudan cuando se reinicie.</>
      : level === "warn"
        ? <>El dato más alto es <b>{worst?.label}, {percent(worst?.ratio || 0)}</b>. Al 80 % se pausan las descargas.</>
        : <>Ningún límite llegó al 70 %. El dato más alto es <b>{worst?.label}, {percent(worst?.ratio || 0)}</b>.</>;

  if (!usage) {
    return <div className="flex h-48 items-center justify-center gap-2 text-sm font-semibold text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-teal-600" /> Midiendo el consumo…</div>;
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-2xl border p-4 md:items-center ${banner.tone}`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${banner.iconTone}`}>{banner.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[14px] font-black ${banner.titleTone}`}>{banner.title}</p>
          <p className={`text-[12.5px] ${banner.textTone}`}>{bannerText}</p>
          <p className="mt-1.5 text-[11.5px] font-semibold text-emerald-700 md:hidden">✓ Borrado a 1 día · ✓ Pausa al 80 % · ✓ Alerta $1</p>
        </div>
        <div className="hidden flex-wrap gap-1.5 text-[11.5px] font-bold md:flex">
          {["Borrado a 1 día en R2", "Pausa al 80 %", "Alerta de presupuesto $1"].map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" />{c}</span>
          ))}
        </div>
      </div>

      <div className="px-1 md:flex md:items-center md:gap-2">
        <p className="text-[12px] font-black uppercase tracking-wider text-slate-500">Límites del plan gratuito de Cloudflare</p>
        <div className="mt-0.5 flex flex-1 items-center gap-2 md:mt-0">
          <span className="text-[11.5px] text-slate-400"><span className="hidden md:inline">· </span>medido {new Date(usage.at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
          <button type="button" onClick={manager.refreshUsage} className="ml-auto text-[12px] font-bold text-teal-700 hover:underline">Volver a medir</button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LimitCard icon={<PlugZap className="h-5 w-5" />} label="Conexiones hoy" ratio={get("doRequests")?.ratio ?? null} used={used(get("doRequests"))} what="Mensajes de las PC y de la web" reset={resetDay} charges={false} />
        <LimitCard icon={<Server className="h-5 w-5" />} label="Peticiones hoy" ratio={get("workers")?.ratio ?? null} used={used(get("workers"))} what="Subidas, descargas y conexiones nuevas" reset={resetDay} charges={false} />
        <LimitCard icon={<Timer className="h-5 w-5" />} label="Tiempo activo hoy" ratio={get("doDuration")?.ratio ?? null} used={used(get("doDuration"), " GB-s")} what="Tiempo que el servicio estuvo despierto" reset={resetDay} charges={false} />
        <LimitCard icon={<CloudUpload className="h-5 w-5" />} label="Nube R2 del mes" ratio={r2Ratio} used={r2Used} what="Backups de paso en la nube" reset={resetMonth} charges />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] font-black text-slate-800">Mensajes de conexión por día</p>
          <p className="mb-3 text-[11.5px] text-slate-400">Últimos 7 días · el límite es {number(100000)} al día · se cuentan en hora UTC</p>
          {usage.daily?.length ? <DailyChart daily={usage.daily} limit={get("doRequests")?.limit || 100000} /> : <p className="py-6 text-[12.5px] text-slate-400">Sin datos de Cloudflare todavía.</p>}
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 pt-5">
            <p className="text-[13px] font-black text-slate-800">Backups del mes por UNGET</p>
            <p className="mb-3 text-[11.5px] text-slate-400">{new Date().toLocaleDateString("es-PE", { month: "long", year: "numeric" })} · lo que movió cada jurisdicción</p>
          </div>
          {monthError ? <p className="px-5 pb-5 text-[12.5px] text-amber-700">{monthError}</p> : !month ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-[12.5px] text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
          ) : (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50">
                  <tr>
                    <TableHeaderCell>UNGET</TableHeaderCell>
                    <TableHeaderCell align="right">Descargados</TableHeaderCell>
                    <TableHeaderCell align="right">Fallidos</TableHeaderCell>
                    <TableHeaderCell align="right">Tamaño</TableHeaderCell>
                    <TableHeaderCell>Último</TableHeaderCell>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {month.slice((monthPage - 1) * MONTH_PAGE, monthPage * MONTH_PAGE).map((r) => (
                    <tr key={r.ungetId} className="h-11">
                      <td className="px-4 font-semibold text-slate-700">{r.unget}</td>
                      <td className="px-4 text-right font-mono font-bold text-slate-800">{r.downloaded}</td>
                      <td className={`px-4 text-right font-mono ${r.failed ? "font-bold text-red-600" : "text-slate-400"}`}>{r.failed}</td>
                      <td className="px-4 text-right font-mono text-slate-600">{r.bytes ? formatMegabytes(r.bytes) : "—"}</td>
                      <td className="px-4 text-slate-500">{lastLabel(r.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination page={monthPage} pageSize={MONTH_PAGE} total={month.length} onPageChange={setMonthPage} itemLabel="UNGET" />
            </div>
            {/* Celular: una tarjeta por UNGET. */}
            <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden">
              {month.slice(0, monthMobile.count).map((r) => (
                <li key={r.ungetId} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-bold text-slate-800">{r.unget}</span>
                    <span className="shrink-0 text-[11.5px] text-slate-400">Último: {lastLabel(r.lastAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    <b className="text-slate-800">{r.downloaded}</b> descargados · <b className={r.failed ? "text-red-600" : "text-slate-400"}>{r.failed}</b> fallidos{r.bytes ? ` · ${formatMegabytes(r.bytes)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <div className="md:hidden">
              <LoadMoreSentinel hasMore={monthMobile.hasMore} onLoadMore={monthMobile.loadMore} shown={monthMobile.count} total={month.length} itemLabel="UNGET" />
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
