/**
 * Acceso rápido: entrar con un PIN de 4 dígitos (PC) o con la huella (celular).
 *
 * Al activarlo, el navegador genera una llave larga al azar y la guarda junto con el id que
 * le da Supabase (`app_device_register`). Para entrar manda esa llave y, si es PIN, el PIN
 * (`app_device_login`). La contraseña nunca se guarda en el equipo.
 * SQL: `supabase/SUPABASE_INGRESO_PIN_HUELLA.sql`.
 */

export type DeviceKind = "pin" | "huella";

export interface StoredDevice {
  id: string;
  secret: string;
  kind: DeviceKind;
  username: string;
  /** Nombre con el que se saluda en el login («Hola, Jordan»). */
  displayName: string;
  /** Solo huella: id de la credencial del lector del celular (base64url). */
  credentialId?: string;
}

export type DeviceLoginReason = "equipo" | "bloqueado" | "pin" | "usuario";

export type DeviceLoginResult =
  | { ok: true; token: string; username: string }
  | { ok: false; reason: DeviceLoginReason; remaining?: number };

export interface DeviceInfo {
  id: string;
  kind: DeviceKind;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  locked: boolean;
}

const STORAGE_KEY = "toolkit_acceso_rapido";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const defaultStore = (): KeyValueStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** El equipo guardado en este navegador, si tiene la forma esperada. */
export const readStoredDevice = (store: KeyValueStore | null = defaultStore()): StoredDevice | null => {
  if (!store) return null;
  try {
    const raw = JSON.parse(store.getItem(STORAGE_KEY) || "null");
    if (
      raw &&
      typeof raw.id === "string" &&
      typeof raw.secret === "string" &&
      raw.secret.length >= 32 &&
      (raw.kind === "pin" || raw.kind === "huella") &&
      typeof raw.username === "string" &&
      raw.username
    ) {
      // La huella necesita además la credencial del lector; sin ella no sirve.
      if (raw.kind === "huella" && (typeof raw.credentialId !== "string" || !raw.credentialId)) return null;
      return {
        id: raw.id,
        secret: raw.secret,
        kind: raw.kind,
        username: raw.username,
        displayName: String(raw.displayName || raw.username),
        ...(raw.kind === "huella" ? { credentialId: raw.credentialId } : {}),
      };
    }
  } catch {
    // Dato dañado: se trata como si no hubiera equipo.
  }
  return null;
};

export const saveStoredDevice = (device: StoredDevice, store: KeyValueStore | null = defaultStore()) => {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(device));
  } catch {
    // Sin almacenamiento no hay acceso rápido; se sigue entrando con la contraseña.
  }
};

export const clearStoredDevice = (store: KeyValueStore | null = defaultStore()) => {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nada que limpiar.
  }
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const randomBytes = (length: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
};

/** Llave del equipo: 32 bytes al azar, en base64url. */
export const newDeviceSecret = (): string => toBase64Url(randomBytes(32));

/**
 * ¿El celular tiene lector de huella (o rostro) que el navegador pueda usar?
 * Es el «autenticador de plataforma» de WebAuthn con verificación del usuario.
 */
export const fingerprintAvailable = async (): Promise<boolean> => {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

/**
 * Registra la huella en el lector del celular y devuelve el id de la credencial.
 *
 * La huella la comprueba el propio teléfono: aquí solo se usa para liberar la llave del
 * equipo, así que el desafío es local y no se envía al servidor.
 */
export const createFingerprintCredential = async (username: string, displayName: string): Promise<string> => {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "Toolkit SISMED", id: window.location.hostname },
      user: { id: randomBytes(16), name: username, displayName },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No se pudo registrar la huella.");
  return toBase64Url(new Uint8Array(credential.rawId));
};

/** Pide la huella. Resuelve si el lector la aceptó; lanza si se canceló o falló. */
export const verifyFingerprint = async (credentialId: string): Promise<void> => {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: fromBase64Url(credentialId), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error("No se pudo leer la huella.");
};

/** La persona cerró el diálogo de la huella: no es un error que haya que mostrar. */
export const wasCancelled = (e: unknown): boolean =>
  e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");

export const isValidPin = (pin: string): boolean => /^[0-9]{4}$/.test(pin);

/** Nombre del equipo para la lista del Perfil («Windows · Chrome»). */
export const deviceNameFrom = (userAgent: string): string => {
  const ua = userAgent || "";
  const sistema = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Equipo";
  const navegador = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return navegador ? `${sistema} · ${navegador}` : sistema;
};

/** Qué decirle a la persona cuando no se pudo entrar con el equipo. */
export const deviceLoginMessage = (result: DeviceLoginResult): string => {
  if (result.ok) return "";
  switch (result.reason) {
    case "pin":
      return result.remaining === 1
        ? "PIN incorrecto. Le queda 1 intento."
        : `PIN incorrecto. Le quedan ${result.remaining ?? 0} intentos.`;
    case "bloqueado":
      return "Este equipo se bloqueó por demasiados intentos. Entre con su contraseña y vuelva a crear el PIN.";
    case "usuario":
      return "Su cuenta está desactivada. Contacte al administrador.";
    default:
      return "El acceso rápido de este equipo ya no está activo. Entre con su contraseña.";
  }
};

/** Tras estos motivos el equipo guardado ya no sirve y se olvida. */
export const shouldForgetDevice = (result: DeviceLoginResult): boolean =>
  !result.ok && result.reason !== "pin";

/** PC con mouse: ahí se ofrece el PIN. En el celular irá la huella. */
export const isDesktopPointer = (): boolean => {
  try {
    return window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
};
