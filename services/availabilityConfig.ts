/**
 * Configuración del módulo Disponibilidad (2026-10-06): la fórmula, el listado de códigos
 * fusionados de DIGEMID y los productos vitales. La cambia el administrador desde el propio
 * módulo y vale para todos (`supabase/SUPABASE_DISPONIBILIDAD_CONFIGURACION.sql`).
 *
 * Sin ese SQL, o si la lectura falla, se usa la configuración de fábrica: la fórmula de
 * `DEFAULT_AVAILABILITY_FORMULA` y los listados que vienen con la web (`fusedCodes.ts`,
 * `vitalProducts.ts`).
 */

import { callSendKeysRpc } from "./sendKeys";
import { FUSED_CODE_GROUPS, FUSED_CODES_VERSION } from "./fusedCodes";
import { DEFAULT_VITAL_PRODUCTS, type VitalProduct } from "./vitalProducts";
import { withOfflineCache } from "./offlineCache";

const SQL = "SUPABASE_DISPONIBILIDAD_CONFIGURACION.sql";

export type SinRotacionRule = "no" | "vital" | "yes";

export interface ScopeRule {
  normostock: boolean;
  sobrestock: boolean;
  substock: boolean;
  /** En «todos los productos» solo «no» o «yes»; en la DME también «vital». */
  sinRotacion: SinRotacionRule;
}

export interface AvailabilityFormula {
  all: ScopeRule;
  essential: ScopeRule;
  /** Cortar los meses a un decimal antes de clasificar (apagado por pedido del usuario). */
  truncate: boolean;
  /** Substock por debajo de estos meses. */
  subMax: number;
  /** Sobrestock por encima de estos meses. */
  sobreMin: number;
  levels: { optimo: number; alto: number; regular: number };
  /** Microred y UNGET: promedio de sus establecimientos o suma de sus ítems. */
  aggregate: "average" | "sum";
}

export const DEFAULT_AVAILABILITY_FORMULA: AvailabilityFormula = {
  all: { normostock: true, sobrestock: true, substock: false, sinRotacion: "no" },
  essential: { normostock: true, sobrestock: true, substock: false, sinRotacion: "vital" },
  truncate: false,
  subMax: 2,
  sobreMin: 6,
  levels: { optimo: 90, alto: 80, regular: 70 },
  aggregate: "average",
};

/** La de la ficha 28 de DIGEMID («Restablecer ficha 28»). */
export const FICHA_28_FORMULA: AvailabilityFormula = { ...DEFAULT_AVAILABILITY_FORMULA };

export type FusedGroups = Record<string, { name: string; codes: string[] }>;

export interface FusedCatalog {
  version: string;
  groups: FusedGroups;
}

export interface AvailabilityConfig {
  formula: AvailabilityFormula;
  fused: FusedCatalog;
  fusedPrev: FusedCatalog | null;
  vitals: VitalProduct[];
  /** Quién y cuándo guardó cada parte (vacío si es la de fábrica). */
  meta: Partial<Record<"formula" | "fused" | "vitals", { updatedBy?: string | null; updatedAt?: string | null }>>;
  /** ¿Se pudo leer de la base? Si no, todo es de fábrica y no se puede guardar. */
  fromServer: boolean;
}

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const rule = (v: unknown, fallback: ScopeRule, allowVital: boolean): ScopeRule => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sr = o.sinRotacion === "yes" || o.sinRotacion === "no" || (allowVital && o.sinRotacion === "vital") ? (o.sinRotacion as SinRotacionRule) : fallback.sinRotacion;
  return { normostock: bool(o.normostock, fallback.normostock), sobrestock: bool(o.sobrestock, fallback.sobrestock), substock: bool(o.substock, fallback.substock), sinRotacion: sr };
};

/** Normaliza lo que llega de la base: cualquier campo raro vuelve al de fábrica. */
export const normalizeFormula = (value: unknown): AvailabilityFormula => {
  const d = DEFAULT_AVAILABILITY_FORMULA;
  const o = (value && typeof value === "object" ? value : {}) as Record<string, any>;
  const subMax = num(o.subMax, d.subMax, 0, 24);
  const sobreMin = Math.max(subMax, num(o.sobreMin, d.sobreMin, 0, 48));
  const lv = o.levels || {};
  const optimo = num(lv.optimo, d.levels.optimo, 0, 100);
  const alto = Math.min(optimo, num(lv.alto, d.levels.alto, 0, 100));
  const regular = Math.min(alto, num(lv.regular, d.levels.regular, 0, 100));
  return {
    all: rule(o.all, d.all, false),
    essential: rule(o.essential, d.essential, true),
    truncate: bool(o.truncate, d.truncate),
    subMax,
    sobreMin,
    levels: { optimo, alto, regular },
    aggregate: o.aggregate === "sum" ? "sum" : "average",
  };
};

