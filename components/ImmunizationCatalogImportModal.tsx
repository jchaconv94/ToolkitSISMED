import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  PackagePlus,
  RefreshCw,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { toast } from "sonner";
import {
  ImmunizationProductImportPreview,
  ImmunizationProductImportRow,
  downloadImmunizationCatalogTemplate
} from "../services/immunizationExcelService";
import { ImmunizationProductTypeItem } from "../types";
import {
  ImmunizationEmptyState,
  ImmunizationKpiCard,
  ImmunizationStatusChip,
  ImmunizationTableHeader,
  formatImmunizationNumber
} from "./ui/immunization";

interface ImmunizationCatalogImportModalProps {
  preview: ImmunizationProductImportPreview;
  productTypes: ImmunizationProductTypeItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirmImport: (
    selectedRows: ImmunizationProductImportRow[],
    mode: "SKIP_EXISTING" | "UPDATE_EXISTING"
  ) => Promise<void>;
}

export const ImmunizationCatalogImportModal: React.FC<ImmunizationCatalogImportModalProps> = ({
  preview: initialPreview,
  productTypes,
  isSubmitting,
  onClose,
  onConfirmImport
}) => {
  const [rows, setRows] = useState<ImmunizationProductImportRow[]>(initialPreview.rows);
  const [importMode, setImportMode] = useState<"SKIP_EXISTING" | "UPDATE_EXISTING">("SKIP_EXISTING");
  const [filterTab, setFilterTab] = useState<"ALL" | "NEW" | "DUPLICATES" | "INVALID">("ALL");

  const getTypeLabel = (typeVal: string) => {
    if (!typeVal) return "";
    const matched = productTypes.find(
      t => t.code.toUpperCase() === typeVal.toUpperCase() || t.name.toUpperCase() === typeVal.toUpperCase()
    );
    return matched ? matched.name : typeVal;
  };

  const handleToggleRow = (index: number) => {
    setRows(prev =>
      prev.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r))
    );
  };

  const handleSelectAllFiltered = (selected: boolean) => {
    setRows(prev =>
      prev.map(r => {
        if (r.status === "INVALID") return { ...r, selected: false };
        if (filterTab === "NEW" && r.status !== "NEW") return r;
        if (filterTab === "DUPLICATES" && r.status !== "DUPLICATE_CODE" && r.status !== "DUPLICATE_DESC") return r;
        return { ...r, selected };
      })
    );
  };

  const counts = {
    total: rows.length,
    new: rows.filter(r => r.status === "NEW").length,
    duplicates: rows.filter(r => r.status === "DUPLICATE_CODE" || r.status === "DUPLICATE_DESC").length,
    invalid: rows.filter(r => r.status === "INVALID").length,
    selected: rows.filter(r => r.selected && r.status !== "INVALID").length
  };

  const filteredRows = rows.filter(r => {
    if (filterTab === "NEW") return r.status === "NEW";
    if (filterTab === "DUPLICATES") return r.status === "DUPLICATE_CODE" || r.status === "DUPLICATE_DESC";
    if (filterTab === "INVALID") return r.status === "INVALID";
    return true;
  });

  const handleExecute = async () => {
    const selectedRows = rows.filter(r => r.selected && r.status !== "INVALID");
    if (selectedRows.length === 0) {
      toast.warning("No hay productos válidos seleccionados para importar.");
      return;
    }

    if (importMode === "SKIP_EXISTING") {
      const onlyNew = selectedRows.filter(r => r.status === "NEW");
      if (onlyNew.length === 0) {
        toast.info("Todos los seleccionados ya existen y el modo elegido es 'Omitir existentes'. Cambie al modo 'Actualizar existentes' si desea sobreescribirlos.");
        return;
      }
    }

    await onConfirmImport(selectedRows, importMode);
  };

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubmitting, onClose]);

  // CASO DE ARCHIVO INVÁLIDO O ESTRUCTURA INCORRECTA
  if (initialPreview.isInvalidFile) {
    return createPortal(
      <div
        className="fixed inset-0 z-[1200000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        onMouseDown={e => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="px-6 py-4 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-rose-900">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
              <h3 className="text-base font-black tracking-tight">Archivo Excel No Válido</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-rose-100/60 text-slate-500 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className="p-4 bg-rose-50/70 border border-rose-200 rounded-xl text-xs text-rose-900 leading-relaxed">
              <p className="font-bold mb-1">Motivo del rechazo:</p>
              <p>{initialPreview.fileError || "El archivo cargado no coincide con el formato de Catálogo Biológico."}</p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-2">
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-teal-600" />
                Estructura obligatoria requerida:
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li><span className="font-mono font-bold text-slate-800">Codigo SISMED</span> (ej. 54003)</li>
                <li><span className="font-mono font-bold text-slate-800">Descripcion</span> (ej. VACUNA ANTITUBERCULOSA BCG)</li>
                <li><span className="font-mono text-slate-600">Tipo Producto</span> (VACUNA, DILUYENTE, JERINGA, INSUMO - opcional)</li>
                <li><span className="font-mono text-slate-600">Dosis/Unidad (Dosis o Unidad)</span> (numérico, ej. 20 - opcional)</li>
              </ul>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={downloadImmunizationCatalogTemplate}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-colors"
            >
              <Download className="h-4 w-4" />
              Descargar Plantilla Oficial
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-900 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1200000] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        className="w-full max-w-5xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200 my-auto"
      >
        {/* Cabecera del modal */}
        <header className="px-6 py-4 bg-gradient-to-r from-teal-50/90 via-white to-cyan-50/90 border-b border-teal-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-teal-600 text-white rounded-2xl shadow-xs">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 id="import-modal-title" className="text-base font-black text-teal-950 uppercase tracking-wide">
                Vista Previa de Importación: Catálogo Biológico
              </h3>
              <p className="text-xs text-teal-800/80 mt-0.5">
                Archivo: <span className="font-bold">{initialPreview.fileName}</span> ({initialPreview.sheetName})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar vista previa"
            className="p-2 rounded-xl hover:bg-teal-100/60 text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* KPIs de resumen */}
        <div className="p-6 pb-2 shrink-0 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ImmunizationKpiCard
              label="Total en Archivo"
              value={counts.total}
              tone="neutral"
              hint={`${counts.selected} seleccionados`}
            />
            <ImmunizationKpiCard
              label="Nuevos a Registrar"
              value={counts.new}
              tone="success"
              hint="No existen en BD"
            />
            <ImmunizationKpiCard
              label="Ya Registrados"
              value={counts.duplicates}
              tone="warning"
              hint="Coincide código o desc."
            />
            <ImmunizationKpiCard
              label="Con Errores"
              value={counts.invalid}
              tone="danger"
              hint="Sin código / desc."
            />
          </div>

          {/* Opciones de Importación y Pestañas de Filtro */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
            {/* Modo de importación para duplicados */}
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200/80 text-xs">
              <span className="font-bold text-slate-700 px-2">Para productos ya registrados:</span>
              <button
                type="button"
                onClick={() => {
                  setImportMode("SKIP_EXISTING");
                  // Auto desmarcar duplicados si se elige omitir
                  setRows(prev =>
                    prev.map(r => ({
                      ...r,
                      selected: r.status === "NEW"
                    }))
                  );
                }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  importMode === "SKIP_EXISTING"
                    ? "bg-teal-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Omitir existentes (Recomendado)
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportMode("UPDATE_EXISTING");
                  // Auto marcar todos los válidos
                  setRows(prev =>
                    prev.map(r => ({
                      ...r,
                      selected: r.status !== "INVALID"
                    }))
                  );
                }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  importMode === "UPDATE_EXISTING"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Actualizar existentes
              </button>
            </div>

            {/* Pestañas de filtrado de la tabla */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setFilterTab("ALL")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  filterTab === "ALL" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Todos ({counts.total})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("NEW")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  filterTab === "NEW" ? "bg-emerald-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Nuevos ({counts.new})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("DUPLICATES")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  filterTab === "DUPLICATES" ? "bg-amber-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Duplicados ({counts.duplicates})
              </button>
              {counts.invalid > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTab("INVALID")}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    filterTab === "INVALID" ? "bg-rose-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Con error ({counts.invalid})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabla de registros parseados */}
        <div className="px-6 py-2 overflow-y-auto flex-1">
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2.5 text-center w-10">
                    <input
                      type="checkbox"
                      checked={
                        filteredRows.length > 0 &&
                        filteredRows.filter(r => r.status !== "INVALID").every(r => r.selected)
                      }
                      onChange={e => handleSelectAllFiltered(e.target.checked)}
                      className="rounded border border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                      disabled={filteredRows.every(r => r.status === "INVALID")}
                    />
                  </th>
                  <ImmunizationTableHeader align="center">Fila</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Código</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Descripción</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Tipo</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="right">Dosis</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Diagnóstico / Duplicidad</ImmunizationTableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No hay productos en esta vista de filtro.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(row => {
                    const originalIndex = rows.findIndex(r => r.rowNumber === row.rowNumber);
                    const isNew = row.status === "NEW";
                    const isDup = row.status === "DUPLICATE_CODE" || row.status === "DUPLICATE_DESC";
                    const isInvalid = row.status === "INVALID";

                    return (
                      <tr
                        key={row.rowNumber}
                        className={`transition-colors ${
                          row.selected ? "bg-teal-50/40 hover:bg-teal-50/70" : "hover:bg-slate-50"
                        } ${isInvalid ? "bg-rose-50/30 opacity-70" : ""}`}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.selected)}
                            disabled={isInvalid}
                            onChange={() => handleToggleRow(originalIndex)}
                            className="rounded border border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4 disabled:opacity-30"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-slate-400 font-bold">
                          #{row.rowNumber}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span
                            className={`font-mono text-xs font-black px-2 py-0.5 rounded ${
                              isNew
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : isDup
                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                : "bg-rose-50 text-rose-800 border border-rose-200"
                            }`}
                          >
                            {row.codigoSismed || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-slate-900">{row.descripcion || "—"}</div>
                          {row.observacion && (
                            <div className="text-[11px] text-slate-400 mt-0.5">{row.observacion}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="text-[10px] font-black uppercase text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                            {getTypeLabel(row.tipoProducto)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-slate-800 whitespace-nowrap">
                          {formatImmunizationNumber(row.dosisUnidad, 0)}
                        </td>
                        <td className="px-3 py-2.5">
                          {isNew && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Nuevo biológico
                            </span>
                          )}
                          {isDup && (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                {row.status === "DUPLICATE_CODE"
                                  ? "Código ya existe en Catálogo"
                                  : "Descripción coincide con otro código"}
                              </span>
                            </div>
                          )}
                          {isInvalid && (
                            <div className="text-[11px] text-rose-700 font-bold space-y-0.5">
                              {row.errors.map((err, ei) => (
                                <div key={ei} className="flex items-center gap-1">
                                  <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                                  {err}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pie del modal con acciones */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600">
            <span className="font-bold text-slate-900">{counts.selected}</span> de{" "}
            <span className="font-bold text-slate-900">{counts.total}</span> productos seleccionados para procesar.
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExecute}
              disabled={isSubmitting || counts.selected === 0}
              className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Procesando importación...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Importar {counts.selected} {counts.selected === 1 ? "producto" : "productos"}
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
};
