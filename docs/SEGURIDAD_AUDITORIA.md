# Auditoría de acceso a datos - ToolKit SISMED Web

Fecha: 2026-07-31. Realizada contra el proyecto Supabase `ujknopysvgqqvkmgrfhp` usando **únicamente la clave `anon` del `.env`**, que es la misma que viaja en el bundle publicado.

## Resumen

La clave `anon` da acceso de **lectura y escritura sin restricción** a todas las tablas del esquema `public`, incluida `users`.

Consecuencia principal: cualquiera que abra la aplicación desplegada, extraiga la clave del JavaScript y haga una petición HTTP puede **crear una cuenta con rol `ADMIN`** y entrar al sistema. No necesita descifrar ninguna contraseña.

No es una hipótesis: los permisos se verificaron directamente contra la API.

## Cómo se comprobó

Sondas no destructivas: `UPDATE` y `DELETE` con un filtro que no coincide con ninguna fila (`username=eq.__sonda__`). Si el permiso está cerrado, la API responde error; si está abierto, responde `204` con cero filas afectadas. **Ninguna sonda modificó un solo registro.**

También se consultó `information_schema.column_privileges` desde el panel de Supabase.

## Resultados

### Tabla `users`

Permisos concedidos al rol `anon`, según `information_schema`:

