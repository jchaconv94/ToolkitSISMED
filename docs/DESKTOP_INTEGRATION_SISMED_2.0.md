# Especificaciones de Integración: Toolkit SISMED Desktop 2.0 -> App Web SISMED 2.0

Este documento detalla la interfaz de comunicación y las expectativas del backend (Supabase) para la sincronización directa del stock utilizando el módulo Desktop "Sync SISMED 2.0".

El objetivo principal es enviar la información del stock extraído de los archivos DBF del SISMED local directamente a la base de datos centralizada en Supabase a través de una Edge Function.

> **Invariante de arquitectura:** `Consulta Stock` (`SIG_SEARCH`) y `Monitoreo de Stock` (`STOCK_MONITORING`) son módulos independientes. Consulta Stock usa Google Sheets + Google Apps Script como fuente de inventario. Monitoreo de Stock usa Supabase (`stock_actual`) como fuente de inventario. Ninguno debe usar la base del otro como fallback de existencias, lotes, saldos o vencimientos.

## 1. Esquema de Base de Datos en Supabase (Versión 14)

Se han implementado las siguientes tablas destino:

*   **`facility_warehouses`**: Almacenes y farmacias habilitadas.
*   **`sync_installations`**: Máquinas de escritorio autorizadas a sincronizar.
*   **`sync_runs`**: Historial y auditoría de sincronizaciones individuales.
*   **`stock_actual`**: Datos consolidados y/o detallados del stock, con índice único en `(facility_code, almcod, medcod, lote, fecha, ffinan, tipsum)`.

## 2. API / Edge Function Destino

Se ha creado y desplegado una Edge Function en Supabase bajo el nombre `sync-stock`.

*   **Método:** `POST`
*   **Endpoint:** `https://[SUPABASE_PROJECT_REF].supabase.co/functions/v1/sync-stock`
*   **Content-Type:** `application/json`

### 2.1 Autenticación (Headers requeridos)

El Desktop **no** interactúa directamente con la base de datos (PostgreSQL/REST local). Solo interactúa con la Edge Function, comunicándose a través de un Token de Instalación.

**Headers obligatorios:**
*   `Authorization`: `Bearer <installation_token>` **O** el header personalizado `x-installation-token`: `<installation_token>`
*   `content-type`: `application/json`

*Nota acerca de tokens:* El backend almacenará un `token_hash` SHA-256 en la tabla `sync_installations`. El `installation_token` provisto a la aplicación Desktop funcionará como un API Key en texto plano, que será verificado en tiempo de ejecución.

### 2.2 Formato del Payload (JSON)

El modelo de datos esperado para el `body` de la petición HTTP es el siguiente:

```json
{
  "source": "toolkit-sismed-desktop",
  "schema_version": "sismed-stock-v1",
  "toolkit_version": "1.0.x",
  "sent_at_host": "dd/MM/yyyy HH:mm:ss",
  "sent_at_epoch": 1780000000,
  "mode": "consolidado", // Puede ser "consolidado" o "detallado"
  "record_count": 413,   // Número total de elementos dentro del array records[]
  "fecha_equipo": "dd/MM/yyyy HH:mm:ss", // Fecha reportada por el DBF general
  "records": [
    {
      "almcod": "06502F01",       // Obligatorio. Formato 5 digitos + cod. Interno
      "desc_alm": "Farmacia Emergencia",
      "medcod": "00143",          // Código SIG del ítem SISMED
      "codigo_sig": "...",        // Opcional/Redundante si se usa medcod
      "xnom": "Paracetamol 500mg",// Nombre principal
      "lote": "L-123456",         // Lote (para distinción única)
      "fecha": "29/02/2028",      // Fecha de Vencimiento
      "medregsan": "EN-1234",     // Registro Sanitario
      "tipsum": "CN",             // Tipo de Suministro
      "tipsum_des": "...",
      "ffinan": "DYT",            // Fuente de Financiamiento
      "ffinan_des": "...",
      "saldo": 172,               // Obligatorio, Numérico
      "precio_det": 0.133875,     // Obligatorio, Numérico
      "preciocab": 0.14875,       // Obligatorio, Numérico
      "fecha_equipo": "dd/MM/yyyy HH:mm:ss" // (Opcional, en caso de registros asíncronos puntuales)
    }
  ]
}
```

