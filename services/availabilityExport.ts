import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { StockStatus } from "../types";
import { DME_LEVEL_LABEL, ipressCodeOf, type AvailabilityItem, type AvailabilityReport, type TformdetMonthSheet } from "./availabilityReport";
import type { DmeLevel } from "./stockStatus";
import { formatNumber } from "./numberFormat";

/**
 * Excel del módulo Disponibilidad (rehecho el 2026-10-06, pedido del usuario: «es un reporte
 * que se comparte para que otros lo analicen, tiene que ser digno de análisis»).
 *
 * Hojas: Resumen (indicadores, niveles, microredes y situaciones), Establecimientos (ranking),
 * Microredes, Atención (desabastecidos, substock y vencimiento antes de uso), Productos por
 * establecimiento y por farmacia (detalle con consumo mensual agrupable), y Metodología (fórmula
 * y fuentes con que se calculó). Colores con significado, formatos numéricos, filtros, paneles
 * fijos y barras de datos en los porcentajes.
 */

export const STATUS_LABEL: Record<StockStatus, string> = {
  [StockStatus.DESABASTECIDO]: "Desabastecido",
  [StockStatus.SUBSTOCK]: "Substock",
  [StockStatus.NORMOSTOCK]: "Normostock",
  [StockStatus.SOBRESTOCK]: "Sobrestock",
  [StockStatus.SIN_ROTACION]: "Sin rotación",
};

const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const MONTH_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
/** `202609` → «set 2026». */
export const monthLabel = (key: string) => `${MONTH_NAMES[Number(key.slice(4, 6)) - 1] ?? key.slice(4, 6)} ${key.slice(0, 4)}`;
const monthFull = (key: string) => `${MONTH_FULL[Number(key.slice(4, 6)) - 1] ?? key.slice(4, 6)} ${key.slice(0, 4)}`;

/* ------------------------------------------------------------------ Estilo */

const C = {
  teal: "FF0F766E",
  tealSoft: "FFE6F4F1",
  ink: "FF0F172A",
  muted: "FF64748B",
  line: "FFE2E8F0",
  band: "FFF8FAFC",
  white: "FFFFFFFF",
  dark: "FF134E4A",
};
const LEVEL_FILL: Record<DmeLevel, [string, string]> = {
  OPTIMO: ["FFD1FAE5", "FF065F46"],
  ALTO: ["FFCCFBF1", "FF115E59"],
  REGULAR: ["FFFEF3C7", "FF92400E"],
  BAJO: ["FFFEE2E2", "FF991B1B"],
};
const STATUS_FILL: Record<StockStatus, [string, string]> = {
  [StockStatus.NORMOSTOCK]: ["FFD1FAE5", "FF065F46"],
  [StockStatus.SOBRESTOCK]: ["FFDBEAFE", "FF1E40AF"],
  [StockStatus.SUBSTOCK]: ["FFFEF3C7", "FF92400E"],
  [StockStatus.DESABASTECIDO]: ["FFFEE2E2", "FF991B1B"],
  [StockStatus.SIN_ROTACION]: ["FFF1F5F9", "FF334155"],
};
const FONT = "Calibri";
const thin = { style: "thin" as const, color: { argb: C.line } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const FMT = { int: "#,##0", dec1: "#,##0.0", pct: "0.0%", money: "#,##0.00", date: "dd/mm/yyyy" };

interface Col {
  header: string;
  width: number;
  fmt?: string;
  align?: "left" | "right" | "center";
}

/**
 * Tabla con cabecera teal, filas alternadas, bordes finos, filtro y paneles fijos. Devuelve la
 * fila de la cabecera y la última fila de datos.
 */
const writeTable = (ws: ExcelJS.Worksheet, startRow: number, cols: Col[], rows: unknown[][], opts: { freezeCols?: number; filter?: boolean } = {}) => {
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (!col.width || col.width < c.width) col.width = c.width;
  });
  const head = ws.getRow(startRow);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: C.white } };
    cell.fill = fill(C.teal);
    cell.alignment = { vertical: "middle", horizontal: c.align === "right" ? "right" : c.align === "center" ? "center" : "left", wrapText: true };
    cell.border = border;
  });
  head.height = 32;
  rows.forEach((values, r) => {
    const row = ws.getRow(startRow + 1 + r);
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      const c = cols[i];
      cell.font = { name: FONT, size: 10, color: { argb: C.ink } };
      if (c?.fmt) cell.numFmt = c.fmt;
      cell.alignment = { vertical: "middle", horizontal: c?.align || (typeof v === "number" ? "right" : "left") };
      cell.border = border;
      if (r % 2 === 1) cell.fill = fill(C.band);
    });
    row.height = 18;
  });
  const last = startRow + rows.length;
  if (opts.filter !== false && rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: last, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: startRow, xSplit: opts.freezeCols ?? 0, showGridLines: false }];
  return { head: startRow, last };
};

