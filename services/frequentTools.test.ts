import { describe, expect, it } from "vitest";
import { loadCounts, recordToolUse, topTools } from "./frequentTools";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

describe("accesos frecuentes", () => {
  it("cuenta por usuario y no cuenta Inicio ni Perfil", () => {
    const s = memory();
    recordToolUse("ana", "SIG_SEARCH", 1, s);
    recordToolUse("ana", "SIG_SEARCH", 2, s);
    recordToolUse("ana", "HOME", 3, s);
    recordToolUse("ana", "PROFILE", 4, s);
    recordToolUse("luis", "DASHBOARD", 5, s);
    expect(loadCounts("ana", s)).toEqual({ SIG_SEARCH: { n: 2, at: 2 } });
    expect(loadCounts("luis", s)).toEqual({ DASHBOARD: { n: 1, at: 5 } });
  });

  it("ordena por usos, luego por lo más reciente, y completa con sugeridas y el menú", () => {
    const counts = { DASHBOARD: { n: 3, at: 1 }, REDISTRIBUTION: { n: 3, at: 9 }, SIG_SEARCH: { n: 1, at: 2 } };
    const available = ["DASHBOARD", "ANALYSIS_EXCLUSIONS", "REDISTRIBUTION", "SIG_SEARCH", "IPRESS_STOCK", "ADMIN_USERS"] as const;
    expect(topTools(counts, [...available], ["IPRESS_STOCK"], 4)).toEqual(["REDISTRIBUTION", "DASHBOARD", "SIG_SEARCH", "IPRESS_STOCK"]);
    expect(topTools({}, [...available], ["IPRESS_STOCK", "ADMIN_BACKUPS"], 3)).toEqual(["IPRESS_STOCK", "DASHBOARD", "ANALYSIS_EXCLUSIONS"]);
  });

  it("no ofrece lo que ya no puede abrir, aunque lo haya usado", () => {
    expect(topTools({ ADMIN_USERS: { n: 9, at: 1 } }, ["DASHBOARD"], [], 4)).toEqual(["DASHBOARD"]);
  });

  it("un historial dañado no rompe nada", () => {
    expect(loadCounts("ana", { getItem: () => "{no es json" })).toEqual({});
    expect(loadCounts("ana", null)).toEqual({});
  });
});
