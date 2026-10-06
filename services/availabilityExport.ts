import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { StockStatus } from "../types";
import { DME_LEVEL_LABEL, type AvailabilityItem, type AvailabilityReport } from "./availabilityReport";
import type { DmeLevel } from "./stockStatus";

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
  preparedBy?: string;
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

  /* ---------------- Resumen ---------------- */
  const rs = wb.addWorksheet("Resumen", { properties: { tabColor: { argb: C.teal } } });
  rs.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  sheetTitle(rs, `Disponibilidad de ${scope === "essential" ? "medicamentos esenciales" : "productos"} · ${p.title}`, `Corte ${cut ? monthFull(cut) : "—"} · ${scopeLabel}`, 7);

  const info: Array<[string, string]> = [
    ["Periodo de consumo", period],
    ["Fuente", p.source],
    ["Generado", `${new Date().toLocaleString("es-PE")}${p.preparedBy ? ` por ${p.preparedBy}` : ""}`],
  ];
  info.forEach(([k, v], i) => {
    const r = rs.getRow(5 + i);
    r.getCell(1).value = k;
    r.getCell(1).font = { name: FONT, size: 10, color: { argb: C.muted } };
    rs.mergeCells(5 + i, 2, 5 + i, 7);
    r.getCell(2).value = v;
    r.getCell(2).font = { name: FONT, size: 10, color: { argb: C.ink } };
  });

  // Indicador principal
  const kpiRow = 9;
  rs.mergeCells(kpiRow, 1, kpiRow + 2, 1);
  const k = rs.getCell(kpiRow, 1);
  k.value = { richText: [
    { text: `${scope === "essential" ? "DME" : "Disponibilidad"} de la UNGET\n`, font: { name: FONT, size: 10, color: { argb: C.muted } } },
    { text: `${(report.pct).toFixed(1).replace(".", ",")} %`, font: { name: FONT, size: 26, bold: true, color: { argb: LEVEL_FILL[report.level][1] } } },
    { text: `\n${DME_LEVEL_LABEL[report.level]} · promedio de ${report.establishments.length} establecimientos`, font: { name: FONT, size: 10, color: { argb: C.muted } } },
  ] };
  k.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  k.fill = fill(LEVEL_FILL[report.level][0]);
  rs.getRow(kpiRow).height = 22; rs.getRow(kpiRow + 1).height = 30; rs.getRow(kpiRow + 2).height = 22;

  // Establecimientos por nivel
  const levels: DmeLevel[] = ["OPTIMO", "ALTO", "REGULAR", "BAJO"];
  levels.forEach((l, i) => {
    const col = 2 + i;
    const head = rs.getCell(kpiRow, col);
    head.value = DME_LEVEL_LABEL[l];
    paintLevel(head, l);
    const n = rs.getCell(kpiRow + 1, col);
    n.value = report.establishments.filter((e) => e.level === l).length;
    n.font = { name: FONT, size: 20, bold: true, color: { argb: LEVEL_FILL[l][1] } };
    n.alignment = { horizontal: "center", vertical: "middle" };
    const h = rs.getCell(kpiRow + 2, col);
    h.value = `establec. ${levelRange[l]}`;
    h.font = { name: FONT, size: 9, color: { argb: C.muted } };
    h.alignment = { horizontal: "center" };
    for (let r = kpiRow; r <= kpiRow + 2; r++) rs.getCell(r, col).border = border;
  });
  if (p.otherScopePct != null) {
    rs.mergeCells(kpiRow, 6, kpiRow, 7); rs.mergeCells(kpiRow + 1, 6, kpiRow + 1, 7); rs.mergeCells(kpiRow + 2, 6, kpiRow + 2, 7);
    const h = rs.getCell(kpiRow, 6);
    h.value = scope === "essential" ? "Todos los productos" : "Medicamentos esenciales (DME)";
    h.font = { name: FONT, size: 10, bold: true, color: { argb: C.muted } };
    h.alignment = { horizontal: "center", vertical: "middle" };
    const v = rs.getCell(kpiRow + 1, 6);
    v.value = p.otherScopePct / 100;
    v.numFmt = FMT.pct;
    v.font = { name: FONT, size: 20, bold: true, color: { argb: C.ink } };
    v.alignment = { horizontal: "center", vertical: "middle" };
    const n = rs.getCell(kpiRow + 2, 6);
    n.value = "como referencia";
    n.font = { name: FONT, size: 9, color: { argb: C.muted } };
    n.alignment = { horizontal: "center" };
  }

  // Situación de los ítems
  const c = report.counts;
  const stRows: Array<[StockStatus, number]> = [
    [StockStatus.NORMOSTOCK, c.normostock], [StockStatus.SOBRESTOCK, c.sobrestock], [StockStatus.SUBSTOCK, c.substock],
    [StockStatus.SIN_ROTACION, c.sinRotacion], [StockStatus.DESABASTECIDO, c.desabastecido],
  ];
  let r0 = kpiRow + 4;
  const t1 = writeTable(rs, r0, [
    { header: "Situación de los ítems", width: 30 }, { header: "Ítems", width: 16, fmt: FMT.int }, { header: "% del total", width: 16, fmt: FMT.pct },
  ], [...stRows.map(([s, n]) => [STATUS_LABEL[s], n, c.total ? n / c.total : 0]), ["Total", c.total, 1]], { filter: false });
  stRows.forEach(([s], i) => paintStatus(rs.getCell(t1.head + 1 + i, 1), s));
  rs.getCell(t1.last, 1).font = { name: FONT, size: 10, bold: true };
  rs.getCell(t1.last, 2).font = { name: FONT, size: 10, bold: true };
  dataBar(rs, `C${t1.head + 1}:C${t1.last - 1}`);

  // Microredes
  r0 = t1.last + 2;
  const t2 = writeTable(rs, r0, [
    { header: "Microred", width: 30 }, { header: "Establec.", width: 16, fmt: FMT.int, align: "right" }, { header: "Ítems", width: 16, fmt: FMT.int, align: "right" },
    { header: "Desabastecidos", width: 16, fmt: FMT.int, align: "right" }, { header: "Disponibilidad", width: 16, fmt: FMT.pct, align: "right" }, { header: "Nivel", width: 16, align: "center" },
  ], report.microredes.slice().sort((a, b) => b.pct - a.pct).map((m) => [m.microred, m.establishments, m.counts.total, m.counts.desabastecido, m.pct / 100, DME_LEVEL_LABEL[m.level]]), { filter: false });
  report.microredes.slice().sort((a, b) => b.pct - a.pct).forEach((m, i) => paintLevel(rs.getCell(t2.head + 1 + i, 6), m.level));
  dataBar(rs, `E${t2.head + 1}:E${t2.last}`);
  rs.views = [{ showGridLines: false }];
  rs.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

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