### 2.3 Reglas y Lógica Aplicada en la Edge Function

La contraparte web (la Edge Function) ya está configurada para:
1.  **Validar Ingesta**: Verifica que el `installation_token` tenga permisos válidos en `sync_installations`.
2.  **Verificación de `almcod`**: La Edge Function validará que los códigos de almacén (`almcod`) reportados dentro de `records[]` existan en la lista blanca `allowed_almcods` de esa máquina/token particular. Esto asegura que la máquina IPRESS A no pise o reporte equivocadamente stock por el ALMCOD de la IPRESS B.
3.  **Deducción de la Facilidad (`facility_code`)**: El sistema del servidor deduce automáticamente a quién pertenece este stock leyendo la instalación propietaria o analizando los primeros 5 caracteres del `almcod` facilitado.
4.  **Flujo de Reemplazo**: Primero, el servicio eliminará en cascada todo el stock que esté asignado previamente a los `almcod` que están reportándose. Segundo, insertará la matriz de datos enviados. Por esta razón, la PC Escritorio debe asegurar de **mandar el inventario completo** por cada `almcod` habilitado. (Un re-sincronizado parcial borrará los ítems no enviados).

## 3. Separación de módulos de stock en el Frontend Web

Estos módulos comparten la aplicación y algunos estilos, pero **no comparten la fuente principal de inventario**:

*   **`SIG_SEARCH` / Consulta Stock — `SheetSearchModule`**: su fuente oficial para medicamentos, lotes, saldos, fechas de vencimiento y fechas de actualización es **Google Sheets**, consultado mediante **Google Apps Script**. IndexedDB (`stockStorageService`) actúa únicamente como caché local para acelerar la apertura. Este módulo **no debe leer `stock_actual` como fuente de inventario ni usar Supabase como fallback del stock de Google Sheets**.
*   **`STOCK_MONITORING` / Monitoreo de Stock — `IpressStockModule`**: es la evolución 2.0 de monitoreo y su fuente oficial de inventario es **Supabase `stock_actual`**, alimentada por Sync SISMED 2.0. Este módulo **no debe reemplazar sus datos por Google Sheets ni usar Apps Script como fallback de inventario**.
*   **`IPRESS_STOCK` / Stock SISMED**: es una vista privada para la IPRESS y mantiene sus reglas propias. No debe confundirse con `SIG_SEARCH` ni con el directorio supervisor `STOCK_MONITORING`.

### 3.1 Regla de fechas en Consulta Stock

Google Sheets de Consulta Stock usa el formato visible **`DD/MM/YYYY`**. El Apps Script debe leer las hojas con `getDisplayValues()` y el frontend debe conservar e interpretar ese formato como día/mes/año. Ejemplo: `07/12/2026` significa **7 de diciembre de 2026**, nunca 12 de julio.

Cuando cambie una regla de normalización de datos, la versión de caché IndexedDB de `Consulta Stock` debe incrementarse para impedir que registros antiguos incompatibles vuelvan a mostrarse sin releer Google Sheets.

## 4. Próximos pasos recomendados a la Inteligencia Artificial del Módulo Escritorio:

1.  Actualizar la UI en la red de escritorio (Toolkit Desktop C#/Electron/etc.) para recibir el `Installation Token` local dentro de los parámetros de configuración. (Un campo de input para texto o UUID).
2.  Mantener el algoritmo de extracción de archivos `.dbf`.
3.  Serializar la extracción como JSON siguiendo el esquema exacto mostrado en la Sección `2.2`.
4.  Llamar al endpoint haciendo el request HTTP, procesando estados 200 y fallos. 
5.  Recomendación: Enviar en lotes (chunks) si el payload JSON sobrepasa el tamaño seguro para el ambiente que esté corriendo el Desktop Tool, aunque el servidor aceptará miles de registros por defecto con `record_count`.
