import { User } from "../types";

/**
 * Cómo se presenta al usuario de la sesión: su nombre, su inicial y el saludo.
 *
 * Lo usan la cabecera (menú del usuario), la pantalla de Inicio y el aviso de bienvenida,
 * para que los tres digan lo mismo.
 */

/** «JORGE LUIS» → «Jorge Luis». Los nombres del padrón suelen venir en mayúsculas. */
const titleCase = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("es-PE")
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => `${sep}${letter.toLocaleUpperCase("es-PE")}`);

/** Primer nombre, o el usuario si la cuenta no tiene personal vinculado. */
export const userFirstName = (user: User | null | undefined): string => {
  const first = user?.personnelData?.firstName?.trim().split(/\s+/)[0];
  return first ? titleCase(first) : user?.username || "";
};

/** Nombre y apellido, o el usuario si la cuenta no tiene personal vinculado. */
export const userFullName = (user: User | null | undefined): string => {
  const p = user?.personnelData;
  const full = [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
  return full ? titleCase(full) : user?.username || "";
};

/** Inicial para el avatar. */
export const userInitial = (user: User | null | undefined): string =>
  (userFirstName(user).charAt(0) || "?").toLocaleUpperCase("es-PE");

const LIMA = "America/Lima";

/** Hora (0–23) en Lima, sea cual sea el huso del equipo. */
export const limaHour = (date: Date = new Date()): number => {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: LIMA, hour: "numeric", hourCycle: "h23" }).format(date);
  return Number(hour) % 24;
};

/** Saludo según la hora en Lima. De madrugada todavía es de noche. */
export const greetingFor = (date: Date = new Date()): string => {
  const hour = limaHour(date);
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 18) return "Buenas tardes";
  return "Buenas noches";
};

/** «Viernes, 3 de octubre de 2026», en Lima. */
export const limaLongDate = (date: Date = new Date()): string => {
  const text = date.toLocaleDateString("es-PE", { timeZone: LIMA, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return text.charAt(0).toLocaleUpperCase("es-PE") + text.slice(1);
};
