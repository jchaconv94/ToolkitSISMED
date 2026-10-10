/**
 * Gráficos y tarjetas del Excel de Disponibilidad, dibujados en un lienzo y guardados como PNG
 * (diseño aprobado por el usuario el 2026-10-06: tablero A con las tarjetas de la B). ExcelJS no
 * crea gráficos nativos de Excel, así que van como imágenes nítidas (a doble resolución).
 *
 * Funciona donde exista `OffscreenCanvas` (el Worker de la exportación y los navegadores
 * actuales). Sin lienzo —por ejemplo en las pruebas— cada función devuelve `null` y el Excel se
 * arma sin las imágenes.
 */

export interface ChartImage {
  png: ArrayBuffer;
  width: number;
  height: number;
}

type Ctx = OffscreenCanvasRenderingContext2D;

const SCALE = 2;
const FONT = '"Segoe UI", Calibri, Arial, sans-serif';
export const CHART_COLORS = {
  ink: "#0F172A",
  muted: "#64748B",
  line: "#E2E8F0",
  track: "#F1F5F9",
  level: { OPTIMO: "#059669", ALTO: "#0D9488", REGULAR: "#D97706", BAJO: "#DC2626" } as Record<string, string>,
  zone: { OPTIMO: "#BBF7D0", ALTO: "#CFFAFE", REGULAR: "#FEF3C7", BAJO: "#FEE2E2" } as Record<string, string>,
  zoneText: { OPTIMO: "#047857", ALTO: "#0F766E", REGULAR: "#B45309", BAJO: "#B91C1C" } as Record<string, string>,
};

export const canDrawCharts = () => typeof OffscreenCanvas !== "undefined";

const canvas = (w: number, h: number): { c: OffscreenCanvas; x: Ctx } | null => {
  if (!canDrawCharts()) return null;
  const c = new OffscreenCanvas(Math.round(w * SCALE), Math.round(h * SCALE));
  const x = c.getContext("2d") as Ctx | null;
  if (!x) return null;
  x.scale(SCALE, SCALE);
  x.textBaseline = "alphabetic";
  return { c, x };
};

const finish = async (c: OffscreenCanvas, width: number, height: number): Promise<ChartImage> => ({
  png: await (await c.convertToBlob({ type: "image/png" })).arrayBuffer(),
  width,
  height,
});

const font = (x: Ctx, size: number, weight: 400 | 600 | 700 | 800 = 400) => { x.font = `${weight} ${size}px ${FONT}`; };

const text = (x: Ctx, s: string, px: number, py: number, o: { size?: number; weight?: 400 | 600 | 700 | 800; color?: string; align?: CanvasTextAlign } = {}) => {
  font(x, o.size ?? 12, o.weight ?? 400);
  x.fillStyle = o.color ?? CHART_COLORS.ink;
  x.textAlign = o.align ?? "left";
  x.fillText(s, px, py);
};

