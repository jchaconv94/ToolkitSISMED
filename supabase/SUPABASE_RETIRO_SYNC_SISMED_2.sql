-- ============================================================================
--  RETIRO DE SYNC SISMED 2.0, MONITOREO DE STOCK Y MIGRACIÓN (2026-10-02)
-- ============================================================================
--
--  QUÉ HACE
--
--  Esos tres módulos se quitaron de la web (PR #101) y la herramienta Sync SISMED 2.0
--  del Toolkit (Toolkit-OGM #12). Este script borra lo que dejaron en la base:
--
--    - Las tablas del Sync 2.0: `sync_runs` (historial de envíos), `sync_installations`
--      (PC autorizadas) y `stock_actual` (el stock que subían esas PC). Ninguna pantalla
--      las lee desde el PR #101. Consulta Stock y Stock SISMED leen de Google Sheets.
--    - Los permisos ADMIN_MIGRATION, ADMIN_SYNC_DEVICES y STOCK_MONITORING de cada rol
--      en `roles_config`.
--
--  NO toca: `stock_sync_history` (el historial de Consulta Stock), `unget_configs`,
--  `facility_stock_assignments`, las claves de envío ni los backups.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Se puede
--    ejecutar dos veces sin problema. Si alguna otra cosa de la base depende de esas
--    tablas, se detiene con un error y no borra nada: en ese caso, avisa.
--
--  SIN REVERSIÓN: el contenido de esas tablas se pierde. Es una copia del stock que ya
--  no se actualiza desde que se dejó de usar el Sync 2.0.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.sync_runs;
DROP TABLE IF EXISTS public.sync_installations;
DROP TABLE IF EXISTS public.stock_actual;

UPDATE public.roles_config
   SET allowed_modules = allowed_modules - 'ADMIN_MIGRATION' - 'ADMIN_SYNC_DEVICES' - 'STOCK_MONITORING'
 WHERE allowed_modules ?| ARRAY['ADMIN_MIGRATION', 'ADMIN_SYNC_DEVICES', 'STOCK_MONITORING'];

COMMIT;

SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename IN ('sync_runs', 'sync_installations', 'stock_actual')) AS tablas_que_quedan,
       (SELECT count(*) FROM public.roles_config
         WHERE allowed_modules ?| ARRAY['ADMIN_MIGRATION', 'ADMIN_SYNC_DEVICES', 'STOCK_MONITORING']) AS roles_con_permisos_viejos;
