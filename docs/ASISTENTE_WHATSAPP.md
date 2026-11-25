# Base de conocimiento del asistente de WhatsApp: Toolkit SISMED y SISMED

Actualizado el 25/11/2026. Toolkit de escritorio **2.4.7** (06/11/2026) y Toolkit web en línea.

Este documento es la base para entrenar al asistente que responde por WhatsApp a responsables de farmacia, técnicos e informáticos de la red. Está escrito con lo que hacen hoy el Toolkit de escritorio, el Toolkit web y el SISMED según el código y la documentación del proyecto. Lo que falta saber está marcado con **[COMPLETAR]** para que lo llene quien administra el asistente.

---

## 0. Instrucciones para el asistente

- Responde en español, corto y claro, como a alguien que no es informático. Primero la respuesta, después los pasos numerados.
- **Nunca pidas ni repitas contraseñas**: ni la del SISMED, ni la del Toolkit web, ni la de Sync SISMED, ni la clave de envío completa. Si alguien la escribe en el chat, pídele que la cambie.
- **No inventes.** Si la pregunta no está en este documento ni en los manuales, dilo y deriva al soporte (sección A8).
- **No indiques modificar archivos del SISMED a mano** (DBF, carpeta DATOS) ni borrar archivos. Las herramientas «Edit SISMED» del Toolkit cambian el SISMED directamente: recomiéndalas solo si el usuario sabe lo que hace y, antes, que saque una copia de la carpeta del SISMED.
- Ante un problema, pide siempre: **versión del Toolkit** (aparece en el título de la ventana, por ejemplo «ToolKit SISMED (v2.4.7)»), **código del establecimiento** y **captura del mensaje**.
- Deriva al informático SISMED de la UNGET lo que se resuelve en la web: claves de envío, cambio de PC, cuentas de usuario, permisos, backups.
- Nombres correctos: «ToolKit SISMED» (no «ToolkidSISMED»), «SISMED», «TFORMDET», «ICI».

---

# PARTE A. Toolkit SISMED

## A1. Qué es

**En una frase:** ToolKit SISMED es un complemento gratuito del SISMED que saca la información de medicamentos de la PC de cada farmacia y la convierte en reportes, en el ICI listo para firmar y en datos en línea para toda la red, cosas que el SISMED por sí solo no hace.

**Diferencia SISMED vs. Toolkit SISMED (frase sugerida):**
> El **SISMED** es el sistema oficial de DIGEMID/MINSA donde se registran los movimientos de medicamentos de cada establecimiento. El **ToolKit SISMED** no lo reemplaza: es un complemento que **lee** la información del SISMED para hacer reportes, el ICI, enviar el stock a la red y subir los backups a la nube. Todo lo oficial se sigue registrando en el SISMED.
> **[COMPLETAR]** si se agrega la marca OwoWeb: hoy el programa muestra «ToolKit SISMED» y «By: Ing. Jordan Chacon Villacis»; la palabra OwoWeb no aparece en el programa ni en la web.

**Qué hace que el SISMED no hace:**
- **ICI listo para firmar** (Excel y PDF), por farmacia y consolidado del establecimiento, leído directo de las tablas del SISMED. El Excel que exporta el SISMED pierde las recetas SIS e intercambia «Otros convenios» con «Crédito hospitalario»; el del Toolkit no. Además pone los vencidos (concepto 35) en la columna Vencidos y, en el consolidado, descuenta lo que se movieron entre farmacias del mismo establecimiento.
- **Stock en línea**: envía el stock de cada establecimiento a la red cada pocos minutos, para que la UNGET y los demás lo vean en la web.
- **Backups en la nube**: sube solo cada backup nuevo del SISMED, para que la UNGET lo descargue desde la web aunque la PC del establecimiento esté apagada.
- **Reportes en Excel**: disponibilidad, consumo valorizado, stock, guías y consulta del TFORMDET.
- **Análisis en la web**: disponibilidad y DME (ficha 28), requerimiento, redistribución, vencimientos y revisión de guías.

**Son dos piezas:**

| | Toolkit de escritorio | Toolkit web |
|---|---|---|
| Dónde está | Instalado en la PC de la farmacia o del almacén (Windows) | En el navegador: https://jchaconv94.github.io/ToolkitSISMED/ |
| Quién lo usa | Responsable de farmacia o técnico | UNGET, microred, establecimientos y administración, según su rol |
| Qué hace | Lee el SISMED, hace reportes y el ICI, envía el stock, sube backups | Consolida, analiza, consulta stock, genera claves, descarga backups |

## A2. Toolkit de escritorio: funciones

El menú está a la izquierda (el botón ☰ lo abre). **Inicio** muestra las 14 herramientas con un buscador.

