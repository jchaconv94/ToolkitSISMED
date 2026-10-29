import localforage from "localforage";
import type { SourceData } from "./guidesReviewLoad";

/**
 * De dónde lee Revisión de guías: la carpeta DATOS de cada SISMED (Chrome y Edge, con
 * `showDirectoryPicker`) o los archivos subidos. La carpeta elegida se recuerda en este
 * equipo (IndexedDB, por usuario) para no elegirla cada vez; el navegador puede volver a
 * pedir permiso para leerla, y eso necesita un clic de la persona.
 *
 * Cada lectura buena se guarda además como copia (ver `saveCopy`): la revisión de un mes dura
 * varios días y la carpeta del almacén suele estar en otra PC de la red, que pueden apagar.
 */

export type SourceKind = "warehouse" | "ici";

export const SOURCE_FILES: Record<SourceKind, { required: string[]; optional: string[] }> = {
  warehouse: { required: ["TMOVIM.DBF", "TMOVIMDET.DBF"], optional: ["MALMACEN.DBF", "MPRODUCTO.DBF"] },
  ici: { required: ["TFORMDET.DBF"], optional: [] },
};

/** Archivos encontrados por nombre en mayúsculas («TMOVIM.DBF»). */
export type SourceFiles = Record<string, File>;

type FileHandle = { kind: "file"; name: string; getFile: () => Promise<File> };
type DirHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterable<FileHandle | DirHandle>;
  queryPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  isSameEntry?: (other: DirHandle) => Promise<boolean>;
};
export type FolderHandle = DirHandle;

export const folderPickerSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

const store = localforage.createInstance({ name: "toolkit-sismed", storeName: "revision-guias", driver: localforage.INDEXEDDB });
const folderKey = (user: string, kind: SourceKind) => `carpeta:${user || "anon"}:${kind}`;

/** Elige la carpeta (necesita un clic). Devuelve null si la persona cancela. */
export const pickFolder = async (kind: SourceKind): Promise<FolderHandle | null> => {
  if (!folderPickerSupported()) return null;
  try {
    return await (window as unknown as { showDirectoryPicker: (o: object) => Promise<FolderHandle> }).showDirectoryPicker({ id: `sismed-${kind}`, mode: "read" });
  } catch {
    return null;
  }
};

/** Recuerda la carpeta cuando se leyó bien: una que dio error no reemplaza a la anterior. */
export const rememberFolder = async (user: string, kind: SourceKind, handle: FolderHandle) => {
  try {
    await store.setItem(folderKey(user, kind), handle);
  } catch {
    /* sin almacenamiento: se usa igual, solo no se recuerda */
  }
};

export const savedFolder = async (user: string, kind: SourceKind): Promise<FolderHandle | null> => {
  if (!folderPickerSupported()) return null;
  try {
    return (await store.getItem<FolderHandle>(folderKey(user, kind))) || null;
  } catch {
    return null;
  }
};

export const forgetFolder = async (user: string, kind: SourceKind) => {
  try {
    await store.removeItem(folderKey(user, kind));
  } catch {
    /* nada que olvidar */
  }
};

/** ¿Se puede leer la carpeta? Con `ask`, pide el permiso (solo dentro de un clic). */
export const folderPermission = async (handle: FolderHandle, ask: boolean): Promise<PermissionState> => {
  try {
    const state = handle.queryPermission ? await handle.queryPermission({ mode: "read" }) : "granted";
    if (state === "granted" || !ask || !handle.requestPermission) return state;
    return await handle.requestPermission({ mode: "read" });
  } catch {
    return "denied";
  }
};

const wanted = (kind: SourceKind) => [...SOURCE_FILES[kind].required, ...SOURCE_FILES[kind].optional];

/** ¿Son la misma carpeta? (por ejemplo, la del ICI elegida también para el almacén). */
export const sameFolder = async (a: FolderHandle | null, b: FolderHandle | null) => {
  if (!a || !b || !a.isSameEntry) return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
};

/** Qué archivos obligatorios faltan. */
export const missingFiles = (kind: SourceKind, files: SourceFiles) => SOURCE_FILES[kind].required.filter((name) => !files[name]);

/**
 * Busca los archivos en la carpeta elegida o, si tiene una subcarpeta DATOS con ellos, en DATOS
 * (por si se eligió la carpeta del SISMED en vez de DATOS). Sin distinguir mayúsculas.
 */
