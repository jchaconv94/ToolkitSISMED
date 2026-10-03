import React from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { formatStockDate, parseStockNumber, type ExpirationState } from "../services/assignedIpressStock";
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

/**
 * Detalle completo de un lote, al tocar una fila o una tarjeta: abajo en el celular, ventana
 * centrada en escritorio. Solo muestra las columnas que `canShow` permite.
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
        ["Código SISMED", canShow("Id_Producto") ? lotCode(row) : "", true],
        ["Código SIGA", canShow("CODIGO_SIG") ? lotCell(row.CODIGO_SIG) : "", true],
        ["Lote", canShow("Lote") ? lotCell(row.Lote) : "", true],
        ["Vencimiento", canShow("Fec_Vencim") ? formatStockDate(row.Fec_Vencim) : ""],
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

  return (
    <BottomSheet open={Boolean(row)} title="Detalle del lote" onClose={onClose} centeredOnDesktop hideTitle>
      {row && (
        <div className="space-y-4 pb-1">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[15px] font-black leading-snug text-slate-900">{canShow("Nombre") ? lotCell(row.Nombre) || "—" : "—"}</p>
            {canShow("Saldo") && (
              <div className="shrink-0 text-right">
                <p className={`text-2xl font-black leading-none ${state === "EXPIRED" ? "text-red-600" : "text-slate-900"}`}>{parseStockNumber(row.Saldo).toLocaleString("es-PE")}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Saldo</p>
              </div>
            )}
          </div>
          {state !== "NORMAL" && (
            <p className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold ${state === "EXPIRED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
              {state === "EXPIRED" ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              {state === "EXPIRED" ? "Lote vencido y todavía con saldo" : "Lote por vencer"}
            </p>
          )}
          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {fields.map(([label, value, mono]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-3 py-2.5 text-[13px]">
                <dt className="shrink-0 text-slate-500">{label}</dt>
                <dd className={`min-w-0 text-right font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </BottomSheet>
  );
};
