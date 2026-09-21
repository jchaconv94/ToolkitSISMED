import { describe, it, expect } from "vitest";
import {
  assignmentBelongsToConnection,
  canEditConnection,
  buildUngetConnectionStatus,
  cachedSourcesStillMatch,
  connectionOwner,
  connectionsToRetire,
  describeConnectionMode,
  isConnectionOrphaned,
  isVirtualSheetUrl,
  normalizeUngetName,
  pickOneConnectionPerUnget,
  ungetConnectionKey,
  ungetConnectionKeys,
} from "./ungetConnections";

const esVirtual = (url?: string) => String(url || "").startsWith("sheets://");

describe("normalizeUngetName", () => {
  it("iguala las variantes con las que se escribió la misma UNGET", () => {
    expect(normalizeUngetName("Bellavista")).toBe(normalizeUngetName("BELLAVISTA"));
    expect(normalizeUngetName("Mariscal Cáceres")).toBe(normalizeUngetName("MARICAL C."));
    expect(normalizeUngetName("UNGET San Martin")).toBe(normalizeUngetName("San Martín"));
    expect(normalizeUngetName("")).toBe("");
  });

  it("no confunde UNGET distintas", () => {
    expect(normalizeUngetName("El Dorado")).not.toBe(normalizeUngetName("Tocache"));
  });
});

describe("ungetConnectionKey", () => {
  it("agrupa por identificador oficial cuando lo hay", () => {
    expect(ungetConnectionKey({ name: "Bellavista", ungetId: "u-1" })).toBe("id:u-1");
    expect(ungetConnectionKey({ name: "BELLAVISTA", ungetId: "u-1" })).toBe("id:u-1");
  });

  it("cae al nombre cuando la fila todavía no tiene identificador", () => {
    expect(ungetConnectionKey({ name: "Bellavista" })).toBe(ungetConnectionKey({ name: "BELLAVISTA" }));
  });
});

describe("pickOneConnectionPerUnget", () => {
  // Caso real del 18/09/2026: 15 filas para 7 UNGET, y solo la de admin tenía hoja.
  const bellavistaAdmin = { name: "Bellavista", ungetId: "u-1", username: "admin", spreadsheetId: "LIBRO_A" };
  const bellavistaLocal = { name: "BELLAVISTA", ungetId: "u-1", username: "bellavista", url: "https://script.google.com/x" };

  const contexto = {
    currentUsername: "admin",
    ungetIdByUsername: { bellavista: "u-1", admin: undefined, sanmartin: "u-2", cfrio: "u-2" },
  };

  it("deja una sola conexión por UNGET", () => {
    const elegidas = pickOneConnectionPerUnget([bellavistaAdmin, bellavistaLocal], contexto);
    expect(elegidas).toHaveLength(1);
  });

  it("prefiere la que tiene hoja, porque es la que lee directo", () => {
    expect(pickOneConnectionPerUnget([bellavistaLocal, bellavistaAdmin], contexto)[0]).toBe(bellavistaAdmin);
    expect(pickOneConnectionPerUnget([bellavistaAdmin, bellavistaLocal], contexto)[0]).toBe(bellavistaAdmin);
  });

  it("sin hoja de por medio, se queda la del informático de esa UNGET", () => {
    const deAdmin = { name: "San Martin", ungetId: "u-2", username: "admin" };
    const delInformatico = { name: "San Martín", ungetId: "u-2", username: "sanmartin" };
    expect(pickOneConnectionPerUnget([deAdmin, delInformatico], contexto)[0]).toBe(delInformatico);
    expect(pickOneConnectionPerUnget([delInformatico, deAdmin], contexto)[0]).toBe(delInformatico);
  });

  it("conserva el orden de aparición y no toca las UNGET distintas", () => {
    const tocache = { name: "Tocache", ungetId: "u-3", username: "mirian" };
    const elegidas = pickOneConnectionPerUnget([tocache, bellavistaAdmin, bellavistaLocal], contexto);
    expect(elegidas.map((c) => c.name)).toEqual(["Tocache", "Bellavista"]);
  });

  it("agrupa aunque las filas todavía no tengan identificador", () => {
    const sinId = [
      { name: "Huallaga", username: "huallaga", url: "https://script.google.com/h" },
      { name: "HUALLAGA", username: "admin" },
    ];
    expect(pickOneConnectionPerUnget(sinId, contexto)).toHaveLength(1);
  });

  it("no se cae con una lista vacía o con huecos", () => {
    expect(pickOneConnectionPerUnget([], contexto)).toEqual([]);
    expect(pickOneConnectionPerUnget([null as any, bellavistaAdmin], contexto)).toHaveLength(1);
  });
});

