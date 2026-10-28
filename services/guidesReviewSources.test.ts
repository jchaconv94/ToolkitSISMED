import { describe, expect, it } from "vitest";
import { filesFromFolder, filesFromList, missingFiles, type FolderHandle } from "./guidesReviewSources";

const file = (name: string) => new File(["x"], name);
const folder = (name: string, entries: Array<File | FolderHandle>): FolderHandle => ({
  kind: "directory",
  name,
  values: async function* () {
    for (const entry of entries) {
      if (entry instanceof File) yield { kind: "file" as const, name: entry.name, getFile: async () => entry };
      else yield entry;
    }
  },
});

describe("archivos de Revisión de guías", () => {
  it("reconoce los DBF subidos sin distinguir mayúsculas e ignora los demás", () => {
    const found = filesFromList([file("tmovim.dbf"), file("TMOVIMDET.DBF"), file("Malmacen.Dbf"), file("TMOVIM.CDX"), file("TFORMDET.DBF")], "warehouse");
    expect(Object.keys(found).sort()).toEqual(["MALMACEN.DBF", "TMOVIM.DBF", "TMOVIMDET.DBF"]);
    expect(missingFiles("warehouse", found)).toEqual([]);
    expect(missingFiles("ici", found)).toEqual(["TFORMDET.DBF"]);
  });

  it("dice qué obligatorio falta; los catálogos de nombres son opcionales", () => {
    expect(missingFiles("warehouse", filesFromList([file("TMOVIM.DBF")], "warehouse"))).toEqual(["TMOVIMDET.DBF"]);
    expect(missingFiles("warehouse", filesFromList([file("TMOVIM.DBF"), file("TMOVIMDET.DBF")], "warehouse"))).toEqual([]);
  });

  it("lee la carpeta DATOS o, si se eligió la del SISMED, su subcarpeta DATOS", async () => {
    const datos = folder("Datos", [file("TFORMDET.DBF"), file("TMOVIM.DBF")]);
    expect(Object.keys(await filesFromFolder(datos, "ici"))).toEqual(["TFORMDET.DBF"]);
    const sismed = folder("SISMED", [file("LEEME.TXT"), datos]);
    expect(Object.keys(await filesFromFolder(sismed, "ici"))).toEqual(["TFORMDET.DBF"]);
    expect(missingFiles("ici", await filesFromFolder(folder("OTRA", [file("LEEME.TXT")]), "ici"))).toEqual(["TFORMDET.DBF"]);
  });
});
