import React, { useEffect, useState } from 'react';
import {
  AtSign,
  Briefcase,
  Building2,
  Cake,
  ChevronRight,
  GraduationCap,
  IdCard,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { userFullName, userInitials } from '../services/sessionDisplay';
import { QuickAccessCard } from './QuickAccessCard';
import { useRoleLabel } from './UserMenu';
import { CustomSelect } from './ui/CustomSelect';
import { FloatingActionButton } from './ui/FloatingActionButton';
import { FormField, formatDate, inputClass } from './ui/kit';
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from './ui/ResponsiveDialog';
import { useIsDesktop } from './ui/useIsDesktop';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bloque blanco del Perfil: título y filas. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <p className="border-b border-slate-100 px-4 py-3 text-[13px] font-black text-slate-900 md:px-5">{title}</p>
    <div className="flex-1 divide-y divide-slate-100">{children}</div>
  </div>
);

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode; mono?: boolean; onClick?: () => void }> = ({ icon, label, children, mono, onClick }) => {
  const body = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <div className={`break-words text-[15px] font-semibold text-slate-900 ${mono ? 'font-mono' : ''}`}>{children}</div>
      </div>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 md:px-5">{body}</button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3 md:px-5">{body}</div>
  );
};

const Empty: React.FC<{ text?: string }> = ({ text = 'No registrado' }) => <span className="font-normal text-slate-400">{text}</span>;

/** Fondo de la portada del celular: oscuro con dos círculos teal. */
const Cover: React.FC<{ className: string }> = ({ className }) => (
  <div aria-hidden="true" className={`relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950 ${className}`}>
    <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-teal-500/10" />
    <div className="absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-teal-400/10" />
  </div>
);

/** Grupo de campos de la ventana «Editar datos». */
const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">{title}</p>
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">{children}</div>
  </div>
);

type ProfileForm = {
  firstName: string;
  lastName: string;
  dni: string;
  birthDate: string;
  username: string;
  phone: string;
  email: string;
  laborRegimeId: string;
  professionId: string;
};

