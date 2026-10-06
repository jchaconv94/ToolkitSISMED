import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { StockStatus } from "../types";
import { DME_LEVEL_LABEL, type AvailabilityItem, type AvailabilityReport } from "./availabilityReport";
import { truncateOneDecimal } from "./stockStatus";

/** Situación con el texto del reporte del usuario. */
export const STATUS_LABEL: Record<StockStatus, string> = {
  [StockStatus.DESABASTECIDO]: "Desabastecido",
  [StockStatus.SUBSTOCK]: "Substock",
  [StockStatus.NORMOSTOCK]: "Normostock",
  [StockStatus.SOBRESTOCK]: "Sobrestock",
  [StockStatus.SIN_ROTACION]: "Sin rotación",
};

const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
/** `202609` → «set 2026». */
export const monthLabel = (key: string) => `${MONTH_NAMES[Number(key.slice(4, 6)) - 1] ?? key.slice(4, 6)} ${key.slice(0, 4)}`;

const dateText = (d: Date | null) =>
  d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "";

const styleHeader = (ws: ExcelJS.Worksheet) => {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
};

const itemSheet = (wb: ExcelJS.Workbook, name: string, items: AvailabilityItem[], months: string[]) => {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: "RED", width: 14 }, { header: "MICRORED", width: 20 }, { header: "COD EESS", width: 11 }, { header: "ESTABLECIMIENTO", width: 30 },
    { header: "CAT", width: 6 }, { header: "MED COD", width: 9 }, { header: "DESCRIPCION DEL PRODUCTO", width: 48 }, { header: "F.F", width: 9 },
    { header: "PRECIO", width: 9 }, { header: "TIPO", width: 6 }, { header: "PET", width: 5 }, { header: "EST", width: 5 },
    ...months.map((m) => ({ header: monthLabel(m), width: 9 })),
    { header: "STOCK", width: 9 }, { header: "CPA", width: 8 }, { header: "MES PROV", width: 8 }, { header: "SITUACIÓN", width: 14 },
    { header: "VENCE PRIMERO", width: 13 }, { header: "LOTES", width: 7 }, { header: "DETALLE (lote - vencimiento - saldo)", width: 50 },
    { header: "MESES PARA VENCER", width: 10 }, { header: "RIESGO VENCIMIENTO", width: 11 },
  ];
  for (const it of items) {
    ws.addRow([
      it.red, it.microred, it.code, it.name, it.category, it.medCode, it.description, it.form, it.price, it.medtip, it.medpet, it.medest,
      ...it.consumption, it.stock, truncateOneDecimal(it.cpa), Number.isFinite(it.months) ? truncateOneDecimal(it.months) : "-", STATUS_LABEL[it.status],
      dateText(it.nearestExpiry), it.lots.length, it.lots.map((l) => `(${l.lot} - ${dateText(l.expiry)} - ${l.balance})`).join(" "),
      it.monthsToExpiry ?? "", it.expiryRisk ? "Riesgo" : "",
    ]);
  }
  styleHeader(ws);
};

/**
 * Excel del reporte: productos por farmacia (si el archivo las trae), por establecimiento, y
 * los resúmenes por establecimiento y microred, del alcance elegido (todos o esenciales).
 */
export const exportAvailabilityExcel = async (params: {
  report: AvailabilityReport;
  pharmacyItems: AvailabilityItem[] | null;
  months: string[];
  scopeLabel: string;
  title: string;
}) => {
  const { report, pharmacyItems, months, scopeLabel, title } = params;
  const wb = new ExcelJS.Workbook();
  if (pharmacyItems) itemSheet(wb, "DISPO x FARMACIAS", pharmacyItems, months);
  itemSheet(wb, "DISPO x IPRESS", report.items, months);

  const eess = wb.addWorksheet("% DISP x EESS");
  eess.columns = [
    { header: "MICRORED", width: 22 }, { header: "COD EESS", width: 11 }, { header: "ESTABLECIMIENTO", width: 32 },
    { header: "Desabastecido", width: 13 }, { header: "Substock", width: 10 }, { header: "Normostock", width: 12 }, { header: "Sobrestock", width: 11 },
    { header: "Sin rotación", width: 11 }, { header: "Total", width: 8 }, { header: "Disponibilidad %", width: 14 }, { header: "Nivel", width: 10 },
  ];
  for (const e of report.establishments) {
    eess.addRow([e.microred, e.code, e.name, e.desabastecido, e.substock, e.normostock, e.sobrestock, e.sinRotacion, e.total, Math.round(e.pct * 10) / 10, DME_LEVEL_LABEL[e.level]]);
  }
  styleHeader(eess);

  const mr = wb.addWorksheet("% DISP x MR");
  mr.columns = [
    { header: "MICRORED", width: 24 }, { header: "Establecimientos", width: 15 }, { header: "Desabastecido", width: 13 }, { header: "Substock", width: 10 },
    { header: "Normostock", width: 12 }, { header: "Sobrestock", width: 11 }, { header: "Sin rotación", width: 11 }, { header: "Total", width: 8 },
    { header: "Disponibilidad % (promedio)", width: 16 }, { header: "Nivel", width: 10 },
  ];
  for (const m of report.microredes) {
    const c = m.counts;
    mr.addRow([m.microred, m.establishments, c.desabastecido, c.substock, c.normostock, c.sobrestock, c.sinRotacion, c.total, Math.round(m.pct * 10) / 10, DME_LEVEL_LABEL[m.level]]);
  }
  mr.addRow([]);
  const total = mr.addRow([`${title} (${scopeLabel})`, report.establishments.length, "", "", "", "", "", "", Math.round(report.pct * 10) / 10, DME_LEVEL_LABEL[report.level]]);
  total.font = { bold: true };
  styleHeader(mr);

  const buffer = await wb.xlsx.writeBuffer();
  const cut = months[months.length - 1] || "";
  saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `DISPONIBILIDAD_${scopeLabel.toUpperCase().replace(/\s+/g, "_")}_${cut}.xlsx`);
};
