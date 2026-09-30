-- ============================================================================
--  CLAVES DE ENVÍO - Solo la PC vinculada envía el stock de su establecimiento
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  El script de Google que recibe el stock del Toolkit de escritorio no pide
--  credencial: cualquier PC que tenga su dirección puede reemplazar la pestaña de un
--  establecimiento. Ya pasó: una copia vieja del SISMED del almacén 030S05, en otra
--  PC, pisaba el stock real con 14 lotes desactualizados.
--
--  Con este script el informático SISMED genera, desde el módulo «Claves de envío»,
--  una clave por establecimiento. La PC donde se configura queda vinculada en su
--  primer envío y es la única que puede enviar. Cualquier otra —sin clave, con otra
--  clave o con la misma clave copiada— se bloquea y avisa en la web, donde se decide
--  «Ignorar» o «Cambiar a este equipo».
--
--  QUIÉN
--
--    ADMIN                       todos los establecimientos.
--    Rol con el módulo           solo los de su jurisdicción (su UNGET, su microred…).
--    «Claves de envío»           Se habilita o no por rol en Administración → Roles.
--
--  Los establecimientos SIN clave siguen enviando como hasta hoy. Nada cambia para
--  las UNGET que no usen el módulo.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_USUARIOS_POR_JURISDICCION.sql` (ya aplicado el 2026-09-29).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ----------------------------------------------------------------------------
--  Tablas. Nadie las lee ni las escribe directamente: solo las funciones.
-- ----------------------------------------------------------------------------

-- Una fila por establecimiento protegido. `code` es el de la pestaña: la IPRESS
-- (cinco dígitos, sus puestos comunales viajan dentro) o el almacén (seis caracteres).
CREATE TABLE IF NOT EXISTS public.sync_send_keys (
  code         text PRIMARY KEY,
  key_hash     text NOT NULL,          -- sha256 de la clave; la clave no se guarda
  key_hint     text NOT NULL,          -- últimos cuatro caracteres, para reconocerla
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  device_id    text,                   -- PC vinculada: identificador de la instalación
  device_name  text,                   -- nombre de la PC, solo para mostrar
  bound_at     timestamptz,
  last_ok_at   timestamptz,
  last_ok_rows integer
);

-- Envíos de los establecimientos protegidos, aceptados y bloqueados.
CREATE TABLE IF NOT EXISTS public.sync_send_attempts (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL REFERENCES public.sync_send_keys(code) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  device_id   text,
  device_name text,
  row_count   integer,
  -- ACEPTADO | SIN_CLAVE | CLAVE_INCORRECTA | OTRO_EQUIPO
  result      text NOT NULL,
  -- Un bloqueo deja de avisar cuando se ignora, se cambia de equipo o se regenera.
  resolved_at timestamptz,
  resolved_by text
);

CREATE INDEX IF NOT EXISTS sync_send_attempts_code_idx
  ON public.sync_send_attempts (code, created_at DESC);

ALTER TABLE public.sync_send_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_send_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_send_keys FROM anon, authenticated;
REVOKE ALL ON public.sync_send_attempts FROM anon, authenticated;


-- ----------------------------------------------------------------------------
--  Quién llama y qué le corresponde
-- ----------------------------------------------------------------------------

-- Devuelve a quien llama si puede usar el módulo. Lanza error si no.
CREATE OR REPLACE FUNCTION public.app_send_keys_caller(p_token uuid)
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
         COALESCE(rc.allowed_modules, '[]'::jsonb) ? 'ADMIN_SEND_KEYS' AS has_module
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
    RAISE EXCEPTION 'Su rol no tiene acceso a Claves de envío.';
  END IF;

  RETURN QUERY SELECT r.username::text, r.personnel_id::text, r.is_admin;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_keys_caller(uuid) FROM PUBLIC, anon, authenticated;


-- ¿Puede quien llama administrar la clave del establecimiento p_code?
-- Solo IPRESS (cinco dígitos) y almacenes (seis caracteres) registrados: los puestos
-- comunales comparten la pestaña, y la clave, de su IPRESS.
CREATE OR REPLACE FUNCTION public.app_send_keys_assert_code(p_token uuid, p_code text)
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
  SELECT * INTO c FROM public.app_send_keys_caller(p_token);

  IF v_code !~ '^([0-9]{5}|[0-9A-Z]{6})$'
     OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE upper(f.code) = v_code) THEN
    RAISE EXCEPTION 'El establecimiento % no admite clave de envío.', v_code;
  END IF;
  IF NOT c.is_admin
     AND NOT public.app_place_in_scope(c.personnel_id, v_code, NULL, NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Ese establecimiento no pertenece a su jurisdicción.';
  END IF;

  RETURN c.username;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_keys_assert_code(uuid, text) FROM PUBLIC, anon, authenticated;


-- Clave legible: prefijo del establecimiento + 12 caracteres sin los que se confunden
-- (0/O, 1/I/L). 31^12 ≈ 7,9·10^17 combinaciones.
CREATE OR REPLACE FUNCTION public.app_send_key_new_secret(p_code text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes    bytea := gen_random_bytes(12);
  v_out      text := '';
  i          int;
BEGIN
  FOR i IN 0..11 LOOP
    IF i > 0 AND i % 4 = 0 THEN v_out := v_out || '-'; END IF;
    v_out := v_out || substr(v_alfabeto, (get_byte(v_bytes, i) % 31) + 1, 1);
  END LOOP;
  RETURN upper(p_code) || '-' || v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_new_secret(text) FROM PUBLIC, anon, authenticated;


-- Forma única de comparar: sin espacios y en mayúsculas.
CREATE OR REPLACE FUNCTION public.app_send_key_hash(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(digest(upper(regexp_replace(COALESCE(p_key, ''), '\s', '', 'g')), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.app_send_key_hash(text) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
--  Lo que usa la web (con el token de sesión)
-- ----------------------------------------------------------------------------

-- Establecimientos de la jurisdicción con el estado de su clave.
CREATE OR REPLACE FUNCTION public.app_send_keys_overview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_hoy    timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Lima')) AT TIME ZONE 'America/Lima';
  v_result jsonb;
BEGIN
  SELECT * INTO c FROM public.app_send_keys_caller(p_token);

  SELECT COALESCE(jsonb_agg(fila ORDER BY fila->>'name'), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'code',        upper(f.code),
      'name',        f.name,
      'type',        f.type,
      'ungetId',     f.unget_id::text,
      'ungetName',   ug.name,
      'hasKey',      k.code IS NOT NULL,
      'keyHint',     k.key_hint,
      'createdAt',   k.created_at,
      'createdBy',   k.created_by,
      'deviceName',  k.device_name,
      'boundAt',     k.bound_at,
      'lastOkAt',    k.last_ok_at,
      'lastOkRows',  k.last_ok_rows,
      'blockedToday', COALESCE((
        SELECT count(*) FROM public.sync_send_attempts a
        WHERE a.code = k.code AND a.result <> 'ACEPTADO' AND a.created_at >= v_hoy
      ), 0),
      'alert', (
        SELECT jsonb_build_object(
          'id', a.id, 'at', a.created_at, 'deviceName', a.device_name,
          'rows', a.row_count, 'result', a.result)
        FROM public.sync_send_attempts a
        WHERE a.code = k.code AND a.result <> 'ACEPTADO' AND a.resolved_at IS NULL
        ORDER BY a.created_at DESC
        LIMIT 1
      )
    ) AS fila
    FROM public.facilities f
    LEFT JOIN public.ungets ug ON ug.id::text = f.unget_id::text
    LEFT JOIN public.sync_send_keys k ON k.code = upper(f.code)
    WHERE upper(f.code) ~ '^([0-9]{5}|[0-9A-Z]{6})$'
      AND (c.is_admin OR public.app_place_in_scope(c.personnel_id, f.code, NULL, NULL, NULL, NULL))
  ) t;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_keys_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_keys_overview(uuid) TO anon, authenticated;


-- Últimos envíos de un establecimiento.
CREATE OR REPLACE FUNCTION public.app_send_key_history(p_token uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := upper(trim(COALESCE(p_code, '')));
BEGIN
  PERFORM public.app_send_keys_assert_code(p_token, v_code);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'at', a.created_at, 'deviceName', a.device_name,
      'rows', a.row_count, 'result', a.result, 'resolvedAt', a.resolved_at)
      ORDER BY a.created_at DESC)
    FROM (
      SELECT * FROM public.sync_send_attempts
      WHERE code = v_code ORDER BY created_at DESC LIMIT 15
    ) a
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_history(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_history(uuid, text) TO anon, authenticated;


-- Genera o regenera la clave. Devuelve la clave en claro: es la única vez que existe.
-- Regenerar desvincula la PC: la que configure la clave nueva queda vinculada.
CREATE OR REPLACE FUNCTION public.app_send_key_generate(p_token uuid, p_code text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code  text := upper(trim(COALESCE(p_code, '')));
  v_user  text;
  v_clave text;
BEGIN
  v_user := public.app_send_keys_assert_code(p_token, v_code);
  v_clave := public.app_send_key_new_secret(v_code);

  INSERT INTO public.sync_send_keys (code, key_hash, key_hint, created_by, created_at)
  VALUES (v_code, public.app_send_key_hash(v_clave), right(v_clave, 4), v_user, now())
  ON CONFLICT (code) DO UPDATE SET
    key_hash = EXCLUDED.key_hash,
    key_hint = EXCLUDED.key_hint,
    created_by = EXCLUDED.created_by,
    created_at = EXCLUDED.created_at,
    device_id = NULL,
    device_name = NULL,
    bound_at = NULL;

  UPDATE public.sync_send_attempts
     SET resolved_at = now(), resolved_by = v_user
   WHERE code = v_code AND result <> 'ACEPTADO' AND resolved_at IS NULL;

  RETURN v_clave;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_generate(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_generate(uuid, text) TO anon, authenticated;


-- Ignorar: la PC vinculada sigue siendo la única y los bloqueos dejan de avisar.
-- Si la misma PC vuelve a intentar, se bloquea y avisa de nuevo.
CREATE OR REPLACE FUNCTION public.app_send_key_ignore(p_token uuid, p_code text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := upper(trim(COALESCE(p_code, '')));
  v_user text;
BEGIN
  v_user := public.app_send_keys_assert_code(p_token, v_code);
  UPDATE public.sync_send_attempts
     SET resolved_at = now(), resolved_by = v_user
   WHERE code = v_code AND result <> 'ACEPTADO' AND resolved_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_ignore(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_ignore(uuid, text) TO anon, authenticated;


-- Cambiar a este equipo: la PC del intento bloqueado pasa a ser la vinculada. La
-- anterior deja de poder enviar. La nueva sigue necesitando la clave configurada.
CREATE OR REPLACE FUNCTION public.app_send_key_rebind(p_token uuid, p_attempt_id bigint)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a      record;
  v_user text;
BEGIN
  SELECT * INTO a FROM public.sync_send_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese intento ya no existe. Actualice la pantalla.';
  END IF;
  v_user := public.app_send_keys_assert_code(p_token, a.code);
  IF NULLIF(a.device_id, '') IS NULL THEN
    RAISE EXCEPTION 'Ese envío no identificó su equipo: actualice el Toolkit de esa PC.';
  END IF;

  UPDATE public.sync_send_keys
     SET device_id = a.device_id, device_name = a.device_name, bound_at = now()
   WHERE code = a.code;

  UPDATE public.sync_send_attempts
     SET resolved_at = now(), resolved_by = v_user
   WHERE code = a.code AND result <> 'ACEPTADO' AND resolved_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_rebind(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_rebind(uuid, bigint) TO anon, authenticated;


-- Retirar clave: el establecimiento vuelve a enviar como antes, desde cualquier PC.
CREATE OR REPLACE FUNCTION public.app_send_key_revoke(p_token uuid, p_code text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := upper(trim(COALESCE(p_code, '')));
BEGIN
  PERFORM public.app_send_keys_assert_code(p_token, v_code);
  DELETE FROM public.sync_send_keys WHERE code = v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_revoke(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_revoke(uuid, text) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  Lo que usa el script de Google antes de reemplazar una pestaña
-- ----------------------------------------------------------------------------
--
--  Sin sesión: el script de Google no la tiene. No revela nada que no sepa ya quien
--  llama; solo responde si ese envío puede pasar y deja constancia del intento.
--
--    sin clave registrada        -> permitido (el establecimiento no está protegido)
--    sin clave / clave distinta  -> bloqueado
--    clave correcta, sin PC      -> se vincula esta PC y pasa
--    clave correcta, esta PC     -> pasa
--    clave correcta, otra PC     -> bloqueado
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
    -- Un Toolkit que no dice qué equipo es no puede quedar vinculado.
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

  -- Se conservan los 100 más recientes por establecimiento.
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

REVOKE ALL ON FUNCTION public.app_send_key_check(text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_check(text, text, text, text, integer) TO anon, authenticated;


-- ----------------------------------------------------------------------------
--  Permiso inicial: los roles de informático reciben el módulo. Después se ajusta
--  por rol en Administración → Roles, como cualquier otro módulo.
-- ----------------------------------------------------------------------------
UPDATE public.roles_config
   SET allowed_modules = COALESCE(allowed_modules, '[]'::jsonb) || '["ADMIN_SEND_KEYS"]'::jsonb
 WHERE upper(role) LIKE '%INFORMATICO%'
   AND NOT (COALESCE(allowed_modules, '[]'::jsonb) ? 'ADMIN_SEND_KEYS');


-- ----------------------------------------------------------------------------
--  Verificación: debe decir TODO CORRECTO y listar los roles con el módulo.
-- ----------------------------------------------------------------------------
SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.sync_send_keys) AS claves_registradas,
       (SELECT string_agg(role, ', ' ORDER BY role) FROM public.roles_config
         WHERE allowed_modules ? 'ADMIN_SEND_KEYS') AS roles_con_el_modulo;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_send_key_check(text, text, text, text, integer);
--  DROP FUNCTION IF EXISTS public.app_send_key_revoke(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_send_key_rebind(uuid, bigint);
--  DROP FUNCTION IF EXISTS public.app_send_key_ignore(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_send_key_generate(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_send_key_history(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_send_keys_overview(uuid);
--  DROP FUNCTION IF EXISTS public.app_send_key_hash(text);
--  DROP FUNCTION IF EXISTS public.app_send_key_new_secret(text);
--  DROP FUNCTION IF EXISTS public.app_send_keys_assert_code(uuid, text);
--  DROP FUNCTION IF EXISTS public.app_send_keys_caller(uuid);
--  DROP TABLE IF EXISTS public.sync_send_attempts;
--  DROP TABLE IF EXISTS public.sync_send_keys;
