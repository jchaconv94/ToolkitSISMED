-- ============================================================================
--  DISPONIBILIDAD - Historial mes a mes
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    El módulo Disponibilidad abre en el «Historial de disponibilidad»: lo que se
--    guardó cada mes desde el reporte del mes (botón «Guardar en el historial»).
--    Se guarda, por establecimiento (IPRESS, farmacias sumadas), mes y vista
--    (todos los productos o medicamentos esenciales), cuántos ítems quedaron en
--    cada situación. No se guardan productos: el porcentaje se recalcula en la web
--    con la fórmula vigente, y la microred y la UNGET salen del registro actual.
--
--  REGLAS (acordadas con el usuario el 2026-10-09)
--
--    Ver       Quien tiene el módulo Disponibilidad, solo su jurisdicción:
--              ADMIN y DIRESA todo; OGESS sus UNGET; UNGET sus establecimientos;
--              microred los suyos; el responsable de un establecimiento, el suyo.
--    Guardar   ADMIN, DIRESA y UNGET (informático y coordinador), con la acción
--    y quitar  «Guardar y quitar meses del historial» encendida en su rol, y solo
--              establecimientos de su jurisdicción. Ni OGESS, ni microred, ni el
--              responsable de un establecimiento.
--    Meses     Solo meses cerrados: el mes en curso (hora de Lima) no se guarda.
--    Reemplazo Guardar otra vez un mes reemplaza los establecimientos que vienen
--              en el archivo; los que ya estaban y no vienen se conservan.
--
--  Nadie lee ni escribe la tabla directamente (RLS sin políticas): todo pasa por
--  las tres funciones de abajo, que exigen una sesión válida.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es
--    idempotente. Requiere `SUPABASE_SEGURIDAD_APLICAR_ESTO.sql` (sesiones) y
--    `SUPABASE_ROLES_ACCIONES.sql` (acciones por rol). Puede ejecutarse antes o
--    después de publicar la web: sin él, la web dice que el historial no está
--    instalado y el reporte del mes funciona igual. Al final debe aparecer
--    "TODO CORRECTO".
--
--  REVERSIÓN al final del archivo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.availability_history (
  facility_code      text        NOT NULL CHECK (facility_code ~ '^[0-9]{5}$'),
  month              text        NOT NULL CHECK (month ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
  view               text        NOT NULL CHECK (view IN ('all', 'essential')),
  desabastecido      integer     NOT NULL CHECK (desabastecido >= 0),
  substock           integer     NOT NULL CHECK (substock >= 0),
  normostock         integer     NOT NULL CHECK (normostock >= 0),
  sobrestock         integer     NOT NULL CHECK (sobrestock >= 0),
  sin_rotacion       integer     NOT NULL CHECK (sin_rotacion >= 0),
  sin_rotacion_vital integer     NOT NULL CHECK (sin_rotacion_vital >= 0),
  total              integer     NOT NULL CHECK (total > 0),
  -- Dónde estaba el establecimiento al guardarse (la web agrupa con el registro actual).
  unget_id           text,
  microred_id        text,
  -- Con qué se calculó: lo que no se puede recalcular sin el detalle.
  sub_max            numeric     NOT NULL,
  sobre_min          numeric     NOT NULL,
  truncate_months    boolean     NOT NULL,
  fused_version      text,
  source_cut         text        NOT NULL CHECK (source_cut ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
  saved_by           text        NOT NULL,
  saved_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_code, month, view),
  CHECK (total = desabastecido + substock + normostock + sobrestock + sin_rotacion),
  CHECK (sin_rotacion_vital <= sin_rotacion)
);

CREATE INDEX IF NOT EXISTS availability_history_month_idx ON public.availability_history (month);

ALTER TABLE public.availability_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_history FROM anon, authenticated;


-- ----------------------------------------------------------------------------
--  Quién llama: nivel (con la misma regla de la web, `jurisdictionService.ts`),
--  si puede ver y si puede guardar.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_history_caller(p_token uuid)
RETURNS TABLE (username text, personnel_id text, level text, can_view boolean, can_save boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   record;
  v_level  text;
  v_admin  boolean;
  v_denied jsonb;
BEGIN
  SELECT u.username, u.personnel_id::text AS personnel_id,
         upper(COALESCE(u.role, '')) AS role,
         upper(COALESCE(rc.jurisdiction_level, '')) AS jlevel,
         COALESCE(rc.allowed_modules, '[]'::jsonb) AS modules,
         -- to_jsonb: si aún no existe la columna (sin SUPABASE_ROLES_ACCIONES.sql) no falla.
         COALESCE(to_jsonb(rc) -> 'denied_actions', '[]'::jsonb) AS denied
    INTO v_user
  FROM public.app_sessions s
  JOIN public.users u ON u.username = s.username
  LEFT JOIN public.roles_config rc ON rc.role = u.role
  WHERE s.token = p_token AND s.expires_at > now() AND u.is_active
  LIMIT 1;

  IF v_user.username IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;

  v_admin := v_user.role = 'ADMIN';
  v_level := CASE
    WHEN v_admin OR v_user.jlevel IN ('GLOBAL', 'DIRESA') OR v_user.role IN ('SUPERADMIN', 'ADMINISTRADOR')
         OR v_user.role LIKE '%DIRESA%' OR v_user.role LIKE '%GLOBAL%' THEN 'GLOBAL'
    WHEN v_user.jlevel = 'OGESS' OR v_user.role LIKE '%OGESS%' THEN 'OGESS'
    WHEN v_user.jlevel = 'UNGET' OR v_user.role LIKE '%UNGET%' OR v_user.role LIKE '%RED%' THEN 'UNGET'
    WHEN v_user.jlevel = 'MICRORED' OR v_user.role LIKE '%MICRORED%' THEN 'MICRORED'
    ELSE 'IPRESS'
  END;
  v_denied := CASE WHEN jsonb_typeof(v_user.denied) = 'array' THEN v_user.denied ELSE '[]'::jsonb END;

  username := v_user.username;
  personnel_id := v_user.personnel_id;
  level := v_level;
  can_view := v_admin OR v_user.modules ? 'AVAILABILITY';
  can_save := v_admin OR (
    v_user.modules ? 'AVAILABILITY'
    AND v_level IN ('GLOBAL', 'UNGET')
    AND NOT v_denied ? 'AVAILABILITY:saveHistory'
  );
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.app_history_caller(uuid) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
--  Establecimientos (códigos de IPRESS) de la jurisdicción de quien llama.
--  GLOBAL no pasa por aquí: lo ve todo, también lo que ya no está en el registro.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_history_scope_codes(p_level text, p_personnel text)
RETURNS TABLE (code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.code
  FROM public.facilities f
  LEFT JOIN public.microredes m ON m.id::text = f.microred_id::text
  LEFT JOIN public.ungets u ON u.id::text = COALESCE(f.unget_id::text, m.unget_id::text)
  JOIN public.personnel p ON p.id::text = p_personnel
  WHERE f.code ~ '^[0-9]{5}$'
    AND CASE p_level
      WHEN 'OGESS'    THEN COALESCE(COALESCE(f.ogess_id::text, u.ogess_id::text) = p.ogess_id::text, false)
      WHEN 'UNGET'    THEN COALESCE(COALESCE(f.unget_id::text, m.unget_id::text) = p.unget_id::text, false)
      WHEN 'MICRORED' THEN COALESCE(f.microred_id::text = p.microred_id::text, false)
      -- Un puesto comunal o farmacia (06502F02) ve el historial de su IPRESS.
      WHEN 'IPRESS'   THEN COALESCE(f.code = left(p.facility_code, 5), false)
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.app_history_scope_codes(text, text) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
--  Leer: lo guardado entre dos meses, recortado por jurisdicción. Devuelve
--  arreglos compactos (dos años de toda la DIRESA pasan de las 1 000 filas que
--  Supabase entrega por consulta):
--    records: [código, mes, vista, desab, sub, normo, sobre, sin rot, sin rot vitales, total, guardado]
--    saves:   quién guardó, cuándo y con qué límites (el índice de `guardado`)
--    months:  todos los meses con algo guardado en la jurisdicción
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_availability_history_list(p_token uuid, p_from text, p_to text)
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
  SELECT * INTO c FROM public.app_history_caller(p_token);
  IF NOT c.can_view THEN
    RAISE EXCEPTION 'Su rol no tiene el módulo Disponibilidad.';
  END IF;
  IF p_from !~ '^[0-9]{6}$' OR p_to !~ '^[0-9]{6}$' OR p_from > p_to THEN
    RAISE EXCEPTION 'Rango de meses no válido.';
  END IF;

  WITH mine AS (
    SELECT h.*
    FROM public.availability_history h
    WHERE c.level = 'GLOBAL' OR h.facility_code IN (SELECT s.code FROM public.app_history_scope_codes(c.level, c.personnel_id) s)
  ),
  ranged AS (
    SELECT * FROM mine WHERE month BETWEEN p_from AND p_to
  ),
  saves AS (
    SELECT g.*, (row_number() OVER (ORDER BY g.month, g.saved_at, g.saved_by) - 1)::int AS idx
    FROM (
      SELECT month, saved_by, saved_at, sub_max, sobre_min, truncate_months, fused_version, source_cut,
             count(DISTINCT facility_code)::int AS establishments
      FROM ranged
      GROUP BY month, saved_by, saved_at, sub_max, sobre_min, truncate_months, fused_version, source_cut
    ) g
  )
  SELECT jsonb_build_object(
    'records', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(r.facility_code, r.month, r.view, r.desabastecido, r.substock, r.normostock,
                                         r.sobrestock, r.sin_rotacion, r.sin_rotacion_vital, r.total, s.idx)
                       ORDER BY r.month, r.facility_code, r.view)
      FROM ranged r
      JOIN saves s ON s.month = r.month AND s.saved_by = r.saved_by AND s.saved_at = r.saved_at
                  AND s.sub_max = r.sub_max AND s.sobre_min = r.sobre_min AND s.truncate_months = r.truncate_months
                  AND s.fused_version IS NOT DISTINCT FROM r.fused_version AND s.source_cut = r.source_cut
    ), '[]'::jsonb),
    'saves', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'month', s.month,
               'savedBy', s.saved_by,
               'savedByName', COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), s.saved_by),
               'savedAt', s.saved_at,
               'establishments', s.establishments,
               'subMax', s.sub_max,
               'sobreMin', s.sobre_min,
               'truncate', s.truncate_months,
               'fusedVersion', COALESCE(s.fused_version, ''),
               'sourceCut', s.source_cut) ORDER BY s.idx)
      FROM saves s
      LEFT JOIN public.users u ON u.username = s.saved_by
      LEFT JOIN public.personnel p ON p.id::text = u.personnel_id::text
    ), '[]'::jsonb),
    'months', COALESCE((SELECT jsonb_agg(DISTINCT m.month ORDER BY m.month) FROM mine m), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_history_list(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_history_list(uuid, text, text) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  Guardar un mes. p_rows: [[código, vista, desab, sub, normo, sobre, sin rot,
--  sin rot vitales, total], ...]. p_meta: { subMax, sobreMin, truncate,
--  fusedVersion, sourceCut }. Lo que no está en el registro o queda fuera de la
--  jurisdicción no se guarda y vuelve en `rejected`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_availability_history_save(p_token uuid, p_month text, p_rows jsonb, p_meta jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c          record;
  r          jsonb;
  v_code     text;
  v_view     text;
  v_n        integer[];
  v_fac      record;
  v_now      timestamptz := now();
  v_current  text := to_char(now() AT TIME ZONE 'America/Lima', 'YYYYMM');
  v_sub      numeric;
  v_sobre    numeric;
  v_trunc    boolean;
  v_fused    text;
  v_source   text;
  v_saved    text[] := '{}';
  v_seen     text[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
  i          integer;
BEGIN
  SELECT * INTO c FROM public.app_history_caller(p_token);
  IF NOT c.can_save THEN
    RAISE EXCEPTION 'Su rol no puede guardar en el historial de disponibilidad.';
  END IF;

  IF p_month IS NULL OR p_month !~ '^[0-9]{4}(0[1-9]|1[0-2])$' OR p_month < '201501' THEN
    RAISE EXCEPTION 'Mes no válido: %', p_month;
  END IF;
  IF p_month >= v_current THEN
    RAISE EXCEPTION 'El mes % aún no termina: solo se guardan meses cerrados.', p_month;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'No hay establecimientos para guardar.';
  END IF;
  IF jsonb_array_length(p_rows) > 4000 THEN
    RAISE EXCEPTION 'Demasiadas filas en un solo guardado (%).', jsonb_array_length(p_rows);
  END IF;
  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RAISE EXCEPTION 'Faltan los datos del cálculo.';
  END IF;

  BEGIN
    v_sub   := (p_meta ->> 'subMax')::numeric;
    v_sobre := (p_meta ->> 'sobreMin')::numeric;
    v_trunc := (p_meta ->> 'truncate')::boolean;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Límites de meses no válidos.';
  END;
  v_fused  := left(COALESCE(p_meta ->> 'fusedVersion', ''), 80);
  v_source := p_meta ->> 'sourceCut';
  IF v_sub IS NULL OR v_sobre IS NULL OR v_trunc IS NULL OR v_sub < 0 OR v_sobre < v_sub OR v_sobre > 60 THEN
    RAISE EXCEPTION 'Límites de meses no válidos.';
  END IF;
  IF v_source IS NULL OR v_source !~ '^[0-9]{4}(0[1-9]|1[0-2])$' OR v_source < p_month OR v_source >= v_current THEN
    RAISE EXCEPTION 'Mes de corte del archivo no válido: %', v_source;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(r) <> 'array' OR jsonb_array_length(r) <> 9 THEN
      RAISE EXCEPTION 'Fila con formato no válido.';
    END IF;
    v_code := r ->> 0;
    v_view := r ->> 1;
    IF v_code IS NULL OR v_code !~ '^[0-9]{5}$' OR v_view NOT IN ('all', 'essential') THEN
      RAISE EXCEPTION 'Fila con código o vista no válidos: % %', v_code, v_view;
    END IF;
    IF (v_code || '|' || v_view) = ANY (v_seen) THEN
      RAISE EXCEPTION 'El establecimiento % viene repetido en la vista %.', v_code, v_view;
    END IF;
    v_seen := v_seen || (v_code || '|' || v_view);

    v_n := '{}';
    FOR i IN 2..8 LOOP
      IF jsonb_typeof(r -> i) <> 'number' OR (r ->> i)::numeric <> trunc((r ->> i)::numeric) OR (r ->> i)::numeric < 0 OR (r ->> i)::numeric > 100000 THEN
        RAISE EXCEPTION 'Conteos no válidos para %.', v_code;
      END IF;
      v_n := v_n || (r ->> i)::integer;
    END LOOP;
    -- v_n: desab, sub, normo, sobre, sin rot, sin rot vitales, total
    IF v_n[7] <= 0 OR v_n[7] <> v_n[1] + v_n[2] + v_n[3] + v_n[4] + v_n[5] OR v_n[6] > v_n[5] THEN
      RAISE EXCEPTION 'Los conteos de % no suman el total.', v_code;
    END IF;

    SELECT f.code, COALESCE(f.unget_id::text, m.unget_id::text) AS unget_id, f.microred_id::text AS microred_id
      INTO v_fac
    FROM public.facilities f
    LEFT JOIN public.microredes m ON m.id::text = f.microred_id::text
    WHERE f.code = v_code;

    IF v_fac.code IS NULL THEN
      IF NOT v_rejected @> jsonb_build_array(jsonb_build_object('code', v_code, 'reason', 'registry')) THEN
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('code', v_code, 'reason', 'registry'));
      END IF;
      CONTINUE;
    END IF;
    IF c.level <> 'GLOBAL' AND NOT EXISTS (SELECT 1 FROM public.app_history_scope_codes(c.level, c.personnel_id) s WHERE s.code = v_code) THEN
      IF NOT v_rejected @> jsonb_build_array(jsonb_build_object('code', v_code, 'reason', 'scope')) THEN
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('code', v_code, 'reason', 'scope'));
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.availability_history AS h (
      facility_code, month, view, desabastecido, substock, normostock, sobrestock, sin_rotacion, sin_rotacion_vital, total,
      unget_id, microred_id, sub_max, sobre_min, truncate_months, fused_version, source_cut, saved_by, saved_at
    ) VALUES (
      v_code, p_month, v_view, v_n[1], v_n[2], v_n[3], v_n[4], v_n[5], v_n[6], v_n[7],
      v_fac.unget_id, v_fac.microred_id, v_sub, v_sobre, v_trunc, NULLIF(v_fused, ''), v_source, c.username, v_now
    )
    ON CONFLICT (facility_code, month, view) DO UPDATE SET
      desabastecido = EXCLUDED.desabastecido, substock = EXCLUDED.substock, normostock = EXCLUDED.normostock,
      sobrestock = EXCLUDED.sobrestock, sin_rotacion = EXCLUDED.sin_rotacion, sin_rotacion_vital = EXCLUDED.sin_rotacion_vital,
      total = EXCLUDED.total, unget_id = EXCLUDED.unget_id, microred_id = EXCLUDED.microred_id,
      sub_max = EXCLUDED.sub_max, sobre_min = EXCLUDED.sobre_min, truncate_months = EXCLUDED.truncate_months,
      fused_version = EXCLUDED.fused_version, source_cut = EXCLUDED.source_cut,
      saved_by = EXCLUDED.saved_by, saved_at = EXCLUDED.saved_at;

    IF NOT v_code = ANY (v_saved) THEN v_saved := v_saved || v_code; END IF;
  END LOOP;

  RETURN jsonb_build_object('saved', COALESCE(array_length(v_saved, 1), 0), 'rejected', v_rejected);
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_history_save(uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_history_save(uuid, text, jsonb, jsonb) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  Quitar un mes: solo los establecimientos de la jurisdicción de quien llama.
--  Devuelve cuántos establecimientos se quitaron.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_availability_history_remove(p_token uuid, p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c       record;
  v_count integer;
BEGIN
  SELECT * INTO c FROM public.app_history_caller(p_token);
  IF NOT c.can_save THEN
    RAISE EXCEPTION 'Su rol no puede quitar meses del historial de disponibilidad.';
  END IF;
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Mes no válido: %', p_month;
  END IF;

  WITH gone AS (
    DELETE FROM public.availability_history h
    WHERE h.month = p_month
      AND (c.level = 'GLOBAL' OR h.facility_code IN (SELECT s.code FROM public.app_history_scope_codes(c.level, c.personnel_id) s))
    RETURNING h.facility_code
  )
  SELECT count(DISTINCT facility_code)::int INTO v_count FROM gone;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.app_availability_history_remove(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_availability_history_remove(uuid, text) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.availability_history) AS filas_guardadas,
       (SELECT count(DISTINCT month) FROM public.availability_history) AS meses_guardados;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer: borra todo el historial)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_availability_history_remove(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_availability_history_save(uuid, text, jsonb, jsonb);
--  DROP FUNCTION IF EXISTS public.app_availability_history_list(uuid, text, text);
--  DROP FUNCTION IF EXISTS public.app_history_scope_codes(text, text);
--  DROP FUNCTION IF EXISTS public.app_history_caller(uuid);
--  DROP TABLE IF EXISTS public.availability_history;
