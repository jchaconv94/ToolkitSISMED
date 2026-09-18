import { describe, it, expect } from "vitest";
import {
  cachedSourcesStillMatch,
  describeConnectionMode,
  normalizeUngetName,
  pickOneConnectionPerUnget,
  ungetConnectionKey,
  ungetConnectionKeys,
} from "./ungetConnections";

const esVirtual = (url?: string) => String(url || "").startsWith("sheets://");

describe("normalizeUngetName", () => {
  it("iguala las variantes con las que se escribió la misma UNGET", () => {
    expect(normalizeUngetName("Bellavista")).toBe(normalizeUngetName("BELLAVISTA"));
    expect(normalizeUngetName("Mariscal Cáceres")).toBe(normalizeUngetName("MARICAL C."));
    expect(normalizeUngetName("UNGET San Martin")).toBe(normalizeUngetName("San Martín"));
    expect(normalizeUngetName("")).toBe("");
  });

  it("no confunde UNGET distintas", () => {
    expect(normalizeUngetName("El Dorado")).not.toBe(normalizeUngetName("Tocache"));
  });
});

describe("ungetConnectionKey", () => {
  it("agrupa por identificador oficial cuando lo hay", () => {
    expect(ungetConnectionKey({ name: "Bellavista", ungetId: "u-1" })).toBe("id:u-1");
    expect(ungetConnectionKey({ name: "BELLAVISTA", ungetId: "u-1" })).toBe("id:u-1");
  });

  it("cae al nombre cuando la fila todavía no tiene identificador", () => {
    expect(ungetConnectionKey({ name: "Bellavista" })).toBe(ungetConnectionKey({ name: "BELLAVISTA" }));
  });
});

describe("pickOneConnectionPerUnget", () => {
  // Caso real del 18/09/2026: 15 filas para 7 UNGET, y solo la de admin tenía hoja.
  const bellavistaAdmin = { name: "Bellavista", ungetId: "u-1", username: "admin", spreadsheetId: "LIBRO_A" };
  const bellavistaLocal = { name: "BELLAVISTA", ungetId: "u-1", username: "bellavista", url: "https://script.google.com/x" };

  const contexto = {
    currentUsername: "admin",
    ungetIdByUsername: { bellavista: "u-1", admin: undefined, sanmartin: "u-2", cfrio: "u-2" },
  };

  it("deja una sola conexión por UNGET", () => {
    const elegidas = pickOneConnectionPerUnget([bellavistaAdmin, bellavistaLocal], contexto);
    expect(elegidas).toHaveLength(1);
  });

  it("prefiere la que tiene hoja, porque es la que lee directo", () => {
    expect(pickOneConnectionPerUnget([bellavistaLocal, bellavistaAdmin], contexto)[0]).toBe(bellavistaAdmin);
    expect(pickOneConnectionPerUnget([bellavistaAdmin, bellavistaLocal], contexto)[0]).toBe(bellavistaAdmin);
  });

  it("sin hoja de por medio, se queda la del informático de esa UNGET", () => {
    const deAdmin = { name: "San Martin", ungetId: "u-2", username: "admin" };
    const delInformatico = { name: "San Martín", ungetId: "u-2", username: "sanmartin" };
    expect(pickOneConnectionPerUnget([deAdmin, delInformatico], contexto)[0]).toBe(delInformatico);
    expect(pickOneConnectionPerUnget([delInformatico, deAdmin], contexto)[0]).toBe(delInformatico);
  });

  it("conserva el orden de aparición y no toca las UNGET distintas", () => {
    const tocache = { name: "Tocache", ungetId: "u-3", username: "mirian" };
    const elegidas = pickOneConnectionPerUnget([tocache, bellavistaAdmin, bellavistaLocal], contexto);
    expect(elegidas.map((c) => c.name)).toEqual(["Tocache", "Bellavista"]);
  });

  it("agrupa aunque las filas todavía no tengan identificador", () => {
    const sinId = [
      { name: "Huallaga", username: "huallaga", url: "https://script.google.com/h" },
      { name: "HUALLAGA", username: "admin" },
    ];
    expect(pickOneConnectionPerUnget(sinId, contexto)).toHaveLength(1);
  });

  it("no se cae con una lista vacía o con huecos", () => {
    expect(pickOneConnectionPerUnget([], contexto)).toEqual([]);
    expect(pickOneConnectionPerUnget([null as any, bellavistaAdmin], contexto)).toHaveLength(1);
  });
});

describe("describeConnectionMode", () => {
  it("distingue lectura directa, Apps Script y sin hoja", () => {
    expect(describeConnectionMode({ name: "A", spreadsheetId: "LIBRO" }, esVirtual)).toBe("directa");
    expect(describeConnectionMode({ name: "B", url: "https://script.google.com/x" }, esVirtual)).toBe("apps-script");
    expect(describeConnectionMode({ name: "C", url: "sheets://LIBRO" }, esVirtual)).toBe("sin-hoja");
    expect(describeConnectionMode({ name: "D" }, esVirtual)).toBe("sin-hoja");
  });
});

describe("ungetConnectionKeys", () => {
  it("reconoce la UNGET por identificador y por nombre", () => {
    expect(ungetConnectionKeys({ name: "Bellavista", ungetId: "u-1" })).toEqual([
      "id:u-1",
      "nombre:BELLAVISTA",
    ]);
  });

  it("una fila sin identificador todavía se reconoce por el nombre", () => {
    expect(ungetConnectionKeys({ name: "BELLAVISTA" })).toEqual(["nombre:BELLAVISTA"]);
  });

  it("permite descartar una UNGET ya configurada por otro usuario", () => {
    const configurada = new Set(ungetConnectionKeys({ name: "MARICAL C.", username: "MARISCAL" }));
    const candidata = { name: "Mariscal Cáceres", ungetId: "u-9" };
    expect(ungetConnectionKeys(candidata).some((k) => configurada.has(k))).toBe(true);
  });

  it("no descarta una UNGET distinta", () => {
    const configurada = new Set(ungetConnectionKeys({ name: "Tocache" }));
    expect(ungetConnectionKeys({ name: "Picota", ungetId: "u-4" }).some((k) => configurada.has(k))).toBe(false);
  });
});

describe("cachedSourcesStillMatch", () => {
  const huallaga = { name: "Huallaga", ungetId: "u-h" };
  const bellavista = { name: "Bellavista", ungetId: "u-b" };
  const dorado = { name: "El Dorado", ungetId: "u-d" };

  it("la caché sirve si cada posición sigue siendo la misma UNGET", () => {
    expect(cachedSourcesStillMatch([huallaga, bellavista], [huallaga, bellavista])).toBe(true);
    // El nombre puede venir escrito de otra forma; la UNGET es la misma.
    expect(cachedSourcesStillMatch([bellavista], [{ name: "BELLAVISTA", ungetId: "u-b" }])).toBe(true);
  });

  it("no sirve si cambió el orden: es el caso que metió las hojas de Bellavista en Huallaga", () => {
    expect(cachedSourcesStillMatch([bellavista, huallaga], [huallaga, bellavista])).toBe(false);
  });

  it("no sirve si cambió el número de conexiones", () => {
    expect(cachedSourcesStillMatch([huallaga, bellavista, dorado], [huallaga, bellavista])).toBe(false);
    expect(cachedSourcesStillMatch([], [huallaga])).toBe(false);
  });

  it("sin caché previa no hay nada que reutilizar", () => {
    expect(cachedSourcesStillMatch(null, [huallaga])).toBe(false);
    expect(cachedSourcesStillMatch([], [])).toBe(true);
  });
});
