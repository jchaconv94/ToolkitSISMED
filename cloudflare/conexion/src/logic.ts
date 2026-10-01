/**
 * Reglas del servicio de conexión que no dependen de Cloudflare, para poder probarlas.
 */

/** Establecimiento aceptado para una PC (lo devuelve app_backup_pc_auth). */
export interface PcCode {
  code: string;
  ungetId: string | null;
  name: string;
}

/** Lo que el servicio recuerda de cada conexión (cabe en el adjunto de 2 KB del socket). */
export interface PcInfo {
  role: "pc";
  codes: PcCode[];
  device: string;
  equipo: string;
  version: string;
  since: number;
}

export interface WebInfo {
  role: "web";
  id: string;
  username: string;
  isAdmin: boolean;
  ungetIds: string[];
}

/** Una PC sin «ping» en este tiempo se da por desconectada aunque el socket siga abierto. */
export const PC_SILENCE_MS = 150_000;

/** Clave de envío por código: «030S05-XXXX-XXXX-XXXX» → 030S05. Igual que el Toolkit. */
export const keysByCode = (value: string | null | undefined): Record<string, string> => {
  const mapping: Record<string, string> = {};
  String(value || "")
    .split(/[\s,;]+/)
    .map((k) => k.replace(/\s/g, "").toUpperCase())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((key) => {
      const code = key.split("-")[0];
      if (/^[0-9A-Z]{5,6}$/.test(code)) mapping[code] = key;
    });
  return mapping;
};

/** ¿Puede este usuario de la web ver (y pedirle cosas a) este establecimiento? */
export const canSee = (web: Pick<WebInfo, "isAdmin" | "ungetIds">, code: Pick<PcCode, "ungetId">): boolean =>
  web.isAdmin || (code.ungetId != null && web.ungetIds.includes(code.ungetId));

/** ¿Sigue viva la PC? `lastPing` es la hora del último «ping» que respondió el servicio. */
export const isAlive = (pc: Pick<PcInfo, "since">, lastPing: number | null, now: number): boolean =>
  now - Math.max(pc.since, lastPing ?? 0) <= PC_SILENCE_MS;

export interface OnlineRow {
  code: string;
  name: string;
  ungetId: string | null;
  equipo: string;
  version: string;
  since: number;
  lastSeen: number;
}

/** Lista de establecimientos conectados que ve un usuario, uno por fila. */
export const onlineFor = (
  web: Pick<WebInfo, "isAdmin" | "ungetIds">,
  pcs: Array<{ info: PcInfo; lastPing: number | null }>,
  now: number,
): OnlineRow[] => {
  const rows = new Map<string, OnlineRow>();
  pcs.forEach(({ info, lastPing }) => {
    if (!isAlive(info, lastPing, now)) return;
    const lastSeen = Math.max(info.since, lastPing ?? 0);
    info.codes.forEach((c) => {
      if (!canSee(web, c)) return;
      const previous = rows.get(c.code);
      if (previous && previous.lastSeen >= lastSeen) return;
      rows.set(c.code, { code: c.code, name: c.name, ungetId: c.ungetId, equipo: info.equipo, version: info.version, since: info.since, lastSeen });
    });
  });
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
};
