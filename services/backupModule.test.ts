import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null }));

import {
  BackupOverviewRow, activityFromRequest, buildBackupRows, filterBackupRows, lastConnectionLabel, limaDay, planState, showFilterCounts,
  summarizeBackups, whoLabel,
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
