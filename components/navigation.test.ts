import { describe, expect, it } from "vitest";
import { AVAILABLE_MODULES, AppModule } from "../types";
import { NAV_SECTIONS, findNavItem, findNavSection, findVisibleNavSection, offlineNavItems, visibleNavSections, worksOffline } from "./navigation";

describe("mapa de navegación", () => {
  const enMenu = NAV_SECTIONS.flatMap(section => section.items.map(item => item.module));

  it("no repite ningún módulo", () => {
    expect(new Set(enMenu).size).toBe(enMenu.length);
  });

  it("solo nombra módulos declarados", () => {
    const declarados = new Set(AVAILABLE_MODULES.map(m => m.id));
    expect(enMenu.filter(m => !declarados.has(m))).toEqual([]);
  });

  it("deja fuera solo lo que no es una herramienta del menú", () => {
    const fuera = AVAILABLE_MODULES.map(m => m.id).filter(id => !enMenu.includes(id));
    expect(fuera.sort()).toEqual(["ANALYSIS", "HOME", "PROFILE"]);
  });

  it("oculta las herramientas sin permiso y las secciones que quedan vacías", () => {
    const permitidos = new Set<AppModule>(["IPRESS_STOCK", "ADMIN_BACKUPS", "ADMIN_SEND_KEYS"]);
    const secciones = visibleNavSections(m => permitidos.has(m));
    expect(secciones.map(s => s.id)).toEqual(["stock", "herramientas"]);
    expect(secciones[0].items.map(i => i.module)).toEqual(["IPRESS_STOCK"]);
  });

  it("ubica la sección de un módulo para la miga de pan", () => {
    expect(findNavSection("SIG_SEARCH")?.label).toBe("Stock");
    expect(findNavSection("ADMIN_BACKUPS")?.label).toBe("Herramientas");
    expect(findNavSection("HOME")).toBeNull();
    expect(findNavSection("PROFILE")).toBeNull();
    expect(findNavItem("HOME")?.label).toBe("Inicio");
  });

  it("da a cada sección un nombre corto para la pestaña del teléfono", () => {
    expect(NAV_SECTIONS.map(s => s.shortLabel)).toEqual(["Farmacia", "Stock", "Herramientas", "Admin"]);
  });

  it("solo abre la pantalla de una sección que el usuario ve", () => {
    const permitidos = new Set<AppModule>(["IPRESS_STOCK"]);
    const puede = (m: AppModule) => permitidos.has(m);
    expect(findVisibleNavSection("stock", puede)?.items.map(i => i.module)).toEqual(["IPRESS_STOCK"]);
    expect(findVisibleNavSection("administracion", puede)).toBeNull();
    expect(findVisibleNavSection("no-existe", puede)).toBeNull();
    expect(findVisibleNavSection(null, puede)).toBeNull();
  });
});

describe("herramientas sin internet", () => {
  it("funcionan sin internet las que trabajan con lo que se sube al navegador", () => {
    const offline = NAV_SECTIONS.flatMap(s => s.items).filter(i => i.offline).map(i => i.module);
    expect(offline).toEqual(["DASHBOARD", "AVAILABILITY", "REDISTRIBUTION"]);
    expect(worksOffline("HOME")).toBe(true);
    expect(worksOffline("SIG_SEARCH")).toBe(false);
    expect(worksOffline("PROFILE")).toBe(false);
  });

  it("el aviso solo ofrece las que el usuario puede abrir", () => {
    const items = offlineNavItems(m => m === "AVAILABILITY" || m === "SIG_SEARCH");
    expect(items.map(i => i.module)).toEqual(["AVAILABILITY"]);
  });
});