describe("describeConnectionMode", () => {
  it("distingue lectura directa, Apps Script y sin hoja", () => {
    expect(describeConnectionMode({ name: "A", spreadsheetId: "LIBRO" }, esVirtual)).toBe("directa");
    expect(describeConnectionMode({ name: "B", url: "https://script.google.com/x" }, esVirtual)).toBe("apps-script");
    expect(describeConnectionMode({ name: "C", url: "sheets://LIBRO" }, esVirtual)).toBe("sin-hoja");
    expect(describeConnectionMode({ name: "D" }, esVirtual)).toBe("sin-hoja");
  });
});

describe("isVirtualSheetUrl", () => {
  it("reconoce la marca de lectura directa", () => {
    expect(isVirtualSheetUrl("sheets://LIBRO")).toBe(true);
    expect(isVirtualSheetUrl("https://script.google.com/x")).toBe(false);
    expect(isVirtualSheetUrl(undefined)).toBe(false);
    expect(isVirtualSheetUrl(null)).toBe(false);
  });
});

describe("buildUngetConnectionStatus", () => {
  const ungets = [
    { id: "u-1", name: "Bellavista" },
    { id: "u-2", name: "Tocache" },
    { id: "u-3", name: "El Dorado" },
  ];

  it("distingue lectura directa, Apps Script y UNGET sin nadie que la haya configurado", () => {
    const estados = buildUngetConnectionStatus(ungets, [
      { name: "Bellavista", ungetId: "u-1", username: "bellavista", spreadsheetId: "LIBRO_B" },
      { name: "Tocache", ungetId: "u-2", username: "mirian", url: "https://script.google.com/t" },
    ]);

    expect(estados.get("u-1")?.state).toBe("directa");
    expect(estados.get("u-2")?.state).toBe("apps-script");
    // Es lo que esta vista viene a resolver: antes no aparecía en ningún lado.
    expect(estados.get("u-3")?.state).toBe("sin-conexion");
  });

  it("dice quién mantiene la conexión", () => {
    const estados = buildUngetConnectionStatus(ungets, [
      { name: "Bellavista", ungetId: "u-1", username: "bellavista", spreadsheetId: "LIBRO_B" },
    ]);
    expect(estados.get("u-1")?.maintainer).toBe("bellavista");
    expect(estados.get("u-3")?.maintainer).toBeUndefined();
  });

  it("empareja por nombre mientras la fila no tenga identificador", () => {
    const estados = buildUngetConnectionStatus(ungets, [
      { name: "BELLAVISTA", username: "admin", url: "https://script.google.com/b" },
    ]);
    expect(estados.get("u-1")?.state).toBe("apps-script");
  });

  it("con varias filas de la misma UNGET manda la que tiene hoja", () => {
    // El caso real: el enlace estaba en la fila de `admin` y la lista mostraba la otra.
    const estados = buildUngetConnectionStatus(ungets, [
      { name: "Bellavista", ungetId: "u-1", username: "bellavista", url: "https://script.google.com/b" },
      { name: "BELLAVISTA", username: "admin", spreadsheetId: "LIBRO_B" },
    ]);
    expect(estados.get("u-1")?.state).toBe("directa");
    expect(estados.get("u-1")?.maintainer).toBe("admin");
  });

  it("una conexión configurada con un nombre que no está registrado no ensucia a nadie", () => {
    const estados = buildUngetConnectionStatus(ungets, [
      { name: "Mariscal Cáceres", username: "admin", spreadsheetId: "LIBRO_M" },
    ]);
    expect(estados.size).toBe(3);
    expect([...estados.values()].every((e) => e.state === "sin-conexion")).toBe(true);
  });

  it("una conexión sin hoja y sin Web App no cuenta como configurada del todo", () => {
    const estados = buildUngetConnectionStatus(ungets, [
      { name: "Tocache", ungetId: "u-2", username: "mirian" },
    ]);
    expect(estados.get("u-2")?.state).toBe("sin-hoja");
  });

  it("no se cae con listas vacías ni con huecos", () => {
    expect(buildUngetConnectionStatus([], []).size).toBe(0);
    expect(buildUngetConnectionStatus(null, null).size).toBe(0);
    expect(buildUngetConnectionStatus([{ id: "", name: "Sin id" }], []).size).toBe(0);
    expect(buildUngetConnectionStatus(ungets, [null as any]).get("u-1")?.state).toBe("sin-conexion");
  });
});

