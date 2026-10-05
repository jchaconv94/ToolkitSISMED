/**
 * Farmacias de un hospital: qué establecimiento es su «padre» y qué datos heredan de él.
 *
 * Un hospital suele estar dividido en varias farmacias (emergencia, consulta externa…) que
 * SISMED numera como `06502F02`, `06502F03`… Se registran con el tipo `FARMACIA`, pero no
 * se les llena nada más que código y nombre: categoría, jurisdicción, ubicación y contacto
 * son los de su hospital, y se mantienen iguales cuando el hospital cambia (pedido del
 * usuario del 2026-10-05). Los puestos comunales usan el mismo código pero sí tienen datos
 * propios: no heredan.
 */

import type { HealthFacility } from "../types";
import { parseFacilityCode } from "./facilityCodes";

export const PHARMACY_TYPE = "FARMACIA";

export const isPharmacyType = (type?: string | null): boolean => String(type || "").trim().toUpperCase() === PHARMACY_TYPE;

/** Código de la IPRESS a la que pertenece una farmacia `F02` en adelante; `""` si no aplica. */
export const parentIpressCode = (code?: string | null): string => {
  const parsed = parseFacilityCode(code);
  return parsed.kind === "puesto-comunal" ? parsed.ipressCode : "";
};

/** Datos que una farmacia toma de su hospital. Código, nombre y tipo son suyos. */
export const INHERITED_FIELDS = [
  "category", "microredId", "ungetId", "ogessId", "diresaId",
  "legalAddress", "website", "socialMedia", "phone", "email",
  "department", "province", "district",
] as const satisfies ReadonlyArray<keyof HealthFacility>;

/** La farmacia con los datos de su hospital. */
export const inheritFromParent = <T extends Partial<HealthFacility>>(pharmacy: T, parent: Partial<HealthFacility>): T => {
  const next: any = { ...pharmacy };
  INHERITED_FIELDS.forEach((field) => { next[field] = parent[field] ?? (field === "category" ? "" : undefined); });
  return next;
};

/** Establecimiento padre de una farmacia, si está registrado. */
export const findParentFacility = <T extends Pick<HealthFacility, "code">>(code: string | null | undefined, facilities: T[]): T | undefined => {
  const parentCode = parentIpressCode(code);
  return parentCode ? facilities.find((f) => String(f.code).trim().toUpperCase() === parentCode) : undefined;
};

/**
 * Farmacias de un hospital cuyos datos ya no coinciden con los suyos, actualizadas. Al guardar
 * el hospital se guardan estas, para que «se actualicen solas».
 */
export const pharmaciesToSync = (parent: HealthFacility, facilities: HealthFacility[]): HealthFacility[] =>
  facilities
    .filter((f) => isPharmacyType(f.type) && parentIpressCode(f.code) === String(parent.code).trim().toUpperCase())
    .map((f) => ({ before: f, after: inheritFromParent(f, parent) }))
    .filter(({ before, after }) => INHERITED_FIELDS.some((field) => (before[field] ?? "") !== (after[field] ?? "")))
    .map(({ after }) => after);
