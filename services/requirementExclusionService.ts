import { RequirementExclusionItem } from "../types";
import { supabase } from "./supabaseClient";
import { read, utils, writeFile } from "xlsx";

const CACHE_KEY = "aura_requirement_exclusions_v1";

/** Helper para leer desde el fallback local */
const getLocalExclusions = (): RequirementExclusionItem[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Error reading local exclusions cache", e);
    return [];
  }
};

/** Helper para guardar en el fallback local */
const saveLocalExclusions = (items: RequirementExclusionItem[]) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error("Error saving local exclusions cache", e);
  }
};

/**
 * Código completo, para comparar: los códigos SISMED y de establecimiento son de 5 dígitos con
 * sus ceros a la izquierda («00200», «06528»). Cuando Excel guarda el código como número borra
 * esos ceros y llega «200»; aquí se completa a «00200». Antes se comparaba tal cual, «00200»
 * no coincidía con «200» y el producto no se excluía, sin ningún aviso.
 */
export const normalizeExclusionCode = (code?: string | number | null): string => {
  const text = String(code ?? "").trim().toUpperCase();
  return /^\d+$/.test(text) && text.length < 5 ? text.padStart(5, "0") : text;
};

/** Cómo buscar el establecimiento: tal como llegó y completado con sus ceros. */
export const establishmentCodeVariants = (code?: string | number | null): string[] => {
  const text = String(code ?? "").trim();
  if (!text) return [];
  return [...new Set([text, normalizeExclusionCode(text)])];
};