export const filesFromFolder = async (handle: FolderHandle, kind: SourceKind): Promise<SourceFiles> => {
  const names = new Set(wanted(kind));
  const collect = async (dir: DirHandle) => {
    const found: SourceFiles = {};
    let datos: DirHandle | null = null;
    for await (const entry of dir.values()) {
      const upper = entry.name.toUpperCase();
      if (entry.kind === "file" && names.has(upper)) found[upper] = await entry.getFile();
      else if (entry.kind === "directory" && upper === "DATOS") datos = entry;
    }
    return { found, datos };
  };
  const top = await collect(handle);
  if (!top.datos) return top.found;
  // DATOS es donde el SISMED guarda sus tablas: si tiene los archivos, manda ella, aunque la
  // carpeta de arriba tenga otros con el mismo nombre (copias viejas o vacías).
  const inner = await collect(top.datos);
  if (!missingFiles(kind, inner.found).length) return inner.found;
  return missingFiles(kind, inner.found).length < missingFiles(kind, top.found).length ? inner.found : top.found;
};

/** Reconoce los archivos subidos por su nombre (TMOVIM.DBF, tmovimdet.dbf…). */
export const filesFromList = (list: Iterable<File>, kind: SourceKind): SourceFiles => {
  const names = new Set(wanted(kind));
  const found: SourceFiles = {};
  for (const file of list) {
    const upper = file.name.toUpperCase();
    if (names.has(upper)) found[upper] = file;
  }
  return found;
};

/** Archivos que se leen de cada SISMED, para decirlos en los avisos. */
const list = (names: string[]) => names.join(", ").replace(/, ([^,]*)$/, " y $1");
export const SOURCE_NAME: Record<SourceKind, string> = { warehouse: "SISMED del almacén", ici: "SISMED del ICI" };

/**
 * Qué está mal en los archivos subidos (`null` si están los obligatorios). El cuadro de subir
 * deja elegir cualquier archivo; aquí se dice cuáles van: los de la otra tarjeta, otros archivos
 * o uno de los dos que falta.
 */
export const uploadProblem = (kind: SourceKind, names: string[]): string | null => {
  const upper = names.map((name) => name.toUpperCase());
  const own = new Set(wanted(kind));
  const found = upper.filter((name) => own.has(name));
  const missing = SOURCE_FILES[kind].required.filter((name) => !found.includes(name));
  if (!missing.length) return null;
  const other: SourceKind = kind === "warehouse" ? "ici" : "warehouse";
  const misplaced = upper.filter((name) => !own.has(name) && wanted(other).includes(name));
  const required = list(SOURCE_FILES[kind].required);
  if (!found.length && misplaced.length) {
    return `${list(misplaced)} ${misplaced.length === 1 ? "es" : "son"} del ${SOURCE_NAME[other]}: ${misplaced.length === 1 ? "súbalo" : "súbalos"} en su tarjeta. Aquí va${SOURCE_FILES[kind].required.length === 1 ? "" : "n"} ${required} del ${SOURCE_NAME[kind]}.`;
  }
  if (!found.length) {
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
    return `${shown} no ${names.length === 1 ? "es" : "son"} de los archivos que se leen. Elija ${required} de la carpeta DATOS del ${SOURCE_NAME[kind]}.`;
  }
  const one = missing.length === 1;
  return `Falta${one ? "" : "n"} ${list(missing)}: ${one ? "elíjalo" : "elíjalos"} junto con ${list(found)} (se pueden marcar varios archivos a la vez con Ctrl).`;
};

/**
 * Copia de lo leído (2026-10-29, pedido del usuario): la revisión de un mes dura varios días y
 * la carpeta del almacén suele estar en otra PC de la red, que pueden apagar. Cada lectura buena
 * se guarda en este equipo (IndexedDB, por usuario): lo leído de los DBF, no los archivos (el
 * almacén de un año ocupa unos 3,5 MB; el TFORMDET leído, mucho menos que el archivo). Al abrir
 * el módulo se revisa con ella y se intenta leer la carpeta; si no responde, se sigue con la copia.
 *
 * Si cambia lo que se lee de los DBF (`readWarehouse`, `readIci`), subir COPY_VERSION: la copia
 * vieja se descarta y se vuelve a leer la carpeta.
 */
export const COPY_VERSION = 1;

export interface SourceCopy {
  version: number;
  data: SourceData;
  /** Cuándo se leyó del SISMED (ms). */
  readAt: number;
  /** Nombre, tamaño y fecha de los archivos leídos: si no cambiaron, no se vuelven a leer. */
  stamp: string;
  origin: "folder" | "files";
}

const copyKey = (user: string, kind: SourceKind) => `copia:${user || "anon"}:${kind}`;

export const saveCopy = async (user: string, kind: SourceKind, copy: Omit<SourceCopy, "version">) => {
  try {
    await store.setItem(copyKey(user, kind), { ...copy, version: COPY_VERSION });
    // Que el navegador no la borre para liberar espacio (lo concede según el uso del sitio).
    void navigator.storage?.persist?.().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};

export const loadCopy = async (user: string, kind: SourceKind): Promise<SourceCopy | null> => {
  try {
    const copy = await store.getItem<SourceCopy>(copyKey(user, kind));
    return copy && copy.version === COPY_VERSION && copy.data?.kind === kind ? copy : null;
  } catch {
    return null;
  }
};
