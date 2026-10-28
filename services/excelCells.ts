import type ExcelJS from "exceljs";

/**
 * Celdas de Excel compartidas por las exportaciones.
 *
 * Cantidad con hasta tres decimales y sin punto suelto: con «#,##0.###» Excel muestra «60.»
 * en un entero (lo vio el usuario el 2026-10-27), así que el entero va con «#,##0». Se redondea
 * a tres decimales para que una suma como 59,9999999 no quede como decimal.
 */
export const quantityCell = (value: number): { value: number; numFmt: string } => {
  const rounded = Math.round(value * 1000) / 1000;
  return { value: rounded, numFmt: Number.isInteger(rounded) ? "#,##0" : "#,##0.###" };
};

/** Fecha de Excel del mismo día que se ve en pantalla (Excel no tiene zona horaria). */
export const excelDate = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };

export interface TableSheetColumn {
  header: string;
  width: number;
  numFmt?: string;
  /** Cantidad: entero sin decimales o hasta tres decimales (`quantityCell`). */
  quantity?: boolean;
  center?: boolean;
}

/**
 * Hoja con título (A1), subtítulo (A2) y una tabla con cabecera oscura en la fila 4, fija al
 * bajar y con filtro. Las cantidades van como número, sin la «u» de unidades.
 */
export const addTableSheet = (
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  columns: TableSheetColumn[],
  rows: (string | number | Date | null)[][],
) => {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.columns = columns.map((column) => ({ width: column.width }));
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF64748B" } };
  const header = sheet.getRow(4);
  header.values = columns.map((column) => column.header);
  header.height = 22;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  rows.forEach((values) => {
    const row = sheet.addRow(values);
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      if (column.quantity && typeof cell.value === "number") {
        const quantity = quantityCell(cell.value);
        cell.value = quantity.value;
        cell.numFmt = quantity.numFmt;
      } else if (column.numFmt) cell.numFmt = column.numFmt;
      cell.alignment = { vertical: "middle", horizontal: column.center ? "center" : "left" };
    });
  });
  if (rows.length > 0) sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: columns.length } };
  return sheet;
};
