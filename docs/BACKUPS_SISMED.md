# Backups SISMED con un clic

Plan aprobado por el usuario el 2026-09-30. Reemplaza el procedimiento manual de pedir a cada
establecimiento que envíe su backup del SISMED.

## Qué se construye

El informático de cada UNGET aprieta «Descargar» en una PC conectada y recibe el backup más
reciente que el propio SISMED ya generó (`<instalación>\backup\BKDA<AAAAMMDD><HHMM>.Zip`, con su
contraseña), sin que nadie en el establecimiento haga nada.

Reglas acordadas:

- **Solo a pedido.** Sin descargas automáticas: lo que nadie descarga no debe quedar ocupando espacio.
- **Solo PC conectadas en ese momento**, y solo las de su jurisdicción.
- **Inmediato:** el aviso llega a la PC en 1–2 s (conexión abierta), no cada 2 ni 10 minutos.
- **Un backup por establecimiento al día**, para todos los usuarios. No cuenta si falló.
- **Gratis:** aviso al 70 % del uso gratuito y pausa al 80 %.
- La descarga sigue al cambiar de módulo (panel flotante); al cerrar la pestaña el navegador
  avisa y, si igual se cierra, se retoma al volver.

## Arquitectura

| Pieza | Para qué |
|---|---|
| **Toolkit de escritorio** | Mantiene una conexión abierta con Cloudflare; toma el `BKDA…zip` más reciente y lo sube en partes de 20 MiB con huella SHA-256. |
| **Supabase** | Quién entra (PC con clave vigente y vinculada; usuarios con su jurisdicción), el cupo de descargas por día y el registro de cada pedido. Solo filas chicas: no consume el límite de descargas. |
| **Cloudflare Worker + Durable Object** (`cloudflare/conexion`, servicio `sismed-conexion`) | Las conexiones abiertas (hibernan: una conexión quieta no consume nada) y el paso del archivo hacia y desde R2, por el enlace interno de Cloudflare. |
| **Cloudflare R2** (bucket `sismed-backups`) | Los zips, de paso. Descargas gratis e ilimitadas. |

**Cambio aprobado en la etapa 2 (2026-10-01):** el archivo ya no se sube con enlaces firmados por Supabase, sino por el mismo servicio de Cloudflare, que llega a R2 por su enlace interno (`BACKUPS`) sin ninguna clave. Los secretos `R2_*` que se guardaron en Supabase en la etapa 0 se borraron el 2026-10-02, junto con su token `sismed-backups-web` en Cloudflare. Queda solo «Edit Cloudflare Workers», el que usa GitHub para publicar (`CLOUDFLARE_API_TOKEN`).

**Por qué no Supabase para los archivos:** el plan gratuito trae 5 GB de descargas al mes y la
región movería ~28 GB (10 UNGET × ~40 IPRESS × ~15 MB + hospitales de 70–150 MB, una vez por
semana). R2 no cobra descargas.

**Por qué la PC abre la conexión:** las PC están detrás de routers y cortafuegos; nadie puede
conectarse a ellas desde afuera, pero ellas sí pueden salir.

### Los tres candados contra cobros

1. **Regla del bucket** `borrar-a-1-dia`: borra todo objeto con más de 1 día y cancela las subidas
   incompletas a 1 día, aunque nuestro sistema falle.
2. **Tope propio en el servicio**: aviso al 70 % y pausa al 80 % de lo gratuito (etapa 3).
3. **Alerta de presupuesto** de $1 en Cloudflare.

Cloudflare no tiene un tope de gasto que corte el servicio; por eso existen los candados 1 y 2.

## Etapas

