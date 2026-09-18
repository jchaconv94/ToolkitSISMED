import { describe, it, expect } from "vitest";
import {
  FUTURE_SYNC_TOLERANCE_MS,
  STOCK_SNAPSHOT_VERSION,
  STOCK_SYNC_LIGHT_COLUMNS,
  buildStockSnapshot,
  diffStockSnapshots,
  getLastMovementDate,
  parseSheetNumber,
  readStockSnapshot,
  stockItemKey,
  findGroupsWithoutSync,
  findLatestValidSync,
  getSyncDateCutoffIso,
  parseSheetDateTime,
  pickLatestSyncs,
  resolveSyncDateIso,
  type StockSyncDatedRow,
  stripStockSnapshot,
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

const stockItem = (
  codigo: string,
  lote: string,
  saldo: string,
  extra: Record<string, string> = {},
) => ({
  ID_Producto: codigo,
  Nombre: `MEDICAMENTO ${codigo}`,
  Lote: lote,
  Saldo: saldo,
  Fec_Vencim: "07/12/2026",
  TIPSUM: "CN",
  FFINAN: "DYT",
  Precio_Det: "6,4125",
  ...extra,
});

describe("parseSheetNumber", () => {
  it("lee los números como los muestra la hoja (coma decimal, punto de miles)", () => {
    expect(parseSheetNumber("6,4125")).toBeCloseTo(6.4125);
    expect(parseSheetNumber("0,133875")).toBeCloseTo(0.133875);
    expect(parseSheetNumber("1.200")).toBe(1200);
    expect(parseSheetNumber("1.200,50")).toBeCloseTo(1200.5);
    expect(parseSheetNumber("51830")).toBe(51830);
    expect(parseSheetNumber(478)).toBe(478);
  });

  it("devuelve 0 para valores vacíos o no numéricos", () => {
    expect(parseSheetNumber("")).toBe(0);
    expect(parseSheetNumber(null)).toBe(0);
    expect(parseSheetNumber("DYT")).toBe(0);
    expect(parseSheetNumber(NaN)).toBe(0);
  });
});

describe("buildStockSnapshot / stockItemKey", () => {
  it("agrupa por medicamento y lote, sumando tipo de suministro y fuente", () => {
    const snapshot = buildStockSnapshot([
      stockItem("00143", "L1", "100"),
      stockItem("00143", "L1", "20", { TIPSUM: "CI", FFINAN: "ROR" }),
      stockItem("00143", "L2", "5"),
    ]);
    expect(Object.keys(snapshot).sort()).toEqual(["00143|L1", "00143|L2"]);
    expect(snapshot["00143|L1"].q).toBe(120);
    expect(snapshot["00143|L1"].n).toBe("MEDICAMENTO 00143");
    expect(snapshot["00143|L2"].v).toBe("07/12/2026");
  });

  it("usa marcadores cuando falta el código o el lote", () => {
    expect(stockItemKey({ Nombre: "X" })).toBe("SIN_CODIGO|N/A");
  });
});

describe("diffStockSnapshots", () => {
  const previous = buildStockSnapshot([
    stockItem("00143", "L1", "100"),
    stockItem("00200", "L9", "50"),
    stockItem("00259", "L3", "0"),
  ]);

  it("solo reporta medicamentos que subieron o bajaron", () => {
    const current = buildStockSnapshot([
      stockItem("00143", "L1", "80"),
      stockItem("00200", "L9", "50"),
      stockItem("00259", "L3", "0"),
    ]);
    const movements = diffStockSnapshots(previous, current);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ codigo: "00143", lote: "L1", previousQty: 100, currentQty: 80, change: -20 });
  });

  it("una reclasificación de tipo de suministro o fuente no es un movimiento", () => {
    const current = buildStockSnapshot([
      stockItem("00143", "L1", "60", { FFINAN: "ROR" }),
      stockItem("00143", "L1", "40", { TIPSUM: "CI" }),
      stockItem("00200", "L9", "50"),
      stockItem("00259", "L3", "0"),
    ]);
    expect(diffStockSnapshots(previous, current)).toEqual([]);
  });

  it("un lote que aparece o desaparece con saldo 0 no es un movimiento", () => {
    const current = buildStockSnapshot([
      stockItem("00143", "L1", "100"),
      stockItem("00200", "L9", "50"),
      stockItem("00700", "L8", "0"),
    ]);
    expect(diffStockSnapshots(previous, current)).toEqual([]);
  });

  it("registra entradas nuevas y productos que se agotan, ordenados por magnitud", () => {
    const current = buildStockSnapshot([
      stockItem("00143", "L1", "105"),
      stockItem("00700", "L8", "300"),
    ]);
    const movements = diffStockSnapshots(previous, current);
    expect(movements.map((m) => `${m.codigo}|${m.lote}:${m.change}`)).toEqual([
      "00700|L8:300",
      "00200|L9:-50",
      "00143|L1:5",
    ]);
    expect(movements[1].name).toBe("MEDICAMENTO 00200");
  });
});

