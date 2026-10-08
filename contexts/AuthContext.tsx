
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User, AuthState, AppModule, SystemConfig } from '../types';
import { api, getSessionToken } from '../services/api';
import { isActionAllowed } from '../services/moduleActions';
import type { DeviceLoginResult } from '../services/deviceAccess';
import { isOnline, subscribeConnectivity } from '../services/connectivity';
import {
  clearStoredSession, keptSession, keptSessionUsable, markSessionValidated, pendingLogoutToken, readStoredUser,
  setLoginNotice, setPendingLogoutToken, startStoredSession, writeStoredUser,
} from '../services/sessionStore';

interface AuthContextType extends AuthState {
  /** `keep`: «Mantener sesión iniciada» (ver services/sessionStore.ts). */
  login: (u: string, p: string, keep?: boolean) => Promise<{ success: boolean; message?: string }>;
  /** Entrar con el PIN o la huella de este equipo (ver services/deviceAccess.ts). */
  loginWithDevice: (deviceId: string, secret: string, pin: string | null) => Promise<{ success: boolean; message?: string; result?: DeviceLoginResult }>;
  logout: () => void;
  hasPermission: (module: AppModule) => boolean;
  /** ¿Puede usar esta acción del módulo? (Configuración de Roles, services/moduleActions.ts) */
  can: (module: AppModule, action: string) => boolean;
  updateUserContext: (data: Partial<User>) => void;
  updateSystemConfigContext: (config: SystemConfig) => void;
  refreshUserData: (customUsername?: string) => Promise<void>; // Nueva función expuesta
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_EXPIRED_NOTICE = 'Su sesión venció. Ingrese de nuevo.';

/** Avisa al servidor de una sesión que se cerró sin internet, en cuanto hay conexión. */
const flushPendingLogout = () => {
  const token = pendingLogoutToken();
  if (!token || !isOnline()) return;
  void api.endSessionToken(token).then((ok) => { if (ok) setPendingLogoutToken(null); });
};

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
              writeStoredUser(JSON.stringify(updatedUser));
              setState(prev => ({ ...prev, user: updatedUser }));
              console.log("Datos de usuario sincronizados con BD");
          }
      } catch (e) {
          console.error("Error refreshing user data:", e);
      }
  };

  /** La sesión ya no vale en el servidor (token vencido o cuenta borrada): se vuelve al inicio de sesión. */
  const expireSession = () => {
      clearStoredSession();
      setLoginNotice(SESSION_EXPIRED_NOTICE);
      setState(prev => ({ ...prev, user: null, isAuthenticated: false, isLoading: false }));
  };

  /**
   * Comprueba la sesión con el servidor y relee la cuenta. Sin internet no hace nada (se sigue
   * con lo guardado). Con la sesión mantenida, además renueva el plazo en el servidor y en el
   * equipo.
   */
  const validateSession = async (username: string) => {
      if (!isOnline()) return;
      const fresh = await api.refreshSession(username);
      if (fresh.success && fresh.user) {
          writeStoredUser(JSON.stringify(fresh.user));
          setState(prev => ({ ...prev, user: fresh.user as User }));
          if (keptSession()) {
              const stillValid = await api.keepSession();
              if (stillValid === false) return expireSession();
              markSessionValidated();
          }
      } else if (fresh.expired) {
          expireSession();
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

        // 2. Sesión guardada: en la pestaña o, con «Mantener sesión iniciada», en el equipo.
        flushPendingLogout();
        const savedUser = readStoredUser();
        const kept = keptSession();

        if (savedUser && kept && !keptSessionUsable(kept, new Date())) {
            // Pasaron más días sin internet de los que se permiten: hay que volver a entrar.
            clearStoredSession();
            setLoginNotice('Su sesión guardada en este equipo venció. Ingrese de nuevo.');
            setState(prev => ({ ...prev, user: null, isAuthenticated: false, isLoading: false }));
        } else if (savedUser) {
            try {
                const parsedUser = JSON.parse(savedUser) as User;
                // 2a. Se muestra de inmediato; sin internet, se sigue con lo guardado.
                setState(prev => ({ ...prev, user: parsedUser, isAuthenticated: true, isLoading: false }));
                // 2b. Con internet, se comprueba con el servidor.
                await validateSession(parsedUser.username);
            } catch {
                clearStoredSession();
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

  const login = async (u: string, p: string, keep = true) => {
    // NOTA IMPORTANTE: No establecemos isLoading: true aquí.
    // Si lo hacemos, App.tsx desmontará LoginScreen para mostrar el spinner global,
    // lo que provocará que se pierda el estado local del error (mensaje) cuando falle el login.
    // LoginScreen ya maneja su propio estado de carga (isSubmitting).
    
    const result = await api.login(u, p);
    
    if (result.success && result.user) {
        startStoredSession(JSON.stringify(result.user), keep);
        if (keep) void api.keepSession();
        // Reset welcome flag on new login
        sessionStorage.removeItem('aura_welcome_shown_session');
        
        const userToSet = result.user as User;
        setState(prev => ({ ...prev, user: userToSet, isAuthenticated: true, isLoading: false }));
    } 
    // Si falla, no cambiamos el estado global, simplemente devolvemos el resultado
    // para que LoginScreen muestre el error.
    
    return result;
  };

  const loginWithDevice = async (deviceId: string, secret: string, pin: string | null) => {
    const result = await api.loginWithDevice(deviceId, secret, pin);
    if (result.success && result.user) {
        // El PIN o la huella son de un equipo personal: la sesión se mantiene.
        startStoredSession(JSON.stringify(result.user), true);
        void api.keepSession();
        sessionStorage.removeItem('aura_welcome_shown_session');
        setState(prev => ({ ...prev, user: result.user as User, isAuthenticated: true, isLoading: false }));
    }
    return result;
  };

  const logout = () => {
    // Invalida el token en el servidor antes de olvidarlo aquí. Sin internet, se anota y se
    // avisa al servidor cuando vuelva la conexión.
    if (isOnline()) void api.endSession();
    else setPendingLogoutToken(getSessionToken());
    clearStoredSession();
    sessionStorage.removeItem('aura_welcome_shown_session');
    setState(prev => ({ ...prev, user: null, isAuthenticated: false, isLoading: false }));
  };

  const hasPermission = useCallback((module: AppModule): boolean => {
      if (!state.user) return false;
      try {
          // Inicio es la puerta de entrada y el Perfil es de cada uno (contraseña, PIN,
          // huella): los ve todo usuario con sesión, sin depender de roles_config.
          if (module === 'HOME' || module === 'PROFILE') return true;
          // El administrador total debe poder acceder a los modulos nuevos aun cuando
          // su configuracion de rol en Supabase todavia no haya sido actualizada.
          if (state.user.role === 'ADMIN' && (module === 'ANALYSIS_EXCLUSIONS' || module === 'AVAILABILITY' || module === 'ADMIN_SEND_KEYS' || module === 'ADMIN_BACKUPS')) return true;
          return Array.isArray(state.user.permissions) && state.user.permissions.includes(module);
      } catch (e) {
          console.error("Error checking permission:", e);
          return false;
      }
  }, [state.user]);

  // Acciones dentro de cada módulo. El Administrador total puede todo: así nadie se queda
  // sin poder volver a habilitar una acción. Apagar una acción solo quita; las reglas propias
  // de cada pantalla siguen cumpliéndose encima.
  const can = useCallback((module: AppModule, action: string): boolean => {
      if (!state.user) return false;
      if (state.user.role === 'ADMIN') return true;
      return isActionAllowed(state.user.deniedActions, module, action);
  }, [state.user]);

  // --- INACTIVITY TIMEOUT ---
  // Con «Mantener sesión iniciada» no se cierra por inactividad (decisión del usuario del 2026-10-08).
  useEffect(() => {
      if (!state.isAuthenticated || keptSession()) return;

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

  // La sesión que se cerró sin internet se cierra en el servidor apenas vuelve la conexión,
  // aunque nadie haya vuelto a entrar.
  useEffect(() => subscribeConnectivity((online) => { if (online) flushPendingLogout(); }), []);

  // Al volver la conexión: se comprueba la sesión y se cierra en el servidor la que se cerró sin internet.
  useEffect(() => {
      if (!state.isAuthenticated || !state.user?.username) return;
      const username = state.user.username;
      const unsubscribe = subscribeConnectivity((online) => {
          if (!online) return;
          flushPendingLogout();
          void validateSession(username);
      });
      // Una pestaña abierta varios días con internet también renueva el plazo de la sesión mantenida.
      const timer = setInterval(() => { if (keptSession()) void validateSession(username); }, 6 * 60 * 60 * 1000);
      return () => { unsubscribe(); clearInterval(timer); };
  }, [state.isAuthenticated, state.user?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateUserContext = (data: Partial<User>) => {
      if (!state.user) return;
      const newUser = { ...state.user, ...data };
      writeStoredUser(JSON.stringify(newUser));
      setState(prev => ({ ...prev, user: newUser }));
  };

  const updateSystemConfigContext = (config: SystemConfig) => {
      setState(prev => ({ ...prev, systemConfig: config }));
  };

  const contextValue = useMemo(() => ({
      ...state, login, loginWithDevice, logout, hasPermission, can, updateUserContext, updateSystemConfigContext, refreshUserData
  }), [state, hasPermission, can]);

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
