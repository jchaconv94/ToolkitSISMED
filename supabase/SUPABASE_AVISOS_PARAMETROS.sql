-- ============================================================================
--  AVISOS (campanita) - Parámetros: días sin actualizar y lotes por vencer
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    La campanita de avisos usa dos umbrales que el administrador fija en
--    Parámetros del Sistema:
--      - stale_days:  avisar cuando el stock lleva más de N días sin
--                     actualizarse (de 1 a 30, empieza en 3).
--      - expiry_days: avisar de los lotes que vencen dentro de N días
--                     (de 7 a 365, empieza en 90).
--
--  Por qué no viven en `system_config`: esa tabla se lee antes de iniciar sesión
--  y hoy la puede escribir cualquiera con la clave pública.
--
--  Nadie lee ni escribe la tabla directamente: lo hacen dos funciones. Leer
--  exige una sesión válida (cualquier usuario); guardar exige sesión de ADMIN.
--
--  La aplicación funciona sin este script (usa 3 y 90 días), así que se puede
--  desplegar primero y ejecutar esto después.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es
--    idempotente. Requiere `SUPABASE_SEGURIDAD_APLICAR_ESTO.sql` (sesiones).
--    Al final debe aparecer "TODO CORRECTO".
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- Una sola fila.
CREATE TABLE IF NOT EXISTS public.notice_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  stale_days  integer NOT NULL DEFAULT 3  CHECK (stale_days BETWEEN 1 AND 30),
  expiry_days integer NOT NULL DEFAULT 90 CHECK (expiry_days BETWEEN 7 AND 365),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.notice_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.notice_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notice_settings FROM anon, authenticated;


-- Leer: cualquier sesión válida.
CREATE OR REPLACE FUNCTION public.app_notice_settings_get(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  s record;
BEGIN
  IF public.app_session_user(p_token) IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  SELECT * INTO s FROM public.notice_settings WHERE id;
  RETURN jsonb_build_object(
    'staleDays',  COALESCE(s.stale_days, 3),
    'expiryDays', COALESCE(s.expiry_days, 90),
    'updatedBy',  s.updated_by,
    'updatedAt',  s.updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.app_notice_settings_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_notice_settings_get(uuid) TO anon, authenticated;


-- Guardar: solo el administrador.
CREATE OR REPLACE FUNCTION public.app_notice_settings_save(p_token uuid, p_stale_days integer, p_expiry_days integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin text;
BEGIN
  v_admin := public.app_require_admin(p_token);
  IF p_stale_days IS NULL OR p_stale_days < 1 OR p_stale_days > 30 THEN
    RAISE EXCEPTION 'Los días sin actualizar deben estar entre 1 y 30.';
  END IF;
  IF p_expiry_days IS NULL OR p_expiry_days < 7 OR p_expiry_days > 365 THEN
    RAISE EXCEPTION 'Los días de lotes por vencer deben estar entre 7 y 365.';
  END IF;
  INSERT INTO public.notice_settings (id, stale_days, expiry_days, updated_by, updated_at)
  VALUES (true, p_stale_days, p_expiry_days, v_admin, now())
  ON CONFLICT (id) DO UPDATE
    SET stale_days  = EXCLUDED.stale_days,
        expiry_days = EXCLUDED.expiry_days,
        updated_by  = EXCLUDED.updated_by,
        updated_at  = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.app_notice_settings_save(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_notice_settings_save(uuid, integer, integer) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT stale_days  FROM public.notice_settings WHERE id) AS dias_sin_actualizar,
       (SELECT expiry_days FROM public.notice_settings WHERE id) AS dias_por_vencer;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_notice_settings_save(uuid, integer, integer);
--  DROP FUNCTION IF EXISTS public.app_notice_settings_get(uuid);
--  DROP TABLE IF EXISTS public.notice_settings;
