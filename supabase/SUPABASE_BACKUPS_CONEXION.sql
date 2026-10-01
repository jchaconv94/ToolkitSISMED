-- ============================================================================
--  BACKUPS SISMED · ETAPA 1 - Conexión inmediata con las PC (piloto)
-- ============================================================================
--
--  QUÉ RESUELVE
--
--  Para pedir un backup y que la PC responda al instante, el Toolkit mantiene una
--  conexión abierta con el servicio «sismed-conexion» de Cloudflare. Ese servicio no
--  guarda usuarios ni claves: antes de aceptar a alguien le pregunta a Supabase con las
--  funciones de este archivo.
--
--    - Una PC solo se conecta si su establecimiento tiene CLAVE DE ENVÍO, la clave es la
--      vigente y es la PC vinculada (la misma regla de Claves de envío).
--    - Mientras dure el piloto, además, el establecimiento tiene que estar en
--      `backup_pilot_codes`. Las demás PC ni siquiera intentan conectarse.
--    - La web se conecta con la sesión del usuario y solo ve las PC de su jurisdicción.
--
--  CÓMO EJECUTARLO
--
--    Pega el archivo completo en el SQL Editor de Supabase y ejecútalo. Es idempotente.
--    Requiere `SUPABASE_CLAVES_DE_ENVIO.sql` y `SUPABASE_CLAVE_ENVIO_SCRIPT.sql`.
--
--    Para agregar o quitar establecimientos del piloto:
--      INSERT INTO public.backup_pilot_codes (code) VALUES ('030S05') ON CONFLICT DO NOTHING;
--      DELETE FROM public.backup_pilot_codes WHERE code = '030S05';
--
--  REVERSIÓN al final del archivo.
-- ============================================================================


-- Establecimientos del piloto. Nadie la lee ni escribe directamente.
CREATE TABLE IF NOT EXISTS public.backup_pilot_codes (
  code     text PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backup_pilot_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_pilot_codes FROM anon, authenticated;

-- Piloto inicial: el almacén de Bellavista.
INSERT INTO public.backup_pilot_codes (code) VALUES ('030S05') ON CONFLICT DO NOTHING;


-- ¿Debe este Toolkit abrir la conexión? Consulta barata que el Toolkit hace de vez en
-- cuando para no intentar conectarse en vano. Devuelve la lista de códigos habilitados.
CREATE OR REPLACE FUNCTION public.app_backup_pc_enabled(p_codes text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(k.code ORDER BY k.code), '{}')
  FROM public.sync_send_keys k
  JOIN public.backup_pilot_codes p ON p.code = k.code
  WHERE k.code = ANY (SELECT upper(trim(c)) FROM unnest(COALESCE(p_codes, '{}')) c LIMIT 20);
$$;

REVOKE ALL ON FUNCTION public.app_backup_pc_enabled(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_pc_enabled(text[]) TO anon, authenticated;


-- La usa el servicio de Cloudflare al conectarse una PC. p_items como en
-- app_send_key_verify: [{"code": "030S05", "key": "030S05-XXXX-XXXX-XXXX"}, ...].
-- Devuelve solo los códigos aceptados, con su UNGET y nombre:
--   [{"code": "030S05", "ungetId": "...", "name": "ALMACÉN BELLAVISTA"}]
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
  JOIN public.backup_pilot_codes p ON p.code = e.code
  JOIN public.facilities f ON upper(f.code) = e.code
  WHERE (e.r->>'protegido')::boolean AND (e.r->>'permitido')::boolean;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_pc_auth(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_pc_auth(jsonb, text) TO anon, authenticated;


-- La usa el servicio de Cloudflare al conectarse la web. Mismo permiso y jurisdicción
-- que Claves de envío. Devuelve {"username", "isAdmin", "ungetIds": [...]}.
CREATE OR REPLACE FUNCTION public.app_backup_web_auth(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        record;
  v_ungets jsonb;
BEGIN
  SELECT * INTO c FROM public.app_send_keys_caller(p_token);

  IF c.is_admin THEN
    v_ungets := '[]'::jsonb;
  ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT f.unget_id::text), '[]'::jsonb) INTO v_ungets
    FROM public.facilities f
    WHERE f.unget_id IS NOT NULL
      AND upper(f.code) ~ '^([0-9]{5}|[0-9A-Z]{6})$'
      AND public.app_place_in_scope(c.personnel_id, f.code, NULL, NULL, NULL, NULL);
  END IF;

  RETURN jsonb_build_object('username', c.username, 'isAdmin', c.is_admin, 'ungetIds', v_ungets);
END;
$$;

REVOKE ALL ON FUNCTION public.app_backup_web_auth(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_backup_web_auth(uuid) TO anon, authenticated;


SELECT 'TODO CORRECTO' AS resultado,
       (SELECT count(*) FROM public.backup_pilot_codes) AS establecimientos_en_piloto;


-- ============================================================================
--  REVERSIÓN (no ejecutar salvo para deshacer)
-- ============================================================================
--  DROP FUNCTION IF EXISTS public.app_backup_web_auth(uuid);
--  DROP FUNCTION IF EXISTS public.app_backup_pc_auth(jsonb, text);
--  DROP FUNCTION IF EXISTS public.app_backup_pc_enabled(text[]);
--  DROP TABLE IF EXISTS public.backup_pilot_codes;
