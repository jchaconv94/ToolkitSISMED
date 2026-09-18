import { describe, it, expect } from "vitest";
import {
  buildWebAppStockUrl,
  findAssignedSheetRows,
  findConnectionForAssignment,
  webAppUrlForAssignment,
} from "./assignedSheetReader";

const conexiones = [
  { ungetId: "u-b", url: "sheets://LIBRO_BELLAVISTA", spreadsheetId: "LIBRO_BELLAVISTA" },
  { ungetId: "u-h", url: "https://script.google.com/huallaga" },
];

describe("findConnectionForAssignment", () => {
  it("encuentra la conexión vigente por la UNGET, aunque la URL guardada sea otra", () => {
    const asignacion = { sheetName: "FARM - P.S. LIMON-06505", ungetId: "u-b", sheetUrl: "https://script.google.com/viejo" };
    expect(findConnectionForAssignment(asignacion, conexiones)?.ungetId).toBe("u-b");
  });

  it("mientras la asignación no tenga UNGET, se apoya en la URL", () => {
    const asignacion = { sheetName: "X", sheetUrl: "https://script.google.com/huallaga" };
    expect(findConnectionForAssignment(asignacion, conexiones)?.ungetId).toBe("u-h");
  });

  it("devuelve null si esa UNGET ya no tiene conexión", () => {
    expect(findConnectionForAssignment({ sheetName: "X", ungetId: "u-z" }, conexiones)).toBeNull();
    expect(findConnectionForAssignment({ sheetName: "X" }, [])).toBeNull();
  });
});

describe("webAppUrlForAssignment", () => {
  it("usa la URL vigente de la conexión, no la que quedó guardada", () => {
    const asignacion = { sheetName: "X", ungetId: "u-h", sheetUrl: "https://script.google.com/despliegue-viejo" };
    expect(webAppUrlForAssignment(asignacion, conexiones[1])).toBe("https://script.google.com/huallaga");
  });

  it("una conexión sin Web App no devuelve una URL inservible", () => {
    // `sheets://` no es una dirección que se pueda pedir: antes se intentaba igual y fallaba.
    expect(webAppUrlForAssignment({ sheetName: "X", ungetId: "u-b" }, conexiones[0])).toBe("");
  });

  it("si la conexión ya no tiene Web App pero la asignación guardaba una, se usa esa", () => {
    const asignacion = { sheetName: "X", ungetId: "u-b", sheetUrl: "https://script.google.com/antiguo" };
    expect(webAppUrlForAssignment(asignacion, conexiones[0])).toBe("https://script.google.com/antiguo");
  });
});

describe("buildWebAppStockUrl", () => {
  it("pide una sola pestaña", () => {
    const url = buildWebAppStockUrl("https://script.google.com/macros/s/abc/exec", "FARM - P.S. LIMON-06505");
    expect(url).toContain("action=getStock");
    // URLSearchParams codifica los espacios como "+".
    expect(decodeURIComponent(url).replace(/\+/g, " ")).toContain("sheet=FARM - P.S. LIMON-06505");
    expect(url).not.toContain("sheets=");
  });
});

describe("findAssignedSheetRows", () => {
  const filas = [{ ID_Producto: "00143", Saldo: "10" }];

  it("encuentra la pestaña por nombre dentro de la respuesta", () => {
    expect(findAssignedSheetRows({ sheets: [{ name: "OTRA", data: [] }, { name: "MI HOJA", data: filas }] }, "MI HOJA")).toEqual(filas);
    expect(findAssignedSheetRows([{ name: "mi hoja", data: filas }], "MI HOJA")).toEqual(filas);
  });

  it("admite respuestas que ya son las filas", () => {
    expect(findAssignedSheetRows(filas, "MI HOJA")).toEqual(filas);
    expect(findAssignedSheetRows({ data: filas }, "MI HOJA")).toEqual(filas);
  });

  it("devuelve vacío cuando no hay nada utilizable", () => {
    expect(findAssignedSheetRows(null, "MI HOJA")).toEqual([]);
    expect(findAssignedSheetRows({ sheets: [{ name: "OTRA", data: filas }] }, "MI HOJA")).toEqual([]);
  });
});
