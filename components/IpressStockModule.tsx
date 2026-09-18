import React, { useState, useEffect, useMemo } from "react";
import { 
  Search, 
  Loader2, 
  FileSpreadsheet, 
  Clock, 
  Filter, 
  ChevronRight, 
  X, 
  AlertTriangle, 
  RefreshCw, 
  Hospital, 
  Table, 
  Layers, 
  ArrowLeft, 
  AlertCircle,
  Trash2,
  Monitor,
  FileClock,
  Database,
  CheckCircle2,
  ChevronDown,
  Wifi,
  WifiOff
} from "lucide-react";
import { api } from "../services/api";
import {
  AssignedSheetRow,
  findConnectionForAssignment,
  readAssignedSheetRows,
} from "../services/assignedSheetReader";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { supabase, supabaseService, StockSyncRecord } from "../services/supabaseClient";
import { HealthFacility, StockAssignment } from "../types";

export interface CalculatedItem {
  id: string;
  facility_code: string;
  almcod: string;
  desc_alm: string;
  medcod: string;
  codigo_sig: string;
  xnom: string;
  lote: string;
  fecha: string; // Expiration
  medregsan: string;
  tipsum: string;
  tipsum_des: string;
  ffinan: string;
  ffinan_des: string;
  saldo: number;
  precio_det: number;
  preciocab: number;
  last_update: string;
}

type RawStockRecord = Record<string, any>;
type SheetStockRow = Record<string, unknown>;

const normalizeSheetKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const readSheetValue = (row: SheetStockRow, aliases: string[]) => {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) return row[alias];
  }

  const keys = Object.keys(row);
  for (const alias of aliases) {
    const normalizedAlias = normalizeSheetKey(alias);
    const matchingKey = keys.find(key => normalizeSheetKey(key) === normalizedAlias);
    if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) return row[matchingKey];
  }

  return "";
};

const parseSheetNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};



const normalizeAssignmentStockRow = (
  row: SheetStockRow,
  assignment: StockAssignment,
  facility?: HealthFacility,
  index = 0
): RawStockRecord | null => {
  const medcod = String(readSheetValue(row, ["Id_Producto", "ID_Producto", "id_producto", "medcod", "MEDCOD"]) || "").trim();
  const name = String(readSheetValue(row, ["Nombre", "NOMBRE", "xnom", "descripcion", "DESCRIPCION"]) || "").trim();
  const lote = String(readSheetValue(row, ["Lote", "LOTE", "lote"]) || "").trim();

  if (!medcod && !name && !lote) return null;

  const updateValue = String(readSheetValue(row, ["ULTIMA_ACTUALIZACION", "Ultima_Actualizacion", "FECHA_DEL_EQUIPO", "fecha_equipo"]) || "").trim();

  return {
    id: `${assignment.id || assignment.facilityCode}-${index}`,
    facility_code: assignment.facilityCode,
    almcod: String(readSheetValue(row, ["ALMCOD", "almcod"]) || assignment.facilityCode).trim(),
    desc_alm: String(readSheetValue(row, ["DESC_ALM", "desc_alm"]) || facility?.name || assignment.sheetName || "Hoja asignada").trim(),
    medcod: medcod || "S/C",
    codigo_sig: String(readSheetValue(row, ["CODIGO_SIG", "codigo_sig"]) || medcod || "").trim(),
    xnom: name || "Descripcion no disponible",
    lote: lote || "S/L",
    fecha: String(readSheetValue(row, ["Fec_Vencim", "FEC_VENCIM", "fecha", "vencimiento"]) || "-").trim(),
    medregsan: String(readSheetValue(row, ["Reg_Sanitario", "REG_SANITARIO", "medregsan"]) || "S/N").trim(),
    tipsum: String(readSheetValue(row, ["TIPSUM", "tipsum"]) || readSheetValue(row, ["DESC_TIPSUM", "tipsum_des"]) || "N/A").trim(),
    tipsum_des: String(readSheetValue(row, ["DESC_TIPSUM", "tipsum_des"]) || readSheetValue(row, ["TIPSUM", "tipsum"]) || "Otros Suministros").trim(),
    ffinan: String(readSheetValue(row, ["FFINAN", "ffinan"]) || readSheetValue(row, ["DESC_FFINAN", "ffinan_des"]) || "N/A").trim(),
    ffinan_des: String(readSheetValue(row, ["DESC_FFINAN", "ffinan_des"]) || readSheetValue(row, ["FFINAN", "ffinan"]) || "Fuentes Diversas").trim(),
    saldo: parseSheetNumber(readSheetValue(row, ["Saldo", "SALDO", "saldo"])),
    precio_det: parseSheetNumber(readSheetValue(row, ["Precio_Det", "PRECIO_DET", "precio_det"])),
    preciocab: parseSheetNumber(readSheetValue(row, ["Precio_Cab", "PRECIO_CAB", "preciocab"])),
    ultima_actualizacion: updateValue || assignment.createdAt || "",
    fecha_equipo: updateValue || "",
    _source: "SHEET",
    _assignment_id: assignment.id,
    _sheet_name: assignment.sheetName
  };
};

const getCurrentJurisdictionLevel = (user: any): string => {
  if (!user) return "IPRESS";
  const explicit = user.jurisdictionLevel;
  if (explicit) return explicit;
  const role = String(user.role || "").toUpperCase();
  if (role === "ADMIN" || role === "GLOBAL" || role.includes("SUPER") || role.includes("GENERAL") || role === "ADMINISTRADOR") return "GLOBAL";
  if (role.includes("DIRESA")) return "DIRESA";
  if (role.includes("OGESS")) return "OGESS";
  if (role.includes("UNGET") || role.includes("RED")) return "UNGET";
  if (role.includes("MICRORED")) return "MICRORED";
  return "IPRESS";
};

const getUserScope = (user: any) => ({
  diresaId: user?.personnelData?.diresaId || user?.facilityData?.diresaId || user?.diresaId,
  ogessId: user?.personnelData?.ogessId || user?.facilityData?.ogessId || user?.ogessId,
  ungetId: user?.personnelData?.ungetId || user?.facilityData?.ungetId || user?.ungetId,
  microredId: user?.personnelData?.microredId || user?.facilityData?.microredId || user?.microredId,
  facilityCode: user?.personnelData?.facilityCode || user?.facilityData?.code || user?.facilityCode
});

const isFacilityInUserScope = (facility: HealthFacility | undefined, user: any) => {
  const scope = getUserScope(user);
  const currentLevel = getCurrentJurisdictionLevel(user);
  if (!facility) return currentLevel === "GLOBAL";
  if (currentLevel === "GLOBAL") return true;
  if (currentLevel === "IPRESS") return Boolean(scope.facilityCode && facility.code === scope.facilityCode);
  if (currentLevel === "MICRORED" && scope.microredId) return facility.microredId === scope.microredId;
  if (currentLevel === "UNGET" && scope.ungetId) return facility.ungetId === scope.ungetId;
  if (currentLevel === "OGESS" && scope.ogessId) return facility.ogessId === scope.ogessId;
  if (currentLevel === "DIRESA" && scope.diresaId) return facility.diresaId === scope.diresaId;
  return false;
};

const datesMatch = (ts1?: number | null, ts2?: number | null): boolean => {
  if (!ts1 || !ts2) return true;
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
};

const getItemExpirationStatus = (fechaStr?: string | null, saldo?: number) => {
  if (!fechaStr || (saldo !== undefined && saldo <= 0)) return "NORMAL";
  
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  
  const str = String(fechaStr).trim();
  const parts = str.split(/[\/\-]/);
  
  if (parts.length === 3) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);

    let day = 1, month = 0, year = 2000;
    if (p0 > 1000) { 
      year = p0; month = p1 - 1; day = p2;
    } else if (p2 > 1000 || p2 < 100) {
      year = p2 < 100 ? p2 + 2000 : p2;
      if (p0 > 12) { day = p0; month = p1 - 1; }
      else if (p1 > 12) { day = p1; month = p0 - 1; }
      else { day = p0; month = p1 - 1; }
    }

    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      const expDate = new Date(year, month, day);
      expDate.setHours(23, 59, 59, 999);
      if (expDate < today) {
        return "EXPIRED";
      } else if (month === currentMonth && year === currentYear) {
        return "EXPIRING";
      }
    }
  } else if (parts.length === 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    if (!isNaN(p0) && !isNaN(p1)) {
      const month = p0 - 1;
      const year = p1 < 100 ? p1 + 2000 : p1;
      const expDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
      if (expDate < today) {
        return "EXPIRED";
      } else if (month === currentMonth && year === currentYear) {
        return "EXPIRING";
      }
    }
  }
  
  return "NORMAL";
};

