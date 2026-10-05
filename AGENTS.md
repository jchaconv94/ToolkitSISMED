# AGENTS.md - ToolKit SISMED Web

Guía de contexto para agentes de IA que trabajen en este repositorio. Última actualización: 2026-10-03 (retiro del módulo de Inmunizaciones).

> **Lee la sección 8 antes de escribir cualquier componente o utilidad.** El error más caro que ha cometido una IA en este proyecto es volver a escribir algo que ya existía: llegó a haber cinco `HeaderCell` distintos, cuatro `formatDate` y seis `Field`. Antes de crear una tarjeta, un formateador o una celda de tabla, **búscala** en `components/ui/kit.tsx`.

> **FRONTERA CRÍTICA DE STOCK (no mezclar):** `SIG_SEARCH` / `SheetSearchModule` (**Consulta Stock**) usa exclusivamente **Google Sheets → Google Apps Script → IndexedDB** para medicamentos, lotes, saldos, vencimientos y actualización. El 2026-10-02 se retiraron **Monitoreo de Stock** (`STOCK_MONITORING`) y **Sync SISMED 2.0** (la subida a la tabla `stock_actual` de Supabase, con su edge function y sus dispositivos), así que ninguna pantalla lee `stock_actual`: el inventario de Consulta Stock y de Stock SISMED (`IPRESS_STOCK`) sale **solo de Google Sheets**. **No reintroducir lecturas de `stock_actual`.** Supabase **sí** se usa en Consulta Stock para el historial/auditoría en `stock_sync_history`: los snapshots se construyen exclusivamente a partir del stock leído de Google Sheets y nunca sustituyen la fuente de inventario de `SIG_SEARCH`.

> **Inmunizaciones se retiró el 2026-10-03.** Todo el dominio (módulos `IMMUNIZATION_*`, servicios, tipos, documentos de fase, scripts y SQL propios) se eliminó de esta aplicación porque se está reconstruyendo como un sistema aparte. No lo reintroduzcas aquí. El kit visual que nació con ese módulo se conservó con nombres neutros en `components/ui/kit.tsx`.

---

## 1. Qué es este proyecto

Aplicación web interna (SPA React + Vite + TypeScript) para la **DIRESA San Martín (Perú)**, del dominio **Farmacia / SISMED**:

- **Análisis de requerimiento** (`DASHBOARD`, `ANALYSIS`) y **Lista de Exclusiones** (`ANALYSIS_EXCLUSIONS`).
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
public/                     Ícono (favicon.svg), íconos PNG de la app, manifest.webmanifest y sw.js (service worker sin caché, solo para poder instalar la app; services/installApp.ts maneja «Instalar app» del menú del usuario)
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
> **Acceso rápido con PIN (PC) o huella (celular), desde el 2026-10-04.** Todo en Supabase, sin servidor propio: `supabase/SUPABASE_INGRESO_PIN_HUELLA.sql` (tabla `app_devices`, funciones `app_device_*`). El equipo guarda una llave al azar (`services/deviceAccess.ts`) y Supabase su SHA-256 y el PIN con bcrypt; nunca se guarda la contraseña. 5 PIN equivocados bloquean el equipo; cambiar la contraseña desactiva todos los equipos. El PIN (PC) y la huella (celular) se activan en Perfil (`components/QuickAccessCard.tsx`) y se usan en el login (`components/PinLogin.tsx`, `components/FingerprintLogin.tsx`). La huella es WebAuthn con el lector del teléfono como verificación local (`createFingerprintCredential` / `verifyFingerprint`): libera la llave del equipo, pero Supabase no verifica firmas WebAuthn. WebAuthn no acepta direcciones IP: para probar en local usar `localhost`, no `127.0.0.1`.

---

## 6. Módulos

