import React, { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { StockStatus } from "../types";
import type { DmeLevel } from "../services/stockStatus";
import type { LevelThresholds } from "../services/availabilityReport";
import { BottomSheet } from "./ui/BottomSheet";
import { useIsDesktop } from "./ui/useIsDesktop";
import { formatNumber } from "../services/numberFormat";

/**
 * Gráficos del módulo Disponibilidad (2026-10-07), en SVG y HTML: velocímetro, dona, columnas
 * por nivel, barras horizontales, ranking con franjas de nivel y consumo mensual con su CPA.
 * Los colores son los mismos del Excel (`services/availabilityCharts.ts`).
 */

export const LEVEL_COLOR: Record<DmeLevel, string> = { OPTIMO: "#10b981", ALTO: "#0d9488", REGULAR: "#d97706", BAJO: "#dc2626" };
export const LEVEL_SOFT: Record<DmeLevel, string> = { OPTIMO: "#d1fae5", ALTO: "#ccfbf1", REGULAR: "#fef3c7", BAJO: "#fee2e2" };
export const STATUS_COLOR: Record<StockStatus, string> = {
  [StockStatus.NORMOSTOCK]: "#10b981",
  [StockStatus.SOBRESTOCK]: "#3b82f6",
  [StockStatus.SUBSTOCK]: "#f59e0b",
  [StockStatus.SIN_ROTACION]: "#94a3b8",
  [StockStatus.DESABASTECIDO]: "#ef4444",
};

const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;

/* ---------------------------------------------------------------- Tarjeta de gráfico */

/** Explicación detrás de un ícono «i»: en escritorio, un recuadro bajo el ícono; en el celular, un panel inferior. */
export const InfoTip: React.FC<{ title: string; children: React.ReactNode; align?: "left" | "right" }> = ({ title, children, align = "left" }) => {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open || !isDesktop) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [open, isDesktop]);
  return (
    <span ref={box} className="relative inline-flex align-middle normal-case tracking-normal">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label={`Qué es: ${title}`}
        aria-expanded={open}
        className={`grid h-6 w-6 place-items-center rounded-full transition-colors ${open ? "bg-teal-50 text-teal-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}
      >
        <Info className="h-4 w-4" />
      </button>
      {isDesktop ? (
        open && (
          <span role="dialog" aria-label={title} className={`absolute top-8 z-40 w-[340px] rounded-xl border border-slate-200 bg-white p-4 text-left text-[12.5px] font-normal leading-relaxed text-slate-600 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
            <span className="mb-1.5 block text-[13px] font-black text-slate-900">{title}</span>
            {children}
          </span>
        )
      ) : (
        <BottomSheet open={open} title={title} onClose={() => setOpen(false)}>
          <div className="pb-4 text-[14px] leading-relaxed text-slate-600">{children}</div>
        </BottomSheet>
      )}
    </span>
  );
};

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
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 320 172" className="w-full max-w-[340px]" role="img" aria-label={`Disponibilidad ${pct1(pct)}`}>
        {zones.map(([a, b, l]) => (
          <path key={l} d={arc(a, b)} stroke={LEVEL_COLOR[l]} strokeOpacity={l === level ? 1 : 0.28} strokeWidth={w} fill="none" />
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
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
      <div className="relative w-[190px] shrink-0">
        <svg viewBox="0 0 180 180" className="w-full -rotate-90">
          {segments.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.key}
                cx={90} cy={90} r={r} fill="none" stroke={s.color} strokeWidth={selected && selected !== s.key ? 18 : 26}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
                className={onSelect ? "cursor-pointer transition-all" : ""}
                opacity={selected && selected !== s.key ? 0.35 : 1}
                onClick={onSelect ? () => onSelect(s.key) : undefined}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-black leading-none text-slate-900">{centerValue}</span>
          <span className="mt-1 text-[12px] font-semibold text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {segments.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              className={`grid w-full grid-cols-[14px_1fr_auto_64px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors ${onSelect ? "hover:bg-slate-50" : ""} ${selected === s.key ? "bg-slate-100" : ""}`}
            >
              <span className="h-3 w-3 rounded-[4px]" style={{ background: s.color }} />
              <span className="truncate font-semibold text-slate-700">{s.label}</span>
              <span className="font-mono font-bold text-slate-900">{formatNumber(s.value)}</span>
              <span className="text-right font-mono text-slate-400">{pct1((s.value / total) * 100)}</span>
            </button>
          </li>
        ))}
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
  return (
    <div className="grid h-[230px] grid-cols-4 items-end gap-3 md:gap-6">
      {levels.map((l) => (
        <button
          key={l}
          type="button"
          disabled={!onSelect}
          onClick={onSelect ? () => onSelect(l) : undefined}
          className={`group flex h-full flex-col items-center justify-end rounded-xl pb-1 transition-opacity ${selected && selected !== l ? "opacity-40" : ""}`}
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
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          disabled={!onSelect}
          onClick={onSelect ? () => onSelect(r.key) : undefined}
          className={`flex w-full items-center gap-3 rounded-lg py-0.5 text-left ${onSelect ? "hover:bg-slate-50" : ""}`}
        >
          <span className={`${labelWidth} shrink-0`}>
            <span className="block truncate text-[13px] font-semibold text-slate-700" title={r.label}>{r.label}</span>
            {r.sub && <span className="block truncate text-[11px] text-slate-400">{r.sub}</span>}
          </span>
          <span className="relative h-7 min-w-0 flex-1 rounded-md bg-slate-100">
            {marks.map((m) => (
              <span key={m} className="absolute inset-y-[-3px] w-px border-l border-dashed border-slate-300" style={{ left: `${(m / top) * 100}%` }} />
            ))}
            <span className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(1.5, Math.min(100, (r.value / top) * 100))}%`, background: r.color }} />
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
  return (
    <div className="scrollbar-x overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: Math.min(width, 900) }} className="w-full" role="img" aria-label="Ranking de establecimientos">
        {bands.map(([a, b, l]) => (
          <g key={l}>
            <rect x={left} y={y(b)} width={width - left - right} height={Math.max(0, y(a) - y(b))} fill={LEVEL_SOFT[l]} opacity={0.75} />
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
            <g key={r.key} className={onSelect ? "cursor-pointer" : ""} onClick={onSelect ? () => onSelect(r.key) : undefined}>
              <title>{`${r.label}: ${pct1(r.pct)}`}</title>
              <rect x={x} y={y(r.pct)} width={bw} height={top + plotH - y(r.pct)} rx={3} fill={LEVEL_COLOR[r.level]} className="transition-opacity hover:opacity-80" />
              <text x={x + bw / 2} y={y(r.pct) - 6} textAnchor="middle" className="fill-slate-700 text-[11px] font-bold">{Math.round(r.pct)}</text>
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

/* ---------------------------------------------------------------- Consumo mensual con CPA */

export const MonthlyBars: React.FC<{
  values: number[];
  labels: string[];
  cpa?: number;
  highlight?: number | null;
  height?: number;
  color?: string;
  /** Texto de la línea punteada (por omisión «CPA»). */
  lineLabel?: string;
  /** Formato de los valores (por omisión, número entero). */
  format?: (v: number) => string;
}> = ({ values, labels, cpa, highlight = null, height = 190, color = "#0d9488", lineLabel = "CPA", format = (v) => formatNumber(Math.round(v)) }) => {
  const n = values.length;
  const left = 44, right = 12, top = 18, bottom = 26;
  const slot = 48;
  const width = left + right + n * slot;
  const plotH = height - top - bottom;
  const max = Math.max(1, cpa ?? 0, ...values) * 1.1;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Consumo mensual">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={left} x2={width - right} y1={y(max * f / 1.1)} y2={y(max * f / 1.1)} stroke="#e2e8f0" />
          <text x={left - 6} y={y(max * f / 1.1)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400 text-[10px]">{format(max * f / 1.1)}</text>
        </g>
      ))}
      {values.map((v, i) => {
        const x = left + i * slot + 9;
        const bw = slot - 18;
        const hl = highlight === i;
        return (
          <g key={i}>
            <rect x={x} y={y(v)} width={bw} height={Math.max(0, top + plotH - y(v))} rx={3} fill={hl ? "#dc2626" : color} opacity={highlight !== null && !hl ? 0.55 : 1} />
            {v > 0 && <text x={x + bw / 2} y={y(v) - 4} textAnchor="middle" className="fill-slate-600 text-[10px] font-bold">{format(v)}</text>}
            <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">{labels[i]}</text>
          </g>
        );
      })}
      {cpa !== undefined && cpa > 0 && (
        <g>
          <line x1={left} x2={width - right} y1={y(cpa)} y2={y(cpa)} stroke="#0f172a" strokeDasharray="5 4" strokeWidth={1.5} />
          <rect x={left + 2} y={y(cpa) - 9} width={(lineLabel.length + format(cpa).length + 2) * 6.2} height={18} rx={4} fill="#0f172a" />
          <text x={left + 8} y={y(cpa)} dominantBaseline="middle" className="fill-white text-[10.5px] font-bold">{lineLabel} {cpa >= 100 ? format(cpa) : cpa.toFixed(1).replace(".", ",")}</text>
        </g>
      )}
    </svg>
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
  return (
    <span className={`flex overflow-hidden rounded-full bg-slate-100 ${className}`}>
      {parts.map((p) => p.value > 0 && <span key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
    </span>
  );
};
