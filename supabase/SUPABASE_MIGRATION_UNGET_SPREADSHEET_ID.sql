-- ============================================================================
--  Consulta Stock - Hoja de cálculo por UNGET
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  Cada UNGET publica su stock con su propia Web App de Apps Script. Google falla
--  con frecuencia al entregar esas respuestas (404 tras 20-60 s), así que las UNGET
--  se quedan en "Conectando con Google Sheets...".
--
--  Leer la pestaña directamente desde Google Sheets responde en ~1 s, pero la web
--  necesita saber QUÉ libro leer. Esta columna guarda ese identificador por UNGET.
--
--  QUÉ NO CAMBIA
--
--  Nada deja de funcionar sin ejecutarlo: sin la columna, la aplicación guarda la
--  configuración igual y sigue usando Apps Script, como hasta ahora.
--
--  ADEMÁS DE ESTO
--
--  Cada UNGET debe compartir su hoja como "Cualquiera con el enlace: Lector" y pegar
--  el enlace en Consulta Stock → Configurar → Hoja de cálculo.
--
--  CÓMO EJECUTARLO
--
--    1. Pega este archivo en el editor SQL de Supabase y ejecútalo. Es idempotente.
--    2. Comprueba el resultado con la consulta del final.
-- ============================================================================

ALTER TABLE public.unget_configs
  ADD COLUMN IF NOT EXISTS spreadsheet_id text;

COMMENT ON COLUMN public.unget_configs.spreadsheet_id IS
  'ID del libro de Google Sheets de la UNGET; habilita la lectura directa sin Apps Script.';

-- ----------------------------------------------------------------------------
--  Comprobación
-- ----------------------------------------------------------------------------

SELECT unget_name, username, spreadsheet_id
FROM public.unget_configs
ORDER BY unget_name;

-- ----------------------------------------------------------------------------
--  REVERSIÓN
-- ----------------------------------------------------------------------------
--
--  ALTER TABLE public.unget_configs DROP COLUMN IF EXISTS spreadsheet_id;
