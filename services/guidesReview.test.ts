import { describe, expect, it } from "vitest";
import { openDbf } from "./dbfFile";
import { buildDbf } from "./dbfTestUtils";
import { noGuidesMessage } from "./guidesReviewLoad";
import { looksLikeWarehouse, movementSummary, productCounts, readIci, readPlaces, readProducts, readWarehouse, reviewGuides, reviewMonths } from "./guidesReview";

// Mismo formato que el SISMED del almacén (030S05) y el TFORMDET del ICI: solo los campos que se leen.
type Head = { tipo?: string; num: string; org?: string; dst: string; guia: string; cct?: string; fecha: string; situa?: string };
const tmovim = (rows: Head[]) =>
  openDbf(buildDbf(
    [["MOVCODITIP", "C", 1], ["MOVNUMERO", "C", 9], ["ALMCODIORG", "C", 12], ["ALMCODIDST", "C", 12], ["MOVNUMEDCO", "C", 15], ["CCTCODIGO", "C", 2], ["MOVFECHREG", "D", 8], ["MOVSITUA", "C", 1]],
    rows.map((r) => ({ MOVCODITIP: r.tipo ?? "S", MOVNUMERO: r.num, ALMCODIORG: r.org ?? "030S05", ALMCODIDST: r.dst, MOVNUMEDCO: r.guia, CCTCODIGO: r.cct ?? "04", MOVFECHREG: r.fecha, MOVSITUA: r.situa ?? "1" })),
  ));
type Det = { tipo?: string; num: string; med: string; lote: string; cant: number };
const tmovimdet = (rows: Det[]) =>
  openDbf(buildDbf(
    [["MOVCODITIP", "C", 1], ["MOVNUMERO", "C", 9], ["MEDCOD", "C", 7], ["MEDLOTE", "C", 20], ["MOVCANTID", "N", 12, 2]],
    rows.map((r) => ({ MOVCODITIP: r.tipo ?? "S", MOVNUMERO: r.num, MEDCOD: r.med, MEDLOTE: r.lote, MOVCANTID: r.cant })),
  ));
type Ici = { pre: string; mes?: string; med: string; lote: string; ingre?: number; reingre?: number };
const tformdet = (rows: Ici[]) =>
  openDbf(buildDbf(
    [["CODIGO_PRE", "C", 12], ["ANNOMES", "C", 6], ["CODIGO_MED", "C", 7], ["MEDLOTE", "C", 20], ["INGRE", "N", 12], ["REINGRE", "N", 8]],
    rows.map((r) => ({ CODIGO_PRE: r.pre, ANNOMES: r.mes ?? "202609", CODIGO_MED: r.med, MEDLOTE: r.lote, INGRE: r.ingre ?? 0, REINGRE: r.reingre ?? 0 })),
  ));

const warehouse = readWarehouse(
  tmovim([
    { num: "260000100", dst: "06516", guia: "0000282", fecha: "2026-02-23" },
    { num: "260001552", dst: "06516", guia: "0001552", fecha: "2026-09-14" },
    { num: "260001554", dst: "06516", guia: "0001554", fecha: "2026-09-14" },
    { num: "260001560", dst: "06519", guia: "0001560", fecha: "2026-09-15" },
    { num: "260001561", dst: "06520", guia: "0001561", fecha: "2026-09-15" },
    { num: "260001570", dst: "030A04", guia: "0000079", cct: "36", fecha: "2026-09-02" },
    { num: "260001571", dst: "06516", guia: "0001571", fecha: "2026-09-20", situa: "0" },
    { num: "260001572", dst: "06516", guia: "0001572", fecha: "2026-10-16" },
    { tipo: "E", num: "260001573", org: "030A04", dst: "030S05", guia: "030A040007245", fecha: "2026-09-08" },
  ]),
  tmovimdet([
    { num: "260000100", med: "01958", lote: "01250104", cant: 50 },
    { num: "260001552", med: "19421", lote: "2408029", cant: 20 },
    { num: "260001552", med: "02891", lote: "2097865", cant: 150 },
    { num: "260001552", med: "04034", lote: "250213", cant: 300 },
    { num: "260001554", med: "04034", lote: "250213", cant: 0 },
    { num: "260001554", med: "08153", lote: "7907909", cant: 30 },
    { num: "260001554", med: "03519", lote: "2090825", cant: 50 },
    { num: "260001560", med: "00143", lote: "2050795", cant: 100 },
    { num: "260001561", med: "00269", lote: "20300846", cant: 160 },
    { num: "260001570", med: "00910", lote: "141231001", cant: 91 },
    { num: "260001571", med: "19421", lote: "2408029", cant: 999 },
    { num: "260001572", med: "19421", lote: "2408029", cant: 20 },
    { tipo: "E", num: "260001573", med: "00091", lote: "837240707", cant: 13640 },
  ]),
);

