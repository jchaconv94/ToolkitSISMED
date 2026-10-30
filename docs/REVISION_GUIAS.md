# Revisión de guías

Desde el 2026-10-28, pedido del usuario. Reemplaza su Excel con macros `REVISAR_GUIAS.xlsm`, que comparaba las guías de salida del almacén de la UNGET con lo que cada establecimiento ingresó en su ICI. Es el módulo `GUIDES_REVIEW` (Farmacia → Revisión de guías), lo usa la UNGET y funciona sin internet.

## Qué compara

Para un mes, por establecimiento y **producto** (sumando sus lotes), como la hoja CONTROL del Excel:

- **Enviado**: lo que salió del almacén hacia ese establecimiento, según el SISMED del almacén.
- **Ingresó**: `INGRE + REINGRE` del establecimiento en ese mes, según el TFORMDET del SISMED donde se importa el ICI (la «Total ingreso» del Excel).

Los lotes de cada producto se ven en el detalle (y en la hoja «Lotes» del Excel), con lo que salió e ingresó con cada número de lote.

| Estado | Color | Cuándo |
|---|---|---|
| Completo | verde | ingresó lo mismo que salió del almacén |
| Incompleto | naranja | ingresó menos de lo que salió (una parte) |
| No ingresó | rojo | salió del almacén y no ingresó nada |
| Sobra | ámbar | ingresó más de lo que salió: además de la guía, un ingreso manual |
| Sin guía | violeta | lo ingresó sin guía del almacén en el mes: un ingreso manual |

En «Sin guía» se muestra la última guía de un mes anterior con ese producto al mismo establecimiento («Antes: guía 0001259 del 17/07/2026»), o «Nunca lo envió el almacén». Suele ser una guía de fin de mes que el establecimiento ingresó al mes siguiente, o un ingreso de otro origen.

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

- **Por producto, como la hoja CONTROL** (2026-10-28). Primero se comparó por producto y lote, y el usuario no reconocía sus cifras («no sé qué estarás comparando tú… y peor ni coincide»): un producto enviado con el lote A e ingresado con A y B salía como «Completo» más «No se dio salida» en vez de «Sobra». Ahora la tabla lleva las columnas de la hoja CONTROL en su orden (Nº guías, Salida med, Ingreso med, Completo, No salida, Sobra, Falta, No ingresó) y los lotes quedan como detalle.
- Lo usa **la UNGET, en la web**, leyendo la carpeta del SISMED directamente (Chrome y Edge, una carpeta de red también sirve) o subiendo los archivos.
- Va en **Farmacia**.

- **Trabajo progresivo** (2026-10-28): el usuario revisa establecimiento por establecimiento a medida que importa cada ICI del mes en el SISMED. La web no guarda una «revisión»: cada lectura toma el TFORMDET como está. Un establecimiento sin ICI del mes sale como «Falta importar su ICI»; al importarlo en el SISMED y **volver a la ventana del navegador**, se vuelven a leer solas las carpetas cuyos archivos cambiaron (tamaño o fecha; `filesStamp`) y ese establecimiento pasa a revisado, con un aviso. Si el SISMED está escribiendo, se queda lo leído y se intenta la próxima vez. Con archivos subidos no hay lectura automática.
- **Observaciones solo en este equipo** (2026-10-28, decisión del usuario): `services/guidesReviewNotes.ts`, IndexedDB por usuario, almacén y mes. Funcionan sin internet; si se cambia de PC o se borran los datos del navegador se pierden (quedan en los Excel exportados).
- **Tabla agrupada por microred**, como la hoja CONTROL.
- **Estados más claros** (2026-10-29, pedido del usuario: «No salida está pintado de verde y no debería… solamente lo que está completo debería estar pintado de verde… hay que tratar de hacerlo más entendible»). Cada estado tiene su color y solo «Completo» va en verde (tonos `serious` y `notice` nuevos en el kit); «Falta» pasó a **Incompleto** (ingresó una parte; «No ingresó» es nada) y «No se dio salida» a **Sin guía** (ingreso manual); «Sobra» se quedó. Las columnas, los indicadores, los filtros y el Excel van en el mismo orden (`GUIDE_STATE_ORDER`): Completo, Incompleto, No ingresó, Sobra, Sin guía; cada título de columna lleva el punto de su color (`marker` de `SortableTableHead`) y los cinco indicadores hacen de leyenda con lo que quiere decir cada uno. En el detalle del producto, un recuadro del color de su estado lo explica en palabras (`explainRow`, con pruebas: «Salieron 40 del almacén por la guía 0001544 y el establecimiento ingresó 70: 30 de más… Sin guía: los lotes 2062965, 2062975 y 2092323.») y cada lote dice de qué guía vino («Sin guía (ingreso manual)» si de ninguna) y su propio estado. «Observados» y «Falta importar su ICI» ya no usan verde ni ámbar.
- **Copia guardada en este equipo** (2026-10-29, pedido del usuario: «ese trabajo de revisión de guías yo no lo hago en un solo día… necesito que se mantenga permanente en el navegador»). La carpeta del almacén suele estar en otra PC de la red y la pueden apagar. Cada lectura buena se guarda en IndexedDB por usuario (`saveCopy` / `loadCopy` en `services/guidesReviewSources.ts`): lo leído de los DBF, no los archivos (el almacén de enero a setiembre 2026 ocupa unos 3,5 MB; el TFORMDET leído, unos 70 KB por mes). Al abrir el módulo se entra directo con la copia (medio segundo) y en seguida se intenta leer cada carpeta:
  - si los archivos no cambiaron (`filesStamp`), no se vuelven a leer;
  - si cambiaron, se leen y la copia se reemplaza;
  - si **la carpeta no responde** (PC apagada o sin red), se sigue con la copia y un aviso ámbar lo dice con su fecha («Se revisa con la copia guardada el 28/10/2026 a las 15:20»), con «Reintentar»; se vuelve a intentar sola al volver a la ventana y cada minuto;
  - si el navegador pide permiso para leerla (pasa al reabrir el navegador, salvo que se elija «Permitir en cada visita»), el aviso lo dice y «Leer el SISMED» lo pide con un clic.
  
  Una carpeta recién elegida que da error no reemplaza a la anterior ni a su copia (`rememberFolder` solo al leer bien). Los archivos subidos también se guardan como copia. Si cambia lo que se lee de los DBF (`readWarehouse`, `readIci`), subir `COPY_VERSION`: la copia vieja se descarta. También se recuerda el mes que se estaba revisando (`localStorage`). Las observaciones ya se guardaban en el equipo.
