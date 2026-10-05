/**
 * Resumen del recuadro de Inicio, al costado del saludo. Lógica pura: los datos los trae
 * `contexts/NotificationsContext.tsx` en la misma revisión de la campanita (al entrar y
 * cada 15 minutos), así que Inicio no hace lecturas propias.
 *
 *   - Red (permiso Claves de envío): cuántos establecimientos enviaron su stock hoy, con
 *     retraso o llevan más del umbral sin enviar (o nunca enviaron).
 *   - Farmacia (Stock SISMED con establecimiento): lotes vencidos, por vencer y medicamentos
 *     sin stock de su propia hoja, con las mismas reglas que la campanita y Stock SISMED.
 */

import type { SendKeyRow } from "./sendKeys";
import type { ToolkitDeviceRow } from "./toolkitDevices";
import { lastSendAt, mergeEstablishments } from "./sendKeyEstablishments";
import { type StockRow, getExpirationState, parseStockNumber } from "./assignedIpressStock";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NetworkSummary {
  total: number;
  /** Envió en las últimas 24 horas. */
  upToDate: number;
  /** Envió hace más de un día, pero dentro del umbral. */
  late: number;
  /** Más del umbral sin enviar, o nunca envió. */
  stale: number;
}

export const buildNetworkSummary = (keys: SendKeyRow[], devices: ToolkitDeviceRow[], staleDays: number, now: Date = new Date()): NetworkSummary => {
  const summary: NetworkSummary = { total: 0, upToDate: 0, late: 0, stale: 0 };
  mergeEstablishments(keys, devices).forEach((row) => {
    summary.total += 1;
    const last = lastSendAt(row, now);
    const age = last ? now.getTime() - new Date(last).getTime() : Infinity;
    if (age <= DAY_MS) summary.upToDate += 1;
    else if (age <= staleDays * DAY_MS) summary.late += 1;
    else summary.stale += 1;
  });
  return summary;
};

export interface PharmacySummary {
  expired: number;
  expiring: number;
  /** Medicamentos (no lotes) cuyo saldo total es cero. */
  empty: number;
  /** Última actualización de la hoja, en ms (0 si no se sabe). */
  lastUpdateAt: number;
}

export const buildPharmacySummary = (rows: StockRow[], lastUpdateAt: number, expiryDays: number, now: Date = new Date()): PharmacySummary => {
  let expired = 0;
  let expiring = 0;
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const state = getExpirationState(row, expiryDays, now);
    if (state === "EXPIRED") expired += 1;
    else if (state === "EXPIRING") expiring += 1;
    const key = String(row.Id_Producto || row.Nombre || "").trim();
    if (key) totals.set(key, (totals.get(key) || 0) + parseStockNumber(row.Saldo));
  });
  const empty = Array.from(totals.values()).filter((total) => total <= 0).length;
  return { expired, expiring, empty, lastUpdateAt };
};