/** Recorta un texto con «…» para que entre en `max` píxeles. */
const fit = (x: Ctx, s: string, max: number) => {
  if (x.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && x.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
};

const roundRect = (x: Ctx, px: number, py: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  x.beginPath();
  x.moveTo(px + rr, py);
  x.arcTo(px + w, py, px + w, py + h, rr);
  x.arcTo(px + w, py + h, px, py + h, rr);
  x.arcTo(px, py + h, px, py, rr);
  x.arcTo(px, py, px + w, py, rr);
  x.closePath();
};

/** Marco de tarjeta: fondo blanco, borde fino, esquinas redondeadas y título en mayúsculas. */
const card = (x: Ctx, w: number, h: number, title?: string, accent?: string) => {
  roundRect(x, 1, 1, w - 2, h - 2, 10);
  x.fillStyle = "#FFFFFF";
  x.fill();
  x.strokeStyle = CHART_COLORS.line;
  x.lineWidth = 1;
  x.stroke();
  if (accent) {
    x.save();
    roundRect(x, 1, 1, w - 2, h - 2, 10);
    x.clip();
    x.fillStyle = accent;
    x.fillRect(0, 0, w, 4);
    x.restore();
  }
  if (title) text(x, title.toUpperCase(), 18, accent ? 30 : 28, { size: 12.5, weight: 800 });
};

export const pctLabel = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;
const num = (v: number) => Math.round(v).toLocaleString("en-US").replace(/,/g, " ");

/* ------------------------------------------------------------------ Tarjetas KPI */

export interface KpiSpec {
  label: string;
  value: string;
  hint: string;
  color: string;
  /** 0–100: barra de avance bajo el valor. */
  progress?: number | null;
}

export const kpiCard = async (k: KpiSpec, w: number, h = 126): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, undefined, k.color);
  font(x, 11.5, 700);
  text(x, fit(x, k.label.toUpperCase(), w - 36), 18, 32, { size: 11.5, weight: 700, color: CHART_COLORS.muted });
  text(x, k.value, 18, 74, { size: 34, weight: 800, color: k.color });
  font(x, 12.5);
  text(x, fit(x, k.hint, w - 36), 18, 96, { size: 12.5, color: CHART_COLORS.muted });
  if (k.progress != null) {
    roundRect(x, 18, 106, w - 36, 7, 3.5);
    x.fillStyle = CHART_COLORS.track;
    x.fill();
    roundRect(x, 18, 106, Math.max(7, ((w - 36) * Math.min(100, Math.max(0, k.progress))) / 100), 7, 3.5);
    x.fillStyle = k.color;
    x.fill();
  }
  return finish(c, w, h);
};

/** Tarjeta pequeña para encima de las tablas: etiqueta, valor y pista. */
export const miniKpiCard = async (k: KpiSpec, w: number, h = 78): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, undefined, k.color);
  font(x, 10.5, 700);
  text(x, fit(x, k.label.toUpperCase(), w - 28), 14, 24, { size: 10.5, weight: 700, color: CHART_COLORS.muted });
  text(x, k.value, 14, 52, { size: 24, weight: 800, color: k.color });
  font(x, 11);
  text(x, fit(x, k.hint, w - 28), 14, 68, { size: 11, color: CHART_COLORS.muted });
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Velocímetro */

export const gaugeCard = async (o: { title: string; pct: number; level: string; levelLabel: string; caption: string; levels: { optimo: number; alto: number; regular: number } }, w: number, h: number): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, o.title);
  const lo = Math.max(0, Math.min(40, o.levels.regular - 30));
  const cx = w / 2, cy = 66 + 135, r = 122, sw = 26;
  const ang = (p: number) => Math.PI * (1 + Math.min(Math.max((p - lo) / (100 - lo), 0), 1));
  const arc = (a: number, b: number, col: string) => { x.beginPath(); x.arc(cx, cy, r, a, b); x.strokeStyle = col; x.lineWidth = sw; x.lineCap = "butt"; x.stroke(); };
  const zones: Array<[number, number, string]> = [
    [lo, o.levels.regular, "#FCA5A5"], [o.levels.regular, o.levels.alto, "#FCD34D"], [o.levels.alto, o.levels.optimo, "#5EEAD4"], [o.levels.optimo, 100, "#6EE7B7"],
  ];
  zones.forEach(([a, b, col]) => arc(ang(a), ang(b), col));
  arc(Math.PI, ang(o.pct), CHART_COLORS.level[o.level] || CHART_COLORS.ink);
  [o.levels.regular, o.levels.alto, o.levels.optimo].forEach((t) => {
    const a = ang(t);
    text(x, String(t), cx + (r + 24) * Math.cos(a), cy + (r + 24) * Math.sin(a) + 4, { size: 11, color: CHART_COLORS.muted, align: "center" });
  });
  const a = ang(o.pct);
  x.beginPath();
  x.moveTo(cx, cy);
  x.lineTo(cx + (r - 8) * Math.cos(a), cy + (r - 8) * Math.sin(a));
  x.strokeStyle = CHART_COLORS.ink;
  x.lineWidth = 4;
  x.lineCap = "round";
  x.stroke();
  x.beginPath();
  x.arc(cx, cy, 8, 0, Math.PI * 2);
  x.fillStyle = CHART_COLORS.ink;
  x.fill();
  text(x, pctLabel(o.pct), cx, cy + 62, { size: 46, weight: 800, color: CHART_COLORS.level[o.level], align: "center" });
  text(x, o.caption, cx, cy + 90, { size: 15, weight: 700, align: "center" });
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Columnas por nivel */

