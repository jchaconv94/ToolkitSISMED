import React, { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronRight, FileClock, History, Monitor, Square, Wifi, WifiOff } from "lucide-react";
import { KpiCard, KpiStrip, StatusChip, type Tone } from "./ui/kit";
import { TablePagination } from "./ui/TablePagination";
import { FloatingTableHead, SortHeadButton, headAlignClass, nextSort, tableHeadCellClass, tableHeadTextClass, useFloatingTableHead } from "./ui/FloatingTableHead";
import { checkDatesMatch, getCardUpdateStatus, type EstablishmentCardData } from "./EstablishmentCard";

/**
 * Consulta Stock, dentro de una UNGET: la tabla de establecimientos (vista por omisión en
 * escritorio) y el panel «Estado de sincronización» que va encima. El celular sigue con su
 * lista de tarjetas (`EstablishmentMobileRow`).
 */

// Los cortes viven en `services/syncBuckets.ts`, compartidos con el resumen de Inicio.
export { syncBucketOf, type SyncBucket } from "../services/syncBuckets";
import { syncBucketOf, type SyncBucket } from "../services/syncBuckets";

const BUCKET: Record<SyncBucket, { label: string; tone: Tone; weight: number }> = {
  "al-dia": { label: "Al día", tone: "success", weight: 1 },
  retraso: { label: "Con retraso", tone: "warning", weight: 2 },
  "sin-actualizar": { label: "Sin actualizar", tone: "danger", weight: 3 },
};

/** «Hace 2h 5m», «Recién» o «Sin datos»: debajo del estado, en poco espacio. */
const shortAgo = (timestamp?: number | null) => {
  if (!timestamp) return "Sin datos";
  const label = getCardUpdateStatus(timestamp).label;
  return label === "Actualizado recientemente" ? "Recién" : label;
};

const dateTime = (value?: number | string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
};

// ---------------------------------------------------------------------------------------
// Panel «Estado de sincronización»
// ---------------------------------------------------------------------------------------

export type SyncFilter = "all" | SyncBucket;

