import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SIGData } from "../types";
import {
  buildNetworkExpiry,
  countsForExpiry,
  describeExpiryDays,
  filterNetworkExpiry,
  parseSheetExpiry,
  sheetExpirationStats,
} from "./networkExpiry";

// La regla de Consulta Stock como estaba antes de pasarla a este servicio (2026-10-27), copiada
// tal cual: la nueva tiene que contar exactamente lo mismo.
/* eslint-disable */
const legacyExpirationStats = (records: SIGData[], expiryWindowDays: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + expiryWindowDays);
  windowEnd.setHours(23, 59, 59, 999);
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  const expired: SIGData[] = [];
  const expiringThisMonth: SIGData[] = [];
  const expiringCalendarMonth: SIGData[] = [];
  const expiringNextMonth: SIGData[] = [];

  records.forEach((r) => {
    const stock = parseFloat(String(r.Saldo || "0").replace(/,/g, ""));
    if (stock <= 0) return;
    if (!r.Fec_Vencim) return;

    const parts = r.Fec_Vencim.split(/[\/\-]/);
    if (parts.length === 3) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      const p2 = parseInt(parts[2], 10);

      let day = 1,
        month = 0,
        year = 2000;

      if (p0 > 1000) {
        // format YYYY-MM-DD
        year = p0;
        month = p1 - 1;
        day = p2;
      } else if (p2 > 1000 || p2 < 100) {
        // format DD/MM/YYYY o MM/DD/YYYY
        year = p2 < 100 ? p2 + 2000 : p2;
        if (p0 > 12) {
          day = p0;
          month = p1 - 1;
        } else if (p1 > 12) {
          month = p0 - 1;
          day = p1;
        } else {
          // Default to DD/MM/YYYY
          day = p0;
          month = p1 - 1;
        }
      }

      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const expDate = new Date(year, month, day);
        // Consider expired strictly if end of the day passed
        expDate.setHours(23, 59, 59, 999);

        if (expDate < today) {
          expired.push(r);
        } else {
          if (expDate <= windowEnd) expiringThisMonth.push(r);
          if (month === currentMonth && year === currentYear) expiringCalendarMonth.push(r);
          else if (month === nextMonth && year === nextMonthYear) expiringNextMonth.push(r);
        }
      }
    } else if (parts.length === 2) {
      // MM/YYYY or MM/YY
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      if (!isNaN(p0) && !isNaN(p1)) {
        const month = p0 - 1;
        const year = p1 < 100 ? p1 + 2000 : p1;
        // Expiry is end of the month
        const expDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
        if (expDate < today) {
          expired.push(r);
        } else {
          if (expDate <= windowEnd) expiringThisMonth.push(r);
          if (month === currentMonth && year === currentYear) expiringCalendarMonth.push(r);
          else if (month === nextMonth && year === nextMonthYear) expiringNextMonth.push(r);
        }
      }
    }
  });

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
/* eslint-enable */

const NOW = new Date(2026, 9, 27, 10, 30); // 27/10/2026

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const row = (Fec_Vencim: string, Saldo = "10", extra: Partial<SIGData> = {}): SIGData => ({ Fec_Vencim, Saldo, ...extra });

describe("parseSheetExpiry", () => {
  it("lee los formatos de la hoja", () => {
    expect(parseSheetExpiry("15/11/2026")?.date).toEqual(new Date(2026, 10, 15, 23, 59, 59, 999));
    expect(parseSheetExpiry("2026-11-15")?.date).toEqual(new Date(2026, 10, 15, 23, 59, 59, 999));
    expect(parseSheetExpiry("15-11-26")?.date).toEqual(new Date(2026, 10, 15, 23, 59, 59, 999));
    // El día pasa de 12 en segundo lugar: viene como mes/día.
    expect(parseSheetExpiry("11/25/2026")?.date).toEqual(new Date(2026, 10, 25, 23, 59, 59, 999));
    // Mes y año: vence el último día del mes.
    expect(parseSheetExpiry("02/2027")?.date).toEqual(new Date(2027, 1, 28, 23, 59, 59, 999));
    expect(parseSheetExpiry("")).toBeNull();
    expect(parseSheetExpiry("sin fecha")).toBeNull();
  });
});