describe("readStockSnapshot", () => {
  it("lee el formato nuevo", () => {
    const metadata = JSON.stringify({
      snapshot_version: STOCK_SNAPSHOT_VERSION,
      items_snapshot: { "00143|L1": { q: 120, n: "ACICLOVIR" } },
    });
    expect(readStockSnapshot(metadata)).toEqual({ "00143|L1": { q: 120, n: "ACICLOVIR", v: undefined } });
  });

  it("convierte el formato antiguo agrupando por medicamento y lote", () => {
    const metadata = JSON.stringify({
      items_snapshot: {
        "00143|L1|CN|DYT": { name: "ACICLOVIR", qty: 100, vto: "29/02/2028" },
        "00143|L1|CI|ROR": { name: "ACICLOVIR", qty: 20 },
      },
    });
    expect(readStockSnapshot(metadata)).toEqual({
      "00143|L1": { q: 120, n: "ACICLOVIR", v: "29/02/2028" },
    });
  });

  it("devuelve null cuando el registro no trae detalle utilizable", () => {
    expect(readStockSnapshot(null)).toBeNull();
    expect(readStockSnapshot("no es json")).toBeNull();
    expect(readStockSnapshot(JSON.stringify({ total_stock: 10 }))).toBeNull();
    expect(readStockSnapshot(JSON.stringify({ items_snapshot: {} }))).toBeNull();
  });
});

describe("getLastMovementDate", () => {
  it("usa la fecha del último cambio real y descarta la referencia inicial", () => {
    expect(getLastMovementDate({ sync_date: "2026-09-17T14:00:00Z", has_changes: true })).toBe("2026-09-17T14:00:00Z");
    expect(getLastMovementDate({ sync_date: "2026-09-17T14:00:00Z", has_changes: false })).toBeUndefined();
    expect(
      getLastMovementDate({ sync_date: "2026-09-17T14:00:00Z", has_changes: false, last_modification_date: "2026-09-16T09:00:00Z" }),
    ).toBe("2026-09-16T09:00:00Z");
    expect(getLastMovementDate(null)).toBeUndefined();
  });
});

describe("stripStockSnapshot", () => {
  const metadata = JSON.stringify({
    snapshot_version: 2,
    total_stock: 120,
    total_value: 96.19,
    changes: [{ id: "00143|L1", codigo: "00143", lote: "L1", name: "ACICLOVIR", previousQty: 100, currentQty: 120, change: 20 }],
    items_snapshot: { "00143|L1": { q: 120, n: "ACICLOVIR", v: "29/02/2028" } },
  });

  it("quita la foto y conserva totales y movimientos", () => {
    const podado = stripStockSnapshot(metadata);
    const parsed = JSON.parse(podado as string);
    expect(parsed.items_snapshot).toBeUndefined();
    expect(parsed.snapshot_pruned).toBe(true);
    expect(parsed.total_stock).toBe(120);
    expect(parsed.total_value).toBe(96.19);
    expect(parsed.changes).toHaveLength(1);
    // Lo que muestra la ventana de historial sigue intacto.
    expect(parsed.changes[0].change).toBe(20);
    expect(podado!.length).toBeLessThan(metadata.length);
  });

  it("un registro ya podado no vuelve a tocarse", () => {
    const podado = stripStockSnapshot(metadata) as string;
    expect(stripStockSnapshot(podado)).toBeNull();
  });

  it("devuelve null cuando no hay nada que recortar", () => {
    expect(stripStockSnapshot(null)).toBeNull();
    expect(stripStockSnapshot("")).toBeNull();
    expect(stripStockSnapshot("no es json")).toBeNull();
    expect(stripStockSnapshot(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(stripStockSnapshot(JSON.stringify({ total_stock: 10 }))).toBeNull();
  });

  it("el registro podado ya no sirve para comparar, y eso es lo esperado", () => {
    expect(readStockSnapshot(metadata)).not.toBeNull();
    expect(readStockSnapshot(stripStockSnapshot(metadata))).toBeNull();
  });
});
