import { describe, it, expect } from "vitest";
import {
  describePharmacyCode,
  isLinkedToSheet,
  linkedSheetName,
  pharmaciesInRows,
  resolveFacilitySheet,
  rowMatchesPharmacy,
  rowsBelongingToFacility,
  sheetOwnerCode,
  showsPharmacyColumn,
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

describe("describePharmacyCode", () => {
  const registro = [
    { code: "06528", name: "C.S. NUEVO LIMA" },
    { code: "06528F02", name: "P.C. LOS OLIVOS" },
    { code: "030S05", name: "ALMACÉN SISMED" },
  ];

  it("rotula la farmacia principal con la IPRESS", () => {
    expect(describePharmacyCode("06528F0101", registro)).toEqual({
      code: "06528",
      name: "C.S. NUEVO LIMA",
      unregistered: false,
    });
  });

  it("rotula un puesto comunal con su propio nombre", () => {
    expect(describePharmacyCode("06528F0201", registro)).toEqual({
      code: "06528F02",
      name: "P.C. LOS OLIVOS",
      unregistered: false,
    });
  });

  it("marca el puesto comunal que nadie dio de alta, en vez de esconderlo", () => {
    // Es la señal de que falta registrarlo: el código existe en SISMED pero no aquí.
    expect(describePharmacyCode("06528F0901", registro)).toEqual({
      code: "06528F09",
      name: "",
      unregistered: true,
    });
  });

  it("un almacén se rotula con sus seis caracteres", () => {
    expect(describePharmacyCode("030S0501", registro).name).toBe("ALMACÉN SISMED");
  });

  it("un ALMCOD que no se entiende se muestra tal cual y no se marca", () => {
    expect(describePharmacyCode("030S0", registro)).toEqual({
      code: "030S0",
      name: "",
      unregistered: false,
    });
  });

  it("una IPRESS sin registrar no se marca: la marca es solo para las farmacias", () => {
    expect(describePharmacyCode("09999F0101", registro).unregistered).toBe(false);
  });

  it("encuentra a la IPRESS aunque esté registrada con el sufijo de su farmacia", () => {
    // 06520 salía con un guion en la búsqueda avanzada mientras su tarjeta sí mostraba el
    // nombre: la tarjeta admite el sufijo y aquí se exigía el código exacto.
    const conSufijo = [{ code: "06520F01", name: "C.S. BELLAVISTA" }];
    expect(describePharmacyCode("06520F0101", conSufijo)).toEqual({
      code: "06520",
      name: "C.S. BELLAVISTA",
      unregistered: false,
    });
  });

  it("con dos registros que se reducen al mismo código no inventa un nombre", () => {
    // Mostrar el nombre equivocado es peor que no mostrar ninguno.
    const ambiguo = [
      { code: "06520F01", name: "C.S. BELLAVISTA" },
      { code: "06520F0101", name: "OTRO REGISTRO" },
    ];
    expect(describePharmacyCode("06520F0101", ambiguo).name).toBe("");
  });
});

describe("pharmaciesInRows", () => {
  const almcod = (row: { ALMCOD: string }) => row.ALMCOD;
  const registro = [
    { code: "06519", name: "C.S. NUEVO LIMA" },
    { code: "06519F02", name: "P.C. LOS OLIVOS" },
  ];

  it("lista cada farmacia de la hoja una vez, con cuántos lotes tiene", () => {
    const filas = [
      { ALMCOD: "06519F0101" },
      { ALMCOD: "06519F0201" },
      { ALMCOD: "06519F0101" },
      { ALMCOD: "06519F0301" },
    ];
    const lista = pharmaciesInRows(filas, almcod, registro);
    expect(lista.map((p) => [p.code, p.rows])).toEqual([
      ["06519", 2],
      ["06519F02", 1],
      ["06519F03", 1],
    ]);
    expect(lista[1].name).toBe("P.C. LOS OLIVOS");
    // El puesto que nadie registró sigue apareciendo, marcado: es la señal de darlo de alta.
    expect(lista[2]).toMatchObject({ name: "", unregistered: true });
  });

  it("pone primero a la IPRESS aunque sus filas lleguen después", () => {
    const filas = [{ ALMCOD: "06519F0201" }, { ALMCOD: "06519F0101" }];
    expect(pharmaciesInRows(filas, almcod, registro).map((p) => p.code)).toEqual([
      "06519",
      "06519F02",
    ]);
  });

  it("las filas sin ALMCOD se le cuentan a la IPRESS, no abren entrada propia", () => {
    const filas = [{ ALMCOD: "06519F0101" }, { ALMCOD: "" }, { ALMCOD: "06519F0201" }];
    const lista = pharmaciesInRows(filas, almcod, registro);
    expect(lista.map((p) => [p.code, p.rows])).toEqual([
      ["06519", 2],
      ["06519F02", 1],
    ]);
  });

  it("una hoja consolidada da una sola farmacia: no hay nada que filtrar", () => {
    expect(pharmaciesInRows([{ ALMCOD: "06519F01" }, { ALMCOD: "06519F01" }], almcod, registro)).toHaveLength(1);
    expect(pharmaciesInRows([], almcod, registro)).toEqual([]);
    expect(pharmaciesInRows(null, almcod, registro)).toEqual([]);
  });
});

describe("rowMatchesPharmacy", () => {
  it("«todos» deja pasar cualquier fila", () => {
    expect(rowMatchesPharmacy("06519F0201", "all")).toBe(true);
    expect(rowMatchesPharmacy("", "all")).toBe(true);
  });

  it("separa la IPRESS de sus puestos comunales", () => {
    expect(rowMatchesPharmacy("06519F0101", "06519")).toBe(true);
    expect(rowMatchesPharmacy("06519F0201", "06519")).toBe(false);
    expect(rowMatchesPharmacy("06519F0201", "06519F02")).toBe(true);
    expect(rowMatchesPharmacy("06519F0101", "06519F02")).toBe(false);
  });

  it("una fila sin ALMCOD es de la IPRESS, nunca de un puesto comunal", () => {
    expect(rowMatchesPharmacy("", "06519")).toBe(true);
    expect(rowMatchesPharmacy("", "06519F02")).toBe(false);
  });
});

describe("showsPharmacyColumn", () => {
  const almcod = (row: { ALMCOD: string }) => row.ALMCOD;

  it("se muestra cuando la hoja trae varias farmacias", () => {
    expect(
      showsPharmacyColumn([{ ALMCOD: "06528F0101" }, { ALMCOD: "06528F0201" }], almcod),
    ).toBe(true);
  });

  it("se oculta cuando todas las filas son de la misma farmacia", () => {
    // Sería una constante repetida ocupando ancho.
    expect(
      showsPharmacyColumn([{ ALMCOD: "06528F0101" }, { ALMCOD: "06528F0101" }], almcod),
    ).toBe(false);
  });

  it("se oculta en el envío consolidado, que llega sin ALMCOD", () => {
    expect(showsPharmacyColumn([{ ALMCOD: "" }, { ALMCOD: "" }], almcod)).toBe(false);
    expect(showsPharmacyColumn([], almcod)).toBe(false);
  });
});
