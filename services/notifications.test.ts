import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: null }));
vi.mock("./api", () => ({ getSessionToken: () => null, api: {} }));

import {
  DEFAULT_NOTICE_THRESHOLDS, EMPTY_MEMORY, Notice, NoticeThresholds, badgeLabel, buildBackupNotice, buildPharmacyNotices,
  buildTechnicalNotices, isUnseen, itemsSignature, loadNoticeMemory, markSeen, normalizeThresholds, noticeWhen, saveNoticeMemory,
  trackSince, unseenCount,
} from "./notifications";
import { SendKeyRow } from "./sendKeys";
import { ToolkitDeviceRow } from "./toolkitDevices";
import { UsageReading } from "./backupConnection";
import { StockRow, parseUpdateTimestamp } from "./assignedIpressStock";

const ahora = new Date("2026-10-03T12:00:00");
const DIA = 86400000;
const hace = (dias: number) => new Date(ahora.getTime() - dias * DIA).toISOString();
const umbrales: NoticeThresholds = { staleDays: 3, expiryDays: 90 };
const clave = (parcial: Partial<SendKeyRow>): SendKeyRow => ({ code: "06519", name: "C.S. Nuevo Lima", hasKey: false, blockedToday: 0, ...parcial });
const byId = (notices: Notice[], id: string) => notices.find((n) => n.id === id);

// ---------------------------------------------------------------------------
//  Umbrales
// ---------------------------------------------------------------------------

describe("normalizeThresholds", () => {
  it("usa 3 y 90 días cuando no hay valores (SQL sin aplicar)", () => {
    expect(normalizeThresholds(null)).toEqual(DEFAULT_NOTICE_THRESHOLDS);
    expect(normalizeThresholds({})).toEqual({ staleDays: 3, expiryDays: 90 });
    expect(normalizeThresholds({ staleDays: "abc", expiryDays: "" })).toEqual({ staleDays: 3, expiryDays: 90 });
  });

  it("recorta a los límites y redondea", () => {
    expect(normalizeThresholds({ staleDays: 0, expiryDays: 1 })).toEqual({ staleDays: 1, expiryDays: 7 });
    expect(normalizeThresholds({ staleDays: 99, expiryDays: 1000 })).toEqual({ staleDays: 30, expiryDays: 365 });
    expect(normalizeThresholds({ staleDays: "5", expiryDays: 60.4 })).toEqual({ staleDays: 5, expiryDays: 60 });
  });
});

// ---------------------------------------------------------------------------
//  Técnicos
// ---------------------------------------------------------------------------

