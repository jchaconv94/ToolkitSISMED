import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Fingerprint, KeyRound, Loader2, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  clearStoredDevice,
  deviceNameFrom,
  isDesktopPointer,
  isValidPin,
  newDeviceSecret,
  createFingerprintCredential,
  fingerprintAvailable,
  wasCancelled,
  readStoredDevice,
  saveStoredDevice,
  type DeviceInfo,
} from '../services/deviceAccess';
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from './ui/ResponsiveDialog';
import { ConfirmationDialog } from './ui/ConfirmationDialog';
import { formatDate } from './ui/kit';

/** Campo de PIN: 4 dígitos, oculto, solo números. */
const PinField: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }> = ({ id, label, value, onChange, autoFocus }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-bold text-slate-800">{label}</label>
    <input
      id={id}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={4}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      placeholder="••••"
      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-center font-mono text-2xl tracking-[0.6em] outline-none transition-all focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
    />
  </div>
);

/**
 * «Acceso rápido» del Perfil: crear el PIN de esta PC y ver o quitar los equipos activados.
 * No se muestra si el SQL (`SUPABASE_INGRESO_PIN_HUELLA.sql`) todavía no se ejecutó.
 * Con `embedded` se dibuja sin tarjeta propia, como una parte del bloque «Cuenta y seguridad».
 */
