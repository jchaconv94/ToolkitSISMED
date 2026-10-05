-- ============================================================================
--  DNI del personal: solo lo cambian ADMIN y el personal de nivel DIRESA, OGESS o UNGET
--  (2026-10-05)
-- ============================================================================
--
--  El Perfil ya no deja que cada usuario cambie su propio DNI, pero la pantalla no es
--  una defensa: la clave `anon` es pública y `personnel` se puede actualizar desde
--  fuera de la aplicación. Este disparador lo comprueba en la base.
--
--  Regla: si un UPDATE cambia `personnel.dni`, quien hace la petición (dueño del token
--  de la cabecera `x-session-token`) debe ser ADMIN o tener un rol con nivel de
--  jurisdicción GLOBAL, DIRESA, OGESS o UNGET (roles_config.jurisdiction_level).
--  Vale tanto para la escritura directa como para Gestión de Usuarios
--  (`app_manage_save_user`, que también llega con la cabecera).
--
--  Lo que se ejecuta desde el panel de Supabase (sin cabeceras de petición) no se
--  bloquea. Altas nuevas (INSERT) tampoco.
--
--  Se puede ejecutar más de una vez.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_guard_personnel_dni()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_headers text := NULLIF(current_setting('request.headers', true), '');
  v_ok      boolean;
BEGIN
  IF NEW.dni IS NOT DISTINCT FROM OLD.dni THEN
    RETURN NEW;
  END IF;

  -- Sin petición HTTP (panel de Supabase, tareas internas): no se bloquea.
  IF v_headers IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT upper(COALESCE(u.role, '')) = 'ADMIN'
         OR upper(COALESCE(rc.jurisdiction_level, '')) IN ('GLOBAL', 'DIRESA', 'OGESS', 'UNGET')
    INTO v_ok
  FROM public.app_sessions s
  JOIN public.users u ON u.username = s.username
  LEFT JOIN public.roles_config rc ON rc.role = u.role
  WHERE s.expires_at > now()
    AND u.is_active
    AND s.token::text = COALESCE(v_headers::json ->> 'x-session-token', '')
  LIMIT 1;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Solo el administrador o el personal de DIRESA, OGESS o UNGET puede cambiar el DNI.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.app_guard_personnel_dni() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS personnel_dni_guard ON public.personnel;
CREATE TRIGGER personnel_dni_guard
  BEFORE UPDATE OF dni ON public.personnel
  FOR EACH ROW
  EXECUTE FUNCTION public.app_guard_personnel_dni();
