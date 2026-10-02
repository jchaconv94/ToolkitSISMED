-- ============================================================================
--  BACKUPS SISMED · Solo PC ya vinculadas
-- ============================================================================
--
--  QUÉ CORRIGE
--
--  `app_send_key_verify` acepta una clave que todavía no está vinculada a ninguna PC
--  (la vincula el Toolkit en su primer envío de stock). Para el stock está bien, pero
--  en Backups abría un hueco: si la clave de la IPRESS A llegaba por error a la PC de
--  la IPRESS B antes de que A la usara, la PC de B se conectaba como A, y un pedido de
--  backup de A descargaba el SISMED de B con el nombre de A.
--
--  Desde este script, Backups solo acepta la PC que ya está vinculada a la clave, es
--  decir, la que ya envió su stock con ella. La PC de B nunca se vincula a la clave de A
--  (no tiene stock de A), así que nunca entra. Una PC con clave recién puesta aparece
--  en Backups después de su primer envío de stock.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere SUPABASE_BACKUPS_ABRIR_REGION.sql (que ya trae esta misma versión).
--
--  REVERSIÓN: volver a ejecutar SUPABASE_BACKUPS_ABRIR_REGION.sql de antes de este cambio.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.app_backup_pc_auth(p_items jsonb, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_verify jsonb;
  v_result jsonb;
BEGIN
  v_verify := public.app_send_key_verify(p_items, p_device_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', upper(f.code), 'ungetId', f.unget_id::text, 'name', f.name) ORDER BY f.code), '[]'::jsonb)
    INTO v_result
  FROM jsonb_each(v_verify) e(code, r)
  JOIN public.facilities f ON upper(f.code) = e.code
  -- Solo la PC ya vinculada: una clave sin vincular que llegó a otra PC por error no basta.
  JOIN public.sync_send_keys k ON k.code = e.code AND k.device_id = left(trim(p_device_id), 120)
  WHERE public.app_backup_code_open(e.code)
    AND (e.r->>'protegido')::boolean AND (e.r->>'permitido')::boolean;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_pc_auth(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_pc_auth(jsonb, text) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.sync_send_keys WHERE device_id IS NOT NULL) AS claves_vinculadas,
       (SELECT count(*) FROM public.sync_send_keys WHERE device_id IS NULL) AS claves_sin_vincular;