const parseDataDate = (str?: string | null): number => {
  if (!str) return 0;
  // Intentar parseo nativo primero
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d.getTime();

  // Intentar DD/MM/YYYY HH:MM:SS
  try {
    const parts = str.trim().split(/\s+/);
    const datePart = parts[0].replace(",", "");
    const timePart = parts[1] || "00:00:00";
    const dateMatch = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      d = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${timePart}`,
      );
      return d.getTime() || 0;
    }
  } catch (e) {}

  return 0;
};

const getUpdateStatus = (timestamp?: number | null) => {
  if (!timestamp || timestamp === 0)
    return { color: "bg-gray-400", label: "Sin datos", text: "text-gray-500", bg: "bg-gray-50" };

  const now = new Date().getTime();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0 || diffHours <= 1) {
    const minLabel = diffMinutes <= 0 ? "< 1m" : `${diffMinutes}m`;
    return {
      color: "bg-emerald-500",
      label: diffMinutes <= 0 ? "Actualizado recientemente" : `Hace ${minLabel}`,
      text: "text-emerald-700",
      bg: "bg-emerald-50"
    };
  }

  if (diffHours <= 24) {
    const hrs = Math.floor(diffHours);
    const mins = diffMinutes % 60;
    return {
      color: "bg-amber-500",
      label: `Hace ${hrs}h ${mins}m`,
      text: "text-amber-700",
      bg: "bg-amber-50"
    };
  }

  const days = Math.floor(diffHours / 24);
  const hrs = Math.floor(diffHours) % 24;
  return {
    color: "bg-red-500",
    label: `Hace ${days}d ${hrs}h`,
    text: "text-red-700",
    bg: "bg-red-50"
  };
};

const renderSyncStatusPill = (timestamp?: number | null) => {
  if (!timestamp) return null;
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
      title={statusObj.label}
    >
      <span
        className={`h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full shrink-0 ${dotClass}`}
      />
      <span className="truncate">{statusObj.label}</span>
    </span>
  );
};

export const StockMonitoringModule: React.FC = () => {
  const { user: currentUser } = useAuth();
  const canDeleteSyncedStock = (currentUser?.role || "").toUpperCase() === "ADMIN";
  
  // State
  const [facilities, setFacilities] = useState<HealthFacility[]>([]);
  const [stockRecords, setStockRecords] = useState<RawStockRecord[]>([]);
  const [stockAssignments, setStockAssignments] = useState<StockAssignment[]>([]);
  const [supabaseSyncs, setSupabaseSyncs] = useState<Record<string, StockSyncRecord>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // High-level navigation
  const [selectedFacilityCode, setSelectedFacilityCode] = useState<string | null>(null);
  
  // Active facility details tab
  const [activeAlmTab, setActiveAlmTab] = useState<string>("ALL"); // "ALL" or specific almcod
  
  // Search & Filters in detail view
  const [searchTerm, setSearchTerm] = useState("");
  const [ffinanFilter, setFfinanFilter] = useState<string>("ALL");
  const [tipsumFilter, setTipsumFilter] = useState<string>("ALL");
  
  // Custom delete confirmation state
  const [deleteConfirmData, setDeleteConfirmData] = useState<{almcod: string, almName: string} | null>(null);

  const [isSyncHistoryModalOpen, setIsSyncHistoryModalOpen] = useState(false);
  const [selectedFacilitySyncHistory, setSelectedFacilitySyncHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [activeHistoryFacility, setActiveHistoryFacility] = useState<{ id: string; name: string } | null>(null);

  // Expiration modal state
  const [isExpirationModalOpen, setIsExpirationModalOpen] = useState(false);
  const [expirationModalType, setExpirationModalType] = useState<"expired" | "expiring" | null>(null);
  const [expirationFacilityCode, setExpirationFacilityCode] = useState<string | null>(null);


  const handleShowSyncHistory = async (facilityCode: string, facilityName: string) => {
    if (!supabase) return;
    setActiveHistoryFacility({ id: facilityCode, name: facilityName });
    setIsSyncHistoryModalOpen(true);
    setSelectedFacilitySyncHistory([]);
    setIsLoadingHistory(true);

    try {
      const { data, error } = await supabase
        .from("stock_sync_history")
        .select("*")
        .eq("establishment_id", facilityCode)
        .order("sync_date", { ascending: false })
        .limit(15);
        
      if (!error && data) {
         setSelectedFacilitySyncHistory(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleShowExpirations = (facilityCode: string, type: "expired" | "expiring") => {
    setExpirationFacilityCode(facilityCode);
    setExpirationModalType(type);
    setIsExpirationModalOpen(true);
  };

  useEffect(() => {
    void loadBaseData();
  }, [currentUser?.username]);

  const loadBaseData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const scope = getUserScope(currentUser);
      const currentLevel = getCurrentJurisdictionLevel(currentUser);

      const [allFacilities, allAssignmentsRaw, ownAssignmentsRaw] = await Promise.all([
        api.getFacilities(),
        api.getAllStockAssignments(),
        scope.facilityCode ? api.getMyStockAssignments(scope.facilityCode) : Promise.resolve([])
      ]);

      const assignmentMap = new Map<string, StockAssignment>();
      [...allAssignmentsRaw, ...ownAssignmentsRaw].forEach((assignment: StockAssignment) => {
        const key = assignment.id || `${assignment.facilityCode}-${assignment.sheetUrl}-${assignment.sheetName}`;
        assignmentMap.set(key, assignment);
      });

      const allAssignments = Array.from(assignmentMap.values());
      const facilityByCode = new Map<string, HealthFacility>(allFacilities.map(f => [f.code, f]));
      const scopedAssignments = allAssignments.filter(assignment => {
        const facility = facilityByCode.get(assignment.facilityCode);
        if (currentLevel === "IPRESS") return scope.facilityCode === assignment.facilityCode;
        return isFacilityInUserScope(facility, currentUser);
      });

      const effectiveFacilitiesMap = new Map<string, HealthFacility>();
      allFacilities.forEach(f => effectiveFacilitiesMap.set(f.code, f));

      if (scope.facilityCode && !effectiveFacilitiesMap.has(scope.facilityCode) && currentUser?.facilityData) {
        effectiveFacilitiesMap.set(scope.facilityCode, {
          code: scope.facilityCode,
          name: currentUser.facilityData.name || scope.facilityCode,
          category: currentUser.facilityData.category || "IPRESS",
          type: currentUser.facilityData.type,
          microredId: currentUser.facilityData.microredId || scope.microredId,
          ungetId: currentUser.facilityData.ungetId || scope.ungetId,
          ogessId: currentUser.facilityData.ogessId || scope.ogessId,
          diresaId: currentUser.facilityData.diresaId || scope.diresaId,
          department: currentUser.facilityData.department,
          province: currentUser.facilityData.province,
          district: currentUser.facilityData.district
        });
      }

      scopedAssignments.forEach(assignment => {
        if (!effectiveFacilitiesMap.has(assignment.facilityCode)) {
          const isOwnFacility = scope.facilityCode === assignment.facilityCode;
          effectiveFacilitiesMap.set(assignment.facilityCode, {
            code: assignment.facilityCode,
            name: isOwnFacility ? currentUser?.facilityData?.name || assignment.sheetName : assignment.sheetName,
            category: isOwnFacility ? currentUser?.facilityData?.category || "IPRESS" : "IPRESS",
            microredId: isOwnFacility ? scope.microredId : undefined,
            ungetId: isOwnFacility ? scope.ungetId : undefined,
            ogessId: isOwnFacility ? scope.ogessId : undefined,
            diresaId: isOwnFacility ? scope.diresaId : undefined
          });
        }
      });

      const effectiveFacilities = Array.from(effectiveFacilitiesMap.values());
      setFacilities(effectiveFacilities);
      setStockAssignments(scopedAssignments);

      const scopedFacilityCodes = effectiveFacilities
        .filter(f => isFacilityInUserScope(f, currentUser) || scopedAssignments.some(a => a.facilityCode === f.code))
        .map(f => f.code);

      const shouldLoadAllStock = currentLevel !== "IPRESS" || scopedFacilityCodes.length === 0;
      const nativeStock = await api.getStockActual(shouldLoadAllStock ? undefined : scopedFacilityCodes);

      const hasNativeStock = (facilityCode: string) => nativeStock.some(r =>
        r.facility_code === facilityCode ||
        String(r.facility_code || "").startsWith(facilityCode)
      );

      const assignmentsNeedingSheet = scopedAssignments.filter(assignment => !hasNativeStock(assignment.facilityCode));
      // La conexión vigente de cada UNGET: la URL guardada en la asignación puede haber
      // cambiado, y una UNGET que solo lee por hoja ya no tiene Web App a la que pedir.
      const conexiones = assignmentsNeedingSheet.length > 0 ? await api.getAllUngetConfigs() : [];
      const assignedSheetResults = await Promise.allSettled(assignmentsNeedingSheet.map(async assignment => {
        const conexion = findConnectionForAssignment(assignment, conexiones);
        const rows: AssignedSheetRow[] = await readAssignedSheetRows(assignment, conexion);
        const facility = effectiveFacilitiesMap.get(assignment.facilityCode);
        return rows
          .map((row, index) => normalizeAssignmentStockRow(row, assignment, facility, index))
          .filter((row): row is RawStockRecord => Boolean(row));
      }));

      const assignedStock = assignedSheetResults.flatMap(result => result.status === "fulfilled" ? result.value : []);
      const failedAssignedSheets = assignedSheetResults.filter(result => result.status === "rejected").length;
      if (failedAssignedSheets > 0 && isRefresh) {
        toast.warning(`${failedAssignedSheets} hoja(s) asignada(s) no pudieron leerse.`);
      }

      setStockRecords([...nativeStock, ...assignedStock]);
      
      if (effectiveFacilities.length > 0) {
        const activeIds = effectiveFacilities.map(f => f.code);
        const syncs = await supabaseService.getLatestSyncs(activeIds);
        setSupabaseSyncs(syncs);
      }
      
      if (currentLevel === "IPRESS" && scope.facilityCode) {
        setSelectedFacilityCode(scope.facilityCode);
      } else if (selectedFacilityCode && !effectiveFacilitiesMap.has(selectedFacilityCode)) {
        setSelectedFacilityCode(null);
      }

      if (isRefresh) {
        toast.success("Informacion de stock actualizada");
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar la información de Stock");
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleRefresh = async () => {
    await loadBaseData(true);
  };

  const requestDeleteWarehouse = (almcod: string, almName: string) => {
    setDeleteConfirmData({ almcod, almName });
  };

  const confirmDeleteWarehouse = async () => {
    if (!canDeleteSyncedStock) {
      setDeleteConfirmData(null);
      toast.error("Solo el administrador total puede eliminar stock sincronizado");
      return;
    }
    if (!deleteConfirmData) return;
    const { almcod, almName } = deleteConfirmData;
    
    setRefreshing(true);
    setDeleteConfirmData(null);
    try {
      const success = await api.deleteStockActualByAlmcod(almcod);
      if (success) {
        toast.success("Stock eliminado correctamente");
        const allStock = await api.getStockActual();
        setStockRecords(allStock);
      } else {
        toast.error("Error al eliminar los datos");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setRefreshing(false);
    }
  };

  // Jurisdiction definitions
  const userDiresaId = currentUser?.personnelData?.diresaId || currentUser?.facilityData?.diresaId || (currentUser as any)?.diresaId;
  const userOgessId = currentUser?.personnelData?.ogessId || currentUser?.facilityData?.ogessId || (currentUser as any)?.ogessId;
  const userUngetId = currentUser?.personnelData?.ungetId || currentUser?.facilityData?.ungetId || (currentUser as any)?.ungetId;
  const userMicroredId = currentUser?.personnelData?.microredId || currentUser?.facilityData?.microredId || (currentUser as any)?.microredId;
  const userFacilityCode = currentUser?.personnelData?.facilityCode || currentUser?.facilityData?.code || (currentUser as any)?.facilityCode;

  const isGlobalUser = !userDiresaId && !userOgessId && !userUngetId && !userMicroredId && !userFacilityCode;

  const level = useMemo(() => {
    if (!currentUser) return 'IPRESS';
    const r = (currentUser.role || '').toUpperCase();
    if (r === 'ADMIN' || r === 'GLOBAL' || r.includes('SUPER') || r.includes('GENERAL') || r === 'ADMINISTRADOR') return 'GLOBAL';
    if (r.includes('DIRESA')) return 'DIRESA';
    if (r.includes('OGESS')) return 'OGESS';
    if (r.includes('UNGET')) return 'UNGET';
    if (r.includes('MICRORED')) return 'MICRORED';
    return 'IPRESS';
  }, [currentUser]);

  // Filter facilities listing based on user's territory limit
  const activeJurisdictionFacilities = useMemo(() => {
    const assignedFacilityCodes = new Set(stockAssignments.map(assignment => assignment.facilityCode));
    const visibleFacilities = new Map<string, HealthFacility>();

    facilities.forEach(f => {
      const isAssigned = assignedFacilityCodes.has(f.code);
      let isInScope = isGlobalUser;

      if (userFacilityCode) isInScope = f.code === userFacilityCode;
      else if (userMicroredId) isInScope = f.microredId === userMicroredId;
      else if (userUngetId) isInScope = f.ungetId === userUngetId;
      else if (userOgessId) isInScope = f.ogessId === userOgessId;
      else if (userDiresaId) isInScope = f.diresaId === userDiresaId;

      if (isGlobalUser || isInScope || isAssigned) {
        visibleFacilities.set(f.code, f);
      }
    });

    return Array.from(visibleFacilities.values());
  }, [facilities, stockAssignments, isGlobalUser, userFacilityCode, userMicroredId, userUngetId, userOgessId, userDiresaId]);

  // Establishments that actually contain registered stock in stock_actual and matches jurisdiction
  const stockFacilitiesList = useMemo(() => {
    const assignmentsByFacility = new Map(stockAssignments.map(assignment => [assignment.facilityCode, assignment]));

    // Only use base IPRESS (filter out sub-facilities if their parent is present or their code length is > 5)
    // Most standard IPRESS codes are 5 digits. "030S05" technically is 6 chars maybe? So let's filter if there's any strictly shorter prefix in the list.
    const baseFacilities = activeJurisdictionFacilities.filter(f => {
      // Is there another facility that is a strict prefix of this one?
      const isSubFacility = activeJurisdictionFacilities.some(parent => f.code !== parent.code && f.code.startsWith(parent.code));
      return !isSubFacility;
    });

    return baseFacilities.map(f => {
      // Find all stock records synced under this parent facility (this includes its own and its children's stock)
      const fStock = stockRecords.filter(r => {
        const recordFacilityCode = String(r.facility_code || "");
        return recordFacilityCode === f.code || recordFacilityCode.startsWith(f.code);
      });
      const assignment = assignmentsByFacility.get(f.code);
      const hasSheetStock = fStock.some(r => r._source === "SHEET");

      const uniqueWarehouses = new Set(fStock.map(r => r.almcod).filter(Boolean));
      const lastUpdateTimes = fStock
        .map(r => parseDataDate(r.ultima_actualizacion || r.updated_at || r.fecha_equipo))
        .filter(Boolean);
      const lastUpdateTime = lastUpdateTimes.length > 0 ? Math.max(...lastUpdateTimes) : null;
      
      const syncRecord = supabaseSyncs[f.code];
      const lastModDateStr = syncRecord ? (syncRecord.last_modification_date || syncRecord.sync_date) : null;
      const lastModTime = lastModDateStr ? new Date(lastModDateStr).getTime() : null;

      const lastEquipoTimes = fStock.map(r => r.fecha_equipo).filter(Boolean);
      let maxEquipoTime = 0;
      let latestFechaEquipoStr = lastEquipoTimes.length > 0 ? lastEquipoTimes[0] : null;
      
      lastEquipoTimes.forEach(timeStr => {
        const ts = parseDataDate(timeStr);
        if (ts > maxEquipoTime) {
          maxEquipoTime = ts;
          latestFechaEquipoStr = timeStr;
        }
      });
      
      const fechaEquipoDateTime = lastModTime || (maxEquipoTime > 0 ? maxEquipoTime : null);
      
      let fechaEquipo = latestFechaEquipoStr;
      if (lastModDateStr) {
        const md = new Date(lastModDateStr);
        const day = md.getDate().toString().padStart(2, '0');
        const month = (md.getMonth() + 1).toString().padStart(2, '0');
        const year = md.getFullYear();
        const hrs = md.getHours().toString().padStart(2, '0');
        const mins = md.getMinutes().toString().padStart(2, '0');
        const secs = md.getSeconds().toString().padStart(2, '0');
        fechaEquipo = `${day}/${month}/${year} ${hrs}:${mins}:${secs}`;
      }

      // Calculate expirations
      let expiredCount = 0;
      let expiringThisMonthCount = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();

      fStock.forEach(r => {
        const expStatus = getItemExpirationStatus(r.fecha, Number(r.saldo));
        if (expStatus === "EXPIRED") {
          expiredCount++;
        } else if (expStatus === "EXPIRING") {
          expiringThisMonthCount++;
        }
      });

      // Include all medications/lots, not just those with > 0 stock (based on user feedback)
      const uniqueMeds = new Set(fStock.map(r => r.medcod));

      return {
        ...f,
        hasStock: fStock.length > 0,
        uniqueWarehousesCount: uniqueWarehouses.size,
        totalItemsCount: fStock.length, // Include all items/lotes (even zero stock)
        uniqueMedicinesCount: uniqueMeds.size,
        totalUnitsSum: fStock.reduce((acc, r) => acc + (Number(r.saldo) || 0), 0),
        lastUpdateTime,
        fechaEquipo,
        fechaEquipoDateTime,
        expiredCount,
        expiringThisMonthCount,
        hasAssignment: Boolean(assignment),
        assignmentSheetName: assignment?.sheetName,
        hasSheetStock,
      };
    }).sort((a, b) => {
      if (b.hasStock !== a.hasStock) {
        return (b.hasStock ? 1 : 0) - (a.hasStock ? 1 : 0);
      }
      return a.name.localeCompare(b.name);
    });
  }, [activeJurisdictionFacilities, stockRecords, stockAssignments, supabaseSyncs]);

  // Get stock records belonging to the selected facility
  const calculatedStockItems = useMemo<CalculatedItem[]>(() => {
    if (!selectedFacilityCode) return [];
    
    // selectedFacilityCode is the parent facility code
    const records = stockRecords.filter(r => {
      const recordFacilityCode = String(r.facility_code || "");
      return recordFacilityCode === selectedFacilityCode || recordFacilityCode.startsWith(selectedFacilityCode);
    });

    return records.map(r => {
      const saldo = Number(r.saldo) || 0;
      
      return {
        id: r.id,
        facility_code: r.facility_code,
        almcod: r.almcod,
        desc_alm: r.desc_alm || `Almacén ${r.almcod}`,
        medcod: r.medcod,
        tipsum: r.tipsum || "N/A",
        tipsum_des: r.tipsum_des || "Otros Suministros",
        codigo_sig: r.codigo_sig || r.medcod,
        xnom: r.xnom || "Descripción no disponible",
        lote: r.lote || "S/L",
        fecha: r.fecha || "-",
        medregsan: r.medregsan || "N/A",
        ffinan: r.ffinan || "N/A",
        ffinan_des: r.ffinan_des || "Fuentes Diversas",
        saldo,
        precio_det: Number(r.precio_det) || 0,
        preciocab: Number(r.preciocab) || 0,
        last_update: r.ultima_actualizacion
      };
    });
  }, [selectedFacilityCode, stockRecords]);

  // Detected warehouses list for the selected facility (unique almcod + desc_alm)
  const facilityWarehouses = useMemo(() => {
    if (!selectedFacilityCode) return [];
    const grouped = new Map<string, string>();
    calculatedStockItems.forEach(item => {
      grouped.set(item.almcod, item.desc_alm);
    });
    return Array.from(grouped.entries()).map(([code, name]) => ({ code, name }));
  }, [calculatedStockItems, selectedFacilityCode]);

  // Detailed summary metrics for the selected facility
  const facilitySummaryMetrics = useMemo(() => {
    if (!selectedFacilityCode) return null;
    
    const uniqueMedsSet = new Set<string>();
    let totalUnits = 0;
    let totalEstimatedValue = 0;
    
    const warehouseGroupMap = new Map<string, {
      code: string;
      name: string;
      uniqueMeds: Set<string>;
      batchesCount: number;
      totalUnits: number;
      estimatedValue: number;
    }>();

    calculatedStockItems.forEach(item => {
      uniqueMedsSet.add(item.medcod);
      totalUnits += item.saldo;
      const price = item.precio_det || item.preciocab || 0;
      totalEstimatedValue += item.saldo * price;

      let wh = warehouseGroupMap.get(item.almcod);
      if (!wh) {
        wh = {
          code: item.almcod,
          name: item.desc_alm || `Almacén ${item.almcod}`,
          uniqueMeds: new Set<string>(),
          batchesCount: 0,
          totalUnits: 0,
          estimatedValue: 0
        };
        warehouseGroupMap.set(item.almcod, wh);
      }
      wh.uniqueMeds.add(item.medcod);
      wh.batchesCount += 1;
      wh.totalUnits += item.saldo;
      wh.estimatedValue += item.saldo * price;
    });

    const warehousesList = Array.from(warehouseGroupMap.values()).map(w => ({
      code: w.code,
      name: w.name,
      batchesCount: w.batchesCount,
      totalUnits: w.totalUnits,
      estimatedValue: w.estimatedValue,
      uniqueMedsCount: w.uniqueMeds.size
    }));

    return {
      totalUniqueMeds: uniqueMedsSet.size,
      totalBatches: calculatedStockItems.length,
      totalUnits,
      totalEstimatedValue,
      warehouses: warehousesList
    };
  }, [calculatedStockItems, selectedFacilityCode]);

  // Handle Consolidation ("All") vs Specific warehouse selection
  const processedStockItems = useMemo(() => {
    if (activeAlmTab === "ALL") {
      // Consolidates/Aggregates by medcod + lote + fecha + ffinan + tipsum as explicitly requested
      const aggregateMap = new Map<string, CalculatedItem>();
      
      calculatedStockItems.forEach(item => {
        const compositeKey = `${item.medcod}_${item.lote}_${item.fecha}_${item.ffinan}_${item.tipsum}`;
        const existing = aggregateMap.get(compositeKey);
        
        if (existing) {
          existing.saldo += item.saldo;
        } else {
          // Clone item so we don't mutate original
          aggregateMap.set(compositeKey, { ...item });
        }
      });
      return Array.from(aggregateMap.values());
    } else {
      // Specific warehouse selected
      return calculatedStockItems.filter(item => item.almcod === activeAlmTab);
    }
  }, [calculatedStockItems, activeAlmTab]);

  // Apply UI Filters to final selection
  const finalFilteredItems = useMemo(() => {
    return processedStockItems.filter(item => {
      // Search matching
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchesName = item.xnom.toLowerCase().includes(query);
        const matchesCode = item.medcod.toLowerCase().includes(query) || item.codigo_sig.toLowerCase().includes(query);
        const matchesLote = item.lote.toLowerCase().includes(query);
        if (!matchesName && !matchesCode && !matchesLote) return false;
      }

      // Fuente de Financiamiento filter
      if (ffinanFilter !== "ALL" && item.ffinan !== ffinanFilter) return false;

      // Tipsum filter
      if (tipsumFilter !== "ALL" && item.tipsum !== tipsumFilter) return false;

      return true;
    });
  }, [processedStockItems, searchTerm, ffinanFilter, tipsumFilter]);

  // Unique lists for filtering dropdowns
  const uniqueFfinans = useMemo(() => {
    const list = new Map<string, string>();
    calculatedStockItems.forEach(i => list.set(i.ffinan, i.ffinan_des));
    return Array.from(list.entries()).map(([code, name]) => ({ code, name }));
  }, [calculatedStockItems]);

  const uniqueTipsums = useMemo(() => {
    const list = new Map<string, string>();
    calculatedStockItems.forEach(i => list.set(i.tipsum, i.tipsum_des));
    return Array.from(list.entries()).map(([code, name]) => ({ code, name }));
  }, [calculatedStockItems]);

  // Selected facility reference object
  const activeFacilityObj = useMemo(() => {
    return facilities.find(f => f.code === selectedFacilityCode);
  }, [facilities, selectedFacilityCode]);

  // Selected active stock facility reference object
  const activeStockFacilityObj = useMemo(() => {
    return stockFacilitiesList.find(f => f.code === selectedFacilityCode);
  }, [stockFacilitiesList, selectedFacilityCode]);

  // Format Helper for timestamps
  const formatTextTimestamp = (tsStr: string) => {
    if (!tsStr) return "Nacional";
    return new Date(tsStr).toLocaleString("es-PE");
  };

  // CSV/Spreadsheet Export logic
  const handleExportCSV = () => {
    if (finalFilteredItems.length === 0) {
      toast.error("No hay registros en la vista actual para exportar");
      return;
    }

    try {
      const headers = ["Cod SISMED", "Descripcion", "Lote", "Vencimiento", "Almacen", "Financiamiento", "Suministro", "Stock Actual"];
      const rows = finalFilteredItems.map(item => [
        item.medcod,
        `"${item.xnom.replace(/"/g, '""')}"`,
        item.lote,
        item.fecha,
        activeAlmTab === "ALL" ? "Consolidado" : item.desc_alm,
        item.ffinan_des,
        item.tipsum_des,
        item.saldo
      ]);

      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `STOCK_${selectedFacilityCode}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Excel CSV exportado correctamente");
    } catch (e) {
      toast.error("Ocurrió un error al preparar el CSV");
    }
  };

  const expirationRecords = useMemo(() => {
    if (!expirationFacilityCode || !expirationModalType) return [];
    const facilityRecords = stockRecords.filter(r => {
      const recordFacilityCode = String(r.facility_code || "");
      return (recordFacilityCode === expirationFacilityCode || recordFacilityCode.startsWith(expirationFacilityCode)) && Number(r.saldo) > 0 && r.fecha;
    });
    
    return facilityRecords.filter(r => {
      const expStatus = getItemExpirationStatus(r.fecha, Number(r.saldo));
      if (expirationModalType === "expired") {
         return expStatus === "EXPIRED";
      } else {
         return expStatus === "EXPIRING";
      }
    }).map(r => ({
      name: r.xnom || "N/A",
      codigo: r.medcod,
      codigo_sig: r.codigo_sig || "",
      medregsan: r.medregsan || "S/N",
      lote: r.lote || "S/L",
      fecha: r.fecha || "-",
      saldo: Number(r.saldo) || 0,
      desc_alm: r.desc_alm || "Almacén",
      ffinan_des: r.ffinan_des || "N/A"
    }));
  }, [stockRecords, expirationFacilityCode, expirationModalType]);

  const establishmentSummary = useMemo(() => {
    const counts = {
      cs: 0,
      ps: 0,
      alm: 0,
      hosp: 0,
      total: 0,
      online: 0,
      delayed: 0,
      offline: 0,
      expiredTotal: 0,
      expiringTotal: 0,
    };

    stockFacilitiesList.forEach(f => {
      const name = f.name.toUpperCase();
      if (name.includes("C.S.") || name.includes("CENTRO DE SALUD") || name.includes("C. S.")) {
        counts.cs++;
      } else if (name.includes("P.S.") || name.includes("PUESTO DE SALUD") || name.includes("P. S.")) {
        counts.ps++;
      } else if (name.includes("ALM") || name.includes("ALMACEN")) {
        counts.alm++;
      } else if (name.includes("HOSP") || name.includes("HOSPITAL")) {
        counts.hosp++;
      }
      
      counts.total++;
      counts.expiredTotal += f.expiredCount || 0;
      counts.expiringTotal += f.expiringThisMonthCount || 0;
      
      const status = getUpdateStatus(f.lastUpdateTime).color;
      if (status.includes("emerald")) {
        counts.online++;
      } else if (status.includes("amber")) {
        counts.delayed++;
      } else {
        counts.offline++;
      }
    });

    return counts;
  }, [stockFacilitiesList]);

  const activeExpirationFacility = useMemo(() => {
     return facilities.find(f => f.code === expirationFacilityCode);
  }, [facilities, expirationFacilityCode]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* Main Grid: Directory of Jurisdictional Establishments */}
      {!selectedFacilityCode && (
        <div className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-250 shadow-sm">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-1.5 h-6 bg-teal-500 rounded-full"></span>
                <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2.5">
                  <Database className="h-5 w-5 text-teal-600 shrink-0" />
                  <span>Monitoreo Territorial de Stock SISMED</span>
                </h2>
                <span className="text-[10px] whitespace-nowrap font-black bg-teal-50 text-teal-850 px-2.5 py-0.5 rounded-full border border-teal-100/70 shadow-xs uppercase tracking-wide">
                  {stockFacilitiesList.length} {stockFacilitiesList.length === 1 ? "establecimiento" : "establecimientos"}
                </span>
              </div>
              
              <p className="text-xs text-gray-500">
                Nivel de jurisdicción consultada: <strong className="text-teal-600 uppercase font-black">{level || "Cargando"}</strong>
              </p>

              {/* Beautiful Premium Type KPIs */}
              {establishmentSummary && (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <div
                    className="flex items-center gap-1.5 bg-sky-50/70 border border-sky-100/50 text-sky-850 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs"
                    title="Centros de Salud"
                  >
                    <span className="w-1.5 h-1.5 bg-sky-500 rounded-full"></span>
                    <span className="text-slate-500 font-bold">C.S.:</span>
                    <span className="font-extrabold">{establishmentSummary.cs}</span>
                  </div>
                  <div
                    className="flex items-center gap-1.5 bg-amber-50/70 border border-amber-100/50 text-amber-850 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs"
                    title="Puestos de Salud"
                  >
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                    <span className="text-slate-500 font-bold">P.S.:</span>
                    <span className="font-extrabold">{establishmentSummary.ps}</span>
                  </div>
                  <div
                    className="flex items-center gap-1.5 bg-indigo-50/70 border border-indigo-100/50 text-indigo-850 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs"
                    title="Almacenes"
                  >
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                    <span className="text-slate-500 font-bold">ALM:</span>
                    <span className="font-extrabold">{establishmentSummary.alm}</span>
                  </div>
                  <div
                    className="flex items-center gap-1.5 bg-violet-50/70 border border-violet-100/50 text-violet-850 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs"
                    title="Hospitales"
                  >
                    <span className="w-1.5 h-1.5 bg-violet-500 rounded-full"></span>
                    <span className="text-slate-500 font-bold">HOSP:</span>
                    <span className="font-extrabold">{establishmentSummary.hosp}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing || loading}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-teal-600 border border-slate-250 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-xs cursor-pointer select-none active:scale-95 duration-150 shrink-0 justify-center"
              >
                <RefreshCw className={`h-4 w-4 text-teal-600 ${refreshing ? 'animate-spin' : ''}`} />
                Sincronizar Stock
              </button>
            </div>
          </div>

          {/* Connection KPIs row */}
          {establishmentSummary && (
            <div className="flex flex-row items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar w-full justify-start py-1">
              {/* En Línea */}
              <div className="flex items-center gap-2 sm:gap-2.5 bg-white border border-slate-100/80 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0">
                <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
                  <Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-600" />
                </div>
                <div className="flex flex-col justify-center gap-0.5 pr-2">
                  <span className="text-sm sm:text-lg font-black text-slate-800 leading-none">
                    {establishmentSummary.online}
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
                    {establishmentSummary.delayed}
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
                    {establishmentSummary.offline}
                  </span>
                  <span className="text-[9px] sm:text-[10px] font-bold text-red-500 leading-none uppercase">
                    Fuera Línea
                  </span>
                </div>
              </div>

              {/* Lotes Vencidos */}
              {establishmentSummary.expiredTotal > 0 && (
                <div className="flex items-center gap-2 sm:gap-2.5 bg-rose-50 border border-rose-200/50 shadow-[0_2px_12px_-4px_rgba(244,63,94,0.12)] rounded-xl sm:rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2 shrink-0 animate-pulse">
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-rose-100 flex items-center justify-center shrink-0 border border-rose-200/30">
                    <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-600" />
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 pr-2">
                    <span className="text-sm sm:text-lg font-black text-rose-800 leading-none">
                      {establishmentSummary.expiredTotal}
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-bold text-rose-650 leading-none uppercase">
                      Lotes Vencidos
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center p-16 bg-white border border-gray-200 rounded-xl shadow-sm">
              <Loader2 className="h-8 w-8 text-teal-600 animate-spin mb-3" />
              <p className="text-sm text-gray-500 font-medium">Buscando reportes e inventarios recibidos...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 sm:gap-6 animate-in fade-in duration-200">
              {stockFacilitiesList.map(f => {
                const statusObj = getUpdateStatus(f.lastUpdateTime);
                
                return (
                  <div
                  key={f.code}
                  className={`bg-white rounded-2xl border transition-all relative overflow-hidden flex flex-col h-full group ${
                    f.hasStock 
                      ? f.expiredCount > 0
                        ? 'border-rose-200/80 hover:border-rose-400 bg-gradient-to-b from-white to-rose-50/10 hover:shadow-lg'
                        : 'border-slate-200 hover:border-teal-400 hover:shadow-xl' 
                      : 'border-dashed border-slate-200 opacity-70'
                  }`}
                >
                  {/* Subtle top gradient line */}
                  <div className={`h-1 w-full absolute top-0 left-0 transition-colors ${f.hasStock ? (f.expiredCount > 0 ? 'bg-gradient-to-r from-rose-400 to-rose-600' : 'bg-gradient-to-r from-teal-400 to-emerald-500') : 'bg-slate-200'}`} />
                  
                  {/* Top bar indicators */}
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center shadow-sm relative ${f.hasStock ? (f.expiredCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-700') : 'bg-slate-50 text-slate-400'}`}>
                        <Hospital className="h-6 w-6" />
                        {f.hasStock && (
                          <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5" title={statusObj.label}>
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusObj.color}`} />
                            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white ${statusObj.color}`} />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 pt-0.5">
                        <span className="text-[10px] font-mono font-black text-slate-500 tracking-widest">{f.code}</span>
                        {f.hasStock && (
                          <div>
                            {renderSyncStatusPill(f.lastUpdateTime)}
                          </div>
                        )}
                        {f.hasSheetStock && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700">
                            <FileSpreadsheet className="h-3 w-3" />
                            Hoja asignada
                          </span>
                        )}
                        {f.hasStock && f.expiredCount > 0 && (
                          <div
                            onClick={(e) => { e.stopPropagation(); handleShowExpirations(f.code, "expired"); }}
                            className="flex items-center gap-1 bg-rose-50 text-rose-700 px-2.5 py-1 rounded-md text-[10px] font-bold border border-rose-200 hover:bg-rose-100 hover:border-rose-300 transition-colors cursor-pointer select-none"
                            title="Vencido en stock - Ver listado"
                          >
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>{f.expiredCount} Vencido{f.expiredCount !== 1 && 's'}</span>
                          </div>
                        )}
                        {f.hasStock && f.expiringThisMonthCount > 0 && (
                          <div
                            onClick={(e) => { e.stopPropagation(); handleShowExpirations(f.code, "expiring"); }}
                            className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-1 rounded-md text-[10px] font-bold border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer select-none"
                            title="Vence este mes - Ver listado"
                          >
                            <Clock className="h-3 w-3 shrink-0" />
                            <span>{f.expiringThisMonthCount} Por vencer</span>
                          </div>
                        )}
                      </div>
                    </div>
 
                    <div className="mb-5 flex-1">
                      <h4 className={`font-black text-lg leading-tight line-clamp-2 ${f.expiredCount > 0 ? 'text-rose-950' : 'text-slate-800'}`}>
                        {f.name}
                      </h4>
                    </div>
 
                    {/* Stats */}
                    {f.hasStock ? (
                      <div className="mt-auto flex flex-col gap-4">
                        <div 
                          className="w-full flex items-center justify-between gap-3 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 hover:border-slate-300 rounded-xl p-2.5 transition-all duration-200 cursor-pointer"
                          onClick={(e) => {
                             e.stopPropagation();
                             handleShowSyncHistory(f.code, f.name);
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileClock className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors shrink-0" />
                            <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors truncate">
                              {f.hasSheetStock ? `Hoja: ${f.assignmentSheetName || "asignada"}` : "Ultimos movimientos"}
                            </span>
                          </div>
                          <div className="flex items-center shrink-0">
                            {renderSyncStatusPill(f.fechaEquipoDateTime)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200 text-slate-500 text-[11px] flex gap-2 items-start mt-auto">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 opacity-60" />
                        <p className="font-medium leading-relaxed">
                          {f.hasAssignment
                            ? "La IPRESS tiene hoja asignada, pero aun no devuelve registros legibles. Revise la conexion o la hoja vinculada."
                            : "No se ha recibido stock de Sync. Autorice un dispositivo."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Footer actions */}
                  <div className="bg-white px-6 py-4 border-t border-slate-100 flex items-center justify-between mt-auto">
                    {f.hasStock ? (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                             <RefreshCw className="h-3 w-3 shrink-0 opacity-70" />
                             <span className="font-medium uppercase tracking-wider">Act: <span className="font-bold text-slate-700">
                               {f.lastUpdateTime ? (() => {
                                 const d = new Date(f.lastUpdateTime);
                                 const day = d.getDate().toString().padStart(2, '0');
                                 const month = (d.getMonth() + 1).toString().padStart(2, '0');
                                 const year = d.getFullYear();
                                 const hrs = d.getHours().toString().padStart(2, '0');
                                 const mins = d.getMinutes().toString().padStart(2, '0');
                                 return `${day}/${month}/${year} ${hrs}:${mins}`;
                                })() : 'Reciente'}
                             </span></span>
                          </div>
                          {f.fechaEquipo && (
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                               <Monitor className="h-3 w-3 shrink-0 opacity-70" />
                               <span className="font-medium uppercase tracking-wider">Equip: <span className={`font-bold ${!datesMatch(f.lastUpdateTime, f.fechaEquipoDateTime) ? "text-rose-600" : "text-slate-700"}`}>{f.fechaEquipo.slice(0, 16)}</span></span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setSelectedFacilityCode(f.code);
                            setActiveAlmTab("ALL");
                          }}
                          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 shadow-md shadow-slate-900/10 hover:shadow-lg hover:shadow-slate-900/20 active:scale-95 uppercase tracking-wide"
                        >
                          Ver Inventario
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">Sin datos</span>
                    )}
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      {/* Detailed Stock View for Selected Establishment */}
      {selectedFacilityCode && (
        <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Header Action bar */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Only show back button if user can see more than one facility (admin role) */}
                {stockFacilitiesList.length > 1 && (
                  <button
                    onClick={() => {
                      setSelectedFacilityCode(null);
                      setActiveAlmTab("ALL");
                    }}
                    className="p-2 border rounded-lg hover:bg-slate-50 transition-colors"
                    title="Volver al Directorio"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <div>
                  <span className="text-[10px] text-teal-600 font-bold uppercase tracking-wide">
                    {activeStockFacilityObj?.hasSheetStock ? "Detalle de hoja asignada" : "Detalle de stock sincronizado"}
                  </span>
                  <h2 className="text-base font-bold text-gray-800 leading-none mt-0.5">{activeFacilityObj?.name || 'Establecimiento Seleccionado'}</h2>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-gray-500 font-mono">IPRESS: <strong className="font-bold">{selectedFacilityCode}</strong></span>
                    <span className="text-gray-300">|</span>
                    <span className="text-[11px] text-gray-500 font-mono">Jurisdicción: {activeFacilityObj?.district || activeFacilityObj?.department || 'Regional'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm hover:shadow transition-all flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Exportar Excel (CSV)
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={refreshing || loading}
                  className="p-2 bg-slate-50 hover:bg-slate-100 border rounded-lg text-slate-600 hover:text-slate-900 transition-colors"
                  title="Sincronizar"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Expired Products Critical Alert Banner */}
            {activeStockFacilityObj && activeStockFacilityObj.expiredCount > 0 && (
              <div className="bg-rose-50 border border-rose-200/65 rounded-xl p-4.5 shadow-[0_2px_15px_-3px_rgba(244,63,94,0.12)] flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 border border-rose-200/50 shrink-0">
                  <AlertTriangle className="h-5 w-5 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-black text-rose-800 uppercase tracking-wider flex items-center gap-2">
                    ¡Control Sanitario Crítico! - Lotes Vencidos en Stock
                  </h4>
                  <p className="text-[11px] text-rose-700 leading-relaxed font-semibold">
                    Se han detectado <strong className="font-black text-rose-900 underline">{activeStockFacilityObj.expiredCount} lote(s)</strong> de medicamentos cuyas fechas de vencimiento han caducado. De conformidad con las directrices vigentes de la Ficha Técnica FT-EAM-001 y del Ministerio de Salud, estos medicamentos deben ser segregados físicamente e inutilizados de inmediato para prevenir incidentes de seguridad para el paciente.
                  </p>
                </div>
              </div>
            )}

          {/* Resumen General de Stock y Farmacias de la IPRESS */}
          {facilitySummaryMetrics && (
            <div className="space-y-4">
              {/* Tarjetas de Resumen General */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Medicamentos Únicos</span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-xl font-bold text-slate-800">{facilitySummaryMetrics.totalUniqueMeds}</span>
                    <span className="text-[10px] text-gray-500 font-medium">ítems</span>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Lotes Únicos en Stock</span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-xl font-bold text-slate-800">{facilitySummaryMetrics.totalBatches}</span>
                    <span className="text-[10px] text-gray-500 font-medium">lotes</span>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Unidades Físicas</span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-xl font-bold text-teal-600">{facilitySummaryMetrics.totalUnits.toLocaleString()}</span>
                    <span className="text-[10px] text-gray-500 font-medium">unidades</span>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Valor Total Estimado</span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-xl font-bold text-emerald-600">S/. {facilitySummaryMetrics.totalEstimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Sección "Todas las Farmacias/Almacenes" */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Hospital className="h-4 w-4 text-teal-600" />
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">Desglose de Farmacias y Almacenes de esta IPRESS</h3>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 ml-auto">
                    {facilitySummaryMetrics.warehouses.length} {facilitySummaryMetrics.warehouses.length === 1 ? 'Farmacia' : 'Farmacias / Almacenes'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {facilitySummaryMetrics.warehouses.map(wh => {
                    const isSelected = activeAlmTab === wh.code;
                    return (
                      <div
                        key={wh.code}
                        className={`p-3.5 rounded-lg border transition-all flex flex-col justify-between gap-2 group ${
                          isSelected 
                            ? 'bg-teal-50/40 border-teal-500 ring-2 ring-teal-500/20 shadow-sm' 
                            : 'bg-slate-50/50 border-slate-200 hover:bg-slate-50 hover:border-gray-300'
                        }`}
                      >
                        <button type="button" onClick={() => setActiveAlmTab(isSelected ? "ALL" : wh.code)} className="text-left">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-slate-800 line-clamp-1 group-hover:text-teal-600 transition-colors">
                              {wh.name}
                            </span>
                            <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-500 px-1 py-0.2 rounded border">
                              Cód: {wh.code}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2 border-t border-dashed border-slate-200 text-[10px]">
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase font-semibold">Ítems</span>
                              <span className="font-bold text-slate-700">{wh.uniqueMedsCount}</span>
                            </div>
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase font-semibold">Lotes</span>
                              <span className="font-bold text-slate-700">{wh.batchesCount}</span>
                            </div>
                            <div>
                              <span className="text-gray-400 block text-[9px] uppercase font-semibold">Unidades</span>
                              <span className="font-black text-teal-600">{wh.totalUnits.toLocaleString()}</span>
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center justify-between mt-1 text-[9px] text-slate-500 font-mono">
                          <span>Estimado: <strong>S/.{wh.estimatedValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>
                          <div className="flex items-center gap-2">
                             {canDeleteSyncedStock && (
                               <button
                                 type="button"
                                 onClick={() => requestDeleteWarehouse(wh.code, wh.name)}
                                 className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1 rounded transition-colors"
                                 title="Eliminar todos los datos de este almacén"
                                 aria-label={`Eliminar stock sincronizado de ${wh.name}`}
                               >
                                 <Trash2 className="h-3 w-3" />
                               </button>
                             )}
                             <button type="button" onClick={() => setActiveAlmTab(isSelected ? "ALL" : wh.code)} className="text-teal-600 font-bold group-hover:underline flex items-center gap-0.5">
                               {isSelected ? 'Ver Todos' : 'Filtrar Almacén →'}
                             </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

    
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Left Sidebar: Filters */}
            <div className="lg:col-span-1 bg-white border border-gray-200 rounded-xl p-4 shadow-sm h-fit space-y-4">
              
              <div className="flex items-center justify-between border-b pb-2 mb-2">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1">
                  <Filter className="h-3.5 w-3.5 text-slate-500" />
                  Filtrar Lote
                </span>
                {(searchTerm || ffinanFilter !== "ALL" || tipsumFilter !== "ALL") && (
                  <button
                    onClick={() => {
                      setSearchTerm("");
                      setFfinanFilter("ALL");
                      setTipsumFilter("ALL");
                    }}
                    className="text-[10px] text-teal-600 font-bold hover:underline"
                  >
                    Limpiar
                  </button>
                )}
              </div>

              {/* Text search */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Búsqueda rápida</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Sismed o descripción..."
                    className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Financing selector */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Fuente de Financiamiento</label>
                <select
                  value={ffinanFilter}
                  onChange={e => setFfinanFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="ALL">-- Todas las fuentes --</option>
                  {uniqueFfinans.map(f => (
                    <option key={f.code} value={f.code}>{f.name} ({f.code})</option>
                  ))}
                </select>
              </div>

              {/* Supply Tipsum selector */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Tipo Suministro</label>
                <select
                  value={tipsumFilter}
                  onChange={e => setTipsumFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="ALL">-- Todos los tipos --</option>
                  {uniqueTipsums.map(t => (
                    <option key={t.code} value={t.code}>{t.name} ({t.code})</option>
                  ))}
                </select>
              </div>

            </div>

            {/* Right: Tabular grid content list */}
            <div className="lg:col-span-3 space-y-4">
              
              {/* Warehouse Tabs */}
              <div className="flex border-b border-gray-200 overflow-x-auto bg-white rounded-t-xl">
                <button
                  onClick={() => setActiveAlmTab("ALL")}
                  className={`px-4 py-2.5 font-bold text-xs transition-colors whitespace-nowrap border-b-2 ${
                    activeAlmTab === "ALL" 
                      ? 'border-teal-600 text-teal-600 bg-teal-50/15' 
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5" />
                    Todo Sismed (Consolidado)
                  </span>
                </button>
                {facilityWarehouses.map(alm => (
                  <button
                    key={alm.code}
                    onClick={() => setActiveAlmTab(alm.code)}
                    className={`px-4 py-2.5 font-bold text-xs transition-colors whitespace-nowrap border-b-2 ${
                      activeAlmTab === alm.code 
                        ? 'border-teal-600 text-teal-600 bg-teal-50/15' 
                        : 'border-transparent text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {alm.name} ({alm.code})
                  </button>
                ))}
              </div>

              {finalFilteredItems.length === 0 ? (
                <div className="bg-white border rounded-xl p-12 text-center shadow-sm">
                  <Table className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                  <h4 className="font-bold text-gray-700">Sin datos de correspondencia</h4>
                  <p className="text-xs text-gray-400 mt-1">Modifique los filtros seleccionados o el criterio de búsqueda para encontrar registros.</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto text-left">
                    <table className="min-w-full divide-y divide-gray-200 text-left">
                      <thead className="bg-gray-50/70 text-gray-500 font-bold text-xs">
                        <tr>
                          <th className="px-5 py-3 text-[11px] uppercase tracking-wider">CÓDIGO SISMED</th>
                          <th className="px-5 py-3 text-[11px] uppercase tracking-wider">Descripción Medicamento</th>
                          <th className="px-5 py-3 text-[11px] uppercase tracking-wider">Lote / Venc.</th>
                          <th className="px-5 py-3 text-[11px] uppercase tracking-wider">Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 text-xs">
                        {finalFilteredItems.map((item, idx) => {
                          const expStatus = getItemExpirationStatus(item.fecha, Number(item.saldo));
                          const trClass = (() => {
                            if (expStatus === "EXPIRED") {
                              return "bg-rose-50/40 hover:bg-rose-100/40 transition-colors border-l-4 border-l-rose-500 font-medium";
                            }
                            if (expStatus === "EXPIRING") {
                              return "bg-amber-50/20 hover:bg-amber-100/20 transition-colors border-l-4 border-l-amber-500 font-medium";
                            }
                            return "hover:bg-slate-50/50 transition-colors";
                          })();
                          
                          return (
                            <tr key={`${item.id}_${idx}`} className={trClass}>
                              
                              {/* Codigo SISMED */}
                              <td className="px-5 py-3 font-mono font-bold text-gray-500 whitespace-nowrap">
                                {item.medcod}
                              </td>

                              {/* Description name */}
                              <td className="px-5 py-3">
                                <div>
                                  <span className={`font-bold block line-clamp-1 max-w-[280px] ${expStatus === "EXPIRED" ? "text-rose-950 font-black" : "text-gray-800"}`} title={item.xnom}>{item.xnom}</span>
                                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 font-semibold font-mono">
                                    <span>FF: {item.ffinan_des}</span>
                                    <span>•</span>
                                    <span>T: {item.tipsum_des}</span>
                                  </div>
                                </div>
                              </td>

                              {/* Lote / Expiration date */}
                              <td className="px-5 py-3 whitespace-nowrap">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1">
                                    <span className="font-bold text-gray-700 bg-slate-100 px-1.5 py-0.2 rounded border text-[10px] font-mono select-all">L:{item.lote}</span>
                                  </div>
                                  <div className="flex flex-col gap-0.5 font-mono">
                                    <span className={`text-[10px] block font-mono ${expStatus === "EXPIRED" ? "text-rose-700 font-black" : "text-gray-400"}`}>Venc: {item.fecha}</span>
                                    {expStatus === "EXPIRED" && (
                                      <span className="inline-flex items-center w-fit bg-rose-100 text-rose-800 font-extrabold text-[8.5px] px-1.5 py-0.2 rounded border border-rose-200 mt-0.5 tracking-wide uppercase shadow-3xs">
                                        ¡Vencido!
                                      </span>
                                    )}
                                    {expStatus === "EXPIRING" && (
                                      <span className="inline-flex items-center w-fit bg-amber-150 text-amber-850 font-extrabold text-[8.5px] px-1.5 py-0.2 rounded border border-amber-250 mt-0.5 tracking-wide uppercase shadow-3xs">
                                        Por Vence
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Balance Stock */}
                              <td className="px-5 py-3 font-mono font-black text-gray-800 whitespace-nowrap text-sm">
                                {item.saldo.toLocaleString()}
                              </td>

                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

          </div>

        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl border w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 text-red-600">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Eliminar base de datos local</h3>
              <p className="text-sm text-gray-600 mb-4">
                ¿Estás seguro de que deseas eliminar TODOS los datos de stock del almacén <strong>{deleteConfirmData.almName}</strong> ({deleteConfirmData.almcod})?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-6 flex gap-2 text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Esta acción es irreversible y eliminará todos los registros de lotes asociados a este almacén.</p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="px-4 py-2 font-bold text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border text-sm"
                  onClick={() => setDeleteConfirmData(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="px-4 py-2 font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-2 transition-colors shadow-sm text-sm"
                  onClick={confirmDeleteWarehouse}
                  disabled={refreshing}
                >
                  {refreshing ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                      day: "2-digit", month: "2-digit", year: "numeric",
                    });
                    const formattedTime = syncDate.toLocaleTimeString("es-PE", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                    });

                    return (
                      <div
                        key={item.id || index}
                        className={`bg-white rounded-2xl border border-slate-200/60 shadow-3xs flex flex-col relative overflow-hidden transition-all hover:border-slate-350 group/item ${
                          index === 0 ? "ring-2 ring-teal-500/20 border-teal-500/50" : ""
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
                                const parsedMeta = (() => {
                                  if (!item.changes_metadata) return null;
                                  try {
                                    return typeof item.changes_metadata === "string"
                                      ? JSON.parse(item.changes_metadata)
                                      : item.changes_metadata;
                                  } catch (e) {
                                    return null;
                                  }
                                })();

                                // Calculate total stock fallback
                                let totalStock = parsedMeta?.total_stock;
                                if (totalStock === undefined && parsedMeta?.items_snapshot) {
                                  totalStock = Object.values(parsedMeta.items_snapshot).reduce(
                                    (acc: number, curr: any) => acc + (Number(curr.qty) || 0),
                                    0
                                  );
                                }

                                // Calculate total value fallback
                                let totalValue = parsedMeta?.total_value;
                                if (totalValue === undefined && parsedMeta?.items_snapshot) {
                                  totalValue = Object.values(parsedMeta.items_snapshot).reduce(
                                    (acc: number, curr: any) => {
                                      const qty = Number(curr.qty) || 0;
                                      if (qty <= 0) return acc;
                                      const codSismed = curr.codigo;
                                      const match = stockRecords.find(r => r.medcod === codSismed || r.codigo_sig === codSismed);
                                      const price = match ? (match.precio_det || match.preciocab || 0) : 0;
                                      return acc + (qty * price);
                                    },
                                    0
                                  );
                                }

                                return (
                                  <div className="mt-1 space-y-0.5">
                                    <p className="text-[10px] font-bold text-slate-400 flex flex-wrap items-center gap-1.5 leading-relaxed">
                                      <span>
                                        Artículos: <span className="font-extrabold text-slate-600">{item.record_count}</span>
                                      </span>
                                      {totalStock !== undefined && totalStock > 0 && (
                                        <>
                                          <span className="text-slate-300">•</span>
                                          <span>
                                            Stock Total: <span className="font-extrabold text-slate-600">{Number(totalStock).toLocaleString("es-PE")}</span>
                                          </span>
                                        </>
                                      )}
                                    </p>
                                    {totalValue !== undefined && totalValue > 0 && (
                                      <p className="text-[10px] font-bold text-slate-400">
                                        Valorización: <span className="font-extrabold text-slate-600">S/ {Number(totalValue).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </p>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="flex sm:flex-col items-start sm:items-end gap-1.5 shrink-0">
                            {item.has_changes ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-4xs">
                                  Stock Modificado ({item.changed_items_count || "?"} items)
                                </span>
                              </div>
                            ) : (
                              <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-4xs">
                                Stock sin cambios
                              </span>
                            )}
                            <span className="text-[9px] text-slate-400 font-mono">
                              Hash: {item.stock_hash}
                            </span>
                          </div>
                        </div>
                        {item.has_changes &&
                          (() => {
                            try {
                              let changes: any[] = [];
                              if (item.changes_metadata) {
                                const parsed = typeof item.changes_metadata === "string" ? JSON.parse(item.changes_metadata) : item.changes_metadata;
                                changes = Array.isArray(parsed) ? parsed : parsed?.changes || [];
                                changes = changes.filter((c: any) => c.change !== 0);
                              }

                              if (!Array.isArray(changes) || changes.length === 0) return null;

                              return (
                                <details className="text-[10px] text-slate-600 border-t border-slate-100 group config-accordion bg-slate-50/50">
                                  <summary className="font-bold text-slate-500 hover:text-slate-800 p-2.5 cursor-pointer select-none list-none flex items-center justify-center gap-1.5 hover:bg-slate-100/50 transition-colors text-[10px] uppercase tracking-wider">
                                    <span>Ver detalle de items modificados ({changes.length})</span>
                                    <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform text-slate-400" />
                                  </summary>
                                  <div className="bg-slate-50/80 p-0 max-h-72 overflow-y-auto w-full border-t border-slate-100/50">
                                    {changes.map((change: any, i: number) => {
                                      const isPositive = change.change > 0;
                                      return (
                                        <div key={i} className="flex justify-between items-center py-2 px-4 border-b border-slate-100/60 last:border-0 hover:bg-white transition-colors relative group/row">
                                          <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${isPositive ? "bg-emerald-400" : "bg-rose-400"} opacity-0 group-hover/row:opacity-100 transition-opacity`} />
                                          <div className="flex flex-col flex-1 min-w-0 pr-4">
                                            <span className="truncate font-bold text-slate-700 text-[11px] uppercase" title={change.name || change.id}>
                                              {change.name || change.id}
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                              {(() => {
                                                if (!change.codigo || change.codigo === "UNKNOWN") return null;
                                                // If it is already a short 5-6 char code, it's already a medcod
                                                const displayCode = (() => {
                                                  if (change.codigo.length <= 6) return change.codigo;
                                                  // Otherwise attempt lookup in stockRecords
                                                  const match = stockRecords.find(
                                                    (r) => r.codigo_sig === change.codigo || r.medcod === change.codigo
                                                  );
                                                  if (match && match.medcod && match.medcod.length <= 6) {
                                                    return match.medcod;
                                                  }
                                                  // Substring matching by name as secondary backup
                                                  if (change.name) {
                                                    const nameMatch = stockRecords.find(
                                                      (r) => r.xnom && r.xnom.toLowerCase() === change.name.toLowerCase()
                                                    );
                                                    if (nameMatch && nameMatch.medcod && nameMatch.medcod.length <= 6) {
                                                      return nameMatch.medcod;
                                                    }
                                                  }
                                                  return change.codigo;
                                                })();
                                                
                                                return (
                                                  <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">
                                                    C: {displayCode}
                                                  </span>
                                                );
                                              })()}
                                              {change.lote && change.lote !== "N/A" && (
                                                <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">L: {change.lote}</span>
                                              )}
                                              {change.vto && change.vto !== "N/A" && (
                                                <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">V: {change.vto}</span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-3 shrink-0">
                                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                              <span className="text-slate-400 line-through decoration-slate-300">{change.previousQty}</span>
                                              <span className="text-slate-300">→</span>
                                              <span className="font-extrabold text-slate-700">{change.currentQty}</span>
                                            </div>
                                            <div className={`w-14 text-center px-1.5 py-1 rounded-md font-black text-[10px] uppercase tracking-wider shadow-4xs ${isPositive ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-rose-100 text-rose-700 border border-rose-200"}`}>
                                              {isPositive ? "+" : ""}{change.change}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              );
                            } catch (e) {
                              return null;
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
      {/* Modal de Expiración */}
      {isExpirationModalOpen && expirationModalType && activeExpirationFacility && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
            onClick={() => setIsExpirationModalOpen(false)}
          />
          
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col relative z-10 overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div
              className={`p-4 sm:p-6 border-b border-gray-100 flex items-start justify-between ${expirationModalType === "expired" ? "bg-rose-50" : "bg-amber-50"}`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${expirationModalType === "expired" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"}`}
                >
                  {expirationModalType === "expired" ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <Clock className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3
                    className={`text-lg font-black uppercase tracking-wide leading-none ${expirationModalType === "expired" ? "text-rose-900" : "text-amber-900"}`}
                  >
                    {expirationModalType === "expired"
                      ? "Productos Vencidos"
                      : "Productos por Vencer (Este mes)"}
                  </h3>
                  <p
                    className={`text-xs font-bold leading-tight mt-1 ${expirationModalType === "expired" ? "text-rose-600/80" : "text-amber-700/80"}`}
                  >
                    {activeExpirationFacility.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExpirationModalOpen(false)}
                className="p-2 hover:bg-black/5 rounded-full transition-colors group"
              >
                <X className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
              </button>
            </div>

            {/* List - Upgraded to elegant Table style requested by user */}
            <div className="flex-1 overflow-auto bg-gray-50/50 p-0">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50/80 sticky top-0 z-10 backdrop-blur-sm">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-black text-gray-550 uppercase tracking-wider whitespace-nowrap"
                    >
                      Cód. SISMED
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-black text-gray-550 uppercase tracking-wider"
                    >
                      Descripción del Producto
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-black text-gray-550 uppercase tracking-wider"
                    >
                      Saldo
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-black text-gray-550 uppercase tracking-wider"
                    >
                      Lote / Venc.
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {expirationRecords.map((item, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-black text-teal-750 bg-teal-50 px-1.5 py-0.5 rounded w-fit mb-1 border border-teal-100">
                            {item.codigo || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="text-xs sm:text-sm font-bold text-gray-900 break-words line-clamp-2"
                          title={item.name}
                        >
                          {item.name || "-"}
                        </div>
                        {/* Warehouse badge */}
                        <div className="text-[9.5px] mt-1 text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5 font-bold uppercase">
                          <span>ALM: {item.desc_alm}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span
                          className={`text-[15px] font-black ${item.saldo?.toString() === "0" ? "text-red-500 bg-red-50/50" : "text-gray-900 bg-gray-50/80"} px-2.5 py-1 rounded-lg border border-slate-150 inline-block`}
                        >
                          {item.saldo.toLocaleString() || "0"}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs font-black text-gray-900 uppercase">
                           {item.lote || "-"}
                        </div>
                        <div
                          className={`text-[10px] font-bold mt-1 ${expirationModalType === "expired" ? "text-red-600" : "text-amber-600"}`}
                        >
                          Vence: {item.fecha || "-"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expirationRecords.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  <p className="text-sm font-medium">No hay productos en esta categoría.</p>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t border-gray-100 bg-white flex justify-between items-center rounded-b-2xl">
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                Total ítems: {expirationRecords.length}
              </span>
              <button
                onClick={() => setIsExpirationModalOpen(false)}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm focus:ring-4 focus:ring-slate-100"
              >
                Cerrar vista
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