| Sección | Herramienta | Para qué sirve |
|---|---|---|
| Farmacia | **Generar ICI** | ICI del mes en Excel y PDF, consolidado del establecimiento y/o uno por farmacia, con guías de ingreso, vencimientos, recetas diarias y control de recetas |
| Farmacia | **Disponibilidad TFORMDET** | Excel de consumo mensual por farmacia, por establecimiento (IPRESS) o por red, con stock y precio |
| Farmacia | **Anexar TFORMDET** | Agrega a un SISMED los meses de otro TFORMDET que le faltan, sin repetir establecimiento y mes |
| Reports SISMED | **Consul. TFORMDET** | Descarga el TFORMDET de un mes, un rango o los últimos meses en Excel. **Es el archivo que se sube a Disponibilidad en la web** |
| Reports SISMED | **Reporte Guías** | Guías de salida o de ingreso de un rango de fechas, detalladas por lote o valorizadas |
| Reports SISMED | **Stock SISMED** | Stock general (por producto) y detallado (por lote), consolidado o por farmacia |
| Reports SISMED | **Consumo Valorizado** | Consumo en soles por mes y establecimiento: SIS, Intervención Sanitaria y Venta |
| Edit SISMED | **Cambiar Estado Med.** | Cambia el estado de un producto (Estratégico, Soporte u Otros) en el SISMED |
| Edit SISMED | **Habilitar Guías** | Habilita o anula una guía, le quita el bloqueo para editarla en el SISMED o cambia su modo de ingreso (automático o manual) |
| Herramientas | **DBF a EXCEL** | Convierte cualquier tabla .dbf a Excel |
| Herramientas | **Unir EXCEL** | Une varios Excel con las mismas columnas |
| Herramientas | **Format TFORMDET** | Da formato al Excel del TFORMDET que exporta el SISMED |
| Herramientas | **Editor PDF** | Ordenar, unir y dividir PDF; PDF a Word, Excel o JPG |
| Sync SISMED | **Sync SISMED** | Envía el stock a la red cada 5 a 60 minutos y sube los backups del SISMED a la nube |
| Configuración | **Ajustes del Sistema** | Abrir con Windows, actualizaciones automáticas, log de diagnóstico |

**Importante:**
- **Cambiar Estado Med.** y **Habilitar Guías** escriben directo en el SISMED y **no sacan copia antes**: sacar antes una copia de la carpeta del SISMED.
- **Backups SISMED no es una pantalla aparte**: funciona dentro de Sync SISMED, mientras está encendido.
- El Toolkit de escritorio **no tiene** «Consolidar ICI» aparte (es una casilla de Generar ICI), ni el formato ICI para puestos comunales, ni el IME: están pendientes.

## A3. Toolkit web: módulos

Dirección: **https://jchaconv94.github.io/ToolkitSISMED/** (funciona en PC y celular; se puede instalar como app desde el menú del usuario → «Instalar app»).

| Sección | Módulo | Para qué sirve | Sin internet |
|---|---|---|---|
| Farmacia | **Análisis de Requerimiento** | Requerimiento por establecimiento a partir del archivo de consumos | Sí |
| Farmacia | **Lista de Exclusiones** | Medicamentos que no entran en el análisis | No |
| Farmacia | **Disponibilidad** | Disponibilidad de productos y DME (ficha 28) por establecimiento, microred y UNGET; historial mes a mes; vencimientos, consumos irregulares, ABC, sobrestock, redistribución, almacén; Excel | Sí (el historial necesita internet para guardar) |
| Farmacia | **Revisión de guías** | Compara lo que el almacén envió con guía con lo que cada establecimiento ingresó en su ICI | Sí |
| Farmacia | **Redistribución** | Canjes entre establecimientos | Sí |
| Stock | **Consulta Stock** | Stock de toda la red (de lo que envía Sync SISMED), con vencimientos de la red | No |
| Stock | **Stock SISMED** | Stock del propio establecimiento | No |
| Stock | **Columnas de Stock** | Qué columnas ve cada establecimiento | No |
| Herramientas | **Backups SISMED** | Descargar con un clic el backup del SISMED de cada establecimiento | No |
| Herramientas | **Claves de envío** | Clave por establecimiento para que solo su PC envíe el stock; versión del Toolkit y del SISMED de cada PC | No |
| Administración | Usuarios, Roles, Establecimientos, Regímenes y Profesiones, Parámetros | Solo para administradores | No |

- **Cada usuario ve solo lo de su jurisdicción** (DIRESA, OGESS, UNGET, microred o establecimiento) y solo los módulos que su rol tiene habilitados.
- **Campanita** (arriba): avisa lotes vencidos, lotes por vencer (90 días por omisión), hojas sin actualizar (3 días por omisión), intentos de envío bloqueados y Toolkit o SISMED desactualizados, según el rol.

## A4. Requisitos

**Toolkit de escritorio**
- Windows **10 u 11 de 64 bits**.
- Permiso de **administrador para instalar** (se instala en Archivos de programa).
- No necesita Python, Visual FoxPro, ODBC ni Excel (el PDF del ICI lo hace el propio Toolkit).
- SISMED V2 instalado en la PC. La carpeta por omisión es **C:\SISMEDV2** (la carpeta principal, la que contiene DATOS). No hay una versión mínima de SISMED declarada.
- **Internet**: solo para Sync SISMED, backups y actualizaciones. Los reportes y el ICI funcionan sin internet.
- **¿Hay que cerrar el SISMED?**
  - Reportes, ICI y Sync: **no** (leen una copia de las tablas).
  - **Anexar TFORMDET: sí**, cerrar SISMED, FoxPro y Excel.
  - Cambiar Estado Med. y Habilitar Guías: conviene cerrarlo; escriben directo en el SISMED.

**Toolkit web**
- Navegador actual (Chrome o Edge recomendados). En el celular funciona, pero **Revisión de guías** solo abre carpetas en Chrome o Edge de PC; en otros navegadores hay que subir los archivos.
- Usuario y contraseña dados por el administrador.

## A5. Instalación, activación y actualización

