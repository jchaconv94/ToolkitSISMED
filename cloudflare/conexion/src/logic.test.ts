import { describe, expect, it } from "vitest";
import { PC_SILENCE_MS, PcInfo, canSee, isAlive, keysByCode, onlineFor } from "./logic";

const now = 1_000_000_000;
const pc = (codes: Array<[string, string | null]>, since = now - 1000, equipo = "PC"): PcInfo => ({
  role: "pc",
  codes: codes.map(([code, ungetId]) => ({ code, ungetId, name: `EST ${code}` })),
  device: `win-${equipo}`,
  equipo,
  version: "2.2.2",
  since,
});

describe("keysByCode", () => {
  it("agrupa por código y normaliza", () => {
    expect(keysByCode(" 030s05-aaaa-bbbb-cccc ; 06519-DDDD-EEEE-FFFF")).toEqual({
      "030S05": "030S05-AAAA-BBBB-CCCC",
      "06519": "06519-DDDD-EEEE-FFFF",
    });
  });
  it("descarta basura", () => {
    expect(keysByCode("hola,,--, 1-2-3")).toEqual({});
    expect(keysByCode(null)).toEqual({});
  });
});

describe("canSee", () => {
  it("el admin ve todo; el informático solo sus UNGET", () => {
    expect(canSee({ isAdmin: true, ungetIds: [] }, { ungetId: "u9" })).toBe(true);
    expect(canSee({ isAdmin: false, ungetIds: ["u1"] }, { ungetId: "u1" })).toBe(true);
    expect(canSee({ isAdmin: false, ungetIds: ["u1"] }, { ungetId: "u2" })).toBe(false);
    expect(canSee({ isAdmin: false, ungetIds: ["u1"] }, { ungetId: null })).toBe(false);
  });
});

describe("isAlive y onlineFor", () => {
  it("una PC sin ping reciente se da por desconectada", () => {
    const vieja = pc([["06519", "u1"]], now - PC_SILENCE_MS - 10);
    expect(isAlive(vieja, null, now)).toBe(false);
    expect(isAlive(vieja, now - 1000, now)).toBe(true);
  });

  it("lista solo lo visible, una fila por código, la conexión más reciente", () => {
    const rows = onlineFor(
      { isAdmin: false, ungetIds: ["u1"] },
      [
        { info: pc([["030S05", "u1"], ["06519", "u1"]], now - 5000, "ALMACEN"), lastPing: now - 2000 },
        { info: pc([["06519", "u1"]], now - 1000, "NUEVA"), lastPing: null },
        { info: pc([["07777", "u2"]]), lastPing: null },
        { info: pc([["06500", "u1"]], now - PC_SILENCE_MS - 1), lastPing: null },
      ],
      now,
    );
    expect(rows.map((r) => [r.code, r.equipo])).toEqual([["030S05", "ALMACEN"], ["06519", "NUEVA"]]);
  });
});
