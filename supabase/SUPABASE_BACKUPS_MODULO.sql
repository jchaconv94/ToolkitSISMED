-- ============================================================================
--  BACKUPS SISMED · ETAPA 4 - Módulo web «Backups SISMED»
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    - Permiso propio: entra al módulo (y pide backups) el administrador y todo rol
--      que tenga «Backups SISMED» en Configuración de Roles. Antes se usaba el permiso
--      de Claves de envío. La jurisdicción no cambia: cada uno ve sus establecimientos.
--    - La lista del módulo: establecimientos de su jurisdicción que pueden enviar
--      backup (clave de envío y, mientras dure, el piloto), con el último backup
--      descargado y cuántos van hoy.
--    - La actividad del día y, para el administrador, el resumen del mes por UNGET.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_BACKUPS_CONEXION.sql` y `SUPABASE_BACKUPS_REGLAS.sql`.
--
--    Después, en Administración → Configuración de Roles, marca «Backups SISMED» en el
--    rol de los informáticos que deban usarlo.
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- Quién llama: sesión vigente y permiso del módulo (el administrador siempre).
CREATE OR REPLACE FUNCTION public.app_backup_caller(p_token uuid)
RETURNS TABLE (username text, personnel_id text, is_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT u.username, u.personnel_id,
         upper(COALESCE(u.role, '')) = 'ADMIN' AS is_admin,
         COALESCE(rc.allowed_modules, '[]'::jsonb) ? 'ADMIN_BACKUPS' AS has_module
    INTO r
  FROM public.app_sessions s
  JOIN public.users u ON u.username = s.username
  LEFT JOIN public.roles_config rc ON rc.role = u.role
  WHERE s.token = p_token AND s.expires_at > now() AND u.is_active
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  IF NOT (r.is_admin OR r.has_module) THEN
    RAISE EXCEPTION 'Su rol no tiene acceso a Backups SISMED.';
  END IF;

  RETURN QUERY SELECT r.username::text, r.personnel_id::text, r.is_admin;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_caller(uuid) FROM PUBLIC, anon, authenticated;


-- ¿Puede quien llama pedir el backup de p_code? Devuelve su usuario.
CREATE OR REPLACE FUNCTION public.app_backup_assert_code(p_token uuid, p_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c      record;
  v_code text := upper(trim(COALESCE(p_code, '')));
BEGIN
  SELECT * INTO c FROM public.app_backup_caller(p_token);

  IF v_code !~ '^([0-9]{5}|[0-9A-Z]{6})$'
     OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE upper(f.code) = v_code) THEN
    RAISE EXCEPTION 'El establecimiento % no admite backups.', v_code;
  END IF;
  IF NOT c.is_admin
     AND NOT public.app_place_in_scope(c.personnel_id, v_code, NULL, NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Ese establecimiento no pertenece a su jurisdicción.';
  END IF;

  RETURN c.username;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_assert_code(uuid, text) FROM PUBLIC, anon, authenticated;


-- La usa el servicio de Cloudflare al conectarse la web. Ahora con el permiso del módulo.
CREATE OR REPLACE FUNCTION public.app_backup_web_auth(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_ungets jsonb;
BEGIN
  SELECT * INTO c FROM public.app_backup_caller(p_token);

  IF c.is_admin THEN
    v_ungets := '[]'::jsonb;
  ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT f.unget_id::text), '[]'::jsonb) INTO v_ungets
    FROM public.facilities f
    WHERE f.unget_id IS NOT NULL
      AND upper(f.code) ~ '^([0-9]{5}|[0-9A-Z]{6})$'
      AND public.app_place_in_scope(c.personnel_id, f.code, NULL, NULL, NULL, NULL);
  END IF;

  RETURN jsonb_build_object('username', c.username, 'isAdmin', c.is_admin, 'ungetIds', v_ungets);
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_web_auth(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_web_auth(uuid) TO anon, authenticated;


-- Igual que en la etapa 3, con el permiso del módulo.
CREATE OR REPLACE FUNCTION public.app_backup_request_start(p_token uuid, p_job uuid, p_code text, p_equipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code     text := upper(trim(COALESCE(p_code, '')));
  v_username text;
  v_limit    integer;
  v_used     integer;
  v_today    date := public.app_backup_today();
  v_last     record;
BEGIN
  v_username := public.app_backup_assert_code(p_token, v_code);

  PERFORM pg_advisory_xact_lock(hashtext('backup:' || v_code));

  PERFORM public.app_backup_expire_stale();
  DELETE FROM public.backup_requests WHERE requested_at < now() - interval '1 year';

  SELECT daily_limit INTO v_limit FROM public.backup_settings WHERE id;
  v_limit := COALESCE(v_limit, 1);

  SELECT count(*) INTO v_used
  FROM public.backup_requests
  WHERE code = v_code AND day = v_today
    AND status IN ('REQUESTED', 'UPLOADING', 'READY', 'DOWNLOADED');

  IF v_used >= v_limit THEN
    SELECT r.username, r.status, COALESCE(r.finished_at, r.requested_at) AS at INTO v_last
    FROM public.backup_requests r
    WHERE r.code = v_code AND r.day = v_today
      AND r.status IN ('REQUESTED', 'UPLOADING', 'READY', 'DOWNLOADED')
    ORDER BY r.requested_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', false, 'limit', v_limit, 'used', v_used,
      'last', jsonb_build_object('username', v_last.username, 'status', v_last.status, 'at', v_last.at));
  END IF;

  INSERT INTO public.backup_requests (id, code, username, day, status, equipo)
  VALUES (p_job, v_code, v_username, v_today, 'REQUESTED', left(COALESCE(p_equipo, ''), 40));

  RETURN jsonb_build_object('ok', true, 'limit', v_limit, 'used', v_used + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_request_start(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_request_start(uuid, uuid, text, text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.app_backup_request_update(
  p_token uuid, p_job uuid, p_status text,
  p_file_name text DEFAULT NULL, p_size bigint DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_status text := upper(COALESCE(p_status, ''));
BEGIN
  SELECT * INTO c FROM public.app_backup_caller(p_token);

  IF v_status NOT IN ('UPLOADING', 'READY', 'DOWNLOADED', 'FAILED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Estado de backup no válido: %', p_status;
  END IF;

  UPDATE public.backup_requests
     SET status      = v_status,
         file_name   = COALESCE(left(p_file_name, 60), file_name),
         size_bytes  = COALESCE(p_size, size_bytes),
         reason      = COALESCE(left(p_reason, 200), reason),
         finished_at = CASE WHEN v_status IN ('DOWNLOADED', 'FAILED', 'EXPIRED') THEN now() ELSE finished_at END
   WHERE id = p_job
     AND username = c.username
     AND status IN ('REQUESTED', 'UPLOADING', 'READY');
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_request_update(uuid, uuid, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_request_update(uuid, uuid, text, text, bigint, text) TO anon, authenticated;


-- La lista del módulo: establecimientos de su jurisdicción que pueden enviar backup.
-- [{"code","name","ungetId","ungetName","lastAt","lastBy","today","limit"}]
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
    JOIN public.backup_pilot_codes p ON p.code = upper(f.code)
    LEFT JOIN public.ungets ug ON ug.id::text = f.unget_id::text
    LEFT JOIN LATERAL (
      SELECT r.finished_at, r.username FROM public.backup_requests r
      WHERE r.code = upper(f.code) AND r.status = 'DOWNLOADED'
      ORDER BY r.finished_at DESC NULLS LAST
      LIMIT 1
    ) last_ok ON true
    WHERE upper(f.code) ~ '^([0-9]{5}|[0-9A-Z]{6})$'
      AND (c.is_admin OR public.app_place_in_scope(c.personnel_id, f.code, NULL, NULL, NULL, NULL))
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_overview(uuid) TO anon, authenticated;


-- Pedidos de hoy en su jurisdicción, el más reciente primero (el panel «Actividad»).
CREATE OR REPLACE FUNCTION public.app_backup_activity(p_token uuid)
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
  SELECT * INTO c FROM public.app_backup_caller(p_token);

  SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'at' DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', r.id, 'code', r.code, 'name', f.name, 'username', r.username, 'status', r.status,
      'fileName', r.file_name, 'size', r.size_bytes, 'reason', r.reason, 'equipo', r.equipo,
      'at', COALESCE(r.finished_at, r.requested_at)
    ) AS fila
    FROM public.backup_requests r
    LEFT JOIN public.facilities f ON upper(f.code) = r.code
    WHERE r.day = public.app_backup_today()
      AND (c.is_admin OR public.app_place_in_scope(c.personnel_id, r.code, NULL, NULL, NULL, NULL))
    ORDER BY r.requested_at DESC
    LIMIT 200
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_activity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_activity(uuid) TO anon, authenticated;


-- Pestaña «Consumo» (solo el administrador): backups del mes en curso por UNGET.
CREATE OR REPLACE FUNCTION public.app_backup_month_by_unget(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_from   date := date_trunc('month', public.app_backup_today())::date;
  v_result jsonb;
BEGIN
  PERFORM public.app_require_admin(p_token);

  SELECT COALESCE(jsonb_agg(fila ORDER BY (fila->>'downloaded')::int DESC, fila->>'unget'), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'ungetId',    ug.id::text,
      'unget',      ug.name,
      'downloaded', count(r.id) FILTER (WHERE r.status = 'DOWNLOADED'),
      'failed',     count(r.id) FILTER (WHERE r.status = 'FAILED'),
      'bytes',      COALESCE(sum(r.size_bytes) FILTER (WHERE r.status = 'DOWNLOADED'), 0),
      'lastAt',     max(r.finished_at) FILTER (WHERE r.status = 'DOWNLOADED')
    ) AS fila
    FROM public.ungets ug
    LEFT JOIN public.facilities f ON f.unget_id::text = ug.id::text
    LEFT JOIN public.backup_requests r ON r.code = upper(f.code) AND r.day >= v_from
    GROUP BY ug.id, ug.name
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_month_by_unget(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_month_by_unget(uuid) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.backup_pilot_codes) AS establecimientos_en_piloto;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  Vuelve a ejecutar SUPABASE_BACKUPS_CONEXION.sql y SUPABASE_BACKUPS_REGLAS.sql para
--  restaurar el permiso de Claves de envío, y luego:
--  DROP FUNCTION IF EXISTS public.app_backup_month_by_unget(uuid);
--  DROP FUNCTION IF EXISTS public.app_backup_activity(uuid);
--  DROP FUNCTION IF EXISTS public.app_backup_overview(uuid);
--  DROP FUNCTION IF EXISTS public.app_backup_assert_code(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_backup_caller(uuid);
