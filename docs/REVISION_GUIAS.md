# Revisión de guías

Desde el 2026-10-28, pedido del usuario. Reemplaza su Excel con macros `REVISAR_GUIAS.xlsm`, que comparaba las guías de salida del almacén de la UNGET con lo que cada establecimiento ingresó en su ICI. Es el módulo `GUIDES_REVIEW` (Farmacia → Revisión de guías), lo usa la UNGET y funciona sin internet.

## Qué compara

Para un mes, por establecimiento, **producto y lote**:

- **Enviado**: lo que salió del almacén hacia ese establecimiento, según el SISMED del almacén.
- **Ingresó**: `INGRE + REINGRE` del establecimiento en ese mes, según el TFORMDET del SISMED donde se importa el ICI (la «Total ingreso» del Excel).

| Estado | Cuándo |
|---|---|
| Falta | ingresó menos de lo enviado |
| No ingresó | se envió y no ingresó nada |
| Sobra | ingresó más de lo enviado |
| No se dio salida | ingresó y el almacén no le envió ese producto y lote en el mes |
| Completo | enviado = ingresado |

En «No se dio salida» se muestra la última guía de un mes anterior con ese producto y lote al mismo establecimiento («Antes: guía 0001259 del 17/07/2026»), o «Nunca lo envió el almacén». Suele ser una guía de fin de mes que el establecimiento ingresó al mes siguiente, o un ingreso de otro origen.

## De dónde sale

Se leen los DBF tal como están en la carpeta `DATOS` de cada SISMED (`services/dbfFile.ts`, dBase III con página de códigos Windows-1252). Son **dos SISMED**: el del almacén y el donde se importa el ICI de los establecimientos (puede ser el mismo; entonces se elige la misma carpeta dos veces).

| SISMED | Archivos | Para qué |
|---|---|---|
| Almacén | `TMOVIM.DBF`, `TMOVIMDET.DBF` | Las guías de salida y su detalle (obligatorios) |
| Almacén | `MALMACEN.DBF`, `MPRODUCTO.DBF` | Nombres y tipo de cada almacén o establecimiento, y de cada producto (opcionales) |
| ICI | `TFORMDET.DBF` | El ICI de cada establecimiento por mes |

Reglas (`services/guidesReview.ts`, con pruebas):

- Una guía de salida es un `TMOVIM` con `MOVCODITIP = 'S'` y `MOVSITUA = '1'` (vigente). Su mes es el de `MOVFECHREG` (fecha de registro). El número de guía es `MOVNUMEDCO` y el destino `ALMCODIDST`. Su detalle por producto y lote está en `TMOVIMDET` (`MOVNUMERO`, `MEDCOD`, `MEDLOTE`, `MOVCANTID`).
- El almacén que revisa es el origen (`ALMCODIORG`) más frecuente de sus salidas.
- **No se revisan las salidas a otro almacén** (AEM, almacén logístico, subalmacén): no tienen ICI. Se reconocen por su tipo en `MALMACEN.ALMTIPO` (L, A, S y V son almacenes; P, C y H, establecimientos) y, si no está en el catálogo, por el código (`030A04`, `030S05`).
- **Un establecimiento con farmacias recibe en su F01**: si el destino `06519` no tiene ICI en el mes y `06519F01` sí, se compara con el de `06519F01`. Las demás farmacias (F02…) reciben de la F01, no del almacén.
- Un destino sin ICI en el mes se muestra aparte («Sin ICI de setiembre 2026»): no se puede comparar. Pasa cuando el establecimiento todavía no envió su ICI o no se importó.
- Solo se ofrecen los meses que están en los dos SISMED.
- Las cantidades se comparan redondeadas a tres decimales.

## Decisiones del usuario

- **Por producto y lote** (2026-10-28), no solo por producto como la hoja CONTROL del Excel. Por eso algunos conteos cambian: en La Libertad, setiembre 2026, por lote son 38 completos, 4 sobran y 24 «no se dio salida»; por producto, 37, 5 y 21. `productCounts` da el conteo por producto, para comparar con lo que ya se conocía.
- Lo usa **la UNGET, en la web**, leyendo la carpeta del SISMED directamente (Chrome y Edge, una carpeta de red también sirve) o subiendo los archivos.
- Va en **Farmacia**.

## Comprobado

Con setiembre 2026 del ALM. ANEXO BELLAVISTA (030S05): las 2 486 líneas del reporte de guías de salida del Excel y los 34 establecimientos de su hoja CONTROL dan lo mismo (contando por producto). Por lote: 2 143 completos, 21 sobran, 246 «no se dio salida» y 11 establecimientos con diferencias. Leer los cinco DBF tarda menos de 1 s.

## Pantallas

- **Carga**: dos tarjetas, «SISMED del almacén» y «SISMED del ICI», con «Elegir carpeta» (`showDirectoryPicker`); se puede elegir `DATOS` o la carpeta del SISMED, y se busca `DATOS` adentro. La carpeta se recuerda en el equipo por usuario (`services/guidesReviewSources.ts`, IndexedDB): al volver, si el navegador aún da permiso se lee sola y se entra directo al resultado; si no, la tarjeta pide un clic («Leer la carpeta»). Firefox, Safari y el celular no abren carpetas: se suben los archivos («Suba los archivos»). Los DBF se leen en un Web Worker (`services/guidesReview.worker.ts`) y no se suben a internet.
- **Resultado**: almacén y mes arriba, Excel y ⋯ (volver a leer el SISMED, cambiar las carpetas). Cinco KPIs que filtran (establecimientos con diferencias, completos, faltan o no ingresó, sobran, no se dio salida), buscador, Microred y Mostrar, y la tabla por establecimiento (la hoja CONTROL). Los nombres y la microred salen del registro de Establecimientos; si no está registrado, el nombre de `MALMACEN`.
- **Detalle** (`components/GuidesReviewDetail.tsx`): el establecimiento en una ventana, con ‹ › y las flechas del teclado para pasar al siguiente, «Con diferencia» / «Todos», buscador y la tabla por producto y lote con la guía del almacén.
- **Excel** (`services/guidesReviewExport.ts`, con pruebas): hojas Resumen, Detalle y Guías de salida, de lo que muestra la tabla (búsqueda, filtro y orden); desde el detalle, solo ese establecimiento. Acción `GUIDES_REVIEW:export`.

No guarda nada en Supabase.
