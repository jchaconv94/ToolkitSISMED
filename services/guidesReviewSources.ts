import localforage from "localforage";

/**
 * De dónde lee Revisión de guías: la carpeta DATOS de cada SISMED (Chrome y Edge, con
 * `showDirectoryPicker`) o los archivos subidos. La carpeta elegida se recuerda en este
 * equipo (IndexedDB, por usuario) para no elegirla cada vez; el navegador puede volver a
 * pedir permiso para leerla, y eso necesita un clic de la persona.
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
export const pickFolder = async (user: string, kind: SourceKind): Promise<FolderHandle | null> => {
  if (!folderPickerSupported()) return null;
  let handle: FolderHandle;
  try {
    handle = (await (window as unknown as { showDirectoryPicker: (o: object) => Promise<FolderHandle> }).showDirectoryPicker({ id: `sismed-${kind}`, mode: "read" }));
  } catch {
    return null;
  }
  try {
    await store.setItem(folderKey(user, kind), handle);
  } catch {
    /* sin almacenamiento: se usa igual, solo no se recuerda */
  }
  return handle;
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
