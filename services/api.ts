import { User, UserRole, Personnel, HealthFacility, RoleConfig, SystemConfig, Unget, Diresa, Ogess, Microred } from "../types";
import { SESSION_TOKEN_KEY, supabase } from "./supabaseClient";
import { connectionsToRetire } from "./ungetConnections";
import bcrypt from "bcryptjs";

// MOCK DATA (Respaldo en caso de error de conexión/sin supabase)
const MOCK_DB = {
    users: [
        { username: 'admin', password: '123', role: 'ADMIN', personnelId: 'P001', isActive: true },
        { username: 'farmacia', password: '123', role: 'FARMACIA', personnelId: 'P002', isActive: true },
    ],
    personnel: [
        { id: 'P001', firstName: 'Aura', lastName: 'Admin', dni: '00000001', facilityCode: '00001', email: 'admin@aura.pe', phone: '987654321', laborRegime: 'D.L. 276', laborRegimeId: 'LR-276', professionId: 'PROF-QFAR' },
        { id: 'P002', firstName: 'Jordan', lastName: 'Perez', dni: '12345678', facilityCode: '00002', email: 'jordan@redsalud.pe', phone: '912345678', laborRegime: 'D.L. 1057 (CAS)', laborRegimeId: 'LR-1057', professionId: 'PROF-TECF' },
    ],
    facilities: [
        { code: '00001', name: 'DIRESA SEDE CENTRAL', category: 'ADM' },
        { code: '00002', name: 'C.S. MIRAFLORES', category: 'I-3' },
    ],
    roles: [
        { role: 'ADMIN', label: 'Administrador Total', allowedModules: ['DASHBOARD', 'ANALYSIS', 'ADMIN_USERS', 'ADMIN_ROLES', 'PROFILE', 'REDISTRIBUTION', 'SIG_SEARCH', 'ADMIN_STOCK_ASSIGN', 'IPRESS_STOCK', 'STOCK_MONITORING', 'IMMUNIZATION_CATALOG', 'IMMUNIZATION_INITIAL_INVENTORY', 'IMMUNIZATION_STOCK', 'IMMUNIZATION_INCOMES', 'IMMUNIZATION_INCOME_ORIGINS', 'IMMUNIZATION_DISTRIBUTIONS', 'IMMUNIZATION_CONSUMPTION', 'IMMUNIZATION_RETURNS', 'IMMUNIZATION_ADJUSTMENTS', 'IMMUNIZATION_CLOSURES', 'IMMUNIZATION_REPORTS'], maxUrlsAllowed: 10 },
        { role: 'FARMACIA', label: 'Responsable Farmacia', allowedModules: ['DASHBOARD', 'ANALYSIS', 'PROFILE', 'REDISTRIBUTION', 'IPRESS_STOCK'], maxUrlsAllowed: 1 }
    ],
    laborRegimes: [
        { id: 'LR-276', name: 'D.L. 276', description: 'Sector Público - Régimen de Carrera Administrativa' },
        { id: 'LR-1057', name: 'D.L. 1057 (CAS)', description: 'Contrato Administrativo de Servicios' },
        { id: 'LR-1153', name: 'D.L. 1153', description: 'Régimen de Personal de la Salud' },
        { id: 'LR-728', name: 'D.L. 728', description: 'Régimen de la Actividad Privada' },
        { id: 'LR-LOC', name: 'Locación de Servicios', description: 'Contratación de Terceros / Locadores' }
    ],
    professions: [
        { id: 'PROF-MED', name: 'Médico Cirujano', description: 'Profesional de la medicina' },
        { id: 'PROF-QFAR', name: 'Químico Farmacéutico', description: 'Especialista en medicamentos esenciales' },
        { id: 'PROF-ENF', name: 'Lic. Enfermería', description: 'Cuidado quirúrgico o primario' },
        { id: 'PROF-OBST', name: 'Lic. Obstetricia', description: 'Atención obstétrica' },
        { id: 'PROF-TECF', name: 'Técnico en Farmacia', description: 'Apoyo en dispensación y almacén' }
    ],
    defaultConfig: {
        verificationDelaySeconds: 5,
        apiUrl: ""
    } as SystemConfig
};

// Variable cache
let usersCache: any[] | null = null;

/**
 * Columnas de `users` que puede pedir el cliente.
 *
 * Nunca debe incluir `password_hash`: la clave `anon` viaja en el bundle publicado, así
 * que cualquier columna legible aquí es legible por cualquiera. La verificación de
 * contraseña ocurre en el servidor mediante `app_verify_password`.
 * Ver `supabase/SUPABASE_SEGURIDAD_APLICAR_ESTO.sql`.
 */
const USER_SELECT = "username, role, personnel_id, is_active, created_at, personnel:personnel_id(*, facilities:facility_code(*), labor_regimes:labor_regime_id(*), professions:profession_id(*)), roles_config:role(*)";

/**
 * Token de sesión emitido por `app_login`.
 *
 * Es lo que autoriza las operaciones administrativas en el servidor. Sustituye al modelo
 * anterior, en el que el navegador escribía directamente sobre `users` con la clave
 * pública `anon`. Ver `supabase/SUPABASE_SEGURIDAD_APLICAR_ESTO.sql`.
 */
export const getSessionToken = (): string | null => {
    try {
        return sessionStorage.getItem(SESSION_TOKEN_KEY);
    } catch {
        return null;
    }
};

const setSessionToken = (token: string | null) => {
    try {
        if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        else sessionStorage.removeItem(SESSION_TOKEN_KEY);
    } catch {
        // Sin sessionStorage no hay sesión persistente; las operaciones admin pedirán reingreso.
    }
};

const requireSessionToken = (): string => {
    const token = getSessionToken();
    if (!token) throw new Error("Su sesión expiró. Vuelva a iniciar sesión para realizar esta operación.");
    return token;
};

/**
 * Inicia sesión en el servidor y guarda el token.
 *
 * Devuelve `null` si la función todavía no existe en la base, para que la aplicación se
 * pueda desplegar antes o después de aplicar el SQL sin dejar a nadie fuera.
 */
const loginOnServer = async (username: string, password: string): Promise<boolean | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("app_login", {
        p_username: username,
        p_password: password
    });
    if (error) {
        console.warn("app_login no disponible; se usa la verificación heredada en el cliente.", error.message);
        return null;
    }
    if (!data) {
        setSessionToken(null);
        return false;
    }
    setSessionToken(String(data));
    return true;
};

