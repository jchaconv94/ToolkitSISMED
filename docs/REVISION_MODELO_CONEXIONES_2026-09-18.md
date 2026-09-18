# Revisión del modelo: organización, conexiones de stock y administración

Fecha: 18/09/2026. Motivo: la tabla `unget_configs` tiene **15 filas para 9 UNGET** y solo una de ellas guarda el enlace de la hoja de cálculo. Lo que parecía un descuido al crear conexiones resultó ser una costura del modelo de datos.

Todo lo que se afirma aquí está verificado en el código o en los datos, salvo lo marcado como *por confirmar*.

---

## 1. El sistema son dos mundos que no se tocan

### Mundo A — la organización (Administración → Establecimientos)

Está bien modelado. Cinco tablas encadenadas por identificador:

```
diresas ──< ogess ──< ungets ──< microredes ──< facilities (IPRESS, PK = código RENIPRESS)
```

`facilities` guarda `unget_id`, `microred_id`, `ogess_id` y `diresa_id`; `ungets` guarda `ogess_id` y `diresa_id`. `AdminOrganizationModule` permite registrar cada nivel y limita las pestañas según el rol: un usuario UNGET solo ve UNGET, Microred e IPRESS.

Los usuarios también cuelgan de aquí: cada uno se vincula a una IPRESS o a personal, y de ahí salen su `diresaId`, `ogessId` y `ungetId`.

### Mundo B — las conexiones de stock (Consulta Stock → Conexiones)

Tres tablas, ninguna referida a las anteriores por identificador:

| Tabla | Cómo identifica | Problema |
| --- | --- | --- |
| `unget_configs` | `username` + `unget_name` (texto) | La conexión pertenece a la **persona** que la creó, no a la UNGET |
| `facility_stock_assignments` | `admin_username` + `sheet_url` + `sheet_name` | El vínculo IPRESS ↔ pestaña cuelga de una **URL** |
| `user_subscriptions` | `username` → `subscribed_username` | La visibilidad es **persona a persona** |

**El puente entre los dos mundos es el nombre escrito a mano.** En `SheetSearchModule.tsx:1645` se ve literalmente: para decidir si una conexión pertenece a la jurisdicción del usuario, se busca la UNGET por `config.ungetId` **o por nombre normalizado**. El identificador casi nunca está, así que en la práctica manda el texto.

---

## 2. Lo que se rompe por esa costura

### 2.1 Se pueden crear conexiones duplicadas de la misma UNGET

Es lo que pasó: cada UNGET tiene una fila del usuario de la UNGET y otra de `admin`; San Martín tiene tres. Tres causas encadenadas:

1. `unget_configs` no tiene ninguna restricción de unicidad.
2. El filtro que debería evitarlo (`availableUngetsForConfig`, `SheetSearchModule.tsx:1395`) descarta las UNGET ya configuradas comparando contra `unget_id`, una columna que en producción **no existe** (`api.ts:1095` la trata como opcional y la descarta al insertar). Al recargar siempre vuelve nula, así que el filtro solo funciona dentro de la misma sesión.
3. Aunque funcionara, solo mira **las conexiones propias**: nada impide que `admin` cree la conexión de una UNGET que su informático ya configuró, ni al revés.

### 2.2 El estado de una UNGET depende de qué fila mires

El enlace de la hoja de Bellavista está en la fila de `admin`. La lista del modal muestra la fila del usuario `bellavista`, que no lo tiene. Resultado: la tarjeta lee directo y rápido, pero la configuración dice «Solo Apps Script». Las dos afirmaciones son ciertas sobre filas distintas de la misma UNGET.

### 2.3 Las asignaciones IPRESS ↔ pestaña cuelgan de una URL

`facility_stock_assignments` guarda `sheet_url` con la URL de la conexión (`AdminStockAssignmentModule.tsx:382`). Esa URL cambia si la UNGET pasa de Apps Script a lectura directa (`sheets://<id>`), si vuelve a desplegar su Web App o si cambia de libro. Cuando cambia, **las asignaciones de esa UNGET quedan huérfanas** sin que nadie lo note: los establecimientos pierden su nombre asignado y sus columnas visibles.

Es el mismo riesgo que ya nos costó tres PR con `spreadsheet_id`, pero en otra tabla.

### 2.4 La visibilidad depende de personas, no de la jerarquía

DIRESA ve las UNGET de la región porque está **suscrito a los usuarios** que las configuraron. Si ese informático cambia de usuario, se va o le renombran la cuenta, la UNGET desaparece de la vista aunque siga registrada en Establecimientos. Para DIRESA y OGESS hay además una regla por jurisdicción (`SheetSearchModule.tsx:1641-1655`), pero convive con las suscripciones en vez de sustituirlas.

### 2.5 Se puede configurar la conexión de una UNGET que no existe