export const EstablishmentSyncPanel: React.FC<{
  total: number;
  online: number;
  delayed: number;
  offline: number;
  active?: SyncFilter;
  /** Sin `onSelect` las cajas solo informan (panel regional: no hay lista que filtrar). */
  onSelect?: (filter: SyncFilter) => void;
  totalHint?: string;
  /** Línea bajo el título: la última sincronización (y en el panel regional, las UNGET). */
  subtitle?: React.ReactNode;
}> = ({ total, online, delayed, offline, active = "all", onSelect, totalHint = "establecimientos a la vista", subtitle }) => {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const alDia = Math.round(pct(online));
  const select = onSelect ? (filter: SyncFilter) => () => onSelect(filter === "all" || active === filter ? "all" : filter) : () => undefined;
  const isActive = (filter: SyncFilter) => Boolean(onSelect) && active === filter;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">Estado de sincronización</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <p className="text-right">
          <span className="text-2xl font-black tabular-nums text-slate-900">{alDia}%</span>
          <span className="ml-1.5 text-xs font-bold text-slate-500">al día · {online} de {total}</span>
        </p>
      </div>

      {/* Barra segmentada: verde al día, ámbar con retraso, rojo sin actualizar. */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${online} al día, ${delayed} con retraso, ${offline} sin actualizar`}>
        <span className="bg-emerald-500 transition-all duration-500" style={{ width: `${pct(online)}%` }} />
        <span className="bg-amber-400 transition-all duration-500" style={{ width: `${pct(delayed)}%` }} />
        <span className="bg-red-500 transition-all duration-500" style={{ width: `${pct(offline)}%` }} />
      </div>

      <div className="mt-4">
        <KpiStrip cols="md:grid-cols-4">
          <KpiCard watermark tone="info" icon={<Building2 />} label="Todos" value={total} hint={totalHint} onClick={onSelect && select("all")} active={isActive("all")} />
          <KpiCard watermark tone="success" icon={<Wifi />} label="Al día" value={online} hint="actualizados en la última hora" onClick={onSelect && select("al-dia")} active={isActive("al-dia")} />
          <KpiCard watermark tone="warning" icon={<FileClock />} label="Con retraso" value={delayed} hint="entre 1 y 24 horas sin actualizar" onClick={onSelect && select("retraso")} active={isActive("retraso")} />
          <KpiCard watermark tone="danger" icon={<WifiOff />} label="Sin actualizar" value={offline} hint="más de un día o sin datos" onClick={onSelect && select("sin-actualizar")} active={isActive("sin-actualizar")} />
        </KpiStrip>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------------------
// Tabla
// ---------------------------------------------------------------------------------------

type SortKey = "name" | "status" | "update" | "movement" | "expiring" | "expired" | "items";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const SORT_LABEL: Record<SortKey, string> = {
  name: "establecimiento",
  status: "estado",
  update: "última actualización",
  movement: "último movimiento",
  expiring: "por vencer",
  expired: "vencidos",
  items: "ítems",
};

/** Lo primero que se ve al ordenar por una columna: números y fechas, de mayor a menor. */
const FIRST_DIR: Record<SortKey, "asc" | "desc"> = {
  name: "asc",
  status: "desc",
  update: "desc",
  movement: "desc",
  expiring: "desc",
  expired: "desc",
  items: "desc",
};

const valueOf = (row: EstablishmentCardData, key: SortKey): number | string => {
  switch (key) {
    case "name": return row.name;
    case "status": return BUCKET[syncBucketOf(row.lastUpdateTime)].weight;
    case "update": return row.lastUpdateTime || 0;
    case "movement": return row.syncRecordDate ? new Date(row.syncRecordDate).getTime() || 0 : 0;
    case "expiring": return row.expiringThisMonthCount;
    case "expired": return row.expiredCount;
    case "items": return row.totalItems;
  }
};

/** Urgencia: primero los que no se actualizan, luego los que tienen más vencidos y por vencer. */
const byUrgency = (a: EstablishmentCardData, b: EstablishmentCardData) =>
  BUCKET[syncBucketOf(b.lastUpdateTime)].weight - BUCKET[syncBucketOf(a.lastUpdateTime)].weight ||
  b.expiredCount - a.expiredCount ||
  b.expiringThisMonthCount - a.expiringThisMonthCount ||
  a.name.localeCompare(b.name);

const PAGE_SIZE = 10;

const COLUMNS: Array<{ k: SortKey; label: string; align: "left" | "right" | "center" }> = [
  { k: "name", label: "Establecimiento", align: "left" },
  { k: "status", label: "Estado", align: "left" },
  { k: "update", label: "Última actualización", align: "left" },
  { k: "movement", label: "Últ. movimiento", align: "left" },
  { k: "expiring", label: "Por vencer", align: "center" },
  { k: "expired", label: "Vencidos", align: "center" },
  { k: "items", label: "Ítems", align: "right" },
];

export const EstablishmentTable: React.FC<{
  rows: EstablishmentCardData[];
  /** El orden lo eligió la persona en Filtros: se respeta en vez del de urgencia. */
  followGivenOrder?: boolean;
  givenOrderLabel?: string;
  onOpen: (id: string) => void;
  onShowHistory: (id: string) => void;
  isCaptureMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}> = ({ rows, followGivenOrder = false, givenOrderLabel, onOpen, onShowHistory, isCaptureMode = false, selectedIds, onToggleSelect }) => {
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);

  // Si se elige un orden en Filtros, manda ese; el de los encabezados se olvida.
  useEffect(() => {
    if (followGivenOrder) setSort(null);
  }, [followGivenOrder, givenOrderLabel]);

  const sorted = useMemo(() => {
    if (sort) {
      const mult = sort.dir === "asc" ? 1 : -1;
      return [...rows].sort((a, b) => {
        const va = valueOf(a, sort.key);
        const vb = valueOf(b, sort.key);
        const diff = typeof va === "string" ? va.localeCompare(String(vb)) : va - (vb as number);
        return diff * mult || a.name.localeCompare(b.name);
      });
    }
    return followGivenOrder ? rows : [...rows].sort(byUrgency);
  }, [rows, sort, followGivenOrder]);

  // Al cambiar la lista (búsqueda, filtro, orden) se vuelve a la primera página. Se mira
  // qué establecimientos hay, no el arreglo: se rehace en cada lectura de fondo.
  const idsKey = useMemo(() => rows.map((r) => r.id).join("|"), [rows]);
  useEffect(() => { setPage(1); }, [idsKey, sort]);

  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setSort((current) => nextSort(current, key, FIRST_DIR[key])); // Tercer toque: vuelve al orden por urgencia.
  };

  const sortButton = (k: SortKey, label: string) => (
    <SortHeadButton label={label} dir={sort?.key === k ? sort.dir : null} onClick={() => toggleSort(k)} />
  );

  const { tableRef, floating } = useFloatingTableHead([pageRows.length, isCaptureMode, sort, page]);

  const count = (value: number, tone: "amber" | "red") =>
    value > 0 ? (
      <span className={`inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-0.5 text-[13px] font-black tabular-nums ${tone === "red" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
        {value.toLocaleString("es-PE")}
      </span>
    ) : (
      <span className="text-[13px] font-bold text-slate-300">0</span>
    );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Pegado arriba al bajar: las mismas columnas (sin la de captura ni la flecha). */}
      <FloatingTableHead
        state={floating}
        cells={COLUMNS.map((col, i) => ({ key: col.k, index: i + (isCaptureMode ? 1 : 0), align: col.align, content: sortButton(col.k, col.label) }))}
      />
      <div className="overflow-x-auto rounded-t-2xl xl:overflow-visible">
        <table ref={tableRef} className="w-full text-left">
          <thead>
            <tr>
              {isCaptureMode && <th className={`w-10 rounded-tl-2xl px-4 py-3 ${tableHeadCellClass}`} />}
              {COLUMNS.map((col, i) => {
                const activeDir = sort?.key === col.k ? sort.dir : null;
                return (
                  <th
                    key={col.k}
                    scope="col"
                    aria-sort={activeDir === "asc" ? "ascending" : activeDir === "desc" ? "descending" : "none"}
                    className={`px-2.5 py-3 ${tableHeadCellClass} ${tableHeadTextClass} ${headAlignClass(col.align)} ${i === 0 && !isCaptureMode ? "rounded-tl-2xl" : ""}`}
                  >
                    {sortButton(col.k, col.label)}
                  </th>
                );
              })}
              <th className={`w-10 rounded-tr-2xl ${tableHeadCellClass}`} aria-label="Abrir" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((row) => {
              const bucket = BUCKET[syncBucketOf(row.lastUpdateTime)];
              const updated = dateTime(row.lastUpdateTime);
              const movement = dateTime(row.syncRecordDate);
              const mismatch = !checkDatesMatch(row.lastUpdateTime, row.equipmentDateTime);
              const equipment = dateTime(row.equipmentDateTime);
              const selected = selectedIds?.has(row.id) ?? false;
              const open = () => (isCaptureMode ? onToggleSelect?.(row.id) : onOpen(row.id));
              return (
                <tr
                  key={row.id}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === "Enter") open(); }}
                  tabIndex={0}
                  className={`group h-[60px] cursor-pointer transition-colors focus:outline-none focus-visible:bg-teal-50/60 ${selected ? "bg-teal-50/70" : "hover:bg-slate-50"}`}
                >
                  {isCaptureMode && (
                    <td className="px-4">
                      {selected ? <Check className="h-4 w-4 text-teal-600" /> : <Square className="h-4 w-4 text-slate-300" />}
                    </td>
                  )}
                  <td className="px-2.5 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 transition-colors group-hover:bg-teal-600 group-hover:text-white">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="line-clamp-2 min-w-[150px] max-w-[260px] leading-snug 2xl:max-w-[340px] text-[13.5px] font-bold text-slate-900 group-hover:text-teal-800" title={row.name}>{row.name}</p>
                        {row.code && <p className="font-mono text-[11px] font-bold text-slate-400">{row.code}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    <StatusChip label={bucket.label} tone={bucket.tone} />
                    <p className="mt-1 text-[11px] text-slate-400">{shortAgo(row.lastUpdateTime)}</p>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    {updated ? (
                      <>
                        <p className="text-[13px] font-semibold tabular-nums text-slate-700">{updated.date}</p>
                        <p className="flex items-center gap-1 text-[11px] tabular-nums text-slate-400">
                          {updated.time}
                          {mismatch && equipment && (
                            <span className="inline-flex items-center gap-0.5 font-bold text-rose-600" title="La fecha del equipo no coincide con la actualización">
                              · <Monitor className="h-3 w-3" /> equipo {equipment.date}
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <span className="text-[13px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    {row.isCheckingSync ? (
                      <span className="text-[12px] text-slate-400">Verificando…</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onShowHistory(row.id); }}
                        title="Ver historial de movimientos"
                        className="-mx-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-teal-50"
                      >
                        {movement ? (
                          <>
                            <p className="text-[13px] font-semibold tabular-nums text-slate-700">{movement.date}</p>
                            <p className="flex items-center gap-1 text-[11px] tabular-nums text-teal-700"><History className="h-3 w-3" />{movement.time}</p>
                          </>
                        ) : (
                          <p className="flex items-center gap-1 text-[12px] text-slate-400"><History className="h-3 w-3" />{row.hasSyncRecord ? "Sin movimientos" : "Sin verificar"}</p>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-center">{count(row.expiringThisMonthCount, "amber")}</td>
                  <td className="px-2.5 py-2.5 text-center">{count(row.expiredCount, "red")}</td>
                  <td className="px-2.5 py-2.5 text-right text-[13px] font-bold tabular-nums text-slate-700">{row.totalItems.toLocaleString("es-PE")}</td>
                  <td className="pr-4">
                    <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        <span>
          {sort
            ? `Ordenado por ${SORT_LABEL[sort.key]}.`
            : followGivenOrder
              ? `Ordenado por ${givenOrderLabel || "el orden elegido en Filtros"}.`
              : "Ordenado por urgencia: primero los que no se actualizan y los que tienen más vencidos."}
        </span>
        {sort && (
          <button type="button" onClick={() => setSort(null)} className="font-bold text-teal-700 hover:underline">
            {followGivenOrder ? "Volver al orden de Filtros" : "Volver al orden por urgencia"}
          </button>
        )}
      </div>
      <TablePagination page={page} pageSize={PAGE_SIZE} total={sorted.length} onPageChange={setPage} itemLabel="establecimientos" />
    </div>
  );
};
