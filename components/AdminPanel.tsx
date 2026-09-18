
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { RoleConfig, HealthFacility, AVAILABLE_MODULES, LaborRegime, Profession } from '../types';
import { Users, Shield, X, Sliders, Save, Clock, Link2, AlertTriangle, RefreshCw, UserPlus, Edit, Power, Building2, Briefcase, Trash2, Search, Filter, Phone, Mail, Lock, Calendar, FileSpreadsheet, Wrench } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import { AdminMigrationModule } from './AdminMigrationModule';
import { AdminOrganizationModule } from './AdminOrganizationModule';
import { AdminCatalogsModule } from './AdminCatalogsModule';
import { AdminSyncDevicesModule } from './AdminSyncDevicesModule';
import { CustomSelect } from './ui/CustomSelect';

export const AdminPanel: React.FC<{ currentView?: string }> = ({ currentView }) => {
  const activeTab = currentView ? currentView.replace('ADMIN_', '') as 'USERS' | 'ROLES' | 'PARAMS' | 'MIGRATION' | 'FACILITIES' | 'CATALOGS' | 'SYNC_DEVICES' : 'USERS';
  
  const getHeaderInfo = () => {
    switch (activeTab) {
      case 'USERS':
        return {
          title: "Gestión de Usuarios",
          description: "Administre el personal de salud, sus roles de acceso, adscripciones territoriales y permisos de la plataforma."
        };
      case 'ROLES':
        return {
          title: "Configuración de Roles",
          description: "Defina los permisos, alcances y niveles de seguridad de cada perfil de acceso en la plataforma."
        };
      case 'FACILITIES':
        return {
          title: "Establecimientos de Salud",
          description: "Gestione las DIRESAS, Redes, Unidades Ejecutoras, Microredes y los puntos de atención farmacéutica."
        };
      case 'PARAMS':
        return {
          title: "Parámetros del Sistema",
          description: "Configure los rangos de abastecimiento ideal, niveles de substock, sobrestock y alertas de la Ficha Técnica N° 30."
        };
      case 'CATALOGS':
        return {
          title: "Regímenes y Profesiones",
          description: "Administre los catálogos de regímenes laborales del personal de salud de la Ficha Técnica N° 30."
        };
      case 'MIGRATION':
        return {
          title: "Migración de Datos",
          description: "Sincronice e importe información de almacén desde bases de datos externas de manera segura."
        };
      case 'SYNC_DEVICES':
        return {
          title: "Dispositivos Sync SISMED 2.0",
          description: "Administre y autorice los dispositivos de escritorio del ToolKit Desktop para la sincronización directa de stock."
        };
      default:
        return {
          title: "Panel de Administración",
          description: "Gestión integral de usuarios, roles de acceso, establecimientos y parámetros del sistema."
        };
    }
  };

  const headerInfo = getHeaderInfo();
  
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<RoleConfig[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  
  // Lista de establecimientos para el combobox
  const [facilities, setFacilities] = useState<HealthFacility[]>([]);
  const [diresas, setDiresas] = useState<any[]>([]);
  const [ogess, setOgess] = useState<any[]>([]);
  const [ungets, setUngets] = useState<any[]>([]);
  const [microredes, setMicroredes] = useState<any[]>([]);

  // DYNAMIC CATALOGS FOR REGIMES AND PROFESSIONS
  const [laborRegimes, setLaborRegimes] = useState<LaborRegime[]>([]);
  const [professions, setProfessions] = useState<Profession[]>([]);

  const { systemConfig, updateSystemConfigContext, user: currentUser, refreshUserData, hasPermission } = useAuth();
  const [tempConfig, setTempConfig] = useState(systemConfig);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isRefreshingUsers, setIsRefreshingUsers] = useState(false);

  // --- USER DIRECTORY SEARCH & FILTERS STATE ---
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProfession, setFilterProfession] = useState('ALL');
  const [filterRole, setFilterRole] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterDiresa, setFilterDiresa] = useState('ALL');
  const [filterOgess, setFilterOgess] = useState('ALL');
  const [filterUnget, setFilterUnget] = useState('ALL');
  const [filterLaborRegime, setFilterLaborRegime] = useState('ALL');
  const [filterMicrored, setFilterMicrored] = useState('ALL');
  const [isFiltersSidebarOpen, setIsFiltersSidebarOpen] = useState(false);

  // --- USER MODAL STATE ---
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userModalStep, setUserModalStep] = useState(1);
  const [userModalLevel, setUserModalLevel] = useState<'GLOBAL' | 'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS' | ''>('');
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userForm, setUserForm] = useState({
      firstName: '',
      lastName: '',
      dni: '',
      email: '',
      phone: '',
      laborRegime: '',
      laborRegimeId: '',
      professionId: '',
      username: '',
      password: '',
      role: 'FARMACIA',
      facilityCode: '',
      diresaId: '',
      ogessId: '',
      ungetId: '',
      microredId: ''
  });

  // --- CONFIRMATION MODAL STATE ---
  const [userToToggle, setUserToToggle] = useState<{username: string, currentStatus: boolean} | null>(null);
  const [userToDelete, setUserToDelete] = useState<{username: string, personnelId: string | null} | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [viewingUser, setViewingUser] = useState<any | null>(null);

  // --- EDIT ROLE MODAL STATE ---
  const [isEditRoleModalOpen, setIsEditRoleModalOpen] = useState(false);
  const [editRoleForm, setEditRoleForm] = useState({ originalRole: '', role: '', label: '', jurisdictionLevel: '' as 'GLOBAL' | 'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS' | '' });

  // --- NEW ROLE MODAL STATE ---
  const [isNewRoleModalOpen, setIsNewRoleModalOpen] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({ role: '', label: '', maxUrlsAllowed: '', allowedModules: [], jurisdictionLevel: '' as 'GLOBAL' | 'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS' | '' });
  const [isSavingRole, setIsSavingRole] = useState(false);

  const [isRolesLoading, setIsRolesLoading] = useState(true);

  // Default tab logic is now handled by the parent component passing currentView

  useEffect(() => {
    // Initial load (uses cache if available)
    
    // Quick load from local storage
    const cachedRoles = localStorage.getItem('aura_roles_cache');
    if (cachedRoles) {
        try {
            setRoles(JSON.parse(cachedRoles));
            setIsRolesLoading(false);
        } catch (e) {}
    }

    const cachedUsers = localStorage.getItem('aura_users_cache');
    if (cachedUsers) {
        try {
            setUsers(JSON.parse(cachedUsers));
        } catch (e) {}
    }

    api.getUsers().then((data) => {
        setUsers(data);
        localStorage.setItem('aura_users_cache', JSON.stringify(data));
    });
    
    api.getRolesConfig().then((data) => {
        setRoles(data);
        if (data.length > 0 && !selectedRoleId) setSelectedRoleId(data[0].role);
        setIsRolesLoading(false);
        localStorage.setItem('aura_roles_cache', JSON.stringify(data));
    });
    
    // Cargar establecimientos REALES desde la Base de Datos
    api.getFacilities().then(data => {
        setFacilities(data);
    });
    api.getDiresas().then(setDiresas);
    api.getOgess().then(setOgess);
    api.getUngets().then(setUngets);
    api.getMicroredes().then(setMicroredes);

    // Cargar Catálogos dinámicos
    api.getLaborRegimes().then(setLaborRegimes);
    api.getProfessions().then(setProfessions);

    // Sync local state with context when context loads
    setTempConfig(systemConfig);
  }, [systemConfig]);

  const refreshCatalogs = () => {
      api.getLaborRegimes().then(setLaborRegimes);
      api.getProfessions().then(setProfessions);
  };

  const isSuperAdmin = currentUser?.role === 'ADMIN';
  const userDiresaId = currentUser?.personnelData?.diresaId || currentUser?.facilityData?.diresaId || (currentUser as any)?.diresaId;
  const userOgessId = currentUser?.personnelData?.ogessId || currentUser?.facilityData?.ogessId || (currentUser as any)?.ogessId;
  const userUngetId = currentUser?.personnelData?.ungetId || currentUser?.facilityData?.ungetId || (currentUser as any)?.ungetId;
  const userMicroredId = currentUser?.personnelData?.microredId || currentUser?.facilityData?.microredId || (currentUser as any)?.microredId;
  const userFacilityCode = currentUser?.personnelData?.facilityCode || currentUser?.facilityData?.code || (currentUser as any)?.facilityCode;

  // --- O(1) LOOKUP INDEX MAPS FOR HIGH-VOLUME SCALABILITY ---
  const ungetMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      ungets.forEach(un => { if (un?.id) map.set(un.id, un); });
      return map;
  }, [ungets]);

  const microredMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      microredes.forEach(mr => { if (mr?.id) map.set(mr.id, mr); });
      return map;
  }, [microredes]);

  const facilityMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      facilities.forEach(fac => { if (fac?.code) map.set(fac.code, fac); });
      return map;
  }, [facilities]);

  const professionMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      professions.forEach(pr => { if (pr?.id) map.set(pr.id, pr); });
      return map;
  }, [professions]);

  const laborRegimeMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      laborRegimes.forEach(lr => { if (lr?.id) map.set(lr.id, lr); });
      return map;
  }, [laborRegimes]);

  const diresaMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      diresas.forEach(d => { if (d?.id) map.set(d.id, d); });
      return map;
  }, [diresas]);

  const ogessMapLookup = useMemo(() => {
      const map = new Map<string, any>();
      ogess.forEach(o => { if (o?.id) map.set(o.id, o); });
      return map;
  }, [ogess]);

  // Helper to compute a user's full geographical footprint, accessible globally in the component
  const getExpandedHierarchy = useCallback((usr: any) => {
      const p = usr.personnel || usr.personnelData || usr;
      if (!p) return { diresaId: '', ogessId: '', ungetId: '', microredId: '', facilityCode: '' };

      let diresaId = p.diresaId || '';
      let ogessId = p.ogessId || '';
      let ungetId = p.ungetId || '';
      let microredId = p.microredId || '';
      const facilityCode = p.facilityCode || '';

      if (facilityCode) {
          const f = facilityMapLookup.get(facilityCode);
          if (f) {
              if (f.microredId && !microredId) microredId = f.microredId;
              if (f.ungetId && !ungetId) ungetId = f.ungetId;
              if (f.ogessId && !ogessId) ogessId = f.ogessId;
              if (f.diresaId && !diresaId) diresaId = f.diresaId;
          }
      }

      if (microredId) {
          const m = microredMapLookup.get(microredId);
          if (m) {
              if (m.ungetId && !ungetId) ungetId = m.ungetId;
              if (m.ungetId) {
                  const un = ungetMapLookup.get(m.ungetId);
                  if (un) {
                      if (un.ogessId && !ogessId) ogessId = un.ogessId;
                      if (un.diresaId && !diresaId) diresaId = un.diresaId;
                  }
              }
          }
      }

      if (ungetId) {
          const un = ungetMapLookup.get(ungetId);
          if (un) {
              if (un.ogessId && !ogessId) ogessId = un.ogessId;
              if (un.diresaId && !diresaId) diresaId = un.diresaId;
          }
      }

      if (ogessId) {
          const og = ogess.find(o => o.id === ogessId);
          if (og && og.diresaId && !diresaId) {
              diresaId = og.diresaId;
          }
      }

      return { diresaId, ogessId, ungetId, microredId, facilityCode };
  }, [facilityMapLookup, microredMapLookup, ungetMapLookup, ogess]);

  const filteredUsers = useMemo(() => {
      // 1. Hierarchy filter (authorized users list)
      let list = users;
      if (!isSuperAdmin) {
          list = users.filter(u => {
              const target = getExpandedHierarchy(u);
              
              if (userFacilityCode) return target.facilityCode === userFacilityCode;
              if (userMicroredId) return target.microredId === userMicroredId;
              if (userUngetId) return target.ungetId === userUngetId;
              if (userOgessId) return target.ogessId === userOgessId;
              if (userDiresaId) return target.diresaId === userDiresaId;

              return false;
          });
      }

      // 2. Filter by search query (name, username, dni, email, phone)
      if (searchTerm.trim() !== '') {
          const s = searchTerm.toLowerCase();
          list = list.filter(u => {
              const firstName = u.personnel?.firstName || '';
              const lastName = u.personnel?.lastName || '';
              const fullName = `${firstName} ${lastName}`.toLowerCase();
              const username = (u.username || '').toLowerCase();
              const dni = (u.personnel?.dni || '').toLowerCase();
              const email = (u.personnel?.email || '').toLowerCase();
              const phone = (u.personnel?.phone || '').toLowerCase();
              return fullName.includes(s) || username.includes(s) || dni.includes(s) || email.includes(s) || phone.includes(s);
          });
      }

      // 3. Filter by Profession
      if (filterProfession !== 'ALL') {
          list = list.filter(u => u.personnel?.professionId === filterProfession || u.personnel?.professionData?.id === filterProfession);
      }

      // 4. Filter by Role
      if (filterRole !== 'ALL') {
          list = list.filter(u => (u.role || '').toUpperCase() === filterRole.toUpperCase());
      }

      // 5. Filter by Status
      if (filterStatus !== 'ALL') {
          list = list.filter(u => {
              const uActive = u.isActive === true || String(u.isActive).toLowerCase() === 'true';
              return filterStatus === 'ACTIVE' ? uActive : !uActive;
          });
      }

      // 6. Filter by DIRESA
      if (filterDiresa !== 'ALL') {
          list = list.filter(u => {
              const target = getExpandedHierarchy(u);
              return target.diresaId === filterDiresa;
          });
      }

      // 7. Filter by OGESS
      if (filterOgess !== 'ALL') {
          list = list.filter(u => {
              const target = getExpandedHierarchy(u);
              return target.ogessId === filterOgess;
          });
      }

      // 8. Filter by UNGET
      if (filterUnget !== 'ALL') {
          list = list.filter(u => {
              const target = getExpandedHierarchy(u);
              return target.ungetId === filterUnget;
          });
      }

      // 9. Filter by Labor Regime
      if (filterLaborRegime !== 'ALL') {
          list = list.filter(u => u.personnel?.laborRegimeId === filterLaborRegime);
      }

      // 10. Filter by Microred
      if (filterMicrored !== 'ALL') {
          list = list.filter(u => {
              const target = getExpandedHierarchy(u);
              return target.microredId === filterMicrored;
          });
      }

      return list;
  }, [
      users, isSuperAdmin, userDiresaId, userOgessId, userUngetId, userMicroredId, userFacilityCode,
      searchTerm, filterProfession, filterRole, filterStatus, filterDiresa, filterOgess, filterUnget, filterLaborRegime, filterMicrored,
      facilityMapLookup, microredMapLookup, ungetMapLookup, ogess, getExpandedHierarchy
  ]);

  const HIERARCHY_WEIGHTS: Record<string, number> = {
      'GLOBAL': 100,
      'DIRESA': 80,
      'OGESS': 60,
      'UNGET': 40,
      'MICRORED': 20,
      'IPRESS': 0,
      '': -1
  };

  const getLevelForRole = (roleKey: string): 'GLOBAL' | 'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS' | '' => {
      const config = roles.find(r => r.role === roleKey);
      if (config && config.jurisdictionLevel) {
          return config.jurisdictionLevel;
      }
      
      // Fallback if not configured yet
      const r = (roleKey || '').toUpperCase();
      if (r === 'ADMIN' || r === 'GLOBAL' || r.includes('SUPER') || r.includes('GENERAL') || r === 'ADMINISTRADOR') return 'GLOBAL';
      if (r.includes('DIRESA')) return 'DIRESA';
      if (r.includes('OGESS')) return 'OGESS';
      if (r.includes('UNGET')) return 'UNGET';
      if (r.includes('MICRORED')) return 'MICRORED';
      if (r.includes('FARMACIA') || r.includes('IPRESS') || r.includes('PERSONAL')) return 'IPRESS';
      return '';
  };

  const isStep1Valid = useMemo(() => {
      const f = userForm;
      return !!(f.firstName && f.lastName && f.dni);
  }, [userForm]);

  const isStep2Valid = useMemo(() => {
      const f = userForm;
      return !!(f.username && (editingUser || f.password) && f.role);
  }, [userForm, editingUser]);

  const isStep3Valid = useMemo(() => {
      if (!userModalLevel) return false;
      if (userModalLevel === 'GLOBAL') return true;
      if (userModalLevel === 'DIRESA') return !!userForm.diresaId;
      if (userModalLevel === 'OGESS') return !!userForm.ogessId;
      if (userModalLevel === 'UNGET') return !!userForm.ungetId;
      if (userModalLevel === 'MICRORED') return !!userForm.microredId;
      if (userModalLevel === 'IPRESS') return !!userForm.facilityCode;
      return false;
  }, [userModalLevel, userForm]);

  const resolvedHierarchy = useMemo(() => {
      const info = { diresa: '', ogess: '', unget: '', microred: '', ipress: '' };
      if (userModalLevel === 'IPRESS' && userForm.facilityCode) {
          const f = facilities.find(fac => fac.code === userForm.facilityCode);
          if (f) {
              info.ipress = f.name;
              const m = microredes.find(mr => mr.id === f.microredId);
              if (m) {
                  info.microred = m.name;
                  const un = ungets.find(u => u.id === m.ungetId);
                  if (un) {
                      info.unget = un.name;
                      const og = ogess.find(o => o.id === un.ogessId);
                      if (og) {
                          info.ogess = og.name;
                          const di = diresas.find(d => d.id === og.diresaId);
                          if (di) info.diresa = di.name;
                      }
                  }
              } else {
                  const un = ungets.find(u => u.id === f.ungetId);
                  if (un) info.unget = un.name;
                  const og = ogess.find(o => o.id === f.ogessId);
                  if (og) info.ogess = og.name;
                  const di = diresas.find(d => d.id === f.diresaId);
                  if (di) info.diresa = di.name;
              }
          }
      } else if (userModalLevel === 'MICRORED' && userForm.microredId) {
          const m = microredes.find(mr => mr.id === userForm.microredId);
          if (m) {
              info.microred = m.name;
              const un = ungets.find(u => u.id === m.ungetId);
              if (un) {
                  info.unget = un.name;
                  const og = ogess.find(o => o.id === un.ogessId);
                  if (og) {
                      info.ogess = og.name;
                      const di = diresas.find(d => d.id === og.diresaId);
                      if (di) info.diresa = di.name;
                  }
              }
          }
      } else if (userModalLevel === 'UNGET' && userForm.ungetId) {
          const un = ungets.find(u => u.id === userForm.ungetId);
          if (un) {
              info.unget = un.name;
              const og = ogess.find(o => o.id === un.ogessId);
              if (og) {
                  info.ogess = og.name;
                  const di = diresas.find(d => d.id === og.diresaId);
                  if (di) info.diresa = di.name;
              }
          }
      } else if (userModalLevel === 'OGESS' && userForm.ogessId) {
          const og = ogess.find(o => o.id === userForm.ogessId);
          if (og) {
              info.ogess = og.name;
              const di = diresas.find(d => d.id === og.diresaId);
              if (di) info.diresa = di.name;
          }
      } else if (userModalLevel === 'DIRESA' && userForm.diresaId) {
          const di = diresas.find(d => d.id === userForm.diresaId);
          if (di) info.diresa = di.name;
      }
      return info;
  }, [userModalLevel, userForm, facilities, microredes, ungets, ogess, diresas]);

  const handleRefreshUsers = async () => {
      setIsRefreshingUsers(true);
      // Force refresh bypasses cache
      const updatedUsers = await api.getUsers(true);
      if (updatedUsers && updatedUsers.length > 0) {
          setUsers(updatedUsers);
          localStorage.setItem('aura_users_cache', JSON.stringify(updatedUsers));
      }
      setIsRefreshingUsers(false);
  };

  const handleExportPersonnelExcel = useCallback(() => {
      const listToExport = filteredUsers.length > 0 ? filteredUsers : users;

      if (!listToExport || listToExport.length === 0) {
          toast.error('No hay registros de personal disponibles para exportar');
          return;
      }

      const toastId = toast.loading(`Generando archivo Excel con ${listToExport.length} registros...`);

      try {
          // Ordenar alfabéticamente por apellidos y nombres (o nombre de usuario)
          const sorted = [...listToExport].sort((a: any, b: any) => {
              const nameA = a.personnel ? `${a.personnel.lastName || ''} ${a.personnel.firstName || ''}`.trim() : (a.username || '');
              const nameB = b.personnel ? `${b.personnel.lastName || ''} ${b.personnel.firstName || ''}`.trim() : (b.username || '');
              return nameA.localeCompare(nameB, 'es', { sensitivity: 'base', numeric: true });
          });

          const rows = sorted.map((u: any, index: number) => {
              const isUserActive = u.isActive === true || String(u.isActive).toLowerCase() === 'true';
              const rObj = roles.find(r => r.role === u.role);
              const level = rObj?.jurisdictionLevel || '';
              const h = getExpandedHierarchy(u);

              let jurisdictionName = '-';
              if (level === 'GLOBAL') {
                  jurisdictionName = 'Nacional';
              } else if (level === 'DIRESA' || u.role === 'DIRESA') {
                  jurisdictionName = diresaMapLookup.get(h.diresaId)?.name || '-';
              } else if (level === 'OGESS' || u.role === 'OGESS') {
                  jurisdictionName = ogessMapLookup.get(h.ogessId)?.name || '-';
              } else if (level === 'UNGET' || u.role === 'UNGET') {
                  jurisdictionName = ungetMapLookup.get(h.ungetId)?.name || '-';
              } else if (level === 'MICRORED' || u.role === 'MICRORED') {
                  jurisdictionName = microredMapLookup.get(h.microredId)?.name || '-';
              } else if (level === 'IPRESS' || u.role === 'IPRESS') {
                  jurisdictionName = facilityMapLookup.get(h.facilityCode)?.name || '-';
              } else {
                  if (h.ungetId) {
                      jurisdictionName = ungetMapLookup.get(h.ungetId)?.name || '-';
                  } else if (h.ogessId) {
                      jurisdictionName = ogessMapLookup.get(h.ogessId)?.name || '-';
                  } else if (h.diresaId) {
                      jurisdictionName = diresaMapLookup.get(h.diresaId)?.name || '-';
                  } else if (h.facilityCode) {
                      jurisdictionName = facilityMapLookup.get(h.facilityCode)?.name || '-';
                  }
              }

              const p = u.personnel;
              const firstName = p?.firstName || '';
              const lastName = p?.lastName || '';
              const fullName = p ? `${firstName} ${lastName}`.trim() : (u.username || '-');
              const professionName = p?.professionData?.name || professionMapLookup.get(p?.professionId)?.name || '-';
              const laborRegimeName = p?.laborRegimeData?.name || laborRegimeMapLookup.get(p?.laborRegimeId)?.name || p?.laborRegime || '-';

              const diresaName = diresaMapLookup.get(h.diresaId)?.name || '-';
              const ogessName = ogessMapLookup.get(h.ogessId)?.name || '-';
              const ungetName = ungetMapLookup.get(h.ungetId)?.name || '-';
              const microredName = microredMapLookup.get(h.microredId)?.name || '-';
              const facilityName = h.facilityCode ? (facilityMapLookup.get(h.facilityCode)?.name || '-') : '-';

              let formattedBirthDate = '-';
              if (p?.birthDate) {
                  try {
                      formattedBirthDate = String(p.birthDate).split('T')[0];
                  } catch {
                      formattedBirthDate = String(p.birthDate);
                  }
              }

              let formattedCreatedAt = '-';
              if (u.created_at) {
                  try {
                      formattedCreatedAt = new Date(u.created_at).toLocaleString('es-PE');
                  } catch {
                      formattedCreatedAt = String(u.created_at);
                  }
              }

              return {
                  'N°': index + 1,
                  'DNI': p?.dni || u.dni || '-',
                  'APELLIDOS': lastName || '-',
                  'NOMBRES': firstName || '-',
                  'NOMBRE COMPLETO': fullName,
                  'PROFESIÓN': professionName,
                  'RÉGIMEN LABORAL': laborRegimeName,
                  'TELÉFONO / CELULAR': p?.phone || u.phone || '-',
                  'CORREO ELECTRÓNICO': p?.email || u.email || '-',
                  'FECHA DE NACIMIENTO': formattedBirthDate,
                  'USUARIO (LOGIN)': u.username || '-',
                  'ROL': u.role || '-',
                  'DESCRIPCIÓN DE ROL': rObj?.label || u.role || '-',
                  'NIVEL DE JURISDICCIÓN': level || '-',
                  'JURISDICCIÓN ASIGNADA': jurisdictionName,
                  'DIRESA': diresaName,
                  'OGESS / RED DE SALUD': ogessName,
                  'UNGET / PROVINCIA': ungetName,
                  'MICRORED': microredName,
                  'CÓDIGO IPRESS': h.facilityCode || '-',
                  'ESTABLECIMIENTO (IPRESS)': facilityName,
                  'ESTADO DE CUENTA': isUserActive ? 'ACTIVO' : 'INACTIVO',
                  'FECHA DE REGISTRO': formattedCreatedAt
              };
          });

          const ws = XLSX.utils.json_to_sheet(rows);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Personal SISMED");

          ws['!cols'] = [
              { wch: 6 },  // N°
              { wch: 13 }, // DNI
              { wch: 22 }, // APELLIDOS
              { wch: 22 }, // NOMBRES
              { wch: 32 }, // NOMBRE COMPLETO
              { wch: 24 }, // PROFESIÓN
              { wch: 20 }, // RÉGIMEN LABORAL
              { wch: 16 }, // TELÉFONO / CELULAR
              { wch: 28 }, // CORREO ELECTRÓNICO
              { wch: 16 }, // FECHA DE NACIMIENTO
              { wch: 18 }, // USUARIO (LOGIN)
              { wch: 14 }, // ROL
              { wch: 24 }, // DESCRIPCIÓN DE ROL
              { wch: 18 }, // NIVEL DE JURISDICCIÓN
              { wch: 26 }, // JURISDICCIÓN ASIGNADA
              { wch: 22 }, // DIRESA
              { wch: 26 }, // OGESS / RED DE SALUD
              { wch: 22 }, // UNGET / PROVINCIA
              { wch: 24 }, // MICRORED
              { wch: 14 }, // CÓDIGO IPRESS
              { wch: 32 }, // ESTABLECIMIENTO (IPRESS)
              { wch: 14 }, // ESTADO DE CUENTA
              { wch: 20 }, // FECHA DE REGISTRO
          ];

          const isFiltered = filteredUsers.length !== users.length || searchTerm.trim() !== '';
          const todayStr = new Date().toISOString().split('T')[0];
          const fileName = isFiltered 
              ? `Registro_Personal_SISMED_Filtrado_${todayStr}.xlsx` 
              : `Registro_Personal_SISMED_${todayStr}.xlsx`;

          XLSX.writeFile(wb, fileName);
          toast.success(`Excel descargado con éxito (${rows.length} registros)`, { id: toastId });
      } catch (err: any) {
          console.error("Error al exportar personal a Excel:", err);
          toast.error(`Error al generar el Excel: ${err?.message || 'Error desconocido'}`, { id: toastId });
      }
  }, [filteredUsers, users, roles, getExpandedHierarchy, diresaMapLookup, ogessMapLookup, ungetMapLookup, microredMapLookup, facilityMapLookup, professionMapLookup, laborRegimeMapLookup, searchTerm]);

  const handleSaveConfig = async () => {
      setIsSavingConfig(true);
      const toastId = toast.loading('Guardando parámetros...');
      
      console.log("Saving config:", tempConfig);
      const res = await api.updateSystemConfig(tempConfig);
      if (res.success) {
          updateSystemConfigContext(tempConfig);
          toast.success("Parámetros actualizados correctamente", { id: toastId });
      } else {
          toast.error("Error al guardar configuración", { id: toastId });
      }
      setIsSavingConfig(false);
  };

  // --- USER ACTIONS ---

  const handleAddUserClick = () => {
      setEditingUser(null);
      // Refetch all master data to ensure newly registered entities appear immediately
      api.getFacilities().then(setFacilities);
      api.getDiresas().then(setDiresas);
      api.getOgess().then(setOgess);
      api.getUngets().then(setUngets);
      api.getMicroredes().then(setMicroredes);
      api.getLaborRegimes().then(setLaborRegimes);
      api.getProfessions().then(setProfessions);

      setUserForm({
          firstName: '', lastName: '', dni: '', email: '', phone: '', laborRegime: '', laborRegimeId: '', professionId: '', username: '', password: '', role: 'FARMACIA', facilityCode: '', diresaId: '', ogessId: '', ungetId: '', microredId: ''
      });
      setUserModalStep(1);
      setUserModalLevel(getLevelForRole('FARMACIA'));
      setIsUserModalOpen(true);
  };

  const handleEditUserClick = (u: any) => {
      setEditingUser(u);
      // Refetch all master data to ensure newly registered entities appear immediately
      api.getFacilities().then(setFacilities);
      api.getDiresas().then(setDiresas);
      api.getOgess().then(setOgess);
      api.getUngets().then(setUngets);
      api.getMicroredes().then(setMicroredes);
      api.getLaborRegimes().then(setLaborRegimes);
      api.getProfessions().then(setProfessions);

      setUserForm({
          firstName: u.personnel?.firstName || '',
          lastName: u.personnel?.lastName || '',
          dni: u.personnel?.dni || '',
          email: u.personnel?.email || '',
          phone: u.personnel?.phone || '',
          laborRegime: u.personnel?.laborRegime || '',
          laborRegimeId: u.personnel?.laborRegimeId || '',
          professionId: u.personnel?.professionId || '',
          username: u.username,
          password: '',
          role: u.role,
          facilityCode: u.personnel?.facilityCode || '',
          diresaId: u.personnel?.diresaId || '',
          ogessId: u.personnel?.ogessId || '',
          ungetId: u.personnel?.ungetId || '',
          microredId: u.personnel?.microredId || ''
      });
      setUserModalStep(1);
      
      const level = getLevelForRole(u.role);
      setUserModalLevel(level);

      setIsUserModalOpen(true);
  };

  const handleToggleStatus = (username: string, currentStatus: any) => {
      // Determinación robusta del estado actual (maneja booleanos y strings 'TRUE'/'FALSE')
      const isCurrentlyActive = currentStatus === true || String(currentStatus).toLowerCase() === 'true';
      setUserToToggle({ username, currentStatus: isCurrentlyActive });
  };

  const executeToggleStatus = async () => {
      if (!userToToggle) return;
      const { username, currentStatus } = userToToggle;
      const newStatus = !currentStatus;
      
      // Cerrar modal
      setUserToToggle(null);

      // --- ACTUALIZACIÓN OPTIMISTA (Instantánea) ---
      const originalUsers = [...users];
      const newUsers = originalUsers.map(u => u.username === username ? { ...u, isActive: newStatus } : u);
      setUsers(newUsers);
      localStorage.setItem('aura_users_cache', JSON.stringify(newUsers));
      
      const toastId = toast.loading('Actualizando estado...');

      // Llamada en segundo plano
      try {
          const res = await api.toggleUserStatus(username, newStatus);
          
          if(!res.success) {
              throw new Error(res.message);
          } else {
              toast.success(`Usuario ${newStatus ? 'activado' : 'inactivado'}`, { id: toastId });
              // Si el usuario se inactiva a sí mismo o cambia algo que requiere refresco
              if (currentUser && username === currentUser.username) {
                  await refreshUserData();
              }
          }
      } catch (e: any) {
          // Si falla, revertimos los cambios y mostramos error en UI (no alert)
          setUsers(originalUsers);
          toast.error("Error al actualizar: " + e.message, { id: toastId });
      }
  };

  const executeDeleteUser = async () => {
      if (!userToDelete) return;
      const { username, personnelId } = userToDelete;
      
      setUserToDelete(null);
      setIsDeletingUser(true);
      const toastId = toast.loading('Eliminando usuario definitivamente...');
      
      try {
          const res = await api.adminDeleteUser(username, personnelId);
          if (res.success) {
              toast.success(`Usuario @${username} eliminado definitivamente`, { id: toastId });
              // Fetch clean lists
              const freshUsers = await api.getUsers(true);
              setUsers(freshUsers);
          } else {
              toast.error(`Error al eliminar usuario: ${res.message || 'Error desconocido'}`, { id: toastId });
          }
      } catch (e: any) {
          toast.error(`Error: ${e.message || 'Error de conexión'}`, { id: toastId });
      } finally {
          setIsDeletingUser(false);
      }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (userModalStep === 1) {
          if (isStep1Valid) {
              setUserModalStep(2);
          }
          return;
      }
      if (userModalStep === 2) {
          if (isStep2Valid) {
              setUserModalStep(3);
          }
          return;
      }
      
      if (!isStep3Valid) return;

      setIsSavingUser(true);
      const toastId = toast.loading(editingUser ? 'Actualizando usuario...' : 'Creando usuario...');

      const payload = {
          isNew: !editingUser,
          personnelId: editingUser?.personnelId,
          ...userForm
      };

      const res = await api.adminSaveUser(payload);
      if (res.success) {
          setIsUserModalOpen(false);
          await handleRefreshUsers(); // Recargamos la tabla
          toast.success(editingUser ? 'Usuario actualizado' : 'Usuario creado', { id: toastId });
          
          // Si el usuario editado es el mismo que está logueado, forzamos actualización de sesión
          if (currentUser && userForm.username === currentUser.username) {
              await refreshUserData();
          }

      } else {
          toast.error("Error al guardar: " + res.message, { id: toastId });
      }
      setIsSavingUser(false);
  };

  const handleRoleModuleChange = (roleName: string, module: string, isChecked: boolean) => {
      setRoles(prevRoles => prevRoles.map(r => {
          if (r.role === roleName) {
              const newModules = isChecked 
                  ? [...r.allowedModules, module as any]
                  : r.allowedModules.filter(m => m !== module);
              return { ...r, allowedModules: newModules };
          }
          return r;
      }));
  };

  const handleRoleMaxUrlsChange = (roleName: string, maxUrlsStr: string) => {
      const maxUrls = maxUrlsStr ? parseInt(maxUrlsStr) : undefined;
      setRoles(prevRoles => prevRoles.map(r => 
          r.role === roleName ? { ...r, maxUrlsAllowed: isNaN(maxUrls as any) ? undefined : maxUrls } : r
      ));
  };

  const handleSaveRoleConfig = async (roleConfig: RoleConfig) => {
      const toastId = toast.loading('Guardando cambios...');
      try {
          const res = await api.updateRoleConfig(roleConfig);
          if (res.success) {
              toast.success(`Rol ${roleConfig.label} actualizado`, { 
                  id: toastId,
                  description: 'Los permisos han sido modificados exitosamente.'
              });
              
              // Refresh roles to ensure sync
              const updatedRoles = await api.getRolesConfig();
              if (updatedRoles && updatedRoles.length > 0) {
                  setRoles(updatedRoles);
                  localStorage.setItem('aura_roles_cache', JSON.stringify(updatedRoles));
              }

              // FORCE REFRESH IF CURRENT USER IS AFFECTED
              if (currentUser && currentUser.role === roleConfig.role) {
                  await refreshUserData();
              }
          } else {
              toast.error(`Error al actualizar`, { 
                  id: toastId,
                  description: res.message 
              });
          }
      } catch (e) {
          // OFFLINE FALLBACK UI FEEDBACK
          toast.success(`Rol actualizado (Modo Offline)`, { 
              id: toastId, 
              description: "Los cambios se guardaron localmente." 
          });
          
          if (currentUser && currentUser.role === roleConfig.role) {
              await refreshUserData();
          }
      }
  };

  const handleOpenEditRole = (role: RoleConfig) => {
      setEditRoleForm({ originalRole: role.role, role: role.role, label: role.label, jurisdictionLevel: role.jurisdictionLevel || '' });
      setIsEditRoleModalOpen(true);
  };

  const handleSaveEditRole = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editRoleForm.role || !editRoleForm.label) return;
      
      setIsSavingRole(true);
      const newRoleCode = editRoleForm.role.toUpperCase().replace(/\s+/g, '_');
      
      const roleToUpdate = roles.find(r => r.role === editRoleForm.originalRole);
      if (!roleToUpdate) {
          setIsSavingRole(false);
          return;
      }

      const updatedRole: RoleConfig = {
          ...roleToUpdate,
          role: newRoleCode as any,
          oldRole: editRoleForm.originalRole as any,
          label: editRoleForm.label,
          jurisdictionLevel: editRoleForm.jurisdictionLevel as any || roleToUpdate.jurisdictionLevel
      };

      const toastId = toast.loading('Guardando cambios...');
      try {
          const res = await api.updateRoleConfig(updatedRole);
          if (res.success) {
              toast.success('Rol actualizado', { id: toastId });
              const updatedRoles = await api.getRolesConfig();
              if (updatedRoles && updatedRoles.length > 0) {
                  setRoles(updatedRoles);
                  localStorage.setItem('aura_roles_cache', JSON.stringify(updatedRoles));
                  if (selectedRoleId === editRoleForm.originalRole) setSelectedRoleId(updatedRole.role);
              }
              setIsEditRoleModalOpen(false);
          } else {
             toast.error("Error al actualizar rol: " + res.message, { id: toastId });
          }
      } catch (e: any) {
          toast.error("Error al actualizar rol (Offline)", { id: toastId });
      } finally {
          setIsSavingRole(false);
      }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSavingRole(true);
      const newRoleCode = newRoleForm.role.toUpperCase().replace(/\s+/g, '_');
      const maxUrls = parseInt(newRoleForm.maxUrlsAllowed);
      const newRoleConfig: RoleConfig = {
          role: newRoleCode as any,
          label: newRoleForm.label || newRoleCode,
          allowedModules: newRoleForm.allowedModules as any[],
          maxUrlsAllowed: isNaN(maxUrls) ? undefined : maxUrls,
          jurisdictionLevel: newRoleForm.jurisdictionLevel as any
      };

      const toastId = toast.loading('Creando rol...');
      try {
          const res = await api.updateRoleConfig(newRoleConfig);
          if (res.success) {
              toast.success(`Rol ${newRoleConfig.label} creado`, { id: toastId });
              const updatedRoles = await api.getRolesConfig();
              if (updatedRoles && updatedRoles.length > 0) {
                  setRoles(updatedRoles);
                  localStorage.setItem('aura_roles_cache', JSON.stringify(updatedRoles));
                  setSelectedRoleId(newRoleConfig.role);
              }
              setIsNewRoleModalOpen(false);
          } else {
             toast.error("Error al crear rol: " + res.message, { id: toastId });
          }
      } catch (e: any) {
          toast.error("Error al crear rol (Offline)", { id: toastId });
      } finally {
          setIsSavingRole(false);
      }
  };

  return (
    <>
    <div className="max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in slide-in-from-bottom-4">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">{headerInfo.title}</h2>
                <p className="text-gray-500 mt-2 text-sm font-medium">{headerInfo.description}</p>
            </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* Premium Spacious Content Container */}
            <div className="flex-1 bg-white rounded-2xl shadow-[0_5px_30px_rgba(0,0,0,0.018)] border border-gray-200/80 p-6 sm:p-8 overflow-hidden min-w-0 w-full animate-in fade-in duration-300">
                {activeTab === 'USERS' && (() => {
                    const currentUserLevel = getLevelForRole(currentUser?.role || '');
                    const currentUserWeight = HIERARCHY_WEIGHTS[currentUserLevel] || 0;

                    // canShow means whether the user is high enough in the hierarchy to filter that level
                    // - DIRESA can be filtered only by GLOBAL level (weight >= 100).
                    // - OGESS can be filtered only by DIRESA or higher level (weight >= 80).
                    // - UNGET can be filtered only by OGESS or higher level (weight >= 60).
                    // - MICRORED can be filtered only by UNGET or higher level (weight >= 40).
                    const canShowDiresaFilter = isSuperAdmin || currentUserWeight >= 100;
                    const canShowOgessFilter = isSuperAdmin || currentUserWeight >= 80;
                    const canShowUngetFilter = isSuperAdmin || currentUserWeight >= 60;
                    const canShowMicroredFilter = isSuperAdmin || currentUserWeight >= 40;

                    // Filter selectable OGESS to match selected DIRESA or logged-in DIRESA scope
                    const availableOgess = ogess.filter(o => {
                        if (filterDiresa !== 'ALL') return o.diresaId === filterDiresa;
                        if (!isSuperAdmin && userDiresaId) return o.diresaId === userDiresaId;
                        return true;
                    });

                    // Filter selectable UNGETs to match selected OGESS/DIRESA or logged-in scope
                    const availableUngets = ungets.filter(un => {
                        if (filterOgess !== 'ALL') return un.ogessId === filterOgess;
                        if (filterDiresa !== 'ALL') {
                            const og = ogess.find(o => o.id === un.ogessId);
                            return og && og.diresaId === filterDiresa;
                        }
                        if (!isSuperAdmin) {
                            if (userOgessId) return un.ogessId === userOgessId;
                            if (userDiresaId) {
                                const og = ogess.find(o => o.id === un.ogessId);
                                return og && og.diresaId === userDiresaId;
                            }
                        }
                        return true;
                    });

                    // Filter selectable Microredes to match selected UNGET/OGESS/DIRESA or logged-in scope
                    const availableMicroredes = microredes.filter(m => {
                        if (filterUnget !== 'ALL') return m.ungetId === filterUnget;
                        if (filterOgess !== 'ALL') {
                            const un = ungets.find(u => u.id === m.ungetId);
                            return un && un.ogessId === filterOgess;
                        }
                        if (filterDiresa !== 'ALL') {
                            const un = ungets.find(u => u.id === m.ungetId);
                            if (!un) return false;
                            const og = ogess.find(o => o.id === un.ogessId);
                            return og && og.diresaId === filterDiresa;
                        }
                        if (!isSuperAdmin) {
                            if (userUngetId) return m.ungetId === userUngetId;
                            if (userOgessId) {
                                const un = ungets.find(u => u.id === m.ungetId);
                                return un && un.ogessId === userOgessId;
                            }
                            if (userDiresaId) {
                                const un = ungets.find(u => u.id === m.ungetId);
                                if (!un) return false;
                                const og = ogess.find(o => o.id === un.ogessId);
                                return og && og.diresaId === userDiresaId;
                            }
                        }
                        return true;
                    });

                    const activeFiltersCount = [
                        filterProfession !== 'ALL',
                        filterRole !== 'ALL',
                        filterStatus !== 'ALL',
                        filterLaborRegime !== 'ALL',
                        canShowDiresaFilter && filterDiresa !== 'ALL',
                        canShowOgessFilter && filterOgess !== 'ALL',
                        canShowUngetFilter && filterUnget !== 'ALL',
                        canShowMicroredFilter && filterMicrored !== 'ALL'
                    ].filter(Boolean).length;

                    return (
                        <div className="space-y-6">
                            {/* Header Actions for Users Table - Search and Action Buttons aligned on the same row */}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-5">
                                {/* Search component on the left side of the same row */}
                                <div className="relative flex-1 w-full sm:max-w-xs md:max-w-sm">
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por Nombre, DNI, Usuario..."
                                        className="w-full pl-10 pr-10 py-2.5 text-xs bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:border-teal-500 rounded-xl focus:ring-2 focus:ring-teal-100 outline-none transition-all placeholder:text-gray-400 font-semibold text-gray-800"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                    />
                                    {searchTerm && (
                                        <button 
                                            onClick={() => setSearchTerm('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-extrabold text-teal-600 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 px-1.5 py-0.5 rounded-md cursor-pointer transition-colors"
                                        >
                                            Borrar
                                        </button>
                                    )}
                                </div>

                                {/* Action Buttons on the right side */}
                                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                    {/* Filters Sidebar Trigger */}
                                    <button
                                        onClick={() => setIsFiltersSidebarOpen(true)}
                                        className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl transition-all border cursor-pointer relative ${
                                            activeFiltersCount > 0
                                                ? 'bg-teal-50 hover:bg-teal-100 text-teal-850 border-teal-200 shadow-sm'
                                                : 'bg-white hover:bg-gray-50 text-gray-750 border-gray-200'
                                        }`}
                                    >
                                        <Filter className="h-4 w-4 text-gray-500" />
                                        <span>Filtros</span>
                                        {activeFiltersCount > 0 && (
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-[10px] font-black text-white animate-pulse">
                                                {activeFiltersCount}
                                            </span>
                                        )}
                                    </button>

                                    {/* Botón Descargar Registro en Excel */}
                                    <button 
                                        onClick={handleExportPersonnelExcel}
                                        className="flex items-center gap-2 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
                                        title="Descargar registro de personal en Excel (.xlsx)"
                                    >
                                        <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                                        <span>Descargar Excel</span>
                                    </button>

                                    <button 
                                        onClick={handleAddUserClick}
                                        className="flex items-center gap-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
                                    >
                                        <UserPlus className="h-4 w-4" />
                                        Nuevo Usuario
                                    </button>
                                    <button 
                                        onClick={handleRefreshUsers}
                                        className="flex items-center justify-center h-[38px] w-[38px] text-gray-500 hover:text-teal-600 bg-gray-50 hover:bg-teal-50 rounded-xl transition-all border border-gray-200 cursor-pointer shrink-0"
                                        title="Actualizar lista desde el servidor"
                                    >
                                        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingUsers ? 'animate-spin' : ''}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Active Filters inline indicator */}
                            {activeFiltersCount > 0 && (
                                <div className="flex items-center justify-between bg-teal-50/40 border border-teal-100/70 rounded-xl px-4 py-2 text-xs font-semibold text-teal-850 animate-in fade-in duration-200">
                                    <span>
                                        Filtros activos. Mostrando <strong>{filteredUsers.length}</strong> de <strong>{users.length}</strong> usuarios.
                                    </span>
                                    <button 
                                        onClick={() => {
                                            setSearchTerm('');
                                            setFilterProfession('ALL');
                                            setFilterRole('ALL');
                                            setFilterStatus('ALL');
                                            setFilterDiresa('ALL');
                                            setFilterOgess('ALL');
                                            setFilterUnget('ALL');
                                            setFilterLaborRegime('ALL');
                                            setFilterMicrored('ALL');
                                        }}
                                        className="text-xs font-black text-teal-700 hover:text-teal-950 underline uppercase tracking-wide cursor-pointer transition-colors"
                                    >
                                        Limpiar Todo
                                    </button>
                                </div>
                            )}

                            {/* FILTROS AVANZADOS SIDEBAR (DERECHA) */}
                            {isFiltersSidebarOpen && createPortal(
                                <div className="fixed inset-0 z-[110000] flex justify-end pointer-events-none">
                                    {/* Backdrop overlay */}
                                    <div 
                                        className="absolute inset-0 bg-transparent pointer-events-auto cursor-pointer"
                                        onClick={() => setIsFiltersSidebarOpen(false)}
                                    />
                                    
                                    {/* Sidebar content container */}
                                    <div className="relative w-full max-w-sm sm:max-w-md bg-white h-full shadow-2xl border-l border-gray-200 pointer-events-auto animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden">
                                        {/* Header */}
                                        <div className="p-6 border-b border-gray-150 flex items-center justify-between sticky top-0 bg-white z-20 shrink-0">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-600 shadow-sm border border-teal-100/50">
                                                    <Filter className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className="font-extrabold text-gray-950 text-sm uppercase tracking-tight">Filtros de Búsqueda</h3>
                                                    <p className="text-[10px] text-teal-600 font-extrabold tracking-widest uppercase">Gestión de Usuarios</p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => setIsFiltersSidebarOpen(false)}
                                                className="p-2 hover:bg-gray-100 rounded-xl transition-all text-gray-400 hover:text-gray-900 cursor-pointer"
                                            >
                                                <X className="h-4.5 w-4.5" />
                                            </button>
                                        </div>

                                        {/* Content Filters Grid */}
                                        <div className="flex-1 p-6 space-y-5 overflow-y-auto font-sans">
                                            {/* Profession filter */}
                                            <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200">
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Profesión</label>
                                                <CustomSelect 
                                                    className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                    value={filterProfession}
                                                    onChange={setFilterProfession}
                                                    options={[
                                                        { value: 'ALL', label: 'Todas las profesiones' },
                                                        ...professions.map(p => ({ value: p.id, label: p.name }))
                                                    ]}
                                                />
                                            </div>

                                            {/* Role filter */}
                                            <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200 delay-75">
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Rol</label>
                                                <CustomSelect 
                                                    className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                    value={filterRole}
                                                    onChange={setFilterRole}
                                                    options={[
                                                        { value: 'ALL', label: 'Todos los roles' },
                                                        ...roles.map(r => ({ value: r.role, label: r.label || r.role }))
                                                    ]}
                                                />
                                            </div>

                                            {/* Status filter */}
                                            <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200 delay-100">
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Estado de Cuenta</label>
                                                <CustomSelect 
                                                    className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                    value={filterStatus}
                                                    onChange={setFilterStatus}
                                                    options={[
                                                        { value: 'ALL', label: 'Todos los estados' },
                                                        { value: 'ACTIVE', label: 'Activo' },
                                                        { value: 'INACTIVE', label: 'Inactivo' }
                                                    ]}
                                                />
                                            </div>

                                            {/* Labor Regime filter */}
                                            <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200 delay-100">
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Régimen Laboral</label>
                                                <CustomSelect 
                                                    className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                    value={filterLaborRegime}
                                                    onChange={setFilterLaborRegime}
                                                    options={[
                                                        { value: 'ALL', label: 'Todos los regímenes' },
                                                        ...laborRegimes.map(r => ({ value: r.id, label: r.name }))
                                                    ]}
                                                />
                                            </div>

                                            {/* DIRESA filter conditional */}
                                            {canShowDiresaFilter && (
                                                <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">DIRESA</label>
                                                    <CustomSelect 
                                                        className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                        value={filterDiresa}
                                                        onChange={val => {
                                                            setFilterDiresa(val);
                                                            setFilterOgess('ALL');
                                                            setFilterUnget('ALL');
                                                            setFilterMicrored('ALL');
                                                        }}
                                                        options={[
                                                            { value: 'ALL', label: 'Todas las DIRESA' },
                                                            ...diresas.map(d => ({ value: d.id, label: d.name }))
                                                        ]}
                                                    />
                                                </div>
                                            )}

                                            {/* OGESS filter conditional */}
                                            {canShowOgessFilter && (
                                                <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">OGESS</label>
                                                    <CustomSelect 
                                                        className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                        value={filterOgess}
                                                        onChange={val => {
                                                            setFilterOgess(val);
                                                            setFilterUnget('ALL');
                                                            setFilterMicrored('ALL');
                                                        }}
                                                        options={[
                                                            { value: 'ALL', label: 'Todas las OGESS' },
                                                            ...availableOgess.map(o => ({ value: o.id, label: o.name }))
                                                        ]}
                                                    />
                                                </div>
                                            )}

                                            {/* UNGET filter conditional */}
                                            {canShowUngetFilter && (
                                                <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">UNGET</label>
                                                    <CustomSelect 
                                                        className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                        value={filterUnget}
                                                        onChange={val => {
                                                            setFilterUnget(val);
                                                            setFilterMicrored('ALL');
                                                        }}
                                                        options={[
                                                            { value: 'ALL', label: 'Todas las UNGET' },
                                                            ...availableUngets.map(un => ({ value: un.id, label: un.name }))
                                                        ]}
                                                    />
                                                </div>
                                            )}

                                            {/* Microredes filter conditional */}
                                            {canShowMicroredFilter && (
                                                <div className="space-y-1.5 animate-in fade-in slide-in-from-right-3 duration-200">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Microred</label>
                                                    <CustomSelect 
                                                        className="w-full text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl"
                                                        value={filterMicrored}
                                                        onChange={setFilterMicrored}
                                                        options={[
                                                            { value: 'ALL', label: 'Todas las Microredes' },
                                                            ...availableMicroredes.map(m => ({ value: m.id, label: m.name }))
                                                        ]}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Clear All / Footer Actions */}
                                        <div className="p-6 border-t border-gray-150 bg-gray-50 flex items-center justify-between sticky bottom-0 shrink-0">
                                            <button 
                                                onClick={() => {
                                                    setFilterProfession('ALL');
                                                    setFilterRole('ALL');
                                                    setFilterStatus('ALL');
                                                    setFilterDiresa('ALL');
                                                    setFilterOgess('ALL');
                                                    setFilterUnget('ALL');
                                                    setFilterLaborRegime('ALL');
                                                    setFilterMicrored('ALL');
                                                }}
                                                className="text-xs font-extrabold text-gray-550 hover:text-gray-900 uppercase cursor-pointer"
                                            >
                                                Limpiar
                                            </button>
                                            <button 
                                                onClick={() => setIsFiltersSidebarOpen(false)}
                                                className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
                                            >
                                                Aplicar Filtros
                                            </button>
                                        </div>
                                    </div>
                                </div>,
                                document.body
                            )}

                        {/* --- SCROLLABLE RESPONSIVE TABLE WITH TRANSPARENT SCROLLBAR --- */}
                        <div className="border border-gray-200/80 rounded-2xl overflow-hidden shadow-[0_4px_25px_rgba(0,0,0,0.012)] bg-white">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50/70 border-b border-gray-100/80 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-[240px]">Nombre (personal)</th>
                                            <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-[180px]">Profesión</th>
                                            <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-[150px]">Teléfono</th>
                                            <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-[180px]">Jurisdicción</th>
                                            <th className="px-4 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-[100px]">Rol</th>
                                            <th className="px-4 py-3.5 text-right text-xs font-bold text-gray-500 uppercase tracking-wider w-[110px]">Acciones</th>
                                        </tr>
                                    </thead>
                                </table>
                            </div>
                            
                            {/* Scrollable container with transparent webkit scrollbars & max-height limit to keep table neat */}
                            <div className="max-h-[480px] overflow-y-auto overflow-x-auto custom-admin-scrollbar scroll-smooth">
                                <style dangerouslySetInnerHTML={{__html: `
                                    .custom-admin-scrollbar::-webkit-scrollbar {
                                        width: 5px;
                                        height: 5px;
                                    }
                                    .custom-admin-scrollbar::-webkit-scrollbar-track {
                                        background: transparent;
                                    }
                                    .custom-admin-scrollbar::-webkit-scrollbar-thumb {
                                        background: rgba(20, 184, 166, 0.12);
                                        border-radius: 9999px;
                                        transition: background 0.3s ease;
                                    }
                                    .custom-admin-scrollbar::-webkit-scrollbar-thumb:hover {
                                        background: rgba(20, 184, 166, 0.28);
                                    }
                                `}} />
                                <table className="min-w-full divide-y divide-gray-100">
                                    <tbody className="bg-white divide-y divide-gray-100">
                                        {filteredUsers.length === 0 && !isRefreshingUsers && (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400 font-medium">
                                                    No se encontraron usuarios que cumplan con los filtros seleccionados o nivel de acceso.
                                                </td>
                                            </tr>
                                        )}
                                        {filteredUsers.map((u: any, idx: number) => {
                                            const isUserActive = u.isActive === true || String(u.isActive).toLowerCase() === 'true';
                                            
                                            // --- OPTIMIZED O(1) HIERARCHICAL LOOKUP ENGINE ---
                                            let jurisdictionName = '-';
                                            const rObj = roles.find(r => r.role === u.role);
                                            const level = rObj?.jurisdictionLevel;
                                            const h = getExpandedHierarchy(u);

                                            if (level === 'GLOBAL') {
                                                jurisdictionName = 'Nacional';
                                            } else if (level === 'DIRESA' || u.role === 'DIRESA') {
                                                jurisdictionName = diresaMapLookup.get(h.diresaId)?.name || '-';
                                            } else if (level === 'OGESS' || u.role === 'OGESS') {
                                                jurisdictionName = ogessMapLookup.get(h.ogessId)?.name || '-';
                                            } else if (level === 'UNGET' || u.role === 'UNGET') {
                                                jurisdictionName = ungetMapLookup.get(h.ungetId)?.name || '-';
                                            } else if (level === 'MICRORED' || u.role === 'MICRORED') {
                                                jurisdictionName = microredMapLookup.get(h.microredId)?.name || '-';
                                            } else if (level === 'IPRESS' || u.role === 'IPRESS') {
                                                jurisdictionName = facilityMapLookup.get(h.facilityCode)?.name || '-';
                                            } else {
                                                // Fallback hierarchy waterfall: use the highest specificity set
                                                if (h.ungetId) {
                                                    jurisdictionName = ungetMapLookup.get(h.ungetId)?.name || '-';
                                                } else if (h.ogessId) {
                                                    jurisdictionName = ogessMapLookup.get(h.ogessId)?.name || '-';
                                                } else if (h.diresaId) {
                                                    jurisdictionName = diresaMapLookup.get(h.diresaId)?.name || '-';
                                                } else if (h.facilityCode) {
                                                    jurisdictionName = facilityMapLookup.get(h.facilityCode)?.name || '-';
                                                }
                                            }
                                            
                                            const name = u.personnel ? `${u.personnel.firstName} ${u.personnel.lastName}` : 'Sin datos de personal';
                                            const email = u.personnel?.email || '';
                                            const professionName = u.personnel?.professionData?.name || professionMapLookup.get(u.personnel?.professionId)?.name || '-';
 
                                            return (
                                                <tr 
                                                    key={idx} 
                                                    onClick={() => setViewingUser(u)}
                                                    className="hover:bg-slate-100/50 transition-colors group cursor-pointer"
                                                >
                                                    {/* Nombre (personal) */}
                                                    <td className="px-5 py-3 whitespace-nowrap text-sm w-[240px] max-w-[240px] truncate">
                                                        <div className="font-semibold text-gray-800 leading-tight truncate" title={name}>{name}</div>
                                                    </td>
 
                                                    {/* Profesión */}
                                                    <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-600 font-semibold w-[180px] max-w-[180px] truncate">
                                                        {professionName !== '-' ? (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-teal-50 text-teal-800 border border-teal-100/50 uppercase tracking-wide truncate" title={professionName}>
                                                                {professionName}
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
 
                                                    {/* Teléfono */}
                                                    <td className="px-5 py-3 whitespace-nowrap text-xs text-gray-500 font-semibold w-[150px] max-w-[150px] truncate">
                                                        {u.personnel?.phone ? (
                                                            <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-md w-fit text-gray-600">
                                                                <Phone className="h-3 w-3 text-gray-400 shrink-0" />
                                                                <span className="truncate">{u.personnel.phone}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
 
                                                    {/* Jurisdicción */}
                                                    <td className="px-5 py-3 text-xs w-[180px] max-w-[180px] truncate" title={jurisdictionName}>
                                                        {jurisdictionName !== '-' ? (
                                                            <span className="font-medium text-gray-700 bg-slate-55 border border-slate-100 px-2 py-0.5 rounded-md truncate block w-fit">{jurisdictionName}</span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
 
                                                    {/* Rol */}
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm w-[100px] max-w-[100px]">
                                                        <span className={`px-2 py-0.5 inline-flex text-[10px] font-extrabold rounded-md uppercase tracking-wide ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-850' : 'bg-blue-50 text-blue-700 border border-blue-100/50'}`}>
                                                            {u.role}
                                                        </span>
                                                    </td>

                                                    {/* Acciones (Contains Edit + Status indicator inside status icon color) */}
                                                    <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-medium w-[110px] max-w-[110px]">
                                                        <div className="flex justify-end gap-1.5">
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); handleEditUserClick(u); }}
                                                                className="text-gray-500 hover:text-teal-600 bg-gray-50 hover:bg-teal-50 border border-gray-200/80 hover:border-teal-200 p-1.5 rounded-lg transition-colors cursor-pointer" title="Editar"
                                                            >
                                                                <Edit className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); handleToggleStatus(u.username, u.isActive); }}
                                                                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${isUserActive ? 'text-teal-600 hover:text-rose-600 bg-teal-50/50 hover:bg-rose-50 border-teal-200 hover:border-rose-200' : 'text-gray-400 hover:text-green-700 bg-gray-50 border-gray-200 hover:border-green-300'}`} 
                                                                title={isUserActive ? "Activo (Haz clic para desactivar)" : "Inactivo (Haz clic para activar)"}
                                                            >
                                                                <Power className="h-3.5 w-3.5" />
                                                            </button>
                                                            {isSuperAdmin && currentUser?.username !== u.username && (
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); setUserToDelete({ username: u.username, personnelId: u.personnelId || null }); }}
                                                                    className="text-gray-400 hover:text-red-600 bg-gray-50 hover:bg-rose-50 border border-gray-200 hover:border-red-200 p-1.5 rounded-lg transition-colors cursor-pointer" 
                                                                    title="Eliminar permanentemente"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    );
                })()}

                {activeTab === 'ROLES' && (
                    <div className="space-y-6">
                        <div className="flex flex-col md:flex-row gap-6 items-start">
                            {/* Panel Izquierdo: Lista de Roles */}
                            <div className="w-full md:w-1/3 bg-white border border-gray-200 rounded-xl overflow-hidden shrink-0">
                                <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
                                    <h5 className="font-bold text-gray-800 text-sm">Roles Existentes</h5>
                                    <button 
                                        onClick={() => {
                                            setNewRoleForm({ role: '', label: '', maxUrlsAllowed: '', allowedModules: [], jurisdictionLevel: '' });
                                            setIsNewRoleModalOpen(true);
                                        }}
                                        className="flex items-center gap-1.5 text-[10px] font-extrabold text-white bg-teal-600 hover:bg-teal-700 px-3 py-2 rounded-xl transition-all shadow-sm cursor-pointer uppercase tracking-wider shrink-0"
                                    >
                                        <Shield className="h-3.5 w-3.5" />
                                        Nuevo Rol
                                    </button>
                                </div>
                                <div className="flex flex-col max-h-[600px] overflow-y-auto">
                                    {isRolesLoading ? (
                                        <div className="p-8 flex justify-center text-teal-600">
                                            <RefreshCw className="h-6 w-6 animate-spin" />
                                        </div>
                                    ) : roles.length === 0 ? (
                                        <div className="p-8 text-center text-gray-500 text-sm">
                                            No hay roles configurados.
                                        </div>
                                    ) : roles.map((role) => (
                                        <div key={role.role} className={`flex items-center justify-between border-b border-gray-100 transition-colors ${selectedRoleId === role.role ? 'bg-teal-50 border-l-4 border-l-teal-500' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}>
                                            <button
                                                onClick={() => setSelectedRoleId(role.role)}
                                                className="flex-1 text-left p-4 focus:outline-none"
                                            >
                                                <div className="font-bold text-sm text-gray-800">{role.label || role.role}</div>
                                                <div className="text-[10px] text-gray-500 font-mono mt-1">{role.role}</div>
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleOpenEditRole(role); }}
                                                className="p-3 text-gray-400 hover:text-teal-600 transition-colors mr-2"
                                                title="Editar nombre y código del rol"
                                            >
                                                <Edit className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
    
                            {/* Panel Derecho: Detalles del Rol */}
                            <div className="w-full md:w-2/3 bg-white border border-gray-200 rounded-xl overflow-hidden flex-1">
                                {selectedRoleId && roles.find(r => r.role === selectedRoleId) ? (() => {
                                    const currentRole = roles.find(r => r.role === selectedRoleId)!;
                                    return (
                                        <div className="flex flex-col h-full">
                                            <div className="p-5 border-b border-gray-200 bg-gray-50 flex flex-col gap-2">
                                                <div className="flex items-center justify-between gap-4">
                                                    <h3 className="font-bold text-lg text-gray-800">{currentRole.label}</h3>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <Shield className="h-3.5 w-3.5 text-teal-600" />
                                                        <span className="text-xs font-mono font-bold bg-white border border-gray-200 px-3 py-1.5 rounded-md shadow-sm text-gray-700 uppercase">
                                                            {currentRole.role}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        
                                            <div className="p-6 space-y-8 flex-1 max-h-[480px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                                <div>
                                                    <p className="text-sm font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4">Módulos Permitidos</p>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {AVAILABLE_MODULES.map(module => (
                                                            <label key={module.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${currentRole.allowedModules.includes(module.id) ? 'bg-teal-50 border-teal-200 shadow-sm' : 'bg-white border-gray-200 hover:bg-gray-50'}`} title={module.description}>
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={currentRole.allowedModules.includes(module.id)}
                                                                    onChange={(e) => handleRoleModuleChange(currentRole.role, module.id, e.target.checked)}
                                                                    className="mt-0.5 shrink-0 rounded text-teal-600 focus:ring-teal-500 border-gray-300"
                                                                />
                                                                <div className="flex flex-col">
                                                                    <span className={`text-sm font-bold ${currentRole.allowedModules.includes(module.id) ? 'text-teal-900' : 'text-gray-800'}`}>{module.label}</span>
                                                                    <span className="text-[10px] text-gray-500 leading-tight mt-0.5">{module.description}</span>
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                        
                                                <div>
                                                    <p className="text-sm font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4">Límites del Sistema</p>
                                                    <div className="max-w-xs">
                                                        <label className="block text-xs font-bold text-gray-600 mb-2">Máximo de URLs (SIG_SEARCH):</label>
                                                        <input 
                                                            type="number"
                                                            min="1"
                                                            placeholder="Ilimitado"
                                                            value={currentRole.maxUrlsAllowed || ''}
                                                            onChange={(e) => handleRoleMaxUrlsChange(currentRole.role, e.target.value)}
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                                                        />
                                                        <p className="text-[10px] text-gray-400 mt-1">Deje vacío para permitir búsquedas sin límite.</p>
                                                    </div>
                                                </div>
                                            </div>
                        
                                            <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end mt-auto">
                                                <button 
                                                    onClick={() => handleSaveRoleConfig(currentRole)}
                                                    className="text-sm font-bold text-white bg-gray-900 px-6 py-2.5 rounded-lg hover:bg-black transition-colors flex items-center gap-2 shadow-sm"
                                                >
                                                    <Save className="h-4 w-4" />
                                                    Guardar Cambios
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })() : (
                                    <div className="flex flex-col items-center justify-center p-12 text-center text-gray-400 h-full min-h-[300px]">
                                        <Shield className="h-12 w-12 text-gray-200 mb-4" />
                                        <p className="text-base font-medium text-gray-500">Seleccione un rol de la lista</p>
                                        <p className="text-sm text-gray-400 mt-1">El panel de configuración aparecerá aquí</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'PARAMS' && (
                     <div className="space-y-6">
                         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                            {/* TIMER CONFIG */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm h-full">
                                <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-gray-500" />
                                    Tiempos y Temporizadores
                                </h3>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            Tiempo de Espera - Botón Validar (Segundos)
                                        </label>
                                        <div className="flex items-center gap-3">
                                            <input 
                                                type="number"
                                                min="0"
                                                max="60"
                                                value={tempConfig.verificationDelaySeconds}
                                                onChange={(e) => setTempConfig({...tempConfig, verificationDelaySeconds: Number(e.target.value)})}
                                                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center font-bold text-gray-900 focus:ring-2 focus:ring-teal-500 outline-none"
                                            />
                                            <span className="text-sm text-gray-500">segundos</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Tiempo que el usuario debe esperar en el modal de detalle antes de poder hacer clic en "Validar". (0 = Sin espera)
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* API CONNECTION CONFIG */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm h-full">
                                <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                    <Link2 className="h-5 w-5 text-gray-500" />
                                    Conexión Backend (Google Apps Script)
                                </h3>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            URL del Web App (API Endpoint)
                                        </label>
                                        <textarea 
                                            value={tempConfig.apiUrl || ''}
                                            onChange={(e) => setTempConfig({...tempConfig, apiUrl: e.target.value})}
                                            placeholder="https://script.google.com/macros/s/..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono text-gray-600 focus:ring-2 focus:ring-teal-500 outline-none break-all h-24 resize-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* WAREHOUSE CONFIG */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm h-full">
                                <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-gray-500" />
                                    Configuración de Almacén General
                                </h3>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            Código del Almacén
                                        </label>
                                        <input 
                                            type="text"
                                            value={tempConfig.warehouseCode || ''}
                                            onChange={(e) => setTempConfig({...tempConfig, warehouseCode: e.target.value})}
                                            placeholder="Ej: ALM-001"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 focus:ring-2 focus:ring-teal-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            Nombre del Almacén
                                        </label>
                                        <input 
                                            type="text"
                                            value={tempConfig.warehouseName || ''}
                                            onChange={(e) => setTempConfig({...tempConfig, warehouseName: e.target.value})}
                                            placeholder="Ej: Almacén General de Medicamentos"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-teal-500 outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* MODO MANTENIMIENTO */}
                        <div className="bg-white border border-amber-200 rounded-xl p-6 shadow-sm">
                            <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                                <Wrench className="h-5 w-5 text-amber-500" />
                                Modo mantenimiento
                            </h3>
                            <p className="text-xs text-gray-500 mb-5 leading-relaxed max-w-3xl">
                                Cierra la aplicación mientras se trabaja en ella. Los administradores entran
                                siempre; los demás ven una pantalla de mantenimiento, salvo los usuarios que
                                autorice aquí para pruebas.
                            </p>

                            <label className="flex items-start gap-3 cursor-pointer mb-5">
                                <input
                                    type="checkbox"
                                    checked={!!tempConfig.maintenanceMode}
                                    onChange={(e) => setTempConfig({ ...tempConfig, maintenanceMode: e.target.checked })}
                                    className="mt-0.5 h-5 w-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                                />
                                <span>
                                    <span className="block text-sm font-bold text-gray-800">
                                        Activar el modo mantenimiento
                                    </span>
                                    <span className="block text-xs text-gray-400">
                                        {tempConfig.maintenanceMode
                                            ? 'La aplicación está cerrada para quien no esté autorizado.'
                                            : 'La aplicación está abierta con normalidad.'}
                                    </span>
                                </span>
                            </label>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Usuarios autorizados para pruebas
                                    </label>
                                    <textarea
                                        value={tempConfig.maintenanceAllowedUsers || ''}
                                        onChange={(e) => setTempConfig({ ...tempConfig, maintenanceAllowedUsers: e.target.value })}
                                        placeholder="bellavista, picota"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 focus:ring-2 focus:ring-amber-500 outline-none h-24 resize-none"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">
                                        Nombres de usuario separados por comas o uno por línea.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">
                                        Mensaje que verán
                                    </label>
                                    <textarea
                                        value={tempConfig.maintenanceMessage || ''}
                                        onChange={(e) => setTempConfig({ ...tempConfig, maintenanceMessage: e.target.value })}
                                        placeholder="Estamos trabajando en el sistema. Volveremos a habilitarlo en cuanto termine el mantenimiento."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-amber-500 outline-none h-24 resize-none"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">
                                        Si lo deja vacío se muestra un mensaje por defecto.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <button 
                                onClick={handleSaveConfig}
                                disabled={isSavingConfig}
                                className="px-6 py-2.5 bg-gray-900 text-white font-bold rounded-lg shadow hover:bg-black transition-all flex items-center gap-2 disabled:opacity-70"
                            >
                                <Save className="h-4 w-4" />
                                {isSavingConfig ? 'Guardando...' : 'Guardar Parámetros'}
                            </button>
                        </div>
                     </div>
                )}
                {activeTab === 'MIGRATION' && currentUser?.role === 'ADMIN' && (
                     <AdminMigrationModule />
                )}
                {activeTab === 'FACILITIES' && (
                     <AdminOrganizationModule />
                )}
                {activeTab === 'CATALOGS' && (
                     <AdminCatalogsModule onChanged={refreshCatalogs} />
                )}
                {activeTab === 'SYNC_DEVICES' && (
                     <AdminSyncDevicesModule />
                )}
            </div>
        </div>
    </div>

    {/* --- CUSTOM CONFIRMATION MODAL --- */}
    {userToToggle && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                <div className="p-6 text-center">
                    <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4 ${userToToggle.currentStatus ? 'bg-red-100' : 'bg-green-100'}`}>
                        <Power className={`h-6 w-6 ${userToToggle.currentStatus ? 'text-red-600' : 'text-green-600'}`} />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">
                        {userToToggle.currentStatus ? 'Inactivar Usuario' : 'Activar Usuario'}
                    </h3>
                    <p className="text-sm text-gray-500 mb-6">
                        ¿Está seguro que desea {userToToggle.currentStatus ? 'deshabilitar' : 'habilitar'} el acceso para <strong>{userToToggle.username}</strong>?
                    </p>
                    <div className="flex gap-3 justify-center">
                        <button 
                            onClick={() => setUserToToggle(null)}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={executeToggleStatus}
                            className={`px-4 py-2 text-white rounded-lg font-bold text-sm transition-colors shadow-sm ${userToToggle.currentStatus ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                        >
                            {userToToggle.currentStatus ? 'Sí, Inactivar' : 'Sí, Activar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* --- ELIMINAR USUARIO DEFINITIVO (SUPERADMIN) --- */}
    {userToDelete && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                <div className="p-6">
                    <div className="text-center">
                        <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full mb-4 bg-rose-50 border border-rose-100">
                            <Trash2 className="h-7 w-7 text-rose-600" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                            ¿Eliminar Usuario de Forma Permanente?
                        </h3>
                        <p className="text-sm text-gray-500 mb-4 leading-relaxed">
                            Esta acción es <strong className="text-rose-600">IRREVERSIBLE</strong>. Se eliminará definitivamente la cuenta de acceso <strong>@{userToDelete.username}</strong> del sistema, incluyendo sus credenciales y configuraciones de rol, así como su perfil de personal vinculado si corresponde.
                        </p>
                    </div>
                    
                    <div className="bg-amber-50 rounded-lg border border-amber-100 text-[11px] p-3 text-amber-800 mb-6 flex gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        <span><strong>Atención:</strong> Asegúrese de que este personal no tenga dependencias críticas antes de proceder. No se puede deshacer un borrado definitivo.</span>
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button 
                            onClick={() => setUserToDelete(null)}
                            disabled={isDeletingUser}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={executeDeleteUser}
                            disabled={isDeletingUser}
                            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isDeletingUser ? 'Eliminando...' : 'Sí, Eliminar Definitivamente'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* --- USER FORM MODAL --- */}
    {isUserModalOpen && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-teal-500/25 p-2 rounded-xl border border-teal-500/30">
                            <Users className="h-5 w-5 text-teal-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold tracking-tight">{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                            <p className="text-xs text-gray-400">Complete los datos de perfil y configure el ámbito de acceso organizacional.</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsUserModalOpen(false)}
                        className="text-gray-400 hover:text-white transition-colors hover:bg-white/10 p-1.5 rounded-full"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSaveUser} className="flex-1 flex flex-col overflow-hidden">
                    {/* Premium Stepper Progress Header Container */}
                    <div className="px-6 pt-6 shrink-0 bg-white z-10">
                        <div className="relative flex items-center justify-between pb-4 border-b border-gray-100">
                            <div className="absolute left-0 top-4 right-0 h-0.5 bg-gray-100 -z-10">
                            <div 
                                className="h-full bg-teal-600 transition-all duration-300" 
                                style={{ width: userModalStep === 1 ? '0%' : userModalStep === 2 ? '50%' : '100%' }}
                            />
                        </div>
                        {[
                            { step: 1, label: 'Datos Personales', desc: 'Identificación y Contacto', icon: Users },
                            { step: 2, label: 'Cuenta y Rol', desc: 'Credenciales y Nivel', icon: Shield },
                            { step: 3, label: 'Ámbito de Jurisdicción', desc: 'Asignación Organizacional', icon: Building2 }
                        ].map(s => {
                            const IconComponent = s.icon;
                            return (
                                <button
                                    key={s.step}
                                    type="button"
                                    disabled={
                                        (s.step === 2 && !isStep1Valid) ||
                                        (s.step === 3 && (!isStep1Valid || !isStep2Valid))
                                    }
                                    onClick={() => setUserModalStep(s.step)}
                                    className="flex items-center gap-3.5 bg-white px-3 disabled:opacity-50 disabled:cursor-not-allowed group text-left outline-none"
                                >
                                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${userModalStep === s.step ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-100' : 'bg-gray-50 border-gray-200 text-gray-400 group-hover:border-gray-300'}`}>
                                        <IconComponent className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <span className={`block text-[11px] font-bold uppercase tracking-wider ${userModalStep === s.step ? 'text-teal-700' : 'text-gray-400'}`}>{s.label}</span>
                                        <span className="block text-[10px] text-gray-400 font-medium">{s.desc}</span>
                                    </div>
                                </button>
                            );
                        })}
                        </div>
                    </div>

                    <div className="px-6 py-6 overflow-y-auto flex-1 min-h-[200px] flex flex-col justify-start">
                        {/* Step 1: Personal Identification */}
                        {userModalStep === 1 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                {/* Sub-Sección 1: Datos Personales */}
                                <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                        <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Identificación
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Nombres *</label>
                                            <input 
                                                type="text" required
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none bg-white text-gray-900 placeholder-gray-400 font-medium"
                                                value={userForm.firstName}
                                                onChange={e => setUserForm({...userForm, firstName: e.target.value})}
                                                placeholder="Nombres completos"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Apellidos *</label>
                                            <input 
                                                type="text" required
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none bg-white text-gray-900 placeholder-gray-400 font-medium"
                                                value={userForm.lastName}
                                                onChange={e => setUserForm({...userForm, lastName: e.target.value})}
                                                placeholder="Apellidos"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">DNI *</label>
                                            <input 
                                                type="text" required maxLength={8}
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none bg-white text-gray-900 placeholder-gray-400 font-mono font-medium tracking-wider"
                                                value={userForm.dni}
                                                onChange={e => setUserForm({...userForm, dni: e.target.value})}
                                                placeholder="DNI de 8 dígitos/cédula"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Correo Electrónico</label>
                                            <input 
                                                type="email"
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none bg-white text-gray-900 placeholder-gray-400 font-medium"
                                                value={userForm.email}
                                                onChange={e => setUserForm({...userForm, email: e.target.value})}
                                                placeholder="email@ejemplo.com"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Teléfono</label>
                                            <input 
                                                type="text"
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none bg-white text-gray-900 placeholder-gray-400 font-medium"
                                                value={userForm.phone}
                                                onChange={e => setUserForm({...userForm, phone: e.target.value})}
                                                placeholder="Ej. 987654321"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Régimen Laboral</label>
                                            <CustomSelect
                                                className="w-full border border-gray-300 rounded-lg"
                                                value={userForm.laborRegimeId || ''}
                                                onChange={rId => {
                                                    const matched = laborRegimes.find(r => r.id === rId);
                                                    setUserForm({
                                                        ...userForm,
                                                        laborRegimeId: rId,
                                                        laborRegime: matched ? matched.name : ''
                                                    });
                                                }}
                                                placeholder="-- Seleccionar Régimen --"
                                                options={[
                                                    { value: '', label: '-- Seleccionar Régimen --' },
                                                    ...laborRegimes.map(r => ({ value: r.id, label: r.name }))
                                                ]}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Profesión</label>
                                            <CustomSelect
                                                className="w-full border border-gray-300 rounded-lg"
                                                value={userForm.professionId || ''}
                                                onChange={val => setUserForm({ ...userForm, professionId: val })}
                                                placeholder="-- Seleccionar Profesión --"
                                                options={[
                                                    { value: '', label: '-- Seleccionar Profesión --' },
                                                    ...professions.map(p => ({ value: p.id, label: p.name }))
                                                ]}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Account and Access */}
                        {userModalStep === 2 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                {/* Sub-Sección 2: Credenciales de Acceso */}
                                <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-1.5">
                                        <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Credenciales y Rol de Acceso
                                    </h4>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Identidad de Acceso (Usuario / Contraseña) */}
                                        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4 relative">
                                            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Identidad de Acceso</h5>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Usuario Sistema *</label>
                                                <input 
                                                    type="text" required
                                                    disabled={!!editingUser}
                                                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none font-mono font-medium tracking-wide ${editingUser ? 'bg-gray-100 text-gray-500 cursor-not-allowed border-gray-200' : 'bg-white text-gray-900 shadow-sm'}`}
                                                    value={userForm.username}
                                                    onChange={e => setUserForm({...userForm, username: e.target.value})}
                                                    placeholder="jsmith"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                                    {editingUser ? 'Nueva Contraseña' : 'Contraseña de Acceso *'}
                                                </label>
                                                <input 
                                                    type="password"
                                                    required={!editingUser}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none bg-white text-gray-900 placeholder-gray-400 font-mono shadow-sm"
                                                    value={userForm.password}
                                                    placeholder={editingUser ? "Dejar en blanco" : "Contraseña"}
                                                    onChange={e => setUserForm({...userForm, password: e.target.value})}
                                                />
                                            </div>
                                        </div>

                                        {/* Nivel de Privilegios (Rol) */}
                                        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4 relative">
                                            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Nivel de Privilegios</h5>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Rol de Permisos *</label>
                                                <CustomSelect
                                                    className="w-full border border-gray-300 rounded-lg text-gray-900 font-bold"
                                                    value={userForm.role}
                                                    onChange={roleVal => {
                                                        const newLvl = getLevelForRole(roleVal);
                                                        setUserModalLevel(newLvl);
                                                        setUserForm(prev => ({
                                                            ...prev,
                                                            role: roleVal,
                                                            diresaId: '',
                                                            ogessId: '',
                                                            ungetId: '',
                                                            microredId: '',
                                                            facilityCode: ''
                                                        }));
                                                    }}
                                                    options={roles
                                                        .filter(r => {
                                                            if (isSuperAdmin) return true;
                                                            const currentUserLevel = getLevelForRole(currentUser?.role || '');
                                                            const currentUserWeight = HIERARCHY_WEIGHTS[currentUserLevel] ?? -1;
                                                            const optionLevel = getLevelForRole(r.role);
                                                            const optionWeight = HIERARCHY_WEIGHTS[optionLevel] ?? -1;
                                                            return optionWeight <= currentUserWeight && optionWeight < 100 && optionWeight >= 0;
                                                        })
                                                        .map(r => ({ value: r.role, label: r.label || r.role }))}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Jurisdictional Assignment */}
                        {userModalStep === 3 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">

                                {userModalLevel === 'GLOBAL' && (
                                    <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 shadow-sm text-center max-w-xl mx-auto my-4">
                                        <div className="bg-blue-100 text-blue-700 p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                                            <Shield className="h-6 w-6" />
                                        </div>
                                        <h5 className="text-sm font-extrabold text-blue-900">Acceso Administrativo Global</h5>
                                        <p className="text-xs text-blue-700 mt-1.5 leading-relaxed">
                                            Este usuario cuenta con atribuciones globales a nivel central. Posee visibilidad ilimitada sobre todas las DIRESA, OGESS, UNGET, Microredes e IPRESS del territorio nacional. No se requiere asignación de nodo secundario.
                                        </p>
                                    </div>
                                )}

                                {userModalLevel && userModalLevel !== 'GLOBAL' && (
                                    <div className="space-y-6">
                                        {/* Unified Section Banner with Jurisdiction Indicator and its Selection Combobox side-by-side */}
                                        <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 mb-2 text-left">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                                                {/* Nivel de Jurisdicción Detectado */}
                                                <div className="flex flex-col text-left">
                                                    <span className="text-[10px] uppercase font-black tracking-widest text-green-600 mb-1 block">NIVEL DE JURISDICCIÓN DETECTADO</span>
                                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                                                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                                        {userModalLevel || 'No Determinado'}
                                                    </h4>
                                                </div>

                                                {/* Conditional Selector (Rendered directly side-by-side inside the same section wrapper) */}
                                                <div className="text-left w-full">
                                                    {userModalLevel === 'DIRESA' && (
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] font-black text-slate-900 uppercase tracking-wider">SELECCIONE DIRESA JURISDICCIONAL *</label>
                                                            <CustomSelect
                                                                className="w-full border border-gray-350 rounded-xl px-4 py-2.5 text-xs font-bold bg-white"
                                                                value={userForm.diresaId || ''}
                                                                onChange={selId => {
                                                                    setUserForm({
                                                                        ...userForm,
                                                                        diresaId: selId,
                                                                        ogessId: '',
                                                                        ungetId: '',
                                                                        microredId: '',
                                                                        facilityCode: ''
                                                                    });
                                                                }}
                                                                placeholder="Seleccione DIRESA..."
                                                                options={[
                                                                    { value: '', label: 'Seleccione DIRESA...' },
                                                                    ...diresas.filter(d => isSuperAdmin || !userDiresaId || d.id === userDiresaId).map(d => ({ value: d.id, label: d.name }))
                                                                ]}
                                                            />
                                                        </div>
                                                    )}

                                                    {userModalLevel === 'OGESS' && (
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] font-black text-slate-900 uppercase tracking-wider">SELECCIONE OGESS JURISDICCIONAL *</label>
                                                            <CustomSelect
                                                                className="w-full border border-gray-350 rounded-xl px-4 py-2.5 text-xs font-bold bg-white"
                                                                value={userForm.ogessId || ''}
                                                                onChange={selId => {
                                                                    const selO = ogess.find(o => o.id === selId);
                                                                    if (selO) {
                                                                        setUserForm({
                                                                            ...userForm,
                                                                            ogessId: selId,
                                                                            ungetId: '',
                                                                            microredId: '',
                                                                            facilityCode: '',
                                                                            diresaId: selO.diresaId || ''
                                                                        });
                                                                    } else {
                                                                        setUserForm({ ...userForm, ogessId: '', diresaId: '' });
                                                                    }
                                                                }}
                                                                placeholder="Seleccione OGESS..."
                                                                options={[
                                                                    { value: '', label: 'Seleccione OGESS...' },
                                                                    ...ogess.filter(o => {
                                                                        if (isSuperAdmin) return true;
                                                                        if (userOgessId && o.id !== userOgessId) return false;
                                                                        if (!isSuperAdmin && userDiresaId && o.diresaId !== userDiresaId) return false;
                                                                        return true;
                                                                    }).map(o => ({ value: o.id, label: o.name }))
                                                                ]}
                                                            />
                                                        </div>
                                                    )}

                                                    {userModalLevel === 'UNGET' && (
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] font-black text-slate-900 uppercase tracking-wider">SELECCIONE UNGET JURISDICCIONAL *</label>
                                                            <CustomSelect
                                                                className="w-full border border-gray-350 rounded-xl px-4 py-2.5 text-xs font-bold bg-white"
                                                                value={userForm.ungetId || ''}
                                                                onChange={selId => {
                                                                    const selUn = ungets.find(un => un.id === selId);
                                                                    if (selUn) {
                                                                        const selO = ogess.find(o => o.id === selUn.ogessId);
                                                                        setUserForm({
                                                                            ...userForm,
                                                                            ungetId: selId,
                                                                            microredId: '',
                                                                            facilityCode: '',
                                                                            ogessId: selUn.ogessId || '',
                                                                            diresaId: selO?.diresaId || ''
                                                                        });
                                                                    } else {
                                                                        setUserForm({ ...userForm, ungetId: '', ogessId: '', diresaId: '' });
                                                                    }
                                                                }}
                                                                placeholder="Seleccione UNGET..."
                                                                options={[
                                                                    { value: '', label: 'Seleccione UNGET...' },
                                                                    ...ungets.filter(un => {
                                                                        if (isSuperAdmin) return true;
                                                                        if (userUngetId && un.id !== userUngetId) return false;
                                                                        if (userOgessId && un.ogessId !== userOgessId) return false;
                                                                        return true;
                                                                    }).map(u => ({ value: u.id, label: u.name }))
                                                                ]}
                                                            />
                                                        </div>
                                                    )}

                                                    {userModalLevel === 'MICRORED' && (
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] font-black text-slate-900 uppercase tracking-wider">SELECCIONE MICRORED JURISDICCIONAL *</label>
                                                            <CustomSelect
                                                                className="w-full border border-gray-350 rounded-xl px-4 py-2.5 text-xs font-bold bg-white"
                                                                value={userForm.microredId || ''}
                                                                onChange={selId => {
                                                                    const selM = microredes.find(m => m.id === selId);
                                                                    if (selM) {
                                                                        const selU = ungets.find(un => un.id === selM.ungetId);
                                                                        const selO = ogess.find(o => o.id === selU?.ogessId);
                                                                        setUserForm({
                                                                            ...userForm,
                                                                            microredId: selId,
                                                                            facilityCode: '',
                                                                            ungetId: selM.ungetId || '',
                                                                            ogessId: selU?.ogessId || '',
                                                                            diresaId: selO?.diresaId || ''
                                                                        });
                                                                    } else {
                                                                        setUserForm({ ...userForm, microredId: '', ungetId: '', ogessId: '', diresaId: '' });
                                                                    }
                                                                }}
                                                                placeholder="Seleccione MICRORED..."
                                                                options={[
                                                                    { value: '', label: 'Seleccione MICRORED...' },
                                                                    ...microredes.filter(m => {
                                                                        if (isSuperAdmin) return true;
                                                                        if (userMicroredId && m.id !== userMicroredId) return false;
                                                                        if (userUngetId && m.ungetId !== userUngetId) return false;
                                                                        return true;
                                                                    }).map(m => ({ value: m.id, label: m.name }))
                                                                ]}
                                                            />
                                                        </div>
                                                    )}

                                                    {userModalLevel === 'IPRESS' && (
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] font-black text-black uppercase tracking-wider mb-1">SELECCIONE IPRESS (ESTABLECIMIENTO DE SALUD) *</label>
                                                            <CustomSelect
                                                                className="w-full border border-gray-300 rounded-xl px-4 py-2 text-xs font-bold bg-white"
                                                                value={userForm.facilityCode || ''}
                                                                onChange={selId => {
                                                                    const sel = facilities.find(f => f.code === selId);
                                                                    if (sel) {
                                                                        const selM = microredes.find(m => m.id === sel?.microredId);
                                                                        const selU = ungets.find(un => un.id === (selM?.ungetId || sel?.ungetId));
                                                                        const selO = ogess.find(o => o.id === (selU?.ogessId || sel?.ogessId));
                                                                        setUserForm({
                                                                            ...userForm,
                                                                            facilityCode: selId,
                                                                            microredId: sel.microredId || '',
                                                                            ungetId: sel.ungetId || selM?.ungetId || '',
                                                                            ogessId: sel.ogessId || selU?.ogessId || '',
                                                                            diresaId: sel.diresaId || selO?.diresaId || ''
                                                                        });
                                                                    } else {
                                                                        setUserForm({ ...userForm, facilityCode: '', microredId: '', ungetId: '', ogessId: '', diresaId: '' });
                                                                    }
                                                                }}
                                                                placeholder="Seleccione IPRESS..."
                                                                options={[
                                                                    { value: '', label: 'Seleccione IPRESS...' },
                                                                    ...facilities.filter(f => {
                                                                        if (isSuperAdmin) return true;
                                                                        if (userFacilityCode && f.code !== userFacilityCode) return false;
                                                                        if (userMicroredId && f.microredId !== userMicroredId) return false;
                                                                        if (userUngetId && f.ungetId !== userUngetId) return false;
                                                                        if (userOgessId && f.ogessId !== userOgessId) return false;
                                                                        return true;
                                                                    }).map(fac => ({ value: fac.code, label: `${fac.code} - ${fac.name}` }))
                                                                ]}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                            {/* Columna 1: Resumen del Personal Asignado */}
                                            <div className="bg-slate-50/50 border border-slate-200/55 rounded-2xl p-5 text-left space-y-4 shadow-sm animate-in fade-in duration-300">
                                                <div className="flex items-center gap-2 border-b border-slate-200/60 pb-3">
                                                    <div className="h-6 w-6 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 shrink-0">
                                                        <Users className="h-3.5 w-3.5" />
                                                    </div>
                                                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider">
                                                        Resumen del Personal Asignado
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-y-5 gap-x-4 text-xs">
                                                    <div className="col-span-2">
                                                        <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Nombre Completo</div>
                                                        <div className="font-extrabold text-slate-800 mt-1 truncate leading-tight">
                                                            {userForm.firstName || userForm.lastName ? `${userForm.firstName} ${userForm.lastName}`.trim() : <span className="text-slate-400 italic font-normal">Sin registrar</span>}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Usuario / Cuenta</div>
                                                        <div className="font-extrabold text-slate-800 mt-1 truncate">
                                                            {userForm.username ? (
                                                                <span className="font-mono bg-teal-50 text-teal-800 border border-teal-100/35 px-1.5 py-0.5 rounded text-[10px]">
                                                                    @{userForm.username}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 italic font-normal">Sin registrar</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">DNI Identificación</div>
                                                        <div className="font-extrabold text-slate-700 mt-1 font-mono tracking-wider">
                                                            {userForm.dni || <span className="text-slate-400 italic font-normal font-sans tracking-normal">-</span>}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Rol de Acceso</div>
                                                        <div className="font-extrabold text-slate-800 mt-1 truncate leading-tight">
                                                            {(() => {
                                                                const rObj = roles.find(r => r.role === userForm.role);
                                                                return rObj?.label || userForm.role || <span className="text-slate-400 italic font-normal">-</span>;
                                                            })()}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Profesión</div>
                                                        <div className="font-extrabold text-slate-800 mt-1 truncate leading-tight">
                                                            {professionMapLookup.get(userForm.professionId)?.name || <span className="text-slate-400 italic font-normal">Sin registrar</span>}
                                                        </div>
                                                    </div>

                                                    <div className="col-span-2 border-t border-slate-200/50 pt-3 mt-1 grid grid-cols-2 gap-4">
                                                        <div>
                                                            <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Correo Electrónico</div>
                                                            <div className="font-extrabold text-slate-700 mt-1 truncate leading-tight">
                                                                {userForm.email || <span className="text-slate-400 italic font-normal">Sin registrar</span>}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Número de Celular</div>
                                                            <div className="font-extrabold text-slate-700 mt-1 truncate leading-tight">
                                                                {userForm.phone || <span className="text-slate-400 italic font-normal">Sin registrar</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Columna 2: Visualización Jerárquica */}
                                            <div className="space-y-4">
                                                {/* Visualizador Jerárquico */}
                                                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm animate-in fade-in zoom-in-95 duration-200 text-left">
                                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-5 flex items-center gap-1.5 border-b border-slate-100 pb-2.5 text-left">
                                                        <Building2 className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                                                        ESTRUCTURA JERÁRQUICA
                                                    </h4>
                                                    
                                                    <div className="relative pt-1 pl-4 border-l-2 border-slate-200 space-y-4 ml-1">
                                                        {/* DIRESA */}
                                                        <div className="relative text-left">
                                                            <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                                            <div>
                                                                <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">DIRESA</div>
                                                                <div className="text-xs font-bold text-slate-800">
                                                                    {resolvedHierarchy.diresa || <span className="text-slate-400 italic font-normal text-[11px]">Pendiente de selección...</span>}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* OGESS */}
                                                        {['OGESS', 'UNGET', 'MICRORED', 'IPRESS'].includes(userModalLevel) && (
                                                            <div className="relative text-left">
                                                                <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                                                <div>
                                                                    <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">OGESS / RED DE SALUD</div>
                                                                    <div className="text-xs font-bold text-slate-800">
                                                                        {resolvedHierarchy.ogess || <span className="text-slate-400 italic font-normal text-[11px]">Autocompletado desde nodo</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* UNGET */}
                                                        {['UNGET', 'MICRORED', 'IPRESS'].includes(userModalLevel) && (
                                                            <div className="relative text-left">
                                                                <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                                                <div>
                                                                    <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">UNGET / UNIDAD DE GESTIÓN TERRITORIAL</div>
                                                                    <div className="text-xs font-bold text-slate-800">
                                                                        {resolvedHierarchy.unget || <span className="text-slate-400 italic font-normal text-[11px]">Autocompletado desde nodo</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* MICRORED */}
                                                        {['MICRORED', 'IPRESS'].includes(userModalLevel) && (
                                                            <div className="relative text-left">
                                                                <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                                                <div>
                                                                    <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">MICRORED DE SALUD</div>
                                                                    <div className="text-xs font-bold text-slate-800">
                                                                        {resolvedHierarchy.microred || <span className="text-slate-400 italic font-normal text-[11px]">Autocompletado desde nodo</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* IPRESS */}
                                                        {userModalLevel === 'IPRESS' && (
                                                            <div className="relative text-left">
                                                                <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-600 ring-4 ring-white" />
                                                                <div>
                                                                    <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">ESTABLECIMIENTO DE SALUD (IPRESS)</div>
                                                                    {resolvedHierarchy.ipress ? (
                                                                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                                            <span className="text-[10px] font-bold text-teal-800 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded font-mono shrink-0">
                                                                                {userForm.facilityCode}
                                                                            </span>
                                                                            <span className="text-xs font-bold text-slate-800 leading-tight border-b-none">
                                                                                {resolvedHierarchy.ipress}
                                                                            </span>
                                                                        </div>
                                                                     ) : (
                                                                        <div className="text-xs font-medium text-slate-400 italic text-[11px] mt-0.5">Seleccione arriba...</div>
                                                                     )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sticky, Solid-Colored, Forward-Facing Footer Bar */}
                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200/60 flex justify-between items-center shrink-0 z-20">
                        {userModalStep > 1 ? (
                            <button 
                                key="btn-back"
                                type="button"
                                onClick={() => setUserModalStep(userStep => userStep - 1)}
                                className="px-5 py-2 text-xs font-black uppercase text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 rounded-xl transition-all border border-slate-200/80 flex items-center gap-1 shadow-sm"
                            >
                                Atrás
                            </button>
                        ) : (
                            <button 
                                key="btn-cancel"
                                type="button"
                                onClick={() => setIsUserModalOpen(false)}
                                className="px-5 py-2 text-xs font-black uppercase text-slate-500 hover:text-red-650 hover:bg-red-50 rounded-xl transition-all border border-transparent"
                            >
                                Cancelar
                            </button>
                        )}
                        
                        {userModalStep === 1 && (
                            <button 
                                key="btn-next-step-1"
                                type="button"
                                onClick={() => setUserModalStep(2)}
                                disabled={!isStep1Valid}
                                className="bg-slate-900 border border-slate-950 text-white font-black text-xs uppercase py-2 px-6 rounded-xl hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                Siguiente
                            </button>
                        )}
                        {userModalStep === 2 && (
                            <button 
                                key="btn-next-step-2"
                                type="button"
                                onClick={() => setUserModalStep(3)}
                                disabled={!isStep2Valid}
                                className="bg-slate-900 border border-slate-950 text-white font-black text-xs uppercase py-2 px-6 rounded-xl hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                Siguiente
                            </button>
                        )}
                        {userModalStep === 3 && (
                            <button 
                                key="btn-submit-save"
                                type="submit"
                                disabled={isSavingUser || !isStep3Valid}
                                className="bg-[#00a896] hover:bg-[#028074] border border-[#009b8b] text-white font-black text-xs uppercase py-2.5 px-6 rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save className="h-4 w-4" />
                                {isSavingUser ? 'Guardando...' : 'Finalizar y Guardar'}
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    )}

    {/* --- NEW ROLE MODAL --- */}
    {isNewRoleModalOpen && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-teal-500/20 p-2 rounded-lg">
                            <Shield className="h-5 w-5 text-teal-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Crear Nuevo Rol</h3>
                            <p className="text-xs text-gray-400">Defina el código y los permisos del nuevo rol.</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsNewRoleModalOpen(false)}
                        className="text-gray-400 hover:text-white transition-colors hover:bg-white/10 p-1 rounded-full"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <form onSubmit={handleCreateRole} className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-2">
                        {/* Columna Izquierda: Identificador, Nombre y Límites (col-span-4) */}
                        <div className="space-y-4 md:col-span-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Identificador del Rol *</label>
                                <input 
                                    type="text"
                                    required
                                    placeholder="Ej: AUDITOR"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 uppercase outline-none"
                                    value={newRoleForm.role}
                                    onChange={e => setNewRoleForm({...newRoleForm, role: e.target.value})}
                                />
                                <p className="text-[10px] text-gray-400 mt-1">Código único sin espacios (Ej: MEDICO, ANALISTA).</p>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Nombre Descriptivo</label>
                                <input 
                                    type="text"
                                    placeholder="Ej: Personal Auditor"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={newRoleForm.label}
                                    onChange={e => setNewRoleForm({...newRoleForm, label: e.target.value})}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">Nivel de Jurisdicción</label>
                                <CustomSelect
                                    className="w-full border border-gray-300 rounded-lg"
                                    value={newRoleForm.jurisdictionLevel || ''}
                                    onChange={val => setNewRoleForm({...newRoleForm, jurisdictionLevel: val as any})}
                                    options={[
                                        { value: '', label: 'Automático / Predeterminado' },
                                        { value: 'GLOBAL', label: 'GLOBAL (Nacional)' },
                                        { value: 'DIRESA', label: 'DIRESA' },
                                        { value: 'OGESS', label: 'OGESS' },
                                        { value: 'UNGET', label: 'UNGET' },
                                        { value: 'MICRORED', label: 'MICRORED' },
                                        { value: 'IPRESS', label: 'IPRESS (Establecimiento)' }
                                    ]}
                                />
                                <p className="text-[10px] text-gray-500 mt-1">Define el alcance si el usuario usará la plataforma bajo cierta jurisdicción.</p>
                            </div>

                            <div className="pt-2">
                                <label className="block text-xs font-bold text-gray-700 mb-2">Límites del Sistema</label>
                                <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg">
                                    <label className="block text-xs font-bold text-gray-600 mb-2">Máximo de URLs (SIG_SEARCH):</label>
                                    <input 
                                        type="number"
                                        min="1"
                                        placeholder="Ilimitado"
                                        value={newRoleForm.maxUrlsAllowed}
                                        onChange={(e) => setNewRoleForm({...newRoleForm, maxUrlsAllowed: e.target.value})}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1">Deje vacío para permitir búsquedas sin límite.</p>
                                </div>
                            </div>
                        </div>

                        {/* Columna Derecha: Permisos Iniciales (col-span-8) */}
                        <div className="flex flex-col h-full border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6 md:col-span-8">
                            <label className="block text-xs font-bold text-gray-700 mb-2">Permisos Iniciales</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
                                {AVAILABLE_MODULES.map(module => {
                                    const isChecked = newRoleForm.allowedModules.includes(module.id as never);
                                    return (
                                        <label key={module.id} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded border border-gray-100 hover:bg-gray-100 cursor-pointer transition-all" title={module.description}>
                                            <input 
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                    const newMods = e.target.checked 
                                                        ? [...newRoleForm.allowedModules, module.id]
                                                        : newRoleForm.allowedModules.filter(m => m !== module.id);
                                                    setNewRoleForm({...newRoleForm, allowedModules: newMods as any});
                                                }}
                                                className="rounded text-teal-600 focus:ring-teal-500 mt-0.5 animate-none"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-gray-700">{module.label}</span>
                                                <span className="text-[9px] text-gray-400 leading-tight">{module.description}</span>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button 
                            type="button"
                            onClick={() => setIsNewRoleModalOpen(false)}
                            className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit"
                            disabled={isSavingRole || !newRoleForm.role}
                            className="bg-teal-600 text-white font-bold py-2.5 px-6 rounded-lg shadow-md hover:bg-teal-700 transition-all flex items-center gap-2 disabled:opacity-70"
                        >
                            <Save className="h-4 w-4" />
                            {isSavingRole ? 'Creando...' : 'Crear Rol'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )}

    {/* --- EDIT ROLE MODAL --- */}
    {isEditRoleModalOpen && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-teal-500/20 p-2 rounded-lg">
                            <Edit className="h-5 w-5 text-teal-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Editar Datos del Rol</h3>
                            <p className="text-xs text-gray-400">Actualizar nombre y código del rol.</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsEditRoleModalOpen(false)}
                        className="text-gray-400 hover:text-white transition-colors hover:bg-white/10 p-1 rounded-full"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <form onSubmit={handleSaveEditRole} className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    <div className="space-y-5">
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">Nombre Descriptivo</label>
                            <input 
                                type="text"
                                placeholder="Ej: Responsable Farmacia"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                value={editRoleForm.label}
                                onChange={e => setEditRoleForm({...editRoleForm, label: e.target.value})}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">CÓDIGO (Identificador Único)</label>
                            <input 
                                type="text"
                                placeholder="Ej: FARMACIA"
                                className="w-full border border-gray-300 bg-gray-50 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-teal-500 outline-none uppercase"
                                value={editRoleForm.role}
                                onChange={e => setEditRoleForm({...editRoleForm, role: e.target.value.toUpperCase().replace(/\s+/g, '_')})}
                                required
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Este código se usa internamente y debe ser único. Sin espacios (use guión bajo).</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">Nivel de Jurisdicción</label>
                            <CustomSelect
                                className="w-full border border-gray-300 rounded-lg"
                                value={editRoleForm.jurisdictionLevel || ''}
                                onChange={val => setEditRoleForm({...editRoleForm, jurisdictionLevel: val as any})}
                                options={[
                                    { value: '', label: 'Automático / Predeterminado' },
                                    { value: 'GLOBAL', label: 'GLOBAL (Nacional)' },
                                    { value: 'DIRESA', label: 'DIRESA' },
                                    { value: 'OGESS', label: 'OGESS' },
                                    { value: 'UNGET', label: 'UNGET' },
                                    { value: 'MICRORED', label: 'MICRORED' },
                                    { value: 'IPRESS', label: 'IPRESS (Establecimiento)' }
                                ]}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Nivel jerárquico organizacional al que pertenece este rol.</p>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button 
                            type="button"
                            onClick={() => setIsEditRoleModalOpen(false)}
                            className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit"
                            disabled={isSavingRole || !editRoleForm.role || !editRoleForm.label}
                            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-bold transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-teal-500"
                        >
                            <Save className="h-4 w-4" />
                            {isSavingRole ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )}

    {/* --- MODERN USER VISUALIZATION DETAIL MODAL --- */}
    {viewingUser && (() => {
        const u = viewingUser;
        const personnelName = u.personnel ? `${u.personnel.firstName} ${u.personnel.lastName}` : 'Sin datos de personal';
        const detailDni = u.personnel?.dni || u.dni || '-';
        const detailEmail = u.personnel?.email || u.email || '-';
        const detailPhone = u.personnel?.phone || u.phone || '-';
        const detailBirthDate = u.personnel?.birthDate ? new Date(u.personnel.birthDate).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) : '-';

        // Profession & Labor regime
        const detailProfession = u.personnel?.professionData?.name || professionMapLookup.get(u.personnel?.professionId)?.name || '-';
        const detailLaborRegime = u.personnel?.laborRegimeData?.name || laborRegimeMapLookup.get(u.personnel?.laborRegimeId)?.name || '-';

        // System Role label
        const rObj = roles.find(r => r.role === u.role);
        const roleLabel = rObj?.label || u.role;
        const allowedModules = rObj?.allowedModules || [];
        const jurisdictionLevel = rObj?.jurisdictionLevel || 'No especificado';

        // Resolve structural scope (including intermediate derived names)
        const p = u.personnel || u.personnelData || u;
        let diresaName = '-';
        let ogessName = '-';
        let ungetName = '-';
        let microredName = '-';
        let facilityName = '-';
        let facilityCodeStr = p.facilityCode || u.facilityCode || '';

        // Resolve hierarchy IDs
        let dId = p.diresaId || u.diresaId || '';
        let oId = p.ogessId || u.ogessId || '';
        let unId = p.ungetId || u.ungetId || '';
        let mrId = p.microredId || u.microredId || '';

        if (facilityCodeStr) {
            const f = facilityMapLookup.get(facilityCodeStr);
            if (f) {
                facilityName = f.name || '-';
                if (!mrId) mrId = f.microredId;
                if (!unId) unId = f.ungetId;
                if (!oId) oId = f.ogessId;
                if (!dId) dId = f.diresaId;
            }
        }

        if (mrId) {
            const m = microredMapLookup.get(mrId);
            if (m) {
                microredName = m.name || '-';
                if (!unId) unId = m.ungetId;
            }
        }

        if (unId) {
            const un = ungetMapLookup.get(unId);
            if (un) {
                ungetName = un.name || '-';
                if (!oId) oId = un.ogessId;
                if (!dId) dId = un.diresaId;
            }
        }

        if (oId) {
            const ogObj = ogess.find(o => o.id === oId);
            if (ogObj) {
                ogessName = ogObj.name || '-';
                if (!dId) dId = ogObj.diresaId;
            }
        }

        if (dId) {
            const dirObj = diresas.find(d => d.id === dId);
            if (dirObj) {
                diresaName = dirObj.name || '-';
            }
        }

        const initials = personnelName
            .split(' ')
            .filter(Boolean)
            .map(n => n[0])
            .slice(0, 2)
            .join('')
            .toUpperCase() || 'US';

        return createPortal(
            <div className="fixed inset-0 z-[111000] flex items-center justify-center p-4 animate-in fade-in duration-200">
                {/* Backdrop with elegant blur */}
                <div 
                    onClick={() => setViewingUser(null)} 
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm cursor-pointer"
                />

                {/* Modal box */}
                <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh] border border-slate-100">
                    
                    {/* Header: Visual Profile */}
                    <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-teal-950 text-white p-6 shrink-0 relative overflow-hidden">
                        {/* Decorative subtle background waves */}
                        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 bg-[radial-gradient(circle_at_right,_var(--tw-gradient-stops))] from-teal-400 to-transparent pointer-events-none" />

                        <div className="flex justify-between items-start relative z-10">
                            <div className="flex items-center gap-4">
                                {/* Large Avatar */}
                                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center font-bold text-xl text-white shadow-xl shadow-teal-950/40 border border-teal-400/20 tracking-wider shrink-0">
                                    {initials}
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-xl font-extrabold tracking-tight leading-tight">{personnelName}</h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] uppercase font-extrabold bg-blue-500/20 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                            Rol: {roleLabel}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className={`text-[10px] uppercase tracking-wider font-extrabold px-2.5 py-1 rounded-full ${u.isActive ? 'bg-emerald-500/20 text-emerald-350 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-350 border border-rose-500/30'}`}>
                                    {u.isActive ? 'Activo' : 'Inactivo'}
                                </span>
                                <button 
                                    onClick={() => setViewingUser(null)}
                                    className="text-slate-300 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all duration-150"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 bg-slate-50/50 text-left">
                        
                        {/* Grid: 2 Columns for details */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            
                            {/* Card 1: Personal, Professional & Contract Info */}
                            <div className="bg-white rounded-xl p-5 border border-slate-100 hover:border-slate-200 shadow-sm space-y-4 text-left">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5 text-left">
                                    <Users className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                                    Identificación y Profesión
                                </h4>
                                
                                <div className="space-y-3.5">
                                    <div>
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Nombre de Usuario</span>
                                        <span className="text-sm font-bold text-teal-800 bg-teal-50 border border-teal-100/50 px-2 py-0.5 rounded font-mono inline-block mt-0.5">@{u.username}</span>
                                    </div>

                                    <div>
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Documento (DNI)</span>
                                        <span className="text-sm font-mono font-bold text-slate-700">{detailDni}</span>
                                    </div>
                                    
                                    <div>
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Profesión / Especialidad</span>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-teal-50 text-teal-800 border border-teal-100/50 capitalize mt-1">
                                            <Briefcase className="h-3 w-3 shrink-0" />
                                            {detailProfession}
                                        </span>
                                    </div>

                                    <div>
                                        <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Régimen Laboral</span>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-blue-50 text-blue-800 border border-blue-100/50 capitalize mt-1">
                                            <Sliders className="h-3 w-3 shrink-0" />
                                            {detailLaborRegime}
                                        </span>
                                    </div>

                                    {u.personnel?.birthDate && (
                                        <div>
                                            <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Fecha de Nacimiento</span>
                                            <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5 mt-1">
                                                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                {detailBirthDate}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Card 2: Contact Information */}
                            <div className="bg-white rounded-xl p-5 border border-slate-100 hover:border-slate-200 shadow-sm space-y-4 flex flex-col justify-between text-left">
                                <div>
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5 text-left">
                                        <Phone className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                                        Información de Contacto
                                    </h4>
                                    
                                    <div className="space-y-4 mt-3.5">
                                        <div>
                                            <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Correo Electrónico</span>
                                            {detailEmail !== '-' ? (
                                                <a 
                                                    href={`mailto:${detailEmail}`}
                                                    className="inline-flex items-center gap-2 text-sm font-semibold text-teal-600 hover:text-teal-700 hover:underline bg-teal-50/40 px-2.5 py-1 rounded-lg border border-teal-100/20"
                                                >
                                                    <Mail className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                                                    <span className="truncate max-w-[200px]">{detailEmail}</span>
                                                </a>
                                            ) : (
                                                <span className="text-slate-400 font-medium text-xs">No registrado</span>
                                            )}
                                        </div>

                                        <div>
                                            <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Teléfono / Celular</span>
                                            {detailPhone !== '-' ? (
                                                <a 
                                                    href={`tel:${detailPhone}`}
                                                    className="inline-flex items-center gap-2 text-sm font-semibold text-teal-600 hover:text-teal-700 hover:underline bg-teal-50/40 px-2.5 py-1 rounded-lg border border-teal-100/20"
                                                >
                                                    <Phone className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                                                    {detailPhone}
                                                </a>
                                            ) : (
                                                <span className="text-slate-400 font-medium text-xs">No registrado</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 pt-3 border-t border-slate-100 bg-slate-50/50 p-3 rounded-lg text-[11px] text-slate-500 flex gap-2 items-start leading-relaxed">
                                    <Lock className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                                    <span>Para actualizar o modificar estos datos privados de personal, por favor use el botón <strong>Editar</strong> en el menú de acciones rápidas.</span>
                                </div>
                            </div>

                        </div>

                        {/* Card 3: Adscripción Territorial de Salud / Red (Visual Hierarchical Flow) */}
                        <div className="bg-white rounded-xl p-5 border border-slate-100 hover:border-slate-200 shadow-sm space-y-4 text-left">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5 text-left">
                                <Building2 className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                                Adscripción Territorial y Red de Salud 
                            </h4>

                            <div className="relative pt-2 pl-4 border-l-2 border-slate-200 space-y-4 ml-1">
                                {/* DIRESA */}
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                    <div>
                                        <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">DIRESA</div>
                                        <div className="text-xs font-bold text-slate-800">{diresaName}</div>
                                    </div>
                                </div>

                                {/* OGESS */}
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                    <div>
                                        <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">OGESS / Red de Salud</div>
                                        <div className="text-xs font-bold text-slate-800">{ogessName}</div>
                                    </div>
                                </div>

                                {/* UNGET */}
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                    <div>
                                        <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">UNGET / Unidad de Gestión Territorial</div>
                                        <div className="text-xs font-bold text-slate-800">{ungetName}</div>
                                    </div>
                                </div>

                                {/* Microred */}
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white" />
                                    <div>
                                        <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">Microred de Salud</div>
                                        <div className="text-xs font-bold text-slate-800">{microredName}</div>
                                    </div>
                                </div>

                                {/* Establecimiento */}
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-600 ring-4 ring-white" />
                                    <div>
                                        <div className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">Establecimiento de Salud (IPRESS)</div>
                                        {facilityCodeStr ? (
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                <span className="text-xs font-bold text-teal-800 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-md font-mono shrink-0">
                                                    {facilityCodeStr}
                                                </span>
                                                <span className="text-xs font-bold text-slate-800 leading-tight">
                                                    {facilityName}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="text-xs font-medium text-slate-400 text-slate-450">Sin Establecimiento IPRESS</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Footer buttons */}
                    <div className="bg-slate-50 px-6 py-4 flex justify-between items-center shrink-0 border-t border-slate-100">
                        <div className="text-[10px] text-slate-400 font-semibold font-mono">
                            SISMED TOOLKIT • ID: {u.personnelId || 'SYSTEM_AUTH'}
                        </div>
                        <button 
                            onClick={() => setViewingUser(null)}
                            className="bg-slate-800 hover:bg-slate-900 border border-slate-700 hover:border-slate-850 px-6 py-2 rounded-xl text-xs font-bold text-white transition-colors cursor-pointer shadow-sm"
                        >
                            Cerrar Vista
                        </button>
                    </div>

                </div>
            </div>,
            document.body
        );
    })()}
    </>
  );
};
