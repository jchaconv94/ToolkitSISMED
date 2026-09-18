import { describe, it, expect } from "vitest";
import {
  SHEET_CHANGE_TOLERANCE_MS,
  groupBooksBySpreadsheet,
  runWithConcurrency,
  shouldReadSheet,
} from "./backgroundStockSync";
import {
  buildStockSnapshot,
  computeStockHash,
  decideStockSyncAction,
  buildStockSyncMetadataAttempts,
  computeStockTotals,
} from "../services/stockSyncHistory";
import { normalizeSheetRows } from "../services/stockRowNormalizer";

/** Fecha de hoja (hora local) como ISO, tal como la guarda `sync_date`. */
const isoDeHoja = (texto: string): string => {
  const [fecha, hora = "0:0:0"] = texto.split(" ");
  const [d, m, y] = fecha.split("/").map(Number);
  const [hh, mm, ss] = hora.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0).toISOString();
};

describe("shouldReadSheet", () => {
  it("lee la hoja cuando no hay registro previo", () => {
    expect(shouldReadSheet({ lastUpdate: "18/09/2026 08:55:01" }, null)).toBe(true);
    expect(shouldReadSheet({ lastUpdate: "18/09/2026 08:55:01" }, { sync_date: undefined })).toBe(true);
  });

  it("no la lee si la hoja no cambió desde el último registro", () => {
    const sync_date = isoDeHoja("18/09/2026 08:55:01");
    expect(shouldReadSheet({ lastUpdate: "18/09/2026 08:55:01" }, { sync_date })).toBe(false);
    // Un cambio menor al margen tampoco vuelve a descargar la hoja.
    expect(shouldReadSheet({ lastUpdate: "18/09/2026 08:55:30" }, { sync_date })).toBe(false);
  });

  it("la lee cuando la hoja se actualizó después del último registro", () => {
    const sync_date = isoDeHoja("18/09/2026 08:55:01");
    expect(shouldReadSheet({ lastUpdate: "18/09/2026 09:10:00" }, { sync_date })).toBe(true);
    expect(SHEET_CHANGE_TOLERANCE_MS).toBe(60 * 1000);
  });

  it("ante fechas ilegibles prefiere leer", () => {
    const sync_date = isoDeHoja("18/09/2026 08:55:01");
    expect(shouldReadSheet({ lastUpdate: "" }, { sync_date })).toBe(true);
    expect(shouldReadSheet({ lastUpdate: "31/02/2026 10:00:00" }, { sync_date })).toBe(true);
    expect(shouldReadSheet({ lastUpdate: "18/09/2026 09:00:00" }, { sync_date: "sin fecha" })).toBe(true);
  });
});

describe("groupBooksBySpreadsheet", () => {
  it("agrupa las UNGET que comparten libro y descarta las que no tienen hoja", () => {
    const books = groupBooksBySpreadsheet([
      { unget_name: "BELLAVISTA", spreadsheet_id: "LIBRO_A" },
      { unget_name: "San Martin", spreadsheet_id: "LIBRO_B" },
      { unget_name: "San Martin (2)", spreadsheet_id: "LIBRO_B" },
      { unget_name: "Tocache", spreadsheet_id: "  " },
      { unget_name: "Picota", spreadsheet_id: null },
    ]);
    expect(books).toEqual([
      { spreadsheetId: "LIBRO_A", names: ["BELLAVISTA"] },
      { spreadsheetId: "LIBRO_B", names: ["San Martin", "San Martin (2)"] },
    ]);
  });
});