const paintLevel = (cell: ExcelJS.Cell, level: DmeLevel) => {
  const [bg, fg] = LEVEL_FILL[level];
  cell.fill = fill(bg);
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: fg } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
};
const paintStatus = (cell: ExcelJS.Cell, status: StockStatus) => {
  const [bg, fg] = STATUS_FILL[status];
  cell.fill = fill(bg);
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: fg } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
};
const dataBar = (ws: ExcelJS.Worksheet, ref: string) => {
  ws.addConditionalFormatting({
    ref,
    rules: [{ type: "dataBar", priority: 1, minLength: 0, maxLength: 100, gradient: false, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }], color: { argb: "FF14B8A6" } } as any],
  });
};
const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** Título de hoja: nombre grande, subtítulo y una línea teal. */
const sheetTitle = (ws: ExcelJS.Worksheet, title: string, subtitle: string, span: number) => {
  ws.mergeCells(1, 1, 1, span);
  ws.mergeCells(2, 1, 2, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 15, bold: true, color: { argb: C.ink } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, color: { argb: C.muted } };
  for (let i = 1; i <= span; i++) ws.getCell(3, i).border = { top: { style: "medium", color: { argb: C.teal } } };
  ws.getRow(3).height = 6;
};

const dateText = (d: Date | null) => (d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "");
const monthsValue = (m: number) => (Number.isFinite(m) ? Math.round(m * 10) / 10 : null);

/* ------------------------------------------------------------------ Libro */

export interface AvailabilityExportParams {
  report: AvailabilityReport;
  /** Disponibilidad de la otra vista (todos ↔ esenciales), para el resumen. */
  otherScopePct?: number | null;
  pharmacyItems: AvailabilityItem[] | null;
  months: string[];
  scope: "all" | "essential";
  title: string;
  formulaText: string;
  levels: { optimo: number; alto: number; regular: number };
  fusedVersion?: string;
  source: string;
  /** Nombre y profesión de quien lo generó (van en la portada). */
  preparedBy?: string;
  preparedByRole?: string;
  /** Registros del TFORMDET del mes de corte, para revisarlos en detalle. */
  tformdet?: TformdetMonthSheet | null;
}

