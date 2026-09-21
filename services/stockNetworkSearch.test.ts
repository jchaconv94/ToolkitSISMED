import { describe, it, expect } from "vitest";
import {
  buildProductIndex,
  countPharmaciesInResults,
  exactProductMatch,
  normalizeStockText,
  parseStockAmount,
  searchNetworkStock,
  searchNetworkStockByProduct,
  stockRowMatches,
  suggestProducts,
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

describe("buildProductIndex", () => {
  const filas = [
    fila({ ALMCOD: "06505F0101", Lote: "A", Saldo: "10" }),
    fila({ ALMCOD: "06505F0101", Lote: "B", Saldo: "5" }),
    fila({ ALMCOD: "06519F0101", Lote: "C", Saldo: "20" }),
    fila({ ID_Producto: "22222", Nombre: "PARACETAMOL 500 mg", Saldo: "7" }),
  ];

  it("deja un producto por código, con su alcance y su saldo", () => {
    const indice = buildProductIndex(filas);
    expect(indice).toHaveLength(2);

    const jeringa = indice.find((p) => p.codigoSismed === "11369")!;
    expect(jeringa.total).toBe(35);
    expect(jeringa.establecimientos).toBe(2);
  });

  it("un producto sin código SISMED se identifica por su nombre", () => {
    const [producto] = buildProductIndex([fila({ ID_Producto: "", Nombre: "AGUA ESTERIL" })]);
    expect(producto.key).toBe("AGUA ESTERIL");
  });

  it("no se cae con listas vacías ni con huecos", () => {
    expect(buildProductIndex(null)).toEqual([]);
    expect(buildProductIndex([null as any, fila({})])).toHaveLength(1);
    // Una fila sin producto ni código no identifica nada: no entra al catálogo.
    expect(buildProductIndex([fila({ ID_Producto: "", Nombre: "" })])).toEqual([]);
  });
});

describe("suggestProducts", () => {
  // Los SIGA se escriben aquí a mano: el de la fila de muestra contiene «500» y haría
  // coincidir al suero con «paracetamol 500» por su código, no por su nombre.
  const indice = buildProductIndex([
    fila({ ID_Producto: "1", CODIGO_SIG: "111", Nombre: "PARACETAMOL 500 mg TABLETA", Saldo: "10" }),
    fila({ ID_Producto: "2", CODIGO_SIG: "222", Nombre: "SUERO ORAL CON PARACETAMOL", Saldo: "99" }),
    fila({ ID_Producto: "3", CODIGO_SIG: "333", Nombre: "IBUPROFENO 400 mg", Saldo: "50" }),
  ]);

  it("ofrece lo que empieza por lo escrito antes que lo que solo lo contiene", () => {
    // Quien escribe «paracetamol» no quiere leer primero el suero, aunque tenga más saldo.
    expect(suggestProducts(indice, "paracetamol").map((p) => p.codigoSismed)).toEqual(["1", "2"]);
  });

  it("con varias palabras tienen que estar todas", () => {
    expect(suggestProducts(indice, "paracetamol 500").map((p) => p.codigoSismed)).toEqual(["1"]);
  });

  it("el código escrito entero manda sobre el nombre", () => {
    expect(suggestProducts(indice, "3")[0].codigoSismed).toBe("3");
  });

  it("sin término no se sugiere nada, y se respeta el límite", () => {
    expect(suggestProducts(indice, "")).toEqual([]);
    expect(suggestProducts(indice, "   ")).toEqual([]);
    expect(suggestProducts(null, "paracetamol")).toEqual([]);
    expect(suggestProducts(indice, "a", 1)).toHaveLength(1);
  });
});

describe("exactProductMatch", () => {
  const indice = buildProductIndex([
    fila({ ID_Producto: "11369", CODIGO_SIG: "495700350055" }),
    fila({ ID_Producto: "113690", CODIGO_SIG: "495700350056", Nombre: "OTRA JERINGA" }),
  ]);

  it("reconoce el código SISMED y el SIGA escritos enteros", () => {
    expect(exactProductMatch(indice, "11369")?.codigoSismed).toBe("11369");
    expect(exactProductMatch(indice, "495700350055")?.codigoSismed).toBe("11369");
  });

  it("un código a medias no elige nada: para eso está la lista", () => {
    // `1136` es prefijo de dos productos; adivinar mostraría el stock de otro producto.
    expect(exactProductMatch(indice, "1136")).toBeNull();
    expect(exactProductMatch(indice, "")).toBeNull();
    expect(exactProductMatch(null, "11369")).toBeNull();
  });

  it("el nombre del producto no cuenta como código completo", () => {
    expect(exactProductMatch(indice, "OTRA JERINGA")).toBeNull();
  });
});

describe("searchNetworkStockByProduct", () => {
  const filas = [
    fila({ ALMCOD: "06505F0101", Saldo: "10" }),
    fila({ ALMCOD: "06519F0101", Saldo: "20" }),
    fila({ ID_Producto: "22222", Nombre: "PARACETAMOL", ALMCOD: "06505F0101", Saldo: "99" }),
  ];

  it("trae solo el producto elegido, consolidado por farmacia", () => {
    const resultado = searchNetworkStockByProduct(filas, "11369");
    expect(resultado.map((r) => r.almcod)).toEqual(["06519F0101", "06505F0101"]);
    expect(resultado.map((r) => r.total)).toEqual([20, 10]);
  });

  it("un código que contiene al elegido no se cuela", () => {
    // El texto libre sí busca dentro de los códigos; elegir un producto es exacto.
    expect(searchNetworkStockByProduct(filas, "1136")).toEqual([]);
  });

  it("sin producto no devuelve nada", () => {
    expect(searchNetworkStockByProduct(filas, "")).toEqual([]);
    expect(searchNetworkStockByProduct(null, "11369")).toEqual([]);
  });
});
