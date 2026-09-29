-- ============================================================================
--  USUARIOS POR JURISDICCIÓN - El informático de UNGET puede registrar usuarios
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  Guardar un usuario pasaba por `app_admin_save_user`, que solo acepta ADMIN. Un
--  informático de UNGET veía el formulario completo y al guardar recibía «Esta
--  operación requiere permisos de administrador». Peor: la aplicación escribía antes
--  los datos personales en `personnel`, así que esos cambios SÍ quedaban guardados
--  aunque saliera el error.
--
--  Este script agrega dos funciones que hacen todo en el servidor y en una sola
--  operación (o se guarda completo o no se guarda nada):
--
--    app_manage_save_user    crear o editar usuario + datos personales
--    app_manage_toggle_user  activar / desactivar
--
--  REGLAS (acordadas el 2026-09-29)
--
--    ADMIN                    todo, igual que antes.
--    Quien tenga el módulo    solo dentro de su jurisdicción (su UNGET, su microred…)
--    «Gestión de Usuarios»    y solo roles de nivel INFERIOR al suyo, más los roles
--    y no sea ADMIN           «COORDINADOR…» de su mismo nivel. Nunca otro de su mismo
--                             rol, nunca un nivel superior, nunca ADMIN.
--                             Puede asignar contraseña y activar/desactivar.
--                             Eliminar sigue siendo solo del ADMIN.
--
--  La misma regla vive en `services/userManagementRules.ts`, que la pantalla usa para
--  no ofrecer lo que aquí se rechaza.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Puede ejecutarse antes o después de publicar la aplicación: si la función no
--    existe todavía, la aplicación usa el camino anterior (solo ADMIN).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- Peso de cada nivel de jurisdicción. Igual que LEVEL_WEIGHTS en el frontend.
CREATE OR REPLACE FUNCTION public.app_level_weight(p_level text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(COALESCE(p_level, ''))
    WHEN 'GLOBAL'   THEN 100
    WHEN 'DIRESA'   THEN 80
    WHEN 'OGESS'    THEN 60
    WHEN 'UNGET'    THEN 40
    WHEN 'MICRORED' THEN 20
    WHEN 'IPRESS'   THEN 0
    ELSE -1
  END;
$$;


-- ¿Puede quien llama (nivel p_caller_level) asignar el rol p_target_role?
CREATE OR REPLACE FUNCTION public.app_can_assign_role(p_caller_level text, p_target_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    upper(COALESCE(p_target_role, '')) <> 'ADMIN'
    AND public.app_level_weight(p_caller_level) >= 0
    AND public.app_level_weight(rc.jurisdiction_level) >= 0
    AND public.app_level_weight(rc.jurisdiction_level) < 100
    AND (
      public.app_level_weight(rc.jurisdiction_level) < public.app_level_weight(p_caller_level)
      OR (
        public.app_level_weight(rc.jurisdiction_level) = public.app_level_weight(p_caller_level)
        AND upper(rc.role) LIKE '%COORDINADOR%'
      )
    )
  FROM public.roles_config rc
  WHERE rc.role = p_target_role;
$$;

REVOKE ALL ON FUNCTION public.app_can_assign_role(text, text) FROM PUBLIC, anon, authenticated;


-- ¿Cae el lugar indicado dentro de la jurisdicción del personal p_caller_personnel?
-- El lugar se da como establecimiento o, si no tiene, como microred/UNGET/OGESS/DIRESA.
-- Se completa la jerarquía desde el establecimiento y la UNGET, igual que la pantalla.
CREATE OR REPLACE FUNCTION public.app_place_in_scope(
  p_caller_personnel text,
  p_facility_code    text,
  p_microred_id      text,
  p_unget_id         text,
  p_ogess_id         text,
  p_diresa_id        text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_fac    record;
  v_micro  text := NULLIF(p_microred_id, '');
  v_unget  text := NULLIF(p_unget_id, '');
  v_ogess  text := NULLIF(p_ogess_id, '');
  v_diresa text := NULLIF(p_diresa_id, '');
  v_up     record;
BEGIN
  SELECT facility_code, microred_id::text AS microred_id, unget_id::text AS unget_id,
         ogess_id::text AS ogess_id, diresa_id::text AS diresa_id
    INTO c
  FROM public.personnel WHERE id = p_caller_personnel;
  IF NOT FOUND THEN RETURN false; END IF;

  IF NULLIF(p_facility_code, '') IS NOT NULL THEN
    SELECT code, microred_id::text AS microred_id, unget_id::text AS unget_id,
           ogess_id::text AS ogess_id, diresa_id::text AS diresa_id
      INTO v_fac
    FROM public.facilities WHERE code = p_facility_code;
    IF NOT FOUND THEN RETURN false; END IF;
    v_micro := COALESCE(v_fac.microred_id, v_micro);
    v_unget := COALESCE(v_fac.unget_id, v_unget);
    v_ogess := COALESCE(v_fac.ogess_id, v_ogess);
    v_diresa := COALESCE(v_fac.diresa_id, v_diresa);
  END IF;

  IF v_unget IS NULL AND v_micro IS NOT NULL THEN
    SELECT unget_id::text INTO v_unget FROM public.microredes WHERE id::text = v_micro;
  END IF;
  IF v_unget IS NOT NULL THEN
    SELECT u.ogess_id::text AS ogess_id, u.diresa_id::text AS diresa_id
      INTO v_up
    FROM public.ungets u WHERE u.id::text = v_unget;
    IF FOUND THEN
      v_ogess := COALESCE(v_ogess, v_up.ogess_id);
      v_diresa := COALESCE(v_diresa, v_up.diresa_id);
    END IF;
  END IF;
  IF v_diresa IS NULL AND v_ogess IS NOT NULL THEN
    SELECT diresa_id::text INTO v_diresa FROM public.ogess WHERE id::text = v_ogess;
  END IF;

  -- Mismo orden que la pantalla: el dato más específico de quien llama manda.
  -- COALESCE: una comparación con NULL daría NULL, y `IF NOT NULL` no rechaza nada.
  IF c.facility_code IS NOT NULL THEN RETURN COALESCE(p_facility_code = c.facility_code, false); END IF;
  IF c.microred_id  IS NOT NULL THEN RETURN COALESCE(v_micro  = c.microred_id, false); END IF;
  IF c.unget_id     IS NOT NULL THEN RETURN COALESCE(v_unget  = c.unget_id, false); END IF;
  IF c.ogess_id     IS NOT NULL THEN RETURN COALESCE(v_ogess  = c.ogess_id, false); END IF;
  IF c.diresa_id    IS NOT NULL THEN RETURN COALESCE(v_diresa = c.diresa_id, false); END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.app_place_in_scope(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;


-- Quién llama: devuelve su rol, su nivel, si es ADMIN y si tiene Gestión de Usuarios.
CREATE OR REPLACE FUNCTION public.app_user_manager(p_token uuid)
RETURNS TABLE (username text, personnel_id text, is_admin boolean, level text, can_manage boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT u.username,
         u.personnel_id,
         upper(COALESCE(u.role, '')) = 'ADMIN',
         upper(COALESCE(rc.jurisdiction_level, '')),
         upper(COALESCE(u.role, '')) = 'ADMIN'
           OR COALESCE(rc.allowed_modules, '[]'::jsonb) ? 'ADMIN_USERS'
  FROM public.app_sessions s
  JOIN public.users u ON u.username = s.username
  LEFT JOIN public.roles_config rc ON rc.role = u.role
  WHERE s.token = p_token AND s.expires_at > now() AND u.is_active
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.app_user_manager(uuid) FROM PUBLIC, anon, authenticated;


-- Verifica que quien llama pueda administrar al usuario existente p_username.
CREATE OR REPLACE FUNCTION public.app_assert_can_manage_existing(
  p_caller_personnel text, p_caller_level text, p_username text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  SELECT u.role, p.facility_code, p.microred_id::text AS microred_id, p.unget_id::text AS unget_id,
         p.ogess_id::text AS ogess_id, p.diresa_id::text AS diresa_id
    INTO t
  FROM public.users u
  LEFT JOIN public.personnel p ON p.id = u.personnel_id
  WHERE u.username = p_username;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario % no existe.', p_username;
  END IF;
  IF NOT COALESCE(public.app_can_assign_role(p_caller_level, t.role), false) THEN
    RAISE EXCEPTION 'No puede modificar a un usuario con el rol %.', t.role;
  END IF;
  IF NOT public.app_place_in_scope(p_caller_personnel, t.facility_code, t.microred_id, t.unget_id, t.ogess_id, t.diresa_id) THEN
    RAISE EXCEPTION 'Ese usuario no pertenece a su jurisdicción.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.app_assert_can_manage_existing(text, text, text) FROM PUBLIC, anon, authenticated;


-- Crear o editar un usuario con sus datos personales, en una sola operación.
CREATE OR REPLACE FUNCTION public.app_manage_save_user(
  p_token           uuid,
  p_is_new          boolean,
  p_username        text,
  p_role            text,
  p_is_active       boolean,
  p_password        text,
  p_personnel_id    text,
  p_first_name      text,
  p_last_name       text,
  p_dni             text,
  p_phone           text,
  p_email           text,
  p_labor_regime    text,
  p_labor_regime_id text,
  p_profession_id   text,
  p_facility_code   text,
  p_diresa_id       text,
  p_ogess_id        text,
  p_unget_id        text,
  p_microred_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  yo        record;
  v_hash    text;
  v_prev    record;
BEGIN
  SELECT * INTO yo FROM public.app_user_manager(p_token);
  IF yo.username IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  IF NOT yo.can_manage THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar usuarios.';
  END IF;
  IF NULLIF(p_personnel_id, '') IS NULL THEN
    RAISE EXCEPTION 'Falta el identificador del personal.';
  END IF;

  IF NOT yo.is_admin THEN
    IF NOT COALESCE(public.app_can_assign_role(yo.level, p_role), false) THEN
      RAISE EXCEPTION 'No puede asignar el rol %.', p_role;
    END IF;
    IF NOT public.app_place_in_scope(yo.personnel_id, p_facility_code, p_microred_id, p_unget_id, p_ogess_id, p_diresa_id) THEN
      RAISE EXCEPTION 'El establecimiento o la unidad elegida no pertenece a su jurisdicción.';
    END IF;

    -- Si la ficha de personal ya existe, también tiene que ser de su jurisdicción:
    -- si no, bastaría con conocer su id para sobrescribir la de otra UNGET.
    SELECT facility_code, microred_id::text AS microred_id, unget_id::text AS unget_id,
           ogess_id::text AS ogess_id, diresa_id::text AS diresa_id
      INTO v_prev
    FROM public.personnel WHERE id = p_personnel_id;
    IF FOUND AND NOT public.app_place_in_scope(yo.personnel_id, v_prev.facility_code, v_prev.microred_id, v_prev.unget_id, v_prev.ogess_id, v_prev.diresa_id) THEN
      RAISE EXCEPTION 'Esa ficha de personal no pertenece a su jurisdicción.';
    END IF;

    IF NOT p_is_new THEN
      PERFORM public.app_assert_can_manage_existing(yo.personnel_id, yo.level, p_username);
      IF NOT EXISTS (SELECT 1 FROM public.users WHERE username = p_username AND personnel_id = p_personnel_id) THEN
        RAISE EXCEPTION 'El usuario y la ficha de personal no coinciden.';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.personnel (
    id, first_name, last_name, dni, phone, email, labor_regime, labor_regime_id, profession_id,
    facility_code, diresa_id, ogess_id, unget_id, microred_id
  ) VALUES (
    p_personnel_id, p_first_name, p_last_name, p_dni, NULLIF(p_phone, ''), p_email,
    NULLIF(p_labor_regime, ''), NULLIF(p_labor_regime_id, ''), NULLIF(p_profession_id, ''),
    NULLIF(p_facility_code, ''), NULLIF(p_diresa_id, '')::uuid, NULLIF(p_ogess_id, '')::uuid,
    NULLIF(p_unget_id, '')::uuid, NULLIF(p_microred_id, '')::uuid
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    dni = EXCLUDED.dni,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    labor_regime = EXCLUDED.labor_regime,
    labor_regime_id = EXCLUDED.labor_regime_id,
    profession_id = EXCLUDED.profession_id,
    facility_code = EXCLUDED.facility_code,
    diresa_id = EXCLUDED.diresa_id,
    ogess_id = EXCLUDED.ogess_id,
    unget_id = EXCLUDED.unget_id,
    microred_id = EXCLUDED.microred_id;

  IF p_password IS NOT NULL AND length(p_password) > 0 THEN
    v_hash := crypt(p_password, gen_salt('bf', 10));
  END IF;

  IF p_is_new THEN
    INSERT INTO public.users (username, role, personnel_id, is_active, password_hash)
    VALUES (
      p_username, p_role, p_personnel_id, COALESCE(p_is_active, true),
      COALESCE(v_hash, crypt('Temporal2026*', gen_salt('bf', 10)))
    );
  ELSE
    UPDATE public.users
    SET role          = p_role,
        personnel_id  = p_personnel_id,
        is_active     = COALESCE(p_is_active, true),
        password_hash = COALESCE(v_hash, password_hash)
    WHERE username = p_username;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.app_manage_save_user(uuid, boolean, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_manage_save_user(uuid, boolean, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;


-- Activar o desactivar un usuario.
CREATE OR REPLACE FUNCTION public.app_manage_toggle_user(p_token uuid, p_username text, p_status boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  yo record;
BEGIN
  SELECT * INTO yo FROM public.app_user_manager(p_token);
  IF yo.username IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  IF NOT yo.can_manage THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar usuarios.';
  END IF;
  IF NOT yo.is_admin THEN
    PERFORM public.app_assert_can_manage_existing(yo.personnel_id, yo.level, p_username);
  END IF;
  UPDATE public.users SET is_active = p_status WHERE username = p_username;
END;
$$;

REVOKE ALL ON FUNCTION public.app_manage_toggle_user(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_manage_toggle_user(uuid, text, boolean) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  REVERSIÓN (la aplicación vuelve sola al camino anterior, solo ADMIN)
-- ----------------------------------------------------------------------------
--
--  DROP FUNCTION IF EXISTS public.app_manage_toggle_user(uuid, text, boolean);
--  DROP FUNCTION IF EXISTS public.app_manage_save_user(uuid, boolean, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text);
--  DROP FUNCTION IF EXISTS public.app_assert_can_manage_existing(text, text, text);
--  DROP FUNCTION IF EXISTS public.app_user_manager(uuid);
--  DROP FUNCTION IF EXISTS public.app_place_in_scope(text, text, text, text, text, text);
--  DROP FUNCTION IF EXISTS public.app_can_assign_role(text, text);
--  DROP FUNCTION IF EXISTS public.app_level_weight(text);
