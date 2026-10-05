
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, PackageX } from 'lucide-react';

interface ReportOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (excludeNoSupply: boolean) => void;
  totalItems: number;
}

export const ReportOptionsModal: React.FC<ReportOptionsModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm,
  totalItems
}) => {
  const [excludeNoSupply, setExcludeNoSupply] = useState(false);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
        
        {/* Header */}
        <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-teal-500/20 p-1.5 rounded-lg">
                <FileText className="h-5 w-5 text-teal-400" />
            </div>
            <h3 className="text-lg font-bold">Configurar Reporte PDF</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div className="text-sm text-gray-500">
            Se generará el reporte con los <strong>{totalItems} ítems</strong> del análisis. Las vacunas y la
            Lista de Exclusiones ya se quitaron al ejecutar el análisis.
          </div>

          {/* Las vacunas y la Lista de Exclusiones ya se quitan al ejecutar el análisis: aquí no se
              vuelve a preguntar (pedido del usuario, 2026-10-05). */}
          <div className="space-y-3">
            {/* Option 2: No Supply */}
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${excludeNoSupply ? 'bg-teal-50 border-teal-200 ring-1 ring-teal-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
              <div className="mt-0.5">
                 <input 
                    type="checkbox" 
                    className="w-4 h-4 text-teal-600 rounded border border-gray-300 focus:ring-teal-500"
                    checked={excludeNoSupply}
                    onChange={(e) => setExcludeNoSupply(e.target.checked)}
                 />
              </div>
              <div className="flex-1">
                 <div className="flex items-center gap-2 font-bold text-gray-800 text-sm">
                    <PackageX className="h-4 w-4 text-orange-500" />
                    Excluir Sin Requerimiento
                 </div>
                 <p className="text-xs text-gray-500 mt-1">
                    Oculta ítems donde la cantidad sugerida para requerir es 0 (Cero).
                 </p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
           <button 
             onClick={onClose}
             className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
           >
             Cancelar
           </button>
           <button 
             onClick={() => onConfirm(excludeNoSupply)}
             className="px-4 py-2 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-sm flex items-center gap-2"
           >
             <FileText className="h-4 w-4" />
             Generar PDF
           </button>
        </div>

      </div>
    </div>,
    document.body
  );
};
