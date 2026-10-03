import React from "react";
import { createPortal } from "react-dom";

/**
 * Botón principal flotante del celular (pedido del usuario, 2026-10-03: «en la versión móvil
 * todo botón principal es flotante»). Va abajo a la derecha, sobre la barra de secciones, y
 * solo se ve por debajo de `md`; en escritorio el botón principal sigue en la barra de la tabla.
 *
 * Se monta en `document.body` para que ninguna animación o transformación del módulo lo
 * desplace. El módulo debe dejar espacio abajo (`pb-24` en el celular) para que no tape la
 * última fila.
 */
export const FloatingActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, onClick, disabled }) =>
  createPortal(
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-900/25 transition active:scale-95 hover:bg-teal-700 disabled:opacity-50 md:hidden [&>svg]:h-6 [&>svg]:w-6"
      style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
    >
      {icon}
    </button>,
    document.body,
  );
