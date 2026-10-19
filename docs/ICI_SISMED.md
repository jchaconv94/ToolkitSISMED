# ICI desde el SISMED: lo que se sabe y lo que se decidió

Documento de trabajo para rehacer las herramientas del libro **INFOSISMED v4.1** (Excel con macros que usan los responsables de farmacia) en el Toolkit de escritorio y en la web. Empezó el 2026-10-18. **Léelo antes de tocar el ICI, el consolidado o el TFORMDET.**

Los archivos de datos (TFORMDET, ICI, backups) no se guardan en el repositorio: traen datos de los establecimientos. Este documento guarda solo reglas, decisiones y cifras de comprobación.

---

## 1. Qué herramientas se rehacen

Del INFOSISMED v4.1 (58 módulos VBA, ~11 600 líneas) el usuario usa y quiere mejorar **cuatro**. Las demás (requerimiento, trazadores, indicadores, registro de recetas) ya no se usan.

| Herramienta | Qué hace hoy la macro | Qué se quiere |
|---|---|---|
| **Generar ICI** (`GENERAR_ICI_V2_5.GENERARICI`) | Toma el ICI `.xls` que descarga el SISMED, borra dos columnas (fecha de vencimiento repetida y «Requerimiento mes sgte»), agrega un panel (montos en soles, lotes con stock, por vencer, vencidos, sin precio) y un recuadro de guías **que se llena a mano** | Sacarlo del TFORMDET, con mejor diseño, recetas correctas, vencimientos y guías automáticas |
| **Consolidar ICI** (`UNIR_ICIS.unir_icis1`) | Une los ICI de cada farmacia de una carpeta sumando por código + lote | Sacarlo del TFORMDET en un paso, sin descargar ICI por ICI, y descontando lo que se movió entre farmacias del mismo establecimiento |
| **Formato ICI para puestos comunales** (`Formato_PPCC.dar_formato_PPCC`) | Plantilla en blanco desde el «ICI - Saldo por lotes» para que el puesto llene a mano | Pendiente: falta un formato llenado de ejemplo y saber de dónde sale el saldo inicial |
| **IME** (Informe de Movimiento Económico, hojas IME / IME-CONSULTAR) | Formulario manual con depósitos T6, guías y saldos 90 % / 10 %, guardado en hojas ocultas | Plan aparte, después del ICI |

Herramienta aparte, después: **revisión de guías de ingreso** (el usuario tiene otro Excel que compara lo que envió el almacén con lo que ingresó el establecimiento).

Problemas de la macro que no se deben repetir: borra el archivo original del SISMED (`Kill`), cambia la impresora predeterminada de Windows y no la devuelve, guarda en una carpeta que el usuario no eligió, toma un solo precio cuando junta lotes con precios distintos, deja vacía la fecha de vencimiento en el consolidado (los indicadores de vencimiento salen en cero) y tiene contraseñas escritas en el código.

---

## 2. El TFORMDET trae todo el ICI (comprobado)

El ICI que exporta el SISMED es una vista de la tabla **TFORMDET** (el detalle del ICI por farmacia, producto y lote). Comprobado cifra por cifra:

- **C.S.M.C. Bellavista (31456F01), enero 2026:** 68 de 68 lotes, todas las columnas iguales.
- **Hospital Bellavista F01, F02 y F04, agosto 2026:** 924 + 501 + 51 lotes, todas las columnas iguales salvo 4 lotes de la F01 que el usuario había pasado a mano de Devolución a Vencidos (ver §5).
- **Consolidado del hospital, agosto 2026:** la suma del TFORMDET da exactamente lo mismo que el consolidado de la macro en saldo (837 263), ingresos (312 135), venta (5 894), SIS (149 499), intervención (8 354), devolución (138 139), total de salidas (302 714) y stock (979 044).

Reglas del SISMED que cumple el TFORMDET en el 100 % de las filas:

- `TOTAL` = suma de las 18 salidas.
- `STOCK_FIN` = `SALDO + INGRE + REINGRE + ING_REGULA − TOTAL`.
- `PRECIO` = `PREADQ × 1,25` en ~99 % de las filas.

El TFORMDET viene **por farmacia**: los establecimientos con varias farmacias o puestos traen un `CODIGO_PRE` de 8 caracteres (`06502F01` … `06502F08`, `06528F01` …).

