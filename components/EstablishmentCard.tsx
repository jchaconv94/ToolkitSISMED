import React from "react";
import {
  Hospital,
  AlertTriangle,
  Clock,
  RefreshCw,
  Monitor,
  Package,
  FileClock,
  Check,
  Square,
} from "lucide-react";

export interface EstablishmentCardData {
  id: string;
  name: string;
  code?: string;
  lastUpdateTime?: number | null;
  equipmentDateTime?: number | null;
  expiredCount: number;
  expiringThisMonthCount: number;
  totalItems: number;
  syncRecordDate?: string | null;
  hasSyncRecord?: boolean;
  isCheckingSync?: boolean;
}

export const getCardUpdateStatus = (timestamp?: number | null) => {
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

  // <= 1 hora: Verde
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

  // 1 a 24 horas: Amarillo
  if (diffHours <= 24) {
    const hrs = Math.floor(diffHours);
    const mins = diffMinutes % 60;
    return {
      color: "bg-amber-500",
      label: `Hace ${hrs}h ${mins}m`,
      fullLabel: `Hace ${hrs} hora${hrs !== 1 ? "s" : ""} ${mins} minuto${mins !== 1 ? "s" : ""}`,
    };
  }

  // > 24 horas: Rojo
  const days = Math.floor(diffHours / 24);
  const hrs = Math.floor(diffHours) % 24;
  return {
    color: "bg-red-500",
    label: `Hace ${days}d ${hrs}h`,
    fullLabel: `Hace ${days} día${days !== 1 ? "s" : ""} ${hrs} hora${hrs !== 1 ? "s" : ""}`,
  };
};