| Etapa | Qué | Estado |
|---|---|---|
| 0 | Cuenta Cloudflare, R2, bucket privado, regla de borrado, alerta de $1, clave limitada guardada en Supabase (`R2_*`) | hecha el 2026-09-30 |
| 1 | Conexión inmediata con PC reales (sin pantalla definitiva) | probada el 2026-10-01 con ACER-JORDAN (06525): aviso en 270 ms, reconexión sola al cortar el wifi. Falta revisar el consumo a los 2–3 días |
| 2 | Traslado del archivo por partes a R2 | probada el 2026-10-01 con ACER-JORDAN (06525): 8.3 MB y 74.3 MB con corte de red, huella verificada, restaurado en el SISMED, bucket vacío |
| 3 | Reglas: descargas por día configurables, topes de consumo, auditoría | probada el 2026-10-02: cupo de 1 al día respetado también por el admin, métricas reales de Cloudflare |
| 4 | Módulo web Backups SISMED con descarga en segundo plano | probada el 2026-10-02 con el informático de Bellavista y la PC del Almacén (030S05) |
| 5 | Piloto una semana en UNGET Bellavista | acortado: el 2026-10-02 se decidió abrir sin esperar la semana |
| 6 | Abrir a las demás UNGET | `SUPABASE_BACKUPS_ABRIR_REGION.sql`, 2026-10-02 |

Cada etapa termina con una prueba que tiene que salir bien antes de pasar a la siguiente.

## Etapa 1 · Conexión inmediata

- **Servicio:** `cloudflare/conexion` (Worker + Durable Object `Region`, uno solo para toda la
  región). Lo publica `.github/workflows/cloudflare-conexion.yml` al cambiar esa carpeta en `main`,
  con los secretos `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `VITE_SUPABASE_ANON_KEY`.
  Dirección: `wss://sismed-conexion.jchaconvillacis.workers.dev`.
- **SQL:** `supabase/SUPABASE_BACKUPS_CONEXION.sql`.
  - `backup_pilot_codes`: establecimientos del piloto (empieza con `030S05`).
  - `app_backup_pc_enabled`: el Toolkit pregunta si debe conectarse (cada 30 min).
  - `app_backup_pc_auth`: el servicio acepta una PC solo con clave de envío vigente, PC vinculada
    y código en el piloto.
  - `app_backup_web_auth`: el servicio acepta la web con la sesión y la jurisdicción de Claves de envío.
- **Toolkit:** `toolskit/backup_connection.py` (Toolkit-OGM). Arranca y se detiene con Sync SISMED;
  Sync SISMED 2.0 no lo usa. Manda el texto «ping» cada 50 s (el servicio responde «pong» sin
  despertarse) y se reconecta solo con espera creciente.
- **Web:** pestaña «Conexión (prueba)» en Claves de envío, solo para el administrador
  (`components/AdminConnectionTestTab.tsx`).

**Criterio para pasar a la etapa 2:** el aviso llega en menos de 2 s; al cortar la red la PC se
reconecta sola; el consumo diario de Durable Objects queda por debajo del 10 % de lo gratuito
(100 000 operaciones/día).

## Etapa 2 · Traslado del archivo

- **Pedido:** la web manda `backup_request` por la conexión abierta. El servicio crea el pedido
  (vence a la hora) con dos permisos de un solo uso: uno para que la PC suba y otro para que la
  web descargue.
- **Toolkit** (`toolskit/backup_upload.py`): toma el `BKD[AH]<fecha>.zip` más reciente de
  `<carpeta SISMED>\backup` que tenga más de 90 s (uno más nuevo puede estar escribiéndose),
  informa nombre, tamaño y SHA-256, y sube partes de 20 MiB a
  `/backup/<pedido>/part/<n>`. Reintenta solo la parte que falla (4 intentos). Un backup a la vez.
- **Servicio:** pasa cada parte a R2 sin guardarla en memoria; al completar comprueba el tamaño.
  Descarga en `/backup/<pedido>/download?token=…`, con soporte de `Range` para retomar.
- **Web** (pestaña de prueba): descarga, compara la huella y recién entonces guarda el archivo y
  pide borrarlo (`backup_done`). Si nadie lo descarga, el servicio lo borra a la hora.

Probado en local de punta a punta (runtime real de Workers con R2 simulado, cliente Python real
y navegador): 45 MB en 3 partes con un corte simulado, archivo descargado idéntico al original,
descarga parcial, permisos inválidos rechazados, otra UNGET sin acceso y borrado al confirmar.

