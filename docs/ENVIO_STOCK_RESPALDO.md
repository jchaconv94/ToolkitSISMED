# Envío de stock por camino de respaldo

Aprobado por el usuario el 2026-10-09 (los dos respaldos). Toolkit de escritorio **2.3.2**.

## Por qué existe

La red de algunos establecimientos (proveedor **PRONATEL**) bloquea a propósito
`script.google.com`. Se comprobó en **PUERTORICO (06474)** el 2026-10-06 y en
**CONSUELO (06506)** el 2026-10-09, con la misma huella:

- El DNS desvía `script.google.com` a la IP interna `10.254.30.102`, **aunque se consulte a 8.8.8.8**.
- Con la IP real de Google, el TCP abre pero la conexión TLS se corta («Connection was reset»)
  solo para ese nombre: `docs.google.com` en el mismo servidor de Google sí responde.
- `www.google.com` resuelve a la IP de *forcesafesearch*: la red tiene un filtro de contenido central.
- Cloudflare (`sismed-conexion`, Backups SISMED) y Supabase sí pasan.

Un parche en la PC (archivo *hosts*) no sirve, y la red no la administra la DIRESA.

## Cómo funciona

```
1. Directo      Toolkit ──► script.google.com                                   (como siempre)
2. Respaldo A   Toolkit ──► Cloudflare sismed-conexion  POST /stock ──► Apps Script de la UNGET
3. Respaldo B   Toolkit ──► Supabase función stock-relay           ──► Apps Script de la UNGET
```

- El Toolkit usa el primer camino que llega a Google. **Google Sheets sigue siendo la fuente
  del stock**: los respaldos no guardan nada (no vuelve `stock_actual`) y el Apps Script de
  ninguna UNGET cambia.
- **Un solo código** para los dos respaldos: `supabase/functions/stock-relay/index.ts`.
  Cloudflare lo importa (`cloudflare/conexion/src/index.ts`, ruta `/stock`) y Supabase lo publica
  tal cual. Pruebas: `cloudflare/conexion/src/stock.test.ts`.
- La ruta `/stock` no usa la conexión abierta ni el Durable Object: no gasta su cupo.

### Qué manda el Toolkit

El mismo cuerpo JSON que iría a Google, y en cabeceras (no en la dirección, para que la clave
no quede en registros de direcciones):

| Cabecera | Contenido |
|---|---|
| `X-Toolkit-Destino` | La Web App configurada en el Toolkit |
| `X-Toolkit-Params` | Los mismos parámetros de siempre (`clave`, `equipo_id`, `reported_almcods`, …) |

El respaldo responde lo que respondió Google, con su código y `X-Relay: ok`. Si no pudo
reenviar: JSON `{error, message, final}` con `X-Relay-Error`; `final: true` significa que el
otro respaldo daría lo mismo y el Toolkit no lo intenta.

### Reglas del respaldo

| Regla | Por qué |
|---|---|
| Solo una PC con **clave de envío** vigente para ella (`app_send_key_verify`, la misma consulta del Apps Script). Basta un establecimiento de la clave aceptado. | Que no sea un reenvío abierto. Las filas de cada establecimiento las vuelve a filtrar el Apps Script, como siempre. |
| Solo destinos `https://script.google.com/macros/s/…/exec` (o `/a/macros/<dominio>/s/…/exec`) y redirecciones a `script.google.com` / `script.googleusercontent.com`. | Que no sirva para llegar a otro servidor. Una redirección al inicio de sesión de Google se rechaza con un mensaje claro. |
| Si Supabase no responde, **no** se reenvía. | Sin verificar la clave no pasa nada; se reintenta en 20 s. |
| Máximo 32 MB por envío. | Un hospital grande manda pocos MB. |
| No usa SQL nuevo. | `app_send_key_verify` ya existía y es pública (`anon`). No depende del interruptor del piloto de Backups. |

### Reglas del Toolkit (`toolskit/sismed_sync.py`, `toolskit/stock_routes.py` en Toolkit-OGM)

- **DNS desviado** (Google resuelve a una IP interna): no se intenta Google; se va al respaldo
  enseguida y el registro lo explica **una vez**, no en cada ciclo.
