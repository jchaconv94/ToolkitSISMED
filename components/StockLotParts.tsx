import React from "react";
import { AlertTriangle, CalendarClock, Clock, Hash, Package, Pill, ShieldCheck, X } from "lucide-react";
import { formatStockDate, parseExpiryDate, parseStockNumber, type ExpirationState } from "../services/assignedIpressStock";
import { BottomSheet } from "./ui/BottomSheet";
import { PharmacyCodeCell } from "./ui/PharmacyCodeCell";
import type { PharmacyLabel } from "../services/facilitySheetLink";

/**
 * Piezas de un lote de stock que comparten «Stock SISMED» y «Consulta Stock».
 *
 * Las dos pantallas muestran las mismas filas de la hoja de Google Sheets; antes cada una
 * tenía su tarjeta del celular, su forma de marcar el vencimiento y su detalle, y al
 * rediseñar una la otra se quedaba con el diseño viejo. Lo que es igual vive aquí.
 *
 * Las filas llegan con el código SISMED como `Id_Producto` (Stock SISMED, ya normalizadas)
 * o como `ID_Producto` (Consulta Stock); `lotCode` acepta las dos.
 */

export type LotRow = Record<string, unknown>;

/** Qué columnas puede ver quien consulta. Por omisión, todas (Consulta Stock). */
export type CanShow = (key: string) => boolean;
const showAll: CanShow = () => true;

/** Valor de una celda tal como viene, o vacío. */
export const lotCell = (value: unknown) => String(value ?? "").trim();

export const lotCode = (row: LotRow) => lotCell(row.Id_Producto ?? row.ID_Producto);

/** Código y descripción juntos: «CN · Compra nacional». */
export const codeAndText = (code: unknown, text: unknown) =>
  [lotCell(code), lotCell(text)].filter((v, i, all) => v && all.indexOf(v) === i).join(" · ");

