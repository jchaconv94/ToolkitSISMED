/**
 * Revisión de guías (2026-10-28, pedido del usuario): lo que el almacén de la UNGET envió a cada
 * establecimiento en un mes frente a lo que el establecimiento ingresó en su ICI, **por
 * producto**, como la hoja CONTROL del Excel con macros «REVISAR_GUIAS» del usuario, que
 * reemplaza y cuyas cifras da. Los lotes de cada producto se guardan para verlos en el detalle
 * (primero se comparó por producto y lote y el usuario no reconocía sus cifras).
 *
 * - **Lo enviado** sale del SISMED del almacén: cada salida vigente (`TMOVIM.MOVCODITIP='S'`,
 *   `MOVSITUA='1'`) con su detalle por producto y lote (`TMOVIMDET`), en el mes de su fecha de
 *   registro (`MOVFECHREG`). La guía es `MOVNUMEDCO` y el destino `ALMCODIDST`. Las salidas a
 *   otro almacén (AEM, almacén logístico) no se revisan: no tienen ICI.
 * - **Lo ingresado** sale del TFORMDET del SISMED donde se importa el ICI de cada
 *   establecimiento: `INGRE + REINGRE` del mes, por producto y lote (como el Excel: «Total
 *   ingreso»). Un establecimiento con farmacias recibe del almacén en su F01: `06519` se
 *   compara con el ICI de `06519F01` (las demás farmacias reciben de la F01, no del almacén).
 *
 * Comprobado con septiembre 2026 del ALM. ANEXO BELLAVISTA: las 2 486 líneas del reporte de
 * guías de salida del Excel y los 34 establecimientos de su hoja CONTROL dan lo mismo. Reglas y
 * casos en docs/REVISION_GUIAS.md.
 */
import { dbfField, dbfRecords, type DbfTable } from "./dbfFile";

export type GuideState = "short" | "notReceived" | "extra" | "notSent" | "complete";

/** Orden de gravedad: primero lo que el establecimiento dejó de ingresar. */
export const GUIDE_STATES: GuideState[] = ["short", "notReceived", "extra", "notSent", "complete"];

export const GUIDE_STATE_LABEL: Record<GuideState, string> = {
  short: "Falta",
  notReceived: "No ingresó",
  extra: "Sobra",
  notSent: "No se dio salida",
  complete: "Completo",
};

/** Una línea de una guía de salida del almacén. */
export interface GuideLine {
  /** Fecha de registro, `AAAA-MM-DD`. */
  date: string;
  /** Mes, `AAAAMM` (como `ANNOMES` del TFORMDET). */
  month: string;
  guide: string;
  destination: string;
  concept: string;
  product: string;
  lot: string;
  quantity: number;
}

export interface WarehouseData {
  /** Código del almacén que emite las guías (el origen más frecuente de sus salidas). */
  code: string;
  lines: GuideLine[];
  /** Meses con guías, del más reciente al más antiguo. */
  months: string[];
}

export interface IciData {
  /** Meses del TFORMDET, del más reciente al más antiguo. */
  months: string[];
  /** Códigos con ICI en cada mes (aunque no hayan ingresado nada). */
  codes: Map<string, Set<string>>;
  /** Ingreso + reingreso por mes, código y producto|lote (solo lo distinto de cero). */
  received: Map<string, Map<string, Map<string, number>>>;
}

export interface Place {
  name: string;
  /** `ALMTIPO` de MALMACEN: P puesto, C centro, H hospital, A/S/L almacenes, V virtual. */
  type: string;
}

/** Un lote de un producto: lo que salió y lo que ingresó con ese número de lote. */
export interface ReviewLot {
  lot: string;
  sent: number;
  received: number;
}

/** Un producto en un establecimiento: lo enviado y lo ingresado sumando todos sus lotes. */
export interface ReviewRow {
  product: string;
  sent: number;
  received: number;
  state: GuideState;
  /** Lotes enviados o ingresados, ordenados por número de lote. */
  lots: ReviewLot[];
  /** Guías del mes con este producto. */
  guides: string[];
  /** Última guía de un mes anterior con este producto al mismo establecimiento. */
  previous: { date: string; guide: string } | null;
}

