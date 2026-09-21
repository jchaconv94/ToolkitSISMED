import { describe, it, expect } from "vitest";
import {
  facilityCodeOf,
  facilityTypeLabel,
  parseFacilityCode,
  sheetOwnerCodeOf,
  suggestedFacilityType,
} from "./facilityCodes";

describe("parseFacilityCode", () => {
  it("reconoce el ALMCOD detallado de la farmacia principal como la propia IPRESS", () => {
    expect(parseFacilityCode("06528F0101")).toEqual({
      kind: "ipress",
      ipressCode: "06528",
      pharmacyCode: "06528F01",
      facilityCode: "06528",
    });
  });

  it("reconoce el ALMCOD detallado de un puesto comunal como establecimiento propio", () => {
    expect(parseFacilityCode("06528F0201")).toEqual({
      kind: "puesto-comunal",
      ipressCode: "06528",
      pharmacyCode: "06528F02",
      facilityCode: "06528F02",
    });
    expect(parseFacilityCode("06528F1001").facilityCode).toBe("06528F10");
  });

  it("reconoce el envío consolidado, que llega sin el 01 final", () => {
    expect(parseFacilityCode("06528F01")).toMatchObject({
      kind: "ipress",
      ipressCode: "06528",
      facilityCode: "06528",
    });
  });

  it("reconoce el código con el que se registra un puesto comunal", () => {
    // Ocho caracteres: es el formato del registro, no el del ALMCOD. La regla anterior lo
    // convertía en `06528F`, un código que no existe, y nunca emparejaba.
    expect(parseFacilityCode("06528F02")).toMatchObject({
      kind: "puesto-comunal",
      facilityCode: "06528F02",
    });
  });

  it("reconoce una IPRESS a secas", () => {
    expect(parseFacilityCode("06528")).toMatchObject({ kind: "ipress", facilityCode: "06528" });
  });

  it("reconoce los almacenes, que llevan seis caracteres", () => {
    expect(parseFacilityCode("030S0501")).toMatchObject({ kind: "almacen", facilityCode: "030S05" });
    expect(parseFacilityCode("030S05")).toMatchObject({ kind: "almacen", facilityCode: "030S05" });
  });

  it("no confunde una farmacia con un almacén", () => {
    // `06528F01` encaja también en el patrón de almacén (seis caracteres y dos dígitos);
    // el orden de las reglas es lo que lo evita.
    expect(parseFacilityCode("06528F01").kind).toBe("ipress");
    expect(parseFacilityCode("06528F01").facilityCode).toBe("06528");
  });

  it("deja como desconocido lo que no encaja, en vez de emparejarlo mal", () => {
    // Caso real de Tocache: la pestaña se llamaba `ALM SISMED-030S0`, con el código cortado.
    expect(parseFacilityCode("030S0")).toMatchObject({ kind: "desconocido", facilityCode: "" });
    expect(parseFacilityCode("")).toMatchObject({ kind: "desconocido" });
    expect(parseFacilityCode(null)).toMatchObject({ kind: "desconocido" });
    expect(parseFacilityCode("CUALQUIER COSA")).toMatchObject({ kind: "desconocido" });
  });

  it("no le importan los espacios ni las minúsculas", () => {
    expect(parseFacilityCode("  06528f0201  ").facilityCode).toBe("06528F02");
  });
});

describe("facilityCodeOf", () => {
  it("lleva cada código a su establecimiento registrado", () => {
    expect(facilityCodeOf("06528F0101")).toBe("06528");
    expect(facilityCodeOf("06528F0201")).toBe("06528F02");
    expect(facilityCodeOf("030S0501")).toBe("030S05");
    expect(facilityCodeOf("030S0")).toBe("");
  });

  it("el ALMCOD y el código registrado del mismo puesto comunal coinciden", () => {
    // Es la condición para poder relacionarlos: uno viene de Google Sheets y el otro de
    // Establecimientos, y tienen que dar lo mismo.
    expect(facilityCodeOf("06528F0201")).toBe(facilityCodeOf("06528F02"));
  });

  it("el ALMCOD de la farmacia principal coincide con la IPRESS registrada", () => {
    expect(facilityCodeOf("06528F0101")).toBe(facilityCodeOf("06528"));
    // Y también con el `F01` que hoy todavía hay en algunos registros.
    expect(facilityCodeOf("06519F01")).toBe(facilityCodeOf("06519"));
  });
});

describe("sheetOwnerCodeOf", () => {
  it("una fila de un puesto comunal sigue perteneciendo a la hoja de su IPRESS", () => {
    // La tarjeta toma el ALMCOD de la primera fila que encuentra. Si esa fila fuera de un
    // puesto comunal, mostraría `06528F02` donde debe ir el código de la IPRESS.
    expect(sheetOwnerCodeOf("06528F0201")).toBe("06528");
    expect(sheetOwnerCodeOf("06528F0101")).toBe("06528");
  });

  it("en un almacén, el dueño de la hoja es el propio almacén", () => {
    expect(sheetOwnerCodeOf("030S0501")).toBe("030S05");
  });

  it("sin código reconocible no inventa uno", () => {
    expect(sheetOwnerCodeOf("030S0")).toBe("");
  });
});

describe("suggestedFacilityType", () => {
  it("un código con F02 en adelante es un puesto comunal, y el código solo ya lo dice", () => {
    expect(suggestedFacilityType("06528F02")).toBe("PUESTO_COMUNAL");
    expect(suggestedFacilityType("06528F1001")).toBe("PUESTO_COMUNAL");
  });

  it("seis caracteres son un almacén", () => {
    expect(suggestedFacilityType("030S05")).toBe("ALM");
  });

  it("no se pronuncia sobre una IPRESS: hospital, centro y puesto se escriben igual", () => {
    expect(suggestedFacilityType("06528")).toBe("");
    expect(suggestedFacilityType("06528F0101")).toBe("");
    expect(suggestedFacilityType("")).toBe("");
  });
});

describe("facilityTypeLabel", () => {
  it("traduce el valor guardado a lo que se lee en pantalla", () => {
    expect(facilityTypeLabel("PUESTO_COMUNAL")).toBe("PUESTO COMUNAL");
    expect(facilityTypeLabel("CENTRO")).toBe("CENTRO DE SALUD");
  });

  it("un valor que ya no está en la lista se muestra tal cual, no se pierde", () => {
    expect(facilityTypeLabel("LO_QUE_SEA")).toBe("LO_QUE_SEA");
    expect(facilityTypeLabel("")).toBe("");
    expect(facilityTypeLabel(null)).toBe("");
  });
});
