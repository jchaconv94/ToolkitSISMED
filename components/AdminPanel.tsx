
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { RoleConfig, HealthFacility, AVAILABLE_MODULES, LaborRegime, Profession } from '../types';
import { canAssignRole } from '../services/userManagementRules';
import { Users, Shield, X, Sliders, Save, Clock, Link2, AlertTriangle, RefreshCw, UserPlus, Edit, Power, Building2, Briefcase, Trash2, Search, Filter, Phone, Mail, Lock, Calendar, FileSpreadsheet, Wrench, Archive, MoreVertical, MoreHorizontal, MapPin, UserCheck, UserX, SlidersHorizontal, Plus, ChevronRight, ChevronDown, Check, ArrowLeft, BarChart2, ArrowRightLeft, HardDriveDownload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import { AdminOrganizationModule } from './AdminOrganizationModule';
import { AdminCatalogsModule } from './AdminCatalogsModule';
import { backupSettingsApi } from '../services/backupConnection';
import { noticeSettingsApi } from '../services/noticeSettings';
import { DEFAULT_NOTICE_THRESHOLDS, NoticeThresholds } from '../services/notifications';
import { NoticeSettingsCard } from './NoticeSettingsCard';
import { SettingsRow, SettingsSection, settingsNumberClass } from './ui/SettingsSection';
import { CustomSelect } from './ui/CustomSelect';
import { isPharmacyType } from '../services/facilityHierarchy';
import { KpiCard, KpiStrip, StatusChip, FormField, inputClass, SortButton, ariaSort, tableSearchBoxClass, useTableSort } from './ui/kit';
import { ResponsiveDialog, DialogSection, DialogRow, dialogPrimaryButton, dialogSecondaryButton } from './ui/ResponsiveDialog';
import { ConfirmationDialog } from './ui/ConfirmationDialog';
import { TablePagination } from './ui/TablePagination';
import { FloatingActionButton } from './ui/FloatingActionButton';
import { BottomSheet } from './ui/BottomSheet';
import { LoadMoreSentinel, useIncrementalCount } from './ui/IncrementalList';
import { FloatingTableHead, tableHeadCellClass, tableHeadTextClass, useFloatingTableHead } from './ui/FloatingTableHead';
import { useIsDesktop } from './ui/useIsDesktop';
import { stickyBarClass, useStickyBar } from './ui/useStickyBar';
import { ModuleFooterPortal } from './ui/ModuleHeaderSlot';
import { NAV_SECTIONS } from './navigation';
import { actionsOf, allowedActionCount, isActionAllowed, setActionAllowed, setAllActionsAllowed } from '../services/moduleActions';
import { useModuleHeaderOverride } from '../contexts/ModuleHeaderContext';

export const AdminPanel: React.FC<{ currentView?: string }> = ({ currentView }) => {
  const activeTab = currentView ? currentView.replace('ADMIN_', '') as 'USERS' | 'ROLES' | 'PARAMS' | 'FACILITIES' | 'CATALOGS' : 'USERS';
  
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

  const { systemConfig, updateSystemConfigContext, user: currentUser, refreshUserData, hasPermission, can } = useAuth();
  // Acciones que el rol puede usar en cada pestaña (Configuración de Roles).
  const canUsers = {
      create: can('ADMIN_USERS', 'create'), edit: can('ADMIN_USERS', 'edit'), toggle: can('ADMIN_USERS', 'toggle'),
      delete: can('ADMIN_USERS', 'delete'), export: can('ADMIN_USERS', 'export'),
  };
  const canRoles = { create: can('ADMIN_ROLES', 'create'), edit: can('ADMIN_ROLES', 'edit') };
  const canParams = { maintenance: can('ADMIN_PARAMS', 'maintenance'), save: can('ADMIN_PARAMS', 'save') };
  const [tempConfig, setTempConfig] = useState(systemConfig);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  // Backups SISMED: el límite vive en su propia tabla, que solo escribe el administrador.
  const [backupLimit, setBackupLimit] = useState<{ saved: number | null; value: number; error: string | null }>({ saved: null, value: 1, error: null });
  // Umbrales de la campanita de avisos: también en su propia tabla (SUPABASE_AVISOS_PARAMETROS.sql).
  const [noticeLimits, setNoticeLimits] = useState<{ saved: NoticeThresholds | null; value: NoticeThresholds; error: string | null }>({ saved: null, value: DEFAULT_NOTICE_THRESHOLDS, error: null });
  const [isRefreshingUsers, setIsRefreshingUsers] = useState(false);

  // --- USER DIRECTORY SEARCH & FILTERS STATE ---
  const [searchTerm, setSearchTerm] = useState('');
  const searchBar = useStickyBar<HTMLDivElement>();
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

  // 1. Hierarchy filter (authorized users list): los usuarios que esta cuenta puede ver.
  // Los indicadores de la pantalla cuentan sobre esta lista, antes de buscar o filtrar.
  const scopedUsers = useMemo(() => {
      if (isSuperAdmin) return users;
      return users.filter(u => {
          const target = getExpandedHierarchy(u);

          if (userFacilityCode) return target.facilityCode === userFacilityCode;
          if (userMicroredId) return target.microredId === userMicroredId;
          if (userUngetId) return target.ungetId === userUngetId;
          if (userOgessId) return target.ogessId === userOgessId;
          if (userDiresaId) return target.diresaId === userDiresaId;

          return false;
      });
  }, [users, isSuperAdmin, userDiresaId, userOgessId, userUngetId, userMicroredId, userFacilityCode, getExpandedHierarchy]);

  // Búsqueda y filtros, menos el estado: los indicadores cuentan sobre esta lista, así
  // reflejan los filtros aplicados y siguen sirviendo para elegir Activos / Inactivos.
  const usersMatchingFilters = useMemo(() => {
      let list = scopedUsers;

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
      scopedUsers,
      searchTerm, filterProfession, filterRole, filterDiresa, filterOgess, filterUnget, filterLaborRegime, filterMicrored,
      facilityMapLookup, microredMapLookup, ungetMapLookup, ogess, getExpandedHierarchy
  ]);

  // 5. Filter by Status (los indicadores Usuarios / Activos / Inactivos)
  const filteredUsersUnsorted = useMemo(() => {
      if (filterStatus === 'ALL') return usersMatchingFilters;
      return usersMatchingFilters.filter(u => {
          const uActive = u.isActive === true || String(u.isActive).toLowerCase() === 'true';
          return filterStatus === 'ACTIVE' ? uActive : !uActive;
      });
  }, [usersMatchingFilters, filterStatus]);

  // --- LISTA DE USUARIOS: tabla paginada en escritorio, tarjetas que cargan al bajar en el celular ---
  const USERS_PAGE_SIZE = 10;
  const isDesktop = useIsDesktop();
  const usersFilterKey = [searchTerm, filterProfession, filterRole, filterStatus, filterDiresa, filterOgess, filterUnget, filterLaborRegime, filterMicrored].join('|');
  const [usersPage, setUsersPage] = useState(1);
  // La paginación, la lista del celular y el orden por cabecera van más abajo, después de
  // `jurisdictionOf`, que el orden necesita.
  // Menú «⋯» de una tarjeta del celular (por nombre de usuario) y menú de acciones de la barra.
  const [userMenuFor, setUserMenuFor] = useState<string | null>(null);
  const [usersActionsOpen, setUsersActionsOpen] = useState(false);
  useEffect(() => {
      if (!userMenuFor) return;
      const close = () => setUserMenuFor(null);
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
  }, [userMenuFor]);

  // Roles en el celular: primero la lista; al tocar un rol, su detalle (la flecha vuelve).
  const [roleDetailOpen, setRoleDetailOpen] = useState(false);
  const selectedRoleForHeader = roles.find(r => r.role === selectedRoleId);
  useModuleHeaderOverride(
      activeTab === 'ROLES' && !isDesktop && roleDetailOpen && selectedRoleForHeader
          ? { title: selectedRoleForHeader.label || selectedRoleForHeader.role, subtitle: 'Roles', onBack: () => setRoleDetailOpen(false) }
          : null
  );

  const isUserActiveValue = (u: any) => u.isActive === true || String(u.isActive).toLowerCase() === 'true';
  const activeUsersCount = useMemo(() => usersMatchingFilters.filter(isUserActiveValue).length, [usersMatchingFilters]);
  const roleLabelOf = (u: any) => roles.find(r => r.role === u.role)?.label || u.role || '-';

  // Módulos asignables a un rol, agrupados como en el menú, con interruptores. Lo usan el
  // detalle del rol y la ventana «Nuevo rol».
  const SECTION_DOT: Record<string, string> = { teal: 'bg-teal-500', cyan: 'bg-cyan-500', violet: 'bg-violet-500', slate: 'bg-slate-500' };
  // Acciones de cada módulo (services/moduleActions.ts): un módulo activo muestra cuántas tiene
  // el rol y, al tocarlo, sus interruptores. Solo en el detalle del rol: un rol nuevo empieza
  // con todas.
  const [openActionsModule, setOpenActionsModule] = useState<string | null>(null);
  type ModuleActionsConfig = {
      denied: string[];
      onAction: (module: string, action: string | null, allowed: boolean) => void;
      /** El Administrador total siempre puede todo (AuthContext `can`). */
      locked?: boolean;
      /** Sin permiso para cambiar módulos y acciones: solo se muestran. */
      readOnly?: boolean;
  };
  const renderModuleGroups = (
      enabled: Set<string>,
      onToggle: (module: string, on: boolean) => void,
      onSection: (modules: string[], on: boolean) => void,
      twoColumns: boolean,
      actionsConfig?: ModuleActionsConfig
  ) => (
      <div className={twoColumns ? 'grid gap-4 xl:grid-cols-2' : 'space-y-3'}>
          {NAV_SECTIONS.map(section => {
              const sectionModules = section.items.map(it => it.module as string);
              const on = sectionModules.filter(m => enabled.has(m)).length;
              const all = on === sectionModules.length;
              return (
                  <div key={section.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                          <p className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-slate-600">
                              <span className={`h-2 w-2 rounded-full ${SECTION_DOT[section.tint]}`} />
                              {section.label}
                              <span className="font-bold normal-case tracking-normal text-slate-400">· {on} de {sectionModules.length}</span>
                          </p>
                          {!actionsConfig?.readOnly && (
                              <button type="button" onClick={() => onSection(sectionModules, !all)} className="text-[12px] font-bold text-teal-700 hover:text-teal-900 cursor-pointer">
                                  {all ? 'Quitar todos' : 'Marcar todos'}
                              </button>
                          )}
                      </div>
                      <div className="divide-y divide-slate-100">
                          {section.items.map(item => {
                              const checked = enabled.has(item.module);
                              const Icon = item.icon;
                              const moduleActions = actionsConfig ? actionsOf(item.module) : [];
                              const counts = actionsConfig ? allowedActionCount(actionsConfig.locked ? [] : actionsConfig.denied, item.module) : { allowed: 0, total: 0 };
                              const showActions = checked && moduleActions.length > 0;
                              const open = showActions && openActionsModule === item.module;
                              const toggleModule = () => { if (!actionsConfig?.readOnly) onToggle(item.module, !checked); };
                              return (
                                  <div key={item.module}>
                                      <div
                                          onClick={toggleModule}
                                          className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors ${actionsConfig?.readOnly ? '' : 'hover:bg-slate-50 cursor-pointer'}`}
                                      >
                                          <Icon className={`h-[18px] w-[18px] shrink-0 ${checked ? 'text-teal-600' : 'text-slate-400'}`} />
                                          <span className="min-w-0 flex-1">
                                              <span className={`block text-[13.5px] font-bold ${checked ? 'text-slate-900' : 'text-slate-600'}`}>{item.label}</span>
                                              <span className="block truncate text-xs text-slate-500">{item.description}</span>
                                          </span>
                                          {showActions && (
                                              <button
                                                  type="button"
                                                  aria-expanded={open}
                                                  onClick={(e) => { e.stopPropagation(); setOpenActionsModule(open ? null : item.module); }}
                                                  className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-bold cursor-pointer ${counts.allowed === counts.total ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                                              >
                                                  {counts.allowed === counts.total ? 'Todas las acciones' : `${counts.allowed} de ${counts.total} acciones`}
                                                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                              </button>
                                          )}
                                          <button
                                              type="button"
                                              role="switch"
                                              aria-checked={checked}
                                              aria-label={item.label}
                                              disabled={actionsConfig?.readOnly}
                                              onClick={(e) => { e.stopPropagation(); toggleModule(); }}
                                              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${checked ? 'bg-teal-600' : 'bg-slate-200'} ${actionsConfig?.readOnly ? '' : 'cursor-pointer'}`}
                                          >
                                              <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}>
                                                  {checked && <Check className="h-3 w-3 text-teal-600" />}
                                              </span>
                                          </button>
                                      </div>
                                      {open && actionsConfig && (
                                          <div className="mx-4 mb-3 rounded-xl border border-slate-200 bg-slate-50/70">
                                              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                                                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Qué puede hacer en este módulo</p>
                                                  {!actionsConfig.locked && !actionsConfig.readOnly && (
                                                      <button type="button" onClick={() => actionsConfig.onAction(item.module, null, counts.allowed !== counts.total)} className="text-[12px] font-bold text-teal-700 hover:text-teal-900 cursor-pointer">
                                                          {counts.allowed === counts.total ? 'Quitar todas' : 'Marcar todas'}
                                                      </button>
                                                  )}
                                              </div>
                                              <div className="divide-y divide-slate-200/70">
                                                  {moduleActions.map(action => {
                                                      const allowed = actionsConfig.locked || isActionAllowed(actionsConfig.denied, item.module, action.id);
                                                      const disabled = actionsConfig.locked || actionsConfig.readOnly;
                                                      return (
                                                          <button
                                                              key={action.id}
                                                              type="button"
                                                              role="switch"
                                                              aria-checked={allowed}
                                                              disabled={disabled}
                                                              onClick={() => actionsConfig.onAction(item.module, action.id, !allowed)}
                                                              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-white'}`}
                                                          >
                                                              <span className="min-w-0 flex-1">
                                                                  <span className={`block text-[13px] font-semibold ${allowed ? 'text-slate-800' : 'text-slate-500'}`}>{action.label}</span>
                                                                  {action.hint && <span className="block text-[11.5px] text-slate-400">{action.hint}</span>}
                                                              </span>
                                                              {action.readOnly && <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10.5px] font-bold text-slate-400 ring-1 ring-slate-200">Solo lectura</span>}
                                                              <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${allowed ? 'bg-teal-600' : 'bg-slate-200'} ${disabled ? 'opacity-60' : ''}`}>
                                                                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${allowed ? 'left-[18px]' : 'left-0.5'}`} />
                                                              </span>
                                                          </button>
                                                      );
                                                  })}
                                              </div>
                                              <p className="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-[11.5px] text-slate-500">
                                                  <Lock className="h-3.5 w-3.5 shrink-0" />
                                                  {actionsConfig.locked ? 'El Administrador total siempre puede usar todas las acciones.' : 'Ver el módulo siempre está permitido si el módulo está activo.'}
                                              </p>
                                          </div>
                                      )}
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              );
          })}
      </div>
  );

  // Nombre de la jurisdicción de un usuario según el nivel de su rol.
  const jurisdictionOf = (u: any): string => {
      const level = roles.find(r => r.role === u.role)?.jurisdictionLevel;
      const h = getExpandedHierarchy(u);
      if (level === 'GLOBAL') return 'Nacional';
      if (level === 'DIRESA' || u.role === 'DIRESA') return diresaMapLookup.get(h.diresaId)?.name || '-';
      if (level === 'OGESS' || u.role === 'OGESS') return ogessMapLookup.get(h.ogessId)?.name || '-';
      if (level === 'UNGET' || u.role === 'UNGET') return ungetMapLookup.get(h.ungetId)?.name || '-';
      if (level === 'MICRORED' || u.role === 'MICRORED') return microredMapLookup.get(h.microredId)?.name || '-';
      if (level === 'IPRESS' || u.role === 'IPRESS') return facilityMapLookup.get(h.facilityCode)?.name || '-';
      // Sin nivel configurado: el dato más específico que tenga.
      if (h.ungetId) return ungetMapLookup.get(h.ungetId)?.name || '-';
      if (h.ogessId) return ogessMapLookup.get(h.ogessId)?.name || '-';
      if (h.diresaId) return diresaMapLookup.get(h.diresaId)?.name || '-';
      if (h.facilityCode) return facilityMapLookup.get(h.facilityCode)?.name || '-';
      return '-';
  };

  // Orden por cabecera de la tabla de usuarios: sobre los filtrados y antes de paginar; las
  // tarjetas del celular usan el mismo orden.
  const { sorted: filteredUsers, sort: usersSort, toggle: toggleUsersSort, dirOf: usersSortDir } = useTableSort(filteredUsersUnsorted, {
      usuario: (u: any) => (u.personnel ? `${u.personnel.firstName} ${u.personnel.lastName}` : null),
      profesion: (u: any) => u.personnel?.professionData?.name || professionMapLookup.get(u.personnel?.professionId)?.name || null,
      jurisdiccion: (u: any) => { const j = jurisdictionOf(u); return j !== '-' ? j : null; },
      rol: (u: any) => roleLabelOf(u),
      estado: (u: any) => (isUserActiveValue(u) ? 'Activo' : 'Inactivo'),
      telefono: (u: any) => u.personnel?.phone || null,
  });
  useEffect(() => setUsersPage(1), [usersFilterKey, usersSort]);
  const usersPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  useEffect(() => {
      if (usersPage > usersPageCount) setUsersPage(usersPageCount);
  }, [usersPage, usersPageCount]);
  const pageUsers = useMemo(
      () => filteredUsers.slice((usersPage - 1) * USERS_PAGE_SIZE, usersPage * USERS_PAGE_SIZE),
      [filteredUsers, usersPage]
  );
  const mobileUsers = useIncrementalCount(filteredUsers.length, usersFilterKey);
  const { tableRef: usersTableRef, floating: usersFloatingHead } = useFloatingTableHead([pageUsers, activeTab, isDesktop]);

  const HIERARCHY_WEIGHTS: Record<string, number> = {
      'GLOBAL': 100,
      'DIRESA': 80,
      'OGESS': 60,
      'UNGET': 40,
      'MICRORED': 20,
      'IPRESS': 0,
      '': -1
  };

  // Misma regla que aplica el servidor (`app_manage_save_user`): el nivel sale solo de
  // la configuración del rol, sin adivinarlo por el nombre, para no ofrecer lo que el
  // guardado va a rechazar.
  const configuredLevel = (roleKey?: string) =>
      roles.find(r => r.role === roleKey)?.jurisdictionLevel || '';
  const canAssignRoleKey = (roleKey?: string) =>
      canAssignRole({
          callerIsAdmin: isSuperAdmin,
          callerLevel: configuredLevel(currentUser?.role),
          targetRole: roleKey,
          targetLevel: configuredLevel(roleKey),
      });

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

  useEffect(() => {
      if (activeTab !== 'PARAMS' || currentUser?.role !== 'ADMIN') return;
      backupSettingsApi.get()
          .then((s) => setBackupLimit({ saved: s.dailyLimit, value: s.dailyLimit, error: null }))
          .catch((e: any) => setBackupLimit((prev) => ({ ...prev, error: e?.message || 'No se pudo leer el límite.' })));
      noticeSettingsApi.get()
          .then(({ staleDays, expiryDays }) => setNoticeLimits({ saved: { staleDays, expiryDays }, value: { staleDays, expiryDays }, error: null }))
          .catch((e: any) => setNoticeLimits((prev) => ({ ...prev, error: `${e?.message || 'No se pudieron leer los avisos.'} Mientras tanto se usan ${DEFAULT_NOTICE_THRESHOLDS.staleDays} y ${DEFAULT_NOTICE_THRESHOLDS.expiryDays} días.` })));
  }, [activeTab, currentUser?.role]);

  const handleSaveConfig = async () => {
      setIsSavingConfig(true);
      const toastId = toast.loading('Guardando parámetros...');

      if (backupLimit.saved != null && backupLimit.value !== backupLimit.saved) {
          try {
              await backupSettingsApi.save(backupLimit.value);
              setBackupLimit((prev) => ({ ...prev, saved: prev.value, error: null }));
          } catch (e: any) {
              toast.error(e?.message || 'No se pudo guardar el límite de backups.', { id: toastId });
              setIsSavingConfig(false);
              return;
          }
      }

      const { saved: noticeSaved, value: noticeValue } = noticeLimits;
      if (noticeSaved && (noticeValue.staleDays !== noticeSaved.staleDays || noticeValue.expiryDays !== noticeSaved.expiryDays)) {
          try {
              await noticeSettingsApi.save(noticeValue);
              setNoticeLimits((prev) => ({ ...prev, saved: prev.value, error: null }));
          } catch (e: any) {
              toast.error(e?.message || 'No se pudieron guardar los avisos.', { id: toastId });
              setIsSavingConfig(false);
              return;
          }
      }

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

  // Cambios sin guardar por rol: se guarda la versión anterior al primer cambio, para poder
  // descartarlos y para avisar en la lista. Guardar o descartar la quita.
  const [roleOriginals, setRoleOriginals] = useState<Record<string, RoleConfig>>({});
  const rememberRoleOriginal = (roleName: string) => {
      const original = roles.find(r => r.role === roleName);
      if (!original) return;
      setRoleOriginals(prev => (prev[roleName] ? prev : { ...prev, [roleName]: original }));
  };
  const forgetRoleOriginal = (roleName: string) => {
      setRoleOriginals(prev => {
          if (!prev[roleName]) return prev;
          const next = { ...prev };
          delete next[roleName];
          return next;
      });
  };
  const discardRoleChanges = (roleName: string) => {
      const original = roleOriginals[roleName];
      if (original) setRoles(prev => prev.map(r => (r.role === roleName ? original : r)));
      forgetRoleOriginal(roleName);
  };
  const handleRoleSectionChange = (roleName: string, modules: string[], isChecked: boolean) => {
      rememberRoleOriginal(roleName);
      setRoles(prevRoles => prevRoles.map(r => {
          if (r.role !== roleName) return r;
          const rest = r.allowedModules.filter(m => !modules.includes(m));
          return { ...r, allowedModules: (isChecked ? [...rest, ...modules] : rest) as any[] };
      }));
  };

  const handleRoleModuleChange = (roleName: string, module: string, isChecked: boolean) => {
      rememberRoleOriginal(roleName);
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

  // Encender o apagar una acción (o todas las de un módulo, con `action` nulo).
  const handleRoleActionChange = (roleName: string, module: string, action: string | null, allowed: boolean) => {
      rememberRoleOriginal(roleName);
      setRoles(prevRoles => prevRoles.map(r => {
          if (r.role !== roleName) return r;
          const deniedActions = action === null
              ? setAllActionsAllowed(r.deniedActions, module, allowed)
              : setActionAllowed(r.deniedActions, module, action, allowed);
          return { ...r, deniedActions };
      }));
  };

  const handleRoleMaxUrlsChange = (roleName: string, maxUrlsStr: string) => {
      rememberRoleOriginal(roleName);
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
              forgetRoleOriginal(roleConfig.role);

              // Refresh roles to ensure sync. Los otros roles con cambios sin guardar
              // conservan esos cambios: antes la recarga los borraba sin avisar.
              const updatedRoles = await api.getRolesConfig();
              if (updatedRoles && updatedRoles.length > 0) {
                  setRoles(prev => updatedRoles.map(r => {
                      if (r.role === roleConfig.role || !roleOriginals[r.role]) return r;
                      return prev.find(p => p.role === r.role) || r;
                  }));
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
          // Antes decía «Rol actualizado (Modo Offline)», pero el cambio no llegaba a la base:
          // los permisos se guardan en Supabase o no se guardan.
          toast.error('No se pudo guardar el rol', {
              id: toastId,
              description: 'Revise su conexión e intente de nuevo. Los cambios siguen en pantalla.'
          });
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
    {/* Usuarios (rediseño 2026-10-04): sin el título grande, que repetía la cabecera, ni el
        recuadro alrededor de la lista; las demás pestañas conservan su marco por ahora. */}
    <div className={(activeTab === 'USERS' || activeTab === 'ROLES' || activeTab === 'PARAMS' || activeTab === 'CATALOGS' || activeTab === 'FACILITIES')
        ? "max-w-[1700px] mx-auto pb-24 pt-1 md:pb-6 md:pt-4 animate-in fade-in"
        : "max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in slide-in-from-bottom-4"}>
        {activeTab !== 'USERS' && activeTab !== 'ROLES' && activeTab !== 'PARAMS' && activeTab !== 'CATALOGS' && activeTab !== 'FACILITIES' && (
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">{headerInfo.title}</h2>
                <p className="text-gray-500 mt-2 text-sm font-medium">{headerInfo.description}</p>
            </div>
        </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* Premium Spacious Content Container */}
            <div className={(activeTab === 'USERS' || activeTab === 'ROLES' || activeTab === 'PARAMS' || activeTab === 'CATALOGS' || activeTab === 'FACILITIES')
                ? "flex-1 min-w-0 w-full"
                : "flex-1 bg-white rounded-2xl shadow-[0_5px_30px_rgba(0,0,0,0.018)] border border-gray-200/80 p-6 sm:p-8 overflow-hidden min-w-0 w-full animate-in fade-in duration-300"}>
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

                    const clearUserFilters = () => {
                        setFilterProfession('ALL');
                        setFilterRole('ALL');
                        setFilterStatus('ALL');
                        setFilterDiresa('ALL');
                        setFilterOgess('ALL');
                        setFilterUnget('ALL');
                        setFilterLaborRegime('ALL');
                        setFilterMicrored('ALL');
                    };

                    // Los mismos campos en el panel lateral (escritorio) y en el panel inferior (celular).
                    const userFilterFields = (
                        <>
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
                        </>
                    );

                    const inactiveUsersCount = usersMatchingFilters.length - activeUsersCount;
                    const kpiFiltered = usersMatchingFilters.length !== scopedUsers.length;
                    const initialsOf = (u: any) => {
                        const first = (u.personnel?.firstName || u.username || '?').trim();
                        const last = (u.personnel?.lastName || '').trim();
                        return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
                    };
                    const userHeadCells = [
                        { key: 'usuario', label: 'Usuario' },
                        { key: 'profesion', label: 'Profesión' },
                        { key: 'jurisdiccion', label: 'Jurisdicción' },
                        { key: 'rol', label: 'Rol' },
                        { key: 'estado', label: 'Estado' },
                        { key: 'telefono', label: 'Teléfono' },
                        { key: 'acciones', label: 'Acciones', align: 'right' as const },
                    ];
                    // Toda columna con datos ordena; «Acciones» no.
                    type UserSortKey = 'usuario' | 'profesion' | 'jurisdiccion' | 'rol' | 'estado' | 'telefono';
                    const userHeadContent = (c: { key: string; label: string }) => c.key === 'acciones'
                        ? c.label
                        : <SortButton label={c.label} dir={usersSortDir(c.key as UserSortKey)} onClick={() => toggleUsersSort(c.key as UserSortKey)} />;
                    const headTh = `px-4 py-3 ${tableHeadCellClass} ${tableHeadTextClass}`;
                    const rowIconButton = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors cursor-pointer';

                    return (
                        <div className="space-y-4 md:space-y-5">
                            {/* Indicadores: tocarlos filtra la lista por estado */}
                            <KpiStrip cols="md:grid-cols-3">
                                <KpiCard watermark label="Usuarios" value={usersMatchingFilters.length} hint={kpiFiltered ? `de ${scopedUsers.length} · con los filtros` : "en su jurisdicción"} icon={<Users />} tone="info" onClick={() => setFilterStatus('ALL')} active={filterStatus === 'ALL'} />
                                <KpiCard watermark label="Activos" value={activeUsersCount} hint="pueden ingresar" icon={<UserCheck />} tone="success" onClick={() => setFilterStatus('ACTIVE')} active={filterStatus === 'ACTIVE'} />
                                <KpiCard watermark label="Inactivos" value={inactiveUsersCount} hint="sin acceso" icon={<UserX />} tone="neutral" onClick={() => setFilterStatus('INACTIVE')} active={filterStatus === 'INACTIVE'} />
                            </KpiStrip>

                            {/* Barra: buscador, filtros y acciones (en el celular, fija arriba al bajar) */}
                            <div ref={searchBar.ref} style={searchBar.style} className={`${stickyBarClass} flex items-center gap-2 md:static`}>
                                <div className={tableSearchBoxClass}>
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por nombre, DNI o usuario…"
                                        className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-16 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 md:h-10"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                    />
                                    {searchTerm && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchTerm('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-extrabold text-teal-600 hover:bg-teal-100 hover:text-teal-800 cursor-pointer"
                                        >
                                            Borrar
                                        </button>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsFiltersSidebarOpen(true)}
                                    aria-label="Filtros"
                                    className={`relative flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition-colors cursor-pointer md:h-10 md:px-4 ${
                                        activeFiltersCount > 0 ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                >
                                    <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                                    <span className="hidden md:inline">Filtros</span>
                                    {activeFiltersCount > 0 && (
                                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-black text-white">
                                            {activeFiltersCount}
                                        </span>
                                    )}
                                </button>
                                <div className="ml-auto hidden items-center gap-2 md:flex">
                                    {canUsers.export && <button
                                        type="button"
                                        onClick={handleExportPersonnelExcel}
                                        className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
                                        title="Descargar registro de personal en Excel (.xlsx)"
                                    >
                                        <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                                        Exportar Excel
                                    </button>}
                                    <button
                                        type="button"
                                        onClick={handleRefreshUsers}
                                        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:text-teal-600 cursor-pointer"
                                        title="Actualizar lista desde el servidor"
                                        aria-label="Actualizar lista"
                                    >
                                        <RefreshCw className={`h-4 w-4 ${isRefreshingUsers ? 'animate-spin' : ''}`} />
                                    </button>
                                    {canUsers.create && <button
                                        type="button"
                                        onClick={handleAddUserClick}
                                        className="flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition-colors hover:bg-teal-700 cursor-pointer"
                                    >
                                        <UserPlus className="h-4 w-4" />
                                        Nuevo usuario
                                    </button>}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setUsersActionsOpen(true)}
                                    aria-label="Más acciones"
                                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 md:hidden"
                                >
                                    <MoreHorizontal className="h-5 w-5" />
                                </button>
                            </div>

                            {/* Active Filters inline indicator */}
                            {activeFiltersCount > 0 && (
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-100/70 bg-teal-50/40 px-4 py-2 text-xs font-semibold text-teal-800">
                                    <span>
                                        Filtros activos. Mostrando <strong>{filteredUsers.length}</strong> de <strong>{scopedUsers.length}</strong> usuarios.
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => { setSearchTerm(''); clearUserFilters(); }}
                                        className="shrink-0 text-xs font-black uppercase tracking-wide text-teal-700 underline hover:text-teal-950 cursor-pointer"
                                    >
                                        Limpiar todo
                                    </button>
                                </div>
                            )}

                            {/* Escritorio: filtros en el panel lateral derecho */}
                            {isFiltersSidebarOpen && isDesktop && createPortal(
                                <div className="fixed inset-0 z-[110000] flex justify-end pointer-events-none">
                                    <div
                                        className="absolute inset-0 bg-transparent pointer-events-auto cursor-pointer"
                                        onClick={() => setIsFiltersSidebarOpen(false)}
                                    />
                                    <div className="relative w-full max-w-sm sm:max-w-md bg-white h-full shadow-2xl border-l border-gray-200 pointer-events-auto animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden">
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
                                        <div className="flex-1 p-6 space-y-5 overflow-y-auto font-sans">
                                            {userFilterFields}
                                        </div>
                                        <div className="p-6 border-t border-gray-150 bg-gray-50 flex items-center justify-between sticky bottom-0 shrink-0">
                                            <button
                                                onClick={clearUserFilters}
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

                            {/* Celular: filtros en el panel inferior */}
                            <BottomSheet open={isFiltersSidebarOpen && !isDesktop} title="Filtros" onClose={() => setIsFiltersSidebarOpen(false)}>
                                <div className="space-y-4">
                                    {userFilterFields}
                                    <div className="flex gap-2 pt-2">
                                        <button type="button" onClick={clearUserFilters} className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold text-slate-700">
                                            Limpiar
                                        </button>
                                        <button type="button" onClick={() => setIsFiltersSidebarOpen(false)} className="h-11 flex-1 rounded-xl bg-teal-600 text-sm font-bold text-white">
                                            Ver {filteredUsers.length} {filteredUsers.length === 1 ? 'usuario' : 'usuarios'}
                                        </button>
                                    </div>
                                </div>
                            </BottomSheet>

                            {/* Celular: acciones de la barra («⋯») */}
                            <BottomSheet open={usersActionsOpen} title="Acciones" onClose={() => setUsersActionsOpen(false)}>
                                <div className="space-y-2">
                                    {canUsers.export && <button type="button" onClick={() => { setUsersActionsOpen(false); handleExportPersonnelExcel(); }} className="flex h-12 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700">
                                        <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Exportar Excel
                                    </button>}
                                    <button type="button" onClick={() => { setUsersActionsOpen(false); handleRefreshUsers(); }} className="flex h-12 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700">
                                        <RefreshCw className="h-4 w-4 text-slate-500" /> Actualizar lista
                                    </button>
                                </div>
                            </BottomSheet>

                            {canUsers.create && <FloatingActionButton icon={<UserPlus />} label="Nuevo usuario" onClick={handleAddUserClick} />}

                            {filteredUsers.length === 0 && !isRefreshingUsers && (
                                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm font-medium text-slate-400">
                                    No se encontraron usuarios que cumplan con los filtros seleccionados o nivel de acceso.
                                </div>
                            )}

                            {/* Escritorio: una sola tabla, encabezado que se queda arriba al bajar y paginación */}
                            {isDesktop && filteredUsers.length > 0 && (
                                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                    <FloatingTableHead state={usersFloatingHead} padding="px-4" cells={userHeadCells.map((c, index) => ({ key: c.key, index, content: userHeadContent(c), align: c.align }))} />
                                    <div className="overflow-x-auto scrollbar-x">
                                        <table ref={usersTableRef} className="w-full min-w-[960px]">
                                            <thead>
                                                <tr>
                                                    {userHeadCells.map(c => (
                                                        <th key={c.key} aria-sort={c.key === 'acciones' ? undefined : ariaSort(usersSortDir(c.key as UserSortKey))} className={`${headTh} ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{userHeadContent(c)}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {pageUsers.map((u: any) => {
                                                    const active = isUserActiveValue(u);
                                                    const name = u.personnel ? `${u.personnel.firstName} ${u.personnel.lastName}` : 'Sin datos de personal';
                                                    const professionName = u.personnel?.professionData?.name || professionMapLookup.get(u.personnel?.professionId)?.name || '';
                                                    const jurisdiction = jurisdictionOf(u);
                                                    return (
                                                        <tr key={u.username} onClick={() => setViewingUser(u)} className="h-[58px] cursor-pointer transition-colors hover:bg-slate-50">
                                                            <td className="px-4 py-2">
                                                                <div className="flex items-center gap-3">
                                                                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black ${active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>{initialsOf(u)}</span>
                                                                    <div className="min-w-0">
                                                                        <p className="truncate text-[13.5px] font-bold text-slate-900" title={name}>{name}</p>
                                                                        <p className="whitespace-nowrap text-xs text-slate-500">{u.username}{u.personnel?.dni ? ` · DNI ${u.personnel.dni}` : ''}</p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2 text-[13px] text-slate-700">{professionName || <span className="text-slate-300">—</span>}</td>
                                                            <td className="px-4 py-2 text-[13px] text-slate-700">{jurisdiction !== '-' ? jurisdiction : <span className="text-slate-300">—</span>}</td>
                                                            <td className="px-4 py-2 text-[13px] font-semibold text-slate-800">{roleLabelOf(u)}</td>
                                                            <td className="px-4 py-2"><StatusChip label={active ? 'Activo' : 'Inactivo'} tone={active ? 'success' : 'neutral'} /></td>
                                                            <td className="whitespace-nowrap px-4 py-2 text-[13px] text-slate-600">{u.personnel?.phone || <span className="text-slate-300">—</span>}</td>
                                                            <td className="px-4 py-2">
                                                                <div className="flex justify-end gap-1.5">
                                                                    {canAssignRoleKey(u.role) && (<>
                                                                        {canUsers.edit && <button
                                                                            type="button"
                                                                            onClick={(e) => { e.stopPropagation(); handleEditUserClick(u); }}
                                                                            className={`${rowIconButton} hover:border-teal-200 hover:bg-teal-50 hover:text-teal-600`}
                                                                            title="Editar"
                                                                            aria-label={`Editar a ${name}`}
                                                                        >
                                                                            <Edit className="h-4 w-4" />
                                                                        </button>}
                                                                        {canUsers.toggle && <button
                                                                            type="button"
                                                                            onClick={(e) => { e.stopPropagation(); handleToggleStatus(u.username, u.isActive); }}
                                                                            className={`${rowIconButton} ${active ? 'hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600' : 'hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600'}`}
                                                                            title={active ? 'Desactivar' : 'Activar'}
                                                                            aria-label={`${active ? 'Desactivar' : 'Activar'} a ${name}`}
                                                                        >
                                                                            <Power className="h-4 w-4" />
                                                                        </button>}
                                                                    </>)}
                                                                    {isSuperAdmin && canUsers.delete && currentUser?.username !== u.username && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => { e.stopPropagation(); setUserToDelete({ username: u.username, personnelId: u.personnelId || null }); }}
                                                                            className={`${rowIconButton} text-slate-400 hover:border-red-200 hover:bg-rose-50 hover:text-red-600`}
                                                                            title="Eliminar permanentemente"
                                                                            aria-label={`Eliminar a ${name}`}
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
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
                                    <TablePagination page={usersPage} pageSize={USERS_PAGE_SIZE} total={filteredUsers.length} onPageChange={setUsersPage} itemLabel="usuarios" />
                                </div>
                            )}

                            {/* Celular: tarjetas que cargan al bajar */}
                            {!isDesktop && filteredUsers.length > 0 && (
                                <div className="space-y-2.5">
                                    {filteredUsers.slice(0, mobileUsers.count).map((u: any) => {
                                        const active = isUserActiveValue(u);
                                        const name = u.personnel ? `${u.personnel.firstName} ${u.personnel.lastName}` : 'Sin datos de personal';
                                        const professionName = u.personnel?.professionData?.name || professionMapLookup.get(u.personnel?.professionId)?.name || '';
                                        const jurisdiction = jurisdictionOf(u);
                                        const canManage = canAssignRoleKey(u.role);
                                        const canEditRow = canManage && canUsers.edit;
                                        const canToggleRow = canManage && canUsers.toggle;
                                        const canEdit = canEditRow || canToggleRow;
                                        const canDelete = isSuperAdmin && canUsers.delete && currentUser?.username !== u.username;
                                        const menuOpen = userMenuFor === u.username;
                                        return (
                                            <div key={u.username} onClick={() => setViewingUser(u)} className="relative cursor-pointer rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm active:bg-slate-50">
                                                <div className="flex items-start gap-3">
                                                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black ${active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>{initialsOf(u)}</span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <p className="min-w-0 truncate text-[15px] font-bold text-slate-900">{name}</p>
                                                            {(canEdit || canDelete) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); setUserMenuFor(menuOpen ? null : u.username); }}
                                                                    aria-label={`Acciones de ${name}`}
                                                                    aria-expanded={menuOpen}
                                                                    className="-mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 active:bg-slate-100"
                                                                >
                                                                    <MoreVertical className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        {professionName && <p className="text-[13px] text-slate-500">{professionName}</p>}
                                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                            <StatusChip label={active ? 'Activo' : 'Inactivo'} tone={active ? 'success' : 'neutral'} />
                                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">{roleLabelOf(u)}</span>
                                                        </div>
                                                        {(jurisdiction !== '-' || u.personnel?.phone) && (
                                                            <div className="mt-2 flex items-center gap-3 text-[13px] text-slate-600">
                                                                {jurisdiction !== '-' && (
                                                                    <span className="flex min-w-0 items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{jurisdiction}</span></span>
                                                                )}
                                                                {u.personnel?.phone && (
                                                                    <span className="flex shrink-0 items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{u.personnel.phone}</span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {menuOpen && (
                                                    <div onClick={(e) => e.stopPropagation()} className="absolute right-3 top-12 z-20 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                                                        {canEditRow && (
                                                            <button type="button" onClick={() => { setUserMenuFor(null); handleEditUserClick(u); }} className="flex h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-slate-700 active:bg-slate-50">
                                                                <Edit className="h-4 w-4 text-slate-400" /> Editar
                                                            </button>
                                                        )}
                                                        {canToggleRow && (
                                                            <button type="button" onClick={() => { setUserMenuFor(null); handleToggleStatus(u.username, u.isActive); }} className="flex h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-slate-700 active:bg-slate-50">
                                                                <Power className="h-4 w-4 text-slate-400" /> {active ? 'Desactivar' : 'Activar'}
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button type="button" onClick={() => { setUserMenuFor(null); setUserToDelete({ username: u.username, personnelId: u.personnelId || null }); }} className={`flex h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-red-600 active:bg-rose-50 ${canEdit ? 'border-t border-slate-100' : ''}`}>
                                                                <Trash2 className="h-4 w-4" /> Eliminar
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <LoadMoreSentinel hasMore={mobileUsers.hasMore} onLoadMore={mobileUsers.loadMore} shown={mobileUsers.count} total={filteredUsers.length} itemLabel="usuarios" />
                                </div>
                            )}
                        </div>
                    );
                })()}

                {activeTab === 'ROLES' && (() => {
                    const LEVEL_LABELS: Record<string, string> = { GLOBAL: 'Nacional', DIRESA: 'DIRESA', OGESS: 'OGESS', UNGET: 'UNGET', MICRORED: 'Microred', IPRESS: 'Establecimiento' };
                    const usersByRole = new Map<string, number>();
                    scopedUsers.forEach(u => usersByRole.set(u.role, (usersByRole.get(u.role) || 0) + 1));
                    const countLabel = (n: number) => `${n} ${n === 1 ? 'usuario' : 'usuarios'}`;
                    const allNavModules = NAV_SECTIONS.flatMap(sec => sec.items.map(it => it.module as string));
                    const currentRole = roles.find(r => r.role === selectedRoleId) || null;
                    const showList = isDesktop || !roleDetailOpen;
                    const showDetail = isDesktop || roleDetailOpen;
                    const openNewRole = () => {
                        setNewRoleForm({ role: '', label: '', maxUrlsAllowed: '', allowedModules: [], jurisdictionLevel: '' });
                        setIsNewRoleModalOpen(true);
                    };

                    const roleList = (
                        <div className={isDesktop ? 'w-[320px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm' : 'space-y-2.5'}>
                            {isDesktop && (
                                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                                    <p className="text-sm font-black text-slate-900">Roles <span className="font-semibold text-slate-400">· {roles.length}</span></p>
                                    {canRoles.create && <button type="button" onClick={openNewRole} className="flex h-9 items-center gap-1.5 rounded-xl bg-teal-600 px-3 text-[13px] font-bold text-white transition-colors hover:bg-teal-700 cursor-pointer">
                                        <Plus className="h-4 w-4" /> Nuevo rol
                                    </button>}
                                </div>
                            )}
                            {isRolesLoading ? (
                                <div className="flex justify-center p-8 text-teal-600"><RefreshCw className="h-6 w-6 animate-spin" /></div>
                            ) : roles.length === 0 ? (
                                <div className="rounded-2xl p-8 text-center text-sm text-slate-500">No hay roles configurados.</div>
                            ) : (
                                <div className={isDesktop ? 'divide-y divide-slate-100' : 'space-y-2.5'}>
                                    {roles.map(role => {
                                        const selected = isDesktop && selectedRoleId === role.role;
                                        const level = LEVEL_LABELS[role.jurisdictionLevel || ''];
                                        const unsaved = Boolean(roleOriginals[role.role]);
                                        return (
                                            <button
                                                key={role.role}
                                                type="button"
                                                onClick={() => { setSelectedRoleId(role.role); setRoleDetailOpen(true); }}
                                                aria-current={selected ? 'true' : undefined}
                                                className={isDesktop
                                                    ? `relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selected ? 'bg-teal-50' : 'hover:bg-slate-50'}`
                                                    : 'flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm active:bg-slate-50'}
                                            >
                                                {selected && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-teal-500" />}
                                                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${selected ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700'}`}>
                                                    <Shield className="h-5 w-5" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-[14px] font-bold text-slate-900">{role.label || role.role}</span>
                                                    <span className="mt-0.5 block text-xs text-slate-500">
                                                        {level ? `Nivel ${level} · ` : ''}{countLabel(usersByRole.get(role.role) || 0)}
                                                    </span>
                                                    {unsaved && <span className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Cambios sin guardar</span>}
                                                </span>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );

                    const roleDetail = currentRole ? (() => {
                        const enabled = new Set(currentRole.allowedModules as string[]);
                        const enabledCount = allNavModules.filter(m => enabled.has(m)).length;
                        const level = LEVEL_LABELS[currentRole.jurisdictionLevel || ''];
                        const unsaved = Boolean(roleOriginals[currentRole.role]);
                        return (
                            <div className={isDesktop ? 'flex min-w-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm' : 'space-y-3'}>
                                <div className={isDesktop ? 'border-b border-slate-100 p-5' : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            {isDesktop && <h3 className="text-lg font-black text-slate-900">{currentRole.label || currentRole.role}</h3>}
                                            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${isDesktop ? 'mt-1.5' : ''}`}>
                                                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600">{currentRole.role}</span>
                                                {level && <span className="inline-flex items-center gap-1 text-[13px] text-slate-600"><MapPin className="h-3.5 w-3.5 text-slate-400" />Nivel <b className="text-slate-800">{level}</b></span>}
                                                <span className="inline-flex items-center gap-1 text-[13px] text-slate-600"><Users className="h-3.5 w-3.5 text-slate-400" /><b className="text-slate-800">{usersByRole.get(currentRole.role) || 0}</b> {(usersByRole.get(currentRole.role) || 0) === 1 ? 'usuario' : 'usuarios'}</span>
                                            </div>
                                        </div>
                                        {canRoles.edit && <button type="button" onClick={() => handleOpenEditRole(currentRole)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer">
                                            <Edit className="h-4 w-4 text-slate-500" /> {isDesktop ? 'Editar nombre y nivel' : 'Editar'}
                                        </button>}
                                    </div>
                                </div>

                                <div className={isDesktop ? 'space-y-5 p-5' : 'space-y-3'}>
                                    <p className={`text-[11px] font-black uppercase tracking-widest text-slate-400 ${isDesktop ? '' : 'px-1 pt-1'}`}>Módulos que puede abrir · {enabledCount} de {allNavModules.length}</p>
                                    {renderModuleGroups(
                                        enabled,
                                        (module, on) => handleRoleModuleChange(currentRole.role, module, on),
                                        (modules, on) => handleRoleSectionChange(currentRole.role, modules, on),
                                        isDesktop,
                                        {
                                            denied: currentRole.deniedActions || [],
                                            onAction: (module, action, allowed) => handleRoleActionChange(currentRole.role, module, action, allowed),
                                            locked: currentRole.role === 'ADMIN',
                                            readOnly: !can('ADMIN_ROLES', 'permissions'),
                                        }
                                    )}

                                    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${isDesktop ? 'max-w-md' : ''}`}>
                                        <label htmlFor="role-max-urls" className="block text-[13.5px] font-bold text-slate-900">Conexiones de Consulta Stock</label>
                                        <p className="mt-0.5 text-xs text-slate-500">Cuántas hojas de Google puede conectar este rol. Vacío = sin límite.</p>
                                        <input
                                            id="role-max-urls"
                                            type="number"
                                            min="1"
                                            placeholder="Sin límite"
                                            value={currentRole.maxUrlsAllowed || ''}
                                            onChange={(e) => handleRoleMaxUrlsChange(currentRole.role, e.target.value)}
                                            className="mt-3 h-11 w-32 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                        />
                                    </div>
                                </div>

                                {/* Barra de guardado, solo con cambios pendientes: va en el pie de la app,
                                    pegada abajo y fuera del área que se desplaza, así no tapa nada. */}
                                {unsaved && (
                                    <ModuleFooterPortal>
                                    <div className="border-t border-slate-200 bg-white">
                                    <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-2.5 sm:px-5 md:gap-3 2xl:px-6">
                                        <span className="flex items-center gap-2 text-[13px] font-semibold text-amber-700">
                                            <span className="h-2 w-2 rounded-full bg-amber-500" />{isDesktop ? 'Cambios sin guardar' : 'Sin guardar'}
                                        </span>
                                        <button type="button" onClick={() => discardRoleChanges(currentRole.role)} className="ml-auto h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer">
                                            Descartar
                                        </button>
                                        <button type="button" onClick={() => handleSaveRoleConfig(currentRole)} className="flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition-colors hover:bg-teal-700 cursor-pointer">
                                            <Save className="h-4 w-4" /> Guardar
                                        </button>
                                    </div>
                                    </div>
                                    </ModuleFooterPortal>
                                )}
                            </div>
                        );
                    })() : (
                        <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                            <Shield className="mb-4 h-12 w-12 text-slate-200" />
                            <p className="text-base font-medium text-slate-500">Seleccione un rol de la lista</p>
                        </div>
                    );

                    return (
                        <div className={isDesktop ? 'flex items-start gap-5' : ''}>
                            {showList && roleList}
                            {showDetail && roleDetail}
                            {!isDesktop && !roleDetailOpen && canRoles.create && <FloatingActionButton icon={<Plus />} label="Nuevo rol" onClick={openNewRole} />}
                        </div>
                    );
                })()}

                {activeTab === 'PARAMS' && (() => {
                    // Qué cambió respecto de lo guardado: marca cada parámetro y cuenta para la barra.
                    const text = (v?: string) => (v || '').trim();
                    const changed = {
                        delay: Number(tempConfig.verificationDelaySeconds) !== Number(systemConfig.verificationDelaySeconds),
                        warehouseCode: text(tempConfig.warehouseCode) !== text(systemConfig.warehouseCode),
                        warehouseName: text(tempConfig.warehouseName) !== text(systemConfig.warehouseName),
                        maintenance: !!tempConfig.maintenanceMode !== !!systemConfig.maintenanceMode,
                        allowedUsers: text(tempConfig.maintenanceAllowedUsers) !== text(systemConfig.maintenanceAllowedUsers),
                        message: text(tempConfig.maintenanceMessage) !== text(systemConfig.maintenanceMessage),
                        backups: backupLimit.saved != null && backupLimit.value !== backupLimit.saved,
                        staleDays: !!noticeLimits.saved && noticeLimits.value.staleDays !== noticeLimits.saved.staleDays,
                        expiryDays: !!noticeLimits.saved && noticeLimits.value.expiryDays !== noticeLimits.saved.expiryDays,
                    };
                    const changeCount = Object.values(changed).filter(Boolean).length;
                    const discardParams = () => {
                        setTempConfig(systemConfig);
                        setBackupLimit(prev => ({ ...prev, value: prev.saved ?? prev.value }));
                        setNoticeLimits(prev => ({ ...prev, value: prev.saved ?? prev.value }));
                    };
                    const turningOnMaintenance = !!tempConfig.maintenanceMode && !systemConfig.maintenanceMode;
                    const textareaClass = 'h-24 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100';

                    return (
                        <div className="mx-auto max-w-4xl space-y-4 md:space-y-5">
                            <SettingsSection icon={<BarChart2 />} iconClass="bg-teal-50 text-teal-700" title="Análisis de Requerimiento" subtitle="Revisión de cada ítem">
                                <SettingsRow label="Espera antes de «Validar»" htmlFor="param-delay" changed={changed.delay} help="Segundos que el detalle de un ítem bloquea el botón «Validar», para que se lea antes de aprobar. 0 = sin espera.">
                                    <div className="flex items-center gap-2.5">
                                        <input
                                            id="param-delay"
                                            type="number"
                                            min="0"
                                            max="60"
                                            value={tempConfig.verificationDelaySeconds}
                                            onChange={(e) => setTempConfig({ ...tempConfig, verificationDelaySeconds: Number(e.target.value) })}
                                            className={settingsNumberClass}
                                        />
                                        <span className="text-[13px] text-slate-500">segundos (0 a 60)</span>
                                    </div>
                                </SettingsRow>
                            </SettingsSection>

                            <SettingsSection icon={<ArrowRightLeft />} iconClass="bg-teal-50 text-teal-700" title="Redistribución" subtitle="Almacén que aparece como origen o destino">
                                <SettingsRow label="Código del almacén general" htmlFor="param-wh-code" changed={changed.warehouseCode} help="Se agrega a la lista de establecimientos de Redistribución.">
                                    <input
                                        id="param-wh-code"
                                        type="text"
                                        value={tempConfig.warehouseCode || ''}
                                        onChange={(e) => setTempConfig({ ...tempConfig, warehouseCode: e.target.value })}
                                        placeholder="Ej.: ALM-001"
                                        className={`${inputClass} font-mono md:w-48`}
                                    />
                                </SettingsRow>
                                <SettingsRow label="Nombre del almacén" htmlFor="param-wh-name" changed={changed.warehouseName} help="Cómo se muestra en Redistribución.">
                                    <input
                                        id="param-wh-name"
                                        type="text"
                                        value={tempConfig.warehouseName || ''}
                                        onChange={(e) => setTempConfig({ ...tempConfig, warehouseName: e.target.value })}
                                        placeholder="Ej.: Almacén General de Medicamentos"
                                        className={`${inputClass} md:w-72`}
                                    />
                                </SettingsRow>
                            </SettingsSection>

                            {currentUser?.role === 'ADMIN' && (
                                <NoticeSettingsCard
                                    value={noticeLimits.value}
                                    saved={noticeLimits.saved}
                                    disabled={noticeLimits.saved == null}
                                    error={noticeLimits.error}
                                    onChange={(value) => setNoticeLimits((prev) => ({ ...prev, value }))}
                                />
                            )}

                            {currentUser?.role === 'ADMIN' && (
                                <SettingsSection icon={<HardDriveDownload />} iconClass="bg-violet-50 text-violet-700" title="Backups SISMED" subtitle="Solo lo ve el administrador">
                                    <SettingsRow label="Descargas por día" htmlFor="param-backups" changed={changed.backups} help="Cuántos backups puede descargar cada usuario de un mismo establecimiento en un día (hora de Perú). Cada usuario tiene su propio cupo, también el administrador. Un pedido que falla o vence sin descargarse no cuenta.">
                                        <div className="flex items-center gap-2.5">
                                            <input
                                                id="param-backups"
                                                type="number"
                                                min="1"
                                                max="20"
                                                value={backupLimit.value}
                                                disabled={backupLimit.saved == null}
                                                onChange={(e) => setBackupLimit({ ...backupLimit, value: Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                                                className={settingsNumberClass}
                                            />
                                            <span className="text-[13px] text-slate-500">por día (1 a 20)</span>
                                        </div>
                                    </SettingsRow>
                                    {backupLimit.error && <p className="px-4 py-3 text-xs text-amber-700 md:px-5">{backupLimit.error}</p>}
                                </SettingsSection>
                            )}

                            <SettingsSection warning icon={<Wrench />} iconClass="bg-amber-50 text-amber-700" title="Modo mantenimiento" subtitle="Cierra la aplicación mientras se trabaja en ella">
                                {turningOnMaintenance && (
                                    <div className="flex gap-2 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800 md:px-5">
                                        <AlertTriangle className="h-4 w-4 shrink-0" />
                                        Al guardar, la aplicación se cerrará para todos menos los administradores y los usuarios autorizados.
                                    </div>
                                )}
                                <SettingsRow
                                    label="Activar mantenimiento"
                                    changed={changed.maintenance}
                                    help={tempConfig.maintenanceMode ? 'La aplicación queda cerrada para quien no esté autorizado. Los administradores entran siempre.' : 'La aplicación está abierta con normalidad.'}
                                >
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={!!tempConfig.maintenanceMode}
                                        aria-label="Activar mantenimiento"
                                        disabled={!canParams.maintenance}
                                        title={canParams.maintenance ? undefined : 'Su rol no puede cambiar el modo mantenimiento'}
                                        onClick={() => setTempConfig({ ...tempConfig, maintenanceMode: !tempConfig.maintenanceMode })}
                                        className={`relative block h-7 w-12 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${canParams.maintenance ? 'cursor-pointer' : ''} ${tempConfig.maintenanceMode ? 'bg-amber-500' : 'bg-slate-200'}`}
                                    >
                                        <span className={`absolute top-0.5 grid h-6 w-6 place-items-center rounded-full bg-white shadow transition-all ${tempConfig.maintenanceMode ? 'left-[22px]' : 'left-0.5'}`}>
                                            {tempConfig.maintenanceMode && <Check className="h-3.5 w-3.5 text-amber-600" />}
                                        </span>
                                    </button>
                                </SettingsRow>
                                <div className="grid gap-4 px-4 py-4 md:grid-cols-2 md:px-5">
                                    <FormField label="Usuarios autorizados para pruebas" hint="Separados por comas o uno por línea.">
                                        <textarea
                                            value={tempConfig.maintenanceAllowedUsers || ''}
                                            onChange={(e) => setTempConfig({ ...tempConfig, maintenanceAllowedUsers: e.target.value })}
                                            placeholder="bellavista, picota"
                                            className={`${textareaClass} font-mono`}
                                        />
                                    </FormField>
                                    <FormField label="Mensaje que verán" hint="Si lo deja vacío se muestra un mensaje por omisión.">
                                        <textarea
                                            value={tempConfig.maintenanceMessage || ''}
                                            onChange={(e) => setTempConfig({ ...tempConfig, maintenanceMessage: e.target.value })}
                                            placeholder="Estamos trabajando en el sistema. Volveremos a habilitarlo en cuanto termine el mantenimiento."
                                            className={textareaClass}
                                        />
                                    </FormField>
                                </div>
                            </SettingsSection>

                            {/* Barra de guardado en el pie de la app, solo con cambios pendientes */}
                            {changeCount > 0 && (
                                <ModuleFooterPortal>
                                    <div className="border-t border-slate-200 bg-white">
                                        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-2.5 sm:px-5 md:gap-3 2xl:px-6">
                                            <span className="flex items-center gap-2 text-[13px] font-semibold text-amber-700">
                                                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                                                {changeCount === 1 ? '1 cambio sin guardar' : `${changeCount} cambios sin guardar`}
                                            </span>
                                            <button type="button" onClick={discardParams} disabled={isSavingConfig} className="ml-auto h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
                                                Descartar
                                            </button>
                                            {canParams.save ? (
                                                <button type="button" onClick={handleSaveConfig} disabled={isSavingConfig} className="flex h-10 items-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-60 cursor-pointer">
                                                    <Save className="h-4 w-4" /> {isSavingConfig ? 'Guardando…' : 'Guardar'}
                                                </button>
                                            ) : (
                                                <span className="text-[12px] font-semibold text-slate-500">Su rol no puede guardar parámetros</span>
                                            )}
                                        </div>
                                    </div>
                                </ModuleFooterPortal>
                            )}
                        </div>
                    );
                })()}
                {activeTab === 'FACILITIES' && (
                     <AdminOrganizationModule />
                )}
                {activeTab === 'CATALOGS' && (
                     <AdminCatalogsModule onChanged={refreshCatalogs} users={scopedUsers} />
                )}
            </div>
        </div>
    </div>

    {/* --- CUSTOM CONFIRMATION MODAL --- */}
    {/* --- ACTIVAR / DESACTIVAR Y ELIMINAR: confirmaciones (panel inferior en el celular) --- */}
    {(() => {
        const nameOf = (username?: string) => {
            const target = users.find(x => x.username === username);
            return target?.personnel ? `${target.personnel.firstName} ${target.personnel.lastName}` : `@${username}`;
        };
        return (
            <>
                <ConfirmationDialog
                    isOpen={!!userToToggle}
                    tone="warning"
                    icon={<Power />}
                    title={userToToggle?.currentStatus ? `¿Desactivar a ${nameOf(userToToggle?.username)}?` : `¿Activar a ${nameOf(userToToggle?.username)}?`}
                    description={userToToggle?.currentStatus
                        ? 'No podrá ingresar al sistema hasta que lo vuelva a activar. Sus datos se conservan.'
                        : 'Podrá volver a ingresar al sistema con su usuario y contraseña.'}
                    confirmLabel={userToToggle?.currentStatus ? 'Desactivar' : 'Activar'}
                    onConfirm={executeToggleStatus}
                    onCancel={() => setUserToToggle(null)}
                />
                <ConfirmationDialog
                    isOpen={!!userToDelete}
                    tone="danger"
                    icon={<Trash2 />}
                    isConfirming={isDeletingUser}
                    title={`¿Eliminar a ${nameOf(userToDelete?.username)}?`}
                    description={`Se borran su cuenta (@${userToDelete?.username || ''}) y su ficha de personal. No se puede deshacer.`}
                    confirmLabel="Eliminar definitivamente"
                    onConfirm={executeDeleteUser}
                    onCancel={() => setUserToDelete(null)}
                >
                    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>Si solo quiere quitarle el acceso, use «Desactivar».</span>
                    </div>
                </ConfirmationDialog>
            </>
        );
    })()}

    {/* --- NUEVO / EDITAR USUARIO: asistente de 3 pasos (pantalla completa en el celular) --- */}
    {(() => {
        const STEP_LABELS = ['Datos personales', 'Cuenta y rol', 'Jurisdicción'];
        const selectedRole = roles.find(r => r.role === userForm.role);
        const levelName: Record<string, string> = { GLOBAL: 'nacional', DIRESA: 'DIRESA', OGESS: 'OGESS', UNGET: 'UNGET', MICRORED: 'Microred', IPRESS: 'Establecimiento' };
        const nextStepHint = userModalLevel === 'GLOBAL'
            ? 'Nivel nacional: no necesita elegir jurisdicción.'
            : userModalLevel
                ? `Nivel ${levelName[userModalLevel]}: en el siguiente paso elige su ${userModalLevel === 'IPRESS' ? 'establecimiento' : levelName[userModalLevel]}.`
                : '';
        const hierarchyPath = [resolvedHierarchy.diresa, resolvedHierarchy.ogess, resolvedHierarchy.unget, resolvedHierarchy.microred, resolvedHierarchy.ipress].filter(Boolean).join(' › ');
        const fullName = `${userForm.firstName} ${userForm.lastName}`.trim();
        return (
            <ResponsiveDialog
                open={isUserModalOpen}
                onClose={() => setIsUserModalOpen(false)}
                onSubmit={handleSaveUser}
                busy={isSavingUser}
                size="lg"
                title={editingUser ? 'Editar usuario' : 'Nuevo usuario'}
                subtitle={editingUser ? fullName : undefined}
                top={
                    <div className="shrink-0 border-b border-slate-100 bg-white px-4 pb-3 pt-2.5 md:px-6">
                        <p className="text-[12.5px] font-black text-teal-700">Paso {userModalStep} de 3 · {STEP_LABELS[userModalStep - 1]}</p>
                        <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
                            {[1, 2, 3].map(n => <span key={n} className={`h-1.5 rounded-full transition-colors ${n <= userModalStep ? 'bg-teal-600' : 'bg-slate-200'}`} />)}
                        </div>
                    </div>
                }
                footer={
                    <>
                        {userModalStep > 1 ? (
                            <button type="button" onClick={() => setUserModalStep(step => step - 1)} className={`${dialogSecondaryButton} flex items-center gap-1.5`}>
                                <ArrowLeft className="h-4 w-4" /> Atrás
                            </button>
                        ) : (
                            <button type="button" onClick={() => setIsUserModalOpen(false)} className={dialogSecondaryButton}>
                                Cancelar
                            </button>
                        )}
                        {userModalStep === 1 && (
                            <button type="button" onClick={() => setUserModalStep(2)} disabled={!isStep1Valid} className={dialogPrimaryButton}>Siguiente</button>
                        )}
                        {userModalStep === 2 && (
                            <button type="button" onClick={() => setUserModalStep(3)} disabled={!isStep2Valid} className={dialogPrimaryButton}>Siguiente</button>
                        )}
                        {userModalStep === 3 && (
                            <button type="submit" disabled={isSavingUser || !isStep3Valid} className={dialogPrimaryButton}>
                                <Save className="h-4 w-4" />
                                {isSavingUser ? 'Guardando…' : 'Guardar'}
                            </button>
                        )}
                    </>
                }
            >
                {userModalStep === 1 && (
                    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
                        <FormField label="Nombres" required>
                            <input type="text" required className={inputClass} value={userForm.firstName} onChange={e => setUserForm({ ...userForm, firstName: e.target.value })} placeholder="Nombres completos" />
                        </FormField>
                        <FormField label="Apellidos" required>
                            <input type="text" required className={inputClass} value={userForm.lastName} onChange={e => setUserForm({ ...userForm, lastName: e.target.value })} placeholder="Apellidos" />
                        </FormField>
                        <FormField label="DNI" required>
                            <input type="text" required maxLength={8} inputMode="numeric" className={inputClass} value={userForm.dni} onChange={e => setUserForm({ ...userForm, dni: e.target.value })} placeholder="8 dígitos" />
                        </FormField>
                        <FormField label="Celular">
                            <input type="tel" className={inputClass} value={userForm.phone} onChange={e => setUserForm({ ...userForm, phone: e.target.value })} placeholder="Ej. 987654321" />
                        </FormField>
                        <FormField label="Correo electrónico">
                            <input type="email" className={inputClass} value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} placeholder="correo@ejemplo.com" />
                        </FormField>
                        <div>
                            <span className="mb-1.5 block text-xs font-black text-slate-700">Profesión</span>
                            <CustomSelect
                                className="h-11 text-sm"
                                value={userForm.professionId || ''}
                                onChange={val => setUserForm({ ...userForm, professionId: val })}
                                placeholder="Seleccionar profesión"
                                options={[
                                    { value: '', label: 'Seleccionar profesión' },
                                    ...professions.map(p => ({ value: p.id, label: p.name }))
                                ]}
                            />
                        </div>
                        <div>
                            <span className="mb-1.5 block text-xs font-black text-slate-700">Régimen laboral</span>
                            <CustomSelect
                                className="h-11 text-sm"
                                value={userForm.laborRegimeId || ''}
                                onChange={rId => {
                                    const matched = laborRegimes.find(r => r.id === rId);
                                    setUserForm({ ...userForm, laborRegimeId: rId, laborRegime: matched ? matched.name : '' });
                                }}
                                placeholder="Seleccionar régimen"
                                options={[
                                    { value: '', label: 'Seleccionar régimen' },
                                    ...laborRegimes.map(r => ({ value: r.id, label: r.name }))
                                ]}
                            />
                        </div>
                    </div>
                )}

                {userModalStep === 2 && (
                    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
                        <FormField label="Usuario" required hint={editingUser ? 'El usuario no se puede cambiar.' : undefined}>
                            <input
                                type="text" required autoCapitalize="none" autoCorrect="off"
                                disabled={!!editingUser}
                                className={inputClass}
                                value={userForm.username}
                                onChange={e => setUserForm({ ...userForm, username: e.target.value })}
                                placeholder="Ej. jsmith"
                            />
                        </FormField>
                        <FormField label={editingUser ? 'Nueva contraseña' : 'Contraseña'} required={!editingUser}>
                            <input
                                type="password"
                                required={!editingUser}
                                autoComplete="new-password"
                                className={inputClass}
                                value={userForm.password}
                                placeholder={editingUser ? 'Dejar en blanco para no cambiarla' : 'Contraseña'}
                                onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                            />
                        </FormField>
                        <div className="md:col-span-2">
                            <span className="mb-1.5 block text-xs font-black text-slate-700">Rol <span className="text-red-500">*</span></span>
                            <CustomSelect
                                className="h-11 text-sm"
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
                                    .filter(r => canAssignRoleKey(r.role))
                                    .map(r => ({ value: r.role, label: r.label || r.role }))}
                            />
                            {nextStepHint && <span className="mt-1 block text-[11px] font-semibold text-slate-400">{nextStepHint}</span>}
                        </div>
                    </div>
                )}

                {userModalStep === 3 && (
                    <div className="space-y-3">
                        {userModalLevel === 'GLOBAL' && (
                            <div className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-[14px] text-blue-900">
                                <Shield className="h-5 w-5 shrink-0 text-blue-600" />
                                <span><b>Acceso nacional.</b> Este rol ve todas las DIRESA, OGESS, UNGET, microredes y establecimientos; no necesita elegir jurisdicción.</span>
                            </div>
                        )}
                        {userModalLevel && userModalLevel !== 'GLOBAL' && (
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    {userModalLevel === 'DIRESA' && (
                                        <div className="space-y-1">
                                            <label className="mb-1.5 block text-[13px] font-bold text-slate-700">DIRESA <span className="text-red-500">*</span></label>
                                            <CustomSelect
                                                className="h-11 text-sm"
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
                                            <label className="mb-1.5 block text-[13px] font-bold text-slate-700">OGESS <span className="text-red-500">*</span></label>
                                            <CustomSelect
                                                className="h-11 text-sm"
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
                                            <label className="mb-1.5 block text-[13px] font-bold text-slate-700">UNGET <span className="text-red-500">*</span></label>
                                            <CustomSelect
                                                className="h-11 text-sm"
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
                                            <label className="mb-1.5 block text-[13px] font-bold text-slate-700">Microred <span className="text-red-500">*</span></label>
                                            <CustomSelect
                                                className="h-11 text-sm"
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
                                            <label className="mb-1.5 block text-[13px] font-bold text-slate-700">Establecimiento <span className="text-red-500">*</span></label>
                                            <CustomSelect
                                                className="h-11 text-sm"
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
                                                        // A una farmacia de hospital no se le asignan usuarios: su personal usa el del hospital.
                                                        // Se sigue mostrando si ya era la del usuario editado, para no borrar su dato sin aviso.
                                                        if (isPharmacyType(f.type) && f.code !== userForm.facilityCode) return false;
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
                                <span className="mt-1 block text-[11px] font-semibold text-slate-400">Los niveles de arriba se completan solos.</span>
                            </div>
                        )}
                        {!userModalLevel && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[14px] text-amber-800">
                                El rol elegido no tiene nivel de jurisdicción. Configúrelo en Roles antes de continuar.
                            </div>
                        )}
                        <DialogSection title="Resumen">
                            <DialogRow label="Nombre">{fullName || '—'}</DialogRow>
                            <DialogRow label="Usuario · Rol">{userForm.username ? `@${userForm.username}` : '—'} · {selectedRole?.label || userForm.role || '—'}</DialogRow>
                            {userModalLevel !== 'GLOBAL' && <DialogRow label="Jurisdicción">{hierarchyPath || <span className="font-normal text-slate-400">Pendiente de elegir</span>}</DialogRow>}
                        </DialogSection>
                    </div>
                )}
            </ResponsiveDialog>
        );
    })()}

    {/* --- NUEVO ROL (pantalla completa en el celular) --- */}
    <ResponsiveDialog
        open={isNewRoleModalOpen}
        onClose={() => setIsNewRoleModalOpen(false)}
        onSubmit={handleCreateRole}
        busy={isSavingRole}
        size="lg"
        title="Nuevo rol"
        footer={
            <>
                <button type="button" onClick={() => setIsNewRoleModalOpen(false)} className={dialogSecondaryButton}>Cancelar</button>
                <button type="submit" disabled={isSavingRole || !newRoleForm.role} className={dialogPrimaryButton}>
                    <Save className="h-4 w-4" /> {isSavingRole ? 'Creando…' : 'Crear rol'}
                </button>
            </>
        }
    >
        <div className="mb-4 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
            <FormField label="Nombre">
                <input type="text" placeholder="Ej.: Personal auditor" className={inputClass} value={newRoleForm.label} onChange={e => setNewRoleForm({ ...newRoleForm, label: e.target.value })} />
            </FormField>
            <FormField label="Código" required hint="Único, sin espacios.">
                <input type="text" required placeholder="Ej.: AUDITOR" className={`${inputClass} font-mono uppercase`} value={newRoleForm.role} onChange={e => setNewRoleForm({ ...newRoleForm, role: e.target.value })} />
            </FormField>
            <div>
                <span className="mb-1.5 block text-xs font-black text-slate-700">Nivel de jurisdicción</span>
                <CustomSelect
                    className="h-11 text-sm"
                    value={newRoleForm.jurisdictionLevel || ''}
                    onChange={val => setNewRoleForm({ ...newRoleForm, jurisdictionLevel: val as any })}
                    options={[
                                    { value: '', label: 'Elegir nivel' },
                                    { value: 'GLOBAL', label: 'Nacional' },
                                    { value: 'DIRESA', label: 'DIRESA' },
                                    { value: 'OGESS', label: 'OGESS' },
                                    { value: 'UNGET', label: 'UNGET' },
                                    { value: 'MICRORED', label: 'Microred' },
                                    { value: 'IPRESS', label: 'Establecimiento' }
                                ]}
                />
            </div>
            <FormField label="Conexiones de Consulta Stock" hint="Vacío = sin límite.">
                <input type="number" min="1" placeholder="Sin límite" className={inputClass} value={newRoleForm.maxUrlsAllowed} onChange={e => setNewRoleForm({ ...newRoleForm, maxUrlsAllowed: e.target.value })} />
            </FormField>
        </div>
        <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-widest text-slate-400">Módulos que puede abrir</p>
        {renderModuleGroups(
            new Set(newRoleForm.allowedModules as string[]),
            (module, on) => setNewRoleForm(prev => ({
                ...prev,
                allowedModules: (on ? [...prev.allowedModules, module] : prev.allowedModules.filter(m => m !== module)) as any
            })),
            (modules, on) => setNewRoleForm(prev => {
                const rest = (prev.allowedModules as string[]).filter(m => !modules.includes(m));
                return { ...prev, allowedModules: (on ? [...rest, ...modules] : rest) as any };
            }),
            isDesktop
        )}
    </ResponsiveDialog>

    {/* --- EDITAR NOMBRE, CÓDIGO Y NIVEL DEL ROL --- */}
    <ResponsiveDialog
        open={isEditRoleModalOpen}
        onClose={() => setIsEditRoleModalOpen(false)}
        onSubmit={handleSaveEditRole}
        busy={isSavingRole}
        title="Editar rol"
        subtitle={roles.find(r => r.role === editRoleForm.originalRole)?.label || editRoleForm.originalRole}
        footer={
            <>
                <button type="button" onClick={() => setIsEditRoleModalOpen(false)} className={dialogSecondaryButton}>Cancelar</button>
                <button type="submit" disabled={isSavingRole || !editRoleForm.role || !editRoleForm.label} className={dialogPrimaryButton}>
                    <Save className="h-4 w-4" /> {isSavingRole ? 'Guardando…' : 'Guardar'}
                </button>
            </>
        }
    >
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <FormField label="Nombre" required>
                <input type="text" required placeholder="Ej.: Responsable Farmacia" className={inputClass} value={editRoleForm.label} onChange={e => setEditRoleForm({ ...editRoleForm, label: e.target.value })} />
            </FormField>
            <FormField label="Código" required hint="Único, sin espacios (use guion bajo).">
                <input type="text" required placeholder="Ej.: FARMACIA" className={`${inputClass} font-mono uppercase`} value={editRoleForm.role} onChange={e => setEditRoleForm({ ...editRoleForm, role: e.target.value.toUpperCase().replace(/\s+/g, '_') })} />
            </FormField>
            <div>
                <span className="mb-1.5 block text-xs font-black text-slate-700">Nivel de jurisdicción</span>
                <CustomSelect
                    className="h-11 text-sm"
                    value={editRoleForm.jurisdictionLevel || ''}
                    onChange={val => setEditRoleForm({ ...editRoleForm, jurisdictionLevel: val as any })}
                    options={[
                                    { value: '', label: 'Elegir nivel' },
                                    { value: 'GLOBAL', label: 'Nacional' },
                                    { value: 'DIRESA', label: 'DIRESA' },
                                    { value: 'OGESS', label: 'OGESS' },
                                    { value: 'UNGET', label: 'UNGET' },
                                    { value: 'MICRORED', label: 'Microred' },
                                    { value: 'IPRESS', label: 'Establecimiento' }
                                ]}
                />
            </div>
        </div>
    </ResponsiveDialog>

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

        const isActive = u.isActive === true || String(u.isActive).toLowerCase() === 'true';
        const canEdit = canAssignRoleKey(u.role) && canUsers.edit;
        const hierarchyRows = [
            ['DIRESA', diresaName],
            ['OGESS', ogessName],
            ['UNGET', ungetName],
            ['Microred', microredName],
            ['Establecimiento', facilityCodeStr ? `${facilityName} · ${facilityCodeStr}` : '-'],
        ].filter(([, value]) => value && value !== '-');

        return (
            <ResponsiveDialog
                open
                onClose={() => setViewingUser(null)}
                size="lg"
                title={personnelName}
                subtitle={`@${u.username}`}
                footer={
                    <>
                        <button type="button" onClick={() => setViewingUser(null)} className={dialogSecondaryButton}>Cerrar</button>
                        {canEdit && (
                            <button type="button" onClick={() => { setViewingUser(null); handleEditUserClick(u); }} className={dialogPrimaryButton}>
                                <Edit className="h-4 w-4" /> Editar
                            </button>
                        )}
                    </>
                }
            >
                <div className="space-y-3">
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                        <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-black ${isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
                            {personnelName.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || 'US'}
                        </span>
                        <div className="min-w-0">
                            <p className="text-[16px] font-black text-slate-900">{personnelName}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                <StatusChip label={isActive ? 'Activo' : 'Inactivo'} tone={isActive ? 'success' : 'neutral'} />
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">{roleLabel}</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <DialogSection title="Identificación">
                            <DialogRow label="DNI">{detailDni}</DialogRow>
                            <DialogRow label="Profesión">{detailProfession}</DialogRow>
                            <DialogRow label="Régimen laboral">{detailLaborRegime}</DialogRow>
                            {u.personnel?.birthDate && <DialogRow label="Fecha de nacimiento">{detailBirthDate}</DialogRow>}
                        </DialogSection>
                        <DialogSection title="Contacto">
                            <DialogRow label="Correo" icon={<Mail className="h-4 w-4" />}>
                                {detailEmail !== '-' ? <a href={`mailto:${detailEmail}`} className="text-teal-700 hover:underline">{detailEmail.toLowerCase()}</a> : <span className="font-normal text-slate-400">No registrado</span>}
                            </DialogRow>
                            <DialogRow label="Celular" icon={<Phone className="h-4 w-4" />}>
                                {detailPhone !== '-' ? <a href={`tel:${String(detailPhone).replace(/\s+/g, '')}`} className="text-teal-700 hover:underline">{detailPhone}</a> : <span className="font-normal text-slate-400">No registrado</span>}
                            </DialogRow>
                        </DialogSection>
                    </div>

                    <DialogSection title={`Jurisdicción${jurisdictionLevel && jurisdictionLevel !== 'No especificado' ? ` · nivel ${jurisdictionLevel === 'GLOBAL' ? 'nacional' : jurisdictionLevel}` : ''}`}>
                        {jurisdictionLevel === 'GLOBAL' ? (
                            <DialogRow label="Alcance">Nacional: ve toda la red</DialogRow>
                        ) : hierarchyRows.length === 0 ? (
                            <DialogRow label="Alcance"><span className="font-normal text-slate-400">Sin jurisdicción asignada</span></DialogRow>
                        ) : hierarchyRows.map(([label, value], index) => (
                            <div key={label} className="relative flex gap-3 px-4 py-2.5">
                                <span className="relative mt-1.5 flex w-3 shrink-0 justify-center">
                                    <span className="h-2.5 w-2.5 rounded-full bg-teal-500" />
                                    {index < hierarchyRows.length - 1 && <span className="absolute top-3 h-[calc(100%+8px)] w-0.5 bg-slate-200" />}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs text-slate-500">{label}</p>
                                    <p className="text-[15px] font-semibold text-slate-900">{value}</p>
                                </div>
                            </div>
                        ))}
                    </DialogSection>
                </div>
            </ResponsiveDialog>
        );
    })()}
    </>
  );
};