const padCode = (v: unknown) => {
  const s = String(v ?? "").trim().toUpperCase();
  return /^\d+$/.test(s) && s.length < 5 ? s.padStart(5, "0") : s;
};

export const normalizeFusedCatalog = (value: unknown): FusedCatalog | null => {
  const o = (value && typeof value === "object" ? value : null) as { version?: unknown; groups?: unknown } | null;
  if (!o || !o.groups || typeof o.groups !== "object") return null;
  const groups: FusedGroups = {};
  for (const [target, g] of Object.entries(o.groups as Record<string, any>)) {
    const codes = Array.isArray(g?.codes) ? [...new Set(g.codes.map(padCode).filter(Boolean))] as string[] : [];
    if (!codes.length) continue;
    groups[padCode(target)] = { name: String(g?.name ?? ""), codes: codes.includes(padCode(target)) ? codes : [padCode(target), ...codes] };
  }
  return { version: String(o.version ?? "Sin nombre"), groups };
};

export const normalizeVitals = (value: unknown): VitalProduct[] | null => {
  const list = (value as { items?: unknown })?.items;
  if (!Array.isArray(list)) return null;
  return list.map((v: any, i) => ({
    n: Number(v?.n) || i + 1,
    name: String(v?.name ?? ""),
    concentration: String(v?.concentration ?? ""),
    form: String(v?.form ?? ""),
    presentation: String(v?.presentation ?? ""),
    codes: Array.isArray(v?.codes) ? [...new Set(v.codes.map(padCode).filter(Boolean))] as string[] : [],
  }));
};

/** Códigos SISMED de todos los vitales. */
export const vitalCodeSet = (vitals: VitalProduct[]): Set<string> => new Set(vitals.flatMap((v) => v.codes));

export const factoryConfig = (): AvailabilityConfig => ({
  formula: DEFAULT_AVAILABILITY_FORMULA,
  fused: { version: FUSED_CODES_VERSION, groups: FUSED_CODE_GROUPS },
  fusedPrev: null,
  vitals: DEFAULT_VITAL_PRODUCTS,
  meta: {},
  fromServer: false,
});

/* ------------------------------------------------------------ Listado de DIGEMID en Excel */

const normHeader = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Lee la hoja «FUSIONADOS» del listado de DIGEMID: columnas MEDCOD, MEDCOD_FUSIONADO y
 * NOMBRE_2 (nombre del código destino). Devuelve los grupos por código destino.
 */
export const parseFusedCodesSheet = (sheet: unknown[][]): FusedGroups => {
  const headerIdx = sheet.slice(0, 15).findIndex((row) => (row || []).map(normHeader).includes("MEDCODFUSIONADO"));
  if (headerIdx < 0) throw new Error("No se encontró la columna MEDCOD_FUSIONADO. Revise que sea el listado de códigos fusionados de DIGEMID (hoja «FUSIONADOS»).");
  const header = sheet[headerIdx].map(normHeader);
  const cCode = header.indexOf("MEDCOD");
  const cTarget = header.indexOf("MEDCODFUSIONADO");
  const cName = header.indexOf("NOMBRE2") >= 0 ? header.indexOf("NOMBRE2") : header.indexOf("NOMBRE");
  if (cCode < 0) throw new Error("No se encontró la columna MEDCOD.");
  const groups: FusedGroups = {};
  for (const row of sheet.slice(headerIdx + 1)) {
    if (!row) continue;
    const code = padCode(row[cCode]);
    const target = padCode(row[cTarget]);
    if (!code || !target) continue;
    const g = groups[target] || { name: "", codes: [] };
    if (!g.codes.includes(code)) g.codes.push(code);
    if (!g.name && cName >= 0) g.name = String(row[cName] ?? "").replace(/\s+/g, " ").trim();
    groups[target] = g;
  }
  for (const g of Object.values(groups)) g.codes.sort();
  if (!Object.keys(groups).length) throw new Error("El listado no trae códigos fusionados.");
  return groups;
};