export const api = {
    /** Cierra la sesión en el servidor y borra el token local. */
    endSession: async (): Promise<void> => {
        const token = getSessionToken();
        setSessionToken(null);
        if (!supabase || !token) return;
        try {
            await supabase.rpc("app_logout", { p_token: token });
        } catch {
            // Si falla, el token caduca solo a las 12 horas.
        }
    },

    login: async (username: string, password: string): Promise<{ success: boolean; user?: User; message?: string }> => {
        try {
            if (supabase) {
                const serverVerification = await loginOnServer(username, password);
                if (serverVerification === false) return { success: false, message: "Usuario o contraseña incorrectos." };

                const { data: userRecord, error } = await supabase
                    .from("users")
                    .select(USER_SELECT)
                    .eq("username", username)
                    .single();

                if (error || !userRecord) return { success: false, message: "Usuario o contraseña incorrectos." };

                if (!userRecord.is_active) {
                    return { success: false, message: "Su cuenta ha sido desactivada. Contacte al administrador." };
                }

                if (serverVerification === null) {
                    // Camino heredado, mientras la migración no esté aplicada.
                    const { data: secret } = await supabase
                        .from("users")
                        .select("password_hash")
                        .eq("username", username)
                        .single();
                    const isValid = Boolean(secret?.password_hash) && bcrypt.compareSync(password, secret!.password_hash);
                    if (!isValid) return { success: false, message: "Usuario o contraseña incorrectos." };
                }

                const personnelData = Array.isArray(userRecord.personnel) ? userRecord.personnel[0] : userRecord.personnel;
                const roleConfig = Array.isArray(userRecord.roles_config) ? userRecord.roles_config[0] : userRecord.roles_config;
                const facilityData = personnelData ? (Array.isArray(personnelData.facilities) ? personnelData.facilities[0] : personnelData.facilities) : null;

                return {
                    success: true,
                    user: {
                        username: userRecord.username,
                        role: userRecord.role,
                        personnelId: userRecord.personnel_id,
                        isActive: userRecord.is_active,
                        personnelData: personnelData ? {
                            id: personnelData.id,
                            firstName: personnelData.first_name,
                            lastName: personnelData.last_name,
                            dni: personnelData.dni,
                            phone: personnelData.phone,
                            email: personnelData.email,
                            laborRegime: personnelData.labor_regime,
                            laborRegimeId: personnelData.labor_regime_id,
                            professionId: personnelData.profession_id,
                            laborRegimeData: personnelData.labor_regimes ? (Array.isArray(personnelData.labor_regimes) ? personnelData.labor_regimes[0] : personnelData.labor_regimes) : undefined,
                            professionData: personnelData.professions ? (Array.isArray(personnelData.professions) ? personnelData.professions[0] : personnelData.professions) : undefined,
                            facilityCode: personnelData.facility_code,
                            diresaId: personnelData.diresa_id,
                            ogessId: personnelData.ogess_id,
                            ungetId: personnelData.unget_id,
                            microredId: personnelData.microred_id
                        } : undefined as any,
                        facilityData: facilityData ? {
                            code: facilityData.code,
                            name: facilityData.name,
                            category: facilityData.category,
                            ungetId: facilityData.unget_id,
                            diresaId: facilityData.diresa_id,
                            ogessId: facilityData.ogess_id,
                            microredId: facilityData.microred_id
                        } : undefined as any,
                        permissions: roleConfig ? roleConfig.allowed_modules : [],
                        maxUrlsAllowed: roleConfig ? roleConfig.max_urls_allowed : 0,
                        jurisdictionLevel: roleConfig ? (roleConfig.jurisdiction_level || roleConfig.jurisdictionLevel) : undefined
                    }
                };
            }
            throw new Error("Supabase is missing");
        } catch (e) {
            console.warn("Offline fallback login:", e);
            const authUser = MOCK_DB.users.find(u => u.username.toLowerCase() === username.toLowerCase());
            if (authUser && authUser.password === password) {
                if (authUser.isActive) {
                    const personnel = MOCK_DB.personnel.find(p => p.id === authUser.personnelId);
                    const facility = MOCK_DB.facilities.find(f => f.code === personnel?.facilityCode);
                    const roleConfig = MOCK_DB.roles.find(r => r.role === authUser.role);
                    return {
                        success: true,
                        user: {
                            username: authUser.username,
                            role: authUser.role as UserRole,
                            personnelId: authUser.personnelId,
                            isActive: authUser.isActive,
                            personnelData: personnel as Personnel,
                            facilityData: facility as HealthFacility,
                            permissions: roleConfig ? roleConfig.allowedModules as any : [],
                            jurisdictionLevel: (roleConfig as any)?.jurisdictionLevel
                        },
                        message: "Modo Offline"
                    };
                }
            }
            return { success: false, message: "Error conectando al servidor." };
        }
    },

    refreshSession: async (username: string): Promise<{ success: boolean; user?: User; message?: string }> => {
        try {
            if (supabase) {
                const { data: userRecord, error } = await supabase
                    .from("users")
                    .select(USER_SELECT)
                    .eq("username", username)
                    .single();

                if (error || !userRecord) return { success: false, message: "User not found" };

                const personnelData = Array.isArray(userRecord.personnel) ? userRecord.personnel[0] : userRecord.personnel;
                const roleConfig = Array.isArray(userRecord.roles_config) ? userRecord.roles_config[0] : userRecord.roles_config;
                const facilityData = personnelData ? (Array.isArray(personnelData.facilities) ? personnelData.facilities[0] : personnelData.facilities) : null;

                return {
                    success: true,
                    user: {
                        username: userRecord.username,
                        role: userRecord.role,
                        personnelId: userRecord.personnel_id,
                        isActive: userRecord.is_active,
                        personnelData: personnelData ? {
                            id: personnelData.id,
                            firstName: personnelData.first_name,
                            lastName: personnelData.last_name,
                            dni: personnelData.dni,
                            phone: personnelData.phone,
                            email: personnelData.email,
                            laborRegime: personnelData.labor_regime,
                            laborRegimeId: personnelData.labor_regime_id,
                            professionId: personnelData.profession_id,
                            laborRegimeData: personnelData.labor_regimes ? (Array.isArray(personnelData.labor_regimes) ? personnelData.labor_regimes[0] : personnelData.labor_regimes) : undefined,
                            professionData: personnelData.professions ? (Array.isArray(personnelData.professions) ? personnelData.professions[0] : personnelData.professions) : undefined,
                            facilityCode: personnelData.facility_code,
                            diresaId: personnelData.diresa_id,
                            ogessId: personnelData.ogess_id,
                            ungetId: personnelData.unget_id,
                            microredId: personnelData.microred_id
                        } : undefined as any,
                        facilityData: facilityData ? {
                            code: facilityData.code,
                            name: facilityData.name,
                            category: facilityData.category,
                            ungetId: facilityData.unget_id,
                            diresaId: facilityData.diresa_id,
                            ogessId: facilityData.ogess_id,
                            microredId: facilityData.microred_id
                        } : undefined as any,
                        permissions: roleConfig ? roleConfig.allowed_modules : [],
                        maxUrlsAllowed: roleConfig ? roleConfig.max_urls_allowed : 0,
                        jurisdictionLevel: roleConfig ? (roleConfig.jurisdiction_level || roleConfig.jurisdictionLevel) : undefined
                    }
                };
            }
        } catch (e) {
            console.warn("Refresh fallback", e);
        }
        return { success: false };
    },

    updateProfile: async (personnelId: string, data: any) => {
        try {
            usersCache = null;
            if (supabase) {
                const { error: pError } = await supabase.from('personnel').update({
                    first_name: data.firstName,
                    last_name: data.lastName,
                    dni: data.dni,
                    phone: data.phone,
                    email: data.email,
                    labor_regime_id: data.laborRegimeId || null,
                    profession_id: data.professionId || null
                }).eq('id', personnelId);
                
                // Usuario y contraseña se cambian en el servidor, que comprueba que la
                // sesión sea la dueña de esa cuenta (o un ADMIN).
                if (data.username || data.password) {
                    const { error: uError } = await supabase.rpc('app_update_own_account', {
                        p_token: requireSessionToken(),
                        p_personnel_id: personnelId,
                        p_new_username: data.username || null,
                        p_new_password: data.password ? String(data.password) : null
                    });
                    if (uError) throw uError;
                }
                
                if (!pError) return { success: true };
            }
            return { success: false, message: "Error al actualizar." };
        } catch(e) {
            return { success: false, message: "Error local." };
        }
    },

    getUsers: async (forceRefresh = false) => {
        if (usersCache && !forceRefresh) return usersCache;
        try {
            if (supabase) {
                const { data, error } = await supabase
                    .from("users")
                    .select(USER_SELECT);
                if (!error && data) {
                    const normalized = data.map(u => {
                        const p = Array.isArray(u.personnel) ? u.personnel[0] : u.personnel;
                        const roleCfg = Array.isArray(u.roles_config) ? u.roles_config[0] : u.roles_config;
                        const f = p && p.facilities ? (Array.isArray(p.facilities) ? p.facilities[0] : p.facilities) : null;
                        return {
                            username: u.username,
                            role: u.role,
                            isActive: u.is_active,
                            personnelId: u.personnel_id,
                            personnel: p ? {
                                id: p.id,
                                firstName: p.first_name,
                                lastName: p.last_name,
                                dni: p.dni,
                                phone: p.phone,
                                email: p.email,
                                laborRegime: p.labor_regime || undefined,
                                laborRegimeId: p.labor_regime_id || undefined,
                                professionId: p.profession_id || undefined,
                                laborRegimeData: p.labor_regimes ? (Array.isArray(p.labor_regimes) ? p.labor_regimes[0] : p.labor_regimes) : undefined,
                                professionData: p.professions ? (Array.isArray(p.professions) ? p.professions[0] : p.professions) : undefined,
                                facilityCode: p.facility_code,
                                diresaId: p.diresa_id || undefined,
                                ogessId: p.ogess_id || undefined,
                                ungetId: p.unget_id || undefined,
                                microredId: p.microred_id || undefined
                            } : null,
                            facilityData: f ? {
                                code: f.code,
                                name: f.name,
                                category: f.category,
                                ungetId: f.unget_id,
                                type: f.type,
                                diresaId: f.diresa_id,
                                ogessId: f.ogess_id,
                                microredId: f.microred_id
                            } : null,
                            permissions: roleCfg ? roleCfg.allowed_modules : [],
                            maxUrlsAllowed: roleCfg ? roleCfg.max_urls_allowed : 0,
                            created_at: u.created_at
                        };
                    });
                    usersCache = normalized;
                    return normalized;
                }
            }
        } catch(e) {}
        return Object.values(MOCK_DB.users).map(u => ({ ...u, personnel: MOCK_DB.personnel.find(p => p.id === u.personnelId) }));
    },

    adminSaveUser: async (userData: any): Promise<{ success: boolean; message?: string }> => {
        try {
            usersCache = null;
            if (supabase) {
                const targetPersonnelId = userData.personnelId || ('P' + Date.now() + Math.floor(Math.random() * 1000));
                
                // Upsert Personnel
                const { error: pError } = await supabase.from('personnel').upsert({
                    id: targetPersonnelId,
                    first_name: userData.firstName,
                    last_name: userData.lastName,
                    dni: userData.dni,
                    phone: userData.phone || null,
                    email: userData.email,
                    labor_regime: userData.laborRegime || null,
                    labor_regime_id: userData.laborRegimeId || null,
                    profession_id: userData.professionId || null,
                    facility_code: userData.facilityCode || null,
                    diresa_id: userData.diresaId || null,
                    ogess_id: userData.ogessId || null,
                    unget_id: userData.ungetId || null,
                    microred_id: userData.microredId || null
                });

                if (pError) throw pError;

                // La contraseña se envía en claro por HTTPS y se cifra en el servidor: el
                // navegador ya no genera hashes ni los escribe en la tabla.
                // La escritura sobre `users` se hace en el servidor: verifica que quien
                // llama sea un ADMIN con sesión válida antes de tocar nada.
                const { error: uError } = await supabase.rpc('app_admin_save_user', {
                    p_token: requireSessionToken(),
                    p_username: userData.username,
                    p_role: userData.role,
                    p_personnel_id: targetPersonnelId,
                    p_is_active: userData.isActive !== undefined ? userData.isActive : true,
                    p_password: userData.password ? String(userData.password) : null,
                    p_is_new: Boolean(userData.isNew)
                });
                if (uError) throw uError;
                return { success: true };
            }
            return { success: false, message: "No Supabase connected" };
        } catch(e: any) {
            return { success: false, message: e.message || "Error saving user" };
        }
    },

    toggleUserStatus: async (username: string, status: boolean): Promise<{ success: boolean; message?: string }> => {
        try {
            usersCache = null;
            if (supabase) {
                const { error } = await supabase.rpc('app_admin_toggle_user', {
                    p_token: requireSessionToken(),
                    p_username: username,
                    p_status: status
                });
                if (error) throw error;
                return { success: true };
            }
        } catch(e) {}
        return { success: false };
    },

    adminDeleteUser: async (username: string, personnelId: string | null): Promise<{ success: boolean; message?: string }> => {
        try {
            usersCache = null;
            if (supabase) {
                // La función borra el usuario y, si puede, su ficha de personal.
                const { error: uError } = await supabase.rpc('app_admin_delete_user', {
                    p_token: requireSessionToken(),
                    p_username: username,
                    p_personnel_id: personnelId
                });
                if (uError) throw uError;
                return { success: true };
            }
            return { success: false, message: "No Supabase connected" };
        } catch(e: any) {
            return { success: false, message: e.message || "Error deleting user" };
        }
    },

    // --- DIRESA ---
    getDiresas: async (): Promise<Diresa[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('diresas').select('*');
                if (!error && data) {
                    return data.map(d => ({
                        id: d.id,
                        name: d.name,
                        ruc: d.ruc,
                        department: d.department,
                        province: d.province,
                        district: d.district,
                        legalAddress: d.legal_address,
                        website: d.website,
                        socialMedia: d.social_media,
                        phone: d.phone,
                        email: d.email
                    }));
                }
            }
        } catch(e){}
        return [];
    },

    saveDiresa: async (diresa: Partial<Diresa>): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('diresas').upsert({
                    id: diresa.id,
                    name: diresa.name,
                    ruc: diresa.ruc,
                    department: diresa.department,
                    province: diresa.province,
                    district: diresa.district,
                    legal_address: diresa.legalAddress,
                    website: diresa.website,
                    social_media: diresa.socialMedia,
                    phone: diresa.phone,
                    email: diresa.email
                });
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    deleteDiresa: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('diresas').delete().eq('id', id);
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    // --- OGESS ---
    getOgess: async (): Promise<Ogess[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('ogess').select('*');
                if (!error && data) {
                    return data.map(o => ({
                        id: o.id,
                        name: o.name,
                        diresaId: o.diresa_id,
                        code: o.code,
                        ruc: o.ruc,
                        department: o.department,
                        province: o.province,
                        district: o.district,
                        legalAddress: o.legal_address,
                        website: o.website,
                        socialMedia: o.social_media,
                        phone: o.phone,
                        email: o.email
                    }));
                }
            }
        } catch(e){}
        return [];
    },

    saveOgess: async (ogess: Partial<Ogess>): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('ogess').upsert({
                    id: ogess.id,
                    name: ogess.name,
                    diresa_id: ogess.diresaId,
                    code: ogess.code,
                    ruc: ogess.ruc,
                    department: ogess.department,
                    province: ogess.province,
                    district: ogess.district,
                    legal_address: ogess.legalAddress,
                    website: ogess.website,
                    social_media: ogess.socialMedia,
                    phone: ogess.phone,
                    email: ogess.email
                });
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    deleteOgess: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('ogess').delete().eq('id', id);
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    // --- MICROREDES ---
    getMicroredes: async (): Promise<Microred[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('microredes').select('*');
                if (!error && data) {
                    return data.map(m => ({
                        id: m.id,
                        name: m.name,
                        ungetId: m.unget_id,
                        location: m.location,
                        legalAddress: m.legal_address,
                        website: m.website,
                        socialMedia: m.social_media,
                        phone: m.phone,
                        email: m.email
                    }));
                }
            }
        } catch(e){}
        return [];
    },

    saveMicrored: async (microred: Partial<Microred>): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('microredes').upsert({
                    id: microred.id,
                    name: microred.name,
                    unget_id: microred.ungetId,
                    location: microred.location,
                    legal_address: microred.legalAddress,
                    website: microred.website,
                    social_media: microred.socialMedia,
                    phone: microred.phone,
                    email: microred.email
                });
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    deleteMicrored: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('microredes').delete().eq('id', id);
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    getFacilities: async (): Promise<HealthFacility[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('facilities').select('*');
                if (!error && data) {
                    return data.map(f => ({
                        code: f.code,
                        name: f.name,
                        category: f.category,
                        type: f.type,
                        ungetId: f.unget_id,
                        microredId: f.microred_id,
                        ogessId: f.ogess_id,
                        diresaId: f.diresa_id,
                        legalAddress: f.legal_address,
                        website: f.website,
                        socialMedia: f.social_media,
                        phone: f.phone,
                        email: f.email,
                        department: f.department,
                        province: f.province,
                        district: f.district
                    }));
                }
            }
        } catch(e){}
        return MOCK_DB.facilities;
    },

    saveFacility: async (facility: HealthFacility, originalCode?: string): Promise<{ success: boolean; message?: string }> => {
        try {
            const cleanCode = (facility.code || '').trim();
            const cleanName = (facility.name || '').trim();
            const origCode = originalCode ? originalCode.trim() : '';

            if (!cleanCode) {
                return { success: false, message: "El código RENIPRESS es obligatorio." };
            }
            if (!cleanName) {
                return { success: false, message: "El nombre del establecimiento es obligatorio." };
            }

            const payload = {
                code: cleanCode,
                name: cleanName,
                category: (facility.category || '').trim(),
                type: facility.type || null,
                unget_id: facility.ungetId || null,
                microred_id: facility.microredId || null,
                ogess_id: facility.ogessId || null,
                diresa_id: facility.diresaId || null,
                legal_address: facility.legalAddress || null,
                website: facility.website || null,
                social_media: facility.socialMedia || null,
                phone: facility.phone || null,
                email: facility.email || null,
                department: facility.department || null,
                province: facility.province || null,
                district: facility.district || null
            };

            if (supabase) {
                // Modo EDICIÓN: se proporcionó originalCode
                if (origCode) {
                    if (origCode === cleanCode) {
                        // El código RENIPRESS no cambió: omitimos 'code' del update para evitar revisiones innecesarias de FK en Postgres
                        const { code: _c, ...updateFields } = payload;
                        const { error } = await supabase
                            .from('facilities')
                            .update(updateFields)
                            .eq('code', origCode);
                        if (error) throw error;
                        return { success: true };
                    } else {
                        // El código RENIPRESS cambió: verificar primero con RPC o actualización directa
                        try {
                            const { data: rpcRes, error: rpcErr } = await supabase.rpc('update_health_facility', {
                                p_original_code: origCode,
                                p_new_code: cleanCode,
                                p_name: cleanName,
                                p_category: payload.category,
                                p_type: payload.type,
                                p_unget_id: payload.unget_id,
                                p_microred_id: payload.microred_id,
                                p_ogess_id: payload.ogess_id,
                                p_diresa_id: payload.diresa_id,
                                p_legal_address: payload.legal_address,
                                p_website: payload.website,
                                p_social_media: payload.social_media,
                                p_phone: payload.phone,
                                p_email: payload.email,
                                p_department: payload.department,
                                p_province: payload.province,
                                p_district: payload.district
                            });

                            if (!rpcErr && rpcRes) {
                                if (rpcRes.success) return { success: true };
                                return { success: false, message: rpcRes.message };
                            }
                        } catch {
                            // RPC no existe todavía, intentar update directo
                        }

                        // Verificar si el nuevo código ya pertenece a otro establecimiento
                        const { data: existing, error: checkErr } = await supabase
                            .from('facilities')
                            .select('code')
                            .eq('code', cleanCode)
                            .maybeSingle();
                        if (checkErr) throw checkErr;
                        if (existing) {
                            return { success: false, message: `El código RENIPRESS "${cleanCode}" ya pertenece a otro establecimiento registrado.` };
                        }

                        // Actualizar la fila en facilities
                        const { error: updateErr } = await supabase
                            .from('facilities')
                            .update(payload)
                            .eq('code', origCode);
                        
                        if (updateErr) {
                            if (updateErr.message && updateErr.message.includes('violates foreign key constraint')) {
                                return {
                                    success: false,
                                    message: `No se puede cambiar el código RENIPRESS porque existen registros vinculados (personal, existencias o movimientos). Para habilitar el cambio en cascada, ejecute la migración SQL 'SUPABASE_MIGRATION_FACILITIES_CASCADE_UPDATE.sql' en Supabase.`
                                };
                            }
                            throw updateErr;
                        }

                        // Cascada complementaria en tablas de frontend si no tienen cascade
                        try {
                            await supabase.from('personnel').update({ facility_code: cleanCode }).eq('facility_code', origCode);
                        } catch (e) {
                            console.warn("No se pudo actualizar cascada en personnel:", e);
                        }
                        try {
                            await supabase.from('stock_assignments').update({ facility_code: cleanCode }).eq('facility_code', origCode);
                        } catch (e) {
                            console.warn("No se pudo actualizar cascada en stock_assignments:", e);
                        }

                        return { success: true };
                    }
                } else {
                    // Modo CREACIÓN: verificar si ya existe
                    const { data: existing, error: checkErr } = await supabase
                        .from('facilities')
                        .select('code')
                        .eq('code', cleanCode)
                        .maybeSingle();
                    if (checkErr) throw checkErr;
                    if (existing) {
                        return { success: false, message: `Ya existe un establecimiento registrado con el código RENIPRESS "${cleanCode}". Para modificarlo, selecciónelo en la lista y presione Editar.` };
                    }

                    const { error: insertErr } = await supabase
                        .from('facilities')
                        .insert(payload);
                    if (insertErr) throw insertErr;
                    return { success: true };
                }
            } else {
                // Fallback local
                const existingIdx = MOCK_DB.facilities.findIndex(f => f.code === (origCode || cleanCode));
                const item: HealthFacility = {
                    ...facility,
                    code: cleanCode,
                    name: cleanName
                };
                if (existingIdx >= 0) {
                    MOCK_DB.facilities[existingIdx] = item;
                } else {
                    MOCK_DB.facilities.push(item);
                }
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message || "Error al guardar el establecimiento" };
        }
    },

    deleteFacility: async (code: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('facilities').delete().eq('code', code);
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    getUngets: async (): Promise<Unget[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('ungets').select('*');
                if (!error && data) {
                    return data.map(u => ({
                        id: u.id,
                        name: u.name,
                        region: u.region,
                        ogessId: u.ogess_id,
                        diresaId: u.diresa_id,
                        legalAddress: u.legal_address,
                        website: u.website,
                        socialMedia: u.social_media,
                        phone: u.phone,
                        email: u.email,
                        department: u.department,
                        province: u.province,
                        district: u.district
                    }));
                }
            }
        } catch(e){}
        return [];
    },

    saveUnget: async (unget: Partial<Unget>): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('ungets').upsert({
                    id: unget.id,
                    name: unget.name,
                    region: unget.region,
                    ogess_id: unget.ogessId || null,
                    diresa_id: unget.diresaId || null,
                    legal_address: unget.legalAddress || null,
                    website: unget.website || null,
                    social_media: unget.socialMedia || null,
                    phone: unget.phone || null,
                    email: unget.email || null,
                    department: unget.department || null,
                    province: unget.province || null,
                    district: unget.district || null
                });
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    deleteUnget: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('ungets').delete().eq('id', id);
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    getRolesConfig: async (): Promise<RoleConfig[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('roles_config').select('*');
                if (!error && data) {
                    return data.map(r => {
                        const allowedModules = Array.isArray(r.allowed_modules) ? [...r.allowed_modules] : [];
                        if (r.role === 'ADMIN' && !allowedModules.includes('STOCK_MONITORING')) {
                            allowedModules.push('STOCK_MONITORING');
                        }
                        if (r.role === 'ADMIN' && !allowedModules.includes('IMMUNIZATION_CLOSURES')) {
                            allowedModules.push('IMMUNIZATION_CLOSURES');
                        }
                        return {
                            role: r.role,
                            label: r.label,
                            allowedModules,
                            maxUrlsAllowed: r.max_urls_allowed,
                            jurisdictionLevel: r.jurisdiction_level
                        };
                    });
                }
            }
        } catch(e) {}
        return MOCK_DB.roles as RoleConfig[];
    },

    updateRoleConfig: async (roleConfig: RoleConfig): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                // El renombrado y el guardado ocurren en el servidor, dentro de la misma
                // función, que exige sesión de ADMIN.
                const { error } = await supabase.rpc('app_admin_save_role_config', {
                    p_token: requireSessionToken(),
                    p_role: roleConfig.role,
                    p_old_role: roleConfig.oldRole || null,
                    p_label: roleConfig.label,
                    p_allowed_modules: roleConfig.allowedModules || [],
                    p_max_urls_allowed: roleConfig.maxUrlsAllowed !== undefined && roleConfig.maxUrlsAllowed !== null && !isNaN(Number(roleConfig.maxUrlsAllowed)) ? Number(roleConfig.maxUrlsAllowed) : null,
                    p_jurisdiction_level: roleConfig.jurisdictionLevel || null
                });
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false };
    },

    getSystemConfig: async (): Promise<SystemConfig> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('system_config').select('*');
                if (!error && data) {
                    const cfg: any = {};
                    data.forEach(d => {
                        cfg[d.key] = d.value;
                    });
                    const merged = { ...MOCK_DB.defaultConfig, ...cfg };
                    return merged;
                }
            }
        } catch(e) {}
        return MOCK_DB.defaultConfig;
    },

    updateSystemConfig: async (newConfig: SystemConfig): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const keys = Object.keys(newConfig);
                for (const k of keys) {
                    await supabase.from('system_config').upsert({ key: k, value: (newConfig as any)[k] });
                }
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false };
    },

    getUngetConfigs: async (username: string): Promise<any[]> => {
        const formatName = (name: string): string => {
            if (!name) return "";
            return name.replace(/MARICAL C\.?/gi, "MARISCAL CACERES").replace(/\bMARICAL\b/gi, "MARISCAL");
        };
        try {
            if (supabase) {
                const { data, error } = await supabase.from('unget_configs').select('*').eq('username', username);
                if (!error && data) {
                    return data.map(d => ({
                        ungetId: d.unget_id || null,
                        name: formatName(d.unget_name),
                        url: d.url,
                        username: d.username,
                        // Requiere la migración SUPABASE_MIGRATION_UNGET_SPREADSHEET_ID.sql.
                        spreadsheetId: d.spreadsheet_id || undefined
                    }));
                }
            }
        } catch(e) {}
        
        const saved = localStorage.getItem(`aura_sig_ungets_${username}`);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return parsed.map((p: any) => ({ ...p, name: formatName(p.name) }));
            } catch(e) { return []; }
        }
        return [];
    },

    getAllUngetConfigs: async (): Promise<any[]> => {
        const formatName = (name: string): string => {
            if (!name) return "";
            return name.replace(/MARICAL C\.?/gi, "MARISCAL CACERES").replace(/\bMARICAL\b/gi, "MARISCAL");
        };
        try {
            if (supabase) {
                const { data, error } = await supabase.from('unget_configs').select('*');
                if (!error && data) {
                    return data.map(d => ({
                        id: d.id,
                        ungetId: d.unget_id || null,
                        username: d.username,
                        name: formatName(d.unget_name),
                        url: d.url,
                        spreadsheetId: d.spreadsheet_id || undefined
                    }));
                }
            }
        } catch(e) {}
        
        const all: any[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('aura_sig_ungets_')) {
                const username = key.replace('aura_sig_ungets_', '');
                try {
                    const saved = localStorage.getItem(key);
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        if (Array.isArray(parsed)) {
                            parsed.forEach(c => {
                                all.push({
                                    username,
                                    name: formatName(c.name),
                                    url: c.url,
                                    ungetId: c.ungetId || null
                                });
                            });
                        }
                    }
                } catch(e) {}
            }
        }
        return all;
    },

    /**
     * Enlaces de hoja ya guardados, por URL de conexión. Un cliente con una versión
     * anterior (u otra pestaña) puede guardar la configuración sin `spreadsheetId`; al
     * reinsertar, se conserva el que ya estaba en la base.
     */
    getSavedSpreadsheetIds: async (usernames: string[]): Promise<Record<string, string>> => {
        const saved: Record<string, string> = {};
        if (!supabase || usernames.length === 0) return saved;
        try {
            const { data, error } = await supabase
                .from('unget_configs')
                .select('url,spreadsheet_id')
                .in('username', usernames);
            if (!error && data) {
                for (const row of data) {
                    if (row.url && row.spreadsheet_id) saved[row.url] = row.spreadsheet_id;
                }
            }
        } catch (e) {}
        return saved;
    },

    /**
     * Inserta una conexión UNGET. La tabla en producción no tiene `unget_id` y puede no
     * tener `spreadsheet_id` (migración pendiente): se reintenta quitando solo la columna
     * que falta, una a la vez, para no perder el enlace de la hoja.
     */
    insertUngetConfigRow: async (payload: Record<string, any>): Promise<void> => {
        if (!supabase) return;
        const isMissingColumn = (err: any) =>
            !!err?.message && (err.message.includes("column") || err.message.includes("unget_id") || err.message.includes("spreadsheet_id"));
        const optionalColumns = ["unget_id", "spreadsheet_id"];
        const attempt: Record<string, any> = { ...payload };
        let { error } = await supabase.from('unget_configs').insert(attempt);
        while (error && isMissingColumn(error)) {
            const missing = optionalColumns.find((col) => col in attempt && error!.message.includes(col))
                || optionalColumns.find((col) => col in attempt);
            if (!missing) break;
            delete attempt[missing];
            ({ error } = await supabase.from('unget_configs').insert(attempt));
        }
        if (error) throw error;
    },

    saveUngetConfigs: async (username: string, configs: any[]): Promise<{ success: boolean; message?: string }> => {
        const formatName = (name: string): string => {
            if (!name) return "";
            return name.replace(/MARICAL C\.?/gi, "MARISCAL CACERES").replace(/\bMARICAL\b/gi, "MARISCAL");
        };
        try {
            if (supabase) {
                const savedSheets = await api.getSavedSpreadsheetIds([username]);

                // La conexión pertenece a la UNGET: si ya existe una fila para esa UNGET se
                // actualiza, la haya creado quien la haya creado. Borrar por usuario y volver
                // a insertar chocaba con el índice único y le robaba la conexión a su
                // informático.
                const ungetIds = configs
                    .map((c: any) => String(c.ungetId || c.id || '').trim())
                    .filter(Boolean);
                const existentesPorUnget = new Map<string, any>();
                if (ungetIds.length > 0) {
                    const { data: existentes } = await supabase
                        .from('unget_configs')
                        .select('id,unget_id,username')
                        .in('unget_id', ungetIds);
                    (existentes || []).forEach((fila: any) => {
                        existentesPorUnget.set(String(fila.unget_id), fila);
                    });
                }

                for(const c of configs) {
                    const ungetId = String(c.ungetId || c.id || '').trim();
                    if (!c.spreadsheetId && savedSheets[c.url]) {
                        c.spreadsheetId = savedSheets[c.url];
                    }
                    const datos: any = {
                        unget_name: formatName(c.name),
                        url: c.url
                    };
                    if (ungetId) datos.unget_id = ungetId;
                    if (c.spreadsheetId) datos.spreadsheet_id = c.spreadsheetId;

                    const existente = ungetId ? existentesPorUnget.get(ungetId) : null;
                    if (existente) {
                        // No se cambia `username`: sigue siendo de su informático.
                        await supabase.from('unget_configs').update(datos).eq('id', existente.id);
                    } else {
                        await api.insertUngetConfigRow({ ...datos, username });
                    }
                }

                // Se retiran solo las conexiones propias que el usuario quitó de la lista.
                const { data: mias } = await supabase
                    .from('unget_configs')
                    .select('id,unget_id,url')
                    .eq('username', username);
                const aRetirar = connectionsToRetire(
                    (mias || []).map((fila: any) => ({ id: fila.id, ungetId: fila.unget_id, url: fila.url })),
                    configs.map((c: any) => ({ ungetId: c.ungetId || c.id, url: c.url }))
                ).map((fila) => fila.id);
                if (aRetirar.length > 0) {
                    await supabase.from('unget_configs').delete().in('id', aRetirar);
                }
            }
            localStorage.setItem(`aura_sig_ungets_${username}`, JSON.stringify(configs));
            return { success: true };
        } catch(e: any) {
            return { success: false, message: e.message };
        }
    },

    getSubscriptions: async (username: string): Promise<string[]> => {
        try {
            if (supabase) {
                // First try user_subscriptions just in case the migration was run
                const { data: subData, error: subError } = await supabase
                    .from('user_subscriptions')
                    .select('subscribed_username')
                    .eq('username', username);
                
                if (!subError && subData) {
                    return subData.map((d: any) => d.subscribed_username);
                }

                // Fallback to system_config
                const { data: configData, error: configError } = await supabase
                    .from('system_config')
                    .select('value')
                    .eq('key', `subscriptions_${username}`)
                    .single();
                
                if (!configError && configData && configData.value) {
                    return Array.isArray(configData.value) ? configData.value : [];
                }
            }
        } catch(e) {
            console.warn("Error fetching subscriptions from Supabase:", e);
        }
        
        const saved = localStorage.getItem(`aura_sig_subs_${username}`);
        return saved ? JSON.parse(saved) : [];
    },

    saveSubscriptions: async (username: string, subscribedUsernames: string[]): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                // Try saving in system_config via upsert to avoid requiring the migration immediately
                const { error: configError } = await supabase
                    .from('system_config')
                    .upsert({ 
                        key: `subscriptions_${username}`, 
                        value: subscribedUsernames 
                    }, { onConflict: 'key' });

                if (configError) throw configError;

                // Also attempt to save to user_subscriptions if it exists, without strictly failing
                try {
                    await supabase.from('user_subscriptions').delete().eq('username', username);
                    if (subscribedUsernames.length > 0) {
                        const rows = subscribedUsernames.map(subUsername => ({
                            username,
                            subscribed_username: subUsername
                        }));
                        await supabase.from('user_subscriptions').insert(rows);
                    }
                } catch(e) {
                    // Ignore errors if table doesn't exist
                }
            }
            localStorage.setItem(`aura_sig_subs_${username}`, JSON.stringify(subscribedUsernames));
            return { success: true };
        } catch(e: any) {
            console.error("Error saving subscriptions in Supabase:", e);
            localStorage.setItem(`aura_sig_subs_${username}`, JSON.stringify(subscribedUsernames));
            return { success: false, message: e.message };
        }
    },

    // Aquí vivía `saveMultipleUngetConfigs`, que borraba por usuario y volvía a insertar.
    // Ese patrón choca con el índice único de `unget_id` y le quita la conexión a su
    // informático; es justo lo que se corrigió en `saveUngetConfigs`. No lo llamaba nadie,
    // así que se retira en vez de dejarlo como trampa para el próximo que lo encuentre.

    // --- STOCK ASSIGNMENTS (ADMIN TO USER) ---
    getAllStockAssignments: async (): Promise<any[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('facility_stock_assignments').select('*');
                if (!error && data) {
                    return data.map(d => ({
                        id: d.id,
                        adminUsername: d.admin_username,
                        facilityCode: d.facility_code,
                        sheetName: d.sheet_name,
                        sheetUrl: d.sheet_url,
                        ungetId: d.unget_id || undefined,
                        visibleColumns: d.visible_columns || [],
                        createdAt: d.created_at
                    }));
                }
            }
        } catch(e) {}
        return [];
    },

    getStockAssignmentsByAdmin: async (adminUsername: string): Promise<any[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('facility_stock_assignments').select('*').eq('admin_username', adminUsername);
                if (!error && data) {
                    return data.map(d => ({
                        id: d.id,
                        adminUsername: d.admin_username,
                        facilityCode: d.facility_code,
                        sheetName: d.sheet_name,
                        sheetUrl: d.sheet_url,
                        ungetId: d.unget_id || undefined,
                        visibleColumns: d.visible_columns || [],
                        createdAt: d.created_at
                    }));
                }
            }
        } catch(e) {}
        return [];
    },

    getMyStockAssignments: async (facilityCode: string): Promise<any[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('facility_stock_assignments').select('*').eq('facility_code', facilityCode);
                if (!error && data) {
                    return data.map(d => ({
                        id: d.id,
                        adminUsername: d.admin_username,
                        facilityCode: d.facility_code,
                        sheetName: d.sheet_name,
                        sheetUrl: d.sheet_url,
                        ungetId: d.unget_id || undefined,
                        visibleColumns: d.visible_columns || [],
                        createdAt: d.created_at
                    }));
                }
            }
        } catch(e) {}
        return [];
    },

    /**
     * Columnas que un establecimiento puede ver de su stock.
     *
     * Sustituye a `saveStockAssignment` / `updateStockAssignment`. Desde que el vínculo
     * establecimiento ↔ hoja se deduce del código (`services/facilitySheetLink.ts`), lo único
     * que se decide a mano son las columnas, así que la fila se identifica por el
     * establecimiento y nada más: una fila por establecimiento, se cree o se actualice.
     *
     * `sheet_name` y `sheet_url` se siguen escribiendo porque la tabla los exige y porque son
     * la red de las asignaciones anteriores a este cambio, pero ya no deciden nada.
     *
     * **Ya no se comprueba que una hoja pertenezca a un solo establecimiento**, y es a
     * propósito: un puesto comunal comparte la hoja de su IPRESS por diseño, y esa
     * comprobación lo habría rechazado. Que dos establecimientos reclamen la misma hoja es
     * ahora imposible salvo por códigos repetidos, y eso lo detecta el propio vínculo como
     * `ambigua` en vez de resolverlo mal.
     */
    saveStockColumnPreferences: async (assignment: {
        adminUsername: string;
        facilityCode: string;
        sheetName?: string;
        sheetUrl?: string;
        ungetId?: string | null;
        visibleColumns: string[];
    }): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { data: existing, error: errFac } = await supabase
                    .from('facility_stock_assignments')
                    .select('id')
                    .eq('facility_code', assignment.facilityCode)
                    .maybeSingle();
                if (errFac) throw errFac;

                const fila = {
                    admin_username: assignment.adminUsername,
                    sheet_name: assignment.sheetName || '',
                    sheet_url: assignment.sheetUrl || '',
                    // La asignación pertenece a la UNGET: su URL puede cambiar.
                    unget_id: assignment.ungetId || null,
                    visible_columns: assignment.visibleColumns
                };

                if (existing) {
                    const { error } = await supabase
                        .from('facility_stock_assignments')
                        .update(fila)
                        .eq('id', existing.id);
                    if (error) throw error;
                    return { success: true };
                }

                const { error } = await supabase
                    .from('facility_stock_assignments')
                    .insert({ ...fila, facility_code: assignment.facilityCode });
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    deleteStockAssignment: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('facility_stock_assignments').delete().eq('id', id);
                if (error) throw error;
                return { success: true };
            }
        } catch(e: any) {
            return { success: false, message: e.message };
        }
        return { success: false, message: "No Supabase connected" };
    },

    // --- DYNAMIC LABOR REGIMES (CRUD) ---
    getLaborRegimes: async (): Promise<any[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('labor_regimes').select('*').order('name');
                if (!error && data) {
                    return data.map(r => ({
                        id: r.id,
                        name: r.name,
                        description: r.description || ''
                    }));
                }
            }
        } catch (e) {
            console.warn("Offline fallback for labor_regimes", e);
        }

        const cached = localStorage.getItem('aura_labor_regimes');
        if (cached) return JSON.parse(cached);
        return MOCK_DB.laborRegimes;
    },

    saveLaborRegime: async (item: any): Promise<{ success: boolean; message?: string }> => {
        try {
            const targetId = item.id || ('LR-' + Date.now());
            if (supabase) {
                const { error } = await supabase.from('labor_regimes').upsert({
                    id: targetId,
                    name: item.name,
                    description: item.description || null
                });
                if (error) throw error;
            }
            
            const current = await api.getLaborRegimes();
            const exists = current.find(c => c.id === targetId);
            let updatedList;
            if (exists) {
                updatedList = current.map(c => c.id === targetId ? { ...c, name: item.name, description: item.description || '' } : c);
            } else {
                updatedList = [...current, { id: targetId, name: item.name, description: item.description || '' }];
            }
            localStorage.setItem('aura_labor_regimes', JSON.stringify(updatedList));
            return { success: true };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    deleteLaborRegime: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('labor_regimes').delete().eq('id', id);
                if (error) throw error;
            }
            const current = await api.getLaborRegimes();
            const updatedList = current.filter(c => c.id !== id);
            localStorage.setItem('aura_labor_regimes', JSON.stringify(updatedList));
            return { success: true };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    // --- DYNAMIC PROFESSIONS (CRUD) ---
    getProfessions: async (): Promise<any[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase.from('professions').select('*').order('name');
                if (!error && data) {
                    return data.map(p => ({
                        id: p.id,
                        name: p.name,
                        description: p.description || ''
                    }));
                }
            }
        } catch (e) {
            console.warn("Offline fallback for professions", e);
        }

        const cached = localStorage.getItem('aura_professions');
        if (cached) return JSON.parse(cached);
        return MOCK_DB.professions;
    },

    saveProfession: async (item: any): Promise<{ success: boolean; message?: string }> => {
        try {
            const targetId = item.id || ('PROF-' + Date.now());
            if (supabase) {
                const { error } = await supabase.from('professions').upsert({
                    id: targetId,
                    name: item.name,
                    description: item.description || null
                });
                if (error) throw error;
            }
            
            const current = await api.getProfessions();
            const exists = current.find(c => c.id === targetId);
            let updatedList;
            if (exists) {
                updatedList = current.map(c => c.id === targetId ? { ...c, name: item.name, description: item.description || '' } : c);
            } else {
                updatedList = [...current, { id: targetId, name: item.name, description: item.description || '' }];
            }
            localStorage.setItem('aura_professions', JSON.stringify(updatedList));
            return { success: true };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    deleteProfession: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('professions').delete().eq('id', id);
                if (error) throw error;
            }
            const current = await api.getProfessions();
            const updatedList = current.filter(c => c.id !== id);
            localStorage.setItem('aura_professions', JSON.stringify(updatedList));
            return { success: true };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    getSyncInstallations: async (): Promise<any[]> => {
        try {
            if (supabase) {
                const { data, error } = await supabase
                    .from('sync_installations')
                    .select('*, facilities(*)');
                if (!error && data) return data;
            }
        } catch (e) {
            console.error(e);
        }
        return [];
    },

    createSyncInstallation: async (installation: {
        facilityCode: string;
        pcName: string;
        sismedPath?: string;
        isActive: boolean;
        allowedAlmcods?: string[];
    }): Promise<{ success: boolean; rawToken?: string; installation?: any; message?: string }> => {
        try {
            if (!supabase) throw new Error("No conectado a Supabase");

            const randomBody = Array.from({ length: 21 }, () => {
                const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
                return chars.charAt(Math.floor(Math.random() * chars.length));
            }).join("");
            const rawToken = `sismed_${randomBody}`;
            
            const msgBuffer = new TextEncoder().encode(rawToken);
            const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            const { data, error } = await supabase
                .from('sync_installations')
                .insert({
                    token_hash: tokenHash,
                    facility_code: installation.facilityCode,
                    pc_name: installation.pcName,
                    sismed_path: installation.sismedPath || null,
                    is_active: installation.isActive,
                    allowed_almcods: installation.allowedAlmcods && installation.allowedAlmcods.length > 0 ? installation.allowedAlmcods : null
                })
                .select()
                .single();

            if (error) throw error;

            return {
                success: true,
                rawToken,
                installation: data
            };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    updateSyncInstallationStatus: async (id: string, isActive: boolean): Promise<{ success: boolean; message?: string }> => {
        try {
            if (!supabase) throw new Error("No conectado a Supabase");
            const { error } = await supabase
                .from('sync_installations')
                .update({ is_active: isActive })
                .eq('id', id);

            if (error) throw error;
            return { success: true };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    regenerateSyncInstallationKey: async (id: string): Promise<{ success: boolean; rawToken?: string; message?: string }> => {
        try {
            if (!supabase) throw new Error("No conectado a Supabase");

            const randomBody = Array.from({ length: 21 }, () => {
                const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
                return chars.charAt(Math.floor(Math.random() * chars.length));
            }).join("");
            const rawToken = `sismed_${randomBody}`;

            const msgBuffer = new TextEncoder().encode(rawToken);
            const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            const { error } = await supabase
                .from('sync_installations')
                .update({ token_hash: tokenHash })
                .eq('id', id);

            if (error) throw error;

            return {
                success: true,
                rawToken
            };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    deleteSyncInstallation: async (id: string): Promise<{ success: boolean; message?: string }> => {
        try {
            if (!supabase) throw new Error("No conectado a Supabase");
            const { error } = await supabase
                .from('sync_installations')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return { success: true };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    getSyncRuns: async (facilityCodes?: string[]): Promise<any[]> => {
        try {
            if (supabase) {
                let query = supabase.from('sync_runs').select('*, sync_installations(*)');
                if (facilityCodes && facilityCodes.length > 0) {
                    query = query.in('facility_code', facilityCodes);
                }
                const { data, error } = await query.order('started_at', { ascending: false }).limit(200);
                if (!error && data) return data;
            }
        } catch (e) {
            console.error(e);
        }
        return [];
    },

    getStockActual: async (facilityCodes?: string[]): Promise<any[]> => {
        try {
            if (supabase) {
                let allData: any[] = [];
                let from = 0;
                let step = 999;
                let fetchMore = true;

                while (fetchMore) {
                    let query = supabase.from('stock_actual').select('*');
                    if (facilityCodes && facilityCodes.length > 0) {
                        query = query.in('facility_code', facilityCodes);
                    }
                    const { data, error } = await query.range(from, from + step);
                    if (error) {
                        console.error("Error fetching stock:", error);
                        break;
                    }
                    if (data && data.length > 0) {
                        allData = [...allData, ...data];
                        if (data.length < (step + 1)) {
                            fetchMore = false;
                        } else {
                            from += step + 1;
                        }
                    } else {
                        fetchMore = false;
                    }
                }
                return allData;
            }
        } catch (e) {
            console.error(e);
        }
        return [];
    },

    deleteStockActualByAlmcod: async (almcod: string): Promise<boolean> => {
        try {
            if (supabase) {
                const { error } = await supabase.from('stock_actual').delete().eq('almcod', almcod);
                if (error) {
                    console.error("Error deleting stock:", error);
                    return false;
                }
                return true;
            }
        } catch (e) {
            console.error(e);
        }
        return false;
    }
};
