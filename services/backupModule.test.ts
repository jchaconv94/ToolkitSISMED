import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import {
  BackupOverviewRow, activityFromRequest, buildBackupRows, copyLabel, filterBackupRows, jobProgress, jobSpeed, lastConnectionLabel, speedLabel, trackPhase, limaDay, planState, rowsOfUnget,
  showFilterCounts, summarizeBackups, ungetOptions, whoLabel,
} from "./backupModule";
import type { OnlinePc, UsageReading } from "./backupConnection";
import { applySeen } from "./backupConnection";

const ahora = Date.parse("2026-10-02T15:00:00Z"); // 10:00 en Perú
const hace = (dias: number) => new Date(ahora - dias * 86400000).toISOString();

const lista: BackupOverviewRow[] = [
  { code: "030S05", name: "Almacén Bellavista", today: 0, limit: 1, lastAt: hace(1), lastBy: "admin" },
  { code: "06519", name: "C.S. Bellavista", today: 1, limit: 1, lastAt: hace(0), lastBy: "bellavista" },
  { code: "06525", name: "P.S. Cuzco", today: 0, limit: 1, lastAt: hace(10), lastBy: "bellavista" },
  { code: "06533", name: "P.S. Nuevo Lima", today: 0, limit: 1 },
];
const pc = (code: string, equipo: string): OnlinePc => ({ code, name: code, ungetId: "u1", equipo, version: "2.2.3", since: ahora, lastSeen: ahora });
const enLinea = [pc("030S05", "OGM-DIGITACION"), pc("06519", "FARMACIA-01"), pc("06525", "ACER-JORDAN")];

describe("buildBackupRows", () => {
  it("se puede descargar si la PC está en línea, no hay pedido en curso, queda cupo y no hay pausa", () => {
    const filas = buildBackupRows(lista, enLinea, { "030S05": { code: "030S05", phase: "uploading", at: ahora } }, false, ahora);
    const por = Object.fromEntries(filas.map((f) => [f.code, f]));
    expect(por["030S05"].canDownload).toBe(false); // subiendo
    expect(por["06519"].canDownload).toBe(false); // cupo usado
    expect(por["06519"].quotaUsed).toBe(true);
    expect(por["06525"].canDownload).toBe(true);
    expect(por["06533"].canDownload).toBe(false); // desconectada
    expect(por["06525"].equipo).toBe("ACER-JORDAN");
  });
  it("el cupo es de cada usuario: lo que descargó otro no se lo quita", () => {
    const otro = { ...lista[1], today: 1, mine: 0 };
    const suyo = { ...lista[1], today: 2, mine: 1 };
    const [a, b] = buildBackupRows([otro, suyo], enLinea, {}, false, ahora);
    expect(a.quotaUsed).toBe(false);
    expect(a.canDownload).toBe(true);
    expect(b.quotaUsed).toBe(true);
  });
  it("con el plan en pausa no se ofrece descargar a nadie", () => {
    expect(buildBackupRows(lista, enLinea, {}, true, ahora).some((f) => f.canDownload)).toBe(false);
  });
  it("«descargado hoy» cuenta en hora de Perú", () => {
    const tarde = { ...lista[0], lastAt: "2026-10-02T04:30:00Z" }; // 1/10 23:30 en Perú
    const temprano = { ...lista[0], lastAt: "2026-10-02T05:30:00Z" }; // 2/10 00:30 en Perú
    expect(buildBackupRows([tarde], [], {}, false, ahora)[0].downloadedToday).toBe(false);
    expect(buildBackupRows([temprano], [], {}, false, ahora)[0].downloadedToday).toBe(true);
    expect(limaDay(ahora)).toBe("2026-10-02");
  });
});