describe("ungetConnectionKeys", () => {
  it("reconoce la UNGET por identificador y por nombre", () => {
    expect(ungetConnectionKeys({ name: "Bellavista", ungetId: "u-1" })).toEqual([
      "id:u-1",
      "nombre:BELLAVISTA",
    ]);
  });

  it("una fila sin identificador todavía se reconoce por el nombre", () => {
    expect(ungetConnectionKeys({ name: "BELLAVISTA" })).toEqual(["nombre:BELLAVISTA"]);
  });

  it("permite descartar una UNGET ya configurada por otro usuario", () => {
    const configurada = new Set(ungetConnectionKeys({ name: "MARICAL C.", username: "MARISCAL" }));
    const candidata = { name: "Mariscal Cáceres", ungetId: "u-9" };
    expect(ungetConnectionKeys(candidata).some((k) => configurada.has(k))).toBe(true);
  });

  it("no descarta una UNGET distinta", () => {
    const configurada = new Set(ungetConnectionKeys({ name: "Tocache" }));
    expect(ungetConnectionKeys({ name: "Picota", ungetId: "u-4" }).some((k) => configurada.has(k))).toBe(false);
  });
});

describe("cachedSourcesStillMatch", () => {
  const huallaga = { name: "Huallaga", ungetId: "u-h" };
  const bellavista = { name: "Bellavista", ungetId: "u-b" };
  const dorado = { name: "El Dorado", ungetId: "u-d" };

  it("la caché sirve si cada posición sigue siendo la misma UNGET", () => {
    expect(cachedSourcesStillMatch([huallaga, bellavista], [huallaga, bellavista])).toBe(true);
    // El nombre puede venir escrito de otra forma; la UNGET es la misma.
    expect(cachedSourcesStillMatch([bellavista], [{ name: "BELLAVISTA", ungetId: "u-b" }])).toBe(true);
  });

  it("no sirve si cambió el orden: es el caso que metió las hojas de Bellavista en Huallaga", () => {
    expect(cachedSourcesStillMatch([bellavista, huallaga], [huallaga, bellavista])).toBe(false);
  });

  it("no sirve si cambió el número de conexiones", () => {
    expect(cachedSourcesStillMatch([huallaga, bellavista, dorado], [huallaga, bellavista])).toBe(false);
    expect(cachedSourcesStillMatch([], [huallaga])).toBe(false);
  });

  it("sin caché previa no hay nada que reutilizar", () => {
    expect(cachedSourcesStillMatch(null, [huallaga])).toBe(false);
    expect(cachedSourcesStillMatch([], [])).toBe(true);
  });
});

describe("connectionsToRetire", () => {
  const mias = [
    { id: 1, ungetId: "u-1", url: "https://script.google.com/bellavista" },
    { id: 2, ungetId: "u-2", url: "sheets://LIBRO_TOCACHE" },
  ];

  it("no retira nada cuando se guardan las mismas conexiones", () => {
    expect(connectionsToRetire(mias, mias)).toEqual([]);
  });

  it("retira la que el usuario quitó de la lista", () => {
    expect(connectionsToRetire(mias, [mias[0]]).map((c) => c.id)).toEqual([2]);
  });

  it("no retira la conexión recién creada que todavía no tiene UNGET", () => {
    // Era el fallo: la fila se insertaba sin `unget_id` y este mismo guardado la borraba,
    // mientras la pantalla decía que se había guardado.
    const recienCreada = { id: 3, ungetId: null, url: "sheets://LIBRO_NUEVO" };
    const guardadas = [...mias, { ungetId: undefined, url: "sheets://LIBRO_NUEVO" }];
    expect(connectionsToRetire([...mias, recienCreada], guardadas)).toEqual([]);
  });

  it("retira la fila anterior al mover una conexión de UNGET conservando el enlace", () => {
    // La URL no puede rescatar una fila que sí tiene UNGET: si lo hiciera, el mismo libro
    // quedaría colgando de la UNGET vieja y de la nueva, y el stock de una se vería en la otra.
    const guardadas = [{ ungetId: "u-9", url: "https://script.google.com/bellavista" }];
    expect(connectionsToRetire(mias, guardadas).map((c) => c.id)).toEqual([1, 2]);
  });

  it("sí retira una fila sin UNGET cuya URL ya no está en la lista", () => {
    const huerfana = { id: 4, ungetId: null, url: "https://script.google.com/vieja" };
    expect(connectionsToRetire([...mias, huerfana], mias).map((c) => c.id)).toEqual([4]);
  });

  it("reconoce la conexión aunque haya cambiado de URL, por su UNGET", () => {
    const guardadas = [{ ungetId: "u-1", url: "sheets://LIBRO_BELLAVISTA" }, mias[1]];
    expect(connectionsToRetire(mias, guardadas)).toEqual([]);
  });

  it("guardar una lista vacía retira todas las propias", () => {
    expect(connectionsToRetire(mias, []).map((c) => c.id)).toEqual([1, 2]);
  });

  it("no se cae con listas nulas ni con huecos", () => {
    expect(connectionsToRetire(null, null)).toEqual([]);
    expect(connectionsToRetire([null as any, mias[0]], [])).toEqual([mias[0]]);
  });
});

