import { afterEach, describe, expect, it, vi } from "vitest";
import { readUsage } from "./usage";

const env = { CF_ACCOUNT_ID: "acc", CF_ANALYTICS_TOKEN: "tok" };
const now = Date.UTC(2026, 9, 2, 15, 0);

/** Responde como la API de métricas según el conjunto de datos que pide la consulta. */
const cloudflare = (datasets: Record<string, unknown[] | Error>) =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = Object.keys(datasets).find((key) => body.query.includes(key));
    const value = name ? datasets[name] : [];
    if (value instanceof Error) return new Response(JSON.stringify({ errors: [{ message: value.message }] }), { status: 200 });
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{ [name || "x"]: value }] } } }), { status: 200 });
  });

afterEach(() => vi.unstubAllGlobals());

describe("readUsage", () => {
  it("suma cada conjunto de datos y separa R2 por clase", async () => {
    const fetchMock = cloudflare({
      workersInvocationsAdaptive: [{ sum: { requests: 1200 } }, { sum: { requests: 300 } }],
      durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 85_000 } }],
      durableObjectsPeriodicGroups: [{ sum: { activeTime: 3_600_000_000 } }],
      r2OperationsAdaptiveGroups: [
        { sum: { requests: 40 }, dimensions: { actionType: "UploadPart" } },
        { sum: { requests: 5 }, dimensions: { actionType: "CompleteMultipartUpload" } },
        { sum: { requests: 9 }, dimensions: { actionType: "GetObject" } },
        { sum: { requests: 7 }, dimensions: { actionType: "DeleteObject" } },
      ],
      r2StorageAdaptiveGroups: [{ max: { payloadSize: 2_000_000_000, metadataSize: 1000 } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const reading = await readUsage(env, now);
    const used = Object.fromEntries(reading.items.map((i) => [i.key, i.used]));
    expect(used).toEqual({ workers: 1500, doRequests: 85_000, doDuration: 450, r2ClassA: 45, r2ClassB: 9, r2Storage: 2.000001 });
    expect(reading.level).toBe("paused");
    expect(reading.worst?.key).toBe("doRequests");
    expect(reading.error).toBeUndefined();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const vars = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).variables);
    expect(vars.every((v) => v.accountTag === "acc")).toBe(true);
    expect(vars.some((v) => v.start === "2026-10-01T00:00:00.000Z")).toBe(true); // R2: desde el 1 del mes
    expect(vars.some((v) => v.day === "2026-10-02")).toBe(true); // Durable Objects: el día UTC
  });

  it("un dato que falla no tumba a los demás", async () => {
    vi.stubGlobal("fetch", cloudflare({
      workersInvocationsAdaptive: [{ sum: { requests: 10 } }],
      durableObjectsPeriodicGroups: new Error("unknown field activeTime"),
    }));
    const reading = await readUsage(env, now);
    const byKey = Object.fromEntries(reading.items.map((i) => [i.key, i.used]));
    expect(byKey.workers).toBe(10);
    expect(byKey.doDuration).toBeNull();
    expect(reading.level).toBe("ok");
    expect(reading.error).toContain("activeTime");
  });

  it("sin clave no consulta nada", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reading = await readUsage({}, now);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reading.level).toBe("unknown");
  });
});