### Mapa de columnas ICI ↔ TFORMDET

| Columna del ICI del SISMED | Campo TFORMDET |
|---|---|
| Código, descripción, lote, reg. sanitario, vencimiento, tip. sum., f. finan., precio | `CODIGO_MED`, `DESCRIPCION MED`, `MEDLOTE`, `MEDREGSAN`, `FEC_EXP`, `TIPSUM2`, `FFINAN`, `PRECIO` |
| Unidad de consumo | `MEDFF` (desde el Toolkit 2.2.5) |
| Saldo mes anterior | `SALDO` |
| Ingresos | `INGRE` (**no** suma el reingreso) |
| — (el Excel del SISMED no lo muestra) | `REINGRE`, `ING_REGULA` |
| Ventas, S.I.S., Interv. sanit., F. pérdida, Defensa nacional, Exoneración, SOAT, Crédito hosp., Otros conv. | `VENTA`, `SIS`, `INTERSAN`, `FAC_PERD`, `DEFNAC`, `EXO`, `SOAT`, `CREDHOSP`, `OTR_CONV` |
| Devolución, Vencidos, Merma | `DEVOL`, `VENCIDO`, `MERMA` |
| Otras sal. | `OTRAS_SAL` (en el TFORMDET también existen `DISTRI`, `TRANSF`, `VENTAINST`, `ESSALUD`, `DEV_VEN`, `DEV_MERMA`) |
| Regula. | `SAL_REGULA` |
| Cons. ins. | `SAL_CONINS` |
| Salidas (total) | `TOTAL` |
| Saldo fin. disponible | `STOCK_FIN` |

Como el Excel del SISMED no muestra `REINGRE` ni `ING_REGULA`, su stock no cuadra a la vista en las farmacias con reingresos (su propio encabezado dice `(E+F)−R`).

---

## 3. Lo que se averiguó dentro del SISMED (informe del 18/10/2026)

Un Claude local revisó, en solo lectura, la instalación `C:\SISMEDV2OGM` del Hospital Bellavista (SISMED v2.5.3). Lo esencial:

### 3.1 Recetas

- El «Número Recetas» de la pantalla Formato ICI está en la tabla **TFORMATO**: una fila por farmacia (`CODIGO_PRE`), mes (`ANNOMES`) y tipo de suministro (`TIPSUM`), con `REC_VTAS`, `REC_SIS`, `REC_INTS`, `REC_EXO`, `REC_SOAT`, `REC_OTRCON`, `REC_CREHOS`. `REC_DN` (Defensa Nacional) nunca se calcula.
- **No son recetas médicas distintas: son dispensaciones** (una venta o ticket = 1). La rutina `procesar_ici` cuenta las cabeceras de salida de `TMOVIM` (`MOVSITUA='1'`) de la farmacia en el mes, por concepto (`CCTCODIGO`). Equivale a contar las ventas activas de `TVENTA` (`VTASIT='1'`) por forma de pago. Contar `DISTINCT NUMRCTA` (n.° de receta digitado) **no** reproduce la pantalla.
- Concepto → columna: 10/11/12 Venta · 13 SIS · 16 Intervención sanitaria · 15 Exoneración · 14 SOAT · 25 Otros convenios (incluye SALUDPOL, ESSALUD, crédito personal) · 17/19 Crédito hospitalario.
- **Error del Excel que exporta el SISMED** (`generaiciexcellform`): combina L12:M12 para la etiqueta «Nro Recetas» y escribe el SIS en M12, que queda oculta dentro de la combinación, así que **se pierde el SIS**. Además intercambia «Otros conv.» y «Crédito hosp.». En pantalla y en TFORMATO el dato está bien.
- Agosto 2026, hospital (TFORMATO): F01 SIS 51 + Int 1 · F02 Vtas 359 + SIS 2 022 + Exo 1 + Otros 17 · F04 SIS 2 + Int 332 · F05 SIS 1 126 + Otros 30 · F06 SIS 1 672 + Otros 1 · F07 Int 36 · F08 Int 63. Total: Vtas 359, SIS 4 873, Int 432, Exo 1, Otros 48.
- Las tablas `CABRECETA`, `DETRECETA` y `TRECETD` están vacías.

### 3.2 Cómo clasifica el SISMED cada salida (`procesar_ici`)

