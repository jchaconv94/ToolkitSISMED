import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Database,
  Eye,
  EyeOff,
  HardDriveDownload,
  Loader2,
  Lock,
  ShieldCheck,
  User,
  WifiOff,
} from 'lucide-react';
import { BrandMark } from './ui/BrandLogo';
import { PinLogin } from './PinLogin';
import { FingerprintLogin } from './FingerprintLogin';
import { isDesktopPointer, readStoredDevice, type StoredDevice } from '../services/deviceAccess';
import { useOnline } from './ui/useOnline';
import { InfoTip } from './ui/InfoTip';

/** Solo se recuerda el usuario. La contraseña nunca se guarda en el navegador. */
const USUARIO_RECORDADO_KEY = 'aura_saved_username';
/** Clave antigua que guardaba la contraseña en texto plano: se borra al abrir el login. */
const CLAVE_ANTIGUA_KEY = 'aura_saved_password';

/** Enlace directo a WhatsApp del administrador, con el mensaje ya escrito. */
const WHATSAPP_SOPORTE = `https://wa.me/51956606972?text=${encodeURIComponent(
  'Hola, Ing. Jordan. Olvidé mi contraseña de Toolkit SISMED. Mi usuario es: ',
)}`;

/** Logo de WhatsApp (lucide no lo trae). */
const WhatsAppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.43 9.43 0 0 1-4.81-1.32l-.34-.2-3.58.94.96-3.49-.23-.36a9.42 9.42 0 0 1-1.44-5.02c0-5.21 4.24-9.45 9.46-9.45 2.52 0 4.9.99 6.68 2.77a9.39 9.39 0 0 1 2.77 6.69c0 5.21-4.24 9.45-9.46 9.45zm8.05-17.5A11.32 11.32 0 0 0 12.04.67C5.77.67.66 5.77.66 12.04c0 2 .52 3.96 1.52 5.69L.57 23.33l5.73-1.5a11.36 11.36 0 0 0 5.74 1.46h.01c6.27 0 11.38-5.1 11.38-11.38 0-3.04-1.18-5.9-3.34-8.04z" />
  </svg>
);

/** Lo que explica la «i» de «Mantener sesión iniciada». */
const KEEP_SESSION_HELP = (
  <>
    La sesión sigue abierta aunque cierre el navegador, no se cierra por inactividad y la app funciona sin
    internet hasta 45 días. Desmárquela en una PC compartida.
  </>
);

const VENTAJAS = [
  { Icon: Database, texto: 'Stock de toda la región, siempre a la mano' },
  { Icon: HardDriveDownload, texto: 'Backups SISMED con un clic' },
  { Icon: BarChart3, texto: 'Análisis de requerimiento en minutos' },
];

/**
 * Inicio de sesión (rediseño del 2026-10-03, sobre la propuesta «B» del usuario).
 *
 * Escritorio: panel oscuro con la marca y las piezas del logo, que entran flotando; a la
 * derecha, la tarjeta del formulario. Celular: una franja oscura con la marca arriba y el
 * formulario debajo, sin piezas que estorben.
 */
