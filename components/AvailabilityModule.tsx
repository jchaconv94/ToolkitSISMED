import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, BarChart3, Building2, CalendarClock, CheckCircle2, Download, FileSpreadsheet, LayoutDashboard, Loader2, MoreVertical, PackageX, RefreshCw, Repeat2, SearchX, Settings2, TrendingUp, Upload, Warehouse, X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useModuleHeaderOverride } from "../contexts/ModuleHeaderContext";
import { userFullName } from "../services/sessionDisplay";
import { api } from "../services/api";
import {
  averageConsumption, buildItems, essentialRows, groupByIpress, summarize,
  type EstablishmentInfo, type AvailabilityItem, type AvailabilityScope, type Lot, type TformdetMonthSheet, type WarehouseItem, type ParsedAvailability,
} from "../services/availabilityReport";
import { monthLabel } from "../services/availabilityExport";
import { exportAvailabilityExcel } from "../services/availabilityExportClient";
import type { DmeLevel } from "../services/stockStatus";
import { asSupplier, isSeparateSite, lotRiskReport, type ProductGap } from "../services/availabilityInsights";
import { availabilityConfigApi, classifyOptionsOf, describeFormula, factoryConfig, summaryOptionsOf, vitalCodeSet, type AvailabilityConfig } from "../services/availabilityConfig";
import { AvailabilityConfigDialog } from "./AvailabilityConfigDialog";
import { formatNumber } from "../services/numberFormat";
import { tformdetFromSheet, type TformdetFileResult } from "../services/tformdetFile";
import { availabilityStore, fileSignature } from "../services/availabilityStore";
import { BottomSheet } from "./ui/BottomSheet";
import { useIsDesktop } from "./ui/useIsDesktop";
import {
  AbcReport, ConsumptionReport, drawerNav, EstablishmentDetail, EstablishmentsReport, ExpiryReport, GapsReport, OverstockReport, ProductDrawer, ProductGapDrawer, RedistributionReport, SummaryReport, WarehouseReport,
  type PlanEdits, type ReportContext, type ReportTab,
} from "./AvailabilityReports";

/**
 * Disponibilidad de productos por establecimiento (2026-10-06; tablero rediseñado el
 * 2026-10-07). Se sube la consulta TFORMDET del Toolkit y todo se calcula en el navegador con
 * `services/availabilityReport.ts` y `services/availabilityInsights.ts`.
 *
 * Organización de tablero (Power BI / Looker): el contexto (UNGET, corte, alcance) y Exportar
 * van en la cabecera de la app; los reportes, en pestañas horizontales; los gráficos ocupan
 * todo el ancho, y el detalle se abre encima (establecimiento como página, producto en un
 * panel lateral). Las explicaciones van detrás de un ícono «i».
 */

/** Lectura con SheetJS: respaldo si el lector rápido o el Worker fallan. */
const readSheet = async (file: File): Promise<unknown[][]> => {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { dense: true, cellDates: true, cellNF: false, cellHTML: false, cellText: false, cellStyles: false });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
};

/** Lee la consulta TFORMDET en segundo plano con el lector rápido; si no se puede, con SheetJS. */
const readTformdetFile = async (file: File): Promise<TformdetFileResult> => {
  if (typeof Worker !== "undefined") {
    const buffer = await file.arrayBuffer();
    const reply = await new Promise<{ ok: boolean; retry?: boolean; message?: string; result?: TformdetFileResult }>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("../services/tformdetReader.worker.ts", import.meta.url), { type: "module" });
      } catch {
        resolve({ ok: false, retry: true });
        return;
      }
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
      worker.onerror = () => { resolve({ ok: false, retry: true }); worker.terminate(); };
      worker.postMessage({ buffer, name: file.name }, [buffer]);
    });
    if (reply.ok && reply.result) return reply.result;
    if (!reply.retry) throw new Error(reply.message || "No se pudo leer el archivo.");
  }
  return tformdetFromSheet(await readSheet(file), file.name);
};

