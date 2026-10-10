# Auditoría del módulo Disponibilidad (2026-10-07)

Revisión pedida por el usuario: buscar inconsistencias como las ya corregidas (lotes
repetidos sin farmacia, picos mal detectados, CPA de la red, paginación que se perdía),
probar las pantallas y proponer mejoras. Datos: TFORMDET de Bellavista, oct 2025 a set 2026
(12 meses, 8 692 ítems, 34 establecimientos).

## Qué se revisó

- **Las 9 pestañas, en escritorio y en celular.** Errores en consola: 0. Desbordes
  horizontales de la pantalla: 0. Recuadros «i» fuera de la pantalla: 0, tras la corrección 1.
- **Coherencia del TFORMDET:**
  - los lotes suman exactamente el stock de cada farmacia (0 diferencias);
  - 0 lotes sin fecha de vencimiento;
  - 0 productos con stock y precio 0 (los montos no se quedan cortos).
- **Coherencia entre la web y el Excel, y entre las pestañas.** Vencimientos, Sobrestock,
  Redistribución, Almacén y el Resumen se compararon cruzando sus números.

## Corregido en esta entrega

1. **El recuadro del ícono «i» se cortaba dentro de los paneles laterales.**
   - Ahora se dibuja sobre toda la página y se acomoda dentro de la pantalla.
   - Si no cabe abajo, se abre hacia arriba.
2. **El Excel y la web calculaban distinto el riesgo de vencimiento.**
   - El Excel usaba el criterio simple: meses de provisión mayores que los meses al primer
     vencimiento. La web usa FEFO por lote.
   - Con este TFORMDET, el Excel marcaba 990 ítems: **505 que la web no considera en riesgo**
     y **le faltaban 793** que la web sí.
   - Ahora el Excel recibe el mismo cálculo de la web: por lote, por farmacia o puesto
     comunal, con las farmacias del hospital sumadas.
   - Cambios en el Excel:
     - las columnas de riesgo dicen cuántas unidades vencerían sin usarse;
     - el hallazgo usa el valor que de verdad está en riesgo, y no todo el stock del producto;
     - la Metodología describe el nuevo método.
3. **El aviso de farmacias sin tipo ocupaba media pantalla en el celular.** Ahora lo resume y
   muestra la lista con «Ver cuáles».

## Pendientes que necesitan una decisión

### A. La F01 que abastece a sus puestos comunales (importante)

La F01 entrega a sus puestos comunales y lo registra como **OTRAS_SAL**, que no es consumo.

| Farmacia | Otras salidas | Consumo |
|---|---|---|
| 06520F01 P.S. Nuevo Tarapoto | 126 972 | 63 315 |
| 06528F01 P.S. Nueva Arica | 80 921 | 36 741 |
| 06519F01 C.S. Nuevo Lima | 79 635 | 220 603 |
| 06524F01 P.S. Barranca | 14 749 | 119 566 |

**Efecto:** cuando la F01 se evalúa sola (riesgo de vencimiento y fila desplegada en
Establecimientos), su CPA solo cuenta lo que dispensa. Por eso aparece con sobrestock y con
lotes «en riesgo» que en realidad se irán a sus puestos.

**Resuelto (2026-10-07, opción 1 elegida por el usuario):** para la F01 de un establecimiento
con puestos comunales, el riesgo de vencimiento usa como ritmo consumo + OTRAS_SAL
(`asSupplier`). La disponibilidad oficial no cambia. No se aplica a la F01 de un hospital con
farmacias (06502), porque sus otras salidas van a esas farmacias, que ya se suman con ella.

