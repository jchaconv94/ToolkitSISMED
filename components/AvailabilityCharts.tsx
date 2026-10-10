import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StockStatus } from "../types";
import type { DmeLevel } from "../services/stockStatus";
import type { LevelThresholds } from "../services/availabilityReport";
import { formatNumber } from "../services/numberFormat";
import { useIsDesktop } from "./ui/useIsDesktop";

/**
 * Gráficos del módulo Disponibilidad (2026-10-07), en SVG y HTML: velocímetro, dona, columnas
 * por nivel, barras horizontales, ranking con franjas de nivel y consumo mensual con su CPA.
 * Los colores son los mismos del Excel (`services/availabilityCharts.ts`).
 */

export const LEVEL_COLOR: Record<DmeLevel, string> = { OPTIMO: "#10b981", ALTO: "#0d9488", REGULAR: "#d97706", BAJO: "#dc2626" };
// Fondos de las franjas de nivel: Óptimo (verde) y Alto (celeste) en tonos bien distintos, sin opacidad encima.
export const LEVEL_SOFT: Record<DmeLevel, string> = { OPTIMO: "#bbf7d0", ALTO: "#cffafe", REGULAR: "#fef3c7", BAJO: "#fee2e2" };
export const STATUS_COLOR: Record<StockStatus, string> = {
  [StockStatus.NORMOSTOCK]: "#10b981",
  [StockStatus.SOBRESTOCK]: "#3b82f6",
  [StockStatus.SUBSTOCK]: "#f59e0b",
  [StockStatus.SIN_ROTACION]: "#94a3b8",
  [StockStatus.DESABASTECIDO]: "#ef4444",
};

const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;

/* ---------------------------------------------------------------- Recuadro al pasar el mouse */

type TipState = { x: number; y: number; content: React.ReactNode } | null;

/**
 * Recuadro que sigue al mouse sobre un gráfico. `bind(contenido)` se pone en cada elemento
 * (barra, segmento) y `layer` se dibuja una vez en el gráfico.
 */
export const useChartTip = () => {
  const [tip, setTip] = useState<TipState>(null);
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);
  const bind = (content: React.ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
  });
  const flip = tip ? tip.x > window.innerWidth - 280 : false;
  const layer = tip
    ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[100002] max-w-[260px] rounded-xl bg-slate-900 px-3 py-2 text-[12px] text-white shadow-xl"
          style={{ left: tip.x + (flip ? -14 : 14), top: tip.y + 14, transform: flip ? "translateX(-100%)" : undefined }}
        >
          {tip.content}
        </div>,
        document.body,
      )
    : null;
  return { bind, layer, hide: () => setTip(null) };
};

/** Contenido del recuadro: título con su color y filas etiqueta–valor. */
export const TipBox: React.FC<{ title: string; color?: string; rows?: Array<[string, React.ReactNode]>; note?: string }> = ({ title, color, rows = [], note }) => (
  <>
    <span className="flex items-center gap-2 font-bold">
      {color && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />}
      <span className="min-w-0">{title}</span>
    </span>
    {rows.map(([k, v]) => (
      <span key={k} className="mt-0.5 flex justify-between gap-4 text-slate-300"><span>{k}</span><b className="font-mono text-white">{v}</b></span>
    ))}
    {note && <span className="mt-1 block text-[11px] text-slate-400">{note}</span>}
  </>
);

/* ---------------------------------------------------------------- Tarjeta de gráfico */

import { InfoTip } from "./ui/InfoTip";

export { InfoTip };