| `AppModule` | Etiqueta UI | Componente |
|---|---|---|
| `HOME` | Inicio | `components/HomeModule.tsx` (todos lo ven; `hasPermission` siempre lo permite) |
| `DASHBOARD` | Análisis de Requerimiento | `AnalysisModule` en `App.tsx` (+ `InputSection`, `Dashboard`, `AnalysisTable`) |
| `ANALYSIS_EXCLUSIONS` | Lista de Exclusiones | `components/AnalysisExclusionsModule.tsx` |
| `SIG_SEARCH` | Consulta Stock | `components/SheetSearchModule.tsx` |
| `IPRESS_STOCK` | Stock SISMED | `components/AssignedIpressStockModule.tsx` |
| `REDISTRIBUTION` | Redistribución | `components/RedistributionModule.tsx` |
| `ADMIN_USERS`, `ADMIN_ROLES`, `ADMIN_FACILITIES`, `ADMIN_CATALOGS`, `ADMIN_PARAMS` | Administración | `components/AdminPanel.tsx` (pestañas) |
| `ADMIN_STOCK_ASSIGN` | Columnas de Stock | `components/AdminStockAssignmentModule.tsx` |
| `ADMIN_SEND_KEYS` | Claves de envío | `components/AdminSendKeysModule.tsx` |
| `ADMIN_BACKUPS` | Backups SISMED | `components/BackupsSismedModule.tsx` |
| `PROFILE` | Perfil de Usuario | `components/UserProfile.tsx` (todos lo ven desde el 2026-10-04: `hasPermission` siempre lo permite y ya no figura en Roles). Rediseñado el 2026-10-05: portada oscura con círculos y avatar montado (en el celular centrado y con «Editar datos» flotante), bloques Datos personales / Trabajo / Cuenta y seguridad (con `QuickAccessCard embedded`), y dos ventanas `ResponsiveDialog`: «Editar datos» (incluye DNI, usuario y fecha de nacimiento: el propio usuario puede cambiarlos, decisión del usuario del 2026-10-05; se probó restringirlo y se descartó) y «Cambiar contraseña». La fecha de nacimiento necesita `supabase/SUPABASE_PERSONAL_FECHA_NACIMIENTO.sql`; sin él se guarda lo demás y se avisa. |

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

---

## 8. Convenciones de UI

- **Estilo base:** sidebar oscuro, fondo `slate` claro, tarjetas `rounded-2xl border border-slate-200 bg-white shadow-sm`, iconos `lucide-react`, Tailwind.
- **Color con significado:** teal/cyan = información/stock; emerald = aplicado/cerrado/vigente; amber = pendiente/advertencia; red = vencido/error/bloqueo; blue = vista supervisora; slate = neutro.
- **Densidad:** 1 tarjeta de cabecera, máximo 4–5 KPIs, filtros en **una sola barra** compacta; fechas y filtros avanzados en popover/colapsable, nunca en tarjeta alta.
- **Tablas:** encabezado que se pega arriba al bajar con `useFloatingTableHead` + `FloatingTableHead` (`components/ui/FloatingTableHead.tsx`: a todo el ancho, sin bordes; no usar `sticky` en el `<thead>`), filas 52–60 px, descripción del producto a 13–14 px (no tamaño título), código SISMED en chip/monospace, estados en chips, acciones a la derecha.
- **Administración, rediseño por pantallas (desde el 2026-10-04):** Gestión de Usuarios ya va sin el título grande que repetía la cabecera ni el recuadro alrededor; KPIs Usuarios/Activos/Inactivos, tabla única paginada en escritorio y tarjetas con menú ⋯ en el celular. Configuración de Roles también (desde el mismo día): lista y detalle (en el celular, dos pantallas con la flecha de la cabecera), módulos agrupados por las secciones de `navigation.ts` con interruptores, y barra «Cambios sin guardar» con Descartar/Guardar. En Roles solo se asignan los módulos del menú: `ANALYSIS` (sin pantalla) y `PROFILE` ya no se muestran. Parámetros del Sistema también: secciones por lo que afectan con `SettingsSection`/`SettingsRow` (`components/ui/SettingsSection.tsx`), etiqueta «Cambiado» y barra de guardado en el pie; ya no muestra «Conexión Backend (Google Apps Script)» (`apiUrl`), que nada leía (el valor guardado no se borra). Regímenes y Profesiones también (`AdminCatalogsModule`): dos listas en escritorio, una pestaña para cada una en el celular, cuántos usuarios tienen asignado cada elemento, y crear/editar/eliminar en `ResponsiveDialog`/`ConfirmationDialog` (antes eliminar era un aviso de `toast`). Establecimientos (`AdminOrganizationModule`, 2026-10-05): pestañas de nivel (el nivel IPRESS se muestra como «Establecimientos») con «Nuevo…» a la derecha en escritorio; filtros **a la vista en la barra** junto al buscador en escritorio (el usuario rechazó un modal de filtros: no es buena práctica) y en panel inferior con etiquetas en el celular; los encabezados de tabla ya no filtran; tablas paginadas con encabezado fijo; tarjetas en el celular que abren el detalle. Detalle «premium»: en escritorio, panel oscuro de jurisdicción a la izquierda (al usuario le gusta ese estilo); en el celular solo una cabecera oscura compacta (tipo, nombre, chips) y jurisdicción, dependientes y conexión en bloques claros (el usuario rechazó media pantalla en negro). Eliminar con `ConfirmationDialog` y aviso de dependientes. Los 5 formularios (DIRESA, OGESS, UNGET, Microred, Establecimiento) van a pantalla completa en el celular, con «Paso N de M» y barra de avance, y pie fijo con los botones.
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
| Campo de formulario con etiqueta | `FormField` (`label`, `required?`, `hint?`) |
| Estado vacío | `EmptyState` |
| Clase de `<input>` de formulario | `inputClass` (h-11) |
| Clase de campo en barra de filtros | `filterInputClass` (h-10) |
| Fecha `15/07/2026` | `formatDate` |
| Número `21 300` / `2 193,5` (miles con espacio, coma decimal) | `formatNumber` en `services/numberFormat.ts` |
| Tipo de tono | `Tone` |

