-- ============================================================================
--  SESIÓN MANTENIDA («Mantener sesión iniciada», 2026-10-08)
-- ============================================================================
--
--  QUÉ RESUELVE
--
--    La web ya guarda la sesión en el equipo cuando la casilla «Mantener sesión
--    iniciada» está marcada, y abre sin internet hasta 45 días. Pero el token de
--    sesión que entrega `app_login` vence a las 12 horas: al volver la conexión,
--    la base ya no lo acepta y hay que entrar otra vez.
--
--    Este script alarga el token de una sesión mantenida a 45 días desde la
--    última vez que se usó con internet (la web lo renueva cada vez que abre y
--    cada 6 horas). Si alguien no se conecta en 45 días, vence y entra de nuevo.
--
--  REGLAS
--
--    - Solo se alarga un token vigente de una cuenta activa.
--    - Cerrar sesión lo borra, como siempre.
--    - Desactivar la cuenta lo invalida al instante (ya lo hacía
--      `app_session_user`).
--    - Cambiar la contraseña cierra las sesiones mantenidas de esa persona en
--      todos sus equipos (igual que ya desactiva su PIN y su huella).
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es
--    idempotente. Requiere `SUPABASE_SEGURIDAD_APLICAR_ESTO.sql` (sesiones).
--    La web funciona sin él: solo que, con internet, pide entrar cada 12 horas.
-- ============================================================================


ALTER TABLE public.app_sessions ADD COLUMN IF NOT EXISTS kept boolean NOT NULL DEFAULT false;


-- Marca la sesión como mantenida y alarga su vencimiento a 45 días desde ahora.
-- Devuelve el nuevo vencimiento, o NULL si el token no vale.
CREATE OR REPLACE FUNCTION public.app_session_keep(p_token uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_expires timestamptz;
BEGIN
  UPDATE public.app_sessions s
  SET kept = true,
      expires_at = now() + interval '45 days'
  FROM public.users u
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND u.username = s.username
    AND u.is_active
  RETURNING s.expires_at INTO v_expires;

  RETURN v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.app_session_keep(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_session_keep(uuid) TO anon, authenticated;


-- Cambiar la contraseña cierra las sesiones mantenidas de esa persona.
CREATE OR REPLACE FUNCTION public.app_sessions_on_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    DELETE FROM public.app_sessions WHERE username = NEW.username AND kept;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_sessions_password_change ON public.users;
CREATE TRIGGER app_sessions_password_change
  AFTER UPDATE OF password_hash ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.app_sessions_on_password_change();


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.app_sessions WHERE kept) AS sesiones_mantenidas;