- **Conexión cortada** (TLS cortado, sin conexión, proxy): se prueba el respaldo en el mismo intento.
  Si el respaldo funciona, durante **6 horas** se va directo al respaldo (sin perder 10 s por
  intento en Google) y luego se vuelve a probar Google.
- **Google lento** (`ReadTimeout`): **no** se reenvía por el respaldo. Google recibió el envío y
  puede estar escribiendo la hoja.
- **Google responde un error HTTP** por la vía directa: se informa como siempre. Por un respaldo,
  si es 429 o 5xx se prueba el otro respaldo (puede ser solo con ese servidor).
- **Clave rechazada** por un respaldo: no se prueba el otro ni se reintenta. **Sin clave** en la
  PC: ni se consulta a los respaldos; el registro pide configurarla.
- **Supabase**: como mucho **un envío cada 30 minutos** por PC (su tráfico de salida gratuito es
  limitado). Cloudflare no cobra tráfico.
- Si los respaldos fallan mientras se estaba saltando Google, se prueba Google en ese momento.
- Si todo falla, los reintentos de siempre (cada 20 s). **No hace falta una cola**: cada ciclo lee
  el stock completo del SISMED y el Apps Script reemplaza la pestaña, así que el siguiente envío
  que pase deja la hoja al día. Reenviar el mismo stock no duplica nada.
- El éxito dice por dónde salió («Enviado por el respaldo Cloudflare») y queda en
  `runtime_last_sync_route`.
- **Registro sin secretos**: la consola y el archivo de registro ya no muestran la clave de envío
  (`06506-****`), el `equipo_id` ni la dirección del Apps Script (`/macros/s/***/exec`).

## Casos de falla revisados

| Situación | Qué pasa |
|---|---|
| PRONATEL bloquea también `workers.dev` | Pasa por Supabase (cada 30 min). Backups SISMED dejaría de verse en esa PC. |
| PRONATEL bloquea también `supabase.co` | Dejaría de funcionar la web ToolkitSISMED en esa red y la verificación de claves; el respaldo A sigue si Cloudflare pasa. |
| Bloquean los dos | No hay camino por internet desde esa red: queda compartir datos del celular. |
| Supabase caído | Los respaldos no reenvían (no pueden verificar la clave). Google directo funciona igual donde no está bloqueado. |
| Cloudflare sin la ruta `/stock` (versión anterior) o la función de Supabase sin publicar | El Toolkit no confía en esa respuesta y prueba el siguiente camino. |
| Un portal cautivo responde por el respaldo | Sin `X-Relay` no se cree: se prueba el siguiente. |
| Apps Script tarda más que el límite del respaldo | Google termina de escribir igual; el Toolkit lo verá como falla y el siguiente ciclo lo confirma (reemplazo de pestaña, sin duplicados). Supabase corta a los 150 s. |
| Web App no pública («Cualquier persona») | El respaldo se niega a seguir la redirección al inicio de sesión y lo dice. |
| Toolkit anterior a 2.3.2 | Sigue igual que antes (solo directo). |

**Consumo:** cada PC que usa el respaldo A hace 1 petición por ciclo (288 al día con 5 minutos).
El plan gratuito de Workers trae 100 000 al día para toda la cuenta, compartidas con Backups.
Con 100 PC bloqueadas serían ~29 000.

## Puesta en marcha

1. **Cloudflare:** se publica solo al unir el cambio a `main` (`cloudflare-conexion.yml`).
2. **Supabase:** crear el secreto del repositorio **`SUPABASE_ACCESS_TOKEN`** (Supabase →
   Account → Access Tokens) y ejecutar «Publicar reenvío de stock (Supabase)» en Actions. Sin el
   secreto la ejecución avisa y no publica; el Toolkit funciona solo con Cloudflare.
   - Alternativa sin token: Supabase → Edge Functions → *Deploy a new function* → nombre
     `stock-relay`, pegar `supabase/functions/stock-relay/index.ts` y **desactivar «Verify JWT»**.
3. **Toolkit 2.3.2:** se publica al unir el PR de Toolkit-OGM y llega solo por la actualización automática.
4. **Prueba real en CONSUELO:** en la consola de Sync SISMED debe aparecer el aviso de la
   dirección interna y luego «✓ ¡Éxito! … Enviado por el respaldo Cloudflare».
