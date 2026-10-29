import { describe, expect, it } from "vitest";
import { filesFromFolder, filesFromList, missingFiles, uploadProblem, type FolderHandle } from "./guidesReviewSources";

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

  it("si la carpeta del SISMED trae copias arriba y los archivos en DATOS, manda DATOS", async () => {
    const real = file("TMOVIM.DBF");
    const sismed = folder("SISMED", [file("TMOVIM.DBF"), file("TMOVIMDET.DBF"), folder("DATOS", [real, file("TMOVIMDET.DBF")])]);
    expect((await filesFromFolder(sismed, "warehouse"))["TMOVIM.DBF"]).toBe(real);
    // Si DATOS está incompleta, se queda con la carpeta que tiene más.
    const incompleta = folder("SISMED", [file("TMOVIM.DBF"), file("TMOVIMDET.DBF"), folder("DATOS", [real])]);
    expect((await filesFromFolder(incompleta, "warehouse"))["TMOVIM.DBF"]).not.toBe(real);
  });

  it("dice qué archivos subir: los de la otra tarjeta, otros archivos o el que falta", () => {
    expect(uploadProblem("warehouse", ["tmovim.dbf", "TMOVIMDET.DBF", "MALMACEN.DBF"])).toBeNull();
    expect(uploadProblem("ici", ["TFORMDET.DBF"])).toBeNull();
    expect(uploadProblem("warehouse", ["TFORMDET.DBF"])).toBe(
      "TFORMDET.DBF es del SISMED del ICI: súbalo en su tarjeta. Aquí van TMOVIM.DBF y TMOVIMDET.DBF del SISMED del almacén.",
    );
    expect(uploadProblem("ici", ["TMOVIM.DBF", "TMOVIMDET.DBF"])).toBe(
      "TMOVIM.DBF y TMOVIMDET.DBF son del SISMED del almacén: súbalos en su tarjeta. Aquí va TFORMDET.DBF del SISMED del ICI.",
    );
    expect(uploadProblem("warehouse", ["Guias octubre.xlsx"])).toBe(
      "Guias octubre.xlsx no es de los archivos que se leen. Elija TMOVIM.DBF y TMOVIMDET.DBF de la carpeta DATOS del SISMED del almacén.",
    );
    expect(uploadProblem("warehouse", ["TMOVIM.DBF", "MPRODUCTO.DBF"])).toBe(
      "Falta TMOVIMDET.DBF: elíjalo junto con TMOVIM.DBF y MPRODUCTO.DBF (se pueden marcar varios archivos a la vez con Ctrl).",
    );
    expect(uploadProblem("warehouse", ["MALMACEN.DBF"])).toMatch(/^Faltan TMOVIM.DBF y TMOVIMDET.DBF: elíjalos junto con MALMACEN.DBF/);
  });
});
