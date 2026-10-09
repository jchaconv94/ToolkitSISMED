# AGENTS.md - ToolKit SISMED Web

Guía de contexto para agentes de IA que trabajen en este repositorio. Última actualización: 2026-10-08 (modo sin internet).

> **Lee la sección 8 antes de escribir cualquier componente o utilidad.** El error más caro que ha cometido una IA en este proyecto es volver a escribir algo que ya existía: llegó a haber cinco `HeaderCell` distintos, cuatro `formatDate` y seis `Field`. Antes de crear una tarjeta, un formateador o una celda de tabla, **búscala** en `components/ui/kit.tsx`.

> **FRONTERA CRÍTICA DE STOCK (no mezclar):** `SIG_SEARCH` / `SheetSearchModule` (**Consulta Stock**) usa exclusivamente **Google Sheets → Google Apps Script → IndexedDB** para medicamentos, lotes, saldos, vencimientos y actualización. El 2026-10-02 se retiraron **Monitoreo de Stock** (`STOCK_MONITORING`) y **Sync SISMED 2.0** (la subida a la tabla `stock_actual` de Supabase, con su edge function y sus dispositivos), así que ninguna pantalla lee `stock_actual`: el inventario de Consulta Stock y de Stock SISMED (`IPRESS_STOCK`) sale **solo de Google Sheets**. **No reintroducir lecturas de `stock_actual`.** Supabase **sí** se usa en Consulta Stock para el historial/auditoría en `stock_sync_history`: los snapshots se construyen exclusivamente a partir del stock leído de Google Sheets y nunca sustituyen la fuente de inventario de `SIG_SEARCH`.

> **Inmunizaciones se retiró el 2026-10-03.** Todo el dominio (módulos `IMMUNIZATION_*`, servicios, tipos, documentos de fase, scripts y SQL propios) se eliminó de esta aplicación porque se está reconstruyendo como un sistema aparte. No lo reintroduzcas aquí. El kit visual que nació con ese módulo se conservó con nombres neutros en `components/ui/kit.tsx`.

---

## 1. Qué es este proyecto

Aplicación web interna (SPA React + Vite + TypeScript) para la **DIRESA San Martín (Perú)**, del dominio **Farmacia / SISMED**:

- **Análisis de requerimiento** (`DASHBOARD`, `ANALYSIS`) y **Lista de Exclusiones** (`ANALYSIS_EXCLUSIONS`).
- **Disponibilidad** (`AVAILABILITY`): disponibilidad de productos y DME (ficha 28) por establecimiento, microred y UNGET a partir de archivos que se suben.
- **Consulta Stock** (`SIG_SEARCH`, `components/SheetSearchModule.tsx`) y **Stock SISMED** (`IPRESS_STOCK`, `components/AssignedIpressStockModule.tsx`), ambos leídos de Google Sheets.
- **Redistribución** (`REDISTRIBUTION`).
- **Columnas de Stock** (`ADMIN_STOCK_ASSIGN`), en la sección Stock del menú: qué columnas ve cada establecimiento en Stock SISMED.
- **Herramientas**: **Claves de envío** (`ADMIN_SEND_KEYS`) y **Backups SISMED** (`ADMIN_BACKUPS`).
- **Administración**: usuarios, roles, establecimientos, regímenes y profesiones y parámetros.
- **Perfil** (`PROFILE`).

Idioma del proyecto: **español**. Documentación, commits, UI, mensajes de error y nombres de módulos en español. Código (identificadores) en inglés/camelCase.

---

## 2. Comandos

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

- `npm run lint` = `tsc --noEmit`. **No hay ESLint.** Es la única verificación estática.
- `npm run build` = `tsc && vite build`. Vite emite una advertencia de *bundle grande*: es preexistente y **no bloquea**.
- `npm test` = `vitest run`. Pruebas de servicios, enfocadas en lo que se puede romper en silencio. No hay tests de componentes. `services/appRoutes.test.ts` incluye una prueba que **falla si agregas un módulo sin declararle ruta**.
- Servidor local: `http://127.0.0.1:3000/ToolkitSISMED/` (nota el `base: '/ToolkitSISMED/'` en `vite.config.ts`).
- Las dependencias se instalan con `npm ci` (instalación exacta del lock). Si `npm ci` se queja de un paquete que falta, sincronizar el lock con `npm install --package-lock-only` y volver a validar.
- `.github/workflows/verificacion.yml` corre `npm ci`, `lint`, `test` y `build` en cada pull request y en cada cambio de `main`. No sustituye validar en local antes de subir, pero avisa si algo se rompió.
- En Windows, si `npm` falla desde bash, usar `npm.cmd`.

**Regla de cierre:** todo cambio termina con `npm run lint`, `npm test` y `npm run build` en verde. Si toca reglas de negocio con lógica no trivial, agrega pruebas.

---

## 3. Repositorio y despliegue

El trabajo se integra en `main` mediante pull requests.

**Unir los PR (pedido del usuario, 2026-10-05: «únelo tú, siempre»):** cuando la verificación de GitHub pasa y no hay conflictos, el agente une el PR sin esperar a que se lo pidan, y avisa.

**Si `main` vuelve a divergir por subir el proyecto desde Google AI Studio** (historias sin ancestro común, un `merge` normal da conflicto en todos los archivos), la receta es una confirmación de unión de dos padres que toma el árbol de la rama de trabajo:

```bash
git commit-tree "HEAD^{tree}" -p origin/main -p HEAD -m "merge: ..."
```

Conserva ambas historias y deja como contenido el proyecto vigente.

El sitio se publica en la rama `gh-pages` con el `dist` compilado. `.github/workflows/deploy.yml` lo hace en cada cambio de `main`, inyectando las variables de Supabase desde los secretos del repositorio. A mano:

```bash
npx gh-pages -d dist -r https://github.com/jchaconv94/ToolkitSISMED.git
```

Requiere credenciales de GitHub del usuario. **El entorno bloquea `git push` y el despliegue**, así que esos dos pasos los ejecuta siempre el usuario; prepárale el commit y el build, y dale el comando exacto.

---

## 4. Arquitectura

```
App.tsx                     Router manual por `currentView` (string switch, sin react-router)
index.tsx                   Bootstrap
types.ts                    Fuente única de tipos, AppModule y AVAILABLE_MODULES
contexts/AuthContext.tsx    Sesión, rol, hasPermission()
contexts/BackupManagerContext.tsx  Descargas de backups que siguen al cambiar de módulo
contexts/NotificationsContext.tsx  Datos de la campanita de avisos de la cabecera
components/                 Un archivo .tsx por módulo (componentes grandes, sin subcarpetas por dominio)
components/navigation.ts    Secciones del menú (Farmacia, Stock, Herramientas, Administración): fuente única de la barra lateral, del Inicio y de la navegación del teléfono
components/ToolSearch.tsx   Buscador de herramientas (campo de la cabecera, lupa en el teléfono, Ctrl+K); filtra con components/toolSearchFilter.ts
components/ui/              Kit compartido: kit.tsx, ConfirmationDialog, CustomSelect, TablePagination
services/                   Acceso a datos, reglas de dominio y generación de documentos
docs/                       Toda la documentación (auditorías, planes). Solo README y AGENTS viven en la raíz
public/                     Ícono (favicon.svg), íconos PNG de la app, manifest.webmanifest y sw.js (service worker: permite instalar la app —services/installApp.ts maneja «Instalar app» del menú del usuario— y desde el 2026-10-08 guarda todos los archivos del build para abrir sin internet; ver docs/MODO_SIN_INTERNET.md)
supabase/                   Todos los .sql que el usuario ejecuta a mano en el panel de Supabase
backend/                    Google Apps Script legado
cloudflare/conexion         Servicio de conexión de Backups SISMED (se publica desde GitHub)
```

**No hay react-router.** La navegación es `currentView: AppModule` en `App.tsx`, con `Sidebar` (escritorio) y la barra inferior de pestañas de `components/MobileNavigation.tsx` (teléfono) como disparadores. La URL se sincroniza a mano con `history.pushState` usando `services/appRoutes.ts`.

**Lateral de escritorio (desde el 2026-10-04).** Siempre arranca contraído (solo íconos); se expande y contrae con el botón de la cabecera, junto al título. No hay ítem «Inicio»: la marca lleva a Inicio. Contraído, al pasar el mouse o llegar con el teclado, el ícono crece y se estira en una pastilla teal con el nombre, sin brillo (pedido del usuario; va en un portal para que el `<nav>` no la recorte). Expandido, cada sección lleva su color (punto en el título y cuadrito del ícono, el mismo tinte que en Inicio) y el módulo abierto es una pastilla teal sólida. La marca ocupa la altura de la cabecera, con la línea que la continúa.

