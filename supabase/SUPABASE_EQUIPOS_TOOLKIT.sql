-- ============================================================================
--  EQUIPOS DEL TOOLKIT - Qué versión del Toolkit de escritorio tiene cada PC
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  No había forma de saber qué establecimientos tienen actualizado el Toolkit SISMED
--  de escritorio. Desde la versión 2.1.10, antes de cada envío el Toolkit consulta la
--  clave de envío (`app_send_key_check`). Este script aprovecha esa misma consulta —sin
--  agregar ninguna— para anotar qué PC envía cada establecimiento y con qué versión.
--
--  Lo muestra la pestaña «Equipos» del módulo Claves de envío, con el mismo permiso y la
--  misma jurisdicción.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_CLAVES_DE_ENVIO.sql` (ya aplicado).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- Una fila por PC y establecimiento. Nadie la lee ni escribe directamente.
CREATE TABLE IF NOT EXISTS public.toolkit_devices (
  device_id   text NOT NULL,
  code        text NOT NULL,
  device_name text,
  version     text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, code)
);

CREATE INDEX IF NOT EXISTS toolkit_devices_code_idx ON public.toolkit_devices (code, last_seen DESC);

ALTER TABLE public.toolkit_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.toolkit_devices FROM anon, authenticated;


-- Anota el reporte de una PC. Solo para establecimientos registrados, para que nadie
-- llene la tabla con códigos inventados. Olvida lo que no reporta hace más de 90 días.
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
DECLARE
  v_code    text := upper(trim(COALESCE(p_code, '')));
  v_device  text := NULLIF(left(trim(COALESCE(p_device_id, '')), 120), '');
  v_version text := NULLIF(left(trim(COALESCE(p_version, '')), 20), '');
BEGIN
  IF v_device IS NULL OR v_code = '' THEN RETURN; END IF;
  IF v_version IS NOT NULL AND v_version !~ '^[0-9]+(\.[0-9]+){1,3}$' THEN v_version := NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities f WHERE upper(f.code) = v_code) THEN RETURN; END IF;

  INSERT INTO public.toolkit_devices (device_id, code, device_name, version, first_seen, last_seen)
  VALUES (v_device, v_code, NULLIF(left(trim(COALESCE(p_device_name, '')), 120), ''), v_version, now(), now())
  ON CONFLICT (device_id, code) DO UPDATE SET
    device_name = COALESCE(EXCLUDED.device_name, public.toolkit_devices.device_name),
    version = COALESCE(EXCLUDED.version, public.toolkit_devices.version),
    last_seen = now();

  DELETE FROM public.toolkit_devices WHERE last_seen < now() - interval '90 days';
END;
$$;

REVOKE ALL ON FUNCTION public.app_toolkit_device_seen(text, text, text, text) FROM PUBLIC, anon, authenticated;


-- La consulta de la clave de envío con la versión (Toolkit 2.2.0 en adelante). Anota el
-- equipo y responde exactamente lo mismo que la de cinco parámetros.
CREATE OR REPLACE FUNCTION public.app_send_key_check(
  p_code        text,
  p_key         text,
  p_device_id   text,
  p_device_name text,
  p_rows        integer,
  p_version     text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.app_toolkit_device_seen(p_code, p_device_id, p_device_name, p_version);
  RETURN public.app_send_key_check_core(p_code, p_key, p_device_id, p_device_name, p_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_check(text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_check(text, text, text, text, integer, text) TO anon, authenticated;


-- Lógica de la clave de envío, igual a la de SUPABASE_CLAVES_DE_ENVIO.sql. La usan las
-- dos formas de la consulta; no se llama desde fuera.
CREATE OR REPLACE FUNCTION public.app_send_key_check_core(
  p_code        text,
  p_key         text,
  p_device_id   text,
  p_device_name text,
  p_rows        integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code   text := upper(trim(COALESCE(p_code, '')));
  v_device text := NULLIF(left(trim(COALESCE(p_device_id, '')), 120), '');
  v_name   text := NULLIF(left(trim(COALESCE(p_device_name, '')), 120), '');
  k        record;
  v_result text;
BEGIN
  SELECT * INTO k FROM public.sync_send_keys WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('permitido', true, 'protegido', false);
  END IF;

  IF NULLIF(trim(COALESCE(p_key, '')), '') IS NULL THEN
    v_result := 'SIN_CLAVE';
  ELSIF public.app_send_key_hash(p_key) <> k.key_hash THEN
    v_result := 'CLAVE_INCORRECTA';
  ELSIF v_device IS NULL THEN
    v_result := 'OTRO_EQUIPO';
  ELSIF k.device_id IS NULL THEN
    UPDATE public.sync_send_keys
       SET device_id = v_device, device_name = v_name, bound_at = now()
     WHERE code = v_code;
    v_result := 'ACEPTADO';
  ELSIF k.device_id = v_device THEN
    v_result := 'ACEPTADO';
  ELSE
    v_result := 'OTRO_EQUIPO';
  END IF;

  IF v_result = 'ACEPTADO' THEN
    UPDATE public.sync_send_keys
       SET last_ok_at = now(), last_ok_rows = p_rows,
           device_name = COALESCE(v_name, device_name)
     WHERE code = v_code;
  END IF;

  INSERT INTO public.sync_send_attempts (code, device_id, device_name, row_count, result)
  VALUES (v_code, v_device, v_name, p_rows, v_result);

  DELETE FROM public.sync_send_attempts
   WHERE code = v_code
     AND id NOT IN (SELECT id FROM public.sync_send_attempts
                     WHERE code = v_code ORDER BY created_at DESC, id DESC LIMIT 100);

  RETURN jsonb_build_object(
    'permitido', v_result = 'ACEPTADO',
    'protegido', true,
    'motivo', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_check_core(text, text, text, text, integer) FROM PUBLIC, anon, authenticated;


-- La de cinco parámetros solo la llama el Toolkit 2.1.10, la única versión que consulta
-- la clave sin mandar la suya: se anota el equipo con esa versión.
CREATE OR REPLACE FUNCTION public.app_send_key_check(
  p_code        text,
  p_key         text,
  p_device_id   text,
  p_device_name text,
  p_rows        integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.app_toolkit_device_seen(p_code, p_device_id, p_device_name, '2.1.10');
  RETURN public.app_send_key_check_core(p_code, p_key, p_device_id, p_device_name, p_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_check(text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_check(text, text, text, text, integer) TO anon, authenticated;


-- Para la web: establecimientos de la jurisdicción con las PC que los envían.
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
       (SELECT count(*) FROM public.toolkit_devices) AS equipos_registrados;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer). Deja la consulta de cinco parámetros
--  como estaba volviendo a ejecutar SUPABASE_CLAVES_DE_ENVIO.sql.
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_toolkit_devices_overview(uuid);
--  DROP FUNCTION IF EXISTS public.app_send_key_check(text, text, text, text, integer, text);
--  DROP FUNCTION IF EXISTS public.app_toolkit_device_seen(text, text, text, text);
--  DROP FUNCTION IF EXISTS public.app_send_key_check_core(text, text, text, text, integer);
--  DROP TABLE IF EXISTS public.toolkit_devices;
