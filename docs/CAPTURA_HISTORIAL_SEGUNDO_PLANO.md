# Captura del historial de stock en segundo plano

Hasta ahora, `stock_sync_history` solo se llenaba cuando alguien tenía **Consulta Stock**
abierto: si nadie entraba en toda la tarde, los movimientos de esa tarde no quedaban
registrados. Este proceso los captura solo, cada 15 minutos.

- Proceso: [`scripts/backgroundStockSync.ts`](../scripts/backgroundStockSync.ts)
- Programación: [`.github/workflows/historial-en-segundo-plano.yml`](../.github/workflows/historial-en-segundo-plano.yml)
- Ejecución local: `npm run sync:historial`

## Qué hace en cada ejecución

1. Lee `unget_configs` y se queda con las UNGET que tienen su hoja de cálculo configurada
   (`spreadsheet_id`). Las UNGET que comparten libro se revisan una sola vez.
2. Pide a Google Sheets API la lista de pestañas y la fecha de última actualización de cada
   una: **dos peticiones por libro**, no una por IPRESS.
3. Descarga por CSV (sin consumir cuota) **solo las hojas que cambiaron** desde el último
   registro guardado. Si una hoja no se tocó, no se lee.
4. Compara contra la foto del último registro y guarda en `stock_sync_history` únicamente
   los medicamentos que subieron o bajaron, con el mismo criterio que la aplicación
   (`services/stockSyncHistory.ts`): medicamento + lote, sumando tipo de suministro y
   fuente de financiamiento.
5. Quita la foto (`items_snapshot`) del registro anterior de esa IPRESS. Pesa unos 44 KB y
   solo sirve para comparar con la lectura siguiente; los movimientos y los totales que
   muestra el historial se conservan.

En el historial estos registros aparecen con el autor **«Captura automática»**.

La aplicación y este proceso comparten las reglas de lectura y de decisión
(`services/stockRowNormalizer.ts` y `services/stockSyncHistory.ts`). No se deben duplicar:
si cada uno agrupara el stock a su manera, compararían fotos distintas y el historial
mostraría movimientos que nunca ocurrieron.

## Qué hay que configurar una sola vez

### 1. Clave de Google Sheets API para servidor

La clave que usa la web está restringida al dominio `jchaconv94.github.io`. Un proceso
programado no es un navegador y no envía ese dato, así que Google la rechazaría.

En <https://console.cloud.google.com> → proyecto **ToolkitSISMED** → *APIs y servicios* →
*Credenciales* → **Crear credenciales → Clave de API**:

- Restricción de aplicación: **Ninguna**.
- Restricción de API: **Google Sheets API** (solo esa).

Esa clave únicamente puede leer hojas compartidas como «Cualquiera con el enlace: Lector»,
que es exactamente lo que ya hace la web.

### 2. Cómo se identifica el proceso ante Supabase

Hay dos caminos; basta con uno.

**Recomendado: usuario dedicado de la aplicación.** Crear en el panel de administración un
usuario (por ejemplo `captura_automatica`) con permisos de lectura equivalentes a DIRESA.
El proceso inicia sesión con `app_login` y trabaja con las mismas políticas RLS que
cualquier usuario: si la contraseña se filtrara, el alcance es el de ese usuario.

**Alternativa: clave `service_role` de Supabase.** Salta RLS por completo (acceso total a la
base). Solo si el usuario dedicado no funcionara.

### 3. Secretos en GitHub

En *Settings → Secrets and variables → Actions* del repositorio:

| Secreto | Para qué |
| --- | --- |
| `GOOGLE_SHEETS_API_KEY_SERVER` | Clave del punto 1. **Obligatorio.** |
| `SYNC_USERNAME` y `SYNC_PASSWORD` | Usuario dedicado del punto 2. |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo si se elige la alternativa. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Ya existen para el despliegue; se reutilizan. |

## Cómo probarlo

En la pestaña **Actions** del repositorio → *Historial de stock en segundo plano* →
**Run workflow**, marcando *«Solo revisar, sin guardar nada en Supabase»*. El registro de la
ejecución dice cuántas hojas cambiaron y cuántos movimientos habría guardado, sin escribir
nada.

En local, con las mismas variables de entorno:

```bash
DRY_RUN=1 TZ=America/Lima npm run sync:historial
```

## Límites conocidos

- Solo cubre las UNGET que tienen su hoja de cálculo configurada. Las demás aparecen en el
  registro de la ejecución como «sin hoja de cálculo configurada» y se saltan; se incorporan
  solas en cuanto se guarda su enlace en *Configurar*.
- El nombre que se guarda (`establishment_name`) es el de la pestaña de la hoja. La
  aplicación usa el nombre del establecimiento asignado cuando existe.
- GitHub puede retrasar las ejecuciones programadas cuando hay mucha carga, y las desactiva
  en repositorios públicos sin actividad durante 60 días (se reactivan desde *Actions*).