**Descarga:** https://github.com/jchaconv94/ToolkitSISMED/releases/latest → archivo **ToolkitOGM-Setup-<versión>.exe** (unos 106 MB). Es gratuito.

**Instalar:**
1. Ejecutar el instalador como administrador y seguir el asistente (no pide carpeta).
2. Queda en el menú Inicio como «ToolKit SISMED».
3. Al abrir, elegir en cada herramienta la carpeta del SISMED (por omisión C:\SISMEDV2).

**Licencia:** no tiene licencia ni activación. Es software libre (AGPL-3.0), sin publicidad. El único control es la **clave de envío** para enviar stock y backups.

**Configurar el envío de stock y backups (Sync SISMED):**
1. Entrar a **Sync SISMED**. La primera vez pide **crear una contraseña** (mínimo 4 caracteres). Vale solo para esa PC. **No se puede recuperar desde el programa**: si se olvida, contactar al soporte.
2. **Directorio SISMED**: la carpeta principal del SISMED.
3. **URL de Integración**: la dirección de la hoja de la red; la entrega el informático SISMED de la UNGET. **[COMPLETAR: quién la entrega en cada UNGET]**
4. **Clave de envío**: la genera el informático SISMED en la web → Claves de envío. Tiene la forma `<código>-XXXX-XXXX-XXXX`.
5. Intervalo (5 minutos por omisión), marcar «Iniciar Sincronización al encender la app» y pulsar **INICIAR**.
6. En **Configuración**, marcar **«Abrir esta aplicación al encender Windows»** (viene apagada).

**Cómo queda trabajando:** la X de la ventana **no cierra** el programa: lo esconde junto al reloj (ícono cian «OGM») y el envío sigue. Para cerrarlo de verdad: clic derecho en el ícono → **Cerrar completamente** (detiene el envío).

**Clave de envío y cambio de PC:**
- En el primer envío aceptado, esa PC queda **vinculada** al establecimiento. Otra PC, aunque tenga la misma clave, queda bloqueada y no cambia el stock.
- Si se cambia de PC o se formatea, el informático aprueba el cambio en la web → Claves de envío → **«Cambiar a este equipo»**. Si el intento no es un cambio de PC real (por ejemplo, otra PC con una copia del SISMED), debe elegir **«Ignorar»**.
- Sin clave registrada en la web, el establecimiento envía como siempre.

**Actualizaciones (automáticas):**
- Busca al abrir y cada 12 horas.
- Las actualizaciones chicas (menos de 1 MB) se instalan solas, sin pedir permiso: al abrir el programa o con un reinicio silencioso cuando lleva 20 minutos escondido sin trabajar. Al abrir avisa «ToolKit SISMED se actualizó a la versión X».
- Si hace falta el instalador completo, muestra «Actualización lista» con **INSTALAR AHORA** y Windows pide permiso.
- Si una actualización falla, vuelve sola a la versión anterior.
- Versión mínima recomendada: **2.4.4** para que los backups suban solos; **2.4.5 o más** para evitar que Windows Defender lo borre. La última es la **2.4.7**. La web marca en ámbar «actualizar» las PC con versión vieja.

**Windows Defender:**
- Versiones antiguas (hasta la 2.3.18) eran borradas por Defender («Persistence.A!ml») y parecía que el Toolkit «se desinstaló solo». Se corrigió en la 2.4.0 y la 2.4.5.
- Si el programa desapareció: **descargar e instalar la última versión** desde la página de descargas. Si vuelve a pasar con la última versión, avisar al soporte con captura del aviso de Defender.
- El instalador no tiene firma digital todavía; Windows puede mostrar un aviso de editor desconocido. **[COMPLETAR: qué indicar al usuario en ese caso]**

**Toolkit web:**
- Entrar con usuario y contraseña. La casilla **«Mantener sesión iniciada»** (viene marcada) deja la sesión abierta y permite abrir la web **sin internet hasta 45 días** desde la última vez con internet.
- **Acceso rápido**: PIN en la PC o huella en el celular, se activa en **Perfil**. Cinco PIN equivocados bloquean ese equipo. Cambiar la contraseña desactiva todos los equipos.
- Las cuentas las crea el administrador. **[COMPLETAR: a quién pedir una cuenta]**

## A6. Cómo se usa (pasos cortos)

**Generar ICI** (escritorio, Farmacia)
1. Elegir la carpeta del SISMED.
2. Año y mes (por omisión, el mes que ya cerró). **El mes tiene que estar procesado en el SISMED.**
3. Marcar «Consolidado del establecimiento» (marcado) y/o «Un ICI por cada farmacia».
4. **GENERAR ICI**, elegir dónde guardar. Salen el Excel y el PDF (con declaración jurada y firmas). **Abrir carpeta** al terminar.

**Consulta TFORMDET para Disponibilidad** (escritorio, Reports SISMED → Consul. TFORMDET)
1. Elegir la carpeta del SISMED del establecimiento o de la UNGET.
2. Periodo: **Últimos meses → 12** (el mes en curso solo si se marca «Incluir el mes actual»).
3. **CONSULTAR Y DESCARGAR EXCEL**.
4. En la web → Disponibilidad, subir ese Excel. Necesita Toolkit 2.2.5 o más para que salga la DME (medicamentos esenciales).

