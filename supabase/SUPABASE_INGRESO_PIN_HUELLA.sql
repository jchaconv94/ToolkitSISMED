-- ============================================================================
--  INGRESO CON PIN (PC) O HUELLA (CELULAR)
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    Además de usuario y contraseña, cada persona puede activar en su equipo:
--      - en la PC, un PIN propio de Toolkit de 4 dígitos;
--      - en el celular, la huella (la comprueba el propio teléfono).
--
--  CÓMO FUNCIONA
--
--    Al activarlo (con la sesión abierta), el equipo genera una llave larga al
--    azar y la guarda en el navegador. Aquí solo se guarda su huella digital
--    criptográfica (SHA-256) y, si es PIN, el PIN cifrado con bcrypt. La
--    contraseña nunca se guarda en el equipo.
--
--    Para entrar, el equipo manda su llave (y el PIN). Si coinciden, se crea una
--    sesión igual que con `app_login`.
--
--    - 5 PIN equivocados seguidos bloquean ese equipo: hay que volver a entrar
--      con la contraseña y activarlo de nuevo.
--    - Cambiar la contraseña desactiva todos los equipos de esa persona.
--    - Un usuario desactivado no entra por ningún camino.
--    - Cada persona ve y quita sus equipos desde su Perfil.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es
--    idempotente. Requiere `SUPABASE_SEGURIDAD_APLICAR_ESTO.sql` (sesiones).
--    Al final debe aparecer "TODO CORRECTO".
--
--    La aplicación funciona sin este script: sin él, simplemente no ofrece el
--    PIN ni la huella. Se puede desplegar primero y ejecutar esto después.
--
--  REVERSIÓN al final del archivo.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- Un registro por equipo donde alguien activó el PIN o la huella.
CREATE TABLE IF NOT EXISTS public.app_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text NOT NULL REFERENCES public.users (username) ON DELETE CASCADE ON UPDATE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('pin', 'huella')),
  device_name     text CHECK (char_length(device_name) <= 80),
  secret_hash     text NOT NULL,            -- SHA-256 de la llave del equipo
  pin_hash        text,                     -- bcrypt del PIN (solo kind = 'pin')
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS app_devices_username_idx ON public.app_devices (username);

ALTER TABLE public.app_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_devices FROM anon, authenticated;


