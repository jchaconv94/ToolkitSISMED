import React, { useRef, useState } from "react";
import { toPng, toBlob } from "html-to-image";
import {
  Camera,
  Download,
  Copy,
  Check,
  X,
  Building2,
  AlertTriangle,
  Info,
  Calendar,
  Layers,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  EstablishmentCard,
  EstablishmentCardData,
} from "./EstablishmentCard";

export interface SelectedEstablishmentData extends EstablishmentCardData {
  type?: string;
  syncStatusLabel?: string;
  syncStatusColor?: string;
  isMismatchEquipmentDate?: boolean;
}

interface DeficiencyCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  ungetName: string;
  selectedItems: SelectedEstablishmentData[];
  onRemoveItem?: (id: string) => void;
}

export const DeficiencyCaptureModal: React.FC<DeficiencyCaptureModalProps> = ({
  isOpen,
  onClose,
  ungetName,
  selectedItems,
}) => {
  const printRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [includeBanner, setIncludeBanner] = useState(true);
  const [columns, setColumns] = useState<number>(3);
  const [zoomLevel, setZoomLevel] = useState<number>(0.75);

  if (!isOpen) return null;

  const now = new Date();
  const formattedNowDate = now.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const getCaptureOptions = () => {
    return {
      quality: 0.98,
      pixelRatio: 2, // 2x scale for ultra crisp HD rendering
      backgroundColor: "#ffffff",
      cacheBust: true,
      skipFonts: true, // Prevents CORS delay and renders with native system font engine
      style: {
        transform: "none",
        margin: "0",
      },
      filter: (node: HTMLElement) => {
        return !node.classList?.contains("capture-ignore");
      },
    };
  };

  const handleDownload = async () => {
    if (!printRef.current) return;
    setIsGenerating(true);
    const toastId = toast.loading("Generando imagen HD en 3 Columnas...");

    try {
      // Small pause to allow styles to settle
      await new Promise((res) => setTimeout(res, 150));

      const dataUrl = await toPng(printRef.current, getCaptureOptions());
      
      const link = document.createElement("a");
      const cleanUnget = (ungetName || "RED").replace(/[^a-zA-Z0-9]/g, "_");
      const timeStamp = now.toISOString().slice(0, 10);
      link.download = `Reporte_Establecimientos_${cleanUnget}_${timeStamp}.png`;
      link.href = dataUrl;
      link.click();

      toast.success("Imagen A4 descargada exitosamente sin distorsión", { id: toastId });
    } catch (err) {
      console.error("Error downloading image:", err);
      toast.error("Error al generar la imagen. Inténtelo de nuevo.", { id: toastId });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyToClipboard = async () => {
    if (!printRef.current) return;
    setIsGenerating(true);
    const toastId = toast.loading("Copiando imagen en alta resolución...");

    try {
      await new Promise((res) => setTimeout(res, 150));

      const blob = await toBlob(printRef.current, getCaptureOptions());
      if (!blob) {
        throw new Error("No se pudo generar el blob de la imagen");
      }

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({ "image/png": blob }),
        ]);
        setCopied(true);
        toast.success("¡Imagen copiada al portapapeles! Lista para pegar en WhatsApp (Ctrl + V)", { id: toastId });
        setTimeout(() => setCopied(false), 3000);
      } else {
        // Fallback to download if ClipboardItem is not supported
        const dataUrl = await toPng(printRef.current, getCaptureOptions());
        const link = document.createElement("a");
        link.download = `Reporte_Establecimientos_${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
        toast.info("Portapapeles no soportado directamente; se descargó el archivo PNG", { id: toastId });
      }
    } catch (err) {
      console.error("Error copying to clipboard:", err);
      // Fallback
      try {
        await handleDownload();
      } catch {
        toast.error("Error al procesar la imagen para copiar", { id: toastId });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-7xl max-h-[96vh] rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col border border-slate-200 overflow-hidden">
        {/* Header Modal */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 bg-slate-50/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 text-white flex items-center justify-center shadow-sm shrink-0">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-black text-slate-800 tracking-tight">
                  Exportar Hoja A4 de Establecimientos
                </h3>
                <span className="bg-rose-100 text-rose-800 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-rose-200">
                  {selectedItems.length} {selectedItems.length === 1 ? "recuadro" : "recuadros"}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Reporte de establecimientos con stock desactualizado
              </p>
            </div>
          </div>

          {/* Controls Toolbar */}
          <div className="flex items-center flex-wrap gap-2.5">
            {/* Column Selector */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-3xs">
              <span className="text-[10.5px] font-bold text-slate-400 px-2 flex items-center gap-1">
                <LayoutGrid className="h-3.5 w-3.5 text-slate-400" />
                Columnas:
              </span>
              <button
                type="button"
                onClick={() => setColumns(3)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  columns === 3
                    ? "bg-teal-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                title="Diseño estándar A4 de 3 Columnas"
              >
                3 (A4)
              </button>
              <button
                type="button"
                onClick={() => setColumns(2)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  columns === 2
                    ? "bg-teal-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                2
              </button>
              <button
                type="button"
                onClick={() => setColumns(1)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  columns === 1
                    ? "bg-teal-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                1
              </button>
            </div>

            {/* Toggle header banner */}
            <button
              type="button"
              onClick={() => setIncludeBanner(!includeBanner)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-3xs ${
                includeBanner
                  ? "bg-slate-800 text-white border-slate-700 shadow-xs"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
              title="Incluir o quitar el membrete institucional en la hoja"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Membrete: {includeBanner ? "Sí" : "No"}</span>
            </button>

            {/* Zoom Controls */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-3xs">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
                className="p-1 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                title="Alejar vista previa"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] font-extrabold text-slate-600 px-1.5 min-w-[38px] text-center">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(1.2, Number((z + 0.15).toFixed(2))))}
                className="p-1 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                title="Acercar vista previa"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(0.75)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                title="Restablecer zoom al 75%"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>

            <div className="h-5 w-px bg-slate-200 hidden sm:block mx-0.5" />

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              title="Cerrar modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Container with Capture Canvas Target */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-6 bg-slate-200/80 flex items-start justify-center">
          {selectedItems.length === 0 ? (
            <div className="py-20 text-center bg-white rounded-2xl border border-slate-200 p-8 max-w-md mx-auto shadow-sm my-auto">
              <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h4 className="text-base font-bold text-slate-800">No hay recuadros seleccionados</h4>
              <p className="text-xs text-slate-500 mt-1.5">
                Cierre esta ventana y haga clic sobre los recuadros de los establecimientos que desea incluir en la hoja A4.
              </p>
              <button
                onClick={onClose}
                className="mt-4 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all"
              >
                Volver a la selección
              </button>
            </div>
          ) : (
            <div
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: "top center",
                transition: "transform 0.15s ease-out",
                marginBottom: `${Math.max(0, (1 - zoomLevel) * -120)}px`,
              }}
              className="shadow-2xl rounded-2xl border border-slate-300 bg-white"
            >
              {/* THE EXACT A4 CANVAS CONTAINER TO BE CAPTURED BY HTML2CANVAS */}
              <div
                ref={printRef}
                id="establishment-a4-capture-canvas"
                className="bg-white text-slate-900 flex flex-col gap-6"
                style={{
                  width: "1160px",
                  minWidth: "1160px",
                  maxWidth: "1160px",
                  padding: "32px",
                  boxSizing: "border-box",
                  backgroundColor: "#ffffff",
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                  WebkitFontSmoothing: "antialiased",
                }}
              >
                {/* Optional Header Banner for Official Identification */}
                {includeBanner && (
                  <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-teal-950 text-white px-6 py-5 rounded-2xl shadow-md flex items-center justify-between gap-6 border border-slate-700/50">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div className="w-12 h-12 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center shrink-0 shadow-inner">
                        <Building2 className="h-6 w-6 text-teal-300" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5 leading-none">
                          <span className="inline-block whitespace-nowrap text-[10.5px] font-black uppercase tracking-wider text-teal-300 bg-teal-950/90 px-2.5 py-1 rounded-md border border-teal-500/40 leading-none">
                            DIRESA SAN MARTÍN
                          </span>
                          <span className="inline-block whitespace-nowrap text-[10.5px] font-bold text-slate-300 uppercase tracking-wider leading-none">
                            • MONITOREO SISMED
                          </span>
                        </div>
                        <h2 className="text-xl font-black tracking-tight text-white m-0 leading-tight truncate">
                          Estado de Establecimientos — {ungetName || "RED ASIGNADA"}
                        </h2>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 text-right bg-black/30 px-4 py-2.5 rounded-xl border border-white/10 shrink-0 whitespace-nowrap">
                      <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap">
                        Fecha y Hora de Emisión
                      </span>
                      <span className="text-xs font-black text-white flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                        {formattedNowDate}
                      </span>
                      <span className="text-[10.5px] font-bold text-teal-300 whitespace-nowrap">
                        {selectedItems.length} {selectedItems.length === 1 ? "Establecimiento" : "Establecimientos"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Grid of Exact Establishment Cards in strict 3 columns */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: "16px",
                    width: "100%",
                    alignItems: "stretch",
                  }}
                >
                  {selectedItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        minWidth: 0,
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <EstablishmentCard
                        data={item}
                        isStaticPreview={true}
                        className="h-full shadow-xs"
                      />
                    </div>
                  ))}
                </div>

                {/* Subtle Footer Note */}
                <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                  <span>ToolKit SISMED Web • DIRESA San Martín</span>
                  <span>Evidencia técnica de monitoreo y sincronización de stock</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-slate-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-medium flex items-center gap-2">
            <Info className="h-4 w-4 text-teal-600 shrink-0" />
            <span>
              Haga clic en <strong>Copiar (WhatsApp)</strong> para enviar la hoja A4 de 3 columnas directo por chat con Ctrl + V.
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all"
            >
              Cerrar
            </button>
            <button
              onClick={handleCopyToClipboard}
              disabled={isGenerating || selectedItems.length === 0}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copied ? "¡Copiado!" : "Copiar (WhatsApp)"}</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={isGenerating || selectedItems.length === 0}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>Descargar PNG (A4)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
