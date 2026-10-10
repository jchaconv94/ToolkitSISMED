# Historial de disponibilidad (2026-10-09)

Pedido del usuario: ver la disponibilidad mes a mes y compararla con el año anterior, en las dos
vistas (todos los productos y medicamentos esenciales), guardada en la base por jurisdicción. Se
descartó calcular la evolución desde el archivo: los primeros meses salían con menos de 12 meses
de consumo, y el usuario pidió que el consumo sea siempre de 12 meses.

## Cómo funciona

- **El historial es la pantalla principal de Disponibilidad** (`components/AvailabilityHistory.tsx`).
  Muestra año y mes, cuatro indicadores (todos, esenciales, establecimientos con datos y meses
  guardados), dos gráficos con el año anterior punteado (`HistoryChart`), las tablas mes a mes por
  microred (o por UNGET, si se ven varias) y por establecimiento, y un panel por establecimiento
  con sus situaciones del mes. **No hay detalle por producto**: para verlo, se abre el reporte del
  mes con el TFORMDET de ese mes.
- **El reporte del mes** (el tablero de siempre) se abre con «Reporte del mes» y se vuelve con la
  flecha. Ahí está el botón **«Guardar en el historial»**
  (`components/AvailabilityHistorySaveDialog.tsx`), que guarda el mes de corte en las dos vistas.
- **El reporte usa siempre los últimos 12 meses** del TFORMDET (`lastMonthsOf`). Si el archivo
  trae más, los meses anteriores con sus 12 meses de consumo completos se pueden **llenar hacia
  atrás** desde la misma ventana: con 24 meses, salen 12 meses anteriores más el corte. Cada uno se
  calcula como si fuera el corte, con su stock al cierre (`stockByMonth`) y su ventana de 12 meses
  (`rowsAtMonth`). Una prueba comprueba que el corte calculado así da lo mismo que el tablero.

- **Establecimientos fuera del análisis** (2026-10-09): la lista personal de «Establecimientos
  del análisis» (⋯) aparta establecimientos de los indicadores, los gráficos y las microredes;
  se ven en su propia tabla «Fuera del análisis». Solo cambia cómo se muestra: el historial
  guarda todos los establecimientos, así que volver a marcar uno lo trae sin guardar otra vez.
  Los centros de salud mental comunitario van fuera por omisión.

## Qué se guarda

Tabla `availability_history` (`supabase/SUPABASE_DISPONIBILIDAD_HISTORIAL.sql`): una fila por
establecimiento (IPRESS, farmacias sumadas) × mes × vista, con cuántos ítems quedaron en cada
situación (desabastecido, substock, normostock, sobrestock, sin rotación y sin rotación vitales) y
el total.

- El porcentaje **se recalcula en la web** con la fórmula vigente: qué situaciones cuentan, los
  niveles y si la microred y la UNGET son promedio o suma (`historySeries`, `historyRows` en
  `services/availabilityHistory.ts`). La microred y la UNGET salen **del registro actual**.
- Lo que no se puede recalcular sin el detalle queda anotado en cada guardado: los límites de 2 y
  6 meses, el corte a un decimal y la versión de fusionados. «Meses guardados» marca los meses
  calculados con otros límites.
- Tamaño: unas 8 400 filas al año para toda la DIRESA. La lectura devuelve arreglos compactos en
  una sola llamada, porque Supabase entrega como mucho 1 000 filas por consulta.

## Reglas (decididas por el usuario)

| | Quién |
|---|---|
| Ver | Quien tiene el módulo, solo su jurisdicción: ADMIN y DIRESA todo; OGESS sus UNGET; UNGET sus establecimientos; microred los suyos; el responsable de un establecimiento, el suyo (un puesto comunal ve su IPRESS). |
| Guardar y quitar meses | ADMIN, DIRESA y UNGET (informático y coordinador), con la acción «Guardar y quitar meses del historial» encendida en su rol (`AVAILABILITY:saveHistory`), y solo en su jurisdicción. Ni OGESS, ni microred, ni el responsable de un establecimiento. |

Lo comprueba el servidor (`app_history_caller`, `app_history_scope_codes`). La web solo esconde el
botón.

## Casos de falla y cómo se cubren

