import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ResponsiveDialog, dialogPrimaryButton } from "./ui/ResponsiveDialog";

/**
 * Guías de las conexiones de stock (rediseño aprobado el 2026-10-06): cómo compartir la hoja
 * (la vía principal) y cómo crear la Web App de Apps Script (el respaldo).
 */

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <li className="flex gap-3">
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-600 text-[12px] font-black text-white">{n}</span>
    <div className="min-w-0 pt-0.5">
      <p className="text-[14px] font-bold text-slate-900">{title}</p>
      <div className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{children}</div>
    </div>
  </li>
);

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-200">{children}</span>
);

export const ShareSheetGuideDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <ResponsiveDialog
    open={open}
    onClose={onClose}
    title="Compartir la hoja"
    subtitle="Tres pasos en Google Sheets"
    footer={<button type="button" onClick={onClose} className={dialogPrimaryButton}>Entendido</button>}
  >
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <ol className="space-y-4">
        <Step n={1} title="Abrir Compartir">Abra su hoja en Google Sheets y pulse <Key>Compartir</Key>.</Step>
        <Step n={2} title="Acceso general">Elija <Key>Cualquiera con el enlace</Key> y déjelo como <Key>Lector</Key>.</Step>
        <Step n={3} title="Copiar y probar">Pulse <Key>Copiar enlace</Key>, péguelo en el campo y use Probar.</Step>
      </ol>
      <p className="mt-4 text-[12px] text-slate-500">Con «Lector» nadie puede modificar su hoja: solo se lee el stock.</p>
    </div>
  </ResponsiveDialog>
);

export const WebAppGuideDialog: React.FC<{ open: boolean; onClose: () => void; scriptCode: string }> = ({ open, onClose, scriptCode }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scriptCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Cómo crear la Web App"
      subtitle="Solo si la hoja no se puede compartir"
      footer={<button type="button" onClick={onClose} className={dialogPrimaryButton}>Entendido</button>}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <ol className="space-y-4">
            <Step n={1} title="Crear el proyecto">
              Entre a{" "}
              <a href="https://script.google.com" target="_blank" rel="noreferrer" className="font-bold text-teal-700 hover:underline">script.google.com</a>{" "}
              con la cuenta dueña de la hoja, cree un <Key>Nuevo proyecto</Key> y pegue el código de abajo, borrando lo que haya.
            </Step>
            <Step n={2} title="Implementar">Arriba a la derecha: <Key>Implementar</Key> → <Key>Nueva implementación</Key>.</Step>
            <Step n={3} title="Dar acceso">En Tipo elija <Key>Aplicación web</Key>; en Acceso, <Key>Cualquier persona</Key>, y pulse Implementar.</Step>
            <Step n={4} title="Copiar la URL">Copie la URL que termina en <Key>/exec</Key> y péguela en «Web App de Apps Script».</Step>
          </ol>
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
            Al autorizar, Google muestra una advertencia: pulse «Avanzado» e «Ir al proyecto».
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Código para pegar</p>
            <button type="button" onClick={copy} className="flex h-8 items-center gap-1.5 rounded-lg bg-teal-50 px-3 text-[12px] font-bold text-teal-700 transition-colors hover:bg-teal-100">
              {copied ? <><Check className="h-3.5 w-3.5" />Copiado</> : <><Copy className="h-3.5 w-3.5" />Copiar código</>}
            </button>
          </div>
          <pre className="scrollbar-x max-h-64 overflow-auto bg-slate-50 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-600">{scriptCode}</pre>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
