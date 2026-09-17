import fs from "node:fs";

const path = "components/SheetSearchModule.tsx";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (pattern, replacement, label) => {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`No se encontró el patrón requerido: ${label}`);
  }
  source = next;
};

replaceOnce(
  /import \{ supabaseService, supabase \} from ["']\.\.\/services\/supabaseClient["'];/,
  'import { sheetSearchSyncService as supabaseService, sheetSearchSupabase as supabase } from "../services/sheetSearchIsolation";',
  "aislamiento Supabase",
);

replaceOnce(
  /import \{ stockStorageService \} from ["']\.\.\/services\/stockStorageService["'];/,
  'import { stockStorageService } from "../services/stockStorageService";\nimport { fetchGasInitialWorkbook } from "../services/gasInitialLoadService";',
  "import de carga inicial",
);

replaceOnce(
  /sheetsPayload = await fetchScriptUrlWithFallback\(config\.url\);/,
  'sheetsPayload = await fetchGasInitialWorkbook(config.url, { timeoutMs: 30000 });',
  "fallback de primera carga",
);

replaceOnce(
  /\}, \[scriptUrls, sources, data, selectedSourceId, user, isConfigLoading, lastGlobalSync\]\);/,
  '}, [scriptUrls, sources, data, user, isConfigLoading, lastGlobalSync]);',
  "dependencias de persistencia",
);

// La lógica vieja puede seguir renderizando etiquetas históricas por compatibilidad visual,
// pero desde este cambio el adaptador de Consulta Stock nunca toca Supabase.
fs.writeFileSync(path, source, "utf8");
console.log("Consulta Stock phase 3 codemod aplicado correctamente.");
