import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Layers,
  Loader2,
  Search,
  X,
  XCircle
} from "lucide-react";
import {
  formatImmunizationCurrency,
  formatImmunizationDate,
  formatImmunizationNumber,
  ImmunizationKpiCard,
  ImmunizationTableHeader
} from "./ui/immunization";
import {
  downloadImmunizationInventoryTemplate,
  ImmunizationImportPreview,
  ImmunizationImportRow
} from "../services/immunizationExcelService";

interface ImmunizationInitialInventoryImportModalProps {
  isOpen: boolean;
  preview: ImmunizationImportPreview | null;
  onClose: () => void;
  onConfirmImport: (
    selectedRows: ImmunizationImportRow[],
    mode: "SKIP_EXISTING" | "UPDATE_EXISTING"
  ) => Promise<void> | void;
  isSubmitting?: boolean;
}

type FilterTab = "ALL" | "NEW" | "EXISTING" | "INVALID";

export const ImmunizationInitialInventoryImportModal: React.FC<
  ImmunizationInitialInventoryImportModalProps
> = ({ isOpen, preview, onClose, onConfirmImport, isSubmitting = false }) => {
  const [rows, setRows] = useState<ImmunizationImportRow[]>([]);
  const [importMode, setImportMode] = useState<"SKIP_EXISTING" | "UPDATE_EXISTING">("SKIP_EXISTING");
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (preview && preview.rows) {
      setRows(
        preview.rows.map(r => ({
          ...r,
          selected: Boolean(r.selected ?? (!r.isExistingInDraft && r.status !== "INVALID"))
        }))
      );
      setImportMode("SKIP_EXISTING");
      setFilterTab("ALL");
      setSearchTerm("");
    }
  }, [preview]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const counts = useMemo(() => {
    const total = rows.length;
    const newCount = rows.filter(r => !r.isExistingInDraft && r.status !== "INVALID").length;
    const existingCount = rows.filter(r => r.isExistingInDraft && r.status !== "INVALID").length;
    const invalidCount = rows.filter(r => r.status === "INVALID").length;
    const consolidatedCount = rows.filter(r => r.status === "CONSOLIDATED").length;
    const selected = rows.filter(r => r.selected && r.status !== "INVALID").length;
    const selectedQuantity = rows
      .filter(r => r.selected && r.status !== "INVALID")
      .reduce((sum, r) => sum + r.quantity, 0);
    const selectedValue = rows
      .filter(r => r.selected && r.status !== "INVALID")
      .reduce((sum, r) => sum + r.quantity * r.unitPrice, 0);

    return {
      total,
      new: newCount,
      existing: existingCount,
      invalid: invalidCount,
      consolidated: consolidatedCount,
      selected,
      selectedQuantity,
      selectedValue
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return rows.filter(row => {
      if (filterTab === "NEW" && (row.isExistingInDraft || row.status === "INVALID")) return false;
      if (filterTab === "EXISTING" && (!row.isExistingInDraft || row.status === "INVALID")) return false;
      if (filterTab === "INVALID" && row.status !== "INVALID") return false;

      if (!term) return true;
      const sismedMatch = row.codigoSismed.toLowerCase().includes(term);
      const officialDescMatch = row.officialDescription.toLowerCase().includes(term);
      const excelDescMatch = row.excelDescription.toLowerCase().includes(term);
      const loteMatch = row.lote.toLowerCase().includes(term);
      const supplyMatch = row.supplyType.toLowerCase().includes(term);
      const fundingMatch = row.fundingSource.toLowerCase().includes(term);

      return (
        sismedMatch ||
        officialDescMatch ||
        excelDescMatch ||
        loteMatch ||
        supplyMatch ||
        fundingMatch
      );
    });
  }, [rows, filterTab, searchTerm]);

  const handleToggleRow = (indexInAllRows: number) => {
    if (isSubmitting) return;
    setRows(prev =>
      prev.map((r, idx) => {
        if (idx === indexInAllRows) {
          if (r.status === "INVALID") return r;
          return { ...r, selected: !r.selected };
        }
        return r;
      })
    );
  };

  const handleSelectAllFiltered = (check: boolean) => {
    if (isSubmitting) return;
    const filteredRowNumbers = new Set(filteredRows.map(r => r.rowNumber));
    setRows(prev =>
      prev.map(r => {
        if (filteredRowNumbers.has(r.rowNumber) && r.status !== "INVALID") {
          return { ...r, selected: check };
        }
        return r;
      })
    );
  };

  const handleModeChange = (mode: "SKIP_EXISTING" | "UPDATE_EXISTING") => {
    setImportMode(mode);
    if (mode === "SKIP_EXISTING") {
      setRows(prev =>
        prev.map(r => ({
          ...r,
          selected: !r.isExistingInDraft && r.status !== "INVALID"
        }))
      );
    } else {
      setRows(prev =>
        prev.map(r => ({
          ...r,
          selected: r.status !== "INVALID"
        }))
      );
    }
  };

  if (!isOpen || !preview) return null;

  // Render modal de archivo no válido
  if (preview.isInvalidFile) {
    return createPortal(
      <div
        className="fixed inset-0 z-[1200000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        onMouseDown={e => {
          if (e.target === e.currentTarget && !isSubmitting) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invalid-file-title"
          className="w-full max-w-lg bg-white border border-rose-200 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        >
          <div className="px-6 py-4 bg-rose-50/80 border-b border-rose-100 flex items-center justify-between text-rose-950">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
              <h3 id="invalid-file-title" className="text-base font-black tracking-tight">
                Archivo de Inventario No Válido
              </h3>
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
              <p>
                {preview.fileError ||
                  "El archivo cargado no coincide con el formato oficial de Inventario Inicial de Inmunizaciones."}
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-2">
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-teal-600" />
                Columnas obligatorias requeridas en el archivo:
              </p>
              <ul className="grid grid-cols-2 gap-1.5 list-disc list-inside pl-1">
                <li>
                  <span className="font-mono font-bold text-slate-800">Codigo SISMED</span>
                </li>
                <li>
                  <span className="font-mono font-bold text-slate-800">Lote</span>
                </li>
                <li>
                  <span className="font-mono font-bold text-slate-800">Fecha vencimiento</span>
                </li>
                <li>
                  <span className="font-mono font-bold text-slate-800">Saldo fisico</span>
                </li>
                <li>
                  <span className="font-mono font-bold text-slate-800">Precio unitario</span>
                </li>
                <li>
                  <span className="font-mono font-bold text-slate-800">Fuente financiamiento</span>
                </li>
                <li>
                  <span className="font-mono font-bold text-slate-800">Tipo suministro</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={downloadImmunizationInventoryTemplate}
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
        aria-labelledby="inventory-import-title"
        className="w-full max-w-6xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200 my-auto"
      >
        {/* Cabecera del modal */}
        <header className="px-6 py-4 bg-gradient-to-r from-teal-50/90 via-white to-cyan-50/90 border-b border-teal-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-teal-600 text-white rounded-2xl shadow-xs">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 id="inventory-import-title" className="text-base font-black text-teal-950 uppercase tracking-wide">
                Vista Previa de Importación: Inventario Inicial
              </h3>
              <p className="text-xs text-teal-800/80 mt-0.5">
                Archivo: <span className="font-bold">{preview.fileName}</span> ({preview.sheetName || "Hoja1"}) • Validación de catálogo y detección de existencias
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
        <div className="px-6 pt-4 pb-2 shrink-0 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <ImmunizationKpiCard
              compact
              label="Total en Archivo"
              value={counts.total}
              tone="neutral"
              hint={`${counts.selected} seleccionados`}
            />
            <ImmunizationKpiCard
              compact
              label="Nuevos a Registrar"
              value={counts.new}
              tone="success"
              hint="No existen en inventario"
            />
            <ImmunizationKpiCard
              compact
              label="Ya Registrados"
              value={counts.existing}
              tone="warning"
              hint="Coincide código o lote"
            />
            <ImmunizationKpiCard
              compact
              label="Con Errores"
              value={counts.invalid}
              tone="danger"
              hint="No se importarán"
            />
            <ImmunizationKpiCard
              compact
              label="Valorización Seleccionada"
              value={formatImmunizationCurrency(counts.selectedValue)}
              tone="info"
              hint={`${formatImmunizationNumber(counts.selectedQuantity, 0)} frascos/dosis`}
            />
          </div>

          {/* Opciones de Importación y Pestañas */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
            {/* Modo para productos ya registrados */}
            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200/80 text-xs shrink-0">
              <span className="font-bold text-slate-700 px-1.5 text-[11px]">Para productos ya registrados:</span>
              <button
                type="button"
                onClick={() => handleModeChange("SKIP_EXISTING")}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all ${
                  importMode === "SKIP_EXISTING"
                    ? "bg-teal-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Omitir existentes (Recomendado)
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("UPDATE_EXISTING")}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all ${
                  importMode === "UPDATE_EXISTING"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Actualizar existentes
              </button>
            </div>

            {/* Pestañas de filtrado */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold shrink-0">
              <button
                type="button"
                onClick={() => setFilterTab("ALL")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  filterTab === "ALL"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Todos ({counts.total})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("NEW")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  filterTab === "NEW"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Nuevos ({counts.new})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab("EXISTING")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  filterTab === "EXISTING"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Ya registrados ({counts.existing})
              </button>
              {counts.invalid > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTab("INVALID")}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    filterTab === "INVALID"
                      ? "bg-rose-600 text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Con errores ({counts.invalid})
                </button>
              )}
            </div>
          </div>

          {/* Buscador de ancho optimizado */}
          <div className="flex items-center">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por código SISMED, biológico, lote..."
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all placeholder:text-slate-400"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabla de registros analizados */}
        <div className="px-6 py-2 overflow-y-auto flex-1">
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-center w-8">
                    <input
                      type="checkbox"
                      checked={
                        filteredRows.length > 0 &&
                        filteredRows
                          .filter(r => r.status !== "INVALID")
                          .every(r => r.selected)
                      }
                      onChange={e => handleSelectAllFiltered(e.target.checked)}
                      className="rounded border border-slate-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5 cursor-pointer"
                      disabled={filteredRows.every(r => r.status === "INVALID")}
                    />
                  </th>
                  <ImmunizationTableHeader align="center">Fila</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="center">Cód.</ImmunizationTableHeader>
                  <th className="px-3 py-2 text-left font-bold text-slate-700 min-w-[220px]">
                    Biológico / Producto
                  </th>
                  <ImmunizationTableHeader>Lote</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Vencimiento</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="right">Saldo</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="right">Precio</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="center">F. Finan</ImmunizationTableHeader>
                  <ImmunizationTableHeader align="center">T. Sum</ImmunizationTableHeader>
                  <ImmunizationTableHeader>Diagnóstico / Validación</ImmunizationTableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      No se encontraron registros con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(row => {
                    const originalIndex = rows.findIndex(r => r.rowNumber === row.rowNumber);
                    const isConsolidated = row.status === "CONSOLIDATED";
                    const isInvalid = row.status === "INVALID";
                    const isExisting = row.isExistingInDraft;

                    return (
                      <tr
                        key={row.rowNumber}
                        className={`transition-colors ${
                          row.selected
                            ? isExisting
                              ? "bg-amber-50/30 hover:bg-amber-50/60"
                              : "bg-teal-50/40 hover:bg-teal-50/70"
                            : "hover:bg-slate-50"
                        } ${isInvalid ? "bg-rose-50/30 opacity-75" : ""}`}
                      >
                        {/* Checkbox de selección */}
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.selected)}
                            disabled={isInvalid}
                            onChange={() => handleToggleRow(originalIndex)}
                            className="rounded border border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4 disabled:opacity-30 cursor-pointer"
                          />
                        </td>

                        {/* Número de fila */}
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {row.originalRowNumbers && row.originalRowNumbers.length > 1 ? (
                            <span
                              title={`Filas combinadas del Excel: #${row.originalRowNumbers.join(", #")}`}
                              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800"
                            >
                              #{row.originalRowNumbers.join(", #")}
                            </span>
                          ) : (
                            <span className="font-mono text-slate-400 font-bold">
                              #{row.rowNumber}
                            </span>
                          )}
                        </td>

                        {/* Código SISMED */}
                        <td className="px-2.5 py-2 text-center whitespace-nowrap">
                          <span
                            className={`font-mono text-xs font-black px-1.5 py-0.5 rounded ${
                              !isInvalid
                                ? isExisting
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : "bg-rose-50 text-rose-800 border border-rose-200"
                            }`}
                          >
                            {row.codigoSismed || "—"}
                          </span>
                        </td>

                        {/* Descripción Oficial y del Excel */}
                        <td className="px-3 py-2 min-w-[220px]">
                          <div
                            className={`font-bold text-xs leading-snug ${
                              isInvalid ? "text-rose-950 line-through" : "text-slate-900"
                            }`}
                          >
                            {row.officialDescription}
                          </div>
                          {row.excelDescription &&
                            row.excelDescription.trim() !== row.officialDescription.trim() && (
                              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                  Excel:
                                </span>
                                <span className="truncate">{row.excelDescription}</span>
                              </div>
                            )}
                          {row.observation && (
                            <div className="text-[11px] text-slate-400 italic mt-0.5">
                              Obs: {row.observation}
                            </div>
                          )}
                        </td>

                        {/* Lote */}
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                            {row.lote || "—"}
                          </span>
                        </td>

                        {/* Vencimiento */}
                        <td className="px-2.5 py-2 whitespace-nowrap text-slate-700 font-medium">
                          {row.expirationDate ? formatImmunizationDate(row.expirationDate) : "—"}
                        </td>

                        {/* Saldo */}
                        <td className="px-2.5 py-2 text-right font-black text-slate-900 whitespace-nowrap">
                          {formatImmunizationNumber(row.quantity, 0)}
                          {row.consolidatedCount && row.consolidatedCount > 1 && (
                            <span
                              className="block text-[10px] font-bold text-cyan-700"
                              title={`Sumatoria de ${row.consolidatedCount} filas con misma clave única`}
                            >
                              (x{row.consolidatedCount} filas)
                            </span>
                          )}
                        </td>

                        {/* Precio Unitario */}
                        <td className="px-2.5 py-2 text-right font-mono font-bold text-slate-700 whitespace-nowrap">
                          {formatImmunizationCurrency(row.unitPrice)}
                        </td>

                        {/* Fuente Financiamiento */}
                        <td className="px-2.5 py-2 text-center whitespace-nowrap">
                          <span className="font-bold text-slate-700 text-xs">
                            {row.fundingSource || "—"}
                          </span>
                        </td>

                        {/* Tipo Suministro */}
                        <td className="px-2.5 py-2 text-center whitespace-nowrap">
                          <span className="text-[11px] font-medium text-slate-600 uppercase tracking-tight">
                            {row.supplyType || "—"}
                          </span>
                        </td>

                        {/* Diagnóstico / Validación */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          {isInvalid ? (
                            <div className="space-y-0.5">
                              {row.errors.map((err, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200"
                                >
                                  <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                                  {err}
                                </span>
                              ))}
                            </div>
                          ) : isExisting ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                Ya registrado en Inventario
                              </span>
                              {isConsolidated && (
                                <span className="block text-[10px] font-bold text-cyan-700">
                                  (Consolidada {row.consolidatedCount} filas)
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                Nuevo registro
                              </span>
                              {isConsolidated && (
                                <span className="block text-[10px] font-bold text-cyan-700">
                                  (Consolidada {row.consolidatedCount} filas)
                                </span>
                              )}
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
        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-bold text-slate-800">{counts.selected} seleccionados</span>
            <span>de {counts.total} filas leídas</span>
            <span className="text-slate-400">•</span>
            <span>
              Valor total:{" "}
              <strong className="text-slate-900 font-black">
                {formatImmunizationCurrency(counts.selectedValue)}
              </strong>
            </span>
            {counts.invalid > 0 && (
              <span className="text-rose-600 font-bold">
                ({counts.invalid} filas con errores serán omitidas)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                const selected = rows.filter(r => r.selected && r.status !== "INVALID");
                onConfirmImport(selected, importMode);
              }}
              disabled={counts.selected === 0 || isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-teal-600 hover:bg-teal-700 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando en inventario...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Guardar {counts.selected} {counts.selected === 1 ? "registro" : "registros"} en Inventario
                </>
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
};
