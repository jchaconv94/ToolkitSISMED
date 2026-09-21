import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  SheetsApiError,
  __resetSheetsApiCache,
  a1Range,
  batchGetRanges,
  describeSheetName,
  facilityCodeFromSheetName,
  fetchSheetsMetadataViaApi,
  findFacilityByCode,
  isFacilitySheet,
  listSheetTabs,
} from "./sheetsApiService";

const ID = "1vic6MeMiA5Jk4_UWx8nI462yXe8irgxAoMncJiekOOA";
const KEY = "AIza-clave-de-prueba";

type FakeResponse = { status: number; body: unknown };
const fakeFetch = (responses: Array<FakeResponse | Error>) => {
  const queue = [...responses];
  const mock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch llamado más veces de lo esperado");
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body),
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

const tabsBody = {
  sheets: [
    { properties: { sheetId: 121569872, title: "HOSP. BELLAVISTA-06502", index: 1, hidden: false } },
    { properties: { sheetId: 1621530450, title: "FARM - P.S. LIMON-06505", index: 0, hidden: false } },
  ],
};
const HEADERS = ["ALMCOD", "DESC_ALM", "ID_Producto", "Saldo", "FECHA DEL EQUIPO", "ULTIMA ACTUALIZACION"];

beforeEach(() => __resetSheetsApiCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a1Range / facilityCodeFromSheetName", () => {
  it("escapa comillas simples en el nombre de la pestaña", () => {
    expect(a1Range("FARM - P.S. LIMON-06505", "A1:AZ2")).toBe("'FARM - P.S. LIMON-06505'!A1:AZ2");
    expect(a1Range("P.S. D'ANGELO-06599", "A:A")).toBe("'P.S. D''ANGELO-06599'!A:A");
  });

  it("aplica las mismas reglas que getFacilityCode_ del backend", () => {
    expect(facilityCodeFromSheetName("FARM - P.S. SANTA ELENA-06523")).toBe("06523");
    expect(facilityCodeFromSheetName("ALM. ANEXO BELLAVISTA - SAN MARTIN-030S05")).toBe("030S05");
    expect(facilityCodeFromSheetName("SAL SISMED", "06502F01")).toBe("06502");
    expect(facilityCodeFromSheetName("HOJA", "")).toBe("");
  });
});

describe("describeSheetName", () => {
  it("quita el código del final y el prefijo FARM", () => {
    expect(describeSheetName("C.S. NUEVO LIMA-06519")).toBe("C.S. NUEVO LIMA");
    expect(describeSheetName("FARM - P.S. LIMON-06505")).toBe("P.S. LIMON");
    expect(describeSheetName("ALM. ANEXO BELLAVISTA - SAN MARTIN-030S05")).toBe(
      "ALM. ANEXO BELLAVISTA - SAN MARTIN",
    );
  });

  it("respeta los guiones propios del nombre oficial", () => {
    // Recortando por el último guion, como se hacía antes, este se quedaba a medias.
    expect(describeSheetName("P.S. NUEVO TARAPOTO - ANEXO")).toBe("P.S. NUEVO TARAPOTO - ANEXO");
    expect(describeSheetName("C.S. Nuevo Lima")).toBe("C.S. Nuevo Lima");
  });

  it("no deja el nombre vacío", () => {
    expect(describeSheetName("-06519")).toBe("-06519");
    expect(describeSheetName("")).toBe("");
    expect(describeSheetName(null)).toBe("");
  });
});

