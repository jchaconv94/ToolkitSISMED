-- ============================================================================
--  DISPONIBILIDAD - Establecimientos del análisis
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    En el módulo Disponibilidad, «Establecimientos del análisis» deja
--    establecimientos fuera del cálculo (no cuentan en la microred, la UNGET ni
--    los demás reportes; se ven aparte). Los centros de salud mental comunitario
--    van fuera por omisión: el tablero nacional de DIGEMID no los cuenta.
--
--    La tabla guarda solo las decisiones que difieren de lo de omisión: un
--    establecimiento sin fila sigue la regla de omisión (los C.S.M.C. fuera, los
--    demás dentro).
--
--  REGLAS (acordadas con el usuario el 2026-10-10: «igualito como se manejan los
--  establecimientos»)
--
--    Ver       Quien tiene el módulo Disponibilidad, solo su jurisdicción:
--              ADMIN y DIRESA todo; OGESS sus UNGET; UNGET sus establecimientos;
--              microred los suyos; el responsable de un establecimiento, el suyo.
--              Todos ven la misma lista: no es personal.
--    Cambiar   ADMIN, DIRESA y UNGET (informático y coordinador), con la acción
--              «Elegir los establecimientos del análisis» encendida en su rol, y
--              solo establecimientos de su jurisdicción. Ni OGESS, ni microred, ni
--              el responsable de un establecimiento.
--
--  Nadie lee ni escribe la tabla directamente (RLS sin políticas): todo pasa por
--  las dos funciones de abajo, que exigen una sesión válida.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es
--    idempotente. Requiere `SUPABASE_DISPONIBILIDAD_HISTORIAL.sql` (usa sus
--    funciones de jurisdicción, `app_history_caller` y `app_history_scope_codes`).
--    Puede ejecutarse antes o después de publicar la web: sin él, la web solo deja
--    fuera a los centros de salud mental y no deja cambiar la lista. Al final debe
--    aparecer "TODO CORRECTO".
--
--  REVERSIÓN al final del archivo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.availability_sites (
  facility_code text        PRIMARY KEY CHECK (facility_code ~ '^[0-9]{5}$'),
  in_analysis   boolean     NOT NULL,
  updated_by    text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.availability_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_sites FROM anon, authenticated;


-- ----------------------------------------------------------------------------
--  ¿Puede cambiar la lista? ADMIN, o nivel GLOBAL/UNGET con el módulo y sin la
--  acción «AVAILABILITY:sites» apagada en su rol.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_availability_sites_can_edit(p_username text, p_level text, p_can_view boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT upper(COALESCE(u.role, '')) = 'ADMIN'
        OR (p_can_view AND p_level IN ('GLOBAL', 'UNGET')
            AND NOT COALESCE(
              CASE WHEN jsonb_typeof(to_jsonb(rc) -> 'denied_actions') = 'array' THEN to_jsonb(rc) -> 'denied_actions' END,
              '[]'::jsonb) ? 'AVAILABILITY:sites')
    FROM public.users u
    LEFT JOIN public.roles_config rc ON rc.role = u.role
    WHERE u.username = p_username
  ), false);
$$;