Nada obliga a que la UNGET esté registrada en Establecimientos antes de crear su conexión: basta escribir un nombre. Por eso conviven «Mariscal Cáceres» y «MARISCAL», y por eso `formatName()` en `api.ts:995` corrige a mano «MARICAL C.» → «MARISCAL CACERES».

### 2.6 Un mensaje que miente

Cuando el selector no tiene nada que ofrecer, el formulario dice «Todas las UNGETs de su jurisdicción ya están configuradas», aunque el motivo real sea que no se pudo resolver la lista. Es la pista que hizo visible todo lo anterior.

---

## 3. Modelo objetivo

El principio que pidió el usuario: **todo parte del módulo de Establecimientos**. Primero se registra la UNGET; después se configura su conexión.

1. **Una UNGET tiene como mucho una conexión.** `unget_configs.unget_id` con índice único, referido a `ungets.id`. Sin UNGET registrada no hay conexión posible.
2. **La conexión pertenece a la UNGET, no a la persona.** La mantiene cualquier usuario de esa UNGET y los niveles superiores. `username` pasa a ser «quién la editó por última vez», no la identidad de la fila.
3. **Las asignaciones cuelgan de la UNGET y de la pestaña**, no de la URL: `unget_id` + `facility_code` + identificador de pestaña. Cambiar de Web App a lectura directa deja de romperlas.
4. **La visibilidad se deriva de la jerarquía**: DIRESA ve las UNGET de su DIRESA porque está registrado así en Establecimientos. Las suscripciones quedan solo para casos que la jerarquía no cubra.
5. **Establecimientos muestra el estado**: en la ficha de cada UNGET, si tiene conexión, si lee directo o por Apps Script, y un acceso para configurarla.

---

## 4. Plan por fases

Cada fase es un PR pequeño, con su SQL aparte y reversible. Ninguna rompe lo que ya funciona.

**Fase 1 — Una conexión por UNGET.**
`alter table unget_configs add column if not exists unget_id`, relleno por nombre normalizado contra `ungets`, consolidación de las 15 filas a 9 (conservando la que tenga hoja) e índice único. En la aplicación: escribir y leer `unget_id`, y que el selector descarte las UNGET ya configuradas **por cualquiera**, ofreciendo editar la existente. Copia de seguridad de la tabla antes de borrar nada.

**Fase 2 — La conexión es de la UNGET.**
Permitir editar la conexión a cualquier usuario de esa UNGET y a los niveles superiores. Es cambio de aplicación: las políticas RLS ya lo permiten (`app_sesion_valida` es `FOR ALL`).

**Fase 3 — Asignaciones estables.**
`facility_stock_assignments` pasa a colgar de `unget_id` + pestaña, con relleno desde `sheet_url`. A partir de ahí, cambiar la conexión no rompe las asignaciones.

**Fase 4 — Visibilidad por jerarquía.**
La lista de UNGET visibles sale de Establecimientos. Las suscripciones se conservan como compatibilidad y dejan de ser el mecanismo principal.

**Fase 5 — Establecimientos como punto de partida.**
Estado de conexión por UNGET en su ficha y acceso directo a configurarla.

---

## 5. Consultas para confirmar el estado real

```sql
-- ¿Existe ya la columna unget_id en unget_configs?
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'unget_configs'
order by ordinal_position;

-- Conexiones por UNGET, y cuáles tienen hoja.
select unget_name, count(*) as filas,
       count(*) filter (where spreadsheet_id is not null) as con_hoja,
       string_agg(username, ', ' order by username) as usuarios
from public.unget_configs
group by unget_name
order by filas desc, unget_name;

-- Asignaciones que apuntan a una URL que ya no existe en ninguna conexión.
select a.sheet_url, count(*) as asignaciones
from public.facility_stock_assignments a
left join public.unget_configs c on c.url = a.sheet_url
where c.id is null
group by a.sheet_url;

-- UNGET registradas en Establecimientos que todavía no tienen conexión.
select u.name
from public.ungets u
left join public.unget_configs c
  on lower(btrim(c.unget_name)) = lower(btrim(u.name))
where c.id is null
order by u.name;
```

La tercera es la que más interesa: si devuelve filas, ya hay asignaciones huérfanas.

---

## 6. Decisiones pendientes

1. **Quién conserva la conexión al consolidar**: la fila del usuario de la UNGET (recomendado: cada informático mantiene lo suyo) o la de `admin`.
2. **Qué pasa con las suscripciones** una vez que la jerarquía cubre la visibilidad: se retiran o se conservan para casos sueltos.
3. **Si una UNGET puede tener más de un libro de cálculo.** Hoy el modelo asume uno; El Dorado aparece con dos pestañas y San Martín con una, así que conviene confirmarlo antes de poner el índice único.