**Prueba real (2026-10-01):** Toolkit 2.2.3 en ACER-JORDAN (`C:\SISMEDV2OGM`, código 06525).
La PC subió `BKDA202609301300.zip` (8.3 MB) y la web lo descargó con la huella verificada y lo
borró de la nube: 11 s de punta a punta.

Luego, `BKDA202609220718.zip` de hospital (74.3 MB, 4 partes): se cortó internet a mitad de la
subida y retomó sola; subida y descarga verificada en 1 min 30 s. El zip descargado se restauró
en el SISMED y funciona. En R2 el bucket quedó en 0 B (también se borró solo `prueba.txt` de la
etapa 0) con 3 operaciones de clase A y 4 de clase B en el día.


## Etapa 3 · Reglas

Decidido el 2026-10-02: el día cuenta en hora de Perú; el límite vale para todos, también
el administrador, y lo fija el administrador en **Parámetros del Sistema → Backups SISMED**
(de 1 a 20, empieza en 1). A futuro el servicio podría cobrarse por usuario: por eso cada
pedido guarda quién lo hizo.

- **SQL:** `supabase/SUPABASE_BACKUPS_REGLAS.sql`.
  - `backup_settings`: el límite por día. No vive en `system_config` porque esa tabla se
    puede escribir con la clave pública; esta solo la cambia `app_backup_settings_save`
    con sesión de ADMIN.
  - `backup_requests`: un registro por pedido (establecimiento, usuario, equipo, archivo,
    tamaño, estado, motivo). Se borran solos al año.
  - `app_backup_request_start`: el servicio la llama **antes** de avisar a la PC. Revisa
    jurisdicción, cuenta los pedidos del día (en curso o descargados) y reserva uno si
    queda cupo; si no, responde quién lo usó. Dos pedidos a la vez se atienden de a uno.
  - `app_backup_request_update`: el servicio registra cada paso (subiendo, listo,
    descargado, falló, venció) con la sesión de quien pidió.
  - Lo que falla o vence sin descargarse **no cuenta**. Un pedido que el servicio no
    cerró vence solo a la hora, así nunca bloquea el día.
- **Servicio:** antes de cada pedido mira el consumo (`src/usage.ts`, API de métricas de
  Cloudflare, una lectura cada 10 minutos como máximo y solo si alguien la necesita):
  peticiones del día, mensajes de conexión del día, tiempo activo del día, operaciones
  de R2 del mes y almacenamiento. Al 70 % avisa; al 80 % rechaza pedidos nuevos.
  - Si Supabase no responde, **no se pide** (el cupo no se salta por una caída).
  - Si Cloudflare no da las métricas, **se deja pasar** y la web lo muestra como «sin
    dato»: en Workers y Durable Objects el plan gratuito no cobra (al pasarse, falla), y
    R2 sigue protegido por la regla de borrado y la alerta de $1.
- **Clave de métricas:** secreto del repositorio `CLOUDFLARE_ANALYTICS_TOKEN`, una clave de
  Cloudflare con un solo permiso, *Account → Account Analytics → Read*. El despliegue la
  copia al servicio junto con `CLOUDFLARE_ACCOUNT_ID`; sin ella el despliegue se detiene
  con un aviso.
- **Web:** la pestaña de prueba muestra el consumo y los motivos de rechazo. La pantalla
  definitiva es la etapa 4.

Probado en local de punta a punta (servicio real, SQL real en Postgres, cliente Python
real): cupo informado, cada paso registrado, el administrador también respeta el cupo,
el mensaje dice quién lo descargó, un pedido fallido no cuenta, el cambio de límite se
aplica al instante y sin Supabase no se pide. La lectura de métricas se probó con
respuestas simuladas: desde aquí no hay salida a la API de Cloudflare, así que los nombres
de los campos se confirman en la prueba real.