describe("canEditConnection", () => {
  it("la conexión es de quien la mantiene", () => {
    expect(canEditConnection({ name: "BELLAVISTA", username: "inf.bellavista" }, "inf.bellavista")).toBe(true);
  });

  it("nadie más la modifica, ni siquiera el admin", () => {
    // Era el caso invisible: el admin pulsaba eliminar, la tarjeta se iba de la pantalla,
    // salía «Eliminado correctamente» y a la siguiente carga volvía.
    expect(canEditConnection({ name: "BELLAVISTA", username: "inf.bellavista" }, "admin")).toBe(false);
  });

  it("una fila sin dueño la adopta quien la guarde", () => {
    expect(canEditConnection({ name: "PICOTA" }, "admin")).toBe(true);
    expect(canEditConnection({ name: "PICOTA", username: "   " }, "admin")).toBe(true);
  });

  it("no se cae con datos incompletos", () => {
    expect(canEditConnection(null, "admin")).toBe(true);
    expect(canEditConnection({ name: "PICOTA", username: "inf" }, undefined)).toBe(false);
    expect(connectionOwner(null)).toBe("");
    expect(connectionOwner({ name: "PICOTA", username: " inf " })).toBe("inf");
  });
});

describe("conexiones sin responsable", () => {
  const activas = new Set(["inf.bellavista", "admin"]);
  const deQuienSeFue = { name: "PICOTA", username: "inf.picota" };

  it("la conexión de una cuenta que ya no está activa queda sin responsable", () => {
    expect(isConnectionOrphaned(deQuienSeFue, activas)).toBe(true);
    expect(canEditConnection(deQuienSeFue, "admin", activas)).toBe(true);
    // Y el nuevo informático de esa UNGET la adopta igual, sin pasar por el admin.
    expect(canEditConnection(deQuienSeFue, "inf.bellavista", activas)).toBe(true);
  });

  it("mientras su cuenta siga activa, la conexión sigue siendo suya", () => {
    const viva = { name: "BELLAVISTA", username: "inf.bellavista" };
    expect(isConnectionOrphaned(viva, activas)).toBe(false);
    expect(canEditConnection(viva, "admin", activas)).toBe(false);
  });

  it("sin censo de cuentas no se declara huérfana a ninguna", () => {
    // Si la lista de usuarios no llegó, lo seguro es no abrir nada: lo contrario
    // convertiría un fallo de red en permiso para editar todas las conexiones.
    expect(isConnectionOrphaned(deQuienSeFue, undefined)).toBe(false);
    expect(isConnectionOrphaned(deQuienSeFue, new Set())).toBe(false);
    expect(canEditConnection(deQuienSeFue, "admin", new Set())).toBe(false);
  });

  it("una fila sin dueño está libre, no huérfana", () => {
    expect(isConnectionOrphaned({ name: "PICOTA" }, activas)).toBe(false);
    expect(canEditConnection({ name: "PICOTA" }, "admin", activas)).toBe(true);
  });
});

describe("assignmentBelongsToConnection", () => {
  const conexion = { ungetId: "u-b", url: "https://script.google.com/bellavista" };

  it("empareja por UNGET aunque la conexión haya cambiado de URL", () => {
    const asignacion = { ungetId: "u-b", sheetUrl: "https://script.google.com/viejo" };
    expect(assignmentBelongsToConnection(asignacion, conexion)).toBe(true);
    // Es el caso que rompía todo: la UNGET pasa a lectura directa.
    expect(assignmentBelongsToConnection(asignacion, { ungetId: "u-b", url: "sheets://LIBRO" })).toBe(true);
  });

  it("no empareja asignaciones de otra UNGET aunque compartan URL", () => {
    expect(assignmentBelongsToConnection({ ungetId: "u-h", sheetUrl: conexion.url }, conexion)).toBe(false);
  });

  it("mientras la asignación no tenga UNGET, se sigue admitiendo la URL", () => {
    expect(assignmentBelongsToConnection({ sheetUrl: conexion.url }, conexion)).toBe(true);
    expect(assignmentBelongsToConnection({ sheetUrl: "https://otra" }, conexion)).toBe(false);
    expect(assignmentBelongsToConnection({ ungetId: "u-b" }, { url: conexion.url })).toBe(false);
  });

  it("no se cae con datos incompletos", () => {
    expect(assignmentBelongsToConnection(null, conexion)).toBe(false);
    expect(assignmentBelongsToConnection({ sheetUrl: "" }, conexion)).toBe(false);
    expect(assignmentBelongsToConnection({ sheetUrl: conexion.url }, null)).toBe(false);
  });
});