export const requirementExclusionService = {
  /**
   * Obtiene la lista de medicamentos excluidos para un establecimiento
   */
  async getExclusionsByFacility(facilityCode: string): Promise<RequirementExclusionItem[]> {
    const cleanCode = (facilityCode || "").trim();
    if (!cleanCode) return [];
    const normalizedCode = normalizeExclusionCode(cleanCode);
    const sameFacility = (code: string) => normalizeExclusionCode(code) === normalizedCode;

    try {
      if (supabase) {
        const { data, error } = await supabase
          .from("requirement_exclusion_lists")
          .select("*")
          .in("establishment_code", establishmentCodeVariants(cleanCode))
          .order("description", { ascending: true });

        if (!error && data) {
          const mapped: RequirementExclusionItem[] = data.map((row: any) => ({
            id: row.id,
            establishmentCode: row.establishment_code,
            sismedCode: row.sismed_code,
            description: row.description,
            presentation: row.presentation || "",
            reason: row.reason || "",
            createdBy: row.created_by || "",
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }));

          // Sincronizar con almacenamiento local (actualizar solo este establecimiento)
          const allLocal = getLocalExclusions().filter(i => !sameFacility(i.establishmentCode));
          saveLocalExclusions([...allLocal, ...mapped]);

          return mapped;
        }
      }
    } catch (err) {
      console.warn("Supabase exclusions query failed, using local cache:", err);
    }

    // Fallback a localStorage
    return getLocalExclusions().filter(i => sameFacility(i.establishmentCode));
  },

  /** Alias para getExclusionsByFacility */
  async getExclusions(facilityCode: string): Promise<RequirementExclusionItem[]> {
    return this.getExclusionsByFacility(facilityCode);
  },

  /** Obtiene un Set con los códigos SISMED excluidos de un establecimiento */
  async getExclusionCodes(facilityCode: string): Promise<Set<string>> {
    const items = await this.getExclusionsByFacility(facilityCode);
    return new Set(items.map(i => normalizeExclusionCode(i.sismedCode)));
  },

  /**
   * Guarda o actualiza un medicamento en la lista de exclusión
   */
  async saveExclusion(item: {
    id?: string;
    establishmentCode: string;
    sismedCode: string;
    description: string;
    presentation?: string;
    reason?: string;
    createdBy?: string;
  }): Promise<{ success: boolean; data?: RequirementExclusionItem; message?: string }> {
    const cleanEstCode = item.establishmentCode.trim();
    const cleanSismedCode = item.sismedCode.trim();
    const cleanDescription = item.description.trim();

    if (!cleanEstCode || !cleanSismedCode || !cleanDescription) {
      return { success: false, message: "Código de establecimiento, código SISMED y descripción son obligatorios." };
    }

    const payload = {
      establishment_code: cleanEstCode,
      sismed_code: cleanSismedCode,
      description: cleanDescription,
      presentation: (item.presentation || "").trim(),
      reason: (item.reason || "").trim(),
      created_by: item.createdBy || "Sistema",
      updated_at: new Date().toISOString()
    };

    let resultItem: RequirementExclusionItem | null = null;

    if (!supabase) {
      console.warn("Supabase no configurado, guardando en cache local");
      resultItem = {
        id: item.id || `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        establishmentCode: cleanEstCode,
        sismedCode: cleanSismedCode,
        description: cleanDescription,
        presentation: (item.presentation || "").trim(),
        reason: (item.reason || "").trim(),
        createdBy: item.createdBy || "Sistema",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const all = getLocalExclusions();
      const filtered = all.filter(
        i => !(i.establishmentCode === cleanEstCode && i.sismedCode === cleanSismedCode) && i.id !== resultItem!.id
      );
      saveLocalExclusions([...filtered, resultItem]);
      return { success: true, data: resultItem };
    }

    try {
      if (item.id && !item.id.startsWith("local-") && !item.id.startsWith("batch-")) {
        // Update
        const { data, error } = await supabase
          .from("requirement_exclusion_lists")
          .update(payload)
          .eq("id", item.id)
          .select()
          .single();

        if (error) {
          console.error("Error al actualizar exclusión en Supabase:", error);
          return { success: false, message: `Error en Supabase: ${error.message} (${error.code || 'RLS/Tabla'})` };
        }
        if (data) {
          resultItem = {
            id: data.id,
            establishmentCode: data.establishment_code,
            sismedCode: data.sismed_code,
            description: data.description,
            presentation: data.presentation || "",
            reason: data.reason || "",
            createdBy: data.created_by || "",
            createdAt: data.created_at,
            updatedAt: data.updated_at
          };
        }
      } else {
        // Upsert / Insert
        const { data, error } = await supabase
          .from("requirement_exclusion_lists")
          .upsert({ ...payload, created_at: new Date().toISOString() }, { onConflict: "establishment_code,sismed_code" })
          .select()
          .single();

        if (error) {
          console.error("Error al guardar exclusión en Supabase:", error);
          return { success: false, message: `Error en Supabase: ${error.message} (${error.code || 'RLS/Tabla'})` };
        }
        if (data) {
          resultItem = {
            id: data.id,
            establishmentCode: data.establishment_code,
            sismedCode: data.sismed_code,
            description: data.description,
            presentation: data.presentation || "",
            reason: data.reason || "",
            createdBy: data.created_by || "",
            createdAt: data.created_at,
            updatedAt: data.updated_at
          };
        }
      }
    } catch (err: any) {
      console.error("Excepción al guardar en Supabase:", err);
      return { success: false, message: `Error de red o conexión con Supabase: ${err.message || err}` };
    }

    if (!resultItem) {
      return { success: false, message: "No se pudo obtener la confirmación del registro guardado en Supabase." };
    }

    // Actualizar local storage solo tras éxito en Supabase
    const all = getLocalExclusions();
    const filtered = all.filter(
      i => !(i.establishmentCode === cleanEstCode && i.sismedCode === cleanSismedCode) && i.id !== resultItem!.id
    );
    saveLocalExclusions([...filtered, resultItem]);

    return { success: true, data: resultItem };
  },

  /**
   * Guarda un lote de medicamentos para exclusión (usado en Carga Masiva)
   */
  async saveExclusionsBatch(
    facilityCode: string,
    items: Array<{
      sismedCode: string;
      description: string;
      presentation?: string;
      reason?: string;
    }>,
    username?: string
  ): Promise<{ success: boolean; count: number; duplicatesCount: number; message?: string }> {
    const cleanEstCode = (facilityCode || "").trim();
    if (!cleanEstCode) return { success: false, count: 0, duplicatesCount: 0, message: "Código de establecimiento no válido" };
    if (!items || items.length === 0) return { success: true, count: 0, duplicatesCount: 0 };

    // Deduplicar en memoria por sismed_code
    const map = new Map<string, { sismedCode: string; description: string; presentation?: string; reason?: string }>();
    let duplicates = 0;

    for (const it of items) {
      const code = (it.sismedCode || "").trim();
      const desc = (it.description || "").trim();
      if (!code || !desc) continue;
      if (map.has(code)) {
        duplicates++;
      }
      map.set(code, {
        sismedCode: code,
        description: desc,
        presentation: (it.presentation || "").trim(),
        reason: (it.reason || "").trim()
      });
    }

    const uniqueItems = Array.from(map.values());
    const now = new Date().toISOString();
    const rowsToInsert = uniqueItems.map(it => ({
      establishment_code: cleanEstCode,
      sismed_code: it.sismedCode,
      description: it.description,
      presentation: it.presentation || "",
      reason: it.reason || "",
      created_by: username || "Sistema",
      created_at: now,
      updated_at: now
    }));

    try {
      if (supabase && rowsToInsert.length > 0) {
        const { error } = await supabase
          .from("requirement_exclusion_lists")
          .upsert(rowsToInsert, { onConflict: "establishment_code,sismed_code" });

        if (error) {
          console.error("Error en Supabase batch upsert:", error);
          return {
            success: false,
            count: 0,
            duplicatesCount: duplicates,
            message: `Error al guardar lote en Supabase: ${error.message}`
          };
        }
      }
    } catch (err: any) {
      console.error("Excepción al guardar lote en Supabase:", err);
      return {
        success: false,
        count: 0,
        duplicatesCount: duplicates,
        message: `Excepción en Supabase: ${err.message || err}`
      };
    }

    // Actualizar local storage
    const all = getLocalExclusions();
    const currentCodes = new Set(uniqueItems.map(u => u.sismedCode));
    const others = all.filter(i => !(i.establishmentCode === cleanEstCode && currentCodes.has(i.sismedCode)));

    const newLocalItems: RequirementExclusionItem[] = uniqueItems.map(u => ({
      id: `batch-${Date.now()}-${u.sismedCode}`,
      establishmentCode: cleanEstCode,
      sismedCode: u.sismedCode,
      description: u.description,
      presentation: u.presentation || "",
      reason: u.reason || "",
      createdBy: username || "Sistema",
      createdAt: now,
      updatedAt: now
    }));

    saveLocalExclusions([...others, ...newLocalItems]);

    return {
      success: true,
      count: uniqueItems.length,
      duplicatesCount: duplicates,
      message: `Se registraron ${uniqueItems.length} medicamentos en la lista de exclusión en Supabase.`
    };
  },

  /**
   * Elimina un medicamento de la lista de exclusión
   */
  async deleteExclusion(id: string, facilityCode?: string, sismedCode?: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (supabase && id && !id.startsWith("local-") && !id.startsWith("batch-")) {
        const { error } = await supabase
          .from("requirement_exclusion_lists")
          .delete()
          .eq("id", id);

        if (error) {
          console.error("Error al eliminar en Supabase:", error);
          return { success: false, message: `Error en Supabase: ${error.message}` };
        }
      } else if (supabase && facilityCode && sismedCode) {
        const { error } = await supabase
          .from("requirement_exclusion_lists")
          .delete()
          .eq("establishment_code", facilityCode)
          .eq("sismed_code", sismedCode);

        if (error) {
          console.error("Error al eliminar por código en Supabase:", error);
          return { success: false, message: `Error en Supabase: ${error.message}` };
        }
      }
    } catch (err: any) {
      console.error("Excepción al eliminar en Supabase:", err);
      return { success: false, message: `Error de conexión: ${err.message || err}` };
    }

    // Sincronizar localmente
    const all = getLocalExclusions();
    const filtered = all.filter(i => {
      if (i.id === id) return false;
      if (facilityCode && sismedCode && i.establishmentCode === facilityCode && i.sismedCode === sismedCode) return false;
      return true;
    });
    saveLocalExclusions(filtered);

    return { success: true };
  },

  /**
   * Elimina todos los medicamentos de la lista de exclusión de un establecimiento
   */
  async clearExclusionsByFacility(facilityCode: string): Promise<{ success: boolean; message?: string }> {
    const cleanCode = (facilityCode || "").trim();
    if (!cleanCode) return { success: false, message: "Código inválido" };

    try {
      if (supabase) {
        const { error } = await supabase
          .from("requirement_exclusion_lists")
          .delete()
          .eq("establishment_code", cleanCode);

        if (error) {
          console.error("Error al vaciar exclusiones en Supabase:", error);
          return { success: false, message: `Error en Supabase: ${error.message}` };
        }
      }
    } catch (err: any) {
      console.error("Excepción al vaciar exclusiones en Supabase:", err);
      return { success: false, message: `Error de conexión: ${err.message || err}` };
    }

    // Actualizar local
    const all = getLocalExclusions();
    const filtered = all.filter(i => i.establishmentCode !== cleanCode);
    saveLocalExclusions(filtered);

    return { success: true };
  },

  /**
   * Lee y procesa un archivo Excel (.xlsx / .xls / .csv) de exclusiones
   */
  async parseExclusionExcel(
    file: File,
    facilityCode: string,
    username?: string
  ): Promise<{
    items: RequirementExclusionItem[];
    totalRows: number;
    validCount: number;
    invalidCount: number;
    errors: string[];
  }> {
    const buffer = await file.arrayBuffer();
    const workbook = read(buffer, { type: "array" });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("El archivo no contiene hojas válidas.");
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = utils.sheet_to_json<any>(worksheet);

    if (rawData.length === 0) {
      throw new Error("El archivo Excel está vacío.");
    }

    const items: RequirementExclusionItem[] = [];
    const errors: string[] = [];
    let invalidCount = 0;

    // Normalizador de cabeceras
    const findValue = (row: any, candidates: string[]) => {
      const keys = Object.keys(row);
      for (const cand of candidates) {
        const match = keys.find(k => k.toLowerCase().replace(/[\s\u00a0_]+/g, " ").trim() === cand.toLowerCase());
        if (match && row[match] !== undefined && row[match] !== null) {
          return String(row[match]).trim();
        }
      }
      // Fallback a includes
      for (const cand of candidates) {
        const match = keys.find(k => k.toLowerCase().replace(/[\s\u00a0_]+/g, " ").trim().includes(cand.toLowerCase()));
        if (match && row[match] !== undefined && row[match] !== null) {
          return String(row[match]).trim();
        }
      }
      return "";
    };

    rawData.forEach((row, index) => {
      const rowNum = index + 2; // Considerando fila 1 cabeceras
      const sismedCode = findValue(row, [
        "codigo_med", "codigo", "cod_med", "med cod", "med_cod", "código", "codigo sismed", "cod sismed"
      ]);
      const description = findValue(row, [
        "descrip", "descripcion", "nombre", "medicamento", "descripcion del producto", "producto", "descripción"
      ]);
      const presentation = findValue(row, [
        "ff", "forma", "presentacion", "presentación", "forma farmaceutica", "forma farmacéutica"
      ]);
      const reason = findValue(row, [
        "motivo", "razon", "razón", "observacion", "observación", "nota", "comentario"
      ]);

      if (!sismedCode || !description) {
        invalidCount++;
        if (errors.length < 5) {
          errors.push(`Fila ${rowNum}: Falta Código SISMED o Descripción.`);
        }
        return;
      }

      items.push({
        establishmentCode: facilityCode,
        sismedCode,
        description,
        presentation,
        reason,
        createdBy: username || "Carga Excel",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    return {
      items,
      totalRows: rawData.length,
      validCount: items.length,
      invalidCount,
      errors
    };
  },

  /**
   * Exporta la lista actual a un archivo Excel
   */
  exportExclusionsToExcel(items: RequirementExclusionItem[], facilityName: string, facilityCode: string) {
    const dataToExport = items.map((item, idx) => ({
      "N°": idx + 1,
      "CÓDIGO SISMED": item.sismedCode,
      "DESCRIPCIÓN DEL MEDICAMENTO": item.description,
      "PRESENTACIÓN / FORMA": item.presentation || "",
      "MOTIVO DE EXCLUSIÓN": item.reason || "",
      "REGISTRADO POR": item.createdBy || "",
      "FECHA REGISTRO": item.createdAt ? new Date(item.createdAt).toLocaleDateString("es-PE") : ""
    }));

    const ws = utils.json_to_sheet(dataToExport);
    ws["!cols"] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 50 },
      { wch: 25 },
      { wch: 35 },
      { wch: 20 },
      { wch: 16 }
    ];

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Lista Exclusiones");

    const safeName = (facilityName || "Establecimiento").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Lista_Exclusiones_${facilityCode}_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    writeFile(wb, filename);
  },

  /**
   * Descarga la plantilla oficial para carga masiva
   */
  downloadTemplate() {
    const templateData = [
      {
        "CODIGO_MED": "00143",
        "DESCRIPCION": "PARACETAMOL 500 MG TABLETA",
        "PRESENTACION": "TABLETA",
        "MOTIVO": "No requerido en cartera local"
      },
      {
        "CODIGO_MED": "02312",
        "DESCRIPCION": "AMOXICILINA 500 MG CAPSULA",
        "PRESENTACION": "CAPSULA",
        "MOTIVO": "Abastecido por estrategia sanitaria regional"
      },
      {
        "CODIGO_MED": "05432",
        "DESCRIPCION": "IBUPROFENO 400 MG TABLETA",
        "PRESENTACION": "TABLETA",
        "MOTIVO": "Excluido temporalmente por saldo acumulado"
      }
    ];

    const ws = utils.json_to_sheet(templateData);
    ws["!cols"] = [
      { wch: 16 },
      { wch: 45 },
      { wch: 22 },
      { wch: 40 }
    ];

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Plantilla_Exclusiones");
    writeFile(wb, "Plantilla_Carga_Exclusiones_SISMED.xlsx");
  }
};
