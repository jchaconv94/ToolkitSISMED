/**
 * ¿Es una vacuna o un producto de inmunizaciones? Se reconoce por el nombre: VACUNA, la
 * abreviatura VAC., TOXOIDE y DILUYENTE. Antes solo se buscaban «VACUNA» y «DILUYENTE», y
 * «VAC. ANTIAMARILICA» o «TOXOIDE TETANICO» se colaban en el análisis aunque se pidiera
 * excluir las vacunas.
 *
 * Es el filtro por defecto de «Excluir vacunas» al ejecutar el análisis; la Lista de
 * Exclusiones del establecimiento es un filtro aparte (un producto en los dos sale una vez).
 */
const VACCINE_PATTERN = /(^|[^A-Z])(VACUNA|VAC\.|VAC(?=\s)|TOXOIDE|DILUYENTE)/;

export const isVaccineProduct = (name?: string | null): boolean =>
  VACCINE_PATTERN.test(String(name || "").toUpperCase());