**Disponibilidad TFORMDET** (escritorio, Farmacia)
1. Carpeta del SISMED, meses de consumo (12), último periodo.
2. Tipo: Por Farmacias, Por IPRESS o Por Red.
3. Opcional: lista de códigos a excluir o incluir (un código de IPRESS, por ejemplo 06502, incluye a todas sus farmacias).
4. **GENERAR REPORTE EXCEL**.

**Anexar TFORMDET** (escritorio, Farmacia)
1. **Cerrar SISMED, FoxPro y Excel.**
2. Buscar el archivo TFORMDET de origen.
3. Buscar la carpeta principal del SISMED destino (debe decir «TFORMDET detectado»).
4. **PROCESAR** (analiza) y **PROCESAR** otra vez para agregar. Antes de escribir guarda una copia del TFORMDET destino en `%APPDATA%\ToolkitOGM\backups\tformdet_append`.

**Reporte Guías** (escritorio)
1. Fecha inicio y fin (DD/MM/AAAA).
2. Guías de salida o de ingreso; detallado por lotes o valorizado; «Omitir guías anuladas».
3. **GENERAR REPORTE EN EXCEL**.

**Habilitar Guías** (escritorio, Edit SISMED; sacar copia del SISMED antes)
1. Carpeta del SISMED; buscar por N° de guía o N° de movimiento (uno o una lista).
2. Marcar las guías y elegir: **Cambiar situación** (habilitar o anular), **Quitar bloqueo** (para volver a editarla en el SISMED) o **Cambiar modo de ingreso** (A automático / M manual).
3. Confirmar.

**Backups del SISMED**
- En la PC: no hay que hacer nada si Sync SISMED está encendido, con clave de envío y el establecimiento habilitado en la web. Sube cada backup nuevo que genera el SISMED (el SISMED los hace al primer ingreso del día y a las 13:00).
- En la web → **Backups SISMED** → **Descargar**: baja la última copia en la nube aunque la PC esté apagada. «Descargar todos» baja los de varios establecimientos. El archivo se guarda con el nombre del establecimiento adelante.

**Revisión de guías** (web, la usa la UNGET)
1. Elegir la carpeta DATOS del SISMED del almacén y la del SISMED donde se importan los ICI (Chrome o Edge), o subir los archivos: del almacén TMOVIM.DBF y TMOVIMDET.DBF (MALMACEN y MPRODUCTO opcionales); del ICI, TFORMDET.DBF.
2. Elegir el mes. Cada establecimiento sale con sus productos: **Completo, Incompleto, No ingresó, Sobra o Sin guía**.
3. Abrir un establecimiento para ver el detalle, sus guías (detalladas por lote o por guía, con referencia y total) y poner observaciones. Excel por establecimiento o de todos.

**Consulta Stock / Stock SISMED** (web): muestra el stock que envió Sync SISMED. Si un establecimiento no aparece actualizado, su PC no está enviando (ver A7).

## A7. Errores comunes y qué hacer

**Sync SISMED (envío de stock)**

| Mensaje o problema | Qué hacer |
|---|---|
| «Envío bloqueado por la clave de envío… esta PC no tiene configurada la clave de envío» | Pedir la clave al informático SISMED (web → Claves de envío) y pegarla en Sync SISMED |
| «…la clave de envío no es la vigente» | La clave cambió o está mal copiada: pedir la clave vigente |
| «…el establecimiento está vinculado a otra PC» | Si se cambió de PC, el informático aprueba «Cambiar a este equipo» en la web. Si esta PC no debería enviar, no hacer nada |
| «…no se pudo consultar la clave en la web y esta PC no es la última aprobada» | Revisar internet; se reintenta solo |
| «La red de este establecimiento desvía script.google.com…» | Es la red (por ejemplo PRONATEL). El Toolkit envía solo por el camino de respaldo **si tiene clave de envío** |
| «El camino de respaldo solo funciona con clave de envío» | Configurar la clave de envío |
| «No se pudo enviar el stock por ningún camino» | Sin internet o todo bloqueado; revisar la conexión, se reintenta solo |
| «Error TLS/SSL… fecha/hora del equipo» | Corregir la fecha y hora de la PC; revisar antivirus o proxy |
| «El archivo está bloqueado por SISMED u otro proceso» | Normal si el SISMED está guardando; se reintenta en el siguiente ciclo |
| «Se abortó la sincronización por calidad insuficiente…» | Tablas del SISMED dañadas: avisar al informático SISMED |
| «…falta la URL de integración» / «la URL no es válida» | Pedir la URL al informático de la UNGET y pegarla (candado) |
| «…el directorio SISMED no existe» / «falta la carpeta DATOS» / «faltan MMEDICAM.DBF, MSTKALMDE.DBF» | Elegir la carpeta principal del SISMED (la que contiene DATOS), no la carpeta DATOS |
| Olvidé la contraseña de Sync SISMED | No se puede recuperar desde el programa: contactar al soporte |

**Backups SISMED**

| Mensaje o problema | Qué hacer |
|---|---|
| «La web todavía no habilita esta PC…» | Falta clave de envío o la PC no está vinculada; se reintenta cada 30 minutos |
| «No se pudo conectar con el servicio de backups… la red puede estar bloqueando sismed-conexion.jchaconvillacis.workers.dev» | Pedir al área de informática que permita esa dirección |
| «No hay backups del SISMED en la carpeta backup de esta PC» | El SISMED todavía no generó su backup, o el Directorio SISMED está mal |
| La copia en la nube no se actualiza | Actualizar el Toolkit a la 2.4.4 o más (las versiones 2.3.10 a 2.4.3 no subían backups con contraseña) |
| «El backup cambió mientras se enviaba» / «La parte N no se pudo enviar» | Volver a pedirlo desde la web |

