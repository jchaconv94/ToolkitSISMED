
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Lock, User, ArrowRight, Phone, ShieldCheck, Layers, Eye, EyeOff } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
      const savedUsername = localStorage.getItem('aura_saved_username');
      const savedPassword = localStorage.getItem('aura_saved_password');
      if (savedUsername && savedPassword) {
          setUsername(savedUsername);
          setPassword(savedPassword);
          setRememberMe(true);
      }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setIsSubmitting(true);
      
      const result = await login(username, password);
      
      if (!result.success) {
          setError(result.message || 'Error al iniciar sesión');
      } else {
          if (rememberMe) {
              localStorage.setItem('aura_saved_username', username);
              localStorage.setItem('aura_saved_password', password);
          } else {
              localStorage.removeItem('aura_saved_username');
              localStorage.removeItem('aura_saved_password');
          }
      }
      setIsSubmitting(false);
  };

  const handleInputChange = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
      setter(value);
      if (error) setError(''); // Clear error on typing
  };

  return (
    <div className="flex min-h-screen bg-white">
        {/* Left Side: Branding/Imagery (Hidden on Mobile) */}
        <div className="hidden lg:flex lg:w-[45%] relative bg-gray-900 items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-gray-900 to-gray-950"></div>
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.04]"></div>
            
            {/* Subtle glow effect */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-[128px]"></div>
            
            <div className="relative z-10 flex flex-col items-center text-center p-12 max-w-lg">
                <div className="bg-white/5 p-4 rounded-3xl mb-8 backdrop-blur-sm border border-white/10 shadow-2xl">
                    <div className="bg-gray-900 p-4 rounded-2xl flex items-center justify-center">
                        <Layers className="h-12 w-12 text-cyan-400" strokeWidth={2.5} />
                    </div>
                </div>
                
                <h1 className="text-4xl xl:text-5xl font-black text-white mb-6 tracking-tight leading-tight flex items-center gap-3">
                    <span>ToolKit</span> <span className="text-gray-300">SISMED</span> <span className="text-lg font-bold text-cyan-400 px-2 py-1 bg-cyan-500/10 rounded-lg border border-cyan-500/20 self-start mt-1">WEB</span>
                </h1>
                
                <p className="text-lg text-teal-100 font-medium leading-relaxed opacity-90 mb-10">
                    ToolKit SISMED automatiza y simplifica la gestión operativa del SISMED en una sola plataforma.
                </p>
                
                <div className="w-16 h-1 bg-teal-500/50 rounded-full mb-10"></div>
                
                <div className="flex items-center gap-2 text-sm text-gray-400 font-medium">
                    <ShieldCheck className="h-4 w-4 text-teal-500/70" />
                    <span>Gestión Eficiente de información Farmacéutica</span>
                </div>
                <div className="mt-2 text-xs text-gray-500 font-mono">
                    ToolKit SISMED © {new Date().getFullYear()}
                </div>
            </div>
        </div>

        {/* Right Side: Form Container */}
        <div className="w-full lg:w-[55%] flex items-center justify-center p-8 sm:p-12 lg:p-24 bg-gray-50 relative">
            
            {/* Background minimal pattern for the right side */}
            <div className="absolute top-0 right-0 p-8 opacity-20 pointer-events-none">
                <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-gray-300"/>
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
            </div>

            <div className="w-full max-w-[400px] relative z-10">
                
                {/* Mobile Header */}
                <div className="lg:hidden mb-10 flex flex-col items-center justify-center">
                    <div className="bg-gray-900 p-3 rounded-2xl mb-4 shadow-lg flex items-center justify-center">
                        <Layers className="h-8 w-8 text-cyan-400" strokeWidth={2.5} />
                    </div>
                    <h1 className="text-2xl font-black text-gray-900 mb-1 tracking-tight flex items-baseline gap-1">
                        ToolKit <span className="text-gray-600">SISMED</span> <span className="text-[10px] font-bold text-cyan-600 px-1 py-0.5 bg-cyan-50 rounded border border-cyan-200 self-center ml-1">WEB</span>
                    </h1>
                    <p className="text-sm font-medium text-gray-500">Gestión Farmacéutica</p>
                </div>

                <div className="mb-10 text-center lg:text-left">
                    <h2 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Bienvenido</h2>
                    <p className="text-gray-500 font-medium text-sm">Ingrese sus credenciales de acceso institucional.</p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50/50 border border-red-200/60 text-red-700 text-sm rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                        <Lock className="h-5 w-5 shrink-0 mt-0.5 text-red-500" />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider ml-1">Usuario</label>
                        <div className="relative group">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-teal-600 transition-colors">
                                <User className="h-5 w-5" />
                            </div>
                            <input 
                                type="text"
                                className={`w-full pl-12 pr-4 py-3.5 bg-white border ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:border-teal-500 focus:ring-teal-500/20'} rounded-xl focus:ring-4 outline-none transition-all text-gray-900 font-medium shadow-sm`}
                                placeholder="Ej. jperez"
                                value={username}
                                onChange={(e) => handleInputChange(setUsername, e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider ml-1">Contraseña</label>
                        <div className="relative group">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-teal-600 transition-colors">
                                <Lock className="h-5 w-5" />
                            </div>
                            <input 
                                type={showPassword ? 'text' : 'password'}
                                className={`w-full pl-12 pr-12 py-3.5 bg-white border ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:border-teal-500 focus:ring-teal-500/20'} rounded-xl focus:ring-4 outline-none transition-all text-gray-900 font-medium shadow-sm`}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => handleInputChange(setPassword, e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-teal-600 transition-colors focus:outline-none"
                            >
                                {showPassword ? (
                                    <EyeOff className="h-5 w-5" />
                                ) : (
                                    <Eye className="h-5 w-5" />
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center mt-2 ml-1">
                        <input
                            id="remember-me"
                            name="remember-me"
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="h-4 w-4 text-teal-600 focus:ring-teal-500/50 border border-gray-300 rounded transition-colors cursor-pointer"
                        />
                        <label htmlFor="remember-me" className="ml-2 block text-xs font-semibold text-gray-700 cursor-pointer select-none">
                            Recordar mis credenciales
                        </label>
                    </div>

                    <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-gray-900 text-white font-bold py-3.5 rounded-xl hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-900/20 disabled:opacity-70 disabled:cursor-not-allowed group mt-2"
                    >
                        {isSubmitting ? 'Verificando...' : 'Iniciar sesión'}
                        {!isSubmitting && <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />}
                    </button>
                </form>

                <div className="mt-8 text-center flex flex-col items-center gap-4 border-t border-gray-200 pt-6">
                    <button className="text-sm font-bold text-teal-600 hover:text-teal-800 transition-colors">
                        ¿Olvidó su contraseña?
                    </button>
                    
                    <div className="text-xs text-gray-400 mt-2">
                        <p className="mb-2">Contacta al administrador del sistema:</p>
                        <div className="inline-flex items-center gap-2 bg-gray-50 hover:bg-gray-100 transition-colors py-2 px-4 rounded-full border border-gray-200">
                            <Phone className="h-4 w-4 text-gray-500" />
                            <span className="font-bold text-gray-700 tracking-wide">956606972 - Ing. Jordan Chacon Villacis</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};
