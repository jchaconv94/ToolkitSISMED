/**
 * Excel de la ventana «Vencimientos» de Consulta Stock: lo que la ventana muestra (con su filtro
 * y su búsqueda), con el resumen por producto, cada lote (por producto) y el resumen por
 * establecimiento. Las cantidades van como número, sin la «u» de unidades; las fechas, como
 * fecha de Excel.
 */
import ExcelJS from "exceljs";
import { groupExpiryByProduct, type ExpiryLot, type NetworkExpiry } from "./networkExpiry";

export interface NetworkExpiryExportMeta {
  /** UNGET o red, para el título. */
  scope: string;
  windowDays: number;
  generatedAt: Date;
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const MONEY = '"S/" #,##0.00';

/**
 * Cantidad con hasta tres decimales y sin punto suelto: con «#,##0.###» Excel muestra «60.»
 * en un entero (lo vio el usuario el 2026-10-27), así que el entero va con «#,##0». Se redondea
 * a tres decimales para que una suma como 59,9999999 no quede como decimal.
 */
export const quantityCell = (value: number): { value: number; numFmt: string } => {
  const rounded = Math.round(value * 1000) / 1000;
  return { value: rounded, numFmt: Number.isInteger(rounded) ? "#,##0" : "#,##0.###" };
};

/** Fecha de Excel del mismo día que se ve en pantalla (Excel no tiene zona horaria). */
const excelDate = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

const pharmacyLabel = (lot: ExpiryLot) => (lot.pharmacyName && lot.pharmacyName !== lot.pharmacy ? `${lot.pharmacy} ${lot.pharmacyName}` : lot.pharmacy);

const addSheet = (
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  columns: { header: string; width: number; numFmt?: string; quantity?: boolean; center?: boolean }[],
  rows: (string | number | Date)[][],
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

export const buildNetworkExpiryWorkbook = (data: NetworkExpiry, meta: NetworkExpiryExportMeta): ExcelJS.Workbook => {
  const workbook = new ExcelJS.Workbook();
  workbook.created = meta.generatedAt;
  const when = meta.generatedAt.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const subtitle = `${meta.scope} · ${data.sites.length} establecimientos · por vencer: próximos ${meta.windowDays} días · generado el ${when}`;

  const products = groupExpiryByProduct(data);

  addSheet(
    workbook,
    "Por producto",
    "Vencimientos por producto",
    subtitle,
    [
      { header: "Código producto", width: 14, center: true },
      { header: "Producto", width: 48 },
      { header: "Establecimientos", width: 15, center: true },
      { header: "Lotes vencidos", width: 12, center: true },
      { header: "Lotes por vencer", width: 12, center: true },
      { header: "Saldo", width: 11, quantity: true, center: true },
      { header: "Valor vencido", width: 14, numFmt: MONEY, center: true },
      { header: "Valor por vencer", width: 14, numFmt: MONEY, center: true },
      { header: "Vence primero", width: 13, numFmt: "dd/mm/yyyy", center: true },
    ],
    products.map((product) => [
      product.code,
      product.name,
      product.sites,
      product.expiredLots,
      product.expiringLots,
      product.balance,
      product.expiredValue,
      product.expiringValue,
      excelDate(product.first.expiry),
    ]),
  );

  addSheet(
    workbook,
    "Lotes",
    "Lotes vencidos y por vencer",
    subtitle,
    [
      { header: "Código producto", width: 14, center: true },
      { header: "Producto", width: 48 },
      { header: "Establecimiento", width: 34 },
      { header: "Código", width: 11, center: true },
      { header: "Farmacia", width: 22, center: true },
      { header: "Lote", width: 16, center: true },
      { header: "Vence", width: 12, numFmt: "dd/mm/yyyy", center: true },
      { header: "Días", width: 8, center: true },
      { header: "Situación", width: 12, center: true },
      { header: "Saldo", width: 11, quantity: true, center: true },
      { header: "Precio", width: 11, numFmt: MONEY, center: true },
      { header: "Valor", width: 13, numFmt: MONEY, center: true },
    ],
    products.flatMap((product) =>
      product.lots.map((lot) => [
        lot.productCode,
        lot.productName,
        lot.siteName,
        lot.siteCode,
        pharmacyLabel(lot),
        lot.lot,
        excelDate(lot.expiry),
        lot.days,
        lot.status === "expired" ? "Vencido" : "Por vencer",
        lot.balance,
        lot.price,
        lot.value,
      ]),
    ),
  );

  addSheet(
    workbook,
    "Por establecimiento",
    "Resumen por establecimiento",
    subtitle,
    [
      { header: "Establecimiento", width: 34 },
      { header: "Código", width: 11, center: true },
      { header: "Lotes vencidos", width: 12, center: true },
      { header: "Valor vencido", width: 14, numFmt: MONEY, center: true },
      { header: "Lotes por vencer", width: 12, center: true },
      { header: "Valor por vencer", width: 14, numFmt: MONEY, center: true },
      { header: "Valor total", width: 14, numFmt: MONEY, center: true },
    ],
    data.sites.map((site) => [
      site.name,
      site.code,
      site.expiredLots,
      site.expiredValue,
      site.expiringLots,
      site.expiringValue,
      site.expiredValue + site.expiringValue,
    ]),
  );

  return workbook;
};

/** Nombre del archivo: «Vencimientos_Bellavista_2026-10-27.xlsx» (sin tildes ni espacios raros). */
export const networkExpiryFileName = (scope: string, date: Date) => {
  const clean = scope.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "Red";
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `Vencimientos_${clean}_${day}.xlsx`;
};