export interface ReviewSite {
  /** Código al que el almacén envía (`ALMCODIDST`). */
  destination: string;
  /** Código del ICI con que se compara (`06519` o `06519F01`); null si no tiene ICI en el mes. */
  iciCode: string | null;
  guides: string[];
  rows: ReviewRow[];
  counts: Record<GuideState, number>;
  /** Productos con algo distinto de «Completo». */
  differences: number;
  /** Productos que salieron del almacén en el mes («Salida med» del Excel). */
  sentProducts: number;
  /** Productos que el establecimiento ingresó en el mes («Ingreso med» del Excel). */
  receivedProducts: number;
}

export const lineKey = (product: string, lot: string) => `${product}|${lot}`;
const splitKey = (key: string) => {
  const at = key.indexOf("|");
  return { product: key.slice(0, at), lot: key.slice(at + 1) };
};

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
/** Redondeo para comparar cantidades sin arrastrar decimales de punto flotante. */
const qty = (value: number) => Math.round(value * 1000) / 1000;
const byMonthDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** Un código de almacén o subalmacén del SISMED (030A04, 030S05…): no tiene ICI propio. */
export const looksLikeWarehouse = (code: string) => /^\d{3}[AS]\d/i.test(code);

/** Guías de salida vigentes del almacén, con su detalle por producto y lote. */
export const readWarehouse = (tmovim: DbfTable, tmovimdet: DbfTable): WarehouseData => {
  const headers = new Map<string, { origin: string; destination: string; guide: string; concept: string; date: string }>();
  const origins = new Map<string, number>();
  // El mes es el de la fecha de registro; si una salida no la tiene, el de su fecha de emisión.
  const names: Array<"MOVNUMERO" | "ALMCODIORG" | "ALMCODIDST" | "MOVNUMEDCO" | "CCTCODIGO" | "MOVFECHREG" | "MOVFECHEMI"> =
    ["MOVNUMERO", "ALMCODIORG", "ALMCODIDST", "MOVNUMEDCO", "CCTCODIGO", "MOVFECHREG"];
  if (dbfField(tmovim, "MOVFECHEMI")) names.push("MOVFECHEMI");
  for (const r of dbfRecords(tmovim, names, (t) => t("MOVCODITIP") === "S" && t("MOVSITUA") === "1")) {
    const date = text(r.MOVFECHREG) || text(r.MOVFECHEMI);
    if (!date) continue;
    const origin = text(r.ALMCODIORG);
    origins.set(origin, (origins.get(origin) ?? 0) + 1);
    headers.set(text(r.MOVNUMERO), { origin, destination: text(r.ALMCODIDST), guide: text(r.MOVNUMEDCO), concept: text(r.CCTCODIGO), date });
  }
  const code = [...origins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const lines: GuideLine[] = [];
  for (const r of dbfRecords(tmovimdet, ["MOVNUMERO", "MEDCOD", "MEDLOTE", "MOVCANTID"] as const, (t) => t("MOVCODITIP") === "S")) {
    const header = headers.get(text(r.MOVNUMERO));
    if (!header || header.destination === header.origin) continue;
    lines.push({
      date: header.date,
      month: header.date.slice(0, 4) + header.date.slice(5, 7),
      guide: header.guide,
      destination: header.destination,
      concept: header.concept,
      product: text(r.MEDCOD),
      lot: text(r.MEDLOTE),
      quantity: num(r.MOVCANTID),
    });
  }
  return { code, lines, months: [...new Set(lines.map((l) => l.month))].sort(byMonthDesc) };
};

/**
 * Qué hay en un TMOVIM: sirve para explicar por qué una carpeta no tiene guías de salida (la del
 * SISMED del ICI, o una copia vacía fuera de DATOS) en vez de solo decir que no las tiene.
 */
export const movementSummary = (tmovim: DbfTable) => {
  const summary = { total: 0, entries: 0, exits: 0, activeExits: 0, undated: 0, dateType: dbfField(tmovim, "MOVFECHREG")?.type ?? "", first: "", last: "" };
  for (const r of dbfRecords(tmovim, ["MOVCODITIP", "MOVSITUA", "MOVFECHREG"] as const)) {
    summary.total++;
    const type = text(r.MOVCODITIP);
    const date = text(r.MOVFECHREG);
    if (type === "E") summary.entries++;
    if (type === "S") {
      summary.exits++;
      if (text(r.MOVSITUA) === "1") {
        summary.activeExits++;
        if (!date) summary.undated++;
      }
    }
    if (date && (!summary.first || date < summary.first)) summary.first = date;
    if (date && date > summary.last) summary.last = date;
  }
  return summary;
};

/**
 * Por qué las salidas de un TMOVIM no encuentran su detalle en el TMOVIMDET: cuántos registros
 * trae (y cuántos están borrados), cuántos son de salidas y cuántos tienen el número de una
 * salida vigente, con un número de ejemplo de cada archivo para compararlos.
 */
export const detailSummary = (tmovim: DbfTable, tmovimdet: DbfTable) => {
  const numbers = new Set<string>();
  let sampleHeader = "";
  for (const r of dbfRecords(tmovim, ["MOVNUMERO"] as const, (t) => t("MOVCODITIP") === "S" && t("MOVSITUA") === "1")) {
    const number = text(r.MOVNUMERO);
    numbers.add(number);
    if (!sampleHeader) sampleHeader = number;
  }
  const summary = { records: tmovimdet.recordCount, live: 0, exits: 0, matched: 0, sampleHeader, sampleDetail: "" };
  for (const r of dbfRecords(tmovimdet, ["MOVCODITIP", "MOVNUMERO"] as const)) {
    summary.live++;
    if (text(r.MOVCODITIP) !== "S") continue;
    summary.exits++;
    const number = text(r.MOVNUMERO);
    if (!summary.sampleDetail) summary.sampleDetail = number;
    if (numbers.has(number)) summary.matched++;
  }
  return summary;
};

/** Ingreso + reingreso de cada establecimiento por mes, producto y lote, del TFORMDET. */
export const readIci = (tformdet: DbfTable): IciData => {
  const codes = new Map<string, Set<string>>();
  const received = new Map<string, Map<string, Map<string, number>>>();
  for (const r of dbfRecords(tformdet, ["CODIGO_PRE", "ANNOMES", "CODIGO_MED", "MEDLOTE", "INGRE", "REINGRE"] as const)) {
    const month = text(r.ANNOMES);
    const code = text(r.CODIGO_PRE);
    if (!month || !code) continue;
    if (!codes.has(month)) codes.set(month, new Set());
    codes.get(month)!.add(code);
    const q = num(r.INGRE) + num(r.REINGRE);
    if (!q) continue;
    if (!received.has(month)) received.set(month, new Map());
    const site = received.get(month)!;
    if (!site.has(code)) site.set(code, new Map());
    const key = lineKey(text(r.CODIGO_MED), text(r.MEDLOTE));
    site.get(code)!.set(key, (site.get(code)!.get(key) ?? 0) + q);
  }
  return { months: [...codes.keys()].sort(byMonthDesc), codes, received };
};

/** Nombre de cada producto, como lo muestra el ICI: «ACICLOVIR - 200 mg - TABLET». */
export const readProducts = (mproducto: DbfTable): Map<string, string> => {
  const names = new Map<string, string>();
  for (const r of dbfRecords(mproducto, ["MEDCOD", "MEDNOM", "MEDCNC", "MEDFF", "MEDPRES"] as const)) {
    const parts = [r.MEDNOM, r.MEDCNC, r.MEDFF, r.MEDPRES].map(text).filter(Boolean);
    names.set(text(r.MEDCOD), parts.join(" - "));
  }
  return names;
};

/** Nombre y tipo de cada almacén o establecimiento del catálogo del SISMED. */
export const readPlaces = (malmacen: DbfTable): Map<string, Place> => {
  const places = new Map<string, Place>();
  for (const r of dbfRecords(malmacen, ["ALMCOD", "ALMDES", "ALMTIPO"] as const)) {
    places.set(text(r.ALMCOD), { name: text(r.ALMDES), type: text(r.ALMTIPO).toUpperCase() });
  }
  return places;
};

/** Meses que se pueden revisar: los que están en los dos SISMED, del más reciente al más antiguo. */
export const reviewMonths = (warehouse: WarehouseData, ici: IciData) => {
  const inIci = new Set(ici.months);
  return warehouse.months.filter((m) => inIci.has(m));
};

const stateOf = (sent: number, received: number): GuideState => {
  if (sent && !received) return "notReceived";
  if (received && !sent) return "notSent";
  if (sent === received) return "complete";
  return received > sent ? "extra" : "short";
};

const emptyCounts = (): Record<GuideState, number> => ({ short: 0, notReceived: 0, extra: 0, notSent: 0, complete: 0 });

/**
 * Compara lo enviado y lo ingresado en el mes, por establecimiento y producto (sumando sus
 * lotes). Solo entran los destinos de las guías del mes que no son almacenes (`isWarehouse`).
 */
export const reviewGuides = (
  warehouse: WarehouseData,
  ici: IciData,
  month: string,
  isWarehouse: (code: string) => boolean = looksLikeWarehouse,
): ReviewSite[] => {
  type Sent = { lots: Map<string, number>; guides: Set<string> };
  const sent = new Map<string, Map<string, Sent>>();
  const previous = new Map<string, { date: string; guide: string }>();
  const guidesOf = new Map<string, Set<string>>();
  for (const line of warehouse.lines) {
    if (isWarehouse(line.destination)) continue;
    if (line.month < month) {
      const id = `${line.destination}#${line.product}`;
      const last = previous.get(id);
      if (!last || last.date < line.date || (last.date === line.date && last.guide < line.guide)) previous.set(id, { date: line.date, guide: line.guide });
      continue;
    }
    if (line.month !== month) continue;
    if (!sent.has(line.destination)) sent.set(line.destination, new Map());
    const site = sent.get(line.destination)!;
    const entry = site.get(line.product) ?? { lots: new Map<string, number>(), guides: new Set<string>() };
    entry.lots.set(line.lot, (entry.lots.get(line.lot) ?? 0) + line.quantity);
    entry.guides.add(line.guide);
    site.set(line.product, entry);
    if (!guidesOf.has(line.destination)) guidesOf.set(line.destination, new Set());
    guidesOf.get(line.destination)!.add(line.guide);
  }

  const codes = ici.codes.get(month) ?? new Set<string>();
  const receivedByCode = ici.received.get(month) ?? new Map<string, Map<string, number>>();
  return [...sent.entries()].map(([destination, items]) => {
    const iciCode = codes.has(destination) ? destination : codes.has(`${destination}F01`) ? `${destination}F01` : null;
    // Lo ingresado, por producto y lote.
    const received = new Map<string, Map<string, number>>();
    if (iciCode) {
      (receivedByCode.get(iciCode) ?? new Map<string, number>()).forEach((quantity, key) => {
        const { product, lot } = splitKey(key);
        if (!received.has(product)) received.set(product, new Map());
        received.get(product)!.set(lot, quantity);
      });
    }
    const products = [...new Set([...items.keys(), ...received.keys()])].sort();
    const counts = emptyCounts();
    let sentProducts = 0;
    let receivedProducts = 0;
    const rows = products.map((product): ReviewRow => {
      const out = items.get(product)?.lots ?? new Map<string, number>();
      const got = received.get(product) ?? new Map<string, number>();
      const lots = [...new Set([...out.keys(), ...got.keys()])].sort().map((lot) => ({ lot, sent: qty(out.get(lot) ?? 0), received: qty(got.get(lot) ?? 0) }));
      const s = qty(lots.reduce((sum, l) => sum + l.sent, 0));
      const r = qty(lots.reduce((sum, l) => sum + l.received, 0));
      if (s) sentProducts++;
      if (r) receivedProducts++;
      const state = stateOf(s, r);
      counts[state]++;
      return { product, sent: s, received: r, state, lots, guides: [...(items.get(product)?.guides ?? [])].sort(), previous: previous.get(`${destination}#${product}`) ?? null };
    });
    return {
      destination,
      iciCode,
      guides: [...(guidesOf.get(destination) ?? [])].sort(),
      rows,
      counts,
      differences: rows.length - counts.complete,
      sentProducts,
      receivedProducts,
    };
  });
};
