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
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import { BrandMark } from './ui/BrandLogo';

/** Solo se recuerda el usuario. La contraseña nunca se guarda en el navegador. */
const USUARIO_RECORDADO_KEY = 'aura_saved_username';
/** Clave antigua que guardaba la contraseña en texto plano: se borra al abrir el login. */
const CLAVE_ANTIGUA_KEY = 'aura_saved_password';

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
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usuarioRef = useRef<HTMLInputElement>(null);
  const claveRef = useRef<HTMLInputElement>(null);

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
          <div className="mb-7 flex flex-col gap-2">
            <h2 className="text-[28px] font-extrabold tracking-tight sm:text-[30px]">Iniciar sesión</h2>
            <p className="text-[15px] font-medium text-[#4E5F5C]">Ingrese con su cuenta institucional.</p>
          </div>

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
              <label htmlFor="login-clave" className="text-sm font-bold">Contraseña</label>
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={rememberUser}
                  onChange={(e) => setRememberUser(e.target.checked)}
                  className="h-[18px] w-[18px] accent-teal-700"
                />
                Recordar mi usuario
              </label>
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                aria-expanded={showHelp}
                className="min-h-[44px] text-sm font-bold text-teal-700 hover:underline"
              >
                ¿Olvidó su contraseña?
              </button>
            </div>

            {showHelp && (
              <div className="rounded-xl bg-[#F3F6F5] px-4 py-3.5 text-sm font-medium leading-relaxed text-[#24332F] animate-in fade-in">
                Para restablecerla, comuníquese con el administrador del sistema:
                <span className="mt-1.5 flex items-center gap-2 font-bold text-[#10201E]">
                  <Phone className="h-4 w-4 text-teal-700" />
                  956606972 · Ing. Jordan Chacon Villacis
                </span>
              </div>
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
        </div>
        <p className="text-[13px] font-medium text-[#4E5F5C]">© 2026 Toolkit SISMED</p>
      </main>
    </div>
  );
};