describe("sheetExpirationStats", () => {
  const cases = [
    "26/10/2026", "27/10/2026", "28/10/2026", "25/01/2027", "26/01/2027", "27/01/2027", "15/12/2026",
    "2026-10-01", "2026-11-30", "11/25/2026", "13/13/2026", "31/02/2027", "10/2026", "11/2026", "12/26",
    "01/01/150", "1/1/26", "", "abc", "1/2", "2026-1", "15/11/2026 00:00", " 15/11/2026",
  ];
  const saldos = ["10", "0", "-3", "1,5", "0,000", "abc", "", "2773.125"];

  it("cuenta exactamente lo mismo que la regla anterior de Consulta Stock", () => {
    const records = cases.flatMap((fecha) => saldos.map((saldo) => row(fecha, saldo)));
    for (const days of [30, 90, 180]) {
      const before = legacyExpirationStats(records, days);
      const now = sheetExpirationStats(records, days);
      expect(now.expired).toEqual(before.expired);
      expect(now.expiringThisMonth).toEqual(before.expiringThisMonth);
      expect(now.expiringCalendarMonth).toEqual(before.expiringCalendarMonth);
      expect(now.expiringNextMonth).toEqual(before.expiringNextMonth);
    }
  });

  it("vencido es antes de hoy; por vencer, de hoy al último día de la ventana", () => {
    const stats = sheetExpirationStats([row("26/10/2026"), row("27/10/2026"), row("25/01/2027"), row("26/01/2027")], 90);
    expect(stats.expiredCount).toBe(1);
    expect(stats.expiringThisMonthCount).toBe(2); // hoy y el 25/01, que es el día 90
  });

  it("sin saldo o sin fecha no cuenta", () => {
    expect(countsForExpiry(row("26/10/2026", "0"))).toBe(false);
    expect(countsForExpiry(row("", "10"))).toBe(false);
    expect(countsForExpiry(row("26/10/2026", "5"))).toBe(true);
  });
});

describe("buildNetworkExpiry", () => {
  const sources = [
    {
      id: "a", name: "P.S. Challual", code: "35635",
      rows: [
        row("10/11/2026", "120", { ID_Producto: "01234", Nombre: "PARACETAMOL 500 mg", Lote: "A12", Precio_Det: "0,2", ALMCOD: "35635" }),
        row("20/10/2026", "40", { ID_Producto: "05555", Nombre: "INSULINA NPH", Lote: "C33", Precio_Det: "24.5", ALMCOD: "35635F02" }),
        row("01/06/2027", "50", { Nombre: "LEJANO", Precio_Det: "1" }),
        row("01/11/2026", "0", { Nombre: "SIN SALDO", Precio_Det: "1" }),
      ],
    },
    { id: "b", name: "P.S. Cuzco", code: "06525", rows: [row("01/06/2027", "10")] },
    { id: "c", name: "P.S. Sin datos", code: "06999", rows: [] },
  ];

  it("arma los lotes de cada establecimiento con sus totales", () => {
    const data = buildNetworkExpiry(sources, 90);
    expect(data.sites.map((s) => s.id)).toEqual(["a"]);
    const [site] = data.sites;
    expect(site.lots.map((l) => l.lot)).toEqual(["C33", "A12"]); // el más vencido primero
    expect(site.expiredLots).toBe(1);
    expect(site.expiringLots).toBe(1);
    expect(site.expiredValue).toBeCloseTo(980);
    expect(site.expiringValue).toBeCloseTo(24);
    expect(site.pharmacies).toBe(2);
    expect(site.lots[0]).toMatchObject({ status: "expired", days: -7, balance: 40, price: 24.5, productCode: "05555" });
    expect(site.lots[1]).toMatchObject({ status: "expiring", days: 14, balance: 120 });
    expect(data).toMatchObject({ expiredLots: 1, expiringLots: 1, expiredSites: 1, expiringSites: 1, sitesWithoutData: 1 });
  });

  it("suma lo mismo que la tabla", () => {
    const data = buildNetworkExpiry(sources, 90);
    const table = sources.map((s) => sheetExpirationStats(s.rows, 90));
    expect(data.expiredLots).toBe(table.reduce((sum, s) => sum + s.expiredCount, 0));
    expect(data.expiringLots).toBe(table.reduce((sum, s) => sum + s.expiringThisMonthCount, 0));
  });

  it("filtra por situación y busca sin tildes", () => {
    const data = buildNetworkExpiry(sources, 90);
    expect(filterNetworkExpiry(data, "expired", "").expiredLots).toBe(1);
    expect(filterNetworkExpiry(data, "expired", "").expiringLots).toBe(0);
    expect(filterNetworkExpiry(data, "all", "paracetamol").sites[0].lots.map((l) => l.lot)).toEqual(["A12"]);
    // Por nombre del establecimiento: todos sus lotes.
    expect(filterNetworkExpiry(data, "all", "challual").sites[0].lots).toHaveLength(2);
    expect(filterNetworkExpiry(data, "all", "insulína").sites[0].lots.map((l) => l.lot)).toEqual(["C33"]);
    expect(filterNetworkExpiry(data, "expiring", "insulina").sites).toHaveLength(0);
    expect(filterNetworkExpiry(data, "all", "").sitesWithoutData).toBe(1);
  });
});

describe("describeExpiryDays", () => {
  it("dice cuándo vence o venció", () => {
    expect(describeExpiryDays(-7)).toBe("Venció hace 7 días");
    expect(describeExpiryDays(-1)).toBe("Venció ayer");
    expect(describeExpiryDays(0)).toBe("Vence hoy");
    expect(describeExpiryDays(1)).toBe("Vence mañana");
    expect(describeExpiryDays(14)).toBe("Vence en 14 días");
  });
});
