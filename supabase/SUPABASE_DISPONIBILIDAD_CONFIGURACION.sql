-- ============================================================================
--  DISPONIBILIDAD - Configuración: fórmula, códigos fusionados y vitales
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    El módulo Disponibilidad calcula con una configuración que el administrador
--    cambia desde la propia pantalla (botón «Configuración»):
--      - formula:          qué situaciones cuentan como disponibles, límites de
--                          meses, corte a un decimal, niveles y cómo se juntan
--                          microred y UNGET.
--      - fused_codes:      listado de códigos fusionados de DIGEMID (DME).
--      - fused_codes_prev: el listado anterior, para poder volver a él.
--      - vital_products:   Listado Nacional de Productos Farmacéuticos Vitales
--                          (RM 1288-2018-MINSA) con sus códigos SISMED.
--
--  Nadie lee ni escribe la tabla directamente: leer exige una sesión válida
--  (cualquier usuario); guardar exige sesión de ADMIN. Al guardar un listado de
--  códigos fusionados, el que estaba pasa solo a «fused_codes_prev».
--
--  La aplicación funciona sin este script (usa la configuración de fábrica y los
--  listados que vienen con la web), así que se puede desplegar primero y
--  ejecutar esto después.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es
--    idempotente. Requiere `SUPABASE_SEGURIDAD_APLICAR_ESTO.sql` (sesiones).
--    Al final debe aparecer "TODO CORRECTO".
--
--  REVERSIÓN al final del archivo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.availability_config (
  key        text PRIMARY KEY CHECK (key IN ('formula', 'fused_codes', 'fused_codes_prev', 'vital_products')),
  value      jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.availability_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_config FROM anon, authenticated;


-- Leer: cualquier sesión válida. Devuelve { clave: { value, updatedBy, updatedAt } }.
CREATE OR REPLACE FUNCTION public.app_availability_config_get(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF public.app_session_user(p_token) IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  RETURN COALESCE(
    (SELECT jsonb_object_agg(key, jsonb_build_object('value', value, 'updatedBy', updated_by, 'updatedAt', updated_at))
       FROM public.availability_config),
    '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_config_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_config_get(uuid) TO anon, authenticated;


-- Guardar una clave: solo el administrador.
CREATE OR REPLACE FUNCTION public.app_availability_config_save(p_token uuid, p_key text, p_value jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin text;
BEGIN
  v_admin := public.app_require_admin(p_token);
  IF p_key NOT IN ('formula', 'fused_codes', 'vital_products') THEN
    RAISE EXCEPTION 'Clave de configuración desconocida: %', p_key;
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'La configuración debe ser un objeto.';
  END IF;

  -- El listado de códigos fusionados que se reemplaza queda como anterior.
  IF p_key = 'fused_codes' THEN
    INSERT INTO public.availability_config (key, value, updated_by, updated_at)
    SELECT 'fused_codes_prev', value, updated_by, updated_at
      FROM public.availability_config WHERE key = 'fused_codes'
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  END IF;

  INSERT INTO public.availability_config (key, value, updated_by, updated_at)
  VALUES (p_key, p_value, v_admin, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_config_save(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_config_save(uuid, text, jsonb) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.availability_config) AS claves_guardadas;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_availability_config_save(uuid, text, jsonb);
--  DROP FUNCTION IF EXISTS public.app_availability_config_get(uuid);
--  DROP TABLE IF EXISTS public.availability_config;
