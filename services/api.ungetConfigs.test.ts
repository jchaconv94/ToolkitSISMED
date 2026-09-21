/**
 * `saveUngetConfigs` contra una base simulada.
 *
 * Las reglas sueltas —quién puede editar, cuándo se adopta— ya están probadas en
 * `ungetConnections.test.ts`. Lo que falta es lo que de verdad falló dos veces: que al
 * guardar se escriba en la base exactamente lo que se espera y nada más. Los dos defectos
 * que esto habría atrapado:
 *
 *  - decir «Eliminado correctamente» sin borrar ninguna fila;
 *  - quedarse de responsable de conexiones ajenas por el mero hecho de aparecer en el
 *    envío al guardar otra cosa.
 *
 * Se simula el cliente de Supabase con el mínimo encadenamiento que usa `api.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Fila {
  id: string;
  username: string | null;
  unget_name: string;
  url: string;
  unget_id: string | null;
  spreadsheet_id?: string | null;
}

let filas: Fila[] = [];
/** Lo que el guardado escribió, en orden, para poder afirmar sobre ello. */
let escrituras: Array<{ tipo: "update" | "insert" | "delete"; detalle: any }> = [];

const coincide = (fila: Fila, filtros: Array<[string, any]>, dentroDe: Array<[string, any[]]>) =>
  filtros.every(([campo, valor]) => (fila as any)[campo] === valor) &&
  dentroDe.every(([campo, valores]) => valores.includes((fila as any)[campo]));

/** Constructor de consultas mínimo: `select`/`update`/`delete` con `.eq()` y `.in()`. */
const tabla = () => {
  const filtros: Array<[string, any]> = [];
  const dentroDe: Array<[string, any[]]> = [];
  let operacion: "select" | "update" | "delete" | "insert" = "select";
  let valores: any = null;

  const consulta: any = {
    select(_columnas?: string) {
      operacion = "select";
      return consulta;
    },
    update(datos: any) {
      operacion = "update";
      valores = datos;
      return consulta;
    },
    delete() {
      operacion = "delete";
      return consulta;
    },
    insert(datos: any) {
      const nueva: Fila = {
        id: `nueva-${filas.length + 1}`,
        username: datos.username ?? null,
        unget_name: datos.unget_name || "",
        url: datos.url || "",
        unget_id: datos.unget_id ?? null,
        spreadsheet_id: datos.spreadsheet_id ?? null,
      };
      filas.push(nueva);
      escrituras.push({ tipo: "insert", detalle: { ...datos } });
      return Promise.resolve({ data: [nueva], error: null });
    },
    eq(campo: string, valor: any) {
      filtros.push([campo, valor]);
      return consulta.then ? consulta : consulta;
    },
    in(campo: string, lista: any[]) {
      dentroDe.push([campo, lista]);
      return consulta;
    },
    then(resolver: any, rechazar?: any) {
      const afectadas = filas.filter((f) => coincide(f, filtros, dentroDe));
      if (operacion === "update") {
        afectadas.forEach((fila) => {
          escrituras.push({ tipo: "update", detalle: { id: fila.id, ...valores } });
          Object.assign(fila, valores);
        });
      } else if (operacion === "delete") {
        afectadas.forEach((fila) => escrituras.push({ tipo: "delete", detalle: { id: fila.id } }));
        filas = filas.filter((f) => !afectadas.includes(f));
      }
      return Promise.resolve({ data: afectadas.map((f) => ({ ...f })), error: null }).then(
        resolver,
        rechazar,
      );
    },
  };
  return consulta;
};

// Las pruebas corren en Node. `saveUngetConfigs` termina dejando copia local, así que
// hace falta un `localStorage` mínimo.
const almacen = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, String(v)),
  removeItem: (k: string) => void almacen.delete(k),
  clear: () => almacen.clear(),
};

vi.mock("./supabaseClient", () => ({
  supabase: { from: () => tabla() },
  SESSION_TOKEN_KEY: "aura_session_token",
  requireSessionToken: () => "token-de-prueba",
}));

const { api } = await import("./api");

const conexion = (over: Partial<Fila> & { unget_id: string }): Fila => ({
  id: `f-${over.unget_id}`,
  username: null,
  unget_name: over.unget_id.toUpperCase(),
  url: `https://script.google.com/${over.unget_id}`,
  spreadsheet_id: null,
  ...over,
});