const ici = readIci(
  tformdet([
    { pre: "06516", med: "19421", lote: "2408029", ingre: 20 },
    { pre: "06516", med: "02891", lote: "2097865", ingre: 160, reingre: 2 },
    { pre: "06516", med: "04034", lote: "250213", ingre: 280 },
    { pre: "06516", med: "08153", lote: "7907909", ingre: 30 },
    { pre: "06516", med: "01958", lote: "01250104", ingre: 1 },
    { pre: "06516", med: "00200", lote: "2025296", ingre: 0 },
    { pre: "06519F01", med: "00143", lote: "2050795", ingre: 100 },
    { pre: "06519F02", med: "00143", lote: "2050795", reingre: 40 },
    { pre: "06516", mes: "202608", med: "04034", lote: "250213", ingre: 200 },
  ]),
);

const sites = reviewGuides(warehouse, ici, "202609");
const site = (code: string) => sites.find((s) => s.destination === code)!;
const row = (code: string, product: string) => site(code).rows.find((r) => r.product === product)!;

describe("readWarehouse", () => {
  it("toma solo las salidas vigentes del almacén, con su mes y su guía", () => {
    expect(warehouse.code).toBe("030S05");
    expect(warehouse.months).toEqual(["202610", "202609", "202602"]);
    expect(warehouse.lines.find((l) => l.product === "02891")).toEqual({
      date: "2026-09-14", month: "202609", guide: "0001552", destination: "06516", concept: "04", product: "02891", lot: "2097865", quantity: 150,
    });
    expect(warehouse.lines.some((l) => l.quantity === 999)).toBe(false); // guía anulada
    expect(warehouse.lines.some((l) => l.product === "00091")).toBe(false); // ingreso, no salida
  });
});

describe("readIci", () => {
  it("guarda ingreso + reingreso por mes, código, producto y lote, y qué códigos tienen ICI", () => {
    expect(ici.months).toEqual(["202609", "202608"]);
    expect(ici.received.get("202609")!.get("06516")!.get("02891|2097865")).toBe(162);
    expect(ici.codes.get("202609")!.has("06519F02")).toBe(true);
    expect(ici.received.get("202609")!.get("06516")!.has("00200|2025296")).toBe(false);
  });
});

describe("reviewGuides", () => {
  it("compara por producto y lote", () => {
    expect(row("06516", "19421")).toMatchObject({ sent: 20, received: 20, state: "complete", guides: ["0001552"] });
    expect(row("06516", "02891")).toMatchObject({ sent: 150, received: 162, state: "extra" });
    expect(row("06516", "04034")).toMatchObject({ sent: 300, received: 280, state: "short", guides: ["0001552", "0001554"] });
    expect(row("06516", "03519")).toMatchObject({ sent: 50, received: 0, state: "notReceived" });
  });

  it("«No se dio salida» dice la última guía de un mes anterior con ese producto y lote", () => {
    expect(row("06516", "01958")).toMatchObject({ sent: 0, received: 1, state: "notSent", guides: [], previous: { date: "2026-02-23", guide: "0000282" } });
  });

  it("cuenta las guías del mes y los estados del establecimiento", () => {
    expect(site("06516").guides).toEqual(["0001552", "0001554"]);
    expect(site("06516").counts).toEqual({ short: 1, notReceived: 1, extra: 1, notSent: 1, complete: 2 });
    expect(site("06516").differences).toBe(4);
  });

  it("un establecimiento con farmacias se compara con su F01, no con las demás", () => {
    expect(site("06519").iciCode).toBe("06519F01");
    expect(row("06519", "00143")).toMatchObject({ sent: 100, received: 100, state: "complete" });
  });

  it("sin ICI del mes se avisa con iciCode null", () => {
    expect(site("06520").iciCode).toBeNull();
    expect(row("06520", "00269").state).toBe("notReceived");
  });

  it("no revisa las salidas a otro almacén", () => {
    expect(sites.map((s) => s.destination).sort()).toEqual(["06516", "06519", "06520"]);
    expect(looksLikeWarehouse("030A04")).toBe(true);
    expect(looksLikeWarehouse("030S05")).toBe(true);
    expect(looksLikeWarehouse("06519F01")).toBe(false);
  });

  it("cada mes por separado", () => {
    const october = reviewGuides(warehouse, ici, "202610");
    expect(october.map((s) => s.destination)).toEqual(["06516"]);
    expect(october[0].iciCode).toBeNull();
  });
});

