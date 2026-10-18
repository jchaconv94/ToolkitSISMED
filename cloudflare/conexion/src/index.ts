/**
 * sismed-conexion · Conexión inmediata entre la web y el Toolkit de escritorio.
 *
 * Las PC de los establecimientos no aceptan conexiones de afuera (router, cortafuegos),
 * así que es el Toolkit el que abre una conexión y la deja abierta. Todas viven en un
 * único Durable Object («region») con hibernación: una conexión quieta no consume nada.
 *
 * El servicio no guarda usuarios ni claves: pregunta a Supabase al conectarse cada uno.
 *   /pc   Toolkit. Cabeceras X-Toolkit-Claves, X-Toolkit-Equipo-Id, X-Toolkit-Equipo,
 *         X-Toolkit-Version. Solo entran PC con clave de envío vigente y vinculada
 *         (app_backup_pc_auth).
 *   /web  Navegador. ?token=<sesión de ToolkitSISMED> (app_backup_web_auth). Cada usuario
 *         solo ve las PC de su jurisdicción.
 *
 * Mensajes (JSON) por la conexión abierta:
 *   web → {t:"list"}                          → {t:"list", rows, seen} (seen: última conexión de las que no están)
 *   web → {t:"ping", id, code}                → la PC responde {t:"pong", ...} → {t:"ping_result"}
 *   web → {t:"backup_request", code}          → la PC recibe {t:"backup", job, token, partSize, parallel, uploadUrl}
 *   web → {t:"copy_request", code}            → baja la copia de la nube: {t:"backup_ready", …} sin pedir nada a la PC
 *   pc  → {t:"copy_offer", code, name, size, sha256, modified}
 *                                              → {t:"copy_go", job, code, token, partSize, parallel} o {t:"copy_skip", code, reason}
 *   pc  → {t:"backup_meta"|"backup_progress"|"backup_error", job, ...} → se reenvía a esa web
 *   servicio → web {t:"backup_ready", job, downloadUrl, name, size, sha256}
 *   web → {t:"backup_done", job}              → se borra de R2
 *   web → {t:"usage"}                         → {t:"usage", usage} consumo del plan gratuito
 *   servicio → web {t:"presence", online, codes, at?} cuando una PC se conecta o se va (at: su última conexión)
 * El texto «ping» recibe «pong» sin despertar al servicio (mantiene viva la conexión).
 *
 * Backups (el archivo no pasa por la conexión abierta, va por HTTPS directo a R2):
 *   POST /backup/<job>/start           (X-Job-Token)   inicia la subida por partes
 *   PUT  /backup/<job>/part/<n>        (X-Job-Token)   sube una parte (≤ 20 MiB)
 *   POST /backup/<job>/complete        (X-Job-Token)   {parts:[{partNumber, etag}]}
 *   POST /backup/<job>/abort           (X-Job-Token)
 *   GET  /backup/<job>/download?token=…                 descarga (admite Range)
 * Todo backup que termina de subir (pedido o copia) queda como la copia del establecimiento
 * y reemplaza a la anterior: en la nube queda solo el más reciente (2026-10-18). Si un pedido
 * trae el mismo backup que ya está en la nube, no se sube otra vez: se baja la copia.
 *
 * Envío de stock por camino de respaldo (no usa la conexión abierta ni el Durable Object):
 *   POST /stock   el Toolkit manda aquí el stock cuando la red bloquea script.google.com, y
 *                 este servicio lo pasa al Apps Script de la UNGET. Código y reglas en
 *                 supabase/functions/stock-relay/index.ts (lo comparte con Supabase).
 *
 * Reglas (etapa 3), antes de avisar a la PC:
 *   - Consumo: si algún dato del plan gratuito llega al 80 %, se rechaza el pedido.
 *   - Cupo: app_backup_request_start reserva el pedido si el establecimiento no agotó
 *     sus descargas del día. Cada paso queda registrado con app_backup_request_update.
 */

import { DurableObject } from "cloudflare:workers";
import {
  BACKUP_MAX_BYTES, BACKUP_PARALLEL, BACKUP_PART_MAX_BYTES, BACKUP_PART_SIZE, BackupCopy, BackupJob, COPY_PARALLEL, PcCode, PcInfo, USAGE_REFRESH_MS,
  UsageReading, WebInfo, canSee, copyCovers, copyIsStale, copyKey, copyOfferVerdict, copyRowsFor, isExpired, jobMessages, keysByCode,
  nextCopyExpiry, onlineFor, parseBackupMeta, quotaMessage, seenFor, seenRowsFor, SeenRow, usageBlocks, usageFor, usageMessage,
} from "./logic";
import { UsageEnv, readUsage } from "./usage";
// El reenvío de stock es el mismo código que publica Supabase (camino de respaldo B).
import { relayStock } from "../../../supabase/functions/stock-relay/index";

