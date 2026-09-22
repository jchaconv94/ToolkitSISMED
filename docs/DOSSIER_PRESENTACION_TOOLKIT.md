# ToolKit SISMED — Dossier de contexto para la presentación

> Documento de **contexto**, no de guion. Reúne qué es el proyecto, qué problema resuelve,
> cómo está construido y en qué estado se encuentra, para que pueda usarse como material
> base al armar una presentación.
>
> Fecha: 22/09/2026 · Autor del proyecto: Jordan Chacón Villacís · DIRESA San Martín (Perú)

---

## 1. En una frase

**ToolKit SISMED es un ecosistema de dos piezas que saca la información de medicamentos del
computador de cada farmacia y la pone, actualizada y comparable, en manos de quien decide:**
una aplicación de escritorio que lee el SISMED instalado en cada establecimiento y la
publica, y una aplicación web que la consolida, la analiza y la convierte en decisiones de
abastecimiento para toda la región.

| | Toolkit SISMED **Desktop** (Toolkit OGM) | Toolkit SISMED **Web** |
|---|---|---|
| Dónde vive | PC de cada IPRESS / almacén | Navegador, publicado en GitHub Pages |
| Quién lo usa | Químico farmacéutico o técnico de la farmacia | UNGET, OGESS, DIRESA, IPRESS, Administración |
| Qué hace | Extrae, corrige, reporta y **sincroniza** | Consolida, analiza, distribuye y **controla** |
| Tecnología | Python 3.13 + Flet, empaquetado `.exe` | React 19 + Vite 6 + TypeScript + Supabase |
| Versión | 2.0.11 | en producción, despliegue continuo |

---

## 2. El problema que resuelve

El **SISMED** es el sistema oficial de medicamentos del Ministerio de Salud del Perú. En la
práctica funciona así:

- Está **instalado localmente** en cada establecimiento, sobre archivos **DBF** (FoxPro),
  normalmente en `C:\SISMEDV2`.
- **No se comunica con nada.** Cada IPRESS es una isla de datos.
- Para saber qué stock hay en la región, alguien tiene que **pedir por teléfono o correo**
  un Excel a cada establecimiento, esperar, y consolidarlo a mano.

Las consecuencias, todos los meses:

1. **Información vieja.** Cuando el consolidado está listo, ya no describe la realidad.
2. **Desabastecimiento invisible.** Un puesto se queda sin un medicamento que sobra en el
   centro de salud de al lado, y nadie lo sabe a tiempo.
3. **Vencimientos que se pierden.** Los lotes caducan en el almacén donde no se usan, en vez
   de moverse a donde sí se consumen.
4. **Horas de trabajo manual.** Consolidar Excel, cuadrar códigos, armar el reporte mensual.
5. **Sin trazabilidad.** No hay registro auditable de quién movió qué, cuándo y por qué.

**ToolKit SISMED ataca exactamente eso: cerrar la distancia entre el dato que ya existe en
cada PC y la decisión que hay que tomar en la región.**

---

## 3. Cómo funciona el ecosistema (flujo de datos)

```
   PC de la IPRESS                    Nube                        Quien decide
┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────┐
│  SISMED (.DBF local) │   │  Supabase (PostgreSQL)   │   │  Web: DIRESA / OGESS │
│          ↓           │   │   · stock_actual         │   │       UNGET / IPRESS │
│  TOOLKIT DESKTOP     │──▶│   · Edge Function        │──▶│                      │
│  lee, valida, envía  │   │     sync-stock           │   │  Consulta, análisis, │
│  cada N minutos      │   │   · auditoría de envíos  │   │  redistribución,     │
└──────────────────────┘   └──────────────────────────┘   │  reportes, cierre    │
          │                                                └──────────────────────┘
          │  ruta alternativa (heredada, aún viva)                    ▲
          └───────▶  Google Sheets  ──▶  Google Apps Script  ─────────┘
```

**Dos caminos, a propósito.** El camino nuevo va directo a Supabase. El camino heredado pasa
por una hoja de Google que cada UNGET administra. Conviven porque no todas las UNGET migran
al mismo tiempo: la web lee del que tenga datos, sin que el usuario tenga que saber cuál es.

---

## 4. Toolkit SISMED Desktop (Toolkit OGM)

Aplicación de escritorio para **Windows**, escrita en **Python 3.13** con **Flet**, que se
instala como `.exe` (PyInstaller + Inno Setup) y vive en la bandeja del sistema.

### 4.1 Qué hace

Se organiza en cuatro familias de herramientas:

**a) Sincronización — el corazón del proyecto**

