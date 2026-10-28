import { describe, expect, it } from "vitest";
import { DbfError, dbfRecords, openDbf } from "./dbfFile";
import { buildDbf } from "./dbfTestUtils";

const table = () =>
  openDbf(
    buildDbf(
      [["CODIGO", "C", 7], ["NOMBRE", "C", 30], ["CANTIDAD", "N", 12, 2], ["FECHA", "D", 8], ["ACTIVO", "L", 1]],
      [
        { CODIGO: "16826", NOMBRE: "PAÑAL DESCARTABLE", CANTIDAD: 840, FECHA: "2026-09-01", ACTIVO: "T" },
        { CODIGO: "00143", NOMBRE: "BORRADO", CANTIDAD: 1, FECHA: "2026-09-02", ACTIVO: "F" },
        { CODIGO: "06570", NOMBRE: "ZIDOVUDINA", CANTIDAD: 2.5, FECHA: "", ACTIVO: "" },
      ],
      { deleted: [1] },
    ),
  );

describe("openDbf", () => {
  it("lee la cabecera y los campos", () => {
    const t = table();
    expect(t.recordCount).toBe(3);
    expect(t.fields.map((f) => `${f.name}:${f.type}${f.length}`)).toEqual(["CODIGO:C7", "NOMBRE:C30", "CANTIDAD:N12", "FECHA:D8", "ACTIVO:L1"]);
    expect(t.fields[1].offset).toBe(8);
  });

  it("rechaza lo que no es una tabla DBF", () => {
    expect(() => openDbf(new Uint8Array(10))).toThrow(DbfError);
    expect(() => openDbf(new TextEncoder().encode("PK".padEnd(64, "x")))).toThrow(DbfError);
  });

  it("no pasa del final de un archivo cortado", () => {
    const bytes = buildDbf([["A", "C", 5]], [{ A: "uno" }, { A: "dos" }]);
    expect(openDbf(bytes.subarray(0, bytes.length - 4)).recordCount).toBe(1);
  });
});

describe("dbfRecords", () => {
  it("salta los borrados y convierte texto (con tildes y eñes), números, fechas y lógicos", () => {
    const rows = [...dbfRecords(table(), ["CODIGO", "NOMBRE", "CANTIDAD", "FECHA", "ACTIVO"] as const)];
    expect(rows).toEqual([
      { CODIGO: "16826", NOMBRE: "PAÑAL DESCARTABLE", CANTIDAD: 840, FECHA: "2026-09-01", ACTIVO: true },
      { CODIGO: "06570", NOMBRE: "ZIDOVUDINA", CANTIDAD: 2.5, FECHA: null, ACTIVO: null },
    ]);
  });

  it("filtra antes de decodificar, por cualquier campo", () => {
    const rows = [...dbfRecords(table(), ["CODIGO"] as const, (text) => text("NOMBRE").startsWith("ZID"))];
    expect(rows).toEqual([{ CODIGO: "06570" }]);
  });

  it("avisa si falta un campo", () => {
    expect(() => [...dbfRecords(table(), ["NO_EXISTE"] as const)]).toThrow(DbfError);
  });
});
