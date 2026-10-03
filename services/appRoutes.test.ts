import { describe, expect, it } from "vitest";
import { APP_BASE, moduleForPath, pathForModule } from "./appRoutes";
import { AVAILABLE_MODULES, AppModule } from "../types";

describe("rutas de la aplicación", () => {
  it("da una dirección propia a cada módulo del menú", () => {
    const vistas = AVAILABLE_MODULES.map(m => m.id);
    const rutas = vistas.map(pathForModule);
    expect(new Set(rutas).size).toBe(vistas.length);
  });

  it("vuelve al mismo módulo desde su dirección", () => {
    AVAILABLE_MODULES.forEach(({ id }) => {
      expect(moduleForPath(pathForModule(id))).toBe(id);
    });
  });

  it("usa las direcciones acordadas", () => {
    expect(pathForModule("ANALYSIS_EXCLUSIONS")).toBe(`${APP_BASE}/analisis/exclusiones`);
    expect(pathForModule("ADMIN_SEND_KEYS")).toBe(`${APP_BASE}/administracion/claves-de-envio`);
    expect(pathForModule("ADMIN_USERS")).toBe(`${APP_BASE}/administracion/usuarios`);
  });

  it("acepta la dirección con o sin el prefijo de publicación", () => {
    expect(moduleForPath("/analisis/exclusiones")).toBe("ANALYSIS_EXCLUSIONS");
    expect(moduleForPath(`${APP_BASE}/analisis/exclusiones`)).toBe("ANALYSIS_EXCLUSIONS");
  });

  it("ignora la barra final, la consulta y el fragmento", () => {
    expect(moduleForPath(`${APP_BASE}/analisis/exclusiones/`)).toBe("ANALYSIS_EXCLUSIONS");
    expect(moduleForPath(`${APP_BASE}/analisis/exclusiones?x=1`)).toBe("ANALYSIS_EXCLUSIONS");
    expect(moduleForPath(`${APP_BASE}/analisis/exclusiones#seccion`)).toBe("ANALYSIS_EXCLUSIONS");
  });

  it("abre Inicio en la raíz", () => {
    expect(pathForModule("HOME")).toBe(`${APP_BASE}/inicio`);
    expect(moduleForPath(APP_BASE)).toBe("HOME");
    expect(moduleForPath(`${APP_BASE}/`)).toBe("HOME");
    expect(moduleForPath("/")).toBe("HOME");
    expect(moduleForPath("")).toBe("HOME");
  });

  it("devuelve null en direcciones desconocidas", () => {
    expect(moduleForPath(`${APP_BASE}/no-existe`)).toBeNull();
    expect(moduleForPath("/no-existe")).toBeNull();
  });

  it("no deja ningún módulo sin ruta declarada", () => {
    // Si alguien agrega un AppModule y olvida su ruta, cae en la de Inicio.
    const sinRuta = (AVAILABLE_MODULES.map(m => m.id) as AppModule[])
      .filter(id => id !== "HOME" && pathForModule(id) === pathForModule("HOME"));
    expect(sinRuta).toEqual([]);
  });
});
