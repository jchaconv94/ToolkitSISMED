# AGENTS.md - ToolKit SISMED Web

Guía de contexto para agentes de IA que trabajen en este repositorio. Última actualización: 2026-08-02 (auditoría: consolidación de duplicados, limpieza y reorganización de la raíz).

> **Lee la sección 8 antes de escribir cualquier componente o utilidad.** El error más caro que ha cometido una IA en este proyecto es volver a escribir algo que ya existía: llegó a haber cinco `HeaderCell` distintos, cuatro `formatDate` y seis `Field`. Antes de crear una tarjeta, un formateador, una celda de tabla o una regla de negocio, **búscala** en `components/ui/immunization.tsx` y `services/immunizationDomain.ts`.

> **FRONTERA CRÍTICA DE STOCK (no mezclar):** `SIG_SEARCH` / `SheetSearchModule` (**Consulta Stock**) usa exclusivamente **Google Sheets → Google Apps Script → IndexedDB** para medicamentos, lotes, saldos, vencimientos y actualización. `STOCK_MONITORING` / `IpressStockModule` (**Monitoreo de Stock**) usa **Supabase (`stock_actual`)** y es independiente. **No introducir fallbacks cruzados y no leer `stock_actual` desde Consulta Stock.** Supabase **sí** se usa en Consulta Stock para el historial/auditoría en `stock_sync_history`: los snapshots se construyen exclusivamente a partir del stock leído de Google Sheets y nunca sustituyen la fuente de inventario de `SIG_SEARCH`.

---

## 1. Qué es este proyecto

Aplicación web interna (SPA React + Vite + TypeScript) para la **DIRESA San Martín (Perú)**. Cubre dos grandes dominios:

1. **Farmacia / SISMED** (módulos históricos): análisis de stock, redistribución, consumos, catálogos, panel admin, sincronización de dispositivos.
2. **Inmunizaciones** (módulo en construcción activa): control de biológicos por lote desde el almacén regional DIRESA hasta cada IPRESS, con cierre mensual y reportes de movimiento biológico.

**El trabajo actual está 100% concentrado en Inmunizaciones.** Los módulos de farmacia no se tocan salvo pedido explícito.

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
- `npm test` = `vitest run`. 136 pruebas, cobertura deliberadamente enfocada en lo que se puede romper en silencio. No hay tests de componentes.
  - `services/immunizationMonthlyReportService.test.ts` — aritmética de los reportes mensuales y posición de celdas del Excel
  - `services/immunizationProgressService.test.ts` — estados del tablero de avance
  - `services/appRoutes.test.ts` — incluye una prueba que **falla si agregas un módulo sin declararle ruta**
  - `services/DropdownPositioningService.test.ts`
- Servidor local: `http://127.0.0.1:3000/ToolkitSISMED/` (nota el `base: '/ToolkitSISMED/'` en `vite.config.ts`).
- Las dependencias se instalan con `npm ci` (instalación exacta del lock). Si `npm ci` se queja de un paquete que falta, sincronizar el lock con `npm install --package-lock-only` y volver a validar.
- `.github/workflows/verificacion.yml` corre `npm ci`, `lint`, `test` y `build` en cada pull request y en cada cambio de `main`. No sustituye validar en local antes de subir, pero avisa si algo se rompió.
- En Windows, si `npm` falla desde bash, usar `npm.cmd`.

**Regla de cierre de fase:** toda fase termina con `npm run lint` y `npm run build` en verde, y un documento `FASE_NN_*.md`. Si la fase toca aritmética de saldos o reportes, agregar también pruebas y dejar `npm test` en verde.

---

## 3. Repositorio y despliegue

El repositorio se inicializó el 2026-08-01. El trabajo vive en la rama **`respaldo-inmunizaciones`**, que es la rama de desarrollo.

`main` se unificó con ella el 2026-08-02. Las dos historias eran **independientes** (sin ancestro común: `main` venía del proyecto subido desde Google AI Studio y la rama de trabajo se inicializó aparte), así que un `merge` normal habría dado conflicto en todos los archivos. Se resolvió con una confirmación de unión de dos padres construida con `git commit-tree`, tomando el árbol de la rama de trabajo:

```bash
git commit-tree "HEAD^{tree}" -p origin/main -p HEAD -m "merge: ..."
```

Conserva ambas historias y deja como contenido el proyecto vigente. **Si vuelve a divergir por subir el proyecto desde AI Studio, esta es la receta.** Verifica siempre que `git diff main respaldo-inmunizaciones` quede vacío antes de publicar.

