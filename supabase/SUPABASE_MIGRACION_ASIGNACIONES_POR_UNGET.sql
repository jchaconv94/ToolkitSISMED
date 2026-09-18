-- ============================================================================
--  Las asignaciones IPRESS ↔ hoja dejan de colgar de una URL
--
--  `facility_stock_assignments` guarda `sheet_url` con la URL de la conexión de
--  la UNGET. Esa URL cambia cuando la UNGET configura su hoja y pasa a lectura
--  directa (`sheets://<id>`), cuando vuelve a desplegar su Web App o cuando
--  cambia de libro. Al cambiar, la asignación queda huérfana sin avisar: el
--  establecimiento pierde su nombre asignado y sus columnas visibles, y sus
--  usuarios dejan de ver el stock.
--
--  Esta migración añade `unget_id` y lo rellena **ahora**, mientras las URL
--  todavía coinciden. Después de esto, cambiar la conexión de una UNGET deja de
--  romper sus asignaciones.
--
--  Ver docs/REVISION_MODELO_CONEXIONES_2026-09-18.md (apartado 2.3)
--
--  IMPORTANTE: ejecute un paso cada vez y lea su resultado antes de seguir.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PASO 1 - Copia de seguridad.
-- ----------------------------------------------------------------------------

create table if not exists public.facility_stock_assignments_respaldo_2026_09_18 as
select * from public.facility_stock_assignments;

select count(*) as filas_respaldadas
from public.facility_stock_assignments_respaldo_2026_09_18;


-- ----------------------------------------------------------------------------
--  PASO 2 - Cuántas asignaciones hay y cuántas apuntan a una URL que ya no
--  corresponde a ninguna conexión. Si esto último es mayor que cero, esas
--  asignaciones ya estaban rotas de antes.
-- ----------------------------------------------------------------------------

select count(*) as asignaciones,
       count(*) filter (
         where not exists (
           select 1 from public.unget_configs c where c.url = a.sheet_url
         )
       ) as sin_conexion
from public.facility_stock_assignments a;


-- ----------------------------------------------------------------------------
--  PASO 3 - Columna `unget_id`, del mismo tipo que `ungets.id`, rellenada desde
--  la conexión que hoy tiene esa URL.
-- ----------------------------------------------------------------------------

do $$
declare
  v_tipo text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_tipo
  from pg_attribute a
  where a.attrelid = 'public.ungets'::regclass and a.attname = 'id';

  execute format('alter table public.facility_stock_assignments add column if not exists unget_id %s', v_tipo);
end
$$;

update public.facility_stock_assignments a
set unget_id = c.unget_id
from public.unget_configs c
where a.unget_id is null
  and c.url = a.sheet_url
  and c.unget_id is not null;

select count(*) filter (where unget_id is not null) as con_unget,
       count(*) filter (where unget_id is null) as sin_unget,
       count(*) as total
from public.facility_stock_assignments;


-- ----------------------------------------------------------------------------
--  PASO 3b - Rescate desde la copia de seguridad de las conexiones.
--
--  Al consolidar (SUPABASE_MIGRACION_CONEXION_POR_UNGET.sql) se borraron filas
--  duplicadas, así que hay asignaciones que apuntan a la URL de una conexión que
--  ya no existe. La copia conserva esas URL con su nombre de UNGET, que es
--  suficiente para recuperar a cuál pertenecían.
-- ----------------------------------------------------------------------------

update public.facility_stock_assignments a
set unget_id = g.id
from public.unget_configs_respaldo_2026_09_18 r
join public.ungets g
  on public.unget_nombre_comparable(g.name) = public.unget_nombre_comparable(r.unget_name)
where a.unget_id is null
  and r.url = a.sheet_url;

select count(*) filter (where unget_id is not null) as con_unget,
       count(*) filter (where unget_id is null) as sin_unget
from public.facility_stock_assignments;


-- ----------------------------------------------------------------------------
--  PASO 4 - Revisión: las que no se pudieron emparejar, con su UNGET deducida
--  del establecimiento. Sirve para decidir si se completan a mano.
-- ----------------------------------------------------------------------------

select a.id,
       a.facility_code,
       f.name as establecimiento,
       g.name as unget_del_establecimiento,
       a.sheet_name,
       a.sheet_url
from public.facility_stock_assignments a
left join public.facilities f on f.code = a.facility_code
left join public.ungets g on g.id = f.unget_id
where a.unget_id is null
order by g.name, a.facility_code;


-- ----------------------------------------------------------------------------
--  PASO 5 (solo si el paso 4 devolvió filas) - Completarlas con la UNGET a la
--  que pertenece el establecimiento, que es la que corresponde salvo excepción.
-- ----------------------------------------------------------------------------

-- update public.facility_stock_assignments a
-- set unget_id = f.unget_id
-- from public.facilities f
-- where a.unget_id is null
--   and f.code = a.facility_code
--   and f.unget_id is not null;


-- ----------------------------------------------------------------------------
--  PASO 6 - Comprobación final: asignaciones por UNGET.
-- ----------------------------------------------------------------------------

select coalesce(g.name, '(sin UNGET)') as unget,
       count(*) as asignaciones
from public.facility_stock_assignments a
left join public.ungets g on g.id = a.unget_id
group by g.name
order by asignaciones desc, unget;


-- ----------------------------------------------------------------------------
--  Para deshacer:
--    delete from public.facility_stock_assignments;
--    insert into public.facility_stock_assignments
--    select * from public.facility_stock_assignments_respaldo_2026_09_18;
-- ----------------------------------------------------------------------------
