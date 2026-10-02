/**
 * Descarga y guardado de un backup en el navegador (módulo Backups SISMED).
 *
 * - Se baja con `Range`: si se corta la red, se retoma desde el último byte recibido.
 * - Se comprueba la huella SHA-256 antes de guardar: un archivo dañado no se guarda.
 * - Se guarda en la carpeta que eligió la persona (Chrome y Edge) o, si no hay o el navegador
 *   no deja, como descarga normal del navegador.
 */

import { sha256Hex } from "./backupConnection";

const RETRIES = 6;

export class DownloadError extends Error {}

/**
 * Baja `size` bytes de `url`, retomando ante cortes. `onProgress` recibe los bytes acumulados.
 * Un 403/404/410 no se reintenta: el permiso ya no vale o el backup ya no está.
 */
export async function downloadWithResume(
  url: string,
  size: number,
  onProgress: (received: number) => void,
  options: { signal?: AbortSignal; wait?: (ms: number) => Promise<void> } = {},
): Promise<Uint8Array> {
  const wait = options.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const data = new Uint8Array(size);
  let received = 0;
  let failures = 0;
  while (received < size) {
    try {
      const response = await fetch(url, { headers: received ? { Range: `bytes=${received}-` } : {}, signal: options.signal });
      if ([403, 404, 410].includes(response.status)) throw new DownloadError(`El backup ya no está disponible (HTTP ${response.status})`);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      // Si el servidor ignoró el Range y mandó todo desde el principio, se empieza de nuevo.
      if (received && response.status !== 206) received = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > size) throw new DownloadError("El archivo llegó más grande de lo informado");
        data.set(value, received);
        received += value.length;
        failures = 0;
        onProgress(received);
      }
      if (received < size) throw new Error("La conexión se cerró antes de terminar");
    } catch (error) {
      if (error instanceof DownloadError || options.signal?.aborted) throw error;
      failures += 1;
      if (failures > RETRIES) throw new DownloadError(`La descarga se cortó demasiadas veces: ${String((error as Error).message || error)}`);
      await wait(Math.min(16000, 1000 * 2 ** (failures - 1)));
    }
  }
  return data;
}

/** Comprueba tamaño y huella. */
export async function verifyBackup(data: Uint8Array, size: number, sha256: string): Promise<boolean> {
  if (data.byteLength !== size) return false;
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return (await sha256Hex(buffer)) === sha256.toLowerCase();
}

/** Nombre con el que se guarda: el código delante, para no mezclar backups de dos establecimientos. */
export const savedFileName = (code: string, name: string) => `${code}_${name}`;

// --- Carpeta elegida (File System Access API, Chrome y Edge) ----------------------------

type DirectoryHandle = {
  name: string;
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
};

const DB = "toolkit-backups";
const STORE = "carpeta";
const KEY = "destino";

export const folderPickerSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

const withStore = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => open.result.close();
    };
  });

export async function getSaveFolder(): Promise<DirectoryHandle | null> {
  if (!folderPickerSupported()) return null;
  try {
    return ((await withStore("readonly", (s) => s.get(KEY))) as DirectoryHandle | undefined) || null;
  } catch {
    return null;
  }
}

/** Pide la carpeta (necesita un clic de la persona). Devuelve su nombre o null si cancela. */
export async function chooseSaveFolder(): Promise<string | null> {
  if (!folderPickerSupported()) return null;
  try {
    const handle = (await (window as any).showDirectoryPicker({ id: "backups-sismed", mode: "readwrite" })) as DirectoryHandle;
    await withStore("readwrite", (s) => s.put(handle, KEY));
    return handle.name;
  } catch {
    return null;
  }
}

export async function clearSaveFolder(): Promise<void> {
  try { await withStore("readwrite", (s) => s.delete(KEY)); } catch { /* sin almacenamiento */ }
}

/** Pide de nuevo el permiso de escribir en la carpeta (también necesita un clic). */
export async function grantSaveFolder(): Promise<boolean> {
  const handle = await getSaveFolder();
  if (!handle?.requestPermission) return false;
  try { return (await handle.requestPermission({ mode: "readwrite" })) === "granted"; } catch { return false; }
}

const browserDownload = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/**
 * Guarda el archivo. En la carpeta elegida si sigue habiendo permiso; si no, como descarga
 * del navegador. Devuelve dónde quedó y si hace falta volver a dar permiso a la carpeta.
 */
export async function saveBackup(data: Uint8Array, name: string): Promise<{ savedIn: string; needsPermission: boolean }> {
  const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: "application/zip" });
  const folder = await getSaveFolder();
  if (folder) {
    try {
      const state = folder.queryPermission ? await folder.queryPermission({ mode: "readwrite" }) : "granted";
      if (state === "granted") {
        const file = await folder.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(blob);
        await writable.close();
        return { savedIn: folder.name, needsPermission: false };
      }
      browserDownload(blob, name);
      return { savedIn: "Descargas", needsPermission: true };
    } catch {
      // Si la carpeta ya no existe o se movió, el archivo no se pierde: va a Descargas.
    }
  }
  browserDownload(blob, name);
  return { savedIn: "Descargas", needsPermission: false };
}
