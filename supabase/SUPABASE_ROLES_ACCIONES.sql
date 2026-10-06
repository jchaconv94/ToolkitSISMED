-- ============================================================================
--  Acciones por rol (2026-10-06)
--
--  Configuración de Roles ya no solo activa módulos: también puede apagar acciones dentro de
--  cada módulo (crear, editar, eliminar, exportar…). Se guarda la lista de acciones
--  **negadas** de cada rol, así los roles que ya existen conservan todas sus acciones
--  mientras nadie toque sus interruptores.
--
--  Formato de cada acción: "MODULO:accion", por ejemplo "ADMIN_USERS:delete".
--  El catálogo vive en la web, en services/moduleActions.ts.
--
--  Es idempotente: se puede ejecutar más de una vez.
--  Orden: ejecutar este SQL y después publicar la web (la web sigue funcionando sin él, pero
--  no puede guardar las acciones hasta que exista la función).
-- ============================================================================

ALTER TABLE public.roles_config
  ADD COLUMN IF NOT EXISTS denied_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Guardar las acciones negadas de un rol. Solo una sesión de ADMIN, como el resto de la
-- configuración de roles (app_admin_save_role_config).
CREATE OR REPLACE FUNCTION public.app_admin_save_role_actions(
  p_token          uuid,
  p_role           text,
  p_denied_actions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.app_require_admin(p_token);

  IF p_denied_actions IS NULL OR jsonb_typeof(p_denied_actions) <> 'array' THEN
    RAISE EXCEPTION 'La lista de acciones debe ser un arreglo';
  END IF;

  UPDATE public.roles_config
     SET denied_actions = p_denied_actions
   WHERE role = p_role;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El rol % no existe', p_role;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.app_admin_save_role_actions(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_save_role_actions(uuid, text, jsonb) TO anon, authenticated;

-- La columna se lee como el resto de roles_config (la app ya puede leer la tabla).

-- Comprobación
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'roles_config' AND column_name = 'denied_actions') AS columna_creada,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'app_admin_save_role_actions') AS funcion_creada;