export const formatCardFullDate = (timestamp?: number | null): string => {
  if (!timestamp || timestamp === 0) return "Sin fecha";
  const d = new Date(timestamp);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

export const checkDatesMatch = (ts1?: number | null, ts2?: number | null): boolean => {
  if (!ts1 || !ts2) return true;
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
};

export const renderCardSyncStatusPill = (timestamp?: number | null) => {
  const statusObj = getCardUpdateStatus(timestamp);
  const isEmerald =
    statusObj.color.includes("emerald") ||
    statusObj.color.includes("bg-emerald-500");
  const isAmber =
    statusObj.color.includes("amber") ||
    statusObj.color.includes("bg-amber-500");
  const isRed =
    statusObj.color.includes("red") || statusObj.color.includes("bg-red-500");

  let containerClass = "bg-slate-100 text-slate-600 border-slate-200";
  let dotClass = "bg-slate-400";

  if (isEmerald) {
    containerClass = "bg-emerald-50 text-emerald-800 border-emerald-200";
    dotClass = "bg-emerald-500";
  } else if (isAmber) {
    containerClass = "bg-amber-50 text-amber-800 border-amber-200";
    dotClass = "bg-amber-500";
  } else if (isRed) {
    containerClass = "bg-rose-50 text-rose-800 border-rose-200";
    dotClass = "bg-rose-500";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wide border select-none whitespace-nowrap ${containerClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span>{statusObj.label}</span>
    </span>
  );
};

interface EstablishmentCardProps {
  data: EstablishmentCardData;
  isCaptureMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onClick?: () => void;
  onShowHistory?: (e: React.MouseEvent) => void;
  isStaticPreview?: boolean;
  className?: string;
}

export const EstablishmentCard: React.FC<EstablishmentCardProps> = ({
  data,
  isCaptureMode = false,
  isSelected = false,
  onToggleSelect,
  onClick,
  onShowHistory,
  isStaticPreview = false,
  className = "",
}) => {
  const {
    name,
    code,
    lastUpdateTime,
    equipmentDateTime,
    expiredCount,
    expiringThisMonthCount,
    totalItems,
    syncRecordDate,
    hasSyncRecord,
    isCheckingSync,
  } = data;

  const statusObj = getCardUpdateStatus(lastUpdateTime);
  const isMismatch = !checkDatesMatch(lastUpdateTime, equipmentDateTime);

  const formattedSyncDate = syncRecordDate
    ? new Date(syncRecordDate).toLocaleString("es-PE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  const cardContent = (
    <div
      className={`group relative bg-white border p-4 sm:p-5 rounded-xl sm:rounded-2xl transition-all text-left flex flex-col items-start justify-between h-full overflow-hidden ${
        isCaptureMode && isSelected
          ? "border-rose-500 ring-4 ring-rose-400/30 bg-rose-50/20 shadow-md"
          : isCaptureMode
          ? "border-slate-200 hover:border-rose-300 hover:ring-2 hover:ring-rose-200/50 shadow-sm"
          : "border-slate-200/90 shadow-xs hover:shadow-md hover:border-teal-500"
      } ${className}`}
      style={{ boxSizing: "border-box" }}
    >
      {/* Capture selection checkbox badge */}
      {isCaptureMode && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5 transition-all">
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

      {/* Top-Right Badges: Sync Status & Expirations */}
      <div className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 flex flex-col gap-1 items-end z-10 p-0.5">
        {renderCardSyncStatusPill(lastUpdateTime)}

        {expiredCount > 0 && (
          <div
            className="flex items-center gap-1 bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-[9px] font-extrabold border border-rose-200/80 shadow-3xs"
            title="Vencido en stock"
          >
            <AlertTriangle className="h-3 w-3 text-rose-500 shrink-0" />
            <span>
              {expiredCount} vencido{expiredCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {expiringThisMonthCount > 0 && (
          <div
            className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full text-[9px] font-extrabold border border-amber-200/80 shadow-3xs"
            title="Vence este mes"
          >
            <Clock className="h-3 w-3 text-amber-500 shrink-0" />
            <span>
              {expiringThisMonthCount} por vencer
            </span>
          </div>
        )}
      </div>

      {/* Main Body */}
      <div className="w-full flex-1">
        {/* Hospital Icon Box with Status Dot */}
        <div className="w-11 h-11 shrink-0 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-3 group-hover:bg-blue-600 group-hover:text-white transition-colors relative">
          <Hospital className="h-5.5 w-5.5" />
          <div
            className="absolute -top-1 -right-1 flex h-3.5 w-3.5"
            title={statusObj.label}
          >
            {!isStaticPreview && (
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusObj.color}`}
              />
            )}
            <span
              className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white ${statusObj.color}`}
            />
          </div>
        </div>

        {/* Code & Title */}
        <div className="mb-3 min-w-0 w-full">
          {code && (
            <p className="text-[10px] font-bold text-teal-600 mb-0.5 tracking-wide">
              {code}
            </p>
          )}
          <h3
            className="text-[14px] sm:text-[15px] font-bold text-slate-800 leading-snug mb-1"
            style={{
              wordBreak: "break-word",
              overflowWrap: "break-word",
            }}
            title={name}
          >
            {name}
          </h3>

          {/* Last updated info */}
          {lastUpdateTime ? (
            <div className="flex flex-col gap-0.5 mt-2">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 flex-wrap">
                <RefreshCw className="h-3 w-3 text-slate-400 shrink-0" />
                <span>
                  Act:{" "}
                  <span className="font-bold text-slate-700">
                    {formatCardFullDate(lastUpdateTime)}
                  </span>
                </span>
              </div>

              {equipmentDateTime && (
                <div
                  className={`flex items-center gap-1.5 text-[10px] font-medium ${
                    isMismatch ? "text-rose-600" : "text-slate-400"
                  }`}
                >
                  <Monitor className="h-3 w-3 shrink-0" />
                  <span>
                    Equipo:{" "}
                    <span
                      className={`font-bold ${
                        isMismatch ? "text-rose-600 font-extrabold" : "text-slate-600"
                      }`}
                    >
                      {formatCardFullDate(equipmentDateTime)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          ) : null}

          {/* Movements / Supabase Row */}
          <div
            className="w-full mt-2.5 pt-2.5 border-t border-slate-100 flex flex-col gap-2 relative z-20"
            onClick={(e) => {
              if (!isStaticPreview) e.stopPropagation();
            }}
          >
            {isCheckingSync ? (
              <div className="flex items-center justify-between bg-white border border-slate-200/80 shadow-3xs rounded-lg p-1.5 px-2">
                <div className="flex items-center gap-1.5 text-slate-500 font-bold text-[10px]">
                  <FileClock className="h-3.5 w-3.5" />
                  <span>Historial de cambios</span>
                </div>
                <div className="flex items-center gap-1 text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                  <span className="font-extrabold uppercase text-[8.5px] tracking-wide">
                    Comprobando
                  </span>
                </div>
              </div>
            ) : syncRecordDate ? (
              <div
                onClick={(e) => {
                  if (onShowHistory) {
                    e.stopPropagation();
                    onShowHistory(e);
                  }
                }}
                className={`w-full flex items-center justify-between gap-2 bg-white ${
                  !isStaticPreview ? "hover:bg-slate-50 hover:border-slate-300 hover:shadow-xs cursor-pointer" : ""
                } border border-slate-200/80 shadow-3xs rounded-lg p-1.5 px-2 transition-all duration-200 group`}
                title={formattedSyncDate ? `Último cambio en inventario: ${formattedSyncDate}` : undefined}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileClock className="h-3.5 w-3.5 text-slate-400 group-hover:text-teal-600 transition-colors shrink-0" />
                  <span className="text-[10px] font-bold text-slate-600 group-hover:text-slate-900 transition-colors truncate">
                    Últimos movimientos
                  </span>
                </div>
                <div className="flex items-center shrink-0">
                  {renderCardSyncStatusPill(new Date(syncRecordDate).getTime())}
                </div>
              </div>
            ) : (
              <div
                onClick={(e) => {
                  if (onShowHistory) {
                    e.stopPropagation();
                    onShowHistory(e);
                  }
                }}
                className={`w-full flex items-center justify-between gap-2 bg-white ${
                  !isStaticPreview ? "hover:bg-slate-50 hover:border-slate-300 hover:shadow-xs cursor-pointer" : ""
                } border border-slate-200/80 shadow-3xs rounded-lg p-1.5 px-2 transition-all duration-200 group`}
                title="Haz clic para consultar o registrar el historial de cambios en Supabase"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileClock className="h-3.5 w-3.5 text-slate-400 group-hover:text-teal-600 transition-colors shrink-0" />
                  <span className="text-[10px] font-bold text-slate-600 group-hover:text-slate-900 transition-colors truncate">
                    Historial de cambios
                  </span>
                </div>
                <span className="bg-slate-100 text-slate-600 group-hover:bg-teal-50 group-hover:text-teal-700 group-hover:border-teal-200 border border-slate-200 px-1.5 py-0.5 rounded font-extrabold uppercase text-[8.5px] tracking-wide transition-colors">
                  Sin verificar
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Consultar Stock + items */}
      <div className="flex items-center justify-between w-full mt-auto pt-3 border-t border-slate-100">
        <span className="text-[10px] font-extrabold text-teal-600 uppercase tracking-wider">
          Consultar Stock
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 text-slate-600 text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md"
            title="Total de ítems en este establecimiento"
          >
            <Package className="h-3 w-3 text-slate-400" />
            <span>{totalItems} items</span>
          </span>
        </div>
      </div>
    </div>
  );

  if (isStaticPreview) {
    return cardContent;
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (isCaptureMode && onToggleSelect) {
          onToggleSelect();
        } else if (onClick) {
          onClick();
        }
      }}
      className="w-full h-full text-left p-0 bg-transparent border-0 cursor-pointer focus:outline-none"
    >
      {cardContent}
    </button>
  );
};