**ICI y reportes**

| Mensaje | Qué hacer |
|---|---|
| «El SISMED no tiene el ICI de <mes> procesado (TFORMDET vacío)» | Procesar el ICI de ese mes en el SISMED y volver a intentar |
| «No se encontró TFORMDET.DBF en la carpeta DATOS» | Elegir la carpeta principal del SISMED correcta |
| «N lotes no cuadran (saldo + entradas − salidas ≠ stock final)» | Aviso sobre los datos del SISMED: revisar esos lotes en el SISMED |
| «ALTO: No se tiene información de ese(os) periodo(s)» | Al SISMED le faltan esos meses: ajustar el rango |
| «Archivo en uso. Ciérralo primero» / «¿está abierto en Excel?» | Cerrar el archivo en Excel y repetir |
| «Cierre SISMED o FoxPro y vuelva a intentar» (Anexar TFORMDET) | Cerrar SISMED, FoxPro y Excel |
| «Sin datos nuevos» (Anexar TFORMDET) | Ese establecimiento y mes ya estaban cargados |

**Instalación y programa**

| Problema | Qué hacer |
|---|---|
| «ToolKit SISMED ya se está ejecutando…» | Está abierto junto al reloj (ícono OGM). Si no responde, cerrar «ToolkitOGM» desde el Administrador de tareas |
| «Falta el acceso de la carpeta Inicio de Windows» | Volver a instalar el Toolkit |
| El programa desapareció | Windows Defender (versiones viejas): instalar la última versión |
| «La actualización no pudo completarse… restauró la versión anterior» | Sigue funcionando; reintenta después. Si se repite, avisar al soporte |
| «No hay espacio suficiente para proteger la instalación…» | Liberar espacio en el disco |

**Web**

| Problema | Qué hacer |
|---|---|
| «Suba la consulta TFORMDET del Toolkit de escritorio» / «no trae la columna ANNOMES» | Descargar el TFORMDET con la Consulta TFORMDET del Toolkit, con varios meses (Últimos meses → 12) |
| Aviso de menos de 12 meses en Disponibilidad | Se puede calcular igual; para el historial se necesitan 12 meses |
| No sale «Medicamentos esenciales» | El TFORMDET se descargó con un Toolkit anterior a la 2.2.5: actualizar y volver a descargar |
| Revisión de guías: «El navegador pide permiso para volver a leer la carpeta» | Tocar «Leer el SISMED» y dar permiso |
| «Acceso denegado: el archivo cargado pertenece a…» (Análisis) | Un establecimiento solo puede procesar su propio archivo |
| «Su sesión venció» | Volver a entrar con usuario y contraseña |
| Un módulo dice «Necesita internet» | Ese módulo trabaja con datos en línea; los que funcionan sin internet son Análisis, Disponibilidad, Revisión de guías y Redistribución |

## A8. Precio, soporte y contacto

- **Gratuito** y de código abierto (AGPL-3.0). Sin licencias, sin publicidad, sin recolección de datos de uso.
- Lo desarrolla el **Ing. Jordan Chacón Villacís** para la **DIRESA San Martín**, para las farmacias y almacenes que trabajan con el SISMED.
- Soporte de claves de envío, cuentas y backups: el **informático SISMED de cada UNGET**.
- **[COMPLETAR]** teléfono, WhatsApp o correo de soporte y horario de atención. Hoy el programa no muestra ningún contacto.

---

# PARTE B. SISMED

> El SISMED es el sistema oficial de DIGEMID/MINSA, instalado en cada establecimiento sobre tablas FoxPro (carpeta DATOS, normalmente C:\SISMEDV2\DATOS). Este documento explica los conceptos y las reglas; **los pasos dentro de los menús del SISMED** (cómo procesar el ICI, cerrar el mes, ingresar una guía, actualizar el catálogo o restaurar un backup) deben salir de los manuales oficiales o de la red. **[COMPLETAR con esos manuales]**

## B1. Procesos que más se preguntan

**ICI (Informe de Consumo Integrado)**
- Es el informe mensual de cada farmacia, por producto y lote: saldo del mes anterior, ingresos, consumos (venta, SIS, intervención sanitaria, exoneración, SOAT, crédito hospitalario, otros convenios…), otras salidas (devolución, vencidos, merma, regularización…) y saldo final.
- Se hace del **mes que ya cerró**. El SISMED lo guarda al procesarlo en la tabla **TFORMDET** (detalle) y **TFORMATO** (recetas). Si el TFORMDET del mes está vacío, el ICI no se procesó.
- Regla que siempre se cumple: **saldo final = saldo anterior + ingresos + reingresos + ingresos por regularización − total de salidas**. El Excel del SISMED no muestra los reingresos, por eso a veces el stock «no cuadra a la vista».
- El establecimiento envía su ICI y la UNGET lo importa en su SISMED.
- **Consolidado del establecimiento**: suma la F01 y sus farmacias o puestos comunales. El Toolkit descuenta lo que se entregaron entre ellos, para no contarlo dos veces.