export const levelColumnsCard = async (o: { title: string; items: Array<{ level: string; label: string; count: number; range: string }> }, w: number, h: number): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, o.title);
  const max = Math.max(1, ...o.items.map((i) => i.count));
  const n = o.items.length, bw = Math.min(110, (w - 60) / n - 30), gap = (w - n * bw) / (n + 1);
  const base = h - 70, top = 90, plot = base - top;
  o.items.forEach((it, i) => {
    const px = gap + i * (bw + gap), bh = it.count ? Math.max(4, (it.count / max) * plot) : 3;
    roundRect(x, px, base - bh, bw, bh, 6);
    x.fillStyle = CHART_COLORS.level[it.level];
    x.fill();
    text(x, String(it.count), px + bw / 2, base - bh - 10, { size: 26, weight: 800, align: "center" });
    text(x, it.label, px + bw / 2, base + 24, { size: 14, weight: 700, align: "center" });
    text(x, it.range, px + bw / 2, base + 42, { size: 11.5, color: CHART_COLORS.muted, align: "center" });
  });
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Dona */

export const donutCard = async (o: { title: string; parts: Array<{ label: string; value: number; color: string }>; center: string; centerSub: string }, w: number, h: number): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, o.title);
  const total = o.parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = Math.min(86, (h - 70) / 2), cx = 20 + r + 10, cy = 50 + (h - 50) / 2;
  let acc = -Math.PI / 2;
  for (const p of o.parts) {
    if (!p.value) continue;
    const a = (p.value / total) * Math.PI * 2;
    x.beginPath();
    x.arc(cx, cy, r - 17, acc, acc + a);
    x.strokeStyle = p.color;
    x.lineWidth = 34;
    x.stroke();
    // Separación fina entre segmentos.
    x.beginPath();
    x.moveTo(cx + (r - 34) * Math.cos(acc), cy + (r - 34) * Math.sin(acc));
    x.lineTo(cx + r * Math.cos(acc), cy + r * Math.sin(acc));
    x.strokeStyle = "#FFFFFF";
    x.lineWidth = 2;
    x.stroke();
    acc += a;
  }
  text(x, o.center, cx, cy + 8, { size: 26, weight: 800, align: "center" });
  text(x, o.centerSub, cx, cy + 28, { size: 12, color: CHART_COLORS.muted, align: "center" });
  // Leyenda con valor y porcentaje, dentro de la tarjeta.
  const lx = cx + r + 22, right = w - 16, rowH = 30;
  let ly = cy - (o.parts.length * rowH) / 2 + 18;
  for (const p of o.parts) {
    roundRect(x, lx, ly - 11, 12, 12, 3);
    x.fillStyle = p.color;
    x.fill();
    text(x, p.label, lx + 20, ly, { size: 13.5 });
    text(x, pctLabel((p.value / total) * 100), right, ly, { size: 13, color: CHART_COLORS.muted, align: "right" });
    text(x, num(p.value), right - 66, ly, { size: 13.5, weight: 700, align: "right" });
    ly += rowH;
  }
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Barras horizontales */