describe("filtro «Mostrar», resumen y búsqueda", () => {
  const filas = buildBackupRows(lista, enLinea, {}, false, ahora);
  it("cuenta cada opción", () => {
    expect(showFilterCounts(filas)).toEqual({ all: 4, online: 3, ready: 2, today: 1, offline: 1 });
  });
  it("en línea primero y busca por nombre, código o PC sin tildes", () => {
    expect(filterBackupRows(filas, "", "all").map((f) => f.code)).toEqual(["030S05", "06519", "06525", "06533"]);
    expect(filterBackupRows(filas, "", "offline").map((f) => f.code)).toEqual(["06533"]);
    expect(filterBackupRows(filas, "almacen", "all").map((f) => f.code)).toEqual(["030S05"]);
    expect(filterBackupRows(filas, "acer", "all").map((f) => f.code)).toEqual(["06525"]);
  });
  it("KPIs: en línea, descargados hoy y sin backup en 7 días", () => {
    expect(summarizeBackups(filas, ahora)).toEqual({ total: 4, online: 3, downloadedToday: 1, stale: 2 });
  });
});

describe("filtro por UNGET", () => {
  const red: BackupOverviewRow[] = [
    { code: "030S06", name: "Alm. Anexo Picota", ungetId: "u-pi", ungetName: "UNGET PICOTA", today: 0, limit: 1 },
    { code: "030S05", name: "Almacén Bellavista", ungetId: "u-be", ungetName: "UNGET BELLAVISTA", today: 0, limit: 1 },
    { code: "06519", name: "C.S. Bellavista", ungetId: "u-be", ungetName: "UNGET BELLAVISTA", today: 0, limit: 1 },
    { code: "06600", name: "Sin UNGET en el registro", today: 0, limit: 1 },
  ];
  it("ofrece las UNGET de la lista, por nombre y con cuántos establecimientos tiene cada una", () => {
    expect(ungetOptions(red)).toEqual([
      { key: "u-be", name: "UNGET BELLAVISTA", count: 2 },
      { key: "u-pi", name: "UNGET PICOTA", count: 1 },
    ]);
  });
  it("deja solo los de la UNGET elegida; «all» los deja todos", () => {
    expect(rowsOfUnget(red, "u-be").map((r) => r.code)).toEqual(["030S05", "06519"]);
    expect(rowsOfUnget(red, "all")).toHaveLength(4);
  });
  it("sin id de UNGET, la reconoce por su nombre", () => {
    const soloNombre = [{ code: "1", name: "A", ungetName: "UNGET TOCACHE", today: 0, limit: 1 }];
    expect(ungetOptions(soloNombre)).toEqual([{ key: "UNGET TOCACHE", name: "UNGET TOCACHE", count: 1 }]);
    expect(rowsOfUnget(soloNombre, "UNGET TOCACHE")).toHaveLength(1);
  });
});

describe("plan gratuito y actividad", () => {
  const lectura = (level: UsageReading["level"], ratio: number | null): UsageReading => ({
    at: ahora, level, items: [], worst: ratio == null ? null : { key: "doRequests", label: "", used: null, limit: 0, ratio },
  });
  it("el informático ve el estado, no las cifras", () => {
    expect(planState(lectura("ok", 0.03)).value).toBe("Disponible");
    expect(planState(lectura("warn", 0.72))).toMatchObject({ value: "Cerca del tope", tone: "warning", ratio: 0.72 });
    expect(planState(lectura("paused", 0.81)).tone).toBe("danger");
    expect(planState(null).value).toBe("Sin medición");
  });
  it("cada pedido del registro se lee como una línea", () => {
    expect(whoLabel("bellavista", "bellavista")).toBe("tú");
    expect(activityFromRequest({ id: "1", code: "06519", username: "bellavista", status: "DOWNLOADED", fileName: "BKDA202610021300.zip", size: 8700000, at: hace(0) }, "admin").text)
      .toBe("06519 · BKDA202610021300.zip (8.3 MB) · lo descargó bellavista");
    expect(activityFromRequest({ id: "2", code: "030S05", username: "admin", status: "FAILED", reason: "No hay backups", at: hace(0) }, "admin"))
      .toMatchObject({ kind: "warning", text: "030S05 · falló: No hay backups · lo pediste tú" });
  });
});

