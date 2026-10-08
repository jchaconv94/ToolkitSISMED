# Modo sin internet

Desde el 2026-10-08. Pedido del usuario: los establecimientos se conectan más o menos una vez al mes, y las herramientas que trabajan con lo que se sube al navegador (y no guardan nada en la base) tienen que funcionar «sí o sí» sin internet. Lo mismo vale para las herramientas de ese tipo que se agreguen después.

## Qué funciona sin internet

| Funciona | Necesita internet |
|---|---|
| Inicio (con lo último guardado) | Consulta Stock, Stock SISMED, Columnas de Stock |
| Análisis de Requerimiento | Lista de Exclusiones (para editarla; el análisis usa la última copia) |
| Disponibilidad (subir TFORMDET, tablero, Excel) | Backups SISMED, Claves de envío |
| Redistribución | Administración, Perfil |

Se declara en `components/navigation.ts` con `offline: true`. De ahí salen la pastilla «Sin conexión» de la cabecera con su lista, la marca «Necesita internet» de Inicio y el aviso que reemplaza a una herramienta que necesita internet cuando se abre sin conexión (`components/OfflineIndicator.tsx`). Si la conexión se cae con una de esas herramientas abierta, no se cierra: lo que ya cargó sigue a la vista.

## Las cuatro piezas

1. **La app abre sin internet.** `public/sw.js` guarda al instalarse todos los archivos del build: el plugin `offlinePrecache` de `vite.config.ts` le escribe la lista y una versión (`services/precacheManifest.ts`, con pruebas). Las páginas van primero a la red, así siempre carga la versión recién publicada, y si no responde en 4 s usa la guardada. Los archivos de la app se sirven desde lo guardado, y las letras de Google Fonts se guardan al instalar. Los datos (Supabase, Google Sheets, Cloudflare) nunca se guardan ahí. Al publicar, el navegador instala la versión nueva solo y se conservan la actual y la anterior.
2. **La sesión no se cierra.** La casilla «Mantener sesión iniciada» del login viene marcada (decisión del usuario: quien no sabe de tecnología no la marcaría nunca) y reemplaza a «Recordar mi usuario».
   - Con la casilla marcada, el usuario y el token van en `localStorage` (`services/sessionStore.ts`, con pruebas). Sobreviven a cerrar el navegador, no hay cierre por inactividad, y la app abre sin internet hasta **45 días** desde la última vez que se comprobó la sesión con internet (`OFFLINE_SESSION_DAYS`; el usuario pidió «de 30 a más»).
   - Con internet, la sesión se comprueba al abrir, al volver la conexión y cada 6 horas. El servidor alarga el token por el mismo plazo con `app_session_keep` (`supabase/SUPABASE_SESION_MANTENIDA.sql`). Sin ese SQL, el token dura 12 horas y, con internet, se pide entrar otra vez.
   - Sin la casilla, todo queda como antes: la sesión vive en la pestaña.
   - El PIN y la huella mantienen la sesión siempre, porque son de un equipo personal.
   - Si se cierra sesión sin internet, el token se anota y se cierra en el servidor apenas vuelve la conexión.
3. **Las herramientas tienen sus datos.** Lo que leen de Supabase tiene copia en el equipo (`services/offlineCache.ts`, IndexedDB): el registro de establecimientos, las microredes y las UNGET, la configuración de Disponibilidad (la fórmula, los fusionados y los vitales: sin internet se calcula igual que con internet), las profesiones y los parámetros. Con internet, al entrar, la app deja esas copias guardadas por detrás (`services/offlineWarmup.ts`, como mucho una vez por hora). Lo que sube el usuario se guarda en el equipo (el TFORMDET de Disponibilidad en `services/availabilityStore.ts`; el Análisis y la Redistribución ya lo hacían).
4. **Se sabe si hay internet.** `services/connectivity.ts` (con pruebas) escucha al navegador y además a cada petición a Supabase (`services/supabaseClient.ts`). Así nota una red conectada sin salida a internet, que es lo común en un establecimiento. Una falla sola no basta: se hace una comprobación corta y, si también falla, se marca sin conexión y se vuelve a comprobar cada 15 s.
   - Ya sin conexión, las peticiones a Supabase fallan al instante con `code: "OFFLINE"`. Si no, la librería reintenta cada una tres veces (1 + 2 + 4 s) y la app se quedaba en la pantalla de carga.
   - Mientras no hay internet, la campanita y el resumen de Inicio no se recalculan: se queda lo último guardado.

## Seguridad

- **Se retiró un ingreso de prueba:** antes, sin conexión, el login aceptaba usuarios escritos en el código (`admin` / `123`) y entraba como Administrador. Ahora, sin internet, solo se entra con una sesión mantenida en ese equipo. También se retiraron los establecimientos de prueba que devolvía el registro sin conexión.
- La sesión mantenida es un token en `localStorage`. Vence a los 45 días sin usarse con internet. Cerrar sesión lo borra. Desactivar la cuenta lo invalida al instante, y cambiar la contraseña cierra las sesiones mantenidas en todos los equipos (trigger de `SUPABASE_SESION_MANTENIDA.sql`).
- Las copias del equipo son solo catálogos que no son sensibles: nunca usuarios, claves ni stock.

## Cómo se probó (2026-10-08)

Prueba de punta a punta con Playwright sobre la versión compilada (`vite preview`), con perfil persistente para cerrar y abrir el navegador. En las fases sin internet se apagó el servidor de la app, se cortó la red del navegador desde el arranque y se bloquearon las peticiones a Supabase. Pasaron las 40 comprobaciones:

- se instala y guarda los 16 archivos del build;
- cerrar el navegador y abrirlo sin red entra directo al tablero de Disponibilidad en ~1,3 s, con la sesión iniciada y la letra Inter;
- sin internet: subir y calcular otro TFORMDET de 12 meses (Web Worker guardado), descargar el Excel (6,5 MB), abrir Redistribución y Análisis, y ver el aviso en Consulta Stock;
- recargar sin internet; cerrar sesión sin internet y que el servidor se entere al volver; `admin`/`123` ya no entra;
- red conectada pero sin salida a internet: aparece «Sin conexión» y desaparece sola al volver;
- más de 45 días sin internet pide entrar; con internet y el token vencido vuelve al login con «Su sesión venció»;
- sin la casilla, cerrar el navegador pide entrar;
- la primera visita, cerrada enseguida, abre sin internet y Disponibilidad tiene el registro;
- celular;
- versión nueva publicada: se instala sola y quedan solo la actual y la anterior.

Tres defectos que la prueba encontró y quedaron corregidos: la copia guardada no servía porque los servidores marcan los archivos con `Vary: Origin` (por eso el `ignoreVary` de `sw.js`); los reintentos de 7 s de Supabase; y que al cerrar sesión la dirección quedaba sin la barra final, fuera del service worker.

## Al agregar una herramienta que no guarda nada en la base

1. Ponle `offline: true` en `components/navigation.ts`.
2. Lo que lea de Supabase debe pasar por `withOfflineCache` (`services/offlineCache.ts`) y, si lo necesita sin haberse abierto antes, súmalo a `services/offlineWarmup.ts`.
3. Lo que el usuario sube o edita, guárdalo en IndexedDB (ejemplo: `services/availabilityStore.ts`).
4. Si usa un Web Worker, no hay nada que hacer: el build lo agrega solo a lo que guarda el service worker.
5. Pruébala sobre la versión compilada con la red cortada, sin haberla abierto antes en ese perfil.
