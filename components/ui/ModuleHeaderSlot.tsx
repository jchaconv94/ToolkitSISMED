import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Hueco de la cabecera de la aplicación, a la derecha del título, para acciones del módulo. */
export const MODULE_HEADER_SLOT_ID = "module-header-slot";

/** Lleva su contenido a la cabecera de la aplicación. */
export const ModuleHeaderPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(MODULE_HEADER_SLOT_ID)); }, []);
  return slot ? createPortal(children, slot) : null;
};
