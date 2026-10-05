/**
 * Resumen del recuadro de Inicio, al costado del saludo. Lógica pura: los datos los trae
 * `contexts/NotificationsContext.tsx` en la misma revisión de la campanita (al entrar y
 * cada 15 minutos), así que Inicio no hace lecturas propias.
 *
 *   - Red (permiso Claves de envío): cuántos establecimientos enviaron su stock hoy, con
 *     retraso o llevan más del umbral sin enviar (o nunca enviaron).
 *   - Farmacia (Stock SISMED con establecimiento): lotes vencidos, por vencer y al día de su
 *     propia hoja, con la ventana de «por vencer» de Parámetros del Sistema (la misma regla que
 *     la campanita y Stock SISMED). No hay «sin stock»: la hoja solo trae lotes con saldo.
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
  /** Vencen dentro de la ventana configurada (`expiryDays`). */
  expiring: number;
  /** Con saldo y vencimiento más allá de la ventana (o sin fecha legible). */
  ok: number;
  /** Última actualización de la hoja, en ms (0 si no se sabe). */
  lastUpdateAt: number;
}

export const buildPharmacySummary = (rows: StockRow[], lastUpdateAt: number, expiryDays: number, now: Date = new Date()): PharmacySummary => {
  let expired = 0;
  let expiring = 0;
  let ok = 0;
  rows.forEach((row) => {
    if (parseStockNumber(row.Saldo) <= 0) return;
    const state = getExpirationState(row, expiryDays, now);
    if (state === "EXPIRED") expired += 1;
    else if (state === "EXPIRING") expiring += 1;
    else ok += 1;
  });
  return { expired, expiring, ok, lastUpdateAt };
};