- **Qué archivos se suben** (2026-10-29): el cuadro del navegador deja elegir cualquier archivo, así que la tarjeta los muestra (obligatorios con borde y opcionales punteados) y `uploadProblem` dice qué está mal: los de la otra tarjeta («TFORMDET.DBF es del SISMED del ICI: súbalo en su tarjeta»), archivos que no se leen, o el que falta.

## Comprobado

Con setiembre 2026 del ALM. ANEXO BELLAVISTA (030S05): las 2 486 líneas del reporte de guías de salida del Excel coinciden, y los 34 establecimientos de su hoja CONTROL dan lo mismo en sus 8 columnas (Nº guías, Salida med, Ingreso med, Completo, No salida, Sobra, Falta, No ingresó). Leer los cinco DBF tarda menos de 1 s.

**Fechas (2026-10-28):** con el `TMOVIM.DBF` que el SISMED guardó a las 13:27 de ese día, ninguna salida tenía una fecha de registro legible y la revisión quedaba vacía (la copia de la mañana sí la tenía). Desde entonces se leen también las fechas con hora de Visual FoxPro (tipo `T`), una salida sin fecha de registro usa la de emisión (`MOVFECHEMI`), y si no hay ninguna el aviso dice de qué tipo es `MOVFECHREG`. Los avisos de una carpeta sin guías dicen qué trae el TMOVIM y el TMOVIMDET (entradas, salidas, números de ejemplo y fechas de guardado).

## Pantallas