Otras piezas compartidas en `components/ui/`: `useIsDesktop` (¿pantalla `md` o más? Para piezas que cambian de forma en el celular, como un panel lateral que pasa a `BottomSheet`), `ConfirmationDialog`, `CustomSelect`, `TablePagination`, `IncrementalList` (listas del celular que cargan al bajar), `BottomSheet` (filtros del celular: un botón junto al buscador abre el panel inferior), `FloatingActionButton` (botón principal del celular), `BrandLogo` (marca; `BrandMark animation="hover" | "loop"` y `BrandBootScreen`, la pantalla de carga con el logo animado que sigue a la de arranque en línea de `index.html`), `PharmacyCodeCell`, `ModuleHeaderSlot`. Un módulo con niveles publica el nivel actual en la cabecera del celular con `useModuleHeaderOverride` (`contexts/ModuleHeaderContext.tsx`): el título reemplaza al del módulo y la flecha sube un nivel (ejemplo: Consulta Stock).

**Los tonos se nombran por significado, nunca por color:** `success`, `warning`, `danger`, `info`, `locked`, `neutral`. Si escribes `bg-emerald-100` a mano en un módulo, casi siempre querías un `tone`.

**Lo que sí es correcto que esté duplicado.** Etiquetas y chips de estado propios de cada entidad pueden vivir en su módulo cuando cada entidad tiene **estados y textos distintos**. La regla es: se comparte la *forma*, no el *vocabulario del dominio*.

**Si de verdad falta una pieza**, agrégala al kit y úsala desde todos los módulos que la necesiten — no la dejes local "por ahora". Se importa con alias cuando el nombre local ya está establecido: `import { TableHeaderCell as HeaderCell } from "./ui/kit"`.

---

## 9. Pendientes y notas vigentes

**Pendiente de seguridad que el usuario pidió recordarle (2026-09-23):** el script de Google que recibe el stock de Sync SISMED no pide credencial, y cualquiera con su dirección puede reemplazar o dejar en blanco el stock de un establecimiento. El 2026-09-30 se decidió resolverlo con **claves por establecimiento gestionadas desde la web** (módulo `Claves de envío`, `ADMIN_SEND_KEYS`): la PC vinculada es la única que envía, las demás se bloquean y avisan. Quedó completo el 2026-09-30: la web, y el Toolkit de escritorio 2.1.10 verifica la clave **antes de enviar** (`toolskit/send_key_check.py` en Toolkit-OGM), así que **no se toca el script de Google de ninguna UNGET** —el usuario no quiere que sus compañeros configuren nada en Apps Script—. El script de Google v3 (`Toolkit-OGM/docs/apps-script/sync_sismed_google_sheets.gs`) cierra también el envío a mano a su dirección: antes de escribir la pestaña de un establecimiento con clave consulta `app_send_key_verify` (`SUPABASE_CLAVE_ENVIO_SCRIPT.sql`, solo lectura) y, si la web no responde, deja pasar el envío. Cada UNGET lo instala pegando el código y publicando una versión nueva; los establecimientos sin clave siguen abiertos. Desde el 2026-10-02 el módulo tiene una sola pestaña, «Establecimientos» (antes «Claves» y «Equipos»; la unión vive en `services/sendKeyEstablishments.ts`, con pruebas): junto a la clave muestra qué versión del Toolkit tiene cada PC (`SUPABASE_EQUIPOS_TOOLKIT.sql`, `services/toolkitDevices.ts`) y qué versión del SISMED (`SUPABASE_EQUIPOS_SISMED.sql`; el Toolkit la lee de la fila SIS/AB de `DATOS\MCONFIG.DBF` y la vigente es la más alta que reporta alguna PC). Los intentos bloqueados sin revisar aparecen en una franja roja encima de la tabla («Ver» filtra esos establecimientos, «Ignorar todos»); cada uno se ignora o se cambia de equipo desde su detalle. Desde el 2026-10-03 el módulo ya no tiene campana propia (se repetía con la campanita general) ni las etiquetas «Toolkit vigente» / «SISMED vigente»: esas versiones salen en las pistas de los KPIs. Versiones del Toolkit: el último número llega hasta 10 y luego sube el del medio (2.1.10 → 2.2.0; 2.10.10 → 3.0.0). Detalle en `docs/SEGURIDAD_AUDITORIA.md`, sección «Pendiente: el envío de stock a Google Sheets no pide credencial». **Recuérdaselo al usuario si retoma trabajo sobre conexiones o sincronización.**

