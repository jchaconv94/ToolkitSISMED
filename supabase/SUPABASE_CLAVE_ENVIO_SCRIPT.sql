-- ============================================================================
--  CLAVE DE ENVÍO - Verificación desde el script de Google (Apps Script v3)
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  El Toolkit verifica la clave antes de enviar, pero el script de Google que recibe el
--  stock no verificaba nada: quien conociera su dirección podía mandarle datos sin usar el
--  Toolkit y reemplazar la pestaña de un establecimiento con clave.
--
--  Con el script v3, antes de escribir la pestaña de un establecimiento con clave, el
--  script pregunta aquí si la clave y la PC que vienen en el envío son las vigentes.
--
--  La consulta SOLO LEE: no vincula PC ni anota intentos. Eso lo sigue haciendo el Toolkit
--  (`app_send_key_check`) justo antes de enviar, así que cuando el envío llega al script
--  la PC ya está vinculada.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_CLAVES_DE_ENVIO.sql` (ya aplicado).
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- p_items: [{"code": "030S05", "key": "030S05-XXXX-XXXX-XXXX"}, ...] (máximo 60).
-- Devuelve {"030S05": {"protegido": true, "permitido": false, "motivo": "OTRO_EQUIPO"}, ...}
CREATE OR REPLACE FUNCTION public.app_send_key_verify(
  p_items     jsonb,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device text := NULLIF(left(trim(COALESCE(p_device_id, '')), 120), '');
  v_result jsonb := '{}'::jsonb;
  item     jsonb;
  v_code   text;
  v_key    text;
  k        record;
  v_motivo text;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN v_result;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LIMIT 60 LOOP
    v_code := upper(trim(COALESCE(item->>'code', '')));
    v_key := NULLIF(trim(COALESCE(item->>'key', '')), '');
    CONTINUE WHEN v_code = '' OR v_code !~ '^[0-9A-Z]{5,6}$';

    SELECT key_hash, device_id INTO k FROM public.sync_send_keys WHERE code = v_code;
    IF NOT FOUND THEN
      v_result := v_result || jsonb_build_object(v_code, jsonb_build_object('protegido', false, 'permitido', true));
      CONTINUE;
    END IF;

    IF v_key IS NULL THEN
      v_motivo := 'SIN_CLAVE';
    ELSIF public.app_send_key_hash(v_key) <> k.key_hash THEN
      v_motivo := 'CLAVE_INCORRECTA';
    ELSIF v_device IS NULL THEN
      v_motivo := 'OTRO_EQUIPO';
    ELSIF k.device_id IS NULL OR k.device_id = v_device THEN
      -- Sin vincular todavía: la vincula el Toolkit en su consulta, no esta.
      v_motivo := 'ACEPTADO';
    ELSE
      v_motivo := 'OTRO_EQUIPO';
    END IF;

    v_result := v_result || jsonb_build_object(v_code, jsonb_build_object(
      'protegido', true, 'permitido', v_motivo = 'ACEPTADO', 'motivo', v_motivo));
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_send_key_verify(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_send_key_verify(jsonb, text) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.sync_send_keys) AS establecimientos_con_clave;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_send_key_verify(jsonb, text);
