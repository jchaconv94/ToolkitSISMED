/**
 * Excel de Revisión de guías: el resumen por establecimiento (la hoja CONTROL del Excel del
 * usuario, con sus columnas), el detalle por producto, sus lotes y las guías de salida del mes,
 * tal como salen del SISMED del almacén. Con `only`, solo un establecimiento (el botón de su
 * ventana).
 */
import ExcelJS from "exceljs";
import { addTableSheet, excelDate } from "./excelCells";
import { GUIDE_STATE_LABEL, type GuideLine, type ReviewLot, type ReviewSite } from "./guidesReview";
import { formatNumber } from "./numberFormat";

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

/** «2027896: 50» o, si no coinciden, «2027896: env. 50 · ing. 51». */
const lotsText = (lots: ReviewLot[], noIci: boolean) =>
  lots.map((l) => {
    const q = (n: number) => formatNumber(n, 3);
    return `${l.lot || "Sin lote"}: ${noIci || l.sent === l.received ? q(l.sent) : `env. ${q(l.sent)} · ing. ${q(l.received)}`}`;
  }).join("; ");

export const siteReview = (site: ReviewSite) => (!site.iciCode ? "Sin ICI del mes" : site.differences ? "Con diferencias" : "Todo ingresó");

export const buildGuidesReviewWorkbook = (input: GuidesReviewExportInput): ExcelJS.Workbook => {
  const workbook = new ExcelJS.Workbook();
  workbook.created = input.generatedAt;
  const sites = input.only ? input.sites.filter((s) => s.site.destination === input.only) : input.sites;
  const names = new Map(sites.map((s) => [s.site.destination, s]));
  const when = input.generatedAt.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const scope = input.only && sites[0] ? `${sites[0].name} (${siteCode(sites[0].site)})` : `${sites.length} establecimientos`;
  const subtitle = `${input.warehouseName} (${input.warehouseCode}) · ${input.monthLabel} · ${scope} · por producto · generado el ${when}`;

  addTableSheet(workbook, "Resumen", "Revisión de guías del almacén", subtitle, [
    { header: "Microred", width: 18 },
    { header: "Código", width: 11, center: true },
    { header: "Establecimiento", width: 34 },
    { header: "Nº guías", width: 8, center: true },
    { header: "Salida med", width: 9, center: true },
    { header: "Ingreso med", width: 9, center: true },
    { header: "Completo", width: 10, center: true },
    { header: "No salida", width: 9, center: true },
    { header: "Sobra", width: 8, center: true },
    { header: "Falta", width: 8, center: true },
    { header: "No ingresó", width: 10, center: true },
    { header: "Revisión", width: 16, center: true },
  ], sites.map(({ site, name, microred }) => {
    const ici = Boolean(site.iciCode);
    return [
      microred || "",
      siteCode(site),
      name,
      site.guides.length,
      site.sentProducts,
      ici ? site.receivedProducts : null,
      ici ? site.counts.complete : null,
      ici ? site.counts.notSent : null,
      ici ? site.counts.extra : null,
      ici ? site.counts.short : null,
      ici ? site.counts.notReceived : null,
      siteReview(site),
    ];
  }));

  addTableSheet(workbook, "Detalle", "Por producto", subtitle, [
    { header: "Código EESS", width: 11, center: true },
    { header: "Establecimiento", width: 30 },
    { header: "Código producto", width: 11, center: true },
    { header: "Producto", width: 46 },
    { header: "Enviado", width: 10, quantity: true, center: true },
    { header: "Ingresó", width: 10, quantity: true, center: true },
    { header: "Diferencia", width: 10, quantity: true, center: true },
    { header: "Estado", width: 16, center: true },
    { header: "Lotes", width: 40 },
    { header: "Guías del mes", width: 18, center: true },
    { header: "Guía anterior", width: 12, center: true },
    { header: "Fecha guía anterior", width: 12, numFmt: "dd/mm/yyyy", center: true },
  ], sites.flatMap(({ site, name }) => site.rows.map((row) => [
    siteCode(site),
    name,
    row.product,
    input.productName(row.product),
    row.sent,
    site.iciCode ? row.received : null,
    site.iciCode ? Math.round((row.received - row.sent) * 1000) / 1000 : null,
    site.iciCode ? GUIDE_STATE_LABEL[row.state] : "Sin ICI del mes",
    lotsText(row.lots, !site.iciCode),
    row.guides.join(", "),
    row.previous?.guide ?? "",
    row.previous ? dateOf(row.previous.date) : null,
  ])));

  addTableSheet(workbook, "Lotes", "Por producto y lote", subtitle, [
    { header: "Código EESS", width: 11, center: true },
    { header: "Establecimiento", width: 30 },
    { header: "Código producto", width: 11, center: true },
    { header: "Producto", width: 46 },
    { header: "Lote", width: 16, center: true },
    { header: "Enviado", width: 10, quantity: true, center: true },
    { header: "Ingresó", width: 10, quantity: true, center: true },
    { header: "Diferencia", width: 10, quantity: true, center: true },
    { header: "Estado del producto", width: 18, center: true },
  ], sites.flatMap(({ site, name }) => site.rows.flatMap((row) => row.lots.map((lot) => [
    siteCode(site),
    name,
    row.product,
    input.productName(row.product),
    lot.lot,
    lot.sent,
    site.iciCode ? lot.received : null,
    site.iciCode ? Math.round((lot.received - lot.sent) * 1000) / 1000 : null,
    site.iciCode ? GUIDE_STATE_LABEL[row.state] : "Sin ICI del mes",
  ]))));

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
