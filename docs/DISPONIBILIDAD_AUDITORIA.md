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

**Propuesta:** aclararlo en la explicación «i», o mostrar el sobrestock sin la parte que ya
cuenta como riesgo.

### E. Desde qué fecha se cuentan los meses al vencimiento

Hoy se cuentan desde la fecha actual, pero el stock es al cierre del mes de corte.

- Valor en riesgo a 12 meses contando desde hoy: S/ 110 687.
- Contando desde el 30/09: S/ 105 643.
- Con un TFORMDET de varios meses atrás, la diferencia crece.

**Propuesta:** contar desde el cierre del mes de corte y decirlo en pantalla («al 30/09/2026»).

### F. Productos con stock y sin consumo

- 793 ítems tienen stock y CPA 0, así que todo su saldo figura «en riesgo» (S/ 210 162).
- Solo 141 tuvieron alguna otra salida: devoluciones 2 363 u, otras salidas 2 124 u y
  vencidos 202 u.
- Ya se separan con el indicador «De productos sin consumo».

**Propuesta:** mostrar en su panel las otras salidas del periodo, para distinguir el producto
que de verdad no se mueve del que sale por otra vía.

### G. Recorrer los paneles con ‹ ›

Al pasar de un registro a otro dentro del panel, la tabla de atrás no cambia de página; al
cerrar el panel vuelves a la página donde estabas.

**Propuesta:** que la tabla siga al registro abierto.

### H. Recordatorios de datos

- Este TFORMDET no trae MEDTIP/MEDPET/MEDEST, así que «Medicamentos esenciales» queda apagado.
  Hay que descargarlo con el Toolkit 2.2.5 o posterior.
- **Corrección (2026-10-08):** aquí decía que había 13 farmacias F02 o posteriores sin tipo y que
  06520 no tenía red ni microred en el registro. Eso salió del registro de prueba con que se
  revisó la auditoría (34 establecimientos y ninguna farmacia), no del registro real del usuario,
  que tiene todas sus farmacias registradas. No había que registrar nada.