El sitio publicado no se despliega desde `main`. Se publica el `dist` compilado directamente a la rama `gh-pages`:

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
components/                 Un archivo .tsx por módulo (componentes grandes, sin subcarpetas por dominio)
components/ui/              Kit compartido: immunization.tsx, ConfirmationDialog, CustomSelect
services/                   Acceso a datos, reglas de dominio y generación de documentos
docs/                       Toda la documentación (fases, planes, auditorías). Solo README y AGENTS viven en la raíz
supabase/                   Todos los .sql que el usuario ejecuta a mano en el panel de Supabase
supabase/functions/         Edge function sync-stock
backend/                    Google Apps Script legado
scripts/                    Previews de PDF/Excel y diagnóstico contra Supabase (ejecución manual)
reportes-ejemplo/           PDFs de referencia visual
```

**No hay react-router.** La navegación es `currentView: AppModule` en `App.tsx`, con Sidebar/MobileNav como disparadores. La URL se sincroniza a mano con `history.pushState` usando `services/appRoutes.ts`.

Al agregar un módulo hay que tocar **seis** lugares:

1. `types.ts` → union `AppModule` + entrada en `AVAILABLE_MODULES`
2. `App.tsx` → import, título de cabecera, render condicional y fallback de permisos
3. `services/appRoutes.ts` → su ruta (`inmunizaciones/catalogo`, etc.)
4. `components/Sidebar.tsx`
5. `components/MobileNav.tsx` → el grupo que le corresponde en `GRUPOS`
6. Permisos por rol en Supabase (`roles_config.allowed_modules`)

Olvidar cualquiera deja el módulo inaccesible, sin título o sin URL propia. El paso 3 está protegido: `services/appRoutes.test.ts` falla si un módulo de `AVAILABLE_MODULES` no tiene ruta declarada.

**Rutas y GitHub Pages.** `APP_BASE = "/ToolkitSISMED"`. Pages devuelve 404 ante cualquier ruta que no sea un archivo real, así que el build copia `index.html` a `404.html` para que la SPA resuelva la navegación profunda. Al cerrar sesión, `App.tsx` devuelve la URL a la raíz: si no, la ventana se queda en la ruta del usuario anterior.

### Persistencia

- **Supabase** (`services/supabaseClient.ts`) es el backend real. Cliente `anon`.
- **Autenticación propia** sobre tabla `users` con `bcryptjs` — **no** se usa Supabase Auth.
- Como la base no conoce al usuario por sí misma, el alcance se resuelve con un **token de sesión propio**; ver el recuadro de abajo. `ImmunizationScope` sigue recortando en el frontend, pero ya no es la única defensa.

> **La clave `anon` es pública**: el workflow de GitHub Pages la inyecta en el build, así que cualquiera puede extraerla del bundle desplegado. Todo lo que `anon` pueda hacer, lo puede hacer cualquiera en internet.
>
> **Modelo de acceso vigente (desde el 2026-08-01).** `app_login` valida la contraseña en el servidor y devuelve un token de sesión de 12 h. El cliente lo adjunta en la cabecera `x-session-token` mediante un `fetch` propio en `services/supabaseClient.ts`. Las 15 tablas de inmunizaciones tienen RLS que exige ese token, y las escrituras sobre `users` / `roles_config` pasan por funciones `SECURITY DEFINER` que exigen sesión de ADMIN.
>
> **Reglas al tocar esta zona:**
> - Nunca pidas `password_hash` ni uses `select("*")` sobre `users`; usa `USER_SELECT`.
> - Una tabla nueva del módulo necesita su política de sesión, o quedará abierta a internet.
> - Si añades RLS: **despliega primero, aplica el SQL después.** Al revés dejas la app sin datos hasta que el navegador recoja la versión nueva.
> - `pgcrypto` no verifica hashes `$2b$` (los que genera bcryptjs). Las funciones reetiquetan el prefijo a `$2a$` al comparar; no toques eso sin leer `docs/SEGURIDAD_AUDITORIA.md`.
>
> Auditoría, hallazgos y lo que sigue pendiente: `docs/SEGURIDAD_AUDITORIA.md`.
- **Todo servicio de inmunizaciones tiene fallback a `localStorage`** cuando `supabase` es null o falla la consulta. Patrón: `try { if (supabase) {...} } catch { console.warn("Fallback local ...") }` y luego `getCachedList<T>(CACHE_KEY)`. Al agregar una operación nueva hay que implementar **ambos** caminos, o los datos se comportan distinto según el entorno.

---

## 5. Modelo de dominio de Inmunizaciones

### Flujo jerárquico de abastecimiento (vigente desde el refactor de Fase 14)

```
DIRESA (almacén regional)
  → ingreso regional  → stock DIRESA
  → distribución      → recepción UNGET (con incidencias)
UNGET (almacén de red)
  → distribución      → recepción IPRESS (con incidencias)
IPRESS (establecimiento)
  → consumo por lote / devolución / baja / transferencia → UNGET