describe("última conexión de las PC desconectadas", () => {
  it("se muestra con fecha y hora de Perú", () => {
    expect(lastConnectionLabel(ahora - 2 * 3600_000, ahora)).toBe("Hoy 08:00");
    expect(lastConnectionLabel(ahora - 86400000, ahora)).toBe("Ayer 10:00");
    expect(lastConnectionLabel(Date.parse("2026-09-28T13:15:00Z"), ahora)).toBe("28/09/2026 08:15");
  });

  it("la fila desconectada toma la última conexión y su equipo; la conectada, los suyos", () => {
    const seen = { [lista[1].code]: { code: lista[1].code, equipo: "PC-VIEJA", version: "2.2.3", at: ahora - 3600_000 } };
    const rows = buildBackupRows(lista, [pc(lista[0].code, "PC-NUEVA")], {}, false, ahora, seen);
    const off = rows.find((r) => r.code === lista[1].code)!;
    expect(off).toMatchObject({ online: false, equipo: "PC-VIEJA", lastSeen: ahora - 3600_000, canDownload: false });
    expect(rows.find((r) => r.code === lista[0].code)).toMatchObject({ online: true, equipo: "PC-NUEVA" });
  });

  it("una desconexión con hora la anota; una conexión no la toca", () => {
    const antes = { A: { code: "A", equipo: "PC1", version: "2.2.4", at: 1 } };
    expect(applySeen(antes, { t: "presence", online: true, codes: ["A"] })).toBe(antes);
    expect(applySeen(antes, { t: "presence", online: false, codes: ["A", "B"], equipo: "PC2", at: 50 })).toEqual({
      A: { code: "A", equipo: "PC2", version: "2.2.4", at: 50 },
      B: { code: "B", equipo: "PC2", version: "", at: 50 },
    });
  });
});

describe("jobProgress", () => {
  const job = (patch: object) => ({ code: "A", phase: "requested" as const, at: 0, size: 1000, ...patch });

  it("la subida es la primera mitad y la descarga la segunda: la barra nunca vuelve atrás", () => {
    const pasos = [
      jobProgress(job({ phase: "uploading", sent: 0 })),
      jobProgress(job({ phase: "uploading", sent: 1000 })),
      jobProgress(job({ phase: "downloading", received: 0 })),
      jobProgress(job({ phase: "downloading", received: 500 })),
      jobProgress(job({ phase: "downloading", received: 1000 })),
      jobProgress(job({ phase: "saving" })),
    ];
    expect(pasos.map((p) => p.pct)).toEqual([0, 50, 50, 75, 100, 100]);
    expect(pasos.map((p) => p.step)).toEqual([1, 1, 2, 2, 2, 2]);
  });

  it("la subida completa no llega al 100 %, y sin tamaño o esperando a la PC no hay cifra", () => {
    expect(jobProgress(job({ phase: "uploading", sent: 999 })).pct).toBe(49);
    expect(jobProgress(job({ phase: "uploading", sent: 10, size: undefined })).pct).toBe(0);
    expect(jobProgress(job({ phase: "requested" }))).toEqual({ pct: null, step: null });
  });
});

describe("velocidad y tiempo restante", () => {
  const MB = 1024 * 1024;
  const base = { code: "A", at: 0, size: 80 * MB };

  it("mide desde que empieza el paso y estima lo que falta", () => {
    let job = trackPhase({ ...base, phase: "requested" }, { ...base, phase: "uploading", sent: 0 }, 1000);
    expect(job).toMatchObject({ phaseAt: 1000, phaseBase: 0 });
    job = trackPhase(job, { ...job, sent: 20 * MB }, 81_000); // 20 MB en 80 s
    const speed = jobSpeed(job, 81_000)!;
    expect(speed.mbps).toBeCloseTo(2.1, 1);
    expect(Math.round(speed.secondsLeft)).toBe(240);
    expect(speedLabel(speed)).toBe("2,1 Mbps · faltan ~4 min");
  });

  it("al volver a entrar no muestra una velocidad imposible por lo ya subido", () => {
    let job = trackPhase({ ...base, phase: "requested" }, { ...base, phase: "uploading", sent: 0 }, 1000);
    job = trackPhase(job, { ...job, sent: 30 * MB }, 1200); // reenvío inmediato
    expect(job).toMatchObject({ phaseAt: 1200, phaseBase: 30 * MB });
    job = trackPhase(job, { ...job, sent: 31 * MB }, 9200);
    expect(jobSpeed(job, 9200)!.mbps).toBeCloseTo(1.05, 1);
  });

  it("sin 3 s de medición, sin avance o en otro paso no hay cifra", () => {
    const job = trackPhase({ ...base, phase: "requested" }, { ...base, phase: "uploading", sent: 0 }, 1000);
    expect(jobSpeed(job, 2000)).toBeNull();
    expect(jobSpeed(job, 10_000)).toBeNull();
    expect(jobSpeed({ ...job, phase: "saving" }, 10_000)).toBeNull();
    expect(speedLabel({ mbps: 12.4, secondsLeft: 30 })).toBe("12 Mbps · falta menos de 1 min");
  });

  it("al pasar de subir a descargar vuelve a medir", () => {
    const up = trackPhase({ ...base, phase: "requested" }, { ...base, phase: "uploading", sent: 0 }, 1000);
    const down = trackPhase(up, { ...up, phase: "downloading", received: 0 }, 50_000);
    expect(down).toMatchObject({ phaseAt: 50_000, phaseBase: 0 });
  });
});