**Navegación del teléfono (desde el 2026-10-03).** Por debajo de `md` no hay lateral: una barra inferior con «Inicio» y una pestaña por sección visible, y al tocar una sección se abre su pantalla con la lista de herramientas. Todo se deriva de `components/navigation.ts`; ya no existe `MobileNav.tsx` con su lista propia. La pantalla de sección es Inicio con `?seccion=<id>` (`pathForSection` / `viewForLocation` en `appRoutes.ts`), así forma parte del historial y la flecha «volver» y el botón atrás regresan de una herramienta a su sección. Perfil y Cerrar sesión se abren desde el avatar (`UserMenu`).

Al agregar un módulo hay que tocar **cinco** lugares:

1. `types.ts` → union `AppModule` + entrada en `AVAILABLE_MODULES`
2. `App.tsx` → import, título de cabecera, render condicional y fallback de permisos
3. `services/appRoutes.ts` → su ruta (`administracion/claves-de-envio`, etc.)
4. `components/navigation.ts` → la sección a la que pertenece (de ahí salen la barra lateral, la pantalla de Inicio y la barra inferior y las pantallas de sección del teléfono)
5. Permisos por rol en Supabase (`roles_config.allowed_modules`)

Si la herramienta trabaja con lo que se sube al navegador y no guarda nada en la base, **debe funcionar sin internet** (pedido del usuario del 2026-10-08): `offline: true` en `components/navigation.ts`, sus lecturas de Supabase con copia (`withOfflineCache`) y prueba con la red cortada. Lista completa en `docs/MODO_SIN_INTERNET.md`.

Olvidar cualquiera deja el módulo inaccesible, sin título o sin URL propia. El paso 3 está protegido: `services/appRoutes.test.ts` falla si un módulo de `AVAILABLE_MODULES` no tiene ruta declarada. Si un módulo nuevo debe verlo el ADMIN aunque su rol en Supabase aún no lo tenga, añádelo también a la excepción de `hasPermission` en `contexts/AuthContext.tsx`.

**Rutas y GitHub Pages.** `APP_BASE = "/ToolkitSISMED"`. Pages devuelve 404 ante cualquier ruta que no sea un archivo real, así que el build copia `index.html` a `404.html` para que la SPA resuelva la navegación profunda. Al cerrar sesión, `App.tsx` devuelve la URL a la raíz: si no, la ventana se queda en la ruta del usuario anterior.

---

## 5. Persistencia y seguridad

- **Supabase** (`services/supabaseClient.ts`) es el backend real. Cliente `anon`.
- **Autenticación propia** sobre tabla `users` con `bcryptjs` — **no** se usa Supabase Auth.
- Como la base no conoce al usuario por sí misma, el acceso se resuelve con un **token de sesión propio**; ver el recuadro de abajo. El alcance territorial se sigue recortando también en el frontend (`services/jurisdictionService.ts`), pero no es la única defensa.

> **La clave `anon` es pública**: el workflow de GitHub Pages la inyecta en el build, así que cualquiera puede extraerla del bundle desplegado. Todo lo que `anon` pueda hacer, lo puede hacer cualquiera en internet.
>
> **Modelo de acceso vigente (desde el 2026-08-01).** `app_login` valida la contraseña en el servidor y devuelve un token de sesión de 12 h. El cliente lo adjunta en la cabecera `x-session-token` mediante un `fetch` propio en `services/supabaseClient.ts`. Las tablas protegidas tienen RLS que exige ese token (ver `supabase/SUPABASE_SEGURIDAD_*.sql`), y las escrituras sobre `users` / `roles_config` pasan por funciones `SECURITY DEFINER` que exigen sesión de ADMIN.
>
> **Reglas al tocar esta zona:**
> - Nunca pidas `password_hash` ni uses `select("*")` sobre `users`; usa `USER_SELECT`.
> - Una tabla nueva necesita su política de sesión, o quedará abierta a internet.
> - Si añades RLS: **despliega primero, aplica el SQL después.** Al revés dejas la app sin datos hasta que el navegador recoja la versión nueva.
> - `pgcrypto` no verifica hashes `$2b$` (los que genera bcryptjs). Las funciones reetiquetan el prefijo a `$2a$` al comparar; no toques eso sin leer `docs/SEGURIDAD_AUDITORIA.md`.
>
> Auditoría, hallazgos y lo que sigue pendiente: `docs/SEGURIDAD_AUDITORIA.md`.
>
> **Modo sin internet y «Mantener sesión iniciada» (2026-10-08).** Detalle en `docs/MODO_SIN_INTERNET.md`. La casilla viene marcada y reemplaza a «Recordar mi usuario». Con ella, la sesión va en `localStorage` (`services/sessionStore.ts`), no se cierra por inactividad y la app abre sin internet hasta 45 días desde la última comprobación con internet. El servidor alarga el token con `app_session_keep` (`supabase/SUPABASE_SESION_MANTENIDA.sql`); sin ese SQL dura 12 h. El PIN y la huella siempre mantienen la sesión. **Nunca reintroduzcas un ingreso sin servidor:** hasta el 2026-10-08, sin conexión, el login aceptaba `admin`/`123` del código y entraba como Administrador. Sin internet, las peticiones a Supabase fallan al instante con `code: "OFFLINE"` (`services/supabaseClient.ts`) y `services/connectivity.ts` dice si hay conexión: úsalo (`isOnline`, `useOnline`) en vez de `navigator.onLine`, que no nota una red sin salida a internet.
>
> **Acceso rápido con PIN (PC) o huella (celular), desde el 2026-10-04.** Todo en Supabase, sin servidor propio: `supabase/SUPABASE_INGRESO_PIN_HUELLA.sql` (tabla `app_devices`, funciones `app_device_*`). El equipo guarda una llave al azar (`services/deviceAccess.ts`) y Supabase su SHA-256 y el PIN con bcrypt; nunca se guarda la contraseña. 5 PIN equivocados bloquean el equipo; cambiar la contraseña desactiva todos los equipos. El PIN (PC) y la huella (celular) se activan en Perfil (`components/QuickAccessCard.tsx`) y se usan en el login (`components/PinLogin.tsx`, `components/FingerprintLogin.tsx`). La huella es WebAuthn con el lector del teléfono como verificación local (`createFingerprintCredential` / `verifyFingerprint`): libera la llave del equipo, pero Supabase no verifica firmas WebAuthn. WebAuthn no acepta direcciones IP: para probar en local usar `localhost`, no `127.0.0.1`.

---

## 6. Módulos

