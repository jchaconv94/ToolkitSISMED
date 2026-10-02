-- ============================================================================
--  BACKUPS SISMED · Cupo diario por usuario
-- ============================================================================
--
--  QUÉ CAMBIA
--
--  Hasta ahora el cupo era por establecimiento: si el informático de la UNGET descargaba
--  hoy el backup de una IPRESS, el usuario de DIRESA ya no podía descargarlo ese día.
--  Desde este script el cupo es por USUARIO y establecimiento: cada usuario puede
--  descargar el backup de cada establecimiento las veces que diga Parámetros del Sistema
--  (por omisión, 1 al día), sin importar lo que hayan descargado los demás.
--
--    - app_backup_request_start cuenta solo los pedidos de quien pide.
--    - app_backup_overview devuelve además «mine» (lo de hoy de quien consulta), que es
--      lo que la web usa para el aviso «Cupo del día usado». «today» sigue siendo el
--      total del establecimiento.
--    - Si dos usuarios piden a la vez el mismo establecimiento, la PC atiende uno y el
--      otro recibe «Esta PC ya está enviando otro backup»; ese pedido fallido no cuenta.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere SUPABASE_BACKUPS_MODULO.sql y SUPABASE_BACKUPS_ABRIR_REGION.sql.
--    Se puede ejecutar antes o después de publicar la web.
--
--  REVERSIÓN: volver a ejecutar SUPABASE_BACKUPS_MODULO.sql y luego
--  SUPABASE_BACKUPS_ABRIR_REGION.sql.
-- ============================================================================


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

  PERFORM pg_advisory_xact_lock(hashtext('backup:' || v_code || ':' || v_username));

  PERFORM public.app_backup_expire_stale();
  DELETE FROM public.backup_requests WHERE requested_at < now() - interval '1 year';

  SELECT daily_limit INTO v_limit FROM public.backup_settings WHERE id;
  v_limit := COALESCE(v_limit, 1);

  SELECT count(*) INTO v_used
  FROM public.backup_requests
  WHERE code = v_code AND day = v_today AND username = v_username
    AND status IN ('REQUESTED', 'UPLOADING', 'READY', 'DOWNLOADED');

  IF v_used >= v_limit THEN
    SELECT r.username, r.status, COALESCE(r.finished_at, r.requested_at) AS at INTO v_last
    FROM public.backup_requests r
    WHERE r.code = v_code AND r.day = v_today AND r.username = v_username
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
      'mine',      (SELECT count(*) FROM public.backup_requests r
                    WHERE r.code = upper(f.code) AND r.day = v_today AND r.username = c.username
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
       (SELECT daily_limit FROM public.backup_settings WHERE id) AS descargas_por_usuario_y_dia;
