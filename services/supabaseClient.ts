import { createClient } from "@supabase/supabase-js";

// Supabase Connection Configuration
// If environment variables are not yet provided, we will fail gracefully and allow offline or mock checks
// @ts-ignore
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
// @ts-ignore
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** Clave donde vive el token de sesión emitido por `app_login`. */
export const SESSION_TOKEN_KEY = "aura_session_token";

/**
 * Adjunta el token de sesión a todas las peticiones.
 *
 * Las políticas RLS lo leen desde la cabecera `x-session-token` para distinguir a un
 * usuario con sesión iniciada de un visitante cualquiera de internet. Sin esto, la clave
 * `anon` —que viaja en el bundle publicado— bastaría para leer y escribir los datos.
 *
 * Se hace con un `fetch` propio y no con `global.headers` porque el token cambia al
 * iniciar y cerrar sesión, y las cabeceras fijas se congelan al crear el cliente.
 */
const fetchWithSessionToken: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  try {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (token) headers.set("x-session-token", token);
  } catch {
    // Sin sessionStorage la petición sale sin token y las políticas la rechazarán.
  }
  return fetch(input, { ...init, headers });
};

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fetchWithSessionToken } })
    : null;

/**
 * Programmatically computes a quick, non-cryptographic checksum/hash representing
 * the exact items and quantities in a stock list.
 * Any change in stock, products, batches, or expiration dates will yield a different hash value.
 */
export const computeStockHash = (products: any[]): string => {
  // Agrupar por las mismas claves que usamos en el diff (codigo, lote, tipsum, ffinan)
  // para que si hay filas duplicadas se sumen, y no dependa del orden
  const grouped: Record<string, number> = {};
  
  for (const item of products) {
    if (!item) continue;
    const id = String(item.ID_Producto || item.medcod || item.Codigo_Sismed || item.CODIGO_SIG || item.Nombre || "UNKNOWN").trim();
    const lot = String(item.Lote || "N/A").trim();
    const tipsum = String(item.TIPSUM || "N/A").trim();
    const ffinan = String(item.FFINAN || "N/A").trim();
    
    const qty =
      Number(
        item.Saldo !== undefined
          ? item.Saldo
          : item.Saldo_Fisico || item.Stock || 0,
      ) || 0;
      
    const key = `${id}|${lot}|${tipsum}|${ffinan}`;
    grouped[key] = (grouped[key] || 0) + qty;
  }

  // Ordenar las claves para asegurar un hash determinista
  const sortedKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  
  let stateStr = "";
  for (const key of sortedKeys) {
    stateStr += `${key}:${grouped[key]}|`;
  }

  // DJB2 simple hashing algorithm
  let hash = 5381;
  for (let i = 0; i < stateStr.length; i++) {
    hash = (hash * 33) ^ stateStr.charCodeAt(i);
  }
  return `v1:${(hash >>> 0).toString(36)}`;
};

/**
 * Compares two stock lists to find exactly which items changed and by how much
 */
export interface StockDifference {
  id: string;
  name: string;
  previousQty: number;
  currentQty: number;
  change: number;
  type: "added" | "removed" | "modified";
}

export const compareStockLists = (
  prevList: any[],
  currList: any[],
): StockDifference[] => {
  const prevMap = new Map<string, any>();
  prevList.forEach((item) => {
    const key = `${item.ID_Producto || item.Nombre || ""}:${item.Lote || ""}`;
    prevMap.set(key, item);
  });

  const currMap = new Map<string, any>();
  currList.forEach((item) => {
    const key = `${item.ID_Producto || item.Nombre || ""}:${item.Lote || ""}`;
    currMap.set(key, item);
  });

  const differences: StockDifference[] = [];

  // Find modifications and additions
  currList.forEach((currItem) => {
    const key = `${currItem.ID_Producto || currItem.Nombre || ""}:${currItem.Lote || ""}`;
    const currQty = Number(
      currItem.Saldo !== undefined
        ? currItem.Saldo
        : currItem.Saldo_Fisico || currItem.Stock || 0,
    );
    const name =
      currItem.Nombre || currItem.Descripcion || "Producto Desconocido";
    const id = currItem.ID_Producto || currItem.Nombre || "";

    if (!prevMap.has(key)) {
      differences.push({
        id,
        name,
        previousQty: 0,
        currentQty: currQty,
        change: currQty,
        type: "added",
      });
    } else {
      const prevItem = prevMap.get(key);
      const prevQty = Number(
        prevItem.Saldo !== undefined
          ? prevItem.Saldo
          : prevItem.Saldo_Fisico || prevItem.Stock || 0,
      );
      if (prevQty !== currQty) {
        differences.push({
          id,
          name,
          previousQty: prevQty,
          currentQty: currQty,
          change: currQty - prevQty,
          type: "modified",
        });
      }
    }
  });

  // Find removals
  prevList.forEach((prevItem) => {
    const key = `${prevItem.ID_Producto || prevItem.Nombre || ""}:${prevItem.Lote || ""}`;
    if (!currMap.has(key)) {
      const prevQty = Number(
        prevItem.Saldo !== undefined
          ? prevItem.Saldo
          : prevItem.Saldo_Fisico || prevItem.Stock || 0,
      );
      const name =
        prevItem.Nombre || prevItem.Descripcion || "Producto Desconocido";
      const id = prevItem.ID_Producto || prevItem.Nombre || "";
      differences.push({
        id,
        name,
        previousQty: prevQty,
        currentQty: 0,
        change: -prevQty,
        type: "removed",
      });
    }
  });

  return differences;
};

