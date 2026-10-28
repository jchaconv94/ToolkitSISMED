/**
 * Excel de la ventana «Vencimientos» de Consulta Stock: lo que la ventana muestra (con su filtro
 * y su búsqueda), con el resumen por producto, cada lote (por producto) y el resumen por
 * establecimiento. Las cantidades van como número, sin la «u» de unidades; las fechas, como
 * fecha de Excel.
 */
import ExcelJS from "exceljs";
import { addTableSheet as addSheet, excelDate, quantityCell } from "./excelCells";
import { groupExpiryByProduct, type ExpiryLot, type NetworkExpiry } from "./networkExpiry";

export { quantityCell };

export interface NetworkExpiryExportMeta {
  /** UNGET o red, para el título. */
  scope: string;
  windowDays: number;
  generatedAt: Date;
}

const MONEY = '"S/" #,##0.00';

const pharmacyLabel = (lot: ExpiryLot) => (lot.pharmacyName && lot.pharmacyName !== lot.pharmacy ? `${lot.pharmacy} ${lot.pharmacyName}` : lot.pharmacy);

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
