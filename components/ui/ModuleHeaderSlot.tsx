import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Hueco de la cabecera de la aplicación, a la derecha del título, para acciones del módulo. */
export const MODULE_HEADER_SLOT_ID = "module-header-slot";

/** Módulos que ponen algo en ese hueco: en el celular ocupa el lugar del nombre del establecimiento. */
export const MODULES_WITH_HEADER_ACTIONS = new Set<string>(["ADMIN_SEND_KEYS"]);

/** Lleva su contenido a la cabecera de la aplicación. */
export const ModuleHeaderPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(MODULE_HEADER_SLOT_ID)); }, []);
  return slot ? createPortal(children, slot) : null;
};