```

Cierre: **IPRESS precierra**, **UNGET cierra definitivamente** (solo si todas sus IPRESS están precerradas).

> Ojo: el modelo *anterior* era "UNGET registra ingresos". Las Fases 11–13 se escribieron bajo ese modelo y fueron refactorizadas en la Fase 14. Documentos y nombres de permiso pueden conservar el nombre viejo (`IMMUNIZATION_INCOMES` hoy es *"Ingresos Regionales"* de DIRESA).

### Stock por capas (layers)

`immunization_stock_layers` es la unidad real de existencias. Una capa = combinación de propietario + producto + lote + vencimiento + precio + fuente de financiamiento + tipo de suministro. **Nunca** se edita el saldo de una capa directamente desde la UI: todo cambio pasa por un movimiento en `immunization_stock_movements` con `quantity_before` / `quantity_delta` / `quantity_after`.

Salida por defecto: **FEFO** (primero el que vence antes), con opción manual de elegir lote.

### Tipos de movimiento en uso

`INITIAL_INVENTORY`, `DIRESA_INCOME`, `UNGET_INCOME`, `DIRESA_DISTRIBUTION_OUT`, `UNGET_DISTRIBUTION_IN`, `UNGET_DISTRIBUTION_OUT`, `IPRESS_DISTRIBUTION_IN`, `IPRESS_CONSUMPTION`, `IPRESS_RETURN_OUT`, `IPRESS_TRANSFER_OUT`, `IPRESS_DISPOSAL_OUT`, `UNGET_RETURN_IN`, `UNGET_TRANSFER_IN`, `UNGET_DISPOSAL_RECEIVED`, `STOCK_ADJUSTMENT`.

### Estados

| Entidad | Estados |
|---|---|
| Ingreso | `DRAFT` → `APPLIED` / `VOIDED` |
| Distribución | `DRAFT` → `SENT` → `RECEIVED` / `OBSERVED` / `VOIDED` |
| Devolución/baja | `SENT` → `RECEIVED` / `OBSERVED` / `VOIDED` |
| Inventario inicial | `DRAFT` → `CLOSED` |
| Cierre mensual | `PRE_CLOSED` / `FINAL_CLOSED` / `REOPENED` |

`OBSERVED` = recibido con diferencia física; exige motivo seleccionado + observación escrita. El stock sube **solo** por la cantidad físicamente recibida.

### Alcance (`ImmunizationScope`)

`getImmunizationScope(user)` en `services/immunizationApi.ts:443` deriva el ámbito desde el usuario:

- `level`: `GLOBAL` | `DIRESA` | `OGESS` | `UNGET` | `MICRORED` | `IPRESS`
- `ownerType`: `DIRESA` | `UNGET` | `IPRESS`
- claves de filtro: `diresaId`, `ogessId`, `ungetId(s)`, `facilityCode(s)`

Precedencia: ADMIN → `GLOBAL`; si hay `facilityCode` → `IPRESS`; luego UNGET, OGESS, DIRESA.

**Todo listado nuevo debe filtrarse por scope en las dos rutas** (query Supabase y filtro del fallback local). El helper `applyOwnerScope(query, scope)` cubre el caso simple; los listados con lógica propia (ver `listMonthlyClosures`, `listStockMovements`) repiten el patrón a mano.

**Regla aprendida (2026-07-30):** un registro propiedad de una IPRESS **siempre debe llevar `unget_id`**, además de `facility_code`. Si no, queda invisible para toda consulta por UNGET y el consolidado mensual pierde esos movimientos. Al escribir capas o movimientos de IPRESS usa `resolveOwnerUngetId(ownerType, ungetId, facilityCode)`, que lo deduce de `facilities.unget_id`. `closeInitialInventory` y `createAdjustment` incumplían esto; ver `docs/VALIDACION_DATOS_REALES_INMUNIZACIONES.md`.

### Reglas críticas (no negociables)

- No se permite saldo negativo.
- No se consume un lote inexistente.
- El catálogo maestro manda sobre la descripción del Excel; producto ausente o inactivo bloquea la fila.
- El inventario inicial cerrado no se edita: se corrige con Reajustes auditados.
- Productos vencidos/deteriorados **no** vuelven a stock disponible.
- Periodo mensual calendario, formato `YYYY-MM`. **No se opera en periodos futuros.**
- Un periodo precerrado (IPRESS) o cerrado (UNGET) bloquea consumo, devolución/baja, recepción, distribución y reajuste. Verificar con `immunizationApi.isPeriodLocked(scope, period)` antes de cualquier escritura nueva.
- Auditoría en todo movimiento crítico: usuario, fecha, motivo. Sin update/delete ordinario sobre movimientos.

---

## 6. Módulos de Inmunizaciones

| `AppModule` | Etiqueta UI | Componente | Rol operativo |
|---|---|---|---|
| `IMMUNIZATION_CATALOG` | Catálogo Biológico | `components/ImmunizationCatalogModule.tsx` | DIRESA/Admin |
| `IMMUNIZATION_INITIAL_INVENTORY` | Inventario Inicial | `components/ImmunizationInitialInventoryModule.tsx` | UNGET/IPRESS |
| `IMMUNIZATION_STOCK` | Stock Biológico | `components/ImmunizationStockModule.tsx` | propietario del stock |
| `IMMUNIZATION_STOCK_QUERY` | Consulta de Stock Biológico | `components/ImmunizationStockQueryModule.tsx` | supervisor, **solo lectura** |
| `IMMUNIZATION_INCOMES` | Ingresos Regionales | `components/ImmunizationIncomesModule.tsx` | DIRESA |
| `IMMUNIZATION_INCOME_ORIGINS` | Orígenes de Ingreso | `components/ImmunizationIncomeOriginsModule.tsx` | DIRESA/Admin |
| `IMMUNIZATION_DISTRIBUTIONS` | Distribuciones | `components/ImmunizationDistributionsModule.tsx` | DIRESA→UNGET, UNGET→IPRESS |
| `IMMUNIZATION_CONSUMPTION` | Consumo IPRESS | `components/ImmunizationConsumptionModule.tsx` | IPRESS |
| `IMMUNIZATION_RETURNS` | Devoluciones y Bajas | `components/ImmunizationReturnsModule.tsx` | IPRESS → UNGET |
| `IMMUNIZATION_ADJUSTMENTS` | Reajustes de Stock | `components/ImmunizationAdjustmentsModule.tsx` + `components/ImmunizationAdjustmentModal.tsx` | UNGET/IPRESS |
| `IMMUNIZATION_CLOSURES` | Cierre Mensual | `components/ImmunizationClosuresModule.tsx` | IPRESS precierra / UNGET cierra |
| `IMMUNIZATION_REPORTS` | Reportes Inmunizaciones | `components/ImmunizationReportsModule.tsx` | tablero de avance + descargas por UNGET y del ámbito |

### Servicios

| Archivo | Contenido |
|---|---|
| `services/immunizationApi.ts` (~171 KB) | Objeto `immunizationApi` con toda la lógica CRUD + reglas. Es el archivo más importante del módulo. |
| `services/immunizationMonthlyReportService.ts` | Filas y export PDF/Excel del movimiento biológico mensual. **Cinco** variantes sobre el **mismo** formato de 19 columnas: `IPRESS`, `UNGET_WAREHOUSE`, `UNGET_NETWORK`, `DIRESA_WAREHOUSE` y `DIRESA_NETWORK` (ver `REPORT_VARIANTS`). Un cambio de layout aplica a las cinco. |
| `components/ui/immunization.tsx` | **Kit visual compartido. Catálogo completo en la sección 8.** Tarjetas, cabeceras, chips, celdas de tabla, campos, clases de input y formateadores de fecha/número/moneda. Úsalo en vez de redefinir nada por módulo. |
| `services/immunizationDomain.ts` | Reglas de negocio usadas por varias pantallas: FEFO, periodo de una fecha, sentido de una distribución. Sin nada visual. |
| `services/appRoutes.ts` | `APP_BASE`, `pathForModule`, `moduleForPath`. Tabla de rutas por módulo; su prueba obliga a declarar la ruta de cada módulo nuevo. |
| `services/immunizationProgressService.ts` | Avance operativo mensual en **funciones puras**: estado de cierres, pendientes, incidencias, consumo, vencimientos y valorización. Fuente única de "precerrada / pendiente / cerrada" para el tablero y el módulo de cierre. |
| `services/immunizationExcelService.ts` | Parser `.xlsx` de inventario inicial, detección de columnas alternativas, plantilla. |
| `services/immunizationAdjustmentPdfService.ts` | Constancia PDF A4 de reajuste. |

---

## 7. Migraciones SQL

Los `.sql` de `supabase/` son **scripts que el usuario ejecuta manualmente en el panel de Supabase**. No hay CLI de migraciones ni control de versión de esquema. Al crear una migración: archivo nuevo en `supabase/`, idempotente donde sea posible, y anotarla en el documento de fase.

**El entorno del agente no puede aplicar SQL ni desplegar.** Prepárale al usuario el script y el comando exactos, listos para pegar; él los ejecuta.

Orden histórico del módulo:

1. `supabase/SUPABASE_SCHEMA_IMMUNIZATIONS_V1.sql` — base (productos, inventario inicial, capas, movimientos, reajustes)
2. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_ADJUSTMENTS.sql`
3. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_INCOMES.sql`
4. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_DISTRIBUTIONS.sql`
5. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_RECEPTIONS.sql`
6. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_REGIONAL_REFACTOR.sql` — refactor de Fase 14
7. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_CONSUMPTION.sql`
8. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_RETURNS.sql`
9. `supabase/SUPABASE_MIGRATION_IMMUNIZATION_MONTHLY_CLOSURES.sql`

