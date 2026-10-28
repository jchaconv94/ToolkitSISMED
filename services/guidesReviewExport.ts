/**
 * Excel de Revisión de guías: el resumen por establecimiento (la hoja CONTROL del Excel del
 * usuario), el detalle por producto y lote y las guías de salida del mes, tal como salen del
 * SISMED del almacén. Con `only`, solo un establecimiento (el botón de su ventana).
 */
import ExcelJS from "exceljs";
import { addTableSheet, excelDate } from "./excelCells";
import { GUIDE_STATE_LABEL, type GuideLine, type ReviewSite } from "./guidesReview";

export interface GuidesReviewExportSite {
  site: ReviewSite;
  name: string;
  microred: string;
}

export interface GuidesReviewExportInput {
  warehouseName: string;
  warehouseCode: string;
  /** «Septiembre 2026». */
  monthLabel: string;
  generatedAt: Date;
  sites: GuidesReviewExportSite[];
  /** Líneas de las guías del mes (de los establecimientos revisados). */
  lines: GuideLine[];
  productName: (code: string) => string;
  /** Un solo establecimiento, por su código de destino. */
  only?: string;
}

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return excelDate(new Date(y, m - 1, d));
};

export const siteCode = (site: ReviewSite) => site.iciCode ?? site.destination;

export const siteReview = (site: ReviewSite) => (!site.iciCode ? "Sin ICI del mes" : site.differences ? "Con diferencias" : "Todo ingresó");

export const buildGuidesReviewWorkbook = (input: GuidesReviewExportInput): ExcelJS.Workbook => {
  const workbook = new ExcelJS.Workbook();
  workbook.created = input.generatedAt;
  const sites = input.only ? input.sites.filter((s) => s.site.destination === input.only) : input.sites;
  const names = new Map(sites.map((s) => [s.site.destination, s]));
  const when = input.generatedAt.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const scope = input.only && sites[0] ? `${sites[0].name} (${siteCode(sites[0].site)})` : `${sites.length} establecimientos`;
  const subtitle = `${input.warehouseName} (${input.warehouseCode}) · ${input.monthLabel} · ${scope} · por producto y lote · generado el ${when}`;

  addTableSheet(workbook, "Resumen", "Revisión de guías del almacén", subtitle, [
    { header: "Microred", width: 18 },
    { header: "Código", width: 11, center: true },
    { header: "Establecimiento", width: 34 },
    { header: "Guías", width: 8, center: true },
    { header: "Productos y lotes", width: 11, center: true },
    { header: "Completos", width: 11, center: true },
    { header: "Faltan", width: 9, center: true },
    { header: "Sobran", width: 9, center: true },
    { header: "No ingresó", width: 11, center: true },
    { header: "No se dio salida", width: 12, center: true },
    { header: "Revisión", width: 16, center: true },
  ], sites.map(({ site, name, microred }) => [
    microred || "",
    siteCode(site),
    name,
    site.guides.length,
    site.rows.length,
    site.counts.complete,
    site.counts.short,
    site.counts.extra,
    site.counts.notReceived,
    site.counts.notSent,
    siteReview(site),
  ]));

  addTableSheet(workbook, "Detalle", "Por producto y lote", subtitle, [
    { header: "Código EESS", width: 11, center: true },
    { header: "Establecimiento", width: 30 },
    { header: "Código producto", width: 11, center: true },
    { header: "Producto", width: 46 },
    { header: "Lote", width: 16, center: true },
    { header: "Enviado", width: 10, quantity: true, center: true },
    { header: "Ingresó", width: 10, quantity: true, center: true },
    { header: "Diferencia", width: 10, quantity: true, center: true },
    { header: "Estado", width: 16, center: true },
    { header: "Guías del mes", width: 18, center: true },
    { header: "Guía anterior", width: 12, center: true },
    { header: "Fecha guía anterior", width: 12, numFmt: "dd/mm/yyyy", center: true },
  ], sites.flatMap(({ site, name }) => site.rows.map((row) => [
    siteCode(site),
    name,
    row.product,
    input.productName(row.product),
    row.lot,
    row.sent,
    site.iciCode ? row.received : null,
    site.iciCode ? Math.round((row.received - row.sent) * 1000) / 1000 : null,
    site.iciCode ? GUIDE_STATE_LABEL[row.state] : "Sin ICI del mes",
    row.guides.join(", "),
    row.previous?.guide ?? "",
    row.previous ? dateOf(row.previous.date) : null,
  ])));

  addTableSheet(workbook, "Guías de salida", "Guías de salida del almacén", subtitle, [
    { header: "Fecha registro", width: 12, numFmt: "dd/mm/yyyy", center: true },
    { header: "Guía", width: 11, center: true },
    { header: "Código EESS", width: 11, center: true },
    { header: "Establecimiento", width: 30 },
    { header: "Código producto", width: 11, center: true },
    { header: "Producto", width: 46 },
    { header: "Cantidad", width: 10, quantity: true, center: true },
    { header: "Lote", width: 16, center: true },
    { header: "Concepto", width: 9, center: true },
  ], input.lines.filter((l) => names.has(l.destination)).map((l) => [
    dateOf(l.date),
    l.guide,
    l.destination,
    names.get(l.destination)!.name,
    l.product,
    input.productName(l.product),
    l.quantity,
    l.lot,
    l.concept,
  ]));

  return workbook;
};

/** «Revision_guias_030S05_2026-09.xlsx» o con el establecimiento, sin tildes. */
export const guidesReviewFileName = (warehouseCode: string, month: string, site?: string) => {
  const clean = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `Revision_guias_${clean(warehouseCode) || "almacen"}_${month.slice(0, 4)}-${month.slice(4, 6)}${site ? `_${clean(site)}` : ""}.xlsx`;
};
