import type { NavItem, NavSection, NavTint } from "./navigation";

/** Un resultado del buscador de herramientas. */
export interface ToolSearchResult {
  item: NavItem;
  sectionLabel: string;
  tint: NavTint;
}

/** Minúsculas y sin tildes: «Claves de envío» se encuentra escribiendo «envio». */
export const normalizeSearch = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Herramientas que coinciden con lo escrito, en el orden del menú cuando no hay búsqueda.
 *
 * Cada palabra escrita tiene que aparecer en el nombre, el nombre corto, la descripción
 * o el nombre de la sección. Primero van las que empiezan por lo escrito, luego las que lo
 * contienen en el nombre y al final las que solo coinciden en la descripción o la sección.
 * Inicio solo aparece si se lo busca.
 */
export const searchTools = (sections: NavSection[], query: string, home?: NavItem): ToolSearchResult[] => {
  const all: ToolSearchResult[] = sections.flatMap((section) =>
    section.items.map((item) => ({ item, sectionLabel: section.label, tint: section.tint })),
  );
  const q = normalizeSearch(query);
  if (!q) return all;

  const candidates = home ? [{ item: home, sectionLabel: "General", tint: "teal" as NavTint }, ...all] : all;
  const words = q.split(/\s+/).filter(Boolean);

  const scored = candidates
    .map((result, order) => {
      const label = normalizeSearch(result.item.label);
      const short = normalizeSearch(result.item.shortLabel);
      // Inicio se encuentra solo por su nombre: su descripción habla de «herramientas» y
      // aparecería en búsquedas que no son para él.
      const haystack = home && result.item === home
        ? `${label} ${short}`
        : `${label} ${short} ${normalizeSearch(result.item.description)} ${normalizeSearch(result.sectionLabel)}`;
      if (!words.every((w) => haystack.includes(w))) return null;
      const labelWords = `${label} ${short}`.split(/\s+/);
      const score = label.startsWith(q) || short.startsWith(q) ? 0
        : words.every((w) => labelWords.some((lw) => lw.startsWith(w))) ? 1
          : words.every((w) => label.includes(w) || short.includes(w)) ? 2 : 3;
      return { result, score, order };
    })
    .filter((x): x is { result: ToolSearchResult; score: number; order: number } => x !== null);

  // El orden del menú desempata, y los resultados de una sección quedan juntos.
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map((x) => x.result);
};