export const hBarsCard = async (o: { title: string; items: Array<{ label: string; pct: number; level: string }>; levels: { optimo: number; alto: number; regular: number } }, w: number, h: number): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, o.title);
  const min = Math.max(0, Math.min(50, Math.floor((Math.min(...o.items.map((i) => i.pct), o.levels.regular) - 10) / 10) * 10));
  font(x, 13);
  const left = Math.min(220, Math.max(110, ...o.items.map((i) => x.measureText(i.label).width + 30)));
  const plotW = w - left - 80, top = 54, bottom = h - 30;
  const rowH = Math.min(40, (bottom - top) / Math.max(1, o.items.length));
  const px = (p: number) => left + ((p - min) / (100 - min)) * plotW;
  [o.levels.regular, o.levels.alto, o.levels.optimo].forEach((t) => {
    x.beginPath();
    x.setLineDash([3, 3]);
    x.moveTo(px(t), top - 4);
    x.lineTo(px(t), bottom - 4);
    x.strokeStyle = "#94A3B8";
    x.lineWidth = 1;
    x.stroke();
    x.setLineDash([]);
    text(x, `${t} %`, px(t), bottom + 12, { size: 11, color: CHART_COLORS.muted, align: "center" });
  });
  o.items.forEach((it, i) => {
    const y = top + i * rowH;
    const bh = Math.min(22, rowH - 10);
    font(x, 13);
    text(x, fit(x, it.label, left - 20), left - 12, y + bh / 2 + 9, { size: 13, align: "right" });
    roundRect(x, left, y + 4, Math.max(4, px(it.pct) - left), bh, 4);
    x.fillStyle = CHART_COLORS.level[it.level];
    x.fill();
    text(x, pctLabel(it.pct), px(it.pct) + 8, y + bh / 2 + 9, { size: 13, weight: 700 });
  });
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Ranking con franjas */

export const rankingCard = async (o: { title: string; items: Array<{ label: string; pct: number; level: string }>; levels: { optimo: number; alto: number; regular: number } }, w: number, h: number): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h, o.title);
  const n = o.items.length;
  const lo = Math.max(0, Math.min(40, Math.floor((Math.min(...o.items.map((i) => i.pct), o.levels.regular) - 10) / 10) * 10));
  // A la derecha, fuera del área de barras, los nombres de las franjas.
  const top = 56, bottom = n > 50 ? 80 : 118, left = 44, right = w - 64;
  const plotH = h - top - bottom, plotW = right - left;
  const py = (p: number) => top + plotH - ((p - lo) / (100 - lo)) * plotH;
  // Franjas de nivel de fondo.
  const bands: Array<[string, number, number]> = [["BAJO", lo, o.levels.regular], ["REGULAR", o.levels.regular, o.levels.alto], ["ALTO", o.levels.alto, o.levels.optimo], ["OPTIMO", o.levels.optimo, 100]];
  const names: Record<string, string> = { BAJO: "Bajo", REGULAR: "Regular", ALTO: "Alto", OPTIMO: "Óptimo" };
  for (const [lv, a, b] of bands) {
    if (b <= lo) continue;
    x.fillStyle = CHART_COLORS.zone[lv];
    x.fillRect(left, py(b), plotW, py(Math.max(a, lo)) - py(b));
    text(x, names[lv], right + 8, (py(b) + py(Math.max(a, lo))) / 2 + 4, { size: 11.5, weight: 700, color: CHART_COLORS.zoneText[lv] });
  }
  for (let t = lo; t <= 100; t += 10) text(x, String(t), left - 8, py(t) + 4, { size: 10.5, color: CHART_COLORS.muted, align: "right" });
  const step = plotW / Math.max(1, n), bw = Math.max(3, Math.min(34, step - (n > 60 ? 2 : 6)));
  o.items.forEach((it, i) => {
    const cx = left + step * (i + 0.5);
    const yTop = py(Math.max(lo, it.pct));
    roundRect(x, cx - bw / 2, yTop, bw, py(lo) - yTop, Math.min(3, bw / 3));
    x.fillStyle = CHART_COLORS.level[it.level];
    x.fill();
    if (n <= 60) text(x, String(Math.round(it.pct)), cx, yTop - 5, { size: n > 40 ? 8.5 : 9.5, weight: 700, color: "#334155", align: "center" });
    if (n <= 80) {
      x.save();
      x.translate(cx + 3, py(lo) + 10);
      x.rotate(-Math.PI / 3);
      font(x, n > 50 ? 9 : 10.5);
      text(x, fit(x, it.label, (bottom - 14) / Math.sin(Math.PI / 3)), 0, 0, { size: n > 50 ? 9 : 10.5, color: "#334155", align: "right" });
      x.restore();
    }
  });
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Tarjeta de hallazgo */

