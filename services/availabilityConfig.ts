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
import { DEFAULT_LARGE_VOLUME } from "./largeVolumeProducts";
import { FUSED_CODE_GROUPS, FUSED_CODES_VERSION } from "./fusedCodes";
import { DEFAULT_VITAL_PRODUCTS, type VitalProduct } from "./vitalProducts";
import { withOfflineCache } from "./offlineCache";

const SQL = "SUPABASE_DISPONIBILIDAD_CONFIGURACION.sql";

export type SinRotacionRule = "no" | "vital" | "yes";

/** Un medicamento de una lista a mano (código SISMED y su nombre, para mostrarlo sin el TFORMDET). */
export interface CodeEntry {
  code: string;
  name: string;
}

/** Por qué un medicamento no entra en la DME (ficha 28, criterios de exclusión). */
export type ExclusionReason = "strategic" | "national" | "other";
export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  strategic: "Intervención estratégica",
  national: "No figura en el tablero nacional",
  other: "Otro motivo",
};

export interface ExcludedEntry extends CodeEntry {
  reason: ExclusionReason;
}

/**
 * Medicamentos que el tablero nacional de DIGEMID no evalúa en la DME (agosto 2026, todos los
 * establecimientos de Bellavista; los cuatro primeros, «NO APLICA» en todas las DIRESA del país).
 * Con esta lista, agosto da 84,03 % frente al 84,04 % nacional y 29 de 33 establecimientos
 * coinciden exactos (`docs/DISPONIBILIDAD_AUDITORIA.md`, punto I). La ficha 28 excluye los
 * medicamentos «de atención exclusiva para Intervención Estratégica de Salud Pública» según el
 * listado que comunica DGIESP, que no está publicado.
 */
export const DEFAULT_DME_EXCLUDED: ExcludedEntry[] = [
  { code: "05873", name: "SODIO CLORURO 900 mg/100 mL (0.9 %) 1 L INYECTABLE", reason: "strategic" },
  { code: "05872", name: "SODIO CLORURO 900 mg/100 mL (0.9 %) 100 mL INYECTABLE", reason: "strategic" },
  { code: "05253", name: "OXITOCINA 10 UI 1 mL INYECTABLE", reason: "strategic" },
  { code: "01467", name: "CALCIO GLUCONATO 100 mg/mL (Equiv. a 8.4 mg/mL de Calcio) 10 mL INYECTABLE", reason: "strategic" },
  { code: "03576", name: "FITOMENADIONA 10 mg/mL 1 mL INYECTABLE", reason: "strategic" },
  { code: "04085", name: "INSULINA HUMANA (ADN RECOMBINANTE) 100 UI/mL 10 mL INYECTABLE", reason: "strategic" },
  { code: "22187", name: "INSULINA ISOFANA HUMANA (NPH) ADN RECOMBINANTE 100 UI/mL 10 mL INYECTABLE", reason: "strategic" },
  { code: "10221", name: "ALCOHOL ETILICO (ETANOL) 70° 1 L SOLUCION", reason: "national" },
  { code: "02187", name: "CLORHEXIDINA GLUCONATO 4 g/100 mL (4 %) 1 L SOLUCION", reason: "national" },
  { code: "16862", name: "PEROXIDO DE HIDROGENO (AGUA OXIGENADA 10 V) 3 % 1 L SOLUCION", reason: "national" },
  { code: "06517", name: "YODO POVIDONA 10 g/100 mL 1 L SOLUCION", reason: "national" },
  { code: "18077", name: "YODO POVIDONA (ESPUMA) 8.5 g/100 mL 1 L SOLUCION", reason: "national" },
  { code: "25036", name: "YODO POVIDONA (ESPUMA) 7.5 g/100 mL 1 L SOLUCION", reason: "national" },
  { code: "03560", name: "HIERRO POLIMALTOSA 50 mg/mL 30 mL SOLUCION", reason: "national" },
  { code: "06111", name: "TETRACICLINA CLORHIDRATO (UNGÜENTO OFTALMICO) 1 g/100 g (1 %) 6 g UNGÜENTO", reason: "national" },
];

/** Soluciones de gran volumen de fábrica: del catálogo SISMED (ver `services/largeVolumeProducts.ts`). */
export { DEFAULT_LARGE_VOLUME };

export interface ScopeRule {
  normostock: boolean;
  sobrestock: boolean;
  substock: boolean;
  /** En «todos los productos» solo «no» o «yes»; en la DME también «vital». */
  sinRotacion: SinRotacionRule;
  /**
   * Soluciones de gran volumen (1 L o más) disponibles desde `largeVolumeMonths` (ficha 28,
   * consideración a). De fábrica, solo en la DME.
   */
  largeVolume?: boolean;
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
  /** Soluciones de gran volumen: Normostock desde estos meses (la ficha 28 dice 1). */
  largeVolumeMonths: number;
  /**
   * Las soluciones de gran volumen: la regla se aplica solo a estos códigos (en la DME, al código
   * destino de cada grupo de fusionados). Se guarda en Supabase con la fórmula.
   */
  largeVolumeList: CodeEntry[];
  /** Medicamentos que no entran en la DME (ficha 28, criterios de exclusión). Solo la DME. */
  dmeExcluded: ExcludedEntry[];
  levels: { optimo: number; alto: number; regular: number };
  /** Microred y UNGET: promedio de sus establecimientos o suma de sus ítems. */
  aggregate: "average" | "sum";
}

