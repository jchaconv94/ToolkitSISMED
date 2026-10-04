import React, { useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { clearStoredDevice, shouldForgetDevice, verifyFingerprint, wasCancelled, type StoredDevice } from '../services/deviceAccess';

/**
 * Ingreso con la huella del celular.
 *
 * Saluda por el nombre y, al tocar el botón, el teléfono pide la huella. Si el lector la
 * acepta, se manda la llave del equipo a Supabase (`app_device_login`). La huella nunca
 * sale del teléfono.
 */
export const FingerprintLogin: React.FC<{
  device: StoredDevice;
  onUsePassword: (message?: string) => void;
}> = ({ device, onUsePassword }) => {
  const { loginWithDevice } = useAuth();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const entrar = async () => {
    if (working || !device.credentialId) return;
    setWorking(true);
    setError('');
    try {
      await verifyFingerprint(device.credentialId);
    } catch (e) {
      setWorking(false);
      setError(wasCancelled(e) ? '' : 'No se pudo leer la huella. Intente de nuevo o entre con su contraseña.');
      return;
    }
    const respuesta = await loginWithDevice(device.id, device.secret, null);
    if (respuesta.success) return; // App cambia de pantalla.
    setWorking(false);
    if (respuesta.result && shouldForgetDevice(respuesta.result)) {
      clearStoredDevice();
      onUsePassword(respuesta.message);
      return;
    }
    setError(respuesta.message || 'No se pudo entrar con la huella.');
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
      <h2 className="text-[26px] font-extrabold tracking-tight">Hola, {device.displayName}</h2>
      <p className="mt-1.5 text-[15px] font-medium text-[#4E5F5C]">Toque el botón y ponga su dedo en el lector.</p>

      <button
        type="button"
        onClick={() => void entrar()}
        disabled={working}
        aria-label="Entrar con huella"
        className="group relative mt-7 flex h-24 w-24 items-center justify-center rounded-full border-[1.5px] border-teal-600/30 bg-teal-50 text-teal-700 transition-all active:scale-95 disabled:opacity-80"
      >
        {/* Halo que late mientras espera el toque. */}
        {!working && <span className="absolute inset-0 animate-ping rounded-full bg-teal-500/15" />}
        {working ? <Loader2 className="h-10 w-10 animate-spin" /> : <Fingerprint className="relative h-12 w-12" strokeWidth={1.6} />}
      </button>
      <span className="mt-3 text-sm font-bold text-teal-700">{working ? 'Verificando…' : 'Entrar con huella'}</span>

      <div className="mt-3 min-h-[22px] text-[13px] font-semibold">
        {error && <span role="alert" className="text-red-700">{error}</span>}
      </div>

      <div className="mt-4 flex w-full flex-col items-center gap-1 border-t border-slate-100 pt-5 text-sm">
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