describe("findFacilityByCode", () => {
  const establecimientos = [
    { code: "06502", name: "Hospital Bellavista", ungetId: "u-b" },
    { code: "06519F01", name: "C.S. Nuevo Lima", ungetId: "u-b" },
    { code: "030S05", name: "Almacén Bellavista", ungetId: "u-b" },
  ];

  it("encuentra por coincidencia exacta", () => {
    expect(findFacilityByCode("06502", establecimientos)?.name).toBe("Hospital Bellavista");
    expect(findFacilityByCode("030S05", establecimientos)?.name).toBe("Almacén Bellavista");
  });

  it("admite que el registro lleve el sufijo interno y la pestaña no", () => {
    // La pestaña se llama `C.S. NUEVO LIMA-06519`, pero está registrado como `06519F01`.
    expect(findFacilityByCode("06519", establecimientos)?.name).toBe("C.S. Nuevo Lima");
  });

  it("no elige ninguno si dos se reducen al mismo código oficial", () => {
    // Mostrar el nombre equivocado es peor que no mostrar ninguno.
    // `06519F01` y `06519F0101` se reducen los dos a `06519`.
    const ambiguos = [
      { code: "06519F01", name: "Farmacia" },
      { code: "06519F0101", name: "Almacén" },
    ];
    expect(findFacilityByCode("06519", ambiguos)).toBeNull();
  });

  it("la coincidencia exacta gana a la del sufijo", () => {
    const mezcla = [{ code: "06519F01", name: "Con sufijo" }, { code: "06519", name: "Exacto" }];
    expect(findFacilityByCode("06519", mezcla)?.name).toBe("Exacto");
  });

  it("resuelve el almacén cuyo nombre de pestaña lleva dos guiones", () => {
    // `ALM. ANEXO BELLAVISTA - SAN MARTIN-030S05`: el primer guion es parte del nombre y
    // el último separa el código. La tarjeta mostraba el nombre crudo de la pestaña
    // porque ese camino no llegaba a consultar el registro.
    const pestana = "ALM. ANEXO BELLAVISTA - SAN MARTIN-030S05";
    const codigo = facilityCodeFromSheetName(pestana);
    expect(codigo).toBe("030S05");
    expect(findFacilityByCode(codigo, establecimientos)?.name).toBe("Almacén Bellavista");
  });

  it("no inventa emparejamientos", () => {
    expect(findFacilityByCode("99999", establecimientos)).toBeNull();
    expect(findFacilityByCode("", establecimientos)).toBeNull();
    expect(findFacilityByCode("06502", null)).toBeNull();
    expect(findFacilityByCode("06502", [null as any])).toBeNull();
  });
});

describe("isFacilitySheet", () => {
  it("descarta la pestaña suelta que Google crea sola", () => {
    // Caso real del 20/09/2026: el libro de San Martín tenía una `Sheet3` vacía y salía en
    // Consulta Stock como un establecimiento más, con «Sin datos» y «0 items».
    expect(isFacilitySheet({ name: "Sheet3", rowCount: 0 })).toBe(false);
    expect(isFacilitySheet({ name: "Hoja 1", rowCount: 0 })).toBe(false);
    expect(isFacilitySheet({ name: "copia de trabajo", rowCount: 0 })).toBe(false);
  });

  it("conserva un establecimiento por el código de su nombre, aunque esté sin stock", () => {
    expect(isFacilitySheet({ name: "HOSP. BELLAVISTA-06502", rowCount: 0 })).toBe(true);
    expect(isFacilitySheet({ name: "ALM. ANEXO BELLAVISTA - SAN MARTIN-030S05", rowCount: 0 })).toBe(true);
  });

  it("conserva una pestaña con ALMCOD aunque su nombre no lleve código", () => {
    expect(isFacilitySheet({ name: "SAL SISMED", almcod: "06502F01", rowCount: 0 })).toBe(true);
  });

  it("conserva una pestaña con filas aunque no tenga ni código ni ALMCOD", () => {
    expect(isFacilitySheet({ name: "SIN NOMBRE", rowCount: 40 })).toBe(true);
  });

  it("sin saber cuántas filas tiene, no se oculta", () => {
    // La lectura directa no siempre trae el conteo; ante la duda, se muestra.
    expect(isFacilitySheet({ name: "Sheet3" })).toBe(true);
    expect(isFacilitySheet({})).toBe(true);
  });
});

