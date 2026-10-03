/**
 * Umbrales de los avisos (Parámetros del Sistema): días sin actualizar el stock y ventana de
 * lotes por vencer.
 *
 * Viven en su propia tabla (`supabase/SUPABASE_AVISOS_PARAMETROS.sql`) y no en
 * `system_config`, que se lee antes de iniciar sesión y cualquiera puede escribir con la
 * clave pública. Los lee cualquier sesión válida; solo el administrador los cambia.
 *
 * Si el script aún no se aplicó o la lectura falla, la campana sigue con los valores por
 * omisión (3 y 90 días): se puede desplegar antes de ejecutar el SQL.
 */

import { callSendKeysRpc } from "./sendKeys";
import { DEFAULT_NOTICE_THRESHOLDS, NoticeThresholds, normalizeThresholds } from "./notifications";

const SQL = "SUPABASE_AVISOS_PARAMETROS.sql";

export interface NoticeSettings extends NoticeThresholds {
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export const noticeSettingsApi = {
  /** Lanza error si no se pudo leer (para que Parámetros del Sistema lo diga). */
  get: async (): Promise<NoticeSettings> => {
    const data = await callSendKeysRpc<Partial<NoticeSettings> | null>("app_notice_settings_get", {}, SQL);
    return { ...normalizeThresholds(data), updatedBy: data?.updatedBy ?? null, updatedAt: data?.updatedAt ?? null };
  },
  /** Para la campana: nunca falla, recurre a los valores por omisión. */
  getOrDefault: async (): Promise<NoticeThresholds> => {
    try {
      const { staleDays, expiryDays } = await noticeSettingsApi.get();
      return { staleDays, expiryDays };
    } catch {
      return DEFAULT_NOTICE_THRESHOLDS;
    }
  },
  save: (value: NoticeThresholds) =>
    callSendKeysRpc<void>("app_notice_settings_save", { p_stale_days: value.staleDays, p_expiry_days: value.expiryDays }, SQL),
};