Al revisarlo, el usuario pidió además contar **EXO** (entregado exonerado de pago) como
consumo, en la web y en el Toolkit de escritorio (PR #16 de Toolkit-OGM).

La 06502F01 (Almacén del hospital) tiene 837 259 en otras salidas, pero como sus farmacias se
suman con ella no le afecta.

### B. Faltantes de un puesto escondidos en la cifra del establecimiento

«¿Dónde falta?», Sobrestock y Redistribución trabajan por establecimiento (IPRESS), con todas
sus farmacias sumadas.

- **65 casos:** el establecimiento figura en normostock o sobrestock, pero uno de sus puestos
  comunales está desabastecido. Ejemplo: Nuevo Jaén, sulfametoxazol + trimetoprima 400 mg.
  Ninguno aparece como faltante.
- **308 casos:** el establecimiento está en sobrestock, pero alguna de sus farmacias no. El
  excedente está en otra farmacia.

**Resuelto (2026-10-07, aprobado con prototipo):**
- «¿Dónde falta?»: tarjeta y pastilla «Faltan en un puesto», con el stock de la F01 al lado
  (`siteGapReport`). Con este TFORMDET: 80 puestos, 71 con stock en su F01.
- Redistribución: sugerencias internas F01 → puesto (`internalTransfers`). La F01 se queda con
  2 meses de lo que dispensa; cada puesto recibe lo justo para 2 meses. Con este TFORMDET: 170,
  62 a puestos desabastecidos.

### C. Redistribución sin mirar el almacén

338 de las 610 sugerencias son de productos que el almacén tiene.

**Resuelto (2026-10-08):** Redistribución pasó a ser un **plan editable**, con una fila por
necesidad y todas sus fuentes: internas F01 → puesto, el excedente de otros establecimientos y,
al final, el almacén (opción A del usuario). Cada fuente tiene un saldo, así que nada se cuenta
dos veces. La edición se hace en un panel lateral y el plan se descarga en Excel. Se probó y se
rechazó un interruptor «cubrir primero desde el almacén»: recalculaba el plan y duplicaba lo
abastecido.

Con este TFORMDET: 2 782 necesidades; de otros establecimientos 21 712 u, del almacén 22 351 u e
internas 3 088 u; 1 822 quedan sin cubrir.

### D. Dinero contado dos veces en el Resumen

393 productos en sobrestock también tienen lotes que vencerán sin usarse. Parte del dinero
aparece a la vez en «Sobrestock inmovilizado» y en «Vence sin usarse».

**Resuelto (2026-10-08):** en el Resumen, «Sobrestock inmovilizado» se muestra sin la parte que
ya cuenta en «Vence sin usarse en 12 meses» (`overstockAtRisk`: por producto y establecimiento,
lo menor entre el excedente y lo que vence en 12 meses). Con este TFORMDET eran S/ 36 432
repetidos (S/ 551 804 de sobrestock pasan a S/ 515 373). La pestaña Sobrestock conserva el total
y lo indica («de ello S/ 36 432 vence en 12 meses»). Su tarjeta «Se puede mover a donde falta»
usa ahora el plan de redistribución.

### E. Desde qué fecha se cuentan los meses al vencimiento

Hoy se cuentan desde la fecha actual, pero el stock es al cierre del mes de corte.

- Valor en riesgo a 12 meses contando desde hoy: S/ 110 687.
- Contando desde el 30/09: S/ 105 643.
- Con un TFORMDET de varios meses atrás, la diferencia crece.

**Propuesta:** contar desde el cierre del mes de corte y decirlo en pantalla («al 30/09/2026»).

**Resuelto (2026-10-09):** los meses al vencimiento se cuentan desde el último día del mes de
corte (`cutDateOf` en `services/availabilityReport.ts`, con pruebas), en la web y en el Excel:
situación del producto, riesgo por lote (FEFO), Vencimientos, Resumen, Sobrestock y Almacén. Las
tarjetas «Vence sin usarse en 12 meses» lo dicen («N lotes · al 30/09/2026»), la «i» de
Vencimientos lo explica y la Metodología del Excel lo anota. Con un TFORMDET viejo ya no se marca
en riesgo un lote solo porque pasó el tiempo desde el corte.

### F. Productos con stock y sin consumo

- 793 ítems tienen stock y CPA 0, así que todo su saldo figura «en riesgo» (S/ 210 162).
- Solo 141 tuvieron alguna otra salida: devoluciones 2 363 u, otras salidas 2 124 u y
  vencidos 202 u.
- Ya se separan con el indicador «De productos sin consumo».

**Propuesta:** mostrar en su panel las otras salidas del periodo, para distinguir el producto
que de verdad no se mueve del que sale por otra vía.

**Resuelto (2026-10-09):**

- El TFORMDET se lee también con sus salidas que no son consumo, por tipo y por mes
  (`TFORMDET_OUTFLOWS`: devoluciones, distribución, transferencias, vencidos, merma, otras
  salidas, defensa nacional, venta institucional; `outflows` de cada fila, sumadas por IPRESS y
  por códigos fusionados).
- Se comprobó que todas restan del stock: en las 196 866 filas del TFORMDET de 12 meses,
  STOCK_FIN = SALDO + INGRE + REINGRE − consumo − estas salidas.
- SAL_CONINS, SAL_REGULA e ING_REGULA son informativas y quedan fuera. FAC_PERD, DEV_VEN y
  DEV_MERMA no se usan en la operación (el usuario) y no se muestran.
- El panel del producto tiene la sección «Otras salidas (no son consumo)», con una fila por tipo
  (unidades, meses con salida, última salida). Sin consumo, dice «salió por otra vía» o avisa que
  «el stock no se mueve».
- En Vencimientos, la tarjeta «De productos sin consumo» dice cuánto de ese dinero no se mueve
  nada (`isStill`, `stillValue`), y la tabla tiene el filtro «Sin ningún movimiento».
- Con este TFORMDET, por IPRESS: de 793 productos con stock y sin consumo, 123 salen por otra vía
  (casi todos por devoluciones) y 670 no se mueven.
- De paso, el panel se aclaró a pedido del usuario:
  - la columna «Se usa» de los lotes pasa a «Por consumir»;
  - «En otros establecimientos» es una tabla (Stock, Meses de stock, Situación) en vez de
    «30 u · 0,0 m»;
  - el dato «Meses» dice «Meses de stock».

### G. Recorrer los paneles con ‹ ›

Al pasar de un registro a otro dentro del panel, la tabla de atrás no cambia de página; al
cerrar el panel vuelves a la página donde estabas.

**Propuesta:** que la tabla siga al registro abierto.

**Resuelto (2026-10-09):** la tabla de donde se abrió el panel lo sigue. Al pasar de registro con
‹ › o con las flechas, salta a la página donde está el registro abierto (en el celular, carga la
lista hasta él). Al cerrar el panel, lo deja a la vista y lo resalta un momento. Va en
`ReportTable` y `drawerNav`, así que vale para todos los paneles del tablero (producto, producto en
la red y plan de redistribución). Probado: del registro 1 al 31 la tabla pasa a «26–50 de 718» y
resalta el 31; en el celular, del 1 al 61 carga hasta el 100 y lo centra.

### H. Recordatorios de datos

- Este TFORMDET no trae MEDTIP/MEDPET/MEDEST, así que «Medicamentos esenciales» queda apagado.
  Hay que descargarlo con el Toolkit 2.2.5 o posterior.
- **Corrección (2026-10-08):** aquí decía que había 13 farmacias F02 o posteriores sin tipo y que
  06520 no tenía red ni microred en el registro. Eso salió del registro de prueba con que se
  revisó la auditoría (34 establecimientos y ninguna farmacia), no del registro real del usuario,
  que tiene todas sus farmacias registradas. No había que registrar nada.

### I. Comparación con el tablero nacional de la DME (2026-10-09)

El usuario comparó el historial con el tablero de DIGEMID (ficha 28, convenios de gestión
2026): Bellavista daba entre 4 y 7 puntos menos en todos los meses. Con el archivo de
disponibilidad del SISMED de agosto 2026 y la tabla «Detalle de la DME mensual por IPRESS» del
tablero (33 establecimientos, 84,04 %), establecimiento por establecimiento:

1. **Sin rotación que no son vitales (corregido).** La ficha dice que en sin rotación «solo se
   considera a los medicamentos vitales» (RM 1288-2018). El tablero nacional saca del total a
   los que no son vitales; la web los dejaba en el total como no disponibles. Ahora, con la
   regla «vital», no se evalúan (`isEvaluated` en `availabilityReport.ts`, `evaluatedCounts` en
   el historial). Agosto pasa de 79,9 % a 82,7 %, y el sin rotación queda igual o a uno de
   diferencia del nacional en 31 de 33 establecimientos. El sobrestock ya coincidía. El
   historial se recalcula solo: cada mes guarda aparte sus sin rotación vitales.
2. **El C.S.M.C. Bellavista (31456) no está en el tablero nacional** (el usuario: «no se
   considera a salud mental»). Su porcentaje está cerca del promedio, así que no explica la
   diferencia. La ficha no excluye a los centros de salud mental (entran «los EE.SS.
   registrados en RENIPRESS y en el Catálogo de prestadores del SISMED»). **Decisión del
   usuario (2026-10-09, ajustada el 2026-10-10):** una lista, «Establecimientos del análisis», para
   dejar establecimientos fuera, por jurisdicción como el registro de Establecimientos (la cambian
   la DIRESA y cada UNGET en lo suyo); los C.S.M.C. van fuera por omisión y se ven aparte
   (`services/availabilitySites.ts`, `SUPABASE_DISPONIBILIDAD_ESTABLECIMIENTOS.sql`).
3. **Medicamentos que la web cuenta y el nacional no.** En casi todos los establecimientos la
   web tiene ~6 normostock y ~2 desabastecidos más. Los que aparecen en todos o casi todos y
   el nacional no cuenta: betametasona crema 20 g, clorfenamina 4 mg, sodio cloruro 0,9 %
   100 mL, tetraciclina ungüento oftálmico, fitomenadiona 10 mg/mL, calcio gluconato y tres
   yodo povidona de 1 L (dos de espuma salen desabastecidas en 24 y 26 establecimientos). Sin
   ellos, agosto da 83,5 %. Pueden ser la exclusión por intervención estratégica (listado de
   DGIESP) o un listado de fusionados distinto. **Resuelto el 2026-10-10** con el detalle por
   producto del tablero (ver «Excluidos de la DME» más abajo).

4. **Soluciones de gran volumen (corregido).** La ficha (consideración a) dice: «Para un
   medicamento que corresponde a una solución de gran volumen (igual o mayor 1 litro) la
   disponibilidad se considera con un mes de existencia disponible». La web no lo aplicaba.
   Ahora un medicamento de la lista de soluciones de gran volumen es Normostock desde 1 mes, solo
   en la DME de fábrica. Al principio se reconocía por la presentación en la descripción; desde el
   2026-10-10 es una **lista guardada en Supabase** (pestaña «Gran volumen» de Configuración,
   `DEFAULT_LARGE_VOLUME`: los 229 medicamentos en solución o inyectable de 1 L o más del catálogo
   de productos SISMED, sin los excluidos de la DME). En
   Bellavista da lo mismo que la detección: entran dextrosa 5 % y 10 %, lactato de Ringer, solución
   polielectrolítica y agua para inyección. Agosto
   pasa de 82,67 % a 83,17 % (17 ítems cambian; tres de los nueve del punto 3 son yodo
   povidona de 1 L). Los meses del historial guardados antes de este cambio no la aplican:
   hay que volver a guardarlos con el TFORMDET.

**Investigación del listado de DGIESP (2026-10-09).** La ficha 28 (el PDF que pasó el usuario,
firmado el 18/12/2025) dice: «Medicamento que corresponde a la atención exclusiva para
Intervención Estratégica de Salud Pública. Basado en el listado comunicado por DGIESP, que
corresponden a un medicamento que cubre al 100% de la población, no aplica cuando cubre solo
un grupo etáreo (exclusión automática para todos los EESS evaluados)». El listado se
«comunica»: no está publicado en las páginas de DIGEMID, DGIESP ni CENARES. En el TFORMDET de
Bellavista los nueve medicamentos del punto 3 salen casi todo por SIS y casi nada por INTERSAN,
así que tampoco se puede deducir de los datos. Hay que pedirlo a DIGEMID o al responsable SISMED
de la DIRESA.

**Excluidos de la DME (corregido el 2026-10-10).** Con las dos reglas quedaban 0,87 puntos
(83,17 % frente a 84,04 %): el nacional evaluaba 3 247 ítems frente a 3 606. El usuario pasó el
detalle por producto del tablero (agosto 2026, Bellavista: 3 397 filas, 150 «NO APLICA»). Los
medicamentos que el nacional no evalúa son 15: siete marcados «NO APLICA» en todos los
establecimientos (sodio cloruro 0,9 % 1 L y 100 mL, oxitocina, calcio gluconato, fitomenadiona y
dos insulinas) y ocho que no incluye (alcohol 70°, clorhexidina 4 %, agua oxigenada, tres yodo
povidona de 1 L, hierro polimaltosa 50 mg/mL y tetraciclina ungüento oftálmico). El reporte
nacional completo (todas las DIRESA, solo las 10 000 filas con más stock) confirma «NO APLICA» en
todo el país para sodio cloruro 1 L y 100 mL, oxitocina y calcio gluconato. Sin esos 15, agosto da
**84,03 % frente a 84,04 %**, 29 de 33 establecimientos coinciden exactos y los otros 4 difieren
en menos de 0,9 puntos.

Ahora son la lista de fábrica de la pestaña «Excluidos de la DME» de Configuración
(`DEFAULT_DME_EXCLUDED` y `dmeExcluded` de la fórmula en `services/availabilityConfig.ts`; el
filtro, en `essentialRows`, por el código o el de su grupo de fusionados). Cada uno lleva su
motivo: «Intervención estratégica» los siete «NO APLICA» y «No figura en el tablero nacional»
los ocho ausentes. El ADMIN la cambia (agregar, editar nombre y motivo, quitar, restablecer); se
guarda en `availability_config` dentro de la fórmula, sin SQL nuevo. Solo cambia la DME. Como
NaCl 1 L, el alcohol, la clorhexidina, el agua oxigenada y los yodo povidona son de 1 L, la regla
de gran volumen ya casi no cambia nada en agosto: quedan dextrosa, lactato de Ringer, solución
polielectrolítica y agua para inyección. Los meses del historial guardados antes no la aplican:
hay que volver a guardarlos con el TFORMDET.
