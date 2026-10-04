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

/**
 * Pie de la aplicación, entre el área que se desplaza y la barra de pestañas del celular: para
 * barras de acción de un módulo, como «Cambios sin guardar · Descartar · Guardar». No flota
 * sobre el contenido: el área de desplazamiento se acorta y el final de la lista queda a la
 * vista (pedido del usuario, 2026-10-04). Vacío, no ocupa espacio.
 */
export const MODULE_FOOTER_SLOT_ID = "module-footer-slot";

/** Lleva su contenido al pie de la aplicación. */
export const ModuleFooterPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(MODULE_FOOTER_SLOT_ID)); }, []);
  return slot ? createPortal(children, slot) : null;
};
