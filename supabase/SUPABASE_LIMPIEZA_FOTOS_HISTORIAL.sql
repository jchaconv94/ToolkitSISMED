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
--  Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

-- 1) Cuánto ocupa ahora (para comparar después).
select pg_size_pretty(pg_total_relation_size('public.stock_sync_history')) as antes;

-- 2) Poda: conserva intacta la foto MÁS RECIENTE de cada establecimiento,
--    que es la que la aplicación usa para detectar los próximos movimientos.
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

-- 3) Postgres no devuelve el espacio al disco por sí solo: hasta aquí lo reutiliza,
--    pero el tamaño informado sigue igual. Esto lo compacta (bloquea la tabla unos
--    segundos; con pocos MB es inmediato).
vacuum full public.stock_sync_history;

-- 4) Cuánto ocupa después.
select pg_size_pretty(pg_total_relation_size('public.stock_sync_history')) as despues;

-- Comprobación opcional: cuántos registros conservan foto. Debería quedar
-- aproximadamente uno por establecimiento.
-- select count(*) filter (where changes_metadata::jsonb ? 'items_snapshot') as con_foto,
--        count(*) as total
-- from public.stock_sync_history
-- where changes_metadata is not null and left(btrim(changes_metadata), 1) = '{';