**Ingreso de medicamentos por guía**
- El almacén de la UNGET entrega con **Guía de Remisión** (concepto 04, Distribución); en el establecimiento entra como **Ingreso**. Si el establecimiento tiene varias farmacias, el almacén entrega a la F01.
- Para revisar que ingresó lo mismo que salió, la UNGET usa **Revisión de guías** en la web: Completo, Incompleto, No ingresó, Sobra (ingresó más) o Sin guía (ingreso sin guía del almacén; muchas veces una guía de fin de mes ingresada al mes siguiente).
- Observaciones frecuentes: corrección de lote, ajuste de inventario, inventario, para venta.

**Stock y vencimientos**
- El stock que se ve en la web es el que envía Sync SISMED desde la PC de cada establecimiento. Los lotes con saldo 0 no se envían.
- El SISMED descarga primero el lote que vence primero (FEFO). Si físicamente se entrega otro lote, eso no queda en el sistema.
- En el ICI del SISMED, en las farmacias, la devolución de vencidos (concepto 35) sale como Devolución; en el ICI del Toolkit sale como Vencidos.

**Consumo: qué cuenta y qué no**
- **Cuenta como consumo**: Venta + SIS + Intervención sanitaria + Exoneración + SOAT + Crédito hospitalario + Otros convenios.
- **No es consumo**: reingresos, devoluciones, distribución, transferencias, vencidos, merma, otras salidas (en una F01 con puestos, es lo que entrega a sus puestos), defensa nacional y venta institucional.

**Disponibilidad y DME (ficha 28)**
- **CPA** = consumo de 12 meses ÷ meses con consumo (los meses en cero no cuentan). **Meses de stock** = stock ÷ CPA.
- **Situaciones**: Desabastecido (stock 0) · Sin rotación (hay stock y no hay consumo) · Substock (menos de 2 meses) · Normostock (de 2 a 6) · Sobrestock (más de 6).
- **Disponibilidad** = (Normostock + Sobrestock) ÷ total de productos. Niveles: Óptimo ≥ 90 %, Alto ≥ 80 %, Regular ≥ 70 %, Bajo < 70 %.
- **DME (medicamentos esenciales)**: medicamentos del petitorio o del listado de códigos fusionados de DIGEMID, que no son de estrategia. De los sin rotación solo cuentan los **114 vitales** (RM 1288-2018-MINSA); las soluciones de 1 litro o más son Normostock desde 1 mes; hay 15 medicamentos que el tablero nacional no evalúa.
- Los centros de salud mental comunitario (C.S.M.C.) van fuera del análisis por omisión.

**Cierre del mes y fecha de corte**
- El saldo final del TFORMDET es el stock al **último día** del mes.
- A fin de mes algunos adelantan la fecha de la PC para cerrar y luego la regresan. El Toolkit lo tiene en cuenta para los backups, pero **la PC debe quedar con la fecha correcta**.

**Backups del SISMED**
- El SISMED genera solo su backup (archivo BKDA…zip, con contraseña) en la carpeta backup del SISMED, al primer ingreso del día y a las 13:00.
- El Toolkit sube cada backup nuevo a la nube; la UNGET lo descarga desde la web. **[COMPLETAR: pasos para restaurar un backup, según el manual de gestión de backups]**

**Versión del SISMED**
- Está en la tabla de configuración del SISMED. La web la muestra por PC en Claves de envío y toma como vigente la más alta que reporta alguna PC. **[COMPLETAR: cómo se actualiza el SISMED]**

**Anexar TFORMDET**: ver A6. Sirve para agregar a un SISMED los meses de TFORMDET que le faltan, desde otro archivo TFORMDET. **[COMPLETAR: en qué casos se usa, según su manual]**

**Actualizar catálogo**: **[COMPLETAR según su manual]**. El Toolkit solo permite cambiar el estado (Estratégico, Soporte u Otros) de un producto con «Cambiar Estado Med.».

**IME (Informe de Movimiento Económico, Anexo N° 06)**: registro de ventas, depósitos T6 y saldos del 90 % y del 10 %. Hoy se hace en el libro INFOSISMED; **está en preparación en la web**.

## B2. Problemas frecuentes del SISMED

| Problema | Causa | Qué hacer |
|---|---|---|
| Stock de otro establecimiento en el SISMED (por ejemplo, se abrió un inventario del almacén en la PC de un puesto) | Se trabajó en el SISMED equivocado | La clave de envío lo bloquea; el informático debe elegir «Ignorar» en la web, nunca «Cambiar a este equipo». Corregir el SISMED de ese establecimiento **[COMPLETAR cómo]** |
| Una copia vieja o de prueba del SISMED envía stock | Otra PC con una copia | La clave de envío deja enviar solo a la PC vinculada |
| Archivo en uso / bloqueado | El SISMED, FoxPro o Excel tienen abierta la tabla | Cerrar esos programas y repetir |
| Tablas dañadas | Corte de luz, cierre brusco **[COMPLETAR]** | Avisar al informático SISMED; Sync deja de enviar para no subir datos malos |
| Guía anulada o bloqueada que hay que corregir | Situación o bloqueo de la guía | «Habilitar Guías» del Toolkit (sacar copia antes) |
| N° de guía escrito de distintas formas | Se digita a mano | El Toolkit compara sin ceros ni serie |
| Vencidos que salen como Devolución en el ICI del SISMED | Así lo procesa el SISMED en farmacias | El ICI del Toolkit los pone en Vencidos |
| El Excel del ICI no muestra las recetas SIS | Error del Excel del SISMED | Usar el ICI del Toolkit (las toma de TFORMATO) |
| Farmacia F02 o más sin tipo en el registro | No se registró si es puesto comunal o farmacia del hospital | Registrarla en la web → Establecimientos |
| **Error 2528** | **[COMPLETAR]** | **[COMPLETAR]** |
| **Problemas de permisos de usuario del SISMED** | **[COMPLETAR]** | **[COMPLETAR]** |
| **Problemas al cargar archivos en el SISMED** | **[COMPLETAR]** | **[COMPLETAR]** |