REVOKE ALL ON FUNCTION public.app_availability_sites_can_edit(text, text, boolean) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
--  Leer: las decisiones de la jurisdicción de quien llama.
--    items:   [código, en el análisis, quién (nombre), cuándo]
--    canEdit: si puede cambiarlas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_availability_sites_list(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public.app_history_caller(p_token);
  IF NOT c.can_view THEN
    RAISE EXCEPTION 'Su rol no tiene el módulo Disponibilidad.';
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               s.facility_code,
               s.in_analysis,
               COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), s.updated_by),
               s.updated_at) ORDER BY s.facility_code)
      FROM public.availability_sites s
      LEFT JOIN public.users u ON u.username = s.updated_by
      LEFT JOIN public.personnel p ON p.id::text = u.personnel_id::text
      WHERE c.level = 'GLOBAL' OR s.facility_code IN (SELECT x.code FROM public.app_history_scope_codes(c.level, c.personnel_id) x)
    ), '[]'::jsonb),
    'canEdit', public.app_availability_sites_can_edit(c.username, c.level, c.can_view)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_sites_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_sites_list(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  Cambiar. p_items: [[código, true | false | null], ...]. true = dentro, false =
--  fuera, null = volver a lo de omisión (se borra la fila). Lo que queda fuera de
--  la jurisdicción no se cambia y vuelve en `rejected`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_availability_sites_save(p_token uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c          record;
  r          jsonb;
  v_code     text;
  v_value    jsonb;
  v_saved    integer := 0;
  v_seen     text[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM public.app_history_caller(p_token);
  IF NOT public.app_availability_sites_can_edit(c.username, c.level, c.can_view) THEN
    RAISE EXCEPTION 'Su rol no puede cambiar los establecimientos del análisis.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No hay cambios.';
  END IF;
  IF jsonb_array_length(p_items) > 3000 THEN
    RAISE EXCEPTION 'Demasiados cambios a la vez (%).', jsonb_array_length(p_items);
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(r) <> 'array' OR jsonb_array_length(r) <> 2 THEN
      RAISE EXCEPTION 'Cambio mal formado: %', r;
    END IF;
    v_code := r ->> 0;
    v_value := r -> 1;
    IF v_code IS NULL OR v_code !~ '^[0-9]{5}$' THEN
      RAISE EXCEPTION 'Código no válido: %', r ->> 0;
    END IF;
    IF jsonb_typeof(v_value) NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'Valor no válido para %: %', v_code, v_value;
    END IF;
    IF v_code = ANY (v_seen) THEN
      RAISE EXCEPTION 'El código % viene repetido.', v_code;
    END IF;
    v_seen := v_seen || v_code;

    IF c.level <> 'GLOBAL' AND NOT EXISTS (SELECT 1 FROM public.app_history_scope_codes(c.level, c.personnel_id) x WHERE x.code = v_code) THEN
      v_rejected := v_rejected || to_jsonb(v_code);
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_value) = 'null' THEN
      DELETE FROM public.availability_sites WHERE facility_code = v_code;
    ELSE
      INSERT INTO public.availability_sites (facility_code, in_analysis, updated_by, updated_at)
      VALUES (v_code, (v_value #>> '{}')::boolean, c.username, now())
      ON CONFLICT (facility_code) DO UPDATE
        SET in_analysis = EXCLUDED.in_analysis, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
    END IF;
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('saved', v_saved, 'rejected', v_rejected);
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_sites_save(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_sites_save(uuid, jsonb) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  Comprobación
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.availability_sites') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla availability_sites.';
  END IF;
  IF to_regprocedure('public.app_history_caller(uuid)') IS NULL OR to_regprocedure('public.app_history_scope_codes(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar SUPABASE_DISPONIBILIDAD_HISTORIAL.sql antes que este archivo.';
  END IF;
  IF to_regprocedure('public.app_availability_sites_list(uuid)') IS NULL OR to_regprocedure('public.app_availability_sites_save(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Faltan las funciones de los establecimientos del análisis.';
  END IF;
  RAISE NOTICE 'TODO CORRECTO';
END;
$$;

SELECT 'TODO CORRECTO' AS resultado;

-- ============================================================================
--  REVERSIÓN (solo si hace falta deshacer):
--
--    DROP FUNCTION IF EXISTS public.app_availability_sites_save(uuid, jsonb);
--    DROP FUNCTION IF EXISTS public.app_availability_sites_list(uuid);
--    DROP FUNCTION IF EXISTS public.app_availability_sites_can_edit(text, text, boolean);
--    DROP TABLE IF EXISTS public.availability_sites;
-- ============================================================================