| Concepto (`TMOVIM.CCTCODIGO`) | Columna del ICI |
|---|---|
| 05 Riesgo de vencimiento, 07 Devolución por sobrestock, 22 Devolución por paciente, 36 R.S. cancelado/vencido | Devolución |
| 35 Devolución de vencido | **Vencidos solo si quien genera el ICI es un almacén** (la dependencia por defecto de `MCONFIG` SIS/DD tiene «A» o «S»); en una farmacia va a **Devolución** |
| 06 Deterioro | Merma |
| 08, 09, 32 | Transferencias (`TRANSF`) |
| 21 Ajuste de inventario | Regularización (salida `SAL_REGULA`; entrada `ING_REGULA`) |
| 33 Consumo institucional | Cons. ins. (`SAL_CONINS`) |
| cualquier otro (04 Distribución, 01–03, 19, 23, 27, 31, 37, 38…) | Otras sal. (`OTRAS_SAL`) |
| Entradas con concepto 05, 06, 07, 35, 36 | Reingreso |
| Entradas con concepto 21 | Ingreso por regularización |
| Otras entradas (en la práctica 04 Distribución del almacén) | Ingreso |

### 3.3 Entregas entre farmacias

Desde junio de 2026 la F01 abastece a F02–F08 con **Guía de Devolución, concepto 07** (devolución por sobrestock) en vez de Guía de Remisión con concepto 04. En la F01 sale como Devolución (121 959 unidades en agosto) y en la farmacia que recibe entra como Reingreso. El usuario confirmó que **toda transferencia entre farmacias se hace así**. El almacén de la UNGET nunca devuelve: entrega con guía y eso entra como Ingreso. Una transferencia entre dos establecimientos pasa por el almacén (devolución real del que entrega, ingreso real del que recibe).

### 3.4 Tablas útiles

`TMOVIM` / `TMOVIMDET` (cabecera y detalle por lote de todo movimiento; `ALMORGVIR` / `ALMDSTVIR` = subalmacén virtual de origen y destino, p. ej. `06502F0101`), `TMOVIMTRF` (enlace salida–ingreso de una transferencia), `TVENTA` / `TVENTADET` (ventas y dispensaciones), `TFORMATO` (cabecera del ICI con recetas), `TFORMDET` (detalle del ICI), `MTIPOCONP` (conceptos), `MTIPODOCU` (tipos de documento: 03 Guía de Remisión, 04 Guía de Devolución), `MFORMAPAGO` (forma de pago → concepto), `MALMACEN` (farmacias y almacenes).

---

## 4. Decisiones del usuario (2026-10-18 y 2026-10-19)

1. **Dónde:** la herramienta va **en los dos lados**.
   - **Toolkit de escritorio, primero:** un botón en el módulo de Farmacia; lee las tablas del SISMED directo y saca el ICI formateado, listo para firmar. Los responsables de farmacia no exportan nada.
   - **Toolkit web, sin internet:** para el usuario (DIRESA), que no tiene los SISMED de los establecimientos y trabaja con el archivo que le mandan.
   - **Un solo diseño y las mismas reglas:** una plantilla de formato que llenan los dos, y los mismos casos de prueba para las dos implementaciones.
2. **TFORMDET:** las columnas actuales **no cambian** (nombre, orden ni cifras: la Disponibilidad web las lee por nombre y solo la primera hoja). Lo nuevo va en columnas al final con nombres nuevos (p. ej. `VENC_CONCEPTO35`, `ENTREGA_INTERNA`, `RECIBIDO_INTERNO`, `CORRECCION_LOTE`) y en hojas después de la primera (`Recetas` desde TFORMATO, `Guías`). Antes de publicar, una prueba en la web asegura que la Disponibilidad da lo mismo con el archivo nuevo.
3. **Vencidos:** solo el concepto **35** va a Vencidos (también en farmacias, donde el SISMED lo manda a Devolución). El **05** (riesgo de vencimiento) y el **36** (R.S. cancelado) quedan en Devolución.
4. **Consolidado:** suma todas las farmacias **y puestos comunales** del establecimiento y **descuenta** lo que se movió entre ellos (no cuenta como devolución ni reingreso del establecimiento). El stock final del consolidado es igual a la suma de las farmacias.
5. **Corrección de lote** (sale y vuelve a entrar en la misma farmacia con otro lote o código): en el ICI queda **como siempre**, en Devolución y Reingreso, resaltada, y se explica en una hoja «Correcciones de lote». El TFORMDET tampoco cambia: al usuario le sirve ver ese reingreso.
6. **Recetas:** de TFORMATO, no del Excel del SISMED.
7. **Guías de ingreso:** automáticas (de `TMOVIM`), en vez del recuadro manual.
8. **Columna de reingreso en el ICI:** sí, faltaba.

