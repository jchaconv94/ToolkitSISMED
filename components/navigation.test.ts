import { describe, expect, it } from "vitest";
import { AVAILABLE_MODULES, AppModule } from "../types";
import { NAV_SECTIONS, findNavItem, findNavSection, visibleNavSections } from "./navigation";

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
});
