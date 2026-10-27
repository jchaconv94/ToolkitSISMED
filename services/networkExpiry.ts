/**
 * Vencimientos de la red en Consulta Stock: lotes vencidos y por vencer de todos los
 * establecimientos a la vista, agrupados por establecimiento (pedido del usuario, 2026-10-27).
 *
 * La regla es la de la tabla de establecimientos de Consulta Stock (`sheetExpirationStats`, con
 * `parseSheetExpiry` y `countsForExpiry`): así la ventana suma lo mismo que las columnas
 * «Por vencer» y «Vencidos». «Por vencer» es de hoy a la ventana de días de Parámetros del Sistema.
 */
import type { SIGData } from "../types";
import { parseSheetNumber } from "./numberFormat";
import { normalizeStockText } from "./stockNetworkSearch";

export interface SheetExpiry {
  /** Último instante del día de vencimiento (o del mes, si la hoja trae `MM/AAAA`). */
  date: Date;
  /** Mes y año como los escribe la hoja (la tabla los usa para «este mes» y «el próximo»). */
  month: number;
  year: number;
}

/**
 * Fecha de vencimiento de una fila de Google Sheets. Acepta `dd/mm/aaaa`, `aaaa-mm-dd`,
 * `mm/dd/aaaa` cuando el día pasa de 12, años de dos cifras y `mm/aaaa` (vence a fin de mes).
 * `null` si no se entiende.
 */
export const parseSheetExpiry = (text: unknown): SheetExpiry | null => {
  const parts = String(text ?? "").split(/[/-]/);
  if (parts.length === 3) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);
    let day = 1;
    let month = 0;
    let year = 2000;
    if (p0 > 1000) {
      year = p0;
      month = p1 - 1;
      day = p2;
    } else if (p2 > 1000 || p2 < 100) {
      year = p2 < 100 ? p2 + 2000 : p2;
      if (p0 > 12) {
        day = p0;
        month = p1 - 1;
      } else if (p1 > 12) {
        month = p0 - 1;
        day = p1;
      } else {
        day = p0;
        month = p1 - 1;
      }
    }
    if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
    return { date: new Date(year, month, day, 23, 59, 59, 999), month, year };
  }
  if (parts.length === 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    if (Number.isNaN(p0) || Number.isNaN(p1)) return null;
    const month = p0 - 1;
    const year = p1 < 100 ? p1 + 2000 : p1;
    return { date: new Date(year, month + 1, 0, 23, 59, 59, 999), month, year };
  }
  return null;
};

/** Si un lote entra en el conteo de vencimientos: con saldo y con fecha. Igual que la tabla. */
export const countsForExpiry = (row: Pick<SIGData, "Saldo" | "Fec_Vencim">): boolean => {
  const stock = parseFloat(String(row.Saldo || "0").replace(/,/g, ""));
  return !(stock <= 0) && Boolean(row.Fec_Vencim);
};

export type ExpiryStatus = "expired" | "expiring";

/** Inicio de hoy y fin del último día de la ventana. */
export const expiryWindow = (windowDays: number, now: Date = new Date()) => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + windowDays);
  windowEnd.setHours(23, 59, 59, 999);
  return { today, windowEnd };
};

/**
 * Conteos de la tabla de establecimientos de Consulta Stock. `expiringThisMonth` conserva su
 * nombre, pero es «vence dentro de la ventana»; `expiringCalendarMonth` y `expiringNextMonth`
 * son por mes calendario (columnas del reporte en Excel).
 */
export const sheetExpirationStats = <T extends Pick<SIGData, "Saldo" | "Fec_Vencim">>(records: T[], windowDays: number, now: Date = new Date()) => {
  const { today, windowEnd } = expiryWindow(windowDays, now);
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  const expired: T[] = [];
  const expiringThisMonth: T[] = [];
  const expiringCalendarMonth: T[] = [];
  const expiringNextMonth: T[] = [];

  for (const row of records) {
    if (!countsForExpiry(row)) continue;
    const expiry = parseSheetExpiry(row.Fec_Vencim);
    if (!expiry) continue;
    const { date, month, year } = expiry;
    if (date < today) {
      expired.push(row);
      continue;
    }
    if (date <= windowEnd) expiringThisMonth.push(row);
    if (month === currentMonth && year === currentYear) expiringCalendarMonth.push(row);
    else if (month === nextMonth && year === nextMonthYear) expiringNextMonth.push(row);
  }

  return {
    expired,
    expiringThisMonth,
    expiringCalendarMonth,
    expiringNextMonth,
    expiredCount: expired.length,
    expiringThisMonthCount: expiringThisMonth.length,
    expiringCalendarMonthCount: expiringCalendarMonth.length,
    expiringNextMonthCount: expiringNextMonth.length,
  };
};

export interface ExpiryLot {
  siteId: string;
  /** Farmacia o puesto del establecimiento (ALMCOD), si la hoja lo trae. */
  pharmacy: string;
  pharmacyName: string;
  productCode: string;
  productName: string;
  lot: string;
  expiryText: string;
  expiry: Date;
  /** Días de hoy al vencimiento: negativo si ya venció. */
  days: number;
  balance: number;
  price: number;
  value: number;
  status: ExpiryStatus;
}

export interface ExpirySite {
  id: string;
  name: string;
  code: string;
  /** Lotes ordenados por vencimiento, el más próximo (o el más vencido) primero. */
  lots: ExpiryLot[];
  expiredLots: number;
  expiringLots: number;
  expiredValue: number;
  expiringValue: number;
  /** Cuántas farmacias o puestos distintos aparecen en sus lotes. */
  pharmacies: number;
}