Los esquemas `supabase/SUPABASE_SCHEMA_V2.sql` a `supabase/SUPABASE_SCHEMA_V15.sql` pertenecen al dominio de farmacia/SISMED, no a inmunizaciones.

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

Referencia normativa: `docs/UX_PLAN_INMUNIZACIONES.md`. Resumen operativo:

- **Estilo base:** sidebar oscuro, fondo `slate` claro, tarjetas `rounded-2xl border border-slate-200 bg-white shadow-sm`, iconos `lucide-react`, Tailwind.
- **Color con significado:** teal/cyan = información/stock; emerald = aplicado/cerrado/vigente; amber = pendiente/advertencia/reajuste; red = vencido/error/bloqueo; violet = reclasificación; blue = vista supervisora; slate = neutro.
- **Densidad:** 1 tarjeta de cabecera, máximo 4–5 KPIs, filtros en **una sola barra** compacta; fechas y filtros avanzados en popover/colapsable, nunca en tarjeta alta.
- **Tablas:** encabezado sticky, filas 52–60 px, descripción del producto a 13–14 px (no tamaño título), código SISMED en chip/monospace, estados en chips, acciones a la derecha, detalle por lote en fila expandible.
- **Operación ≠ supervisión:** en vista propia **no** mostrar columnas de Ubicación/Ámbito (son implícitas en la sesión). Solo el supervisor ve filtros territoriales.
- **Modales:** header fijo + body con scroll interno + footer fijo; sin scroll horizontal; `max-w-3xl` formulario simple, `max-w-5xl` operación con lista, `max-w-6xl` comparación compleja.
- **Nunca `window.confirm` / `alert`.** Usar modal propio (`components/ui/ConfirmationDialog.tsx`) para toda acción irreversible: cierre de inventario, aplicar reajuste, enviar distribución, recepción con diferencia, cierre mensual.
- **Móvil:** tablas → tarjetas; filtros → bottom sheet; footer sticky en modales.
- **Acentos:** cuidado con mojibake. `Biológico`, `Catálogo`, `Código`, `Distribución` deben renderizarse correctos en pantalla **y en PDF/Excel** (ver `services/pdfUnicodeFont.ts`).