| Herramienta | Qué hace |
|---|---|
| **Sync SISMED 2.0** | Envía el stock leído de los DBF **directo a Supabase** mediante una Edge Function, autenticado con un *token de instalación* propio de esa máquina. |
| **Sync SISMED** | Versión heredada: publica el stock en la hoja de Google de su UNGET, en tiempo real. |

Características de la sincronización:
- **Automática y desatendida**: intervalo configurable (por defecto cada 5 minutos), arranque
  con Windows opcional, ejecución minimizada en la bandeja.
- **Instancia única**: no se puede abrir dos veces y duplicar envíos.
- **Modo consolidado o detallado**: todo en la farmacia principal, o separado por cada
  farmacia y puesto comunal de la IPRESS.
- **Lista blanca de almacenes**: el servidor verifica que la máquina solo pueda reportar el
  stock de los `ALMCOD` que tiene autorizados. Una IPRESS no puede pisar el stock de otra.
- **Reemplazo completo**: cada envío sustituye el inventario de sus almacenes, así que el
  stock en la nube es un espejo, no una acumulación de parches.
- **Auditoría**: cada envío queda registrado con máquina, versión, número de registros y
  fecha del equipo.

**b) Reportes SISMED** (salida a Excel)

- **Stock SISMED** — stock general y detallado por lote.
- **Disponibilidad TFORMDET** — consumos y stock, en tabla dinámica.
- **Consumo Valorizado** — pivot valorizado por establecimiento, separando SIS, intervención
  sanitaria y venta.
- **Consulta TFORMDET** — consulta detallada de movimientos.
- **Reporte de Guías** — guías SISMED por fecha e ítem.

**c) Edición asistida del SISMED** (lo que el sistema oficial no deja hacer)

- **Cambiar Estado de Medicamento** — modifica `MEDEST` en `MMEDICAM.DBF` de forma segura.
- **Habilitar Guías** — reabre guías anuladas, quita bloqueos y cambia el modo de ingreso en
  `TMOVIM.DBF`.

> Estas dos herramientas resuelven bloqueos operativos reales que, sin el Toolkit, obligaban
> a llamar a soporte o a reingresar información a mano.

**d) Utilidades**

- **DBF a Excel** — conversión optimizada.
- **Unir Excel** — consolida varios archivos validando que las cabeceras sean compatibles.
- **Anexar / Formatear TFORMDET**.
- **Editor PDF** — reorganiza, elimina y convierte páginas.

### 4.2 Detalles que conviene mencionar

- Interfaz moderna con tema claro/oscuro, buscador de herramientas y tarjetas por categoría.
- Acceso al módulo de sincronización **protegido por contraseña** dentro de la propia app.
- Configuración y respaldo automático en `%APPDATA%\ToolkitOGM`.
- ~6 500 líneas de Python en la capa de herramientas, más el núcleo de la aplicación.

---

## 5. Toolkit SISMED Web

Aplicación de una sola página (**SPA**) en **React 19 + Vite 6 + TypeScript**, con **Supabase
(PostgreSQL)** como base de datos, desplegada en **GitHub Pages** con despliegue continuo.

Cubre **dos dominios** distintos.

### 5.1 Dominio Farmacia / SISMED

| Módulo | Para qué sirve |
|---|---|
| **Análisis de Requerimiento** | Vista principal: indicadores y análisis de qué necesita cada establecimiento. |
| **Análisis Inteligente** | Motor de análisis de requerimientos. |
| **Lista de Exclusiones** | Medicamentos que no deben entrar al análisis, por establecimiento. |
| **Consulta Stock** | Buscador de existencias de toda una UNGET: una tarjeta por establecimiento, con su estado de conexión, y **búsqueda avanzada** que localiza un producto en todos los establecimientos a la vez, consolidado y con detalle por lote. |
| **Stock SISMED** | El stock propio de la IPRESS, sincronizado desde su Toolkit Desktop. Solo lectura. |
| **Monitoreo de Stock** | Directorio territorial del stock sincronizado: quién está reportando y quién no. |
| **Redistribución** | El módulo que cierra el círculo: propone mover medicamento del establecimiento que lo tiene parado al que lo necesita. |

### 5.2 Dominio Inmunizaciones (cadena de frío / biológicos)

Es el desarrollo más reciente y el más completo: **control de vacunas por lote, desde el
almacén regional hasta cada establecimiento**, con cierre mensual y reportes oficiales.

**El flujo jerárquico:**

```
DIRESA (almacén regional)
  └─ ingreso regional → distribución → UNGET (almacén de red)
        └─ distribución → IPRESS (establecimiento)
              └─ consumo por lote · devolución · baja · transferencia → UNGET
```