- `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `REFERENCES`
- `INSERT` alcanza a las columnas `password_hash`, `role`, `username`, `personnel_id`, `is_active` y `created_at`

Sondas: `SELECT` → `200`. `UPDATE` → `204`. `DELETE` → `204`.

Vías de ataque que esto habilita:

1. **Crear un usuario `ADMIN`** con una contraseña conocida por el atacante e iniciar sesión con normalidad.
2. **Cambiar el `role`** de una cuenta existente.
3. **Sobrescribir el `password_hash`** de cualquier usuario y tomar su cuenta.
4. **Borrar usuarios**, dejando a personal sin acceso.

La vía 1 es la más grave porque no deja rastro sobre ninguna cuenta legítima.

### Datos personales en `personnel`

Legible completa por `anon`: **70 personas**, con `dni`, `first_name`, `last_name`, `phone` y `email`.

Es una exposición de datos personales que en Perú cae bajo la Ley 29733 de Protección de Datos Personales. Conviene evaluarla con quien corresponda en la institución, con independencia de la corrección técnica.

### Resto de tablas

Todas las probadas resultaron abiertas a lectura y borrado para `anon`:

`facilities`, `roles_config`, `ungets`, `diresas`, `ogess`, `microredes`, `immunization_products`, `immunization_stock_layers`, `immunization_stock_movements`, `immunization_monthly_closures`, `immunization_distribution_batches`, `immunization_return_batches`, `immunization_adjustments`, `immunization_initial_inventories`.

Es decir, todo el stock biológico, los movimientos y los cierres mensuales pueden ser leídos, alterados o borrados desde fuera.

## Por qué ocurre

No es un descuido puntual, es consecuencia del modelo de autenticación.

La aplicación no usa Supabase Auth: valida usuarios contra su propia tabla `users` con `bcryptjs`. Para que eso funcione, **la base de datos no sabe quién está haciendo cada petición**: todas llegan como `anon`.

Sin identidad en el servidor no se pueden escribir políticas RLS del tipo "solo un ADMIN puede modificar usuarios", porque la base no distingue un ADMIN de un anónimo. La única forma de que la aplicación funcione con este diseño es conceder todo a `anon`, que es exactamente lo que está configurado.

Esto ya estaba anticipado como deuda en `docs/INMUNIZACIONES_DISENO_FUNCIONAL.md` §25, que señalaba que las políticas eran provisionales y que la solución definitiva exigía Supabase Auth o Edge Functions. La auditoría confirma que esa deuda tiene consecuencias reales y explotables hoy.

## Qué se corrigió ya

`docs/SEGURIDAD_ETAPA_1_LOGIN.md` documenta la etapa 1: el hash de contraseña deja de salir de la base, con verificación en el servidor mediante `app_verify_password`. Sigue pendiente de aplicar el SQL.

**Esa corrección sigue siendo válida pero ya no es la prioridad.** Ocultar el hash no sirve de mucho si cualquiera puede fabricarse un ADMIN sin necesidad de contraseñas.

## Estado tras la corrección (2026-08-01)

Todo lo anterior quedó cerrado. Verificado desde fuera con la clave `anon`:

| Acción | Antes | Ahora |
|---|---|---|
| Crear un usuario `ADMIN` | posible | `401` |
| Modificar o borrar usuarios | posible | `401` |
| Leer `password_hash` | posible | `401` |
| Modificar permisos por rol | posible | `401` |
| Leer stock, movimientos y cierres | posible | 0 filas |
| Crear productos de inmunizaciones | posible | `401` |

Sigue abierta la lectura del perfil (`username`, `role`, `personnel_id`, `is_active`,
`created_at`), que el login necesita para armar la sesión.

### Cómo quedó resuelto

1. **Autenticación en el servidor.** `app_login` valida la contraseña y devuelve un token
   de sesión con 12 horas de vigencia. El hash nunca sale de la base.
2. **Operaciones administrativas por función.** Crear, editar, activar, eliminar usuarios
   y guardar permisos por rol pasan por funciones `SECURITY DEFINER` que exigen sesión de
   ADMIN. El navegador ya no escribe sobre `users` ni `roles_config`.
3. **Datos de inmunizaciones por sesión.** El cliente envía el token en la cabecera
   `x-session-token` y las 15 tablas del módulo tienen RLS con una política que lo exige.

Scripts aplicados: `supabase/SUPABASE_SEGURIDAD_APLICAR_ESTO.sql` y
`supabase/SUPABASE_SEGURIDAD_PASO_2_DATOS.sql`.

### Dos tropiezos que conviene recordar

**pgcrypto no verifica hashes `$2b$`.** bcryptjs los genera así y `crypt()` solo entiende
`$2a$`, con lo que `app_verify_password` devolvía siempre falso y nadie podía entrar. Las
dos variantes producen el mismo resultado, así que la función reetiqueta el prefijo al
comparar; los hashes almacenados no se tocan. La comprobación original del script era
insuficiente: verificaba que pgcrypto pudiera *leer* el hash, no que lo *verificara*.

**Desplegar antes de aplicar RLS.** Al activar las políticas con el navegador todavía
sirviendo la versión anterior, la aplicación no enviaba la cabecera y se quedó sin datos.
No era un fallo de la política. El orden correcto es desplegar primero, aplicar el SQL
después, y forzar recarga con `Ctrl + Shift + R`.

## Lo que queda pendiente

- **Alcance por rol dentro de la sesión.** Hoy la política distingue "con sesión" de "sin
  sesión". No impide que un usuario con sesión válida consulte datos de otra IPRESS
  construyendo peticiones a mano. El control de ámbito sigue viviendo en el frontend
  (`ImmunizationScope`).
- **Resto de tablas.** `personnel`, `facilities`, `ungets` y las de farmacia siguen
  abiertas a lectura. Se dejaron fuera porque el login las necesita antes de tener sesión.
- **Migración a Supabase Auth**, que permitiría políticas por rol y ámbito reales.
- **Envío de stock sin credencial** (anotado el 2026-09-23 a pedido del usuario, que lo
  considera importante). Ver la sección siguiente.

## Pendiente: el envío de stock a Google Sheets no pide credencial

Anotado el 2026-09-23 al revisar el script que recibe el stock de Sync SISMED
(`Toolkit-OGM/docs/apps-script/sync_sismed_google_sheets.gs`). **Queda por hacer; el usuario
pidió que se le recuerde.**

**El problema.** El `doPost` de cada UNGET está publicado para «Cualquiera» y no comprueba
quién envía. Quien conozca la dirección del script puede:

- **reemplazar el stock** de cualquier establecimiento con datos inventados, porque cada
  envío sustituye la pestaña completa;
- **dejar en blanco** cualquier pestaña, enviando una lista vacía con
  `reported_almcods=<código>`. Es la vía más dañina: no deja rastro de quién fue.

La dirección no es secreta en la práctica: está en la configuración de cada PC y hay una por
defecto escrita en el código del Toolkit (`toolskit/sismed_sync.py`, `apps_script_url`), así
que viaja dentro del instalador `.exe`. **No escribir esa dirección en ningún documento.**

**Lo que se propuso: una clave por conexión.**

- Cada UNGET guarda su propia clave en las propiedades del script
  (`PropertiesService.getScriptProperties()`), no en el código.
- El Toolkit de escritorio suma un campo «Clave de envío» en su configuración y la manda en
  cada envío. **Tiene que ir en la dirección (`?clave=...`) o en el cuerpo:** un `doPost` de
  Apps Script no puede leer cabeceras HTTP.
- El script rechaza, sin tocar la hoja, todo envío cuya clave no coincida.

**Cómo desplegarlo sin cortar el envío**, porque son 22 PC solo en Bellavista:

1. Publicar el script aceptando envíos con y sin clave, y registrando los que llegan sin ella.
2. Actualizar el Toolkit en todas las PC y cargarles la clave.
3. Cuando el registro muestre que ya nadie envía sin clave, empezar a exigirla.

Cambiar la clave en el futuro es cambiar la propiedad y actualizarla en las PC.

**Relacionado, de menor gravedad:** las hojas están compartidas como «Cualquiera con el
enlace: lector», que es lo que permite a la web leerlas sin iniciar sesión. Quien tenga el
enlace puede ver el stock. No hay datos personales, pero conviene decidirlo explícitamente.

**La solución de fondo ya existe:** Sync SISMED 2.0 envía a Supabase con un token por máquina
y una lista blanca de almacenes por instalación. Migrar a él cierra ambos puntos.

## Prioridades recomendadas

### 1. Cortar la escalada de privilegios (inmediato)

```sql
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.roles_config FROM anon;
```

Cierra las cuatro vías de ataque de la sección anterior. Es una sola sentencia y es reversible.

**Rompe temporalmente**: crear y editar usuarios, activar/desactivar, eliminar, cambio de contraseña y edición de permisos por rol. Todo eso escribe desde el navegador con la clave `anon`.

Se acepta esa rotura a propósito: la administración de usuarios se usa ocasionalmente, mientras que la puerta abierta lo está de forma continua y la clave lleva meses publicada.

### 2. Restaurar la administración de forma segura

Reconstruir esas operaciones como funciones `SECURITY DEFINER` que exijan las credenciales del administrador que las ejecuta, y verificarlas en el servidor antes de actuar. Es el mismo patrón de `app_verify_password`.

### 3. Migrar a identidad real

Supabase Auth, o mover todas las escrituras a Edge Functions. Es la única forma de proteger las tablas restantes sin romper la aplicación, porque permite políticas RLS que distingan quién llama.

Mientras esto no exista, cualquier cierre adicional será a costa de funcionalidad.

### 4. Revisar la exposición de datos personales

Decidir con la institución qué corresponde hacer respecto de los datos de las 70 personas en `personnel`.

## Nota sobre rotación de la clave

Rotar la clave `anon` **no resuelve nada por sí solo**: la nueva clave volvería a publicarse en el siguiente despliegue. El problema no es que la clave se haya filtrado, sino que una clave pública tiene permisos de administración.
