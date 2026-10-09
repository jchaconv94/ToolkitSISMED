import { describe, expect, it } from "vitest";
import { EMPTY_SITE_PREFS, isMentalHealthCenter, isOutOfAnalysis, loadSitePrefs, prefsFromSelection, saveSitePrefs } from "./availabilitySites";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
};

describe("establecimientos del análisis", () => {
  it("reconoce los centros de salud mental comunitario por el nombre", () => {
    expect(isMentalHealthCenter("C.S.M.C. BELLAVISTA")).toBe(true);
    expect(isMentalHealthCenter("CSMC TARAPOTO")).toBe(true);
    expect(isMentalHealthCenter("CENTRO DE SALUD MENTAL COMUNITARIO MOYOBAMBA")).toBe(true);
    expect(isMentalHealthCenter("C.S. CONSUELO")).toBe(false);
    expect(isMentalHealthCenter("P.S. CSMCX")).toBe(false);
    expect(isMentalHealthCenter(undefined)).toBe(false);
  });

  it("por omisión solo los centros de salud mental quedan fuera; lo marcado a mano manda", () => {
    expect(isOutOfAnalysis("31456", "C.S.M.C. BELLAVISTA", EMPTY_SITE_PREFS)).toBe(true);
    expect(isOutOfAnalysis("06503", "P.S. BUENOS AIRES", EMPTY_SITE_PREFS)).toBe(false);
    expect(isOutOfAnalysis("31456", "C.S.M.C. BELLAVISTA", { out: [], in: ["31456"] })).toBe(false);
    expect(isOutOfAnalysis("06503", "P.S. BUENOS AIRES", { out: ["06503"], in: [] })).toBe(true);
  });

  it("solo anota lo que difiere de lo de omisión y conserva lo de establecimientos que no están en la lista", () => {
    const sites = [{ code: "31456", name: "C.S.M.C. BELLAVISTA" }, { code: "06503", name: "P.S. BUENOS AIRES" }, { code: "06505", name: "P.S. LIMON" }];
    const previous = { out: ["09999"], in: ["08888"] };
    // Sin cambios: nada nuevo que anotar.
    expect(prefsFromSelection(sites, new Set(["31456"]), previous)).toEqual(previous);
    // Se marca el C.S.M.C. y se desmarca un puesto.
    expect(prefsFromSelection(sites, new Set(["06505"]), previous)).toEqual({ out: ["06505", "09999"], in: ["08888", "31456"] });
  });

  it("se guarda por usuario y vuelve vacío si no hay nada o está dañado", () => {
    const s = memory();
    expect(saveSitePrefs("ana", { out: ["06503"], in: [] }, s)).toBe(true);
    expect(loadSitePrefs("ana", s)).toEqual({ out: ["06503"], in: [] });
    expect(loadSitePrefs("luis", s)).toEqual(EMPTY_SITE_PREFS);
    saveSitePrefs("ana", EMPTY_SITE_PREFS, s);
    expect(s.data.size).toBe(0);
    s.setItem("toolkit.disponibilidad.establecimientos.ana", "{roto");
    expect(loadSitePrefs("ana", s)).toEqual(EMPTY_SITE_PREFS);
    expect(loadSitePrefs("ana", null)).toEqual(EMPTY_SITE_PREFS);
  });
});