describe("reviewMonths", () => {
  it("solo los meses que están en los dos SISMED", () => {
    expect(reviewMonths(warehouse, ici)).toEqual(["202609"]);
  });
});

describe("productCounts", () => {
  it("cuenta por producto como la hoja CONTROL del Excel: suma los lotes", () => {
    const w = readWarehouse(
      tmovim([{ num: "1", dst: "06516", guia: "0001", fecha: "2026-09-14" }]),
      tmovimdet([{ num: "1", med: "19421", lote: "A", cant: 20 }]),
    );
    const i = readIci(tformdet([{ pre: "06516", med: "19421", lote: "A", ingre: 20 }, { pre: "06516", med: "19421", lote: "B", ingre: 1 }]));
    const [s] = reviewGuides(w, i, "202609");
    expect(s.counts).toMatchObject({ complete: 1, notSent: 1 });
    expect(productCounts(s)).toMatchObject({ extra: 1, complete: 0, notSent: 0 });
  });
});

describe("catálogos", () => {
  it("nombre del producto como en el ICI y nombre y tipo de cada almacén", () => {
    const products = readProducts(openDbf(buildDbf(
      [["MEDCOD", "C", 7], ["MEDNOM", "C", 100], ["MEDCNC", "C", 60], ["MEDFF", "C", 6], ["MEDPRES", "C", 78]],
      [{ MEDCOD: "00143", MEDNOM: "ACICLOVIR", MEDCNC: "200 mg", MEDFF: "TABLET", MEDPRES: "" }],
    )));
    expect(products.get("00143")).toBe("ACICLOVIR - 200 mg - TABLET");
    const places = readPlaces(openDbf(buildDbf(
      [["ALMCOD", "C", 12], ["ALMDES", "C", 40], ["ALMTIPO", "C", 1]],
      [{ ALMCOD: "06516", ALMDES: "P.S. LA LIBERTAD", ALMTIPO: "P" }],
    )));
    expect(places.get("06516")).toEqual({ name: "P.S. LA LIBERTAD", type: "P" });
  });

  it("explica por qué una carpeta no da guías de salida", () => {
    const ici = movementSummary(tmovim([
      { tipo: "E", num: "1", org: "030S05", dst: "06516", guia: "A", fecha: "2026-03-02" },
      { tipo: "E", num: "2", org: "030S05", dst: "06516", guia: "B", fecha: "2026-09-30" },
      { num: "3", dst: "06516", guia: "C", fecha: "2026-05-01", situa: "0" },
    ]));
    expect(ici).toEqual({ total: 3, entries: 2, exits: 1, activeExits: 0, first: "2026-03-02", last: "2026-09-30" });
    expect(noGuidesMessage(ici)).toBe("Esta carpeta no es la del SISMED del almacén: su TMOVIM.DBF tiene 2 entradas y ninguna salida vigente (movimientos del 02/03/2026 al 30/09/2026). Elija la carpeta DATOS del SISMED desde donde el almacén emite las guías a los establecimientos.");
    expect(noGuidesMessage(movementSummary(tmovim([])))).toContain("está vacío");
    expect(noGuidesMessage({ ...ici, activeExits: 5 })).toContain("no tienen su detalle en TMOVIMDET.DBF");
  });
});
