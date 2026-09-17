import { describe, it, expect } from "vitest";
import {
  FUTURE_SYNC_TOLERANCE_MS,
  STOCK_SYNC_LIGHT_COLUMNS,
  findGroupsWithoutSync,
  findLatestValidSync,
  getSyncDateCutoffIso,
  parseSheetDateTime,
  pickLatestSyncs,
  resolveSyncDateIso,
  type StockSyncDatedRow,
} from "./stockSyncHistory";

type Row = StockSyncDatedRow & { id: string };

// 17/09/2026 10:00:00 hora local.
const NOW = new Date(2026, 8, 17, 10, 0, 0).getTime();
const iso = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s).toISOString();

describe("STOCK_SYNC_LIGHT_COLUMNS", () => {
  it("pide solo columnas que existen en stock_sync_history", () => {
    // Columnas reales verificadas en producción el 17/09/2026.
    const realColumns = [
      "id",
      "establishment_id",
      "establishment_name",
      "stock_hash",
      "sync_date",
      "sync_author",
      "record_count",
      "has_changes",
      "changed_items_count",
      "changes_metadata",
    ];
    const requested = STOCK_SYNC_LIGHT_COLUMNS.split(",");
    requested.forEach((column) => expect(realColumns).toContain(column));
    expect(requested).not.toContain("created_at");
    expect(requested).not.toContain("changes_metadata");
    expect(requested).toEqual(
      expect.arrayContaining(["establishment_id", "sync_date", "has_changes"]),
    );
  });
});

describe("parseSheetDateTime", () => {
  it("interpreta DD/MM/YYYY como día/mes (caso de referencia 07/12/2026)", () => {
    expect(parseSheetDateTime("07/12/2026")).toBe(new Date(2026, 11, 7).getTime());
  });

  it("lee fecha y hora de Google Sheets, con hora de uno o dos dígitos", () => {
    expect(parseSheetDateTime("16/09/2026 11:06:47")).toBe(
      new Date(2026, 8, 16, 11, 6, 47).getTime(),
    );
    expect(parseSheetDateTime("17/09/2026 9:15:47")).toBe(
      new Date(2026, 8, 17, 9, 15, 47).getTime(),
    );
    expect(parseSheetDateTime("16/09/2026 11:06")).toBe(
      new Date(2026, 8, 16, 11, 6, 0).getTime(),
    );
  });

  it("nunca invierte a MM/DD (10/09/2026 es 10 de septiembre)", () => {
    const ts = parseSheetDateTime("10/09/2026 14:23:12");
    expect(new Date(ts).getMonth()).toBe(8);
    expect(new Date(ts).getDate()).toBe(10);
  });

  it("devuelve 0 para fechas DD/MM imposibles o con formato no reconocido", () => {
    expect(parseSheetDateTime("31/02/2026")).toBe(0);
    expect(parseSheetDateTime("10/13/2026")).toBe(0);
    // Con coma no coincide; no debe caer al parser nativo, que lo leería como MM/DD.
    expect(parseSheetDateTime("10/09/2026, 14:23")).toBe(0);
  });

  it("acepta ISO y rechaza valores vacíos o inválidos", () => {
    expect(parseSheetDateTime("2026-09-16T16:06:47.000Z")).toBe(
      Date.parse("2026-09-16T16:06:47.000Z"),
    );
    expect(parseSheetDateTime("")).toBe(0);
    expect(parseSheetDateTime(null)).toBe(0);
    expect(parseSheetDateTime(undefined)).toBe(0);
    expect(parseSheetDateTime("sin fecha")).toBe(0);
  });
});

describe("resolveSyncDateIso", () => {
  it("usa la última actualización de la hoja cuando es válida", () => {
    expect(resolveSyncDateIso(iso(2026, 9, 17, 9, 15, 47), NOW)).toBe(
      iso(2026, 9, 17, 9, 15, 47),
    );
    expect(resolveSyncDateIso("17/09/2026 9:15:47", NOW)).toBe(
      iso(2026, 9, 17, 9, 15, 47),
    );
  });

  it("usa el momento actual si la fecha falta o es ilegible, sin lanzar errores", () => {
    const nowIso = new Date(NOW).toISOString();
    expect(resolveSyncDateIso(undefined, NOW)).toBe(nowIso);
    expect(resolveSyncDateIso("no es fecha", NOW)).toBe(nowIso);
    expect(resolveSyncDateIso("31/02/2026", NOW)).toBe(nowIso);
  });

  it("no guarda fechas futuras, pero tolera relojes algo adelantados", () => {
    const nowIso = new Date(NOW).toISOString();
    // SAN JUAN DEL CAÑO quedó registrado el 19/09 cuando era 17/09.
    expect(resolveSyncDateIso(iso(2026, 9, 19, 18, 15), NOW)).toBe(nowIso);
    const slightlyAhead = new Date(NOW + 5 * 60 * 1000).toISOString();
    expect(resolveSyncDateIso(slightlyAhead, NOW)).toBe(slightlyAhead);
  });
});

