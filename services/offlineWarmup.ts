import { api } from "./api";
import { availabilityConfigApi } from "./availabilityConfig";
import { isOnline } from "./connectivity";

/**
 * Deja guardadas en el equipo las copias que necesitan las herramientas sin internet (modo sin
 * internet, 2026-10-08): registro de establecimientos, microredes y UNGET, la configuración de
 * Disponibilidad y las profesiones. Cada lectura guarda su copia (`services/offlineCache.ts`).
 *
 * Sin esto, quien solo abrió Inicio con internet se quedaba sin el registro y Disponibilidad,
 * sin internet, salía sin microredes ni redes (comprobado en la prueba de punta a punta).
 * Corre por detrás al entrar y al volver la conexión, como mucho una vez cada hora.
 */
const EVERY_MS = 60 * 60 * 1000;
let lastRun = Number.NEGATIVE_INFINITY;
let running: Promise<void> | null = null;

export const warmOfflineCopies = (now: number = Date.now()): Promise<void> => {
  if (!isOnline() || running || now - lastRun < EVERY_MS) return running ?? Promise.resolve();
  lastRun = now;
  running = Promise.allSettled([
    api.getFacilities(),
    api.getMicroredes(),
    api.getUngets(),
    api.getProfessions(),
    availabilityConfigApi.load(),
  ]).then(() => undefined).finally(() => {
    running = null;
  });
  return running;
};
