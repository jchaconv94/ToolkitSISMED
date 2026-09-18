-- ============================================================================
--  Una conexión por UNGET
--
--  Hoy `unget_configs` tiene 15 filas para 7 UNGET: la del informático de cada
--  UNGET y la de `admin` (San Martín, tres). Nada lo impide, porque la fila se
--  identifica por usuario y por el nombre escrito a mano.
--
--  Esta migración:
--    1. guarda una copia de seguridad de la tabla;
--    2. añade `unget_id` y lo rellena contra `ungets` comparando nombres;
--    3. deja una sola fila por UNGET, la del informático, conservando el enlace
--       de la hoja y la Web App que hubiera en las demás;
--    4. pone un índice único que impide volver a duplicarlas.
--
--  Ejecutada el 18/09/2026: 15 filas quedaron en 7, una por UNGET. Bellavista heredó
--  la hoja que estaba en la fila de admin. San Martin tenia dos informaticos (cfrio y
--  sanmartin) y el usuario eligio conservar la de sanmartin, de ahi el primer criterio
--  de desempate, que pone por delante los usuarios elegidos a mano.
--
--  Ver docs/REVISION_MODELO_CONEXIONES_2026-09-18.md
--
--  IMPORTANTE: el editor SQL de Supabase ejecuta todo lo pegado dentro de una
--  transacción. Ejecute **un paso cada vez** y lea su resultado antes de seguir.
--  Los pasos 3 y 5 no borran nada: solo informan.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PASO 1 - Copia de seguridad. Si algo sale mal, de aquí se restaura.
-- ----------------------------------------------------------------------------

create table if not exists public.unget_configs_respaldo_2026_09_18 as
select * from public.unget_configs;

select count(*) as filas_respaldadas from public.unget_configs_respaldo_2026_09_18;


-- ----------------------------------------------------------------------------
--  PASO 2 - Columna `unget_id`, del mismo tipo que `ungets.id`, y relleno por
--  nombre (sin tildes, sin mayúsculas y sin espacios ni puntuación).
-- ----------------------------------------------------------------------------

do $$
declare
  v_tipo text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_tipo
  from pg_attribute a
  where a.attrelid = 'public.ungets'::regclass and a.attname = 'id';

  execute format('alter table public.unget_configs add column if not exists unget_id %s', v_tipo);
end
$$;

-- Nombre comparable: la misma regla que usa la aplicación en services/ungetConnections.ts
create or replace function public.unget_nombre_comparable(p_nombre text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           translate(lower(coalesce(p_nombre, '')),
                     'áàäâéèëêíìïîóòöôúùüûñ',
                     'aaaaeeeeiiiioooouuuun'),
           '[^a-z0-9]', '', 'g')
$$;

update public.unget_configs c
set unget_id = g.id
from public.ungets g
where c.unget_id is null
  and public.unget_nombre_comparable(c.unget_name) = public.unget_nombre_comparable(g.name);

select count(*) filter (where unget_id is not null) as con_unget,
       count(*) filter (where unget_id is null) as sin_unget,
       count(*) as total
from public.unget_configs;


-- ----------------------------------------------------------------------------
--  PASO 3 - Revisión: conexiones que no se pudieron emparejar con ninguna UNGET
--  registrada. NO SIGA si esto devuelve filas: esas UNGET hay que registrarlas
--  en Administración → Establecimientos, o corregirles el nombre.
-- ----------------------------------------------------------------------------

select id, unget_name, username
from public.unget_configs
where unget_id is null
order by unget_name;


-- ----------------------------------------------------------------------------
--  PASO 4 - Consolidación. Sobrevive una fila por UNGET:
--    1º la del informático de esa UNGET (según Establecimientos),
--    2º si hay varios, la que tenga hoja de cálculo,
--    3º y en último caso, la más antigua.
--  La superviviente se queda con el enlace de la hoja y con la Web App que
--  hubiera en cualquiera de las otras. Después se borran las demás.
-- ----------------------------------------------------------------------------

with clasificadas as (
  select c.id,
         c.unget_id,
         c.spreadsheet_id,
         c.url,
         (p.unget_id is not distinct from c.unget_id) as es_del_informatico,
         (c.spreadsheet_id is not null) as tiene_hoja,
         row_number() over (
           partition by c.unget_id
           order by (c.username = any (array['sanmartin'])) desc,
                    (p.unget_id is not distinct from c.unget_id) desc,
                    (c.spreadsheet_id is not null) desc,
                    c.id
         ) as puesto
  from public.unget_configs c
  left join public.users u on u.username = c.username
  left join public.personnel p on p.id = u.personnel_id
  where c.unget_id is not null
),
rescatado as (
  select unget_id,
         max(spreadsheet_id) filter (where spreadsheet_id is not null) as hoja,
         max(url) filter (where url is not null and url not like 'sheets://%') as web_app
  from public.unget_configs
  where unget_id is not null
  group by unget_id
)
update public.unget_configs destino
set spreadsheet_id = coalesce(destino.spreadsheet_id, r.hoja),
    url = coalesce(nullif(destino.url, ''), r.web_app, destino.url)
from clasificadas cl
join rescatado r on r.unget_id = cl.unget_id
where destino.id = cl.id and cl.puesto = 1;

with clasificadas as (
  select c.id,
         row_number() over (
           partition by c.unget_id
           order by (c.username = any (array['sanmartin'])) desc,
                    (p.unget_id is not distinct from c.unget_id) desc,
                    (c.spreadsheet_id is not null) desc,
                    c.id
         ) as puesto
  from public.unget_configs c
  left join public.users u on u.username = c.username
  left join public.personnel p on p.id = u.personnel_id
  where c.unget_id is not null
)
delete from public.unget_configs
where id in (select id from clasificadas where puesto > 1);


-- ----------------------------------------------------------------------------
--  PASO 5 - Comprobación. Debe quedar una fila por UNGET, y Bellavista debe
--  conservar su hoja.
-- ----------------------------------------------------------------------------

select g.name as unget,
       c.username as informatico,
       (c.spreadsheet_id is not null) as tiene_hoja,
       (c.url is not null and c.url not like 'sheets://%') as tiene_web_app
from public.unget_configs c
join public.ungets g on g.id = c.unget_id
order by g.name;


-- ----------------------------------------------------------------------------
--  PASO 6 - El índice único: a partir de aquí la base impide dos conexiones de
--  la misma UNGET, venga de donde venga.
-- ----------------------------------------------------------------------------

create unique index if not exists unget_configs_unget_id_unico
  on public.unget_configs (unget_id)
  where unget_id is not null;


-- ----------------------------------------------------------------------------
--  Si hiciera falta deshacer el paso 4 (antes de crear el índice):
--
--    delete from public.unget_configs;
--    insert into public.unget_configs
--    select * from public.unget_configs_respaldo_2026_09_18;
--
--  La copia se puede borrar cuando todo esté verificado:
--    drop table public.unget_configs_respaldo_2026_09_18;
-- ----------------------------------------------------------------------------