describe("getSyncDateCutoffIso", () => {
  it("es el momento actual más el margen tolerado", () => {
    expect(getSyncDateCutoffIso(NOW)).toBe(
      new Date(NOW + FUTURE_SYNC_TOLERANCE_MS).toISOString(),
    );
  });
});

describe("findLatestValidSync", () => {
  it("elige el más reciente e ignora fechas futuras o ilegibles", () => {
    const rows = [
      { id: "a", establishment_id: "0_29993542", sync_date: iso(2026, 9, 16, 12) },
      // NUEVO TARAPOTO: 10/09 guardado como 09/10.
      { id: "b", establishment_id: "0_29993542", sync_date: iso(2026, 10, 9, 14, 23) },
      { id: "c", establishment_id: "06520", sync_date: iso(2026, 9, 17, 8) },
      { id: "d", establishment_id: "06520", sync_date: "fecha rota" },
    ];
    expect(findLatestValidSync(rows, NOW)?.id).toBe("c");
  });

  it("devuelve undefined si no hay registros utilizables", () => {
    expect(findLatestValidSync([], NOW)).toBeUndefined();
    expect(
      findLatestValidSync(
        [{ establishment_id: "x", sync_date: iso(2026, 12, 1) }],
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("pickLatestSyncs", () => {
  it("conserva el último registro válido por establecimiento", () => {
    const rows = [
      { id: "1", establishment_id: "0_121569872", sync_date: iso(2026, 9, 16, 12), has_changes: true },
      { id: "2", establishment_id: "0_121569872", sync_date: iso(2026, 9, 16, 17), has_changes: true },
      { id: "3", establishment_id: "0_29993542", sync_date: iso(2026, 10, 9, 14), has_changes: true },
      { id: "4", establishment_id: "0_29993542", sync_date: iso(2026, 9, 10, 14), has_changes: true },
    ];
    const latest = pickLatestSyncs(rows, NOW);
    expect(latest["0_121569872"].id).toBe("2");
    // El registro con fecha futura no puede quedar como el último.
    expect(latest["0_29993542"].id).toBe("4");
  });

  it("marca como última modificación el registro con cambios más reciente", () => {
    const rows: Row[] = [
      { id: "1", establishment_id: "06505", sync_date: iso(2026, 9, 17, 9), has_changes: false },
      { id: "2", establishment_id: "06505", sync_date: iso(2026, 9, 16, 9), has_changes: true },
      { id: "3", establishment_id: "06505", sync_date: iso(2026, 9, 15, 9), has_changes: true },
    ];
    const latest = pickLatestSyncs(rows, NOW);
    expect(latest["06505"].id).toBe("1");
    expect(latest["06505"].last_modification_date).toBe(iso(2026, 9, 16, 9));
  });

  it("no modifica las filas recibidas", () => {
    const row: Row = { id: "1", establishment_id: "06505", sync_date: iso(2026, 9, 16, 9), has_changes: true };
    pickLatestSyncs([row], NOW);
    expect(row).not.toHaveProperty("last_modification_date");
  });
});

describe("findGroupsWithoutSync", () => {
  const latest = { "0_1621530450": {} };

  it("omite los establecimientos que ya tienen registro por cualquiera de sus claves", () => {
    const groups = [
      ["06505", "0_1621530450", "1621530450"],
      ["06528", "0_1251928992", "1251928992"],
    ];
    const ids = groups.flat();
    expect(findGroupsWithoutSync(ids, latest, groups)).toEqual([
      ["06528", "0_1251928992", "1251928992"],
    ]);
  });

  it("sin grupos, cada clave pendiente es su propio grupo", () => {
    expect(findGroupsWithoutSync(["06505", "0_1621530450"], latest)).toEqual([["06505"]]);
  });

  it("solo consulta claves que fueron pedidas", () => {
    expect(findGroupsWithoutSync(["06528"], {}, [["06528", "no-pedida"]])).toEqual([["06528"]]);
  });
});
