import ExcelJS from "exceljs";
import { StockStatus } from "../types";
import type { ScopeRule } from "./availabilityConfig";
import { DME_LEVEL_LABEL, dmeLevelOf, ipressCodeOf, wholeMonthsBetween, type AvailabilityItem, type AvailabilityReport, type TformdetMonthSheet, type WarehouseItem } from "./availabilityReport";
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
  /** Columna con barra de datos: el valor va a la izquierda, en blanco y negrita, sobre la barra. */
  bar?: boolean;
}

/**
 * Alineación pedida por el usuario (2026-10-06, sobre su propio ajuste del Excel): los textos
 * (nombres, producto, motivo, detalle) a la izquierda; códigos, números y estados centrados.
 */
const TEXT_HEADER = /^(Red|Microred|Establecimiento|Producto|Motivo|EESS|DESCRIPCION MED)$|^Detalle/i;
const alignOf = (c: Col): "left" | "right" | "center" => c.align ?? (c.bar || TEXT_HEADER.test(c.header) ? "left" : "center");

/**
 * Tabla con cabecera teal, filas alternadas, bordes finos, filtro y paneles fijos. Devuelve la
 * fila de la cabecera y la última fila de datos.
 */
const writeTable = (ws: ExcelJS.Worksheet, startRow: number, cols: Col[], rows: unknown[][], opts: { freezeCols?: number; filter?: boolean } = {}) => {
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    // Las columnas centradas necesitan aire para la cabecera y el botón del filtro.
    const width = alignOf(c) === "center" ? Math.max(c.width, 11) : c.width;
    if (!col.width || col.width < width) col.width = width;
  });
  const head = ws.getRow(startRow);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: C.white } };
    cell.fill = fill(C.teal);
    cell.alignment = { vertical: "middle", horizontal: alignOf(c), wrapText: true, indent: alignOf(c) === "left" ? 1 : 0 };
    cell.border = border;
  });
  head.height = 36;
  // Estilos compartidos (mismo objeto para todas las celdas de una columna): ExcelJS
  // serializa mucho más rápido que con un objeto nuevo por celda.
  const font = { name: FONT, size: 10, color: { argb: C.ink } };
  const barFont = { name: FONT, size: 10, bold: true, color: { argb: C.white } };
  const band = fill(C.band);
  const styleFor = cols.map((c) => {
    const alignment = { vertical: "middle" as const, horizontal: alignOf(c), indent: alignOf(c) === "left" ? 1 : 0 };
    const f = c.bar ? barFont : font;
    return {
      plain: { font: f, border, numFmt: c.fmt, alignment },
      banded: { font: f, border, numFmt: c.fmt, fill: band, alignment },
    };
  });
  rows.forEach((values, r) => {
    const row = ws.getRow(startRow + 1 + r);
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v as ExcelJS.CellValue;
      const st = styleFor[i] ?? styleFor[0];
      cell.style = (r % 2 === 1 ? st.banded : st.plain) as Partial<ExcelJS.Style>;
    });
    row.height = 18;
  });
  const last = startRow + rows.length;
  if (opts.filter !== false && rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: last, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: startRow, xSplit: opts.freezeCols ?? 0, showGridLines: false }];
  return { head: startRow, last };
};

/**
 * Cambia el estilo de una celda sin tocar a las demás. Las celdas de `writeTable` comparten el
 * objeto de estilo de su columna; `cell.fill = …` lo modificaría para toda la columna.
 */