### Qué reutilizar — mira aquí ANTES de escribir nada nuevo

La capa de componentes comunes **ya existe** (se creó el 2026-08-01 y se completó en la auditoría del 2026-08-02). Antes existían cinco `HeaderCell` con relleno y tamaño de letra distintos, cuatro `formatDate`, tres `SummaryCard` y seis `Field`; cambiar un estilo solo afectaba a la pantalla que se tocaba. **No lo reintroduzcas.**

**`components/ui/immunization.tsx` — todo lo visual y de formato**

| Necesitas | Usa |
|---|---|
| Tarjeta de indicador / KPI | `ImmunizationKpiCard` (`label`, `value`, `icon?`, `tone?`, `hint?`, `filled?`) |
| Cabecera de módulo | `ImmunizationPageHeader` |
| Chip de estado | `ImmunizationStatusChip` (`label`, `tone`) |
| Celda `<th>` de tabla | `ImmunizationTableHeader` (`align?: left \| right \| center`) |
| Campo de formulario con etiqueta | `ImmunizationField` (`label`, `required?`, `hint?`) |
| Dato suelto etiqueta/valor | `ImmunizationInfoPill` |
| Estado vacío | `ImmunizationEmptyState` |
| Clase de `<input>` de formulario | `immunizationInputClass` (h-11) |
| Clase de `<select>` | `immunizationSelectClass` (h-11) |
| Clase de campo en barra de filtros | `immunizationFilterInputClass` (h-10) |
| Fecha `15/07/2026` | `formatImmunizationDate` |
| Fecha y hora | `formatImmunizationDateTime` |
| Cantidad con separador de miles | `formatImmunizationNumber` |
| Importe en soles | `formatImmunizationCurrency` |
| Hoy para un `<input type="date">` | `todayInputValue` |
| Buscar sin tildes ni mayúsculas | `normalizeImmunizationText` |

**`services/immunizationDomain.ts` — reglas de negocio compartidas**

| Necesitas | Usa |
|---|---|
| Ordenar lotes por vencimiento (FEFO) | `sortLayersByFefo` |
| Periodo `YYYY-MM` de una fecha | `periodFromDate` |
| Sentido de una distribución | `distributionFlow` |
| UNGET que recibe / que envía | `distributionDestinationUngetId` / `distributionOriginUngetId` |

**Los tonos se nombran por significado, nunca por color:** `success`, `warning`, `danger`, `info`, `locked`, `neutral`. Si escribes `bg-emerald-100` a mano en un módulo, casi siempre querías un `tone`.

**Lo que sí es correcto que esté duplicado.** `statusLabel` y `StatusBadge` existen por separado en Distribuciones, Ingresos y Devoluciones porque cada entidad tiene **estados y textos distintos** (`SENT` es "Pendiente recepción" en una y "Pendiente UNGET" en otra). Unificarlos sería un error. La regla es: se comparte la *forma*, no el *vocabulario del dominio*.

