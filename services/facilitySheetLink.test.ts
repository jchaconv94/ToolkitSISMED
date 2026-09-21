import { describe, it, expect } from "vitest";
import {
  isLinkedToSheet,
  linkedSheetName,
  resolveFacilitySheet,
  rowsBelongingToFacility,
  sheetOwnerCode,
} from "./facilitySheetLink";
import type { UngetSheet } from "./ungetSheetCatalog";

const hoja = (name: string, extra: Partial<UngetSheet> = {}): UngetSheet => ({
  id: name,
  name,
  ...extra,
});

/** Como llegan de `listUngetSheets`: el código lo pone `facilityCodeFromSheetName`. */
const CUZCO = hoja("C.S. CUZCO-06519", { codigoIpress: "06519", almcod: "06519F0101" });
const LIMA = hoja("C.S. NUEVO LIMA-06528", { codigoIpress: "06528", almcod: "06528F0101" });

describe("sheetOwnerCode", () => {
  it("toma el código del nombre de la pestaña", () => {
    expect(sheetOwnerCode(CUZCO)).toBe("06519");
  });

  it("recurre al ALMCOD cuando el nombre trae el código cortado", () => {
    // Caso real de Tocache: la pestaña se llama `ALM SISMED-030S0`, cinco caracteres donde
    // el almacén tiene seis. Sola no se reconoce; su ALMCOD sí lo dice entero.
    const almacen = hoja("ALM SISMED-030S0", { codigoIpress: "030S0", almcod: "030S0501" });
    expect(sheetOwnerCode(almacen)).toBe("030S05");
  });

  it("lee el código del nombre aunque la metadata no lo traiga", () => {
    // Las Web App que una UNGET no ha vuelto a desplegar no envían `codigoIpress`. Si el
    // vínculo dependiera de ese campo, esas UNGET se quedarían sin emparejar nada.
    expect(sheetOwnerCode(hoja("C.S. CUZCO-06519"))).toBe("06519");
  });

  it("una pestaña sin código ni ALMCOD no reclama ninguno", () => {
    expect(sheetOwnerCode(hoja("Sheet3"))).toBe("");
  });

  it("el ALMCOD de un puesto comunal sigue señalando a la hoja de su IPRESS", () => {
    // Si la primera fila de la hoja resulta ser de un puesto comunal, la pestaña sigue
    // siendo la de la IPRESS.
    expect(sheetOwnerCode(hoja("C.S. NUEVO LIMA", { almcod: "06528F0201" }))).toBe("06528");
  });
});

describe("resolveFacilitySheet", () => {
  it("empareja una IPRESS con la pestaña de su código", () => {
    const link = resolveFacilitySheet("06519", [CUZCO, LIMA]);
    expect(link.status).toBe("vinculada");
    expect(linkedSheetName(link)).toBe("C.S. CUZCO-06519");
    expect(isLinkedToSheet(link)).toBe(true);
  });

  it("no empareja un establecimiento con la hoja de otro", () => {
    // Es el fallo que originó todo esto: el P.C. Los Olivos quedó colgado de la hoja del
    // C.S. Cuzco, las dos de la misma UNGET, y el sistema lo dio por bueno.
    const link = resolveFacilitySheet("06528F02", [CUZCO]);
    expect(link.status).toBe("sin-hoja");
    expect(link.sheet).toBeNull();
    expect(isLinkedToSheet(link)).toBe(false);
  });

  it("lleva un puesto comunal a la hoja de su IPRESS, que es donde vive su stock", () => {
    const link = resolveFacilitySheet("06528F02", [CUZCO, LIMA]);
    expect(link.status).toBe("dentro-de-su-ipress");
    expect(linkedSheetName(link)).toBe("C.S. NUEVO LIMA-06528");
    expect(isLinkedToSheet(link)).toBe(true);
  });

  it("empareja un almacén por el ALMCOD cuando su nombre no basta", () => {
    const almacen = hoja("ALM SISMED-030S0", { codigoIpress: "030S0", almcod: "030S0501" });
    expect(resolveFacilitySheet("030S05", [almacen, CUZCO]).status).toBe("vinculada");
  });

  it("avisa en vez de elegir cuando dos pestañas dicen ser la misma", () => {
    const copia = hoja("C.S. CUZCO-06519 (copia)", { codigoIpress: "06519" });
    const link = resolveFacilitySheet("06519", [CUZCO, copia]);
    expect(link.status).toBe("ambigua");
    expect(link.sheet).toBeNull();
    expect(link.candidates).toHaveLength(2);
  });

  it("no inventa un vínculo cuando el código registrado no se entiende", () => {
    // `030S0`: el código de almacén cortado a cinco caracteres. Ni IPRESS ni almacén.
    expect(resolveFacilitySheet("030S0", [CUZCO]).status).toBe("codigo-no-reconocido");
    expect(resolveFacilitySheet("", [CUZCO]).status).toBe("codigo-no-reconocido");
  });

  it("sin pestañas no hay vínculo, pero sí se sabe qué código buscaba", () => {
    const link = resolveFacilitySheet("06519", []);
    expect(link.status).toBe("sin-hoja");
    expect(link.ownerCode).toBe("06519");
  });

  it("el `F01` que todavía queda en algunos registros lleva a la misma hoja", () => {
    expect(resolveFacilitySheet("06519F01", [CUZCO]).status).toBe("vinculada");
  });
});

describe("rowsBelongingToFacility", () => {
  const filas = [
    { ALMCOD: "06528F0101", Nombre: "de la IPRESS" },
    { ALMCOD: "06528F0201", Nombre: "del puesto comunal F02" },
    { ALMCOD: "06528F0301", Nombre: "del puesto comunal F03" },
    { ALMCOD: "", Nombre: "sin código" },
  ];
  const almcod = (row: { ALMCOD: string }) => row.ALMCOD;

  it("la IPRESS ve su hoja entera, sus puestos comunales incluidos", () => {
    // Son suyos: quien dirige la IPRESS tiene que ver el stock de todas sus farmacias.
    expect(rowsBelongingToFacility(filas, "06528", almcod)).toHaveLength(4);
  });

  it("un puesto comunal solo ve lo suyo", () => {
    const propias = rowsBelongingToFacility(filas, "06528F02", almcod);
    expect(propias.map((f) => f.Nombre)).toEqual(["del puesto comunal F02"]);
  });

  it("el envío consolidado llega sin ALMCOD y es de la IPRESS", () => {
    // Con «Consolidar farmacias» marcado no hay nada que repartir: descartar esas filas
    // dejaría a la IPRESS sin stock.
    const consolidado = [{ ALMCOD: "", Nombre: "todo junto" }];
    expect(rowsBelongingToFacility(consolidado, "06528", almcod)).toHaveLength(1);
    expect(rowsBelongingToFacility(consolidado, "06528F02", almcod)).toHaveLength(0);
  });

  it("un código que no se entiende no recorta nada", () => {
    expect(rowsBelongingToFacility(filas, "030S0", almcod)).toHaveLength(4);
  });
});
