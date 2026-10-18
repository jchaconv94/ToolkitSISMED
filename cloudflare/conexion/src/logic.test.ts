import { describe, expect, it } from "vitest";
import { BACKUP_MAX_BYTES, BACKUP_TTL_MS, BackupCopy, COPY_JOB_TTL_MS, COPY_KEEP_MS, copyCovers, copyIsNewer, copyIsStale, copyKey, copyOfferVerdict, copyRowsFor, nextCopyExpiry, PC_SILENCE_MS, PcInfo, backupKey, buildUsage, canSee, isAlive, isBackupName, isExpired, keysByCode, onlineFor, jobMessages, parseBackupMeta, quotaMessage, seenFor, seenRowsFor, usageFor, r2OperationClass, usageBlocks, usageMessage, utcDayStart, utcMonthStart } from "./logic";

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
    expect(quotaMessage({ ok: false, limit: 1, used: 1, last: { username: "bellavista", status: "DOWNLOADED", at } }, "bellavista"))
      .toBe("Hoy ya usó su cupo de este establecimiento (1 backup por día por usuario); el último lo descargó a las 22:36. Podrá pedir otro mañana.");
    expect(quotaMessage({ ok: false, limit: 2, used: 2, last: { username: "admin", status: "UPLOADING", at } }, "admin"))
      .toBe("Ya tiene un backup de este establecimiento en curso, pedido a las 22:36.");
    // Sin el SQL del cupo por usuario, el último puede ser de otro: se nombra.
    expect(quotaMessage({ ok: false, limit: 1, used: 1, last: { username: "bellavista", status: "DOWNLOADED", at } }, "diresa"))
      .toBe("Hoy ya se usó el cupo de este establecimiento (1 backup por día); el último lo descargó bellavista a las 22:36. Se podrá pedir otro mañana.");
    expect(quotaMessage({ ok: false, limit: 1, used: 1, last: { username: "admin", status: "UPLOADING", at } }, "diresa"))
      .toBe("Ya hay un backup de este establecimiento en curso: lo pidió admin a las 22:36.");
  });
});

describe("etapa 4", () => {
  it("el informático ve el estado del consumo, no las cifras de Cloudflare", () => {
    const full = buildUsage({ doRequests: 72_000, workers: 10 }, now, undefined, [{ date: "2026-10-02", requests: 72_000 }]);
    expect(usageFor(full, true)).toBe(full);
    const reduced = usageFor(full, false);
    expect(reduced.level).toBe("warn");
    expect(reduced.items).toEqual([]);
    expect(reduced.daily).toBeUndefined();
    expect(reduced.worst?.ratio).toBeCloseTo(0.72);
    expect(reduced.worst?.used).toBeNull();
  });

  it("al volver, cada pedido se muestra en el punto en que quedó", () => {
    const base = { id: "j1", code: "06525", sha256: "a".repeat(64), modified: "" };
    expect(jobMessages({ ...base, status: "requested" }).map((m: any) => m.t)).toEqual(["backup_requested"]);
    expect(jobMessages({ ...base, status: "uploading", name: "BKDA202610021300.zip", size: 100, sent: 40 }).map((m: any) => m.t))
      .toEqual(["backup_requested", "backup_meta", "backup_progress"]);
    const ready = jobMessages({ ...base, status: "ready", name: "BKDA202610021300.zip", size: 100, downloadUrl: "https://x/backup/j1/download?token=t" });
    expect(ready.map((m: any) => m.t)).toEqual(["backup_requested", "backup_meta", "backup_ready"]);
    expect((ready[2] as any).downloadUrl).toContain("/backup/j1/download");
  });
});

