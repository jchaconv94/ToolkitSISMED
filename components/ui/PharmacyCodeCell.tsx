import React from "react";
import type { PharmacyLabel } from "../../services/facilitySheetLink";

/**
 * Celda de la columna «Código IPRESS»: el código del establecimiento y, debajo, su nombre.
 *
 * Una hoja de Google Sheets trae todas las farmacias de una IPRESS mezcladas, separadas
 * solo por el ALMCOD de cada fila. Sin esta columna no hay forma de saber qué filas son de
 * la farmacia principal y cuáles de un puesto comunal, y el saldo de dos sitios distintos
 * parece el de uno solo.
 *
 * La columna aparece únicamente cuando hay más de una farmacia en las filas que se están
 * viendo (`showsPharmacyColumn`); si no, sería una constante repetida ocupando ancho.
 *
 * Un puesto comunal que SISMED numera pero que nadie dio de alta se muestra igual, marcado:
 * ocultarlo dejaría el stock sin explicación, y la marca es la señal de que falta
 * registrarlo en Administración → Establecimientos.
 */
export const PharmacyCodeCell: React.FC<{ label: PharmacyLabel; className?: string }> = ({
  label,
  className = "",
}) => {
  if (!label?.code) return <span className="text-slate-400">—</span>;
  return (
    <div className={className}>
      <span className="font-mono text-xs font-bold text-slate-700">{label.code}</span>
      {label.name ? (
        <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-slate-400" title={label.name}>
          {label.name}
        </div>
      ) : label.unregistered ? (
        <div className="mt-0.5 text-[10px] font-bold text-amber-600">Sin registrar</div>
      ) : null}
    </div>
  );
};