export const UserProfile: React.FC = () => {
  const { user, updateUserContext, refreshUserData } = useAuth();
  const isDesktop = useIsDesktop();
  const roleLabel = useRoleLabel(user);

  const [diresas, setDiresas] = useState<any[]>([]);
  const [ogess, setOgess] = useState<any[]>([]);
  const [ungets, setUngets] = useState<any[]>([]);
  const [microredes, setMicroredes] = useState<any[]>([]);
  const [laborRegimes, setLaborRegimes] = useState<any[]>([]);
  const [professions, setProfessions] = useState<any[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState({ next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getDiresas(), api.getOgess(), api.getUngets(), api.getMicroredes(), api.getLaborRegimes(), api.getProfessions()])
      .then(([d, o, u, m, r, p]) => {
        setDiresas(d || []);
        setOgess(o || []);
        setUngets(u || []);
        setMicroredes(m || []);
        setLaborRegimes(r || []);
        setProfessions(p || []);
      })
      .catch((e) => console.warn('Error loading organization catalogs', e));
  }, []);

  // Al abrir el Perfil se leen los datos vigentes de la base (pudo cambiarlos un administrador).
  useEffect(() => { void refreshUserData(); }, []);

  if (!user || !user.personnelData) return null;
  const p = user.personnelData;
  const f = user.facilityData;

  const nameOf = (list: any[], id?: string) => (id ? list.find((x) => x.id === id)?.name : undefined);
  const jurisdiction = [
    nameOf(microredes, p.microredId || f?.microredId),
    nameOf(ungets, p.ungetId || f?.ungetId),
    nameOf(ogess, p.ogessId || f?.ogessId),
    nameOf(diresas, p.diresaId || f?.diresaId),
  ].filter(Boolean).join(' · ');
  const facilityText = f?.name ? [f.code, f.name].filter(Boolean).join(' · ') : '';
  const regimeName = p.laborRegimeData?.name || nameOf(laborRegimes, p.laborRegimeId) || p.laborRegime;
  const professionName = p.professionData?.name || nameOf(professions, p.professionId);
  const birthDate = p.birthDate ? String(p.birthDate).split('T')[0] : '';

  const openEdit = () => {
    setForm({
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      dni: p.dni || '',
      birthDate,
      username: user.username,
      phone: p.phone || '',
      email: p.email || '',
      laborRegimeId: p.laborRegimeId || '',
      professionId: p.professionId || '',
    });
    setError(null);
    setEditOpen(true);
  };

  const openPassword = () => {
    setPassword({ next: '', confirm: '' });
    setError(null);
    setPasswordOpen(true);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    const clean = { ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), dni: form.dni.trim(), username: form.username.trim(), email: form.email.trim(), phone: form.phone.trim() };
    if (!clean.firstName || !clean.lastName) return setError('Nombres y apellidos son obligatorios.');
    if (clean.dni.length !== 8) return setError('El DNI debe tener 8 dígitos.');
    if (!clean.username) return setError('El nombre de usuario es obligatorio.');
    if (clean.email && !EMAIL_RE.test(clean.email)) return setError('El correo no tiene un formato válido.');

    const changed =
      clean.firstName !== (p.firstName || '') || clean.lastName !== (p.lastName || '') || clean.dni !== (p.dni || '') ||
      clean.birthDate !== birthDate || clean.username !== user.username || clean.phone !== (p.phone || '') ||
      clean.email !== (p.email || '') || clean.laborRegimeId !== (p.laborRegimeId || '') || clean.professionId !== (p.professionId || '');
    if (!changed) { setEditOpen(false); return; }

    setSaving(true);
    const response: any = await api.updateProfile(user.personnelId, {
      firstName: clean.firstName,
      lastName: clean.lastName,
      dni: clean.dni,
      phone: clean.phone,
      email: clean.email,
      birthDate: clean.birthDate,
      laborRegimeId: clean.laborRegimeId,
      professionId: clean.professionId,
      // El usuario solo se envía si cambió: el servidor lo trata aparte.
      username: clean.username !== user.username ? clean.username : undefined,
    });
    if (response.success) {
      updateUserContext({
        username: clean.username,
        personnelData: { ...p, firstName: clean.firstName, lastName: clean.lastName, dni: clean.dni, phone: clean.phone, email: clean.email, birthDate: clean.birthDate, laborRegimeId: clean.laborRegimeId, professionId: clean.professionId },
      });
      await refreshUserData(clean.username);
      setEditOpen(false);
      if (response.birthDateSkipped) toast.warning('Datos guardados, salvo la fecha de nacimiento: falta preparar la base de datos.');
      else toast.success('Datos actualizados.');
    } else {
      setError(response.message || 'No se pudieron guardar los cambios.');
    }
    setSaving(false);
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.next.length < 4) return setError('La contraseña debe tener al menos 4 caracteres.');
    if (password.next !== password.confirm) return setError('Las dos contraseñas no coinciden.');
    setSaving(true);
    const response = await api.updateProfile(user.personnelId, {
      firstName: p.firstName,
      lastName: p.lastName,
      dni: p.dni,
      phone: p.phone || '',
      email: p.email || '',
      laborRegimeId: p.laborRegimeId || '',
      professionId: p.professionId || '',
      password: password.next,
    });
    if (response.success) {
      setPasswordOpen(false);
      toast.success('Contraseña cambiada. Vuelva a activar el PIN o la huella en sus equipos.');
    } else {
      setError(response.message || 'No se pudo cambiar la contraseña.');
    }
    setSaving(false);
  };

  const set = (key: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => (prev ? { ...prev, [key]: key === 'dni' ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value } : prev));

  const errorBox = error && (
    <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] font-semibold text-red-700">
      <ShieldAlert className="h-4 w-4 shrink-0" />{error}
    </div>
  );

  // 'md': portada del celular (anillo blanco sobre la tarjeta); 'dark': banda oscura del escritorio.
  const avatar = (variant: 'md' | 'dark') => (
    <div className="relative shrink-0">
      <div className={`grid place-items-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 font-black text-white ${variant === 'dark' ? 'h-20 w-20 text-2xl ring-4 ring-white/15' : 'h-24 w-24 text-3xl ring-[5px] ring-white'}`}>
        {userInitials(user)}
      </div>
      <span title="Cuenta activa" className={`absolute rounded-full border-[3px] bg-emerald-500 ${variant === 'dark' ? 'bottom-0.5 right-0.5 h-4 w-4 border-slate-900' : 'bottom-1.5 right-1.5 h-5 w-5 border-white'}`} />
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-3 pb-24 md:space-y-5 md:px-4 md:py-6 md:pb-6 animate-in fade-in">
      {/* Portada: en el celular a todo el ancho y centrada; en escritorio, tarjeta con el avatar a la izquierda. */}
      {isDesktop ? (
        // Escritorio: banda oscura compacta con todo dentro (elegida por el usuario el 2026-10-05).
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-teal-900 p-6 shadow-sm">
          <div aria-hidden="true" className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-teal-400/10" />
          <div aria-hidden="true" className="absolute -bottom-24 right-1/3 h-48 w-48 rounded-full bg-teal-300/10" />
          <div className="relative flex items-center gap-5">
            {avatar('dark')}
            <div className="min-w-0 flex-1">
              <h1 className="text-[24px] font-black leading-tight text-white">{userFullName(user)}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-teal-300/30 bg-teal-300/15 px-3 py-1 text-[12.5px] font-bold text-teal-100">{roleLabel}</span>
                {facilityText && <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12.5px] font-bold text-white"><Building2 className="h-3.5 w-3.5" />{facilityText}</span>}
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono text-[12.5px] font-bold text-white">@{user.username}</span>
              </div>
            </div>
            <button type="button" onClick={openEdit} className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-teal-800 transition-colors hover:bg-teal-50">
              <Pencil className="h-4 w-4" />Editar datos
            </button>
          </div>
        </div>
      ) : (
        <div className="-mx-3 -mt-1 overflow-hidden bg-white pb-5 text-center shadow-sm">
          <Cover className="h-24" />
          <div className="mx-auto -mt-12 w-fit">{avatar('md')}</div>
          <h1 className="mt-2.5 px-4 text-[20px] font-black text-slate-900">{userFullName(user)}</h1>
          <p className="text-[13.5px] font-semibold text-teal-700">{roleLabel}</p>
          <p className="mt-1 px-4 text-[13px] text-slate-500">
            {facilityText && <>{facilityText} · </>}<span className="font-mono">@{user.username}</span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-5">
        <Section title="Datos personales">
          <Row icon={<IdCard />} label="DNI" mono>{p.dni || <Empty />}</Row>
          <Row icon={<Cake />} label="Fecha de nacimiento">{birthDate ? formatDate(birthDate) : <Empty />}</Row>
          <Row icon={<Phone />} label="Celular">{p.phone ? <a href={`tel:${p.phone}`} className="hover:text-teal-700">{p.phone}</a> : <Empty />}</Row>
          <Row icon={<Mail />} label="Correo">{p.email ? <a href={`mailto:${p.email}`} className="hover:text-teal-700">{p.email}</a> : <Empty />}</Row>
        </Section>

        <Section title="Trabajo">
          <Row icon={<Building2 />} label="Establecimiento">{facilityText ? [facilityText, f?.category].filter(Boolean).join(' · ') : <Empty text="No asignado" />}</Row>
          <Row icon={<MapPin />} label="Jurisdicción">{jurisdiction ? <span className="text-[14px]">{jurisdiction}</span> : <Empty text="No asignada" />}</Row>
          <Row icon={<Briefcase />} label="Régimen laboral">{regimeName || <Empty />}</Row>
          <Row icon={<GraduationCap />} label="Profesión">{professionName || <Empty text="No registrada" />}</Row>
        </Section>

        <Section title="Cuenta y seguridad">
          <Row icon={<AtSign />} label="Usuario" mono onClick={openEdit}>{user.username}</Row>
          <Row icon={<Lock />} label="Contraseña" onClick={openPassword}><span className="text-[14px] font-bold text-teal-700">Cambiar contraseña</span></Row>
          <QuickAccessCard embedded />
        </Section>
      </div>

      {!isDesktop && <FloatingActionButton icon={<Pencil />} label="Editar datos" onClick={openEdit} />}

      <ResponsiveDialog
        open={editOpen && !!form}
        title="Editar datos"
        size="lg"
        onClose={() => setEditOpen(false)}
        busy={saving}
        onSubmit={saveProfile}
        footer={
          <>
            <button type="button" onClick={() => setEditOpen(false)} disabled={saving} className={dialogSecondaryButton}>Cancelar</button>
            <button type="submit" disabled={saving} className={dialogPrimaryButton}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Guardar cambios
            </button>
          </>
        }
      >
        {form && (
          <div className="space-y-5">
            {errorBox}
            <Group title="Identidad">
              <FormField label="Nombres" required><input className={inputClass} value={form.firstName} onChange={set('firstName')} autoComplete="given-name" /></FormField>
              <FormField label="Apellidos" required><input className={inputClass} value={form.lastName} onChange={set('lastName')} autoComplete="family-name" /></FormField>
              <FormField label="DNI" required><input className={`${inputClass} font-mono`} value={form.dni} onChange={set('dni')} inputMode="numeric" maxLength={8} placeholder="8 dígitos" /></FormField>
              <FormField label="Fecha de nacimiento"><input type="date" className={inputClass} value={form.birthDate} onChange={set('birthDate')} max={new Date().toISOString().slice(0, 10)} /></FormField>
            </Group>
            <Group title="Cuenta">
              <FormField label="Nombre de usuario" required hint="Con este nombre entra al sistema.">
                <input className={`${inputClass} font-mono`} value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" />
              </FormField>
            </Group>
            <Group title="Contacto">
              <FormField label="Celular"><input type="tel" className={inputClass} value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="Ej. 956958745" /></FormField>
              <FormField label="Correo"><input type="email" className={inputClass} value={form.email} onChange={set('email')} placeholder="Ej. farmacia@gmail.com" /></FormField>
            </Group>
            <Group title="Trabajo">
              <FormField label="Régimen laboral">
                <CustomSelect className="h-11 text-sm" value={form.laborRegimeId} onChange={(v) => setForm((prev) => (prev ? { ...prev, laborRegimeId: v } : prev))} options={[{ value: '', label: 'Sin régimen' }, ...laborRegimes.map((r) => ({ value: r.id, label: r.name }))]} ariaLabel="Régimen laboral" />
              </FormField>
              <FormField label="Profesión">
                <CustomSelect className="h-11 text-sm" value={form.professionId} onChange={(v) => setForm((prev) => (prev ? { ...prev, professionId: v } : prev))} options={[{ value: '', label: 'Sin profesión' }, ...professions.map((x) => ({ value: x.id, label: x.name }))]} ariaLabel="Profesión" />
              </FormField>
            </Group>
          </div>
        )}
      </ResponsiveDialog>

      <ResponsiveDialog
        open={passwordOpen}
        title="Cambiar contraseña"
        onClose={() => setPasswordOpen(false)}
        busy={saving}
        onSubmit={savePassword}
        footer={
          <>
            <button type="button" onClick={() => setPasswordOpen(false)} disabled={saving} className={dialogSecondaryButton}>Cancelar</button>
            <button type="submit" disabled={saving} className={dialogPrimaryButton}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Cambiar contraseña
            </button>
          </>
        }
      >
        {errorBox}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
          <FormField label="Nueva contraseña"><input type="password" className={inputClass} value={password.next} onChange={(e) => setPassword((x) => ({ ...x, next: e.target.value }))} autoComplete="new-password" placeholder="Mínimo 4 caracteres" autoFocus /></FormField>
          <FormField label="Repita la contraseña"><input type="password" className={inputClass} value={password.confirm} onChange={(e) => setPassword((x) => ({ ...x, confirm: e.target.value }))} autoComplete="new-password" /></FormField>
        </div>
        <div className="mt-4 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
          <KeyRound className="h-4 w-4 shrink-0" />
          <span>Al cambiarla se desactivan el PIN y la huella de todos sus equipos; tendrá que volver a activarlos.</span>
        </div>
      </ResponsiveDialog>
    </div>
  );
};
