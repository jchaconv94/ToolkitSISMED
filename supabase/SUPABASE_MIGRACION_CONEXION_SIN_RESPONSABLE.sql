-- ============================================================================
--  La conexión de una UNGET debe sobrevivir a la cuenta que la mantiene
--  Fecha: 2026-09-21
-- ----------------------------------------------------------------------------
--  `unget_configs.username` apunta a `users.username` con ON DELETE CASCADE y
--  sin ON UPDATE. Eso da dos comportamientos que nadie pidió:
--
--   1. Borrar al informático de una UNGET **borra la conexión de esa UNGET**.
--      No queda huérfana: desaparece, y la UNGET se queda sin stock sin que la
--      aplicación avise de nada.
--   2. Cambiar el nombre de cuenta (`app_update_own_account`) hace
--      `UPDATE users SET username`, que sin ON UPDATE CASCADE la clave ajena
--      rechaza. En pantalla se ve como un fallo sin explicación.
--
--  La conexión es de la UNGET, no de la persona. Así que:
--   - al borrar la cuenta, la fila se queda sin dueño (`username` a NULL) y la
--     adopta el siguiente que la guarde, que es la regla que la aplicación ya
--     aplica a las filas sin dueño;
--   - al renombrar la cuenta, la fila la sigue.
--
--  El tercer caso —cuenta desactivada, que es el habitual cuando alguien deja
--  el puesto— lo resuelve la aplicación, no la base: ver `isConnectionOrphaned`
--  en `services/ungetConnections.ts`.
--
--  Ejecutar por pasos en el editor SQL de Supabase, revisando cada resultado.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PASO 1 - Ver qué hay hoy. Solo lectura.
--
--  Interesa `delete_rule` y `update_rule` de la clave ajena de `unget_configs`
--  sobre `users`. Si ya dicen SET NULL y CASCADE, esta migración está aplicada
--  y no hay nada que hacer.
-- ----------------------------------------------------------------------------

select
  c.conname                as restriccion,
  pg_get_constraintdef(c.oid) as definicion
from pg_constraint c
where c.conrelid = 'public.unget_configs'::regclass
  and c.contype = 'f';


-- ----------------------------------------------------------------------------
--  PASO 2 - Copia de seguridad de la tabla. Si algo sale mal, de aquí se
--  restaura.
-- ----------------------------------------------------------------------------

create table if not exists public.unget_configs_respaldo_2026_09_21 as
select * from public.unget_configs;

select count(*) as filas_respaldadas from public.unget_configs_respaldo_2026_09_21;


-- ----------------------------------------------------------------------------
--  PASO 3 - La columna tiene que admitir NULL, que es lo que quedará cuando se
--  borre la cuenta. Si ya lo admite, esto no hace nada.
-- ----------------------------------------------------------------------------

alter table public.unget_configs alter column username drop not null;


-- ----------------------------------------------------------------------------
--  PASO 4 - Rehacer la clave ajena con las reglas correctas.
--
--  Se busca por catálogo en vez de por nombre fijo: la restricción puede
--  llamarse `unget_configs_username_fkey` o cualquier otra cosa según cómo se
--  creara la tabla.
-- ----------------------------------------------------------------------------

do $$
declare
  v_nombre text;
begin
  select c.conname into v_nombre
  from pg_constraint c
  where c.conrelid = 'public.unget_configs'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.users'::regclass
  limit 1;

  if v_nombre is not null then
    execute format('alter table public.unget_configs drop constraint %I', v_nombre);
  end if;

  alter table public.unget_configs
    add constraint unget_configs_username_fkey
    foreign key (username) references public.users(username)
    on delete set null
    on update cascade;
end $$;


-- ----------------------------------------------------------------------------
--  PASO 5 - Comprobación. Debe decir ON UPDATE CASCADE ON DELETE SET NULL.
-- ----------------------------------------------------------------------------

select
  c.conname                   as restriccion,
  pg_get_constraintdef(c.oid) as definicion
from pg_constraint c
where c.conrelid = 'public.unget_configs'::regclass
  and c.contype = 'f';


-- ----------------------------------------------------------------------------
--  PASO 6 - Diagnóstico: qué conexiones están hoy sin responsable.
--
--  Solo lectura. `estado` dice por qué: la cuenta no existe (quedó de una
--  cuenta borrada antes de esta migración) o está desactivada. Son las que la
--  aplicación marcará «Sin responsable» y permitirá adoptar.
-- ----------------------------------------------------------------------------

select
  c.unget_name,
  c.username                  as responsable,
  case
    when c.username is null then 'sin dueño'
    when u.username is null  then 'la cuenta ya no existe'
    when u.is_active is false then 'la cuenta está desactivada'
    else 'activa'
  end                         as estado,
  c.url
from public.unget_configs c
left join public.users u on u.username = c.username
order by estado, c.unget_name;


-- ============================================================================
--  REVERSIÓN, si hiciera falta volver al comportamiento anterior:
--
--    alter table public.unget_configs drop constraint unget_configs_username_fkey;
--    alter table public.unget_configs
--      add constraint unget_configs_username_fkey
--      foreign key (username) references public.users(username)
--      on delete cascade;
--
--  Y la tabla tal como estaba:
--    delete from public.unget_configs;
--    insert into public.unget_configs
--    select * from public.unget_configs_respaldo_2026_09_21;
-- ============================================================================