**Si de verdad falta una pieza**, agrégala al kit y úsala desde todos los módulos que la necesiten — no la dejes local "por ahora". Se importa con alias cuando el nombre local ya está establecido: `import { ImmunizationTableHeader as HeaderCell } from "./ui/immunization"`.

---

## 9. Historial de fases

Documento maestro: `docs/PLAN_IMPLEMENTACION_INMUNIZACIONES.md`. Diseño funcional de referencia: `docs/INMUNIZACIONES_DISENO_FUNCIONAL.md`.

**Etapa 1 — base (Fases 1–10, cerrada)**
Catálogo maestro, tipos/permisos/navegación, servicios y alcance, importador `.xlsx` de inventario inicial, registro manual, cierre de inventario que genera capas, stock agrupado por producto/lote con alertas de vencimiento, reajustes auditados con constancia PDF. Handoff: `docs/FASE_10_HANDOFF_ETAPA_1_INMUNIZACIONES.md`.

**Etapa 2 — operación mensual**

| Fase | Alcance | Doc | Estado |
|---|---|---|---|
| 11 | Ingresos (modelo antiguo UNGET) | `docs/FASE_11_INGRESOS_UNGET.md` | refactorizada en F14 |
| 12 | Distribución UNGET → IPRESS | `docs/FASE_12_DISTRIBUCION_UNGET_IPRESS.md` | refactorizada en F14 |
| 13 | Recepción IPRESS con incidencias | `docs/FASE_13_RECEPCION_IPRESS_INCIDENCIAS.md` | generalizada en F14 |
| 14 | **Refactor abastecimiento regional** DIRESA → UNGET → IPRESS | `docs/FASE_14_REFACTOR_ABASTECIMIENTO_REGIONAL.md` | implementada |
| 15 | Devoluciones, bajas y transferencias IPRESS → UNGET | `docs/FASE_15_DEVOLUCIONES_BAJAS_IPRESS_UNGET.md` | implementada |
| 16 | Cierre mensual: precierre IPRESS, cierre definitivo UNGET, reapertura con motivo, bloqueo por periodo, reporte mensual IPRESS PDF/Excel | `docs/FASE_16_CIERRE_MENSUAL_INMUNIZACIONES.md` | implementada |
| 17 | **Reportes mensuales UNGET**: almacén y consolidado de red, PDF + Excel, dentro de Cierre Mensual | `docs/FASE_17_REPORTE_CONSOLIDADO_UNGET.md` | implementada y rediseñada el 2026-07-30 |
| — | **Validación con datos reales** contra Supabase; destapó el defecto de `unget_id` nulo en registros de IPRESS | `docs/VALIDACION_DATOS_REALES_INMUNIZACIONES.md` | corregido; reparación de datos opcional pendiente |
| 18 | **Reportes mensuales regionales DIRESA**: almacén regional y consolidado de región, con marcado preliminar/definitivo | `docs/FASE_18_REPORTE_CONSOLIDADO_DIRESA.md` | implementada |
| 19 | **Tablero de avance operativo** en `Reportes Inmunizaciones`, con alcance por rol y descargas por UNGET | `docs/FASE_19_TABLERO_AVANCE_OPERATIVO.md` | implementada |
| 20 | **Seguridad, UX y consolidación** (2026-08-01/02): RLS con token de sesión en las 15 tablas, kit de UI compartido, menú hamburguesa en móvil, URL propia por módulo, módulo `Consulta de Stock Biológico` de solo lectura, y auditoría de duplicados y código muerto | `docs/SEGURIDAD_AUDITORIA.md`, `docs/UX_PLAN_INMUNIZACIONES.md` | **implementada — último punto de trabajo** |

**Los reportes se descargan desde dos sitios y es intencional.** `Cierre Mensual` los ofrece a quien opera su propio cierre (IPRESS y UNGET); `Reportes Inmunizaciones` los ofrece a DIRESA por fila de UNGET y para el ámbito completo, porque ahí es donde supervisa. Ambos usan las mismas funciones de descarga, así que el archivo es idéntico.

Con la Fase 19 la **Etapa 2 queda funcionalmente completa** y §20 del diseño funcional está cubierta entera: el consolidado biológico vive en `Cierre Mensual` y el avance operativo en `Reportes Inmunizaciones`.

### El sistema de reportes (Fases 16-18) — donde quedó el trabajo

Cinco variantes, **un solo formato de 19 columnas**. Todas se arman con dos builders genéricos en `services/immunizationMonthlyReportService.ts`:

- `buildWarehouseReportRows(options, ownerType, isDistribution, isLoss)` — un almacén; la salida (e) es la distribución al nivel de abajo; las columnas de dosis van en `null`.
- `buildNetworkReportRows(options, ownerTypes, isIncome, isLoss)` — un ámbito consolidado; los traslados internos se anulan.

