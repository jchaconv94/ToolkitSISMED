import { useEffect, useState } from "react";

/**
 * «Instalar app» (paso 6 de la reestructuración, 2026-10-03).
 *
 * Chrome y Edge (Android y PC) avisan con `beforeinstallprompt` cuando la app se puede
 * instalar; se guarda ese aviso para lanzarlo desde el menú del usuario. Safari (iPhone y
 * iPad) no tiene ese aviso: allí se instala desde Compartir → «Agregar a inicio», así que
 * se muestran esas instrucciones.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// Se escucha desde que carga el módulo: el aviso puede llegar antes de que exista el menú.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** Ya abierta como app instalada (sin barra del navegador). */
export const isStandaloneDisplay = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/** iPhone o iPad (también el iPad que se presenta como Mac). */
export const isAppleMobile = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
};

export const useInstallApp = () => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const standalone = isStandaloneDisplay();
  const ios = isAppleMobile();
  return {
    /** Hay que mostrar «Instalar app»: el navegador lo ofrece, o es iPhone/iPad sin instalar. */
    available: !standalone && (Boolean(deferred) || ios),
    /** En iPhone/iPad se explica cómo; en el resto se lanza la ventana del navegador. */
    needsInstructions: !deferred && ios,
    install: async (): Promise<boolean> => {
      if (!deferred) return false;
      const event = deferred;
      await event.prompt();
      const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
      deferred = null;
      notify();
      return choice.outcome === "accepted";
    },
  };
};