**Los 12 módulos:**

| Módulo | Función |
|---|---|
| Catálogo Biológico | Catálogo maestro de vacunas, jeringas y diluyentes. |
| Inventario Inicial | Carga manual o por Excel del inventario de partida, lote por lote. |
| Stock Biológico | Stock agrupado por producto y detallado por lote, con alerta de vencimiento. |
| Consulta de Stock Biológico | Vista territorial de solo lectura, para supervisión. |
| Ingresos Regionales | Entradas de biológicos al almacén DIRESA. |
| Orígenes de Ingreso | Catálogo administrable de procedencias. |
| Distribuciones | Envíos DIRESA→UNGET y UNGET→IPRESS, con recepción e incidencias. |
| Consumo IPRESS | Consumo por comprobante, con varios productos y lotes. |
| Devoluciones y Bajas | Devoluciones, bajas y transferencias hacia la UNGET. |
| Reajustes de Stock | Correcciones auditadas por conteo físico, con constancia en PDF. |
| Cierre Mensual | La IPRESS precierra, la UNGET cierra en definitiva. |
| Reportes | Movimiento biológico mensual en PDF y Excel, y tablero de avance operativo. |

**Reglas de negocio que definen el módulo** (y que valen la pena en una presentación, porque
son lo que lo distingue de una hoja de cálculo):

- **Nada se edita: todo se mueve.** El saldo de un lote nunca se corrige a mano; cambia solo
  por un movimiento registrado con cantidad anterior, variación y cantidad posterior.
- **No existe el saldo negativo**, ni el consumo de un lote inexistente.
- **Salida FEFO** por defecto: sale primero el lote que vence antes.
- **Un periodo cerrado se bloquea.** No se puede operar hacia atrás sin una reapertura
  motivada y registrada.
- **Recepción con diferencia física** (`OBSERVED`): exige motivo y observación escrita, y el
  stock sube solo por lo realmente recibido.
- **Lo vencido o deteriorado no vuelve** al stock disponible.
- **Auditoría en todo movimiento crítico**: usuario, fecha y motivo.

**Los reportes:** un mismo formato oficial de 19 columnas, en cinco variantes según el nivel
(almacén IPRESS, almacén UNGET, red UNGET, almacén DIRESA, región DIRESA), en PDF y Excel.
Los traslados internos de cada ámbito se anulan entre sí, de modo que el **% de factor de
pérdida** de cada nivel es un indicador real y no una suma de movimientos internos.

### 5.3 Administración

Gestión de usuarios, roles y permisos por módulo, establecimientos y organización territorial
(DIRESA → OGESS → UNGET → microrred → IPRESS), regímenes laborales y profesiones, parámetros
del sistema, columnas visibles del stock por establecimiento y **dispositivos autorizados de
Sync SISMED 2.0**.

---

## 6. La versión móvil

La aplicación web es **responsive**: la misma aplicación, adaptada al teléfono. No es una app
nativa ni se instala desde una tienda; se abre en el navegador del móvil.

Lo que cambia en pantalla pequeña:

- **Menú hamburguesa** con los módulos agrupados por dominio (Farmacia / Inmunizaciones /
  Administración) y una **barra inferior** con los cuatro accesos más usados.
- Las **tablas se convierten en tarjetas**: en un teléfono no se lee una tabla de 19 columnas.
- Los **filtros pasan a hoja inferior** (*bottom sheet*) en vez de ocupar la pantalla.
- Los **modales llevan pie fijo**, para que el botón de guardar esté siempre al alcance.
- Cada módulo tiene su **propia dirección web**, así que el botón «atrás» del teléfono
  funciona como el usuario espera.

**Por qué importa**: el personal de una IPRESS rural no siempre tiene una computadora
disponible, pero sí un teléfono. Consultar stock, registrar un consumo o revisar una
distribución desde el móvil es la diferencia entre que el dato se registre hoy o la semana
que viene.

---

## 7. Seguridad y control de acceso

- **Autenticación propia** sobre tabla de usuarios con contraseñas cifradas (bcrypt),
  validadas **en el servidor**.
- **Token de sesión** de 12 horas que viaja en cada consulta; las tablas del módulo de
  inmunizaciones tienen políticas de seguridad a nivel de fila (**RLS**) que lo exigen.
- **Alcance territorial automático**: cada usuario ve solo lo suyo. Un usuario de IPRESS ve su
  establecimiento; uno de UNGET, su red; DIRESA, la región. El recorte se aplica en la base de
  datos, no solo en pantalla.
- **Permisos por módulo y por rol**, administrables desde la propia aplicación.
- **Token de instalación por máquina** en el Desktop, con lista blanca de almacenes y registro
  de cada sincronización.
