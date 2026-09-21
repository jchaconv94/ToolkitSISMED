import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Search,
  Database,
  RefreshCw,
  AlertCircle,
  Link as LinkIcon,
  FileSpreadsheet,
  Settings,
  Save,
  Check,
  CheckCircle2,
  Copy,
  X,
  Plus,
  Minus,
  Trash2,
  Lock,
  Building2,
  ChevronRight,
  MapPin,
  Clock,
  AlertTriangle,
  Download,
  Filter,
  ArrowRight,
  HelpCircle,
  Share2,
  User,
  ChevronDown,
  LayoutGrid,
  List,
  Grid,
  Table2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Hospital,
  Monitor,
  Package,
  Wifi,
  WifiOff,
  FileClock,
  Maximize2,
  Minimize2,
  Calendar,
  Camera,
  CheckSquare,
  Square,
} from "lucide-react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { useAuth } from "../contexts/AuthContext";
import { UngetConfig, SheetSource, SIGData } from "../types";
import { api } from "../services/api";
import { supabaseService, supabase } from "../services/supabaseClient";
import {
  fetchGasWithResilience,
  fetchGasMetadata,
  fetchGasSelectiveSheets,
  fetchGasSingleSheet,
  getGasErrorLabel,
  type GasSheetMetadata,
} from "../services/gasConnectionService";
import { stockStorageService } from "../services/stockStorageService";
import {
  canReadSheetDirect,
  checkSpreadsheetAccess,
  extractSpreadsheetId,
  fetchSheetRowsDirect,
  fetchSheetsMetadataDirect,
  type DirectSheetRef,
} from "../services/sheetsDirectService";
import { findLatestValidSync, getLastMovementDate } from "../services/stockSyncHistory";
import {
  assignmentBelongsToConnection,
  cachedSourcesStillMatch,
  canEditConnection,
  connectionOwner,
  findUngetForConnection,
  isConnectionOrphaned,
  normalizeUngetName,
  pickOneConnectionPerUnget,
  ungetConnectionKeys,
} from "../services/ungetConnections";
import { INTENT_OPEN_STOCK_CONNECTIONS, takeNavigationIntent } from "../services/appRoutes";
import {
  describeSheetName,
  fetchSheetsMetadataViaApi,
  findFacilityByCode,
  hasSheetsApiKey,
  isFacilitySheet,
  listSheetTabs,
  type KnownRowCounts,
} from "../services/sheetsApiService";
import { sheetOwnerCodeOf } from "../services/facilityCodes";
import { describePharmacyCode, showsPharmacyColumn } from "../services/facilitySheetLink";
import { PharmacyCodeCell } from "./ui/PharmacyCodeCell";
import { CustomSelect } from "./ui/CustomSelect";
import { ConfirmationDialog } from "./ui/ConfirmationDialog";
import {
  DeficiencyCaptureModal,
  SelectedEstablishmentData,
} from "./DeficiencyCaptureModal";
import { DeficiencyCaptureBar } from "./DeficiencyCaptureBar";
import { EstablishmentCard } from "./EstablishmentCard";

/** Lista vacía compartida: evita crear un array nuevo por tarjeta sin datos. */
const EMPTY_SOURCE_ROWS: SIGData[] = [];

const normalizeName = normalizeUngetName;

const formatDisplayName = (name: string): string => {
  if (!name) return "";
  return name.replace(/MARICAL C\.?/gi, "MARISCAL CACERES").replace(/\bMARICAL\b/gi, "MARISCAL");
};

const getCleanSourceId = (sourceId: string): string =>
  sourceId.includes("_") ? sourceId.split("_").slice(1).join("_") : sourceId;

/**
 * UNGET sin Web App: la conexión se identifica por su hoja de cálculo. Se guarda como URL
 * sintética para no romper lo que usa `config.url` como clave (errores, índices, listas).
 */
const VIRTUAL_SHEET_URL_PREFIX = "sheets://";
const isVirtualSheetUrl = (url?: string) => String(url || "").startsWith(VIRTUAL_SHEET_URL_PREFIX);
/** La UNGET tiene una Web App de Apps Script utilizable como respaldo. */
const hasWebApp = (config?: UngetConfig | null) => !!config?.url && !isVirtualSheetUrl(config.url);
/** Texto que se muestra en lugar de la URL. */
const describeConfigUrl = (config: UngetConfig) =>
  isVirtualSheetUrl(config.url) ? "Google Sheets (lectura directa, sin Apps Script)" : config.url;

const extractFacilityCodeFromSheetName = (name?: string): string => {
  const match = String(name || "").trim().match(/-([A-Z0-9]+)\s*$/i);
  return match?.[1]?.toUpperCase() || "";
};


const getHistoryKeysForSource = (source: SheetSource): string[] =>
  Array.from(
    new Set(
      [source.facilityCode, source.id, getCleanSourceId(source.id)]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

const alignConfigsWithOfficialUngets = (configs: any[], ungs: any[]): any[] => {
  if (!ungs || ungs.length === 0) return configs;
  return configs.map(config => {
    const configNorm = normalizeName(config.name);
    const matching = ungs.find(u => 
      (config.ungetId && String(u.id) === String(config.ungetId)) ||
      u.name === config.name || 
      normalizeName(u.name) === configNorm
    );
    if (matching) {
      return {
        ...config,
        ungetId: matching.id,
        name: matching.name
      };
    }
    return config;
  });
};

const parseDataDate = (str?: string): number => {
  if (!str) return 0;
  const trimmed = str.trim();
  if (!trimmed) return 0;

  // Intentar DD/MM/YYYY HH:MM:SS primero (formato estándar de Google Sheets en español)
  try {
    const parts = trimmed.split(/\s+/);
    const datePart = parts[0].replace(",", "");
    const timePart = parts[1] || "00:00:00";
    const paddedTime = timePart.split(':').map(p => p.padStart(2, "0")).join(':');
    const dateMatch = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const isoStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${paddedTime}`;
      const d = new Date(isoStr);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  } catch (e) {}

  // Intentar parseo nativo ISO / fallback
  const d = new Date(trimmed);
  return !isNaN(d.getTime()) ? d.getTime() : 0;
};

type MetadataSourceContext = {
  configUrl: string;
  /** La UNGET de la conexión: las asignaciones cuelgan de ella, no de la URL. */
  configUngetId?: string;
  urlIndex: number;
  assignments: any[];
  facilities: any[];
  /** Hoja configurada para la UNGET; permite lectura directa aunque su script sea antiguo. */
  configSpreadsheetId?: string;
};

/** Tarjeta de IPRESS construida solo con la metadata de Apps Script (sin su stock). */
const sourceFromMetadata = (
  meta: GasSheetMetadata,
  ctx: MetadataSourceContext,
  existing?: SheetSource,
): SheetSource => {
  const assignment = ctx.assignments.find(
    (a) =>
      assignmentBelongsToConnection(a, { ungetId: ctx.configUngetId, url: ctx.configUrl }) &&
      a.sheetName === meta.name,
  );
  const facilityCode =
    assignment?.facilityCode ||
    meta.codigoIpress ||
    extractFacilityCodeFromSheetName(meta.name) ||
    existing?.facilityCode ||
    undefined;

  // Sin asignación se reconoce el establecimiento por el código de la pestaña
  // (`C.S. NUEVO LIMA-06519`). Antes el único puente era la tabla de asignaciones, así que
  // casi todas las tarjetas mostraban el nombre crudo de la pestaña.
  //
  // La búsqueda se limita a los establecimientos de la UNGET de esta conexión: dos UNGET
  // pueden tener códigos que se reduzcan al mismo oficial, y ponerle a una tarjeta el
  // nombre del establecimiento de otra UNGET sería peor que dejarla como está.
  const candidatas = ctx.configUngetId
    ? ctx.facilities.filter((f) => String(f?.ungetId || "") === String(ctx.configUngetId))
    : ctx.facilities;
  const facility = assignment
    ? ctx.facilities.find((f) => f.code === assignment.facilityCode)
    : findFacilityByCode(facilityCode, candidatas);

  const lastUpdate = (meta.lastUpdate || "").trim();
  const equipmentDate = (meta.equipmentDate || "").trim();

  return {
    ...existing,
    id: existing?.id || `${ctx.urlIndex}_${meta.id}`,
    name: facility?.name || meta.name,
    urlIndex: ctx.urlIndex,
    sheetName: meta.name,
    rowCount: meta.rowCount ?? existing?.rowCount ?? 0,
    // La metadata ya trae el ALMCOD de la cabecera. Conservarlo permite mostrar el código
    // en cuanto aparece la tarjeta, sin esperar a que se descargue el stock entero.
    almcod: (meta.almcod || "").trim() || existing?.almcod || undefined,
    facilityCode,
    lastUpdate: lastUpdate || existing?.lastUpdate || "",
    lastUpdateTime: parseDataDate(lastUpdate) || existing?.lastUpdateTime || undefined,
    equipmentDate: equipmentDate || existing?.equipmentDate || "",
    equipmentDateTime: parseDataDate(equipmentDate) || existing?.equipmentDateTime || undefined,
    spreadsheetId: meta.spreadsheetId || existing?.spreadsheetId || ctx.configSpreadsheetId || undefined,
  };
};

/**
 * Hojas de una UNGET que se pueden leer directamente de Google Sheets. Solo si todas las
 * tarjetas guardadas tienen libro y pestaña; si no, se usa la metadata de Apps Script.
 */
const toDirectSheetRefs = (
  list: SheetSource[],
  fallbackSpreadsheetId?: string,
): DirectSheetRef[] | null => {
  if (list.length === 0) return null;
  const refs = list.map((source) => ({
    gid: getCleanSourceId(source.id),
    sheetName: source.sheetName || "",
    spreadsheetId: source.spreadsheetId || fallbackSpreadsheetId || "",
    rowCount: source.rowCount,
    codigoIpress: source.facilityCode,
    lastUpdate: source.lastUpdate,
    equipmentDate: source.equipmentDate,
  }));
  return refs.every((ref) => ref.sheetName && canReadSheetDirect(ref.spreadsheetId, ref.gid))
    ? refs
    : null;
};

const runWithConcurrency = async <T,>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
};

/** Precarga en segundo plano: hojas en paralelo, tamaño de tanda y respiro entre hojas. */
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_COMMIT_SIZE = 4;
const PREFETCH_PAUSE_MS = 400;
/** Espera antes de empezar: primero se dibuja el directorio. */
const PREFETCH_START_DELAY_MS = 1500;
/** Tope por pasada: un usuario DIRESA puede ver 10 UNGET con ~30 IPRESS cada una. */
const PREFETCH_MAX_SHEETS = 40;

/** La lista de pestañas cambia poco: Apps Script se consulta para ella como máximo cada 30 min. */
const GAS_SHEET_LIST_REFRESH_MS = 30 * 60 * 1000;
const DIRECT_SHEET_REFRESH_CONCURRENCY = 3;

const sameSheetDate = (metaValue?: string, existingValue?: string, existingTs?: number) => {
  const current = (metaValue || "").trim();
  const previous = (existingValue || "").trim();
  if (!current && !previous) return true;
  if (!current || !previous) return false;
  const currentTs = parseDataDate(current);
  const previousTs = existingTs || parseDataDate(previous);
  return currentTs > 0 && previousTs > 0 ? currentTs === previousTs : current === previous;
};

/**
 * Aplica la metadata al directorio de una UNGET sin descargar stock.
 *
 * Las hojas cuyo stock ya está guardado y cambió conservan su tarjeta anterior hasta que
 * se descarguen: si la descarga falla, la próxima sincronización las vuelve a detectar.
 */
const mergeMetadataIntoSources = (
  metadataList: GasSheetMetadata[],
  currentSources: SheetSource[],
  loadedSourceIds: Set<string>,
  ctx: MetadataSourceContext,
): { merged: SheetSource[]; changedSheetNames: string[] } => {
  const merged: SheetSource[] = [];
  const changedSheetNames: string[] = [];

  // Las pestañas que no son establecimientos (la `Sheet3` que crea Google, una copia de
  // trabajo) no llegan a ser tarjetas: ver `isFacilitySheet`.
  metadataList.filter(isFacilitySheet).forEach((meta) => {
    const newId = `${ctx.urlIndex}_${meta.id}`;
    const existing =
      currentSources.find((s) => s.id === newId) ||
      currentSources.find((s) => (s.sheetName || s.name) === meta.name);
    const hasSheetData = !!existing && loadedSourceIds.has(existing.id);

    if (!hasSheetData) {
      merged.push(sourceFromMetadata(meta, ctx, existing ? { ...existing, id: newId } : undefined));
      return;
    }

    const isUpToDate =
      sameSheetDate(meta.lastUpdate, existing.lastUpdate, existing.lastUpdateTime) &&
      sameSheetDate(meta.equipmentDate, existing.equipmentDate, existing.equipmentDateTime);
    if (isUpToDate) {
      merged.push(sourceFromMetadata(meta, ctx, existing));
    } else {
      merged.push(existing);
      changedSheetNames.push(meta.name);
    }
  });

  return { merged, changedSheetNames };
};

/** Hojas por petición al refrescar stock ya guardado; lotes pequeños fallan menos en Apps Script. */
const CHANGED_SHEETS_BATCH_SIZE = 5;

const getRowFieldValue = (row: any, ...fieldPatterns: string[]): string => {
  if (!row || typeof row !== "object") return "";
  for (const pattern of fieldPatterns) {
    if (row[pattern]) return String(row[pattern]);
  }
  const keys = Object.keys(row);
  for (const pattern of fieldPatterns) {
    const patNorm = pattern.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matchingKey = keys.find((k) => k.toUpperCase().replace(/[^A-Z0-9]/g, "") === patNorm);
    if (matchingKey && row[matchingKey]) return String(row[matchingKey]);
  }
  return "";
};

const formatFullDate = (val?: any): string => {
  if (!val) return "Sin fecha";
  if (typeof val === "number") {
    if (val === 0) return "Sin fecha";
    const d = new Date(val);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  const str = String(val).trim();
  if (!str) return "Sin fecha";

  const standardMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/);
  if (standardMatch) {
    const [, day, month, year, time] = standardMatch;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}${time || ""}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  return str;
};

const datesMatch = (ts1?: number, ts2?: number): boolean => {
  if (!ts1 || !ts2) return true;
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
};

const normalizeRowData = (
  row: any,
  lastUpdateStr: string,
  equipmentDateStr: string,
  uniqueSourceId: string,
) => {
  if (!row || typeof row !== "object") return null;

  const idVal =
    getRowFieldValue(
      row,
      "ID_Producto",
      "ID_PRODUCTO",
      "CODIGO_SIG",
      "CODIGO",
      "COD_SISMED",
      "ID",
      "COD_MED",
      "COD_PROD",
    ) || row.ID_Producto || "";

  const nameVal =
    getRowFieldValue(
      row,
      "Nombre",
      "NOMBRE",
      "DESCRIPCION",
      "PRODUCTO",
      "MEDICAMENTO",
      "DENOMINACION",
      "NOMBRE_PRODUCTO",
      "DESC_PRODUCTO",
      "MEDICAMENTO_INSUMO",
      "DESC_ALM",
    ) || row.Nombre || "";

  const rawUltima =
    getRowFieldValue(
      row,
      "ULTIMA_ACTUALIZACION",
      "ULTIMA ACTUALIZACION",
      "Ultima_Actualizacion",
    ) || lastUpdateStr;
  const rawEquipo =
    getRowFieldValue(
      row,
      "FECHA_DEL_EQUIPO",
      "FECHA DEL EQUIPO",
      "Fecha_Del_Equipo",
    ) || equipmentDateStr;
  const fecVencim = getRowFieldValue(
    row,
    "Fec_Vencim",
    "FEC_VENCIM",
    "FECHA_VENCIMIENTO",
    "FECHA_VENCIM",
  );

  const hasKeys = Object.keys(row).length > 0;
  if (!hasKeys) return null;

  const hasContent =
    idVal ||
    nameVal ||
    row.Saldo !== undefined ||
    row.SALDO !== undefined ||
    row.Stock !== undefined ||
    Object.values(row).some(
      (v) => v !== undefined && v !== null && String(v).trim() !== "",
    );

  if (!hasContent) return null;

  return {
    ...row,
    ID_Producto: idVal,
    Nombre: nameVal,
    Fec_Vencim: formatDate(fecVencim || row.Fec_Vencim),
    Ultima_Actualizacion: formatDate(rawUltima),
    FECHA_DEL_EQUIPO: formatDate(rawEquipo),
    sourceId: uniqueSourceId,
  };
};

const getUpdateStatus = (timestamp?: number) => {
  if (!timestamp || timestamp === 0)
    return { color: "bg-gray-400", label: "Sin datos", fullLabel: "Sin datos" };

  const now = new Date().getTime();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) {
    return {
      color: "bg-emerald-500",
      label: "Actualizado recientemente",
      fullLabel: "Actualizado recientemente",
    };
  }

  // Dentro de la hora (<= 1 hora): Verde
  if (diffHours <= 1) {
    const minLabel = diffMinutes <= 0 ? "< 1m" : `${diffMinutes}m`;
    const minFullLabel =
      diffMinutes <= 0
        ? "Menos de un minuto"
        : `${diffMinutes} minuto${diffMinutes !== 1 ? "s" : ""}`;
    return {
      color: "bg-emerald-500",
      label: `Hace ${minLabel}`,
      fullLabel: `Hace ${minFullLabel}`,
    };
  }

  // Entre 1 y 24 horas: Amarillo
  if (diffHours <= 24) {
    const hrs = Math.floor(diffHours);
    const mins = diffMinutes % 60;
    return {
      color: "bg-amber-500",
      label: `Hace ${hrs}h ${mins}m`,
      fullLabel: `Hace ${hrs} hora${hrs !== 1 ? "s" : ""} ${mins} minuto${mins !== 1 ? "s" : ""}`,
    };
  }

  // Más de 24 horas: Rojo
  const days = Math.floor(diffHours / 24);
  const hrs = Math.floor(diffHours) % 24;
  return {
    color: "bg-red-500",
    label: `Hace ${days}d ${hrs}h`,
    fullLabel: `Hace ${days} día${days !== 1 ? "s" : ""} ${hrs} hora${hrs !== 1 ? "s" : ""}`,
  };
};

const renderRangeFilter = (
  unit: "hours" | "days",
  setUnit: React.Dispatch<React.SetStateAction<"hours" | "days">>,
  value: number,
  setValue: React.Dispatch<React.SetStateAction<number>>,
  condition: "with" | "without",
  setCondition: React.Dispatch<React.SetStateAction<"with" | "without">>,
  title: string,
  onConditionLabel: string = "ACTUALIZADO",
  offConditionLabel: string = "NO ACTUALIZADO",
  onConditionFullLabel: string = "ACTUALIZADOS",
  offConditionFullLabel: string = "NO ACTUALIZADOS",
) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
          <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
            {title}
          </h4>
        </div>
        <div className="flex flex-col gap-4 w-full pl-3.5 border-l-2 border-slate-100">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shadow-sm shadow-slate-200/50 p-1 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  setUnit("hours");
                  if (unit !== "hours") setValue(0);
                }}
                className={`flex-1 px-4 py-1.5 min-w-[80px] text-[10px] font-black rounded-md transition-all ${unit === "hours" ? "bg-white text-teal-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              >
                HORAS
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnit("days");
                  if (unit !== "days") setValue(0);
                }}
                className={`flex-1 px-4 py-1.5 min-w-[80px] text-[10px] font-black rounded-md transition-all ${unit === "days" ? "bg-white text-teal-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              >
                DÍAS
              </button>
            </div>

            <div className="flex rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shadow-sm shadow-slate-200/50 p-1 w-full sm:w-auto transition-all duration-300">
              <button
                type="button"
                onClick={() => setCondition("with")}
                className={`flex-1 px-4 py-1.5 text-[10px] font-black tracking-tight rounded-md transition-all whitespace-nowrap ${condition === "with" ? "bg-white text-blue-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              >
                {onConditionLabel}
              </button>
              <button
                type="button"
                onClick={() => setCondition("without")}
                className={`flex-1 px-4 py-1.5 text-[10px] font-black tracking-tight rounded-md transition-all whitespace-nowrap ${condition === "without" ? "bg-white text-blue-700 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"}`}
              >
                {offConditionLabel}
              </button>
            </div>
          </div>

          <div className="pt-5 pb-1 flex items-center gap-4 group">
            <div className="flex-1 relative">
              <div className="absolute -top-7 left-0 w-full text-center pointer-events-none">
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest bg-white px-2.5 py-1 rounded-full border shadow-sm transition-all transform duration-300 ${value > 0 ? "text-blue-600 border-blue-100 shadow-blue-100/50 -translate-y-1 opacity-100" : "text-slate-400 border-slate-100 translate-y-0 opacity-0 group-hover:-translate-y-1 group-hover:opacity-100"}`}
                >
                  {value === 0
                    ? "Filtro desactivado"
                    : `${value} ${unit === "hours" ? "Hora" + (value !== 1 ? "s" : "") : "Día" + (value !== 1 ? "s" : "")}`}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setValue(Math.max(0, value - 1))}
                  className="p-1 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 shrink-0 shadow-sm bg-white border border-slate-200/60"
                >
                  <Minus className="h-4 w-4" />
                </button>

                <input
                  type="range"
                  min="0"
                  max={unit === "hours" ? 23 : 30}
                  step="1"
                  value={value}
                  onChange={(e) => setValue(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 hover:h-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />

                <button
                  type="button"
                  onClick={() =>
                    setValue(Math.min(unit === "hours" ? 23 : 30, value + 1))
                  }
                  className="p-1 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 shrink-0 shadow-sm bg-white border border-slate-200/60"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex justify-between text-[10px] font-extrabold text-slate-400/80 tracking-wide uppercase px-8 select-none mt-2">
                <span>Todos</span>
                <span>{unit === "hours" ? "23 Horas" : "30 Días"}</span>
              </div>
            </div>
          </div>

          {value > 0 && (
            <div className="-mt-1 flex justify-center animate-in fade-in zoom-in duration-300">
              <div className="text-center text-[10px] font-bold text-blue-700 bg-blue-50/80 py-1.5 px-3 rounded-md border border-blue-100 shadow-xs">
                Establecimientos{" "}
                {condition === "with"
                  ? onConditionFullLabel.toLowerCase()
                  : offConditionFullLabel.toLowerCase()}{" "}
                hace {value}{" "}
                {unit === "hours"
                  ? value === 1
                    ? "hora"
                    : "horas"
                  : value === 1
                    ? "día"
                    : "días"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const renderSyncStatusPill = (timestamp?: number) => {
  const statusObj = getUpdateStatus(timestamp);
  const isEmerald =
    statusObj.color.includes("emerald") ||
    statusObj.color.includes("bg-emerald-500");
  const isAmber =
    statusObj.color.includes("amber") ||
    statusObj.color.includes("bg-amber-500");
  const isRed =
    statusObj.color.includes("red") || statusObj.color.includes("bg-red-500");

  let containerClass = "bg-slate-50 text-slate-500 border-slate-200";
  let dotClass = "bg-slate-400";

  if (isEmerald) {
    containerClass =
      "bg-[#f0fdf4] text-[#166534] border-[#bbf7d0] hover:bg-[#e8fbf0]";
    dotClass = "bg-[#22c55e]";
  } else if (isAmber) {
    containerClass =
      "bg-[#fffbeb] text-[#92400e] border-[#fef08a] hover:bg-[#fff9db]";
    dotClass = "bg-[#f59e0b]";
  } else if (isRed) {
    containerClass =
      "bg-[#fef2f2] text-[#991b1b] border-[#fecaca] hover:bg-[#fee2e2]";
    dotClass = "bg-[#ef4444]";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8.5px] font-black tracking-wide border shadow-3xs transition-colors select-none whitespace-nowrap overflow-hidden ${containerClass}`}
    >
      <span
        className={`h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full shrink-0 ${dotClass}`}
      />
      <span className="truncate">{statusObj.label}</span>
    </span>
  );
};

const getSheetType = (name: string): "CS" | "PS" | "ALM" | "HOSP" | "OTRO" => {
  const u = name.toUpperCase();
  if (u.includes("C.S.") || u.includes("CENTRO DE SALUD")) return "CS";
  if (u.includes("P.S.") || u.includes("PUESTO DE SALUD")) return "PS";
  if (u.includes("ALM") || u.includes("ALMACEN")) return "ALM";
  if (u.includes("HOSP") || u.includes("HOSPITAL")) return "HOSP";
  return "OTRO";
};

const formatDate = (dateValue: any): string => {
  if (!dateValue) return "";
  const str = String(dateValue).trim();
  
  // Si ya tiene formato D/M/YYYY, DD/M/YYYY, D/MM/YYYY o DD/MM/YYYY
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    return `${day}/${month}/${year}`;
  }
  
  try {
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (e) {}
  return str;
};

/**
 * Código para mostrar en la tarjeta de una hoja.
 *
 * Se usa el de la IPRESS, no el de la farmacia: todas las farmacias de una IPRESS comparten
 * pestaña, y el ALMCOD de la primera fila puede ser el de un puesto comunal. Si no se
 * reconoce el código se muestra tal cual, que es más útil que un guion.
 */
const formatAlmCode = (code: string | undefined): string =>
  sheetOwnerCodeOf(code) || String(code || "").trim() || "-";

const getItemExpiration = (
  item: SIGData,
): { month: number; year: number } | null => {
  if (!item || !item.Fec_Vencim) return null;
  const parts = item.Fec_Vencim.split(/[\/\-]/);
  if (parts.length === 3) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);

    let month = 0,
      year = 2000;

    if (p0 > 1000) {
      year = p0;
      month = p1 - 1;
    } else if (p2 > 1000 || p2 < 100) {
      year = p2 < 100 ? p2 + 2000 : p2;
      if (p0 > 12) {
        month = p1 - 1;
      } else if (p1 > 12) {
        month = p0 - 1;
      } else {
        month = p1 - 1;
      }
    }
    if (!isNaN(month) && !isNaN(year)) {
      return { month: month + 1, year };
    }
  } else if (parts.length === 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    if (!isNaN(p0) && !isNaN(p1)) {
      const month = p0;
      const year = p1 < 100 ? p1 + 2000 : p1;
      return { month, year };
    }
  }
  return null;
};

/**
 * Código de almacén de una hoja, leído de su propio stock.
 *
 * El encabezado llega tal cual lo escribió quien hizo la hoja: `processSheet_` del backend
 * solo lo recorta, no lo normaliza. Así que buscar la propiedad `ALMCOD` exacta dejaba sin
 * código a las hojas que la escriben `Almcod`, `ALM COD` o `ALM_COD` —el dato estaba, pero
 * la aplicación no lo encontraba y la tarjeta salía sin su código. Se lee con el mismo
 * criterio tolerante que ya se usa para las fechas.
 */
const readAlmCode = (row: any): string => getRowFieldValue(row, "ALMCOD", "ALM_COD", "ALM COD");

/**
 * Código de almacén de una hoja.
 *
 * Se prefiere el del stock descargado, que es el más fresco, pero si todavía no se ha
 * descargado se usa el que la metadata leyó de la cabecera. Antes solo se miraba el stock,
 * así que el código tardaba en aparecer —o no aparecía nunca en una hoja cuyo stock no se
 * llega a descargar— mientras el conteo de ítems, que sí sale de la metadata, ya estaba
 * ahí. Esa asimetría es la que hacía pensar que la hoja no tenía ALMCOD.
 */
const getAlmCodeForSheet = (
  sheetId: string,
  sheetData: SIGData[],
  almcodDeMetadata?: string,
): string => {
  const row = sheetData.find((r) => r.sourceId === sheetId && readAlmCode(r));
  if (row) return formatAlmCode(readAlmCode(row));
  const deMetadata = String(almcodDeMetadata || "").trim();
  return deMetadata ? formatAlmCode(deMetadata) : "";
};

const getExpirationStats = (records: SIGData[]) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  const expired: SIGData[] = [];
  const expiringThisMonth: SIGData[] = [];
  const expiringNextMonth: SIGData[] = [];

  records.forEach((r) => {
    const stock = parseFloat(String(r.Saldo || "0").replace(/,/g, ""));
    if (stock <= 0) return;
    if (!r.Fec_Vencim) return;

    const parts = r.Fec_Vencim.split(/[\/\-]/);
    if (parts.length === 3) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      const p2 = parseInt(parts[2], 10);

      let day = 1,
        month = 0,
        year = 2000;

      if (p0 > 1000) {
        // format YYYY-MM-DD
        year = p0;
        month = p1 - 1;
        day = p2;
      } else if (p2 > 1000 || p2 < 100) {
        // format DD/MM/YYYY o MM/DD/YYYY
        year = p2 < 100 ? p2 + 2000 : p2;
        if (p0 > 12) {
          day = p0;
          month = p1 - 1;
        } else if (p1 > 12) {
          month = p0 - 1;
          day = p1;
        } else {
          // Default to DD/MM/YYYY
          day = p0;
          month = p1 - 1;
        }
      }

      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const expDate = new Date(year, month, day);
        // Consider expired strictly if end of the day passed
        expDate.setHours(23, 59, 59, 999);

        if (expDate < today) {
          expired.push(r);
        } else if (month === currentMonth && year === currentYear) {
          expiringThisMonth.push(r);
        } else if (month === nextMonth && year === nextMonthYear) {
          expiringNextMonth.push(r);
        }
      }
    } else if (parts.length === 2) {
      // MM/YYYY or MM/YY
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      if (!isNaN(p0) && !isNaN(p1)) {
        const month = p0 - 1;
        const year = p1 < 100 ? p1 + 2000 : p1;
        // Expiry is end of the month
        const expDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
        if (expDate < today) {
          expired.push(r);
        } else if (month === currentMonth && year === currentYear) {
          expiringThisMonth.push(r);
        } else if (month === nextMonth && year === nextMonthYear) {
          expiringNextMonth.push(r);
        }
      }
    }
  });

  return {
    expired,
    expiringThisMonth,
    expiringNextMonth,
    expiredCount: expired.length,
    expiringThisMonthCount: expiringThisMonth.length,
    expiringNextMonthCount: expiringNextMonth.length,
  };
};

export const SheetSearchModule: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission("SIG_SEARCH");

  // Configuración
  const [scriptUrls, setScriptUrls] = useState<UngetConfig[]>([]);
  const [sources, setSources] = useState<SheetSource[]>([]);
  const [data, setData] = useState<SIGData[]>([]);
  /**
   * Filas agrupadas por IPRESS. Cada tarjeta recorría toda la lista en cada dibujado: con
   * las 22 IPRESS en memoria eso son cientos de miles de comparaciones por render.
   */
  const dataBySource = useMemo(() => {
    const grouped = new Map<string, SIGData[]>();
    for (const row of data) {
      const sourceId = String(row?.sourceId || "");
      if (!sourceId) continue;
      const rows = grouped.get(sourceId);
      if (rows) rows.push(row);
      else grouped.set(sourceId, [row]);
    }
    return grouped;
  }, [data]);
  const rowsForSource = useCallback(
    (sourceId?: string): SIGData[] =>
      (sourceId && dataBySource.get(sourceId)) || EMPTY_SOURCE_ROWS,
    [dataBySource],
  );
  const almcodBySource = useMemo(() => {
    const porId = new Map<string, string>();
    for (const source of sources) {
      if (source?.id && source.almcod) porId.set(source.id, source.almcod);
    }
    return porId;
  }, [sources]);
  /** Código de almacén de una hoja, sin esperar a que se descargue su stock. */
  const codeForSheet = useCallback(
    (sheetId?: string): string =>
      sheetId ? getAlmCodeForSheet(sheetId, data, almcodBySource.get(sheetId)) : "",
    [data, almcodBySource],
  );
  const [lastGlobalSync, setLastGlobalSync] = useState<Date | null>(null);
  const [allFacilities, setAllFacilities] = useState<any[]>([]);
  const [allUngets, setAllUngets] = useState<any[]>([]);
  const [allDiresas, setAllDiresas] = useState<any[]>([]);
  const [allOgess, setAllOgess] = useState<any[]>([]);
  const [allAssignments, setAllAssignments] = useState<any[]>([]);
  const [allUsersList, setAllUsersList] = useState<any[]>([]);
  const [allJurisdictionConfigs, setAllJurisdictionConfigs] = useState<any[]>(
    [],
  );

  /**
   * Censo de cuentas que siguen activas. Decide qué conexiones se quedaron sin
   * responsable: las de un informático borrado o desactivado, que si no nadie podría
   * volver a tocar. Mientras la lista de usuarios no haya llegado, está vacío y entonces
   * `isConnectionOrphaned` no declara huérfano a nadie.
   */
  const cuentasActivas = useMemo(
    () =>
      new Set(
        (allUsersList || [])
          .filter((u: any) => u?.username && u.isActive !== false)
          .map((u: any) => String(u.username)),
      ),
    [allUsersList],
  );

  /**
   * Lo que el guardado necesita para poder adoptar una conexión sin responsable: de quién
   * era, y sobre qué UNGET puede decidir este usuario. Lo segundo importa: sin ese límite,
   * el envío de un informático de UNGET —que solo ve su jurisdicción— retiraría las
   * huérfanas de todas las demás.
   */
  const opcionesDeAdopcion = useMemo(() => {
    const duenosAusentes = new Set<string>();
    (scriptUrls || []).forEach((config) => {
      if (isConnectionOrphaned(config, cuentasActivas)) duenosAusentes.add(connectionOwner(config));
    });
    return {
      orphanOwners: Array.from(duenosAusentes),
      visibleUngetIds: Array.from(
        new Set((scriptUrls || []).map((c) => String(c?.ungetId || "").trim()).filter(Boolean)),
      ),
    };
  }, [scriptUrls, cuentasActivas]);

  // UI states
  const [isLoading, setIsLoading] = useState(false);
  const [isSilentSyncing, setIsSilentSyncing] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(true); // Nuevo: Estado para carga de config
  const [error, setError] = useState<string | null>(null);
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});
  const [retryingUrls, setRetryingUrls] = useState<Record<string, boolean>>({});
  // IPRESS cuyo stock se está descargando bajo demanda (evita descargas duplicadas por doble clic).
  const loadingSourceIdsRef = useRef<Set<string>>(new Set());
  // Estado de la precarga en segundo plano.
  const prefetchRef = useRef({ running: false, enabled: true });
  // Libros detectados ya guardados en la configuración, por conexión.
  const persistedSpreadsheetIdsRef = useRef<Set<string>>(new Set());
  // Última consulta de la lista de pestañas a Apps Script, por URL (lectura directa activa).
  const gasSheetListRefreshRef = useRef<Record<string, number>>({});
  const [quickFixConfig, setQuickFixConfig] = useState<UngetConfig | null>(null);
  const [quickFixUrlInput, setQuickFixUrlInput] = useState("");
  /** Conexión cuya eliminación está esperando confirmación en el diálogo. */
  const [conexionAEliminar, setConexionAEliminar] = useState<{
    index: number;
    config: UngetConfig;
  } | null>(null);
  const [isDeletingConnection, setIsDeletingConnection] = useState(false);
  /**
   * La conexión abierta en el modal del engranaje es de otro usuario. Entonces el diálogo
   * sirve para lo único que sí funciona desde aquí: probar el enlace y ver por qué esa
   * UNGET no conecta. Guardar queda fuera, porque el envío no incluye filas ajenas.
   */
  const quickFixEsAjena = !!quickFixConfig && !canEditConnection(quickFixConfig, user?.username, cuentasActivas);
  const [isTestingGasUrl, setIsTestingGasUrl] = useState(false);
  const [gasTestResult, setGasTestResult] = useState<{
    success: boolean;
    message: string;
    count?: number;
  } | null>(null);
  const [isSavingGasUrl, setIsSavingGasUrl] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sheetSearchTerm, setSheetSearchTerm] = useState("");
  const [ungetSearchTerm, setUngetSearchTerm] = useState("");
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Supabase Sync States
  const [supabaseSyncs, setSupabaseSyncs] = useState<Record<string, any>>({});
  const [selectedFacilitySyncHistory, setSelectedFacilitySyncHistory] =
    useState<any[]>([]);
  const [isSyncHistoryModalOpen, setIsSyncHistoryModalOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isCheckingLatestSyncs, setIsCheckingLatestSyncs] = useState(false);
  const [activeHistoryFacility, setActiveHistoryFacility] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Filtros Avanzados (Sidebar Derecha)
  const [isAdvancedFiltersSidebarOpen, setIsAdvancedFiltersSidebarOpen] =
    useState(false);
  const [filter_CS, setFilter_CS] = useState(true);
  const [filter_PS, setFilter_PS] = useState(true);
  const [filter_ALM, setFilter_ALM] = useState(true);
  const [filter_HOSP, setFilter_HOSP] = useState(true);
  const [filter_OTRO, setFilter_OTRO] = useState(true);

  const [filter_emerald, setFilter_emerald] = useState(true);
  const [filter_amber, setFilter_amber] = useState(true);
  const [filter_red, setFilter_red] = useState(true);
  const [filter_gray, setFilter_gray] = useState(true);

  const [filterSortOrder, setFilterSortOrder] = useState<string>("name_asc");
  const [filterHasPendingExpirations, setFilterHasPendingExpirations] =
    useState<boolean>(false);
  const [filterDateUnit, setFilterDateUnit] = useState<"hours" | "days">(
    "hours",
  );
  const [filterDateValue, setFilterDateValue] = useState<number>(0);
  const [filterDateCondition, setFilterDateCondition] = useState<
    "with" | "without"
  >("with");

  const [filterMovementsUnit, setFilterMovementsUnit] = useState<
    "hours" | "days"
  >("hours");
  const [filterMovementsValue, setFilterMovementsValue] = useState<number>(0);
  const [filterMovementsCondition, setFilterMovementsCondition] = useState<
    "with" | "without"
  >("with");

  // Estados para dropdowns de filtros personalizados
  const [isSortOrderDropdownOpen, setIsSortOrderDropdownOpen] = useState(false);

  // Navigation hierarchy
  const [viewLevel, setViewLevel] = useState<"ungets" | "sheets" | "data">(
    "ungets",
  );
  const [selectedUngetIndex, setSelectedUngetIndex] = useState<number | null>(
    null,
  );
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [sheetsViewMode, setSheetsViewMode] = useState<
    "grid" | "list" | "compact" | "table"
  >("grid");
  const [isTableFullscreen, setIsTableFullscreen] = useState(false);
  const [stockModalSourceId, setStockModalSourceId] = useState<string | null>(
    null,
  );
  const [stockModalSearchTerm, setStockModalSearchTerm] = useState("");

  // Capture mode for deficiency reporting (Photo snapshot / WhatsApp)
  const [isCaptureMode, setIsCaptureMode] = useState<boolean>(false);
  const [selectedCaptureIds, setSelectedCaptureIds] = useState<Set<string>>(
    new Set(),
  );
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState<boolean>(false);

  // Handler to toggle native fullscreen + React state
  const handleToggleTableFullscreen = (targetState: boolean) => {
    const elem = document.documentElement;
    if (targetState) {
      if (elem.requestFullscreen) {
        elem
          .requestFullscreen()
          .catch((err) =>
            console.error("Error enabling full-screen mode:", err),
          );
      } else if ((elem as any).webkitRequestFullscreen) {
        (elem as any).webkitRequestFullscreen();
      } else if ((elem as any).msRequestFullscreen) {
        (elem as any).msRequestFullscreen();
      }
      setIsTableFullscreen(true);
    } else {
      if (document.exitFullscreen && document.fullscreenElement) {
        document
          .exitFullscreen()
          .catch((err) =>
            console.error("Error exiting full-screen mode:", err),
          );
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
      setIsTableFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullScreenChange = () => {
      const isNativeFullScreen =
        !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).msFullscreenElement;
      if (!isNativeFullScreen) {
        setIsTableFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullScreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullScreenChange);
    document.addEventListener("msfullscreenchange", handleFullScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullScreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullScreenChange,
      );
      document.removeEventListener(
        "msfullscreenchange",
        handleFullScreenChange,
      );
    };
  }, []);
  // Modal & Config
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [isDataFiltersOpen, setIsDataFiltersOpen] = useState(false);
  const [dataFilterTipsum, setDataFilterTipsum] = useState<string>("all");
  const [dataFilterFFinan, setDataFilterFFinan] = useState<string>("all");
  const [dataFilterStock, setDataFilterStock] = useState<string>("all");
  const [dataFilterExpiration, setDataFilterExpiration] =
    useState<string>("all");
  const [dataFilterExpMonth, setDataFilterExpMonth] = useState<string>("all");
  const [dataFilterExpYear, setDataFilterExpYear] = useState<string>("all");
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);
  const [reportSort, setReportSort] = useState<{
    field: "name" | "status" | "date";
    order: "asc" | "desc";
  }>({ field: "date", order: "asc" });
  const reportTableRef = useRef<HTMLDivElement>(null);

  const exportReportToExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Reporte de Actualización", {
      views: [{ showGridLines: true }],
    });

    // Generar fecha actual formateada
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = today.getFullYear();
    const currentDateStr = `${day}-${month}-${year}`;

    // Fila 1: Título del Reporte
    ws.addRow([
      `Reporte de actualización de Stock detallado SISMED ${currentDateStr}`,
    ]);
    ws.mergeCells("A1:G1");
    const titleCell = ws.getCell("A1");
    titleCell.font = {
      name: "Calibri",
      size: 16,
      bold: true,
      color: { argb: "000000" },
    };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 40;

    // Filas 2: En blanco para espaciado
    ws.addRow([]);
    ws.getRow(2).height = 12;

    // Fila 3: Encabezados de Columnas
    const headers = [
      "COD. SISMED",
      "ESTABLECIMIENTO",
      "ESTADO DE ACTUALIZACION",
      "FECHA DEL EQUIPO",
      "ULTIMA ACTUALIZACION",
      "VENCIDOS",
      "VENCEN ESTE MES",
      "VENCEN PROX. MES",
    ];

    ws.addRow(headers);

    ws.getRow(3).eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "002060" },
      };
      cell.font = {
        color: { argb: "FFFFFF" },
        bold: true,
        name: "Calibri",
        size: 11,
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFFFFF" } },
        left: { style: "thin", color: { argb: "FFFFFF" } },
        bottom: { style: "thin", color: { argb: "FFFFFF" } },
        right: { style: "thin", color: { argb: "FFFFFF" } },
      };
    });
    ws.getRow(3).height = 25;

    // Rellenar Datos (Fila 4 en adelante)
    sortedReportSources.forEach((sheet, idx) => {
      const description = describeSheetName(sheet.name);
      const code = codeForSheet(sheet.id);
      const status = getUpdateStatus(sheet.lastUpdateTime);

      const sheetData = rowsForSource(sheet.id);
      const { expiredCount, expiringThisMonthCount, expiringNextMonthCount } =
        getExpirationStats(sheetData);

      let bgArgb = "FFFFFF";
      let fontArgb = "000000";

      if (status.color === "bg-red-500") {
        bgArgb = "FF8080"; // Rojo suave / agradable
        fontArgb = "000000";
      } else if (status.color === "bg-amber-500") {
        bgArgb = "FFC000"; // Amarillo/Ambar
        fontArgb = "000000";
      } else if (status.color === "bg-emerald-500") {
        bgArgb = "92D050"; // Verde
        fontArgb = "000000";
      } else if (status.color === "bg-gray-400") {
        bgArgb = "D9D9D9"; // Gris
        fontArgb = "595959";
      }

      const codeStr = code ? String(code).trim() : "";

      const row = ws.addRow([
        codeStr,
        description,
        status.label,
        sheet.equipmentDateTime
          ? formatFullDate(sheet.equipmentDateTime)
          : "No disponible",
        sheet.lastUpdateTime
          ? formatFullDate(sheet.lastUpdateTime)
          : "No sincronizado",
        expiredCount,
        expiringThisMonthCount,
        expiringNextMonthCount,
      ]);

      row.eachCell((cell, colNumber) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: bgArgb },
        };
        cell.font = {
          color: { argb: fontArgb },
          name: "Calibri",
          size: 11,
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFFFFF" } },
          left: { style: "thin", color: { argb: "FFFFFF" } },
          bottom: { style: "thin", color: { argb: "FFFFFF" } },
          right: { style: "thin", color: { argb: "FFFFFF" } },
        };

        if (colNumber === 1) {
          cell.numFmt = "@"; // Forzar formato texto para preservar ceros a la izquierda
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if (colNumber === 2) {
          cell.alignment = { horizontal: "left", vertical: "middle" };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
      row.height = 20;
    });

    ws.getColumn(1).width = 15;
    ws.getColumn(2).width = 35;
    ws.getColumn(3).width = 32;
    ws.getColumn(4).width = 25;
    ws.getColumn(5).width = 25;
    ws.getColumn(6).width = 15;
    ws.getColumn(7).width = 20;
    ws.getColumn(8).width = 20;

    const buffer = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer]),
      `Reporte_General_Stock_${formatFullDate(Date.now()).replace(/[:/ ]/g, "_")}.xlsx`,
    );
  };

  // States for Export Options Modal
  const [isExportOptionsModalOpen, setIsExportOptionsModalOpen] =
    useState(false);
  const [exportCS, setExportCS] = useState(true);
  const [exportPS, setExportPS] = useState(true);
  const [exportALM, setExportALM] = useState(true);
  const [exportHOSP, setExportHOSP] = useState(true);
  const [exportOTRO, setExportOTRO] = useState(true);

  const [exportEmerald, setExportEmerald] = useState(true);
  const [exportAmber, setExportAmber] = useState(true);
  const [exportRed, setExportRed] = useState(true);
  const [exportGray, setExportGray] = useState(true);

  const [exportDateUnit, setExportDateUnit] = useState<"hours" | "days">(
    "hours",
  );
  const [exportDateValue, setExportDateValue] = useState<number>(0);
  const [exportDateCondition, setExportDateCondition] = useState<
    "with" | "without"
  >("with");
  const [exportHasPendingExpirations, setExportHasPendingExpirations] =
    useState<boolean>(false);
  const [exportScope, setExportScope] = useState<"single" | "all">("single");
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // Nuevo: índice que se está editando
  const [tempUrls, setTempUrls] = useState<UngetConfig[]>([]);
  const [newUrlInput, setNewUrlInput] = useState("");
  const [newNameInput, setNewNameInput] = useState("");
  // Enlace o ID del libro de Google Sheets de la UNGET (lectura directa).
  const [newSpreadsheetInput, setNewSpreadsheetInput] = useState("");
  const [spreadsheetCheck, setSpreadsheetCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [isCheckingSpreadsheet, setIsCheckingSpreadsheet] = useState(false);
  /** La Web App es un respaldo: la sección viene plegada y se abre si ya hay una configurada. */
  const [isWebAppSectionOpen, setIsWebAppSectionOpen] = useState(false);
  const [isShareHelpOpen, setIsShareHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SIGData | null>(null);

  // Modal para vencimientos en tabla
  const [isExpirationModalOpen, setIsExpirationModalOpen] = useState(false);
  const [expirationModalType, setExpirationModalType] = useState<
    "expired" | "expiring" | null
  >(null);

  const maxUrlsAllowed = user?.maxUrlsAllowed;

  const userDiresaId = user?.personnelData?.diresaId || user?.facilityData?.diresaId || (user as any)?.diresaId;
  const userOgessId = user?.personnelData?.ogessId || user?.facilityData?.ogessId || (user as any)?.ogessId;
  const userUngetId = user?.personnelData?.ungetId || user?.facilityData?.ungetId || (user as any)?.ungetId;
  const userRole = (user?.role || "").toUpperCase();
  const userExplicitLevel = user?.jurisdictionLevel;

  const isGlobalRole = userExplicitLevel === "GLOBAL" || userRole === "ADMIN" || userRole === "GLOBAL" || userRole.includes("SUPER") || userRole.includes("GENERAL") || userRole === "ADMINISTRADOR";
  const isDiresaRole = !isGlobalRole && (userExplicitLevel === "DIRESA" || userRole.includes("DIRESA"));
  const isOgessRole = !isGlobalRole && (userExplicitLevel === "OGESS" || userRole.includes("OGESS"));
  const isUngetRole = !isGlobalRole && (userExplicitLevel === "UNGET" || userRole.includes("UNGET") || userRole.includes("RED"));

  const canManageConfigs = useMemo(() => {
    if (!user) return false;
    const role = (user.role || "").toUpperCase();
    const level = (user.jurisdictionLevel || "").toUpperCase();

    // 1. Super Administradores y Administradores del Sistema
    if (
      role === "ADMIN" ||
      role === "ADMINISTRADOR" ||
      role.includes("SUPER") ||
      role.includes("GENERAL") ||
      level === "GLOBAL"
    ) {
      return true;
    }

    // 2. Informático SISMED o Responsable de Sistemas / Soporte
    if (
      role.includes("INFORMATIC") ||
      role.includes("SISTEMAS") ||
      role.includes("RESPONSABLE SISMED") ||
      role.includes("ADMIN_SISMED") ||
      role.includes("SOPORTE")
    ) {
      return true;
    }

    // 3. Nivel DIRESA u OGESS con rol administrativo o coordinador
    if (
      (level === "DIRESA" || level === "OGESS" || role.includes("DIRESA") || role.includes("OGESS")) &&
      (role.includes("ADMIN") || role.includes("COORDINADOR") || role.includes("DIRECTOR") || role.includes("JEFE"))
    ) {
      return true;
    }

    // 4. Cualquier usuario de una UNGET o Red: la conexión pertenece a su UNGET y es él
    // quien tiene que poner el enlace de su hoja. Solo puede tocar la suya, porque el
    // formulario le autocompleta su UNGET y solo ve la conexión de su jurisdicción.
    if (level === "UNGET" || role.includes("UNGET") || role.includes("RED") || role.includes("COORDINADOR")) {
      return true;
    }

    // 5. Cualquier rol de Coordinador
    if (role.includes("COORDINADOR")) {
      return true;
    }

    // Personal operativo, farmacia e IPRESS NO gestionan URLs
    return false;
  }, [user]);

  const myUnget = useMemo(() => {
    if (!userUngetId || !allUngets || allUngets.length === 0) return null;
    return allUngets.find(u => String(u.id) === String(userUngetId));
  }, [userUngetId, allUngets]);

  const availableUngetsForConfig = useMemo(() => {
    if (!allUngets || allUngets.length === 0) return [];
    
    // Una UNGET, una conexión: se descartan las que ya configuró cualquiera, no solo yo.
    // Antes solo miraba las propias, y por eso admin y el informático de la misma UNGET
    // acababan creando dos conexiones que nadie relacionaba.
    const configuradas = new Set<string>();
    tempUrls
      .filter((_, idx) => idx !== editingIndex)
      .forEach((u) => ungetConnectionKeys(u).forEach((k) => configuradas.add(k)));
    // Una conexión sin dueño —la cuenta que la creó ya no está— sigue ocupando su UNGET.
    // Pedir `c.username` la dejaba fuera y la UNGET volvía a ofrecerse como libre.
    allJurisdictionConfigs
      .filter((c) => !c.username || c.username !== user?.username)
      .forEach((c) => ungetConnectionKeys(c).forEach((k) => configuradas.add(k)));

    const yaConfigurada = (u: any) =>
      ungetConnectionKeys({ name: u.name, ungetId: u.id }).some((k) => configuradas.has(k));
    
    if (isDiresaRole && userDiresaId) {
      return allUngets.filter(u => String(u.diresaId) === String(userDiresaId) && !yaConfigurada(u));
    }
    if (isOgessRole && userOgessId) {
      return allUngets.filter(u => String(u.ogessId) === String(userOgessId) && !yaConfigurada(u));
    }
    if (isGlobalRole) {
      return allUngets.filter((u) => !yaConfigurada(u));
    }
    return [];
  }, [allUngets, isDiresaRole, userDiresaId, isOgessRole, userOgessId, isGlobalRole, tempUrls, editingIndex, allJurisdictionConfigs, user?.username]);

  useEffect(() => {
    if (isConfigOpen && editingIndex === null) {
      if (isUngetRole && myUnget) {
        setNewNameInput(myUnget.name);
      } else {
        setNewNameInput("");
      }
    }
  }, [isConfigOpen, editingIndex, isUngetRole, myUnget]);

  // Quien llega desde Administración → Establecimientos viene a configurar una conexión,
  // así que el panel se abre solo en vez de dejarlo buscando el botón.
  useEffect(() => {
    if (!canManageConfigs) return;
    if (takeNavigationIntent() === INTENT_OPEN_STOCK_CONNECTIONS) setIsConfigOpen(true);
  }, [canManageConfigs]);

  // Publicar evento al cambiar el estado de los filtros avanzados para contraer el sidebar de App.tsx
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("toggle-advanced-filters", {
        detail: { open: isAdvancedFiltersSidebarOpen },
      }),
    );
  }, [isAdvancedFiltersSidebarOpen]);

  // Cerrar automáticamente los filtros avanzados si se sale del nivel de sheets/establecimientos
  useEffect(() => {
    if (viewLevel !== "sheets") {
      setIsAdvancedFiltersSidebarOpen(false);
    }
    if (viewLevel !== "data") {
      setIsDataFiltersOpen(false);
      setDataFilterTipsum("all");
      setDataFilterFFinan("all");
      setDataFilterStock("all");
      setDataFilterExpiration("all");
    }
  }, [viewLevel]);

  // Initialize from server
  useEffect(() => {
    if (!user || !canAccess) return;

    const loadConfigs = async () => {
      setIsConfigLoading(true);
      // Lista con la que se guardaron los establecimientos de la caché: si la de ahora no
      // coincide posición a posición, esos establecimientos apuntan a otra UNGET.
      let conexionesEnCache: UngetConfig[] = [];

      // 1. CARGA RÁPIDA DESDE CACHÉ INDEXEDDB (Optimistic UI ultra-rápido)
      try {
        const [cachedUrls, cachedStock] = await Promise.all([
          stockStorageService.loadUrls(user.username),
          stockStorageService.loadStockData(user.username),
        ]);

        if (cachedUrls && cachedUrls.length > 0) {
          conexionesEnCache = cachedUrls;
          setScriptUrls(cachedUrls);
        } else {
          const savedUrls = localStorage.getItem(`aura_sig_urls_${user.username}`);
          if (savedUrls) {
            try {
              const parsed = JSON.parse(savedUrls);
              if (Array.isArray(parsed) && parsed.length > 0) setScriptUrls(parsed);
            } catch (e) {}
          }
        }

        if (cachedStock) {
          if (Array.isArray(cachedStock.sources) && cachedStock.sources.length > 0) {
            setSources(cachedStock.sources);
          }
          if (Array.isArray(cachedStock.data) && cachedStock.data.length > 0) {
            setData(cachedStock.data);
          }
          if (cachedStock.lastSync) {
            setLastGlobalSync(new Date(cachedStock.lastSync));
          }
        } else {
          // Fallback legacy localStorage
          const savedSources = localStorage.getItem(`aura_sig_sources_${user.username}`);
          if (savedSources) {
            try {
              const parsed = JSON.parse(savedSources);
              if (Array.isArray(parsed)) setSources(parsed);
            } catch (e) {}
          }

          const savedData = localStorage.getItem(`aura_sig_data_${user.username}`);
          if (savedData) {
            try {
              const parsed = JSON.parse(savedData);
              if (Array.isArray(parsed)) setData(parsed);
            } catch (e) {}
          }

          const savedSync = localStorage.getItem(`aura_sig_lastsync_${user.username}`);
          if (savedSync) {
            try {
              setLastGlobalSync(new Date(savedSync));
            } catch (e) {}
          }
        }
      } catch (cacheErr) {
        console.warn("Error leyendo caché local:", cacheErr);
      }

      // 2. CARGA EN PARALELO DE METADATOS DESDE EL SERVIDOR
      let ungs: any[] = [];
      try {
        try {
          const [facsRes, assigsRes, ungsRes, drsRes, ogsRes] = await Promise.allSettled([
            api.getFacilities(),
            api.getAllStockAssignments(),
            api.getUngets(),
            api.getDiresas(),
            api.getOgess(),
          ]);

          if (facsRes.status === "fulfilled") setAllFacilities(facsRes.value || []);
          if (assigsRes.status === "fulfilled") setAllAssignments(assigsRes.value || []);
          if (ungsRes.status === "fulfilled") {
            ungs = ungsRes.value || [];
            setAllUngets(ungs);
          }
          if (drsRes.status === "fulfilled") setAllDiresas(drsRes.value || []);
          if (ogsRes.status === "fulfilled") setAllOgess(ogsRes.value || []);
        } catch (err) {
          console.error(
            "Error loading facilities or assignments metadata:",
            err,
          );
        }

        let remoteConfigs: any[] = [];
        const role = user.role;
        let level = user.jurisdictionLevel || "";
        const r = (role || "").toUpperCase();
        if (!level) {
          if (
            r === "ADMIN" ||
            r === "GLOBAL" ||
            r.includes("SUPER") ||
            r.includes("GENERAL") ||
            r === "ADMINISTRADOR"
          )
            level = "GLOBAL";
          else if (r.includes("DIRESA")) level = "DIRESA";
          else if (r.includes("OGESS")) level = "OGESS";
          else if (r.includes("UNGET") || r.includes("RED")) level = "UNGET";
          else if (r.includes("MICRORED")) level = "MICRORED";
          else if (
            r.includes("FARMACIA") ||
            r.includes("IPRESS") ||
            r.includes("PERSONAL")
          )
            level = "IPRESS";
          else
            level = "IPRESS";
        }

        const userDiresaId =
          user.personnelData?.diresaId ||
          user.facilityData?.diresaId ||
          (user as any).diresaId;
        const userOgessId =
          user.personnelData?.ogessId ||
          user.facilityData?.ogessId ||
          (user as any).ogessId;
        const userUngetId =
          user.personnelData?.ungetId ||
          user.facilityData?.ungetId ||
          (user as any).ungetId;

        // Sale de Establecimientos: qué UNGET tiene asignada cada usuario.
        let ungetIdByUsername: Record<string, string | undefined> = {};

        try {
          const [allConfigsRaw, allUsers] = await Promise.all([
            api.getAllUngetConfigs(),
            api.getUsers(),
          ]);
          setAllUsersList(allUsers);
          ungetIdByUsername = Object.fromEntries(
            allUsers.map((u: any) => [
              u.username,
              u.personnelData?.ungetId || u.facilityData?.ungetId || u.ungetId || undefined,
            ]),
          );

          // Alinear con los nombres oficiales de la base de datos
          const allConfigs = alignConfigsWithOfficialUngets(allConfigsRaw, ungs);

          const jurisdictionConfigs = allConfigs.filter((config) => {
            if (level === "GLOBAL") return true;

            // El territorio de una conexión es el de **su UNGET**, no el de quien la dio
            // de alta. Situarla por su creador la sacaba del ámbito de todos en cuanto esa
            // cuenta desaparecía, y entonces «Nueva conexión» volvía a ofrecer esa UNGET
            // como libre: dos conexiones para la misma UNGET, que es justo lo que el
            // modelo «una UNGET, una conexión» vino a evitar.
            const suUnget = findUngetForConnection(config, ungs);
            const creator = allUsers.find((u) => u.username === config.username);
            const delCreador = (campo: "diresaId" | "ogessId" | "ungetId") =>
              creator?.personnelData?.[campo] ||
              creator?.facilityData?.[campo] ||
              (creator as any)?.[campo] ||
              (creator as any)?.personnel?.[campo];

            // El creador solo se usa de respaldo, para una conexión cuya UNGET no se
            // reconoce (nombre escrito a mano que no coincide con ninguna registrada).
            const diresaId = suUnget ? (suUnget as any).diresaId : delCreador("diresaId");
            const ogessId = suUnget ? (suUnget as any).ogessId : delCreador("ogessId");
            const ungetId = suUnget ? (suUnget as any).id : delCreador("ungetId");
            if (!suUnget && !creator) return false;

            if (level === "DIRESA" && userDiresaId)
              return String(diresaId) === String(userDiresaId);
            if (level === "OGESS" && userOgessId)
              return String(ogessId) === String(userOgessId);
            if (level === "UNGET" && userUngetId)
              return String(ungetId) === String(userUngetId);
            return false;
          });

          setAllJurisdictionConfigs(jurisdictionConfigs);

          if (level === "GLOBAL") {
            remoteConfigs = allConfigs.filter((config) => {
              if (config.username === user.username) return true;
              return false;
            });
            // Un usuario global ve todas las UNGET registradas, sin depender de a quién esté
            // suscrito: la visibilidad sale de la jerarquía de Establecimientos.
            remoteConfigs = allConfigs;
          } else if (level === "DIRESA") {
            remoteConfigs = allConfigs.filter((config) => {
              if (config.username === user.username) return true;
              const ungetObj = ungs.find(u => (config.ungetId && String(u.id) === String(config.ungetId)) || normalizeName(u.name) === normalizeName(config.name));
              if (ungetObj && userDiresaId && String(ungetObj.diresaId) === String(userDiresaId)) return true;
              return false;
            });
          } else if (level === "OGESS") {
            remoteConfigs = allConfigs.filter((config) => {
              if (config.username === user.username) return true;
              const ungetObj = ungs.find(u => (config.ungetId && String(u.id) === String(config.ungetId)) || normalizeName(u.name) === normalizeName(config.name));
              if (ungetObj && userOgessId && String(ungetObj.ogessId) === String(userOgessId)) return true;
              return false;
            });
          } else {
            // Nivel UNGET, MICRORED o IPRESS: Herencia automática de la URL de su UNGET
            const myOwn = allConfigs.filter((config) => config.username === user.username);

            // Buscar en todas las configuraciones la que corresponda a la UNGET del usuario
            const inheritedUngetConfigs = allConfigs.filter((config) => {
              // 1. Coincidencia por ID de UNGET
              if (config.ungetId && userUngetId && String(config.ungetId) === String(userUngetId)) return true;
              // 2. Coincidencia por objeto myUnget
              if (myUnget) {
                if (config.ungetId && String(config.ungetId) === String(myUnget.id)) return true;
                if (normalizeName(config.name) === normalizeName(myUnget.name) || config.name.toUpperCase().includes(myUnget.name.toUpperCase())) return true;
              }
              // 3. Coincidencia por creador de la misma UNGET
              const creator = allUsers.find((u) => u.username === config.username);
              const creatorUngetId =
                creator?.personnelData?.ungetId ||
                creator?.facilityData?.ungetId ||
                (creator as any)?.ungetId ||
                (creator as any)?.personnel?.ungetId;
              if (creatorUngetId && userUngetId && String(creatorUngetId) === String(userUngetId)) return true;
              return false;
            });

            // Si el usuario ya tiene su propia configuración la usa; si no, hereda la de su UNGET
            remoteConfigs = myOwn.length > 0 ? myOwn : inheritedUngetConfigs;

            // La visibilidad sale de la jerarquía de Establecimientos: un usuario de una
            // UNGET ve la conexión de su UNGET, y nada más.
          }
        } catch (fetchErr) {
          console.error(
            "Error loading segmented unget configs from server:",
            fetchErr,
          );
          remoteConfigs = alignConfigsWithOfficialUngets(await api.getUngetConfigs(user.username), ungs);
        }

        // AUTO-CORRECCIÓN SILENCIOSA EN LA BASE DE DATOS (SUPABASE)
        // Para que deje de estar "maquillado" por fuera y quede corregido realmente por dentro en la base de datos de origen:
        try {
          const rawMyConfigs = await api.getUngetConfigs(user.username);
          const needsDbSync = rawMyConfigs.some((rawConf: any) => {
            const configNorm = normalizeName(rawConf.name);
            const matching = ungs.find(u => u.name === rawConf.name || normalizeName(u.name) === configNorm);
            return matching && matching.name !== rawConf.name;
          });
          if (needsDbSync) {
            const myAlignedToSave = alignConfigsWithOfficialUngets(rawMyConfigs, ungs);
            api.saveUngetConfigs(user.username, myAlignedToSave).then(res => {
              if (res.success) {
                console.log("Auto-alineación: Se corrigieron y guardaron los nombres oficiales en la base de datos (unget_configs) con éxito.");
              }
            }).catch(e => console.warn("Error en autoalineación de base de datos:", e));
          }
        } catch (syncErr) {
          console.warn("No se pudo comprobar la sincronía de base de datos de UNGET configs:", syncErr);
        }

        if (remoteConfigs && remoteConfigs.length > 0) {
          let visibleConfigs = remoteConfigs;
          // Filter if standard user so they only see their own facility's URL/sheet
          if (
            level !== "GLOBAL" &&
            level !== "DIRESA" &&
            level !== "OGESS" &&
            level !== "UNGET"
          ) {
            visibleConfigs = remoteConfigs
              .map((config: any) => {
                // For each URL configuration, filter the individual sheets
                if (config.sheets && Array.isArray(config.sheets)) {
                  // Try to match the exact string or code in sheet names
                  const myFacilitySheets = config.sheets.filter((s: any) => {
                    const facName = (
                      user.facilityData?.name || ""
                    ).toUpperCase();
                    const facCode = (
                      user.facilityData?.code || ""
                    ).toUpperCase();
                    const sName = s.name.toUpperCase();
                    return (
                      sName.includes(facName) ||
                      sName.includes(facCode) ||
                      s.id === facCode
                    );
                  });
                  return { ...config, sheets: myFacilitySheets };
                }
                return config;
              })
              .filter(
                (config: any) => config.sheets && config.sheets.length > 0,
              );
          }
          // Una UNGET, una conexión: mientras la base permita filas repetidas, se queda la
          // que tiene hoja de cálculo y, en su defecto, la del informático de esa UNGET.
          visibleConfigs = pickOneConnectionPerUnget(visibleConfigs, {
            currentUsername: user.username,
            ungetIdByUsername,
          });
          
          // Cada establecimiento guarda la POSICIÓN de su UNGET en la lista, así que si la
          // lista cambió de orden o de tamaño, la caché los pondría bajo otra UNGET. Es lo
          // que pasó al consolidar de 15 conexiones a 7: las hojas de Bellavista salían
          // dentro de Huallaga. En ese caso se reconstruyen.
          if (!cachedSourcesStillMatch(conexionesEnCache, visibleConfigs)) {
            setSources([]);
            setData([]);
            stockStorageService
              .saveStockData(user.username, [], [], null)
              .catch(() => {});
          }

          setScriptUrls(visibleConfigs);
        } else {
          // Si no hay remoto, verificar si hay respaldo local
          const fallbackSavedUrls = localStorage.getItem(`aura_sig_urls_${user.username}`);
          if (fallbackSavedUrls) {
            try {
              const parsed = JSON.parse(fallbackSavedUrls);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const migrated = parsed.map((u) =>
                  typeof u === "string"
                    ? {
                        url: u,
                        name: `UNGET ${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                      }
                    : u,
                );
                // Solo para seguir viendo algo sin conexión: no se vuelve a guardar en la
                // base, porque resucitaba conexiones que se habían borrado a propósito.
                setScriptUrls(migrated);
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        console.error("Error loading configs:", e);
      } finally {
        setIsConfigLoading(false);
      }
    };

    loadConfigs();
  }, [user, canAccess]);

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-center">
        <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 flex flex-col items-center max-w-md">
          <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-xl font-black text-gray-900 mb-2">
            Acceso Restringido
          </h3>
          <p className="text-gray-500 text-sm">
            Su rol actual no tiene permisos para utilizar el módulo de Consulta
            Stock (SIG). Contacte al administrador para solicitar acceso.
          </p>
        </div>
      </div>
    );
  }

  // Save to local storage and IndexedDB when state changes
  useEffect(() => {
    if (!user || isConfigLoading) return; // IMPORTANTE: No guardar si aún estamos cargando la config inicial

    // Guardar en IndexedDB sin límites de 5MB
    stockStorageService.saveUrls(user.username, scriptUrls).catch(() => {});
    stockStorageService.saveStockData(user.username, sources, data, lastGlobalSync).catch(() => {});

    // Guardar también URLs en localStorage como respaldo ligero
    try {
      localStorage.setItem(
        `aura_sig_urls_${user.username}`,
        JSON.stringify(scriptUrls),
      );
      if (lastGlobalSync) {
        localStorage.setItem(`aura_sig_lastsync_${user.username}`, lastGlobalSync.toISOString());
      }
    } catch (e) {
      console.warn("Storage quota exceeded for URLs.", e);
    }

  }, [scriptUrls, sources, data, user, isConfigLoading, lastGlobalSync]);

  // La selección es estado visual y no debe provocar persistencia masiva en IndexedDB.
  useEffect(() => {
    if (
      sources.length > 0 &&
      selectedSourceId !== "" &&
      !sources.find((s) => s.id === selectedSourceId)
    ) {
      setSelectedSourceId("");
    }
  }, [sources, selectedSourceId]);

  const loadSupabaseSyncs = async (forceSources?: SheetSource[]) => {
    if (!supabase) return {} as Record<string, any>;
    const targetSources = forceSources || sources;
    if (targetSources.length === 0) return {} as Record<string, any>;

    setIsCheckingLatestSyncs(true);
    try {
      const keyGroups = targetSources.map((source) => getHistoryKeysForSource(source));
      const allPossibleIds = Array.from(new Set(keyGroups.flat()));
      const latestSyncs = await supabaseService.getLatestSyncs(allPossibleIds, keyGroups);
      const mappedSyncs: Record<string, any> = { ...latestSyncs };

      targetSources.forEach((source) => {
        const candidates = getHistoryKeysForSource(source)
          .map((key) => latestSyncs[key])
          .filter(Boolean)
          .sort(
            (a, b) =>
              new Date(b.sync_date || 0).getTime() -
              new Date(a.sync_date || 0).getTime(),
          );
        const record = candidates[0];
        if (!record) return;
        mappedSyncs[source.id] = record;
        getHistoryKeysForSource(source).forEach((key) => {
          if (!mappedSyncs[key]) mappedSyncs[key] = record;
        });
      });

      setSupabaseSyncs((prev) => ({ ...prev, ...mappedSyncs }));
      return mappedSyncs;
    } catch (e) {
      console.warn("Error cargando historial de Supabase:", e);
      return {} as Record<string, any>;
    } finally {
      setIsCheckingLatestSyncs(false);
    }
  };

  const handleShowSyncHistory = async (source: SheetSource) => {
    if (!supabase) {
      toast.error("Supabase no está configurado.");
      return;
    }

    setActiveHistoryFacility({ id: source.id, name: source.name });
    setIsSyncHistoryModalOpen(true);
    setSelectedFacilitySyncHistory([]);
    setIsLoadingHistory(true);

    try {
      const keys = getHistoryKeysForSource(source);
      const historyResults = await Promise.all(
        keys.map((key) => supabaseService.getHistoryForEstablishment(key)),
      );
      let history = historyResults
        .flat()
        .filter(
          (row, index, arr) =>
            index === arr.findIndex((other) => other.id === row.id),
        )
        .sort(
          (a, b) =>
            new Date(b.sync_date || 0).getTime() -
            new Date(a.sync_date || 0).getTime(),
        );

      if (history.length === 0) {
        const loaded = await loadSingleSourceStock(source.id, true);
        if (loaded) {
          const stableId = source.facilityCode || getCleanSourceId(source.id);
          history = await supabaseService.getHistoryForEstablishment(stableId);
        }
      }

      setSelectedFacilitySyncHistory(history || []);
      const latest = findLatestValidSync(history);
      if (latest) {
        setSupabaseSyncs((prev) => ({
          ...prev,
          [source.id]: latest,
          ...Object.fromEntries(keys.map((key) => [key, latest])),
        }));
      }
    } catch (e) {
      console.error("Error al cargar historial:", e);
      toast.error("Error al cargar el historial de cambios.");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Descarga del libro completo. Solo para una recarga completa pedida explícitamente
  // (`forceFullRefresh`): nunca como respaldo automático, porque son miles de filas.
  const fetchScriptUrlWithFallback = async (rawUrl: string): Promise<any> => {
    const sep = rawUrl.includes("?") ? "&" : "?";
    const cacheBusterUrl = `${rawUrl}${sep}_t=${Date.now()}`;
    return await fetchGasWithResilience(cacheBusterUrl, { timeoutMs: 35000 });
  };

  // Reintento manual de una UNGET: solo metadata. El stock de cada IPRESS se sigue
  // pidiendo bajo demanda; "Reintentar" ya no descarga el libro completo.
  const retrySingleUrl = async (configToRetry: UngetConfig) => {
    setRetryingUrls((prev) => ({ ...prev, [configToRetry.url]: true }));
    try {
      const byUrl = scriptUrls.findIndex((u) => u.url === configToRetry.url);
      const byName = scriptUrls.findIndex((u) => u.name === configToRetry.name);
      const effectiveIndex = byUrl >= 0 ? byUrl : byName >= 0 ? byName : 0;
      const currentForRetry = sources.filter((s) => s.urlIndex === effectiveIndex);
      const metadataList = await loadUngetMetadata(configToRetry, effectiveIndex, currentForRetry, {
        force: true,
      });
      const loadedSourceIds = new Set(data.map((row) => row.sourceId || ""));
      const { merged, changedSheetNames } = mergeMetadataIntoSources(
        metadataList,
        currentForRetry,
        loadedSourceIds,
        {
          configUrl: configToRetry.url,
          configUngetId: configToRetry.ungetId,
          urlIndex: effectiveIndex,
          assignments: allAssignments,
          facilities: allFacilities,
          configSpreadsheetId: configToRetry.spreadsheetId,
        },
      );

      setSources((prev) => [
        ...prev.filter((s) => s.urlIndex !== effectiveIndex),
        ...merged,
      ]);
      setConnectionErrors((prev) => {
        const updated = { ...prev };
        delete updated[configToRetry.url];
        return updated;
      });
      setError(null);
      setLastGlobalSync(new Date());
      if (supabase) void loadSupabaseSyncs(merged);
      // El stock ya guardado que cambió se refresca en segundo plano, por lotes.
      if (changedSheetNames.length > 0) void fetchData(undefined, true);

      toast.success(
        `Conexión restablecida con ${configToRetry.name || "UNGET"}: ${merged.length} establecimientos.`,
      );
    } catch (err: any) {
      console.error("Error al reintentar UNGET:", err);
      setConnectionErrors((prev) => ({
        ...prev,
        [configToRetry.url]: err.message || "Error al conectar",
      }));
      toast.error(`No se pudo consultar ${configToRetry.name || "UNGET"}: ${err.message || "Error de red"}`);
    } finally {
      setRetryingUrls((prev) => ({ ...prev, [configToRetry.url]: false }));
    }
  };

  // Con lectura directa activa, Apps Script solo aporta la lista de pestañas (nuevas o
  // eliminadas). Corre en segundo plano, como máximo cada 30 min, y no pisa fechas más
  // recientes leídas directamente.
  const refreshSheetListFromGas = async (config: UngetConfig, urlIndex: number) => {
    if (!hasWebApp(config)) return;
    const last = gasSheetListRefreshRef.current[config.url] || 0;
    if (Date.now() - last < GAS_SHEET_LIST_REFRESH_MS) return;
    gasSheetListRefreshRef.current[config.url] = Date.now();

    try {
      const metadataList = await fetchGasMetadata(config.url);
      const loadedSourceIds = new Set(data.map((row) => row.sourceId || ""));
      setSources((prev) => {
        const current = prev.filter((s) => s.urlIndex === urlIndex);
        const { merged } = mergeMetadataIntoSources(metadataList, current, loadedSourceIds, {
          configUrl: config.url,
          configUngetId: config.ungetId,
          urlIndex,
          assignments: allAssignments,
          facilities: allFacilities,
          configSpreadsheetId: config.spreadsheetId,
        });
        const previousById = new Map(current.map((s) => [s.id, s]));
        const kept = merged.map((source) => {
          const previous = previousById.get(source.id);
          if (!previous || (previous.lastUpdateTime || 0) <= (source.lastUpdateTime || 0)) {
            return source;
          }
          return {
            ...source,
            lastUpdate: previous.lastUpdate,
            lastUpdateTime: previous.lastUpdateTime,
            equipmentDate: previous.equipmentDate,
            equipmentDateTime: previous.equipmentDateTime,
          };
        });
        return [...prev.filter((s) => s.urlIndex !== urlIndex), ...kept];
      });
    } catch (err: any) {
      // Sin la lista de Apps Script se conserva la guardada; la lectura directa sigue y se
      // vuelve a intentar en el siguiente intervalo.
      console.warn(
        `Lista de hojas de ${config.name || "UNGET"} no disponible en Apps Script:`,
        err?.message || err,
      );
    }
  };

  /**
   * Guarda en la configuración el libro detectado (lo informa el script nuevo), para que el
   * campo "Hoja de cálculo" lo muestre y la lectura directa no dependa de volver a detectarlo.
   * Solo para conexiones propias: las heredadas de otro usuario no se pueden guardar.
   */
  const persistDetectedSpreadsheetId = (config: UngetConfig, spreadsheetId: string) => {
    if (!user || !spreadsheetId || config.spreadsheetId === spreadsheetId) return;
    if (config.username && config.username !== user.username) return;
    const key = `${config.url}|${spreadsheetId}`;
    if (persistedSpreadsheetIdsRef.current.has(key)) return;
    persistedSpreadsheetIdsRef.current.add(key);

    const updated = scriptUrls.map((c) => (c.url === config.url ? { ...c, spreadsheetId } : c));
    setScriptUrls(updated);
    const mine = updated
      .filter((c) => !c.username || c.username === user.username)
      .map((c) => ({ ...c, username: user.username }));
    void api
      .saveUngetConfigs(user.username, mine)
      .catch((err) => console.warn("No se pudo guardar el libro detectado en la configuración:", err));
  };

  /**
   * Lista de pestañas y fechas de una UNGET, por orden de preferencia:
   * 1. Google Sheets API (1-2 peticiones por UNGET), si hay clave y hoja configurada o detectada.
   * 2. Lectura directa CSV por pestaña, si el directorio ya se conoce.
   * 3. Web App de Apps Script, si está configurada.
   */
  const loadUngetMetadata = async (
    config: UngetConfig,
    urlIndex: number,
    currentForUrl: SheetSource[],
    options: { force?: boolean } = {},
  ): Promise<GasSheetMetadata[]> => {
    const spreadsheetId =
      config.spreadsheetId || currentForUrl.find((s) => s.spreadsheetId)?.spreadsheetId || "";
    let lastError: any = null;

    if (spreadsheetId && hasSheetsApiKey()) {
      try {
        const knownRowCounts: KnownRowCounts = {};
        currentForUrl.forEach((s) => {
          if (s.rowCount !== undefined) knownRowCounts[getCleanSourceId(s.id)] = s.rowCount;
        });
        return await fetchSheetsMetadataViaApi(spreadsheetId, { force: options.force, knownRowCounts });
      } catch (err: any) {
        lastError = err;
        console.warn(
          `Google Sheets API no disponible para ${config.name || "UNGET"}; se usa otra vía:`,
          err?.message || err,
        );
      }
    }

    const directRefs = toDirectSheetRefs(currentForUrl, spreadsheetId);
    if (directRefs) {
      try {
        const metadata = await fetchSheetsMetadataDirect(directRefs);
        void refreshSheetListFromGas(config, urlIndex);
        return metadata;
      } catch (err: any) {
        lastError = err;
        console.warn(`Lectura directa no disponible para ${config.name || "UNGET"}:`, err?.message || err);
      }
    }

    if (hasWebApp(config)) {
      const metadata = await fetchGasMetadata(config.url, { force: options.force });
      gasSheetListRefreshRef.current[config.url] = Date.now();
      return metadata;
    }

    throw lastError || new Error("Configure el enlace de la hoja de cálculo o la URL de la Web App de esta UNGET.");
  };

  const fetchData = async (
    overrideUrls?: UngetConfig[],
    silent: boolean = false,
    forceFullRefresh: boolean = false,
  ) => {
    if (isConfigLoading && !overrideUrls) return;

    const sourceUrls = overrideUrls || scriptUrls;

    // Eliminar posibles duplicados introducidos por roles administrativos al asignar URLs
    let urlsToUse = Array.from(
      new Map(sourceUrls.map((u) => [u.url, u])).values(),
    );

    if (!silent) {
      // Limpiar error inmediatamente al iniciar una carga válida
      setError(null);
      setIsLoading(true);
    } else {
      setIsSilentSyncing(true);
    }

    try {
      let accumulatedData: SIGData[] = [];
      let accumulatedSources: SheetSource[] = [];
      let historyData: SIGData[] = [];
      let historySources: SheetSource[] = [];
      const failures: string[] = [];
      let succeededUrls = 0;
      const loadedSourceIds = new Set(data.map((row) => row.sourceId || ""));

      // Metadata primero para cada UNGET. Solo se descarga stock de las IPRESS que ya
      // estaban guardadas y cambiaron; las demás se consultan bajo demanda.
      const fetchPromises = urlsToUse.map(async (config, fallbackIndex) => {
        const actualIndex = scriptUrls.findIndex((u) => u.url === config.url);
        const urlIndex = actualIndex >= 0 ? actualIndex : fallbackIndex;

        try {
          let sheetsPayload: any = null;
          let isSelective = false;

          if (forceFullRefresh && hasWebApp(config)) {
            sheetsPayload = await fetchScriptUrlWithFallback(config.url);
          } else {
            const currentForUrl = sources.filter((s) => s.urlIndex === urlIndex);
            const metadataList = await loadUngetMetadata(config, urlIndex, currentForUrl);
            const detectedSpreadsheetId = metadataList.find((m) => m.spreadsheetId)?.spreadsheetId;
            if (detectedSpreadsheetId) persistDetectedSpreadsheetId(config, detectedSpreadsheetId);
            const { merged, changedSheetNames } = mergeMetadataIntoSources(
              metadataList,
              currentForUrl,
              loadedSourceIds,
              {
                configUrl: config.url,
                configUngetId: config.ungetId,
                urlIndex,
                assignments: allAssignments,
                facilities: allFacilities,
                configSpreadsheetId: config.spreadsheetId,
              },
            );

            // El directorio se actualiza al instante, aunque luego falle alguna descarga.
            setSources((prev) => [
              ...prev.filter((source) => source.urlIndex !== urlIndex),
              ...merged,
            ]);
            accumulatedSources.push(...merged);
            setConnectionErrors((prev) => {
              const updated = { ...prev };
              delete updated[config.url];
              return updated;
            });
            succeededUrls++;

            if (supabase) {
              void loadSupabaseSyncs(merged);
            }

            // Stock guardado que cambió: lectura directa por hoja y, si no es posible, Apps
            // Script por lotes pequeños. Una hoja fallida conserva sus datos anteriores y se
            // reintentará en la próxima sincronización.
            if (changedSheetNames.length > 0) {
              const refreshed: any[] = [];
              const metaByName = new Map(metadataList.map((meta) => [meta.name, meta]));
              const viaGas: string[] = [];
              const viaDirect = changedSheetNames.filter((name) => {
                const meta = metaByName.get(name);
                const direct = canReadSheetDirect(meta?.spreadsheetId, meta?.id);
                if (!direct) viaGas.push(name);
                return direct;
              });
              await runWithConcurrency(viaDirect, DIRECT_SHEET_REFRESH_CONCURRENCY, async (name) => {
                const meta = metaByName.get(name)!;
                try {
                  const rows = await fetchSheetRowsDirect(meta.spreadsheetId!, meta.id);
                  refreshed.push({ id: meta.id, name, spreadsheetId: meta.spreadsheetId, data: rows });
                } catch (directErr: any) {
                  console.warn(`Lectura directa de "${name}" no disponible; se usa Apps Script:`, directErr?.message || directErr);
                  viaGas.push(name);
                }
              });
              for (let i = 0; i < viaGas.length; i += CHANGED_SHEETS_BATCH_SIZE) {
                const batch = viaGas.slice(i, i + CHANGED_SHEETS_BATCH_SIZE);
                try {
                  const result = await fetchGasSelectiveSheets(config.url, batch);
                  if (Array.isArray(result)) refreshed.push(...result);
                } catch (batchErr: any) {
                  console.warn(
                    `No se pudo refrescar ${batch.length} hoja(s) de ${config.name || "UNGET"}:`,
                    batchErr?.message || batchErr,
                  );
                }
              }
              if (refreshed.length > 0) {
                sheetsPayload = refreshed;
                isSelective = true;
              }
            }
          }

          if (Array.isArray(sheetsPayload)) {
            const thisSources: SheetSource[] = [];
            const thisData: SIGData[] = [];

            sheetsPayload.forEach((sheet: any) => {
              const uniqueSourceId = `${urlIndex}_${sheet.id}`;

              let lastUpdateStr = "";
              let lastUpdateTime = 0;
              let equipmentDateStr = "";
              let equipmentDateTime = 0;

              if (Array.isArray(sheet.data) && sheet.data.length > 0) {
                const firstRow = sheet.data[0]; // Fila 2 de Google Sheet
                lastUpdateStr = getRowFieldValue(firstRow, "ULTIMA ACTUALIZACION", "ULTIMA_ACTUALIZACION", "ULTIMA ACTUALIZACIÓN", "Ultima_Actualizacion");
                equipmentDateStr = getRowFieldValue(firstRow, "FECHA DEL EQUIPO", "FECHA_DEL_EQUIPO", "Fecha_Del_Equipo");
                lastUpdateTime = parseDataDate(lastUpdateStr);
                equipmentDateTime = parseDataDate(equipmentDateStr);
              }

              let displayName = sheet.name;
              if (allAssignments.length > 0 && allFacilities.length > 0) {
                const matchingAssignment = allAssignments.find(
                  (a) =>
                    assignmentBelongsToConnection(a, config) && a.sheetName === sheet.name,
                );
                if (matchingAssignment) {
                  const matchingF = allFacilities.find(
                    (f) => f.code === matchingAssignment.facilityCode,
                  );
                  if (matchingF) {
                    displayName = matchingF.name;
                  }
                }
              }

              thisSources.push({
                id: uniqueSourceId,
                name: displayName,
                urlIndex,
                sheetName: sheet.name,
                rowCount: Array.isArray(sheet.data) ? sheet.data.length : 0,
                facilityCode: extractFacilityCodeFromSheetName(sheet.name) || undefined,
                spreadsheetId:
                  sheet.spreadsheetId ||
                  sources.find((s) => s.id === uniqueSourceId)?.spreadsheetId ||
                  undefined,
                lastUpdate: lastUpdateStr,
                lastUpdateTime: lastUpdateTime || undefined,
                equipmentDate: equipmentDateStr,
                equipmentDateTime: equipmentDateTime || undefined,
              });

              if (Array.isArray(sheet.data)) {
                const validData = sheet.data
                  .map((row: any) =>
                    normalizeRowData(
                      row,
                      lastUpdateStr,
                      equipmentDateStr,
                      uniqueSourceId,
                    ),
                  )
                  .filter((row: any): row is SIGData => row !== null);
                thisData.push(...validData);
              }
            });

            // El historial usa únicamente snapshots derivados del stock recién leído de Google Sheets.
            historySources.push(...thisSources);
            historyData.push(...thisData);

            if (isSelective) {
              // Fusionar selectivo con las fuentes existentes
              const newSourceIds = new Set(thisSources.map((s) => s.id));
              setSources((prev) => {
                const updated = prev.filter(
                  (s) => s.urlIndex !== urlIndex || !newSourceIds.has(s.id),
                );
                return [...updated, ...thisSources];
              });
              setData((prev) => {
                const updated = prev.filter((d) => !newSourceIds.has(d.sourceId || ""));
                return [...updated, ...thisData];
              });
              accumulatedData.push(...thisData);
            } else {
              // Recarga completa explícita
              accumulatedSources.push(...thisSources);
              accumulatedData.push(...thisData);
              succeededUrls++;

              setSources((prev) => {
                const filtered = prev.filter((s) => s.urlIndex !== urlIndex);
                return [...filtered, ...thisSources];
              });

              setData((prev) => {
                const sourceIdsToRemove = new Set(thisSources.map((s) => s.id));
                const filtered = prev.filter((d) => !sourceIdsToRemove.has(d.sourceId || ""));
                return [...filtered, ...thisData];
              });

              setConnectionErrors((prev) => {
                const updated = { ...prev };
                delete updated[config.url];
                return updated;
              });
            }
          }
        } catch (err: any) {
          // Se conservan las tarjetas y el stock guardados; solo se marca la UNGET.
          console.error(`Error fetching URL index ${urlIndex}:`, err);
          const message = err?.message || "Failed to fetch";
          failures.push(`${config.name || "UNGET"}: ${getGasErrorLabel(message).label}`);
          setConnectionErrors((prev) => ({
            ...prev,
            [config.url]: message,
          }));
        }
      });

      await Promise.allSettled(fetchPromises);
      // "Sincronizado" solo cuando al menos una UNGET respondió.
      if (succeededUrls > 0) setLastGlobalSync(new Date());

      if (supabase && historySources.length > 0) {
        const sourcesForHistory = [...historySources];
        const dataForHistory = [...historyData];
        setIsCheckingLatestSyncs(true);

        void (async () => {
          try {
            const syncPromises = sourcesForHistory.map((sheet) => {
              const sheetItems = dataForHistory.filter((r) => r.sourceId === sheet.id);
              const userAuthor = user?.username || "AutoSync";
              const stableHistoryId = sheet.facilityCode || getCleanSourceId(sheet.id);
              return supabaseService.registerSync({
                establishmentId: stableHistoryId,
                establishmentName: sheet.name,
                currentStock: sheetItems,
                author: userAuthor,
                sheetLastUpdateDate: sheet.lastUpdateTime
                  ? new Date(sheet.lastUpdateTime).toISOString()
                  : undefined,
              });
            });

            const results = await Promise.allSettled(syncPromises);
            setSupabaseSyncs((prev) => {
              const updated = { ...prev };
              results.forEach((res, i) => {
                if (res.status !== "fulfilled" || !res.value.success || !res.value.record) return;

                const recordToSave = { ...res.value.record };
                if (recordToSave.has_changes && !recordToSave.last_modification_date) {
                  recordToSave.last_modification_date = recordToSave.sync_date;
                }

                const rawId = sourcesForHistory[i]?.id;
                if (!rawId) return;
                const cleanId = rawId.includes("_")
                  ? rawId.split("_").slice(1).join("_")
                  : rawId;
                updated[rawId] = recordToSave;
                updated[cleanId] = recordToSave;
              });
              return updated;
            });
          } catch (err) {
            console.warn("Error registrando historial de cambios en segundo plano:", err);
          } finally {
            setIsCheckingLatestSyncs(false);
          }
        })();
      }

      // La carga por metadata no trae filas de stock: el éxito se mide por las UNGET que
      // respondieron, no por `accumulatedData`. Antes, una sincronización correcta mostraba
      // "No se encontraron registros" y ocultaba todas las tarjetas.
      if (urlsToUse.length === 0) {
        if (!silent) {
          setError(
            "No se encontraron registros en las hojas de cálculo. Revise que tengan información.",
          );
        }
      } else if (succeededUrls > 0) {
        setError(null);
        if (failures.length > 0) {
          if (!silent) {
            toast.warning(`Algunas UNGET no respondieron: ${failures.join(" | ")}`);
          }
        } else if (accumulatedSources.length === 0) {
          if (!silent) {
            setError(
              "La Web App respondió, pero no se encontraron hojas en el libro. Revise que tenga información.",
            );
          }
        } else if (!silent) {
          toast.success(
            accumulatedData.length > 0
              ? `Sincronización completada: ${accumulatedData.length.toLocaleString()} productos actualizados en ${accumulatedSources.length} establecimientos.`
              : `Sincronización completada: ${accumulatedSources.length} establecimientos actualizados.`,
          );
        }
      } else if (!silent) {
        toast.error(
          `No se pudo actualizar. ${failures.join(" | ")}. Se muestran los datos guardados.`,
        );
      }
    } catch (err: any) {
      if (!silent)
        setError("Ocurrió un error al cargar los datos: " + err.message);
      else console.error("Silent auto-sync failed:", err);
    } finally {
      if (!silent) setIsLoading(false);
      else setIsSilentSyncing(false);
    }
  };

  // Al montar y cargar la configuración, hacer refresh de los datos.
  useEffect(() => {
    if (!isConfigLoading) {
      if (scriptUrls.length > 0) {
        const hasCachedDataset = sources.length > 0;
        const lastSyncAgeMs = lastGlobalSync
          ? Date.now() - lastGlobalSync.getTime()
          : Number.POSITIVE_INFINITY;
        const CACHE_RECHECK_WINDOW_MS = 5 * 60 * 1000;

        if (!hasCachedDataset || lastSyncAgeMs >= CACHE_RECHECK_WINDOW_MS) {
          fetchData(undefined, true);
        }
        if (supabase && sources.length > 0) {
          loadSupabaseSyncs().catch((e) => console.warn(e));
        }
      } else {
        // Ejecutar para disparar el estado vacío
        fetchData(undefined, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigLoading]); // Solo cuando termine de cargar la configuración

  // Sincronización automática periódica y al enfocar ventana
  useEffect(() => {
    if (isConfigLoading || scriptUrls.length === 0) return;

    // Auto-sync cada 15 minutos (900000 ms)
    const AUTO_SYNC_INTERVAL = 15 * 60 * 1000;
    const intervalId = setInterval(() => {
      fetchData(undefined, true);
    }, AUTO_SYNC_INTERVAL);

    // Auto-sync al volver la pestaña (si ha pasado más de 10 minutos desde la última vez)
    let lastSyncTime = Date.now();
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastSyncTime > 10 * 60 * 1000) {
        lastSyncTime = now;
        fetchData(undefined, true);
      }
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptUrls, isConfigLoading]);

  // La precarga se ejecuta con la versión más reciente del estado.
  const prefetchFnRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    prefetchFnRef.current = prefetchPendingSheets;
  });

  // Arranca cuando el directorio ya está en pantalla y nada más está cargando.
  useEffect(() => {
    if (isConfigLoading || isLoading || isSilentSyncing || selectedUngetIndex === null) return;
    const timer = setTimeout(() => {
      void prefetchFnRef.current();
    }, PREFETCH_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sources, isConfigLoading, isLoading, isSilentSyncing, selectedUngetIndex]);

  // Se pausa con la pestaña en segundo plano y al salir del módulo.
  useEffect(() => {
    const handleVisibility = () => {
      prefetchRef.current.enabled = !document.hidden;
      if (!document.hidden) void prefetchFnRef.current();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      prefetchRef.current.enabled = false;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleSaveConfig = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      let urlsToSave = [...tempUrls];

      // Si el usuario ingresó una URL en los campos de texto pero olvidó hacer clic en "+ Añadir a Lista",
      // la procesamos automáticamente aquí para que no se pierda la configuración.
      const pendingUrl = newUrlInput.trim();
      if (pendingUrl) {
        // Misma exigencia que en "Añadir a Lista": sin UNGET registrada no hay conexión.
        // El nombre de relleno («UNGET 3») no coincidía nunca con una UNGET real, así que
        // por este atajo entraban conexiones que no colgaban de ninguna.
        const pendingValue = newNameInput.trim();
        const matching = pendingValue
          ? allUngets.find(u => String(u.id) === pendingValue || u.name === pendingValue)
          : undefined;
        if (!matching) {
          toast.error(
            "Indique a qué UNGET pertenece esta conexión antes de guardar. Debe estar registrada en Administración → Establecimientos.",
          );
          return;
        }
        const pendingName = matching.name;
        const pendingUngetId = matching.id;

        if (editingIndex !== null) {
          urlsToSave[editingIndex] = { url: pendingUrl, name: pendingName, ungetId: pendingUngetId, username: user.username };
        } else {
          if (!urlsToSave.find((u) => u.url === pendingUrl)) {
            // Validar límites si corresponde
            if (!maxUrlsAllowed || urlsToSave.length < maxUrlsAllowed) {
              urlsToSave.push({ url: pendingUrl, name: pendingName, ungetId: pendingUngetId, username: user.username });
            }
          }
        }
        // Limpiar inputs temporales
        setNewUrlInput("");
        setNewNameInput("");
        setEditingIndex(null);
      }

      // Alinear los nombres de las configs con los de la base de datos oficial antes de guardar de raíz
      urlsToSave = alignConfigsWithOfficialUngets(urlsToSave, allUngets);
      setTempUrls(urlsToSave);

      const result = await api.saveUngetConfigs(user.username, urlsToSave, opcionesDeAdopcion);

      if (result.success) {
        // Actualizar localmente allJurisdictionConfigs en tiempo real para mantener la concordancia
        setAllJurisdictionConfigs((prev) => {
          const others = prev.filter((c) => c.username !== user.username);
          const myUpdated = urlsToSave.map((c) => ({
            username: user.username,
            name: c.name,
            url: c.url,
            ungetId: c.ungetId,
            // Sin esto, tras guardar la interfaz cree que la UNGET no tiene hoja configurada.
            spreadsheetId: c.spreadsheetId,
          }));
          return [...others, ...myUpdated];
        });

        // Las conexiones de las demás UNGET ya vienen de la jerarquía; aquí solo se
        // refrescan las que acaba de guardar este usuario, sin repetir ninguna UNGET.
        const mergedScriptUrls = pickOneConnectionPerUnget(
          [
            ...allJurisdictionConfigs.filter((c) => c.username !== user.username),
            ...urlsToSave,
          ],
          { currentUsername: user.username },
        );

        setScriptUrls(mergedScriptUrls);
        setIsConfigOpen(false);
        toast.success("Configuración guardada en la nube con éxito.");

        // Sincronizar datos inmediatamente y de manera asíncrona pero asegurando que la carga se complete sin bloquear la pantalla
        fetchData(mergedScriptUrls, true).catch(err => console.warn(err));
      } else {
        toast.error("Error al guardar en el servidor: " + result.message);
      }
    } catch (e) {
      toast.error("Error de conexión al guardar configuración.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUrl = () => {
    if (!user) return;
    const webAppUrl = newUrlInput.trim();
    const val = newNameInput.trim();

    // La hoja es la vía principal; la Web App queda como respaldo opcional.
    const sheetInput = newSpreadsheetInput.trim();
    const spreadsheetId = sheetInput ? extractSpreadsheetId(sheetInput) : "";
    if (sheetInput && !spreadsheetId) {
      toast.error("El enlace de la hoja de cálculo no es válido. Pegue la dirección completa de Google Sheets.");
      return;
    }
    if (!webAppUrl && !spreadsheetId) {
      toast.error("Indique el enlace de la hoja de cálculo o la URL de la Web App.");
      return;
    }
    // Sin Web App, la conexión se identifica por su hoja.
    const url = webAppUrl || `${VIRTUAL_SHEET_URL_PREFIX}${spreadsheetId}`;
    if (!val || val === "" || val.includes("-- Seleccionar")) {
      toast.error("Por favor, seleccione una UNGET válida de la lista.");
      return;
    }

    const matching = allUngets.find(u => String(u.id) === val || u.name === val);
    // Sin UNGET registrada no hay conexión posible: al guardarla sin identificador la fila
    // se insertaba y se retiraba en la misma operación, y la pantalla decía que todo fue
    // bien. Mejor no dejar llegar hasta ahí.
    if (!matching) {
      toast.error(
        `No se pudo identificar la UNGET "${val}" entre las registradas en Establecimientos. Actualice la página; si el problema sigue, regístrela antes de configurar su conexión.`,
      );
      return;
    }
    const name = matching.name;
    const ungetId = matching.id;

    if (editingIndex !== null) {
      // Caso edición
      const updated = [...tempUrls];
      updated[editingIndex] = { url, name, ungetId, username: user.username, spreadsheetId: spreadsheetId || undefined };
      setTempUrls(updated);
      setEditingIndex(null);
    } else {
      // Caso nuevo
      if (maxUrlsAllowed && tempUrls.length >= maxUrlsAllowed) {
        toast.error(
          `Ha alcanzado el límite máximo de ${maxUrlsAllowed} URLs para su rol.`,
        );
        return;
      }
      if (tempUrls.find((u) => u.url === url)) {
        toast.error("Esta URL ya está registrada.");
        return;
      }
      setTempUrls([...tempUrls, { url, name, ungetId, username: user.username, spreadsheetId: spreadsheetId || undefined }]);
    }

    setNewUrlInput("");
    setNewNameInput("");
    setNewSpreadsheetInput("");
    setSpreadsheetCheck(null);
  };

  /** Comprueba que la hoja esté compartida como lector con el enlace. */
  const handleCheckSpreadsheet = async () => {
    const spreadsheetId = extractSpreadsheetId(newSpreadsheetInput);
    if (!spreadsheetId) {
      setSpreadsheetCheck({ ok: false, message: "Pegue el enlace completo de la hoja de cálculo de Google." });
      return;
    }
    setIsCheckingSpreadsheet(true);
    setSpreadsheetCheck(null);
    try {
      const access = await checkSpreadsheetAccess(spreadsheetId);
      if (!access.ok || !hasSheetsApiKey()) {
        setSpreadsheetCheck(access);
        return;
      }
      try {
        const tabs = await listSheetTabs(spreadsheetId, { force: true });
        setSpreadsheetCheck({
          ok: true,
          message: `Hoja accesible: ${tabs.length} pestaña${tabs.length === 1 ? "" : "s"} encontrada${tabs.length === 1 ? "" : "s"}.`,
        });
      } catch {
        // La lectura directa ya quedó comprobada; el conteo es solo informativo.
        setSpreadsheetCheck(access);
      }
    } finally {
      setIsCheckingSpreadsheet(false);
    }
  };

  const handleEditUrl = (index: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const config = tempUrls[index];
    if (!canEditConnection(config, user?.username, cuentasActivas)) {
      toast.error(`Esta conexión la mantiene ${connectionOwner(config)}. Solo esa cuenta puede editarla.`);
      return;
    }
    setEditingIndex(index);
    setNewUrlInput(isVirtualSheetUrl(config.url) ? "" : config.url);
    setNewNameInput(config.ungetId || config.name);
    setNewSpreadsheetInput(config.spreadsheetId || "");
    setSpreadsheetCheck(null);
    setIsWebAppSectionOpen(hasWebApp(config));
    setIsConfigOpen(true);
  };

  const handleDirectDelete = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;

    // El botón ya no se ofrece en conexiones ajenas; esto es el cierre de la regla, para
    // que no vuelva a existir un camino que diga «Eliminado correctamente» sin borrar nada.
    const config = scriptUrls[index];
    if (!canEditConnection(config, user.username, cuentasActivas)) {
      toast.error(
        `Esta conexión la mantiene ${connectionOwner(config)}. Solo esa cuenta puede retirarla.`,
      );
      return;
    }

    setConexionAEliminar({ index, config });
  };

  /**
   * Retira la conexión ya confirmada en el diálogo.
   *
   * Se identifica por su UNGET y no por la posición que tenía al pulsar la papelera: entre
   * una cosa y otra puede haber entrado una sincronización y haber reordenado la lista, y
   * un índice viejo borraría la conexión equivocada.
   */
  const confirmarEliminarConexion = async () => {
    if (!user || !conexionAEliminar) return;
    const { config } = conexionAEliminar;
    const posicion = scriptUrls.findIndex((c) =>
      config.ungetId ? String(c.ungetId || "") === String(config.ungetId) : c.url === config.url,
    );
    if (posicion === -1) {
      setConexionAEliminar(null);
      toast.error("Esa conexión ya no está en la lista.");
      return;
    }

    const updated = scriptUrls.filter((_, idx) => idx !== posicion);
    setIsDeletingConnection(true);
    setIsLoading(true);
    try {
      // Las que este usuario puede mantener: las suyas y las que se quedaron sin
      // responsable. Las ajenas siguen fuera del envío, para no tocarlas.
      const myOwnUpdated = updated.filter((u) =>
        canEditConnection(u, user.username, cuentasActivas),
      );
      const result = await api.saveUngetConfigs(
        user.username,
        myOwnUpdated,
        opcionesDeAdopcion,
      );

      if (result.success) {
        setScriptUrls(updated);
        if (selectedUngetIndex === posicion) {
          setViewLevel("ungets");
          setSelectedUngetIndex(null);
        }
        setConexionAEliminar(null);
        toast.success(`Conexión de ${config.name} eliminada`);
      } else {
        // Antes este caso no decía nada: el guardado fallaba y el diálogo se cerraba
        // igual, como si hubiera ido bien.
        toast.error(result.message || "No se pudo eliminar la conexión.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error al eliminar");
    } finally {
      setIsDeletingConnection(false);
      setIsLoading(false);
    }
  };

  const handleOpenQuickFix = (config: UngetConfig, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setQuickFixConfig(config);
    setQuickFixUrlInput(config.url || "");
    setGasTestResult(null);
  };

  const handleTestQuickFixUrl = async () => {
    const urlToTest = quickFixUrlInput.trim();
    if (!urlToTest) {
      toast.error("Ingrese una URL de Google Apps Script para probar.");
      return;
    }
    setIsTestingGasUrl(true);
    setGasTestResult(null);
    try {
      // Solo metadata: probar el enlace no debe descargar el stock de todo el libro.
      const metadata = await fetchGasMetadata(urlToTest, { force: true });
      setGasTestResult({
        success: true,
        message: `¡Conexión verificada exitosamente! Se detectaron ${metadata.length} establecimientos en el libro.`,
        count: metadata.length,
      });
    } catch (err: any) {
      setGasTestResult({
        success: false,
        message: err?.message || "No se pudo conectar con la Web App de Google Apps Script.",
      });
    } finally {
      setIsTestingGasUrl(false);
    }
  };

  const handleSaveQuickFixUrl = async () => {
    if (!quickFixConfig || !user) return;
    // Guardar una conexión ajena no llegaba a la base: el filtro de más abajo la deja
    // fuera del envío. Decía «actualizado con éxito» y el enlace se perdía.
    if (!canEditConnection(quickFixConfig, user.username, cuentasActivas)) {
      toast.error(
        `Esta conexión la mantiene ${connectionOwner(quickFixConfig)}. Solo esa cuenta puede cambiar su enlace.`,
      );
      return;
    }
    const cleanUrl = quickFixUrlInput.trim();
    if (!cleanUrl) {
      toast.error("La URL no puede estar vacía.");
      return;
    }
    setIsSavingGasUrl(true);
    try {
      // Al guardar, una conexión sin responsable pasa a ser de quien la guarda —es lo que
      // hace `saveUngetConfigs`—, así que el estado local refleja ya ese relevo; si no, la
      // tarjeta seguiría diciendo «Sin responsable» hasta la siguiente carga.
      const updatedScriptUrls = scriptUrls.map((c) =>
        c.url === quickFixConfig.url
          ? {
              ...c,
              url: cleanUrl,
              username: isConnectionOrphaned(c, cuentasActivas) ? user.username : c.username,
            }
          : c,
      );
      setScriptUrls(updatedScriptUrls);

      // Solo la conexión que se está tocando va a nombre de quien guarda; las demás
      // conservan el suyo. Marcarlas todas hacía que arreglar un enlace te dejara de
      // responsable de cualquier otra conexión sin dueño que hubiera en la lista.
      const esLaQueSeEdita = (c: UngetConfig) =>
        quickFixConfig.ungetId
          ? String(c.ungetId || "") === String(quickFixConfig.ungetId)
          : c.url === cleanUrl;
      const myConfigsToSave = updatedScriptUrls
        .filter((u) => canEditConnection(u, user.username, cuentasActivas))
        .map((c) => (esLaQueSeEdita(c) ? { ...c, username: user.username } : c));

      const res = await api.saveUngetConfigs(
        user.username,
        myConfigsToSave,
        opcionesDeAdopcion,
      );
      if (res.success) {
        toast.success(`Enlace de ${quickFixConfig.name} actualizado con éxito.`);
        setConnectionErrors((prev) => {
          const next = { ...prev };
          delete next[quickFixConfig.url];
          return next;
        });
        const updatedConfig = { ...quickFixConfig, url: cleanUrl };
        setQuickFixConfig(null);
        retrySingleUrl(updatedConfig);
      } else {
        toast.error(res.message || "No se pudo guardar la configuración.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar el enlace.");
    } finally {
      setIsSavingGasUrl(false);
    }
  };

  const handleSelectUnget = (index: number) => {
    setSelectedUngetIndex(index);
    setViewLevel("sheets");
    setSelectedSourceId("");
    setSearchTerm("");
  };

  /**
   * Con una sola UNGET a la vista, el panel regional es una única tarjeta que hay que
   * pulsar cada vez para llegar a lo de siempre. Es el caso de un usuario de UNGET o de
   * un nivel inferior: solo ve la suya. Se entra directo a sus establecimientos.
   *
   * La condición es lo que hay en pantalla y no el rol: en cuanto se ve más de una
   * conexión el panel vuelve a tener sentido y todo se comporta como antes.
   */
  const hayPanelRegional = scriptUrls.length > 1;

  useEffect(() => {
    if (hayPanelRegional) return;
    if (scriptUrls.length !== 1) return;
    if (viewLevel !== "ungets" || selectedUngetIndex !== null) return;
    setSelectedUngetIndex(0);
    setViewLevel("sheets");
  }, [hayPanelRegional, scriptUrls.length, viewLevel, selectedUngetIndex]);

  /**
   * Lee el stock de una IPRESS sin tocar el estado: lectura directa de Google Sheets y,
   * si no es posible, Apps Script. La usan tanto "Consultar stock" como la precarga.
   */
  const readSourceStock = async (
    source: SheetSource,
  ): Promise<{ updatedSource: SheetSource; validData: SIGData[] }> => {
    const config = scriptUrls[source.urlIndex];
    if (!config) throw new Error("La UNGET de esta IPRESS ya no está configurada.");

    const assignment = allAssignments.find(
      (item) =>
        assignmentBelongsToConnection(item, config) &&
        ((source.facilityCode && item.facilityCode === source.facilityCode) ||
          (source.sheetName && item.sheetName === source.sheetName)),
    );
    const realSheetName = source.sheetName || assignment?.sheetName || source.name;

    type SheetPayload = { name?: string; spreadsheetId?: string; data?: any[] };
    let directPayload: SheetPayload | null = null;
    const gid = getCleanSourceId(source.id);
    const spreadsheetId = source.spreadsheetId || config.spreadsheetId;
    if (canReadSheetDirect(spreadsheetId, gid)) {
      try {
        const directRows = await fetchSheetRowsDirect(spreadsheetId!, gid);
        directPayload = { name: realSheetName, spreadsheetId, data: directRows };
      } catch (directErr: any) {
        console.warn(
          `Lectura directa de ${source.name} no disponible; se usa Apps Script:`,
          directErr?.message || directErr,
        );
      }
    }

    let sheetPayload: SheetPayload;
    if (directPayload) {
      sheetPayload = directPayload;
    } else {
      if (!hasWebApp(config)) {
        throw new Error(
          "No se pudo leer la hoja directamente y esta UNGET no tiene Web App de respaldo. Revise que la hoja esté compartida como lector con el enlace.",
        );
      }
      const payload = await fetchGasSingleSheet(config.url, realSheetName);
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("La hoja no devolvió datos válidos.");
      }
      sheetPayload = payload[0];
    }

    const rows = Array.isArray(sheetPayload.data) ? sheetPayload.data : [];
    const firstRow = rows[0] || {};
    const lastUpdateStr = getRowFieldValue(
      firstRow,
      "ULTIMA ACTUALIZACION",
      "ULTIMA_ACTUALIZACION",
      "ULTIMA ACTUALIZACIÓN",
      "Ultima_Actualizacion",
    );
    const equipmentDateStr = getRowFieldValue(
      firstRow,
      "FECHA DEL EQUIPO",
      "FECHA_DEL_EQUIPO",
      "Fecha_Del_Equipo",
    );
    const validData = rows
      .map((row: any) => normalizeRowData(row, lastUpdateStr, equipmentDateStr, source.id))
      .filter((row: any): row is SIGData => row !== null);

    const stableFacilityCode =
      source.facilityCode ||
      assignment?.facilityCode ||
      extractFacilityCodeFromSheetName(sheetPayload.name || realSheetName) ||
      undefined;

    return {
      validData,
      updatedSource: {
        ...source,
        sheetName: sheetPayload.name || realSheetName,
        rowCount: validData.length,
        facilityCode: stableFacilityCode,
        lastUpdate: lastUpdateStr || source.lastUpdate,
        lastUpdateTime: parseDataDate(lastUpdateStr) || source.lastUpdateTime,
        equipmentDate: equipmentDateStr || source.equipmentDate,
        equipmentDateTime: parseDataDate(equipmentDateStr) || source.equipmentDateTime,
        spreadsheetId: sheetPayload.spreadsheetId || source.spreadsheetId,
      },
    };
  };

  /** Historial en Supabase; nunca bloquea la carga del stock. */
  const registerSourceHistory = (source: SheetSource, updatedSource: SheetSource, validData: SIGData[]) => {
    if (!supabase || validData.length === 0) return;
    const stableHistoryId = updatedSource.facilityCode || getCleanSourceId(source.id);
    void supabaseService
      .registerSync({
        establishmentId: stableHistoryId,
        establishmentName: source.name,
        currentStock: validData,
        author: user?.username || "ConsultaStock",
        sheetLastUpdateDate: updatedSource.lastUpdateTime
          ? new Date(updatedSource.lastUpdateTime).toISOString()
          : undefined,
      })
      .then((result) => {
        if (!result.success || !result.record) return;
        setSupabaseSyncs((prev) => ({
          ...prev,
          [source.id]: result.record,
          [stableHistoryId]: result.record,
        }));
      })
      .catch((err) => console.warn("No se pudo actualizar el historial en segundo plano:", err));
  };

  const loadSingleSourceStock = async (
    sourceId: string,
    registerHistory: boolean = true,
  ): Promise<boolean> => {
    if (data.some((row) => row.sourceId === sourceId)) return true;

    const source = sources.find((item) => item.id === sourceId);
    if (!source) return false;
    if (!scriptUrls[source.urlIndex]) return false;

    // Un doble clic mientras responde Google no lanza una segunda descarga.
    if (loadingSourceIdsRef.current.has(sourceId)) return false;
    loadingSourceIdsRef.current.add(sourceId);
    const loadingToastId = toast.loading(`Consultando stock de ${source.name}...`);

    try {
      const { updatedSource, validData } = await readSourceStock(source);

      setSources((prev) => prev.map((item) => (item.id === sourceId ? updatedSource : item)));
      setData((prev) => [...prev.filter((row) => row.sourceId !== sourceId), ...validData]);

      if (registerHistory) registerSourceHistory(source, updatedSource, validData);

      return true;
    } catch (err: any) {
      console.error("Error cargando una hoja bajo demanda:", err);
      toast.error(`No se pudo cargar ${source.name}: ${err?.message || "Error de conexión"}`);
      return false;
    } finally {
      loadingSourceIdsRef.current.delete(sourceId);
      toast.dismiss(loadingToastId);
    }
  };

  /**
   * Precarga en segundo plano el stock de las IPRESS que aún no está en memoria, para que
   * abrirlas sea instantáneo.
   *
   * Cede el paso a lo que hace el usuario: se detiene si abre una IPRESS, si sincroniza o
   * si deja la pestaña en segundo plano, y guarda por tandas para no escribir en IndexedDB
   * una vez por hoja.
   */
  const prefetchPendingSheets = async () => {
    if (prefetchRef.current.running || !prefetchRef.current.enabled) return;

    // Solo la UNGET abierta: con varias UNGET a la vista serían cientos de hojas.
    if (selectedUngetIndex === null) return;
    const pending = sources
      .filter(
        (source) =>
          source.urlIndex === selectedUngetIndex &&
          !dataBySource.has(source.id) &&
          canReadSheetDirect(
            source.spreadsheetId || scriptUrls[source.urlIndex]?.spreadsheetId,
            getCleanSourceId(source.id),
          ),
      )
      .slice(0, PREFETCH_MAX_SHEETS);
    if (pending.length === 0) return;

    const shouldPause = () =>
      !prefetchRef.current.enabled ||
      loadingSourceIdsRef.current.size > 0 ||
      (typeof document !== "undefined" && document.hidden);

    prefetchRef.current.running = true;
    let loaded = 0;
    try {
      let batchSources: SheetSource[] = [];
      let batchRows: SIGData[] = [];

      const commitBatch = () => {
        if (batchSources.length === 0) return;
        const updatedById = new Map(batchSources.map((item) => [item.id, item]));
        const rows = batchRows;
        setSources((prev) => prev.map((item) => updatedById.get(item.id) || item));
        setData((prev) => [...prev.filter((row) => !updatedById.has(row.sourceId || "")), ...rows]);
        batchSources = [];
        batchRows = [];
      };

      await runWithConcurrency(pending, PREFETCH_CONCURRENCY, async (source) => {
        if (shouldPause()) return;
        try {
          const { updatedSource, validData } = await readSourceStock(source);
          batchSources.push(updatedSource);
          batchRows.push(...validData);
          loaded++;
          registerSourceHistory(source, updatedSource, validData);
          if (batchSources.length >= PREFETCH_COMMIT_SIZE) commitBatch();
        } catch (err: any) {
          // Una hoja que falla se reintenta en la próxima precarga.
          console.warn(`Precarga de ${source.name} omitida:`, err?.message || err);
        }
        // Respiro entre hojas: la precarga nunca debe competir con lo que pide el usuario.
        await new Promise((resolve) => setTimeout(resolve, PREFETCH_PAUSE_MS));
      });

      commitBatch();
    } finally {
      prefetchRef.current.running = false;
      if (loaded > 0) {
        console.info(`Precarga: ${loaded} de ${pending.length} IPRESS listas para consulta inmediata.`);
      }
    }
  };

  const handleSelectSheet = async (sourceId: string) => {
    const loaded = await loadSingleSourceStock(sourceId, true);
    if (!loaded) return;

    if (isTableFullscreen) {
      setStockModalSourceId(sourceId);
      setStockModalSearchTerm("");
    } else {
      setSelectedSourceId(sourceId);
      setViewLevel("data");
      setSearchTerm("");
    }
  };

  const goBack = () => {
    if (viewLevel === "data") {
      setViewLevel("sheets");
      setSelectedSourceId("");
    } else if (viewLevel === "sheets") {
      setViewLevel("ungets");
      setSelectedUngetIndex(null);
    }
  };

  const handleRemoveUrl = (indexToRemove: number) => {
    const config = tempUrls[indexToRemove];
    // Quitarla de la lista no la borraba de la base —`saveUngetConfigs` solo retira filas
    // propias—, así que desaparecía de la pantalla hasta la siguiente carga.
    if (!canEditConnection(config, user?.username, cuentasActivas)) {
      toast.error(`Esta conexión la mantiene ${connectionOwner(config)}. Solo esa cuenta puede retirarla.`);
      return;
    }
    setTempUrls(tempUrls.filter((_, idx) => idx !== indexToRemove));
  };

  const exportCurrentSheetToExcel = () => {
    if (!selectedSourceId) return;
    const sheetInfo = sources.find((s) => s.id === selectedSourceId);
    if (!sheetInfo) return;

    const dataToExport = filteredData.map((r) => ({
      ALMCOD: readAlmCode(r),
      DESC_ALM: r.DESC_ALM || sheetInfo.name || "",
      ID_Producto: r.ID_Producto || "",
      CODIGO_SIG: r.CODIGO_SIG || r.SIGA || "",
      Nombre: r.Nombre || r.DESC_ITEM || "",
      Lote: r.Lote || r.LOTE || "",
      Fec_Vencim: r.Fec_Vencim || r.VENCIMIENTO || "",
      Reg_Sanitario: r.Reg_Sanitario || r.REG_SANITARIO || "",
      TIPSUM: r.TIPSUM || "",
      DESC_TIPSUM: r.DESC_TIPSUM || r.TIPO_SUMINISTRO || "",
      FFINAN: r.FFINAN || "",
      DESC_FFINAN: r.DESC_FFINAN || r.FF || "",
      Saldo:
        r.Saldo !== undefined ? r.Saldo : r.SALDO !== undefined ? r.SALDO : "",
      Precio_Det: r.Precio_Det || r.PRECIO_COMPRA || "",
      Precio_Cab: r.Precio_Cab || r.PRECIO_REF || "",
      "FECHA DEL EQUIPO": r.FECHA_DEL_EQUIPO || "",
      "ULTIMA ACTUALIZACION": r.Ultima_Actualizacion || "",
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    XLSX.writeFile(
      wb,
      `Stock_${sheetInfo.name}_${new Date().toISOString().split("T")[0]}.xlsx`.replace(
        /\s+/g,
        "_",
      ),
    );
  };

  const exportModalStockToExcel = () => {
    if (!stockModalSourceId) return;
    const sheetInfo = sources.find((s) => s.id === stockModalSourceId);
    if (!sheetInfo) return;

    const dataToExport = modalStockData.map((r) => ({
      ALMCOD: readAlmCode(r),
      DESC_ALM: r.DESC_ALM || sheetInfo.name || "",
      ID_Producto: r.ID_Producto || "",
      CODIGO_SIG: r.CODIGO_SIG || r.SIGA || "",
      Nombre: r.Nombre || r.DESC_ITEM || "",
      Sub_Grupo: r.Sub_Grupo || "",
      Saldo: typeof r.Saldo !== "undefined" ? r.Saldo : r.CANTIDAD || 0,
      Precio_Cab: r.Precio_Cab || r.PRECIO_REF || "",
      Lote: r.Lote || r.LOTE || "",
      Fec_Vencim: r.Fec_Vencim
        ? formatDate(r.Fec_Vencim)
        : r.FECHA_VENCIMIENTO || "",
      Mes_Vencim: r.Mes_Vencim || "",
      Año_Vencim: r.Año_Vencim || "",
      Reg_Sanitario: r.Reg_Sanitario || r.REGISTRO_SANITARIO || "",
      TIPSUM: r.TIPSUM || r.TIPO_SUMINISTRO || "",
      DESC_TIPSUM: r.DESC_TIPSUM || "",
      ESTMNT: r.ESTMNT || "",
      FFINAN: r.FFINAN || r.FUENTE_FINANCIAMIENTO || "",
      DESC_FFINAN: r.DESC_FFINAN || "",
      "FECHA DEL EQUIPO": r.FECHA_DEL_EQUIPO || "",
      Ultima_Actualizacion: r.Ultima_Actualizacion || "",
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    XLSX.writeFile(
      wb,
      `Stock_${sheetInfo.name}_${new Date().toISOString().split("T")[0]}.xlsx`.replace(
        /\s+/g,
        "_",
      ),
    );
  };

  const exportAllEstablishmentsToExcel = () => {
    if (selectedUngetIndex === null) return;
    setExportScope("single");
    // Pre-populate modal filters with the currently active advanced sidebar filters
    setExportCS(filter_CS);
    setExportPS(filter_PS);
    setExportALM(filter_ALM);
    setExportHOSP(filter_HOSP);
    setExportOTRO(filter_OTRO);

    setExportEmerald(filter_emerald);
    setExportAmber(filter_amber);
    setExportRed(filter_red);
    setExportGray(filter_gray);

    setExportHasPendingExpirations(filterHasPendingExpirations);
    setExportDateUnit(filterDateUnit);
    setExportDateValue(filterDateValue);
    setExportDateCondition(filterDateCondition);

    setIsExportOptionsModalOpen(true);
  };

  const filteredExportSourcesCount = useMemo(() => {
    if (exportScope === "single" && selectedUngetIndex === null) return 0;
    return sources.filter((s) => {
      if (exportScope === "single" && s.urlIndex !== selectedUngetIndex)
        return false;

      // Type filter
      const typeValue = getSheetType(s.name);
      if (typeValue === "CS" && !exportCS) return false;
      if (typeValue === "PS" && !exportPS) return false;
      if (typeValue === "ALM" && !exportALM) return false;
      if (typeValue === "HOSP" && !exportHOSP) return false;
      if (typeValue === "OTRO" && !exportOTRO) return false;

      // Color status Filter
      const colorValue = getUpdateStatus(s.lastUpdateTime).color;
      if (colorValue === "bg-emerald-500" && !exportEmerald) return false;
      if (colorValue === "bg-amber-500" && !exportAmber) return false;
      if (colorValue === "bg-red-500" && !exportRed) return false;
      if (colorValue === "bg-gray-400" && !exportGray) return false;

      // Date limit filter
      if (exportDateValue > 0) {
        let diffHours = Infinity;
        if (s.lastUpdateTime) {
          const now = new Date().getTime();
          const diffMs = now - s.lastUpdateTime;
          diffHours = diffMs / (1000 * 60 * 60);
        }

        const maxHours =
          exportDateUnit === "hours" ? exportDateValue : exportDateValue * 24;
        const isWithinLimit = diffHours <= maxHours;

        if (exportDateCondition === "with" && !isWithinLimit) return false;
        if (exportDateCondition === "without" && isWithinLimit) return false;
      }

      return true;
    }).length;
  }, [
    sources,
    selectedUngetIndex,
    exportScope,
    exportCS,
    exportPS,
    exportALM,
    exportHOSP,
    exportOTRO,
    exportEmerald,
    exportAmber,
    exportRed,
    exportGray,
    exportDateUnit,
    exportDateValue,
    exportDateCondition,
  ]);

  const executeExportAllEstablishmentsToExcel = () => {
    if (exportScope === "single" && selectedUngetIndex === null) return;

    // Filter sources based on conditions configured in the export modal
    const filteredSources = sources.filter((s) => {
      if (exportScope === "single" && s.urlIndex !== selectedUngetIndex)
        return false;

      // Type filter
      const typeValue = getSheetType(s.name);
      if (typeValue === "CS" && !exportCS) return false;
      if (typeValue === "PS" && !exportPS) return false;
      if (typeValue === "ALM" && !exportALM) return false;
      if (typeValue === "HOSP" && !exportHOSP) return false;
      if (typeValue === "OTRO" && !exportOTRO) return false;

      // Color status Filter
      const colorValue = getUpdateStatus(s.lastUpdateTime).color;
      if (colorValue === "bg-emerald-500" && !exportEmerald) return false;
      if (colorValue === "bg-amber-500" && !exportAmber) return false;
      if (colorValue === "bg-red-500" && !exportRed) return false;
      if (colorValue === "bg-gray-400" && !exportGray) return false;

      // Date limit filter
      if (exportDateValue > 0) {
        let diffHours = Infinity;
        if (s.lastUpdateTime) {
          const now = new Date().getTime();
          const diffMs = now - s.lastUpdateTime;
          diffHours = diffMs / (1000 * 60 * 60);
        }

        const maxHours =
          exportDateUnit === "hours" ? exportDateValue : exportDateValue * 24;
        const isWithinLimit = diffHours <= maxHours;

        if (exportDateCondition === "with" && !isWithinLimit) return false;
        if (exportDateCondition === "without" && isWithinLimit) return false;
      }

      return true;
    });

    const filteredSourceIds = new Set(filteredSources.map((s) => s.id));

    // Filter data items belonging to the filtered sources
    const ungetData = data.filter((r) => {
      if (!r.sourceId || !filteredSourceIds.has(r.sourceId)) return false;

      // Expiration filter
      if (exportHasPendingExpirations) {
        const { expiredCount, expiringThisMonthCount } = getExpirationStats([
          r,
        ]);
        if (expiredCount === 0 && expiringThisMonthCount === 0) return false;
      }

      return true;
    });

    if (ungetData.length === 0) {
      alert(
        "No hay registros de stock que coincidan con los filtros seleccionados para exportar.",
      );
      return;
    }

    const dataToExport = ungetData.map((r) => {
      const sheetInfo = sources.find((s) => s.id === r.sourceId);
      const ungetInfo = sheetInfo ? scriptUrls[sheetInfo.urlIndex] : null;
      return {
        UNGET: ungetInfo ? ungetInfo.name : "N/A",
        ALMCOD: readAlmCode(r),
        DESC_ALM: r.DESC_ALM || (sheetInfo ? sheetInfo.name : ""),
        ID_Producto: r.ID_Producto || "",
        CODIGO_SIG: r.CODIGO_SIG || r.SIGA || "",
        Nombre: r.Nombre || r.DESC_ITEM || "",
        Lote: r.Lote || r.LOTE || "",
        Fec_Vencim: r.Fec_Vencim || r.VENCIMIENTO || "",
        Reg_Sanitario: r.Reg_Sanitario || r.REG_SANITARIO || "",
        TIPSUM: r.TIPSUM || "",
        DESC_TIPSUM: r.DESC_TIPSUM || r.TIPO_SUMINISTRO || "",
        FFINAN: r.FFINAN || "",
        DESC_FFINAN: r.DESC_FFINAN || r.FF || "",
        Saldo:
          r.Saldo !== undefined
            ? r.Saldo
            : r.SALDO !== undefined
              ? r.SALDO
              : "",
        Precio_Det: r.Precio_Det || r.PRECIO_COMPRA || "",
        Precio_Cab: r.Precio_Cab || r.PRECIO_REF || "",
        "FECHA DEL EQUIPO": r.FECHA_DEL_EQUIPO || "",
        "ULTIMA ACTUALIZACION": r.Ultima_Actualizacion || "",
      };
    });

    const ungetName =
      exportScope === "single" && selectedUngetIndex !== null
        ? formatDisplayName(scriptUrls[selectedUngetIndex]?.name || "UNGET")
        : "Regional";
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Consolidado");

    if (exportScope === "single") {
      XLSX.writeFile(
        wb,
        `Stock_Consolidado_${ungetName}_${new Date().toISOString().split("T")[0]}.xlsx`.replace(
          /\s+/g,
          "_",
        ),
      );
    } else {
      XLSX.writeFile(
        wb,
        `Stock_Consolidado_Regional_${new Date().toISOString().split("T")[0]}.xlsx`.replace(
          /\s+/g,
          "_",
        ),
      );
    }

    setIsExportOptionsModalOpen(false);
  };

  const exportAllUngetsToExcel = () => {
    if (data.length === 0) return;
    setExportScope("all");
    // Pre-populate modal filters with the currently active advanced sidebar filters
    setExportCS(filter_CS);
    setExportPS(filter_PS);
    setExportALM(filter_ALM);
    setExportHOSP(filter_HOSP);
    setExportOTRO(filter_OTRO);

    setExportEmerald(filter_emerald);
    setExportAmber(filter_amber);
    setExportRed(filter_red);
    setExportGray(filter_gray);

    setExportHasPendingExpirations(filterHasPendingExpirations);
    setExportDateUnit(filterDateUnit);
    setExportDateValue(filterDateValue);
    setExportDateCondition(filterDateCondition);

    setIsExportOptionsModalOpen(true);
  };

  const copyScript = () => {
    navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scriptCode = `function doGet(e) {
  // Reemplace 'TU_ID_AQUI' con el ID real de su Google Sheet
  var id = 'TU_ID_AQUI';
  
  try {
    var ss = SpreadsheetApp.openById(id);
    var action = e && e.parameter ? e.parameter.action : '';
    var targetSheetName = e && e.parameter ? e.parameter.sheet : '';
    var targetSheetsParam = e && e.parameter ? e.parameter.sheets : '';
    
    // 1. MODO METADATOS ULTRARRÁPIDO (~500ms): Lee solo la fila 2 (primer registro de datos)
    if (action === 'getMetadata' || action === 'checkUpdates') {
      var sheets = ss.getSheets();
      var metadata = [];
      for (var i = 0; i < sheets.length; i++) {
        var sh = sheets[i];
        var shName = sh.getName();
        var lastRow = sh.getLastRow();
        if (lastRow < 2) {
          metadata.push({ id: sh.getSheetId().toString(), name: shName, lastUpdate: '', equipmentDate: '', rowCount: 0 });
          continue;
        }
        
        var lastCol = sh.getLastColumn();
        // Fila 1 = encabezados, Fila 2 = primer registro de datos
        var sampleRange = sh.getRange(1, 1, 2, lastCol).getDisplayValues();
        var headers = sampleRange[0] || [];
        var firstRow = sampleRange[1] || [];
        
        var lastUpdate = '';
        var equipmentDate = '';
        var almcod = '';

        for (var h = 0; h < headers.length; h++) {
          var hClean = cleanHeader(headers[h]);
          if (hClean.indexOf('ULTIMA_ACT') >= 0 || hClean.indexOf('ULT_ACT') >= 0 || hClean === 'ULTIMA_ACTUALIZACION') {
            lastUpdate = String(firstRow[h] || '').trim();
          } else if (hClean.indexOf('FECHA_DEL_EQUIPO') >= 0 || hClean.indexOf('FECHA_EQUIPO') >= 0) {
            equipmentDate = String(firstRow[h] || '').trim();
          } else if (hClean === 'ALMCOD' || hClean.indexOf('ALM_COD') >= 0) {
            almcod = String(firstRow[h] || '').trim();
          }
        }
        
        metadata.push({
          id: sh.getSheetId().toString(),
          name: shName,
          lastUpdate: lastUpdate,
          equipmentDate: equipmentDate,
          almcod: almcod,
          rowCount: lastRow - 1
        });
      }
      return ContentService.createTextOutput(JSON.stringify(metadata)).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. MODO LISTA DE HOJAS
    if (action === 'getSheets') {
      var sheets = ss.getSheets();
      var sheetList = [];
      for (var i = 0; i < sheets.length; i++) {
        sheetList.push({ id: sheets[i].getSheetId().toString(), name: sheets[i].getName() });
      }
      return ContentService.createTextOutput(JSON.stringify(sheetList)).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 3. MODO DESCARGA SELECTIVA (?sheets=HOJA1,HOJA2 o ?sheet=HOJA1)
    var result = [];
    if (targetSheetsParam) {
      var requestedNames = targetSheetsParam.split(',').map(function(s){ return s.trim(); });
      for (var r = 0; r < requestedNames.length; r++) {
        var sh = ss.getSheetByName(requestedNames[r]);
        if (sh) {
          result.push(processSheet(sh));
        }
      }
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (targetSheetName) {
      var sheet = ss.getSheetByName(targetSheetName);
      if (sheet) {
        result.push(processSheet(sheet));
      } else {
        return ContentService.createTextOutput(JSON.stringify({error: "Hoja no encontrada"})).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 4. MODO COMPLETO (Todas las hojas)
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      result.push(processSheet(allSheets[i]));
    }
    
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

function cleanHeader(s) {
  if (!s) return '';
  var str = String(s).trim().toUpperCase();
  var accents = {'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U','Ñ':'N'};
  str = str.replace(/[ÁÉÍÓÚÑ]/g, function(m){ return accents[m]; });
  return str.replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');
}

function processSheet(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { id: sheet.getSheetId().toString(), name: sheet.getName(), data: [] };
  }
  
  var data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headers = data[0];
  var rows = [];
  
  for (var j = 1; j < data.length; j++) {
    var row = data[j];
    var obj = {};
    var hasData = false;
    for (var k = 0; k < headers.length; k++) {
      var key = headers[k];
      if (key) {
        var val = row[k];
        obj[key.toString().trim()] = val !== undefined && val !== null ? String(val) : "";
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          hasData = true;
        }
      }
    }
    if (hasData) {
      rows.push(obj);
    }
  }
  
  return {
    id: sheet.getSheetId().toString(),
    name: sheet.getName(),
    data: rows
  };
}`;

  const filteredUngets = useMemo(() => {
    if (!ungetSearchTerm.trim()) return scriptUrls;
    const term = ungetSearchTerm.toLowerCase();
    return scriptUrls.filter((u) => u.name.toLowerCase().includes(term));
  }, [scriptUrls, ungetSearchTerm]);

  const filteredData = useMemo(() => {
    let currentData = selectedSourceId
      ? rowsForSource(selectedSourceId)
      : data;
    currentData = currentData.filter(Boolean);

    return currentData.filter((item) => {
      // 1. Search term check
      if (searchTerm.trim()) {
        const lowerTerm = searchTerm.toLowerCase();
        const matchesSearch =
          String(item.Nombre || "")
            .toLowerCase()
            .includes(lowerTerm) ||
          String(item.CODIGO_SIG || "")
            .toLowerCase()
            .includes(lowerTerm) ||
          String(item.ID_Producto || "")
            .toLowerCase()
            .includes(lowerTerm) ||
          String(item.Lote || "")
            .toLowerCase()
            .includes(lowerTerm) ||
          String(item.DESC_ALM || "")
            .toLowerCase()
            .includes(lowerTerm) ||
          String(item.Reg_Sanitario || "")
            .toLowerCase()
            .includes(lowerTerm);
        if (!matchesSearch) return false;
      }

      // 2. Tipsum filter (dynamic match)
      if (dataFilterTipsum !== "all") {
        const tipsum = String(item.TIPSUM || "")
          .toUpperCase()
          .trim();
        if (tipsum !== dataFilterTipsum.toUpperCase().trim()) return false;
      }

      // 3. FFinan filter (dynamic match)
      if (dataFilterFFinan !== "all") {
        const ffinan = String(item.FFINAN || "")
          .toUpperCase()
          .trim();
        if (ffinan !== dataFilterFFinan.toUpperCase().trim()) return false;
      }

      // 4. Stock filter (with_stock: >0, no_stock: <=0)
      if (dataFilterStock !== "all") {
        const stockVal = parseFloat(
          String(item.Saldo || "0").replace(/,/g, ""),
        );
        if (dataFilterStock === "with_stock" && stockVal <= 0) return false;
        if (dataFilterStock === "no_stock" && stockVal > 0) return false;
      }

      // 5. Expiration filter
      if (dataFilterExpiration !== "all") {
        const { expiredCount, expiringThisMonthCount } = getExpirationStats([
          item,
        ]);
        if (dataFilterExpiration === "expired" && expiredCount === 0)
          return false;
        if (dataFilterExpiration === "expiring" && expiringThisMonthCount === 0)
          return false;
        if (
          dataFilterExpiration === "ok" &&
          (expiredCount > 0 || expiringThisMonthCount > 0)
        )
          return false;
      }

      // 6. Custom Expiration Month / Year Filter
      if (dataFilterExpMonth !== "all" || dataFilterExpYear !== "all") {
        const exp = getItemExpiration(item);
        if (!exp) return false;
        if (
          dataFilterExpMonth !== "all" &&
          exp.month !== parseInt(dataFilterExpMonth, 10)
        )
          return false;
        if (
          dataFilterExpYear !== "all" &&
          String(exp.year) !== dataFilterExpYear
        )
          return false;
      }

      return true;
    });
  }, [
    data,
    searchTerm,
    selectedSourceId,
    dataFilterTipsum,
    dataFilterFFinan,
    dataFilterStock,
    dataFilterExpiration,
    dataFilterExpMonth,
    dataFilterExpYear,
  ]);

  const modalStockData = useMemo(() => {
    if (!stockModalSourceId) return [];
    let currentData = rowsForSource(stockModalSourceId);

    if (!stockModalSearchTerm.trim()) return currentData;
    const lowerTerm = stockModalSearchTerm.toLowerCase();

    return currentData.filter((item) => {
      if (!item) return false;
      return (
        String(item.Nombre || "")
          .toLowerCase()
          .includes(lowerTerm) ||
        String(item.CODIGO_SIG || "")
          .toLowerCase()
          .includes(lowerTerm) ||
        String(item.ID_Producto || "")
          .toLowerCase()
          .includes(lowerTerm) ||
        String(item.Lote || "")
          .toLowerCase()
          .includes(lowerTerm) ||
        String(item.DESC_ALM || "")
          .toLowerCase()
          .includes(lowerTerm)
      );
    });
  }, [data, stockModalSearchTerm, stockModalSourceId]);

  /**
   * La columna «Código IPRESS» distingue las farmacias de una misma hoja: la principal es la
   * IPRESS y de `F02` en adelante son puestos comunales, y sin ella el saldo de dos sitios
   * distintos parece el de uno solo. Solo aparece cuando hay más de una farmacia a la vista:
   * en el envío consolidado todas las filas traen el mismo ALMCOD, o ninguno.
   */
  const showsPharmacyInData = useMemo(
    () => showsPharmacyColumn(filteredData, readAlmCode),
    [filteredData],
  );
  const showsPharmacyInModal = useMemo(
    () => showsPharmacyColumn(modalStockData, readAlmCode),
    [modalStockData],
  );
  const pharmacyLabelOf = useCallback(
    (row: SIGData) => describePharmacyCode(readAlmCode(row), allFacilities),
    [allFacilities],
  );

  const activeSheetData = useMemo(
    () =>
      selectedSourceId
        ? rowsForSource(selectedSourceId)
        : [],
    [data, selectedSourceId],
  );
  const activeSheetExpirationInfo = useMemo(
    () => getExpirationStats(activeSheetData),
    [activeSheetData],
  );
  const filteredDataExpirationInfo = useMemo(
    () => getExpirationStats(filteredData),
    [filteredData],
  );

  const availableTipsums = useMemo(() => {
    const currentData = selectedSourceId
      ? rowsForSource(selectedSourceId)
      : data;
    const set = new Set<string>();
    currentData.forEach((item) => {
      if (item && item.TIPSUM) {
        const val = item.TIPSUM.toString().trim();
        if (val) set.add(val);
      }
    });
    return Array.from(set).sort();
  }, [data, selectedSourceId]);

  const availableFFinans = useMemo(() => {
    const currentData = selectedSourceId
      ? rowsForSource(selectedSourceId)
      : data;
    const set = new Set<string>();
    currentData.forEach((item) => {
      if (item && item.FFINAN) {
        const val = item.FFINAN.toString().trim();
        if (val) set.add(val);
      }
    });
    return Array.from(set).sort();
  }, [data, selectedSourceId]);

  const availableYears = useMemo(() => {
    const currentData = selectedSourceId
      ? rowsForSource(selectedSourceId)
      : data;
    const set = new Set<string>();
    currentData.forEach((item) => {
      if (item) {
        const exp = getItemExpiration(item);
        if (exp && exp.year > 2000 && exp.year < 2100) {
          set.add(String(exp.year));
        }
      }
    });
    return Array.from(set).sort();
  }, [data, selectedSourceId]);

  const allUngetSummaries = useMemo(() => {
    const summaries: Record<
      number,
      { cs: number; ps: number; alm: number; hosp: number }
    > = {};

    scriptUrls.forEach((_, urlIndex) => {
      const counts = { cs: 0, ps: 0, alm: 0, hosp: 0 };
      const ungetSources = sources.filter((s) => s.urlIndex === urlIndex);

      ungetSources.forEach((s) => {
        const name = s.name.toUpperCase();
        if (name.includes("C.S.") || name.includes("CENTRO DE SALUD"))
          counts.cs++;
        else if (name.includes("P.S.") || name.includes("PUESTO DE SALUD"))
          counts.ps++;
        else if (name.includes("ALM") || name.includes("ALMACEN")) counts.alm++;
        else if (name.includes("HOSP") || name.includes("HOSPITAL"))
          counts.hosp++;
      });
      summaries[urlIndex] = counts;
    });

    return summaries;
  }, [scriptUrls, sources]);

  const globalUngetSummary = useMemo(() => {
    const counts = {
      cs: 0,
      ps: 0,
      alm: 0,
      hosp: 0,
      total: 0,
      online: 0,
      delayed: 0,
      offline: 0,
    };
    sources.forEach((s) => {
      const name = s.name.toUpperCase();
      if (name.includes("C.S.") || name.includes("CENTRO DE SALUD"))
        counts.cs++;
      else if (name.includes("P.S.") || name.includes("PUESTO DE SALUD"))
        counts.ps++;
      else if (name.includes("ALM") || name.includes("ALMACEN")) counts.alm++;
      else if (name.includes("HOSP") || name.includes("HOSPITAL"))
        counts.hosp++;

      counts.total++;
      const status = getUpdateStatus(s.lastUpdateTime).color;
      if (status === "bg-emerald-500") counts.online++;
      else if (status === "bg-amber-500") counts.delayed++;
      else counts.offline++;
    });
    return counts;
  }, [sources]);

  const filteredAndSortedSources = useMemo(() => {
    if (selectedUngetIndex === null) return [];

    const matching = sources.filter((s) => {
      if (s.urlIndex !== selectedUngetIndex) return false;

      // Search term filter
      if (sheetSearchTerm) {
        const term = sheetSearchTerm.toLowerCase();
        const description = describeSheetName(s.name);
        const code = codeForSheet(s.id);
        if (
          !description.toLowerCase().includes(term) &&
          !code.toLowerCase().includes(term)
        ) {
          return false;
        }
      }

      // Type filter
      const typeValue = getSheetType(s.name);
      if (typeValue === "CS" && !filter_CS) return false;
      if (typeValue === "PS" && !filter_PS) return false;
      if (typeValue === "ALM" && !filter_ALM) return false;
      if (typeValue === "HOSP" && !filter_HOSP) return false;
      if (typeValue === "OTRO" && !filter_OTRO) return false;

      // Color status Filter
      const colorValue = getUpdateStatus(s.lastUpdateTime).color;
      if (colorValue === "bg-emerald-500" && !filter_emerald) return false;
      if (colorValue === "bg-amber-500" && !filter_amber) return false;
      if (colorValue === "bg-red-500" && !filter_red) return false;
      if (colorValue === "bg-gray-400" && !filter_gray) return false;

      // Date limit filter
      if (filterDateValue > 0) {
        let diffHours = Infinity;
        if (s.lastUpdateTime) {
          const now = new Date().getTime();
          const diffMs = now - s.lastUpdateTime;
          diffHours = diffMs / (1000 * 60 * 60);
        }

        const maxHours =
          filterDateUnit === "hours" ? filterDateValue : filterDateValue * 24;
        const isWithinLimit = diffHours <= maxHours;

        if (filterDateCondition === "with" && !isWithinLimit) return false;
        if (filterDateCondition === "without" && isWithinLimit) return false;
      }

      // Movements limit filter
      if (filterMovementsValue > 0) {
        const syncRecord = supabaseSyncs[s.id];
        let diffHours = Infinity;
        if (syncRecord && syncRecord.sync_date) {
          const now = new Date().getTime();
          const diffMs = now - new Date(syncRecord.sync_date).getTime();
          diffHours = diffMs / (1000 * 60 * 60);
        }

        const maxHours =
          filterMovementsUnit === "hours"
            ? filterMovementsValue
            : filterMovementsValue * 24;
        const isWithinLimit = diffHours <= maxHours;

        if (filterMovementsCondition === "with" && !isWithinLimit) return false;
        if (filterMovementsCondition === "without" && isWithinLimit)
          return false;
      }

      // Expiration filter
      if (filterHasPendingExpirations) {
        const sheetData = rowsForSource(s.id);
        const { expiredCount, expiringThisMonthCount } =
          getExpirationStats(sheetData);
        if (expiredCount === 0 && expiringThisMonthCount === 0) return false;
      }

      return true;
    });

    // Sorting
    return [...matching].sort((s1, s2) => {
      if (filterSortOrder === "code_asc") {
        const c1 = codeForSheet(s1.id) || "";
        const c2 = codeForSheet(s2.id) || "";
        return c1.localeCompare(c2);
      }
      if (filterSortOrder === "code_desc") {
        const c1 = codeForSheet(s1.id) || "";
        const c2 = codeForSheet(s2.id) || "";
        return c2.localeCompare(c1);
      }
      if (filterSortOrder === "type_asc") {
        const type1 = getSheetType(s1.name);
        const type2 = getSheetType(s2.name);
        return type1.localeCompare(type2);
      }
      if (filterSortOrder === "type_desc") {
        const type1 = getSheetType(s1.name);
        const type2 = getSheetType(s2.name);
        return type2.localeCompare(type1);
      }
      if (filterSortOrder === "equip_newest") {
        const t1 = s1.equipmentDateTime || 0;
        const t2 = s2.equipmentDateTime || 0;
        return t2 - t1;
      }
      if (filterSortOrder === "equip_oldest") {
        const t1 = s1.equipmentDateTime || 0;
        const t2 = s2.equipmentDateTime || 100000000000000;
        const t1_val = t1 === 0 ? 100000000000001 : t1;
        const t2_val = t2 === 0 ? 100000000000001 : t2;
        return t1_val - t2_val;
      }
      if (
        filterSortOrder === "status_green_first" ||
        filterSortOrder === "status_red_first"
      ) {
        const getStatusWeight = (s: typeof s1) => {
          const color = getUpdateStatus(s.lastUpdateTime).color;
          if (color.includes("bg-emerald-500")) return 1;
          if (color.includes("bg-amber-500")) return 2;
          if (color.includes("bg-red-500")) return 3;
          return 4; // gray / sin datos
        };
        const w1 = getStatusWeight(s1);
        const w2 = getStatusWeight(s2);
        return filterSortOrder === "status_green_first" ? w1 - w2 : w2 - w1;
      }
      if (filterSortOrder === "name_asc") {
        return s1.name.localeCompare(s2.name);
      }
      if (filterSortOrder === "name_desc") {
        return s2.name.localeCompare(s1.name);
      }
      if (filterSortOrder === "date_newest") {
        const t1 = s1.lastUpdateTime || 0;
        const t2 = s2.lastUpdateTime || 0;
        return t2 - t1;
      }
      if (filterSortOrder === "date_oldest") {
        const t1 = s1.lastUpdateTime || 0;
        const t2 = s2.lastUpdateTime || 100000000000000; // Put very old/unset at the back/bottom
        const t1_val = t1 === 0 ? 100000000000001 : t1;
        const t2_val = t2 === 0 ? 100000000000001 : t2;
        return t1_val - t2_val;
      }
      if (filterSortOrder === "expired_highest") {
        const sheetData1 = rowsForSource(s1.id);
        const stats1 = getExpirationStats(sheetData1);
        const expInd1 =
          stats1.expiredCount * 10 + stats1.expiringThisMonthCount;

        const sheetData2 = rowsForSource(s2.id);
        const stats2 = getExpirationStats(sheetData2);
        const expInd2 =
          stats2.expiredCount * 10 + stats2.expiringThisMonthCount;

        if (expInd2 !== expInd1) {
          return expInd2 - expInd1;
        }
        return s1.name.localeCompare(s2.name);
      }
      if (filterSortOrder === "expired_lowest") {
        const sheetData1 = rowsForSource(s1.id);
        const stats1 = getExpirationStats(sheetData1);
        const expInd1 =
          stats1.expiredCount * 10 + stats1.expiringThisMonthCount;

        const sheetData2 = rowsForSource(s2.id);
        const stats2 = getExpirationStats(sheetData2);
        const expInd2 =
          stats2.expiredCount * 10 + stats2.expiringThisMonthCount;

        if (expInd2 !== expInd1) {
          return expInd1 - expInd2;
        }
        return s1.name.localeCompare(s2.name);
      }
      return 0;
    });
  }, [
    sources,
    selectedUngetIndex,
    sheetSearchTerm,
    data,
    filter_CS,
    filter_PS,
    filter_ALM,
    filter_HOSP,
    filter_OTRO,
    filter_emerald,
    filter_amber,
    filter_red,
    filter_gray,
    filterSortOrder,
    filterHasPendingExpirations,
    filterDateUnit,
    filterDateValue,
    filterDateCondition,
    filterMovementsUnit,
    filterMovementsValue,
    filterMovementsCondition,
    supabaseSyncs,
  ]);

  const toggleCardSelection = (sheetId: string) => {
    setSelectedCaptureIds((prev) => {
      const next = new Set(prev);
      if (next.has(sheetId)) {
        next.delete(sheetId);
      } else {
        next.add(sheetId);
      }
      return next;
    });
  };

  const handleSelectAllCapture = () => {
    setSelectedCaptureIds(new Set(filteredAndSortedSources.map((s) => s.id)));
  };

  const handleDeselectAllCapture = () => {
    setSelectedCaptureIds(new Set());
  };

  const handleAutoSelectDeficiencies = () => {
    const deficientIds = new Set<string>();
    filteredAndSortedSources.forEach((sheet) => {
      const sheetData = rowsForSource(sheet.id);
      const { expiredCount, expiringThisMonthCount } = getExpirationStats(sheetData);
      const statusObj = getUpdateStatus(sheet.lastUpdateTime);
      const isMismatch = !datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime);
      const isOfflineOrDelayed =
        !sheet.lastUpdateTime ||
        statusObj.color.includes("red") ||
        statusObj.color.includes("amber") ||
        statusObj.label.toLowerCase().includes("desconectado") ||
        statusObj.label.toLowerCase().includes("fuera") ||
        statusObj.label.toLowerCase().includes("atrasado");

      if (isOfflineOrDelayed || isMismatch || expiredCount > 0 || expiringThisMonthCount > 0) {
        deficientIds.add(sheet.id);
      }
    });

    setSelectedCaptureIds(deficientIds);
    if (deficientIds.size === 0) {
      toast.info("No se encontraron establecimientos con deficiencias visibles");
    } else {
      toast.success(`${deficientIds.size} establecimientos con deficiencias seleccionados`);
    }
  };

  const deficiencyCount = useMemo(() => {
    let count = 0;
    filteredAndSortedSources.forEach((sheet) => {
      const sheetData = rowsForSource(sheet.id);
      const { expiredCount, expiringThisMonthCount } = getExpirationStats(sheetData);
      const statusObj = getUpdateStatus(sheet.lastUpdateTime);
      const isMismatch = !datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime);
      const isOfflineOrDelayed =
        !sheet.lastUpdateTime ||
        statusObj.color.includes("red") ||
        statusObj.color.includes("amber") ||
        statusObj.label.toLowerCase().includes("desconectado") ||
        statusObj.label.toLowerCase().includes("fuera") ||
        statusObj.label.toLowerCase().includes("atrasado");

      if (isOfflineOrDelayed || isMismatch || expiredCount > 0 || expiringThisMonthCount > 0) {
        count++;
      }
    });
    return count;
  }, [filteredAndSortedSources, data]);

  const selectedCaptureItemsData = useMemo(() => {
    return Array.from(selectedCaptureIds)
      .map((id) => {
        const sheet = sources.find((s) => s.id === id);
        if (!sheet) return null;
        const sheetData = rowsForSource(id);
        const { expiredCount, expiringThisMonthCount } = getExpirationStats(sheetData);
        const statusObj = getUpdateStatus(sheet.lastUpdateTime);
        const description = describeSheetName(sheet.name);
        const code = codeForSheet(id);
        const type = getSheetType(sheet.name);
        const isMismatch = !datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime);
        const syncRecord = supabaseSyncs[id];

        return {
          id: sheet.id,
          name: description,
          code: code || "",
          type:
            type === "CS"
              ? "Centro de Salud"
              : type === "PS"
              ? "Puesto de Salud"
              : type === "ALM"
              ? "Almacén"
              : type === "HOSP"
              ? "Hospital"
              : "Establecimiento",
          lastUpdateTime: sheet.lastUpdateTime,
          equipmentDateTime: sheet.equipmentDateTime,
          expiredCount,
          expiringThisMonthCount,
          totalItems: sheetData.length,
          syncStatusLabel: statusObj.label,
          syncStatusColor: statusObj.color,
          isMismatchEquipmentDate: isMismatch,
          syncRecordDate: getLastMovementDate(syncRecord),
          hasSyncRecord: !!syncRecord,
        };
      })
      .filter(Boolean) as SelectedEstablishmentData[];
  }, [selectedCaptureIds, sources, data, supabaseSyncs]);

  const activeCaptureUngetName = useMemo(() => {
    if (selectedUngetIndex !== null && scriptUrls[selectedUngetIndex]) {
      return formatDisplayName(scriptUrls[selectedUngetIndex].name);
    }
    return "Jurisdicción Regional";
  }, [selectedUngetIndex, scriptUrls]);

  const establishmentSummary = useMemo(() => {
    if (viewLevel !== "sheets" || selectedUngetIndex === null) return null;

    const filteredSources = sources.filter((s) => {
      if (s.urlIndex !== selectedUngetIndex) return false;
      if (!sheetSearchTerm) return true;

      const term = sheetSearchTerm.toLowerCase();
      const description = describeSheetName(s.name);
      const code = codeForSheet(s.id);

      return (
        description.toLowerCase().includes(term) ||
        code.toLowerCase().includes(term)
      );
    });

    const counts = {
      cs: 0,
      ps: 0,
      alm: 0,
      hosp: 0,
      total: 0,
      online: 0,
      delayed: 0,
      offline: 0,
    };
    filteredSources.forEach((s) => {
      const name = s.name.toUpperCase();
      if (name.includes("C.S.") || name.includes("CENTRO DE SALUD"))
        counts.cs++;
      else if (name.includes("P.S.") || name.includes("PUESTO DE SALUD"))
        counts.ps++;
      else if (name.includes("ALM") || name.includes("ALMACEN")) counts.alm++;
      else if (name.includes("HOSP") || name.includes("HOSPITAL"))
        counts.hosp++;

      counts.total++;
      const status = getUpdateStatus(s.lastUpdateTime).color;
      if (status === "bg-emerald-500") counts.online++;
      else if (status === "bg-amber-500") counts.delayed++;
      else counts.offline++;
    });

    return counts;
  }, [viewLevel, selectedUngetIndex, sources, sheetSearchTerm, data]);

  const sortedReportSources = useMemo(() => {
    return [...filteredAndSortedSources].sort((a, b) => {
      const orderMult = reportSort.order === "asc" ? 1 : -1;
      if (reportSort.field === "name") {
        return a.name.localeCompare(b.name) * orderMult;
      } else if (reportSort.field === "date") {
        const dateA = a.lastUpdateTime || 0;
        const dateB = b.lastUpdateTime || 0;
        return (dateA - dateB) * orderMult;
      } else if (reportSort.field === "status") {
        const statusOrder = {
          "bg-emerald-500": 1,
          "bg-amber-500": 2,
          "bg-red-500": 3,
          "bg-gray-400": 4,
        };
        const colorA = getUpdateStatus(a.lastUpdateTime).color;
        const colorB = getUpdateStatus(b.lastUpdateTime).color;
        const statusA = (statusOrder as any)[colorA] || 5;
        const statusB = (statusOrder as any)[colorB] || 5;
        if (statusA !== statusB) {
          return (statusA - statusB) * orderMult;
        }
        return ((a.lastUpdateTime || 0) - (b.lastUpdateTime || 0)) * orderMult;
      }
      return 0;
    });
  }, [filteredAndSortedSources, reportSort]);

  return (
    <div
      className={`flex flex-col h-full transition-all duration-300 ${isAdvancedFiltersSidebarOpen && viewLevel === "sheets" ? "md:pr-[380px] xl:pr-[420px]" : ""}`}
    >
      {/* Minimalist Top Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center px-4 sm:px-10 lg:px-14 xl:px-16 py-4 sm:py-8 gap-4 sm:gap-6">
        {/* Left Side: Title & KPIs underneath */}
        <div className="w-full xl:w-auto flex flex-col gap-3 sm:gap-4 overflow-hidden">
          {/* Title */}
          <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2 sm:gap-2.5">
            <Database className="h-5 w-5 text-teal-600 shrink-0" />
            <span className="truncate">Reporte de Stock detallado SISMED</span>
          </h2>

          {/* Connection KPIs (Cards) */}
          {(() => {
            if (viewLevel === "data") {
              return (
                <div className="flex flex-row items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar w-full justify-start pb-1 animate-in fade-in duration-200">
                  {/* Total Productos */}
                  <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                    <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
                      <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-600" />
                    </div>
                    <div className="flex flex-col justify-center gap-0.5 pr-2">
                      <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                        {filteredData.length}
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-bold text-teal-600 leading-none uppercase">
                        Lotes
                      </span>
                    </div>
                  </div>

                  {/* Por Vencer */}
                  <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                    <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-amber-50 flex items-center justify-center shrink-0 border border-amber-100/50">
                      <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600" />
                    </div>
                    <div className="flex flex-col justify-center gap-0.5 pr-2">
                      <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                        {filteredDataExpirationInfo.expiringThisMonthCount}
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-bold text-amber-600 leading-none uppercase">
                        Por Vencer
                      </span>
                    </div>
                  </div>

                  {/* Vencidos */}
                  <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                    <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-red-50 flex items-center justify-center shrink-0 border border-red-100/50">
                      <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500" />
                    </div>
                    <div className="flex flex-col justify-center gap-0.5 pr-2">
                      <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                        {filteredDataExpirationInfo.expiredCount}
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-bold text-red-500 leading-none uppercase">
                        Vencidos
                      </span>
                    </div>
                  </div>
                </div>
              );
            }

            const currentSummary =
              viewLevel === "sheets"
                ? establishmentSummary
                : viewLevel === "ungets"
                  ? globalUngetSummary
                  : null;
            if (!currentSummary) return null;
            return (
              <div className="flex flex-row items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar w-full justify-start pb-1">
                {/* En Línea */}
                <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
                    <Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-600" />
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 pr-2">
                    <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                      {currentSummary.online}
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-bold text-teal-600 leading-none uppercase">
                      En Línea
                    </span>
                  </div>
                </div>

                {/* Desconectados */}
                <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-amber-50 flex items-center justify-center shrink-0 border border-amber-100/50">
                    <FileClock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600" />
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 pr-2">
                    <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                      {currentSummary.delayed}
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-bold text-amber-600 leading-none uppercase">
                      Desconectados
                    </span>
                  </div>
                </div>

                {/* Fuera de Línea */}
                <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-red-50 flex items-center justify-center shrink-0 border border-red-100/50">
                    <WifiOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500" />
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 pr-2">
                    <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                      {currentSummary.offline}
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-bold text-red-500 leading-none uppercase">
                      Fuera Línea
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right Side: Navigation Breadcrumbs (top-right) + Action Buttons (bottom-right) */}
        <div className="flex flex-col gap-3 sm:gap-4 w-full xl:w-auto items-start xl:items-end justify-start overflow-hidden">
          {/* Navigation Tabs (Breadcrumbs) aligned to the right */}
          <div className="flex items-center text-[10px] sm:text-[12px] font-bold text-slate-500 overflow-x-auto hide-scrollbar shrink-0 uppercase tracking-widest gap-1 self-stretch xl:self-auto justify-start xl:justify-end pb-1 sm:pb-0">
            {/* Con una sola UNGET a la vista no hay panel al que volver, así que la
                migaja empieza directamente en su nombre. */}
            {hayPanelRegional && (
            <button
              onClick={() => {
                setViewLevel("ungets");
                setSelectedUngetIndex(null);
                setSelectedSourceId("");
              }}
              className={`flex items-center gap-1.5 sm:gap-2 transition-colors shrink-0 ${viewLevel === "ungets" ? "text-teal-600 font-black" : "hover:text-slate-800"}`}
            >
              <Building2
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${viewLevel === "ungets" ? "text-teal-600" : "text-slate-400"}`}
              />
              <span
                className={
                  viewLevel === "ungets" ? "font-black text-teal-600" : ""
                }
              >
                PANEL REGIONAL
              </span>
            </button>
            )}

            {selectedUngetIndex !== null && (
              <>
                {hayPanelRegional && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-350 mx-0.5 sm:mx-1 shrink-0" />
                )}
                <button
                  onClick={() => {
                    setViewLevel("sheets");
                    setSelectedSourceId("");
                  }}
                  className={`flex items-center gap-1.5 sm:gap-2 transition-colors shrink-0 ${viewLevel === "sheets" ? "text-teal-600 font-black" : "hover:text-slate-800"}`}
                >
                  <FileSpreadsheet
                    className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${viewLevel === "sheets" ? "text-teal-600" : "text-slate-400"}`}
                  />
                  <span
                    className={`truncate max-w-[120px] sm:max-w-[150px] md:max-w-[200px] ${viewLevel === "sheets" ? "font-black text-teal-600" : ""}`}
                  >
                    {formatDisplayName(scriptUrls[selectedUngetIndex]?.name || "Documento")}
                  </span>
                </button>
              </>
            )}

            {selectedSourceId && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-350 mx-0.5 sm:mx-1 shrink-0" />
                <div className="flex items-center gap-1.5 sm:gap-2 text-teal-600 shrink-0">
                  <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-500" />
                  <span className="font-black truncate max-w-[120px] sm:max-w-[150px] md:max-w-[250px]">
                    {(() => {
                      const name =
                        sources.find((s) => s.id === selectedSourceId)?.name ||
                        "Hoja";
                      const desc = describeSheetName(name);
                      const code = selectedSourceId
                        ? codeForSheet(selectedSourceId)
                        : "";
                      return code ? `${desc} (${code})` : desc;
                    })()}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Action Buttons underneath breadcrumbs */}
          <div className="flex items-center gap-2 sm:gap-2.5 w-full md:w-auto overflow-x-auto pb-1 sm:pb-0 hide-scrollbar justify-start xl:justify-end shrink-0">
            {canManageConfigs && (
              <button
                onClick={() => {
                  if (user) {
                    setTempUrls([...scriptUrls]);
                  }
                  setIsConfigOpen(!isConfigOpen);
                }}
                className="bg-white border border-slate-200 text-slate-700 px-3 py-2 sm:px-4 sm:py-2.5 rounded-full font-bold text-xs sm:text-sm hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-1.5 sm:gap-2 shadow-sm whitespace-nowrap shrink-0"
              >
                <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-500" />
                Configurar
              </button>
            )}
            <button
              id="sync-btn"
              onClick={() => fetchData()}
              disabled={isLoading || isSilentSyncing}
              className="flex-1 sm:flex-none bg-teal-600 text-white px-4 py-2 sm:py-2.5 rounded-full font-bold text-xs sm:text-sm hover:bg-teal-700 hover:shadow-md transition-all disabled:opacity-50 disabled:hover:shadow-none flex items-center justify-center gap-1.5 sm:gap-2 shadow-sm whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isLoading || isSilentSyncing ? "animate-spin" : ""}`}
              />
              {isLoading
                ? "Sincronizando..."
                : isSilentSyncing
                  ? "Verificando..."
                  : "Sincronizar"}
            </button>
          </div>
        </div>
      </div>

      {isConfigOpen && canManageConfigs && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
            {/* Header Modal */}
            <div className="px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between bg-slate-900 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-500/15 rounded-xl flex items-center justify-center text-teal-400 shadow-inner">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base sm:text-lg uppercase tracking-tight">
                    Conexiones de stock
                  </h3>
                  <p className="text-[10px] sm:text-xs text-slate-400 font-medium tracking-tight mt-0.5">
                    Vincule la hoja de cálculo de su UNGET
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsConfigOpen(false);
                  setEditingIndex(null);
                  setNewUrlInput("");
                  setNewNameInput("");
                }}
                className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/70">
              {(() => {
                const role = user?.role || "";
                const r = role.toUpperCase();
                const isAdminOrRegional =
                  r === "ADMIN" ||
                  r === "GLOBAL" ||
                  r.includes("SUPER") ||
                  r.includes("GENERAL") ||
                  r === "ADMINISTRADOR" ||
                  r.includes("DIRESA") ||
                  r.includes("OGESS");


                return (
                  <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2 max-w-7xl mx-auto">
                    {/* Dos columnas: a la izquierda se da de alta la conexión y a la derecha se
                        ven las que ya hay, en vez de una debajo de la otra con la mitad del
                        ancho en blanco. */}
                    {/* ---------- ROW 1: EQUAL HEIGHTS HEADER PANEL ---------- */}
                    <div className="font-sans">
                      {/* Tarjeta: añadir o editar una conexión */}
                      <div>
                        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm h-full flex flex-col justify-between">
                          <div>
                        <h4 className="text-xs sm:text-sm font-black text-gray-800 mb-4 sm:mb-5 flex items-center gap-2 uppercase tracking-tight">
                          <Plus
                            className={`h-5 w-5 ${editingIndex !== null ? "text-amber-500" : "text-teal-600"}`}
                          />
                          {editingIndex !== null ? "Editar conexión" : "Nueva conexión"}
                        </h4>

                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-4">
                            {/* A quien es de una UNGET no se le pregunta cuál: el campo solo
                                repetía su propio nombre y no se podía cambiar. */}
                            {!isUngetRole && (
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 ml-1 uppercase tracking-wider">
                                UNGET
                              </label>
                              {editingIndex !== null ? (
                                <input
                                  type="text"
                                  placeholder="Ej: UNGET CENTRO"
                                  value={(() => {
                                    const matching = allUngets.find(u => String(u.id) === newNameInput || u.name === newNameInput);
                                    return matching ? matching.name : newNameInput;
                                  })()}
                                  disabled
                                  className="w-full text-xs sm:text-sm rounded-lg border border-gray-200 bg-gray-100 cursor-not-allowed shadow-sm py-2.5 px-3 font-bold text-gray-400"
                                />
                              ) : availableUngetsForConfig.length === 0 ? (
                                <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/50 rounded-lg px-3 py-2 font-bold min-h-[42px] leading-tight flex items-center justify-center">
                                  Todas las UNGETs de su jurisdicción ya están configuradas.
                                </div>
                              ) : (
                                /* El selector del kit: trae buscador en cuanto hay más de cinco
                                   opciones, que es lo que hacía falta con tantas UNGET. */
                                <CustomSelect
                                  value={newNameInput}
                                  onChange={setNewNameInput}
                                  placeholder="Seleccionar UNGET..."
                                  ariaLabel="UNGET de la conexión"
                                  className="h-[42px] text-xs sm:text-sm"
                                  options={availableUngetsForConfig.map((unget: any) => {
                                    const diresa = allDiresas.find(d => String(d.id) === String(unget.diresaId))?.name || "";
                                    const ogess = allOgess.find(o => String(o.id) === String(unget.ogessId))?.name || "";
                                    const locationTag = [diresa, ogess].filter(Boolean).join(" - ");
                                    return {
                                      value: unget.id,
                                      label: `${unget.name}${locationTag ? ` (${locationTag})` : ""}`,
                                    };
                                  })}
                                />
                              )}
                            </div>
                            )}
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 ml-1 uppercase tracking-wider">
                                Enlace de la hoja de cálculo
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="url"
                                  placeholder="https://docs.google.com/spreadsheets/d/..."
                                  value={newSpreadsheetInput}
                                  onChange={(e) => {
                                    setNewSpreadsheetInput(e.target.value);
                                    setSpreadsheetCheck(null);
                                  }}
                                  className="flex-1 min-w-0 text-[10px] sm:text-xs rounded-lg border border-slate-300 focus:border-teal-600 focus:ring-teal-600 shadow-sm py-2.5 px-3 font-mono bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={handleCheckSpreadsheet}
                                  disabled={isCheckingSpreadsheet || !newSpreadsheetInput.trim()}
                                  className="px-3 py-2.5 rounded-lg border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 hover:border-slate-400 disabled:opacity-50 font-black text-[10px] uppercase tracking-wider transition-all shrink-0"
                                >
                                  {isCheckingSpreadsheet ? "Probando..." : "Probar"}
                                </button>
                              </div>
                              {spreadsheetCheck && (
                                <p
                                  className={`text-[9px] font-bold ml-1 flex items-start gap-1 ${spreadsheetCheck.ok ? "text-emerald-600" : "text-amber-600"}`}
                                >
                                  {spreadsheetCheck.ok ? (
                                    <CheckCircle2 className="h-3 w-3 shrink-0 mt-px" />
                                  ) : (
                                    <AlertCircle className="h-3 w-3 shrink-0 mt-px" />
                                  )}
                                  {spreadsheetCheck.message}
                                </p>
                              )}
                              <p className="text-[9px] text-gray-400 ml-1 font-medium">
                                Comparta la hoja como "Cualquiera con el enlace: Lector".{" "}
                                <button
                                  type="button"
                                  onClick={() => setIsShareHelpOpen(true)}
                                  className="text-teal-600 font-black hover:underline"
                                >
                                  Cómo se hace
                                </button>
                              </p>
                            </div>
                            {/* La Web App es respaldo: se pliega para no confundir a quien configura por primera vez. */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setIsWebAppSectionOpen(!isWebAppSectionOpen)}
                                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-100/70 transition-colors"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <ChevronRight
                                    className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${isWebAppSectionOpen ? "rotate-90" : ""}`}
                                  />
                                  <span className="min-w-0">
                                    <span className="block text-[10px] sm:text-xs font-black text-slate-700 uppercase tracking-tight">
                                      Web App de Apps Script
                                    </span>
                                    <span className="block text-[9px] text-slate-400 font-medium">
                                      Opcional · solo si la hoja no se puede compartir
                                    </span>
                                  </span>
                                </span>
                                {newUrlInput.trim() && !isWebAppSectionOpen && (
                                  <span className="text-[8px] font-black text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                                    Configurada
                                  </span>
                                )}
                              </button>
                              {isWebAppSectionOpen && (
                                <div className="px-3 pb-3 space-y-2">
                                  <input
                                    type="url"
                                    placeholder="https://script.google.com/..."
                                    value={newUrlInput}
                                    onChange={(e) => setNewUrlInput(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
                                    className="w-full text-[10px] sm:text-xs rounded-lg border border-slate-300 focus:border-teal-600 focus:ring-teal-600 shadow-sm py-2.5 px-3 font-mono bg-white"
                                  />
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[9px] text-slate-400 font-medium">
                                      Con la hoja configurada, la Web App solo se usa como respaldo.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setIsInstructionModalOpen(true)}
                                      className="text-[9px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-700 shrink-0 flex items-center gap-1"
                                    >
                                      Ver guía paso a paso
                                      <ArrowRight className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
                            <button
                              onClick={handleAddUrl}
                              className={`w-full sm:w-auto px-8 py-2.5 rounded-lg text-white font-black text-[10px] sm:text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 ${editingIndex !== null ? "bg-amber-500 shadow-amber-500/20 hover:bg-amber-600 hover:shadow-amber-600/30" : "bg-teal-600 shadow-teal-600/20 hover:bg-teal-700 hover:shadow-teal-700/30"}`}
                            >
                              {editingIndex !== null ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Plus className="h-3.5 w-3.5" />
                              )}
                              {editingIndex !== null
                                ? "Actualizar en Lista"
                                : "Añadir a Lista"}
                            </button>
                            {editingIndex !== null && (
                              <button
                                onClick={() => {
                                  setEditingIndex(null);
                                  setNewUrlInput("");
                                  setNewNameInput("");
                                  setNewSpreadsheetInput("");
                                  setSpreadsheetCheck(null);
                                }}
                                className="w-full sm:w-auto px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-all font-bold text-[10px] sm:text-xs uppercase tracking-wider"
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                  </div>

                  {/* ---------- ROW 2: CONNECTIONS & JURISDICTION ---------- */}
                  <div className="lg:relative animate-in fade-in slide-in-from-bottom-4 duration-300">
                    {/* Card: Lista de conexiones.

                        En pantalla ancha va en posición absoluta a propósito: así no aporta
                        altura a la fila, que queda marcada por el formulario de la izquierda,
                        y la lista se desplaza por dentro en vez de alargar el modal. */}
                    <div className="lg:absolute lg:inset-0">
                      <div
                        className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col h-full min-h-[320px] lg:min-h-0"
                      >
                        <div className="flex flex-wrap gap-2 justify-between items-center mb-4 shrink-0">
                          <h4 className="text-[10px] sm:text-xs font-black text-gray-400 uppercase tracking-widest">
                            CONEXIONES CONFIGURADAS (
                            {tempUrls.length})
                          </h4>
                          {typeof maxUrlsAllowed === "number" && maxUrlsAllowed > 0 ? (
                            <span className="text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-100 px-2.5 py-1 rounded-full uppercase tracking-widest shrink-0">
                              Límite de URLs: {maxUrlsAllowed}
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-2.5 flex-1 min-h-0 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar">
                          {/* Map own URLs */}
                          {tempUrls.length > 0 ? (
                            tempUrls.map((config, idx) => {
                            // Misma regla que en las tarjetas: la conexión de otra cuenta
                            // se ve, con su etiqueta de quién la mantiene, pero no se toca.
                            const esConexionPropia = canEditConnection(config, user?.username, cuentasActivas);
                            return (
                              <div
                                key={idx}
                                className={`group relative flex gap-2 sm:gap-3 items-center border p-3 rounded-lg transition-all duration-200 shadow-sm ${
                                  editingIndex === idx
                                    ? "border-amber-400 bg-amber-50/40 shadow-md shadow-amber-500/5"
                                    : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md hover:shadow-slate-500/5"
                                }`}
                              >
                                <div
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${
                                    editingIndex === idx
                                      ? "bg-amber-100 text-amber-600 border border-amber-200/50"
                                      : "bg-slate-50 border border-slate-100 text-slate-400"
                                  }`}
                                >
                                  <LinkIcon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0 pr-1">
                                  <div className="text-[10px] sm:text-xs font-black text-slate-800 truncate uppercase mt-0.5 tracking-tight flex items-center gap-1.5 flex-wrap">
                                    {(() => {
                                      const configNorm = normalizeName(config.name);
                                      const matching = allUngets.find((u) => 
                                        (config.ungetId && String(u.id) === String(config.ungetId)) || 
                                        u.name === config.name || 
                                        normalizeName(u.name) === configNorm
                                      );
                                      const nameStr = formatDisplayName(matching ? matching.name : config.name);
                                      const ungetSlug = matching?.id ? `UNG-${matching.id.substring(0, 5).toUpperCase()}` : "";
                                      return (
                                        <>
                                          <span className="truncate">{nameStr}</span>
                                          {ungetSlug && (
                                            <span className="text-[8px] font-black text-teal-600 bg-teal-50/70 border border-teal-100 px-1 py-0.5 rounded leading-none shrink-0 scale-95 origin-left">
                                              {ungetSlug}
                                            </span>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                  <div className="text-[8.5px] sm:text-[9.5px] text-slate-400 truncate font-mono mt-1 flex items-center gap-1 border-b border-transparent group-hover:border-slate-100 pb-0.5 max-w-[240px] md:max-w-xs xl:max-w-none">
                                    {describeConfigUrl(config)}
                                  </div>
                                  {config.spreadsheetId ? (
                                    <div className="text-[8px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-100/60 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 uppercase tracking-tight mt-1.5">
                                      <CheckCircle2 className="h-2 w-2 text-emerald-500 shrink-0" />
                                      Lectura directa
                                    </div>
                                  ) : hasWebApp(config) ? (
                                    <div
                                      className="text-[8px] font-extrabold text-amber-700 bg-amber-50 border border-amber-100/60 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 uppercase tracking-tight mt-1.5"
                                      title="Configure la hoja de cálculo para leer sin Apps Script."
                                    >
                                      <AlertTriangle className="h-2 w-2 text-amber-500 shrink-0" />
                                      Solo Apps Script
                                    </div>
                                  ) : (
                                    <div className="text-[8px] font-extrabold text-slate-500 bg-slate-100 border border-slate-200/60 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 uppercase tracking-tight mt-1.5">
                                      <AlertCircle className="h-2 w-2 text-slate-400 shrink-0" />
                                      Sin hoja configurada
                                    </div>
                                  )}
                                  {connectionErrors[config.url] && (
                                    <div
                                      className="text-[8px] font-extrabold text-red-600 bg-red-50 border border-red-100/60 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 uppercase tracking-tight mt-1.5"
                                      title={connectionErrors[config.url]}
                                    >
                                      <AlertCircle className="h-2 w-2 text-red-400 shrink-0" />
                                      {getGasErrorLabel(connectionErrors[config.url]).label}
                                    </div>
                                  )}
                                  {isConnectionOrphaned(config, cuentasActivas) ? (
                                    <div className="text-[8px] font-extrabold text-amber-800 bg-amber-50 border border-amber-200/70 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 uppercase tracking-tight mt-1.5">
                                      <AlertCircle className="h-2 w-2 text-amber-500 shrink-0" />
                                      Sin responsable ({config.username} ya no está activo)
                                    </div>
                                  ) : (
                                    config.username &&
                                    config.username !== user?.username && (
                                      <div className="text-[8px] font-extrabold text-teal-700 bg-teal-50 border border-teal-100/60 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 uppercase tracking-tight mt-1.5">
                                        <CheckCircle2 className="h-2 w-2 text-teal-500" />
                                        Heredado de la Jurisdicción ({config.username})
                                      </div>
                                    )
                                  )}
                                </div>
                                {esConexionPropia ? (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleEditUrl(idx, e)}
                                    className={`p-1.5 sm:p-2 rounded-lg border transition-all ${
                                      editingIndex === idx
                                        ? "border-amber-200 text-amber-600 bg-amber-50/50 shadow-sm"
                                        : "border-slate-100 bg-slate-50 text-slate-400 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-600 hover:shadow-sm"
                                    }`}
                                    title="Editar Origen"
                                  >
                                    <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveUrl(idx)}
                                    className="p-1.5 sm:p-2 border border-slate-100 bg-slate-50 text-slate-400 hover:border-red-200 hover:bg-red-50/50 hover:text-red-500 rounded-lg transition-all hover:shadow-sm"
                                    title="Eliminar Origen"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                  </button>
                                </div>
                                ) : (
                                  <div
                                    className="shrink-0 p-1.5 sm:p-2 text-slate-300"
                                    title={`Solo ${connectionOwner(config)} puede modificar esta conexión`}
                                  >
                                    <Lock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                  </div>
                                )}
                              </div>
                            );
                            })
                          ) : (
                            <div className="py-8 sm:py-10 text-center bg-slate-50/80 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center">
                              <div className="w-10 h-10 bg-white rounded-lg shadow-sm border border-slate-100 flex items-center justify-center mb-3">
                                <LinkIcon className="h-5 w-5 text-slate-300" />
                              </div>
                              <h4 className="text-[10px] sm:text-xs font-black text-slate-400 uppercase tracking-widest">
                                Todavía no hay conexiones
                              </h4>
                              <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium max-w-[200px] mt-1.5 leading-relaxed">
                                Añada la primera arriba, con el enlace de su hoja.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                </div>
              </div>
                );
              })()}
            </div>

            {/* Footer Modal */}
            <div className="px-5 py-4 sm:px-6 border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 sticky bottom-0 z-10">
              <button
                onClick={() => {
                  setIsConfigOpen(false);
                  setEditingIndex(null);
                }}
                className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors whitespace-nowrap"
              >
                Cerrar sin guardar
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={isLoading}
                className="w-full sm:w-auto bg-teal-600 text-white px-6 sm:px-8 py-2.5 rounded-lg text-sm font-black hover:bg-teal-700 transition-all shadow-lg shadow-teal-600/20 flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
              >
                <Save className="h-4 w-4 shrink-0" />
                <span className="sm:hidden">GUARDAR Y SINCRONIZAR</span>
                <span className="hidden sm:inline">GUARDAR Y SINCRONIZAR CAMBIOS</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMACIÓN DE ELIMINAR UNA CONEXIÓN
          Retirar la conexión de una UNGET deja a sus establecimientos sin stock hasta que
          alguien la vuelva a configurar, así que va por el diálogo del kit y no por un
          aviso flotante, que se cierra solo y se pulsa sin leer (AGENTS.md §8). */}
      <ConfirmationDialog
        isOpen={!!conexionAEliminar}
        tone="danger"
        title="¿Eliminar esta conexión?"
        description={
          conexionAEliminar
            ? `Se retirará la hoja de cálculo de ${formatDisplayName(conexionAEliminar.config.name)}. Sus establecimientos dejarán de ver stock hasta que se configure otra vez.`
            : ""
        }
        confirmLabel="Sí, eliminar"
        cancelLabel="Cancelar"
        isConfirming={isDeletingConnection}
        onConfirm={confirmarEliminarConexion}
        onCancel={() => {
          if (!isDeletingConnection) setConexionAEliminar(null);
        }}
      />

      {/* MODAL RÁPIDO DE CORRECCIÓN / PRUEBA DE ENLACE DE UNGET */}
      {quickFixConfig && (
        <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl overflow-hidden rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col border border-slate-200">
            {/* Header */}
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-teal-50/60 to-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
                  <LinkIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
                    {quickFixEsAjena ? "Probar Enlace Web App" : "Configurar Enlace Web App"}
                  </h3>
                  <div className="text-xs font-bold text-teal-700 uppercase tracking-wide flex items-center gap-1.5 mt-0.5">
                    <Building2 className="h-3.5 w-3.5 text-teal-500" />
                    UNGET: {quickFixConfig.name}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickFixConfig(null)}
                className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-all border border-transparent hover:border-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 sm:p-6 space-y-4">
              {quickFixEsAjena && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <div className="font-extrabold uppercase tracking-tight text-[11px]">
                      Conexión de otra cuenta
                    </div>
                    <div className="mt-0.5 font-medium">
                      La mantiene <span className="font-black">{connectionOwner(quickFixConfig)}</span>, el
                      informático de esta UNGET, y solo esa cuenta puede cambiar su enlace. Desde aquí
                      sí puede probarla para saber por qué no conecta.
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-2">
                  URL de la Web App de Google Apps Script (*.exec)
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={quickFixUrlInput}
                    onChange={(e) => {
                      setQuickFixUrlInput(e.target.value);
                      setGasTestResult(null);
                    }}
                    readOnly={quickFixEsAjena}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className={`w-full rounded-lg border px-3.5 py-2.5 text-xs font-mono outline-none transition-all shadow-inner ${
                      quickFixEsAjena
                        ? "bg-slate-100 border-slate-200 text-slate-500 cursor-default"
                        : "bg-slate-50 border-slate-300 focus:border-teal-500 focus:bg-white text-slate-800 placeholder-slate-400"
                    }`}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 font-medium leading-relaxed">
                  Asegúrese de que el enlace termine en <code className="bg-slate-100 text-teal-700 px-1 py-0.5 rounded font-bold font-mono text-[10px]">/exec</code> y tenga permisos de acceso configurados en <span className="font-bold text-slate-700">"Cualquier usuario"</span> (Anyone).
                </p>
              </div>

              {/* Botón de prueba de conexión en vivo */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestQuickFixUrl}
                  disabled={isTestingGasUrl || !quickFixUrlInput.trim()}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-extrabold rounded-lg transition-all flex items-center gap-2 border border-slate-200/80 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isTestingGasUrl ? "animate-spin text-teal-600" : ""}`} />
                  {isTestingGasUrl ? "Probando conexión con Google..." : "Probar Conexión Ahora"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsInstructionModalOpen(true)}
                  className="text-xs text-teal-700 hover:text-teal-800 font-bold underline flex items-center gap-1"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  ¿Cómo obtenerla?
                </button>
              </div>

              {/* Resultado de la prueba */}
              {gasTestResult && (
                <div
                  className={`p-3.5 rounded-lg border text-xs leading-relaxed animate-in fade-in duration-200 ${
                    gasTestResult.success
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {gasTestResult.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="font-extrabold uppercase tracking-tight text-[11px]">
                        {gasTestResult.success ? "Conexión Exitosa" : "Fallo de Conexión"}
                      </div>
                      <div className="text-xs mt-0.5 font-medium">{gasTestResult.message}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setQuickFixConfig(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all"
              >
                {quickFixEsAjena ? "Cerrar" : "Cancelar"}
              </button>
              {!quickFixEsAjena && (
              <button
                type="button"
                onClick={handleSaveQuickFixUrl}
                disabled={isSavingGasUrl || !quickFixUrlInput.trim()}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-xs font-extrabold rounded-lg shadow-md shadow-teal-600/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Save className="h-4 w-4" />
                {isSavingGasUrl ? "Guardando..." : "Guardar y Conectar"}
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* INSTRUCTIONS MODAL */}
      {/* Cómo compartir la hoja. Antes se desplegaba dentro del formulario y empujaba
          todo hacia abajo, con los pasos en letra diminuta. */}
      {isShareHelpOpen && (
        <div
          className="fixed inset-0 z-[10000000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setIsShareHelpOpen(false)}
        >
          <div
            className="bg-white w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 sm:px-6 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-500/15 rounded-xl flex items-center justify-center text-teal-400 shrink-0">
                  <Share2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base uppercase tracking-tight">
                    Compartir la hoja
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                    Tres pasos en Google Sheets
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsShareHelpOpen(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ol className="p-5 sm:p-6 space-y-3.5">
              {[
                <>Abra su hoja en Google Sheets y pulse <strong className="font-black text-slate-900">Compartir</strong>.</>,
                <>En <strong className="font-black text-slate-900">Acceso general</strong>, elija <strong className="font-black text-slate-900">Cualquiera con el enlace</strong> y déjelo como <strong className="font-black text-slate-900">Lector</strong>.</>,
                <>Pulse <strong className="font-black text-slate-900">Copiar enlace</strong>, péguelo en el campo y use <strong className="font-black text-slate-900">Probar</strong>.</>,
              ].map((paso, i) => (
                <li key={i} className="flex gap-3.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-[11px] font-black text-white">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-relaxed text-slate-600 pt-0.5">{paso}</span>
                </li>
              ))}
            </ol>

            <div className="px-5 py-4 sm:px-6 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500 leading-snug">
                Con «Lector» nadie puede modificar su hoja: solo se lee el stock.
              </p>
              <button
                type="button"
                onClick={() => setIsShareHelpOpen(false)}
                className="shrink-0 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-700"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {isInstructionModalOpen && (
        <div className="fixed inset-0 z-[10000000] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl overflow-hidden rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col border border-white/20">
            {/* Header Modal with Gradient */}
            <div className="p-6 sm:p-8 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 text-white relative flex items-center justify-between overflow-hidden">
              <div className="absolute right-0 top-0 opacity-10 pointer-events-none transform translate-x-10 -translate-y-10">
                <HelpCircle className="w-48 h-48" />
              </div>
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center text-blue-50 backdrop-blur-sm border border-white/20">
                  <HelpCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-black text-white text-lg sm:text-xl uppercase tracking-tight">
                    ¿Cómo obtener la URL?
                  </h3>
                  <p className="text-xs sm:text-sm text-blue-100 font-medium tracking-tight mt-1">
                    Guía de conexión paso a paso para Google Apps Script
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsInstructionModalOpen(false)}
                className="p-2.5 sm:p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white active:scale-95 relative z-10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 sm:p-8 overflow-y-auto max-h-[70vh] bg-slate-50/50">
              <div className="space-y-6 text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                <div className="flex gap-4">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0 font-black text-blue-700 text-lg shadow-sm">
                    1
                  </div>
                  <div>
                    <p className="mt-1 sm:mt-1.5 font-bold uppercase tracking-tight text-slate-800">
                      Crear Proyecto
                    </p>
                    <p className="text-slate-500 mt-1">
                      Ingrese a{" "}
                      <a
                        href="https://script.google.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 font-black hover:underline decoration-2"
                      >
                        script.google.com
                      </a>{" "}
                      con la cuenta donde tiene sus archivos Excel (Google
                      Sheets). Cree un "Nuevo Proyecto" y pegue el código
                      adjunto borrando lo que haya.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0 font-black text-blue-700 text-lg shadow-sm">
                    2
                  </div>
                  <div>
                    <p className="mt-1 sm:mt-1.5 font-bold uppercase tracking-tight text-slate-800">
                      Implementar
                    </p>
                    <p className="text-slate-500 mt-1">
                      En la parte superior derecha, haga click en el botón azul{" "}
                      <span className="font-black bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 border border-slate-200/60">
                        Implementar
                      </span>{" "}
                      y luego seleccione{" "}
                      <span className="font-black bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 border border-slate-200/60">
                        Nueva Implementación
                      </span>
                      .
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0 font-black text-blue-700 text-lg shadow-sm">
                    3
                  </div>
                  <div>
                    <p className="mt-1 sm:mt-1.5 font-bold uppercase tracking-tight text-slate-800">
                      Configurar Permisos
                    </p>
                    <p className="text-slate-500 mt-1">
                      En Tipo, haga click en el engranaje "⚙️" y elija{" "}
                      <span className="font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                        Aplicación Web
                      </span>
                      .<br />
                      En la sección Seguridad (Acceso), cambie a{" "}
                      <span className="font-black text-white bg-slate-800 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">
                        Cualquier persona
                      </span>{" "}
                      y presione el botón "Implementar".
                      <br />
                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-2.5 py-1.5 rounded-lg inline-block mt-3 border border-amber-200/50 leading-relaxed shadow-sm">
                        Nota: Al autorizar, Google mostrará una advertencia.
                        Haga click en "Avanzado" e "Ir al proyecto".
                      </span>
                    </p>
                  </div>
                </div>

                <div className="relative mt-8 group">
                  <div className="absolute -top-3 left-6 bg-slate-800 text-[10px] text-white px-3.5 py-1 rounded-full font-black tracking-widest shadow-sm z-10 uppercase">
                    CÓDIGO RECOMENDADO
                  </div>
                  <div className="relative pt-3 border border-slate-200 rounded-xl bg-slate-900 shadow-xl overflow-hidden">
                    <pre className="text-[11px] text-slate-300 p-6 sm:p-8 h-56 overflow-y-auto font-mono scrollbar-thin scrollbar-thumb-slate-700">
                      {scriptCode}
                    </pre>
                    <button
                      onClick={copyScript}
                      className="absolute top-6 right-6 bg-white/10 hover:bg-white/20 p-2.5 rounded-lg text-white backdrop-blur-sm transition-all border border-white/10 flex items-center gap-2 hover:scale-105 active:scale-95"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 text-green-400" />
                          <span className="text-[10px] font-bold text-green-400 tracking-wider">
                            COPIADO
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          <span className="text-[10px] font-bold hidden sm:inline-block tracking-wider">
                            COPIAR SCRIPT
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Modal */}
            <div className="p-5 sm:p-6 border-t border-slate-100 bg-white flex items-center justify-end">
              <button
                onClick={() => setIsInstructionModalOpen(false)}
                className="bg-blue-600 text-white hover:bg-blue-700 px-8 py-3 rounded-lg text-xs sm:text-sm font-black transition-all shadow-md hover:shadow-lg hover:shadow-blue-600/20 active:scale-95 uppercase tracking-wide"
              >
                Entendido, Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 sm:rounded-xl flex items-center gap-2 mb-6 mx-4 sm:mx-10 lg:mx-14 xl:mx-16">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div
        className={`bg-white sm:rounded-[1.25rem] border-y sm:border border-slate-200 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden mx-0 sm:mx-10 lg:mx-14 xl:mx-16 ${viewLevel === "data" ? "h-auto shrink-0 mb-8" : "flex-1 min-h-[300px]"}`}
      >
        {/* TOOLBAR */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-4">
          {/* Search & Actions */}
          <div className="flex flex-col md:flex-row gap-3 items-center justify-between w-full">
            <div className="relative flex-1 w-full md:max-w-[50%] group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none z-10">
                <Search className="h-4 w-4 text-slate-400 group-focus-within:text-teal-600 stroke-[2.5] transition-colors" />
              </div>
              {viewLevel === "ungets" && (
                <div className="relative w-full text-slate-800">
                  <input
                    type="text"
                    placeholder="Buscar UNGET..."
                    value={ungetSearchTerm}
                    onChange={(e) => setUngetSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-12 py-2.5 bg-slate-50/85 md:bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-teal-500 rounded-xl text-sm transition-all focus:outline-none focus:ring-4 focus:ring-teal-500/10 placeholder:text-slate-450 shadow-2xs font-medium text-slate-800"
                  />
                  {ungetSearchTerm && (
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                      <button
                        type="button"
                        onClick={() => setUngetSearchTerm("")}
                        className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors active:scale-95 cursor-pointer"
                        title="Limpiar"
                      >
                        <X className="h-3.5 w-3.5 stroke-[2.5]" />
                      </button>
                    </div>
                  )}
                </div>
              )}
              {viewLevel === "sheets" && (
                <div className="relative w-full text-slate-800">
                  <input
                    type="text"
                    placeholder="Buscar establecimiento por nombre o código..."
                    value={sheetSearchTerm}
                    onChange={(e) => setSheetSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-32 py-2.5 bg-slate-50/85 md:bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-teal-500 rounded-xl text-sm transition-all focus:outline-none focus:ring-4 focus:ring-teal-500/10 placeholder:text-slate-450 shadow-2xs font-medium text-slate-800"
                  />
                  <div className="absolute inset-y-0 right-0 pr-1.5 flex items-center gap-1.5">
                    {sheetSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setSheetSearchTerm("")}
                        className="p-1 hover:bg-slate-100/80 text-slate-400 hover:text-slate-600 rounded-full transition-colors active:scale-95 cursor-pointer flex items-center justify-center"
                        title="Limpiar"
                      >
                        <X className="h-3.5 w-3.5 stroke-[2.5]" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsAdvancedFiltersSidebarOpen(true)}
                      className="flex items-center gap-1.5 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200/80 text-xs font-black transition-all shrink-0 relative shadow-sm cursor-pointer hover:border-slate-300 active:bg-slate-100"
                    >
                      <Filter className="h-3.5 w-3.5 text-teal-600" />
                      <span>Filtros</span>
                      {(!filter_CS ||
                        !filter_PS ||
                        !filter_ALM ||
                        !filter_HOSP ||
                        !filter_OTRO ||
                        !filter_emerald ||
                        !filter_amber ||
                        !filter_red ||
                        !filter_gray ||
                        filterSortOrder !== "name_asc" ||
                        filterHasPendingExpirations ||
                        filterDateValue > 0 ||
                        filterMovementsValue > 0) && (
                        <span className="absolute top-0 right-0 -mr-1 -mt-1 w-2.5 h-2.5 bg-teal-500 rounded-full border-2 border-white animate-pulse" />
                      )}
                    </button>
                  </div>
                </div>
              )}
              {viewLevel === "data" && (
                <div className="relative w-full text-slate-800">
                  <input
                    type="text"
                    placeholder="Buscar medicamento en esta hoja..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-32 py-2.5 bg-slate-50/85 md:bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-teal-500 rounded-xl text-sm transition-all focus:outline-none focus:ring-4 focus:ring-teal-500/10 placeholder:text-slate-450 shadow-2xs font-medium text-slate-800"
                  />
                  <div className="absolute inset-y-0 right-0 pr-1.5 flex items-center gap-1.5">
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm("")}
                        className="p-1 hover:bg-slate-100/80 text-slate-400 hover:text-slate-600 rounded-full transition-colors active:scale-95 cursor-pointer flex items-center justify-center"
                        title="Limpiar"
                      >
                        <X className="h-3.5 w-3.5 stroke-[2.5]" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsAdvancedFiltersSidebarOpen(true)}
                      className="flex items-center gap-1.5 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200/85 text-xs font-black transition-all shrink-0 relative shadow-sm cursor-pointer hover:border-slate-300 active:bg-slate-100"
                    >
                      <Filter className="h-3.5 w-3.5 text-teal-600" />
                      <span>Filtros</span>
                      {(dataFilterTipsum !== "all" ||
                        dataFilterFFinan !== "all" ||
                        dataFilterStock !== "all" ||
                        dataFilterExpiration !== "all") && (
                        <span className="absolute top-0 right-0 -mr-1 -mt-1 w-2.5 h-2.5 bg-teal-500 rounded-full border-2 border-white animate-pulse" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto md:overflow-visible hide-scrollbar shrink-0 pt-1 md:pt-0 md:ml-auto pb-1 relative z-30">
              {viewLevel === "data" && (
                <>
                  {activeSheetExpirationInfo.expiredCount > 0 && (
                    <button
                      onClick={() => {
                        setExpirationModalType("expired");
                        setIsExpirationModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 bg-white hover:bg-red-50 text-red-600 px-3 py-2 rounded-lg border border-red-100 text-xs font-bold transition-all shrink-0 whitespace-nowrap"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-red-500 animate-pulse shrink-0" />
                      <span>
                        {activeSheetExpirationInfo.expiredCount} Vencidos
                      </span>
                    </button>
                  )}
                  {activeSheetExpirationInfo.expiringThisMonthCount > 0 && (
                    <button
                      onClick={() => {
                        setExpirationModalType("expiring");
                        setIsExpirationModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 bg-white hover:bg-amber-50 text-amber-600 px-3 py-2 rounded-lg border border-amber-100 text-xs font-bold transition-all shrink-0 whitespace-nowrap"
                    >
                      <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span>
                        {activeSheetExpirationInfo.expiringThisMonthCount} Por
                        vencer
                      </span>
                    </button>
                  )}
                  <button
                    onClick={exportCurrentSheetToExcel}
                    className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold transition-all shrink-0 whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 text-emerald-600 shrink-0" />{" "}
                    Exportar Stock
                  </button>
                </>
              )}

              {viewLevel === "sheets" && (
                <>
                  {lastGlobalSync && (
                    <div
                      className="flex items-center gap-1.5 bg-slate-50/80 border border-slate-200/80 text-slate-500 px-3 py-2 rounded-xl text-[10px] sm:text-[11px] font-bold transition-all shrink-0 shadow-xs h-full"
                      title="Última comprobación global del sistema"
                    >
                      <RefreshCw className="h-3 w-3 text-slate-400 shrink-0" />
                      <span>
                        Sincronizado:{" "}
                        <span className="font-extrabold text-slate-700">
                          {lastGlobalSync.toLocaleString("es-PE", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </span>
                    </div>
                  )}
                  {/* Button for Exiting Capture Mode (Only visible when isCaptureMode is active) */}
                  {isCaptureMode && (
                    <button
                      type="button"
                      onClick={() => setIsCaptureMode(false)}
                      className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer border whitespace-nowrap bg-gradient-to-r from-rose-600 to-amber-600 text-white border-rose-500 shadow-md ring-2 ring-rose-300"
                      title="Salir del modo de captura de evidencias"
                    >
                      <Camera className="h-4 w-4 shrink-0 text-white animate-pulse" />
                      <span className="hidden sm:inline">Salir de Captura</span>
                      <span className="sm:hidden">Salir</span>
                      {selectedCaptureIds.size > 0 && (
                        <span className="bg-white/20 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full ml-0.5">
                          {selectedCaptureIds.size}
                        </span>
                      )}
                    </button>
                  )}

                  <div className="relative z-30">
                    <button
                      onClick={() =>
                        setIsExportDropdownOpen(!isExportDropdownOpen)
                      }
                      className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold transition-all shrink-0 shadow-sm whitespace-nowrap group cursor-pointer"
                    >
                      <Download className="h-4 w-4 text-emerald-600 shrink-0 transition-transform group-hover:translate-y-0.5" />
                      <span>Exportar Reportes</span>
                      <ChevronDown
                        className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${isExportDropdownOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {isExportDropdownOpen && (
                      <>
                        {/* Overlay screen to close dropdown on click outside */}
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setIsExportDropdownOpen(false)}
                        />
                        {/* Dropdown Card */}
                        <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.05)] z-50 overflow-hidden w-72 divide-y divide-slate-100 py-1 animate-in fade-in slide-in-from-top-2 duration-150 text-left">
                          <button
                            onClick={() => {
                              setIsExportDropdownOpen(false);
                              setIsCaptureMode(true);
                              if (selectedCaptureIds.size === 0) {
                                handleAutoSelectDeficiencies();
                              }
                            }}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-rose-50/50 transition-all text-slate-705 group cursor-pointer"
                          >
                            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                              <Camera className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 leading-tight flex items-center gap-1.5">
                                <span>Foto Reporte Deficiencias</span>
                                <span className="bg-rose-100 text-rose-700 text-[8px] font-black px-1.5 py-0.2 rounded-full">
                                  NUEVO
                                </span>
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium leading-normal">
                                Seleccionar y descargar imagen para WhatsApp
                              </span>
                            </div>
                          </button>

                          <button
                            onClick={() => {
                              setIsExportDropdownOpen(false);
                              exportAllEstablishmentsToExcel();
                            }}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-all text-slate-705 group cursor-pointer"
                          >
                            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                              <Download className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 leading-tight">
                                Exportar Stock
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium leading-normal">
                                Saldos de todos los establecimientos
                              </span>
                            </div>
                          </button>

                          <button
                            onClick={() => {
                              setIsExportDropdownOpen(false);
                              exportReportToExcel();
                            }}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-all text-slate-705 group cursor-pointer"
                          >
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                              <FileSpreadsheet className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 leading-tight">
                                Reporte Actualización
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium leading-normal">
                                Estado y fecha de cambios comprobados
                              </span>
                            </div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {viewLevel === "ungets" &&
                globalUngetSummary &&
                sources.length > 0 && (
                  <button
                    onClick={exportAllUngetsToExcel}
                    className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 px-3 sm:px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold transition-all shrink-0 whitespace-nowrap shadow-sm"
                  >
                    <Download className="h-4 w-4 text-emerald-600 shrink-0" />{" "}
                    Exportar Stock
                  </button>
                )}
            </div>
          </div>
        </div>

        <div
          className={`flex-1 bg-gray-50/30 scrollbar-thin ${viewLevel === "data" ? "overflow-visible" : "overflow-auto"}`}
        >
          {isConfigLoading && scriptUrls.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-teal-600 gap-3 py-20">
              <RefreshCw className="h-10 w-10 animate-spin" />
              <span className="font-bold text-lg">
                Cargando configuración...
              </span>
            </div>
          ) : error && sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto py-20">
              <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
              <h3 className="text-lg font-black text-gray-900 mb-2">
                Error de conexión
              </h3>
              <p className="text-sm text-gray-500 mb-6">{error}</p>
              <button
                onClick={() => fetchData(undefined, true)}
                className="bg-teal-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-teal-700 transition-colors"
              >
                Reintentar Sincronización
              </button>
            </div>
          ) : (
            <div
              className={`p-4 sm:p-6 flex flex-col gap-6 ${viewLevel === "data" ? "pb-4 sm:pb-4" : "pb-32 sm:pb-6"}`}
            >
              {/* LEVEL 1: UNGET CARDS */}
              {viewLevel === "ungets" && (
                <div className="animate-in fade-in zoom-in-95 duration-300">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                    {filteredUngets.length > 0 ? (
                      filteredUngets.map((config, idx) => {
                        // Encontrar el índice original en scriptUrls para las funciones de edición/borrado
                        const originalIdx = scriptUrls.findIndex(
                          (u) => u.url === config.url && u.name === config.name,
                        );
                        const isSupabaseVirtual = config.url === "SUPABASE_NATIVE" || config.url.startsWith("SUPABASE_VIRTUAL_");
                        const ungetSourceCount = sources.filter((s) => s.urlIndex === originalIdx).length;
                        // Apps Script puede tardar 10-40 s en responder: sin tarjetas guardadas y sin
                        // error todavía, la UNGET está conectando, no "vacía".
                        const isConnecting =
                          ungetSourceCount === 0 &&
                          !connectionErrors[config.url] &&
                          (isLoading || isSilentSyncing || !!retryingUrls[config.url]);

                        // Encontrar la UNGET en allUngets para obtener su DIRESA y OGESS asignados
                        const configNorm = normalizeName(config.name);
                        const matchingUnget = allUngets.find((u) => 
                          (config.ungetId && String(u.id) === String(config.ungetId)) || 
                          u.name === config.name || 
                          normalizeName(u.name) === configNorm
                        );
                        let diresaName = "";
                        let ogessName = "";
                        if (matchingUnget) {
                          if (matchingUnget.diresaId) {
                            const foundD = allDiresas.find((d) => d.id === matchingUnget.diresaId);
                            if (foundD) diresaName = foundD.name;
                          }
                          if (matchingUnget.ogessId) {
                            const foundO = allOgess.find((o) => o.id === matchingUnget.ogessId);
                            if (foundO) ogessName = foundO.name;
                          }
                        }

                        // La conexión es de su informático: aquí solo se puede mirar y
                        // probar. Ofrecer «eliminar» era engañar, porque el guardado nunca
                        // retira filas ajenas y la tarjeta reaparecía a la siguiente carga.
                        // La excepción es la conexión sin responsable: esa sí se adopta.
                        const sinResponsable = isConnectionOrphaned(config, cuentasActivas);
                        const esConexionPropia = canEditConnection(config, user?.username, cuentasActivas);

                        return (
                          <div
                            key={idx}
                            onClick={() => handleSelectUnget(originalIdx)}
                            className={`group p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-sm transition-all text-left flex flex-row sm:flex-col items-center sm:items-start gap-4 sm:gap-0 h-full cursor-pointer relative overflow-hidden border ${
                              isSupabaseVirtual
                                ? "bg-gradient-to-b from-white to-slate-50 border-slate-200 hover:bg-white hover:border-teal-500 hover:shadow-md"
                                : "bg-white border-gray-200 hover:shadow-md hover:border-teal-500"
                            }`}
                          >
                            {/* Botones de acción rápidos */}
                            {canManageConfigs && !isSupabaseVirtual && (
                              <div className="absolute top-4 right-4 flex items-center gap-1.5 opacity-100 sm:opacity-60 group-hover:opacity-100 transition-opacity z-10">
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenQuickFix(config, e)}
                                  className="p-1.5 sm:p-2 bg-white/90 backdrop-blur-sm shadow-sm border border-gray-200 rounded-lg text-gray-600 hover:text-teal-700 hover:border-teal-300 transition-all cursor-pointer"
                                  title={
                                    esConexionPropia
                                      ? "Configurar / Probar enlace Web App"
                                      : `Probar el enlace (la mantiene ${connectionOwner(config)})`
                                  }
                                >
                                  <Settings className="h-4 w-4" />
                                </button>
                                {esConexionPropia && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDirectDelete(originalIdx, e);
                                  }}
                                  className="p-1.5 sm:p-2 bg-white/90 backdrop-blur-sm shadow-sm border border-gray-100 rounded-lg text-gray-500 hover:text-red-600 hover:border-red-200 transition-all cursor-pointer"
                                  title="Eliminar conexión"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                                )}
                              </div>
                            )}

                            {isSupabaseVirtual && (
                              <div className="absolute top-4 right-4 z-10">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-100">
                                  UNGET
                                </span>
                              </div>
                            )}

                            <div className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center sm:mb-4 group-hover:bg-teal-600 group-hover:text-white transition-colors ${
                              "bg-teal-50 text-teal-600"
                            }`}>
                              {isSupabaseVirtual ? (
                                <Building2 className="h-6 w-6" />
                              ) : (
                                <Building2 className="h-6 w-6" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0 pr-16 sm:pr-0">
                              {matchingUnget && (
                                <div className="text-[9px] font-black text-teal-600 uppercase tracking-widest leading-none mb-1 sm:mb-1.5 flex items-center gap-1.5 flex-wrap">
                                  <span>CÓDIGO: UNG-{matchingUnget.id.substring(0, 5).toUpperCase()}</span>
                                  {isSupabaseVirtual && (
                                    <span className="text-[7.5px] font-extrabold bg-teal-100 text-teal-800 px-1 py-0.2 rounded uppercase">
                                      Virtual
                                    </span>
                                  )}
                                  {sinResponsable && (
                                    <span
                                      className="text-[7.5px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200/70 px-1 py-0.2 rounded uppercase"
                                      title={`${connectionOwner(config)} ya no está activo. Al guardar esta conexión pasará a su nombre.`}
                                    >
                                      Sin responsable
                                    </span>
                                  )}
                                </div>
                              )}
                              <h3 className="text-sm sm:text-lg font-black text-gray-900 sm:mb-2 group-hover:text-teal-700 transition-colors uppercase tracking-tight truncate sm:whitespace-normal">
                                {formatDisplayName(matchingUnget ? matchingUnget.name : config.name)}
                              </h3>
                              {connectionErrors[config.url] && (
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  {(() => {
                                    const { label, tone } = getGasErrorLabel(connectionErrors[config.url]);
                                    return (
                                      <div
                                        className={`text-[9px] font-black px-2 py-0.5 rounded-md border inline-flex items-center gap-1 uppercase ${
                                          tone === "warning"
                                            ? "bg-amber-50 text-amber-700 border-amber-200"
                                            : "bg-red-50 text-red-700 border-red-200"
                                        }`}
                                        title={connectionErrors[config.url]}
                                      >
                                        <AlertCircle
                                          className={`h-3 w-3 shrink-0 ${tone === "warning" ? "text-amber-500" : "text-red-500"}`}
                                        />
                                        {label}
                                      </div>
                                    );
                                  })()}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      retrySingleUrl(config);
                                    }}
                                    disabled={retryingUrls[config.url]}
                                    className="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white inline-flex items-center gap-1 uppercase transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                                    title="Reintentar la consulta de esta UNGET"
                                  >
                                    <RefreshCw className={`h-2.5 w-2.5 ${retryingUrls[config.url] ? "animate-spin" : ""}`} />
                                    {retryingUrls[config.url] ? "Cargando..." : "Reintentar"}
                                  </button>
                                  {canManageConfigs && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleOpenQuickFix(config, e)}
                                      className="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white inline-flex items-center gap-1 uppercase transition-all shadow-xs cursor-pointer"
                                      title="Corregir enlace o probar conexión"
                                    >
                                      <Settings className="h-2.5 w-2.5" />
                                      Editar Enlace
                                    </button>
                                  )}
                                </div>
                              )}

                              <div className="sm:hidden text-[10px] sm:text-xs font-bold text-gray-500 mt-0.5 mb-1.5">
                                {isConnecting ? "Conectando..." : `${ungetSourceCount} Estab.`}
                              </div>

                              {/* Resumen de establecimientos por tipo */}
                              {allUngetSummaries[originalIdx] && (
                                <div className="flex flex-wrap gap-1 mb-2 sm:mb-4">
                                  {allUngetSummaries[originalIdx].cs > 0 && (
                                    <span
                                      className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 uppercase"
                                      title="Centros de Salud"
                                    >
                                      C.S: {allUngetSummaries[originalIdx].cs}
                                    </span>
                                  )}
                                  {allUngetSummaries[originalIdx].ps > 0 && (
                                    <span
                                      className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-100 uppercase"
                                      title="Puestos de Salud"
                                    >
                                      P.S: {allUngetSummaries[originalIdx].ps}
                                    </span>
                                  )}
                                  {allUngetSummaries[originalIdx].alm > 0 && (
                                    <span
                                      className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-100 uppercase"
                                      title="Almacenes"
                                    >
                                      ALM: {allUngetSummaries[originalIdx].alm}
                                    </span>
                                  )}
                                  {allUngetSummaries[originalIdx].hosp > 0 && (
                                    <span
                                      className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100 uppercase"
                                      title="Hospitales"
                                    >
                                      HOSP:{" "}
                                      {allUngetSummaries[originalIdx].hosp}
                                    </span>
                                  )}
                                </div>
                              )}

                              {(matchingUnget || isSupabaseVirtual) ? (
                                <div className="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1 w-full shrink-0">
                                  {diresaName ? (
                                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-slate-500 truncate">
                                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                                      <span className="truncate" title={diresaName}>
                                        DIRESA: {diresaName}
                                      </span>
                                    </div>
                                  ) : null}
                                  {ogessName ? (
                                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-slate-500 truncate">
                                      <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0"></span>
                                      <span className="truncate" title={ogessName}>
                                        OGESS: {ogessName}
                                      </span>
                                    </div>
                                  ) : null}
                                  {!isSupabaseVirtual && (
                                    <div className="flex items-center gap-1.5 text-[9px] text-gray-400 mt-1 pt-1 border-t border-dashed border-gray-100 italic">
                                      <LinkIcon className="h-2.5 w-2.5 shrink-0 text-slate-300" />
                                      <span className="truncate max-w-[120px] sm:max-w-[150px]" title={describeConfigUrl(config)}>
                                        {describeConfigUrl(config)}
                                      </span>
                                    </div>
                                  )}
                                  {!diresaName && !ogessName && isSupabaseVirtual ? (
                                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-slate-400 italic shrink-0">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span>
                                      <span>Sin territorio superior</span>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[9px] sm:text-xs text-gray-400 mt-auto">
                                  <LinkIcon className="h-3 w-3 shrink-0" />
                                  <span className="truncate max-w-[120px] sm:max-w-[150px]">
                                    {describeConfigUrl(config)}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="hidden sm:flex items-center justify-between w-full mt-4 pt-4 border-t border-gray-50">
                              <span className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider inline-flex items-center gap-1.5">
                                {isConnecting ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin text-teal-500" />
                                    Conectando con Google Sheets...
                                  </>
                                ) : (
                                  `${ungetSourceCount} Establecimientos`
                                )}
                              </span>
                              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-teal-500 group-hover:translate-x-1 transition-all" />
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-span-full py-20 text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Settings className="h-8 w-8 text-gray-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800">
                          No hay UNGETs que coincidan
                        </h3>
                        <p className="text-gray-500 mt-2">
                          Intente con otro término de búsqueda.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* LEVEL 2: SHEET CARDS */}
              {viewLevel === "sheets" && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-gray-200/50 pb-3 mb-4 sm:mb-6 gap-4">
                    <div className="flex flex-col gap-2.5">
                      {/* Title and Counter Pill */}
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <div className="flex items-center gap-2">
                          <span className="w-1 h-5 bg-teal-500 rounded-full"></span>
                          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest break-words flex-1">
                            Establecimientos de Salud
                          </h3>
                        </div>
                        {filteredAndSortedSources.length > 0 && (
                          <span className="text-[10px] whitespace-nowrap font-black bg-teal-50 text-teal-850 px-2.5 py-0.5 rounded-full border border-teal-100/70 shadow-xs uppercase tracking-wide">
                            {filteredAndSortedSources.length}{" "}
                            {filteredAndSortedSources.length === 1
                              ? "establecimiento"
                              : "establecimientos"}
                          </span>
                        )}
                      </div>

                      {/* Beautiful Premium Type KPIs */}
                      {establishmentSummary && (
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          <div
                            className="flex items-center gap-1.5 bg-sky-50/70 border border-sky-100/50 text-sky-800 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-xs"
                            title="Centros de Salud"
                          >
                            <span className="w-1.5 h-1.5 bg-sky-500 rounded-full"></span>
                            <span className="text-slate-500 font-medium">
                              C.S.:
                            </span>
                            <span className="font-extrabold">
                              {establishmentSummary.cs}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-1.5 bg-amber-50/70 border border-amber-100/50 text-amber-800 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-xs"
                            title="Puestos de Salud"
                          >
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                            <span className="text-slate-500 font-medium">
                              P.S.:
                            </span>
                            <span className="font-extrabold">
                              {establishmentSummary.ps}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-1.5 bg-indigo-50/70 border border-indigo-100/50 text-indigo-800 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-xs"
                            title="Almacenes"
                          >
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                            <span className="text-slate-500 font-medium">
                              ALM:
                            </span>
                            <span className="font-extrabold">
                              {establishmentSummary.alm}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-1.5 bg-violet-50/70 border border-violet-100/50 text-violet-800 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-xs"
                            title="Hospitales"
                          >
                            <span className="w-1.5 h-1.5 bg-violet-500 rounded-full"></span>
                            <span className="text-slate-500 font-medium">
                              HOSP:
                            </span>
                            <span className="font-extrabold">
                              {establishmentSummary.hosp}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Selector de tipo de Visualización */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0 overflow-x-auto pb-1 -mb-1 max-w-full no-scrollbar">
                      <div className="flex items-center gap-1 bg-slate-100/80 p-0.5 rounded-xl border border-slate-200/60 shadow-[inset_0_1px_1.5px_rgba(0,0,0,0.02)] shrink-0 pr-1 lg:pr-0.5">
                        <button
                          type="button"
                          onClick={() => setSheetsViewMode("grid")}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            sheetsViewMode === "grid"
                              ? "bg-white text-teal-950 shadow-xs border border-slate-200/30"
                              : "text-slate-400 hover:text-slate-700"
                          }`}
                          title="Vista Cuadrícula"
                        >
                          <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden xs:inline">Cuadrícula</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheetsViewMode("list")}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            sheetsViewMode === "list"
                              ? "bg-white text-teal-950 shadow-xs border border-slate-200/30"
                              : "text-slate-400 hover:text-slate-700"
                          }`}
                          title="Vista Lista"
                        >
                          <List className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden xs:inline">Lista</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheetsViewMode("compact")}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            sheetsViewMode === "compact"
                              ? "bg-white text-teal-950 shadow-xs border border-slate-200/30"
                              : "text-slate-400 hover:text-slate-700"
                          }`}
                          title="Vista Compacta"
                        >
                          <Grid className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden xs:inline">Compacto</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheetsViewMode("table")}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            sheetsViewMode === "table"
                              ? "bg-white text-teal-950 shadow-xs border border-slate-200/30"
                              : "text-slate-400 hover:text-slate-700"
                          }`}
                          title="Vista Tabla"
                        >
                          <Table2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden xs:inline">Tabla</span>
                        </button>
                      </div>

                      {true && (
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleTableFullscreen(!isTableFullscreen)
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs border ${
                            isTableFullscreen
                              ? "bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                              : "bg-teal-50 border-teal-100 text-teal-850 hover:bg-teal-100 hover:text-teal-900 hover:border-teal-200"
                          }`}
                          title="Pantalla Completa"
                        >
                          {isTableFullscreen ? (
                            <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="hidden xs:inline">
                            {isTableFullscreen
                              ? "Salir F11"
                              : "Pantalla Completa"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  {(() => {
                    const viewContent =
                      filteredAndSortedSources.length === 0 ? (
                        <div className="py-16 text-center bg-white border border-gray-100 rounded-2xl shadow-sm p-8">
                          <div className="w-16 h-16 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Filter className="h-8 w-8 text-teal-500 animate-pulse" />
                          </div>
                          <h3 className="text-base font-bold text-gray-900">
                            No hay establecimientos con estos filtros
                          </h3>
                          <p className="text-gray-500 mt-1 max-w-sm mx-auto text-xs font-medium">
                            Pruebe cambiando o limpiando los filtros avanzados
                            para encontrar su establecimiento.
                          </p>
                          <button
                            onClick={() => {
                              setFilter_CS(true);
                              setFilter_PS(true);
                              setFilter_ALM(true);
                              setFilter_HOSP(true);
                              setFilter_OTRO(true);
                              setFilter_emerald(true);
                              setFilter_amber(true);
                              setFilter_red(true);
                              setFilter_gray(true);
                              setFilterSortOrder("name_asc");
                              setFilterHasPendingExpirations(false);
                              setFilterDateUnit("hours");
                              setFilterDateValue(0);
                              setFilterDateCondition("with");
                              setFilterMovementsUnit("hours");
                              setFilterMovementsValue(0);
                              setFilterMovementsCondition("with");
                            }}
                            className="mt-4 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all shadow-sm"
                          >
                            Limpiar todos los filtros
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* 1) GRID LAYOUT */}
                          {sheetsViewMode === "grid" && (
                            <div className={`grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 sm:gap-6 animate-in fade-in duration-200 ${isCaptureMode ? "pb-28" : ""}`}>
                              {filteredAndSortedSources.map((sheet) => {
                                const sheetData = rowsForSource(sheet.id);
                                const { expiredCount, expiringThisMonthCount } =
                                  getExpirationStats(sheetData);
                                const isSelected = selectedCaptureIds.has(sheet.id);
                                const description = describeSheetName(sheet.name);
                                const code = codeForSheet(sheet.id);
                                const cleanSheetId = sheet.id.includes("_") ? sheet.id.split("_").slice(1).join("_") : sheet.id;
                                const syncRecord = supabaseSyncs[sheet.id] || (sheet.facilityCode ? supabaseSyncs[sheet.facilityCode] : undefined) || supabaseSyncs[cleanSheetId] || (code ? supabaseSyncs[code] : undefined);

                                const cardData = {
                                  id: sheet.id,
                                  name: description,
                                  code: code || "",
                                  lastUpdate: sheet.lastUpdate,
                                  lastUpdateTime: sheet.lastUpdateTime,
                                  equipmentDate: sheet.equipmentDate,
                                  equipmentDateTime: sheet.equipmentDateTime,
                                  expiredCount,
                                  expiringThisMonthCount,
                                  totalItems: sheetData.length > 0 ? sheetData.length : sheet.rowCount || 0,
                                  syncRecordDate: getLastMovementDate(syncRecord),
                                  hasSyncRecord: !!syncRecord,
                                  isCheckingSync: isCheckingLatestSyncs,
                                };

                                return (
                                  <EstablishmentCard
                                    key={sheet.id}
                                    data={cardData}
                                    isCaptureMode={isCaptureMode}
                                    isSelected={isSelected}
                                    onToggleSelect={() => toggleCardSelection(sheet.id)}
                                    onClick={() => handleSelectSheet(sheet.id)}
                                    onShowHistory={() => handleShowSyncHistory(sheet)}
                                  />
                                );
                              })}
                            </div>
                          )}

                          {/* 2) LIST LAYOUT */}
                          {sheetsViewMode === "list" && (
                            <div className="flex flex-col gap-3.5 animate-in fade-in duration-200">
                              {filteredAndSortedSources.map((sheet) => {
                                const sheetData = rowsForSource(sheet.id);
                                const { expiredCount, expiringThisMonthCount } =
                                  getExpirationStats(sheetData);
                                const description = describeSheetName(sheet.name);
                                const code = codeForSheet(sheet.id);
                                const statusObj = getUpdateStatus(
                                  sheet.lastUpdateTime,
                                );
                                const isSelected = selectedCaptureIds.has(sheet.id);

                                return (
                                  <button
                                    key={sheet.id}
                                    onClick={() => {
                                      if (isCaptureMode) {
                                        toggleCardSelection(sheet.id);
                                      } else {
                                        handleSelectSheet(sheet.id);
                                      }
                                    }}
                                    className={`group relative bg-white border p-4 sm:p-5 rounded-xl sm:rounded-2xl transition-all text-left w-full cursor-pointer overflow-hidden ${
                                      isCaptureMode && isSelected
                                        ? "border-rose-500 ring-4 ring-rose-400/30 bg-rose-50/20 shadow-md"
                                        : isCaptureMode
                                        ? "border-slate-200 hover:border-rose-300 hover:ring-2 hover:ring-rose-200/50 shadow-sm"
                                        : "border-gray-200 shadow-[0_1px_4px_rgba(0,0,0,0.012)] hover:shadow-md hover:border-teal-500"
                                    }`}
                                  >
                                    {isCaptureMode && (
                                      <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5 transition-all">
                                        {isSelected ? (
                                          <div className="flex items-center gap-1 bg-rose-600 text-white text-[10px] font-black px-2 py-0.5 rounded-lg shadow-sm">
                                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                                            <span>Seleccionado</span>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1 bg-white/90 backdrop-blur-xs text-slate-500 border border-slate-300 hover:border-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-lg shadow-xs">
                                            <Square className="h-3.5 w-3.5" />
                                            <span>Seleccionar</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 w-full">
                                      {/* Column 1: Hospital Info & Status (Flexible width) */}
                                      <div className="flex items-center gap-3 md:gap-4 flex-[1_1_240px] min-w-[200px]">
                                        <div className="w-9 h-9 md:w-11 md:h-11 shrink-0 bg-blue-50 text-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors relative shadow-2xs">
                                          <Hospital className="h-5 w-5 md:h-6 md:w-6" />
                                          <div
                                            className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5"
                                            title={statusObj.label}
                                          >
                                            <span
                                              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusObj.color}`}
                                            />
                                            <span
                                              className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white ${statusObj.color}`}
                                            />
                                          </div>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 mb-0.5 md:mb-1 flex-wrap">
                                            {code && (
                                              <span className="text-[9px] md:text-[10px] font-black tracking-wider text-teal-600 bg-teal-50/80 px-1.5 py-0.5 rounded-md border border-teal-100 shrink-0">
                                                {code}
                                              </span>
                                            )}
                                            {/* Mobile sync state badge */}
                                            <span className="lg:hidden inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8.5px] font-extrabold bg-slate-50 border border-slate-200 shrink-0 whitespace-nowrap">
                                              <span className="relative flex h-1.5 w-1.5 mr-0.5 shrink-0">
                                                <span
                                                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusObj.color}`}
                                                />
                                                <span
                                                  className={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusObj.color}`}
                                                />
                                              </span>
                                              <span className="text-slate-650 truncate max-w-[100px]">
                                                {statusObj.label}
                                              </span>
                                            </span>
                                          </div>
                                          <h3
                                            className="text-[13px] sm:text-sm md:text-base font-black text-slate-800 leading-tight group-hover:text-slate-950 truncate"
                                            title={description}
                                          >
                                            {description}
                                          </h3>
                                          {/* Mobile items info */}
                                          <div className="lg:hidden flex items-center gap-1 mt-0.5 md:mt-1 text-[9px] md:text-[10px] text-slate-500 font-extrabold bg-slate-50 border border-slate-150 px-1.5 py-0.5 rounded-md w-fit">
                                            <Package className="h-3 w-3 md:h-3.5 md:w-3.5 text-slate-400 shrink-0" />
                                            <span>
                                              {sheetData.length} ítems
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Column 2: Inventory Stats (LG+) */}
                                      <div className="hidden lg:flex flex-col gap-0.5 flex-[1_1_100px] max-w-[140px] min-w-[90px] shrink-0">
                                        <span className="text-[8px] text-slate-400 font-extrabold uppercase tracking-wider">
                                          Inventario
                                        </span>
                                        <div className="inline-flex items-center gap-1 text-[11px] font-black text-slate-705 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg w-fit">
                                          <Package className="h-3 w-3 text-slate-400 shrink-0" />
                                          <span>{sheetData.length} ítems</span>
                                        </div>
                                      </div>

                                      {/* Column 3: Sincronización Logs & Devices (LG+) */}
                                      <div className="hidden lg:flex flex-col gap-0.5 flex-[1_1_140px] max-w-[200px] min-w-[130px] shrink-0">
                                        <span className="text-[8px] text-slate-400 font-extrabold uppercase tracking-wider">
                                          Última Conexión
                                        </span>
                                        <div className="flex flex-col gap-0.5 text-[9px] 2xl:text-[10px] font-extrabold text-slate-600">
                                          {(sheet.lastUpdate || sheet.lastUpdateTime) && (
                                            <div className="flex items-center gap-1">
                                              <RefreshCw className="h-3 w-3 text-slate-450 shrink-0" />
                                              <span className="truncate">
                                                Act:{" "}
                                                <span className="text-slate-850 font-black">
                                                  {formatFullDate(
                                                    sheet.lastUpdate || sheet.lastUpdateTime,
                                                  )}
                                                </span>
                                              </span>
                                            </div>
                                          )}
                                          {(sheet.equipmentDate || sheet.equipmentDateTime) && (
                                            <div className="flex items-center gap-1">
                                              <Monitor className="h-3 w-3 text-slate-450 shrink-0" />
                                              <span className="truncate flex-1 min-w-0">
                                                Equipo:{" "}
                                                <span
                                                  className={`font-black ${!datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime) ? "text-rose-500 font-extrabold" : "text-slate-600"}`}
                                                >
                                                  {formatFullDate(
                                                    sheet.equipmentDate || sheet.equipmentDateTime,
                                                  )}
                                                </span>
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Column 4: Warning Badges & Actions */}
                                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2.5 flex-[1_1_300px] min-w-[200px] ml-auto">
                                        {/* Sync status pill on desktop layout */}
                                        <div className="hidden lg:flex shrink-0 scale-[0.85] xl:scale-95 origin-right">
                                          {renderSyncStatusPill(
                                            sheet.lastUpdateTime,
                                          )}
                                        </div>

                                        {/* Expirations badges */}
                                        <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5 shrink-0 ml-auto">
                                          {expiredCount > 0 && (
                                            <div
                                              className="flex items-center gap-1 bg-red-50 text-red-700 px-2 py-0.5 sm:px-2.5 sm:py-1 md:py-1.5 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-black border border-red-100/80 shadow-3xs whitespace-nowrap"
                                              title="Vencidos en stock"
                                            >
                                              <AlertTriangle className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-red-550 shrink-0" />
                                              <span>
                                                {expiredCount} vencido
                                                {expiredCount !== 1 ? "s" : ""}
                                              </span>
                                            </div>
                                          )}
                                          {expiringThisMonthCount > 0 && (
                                            <div
                                              className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 sm:px-2.5 sm:py-1 md:py-1.5 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-black border border-amber-100/80 shadow-3xs whitespace-nowrap"
                                              title="Vencimiento cercano"
                                            >
                                              <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-550 shrink-0" />
                                              <span>
                                                {expiringThisMonthCount} por
                                                vencer
                                              </span>
                                            </div>
                                          )}
                                        </div>

                                        {/* Consult button / indicator */}
                                        <div className="flex items-center gap-1 pl-2 border-l border-slate-150 h-5 sm:h-7 shrink-0 ml-2">
                                          <span className="text-[9px] sm:text-[10.5px] font-black text-teal-600 uppercase tracking-wider group-hover:text-teal-755 whitespace-nowrap">
                                            Ver Stock
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* 3) COMPACT LAYOUT */}
                          {sheetsViewMode === "compact" && (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5 animate-in fade-in duration-200">
                              {filteredAndSortedSources.map((sheet) => {
                                const sheetData = rowsForSource(sheet.id);
                                const { expiredCount, expiringThisMonthCount } =
                                  getExpirationStats(sheetData);
                                const description = describeSheetName(sheet.name);
                                const code = codeForSheet(sheet.id);
                                const isSelected = selectedCaptureIds.has(sheet.id);

                                return (
                                  <button
                                    key={sheet.id}
                                    onClick={() => {
                                      if (isCaptureMode) {
                                        toggleCardSelection(sheet.id);
                                      } else {
                                        handleSelectSheet(sheet.id);
                                      }
                                    }}
                                    className={`group relative bg-white border p-4 rounded-xl sm:rounded-2xl transition-all text-left flex flex-col justify-between h-full min-h-[175px] cursor-pointer overflow-hidden ${
                                      isCaptureMode && isSelected
                                        ? "border-rose-500 ring-4 ring-rose-400/30 bg-rose-50/20 shadow-md"
                                        : isCaptureMode
                                        ? "border-slate-200 hover:border-rose-300 hover:ring-2 hover:ring-rose-200/50 shadow-sm"
                                        : "border-gray-200 shadow-[0_1px_4px_rgba(0,0,0,0.012)] hover:shadow-md hover:border-teal-500"
                                    }`}
                                  >
                                    {isCaptureMode && (
                                      <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5 transition-all">
                                        {isSelected ? (
                                          <div className="flex items-center gap-1 bg-rose-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-lg shadow-sm">
                                            <Check className="h-3 w-3 stroke-[3]" />
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1 bg-white/90 text-slate-500 border border-slate-300 text-[9px] font-bold px-1.5 py-0.5 rounded-lg shadow-xs">
                                            <Square className="h-3 w-3" />
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="w-full">
                                      {/* Compact Top Row: SISMED code with Establishment style icon, and stats/status dot on the right */}
                                      <div className="flex items-center justify-between mb-3.5">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6.5 h-6.5 shrink-0 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                            <Hospital className="h-3.5 w-3.5" />
                                          </div>
                                          {code && (
                                            <span className="text-[10.5px] font-black text-cyan-600 tracking-wide">
                                              {code}
                                            </span>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                          {expiredCount > 0 && (
                                            <div
                                              className="bg-red-50 text-red-600 text-[10px] font-black px-1.5 py-0.5 rounded-md border border-red-200/50 shadow-3xs"
                                              title="Vencido"
                                            >
                                              {expiredCount}v
                                            </div>
                                          )}
                                          {expiringThisMonthCount > 0 && (
                                            <div
                                              className="bg-amber-50 text-amber-600 text-[10px] font-black px-1.5 py-0.5 rounded-md border border-amber-200/50 shadow-3xs"
                                              title="Por vencer"
                                            >
                                              {expiringThisMonthCount}pv
                                            </div>
                                          )}
                                          <div
                                            className="flex items-center"
                                            title={
                                              getUpdateStatus(
                                                sheet.lastUpdateTime,
                                              ).label
                                            }
                                          >
                                            <span className="relative flex h-3 w-3">
                                              <span
                                                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${getUpdateStatus(sheet.lastUpdateTime).color}`}
                                              />
                                              <span
                                                className={`relative inline-flex rounded-full h-3 w-3 border border-white shadow-3xs ${getUpdateStatus(sheet.lastUpdateTime).color}`}
                                              />
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Description: Tighter text */}
                                      <h3
                                        className="text-[13px] font-black text-slate-800 leading-snug tracking-tight mb-2 group-hover:text-teal-900 transition-colors line-clamp-1"
                                        title={description}
                                      >
                                        {description}
                                      </h3>

                                      {sheet.lastUpdateTime && (
                                        <div
                                          className="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-1.5"
                                          title="Última actualización"
                                        >
                                          <RefreshCw className="h-3 w-3 text-slate-400/85 shrink-0" />
                                          <span>
                                            Act:{" "}
                                            <span className="font-extrabold text-slate-500">
                                              {formatFullDate(
                                                sheet.lastUpdateTime,
                                              )}
                                            </span>
                                          </span>
                                        </div>
                                      )}
                                      {sheet.equipmentDateTime && (
                                        <div
                                          className={`text-[10px] font-bold mt-0.5 flex items-center gap-1.5 ${!datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime) ? "text-red-500" : "text-slate-400"}`}
                                          title="Fecha y hora del equipo"
                                        >
                                          <Monitor className="h-3 w-3 text-slate-400/85 shrink-0" />
                                          <span>
                                            Equipo:{" "}
                                            <span
                                              className={`font-extrabold ${!datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime) ? "text-red-500 font-black" : "text-slate-500"}`}
                                            >
                                              {formatFullDate(
                                                sheet.equipmentDateTime,
                                              )}
                                            </span>
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    {/* Expirations and Ver Stock mini row */}
                                    <div className="flex flex-wrap items-center justify-between mt-4 pt-3 border-t border-slate-100 w-full gap-2">
                                      {renderSyncStatusPill(
                                        sheet.lastUpdateTime,
                                      )}

                                      <div className="flex items-center text-[9px] font-black text-teal-600 uppercase tracking-wider group-hover:text-teal-700 transition-colors shrink-0 ml-auto">
                                        <span>
                                          VER STOCK ({sheetData.length})
                                        </span>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* 4) TABLE LAYOUT */}
                          {sheetsViewMode === "table" && (
                            <div
                              className={`bg-white rounded-2xl border border-slate-200/50 relative overflow-hidden ${isTableFullscreen ? "shadow-lg border-slate-200/60 m-1 sm:m-2" : "shadow-sm animate-in fade-in duration-200"}`}
                            >
                              <div className="overflow-auto scrollbar-thin">
                                <table className="min-w-full divide-y divide-slate-100 text-left font-sans">
                                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-wider shadow-[0_1px_0_0_rgba(226,232,240,0.8)]">
                                    <tr>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder === "code_asc"
                                                ? "code_desc"
                                                : "code_asc",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors text-left uppercase tracking-wider font-black"
                                        >
                                          <span>Cód. SISMED</span>
                                          <span className="shrink-0">
                                            {filterSortOrder === "code_asc" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "code_desc" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !== "code_asc" &&
                                              filterSortOrder !==
                                                "code_desc" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder === "name_asc"
                                                ? "name_desc"
                                                : "name_asc",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors text-left uppercase tracking-wider font-black"
                                        >
                                          <span>Establecimiento de Salud</span>
                                          <span className="shrink-0">
                                            {filterSortOrder === "name_asc" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "name_desc" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !== "name_asc" &&
                                              filterSortOrder !==
                                                "name_desc" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black text-center sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder === "type_asc"
                                                ? "type_desc"
                                                : "type_asc",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors uppercase tracking-wider font-black mx-auto justify-center"
                                        >
                                          <span>Tipo</span>
                                          <span className="shrink-0">
                                            {filterSortOrder === "type_asc" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "type_desc" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !== "type_asc" &&
                                              filterSortOrder !==
                                                "type_desc" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder === "date_newest"
                                                ? "date_oldest"
                                                : "date_newest",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors text-left uppercase tracking-wider font-black"
                                        >
                                          <span>Última Sincronización</span>
                                          <span className="shrink-0">
                                            {filterSortOrder ===
                                              "date_newest" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "date_oldest" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !==
                                              "date_newest" &&
                                              filterSortOrder !==
                                                "date_oldest" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder === "equip_newest"
                                                ? "equip_oldest"
                                                : "equip_newest",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors text-left uppercase tracking-wider font-black"
                                        >
                                          <span>Act. de Equipo</span>
                                          <span className="shrink-0">
                                            {filterSortOrder ===
                                              "equip_newest" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "equip_oldest" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !==
                                              "equip_newest" &&
                                              filterSortOrder !==
                                                "equip_oldest" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black text-center sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder ===
                                                "status_green_first"
                                                ? "status_red_first"
                                                : "status_green_first",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors uppercase tracking-wider font-black mx-auto justify-center"
                                        >
                                          <span>Estado</span>
                                          <span className="shrink-0">
                                            {filterSortOrder ===
                                              "status_green_first" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "status_red_first" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !==
                                              "status_green_first" &&
                                              filterSortOrder !==
                                                "status_red_first" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black text-center sticky top-0 bg-slate-50 z-10 text-slate-500 uppercase tracking-wider"
                                      >
                                        <span>Últimos Movimientos</span>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black text-center sticky top-0 bg-slate-50 z-10"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setFilterSortOrder(
                                              filterSortOrder ===
                                                "expired_highest"
                                                ? "expired_lowest"
                                                : "expired_highest",
                                            )
                                          }
                                          className="group inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors uppercase tracking-wider font-black mx-auto justify-center"
                                        >
                                          <span>Expiraciones</span>
                                          <span className="shrink-0">
                                            {filterSortOrder ===
                                              "expired_highest" && (
                                              <ArrowDown className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder ===
                                              "expired_lowest" && (
                                              <ArrowUp className="h-3.5 w-3.5 text-teal-600" />
                                            )}
                                            {filterSortOrder !==
                                              "expired_highest" &&
                                              filterSortOrder !==
                                                "expired_lowest" && (
                                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity" />
                                              )}
                                          </span>
                                        </button>
                                      </th>
                                      <th
                                        scope="col"
                                        className="px-5 py-3 font-black text-right pr-6 sticky top-0 bg-slate-50 z-10 uppercase tracking-wider"
                                      >
                                        Acción
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 bg-white">
                                    {filteredAndSortedSources.map((sheet) => {
                                      const sheetData = rowsForSource(sheet.id);
                                      const {
                                        expiredCount,
                                        expiringThisMonthCount,
                                      } = getExpirationStats(sheetData);
                                      const description = describeSheetName(sheet.name);
                                      const code = codeForSheet(sheet.id);
                                      const type = getSheetType(sheet.name);

                                      let typeBadge = (
                                        <span className="inline-flex items-center justify-center bg-slate-50 text-slate-500 px-2 py-0.5 rounded text-[8.5px] font-bold border border-slate-100/80 min-w-[50px]">
                                          OTRO
                                        </span>
                                      );
                                      if (type === "CS") {
                                        typeBadge = (
                                          <span className="inline-flex items-center justify-center bg-sky-50 text-sky-700 px-2 py-0.5 rounded text-[8.5px] font-bold border border-sky-100/70 min-w-[50px]">
                                            C.S.
                                          </span>
                                        );
                                      } else if (type === "PS") {
                                        typeBadge = (
                                          <span className="inline-flex items-center justify-center bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[8.5px] font-bold border border-amber-100/70 min-w-[50px]">
                                            P.S.
                                          </span>
                                        );
                                      } else if (type === "ALM") {
                                        typeBadge = (
                                          <span className="inline-flex items-center justify-center bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[8.5px] font-bold border border-indigo-100/70 min-w-[50px]">
                                            ALM
                                          </span>
                                        );
                                      } else if (type === "HOSP") {
                                        typeBadge = (
                                          <span className="inline-flex items-center justify-center bg-violet-50 text-violet-700 px-2 py-0.5 rounded text-[8.5px] font-bold border border-violet-100/75 min-w-[50px]">
                                            HOSP
                                          </span>
                                        );
                                      }

                                      const statusObj = getUpdateStatus(
                                        sheet.lastUpdateTime,
                                      );
                                      const isSelected = selectedCaptureIds.has(sheet.id);

                                      return (
                                        <tr
                                          key={sheet.id}
                                          onClick={() => {
                                            if (isCaptureMode) {
                                              toggleCardSelection(sheet.id);
                                            } else {
                                              handleSelectSheet(sheet.id);
                                            }
                                          }}
                                          className={`transition-all cursor-pointer group ${
                                            isCaptureMode && isSelected
                                              ? "bg-rose-50/70 hover:bg-rose-50"
                                              : "hover:bg-teal-50/20"
                                          }`}
                                        >
                                          <td className="px-5 py-3 whitespace-nowrap">
                                            {isCaptureMode ? (
                                              <div className="flex items-center gap-2">
                                                {isSelected ? (
                                                  <div className="flex items-center gap-1 bg-rose-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md shadow-sm">
                                                    <Check className="h-3 w-3 stroke-[3]" />
                                                    <span>Sel.</span>
                                                  </div>
                                                ) : (
                                                  <div className="flex items-center gap-1 bg-white text-slate-500 border border-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                                    <Square className="h-3 w-3" />
                                                  </div>
                                                )}
                                                {code && (
                                                  <span className="text-[10px] font-extrabold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-100">
                                                    {code}
                                                  </span>
                                                )}
                                              </div>
                                            ) : code ? (
                                              <span className="text-[10px] font-extrabold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-100">
                                                {code}
                                              </span>
                                            ) : (
                                              <span className="text-[10px] text-slate-400 font-bold">
                                                -
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-5 py-3">
                                            <h3
                                              className="text-xs font-black text-slate-800 leading-snug truncate max-w-[240px] group-hover:text-teal-905 transition-colors"
                                              title={description}
                                            >
                                              {description}
                                            </h3>
                                          </td>
                                          <td className="px-5 py-3 text-center whitespace-nowrap">
                                            {typeBadge}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap">
                                            {sheet.lastUpdateTime ? (
                                              <div
                                                className={`flex items-center gap-1.5 text-[10.5px] font-bold ${statusObj.color.includes("bg-emerald-500") ? "text-slate-600" : "text-slate-400"}`}
                                              >
                                                <Wifi
                                                  className={`h-3.5 w-3.5 shrink-0 ${statusObj.color.replace("bg-", "text-")}`}
                                                />
                                                <span>
                                                  {formatFullDate(
                                                    sheet.lastUpdateTime,
                                                  )}
                                                </span>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 font-bold">
                                                <Wifi className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                <span>Sin datos</span>
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap">
                                            {sheet.equipmentDateTime ? (
                                              <div
                                                className={`flex items-center gap-1.5 text-[10.5px] font-bold ${statusObj.color.includes("bg-emerald-500") ? "text-slate-600" : "text-slate-400"}`}
                                              >
                                                <Monitor
                                                  className={`h-3.5 w-3.5 shrink-0 ${statusObj.color.includes("bg-emerald-500") ? "text-indigo-500" : "text-slate-400"}`}
                                                />
                                                <span>
                                                  {formatFullDate(
                                                    sheet.equipmentDateTime,
                                                  )}
                                                </span>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 font-bold">
                                                <Monitor className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                <span>Sin datos</span>
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-5 py-3 text-center whitespace-nowrap">
                                            <span
                                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${statusObj.color.includes("bg-emerald-500") ? "bg-emerald-50 text-emerald-800 border-emerald-100" : statusObj.color.includes("bg-amber-500") ? "bg-amber-50 text-amber-800 border-amber-100" : "bg-rose-50 text-rose-800 border-rose-100"}`}
                                            >
                                              <span className="relative flex h-1.5 w-1.5">
                                                <span
                                                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusObj.color}`}
                                                />
                                                <span
                                                  className={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusObj.color}`}
                                                />
                                              </span>
                                              {statusObj.label}
                                            </span>
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-center">
                                            {(() => {
                                              const syncRecord =
                                                supabaseSyncs[sheet.id];
                                              if (!syncRecord) {
                                                return (
                                                  <span className="text-[10px] font-bold text-slate-400">
                                                    -
                                                  </span>
                                                );
                                              }
                                              return (
                                                <div
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleShowSyncHistory(sheet);
                                                  }}
                                                  className="inline-flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                                                  title={`Último cambio: ${new Date(syncRecord.sync_date).toLocaleString("es-PE")}`}
                                                >
                                                  {renderSyncStatusPill(
                                                    new Date(
                                                      syncRecord.sync_date,
                                                    ).getTime(),
                                                  )}
                                                </div>
                                              );
                                            })()}
                                          </td>
                                          <td className="px-5 py-3 text-center whitespace-nowrap">
                                            <div className="flex items-center justify-center gap-1.5">
                                              {expiredCount === 0 &&
                                              expiringThisMonthCount === 0 ? (
                                                <span className="inline-flex items-center gap-0.5 bg-green-50 text-green-700 px-1.5 py-0.5 rounded text-[9px] font-bold border border-green-100">
                                                  <Check className="h-2.5 w-2.5 text-green-500" />{" "}
                                                  Al día
                                                </span>
                                              ) : (
                                                <>
                                                  {expiredCount > 0 && (
                                                    <span
                                                      className="inline-flex items-center gap-0.5 bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-[9px] font-black border border-red-100"
                                                      title="Vencido"
                                                    >
                                                      <AlertTriangle className="h-2.5 w-2.5 text-red-500" />
                                                      {expiredCount}v
                                                    </span>
                                                  )}
                                                  {expiringThisMonthCount >
                                                    0 && (
                                                    <span
                                                      className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-black border border-amber-100"
                                                      title="Por vencer"
                                                    >
                                                      <Clock className="h-2.5 w-2.5 text-amber-500" />
                                                      {expiringThisMonthCount}pv
                                                    </span>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-5 py-3 text-right pr-6 whitespace-nowrap">
                                            <div className="inline-flex items-center gap-1 text-[10px] font-black text-teal-600 uppercase tracking-wider group-hover:text-teal-700 transition-all">
                                              <span>Ver stock</span>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </>
                      );

                    if (isTableFullscreen) {
                      return (
                        <div className="fixed inset-0 z-[105000] bg-slate-100 flex flex-col h-screen w-screen animate-in fade-in duration-200">
                          {/* Fullscreen Header */}
                          <div className="bg-slate-900 text-white px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between shadow-md shrink-0 border-b border-slate-800">
                            <div className="flex flex-wrap items-center gap-4 sm:gap-6 flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse" />
                                <h3 className="text-xs sm:text-sm font-black uppercase tracking-widest text-slate-100 flex items-center gap-2 shrink-0">
                                  Establecimientos de Salud
                                  <span className="text-[10px] bg-slate-800 text-teal-400 px-2 py-0.5 rounded-full border border-slate-755 w-auto font-bold uppercase tracking-wider">
                                    {filteredAndSortedSources.length} ITEMS
                                  </span>
                                </h3>
                              </div>
                              {establishmentSummary && (
                                <div className="hidden lg:flex flex-wrap items-center gap-2 animate-in fade-in duration-300">
                                  <div
                                    className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-800/40 text-emerald-400 px-3 py-1 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wide shadow-sm"
                                    title="Establecimientos En Línea (Actualizados recientemente o hace menos de 1 h)"
                                  >
                                    <Wifi className="h-4 w-4 text-emerald-400 animate-pulse stroke-[2.5]" />
                                    <span className="text-slate-300 font-medium normal-case">
                                      En línea:
                                    </span>
                                    <span className="font-black text-xs sm:text-sm text-emerald-300">
                                      {establishmentSummary.online}
                                    </span>
                                  </div>
                                  <div
                                    className="flex items-center gap-2 bg-amber-950/50 border border-amber-800/40 text-amber-450 px-3 py-1 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wide shadow-sm"
                                    title="Establecimientos Desactualizados (Actualizados entre 1 y 24 h)"
                                  >
                                    <Clock className="h-4 w-4 text-amber-450 stroke-[2.5]" />
                                    <span className="text-slate-300 font-medium normal-case">
                                      Desactualizados:
                                    </span>
                                    <span className="font-black text-xs sm:text-sm text-amber-300">
                                      {establishmentSummary.delayed}
                                    </span>
                                  </div>
                                  <div
                                    className="flex items-center gap-2 bg-red-950/50 border border-red-800/40 text-red-500 px-3 py-1 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wide shadow-sm"
                                    title="Establecimientos Fuera de Línea (Actualizados hace más de 24 h)"
                                  >
                                    <WifiOff className="h-4 w-4 text-red-400 stroke-[2.5]" />
                                    <span className="text-slate-300 font-medium normal-case">
                                      Fuera de línea:
                                    </span>
                                    <span className="font-black text-xs sm:text-sm text-red-400">
                                      {establishmentSummary.offline}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
                              {/* Fullscreen Search Input */}
                              <div className="relative group w-32 xs:w-40 sm:w-48 md:w-56">
                                <input
                                  type="text"
                                  placeholder="Buscar..."
                                  value={sheetSearchTerm}
                                  onChange={(e) =>
                                    setSheetSearchTerm(e.target.value)
                                  }
                                  className="w-full pl-8 pr-3 py-1.5 bg-slate-800/90 text-white placeholder-slate-400 border border-slate-700/80 hover:bg-slate-750 focus:bg-slate-900 focus:border-teal-500 rounded-xl text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-teal-500/30"
                                />
                                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                  <Search className="h-3 w-3 text-slate-500 group-focus-within:text-teal-400 transition-colors" />
                                </div>
                              </div>

                              {/* Advanced Filters Trigger */}
                              <button
                                type="button"
                                onClick={() =>
                                  setIsAdvancedFiltersSidebarOpen(true)
                                }
                                className="relative flex items-center justify-center p-2 rounded-xl bg-slate-800 border border-slate-700/80 hover:bg-slate-750 text-slate-300 hover:text-teal-400 transition-all cursor-pointer shadow-sm shrink-0"
                                title="Filtros Avanzados"
                              >
                                <Filter className="h-3.5 w-3.5" />
                                {(!filter_CS ||
                                  !filter_PS ||
                                  !filter_ALM ||
                                  !filter_HOSP ||
                                  !filter_OTRO ||
                                  !filter_emerald ||
                                  !filter_amber ||
                                  !filter_red ||
                                  !filter_gray ||
                                  filterSortOrder !== "name_asc" ||
                                  filterHasPendingExpirations) && (
                                  <span className="absolute top-1 right-1 w-2 h-2 bg-teal-400 rounded-full border border-slate-900 animate-pulse" />
                                )}
                              </button>

                              {/* View Switcher inside Fullscreen Header */}
                              <div className="flex items-center gap-0.5 bg-slate-800 border border-slate-700/60 p-0.5 rounded-xl">
                                <button
                                  type="button"
                                  onClick={() => setSheetsViewMode("grid")}
                                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                    sheetsViewMode === "grid"
                                      ? "bg-slate-700 text-teal-400 font-bold"
                                      : "text-slate-400 hover:text-slate-300"
                                  }`}
                                  title="Vista Cuadrícula"
                                >
                                  <LayoutGrid className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSheetsViewMode("list")}
                                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                    sheetsViewMode === "list"
                                      ? "bg-slate-700 text-teal-400 font-bold"
                                      : "text-slate-400 hover:text-slate-300"
                                  }`}
                                  title="Vista Lista"
                                >
                                  <List className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSheetsViewMode("compact")}
                                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                    sheetsViewMode === "compact"
                                      ? "bg-slate-700 text-teal-400 font-bold"
                                      : "text-slate-400 hover:text-slate-300"
                                  }`}
                                  title="Vista Compacta"
                                >
                                  <Grid className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSheetsViewMode("table")}
                                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                    sheetsViewMode === "table"
                                      ? "bg-slate-700 text-teal-400 font-bold"
                                      : "text-slate-400 hover:text-slate-300"
                                  }`}
                                  title="Vista Tabla"
                                >
                                  <Table2 className="h-3.5 w-3.5" />
                                </button>
                              </div>

                              {/* Exit fullscreen - ICON ONLY */}
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleTableFullscreen(false)
                                }
                                className="flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-755 text-slate-300 hover:text-teal-400 rounded-xl border border-slate-700/80 shadow-sm cursor-pointer transition-all active:scale-95 shrink-0"
                                title="Salir de Pantalla Completa"
                              >
                                <Minimize2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          {/* Fullscreen Scrollable Body Container */}
                          <div className="flex-1 overflow-auto p-4 sm:p-6 scrollbar-thin bg-slate-100">
                            {viewContent}
                          </div>
                        </div>
                      );
                    }

                    return viewContent;
                  })()}
                </div>
              )}

              {/* LEVEL 3: DATA TABLE */}
              {viewLevel === "data" && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 -mx-4 md:-mx-6 -mt-4 md:-mt-6 font-sans">
                  <div className="bg-transparent sm:bg-white sm:border-t border-gray-100 overflow-y-auto overflow-x-auto max-h-[calc(100vh-420px)] custom-scrollbar pb-4 px-4 sm:px-0 pt-4 sm:pt-0 relative block">
                    <table className="min-w-full block sm:table">
                      <thead className="hidden sm:table-header-group sticky top-0 z-30 shadow-xs border-b border-slate-200">
                        <tr className="bg-slate-50">
                          {showsPharmacyInData && (
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                            >
                              Código IPRESS
                            </th>
                          )}
                          <th
                            scope="col"
                            className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                          >
                            Cód. SISMED / SIGA
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider min-w-[250px] bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                          >
                            Descripción del Producto
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 text-right text-xs font-black text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                          >
                            Saldo
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                          >
                            Lote / Venc.
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                          >
                            Tipo Sum.
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 sticky top-0 z-30 border-b border-slate-200/80 shadow-2xs"
                          >
                            F. Finan.
                          </th>
                        </tr>
                      </thead>
                      <tbody className="block sm:table-row-group bg-transparent sm:bg-white">
                        {filteredData.length > 0 ? (
                          filteredData.map((row, i) => (
                            <tr
                              key={i}
                              onClick={() => setSelectedRecord(row)}
                              className="block sm:table-row bg-white rounded-xl sm:rounded-none shadow-sm sm:shadow-none border border-gray-200 sm:border-0 border-b-gray-100 p-4 sm:p-0 hover:bg-teal-50/50 transition-colors cursor-pointer group mb-3 sm:mb-0 relative"
                            >
                              {/* Mobile Card Layout */}
                              <td className="block sm:hidden">
                                {showsPharmacyInData && (
                                  <div className="mb-2 border-b border-gray-100 pb-2">
                                    <PharmacyCodeCell label={pharmacyLabelOf(row)} />
                                  </div>
                                )}
                                <div className="flex justify-between items-start mb-2">
                                  <div className="flex flex-col">
                                    <span className="text-xs font-black text-teal-700 bg-teal-50 px-2 py-0.5 rounded w-fit mb-1 border border-teal-100">
                                      {row.ID_Producto || "-"}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-bold">
                                      {row.CODIGO_SIG || "-"}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[10px] text-gray-400 font-black uppercase block mb-0.5">
                                      Saldo
                                    </span>
                                    <span className="text-xl font-black text-teal-600 leading-none">
                                      {!isNaN(parseInt(String(row.Saldo), 10))
                                        ? parseInt(String(row.Saldo), 10)
                                        : 0}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-sm font-bold text-gray-900 mb-2 leading-snug">
                                  {row.Nombre || "-"}
                                </div>
                                <div className="flex justify-between items-center text-[10px]">
                                  <div className="flex flex-col gap-0.5 w-full">
                                    <span className="text-gray-500 font-mono">
                                      <span className="font-bold text-gray-400">
                                        Lote:
                                      </span>{" "}
                                      {row.Lote || "-"}
                                    </span>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-500 font-mono">
                                        <span className="font-bold text-gray-400">
                                          Vence:
                                        </span>{" "}
                                        {formatDate(row.Fec_Vencim) || "-"}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100 font-bold uppercase truncate max-w-[80px]"
                                          title={row.TIPSUM}
                                        >
                                          {row.TIPSUM || "-"}
                                        </span>
                                        <span
                                          className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100 font-bold uppercase truncate max-w-[80px]"
                                          title={row.FFINAN}
                                        >
                                          {row.FFINAN || "-"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Desktop Table Cells */}
                              {showsPharmacyInData && (
                                <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap align-top">
                                  <PharmacyCodeCell label={pharmacyLabelOf(row)} />
                                </td>
                              )}
                              <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono group-hover:text-teal-700">
                                <div className="font-bold">
                                  {row.ID_Producto || "-"}
                                </div>
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  {row.CODIGO_SIG || "-"}
                                </div>
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-900 font-medium">
                                {row.Nombre || "-"}
                                <div
                                  className="text-[10px] text-gray-400 font-normal mt-0.5 max-w-sm truncate"
                                  title={row.Reg_Sanitario}
                                >
                                  RS: {row.Reg_Sanitario || "S/N"}
                                </div>
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-gray-900">
                                {!isNaN(parseInt(String(row.Saldo), 10))
                                  ? parseInt(String(row.Saldo), 10)
                                  : 0}
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                <span className="font-mono text-gray-700">
                                  {row.Lote || "-"}
                                </span>
                                <div className="text-[10px] mt-0.5">
                                  Vence: {formatDate(row.Fec_Vencim) || "-"}
                                </div>
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-sm">
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase"
                                  title={row.DESC_TIPSUM}
                                >
                                  {row.TIPSUM || "-"}
                                </span>
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 whitespace-nowrap text-sm">
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 uppercase"
                                  title={row.DESC_FFINAN}
                                >
                                  {row.FFINAN || "-"}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr className="block sm:table-row">
                            <td
                              colSpan={showsPharmacyInData ? 7 : 6}
                              className="block sm:table-cell px-4 py-12 text-center text-sm text-gray-500"
                            >
                              No se encontraron coincidencias para su búsqueda.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Stock en Fullscreen */}
      {isTableFullscreen && stockModalSourceId && (
        <div
          className="fixed inset-0 z-[106000] flex items-center justify-center p-2 sm:p-5 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => {
            setStockModalSourceId(null);
            setStockModalSearchTerm("");
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-6xl overflow-hidden flex flex-col h-full max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dark Header inside Modal */}
            {(() => {
              const sheetInfo = sources.find(
                (s) => s.id === stockModalSourceId,
              );
              const code = codeForSheet(stockModalSourceId || "");
              const statusObj = sheetInfo
                ? getUpdateStatus(sheetInfo.lastUpdateTime)
                : null;
              const description = sheetInfo ? describeSheetName(sheetInfo.name) : "";

              return (
                sheetInfo && (
                  <div className="px-4 sm:px-5 py-3.5 bg-slate-900 flex justify-between items-center text-white shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-teal-500/20 text-teal-400 rounded-xl flex items-center justify-center shadow-inner">
                        <Hospital className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col text-left">
                        <div className="flex items-center gap-2">
                          {code && (
                            <span className="text-xs font-black text-teal-400 font-mono tracking-wider">
                              {code}
                            </span>
                          )}
                          <span className="text-sm font-bold truncate max-w-[200px] sm:max-w-md">
                            {description}
                          </span>
                        </div>
                        {statusObj && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className={`relative flex h-1.5 w-1.5 shrink-0`}
                            >
                              <span
                                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusObj.color}`}
                              />
                              <span
                                className={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusObj.color}`}
                              />
                            </span>
                            <span className="text-[10.5px] text-slate-400 font-medium">
                              Act: {statusObj.fullLabel}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-4">
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                          Items encontrados
                        </span>
                        <span className="text-xl font-black text-slate-100 leading-none">
                          {modalStockData.length}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              );
            })()}

            {/* Header Filters & Actions */}
            <div className="px-4 sm:px-5 pt-4 pb-2 sm:pt-5 sm:pb-3 shrink-0 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:max-w-xl group">
                <input
                  type="text"
                  placeholder="Buscar medicamento en esta hoja..."
                  value={stockModalSearchTerm}
                  onChange={(e) => setStockModalSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/85 text-slate-800 placeholder-slate-450 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-teal-500 rounded-xl text-sm transition-all focus:outline-none focus:ring-4 focus:ring-teal-500/10 font-semibold shadow-2xs"
                />
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400 group-focus-within:text-teal-600 stroke-[2.5] transition-colors" />
                </div>
                {stockModalSearchTerm && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center z-10">
                    <button
                      type="button"
                      onClick={() => setStockModalSearchTerm("")}
                      className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors active:scale-95 cursor-pointer flex items-center justify-center"
                      title="Limpiar"
                    >
                      <X className="h-3.5 w-3.5 stroke-[2.5]" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-end">
                {(() => {
                  const modalDataStats = getExpirationStats(modalStockData);
                  return (
                    <>
                      {modalDataStats.expiredCount > 0 && (
                        <button
                          onClick={() => {
                            setSelectedSourceId(stockModalSourceId || "");
                            setExpirationModalType("expired");
                            setIsExpirationModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 bg-white hover:bg-rose-50 text-rose-600 px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-bold transition-all shrink-0 shadow-sm cursor-pointer"
                        >
                          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
                          <span>{modalDataStats.expiredCount} Vencidos</span>
                        </button>
                      )}
                      {modalDataStats.expiringThisMonthCount > 0 && (
                        <button
                          onClick={() => {
                            setSelectedSourceId(stockModalSourceId || "");
                            setExpirationModalType("expiring");
                            setIsExpirationModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 bg-white hover:bg-amber-50 text-amber-600 px-4 py-2.5 rounded-xl border border-amber-200 text-sm font-bold transition-all shrink-0 shadow-sm cursor-pointer"
                        >
                          <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                          <span>
                            {modalDataStats.expiringThisMonthCount} Por vencer
                          </span>
                        </button>
                      )}
                    </>
                  );
                })()}
                <button
                  onClick={exportModalStockToExcel}
                  className="flex items-center gap-1.5 bg-white hover:bg-teal-50 text-teal-700 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold transition-all shrink-0 shadow-sm"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  Exportar Stock
                </button>
                <button
                  onClick={() => {
                    setStockModalSourceId(null);
                    setStockModalSearchTerm("");
                  }}
                  className="ml-2 bg-white text-gray-400 hover:text-gray-700 p-2 rounded-xl transition-colors border border-transparent hover:border-gray-200 hover:bg-gray-50 shadow-sm"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Desktop Header */}
            <div className="hidden sm:flex flex-row items-center py-3 px-4 sm:px-8 bg-slate-100/80 border-b border-gray-200 gap-6 shrink-0 font-bold text-xs text-slate-500 uppercase tracking-wider">
              {showsPharmacyInModal && <div className="shrink-0 w-32">Código IPRESS</div>}
              <div className="shrink-0 w-32">SISMED/SIGA</div>
              <div className="flex-1 min-w-0 text-left">
                Descripción del Producto
              </div>
              <div className="shrink-0 w-24 text-right">Saldo</div>
              <div className="shrink-0 w-36 text-left">Lote / Venc.</div>
              <div className="shrink-0 w-28 text-right">Tipos</div>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-auto bg-white p-0 sm:p-2 custom-scrollbar">
              <div className="flex flex-col">
                {modalStockData.length > 0 ? (
                  modalStockData.map((row, i) => (
                    <div
                      key={`m-${i}`}
                      onClick={() => setSelectedRecord(row)}
                      className="flex flex-col sm:flex-row sm:items-center py-4 px-4 sm:px-6 border-b border-gray-100 hover:bg-slate-50 transition-colors cursor-pointer gap-4 sm:gap-6"
                    >
                      {/* Col 0: farmacia dentro de la hoja, solo si hay más de una */}
                      {showsPharmacyInModal && (
                        <div className="shrink-0 sm:w-32">
                          <PharmacyCodeCell label={pharmacyLabelOf(row)} />
                        </div>
                      )}

                      {/* Col 1: IDs */}
                      <div className="flex flex-col shrink-0 sm:w-32">
                        <span className="font-bold text-gray-800 text-sm">
                          {row.ID_Producto || row.CODIGO_ANTERIOR || "-"}
                        </span>
                        <span className="text-[10px] text-gray-400 font-medium mt-0.5">
                          {row.CODIGO_SIG || "-"}
                        </span>
                      </div>

                      {/* Col 2: Name */}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-bold text-gray-900 leading-snug">
                          {row.Nombre || "-"}
                        </span>
                        <span className="text-[10px] text-gray-400 font-medium mt-1">
                          RS: {row.Reg_Sanitario || "S/N"}
                        </span>
                      </div>

                      {/* Col 3: Saldo (Stock) */}
                      <div className="flex items-center justify-end shrink-0 sm:w-24">
                        <span className="text-xl font-black text-gray-900">
                          {!isNaN(parseInt(String(row.Saldo), 10))
                            ? parseInt(String(row.Saldo), 10)
                            : 0}
                        </span>
                      </div>

                      {/* Col 4: Lote & Vence */}
                      <div className="flex flex-col shrink-0 sm:w-36">
                        <span className="text-sm text-gray-700">
                          {row.Lote || "-"}
                        </span>
                        <span className="text-[10px] text-gray-400 mt-1">
                          Vence: {formatDate(row.Fec_Vencim) || "-"}
                        </span>
                      </div>

                      {/* Col 5: Badges */}
                      <div className="flex items-center justify-end gap-2 shrink-0 sm:w-28">
                        {row.TIPSUM && (
                          <span className="inline-flex items-center px-2 py-1 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase border border-indigo-100/50">
                            {row.TIPSUM}
                          </span>
                        )}
                        {row.FFINAN && (
                          <span className="inline-flex items-center px-2 py-1 rounded bg-amber-50 text-amber-600 text-[10px] font-bold uppercase border border-amber-100/50">
                            {row.FFINAN}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-16 text-center">
                    <Search className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">
                      No se encontraron productos en este establecimiento.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalle */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedRecord(null)}
        >
          <div
            className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Minimalista y Elegante */}
            <div className="px-5 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 bg-gradient-to-b from-teal-50/50 to-white flex justify-between items-start relative border-b border-gray-100">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-400 to-blue-500"></div>
              <div className="pr-10 sm:pr-12 w-full">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                  <span className="inline-flex items-center justify-center h-7 sm:h-8 px-3 rounded-full text-[10px] sm:text-xs font-black bg-teal-100 text-teal-800 shadow-sm border border-teal-200/50 whitespace-nowrap">
                    COD: {selectedRecord.ID_Producto || "S/ID"}
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap">
                    SIGA: {selectedRecord.CODIGO_SIG || "-"}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-gray-900 leading-tight tracking-tight break-words">
                  {selectedRecord.Nombre || "Sin Descripción"}
                </h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="absolute top-4 sm:top-6 right-4 sm:right-6 text-gray-400 hover:text-gray-900 hover:bg-gray-100 p-2 sm:p-2.5 rounded-full transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 sm:px-8 pb-5 sm:pb-8 overflow-y-auto max-h-[70vh] custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mt-5 sm:mt-6">
                {/* Estado y Ubicación - Destacado */}
                <div className="col-span-full bg-gray-50/80 rounded-2xl p-4 sm:p-5 border border-gray-100/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                  <div className="w-full sm:w-auto">
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black mb-1">
                      Establecimiento
                    </p>
                    <p className="text-sm border-b border-gray-100/50 pb-2 sm:border-0 sm:pb-0 font-bold text-gray-900 leading-snug">
                      {(selectedRecord.DESC_ALM || "-").replace(
                        /^FARM\s*-\s*/i,
                        "",
                      )}{" "}
                      <span className="text-gray-400 font-medium whitespace-nowrap">
                        ({formatAlmCode(readAlmCode(selectedRecord))})
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto bg-white sm:bg-transparent p-3 sm:p-0 rounded-xl sm:rounded-none border sm:border-0 border-gray-100 mt-2 sm:mt-0">
                    <p className="text-[10px] sm:text-[10px] text-gray-500 uppercase tracking-widest font-black mb-0 sm:mb-1">
                      Saldo Actual
                    </p>
                    <p
                      className={`text-2xl sm:text-3xl font-black leading-none ${parseFloat(String(selectedRecord.Saldo || "0").replace(/,/g, "")) <= 0 ? "text-red-500" : "text-teal-600"}`}
                    >
                      {!isNaN(parseInt(String(selectedRecord.Saldo), 10))
                        ? parseInt(String(selectedRecord.Saldo), 10)
                        : 0}
                    </p>
                  </div>
                </div>

                {/* Bloque de Datos Lote/Vencimiento */}
                <div className="space-y-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                      Control de Calidad
                    </h4>
                  </div>
                  <div className="bg-white space-y-4">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                        Lote
                      </p>
                      <p className="text-sm font-mono font-bold text-gray-800">
                        {selectedRecord.Lote || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                        Fecha de Vencimiento
                      </p>
                      <p
                        className={`text-sm font-black ${(() => {
                          if (!selectedRecord.Fec_Vencim)
                            return "text-gray-800";
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const parts =
                            selectedRecord.Fec_Vencim.split(/[\/\-]/);
                          if (parts.length === 3) {
                            const m = parseInt(parts[1], 10) - 1;
                            const y = parseInt(parts[2], 10);
                            const d = parseInt(parts[0], 10);
                            const fy = y < 100 ? y + 2000 : y;
                            const exp = new Date(fy, m, d);
                            if (exp < today) return "text-red-600";
                            if (
                              m === today.getMonth() &&
                              fy === today.getFullYear()
                            )
                              return "text-amber-600";
                          }
                          return "text-gray-800";
                        })()}`}
                      >
                        {formatDate(selectedRecord.Fec_Vencim) || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                        Registro Sanitario
                      </p>
                      <p className="text-sm font-medium text-gray-800 uppercase">
                        {selectedRecord.Reg_Sanitario || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                        Última Actualización
                      </p>
                      <p className="text-xs font-medium text-gray-500">
                        {formatDate(selectedRecord.Ultima_Actualizacion) || "-"}
                      </p>
                    </div>
                    {selectedRecord.FECHA_DEL_EQUIPO && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                          Fecha del Equipo
                        </p>
                        <p
                          className={`text-xs font-medium ${selectedRecord.FECHA_DEL_EQUIPO !== selectedRecord.Ultima_Actualizacion ? "text-red-500" : "text-slate-400"}`}
                        >
                          {formatDate(selectedRecord.FECHA_DEL_EQUIPO)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bloque de Clasificación y Financiamiento */}
                <div className="space-y-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Database className="w-4 h-4 text-gray-400" />
                    <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                      Clasificación
                    </h4>
                  </div>
                  <div className="bg-white space-y-4">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                        Tipo de Suministro
                      </p>
                      <p className="text-sm font-medium text-gray-800">
                        {selectedRecord.DESC_TIPSUM || "-"}{" "}
                        <span className="text-gray-400 font-bold text-[10px] uppercase ml-1 px-1.5 py-0.5 bg-gray-100 rounded">
                          {selectedRecord.TIPSUM || "-"}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                        F. Financiamiento
                      </p>
                      <p className="text-sm font-medium text-gray-800">
                        {selectedRecord.DESC_FFINAN || "-"}{" "}
                        <span className="text-gray-400 font-bold text-[10px] uppercase ml-1 px-1.5 py-0.5 bg-gray-100 rounded">
                          {selectedRecord.FFINAN || "-"}
                        </span>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                          Precio Compra
                        </p>
                        <p className="text-sm font-black text-gray-900">
                          S/ {selectedRecord.Precio_Det || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-1">
                          Precio Referencial
                        </p>
                        <p className="text-sm font-bold text-gray-500">
                          S/ {selectedRecord.Precio_Cab || "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-8 py-5 bg-gray-50/80 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setSelectedRecord(null)}
                className="bg-white border border-gray-200 text-gray-700 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Expiración */}
      {isExpirationModalOpen && expirationModalType && (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsExpirationModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`p-4 sm:p-6 border-b border-gray-100 flex items-start justify-between ${expirationModalType === "expired" ? "bg-red-50" : "bg-amber-50"}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${expirationModalType === "expired" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}
                >
                  {expirationModalType === "expired" ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <Clock className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">
                    {expirationModalType === "expired"
                      ? `Productos Vencidos (al ${String(new Date().getDate()).padStart(2, "0")}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${new Date().getFullYear()})`
                      : "Productos por Vencer (Este Mes)"}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {expirationModalType === "expired"
                      ? "Atención urgente requerida"
                      : "Asegure la rotación de estos inventarios"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExpirationModalOpen(false)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors shrink-0"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-gray-50/30 p-0">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50/80 sticky top-0 z-10 backdrop-blur-sm">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      Cód. SISMED
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wider"
                    >
                      Descripción del Producto
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-black text-gray-500 uppercase tracking-wider"
                    >
                      Saldo
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-black text-gray-500 uppercase tracking-wider"
                    >
                      Lote / Venc.
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {(expirationModalType === "expired"
                    ? activeSheetExpirationInfo.expired
                    : activeSheetExpirationInfo.expiringThisMonth
                  ).map((row, i) => (
                    <tr
                      key={i}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => {
                        setIsExpirationModalOpen(false);
                        setSelectedRecord(row);
                      }}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded w-fit mb-1">
                            {row.ID_Producto || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="text-sm font-bold text-gray-900 break-words line-clamp-2"
                          title={row.Nombre}
                        >
                          {row.Nombre || "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span
                          className={`text-base font-black ${row.Saldo?.toString() === "0" ? "text-red-500" : "text-gray-900"} bg-gray-50 px-2 py-1 rounded inline-block`}
                        >
                          {row.Saldo || "0"}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 uppercase">
                          {row.Lote || "-"}
                        </div>
                        <div
                          className={`text-[10px] font-bold mt-0.5 ${expirationModalType === "expired" ? "text-red-600" : "text-amber-600"}`}
                        >
                          Vence: {row.Fec_Vencim || "-"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(expirationModalType === "expired"
                ? activeSheetExpirationInfo.expired
                : activeSheetExpirationInfo.expiringThisMonth
              ).length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No hay registros para mostrar.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR DE FILTROS AVANZADOS (DERECHA) */}
      {isAdvancedFiltersSidebarOpen && (
        <div className="fixed inset-0 z-[110000] flex justify-end pointer-events-none">
          {/* Backdrop Click Dismiss (Solo en móvil para no bloquear interacción de fondo en escritorio) */}
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-xs pointer-events-auto md:hidden"
            onClick={() => setIsAdvancedFiltersSidebarOpen(false)}
          />

          {/* Sidebar Container */}
          <div className="relative w-full max-w-sm sm:max-w-md md:w-[380px] xl:w-[420px] md:max-w-none bg-slate-50 h-full shadow-[-12px_0_40px_rgba(0,0,0,0.1),-1px_0_4px_rgba(0,0,0,0.02)] border-l border-slate-200 pointer-events-auto animate-in slide-in-from-right duration-350 flex flex-col overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] z-20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-600 shadow-sm border border-teal-100/50">
                  <Filter className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base tracking-tight uppercase">
                    Filtros Avanzados
                  </h3>
                  <p className="text-[10px] text-teal-600 font-extrabold tracking-widest uppercase">
                    {viewLevel === "data"
                      ? "Filtros del Medicamento"
                      : "Establecimientos de Salud"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAdvancedFiltersSidebarOpen(false)}
                className="p-2 hover:bg-slate-100 active:scale-95 rounded-xl transition-all text-slate-400 hover:text-slate-900 shadow-sm border border-slate-100 hover:border-slate-200 bg-white"
                title="Cerrar filtros"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-6 space-y-6">
              {viewLevel === "data" ? (
                <div className="space-y-6">
                  {/* Estado de Vencimiento */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                          Estado de Vencimiento
                        </h4>
                      </div>
                      {dataFilterExpiration !== "all" && (
                        <button
                          onClick={() => setDataFilterExpiration("all")}
                          className="text-[10px] text-teal-600 hover:text-teal-700 font-extrabold uppercase hover:underline cursor-pointer"
                        >
                          Todos
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          value: "all",
                          label: "Todos",
                          desc: "Sin restricciones",
                        },
                        {
                          value: "expired",
                          label: "Vencidos",
                          desc: "Atención urgente",
                        },
                        {
                          value: "expiring",
                          label: "Por vencer",
                          desc: "Este mes",
                        },
                        { value: "ok", label: "Vigentes", desc: "Buen estado" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDataFilterExpiration(opt.value)}
                          className={`group p-3 rounded-2xl cursor-pointer transition-all border text-left select-none ${
                            dataFilterExpiration === opt.value
                              ? "bg-teal-50/25 border-teal-500/35 text-slate-950 shadow-sm"
                              : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                                dataFilterExpiration === opt.value
                                  ? "bg-teal-600 border-teal-600 text-white scale-100"
                                  : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                              }`}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </div>
                            <span
                              className={`text-[11px] font-bold tracking-tight uppercase ${dataFilterExpiration === opt.value ? "text-teal-950 font-black" : "text-slate-705"}`}
                            >
                              {opt.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 ml-6 leading-none mt-1">
                            {opt.desc}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Vencimiento Avanzado: Mes y Año */}
                  {(() => {
                    const monthsList = [
                      { value: "all", label: "TODOS LOS MESES" },
                      { value: "1", label: "ENERO (01)" },
                      { value: "2", label: "FEBRERO (02)" },
                      { value: "3", label: "MARZO (03)" },
                      { value: "4", label: "ABRIL (04)" },
                      { value: "5", label: "MAYO (05)" },
                      { value: "6", label: "JUNIO (06)" },
                      { value: "7", label: "JULIO (07)" },
                      { value: "8", label: "AGOSTO (08)" },
                      { value: "9", label: "SEPTIEMBRE (09)" },
                      { value: "10", label: "OCTUBRE (10)" },
                      { value: "11", label: "NOVIEMBRE (11)" },
                      { value: "12", label: "DICIEMBRE (12)" },
                    ];
                    return (
                      <div className="space-y-3 bg-slate-50/70 border border-slate-200/60 rounded-2xl p-4">
                        <div className="flex items-center justify-between w-full border-b border-slate-200/40 pb-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-teal-600" />
                            <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-wider">
                              Mes / Año de Vencimiento
                            </h4>
                          </div>
                          {(dataFilterExpMonth !== "all" ||
                            dataFilterExpYear !== "all") && (
                            <button
                              onClick={() => {
                                setDataFilterExpMonth("all");
                                setDataFilterExpYear("all");
                              }}
                              className="text-[10px] text-teal-600 hover:text-teal-700 font-extrabold uppercase hover:underline cursor-pointer"
                            >
                              Limpiar
                            </button>
                          )}
                        </div>

                        <p className="text-[10px] text-slate-400 leading-normal">
                          Ver productos que vencen únicamente en el período de
                          mes y año seleccionado.
                        </p>

                        <div className="grid grid-cols-2 gap-3 pt-1">
                          {/* Mes */}
                          <div className="space-y-1.5 relative">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                              Mes de Vencimiento
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setIsMonthDropdownOpen(!isMonthDropdownOpen);
                                setIsYearDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between pl-3 pr-3 py-2 bg-white border rounded-xl text-[10px] sm:text-[11px] font-bold text-slate-800 uppercase tracking-wide shadow-sm transition-all text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500/50 ${
                                isMonthDropdownOpen
                                  ? "border-teal-500 ring-1 ring-teal-500/30"
                                  : "border-slate-200 hover:border-slate-300"
                              }`}
                            >
                              <span className="truncate">
                                {dataFilterExpMonth === "all"
                                  ? "TODOS LOS MESES"
                                  : monthsList.find(
                                      (m) => m.value === dataFilterExpMonth,
                                    )?.label || dataFilterExpMonth}
                              </span>
                              <ChevronDown
                                className={`h-3 w-3 text-slate-400 stroke-[3] transition-transform duration-200 ${isMonthDropdownOpen ? "rotate-180" : ""}`}
                              />
                            </button>

                            {isMonthDropdownOpen && (
                              <>
                                {/* Click-away backdrop */}
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setIsMonthDropdownOpen(false)}
                                />
                                {/* Options list */}
                                <div className="absolute left-0 right-0 z-50 top-full mt-1.5 bg-white border border-slate-150 rounded-xl shadow-xl max-h-52 overflow-y-auto custom-scrollbar divide-y divide-slate-100/50 py-1 transition-all animate-in fade-in slide-in-from-top-2 duration-200">
                                  {monthsList.map((m) => (
                                    <button
                                      key={m.value}
                                      type="button"
                                      onClick={() => {
                                        setDataFilterExpMonth(m.value);
                                        setIsMonthDropdownOpen(false);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-[10.5px] font-bold tracking-tight uppercase transition-all flex items-center justify-between hover:bg-teal-50/50 cursor-pointer ${
                                        dataFilterExpMonth === m.value
                                          ? "text-teal-905 bg-teal-50/30"
                                          : "text-slate-600 hover:text-slate-900"
                                      }`}
                                    >
                                      <span>{m.label}</span>
                                      {dataFilterExpMonth === m.value && (
                                        <Check className="h-3 w-3 text-teal-600 stroke-[3]" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Año */}
                          <div className="space-y-1.5 relative">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                              Año de Vencimiento
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setIsYearDropdownOpen(!isYearDropdownOpen);
                                setIsMonthDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between pl-3 pr-3 py-2 bg-white border rounded-xl text-[10px] sm:text-[11px] font-bold text-slate-800 uppercase tracking-wide shadow-sm transition-all text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500/50 ${
                                isYearDropdownOpen
                                  ? "border-teal-500 ring-1 ring-teal-500/30"
                                  : "border-slate-200 hover:border-slate-300"
                              }`}
                            >
                              <span className="truncate">
                                {dataFilterExpYear === "all"
                                  ? "TODOS LOS AÑOS"
                                  : dataFilterExpYear}
                              </span>
                              <ChevronDown
                                className={`h-3 w-3 text-slate-400 stroke-[3] transition-transform duration-200 ${isYearDropdownOpen ? "rotate-180" : ""}`}
                              />
                            </button>

                            {isYearDropdownOpen && (
                              <>
                                {/* Click-away backdrop */}
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setIsYearDropdownOpen(false)}
                                />
                                {/* Options list */}
                                <div className="absolute left-0 right-0 z-50 top-full mt-1.5 bg-white border border-slate-150 rounded-xl shadow-xl max-h-52 overflow-y-auto custom-scrollbar divide-y divide-slate-100/50 py-1 transition-all animate-in fade-in slide-in-from-top-2 duration-200">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDataFilterExpYear("all");
                                      setIsYearDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-[10.5px] font-bold tracking-tight uppercase transition-all flex items-center justify-between hover:bg-teal-50/50 cursor-pointer ${
                                      dataFilterExpYear === "all"
                                        ? "text-teal-905 bg-teal-50/30"
                                        : "text-slate-600 hover:text-slate-900"
                                    }`}
                                  >
                                    <span>TODOS LOS AÑOS</span>
                                    {dataFilterExpYear === "all" && (
                                      <Check className="h-3 w-3 text-teal-600 stroke-[3]" />
                                    )}
                                  </button>
                                  {availableYears.map((yr) => (
                                    <button
                                      key={yr}
                                      type="button"
                                      onClick={() => {
                                        setDataFilterExpYear(yr);
                                        setIsYearDropdownOpen(false);
                                      }}
                                      className={`w-full text-left px-3 py-2 text-[10.5px] font-bold tracking-tight uppercase transition-all flex items-center justify-between hover:bg-teal-50/50 cursor-pointer ${
                                        dataFilterExpYear === yr
                                          ? "text-teal-905 bg-teal-50/30"
                                          : "text-slate-600 hover:text-slate-900"
                                      }`}
                                    >
                                      <span>{yr}</span>
                                      {dataFilterExpYear === yr && (
                                        <Check className="h-3 w-3 text-teal-600 stroke-[3]" />
                                      )}
                                    </button>
                                  ))}
                                  {dataFilterExpYear !== "all" &&
                                    !availableYears.includes(
                                      dataFilterExpYear,
                                    ) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDataFilterExpYear(
                                            dataFilterExpYear,
                                          );
                                          setIsYearDropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-[10.5px] font-black tracking-tight uppercase bg-teal-50/20 text-teal-905 flex items-center justify-between"
                                      >
                                        <span>{dataFilterExpYear}</span>
                                        <Check className="h-3 w-3 text-teal-600 stroke-[3]" />
                                      </button>
                                    )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Manual Input field next to it for advanced typed search or if year isn't in database list */}
                        <div className="pt-2 border-t border-slate-200/40 flex items-center gap-2">
                          <div className="flex-1">
                            <input
                              type="text"
                              placeholder="Año de 4 dígitos manualmente..."
                              value={
                                dataFilterExpYear === "all"
                                  ? ""
                                  : dataFilterExpYear
                              }
                              onChange={(e) => {
                                const cleanVal = e.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 4);
                                setDataFilterExpYear(cleanVal || "all");
                              }}
                              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-medium text-slate-700 placeholder-slate-450 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm transition-all text-center"
                            />
                          </div>
                          {dataFilterExpYear !== "all" && (
                            <span className="text-[9px] bg-teal-50 border border-teal-200/50 text-teal-700 px-2 py-1 rounded-lg font-black uppercase tracking-wider shrink-0">
                              Año: {dataFilterExpYear}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Disponibilidad de Stock */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                          Disponibilidad de Stock
                        </h4>
                      </div>
                      {dataFilterStock !== "all" && (
                        <button
                          onClick={() => setDataFilterStock("all")}
                          className="text-[10px] text-teal-600 hover:text-teal-700 font-extrabold uppercase hover:underline cursor-pointer"
                        >
                          Todos
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {[
                        {
                          value: "all",
                          label: "Todos los productos",
                          countText: "Sin límite",
                        },
                        {
                          value: "with_stock",
                          label: "Con Stock actual",
                          countText: "Saldo > 0",
                        },
                        {
                          value: "no_stock",
                          label: "Sin Stock (Agotados)",
                          countText: "Saldo = 0",
                        },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDataFilterStock(opt.value)}
                          className={`group w-full flex items-center justify-between p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                            dataFilterStock === opt.value
                              ? "bg-teal-50/25 border-teal-500/35 text-slate-950 shadow-sm"
                              : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-305"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                                dataFilterStock === opt.value
                                  ? "bg-teal-600 border-teal-600 text-white scale-100"
                                  : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                              }`}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </div>
                            <span
                              className={`text-[11px] font-bold tracking-tight uppercase ${dataFilterStock === opt.value ? "text-teal-950 font-black" : "text-slate-700"}`}
                            >
                              {opt.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-455 font-extrabold px-2 py-0.5 rounded-lg bg-slate-100/75 border border-slate-200/40">
                            {opt.countText}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tipo de Suministro */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                          Tipo de Suministro
                        </h4>
                      </div>
                      {dataFilterTipsum !== "all" && (
                        <button
                          onClick={() => setDataFilterTipsum("all")}
                          className="text-[10px] text-teal-600 hover:text-teal-700 font-extrabold uppercase hover:underline cursor-pointer"
                        >
                          Todos
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: "all", label: "Todos" },
                        ...availableTipsums.map((val) => ({
                          value: val,
                          label: val,
                        })),
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDataFilterTipsum(opt.value)}
                          className={`group p-3 rounded-2xl cursor-pointer transition-all border text-left select-none ${
                            dataFilterTipsum === opt.value
                              ? "bg-teal-50/25 border-teal-500/35 text-slate-950 shadow-sm"
                              : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                                dataFilterTipsum === opt.value
                                  ? "bg-teal-600 border-teal-600 text-white scale-100"
                                  : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                              }`}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </div>
                            <span
                              className={`text-[11px] font-bold tracking-tight uppercase ${dataFilterTipsum === opt.value ? "text-teal-950 font-black" : "text-slate-700"}`}
                            >
                              {opt.label}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fuente de Financiamiento */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                          Fuente de Financiamiento
                        </h4>
                      </div>
                      {dataFilterFFinan !== "all" && (
                        <button
                          onClick={() => setDataFilterFFinan("all")}
                          className="text-[10px] text-teal-600 hover:text-teal-700 font-extrabold uppercase hover:underline cursor-pointer"
                        >
                          Todos
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: "all", label: "Todos" },
                        ...availableFFinans.map((val) => ({
                          value: val,
                          label: val,
                        })),
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDataFilterFFinan(opt.value)}
                          className={`group p-3 rounded-2xl cursor-pointer transition-all border text-left select-none ${
                            dataFilterFFinan === opt.value
                              ? "bg-teal-50/25 border-teal-500/35 text-slate-950 shadow-sm"
                              : "bg-white border-slate-200/60 text-slate-605 hover:bg-slate-50 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                                dataFilterFFinan === opt.value
                                  ? "bg-teal-600 border-teal-600 text-white scale-100"
                                  : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                              }`}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </div>
                            <span
                              className={`text-[11px] font-bold tracking-tight uppercase ${dataFilterFFinan === opt.value ? "text-teal-950 font-black" : "text-slate-700"}`}
                            >
                              {opt.label}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Filter Section: Type */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between items-center w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                          Tipo de Establecimiento
                        </h4>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => {
                            setFilter_CS(true);
                            setFilter_PS(true);
                            setFilter_ALM(true);
                            setFilter_HOSP(true);
                            setFilter_OTRO(true);
                          }}
                          className="text-teal-600 hover:text-teal-700 font-black hover:underline cursor-pointer active:scale-95 transition-all"
                        >
                          Todos
                        </button>
                        <span className="text-slate-300 select-none">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFilter_CS(false);
                            setFilter_PS(false);
                            setFilter_ALM(false);
                            setFilter_HOSP(false);
                            setFilter_OTRO(false);
                          }}
                          className="text-slate-500 hover:text-slate-700 hover:underline cursor-pointer active:scale-95 transition-all"
                        >
                          Ninguno
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {/* C.S. */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_CS
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_CS}
                          onChange={(e) => setFilter_CS(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_CS
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex justify-between items-center w-full">
                          <span
                            className={`text-xs font-extrabold transition-colors ${filter_CS ? "text-teal-950 font-extrabold" : "text-slate-700 font-semibold"}`}
                          >
                            Centro de Salud (C.S.)
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border transition-all ${
                              filter_CS
                                ? "bg-teal-50 text-teal-850 border-teal-200/55 shadow-xs"
                                : "bg-slate-50 text-slate-500 border-slate-200/50"
                            }`}
                          >
                            C.S. {establishmentSummary?.cs ?? 0}
                          </span>
                        </div>
                      </label>

                      {/* P.S. */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_PS
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_PS}
                          onChange={(e) => setFilter_PS(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_PS
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex justify-between items-center w-full">
                          <span
                            className={`text-xs font-extrabold transition-colors ${filter_PS ? "text-teal-950 font-extrabold" : "text-slate-700 font-semibold"}`}
                          >
                            Puesto de Salud (P.S.)
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border transition-all ${
                              filter_PS
                                ? "bg-teal-50 text-teal-850 border-teal-200/55 shadow-xs"
                                : "bg-slate-50 text-slate-500 border-slate-200/50"
                            }`}
                          >
                            P.S. {establishmentSummary?.ps ?? 0}
                          </span>
                        </div>
                      </label>

                      {/* ALM */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_ALM
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_ALM}
                          onChange={(e) => setFilter_ALM(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_ALM
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex justify-between items-center w-full">
                          <span
                            className={`text-xs font-extrabold transition-colors ${filter_ALM ? "text-teal-950 font-extrabold" : "text-slate-700 font-semibold"}`}
                          >
                            Almacén (ALM)
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border transition-all ${
                              filter_ALM
                                ? "bg-teal-50 text-teal-850 border-teal-200/55 shadow-xs"
                                : "bg-slate-50 text-slate-500 border-slate-200/50"
                            }`}
                          >
                            ALM {establishmentSummary?.alm ?? 0}
                          </span>
                        </div>
                      </label>

                      {/* HOSP */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_HOSP
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_HOSP}
                          onChange={(e) => setFilter_HOSP(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_HOSP
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex justify-between items-center w-full">
                          <span
                            className={`text-xs font-extrabold transition-colors ${filter_HOSP ? "text-teal-950 font-extrabold" : "text-slate-700 font-semibold"}`}
                          >
                            Hospital (HOSP)
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border transition-all ${
                              filter_HOSP
                                ? "bg-teal-50 text-teal-850 border-teal-200/55 shadow-xs"
                                : "bg-slate-50 text-slate-500 border-slate-200/50"
                            }`}
                          >
                            HOSP {establishmentSummary?.hosp ?? 0}
                          </span>
                        </div>
                      </label>

                      {/* Otros */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_OTRO
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_OTRO}
                          onChange={(e) => setFilter_OTRO(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_OTRO
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex justify-between items-center w-full">
                          <span
                            className={`text-xs font-extrabold transition-colors ${filter_OTRO ? "text-teal-950 font-extrabold" : "text-slate-700 font-semibold"}`}
                          >
                            Otros
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border transition-all ${
                              filter_OTRO
                                ? "bg-teal-50 text-teal-855 border-teal-200/55 shadow-xs"
                                : "bg-slate-50 text-slate-500 border-slate-200/50"
                            }`}
                          >
                            Otro{" "}
                            {sources && selectedUngetIndex !== null
                              ? sources.filter(
                                  (s) => s.urlIndex === selectedUngetIndex,
                                ).length -
                                ((establishmentSummary?.cs ?? 0) +
                                  (establishmentSummary?.ps ?? 0) +
                                  (establishmentSummary?.alm ?? 0) +
                                  (establishmentSummary?.hosp ?? 0))
                              : 0}
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Filter Section: Last Update Status (Color) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between items-center w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                          Estado de Actualización
                        </h4>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => {
                            setFilter_emerald(true);
                            setFilter_amber(true);
                            setFilter_red(true);
                            setFilter_gray(true);
                          }}
                          className="text-teal-600 hover:text-teal-700 font-black hover:underline cursor-pointer active:scale-95 transition-all"
                        >
                          Todos
                        </button>
                        <span className="text-slate-300 select-none">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFilter_emerald(false);
                            setFilter_amber(false);
                            setFilter_red(false);
                            setFilter_gray(false);
                          }}
                          className="text-slate-500 hover:text-slate-700 hover:underline cursor-pointer active:scale-95 transition-all"
                        >
                          Ninguno
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {/* Al día */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_emerald
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_emerald}
                          onChange={(e) => setFilter_emerald(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_emerald
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white shrink-0 shadow-sm animate-pulse" />
                            <span
                              className={`text-xs font-bold transition-colors ${filter_emerald ? "text-slate-900 font-black" : "text-slate-700 font-semibold"}`}
                            >
                              En Línea
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold">
                            &lt;1 hora sin actualizar
                          </span>
                        </div>
                      </label>

                      {/* Desconectados */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_amber
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_amber}
                          onChange={(e) => setFilter_amber(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_amber
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white shrink-0 shadow-sm" />
                            <span
                              className={`text-xs font-bold transition-colors ${filter_amber ? "text-slate-900 font-black" : "text-slate-700 font-semibold"}`}
                            >
                              Desactualizados
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold">
                            &gt;1 y &lt;24 horas
                          </span>
                        </div>
                      </label>

                      {/* Crítico */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_red
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_red}
                          onChange={(e) => setFilter_red(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_red
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white shrink-0 shadow-sm" />
                            <span
                              className={`text-xs font-bold transition-colors ${filter_red ? "text-slate-900 font-black" : "text-slate-700 font-semibold"}`}
                            >
                              Fuera de Línea
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold">
                            &gt;24 horas
                          </span>
                        </div>
                      </label>

                      {/* Sin Datos / Desconectado */}
                      <label
                        className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border select-none ${
                          filter_gray
                            ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={filter_gray}
                          onChange={(e) => setFilter_gray(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                            filter_gray
                              ? "bg-teal-600 border-teal-600 text-white scale-100"
                              : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 border border-white shrink-0 shadow-sm" />
                          <span
                            className={`text-xs font-bold transition-colors ${filter_gray ? "text-slate-905 font-black" : "text-slate-700 font-semibold"}`}
                          >
                            Sin Datos / Desconectado
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Filter Section: Update Date Limit */}
                  {renderRangeFilter(
                    filterDateUnit,
                    setFilterDateUnit,
                    filterDateValue,
                    setFilterDateValue,
                    filterDateCondition,
                    setFilterDateCondition,
                    "Antigüedad de Sincronización",
                    "ACT.",
                    "NO ACT.",
                    "ACTUALIZADOS",
                    "NO ACTUALIZADOS",
                  )}

                  {/* Filter Section: Movements Date Limit */}
                  {renderRangeFilter(
                    filterMovementsUnit,
                    setFilterMovementsUnit,
                    filterMovementsValue,
                    setFilterMovementsValue,
                    filterMovementsCondition,
                    setFilterMovementsCondition,
                    "Antigüedad de Últimos Movimientos",
                    "CON MOV.",
                    "SIN MOV.",
                    "CON MOVIMIENTOS",
                    "SIN MOVIMIENTOS",
                  )}

                  {/* Filter Section: Sorting */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                      <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                        Ordenamiento
                      </h4>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSortOrderDropdownOpen(!isSortOrderDropdownOpen);
                        }}
                        className="flex items-center justify-between w-full px-4 py-3 bg-white border border-slate-200 hover:border-slate-300 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/15"
                      >
                        <div className="flex items-center gap-2.5">
                          <Settings className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-extrabold text-slate-700">
                            {filterSortOrder === "name_asc" &&
                              "Nombre del Establecimiento (A-Z)"}
                            {filterSortOrder === "name_desc" &&
                              "Nombre del Establecimiento (Z-A)"}
                            {filterSortOrder === "date_newest" &&
                              "Sincronización más reciente primero"}
                            {filterSortOrder === "date_oldest" &&
                              "Sincronización más antigua primero"}
                            {filterSortOrder === "expired_highest" &&
                              "Mayor número de productos vencidos"}
                          </span>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 text-slate-400 transition-transform duration-250 ${isSortOrderDropdownOpen ? "rotate-180 text-teal-600" : ""}`}
                        />
                      </button>

                      {isSortOrderDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-30"
                            onClick={() => setIsSortOrderDropdownOpen(false)}
                          />
                          <div className="absolute left-0 right-0 bottom-full mb-2 bg-white border border-slate-100 rounded-2xl shadow-[0_-12px_30px_rgba(0,0,0,0.08)] z-40 overflow-hidden divide-y divide-slate-50 py-1 animate-in fade-in slide-in-from-bottom-2 duration-200">
                            {[
                              {
                                value: "name_asc",
                                label: "Nombre del Establecimiento (A-Z)",
                              },
                              {
                                value: "name_desc",
                                label: "Nombre del Establecimiento (Z-A)",
                              },
                              {
                                value: "date_newest",
                                label: "Sincronización más reciente primero",
                              },
                              {
                                value: "date_oldest",
                                label: "Sincronización más antigua primero",
                              },
                              {
                                value: "expired_highest",
                                label: "Mayor número de productos vencidos",
                              },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  setFilterSortOrder(option.value as any);
                                  setIsSortOrderDropdownOpen(false);
                                }}
                                className={`flex items-center justify-between w-full px-4 py-3 text-left text-xs font-extrabold transition-all cursor-pointer ${
                                  filterSortOrder === option.value
                                    ? "bg-teal-50/65 text-teal-950 font-black"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                }`}
                              >
                                <span>{option.label}</span>
                                {filterSortOrder === option.value && (
                                  <Check className="h-3.5 w-3.5 text-teal-600 stroke-[3]" />
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Filter Section: Expirations */}
                  <div className="space-y-3 pb-8">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                      <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                        Alertas y Vencimientos
                      </h4>
                    </div>
                    <label
                      className={`group flex items-center gap-3.5 p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                        filterHasPendingExpirations
                          ? "bg-red-50/25 border-red-200 text-slate-900 shadow-sm"
                          : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-red-200/50 shadow-xs"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={filterHasPendingExpirations}
                        onChange={(e) =>
                          setFilterHasPendingExpirations(e.target.checked)
                        }
                        className="sr-only"
                      />
                      <div
                        className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                          filterHasPendingExpirations
                            ? "bg-red-600 border-red-600 text-white scale-100"
                            : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                        }`}
                      >
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                      <div className="flex items-center gap-2.5">
                        <AlertTriangle
                          className={`h-4.5 w-4.5 shrink-0 ${filterHasPendingExpirations ? "text-red-600 animate-pulse" : "text-slate-400"}`}
                        />
                        <span
                          className={`text-xs font-bold leading-tight ${filterHasPendingExpirations ? "text-red-950 font-extrabold" : "text-slate-705 group-hover:text-red-700"}`}
                        >
                          Mostrar sólo establecimientos con productos por vencer
                          / vencidos
                        </span>
                      </div>
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="px-6 py-5 border-t border-slate-100 bg-white/95 backdrop-blur-md flex items-center justify-between gap-3 sticky bottom-0 z-20 shrink-0 shadow-[0_-4px_15px_rgba(0,0,0,0.03)]">
              <button
                onClick={() => {
                  if (viewLevel === "data") {
                    setDataFilterTipsum("all");
                    setDataFilterFFinan("all");
                    setDataFilterStock("all");
                    setDataFilterExpiration("all");
                    setDataFilterExpMonth("all");
                    setDataFilterExpYear("all");
                  } else {
                    setFilter_CS(true);
                    setFilter_PS(true);
                    setFilter_ALM(true);
                    setFilter_HOSP(true);
                    setFilter_OTRO(true);
                    setFilter_emerald(true);
                    setFilter_amber(true);
                    setFilter_red(true);
                    setFilter_gray(true);
                    setFilterSortOrder("name_asc");
                    setFilterHasPendingExpirations(false);
                    setFilterDateUnit("hours");
                    setFilterDateValue(0);
                    setFilterDateCondition("with");
                    setFilterMovementsUnit("hours");
                    setFilterMovementsValue(0);
                    setFilterMovementsCondition("with");
                  }
                }}
                className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 font-extrabold text-[11px] uppercase tracking-wider rounded-xl border border-slate-200 shadow-sm transition-all shrink-0 active:scale-95"
              >
                Reestablecer
              </button>
              <button
                onClick={() => setIsAdvancedFiltersSidebarOpen(false)}
                className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl shadow-lg shadow-teal-600/15 hover:shadow-teal-600/25 transition-all text-center active:scale-95"
              >
                {viewLevel === "data"
                  ? `Aplicar (${filteredData.length} Prod.)`
                  : `Aplicar (${filteredAndSortedSources.length} Est.)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE OPCIONES DE EXPORTACIÓN (CENTRADITO) */}
      {isExportOptionsModalOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/45 backdrop-blur-xs animate-in fade-in duration-200 p-4">
          {/* Backdrop Click Dismiss */}
          <div
            className="absolute inset-0"
            onClick={() => setIsExportOptionsModalOpen(false)}
          />

          {/* Modal Card */}
          <div className="relative w-full max-w-lg bg-slate-50 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-teal-50 rounded-2xl flex items-center justify-center text-teal-600 border border-teal-100 shadow-[0_4px_12px_rgba(13,148,136,0.08)]">
                  <FileSpreadsheet className="h-5.5 w-5.5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base tracking-tight uppercase">
                    Exportación de Stock Detallado
                  </h3>
                  <p className="text-[10px] text-teal-600 font-extrabold tracking-widest uppercase">
                    Consolidado:{" "}
                    {exportScope === "single" && selectedUngetIndex !== null
                      ? formatDisplayName(scriptUrls[selectedUngetIndex]?.name || "UNGET")
                      : "TODAS LAS UNGETs (REGIONAL)"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExportOptionsModalOpen(false)}
                className="p-2 hover:bg-slate-100 active:scale-95 rounded-xl transition-all text-slate-400 hover:text-slate-900 border border-slate-100 hover:border-slate-200 bg-white shadow-sm"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[65vh]">
              {/* Section: Establishment Type */}
              <div className="space-y-3">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                      Tipo de Establecimiento
                    </h4>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setExportCS(true);
                        setExportPS(true);
                        setExportALM(true);
                        setExportHOSP(true);
                        setExportOTRO(true);
                      }}
                      className="text-teal-600 hover:text-teal-700 font-black hover:underline cursor-pointer active:scale-95 transition-all"
                    >
                      Todos
                    </button>
                    <span className="text-slate-300 select-none">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        setExportCS(false);
                        setExportPS(false);
                        setExportALM(false);
                        setExportHOSP(false);
                        setExportOTRO(false);
                      }}
                      className="text-slate-500 hover:text-slate-700 hover:underline cursor-pointer active:scale-95 transition-all"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* C.S. */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportCS
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportCS}
                      onChange={(e) => setExportCS(e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`text-xs font-extrabold transition-colors ${exportCS ? "text-teal-950 font-extrabold" : "text-slate-705 font-semibold"}`}
                    >
                      Centro de Salud (C.S.)
                    </span>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportCS
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* P.S. */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportPS
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportPS}
                      onChange={(e) => setExportPS(e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`text-xs font-extrabold transition-colors ${exportPS ? "text-teal-950 font-extrabold" : "text-slate-705 font-semibold"}`}
                    >
                      Puesto de Salud (P.S.)
                    </span>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportPS
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* ALM */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportALM
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportALM}
                      onChange={(e) => setExportALM(e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`text-xs font-extrabold transition-colors ${exportALM ? "text-teal-950 font-extrabold" : "text-slate-705 font-semibold"}`}
                    >
                      Almacén (ALM)
                    </span>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportALM
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* HOSP */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportHOSP
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportHOSP}
                      onChange={(e) => setExportHOSP(e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`text-xs font-extrabold transition-colors ${exportHOSP ? "text-teal-950 font-extrabold" : "text-slate-705 font-semibold"}`}
                    >
                      Hospital (HOSP)
                    </span>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportHOSP
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* OTRO */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer col-span-2 transition-all border select-none ${
                      exportOTRO
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportOTRO}
                      onChange={(e) => setExportOTRO(e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`text-xs font-extrabold transition-colors ${exportOTRO ? "text-teal-950 font-extrabold" : "text-slate-705 font-semibold"}`}
                    >
                      Otros / Sin Clasificar
                    </span>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportOTRO
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>
                </div>
              </div>

              {/* Section: Status Update (Color) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                      Estado de Actualización
                    </h4>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setExportEmerald(true);
                        setExportAmber(true);
                        setExportRed(true);
                        setExportGray(true);
                      }}
                      className="text-teal-600 hover:text-teal-700 font-black hover:underline cursor-pointer active:scale-95 transition-all"
                    >
                      Todos
                    </button>
                    <span className="text-slate-300 select-none">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        setExportEmerald(false);
                        setExportAmber(false);
                        setExportRed(false);
                        setExportGray(false);
                      }}
                      className="text-slate-500 hover:text-slate-700 hover:underline cursor-pointer active:scale-95 transition-all"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* Emerald */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportEmerald
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportEmerald}
                      onChange={(e) => setExportEmerald(e.target.checked)}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2 font-extrabold text-xs">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <span
                        className={
                          exportEmerald
                            ? "text-slate-900 font-extrabold"
                            : "text-slate-700 font-semibold"
                        }
                      >
                        En Línea (&lt;1h)
                      </span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportEmerald
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* Amber */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportAmber
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportAmber}
                      onChange={(e) => setExportAmber(e.target.checked)}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2 font-extrabold text-xs">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                      <span
                        className={
                          exportAmber
                            ? "text-slate-900 font-extrabold"
                            : "text-slate-700 font-semibold"
                        }
                      >
                        Desactualizados (&gt;1h)
                      </span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportAmber
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* Red */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportRed
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportRed}
                      onChange={(e) => setExportRed(e.target.checked)}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2 font-extrabold text-xs">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                      <span
                        className={
                          exportRed
                            ? "text-slate-900 font-extrabold"
                            : "text-slate-700 font-semibold"
                        }
                      >
                        Fuera Línea (&gt;24h)
                      </span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportRed
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>

                  {/* Gray */}
                  <label
                    className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                      exportGray
                        ? "bg-teal-50/25 border-teal-500/35 text-slate-900 shadow-sm"
                        : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={exportGray}
                      onChange={(e) => setExportGray(e.target.checked)}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2 font-extrabold text-xs">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                      <span
                        className={
                          exportGray
                            ? "text-slate-900 font-extrabold"
                            : "text-slate-700 font-semibold"
                        }
                      >
                        Sin Datos
                      </span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                        exportGray
                          ? "bg-teal-600 border-teal-600 text-white scale-100"
                          : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                      }`}
                    >
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </label>
                </div>
              </div>

              {/* Section: Update Date Limit */}
              {renderRangeFilter(
                exportDateUnit,
                setExportDateUnit,
                exportDateValue,
                setExportDateValue,
                exportDateCondition,
                setExportDateCondition,
                "Antigüedad de Sincronización",
                "ACT.",
                "NO ACT.",
                "ACTUALIZADOS",
                "NO ACTUALIZADOS",
              )}

              {/* Section: Expirations filter */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-3 bg-teal-500 rounded-full" />
                  <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    Medicamentos y Filtros adicionales
                  </h4>
                </div>
                <label
                  className={`group flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border select-none ${
                    exportHasPendingExpirations
                      ? "bg-red-50/25 border-red-200 text-slate-900 shadow-sm"
                      : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-red-200/50 shadow-xs"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={exportHasPendingExpirations}
                    onChange={(e) =>
                      setExportHasPendingExpirations(e.target.checked)
                    }
                    className="sr-only"
                  />
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle
                      className={`h-4.5 w-4.5 shrink-0 ${exportHasPendingExpirations ? "text-red-650 animate-pulse" : "text-slate-400"}`}
                    />
                    <span
                      className={`text-xs font-bold leading-tight ${exportHasPendingExpirations ? "text-red-950 font-extrabold" : "text-slate-705 group-hover:text-red-700"}`}
                    >
                      Exportar únicamente medicamentos vencidos o por vencer
                    </span>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                      exportHasPendingExpirations
                        ? "bg-red-600 border-red-600 text-white scale-100"
                        : "border-slate-300 bg-white text-transparent group-hover:border-slate-400"
                    }`}
                  >
                    <Check className="h-3 w-3 stroke-[3]" />
                  </div>
                </label>
              </div>
            </div>

            {/* Footer Details & Buttons */}
            <div className="px-6 py-5 border-t border-slate-100 bg-white/95 backdrop-blur-md flex flex-col sm:flex-row items-center sm:justify-between gap-4 sticky bottom-0 z-10 shrink-0 shadow-[0_-4px_15px_rgba(0,0,0,0.03)]">
              <div className="text-center sm:text-left">
                <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest leading-none">
                  Total Seleccionado
                </p>
                <p className="text-sm font-black text-teal-950 mt-1">
                  {filteredExportSourcesCount}{" "}
                  {filteredExportSourcesCount === 1
                    ? "establecimiento"
                    : "establecimientos"}
                </p>
              </div>

              <div className="w-full sm:w-auto">
                <button
                  onClick={executeExportAllEstablishmentsToExcel}
                  disabled={filteredExportSourcesCount === 0}
                  className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 text-white font-black text-[11px] uppercase tracking-widest rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer ${
                    filteredExportSourcesCount === 0
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border border-slate-200"
                      : "bg-teal-600 hover:bg-teal-700 shadow-teal-600/15 hover:shadow-teal-600/25 border border-teal-600/10"
                  }`}
                  type="button"
                >
                  <Download className="h-4.5 w-4.5 shrink-0" />
                  <span>Exportar Excel</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE REPORTE GENERAL */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/45 backdrop-blur-xs animate-in fade-in duration-200 p-4">
          <div
            className="absolute inset-0"
            onClick={() => setIsReportModalOpen(false)}
          />
          <div className="bg-slate-50 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.3)] relative flex flex-col border border-white overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between text-teal-950 bg-white sticky top-0 z-10 gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                  Reporte General de Actualización
                </h2>
                <p className="text-[11px] font-bold text-slate-400">
                  Panel de control y estado de sincronización por
                  establecimiento.
                </p>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={exportReportToExcel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg text-[10px] sm:text-[11px] font-black uppercase tracking-wider border border-green-200 transition-colors cursor-pointer shrink-0"
                  title="Descargar Excel"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Exportar a Excel</span>
                </button>
                <div className="h-6 w-px bg-slate-200 mx-1"></div>
                <button
                  onClick={() => setIsReportModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors group cursor-pointer border border-transparent hover:border-slate-200 shrink-0"
                  title="Cerrar Reporte"
                >
                  <X className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 overscroll-contain">
              <div
                ref={reportTableRef}
                className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.03)] overflow-hidden"
              >
                <div className="w-full overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50/80 select-none">
                      <tr>
                        <th
                          scope="col"
                          className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider w-[40%] cursor-pointer hover:bg-slate-100/50 transition-colors"
                          onClick={() =>
                            setReportSort({
                              field: "name",
                              order:
                                reportSort.field === "name" &&
                                reportSort.order === "asc"
                                  ? "desc"
                                  : "asc",
                            })
                          }
                        >
                          <div className="flex items-center gap-1.5">
                            Establecimiento
                            {reportSort.field === "name" ? (
                              reportSort.order === "asc" ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-slate-300" />
                            )}
                          </div>
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-wider w-[20%] hidden sm:table-cell cursor-pointer hover:bg-slate-100/50 transition-colors"
                          onClick={() =>
                            setReportSort({
                              field: "status",
                              order:
                                reportSort.field === "status" &&
                                reportSort.order === "asc"
                                  ? "desc"
                                  : "asc",
                            })
                          }
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            Estado
                            {reportSort.field === "status" ? (
                              reportSort.order === "asc" ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-slate-300" />
                            )}
                          </div>
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-wider w-[20%] hidden sm:table-cell"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            Equipo
                          </div>
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider w-[20%] cursor-pointer hover:bg-slate-100/50 transition-colors"
                          onClick={() =>
                            setReportSort({
                              field: "date",
                              order:
                                reportSort.field === "date" &&
                                reportSort.order === "desc"
                                  ? "asc"
                                  : "desc",
                            })
                          }
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            Sincronización
                            {reportSort.field === "date" ? (
                              reportSort.order === "asc" ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-slate-300" />
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {sortedReportSources.map((sheet) => {
                        const description = describeSheetName(sheet.name);
                        const code = codeForSheet(sheet.id);
                        const status = getUpdateStatus(sheet.lastUpdateTime);
                        const dateStr = sheet.lastUpdateTime
                          ? formatFullDate(sheet.lastUpdateTime)
                          : "No sincronizado";
                        const equipoDateStr = sheet.equipmentDateTime
                          ? formatFullDate(sheet.equipmentDateTime)
                          : "Sin fecha";

                        return (
                          <tr
                            key={sheet.id}
                            className="hover:bg-slate-50/60 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-extrabold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md shrink-0 border border-teal-100">
                                  {code || "N/A"}
                                </span>
                                <span className="text-[11px] sm:text-xs font-black text-slate-800 line-clamp-2">
                                  {description}
                                </span>
                              </div>
                              {/* Mobile status indicator */}
                              <div className="sm:hidden mt-1.5 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100 inline-flex">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span
                                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${status.color}`}
                                  />
                                  <span
                                    className={`relative inline-flex rounded-full h-1.5 w-1.5 ${status.color}`}
                                  />
                                </span>
                                <span className="text-[9px] font-bold text-slate-600">
                                  {status.label}
                                </span>
                              </div>
                              <div className="md:hidden mt-1.5 flex flex-col gap-0.5 w-full">
                                <span className="text-[9px] font-bold text-slate-500">
                                  Actualizado: {dateStr}
                                </span>
                                {sheet.equipmentDateTime && (
                                  <span
                                    className={`text-[9px] font-bold ${!datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime) ? "text-red-500" : "text-slate-500"}`}
                                  >
                                    Equipo: {equipoDateStr}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center hidden sm:table-cell">
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200">
                                <span className="relative flex h-2 w-2">
                                  <span
                                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${status.color}`}
                                  />
                                  <span
                                    className={`relative inline-flex rounded-full h-2 w-2 ${status.color}`}
                                  />
                                </span>
                                <span className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
                                  {status.label}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center hidden sm:table-cell">
                              <div
                                className={`inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold whitespace-nowrap ${!datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime) ? "text-red-500" : "text-slate-500"}`}
                              >
                                <Monitor
                                  className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${!datesMatch(sheet.lastUpdateTime, sheet.equipmentDateTime) ? "text-red-400" : "text-slate-400"}`}
                                />
                                {equipoDateStr}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5 text-[10px] sm:text-xs font-bold text-slate-500 whitespace-nowrap">
                                <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400" />
                                {dateStr}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sortedReportSources.length === 0 && (
                    <div className="py-12 text-center text-slate-500 text-xs font-bold">
                      No hay establecimientos para mostrar según los filtros
                      actuales.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Historial de Sincronización Supabase */}
      {isSyncHistoryModalOpen && activeHistoryFacility && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/45 backdrop-blur-xs animate-in fade-in duration-250 p-4">
          <div
            className="absolute inset-0"
            onClick={() => setIsSyncHistoryModalOpen(false)}
          />
          <div className="bg-slate-50 w-full max-w-xl max-h-[85vh] rounded-3xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.35)] relative flex flex-col border border-white overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white text-slate-900 sticky top-0 z-10">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-black uppercase tracking-wider flex items-center gap-2 text-teal-900">
                  <Database className="h-4 w-4 text-teal-600 shrink-0" />
                  Historial de Cambios de Stock
                </h2>
                <p className="text-[11px] font-bold text-slate-400 truncate max-w-xs sm:max-w-md">
                  {activeHistoryFacility.name}
                </p>
              </div>
              <button
                onClick={() => setIsSyncHistoryModalOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors group cursor-pointer"
              >
                <X className="h-5 w-5 text-slate-400 group-hover:text-slate-600" />
              </button>
            </div>

            {/* History list */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/55 scrollbar-thin">
              {isLoadingHistory ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-10 h-10 text-teal-500 animate-spin" />
                  <span className="text-xs font-black uppercase tracking-wide">
                    Cargando historial de cambios...
                  </span>
                </div>
              ) : selectedFacilitySyncHistory.length === 0 ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                  <Database className="w-10 h-10 text-slate-300" />
                  <span className="text-xs font-black uppercase tracking-wide">
                    No hay movimientos registrados
                  </span>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedFacilitySyncHistory.map((item, index) => {
                    const syncDate = new Date(item.sync_date);
                    const formattedDate = syncDate.toLocaleDateString("es-PE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    });
                    const formattedTime = syncDate.toLocaleTimeString("es-PE", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });

                    return (
                      <div
                        key={item.id || index}
                        className={`bg-white rounded-2xl border border-slate-200/60 shadow-3xs flex flex-col relative overflow-hidden transition-all hover:border-slate-350 group/item ${
                          index === 0
                            ? "ring-2 ring-teal-500/20 border-teal-500/50"
                            : ""
                        }`}
                      >
                        {index === 0 && (
                          <div className="absolute top-0 left-0 right-0 h-[3px] bg-teal-500" />
                        )}

                        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                          <div className="flex items-start gap-3">
                            <div
                              className={`p-2.5 rounded-xl shrink-0 ${
                                item.has_changes
                                  ? "bg-emerald-50 text-emerald-600 border border-emerald-150"
                                  : "bg-amber-50 text-amber-600 border border-amber-150"
                              }`}
                            >
                              {item.has_changes ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <AlertTriangle className="h-4 w-4" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10.5px] font-black text-slate-800">
                                  {formattedDate} a las {formattedTime}
                                </span>
                                {index === 0 && (
                                  <span className="bg-teal-50 text-teal-850 px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wide border border-teal-100">
                                    Actual
                                  </span>
                                )}
                              </div>
                              {(() => {
                                let metadataObj: any = null;
                                try {
                                  if (item.changes_metadata) {
                                    const parsed =
                                      typeof item.changes_metadata === "string"
                                        ? JSON.parse(item.changes_metadata)
                                        : item.changes_metadata;
                                    if (
                                      parsed &&
                                      typeof parsed === "object" &&
                                      !Array.isArray(parsed)
                                    ) {
                                      metadataObj = parsed;
                                    }
                                  }
                                } catch (e) {}

                                const totalStock = metadataObj?.total_stock;
                                const totalValue = metadataObj?.total_value;

                                return (
                                  <p className="text-[10px] font-bold text-slate-400 mt-1 flex flex-wrap items-center gap-1.5 leading-relaxed">
                                    <span>
                                      Artículos:{" "}
                                      <span className="font-extrabold text-slate-600">
                                        {item.record_count}
                                      </span>
                                    </span>
                                    {totalStock !== undefined && (
                                      <>
                                        <span className="text-slate-300">
                                          •
                                        </span>
                                        <span>
                                          Stock Total:{" "}
                                          <span className="font-extrabold text-slate-800">
                                            {new Intl.NumberFormat(
                                              "es-PE",
                                            ).format(totalStock)}
                                          </span>
                                        </span>
                                      </>
                                    )}
                                    {totalValue !== undefined && (
                                      <>
                                        <span className="text-slate-300">
                                          •
                                        </span>
                                        <span>
                                          Valorización:{" "}
                                          <span className="font-extrabold text-emerald-650">
                                            S/{" "}
                                            {new Intl.NumberFormat("es-PE", {
                                              minimumFractionDigits: 2,
                                            }).format(totalValue)}
                                          </span>
                                        </span>
                                      </>
                                    )}
                                  </p>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="flex sm:flex-col items-start sm:items-end gap-1.5 shrink-0">
                            {item.has_changes ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-4xs">
                                  Stock Modificado (
                                  {item.changed_items_count || "?"} items)
                                </span>
                              </div>
                            ) : (
                              <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-4xs">
                                Stock sin cambios
                              </span>
                            )}
                            <span
                              className="text-[9px] text-slate-400 font-mono"
                              title="Identificador único del estado"
                            >
                              Hash: {item.stock_hash}
                            </span>
                          </div>
                        </div>
                        {item.has_changes &&
                          (() => {
                            try {
                              let changes: any[] = [];
                              if (item.changes_metadata) {
                                const parsed =
                                  typeof item.changes_metadata === "string"
                                    ? JSON.parse(item.changes_metadata)
                                    : item.changes_metadata;
                                changes = Array.isArray(parsed)
                                  ? parsed
                                  : parsed?.changes || [];
                                changes = changes.filter((c: any) => c.change !== 0);
                              }

                              if (
                                !Array.isArray(changes) ||
                                changes.length === 0
                              ) {
                                return (
                                  <div className="text-[10px] text-slate-400 bg-slate-50/50 border-t border-slate-100 p-4 shadow-inner italic text-center font-medium">
                                    El detalle específico de los items
                                    modificados no está disponible para este
                                    registro histórico o no hubo cambios reales de stock.
                                  </div>
                                );
                              }

                              return (
                                <details className="text-[10px] text-slate-600 border-t border-slate-100 group config-accordion bg-slate-50/50">
                                  <summary className="font-bold text-slate-500 hover:text-slate-800 p-2.5 cursor-pointer select-none list-none flex items-center justify-center gap-1.5 hover:bg-slate-100/50 transition-colors text-[10px] uppercase tracking-wider">
                                    <span>
                                      Ver detalle de items modificados (
                                      {changes.length})
                                    </span>
                                    <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform text-slate-400" />
                                  </summary>
                                  <div className="bg-slate-50/80 p-0 max-h-72 overflow-y-auto w-full border-t border-slate-100/50">
                                    {changes
                                      .map((change: any, i: number) => {
                                        const isPositive = change.change > 0;
                                        return (
                                          <div
                                            key={i}
                                            className="flex justify-between items-center py-2 px-4 border-b border-slate-100/60 last:border-0 hover:bg-white transition-colors relative group/row"
                                          >
                                            {/* Left subtle indicator */}
                                            <div
                                              className={`absolute left-0 top-0 bottom-0 w-[2px] ${isPositive ? "bg-emerald-400" : "bg-rose-400"} opacity-0 group-hover/row:opacity-100 transition-opacity`}
                                            />

                                            <div className="flex flex-col flex-1 min-w-0 pr-4">
                                              <span
                                                className="truncate font-bold text-slate-700 text-[11px] uppercase"
                                                title={change.name || change.id}
                                              >
                                                {change.name || change.id}
                                              </span>
                                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                                {change.codigo &&
                                                  change.codigo !==
                                                    "UNKNOWN" && (
                                                    <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">
                                                      C: {change.codigo}
                                                    </span>
                                                  )}
                                                {change.lote &&
                                                  change.lote !== "N/A" && (
                                                    <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">
                                                      L: {change.lote}
                                                    </span>
                                                  )}
                                                {change.vto &&
                                                  change.vto !== "N/A" && (
                                                    <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">
                                                      V: {change.vto}
                                                    </span>
                                                  )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                                <span className="text-slate-400 line-through decoration-slate-300">
                                                  {change.previousQty}
                                                </span>
                                                <span className="text-slate-300">
                                                  →
                                                </span>
                                                <span className="font-extrabold text-slate-700">
                                                  {change.currentQty}
                                                </span>
                                              </div>
                                              <div
                                                className={`w-14 text-center px-1.5 py-1 rounded-md font-black text-[10px] uppercase tracking-wider shadow-4xs ${isPositive ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-rose-100 text-rose-700 border border-rose-200"}`}
                                              >
                                                {isPositive ? "+" : ""}
                                                {change.change}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </details>
                              );
                            } catch (e) {
                              return (
                                <div className="text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100/50 p-4 shadow-inner italic text-center">
                                  Error al cargar el detalle de cambios
                                  registrados.
                                </div>
                              );
                            }
                          })()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Deficiency Capture Bar when in Capture Mode */}
      {isCaptureMode && viewLevel === "sheets" && (
        <DeficiencyCaptureBar
          selectedCount={selectedCaptureIds.size}
          totalVisibleCount={filteredAndSortedSources.length}
          deficiencyCount={deficiencyCount}
          onSelectAll={handleSelectAllCapture}
          onDeselectAll={handleDeselectAllCapture}
          onAutoSelectDeficiencies={handleAutoSelectDeficiencies}
          onOpenPreview={() => setIsCaptureModalOpen(true)}
          onDirectDownload={() => setIsCaptureModalOpen(true)}
          onDirectCopy={() => setIsCaptureModalOpen(true)}
          onExit={() => {
            setIsCaptureMode(false);
            setSelectedCaptureIds(new Set());
          }}
        />
      )}

      {/* Deficiency Capture Modal (Preview & Image Generation) */}
      <DeficiencyCaptureModal
        isOpen={isCaptureModalOpen}
        onClose={() => setIsCaptureModalOpen(false)}
        ungetName={activeCaptureUngetName}
        selectedItems={selectedCaptureItemsData}
      />
    </div>
  );
};