**Hallazgo al medir:** la documentación de Cloudflare dice que, con hibernación, cada
mensaje que llega por una conexión cuenta como petición del Durable Object. Si los «ping»
de cada PC cuentan (uno cada 50 s ≈ 1 730 al día por PC), unas 55 PC conectadas todo el día
llegarían al 100 % de las 100 000 diarias. La prueba real de esta etapa lo dirá con el dato
«Mensajes de conexión»; si es así, antes de abrir a toda la región (etapa 6) hay que
espaciar el «ping».

**Prueba real (2026-10-02, 00:22 hora de Perú):** con ACER-JORDAN (06525), el primer backup
se descargó y el segundo pedido se rechazó con «Cupo del día usado · admin a las 00:22 · 1 de
1 hoy». Los cuatro medidores leyeron datos reales: Conexiones 113, Peticiones 22, Tiempo
activo 0,4 GB-s, R2 26 escrituras y 16 lecturas en el mes. Con una PC conectada unas 5 horas,
113 mensajes indica que los «ping» automáticos no estarían contando; se confirma con varios
días de uso antes de la etapa 6.

## Etapa 4 · Módulo «Backups SISMED»

Diseño aprobado el 2026-10-02 con prototipos. Administración → **Backups SISMED**
(`ADMIN_BACKUPS`, `/administracion/backups-sismed`).

- **Quién entra:** el administrador y todo rol que tenga «Backups SISMED» en Configuración de
  Roles. Cada uno ve los establecimientos de su jurisdicción.
- **Pestaña Backups (todos):** KPIs PC en línea ahora · Descargados hoy · Sin backup en 7 días ·
  Plan gratuito (solo el estado, sin cifras). Tabla con buscador, filtro «Mostrar» (Todos, En
  línea, Para descargar, Descargados hoy, Desconectados, con conteo), botón Actividad (panel
  lateral con lo de hoy) y paginación. Lista los establecimientos con clave de envío y en el
  piloto, también los desconectados.
- **Pestaña Consumo (solo el administrador):** estado general y protecciones, los 4 límites de
  Cloudflare con qué cuentan, cuándo se reinician y si podrían cobrar, mensajes de conexión de
  los últimos 7 días y backups del mes por UNGET.
- **Estado del servicio** en la cabecera de la app («Conectado · N PC en línea» y actualizar).
- **Descargas en segundo plano** (`contexts/BackupManagerContext.tsx`): el gestor vive arriba
  de todo, así que la descarga sigue al cambiar de módulo; panel flotante «Descargas»; el
  navegador pregunta antes de cerrar la pestaña con pedidos en curso; si se recarga o se
  vuelve a entrar, el servicio reenvía los pedidos de esa persona y la descarga se retoma.
- **Descarga** (`services/backupDownloader.ts`): con `Range`, retoma desde el último byte si se
  corta; comprueba la huella antes de guardar; guarda como `<código>_<nombre>.zip` en la
  carpeta elegida (Chrome y Edge) o en Descargas. La web no puede abrir la carpeta: el panel
  dice dónde quedó y copia el nombre.
- **SQL:** `supabase/SUPABASE_BACKUPS_MODULO.sql` (permiso del módulo, lista, actividad y
  resumen del mes).
- Se retiró la pestaña «Conexión (prueba)» de Claves de envío.

Probado en local de punta a punta (web real en el navegador, servicio real, SQL real en
Postgres y cliente Python del Toolkit): el informático pide, la PC sube, la web descarga y
verifica aunque se recargue la página a mitad, Supabase registra DOWNLOADED, la fila pasa a
«Cupo del día usado» y la actividad lo muestra. El administrador ve la pestaña Consumo.

