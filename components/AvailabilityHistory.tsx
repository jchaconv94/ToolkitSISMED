import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarRange, Check, ChevronDown, ChevronRight, FileSpreadsheet, History, ListChecks, MapPin, MoreVertical, Settings2, Trash2, WifiOff, X } from "lucide-react";
import { EmptyState, KpiCard, KpiStrip, TableSearch } from "./ui/kit";
import { CustomSelect } from "./ui/CustomSelect";
import { BottomSheet } from "./ui/BottomSheet";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import { FloatingActionButton } from "./ui/FloatingActionButton";
import { ResponsiveDialog, dialogSecondaryButton } from "./ui/ResponsiveDialog";
import { useIsDesktop } from "./ui/useIsDesktop";
import { ChartCard, HistoryChart, HistoryLegend, InfoTip, LEVEL_COLOR, LEVEL_SOFT, TipBox, useChartTip } from "./AvailabilityCharts";
import {
  CodeChip, Delta, DrawerNavButtons, LEVEL_TONE, LevelChip, LevelPct, MONTH_SHORT, P, ReportTable, dateText, drawerNav, pctText, pp, useDrawerKeys,
  type Column,
} from "./AvailabilityReports";
import { DME_LEVEL_LABEL, dmeLevelOf, type EstablishmentInfo } from "../services/availabilityReport";
import { monthFull } from "../services/availabilityExport";
import type { AvailabilityFormula } from "../services/availabilityConfig";
import {
  HISTORY_SQL, availableOf, evaluatedCounts, historyRows, historySeries, indexHistory, recordPct, yearMonths,
  type HistoryCounts, type HistoryData, type HistoryEntityRow, type HistoryOptions, type HistorySave, type HistoryView,
} from "../services/availabilityHistory";
import { formatNumber } from "../services/numberFormat";
import type { DmeLevel } from "../services/stockStatus";

/**
 * Historial de disponibilidad (2026-10-09): pantalla principal del módulo Disponibilidad. Muestra
 * lo guardado en Supabase mes a mes, en las dos vistas (todos los productos y medicamentos
 * esenciales), con el año anterior para comparar. Solo los resultados por establecimiento: el
 * detalle por producto está en el reporte del mes, con su TFORMDET.
 */

const VIEW_LABEL: Record<HistoryView, string> = { all: "Todos los productos", essential: "Medicamentos esenciales" };
/** «Setiembre 2026». */
const monthName = (key: string) => { const t = monthFull(key); return t.charAt(0).toUpperCase() + t.slice(1); };
const shortName = (key: string) => MONTH_SHORT[Number(key.slice(4, 6)) - 1] ?? key.slice(4, 6);
const ALL = "ALL";
const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export type HistoryStatus = "loading" | "ready" | "missing-sql" | "error";