describe("buildTechnicalNotices", () => {
  const claves: SendKeyRow[] = [
    clave({ code: "06525", name: "P.S. Cuzco", hasKey: true, deviceName: "ACER-JORDAN", lastOkAt: hace(5),
      alert: { id: 7, at: hace(0.02), deviceName: "FARMACIA-02", result: "OTRO_EQUIPO" } }),
    clave({ code: "06519", name: "C.S. Bellavista", hasKey: true, deviceName: "FARMACIA-01", lastOkAt: hace(0.1) }),
    clave({ code: "06533", name: "P.S. Nuevo Lima", lastOkAt: hace(4) }),
    clave({ code: "06540", name: "P.S. Nunca", hasKey: true }),
    clave({ code: "06541", name: "P.S. Tres", lastOkAt: hace(10) }),
  ];
  const equipos: ToolkitDeviceRow[] = [
    { code: "06525", name: "P.S. Cuzco", devices: [{ deviceName: "ACER-JORDAN", version: "2.2.3", sismedVersion: "2.5.8", lastSeen: hace(1) }] },
    { code: "06519", name: "C.S. Bellavista", devices: [{ deviceName: "FARMACIA-01", version: "2.2.4", sismedVersion: "2.6.1", lastSeen: hace(0.1) }] },
    { code: "06533", name: "P.S. Nuevo Lima", devices: [{ deviceName: "NLIMA", version: "2.2.3", sismedVersion: "2.6.1", lastSeen: hace(4) }] },
  ];
  const build = (keys = claves, devices = equipos, latest: string | null = "2.2.4", t = umbrales) =>
    buildTechnicalNotices({ keys, devices, latestToolkit: latest, thresholds: t, now: ahora });

  it("avisa del intento bloqueado sin revisar, con establecimiento, código y PC", () => {
    const n = byId(build(), "claves-bloqueadas")!;
    expect(n.tone).toBe("danger");
    expect(n.title).toBe("PC no autorizada intentó enviar stock");
    expect(n.detail).toBe("P.S. Cuzco (06525) · equipo FARMACIA-02");
    expect(n.action).toEqual({ label: "Revisar", module: "ADMIN_SEND_KEYS" });
    expect(n.at).toBe(claves[0].alert!.at);
  });

  it("con varios intentos dice «y N más» y empieza por el más reciente", () => {
    const keys = [...claves, clave({ code: "06550", name: "P.S. Otro", hasKey: true, alert: { id: 9, at: hace(2), deviceName: "X", result: "CLAVE_INCORRECTA" } })];
    const n = byId(build(keys), "claves-bloqueadas")!;
    expect(n.title).toBe("2 PC no autorizadas intentaron enviar stock");
    expect(n.detail).toBe("P.S. Cuzco (06525) · equipo FARMACIA-02 y 1 más");
  });

  it("el aviso desaparece cuando el intento se ignora o se resuelve", () => {
    const resueltas = claves.map((c) => ({ ...c, alert: null }));
    expect(byId(build(resueltas), "claves-bloqueadas")).toBeUndefined();
  });

  it("cuenta los establecimientos cuyo último envío es más viejo que el umbral, sin los que nunca enviaron", () => {
    const n = byId(build(), "stock-sin-actualizar")!;
    // 06525 (5 días), 06533 (4 días), 06541 (10 días). 06540 nunca envió, 06519 hoy.
    expect(n.title).toBe("3 establecimientos sin actualizar su stock");
    expect(n.detail).toBe("P.S. Tres, P.S. Cuzco y 1 más · hace más de 3 días");
    expect(n.tone).toBe("warning");
  });

  it("respeta el umbral configurado", () => {
    const n = byId(build(claves, equipos, "2.2.4", { staleDays: 6, expiryDays: 90 }), "stock-sin-actualizar")!;
    expect(n.title).toBe("1 establecimiento sin actualizar su stock");
    expect(n.detail).toBe("P.S. Tres · hace más de 6 días");
    expect(byId(build(claves, equipos, "2.2.4", { staleDays: 30, expiryDays: 90 }), "stock-sin-actualizar")).toBeUndefined();
  });

  it("al enviar de nuevo, el establecimiento sale del aviso", () => {
    const keys = claves.map((c) => ({ ...c, lastOkAt: c.lastOkAt ? hace(0) : c.lastOkAt }));
    expect(byId(build(keys, []), "stock-sin-actualizar")).toBeUndefined();
  });

  it("Toolkit desactualizado: misma regla que el módulo, con la vigente", () => {
    const n = byId(build(), "toolkit-desactualizado")!;
    expect(n.title).toBe("2 PC con el Toolkit desactualizado");
    expect(n.detail).toBe("Tienen 2.2.3; la vigente es 2.2.4");
    expect(n.tone).toBe("info");
  });

  it("sin versión publicada (GitHub no respondió) no hay aviso de Toolkit", () => {
    expect(byId(build(claves, equipos, null), "toolkit-desactualizado")).toBeUndefined();
  });

  it("SISMED antiguo contra la versión más alta que reporta alguna PC", () => {
    const n = byId(build(), "sismed-antiguo")!;
    expect(n.title).toBe("1 PC con una versión antigua del SISMED");
    expect(n.detail).toBe("P.S. Cuzco usa v2.5.8 · la vigente es v2.6.1");
  });

  it("todo al día: ningún aviso técnico", () => {
    const keys = [clave({ code: "06519", name: "C.S. Bellavista", hasKey: true, deviceName: "F1", lastOkAt: hace(0) })];
    const devices = [equipos[1]];
    expect(build(keys, devices)).toEqual([]);
  });

  it("la firma cambia si cambia el contenido, no si se repite", () => {
    const a = byId(build(), "stock-sin-actualizar")!.signature;
    expect(byId(build(), "stock-sin-actualizar")!.signature).toBe(a);
    const keys = claves.filter((c) => c.code !== "06541");
    expect(byId(build(keys), "stock-sin-actualizar")!.signature).not.toBe(a);
  });

  it("revisiones sucesivas: marcado una vez, no vuelve mientras no haya nada nuevo", () => {
    const vista = markSeen(EMPTY_MEMORY, build());
    expect(unseenCount(build(), vista)).toBe(0);
    // Un establecimiento se puso al día y sale de «sin actualizar»: sigue visto.
    const menos = byId(build(claves.filter((c) => c.code !== "06541")), "stock-sin-actualizar");
    if (menos) expect(isUnseen(menos, vista)).toBe(false);
    // Sale una versión nueva del Toolkit: es otra cosa, vuelve a contar.
    expect(isUnseen(byId(build(claves, equipos, "2.2.5"), "toolkit-desactualizado")!, vista)).toBe(true);
  });

  it("la misma PC no autorizada que reintenta no reaviva el aviso; otra PC sí", () => {
    const conAlerta = (id: number, deviceName: string) =>
      claves.map((c, i) => (i === 0 ? { ...c, alert: { id, at: hace(0), deviceName, result: "OTRO_EQUIPO" } } : c)) as SendKeyRow[];
    const vista = markSeen(EMPTY_MEMORY, build(conAlerta(7, "FARMACIA-02")));
    expect(isUnseen(byId(build(conAlerta(8, "FARMACIA-02")), "claves-bloqueadas")!, vista)).toBe(false);
    expect(isUnseen(byId(build(conAlerta(9, "LAPTOP-X")), "claves-bloqueadas")!, vista)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
//  Backups
// ---------------------------------------------------------------------------

describe("buildBackupNotice", () => {
  const lectura = (ratio: number | null, level: UsageReading["level"] = "ok"): UsageReading => {
    const worst = { key: "do_requests", label: "Mensajes de conexión de hoy", used: 1, limit: 1, ratio };
    return { at: 0, items: [worst], level, worst };
  };

  it("no avisa por debajo del 70 % ni sin lectura", () => {
    expect(buildBackupNotice(null)).toBeNull();
    expect(buildBackupNotice(lectura(0.69))).toBeNull();
    expect(buildBackupNotice(lectura(null))).toBeNull();
    expect(buildBackupNotice(lectura(0.9, "unknown"))).toBeNull();
  });

  it("del 70 % avisa en ámbar", () => {
    const n = buildBackupNotice(lectura(0.72, "warn"))!;
    expect(n.title).toBe("Backups: el plan gratuito va al 72 %");
    expect(n.tone).toBe("warning");
    expect(n.detail).toContain("Al 80 % se pausan las descargas");
    expect(n.action).toEqual({ label: "Ver consumo", module: "ADMIN_BACKUPS", tab: "consumo" });
  });

  it("desde el 80 % (o en pausa) dice que las descargas están pausadas", () => {
    for (const n of [buildBackupNotice(lectura(0.85, "paused"))!, buildBackupNotice(lectura(0.81))!]) {
      expect(n.tone).toBe("danger");
      expect(n.detail).toContain("en pausa");
    }
  });

  it("la firma no cambia con cada punto porcentual, sí al pasar a pausa", () => {
    expect(buildBackupNotice(lectura(0.72))!.signature).toBe(buildBackupNotice(lectura(0.75))!.signature);
    expect(buildBackupNotice(lectura(0.82))!.signature).not.toBe(buildBackupNotice(lectura(0.75))!.signature);
  });
});

// ---------------------------------------------------------------------------
//  Farmacia
// ---------------------------------------------------------------------------

describe("buildPharmacyNotices", () => {
  const fila = (Id_Producto: string, Nombre: string, Lote: string, Fec_Vencim: string, Saldo: string | number): StockRow =>
    ({ Id_Producto, Nombre, Lote, Fec_Vencim, Saldo });
  const filas: StockRow[] = [
    fila("001", "Amoxicilina 500 mg", "L1187", "15/08/2026", "120"),
    fila("001", "Amoxicilina 500 mg", "L1200", "2028-01-31", "50"),
    fila("002", "Paracetamol 500 mg", "P9", "01/09/2026", "1,5"),
    fila("003", "Sales de rehidratación oral", "S1", "10/12/2026", "30"),
    fila("004", "Ibuprofeno 400 mg", "I1", "20/11/2026", 10),
    fila("005", "Clorfenamina 4 mg", "C1", "01/01/2027", "0"),
    fila("006", "Vencido sin saldo", "V0", "01/01/2025", 0),
    fila("007", "Fecha ilegible", "X", "pronto", 5),
  ];
  const build = (rows = filas, lastUpdateAt = ahora.getTime() - DIA, t = umbrales) =>
    buildPharmacyNotices({ rows, lastUpdateAt, thresholds: t, now: ahora });

  it("lotes vencidos con saldo: el más antiguo primero; sin saldo no cuenta", () => {
    const n = byId(build(), "lotes-vencidos")!;
    expect(n.title).toBe("2 lotes vencidos todavía en stock");
    expect(n.detail).toBe("Amoxicilina 500 mg (L1187) y 1 más");
    expect(n.tone).toBe("danger");
    expect(n.action.module).toBe("IPRESS_STOCK");
  });

  it("lotes por vencer dentro de la ventana, con el más próximo", () => {
    const n = byId(build(), "lotes-por-vencer")!;
    // 20/11/2026 y 10/12/2026 entran en 90 días; 01/01/2027 no tiene saldo.
    expect(n.title).toBe("2 lotes vencen en los próximos 90 días");
    expect(n.detail).toBe("El primero: Ibuprofeno 400 mg, 11/2026");
    expect(n.tone).toBe("warning");
  });

  it("la ventana es configurable", () => {
    const n = byId(build(filas, ahora.getTime(), { staleDays: 3, expiryDays: 60 }), "lotes-por-vencer")!;
    expect(n.title).toBe("1 lote vence en los próximos 60 días");
    expect(byId(build(filas, ahora.getTime(), { staleDays: 3, expiryDays: 7 }), "lotes-por-vencer")).toBeUndefined();
  });

  it("medicamentos sin stock: el producto suma cero en todas sus filas", () => {
    const n = byId(build(), "sin-stock")!;
    expect(n.title).toBe("2 medicamentos sin stock");
    expect(n.detail).toBe("Clorfenamina 4 mg y 1 más");
    expect(n.tone).toBe("neutral");
  });

  it("stock propio sin actualizar después del umbral", () => {
    expect(byId(build(filas, ahora.getTime() - 2 * DIA), "mi-stock-sin-actualizar")).toBeUndefined();
    const n = byId(build(filas, ahora.getTime() - 4.2 * DIA), "mi-stock-sin-actualizar")!;
    expect(n.title).toBe("Tu stock no se actualiza hace 4 días");
    expect(n.detail).toBe("Revisa que el Sync SISMED esté encendido en la PC de farmacia");
    expect(byId(build(filas, 0), "mi-stock-sin-actualizar")).toBeUndefined();
  });

  it("la firma del stock viejo no cambia con cada día que pasa", () => {
    const at = ahora.getTime() - 4 * DIA;
    const a = buildPharmacyNotices({ rows: [], lastUpdateAt: at, thresholds: umbrales, now: ahora });
    const b = buildPharmacyNotices({ rows: [], lastUpdateAt: at, thresholds: umbrales, now: new Date(ahora.getTime() + DIA) });
    expect(a[0].signature).toBe(b[0].signature);
    expect(b[0].title).toBe("Tu stock no se actualiza hace 5 días");
  });

  it("al retirar los vencidos y reponer, los avisos desaparecen", () => {
    const limpias = [fila("001", "Amoxicilina 500 mg", "L1200", "2028-01-31", "50")];
    expect(build(limpias, ahora.getTime())).toEqual([]);
  });
});

describe("parseUpdateTimestamp", () => {
  it("entiende dd/mm/aaaa hh:mm:ss e ISO; lo demás es 0", () => {
    expect(parseUpdateTimestamp("03/10/2026 08:05:00")).toBe(new Date("2026-10-03T08:05:00").getTime());
    expect(parseUpdateTimestamp("3/10/2026 8:05")).toBe(new Date("2026-10-03T08:05").getTime());
    expect(parseUpdateTimestamp("2026-10-01T10:00:00Z")).toBe(Date.parse("2026-10-01T10:00:00Z"));
    expect(parseUpdateTimestamp("")).toBe(0);
    expect(parseUpdateTimestamp("ayer")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
//  Visto / sin ver
// ---------------------------------------------------------------------------

describe("visto y distintivo", () => {
  const aviso = (id: Notice["id"], signature: string): Notice => ({
    id, source: "claves", tone: "info", icon: "settings", title: id, detail: "", action: { label: "Ver", module: "ADMIN_SEND_KEYS" }, signature,
  });

  it("cuenta los no vistos y deja de contarlos al marcarlos", () => {
    const lista = [aviso("claves-bloqueadas", "a"), aviso("sismed-antiguo", "b")];
    expect(unseenCount(lista, EMPTY_MEMORY)).toBe(2);
    const vista = markSeen(EMPTY_MEMORY, lista);
    expect(unseenCount(lista, vista)).toBe(0);
    expect(isUnseen(lista[0], vista)).toBe(false);
  });

  it("abrir un aviso marca solo ese y baja el contador en uno", () => {
    const lista = [aviso("claves-bloqueadas", "a"), aviso("sismed-antiguo", "b"), aviso("toolkit-desactualizado", "c")];
    const vista = markSeen(EMPTY_MEMORY, [lista[1]]);
    expect(unseenCount(lista, vista)).toBe(2);
    expect(isUnseen(lista[1], vista)).toBe(false);
    expect(isUnseen(lista[0], vista)).toBe(true);
  });

  it("vuelve a contar solo si aparece algo nuevo, no si se resolvió algo", () => {
    const firma = (...items: string[]) => itemsSignature(items);
    const vista = markSeen(EMPTY_MEMORY, [aviso("stock-sin-actualizar", firma("3d:a", "3d:b"))]);
    expect(isUnseen(aviso("stock-sin-actualizar", firma("3d:b", "3d:a")), vista)).toBe(false);
    // Uno se puso al día: la lista se acorta y el aviso sigue visto.
    expect(isUnseen(aviso("stock-sin-actualizar", firma("3d:a")), vista)).toBe(false);
    // Otro establecimiento se quedó sin actualizar: vuelve a contar.
    expect(isUnseen(aviso("stock-sin-actualizar", firma("3d:a", "3d:c")), vista)).toBe(true);
  });


  it("el distintivo se oculta en 0 y muestra 9+ por encima de 9", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
  });

  it("recuerda desde cuándo está cada aviso y olvida los resueltos, salvo los de una fuente caída", () => {
    let m = trackSince(EMPTY_MEMORY, [aviso("claves-bloqueadas", "a"), aviso("lotes-vencidos", "x")], 1000);
    expect(m.since).toEqual({ "claves-bloqueadas": 1000, "lotes-vencidos": 1000 });
    m = trackSince(m, [aviso("claves-bloqueadas", "b")], 5000);
    expect(m.since).toEqual({ "claves-bloqueadas": 1000 });
    m = trackSince(m, [], 9000, (id) => id === "claves-bloqueadas");
    expect(m.since).toEqual({ "claves-bloqueadas": 1000 });
  });

  describe("almacenamiento por usuario", () => {
    beforeEach(() => {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });
    });

    it("guarda y lee lo visto de cada usuario por separado", () => {
      saveNoticeMemory("farm", { seen: { "sin-stock": "1" }, since: { "sin-stock": 5 } });
      expect(loadNoticeMemory("farm").seen).toEqual({ "sin-stock": "1" });
      expect(loadNoticeMemory("info")).toEqual(EMPTY_MEMORY);
    });

    it("si el almacenamiento falla o tiene basura, sigue sin error", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => { throw new Error("bloqueado"); },
        setItem: () => { throw new Error("bloqueado"); },
      });
      expect(loadNoticeMemory("farm")).toEqual(EMPTY_MEMORY);
      expect(() => saveNoticeMemory("farm", EMPTY_MEMORY)).not.toThrow();
      vi.stubGlobal("localStorage", { getItem: () => "{no es json" });
      expect(loadNoticeMemory("farm")).toEqual(EMPTY_MEMORY);
    });
  });
});

describe("noticeWhen", () => {
  it("dice el tiempo en palabras", () => {
    expect(noticeWhen(ahora.getTime() - 20 * 1000, ahora)).toBe("ahora");
    expect(noticeWhen(ahora.getTime() - 25 * 60000, ahora)).toBe("hace 25 min");
    expect(noticeWhen(ahora.getTime() - 3 * 3600000, ahora)).toBe("hace 3 h");
    expect(noticeWhen(new Date("2026-10-02T09:00:00").getTime(), ahora)).toBe("ayer");
    expect(noticeWhen(new Date("2026-09-29T09:00:00").toISOString(), ahora)).toBe("hace 4 días");
    expect(noticeWhen(null, ahora)).toBe("");
  });
});
