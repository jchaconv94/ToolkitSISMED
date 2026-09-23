import { describe, it, expect } from "vitest";
import { consolidateStockRows, consolidatedAlmcod } from "./stockConsolidation";

/** Como llegan las filas de la hoja: todo en texto. */
const fila = (over: Record<string, any>) => ({
  ALMCOD: "06519F0101",
  DESC_ALM: "FARM - C.S. NUEVO LIMA",
  ID_Producto: "04695",
  CODIGO_SIG: "495700350055",
  Nombre: "METFORMINA CLORHIDRATO - 500 mg - TABLET -",
  Lote: "2091913",
  Fec_Vencim: "30/09/2026",
  TIPSUM: "CN",
  FFINAN: "DYT",
  Saldo: "0",
  Precio_Det: "0,5",
  Precio_Cab: "0,5",
  ...over,
});
const almcod = (row: any) => row.ALMCOD;

describe("consolidatedAlmcod", () => {
  it("rotula como el escritorio: F01 para una IPRESS, 01 para un almacén", () => {
    expect(consolidatedAlmcod("06519")).toBe("06519F01");
    expect(consolidatedAlmcod("030S05")).toBe("030S0501");
    expect(consolidatedAlmcod("")).toBe("");
  });
});

describe("consolidateStockRows", () => {
  it("da el mismo resultado que el ToolKit de escritorio con «Consolidar farmacias»", () => {
    // Es el ejemplo que se corrió con la lógica de `sismed_sync.py` (v2.1.9): 7 filas
    // detalladas dan 5 consolidadas, con estos saldos y precios.
    const detallado = [
      fila({ ALMCOD: "06519F0101", Saldo: "300" }),
      fila({ ALMCOD: "06519F0201", Saldo: "80" }), // puesto comunal, mismo lote
      fila({ ALMCOD: "06519F0201", Lote: "OTRO", Saldo: "20" }),
      fila({ ALMCOD: "06519F0101", FFINAN: "RO", Saldo: "50" }), // otra fuente de financiamiento
      fila({ ALMCOD: "06519F0301", ID_Producto: "02752", Lote: "E02236", Saldo: "17", Precio_Det: "0,9" }),
      fila({ ALMCOD: "06519F0101", ID_Producto: "02752", Lote: "E02236", Saldo: "3", Precio_Det: "0,7" }),
      fila({ ALMCOD: "030S0501", ID_Producto: "00200", Lote: "2092323", Saldo: "420" }),
    ];

    const resultado = consolidateStockRows(detallado, almcod).map((r) => [
      r.ALMCOD,
      r.ID_Producto,
      r.Lote,
      r.FFINAN,
      r.Saldo,
      r.Precio_Det,
    ]);

    expect(resultado).toEqual([
      ["06519F01", "04695", "2091913", "DYT", 380, 0.5],
      ["06519F01", "04695", "OTRO", "DYT", 20, 0.5],
      ["06519F01", "04695", "2091913", "RO", 50, 0.5],
      ["06519F01", "02752", "E02236", "DYT", 20, 0.9],
      ["030S0501", "00200", "2092323", "DYT", 420, 0.5],
    ]);
  });

  it("no mezcla vencimientos ni tipos de suministro distintos", () => {
    const resultado = consolidateStockRows(
      [
        fila({ Saldo: "10" }),
        fila({ ALMCOD: "06519F0201", Fec_Vencim: "31/12/2027", Saldo: "5" }),
        fila({ ALMCOD: "06519F0201", TIPSUM: "CI", Saldo: "7" }),
      ],
      almcod,
    );
    expect(resultado.map((r) => r.Saldo)).toEqual([10, 5, 7]);
  });

  it("conserva el total de stock", () => {
    const detallado = [
      fila({ Saldo: "1.250" }),
      fila({ ALMCOD: "06519F0201", Saldo: "30" }),
      fila({ ALMCOD: "06519F0301", Lote: "B", Saldo: "7" }),
    ];
    const total = (filas: any[]) => filas.reduce((s, r) => s + Number(r.Saldo), 0);
    expect(total(consolidateStockRows(detallado, almcod))).toBe(1287);
  });

  it("rotula la fila con el nombre dado, como hace el escritorio", () => {
    const [r] = consolidateStockRows([fila({ Saldo: "1" })], almcod, "C.S. Nuevo Lima");
    expect(r.DESC_ALM).toBe("C.S. Nuevo Lima (CONSOLIDADO)");
    // Sin nombre dado, usa el de la fila, sin duplicar la marca si ya venía consolidada.
    const [s] = consolidateStockRows([fila({ DESC_ALM: "C.S. X (CONSOLIDADO)", Saldo: "1" })], almcod);
    expect(s.DESC_ALM).toBe("C.S. X (CONSOLIDADO)");
  });

  it("conserva los demás datos de la primera fila del grupo", () => {
    const [r] = consolidateStockRows(
      [fila({ Saldo: "1" }), fila({ ALMCOD: "06519F0201", Saldo: "2" })],
      almcod,
    );
    expect(r).toMatchObject({ Nombre: "METFORMINA CLORHIDRATO - 500 mg - TABLET -", CODIGO_SIG: "495700350055" });
  });

  it("no se cae con listas vacías ni con huecos", () => {
    expect(consolidateStockRows(null, almcod)).toEqual([]);
    expect(consolidateStockRows([null, fila({ Saldo: "2" })], almcod)).toHaveLength(1);
  });
});