| `AppModule` | Etiqueta UI | Componente |
|---|---|---|
| `HOME` | Inicio | `components/HomeModule.tsx` (todos lo ven; `hasPermission` siempre lo permite). Rediseñado el 2026-10-05 sobre una referencia del usuario: saludo con un resumen compacto en blanco a su costado: **«Stock actualizado»** de su jurisdicción para niveles DIRESA, OGESS, UNGET o global con Consulta Stock (la «última actualización» de cada hoja de Google Sheets, con los mismos cortes de Consulta Stock —`services/syncBuckets.ts`: 1 h al día, 24 h con retraso— y las mismas conexiones —`services/stockConnectionScope.ts`, la regla que antes vivía dentro de `SheetSearchModule`—; lo calcula `services/networkStockStatus.ts`, se guarda en el navegador para mostrarse al instante, se recalcula cada 15 min o con el botón «Actualizar ahora», y como guarda la fecha de cada hoja reclasifica cada minuto con la hora actual sin releerlas; usa su propia petición de metadatos porque compartir la caché de `fetchGasMetadata` con Consulta Stock le dejaba el directorio vacío), o el propio stock del responsable de farmacia (también guardado para mostrarse al instante): lotes vencidos, por vencer según la ventana de Parámetros y al día —no hay «sin stock»: la hoja solo trae lotes con saldo—; datos de `useNotifications`, calculados en `services/homeSummary.ts`), «Accesos frecuentes» en recuadros con animación al pasar el mouse (`services/frequentTools.ts`, cuenta en `localStorage` por usuario cada módulo abierto) y «Todas las herramientas» en listas con flecha. Sin aviso debajo del saludo y sin resumen oscuro o llamativo (rechazados). |
| `DASHBOARD` | Análisis de Requerimiento | `AnalysisModule` en `App.tsx` (+ `InputSection`, `Dashboard`, `AnalysisTable`) |
| `ANALYSIS_EXCLUSIONS` | Lista de Exclusiones | `components/AnalysisExclusionsModule.tsx` |
| `AVAILABILITY` | Disponibilidad | `components/AvailabilityModule.tsx` (2026-10-06). **Desde el 2026-10-09 abre en el Historial de disponibilidad** (`components/AvailabilityHistory.tsx`): lo guardado mes a mes en Supabase por establecimiento y vista (conteos por situación, no productos; el porcentaje se recalcula con la fórmula vigente y la microred/UNGET salen del registro actual), con el año anterior, filtros de año, mes, UNGET y microred, y la jurisdicción recortada en el servidor. El tablero de siempre es el «Reporte del mes», con «Guardar en el historial» (y relleno hacia atrás si el TFORMDET trae más de 12 meses). Reglas, casos de falla y pruebas en `docs/DISPONIBILIDAD_HISTORIAL.md` (léelo antes de tocar el historial); SQL `supabase/SUPABASE_DISPONIBILIDAD_HISTORIAL.sql`. Se sube **solo la consulta TFORMDET del Toolkit** (desde el 2026-10-06 una sola casilla; ya no el archivo de disponibilidad ni un TFORMDET aparte para lotes). Se lee en un Web Worker (`services/tformdetReader.worker.ts`) con un lector propio de xlsx (`services/fastXlsx.ts`, fflate + recorrido del XML, con pruebas: ~6 s frente a ~22 s de SheetJS en un TFORMDET de 12 meses, y la pantalla no se congela); si falla, se usa SheetJS. **Desde el 2026-10-09 descomprime y recorre la hoja por trozos**: un TFORMDET de 21 o 24 meses del Toolkit 2.3.1 (XlsxWriter en memoria constante, textos dentro de cada celda) pasa de 600 MB sin comprimir y no cabía en un solo texto del navegador (~512 MB); el archivo no se leía y salía «Suba la consulta TFORMDET». Uno de 24 meses tarda ~18 s. (Uno o varios meses con ANNOMES; el reporte usa siempre los últimos 12 —`lastMonthsOf`, decisión del usuario del 2026-10-09— y los anteriores solo llenan el historial; `parseTformdetHistory`: consumo = VENTA + SIS + INTERSAN + **EXO** + SOAT + CREDHOSP + OTR_CONV como el reporte de Disponibilidad del Toolkit (EXO, lo entregado exonerado de pago, cuenta desde el 2026-10-07 en la web y en el Toolkit, decisión del usuario; las otras salidas OTRAS_SAL se guardan aparte en `otherOut`), stock = STOCK_FIN del último mes, lotes del último mes, almacenes como 030S05 fuera de la disponibilidad (su stock del mes de corte se guarda en `warehouse` y va al Excel: columna «Stock en almacén» en Atención y hoja «Almacén» con lotes y cuántos establecimientos lo necesitan); los ítems sin stock al corte y sin consumo en todo el periodo no se evalúan, como el archivo de disponibilidad del SISMED (comprobado con agosto 2026: mismas 11 444 filas por farmacia y 71,68 %); microred y red salen del registro de Establecimientos; la clasificación MEDTIP/MEDPET/MEDEST/MEDFF la trae desde el **Toolkit 2.2.5**, sin ella solo se calcula «todos los productos». La IPRESS es la suma de sus farmacias; los lotes dan el vencimiento más próximo y «vence antes de usarse»); todo se calcula en el navegador; a Supabase solo sube el resultado por establecimiento cuando se guarda en el historial. **El TFORMDET se guarda en este equipo** (2026-10-08, pedido del usuario: no volver a subirlo al recargar; primer paso para trabajar sin internet): IndexedDB por usuario con `services/availabilityStore.ts` (localforage, solo IndexedDB porque guarda Map y fechas tal cual), se restaura al abrir el módulo y entra directo al tablero; los cambios del plan de redistribución se guardan ligados al archivo y a la vista (Todos/Esenciales) y se descartan si cambia el archivo; la X de la casilla de carga lo olvida. Reglas en `services/availabilityReport.ts` (con pruebas; comprobado contra el Excel del usuario): CPA = consumo ÷ meses con consumo; no existe «Sin consumo». **La fórmula es configurable** (botón «Configuración», solo ADMIN; `components/AvailabilityConfigDialog.tsx`, `services/availabilityConfig.ts`, tabla `availability_config` de `supabase/SUPABASE_DISPONIBILIDAD_CONFIGURACION.sql`; sin ese SQL se usa la de fábrica): qué situaciones cuentan como disponibles por vista (de fábrica Normo + Sobre; Sin rotación no en «todos», solo vitales en la DME), corte a un decimal (**apagado** en este módulo, pedido del usuario; el Análisis sí corta), límites 2/6 meses, niveles 90/80/70 y microred/UNGET por promedio de establecimientos o suma de ítems. En la misma ventana se administran el listado de códigos fusionados (subir el Excel nuevo de DIGEMID, ver diferencias, volver al anterior, editar grupos) y los **114 vitales** de la RM 1288-2018 (`services/vitalProducts.ts`, cruzados con el catálogo de DIGEMID; 2 sin código), con vista previa del porcentaje antes de guardar. La vista principal es **todos los productos**; «Medicamentos esenciales» es la DME: M, EST «S»/«_», del petitorio o del listado de **códigos fusionados** de DIGEMID (`services/fusedCodes.ts`, 2026_01 V0.6, es solo el de fábrica: el ADMIN carga el nuevo desde la configuración), sumando stock y consumo de cada grupo en su código destino. Un KPI por nivel (el usuario rechazó juntar Óptimo con Alto). Excel: `services/availabilityExport.ts` (rehecho el 2026-10-06: «se comparte para que otros lo analicen»): portada con banda oscura, **nombre y profesión de quien lo generó**, indicador grande, recuadros por nivel y situación, mejores/peores establecimientos, microredes y ficha técnica; luego Establecimientos, Microredes, Atención, Productos por establecimiento y por farmacia (consumo mensual plegable), **los registros del TFORMDET del mes de corte** tal como vienen (lotes, registro sanitario, consumo por tipo; `tformdetLastMonth`) y Metodología (paso a paso con ejemplos, tablas de situaciones y niveles con la regla exportada). **Portada con gráficos (aprobada el 2026-10-06, opción A con las tarjetas de la B):** cabecera con título + UNGET en mayúsculas + corte y el responsable a la derecha; tarjetas KPI, velocímetro, columnas por nivel, dona de situaciones, barras por microred y ranking con franjas de nivel. Los gráficos se dibujan en un `OffscreenCanvas` (`services/availabilityCharts.ts`) y van como PNG anclados por píxeles (`placeImage`); sin lienzo (pruebas) el Excel sale sin imágenes. Los hallazgos van en su propia hoja «Hallazgos» (tarjetas); Establecimientos, Atención y Almacén llevan tarjetas encima de la tabla (la tabla empieza en la fila 10). Ajustes del usuario del 2026-10-06: textos a la izquierda y códigos/números/estados centrados (`alignOf`), barra de datos con el valor en blanco y negrita (`bar`), cabecera oscura en cada hoja, lotes al final en «Almacén» y «Hallazgos principales» en la portada. Se arma en un Web Worker (`services/availabilityExport.worker.ts`, lanzado por `services/availabilityExportClient.ts`) para no paralizar la página; las celdas de `writeTable` comparten el estilo de su columna (de ~25 s a ~7 s al serializar), así que para pintar una celda se usa `restyle`, nunca `cell.fill = …` (cambiaría toda la columna). **Tablero web (aprobado el 2026-10-07):** sin columna lateral (rechazada): título del reporte arriba de las pestañas («UNGET …» y «Datos al corte de … · N meses» a la izquierda; Todos/Esenciales, Exportar y ⋯ —con Configuración y cargar otro TFORMDET— a la derecha; **nada en la cabecera de la app**, pedido del usuario), pestañas horizontales Resumen · Establecimientos · ¿Dónde falta? · Vencimientos · Consumos irregulares · Clasificación ABC · Sobrestock · Redistribución · Almacén, y gráficos a todo el ancho. El establecimiento se abre como página (consumo mensual valorizado, productos con su curva) y el producto en un panel lateral (consumo con CPA, lotes FEFO, otros establecimientos). Explicaciones solo detrás del ícono «i» (`InfoTip`), en lenguaje neutro y sin dirigirse a nadie. Cálculos en `services/availabilityInsights.ts` (con pruebas): riesgo por lote FEFO, picos (×3 el promedio de los **otros meses con consumo** —los ceros no cuentan y un máximo repetido no es pico—, ≥ 20 u, ≥ 3 meses) y XYZ contado desde el primer mes con consumo (`fromFirstUse`: un producto nuevo no es «irregular» por los meses previos en cero; corregido el 2026-10-07 tras un caso de 0…0, 30, 30, 30 marcado como pico); al tocar X, Y o Z la tabla muestra los ítems de ese tipo, ABC por valor (80/95 %), sobrestock inmovilizado (lo que pasa de CPA × 6 meses, × precio), redistribución (excedente a desabastecido/substock, misma microred primero, hasta 2 meses), dónde falta y cobertura del almacén. Gráficos SVG en `components/AvailabilityCharts.tsx`, todos con recuadro al pasar el mouse (`useChartTip` + `TipBox`) y resaltado del elemento (la dona muestra en el centro el segmento señalado); el menú ⋯ es desplegable en escritorio y panel inferior en el celular; la barra de pestañas se pega arriba sin rendija (`-top-2.5 sm:-top-3`, igual al relleno de `<main>`); pantallas en `components/AvailabilityReports.tsx`. Ajustes del 2026-10-07: la línea de CPA/promedio va detrás de las barras con su leyenda arriba (fuera de las barras) y los valores con halo blanco; se resaltan en rojo **todos** los meses que empatan en el máximo; el consumo valorizado va en soles (`moneyShort` en las barras, `money` en el recuadro); las situaciones del detalle filtran la tabla al tocarlas; el detalle se cierra con la X de su esquina (la ruta «← Establecimientos › …» se probó y se rechazó; en el celular, la flecha de la cabecera); la leyenda de la línea punteada va pegada a su texto; **la paginación no se pierde** al abrir un detalle (la tabla solo vuelve a la página 1 si cambian sus filas, por firma, y los reportes siguen montados ocultos mientras el detalle está abierto, con la posición de la pantalla restaurada al cerrar). **Riesgo de vencimiento por farmacia (2026-10-07):** en un establecimiento con farmacias o puestos comunales los lotes son de cada farmacia y se consumen a su propio ritmo, así que el FEFO se calcula por unidad (`byPharmacy` del contexto): **los puestos comunales por separado** (otro local, su propio stock) y **la F01 con las farmacias del hospital (tipo FARMACIA) sumadas como una sola**, porque el stock se mueve entre ellas dentro del mismo local; **una F02+ sin tipo en el registro se trata como puesto comunal** (decisión del usuario, para no esconder riesgos) y Establecimientos muestra un aviso ámbar con la lista para registrarlas (`isSeparateSite`, `pharmacyKind` en `services/availabilityInsights.ts`, con pruebas: Principal / Puesto comunal / Farmacia del hospital / Sin tipo). Los lotes llevan su farmacia (`Lot.site`, desde el TFORMDET). **La F01 que abastece a sus puestos** (sin farmacias del hospital) les entrega como OTRAS_SAL, que no es consumo: para su riesgo de vencimiento el CPA es consumo + otras salidas (`asSupplier`, con `dispensedCpa` para lo solo dispensado; punto A de la auditoría). En el hospital no se suma, porque ahí esas salidas van a sus propias farmacias, ya sumadas en la unidad. La disponibilidad no cambia. La disponibilidad oficial sigue siendo por IPRESS con todo sumado. en Vencimientos, el Resumen y el detalle; las filas de un puesto dicen «Establecimiento › F02 Puesto» y la tabla de lotes del panel lleva la columna Farmacia (dónde está cada lote). Antes se mezclaban los lotes de todas y el mismo lote salía repetido sin saber de quién era. Los paneles de detalle (producto y producto en la red) se recorren con ‹ N de M › en su encabezado o con las flechas ← → del teclado, en el orden y con los filtros de la tabla de donde se abrieron (`onRowClick(fila, filas)` de `ReportTable`, `drawerNav`, `useDrawerKeys`). **La tabla sigue al panel (punto G, 2026-10-09):** al pasar de registro salta a la página del registro abierto (en el celular, carga la lista hasta él) y al cerrar lo deja a la vista y lo resalta un momento (`drawerFollower` en `AvailabilityReports.tsx`: se ata a la lista del mismo largo que navega, para no moverse con un panel abierto desde otro panel; `showAtLeast` de `useIncrementalCount`). En «Consumo de la red» la línea es el CPA de la red: promedio de los totales mensuales (antes era la suma de los CPA de cada establecimiento y salía por encima de todas las barras). En todas las tablas de reportes los nombres (producto, establecimiento, microred, quién entrega/recibe) van a la izquierda y todo lo demás centrado (`alignOf` / `TEXT_COLUMNS` en `ReportTable`, pedido del usuario del 2026-10-07). Al tocar un indicador o un gráfico que filtra, la pantalla baja hasta la tabla (`useTableAnchor` + `anchorRef` de `ReportTable`). **Puestos escondidos en la cifra del establecimiento (punto B de la auditoría, 2026-10-07):** «¿Dónde falta?» tiene la tarjeta y pastilla «Faltan en un puesto» (`siteGapReport`: puesto comunal desabastecido con consumo cuyo establecimiento sumado no está desabastecido ni en substock; tabla propia con el stock de su F01), y Redistribución incluye las **internas F01 → puesto**. Solo aparece si el TFORMDET trae farmacias. **Redistribución es un plan editable (punto C, aprobado el 2026-10-08 tras varias vueltas):** `redistributionPlan` arma **una fila por necesidad** (establecimiento o puesto desabastecido/substock con consumo × producto, lo que le falta para el límite de substock) con todas sus fuentes ya calculadas, en el orden que eligió el usuario (opción A): el puesto, de su F01 (que se queda con CPA × límite de substock de lo que dispensa); el establecimiento, primero del **excedente de otros** (lo que pasa del límite de sobrestock, primero de la misma microred) y lo que falte **del almacén**. Cada fuente tiene un saldo («le queda», `planUsage`); nada se abastece dos veces (el interruptor «cubrir primero desde el almacén» se probó y se rechazó: recalculaba y duplicaba). La tabla lleva **un dato por celda** (Producto · Recibe · Situación · Necesita · De otros · Del almacén · Falta · Estado · Distribuir; el usuario rechazó varias fuentes en una celda: NN/g, Carbon y PatternFly lo desaconsejan) y la edición vive en un **panel lateral no modal** (`PlanDrawer`, en portal) con quién entrega, puede dar, le queda y asignado, todos los que tienen excedente para elegir, ‹ › y «Volver a la sugerencia». Toda la fila abre el panel; la casilla «Distribuir» solo marca. Combo «Todas / Incluidas / Excluidas» y «Deshacer» (con `ConfirmationDialog`) en la misma línea del buscador (pedido del usuario: nada que salte a otra fila). Los cambios viven en el módulo (`planEdits` del contexto) y se pierden al cambiar de datos. El botón «Excel» (el mismo de las demás pestañas) arma un Excel (`buildTableWorkbook` de `services/availabilityExport.ts`) con hojas Entre establecimientos (por quién entrega, para el digitador), Desde el almacén, Internas F01 - puesto y Sin cubrir; se bloquea si alguna fuente se pasa de su saldo. **Otras salidas (punto F, 2026-10-09):** el TFORMDET se lee también con sus salidas que no son consumo, por tipo y mes (`TFORMDET_OUTFLOWS`, `outflows` de cada fila: devoluciones, distribución, vencidos, merma, otras salidas…; todas restan del stock, comprobado; SAL_CONINS/SAL_REGULA/ING_REGULA son informativas y FAC_PERD/DEV_VEN/DEV_MERMA no se usan). El panel del producto las muestra («Otras salidas (no son consumo)»; sin consumo dice si salió por otra vía o si el stock no se mueve) y Vencimientos separa el dinero de lo que no se mueve nada (`isStill`, filtro «Sin ningún movimiento»). Un TFORMDET guardado antes no las trae: el panel pide volver a cargarlo. En el panel, la columna de lotes es «Por consumir» (antes «Se usa») y «En otros establecimientos» es una tabla con Stock, Meses de stock y Situación (antes «30 u · 0,0 m», que no se entendía). **Meses al vencimiento desde el cierre del corte (punto E, 2026-10-09):** el stock del TFORMDET es al último día del mes de corte, así que todo lo que mide el tiempo hasta vencer cuenta desde esa fecha (`cutDateOf`, `asOf` del contexto) y no desde hoy, en la web y en el Excel; las tarjetas de vencimiento dicen «al 30/09/2026». **Dinero que no se cuenta dos veces (punto D, 2026-10-08):** en el Resumen, «Sobrestock inmovilizado» va sin lo que ya cuenta en «Vence sin usarse en 12 meses» (`overstockAtRisk`); la pestaña Sobrestock muestra el total y cuánto de ello vence. **Excel por pestaña (2026-10-08):** cada tabla del tablero tiene un botón «Excel» que descarga lo que muestra (con su búsqueda, filtro y orden): `excel` de `ReportTable` con columnas propias (`ExcelColumn`: código y nombre por separado, consumo mensual en columnas, fechas y porcentajes con formato; ayudantes `xProduct`, `xSite`, `xMonths`, `xCounts`) y `buildTableWorkbook`. Los filtros de las tablas (`Pills`) son un **combo en escritorio** y pastillas deslizables en el celular, para que buscador, filtro y botones queden en una sola línea (pedido del usuario: «no bajes a la segunda fila»). Gráficos «Establecimientos con más excedente para transferir» y «… con más productos por recibir» (el usuario pidió títulos profesionales, no «Quién entrega más»). En «¿Dónde falta?» los indicadores y las pastillas filtran lo mismo, siempre sobre los desabastecidos: Desabastecidos, Faltan en muchos (≥ 25 % de los establecimientos), «A otro le sobra» (antes «Hay quien los cede», no se entendía) y Se pueden cubrir (le sobra a otro o hay almacén); la columna es «Les sobra». Las tablas de Establecimientos y Microredes muestran las cinco situaciones (Desab., Sub, Normo, Sobre, Sin rot.) y el total de ítems, iguales en las dos vistas (`situationColumns`). **Por farmacia (2026-10-07):** en Establecimientos, los que tienen más de una farmacia o puesto comunal (F01 principal, F02…) se despliegan con la flecha de la izquierda y cada uno se abre como un establecimiento más (`pharmacyGroups`, `summarize` sobre los ítems por farmacia; nombre y tipo PUESTO_COMUNAL/FARMACIA del registro); en su detalle la cabecera es la misma de cualquier establecimiento y **el nombre es una lista desplegable** (▾) con «Todo el establecimiento» y cada farmacia con su porcentaje (buscador si son más de 6; panel inferior en el celular; `PharmacyTitleMenu`). Se probaron y rechazaron: fila de tarjetas por farmacia, botón chico junto a los chips, pestañas o lista en el espacio libre, recuadros independientes y casillas dentro del rectángulo. «Desabastecimiento recurrente» se descartó (requería guardar datos). **Auditoría del 2026-10-07:** `docs/DISPONIBILIDAD_AUDITORIA.md` (qué se revisó, qué se corrigió y los pendientes A–H que esperan decisión del usuario; léelo antes de tocar este módulo). Desde entonces el Excel recibe el riesgo de vencimiento de la web (`expiryRisk` en los parámetros, FEFO por farmacia) y la explicación «i» (`InfoTip`) se dibuja en un portal ajustado a la pantalla. |
| `SIG_SEARCH` | Consulta Stock | `components/SheetSearchModule.tsx` |
| `IPRESS_STOCK` | Stock SISMED | `components/AssignedIpressStockModule.tsx` |
| `REDISTRIBUTION` | Redistribución | `components/RedistributionModule.tsx` |
| `ADMIN_USERS`, `ADMIN_ROLES`, `ADMIN_FACILITIES`, `ADMIN_CATALOGS`, `ADMIN_PARAMS` | Administración | `components/AdminPanel.tsx` (pestañas) |
| `ADMIN_STOCK_ASSIGN` | Columnas de Stock | `components/AdminStockAssignmentModule.tsx` |
| `ADMIN_SEND_KEYS` | Claves de envío | `components/AdminSendKeysModule.tsx` |
| `ADMIN_BACKUPS` | Backups SISMED | `components/BackupsSismedModule.tsx` |
| `PROFILE` | Perfil de Usuario | `components/UserProfile.tsx` (todos lo ven desde el 2026-10-04: `hasPermission` siempre lo permite y ya no figura en Roles). Rediseñado el 2026-10-05: en escritorio, banda oscura compacta con avatar, nombre y etiquetas (elegida el 2026-10-05); en el celular, portada con el avatar montado y centrado y «Editar datos» flotante; los tres bloques del mismo alto, bloques Datos personales / Trabajo / Cuenta y seguridad (el acceso rápido es una fila más, `QuickAccessCard embedded`, y sus equipos se ven en una ventana: así los tres bloques quedan parejos), y dos ventanas `ResponsiveDialog`: «Editar datos» (incluye DNI, usuario y fecha de nacimiento: el propio usuario puede cambiarlos, decisión del usuario del 2026-10-05; se probó restringirlo y se descartó) y «Cambiar contraseña». La fecha de nacimiento necesita `supabase/SUPABASE_PERSONAL_FECHA_NACIMIENTO.sql`; sin él se guarda lo demás y se avisa. |

