import React, { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { NOTICE_THRESHOLD_LIMITS, NoticeThresholds } from "../services/notifications";
import { SettingsRow, SettingsSection, settingsNumberClass } from "./ui/SettingsSection";

/**
 * Sección «Avisos» de Parámetros del Sistema: los dos umbrales de la campanita. El guardado lo
 * hace AdminPanel junto con el resto de parámetros (`services/noticeSettings.ts`).
 */
export const NoticeSettingsCard: React.FC<{
  value: NoticeThresholds;
  /** Valores guardados, para marcar lo cambiado. */
  saved: NoticeThresholds | null;
  /** Mientras no se lean los valores guardados, los campos quedan bloqueados. */
  disabled: boolean;
  error: string | null;
  onChange: (value: NoticeThresholds) => void;
}> = ({ value, saved, disabled, error, onChange }) => {
  const field = (key: keyof NoticeThresholds, label: string, help: string) => (
    <SettingsRow label={label} help={help} htmlFor={`aviso-${key}`} changed={!!saved && saved[key] !== value[key]}>
      <DaysField
        id={`aviso-${key}`}
        value={value[key]}
        disabled={disabled}
        {...NOTICE_THRESHOLD_LIMITS[key]}
        onChange={(days) => onChange({ ...value, [key]: days })}
      />
    </SettingsRow>
  );

  return (
    <SettingsSection icon={<Bell />} iconClass="bg-cyan-50 text-cyan-700" title="Avisos" subtitle="Cuándo avisa la campanita">
      {field("staleDays", "Stock sin actualizar", "Avisa a informáticos y responsables de farmacia cuando un establecimiento no envía su stock en este tiempo.")}
      {field("expiryDays", "Lotes por vencer", "Avisa al responsable de farmacia de los lotes que vencen dentro de este plazo.")}
      {error && <p className="px-4 py-3 text-xs text-amber-700 md:px-5">{error}</p>}
    </SettingsSection>
  );
};

/** Se escribe libremente; al salir del campo se ajusta a sus límites. */
const DaysField: React.FC<{
  id: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}> = ({ id, value, min, max, disabled, onChange }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    const days = Number.isFinite(n) && text.trim() !== "" ? Math.min(max, Math.max(min, n)) : value;
    setText(String(days));
    if (days !== value) onChange(days);
  };
  return (
    <div className="flex items-center gap-2.5">
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
        className={settingsNumberClass}
      />
      <span className="text-[13px] text-slate-500">días ({min} a {max})</span>
    </div>
  );
};
