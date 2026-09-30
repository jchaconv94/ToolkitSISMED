import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import { filterSendKeys, relativeTime, sendKeyState, summarizeSendKeys, SendKeyRow } from "./sendKeys";

const fila = (parcial: Partial<SendKeyRow>): SendKeyRow => ({
  code: "06519", name: "C.S. Nuevo Lima", hasKey: false, blockedToday: 0, ...parcial,
});

const almacen = fila({
  code: "030S05", name: "Almacén Bellavista", hasKey: true, deviceName: "PC-ALMACEN", blockedToday: 3,
  alert: { id: 9, at: "2026-09-30T10:00:00Z", deviceName: "PC-SOPORTE-02", result: "OTRO_EQUIPO" },
});
const protegido = fila({ code: "06519", hasKey: true, deviceName: "PC-FARM-NLIMA" });
const esperando = fila({ code: "06503", name: "P.S. Buenos Aires", hasKey: true });
const sinClave = fila({ code: "06506", name: "C.S. Consuelo" });

describe("sendKeyState", () => {
  it("el bloqueo pendiente manda sobre la vinculación", () => {
    expect(sendKeyState(almacen)).toBe("blocked");
  });
  it("con clave y sin PC espera el primer envío", () => {
    expect(sendKeyState(esperando)).toBe("waiting");
    expect(sendKeyState(protegido)).toBe("protected");
    expect(sendKeyState(sinClave)).toBe("none");
  });
  it("un bloqueo antes del primer envío también avisa", () => {
    expect(sendKeyState({ ...esperando, alert: { id: 1, at: "", result: "SIN_CLAVE" } })).toBe("blocked");
  });
});

describe("summarizeSendKeys", () => {
  it("cuenta protegidos como todo lo que tiene clave", () => {
    expect(summarizeSendKeys([almacen, protegido, esperando, sinClave])).toEqual({
      total: 4, protectedCount: 3, blockedToday: 3, waiting: 1, none: 1,
    });
  });
});

describe("filterSendKeys", () => {
  const todos = [sinClave, protegido, esperando, almacen];
  it("pone primero los bloqueados", () => {
    expect(filterSendKeys(todos, "", "all").map((r) => r.code)).toEqual(["030S05", "06503", "06519", "06506"]);
  });
  it("filtra por estado", () => {
    expect(filterSendKeys(todos, "", "alerts").map((r) => r.code)).toEqual(["030S05"]);
    expect(filterSendKeys(todos, "", "none").map((r) => r.code)).toEqual(["06506"]);
    expect(filterSendKeys(todos, "", "protected").map((r) => r.code)).toEqual(["030S05", "06503", "06519"]);
  });
  it("ordena los números como números", () => {
    const n = (name: string) => fila({ name, code: name });
    expect(filterSendKeys([n("P.S. 10"), n("P.S. 2"), n("P.S. 1")], "", "all").map((r) => r.name)).toEqual(["P.S. 1", "P.S. 2", "P.S. 10"]);
  });
  it("busca sin tildes por nombre, código o PC", () => {
    expect(filterSendKeys(todos, "almacen", "all").map((r) => r.code)).toEqual(["030S05"]);
    expect(filterSendKeys(todos, "nlima", "all").map((r) => r.code)).toEqual(["06519"]);
    expect(filterSendKeys(todos, "06506", "all").map((r) => r.code)).toEqual(["06506"]);
  });
});

describe("relativeTime", () => {
  const ahora = new Date("2026-09-30T15:00:00Z");
  it("minutos, horas y ayer", () => {
    expect(relativeTime("2026-09-30T14:49:00Z", ahora)).toBe("Hace 11 min");
    expect(relativeTime("2026-09-30T12:00:00Z", ahora)).toBe("Hace 3 h");
    expect(relativeTime("2026-09-29T10:00:00Z", ahora)).toMatch(/^Ayer /);
    expect(relativeTime(null, ahora)).toBe("—");
  });
});