- Auditoría de seguridad documentada, con los hallazgos y lo aplicado en producción.

---

## 8. Estado actual y cifras

| | |
|---|---|
| Toolkit Desktop | versión **2.0.11**, distribuido como instalador de Windows |
| Toolkit Web | **en producción**, con despliegue automático en cada cambio aprobado |
| Módulos web | **28** (7 de farmacia, 12 de inmunizaciones, 9 de administración y perfil) |
| Herramientas de escritorio | **14**, en 4 categorías |
| Pruebas automatizadas | **336**, ejecutadas en cada cambio |
| Verificación continua | tipos, pruebas y compilación en cada propuesta de cambio |
| Ámbito | DIRESA San Martín: 10 UNGET, decenas de establecimientos por red |

**Lo construido y funcionando:**
- Sincronización automática de stock desde los establecimientos.
- Consulta y búsqueda de stock en toda una red.
- Análisis de requerimientos y redistribución.
- Módulo de inmunizaciones completo, con cierre mensual y reportes oficiales.
- Administración de usuarios, roles, territorio y dispositivos.

**Lo siguiente:**
- Validar un periodo mensual completo con varias IPRESS y muchos lotes.
- Completar la experiencia móvil en los módulos de supervisión.
- Filtros territoriales avanzados para el nivel regional.
- Migrar progresivamente las UNGET del camino de Google Sheets al de Supabase.

---

## 9. Objetivo, intención y propósito

*(Esta sección es la que suele abrir y cerrar una presentación.)*

**Propósito**
Que ningún paciente se quede sin su medicamento por un problema de información.

**Objetivo general**
Integrar en una sola plataforma la información de medicamentos e insumos de todos los
establecimientos de la DIRESA San Martín, para que la gestión del abastecimiento se haga con
datos actuales y verificables en lugar de con consolidados manuales.

**Objetivos específicos**

1. **Automatizar** la captura del stock desde el SISMED local, sin digitación adicional y sin
   cambiar la forma de trabajar de la farmacia.
2. **Centralizar** esa información en una base única, consultable por cualquier nivel según su
   ámbito.
3. **Anticipar** el desabastecimiento y el vencimiento, con alertas y con un módulo de
   redistribución que propone mover lo que sobra a donde falta.
4. **Trazar por lote** toda la cadena de biológicos, desde el almacén regional hasta la dosis
   aplicada, con cierre mensual y auditoría.
5. **Eliminar el trabajo manual** de consolidar reportes: lo que antes eran días de Excel hoy
   es un archivo generado.
6. **Democratizar el acceso**: la misma información en la computadora del almacén regional y
   en el teléfono del técnico de un puesto de salud.

**Intención de diseño**
Una herramienta hecha desde dentro del servicio, por quien conoce la operación real: se apoya
en el SISMED que ya existe en lugar de reemplazarlo, no pide infraestructura nueva en los
establecimientos y está en español, con el vocabulario que usa el personal.

---

## 10. Beneficios e impacto

| Antes | Con ToolKit SISMED |
|---|---|
| Stock conocido por correo, con días de retraso | Stock actualizado cada pocos minutos |
| Consolidar la región: días de Excel manual | Un reporte generado en segundos |
| Desabastecimiento detectado cuando ya ocurrió | Alertas y propuesta de redistribución |
| Vencimientos descubiertos al vencer | Alerta anticipada por lote |
| Biológicos controlados en cuadernos y hojas | Trazabilidad por lote, auditada, con cierre mensual |
| Cada quien con su propio Excel | Una sola fuente, con permisos por ámbito |
| Solo desde la computadora de la oficina | También desde el teléfono |

---

## 11. Notas para quien arme la presentación

- **El hilo narrativo más fuerte** es el del dato: nace en un archivo DBF encerrado en una PC
  de un puesto de salud y termina en una decisión de abastecimiento regional. Todo lo demás es
  cómo se logra ese recorrido.
- **La imagen clave** es el diagrama de la sección 3.
- **El módulo de inmunizaciones** es el argumento más fuerte de madurez: no es un visor, es un
  sistema transaccional con reglas, bloqueos, auditoría y reportes oficiales.
- **El dato que más impresiona a una audiencia técnica** es la sincronización desatendida cada
  5 minutos con verificación de propiedad por máquina.
- **El dato que más impresiona a una audiencia de gestión** es el tiempo de consolidación: de
  días a segundos.
- **Evitar** prometer una app nativa de móvil: es una aplicación web responsive, y eso es
  precisamente una ventaja (nada que instalar ni actualizar en el teléfono).
