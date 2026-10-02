/**
 * Consumo real del plan gratuito, leído de la API de métricas de Cloudflare (GraphQL).
 *
 * Necesita los secretos CF_ACCOUNT_ID y CF_ANALYTICS_TOKEN (permiso «Account Analytics:
 * Read», solo lectura). Cada dato se pide por separado: si uno falla, los demás siguen.
 */

import { UsageKey, UsageReading, buildUsage, r2OperationClass, utcDayStart, utcMonthStart } from "./logic";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

export interface UsageEnv {
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
}

const iso = (ms: number) => new Date(ms).toISOString();
const isoDate = (ms: number) => iso(ms).slice(0, 10);

async function query(env: UsageEnv, body: string, variables: Record<string, unknown>): Promise<any> {
  const response = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: body, variables: { accountTag: env.CF_ACCOUNT_ID, ...variables } }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { data?: any; errors?: Array<{ message: string }> };
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data?.viewer?.accounts?.[0] ?? {};
}

const sum = (rows: any[] | undefined, pick: (row: any) => number) =>
  (rows || []).reduce((total, row) => total + (Number(pick(row)) || 0), 0);

type Values = Partial<Record<UsageKey, number>>;

/** Cada consulta devuelve uno o más datos; las claves que no devuelve quedan «sin dato». */
const QUERIES: Record<string, (env: UsageEnv, now: number) => Promise<Values>> = {
  workers: async (env, now) => {
    const a = await query(env, `query($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } } } } }`,
    { start: iso(utcDayStart(now)), end: iso(now) });
    return { workers: sum(a.workersInvocationsAdaptive, (r) => r.sum?.requests) };
  },
  // Con hibernación, cada mensaje entrante de una conexión cuenta aquí como petición.
  doRequests: async (env, now) => {
    const a = await query(env, `query($accountTag: string!, $day: Date!) { viewer { accounts(filter: {accountTag: $accountTag}) {
      durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: {date_geq: $day}) { sum { requests } } } } }`,
    { day: isoDate(utcDayStart(now)) });
    return { doRequests: sum(a.durableObjectsInvocationsAdaptiveGroups, (r) => r.sum?.requests) };
  },
  // activeTime en microsegundos; se cobra con 128 MB de memoria: GB-s = s × 0,125.
  doDuration: async (env, now) => {
    const a = await query(env, `query($accountTag: string!, $day: Date!) { viewer { accounts(filter: {accountTag: $accountTag}) {
      durableObjectsPeriodicGroups(limit: 10000, filter: {date_geq: $day}) { sum { activeTime } } } } }`,
    { day: isoDate(utcDayStart(now)) });
    return { doDuration: (sum(a.durableObjectsPeriodicGroups, (r) => r.sum?.activeTime) / 1e6) * 0.125 };
  },
  r2Operations: async (env, now) => {
    const a = await query(env, `query($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: {accountTag: $accountTag}) {
      r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } dimensions { actionType } } } } }`,
    { start: iso(utcMonthStart(now)), end: iso(now) });
    const rows: any[] = a.r2OperationsAdaptiveGroups || [];
    const byClass = (cls: "A" | "B") => sum(rows.filter((r) => r2OperationClass(String(r.dimensions?.actionType)) === cls), (r) => r.sum?.requests);
    return { r2ClassA: byClass("A"), r2ClassB: byClass("B") };
  },
  r2Storage: async (env, now) => {
    const a = await query(env, `query($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: {accountTag: $accountTag}) {
      r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { max { payloadSize metadataSize } } } } }`,
    { start: iso(now - 24 * 60 * 60 * 1000), end: iso(now) });
    const rows: any[] = a.r2StorageAdaptiveGroups || [];
    const bytes = rows.reduce((top, r) => Math.max(top, (Number(r.max?.payloadSize) || 0) + (Number(r.max?.metadataSize) || 0)), 0);
    return { r2Storage: bytes / 1e9 };
  },
};

export async function readUsage(env: UsageEnv, now = Date.now()): Promise<UsageReading> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return buildUsage({}, now, "Falta la clave de métricas de Cloudflare");
  const values: Values = {};
  const failures: string[] = [];
  await Promise.all(Object.entries(QUERIES).map(async ([name, run]) => {
    try {
      Object.assign(values, await run(env, now));
    } catch (error) {
      failures.push(`${name}: ${String((error as Error).message || error).slice(0, 120)}`);
    }
  }));
  return buildUsage(values, now, failures.length ? failures.join(" · ") : undefined);
}