describe("última conexión", () => {
  const pc: PcInfo = {
    role: "pc", device: "d1", equipo: "FARMACIA-01", version: "2.2.4", since: 1_000,
    codes: [{ code: "06519", name: "C.S. Bellavista", ungetId: "u1" }, { code: "06525", name: "P.S. Cuzco", ungetId: "u2" }],
  };

  it("anota la hora del último ping, o la de conexión si nunca respondió", () => {
    expect(seenRowsFor(pc, pc.codes, 5_000).map((r) => r.at)).toEqual([5_000, 5_000]);
    expect(seenRowsFor(pc, pc.codes, null)[0]).toMatchObject({ code: "06519", equipo: "FARMACIA-01", version: "2.2.4", at: 1_000 });
  });

  it("cada usuario solo ve la de su jurisdicción; el admin, todas", () => {
    const seen = seenRowsFor(pc, pc.codes, 5_000);
    expect(seenFor({ isAdmin: false, ungetIds: ["u1"] }, seen).map((r) => r.code)).toEqual(["06519"]);
    expect(seenFor({ isAdmin: true, ungetIds: [] }, seen)).toHaveLength(2);
  });
});

describe("copia del día", () => {
  const sha = "a".repeat(64);
  const meta = { name: "BKDA202610160812.zip", size: 11_000_000, sha256: sha };
  const copy = (over: Partial<BackupCopy> = {}): BackupCopy => ({
    code: "06502", ungetId: "u1", name: meta.name, size: meta.size, sha256: sha, modified: "2026-10-16T08:12",
    key: "copias/06502/j1/BKDA202610160812.zip", uploadedAt: now - 3600_000, ...over,
  });

  it("vive en su propia carpeta para que la regla del bucket la trate aparte", () => {
    expect(copyKey({ id: "j1", code: "06502" }, meta.name)).toBe("copias/06502/j1/BKDA202610160812.zip");
    expect(backupKey({ id: "j1", code: "06502" }, meta.name)).toBe("backups/06502/j1/BKDA202610160812.zip");
  });

  it("no se vuelve a subir la misma copia, pero sí la del día siguiente", () => {
    expect(copyOfferVerdict(copy(), meta, null, false, now)).toMatchObject({ accept: false, reason: "La nube ya tiene esta copia" });
    expect(copyOfferVerdict(copy(), { ...meta, name: "BKDA202610170805.zip" }, null, false, now)).toEqual({ accept: true });
    expect(copyOfferVerdict(null, meta, null, false, now)).toEqual({ accept: true });
    // Una copia vencida igual se reemplaza, aunque sea el mismo archivo.
    expect(copyOfferVerdict(copy({ uploadedAt: now - COPY_KEEP_MS - 1 }), meta, null, false, now)).toEqual({ accept: true });
  });

  it("cada backup nuevo del día reemplaza al anterior, pero uno más viejo no", () => {
    const afternoon = { ...meta, name: "BKDA202610161300.zip", sha256: "b".repeat(64), modified: "2026-10-16T13:00" };
    expect(copyOfferVerdict(copy(), afternoon, null, false, now)).toEqual({ accept: true });
    const older = { ...meta, name: "BKDA202610150730.zip", sha256: "c".repeat(64), modified: "2026-10-15T07:30" };
    expect(copyOfferVerdict(copy(), older, null, false, now)).toMatchObject({ accept: false, reason: "La nube ya tiene un backup más reciente" });
  });

  it("un pedido con el mismo backup de la nube se atiende con la copia, sin subirlo otra vez", () => {
    expect(copyCovers(copy(), { ...meta, modified: "2026-10-16T08:12" }, now)).toBe(true);
    expect(copyCovers(copy(), { ...meta, name: "BKDA202610161300.zip", sha256: "b".repeat(64), modified: "2026-10-16T13:00" }, now)).toBe(false);
    expect(copyCovers(null, meta, now)).toBe(false);
    expect(copyCovers(copy({ uploadedAt: now - COPY_KEEP_MS - 1 }), meta, now)).toBe(false);
    // Sin fecha no se puede decir cuál es más nuevo: solo cuenta si es el mismo archivo.
    expect(copyCovers(copy({ modified: "" }), { ...meta, name: "BKDA202610150730.zip", sha256: "c".repeat(64), modified: "2026-10-15T07:30" }, now)).toBe(false);
  });

  it("una subida más vieja que termina después no reemplaza a la copia", () => {
    expect(copyIsNewer(copy({ modified: "2026-10-16T13:30" }), { modified: "2026-10-16T08:12" }, now)).toBe(true);
    expect(copyIsNewer(copy(), { modified: "2026-10-16T13:30" }, now)).toBe(false);
    expect(copyIsNewer(copy({ modified: "2026-10-16T13:30", uploadedAt: now - COPY_KEEP_MS - 1 }), { modified: "2026-10-16T08:12" }, now)).toBe(false);
    expect(copyIsNewer(copy(), { modified: "" }, now)).toBe(false);
  });

  it("al volver a entrar, el pedido atendido con la copia se sigue mostrando como copia", () => {
    const job = { id: "j1", code: "06502", kind: "copy_download" as const, status: "ready" as const, name: meta.name, size: meta.size, sha256: sha, downloadUrl: "https://x/d" };
    expect(jobMessages(job).at(-1)).toMatchObject({ t: "backup_ready", copy: true });
    expect(jobMessages({ ...job, kind: undefined }).at(-1)).not.toHaveProperty("copy");
  });

  it("no acepta dos subidas a la vez ni copias si el espacio se acerca al límite", () => {
    expect(copyOfferVerdict(null, meta, null, true, now).accept).toBe(false);
    const full = buildUsage({ r2Storage: 8.6 }, now);
    expect(copyOfferVerdict(null, meta, full, false, now)).toMatchObject({ accept: false });
    const paused = buildUsage({ doRequests: 85_000 }, now);
    expect(copyOfferVerdict(null, meta, paused, false, now).accept).toBe(false);
    expect(copyOfferVerdict(null, meta, buildUsage({ r2Storage: 2 }, now), false, now)).toEqual({ accept: true });
    // Hasta 85 % del almacenamiento siguen entrando copias, aunque los pedidos ya estén en pausa (80 %).
    expect(copyOfferVerdict(null, meta, buildUsage({ r2Storage: 8.2 }, now), false, now)).toEqual({ accept: true });
    expect(copyOfferVerdict(null, meta, buildUsage({ r2Storage: 8.5 }, now), false, now).accept).toBe(false);
  });

  it("cada uno ve solo las copias de su jurisdicción y no las vencidas", () => {
    const copies = [copy(), copy({ code: "06519", ungetId: "u2" }), copy({ code: "06524", uploadedAt: now - COPY_KEEP_MS - 1 })];
    expect(copyRowsFor({ isAdmin: false, ungetIds: ["u1"] }, copies, now).map((c) => c.code)).toEqual(["06502"]);
    expect(copyRowsFor({ isAdmin: true, ungetIds: [] }, copies, now).map((c) => c.code)).toEqual(["06502", "06519"]);
    expect(Object.keys(copyRowsFor({ isAdmin: true, ungetIds: [] }, copies, now)[0]).sort()).toEqual(["code", "modified", "name", "size", "uploadedAt"]);
  });

  it("vence a las 48 h y la alarma despierta para la primera que vence", () => {
    expect(copyIsStale(copy({ uploadedAt: now - COPY_KEEP_MS }), now)).toBe(false);
    expect(copyIsStale(copy({ uploadedAt: now - COPY_KEEP_MS - 1 }), now)).toBe(true);
    expect(nextCopyExpiry([])).toBeNull();
    expect(nextCopyExpiry([{ uploadedAt: now }, { uploadedAt: now - 10 }])).toBe(now - 10 + COPY_KEEP_MS + 1000);
  });

  it("la subida de una copia tiene más tiempo que un pedido: nadie la espera", () => {
    expect(isExpired({ createdAt: now - BACKUP_TTL_MS - 1 }, now)).toBe(true);
    expect(isExpired({ createdAt: now - BACKUP_TTL_MS - 1, kind: "copy" }, now)).toBe(false);
    expect(isExpired({ createdAt: now - COPY_JOB_TTL_MS - 1, kind: "copy" }, now)).toBe(true);
  });
});