const money = (value: unknown) => {
  const n = parseStockNumber(value);
  return lotCell(value) ? `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : "";
};

/**
 * Fecha de vencimiento con su estado: el color y el ícono acompañan a la palabra («Vence» /
 * «Venció»), así no hace falta una etiqueta aparte que en el celular se va a otra línea.
 */
export const ExpiryDate: React.FC<{ value: unknown; state: ExpirationState }> = ({ value, state }) => {
  const date = formatStockDate(value);
  if (state === "EXPIRED") {
    return <span title="Lote vencido" className="inline-flex items-center gap-1 font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />Venció {date}</span>;
  }
  if (state === "EXPIRING") {
    return <span title="Lote por vencer" className="inline-flex items-center gap-1 font-semibold text-amber-700"><Clock className="h-3.5 w-3.5" />Vence {date}</span>;
  }
  return <span>Vence {date}</span>;
};

/** Tarjeta del celular: nombre, código, lote y vencimiento; el saldo a la derecha. Al tocar, el detalle. */
export const LotMobileItem: React.FC<{
  row: LotRow;
  state: ExpirationState;
  onOpen: () => void;
  canShow?: CanShow;
  pharmacy?: PharmacyLabel | null;
}> = ({ row, state, onOpen, canShow = showAll, pharmacy }) => (
  <li
    role="button"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    className="flex cursor-pointer gap-3 px-4 py-3 active:bg-slate-50"
  >
    <div className="min-w-0 flex-1">
      {pharmacy && <PharmacyCodeCell label={pharmacy} className="mb-1" />}
      <p className="text-[14px] font-bold leading-snug text-slate-900">{canShow("Nombre") ? lotCell(row.Nombre) || "—" : "—"}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
        {canShow("Id_Producto") && <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] font-bold text-slate-700">{lotCode(row) || "—"}</span>}
        {canShow("Lote") && <span>Lote <span className="font-mono text-slate-700">{lotCell(row.Lote) || "—"}</span></span>}
        {canShow("Fec_Vencim") && <ExpiryDate value={row.Fec_Vencim} state={state} />}
      </p>
    </div>
    <div className="shrink-0 text-right">
      <p className={`text-lg font-black leading-tight ${state === "EXPIRED" ? "text-red-600" : "text-slate-900"}`}>{canShow("Saldo") ? parseStockNumber(row.Saldo).toLocaleString("es-PE") : "—"}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Saldo</p>
    </div>
  </li>
);

/** «en 3 meses», «en 12 días», «hace 5 días»: cuánto falta (o pasó) para el vencimiento. */
const expiryDistance = (value: unknown): string => {
  const date = parseExpiryDate(value);
  if (!date) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "vence hoy";
  const abs = Math.abs(days);
  const amount = abs >= 60 ? `${Math.round(abs / 30)} meses` : `${abs} día${abs === 1 ? "" : "s"}`;
  return days > 0 ? `en ${amount}` : `hace ${amount}`;
};

/** Estado del lote en la cabecera oscura: color e ícono. */
const STATE_BADGE: Record<ExpirationState, { label: string; className: string; icon: React.ReactNode }> = {
  NORMAL: { label: "Vigente", className: "text-emerald-300", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  EXPIRING: { label: "Por vencer", className: "text-amber-300", icon: <Clock className="h-3.5 w-3.5" /> },
  EXPIRED: { label: "Vencido", className: "text-red-300", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
};

/**
 * Detalle completo de un lote, al tocar una fila o una tarjeta: abajo en el celular, ventana
 * centrada en escritorio. Cabecera oscura con el producto, su código y estado, y saldo,
 * vencimiento y lote en tres recuadros; abajo, el resto de campos en dos columnas. Solo
 * muestra las columnas que `canShow` permite.
 */
export const LotDetailSheet: React.FC<{
  row: LotRow | null;
  state: ExpirationState;
  onClose: () => void;
  canShow?: CanShow;
  pharmacy?: PharmacyLabel | null;
}> = ({ row, state, onClose, canShow = showAll, pharmacy }) => {
  const fields: Array<[string, string, boolean?]> = row
    ? ([
        ["Código SIGA", canShow("CODIGO_SIG") ? lotCell(row.CODIGO_SIG) : "", true],
        ["Registro sanitario", canShow("Reg_Sanitario") ? lotCell(row.Reg_Sanitario) : ""],
        ["Tipo de suministro", canShow("DESC_TIPSUM") ? codeAndText(row.TIPSUM, row.DESC_TIPSUM) : ""],
        ["Fuente de financiamiento", canShow("DESC_FFINAN") ? codeAndText(row.FFINAN, row.DESC_FFINAN) : ""],
        ["Almacén", canShow("DESC_ALM") ? lotCell(row.DESC_ALM) : ""],
        ["Farmacia", pharmacy ? [pharmacy.code, pharmacy.name].filter(Boolean).join(" · ") : canShow("ALMCOD") ? lotCell(row.ALMCOD) : ""],
        ["Precio detalle", canShow("Precio_Det") ? money(row.Precio_Det) : ""],
        ["Precio paquete", canShow("Precio_Cab") ? money(row.Precio_Cab) : ""],
        ["Fecha del equipo", canShow("FECHA_DEL_EQUIPO") ? lotCell(row.FECHA_DEL_EQUIPO) : ""],
        ["Última actualización", canShow("ULTIMA_ACTUALIZACION") ? lotCell(row.ULTIMA_ACTUALIZACION ?? row.Ultima_Actualizacion) : ""],
      ] as Array<[string, string, boolean?]>).filter(([, value]) => value && value !== "—")
    : [];

  const badge = STATE_BADGE[state];
  const tiles: Array<{ key: string; label: string; icon: React.ReactNode; value: string; hint?: string; className: string }> = row
    ? [
        canShow("Saldo") && {
          key: "saldo",
          label: "Saldo",
          icon: <Package className="h-3.5 w-3.5" />,
          value: parseStockNumber(row.Saldo).toLocaleString("es-PE"),
          hint: "unidades",
          className: `text-2xl ${state === "EXPIRED" ? "text-red-300" : "text-white"}`,
        },
        canShow("Fec_Vencim") && {
          key: "vence",
          label: "Vence",
          icon: <CalendarClock className="h-3.5 w-3.5" />,
          value: formatStockDate(row.Fec_Vencim),
          hint: expiryDistance(row.Fec_Vencim),
          className: `text-[15px] ${state === "EXPIRED" ? "text-red-300" : state === "EXPIRING" ? "text-amber-300" : "text-white"}`,
        },
        canShow("Lote") && {
          key: "lote",
          label: "Lote",
          icon: <Hash className="h-3.5 w-3.5" />,
          value: lotCell(row.Lote) || "—",
          className: "break-all font-mono text-[15px] text-white",
        },
      ].filter(Boolean) as Array<{ key: string; label: string; icon: React.ReactNode; value: string; hint?: string; className: string }>
    : [];

  return (
    <BottomSheet open={Boolean(row)} title="Detalle del lote" onClose={onClose} centeredOnDesktop wide bare>
      {row && (
        <>
          {/* Cabecera oscura: producto y lo esencial del lote. */}
          <div className="relative bg-slate-900 px-5 pb-5 pt-5 text-white">
            <div className="mx-auto -mt-2 mb-3 h-1.5 w-12 rounded-full bg-white/25 md:hidden" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3 pr-8">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
                <Pill className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[16px] font-black leading-snug">{canShow("Nombre") ? lotCell(row.Nombre) || "—" : "—"}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-slate-400">
                  {canShow("Id_Producto") && lotCode(row) && (
                    <>
                      <span className="font-mono font-bold text-teal-300">{lotCode(row)}</span>
                      <span>·</span>
                    </>
                  )}
                  <span className={`inline-flex items-center gap-1 font-bold ${badge.className}`}>{badge.icon}{badge.label}</span>
                </p>
              </div>
            </div>
            {tiles.length > 0 && (
              <div className={`mt-4 grid gap-2 ${tiles.length === 3 ? "grid-cols-3" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                {tiles.map((t) => (
                  <div key={t.key} className="rounded-xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-white/10">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t.icon}{t.label}</p>
                    <p className={`mt-1 font-black leading-none tabular-nums ${t.className}`}>{t.value}</p>
                    {t.hint && <p className="mt-1 text-[11px] text-slate-400">{t.hint}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* El resto de campos, en dos columnas en escritorio. */}
          <div className="px-5 pb-5 pt-2">
            <dl className="grid gap-x-6 md:grid-cols-2">
              {fields.map(([label, value, mono]) => (
                <div key={label} className="border-b border-slate-100 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className={`mt-0.5 text-[13.5px] font-bold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              Datos leídos de la hoja del establecimiento.
            </p>
          </div>
        </>
      )}
    </BottomSheet>
  );
};