// Interface definition matching database table row
export interface StockSyncRecord {
  id?: string;
  establishment_id: string;
  establishment_name: string;
  sync_date: string;
  record_count: number;
  stock_hash: string;
  has_changes: boolean;
  changed_items_count: number;
  sync_author: string;
  created_at?: string;
  changes_metadata?: string; // Stored as JSON string list of differences
  last_modification_date?: string; // Added to track when the last modification happened
}

/**
 * Service to manage Supabase synchronization state
 */
export const supabaseService = {
  /**
   * Fetches the latest stock synchronization records for all establishments
   */
  async getLatestSyncs(
    establishmentIds?: string[],
  ): Promise<Record<string, StockSyncRecord>> {
    if (!supabase) return {};
    try {
      const latestMap: Record<string, StockSyncRecord> = {};

      if (establishmentIds && establishmentIds.length > 0) {
        const uniqueIds = Array.from(new Set(establishmentIds.filter(Boolean)));
        if (uniqueIds.length === 0) return latestMap;

        // Una sola consulta para todos los establecimientos; se conserva el más reciente de cada uno.
        const { data, error } = await supabase
          .from("stock_sync_history")
          .select("id,establishment_id,establishment_name,sync_date,record_count,stock_hash,has_changes,changed_items_count,sync_author,created_at,last_modification_date")
          .in("establishment_id", uniqueIds)
          .order("sync_date", { ascending: false });

        if (error) throw error;
        (data || []).forEach((row: StockSyncRecord) => {
          if (!latestMap[row.establishment_id]) {
            latestMap[row.establishment_id] = row;
          }
          if (
            row.has_changes &&
            !latestMap[row.establishment_id].last_modification_date
          ) {
            latestMap[row.establishment_id].last_modification_date = row.sync_date;
          }
        });
        return latestMap;
      }

      // Fallback: Query the latest records generally (this is unsafe if table is large, but kept for completeness if no IDs passed)
      const { data, error } = await supabase
        .from("stock_sync_history")
        .select("id,establishment_id,establishment_name,sync_date,record_count,stock_hash,has_changes,changed_items_count,sync_author,created_at,last_modification_date")
        .order("sync_date", { ascending: false })
        .limit(10000);

      if (error) throw error;
      if (!data) return {};

      // Map to an object keyed by establishment_id of the actual LATEST record
      data.forEach((row: StockSyncRecord) => {
        if (!latestMap[row.establishment_id]) {
          latestMap[row.establishment_id] = row;
        }

        // Also keep track of the most recent actual modification date!
        if (
          row.has_changes &&
          !latestMap[row.establishment_id].last_modification_date
        ) {
          latestMap[row.establishment_id].last_modification_date =
            row.sync_date;
        }
      });
      return latestMap;
    } catch (e) {
      console.warn("Error fetching latest syncs from Supabase:", e);
      return {};
    }
  },

  /**
   * Fetch full sync history log for a single establishment
   */
  async getHistoryForEstablishment(
    facilityId: string,
    limit = 15,
  ): Promise<StockSyncRecord[]> {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from("stock_sync_history")
        .select("*")
        .eq("establishment_id", facilityId)
        .order("sync_date", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn(`Error compiling history for '${facilityId}':`, e);
      return [];
    }
  },

  /**
   * Registers a sync snapshot.
   * If there's a previous sync, compares it to detect actual inventory changes.
   */
  async registerSync({
    establishmentId,
    establishmentName,
    currentStock,
    author,
    sheetLastUpdateDate,
  }: {
    establishmentId: string;
    establishmentName: string;
    currentStock: any[];
    author: string;
    sheetLastUpdateDate?: string;
  }): Promise<{
    success: boolean;
    record?: StockSyncRecord;
    hasChangesSinceLast: boolean;
    message?: string;
  }> {
    if (!supabase) {
      return {
        success: false,
        hasChangesSinceLast: false,
        message: "Supabase client not configured.",
      };
    }

    try {
      const stockHash = computeStockHash(currentStock);

      // Determine the sync_date to use based on the sheet's actual last update time if provided
      const finalSyncDate = sheetLastUpdateDate
        ? new Date(sheetLastUpdateDate).toISOString()
        : new Date().toISOString();

      // 1. Get the last record for this establishment from Supabase
      const { data: previousRecords, error: prevError } = await supabase
        .from("stock_sync_history")
        .select("*")
        .eq("establishment_id", establishmentId)
        .order("sync_date", { ascending: false })
        .limit(1);

      if (prevError) throw prevError;

      const latestRecord = previousRecords && previousRecords[0];
      let hasChanges = false;
      let changedCount = 0;
      let diffJson = "[]";

      const totalStock = currentStock.reduce(
        (sum, item) =>
          sum +
          (Number(
            item.Saldo !== undefined
              ? item.Saldo
              : item.Saldo_Fisico || item.Stock || 0,
          ) || 0),
        0,
      );
      const totalValue = currentStock.reduce(
        (sum, item) =>
          sum +
          ((Number(
            item.Saldo !== undefined
              ? item.Saldo
              : item.Saldo_Fisico || item.Stock || 0,
          ) || 0) *
            Number(item.Precio_Det || item.Precio_Cab || item.Precio || 0) ||
            0),
        0,
      );

      // Create a lightweight snapshot of current items to allow diffing on the next sync
      const currentItemsSnapshot: Record<
        string,
        {
          name: string;
          qty: number;
          codigo?: string;
          lote?: string;
          vto?: string;
        }
      > = {};
      currentStock.forEach((item) => {
        const codSismed = String(
          item.medcod ||
            item.Id_Producto ||
            item.ID_Producto ||
            item.Codigo_Sismed ||
            item.CODIGO_SISMED ||
            item.CODIGO_SIG ||
            item.Codigo ||
            item.ID ||
            item.Id ||
            "UNKNOWN",
        );
        const nombre = String(
          item.Nombre || item.Descripcion || item.Medicamento || "UNKNOWN",
        );
        const lote = String(item.Lote || "N/A");
        const vto = String(
          item.Fec_Vencim ||
            item.Fecha_Vencimiento ||
            item.Vencimiento ||
            "N/A",
        );
        const tipsum = String(item.TIPSUM || "N/A").trim();
        const ffinan = String(item.FFINAN || "N/A").trim();

        const itemId = `${codSismed}|${lote}|${tipsum}|${ffinan}`;
        const itemQty =
          Number(
            item.Saldo !== undefined
              ? item.Saldo
              : item.Saldo_Fisico || item.Stock || 0,
          ) || 0;
        
        if (currentItemsSnapshot[itemId]) {
          currentItemsSnapshot[itemId].qty += itemQty;
        } else {
          currentItemsSnapshot[itemId] = {
            name: nombre,
            qty: itemQty,
            codigo: codSismed,
            lote,
            vto,
          };
        }
      });

      const metadataObj: any = {
        total_stock: totalStock,
        total_value: totalValue,
        changes: [],
        items_snapshot: currentItemsSnapshot,
      };

      if (!latestRecord) {
        // First sync ever recorded for this establishment
        hasChanges = true;
        changedCount = currentStock.length;
      } else {
        // Compare with the previous recorded state
        hasChanges = latestRecord.stock_hash !== stockHash;

        // If the sheet's update date is identical to the latest record's sync date AND there are no changes,
        // it means the Desktop app hasn't pushed anything new to the sheet since our last check.
        // We shouldn't record a useless duplicate log.
        if (!hasChanges && latestRecord.sync_date === finalSyncDate) {
          return {
            success: true,
            record: latestRecord,
            hasChangesSinceLast: false,
            message: "Skipped - exact same sheet state and timestamp.",
          };
        }

        if (hasChanges) {
          try {
            let previousSnapshot: Record<
              string,
              {
                name: string;
                qty: number;
                codigo?: string;
                lote?: string;
                vto?: string;
              }
            > = {};
            if (latestRecord && latestRecord.changes_metadata) {
              const prevMeta = JSON.parse(latestRecord.changes_metadata);
              if (prevMeta && prevMeta.items_snapshot) {
                previousSnapshot = prevMeta.items_snapshot;
              }
            }

            // Calculate diff
            const detailedChanges: any[] = [];

            // Only calculate detailed diff if we have a valid previous snapshot
            if (Object.keys(previousSnapshot).length > 0) {
              // Check for modified or added items
              for (const [id, currentData] of Object.entries(
                currentItemsSnapshot,
              )) {
                const prevData = previousSnapshot[id];
                if (!prevData) {
                  if (currentData.qty !== 0) {
                    // Only push if actual change
                    detailedChanges.push({
                      id,
                      name: currentData.name,
                      codigo: currentData.codigo,
                      lote: currentData.lote,
                      vto: currentData.vto,
                      previousQty: 0,
                      currentQty: currentData.qty,
                      change: currentData.qty,
                    });
                  }
                } else if (prevData.qty !== currentData.qty) {
                  detailedChanges.push({
                    id,
                    name: currentData.name,
                    codigo: currentData.codigo,
                    lote: currentData.lote,
                    vto: currentData.vto,
                    previousQty: prevData.qty,
                    currentQty: currentData.qty,
                    change: currentData.qty - prevData.qty,
                  });
                }
              }

              // Check for removed/zeroed items
              for (const [id, prevData] of Object.entries(previousSnapshot)) {
                if (!currentItemsSnapshot[id]) {
                  if (prevData.qty !== 0) {
                    // Only push if it actually dropped from a non-zero value
                    detailedChanges.push({
                      id,
                      name: prevData.name,
                      codigo: prevData.codigo,
                      lote: prevData.lote,
                      vto: prevData.vto,
                      previousQty: prevData.qty,
                      currentQty: 0,
                      change: -prevData.qty,
                    });
                  }
                }
              }

              metadataObj.changes = detailedChanges;
              changedCount =
                detailedChanges.length > 0 ? detailedChanges.length : 1;
            } else {
              changedCount = 1;
            }
          } catch (e) {
            console.warn("Failed to compute detailed diff", e);
            changedCount = 1;
          }
        } else {
          // IF THERE ARE NO CHANGES, WE DO NOT RECORD ANYTHING IN SUPABASE.
          // This ensures our database ONLY holds actual movements.
          return {
            success: true,
            record: latestRecord,
            hasChangesSinceLast: false,
            message: "No hay cambios en el stock. No se agregó registro.",
          };
        }
      }

      // 2. Prepare payload to save
      const payload: StockSyncRecord = {
        establishment_id: establishmentId,
        establishment_name: establishmentName,
        sync_date: finalSyncDate,
        record_count: currentStock.length,
        stock_hash: stockHash,
        has_changes: hasChanges,
        changed_items_count: hasChanges ? changedCount : 0,
        sync_author: author || "Sistema",
        changes_metadata: JSON.stringify(metadataObj).replace(/\u0000/g, ""), // remove null bytes for postgres
      };

      // 3. Write to Supabase table
      let inserted;
      try {
        const { data, error } = await supabase
          .from("stock_sync_history")
          .insert([payload])
          .select();

        if (error) throw error;
        inserted = data;
      } catch (insertError: any) {
        console.warn(
          `Error inserting full payload for ${establishmentId}, retrying without metadata:`,
          insertError,
        );
        // If insert fails (e.g. metadata too large or invalid chars remaining), fallback to no metadata
        payload.changes_metadata = undefined;
        const { data, error } = await supabase
          .from("stock_sync_history")
          .insert([payload])
          .select();

        if (error) throw error;
        inserted = data;
      }

      return {
        success: true,
        record: inserted ? inserted[0] : payload,
        hasChangesSinceLast: hasChanges,
        message: hasChanges
          ? "Snapshot registrado (Se detectaron cambios de stock)."
          : "Snapshot registrado (Sin cambios en el stock).",
      };
    } catch (e: any) {
      console.error(
        "CRITICAL Error registering sync in Supabase for " +
          establishmentId +
          ":",
        e,
      );
      // Even if there's a critical error (like network down), we don't want the UI to hang on "Sin verificar" forever
      // if we at least read the local sheet correctly. But returning success: false is appropriate.
      return { success: false, hasChangesSinceLast: false, message: e.message };
    }
  },
};
