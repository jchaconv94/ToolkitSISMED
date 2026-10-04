import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  clearStoredDevice,
  deviceNameFrom,
  isDesktopPointer,
  isValidPin,
  newDeviceSecret,
  readStoredDevice,
  saveStoredDevice,
  type DeviceInfo,
} from '../services/deviceAccess';
import { BottomSheet } from './ui/BottomSheet';
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
 */
export const QuickAccessCard: React.FC = () => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<DeviceInfo[] | null | undefined>(undefined);
  const [local, setLocal] = useState(() => readStoredDevice());
  const [creating, setCreating] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [toRemove, setToRemove] = useState<DeviceInfo | null>(null);
  const [removing, setRemoving] = useState(false);
  const desktop = isDesktopPointer();

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

  const crear = async () => {
    setFormError('');
    if (!isValidPin(pin)) return setFormError('El PIN debe tener 4 dígitos.');
    if (pin !== confirm) return setFormError('Los dos PIN no coinciden.');
    setSaving(true);
    try {
      const secret = newDeviceSecret();
      const id = await api.registerDevice('pin', deviceNameFrom(navigator.userAgent), secret, pin);
      // «JORDAN» → «Jordan»: el saludo del login va en tipo título.
      const primerNombre = user.personnelData?.firstName?.trim().split(/\s+/)[0] || '';
      const displayName = primerNombre ? primerNombre.charAt(0).toLocaleUpperCase('es') + primerNombre.slice(1).toLocaleLowerCase('es') : user.username;
      const nuevo = { id, secret, kind: 'pin' as const, username: user.username, displayName };
      saveStoredDevice(nuevo);
      setLocal(nuevo);
      setCreating(false);
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

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm 2xl:p-6">
      <h3 className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-teal-600 2xl:text-xs">
        <KeyRound className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
        Acceso rápido
      </h3>
      <p className="mb-4 text-xs text-slate-500">Entre sin escribir su contraseña en sus equipos de confianza.</p>

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
            onClick={() => { setCreating(true); setFormError(''); }}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-700"
          >
            <KeyRound className="h-4 w-4" />
            Crear PIN para esta PC
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
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-red-200 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-slate-400">Todavía no activó el acceso rápido en ningún equipo.</p>
      )}

      <BottomSheet open={creating} title="Crear PIN para esta PC" onClose={() => !saving && setCreating(false)} centeredOnDesktop>
        <form
          onSubmit={(e) => { e.preventDefault(); void crear(); }}
          className="flex flex-col gap-4 pb-2"
        >
          <p className="text-sm text-slate-600">
            Elija 4 dígitos. Solo servirán en esta PC y su contraseña no se guarda en ella.
            Tras 5 intentos fallidos el PIN se bloquea.
          </p>
          <PinField id="pin-nuevo" label="PIN" value={pin} onChange={setPin} autoFocus />
          <PinField id="pin-confirmar" label="Repita el PIN" value={confirm} onChange={setConfirm} />
          {formError && <p role="alert" className="text-sm font-semibold text-red-700">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear PIN
          </button>
        </form>
      </BottomSheet>

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
