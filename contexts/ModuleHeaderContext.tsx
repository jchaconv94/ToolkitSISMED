import React, { createContext, useContext, useEffect, useRef } from "react";

/**
 * Título propio de un módulo en la cabecera del celular.
 *
 * Un módulo con niveles (Consulta Stock: panel regional → UNGET → hoja) pone aquí el
 * nivel en que está. En el celular la cabecera de la app muestra ese título en lugar del
 * nombre del módulo (en escritorio el módulo pinta su propia ruta de migas). En cualquier
 * ancho, la flecha «volver» de la cabecera sube un nivel con `onBack` en vez de salir del
 * módulo: por eso el módulo no lleva flecha propia.
 */
export interface ModuleHeaderOverride {
  title: string;
  /** Línea pequeña sobre el título: el nivel anterior. */
  subtitle?: string;
  onBack?: () => void;
}

const ModuleHeaderContext = createContext<(override: ModuleHeaderOverride | null) => void>(() => {});

export const ModuleHeaderProvider = ModuleHeaderContext.Provider;

/** Publica el título del nivel actual; `null` devuelve la cabecera al nombre del módulo. */
export const useModuleHeaderOverride = (override: ModuleHeaderOverride | null) => {
  const setOverride = useContext(ModuleHeaderContext);
  // La función de volver cambia en cada render; se guarda aparte para no republicar sin fin.
  const onBack = useRef(override?.onBack);
  onBack.current = override?.onBack;
  const hasBack = Boolean(override?.onBack);

  useEffect(() => {
    setOverride(
      override
        ? { title: override.title, subtitle: override.subtitle, onBack: hasBack ? () => onBack.current?.() : undefined }
        : null,
    );
  }, [setOverride, override?.title, override?.subtitle, hasBack]);

  useEffect(() => () => setOverride(null), [setOverride]);
};
