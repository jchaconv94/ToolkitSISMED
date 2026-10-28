import { DbfError, openDbf } from "./dbfFile";
import { detailSummary, movementSummary, readIci, readPlaces, readProducts, readWarehouse, type IciData, type Place, type WarehouseData } from "./guidesReview";
import { formatNumber } from "./numberFormat";
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

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const count = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

const stamp = (ms: number | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Cuándo se guardó por última vez cada archivo, para notar uno viejo o de otra copia. */
export type FileDates = { tmovim?: number; tmovimdet?: number };

/** Por qué un TMOVIM no da guías de salida, con lo que sí tiene. */
export const noGuidesMessage = (summary: ReturnType<typeof movementSummary>, detail?: ReturnType<typeof detailSummary>, dates: FileDates = {}) => {
  if (!summary.total) return "El TMOVIM.DBF de esta carpeta está vacío: no es la carpeta DATOS del SISMED del almacén.";
  if (!summary.activeExits) {
    const range = summary.first ? ` (movimientos del ${day(summary.first)} al ${day(summary.last)})` : "";
    return `Esta carpeta no es la del SISMED del almacén: su TMOVIM.DBF tiene ${count(summary.entries, "entrada", "entradas")} y ninguna salida vigente${range}. Elija la carpeta DATOS del SISMED desde donde el almacén emite las guías a los establecimientos.`;
  }
  const parts = [`Las ${formatNumber(summary.activeExits)} salidas de TMOVIM.DBF no tienen su detalle en TMOVIMDET.DBF.`];
  if (detail) {
    const deleted = detail.records - detail.live;
    parts.push(`TMOVIMDET tiene ${count(detail.live, "registro", "registros")}${deleted ? ` (y ${formatNumber(deleted)} borrados)` : ""}, ${formatNumber(detail.exits)} de salidas y ${formatNumber(detail.matched)} con el número de una salida vigente.`);
    if (detail.sampleDetail && detail.sampleHeader) parts.push(`Número de salida en TMOVIM: ${detail.sampleHeader}; en TMOVIMDET: ${detail.sampleDetail}.`);
  }
  if (dates.tmovim && dates.tmovimdet) parts.push(`Guardados el ${stamp(dates.tmovim)} (TMOVIM) y el ${stamp(dates.tmovimdet)} (TMOVIMDET).`);
  parts.push("Use los dos archivos de la misma carpeta DATOS.");
  return parts.join(" ");
};

/** Lee los archivos de una de las dos carpetas (en el worker o, si no hay, en la página). */
export const loadSourceData = async ({ kind, files }: SourceRequest): Promise<SourceData> => {
  if (kind === "warehouse") {
    const [tmovim, tmovimdet, malmacen, mproducto] = await Promise.all(["TMOVIM.DBF", "TMOVIMDET.DBF", "MALMACEN.DBF", "MPRODUCTO.DBF"].map((n) => table(files, n)));
    if (!tmovim || !tmovimdet) throw new Error("Faltan TMOVIM.DBF y TMOVIMDET.DBF del SISMED del almacén.");
    const warehouse = readWarehouse(tmovim, tmovimdet);
    if (!warehouse.lines.length) {
      const summary = movementSummary(tmovim);
      const detail = summary.activeExits ? detailSummary(tmovim, tmovimdet) : undefined;
      throw new Error(noGuidesMessage(summary, detail, { tmovim: files["TMOVIM.DBF"]?.lastModified, tmovimdet: files["TMOVIMDET.DBF"]?.lastModified }));
    }
    return { kind, warehouse, places: malmacen ? readPlaces(malmacen) : new Map(), products: mproducto ? readProducts(mproducto) : new Map() };
  }
  const tformdet = await table(files, "TFORMDET.DBF");
  if (!tformdet) throw new Error("Falta TFORMDET.DBF del SISMED donde se importa el ICI.");
  const ici = readIci(tformdet);
  if (!ici.months.length) throw new Error("El TFORMDET no tiene el ICI de ningún mes.");
  return { kind, ici };
};
