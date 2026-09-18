-- ============================================================================
--  Limpieza única: quitar la foto de stock de los registros ya superados
--  de stock_sync_history.
--
--  Cada registro del historial guarda en changes_metadata una foto completa del
--  stock de esa IPRESS (items_snapshot), de entre 44 y 90 KB. Esa foto solo sirve
--  para compararla con la lectura siguiente: en cuanto hay un registro más nuevo
--  del mismo establecimiento, nunca vuelve a leerse.
--
--  La ventana de historial de la aplicación muestra total_stock, total_value y la
--  lista de movimientos (changes). Nada de eso se toca.
--
--  Desde la versión que incorpora `prunePreviousSnapshot` (services/supabaseClient.ts),
--  la aplicación hace esta poda sola al guardar cada registro nuevo. Este archivo es
--  para limpiar de una vez lo que ya estaba guardado antes.
--
--  IMPORTANTE: el editor SQL de Supabase ejecuta todo lo que le pegas dentro de una
--  transacción, y VACUUM no puede correr ahí ("VACUUM cannot run inside a transaction
--  block"). Si falla, la transacción se deshace entera y el UPDATE tampoco queda
--  aplicado. Por eso cada paso va por separado: pega y ejecuta uno, luego el siguiente.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PASO 1 - Poda. Conserva intacta la foto MÁS RECIENTE de cada establecimiento,
--  que es la que la aplicación usa para detectar los próximos movimientos.
-- ----------------------------------------------------------------------------

update public.stock_sync_history h
set changes_metadata = (h.changes_metadata::jsonb - 'items_snapshot')::text
where h.changes_metadata is not null
  and left(btrim(h.changes_metadata), 1) = '{'
  and h.changes_metadata::jsonb ? 'items_snapshot'
  and h.id <> (
    select h2.id
    from public.stock_sync_history h2
    where h2.establishment_id = h.establishment_id
    order by h2.sync_date desc
    limit 1
  );


-- ----------------------------------------------------------------------------
--  PASO 2 - Comprobación. `con_foto` debería quedar en torno a
--  `establecimientos`: una foto por IPRESS y ninguna más.
-- ----------------------------------------------------------------------------

select count(*) filter (where changes_metadata::jsonb ? 'items_snapshot') as con_foto,
       count(distinct establishment_id) as establecimientos,
       count(*) as registros,
       pg_size_pretty(pg_total_relation_size('public.stock_sync_history')) as tamano
from public.stock_sync_history
where changes_metadata is not null and left(btrim(changes_metadata), 1) = '{';


-- ----------------------------------------------------------------------------
--  PASO 3 (opcional) - Compactar. Postgres reutiliza por dentro el espacio que
--  liberó el paso 1, pero el tamaño informado no baja hasta compactar.
--
--  Ejecutar ESTA LÍNEA SOLA, sin nada más seleccionado. Bloquea la tabla unos
--  segundos (con pocos MB es inmediato), así que mejor cuando nadie sincroniza.
--  Si el editor lo rechaza igualmente, se puede omitir: la tabla ya no crece.
-- ----------------------------------------------------------------------------

vacuum full public.stock_sync_history;
