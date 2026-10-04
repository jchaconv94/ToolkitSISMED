import { useEffect, useState } from "react";

/**
 * ¿La pantalla es de escritorio (`md`, 768 px o más)? Para piezas que en el celular cambian de
 * forma y no solo de estilo, como un panel lateral que pasa a panel inferior.
 */
export const useIsDesktop = () => {
  const query = "(min-width: 768px)";
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return Boolean(desktop);
};
