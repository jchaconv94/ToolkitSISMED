import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { clearStoredDevice, shouldForgetDevice, type StoredDevice } from '../services/deviceAccess';

const LARGO = 4;

/**
 * Ingreso con el PIN de 4 dígitos de esta PC.
 *
 * Saluda por el nombre, muestra cuatro casillas y entra solo al completar la cuarta. Si el
 * equipo se bloqueó o ya no está activo, se olvida y se vuelve a la contraseña con el motivo.
 */
export const PinLogin: React.FC<{
  device: StoredDevice;
  /** Volver a usuario y contraseña; `message` explica por qué, si hace falta. */
  onUsePassword: (message?: string) => void;
}> = ({ device, onUsePassword }) => {
  const { loginWithDevice } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // El campo nunca se deshabilita (perdería el foco): mientras verifica es de solo lectura,
  // y al terminar el cursor vuelve a él para el siguiente intento.
  useEffect(() => {
    if (!verifying) inputRef.current?.focus();
  }, [verifying]);

  const verificar = async (valor: string) => {
    setVerifying(true);
    setError('');
    const respuesta = await loginWithDevice(device.id, device.secret, valor);
    if (respuesta.success) return; // App cambia de pantalla.
    setVerifying(false);
    if (respuesta.result && shouldForgetDevice(respuesta.result)) {
      clearStoredDevice();
      onUsePassword(respuesta.message);
      return;
    }
    setError(respuesta.message || 'No se pudo verificar el PIN.');
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
    setPin('');
  };

  const alEscribir = (valor: string) => {
    const limpio = valor.replace(/\D/g, '').slice(0, LARGO);
    setPin(limpio);
    if (error) setError('');
    if (limpio.length === LARGO && !verifying) void verificar(limpio);
  };

  const iniciales = device.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join('');

  return (
    <div className="flex flex-col items-center text-center">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#0E8C80] to-[#0B5F57] text-xl font-extrabold text-white shadow-[0_10px_24px_rgba(11,122,112,0.30)]">
        {iniciales || '?'}
      </span>
      <h2 className="text-[26px] font-extrabold tracking-tight sm:text-[28px]">Hola, {device.displayName}</h2>
      <p className="mt-1.5 text-[15px] font-medium text-[#4E5F5C]">Ingrese su PIN de 4 dígitos.</p>

      {/* Un solo campo invisible encima de las casillas: así funcionan el teclado, pegar y
          los lectores de pantalla, y las casillas solo dibujan. */}
      <div className={`relative mt-7 ${shake ? 'animate-[pin-shake_0.45s]' : ''}`} onClick={() => inputRef.current?.focus()}>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PIN de 4 dígitos"
          maxLength={LARGO}
          value={pin}
          readOnly={verifying}
          onChange={(e) => alEscribir(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
        <div className="flex gap-3" aria-hidden="true">
          {Array.from({ length: LARGO }, (_, i) => {
            const lleno = i < pin.length;
            const actual = i === pin.length && !verifying;
            return (
              <span
                key={i}
                className={`flex h-16 w-14 items-center justify-center rounded-2xl border-[1.5px] transition-all ${
                  error
                    ? 'border-red-500 bg-red-50'
                    : actual
                      ? 'border-teal-600 bg-white ring-4 ring-teal-600/15'
                      : lleno
                        ? 'border-teal-600/40 bg-white'
                        : 'border-[#C4D0CD] bg-[#F3F6F5]'
                }`}
              >
                {lleno && <span className="h-3 w-3 rounded-full bg-[#10201E]" />}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-4 min-h-[22px] text-[13px] font-semibold">
        {verifying ? (
          <span className="inline-flex items-center gap-2 text-teal-700">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
          </span>
        ) : error ? (
          <span role="alert" className="text-red-700">{error}</span>
        ) : null}
      </div>

      <div className="mt-6 flex w-full flex-col items-center gap-1 border-t border-slate-100 pt-5 text-sm">
        <button type="button" onClick={() => onUsePassword()} className="min-h-[40px] font-bold text-teal-700 hover:underline">
          Entrar con contraseña
        </button>
        <button
          type="button"
          onClick={() => { clearStoredDevice(); onUsePassword(); }}
          className="min-h-[40px] font-medium text-[#4E5F5C] hover:text-[#10201E]"
        >
          No soy {device.displayName}
        </button>
      </div>
    </div>
  );
};
