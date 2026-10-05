/**
 * Estado de sincronización de la hoja de un establecimiento, por su «última actualización».
 * Mismos cortes en Consulta Stock y en el resumen de Inicio: hasta 1 h al día, hasta 24 h
 * con retraso, y más de un día (o sin fecha) sin actualizar.
 */

export type SyncBucket = "al-dia" | "retraso" | "sin-actualizar";

export const syncBucketOf = (timestamp?: number | null, now: number = Date.now()): SyncBucket => {
  if (!timestamp) return "sin-actualizar";
  const hours = (now - timestamp) / 3_600_000;
  if (hours <= 1) return "al-dia";
  if (hours <= 24) return "retraso";
  return "sin-actualizar";
};