| Caso | Qué se hace |
|---|---|
| Un establecimiento no informó el mes de corte (con stock 0 saldría todo desabastecido) | No se guarda y se lista como «No informó ese mes» (`reportedMonths` del TFORMDET). Con el TFORMDET real del usuario no pasa: los 34 establecimientos tienen todos los meses. |
| Mes en curso | No se guarda: lo bloquean la web y el servidor, con la hora de Lima. |
| Menos de 12 meses de consumo | No se guarda; la ventana dice cuántos trae. |
| TFORMDET sin clasificación (Toolkit anterior a 2.2.5) | Solo se guarda «todos los productos», con aviso. |
| Establecimiento fuera del registro o de la jurisdicción | No se guarda y se lista con el motivo. El servidor lo vuelve a comprobar. |
| El mismo mes dos veces | Reemplaza, no duplica (clave establecimiento + mes + vista). Antes de guardar, avisa cuántos estaban guardados, quién y cuándo. |
| El archivo nuevo trae menos establecimientos | Se reemplazan los que vienen; los que ya estaban se conservan (decisión del usuario). |
| Dos personas a la vez | Cada guardado es una sola operación en el servidor: gana el último y se ve quién fue. |
| Se guardó mal | «Meses guardados» → quitar el mes, con confirmación (solo lo de la propia jurisdicción). |
| Relleno hacia atrás sobre meses ya guardados | Por omisión solo se marcan los meses vacíos; los guardados muestran quién los guardó y se reemplazan solo si se marcan. |
| Cambia la fórmula | Lo que se recalcula cambia en todos los meses; lo demás queda anotado por mes. |
| Cambia la regla de gran volumen (ficha 28, 2026-10-09) | Cambia la situación de algunos productos, que se guarda ya contada: los meses guardados antes no la aplican. Se corrige guardando otra vez el mes (o el relleno hacia atrás) con el TFORMDET. |
| Un establecimiento cambia de microred o UNGET | Se agrupa con el registro actual; la nueva UNGET ve su historia. |
| Un establecimiento sale del registro | Su historial no se borra; lo ve la DIRESA. |
| Meses sin guardar o incompletos | La línea se corta en un mes sin guardar; un mes con menos establecimientos va con punto hueco ámbar, y el indicador dice «N de M». |
| Sin internet | El historial muestra la última copia guardada en el equipo, por usuario, con aviso. Guardar y quitar se apagan. Si nunca se abrió, entra directo al reporte del mes. |
| Sin el SQL aplicado | La web dice que el historial no está instalado y el reporte del mes funciona igual. |

## Cómo se probó

- `services/availabilityHistory.test.ts`: conteos, regla de vitales, que el historial reproduzca el
  porcentaje del tablero (UNGET, microred y establecimiento, con promedio y con suma), qué se
  guarda y qué no, el mes de Lima, la ventana de 12 meses y el relleno hacia atrás.
- El SQL se ejecutó dos veces seguidas en un PostgreSQL 16 local con un esquema de prueba, y se
  probó cada regla: quién ve qué (ADMIN, DIRESA, OGESS, dos UNGET, responsable de establecimiento y
  puesto comunal), quién guarda y quita, el rechazo del mes en curso, los conteos que no suman, las
  filas repetidas, la sesión vencida, el usuario inactivo, la acción apagada y que la tabla no se
  pueda leer directo. Con 20 000 filas, leer dos años de toda la DIRESA tarda ~0,2 s (1,1 MB).
- De punta a punta, la web contra ese PostgreSQL (escritorio y celular): guardar setiembre 2026 con
  el TFORMDET real, ver en el historial el mismo porcentaje que el reporte, el aviso de reemplazo
  y quitar el mes. Con un TFORMDET sintético de 24 meses, el relleno de 12 meses respetando un mes
  ya guardado por otra persona. Sin internet, la copia del historial y el botón apagado.

## Archivos de muchos meses (2026-10-09)

El primer TFORMDET real de 21 meses (enero 2025 a setiembre 2026) no se leía y salía «Suba la
consulta TFORMDET del Toolkit». El Toolkit 2.3.1 escribe el Excel con XlsxWriter en memoria
constante: los textos van dentro de cada celda y la hoja de 24 meses pesa ~620 MB sin comprimir,
más que el texto más largo que admite el navegador (~512 MB). `services/fastXlsx.ts` ahora
descomprime y recorre la hoja por trozos: lee igual que antes los archivos de siempre (misma huella
en el de 12 meses, y más rápido) y uno de 24 meses tarda ~18 s en Chromium. Si aun así no puede, el
aviso dice por qué y sugiere descargarlo con menos meses.

## Puesta en marcha

`supabase/SUPABASE_DISPONIBILIDAD_HISTORIAL.sql` ya está aplicado en Supabase (el usuario,
2026-10-09). Si se reinstala la base, se puede aplicar antes o después de publicar: la tabla es
nueva y nadie la lee hasta que la web la use.
