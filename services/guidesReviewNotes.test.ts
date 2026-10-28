import { describe, expect, it } from "vitest";
import { DEFAULT_NOTES, applyNote, noteKey, rememberNote, suggestedNotes } from "./guidesReviewNotes";

describe("observaciones de Revisión de guías", () => {
  it("pone la misma observación a varios productos y un texto vacío la quita", () => {
    const keys = [noteKey("06508", "00200"), noteKey("06508", "10151")];
    const notes = applyNote({}, keys, "  CORRECCIÓN   DE LOTE ");
    expect(notes).toEqual({ "06508|00200": "CORRECCIÓN DE LOTE", "06508|10151": "CORRECCIÓN DE LOTE" });
    expect(applyNote(notes, [keys[0]], "")).toEqual({ "06508|10151": "CORRECCIÓN DE LOTE" });
  });

  it("recuerda las usadas, la última primero y sin repetir", () => {
    const recent = rememberNote(rememberNote([], "PARA VENTA"), "Inventario 09/09/2026");
    expect(recent).toEqual(["Inventario 09/09/2026", "PARA VENTA"]);
    expect(rememberNote(recent, "para venta")).toEqual(["para venta", "Inventario 09/09/2026"]);
    expect(rememberNote(recent, "   ")).toBe(recent);
  });

  it("sugiere primero las usadas y completa con las del Excel, hasta 12", () => {
    const list = suggestedNotes(["INVENTARIO 09/09/2026", "correccion de lote"]);
    expect(list.slice(0, 2)).toEqual(["INVENTARIO 09/09/2026", "correccion de lote"]);
    expect(list).not.toContain("CORRECCIÓN DE LOTE");
    expect(list.length).toBe(Math.min(12, 2 + DEFAULT_NOTES.length - 1));
  });
});
