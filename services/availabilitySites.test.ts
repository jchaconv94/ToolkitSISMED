import { describe, expect, it } from "vitest";
import { isMentalHealthCenter, isOutOfAnalysis, siteChanges, type SiteDecisions } from "./availabilitySites";

const decision = (inAnalysis: boolean) => ({ inAnalysis, updatedByName: "JORDAN", updatedAt: "2026-10-10T10:00:00Z" });

describe("establecimientos del análisis", () => {
  it("reconoce los centros de salud mental comunitario por el nombre", () => {
    expect(isMentalHealthCenter("C.S.M.C. BELLAVISTA")).toBe(true);
    expect(isMentalHealthCenter("CSMC TARAPOTO")).toBe(true);
    expect(isMentalHealthCenter("CENTRO DE SALUD MENTAL COMUNITARIO MOYOBAMBA")).toBe(true);
    expect(isMentalHealthCenter("C.S. CONSUELO")).toBe(false);
    expect(isMentalHealthCenter("P.S. CSMCX")).toBe(false);
    expect(isMentalHealthCenter(undefined)).toBe(false);
  });

  it("sin decisión guardada, solo los centros de salud mental quedan fuera; la decisión manda", () => {
    const none: SiteDecisions = new Map();
    expect(isOutOfAnalysis("31456", "C.S.M.C. BELLAVISTA", none)).toBe(true);
    expect(isOutOfAnalysis("06503", "P.S. BUENOS AIRES", none)).toBe(false);
    const saved: SiteDecisions = new Map([["31456", decision(true)], ["06503", decision(false)]]);
    expect(isOutOfAnalysis("31456", "C.S.M.C. BELLAVISTA", saved)).toBe(false);
    expect(isOutOfAnalysis("06503", "P.S. BUENOS AIRES", saved)).toBe(true);
  });

  it("solo envía lo que cambia; lo que vuelve a lo de omisión se borra (null)", () => {
    const sites = [{ code: "31456", name: "C.S.M.C. BELLAVISTA" }, { code: "06503", name: "P.S. BUENOS AIRES" }, { code: "06505", name: "P.S. LIMON" }];
    const saved: SiteDecisions = new Map([["06505", decision(false)]]);
    // Tal como está guardado: nada que enviar.
    expect(siteChanges(sites, new Set(["31456", "06505"]), saved)).toEqual([]);
    // Se marca el C.S.M.C., se saca un puesto y el que estaba fuera vuelve (a lo de omisión).
    expect(siteChanges(sites, new Set(["06503"]), saved)).toEqual([["31456", true], ["06503", false], ["06505", null]]);
  });
});
