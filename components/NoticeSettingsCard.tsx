import React, { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { NOTICE_THRESHOLD_LIMITS, NoticeThresholds } from "../services/notifications";

/**
 * Tarjeta «Avisos» de Parámetros del Sistema: los dos umbrales de la campanita. Mismo estilo
 * que la tarjeta de Backups SISMED que tiene al lado. El guardado lo hace AdminPanel junto
 * con el resto de parámetros (`services/noticeSettings.ts`).
 */
export const NoticeSettingsCard: React.FC<{
  value: NoticeThresholds;
  /** Mientras no se lean los valores guardados, los campos quedan bloqueados. */
  disabled: boolean;
  error: string | null;
  onChange: (value: NoticeThresholds) => void;
}> = ({ value, disabled, error, onChange }) => {
  const field = (key: keyof NoticeThresholds, label: string) => (
    <DaysField
      id={`aviso-${key}`}
      label={label}
      value={value[key]}
      disabled={disabled}
      {...NOTICE_THRESHOLD_LIMITS[key]}
      onChange={(days) => onChange({ ...value, [key]: days })}
    />
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
        <Bell className="h-5 w-5 text-gray-500" />
        Avisos
      </h3>
      <p className="text-xs text-gray-500 mb-5 leading-relaxed max-w-3xl">
        Cuándo avisa la campanita. Se aplica a los informáticos (establecimientos que dejaron de
        enviar su stock) y a los responsables de farmacia (su propio stock y sus lotes).
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {field("staleDays", "Avisos: stock sin actualizar después de (días)")}
        {field("expiryDays", "Avisos: lotes por vencer dentro de (días)")}
      </div>
      {error && <p className="text-xs text-amber-700 mt-3">{error}</p>}
    </div>
  );
};

/** Se escribe libremente; al salir del campo se ajusta a sus límites. */
const DaysField: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, disabled, onChange }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    const days = Number.isFinite(n) && text.trim() !== "" ? Math.min(max, Math.max(min, n)) : value;
    setText(String(days));
    if (days !== value) onChange(days);
  };
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-bold text-gray-700 mb-2">{label}</label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={commit}
          className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center font-bold text-gray-900 focus:ring-2 focus:ring-teal-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <span className="text-sm text-gray-500">días (de {min} a {max})</span>
      </div>
    </div>
  );
};
