import { describe, expect, it } from "vitest";
import { BACKUP_MAX_BYTES, BACKUP_TTL_MS, PC_SILENCE_MS, PcInfo, backupKey, buildUsage, canSee, isAlive, isBackupName, isExpired, keysByCode, onlineFor, parseBackupMeta, quotaMessage, r2OperationClass, usageBlocks, usageMessage, utcDayStart, utcMonthStart } from "./logic";

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

describe("consumo del plan gratuito", () => {
  it("clasifica las operaciones de R2 como en la tabla de precios", () => {
    expect(r2OperationClass("PutObject")).toBe("A");
    expect(r2OperationClass("UploadPart")).toBe("A");
    expect(r2OperationClass("CompleteMultipartUpload")).toBe("A");
    expect(r2OperationClass("GetObject")).toBe("B");
    expect(r2OperationClass("DeleteObject")).toBe("free");
    expect(r2OperationClass("AbortMultipartUpload")).toBe("free");
    expect(r2OperationClass("AlgoNuevo")).toBe("A");
  });

  it("avisa al 70 %, pausa al 80 % y toma el dato más alto", () => {
    const ok = buildUsage({ workers: 1000, r2ClassA: 10 }, now);
    expect(ok.level).toBe("ok");
    expect(usageBlocks(ok)).toBe(false);
    expect(usageMessage(ok)).toBeNull();

    const warn = buildUsage({ workers: 1000, doRequests: 70_000 }, now);
    expect(warn.level).toBe("warn");
    expect(warn.worst?.key).toBe("doRequests");
    expect(usageBlocks(warn)).toBe(false);
    expect(usageMessage(warn)).toContain("70 %");

    const paused = buildUsage({ r2ClassA: 800_000 }, now);
    expect(paused.level).toBe("paused");
    expect(usageBlocks(paused)).toBe(true);
    expect(usageMessage(paused)).toContain("próximo mes");
    expect(usageMessage(buildUsage({ workers: 90_000 }, now))).toContain("19:00");
  });

  it("si Cloudflare no responde, no pausa pero lo dice", () => {
    const unknown = buildUsage({}, now, "Falta la clave de métricas de Cloudflare");
    expect(unknown.level).toBe("unknown");
    expect(unknown.items.every((i) => i.used == null)).toBe(true);
    expect(usageBlocks(unknown)).toBe(false);
    expect(usageBlocks(null)).toBe(false);
    expect(unknown.error).toContain("Falta la clave");
  });

  it("días y meses en UTC, que es cuando Cloudflare reinicia", () => {
    const t = Date.UTC(2026, 9, 2, 3, 30); // 1/10 22:30 en Perú
    expect(new Date(utcDayStart(t)).toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(new Date(utcMonthStart(t)).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("cupo de descargas", () => {
  it("explica quién usó el cupo, en hora de Perú", () => {
    const at = "2026-10-02T03:36:00Z"; // 22:36 en Perú
    expect(quotaMessage({ ok: false, limit: 1, used: 1, last: { username: "bellavista", status: "DOWNLOADED", at } }))
      .toBe("Hoy ya se usó el cupo de este establecimiento (1 backup por día); el último lo descargó bellavista a las 22:36. Se podrá pedir otro mañana.");
    expect(quotaMessage({ ok: false, limit: 2, used: 2, last: { username: "admin", status: "UPLOADING", at } }))
      .toBe("Ya hay un backup de este establecimiento en curso: lo pidió admin a las 22:36. Se admiten 2 backups por día.");
  });
});