## B3. Glosario

| Término | Qué es |
|---|---|
| **SISMED** | Sistema Integrado de Suministro de Medicamentos e Insumos Médico-Quirúrgicos (DIGEMID/MINSA) |
| **DIRESA** | Dirección Regional de Salud (San Martín) |
| **OGESS** | Nivel entre la DIRESA y las UNGET |
| **UNGET** | Unidad de Gestión Territorial: tiene su almacén, su hoja de stock y su informático SISMED |
| **Microred** | Grupo de establecimientos dentro de una UNGET |
| **IPRESS** | Establecimiento de salud (código de 5 dígitos) |
| **F01, F02…** | Farmacias de un establecimiento: F01 la principal; F02 en adelante, puesto comunal o farmacia del hospital |
| **Puesto comunal** | Farmacia aparte de un establecimiento, con su propio stock, que recibe de su F01 |
| **Almacén** | Código con letras (por ejemplo 030S05); no tiene ICI |
| **ICI** | Informe de Consumo Integrado, mensual, por farmacia y lote |
| **TFORMDET** | Tabla del SISMED con el detalle del ICI por farmacia, mes, producto y lote |
| **Consulta TFORMDET** | Excel del TFORMDET que descarga el Toolkit; se sube a Disponibilidad |
| **Guía** | Documento del movimiento: guía de remisión (lo que entrega el almacén) o de devolución |
| **Concepto** | Motivo del movimiento: 04 distribución, 05 riesgo de vencimiento, 06 deterioro, 07 devolución por sobrestock, 21 ajuste de inventario, 35 devolución de vencido… |
| **CPA** | Consumo promedio mensual: consumo de 12 meses ÷ meses con consumo |
| **DME** | Disponibilidad de Medicamentos Esenciales (ficha 28) |
| **Petitorio** | Lista oficial de medicamentos (PNUME) |
| **Fusionados** | Listado de DIGEMID que agrupa presentaciones de un mismo medicamento en un código |
| **Vitales** | 114 medicamentos de la RM 1288-2018-MINSA |
| **Clave de envío** | Clave por establecimiento, generada en la web, para que solo su PC envíe el stock |
| **IME** | Informe de Movimiento Económico (Anexo N° 06) |
| **T6** | Papeleta de depósito de la venta registrada en el IME |

## B4. Manuales

Ya tiene: gestión de backups, anexar TFORMDET y actualizar catálogo. Conviene sumar (aunque sean de una página):
1. Instalar el Toolkit y configurar Sync SISMED (con clave de envío).
2. Generar el ICI del mes con el Toolkit.
3. Descargar la Consulta TFORMDET y subirla a Disponibilidad.
4. Qué hacer si Windows Defender borra el Toolkit.
5. Cambio de PC: cómo aprobarlo en Claves de envío.
6. Habilitar o desbloquear una guía con el Toolkit (con copia previa).
7. Procesar el ICI y cerrar el mes en el SISMED (pasos del SISMED).
8. Entrar a la web: cuenta, mantener sesión, PIN o huella.

---

# PARTE C. Preguntas frecuentes listas para cargar