/** Qué cambia entre dos listados: grupos nuevos, que cambian sus códigos y que salen. */
export const diffFusedGroups = (before: FusedGroups, after: FusedGroups) => {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [target, g] of Object.entries(after)) {
    const old = before[target];
    if (!old) added.push(target);
    else if (old.codes.join(",") !== g.codes.join(",")) changed.push(target);
  }
  for (const target of Object.keys(before)) if (!after[target]) removed.push(target);
  return { added, changed, removed };
};

/* ------------------------------------------------------------ Base de datos */

type Stored = Record<string, { value: unknown; updatedBy?: string | null; updatedAt?: string | null }>;

export const availabilityConfigApi = {
  /**
   * Nunca falla. Sin internet usa la última configuración leída en este equipo (modo sin
   * internet: el cálculo debe dar lo mismo que con internet); si nunca se leyó o no hay SQL,
   * la de fábrica.
   */
  load: async (): Promise<AvailabilityConfig> => {
    const base = factoryConfig();
    try {
      const data = (await withOfflineCache("disponibilidad:configuracion", () => callSendKeysRpc<Stored | null>("app_availability_config_get", {}, SQL))) || {};
      const fused = normalizeFusedCatalog(data.fused_codes?.value);
      const vitals = normalizeVitals(data.vital_products?.value);
      return {
        formula: data.formula ? normalizeFormula(data.formula.value) : base.formula,
        fused: fused || base.fused,
        fusedPrev: normalizeFusedCatalog(data.fused_codes_prev?.value),
        vitals: vitals || base.vitals,
        meta: {
          formula: data.formula ? { updatedBy: data.formula.updatedBy, updatedAt: data.formula.updatedAt } : undefined,
          fused: data.fused_codes ? { updatedBy: data.fused_codes.updatedBy, updatedAt: data.fused_codes.updatedAt } : undefined,
          vitals: data.vital_products ? { updatedBy: data.vital_products.updatedBy, updatedAt: data.vital_products.updatedAt } : undefined,
        },
        fromServer: true,
      };
    } catch {
      return base;
    }
  },
  saveFormula: (formula: AvailabilityFormula) => callSendKeysRpc<void>("app_availability_config_save", { p_key: "formula", p_value: formula }, SQL),
  saveFused: (catalog: FusedCatalog) => callSendKeysRpc<void>("app_availability_config_save", { p_key: "fused_codes", p_value: catalog }, SQL),
  saveVitals: (vitals: VitalProduct[]) => callSendKeysRpc<void>("app_availability_config_save", { p_key: "vital_products", p_value: { items: vitals } }, SQL),
};

/* ------------------------------------------------------------ Uso en el cálculo */

/** Límites de la situación según la fórmula. */
export const classifyOptionsOf = (f: AvailabilityFormula) => ({ truncate: f.truncate, subMax: f.subMax, sobreMin: f.sobreMin });

/** Opciones del resumen para una vista (todos los productos o DME). */
export const summaryOptionsOf = (f: AvailabilityFormula, scope: "all" | "essential", vitals: ReadonlySet<string>) => ({
  rule: scope === "all" ? f.all : f.essential,
  vitalCodes: scope === "essential" ? vitals : undefined,
  levels: f.levels,
  aggregate: f.aggregate,
});

/** Texto de la fórmula para el pie de la tabla. */
export const describeFormula = (f: AvailabilityFormula, scope: "all" | "essential"): string => {
  const r = scope === "all" ? f.all : f.essential;
  const parts = [r.normostock && "Normostock", r.sobrestock && "Sobrestock", r.substock && "Substock", r.sinRotacion === "yes" ? "Sin rotación" : r.sinRotacion === "vital" ? "Sin rotación de vitales" : null].filter(Boolean);
  const agg = f.aggregate === "sum" ? "suma de sus ítems" : "promedio de sus establecimientos";
  return `Disponibilidad = (${parts.join(" + ") || "nada"}) ÷ total de ítems · meses ${f.truncate ? "cortados a un decimal" : "sin cortar"} · Substock < ${f.subMax}, Sobrestock > ${f.sobreMin} · microred y UNGET: ${agg}.`;
};
