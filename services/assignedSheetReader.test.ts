import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildWebAppStockUrl,
  findAssignedSheetRows,
  findConnectionForAssignment,
  readAssignedSheetRows,
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

describe("readAssignedSheetRows", () => {
  const asignacion = { sheetName: "FARM - P.S. LIMON-06505", ungetId: "u-b" };
  /** Conexión que ya no tiene Web App: solo hoja, como queda al configurar el enlace. */
  const soloHoja = { ungetId: "u-b", url: "sheets://LIBRO", spreadsheetId: "LIBRO_BELLAVISTA_1234567890" };

  /** Respuesta enrutada por URL: la API rechaza, y el CSV devuelve lo que pida la prueba. */
  const stubFetch = (csv: { status?: number; contentType?: string; body: string }) => {
    const mock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("sheets.googleapis.com")) {
        return { ok: false, status: 403, headers: { get: () => "application/json" }, text: async () => "{}" };
      }
      if (url.includes("gviz/tq")) {
        const status = csv.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: () => csv.contentType ?? "text/csv" },
          text: async () => csv.body,
        };
      }
      throw new Error(`URL inesperada en la prueba: ${url}`);
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("una pestaña con encabezados y sin filas devuelve cero filas, no un error de conexión", async () => {
    // El establecimiento existe y su hoja se lee; simplemente no tiene stock. Antes esto
    // caía al Web App y, al no haberlo, informaba "la UNGET no tiene conexión utilizable".
    stubFetch({ body: "ID_Producto,Nombre,Saldo\n" });
    await expect(readAssignedSheetRows(asignacion, soloHoja)).resolves.toEqual([]);
  });

  it("lee las filas cuando la pestaña tiene stock", async () => {
    stubFetch({ body: "ID_Producto,Saldo\n00143,10\n" });
    await expect(readAssignedSheetRows(asignacion, soloHoja)).resolves.toEqual([
      { ID_Producto: "00143", Saldo: "10" },
    ]);
  });

  it("una página HTML con 200 no se cuela como si fuera stock", async () => {
    // Hoja privada o pestaña inexistente: Google responde HTML. Cada línea se parseaba como
    // una fila de CSV, así que el aviso de permisos acababa en la tabla de existencias.
    stubFetch({
      contentType: "text/html",
      body: "<html>\n<body>Necesita permiso para acceder</body>\n</html>\n",
    });
    await expect(readAssignedSheetRows(asignacion, soloHoja)).rejects.toThrow(/no tiene una conexión utilizable/);
  });

  it("si la hoja no se deja leer, todavía se intenta la Web App", async () => {
    const conWebApp = { ...soloHoja, url: "https://script.google.com/macros/s/abc/exec" };
    const mock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("sheets.googleapis.com")) {
        return { ok: false, status: 403, headers: { get: (): string => "application/json" }, text: async () => "{}" };
      }
      if (url.includes("gviz/tq")) {
        return { ok: false, status: 404, headers: { get: (): string => "text/html" }, text: async () => "" };
      }
      return { ok: true, status: 200, headers: { get: (): string => "application/json" }, json: async () => [{ ID_Producto: "00200", Saldo: "5" }] };
    });
    vi.stubGlobal("fetch", mock);
    await expect(readAssignedSheetRows(asignacion, conWebApp)).resolves.toEqual([
      { ID_Producto: "00200", Saldo: "5" },
    ]);
  });
});
