import React from "react";
import { AlertTriangle, Clock, Pill } from "lucide-react";
import { formatStockDate, parseExpiryDate, parseStockNumber, type ExpirationState } from "../services/assignedIpressStock";
import { StatusChip, type Tone } from "./ui/kit";
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

const STATE_CHIP: Record<ExpirationState, { label: string; tone: Tone }> = {
  NORMAL: { label: "Vigente", tone: "success" },
  EXPIRING: { label: "Por vencer", tone: "warning" },
  EXPIRED: { label: "Vencido", tone: "danger" },
};

/**
 * Detalle completo de un lote, al tocar una fila o una tarjeta: abajo en el celular, ventana
 * centrada en escritorio. Arriba el producto y su estado; luego saldo, vencimiento y lote en
 * tres recuadros; el resto agrupado por tema. Solo muestra las columnas que `canShow` permite.
 */
export const LotDetailSheet: React.FC<{
  row: LotRow | null;
  state: ExpirationState;
  onClose: () => void;
  canShow?: CanShow;
  pharmacy?: PharmacyLabel | null;
}> = ({ row, state, onClose, canShow = showAll, pharmacy }) => {
  type Field = [string, string, boolean?];
  const keep = (fields: Field[]) => fields.filter(([, value]) => value && value !== "—");
  const groups: Array<{ title: string; fields: Field[] }> = row
    ? [
        {
          title: "Identificación",
          fields: keep([
            ["Código SISMED", canShow("Id_Producto") ? lotCode(row) : "", true],
            ["Código SIGA", canShow("CODIGO_SIG") ? lotCell(row.CODIGO_SIG) : "", true],
            ["Registro sanitario", canShow("Reg_Sanitario") ? lotCell(row.Reg_Sanitario) : ""],
          ]),
        },
        {
          title: "Origen y ubicación",
          fields: keep([
            ["Tipo de suministro", canShow("DESC_TIPSUM") ? codeAndText(row.TIPSUM, row.DESC_TIPSUM) : ""],
            ["Fuente de financiamiento", canShow("DESC_FFINAN") ? codeAndText(row.FFINAN, row.DESC_FFINAN) : ""],
            ["Almacén", canShow("DESC_ALM") ? lotCell(row.DESC_ALM) : ""],
            ["Farmacia", pharmacy ? [pharmacy.code, pharmacy.name].filter(Boolean).join(" · ") : canShow("ALMCOD") ? lotCell(row.ALMCOD) : ""],
          ]),
        },
        {
          title: "Precios",
          fields: keep([
            ["Precio detalle", canShow("Precio_Det") ? money(row.Precio_Det) : ""],
            ["Precio paquete", canShow("Precio_Cab") ? money(row.Precio_Cab) : ""],
          ]),
        },
        {
          title: "Sincronización",
          fields: keep([
            ["Fecha del equipo", canShow("FECHA_DEL_EQUIPO") ? lotCell(row.FECHA_DEL_EQUIPO) : ""],
            ["Última actualización", canShow("ULTIMA_ACTUALIZACION") ? lotCell(row.ULTIMA_ACTUALIZACION ?? row.Ultima_Actualizacion) : ""],
          ]),
        },
      ].filter((group) => group.fields.length > 0)
    : [];

  const chip = STATE_CHIP[state];
  const expiryTone = state === "EXPIRED" ? "text-red-600" : state === "EXPIRING" ? "text-amber-700" : "text-slate-900";
  const tile = "rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3.5 py-3";
  const tileLabel = "text-[10px] font-black uppercase tracking-wider text-slate-400";

  return (
    <BottomSheet open={Boolean(row)} title="Detalle del lote" onClose={onClose} centeredOnDesktop hideTitle wide>
      {row && (
        <div className="space-y-5 pb-2 md:px-2">
          {/* Producto */}
          <div className="flex items-start gap-3.5 pr-6">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
              <Pill className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-black leading-snug text-slate-900">{canShow("Nombre") ? lotCell(row.Nombre) || "—" : "—"}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {canShow("Id_Producto") && lotCode(row) && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-bold text-slate-700">{lotCode(row)}</span>
                )}
                <StatusChip label={chip.label} tone={chip.tone} />
              </div>
            </div>
          </div>

          {state !== "NORMAL" && (
            <p className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold ${state === "EXPIRED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
              {state === "EXPIRED" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0" />}
              {state === "EXPIRED" ? "Lote vencido y todavía con saldo: retírelo del stock disponible." : "Lote por vencer: priorice su uso o redistribución."}
            </p>
          )}

          {/* Lo esencial */}
          <div className="grid grid-cols-3 gap-2.5">
            {canShow("Saldo") && (
              <div className={tile}>
                <p className={tileLabel}>Saldo</p>
                <p className={`mt-1 text-2xl font-black leading-none tabular-nums ${state === "EXPIRED" ? "text-red-600" : "text-slate-900"}`}>{parseStockNumber(row.Saldo).toLocaleString("es-PE")}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-400">unidades</p>
              </div>
            )}
            {canShow("Fec_Vencim") && (
              <div className={tile}>
                <p className={tileLabel}>Vencimiento</p>
                <p className={`mt-1 text-[17px] font-black leading-tight tabular-nums ${expiryTone}`}>{formatStockDate(row.Fec_Vencim)}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-400">{expiryDistance(row.Fec_Vencim)}</p>
              </div>
            )}
            {canShow("Lote") && (
              <div className={tile}>
                <p className={tileLabel}>Lote</p>
                <p className="mt-1 break-all font-mono text-[15px] font-bold leading-tight text-slate-900">{lotCell(row.Lote) || "—"}</p>
              </div>
            )}
          </div>

          {/* El resto, por tema */}
          {groups.map((group) => (
            <section key={group.title}>
              <h4 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">{group.title}</h4>
              <dl className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 sm:grid-cols-2">
                {group.fields.map(([label, value, mono], i) => (
                  <div
                    key={label}
                    className={`bg-white px-3.5 py-2.5 ${i === group.fields.length - 1 && group.fields.length % 2 === 1 ? "sm:col-span-2" : ""}`}
                  >
                    <dt className="text-[11px] font-semibold text-slate-400">{label}</dt>
                    <dd className={`mt-0.5 text-[13.5px] font-bold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </BottomSheet>
  );
};
