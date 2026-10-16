-- ============================================================================
--  BACKUPS SISMED · Copia del día
-- ============================================================================
--
--  QUÉ CAMBIA
--
--  Desde el Toolkit 2.3.9, cada PC sube sola a la nube el primer backup del día (el de
--  la mañana) y el servicio guarda solo la última copia de cada establecimiento. Bajar
--  esa copia no le pide nada a la PC, así que:
--
--    - Se registra con el estado nuevo COPY_DOWNLOADED, que NO cuenta en el cupo diario
--      (decisión del 2026-10-16): «Pedir uno nuevo» sigue con su límite por usuario y
--      bajar la copia no lo gasta.
--    - app_backup_copy_downloaded registra esa descarga (con la sesión de quien baja y
--      revisando su jurisdicción).
--    - app_backup_overview cuenta también las copias en «Último descargado».
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere SUPABASE_BACKUPS_CUPO_POR_USUARIO.sql. Se puede ejecutar antes o después de
--    publicar la web; sin él la copia se descarga igual, pero no queda registrada.
--
--  REVERSIÓN: volver a ejecutar SUPABASE_BACKUPS_CUPO_POR_USUARIO.sql (la restricción
--  ampliada de estados se puede dejar: no cambia nada de lo anterior).
-- ============================================================================


-- Admite el estado nuevo. Se busca la restricción por lo que revisa, no por su nombre.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.backup_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.backup_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.backup_requests ADD CONSTRAINT backup_requests_status_check
  CHECK (status IN ('REQUESTED', 'UPLOADING', 'READY', 'DOWNLOADED', 'FAILED', 'EXPIRED', 'COPY_DOWNLOADED'));


-- La llama el servicio cuando alguien termina de bajar la copia del día.
CREATE OR REPLACE FUNCTION public.app_backup_copy_downloaded(
  p_token uuid, p_job uuid, p_code text,
  p_file_name text DEFAULT NULL, p_size bigint DEFAULT NULL, p_equipo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code     text := upper(trim(COALESCE(p_code, '')));
  v_username text;
BEGIN
  v_username := public.app_backup_assert_code(p_token, v_code);

  INSERT INTO public.backup_requests
    (id, code, username, day, status, equipo, file_name, size_bytes, requested_at, finished_at)
  VALUES
    (p_job, v_code, v_username, public.app_backup_today(), 'COPY_DOWNLOADED',
     left(COALESCE(p_equipo, ''), 40), left(p_file_name, 60), p_size, now(), now())
  ON CONFLICT (id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_copy_downloaded(uuid, uuid, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_copy_downloaded(uuid, uuid, text, text, bigint, text) TO anon, authenticated;


-- Igual que en SUPABASE_BACKUPS_CUPO_POR_USUARIO.sql; solo cambia «Último descargado»,
-- que ahora también cuenta las copias. «today» y «mine» (el cupo) no las cuentan.
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
      WHERE r.code = upper(f.code) AND r.status IN ('DOWNLOADED', 'COPY_DOWNLOADED')
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


SELECT 'TODO CORRECTO' AS resultado;