describe("listSheetTabs", () => {
  it("lista las pestañas ordenadas y reutiliza la respuesta", async () => {
    const mock = fakeFetch([{ status: 200, body: tabsBody }]);
    const tabs = await listSheetTabs(ID, { apiKey: KEY });
    expect(tabs.map((t) => `${t.gid}:${t.title}`)).toEqual([
      "1621530450:FARM - P.S. LIMON-06505",
      "121569872:HOSP. BELLAVISTA-06502",
    ]);
    await listSheetTabs(ID, { apiKey: KEY });
    expect(mock).toHaveBeenCalledTimes(1);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain(`/v4/spreadsheets/${ID}?`);
    expect(url).toContain("key=" + KEY);
    expect(url).toContain("fields=sheets.properties");
  });

  it("traduce 403 y 429 a errores accionables", async () => {
    fakeFetch([{ status: 403, body: { error: { message: "The caller does not have permission" } } }]);
    const forbidden = await listSheetTabs(ID, { apiKey: KEY }).catch((e) => e);
    expect(forbidden).toBeInstanceOf(SheetsApiError);
    expect(forbidden.status).toBe(403);
    expect(forbidden.message).toContain("compartida");

    __resetSheetsApiCache();
    fakeFetch([{ status: 429, body: { error: { message: "Quota exceeded" } } }]);
    const quota = await listSheetTabs(ID, { apiKey: KEY, force: true }).catch((e) => e);
    expect(quota.quotaExceeded).toBe(true);
  });

  it("no consulta sin clave", async () => {
    const mock = fakeFetch([]);
    await expect(listSheetTabs(ID, { apiKey: "" })).rejects.toBeInstanceOf(SheetsApiError);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("batchGetRanges", () => {
  it("pide varios rangos en una petición y devuelve [] para los vacíos", async () => {
    const mock = fakeFetch([
      { status: 200, body: { valueRanges: [{ values: [["a", "b"], ["1", 2]] }, {}] } },
    ]);
    const values = await batchGetRanges(ID, ["'A'!A1:B2", "'B'!A1:B2"], { apiKey: KEY });
    expect(values).toEqual([[["a", "b"], ["1", "2"]], []]);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("values:batchGet");
    expect(url).toContain("valueRenderOption=FORMATTED_VALUE");
    expect(url).toContain("dateTimeRenderOption=FORMATTED_STRING");
    expect((url.match(/ranges=/g) || []).length).toBe(2);
  });

  it("divide en varias peticiones cuando hay muchos rangos", async () => {
    const mock = fakeFetch([
      { status: 200, body: { valueRanges: Array.from({ length: 40 }, () => ({ values: [["x"]] })) } },
      { status: 200, body: { valueRanges: Array.from({ length: 5 }, () => ({ values: [["y"]] })) } },
    ]);
    const values = await batchGetRanges(ID, Array.from({ length: 45 }, (_, i) => `'T${i}'!A1`), { apiKey: KEY });
    expect(values).toHaveLength(45);
    expect(values[44]).toEqual([["y"]]);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchSheetsMetadataViaApi", () => {
  it("arma la metadata como getMetadata de Apps Script con dos peticiones", async () => {
    const mock = fakeFetch([
      { status: 200, body: tabsBody },
      {
        status: 200,
        body: {
          valueRanges: [
            // LIMON: encabezado + primera fila, luego columna A completa (sin conteo conocido)
            { values: [HEADERS, ["06505F0101", "FARM - P.S. LIMON", "32251", "1", "16/09/2026 11:06:40", "16/09/2026 11:06:47"]] },
            { values: [["ALMCOD"], ["06505F0101"], ["06505F0101"], ["06505F0101"], [""]] },
            // HOSP: solo encabezado (conteo ya conocido)
            { values: [HEADERS, ["06502F01", "HOSP", "00143", "478", "17/09/2026 11:11:40", "17/09/2026 11:11:44"]] },
          ],
        },
      },
    ]);

    const metadata = await fetchSheetsMetadataViaApi(ID, {
      apiKey: KEY,
      knownRowCounts: { "121569872": 997 },
    });

    expect(metadata).toEqual([
      {
        id: "1621530450",
        name: "FARM - P.S. LIMON-06505",
        lastUpdate: "16/09/2026 11:06:47",
        equipmentDate: "16/09/2026 11:06:40",
        almcod: "06505F0101",
        codigoIpress: "06505",
        rowCount: 3,
        spreadsheetId: ID,
      },
      {
        id: "121569872",
        name: "HOSP. BELLAVISTA-06502",
        lastUpdate: "17/09/2026 11:11:44",
        equipmentDate: "17/09/2026 11:11:40",
        almcod: "06502F01",
        codigoIpress: "06502",
        rowCount: 997,
        spreadsheetId: ID,
      },
    ]);
    expect(mock).toHaveBeenCalledTimes(2);
    // URLSearchParams codifica los espacios como "+".
    const batchUrl = decodeURIComponent(String(mock.mock.calls[1][0])).replace(/\+/g, " ");
    expect(batchUrl).toContain("'FARM - P.S. LIMON-06505'!A1:AZ2");
    expect(batchUrl).toContain("'FARM - P.S. LIMON-06505'!A:A");
    expect(batchUrl).not.toContain("'HOSP. BELLAVISTA-06502'!A:A");
  });

  it("una pestaña vacía queda con fechas vacías y 0 filas", async () => {
    fakeFetch([
      { status: 200, body: { sheets: [{ properties: { sheetId: 7, title: "NUEVA-06599", index: 0 } }] } },
      { status: 200, body: { valueRanges: [{}, {}] } },
    ]);
    const [meta] = await fetchSheetsMetadataViaApi(ID, { apiKey: KEY });
    expect(meta).toMatchObject({ id: "7", name: "NUEVA-06599", lastUpdate: "", equipmentDate: "", rowCount: 0, codigoIpress: "06599" });
  });

  it("si se agota la cuota al leer los valores, cae al CSV en vez de dejar la UNGET sin vía", async () => {
    // Una UNGET que configuró su hoja y retiró su Web App no tenía ningún otro camino:
    // la lectura directa necesita pestañas ya conocidas y en la primera carga no las hay.
    // Las pestañas sí se obtuvieron, así que las cabeceras se leen por CSV, que no consume
    // cuota.
    const mock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("values:batchGet")) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify({ error: { message: "Quota exceeded" } }),
        };
      }
      if (url.includes("/v4/spreadsheets/")) {
        return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify(tabsBody) };
      }
      const gid = new URL(url).searchParams.get("gid");
      const almcod = gid === "121569872" ? "06502F01" : "06505F01";
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/csv" },
        text: async () => `ALMCOD,ULTIMA ACTUALIZACION,FECHA DEL EQUIPO\n${almcod},18/09/2026 09:30:00,18/09/2026 09:29:00\n`,
      };
    });
    vi.stubGlobal("fetch", mock);

    const metadata = await fetchSheetsMetadataViaApi(ID, { apiKey: KEY });
    expect(metadata.map((m) => m.name)).toEqual([
      "FARM - P.S. LIMON-06505",
      "HOSP. BELLAVISTA-06502",
    ]);
    expect(metadata[1]).toMatchObject({
      id: "121569872",
      almcod: "06502F01",
      codigoIpress: "06502",
      lastUpdate: "18/09/2026 09:30:00",
      spreadsheetId: ID,
    });
    // A la API solo la lista de pestañas y el intento de valores que falló; las cabeceras
    // se leyeron por CSV, que no consume cuota.
    const aLaApi = mock.mock.calls.filter((c) => String(c[0]).includes("sheets.googleapis.com"));
    expect(aLaApi).toHaveLength(2);
    const porCsv = mock.mock.calls.filter((c) => String(c[0]).includes("docs.google.com"));
    expect(porCsv).toHaveLength(2);
  });

  it("si tampoco se pueden leer las cabeceras, el error sube para que quien llama pruebe otra vía", async () => {
    const mock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/v4/spreadsheets/") && !url.includes("values:batchGet")) {
        return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify(tabsBody) };
      }
      // 403 en el CSV: hoja no compartida. No se reintenta, así que la prueba no espera.
      return { ok: false, status: 403, headers: { get: () => "text/html" }, text: async () => "" };
    });
    vi.stubGlobal("fetch", mock);
    await expect(fetchSheetsMetadataViaApi(ID, { apiKey: KEY })).rejects.toThrow();
  });
});