export const QuickAccessCard: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<DeviceInfo[] | null | undefined>(undefined);
  const [local, setLocal] = useState(() => readStoredDevice());
  const [creating, setCreating] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [toRemove, setToRemove] = useState<DeviceInfo | null>(null);
  const [removing, setRemoving] = useState(false);
  const desktop = isDesktopPointer();
  // En el celular solo se ofrece la huella si el teléfono tiene un lector que el navegador pueda usar.
  const [hasReader, setHasReader] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  useEffect(() => {
    if (!desktop) void fingerprintAvailable().then(setHasReader);
  }, [desktop]);

  const load = useCallback(async () => {
    try {
      const lista = await api.listDevices();
      setDevices(lista);
      // Si el equipo guardado aquí ya no existe en el servidor, se olvida.
      const guardado = readStoredDevice();
      if (lista && guardado && guardado.username === user?.username && !lista.some((d) => d.id === guardado.id)) {
        clearStoredDevice();
        setLocal(null);
      }
    } catch {
      setDevices(null);
    }
  }, [user?.username]);

  useEffect(() => { void load(); }, [load]);

  if (!user || devices === null || devices === undefined) return null;

  const pinHere = local?.kind === 'pin' && local.username === user.username ? local : null;
  const fingerprintHere = local?.kind === 'huella' && local.username === user.username ? local : null;

  // «JORDAN» → «Jordan»: el saludo del login va en tipo título.
  const nombreParaSaludo = () => {
    const primerNombre = user.personnelData?.firstName?.trim().split(/\s+/)[0] || '';
    return primerNombre ? primerNombre.charAt(0).toLocaleUpperCase('es') + primerNombre.slice(1).toLocaleLowerCase('es') : user.username;
  };

  const activarHuella = async () => {
    setEnrolling(true);
    try {
      const displayName = nombreParaSaludo();
      let credentialId: string;
      try {
        credentialId = await createFingerprintCredential(user.username, displayName);
      } catch (e) {
        if (wasCancelled(e)) return;
        // Los errores del lector llegan en inglés y en jerga técnica.
        throw new Error('No se pudo registrar la huella en este celular. Revise que tenga una huella configurada en el teléfono.');
      }
      const secret = newDeviceSecret();
      const id = await api.registerDevice('huella', deviceNameFrom(navigator.userAgent), secret, null);
      const nuevo = { id, secret, kind: 'huella' as const, username: user.username, displayName, credentialId };
      saveStoredDevice(nuevo);
      setLocal(nuevo);
      toast.success('Huella activada. La próxima vez podrá entrar con ella en este celular.');
      await load();
    } catch (e: any) {
      if (!wasCancelled(e)) toast.error(e?.message || 'No se pudo activar la huella.');
    } finally {
      setEnrolling(false);
    }
  };

  const crear = async () => {
    setFormError('');
    if (!isValidPin(pin)) return setFormError('El PIN debe tener 4 dígitos.');
    if (pin !== confirm) return setFormError('Los dos PIN no coinciden.');
    setSaving(true);
    try {
      const secret = newDeviceSecret();
      const id = await api.registerDevice('pin', deviceNameFrom(navigator.userAgent), secret, pin);
      const displayName = nombreParaSaludo();
      const nuevo = { id, secret, kind: 'pin' as const, username: user.username, displayName };
      saveStoredDevice(nuevo);
      setLocal(nuevo);
      setCreating(false);
      if (embedded) setListOpen(true);
      setPin('');
      setConfirm('');
      toast.success('PIN creado. La próxima vez podrá entrar con él en esta PC.');
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'No se pudo crear el PIN.');
    } finally {
      setSaving(false);
    }
  };

  const quitar = async () => {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await api.removeDevice(toRemove.id);
      if (local?.id === toRemove.id) {
        clearStoredDevice();
        setLocal(null);
      }
      toast.success('Equipo quitado.');
      setToRemove(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo quitar el equipo.');
    } finally {
      setRemoving(false);
    }
  };

  const openCreate = () => { setFormError(''); setListOpen(false); setCreating(true); };
  const closeCreate = () => { setCreating(false); if (embedded) setListOpen(true); };

  const body = (
    <>
      {desktop && (
        pinHere ? (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
              <Monitor className="h-5 w-5 shrink-0 text-emerald-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-emerald-900">PIN activo en esta PC</p>
                <p className="text-xs text-emerald-800">Al entrar se le pedirá su PIN de 4 dígitos.</p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={openCreate}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors ${embedded ? 'mb-3 h-11 border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' : 'mb-4 bg-teal-600 py-2.5 text-white shadow-sm hover:bg-teal-700'}`}
            >
              <KeyRound className="h-4 w-4" />
              Crear PIN para esta PC
            </button>
          )
        )}

        {!desktop && hasReader && (
          fingerprintHere ? (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
              <Fingerprint className="h-5 w-5 shrink-0 text-emerald-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-emerald-900">Huella activa en este celular</p>
                <p className="text-xs text-emerald-800">Al entrar podrá usar su huella.</p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void activarHuella()}
              disabled={enrolling}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors disabled:opacity-60 ${embedded ? 'mb-3 h-11 border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' : 'mb-4 bg-teal-600 py-2.5 text-white shadow-sm hover:bg-teal-700'}`}
            >
              {enrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              Activar huella en este celular
            </button>
          )
        )}

        {devices.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                {d.kind === 'pin' ? <Monitor className="h-4 w-4 shrink-0 text-slate-400" /> : <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-800">
                    {d.deviceName || (d.kind === 'pin' ? 'PC' : 'Celular')}
                    {local?.id === d.id && <span className="ml-1.5 text-[11px] font-bold text-teal-700">· este equipo</span>}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {d.kind === 'pin' ? 'PIN' : 'Huella'}
                    {d.locked ? ' · bloqueado' : d.lastUsedAt ? ` · usado el ${formatDate(d.lastUsedAt)}` : ` · creado el ${formatDate(d.createdAt)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setToRemove(d)}
                  aria-label="Quitar equipo"
                  title="Quitar equipo"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs italic text-slate-400">Todavía no activó el acceso rápido en ningún equipo.</p>
        )}
    </>
  );

  // Resumen para la fila del Perfil: qué hay en este equipo y cuántos equipos en total.
  const here = pinHere ? 'PIN activo en esta PC' : fingerprintHere ? 'Huella activa en este celular' : '';
  const count = devices.length === 0 ? 'Sin equipos activados' : `${devices.length} ${devices.length === 1 ? 'equipo activado' : 'equipos activados'}`;

  return (
    <div className={embedded ? '' : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm 2xl:p-6'}>
      {embedded ? (
        <button type="button" onClick={() => setListOpen(true)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 md:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><KeyRound className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">Acceso rápido (PIN o huella)</p>
            <p className="truncate text-[14px] font-bold text-teal-700">{here ? `${here} · ${count}` : count}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
        </button>
      ) : (
        <>
          <h3 className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-teal-600 2xl:text-xs">
            <KeyRound className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
            Acceso rápido
          </h3>
          <p className="mb-4 text-xs text-slate-500">Entre sin escribir su contraseña en sus equipos de confianza.</p>
        </>
      )}

      {embedded ? null : body}

      {embedded && (
        <ResponsiveDialog
          open={listOpen}
          title="Acceso rápido"
          onClose={() => setListOpen(false)}
          footer={<button type="button" onClick={() => setListOpen(false)} className={`${dialogSecondaryButton} md:ml-auto`}>Cerrar</button>}
        >
          <p className="mb-3 text-[13px] text-slate-600">Entre sin escribir su contraseña en sus equipos de confianza: PIN en la PC, huella en el celular.</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">{body}</div>
        </ResponsiveDialog>
      )}

      <ResponsiveDialog
        open={creating}
        title="Crear PIN para esta PC"
        onClose={closeCreate}
        busy={saving}
        onSubmit={(e) => { e.preventDefault(); void crear(); }}
        footer={
          <>
            <button type="button" onClick={closeCreate} disabled={saving} className={dialogSecondaryButton}>Cancelar</button>
            <button type="submit" disabled={saving} className={dialogPrimaryButton}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear PIN
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">
            Elija 4 dígitos. Solo servirán en esta PC y su contraseña no se guarda en ella.
            Tras 5 intentos fallidos el PIN se bloquea.
          </p>
          <PinField id="pin-nuevo" label="PIN" value={pin} onChange={setPin} autoFocus />
          <PinField id="pin-confirmar" label="Repita el PIN" value={confirm} onChange={setConfirm} />
          {formError && <p role="alert" className="text-sm font-semibold text-red-700">{formError}</p>}
        </div>
      </ResponsiveDialog>

      <ConfirmationDialog
        isOpen={Boolean(toRemove)}
        title="Quitar equipo"
        description={`«${toRemove?.deviceName || 'Este equipo'}» ya no podrá entrar sin contraseña.`}
        confirmLabel="Quitar"
        tone="danger"
        isConfirming={removing}
        onConfirm={() => void quitar()}
        onCancel={() => setToRemove(null)}
      />
    </div>
  );
};
