import { describe, expect, it } from "vitest";
import { NAV_HOME, NAV_SECTIONS } from "./navigation";
import { normalizeSearch, searchTools } from "./toolSearchFilter";

const labels = (q: string) => searchTools(NAV_SECTIONS, q, NAV_HOME).map((r) => r.item.label);

describe("buscador de herramientas", () => {
  it("sin texto muestra todas las herramientas en el orden del menú, sin Inicio", () => {
    const all = searchTools(NAV_SECTIONS, "", NAV_HOME);
    expect(all.length).toBe(NAV_SECTIONS.reduce((n, s) => n + s.items.length, 0));
    expect(all[0].item.label).toBe(NAV_SECTIONS[0].items[0].label);
    expect(all.some((r) => r.item.module === "HOME")).toBe(false);
  });

  it("no distingue tildes ni mayúsculas", () => {
    expect(normalizeSearch("  Envío ")).toBe("envio");
    expect(labels("ENVIO")).toEqual(["Claves de envío"]);
  });

  it("encuentra por el comienzo del nombre y lo pone primero", () => {
    expect(labels("back")[0]).toBe("Backups SISMED");
    expect(labels("stock")[0]).toBe("Stock SISMED");
    expect(labels("stock")).toContain("Consulta Stock");
  });

  it("exige todas las palabras", () => {
    expect(labels("consulta stock")).toEqual(["Consulta Stock"]);
    expect(labels("consulta usuarios")).toEqual([]);
  });

  it("busca también en la descripción y en la sección", () => {
    expect(labels("permisos")).toContain("Configuración de Roles");
    expect(labels("herramientas")).toEqual(["Backups SISMED", "Claves de envío"]);
  });

  it("Inicio aparece solo si se lo busca", () => {
    expect(labels("inicio")[0]).toBe("Inicio");
  });

  it("solo busca entre las secciones que recibe (las que el usuario puede ver)", () => {
    const soloStock = NAV_SECTIONS.filter((s) => s.id === "stock");
    expect(searchTools(soloStock, "backups").length).toBe(0);
  });
});
