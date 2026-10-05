import { describe, expect, it } from "vitest";
import type { HealthFacility } from "../types";
import { findParentFacility, inheritFromParent, isPharmacyType, parentIpressCode, pharmaciesToSync } from "./facilityHierarchy";

const hospital: HealthFacility = { code: "06502", name: "HOSPITAL II-2 TARAPOTO", type: "HOSPITAL", category: "II-2", ungetId: "u1", microredId: undefined, district: "Tarapoto", province: "San Martín" };

describe("farmacias de un hospital", () => {
  it("el padre sale del código: F02 en adelante", () => {
    expect(parentIpressCode("06502F02")).toBe("06502");
    expect(parentIpressCode("06502F0301")).toBe("06502");
    expect(parentIpressCode("06502")).toBe("");
    expect(parentIpressCode("06502F01")).toBe("");
    expect(isPharmacyType("farmacia")).toBe(true);
    expect(findParentFacility("06502F02", [hospital])?.name).toBe("HOSPITAL II-2 TARAPOTO");
    expect(findParentFacility("06999F02", [hospital])).toBeUndefined();
  });

  it("hereda categoría, jurisdicción y ubicación; código, nombre y tipo son suyos", () => {
    const farm = inheritFromParent({ code: "06502F02", name: "Farm. Emergencia", type: "FARMACIA", category: "" }, hospital);
    expect(farm).toMatchObject({ code: "06502F02", name: "Farm. Emergencia", type: "FARMACIA", category: "II-2", ungetId: "u1", district: "Tarapoto" });
  });

  it("al cambiar el hospital, solo sus farmacias desactualizadas se vuelven a guardar", () => {
    const farm = inheritFromParent({ code: "06502F02", name: "Farm. Emergencia", type: "FARMACIA", category: "" }, hospital) as HealthFacility;
    const puesto: HealthFacility = { code: "06502F03", name: "P.C. X", type: "PUESTO_COMUNAL", category: "", ungetId: "u9" };
    const otra: HealthFacility = { ...farm, code: "06999F02" };
    expect(pharmaciesToSync(hospital, [hospital, farm, puesto, otra])).toEqual([]);
    const cambiado = { ...hospital, microredId: "m2" };
    expect(pharmaciesToSync(cambiado, [hospital, farm, puesto, otra])).toEqual([{ ...farm, microredId: "m2" }]);
  });
});