- **Carga**: dos tarjetas, «SISMED del almacén» y «SISMED del ICI», con «Elegir carpeta» (`showDirectoryPicker`); se puede elegir `DATOS` o la carpeta del SISMED, y se busca `DATOS` adentro. La carpeta se recuerda en el equipo por usuario (`services/guidesReviewSources.ts`, IndexedDB) junto con la copia de lo leído: al volver se entra directo al resultado con la copia y la carpeta se lee si el navegador aún da permiso. Una tarjeta con copia que no se pudo poner al día va en ámbar con la fecha de la copia y «Leer la carpeta» o «Reintentar». Firefox, Safari y el celular no abren carpetas: se suben los archivos («Suba los archivos»), y la tarjeta muestra cuáles. Los DBF se leen en un Web Worker (`services/guidesReview.worker.ts`) y no se suben a internet.
- **Resultado**: almacén, mes y de cuándo es lo leído arriba («leído a las 15:20», o «almacén: copia guardada…» / «archivos subidos…»), Excel y ⋯ (volver a leer el SISMED, cambiar las carpetas); si una carpeta no responde o pide permiso, un aviso ámbar encima de los KPIs. Cinco KPIs, uno por estado (productos de todos los establecimientos, con su color y qué quiere decir), que filtran los establecimientos que tienen ese estado, y dos pestañas:
  - **Establecimientos**: buscador, Microred y Mostrar, y la tabla **agrupada por microred** (una fila de título por microred con cuántos establecimientos, cuántos con diferencias y cuántos sin ICI; el orden elegido rige dentro de cada una). **Cada fila se lee como una frase** (rehecha el 2026-10-30, pedido del usuario: «Salida 96, Ingreso 99, Completo 85 no se entiende a simple vista»; antes eran las diez columnas de la hoja CONTROL): Establecimiento · Guías · Productos («96 enviados / 99 ingresados») · **Cómo ingresó cada producto** (`GuideResultBar`: una barra que se reparte entre los estados con su color y, debajo, cada estado con su cifra y su palabra: «85 completos · 11 sobran · 3 sin guía»; el texto va en gris y el color solo en el punto) · **Revisión** («Todo bien» en verde, «14 por revisar · 0 de 14 con observación» o «Revisado»). Se ordena por guías, productos, diferencias o lo que falta revisar. Las cifras por estado siguen en los indicadores y en el Excel (hoja Resumen, con las columnas de la hoja CONTROL). Los nombres y la microred salen del registro de Establecimientos; si no está registrado, el nombre de `MALMACEN`.
  - **Guías de salida** (`components/GuidesReviewLines.tsx`, la hoja «Guias_de_salida» del Excel): cada línea con fecha de registro, guía, establecimiento (el código de la guía), producto, cantidad y lote, y el estado del producto en el ICI del establecimiento; filtros por establecimiento y estado. Tocar una línea abre su establecimiento.
- **Detalle** (`components/GuidesReviewDetail.tsx`): el establecimiento en una ventana, con ‹ › y las flechas del teclado para pasar al siguiente, y pestañas subrayadas (`UnderlineTabs` del kit, las de Disponibilidad):
  - Arriba, los cinco estados del establecimiento como indicadores: tocarlos deja en la tabla solo los productos de ese estado.
  - **Productos**: buscador (también por observación) y «Mostrar» (Con diferencia / Sin observación / Todos / un estado) en una lista desplegable en la misma barra, y la tabla por producto con su guía bajo el nombre, el resumen de sus lotes (el número si es uno, «4 lotes» si son varios) y su observación. **Observaciones en lote**: se marcan productos con la casilla (o la de la cabecera para todos los de la lista); la barra del buscador se reemplaza en su lugar por la de acciones, con su mismo aspecto y sin recuadro de color (el usuario rechazó una barra verde) («N marcados», un campo con autocompletar que sugiere las ya usadas —y, completando, las de su Excel: CORRECCIÓN DE LOTE, AJUSTE DE INVENTARIO, INVENTARIO, PARA VENTA…— y deja escribir una nueva, «Poner», «Quitar» y «Cancelar»). Enter pone la sugerencia resaltada (la primera que coincide); «Usar "…"» va al final.
  - Al **tocar un producto**, la misma ventana pasa a su detalle (← para volver, ‹ › o las flechas entre productos): enviado, ingresó, diferencia y estado, su observación con el mismo campo, cada lote con lo que salió e ingresó, y las guías del mes con ese producto (o la última anterior).
  - **Guías del almacén**: las líneas de las guías del mes a ese establecimiento.
  - Rediseño del 2026-10-28: el primero (filas de botones de sugerencias siempre a la vista, un panel extra al marcar, dos filas de pastillas y los lotes apilados en cada fila) el usuario lo rechazó por ineficiente. Se rehízo con lo que recomiendan Carbon (la barra de acciones en lote reemplaza a la de la tabla) y PatternFly (combobox con «crear opción»), los filtros en lista desplegable y la revelación progresiva de los lotes. Así se pone la misma observación a 63 productos en tres pasos (casilla de la cabecera, escribir «corr», Enter).
- **Excel** (`services/guidesReviewExport.ts`, con pruebas): hojas Resumen (las columnas de la hoja CONTROL más «Detalle faltante», «Detalle no ingresado» —«- PRODUCTO: cantidad; …», como en la hoja CONTROL— y «Observados»), Detalle (por producto, con la observación), Lotes y Guías de salida, de lo que muestra la tabla (búsqueda, filtro y orden); desde el detalle, solo ese establecimiento (lo que hacía el botón «Exportar hoja» del Excel). Acción `GUIDES_REVIEW:export`.
- Lo que el Excel necesitaba y la web no: «Importar guías» (se leen del SISMED del almacén), «Eliminar» y «Reset» (cada mes se elige en el selector y el ICI sale del SISMED).

No guarda nada en Supabase.
