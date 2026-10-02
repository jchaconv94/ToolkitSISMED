-- ============================================================================
--  BACKUPS SISMED · ETAPA 6 - Abrir a todas las UNGET
-- ============================================================================
--
--  QUÉ HACE
--
--  Hasta ahora solo podían conectarse y aparecer en el módulo los establecimientos de
--  `backup_pilot_codes` (el piloto, hoy solo 030S05). Este script quita esa condición:
--  desde que se ejecuta, entra todo establecimiento que tenga CLAVE DE ENVÍO.
--
--    - La clave de envío sigue siendo obligatoria: la PC se identifica con ella. Un
--      establecimiento sin clave no se conecta ni aparece en Backups SISMED.
--    - El piloto no se borra: queda como interruptor. `backup_settings.pilot_only`
--      decide; si hay que volver atrás, basta con la REVERSIÓN del final.
--    - Las demás reglas no cambian: jurisdicción, cupo diario y topes de consumo.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere SUPABASE_BACKUPS_CONEXION.sql, SUPABASE_BACKUPS_REGLAS.sql y
--    SUPABASE_BACKUPS_MODULO.sql.
--
--    Las PC consultan cada 30 minutos si deben conectarse, así que van apareciendo
--    solas en ese plazo (o al reiniciar Sync SISMED).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- true = solo los establecimientos del piloto; false = todos los que tengan clave.
ALTER TABLE public.backup_settings
  ADD COLUMN IF NOT EXISTS pilot_only boolean NOT NULL DEFAULT true;

UPDATE public.backup_settings SET pilot_only = false, updated_at = now() WHERE id;


-- ¿Este establecimiento puede usar los backups? Única regla, usada por las tres funciones.
CREATE OR REPLACE FUNCTION public.app_backup_code_open(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT COALESCE((SELECT pilot_only FROM public.backup_settings WHERE id), true)
      OR EXISTS (SELECT 1 FROM public.backup_pilot_codes p WHERE p.code = upper(trim(p_code)));
$$;

REVOKE ALL ON FUNCTION public.app_backup_code_open(text) FROM PUBLIC, anon, authenticated;


-- Las tres funciones de antes, con el piloto cambiado por app_backup_code_open.

CREATE OR REPLACE FUNCTION public.app_backup_pc_enabled(p_codes text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(k.code ORDER BY k.code), '{}')
  FROM public.sync_send_keys k
  WHERE public.app_backup_code_open(k.code)
    AND k.code = ANY (SELECT upper(trim(c)) FROM unnest(COALESCE(p_codes, '{}')) c LIMIT 20);
$$;

REVOKE ALL ON FUNCTION public.app_backup_pc_enabled(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_pc_enabled(text[]) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.app_backup_pc_auth(p_items jsonb, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_verify jsonb;
  v_result jsonb;
BEGIN
  v_verify := public.app_send_key_verify(p_items, p_device_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', upper(f.code), 'ungetId', f.unget_id::text, 'name', f.name) ORDER BY f.code), '[]'::jsonb)
    INTO v_result
  FROM jsonb_each(v_verify) e(code, r)
  JOIN public.facilities f ON upper(f.code) = e.code
  -- Solo la PC ya vinculada: una clave sin vincular que llegó a otra PC por error no basta.
  JOIN public.sync_send_keys k ON k.code = e.code AND k.device_id = left(trim(p_device_id), 120)
  WHERE public.app_backup_code_open(e.code)
    AND (e.r->>'protegido')::boolean AND (e.r->>'permitido')::boolean;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_pc_auth(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_pc_auth(jsonb, text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.app_backup_overview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_today  date := public.app_backup_today();
  v_limit  integer;
  v_result jsonb;
BEGIN
  SELECT * INTO c FROM public.app_backup_caller(p_token);
  PERFORM public.app_backup_expire_stale();
  SELECT COALESCE(daily_limit, 1) INTO v_limit FROM public.backup_settings WHERE id;

  SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'name'), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'code',      upper(f.code),
      'name',      f.name,
      'ungetId',   f.unget_id::text,
      'ungetName', ug.name,
      'lastAt',    last_ok.finished_at,
      'lastBy',    last_ok.username,
      'today',     (SELECT count(*) FROM public.backup_requests r
                    WHERE r.code = upper(f.code) AND r.day = v_today
                      AND r.status IN ('REQUESTED', 'UPLOADING', 'READY', 'DOWNLOADED')),
      'limit',     COALESCE(v_limit, 1)
    ) AS fila
    FROM public.facilities f
    JOIN public.sync_send_keys k ON k.code = upper(f.code)
    LEFT JOIN public.ungets ug ON ug.id::text = f.unget_id::text
    LEFT JOIN LATERAL (
      SELECT r.finished_at, r.username FROM public.backup_requests r
      WHERE r.code = upper(f.code) AND r.status = 'DOWNLOADED'
      ORDER BY r.finished_at DESC NULLS LAST
      LIMIT 1
    ) last_ok ON true
    WHERE upper(f.code) ~ '^([0-9]{5}|[0-9A-Z]{6})$'
      AND public.app_backup_code_open(f.code)
      AND (c.is_admin OR public.app_place_in_scope(c.personnel_id, f.code, NULL, NULL, NULL, NULL))
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_overview(uuid) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT pilot_only FROM public.backup_settings WHERE id) AS solo_piloto,
       (SELECT count(*) FROM public.sync_send_keys) AS establecimientos_con_clave;


-- ============================================================================
--  REVERSIÓN (volver al piloto; no ejecutar salvo para deshacer)
-- ============================================================================
--  UPDATE public.backup_settings SET pilot_only = true, updated_at = now() WHERE id;