Los cinco builders públicos son envolturas de una línea. **Agregar un nivel nuevo es declarar sus clasificadores**, no escribir un reporte.

**La regla que sostiene los consolidados, en las dos alturas:** lo que queda dentro del ámbito del reporte es traslado interno y no cuenta como movimiento. `INTERNAL_NETWORK_MOVEMENT_TYPES` cubre UNGET↔IPRESS; `INTERNAL_REGIONAL_MOVEMENT_TYPES` le suma DIRESA↔UNGET. Solo cuentan las entradas desde fuera del ámbito y las salidas reales: consumo, baja no disponible (`IPRESS_DISPOSAL_OUT`, que sale y no vuelve) y reajustes negativos. Gracias a eso el `% factor de pérdida` es el indicador real de cada nivel. **Si tocas esta clasificación, corre `npm test`**: está cubierta en los tres niveles.

`isPreliminary` / `preliminaryReason` marcan el consolidado regional mientras falte alguna UNGET por cerrar: sufijo en el título, aviso en la nota y prefijo en el nombre del archivo. Se calcula sobre todas las UNGET supervisadas, **nunca sobre las filas filtradas en pantalla**.

### Detalle de las variantes UNGET

La UNGET descarga **dos** reportes, y ambos usan el mismo formato de 19 columnas del movimiento biológico IPRESS. Solo cambia qué alimenta cada columna y el rótulo de la salida (e).

| | Almacén UNGET | Consolidado red UNGET |
|---|---|---|
| builder | `buildImmunizationUngetWarehouseReportRows` | `buildImmunizationUngetNetworkReportRows` |
| (b) saldo anterior | del almacén | almacén + todas sus IPRESS |
| (c) ingreso | DIRESA + devoluciones aceptadas + reajustes + | **solo desde DIRESA** |
| (e) salida | `DISTRIBUCIÓN A IPRESS` | `CONSUMO IPRESS` |
| (i)(j)(k) dosis | **`null` → celda vacía** | dosis reales de las IPRESS |
| (l) saldo final | `SALDO ALMACÉN` | `SALDO TOTAL RED` |
| habilitación | periodo no futuro + hay datos | control de cierre completo |

**No hay anexo por establecimiento y es deliberado** (decidido el 2026-07-30). Crecería como `nº IPRESS × nº productos × nº lotes` y esa información ya existe: cada IPRESS emite su propio movimiento biológico al precerrar. Nada se pierde — `SALDO TOTAL RED − SALDO ALMACÉN` da el saldo conjunto de las IPRESS, y hay una prueba que verifica esa relación. Si alguien vuelve a proponer el anexo, este es el motivo por el que se descartó.

**La regla que sostiene el consolidado:** la distribución UNGET→IPRESS y las devoluciones IPRESS→UNGET son **traslados internos** y se anulan (constante `INTERNAL_NETWORK_MOVEMENT_TYPES`). Solo cuentan el ingreso desde DIRESA y las salidas reales: consumo, baja no disponible (`IPRESS_DISPOSAL_OUT`, que sale de la red y no vuelve) y reajustes negativos. Gracias a eso el `% factor de pérdida` del consolidado es el indicador real de la UNGET. **Si tocas esta clasificación, corre `npm test`**: la aritmética está cubierta.

Para ver cómo salen los PDF sin abrir la app:

```bash
npx vite-node scripts/generateImmunizationReportPreviews.ts
```

Usa los mismos builders que la aplicación y escribe las tres muestras en PDF y `.xlsx` en `reportes-ejemplo/`. Es posible porque `buildMonthlyReportPdfDoc` / `buildMonthlyReportWorkbook` están separados de las funciones de descarga. **Si ajustas anchos de columna del PDF, regenera y revisa la advertencia `could not fit page` de jspdf-autotable**: los anchos deben sumar 291 mm en A4 apaisado con margen de 3 mm.

**Trampa de ExcelJS, ya pagada una vez:** `row.values = [...]` con un array literal es **0-based** (índice 0 → columna A). ExcelJS solo usa numeración 1-based con arrays realmente dispersos, porque comprueba `value.hasOwnProperty('0')` y un `undefined` explícito sí cuenta. Poner un `undefined` inicial "para saltar la columna 0" corre todo el reporte una columna y rompe las fórmulas. Las pruebas fijan la posición de las celdas (`A6`, `D5`, `I6`) para que esto no se repita.

La versión anterior de esta fase usaba una matriz propia con columnas (b) almacén y (c) IPRESS separadas: contaba las devoluciones dos veces (pérdida de IPRESS + ingreso de UNGET) e inflaba el total de movimiento con traslados internos. Se retiró. `scripts/generateUngetConsolidatedPdfPreview.mjs` y `reportes-ejemplo/MOVIMIENTO_BIOLOGICO_UNGET_EJEMPLO_A4.pdf` reproducen esa matriz vieja y **quedaron obsoletos**.