describe("runWithConcurrency", () => {
  it("respeta el tope y conserva el orden", async () => {
    let enCurso = 0;
    let maximo = 0;
    const tasks = Array.from({ length: 7 }, (_, i) => async () => {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      await new Promise((resolve) => setTimeout(resolve, 1));
      enCurso -= 1;
      return i;
    });
    expect(await runWithConcurrency(tasks, 3)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(maximo).toBeLessThanOrEqual(3);
    expect(await runWithConcurrency([], 3)).toEqual([]);
  });
});

describe("misma lectura que la aplicación", () => {
  const filasCsv = [
    {
      ALMCOD: "06502F01",
      DESC_ALM: "HOSP. BELLAVISTA",
      ID_Producto: "00143",
      Nombre: "PARACETAMOL 500 MG",
      Lote: "L-1",
      TIPSUM: "R",
      FFINAN: "SIS",
      Saldo: "10",
      Precio_Det: "6,4125",
      Fec_Vencim: "31/12/2027",
      "ULTIMA ACTUALIZACION": "18/09/2026 8:55:01",
    },
    {
      ALMCOD: "06502F01",
      DESC_ALM: "HOSP. BELLAVISTA",
      ID_Producto: "00143",
      Nombre: "PARACETAMOL 500 MG",
      Lote: "L-1",
      TIPSUM: "D",
      FFINAN: "SIS",
      Saldo: "5",
      Precio_Det: "6,4125",
      Fec_Vencim: "31/12/2027",
    },
  ];

  it("agrupa por medicamento y lote y calcula la valorización con coma decimal", () => {
    const { rows, lastUpdate } = normalizeSheetRows(filasCsv, "121569872");
    expect(lastUpdate).toBe("18/09/2026 8:55:01");
    const snapshot = buildStockSnapshot(rows);
    expect(snapshot["00143|L-1"]).toEqual({ q: 15, n: "PARACETAMOL 500 MG", v: "31/12/2027" });
    expect(computeStockTotals(rows, snapshot)).toEqual({ totalStock: 15, totalValue: 96.19 });
  });

  it("solo registra cuando algún lote sube o baja", () => {
    const { rows } = normalizeSheetRows(filasCsv, "121569872");
    const snapshot = buildStockSnapshot(rows);
    const stockHash = computeStockHash(rows);
    const metadata = buildStockSyncMetadataAttempts({
      snapshot,
      movements: [],
      totalStock: 15,
      totalValue: 96.19,
    })[0];

    // Segunda lectura idéntica: no se guarda nada.
    expect(
      decideStockSyncAction({ previous: { stock_hash: stockHash, changes_metadata: metadata }, snapshot, stockHash }),
    ).toEqual({ action: "skip", movements: [], reason: "sin-movimientos" });

    // Sin registro previo se guarda una referencia inicial, que no es un movimiento.
    expect(decideStockSyncAction({ previous: null, snapshot, stockHash })).toEqual({
      action: "baseline",
      movements: [],
    });

    // Una salida de 5 unidades sí es un movimiento.
    const menos = buildStockSnapshot(
      normalizeSheetRows([{ ...filasCsv[0], Saldo: "10" }], "121569872").rows,
    );
    const decision = decideStockSyncAction({
      previous: { stock_hash: stockHash, changes_metadata: metadata },
      snapshot: menos,
      stockHash: computeStockHash([{ ...filasCsv[0] }]),
    });
    expect(decision.action).toBe("insert");
    expect(decision.movements).toHaveLength(1);
    expect(decision.movements[0]).toMatchObject({ codigo: "00143", lote: "L-1", change: -5 });
  });

  it("el detalle guardado conserva la foto aunque haya que recortar los movimientos", () => {
    const { rows } = normalizeSheetRows(filasCsv, "121569872");
    const snapshot = buildStockSnapshot(rows);
    const movements = Array.from({ length: 60 }, (_, i) => ({
      id: `X${i}|L`,
      codigo: `X${i}`,
      lote: "L",
      name: `MED ${i}`,
      previousQty: 1,
      currentQty: 2,
      change: 1,
    }));
    const attempts = buildStockSyncMetadataAttempts({
      snapshot,
      movements,
      totalStock: 15,
      totalValue: 96.19,
    });
    expect(attempts).toHaveLength(4);
    expect(JSON.parse(attempts[0] as string).changes).toHaveLength(60);
    expect(JSON.parse(attempts[1] as string).changes).toHaveLength(50);
    expect(JSON.parse(attempts[2] as string).changes).toHaveLength(0);
    expect(JSON.parse(attempts[2] as string).items_snapshot["00143|L-1"].q).toBe(15);
    expect(attempts[3]).toBeUndefined();
  });
});