export const DEFAULT_AVAILABILITY_FORMULA: AvailabilityFormula = {
  all: { normostock: true, sobrestock: true, substock: false, sinRotacion: "no", largeVolume: false },
  essential: { normostock: true, sobrestock: true, substock: false, sinRotacion: "vital", largeVolume: true },
  truncate: false,
  subMax: 2,
  sobreMin: 6,
  largeVolumeMonths: 1,
  largeVolumeList: DEFAULT_LARGE_VOLUME,
  dmeExcluded: DEFAULT_DME_EXCLUDED,
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
  /** ¿Las listas de gran volumen y de excluidos ya están guardadas en la base? Si no, rigen las de fábrica. */
  stored: { largeVolume: boolean; excluded: boolean };
}

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
/** Lista de códigos SISMED con sus ceros, sin repetidos. */
const codeList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(padCode).filter(Boolean))].sort() : []);
/** Lista de { código, nombre } (acepta también solo códigos, como se guardaba antes). */
const entryList = (v: unknown): CodeEntry[] => {
  if (!Array.isArray(v)) return [];
  const out = new Map<string, CodeEntry>();
  for (const x of v) {
    const code = padCode(x && typeof x === "object" ? (x as any).code : x);
    if (code && !out.has(code)) out.set(code, { code, name: x && typeof x === "object" ? String((x as any).name ?? "").trim() : "" });
  }
  return [...out.values()];
};
/** La lista de fábrica con los agregados y quitados a mano de la regla anterior (2026-10-09). */
const legacyLargeVolume = (o: Record<string, unknown>): CodeEntry[] => {
  const skip = new Set(codeList(o.largeVolumeSkip));
  const list = DEFAULT_LARGE_VOLUME.filter((e) => !skip.has(e.code));
  for (const e of entryList(o.largeVolumeAdd)) if (!skip.has(e.code) && !list.some((x) => x.code === e.code)) list.push(e);
  return list;
};
const reasonOf = (v: unknown): ExclusionReason | undefined => (v === "strategic" || v === "national" || v === "other" ? v : undefined);
const rule = (v: unknown, fallback: ScopeRule, allowVital: boolean): ScopeRule => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sr = o.sinRotacion === "yes" || o.sinRotacion === "no" || (allowVital && o.sinRotacion === "vital") ? (o.sinRotacion as SinRotacionRule) : fallback.sinRotacion;
  return {
    normostock: bool(o.normostock, fallback.normostock), sobrestock: bool(o.sobrestock, fallback.sobrestock), substock: bool(o.substock, fallback.substock), sinRotacion: sr,
    largeVolume: bool(o.largeVolume, !!fallback.largeVolume),
  };
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
    // Una fórmula guardada antes del 2026-10-09 no lo trae: vale la de la ficha 28.
    largeVolumeMonths: Math.min(subMax, num(o.largeVolumeMonths, d.largeVolumeMonths, 0, 24)),
    // Una fórmula guardada antes de la lista no la trae: la de fábrica, con lo que se había
    // agregado o quitado a mano entonces.
    largeVolumeList: Array.isArray(o.largeVolumeList) ? entryList(o.largeVolumeList) : legacyLargeVolume(o),
    // Una fórmula guardada antes del 2026-10-10 no la trae: vale la de fábrica. Una lista vacía
    // guardada a propósito se respeta.
    dmeExcluded: Array.isArray(o.dmeExcluded)
      ? entryList(o.dmeExcluded).map((e) => ({ ...e, reason: reasonOf((o.dmeExcluded as any[]).find((x) => padCode(x?.code ?? x) === e.code)?.reason) ?? "other" }))
      : d.dmeExcluded,
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
  stored: { largeVolume: false, excluded: false },
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
        stored: {
          largeVolume: Array.isArray((data.formula?.value as any)?.largeVolumeList),
          excluded: Array.isArray((data.formula?.value as any)?.dmeExcluded),
        },
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

/** Códigos excluidos de la DME, para `essentialRows`. */
export const dmeExcludedCodes = (f: AvailabilityFormula): Set<string> => new Set(f.dmeExcluded.map((e) => e.code));

/** Límites de la situación según la fórmula, para una vista (la regla de gran volumen va por vista). */
export const classifyOptionsOf = (f: AvailabilityFormula, scope: "all" | "essential") => ({
  truncate: f.truncate,
  subMax: f.subMax,
  sobreMin: f.sobreMin,
  ...((scope === "all" ? f.all : f.essential).largeVolume
    ? { largeVolumeMonths: f.largeVolumeMonths, largeVolumeCodes: f.largeVolumeList.map((e) => e.code) }
    : {}),
});

/** «1 mes», «1,5 meses». */
const monthsText = (n: number) => `${String(n).replace(".", ",")} ${n === 1 ? "mes" : "meses"}`;

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
  const lv = r.largeVolume ? ` · ${f.largeVolumeList.length} soluciones de gran volumen: Normostock desde ${monthsText(Math.min(f.subMax, f.largeVolumeMonths))}` : "";
  const excluded = scope === "essential" && f.dmeExcluded.length ? ` · ${f.dmeExcluded.length} medicamentos excluidos (ficha 28)` : "";
  return `Disponibilidad = (${parts.join(" + ") || "nada"}) ÷ total de ítems${r.sinRotacion === "vital" ? " (los demás sin rotación no se evalúan)" : ""}${excluded} · meses ${f.truncate ? "cortados a un decimal" : "sin cortar"} · Substock < ${f.subMax}, Sobrestock > ${f.sobreMin}${lv} · microred y UNGET: ${agg}.`;
};