const restyle = (cell: ExcelJS.Cell, patch: Partial<ExcelJS.Style>) => {
  cell.style = { ...cell.style, ...patch } as Partial<ExcelJS.Style>;
};
const paintLevel = (cell: ExcelJS.Cell, level: DmeLevel) => {
  const [bg, fg] = LEVEL_FILL[level];
  restyle(cell, { fill: fill(bg), font: { name: FONT, size: 10, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
};
const paintStatus = (cell: ExcelJS.Cell, status: StockStatus) => {
  const [bg, fg] = STATUS_FILL[status];
  restyle(cell, { fill: fill(bg), font: { name: FONT, size: 10, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
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

/**
 * Cabecera de hoja con el mismo estilo de la portada: banda oscura a todo el ancho de la tabla
 * con el título en blanco y el subtítulo debajo. `span` es el número de columnas de la tabla.
 */
const sheetTitle = (ws: ExcelJS.Worksheet, title: string, subtitle: string, span: number) => {
  const textSpan = Math.max(1, Math.min(span, 12));
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= span; c++) ws.getCell(r, c).fill = fill(C.dark);
  ws.mergeCells(1, 1, 1, textSpan);
  ws.mergeCells(2, 1, 2, textSpan);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 15, bold: true, color: { argb: C.white } };
  t.alignment = { vertical: "bottom", indent: 1 };
  ws.getRow(1).height = 30;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, color: { argb: "FF99F6E4" } };
  s.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 8;
  ws.getRow(4).height = 10;
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
  /** Regla de la vista exportada, para explicarla en Metodología. */
  rule?: ScopeRule;
  limits?: { subMax: number; sobreMin: number };
  aggregate?: "average" | "sum";
  /** Stock de los almacenes al corte (no cuenta en la disponibilidad). */
  warehouse?: WarehouseItem[] | null;
  /** Registros del TFORMDET del mes de corte, para revisarlos en detalle. */
  tformdet?: TformdetMonthSheet | null;
}

export const buildAvailabilityWorkbook = (p: AvailabilityExportParams): ExcelJS.Workbook => {
  const { report, months, scope } = p;
  const warehouse = p.warehouse ?? [];
  const hasWarehouse = warehouse.length > 0;
  // Productos de los establecimientos por código (las presentaciones fusionadas de la DME
  // cuentan para cada uno de sus códigos), y stock del almacén de cada producto.
  const itemsByCode = new Map<string, AvailabilityItem[]>();
  for (const i of report.items) {
    for (const code of i.fusedFrom?.length ? i.fusedFrom : [i.medCode]) {
      const list = itemsByCode.get(code) || [];
      list.push(i);
      itemsByCode.set(code, list);
    }
  }
  const warehouseByCode = new Map<string, number>();
  for (const w of warehouse) warehouseByCode.set(w.medCode, (warehouseByCode.get(w.medCode) || 0) + w.stock);
  const warehouseStockOf = (i: AvailabilityItem) => (i.fusedFrom?.length ? i.fusedFrom : [i.medCode]).reduce((sum, c) => sum + (warehouseByCode.get(c) || 0), 0);
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

  // Banda del título (diseño del usuario del 2026-10-06: el título lleva la UNGET al final, y
  // debajo el corte a la izquierda y el nombre y la profesión del responsable a la derecha).
  // Encima, una línea con el nombre del reporte; debajo, una franja de acento.
  paintArea(1, 1, 5, 12, C.dark);
  [1, 2, 3, 4, 5, 6, 7].forEach((r, i) => (rs.getRow(r).height = [18, 24, 24, 18, 16, 4, 12][i]));
  box(1, 1, 1, 8, `TOOLKIT SISMED  ·  REPORTE DE DISPONIBILIDAD  ·  ${scopeLabel.toUpperCase()}`, { font: { name: FONT, size: 8, bold: true, color: { argb: "FF5EEAD4" } }, alignment: { vertical: "bottom", indent: 1 } });
  box(1, 9, 1, 12, `Generado el ${new Date().toLocaleDateString("es-PE")}`, { font: { name: FONT, size: 8, color: { argb: "FF94A3B8" } }, alignment: { vertical: "bottom", horizontal: "right", indent: 1 } });
  box(2, 1, 3, 12, { richText: [
    { text: scope === "essential" ? "ANÁLISIS DE DISPONIBILIDAD DE MEDICAMENTOS ESENCIALES (DME) " : "ANÁLISIS DE DISPONIBILIDAD DE PRODUCTOS FARMACÉUTICOS, DISPOSITIVOS MÉDICOS Y PRODUCTOS SANITARIOS ", font: { name: FONT, size: 16, bold: true, color: { argb: C.white } } },
    { text: p.title, font: { name: FONT, size: 16, bold: true, color: { argb: "FF99F6E4" } } },
  ] }, { alignment: { vertical: "middle", wrapText: true, indent: 1 } });
  box(4, 1, 4, 8, `Corte ${cut ? monthFull(cut) : "—"} · consumo ${period} · ${scopeLabel}`, { font: { name: FONT, size: 9, color: { argb: "FFCBD5E1" } }, alignment: { vertical: "middle", indent: 1 } });
  box(4, 9, 4, 12, p.preparedBy || "", { font: { name: FONT, size: 10, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: "right", indent: 1 } });
  box(5, 9, 5, 12, p.preparedByRole || "", { font: { name: FONT, size: 9, color: { argb: "FFCBD5E1" } }, alignment: { vertical: "top", horizontal: "right", indent: 1 } });
  paintArea(6, 1, 6, 12, "FF14B8A6");

  // Indicador principal
  const H = 8;
  [H, H + 1, H + 2, H + 3, H + 4].forEach((r, i) => (rs.getRow(r).height = [18, 26, 30, 18, 18][i]));
  const [heroBg, heroFg] = LEVEL_FILL[report.level];
  paintArea(H, 1, H + 4, 4, heroBg);
  box(H, 1, H, 4, scope === "essential" ? "DISPONIBILIDAD DME DE LA UNGET" : "DISPONIBILIDAD DE LA UNGET", { font: { name: FONT, size: 9, bold: true, color: { argb: heroFg } }, alignment: { vertical: "bottom", indent: 1 } });
  box(H + 1, 1, H + 2, 4, report.pct / 100, { numFmt: "0.0 %", font: { name: FONT, size: 40, bold: true, color: { argb: heroFg } }, alignment: { vertical: "middle", horizontal: "left", indent: 1 } });
  box(H + 3, 1, H + 3, 4, `Nivel ${DME_LEVEL_LABEL[report.level]} · ${report.establishments.length} establecimientos`, { font: { name: FONT, size: 10, bold: true, color: { argb: heroFg } }, alignment: { vertical: "middle", indent: 1 } });
  box(H + 4, 1, H + 4, 4, p.otherScopePct != null ? `${scope === "essential" ? "Todos los productos" : "Medicamentos esenciales (DME)"}: ${pctText(p.otherScopePct)}` : `${formatNumber(c.total)} ítems evaluados`, { font: { name: FONT, size: 10, color: { argb: heroFg } }, alignment: { vertical: "top", indent: 1 } });
  outline(H, 1, H + 4, 4, heroFg);

  // Establecimientos por nivel
  const levels: DmeLevel[] = ["OPTIMO", "ALTO", "REGULAR", "BAJO"];
  const perLevel = (l: DmeLevel) => report.establishments.filter((e) => e.level === l).length;
  levels.forEach((l, i) => {
    const col = 5 + i * 2;
    const [bg, fg] = LEVEL_FILL[l];
    box(H, col, H, col + 1, DME_LEVEL_LABEL[l].toUpperCase(), { fill: fill(fg), font: { name: FONT, size: 9, bold: true, color: { argb: C.white } }, alignment: { horizontal: "center", vertical: "middle" } });
    paintArea(H + 1, col, H + 4, col + 1, bg);
    box(H + 1, col, H + 2, col + 1, perLevel(l), { font: { name: FONT, size: 28, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(H + 3, col, H + 3, col + 1, "establecimientos", { font: { name: FONT, size: 9, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(H + 4, col, H + 4, col + 1, levelRange[l], { font: { name: FONT, size: 9, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "top" } });
    outline(H, col, H + 4, col + 1, fg);
  });

  const sectionTitle = (row: number, text: string, c1 = 1, c2 = 12, horizontal: "left" | "center" = "left") => {
    rs.getRow(row).height = 22;
    box(row, c1, row, c2, text, { font: { name: FONT, size: 12, bold: true, color: { argb: C.ink } }, alignment: { vertical: "bottom", horizontal } });
    for (let cc = c1; cc <= c2; cc++) rs.getCell(row, cc).border = { bottom: { style: "medium", color: { argb: C.teal } } };
  };

  // Situación de los ítems
  const S = H + 6;
  sectionTitle(S, "Situación de los ítems evaluados");
  rs.getRow(S + 1).height = 6;
  const stTiles: Array<[StockStatus, number]> = [
    [StockStatus.NORMOSTOCK, c.normostock], [StockStatus.SOBRESTOCK, c.sobrestock], [StockStatus.SUBSTOCK, c.substock],
    [StockStatus.SIN_ROTACION, c.sinRotacion], [StockStatus.DESABASTECIDO, c.desabastecido],
  ];
  const T = S + 2;
  [T, T + 1, T + 2].forEach((r, i) => (rs.getRow(r).height = [18, 30, 18][i]));
  stTiles.forEach(([s, n], i) => {
    const col = 1 + i * 2;
    const [bg, fg] = STATUS_FILL[s];
    paintArea(T, col, T + 2, col + 1, bg);
    box(T, col, T, col + 1, STATUS_LABEL[s], { font: { name: FONT, size: 10, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(T + 1, col, T + 1, col + 1, n, { numFmt: FMT.int, font: { name: FONT, size: 22, bold: true, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    box(T + 2, col, T + 2, col + 1, c.total ? n / c.total : 0, { numFmt: "0.0 %\" del total\"", font: { name: FONT, size: 9, color: { argb: fg } }, alignment: { horizontal: "center", vertical: "middle" } });
    outline(T, col, T + 2, col + 1, fg);
  });
  paintArea(T, 11, T + 2, 12, "FFE0F2F1");
  box(T, 11, T, 12, "Total ítems", { font: { name: FONT, size: 10, bold: true, color: { argb: C.muted } }, alignment: { horizontal: "center", vertical: "middle" } });
  box(T + 1, 11, T + 1, 12, c.total, { numFmt: FMT.int, font: { name: FONT, size: 22, bold: true, color: { argb: C.ink } }, alignment: { horizontal: "center", vertical: "middle" } });
  box(T + 2, 11, T + 2, 12, "producto × establecimiento", { font: { name: FONT, size: 9, color: { argb: C.muted } }, alignment: { horizontal: "center", vertical: "middle" } });
  outline(T, 11, T + 2, 12, "FF334155");

  // Hallazgos principales: lo que hay que leer primero, en frases cortas.
  const findings: Array<[string, string]> = [];
  const nEst = report.establishments.length;
  const nHigh = perLevel("OPTIMO") + perLevel("ALTO");
  findings.push([`${perLevel("BAJO")} de ${nEst} establecimientos`, ` están en nivel Bajo (< ${lv.regular} %); ${nHigh} alcanzan nivel Óptimo o Alto (≥ ${lv.alto} %).`]);
  const mrByPct = report.microredes.slice().sort((a, b) => b.pct - a.pct);
  if (mrByPct.length > 1) {
    const top = mrByPct[0], low = mrByPct[mrByPct.length - 1];
    findings.push([`Microredes: `, `la de mayor disponibilidad es ${top.microred} (${pctText(top.pct)}) y la de menor, ${low.microred} (${pctText(low.pct)}).`]);
  }
  const desabItems = report.items.filter((i) => i.status === StockStatus.DESABASTECIDO && i.cpa > 0);
  if (desabItems.length) {
    const byProduct = new Map<string, { name: string; n: number }>();
    for (const i of desabItems) {
      const e = byProduct.get(i.medCode) || { name: i.description, n: 0 };
      e.n++;
      byProduct.set(i.medCode, e);
    }
    const topMissing = [...byProduct.values()].sort((a, b) => b.n - a.n).slice(0, 3);
    findings.push([`${formatNumber(desabItems.length)} ítems desabastecidos con consumo.`, ` Los que faltan en más establecimientos: ${topMissing.map((t) => `${t.name} (${t.n})`).join("; ")}.`]);
  }
  const risky = report.items.filter((i) => i.expiryRisk);
  if (risky.length) {
    const value = risky.reduce((sum, i) => sum + i.stock * (i.price || 0), 0);
    findings.push([`${formatNumber(risky.length)} ítems vencerían antes de consumirse`, ` (S/ ${formatNumber(value, 2)} en stock): revisar redistribución en la hoja «Atención».`]);
  }
  if (hasWarehouse) {
    const need = report.items.filter((i) => (i.status === StockStatus.DESABASTECIDO && i.cpa > 0) || i.status === StockStatus.SUBSTOCK);
    const covered = need.filter((i) => warehouseStockOf(i) > 0).length;
    findings.push([`El almacén tiene stock para ${formatNumber(covered)} de los ${formatNumber(need.length)} ítems`, ` desabastecidos o en substock (hoja «Almacén»).`]);
  }
  const F = T + 4;
  sectionTitle(F, "Hallazgos principales");
  rs.getRow(F + 1).height = 6;
  findings.forEach(([lead, rest], i) => {
    const r = F + 2 + i;
    rs.getRow(r).height = Math.max(20, Math.ceil((lead.length + rest.length) / 115) * 15);
    box(r, 1, r, 12, { richText: [
      { text: "▸  ", font: { name: FONT, size: 10, bold: true, color: { argb: C.teal } } },
      { text: lead, font: { name: FONT, size: 10, bold: true, color: { argb: C.ink } } },
      { text: rest, font: { name: FONT, size: 10, color: { argb: C.ink } } },
    ] }, { fill: fill(i % 2 ? C.white : "FFF0FDFA"), alignment: { vertical: "middle", wrapText: true, indent: 1 } });
    rs.getCell(r, 1).border = { left: { style: "thick", color: { argb: C.teal } } };
  });

  // Tabla compacta con columnas que ocupan varias celdas. `bar`: barra de datos con el valor
  // en blanco y negrita a la izquierda (como lo dejó el usuario).
  const spanTable = (row: number, cols: Array<{ header: string; span: number; fmt?: string; align?: "left" | "right" | "center"; bar?: boolean }>, rows: unknown[][], c1 = 1, paint?: (r: number, cell: (i: number) => ExcelJS.Cell) => void) => {
    const starts: number[] = [];
    let x = c1;
    cols.forEach((col) => { starts.push(x); x += col.span; });
    rs.getRow(row).height = 22;
    cols.forEach((col, i) => box(row, starts[i], row, starts[i] + col.span - 1, col.header, {
      fill: fill(C.teal), font: { name: FONT, size: 10, bold: true, color: { argb: C.white } },
      alignment: { vertical: "middle", horizontal: col.bar ? "left" : col.align || "left", indent: col.align === "right" || col.align === "center" ? 0 : 1 },
    }));
    rows.forEach((values, r) => {
      const rr = row + 1 + r;
      rs.getRow(rr).height = 19;
      cols.forEach((col, i) => {
        const cell = box(rr, starts[i], rr, starts[i] + col.span - 1, values[i] as ExcelJS.CellValue, {
          font: col.bar ? { name: FONT, size: 10, bold: true, color: { argb: C.white } } : { name: FONT, size: 10, color: { argb: C.ink } },
          alignment: { vertical: "middle", horizontal: col.bar ? "left" : col.align || (typeof values[i] === "number" ? "right" : "left"), indent: col.align === "center" ? 0 : 1 },
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
  const B = F + 2 + findings.length + 1;
  sectionTitle(B, "Mayor disponibilidad", 1, 6, "center");
  sectionTitle(B, "Menor disponibilidad", 7, 12, "center");
  rs.getRow(B + 1).height = 6;
  const estCols = [{ header: "Establecimiento", span: 4 }, { header: "%", span: 1, fmt: FMT.pct, align: "right" as const }, { header: "Nivel", span: 1, align: "center" as const }];
  const estRow = (e: (typeof byPct)[number]) => [`${e.name} (${e.code})`, e.pct / 100, DME_LEVEL_LABEL[e.level]];
  const endBest = spanTable(B + 2, estCols, best.map(estRow), 1, (rr, cell) => paintLevel(cell(2), best[rr - B - 3].level));
  spanTable(B + 2, estCols, worst.map(estRow), 7, (rr, cell) => paintLevel(cell(2), worst[rr - B - 3].level));
  // Línea que separa las dos tablas.
  for (let r = B + 2; r <= endBest; r++) {
    const cell = rs.getCell(r, 6);
    cell.border = { ...(cell.border || {}), right: { style: "medium", color: { argb: C.teal } } };
  }

  // Microredes
  const mrStart = endBest + 2;
  sectionTitle(mrStart, "Disponibilidad por microred");
  rs.getRow(mrStart + 1).height = 6;
  const mrsSorted = report.microredes.slice().sort((a, b) => b.pct - a.pct);
  const mrEnd = spanTable(mrStart + 2, [
    { header: "Microred", span: 3 }, { header: "Establec.", span: 1, fmt: FMT.int, align: "right" }, { header: "Ítems", span: 1, fmt: FMT.int, align: "right" },
    { header: "Desabast.", span: 1, fmt: FMT.int, align: "right" }, { header: "Substock", span: 1, fmt: FMT.int, align: "right" }, { header: "Normo + Sobre", span: 2, fmt: FMT.int, align: "right" },
    { header: "Disponibilidad", span: 2, fmt: FMT.pct, bar: true }, { header: "Nivel", span: 1, align: "center" },
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
    { header: "Total ítems", width: 10, fmt: FMT.int }, { header: "Disponibilidad", width: 14, fmt: FMT.pct, bar: true }, { header: "Nivel", width: 11, align: "center" },
  ], ranked.map((e, i) => [i + 1, e.microred, e.code, e.name, e.category, e.desabastecido, e.substock, e.normostock, e.sobrestock, e.sinRotacion, e.total, e.pct / 100, DME_LEVEL_LABEL[e.level]]), { freezeCols: 4 });
  ranked.forEach((e, i) => paintLevel(es.getCell(te.head + 1 + i, 13), e.level));
  for (let i = 0; i < ranked.length; i++) restyle(es.getCell(te.head + 1 + i, 6), { font: { name: FONT, size: 10, color: { argb: "FFB91C1C" } } });
  dataBar(es, `L${te.head + 1}:L${te.last}`);

  /* ---------------- Microredes ---------------- */
  const ms = wb.addWorksheet("Microredes");
  sheetTitle(ms, "Disponibilidad por microred", subtitle, 10);
  const mrs = report.microredes.slice().sort((a, b) => b.pct - a.pct);
  const tm = writeTable(ms, 5, [
    { header: "Microred", width: 26 }, { header: "Establec.", width: 10, fmt: FMT.int }, { header: "Desabast.", width: 10, fmt: FMT.int }, { header: "Substock", width: 10, fmt: FMT.int },
    { header: "Normostock", width: 11, fmt: FMT.int }, { header: "Sobrestock", width: 11, fmt: FMT.int }, { header: "Sin rotación", width: 11, fmt: FMT.int },
    { header: "Total ítems", width: 10, fmt: FMT.int }, { header: "Disponibilidad", width: 14, fmt: FMT.pct, bar: true }, { header: "Nivel", width: 11, align: "center" },
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
  sheetTitle(at, "Productos que requieren atención", `${subtitle} · desabastecidos, substock y los que vencerían antes de usarse`, hasWarehouse ? 13 : 12);
  const rank: Record<string, number> = { [StockStatus.DESABASTECIDO]: 0, [StockStatus.SUBSTOCK]: 1 };
  const attention = report.items
    .filter((i) => (i.status === StockStatus.DESABASTECIDO && i.cpa > 0) || i.status === StockStatus.SUBSTOCK || i.expiryRisk)
    .sort((a, b) => a.microred.localeCompare(b.microred, "es") || a.name.localeCompare(b.name, "es") || (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || a.description.localeCompare(b.description, "es"));
  const ta = writeTable(at, 5, [
    { header: "Microred", width: 18 }, { header: "Establecimiento", width: 28 }, { header: "Código", width: 8, align: "center" }, { header: "Producto", width: 46 },
    { header: "Stock", width: 9, fmt: FMT.int }, { header: "CPA", width: 9, fmt: FMT.dec1 }, { header: "Meses", width: 8, fmt: FMT.dec1 },
    { header: "Situación", width: 13, align: "center" }, { header: "Vence primero", width: 12, align: "center" }, { header: "Meses para vencer", width: 10, fmt: FMT.int },
    { header: "Motivo", width: 26 }, { header: "Cubrir 2 meses (unid.)", width: 12, fmt: FMT.int },
    ...(hasWarehouse ? [{ header: "Stock en almacén", width: 12, fmt: FMT.int }] : []),
  ], attention.map((i) => [
    i.microred, i.name, i.medCode, i.description, i.stock, i.cpa, monthsValue(i.months), STATUS_LABEL[i.status], dateText(i.nearestExpiry), i.monthsToExpiry,
    i.status === StockStatus.DESABASTECIDO ? "Sin stock y con consumo" : i.status === StockStatus.SUBSTOCK ? "Menos de 2 meses de stock" : "Vence antes de consumirse",
    i.status === StockStatus.DESABASTECIDO || i.status === StockStatus.SUBSTOCK ? Math.max(0, Math.ceil(i.cpa * 2 - i.stock)) : null,
    ...(hasWarehouse ? [warehouseStockOf(i) || null] : []),
  ]), { freezeCols: 4 });
  attention.forEach((i, n) => paintStatus(at.getCell(ta.head + 1 + n, 8), i.status));
  if (hasWarehouse) {
    // En verde lo que el almacén tiene para cubrir.
    attention.forEach((i, n) => {
      if (warehouseStockOf(i) > 0) restyle(at.getCell(ta.head + 1 + n, 13), { font: { name: FONT, size: 10, bold: true, color: { argb: "FF065F46" } } });
    });
  }

  /* ---------------- Almacén ---------------- */
  // Stock del almacén (030S05…) al corte: no entra en la disponibilidad, pero dice qué se
  // puede cubrir. Junto a cada producto, cuántos establecimientos lo necesitan.
  if (hasWarehouse) {
    const wh = wb.addWorksheet("Almacén", { properties: { tabColor: { argb: "FF0369A1" } } });
    const today = new Date();
    const needOf = (medCode: string) => {
      const list = itemsByCode.get(medCode) || [];
      const desab = list.filter((i) => i.status === StockStatus.DESABASTECIDO && i.cpa > 0);
      const sub = list.filter((i) => i.status === StockStatus.SUBSTOCK);
      const units = [...desab, ...sub].reduce((sum, i) => sum + Math.max(0, Math.ceil(i.cpa * 2 - i.stock)), 0);
      return { desab: desab.length, sub: sub.length, units };
    };
    const whRows = warehouse.map((w) => ({ w, need: needOf(w.medCode), nearest: w.lots[0]?.expiry ?? null }));
    sheetTitle(wh, `Stock en almacén · ${cut ? monthFull(cut) : "mes de corte"}`, `${p.title} · ${[...new Set(warehouse.map((w) => `${w.code}${w.name ? ` ${w.name}` : ""}`))].join(", ")} · no se cuenta en la disponibilidad`, 13);
    const tw = writeTable(wh, 5, [
      { header: "Almacén", width: 10, align: "center" }, { header: "Código", width: 8, align: "center" }, { header: "Producto", width: 46 },
      { header: "Stock", width: 10, fmt: FMT.int }, { header: "Precio", width: 9, fmt: FMT.money }, { header: "Valor del stock (S/)", width: 13, fmt: FMT.money },
      { header: "Lotes", width: 7, fmt: FMT.int }, { header: "Vence primero", width: 12, align: "center" }, { header: "Meses para vencer", width: 10, fmt: FMT.int },
      { header: "EESS desabastecidos", width: 14, fmt: FMT.int }, { header: "EESS en substock", width: 12, fmt: FMT.int }, { header: "Faltan para 2 meses (unid.)", width: 14, fmt: FMT.int },
      // El detalle de lotes va al final: es largo (pedido del usuario).
      { header: "Detalle de lotes (lote · vence · saldo)", width: 60 },
    ], whRows.map(({ w, need, nearest }) => [
      w.code, w.medCode, w.description, w.stock, w.price || null, w.stock * (w.price || 0), w.lots.length, dateText(nearest),
      nearest ? wholeMonthsBetween(today, nearest) : null,
      need.desab || null, need.sub || null, need.units || null, w.lots.map((l) => `${l.lot} · ${dateText(l.expiry)} · ${l.balance}`).join("  |  "),
    ]), { freezeCols: 3 });
    whRows.forEach(({ need }, n) => {
      if (need.desab) restyle(wh.getCell(tw.head + 1 + n, 10), { font: { name: FONT, size: 10, bold: true, color: { argb: "FF991B1B" } } });
    });
  }

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
    sheetTitle(ws, title, subtitle, cols.length);
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
        restyle(cell, { fill: fill("FFFEE2E2"), font: { name: FONT, size: 10, bold: true, color: { argb: "FF991B1B" } } });
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
    sheetTitle(ws, `Registros del TFORMDET · ${tfMonth ? monthFull(tfMonth) : "mes de corte"}`, `${p.title} · ${formatNumber(tf.rows.length)} registros por establecimiento, producto y lote`, tf.header.length + 1);
    writeTable(ws, 5, cols, tf.rows.map((r) => [iPre >= 0 ? microredOf.get(ipressCodeOf(String(r[iPre] ?? ""))) || "" : "", ...r]), { freezeCols: 1 + Math.max(0, tf.header.findIndex((h) => /^DESCRIPCION/i.test(h)) + 1) });
  }

  /* ---------------- Metodología ---------------- */
  // Rehecha el 2026-10-06 («no se entiende»): qué mide, con qué datos, el cálculo paso a paso con
  // un ejemplo, y las tablas de situaciones y niveles con la regla de esta exportación.
  const me = wb.addWorksheet("Metodología", { properties: { tabColor: { argb: C.muted } } });
  me.columns = [{ width: 8 }, { width: 30 }, { width: 62 }, { width: 40 }];
  sheetTitle(me, "Metodología", "Cómo se calculó este reporte, paso a paso", 4);
  const rule = p.rule ?? { normostock: true, sobrestock: true, substock: false, sinRotacion: "no" as const };
  const lim = p.limits ?? { subMax: 2, sobreMin: 6 };
  const n = (v: number) => String(v).replace(".", ",");
  let mr = 5;
  const meBox = (r: number, c1: number, c2: number, value: ExcelJS.CellValue, style: Partial<ExcelJS.Style>) => {
    if (c1 !== c2) me.mergeCells(r, c1, r, c2);
    const cell = me.getCell(r, c1);
    cell.value = value;
    Object.assign(cell, style);
    return cell;
  };
  const meSection = (text: string) => {
    mr += 1;
    me.getRow(mr).height = 24;
    meBox(mr, 1, 4, text, { font: { name: FONT, size: 12, bold: true, color: { argb: C.dark } }, alignment: { vertical: "bottom" } });
    for (let c = 1; c <= 4; c++) me.getCell(mr, c).border = { bottom: { style: "medium", color: { argb: C.teal } } };
    mr += 2;
  };
  const meParagraph = (text: string) => {
    me.getRow(mr).height = Math.max(18, Math.ceil(text.length / 150) * 15);
    meBox(mr, 1, 4, text, { font: { name: FONT, size: 10, color: { argb: C.ink } }, alignment: { vertical: "top", wrapText: true } });
    mr += 1;
  };
  /** Tabla de la metodología: `spans` dice cuántas columnas ocupa cada campo (suman 4). */
  const meTable = (headers: string[], spans: number[], rows: string[][], paint?: (row: number, values: string[]) => void) => {
    const starts = spans.map((_, i) => 1 + spans.slice(0, i).reduce((a, b) => a + b, 0));
    me.getRow(mr).height = 22;
    headers.forEach((h, i) => meBox(mr, starts[i], starts[i] + spans[i] - 1, h, {
      fill: fill(C.teal), font: { name: FONT, size: 10, bold: true, color: { argb: C.white } }, alignment: { vertical: "middle", horizontal: i === 0 ? "center" : "left", indent: i === 0 ? 0 : 1 },
    }));
    mr += 1;
    rows.forEach((values, r) => {
      // Alto según el texto más largo (≈ 34 caracteres por columna de ancho medio).
      const height = Math.max(20, ...values.map((v, i) => Math.ceil(v.length / (spans[i] * 34)) * 15 + 4));
      me.getRow(mr).height = Math.min(height, 60);
      values.forEach((v, i) => {
        const cell = meBox(mr, starts[i], starts[i] + spans[i] - 1, v, {
          font: { name: FONT, size: 10, bold: i === 0, color: { argb: C.ink } },
          alignment: { vertical: "middle", horizontal: i === 0 ? "center" : "left", wrapText: true, indent: i === 0 ? 0 : 1 },
        });
        if (r % 2 === 1) for (let c = starts[i]; c < starts[i] + spans[i]; c++) me.getCell(mr, c).fill = fill(C.band);
        for (let c = starts[i]; c < starts[i] + spans[i]; c++) me.getCell(mr, c).border = { bottom: thin };
        void cell;
      });
      paint?.(mr, values);
      mr += 1;
    });
  };

  meSection("1. ¿Qué mide este reporte?");
  meParagraph(`La disponibilidad es el porcentaje de productos que un establecimiento tiene en cantidad suficiente para atender a sus pacientes (ficha técnica 28 de DIGEMID). Se evalúa cada producto de cada establecimiento, se cuenta cuántos están disponibles y el resultado se resume por microred y por UNGET.`);
  meParagraph(`Resultado de ${p.title}: ${pctText(report.pct)} · nivel ${DME_LEVEL_LABEL[report.level]} · ${formatNumber(report.counts.total)} ítems evaluados en ${report.establishments.length} establecimientos.`);

  meSection("2. Datos utilizados");
  meTable(["", "Dato", "Detalle"], [1, 1, 2], [
    ["", "Fuente", p.source],
    ["", "Periodo de consumo", period],
    ["", "Stock", `Al cierre de ${cut ? monthFull(cut) : "el mes de corte"} (columna STOCK_FIN del TFORMDET).`],
    ["", "Consumo de cada mes", "Venta + SIS + intersanitario + SOAT + crédito hospitalario + otros convenios."],
    ["", "Productos evaluados", scope === "essential"
      ? `Medicamentos esenciales (DME): tipo M, de estrategia «S» o «_», del petitorio o del listado de códigos fusionados de DIGEMID${p.fusedVersion ? ` (${p.fusedVersion})` : ""}. Las presentaciones de un mismo grupo se suman en su código destino (columna «Fusiona»).`
      : "Todos los productos con stock al cierre o con consumo en el periodo."],
    ["", "No se incluyen", "Los almacenes (códigos como 030S05): su stock se muestra en la hoja «Almacén». Los productos sin stock y sin consumo en todo el periodo."],
  ]);

  meSection("3. Cálculo paso a paso");
  meTable(["Paso", "Qué se calcula", "Cómo se calcula", "Ejemplo"], [1, 1, 1, 1], [
    ["1", "Consumo promedio mensual (CPA)", "Suma del consumo del periodo ÷ número de meses que tuvieron consumo (los meses en cero no cuentan).", "Consumo de 4 meses: 10, 0, 20, 0 → CPA = 30 ÷ 2 = 15"],
    ["2", "Meses de provisión", "Stock al cierre ÷ CPA.", "Stock 45 ÷ CPA 15 = 3 meses"],
    ["3", "Situación del producto", "Según los meses de provisión (tabla 4).", `3 meses → Normostock (entre ${n(lim.subMax)} y ${n(lim.sobreMin)})`],
    ["4", "Disponibilidad del establecimiento", "Productos disponibles ÷ productos evaluados × 100. Qué situaciones cuentan como disponibles: tabla 4.", "150 disponibles de 200 → 75 %"],
    ["5", "Disponibilidad de microred y UNGET", p.aggregate === "sum"
      ? "Suma de los productos disponibles de sus establecimientos ÷ suma de los productos evaluados."
      : "Promedio de la disponibilidad de sus establecimientos.",
    p.aggregate === "sum" ? "Est. A: 150 de 200; Est. B: 60 de 100 → 210 ÷ 300 = 70 %" : "Est. A 75 %, Est. B 65 % → (75 + 65) ÷ 2 = 70 %"],
    ["6", "Nivel", "Según el porcentaje (tabla 5).", `70 % → ${DME_LEVEL_LABEL[dmeLevelOf(70, { optimo: lv.optimo, alto: lv.alto, regular: lv.regular })]}`],
  ]);

  meSection("4. Situaciones");
  const counts = (yes: boolean) => (yes ? "Sí" : "No");
  const sitRows: Array<[StockStatus, string, string]> = [
    [StockStatus.DESABASTECIDO, "No hay stock (stock 0).", "No"],
    [StockStatus.SUBSTOCK, `Menos de ${n(lim.subMax)} meses de provisión.`, counts(rule.substock)],
    [StockStatus.NORMOSTOCK, `De ${n(lim.subMax)} a ${n(lim.sobreMin)} meses de provisión.`, counts(rule.normostock)],
    [StockStatus.SOBRESTOCK, `Más de ${n(lim.sobreMin)} meses de provisión.`, counts(rule.sobrestock)],
    [StockStatus.SIN_ROTACION, "Hay stock, pero no hubo consumo en todo el periodo.", rule.sinRotacion === "yes" ? "Sí" : rule.sinRotacion === "vital" ? "Solo si es medicamento vital (RM 1288-2018)" : "No"],
  ];
  const sitStart = mr;
  meTable(["", "Situación", "Condición", "¿Cuenta como disponible?"], [1, 1, 1, 1], sitRows.map(([st, cond, yes]) => ["", STATUS_LABEL[st], cond, yes]));
  sitRows.forEach(([st, , yes], i) => {
    const r = sitStart + 1 + i;
    paintStatus(me.getCell(r, 2), st);
    me.getCell(r, 4).font = { name: FONT, size: 10, bold: true, color: { argb: yes === "No" ? "FF991B1B" : "FF065F46" } };
  });

  meSection("5. Niveles de disponibilidad");
  const lvStart = mr;
  meTable(["", "Nivel", "Disponibilidad del establecimiento, microred o UNGET"], [1, 1, 2], levels.map((l) => ["", DME_LEVEL_LABEL[l], levelRange[l]]));
  levels.forEach((l, i) => paintLevel(me.getCell(lvStart + 1 + i, 2), l));

  meSection("6. Columnas de apoyo");
  meTable(["", "Columna", "Qué significa"], [1, 1, 2], [
    ["", "Cubrir 2 meses (unid.)", "Hoja «Atención»: unidades que le faltan al establecimiento para tener 2 meses de stock (CPA × 2 − stock)."],
    ["", "Riesgo de vencimiento", "El producto vencería antes de consumirse: sus meses de provisión superan los meses que faltan para el vencimiento más próximo."],
    ["", "Valor del stock (S/)", "Stock × precio del producto."],
    ["", "Stock en almacén", "Stock del almacén al cierre del mes de corte. No cuenta en la disponibilidad; sirve para ver qué se puede cubrir."],
    ...(scope === "essential" ? [["", "Fusiona", "Códigos de las presentaciones que se sumaron en este producto (listado de códigos fusionados de DIGEMID)."]] : []),
  ]);
  me.views = [{ showGridLines: false }];
  me.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  return wb;
};

/** El libro ya serializado (.xlsx). Lo usan el Worker y, si no hay Worker, la propia página. */
export const availabilityWorkbookBuffer = async (params: AvailabilityExportParams): Promise<ArrayBuffer> => {
  // ExcelJS devuelve un Uint8Array (Buffer); el Worker necesita un ArrayBuffer para transferirlo.
  const out = (await buildAvailabilityWorkbook(params).xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};

/** Nombre del archivo: `DISPONIBILIDAD_PRODUCTOS_UNGET_BELLAVISTA_202609.xlsx`. */
export const availabilityFileName = (params: Pick<AvailabilityExportParams, "months" | "title" | "scope">) => {
  const cut = params.months[params.months.length - 1] || "";
  const slug = params.title.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `DISPONIBILIDAD_${params.scope === "essential" ? "DME" : "PRODUCTOS"}_${slug}_${cut}.xlsx`;
};
