import { describe, it, expect } from "vitest";
import {
  countPharmaciesInResults,
  normalizeStockText,
  parseStockAmount,
  searchNetworkStock,
  stockRowMatches,
} from "./stockNetworkSearch";

/** Como llegan las filas de la hoja de cálculo. */
const fila = (over: Record<string, any>) => ({
  ALMCOD: "06505F0101",
  ID_Producto: "11369",
  CODIGO_SIG: "495700350055",
  Nombre: "JERINGA DESCARTABLE 20 mL CON AGUJA 21 G",
  Lote: "L1",
  Fec_Vencim: "30/11/2029",
  Saldo: "10",
  DESC_TIPSUM: "SISMED-COMPRA NACIONAL",
  DESC_FFINAN: "Donaciones y Transferencias",
  Reg_Sanitario: "DM24463E",
  Precio_Det: "0,324",
  sourceId: "0_hoja",
  ...over,
});

describe("parseStockAmount", () => {
  it("lee los números como los escribe la hoja", () => {
    expect(parseStockAmount("32")).toBe(32);
    expect(parseStockAmount("1.250")).toBe(1250); // separador de miles
    expect(parseStockAmount("0,324")).toBeCloseTo(0.324); // coma decimal
    expect(parseStockAmount(7)).toBe(7);
  });

  it("un saldo ilegible es cero, no NaN", () => {
    // Con NaN el consolidado salía en cero sin que nada avisara.
    expect(parseStockAmount("sin dato")).toBe(0);
    expect(parseStockAmount("")).toBe(0);
    expect(parseStockAmount(null)).toBe(0);
    expect(parseStockAmount(undefined)).toBe(0);
  });
});

describe("normalizeStockText", () => {
  it("iguala tildes, mayúsculas y signos", () => {
    expect(normalizeStockText("Ácido acético 5%")).toBe("ACIDO ACETICO 5");
    expect(normalizeStockText("  ")).toBe("");
  });
});

describe("stockRowMatches", () => {
  it("encuentra por nombre, por código SISMED y por SIGA", () => {
    expect(stockRowMatches(fila({}), "jeringa")).toBe(true);
    expect(stockRowMatches(fila({}), "11369")).toBe(true);
    expect(stockRowMatches(fila({}), "495700350055")).toBe(true);
  });

  it("con varias palabras tienen que estar todas, en cualquier orden", () => {
    // Quien escribe «jeringa 20» no quiere todas las jeringas ni todo lo que lleve 20.
    expect(stockRowMatches(fila({}), "jeringa 20")).toBe(true);
    expect(stockRowMatches(fila({}), "20 jeringa")).toBe(true);
    expect(stockRowMatches(fila({}), "jeringa 999")).toBe(false);
  });

  it("un número suelto también busca dentro de los códigos", () => {
    // Es a propósito: se admite pegar un trozo de código. El efecto secundario es que un
    // número corto puede coincidir dentro del SIGA (`495700350055` contiene «50»), y es
    // preferible a no encontrar un código que se escribió a medias.
    expect(stockRowMatches(fila({}), "1136")).toBe(true);
    expect(stockRowMatches(fila({}), "3500")).toBe(true);
  });

  it("no busca con el término vacío", () => {
    expect(stockRowMatches(fila({}), "")).toBe(false);
    expect(stockRowMatches(fila({}), "   ")).toBe(false);
  });
});

describe("searchNetworkStock", () => {
  it("consolida los lotes de un mismo producto en un mismo código de farmacia", () => {
    const resultado = searchNetworkStock(
      [
        fila({ Lote: "A", Saldo: "10" }),
        fila({ Lote: "B", Saldo: "22" }),
      ],
      "jeringa",
    );

    expect(resultado).toHaveLength(1);
    expect(resultado[0].total).toBe(32);
    expect(resultado[0].lotes.map((l) => l.lote)).toEqual(["A", "B"]);
  });

  it("separa los puestos comunales de su IPRESS", () => {
    // `F01` es la farmacia de la IPRESS y `F02` un puesto comunal: su stock es suyo, y
    // juntarlos escondería de quién es cada saldo.
    const resultado = searchNetworkStock(
      [
        fila({ ALMCOD: "06505F0101", Saldo: "10" }),
        fila({ ALMCOD: "06505F0201", Saldo: "5" }),
      ],
      "jeringa",
    );

    expect(resultado).toHaveLength(2);
    expect(resultado.map((r) => r.almcod).sort()).toEqual(["06505F0101", "06505F0201"]);
    expect(countPharmaciesInResults(resultado)).toBe(2);
  });

  it("ordena las filas por saldo, de mayor a menor", () => {
    const resultado = searchNetworkStock(
      [
        fila({ ALMCOD: "06505F0101", Saldo: "3" }),
        fila({ ALMCOD: "06519F0101", Saldo: "80" }),
      ],
      "jeringa",
    );
    expect(resultado.map((r) => r.total)).toEqual([80, 3]);
  });

  it("ordena los lotes por vencimiento, no como texto", () => {
    // `31/12/2027` es posterior a `9/1/2028`, pero como cadena iría antes.
    const resultado = searchNetworkStock(
      [
        fila({ Lote: "TARDE", Fec_Vencim: "9/1/2028" }),
        fila({ Lote: "PRONTO", Fec_Vencim: "31/12/2027" }),
      ],
      "jeringa",
    );
    expect(resultado[0].lotes.map((l) => l.lote)).toEqual(["PRONTO", "TARDE"]);
  });

  it("un lote sin vencimiento va al final, no al principio", () => {
    const resultado = searchNetworkStock(
      [
        fila({ Lote: "SIN FECHA", Fec_Vencim: "" }),
        fila({ Lote: "CON FECHA", Fec_Vencim: "31/12/2027" }),
      ],
      "jeringa",
    );
    expect(resultado[0].lotes.map((l) => l.lote)).toEqual(["CON FECHA", "SIN FECHA"]);
  });

  it("conserva el detalle de cada lote", () => {
    const [primera] = searchNetworkStock([fila({})], "11369");
    expect(primera.lotes[0]).toMatchObject({
      lote: "L1",
      vencimiento: "30/11/2029",
      saldo: 10,
      tipoSuministro: "SISMED-COMPRA NACIONAL",
      registroSanitario: "DM24463E",
      sourceId: "0_hoja",
    });
    expect(primera.codigoSiga).toBe("495700350055");
  });

  it("no se cae con listas vacías ni con huecos", () => {
    expect(searchNetworkStock([], "jeringa")).toEqual([]);
    expect(searchNetworkStock(null, "jeringa")).toEqual([]);
    expect(searchNetworkStock([null as any, fila({})], "jeringa")).toHaveLength(1);
    expect(searchNetworkStock([fila({})], "")).toEqual([]);
    expect(countPharmaciesInResults(null)).toBe(0);
  });
});