**Prueba real (2026-10-02):** SQL aplicado («TODO CORRECTO»), módulo publicado (PR #93) y
«Backups SISMED» marcado en el rol de informático. Con la cuenta del informático de
Bellavista se ve el Almacén Bellavista (030S05, Toolkit 2.2.3) en línea, los 4 KPIs y «Cupo
del día usado» tras la descarga de las 13:42. Dos ajustes salieron de la prueba: los
porcentajes de Consumo con coma decimal (PR #94) y las pestañas, que aparecían un instante
al informático cuando antes había entrado el admin en la misma ventana (PR #95: salen del
rol de la sesión y el gestor olvida usuario, rol y consumo al cerrar sesión).

## Etapa 5 · Piloto en Bellavista

Una semana desde el 2026-10-02. El informático de Bellavista lo usa en su trabajo diario y
el administrador revisa la pestaña Consumo cada uno o dos días. Lo que se mide:

- **Mensajes de conexión por día**, para confirmar que los «ping» automáticos de las PC no
  cuentan (el 2026-10-02 iban 247 con una PC). Si contaran, hay que espaciarlos antes de la
  etapa 6.
- Pedidos fallidos y su motivo (Actividad y backups del mes por UNGET).
- Lo que confunda en la pantalla, anotado tal como lo diga el informático.

**Para pasar a la etapa 6:** una semana sin fallos sin explicar y el consumo diario lejos del
70 %.

**Limpieza de las pruebas (2026-10-02):** el 06525 (P.S. Cuzco, PC de casa ACER-JORDAN) dejó
de ser establecimiento de prueba: se le retiró la clave de envío, salió de
`backup_pilot_codes` (queda solo 030S05) y el Toolkit de esa PC volvió a la dirección real
sin clave. Su historial en `backup_requests` se conserva como auditoría. Esa PC tiene un
SISMED de prueba: no debe iniciar Sync SISMED, o sobrescribiría la pestaña real del P.S.
Cuzco.

**Se acortó el 2026-10-02:** el administrador decidió abrir a toda la región el mismo día,
sin esperar la semana. El dato de consumo que había (247 mensajes de conexión en el día con
una PC, lejos de los 1 730 que darían los «ping» si contaran) se sigue mirando ya con todas
las UNGET, en la pestaña Consumo. Si el día llega al 70 % hay aviso y al 80 % se pausan las
descargas, sin cobro.

## Etapa 6 · Abrir a todas las UNGET

`supabase/SUPABASE_BACKUPS_ABRIR_REGION.sql` quita la condición del piloto: desde que se
ejecuta, entra todo establecimiento con **clave de envío**.

- La clave sigue siendo obligatoria, porque es con lo que la PC se identifica. Un
  establecimiento sin clave no se conecta ni aparece en el módulo.
- El piloto no se borra: queda como interruptor en `backup_settings.pilot_only`, que leen
  las tres funciones a través de `app_backup_code_open`. Volver al piloto es una línea
  (`UPDATE public.backup_settings SET pilot_only = true WHERE id;`).
- Las PC preguntan cada 30 minutos si deben conectarse, así que aparecen solas en ese
  plazo, o al reiniciar Sync SISMED. Necesitan el Toolkit 2.2.3 o posterior.
- Cada informático necesita «Backups SISMED» marcado en su rol (Configuración de Roles).

Probado en Postgres local: antes, solo 030S05; después, todos los códigos con clave (y no
el que no la tiene), cada informático solo su jurisdicción; la función de la regla no la
puede llamar `anon`, y la reversión vuelve al piloto.

**Solo PC ya vinculadas (2026-10-02, `SUPABASE_BACKUPS_SOLO_VINCULADAS.sql`).** La
verificación de claves acepta una clave todavía sin vincular, porque la vincula el Toolkit
en su primer envío de stock. En Backups eso abría un hueco: si la clave de la IPRESS A
llegaba por error a la PC de la IPRESS B antes de que A la usara, la PC de B se conectaba
como A y el backup de A descargaba el SISMED de B. Ahora `app_backup_pc_auth` exige además
que la PC sea la vinculada (`sync_send_keys.device_id`). La PC de B nunca se vincula a la
clave de A, porque no tiene stock de A. Una PC con clave recién puesta aparece en Backups
después de su primer envío de stock. `SUPABASE_BACKUPS_ABRIR_REGION.sql` ya trae esta
versión, así que volver a ejecutarlo no deshace el arreglo.
