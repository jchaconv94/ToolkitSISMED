from pathlib import Path

path = Path("services/gasConnectionService.ts")
text = path.read_text(encoding="utf-8")

text = text.replace(
    "timeoutMs: options.timeoutMs || 18000,",
    "timeoutMs: Math.max(options.timeoutMs || 18000, 35000),",
    1,
)

old = '''      if (Array.isArray(result) && result.length > 0) {
        const isMetadata = result.every(
          (item: any) =>
            item &&
            typeof item === "object" &&
            item.name &&
            (item.lastUpdate !== undefined || item.rowCount !== undefined || !item.data)
        );
        if (isMetadata) {
          const metadata = result as GasSheetMetadata[];
          metadataCache.set(cleanUrl, {
            value: metadata,
            expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
          });
          return metadata;
        }
      }
      return null;'''

new = '''      if (Array.isArray(result) && result.length > 0) {
        const cacheMetadata = (metadata: GasSheetMetadata[]) => {
          metadataCache.set(cleanUrl, {
            value: metadata,
            expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
          });
          return metadata;
        };

        const isMetadata = result.every(
          (item: any) =>
            item &&
            typeof item === "object" &&
            item.name &&
            (item.lastUpdate !== undefined || item.rowCount !== undefined || !item.data)
        );
        if (isMetadata) {
          return cacheMetadata(result as GasSheetMetadata[]);
        }

        // Compatibilidad con implementaciones GAS antiguas que ignoran action=getMetadata
        // y devuelven el libro completo. Reutilizamos esa misma respuesta en vez de
        // descartarla y volver a descargar todo el archivo una segunda vez.
        const isLegacyWorkbook = result.every(
          (item: any) =>
            item &&
            typeof item === "object" &&
            item.name &&
            item.id !== undefined &&
            Array.isArray(item.data),
        );
        if (isLegacyWorkbook) {
          const normalizeKey = (value: string) =>
            String(value || "")
              .normalize("NFD")
              .replace(/[\\u0300-\\u036f]/g, "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "");
          const readRowValue = (row: Record<string, any>, aliases: string[]) => {
            const wanted = new Set(aliases.map(normalizeKey));
            const key = Object.keys(row || {}).find((candidate) => wanted.has(normalizeKey(candidate)));
            const value = key ? row[key] : "";
            return value === undefined || value === null ? "" : String(value).trim();
          };

          const metadata = result
            .map((item: any): GasSheetMetadata => {
              const firstRow = Array.isArray(item.data) && item.data.length > 0 ? item.data[0] : {};
              const sheetName = String(item.name || "").trim();
              const almcod = readRowValue(firstRow, ["ALMCOD", "ALM_COD"]);
              const suffix = sheetName.match(/-([A-Z0-9]+)\\s*$/i)?.[1]?.toUpperCase() || "";
              return {
                id: String(item.id || ""),
                name: sheetName,
                lastUpdate: readRowValue(firstRow, [
                  "ULTIMA_ACTUALIZACION",
                  "ULTIMA ACTUALIZACION",
                  "ULTIMA ACTUALIZACIÓN",
                  "Ultima_Actualizacion",
                ]),
                equipmentDate: readRowValue(firstRow, [
                  "FECHA_DEL_EQUIPO",
                  "FECHA DEL EQUIPO",
                  "Fecha_Del_Equipo",
                ]),
                almcod,
                codigoIpress: suffix || (almcod ? almcod.substring(0, 5) : ""),
                rowCount: Array.isArray(item.data) ? item.data.length : 0,
              };
            })
            .filter((item: GasSheetMetadata) => item.id && item.name);

          if (metadata.length > 0) return cacheMetadata(metadata);
        }
      }
      return null;'''

if old not in text:
    raise RuntimeError("No se encontró el bloque de metadata esperado")

path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Corrección de metadata aplicada")