const TABS: Array<{ id: ReportTab; label: string; icon: React.ReactNode }> = [
  { id: "summary", label: "Resumen", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "establishments", label: "Establecimientos", icon: <Building2 className="h-4 w-4" /> },
  { id: "gaps", label: "¿Dónde falta?", icon: <SearchX className="h-4 w-4" /> },
  { id: "expiry", label: "Vencimientos", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "consumption", label: "Consumos irregulares", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "abc", label: "Clasificación ABC", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "overstock", label: "Sobrestock", icon: <PackageX className="h-4 w-4" /> },
  { id: "redistribution", label: "Redistribución", icon: <Repeat2 className="h-4 w-4" /> },
  { id: "warehouse", label: "Almacén", icon: <Warehouse className="h-4 w-4" /> },
];

/* ---------------------------------------------------------------- Carga de archivos */

const DropZone: React.FC<{
  title: string;
  hint: string;
  optional?: boolean;
  fileName?: string;
  detail?: string;
  onFile: (file: File) => void;
  onClear?: () => void;
  busy?: boolean;
}> = ({ title, hint, optional, fileName, detail, onFile, onClear, busy }) => {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const done = !!fileName;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={`flex flex-col items-center rounded-2xl border-2 border-dashed p-5 text-center transition-colors md:p-6 ${over ? "border-teal-400 bg-teal-50/60" : done ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-white"}`}
    >
      <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <span className={`mb-3 grid h-12 w-12 place-items-center rounded-2xl ${done ? "bg-emerald-100 text-emerald-700" : "bg-teal-50 text-teal-700"}`}>
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : done ? <CheckCircle2 className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
      </span>
      <p className="text-[14.5px] font-bold text-slate-900">
        {title}{optional && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">Opcional</span>}
      </p>
      <p className="mt-1 max-w-xs text-[12.5px] text-slate-500">{hint}</p>
      {done ? (
        <div className="mt-3 flex max-w-full items-center gap-1.5 rounded-lg bg-white py-1 pl-3 pr-1 text-[12.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <FileSpreadsheet className="h-4 w-4 shrink-0" /><span className="truncate">{fileName}</span>
          {detail && <span className="shrink-0 text-slate-500">· {detail}</span>}
          {onClear && (
            <button type="button" onClick={onClear} aria-label="Quitar archivo" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="mt-4 h-10 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-50">
          Elegir archivo
        </button>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- Módulo */

export const AvailabilityModule: React.FC = () => {
  const { can, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [dispFile, setDispFile] = useState<{ name: string; data: ParsedAvailability } | null>(null);
  const [lotsFile, setLotsFile] = useState<{ name: string; data: Map<string, Lot[]> } | null>(null);
  /** Registros del TFORMDET del mes de corte, tal como vienen: van en una hoja del Excel. */
  const [tformdetSheet, setTformdetSheet] = useState<TformdetMonthSheet | null>(null);
  /** Stock de los almacenes (030S05…) al corte: no cuenta en la disponibilidad. */
  const [warehouse, setWarehouse] = useState<WarehouseItem[]>([]);
  const [reading, setReading] = useState<"disp" | "lots" | null>(null);
  const [calculated, setCalculated] = useState(false);
  const [registry, setRegistry] = useState<Map<string, EstablishmentInfo>>(new Map());
  /** De dónde salió el archivo principal y si trae la clasificación de productos. */
  const [source, setSource] = useState<{ kind: "disponibilidad" | "tformdet"; classified: boolean; skipped: string[] } | null>(null);

  const [scope, setScope] = useState<AvailabilityScope>("all");
  const [tab, setTab] = useState<ReportTab>("summary");
  const [eessView, setEessView] = useState<"eess" | "mr">("eess");
  const [level, setLevel] = useState<DmeLevel | "ALL">("ALL");
  const [microred, setMicrored] = useState("ALL");
  const [openCode, setOpenCode] = useState<string | null>(null);
  // Panel abierto y la lista de la tabla de donde se abrió, para pasar al anterior o al siguiente.
  const [productState, setProductState] = useState<{ item: AvailabilityItem; list: AvailabilityItem[] } | null>(null);
  const [gapState, setGapState] = useState<{ gap: ProductGap; list: ProductGap[] } | null>(null);
  const product = productState?.item ?? null;
  const gap = gapState?.gap ?? null;
  const setProduct = (item: AvailabilityItem | null, list?: AvailabilityItem[]) => setProductState((cur) => (item ? { item, list: list ?? cur?.list ?? [] } : null));
  const setGap = (g: ProductGap | null, list?: ProductGap[]) => setGapState((cur) => (g ? { gap: g, list: list ?? cur?.list ?? [] } : null));
  const [actionsOpen, setActionsOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const menuRef = useRef<HTMLDivElement>(null);
  // En escritorio el menú ⋯ es un desplegable: se cierra al hacer clic fuera o con Esc.
  useEffect(() => {
    if (!actionsOpen || !isDesktop) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setActionsOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActionsOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [actionsOpen, isDesktop]);
  const [exporting, setExporting] = useState(false);
  const [config, setConfig] = useState<AvailabilityConfig>(() => factoryConfig());
  const [configOpen, setConfigOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  // En el celular la pestaña elegida se desliza a la vista.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab, calculated, openCode]);

  useEffect(() => {
    availabilityConfigApi.load().then(setConfig);
  }, []);

  useEffect(() => {
    // Nombre, microred y red (UNGET) de cada IPRESS, del registro de Establecimientos: el TFORMDET
    // no trae microred ni red.
    Promise.all([api.getFacilities(), api.getMicroredes().catch(() => []), api.getUngets().catch(() => [])])
      .then(([facilities, microredes, ungets]) => {
        const mr = new Map(microredes.map((m) => [m.id, m]));
        const ug = new Map(ungets.map((u) => [u.id, u.name]));
        setRegistry(new Map(facilities.map((f) => {
          const m = f.microredId ? mr.get(f.microredId) : undefined;
          const unget = f.ungetId || m?.ungetId;
          return [String(f.code).trim(), { name: f.name, type: f.type || "", microred: m?.name || "", red: (unget && ug.get(unget)) || "", category: f.category || "" }];
        })));
      })
      .catch(() => undefined);
  }, []);

  // El TFORMDET se guarda en este equipo (IndexedDB, por usuario): al volver al módulo o recargar
  // la página aparece calculado, sin subirlo otra vez (pedido del usuario del 2026-10-08).
  const storeUser = user?.username || "";
  const [stored, setStored] = useState<{ name: string; savedAt: string } | null>(null);
  const [restoring, setRestoring] = useState(true);
  const applyFile = (name: string, data: TformdetFileResult["data"], last: TformdetFileResult["last"]) => {
    setDispFile({ name, data });
    setLotsFile({ name, data: data.lots });
    setTformdetSheet(last);
    setWarehouse(data.warehouse ?? []);
    setSource({ kind: "tformdet", classified: data.hasClassification, skipped: data.skippedCodes });
    if (!data.hasClassification) setScope("all");
  };
  useEffect(() => {
    let alive = true;
    setRestoring(true);
    availabilityStore.loadFile(storeUser).then((saved) => {
      if (!alive) return;
      if (saved) {
        applyFile(saved.name, saved.data, saved.last);
        setStored({ name: saved.name, savedAt: saved.savedAt });
        setCalculated(true);
      }
      setRestoring(false);
    });
    return () => { alive = false; };
  }, [storeUser]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearFile = () => {
    setDispFile(null); setCalculated(false); setLotsFile(null); setTformdetSheet(null); setWarehouse([]); setSource(null); setStored(null);
    availabilityStore.clear(storeUser);
  };

  const handleDispFile = async (file: File) => {
    setReading("disp");
    try {
      // Solo la consulta TFORMDET del Toolkit (uno o varios meses): trae consumo, stock y lotes.
      const { data, last } = await readTformdetFile(file);
      applyFile(file.name, data, last);
      setCalculated(false);
      const savedAt = new Date().toISOString();
      const ok = await availabilityStore.saveFile(storeUser, { name: file.name, savedAt, data, last });
      setStored(ok ? { name: file.name, savedAt } : null);
      if (!ok) toast.error("No se pudo guardar el archivo en este equipo: habrá que subirlo otra vez al recargar.");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo leer el archivo.");
    } finally {
      setReading(null);
    }
  };

  // Filas por IPRESS (las farmacias sumadas): no dependen de la fórmula.
  const baseRows = useMemo(() => {
    if (!dispFile || !calculated) return null;
    const rows = dispFile.data.rows.map((r) => {
      if (r.microred && r.red) return r;
      const info = registry.get(r.ipressCode);
      return info ? { ...r, microred: r.microred || info.microred || "", red: r.red || info.red || "", category: r.category || info.category || "" } : r;
    });
    return {
      ipress: groupByIpress(rows, (code) => registry.get(code)?.name),
      // Cada farmacia o puesto comunal con su nombre del registro, si está registrado.
      pharmacy: dispFile.data.hasPharmacies ? rows.map((r) => (r.code !== r.ipressCode && registry.get(r.code)?.name ? { ...r, name: registry.get(r.code)!.name! } : r)) : null,
    };
  }, [dispFile, calculated, registry]);

  // Todos los productos y, del mismo cálculo, la DME con los códigos fusionados.
  const vitalCodes = useMemo(() => vitalCodeSet(config.vitals), [config.vitals]);
  const today = useMemo(() => new Date(), [calculated]); // eslint-disable-line react-hooks/exhaustive-deps
  const computed = useMemo(() => {
    if (!baseRows) return null;
    const lots = lotsFile?.data;
    const opts = classifyOptionsOf(config.formula);
    const groups = config.fused.groups;
    return {
      all: buildItems(baseRows.ipress, lots, today, opts),
      essential: buildItems(essentialRows(baseRows.ipress, groups), lots, today, opts),
      pharmacyAll: baseRows.pharmacy ? buildItems(baseRows.pharmacy, lots, today, opts) : null,
      pharmacyEssential: baseRows.pharmacy ? buildItems(essentialRows(baseRows.pharmacy, groups), lots, today, opts) : null,
    };
  }, [baseRows, lotsFile, config.formula, config.fused, today]);

  const ipressItems = useMemo<AvailabilityItem[]>(() => (computed ? (scope === "all" ? computed.all : computed.essential) : []), [computed, scope]);
  const pharmacyItems = computed ? (scope === "all" ? computed.pharmacyAll : computed.pharmacyEssential) : null;
  // Ítems de cada farmacia (F01, F02…) por establecimiento y producto: el riesgo de vencimiento
  // se calcula por farmacia, con sus propios lotes y su propio CPA.
  const pharmacyIndex = useMemo(() => {
    const m = new Map<string, AvailabilityItem[]>();
    for (const it of pharmacyItems ?? []) {
      if (it.code === it.ipressCode) continue;
      const k = `${it.ipressCode}|${it.medCode}`;
      const list = m.get(k);
      if (list) list.push(it); else m.set(k, [it]);
    }
    return m;
  }, [pharmacyItems]);
  /**
   * Unidades para el riesgo de vencimiento de un establecimiento con farmacias (2026-10-07):
   * los puestos comunales (y las F02+ sin tipo en el registro, por prudencia) van separados,
   * cada uno con sus lotes y su consumo; la F01 y las farmacias del hospital (tipo FARMACIA)
   * se suman como una sola, porque el stock se mueve entre ellas dentro del mismo local.
   * Una F01 sola (sin farmacias del hospital) con puestos los abastece: su ritmo de salida suma
   * lo que les entrega (OTRAS_SAL, `asSupplier`). En el hospital no se suma, porque ahí las
   * otras salidas de la F01 van sobre todo a sus propias farmacias, que ya están en la unidad.
   */
  const byPharmacy = useCallback((items: AvailabilityItem[]) => items.flatMap((it) => {
    if (it.code !== it.ipressCode) return [it];
    const list = pharmacyIndex.get(`${it.code}|${it.medCode}`);
    if (!list?.length) return [it];
    const separate = list.filter((p) => isSeparateSite(p.code, registry.get(p.code)?.type));
    if (!separate.length) return [it];
    const hospital = list.filter((p) => !separate.includes(p));
    if (hospital.length <= 1) return [...separate, ...hospital.map(asSupplier)];
    const consumption = it.consumption.map((_, i) => hospital.reduce((a, p) => a + (p.consumption[i] || 0), 0));
    const merged: AvailabilityItem = {
      ...hospital[0],
      code: it.ipressCode,
      name: `${it.name} · farmacias ${hospital.map((p) => p.code.slice(5)).join(", ")}`,
      consumption,
      stock: hospital.reduce((a, p) => a + p.stock, 0),
      cpa: averageConsumption(consumption),
      lots: hospital.flatMap((p) => p.lots).sort((a, b) => (a.expiry?.getTime() ?? Infinity) - (b.expiry?.getTime() ?? Infinity)),
    };
    return [...separate, merged];
  }), [pharmacyIndex, registry]);
  // Disponibilidad de cada farmacia y puesto comunal (F01, F02…), para abrir un establecimiento por farmacia.
  const pharmacyReport = useMemo(() => (pharmacyItems ? summarize(pharmacyItems, summaryOptionsOf(config.formula, scope, vitalCodes)) : null), [pharmacyItems, config.formula, scope, vitalCodes]);
  // Cambios al plan de redistribución, guardados por archivo y vista.
  const [planEdits, setPlanEdits] = useState<PlanEdits>({});
  const report = useMemo(() => summarize(ipressItems, summaryOptionsOf(config.formula, scope, vitalCodes)), [ipressItems, config.formula, scope, vitalCodes]);
  // Los cambios al plan se guardan junto al archivo; si cambian los datos o la vista, se recuperan
  // los de esa combinación (o ninguno).
  const planSignature = stored ? `${fileSignature(stored)}|${scope}` : "";
  const [planLoaded, setPlanLoaded] = useState("");
  useEffect(() => {
    setPlanEdits({});
    setPlanLoaded("");
    if (!planSignature) return;
    let alive = true;
    availabilityStore.loadPlan(storeUser, planSignature).then((saved) => {
      if (!alive) return;
      if (saved) setPlanEdits(saved as PlanEdits);
      setPlanLoaded(planSignature);
    });
    return () => { alive = false; };
  }, [report, planSignature, storeUser]);
  useEffect(() => {
    if (!planSignature || planLoaded !== planSignature) return;
    const t = window.setTimeout(() => availabilityStore.savePlan(storeUser, planSignature, planEdits), 400);
    return () => window.clearTimeout(t);
  }, [planEdits, planSignature, planLoaded, storeUser]);
  const otherScope: AvailabilityScope = scope === "all" ? "essential" : "all";
  const otherPct = useMemo(() => {
    const items = computed && (otherScope === "all" || source?.classified !== false) ? (otherScope === "all" ? computed.all : computed.essential) : null;
    return items && items.length ? summarize(items, summaryOptionsOf(config.formula, otherScope, vitalCodes)).pct : null;
  }, [computed, otherScope, source, config.formula, vitalCodes]);

  const months = dispFile?.data.months ?? [];
  const cut = months[months.length - 1];
  const reds = useMemo(() => [...new Set(ipressItems.map((i) => i.red).filter(Boolean))], [ipressItems]);
  const title = reds.length === 1 ? `UNGET ${reds[0]}` : "Todas las redes";
  const levelCounts = useMemo(() => {
    const c: Record<DmeLevel, number> = { OPTIMO: 0, ALTO: 0, REGULAR: 0, BAJO: 0 };
    report.establishments.forEach((e) => c[e.level]++);
    return c;
  }, [report]);

  const mainScroll = useRef(0);
  const scrollMain = (top: number) => { const m = document.querySelector("main"); if (m) m.scrollTop = top; };
  const openEstablishment = (code: string) => {
    mainScroll.current = document.querySelector("main")?.scrollTop ?? 0;
    setGap(null); setProduct(null); setOpenCode(code);
    requestAnimationFrame(() => scrollMain(0));
  };
  // Al cerrar el detalle se vuelve a la misma página de la tabla y al mismo punto de la pantalla.
  const closeEstablishment = () => { setOpenCode(null); requestAnimationFrame(() => scrollMain(mainScroll.current)); };
  const goTab = (t: ReportTab) => { setOpenCode(null); setTab(t); scroller.current?.scrollIntoView({ block: "start" }); };
  const closeProduct = useCallback(() => setProductState(null), []);
  const closeGap = useCallback(() => setGapState(null), []);
  const openEstablishmentName = openCode ? (report.establishments.find((e) => e.code === openCode) ?? pharmacyReport?.establishments.find((e) => e.code === openCode))?.name : undefined;
  useModuleHeaderOverride(calculated && openCode ? { title: openEstablishmentName || openCode, subtitle: "Disponibilidad", onBack: closeEstablishment } : null);

  /**
   * Riesgo de vencimiento como lo muestra la web (FEFO por lote, por farmacia o puesto), para el
   * Excel: por establecimiento y por farmacia, «código|producto» → unidades y valor.
   */
  const expiryRiskMap = () => {
    const map: Record<string, { units: number; value: number }> = {};
    const add = (key: string, units: number, value: number) => { const e = map[key] || (map[key] = { units: 0, value: 0 }); e.units += units; e.value += value; };
    for (const r of lotRiskReport(byPharmacy(report.items), today).rows) {
      add(`${r.item.ipressCode}|${r.item.medCode}`, r.atRisk, r.value);
      if (r.item.code !== r.item.ipressCode) add(`${r.item.code}|${r.item.medCode}`, r.atRisk, r.value);
    }
    return map;
  };

  /** Profesión de quien genera el reporte, para la portada del Excel. */
  const professionOf = async (): Promise<string | undefined> => {
    const p = user?.personnelData;
    if (!p) return undefined;
    if (p.professionData?.name) return p.professionData.name;
    if (!p.professionId) return undefined;
    const list = await api.getProfessions().catch(() => []);
    return list.find((x) => x.id === p.professionId)?.name;
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    const notice = toast.loading("Generando el Excel…");
    try {
      await exportAvailabilityExcel({
        report, otherScopePct: otherPct, pharmacyItems, months, scope, title,
        formulaText: describeFormula(config.formula, scope),
        levels: config.formula.levels,
        fusedVersion: config.fused.version,
        source: `${dispFile?.name || ""} (${source?.kind === "tformdet" ? "TFORMDET" : "archivo de disponibilidad"})`,
        preparedBy: user ? userFullName(user) : undefined,
        preparedByRole: await professionOf(),
        rule: scope === "all" ? config.formula.all : config.formula.essential,
        limits: { subMax: config.formula.subMax, sobreMin: config.formula.sobreMin },
        aggregate: config.formula.aggregate,
        tformdet: tformdetSheet,
        warehouse,
        expiryRisk: expiryRiskMap(),
      });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar el Excel.");
    } finally {
      toast.dismiss(notice);
      setExporting(false);
    }
  };

  const startResults = () => { setTab("summary"); setOpenCode(null); setLevel("ALL"); setMicrored("ALL"); setCalculated(true); };

  /* ------------------------------------------------------------ Pantalla de carga */
  if (restoring && !calculated) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <p className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-teal-600" />Abriendo el último TFORMDET guardado en este equipo…</p>
      </div>
    );
  }
  if (!calculated) {
    const d = dispFile?.data;
    const ipressCount = d ? new Set(d.rows.map((r) => r.ipressCode)).size : 0;
    const pharmacyCount = d ? new Set(d.rows.map((r) => r.code)).size : 0;
    return (
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-2 md:px-0 md:pb-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-[18px] font-black text-slate-900">Calcular la disponibilidad</h2>
            {isAdmin && (
              <button type="button" onClick={() => setConfigOpen(true)} className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-50">
                <Settings2 className="h-4 w-4" />Configuración
              </button>
            )}
          </div>
          <p className="mt-1 text-[13px] text-slate-500">Suba la consulta TFORMDET del Toolkit. Se calcula por producto, establecimiento, microred y UNGET; los medicamentos esenciales salen del mismo cálculo.</p>
          <div className="mt-5">
            <DropZone
              title="Consulta TFORMDET"
              hint="Descárguela del Toolkit de escritorio con los meses que quiera: se calcula con todos. Los lotes y vencimientos salen del último mes."
              fileName={dispFile?.name}
              detail={d ? `${formatNumber(d.rows.length)} filas` : undefined}
              onFile={handleDispFile}
              onClear={clearFile}
              busy={reading === "disp"}
            />
          </div>
          {reading === "disp" && (
            <p className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-teal-600" />Leyendo el archivo… un TFORMDET de 12 meses puede tardar medio minuto.</p>
          )}
          {source?.kind === "tformdet" && !source.classified && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Este TFORMDET no trae la clasificación de los productos (MEDTIP, MEDPET, MEDEST): se calcula la disponibilidad de todos los productos, pero no la de medicamentos esenciales. Descárguelo con el <b>Toolkit 2.2.5</b> o posterior.</span>
            </div>
          )}
          {d && cut && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-600">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
              <span>
                Mes de corte: <b className="text-slate-900">{monthLabel(cut)}</b> · consumo de {monthLabel(months[0])} a {monthLabel(cut)} ·{" "}
                {months.length} {months.length === 1 ? "mes" : "meses"} · {d.hasPharmacies ? `${pharmacyCount} farmacias en ${ipressCount} establecimientos` : `${ipressCount} establecimientos`}
                {source?.skipped.length ? ` · sin contar ${source.skipped.join(", ")} (no son establecimientos)` : ""}
              </span>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <button type="button" disabled={!dispFile || !!reading} onClick={startResults} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto">
              <Activity className="h-4 w-4" />Calcular disponibilidad
            </button>
          </div>
        </div>
        <AvailabilityConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} config={config} onSaved={setConfig} previewRows={null} />
      </div>
    );
  }

  /* ------------------------------------------------------------ Resultados */
  const ctx: ReportContext = {
    report,
    pharmacy: pharmacyReport,
    byPharmacy,
    facilityType: (code) => registry.get(code)?.type || undefined,
    months,
    levels: config.formula.levels,
    subMax: config.formula.subMax,
    sobreMin: config.formula.sobreMin,
    today,
    warehouse,
    otherPct,
    scopeLabel: scope === "all" ? "todos los productos" : "medicamentos esenciales",
    otherLabel: scope === "all" ? "Medicamentos esenciales (DME)" : "Todos los productos",
    openEstablishment,
    openProduct: (item, list) => setProduct(item, list ?? [item]),
    goTab,
    planEdits,
    setPlanEdits,
    reportTitle: `${title}${cut ? ` · ${monthLabel(cut)}` : ""}`,
  };
  const classifiedOff = source?.classified === false;
  const scopeSwitch = (compact = false) => (
    <div className={`flex rounded-xl bg-slate-100 p-1 ${compact ? "w-full" : ""}`} role="tablist" aria-label="Productos evaluados">
      {([["all", "Todos los productos", "Todos"], ["essential", "Medicamentos esenciales", "Esenciales"]] as const).map(([id, label, short]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={scope === id}
          disabled={id === "essential" && classifiedOff}
          title={id === "essential" && classifiedOff ? "El TFORMDET no trae la clasificación de productos (Toolkit 2.2.5)" : undefined}
          onClick={() => setScope(id)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "flex-1" : ""} ${scope === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <span className="md:hidden">{short}</span><span className="hidden md:inline">{label}</span>
        </button>
      ))}
    </div>
  );
  const actionItems = (
    <>
      <button type="button" onClick={() => { setActionsOpen(false); setCalculated(false); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 hover:bg-slate-50">
        <RefreshCw className="h-5 w-5" />Cargar otro TFORMDET
      </button>
      {isAdmin && (
        <button type="button" onClick={() => { setActionsOpen(false); setConfigOpen(true); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-bold text-slate-700 hover:bg-slate-50">
          <Settings2 className="h-5 w-5" />Configuración de la fórmula
        </button>
      )}
      <p className="mt-2 border-t border-slate-100 px-3 pt-3 text-[12px] leading-relaxed text-slate-500">{describeFormula(config.formula, scope)}{!config.fromServer && " Configuración de fábrica."}</p>
    </>
  );

  return (
    <div className="pb-24 md:pb-8">
      {/* Título del reporte: UNGET y corte a la izquierda; alcance y Exportar a la derecha; Configuración y otro TFORMDET en ⋯ */}
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700 sm:grid"><CalendarClock className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-black text-slate-900 md:text-[20px]">{title}</h2>
            <p className="truncate text-[12.5px] text-slate-500">
              Datos al corte de <b className="font-bold text-slate-700">{cut ? monthLabel(cut) : "—"}</b> · {months.length} {months.length === 1 ? "mes" : "meses"} de consumo{months.length > 1 ? ` (${monthLabel(months[0])} a ${monthLabel(cut)})` : ""}
              {stored && <span title={`${stored.name} · guardado el ${new Date(stored.savedAt).toLocaleString("es-PE")}`}> · guardado en este equipo</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 md:flex-none">{scopeSwitch(true)}</div>
          {can("AVAILABILITY", "export") && (
            <button type="button" onClick={handleExport} disabled={exporting} aria-label="Exportar Excel" className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-teal-600 px-3 text-[13px] font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-60 md:px-4">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}<span className="hidden sm:inline">{exporting ? "Generando…" : "Exportar"}</span>
            </button>
          )}
          <div ref={menuRef} className="relative">
            <button type="button" onClick={() => setActionsOpen(!actionsOpen)} aria-label="Más acciones" title="Más acciones" aria-expanded={actionsOpen} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-white text-slate-600 transition-colors hover:bg-slate-50 ${actionsOpen ? "border-teal-300 ring-2 ring-teal-500/20" : "border-slate-200"}`}>
              <MoreVertical className="h-4 w-4" />
            </button>
            {isDesktop && actionsOpen && (
              <div role="menu" className="absolute right-0 top-12 z-40 w-[340px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl animate-in fade-in zoom-in-95 duration-100">
                {actionItems}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={scroller} />
      {openCode && <EstablishmentDetail ctx={ctx} code={openCode} onClose={closeEstablishment} onSwitch={(c) => { setProduct(null); setOpenCode(c); requestAnimationFrame(() => scrollMain(0)); }} />}
      {/* Los reportes siguen montados (ocultos) mientras el detalle está abierto: así conservan página, filtros y búsqueda. */}
      <div className={openCode ? "hidden" : undefined}>
          <nav aria-label="Reportes" className="sticky -top-2.5 z-20 -mx-3 mb-4 border-b border-slate-200 bg-slate-50 px-3 pt-0.5 sm:-top-3 sm:-mx-5 sm:px-5 2xl:-mx-6 2xl:px-6">
            <div ref={tabsRef} className="hide-scrollbar flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => goTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`relative flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-[13.5px] font-bold transition-colors ${tab === t.id ? "text-teal-700" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {t.icon}{t.label}
                  {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-teal-600" />}
                </button>
              ))}
            </div>
          </nav>
          {tab === "summary" && (
            <SummaryReport
              ctx={ctx}
              levelCounts={levelCounts}
              onLevel={(l) => { setLevel(l); setMicrored("ALL"); setEessView("eess"); goTab("establishments"); }}
              onMicrored={(m) => { setMicrored(m); setLevel("ALL"); setEessView("eess"); goTab("establishments"); }}
            />
          )}
          {tab === "establishments" && (
            <EstablishmentsReport ctx={ctx} view={eessView} onView={setEessView} level={level} onLevel={setLevel} microred={microred} onMicrored={setMicrored} levelCounts={levelCounts} />
          )}
          {tab === "gaps" && <GapsReport ctx={ctx} onProduct={(g, list) => setGap(g, list ?? [g])} />}
          {tab === "expiry" && <ExpiryReport ctx={ctx} />}
          {tab === "consumption" && <ConsumptionReport ctx={ctx} />}
          {tab === "abc" && <AbcReport ctx={ctx} />}
          {tab === "overstock" && <OverstockReport ctx={ctx} />}
          {tab === "redistribution" && <RedistributionReport ctx={ctx} />}
          {tab === "warehouse" && <WarehouseReport ctx={ctx} />}
      </div>

      <ProductGapDrawer ctx={ctx} gap={product ? null : gap} onClose={closeGap} nav={gapState ? drawerNav(gapState.gap, gapState.list, (g) => setGap(g)) : undefined} />
      <ProductDrawer ctx={ctx} item={product} onClose={closeProduct} nav={productState ? drawerNav(productState.item, productState.list, (i) => setProduct(i)) : undefined} />
      <BottomSheet open={actionsOpen && !isDesktop} title="Acciones" onClose={() => setActionsOpen(false)}>
        {actionItems}
      </BottomSheet>
      <AvailabilityConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSaved={setConfig}
        previewRows={baseRows?.ipress ?? null}
        lots={lotsFile?.data}
      />
    </div>
  );
};

export default AvailabilityModule;
