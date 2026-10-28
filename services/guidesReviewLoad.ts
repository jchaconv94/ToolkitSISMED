import { DbfError, openDbf } from "./dbfFile";
import { readIci, readPlaces, readProducts, readWarehouse, type IciData, type Place, type WarehouseData } from "./guidesReview";
import type { SourceFiles, SourceKind } from "./guidesReviewSources";

/** Lo leído de la carpeta del almacén: sus guías y, si están, los catálogos de nombres. */
export interface WarehouseSource {
  kind: "warehouse";
  warehouse: WarehouseData;
  places: Map<string, Place>;
  products: Map<string, string>;
}

export interface IciSource {
  kind: "ici";
  ici: IciData;
}

export type SourceData = WarehouseSource | IciSource;
export type SourceRequest = { kind: SourceKind; files: SourceFiles };

const table = async (files: SourceFiles, name: string) => {
  const file = files[name];
  if (!file) return null;
  try {
    return openDbf(await file.arrayBuffer());
  } catch (err) {
    if (err instanceof DbfError) throw new DbfError(`${name}: ${err.message}`);
    throw new Error(`No se pudo leer ${name}. Si el SISMED está abierto, ciérrelo y vuelva a intentarlo.`);
  }
};

/** Lee los archivos de una de las dos carpetas (en el worker o, si no hay, en la página). */
export const loadSourceData = async ({ kind, files }: SourceRequest): Promise<SourceData> => {
  if (kind === "warehouse") {
    const [tmovim, tmovimdet, malmacen, mproducto] = await Promise.all(["TMOVIM.DBF", "TMOVIMDET.DBF", "MALMACEN.DBF", "MPRODUCTO.DBF"].map((n) => table(files, n)));
    if (!tmovim || !tmovimdet) throw new Error("Faltan TMOVIM.DBF y TMOVIMDET.DBF del SISMED del almacén.");
    const warehouse = readWarehouse(tmovim, tmovimdet);
    if (!warehouse.lines.length) throw new Error("El SISMED del almacén no tiene guías de salida.");
    return { kind, warehouse, places: malmacen ? readPlaces(malmacen) : new Map(), products: mproducto ? readProducts(mproducto) : new Map() };
  }
  const tformdet = await table(files, "TFORMDET.DBF");
  if (!tformdet) throw new Error("Falta TFORMDET.DBF del SISMED donde se importa el ICI.");
  const ici = readIci(tformdet);
  if (!ici.months.length) throw new Error("El TFORMDET no tiene el ICI de ningún mes.");
  return { kind, ici };
};