Decisión mantenida: **la columna "Necesidad próximo mes" queda fuera**, igual que en el reporte IPRESS.

Regla del reporte IPRESS que también aplica a los tres: si el inventario inicial se registró en el mismo periodo, cuenta como **saldo anterior**, no como ingreso del mes. Las observaciones se limpian de UUIDs y textos automáticos redundantes.

---

## 10. Siguiente trabajo

**No queda construcción nueva pendiente en la Etapa 2, y la seguridad ya está aplicada** (los cuatro scripts `supabase/SUPABASE_SEGURIDAD_*.sql` corrieron en producción el 2026-08-01 y se verificó externamente que `anon` recibe 0 filas o 401). Lo que sigue, por orden de valor:

1. **Validar un periodo real completo** con varias IPRESS y muchos lotes. Todo lo construido está probado con datos escasos (1 producto, 11 movimientos); es el mayor riesgo abierto y el usuario lo tiene pendiente.
2. **Unificar `respaldo-inmunizaciones` con `main`** (ver sección 3).
3. **Deuda UX restante:** faltan las vistas de tarjeta en móvil para los módulos supervisores, y los filtros territoriales avanzados para DIRESA (`docs/UX_PLAN_INMUNIZACIONES.md` §9).
4. **Migrar a Supabase Auth** algún día. Es la única vía para retirar el modelo de token propio, pero hoy funciona y no es urgente.

**Pendiente de seguridad que el usuario pidió recordarle (2026-09-23):** el script de Google que recibe el stock de Sync SISMED no pide credencial, y cualquiera con su dirección puede reemplazar o dejar en blanco el stock de un establecimiento. Se acordó poner una clave por conexión. El detalle, el diseño propuesto y cómo desplegarlo sin cortar el envío están en `docs/SEGURIDAD_AUDITORIA.md`, sección «Pendiente: el envío de stock a Google Sheets no pide credencial». **Recuérdaselo al usuario si retoma trabajo sobre conexiones o sincronización.**

**Antes de empezar, corre el diagnóstico contra datos reales** (solo lectura, necesita `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`):

```bash
npx vite-node scripts/validateImmunizationReportsAgainstSupabase.ts 2026-07
```

Compara el saldo que calculan los reportes con el stock realmente almacenado, verifica el tablero de avance y avisa de registros de IPRESS huérfanos. Fue lo que destapó el defecto de `unget_id`.

Otros pendientes menores:

- Exportación del tablero de avance a PDF/Excel, sugerida en `docs/UX_PLAN_INMUNIZACIONES.md` §5.6. Se dejó fuera a propósito: el movimiento biológico ya se exporta desde Cierre Mensual.
- La validación visual automatizada por navegador quedó bloqueada históricamente (ver `docs/design-qa.md`), así que la verificación visual la hace el usuario manualmente.
- `scripts/generateUngetConsolidatedPdfPreview.mjs` y `reportes-ejemplo/MOVIMIENTO_BIOLOGICO_UNGET_EJEMPLO_A4.pdf` siguen ahí y están obsoletos.

---

## 11. Cómo trabajar aquí

0. **Antes de escribir un componente o una utilidad, búscalo.** Sección 8 de este documento, `components/ui/immunization.tsx` y `services/immunizationDomain.ts`. Este proyecto ya pagó el precio de no hacerlo.
1. **Leer primero** el `FASE_NN_*.md` más reciente en `docs/` y la sección correspondiente de `docs/INMUNIZACIONES_DISENO_FUNCIONAL.md` antes de tocar código.
2. **Incrementos pequeños**, una fase por vez, con entregable verificable. No construir varias fases de golpe.
3. **No romper farmacia/SISMED.** Los componentes de ese dominio (`SheetSearchModule`, `RedistributionModule`, `AdminOrganizationModule`, `IpressStockModule`…) son grandes y frágiles; no refactorizarlos de paso.
   Y si tocas las **conexiones de stock** —las tarjetas de UNGET, sus botones o `saveUngetConfigs`—, lee antes la sección 7 bis: ahí están las reglas de propiedad, que ya costaron varios defectos.
4. Al agregar una operación de escritura: validar scope, validar periodo bloqueado, no permitir negativos, registrar movimiento auditable, e implementar la **ruta Supabase y la ruta localStorage**.
5. Cerrar cada fase con `npm run lint` + `npm run build` y un documento `FASE_NN_*.md` con: alcance implementado, reglas funcionales, archivos modificados, migración a ejecutar, validación técnica y pendiente posterior.
6. Actualizar `docs/PLAN_IMPLEMENTACION_INMUNIZACIONES.md` (sección "Avance actual") en el mismo cierre.
7. Ante ambigüedad funcional (qué columna, qué regla de saldo, qué rol opera), **preguntar al usuario**: es quien conoce la operación real de la DIRESA y varias decisiones ya se revirtieron por asumir de más.
