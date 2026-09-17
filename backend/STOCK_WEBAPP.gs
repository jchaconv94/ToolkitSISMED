/**
 * TOOLKIT SISMED - STOCK WEB APP
 *
 * Backend de solo lectura para publicar el Stock detallado SISMED desde Google Sheets.
 * Mantiene compatibilidad con el frontend actual y agrega endpoints ligeros para delta-sync.
 *
 * Endpoints:
 *   ?action=getMetadata       -> metadatos ligeros de todas las hojas
 *   ?action=checkUpdates      -> alias compatible de getMetadata
 *   ?action=getSheets         -> id + nombre de cada hoja
 *   ?action=getStock&sheet=X  -> una hoja concreta
 *   ?sheet=X                  -> compatibilidad: una hoja concreta
 *   ?sheets=A,B,C             -> varias hojas concretas
 *   sin parámetros            -> compatibilidad legacy: todas las hojas (costoso)
 */

const STOCK_SPREADSHEET_ID = '1vic6MeMiA5Jk4_UWx8nI462yXe8irgxAoMncJiekOOA';
// v6: la metadata incluye spreadsheetId (lectura directa desde la web).
const STOCK_METADATA_CACHE_KEY = 'toolkit_sismed_stock_metadata_v6';
const STOCK_METADATA_CACHE_SECONDS = 60;

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || '').trim();
    const targetSheetName = String(params.sheet || '').trim();
    const targetSheetsParam = String(params.sheets || '').trim();
    const forceRefresh = String(params.refresh || '') === '1';

    if (action === 'getMetadata' || action === 'checkUpdates') {
      // La metadata en caché se responde sin abrir el libro: abrirlo mientras las hojas
      // se escriben constantemente es la parte lenta de la ejecución.
      const cached = forceRefresh ? null : getCachedMetadata_();
      if (cached) return jsonResponse_(cached);
      return jsonResponse_(getMetadata_(SpreadsheetApp.openById(STOCK_SPREADSHEET_ID)));
    }

    const ss = SpreadsheetApp.openById(STOCK_SPREADSHEET_ID);

    if (action === 'getSheets') {
      return jsonResponse_(getSheetList_(ss));
    }

    if (action === 'getStock') {
      if (!targetSheetName) {
        return jsonResponse_({ error: 'Falta el parámetro sheet' });
      }
      const sheet = ss.getSheetByName(targetSheetName);
      if (!sheet) {
        return jsonResponse_({ error: 'Hoja no encontrada' });
      }
      return jsonResponse_([processSheet_(sheet)]);
    }

    if (targetSheetsParam) {
      const names = Array.from(new Set(
        targetSheetsParam
          .split(',')
          .map(function (name) { return name.trim(); })
          .filter(Boolean)
      ));

      const result = [];
      for (let i = 0; i < names.length; i++) {
        const sheet = ss.getSheetByName(names[i]);
        if (sheet) result.push(processSheet_(sheet));
      }
      return jsonResponse_(result);
    }

    if (targetSheetName) {
      const sheet = ss.getSheetByName(targetSheetName);
      if (!sheet) {
        return jsonResponse_({ error: 'Hoja no encontrada' });
      }
      return jsonResponse_([processSheet_(sheet)]);
    }

    // Compatibilidad con la versión actual del frontend.
    // Es el camino más costoso y debe quedar solo como fallback / primera carga legacy.
    const allSheets = ss.getSheets();
    const result = new Array(allSheets.length);
    for (let i = 0; i < allSheets.length; i++) {
      result[i] = processSheet_(allSheets[i]);
    }
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ error: err && err.message ? err.message : String(err) });
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function cleanHeader_(value) {
  if (!value) return '';
  const accents = { 'Á':'A', 'É':'E', 'Í':'I', 'Ó':'O', 'Ú':'U', 'Ñ':'N' };
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[ÁÉÍÓÚÑ]/g, function (m) { return accents[m]; })
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function findHeaderIndex_(headers, aliases) {
  for (let i = 0; i < headers.length; i++) {
    const current = cleanHeader_(headers[i]);
    for (let j = 0; j < aliases.length; j++) {
      if (current === aliases[j]) return i;
    }
  }
  return -1;
}

/**
 * Resuelve el código oficial del establecimiento sin asumir siempre 5 caracteres.
 *
 * Casos actuales:
 *   FARM - P.S. SANTA ELENA-06523        -> 06523
 *   ALM. ANEXO ... -030S05               -> 030S05
 *
 * Se prioriza el sufijo del nombre de la hoja porque representa el código con el que
 * el establecimiento está registrado en la aplicación. El ALMCOD puede incluir además
 * el código interno de farmacia/almacén (F01, 01, etc.).
 */
