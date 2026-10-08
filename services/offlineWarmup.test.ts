import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let online = true;
vi.mock("./api", () => ({
  api: {
    getFacilities: async () => { calls.push("establecimientos"); return []; },
    getMicroredes: async () => { calls.push("microredes"); return []; },
    getUngets: async () => { calls.push("ungets"); return []; },
    getProfessions: async () => { calls.push("profesiones"); throw new Error("falla una"); },
  },
}));
vi.mock("./availabilityConfig", () => ({ availabilityConfigApi: { load: async () => { calls.push("configuracion"); return {}; } } }));
vi.mock("./connectivity", () => ({ isOnline: () => online }));

const fresh = async () => {
  vi.resetModules();
  return (await import("./offlineWarmup")).warmOfflineCopies;
};

beforeEach(() => { calls.length = 0; online = true; });

describe("copias para trabajar sin internet", () => {
  it("con internet lee todo lo que usan las herramientas sin internet, aunque una lectura falle", async () => {
    const warm = await fresh();
    await warm(1000);
    expect(calls.sort()).toEqual(["configuracion", "establecimientos", "microredes", "profesiones", "ungets"]);
  });

  it("como mucho una vez por hora", async () => {
    const warm = await fresh();
    await warm(0 + 3600001);
    await warm(3600001 + 60000);
    expect(calls.filter((c) => c === "establecimientos")).toHaveLength(1);
    await warm(3600001 + 3600001);
    expect(calls.filter((c) => c === "establecimientos")).toHaveLength(2);
  });

  it("sin internet no intenta nada", async () => {
    online = false;
    const warm = await fresh();
    await warm(5000000);
    expect(calls).toEqual([]);
  });
});