/** Tarjeta blanca con título en mayúsculas, ícono «i» opcional y acción a la derecha. */
export const ChartCard: React.FC<{
  title: string;
  info?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, info, action, className = "", children }) => (
  <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5 ${className}`}>
    <div className="mb-3 flex min-h-[24px] items-center gap-1.5">
      <h3 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">{title}</h3>
      {info && <InfoTip title={title}>{info}</InfoTip>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
    {children}
  </section>
);

/* ---------------------------------------------------------------- Velocímetro */

export const Gauge: React.FC<{ pct: number; level: DmeLevel; levels: LevelThresholds; caption: string }> = ({ pct, level, levels, caption }) => {
  const cx = 160, cy = 150, r = 112, w = 26;
  const min = 40;
  const angle = (v: number) => Math.PI * (1 - (Math.min(100, Math.max(min, v)) - min) / (100 - min));
  const point = (v: number, radius: number) => [cx + radius * Math.cos(angle(v)), cy - radius * Math.sin(angle(v))];
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from, r);
    const [x2, y2] = point(to, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const zones: Array<[number, number, DmeLevel]> = [[min, levels.regular, "BAJO"], [levels.regular, levels.alto, "REGULAR"], [levels.alto, levels.optimo, "ALTO"], [levels.optimo, 100, "OPTIMO"]];
  const [nx, ny] = point(pct, r - 30);
  const tip = useChartTip();
  const zoneLabel: Record<DmeLevel, string> = { OPTIMO: "Óptimo", ALTO: "Alto", REGULAR: "Regular", BAJO: "Bajo" };
  const zoneRange = (a: number, b: number, l: DmeLevel) => (l === "BAJO" ? `menos de ${b} %` : l === "OPTIMO" ? `${a} % o más` : `${a} a ${b} %`);
  return (
    <div className="flex flex-col items-center">
      {tip.layer}
      <svg viewBox="0 0 320 172" className="w-full max-w-[340px]" role="img" aria-label={`Disponibilidad ${pct1(pct)}`}>
        {zones.map(([a, b, l]) => (
          <path key={l} d={arc(a, b)} stroke={LEVEL_COLOR[l]} strokeOpacity={l === level ? 1 : 0.28} strokeWidth={w} fill="none" className="cursor-default transition-[stroke-opacity] hover:[stroke-opacity:0.9]"
            {...tip.bind(<TipBox title={`Nivel ${zoneLabel[l]}`} color={LEVEL_COLOR[l]} rows={[["Rango", zoneRange(a, b, l)]]} note={l === level ? `Aquí está la UNGET: ${pct1(pct)}` : undefined} />)} />
        ))}
        {[levels.regular, levels.alto, levels.optimo].map((v) => {
          const [tx, ty] = point(v, r + 24);
          return <text key={v} x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className="fill-slate-400 text-[11px] font-semibold">{v}</text>;
        })}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#0f172a" strokeWidth={4} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={9} fill="#0f172a" />
      </svg>
      <p className="-mt-1 text-[40px] font-black leading-none md:text-[46px]" style={{ color: LEVEL_COLOR[level] }}>{pct1(pct)}</p>
      <p className="mt-1.5 text-center text-[13px] font-bold text-slate-700">{caption}</p>
    </div>
  );
};

/* ---------------------------------------------------------------- Dona */

export interface DonutSegment { key: string; label: string; value: number; color: string }

export const Donut: React.FC<{
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  onSelect?: (key: string) => void;
  selected?: string | null;
}> = ({ segments, centerValue, centerLabel, onSelect, selected }) => {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 70, c = 2 * Math.PI * r;
  const [hover, setHover] = useState<string | null>(null);
  const tip = useChartTip();
  const focus = hover ?? selected ?? null;
  const focused = segments.find((s) => s.key === focus);
  let offset = 0;
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-10">
      {tip.layer}
      <div className="relative w-[200px] shrink-0">
        <svg viewBox="0 0 180 180" className="w-full -rotate-90" onMouseLeave={() => setHover(null)}>
          {segments.map((s) => {
            const len = (s.value / total) * c;
            const dim = focus && focus !== s.key;
            const el = (
              <circle
                key={s.key}
                cx={90} cy={90} r={r} fill="none" stroke={s.color} strokeWidth={focus === s.key ? 30 : dim ? 20 : 26}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
                className={`transition-all duration-150 ${onSelect ? "cursor-pointer" : ""}`}
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(s.key)}
                onClick={onSelect ? () => onSelect(s.key) : undefined}
                {...tip.bind(<TipBox title={s.label} color={s.color} rows={[["Ítems", formatNumber(s.value)], ["Del total", pct1((s.value / total) * 100)]]} />)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[26px] font-black leading-none" style={{ color: focused?.color ?? "#0f172a" }}>{focused ? formatNumber(focused.value) : centerValue}</span>
          <span className="mt-1 max-w-[110px] text-[12px] font-semibold leading-tight text-slate-500">{focused ? focused.label : centerLabel}</span>
        </div>
      </div>
      <ul className="w-full max-w-[340px] space-y-1">
        {segments.map((s) => {
          const share = (s.value / total) * 100;
          return (
            <li key={s.key}>
              <button
                type="button"
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onClick={onSelect ? () => onSelect(s.key) : undefined}
                className={`w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${onSelect ? "cursor-pointer" : "cursor-default"} ${focus === s.key ? "bg-slate-100" : "hover:bg-slate-50"} ${focus && focus !== s.key ? "opacity-60" : ""}`}
              >
                <span className="grid grid-cols-[12px_1fr_auto_52px] items-center gap-x-2.5 text-[13.5px]">
                  <span className="h-3 w-3 rounded-[4px]" style={{ background: s.color }} />
                  <span className="truncate font-semibold text-slate-700">{s.label}</span>
                  <span className="font-mono font-bold text-slate-900">{formatNumber(s.value)}</span>
                  <span className="text-right font-mono text-[12.5px] text-slate-400">{pct1(share)}</span>
                </span>
                <span className="ml-[22px] mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full" style={{ width: `${share}%`, background: s.color }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/* ---------------------------------------------------------------- Columnas por nivel */

export const LevelColumns: React.FC<{
  counts: Record<DmeLevel, number>;
  ranges: Record<DmeLevel, string>;
  labels: Record<DmeLevel, string>;
  onSelect?: (level: DmeLevel) => void;
  selected?: DmeLevel | null;
}> = ({ counts, ranges, labels, onSelect, selected }) => {
  const levels: DmeLevel[] = ["OPTIMO", "ALTO", "REGULAR", "BAJO"];
  const max = Math.max(1, ...levels.map((l) => counts[l]));
  const total = levels.reduce((a, l) => a + counts[l], 0) || 1;
  const [hover, setHover] = useState<DmeLevel | null>(null);
  const tip = useChartTip();
  const focus = hover ?? selected ?? null;
  return (
    <div className="grid h-[230px] grid-cols-4 items-end gap-3 md:gap-6">
      {tip.layer}
      {levels.map((l) => (
        <button
          key={l}
          type="button"
          disabled={!onSelect}
          onClick={onSelect ? () => onSelect(l) : undefined}
          onMouseEnter={() => setHover(l)}
          {...(() => { const b = tip.bind(<TipBox title={`Nivel ${labels[l]}`} color={LEVEL_COLOR[l]} rows={[["Establecimientos", counts[l]], ["Del total", pct1((counts[l] / total) * 100)], ["Rango", ranges[l]]]} note={onSelect ? "Clic para ver la lista" : undefined} />); return { onMouseMove: b.onMouseMove, onMouseLeave: () => { b.onMouseLeave(); setHover(null); } }; })()}
          className={`group flex h-full flex-col items-center justify-end rounded-xl pb-1 transition-opacity ${focus && focus !== l ? "opacity-40" : ""}`}
        >
          <span className="mb-1.5 text-[22px] font-black text-slate-900">{counts[l]}</span>
          <span
            className="w-full max-w-[96px] rounded-t-lg transition-all group-hover:brightness-110"
            style={{ height: `${Math.max(3, (counts[l] / max) * 150)}px`, background: LEVEL_COLOR[l] }}
          />
          <span className="mt-2 text-[13px] font-black text-slate-800">{labels[l]}</span>
          <span className="text-[11.5px] text-slate-400">{ranges[l]}</span>
        </button>
      ))}
    </div>
  );
};

/* ---------------------------------------------------------------- Barras horizontales */

export interface HBarRow { key: string; label: string; value: number; color: string; text?: string; sub?: string }

/** Barras horizontales en HTML (se adaptan al ancho). `max` fija la escala; `marks`, las líneas guía. */
export const HBars: React.FC<{
  rows: HBarRow[];
  max?: number;
  marks?: number[];
  onSelect?: (key: string) => void;
  labelWidth?: string;
}> = ({ rows, max, marks = [], onSelect, labelWidth = "w-28 md:w-40" }) => {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  const tip = useChartTip();
  return (
    <div className="space-y-2">
      {tip.layer}
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          disabled={!onSelect}
          onClick={onSelect ? () => onSelect(r.key) : undefined}
          {...tip.bind(<TipBox title={r.label} color={r.color} rows={[["Valor", r.text ?? r.value]]} note={[r.sub, onSelect ? "Clic para abrir" : ""].filter(Boolean).join(" · ") || undefined} />)}
          className={`group flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-slate-50 ${onSelect ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className={`${labelWidth} shrink-0`}>
            <span className="block truncate text-[13px] font-semibold text-slate-700" title={r.label}>{r.label}</span>
            {r.sub && <span className="block truncate text-[11px] text-slate-400">{r.sub}</span>}
          </span>
          <span className="relative h-7 min-w-0 flex-1 rounded-md bg-slate-100">
            {marks.map((m) => (
              <span key={m} className="absolute inset-y-[-3px] w-px border-l border-dashed border-slate-300" style={{ left: `${(m / top) * 100}%` }} />
            ))}
            <span className="absolute inset-y-0 left-0 rounded-md transition-[filter] group-hover:brightness-110" style={{ width: `${Math.max(1.5, Math.min(100, (r.value / top) * 100))}%`, background: r.color }} />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[12.5px] font-bold text-slate-800 md:w-20 md:text-[13px]">{r.text ?? r.value}</span>
        </button>
      ))}
      {marks.length > 0 && (
        <div className="hidden items-center gap-3 md:flex">
          <span className={`${labelWidth} shrink-0`} />
          <span className="relative h-4 min-w-0 flex-1">
            {marks.map((m) => (
              <span key={m} className="absolute -translate-x-1/2 text-[11px] text-slate-400" style={{ left: `${(m / top) * 100}%` }}>{m} %</span>
            ))}
          </span>
          <span className="w-16 shrink-0 md:w-20" />
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- Ranking con franjas de nivel */

export interface RankRow { key: string; label: string; pct: number; level: DmeLevel }

export const RankingChart: React.FC<{ rows: RankRow[]; levels: LevelThresholds; labels: Record<DmeLevel, string>; onSelect?: (key: string) => void }> = ({ rows, levels, labels, onSelect }) => {
  const sorted = [...rows].sort((a, b) => b.pct - a.pct);
  const minPct = Math.max(0, Math.min(40, Math.floor((Math.min(...sorted.map((r) => r.pct), 100) - 5) / 10) * 10));
  const slot = 34, left = 40, right = 72, top = 12, plotH = 300, bottom = 128;
  const width = left + right + Math.max(sorted.length, 10) * slot;
  const height = top + plotH + bottom;
  const y = (v: number) => top + plotH - ((Math.max(minPct, Math.min(100, v)) - minPct) / (100 - minPct)) * plotH;
  const bands: Array<[number, number, DmeLevel]> = [[levels.optimo, 100, "OPTIMO"], [levels.alto, levels.optimo, "ALTO"], [levels.regular, levels.alto, "REGULAR"], [minPct, levels.regular, "BAJO"]];
  const ticks = [];
  for (let v = minPct; v <= 100; v += 10) ticks.push(v);
  const [hover, setHover] = useState<string | null>(null);
  const tip = useChartTip();
  return (
    <div className="scrollbar-x overflow-x-auto">
      {tip.layer}
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: Math.min(width, 900) }} className="w-full" role="img" aria-label="Ranking de establecimientos">
        {bands.map(([a, b, l]) => (
          <g key={l}>
            <rect x={left} y={y(b)} width={width - left - right} height={Math.max(0, y(a) - y(b))} fill={LEVEL_SOFT[l]} />
            <text x={width - right + 8} y={(y(a) + y(b)) / 2} dominantBaseline="middle" className="text-[12px] font-bold" fill={LEVEL_COLOR[l]}>{labels[l]}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 text-[11px]">{t}</text>
        ))}
        {sorted.map((r, i) => {
          const x = left + i * slot + 5;
          const bw = slot - 10;
          return (
            <g
              key={r.key}
              className={onSelect ? "cursor-pointer" : ""}
              onClick={onSelect ? () => onSelect(r.key) : undefined}
              onMouseEnter={() => setHover(r.key)}
              opacity={hover && hover !== r.key ? 0.45 : 1}
              {...(() => { const b = tip.bind(<TipBox title={r.label} color={LEVEL_COLOR[r.level]} rows={[["Disponibilidad", pct1(r.pct)], ["Nivel", labels[r.level]], ["Puesto", `${i + 1} de ${sorted.length}`]]} note={onSelect ? "Clic para abrir el establecimiento" : undefined} />); return { onMouseMove: b.onMouseMove, onMouseLeave: () => { b.onMouseLeave(); setHover(null); } }; })()}
            >
              <rect x={x - 4} y={top} width={bw + 8} height={plotH} fill="transparent" />
              <rect x={x} y={y(r.pct)} width={bw} height={top + plotH - y(r.pct)} rx={3} fill={LEVEL_COLOR[r.level]} />
              <text x={x + bw / 2} y={y(r.pct) - 6} textAnchor="middle" className="fill-slate-700 text-[11px] font-bold">{Math.round(r.pct)} %</text>
              <text x={x + bw / 2} y={top + plotH + 10} transform={`rotate(-50 ${x + bw / 2} ${top + plotH + 10})`} textAnchor="end" className="fill-slate-600 text-[11px]">
                {r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ---------------------------------------------------------------- Historial mes a mes */

/**
 * Disponibilidad mes a mes guardada en el historial (2026-10-09), sobre las franjas de nivel:
 * el año elegido en línea continua y el anterior punteado. Un mes sin guardar corta la línea
 * (no se inventa el punto) y uno con menos establecimientos que el resto va hueco con borde
 * ámbar. El mes elegido lleva una franja detrás.
 */
export const HistoryChart: React.FC<{
  labels: string[];
  /** Nombre largo de cada mes para el recuadro («Septiembre 2026»). */
  titles: string[];
  values: Array<number | null>;
  previous: Array<number | null>;
  currentLabel: string;
  previousLabel: string;
  previousTitles: string[];
  /** Establecimientos con datos cada mes y el total esperado. */
  coverage: Array<{ establishments: number; expected: number }>;
  selected: number | null;
  onSelect?: (index: number) => void;
  levels: LevelThresholds;
  levelLabels: Record<DmeLevel, string>;
  levelOf: (pct: number) => DmeLevel;
}> = ({ labels, titles, values, previous, currentLabel, previousLabel, previousTitles, coverage, selected, onSelect, levels, levelLabels, levelOf }) => {
  const n = labels.length;
  const compact = !useIsDesktop();
  const all = [...values, ...previous].filter((v): v is number => v !== null);
  const minPct = Math.max(0, Math.min(levels.regular - 10, Math.floor((Math.min(...all, 100) - 5) / 10) * 10));
  const left = compact ? 28 : 36, right = compact ? 6 : 64, top = 22, plotH = compact ? 190 : 220, bottom = 30;
  // Comparte la fila con el ranking (mitad del ancho): meses más juntos para que la letra no se achique.
  const slot = compact ? 27 : 40;
  const width = left + right + n * slot;
  const height = top + plotH + bottom;
  const y = (v: number) => top + plotH - ((Math.max(minPct, Math.min(100, v)) - minPct) / (100 - minPct)) * plotH;
  const x = (i: number) => left + i * slot + slot / 2;
  const bands: Array<[number, number, DmeLevel]> = [[levels.optimo, 100, "OPTIMO"], [levels.alto, levels.optimo, "ALTO"], [levels.regular, levels.alto, "REGULAR"], [minPct, levels.regular, "BAJO"]];
  const ticks: number[] = [];
  for (let v = minPct; v <= 100; v += compact ? 20 : 10) ticks.push(v);
  const [hover, setHover] = useState<number | null>(null);
  const tip = useChartTip();
  // Tramos entre meses seguidos con dato: un mes sin guardar corta la línea.
  const path = (series: Array<number | null>) => {
    let d = "";
    series.forEach((v, i) => {
      if (v === null) return;
      d += `${i > 0 && series[i - 1] !== null ? "L" : "M"}${x(i)},${y(v)} `;
    });
    return d.trim();
  };
  const incomplete = (i: number) => coverage[i] && coverage[i].establishments > 0 && coverage[i].establishments < coverage[i].expected;
  return (
    <div>
      {tip.layer}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Disponibilidad mes a mes, ${currentLabel} y ${previousLabel}`}>
        {bands.map(([a, b, l]) => (
          <g key={l}>
            <rect x={left} y={y(b)} width={width - left - right} height={Math.max(0, y(a) - y(b))} fill={LEVEL_SOFT[l]} />
            {!compact && <text x={width - right + 8} y={(y(a) + y(b)) / 2} dominantBaseline="middle" className="text-[11.5px] font-bold" fill={LEVEL_COLOR[l]}>{levelLabels[l]}</text>}
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 text-[10.5px]">{t}</text>
        ))}
        <path d={path(previous)} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" />
        {previous.map((v, i) => (v === null ? null : <circle key={`p${i}`} cx={x(i)} cy={y(v)} r={3} fill="#fff" stroke="#94a3b8" strokeWidth={1.5} />))}
        <path d={path(values)} fill="none" stroke="#0f766e" strokeWidth={2.5} strokeLinejoin="round" />
        {labels.map((label, i) => {
          const v = values[i], p = previous[i];
          const cov = coverage[i];
          const rows: Array<[string, React.ReactNode]> = [];
          if (v !== null) rows.push([currentLabel, pct1(v)], ["Nivel", levelLabels[levelOf(v)]]);
          if (p !== null) rows.push([previousTitles[i], pct1(p)]);
          if (v !== null && p !== null) rows.push(["Variación", `${v - p >= 0 ? "+" : "−"}${Math.abs(v - p).toFixed(1).replace(".", ",")} pp`]);
          if (v !== null && cov) rows.push(["Establecimientos", `${formatNumber(cov.establishments)} de ${formatNumber(cov.expected)}`]);
          const b = tip.bind(<TipBox title={titles[i]} color={v !== null ? LEVEL_COLOR[levelOf(v)] : undefined} rows={rows} note={v === null ? "Mes sin guardar" : incomplete(i) ? "Faltan establecimientos en este mes" : undefined} />);
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseMove={b.onMouseMove}
              onMouseLeave={() => { b.onMouseLeave(); setHover(null); }}
              onClick={() => v !== null && onSelect?.(i)}
              className={v !== null && onSelect ? "cursor-pointer" : undefined}
            >
              <rect x={x(i) - slot / 2} y={top} width={slot} height={plotH + bottom} fill="transparent" />
              {/* Línea punteada del punto al eje (pedido del usuario); el mes elegido o señalado, más oscura. */}
              {v !== null ? (
                <line x1={x(i)} x2={x(i)} y1={y(v)} y2={top + plotH} stroke={selected === i || hover === i ? "#334155" : "#94a3b8"} strokeWidth={selected === i ? 2 : 1.5} strokeDasharray="4 4" />
              ) : hover === i && <line x1={x(i)} x2={x(i)} y1={top} y2={top + plotH} stroke="#cbd5e1" strokeDasharray="3 3" />}
              {v !== null && (
                <circle cx={x(i)} cy={y(v)} r={hover === i || selected === i ? 6.5 : compact ? 4.5 : 5.5} fill={incomplete(i) ? "#fff" : LEVEL_COLOR[levelOf(v)]} stroke={incomplete(i) ? "#d97706" : "#fff"} strokeWidth={2} />
              )}
              {v !== null && !compact && (
                <text x={x(i)} y={y(v) - 11} textAnchor="middle" className="fill-slate-700 text-[10px] font-bold" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{pct1(v)}</text>
              )}
              <text x={x(i)} y={top + plotH + 19} textAnchor="middle" className={`text-[10.5px] ${selected === i ? "fill-slate-900 font-black" : v === null ? "fill-slate-300" : "fill-slate-600 font-semibold"}`}>{label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** Leyenda del historial: año elegido (línea) y año anterior (punteada). */
export const HistoryLegend: React.FC<{ current: string; previous: string }> = ({ current, previous }) => (
  <span className="flex items-center gap-3 text-[11.5px] font-semibold text-slate-500">
    <span className="flex items-center gap-1.5"><svg width="18" height="8" aria-hidden><line x1="1" y1="4" x2="17" y2="4" stroke="#0f766e" strokeWidth="2.5" /></svg>{current}</span>
    <span className="flex items-center gap-1.5"><svg width="18" height="8" aria-hidden><line x1="1" y1="4" x2="17" y2="4" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" /></svg>{previous}</span>
  </span>
);

/* ---------------------------------------------------------------- Consumo mensual con CPA */

export const MonthlyBars: React.FC<{
  values: number[];
  labels: string[];
  cpa?: number;
  /** Meses resaltados en rojo (todos los que empatan en el máximo, por ejemplo). */
  highlight?: number[] | null;
  height?: number;
  color?: string;
  /** Texto de la línea punteada (por omisión «CPA»). */
  lineLabel?: string;
  /** Formato corto de las etiquetas sobre las barras y del eje. */
  format?: (v: number) => string;
  /** Formato completo para el recuadro del mouse (por omisión, `format`). */
  fullFormat?: (v: number) => string;
  /** Ancho de cada mes en el dibujo (más ancho si las etiquetas son largas). */
  slot?: number;
}> = ({ values, labels, cpa, highlight = null, height = 200, color = "#0d9488", lineLabel = "CPA", format = (v) => formatNumber(Math.round(v)), fullFormat, slot = 48 }) => {
  const n = values.length;
  const full = fullFormat ?? format;
  const left = 52, right = 12, top = 30, bottom = 26;
  const width = left + right + n * slot;
  const plotH = height - top - bottom;
  const max = Math.max(1, cpa ?? 0, ...values) * 1.1;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const [hover, setHover] = useState<number | null>(null);
  const tip = useChartTip();
  if (!values.some((v) => v > 0)) {
    return <p className="grid place-items-center rounded-xl bg-slate-50 text-[13px] text-slate-500" style={{ height: height - 40 }}>Sin consumo en el periodo.</p>;
  }
  return (
    <>
    {tip.layer}
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Consumo mensual" onMouseLeave={() => setHover(null)}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={left} x2={width - right} y1={y(max * f / 1.1)} y2={y(max * f / 1.1)} stroke="#e2e8f0" />
          <text x={left - 6} y={y(max * f / 1.1)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 text-[10px]">{format(max * f / 1.1)}</text>
        </g>
      ))}
      {cpa !== undefined && cpa > 0 && (
        <g pointerEvents="none">
          <line x1={left} x2={width - right} y1={y(cpa)} y2={y(cpa)} stroke="#0f172a" strokeDasharray="5 4" strokeWidth={1.5} />
          {/* La línea va detrás de las barras y la leyenda arriba, fuera de ellas, para no tapar sus valores. */}
          {/* La leyenda de la línea va arriba, fuera de las barras, para no tapar sus valores. */}
          {(() => {
            const text = `${lineLabel} ${cpa >= 100 ? full(cpa) : cpa.toFixed(1).replace(".", ",")}`;
            const x0 = width - right - text.length * 6.1 - 30;
            return (
              <>
                <line x1={x0} x2={x0 + 22} y1={10} y2={10} stroke="#0f172a" strokeDasharray="5 4" strokeWidth={1.5} />
                <text x={x0 + 28} y={10} dominantBaseline="middle" className="fill-slate-700 text-[10.5px] font-bold">{text}</text>
              </>
            );
          })()}
        </g>
      )}
      {values.map((v, i) => {
        const x = left + i * slot + 9;
        const bw = slot - 18;
        const hl = !!highlight?.includes(i);
        return (
          <g
            key={i}
            onMouseEnter={() => setHover(i)}
            {...tip.bind(<TipBox title={labels[i]} color={hl ? "#dc2626" : color} rows={[["Valor", full(v)], ...(cpa ? [[lineLabel, cpa >= 100 ? full(cpa) : cpa.toFixed(1).replace(".", ",")] as [string, string], ["Frente a la línea", cpa > 0 ? `${v >= cpa ? "+" : ""}${Math.round(((v - cpa) / cpa) * 100)} %` : "—"] as [string, string]] : [])]} note={hl ? "Mes de mayor consumo" : undefined} />)}
          >
            <rect x={left + i * slot + 2} y={top} width={slot - 4} height={plotH} rx={6} fill={hover === i ? "#f1f5f9" : "transparent"} />
            <rect x={x} y={y(v)} width={bw} height={Math.max(0, top + plotH - y(v))} rx={3} fill={hl ? "#dc2626" : color} opacity={hover === i ? 1 : highlight?.length && !hl ? 0.8 : 1} />
            {v > 0 && <text x={x + bw / 2} y={y(v) - 4} textAnchor="middle" stroke="#ffffff" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round" className="fill-slate-600 text-[10px] font-bold">{format(v)}</text>}
            <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
    </>
  );
};

/** Línea pequeña de consumo, para tablas. */
export const Sparkline: React.FC<{ values: number[]; highlight?: number | null; width?: number; height?: number }> = ({ values, highlight = null, width = 120, height = 30 }) => {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, height - 3 - (v / max) * (height - 6)]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#0d9488" strokeWidth={1.8} strokeLinejoin="round" />
      {highlight !== null && pts[highlight] && <circle cx={pts[highlight][0]} cy={pts[highlight][1]} r={3.2} fill="#dc2626" />}
    </svg>
  );
};

/** Barra apilada de situaciones (una fila de tabla). */
export const StackBar: React.FC<{ parts: Array<{ value: number; color: string; label: string }>; className?: string }> = ({ parts, className = "h-2.5 w-40" }) => {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const tip = useChartTip();
  return (
    <span className={`mx-auto flex overflow-hidden rounded-full bg-slate-100 ${className}`} {...tip.bind(
      <>{parts.map((p) => <span key={p.label} className="flex items-center justify-between gap-4"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />{p.label}</span><b className="font-mono">{formatNumber(p.value)} · {pct1((p.value / total) * 100)}</b></span>)}</>,
    )}>
      {tip.layer}
      {parts.map((p) => p.value > 0 && <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
    </span>
  );
};
