-- ============================================================================
--  RETIRO DEL MÓDULO DE INMUNIZACIONES (2026-10-03)
-- ============================================================================
--
--  QUÉ HACE
--
--  Inmunizaciones se quitó de la web porque se está construyendo como un sistema
--  aparte, con su propia base. Este script borra lo que el módulo dejó en esta base:
--
--    - Todas las tablas cuyo nombre empieza con `immunization_` (catálogo, inventario
--      inicial, capas de stock, movimientos, ingresos, distribuciones, devoluciones,
--      reajustes, cierres mensuales y orígenes). Con ellas se van sus políticas e
--      índices.
--    - Las funciones cuyo nombre contiene `immunization` (aplicar ingreso, enviar y
--      recibir distribución, aplicar reajuste).
--    - Los permisos IMMUNIZATION_* de cada rol en `roles_config`.
--
--  NO toca: usuarios, roles, establecimientos, UNGET, las funciones de sesión y de
--  ámbito (las usan otras tablas), conexiones de stock, claves de envío ni backups.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Se puede
--    ejecutar dos veces. Todo va en una transacción: si algo falla, no borra nada.
--
--  SIN REVERSIÓN: los datos de inmunizaciones de esta base se pierden.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  -- Funciones primero, por su firma exacta.
  FOR r IN
    SELECT p.oid::regprocedure AS firma
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname ILIKE '%immunization%'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.firma);
    RAISE NOTICE 'Función borrada: %', r.firma;
  END LOOP;

  -- Tablas: CASCADE solo resuelve las claves entre ellas mismas.
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'immunization\_%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    RAISE NOTICE 'Tabla borrada: %', r.tablename;
  END LOOP;
END
$$;

UPDATE public.roles_config
   SET allowed_modules = (
         SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
         FROM jsonb_array_elements(allowed_modules) m
         WHERE m #>> '{}' NOT LIKE 'IMMUNIZATION\_%')
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(allowed_modules) m
               WHERE m #>> '{}' LIKE 'IMMUNIZATION\_%');

COMMIT;

SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM pg_tables
         WHERE schemaname = 'public' AND tablename LIKE 'immunization\_%') AS tablas_que_quedan,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname ILIKE '%immunization%') AS funciones_que_quedan,
       (SELECT count(*) FROM public.roles_config r
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r.allowed_modules) m
                       WHERE m #>> '{}' LIKE 'IMMUNIZATION\_%')) AS roles_con_permisos_viejos;