export const AvailabilityHistory: React.FC<{
  data: HistoryData | null;
  status: HistoryStatus;
  error?: string;
  /** Sin internet: lo que se ve es la última copia guardada en este equipo. */
  offline: boolean;
  registry: Map<string, EstablishmentInfo>;
  formula: AvailabilityFormula;
  scopeTitle: string;
  year: number;
  years: number[];
  onYear: (year: number) => void;
  onOpenReport: () => void;
  /** Mes del TFORMDET guardado en este equipo, para abrirlo directo. */
  storedReport: string | null;
  canRemove: boolean;
  onRemoveMonth: (month: string) => Promise<void>;
  isAdmin: boolean;
  onConfig: () => void;
  /** ¿Está fuera del análisis? (lista de «Establecimientos del análisis»). */
  isOut: (code: string) => boolean;
  onEditSites: () => void;
}> = ({ data, status, error, offline, registry, formula, scopeTitle, year, years, onYear, onOpenReport, storedReport, canRemove, onRemoveMonth, isAdmin, onConfig, isOut, onEditSites }) => {
  const isDesktop = useIsDesktop();
  // La vista la eligen las dos tarjetas de arriba (Todos / Esenciales) y vale para toda la pantalla.
  const [view, setView] = useState<HistoryView>("all");
  // Qué se mira (selector «Ver»): toda la jurisdicción, una UNGET, una microred o un establecimiento.
  const [unget, setUnget] = useState(ALL);
  const [microred, setMicrored] = useState(ALL);
  const [site, setSite] = useState(ALL);
  const [tab, setTab] = useState<TableTab>("groups");
  const [picked, setPicked] = useState<number | null>(null);
  const [openState, setOpenState] = useState<{ row: HistoryEntityRow; list: HistoryEntityRow[] } | null>(null);
  const [monthsOpen, setMonthsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const opts: HistoryOptions = useMemo(() => ({ rules: { all: formula.all, essential: formula.essential }, aggregate: formula.aggregate, levels: formula.levels }), [formula]);
  const levelOf = (v: number) => dmeLevelOf(v, formula.levels);
  const index = useMemo(() => indexHistory(data?.records ?? []), [data]);
  const months = useMemo(() => yearMonths(year), [year]);
  const prevMonths = useMemo(() => yearMonths(year - 1), [year]);

  const ungetOf = (code: string) => registry.get(code)?.red || "Sin registro";
  const microredOf = (code: string) => registry.get(code)?.microred || "Sin microred";
  const nameOf = (code: string) => registry.get(code)?.name || code;
  const codes = useMemo(() => [...new Set((data?.records ?? []).map((r) => r.code))], [data]);
  const ungets = useMemo(() => [...new Set(codes.map(ungetOf))].sort((a, b) => a.localeCompare(b, "es")), [codes, registry]); // eslint-disable-line react-hooks/exhaustive-deps
  const microredes = useMemo(() => [...new Set(codes.filter((c) => unget === ALL || ungetOf(c) === unget).map(microredOf))].sort((a, b) => a.localeCompare(b, "es")), [codes, unget, registry]); // eslint-disable-line react-hooks/exhaustive-deps
  // Los establecimientos fuera del análisis no cuentan: se ven aparte, en su propia pestaña.
  const inPlace = (code: string) => (unget === ALL || ungetOf(code) === unget) && (microred === ALL || microredOf(code) === microred) && (site === ALL || code === site);
  const inFilter = (code: string) => inPlace(code) && !isOut(code);

  const series = useMemo(() => ({
    all: historySeries(index, "all", months, inFilter, opts),
    essential: historySeries(index, "essential", months, inFilter, opts),
    prevAll: historySeries(index, "all", prevMonths, inFilter, opts),
    prevEssential: historySeries(index, "essential", prevMonths, inFilter, opts),
  }), [index, months, prevMonths, opts, unget, microred, site, registry, isOut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Establecimientos esperados: los que tienen algo guardado en el año, dentro de lo que se mira.
  const expected = useMemo(() => {
    const set = new Set<string>();
    for (const v of ["all", "essential"] as HistoryView[]) for (const m of months) for (const code of index.get(v)?.get(m)?.keys() ?? []) if (inFilter(code)) set.add(code);
    return set;
  }, [index, months, unget, microred, site, registry, isOut]); // eslint-disable-line react-hooks/exhaustive-deps
  const coverage = series.all.map((p, i) => ({ establishments: Math.max(p.establishments, series.essential[i].establishments), expected: expected.size }));
  const withData = months.map((_, i) => series.all[i].pct !== null || series.essential[i].pct !== null);
  const lastIdx = withData.lastIndexOf(true);
  const sel = picked !== null && withData[picked] ? picked : lastIdx >= 0 ? lastIdx : null;
  // Columnas de meses: hasta el último con datos (en un año pasado, los 12).
  const shown = lastIdx < 0 ? 0 : Math.max(lastIdx + 1, sel !== null ? sel + 1 : 0);
  const savedCount = withData.filter(Boolean).length;
  const missing = months.slice(0, lastIdx + 1).filter((_, i) => !withData[i]);

  const savesOf = (month: string) => (data?.saves ?? []).filter((s) => s.month === month).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const selMonth = sel !== null ? months[sel] : null;
  const lastSave = selMonth ? savesOf(selMonth)[0] : undefined;

  // Microred o UNGET, según lo que se mira: con varias UNGET y ninguna elegida, por UNGET.
  const byUnget = unget === ALL && ungets.length > 1;
  const groupRows = useMemo(() => {
    // Con una microred o un establecimiento elegidos, la pestaña de microredes sobra (sería una fila).
    if (!byUnget && (microredes.length < 2 || microred !== ALL || site !== ALL)) return null;
    return historyRows(index, view, months, (code) => (inFilter(code) ? (byUnget ? ungetOf(code) : microredOf(code)) : null), (key) => ({ name: key, group: "" }), opts);
  }, [index, view, months, byUnget, microredes, opts, unget, microred, site, registry, isOut]); // eslint-disable-line react-hooks/exhaustive-deps
  const establishmentRows = useMemo(
    () => historyRows(index, view, months, (code) => (inFilter(code) ? code : null), (code) => ({ name: nameOf(code), group: byUnget ? `${ungetOf(code)} · ${microredOf(code)}` : microredOf(code) }), opts),
    [index, view, months, opts, unget, microred, site, registry, byUnget, isOut], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const outsideRows = useMemo(
    () => historyRows(index, view, months, (code) => (inPlace(code) && isOut(code) ? code : null), (code) => ({ name: nameOf(code), group: byUnget ? `${ungetOf(code)} · ${microredOf(code)}` : microredOf(code) }), opts),
    [index, view, months, opts, unget, microred, site, registry, byUnget, isOut], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (status === "loading") {
    return <div className="grid min-h-[40vh] place-items-center"><p className="text-[13px] text-slate-500">Cargando el historial…</p></div>;
  }

  const reportButton = (
    <button type="button" onClick={onOpenReport} className="hidden h-10 shrink-0 items-center gap-2 rounded-xl bg-teal-600 px-4 text-[13px] font-bold text-white transition-colors hover:bg-teal-700 md:flex" title={storedReport ? `Guardado en este equipo: ${storedReport}` : "Subir el TFORMDET del mes"}>
      <FileSpreadsheet className="h-4 w-4" />Reporte del mes<ArrowRight className="h-4 w-4" />
    </button>
  );
  const fab = <FloatingActionButton icon={<FileSpreadsheet />} label="Reporte del mes" onClick={onOpenReport} />;

  if (status === "missing-sql" || status === "error" || !data || !data.months.length) {
    const title = status === "missing-sql" ? "El historial aún no está instalado" : status === "error" ? "No se pudo leer el historial" : "Aún no hay meses guardados";
    const description = status === "missing-sql"
      ? isAdmin ? `Falta aplicar ${HISTORY_SQL} en Supabase. Mientras tanto, el reporte del mes funciona como siempre.` : "Mientras tanto, el reporte del mes funciona como siempre."
      : status === "error" ? error || "Revise la conexión e inténtelo otra vez."
      : "Abra el reporte del mes, suba el TFORMDET y use «Guardar en el historial». Cada mes guardado aparece aquí.";
    return (
      <div className="pb-24 md:pb-8">
        <HistoryTitle scopeTitle={scopeTitle} subtitle="Disponibilidad mes a mes" right={reportButton} />
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <EmptyState icon={<History className="h-6 w-6" />} title={title} description={description} action={
            <button type="button" onClick={onOpenReport} className="flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-[13px] font-bold text-white hover:bg-teal-700">
              <FileSpreadsheet className="h-4 w-4" />{storedReport ? `Abrir el reporte de ${storedReport}` : "Reporte del mes"}<ArrowRight className="h-4 w-4" />
            </button>
          } />
        </div>
        {fab}
      </div>
    );
  }

  const pctAt = (s: typeof series.all, i: number | null) => (i === null ? null : s[i].pct);
  const kpi = (v: HistoryView) => {
    const cur = pctAt(v === "all" ? series.all : series.essential, sel);
    const prev = pctAt(v === "all" ? series.prevAll : series.prevEssential, sel);
    const pick = { onClick: () => setView(v), active: view === v };
    if (cur === null) return <KpiCard watermark tone="neutral" label={VIEW_LABEL[v]} value="—" hint={v === "essential" ? "Sin datos: el TFORMDET no traía la clasificación" : "Sin datos ese mes"} {...pick} />;
    const level = levelOf(cur);
    const hint = prev === null ? `Nivel ${DME_LEVEL_LABEL[level]} · sin datos de ${monthName(prevMonths[sel!])}` : `Nivel ${DME_LEVEL_LABEL[level]} · ${pp(cur - prev)} vs ${shortName(prevMonths[sel!]).toLowerCase()} ${year - 1}`;
    return <KpiCard watermark tone={LEVEL_TONE[level]} label={VIEW_LABEL[v]} value={pctText(cur)} hint={hint} {...pick} />;
  };
  const cov = sel !== null ? coverage[sel] : null;
  const complete = !!cov && cov.establishments >= cov.expected;

  const monthCols: Column<HistoryEntityRow>[] = months.slice(0, shown).map((m, i) => ({
    key: `m${m}`,
    label: shortName(m),
    sort: (r) => r.pct[i],
    firstDir: "desc",
    render: (r) => <LevelPct pct={r.pct[i]} levelOf={levelOf} />,
  }));
  const deltaOf = (r: HistoryEntityRow) => (sel === null || r.pct[sel] === null || r.previous[sel] === null ? null : r.pct[sel]! - r.previous[sel]!);
  const deltaLabel = sel !== null ? `vs ${shortName(months[sel])} ${String(year - 1).slice(2)}` : "Variación";
  const excelMonths = months.slice(0, shown).map((m, i) => ({ header: monthName(m), width: 11, fmt: "dec1" as const, value: (r: HistoryEntityRow) => r.pct[i] ?? "" }));

  const yearOptions = years.map((y) => ({ value: String(y), label: String(y) }));
  const monthOptions = months.map((m, i) => ({ value: String(i), label: monthName(m), disabled: !withData[i] })).filter((o) => !o.disabled);
  const outsideCount = codes.filter((c) => isOut(c)).length;

  // Selector «Ver»: la jurisdicción, sus UNGET, sus microredes y sus establecimientos del análisis.
  const focusValue = site !== ALL ? `s:${site}` : microred !== ALL ? `m:${unget}|${microred}` : unget !== ALL ? `u:${unget}` : "all";
  const focusLabel = site !== ALL ? nameOf(site) : microred !== ALL ? `Microred ${microred}` : unget !== ALL ? `UNGET ${unget}` : ungets.length > 1 ? "Todas las UNGET" : scopeTitle;
  const setFocus = (value: string) => {
    if (value === "all") { setUnget(ALL); setMicrored(ALL); setSite(ALL); }
    else if (value.startsWith("u:")) { setUnget(value.slice(2)); setMicrored(ALL); setSite(ALL); }
    else if (value.startsWith("m:")) { const [u, m] = value.slice(2).split("|"); setUnget(u); setMicrored(m); setSite(ALL); }
    else if (value.startsWith("s:")) { const code = value.slice(2); setUnget(ungetOf(code)); setMicrored(microredOf(code)); setSite(code); }
  };
  const inAnalysis = codes.filter((c) => !isOut(c));
  const microredPairs = [...new Map(inAnalysis.map((c) => [`${ungetOf(c)}|${microredOf(c)}`, { unget: ungetOf(c), microred: microredOf(c) }])).values()].sort((a, b) => a.microred.localeCompare(b.microred, "es"));
  const focusGroups: FocusGroup[] = [
    { title: ungets.length > 1 ? "Jurisdicción" : "UNGET", items: [{ value: "all", label: ungets.length > 1 ? "Todas las UNGET" : scopeTitle }] },
    ...(ungets.length > 1 ? [{ title: "UNGET", items: ungets.map((u) => ({ value: `u:${u}`, label: `UNGET ${u}` })) }] : []),
    ...(microredPairs.length > 1 ? [{ title: "Microredes", items: microredPairs.map((p) => ({ value: `m:${p.unget}|${p.microred}`, label: p.microred, hint: ungets.length > 1 ? p.unget : undefined })) }] : []),
    { title: "Establecimientos", items: inAnalysis.map((c) => ({ value: `s:${c}`, label: nameOf(c), hint: microredOf(c), search: c })).sort((a, b) => a.label.localeCompare(b.label, "es")) },
  ];
  const subtitle = `${focusLabel}${outsideCount ? ` · ${outsideCount} fuera del análisis` : ""}`;

  // Ranking del mes, al lado de la evolución: lo que hay debajo de lo que se mira.
  const rankingLevel: "unget" | "microred" | "site" | "situations" = site !== ALL ? "situations" : byUnget ? "unget" : microred === ALL && microredes.length > 1 ? "microred" : "site";
  const rankingItems = sel === null ? [] : rankingLevel === "situations" ? [] : (rankingLevel === "site" ? establishmentRows : groupRows ?? [])
    .map((r) => ({ key: r.key, name: r.name, pct: r.pct[sel] }))
    .filter((r): r is { key: string; name: string; pct: number } => r.pct !== null)
    .sort((a, b) => b.pct - a.pct);
  const situationCounts = site !== ALL && selMonth ? (() => {
    const raw = index.get(view)?.get(selMonth)?.get(site);
    return raw ? evaluatedCounts(raw, opts.rules[view], view) : undefined;
  })() : undefined;
  const drill = (key: string) => setFocus(rankingLevel === "unget" ? `u:${key}` : rankingLevel === "microred" ? `m:${unget !== ALL ? unget : ungetOf(codes.find((c) => microredOf(c) === key) ?? "")}|${key}` : `s:${key}`);
  const rankingSubtitle = rankingLevel === "situations" ? "Situaciones del mes" : rankingLevel === "unget" ? "UNGET de mayor a menor" : rankingLevel === "microred" ? "Microredes de mayor a menor" : "Establecimientos de mayor a menor";
  // Ruta de lo que se mira, para volver atrás desde el ranking (pedido del usuario: «no sé cómo volver»).
  const rootLabel = ungets.length > 1 ? "Todas las UNGET" : scopeTitle;
  const crumbs: Array<{ label: string; value: string }> = [
    { label: rootLabel, value: "all" },
    ...(unget !== ALL && ungets.length > 1 ? [{ label: `UNGET ${unget}`, value: `u:${unget}` }] : []),
    ...(microred !== ALL ? [{ label: microred, value: `m:${unget}|${microred}` }] : []),
    ...(site !== ALL ? [{ label: nameOf(site), value: `s:${site}` }] : []),
  ];
  const currentPct = pctAt(view === "all" ? series.all : series.essential, sel);

  const menuItems = (
    <>
      <button type="button" onClick={() => { setMenuOpen(false); setMonthsOpen(true); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 hover:bg-slate-50">
        <CalendarRange className="h-5 w-5" />Meses guardados
      </button>
      <button type="button" onClick={() => { setMenuOpen(false); onEditSites(); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 hover:bg-slate-50">
        <ListChecks className="h-5 w-5" /><span className="flex-1 text-left">Establecimientos del análisis</span>
        {outsideCount > 0 && <span className="text-[12px] font-bold text-slate-400">{outsideCount} fuera</span>}
      </button>
      {isAdmin && (
        <button type="button" onClick={() => { setMenuOpen(false); onConfig(); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 hover:bg-slate-50">
          <Settings2 className="h-5 w-5" />Configuración de la fórmula
        </button>
      )}
    </>
  );

  // Una sola tabla con pestañas: microredes (o UNGET), establecimientos y los de fuera del análisis.
  const tabs: Array<[TableTab, string, number]> = [
    ...(groupRows ? [["groups", byUnget ? "UNGET" : "Microredes", groupRows.length] as [TableTab, string, number]] : []),
    ["sites", "Establecimientos", establishmentRows.length],
    ...(outsideRows.length ? [["outside", "Fuera del análisis", outsideRows.length] as [TableTab, string, number]] : []),
  ];
  const activeTab: TableTab = tabs.some(([t]) => t === tab) ? tab : tabs[0][0];
  const tabBar = (
    <div className="hide-scrollbar flex shrink-0 overflow-x-auto rounded-xl bg-slate-100 p-1 text-[13px] font-bold">
      {tabs.map(([t, label, n]) => (
        <button key={t} type="button" onClick={() => setTab(t)} className={`shrink-0 rounded-lg px-3 py-1.5 transition-colors ${activeTab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          {label} <span className="text-slate-400">{n}</span>
        </button>
      ))}
    </div>
  );
  const siteColumns: Column<HistoryEntityRow>[] = [
    { key: "name", label: "Establecimiento", sort: (r) => r.name, render: (r) => <span className="block max-w-[260px]"><span className="block truncate font-semibold text-slate-800">{r.name}</span><span className="block truncate text-[11.5px] text-slate-500">{r.group}</span></span> },
    ...monthCols,
    { key: "delta", label: deltaLabel, sort: (r) => deltaOf(r), render: (r) => <Delta value={deltaOf(r)} /> },
  ];
  const siteCard = (r: HistoryEntityRow) => (
    <>
      <p className="font-semibold text-slate-800">{r.name}</p>
      <p className="text-[12px] text-slate-500">{r.group}</p>
      {sel !== null && (
        <div className="mt-2 flex items-center justify-between text-[12.5px]">
          <span className="flex items-center gap-2 text-slate-600">{shortName(months[sel])} <LevelPct pct={r.pct[sel]} levelOf={levelOf} /></span>
          <Delta value={deltaOf(r)} />
        </div>
      )}
    </>
  );
  const table = activeTab === "groups" && groupRows ? (
    <ReportTable
      key="groups"
      lead={tabBar}
      rows={groupRows}
      columns={[
        { key: "name", label: byUnget ? "UNGET" : "Microred", sort: (r) => r.name, render: (r) => <span className="font-semibold text-slate-800">{r.name}</span> },
        ...monthCols,
        { key: "delta", label: deltaLabel, sort: (r) => deltaOf(r), render: (r) => <Delta value={deltaOf(r)} /> },
      ]}
      rowKey={(r) => r.key}
      itemLabel={byUnget ? "UNGET" : "microredes"}
      onRowClick={(r) => drill(r.key)}
      minWidth={260 + shown * 76}
      excel={{ name: byUnget ? "UNGET" : "Microredes", title: `${byUnget ? "UNGET" : "Microredes"} mes a mes · ${VIEW_LABEL[view]}`, subtitle: `${focusLabel} · ${year}`, columns: [
        { header: byUnget ? "UNGET" : "Microred", width: 26, value: (r) => r.name }, ...excelMonths,
      ] }}
      card={(r) => (
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-800">{r.name}</span>
          <span className="flex items-center gap-2 text-[12.5px] text-slate-500">{sel !== null && <>{shortName(months[sel])} <LevelPct pct={r.pct[sel]} levelOf={levelOf} /></>}<Delta value={deltaOf(r)} /></span>
        </div>
      )}
    />
  ) : activeTab === "outside" ? (
    <ReportTable
      key="outside"
      lead={tabBar}
      rows={outsideRows}
      columns={siteColumns}
      rowKey={(r) => r.key}
      itemLabel="establecimientos"
      searchOf={(r) => `${r.key} ${r.name} ${r.group}`}
      placeholder="Buscar establecimiento…"
      toolbar={
        <button type="button" onClick={onEditSites} className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50">
          <ListChecks className="h-4 w-4" />Cambiar
        </button>
      }
      onRowClick={(row, list) => setOpenState({ row, list })}
      minWidth={300 + shown * 76}
      card={siteCard}
    />
  ) : (
    <ReportTable
      key="sites"
      lead={tabBar}
      rows={establishmentRows}
      columns={siteColumns}
      rowKey={(r) => r.key}
      itemLabel="establecimientos"
      searchOf={(r) => `${r.key} ${r.name} ${r.group}`}
      placeholder="Buscar establecimiento o microred…"
      onRowClick={(row, list) => setOpenState({ row, list })}
      minWidth={300 + shown * 76}
      excel={{ name: "Establecimientos", title: `Establecimientos mes a mes · ${VIEW_LABEL[view]}`, subtitle: `${focusLabel} · ${year}`, columns: [
        { header: "Código", width: 9, value: (r) => r.key }, { header: "Establecimiento", width: 34, value: (r) => r.name }, { header: "Microred", width: 20, value: (r) => r.group }, ...excelMonths,
      ] }}
      card={siteCard}
    />
  );

  return (
    <div className="space-y-4 pb-24 md:pb-8">
      <HistoryTitle
        scopeTitle="Historial de disponibilidad"
        subtitle={subtitle}
        right={
          <>
            {isDesktop && (
              <>
                <CustomSelect value={String(year)} onChange={(v) => { onYear(Number(v)); setPicked(null); }} options={yearOptions} ariaLabel="Año" className="h-10 w-[96px]" searchable={false} />
                <CustomSelect value={sel !== null ? String(sel) : ""} onChange={(v) => setPicked(Number(v))} options={monthOptions} ariaLabel="Mes" className="h-10 w-[170px]" searchable={false} />
                <FocusPicker value={focusValue} label={focusLabel} groups={focusGroups} onChange={setFocus} />
              </>
            )}
            {reportButton}
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Más acciones" title="Más acciones" className={`grid h-10 w-10 place-items-center rounded-xl border bg-white text-slate-600 hover:bg-slate-50 ${menuOpen ? "border-teal-300 ring-2 ring-teal-500/20" : "border-slate-200"}`}>
                <MoreVertical className="h-4 w-4" />
              </button>
              {isDesktop && menuOpen && (
                <div role="menu" className="absolute right-0 top-12 z-40 w-[280px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">{menuItems}</div>
              )}
            </div>
          </>
        }
      />

      {!isDesktop && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-[104px] shrink-0"><CustomSelect value={String(year)} onChange={(v) => { onYear(Number(v)); setPicked(null); }} options={yearOptions} ariaLabel="Año" className="h-10" searchable={false} /></div>
            <div className="min-w-0 flex-1"><CustomSelect value={sel !== null ? String(sel) : ""} onChange={(v) => setPicked(Number(v))} options={monthOptions} ariaLabel="Mes" className="h-10" searchable={false} /></div>
          </div>
          <FocusPicker value={focusValue} label={focusLabel} groups={focusGroups} onChange={setFocus} />
        </div>
      )}

      {offline && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[12.5px] font-semibold text-amber-800"><WifiOff className="h-4 w-4 shrink-0" />Sin conexión: se muestra la última copia del historial guardada en este equipo.</p>
      )}

      {lastIdx < 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title={`No hay meses guardados en ${year}`}
            description={`Hay meses guardados en ${[...new Set(data.months.map((m) => m.slice(0, 4)))].sort().reverse().join(", ")}. Elija otro año arriba.`}
          />
        </div>
      ) : (
      <>
      <KpiStrip cols="md:grid-cols-2 xl:grid-cols-4">
        {kpi("all")}
        {kpi("essential")}
        <KpiCard
          watermark
          tone={complete ? "success" : "warning"}
          label="Establecimientos con datos"
          value={cov ? `${formatNumber(cov.establishments)} de ${formatNumber(cov.expected)}` : "—"}
          hint={lastSave ? `${selMonth ? monthName(selMonth) : ""} · ${lastSave.savedByName} · ${dateText(new Date(lastSave.savedAt))}` : undefined}
        />
        <KpiCard
          watermark
          tone={missing.length ? "warning" : "info"}
          label={`Meses guardados en ${year}`}
          value={`${savedCount} de ${lastIdx + 1}`}
          hint={missing.length ? `Falta ${missing.map((m) => shortName(m).toLowerCase()).join(", ")}` : "Sin meses salteados · ver quién los guardó"}
          onClick={() => setMonthsOpen(true)}
        />
      </KpiStrip>

      <div className="grid gap-4 xl:grid-cols-2">
        {(() => {
          const values = (view === "all" ? series.all : series.essential).map((p) => p.pct);
          const previous = (view === "all" ? series.prevAll : series.prevEssential).map((p) => p.pct);
          const empty = [...values, ...previous].every((x) => x === null);
          return (
            <ChartCard
              title={`${VIEW_LABEL[view]} · ${focusLabel}`}
              info={<><P>Disponibilidad guardada de cada mes de {year} de lo elegido en «Ver», con la fórmula vigente; la línea punteada es {year - 1}. La vista (todos los productos o medicamentos esenciales) se cambia tocando su tarjeta.</P><P>Un mes sin guardar corta la línea. Un punto hueco con borde ámbar es un mes en que faltan establecimientos. Toque un mes para verlo en los indicadores.</P></>}
              action={empty ? undefined : <HistoryLegend current={String(year)} previous={String(year - 1)} />}
            >
              {empty ? (
                <EmptyState
                  title={`Sin datos de ${VIEW_LABEL[view].toLowerCase()} en ${year}`}
                  description={view === "essential" ? "Se guardan cuando el TFORMDET trae la clasificación de los productos (Toolkit 2.2.5 o posterior)." : undefined}
                />
              ) : (
                <HistoryChart
                  labels={months.map(shortName)}
                  titles={months.map(monthName)}
                  values={values}
                  previous={previous}
                  currentLabel={String(year)}
                  previousLabel={String(year - 1)}
                  previousTitles={prevMonths.map(monthName)}
                  coverage={site !== ALL ? [] : coverage}
                  selected={sel}
                  onSelect={setPicked}
                  levels={formula.levels}
                  levelLabels={DME_LEVEL_LABEL}
                  levelOf={levelOf}
                />
              )}
            </ChartCard>
          );
        })()}
        <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-1 flex min-h-[28px] items-center gap-2">
            {crumbs.length > 1 && (
              <button type="button" onClick={() => setFocus(crumbs[crumbs.length - 2].value)} aria-label={`Volver a ${crumbs[crumbs.length - 2].label}`} title={`Volver a ${crumbs[crumbs.length - 2].label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <nav aria-label="Ruta" className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px]">
              {crumbs.map((c, i) => (
                <React.Fragment key={c.value}>
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
                  {i < crumbs.length - 1 ? (
                    <button type="button" onClick={() => setFocus(c.value)} className="min-w-0 shrink truncate font-bold text-teal-700 hover:underline">{c.label}</button>
                  ) : (
                    <span className="min-w-0 truncate font-black text-slate-900">{c.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
            {site !== ALL ? (
              <button type="button" onClick={() => { const row = establishmentRows.find((r) => r.key === site); if (row) setOpenState({ row, list: [row] }); }} className="shrink-0 text-[12px] font-bold text-teal-700 hover:underline">Ver detalle</button>
            ) : (
              <InfoTip title="Ranking del mes">
                <P>Disponibilidad de cada {rankingLevel === "unget" ? "UNGET" : rankingLevel === "microred" ? "microred" : "establecimiento"} en el mes elegido, de mayor a menor, sobre las franjas de nivel. La línea punteada es el promedio de lo que se mira.</P>
                <P>{rankingLevel === "site" ? "Toque un establecimiento para ver sus situaciones del mes." : "Toque una barra para bajar a ella."} Para volver, use la flecha o la ruta de arriba.</P>
              </InfoTip>
            )}
          </div>
          <p className="mb-2 text-[11.5px] font-semibold text-slate-400">{rankingSubtitle}{selMonth ? ` · ${monthName(selMonth)}` : ""}</p>
          {rankingLevel === "situations" ? (
            <SituationBars counts={situationCounts} />
          ) : (
            <RankingBars items={rankingItems} average={currentPct} levels={formula.levels} levelOf={levelOf} onPick={drill} pickNote={rankingLevel === "site" ? "Clic para ver sus situaciones" : `Clic para ver sus ${rankingLevel === "unget" ? "microredes" : "establecimientos"}`} />
          )}
        </section>
      </div>

      {table}
      </>
      )}

      <HistoryEstablishmentDrawer
        state={openState}
        onClose={() => setOpenState(null)}
        onMove={(row) => setOpenState((cur) => (cur ? { ...cur, row } : null))}
        index={index}
        data={data}
        months={months}
        prevMonths={prevMonths}
        sel={sel}
        year={year}
        opts={opts}
        formula={formula}
        registry={registry}
      />

      <SavedMonthsDialog
        open={monthsOpen}
        onClose={() => setMonthsOpen(false)}
        year={year}
        months={months}
        withData={withData}
        coverage={coverage}
        savesOf={savesOf}
        canRemove={canRemove}
        onRemove={onRemoveMonth}
        formula={formula}
      />

      <BottomSheet open={menuOpen && !isDesktop} title="Acciones" onClose={() => setMenuOpen(false)}>{menuItems}</BottomSheet>
      {fab}
    </div>
  );
};

type TableTab = "groups" | "sites" | "outside";

/* ---------------------------------------------------------------- Selector «Ver» */

type FocusGroup = { title: string; items: Array<{ value: string; label: string; hint?: string; search?: string }> };
const FOCUS_LIMIT = 40;

/**
 * Qué se mira en el historial: la jurisdicción, una UNGET, una microred o un establecimiento.
 * Desplegable con buscador en escritorio; panel inferior en el celular.
 */
const FocusPicker: React.FC<{ value: string; label: string; groups: FocusGroup[]; onChange: (value: string) => void }> = ({ value, label, groups, onChange }) => {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(""); };
  const filtered = groups.map((g) => {
    const items = q ? g.items.filter((i) => fold(`${i.label} ${i.hint ?? ""} ${i.search ?? ""}`).includes(q)) : g.items;
    return { ...g, items: items.slice(0, FOCUS_LIMIT), more: Math.max(0, items.length - FOCUS_LIMIT) };
  }).filter((g) => g.items.length);
  const list = (
    <>
      {filtered.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-slate-500">Nada coincide con la búsqueda.</p>}
      {filtered.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 pt-3 text-[10.5px] font-black uppercase tracking-wider text-slate-400">{g.title}</p>
          {g.items.map((i) => (
            <button key={i.value} type="button" onClick={() => pick(i.value)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ${value === i.value ? "bg-teal-50 text-teal-800" : "text-slate-700 hover:bg-slate-50"}`}>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold">{i.label}</span>{i.hint && <span className="block truncate text-[11.5px] font-semibold text-slate-400">{i.hint}</span>}</span>
              {value === i.value && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
          {g.more > 0 && <p className="px-3 py-1.5 text-[12px] text-slate-400">y {formatNumber(g.more)} más · escriba para buscar</p>}
        </div>
      ))}
    </>
  );
  const trigger = (
    <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} className={`flex h-10 w-full items-center gap-2 rounded-xl border bg-white px-3 text-left text-[13px] font-bold text-slate-700 md:w-[250px] ${open ? "border-teal-300 ring-2 ring-teal-500/20" : "border-slate-200 hover:bg-slate-50"}`}>
      <MapPin className="h-4 w-4 shrink-0 text-teal-600" /><span className="min-w-0 flex-1 truncate">{label}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
  if (!isDesktop) {
    return (
      <>
        {trigger}
        <BottomSheet open={open} title="Ver" onClose={() => { setOpen(false); setQuery(""); }}>
          <TableSearch value={query} onChange={setQuery} placeholder="Buscar microred o establecimiento…" className="md:max-w-none" />
          {list}
        </BottomSheet>
      </>
    );
  }
  return (
    <div className="relative">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => { setOpen(false); setQuery(""); }} />
          <div className="absolute right-0 top-12 z-40 w-[340px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            <TableSearch value={query} onChange={setQuery} placeholder="Buscar microred o establecimiento…" className="md:max-w-none" />
            <div className="hide-scrollbar max-h-[380px] overflow-y-auto">{list}</div>
          </div>
        </>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- Ranking del mes */

/**
 * Ranking del mes sobre las franjas de nivel (Bajo, Regular, Alto, Óptimo, las mismas del gráfico
 * de evolución), con una sola línea punteada de promedio que atraviesa todas las barras y dice qué
 * es. Las filas reparten el alto de la tarjeta (sin espacio en blanco); si son muchas, la lista se
 * desplaza dentro.
 */
const RankingBars: React.FC<{
  items: Array<{ key: string; name: string; pct: number }>;
  average: number | null;
  levels: { optimo: number; alto: number; regular: number };
  levelOf: (v: number) => DmeLevel;
  onPick: (key: string) => void;
  pickNote: string;
}> = ({ items, average, levels, levelOf, onPick, pickNote }) => {
  const isDesktop = useIsDesktop();
  const tip = useChartTip();
  const [hoverKey, setHover] = useState<string | null>(null);
  if (!items.length) return <EmptyState title="Sin datos ese mes" />;
  // Al bajar de nivel la fila señalada desaparece sin «mouseleave»: no debe apagar las nuevas.
  const hover = hoverKey && items.some((i) => i.key === hoverKey) ? hoverKey : null;
  // Escala desde 40 % como el ranking del reporte (antes se ajustaba a los datos y las barras se veían cortas).
  const min = Math.max(0, Math.min(40, Math.floor((Math.min(...items.map((i) => i.pct), average ?? 100) - 5) / 10) * 10));
  const pos = (v: number) => ((Math.max(min, Math.min(100, v)) - min) / (100 - min)) * 100;
  const nameW = isDesktop ? 150 : 104;
  // Las franjas llegan al borde de la tarjeta (sin espacio vacío a la derecha): la cifra va pegada al
  // final de su barra y, si no cabe afuera, dentro de ella en blanco.
  const insideFrom = isDesktop ? 86 : 74;
  const barH = items.length <= 4 ? 30 : items.length <= 6 ? 26 : items.length <= 10 ? 22 : 18;
  const bands: Array<[number, number, DmeLevel]> = ([[min, levels.regular, "BAJO"], [levels.regular, levels.alto, "REGULAR"], [levels.alto, levels.optimo, "ALTO"], [levels.optimo, 100, "OPTIMO"]] as Array<[number, number, DmeLevel]>).filter(([a, b]) => b > a && b > min);
  const avgPos = average !== null ? pos(average) : null;
  return (
    <div className="flex flex-1 flex-col">
      {/* Crece con las filas (hasta 8 en escritorio y 12 en el celular); si son más, la lista se desplaza dentro. */}
      <div className="relative flex flex-1 flex-col" style={{ minHeight: Math.max(240, Math.min(items.length, isDesktop ? 8 : 12) * 38 + 56) }}>
        {/* Franjas, etiquetas de nivel y línea de promedio: sobre la columna de las barras. */}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: nameW + 12, right: 0 }}>
          {bands.map(([a, b, l]) => (
            <div key={l} className="absolute bottom-6 top-7" style={{ left: `${pos(a)}%`, width: `${pos(b) - pos(a)}%`, background: LEVEL_SOFT[l] }} />
          ))}
          {isDesktop && bands.map(([a, b, l]) => (
            <span key={`t${l}`} className="absolute bottom-0 flex justify-center whitespace-nowrap text-[10.5px] font-bold" style={{ left: `${pos(a)}%`, width: `${pos(b) - pos(a)}%`, color: LEVEL_COLOR[l] }}>
              {DME_LEVEL_LABEL[l]}
            </span>
          ))}
          {avgPos !== null && (
            <>
              <div className="absolute bottom-6 top-7 border-l-2 border-dashed border-slate-500" style={{ left: `${avgPos}%` }} />
              <span className="absolute top-0 whitespace-nowrap rounded-full bg-slate-800 px-2 py-0.5 text-[10.5px] font-bold text-white" style={{ left: `${avgPos}%`, transform: avgPos > 70 ? "translateX(-100%)" : avgPos < 30 ? "none" : "translateX(-50%)" }}>
                Promedio {pctText(average!)}
              </span>
            </>
          )}
        </div>
        {/* En el celular las franjas de arriba son angostas: sus nombres van en una leyenda. */}
        {!isDesktop && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-3 text-[10.5px] font-bold">
            {bands.map(([, , l]) => (
              <span key={`t${l}`} className="flex items-center gap-1" style={{ color: LEVEL_COLOR[l] }}><span className="h-2 w-2 rounded-sm" style={{ background: LEVEL_COLOR[l] }} />{DME_LEVEL_LABEL[l]}</span>
            ))}
          </div>
        )}
        <div className="hide-scrollbar absolute inset-x-0 bottom-6 top-7 flex flex-col overflow-y-auto">
          {items.map((i, n) => {
            const level = levelOf(i.pct);
            const diff = average !== null ? i.pct - average : null;
            const b = tip.bind(<TipBox title={i.name} color={LEVEL_COLOR[level]} rows={[["Disponibilidad", pctText(i.pct)], ["Nivel", DME_LEVEL_LABEL[level]], ...(diff !== null ? [["Frente al promedio", pp(diff)] as [string, string]] : []), ["Puesto", `${n + 1} de ${items.length}`]]} note={pickNote} />);
            return (
              <button
                key={i.key}
                type="button"
                onClick={() => { tip.hide(); setHover(null); onPick(i.key); }}
                onMouseMove={(e) => { b.onMouseMove(e); setHover(i.key); }}
                onMouseLeave={() => { b.onMouseLeave(); setHover(null); }}
                className="flex min-h-[34px] flex-1 items-center gap-3 border-b border-slate-200/80 text-left last:border-b-0"
              >
                <span className={`shrink-0 truncate text-[12.5px] font-semibold ${hover === i.key ? "text-teal-700" : "text-slate-700"}`} style={{ width: nameW }}>{i.name}</span>
                <span className="relative flex-1" style={{ height: barH }}>
                  <span className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[filter]" style={{ width: `${Math.max(1.5, pos(i.pct))}%`, background: LEVEL_COLOR[level], filter: hover && hover !== i.key ? "saturate(0.35) opacity(0.6)" : undefined }} />
                  {pos(i.pct) >= insideFrom ? (
                    <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap px-1.5 text-[12.5px] font-bold tabular-nums text-white" style={{ right: `${100 - pos(i.pct)}%` }}>{pctText(i.pct)}</span>
                  ) : (
                    <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-white/85 px-1 text-[12.5px] font-bold tabular-nums text-slate-800" style={{ left: `calc(${Math.max(1.5, pos(i.pct))}% + 4px)` }}>{pctText(i.pct)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {tip.layer}
    </div>
  );
};

const SITUATION_TONE: Record<keyof HistoryCounts, string> = {
  desabastecido: "bg-red-400", substock: "bg-amber-400", normostock: "bg-emerald-500", sobrestock: "bg-sky-500", sinRotacion: "bg-slate-400", sinRotacionVital: "bg-slate-400", total: "bg-slate-400",
};

/** Situaciones de un establecimiento en el mes, con lo que ocupa cada una del total. */
const SituationBars: React.FC<{ counts: HistoryCounts | undefined }> = ({ counts }) => {
  if (!counts || !counts.total) return <EmptyState title="Sin datos ese mes" />;
  return (
    <div className="flex min-h-[230px] flex-1 flex-col">
      {SITUATIONS.map((s) => {
        const n = counts[s.key];
        const share = n / counts.total;
        return (
          <div key={s.key} className="flex min-h-[34px] flex-1 items-center gap-3 px-1">
            <span className="w-[42%] shrink-0 text-[12.5px] font-semibold text-slate-700 md:w-[150px]">{s.label}</span>
            <span className="relative h-6 flex-1 rounded-md bg-slate-50"><span className={`absolute inset-y-0 left-0 rounded-md ${SITUATION_TONE[s.key]}`} style={{ width: `${Math.max(n ? 2 : 0, share * 100)}%` }} /></span>
            <span className="w-16 shrink-0 text-right font-mono text-[12.5px] font-bold text-slate-700">{formatNumber(n)} <span className="font-semibold text-slate-400">{Math.round(share * 100)}%</span></span>
          </div>
        );
      })}
      <p className="pt-2 text-[11.5px] text-slate-500">{formatNumber(counts.total)} ítems evaluados</p>
    </div>
  );
};

/* ---------------------------------------------------------------- Título */

const HistoryTitle: React.FC<{ scopeTitle: string; subtitle: string; right?: React.ReactNode }> = ({ scopeTitle, subtitle, right }) => (
  <div className="mb-3 flex items-center gap-3">
    <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700 sm:grid"><History className="h-5 w-5" /></span>
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-[18px] font-black text-slate-900 md:text-[20px]">{scopeTitle}</h2>
      <p className="truncate text-[12.5px] text-slate-500">{subtitle}</p>
    </div>
    {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
  </div>
);

/* ---------------------------------------------------------------- Detalle de un establecimiento */

const SITUATIONS: Array<{ key: keyof HistoryCounts; label: string }> = [
  { key: "desabastecido", label: "Desabastecido" },
  { key: "substock", label: "Substock" },
  { key: "normostock", label: "Normostock" },
  { key: "sobrestock", label: "Sobrestock" },
  { key: "sinRotacion", label: "Sin rotación" },
];

const HistoryEstablishmentDrawer: React.FC<{
  state: { row: HistoryEntityRow; list: HistoryEntityRow[] } | null;
  onClose: () => void;
  onMove: (row: HistoryEntityRow) => void;
  index: ReturnType<typeof indexHistory>;
  data: HistoryData;
  months: string[];
  prevMonths: string[];
  sel: number | null;
  year: number;
  opts: HistoryOptions;
  formula: AvailabilityFormula;
  registry: Map<string, EstablishmentInfo>;
}> = ({ state, onClose, onMove, index, data, months, prevMonths, sel, year, opts, formula, registry }) => {
  const nav = state ? drawerNav(state.row, state.list, onMove) : undefined;
  useDrawerKeys(!!state, onClose, nav);
  if (!state) return null;
  const code = state.row.key;
  const info = registry.get(code);
  const levelOf = (v: number) => dmeLevelOf(v, formula.levels);
  const month = sel !== null ? months[sel] : null;
  // Lo que entra en la evaluación con la regla vigente (en la DME, los sin rotación no vitales no).
  const counts = (v: HistoryView) => {
    const raw = month ? index.get(v)?.get(month)?.get(code) : undefined;
    return raw ? evaluatedCounts(raw, opts.rules[v], v) : undefined;
  };
  const record = month ? data.records.find((r) => r.code === code && r.month === month && r.save !== undefined) : undefined;
  const save: HistorySave | undefined = record?.save !== undefined ? data.saves[record.save] : undefined;
  const pctOf = (v: HistoryView, m: string) => {
    const c = index.get(v)?.get(m)?.get(code);
    return c ? recordPct(c, opts.rules[v], v) : null;
  };
  const views: HistoryView[] = ["all", "essential"];
  const pctNow = (v: HistoryView) => (month ? pctOf(v, month) : null);
  // En un portal: dentro del módulo, una animación con transform corría el panel hacia abajo.
  return createPortal(
    <div className="fixed inset-0 z-[100000] flex justify-end bg-slate-900/40 md:backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-label={info?.name || code} className="flex h-full w-full flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200 md:w-[620px]">
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3.5 md:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><CodeChip code={code} />{pctNow("all") !== null && <LevelChip level={levelOf(pctNow("all")!)} />}</div>
            <h3 className="mt-1 text-[16px] font-black leading-snug text-slate-900">{info?.name || code}</h3>
            <p className="truncate text-[12.5px] text-slate-500">{[info?.microred, info?.red].filter(Boolean).join(" · ") || "Sin registro"}</p>
          </div>
          <DrawerNavButtons nav={nav} />
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-5">
          {month && (
            <div>
              <h4 className="mb-2 text-[11.5px] font-black uppercase tracking-wider text-slate-500">{monthName(month)}</h4>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2 text-left">Situación</th>{views.map((v) => <th key={v} className="px-3 py-2 text-center">{v === "all" ? "Todos" : "Esenciales"}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {SITUATIONS.map((s) => (
                      <tr key={s.key}>
                        <td className="px-3 py-2 text-slate-700">{s.label}</td>
                        {views.map((v) => <td key={v} className="px-3 py-2 text-center font-mono">{counts(v) ? formatNumber(counts(v)![s.key]) : "—"}</td>)}
                      </tr>
                    ))}
                    <tr>
                      <td className="px-3 py-2 text-slate-700">Disponibles</td>
                      {views.map((v) => <td key={v} className="px-3 py-2 text-center font-mono">{counts(v) ? formatNumber(availableOf(counts(v)!, opts.rules[v], v)) : "—"}</td>)}
                    </tr>
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-800">
                    <tr><td className="px-3 py-2">Total de ítems</td>{views.map((v) => <td key={v} className="px-3 py-2 text-center font-mono">{counts(v) ? formatNumber(counts(v)!.total) : "—"}</td>)}</tr>
                    <tr><td className="px-3 py-2">Disponibilidad</td>{views.map((v) => <td key={v} className="px-3 py-2 text-center"><LevelPct pct={pctNow(v)} levelOf={levelOf} /></td>)}</tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          {views.map((v) => (
            <div key={v}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h4 className="text-[11.5px] font-black uppercase tracking-wider text-slate-500">{VIEW_LABEL[v]}</h4>
                <HistoryLegend current={String(year)} previous={String(year - 1)} />
              </div>
              <HistoryChart
                labels={months.map(shortName)}
                titles={months.map(monthName)}
                values={months.map((m) => pctOf(v, m))}
                previous={prevMonths.map((m) => pctOf(v, m))}
                currentLabel={String(year)}
                previousLabel={String(year - 1)}
                previousTitles={prevMonths.map(monthName)}
                coverage={[]}
                selected={sel}
                levels={formula.levels}
                levelLabels={DME_LEVEL_LABEL}
                levelOf={levelOf}
              />
            </div>
          ))}
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
            {save ? <>Guardado por <b>{save.savedByName}</b> el {dateText(new Date(save.savedAt))}, del TFORMDET al corte de {monthName(save.sourceCut)}. </> : null}
            El detalle por producto no se guarda: para verlo, abra el reporte del mes con el TFORMDET de ese mes.
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
};

/* ---------------------------------------------------------------- Meses guardados */

const SavedMonthsDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  year: number;
  months: string[];
  withData: boolean[];
  coverage: Array<{ establishments: number; expected: number }>;
  savesOf: (month: string) => HistorySave[];
  canRemove: boolean;
  onRemove: (month: string) => Promise<void>;
  formula: AvailabilityFormula;
}> = ({ open, onClose, year, months, withData, coverage, savesOf, canRemove, onRemove, formula }) => {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = months.map((m, i) => ({ m, i })).filter(({ i }) => withData[i]).reverse();
  const otherRules = (s: HistorySave) => s.subMax !== formula.subMax || s.sobreMin !== formula.sobreMin || s.truncate !== formula.truncate;
  return (
    <>
      <ResponsiveDialog
        open={open}
        onClose={onClose}
        size="lg"
        title={`Meses guardados en ${year}`}
        subtitle="Quién guardó cada mes y cuándo. Al guardar otra vez un mes, se reemplazan los establecimientos de ese archivo."
        footer={<button type="button" onClick={onClose} className={dialogSecondaryButton}>Cerrar</button>}
      >
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {rows.map(({ m, i }) => {
            const saves = savesOf(m);
            const last = saves[0];
            return (
              <div key={m} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-800">{monthName(m)}</p>
                  <p className="truncate text-[12.5px] text-slate-500">
                    {formatNumber(coverage[i].establishments)} de {formatNumber(coverage[i].expected)} establecimientos
                    {last && <> · {last.savedByName}{saves.length > 1 ? ` y ${saves.length - 1} más` : ""} · {dateText(new Date(last.savedAt))}</>}
                  </p>
                  {saves.some(otherRules) && <p className="mt-0.5 flex items-center gap-1 text-[11.5px] font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Calculado con otros límites de meses</p>}
                </div>
                {canRemove && (
                  <button type="button" onClick={() => setConfirm(m)} aria-label={`Quitar ${monthName(m)}`} title="Quitar del historial" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            );
          })}
        </div>
      </ResponsiveDialog>
      <ConfirmationDialog
        isOpen={!!confirm}
        tone="danger"
        title={confirm ? `¿Quitar ${monthName(confirm)} del historial?` : ""}
        description="Se borran los establecimientos de su jurisdicción guardados ese mes. Para recuperarlo, hay que volver a guardarlo desde el reporte del mes con su TFORMDET."
        confirmLabel="Quitar"
        isConfirming={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try { await onRemove(confirm); setConfirm(null); } finally { setBusy(false); }
        }}
      />
    </>
  );
};