**Campanita de avisos (2026-10-03):** botón de la cabecera (`components/NotificationBell.tsx`, a la izquierda del usuario; en el celular entre la lupa y el avatar). Las reglas son puras y con pruebas en `services/notifications.ts`; la carga, en `contexts/NotificationsContext.tsx` (al iniciar sesión, cada 15 minutos y con «Actualizar»). **Ningún aviso se guarda**: cada revisión los recalcula de los datos de ese momento y desaparecen solos al resolverse; solo se recuerda en `localStorage`, por usuario, qué se marcó como visto (con una firma del contenido: si cambia, vuelve a contar). Quién ve qué: con `ADMIN_SEND_KEYS`, intentos bloqueados, establecimientos sin enviar, Toolkit y SISMED desactualizados (las mismas funciones y reglas de `AdminSendKeysModule`); solo el ADMIN con `ADMIN_BACKUPS`, el consumo del plan gratuito ≥ 70 % (la lectura `usage` del servicio de Cloudflare: si la conexión de `BackupManagerContext` está cerrada, se abre un momento con `attach` hasta que llega o pasan 15 s); con `IPRESS_STOCK` y establecimiento, su propia hoja (lotes vencidos, por vencer, sin stock, hoja sin actualizar), leída por `services/assignedIpressStock.ts`, que es el mismo camino que usa Stock SISMED — no se lee `stock_actual`. Los umbrales (días sin actualizar, 3 por omisión; lotes por vencer, 90) están en Parámetros del Sistema y viven en `notice_settings` (`supabase/SUPABASE_AVISOS_PARAMETROS.sql`: lee cualquier sesión, guarda solo ADMIN); sin ese SQL la campana usa los valores por omisión.

**Backups SISMED con un clic (en construcción desde el 2026-09-30):** plan por etapas, arquitectura (Toolkit + Supabase + Cloudflare Durable Objects + R2), reglas acordadas y estado en `docs/BACKUPS_SISMED.md`. Desde la etapa 4 es el módulo `ADMIN_BACKUPS` (`components/BackupsSismedModule.tsx`); las descargas las lleva `contexts/BackupManagerContext.tsx`, montado en `App.tsx` para que sigan al cambiar de módulo. El servicio de conexión vive en `cloudflare/conexion` y se publica solo desde GitHub. **Léelo antes de tocar esa carpeta o `toolskit/backup_connection.py`.**

---

## 10. Cómo trabajar aquí

0. **Antes de escribir un componente o una utilidad, búscalo.** Sección 8 de este documento y `components/ui/kit.tsx`. Este proyecto ya pagó el precio de no hacerlo.
1. **Incrementos pequeños**, con entregable verificable. No construir varias cosas de golpe.
2. **No romper farmacia/SISMED.** Los componentes de ese dominio (`SheetSearchModule`, `RedistributionModule`, `AdminOrganizationModule`…) son grandes y frágiles; no refactorizarlos de paso.
   Y si tocas las **conexiones de stock** —las tarjetas de UNGET, sus botones o `saveUngetConfigs`—, lee antes la sección 7 bis: ahí están las reglas de propiedad, que ya costaron varios defectos.
3. Al agregar una operación de escritura: validar el alcance del usuario y asegurarse de que la tabla tenga su política de sesión.
4. Cerrar cada cambio con `npm run lint`, `npm test` y `npm run build` en verde.
5. Ante ambigüedad funcional (qué columna, qué regla, qué rol opera), **preguntar al usuario**: es quien conoce la operación real de la DIRESA y varias decisiones ya se revirtieron por asumir de más.
