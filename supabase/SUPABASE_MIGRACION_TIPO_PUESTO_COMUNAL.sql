-- ============================================================================
--  Los puestos comunales pasan a tener su propio tipo
--
--  SISMED numera las farmacias de una IPRESS: `F01` es la principal —que a
--  efectos prácticos es la IPRESS— y de `F02` en adelante son puestos
--  comunales, que aquí se registran como establecimientos propios con códigos
--  como `06528F02`.
--
--  Hasta ahora no existía el tipo, así que se registraban como `PUESTO`
--  (puesto de salud) y se marcaban a mano poniéndoles `P.C.` en la
--  **categoría**, que era un apaño para poder localizarlos después. Esta
--  migración les pone el tipo `PUESTO_COMUNAL`, que ya existe en la
--  aplicación.
--
--  La categoría se deja como está: `P.C.` no es una categoría real de IPRESS
--  (esas son I-1, I-2, …) y solo usted sabe con qué reemplazarla, o si
--  conviene vaciarla. El PASO 6 lo deja preparado, comentado.
--
--  Hay tres formas distintas de escribir esa marca en los datos (`P.C.`, `P.C`
--  y una tercera con un carácter invisible), así que no se comparan textos:
--  se quita todo lo que no sea letra o número y se compara con `PC`. Así
--  entran las tres, y también `p.c.` o `P. C.` si aparecieran.
--
--  `facilities.type` es una columna de texto libre, sin restricción ni enum,
--  así que no hay que alterar el esquema: solo cambian datos.
--
--  IMPORTANTE: ejecute un paso cada vez y lea su resultado antes de seguir.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PASO 1 - Copia de seguridad. No borra ni cambia nada.
-- ----------------------------------------------------------------------------

create table if not exists public.facilities_respaldo_2026_09_21 as
select * from public.facilities;

select count(*) as filas_respaldadas
from public.facilities_respaldo_2026_09_21;


-- ----------------------------------------------------------------------------
--  PASO 2 - Qué se va a cambiar, antes de cambiarlo.
--
--  Lea la lista entera: son los establecimientos que pasarán a
--  `PUESTO_COMUNAL`. La columna `coincide_el_codigo` dice si su código además
--  lo confirma (lleva `F02` o más). Si alguno dice `false`, mírelo con calma
--  antes de seguir: o el código está mal escrito, o ese no es un puesto
--  comunal.
-- ----------------------------------------------------------------------------

select code,
       name,
       type as tipo_actual,
       category as categoria_actual,
       (code ~* '^[0-9]{5}F[0-9]{2}([0-9]{2})?$' and substring(code from 7 for 2) <> '01') as coincide_el_codigo
from public.facilities
where regexp_replace(upper(coalesce(category, '')), '[^A-Z0-9]', '', 'g') = 'PC'
order by code;


-- ----------------------------------------------------------------------------
--  PASO 3 - Al revés: establecimientos cuyo **código** dice que son puestos
--  comunales pero que no llevan la marca `P.C.` en la categoría.
--
--  El PASO 5 también los corrige. Si la lista sale vacía, mejor: quiere decir
--  que la marca de la categoría los cubría a todos.
-- ----------------------------------------------------------------------------

select code,
       name,
       type as tipo_actual,
       category as categoria_actual
from public.facilities
where (code ~* '^[0-9]{5}F[0-9]{2}([0-9]{2})?$' and substring(code from 7 for 2) <> '01')
  and regexp_replace(upper(coalesce(category, '')), '[^A-Z0-9]', '', 'g') <> 'PC'
order by code;


-- ----------------------------------------------------------------------------
--  PASO 4 - El cambio, por la marca de la categoría.
-- ----------------------------------------------------------------------------

update public.facilities
set type = 'PUESTO_COMUNAL'
where regexp_replace(upper(coalesce(category, '')), '[^A-Z0-9]', '', 'g') = 'PC'
  and coalesce(type, '') <> 'PUESTO_COMUNAL';


-- ----------------------------------------------------------------------------
--  PASO 5 - El cambio, por el código.
--
--  Cubre los que el PASO 3 haya listado. El código es la señal fiable: nadie
--  lo escribe con `F02` si no es una farmacia aparte.
-- ----------------------------------------------------------------------------

update public.facilities
set type = 'PUESTO_COMUNAL'
where (code ~* '^[0-9]{5}F[0-9]{2}([0-9]{2})?$' and substring(code from 7 for 2) <> '01')
  and coalesce(type, '') <> 'PUESTO_COMUNAL';


-- ----------------------------------------------------------------------------
--  PASO 6 (OPCIONAL) - Vaciar la categoría que servía de marca.
--
--  Ya no hace falta: el tipo dice lo mismo y mejor. Pero es su dato, así que
--  queda comentado. Quite los dos guiones para ejecutarlo.
-- ----------------------------------------------------------------------------

-- update public.facilities
-- set category = null
-- where type = 'PUESTO_COMUNAL'
--   and regexp_replace(upper(coalesce(category, '')), '[^A-Z0-9]', '', 'g') = 'PC';


-- ----------------------------------------------------------------------------
--  PASO 7 - Verificación. Cómo quedó el reparto por tipo.
-- ----------------------------------------------------------------------------

select coalesce(nullif(trim(type), ''), '(sin tipo)') as tipo,
       count(*) as establecimientos
from public.facilities
group by 1
order by 2 desc;


-- ----------------------------------------------------------------------------
--  PASO 8 - Verificación fina: ya no debe quedar ningún puesto comunal con
--  otro tipo. Las dos cifras tienen que salir en cero.
-- ----------------------------------------------------------------------------

select count(*) filter (
         where (code ~* '^[0-9]{5}F[0-9]{2}([0-9]{2})?$' and substring(code from 7 for 2) <> '01')
           and coalesce(type, '') <> 'PUESTO_COMUNAL'
       ) as por_codigo_sin_migrar,
       count(*) filter (
         where regexp_replace(upper(coalesce(category, '')), '[^A-Z0-9]', '', 'g') = 'PC'
           and coalesce(type, '') <> 'PUESTO_COMUNAL'
       ) as por_categoria_sin_migrar
from public.facilities;


-- ============================================================================
--  REVERSIÓN, si algo saliera mal. Devuelve el tipo y la categoría que tenía
--  cada establecimiento en el momento del respaldo, sin tocar lo demás.
-- ============================================================================

-- update public.facilities f
-- set type = r.type,
--     category = r.category
-- from public.facilities_respaldo_2026_09_21 r
-- where f.code = r.code;
