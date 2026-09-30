-- ============================================================================
--  EQUIPOS DEL TOOLKIT - Versión del SISMED instalada en cada PC
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  La pestaña «Equipos» ya muestra qué versión del Toolkit tiene cada PC. Faltaba la del
--  SISMED. El SISMED la guarda en DATOS\MCONFIG.DBF, fila SIS / AB («FECHA ULTIMA VERSION
--  SISMED»), con un valor como `V2.5.3 vf 12/01/2026`.
--
--  Desde la versión del Toolkit posterior a la 2.2.0, la misma consulta de la clave de
--  envío manda también ese valor (`p_sismed`). El Toolkit lee solo esa fila de MCONFIG.
--
--  Aquí se guarda tal cual llega y, además, separado en versión (2.5.3) y fecha
--  (2026-01-12). La web toma como vigente la versión más alta que reporte alguna PC.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_EQUIPOS_TOOLKIT.sql` (ya aplicado).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


ALTER TABLE public.toolkit_devices ADD COLUMN IF NOT EXISTS sismed_raw     text;
ALTER TABLE public.toolkit_devices ADD COLUMN IF NOT EXISTS sismed_version text;
ALTER TABLE public.toolkit_devices ADD COLUMN IF NOT EXISTS sismed_date    date;


-- Anota el reporte de una PC, ahora con el valor de la versión del SISMED. Un valor vacío
-- no borra el que ya había: un Toolkit anterior o un MCONFIG ilegible no deja la PC sin dato.
CREATE OR REPLACE FUNCTION public.app_toolkit_device_seen(
  p_code        text,
  p_device_id   text,
  p_device_name text,
  p_version     text,
  p_sismed      text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code    text := upper(trim(COALESCE(p_code, '')));
  v_device  text := NULLIF(left(trim(COALESCE(p_device_id, '')), 120), '');
  v_version text := NULLIF(left(trim(COALESCE(p_version, '')), 20), '');
  v_raw     text := NULLIF(left(trim(regexp_replace(COALESCE(p_sismed, ''), '[[:cntrl:]]', '', 'g')), 60), '');
  v_sversion text;
  v_sdate   date;
  v_dtext   text;
BEGIN
  IF v_device IS NULL OR v_code = '' THEN RETURN; END IF;
  IF v_version IS NOT NULL AND v_version !~ '^[0-9]+(\.[0-9]+){1,3}$' THEN v_version := NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities f WHERE upper(f.code) = v_code) THEN RETURN; END IF;

  IF v_raw IS NOT NULL THEN
    -- `V2.5.3 vf 12/01/2026` → 2.5.3 y 12 de enero de 2026 (día/mes/año).
    v_sversion := substring(v_raw FROM '([0-9]+(?:\.[0-9]+){1,3})');
    v_dtext := substring(v_raw FROM '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})');
    IF v_dtext IS NOT NULL THEN
      BEGIN
        v_sdate := to_date(v_dtext, 'DD/MM/YYYY');
        -- to_date acepta 31/02; si la fecha no es real se descarta.
        IF to_char(v_sdate, 'FMDD/FMMM/YYYY') <> regexp_replace(v_dtext, '(^|/)0', '\1', 'g') THEN
          v_sdate := NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_sdate := NULL;
      END;
    END IF;
  END IF;

  INSERT INTO public.toolkit_devices
    (device_id, code, device_name, version, sismed_raw, sismed_version, sismed_date, first_seen, last_seen)
  VALUES
    (v_device, v_code, NULLIF(left(trim(COALESCE(p_device_name, '')), 120), ''), v_version,
     v_raw, v_sversion, v_sdate, now(), now())
  ON CONFLICT (device_id, code) DO UPDATE SET
    device_name = COALESCE(EXCLUDED.device_name, public.toolkit_devices.device_name),
    version = COALESCE(EXCLUDED.version, public.toolkit_devices.version),
    sismed_raw = COALESCE(EXCLUDED.sismed_raw, public.toolkit_devices.sismed_raw),
    sismed_version = CASE WHEN EXCLUDED.sismed_raw IS NULL THEN public.toolkit_devices.sismed_version ELSE EXCLUDED.sismed_version END,
    sismed_date = CASE WHEN EXCLUDED.sismed_raw IS NULL THEN public.toolkit_devices.sismed_date ELSE EXCLUDED.sismed_date END,
    last_seen = now();

  DELETE FROM public.toolkit_devices WHERE last_seen < now() - interval '90 days';
END;
$$;

REVOKE ALL ON FUNCTION public.app_toolkit_device_seen(text, text, text, text, text) FROM PUBLIC, anon, authenticated;


-- La forma de cuatro parámetros (la usan las consultas de cinco y seis parámetros) queda
-- como atajo de la nueva, para que la regla viva en un solo sitio.
CREATE OR REPLACE FUNCTION public.app_toolkit_device_seen(
  p_code        text,
  p_device_id   text,
  p_device_name text,
  p_version     text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.app_toolkit_device_seen(p_code, p_device_id, p_device_name, p_version, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.app_toolkit_device_seen(text, text, text, text) FROM PUBLIC, anon, authenticated;


-- La consulta de la clave de envío con la versión del Toolkit y la del SISMED. Responde
-- exactamente lo mismo que las de cinco y seis parámetros.
CREATE OR REPLACE FUNCTION public.app_send_key_check(
  p_code        text,
  p_key         text,
  p_device_id   text,
  p_device_name text,
  p_rows        integer,
  p_version     text,
  p_sismed      text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.app_toolkit_device_seen(p_code, p_device_id, p_device_name, p_version, p_sismed);
  RETURN public.app_send_key_check_core(p_code, p_key, p_device_id, p_device_name, p_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_check(text, text, text, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_check(text, text, text, text, integer, text, text) TO anon, authenticated;


-- Para la web: igual que antes, con la versión del SISMED de cada PC.
CREATE OR REPLACE FUNCTION public.app_toolkit_devices_overview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_result jsonb;
BEGIN
  SELECT * INTO c FROM public.app_send_keys_caller(p_token);

  SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'name'), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'code',      upper(f.code),
      'name',      f.name,
      'ungetId',   f.unget_id::text,
      'ungetName', ug.name,
      'devices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'deviceName', d.device_name, 'version', d.version,
          'sismedRaw', d.sismed_raw, 'sismedVersion', d.sismed_version, 'sismedDate', d.sismed_date,
          'firstSeen', d.first_seen, 'lastSeen', d.last_seen) ORDER BY d.last_seen DESC)
        FROM public.toolkit_devices d
        WHERE d.code = upper(f.code)
      ), '[]'::jsonb)
    ) AS fila
    FROM public.facilities f
    LEFT JOIN public.ungets ug ON ug.id::text = f.unget_id::text
    WHERE upper(f.code) ~ '^([0-9]{5}|[0-9A-Z]{6})$'
      AND (c.is_admin OR public.app_place_in_scope(c.personnel_id, f.code, NULL, NULL, NULL, NULL))
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_toolkit_devices_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_toolkit_devices_overview(uuid) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.toolkit_devices WHERE sismed_raw IS NOT NULL) AS equipos_con_sismed;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer). Después vuelve a ejecutar
--  SUPABASE_EQUIPOS_TOOLKIT.sql para dejar la forma de cuatro parámetros como estaba.
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_send_key_check(text, text, text, text, integer, text, text);
--  DROP FUNCTION IF EXISTS public.app_toolkit_device_seen(text, text, text, text, text);
--  ALTER TABLE public.toolkit_devices DROP COLUMN IF EXISTS sismed_date;
--  ALTER TABLE public.toolkit_devices DROP COLUMN IF EXISTS sismed_version;
--  ALTER TABLE public.toolkit_devices DROP COLUMN IF EXISTS sismed_raw;
