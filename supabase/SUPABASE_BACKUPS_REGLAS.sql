-- ============================================================================
--  BACKUPS SISMED · ETAPA 3 - Reglas: descargas por día y auditoría
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    - Cada establecimiento admite un número de backups por día (hora de Perú),
--      para todos los usuarios, también el administrador. El número lo fija el
--      administrador en Parámetros del Sistema (empieza en 1).
--    - Un pedido que falló o venció sin descargarse NO cuenta.
--    - Queda registrado quién pidió, cuándo, de qué establecimiento, qué archivo,
--      cuánto pesó y cómo terminó. Los registros de más de un año se borran solos.
--
--  El servicio «sismed-conexion» de Cloudflare llama a estas funciones con la
--  sesión de quien pidió el backup. Nadie lee ni escribe las tablas directamente.
--
--  Por qué el límite no vive en `system_config`: esa tabla se lee antes de iniciar
--  sesión y hoy la puede escribir cualquiera con la clave pública. Un límite ahí
--  lo podría cambiar cualquiera desde internet.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_BACKUPS_CONEXION.sql` (y lo que ese pide).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- Ajustes del servicio de backups. Una sola fila.
CREATE TABLE IF NOT EXISTS public.backup_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_limit integer NOT NULL DEFAULT 1 CHECK (daily_limit BETWEEN 1 AND 20),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.backup_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.backup_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_settings FROM anon, authenticated;


-- Un pedido de backup. El id es el del pedido en el servicio de Cloudflare.
CREATE TABLE IF NOT EXISTS public.backup_requests (
  id           uuid PRIMARY KEY,
  code         text NOT NULL,
  username     text NOT NULL,
  day          date NOT NULL,
  status       text NOT NULL CHECK (status IN ('REQUESTED', 'UPLOADING', 'READY', 'DOWNLOADED', 'FAILED', 'EXPIRED')),
  equipo       text,
  file_name    text,
  size_bytes   bigint,
  reason       text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS backup_requests_code_day ON public.backup_requests (code, day);
CREATE INDEX IF NOT EXISTS backup_requests_requested_at ON public.backup_requests (requested_at);

ALTER TABLE public.backup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_requests FROM anon, authenticated;


-- Día de operación: calendario de Perú.
CREATE OR REPLACE FUNCTION public.app_backup_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (now() AT TIME ZONE 'America/Lima')::date;
$$;

REVOKE ALL ON FUNCTION public.app_backup_today() FROM PUBLIC, anon, authenticated;


-- Un pedido que el servicio no cerró (se cayó, la web se fue) vence a la hora,
-- igual que en Cloudflare. Así nunca bloquea el día.
CREATE OR REPLACE FUNCTION public.app_backup_expire_stale()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.backup_requests
     SET status = 'EXPIRED', finished_at = now(), reason = COALESCE(reason, 'Venció sin descargarse')
   WHERE status IN ('REQUESTED', 'UPLOADING', 'READY')
     AND requested_at < now() - interval '1 hour';
$$;

REVOKE ALL ON FUNCTION public.app_backup_expire_stale() FROM PUBLIC, anon, authenticated;


-- La llama el servicio ANTES de avisar a la PC. Reserva el pedido si queda cupo.
-- Devuelve {"ok": true, "limit", "used"} o
--          {"ok": false, "limit", "used", "last": {"username", "status", "at"}}.
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
  -- Sesión, permiso de Claves de envío y jurisdicción sobre el establecimiento.
  v_username := public.app_send_keys_assert_code(p_token, v_code);

  -- Dos pedidos simultáneos del mismo establecimiento se atienden de a uno.
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


-- La llama el servicio a medida que avanza el pedido. Solo quien lo pidió lo
-- actualiza, y un pedido terminado ya no cambia.
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
  SELECT * INTO c FROM public.app_send_keys_caller(p_token);

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


-- Parámetros del Sistema: leer y guardar el límite. Solo el administrador.
CREATE OR REPLACE FUNCTION public.app_backup_settings_get(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  s record;
BEGIN
  PERFORM public.app_require_admin(p_token);
  SELECT * INTO s FROM public.backup_settings WHERE id;
  RETURN jsonb_build_object('dailyLimit', COALESCE(s.daily_limit, 1), 'updatedBy', s.updated_by, 'updatedAt', s.updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_settings_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_settings_get(uuid) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.app_backup_settings_save(p_token uuid, p_daily_limit integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin text;
BEGIN
  v_admin := public.app_require_admin(p_token);
  IF p_daily_limit IS NULL OR p_daily_limit < 1 OR p_daily_limit > 20 THEN
    RAISE EXCEPTION 'Las descargas por día deben estar entre 1 y 20.';
  END IF;
  INSERT INTO public.backup_settings (id, daily_limit, updated_by, updated_at)
  VALUES (true, p_daily_limit, v_admin, now())
  ON CONFLICT (id) DO UPDATE
    SET daily_limit = EXCLUDED.daily_limit, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_settings_save(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_settings_save(uuid, integer) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT daily_limit FROM public.backup_settings WHERE id) AS descargas_por_dia;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_backup_settings_save(uuid, integer);
--  DROP FUNCTION IF EXISTS public.app_backup_settings_get(uuid);
--  DROP FUNCTION IF EXISTS public.app_backup_request_update(uuid, uuid, text, text, bigint, text);
--  DROP FUNCTION IF EXISTS public.app_backup_request_start(uuid, uuid, text, text);
--  DROP FUNCTION IF EXISTS public.app_backup_expire_stale();
--  DROP FUNCTION IF EXISTS public.app_backup_today();
--  DROP TABLE IF EXISTS public.backup_requests;
--  DROP TABLE IF EXISTS public.backup_settings;