describe("copia del día", () => {
  const copia = { code: "06533", name: "BKDA202610020812.zip", size: 11_000_000, modified: "2026-10-02T08:12", uploadedAt: ahora - 3600_000 };

  it("con copia se puede descargar aunque la PC esté apagada o el cupo esté usado", () => {
    const filas = buildBackupRows(lista, enLinea, {}, false, ahora, {}, { "06533": copia, "06519": { ...copia, code: "06519" } });
    const por = Object.fromEntries(filas.map((f) => [f.code, f]));
    expect(por["06533"].online).toBe(false);
    expect(por["06533"].canDownload).toBe(true);
    expect(por["06533"].canRequestNew).toBe(false); // apagada: no se le puede pedir uno nuevo
    expect(por["06519"].quotaUsed).toBe(true);
    expect(por["06519"].canDownload).toBe(true); // la copia no usa el cupo
    expect(por["06519"].canRequestNew).toBe(false);
    expect(por["06525"].copy).toBeUndefined();
    expect(por["06525"].canRequestNew).toBe(true);
  });

  it("con un pedido en curso no se ofrece bajar la copia otra vez", () => {
    const [fila] = buildBackupRows([lista[3]], [], { "06533": { code: "06533", phase: "downloading", at: ahora } }, false, ahora, {}, { "06533": copia });
    expect(fila.canDownload).toBe(false);
  });

  it("dice de qué día y hora es el backup", () => {
    expect(copyLabel(copia, ahora)).toBe("Copia de hoy 08:12");
    expect(copyLabel({ ...copia, modified: "2026-10-01T07:55" }, ahora)).toBe("Copia de ayer 07:55");
    expect(copyLabel({ ...copia, modified: "2026-09-29T08:01" }, ahora)).toBe("Copia del 29/09 08:01");
  });

  it("la descarga de la copia llena la barra de 0 a 100 %: no hay subida", () => {
    expect(jobProgress({ code: "A", phase: "downloading", at: 0, size: 100, received: 50, copy: true })).toEqual({ pct: 50, step: null });
    expect(jobProgress({ code: "A", phase: "downloading", at: 0, size: 100, received: 50 })).toEqual({ pct: 75, step: 2 });
  });

  it("la actividad nombra la descarga de la copia", () => {
    const item = activityFromRequest({ id: "1", code: "06533", name: "P.S.", username: "jordan", status: "COPY_DOWNLOADED", fileName: copia.name, size: copia.size, at: "2026-10-02T15:00:00Z" } as any, "jordan");
    expect(item.text).toContain("copia de la nube");
    expect(item.text).toContain("la descargaste tú");
  });

  it("un pedido atendido con la copia de la nube no se muestra como falla", () => {
    const base = { id: "2", code: "06533", name: "P.S.", username: "jordan", status: "FAILED", at: "2026-10-02T15:00:00Z" } as const;
    const reused = activityFromRequest({ ...base, reason: "Ya estaba en la nube: se bajó la copia" }, "jordan");
    expect(reused).toMatchObject({ kind: "download", tone: "info" });
    expect(reused.text).toContain("ya estaba en la nube");
    expect(activityFromRequest({ ...base, reason: "La PC se desconectó" }, "jordan").tone).toBe("warn");
  });
});
