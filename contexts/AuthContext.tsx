
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User, AuthState, AppModule, SystemConfig } from '../types';
import { api } from '../services/api';

interface AuthContextType extends AuthState {
  login: (u: string, p: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  hasPermission: (module: AppModule) => boolean;
  updateUserContext: (data: Partial<User>) => void;
  updateSystemConfigContext: (config: SystemConfig) => void;
  refreshUserData: (customUsername?: string) => Promise<void>; // Nueva función expuesta
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    systemConfig: { verificationDelaySeconds: 5 } // Default initial value
  });

  // Función centralizada para refrescar datos desde el servidor
  const refreshUserData = async (customUsername?: string) => {
      const targetUsername = customUsername || state.user?.username;
      if (!targetUsername) return;
      try {
          // Forzamos la llamada al backend
          const freshData = await api.refreshSession(targetUsername);
          if (freshData.success && freshData.user) {
              const updatedUser = freshData.user as User;
              sessionStorage.setItem('aura_auth_user', JSON.stringify(updatedUser));
              setState(prev => ({ ...prev, user: updatedUser }));
              console.log("Datos de usuario sincronizados con BD");
          }
      } catch (e) {
          console.error("Error refreshing user data:", e);
      }
  };

  useEffect(() => {
    const initAuth = async () => {
        // 1. Load System Config
        try {
            const config = await api.getSystemConfig();
            setState(prev => ({ ...prev, systemConfig: config }));
        } catch (e) {
            console.warn("Failed to load system config (using defaults)", e);
        }

        // 2. Check session storage for persisted session
        const savedUser = sessionStorage.getItem('aura_auth_user');
        
        if (savedUser) {
            try {
                const parsedUser = JSON.parse(savedUser) as User;
                
                // 2a. Optimistic UI: Set state immediately
                setState(prev => ({ ...prev, user: parsedUser, isAuthenticated: true, isLoading: false }));
                
                // 2b. Silent Refresh: Check with DB immediately
                try {
                    const freshData = await api.refreshSession(parsedUser.username);
                    
                    if (freshData.success && freshData.user) {
                        sessionStorage.setItem('aura_auth_user', JSON.stringify(freshData.user));
                        setState(prev => ({ ...prev, user: freshData.user as User }));
                    } else if (freshData.message === 'Usuario no encontrado o eliminado') {
                         sessionStorage.removeItem('aura_auth_user');
                         setState(prev => ({ ...prev, user: null, isAuthenticated: false }));
                    }
                } catch (refreshError) {
                    console.warn("Could not refresh session (Offline?), using cached data.", refreshError);
                }

            } catch {
                sessionStorage.removeItem('aura_auth_user');
                setState(prev => ({ ...prev, user: null, isAuthenticated: false, isLoading: false }));
            }
        } else {
            setState(prev => ({ ...prev, user: null, isAuthenticated: false, isLoading: false }));
        }
    };

    initAuth();
  }, []);

  // --- PRE-FETCHING / CACHE WARMING ---
  useEffect(() => {
      if (state.isAuthenticated && state.user?.role === 'ADMIN') {
          api.getUsers().catch(err => console.warn("Background fetch failed", err));
      }
  }, [state.isAuthenticated, state.user?.role]); // Fix dependency

  const login = async (u: string, p: string) => {
    // NOTA IMPORTANTE: No establecemos isLoading: true aquí.
    // Si lo hacemos, App.tsx desmontará LoginScreen para mostrar el spinner global,
    // lo que provocará que se pierda el estado local del error (mensaje) cuando falle el login.
    // LoginScreen ya maneja su propio estado de carga (isSubmitting).
    
    const result = await api.login(u, p);
    
    if (result.success && result.user) {
        sessionStorage.setItem('aura_auth_user', JSON.stringify(result.user));
        // Reset welcome flag on new login
        sessionStorage.removeItem('aura_welcome_shown_session');
        
        const userToSet = result.user as User;
        setState(prev => ({ ...prev, user: userToSet, isAuthenticated: true, isLoading: false }));
    } 
    // Si falla, no cambiamos el estado global, simplemente devolvemos el resultado
    // para que LoginScreen muestre el error.
    
    return result;
  };

  const logout = () => {
    // Invalida el token en el servidor antes de olvidarlo aquí.
    void api.endSession();
    sessionStorage.removeItem('aura_auth_user');
    sessionStorage.removeItem('aura_welcome_shown_session');
    setState(prev => ({ ...prev, user: null, isAuthenticated: false, isLoading: false }));
  };

  const hasPermission = useCallback((module: AppModule): boolean => {
      if (!state.user) return false;
      try {
          // El administrador total debe poder acceder a los modulos nuevos aun cuando
          // su configuracion de rol en Supabase todavia no haya sido actualizada.
          if (state.user.role === 'ADMIN' && (module.startsWith('IMMUNIZATION_') || module === 'STOCK_MONITORING' || module === 'ANALYSIS_EXCLUSIONS')) return true;
          return Array.isArray(state.user.permissions) && state.user.permissions.includes(module);
      } catch (e) {
          console.error("Error checking permission:", e);
          return false;
      }
  }, [state.user]);

  // --- INACTIVITY TIMEOUT ---
  useEffect(() => {
      if (!state.isAuthenticated) return;

      const timeoutDuration = 30 * 60 * 1000; // 30 minutos
      let timeoutId: ReturnType<typeof setTimeout>;

      const resetTimer = () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
              logout();
              // Usar un alert personalizado o notificación si es necesario, 
              // por ahora un simple alert es suficiente para el requerimiento de seguridad.
              console.log("Sesión cerrada por inactividad.");
          }, timeoutDuration);
      };

      // Eventos que reinician el temporizador
      const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
      events.forEach(event => document.addEventListener(event, resetTimer));

      resetTimer(); // Iniciar temporizador

      return () => {
          clearTimeout(timeoutId);
          events.forEach(event => document.removeEventListener(event, resetTimer));
      };
  }, [state.isAuthenticated]);

  // La configuración del sistema se relee cada pocos minutos: así encender el modo
  // mantenimiento cierra también las sesiones que ya estaban abiertas, sin pedirle a nadie
  // que recargue. Es una lectura pequeña de una tabla de claves y valores.
  useEffect(() => {
      const releerConfig = async () => {
          try {
              const config = await api.getSystemConfig();
              setState(prev => ({ ...prev, systemConfig: config }));
          } catch (e) {
              // Si falla, se conserva la configuración que ya estaba en memoria.
          }
      };
      const intervalo = setInterval(releerConfig, 5 * 60 * 1000);
      const alVolver = () => { if (document.visibilityState === 'visible') void releerConfig(); };
      document.addEventListener('visibilitychange', alVolver);
      return () => {
          clearInterval(intervalo);
          document.removeEventListener('visibilitychange', alVolver);
      };
  }, []);

  const updateUserContext = (data: Partial<User>) => {
      if (!state.user) return;
      const newUser = { ...state.user, ...data };
      sessionStorage.setItem('aura_auth_user', JSON.stringify(newUser));
      setState(prev => ({ ...prev, user: newUser }));
  };

  const updateSystemConfigContext = (config: SystemConfig) => {
      setState(prev => ({ ...prev, systemConfig: config }));
  };

  const contextValue = useMemo(() => ({
      ...state, login, logout, hasPermission, updateUserContext, updateSystemConfigContext, refreshUserData
  }), [state, hasPermission]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