1. **¿Qué es el ToolKit SISMED?** Un complemento gratuito del SISMED que lee sus datos para hacer el ICI, reportes en Excel, enviar el stock a la red y subir los backups a la nube. No reemplaza al SISMED.
2. **¿Es lo mismo que el SISMED?** No. El SISMED es el sistema oficial de DIGEMID/MINSA donde se registra todo. El Toolkit solo lee esa información y la presenta.
3. **¿Cuánto cuesta?** Es gratuito, sin licencias ni activación.
4. **¿Dónde lo descargo?** En https://github.com/jchaconv94/ToolkitSISMED/releases/latest, el archivo ToolkitOGM-Setup-<versión>.exe.
5. **¿Qué necesita mi PC?** Windows 10 u 11 de 64 bits, el SISMED instalado y permiso de administrador para instalar.
6. **¿Necesito cerrar el SISMED para usar el Toolkit?** Para los reportes, el ICI y el envío de stock, no. Para Anexar TFORMDET, sí (y también FoxPro y Excel).
7. **¿Cuál es la última versión?** La 2.4.7. Se actualiza sola.
8. **¿Cómo sé qué versión tengo?** En el título de la ventana: «ToolKit SISMED (v2.4.7)».
9. **El Toolkit desapareció de mi PC.** Windows Defender borraba versiones antiguas. Instale la última versión desde la página de descargas; si vuelve a pasar, avise a soporte.
10. **¿Cómo genero el ICI?** Farmacia → Generar ICI → carpeta del SISMED → año y mes → «Consolidado» y/o «Un ICI por cada farmacia» → GENERAR ICI. Salen Excel y PDF.
11. **Dice que el ICI del mes no está procesado.** Procese primero el ICI de ese mes en el SISMED y vuelva a intentar.
12. **¿Por qué el ICI del Toolkit es distinto al del SISMED?** Porque lee directo de las tablas: recupera las recetas SIS que el Excel del SISMED pierde, corrige el cruce de «Otros convenios» y «Crédito hospitalario» y pone los vencidos en su columna.
13. **¿Qué archivo subo a Disponibilidad?** La Consulta TFORMDET del Toolkit (Reports SISMED → Consul. TFORMDET → Últimos meses 12).
14. **No me sale «Medicamentos esenciales».** El TFORMDET se descargó con un Toolkit anterior a la 2.2.5. Actualice y descárguelo de nuevo.
15. **¿Cómo envío mi stock a la red?** Sync SISMED: carpeta del SISMED, URL de integración, clave de envío, INICIAR. Déjelo con «Abrir esta aplicación al encender Windows».
16. **¿Dónde consigo la clave de envío?** Se la da el informático SISMED de su UNGET; la genera en la web → Claves de envío.
17. **Dice «el establecimiento está vinculado a otra PC».** Si cambió de PC, pida al informático que apruebe «Cambiar a este equipo» en la web.
18. **Olvidé la contraseña de Sync SISMED.** No se recupera desde el programa. Contacte al soporte.
19. **Si cierro la ventana, ¿deja de enviar?** No: la X lo esconde junto al reloj y sigue enviando. Para cerrarlo: clic derecho en el ícono OGM → Cerrar completamente.
20. **Mi stock no aparece actualizado en la web.** Revise que el Toolkit esté abierto (ícono OGM junto al reloj), con Sync SISMED iniciado y con internet. Mire la consola de Sync SISMED por mensajes de clave o de red.
21. **Mi red bloquea Google.** Desde la versión 2.3.2 el Toolkit envía por un camino de respaldo, siempre que tenga clave de envío.
22. **¿Cómo descargo el backup del SISMED de un establecimiento?** En la web → Backups SISMED → Descargar. Funciona aunque la PC esté apagada, si el Toolkit subió la copia.
23. **El backup en la nube está viejo.** Actualice el Toolkit de esa PC a la 2.4.4 o más y revise que Sync SISMED esté encendido con clave de envío.
24. **¿Cada cuánto hace backup el SISMED?** Al primer ingreso del día y a las 13:00.
25. **¿Cómo habilito una guía anulada o bloqueada?** Edit SISMED → Habilitar Guías: buscar la guía, marcarla y elegir Cambiar situación o Quitar bloqueo. Saque antes una copia de la carpeta del SISMED.
26. **¿Cómo cambio el estado de un producto (estratégico, soporte, otros)?** Edit SISMED → Cambiar Estado Med. Saque antes una copia del SISMED.
27. **¿Qué es el TFORMDET?** La tabla del SISMED con el detalle del ICI por farmacia, mes, producto y lote.
28. **¿Qué cuenta como consumo?** Venta, SIS, intervención sanitaria, exoneración, SOAT, crédito hospitalario y otros convenios. Devoluciones, vencidos, merma y otras salidas no son consumo.
29. **¿Cómo se calcula el CPA?** Consumo de 12 meses dividido entre los meses que tuvieron consumo.
30. **¿Qué es Substock, Normostock y Sobrestock?** Menos de 2 meses de stock, de 2 a 6 meses, y más de 6 meses. Desabastecido es stock 0; Sin rotación, stock sin consumo.
31. **¿Cómo se calcula la disponibilidad?** Normostock más Sobrestock dividido entre el total de productos evaluados.
32. **¿Qué es la DME?** La disponibilidad de medicamentos esenciales de la ficha 28: medicamentos del petitorio o fusionados; de los sin rotación solo cuentan los vitales.
33. **¿Cómo reviso si un establecimiento ingresó lo que le envió el almacén?** Web → Revisión de guías (la usa la UNGET).
34. **¿Qué significa «Sin guía» en la revisión?** Lo ingresó sin guía del almacén ese mes; muchas veces es una guía de fin de mes ingresada al mes siguiente.
35. **¿La web funciona sin internet?** Sí: Análisis de Requerimiento, Disponibilidad, Revisión de guías y Redistribución, hasta 45 días con «Mantener sesión iniciada».
36. **¿Puedo entrar con PIN o huella?** Sí: actívelo en Perfil (PIN en la PC, huella en el celular).
37. **¿Cómo pido una cuenta para la web?** **[COMPLETAR]**
38. **¿Quién me da soporte?** **[COMPLETAR contacto]**. Para claves de envío, backups y cuentas: el informático SISMED de su UNGET.
39. **¿Puedo instalar la web en el celular?** Sí: menú del usuario → Instalar app.
40. **¿Qué es el IME?** El Informe de Movimiento Económico (Anexo N° 06) con ventas, depósitos T6 y saldos del 90 % y del 10 %. Se está preparando en la web.

---

# PARTE D. Lo que falta completar

- Contacto de soporte (teléfono, WhatsApp, correo, horario).
- Quién entrega la URL de integración y cómo se pide una cuenta de la web.
- La marca OwoWeb: dónde se mostrará (hoy no está en el programa ni en la web).
- El error 2528, los problemas de permisos de usuario y de carga de archivos del SISMED: causa y solución.
- Pasos dentro del SISMED: procesar el ICI, cerrar el mes, ingresar una guía, actualizar el catálogo, restaurar un backup, actualizar el SISMED (de sus manuales).
- Qué decir si Windows muestra «editor desconocido» al instalar.