export interface Env extends UsageEnv {
  REGION: DurableObjectNamespace<Region>;
  BACKUPS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, X-Job-Token",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag, X-Backup-Name, X-Backup-Sha256",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function rpc<T>(env: Env, fn: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase ${fn}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

const clean = (value: string | null, max = 120) => String(value || "").trim().slice(0, max);

const region = (env: Env) => env.REGION.get(env.REGION.idFromName("region"));

/** Comparación en tiempo constante, para que el tiempo de respuesta no delate el permiso. */
const sameToken = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

async function handleBackup(request: Request, env: Env, parts: string[]): Promise<Response> {
  const [, , jobId, action, partNumber] = parts;
  const stub = region(env);
  const job = await stub.getJob(jobId || "");
  if (!job) return json({ error: "El pedido de backup no existe o ya venció" }, 404);

  if (action === "download" && request.method === "GET") {
    const url = new URL(request.url);
    if (!sameToken(url.searchParams.get("token"), job.downloadToken)) return json({ error: "Permiso no válido" }, 403);
    if (job.status !== "ready" || !job.key) return json({ error: "El backup todavía no está listo" }, 409);
    const object = await env.BACKUPS.get(job.key, { range: request.headers });
    if (!object) return json({ error: "El backup ya no está disponible" }, 410);
    const headers = new Headers(CORS);
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", `attachment; filename="${job.name}"`);
    headers.set("ETag", object.httpEtag);
    headers.set("X-Backup-Name", job.name || "");
    headers.set("X-Backup-Sha256", job.sha256 || "");
    headers.set("Accept-Ranges", "bytes");
    const range = object.range as { offset?: number; length?: number } | undefined;
    if (range && request.headers.has("Range")) {
      const offset = range.offset ?? 0;
      const length = range.length ?? object.size - offset;
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("Content-Length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }

  if (!sameToken(request.headers.get("X-Job-Token"), job.uploadToken)) return json({ error: "Permiso no válido" }, 403);
  // La PC iba a subir el mismo backup que ya está en la nube: no hace falta (2026-10-18). El
  // Toolkit 2.3.10 lo entiende al iniciar y no sube nada; uno anterior falla en la primera parte.
  if (job.reused) return action === "start" ? json({ ok: true, reused: true }) : json({ error: "La nube ya tiene este backup" }, 409);
  if (job.status === "ready" || job.status === "failed") return json({ error: "El pedido ya terminó" }, 409);

  if (action === "start" && request.method === "POST") {
    if (!job.name || !job.size) {
      // Los datos del backup llegan por la conexión abierta, que en una red congestionada (por
      // ejemplo, mientras sube la copia del día) puede llegar después de este pedido. El
      // Toolkit 2.3.9 los manda también aquí (2026-10-16).
      const meta = parseBackupMeta(await request.json().catch(() => null));
      if (!meta) return json({ error: "Falta informar el backup (nombre y tamaño)" }, 409);
      if (await stub.backupMeta(job.id, meta)) return json({ ok: true, reused: true });
      Object.assign(job, meta);
    }
    if (job.uploadId && job.key) return json({ ok: true, partSize: BACKUP_PART_SIZE });
    const name = job.name as string;
    // También el pedido va a `copias/`: al terminar queda como la copia del establecimiento.
    const key = copyKey(job, name);
    const upload = await env.BACKUPS.createMultipartUpload(key, { httpMetadata: { contentType: "application/zip" } });
    await stub.uploadStarted(job.id, key, upload.uploadId);
    return json({ ok: true, partSize: BACKUP_PART_SIZE });
  }

  if (!job.key || !job.uploadId) return json({ error: "La subida no se inició" }, 409);
  const upload = env.BACKUPS.resumeMultipartUpload(job.key, job.uploadId);

  if (action === "part" && request.method === "PUT") {
    const n = Number(partNumber);
    const length = Number(request.headers.get("Content-Length"));
    if (!Number.isInteger(n) || n < 1 || n > 1000) return json({ error: "Número de parte no válido" }, 400);
    if (!request.body || !length || length > BACKUP_PART_MAX_BYTES) return json({ error: "Parte vacía o demasiado grande" }, 413);
    // Se pasa el cuerpo tal cual a R2: el servicio no guarda la parte en memoria.
    const { readable, writable } = new FixedLengthStream(length);
    const pipe = request.body.pipeTo(writable);
    const part = await upload.uploadPart(n, readable);
    await pipe;
    return json({ partNumber: part.partNumber, etag: part.etag });
  }

  if (action === "complete" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { parts?: R2UploadedPart[] } | null;
    const uploaded = (body?.parts || []).filter((p) => Number.isInteger(p.partNumber) && typeof p.etag === "string");
    if (!uploaded.length) return json({ error: "Faltan las partes" }, 400);
    const object = await upload.complete(uploaded.sort((a, b) => a.partNumber - b.partNumber));
    if (object.size !== job.size) {
      await env.BACKUPS.delete(job.key);
      await stub.uploadFailed(job.id, `El tamaño no coincide (${object.size} de ${job.size} bytes)`);
      return json({ error: "El tamaño del archivo no coincide" }, 422);
    }
    await stub.uploadReady(job.id, new URL(request.url).origin);
    return json({ ok: true });
  }

  if (action === "abort" && request.method === "POST") {
    await upload.abort().catch(() => undefined);
    await stub.uploadFailed(job.id, "La PC canceló la subida");
    return json({ ok: true });
  }

  return json({ error: "No encontrado" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/salud") return json({ ok: true });
    if (url.pathname === "/stock") {
      try {
        return await relayStock(request, { supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
      } catch {
        return new Response(JSON.stringify({ error: "ERROR_DEL_SERVICIO", message: "Error del servicio de respaldo.", final: false }), {
          status: 500, headers: { "Content-Type": "application/json; charset=utf-8", "X-Relay-Error": "ERROR_DEL_SERVICIO" },
        });
      }
    }

    const parts = url.pathname.split("/");
    if (parts[1] === "backup") {
      try {
        return await handleBackup(request, env, parts);
      } catch (error) {
        return json({ error: `Error del servicio: ${String((error as Error).message || error)}` }, 500);
      }
    }

    if (url.pathname !== "/pc" && url.pathname !== "/web") return json({ error: "No encontrado" }, 404);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Se esperaba WebSocket" }, 426);

    let auth: PcInfo | Omit<WebInfo, "id">;
    try {
      if (url.pathname === "/pc") {
        const device = clean(request.headers.get("X-Toolkit-Equipo-Id"));
        const keys = keysByCode(request.headers.get("X-Toolkit-Claves"));
        const items = Object.entries(keys).map(([code, key]) => ({ code, key }));
        if (!device || items.length === 0) return json({ error: "Falta clave o equipo" }, 403);
        const codes = await rpc<PcCode[]>(env, "app_backup_pc_auth", { p_items: items, p_device_id: device });
        if (!Array.isArray(codes) || codes.length === 0) return json({ error: "PC no autorizada" }, 403);
        auth = {
          role: "pc",
          codes: codes.slice(0, 8).map((c) => ({ code: c.code, ungetId: c.ungetId, name: clean(c.name, 60) })),
          device,
          equipo: clean(request.headers.get("X-Toolkit-Equipo"), 40),
          version: clean(request.headers.get("X-Toolkit-Version"), 20),
          since: Date.now(),
        };
      } else {
        const token = clean(url.searchParams.get("token"), 64);
        if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Sesión no válida" }, 401);
        const who = await rpc<{ username: string; isAdmin: boolean; ungetIds: string[] }>(env, "app_backup_web_auth", { p_token: token });
        auth = { role: "web", username: who.username, isAdmin: Boolean(who.isAdmin), ungetIds: (who.ungetIds || []).slice(0, 30), token };
      }
    } catch (error) {
      // Una sesión vencida o un rol sin permiso vuelven de Supabase como error.
      return json({ error: String((error as Error).message || error) }, 401);
    }

    // Las cabeceras solo admiten ASCII: los nombres con tilde («Almacén») van codificados.
    const forwarded = new Request(request.url, { headers: { Upgrade: "websocket", "X-Auth": encodeURIComponent(JSON.stringify(auth)) } });
    return region(env).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

const JOB_PREFIX = "job:";
/** Motivo con que se cierra un pedido atendido con la copia de la nube (la web lo reconoce). */
const REUSED_REASON = "Ya estaba en la nube: se bajó la copia";
const USAGE_KEY = "usage";
/** Última conexión de cada establecimiento: `seen:<código>`. Una escritura por desconexión. */
const SEEN_PREFIX = "seen:";
/** Copia del día de cada establecimiento: `copy:<código>`. Una sola por establecimiento. */
const COPY_PREFIX = "copy:";
const CLEANUP_EVERY_MS = 10 * 60 * 1000;

export class Region extends DurableObject<Env> {
  private usageRefresh: Promise<UsageReading> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    let auth: PcInfo | Omit<WebInfo, "id"> | null = null;
    try { auth = JSON.parse(decodeURIComponent(request.headers.get("X-Auth") || "null")); } catch { auth = null; }
    if (!auth) return new Response("Sin autorización", { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (auth.role === "pc") {
      // Una reconexión de la misma PC reemplaza a la anterior.
      auth.codes.forEach((c) => this.ctx.getWebSockets(`pc:${c.code}`).forEach((old) => {
        try { old.close(4000, "Reemplazada por una conexión nueva"); } catch { /* ya cerrada */ }
      }));
      this.ctx.acceptWebSocket(server, ["pc", ...auth.codes.map((c) => `pc:${c.code}`)]);
      server.serializeAttachment(auth);
      this.announce(auth, true);
    } else {
      const info: WebInfo = { ...auth, id: crypto.randomUUID() };
      this.ctx.acceptWebSocket(server, ["web", `w:${info.id}`]);
      server.serializeAttachment(info);
      server.send(JSON.stringify({ t: "hello", username: info.username, isAdmin: info.isAdmin }));
      server.send(JSON.stringify({ t: "list", rows: this.rowsFor(info), seen: await this.seenFor(info), copies: await this.copiesFor(info) }));
      this.ctx.waitUntil(this.resumeJobs(server, info).catch(() => undefined));
      this.ctx.waitUntil(this.usage().then((usage) => this.sendUsage(server, info, usage)).catch(() => undefined));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 4000) return;
    let data: any;
    try { data = JSON.parse(message); } catch { return; }
    const info = ws.deserializeAttachment() as PcInfo | WebInfo | null;
    if (!info || !data || typeof data.t !== "string") return;

    if (info.role === "web") {
      if (data.t === "list") {
        ws.send(JSON.stringify({ t: "list", rows: this.rowsFor(info), seen: await this.seenFor(info), copies: await this.copiesFor(info) }));
      } else if (data.t === "ping") {
        const code = String(data.code || "").toUpperCase();
        const pc = this.pcFor(info, code);
        if (!pc) {
          ws.send(JSON.stringify({ t: "ping_result", id: data.id, code, ok: false, reason: "La PC no está conectada o no es de su jurisdicción" }));
          return;
        }
        pc.send(JSON.stringify({ t: "ping", id: data.id, code, web: info.id, sentAt: Date.now() }));
      } else if (data.t === "backup_request") {
        await this.requestBackup(ws, info, String(data.code || "").toUpperCase());
      } else if (data.t === "copy_request") {
        await this.requestCopy(ws, info, String(data.code || "").toUpperCase());
      } else if (data.t === "backup_done" && typeof data.job === "string") {
        const job = await this.getJob(data.job);
        if (job && job.web === info.id) {
          await this.report(job, "DOWNLOADED");
          await this.dropJob(job);
        }
      } else if (data.t === "usage") {
        this.sendUsage(ws, info, await this.usage());
      }
      return;
    }

    if (data.t === "pong" && typeof data.web === "string") {
      const target = this.ctx.getWebSockets(`w:${data.web}`)[0];
      const rtt = Math.max(0, Date.now() - Number(data.sentAt || 0));
      target?.send(JSON.stringify({ t: "ping_result", id: data.id, code: data.code, ok: true, rtt, equipo: info.equipo }));
      return;
    }

    if (data.t === "copy_offer") {
      await this.offerCopy(ws, info, data);
      return;
    }

    if (typeof data.job === "string" && data.t.startsWith("backup_")) {
      const job = await this.getJob(data.job);
      if (!job || !info.codes.some((c) => c.code === job.code)) return;
      if (data.t === "backup_meta") {
        const meta = parseBackupMeta(data);
        if (!meta) {
          await this.uploadFailed(job.id, "El Toolkit informó un backup no válido");
          return;
        }
        await this.backupMeta(job.id, meta);
      } else if (data.t === "backup_progress") {
        job.sent = Math.max(0, Math.min(Number(data.sent) || 0, job.size || 0));
        await this.ctx.storage.put(JOB_PREFIX + job.id, job);
        this.toWeb(job, { t: "backup_progress", job: job.id, code: job.code, sent: job.sent, total: job.size || 0 });
      } else if (data.t === "backup_error") {
        await this.uploadFailed(job.id, String(data.reason || "Error en la PC").slice(0, 200));
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    await this.forget(ws);
    try { ws.close(code === 1005 ? 1000 : code, "Cerrada"); } catch { /* ya cerrada */ }
  }

  async webSocketError(ws: WebSocket) {
    await this.forget(ws);
  }

  // --- Backups ---------------------------------------------------------------------

  private async requestBackup(ws: WebSocket, web: WebInfo, code: string) {
    const pc = this.pcFor(web, code);
    if (!pc) {
      ws.send(JSON.stringify({ t: "backup_failed", code, reason: "La PC no está conectada o no es de su jurisdicción" }));
      return;
    }

    const usage = await this.usage();
    if (usageBlocks(usage)) {
      ws.send(JSON.stringify({ t: "backup_failed", code, reason: usageMessage(usage), usage: usageFor(usage, web.isAdmin) }));
      return;
    }

    const id = crypto.randomUUID();
    let quota: { ok: boolean; limit: number; used: number; last?: { username: string; status: string; at: string } };
    try {
      quota = await rpc(this.env, "app_backup_request_start", { p_token: web.token, p_job: id, p_code: code, p_equipo: this.equipoOf(code) });
    } catch (error) {
      // Sin poder contar el cupo no se pide: así el límite no se salta por una caída.
      ws.send(JSON.stringify({ t: "backup_failed", code, reason: `No se pudo verificar el cupo de descargas: ${String((error as Error).message || error)}` }));
      return;
    }
    if (!quota.ok) {
      ws.send(JSON.stringify({ t: "backup_failed", code, reason: quotaMessage(quota, web.username), quota }));
      return;
    }

    const job: BackupJob = {
      id,
      code,
      ungetId: this.ungetOf(code),
      web: web.id,
      webToken: web.token,
      username: web.username,
      uploadToken: crypto.randomUUID() + crypto.randomUUID(),
      downloadToken: crypto.randomUUID() + crypto.randomUUID(),
      status: "requested",
      createdAt: Date.now(),
    };
    await this.ctx.storage.put(JOB_PREFIX + job.id, job);
    // Si ya hay una alarma lejana (la de una copia), se adelanta para revisar este pedido.
    await this.scheduleAlarm(true);
    ws.send(JSON.stringify({ t: "backup_requested", job: job.id, code, quota: { limit: quota.limit, used: quota.used } }));
    try {
      pc.send(JSON.stringify({ t: "backup", job: job.id, code, token: job.uploadToken, partSize: BACKUP_PART_SIZE, maxBytes: BACKUP_MAX_BYTES, parallel: BACKUP_PARALLEL }));
    } catch {
      // Se fue justo ahora: se libera el cupo en vez de dejarlo ocupado una hora.
      await this.uploadFailed(job.id, "La PC se desconectó antes de recibir el pedido");
    }
  }

  /**
   * Datos del backup (nombre, tamaño, huella). Llegan por la conexión abierta o con el inicio
   * de la subida, lo que llegue primero; la segunda vez no cambia nada.
   */
  async backupMeta(id: string, meta: { name: string; size: number; sha256: string; modified: string }): Promise<boolean> {
    const job = await this.getJob(id);
    if (!job) return false;
    if (job.reused) return true;
    if (job.name && job.status !== "requested") return false;
    if ((!job.kind || job.kind === "request") && (await this.reuseCopy(job, meta))) return true;
    Object.assign(job, meta, { status: "uploading" });
    await this.ctx.storage.put(JOB_PREFIX + job.id, job);
    await this.report(job, "UPLOADING", { p_file_name: meta.name, p_size: meta.size });
    this.toWeb(job, { t: "backup_meta", job: job.id, code: job.code, ...meta });
    return false;
  }

  /**
   * El pedido trae el mismo backup que ya está en la nube (o uno más viejo): en vez de subirlo
   * otra vez, se baja la copia (2026-10-18). Como bajar la copia, no gasta el cupo: el pedido
   * se cierra como no descargado y la descarga se registra aparte, con otro id.
   */
  private async reuseCopy(job: BackupJob, meta: { name: string; size: number; sha256: string; modified: string }): Promise<boolean> {
    const copy = await this.ctx.storage.get<BackupCopy>(COPY_PREFIX + job.code);
    if (!copy || !copy.origin || !copyCovers(copy, meta, Date.now())) return false;
    if (!(await this.env.BACKUPS.head(copy.key))) {
      await this.dropCopy(copy, false);
      return false;
    }
    await this.report(job, "FAILED", { p_reason: REUSED_REASON, p_file_name: copy.name, p_size: copy.size });
    Object.assign(job, {
      kind: "copy_download", reused: true, reportId: crypto.randomUUID(), status: "ready", ungetId: copy.ungetId,
      name: copy.name, size: copy.size, sha256: copy.sha256, modified: copy.modified, key: copy.key,
      downloadUrl: `${copy.origin}/backup/${job.id}/download?token=${job.downloadToken}`,
    } satisfies Partial<BackupJob>);
    await this.ctx.storage.put(JOB_PREFIX + job.id, job);
    this.toWeb(job, {
      t: "backup_ready", job: job.id, code: job.code, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified,
      downloadUrl: job.downloadUrl, copy: true,
    });
    return true;
  }

  async getJob(id: string): Promise<BackupJob | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const job = (await this.ctx.storage.get<BackupJob>(JOB_PREFIX + id)) || null;
    return job && !isExpired(job, Date.now()) ? job : null;
  }

  async uploadStarted(id: string, key: string, uploadId: string) {
    const job = await this.getJob(id);
    if (!job) return;
    Object.assign(job, { key, uploadId, status: "uploading" });
    await this.ctx.storage.put(JOB_PREFIX + id, job);
  }

  async uploadReady(id: string, origin: string) {
    const job = await this.getJob(id);
    if (!job) return;
    if (job.kind === "copy") {
      await this.storeCopy(job, origin);
      return;
    }
    // El backup pedido es el más reciente: queda también como copia, para los demás.
    job.promoted = await this.saveCopy(job, origin);
    job.status = "ready";
    job.downloadUrl = `${origin}/backup/${id}/download?token=${job.downloadToken}`;
    await this.ctx.storage.put(JOB_PREFIX + id, job);
    await this.report(job, "READY");
    this.toWeb(job, {
      t: "backup_ready", job: id, code: job.code, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified,
      downloadUrl: job.downloadUrl,
    });
  }

  async uploadFailed(id: string, reason: string) {
    const job = await this.getJob(id);
    // Un Toolkit anterior a 2.3.10 no entiende que no debía subir y avisa un error: se ignora.
    if (!job || job.reused) return;
    this.toWeb(job, { t: "backup_failed", job: id, code: job.code, reason });
    await this.report(job, "FAILED", { p_reason: reason });
    await this.dropJob(job);
  }

  private async dropJob(job: BackupJob) {
    // La descarga de una copia no es dueña del archivo: la copia sigue para los demás.
    if (job.kind === "copy_download" || job.promoted) {
      await this.ctx.storage.delete(JOB_PREFIX + job.id);
      return;
    }
    try {
      if (job.key && job.status === "ready") await this.env.BACKUPS.delete(job.key);
      else if (job.key && job.uploadId) await this.env.BACKUPS.resumeMultipartUpload(job.key, job.uploadId).abort();
    } catch { /* la regla del bucket lo borra al día igual */ }
    await this.ctx.storage.delete(JOB_PREFIX + job.id);
  }

  async alarm() {
    const now = Date.now();
    const jobs = await this.ctx.storage.list<BackupJob>({ prefix: JOB_PREFIX });
    let pending = 0;
    for (const job of jobs.values()) {
      if (isExpired(job, now)) {
        await this.report(job, "EXPIRED", { p_reason: "Venció sin descargarse" });
        await this.dropJob(job);
      }
      else pending += 1;
    }
    // Copias vencidas (la PC dejó de conectarse): se borran.
    const copies = Array.from((await this.ctx.storage.list<BackupCopy>({ prefix: COPY_PREFIX })).values());
    for (const copy of copies.filter((c) => copyIsStale(c, now))) await this.dropCopy(copy, true);
    await this.scheduleAlarm(pending > 0, copies.filter((c) => !copyIsStale(c, now)));
  }

  /** Despierta en 10 minutos si hay pedidos en curso, o cuando venza la primera copia. */
  private async scheduleAlarm(pendingJobs: boolean, copies?: BackupCopy[]) {
    const list = copies ?? Array.from((await this.ctx.storage.list<BackupCopy>({ prefix: COPY_PREFIX })).values());
    const times = [pendingJobs ? Date.now() + CLEANUP_EVERY_MS : null, nextCopyExpiry(list)].filter((t): t is number => t != null);
    if (!times.length) return;
    const current = await this.ctx.storage.getAlarm();
    const next = Math.min(...times);
    if (!current || current > next || current < Date.now()) await this.ctx.storage.setAlarm(next);
  }

  /**
   * Al volver a conectarse (recargó la página, cambió de módulo o volvió a entrar), los pedidos
   * de esa persona pasan a esta conexión y se le vuelven a mostrar: así la descarga sigue.
   */
  private async resumeJobs(ws: WebSocket, web: WebInfo) {
    const jobs = await this.ctx.storage.list<BackupJob>({ prefix: JOB_PREFIX });
    const now = Date.now();
    for (const job of jobs.values()) {
      if (job.username !== web.username || isExpired(job, now)) continue;
      job.web = web.id;
      job.webToken = web.token;
      await this.ctx.storage.put(JOB_PREFIX + job.id, job);
      jobMessages(job).forEach((m) => { try { ws.send(JSON.stringify(m)); } catch { /* cerrada */ } });
    }
  }

  // --- Copia en la nube --------------------------------------------------------------

  /** La PC ofrece cada backup nuevo que genera el SISMED. Se acepta si es nuevo y hay espacio. */
  private async offerCopy(ws: WebSocket, pc: PcInfo, data: any) {
    const code = String(data.code || "").toUpperCase();
    const pcCode = pc.codes.find((c) => c.code === code);
    if (!pcCode) return;
    const meta = parseBackupMeta(data);
    if (!meta) {
      ws.send(JSON.stringify({ t: "copy_skip", code, reason: "El Toolkit informó un backup no válido" }));
      return;
    }
    const now = Date.now();
    const existing = (await this.ctx.storage.get<BackupCopy>(COPY_PREFIX + code)) || null;
    const jobs = await this.ctx.storage.list<BackupJob>({ prefix: JOB_PREFIX });
    const uploading = Array.from(jobs.values()).some((j) => j.kind === "copy" && j.code === code && !isExpired(j, now));
    const verdict = copyOfferVerdict(existing, meta, await this.usage(), uploading, now);
    if (!verdict.accept) {
      ws.send(JSON.stringify({ t: "copy_skip", code, reason: verdict.reason }));
      return;
    }
    const job: BackupJob = {
      id: crypto.randomUUID(),
      kind: "copy",
      code,
      ungetId: pcCode.ungetId,
      web: "",
      webToken: "",
      username: "",
      uploadToken: crypto.randomUUID() + crypto.randomUUID(),
      downloadToken: "",
      status: "requested",
      createdAt: now,
      ...meta,
    };
    await this.ctx.storage.put(JOB_PREFIX + job.id, job);
    await this.scheduleAlarm(true);
    ws.send(JSON.stringify({
      t: "copy_go", job: job.id, code, token: job.uploadToken, partSize: BACKUP_PART_SIZE, parallel: COPY_PARALLEL, maxBytes: BACKUP_MAX_BYTES,
    }));
  }

  /** La copia terminó de subir: reemplaza a la anterior. */
  private async storeCopy(job: BackupJob, origin: string) {
    await this.saveCopy(job, origin);
    await this.ctx.storage.delete(JOB_PREFIX + job.id);
  }

  /**
   * Un backup terminó de subir completo (la subida ya comprobó el tamaño): pasa a ser la copia
   * del establecimiento y recién entonces se borra la anterior, así nunca queda sin ninguna.
   */
  private async saveCopy(job: BackupJob, origin: string): Promise<boolean> {
    if (!job.key || !job.name || !job.size || !job.sha256) return false;
    const previous = await this.ctx.storage.get<BackupCopy>(COPY_PREFIX + job.code);
    const ungetId = job.ungetId ?? previous?.ungetId ?? this.ungetOf(job.code);
    const copy: BackupCopy = {
      code: job.code, ungetId, name: job.name, size: job.size, sha256: job.sha256,
      modified: job.modified || "", key: job.key, uploadedAt: Date.now(), equipo: this.equipoOf(job.code), origin,
    };
    await this.ctx.storage.put(COPY_PREFIX + job.code, copy);
    if (previous && previous.key !== copy.key) {
      try { await this.env.BACKUPS.delete(previous.key); } catch { /* la regla del bucket la borra igual */ }
    }
    await this.scheduleAlarm(false);
    this.announceCopy(copy, true);
    return true;
  }

  private async dropCopy(copy: BackupCopy, deleteObject: boolean) {
    if (deleteObject) {
      try { await this.env.BACKUPS.delete(copy.key); } catch { /* la regla del bucket la borra igual */ }
    }
    await this.ctx.storage.delete(COPY_PREFIX + copy.code);
    this.announceCopy(copy, false);
  }

  /** Avisa a quienes ven ese establecimiento que hay (o ya no hay) copia. */
  private announceCopy(copy: BackupCopy, present: boolean) {
    const row = present ? copyRowsFor({ isAdmin: true, ungetIds: [] }, [copy], Date.now())[0] ?? null : null;
    this.ctx.getWebSockets("web").forEach((ws) => {
      const web = ws.deserializeAttachment() as WebInfo | null;
      if (!web || !canSee(web, copy)) return;
      try { ws.send(JSON.stringify({ t: "copy", code: copy.code, copy: row })); } catch { /* cerrada */ }
    });
  }

  private async copiesFor(web: WebInfo) {
    try {
      const stored = await this.ctx.storage.list<BackupCopy>({ prefix: COPY_PREFIX });
      return copyRowsFor(web, Array.from(stored.values()), Date.now());
    } catch {
      return [];
    }
  }

  /** Alguien baja la copia del día: no se le pide nada a la PC ni se gasta el cupo. */
  private async requestCopy(ws: WebSocket, web: WebInfo, code: string) {
    const fail = (reason: string) => ws.send(JSON.stringify({ t: "backup_failed", code, reason, copy: true }));
    const copy = await this.ctx.storage.get<BackupCopy>(COPY_PREFIX + code);
    if (!copy || copyIsStale(copy, Date.now()) || !canSee(web, copy) || !copy.origin) {
      fail("No hay un backup de este establecimiento en la nube; pida uno nuevo.");
      return;
    }
    if (!(await this.env.BACKUPS.head(copy.key))) {
      // La borró la regla del bucket antes de tiempo: se olvida y se ofrece pedir uno nuevo.
      await this.dropCopy(copy, false);
      fail("La copia ya no está en la nube; pida uno nuevo.");
      return;
    }
    const job: BackupJob = {
      id: crypto.randomUUID(),
      kind: "copy_download",
      code,
      ungetId: copy.ungetId,
      web: web.id,
      webToken: web.token,
      username: web.username,
      uploadToken: "",
      downloadToken: crypto.randomUUID() + crypto.randomUUID(),
      status: "ready",
      createdAt: Date.now(),
      name: copy.name,
      size: copy.size,
      sha256: copy.sha256,
      modified: copy.modified,
      key: copy.key,
    };
    job.downloadUrl = `${copy.origin}/backup/${job.id}/download?token=${job.downloadToken}`;
    await this.ctx.storage.put(JOB_PREFIX + job.id, job);
    await this.scheduleAlarm(true);
    ws.send(JSON.stringify({
      t: "backup_ready", job: job.id, code, name: job.name, size: job.size, sha256: job.sha256, modified: job.modified,
      downloadUrl: job.downloadUrl, copy: true,
    }));
  }

  /** Registra el paso en Supabase con la sesión de quien pidió. Si falla, el pedido sigue. */
  private async report(job: BackupJob, status: string, extra: Record<string, unknown> = {}) {
    // La copia la sube la PC sola: no hay pedido ni persona que registrar.
    if (job.kind === "copy") return;
    if (job.kind === "copy_download") {
      if (status !== "DOWNLOADED") return;
      try {
        await rpc(this.env, "app_backup_copy_downloaded", {
          p_token: job.webToken, p_job: job.reportId ?? job.id, p_code: job.code, p_file_name: job.name, p_size: job.size, p_equipo: "",
        });
      } catch (error) {
        console.warn(`No se registró la descarga de la copia ${job.id}: ${String((error as Error).message || error)}`);
      }
      return;
    }
    try {
      await rpc(this.env, "app_backup_request_update", { p_token: job.webToken, p_job: job.id, p_status: status, ...extra });
    } catch (error) {
      // Supabase vence solo a la hora lo que quedó abierto: nunca bloquea el cupo del día.
      console.warn(`No se registró ${status} del pedido ${job.id}: ${String((error as Error).message || error)}`);
    }
  }

  // --- Consumo del plan gratuito ----------------------------------------------------

  /** Última lectura; se renueva solo si tiene más de 10 minutos y alguien la necesita. */
  async usage(): Promise<UsageReading> {
    const cached = await this.ctx.storage.get<UsageReading>(USAGE_KEY);
    if (cached && Date.now() - cached.at < USAGE_REFRESH_MS) return cached;
    this.usageRefresh ??= readUsage(this.env)
      .then(async (reading) => {
        await this.ctx.storage.put(USAGE_KEY, reading);
        return reading;
      })
      .finally(() => { this.usageRefresh = null; });
    return this.usageRefresh;
  }

  private sendUsage(ws: WebSocket, web: WebInfo, usage: UsageReading) {
    try { ws.send(JSON.stringify({ t: "usage", usage: usageFor(usage, web.isAdmin), message: usageMessage(usage) })); } catch { /* cerrada */ }
  }

  private toWeb(job: BackupJob, message: unknown) {
    const target = this.ctx.getWebSockets(`w:${job.web}`)[0];
    try { target?.send(JSON.stringify(message)); } catch { /* la web se fue */ }
  }

  // --- Conexiones ------------------------------------------------------------------

  /** UNGET del establecimiento según la PC conectada (un pedido no la guarda). */
  private ungetOf(code: string): string | null {
    const ws = this.ctx.getWebSockets(`pc:${code}`)[0];
    return (ws?.deserializeAttachment() as PcInfo | null)?.codes.find((c) => c.code === code)?.ungetId ?? null;
  }

  private equipoOf(code: string) {
    const ws = this.ctx.getWebSockets(`pc:${code}`)[0];
    return (ws?.deserializeAttachment() as PcInfo | null)?.equipo || "";
  }

  private pcFor(web: WebInfo, code: string) {
    return this.rowsFor(web).some((r) => r.code === code) ? this.ctx.getWebSockets(`pc:${code}`)[0] : undefined;
  }

  private async forget(ws: WebSocket) {
    const info = ws.deserializeAttachment() as PcInfo | WebInfo | null;
    if (info?.role !== "pc") return;
    const gone = info.codes.filter((c) => this.ctx.getWebSockets(`pc:${c.code}`).every((s) => s === ws));
    if (!gone.length) return;
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null;
    const seen = seenRowsFor(info, gone, lastPing);
    try {
      await this.ctx.storage.put(Object.fromEntries(seen.map((row) => [SEEN_PREFIX + row.code, row])));
    } catch { /* sin almacenamiento, la web sigue mostrando «Desconectada» sin hora */ }
    this.announce({ ...info, codes: gone }, false, seen[0]?.at);
  }

  private async seenFor(web: WebInfo): Promise<SeenRow[]> {
    try {
      const stored = await this.ctx.storage.list<SeenRow>({ prefix: SEEN_PREFIX });
      return seenFor(web, Array.from(stored.values()));
    } catch {
      return [];
    }
  }

  private pcs() {
    return this.ctx.getWebSockets("pc").map((ws) => ({
      info: ws.deserializeAttachment() as PcInfo,
      lastPing: this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null,
    })).filter((p) => p.info?.role === "pc");
  }

  private rowsFor(web: WebInfo) {
    return onlineFor(web, this.pcs(), Date.now());
  }

  private announce(pc: PcInfo, online: boolean, at?: number) {
    this.ctx.getWebSockets("web").forEach((ws) => {
      const web = ws.deserializeAttachment() as WebInfo | null;
      if (!web) return;
      const codes = pc.codes.filter((c) => canSee(web, c)).map((c) => c.code);
      if (codes.length) {
        try { ws.send(JSON.stringify({ t: "presence", online, codes, equipo: pc.equipo, ...(at ? { at } : {}) })); } catch { /* cerrada */ }
      }
    });
  }
}