`ANALYSIS` sigue declarado en `AVAILABLE_MODULES` y en las rutas, pero no tiene pantalla propia.

---

## 7. Migraciones SQL

Los `.sql` de `supabase/` son **scripts que el usuario ejecuta manualmente en el panel de Supabase**. No hay CLI de migraciones ni control de versión de esquema. Al crear una migración: archivo nuevo en `supabase/`, idempotente donde sea posible.

**El entorno del agente no puede aplicar SQL ni desplegar.** Prepárale al usuario el script y el comando exactos, listos para pegar; él los ejecuta.

Los esquemas `supabase/SUPABASE_SCHEMA.sql` y `SUPABASE_SCHEMA_V2.sql` a `SUPABASE_SCHEMA_V15.sql` son la historia del esquema de farmacia/SISMED. Los scripts `SUPABASE_SEGURIDAD_*.sql` y `SUPABASE_MIGRATION_FACILITIES_CASCADE_UPDATE.sql` todavía nombran tablas `immunization_*` porque se escribieron cuando el módulo existía; se conservan como registro de lo aplicado.

---

## 7 bis. Conexiones de stock: de quién es cada una

Reglas acordadas el 2026-09-21 tras una tanda de defectos (PR #53 a #57, y el arreglo del nombre de las tarjetas). Viven en
`services/ungetConnections.ts`, con pruebas propias. **Antes de tocar `saveUngetConfigs` o
los botones de las tarjetas de UNGET, lee esto.**

**Una UNGET, una conexión, y es de su informático.** `unget_configs` guarda una fila por
UNGET. `saveUngetConfigs` actualiza el resto de campos pero **no cambia el `username`**, y
solo retira filas propias.

**La interfaz no debe ofrecer lo que el guardado no puede cumplir.** Este fue el defecto
caro: la pantalla ofrecía «eliminar» en conexiones ajenas, quitaba la tarjeta del estado
local, decía «Eliminado correctamente» y a la siguiente carga volvía, porque la fila jamás
se tocó. Lo mismo con el engranaje. Por eso:

| Necesitas | Usa |
|---|---|
| ¿Puede este usuario modificarla o retirarla? | `canEditConnection(conexión, username, cuentasActivas)` |
| ¿Se quedó sin responsable? | `isConnectionOrphaned(conexión, cuentasActivas)` |
| ¿Hay que pasarla a nombre de quien guarda? | `shouldAdoptConnection({ existingOwner, claimedBy, saver, orphanOwners })` |
| ¿De qué UNGET es, y por tanto de qué DIRESA y OGESS? | `findUngetForConnection(conexión, ungets)` |
| Quién la mantiene | `connectionOwner(conexión)` |

**Sin responsable** = su cuenta ya no existe o está desactivada. Entonces la adopta quien
la reclame: el admin o el nuevo informático de esa UNGET. **Si el censo de cuentas activas
no llegó, no se declara huérfana a ninguna**: un fallo de red no puede convertirse en
permiso para editarlo todo.

**Solo se adopta lo que se reclama**, es decir, lo que viene a nombre de quien guarda. El
modal de conexiones manda la lista entera en cada guardado; sin esa condición, dar de alta
una hoja te dejaba de responsable —sin decirte nada— de todas las huérfanas a la vista.

**La adopción y la retirada se limitan a las UNGET que el usuario tiene a la vista**
(`visibleUngetIds`). Sin ese límite, el guardado de un informático de UNGET —que solo ve
su jurisdicción— retiraría las huérfanas de todas las demás, que no van en su envío.

**El ámbito territorial de una conexión es el de su UNGET, nunca el de quien la creó.**
Calcularlo desde el creador la sacaba del ámbito de todos en cuanto esa cuenta desaparecía,
y entonces «Nueva conexión» volvía a ofrecer esa UNGET como libre: dos conexiones para la
misma UNGET, justo lo que hubo que limpiar a mano el 18/09.

**La clave ajena.** `unget_configs.username` referencia a `users.username` con
`ON DELETE SET NULL` y `ON UPDATE CASCADE` desde
`supabase/SUPABASE_MIGRACION_CONEXION_SIN_RESPONSABLE.sql` (aplicada el 2026-09-21). Antes
era `ON DELETE CASCADE`: borrar al informático **borraba la conexión de su UNGET**, que se
quedaba sin stock sin que nadie avisara; y renombrar una cuenta lo rechazaba la clave con
un error que en pantalla no decía nada. La papelera de Administración → Usuarios existe y
es la vía que produce ese caso; se decidió conservarla.

**El nombre de una tarjeta de establecimiento** sale del registro, no de la pestaña, y se
resuelve con `facilityForSheet` en `SheetSearchModule`. Hay **dos** caminos que construyen
las tarjetas —la metadata y el payload de Apps Script—; la regla está en un solo sitio
justamente porque cuando estaba repetida solo se actualizó uno.

**La ventana «Conexiones de stock»** (rediseñada el 2026-10-06) es `components/StockConnectionsDialog.tsx`: lista a la izquierda y formulario a la derecha en escritorio; en el celular, lista a pantalla completa, «Nueva conexión» flotante y menú ⋯ por tarjeta. **Solo dibuja**: el estado, el guardado y quién puede editar cada conexión siguen en `SheetSearchModule`, que le pasa cada fila ya resuelta (`editable` sale de `canEditConnection`).

**El engranaje de cada UNGET** abre `components/StockConnectionDetailDialog.tsx`: la conexión completa de esa UNGET, con la hoja como vía principal y la Web App plegada (la dirección interna `sheets://…` de la lectura directa nunca va en el campo de la Web App). Si la conexión es ajena solo se prueba. Las guías «Compartir la hoja» y «Cómo crear la Web App» están en `components/StockConnectionGuides.tsx`.

---

## 8. Convenciones de UI

- **Estilo base:** sidebar oscuro, fondo `slate` claro, tarjetas `rounded-2xl border border-slate-200 bg-white shadow-sm`, iconos `lucide-react`, Tailwind.
- **Color con significado:** teal/cyan = información/stock; emerald = aplicado/cerrado/vigente; amber = pendiente/advertencia; red = vencido/error/bloqueo; blue = vista supervisora; slate = neutro.
- **Densidad:** 1 tarjeta de cabecera, máximo 4–5 KPIs, filtros en **una sola barra** compacta; fechas y filtros avanzados en popover/colapsable, nunca en tarjeta alta.
- **Tablas:** encabezado que se pega arriba al bajar con `useFloatingTableHead` + `FloatingTableHead` (`components/ui/FloatingTableHead.tsx`: a todo el ancho, sin bordes; no usar `sticky` en el `<thead>`), filas 52–60 px, descripción del producto a 13–14 px (no tamaño título), código SISMED en chip/monospace, estados en chips, acciones a la derecha.
- **Administración, rediseño por pantallas (desde el 2026-10-04):** Gestión de Usuarios ya va sin el título grande que repetía la cabecera ni el recuadro alrededor; KPIs Usuarios/Activos/Inactivos, tabla única paginada en escritorio y tarjetas con menú ⋯ en el celular. Configuración de Roles también (desde el mismo día): lista y detalle (en el celular, dos pantallas con la flecha de la cabecera), módulos agrupados por las secciones de `navigation.ts` con interruptores, y barra «Cambios sin guardar» con Descartar/Guardar. En Roles solo se asignan los módulos del menú: `ANALYSIS` (sin pantalla) y `PROFILE` ya no se muestran. **Acciones por rol (2026-10-06):** además de los módulos, cada rol puede tener apagadas acciones dentro de ellos (crear, editar, eliminar, exportar…): el indicador «Todas las acciones» / «N de M acciones» de cada módulo activo despliega sus interruptores. El catálogo vive en `services/moduleActions.ts` (con pruebas) y se guarda la lista de **negadas** en `roles_config.denied_actions` (`supabase/SUPABASE_ROLES_ACCIONES.sql`, función `app_admin_save_role_actions`), así un rol sin tocar conserva todo. En los módulos se usa `can(módulo, acción)` de `useAuth()`: el ADMIN siempre puede todo, y apagar una acción **solo quita** (las reglas propias de cada pantalla, como que solo el ADMIN elimina, siguen encima). Por ahora oculta el botón; la comprobación en Supabase existe solo para usuarios y roles. **Al añadir un botón de acción a un módulo, agréguelo al catálogo y protéjalo con `can`.** Parámetros del Sistema también: secciones por lo que afectan con `SettingsSection`/`SettingsRow` (`components/ui/SettingsSection.tsx`), etiqueta «Cambiado» y barra de guardado en el pie; ya no muestra «Conexión Backend (Google Apps Script)» (`apiUrl`), que nada leía (el valor guardado no se borra). Regímenes y Profesiones también (`AdminCatalogsModule`): dos listas en escritorio, una pestaña para cada una en el celular, cuántos usuarios tienen asignado cada elemento, y crear/editar/eliminar en `ResponsiveDialog`/`ConfirmationDialog` (antes eliminar era un aviso de `toast`). Establecimientos (`AdminOrganizationModule`, 2026-10-05): pestañas de nivel (el nivel IPRESS se muestra como «Establecimientos») con «Nuevo…» a la derecha en escritorio; filtros **a la vista en la barra** junto al buscador en escritorio (el usuario rechazó un modal de filtros: no es buena práctica) y en panel inferior con etiquetas en el celular; los encabezados de tabla ya no filtran; tablas paginadas con encabezado fijo; tarjetas en el celular que abren el detalle. Detalle «premium»: en escritorio, panel oscuro de jurisdicción a la izquierda (al usuario le gusta ese estilo); en el celular solo una cabecera oscura compacta (tipo, nombre, chips) y jurisdicción, dependientes y conexión en bloques claros (el usuario rechazó media pantalla en negro). Eliminar con `ConfirmationDialog` y aviso de dependientes. Los 5 formularios (DIRESA, OGESS, UNGET, Microred, Establecimiento) van a pantalla completa en el celular, con «Paso N de M» y barra de avance, y pie fijo con los botones. **Farmacias de hospital y puestos comunales (2026-10-05):** los códigos `F02` en adelante (`06502F02`) pueden ser `PUESTO_COMUNAL` o `FARMACIA` (las farmacias en que se divide un hospital); el tipo va antes que la categoría. Una **farmacia** solo lleva código, nombre y tipo: hereda categoría, jurisdicción, ubicación y contacto de su IPRESS (sale del código) y se guarda en un paso; si la IPRESS no está registrada no deja guardar; al guardar el hospital, sus farmacias se actualizan solas; no se le asignan usuarios (no sale en el selector de Usuarios). Reglas en `services/facilityHierarchy.ts`, con pruebas. Un **puesto comunal** llena todo, pero en el paso 4 no elige columnas: usa las de su IPRESS; en Stock SISMED ve solo las filas de su ALMCOD y, si la hoja llega consolidada (ninguna fila suya), la hoja entera de su IPRESS con un aviso ámbar (`consolidated` en `services/assignedIpressStock.ts`).
- **Paginación numerada en toda tabla de escritorio; en el celular, lista que carga al bajar** (pedido del usuario, 2026-10-03). Ninguna tabla sin paginar: en escritorio `TablePagination` (`components/ui/TablePagination.tsx`); en el celular nada de páginas, `useIncrementalCount` + `LoadMoreSentinel` (`components/ui/IncrementalList.tsx`). Ejemplo: `AssignedIpressStockModule`.
- **Modelo único de KPIs** (2026-10-03): `KpiCard watermark` dentro de `KpiStrip`, a todo el ancho, con `cols` según cuántos haya (`md:grid-cols-3`, `md:grid-cols-2 xl:grid-cols-4`…). Si filtran la tabla, van con `onClick` y `active`.
- **Operación ≠ supervisión:** en vista propia **no** mostrar columnas de Ubicación/Ámbito (son implícitas en la sesión). Solo el supervisor ve filtros territoriales.
- **Modales:** header fijo + body con scroll interno + footer fijo; sin scroll horizontal; `max-w-3xl` formulario simple, `max-w-5xl` operación con lista, `max-w-6xl` comparación compleja.
- **Botón principal: teal** (`bg-teal-600 hover:bg-teal-700 text-white`, como «Descargar» o «Generar clave»). Nada de botones negros (`bg-slate-900`), pedido del usuario el 2026-10-03.
- **Ventanas (modales) también se adaptan** (pedido del usuario, 2026-10-04: «en un módulo hay que adaptar todas las pantallas, así sean modals»). Formularios y detalles: `ResponsiveDialog` (`components/ui/ResponsiveDialog.tsx`), pantalla completa en el celular y centrada en escritorio, con `DialogSection`/`DialogRow` y los botones `dialogPrimaryButton`/`dialogSecondaryButton`. Confirmaciones: `ConfirmationDialog`, que en el celular sale como panel inferior. Un módulo no se da por rediseñado hasta que todas sus ventanas lo estén.
- **Barras de acción que no flotan** (pedido del usuario, 2026-10-04): una barra como «Cambios sin guardar · Descartar · Guardar» va en el pie de la app con `ModuleFooterPortal` (`components/ui/ModuleHeaderSlot.tsx`), entre el área que se desplaza y la barra de pestañas del celular. Nada de `fixed`/`sticky` encima del contenido: tapaba las últimas filas. Ejemplo: Configuración de Roles.
- **Nunca `window.confirm` / `alert`.** Usar modal propio (`components/ui/ConfirmationDialog.tsx`) para toda acción irreversible.
- **Móvil:** tablas → tarjetas; filtros → bottom sheet; footer sticky en modales; **el botón principal es flotante** (`FloatingActionButton`, abajo a la derecha sobre la barra de secciones; el módulo deja `pb-24` en el celular).
- **Barras de desplazamiento ocultas en todo el sistema** (pedido del usuario, 2026-10-04; `index.css`). No añadir `scrollbar-width: thin` ni estilos de barra. Única excepción: la clase `scrollbar-x` (barra horizontal fina) en tablas que no entran a lo ancho, como la Matriz de Requerimiento (pedido del usuario, 2026-10-04).
- **Nunca el ícono de estrellas/destellos (`Sparkles` de lucide)** (pedido del usuario, 2026-10-05). No usarlo en ningún título, botón ni aviso.
- **Letra:** Inter en todo; `font-sans` también es Inter (`tailwind.config.js`).
- **Acentos:** cuidado con mojibake. `Catálogo`, `Código`, `Redistribución` deben renderizarse correctos en pantalla **y en PDF/Excel** (ver `services/pdfUnicodeFont.ts`).

### Qué reutilizar — mira aquí ANTES de escribir nada nuevo

La capa de componentes comunes **ya existe**. Antes existían cinco `HeaderCell` con relleno y tamaño de letra distintos, cuatro `formatDate`, tres `SummaryCard` y seis `Field`; cambiar un estilo solo afectaba a la pantalla que se tocaba. **No lo reintroduzcas.**

**`components/ui/kit.tsx` — todo lo visual y de formato**

| Necesitas | Usa |
|---|---|
| Tarjeta de indicador / KPI | `KpiCard` (`label`, `value`, `icon?`, `tone?`, `hint?`, `filled?`, `compact?`, `watermark?`, `progress?`) |
| Fila de KPIs (cuadrícula en escritorio, deslizable en móvil) | `KpiStrip` (`cols`) |
| Cabecera de módulo | `PageHeader` |
| Chip de estado | `StatusChip` (`label`, `tone`) |
| Celda `<th>` de tabla | `TableHeaderCell` (`align?: left \| right \| center`) |
| Ordenar una tabla tocando sus cabeceras (**toda tabla debe poder hacerlo**, pedido del usuario del 2026-10-05) | `useTableSort(filas, { clave: (fila) => valor }, { firstDir })` → `sorted` (ordenar antes de paginar) y `headSort(clave)` para `<TableHeaderCell sort={headSort("clave")}>`; para `<th>` propios, `SortButton` + `ariaSort`. Reglas puras y probadas en `services/tableSort.ts`: texto en español sin tildes, números naturales, vacíos al final, tercer toque sin orden |
| Buscador de una tabla (ancho en todo el sistema, pedido del usuario del 2026-10-05) | `TableSearch` (`value`, `onChange`, `placeholder`); si el campo tiene lógica propia, su contenedor con `tableSearchBoxClass` |
| Filtros de una tabla en el celular (patrón aprobado: buscador + botón de filtros + ⋯ con las acciones; nunca selects apilados bajo el buscador) | `MobileFilterButton` (abre un `BottomSheet`), dentro `SheetGroupTitle` y `SheetOption` (`active`, `label`, `count?`). Ejemplos: Claves de envío, Stock SISMED. En Consulta Stock, el establecimiento de una hoja con puestos comunales **no va en Filtros**: va en pastillas bajo el buscador (opción A, aprobada el 2026-10-05) |
| Barra del buscador y filtros fija arriba en el celular, **a todo el ancho de la pantalla mientras está pegada** (toda tabla, pedido del usuario del 2026-10-05) | `useStickyBar` + `stickyBarClass` (`components/ui/useStickyBar.ts`), con `md:static` o `sm:static`. La tarjeta que la contiene no puede llevar `overflow-hidden` en el celular (usar `md:overflow-hidden`): rompe el `sticky`. Ejemplos: Stock SISMED, Claves de envío, Usuarios |
| Campo de formulario con etiqueta | `FormField` (`label`, `required?`, `hint?`) |
| Estado vacío | `EmptyState` |
| Clase de `<input>` de formulario | `inputClass` (h-11) |
| Clase de campo en barra de filtros | `filterInputClass` (h-10) |
| Fecha `15/07/2026` | `formatDate` |
| Número `21 300` / `2 193,5` (miles con espacio, coma decimal) | `formatNumber` en `services/numberFormat.ts` |
| Tipo de tono | `Tone` |

Otras piezas compartidas en `components/ui/`: `useIsDesktop` (¿pantalla `md` o más? Para piezas que cambian de forma en el celular, como un panel lateral que pasa a `BottomSheet`), `ConfirmationDialog`, `CustomSelect`, `TablePagination`, `IncrementalList` (listas del celular que cargan al bajar), `BottomSheet` (filtros del celular: un botón junto al buscador abre el panel inferior), `FloatingActionButton` (botón principal del celular), `BrandLogo` (marca; `BrandMark animation="hover" | "loop"` y `BrandBootScreen`, la pantalla de carga con el logo animado que sigue a la de arranque en línea de `index.html`), `PharmacyCodeCell`, `ModuleHeaderSlot`, `InfoTip` (explicación detrás de un ícono «i»; `hover` para que en escritorio se abra al pasar el mouse, como en «Mantener sesión iniciada»; panel inferior en el celular), `useOnline` (¿hay internet? se vuelve a pintar al perder o recuperar la conexión). Un módulo con niveles publica el nivel actual en la cabecera del celular con `useModuleHeaderOverride` (`contexts/ModuleHeaderContext.tsx`): el título reemplaza al del módulo y la flecha sube un nivel (ejemplo: Consulta Stock).

**Los tonos se nombran por significado, nunca por color:** `success`, `warning`, `danger`, `info`, `locked`, `neutral`. Si escribes `bg-emerald-100` a mano en un módulo, casi siempre querías un `tone`.

**Lo que sí es correcto que esté duplicado.** Etiquetas y chips de estado propios de cada entidad pueden vivir en su módulo cuando cada entidad tiene **estados y textos distintos**. La regla es: se comparte la *forma*, no el *vocabulario del dominio*.

**Si de verdad falta una pieza**, agrégala al kit y úsala desde todos los módulos que la necesiten — no la dejes local "por ahora". Se importa con alias cuando el nombre local ya está establecido: `import { TableHeaderCell as HeaderCell } from "./ui/kit"`.

---

## 9. Pendientes y notas vigentes

**Pendiente de seguridad que el usuario pidió recordarle (2026-09-23):** el script de Google que recibe el stock de Sync SISMED no pide credencial, y cualquiera con su dirección puede reemplazar o dejar en blanco el stock de un establecimiento. El 2026-09-30 se decidió resolverlo con **claves por establecimiento gestionadas desde la web** (módulo `Claves de envío`, `ADMIN_SEND_KEYS`): la PC vinculada es la única que envía, las demás se bloquean y avisan. Quedó completo el 2026-09-30: la web, y el Toolkit de escritorio 2.1.10 verifica la clave **antes de enviar** (`toolskit/send_key_check.py` en Toolkit-OGM), así que **no se toca el script de Google de ninguna UNGET** —el usuario no quiere que sus compañeros configuren nada en Apps Script—. El script de Google v3 (`Toolkit-OGM/docs/apps-script/sync_sismed_google_sheets.gs`) cierra también el envío a mano a su dirección: antes de escribir la pestaña de un establecimiento con clave consulta `app_send_key_verify` (`SUPABASE_CLAVE_ENVIO_SCRIPT.sql`, solo lectura) y, si la web no responde, deja pasar el envío. Cada UNGET lo instala pegando el código y publicando una versión nueva; los establecimientos sin clave siguen abiertos. Desde el 2026-10-02 el módulo tiene una sola pestaña, «Establecimientos» (antes «Claves» y «Equipos»; la unión vive en `services/sendKeyEstablishments.ts`, con pruebas): junto a la clave muestra qué versión del Toolkit tiene cada PC (`SUPABASE_EQUIPOS_TOOLKIT.sql`, `services/toolkitDevices.ts`) y qué versión del SISMED (`SUPABASE_EQUIPOS_SISMED.sql`; el Toolkit la lee de la fila SIS/AB de `DATOS\MCONFIG.DBF` y la vigente es la más alta que reporta alguna PC). Los intentos bloqueados sin revisar aparecen en una franja roja encima de la tabla («Ver» filtra esos establecimientos, «Ignorar todos»); cada uno se ignora o se cambia de equipo desde su detalle. Desde el 2026-10-03 el módulo ya no tiene campana propia (se repetía con la campanita general) ni las etiquetas «Toolkit vigente» / «SISMED vigente»: esas versiones salen en las pistas de los KPIs. Versiones del Toolkit: el último número llega hasta 10 y luego sube el del medio (2.1.10 → 2.2.0; 2.10.10 → 3.0.0). Detalle en `docs/SEGURIDAD_AUDITORIA.md`, sección «Pendiente: el envío de stock a Google Sheets no pide credencial». **Recuérdaselo al usuario si retoma trabajo sobre conexiones o sincronización.**

**Envío de stock por camino de respaldo (2026-10-09, Toolkit 2.3.2):** la red PRONATEL de algunos establecimientos bloquea `script.google.com` (PUERTORICO 06474 y CONSUELO 06506: DNS desviado a `10.254.30.102` aun con 8.8.8.8 y TLS cortado por nombre). Si el Toolkit no llega a Google, manda el mismo envío a `POST /stock` de `cloudflare/conexion` (respaldo A) o a la función `stock-relay` de Supabase (respaldo B, máximo cada 30 min), que lo pasan al mismo Apps Script. Un solo código para los dos: `supabase/functions/stock-relay/index.ts`. Solo PC con clave de envío vigente (`app_send_key_verify`, sin SQL nuevo); Google Sheets sigue siendo la fuente. Reglas, casos de falla y puesta en marcha en `docs/ENVIO_STOCK_RESPALDO.md`. **Probado en real el 2026-10-09** en CONSUELO (Toolkit 2.3.2): «OK:463 registros … Enviado por el respaldo Cloudflare». Los dos respaldos están publicados (el secreto `SUPABASE_ACCESS_TOKEN` ya existe).

**Historial de disponibilidad (2026-10-09):** `supabase/SUPABASE_DISPONIBILIDAD_HISTORIAL.sql` ya está aplicado en Supabase (el usuario, 2026-10-09). Si se reinstala la base, sin él el historial dice que no está instalado y el reporte del mes funciona igual. (Reemplaza el pendiente «Disponibilidad mes a mes» del 2026-10-06: se resolvió guardando cada mes en la base, no calculándolo del archivo.)

**Modo sin internet (2026-10-08):** `supabase/SUPABASE_SESION_MANTENIDA.sql` ya está aplicado en Supabase (el usuario, 2026-10-09). Sin él, con internet, la sesión mantenida pediría entrar cada 12 horas.

**Campanita de avisos (2026-10-03):** botón de la cabecera (`components/NotificationBell.tsx`, a la izquierda del usuario; en el celular entre la lupa y el avatar). Las reglas son puras y con pruebas en `services/notifications.ts`; la carga, en `contexts/NotificationsContext.tsx` (al iniciar sesión, cada 15 minutos y con «Actualizar»). **Ningún aviso se guarda**: cada revisión los recalcula de los datos de ese momento y desaparecen solos al resolverse; solo se recuerda en `localStorage`, por usuario, qué se marcó como visto: la firma lista los elementos del aviso (establecimientos, lotes, PC) y solo vuelve a contar si aparece uno que no estaba; que se resuelva alguno no lo reaviva, y una PC bloqueada que reintenta tampoco (antes cualquier cambio de la lista lo encendía otra vez, y los avisos de la red cambian en cada revisión). Quién ve qué: con `ADMIN_SEND_KEYS`, intentos bloqueados, establecimientos sin enviar, Toolkit y SISMED desactualizados (las mismas funciones y reglas de `AdminSendKeysModule`); solo el ADMIN con `ADMIN_BACKUPS`, el consumo del plan gratuito ≥ 70 % (la lectura `usage` del servicio de Cloudflare: si la conexión de `BackupManagerContext` está cerrada, se abre un momento con `attach` hasta que llega o pasan 15 s); con `IPRESS_STOCK` y establecimiento, su propia hoja (lotes vencidos, por vencer, sin stock, hoja sin actualizar), leída por `services/assignedIpressStock.ts`, que es el mismo camino que usa Stock SISMED — no se lee `stock_actual`. Los umbrales (días sin actualizar, 3 por omisión; lotes por vencer, 90) están en Parámetros del Sistema y viven en `notice_settings` (`supabase/SUPABASE_AVISOS_PARAMETROS.sql`: lee cualquier sesión, guarda solo ADMIN); sin ese SQL la campana usa los valores por omisión.

**Backups SISMED con un clic (en construcción desde el 2026-09-30):** plan por etapas, arquitectura (Toolkit + Supabase + Cloudflare Durable Objects + R2), reglas acordadas y estado en `docs/BACKUPS_SISMED.md`. Desde la etapa 4 es el módulo `ADMIN_BACKUPS` (`components/BackupsSismedModule.tsx`); las descargas las lleva `contexts/BackupManagerContext.tsx`, montado en `App.tsx` para que sigan al cambiar de módulo. El servicio de conexión vive en `cloudflare/conexion` y se publica solo desde GitHub. **Léelo antes de tocar esa carpeta o `toolskit/backup_connection.py`.** La ruta `/stock` de ese servicio es el envío de stock por camino de respaldo (`docs/ENVIO_STOCK_RESPALDO.md`).

---

## 10. Cómo trabajar aquí

0. **Antes de escribir un componente o una utilidad, búscalo.** Sección 8 de este documento y `components/ui/kit.tsx`. Este proyecto ya pagó el precio de no hacerlo.
1. **Incrementos pequeños**, con entregable verificable. No construir varias cosas de golpe.
2. **No romper farmacia/SISMED.** Los componentes de ese dominio (`SheetSearchModule`, `RedistributionModule`, `AdminOrganizationModule`…) son grandes y frágiles; no refactorizarlos de paso.
   Y si tocas las **conexiones de stock** —las tarjetas de UNGET, sus botones o `saveUngetConfigs`—, lee antes la sección 7 bis: ahí están las reglas de propiedad, que ya costaron varios defectos.
3. Al agregar una operación de escritura: validar el alcance del usuario y asegurarse de que la tabla tenga su política de sesión.
4. Cerrar cada cambio con `npm run lint`, `npm test` y `npm run build` en verde.
5. Ante ambigüedad funcional (qué columna, qué regla, qué rol opera), **preguntar al usuario**: es quien conoce la operación real de la DIRESA y varias decisiones ya se revirtieron por asumir de más.
