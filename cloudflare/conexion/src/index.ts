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
 * Mensajes (JSON):
 *   web → servicio  {t:"list"}                         → {t:"list", rows}
 *   web → servicio  {t:"ping", id, code}               → reenvía {t:"ping", id, web, sentAt} a la PC
 *   pc  → servicio  {t:"pong", id, web, sentAt}         → {t:"ping_result", id, ok, code, rtt} a esa web
 *   servicio → web  {t:"presence", online, codes}       cuando una PC se conecta o se va
 * El texto «ping» recibe «pong» sin despertar al servicio (mantiene viva la conexión).
 */

import { DurableObject } from "cloudflare:workers";
import { PcCode, PcInfo, WebInfo, canSee, keysByCode, onlineFor } from "./logic";

export interface Env {
  REGION: DurableObjectNamespace<Region>;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/salud") return json({ ok: true });
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
        auth = { role: "web", username: who.username, isAdmin: Boolean(who.isAdmin), ungetIds: (who.ungetIds || []).slice(0, 30) };
      }
    } catch (error) {
      // Una sesión vencida o un rol sin permiso vuelven de Supabase como error.
      return json({ error: String((error as Error).message || error) }, 401);
    }

    const stub = env.REGION.get(env.REGION.idFromName("region"));
    const forwarded = new Request(request.url, { headers: { Upgrade: "websocket", "X-Auth": JSON.stringify(auth) } });
    return stub.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

export class Region extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const auth = JSON.parse(request.headers.get("X-Auth") || "null") as PcInfo | Omit<WebInfo, "id"> | null;
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
      server.send(JSON.stringify({ t: "list", rows: this.rowsFor(info) }));
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
        ws.send(JSON.stringify({ t: "list", rows: this.rowsFor(info) }));
      } else if (data.t === "ping") {
        const code = String(data.code || "").toUpperCase();
        const row = this.rowsFor(info).find((r) => r.code === code);
        const pc = row ? this.ctx.getWebSockets(`pc:${code}`)[0] : undefined;
        if (!pc) {
          ws.send(JSON.stringify({ t: "ping_result", id: data.id, code, ok: false, reason: "La PC no está conectada o no es de su jurisdicción" }));
          return;
        }
        pc.send(JSON.stringify({ t: "ping", id: data.id, code, web: info.id, sentAt: Date.now() }));
      }
      return;
    }

    if (data.t === "pong" && typeof data.web === "string") {
      const target = this.ctx.getWebSockets(`w:${data.web}`)[0];
      const rtt = Math.max(0, Date.now() - Number(data.sentAt || 0));
      target?.send(JSON.stringify({ t: "ping_result", id: data.id, code: data.code, ok: true, rtt, equipo: info.equipo }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.forget(ws);
    try { ws.close(code === 1005 ? 1000 : code, "Cerrada"); } catch { /* ya cerrada */ }
  }

  async webSocketError(ws: WebSocket) {
    this.forget(ws);
  }

  private forget(ws: WebSocket) {
    const info = ws.deserializeAttachment() as PcInfo | WebInfo | null;
    if (info?.role !== "pc") return;
    const gone = info.codes.filter((c) => this.ctx.getWebSockets(`pc:${c.code}`).every((s) => s === ws));
    if (gone.length) this.announce({ ...info, codes: gone }, false);
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

  private announce(pc: PcInfo, online: boolean) {
    this.ctx.getWebSockets("web").forEach((ws) => {
      const web = ws.deserializeAttachment() as WebInfo | null;
      if (!web) return;
      const codes = pc.codes.filter((c) => canSee(web, c)).map((c) => c.code);
      if (codes.length) {
        try { ws.send(JSON.stringify({ t: "presence", online, codes, equipo: pc.equipo })); } catch { /* cerrada */ }
      }
    });
  }
}