export interface NetworkExpiry {
  /** Solo los establecimientos con algún lote vencido o por vencer. */
  sites: ExpirySite[];
  expiredLots: number;
  expiringLots: number;
  expiredValue: number;
  expiringValue: number;
  expiredSites: number;
  expiringSites: number;
  /** Establecimientos a la vista cuya hoja todavía no tiene filas cargadas. */
  sitesWithoutData: number;
}

export interface ExpirySourceSite {
  id: string;
  name: string;
  code: string;
  rows: SIGData[];
}

const DAY_MS = 86_400_000;
const text = (value: unknown) => String(value ?? "").trim();

const summarize = (site: Omit<ExpirySite, "expiredLots" | "expiringLots" | "expiredValue" | "expiringValue" | "pharmacies">): ExpirySite => {
  const expired = site.lots.filter((lot) => lot.status === "expired");
  const expiring = site.lots.filter((lot) => lot.status === "expiring");
  return {
    ...site,
    expiredLots: expired.length,
    expiringLots: expiring.length,
    expiredValue: expired.reduce((sum, lot) => sum + lot.value, 0),
    expiringValue: expiring.reduce((sum, lot) => sum + lot.value, 0),
    pharmacies: new Set(site.lots.map((lot) => lot.pharmacy).filter(Boolean)).size,
  };
};

const totals = (sites: ExpirySite[], sitesWithoutData: number): NetworkExpiry => ({
  sites,
  expiredLots: sites.reduce((sum, site) => sum + site.expiredLots, 0),
  expiringLots: sites.reduce((sum, site) => sum + site.expiringLots, 0),
  expiredValue: sites.reduce((sum, site) => sum + site.expiredValue, 0),
  expiringValue: sites.reduce((sum, site) => sum + site.expiringValue, 0),
  expiredSites: sites.filter((site) => site.expiredLots > 0).length,
  expiringSites: sites.filter((site) => site.expiringLots > 0).length,
  sitesWithoutData,
});

/** Lotes vencidos y por vencer de cada establecimiento, con sus totales y los de la red. */
export const buildNetworkExpiry = (sources: ExpirySourceSite[], windowDays: number, now: Date = new Date()): NetworkExpiry => {
  const { today, windowEnd } = expiryWindow(windowDays, now);
  const sites: ExpirySite[] = [];
  let sitesWithoutData = 0;
  for (const source of sources) {
    if (source.rows.length === 0) {
      sitesWithoutData += 1;
      continue;
    }
    const lots: ExpiryLot[] = [];
    for (const row of source.rows) {
      if (!countsForExpiry(row)) continue;
      const parsed = parseSheetExpiry(row.Fec_Vencim);
      if (!parsed) continue;
      const status: ExpiryStatus | null = parsed.date < today ? "expired" : parsed.date <= windowEnd ? "expiring" : null;
      if (!status) continue;
      const startOfDay = new Date(parsed.date);
      startOfDay.setHours(0, 0, 0, 0);
      const balance = parseSheetNumber(row.Saldo);
      const price = parseSheetNumber(row.Precio_Det);
      lots.push({
        siteId: source.id,
        pharmacy: text(row.ALMCOD),
        pharmacyName: text(row.DESC_ALM),
        productCode: text(row.ID_Producto) || text(row.CODIGO_SIG),
        productName: text(row.Nombre),
        lot: text(row.Lote),
        expiryText: text(row.Fec_Vencim),
        expiry: parsed.date,
        days: Math.round((startOfDay.getTime() - today.getTime()) / DAY_MS),
        balance,
        price,
        value: balance * price,
        status,
      });
    }
    if (lots.length === 0) continue;
    lots.sort((a, b) => a.expiry.getTime() - b.expiry.getTime() || a.productName.localeCompare(b.productName, "es"));
    sites.push(summarize({ id: source.id, name: source.name, code: source.code, lots }));
  }
  return totals(sites, sitesWithoutData);
};

export type ExpiryFilter = "all" | ExpiryStatus;

/**
 * Lo que muestra la ventana: solo vencidos, solo por vencer o todo, y la búsqueda (sin tildes)
 * por establecimiento, código, producto o lote. Un establecimiento que coincide por nombre
 * muestra todos sus lotes; si no, solo los lotes que coinciden.
 */
export const filterNetworkExpiry = (data: NetworkExpiry, filter: ExpiryFilter, query: string): NetworkExpiry => {
  const needle = normalizeStockText(query);
  const sites: ExpirySite[] = [];
  for (const site of data.sites) {
    const siteMatches = !needle || normalizeStockText(`${site.name} ${site.code}`).includes(needle);
    const lots = site.lots.filter(
      (lot) =>
        (filter === "all" || lot.status === filter) &&
        (siteMatches || normalizeStockText(`${lot.productCode} ${lot.productName} ${lot.lot} ${lot.pharmacy} ${lot.pharmacyName}`).includes(needle)),
    );
    if (lots.length > 0) sites.push(summarize({ id: site.id, name: site.name, code: site.code, lots }));
  }
  return totals(sites, data.sitesWithoutData);
};

/** «Venció hace 3 días», «Vence hoy», «Vence en 12 días». */
export const describeExpiryDays = (days: number): string => {
  if (days < -1) return `Venció hace ${-days} días`;
  if (days === -1) return "Venció ayer";
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} días`;
};