function getFacilityCode_(sheetName, almcod) {
  const name = String(sheetName || '').trim();
  const suffixMatch = name.match(/-([A-Z0-9]+)\s*$/i);
  if (suffixMatch && suffixMatch[1]) {
    return suffixMatch[1].toUpperCase();
  }

  const code = String(almcod || '').trim().toUpperCase();
  if (!code) return '';

  // RENIPRESS numérico habitual: 5 dígitos antes del código interno del almacén.
  const numericMatch = code.match(/^(\d{5})(?=[A-Z]|\d{2,}$)/);
  if (numericMatch) return numericMatch[1];

  // Fallback conservador para integraciones antiguas.
  return code.length >= 5 ? code.substring(0, 5) : code;
}

function getSheetList_(ss) {
  const sheets = ss.getSheets();
  return sheets.map(function (sheet) {
    return {
      id: sheet.getSheetId().toString(),
      name: sheet.getName()
    };
  });
}

/**
 * Metadatos ligeros. Lee solo encabezado + primera fila de datos de cada hoja.
 * La fecha SISMED se repite por registro, por lo que no es necesario recorrer todo el stock.
 */
function getCachedMetadata_() {
  try {
    const cached = CacheService.getScriptCache().get(STOCK_METADATA_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (_) {
    return null;
  }
}

function getMetadata_(ss) {
  const cache = CacheService.getScriptCache();
  const sheets = ss.getSheets();
  const metadata = new Array(sheets.length);

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    const base = {
      id: sheet.getSheetId().toString(),
      name: sheet.getName(),
      lastUpdate: '',
      equipmentDate: '',
      almcod: '',
      codigoIpress: '',
      rowCount: Math.max(0, lastRow - 1),
      spreadsheetId: STOCK_SPREADSHEET_ID
    };

    if (lastRow < 2 || lastCol < 1) {
      metadata[i] = base;
      continue;
    }

    const sample = sheet.getRange(1, 1, 2, lastCol).getDisplayValues();
    const headers = sample[0] || [];
    const firstRow = sample[1] || [];

    const idxLastUpdate = findHeaderIndex_(headers, [
      'ULTIMA_ACTUALIZACION',
      'ULTIMA_ACT',
      'ULT_ACT',
      'FECHA_ACTUALIZACION',
      'FECHA_DE_ACTUALIZACION'
    ]);
    const idxEquipment = findHeaderIndex_(headers, [
      'FECHA_DEL_EQUIPO',
      'FECHA_EQUIPO'
    ]);
    const idxAlmcod = findHeaderIndex_(headers, [
      'ALMCOD',
      'ALM_COD'
    ]);

    const almcod = idxAlmcod >= 0 ? String(firstRow[idxAlmcod] || '').trim() : '';

    metadata[i] = {
      id: base.id,
      name: base.name,
      lastUpdate: idxLastUpdate >= 0 ? String(firstRow[idxLastUpdate] || '').trim() : '',
      equipmentDate: idxEquipment >= 0 ? String(firstRow[idxEquipment] || '').trim() : '',
      almcod: almcod,
      codigoIpress: getFacilityCode_(sheet.getName(), almcod),
      rowCount: base.rowCount,
      spreadsheetId: STOCK_SPREADSHEET_ID
    };
  }

  try {
    const serialized = JSON.stringify(metadata);
    // CacheService limita el tamaño por clave. Este payload es pequeño para las hojas actuales.
    if (serialized.length < 90000) {
      cache.put(STOCK_METADATA_CACHE_KEY, serialized, STOCK_METADATA_CACHE_SECONDS);
    }
  } catch (_) {}

  return metadata;
}

/**
 * Lee una hoja completa en una sola operación de SpreadsheetApp y la convierte a objetos.
 */
function processSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 1) {
    return {
      id: sheet.getSheetId().toString(),
      name: sheet.getName(),
      spreadsheetId: STOCK_SPREADSHEET_ID,
      data: []
    };
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const rawHeaders = values[0] || [];

  // Conservar el nombre original del encabezado para no romper el frontend existente.
  const headers = rawHeaders.map(function (header) {
    return String(header || '').trim();
  });

  const rows = [];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const obj = {};
    let hasData = false;

    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const key = headers[colIndex];
      if (!key) continue;

      const value = row[colIndex];
      const stringValue = value === undefined || value === null ? '' : String(value);
      obj[key] = stringValue;
      if (!hasData && stringValue.trim() !== '') hasData = true;
    }

    if (hasData) rows.push(obj);
  }

  return {
    id: sheet.getSheetId().toString(),
    name: sheet.getName(),
    spreadsheetId: STOCK_SPREADSHEET_ID,
    data: rows
  };
}