export const findingCard = async (o: { index: number; big: string; title: string; text: string; color: string }, w: number, h = 96): Promise<ChartImage | null> => {
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  card(x, w, h);
  x.save();
  roundRect(x, 1, 1, w - 2, h - 2, 10);
  x.clip();
  x.fillStyle = o.color;
  x.fillRect(0, 0, 7, h);
  x.restore();
  font(x, 32, 800);
  const bigW = Math.max(150, x.measureText(o.big).width + 40);
  text(x, o.big, 20 + bigW / 2, h / 2 + 12, { size: 32, weight: 800, color: o.color, align: "center" });
  const tx = 20 + bigW + 10;
  font(x, 15.5, 800);
  text(x, fit(x, `${o.index}. ${o.title}`, w - tx - 20), tx, h / 2 - 6, { size: 15.5, weight: 800 });
  // Texto en hasta dos líneas.
  font(x, 13);
  const words = o.text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const t = cur ? `${cur} ${wd}` : wd;
    if (x.measureText(t).width > w - tx - 24 && cur) { lines.push(cur); cur = wd; } else cur = t;
  }
  if (cur) lines.push(cur);
  lines.slice(0, 2).forEach((l, i) => text(x, i === 1 && lines.length > 2 ? fit(x, `${l} ${lines.slice(2).join(" ")}`, w - tx - 24) : l, tx, h / 2 + 16 + i * 17, { size: 13, color: CHART_COLORS.muted }));
  return finish(c, w, h);
};

/* ------------------------------------------------------------------ Marca */

/**
 * Marca de Toolkit SISMED para la cabecera oscura: el símbolo de las cuatro piezas con la cruz
 * naranja y el nombre (mismo dibujo que `BrandLogo`, tono oscuro). `h` es el alto en píxeles.
 */
export const brandImage = async (h = 30): Promise<ChartImage | null> => {
  const probe = canvas(10, 10);
  if (!probe) return null;
  const nameSize = h * 0.62;
  font(probe.x, nameSize, 600);
  const wToolkit = probe.x.measureText("Toolkit ").width;
  font(probe.x, nameSize, 800);
  const wSismed = probe.x.measureText("SISMED").width;
  const mark = h, gap = h * 0.35;
  const w = Math.ceil(mark + gap + wToolkit + wSismed + 4);
  const cv = canvas(w, h);
  if (!cv) return null;
  const { c, x } = cv;
  const k = mark / 64;
  const piece = (px: number, py: number, pw: number, ph: number, r: number, col: string) => { roundRect(x, px * k, py * k, pw * k, ph * k, r * k); x.fillStyle = col; x.fill(); };
  piece(3, 3, 26, 26, 7, "#2bb3a0");
  piece(35, 3, 26, 26, 7, "#5fd0be");
  piece(3, 35, 26, 26, 7, "#ffffff");
  piece(43.25, 35, 9.5, 26, 3.5, "#f28c28");
  piece(35, 43.25, 26, 9.5, 3.5, "#f28c28");
  const base = h * 0.72;
  text(x, "Toolkit ", mark + gap, base, { size: nameSize, weight: 600, color: "#ffffff" });
  text(x, "SISMED", mark + gap + wToolkit, base, { size: nameSize, weight: 800, color: "#5fd0be" });
  return finish(c, w, h);
};
