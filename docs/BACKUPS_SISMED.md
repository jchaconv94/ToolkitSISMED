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
| **Supabase** | Quién entra (PC con clave vigente y vinculada; usuarios con su jurisdicción) y, en la etapa 3, las reglas. Solo filas chicas: no consume el límite de descargas. |
| **Cloudflare Worker + Durable Object** (`cloudflare/conexion`, servicio `sismed-conexion`) | Las conexiones abiertas (hibernan: una conexión quieta no consume nada) y el paso del archivo hacia y desde R2, por el enlace interno de Cloudflare. |
| **Cloudflare R2** (bucket `sismed-backups`) | Los zips, de paso. Descargas gratis e ilimitadas. |

**Cambio aprobado en la etapa 2 (2026-10-01):** el archivo ya no se sube con enlaces firmados por Supabase, sino por el mismo servicio de Cloudflare, que llega a R2 por su enlace interno (`BACKUPS`) sin ninguna clave. Los secretos `R2_*` guardados en Supabase en la etapa 0 **no se usan** y pueden borrarse.

**Por qué no Supabase para los archivos:** el plan gratuito trae 5 GB de descargas al mes y la
región movería ~28 GB (10 UNGET × ~40 IPRESS × ~15 MB + hospitales de 70–150 MB, una vez por
semana). R2 no cobra descargas.

**Por qué la PC abre la conexión:** las PC están detrás de routers y cortafuegos; nadie puede
conectarse a ellas desde afuera, pero ellas sí pueden salir.

### Los tres candados contra cobros

1. **Regla del bucket** `borrar-a-1-dia`: borra todo objeto con más de 1 día y cancela las subidas
   incompletas a 1 día, aunque nuestro sistema falle.
2. **Tope propio en la web**: aviso al 70 % y pausa al 80 % de lo gratuito.
3. **Alerta de presupuesto** de $1 en Cloudflare.

Cloudflare no tiene un tope de gasto que corte el servicio; por eso existen los candados 1 y 2.

## Etapas

| Etapa | Qué | Estado |
|---|---|---|
| 0 | Cuenta Cloudflare, R2, bucket privado, regla de borrado, alerta de $1, clave limitada guardada en Supabase (`R2_*`) | hecha el 2026-09-30 |
| 1 | Conexión inmediata con PC reales (sin pantalla definitiva) | probada el 2026-10-01 con ACER-JORDAN (06525): aviso en 270 ms, reconexión sola al cortar el wifi. Falta revisar el consumo a los 2–3 días |
| 2 | Traslado del archivo por partes a R2 | probada el 2026-10-01 con ACER-JORDAN (06525): 8.3 MB en ~11 s, huella verificada, borrado de la nube. Falta un backup grande (70+ MB) con corte de red y restaurarlo en el SISMED |
| 3 | Reglas en Supabase (jurisdicción, 1 al día, topes, limpieza) | pendiente |
| 4 | Módulo web Backups SISMED con descarga en segundo plano | pendiente |
| 5 | Piloto una semana en UNGET Bellavista | pendiente |
| 6 | Abrir a las demás UNGET | pendiente |

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

**Falta para pasar a la etapa 3:** un backup de 70 MB o más (almacén u hospital) cortando el
wifi a mitad de la subida, restaurar en el SISMED el zip descargado, y comprobar en R2 que el
bucket queda vacío.

