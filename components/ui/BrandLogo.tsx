import React from "react";

/**
 * Marca de Toolkit SISMED (2026-10-03).
 *
 * El símbolo son cuatro piezas que forman un kit: cada herramienta del Toolkit es una
 * pieza y la cruz naranja es la farmacia. Sobre fondo oscuro la pieza de abajo a la
 * izquierda es blanca; sobre fondo claro pasa a azul oscuro para no desaparecer.
 *
 * El nombre va en Work Sans (se carga en index.html): «Toolkit» en 600 y «SISMED» en 800.
 * El mismo dibujo está en public/favicon.svg; si cambias uno, cambia el otro.
 */

export const BRAND_COLORS = {
  teal: "#2bb3a0",
  tealLight: "#5fd0be",
  navy: "#0f2233",
  orange: "#f28c28",
} as const;

type Tone = "dark" | "light";

/**
 * Animaciones del símbolo (estilos en index.css; la de arranque, en index.html):
 * - `hover`: al pasar el mouse, las piezas dan un salto escalonado y la cruz gira.
 * - `loop`: las piezas aparecen una tras otra y se repiten mientras algo carga.
 * Sin animación si el sistema pide reducir el movimiento.
 */
export type BrandMarkAnimation = "none" | "hover" | "loop";

export const BrandMark: React.FC<{ size?: number; tone?: Tone; className?: string; animation?: BrandMarkAnimation }> = ({ size = 32, tone = "dark", className = "", animation = "none" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    className={`${animation === "none" ? "" : `brand-mark brand-mark--${animation}`} ${className}`}
    role="img"
    aria-label="Toolkit SISMED"
  >
    <rect className="bm-piece bm-1" x="3" y="3" width="26" height="26" rx="7" fill={BRAND_COLORS.teal} />
    <rect className="bm-piece bm-2" x="35" y="3" width="26" height="26" rx="7" fill={BRAND_COLORS.tealLight} />
    <rect className="bm-piece bm-3" x="3" y="35" width="26" height="26" rx="7" fill={tone === "dark" ? "#ffffff" : BRAND_COLORS.navy} />
    <g className="bm-piece bm-4" fill={BRAND_COLORS.orange}>
      <rect x="43.25" y="35" width="9.5" height="26" rx="3.5" />
      <rect x="35" y="43.25" width="26" height="9.5" rx="3.5" />
    </g>
  </svg>
);

/** El nombre solo. `size` es el tamaño de letra en píxeles. */
export const BrandWordmark: React.FC<{ size?: number; tone?: Tone; className?: string }> = ({ size = 18, tone = "dark", className = "" }) => (
  <span
    className={`whitespace-nowrap leading-none ${className}`}
    style={{ fontFamily: "'Work Sans', 'Inter', sans-serif", fontSize: size, letterSpacing: "-0.015em" }}
  >
    <span style={{ fontWeight: 600, color: tone === "dark" ? "#ffffff" : "#0f172a" }}>Toolkit </span>
    <span style={{ fontWeight: 800, color: tone === "dark" ? BRAND_COLORS.tealLight : BRAND_COLORS.teal }}>SISMED</span>
  </span>
);

/**
 * Símbolo + nombre, con la proporción de la referencia aprobada: el símbolo mide unas
 * 1,3 veces el tamaño de letra (≈ 1,7 veces la altura de las mayúsculas).
 */
export const BrandLogo: React.FC<{ size?: number; tone?: Tone; showName?: boolean; className?: string; animation?: BrandMarkAnimation }> = ({
  size = 18,
  tone = "dark",
  showName = true,
  className = "",
  animation = "none",
}) => (
  <span className={`inline-flex items-center ${className}`} style={{ gap: size * 0.45 }}>
    <BrandMark size={Math.round(size * 1.3)} tone={tone} className="shrink-0" animation={animation} />
    {showName && <BrandWordmark size={size} tone={tone} />}
  </span>
);

/**
 * Pantalla de carga a pantalla completa: el fondo azul con el logo armándose. Continúa la de
 * arranque de index.html mientras la app termina de preparar la sesión, para que no aparezca
 * un círculo de carga sobre blanco entre las dos.
 */
export const BrandBootScreen: React.FC = () => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f2233]" role="status" aria-label="Cargando">
    <BrandMark size={96} tone="dark" animation="loop" />
  </div>
);