export const buildAvailabilityWorkbook = (p: AvailabilityExportParams): ExcelJS.Workbook => {
  const { report, months, scope } = p;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Toolkit SISMED";
  wb.created = new Date();
  const scopeLabel = scope === "essential" ? "Medicamentos esenciales (DME)" : "Todos los productos";
  const cut = months[months.length - 1] || "";
  const period = months.length ? `${monthFull(months[0])} a ${monthFull(cut)} (${months.length} ${months.length === 1 ? "mes" : "meses"})` : "";
  const subtitle = `${p.title} · corte ${cut ? monthFull(cut) : "—"} · ${scopeLabel}`;
  const lv = p.levels;
  const levelRange: Record<DmeLevel, string> = {
    OPTIMO: `≥ ${lv.optimo} %`, ALTO: `${lv.alto} – ${lv.optimo} %`, REGULAR: `${lv.regular} – ${lv.alto} %`, BAJO: `< ${lv.regular} %`,
  };

  /* ---------------- Resumen (portada) ---------------- */
  // Portada pensada para compartir: banda oscura con el título y el responsable, el indicador
  // principal grande, un recuadro por nivel y por situación, mejores y peores establecimientos,
  // microredes y, al pie, la ficha técnica. 12 columnas iguales para armar los bloques.
  const rs = wb.addWorksheet("Resumen", { properties: { tabColor: { argb: C.teal } } });
  rs.columns = Array.from({ length: 12 }, () => ({ width: 11.5 }));
  const c = report.counts;
  const box = (r1: number, c1: number, r2: number, c2: number, value: ExcelJS.CellValue, style: Partial<ExcelJS.Style>) => {
    if (r1 !== r2 || c1 !== c2) rs.mergeCells(r1, c1, r2, c2);
    const cell = rs.getCell(r1, c1);
    cell.value = value;
    Object.assign(cell, style);
    return cell;
  };
  const paintArea = (r1: number, c1: number, r2: number, c2: number, argb: string) => {
    for (let r = r1; r <= r2; r++) for (let cc = c1; cc <= c2; cc++) rs.getCell(r, cc).fill = fill(argb);
  };
  const outline = (r1: number, c1: number, r2: number, c2: number, argb = C.line) => {
    const side = { style: "thin" as const, color: { argb } };
    for (let r = r1; r <= r2; r++) {
      for (let cc = c1; cc <= c2; cc++) {
        rs.getCell(r, cc).border = { top: r === r1 ? side : undefined, bottom: r === r2 ? side : undefined, left: cc === c1 ? side : undefined, right: cc === c2 ? side : undefined };
      }
    }
  };
  const pctText = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;

  // Banda del título
  paintArea(1, 1, 5, 12, C.dark);
  [1, 2, 3, 4, 5].forEach((r, i) => (rs.getRow(r).height = [10, 30, 20, 18, 10][i]));
  box(2, 1, 2, 8, `Disponibilidad de ${scope === "essential" ? "medicamentos esenciales" : "productos"}`, { font: { name: FONT, size: 22, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", indent: 1 } });
  box(3, 1, 3, 8, p.title, { font: { name: FONT, size: 13, bold: true, color: { argb: "FF99F6E4" } }, alignment: { vertical: "middle", indent: 1 } });
  box(4, 1, 4, 8, `Corte ${cut ? monthFull(cut) : "—"} · consumo ${period} · ${scopeLabel}`, { font: { name: FONT, size: 10, color: { argb: "FFCBD5E1" } }, alignment: { vertical: "middle", indent: 1 } });
  box(2, 9, 2, 12, "ELABORADO POR", { font: { name: FONT, size: 8, bold: true, color: { argb: "FF99F6E4" } }, alignment: { vertical: "bottom", horizontal: "right", indent: 1 } });
  box(3, 9, 3, 12, p.preparedBy || "—", { font: { name: FONT, size: 13, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "right", indent: 1 } });
  box(4, 9, 4, 12, [p.preparedByRole, new Date().toLocaleDateString("es-PE")].filter(Boolean).join(" · "), { font: { name: FONT, size: 10, color: { argb: "FFCBD5E1" } }, alignment: { vertical: "middle", horizontal: "right", indent: 1 } });

  // Indicador principal
  rs.getRow(6).height = 14;
  [7, 8, 9, 10, 11].forEach((r, i) => (rs.getRow(r).height = [18, 26, 30, 18, 18][i]));
  const [heroBg, heroFg] = LEVEL_FILL[report.level];
  paintArea(7, 1, 11, 4, heroBg);
  box(7, 1, 7, 4, scope === "essential" ? "DISPONIBILIDAD DME DE LA UNGET" : "DISPONIBILIDAD DE LA UNGET", { font: { name: FONT, size: 9, bold: true, color: { argb: heroFg } }, alignment: { vertical: "bottom", indent: 1 } });
  box(8, 1, 9, 4, report.pct / 100, { numFmt: "0.0 %", font: { name: FONT, size: 40, bold: true, color: { argb: heroFg } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
  box(10, 1, 10, 4, `Nivel ${DME_LEVEL_LABEL[report.level]} · ${report.establishments.length} establecimientos`, { font: { name: FONT, size: 10, bold: true, color: { argb: heroFg } }, alignment: { vertical: "middle", indent: 1 } });
  box(11, 1, 11, 4, p.otherScopePct != null ? `${scope === "essential" ? "Todos los productos" : "Medicamentos esenciales (DME)"}: ${pctText(p.otherScopePct)}` : `${formatNumber(c.total)} ítems evaluados`, { font: { name: FONT, size: 10, color: { argb: heroFg } }, alignment: { vertical: "top", indent: 1 } });
  outline(7, 1, 11, 4, heroFg);

  // Establecimientos por nivel
  const levels: DmeLevel[] = ["OPTIMO", "ALTO", "REGULAR", "BAJO"];
  levels.forEach((l, i) => {
    const col = 5 + i * 2;
    const [bg, fg] = LEVEL_FILL[l];
    box(7, col, 7, col + 1, DME_LEVEL_LABEL[l].toUpperCase(), { fill: fill(fg), font: { name: FONT, size: 9, bold: true, color: { argb: C.white } }, alignment: { horizontal: "center", vertical: "middle" } });
    paintArea(8, col, 11, col + 1, bg);
    box(8, col, 9, col + 1, report.establishments.filter((e) => e.level === l).length, { font: { name: FONT, size: 28, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(10, col, 10, col + 1, "establecimientos", { font: { name: FONT, size: 9, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(11, col, 11, col + 1, levelRange[l], { font: { name: FONT, size: 9, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "top" } });
    outline(7, col, 11, col + 1, fg);
  });

  const sectionTitle = (row: number, text: string, c1 = 1, c2 = 12) => {
    rs.getRow(row).height = 22;
    box(row, c1, row, c2, text, { font: { name: FONT, size: 12, bold: true, color: { argb: C.ink } }, alignment: { vertical: "bottom" } });
    for (let cc = c1; cc <= c2; cc++) rs.getCell(row, cc).border = { bottom: { style: "medium", color: { argb: C.teal } } };
  };

  // Situación de los ítems
  sectionTitle(13, "Situación de los ítems evaluados");
  rs.getRow(14).height = 6;
  const stTiles: Array<[StockStatus, number]> = [
    [StockStatus.NORMOSTOCK, c.normostock], [StockStatus.SOBRESTOCK, c.sobrestock], [StockStatus.SUBSTOCK, c.substock],
    [StockStatus.SIN_ROTACION, c.sinRotacion], [StockStatus.DESABASTECIDO, c.desabastecido],
  ];
  [15, 16, 17].forEach((r, i) => (rs.getRow(r).height = [18, 30, 18][i]));
  stTiles.forEach(([s, n], i) => {
    const col = 1 + i * 2;
    const [bg, fg] = STATUS_FILL[s];
    paintArea(15, col, 17, col + 1, bg);
    box(15, col, 15, col + 1, STATUS_LABEL[s], { font: { name: FONT, size: 10, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(16, col, 16, col + 1, n, { numFmt: FMT.int, font: { name: FONT, size: 22, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(17, col, 17, col + 1, c.total ? n / c.total : 0, { numFmt: "0.0 %\" del total\"", font: { name: FONT, size: 9, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    outline(15, col, 17, col + 1, fg);
  });
  paintArea(15, 11, 17, 12, C.band);
  box(15, 11, 15, 12, "Total ítems", { font: { name: FONT, size: 10, bold: true, color: { argb: C.muted } }, alignment: { horizontal: "center", vertical: "middle" } });
  box(16, 11, 16, 12, c.total, { numFmt: FMT.int, font: { name: FONT, size: 22, bold: true, color: { argb: C.ink } }, alignment: { horizontal: "center", vertical: "middle" } });
  box(17, 11, 17, 12, "producto × establecimiento", { font: { name: FONT, size: 9, color: { argb: C.muted } }, alignment: { horizontal: "center", vertical: "middle" } });
  outline(15, 11, 17, 12);

  // Tabla compacta con columnas que ocupan varias celdas.
  const spanTable = (row: number, cols: Array<{ header: string; span: number; fmt?: string; align?: "left" | "right" | "center" }>, rows: unknown[][], c1 = 1, paint?: (r: number, cell: (i: number) => ExcelJS.Cell) => void) => {
    const starts: number[] = [];
    let x = c1;
    cols.forEach((col) => { starts.push(x); x += col.span; });
    rs.getRow(row).height = 22;
    cols.forEach((col, i) => box(row, starts[i], row, starts[i] + col.span - 1, col.header, {
      fill: fill(C.teal), font: { name: FONT, size: 10, bold: true, color: { argb: C.white } },
      alignment: { vertical: "middle", horizontal: col.align || "left", indent: col.align === "right" || col.align === "center" ? 0 : 1 },
    }));
    rows.forEach((values, r) => {
      const rr = row + 1 + r;
      rs.getRow(rr).height = 19;
      cols.forEach((col, i) => {
        const cell = box(rr, starts[i], rr, starts[i] + col.span - 1, values[i] as ExcelJS.CellValue, {
          font: { name: FONT, size: 10, color: { argb: C.ink } },
          alignment: { vertical: "middle", horizontal: col.align || (typeof values[i] === "number" ? "right" : "left"), indent: col.align === "center" ? 0 : 1 },
        });
        if (col.fmt) cell.numFmt = col.fmt;
        if (r % 2 === 1) for (let cc = starts[i]; cc < starts[i] + col.span; cc++) rs.getCell(rr, cc).fill = fill(C.band);
        for (let cc = starts[i]; cc < starts[i] + col.span; cc++) rs.getCell(rr, cc).border = { bottom: thin };
      });
      paint?.(rr, (i) => rs.getCell(rr, starts[i]));
    });
    return row + rows.length;
  };

  // Mejores y peores establecimientos
  const byPct = report.establishments.slice().sort((a, b) => b.pct - a.pct);
  const topN = Math.min(5, Math.ceil(byPct.length / 2));
  const best = byPct.slice(0, topN);
  const worst = byPct.slice(-topN).reverse();
  sectionTitle(19, "Mayor disponibilidad", 1, 6);
  sectionTitle(19, "Menor disponibilidad", 7, 12);
  rs.getRow(20).height = 6;
  const estCols = [{ header: "Establecimiento", span: 4 }, { header: "%", span: 1, fmt: FMT.pct, align: "right" as const }, { header: "Nivel", span: 1, align: "center" as const }];
  const estRow = (e: (typeof byPct)[number]) => [`${e.name} (${e.code})`, e.pct / 100, DME_LEVEL_LABEL[e.level]];
  const endBest = spanTable(21, estCols, best.map(estRow), 1, (rr, cell) => paintLevel(cell(2), best[rr - 22].level));
  spanTable(21, estCols, worst.map(estRow), 7, (rr, cell) => paintLevel(cell(2), worst[rr - 22].level));

  // Microredes
  const mrStart = endBest + 2;
  sectionTitle(mrStart, "Disponibilidad por microred");
  rs.getRow(mrStart + 1).height = 6;
  const mrsSorted = report.microredes.slice().sort((a, b) => b.pct - a.pct);
  const mrEnd = spanTable(mrStart + 2, [
    { header: "Microred", span: 3 }, { header: "Establec.", span: 1, fmt: FMT.int, align: "right" }, { header: "Ítems", span: 1, fmt: FMT.int, align: "right" },
    { header: "Desabast.", span: 1, fmt: FMT.int, align: "right" }, { header: "Substock", span: 1, fmt: FMT.int, align: "right" }, { header: "Normo + Sobre", span: 2, fmt: FMT.int, align: "right" },
    { header: "Disponibilidad", span: 2, fmt: FMT.pct, align: "right" }, { header: "Nivel", span: 1, align: "center" },
  ], mrsSorted.map((m) => [m.microred, m.establishments, m.counts.total, m.counts.desabastecido, m.counts.substock, m.counts.normostock + m.counts.sobrestock, m.pct / 100, DME_LEVEL_LABEL[m.level]]),
  1, (rr, cell) => paintLevel(cell(7), mrsSorted[rr - mrStart - 3].level));
  dataBar(rs, `J${mrStart + 3}:J${mrEnd}`);

  // Ficha técnica
  const ft = mrEnd + 2;
  sectionTitle(ft, "Ficha técnica");
  const facts: Array<[string, string]> = [
    ["Fuente", p.source],
    ["Periodo de consumo", period],
    ["Fórmula", p.formulaText],
    ["Elaborado por", [p.preparedBy, p.preparedByRole].filter(Boolean).join(" · ") || "—"],
    ["Generado", `${new Date().toLocaleString("es-PE")} con Toolkit SISMED`],
  ];
  facts.forEach(([kk, v], i) => {
    const r = ft + 1 + i;
    box(r, 1, r, 2, kk, { font: { name: FONT, size: 9, bold: true, color: { argb: C.muted } }, alignment: { vertical: "top", indent: 1 } });
    box(r, 3, r, 12, v, { font: { name: FONT, size: 9, color: { argb: C.ink } }, alignment: { vertical: "top", wrapText: true } });
    rs.getRow(r).height = Math.max(16, Math.ceil(v.length / 120) * 13);
  });
  rs.views = [{ showGridLines: false }];
  rs.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  rs.headerFooter = { oddFooter: `&L&8${p.title} · Disponibilidad &R&8Página &P de &N` };

  /* ---------------- Establecimientos ---------------- */
  const es = wb.addWorksheet("Establecimientos");
  sheetTitle(es, "Ranking de establecimientos", subtitle, 13);
  const ranked = report.establishments.slice().sort((a, b) => b.pct - a.pct);
  const te = writeTable(es, 5, [
    { header: "N°", width: 5, align: "center" }, { header: "Microred", width: 20 }, { header: "Código", width: 9, align: "center" }, { header: "Establecimiento", width: 32 },
    { header: "Cat.", width: 6, align: "center" }, { header: "Desabast.", width: 10, fmt: FMT.int }, { header: "Substock", width: 10, fmt: FMT.int },
    { header: "Normostock", width: 11, fmt: FMT.int }, { header: "Sobrestock", width: 11, fmt: FMT.int }, { header: "Sin rotación", width: 11, fmt: FMT.int },
    { header: "Total ítems", width: 10, fmt: FMT.int }, { header: "Disponibilidad", width: 14, fmt: FMT.pct }, { header: "Nivel", width: 11, align: "center" },
  ], ranked.map((e, i) => [i + 1, e.microred, e.code, e.name, e.category, e.desabastecido, e.substock, e.normostock, e.sobrestock, e.sinRotacion, e.total, e.pct / 100, DME_LEVEL_LABEL[e.level]]), { freezeCols: 4 });
  ranked.forEach((e, i) => paintLevel(es.getCell(te.head + 1 + i, 13), e.level));
  for (let i = 0; i < ranked.length; i++) es.getCell(te.head + 1 + i, 6).font = { name: FONT, size: 10, color: { argb: "FFB91C1C" } };
  dataBar(es, `L${te.head + 1}:L${te.last}`);

  /* ---------------- Microredes ---------------- */
  const ms = wb.addWorksheet("Microredes");
  sheetTitle(ms, "Disponibilidad por microred", subtitle, 10);
  const mrs = report.microredes.slice().sort((a, b) => b.pct - a.pct);
  const tm = writeTable(ms, 5, [
    { header: "Microred", width: 26 }, { header: "Establec.", width: 10, fmt: FMT.int }, { header: "Desabast.", width: 10, fmt: FMT.int }, { header: "Substock", width: 10, fmt: FMT.int },
    { header: "Normostock", width: 11, fmt: FMT.int }, { header: "Sobrestock", width: 11, fmt: FMT.int }, { header: "Sin rotación", width: 11, fmt: FMT.int },
    { header: "Total ítems", width: 10, fmt: FMT.int }, { header: "Disponibilidad", width: 14, fmt: FMT.pct }, { header: "Nivel", width: 11, align: "center" },
  ], mrs.map((m) => [m.microred, m.establishments, m.counts.desabastecido, m.counts.substock, m.counts.normostock, m.counts.sobrestock, m.counts.sinRotacion, m.counts.total, m.pct / 100, DME_LEVEL_LABEL[m.level]]), { freezeCols: 1 });
  mrs.forEach((m, i) => paintLevel(ms.getCell(tm.head + 1 + i, 10), m.level));
  dataBar(ms, `I${tm.head + 1}:I${tm.last}`);
  const totalRow = ms.getRow(tm.last + 1);
  [p.title, report.establishments.length, c.desabastecido, c.substock, c.normostock, c.sobrestock, c.sinRotacion, c.total, report.pct / 100, DME_LEVEL_LABEL[report.level]].forEach((v, i) => {
    const cell = totalRow.getCell(i + 1);
    cell.value = v as ExcelJS.CellValue;
    cell.font = { name: FONT, size: 10, bold: true };
    cell.border = { top: { style: "medium", color: { argb: C.teal } } };
    if (i >= 1 && i <= 7) cell.numFmt = FMT.int;
    if (i === 8) cell.numFmt = FMT.pct;
  });
  paintLevel(totalRow.getCell(10), report.level);

  /* ---------------- Atención: lo que hay que resolver ---------------- */
  const at = wb.addWorksheet("Atención", { properties: { tabColor: { argb: "FFDC2626" } } });
  sheetTitle(at, "Productos que requieren atención", `${subtitle} · desabastecidos, substock y los que vencerían antes de usarse`, 12);
  const rank: Record<string, number> = { [StockStatus.DESABASTECIDO]: 0, [StockStatus.SUBSTOCK]: 1 };
  const attention = report.items
    .filter((i) => (i.status === StockStatus.DESABASTECIDO && i.cpa > 0) || i.status === StockStatus.SUBSTOCK || i.expiryRisk)
    .sort((a, b) => a.microred.localeCompare(b.microred, "es") || a.name.localeCompare(b.name, "es") || (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || a.description.localeCompare(b.description, "es"));
  const ta = writeTable(at, 5, [
    { header: "Microred", width: 18 }, { header: "Establecimiento", width: 28 }, { header: "Código", width: 8, align: "center" }, { header: "Producto", width: 46 },
    { header: "Stock", width: 9, fmt: FMT.int }, { header: "CPA", width: 9, fmt: FMT.dec1 }, { header: "Meses", width: 8, fmt: FMT.dec1 },
    { header: "Situación", width: 13, align: "center" }, { header: "Vence primero", width: 12, align: "center" }, { header: "Meses para vencer", width: 10, fmt: FMT.int },
    { header: "Motivo", width: 26 }, { header: "Cubrir 2 meses (unid.)", width: 12, fmt: FMT.int },
  ], attention.map((i) => [
    i.microred, i.name, i.medCode, i.description, i.stock, i.cpa, monthsValue(i.months), STATUS_LABEL[i.status], dateText(i.nearestExpiry), i.monthsToExpiry,
    i.status === StockStatus.DESABASTECIDO ? "Sin stock y con consumo" : i.status === StockStatus.SUBSTOCK ? "Menos de 2 meses de stock" : "Vence antes de consumirse",
    i.status === StockStatus.DESABASTECIDO || i.status === StockStatus.SUBSTOCK ? Math.max(0, Math.ceil(i.cpa * 2 - i.stock)) : null,
  ]), { freezeCols: 4 });
  attention.forEach((i, n) => paintStatus(at.getCell(ta.head + 1 + n, 8), i.status));

  /* ---------------- Detalle de productos ---------------- */
  const detail = (name: string, title: string, items: AvailabilityItem[]) => {
    const ws = wb.addWorksheet(name);
    const fixed: Col[] = [
      { header: "Red", width: 14 }, { header: "Microred", width: 18 }, { header: "Código EESS", width: 10, align: "center" }, { header: "Establecimiento", width: 28 },
      { header: "Cat.", width: 6, align: "center" }, { header: "Código", width: 8, align: "center" }, { header: "Producto", width: 46 }, { header: "F.F.", width: 9 },
      { header: "Precio", width: 9, fmt: FMT.money }, { header: "Tipo", width: 5, align: "center" }, { header: "Pet.", width: 5, align: "center" }, { header: "Est.", width: 5, align: "center" },
    ];
    const monthCols: Col[] = months.map((m) => ({ header: monthLabel(m), width: 9, fmt: FMT.int }));
    const tail: Col[] = [
      { header: "Stock", width: 10, fmt: FMT.int }, { header: "CPA", width: 9, fmt: FMT.dec1 }, { header: "Meses de provisión", width: 10, fmt: FMT.dec1 },
      { header: "Situación", width: 13, align: "center" }, { header: "Valor del stock (S/)", width: 12, fmt: FMT.money }, { header: "Vence primero", width: 12, align: "center" },
      { header: "Lotes", width: 7, fmt: FMT.int }, { header: "Detalle de lotes (lote · vence · saldo)", width: 48 }, { header: "Meses para vencer", width: 10, fmt: FMT.int },
      { header: "Riesgo de vencimiento", width: 12, align: "center" }, { header: "Fusiona", width: 18 },
    ];
    const cols = [...fixed, ...monthCols, ...tail];
    sheetTitle(ws, title, subtitle, Math.min(cols.length, 14));
    const t = writeTable(ws, 5, cols, items.map((i) => [
      i.red, i.microred, i.code, i.name, i.category, i.medCode, i.description, i.form, i.price, i.medtip, i.medpet, i.medest,
      ...i.consumption, i.stock, i.cpa, monthsValue(i.months), STATUS_LABEL[i.status], i.stock * (i.price || 0), dateText(i.nearestExpiry),
      i.lots.length, i.lots.map((l) => `${l.lot} · ${dateText(l.expiry)} · ${l.balance}`).join("  |  "), i.monthsToExpiry, i.expiryRisk ? "Riesgo" : "",
      (i.fusedFrom?.length ?? 0) > 1 ? i.fusedFrom!.join(", ") : "",
    ]), { freezeCols: 7 });
    const statusCol = fixed.length + monthCols.length + 4;
    const riskCol = statusCol + 6;
    items.forEach((i, n) => {
      paintStatus(ws.getCell(t.head + 1 + n, statusCol), i.status);
      if (i.expiryRisk) {
        const cell = ws.getCell(t.head + 1 + n, riskCol);
        cell.fill = fill("FFFEE2E2");
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FF991B1B" } };
      }
    });
    // El consumo mensual se puede plegar para leer solo el resultado.
    for (let i = 0; i < monthCols.length; i++) ws.getColumn(fixed.length + 1 + i).outlineLevel = 1;
    ws.properties.outlineProperties = { summaryBelow: true, summaryRight: true };
    ws.getRow(4).getCell(fixed.length + 1).value = monthCols.length ? `Consumo mensual (${monthLabel(months[0])} – ${monthLabel(cut)}) · pliegue con el botón «−» de arriba` : "";
    ws.getRow(4).getCell(fixed.length + 1).font = { name: FONT, size: 9, italic: true, color: { argb: C.muted } };
    void colLetter;
  };
  detail("Productos por establecimiento", "Detalle de productos por establecimiento", report.items);
  if (p.pharmacyItems) detail("Productos por farmacia", "Detalle de productos por farmacia", p.pharmacyItems);

  /* ---------------- TFORMDET del mes de corte ---------------- */
  // Los registros tal como salen del SISMED (lotes, registro sanitario, ingresos, consumo por
  // tipo, stock), para revisar qué pasó ese mes en cada establecimiento y producto.
  if (p.tformdet && p.tformdet.rows.length) {
    const tf = p.tformdet;
    const tfMonth = tf.month || cut;
    const ws = wb.addWorksheet(`TFORMDET ${tfMonth ? monthLabel(tfMonth) : ""}`.trim(), { properties: { tabColor: { argb: "FF0369A1" } } });
    const microredOf = new Map(report.establishments.map((e) => [e.code, e.microred]));
    const iPre = tf.header.findIndex((h) => /^CODIGO.PRE$/i.test(h));
    const textCols = /^(CODIGO.PRE|CODIGO.MED|EESS|DESCRIPCION.MED|MEDLOTE|MEDREGSAN|FEC.EXP|TIPSUM2|FFINAN|MEDFF|MEDTIP|MEDPET|MEDEST)$/i;
    const moneyCols = /^(PRECIO|PREADQ)$/i;
    const widthOf = (h: string) => (/^DESCRIPCION/i.test(h) ? 46 : /^EESS$/i.test(h) ? 28 : /^(MEDLOTE|MEDREGSAN)$/i.test(h) ? 14 : /^FEC.EXP$/i.test(h) ? 11 : Math.max(8, h.length + 2));
    const cols: Col[] = [
      { header: "Microred", width: 18 },
      ...tf.header.map((h) => ({ header: h, width: widthOf(h), fmt: textCols.test(h) ? undefined : moneyCols.test(h) ? FMT.money : FMT.int, align: /^(CODIGO.PRE|CODIGO.MED|FEC.EXP|MEDTIP|MEDPET|MEDEST|TIPSUM2|FFINAN)$/i.test(h) ? "center" as const : undefined })),
    ];
    sheetTitle(ws, `Registros del TFORMDET · ${tfMonth ? monthFull(tfMonth) : "mes de corte"}`, `${p.title} · ${formatNumber(tf.rows.length)} registros por establecimiento, producto y lote`, 12);
    writeTable(ws, 5, cols, tf.rows.map((r) => [iPre >= 0 ? microredOf.get(ipressCodeOf(String(r[iPre] ?? ""))) || "" : "", ...r]), { freezeCols: 1 + Math.max(0, tf.header.findIndex((h) => /^DESCRIPCION/i.test(h)) + 1) });
  }

  /* ---------------- Metodología ---------------- */
  const me = wb.addWorksheet("Metodología", { properties: { tabColor: { argb: C.muted } } });
  me.columns = [{ width: 28 }, { width: 110 }];
  sheetTitle(me, "Metodología", "Cómo se calculó este reporte", 2);
  const lines: Array<[string, string]> = [
    ["Productos evaluados", scope === "essential"
      ? `Medicamentos esenciales: tipo M, de estrategia «S» o «_» (sin estrategias), del petitorio o del listado de códigos fusionados de DIGEMID${p.fusedVersion ? ` (${p.fusedVersion})` : ""}. Las presentaciones de un mismo grupo se suman en su código destino.`
      : "Todos los productos con registro en el periodo."],
    ["Consumo promedio (CPA)", "Suma del consumo del periodo ÷ número de meses con consumo (ficha 28 de DIGEMID)."],
    ["Meses de provisión", "Stock al cierre del mes de corte ÷ CPA."],
    ["Situación", "Desabastecido: stock 0. Sin rotación: stock > 0 y CPA 0. Substock, Normostock y Sobrestock según los meses de provisión y los límites de la fórmula."],
    ["Fórmula aplicada", p.formulaText],
    ["Niveles", `Óptimo ${levelRange.OPTIMO}; Alto ${levelRange.ALTO}; Regular ${levelRange.REGULAR}; Bajo ${levelRange.BAJO}.`],
    ["Cubrir 2 meses", "Hoja «Atención»: unidades que faltan para llegar a 2 meses de stock (CPA × 2 − stock)."],
    ["Riesgo de vencimiento", "Los meses de provisión superan los meses que faltan para el vencimiento más próximo: el producto vencería antes de consumirse."],
    ["Fuente", p.source],
    ["Periodo", period],
  ];
  lines.forEach(([kk, v], i) => {
    const row = me.getRow(5 + i);
    row.getCell(1).value = kk;
    row.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } };
    row.getCell(2).value = v;
    row.getCell(2).font = { name: FONT, size: 10, color: { argb: C.ink } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(1).alignment = { vertical: "top" };
    row.height = Math.max(18, Math.ceil(v.length / 105) * 15);
    if (i % 2 === 1) { row.getCell(1).fill = fill(C.band); row.getCell(2).fill = fill(C.band); }
  });
  me.views = [{ showGridLines: false }];

  return wb;
};

export const exportAvailabilityExcel = async (params: AvailabilityExportParams) => {
  const wb = buildAvailabilityWorkbook(params);
  const buffer = await wb.xlsx.writeBuffer();
  const cut = params.months[params.months.length - 1] || "";
  const slug = params.title.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `DISPONIBILIDAD_${params.scope === "essential" ? "DME" : "PRODUCTOS"}_${slug}_${cut}.xlsx`,
  );
};
