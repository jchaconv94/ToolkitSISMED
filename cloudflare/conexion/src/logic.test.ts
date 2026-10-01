import { describe, expect, it } from "vitest";
import { BACKUP_MAX_BYTES, BACKUP_TTL_MS, PC_SILENCE_MS, PcInfo, backupKey, canSee, isAlive, isBackupName, isExpired, keysByCode, onlineFor, parseBackupMeta } from "./logic";

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

describe("backups", () => {
  it("acepta solo nombres de backup del SISMED", () => {
    expect(isBackupName("BKDA202610011300.zip")).toBe(true);
    expect(isBackupName("BKDA202610010812.Zip")).toBe(true);
    expect(isBackupName("BKDH202601010000.zip")).toBe(true);
    expect(isBackupName("../../otro.zip")).toBe(false);
    expect(isBackupName("BKDA2026.zip")).toBe(false);
  });
  it("valida los datos que manda el Toolkit", () => {
    const sha = "a".repeat(64);
    expect(parseBackupMeta({ name: "BKDA202610011300.zip", size: 1000, sha256: sha.toUpperCase() })?.sha256).toBe(sha);
    expect(parseBackupMeta({ name: "BKDA202610011300.zip", size: BACKUP_MAX_BYTES + 1, sha256: sha })).toBeNull();
    expect(parseBackupMeta({ name: "BKDA202610011300.zip", size: 0, sha256: sha })).toBeNull();
    expect(parseBackupMeta({ name: "BKDA202610011300.zip", size: 10, sha256: "xyz" })).toBeNull();
  });
  it("ruta en el bucket y vencimiento a la hora", () => {
    expect(backupKey({ id: "j1", code: "030S05" }, "BKDA202610011300.zip")).toBe("backups/030S05/j1/BKDA202610011300.zip");
    expect(isExpired({ createdAt: now - BACKUP_TTL_MS - 1 }, now)).toBe(true);
    expect(isExpired({ createdAt: now - 1000 }, now)).toBe(false);
  });
});