export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUser, setRememberUser] = useState(false);
  const [keepSession, setKeepSession] = useState(true);
  const online = useOnline();
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usuarioRef = useRef<HTMLInputElement>(null);
  const claveRef = useRef<HTMLInputElement>(null);
  // Con acceso rápido activado se empieza por él: el PIN en la PC, la huella en el celular.
  const [pinDevice, setPinDevice] = useState<StoredDevice | null>(() => {
    const guardado = readStoredDevice();
    if (!guardado) return null;
    const desktop = isDesktopPointer();
    return (guardado.kind === 'pin' && desktop) || (guardado.kind === 'huella' && !desktop) ? guardado : null;
  });

  const usarContrasena = (mensaje?: string) => {
    if (pinDevice) setUsername(pinDevice.username);
    setPinDevice(null);
    if (mensaje) setError(mensaje);
    window.setTimeout(() => (pinDevice ? claveRef : usuarioRef).current?.focus(), 0);
  };

  useEffect(() => {
    try {
      // Antes «Recordar mis credenciales» guardaba también la contraseña, sin cifrar.
      localStorage.removeItem(CLAVE_ANTIGUA_KEY);
      const guardado = localStorage.getItem(USUARIO_RECORDADO_KEY);
      if (guardado) {
        setUsername(guardado);
        setRememberUser(true);
        // Con el usuario ya puesto, lo siguiente que se escribe es la contraseña.
        claveRef.current?.focus();
        return;
      }
    } catch {
      // Sin almacenamiento local solo se pierde recordar el usuario.
    }
    usuarioRef.current?.focus();
  }, []);

  const usuarioVacio = tried && !username.trim();
  const claveVacia = tried && !password;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setTried(true);
    setError('');
    if (!username.trim() || !password) return;

    setIsSubmitting(true);
    const result = await login(username, password);
    if (!result.success) {
      setError(result.message || 'No se pudo iniciar sesión.');
      setIsSubmitting(false);
      return;
    }
    try {
      if (rememberUser) localStorage.setItem(USUARIO_RECORDADO_KEY, username.trim());
      else localStorage.removeItem(USUARIO_RECORDADO_KEY);
    } catch {
      // Sin almacenamiento local, simplemente no se recuerda.
    }
    setIsSubmitting(false);
  };

  const alEscribir = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    if (error) setError('');
  };

  const detectarMayusculas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  };

  const campo = (conError: boolean) =>
    `flex h-[52px] items-center gap-3 rounded-[14px] border-[1.5px] px-4 transition-all focus-within:border-teal-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-teal-600/15 ${
      conError ? 'border-red-600 bg-white' : 'border-[#C4D0CD] bg-[#F3F6F5]'
    }`;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#EEF3F2] text-[#10201E] lg:flex-row">
      {/* Panel de marca (escritorio) */}
      <aside
        className="relative hidden min-h-[640px] flex-[1.15] flex-col justify-between overflow-hidden px-16 py-14 text-white lg:flex"
        style={{
          background:
            'radial-gradient(circle at 12% 8%, #17565A 0%, rgba(23,86,90,0) 55%), radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.5px) 0 0 / 26px 26px, #081A1D',
        }}
      >
        {/* Las piezas del logo, abajo a la derecha: sin tapar el texto. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[80px] -right-[70px] grid h-[400px] w-[400px] -rotate-[14deg] grid-cols-2 gap-6"
        >
          <div className="login-shape"><div className="login-piece h-full w-full rounded-[56px] bg-[#1FA393] shadow-[0_30px_60px_rgba(0,0,0,0.35)]" /></div>
          <div className="login-shape"><div className="login-piece h-full w-full rounded-[56px] bg-[#6DD5C4] shadow-[0_30px_60px_rgba(0,0,0,0.35)]" /></div>
          <div className="login-shape"><div className="login-piece h-full w-full rounded-[56px] bg-[#F3F7F6] shadow-[0_30px_60px_rgba(0,0,0,0.35)]" /></div>
          <div className="login-shape">
            <div className="login-piece login-piece--spin relative h-full w-full">
            <div className="absolute left-[34%] top-0 h-full w-[32%] rounded-[22px] bg-[#F08A2C] shadow-[0_30px_60px_rgba(0,0,0,0.35)]" />
            <div className="absolute left-0 top-[34%] h-[32%] w-full rounded-[22px] bg-[#F08A2C]" />
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-3">
          <BrandMark size={34} tone="dark" />
          <span className="text-[17px] font-bold tracking-tight">Toolkit SISMED</span>
        </div>

        <div className="relative flex max-w-[460px] flex-col gap-6">
          <h1 className="text-[60px] font-extrabold leading-[1.02] tracking-[-0.035em]">
            Toolkit
            <br />
            <span className="text-[#5FD0BF]">SISMED</span>
          </h1>
          <p className="text-[19px] font-medium leading-relaxed text-[#BFD6D2]">
            Automatiza y simplifica la gestión operativa del SISMED en una sola plataforma.
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {VENTAJAS.map(({ Icon, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-[15px] font-medium text-[#D6E8E5]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#5FD0BF]/30 bg-[#5FD0BF]/10 text-[#8BE3D5]">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-sm font-medium text-[#A9C6C1]">
          <ShieldCheck className="h-[18px] w-[18px] text-[#5FD0BF]" />
          Gestión eficiente de información farmacéutica
        </div>
      </aside>

      {/* Portada del celular: fondo oscuro con las piezas del logo flotando, título grande
          y la tarjeta del formulario montada encima de su borde inferior. */}
      <header
        className="relative overflow-hidden px-6 pb-[112px] pt-10 text-white lg:hidden"
        style={{
          background:
            'radial-gradient(circle at 10% 0%, #17565A 0%, rgba(23,86,90,0) 60%), radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.5px) 0 0 / 22px 22px, #081A1D',
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[30px] -right-4 grid h-[118px] w-[118px] rotate-[12deg] grid-cols-2 gap-2.5 opacity-90"
        >
          <div className="login-shape"><div className="login-piece h-full w-full rounded-[16px] bg-[#1FA393] shadow-[0_16px_32px_rgba(0,0,0,0.35)]" /></div>
          <div className="login-shape"><div className="login-piece h-full w-full rounded-[16px] bg-[#6DD5C4] shadow-[0_16px_32px_rgba(0,0,0,0.35)]" /></div>
          <div className="login-shape"><div className="login-piece h-full w-full rounded-[16px] bg-[#F3F7F6] shadow-[0_16px_32px_rgba(0,0,0,0.35)]" /></div>
          <div className="login-shape">
            <div className="login-piece login-piece--spin relative h-full w-full">
            <div className="absolute left-[34%] top-0 h-full w-[32%] rounded-[7px] bg-[#F08A2C]" />
            <div className="absolute left-0 top-[34%] h-[32%] w-full rounded-[7px] bg-[#F08A2C]" />
            </div>
          </div>
        </div>
        <div className="relative flex flex-col gap-4">
          <h1 className="flex items-center gap-3 text-[34px] font-extrabold leading-none tracking-[-0.03em]">
            <BrandMark size={40} tone="dark" />
            <span>
              Toolkit <span className="text-[#5FD0BF]">SISMED</span>
            </span>
          </h1>
          <p className="max-w-[300px] text-[16px] font-medium leading-relaxed text-[#BFD6D2]">
            Automatiza y simplifica la gestión operativa del SISMED.
          </p>
        </div>
      </header>

      {/* Formulario */}
      <main className="relative -mt-16 flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-8 sm:px-6 lg:mt-0 lg:py-14">
        <div className="w-full max-w-[440px] rounded-3xl bg-white px-6 py-8 shadow-[0_1px_2px_rgba(16,32,30,0.06),0_24px_60px_rgba(16,32,30,0.10)] sm:px-10 sm:py-11">
          {pinDevice ? (
            pinDevice.kind === 'huella'
              ? <FingerprintLogin device={pinDevice} onUsePassword={usarContrasena} />
              : <PinLogin device={pinDevice} onUsePassword={usarContrasena} />
          ) : (
          <>
          <div className="mb-7 flex flex-col gap-2">
            <h2 className="text-[28px] font-extrabold tracking-tight sm:text-[30px]">Iniciar sesión</h2>
            <p className="text-[15px] font-medium text-[#4E5F5C]">Ingrese con su cuenta institucional.</p>
          </div>

          {!online && (
            <div role="status" className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm font-semibold text-amber-800">
              <WifiOff className="mt-0.5 h-[18px] w-[18px] shrink-0" />
              <span>Sin conexión a internet. Para iniciar sesión se necesita internet.</span>
            </div>
          )}

          {error && (
            <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700 animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="mt-0.5 h-[18px] w-[18px] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-2">
              <label htmlFor="login-usuario" className="text-sm font-bold">Usuario</label>
              <div className={campo(usuarioVacio)}>
                <User className="h-5 w-5 shrink-0 text-[#4E5F5C]" />
                <input
                  ref={usuarioRef}
                  id="login-usuario"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Ej. jperez"
                  value={username}
                  onChange={(e) => alEscribir(setUsername, e.target.value)}
                  aria-invalid={usuarioVacio}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-base font-medium outline-none placeholder:text-[#7A8A87]"
                />
              </div>
              {usuarioVacio && <span className="text-[13px] font-semibold text-red-700">Ingrese su usuario.</span>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="login-clave" className="text-sm font-bold">Contraseña</label>
                <button
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  aria-expanded={showHelp}
                  className="text-[13px] font-bold text-teal-700 hover:underline"
                >
                  ¿Olvidó su contraseña?
                </button>
              </div>
              <div className={`${campo(claveVacia)} pr-1.5`}>
                <Lock className="h-5 w-5 shrink-0 text-[#4E5F5C]" />
                <input
                  ref={claveRef}
                  id="login-clave"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Su contraseña"
                  value={password}
                  onChange={(e) => alEscribir(setPassword, e.target.value)}
                  onKeyUp={detectarMayusculas}
                  onKeyDown={detectarMayusculas}
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={claveVacia}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-base font-medium outline-none placeholder:text-[#7A8A87]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] text-[#4E5F5C] hover:bg-slate-100"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {claveVacia && <span className="text-[13px] font-semibold text-red-700">Ingrese su contraseña.</span>}
              {capsLock && !claveVacia && (
                <span className="text-[13px] font-semibold text-amber-700">Las mayúsculas están activadas.</span>
              )}
            </div>

            {/* Una sola casilla: mantener la sesión también recuerda el usuario. Marcada por
                omisión (decisión del usuario del 2026-10-08: quien no sabe de tecnología no la
                marcaría nunca). La explicación va detrás de la «i». */}
            {(window as any).__loginVariant === 'B' ? (
            <div className="-my-1 flex flex-wrap items-center gap-x-6">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input type="checkbox" checked={rememberUser} onChange={(e) => setRememberUser(e.target.checked)} className="h-[18px] w-[18px] accent-teal-700" />
                Recordar usuario
              </label>
              <span className="flex min-h-[44px] items-center gap-1">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                  <input type="checkbox" checked={keepSession} onChange={(e) => setKeepSession(e.target.checked)} className="h-[18px] w-[18px] accent-teal-700" />
                  Mantener sesión
                </label>
                <InfoTip title="Mantener sesión iniciada" hover size="sm">{KEEP_SESSION_HELP}</InfoTip>
              </span>
            </div>
            ) : (
            <div className="-my-1 flex min-h-[44px] items-center gap-1">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={keepSession}
                  onChange={(e) => setKeepSession(e.target.checked)}
                  className="h-[18px] w-[18px] accent-teal-700"
                />
                Mantener sesión iniciada
              </label>
              <InfoTip title="Mantener sesión iniciada" hover size="sm">{KEEP_SESSION_HELP}</InfoTip>
            </div>
            )}

            {showHelp && (
              // Tarjeta de contacto: quién restablece la contraseña y un acceso discreto a
              // WhatsApp. El número no se muestra en pantalla: va solo en el enlace.
              <a
                href={WHATSAPP_SOPORTE}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition-all hover:border-teal-300 hover:shadow-[0_8px_24px_rgba(16,32,30,0.08)] animate-in fade-in"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0E8C80] to-[#0B5F57] text-sm font-extrabold text-white">
                  JC
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#7A8A87]">Restablecer contraseña</span>
                  <span className="block truncate text-sm font-bold text-[#10201E]">Ing. Jordan Chacon Villacis</span>
                  <span className="block text-xs font-medium text-[#4E5F5C]">Administrador del sistema</span>
                </span>
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[#25D366] transition-colors group-hover:border-[#25D366] group-hover:bg-[#25D366] group-hover:text-white"
                  aria-label="Escribir por WhatsApp"
                  title="Escribir por WhatsApp"
                >
                  <WhatsAppIcon className="h-5 w-5" />
                </span>
              </a>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1.5 flex h-[54px] items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-b from-[#0E8C80] to-[#0B7A70] text-base font-bold text-white shadow-[0_8px_20px_rgba(11,122,112,0.30)] transition-all hover:-translate-y-px hover:shadow-[0_12px_28px_rgba(11,122,112,0.38)] disabled:translate-y-0 disabled:opacity-80"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                  Verificando…
                </>
              ) : (
                <>
                  Iniciar sesión
                  <ArrowRight className="h-[18px] w-[18px]" />
                </>
              )}
            </button>
          </form>
          </>
          )}
        </div>
        <p className="text-[13px] font-medium text-[#4E5F5C]">© 2026 Toolkit SISMED</p>
      </main>
    </div>
  );
};