---

## 5. Notas sobre los datos

- En el TFORMDET de octubre 2025 a septiembre 2026, el usuario cambió a mano 4 lotes de la F01 (agosto) de Devolución a Vencidos, porque el SISMED no deja ver qué salió por vencimiento. Con la regla del concepto 35 ya no hace falta. De esos 4, el etambutol 03302 lote 2087743 salió con concepto 07 (sobrestock, «corrección de lote»); el que salió vencido es el lote 2087803.
- Las cifras de recetas del hospital vienen de TFORMATO; las del C.S.M.C. de enero, del Excel del SISMED.

---

## 6. Diseño del ICI (en revisión con el usuario)

Prototipo aprobado en lo general el 2026-10-19 («hiciste un buen trabajo»), con ajustes pendientes:

- **Hoja ICI**, para imprimir **horizontal** en A4, a una hoja de ancho, con el encabezado de columnas repetido en cada página.
  - Banda de título con el mes, y debajo el periodo.
  - Tres recuadros: datos del establecimiento; resumen valorizado del mes (saldo anterior, ingresos, reingresos, consumo total, stock final, venta, SIS, intervención, devoluciones, vencidos); control del mes (lotes con stock, por vencer en 6 meses, vencidos con stock, productos sin precio, guías de ingreso).
  - Tabla por lote con encabezados girados agrupados (Producto, Saldo, Entradas, Consumos, Otras salidas, Saldo final). Nombres a la izquierda, cifras centradas, «–» en lugar de 0, cifras distintas de cero resaltadas por grupo (azul ingresos, verde consumos, ámbar devoluciones, rojo vencidos), fecha de vencimiento en rojo si ya venció con stock y en ámbar si vence en 6 meses.
  - Fila «N° de recetas» bajo las columnas de consumo; bajo Devolución, Vencidos, Merma y Otras salidas, el número de lotes con esa salida (como hacía la macro).
  - Totales, y al final **declaración jurada** con dos firmas, responsable de farmacia y jefe del establecimiento, cada una con nombre y DNI (sin colegiatura ni sello: decisión del usuario del 2026-10-19), y la **fecha en que se generó el informe**, automática y sin lugar.
- **Hoja Reporte de vencimientos:** resumen y cuatro listas (salieron por vencimiento en el mes, vencidos que aún tienen stock, vencen en 1–3 meses, vencen entre 3 y 6 meses), con lote, fecha, meses al vencimiento desde el cierre del mes, stock, consumo del mes, precio y valor.
- **Hojas Guías de ingreso y Correcciones de lote.**
- Pedidos del usuario (2026-10-19), ya aplicados en el prototipo: cifras **sin separador de miles** (con coma parecía decimal); sin notas en la fila de recetas; impresión **horizontal** con el encabezado de columnas en cada página; la columna de ajuste se llama «Ingreso por regularización» (concepto 21, entrada) y su par «Salida por regularización».
- Datos adicionales propuestos para una hoja «Resumen gerencial» (esperan la elección del usuario): desabastecidos (consumo en el mes y stock final cero), lotes sin movimiento con su valor, control FEFO (se despachó un lote que vence después mientras otro que vence antes seguía con stock), los 10 productos de mayor consumo en soles, resumen por financiamiento y tipo de suministro, y meses de stock solo si hay varios meses.

---

## 7. Plan

1. Ajustar el diseño hasta aprobarlo (prototipo con datos reales).
2. Toolkit de escritorio: ICI por farmacia y consolidado con un clic, leyendo TFORMDET, TFORMATO y TMOVIM; y el TFORMDET exportado con las columnas y hojas nuevas. Requiere una versión nueva (el usuario aprueba la publicación).
3. Toolkit web: el mismo ICI desde el archivo, sin internet.
4. Formato para puestos comunales.
5. IME (plan aparte).
6. Revisión de guías de ingreso (herramienta aparte).