/** Lo que la pantalla manda: la conexión reclamada lleva el nombre de quien guarda. */
const comoLaMandaLaPantalla = (fila: Fila, reclamadaPor?: string) => ({
  name: fila.unget_name,
  url: fila.url,
  ungetId: fila.unget_id,
  username: reclamadaPor ?? fila.username,
});

beforeEach(() => {
  filas = [];
  escrituras = [];
  localStorage.clear();
});

describe("saveUngetConfigs: qué se escribe de verdad", () => {
  it("no toca la conexión de un informático en activo, aunque viaje en el envío", async () => {
    const ajena = conexion({ unget_id: "u-picota", username: "inf.picota" });
    filas = [ajena];

    await api.saveUngetConfigs("admin", [comoLaMandaLaPantalla(ajena)], {
      orphanOwners: [],
      visibleUngetIds: ["u-picota"],
    });

    expect(filas[0].username).toBe("inf.picota");
    expect(escrituras.some((e) => e.tipo === "delete")).toBe(false);
    expect(escrituras.filter((e) => e.tipo === "update").every((e) => !("username" in e.detalle))).toBe(true);
  });

  it("adopta la conexión sin responsable que se reclama", async () => {
    const huerfana = conexion({ unget_id: "u-picota", username: "inf.quesefue" });
    filas = [huerfana];

    await api.saveUngetConfigs("inf.nuevo", [comoLaMandaLaPantalla(huerfana, "inf.nuevo")], {
      orphanOwners: ["inf.quesefue"],
      visibleUngetIds: ["u-picota"],
    });

    expect(filas[0].username).toBe("inf.nuevo");
  });

  it("no adopta la huérfana que solo pasaba por ahí al guardar otra cosa", async () => {
    // El caso del PR #55: se da de alta Tocache y en el envío viaja Picota, huérfana.
    const huerfana = conexion({ unget_id: "u-picota", username: "inf.quesefue" });
    const propia = conexion({ unget_id: "u-tocache", username: "admin" });
    filas = [huerfana, propia];

    await api.saveUngetConfigs(
      "admin",
      [comoLaMandaLaPantalla(huerfana), comoLaMandaLaPantalla(propia, "admin")],
      { orphanOwners: ["inf.quesefue"], visibleUngetIds: ["u-picota", "u-tocache"] },
    );

    expect(filas.find((f) => f.unget_id === "u-picota")?.username).toBe("inf.quesefue");
  });

  it("borra de verdad la conexión propia que se quitó de la lista", async () => {
    // El defecto del #53: la pantalla decía «Eliminado correctamente» y no borraba nada.
    const propia = conexion({ unget_id: "u-tocache", username: "admin" });
    const otra = conexion({ unget_id: "u-picota", username: "admin" });
    filas = [propia, otra];

    await api.saveUngetConfigs("admin", [comoLaMandaLaPantalla(otra, "admin")], {
      orphanOwners: [],
      visibleUngetIds: ["u-tocache", "u-picota"],
    });

    expect(filas.map((f) => f.unget_id)).toEqual(["u-picota"]);
  });

  it("borra la huérfana que se quitó, y solo dentro de lo que el usuario ve", async () => {
    const huerfanaALaVista = conexion({ unget_id: "u-picota", username: "inf.quesefue" });
    const huerfanaDeOtraJurisdiccion = conexion({ unget_id: "u-lejana", username: "inf.quesefue" });
    filas = [huerfanaALaVista, huerfanaDeOtraJurisdiccion];

    await api.saveUngetConfigs("admin", [], {
      orphanOwners: ["inf.quesefue"],
      visibleUngetIds: ["u-picota"],
    });

    // La de su jurisdicción se retira; la que no ve no se toca.
    expect(filas.map((f) => f.unget_id)).toEqual(["u-lejana"]);
  });

  it("sin las listas de adopción se comporta como siempre: solo lo propio", async () => {
    const huerfana = conexion({ unget_id: "u-picota", username: "inf.quesefue" });
    filas = [huerfana];

    await api.saveUngetConfigs("admin", []);

    expect(filas).toHaveLength(1);
    expect(filas[0].username).toBe("inf.quesefue");
  });

  it("da de alta una conexión nueva a nombre de quien la crea", async () => {
    await api.saveUngetConfigs(
      "admin",
      [{ name: "TOCACHE", url: "https://script.google.com/t", ungetId: "u-tocache", username: "admin" }],
      { orphanOwners: [], visibleUngetIds: [] },
    );

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ username: "admin", unget_id: "u-tocache" });
  });
});