-- Activar el PIN o la huella en este equipo. Exige sesión válida.
-- Devuelve el id del equipo, que el navegador guarda junto con su llave.
CREATE OR REPLACE FUNCTION public.app_device_register(
  p_token       uuid,
  p_kind        text,
  p_device_name text,
  p_secret      text,
  p_pin         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_username text;
  v_id       uuid;
BEGIN
  v_username := public.app_session_user(p_token);
  IF v_username IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  IF p_kind NOT IN ('pin', 'huella') THEN
    RAISE EXCEPTION 'Tipo de acceso no válido.';
  END IF;
  IF p_secret IS NULL OR length(p_secret) < 32 THEN
    RAISE EXCEPTION 'La llave del equipo no es válida.';
  END IF;
  IF p_kind = 'pin' AND (p_pin IS NULL OR p_pin !~ '^[0-9]{4}$') THEN
    RAISE EXCEPTION 'El PIN debe tener 4 dígitos.';
  END IF;

  INSERT INTO public.app_devices (username, kind, device_name, secret_hash, pin_hash)
  VALUES (
    v_username,
    p_kind,
    left(nullif(trim(p_device_name), ''), 80),
    encode(digest(p_secret, 'sha256'), 'hex'),
    CASE WHEN p_kind = 'pin' THEN crypt(p_pin, gen_salt('bf', 10)) END
  )
  RETURNING id INTO v_id;

  -- Hasta 5 equipos por persona: se retiran los más antiguos.
  DELETE FROM public.app_devices
  WHERE id IN (
    SELECT id FROM public.app_devices
    WHERE username = v_username
    ORDER BY created_at DESC
    OFFSET 5
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.app_device_register(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_device_register(uuid, text, text, text, text) TO anon, authenticated;


-- Entrar con el equipo. No lanza errores: devuelve un JSON con `ok`, porque un
-- error desharía el conteo de PIN equivocados.
--   { ok: true,  token, username }
--   { ok: false, reason: 'equipo' | 'bloqueado' | 'pin' | 'usuario', remaining? }
CREATE OR REPLACE FUNCTION public.app_device_login(
  p_device_id uuid,
  p_secret    text,
  p_pin       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  d       public.app_devices%ROWTYPE;
  v_token uuid;
  v_max   constant integer := 5;
BEGIN
  DELETE FROM public.app_sessions WHERE expires_at < now();

  SELECT * INTO d FROM public.app_devices WHERE id = p_device_id FOR UPDATE;

  IF NOT FOUND OR p_secret IS NULL
     OR d.secret_hash <> encode(digest(p_secret, 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'equipo');
  END IF;

  IF d.locked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bloqueado');
  END IF;

  IF d.kind = 'pin' AND (p_pin IS NULL OR crypt(p_pin, d.pin_hash) <> d.pin_hash) THEN
    UPDATE public.app_devices
    SET failed_attempts = failed_attempts + 1,
        locked_at = CASE WHEN failed_attempts + 1 >= v_max THEN now() END
    WHERE id = d.id;
    IF d.failed_attempts + 1 >= v_max THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bloqueado');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'pin', 'remaining', v_max - d.failed_attempts - 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.username = d.username AND u.is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'usuario');
  END IF;

  UPDATE public.app_devices
  SET failed_attempts = 0, last_used_at = now()
  WHERE id = d.id;

  INSERT INTO public.app_sessions (username) VALUES (d.username) RETURNING token INTO v_token;

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'username', d.username);
END;
$$;

REVOKE ALL ON FUNCTION public.app_device_login(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_device_login(uuid, text, text) TO anon, authenticated;


-- Mis equipos activados (para el Perfil).
CREATE OR REPLACE FUNCTION public.app_device_list(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_username text;
BEGIN
  v_username := public.app_session_user(p_token);
  IF v_username IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',         d.id,
      'kind',       d.kind,
      'deviceName', d.device_name,
      'createdAt',  d.created_at,
      'lastUsedAt', d.last_used_at,
      'locked',     d.locked_at IS NOT NULL
    ) ORDER BY d.created_at DESC)
    FROM public.app_devices d
    WHERE d.username = v_username
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.app_device_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_device_list(uuid) TO anon, authenticated;


-- Quitar uno de mis equipos.
CREATE OR REPLACE FUNCTION public.app_device_remove(p_token uuid, p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_username text;
BEGIN
  v_username := public.app_session_user(p_token);
  IF v_username IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida o expirada. Vuelva a iniciar sesión.';
  END IF;
  DELETE FROM public.app_devices WHERE id = p_device_id AND username = v_username;
END;
$$;

REVOKE ALL ON FUNCTION public.app_device_remove(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_device_remove(uuid, uuid) TO anon, authenticated;


-- Cambiar la contraseña desactiva todos los equipos de esa persona.
CREATE OR REPLACE FUNCTION public.app_devices_on_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    DELETE FROM public.app_devices WHERE username = NEW.username;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_devices_password_change ON public.users;
CREATE TRIGGER app_devices_password_change
  AFTER UPDATE OF password_hash ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.app_devices_on_password_change();


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.app_devices) AS equipos_activados;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP TRIGGER IF EXISTS app_devices_password_change ON public.users;
--  DROP FUNCTION IF EXISTS public.app_devices_on_password_change();
--  DROP FUNCTION IF EXISTS public.app_device_remove(uuid, uuid);
--  DROP FUNCTION IF EXISTS public.app_device_list(uuid);
--  DROP FUNCTION IF EXISTS public.app_device_login(uuid, text, text);
--  DROP FUNCTION IF EXISTS public.app_device_register(uuid, text, text, text, text);
--  DROP TABLE IF EXISTS public.app_devices;
