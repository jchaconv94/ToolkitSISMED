import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { HealthFacility, Unget, Diresa, Ogess, Microred } from '../types';
import { Building2, Plus, Edit, Trash2, MapPin, Search, ChevronLeft, ChevronRight, Save, X, Network, Globe, Filter, FilterX, Info, Copy, Check, Hash, Phone, Mail, Activity, ShieldAlert, ShieldCheck, FileSpreadsheet, Zap, PlugZap, Settings2, Link2, Link2Off } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { CustomSelect } from './ui/CustomSelect';
import { buildUngetConnectionStatus, pickOneConnectionPerUnget, type UngetConnectionState } from '../services/ungetConnections';
import { isLinkedToSheet, resolveFacilitySheet } from '../services/facilitySheetLink';
import { FACILITY_TYPES, facilityTypeLabel, suggestedFacilityType } from '../services/facilityCodes';
import { listUngetSheets, type UngetSheet } from '../services/ungetSheetCatalog';
import {
    DEFAULT_STOCK_COLUMN_KEYS,
    isDefaultStockColumnSet,
    STOCK_COLUMNS,
} from '../services/stockColumns';
import { INTENT_OPEN_STOCK_CONNECTIONS, navigateToModule } from '../services/appRoutes';

/**
 * Cómo se muestra el estado de conexión de una UNGET.
 *
 * Los colores siguen la convención del proyecto: verde lo que funciona bien, ámbar lo que
 * funciona pero conviene cambiar, rojo lo que está roto y gris lo que nadie ha tocado.
 */
const CONNECTION_STATE_UI: Record<UngetConnectionState, { label: string; hint: string; chip: string; dark: string; Icon: React.ElementType }> = {
    'directa': {
        label: 'Lectura directa',
        hint: 'Lee la hoja de cálculo directamente. Es el camino rápido.',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dark: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
        Icon: Zap
    },
    'apps-script': {
        label: 'Apps Script',
        hint: 'Lee por el Web App de Google: es lento y a veces responde 404. Conviene configurar la hoja.',
        chip: 'bg-amber-50 text-amber-700 border-amber-200',
        dark: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
        Icon: Globe
    },
    'sin-hoja': {
        label: 'Sin hoja',
        hint: 'Tiene conexión creada pero sin hoja de cálculo ni Web App: no puede leer stock.',
        chip: 'bg-rose-50 text-rose-700 border-rose-200',
        dark: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
        Icon: ShieldAlert
    },
    'sin-conexion': {
        label: 'Sin configurar',
        hint: 'Nadie ha configurado la conexión de esta UNGET.',
        chip: 'bg-slate-100 text-slate-500 border-slate-200',
        dark: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
        Icon: PlugZap
    }
};

/** Mientras no se sepa el estado, se dice que no se sabe. */
const CONNECTION_STATE_UI_UNKNOWN: Record<'loading' | 'error', typeof CONNECTION_STATE_UI['directa']> = {
    loading: {
        label: 'Consultando…',
        hint: 'Leyendo el estado de conexión.',
        chip: 'bg-slate-50 text-slate-400 border-slate-200',
        dark: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
        Icon: Activity
    },
    error: {
        label: 'No se pudo leer',
        hint: 'No se pudo consultar el estado de conexión. No significa que falte configurarla.',
        chip: 'bg-slate-50 text-slate-400 border-slate-200',
        dark: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
        Icon: ShieldAlert
    }
};


export const AdminOrganizationModule: React.FC = () => {
    const { user, hasPermission } = useAuth();

    // Premium spreadsheet-like column filter states
    const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
    const [activeFilterTitle, setActiveFilterTitle] = useState('');
    const [activeFilterValue, setActiveFilterValue] = useState('');
    const [activeFilterOptions, setActiveFilterOptions] = useState<{ value: string; label: string }[]>([]);
    const [activeFilterOnChange, setActiveFilterOnChange] = useState<((val: string) => void) | null>(null);
    const [activeFilterTriggerRect, setActiveFilterTriggerRect] = useState<DOMRect | null>(null);
    const [headerFilterSearch, setHeaderFilterSearch] = useState('');

    // Dynamic clean close on scroll and window resize
    useEffect(() => {
        const handleCloseOnEvents = () => {
            setActiveFilterId(null);
            setActiveFilterTriggerRect(null);
        };
        window.addEventListener('resize', handleCloseOnEvents);
        document.addEventListener('scroll', handleCloseOnEvents, true);
        return () => {
            window.removeEventListener('resize', handleCloseOnEvents);
            document.removeEventListener('scroll', handleCloseOnEvents, true);
        };
    }, []);

    const renderHeaderFilter = (
        title: string,
        value: string,
        options: { value: string; label: string }[],
        onChange: (val: string) => void,
        id: string
    ) => {
        const isActive = !!value;
        return (
            <div 
                id={`th-filter-${id}`}
                onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setActiveFilterTitle(title);
                    setActiveFilterValue(value);
                    setActiveFilterOptions(options || []);
                    setActiveFilterOnChange(() => onChange);
                    setActiveFilterTriggerRect(rect);
                    setActiveFilterId(activeFilterId === id ? null : id);
                    setHeaderFilterSearch('');
                }}
                className={`group select-none inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                    isActive 
                        ? 'bg-teal-50 border-teal-200/80 text-teal-700 font-extrabold shadow-sm shadow-teal-50/20' 
                        : 'bg-transparent border-transparent hover:bg-slate-100 hover:border-slate-200 text-slate-500 hover:text-slate-800'
                }`}
            >
                <span className="font-extrabold uppercase tracking-wider text-[10px] whitespace-nowrap">{title}</span>
                <Filter 
                    className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
                        isActive 
                            ? 'text-teal-600 fill-teal-100 scale-110' 
                            : 'text-slate-400 group-hover:text-slate-600 group-hover:scale-105'
                    }`} 
                />
            </div>
        );
    };

    const [diresas, setDiresas] = useState<Diresa[]>([]);
    const [ogess, setOgess] = useState<Ogess[]>([]);
    const [ungets, setUngets] = useState<Unget[]>([]);
    const [microredes, setMicroredes] = useState<Microred[]>([]);
    const [stockConnections, setStockConnections] = useState<any[]>([]);
    const [connectionsStatus, setConnectionsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [facilities, setFacilities] = useState<HealthFacility[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const userRole = user?.role || '';
    
    const availableTabs = useMemo(() => {
        if (userRole === 'ADMIN') return ['DIRESA', 'OGESS', 'UNGET', 'MICRORED', 'IPRESS'];
        if (userRole === 'DIRESA') return ['DIRESA', 'OGESS', 'UNGET', 'MICRORED', 'IPRESS'];
        if (userRole === 'OGESS') return ['OGESS', 'UNGET', 'MICRORED', 'IPRESS'];
        if (userRole === 'UNGET') return ['UNGET', 'MICRORED', 'IPRESS'];
        return [];
    }, [userRole]);

    const [activeTab, setActiveTab] = useState<'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS'>(
        availableTabs.length > 0 ? (availableTabs[0] as any) : 'DIRESA'
    );

    useEffect(() => {
        if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
            setActiveTab(availableTabs[0] as any);
        }
    }, [availableTabs, activeTab]);

    const [searchQuery, setSearchQuery] = useState('');

    // New Advanced Filters States
    const [filterDiresaId, setFilterDiresaId] = useState('');
    const [filterOgessId, setFilterOgessId] = useState('');
    const [filterUngetId, setFilterUngetId] = useState('');
    const [filterMicroredId, setFilterMicroredId] = useState('');
    const [filterType, setFilterType] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [filterDepartment, setFilterDepartment] = useState('');
    const [filterProvince, setFilterProvince] = useState('');
    const [filterDistrict, setFilterDistrict] = useState('');
    const [isFilterPaneOpen, setIsFilterPaneOpen] = useState(false);

    // New Detail Explorer Modal States
    const [selectedDetailItem, setSelectedDetailItem] = useState<any | null>(null);
    const [selectedDetailType, setSelectedDetailType] = useState<'DIRESA' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS' | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    // Modal States
    const [isDiresaModalOpen, setIsDiresaModalOpen] = useState(false);
    const [isOgessModalOpen, setIsOgessModalOpen] = useState(false);
    const [isUngetModalOpen, setIsUngetModalOpen] = useState(false);
    const [isMicroredModalOpen, setIsMicroredModalOpen] = useState(false);
    const [isFacilityModalOpen, setIsFacilityModalOpen] = useState(false);
    const [facilityModalStep, setFacilityModalStep] = useState(1);
    const [editingFacilityOriginalCode, setEditingFacilityOriginalCode] = useState<string | null>(null);

    // Multi-step States
    const [diresaModalStep, setDiresaModalStep] = useState(1);
    const [ogessModalStep, setOgessModalStep] = useState(1);
    const [ungetModalStep, setUngetModalStep] = useState(1);

    // Form States
    const [diresaForm, setDiresaForm] = useState<Partial<Diresa>>({});
    const [ogessForm, setOgessForm] = useState<Partial<Ogess>>({});
    const [ungetForm, setUngetForm] = useState<Partial<Unget>>({});
    const [microredForm, setMicroredForm] = useState<Partial<Microred>>({});
    const [facilityForm, setFacilityForm] = useState<Partial<HealthFacility>>({});

    // Quick Spreadsheet Linking states
    const [linkFacilityCode, setLinkFacilityCode] = useState("");
    const [linkFacilityName, setLinkFacilityName] = useState("");
    const [linkAvailableSheets, setLinkAvailableSheets] = useState<UngetSheet[]>([]);
    const [linkSheetsError, setLinkSheetsError] = useState("");
    const [linkLoadingSheets, setLinkLoadingSheets] = useState(false);
    const [linkUngetConfigs, setLinkUngetConfigs] = useState<any[]>([]);
    const [linkVisibleColumns, setLinkVisibleColumns] = useState<string[]>([]);
    /** Si este establecimiento ya tenía columnas guardadas, para no crear filas de más. */
    const [linkHadPreferences, setLinkHadPreferences] = useState(false);

    /** Conexión de la UNGET a la que pertenece el establecimiento que se está registrando. */
    const linkConnection = useMemo(() => {
        const ungetId = String(facilityForm.ungetId || "").trim();
        if (!ungetId) return null;
        return pickOneConnectionPerUnget(linkUngetConfigs).find(
            (c: any) => String(c.ungetId || "") === ungetId,
        ) || null;
    }, [facilityForm.ungetId, linkUngetConfigs]);

    /**
     * Tipo que el propio código declara: `06528F02` es un puesto comunal y `030S05` un
     * almacén. Sirve de aviso —y de valor inicial cuando todavía no se eligió ninguno—
     * para que un puesto comunal no vuelva a registrarse como «puesto de salud», que es lo
     * que obligaba a marcarlos a mano con la categoría `P.C.`.
     */
    const tipoSugeridoPorCodigo = useMemo(
        () => suggestedFacilityType(facilityForm.code),
        [facilityForm.code],
    );

    useEffect(() => {
        // Solo cuando no hay tipo elegido: nunca se pisa lo que alguien puso a mano. Y solo
        // al cambiar lo que el código sugiere, no cada vez que se toca el tipo: si no,
        // vaciar el desplegable lo devolvería solo y no habría forma de corregirlo.
        if (!tipoSugeridoPorCodigo) return;
        setFacilityForm(form => (form.type ? form : { ...form, type: tipoSugeridoPorCodigo }));
    }, [tipoSugeridoPorCodigo]);

    /**
     * La hoja del establecimiento no se elige: se deduce de su código. Ver
     * `services/facilitySheetLink.ts`.
     */
    const linkResolved = useMemo(
        () => (facilityForm.code ? resolveFacilitySheet(facilityForm.code, linkAvailableSheets) : null),
        [facilityForm.code, linkAvailableSheets],
    );

    // Las pestañas del libro de su UNGET, que es contra lo que se compara el código.
    useEffect(() => {
        if (!isFacilityModalOpen) return;
        setLinkAvailableSheets([]);
        setLinkSheetsError("");
        if (!linkConnection) return;

        let vigente = true;
        setLinkLoadingSheets(true);
        listUngetSheets(linkConnection, { withRowCounts: false })
            .then(sheets => { if (vigente) setLinkAvailableSheets(sheets); })
            .catch((err: any) => {
                console.error("No se pudieron leer las hojas de la UNGET:", err);
                if (vigente) setLinkSheetsError(err?.message || "No se pudieron leer las hojas de esta UNGET.");
            })
            .finally(() => { if (vigente) setLinkLoadingSheets(false); });
        return () => { vigente = false; };
    }, [isFacilityModalOpen, linkConnection]);

    const handleOpenLinkModal = async (code: string | undefined, name: string | undefined) => {
        if (!code) return;
        const found = facilities.find(f => f.code === code);
        if (found) {
            setEditingFacilityOriginalCode(found.code);
            setFacilityForm({ ...found });
        } else {
            setEditingFacilityOriginalCode(null);
            setFacilityForm({ code, name });
        }
        setFacilityModalStep(4);
        setIsFacilityModalOpen(true);
        prepareFacilityStep4(code, name);
    };

    // DIRESA step validations
    const isDiresaStep1Valid = useMemo(() => {
        return !!diresaForm.name?.trim() && 
               !!diresaForm.ruc?.trim();
    }, [diresaForm.name, diresaForm.ruc]);

    const isDiresaStep2Valid = useMemo(() => {
        return !!diresaForm.district?.trim() && 
               !!diresaForm.province?.trim() && 
               !!diresaForm.department?.trim();
    }, [diresaForm.district, diresaForm.province, diresaForm.department]);

    // OGESS step validations
    const isOgessStep1Valid = useMemo(() => {
        return !!ogessForm.name?.trim() && 
               !!ogessForm.diresaId && 
               !!ogessForm.code?.trim();
    }, [ogessForm.name, ogessForm.diresaId, ogessForm.code]);

    const isOgessStep2Valid = useMemo(() => {
        return !!ogessForm.district?.trim() && 
               !!ogessForm.province?.trim();
    }, [ogessForm.district, ogessForm.province]);

    // UNGET step validations
    const isUngetStep1Valid = useMemo(() => {
        return !!ungetForm.name?.trim() && 
               (!!ungetForm.ogessId || !!ungetForm.diresaId);
    }, [ungetForm.name, ungetForm.ogessId, ungetForm.diresaId]);

    const isUngetStep2Valid = useMemo(() => {
        return !!ungetForm.district?.trim() && 
               !!ungetForm.province?.trim();
    }, [ungetForm.district, ungetForm.province]);

    // Facility step validations
    const isFacilityStep1Valid = useMemo(() => {
        // Un puesto comunal no tiene categoría de IPRESS: es una farmacia de la suya, y
        // las categorías (I-1, I-2, …) califican al establecimiento entero. Exigírsela
        // obligaría a inventar una, que es justo lo que llevó a usar `P.C.` como categoría.
        const necesitaCategoria = facilityForm.type !== 'PUESTO_COMUNAL';
        return !!facilityForm.code?.trim() &&
               !!facilityForm.name?.trim() &&
               (!necesitaCategoria || !!facilityForm.category?.trim()) &&
               !!facilityForm.type;
    }, [facilityForm.code, facilityForm.name, facilityForm.category, facilityForm.type]);

    const isFacilityStep2Valid = useMemo(() => {
        return !!facilityForm.microredId || 
               !!facilityForm.ungetId || 
               !!facilityForm.ogessId || 
               !!facilityForm.diresaId;
    }, [facilityForm.microredId, facilityForm.ungetId, facilityForm.ogessId, facilityForm.diresaId]);

    const isFacilityStep3Valid = useMemo(() => {
        return !!facilityForm.district?.trim() && 
               !!facilityForm.province?.trim();
    }, [facilityForm.district, facilityForm.province]);

    // La hoja ya no se elige, así que el único requisito es que quede alguna columna visible.
    const isFacilityStep4Valid = useMemo(() => linkVisibleColumns.length > 0, [linkVisibleColumns]);

    // Hierarchy Locks for non-ADMIN users
    const isSuperAdmin = user?.role === 'ADMIN';

    const userFacilityCode = user?.personnelData?.facilityCode || user?.facilityData?.code || (user as any)?.facilityCode;

    const userUngetId = useMemo(() => {
        const uUnget = user?.personnelData?.ungetId || user?.facilityData?.ungetId || (user as any)?.ungetId;
        if (uUnget) return uUnget;
        if (userFacilityCode) {
            const fac = facilities.find(f => f.code === userFacilityCode);
            if (fac?.ungetId) return fac.ungetId;
        }
        const uMicro = user?.personnelData?.microredId || user?.facilityData?.microredId || (user as any)?.microredId;
        if (uMicro) {
            const mic = microredes.find(m => m.id === uMicro);
            if (mic?.ungetId) return mic.ungetId;
        }
        return '';
    }, [user, userFacilityCode, facilities, microredes]);

    const userOgessId = useMemo(() => {
        const uOgess = user?.personnelData?.ogessId || user?.facilityData?.ogessId || (user as any)?.ogessId;
        if (uOgess) return uOgess;
        if (userUngetId) {
            const ung = ungets.find(u => u.id === userUngetId);
            if (ung?.ogessId) return ung.ogessId;
        }
        if (userFacilityCode) {
            const fac = facilities.find(f => f.code === userFacilityCode);
            if (fac?.ogessId) return fac.ogessId;
        }
        return '';
    }, [user, userUngetId, userFacilityCode, ungets, facilities]);

    const userDiresaId = useMemo(() => {
        const uDiresa = user?.personnelData?.diresaId || user?.facilityData?.diresaId || (user as any)?.diresaId;
        if (uDiresa) return uDiresa;
        if (userOgessId) {
            const og = ogess.find(o => o.id === userOgessId);
            if (og?.diresaId) return og.diresaId;
        }
        if (userUngetId) {
            const ung = ungets.find(u => u.id === userUngetId);
            if (ung?.diresaId) return ung.diresaId;
        }
        if (userFacilityCode) {
            const fac = facilities.find(f => f.code === userFacilityCode);
            if (fac?.diresaId) return fac.diresaId;
        }
        return '';
    }, [user, userOgessId, userUngetId, userFacilityCode, ogess, ungets, facilities]);

    const userMicroredId = useMemo(() => {
        return user?.personnelData?.microredId || user?.facilityData?.microredId || (user as any)?.microredId || '';
    }, [user]);

    const canAddActiveTab = useMemo(() => {
        if (isSuperAdmin) return true;
        if (activeTab === 'DIRESA') return false;
        if (activeTab === 'OGESS') return userRole === 'DIRESA';
        if (activeTab === 'UNGET') return ['DIRESA', 'OGESS'].includes(userRole);
        if (activeTab === 'MICRORED') return ['DIRESA', 'OGESS', 'UNGET'].includes(userRole);
        if (activeTab === 'IPRESS') return ['DIRESA', 'OGESS', 'UNGET'].includes(userRole);
        return false;
    }, [activeTab, isSuperAdmin, userRole]);

    // Filtered lists shown in tables
    const visibleDiresas = useMemo(() => {
        if (isSuperAdmin) return diresas;
        if (userDiresaId) return diresas.filter(d => d.id === userDiresaId);
        return diresas;
    }, [diresas, isSuperAdmin, userDiresaId]);

    const visibleOgess = useMemo(() => {
        if (isSuperAdmin) return ogess;
        if (userOgessId) return ogess.filter(o => o.id === userOgessId);
        if (userDiresaId) return ogess.filter(o => o.diresaId === userDiresaId);
        return ogess;
    }, [ogess, isSuperAdmin, userOgessId, userDiresaId]);

    const visibleUngets = useMemo(() => {
        if (isSuperAdmin) return ungets;
        if (userUngetId) return ungets.filter(u => u.id === userUngetId);
        if (userOgessId) return ungets.filter(u => u.ogessId === userOgessId);
        if (userDiresaId) {
            return ungets.filter(u => {
                if (u.diresaId === userDiresaId) return true;
                if (u.ogessId) {
                    const parentOgess = ogess.find(o => o.id === u.ogessId);
                    return parentOgess?.diresaId === userDiresaId;
                }
                return false;
            });
        }
        return ungets;
    }, [ungets, ogess, isSuperAdmin, userUngetId, userOgessId, userDiresaId]);

    const visibleMicroredes = useMemo(() => {
        if (isSuperAdmin) return microredes;
        if (userUngetId) return microredes.filter(m => m.ungetId === userUngetId);
        if (userOgessId) {
            return microredes.filter(m => {
                const parentUnget = ungets.find(u => u.id === m.ungetId);
                return parentUnget?.ogessId === userOgessId;
            });
        }
        if (userDiresaId) {
            return microredes.filter(m => {
                const parentUnget = ungets.find(u => u.id === m.ungetId);
                if (!parentUnget) return false;
                if (parentUnget.diresaId === userDiresaId) return true;
                if (parentUnget.ogessId) {
                    const parentOgess = ogess.find(o => o.id === parentUnget.ogessId);
                    return parentOgess?.diresaId === userDiresaId;
                }
                return false;
            });
        }
        return microredes;
    }, [microredes, ungets, ogess, isSuperAdmin, userUngetId, userOgessId, userDiresaId]);

    const visibleFacilities = useMemo(() => {
        if (isSuperAdmin) return facilities;
        return facilities.filter(f => {
            if (userUngetId && f.ungetId !== userUngetId) return false;
            if (userOgessId && f.ogessId !== userOgessId) return false;
            if (userDiresaId && f.diresaId !== userDiresaId) return false;
            return true;
        });
    }, [facilities, isSuperAdmin, userUngetId, userOgessId, userDiresaId]);

    // Computed lists applying both Advanced Filters and Search input
    const finalFilteredDiresas = useMemo(() => {
        let list = visibleDiresas;
        if (filterDiresaId) {
            list = list.filter(d => d.id === filterDiresaId);
        }
        if (filterDepartment) {
            list = list.filter(d => d.department?.toLowerCase() === filterDepartment.toLowerCase());
        }
        if (filterProvince) {
            list = list.filter(d => d.province?.toLowerCase() === filterProvince.toLowerCase());
        }
        if (filterDistrict) {
            list = list.filter(d => d.district?.toLowerCase() === filterDistrict.toLowerCase());
        }
        if (searchQuery) {
            list = list.filter(d => 
                d.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                (d.ruc && d.ruc.includes(searchQuery))
            );
        }
        return list;
    }, [visibleDiresas, filterDiresaId, filterDepartment, filterProvince, filterDistrict, searchQuery]);

    const finalFilteredOgess = useMemo(() => {
        let list = visibleOgess;
        if (filterDiresaId) {
            list = list.filter(o => o.diresaId === filterDiresaId);
        }
        if (filterOgessId) {
            list = list.filter(o => o.id === filterOgessId);
        }
        if (filterDepartment) {
            list = list.filter(o => o.department?.toLowerCase().includes(filterDepartment.toLowerCase()));
        }
        if (filterProvince) {
            list = list.filter(o => o.province?.toLowerCase().includes(filterProvince.toLowerCase()));
        }
        if (filterDistrict) {
            list = list.filter(o => o.district?.toLowerCase().includes(filterDistrict.toLowerCase()));
        }
        if (searchQuery) {
            list = list.filter(o => 
                o.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                (o.code && o.code.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (o.ruc && o.ruc.includes(searchQuery))
            );
        }
        return list;
    }, [visibleOgess, filterDiresaId, filterOgessId, filterDepartment, filterProvince, filterDistrict, searchQuery]);

    const finalFilteredUngets = useMemo(() => {
        let list = visibleUngets;
        if (filterDiresaId) {
            list = list.filter(u => {
                if (u.diresaId === filterDiresaId) return true;
                if (u.ogessId) {
                    const parent = ogess.find(o => o.id === u.ogessId);
                    return parent?.diresaId === filterDiresaId;
                }
                return false;
            });
        }
        if (filterOgessId) {
            list = list.filter(u => u.ogessId === filterOgessId);
        }
        if (filterUngetId) {
            list = list.filter(u => u.id === filterUngetId);
        }
        if (filterDepartment) {
            list = list.filter(u => u.department?.toLowerCase().includes(filterDepartment.toLowerCase()));
        }
        if (filterProvince) {
            list = list.filter(u => u.province?.toLowerCase().includes(filterProvince.toLowerCase()));
        }
        if (filterDistrict) {
            list = list.filter(u => u.district?.toLowerCase().includes(filterDistrict.toLowerCase()));
        }
        if (searchQuery) {
            list = list.filter(u => 
                u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (u.province && u.province.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (u.district && u.district.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }
        return list;
    }, [visibleUngets, filterDiresaId, filterOgessId, filterUngetId, filterDepartment, filterProvince, filterDistrict, searchQuery, ogess]);

    const finalFilteredMicroredes = useMemo(() => {
        let list = visibleMicroredes;
        if (filterDiresaId) {
            list = list.filter(m => {
                const parentUnget = ungets.find(u => u.id === m.ungetId);
                if (!parentUnget) return false;
                if (parentUnget.diresaId === filterDiresaId) return true;
                if (parentUnget.ogessId) {
                    const parentOgess = ogess.find(o => o.id === parentUnget.ogessId);
                    return parentOgess?.diresaId === filterDiresaId;
                }
                return false;
            });
        }
        if (filterOgessId) {
            list = list.filter(m => {
                const parentUnget = ungets.find(u => u.id === m.ungetId);
                return parentUnget?.ogessId === filterOgessId;
            });
        }
        if (filterUngetId) {
            list = list.filter(m => m.ungetId === filterUngetId);
        }
        if (filterMicroredId) {
            list = list.filter(m => m.id === filterMicroredId);
        }
        if (searchQuery) {
            list = list.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()));
        }
        return list;
    }, [visibleMicroredes, filterDiresaId, filterOgessId, filterUngetId, filterMicroredId, searchQuery, ungets, ogess]);

    const finalFilteredFacilities = useMemo(() => {
        let list = visibleFacilities;
        if (filterDiresaId) {
            list = list.filter(f => f.diresaId === filterDiresaId);
        }
        if (filterOgessId) {
            list = list.filter(f => f.ogessId === filterOgessId);
        }
        if (filterUngetId) {
            list = list.filter(f => f.ungetId === filterUngetId);
        }
        if (filterMicroredId) {
            list = list.filter(f => f.microredId === filterMicroredId);
        }
        if (filterDepartment) {
            list = list.filter(f => f.department?.toLowerCase().includes(filterDepartment.toLowerCase()));
        }
        if (filterProvince) {
            list = list.filter(f => f.province?.toLowerCase().includes(filterProvince.toLowerCase()));
        }
        if (filterDistrict) {
            list = list.filter(f => f.district?.toLowerCase().includes(filterDistrict.toLowerCase()));
        }
        if (filterType) {
            list = list.filter(f => f.type === filterType);
        }
        if (filterCategory) {
            list = list.filter(f => f.category?.toLowerCase() === filterCategory.toLowerCase());
        }
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            list = list.filter(f => 
                f.name.toLowerCase().includes(query) || 
                f.code.toLowerCase().includes(query) ||
                (f.district && f.district.toLowerCase().includes(query)) ||
                (f.province && f.province.toLowerCase().includes(query))
            );
        }
        return list;
    }, [visibleFacilities, filterDiresaId, filterOgessId, filterUngetId, filterMicroredId, filterType, filterCategory, filterDepartment, filterProvince, filterDistrict, searchQuery]);

    const hasActiveFilters = useMemo(() => {
        return !!filterDiresaId || !!filterOgessId || !!filterUngetId || !!filterMicroredId || !!filterType || !!filterCategory || !!filterDepartment || !!filterProvince || !!filterDistrict;
    }, [filterDiresaId, filterOgessId, filterUngetId, filterMicroredId, filterType, filterCategory, filterDepartment, filterProvince, filterDistrict]);

    const filterOptions = useMemo(() => {
        let departments = new Set<string>();
        let provinces = new Set<string>();
        let districts = new Set<string>();

        const extractFrom = (list: any[]) => {
            list.forEach(item => {
                if (item.department) departments.add(item.department);
                if (item.province) provinces.add(item.province);
                if (item.district) districts.add(item.district);
            });
        };

        if (activeTab === 'DIRESA') extractFrom(visibleDiresas);
        else if (activeTab === 'OGESS') extractFrom(visibleOgess);
        else if (activeTab === 'UNGET') extractFrom(visibleUngets);
        else if (activeTab === 'MICRORED') extractFrom(visibleMicroredes);
        else if (activeTab === 'IPRESS') extractFrom(visibleFacilities);

        return {
            departments: [{ value: '', label: 'Todos' }, ...Array.from(departments).sort().map(d => ({ value: d, label: d }))],
            provinces: [{ value: '', label: 'Todas' }, ...Array.from(provinces).sort().map(p => ({ value: p, label: p }))],
            districts: [{ value: '', label: 'Todos' }, ...Array.from(districts).sort().map(d => ({ value: d, label: d }))]
        };
    }, [activeTab, visibleDiresas, visibleOgess, visibleUngets, visibleMicroredes, visibleFacilities]);

    const clearAllFilters = () => {
        setFilterDiresaId('');
        setFilterOgessId('');
        setFilterUngetId('');
        setFilterMicroredId('');
        setFilterType('');
        setFilterCategory('');
        setFilterDepartment('');
        setFilterProvince('');
        setFilterDistrict('');
        toast.info('Se han limpiado todos los filtros activos.');
    };

    // Dynamic Select lists reactive to form state and locks
    const ogessOptions = useMemo(() => {
        let list = visibleOgess;
        if (facilityForm.diresaId) {
            list = list.filter(o => o.diresaId === facilityForm.diresaId);
        }
        return list;
    }, [visibleOgess, facilityForm.diresaId]);

    const ungetOptions = useMemo(() => {
        let list = visibleUngets;
        if (facilityForm.ogessId) {
            list = list.filter(u => u.ogessId === facilityForm.ogessId);
        } else if (facilityForm.diresaId) {
            list = list.filter(u => {
                if (u.diresaId === facilityForm.diresaId) return true;
                if (u.ogessId) {
                    const parentOgess = ogess.find(o => o.id === u.ogessId);
                    return parentOgess?.diresaId === facilityForm.diresaId;
                }
                return false;
            });
        }
        return list;
    }, [visibleUngets, facilityForm.ogessId, facilityForm.diresaId, ogess]);

    const microredOptions = useMemo(() => {
        let list = visibleMicroredes;
        if (facilityForm.ungetId) {
            list = list.filter(m => m.ungetId === facilityForm.ungetId);
        }
        return list;
    }, [visibleMicroredes, facilityForm.ungetId]);

    const fetchData = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const [dir, ogs, ung, mic, facs] = await Promise.all([
                api.getDiresas(),
                api.getOgess(),
                api.getUngets(),
                api.getMicroredes(),
                api.getFacilities()
            ]);
            setDiresas(dir);
            setOgess(ogs);
            setUngets(ung);
            setMicroredes(mic);
            setFacilities(facs);
        } catch (e) {
            console.error("Error fetching organization data:", e);
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Las conexiones de stock viven en otro módulo y en otra tabla. Se leen aparte a
    // propósito: si esa lectura falla, Establecimientos sigue mostrando la organización y
    // solo se queda sin el estado de conexión.
    useEffect(() => {
        let vigente = true;
        api.getAllUngetConfigs()
            .then(configs => {
                if (!vigente) return;
                setStockConnections(configs || []);
                setConnectionsStatus('ready');
            })
            .catch(e => {
                console.warn("No se pudo leer el estado de conexión de las UNGET:", e);
                if (vigente) setConnectionsStatus('error');
            });
        return () => { vigente = false; };
    }, []);

    /** Estado de conexión por identificador de UNGET. */
    const connectionByUnget = useMemo(
        () => buildUngetConnectionStatus(ungets, stockConnections, { currentUsername: user?.username }),
        [ungets, stockConnections, user?.username]
    );

    /**
     * Cómo pintar el estado de una UNGET.
     *
     * Mientras las conexiones no hayan llegado —o si no se pudieron leer— no se dice «Sin
     * configurar»: esa etiqueta pide actuar, y afirmarla sin saberlo manda al informático a
     * rehacer una conexión que quizá ya existe.
     */
    const getConnectionUi = (ungetId?: string) => {
        if (connectionsStatus !== 'ready') return CONNECTION_STATE_UI_UNKNOWN[connectionsStatus];
        return CONNECTION_STATE_UI[connectionByUnget.get(String(ungetId || ''))?.state || 'sin-conexion'];
    };

    /** Solo se ofrece el acceso a quien puede entrar a Consulta Stock. */
    const canReachStockConnections = hasPermission('SIG_SEARCH');

    const goToStockConnections = () => {
        setSelectedDetailItem(null);
        setSelectedDetailType(null);
        navigateToModule('SIG_SEARCH', INTENT_OPEN_STOCK_CONNECTIONS);
    };

    // --- DIRESA CRUD --- //
    const handleSaveDiresa = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const savedData = { ...diresaForm };
        const res = await api.saveDiresa(savedData);
        if (res.success) { 
            // Inmediate UI update
            setDiresas(prev => {
                if (savedData.id) {
                    return prev.map(d => d.id === savedData.id ? (savedData as Diresa) : d);
                }
                return [...prev, { ...savedData, id: savedData.id || crypto.randomUUID() } as Diresa];
            });
            toast.success('Guardado correctamente'); 
            setIsDiresaModalOpen(false); 
            await fetchData(true); 
        }
        else toast.error(res.message);
    };
    const handleDeleteDiresa = async (id: string) => {
        const item = diresas.find(d => d.id === id);
        const name = item ? item.name : id;
        toast(`¿Eliminar DIRESA "${name}"?`, {
            description: "Esta acción eliminará toda la estructura y establecimientos dependientes.",
            action: {
                label: "Eliminar",
                onClick: async () => {
                    setDiresas(prev => prev.filter(d => d.id !== id));
                    const res = await api.deleteDiresa(id);
                    if (res.success) { toast.success('DIRESA eliminada'); await fetchData(true); }
                    else { toast.error(res.message); await fetchData(true); }
                }
            }
        });
    };

    // --- OGESS CRUD --- //
    const handleSaveOgess = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const savedData = { ...ogessForm };
        const res = await api.saveOgess(savedData);
        if (res.success) { 
            // Inmediate UI update
            setOgess(prev => {
                if (savedData.id) {
                    return prev.map(o => o.id === savedData.id ? (savedData as Ogess) : o);
                }
                return [...prev, { ...savedData, id: savedData.id || crypto.randomUUID() } as Ogess];
            });
            toast.success('Guardado correctamente'); 
            setIsOgessModalOpen(false); 
            await fetchData(true); 
        }
        else toast.error(res.message);
    };
    const handleDeleteOgess = async (id: string) => {
        const item = ogess.find(o => o.id === id);
        const name = item ? item.name : id;
        toast(`¿Eliminar OGESS "${name}"?`, {
            description: "Esta acción eliminará toda la estructura y establecimientos dependientes.",
            action: {
                label: "Eliminar",
                onClick: async () => {
                    setOgess(prev => prev.filter(o => o.id !== id));
                    const res = await api.deleteOgess(id);
                    if (res.success) { toast.success('OGESS eliminada'); await fetchData(true); }
                    else { toast.error(res.message); await fetchData(true); }
                }
            }
        });
    };

    // --- UNGET CRUD --- //
    const handleSaveUnget = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const savedData = { ...ungetForm };
        const res = await api.saveUnget(savedData);
        if (res.success) { 
            // Inmediate UI update
            setUngets(prev => {
                if (savedData.id) {
                    return prev.map(u => u.id === savedData.id ? (savedData as Unget) : u);
                }
                return [...prev, { ...savedData, id: savedData.id || crypto.randomUUID() } as Unget];
            });
            toast.success('Guardado correctamente'); 
            setIsUngetModalOpen(false); 
            await fetchData(true); 
        }
        else toast.error(res.message);
    };
    const handleDeleteUnget = async (id: string) => {
        const item = ungets.find(u => u.id === id);
        const name = item ? item.name : id;
        toast(`¿Eliminar UNGET "${name}"?`, {
            description: "Esta acción eliminará toda la estructura y establecimientos dependientes.",
            action: {
                label: "Eliminar",
                onClick: async () => {
                    setUngets(prev => prev.filter(u => u.id !== id));
                    const res = await api.deleteUnget(id);
                    if (res.success) { toast.success('UNGET eliminada'); await fetchData(true); }
                    else { toast.error(res.message); await fetchData(true); }
                }
            }
        });
    };

    // --- MICRORED CRUD --- //
    const handleSaveMicrored = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const savedData = { ...microredForm };
        const res = await api.saveMicrored(savedData);
        if (res.success) { 
            // Inmediate UI update
            setMicroredes(prev => {
                if (savedData.id) {
                    return prev.map(m => m.id === savedData.id ? (savedData as Microred) : m);
                }
                return [...prev, { ...savedData, id: savedData.id || crypto.randomUUID() } as Microred];
            });
            toast.success('Guardado correctamente'); 
            setIsMicroredModalOpen(false); 
            await fetchData(true); 
        }
        else toast.error(res.message);
    };
    const handleDeleteMicrored = async (id: string) => {
        const item = microredes.find(m => m.id === id);
        const name = item ? item.name : id;
        toast(`¿Eliminar MICRORED "${name}"?`, {
            description: "Esta acción eliminará referencias a ella en establecimientos.",
            action: {
                label: "Eliminar",
                onClick: async () => {
                    setMicroredes(prev => prev.filter(m => m.id !== id));
                    const res = await api.deleteMicrored(id);
                    if (res.success) { toast.success('MICRORED eliminada'); await fetchData(true); }
                    else { toast.error(res.message); await fetchData(true); }
                }
            }
        });
    };

    // --- IPRESS CRUD --- //
    const handleMicroredChange = (microredId: string) => {
        let updatedForm = { 
            ...facilityForm, 
            microredId,
            ungetId: '',
            ogessId: '',
            diresaId: '',
            department: ''
        };
        
        if (microredId) {
            const selectedMicrored = microredes.find(m => m.id === microredId);
            if (selectedMicrored && selectedMicrored.ungetId) {
                updatedForm.ungetId = selectedMicrored.ungetId;
                
                const selectedUnget = ungets.find(u => u.id === selectedMicrored.ungetId);
                if (selectedUnget) {
                    let diresaIdToUse = selectedUnget.diresaId;
                    if (selectedUnget.ogessId) {
                        updatedForm.ogessId = selectedUnget.ogessId;
                        
                        const selectedOgess = ogess.find(o => o.id === selectedUnget.ogessId);
                        if (selectedOgess) {
                            updatedForm.diresaId = selectedOgess.diresaId;
                            diresaIdToUse = selectedOgess.diresaId;
                        }
                    } else if (selectedUnget.diresaId) {
                        updatedForm.diresaId = selectedUnget.diresaId;
                    }
                    
                    if (diresaIdToUse) {
                        const selectedDiresa = diresas.find(d => d.id === diresaIdToUse);
                        if (selectedDiresa) {
                            updatedForm.department = selectedDiresa.department || '';
                        }
                    }
                }
            }
        }
        
        setFacilityForm(updatedForm);
    };

    const handleUngetChange = (ungetId: string) => {
        let updatedForm = { 
            ...facilityForm, 
            ungetId,
            ogessId: '',
            diresaId: '',
            department: ''
        };

        if (ungetId) {
            const selectedUnget = ungets.find(u => u.id === ungetId);
            if (selectedUnget) {
                let diresaIdToUse = selectedUnget.diresaId;
                if (selectedUnget.ogessId) {
                    updatedForm.ogessId = selectedUnget.ogessId;
                    const selectedOgess = ogess.find(o => o.id === selectedUnget.ogessId);
                    if (selectedOgess) {
                        updatedForm.diresaId = selectedOgess.diresaId;
                        diresaIdToUse = selectedOgess.diresaId;
                    }
                } else if (selectedUnget.diresaId) {
                    updatedForm.diresaId = selectedUnget.diresaId;
                }

                if (diresaIdToUse) {
                    const selectedDiresa = diresas.find(d => d.id === diresaIdToUse);
                    if (selectedDiresa) {
                        updatedForm.department = selectedDiresa.department || '';
                    }
                }
            }
        }

        setFacilityForm(updatedForm);
    };

    const handleDiresaChange = (diresaId: string) => {
        let updatedForm = { 
            ...facilityForm, 
            diresaId,
            department: ''
        };

        if (diresaId) {
            const selectedDiresa = diresas.find(d => d.id === diresaId);
            if (selectedDiresa) {
                updatedForm.department = selectedDiresa.department || '';
            }
        }
        setFacilityForm(updatedForm);
    };

    const handleOgessChange = (ogessId: string) => {
        let updatedForm = { 
            ...facilityForm, 
            ogessId,
            diresaId: '',
            department: ''
        };

        if (ogessId) {
            const selectedOgess = ogess.find(o => o.id === ogessId);
            if (selectedOgess) {
                updatedForm.diresaId = selectedOgess.diresaId;
                if (selectedOgess.diresaId) {
                    const selectedDiresa = diresas.find(d => d.id === selectedOgess.diresaId);
                    if (selectedDiresa) {
                        updatedForm.department = selectedDiresa.department || '';
                    }
                }
            }
        }
        setFacilityForm(updatedForm);
    };

    /**
     * Prepara el paso 4. Ya no precarga ninguna elección de hoja: la hoja se deduce del
     * código y las pestañas las trae el efecto de arriba en cuanto se conoce la UNGET. Aquí
     * solo se recuperan las columnas que ya tuviera guardadas el establecimiento.
     */
    const prepareFacilityStep4 = async (code: string | undefined, name: string | undefined) => {
        setLinkFacilityCode(code || "");
        setLinkFacilityName(name || "");
        setLinkAvailableSheets([]);
        setLinkSheetsError("");
        setLinkHadPreferences(false);
        setLinkVisibleColumns(DEFAULT_STOCK_COLUMN_KEYS);

        try {
            // Todas las conexiones, no solo las propias: la UNGET del establecimiento puede
            // ser de otro informático y su libro es el que hay que mirar.
            setLinkUngetConfigs(await api.getAllUngetConfigs());
        } catch (e) {
            console.error("Error loading configs:", e);
            try {
                if (user?.username) setLinkUngetConfigs(await api.getUngetConfigs(user.username));
            } catch (err) {
                console.error("Error loading own configs:", err);
            }
        }

        if (code) {
            try {
                const assignments = await api.getMyStockAssignments(code);
                if (assignments && assignments.length > 0) {
                    setLinkHadPreferences(true);
                    if (assignments[0].visibleColumns?.length) {
                        setLinkVisibleColumns(assignments[0].visibleColumns);
                    }
                }
            } catch(e) {
                console.error("Error loading existing stock assignment:", e);
            }
        }
    };

    const handleSaveFacility = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        
        // 1. Save Health Facility First
        const res = await api.saveFacility(facilityForm as HealthFacility, editingFacilityOriginalCode || undefined);
        if (res.success) { 
            const finalCode = (facilityForm.code || editingFacilityOriginalCode || "").trim();

            // 2. Columnas visibles del stock. El vínculo con la hoja no se guarda: se deduce
            // del código en cada lectura (services/facilitySheetLink.ts).
            const sonLasPorOmision = isDefaultStockColumnSet(linkVisibleColumns);

            // Solo se escribe cuando hay algo que recordar: una elección distinta de la
            // predeterminada, o una fila que ya existía y hay que mantener al día.
            if (finalCode && linkVisibleColumns.length > 0 && (linkHadPreferences || !sonLasPorOmision)) {
                const assigRes = await api.saveStockColumnPreferences({
                    adminUsername: user?.username || "",
                    facilityCode: finalCode,
                    // Informativos: quedan como referencia de la última hoja reconocida.
                    sheetName: linkResolved?.sheet?.name || "",
                    sheetUrl: linkConnection?.url || "",
                    ungetId: facilityForm.ungetId || undefined,
                    visibleColumns: linkVisibleColumns
                });

                if (!assigRes.success) {
                    toast.error(`La IPRESS se guardó, pero hubo un problema con las columnas visibles del stock: ${assigRes.message}`);
                    return;
                }
            }

            // Immediate reactive update in memory
            const updatedItem: HealthFacility = {
                code: finalCode,
                name: (facilityForm.name || '').trim(),
                category: (facilityForm.category || '').trim(),
                type: facilityForm.type || undefined,
                ungetId: facilityForm.ungetId || undefined,
                microredId: facilityForm.microredId || undefined,
                ogessId: facilityForm.ogessId || undefined,
                diresaId: facilityForm.diresaId || undefined,
                legalAddress: facilityForm.legalAddress || undefined,
                website: facilityForm.website || undefined,
                socialMedia: facilityForm.socialMedia || undefined,
                phone: facilityForm.phone || undefined,
                email: facilityForm.email || undefined,
                department: facilityForm.department || undefined,
                province: facilityForm.province || undefined,
                district: facilityForm.district || undefined
            };

            setFacilities(prev => {
                const orig = editingFacilityOriginalCode || finalCode;
                const idx = prev.findIndex(f => f.code === orig);
                if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = updatedItem;
                    return next;
                }
                return [...prev, updatedItem];
            });

            toast.success(editingFacilityOriginalCode ? 'IPRESS actualizada correctamente' : 'IPRESS registrada correctamente'); 
            setIsFacilityModalOpen(false); 
            setEditingFacilityOriginalCode(null);
            await fetchData(true); 
        }
        else toast.error(res.message);
    };
    const handleDeleteFacility = async (code: string) => {
        const item = facilities.find(f => f.code === code);
        const name = item ? item.name : code;
        toast(`¿Eliminar IPRESS "${name}" (${code})?`, {
            description: "Esta acción no se puede deshacer.",
            action: {
                label: "Eliminar",
                onClick: async () => {
                    setFacilities(prev => prev.filter(f => f.code !== code));
                    const res = await api.deleteFacility(code);
                    if (res.success) { toast.success('IPRESS eliminada'); await fetchData(true); }
                    else { toast.error(res.message); await fetchData(true); }
                }
            }
        });
    };

    const getDiresaName = (id?: string) => diresas.find(d => d.id === id)?.name || id || '-';
    const getOgessName = (id?: string) => ogess.find(o => o.id === id)?.name || id || '-';
    const getUngetName = (id?: string) => ungets.find(u => u.id === id)?.name || id || '-';
    const getMicroredName = (id?: string) => microredes.find(m => m.id === id)?.name || id || '-';

    // Premium styling and explorer helpers
    const getCategoryStyle = (cat?: string) => {
        if (!cat) return 'bg-slate-50 text-slate-600 border border-slate-200';
        const c = cat.toUpperCase();
        if (c.startsWith('I-1') || c.startsWith('I-2')) return 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold';
        if (c.startsWith('I-3') || c.startsWith('I-4')) return 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold';
        if (c.startsWith('II-')) return 'bg-amber-50 text-amber-700 border border-amber-200 font-bold';
        return 'bg-violet-50 text-violet-700 border border-violet-200 font-bold';
    };

    const getTypeStyle = (type?: string) => {
        if (!type) return 'bg-slate-50 text-slate-500 border border-slate-200';
        const t = type.toUpperCase();
        if (t === 'HOSPITAL') return 'bg-rose-50 text-rose-700 border border-rose-200 font-extrabold';
        if (t === 'CENTRO') return 'bg-blue-50 text-blue-700 border border-blue-200 font-bold';
        if (t === 'PUESTO') return 'bg-teal-50 text-teal-700 border border-teal-200 font-bold';
        // El puesto comunal no es un establecimiento del mismo orden: es una farmacia de su
        // IPRESS, así que se distingue en vez de confundirse con el puesto de salud.
        if (t === 'PUESTO_COMUNAL') return 'bg-cyan-50 text-cyan-700 border border-cyan-200 font-bold';
        return 'bg-violet-50 text-violet-700 border border-violet-200 font-medium';
    };

    const handleCopyText = (text?: string, label?: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedField(label || text);
        toast.success(`${label || 'Dato'} copiado al portapapeles`);
        setTimeout(() => setCopiedField(null), 1500);
    };

    const getDetailHierarchyNodes = () => {
        if (!selectedDetailItem || !selectedDetailType) return [];
        
        let diresaName = '-';
        let ogessName = '-';
        let ungetVal = '-';
        let microredVal = '-';
        let ipressVal = '-';
        
        if (selectedDetailType === 'DIRESA') {
            diresaName = selectedDetailItem.name;
        } else if (selectedDetailType === 'OGESS') {
            diresaName = getDiresaName(selectedDetailItem.diresaId);
            ogessName = selectedDetailItem.name;
        } else if (selectedDetailType === 'UNGET') {
            diresaName = getDiresaName(selectedDetailItem.diresaId);
            ogessName = getOgessName(selectedDetailItem.ogessId);
            ungetVal = selectedDetailItem.name;
        } else if (selectedDetailType === 'MICRORED') {
            const selectedUnget = ungets.find(u => u.id === selectedDetailItem.ungetId);
            if (selectedUnget) {
                diresaName = getDiresaName(selectedUnget.diresaId);
                ogessName = getOgessName(selectedUnget.ogessId);
                ungetVal = selectedUnget.name;
            }
            microredVal = selectedDetailItem.name;
        } else if (selectedDetailType === 'IPRESS') {
            diresaName = getDiresaName(selectedDetailItem.diresaId);
            ogessName = getOgessName(selectedDetailItem.ogessId);
            ungetVal = getUngetName(selectedDetailItem.ungetId);
            microredVal = getMicroredName(selectedDetailItem.microredId);
            ipressVal = selectedDetailItem.name;
        }
        
        const arr = [
            { label: 'DIRESA', name: diresaName, isCurrent: selectedDetailType === 'DIRESA', isFilled: diresaName !== '-' },
            { label: 'OGESS', name: ogessName, isCurrent: selectedDetailType === 'OGESS', isFilled: ogessName !== '-' },
            { label: 'UNGET', name: ungetVal, isCurrent: selectedDetailType === 'UNGET', isFilled: ungetVal !== '-' },
            { label: 'MICRORED', name: microredVal, isCurrent: selectedDetailType === 'MICRORED', isFilled: microredVal !== '-' },
            { label: 'IPRESS', name: ipressVal, isCurrent: selectedDetailType === 'IPRESS', isFilled: ipressVal !== '-' }
        ];

        return arr.filter(n => n.isFilled);
    };

    const getRelatedStats = () => {
        if (!selectedDetailItem || !selectedDetailType) return null;
        const id = selectedDetailItem.id;
        
        if (selectedDetailType === 'DIRESA') {
            const ogessCount = ogess.filter(o => o.diresaId === id).length;
            const ungetCount = ungets.filter(u => u.diresaId === id || ogess.find(o => o.id === u.ogessId)?.diresaId === id).length;
            const ipressCount = facilities.filter(f => f.diresaId === id).length;
            return [
                { label: 'OGESS Dependientes', value: ogessCount },
                { label: 'UNGET Dependientes', value: ungetCount },
                { label: 'IPRESS Registradas', value: ipressCount }
            ];
        }
        if (selectedDetailType === 'OGESS') {
            const ungetCount = ungets.filter(u => u.ogessId === id).length;
            const ipressCount = facilities.filter(f => f.ogessId === id).length;
            return [
                { label: 'UNGET Dependientes', value: ungetCount },
                { label: 'IPRESS Registradas', value: ipressCount }
            ];
        }
        if (selectedDetailType === 'UNGET') {
            const microredCount = microredes.filter(m => m.ungetId === id).length;
            const ipressCount = facilities.filter(f => f.ungetId === id).length;
            return [
                { label: 'Microredes Dependientes', value: microredCount },
                { label: 'IPRESS Registradas', value: ipressCount }
            ];
        }
        if (selectedDetailType === 'MICRORED') {
            const ipressCount = facilities.filter(f => f.microredId === id).length;
            return [
                { label: 'IPRESS Registradas', value: ipressCount }
            ];
        }
        return null;
    };

    const countCurrentItems = (tabName: string) => {
        if (tabName === 'DIRESA') return finalFilteredDiresas.length;
        if (tabName === 'OGESS') return finalFilteredOgess.length;
        if (tabName === 'UNGET') return finalFilteredUngets.length;
        if (tabName === 'MICRORED') return finalFilteredMicroredes.length;
        if (tabName === 'IPRESS') return finalFilteredFacilities.length;
        return 0;
    };

    const handleOpenEdit = (tab: string, item: any, e: React.MouseEvent) => {
        e.stopPropagation();
        if (tab === 'DIRESA') { setDiresaForm(item); setDiresaModalStep(1); setIsDiresaModalOpen(true); }
        else if (tab === 'OGESS') { setOgessForm(item); setOgessModalStep(1); setIsOgessModalOpen(true); }
        else if (tab === 'UNGET') { setUngetForm(item); setUngetModalStep(1); setIsUngetModalOpen(true); }
        else if (tab === 'MICRORED') { setMicroredForm(item); setIsMicroredModalOpen(true); }
        else if (tab === 'IPRESS') { 
            setEditingFacilityOriginalCode(item.code || null);
            setFacilityForm({ ...item }); 
            setFacilityModalStep(1); 
            setIsFacilityModalOpen(true); 
            prepareFacilityStep4(item.code, item.name);
        }
    };

    const handleConfirmDelete = (tab: string, item: any, e: React.MouseEvent) => {
        e.stopPropagation();
        if (tab === 'DIRESA') handleDeleteDiresa(item.id);
        else if (tab === 'OGESS') handleDeleteOgess(item.id);
        else if (tab === 'UNGET') handleDeleteUnget(item.id);
        else if (tab === 'MICRORED') handleDeleteMicrored(item.id);
        else if (tab === 'IPRESS') handleDeleteFacility(item.code);
    };

    const popoverStyle = useMemo(() => {
        if (!activeFilterTriggerRect) return {};
        const width = 285;
        const spacing = 8;
        const triggerBottom = activeFilterTriggerRect.bottom + window.scrollY;
        const triggerLeft = activeFilterTriggerRect.left + window.scrollX;
        
        let top = triggerBottom + spacing;
        let left = triggerLeft;
        
        if (left + width > window.innerWidth - 16) {
            left = window.innerWidth - width - 16;
        }
        if (left < 16) left = 16;
        
        return {
            position: 'absolute' as const,
            top: `${top}px`,
            left: `${left}px`,
            width: `${width}px`,
            zIndex: 9999,
        };
    }, [activeFilterTriggerRect]);

    const filteredOptionsList = useMemo(() => {
        const resetOpt = activeFilterOptions.find(opt => opt.value === '');
        const otherOpts = activeFilterOptions.filter(opt => opt.value !== '');
        
        if (!headerFilterSearch) return activeFilterOptions;
        
        const q = headerFilterSearch.toLowerCase();
        const matched = otherOpts.filter(opt => 
            opt.label.toLowerCase().includes(q)
        );
        
        return resetOpt ? [resetOpt, ...matched] : matched;
    }, [activeFilterOptions, headerFilterSearch]);

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Visual Hierarchy Navigation Tabs (Premium Counts and Microanimations) */}
            <div className="bg-white/80 p-2 rounded-2xl border border-slate-200/80 shadow-sm backdrop-blur-md">
                <div className="flex gap-1.5 flex-wrap">
                    {availableTabs.length === 0 ? (
                        <div className="text-sm font-bold text-slate-500 py-2 px-4 flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-slate-400" />
                            No tiene accesos asignados a esta sección de la jurisdicción territorial.
                        </div>
                     ) : availableTabs.map(tab => {
                        const isActive = activeTab === tab;
                        const count = countCurrentItems(tab);
                        let icon = <Building2 className="h-4 w-4" />;
                        if (tab === 'DIRESA') icon = <ShieldCheck className="h-4 w-4" />;
                        if (tab === 'OGESS') icon = <Activity className="h-4 w-4" />;
                        if (tab === 'UNGET') icon = <Building2 className="h-4 w-4" />;
                        if (tab === 'MICRORED') icon = <Network className="h-4 w-4" />;
                        if (tab === 'IPRESS') icon = <MapPin className="h-4 w-4" />;

                        return (
                            <button 
                                key={tab}
                                onClick={() => {
                                    setActiveTab(tab as any);
                                    setSearchQuery('');
                                }}
                                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all duration-300 transform active:scale-95 cursor-pointer select-none ${
                                    isActive 
                                        ? 'bg-gradient-to-r from-teal-50 to-teal-100/50 text-teal-800 border-b-2 border-teal-600 shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                            >
                                {icon}
                                <span>{tab}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide transition-all ${
                                    isActive ? 'bg-teal-600 text-white shadow-sm' : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {count}
                                </span>
                            </button>
                        );
                     })}
                </div>
            </div>

            {availableTabs.length > 0 && (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden shadow-slate-100/50">
                    <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 bg-slate-50/40 backdrop-blur-sm">
                        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-1">
                            {/* Search bar */}
                            <div className="relative flex-1 max-w-md">
                                <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input 
                                    type="text"
                                    placeholder={`Buscar ${activeTab.toLowerCase()} por nombre o código...`}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10 pr-4 py-2.5 w-full border border-slate-200 rounded-xl text-sm bg-white font-medium text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all shadow-inner"
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 outline-none"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>

                            {/* Clear Filters Button (If any header filters are active) */}
                            {hasActiveFilters && (
                                <button 
                                    onClick={clearAllFilters}
                                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:shadow-sm transition duration-200 cursor-pointer select-none animate-in fade-in"
                                    title="Limpiar todos los filtros"
                                >
                                    <FilterX className="h-4 w-4 shrink-0 text-teal-600 animate-pulse" />
                                    <span>Limpiar Filtros</span>
                                    <span className="bg-teal-600 text-white font-black text-[9px] h-4 px-1 flex items-center justify-center rounded-full">
                                        Activos
                                    </span>
                                </button>
                            )}
                        </div>

                        {canAddActiveTab && (
                            <button 
                                onClick={() => {
                                    if (activeTab === 'DIRESA') { 
                                        setDiresaForm({}); 
                                        setDiresaModalStep(1);
                                        setIsDiresaModalOpen(true); 
                                    }
                                    if (activeTab === 'OGESS') { 
                                        const initialOgess: Partial<Ogess> = {};
                                        if (!isSuperAdmin && userDiresaId) {
                                            initialOgess.diresaId = userDiresaId;
                                            const sDiresa = diresas.find(d => d.id === userDiresaId);
                                            if (sDiresa) initialOgess.department = sDiresa.department || '';
                                        }
                                        setOgessForm(initialOgess); 
                                        setOgessModalStep(1);
                                        setIsOgessModalOpen(true); 
                                    }
                                    if (activeTab === 'UNGET') { 
                                        const initialUnget: Partial<Unget> = {};
                                        if (!isSuperAdmin) {
                                            if (userOgessId) {
                                                initialUnget.ogessId = userOgessId;
                                                const sOgess = ogess.find(o => o.id === userOgessId);
                                                if (sOgess) {
                                                    initialUnget.diresaId = sOgess.diresaId;
                                                    const sDiresa = diresas.find(d => d.id === sOgess.diresaId);
                                                    if (sDiresa) initialUnget.department = sDiresa.department || '';
                                                }
                                            } else if (userDiresaId) {
                                                initialUnget.diresaId = userDiresaId;
                                                const sDiresa = diresas.find(d => d.id === userDiresaId);
                                                if (sDiresa) initialUnget.department = sDiresa.department || '';
                                            }
                                        }
                                        setUngetForm(initialUnget); 
                                        setUngetModalStep(1);
                                        setIsUngetModalOpen(true); 
                                    }
                                    if (activeTab === 'MICRORED') { 
                                        const initialMicrored: Partial<Microred> = {};
                                        if (!isSuperAdmin && userUngetId) {
                                            initialMicrored.ungetId = userUngetId;
                                        }
                                        setMicroredForm(initialMicrored); 
                                        setIsMicroredModalOpen(true); 
                                    }
                                    if (activeTab === 'IPRESS') { 
                                        const initialFacility: Partial<HealthFacility> = {};
                                        if (!isSuperAdmin) {
                                            if (userUngetId) {
                                                initialFacility.ungetId = userUngetId;
                                                const selectedUnget = ungets.find(u => u.id === userUngetId);
                                                if (selectedUnget) {
                                                    let diresaIdToUse = selectedUnget.diresaId;
                                                    if (selectedUnget.ogessId) {
                                                        initialFacility.ogessId = selectedUnget.ogessId;
                                                        const selectedOgess = ogess.find(o => o.id === selectedUnget.ogessId);
                                                        if (selectedOgess) {
                                                            initialFacility.diresaId = selectedOgess.diresaId;
                                                            diresaIdToUse = selectedOgess.diresaId;
                                                        }
                                                    } else if (selectedUnget.diresaId) {
                                                        initialFacility.diresaId = selectedUnget.diresaId;
                                                    }
                                                    if (diresaIdToUse) {
                                                        const selectedDiresa = diresas.find(d => d.id === diresaIdToUse);
                                                        if (selectedDiresa) {
                                                            initialFacility.department = selectedDiresa.department || '';
                                                        }
                                                    }
                                                }
                                            } else if (userOgessId) {
                                                initialFacility.ogessId = userOgessId;
                                                const selectedOgess = ogess.find(o => o.id === userOgessId);
                                                if (selectedOgess) {
                                                    initialFacility.diresaId = selectedOgess.diresaId;
                                                    if (selectedOgess.diresaId) {
                                                        const selectedDiresa = diresas.find(d => d.id === selectedOgess.diresaId);
                                                        if (selectedDiresa) {
                                                            initialFacility.department = selectedDiresa.department || '';
                                                        }
                                                    }
                                                }
                                            } else if (userDiresaId) {
                                                initialFacility.diresaId = userDiresaId;
                                                const selectedDiresa = diresas.find(d => d.id === userDiresaId);
                                                if (selectedDiresa) {
                                                    initialFacility.department = selectedDiresa.department || '';
                                                }
                                            }
                                        }
                                        setEditingFacilityOriginalCode(null);
                                        setFacilityForm(initialFacility); 
                                        setFacilityModalStep(1);
                                        prepareFacilityStep4("", "");
                                        setIsFacilityModalOpen(true); 
                                    }
                                }}
                                className="flex items-center justify-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-teal-100 hover:shadow-teal-200 transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0 duration-200"
                            >
                                <Plus className="h-4 w-3.5 stroke-[3px]" /> Agregar {activeTab}
                            </button>
                        )}
                    </div>

                    {/* Interactive Registry tables & list representations */}
                    <div className="w-full">
                        {/* Empty state conditional */}
                        {((activeTab === 'DIRESA' && finalFilteredDiresas.length === 0) ||
                          (activeTab === 'OGESS' && finalFilteredOgess.length === 0) ||
                          (activeTab === 'UNGET' && finalFilteredUngets.length === 0) ||
                          (activeTab === 'MICRORED' && finalFilteredMicroredes.length === 0) ||
                          (activeTab === 'IPRESS' && finalFilteredFacilities.length === 0)) ? (
                            <div className="text-center py-16 px-4 space-y-4">
                                <div className="h-16 w-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                                    <Info className="h-8 w-8" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="font-extrabold text-slate-800 text-lg">No se encontraron resultados</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto">Prueba modulando tus filtros o cambiando tu búsqueda de texto para encontrar el registro deseado.</p>
                                </div>
                                {hasActiveFilters && (
                                    <button 
                                        onClick={clearAllFilters}
                                        className="px-4 py-2 bg-teal-50 text-teal-700 hover:bg-teal-100 text-xs font-bold rounded-xl border border-teal-200 transition"
                                    >
                                        Restaurar filtros de búsqueda
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                {/* 1. DIRESA Tab views */}
                                {activeTab === 'DIRESA' && (
                                    <>
                                        {/* Desktop Premium Table */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider">
                                                        <th className="p-4 px-6">DIRESA</th>
                                                        <th className="p-4">RUC</th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Distrito", filterDistrict, filterOptions.districts, setFilterDistrict, "diresa-district")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Provincia", filterProvince, filterOptions.provinces, setFilterProvince, "diresa-province")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Departamento", filterDepartment, filterOptions.departments, setFilterDepartment, "diresa-department")}
                                                        </th>
                                                        <th className="p-4 text-right pr-6">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {finalFilteredDiresas.map(d => (
                                                        <tr 
                                                            key={d.id} 
                                                            onClick={() => { setSelectedDetailItem(d); setSelectedDetailType('DIRESA'); }}
                                                            className="hover:bg-slate-50/60 cursor-pointer transition group"
                                                        >
                                                            <td className="p-4 px-6 font-extrabold text-slate-800 group-hover:text-teal-700 transition flex items-center gap-2">
                                                                <div className="w-1.5 h-6 bg-teal-500/0 group-hover:bg-teal-500 rounded-sm -ml-2.5 transition-all duration-300" />
                                                                <ShieldCheck className="h-4 w-4 text-slate-400 group-hover:text-teal-600 transition" />
                                                                <span>{d.name}</span>
                                                            </td>
                                                            <td className="p-4 font-mono text-xs font-semibold text-slate-600">{d.ruc || '-'}</td>
                                                            <td className="p-4 text-slate-600 font-medium">{d.district || '-'}</td>
                                                            <td className="p-4 text-slate-600 font-medium">{d.province || '-'}</td>
                                                            <td className="p-4 text-slate-600 font-medium">{d.department || '-'}</td>
                                                            <td className="p-4 flex gap-2 justify-end pr-6">
                                                                <button 
                                                                    onClick={(e) => handleOpenEdit('DIRESA', d, e)} 
                                                                    className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                >
                                                                    <Edit className="h-3.5 w-3.5" />
                                                                </button>
                                                                {isSuperAdmin && (
                                                                    <button 
                                                                        onClick={(e) => handleConfirmDelete('DIRESA', d, e)} 
                                                                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Responsive List-Grid */}
                                        <div className="md:hidden divide-y divide-slate-100">
                                            {finalFilteredDiresas.map(d => (
                                                <div 
                                                    key={d.id} 
                                                    onClick={() => { setSelectedDetailItem(d); setSelectedDetailType('DIRESA'); }}
                                                    className="p-4 hover:bg-slate-50/40 cursor-pointer active:bg-slate-100 transition relative flex flex-col gap-2 group"
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="space-y-0.5">
                                                            <h4 className="font-extrabold text-slate-900 group-hover:text-teal-700 transition flex items-center gap-1.5 leading-snug">
                                                                <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" />
                                                                <span>{d.name}</span>
                                                            </h4>
                                                            <div className="text-[10px] font-mono text-slate-400">RUC: {d.ruc || '-'}</div>
                                                        </div>
                                                        
                                                        {/* Actions inline */}
                                                        <div className="flex gap-1.5 shrink-0">
                                                            <button 
                                                                onClick={(e) => handleOpenEdit('DIRESA', d, e)} 
                                                                className="p-2.5 text-slate-400 hover:text-teal-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                            >
                                                                <Edit className="h-3.5 w-3.5" />
                                                            </button>
                                                            {isSuperAdmin && (
                                                                <button 
                                                                    onClick={(e) => handleConfirmDelete('DIRESA', d, e)} 
                                                                    className="p-2.5 text-slate-400 hover:text-rose-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500 font-bold text-[11px] pt-1">
                                                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-350" /> {d.district}</div>
                                                        <div className="text-slate-300">•</div>
                                                        <div>Dep: {d.department}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                                
                                {/* 2. OGESS Tab views */}
                                {activeTab === 'OGESS' && (
                                    <>
                                        {/* Desktop Premium Table */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider">
                                                        <th className="p-4 px-6">OGESS</th>
                                                        <th className="p-4">Código / RUC</th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Distrito", filterDistrict, filterOptions.districts, setFilterDistrict, "ogess-district")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Provincia", filterProvince, filterOptions.provinces, setFilterProvince, "ogess-province")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("DIRESA", filterDiresaId, [{ value: '', label: 'Todas las DIRESA' }, ...diresas.map(d => ({ value: d.id, label: d.name }))], setFilterDiresaId, "ogess-diresa")}
                                                        </th>
                                                        <th className="p-4 text-right pr-6">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {finalFilteredOgess.map(o => (
                                                        <tr 
                                                            key={o.id} 
                                                            onClick={() => { setSelectedDetailItem(o); setSelectedDetailType('OGESS'); }}
                                                            className="hover:bg-slate-50/60 cursor-pointer transition group"
                                                        >
                                                            <td className="p-4 px-6 font-extrabold text-slate-800 group-hover:text-teal-700 transition flex items-center gap-2">
                                                                <div className="w-1.5 h-6 bg-teal-500/0 group-hover:bg-teal-500 rounded-sm -ml-2.5 transition-all duration-300" />
                                                                <Activity className="h-4 w-4 text-slate-400 group-hover:text-teal-600 transition animate-pulse" />
                                                                <span>{o.name}</span>
                                                            </td>
                                                            <td className="p-4 font-mono text-xs text-slate-600 font-semibold">{o.code || '-'} / {o.ruc || '-'}</td>
                                                            <td className="p-4 text-slate-600 font-medium">{o.district || '-'}</td>
                                                            <td className="p-4 text-slate-600 font-medium">{o.province || '-'}</td>
                                                            <td className="p-4">
                                                                <span className="bg-teal-50 text-teal-800 px-2 py-0.5 rounded-lg text-xs font-bold border border-teal-100">{getDiresaName(o.diresaId)}</span>
                                                            </td>
                                                            <td className="p-4 flex gap-2 justify-end pr-6">
                                                                <button 
                                                                    onClick={(e) => handleOpenEdit('OGESS', o, e)} 
                                                                    className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                >
                                                                    <Edit className="h-3.5 w-3.5" />
                                                                </button>
                                                                {isSuperAdmin && (
                                                                    <button 
                                                                        onClick={(e) => handleConfirmDelete('OGESS', o, e)} 
                                                                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Responsive List-Grid */}
                                        <div className="md:hidden divide-y divide-slate-100">
                                            {finalFilteredOgess.map(o => (
                                                <div 
                                                    key={o.id} 
                                                    onClick={() => { setSelectedDetailItem(o); setSelectedDetailType('OGESS'); }}
                                                    className="p-4 hover:bg-slate-50/40 cursor-pointer active:bg-slate-100 transition relative flex flex-col gap-2 group"
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="space-y-0.5">
                                                            <h4 className="font-extrabold text-slate-900 group-hover:text-teal-700 transition flex items-center gap-1.5 leading-snug">
                                                                <Activity className="h-4 w-4 text-teal-600" />
                                                                <span>{o.name}</span>
                                                            </h4>
                                                            <div className="text-[10px] font-mono text-slate-400">Cod: {o.code || '-'} • RUC: {o.ruc || '-'}</div>
                                                        </div>
                                                        
                                                        <div className="flex gap-1.5 shrink-0">
                                                            <button 
                                                                onClick={(e) => handleOpenEdit('OGESS', o, e)} 
                                                                className="p-2.5 text-slate-400 hover:text-teal-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                            >
                                                                <Edit className="h-3.5 w-3.5" />
                                                            </button>
                                                            {isSuperAdmin && (
                                                                <button 
                                                                    onClick={(e) => handleConfirmDelete('OGESS', o, e)} 
                                                                    className="p-2.5 text-slate-400 hover:text-rose-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-0.5 text-slate-500 text-[11px] pt-1">
                                                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" /> {o.district}, {o.province}</div>
                                                        <div className="mt-1"><span className="bg-teal-50 border border-teal-100 text-[10px] text-teal-800 font-extrabold px-1.5 py-0.5 rounded-md">DIRESA: {getDiresaName(o.diresaId)}</span></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {/* 3. UNGET Tab views */}
                                {activeTab === 'UNGET' && (
                                    <>
                                        {/* Desktop Premium Table */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider">
                                                        <th className="p-4 px-6">UNGET</th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Distrito", filterDistrict, filterOptions.districts, setFilterDistrict, "unget-district")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Provincia", filterProvince, filterOptions.provinces, setFilterProvince, "unget-province")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("OGESS", filterOgessId, [{ value: '', label: 'Todas las OGESS' }, ...ogess.filter(o => !filterDiresaId || o.diresaId === filterDiresaId).map(o => ({ value: o.id, label: o.name }))], (val) => {
                                                                setFilterOgessId(val);
                                                                setFilterUngetId('');
                                                            }, "unget-ogess")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("DIRESA", filterDiresaId, [{ value: '', label: 'Todas las DIRESA' }, ...diresas.map(d => ({ value: d.id, label: d.name }))], (val) => {
                                                                setFilterDiresaId(val);
                                                                setFilterOgessId('');
                                                                setFilterUngetId('');
                                                            }, "unget-diresa")}
                                                        </th>
                                                        <th className="p-4">Conexión</th>
                                                        <th className="p-4 text-right pr-6">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {finalFilteredUngets.map(u => (
                                                        <tr 
                                                            key={u.id} 
                                                            onClick={() => { setSelectedDetailItem(u); setSelectedDetailType('UNGET'); }}
                                                            className="hover:bg-slate-50/60 cursor-pointer transition group"
                                                        >
                                                            <td className="p-4 px-6 font-extrabold text-slate-800 group-hover:text-teal-700 transition flex items-center gap-2">
                                                                <div className="w-1.5 h-6 bg-teal-500/0 group-hover:bg-teal-500 rounded-sm -ml-2.5 transition-all duration-300" />
                                                                <Building2 className="h-4 w-4 text-slate-400 group-hover:text-teal-600 transition" />
                                                                <span>{u.name}</span>
                                                            </td>
                                                            <td className="p-4 text-slate-600 font-medium">{u.district || '-'}</td>
                                                            <td className="p-4 text-slate-600 font-medium">{u.province || '-'}</td>
                                                            <td className="p-4 text-slate-700 font-semibold">{getOgessName(u.ogessId)}</td>
                                                            <td className="p-4">
                                                                <span className="bg-teal-50 text-teal-800 px-2 py-0.5 rounded-lg text-xs font-bold border border-teal-100">{getDiresaName(u.diresaId)}</span>
                                                            </td>
                                                            <td className="p-4">
                                                                {(() => {
                                                                    const ui = getConnectionUi(u.id);
                                                                    return (
                                                                        <span
                                                                            title={ui.hint}
                                                                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-bold border whitespace-nowrap ${ui.chip}`}
                                                                        >
                                                                            <ui.Icon className="h-3 w-3 shrink-0" />
                                                                            {ui.label}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="p-4 flex gap-2 justify-end pr-6">
                                                                <button 
                                                                    onClick={(e) => handleOpenEdit('UNGET', u, e)} 
                                                                    className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                >
                                                                    <Edit className="h-3.5 w-3.5" />
                                                                </button>
                                                                {isSuperAdmin && (
                                                                    <button 
                                                                        onClick={(e) => handleConfirmDelete('UNGET', u, e)} 
                                                                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Responsive List-Grid */}
                                        <div className="md:hidden divide-y divide-slate-100">
                                            {finalFilteredUngets.map(u => (
                                                <div 
                                                    key={u.id} 
                                                    onClick={() => { setSelectedDetailItem(u); setSelectedDetailType('UNGET'); }}
                                                    className="p-4 hover:bg-slate-50/40 cursor-pointer active:bg-slate-100 transition relative flex flex-col gap-2 group"
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="space-y-0.5">
                                                            <h4 className="font-extrabold text-slate-900 group-hover:text-teal-700 transition flex items-center gap-1.5 leading-snug">
                                                                <Building2 className="h-4 w-4 text-slate-400" />
                                                                <span>{u.name}</span>
                                                            </h4>
                                                        </div>
                                                        
                                                        <div className="flex gap-1.5 shrink-0">
                                                            <button 
                                                                onClick={(e) => handleOpenEdit('UNGET', u, e)} 
                                                                className="p-2.5 text-slate-400 hover:text-teal-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                            >
                                                                <Edit className="h-3.5 w-3.5" />
                                                            </button>
                                                            {isSuperAdmin && (
                                                                <button 
                                                                    onClick={(e) => handleConfirmDelete('UNGET', u, e)} 
                                                                    className="p-2.5 text-slate-400 hover:text-rose-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-1 text-slate-500 text-[11px] pt-1">
                                                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" /> {u.district}, {u.province}</div>
                                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                                            <span className="bg-slate-100 text-slate-700 font-extrabold px-1.5 py-0.5 rounded text-[9px]">OGESS: {getOgessName(u.ogessId)}</span>
                                                            <span className="bg-teal-50 border border-teal-100 text-teal-800 font-extrabold px-1.5 py-0.5 rounded text-[9px]">DIRESA: {getDiresaName(u.diresaId)}</span>
                                                            {(() => {
                                                                const ui = getConnectionUi(u.id);
                                                                return (
                                                                    <span className={`inline-flex items-center gap-1 border font-extrabold px-1.5 py-0.5 rounded text-[9px] ${ui.chip}`}>
                                                                        <ui.Icon className="h-2.5 w-2.5 shrink-0" />
                                                                        {ui.label}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {/* 4. MICRORED Tab views */}
                                {activeTab === 'MICRORED' && (
                                    <>
                                        {/* Desktop Premium Table */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider">
                                                        <th className="p-4 px-6">Microred</th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("UNGET", filterUngetId, [{ value: '', label: 'Todas las UNGET' }, ...ungets.filter(u => !filterOgessId || u.ogessId === filterOgessId).map(u => ({ value: u.id, label: u.name }))], setFilterUngetId, "microred-unget")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("OGESS", filterOgessId, [{ value: '', label: 'Todas las OGESS' }, ...ogess.filter(o => !filterDiresaId || o.diresaId === filterDiresaId).map(o => ({ value: o.id, label: o.name }))], (val) => {
                                                                setFilterOgessId(val);
                                                                setFilterUngetId('');
                                                            }, "microred-ogess")}
                                                        </th>
                                                        <th className="p-4 text-right pr-6">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {finalFilteredMicroredes.map(m => {
                                                        const pUnget = ungets.find(u => u.id === m.ungetId);
                                                        return (
                                                            <tr 
                                                                key={m.id} 
                                                                onClick={() => { setSelectedDetailItem(m); setSelectedDetailType('MICRORED'); }}
                                                                className="hover:bg-slate-50/60 cursor-pointer transition group"
                                                            >
                                                                <td className="p-4 px-6 font-extrabold text-slate-800 group-hover:text-teal-700 transition flex items-center gap-2">
                                                                    <div className="w-1.5 h-6 bg-teal-500/0 group-hover:bg-teal-500 rounded-sm -ml-2.5 transition-all duration-300" />
                                                                    <Network className="h-4 w-4 text-slate-400 group-hover:text-teal-600 transition" />
                                                                    <span>{m.name}</span>
                                                                </td>
                                                                <td className="p-4 text-slate-700 font-semibold">{getUngetName(m.ungetId)}</td>
                                                                <td className="p-4">
                                                                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg text-xs font-bold">{pUnget ? getOgessName(pUnget.ogessId) : '-'}</span>
                                                                </td>
                                                                <td className="p-4 flex gap-2 justify-end pr-6">
                                                                    <button 
                                                                        onClick={(e) => handleOpenEdit('MICRORED', m, e)} 
                                                                        className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                    >
                                                                        <Edit className="h-3.5 w-3.5" />
                                                                    </button>
                                                                    {isSuperAdmin && (
                                                                        <button 
                                                                            onClick={(e) => handleConfirmDelete('MICRORED', m, e)} 
                                                                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Responsive List-Grid */}
                                        <div className="md:hidden divide-y divide-slate-100">
                                            {finalFilteredMicroredes.map(m => {
                                                const pUnget = ungets.find(u => u.id === m.ungetId);
                                                return (
                                                    <div 
                                                        key={m.id} 
                                                        onClick={() => { setSelectedDetailItem(m); setSelectedDetailType('MICRORED'); }}
                                                        className="p-4 hover:bg-slate-50/40 cursor-pointer active:bg-slate-100 transition relative flex flex-col gap-2 group"
                                                    >
                                                        <div className="flex justify-between items-start gap-4">
                                                            <div className="space-y-0.5">
                                                                    <h4 className="font-extrabold text-slate-900 group-hover:text-teal-700 transition flex items-center gap-1.5 leading-snug">
                                                                    <Network className="h-4 w-4 text-emerald-600" />
                                                                    <span>{m.name}</span>
                                                                </h4>
                                                            </div>
                                                            
                                                            <div className="flex gap-1.5 shrink-0">
                                                                <button 
                                                                    onClick={(e) => handleOpenEdit('MICRORED', m, e)} 
                                                                    className="p-2.5 text-slate-400 hover:text-teal-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                                >
                                                                    <Edit className="h-3.5 w-3.5" />
                                                                </button>
                                                                {isSuperAdmin && (
                                                                    <button 
                                                                        onClick={(e) => handleConfirmDelete('MICRORED', m, e)} 
                                                                        className="p-2.5 text-slate-400 hover:text-rose-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="flex flex-col gap-1 text-slate-500 text-[11px] pt-1">
                                                            <div><span className="font-bold text-slate-400">UNGET:</span> {getUngetName(m.ungetId)}</div>
                                                            {pUnget && (
                                                                <div><span className="bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded text-[9px]">OGESS: {getOgessName(pUnget.ogessId)}</span></div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}

                                {/* 5. IPRESS Tab views */}
                                {activeTab === 'IPRESS' && (
                                    <>
                                        {/* Desktop Premium Table */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider">
                                                        <th className="p-4 px-6">Establecimiento de Salud</th>
                                                        <th className="p-4">Código IPRESS</th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Categoría", filterCategory, [{ value: '', label: 'Todas' }, ...['I-1', 'I-2', 'I-3', 'I-4', 'II-1', 'II-2', 'III-1'].map(cat => ({ value: cat, label: cat }))], setFilterCategory, "ipress-category")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Tipo", filterType, [
                                                                { value: '', label: 'Todos' },
                                                                ...FACILITY_TYPES.map(t => ({ value: t.value, label: t.label }))
                                                            ], setFilterType, "ipress-type")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("Microred", filterMicroredId, [{ value: '', label: 'Todas' }, ...microredes.filter(m => !filterUngetId || m.ungetId === filterUngetId).map(m => ({ value: m.id, label: m.name }))], setFilterMicroredId, "ipress-microred")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("UNGET", filterUngetId, [{ value: '', label: 'Todas' }, ...ungets.filter(u => !filterOgessId || u.ogessId === filterOgessId).map(u => ({ value: u.id, label: u.name }))], (val) => {
                                                                setFilterUngetId(val);
                                                                setFilterMicroredId('');
                                                            }, "ipress-unget")}
                                                        </th>
                                                        <th className="p-4">
                                                            {renderHeaderFilter("OGESS", filterOgessId, [{ value: '', label: 'Todas' }, ...ogess.filter(o => !filterDiresaId || o.diresaId === filterDiresaId).map(o => ({ value: o.id, label: o.name }))], (val) => {
                                                                setFilterOgessId(val);
                                                                setFilterUngetId('');
                                                                setFilterMicroredId('');
                                                            }, "ipress-ogess")}
                                                        </th>
                                                        <th className="p-4 text-right pr-6">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {finalFilteredFacilities.map(f => (
                                                        <tr 
                                                            key={f.code} 
                                                            onClick={() => { setSelectedDetailItem(f); setSelectedDetailType('IPRESS'); }}
                                                            className="hover:bg-slate-50/60 cursor-pointer transition group"
                                                        >
                                                            <td className="p-4 px-6 font-extrabold text-slate-800 group-hover:text-teal-700 transition flex items-center gap-2">
                                                                <div className="w-1.5 h-6 bg-teal-500/0 group-hover:bg-teal-500 rounded-sm -ml-2.5 transition-all duration-300" />
                                                                <MapPin className="h-4 w-4 text-slate-400 group-hover:text-teal-600 transition" />
                                                                <span>{f.name}</span>
                                                            </td>
                                                            <td className="p-4 font-mono font-bold text-xs text-slate-600">
                                                                <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{f.code}</span>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-black tracking-wide border ${getCategoryStyle(f.category)}`}>
                                                                    {f.category || '-'}
                                                                </span>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className={`px-2 py-0.5 rounded-lg text-[10px] uppercase border ${getTypeStyle(f.type)}`}>
                                                                    {facilityTypeLabel(f.type) || '-'}
                                                                </span>
                                                            </td>
                                                            <td className="p-4 text-slate-600 font-semibold">{getMicroredName(f.microredId)}</td>
                                                            <td className="p-4 text-slate-600 font-semibold">{getUngetName(f.ungetId)}</td>
                                                            <td className="p-4 text-slate-500 font-medium">{getOgessName(f.ogessId)}</td>
                                                            <td className="p-4 flex gap-2 justify-end pr-6">
                                                                <button 
                                                                    onClick={(e) => handleOpenEdit('IPRESS', f, e)} 
                                                                    className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                >
                                                                    <Edit className="h-3.5 w-3.5" />
                                                                </button>
                                                                {isSuperAdmin && (
                                                                    <button 
                                                                        onClick={(e) => handleConfirmDelete('IPRESS', f, e)} 
                                                                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-100 rounded-xl shadow-sm transition cursor-pointer"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Responsive List-Grid */}
                                        <div className="md:hidden divide-y divide-slate-100">
                                            {finalFilteredFacilities.map(f => (
                                                <div 
                                                    key={f.code} 
                                                    onClick={() => { setSelectedDetailItem(f); setSelectedDetailType('IPRESS'); }}
                                                    className="p-4 hover:bg-slate-50/40 cursor-pointer active:bg-slate-100 transition relative flex flex-col gap-2.5 group"
                                                >
                                                    <div className="flex justify-between items-start gap-4">
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="font-mono text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">{f.code}</span>
                                                                <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold border ${getCategoryStyle(f.category)}`}>{f.category || '-'}</span>
                                                            </div>
                                                            <h4 className="font-extrabold text-slate-900 group-hover:text-teal-700 transition leading-snug">{f.name}</h4>
                                                        </div>
                                                        
                                                        <div className="flex gap-1.5 shrink-0">
                                                            <button 
                                                                onClick={(e) => handleOpenEdit('IPRESS', f, e)} 
                                                                className="p-2.5 text-slate-400 hover:text-teal-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                            >
                                                                <Edit className="h-3.5 w-3.5" />
                                                            </button>
                                                            {isSuperAdmin && (
                                                                <button 
                                                                    onClick={(e) => handleConfirmDelete('IPRESS', f, e)} 
                                                                    className="p-2.5 text-slate-400 hover:text-rose-600 border border-slate-100 rounded-xl bg-slate-50 shadow-sm"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-1 text-[11px] text-slate-500 pt-0.5 border-t border-slate-50">
                                                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-405" /> {f.district || '-'}, {f.province || '-'}</div>
                                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                                            {f.microredId && <span className="bg-emerald-50/60 border border-emerald-100/50 text-emerald-800 px-1.5 py-0.5 rounded text-[9px] font-black">Microred: {getMicroredName(f.microredId)}</span>}
                                                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-medium">UNGET: {getUngetName(f.ungetId)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Interactive Registry Detail Explorer Modal (Stunning Sidebar/Card Bento Explorer Sheet) */}
            {selectedDetailItem && selectedDetailType && createPortal(
                <div 
                    className="fixed inset-0 z-[300000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => { setSelectedDetailItem(null); setSelectedDetailType(null); }}
                >
                    <div 
                        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl flex flex-col md:flex-row max-h-[90vh] md:max-h-[85vh] overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* LEFT COLUMN: Visual Path & Stats (Dark Gradient) */}
                        <div className="w-full md:w-80 bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950 p-6 text-white flex flex-col gap-6 shrink-0 overflow-y-auto">
                            <div className="space-y-1">
                                <span className="bg-teal-500/10 text-teal-300 border border-teal-500/20 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full inline-block">
                                    Expediente Técnico
                                </span>
                                <h3 className="font-extrabold text-lg text-white leading-tight">Mapa de Jurisdicción</h3>
                                <p className="text-[10px] text-slate-400 mt-1">Estructura organizacional y dependencia jerárquica del nodo seleccionado.</p>
                            </div>

                            {/* Connected Nodes Path */}
                            <div className="relative pl-4 space-y-5 flex-1 pr-1 py-1">
                                {/* Connector Line */}
                                <div className="absolute left-[21px] top-6 bottom-6 w-0.5 bg-slate-700/60" />
                                
                                {getDetailHierarchyNodes().map((node, index) => (
                                    <div key={index} className="relative flex items-start gap-4">
                                        <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center z-10 size-3.5 shrink-0 transition-all ${
                                            node.isCurrent 
                                                ? 'bg-teal-400 border-teal-400 shadow-lg shadow-teal-500/50 scale-125' 
                                                : 'bg-slate-900 border-slate-600'
                                        }`}>
                                            <div className={`h-1 w-1 rounded-full ${node.isCurrent ? 'bg-slate-900' : 'bg-slate-550'}`} />
                                        </div>
                                        <div className="space-y-0.5">
                                            <span className="block text-[8px] uppercase tracking-widest font-black text-slate-400 leading-none">{node.label}</span>
                                            <span className={`block text-xs font-bold leading-tight ${node.isCurrent ? 'text-teal-400' : 'text-slate-200'}`}>{node.name}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Dependent stats (if available) */}
                            {getRelatedStats() && (
                                <div className="space-y-2 border-t border-slate-800 pt-4 bg-slate-900/30 p-4 rounded-2xl">
                                    <h4 className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <Activity className="h-3 w-3 text-teal-400" /> Estadísticas de Red
                                    </h4>
                                    <div className="divide-y divide-slate-800">
                                        {getRelatedStats()?.map((stat, i) => (
                                            <div key={i} className="py-2 flex justify-between items-center text-xs font-bold">
                                                <span className="text-slate-400 text-[11px]">{stat.label}</span>
                                                <span className="bg-teal-500/10 text-teal-300 font-black px-2 py-0.5 rounded-lg text-[10px]">{stat.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Estado de la conexión de stock: solo la UNGET tiene una. */}
                            {selectedDetailType === 'UNGET' && (() => {
                                // Sin el estado leído no se afirma nada: `getConnectionUi` ya lo dice,
                                // y quien la mantiene se deja en blanco en vez de inventarlo.
                                const estado = connectionsStatus === 'ready'
                                    ? connectionByUnget.get(String(selectedDetailItem.id || ''))
                                    : undefined;
                                const ui = getConnectionUi(selectedDetailItem.id);
                                return (
                                    <div className="space-y-2 border-t border-slate-800 pt-4 bg-slate-900/30 p-4 rounded-2xl">
                                        <h4 className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                            <FileSpreadsheet className="h-3 w-3 text-teal-400" /> Conexión de Stock
                                        </h4>
                                        <div className="divide-y divide-slate-800">
                                            <div className="py-2 flex justify-between items-center gap-2 text-xs font-bold">
                                                <span className="text-slate-400 text-[11px]">Estado</span>
                                                <span className={`inline-flex items-center gap-1 border font-black px-2 py-0.5 rounded-lg text-[10px] ${ui.dark}`}>
                                                    <ui.Icon className="h-3 w-3 shrink-0" />
                                                    {ui.label}
                                                </span>
                                            </div>
                                            <div className="py-2 flex justify-between items-center gap-2 text-xs font-bold">
                                                <span className="text-slate-400 text-[11px]">La mantiene</span>
                                                <span className="text-slate-300 font-mono font-black text-[10px]">{estado?.maintainer || '—'}</span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-400 leading-snug pt-1">{ui.hint}</p>
                                        {canReachStockConnections && (
                                            <button
                                                onClick={goToStockConnections}
                                                className="w-full mt-1 flex items-center justify-center gap-1.5 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/20 font-black uppercase tracking-wider text-[10px] px-3 py-2 rounded-xl transition cursor-pointer"
                                            >
                                                <Settings2 className="h-3 w-3" />
                                                Configurar conexión
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Tags section in left column */}
                            <div className="space-y-2 border-t border-slate-800 pt-4 mt-auto bg-slate-900/30 p-4 rounded-2xl">
                                <h4 className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                    <Hash className="h-3 w-3 text-teal-400" /> Clasificación
                                </h4>
                                <div className="divide-y divide-slate-800">
                                    {(!['DIRESA', 'UNGET', 'MICRORED'].includes(selectedDetailType) && selectedDetailItem.code) ? (
                                        <div className="py-2 flex justify-between items-center text-xs font-bold">
                                            <span className="text-slate-400 text-[11px]">Código</span>
                                            <span className="bg-slate-800 text-slate-300 font-mono font-black px-2 py-0.5 rounded-lg text-[10px] flex items-center gap-1">
                                                <Hash className="h-3 w-3" /> {selectedDetailItem.code}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="py-2 flex justify-between items-center text-xs font-bold">
                                            <span className="text-slate-400 text-[11px]">Código</span>
                                            <span className="text-slate-500 font-mono font-medium text-[10px]">No especificado</span>
                                        </div>
                                    )}
                                    {selectedDetailItem.category && (
                                        <div className="py-2 flex justify-between items-center text-xs font-bold">
                                            <span className="text-slate-400 text-[11px]">Categoría</span>
                                            <span className="bg-teal-500/10 text-teal-300 font-black px-2 py-0.5 rounded-lg text-[10px]">{selectedDetailItem.category}</span>
                                        </div>
                                    )}
                                    {selectedDetailItem.type && (
                                        <div className="py-2 flex justify-between items-center text-xs font-bold">
                                            <span className="text-slate-400 text-[11px]">Tipo</span>
                                            <span className="bg-slate-800 text-slate-300 font-black px-2 py-0.5 rounded-lg text-[10px]">{facilityTypeLabel(selectedDetailItem.type)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Bento-grid Registry Explorer Data */}
                        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">
                            {/* Card Header area */}
                            <div className="p-6 pb-4 border-b border-slate-100 flex justify-between items-center bg-white min-h-[80px]">
                                <div className="space-y-1">
                                    <h2 className="font-extrabold text-xl text-slate-900 leading-snug flex items-center gap-2">
                                        {selectedDetailType === 'DIRESA' && <ShieldCheck className="h-5 w-5 text-teal-600 shrink-0" />}
                                        {selectedDetailType === 'OGESS' && <Activity className="h-5 w-5 text-teal-600 shrink-0" />}
                                        {selectedDetailType === 'UNGET' && <Building2 className="h-5 w-5 text-teal-600 shrink-0" />}
                                        {selectedDetailType === 'MICRORED' && <Network className="h-5 w-5 text-teal-600 shrink-0" />}
                                        {selectedDetailType === 'IPRESS' && <MapPin className="h-5 w-5 text-teal-600 shrink-0" />}
                                        <span>{selectedDetailItem.name}</span>
                                    </h2>
                                </div>
                                <button 
                                    onClick={() => { setSelectedDetailItem(null); setSelectedDetailType(null); }}
                                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            {/* Scrollable grid details explorer */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                {/* Subsection 1: Identificación e Inspección */}
                                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                        <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Registro de Enlace
                                    </h4>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* RENIPRESS / ID row */}
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group relative">
                                            <div>
                                                <span className="block text-[10px] font-black uppercase text-slate-400 mb-0.5">
                                                    {selectedDetailType === 'IPRESS' ? 'Código RENIPRESS' : 'Código Ejecutora'}
                                                </span>
                                                {['DIRESA', 'UNGET', 'MICRORED'].includes(selectedDetailType) ? (
                                                    <code className="text-xs font-mono font-bold text-slate-500">
                                                        No especificado
                                                    </code>
                                                ) : (
                                                    <code className="text-xs font-mono font-bold text-slate-800">
                                                        {selectedDetailItem.code || 'No especificado'}
                                                    </code>
                                                )}
                                            </div>
                                            {(!['DIRESA', 'UNGET', 'MICRORED'].includes(selectedDetailType) && selectedDetailItem.code) && (
                                                <button 
                                                    onClick={() => handleCopyText(selectedDetailItem.code, selectedDetailType === 'IPRESS' ? 'Código RENIPRESS' : 'Código Ejecutora')}
                                                    className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-white rounded-lg border border-transparent hover:border-slate-150 transition cursor-pointer"
                                                >
                                                    {copiedField === selectedDetailItem.code ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                                </button>
                                            )}
                                        </div>

                                        {/* RUC Row */}
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group relative">
                                            <div>
                                                <span className="block text-[10px] font-black uppercase text-slate-400 mb-0.5">RUC del Establecimiento</span>
                                                <code className="text-xs font-mono font-bold text-slate-800">
                                                    {selectedDetailItem.ruc || 'No especificado'}
                                                </code>
                                            </div>
                                            {selectedDetailItem.ruc && (
                                                <button 
                                                    onClick={() => handleCopyText(selectedDetailItem.ruc, 'RUC')}
                                                    className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-white rounded-lg border border-transparent hover:border-slate-150 transition cursor-pointer"
                                                >
                                                    {copiedField === selectedDetailItem.ruc ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Subsection 2: Geografía */}
                                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                        <div className="w-1.5 h-3 bg-emerald-500 rounded-sm" /> Localización Regional
                                    </h4>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="space-y-0.5">
                                            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Departamento</span>
                                            <span className="text-sm font-bold text-slate-800">{selectedDetailItem.department || 'San Martín'}</span>
                                        </div>
                                        <div className="space-y-0.5">
                                            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Provincia</span>
                                            <span className="text-sm font-bold text-slate-800">{selectedDetailItem.province || 'No especificado'}</span>
                                        </div>
                                        <div className="space-y-0.5">
                                            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Distrito / Ciudad</span>
                                            <span className="text-sm font-bold text-slate-800">{selectedDetailItem.district || 'No especificado'}</span>
                                        </div>
                                    </div>

                                    {/* Dirección Legal */}
                                    <div className="pt-3 border-t border-slate-50 space-y-1">
                                        <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Dirección Legal</span>
                                        <div className="p-3 bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 flex justify-between items-center gap-4">
                                            <span className="leading-relaxed">{selectedDetailItem.legalAddress || 'Sin dirección legal asignada para este registro estatal.'}</span>
                                            {selectedDetailItem.legalAddress && (
                                                <a 
                                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedDetailItem.legalAddress + ', ' + (selectedDetailItem.district || '') + ', ' + (selectedDetailItem.province || '') + ', Peru')}`}
                                                    target="_blank" 
                                                    referrerPolicy="no-referrer"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-extrabold text-teal-700 hover:text-white hover:bg-teal-600 rounded-lg bg-white border border-slate-200 transition"
                                                >
                                                    <Globe className="h-3 w-3" /> Maps
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Subsection 3: Datos de Contacto y Canales */}
                                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                        <div className="w-1.5 h-3 bg-blue-500 rounded-sm" /> Canales de Contacto Oficiales
                                    </h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* Teléfono */}
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="h-9 w-9 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center shrink-0 border border-blue-100">
                                                <Phone className="h-4 w-4" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Teléfono Directo</span>
                                                {selectedDetailItem.phone ? (
                                                    <a href={`tel:${selectedDetailItem.phone}`} className="text-sm font-bold text-slate-800 hover:text-teal-600 transition">
                                                        {selectedDetailItem.phone}
                                                    </a>
                                                ) : (
                                                    <span className="text-xs font-semibold text-slate-404">No especificado</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Correo Electrónico */}
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="h-9 w-9 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center shrink-0 border border-indigo-100">
                                                <Mail className="h-4 w-4" />
                                            </div>
                                            <div className="space-y-0.5 overflow-hidden">
                                                <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Correo Electrónico</span>
                                                {selectedDetailItem.email ? (
                                                    <a href={`mailto:${selectedDetailItem.email}`} className="text-sm font-bold text-slate-800 hover:text-teal-600 transition truncate block">
                                                        {selectedDetailItem.email}
                                                    </a>
                                                ) : (
                                                    <span className="text-xs font-semibold text-slate-404">No especificado</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Website y Redes */}
                                    {(selectedDetailItem.website || selectedDetailItem.socialMedia) && (
                                        <div className="pt-3 border-t border-slate-50 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {selectedDetailItem.website && (
                                                <div className="space-y-1">
                                                    <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Sitio Web Oficial</span>
                                                    <a 
                                                        href={selectedDetailItem.website.startsWith('http') ? selectedDetailItem.website : `https://${selectedDetailItem.website}`} 
                                                        target="_blank" 
                                                        referrerPolicy="no-referrer"
                                                        rel="noopener noreferrer" 
                                                        className="text-xs font-bold text-teal-700 hover:underline flex items-center gap-1"
                                                    >
                                                        <Globe className="h-3.5 w-3.5" /> Visitar sitio web oficial
                                                    </a>
                                                </div>
                                            )}
                                            {selectedDetailItem.socialMedia && (
                                                <div className="space-y-1">
                                                    <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Redes Sociales</span>
                                                    <span className="text-xs font-semibold text-slate-700 block bg-slate-50 p-2 rounded-lg border border-slate-100">{selectedDetailItem.socialMedia}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

               {/* Modals for Editing */}
            {isDiresaModalOpen && createPortal(
                <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh] overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="font-extrabold text-xl text-gray-900 tracking-tight flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-teal-600" />
                                    Mantenimiento de DIRESA
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">Configure los datos de identificación, geografía y contacto de la Dirección Regional de Salud.</p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setIsDiresaModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100/80 rounded-xl transition-all"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Premium Stepper Progress */}
                        <div className="px-6 py-5 border-b border-gray-50 bg-white relative flex items-center justify-between shrink-0">
                            <div className="absolute left-6 top-8 right-6 h-0.5 bg-gray-100 -z-10">
                                <div 
                                    className="h-full bg-teal-600 transition-all duration-300" 
                                    style={{ width: diresaModalStep === 1 ? '0%' : diresaModalStep === 2 ? '50%' : '100%' }}
                                />
                            </div>
                            {[
                                { step: 1, label: 'Identificación', desc: 'Nombre y RUC', icon: Building2 },
                                { step: 2, label: 'Ubicación', desc: 'Datos Geográficos', icon: Network },
                                { step: 3, label: 'Contacto', desc: 'Canales y Dirección', icon: Globe }
                            ].map(s => (
                                <button
                                    key={s.step}
                                    type="button"
                                    disabled={
                                        (s.step === 2 && !isDiresaStep1Valid) ||
                                        (s.step === 3 && (!isDiresaStep1Valid || !isDiresaStep2Valid))
                                    }
                                    onClick={() => setDiresaModalStep(s.step)}
                                    className="flex items-center gap-3 bg-white px-3 disabled:opacity-50 disabled:cursor-not-allowed group text-left outline-none"
                                >
                                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${diresaModalStep === s.step ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-100' : 'bg-gray-50 border-gray-200 text-gray-400 group-hover:border-gray-300'}`}>
                                        <s.icon className="h-4 w-4" />
                                    </div>
                                    <div className="hidden sm:block">
                                        <span className={`block text-[11px] font-bold uppercase tracking-wider ${diresaModalStep === s.step ? 'text-teal-700' : 'text-gray-400'}`}>{s.label}</span>
                                        <span className="block text-[10px] text-gray-400 font-medium">{s.desc}</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Form */}
                        <form 
                            onSubmit={(e) => e.preventDefault()} 
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                }
                            }}
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            <div className="p-6 overflow-y-auto space-y-6 flex-1">
                                {/* STEP 1: IDENTIFICACIÓN */}
                                {diresaModalStep === 1 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Identificación Institucional
                                            </h4>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Nombre de la DIRESA *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Nombre (Ej. DIRESA SAN MARTIN)" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={diresaForm.name || ''} 
                                                        onChange={e => setDiresaForm({...diresaForm, name: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">RUC *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="RUC de la DIRESA (11 dígitos)" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={diresaForm.ruc || ''} 
                                                        onChange={e => setDiresaForm({...diresaForm, ruc: e.target.value})} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 2: UBICACIÓN GEOGRÁFICA */}
                                {diresaModalStep === 2 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Ubicación Geográfica
                                            </h4>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Distrito / Ciudad *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Distrito o Ciudad de origen" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={diresaForm.district || ''} 
                                                        onChange={e => setDiresaForm({...diresaForm, district: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Provincia *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Provincia" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={diresaForm.province || ''} 
                                                        onChange={e => setDiresaForm({...diresaForm, province: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Departamento *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Departamento" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={diresaForm.department || ''} 
                                                        onChange={e => setDiresaForm({...diresaForm, department: e.target.value})} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3: DATOS DE CONTACTO */}
                                {diresaModalStep === 3 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Contacto (Opcional)
                                            </h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Dirección Legal</label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Dirección física legal" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={diresaForm.legalAddress || ''} 
                                                        onChange={e => setDiresaForm({...diresaForm, legalAddress: e.target.value})} 
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Teléfono</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Número de contacto institucional" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={diresaForm.phone || ''} 
                                                            onChange={e => setDiresaForm({...diresaForm, phone: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Correo Electrónico</label>
                                                        <input 
                                                            type="email" 
                                                            placeholder="ejemplo@minsa.gob.pe" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={diresaForm.email || ''} 
                                                            onChange={e => setDiresaForm({...diresaForm, email: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Sitio Web</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="https://..." 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={diresaForm.website || ''} 
                                                            onChange={e => setDiresaForm({...diresaForm, website: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Redes Sociales</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Enlaces oficiales" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={diresaForm.socialMedia || ''} 
                                                            onChange={e => setDiresaForm({...diresaForm, socialMedia: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer Buttons */}
                            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                                {diresaModalStep > 1 ? (
                                    <button 
                                        type="button" 
                                        onClick={() => setDiresaModalStep(step => step - 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-200 bg-white hover:bg-gray-50 rounded-xl transition-all flex items-center gap-1"
                                    >
                                        <ChevronLeft className="h-4 w-4" /> Atrás
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => setIsDiresaModalOpen(false)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all"
                                    >
                                        Cancelar
                                    </button>
                                )}

                                {diresaModalStep < 3 ? (
                                    <button 
                                        type="button" 
                                        disabled={diresaModalStep === 1 ? !isDiresaStep1Valid : !isDiresaStep2Valid}
                                        onClick={() => setDiresaModalStep(step => step + 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center gap-1 text-center"
                                    >
                                        Siguiente <ChevronRight className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => handleSaveDiresa()}
                                        className="px-6 py-2.5 text-sm font-black text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-all flex items-center gap-2 shadow-lg hover:shadow-teal-100"
                                    >
                                        <Save className="h-4 w-4" /> Guardar DIRESA
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {isOgessModalOpen && createPortal(
                <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh] overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="font-extrabold text-xl text-gray-900 tracking-tight flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-teal-600" />
                                    Mantenimiento de OGESS
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">Configure los datos de identificación, jurisdicción regional y contacto de la OGESS.</p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setIsOgessModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100/80 rounded-xl transition-all"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Progress Stepper */}
                        <div className="px-6 py-5 border-b border-gray-50 bg-white relative flex items-center justify-between shrink-0">
                            <div className="absolute left-6 top-8 right-6 h-0.5 bg-gray-100 -z-10">
                                <div 
                                    className="h-full bg-teal-600 transition-all duration-300" 
                                    style={{ width: ogessModalStep === 1 ? '0%' : ogessModalStep === 2 ? '50%' : '100%' }}
                                />
                            </div>
                            {[
                                { step: 1, label: 'Identificación', desc: 'Nombre, DIRESA y Código', icon: Building2 },
                                { step: 2, label: 'Ubicación', desc: 'Datos Geográficos', icon: Network },
                                { step: 3, label: 'Contacto', desc: 'Canales y Dirección', icon: Globe }
                            ].map(s => (
                                <button
                                    key={s.step}
                                    type="button"
                                    disabled={
                                        (s.step === 2 && !isOgessStep1Valid) ||
                                        (s.step === 3 && (!isOgessStep1Valid || !isOgessStep2Valid))
                                    }
                                    onClick={() => setOgessModalStep(s.step)}
                                    className="flex items-center gap-3 bg-white px-3 disabled:opacity-50 disabled:cursor-not-allowed group text-left outline-none"
                                >
                                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${ogessModalStep === s.step ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-100' : 'bg-gray-50 border-gray-200 text-gray-400 group-hover:border-gray-300'}`}>
                                        <s.icon className="h-4 w-4" />
                                    </div>
                                    <div className="hidden sm:block">
                                        <span className={`block text-[11px] font-bold uppercase tracking-wider ${ogessModalStep === s.step ? 'text-teal-700' : 'text-gray-400'}`}>{s.label}</span>
                                        <span className="block text-[10px] text-gray-400 font-medium">{s.desc}</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Form */}
                        <form 
                            onSubmit={(e) => e.preventDefault()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                }
                            }}
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            <div className="p-6 overflow-y-auto space-y-6 flex-1">
                                {/* STEP 1 */}
                                {ogessModalStep === 1 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Identificación Institucional
                                            </h4>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Nombre de la OGESS *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Ej. OGESS BAJO MAYO" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ogessForm.name || ''} 
                                                        onChange={e => setOgessForm({...ogessForm, name: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">DIRESA de Dependencia *</label>
                                                    <CustomSelect
                                                        disabled={!isSuperAdmin && !!userDiresaId}
                                                        value={ogessForm.diresaId || ''}
                                                        onChange={val => {
                                                            const dId = val;
                                                            const sDiresa = diresas.find(d => d.id === dId);
                                                            setOgessForm({
                                                                ...ogessForm,
                                                                diresaId: dId,
                                                                department: sDiresa ? sDiresa.department : ''
                                                            });
                                                        }}
                                                        placeholder="Selecciona DIRESA..."
                                                        options={[
                                                            { value: '', label: 'Selecciona DIRESA...' },
                                                            ...visibleDiresas.map(d => ({ value: d.id, label: d.name }))
                                                        ]}
                                                        className="w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 disabled:bg-gray-100 disabled:text-gray-500"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Código Único OGESS *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Ingrese el código único" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ogessForm.code || ''} 
                                                        onChange={e => setOgessForm({...ogessForm, code: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">RUC</label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Número de RUC (Opcional)" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ogessForm.ruc || ''} 
                                                        onChange={e => setOgessForm({...ogessForm, ruc: e.target.value})} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 2 */}
                                {ogessModalStep === 2 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Ubicación Geográfica
                                            </h4>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Distrito / Ciudad *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Distrito o Ciudad" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ogessForm.district || ''} 
                                                        onChange={e => setOgessForm({...ogessForm, district: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Provincia *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Provincia" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ogessForm.province || ''} 
                                                        onChange={e => setOgessForm({...ogessForm, province: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Departamento (Heredado)</label>
                                                    <input 
                                                        disabled 
                                                        type="text" 
                                                        placeholder="Automático de DIRESA" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-gray-100 text-gray-650 font-medium cursor-not-allowed outline-none" 
                                                        value={ogessForm.department || ''} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3 */}
                                {ogessModalStep === 3 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Contacto (Opcional)
                                            </h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Dirección Legal</label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Dirección legal" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ogessForm.legalAddress || ''} 
                                                        onChange={e => setOgessForm({...ogessForm, legalAddress: e.target.value})} 
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Teléfono</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Teléfono institucional" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ogessForm.phone || ''} 
                                                            onChange={e => setOgessForm({...ogessForm, phone: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Correo Electrónico</label>
                                                        <input 
                                                            type="email" 
                                                            placeholder="ejemplo@minsa.gob.pe" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ogessForm.email || ''} 
                                                            onChange={e => setOgessForm({...ogessForm, email: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Sitio Web</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="https://..." 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ogessForm.website || ''} 
                                                            onChange={e => setOgessForm({...ogessForm, website: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Redes Sociales</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Enlaces oficiales" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ogessForm.socialMedia || ''} 
                                                            onChange={e => setOgessForm({...ogessForm, socialMedia: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer Buttons */}
                            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                                {ogessModalStep > 1 ? (
                                    <button 
                                        type="button" 
                                        onClick={() => setOgessModalStep(step => step - 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-200 bg-white hover:bg-gray-50 rounded-xl transition-all flex items-center gap-1"
                                    >
                                        <ChevronLeft className="h-4 w-4" /> Atrás
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => setIsOgessModalOpen(false)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all"
                                    >
                                        Cancelar
                                    </button>
                                )}

                                {ogessModalStep < 3 ? (
                                    <button 
                                        type="button" 
                                        disabled={ogessModalStep === 1 ? !isOgessStep1Valid : !isOgessStep2Valid}
                                        onClick={() => setOgessModalStep(step => step + 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center gap-1 text-center"
                                    >
                                        Siguiente <ChevronRight className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => handleSaveOgess()}
                                        className="px-6 py-2.5 text-sm font-black text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-all flex items-center gap-2 shadow-lg hover:shadow-teal-100"
                                    >
                                        <Save className="h-4 w-4" /> Guardar OGESS
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {isUngetModalOpen && createPortal(
                <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh] overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="font-extrabold text-xl text-gray-900 tracking-tight flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-teal-600" />
                                    Mantenimiento de UNGET
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">Configure los datos de la Unidad de Gestión Territorial (UNGET), su OGESS y canales de contacto.</p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setIsUngetModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100/80 rounded-xl transition-all"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Progress Stepper */}
                        <div className="px-6 py-5 border-b border-gray-50 bg-white relative flex items-center justify-between shrink-0">
                            <div className="absolute left-6 top-8 right-6 h-0.5 bg-gray-100 -z-10">
                                <div 
                                    className="h-full bg-teal-600 transition-all duration-300" 
                                    style={{ width: ungetModalStep === 1 ? '0%' : ungetModalStep === 2 ? '50%' : '100%' }}
                                />
                            </div>
                            {[
                                { step: 1, label: 'Identificación', desc: 'Nombre, OGESS y DIRESA', icon: Building2 },
                                { step: 2, label: 'Ubicación', desc: 'Ubicación Geográfica', icon: Network },
                                { step: 3, label: 'Contacto', desc: 'Canales y Dirección', icon: Globe }
                            ].map(s => (
                                <button
                                    key={s.step}
                                    type="button"
                                    disabled={
                                        (s.step === 2 && !isUngetStep1Valid) ||
                                        (s.step === 3 && (!isUngetStep1Valid || !isUngetStep2Valid))
                                    }
                                    onClick={() => setUngetModalStep(s.step)}
                                    className="flex items-center gap-3 bg-white px-3 disabled:opacity-50 disabled:cursor-not-allowed group text-left outline-none"
                                >
                                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${ungetModalStep === s.step ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-100' : 'bg-gray-50 border-gray-200 text-gray-400 group-hover:border-gray-300'}`}>
                                        <s.icon className="h-4 w-4" />
                                    </div>
                                    <div className="hidden sm:block">
                                        <span className={`block text-[11px] font-bold uppercase tracking-wider ${ungetModalStep === s.step ? 'text-teal-700' : 'text-gray-400'}`}>{s.label}</span>
                                        <span className="block text-[10px] text-gray-400 font-medium">{s.desc}</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Form */}
                        <form 
                            onSubmit={(e) => e.preventDefault()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                }
                            }}
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            <div className="p-6 overflow-y-auto space-y-6 flex-1">
                                {/* STEP 1 */}
                                {ungetModalStep === 1 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Identificación Institucional
                                            </h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Nombre de la UNGET *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Nombre de la UNGET (Ej. UNGET LAMAS)" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ungetForm.name || ''} 
                                                        onChange={e => setUngetForm({...ungetForm, name: e.target.value})} 
                                                    />
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-500 mb-1">OGESS *</label>
                                                        <CustomSelect
                                                            disabled={!isSuperAdmin && !!userOgessId}
                                                            value={ungetForm.ogessId || ''}
                                                            onChange={val => {
                                                                const oId = val;
                                                                const sOgess = ogess.find(o => o.id === oId);
                                                                let dept = ungetForm.department || '';
                                                                let dId = ungetForm.diresaId;
                                                                if (sOgess) {
                                                                    dId = sOgess.diresaId;
                                                                    const sDiresa = diresas.find(d => d.id === sOgess.diresaId);
                                                                    if (sDiresa) dept = sDiresa.department || '';
                                                                } else {
                                                                    dId = '';
                                                                    dept = '';
                                                                }
                                                                setUngetForm({
                                                                    ...ungetForm,
                                                                    ogessId: oId,
                                                                    diresaId: dId,
                                                                    department: dept
                                                                });
                                                            }}
                                                            placeholder="Seleccione OGESS..."
                                                            options={[
                                                                { value: '', label: 'Seleccione OGESS...' },
                                                                ...visibleOgess.map(o => ({ value: o.id, label: o.name }))
                                                            ]}
                                                            className="w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 disabled:bg-gray-100 disabled:text-gray-500"
                                                        />
                                                    </div>

                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-500 mb-1">DIRESA</label>
                                                        <CustomSelect
                                                            disabled={!!ungetForm.ogessId || (!isSuperAdmin && !!userDiresaId)}
                                                            value={ungetForm.diresaId || ''}
                                                            onChange={val => {
                                                                const dId = val;
                                                                const sDiresa = diresas.find(d => d.id === dId);
                                                                setUngetForm({
                                                                    ...ungetForm,
                                                                    diresaId: dId,
                                                                    department: sDiresa ? sDiresa.department : ungetForm.department || ''
                                                                });
                                                            }}
                                                            placeholder="Selecciona DIRESA"
                                                            options={[
                                                                { value: '', label: 'Selecciona DIRESA' },
                                                                ...visibleDiresas.map(d => ({ value: d.id, label: d.name }))
                                                            ]}
                                                            className={`w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 ${(!!ungetForm.ogessId || (!isSuperAdmin && !!userDiresaId)) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 2 */}
                                {ungetModalStep === 2 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Ubicación Geográfica
                                            </h4>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Distrito / Ciudad *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Distrito o Ciudad" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ungetForm.district || ''} 
                                                        onChange={e => setUngetForm({...ungetForm, district: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Provincia *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Provincia" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ungetForm.province || ''} 
                                                        onChange={e => setUngetForm({...ungetForm, province: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Departamento (Heredado)</label>
                                                    <input 
                                                        disabled 
                                                        type="text" 
                                                        placeholder="Departamento automático" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-gray-100 text-gray-650 font-medium cursor-not-allowed outline-none" 
                                                        value={ungetForm.department || ''} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3 */}
                                {ungetModalStep === 3 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Contacto (Opcional)
                                            </h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Dirección Legal</label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Dirección legal" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={ungetForm.legalAddress || ''} 
                                                        onChange={e => setUngetForm({...ungetForm, legalAddress: e.target.value})} 
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Teléfono</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Teléfono institucional" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ungetForm.phone || ''} 
                                                            onChange={e => setUngetForm({...ungetForm, phone: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Correo Electrónico</label>
                                                        <input 
                                                            type="email" 
                                                            placeholder="ejemplo@minsa.gob.pe" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ungetForm.email || ''} 
                                                            onChange={e => setUngetForm({...ungetForm, email: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Sitio Web</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="https://..." 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ungetForm.website || ''} 
                                                            onChange={e => setUngetForm({...ungetForm, website: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Redes Sociales</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Enlaces oficiales" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={ungetForm.socialMedia || ''} 
                                                            onChange={e => setUngetForm({...ungetForm, socialMedia: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer Buttons */}
                            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                                {ungetModalStep > 1 ? (
                                    <button 
                                        type="button" 
                                        onClick={() => setUngetModalStep(step => step - 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-200 bg-white hover:bg-gray-50 rounded-xl transition-all flex items-center gap-1"
                                    >
                                        <ChevronLeft className="h-4 w-4" /> Atrás
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => setIsUngetModalOpen(false)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all"
                                    >
                                        Cancelar
                                    </button>
                                )}

                                {ungetModalStep < 3 ? (
                                    <button 
                                        type="button" 
                                        disabled={ungetModalStep === 1 ? !isUngetStep1Valid : !isUngetStep2Valid}
                                        onClick={() => setUngetModalStep(step => step + 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center gap-1 text-center"
                                    >
                                        Siguiente <ChevronRight className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => handleSaveUnget()}
                                        className="px-6 py-2.5 text-sm font-black text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-all flex items-center gap-2 shadow-lg hover:shadow-teal-100"
                                    >
                                        <Save className="h-4 w-4" /> Guardar UNGET
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {isMicroredModalOpen && createPortal(
                <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col border border-gray-100 animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="font-extrabold text-xl text-gray-900 tracking-tight flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-teal-600" />
                                    Mantenimiento de MICRORED
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">Configure los datos de la Microred de salud.</p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setIsMicroredModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100/80 rounded-xl transition-all"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={(e) => e.preventDefault()} className="p-6 space-y-4">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">Nombre de la Microred *</label>
                                    <input 
                                        required 
                                        type="text" 
                                        placeholder="Nombre Microred (Ej. Microred Banda de Shilcayo)" 
                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                        value={microredForm.name || ''} 
                                        onChange={e => setMicroredForm({...microredForm, name: e.target.value})} 
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">UNGET Asociada *</label>
                                    <CustomSelect
                                        disabled={!isSuperAdmin && !!userUngetId}
                                        value={microredForm.ungetId || ''}
                                        onChange={val => {
                                            setMicroredForm({
                                                ...microredForm,
                                                ungetId: val
                                            });
                                        }}
                                        placeholder="Selecciona UNGET..."
                                        options={[
                                            { value: '', label: 'Selecciona UNGET...' },
                                            ...visibleUngets.map(u => ({ value: u.id, label: u.name }))
                                        ]}
                                        className="w-full border border-gray-250 rounded-lg text-sm bg-white text-gray-805 disabled:bg-gray-100 disabled:text-gray-500"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-4 border-t border-gray-104 mt-4">
                                <button 
                                    type="button" 
                                    onClick={() => setIsMicroredModalOpen(false)} 
                                    className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 transition rounded-xl text-sm font-bold"
                                >
                                    Cancelar
                                </button>
                                <button 
                                    type="button" 
                                    onClick={() => handleSaveMicrored()}
                                    className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white transition rounded-xl text-sm font-bold shadow-md hover:shadow-teal-100"
                                >
                                    Guardar Microred
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {isFacilityModalOpen && createPortal(
                <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh] overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="font-extrabold text-xl text-gray-900 tracking-tight flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-teal-600" />
                                    {editingFacilityOriginalCode ? 'Editar Establecimiento (IPRESS)' : 'Nuevo Establecimiento (IPRESS)'}
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">
                                    {editingFacilityOriginalCode 
                                        ? `Actualizando datos de la IPRESS [Código Original: ${editingFacilityOriginalCode}]` 
                                        : 'Configure los datos de identificación, jurisdicción y canales de contacto de la IPRESS.'}
                                </p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setIsFacilityModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100/80 rounded-xl transition-all"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Premium Stepper Progress */}
                        <div className="px-6 py-5 border-b border-gray-50 bg-white relative flex items-center justify-between shrink-0">
                            <div className="absolute left-6 top-8 right-6 h-0.5 bg-gray-100 -z-10">
                                <div 
                                    className="h-full bg-teal-600 transition-all duration-300" 
                                    style={{ width: facilityModalStep === 1 ? '0%' : facilityModalStep === 2 ? '33.3%' : facilityModalStep === 3 ? '66.6%' : '100%' }}
                                />
                            </div>
                            {[
                                { step: 1, label: 'Identificación', desc: 'Códigos y Categoría', icon: Building2 },
                                { step: 2, label: 'Jurisdicción', desc: 'Asociaciones y UNGET', icon: Network },
                                { step: 3, label: 'Ubicación y Contacto', desc: 'Geografía y Canales', icon: Globe },
                                { step: 4, label: 'Vinculación de Hoja (Stock)', desc: 'Conexión y Columnas', icon: FileSpreadsheet }
                            ].map(s => (
                                <button
                                    key={s.step}
                                    type="button"
                                    disabled={
                                        (s.step === 2 && !isFacilityStep1Valid) ||
                                        (s.step === 3 && (!isFacilityStep1Valid || !isFacilityStep2Valid)) ||
                                        (s.step === 4 && (!isFacilityStep1Valid || !isFacilityStep2Valid || !isFacilityStep3Valid))
                                    }
                                    onClick={() => setFacilityModalStep(s.step)}
                                    className="flex items-center gap-3 bg-white px-3 disabled:opacity-50 disabled:cursor-not-allowed group text-left outline-none"
                                >
                                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center font-bold text-xs border-2 transition-all duration-300 ${facilityModalStep === s.step ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-100' : 'bg-gray-50 border-gray-200 text-gray-400 group-hover:border-gray-300'}`}>
                                        <s.icon className="h-4 w-4" />
                                    </div>
                                    <div className="hidden sm:block">
                                        <span className={`block text-[11px] font-bold uppercase tracking-wider ${facilityModalStep === s.step ? 'text-teal-700' : 'text-gray-400'}`}>{s.label}</span>
                                        <span className="block text-[10px] text-gray-400 font-medium">{s.desc}</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Form */}
                        <form 
                            onSubmit={(e) => e.preventDefault()} 
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                }
                            }}
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            <div className="p-6 overflow-y-auto space-y-6 flex-1">
                                {/* STEP 1: IDENTIFICACIÓN Y CATEGORÍA */}
                                {facilityModalStep === 1 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Identificación
                                            </h4>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div className="sm:col-span-1">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                                        Código (RENIPRESS) *
                                                        {editingFacilityOriginalCode && (
                                                            <span className="ml-1 text-[10px] text-teal-600 font-semibold">(Existente)</span>
                                                        )}
                                                    </label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Código RENIPRESS" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={facilityForm.code || ''} 
                                                        onChange={e => setFacilityForm({...facilityForm, code: e.target.value})} 
                                                    />
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Nombre de la IPRESS *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Nombre completo del establecimiento" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={facilityForm.name || ''} 
                                                        onChange={e => setFacilityForm({...facilityForm, name: e.target.value})} 
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                                        Categoría {facilityForm.type === 'PUESTO_COMUNAL' ? '' : '*'}
                                                    </label>
                                                    <input
                                                        required={facilityForm.type !== 'PUESTO_COMUNAL'}
                                                        type="text"
                                                        placeholder={facilityForm.type === 'PUESTO_COMUNAL' ? 'No aplica a un puesto comunal' : 'Ej. I-3, I-4, II-1'}
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none"
                                                        value={facilityForm.category || ''}
                                                        onChange={e => setFacilityForm({...facilityForm, category: e.target.value})}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Tipo de Establecimiento *</label>
                                                    <CustomSelect
                                                        value={facilityForm.type || ''}
                                                        onChange={val => setFacilityForm({...facilityForm, type: val})}
                                                        placeholder="Seleccione tipo..."
                                                        options={[
                                                            { value: '', label: 'Seleccione tipo...' },
                                                            ...FACILITY_TYPES.map(t => ({ value: t.value, label: t.label }))
                                                        ]}
                                                        className="w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800"
                                                    />
                                                    {tipoSugeridoPorCodigo && (
                                                        <p className={`mt-1 text-[10px] font-bold ${facilityForm.type === tipoSugeridoPorCodigo ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                            {facilityForm.type === tipoSugeridoPorCodigo
                                                                ? `El código ${facilityForm.code} corresponde a ${facilityTypeLabel(tipoSugeridoPorCodigo)}.`
                                                                : `El código ${facilityForm.code} es de un ${facilityTypeLabel(tipoSugeridoPorCodigo)}. Compruebe el tipo antes de guardar.`}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 2: JURISDICCIÓN / ASOCIACIONES JERÁRQUICAS */}
                                {facilityModalStep === 2 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Red y Dependencia Jerárquica
                                            </h4>

                                            <p className="text-xs text-gray-600 leading-relaxed bg-teal-50/80 p-3.5 rounded-xl border border-teal-100 font-medium">
                                                💡 <strong>Ayuda de Asignación:</strong> Al seleccionar una <strong>Microred</strong>, todo su árbol superior (UNGET, OGESS, DIRESA y Departamento) se heredará y rellenará en cascada automáticamente. También puede asignar individualmente los niveles según disponibilidad.
                                            </p>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Microred</label>
                                                    <CustomSelect
                                                        disabled={!isSuperAdmin && !!userMicroredId}
                                                        value={facilityForm.microredId || ''}
                                                        onChange={val => handleMicroredChange(val)}
                                                        placeholder="Selecciona MICRORED (Opcional)"
                                                        options={[
                                                            { value: '', label: 'Selecciona MICRORED (Opcional)' },
                                                            ...microredOptions.map(m => ({ value: m.id, label: m.name }))
                                                        ]}
                                                        className={`w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 ${(!isSuperAdmin && !!userMicroredId) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1" title={facilityForm.microredId ? "Asignado automáticamente de la Microred seleccionada" : "Selecciona la UNGET"}>UNGET *</label>
                                                    <CustomSelect
                                                        disabled={!!facilityForm.microredId || (!isSuperAdmin && !!userUngetId)}
                                                        value={facilityForm.ungetId || ''}
                                                        onChange={val => handleUngetChange(val)}
                                                        placeholder="Selecciona UNGET..."
                                                        options={[
                                                            { value: '', label: 'Selecciona UNGET...' },
                                                            ...ungetOptions.map(u => ({ value: u.id, label: u.name }))
                                                        ]}
                                                        className={`w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 ${(facilityForm.microredId || (!isSuperAdmin && !!userUngetId)) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1" title={facilityForm.microredId || facilityForm.ungetId ? "Asignado automáticamente de la jerarquía seleccionada" : "Selecciona la OGESS"}>OGESS *</label>
                                                    <CustomSelect
                                                        disabled={!!facilityForm.microredId || !!facilityForm.ungetId || (!isSuperAdmin && !!userOgessId)}
                                                        value={facilityForm.ogessId || ''}
                                                        onChange={val => handleOgessChange(val)}
                                                        placeholder="Selecciona OGESS..."
                                                        options={[
                                                            { value: '', label: 'Selecciona OGESS...' },
                                                            ...ogessOptions.map(o => ({ value: o.id, label: o.name }))
                                                        ]}
                                                        className={`w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 ${(facilityForm.microredId || facilityForm.ungetId || (!isSuperAdmin && !!userOgessId)) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1" title={facilityForm.microredId || facilityForm.ungetId || facilityForm.ogessId ? "Asignado de la jerarquía seleccionada" : "Selecciona la DIRESA"}>DIRESA *</label>
                                                    <CustomSelect
                                                        disabled={!!facilityForm.microredId || !!facilityForm.ungetId || !!facilityForm.ogessId || (!isSuperAdmin && !!userDiresaId)}
                                                        value={facilityForm.diresaId || ''}
                                                        onChange={val => handleDiresaChange(val)}
                                                        placeholder="Selecciona DIRESA..."
                                                        options={[
                                                            { value: '', label: 'Selecciona DIRESA...' },
                                                            ...visibleDiresas.map(d => ({ value: d.id, label: d.name }))
                                                        ]}
                                                        className={`w-full border border-gray-200 rounded-lg text-sm bg-white text-gray-800 ${(facilityForm.microredId || facilityForm.ungetId || facilityForm.ogessId || (!isSuperAdmin && !!userDiresaId)) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3: UBICACIÓN Y CONTACTO */}
                                {facilityModalStep === 3 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        {/* Ubicación Geográfica */}
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Ubicación Geográfica
                                            </h4>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Distrito / Ciudad *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Distrito o Ciudad" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={facilityForm.district || ''} 
                                                        onChange={e => setFacilityForm({...facilityForm, district: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Provincia *</label>
                                                    <input 
                                                        required 
                                                        type="text" 
                                                        placeholder="Provincia" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={facilityForm.province || ''} 
                                                        onChange={e => setFacilityForm({...facilityForm, province: e.target.value})} 
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Departamento</label>
                                                    <input 
                                                        disabled 
                                                        type="text" 
                                                        placeholder="Derivado automáticamente" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-slate-100 text-gray-500 cursor-not-allowed font-medium" 
                                                        value={facilityForm.department || ''} 
                                                        title="Heredado automáticamente de la jerarquía seleccionada" 
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Datos de Contacto */}
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Datos de Contacto (Opcional)
                                            </h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Dirección Legal</label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Dirección física legal" 
                                                        className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                        value={facilityForm.legalAddress || ''} 
                                                        onChange={e => setFacilityForm({...facilityForm, legalAddress: e.target.value})} 
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Teléfono</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Número telefónico" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={facilityForm.phone || ''} 
                                                            onChange={e => setFacilityForm({...facilityForm, phone: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Correo Electrónico</label>
                                                        <input 
                                                            type="email" 
                                                            placeholder="ejemplo@minsa.gob.pe" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={facilityForm.email || ''} 
                                                            onChange={e => setFacilityForm({...facilityForm, email: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Sitio Web</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="https://..." 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={facilityForm.website || ''} 
                                                            onChange={e => setFacilityForm({...facilityForm, website: e.target.value})} 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Redes Sociales</label>
                                                        <input 
                                                            type="text" 
                                                            placeholder="Enlaces a Facebook / Twitter" 
                                                            className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" 
                                                            value={facilityForm.socialMedia || ''} 
                                                            onChange={e => setFacilityForm({...facilityForm, socialMedia: e.target.value})} 
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {facilityModalStep === 4 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-3">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Hoja de Stock (vínculo automático)
                                            </h4>
                                            <p className="text-[11px] text-slate-500">
                                                La hoja no se elige: se reconoce sola comparando el código del establecimiento con el
                                                de las pestañas del libro de su UNGET.
                                            </p>

                                            {!facilityForm.ungetId ? (
                                                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-[11px] font-bold text-slate-500">
                                                    Asigne una UNGET en el Paso 2 para poder reconocer su hoja.
                                                </div>
                                            ) : !linkConnection ? (
                                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-800">
                                                    La UNGET de este establecimiento todavía no tiene una conexión configurada en Consulta Stock.
                                                </div>
                                            ) : linkLoadingSheets ? (
                                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-bold text-teal-600 animate-pulse">
                                                    Leyendo las hojas del libro de su UNGET...
                                                </div>
                                            ) : linkSheetsError ? (
                                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-800">
                                                    {linkSheetsError}
                                                </div>
                                            ) : (
                                                <div className={`rounded-xl border px-4 py-3 flex items-start gap-2.5 ${
                                                    isLinkedToSheet(linkResolved)
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                                        : "border-amber-200 bg-amber-50 text-amber-800"
                                                }`}>
                                                    {isLinkedToSheet(linkResolved)
                                                        ? <Link2 className="h-4 w-4 mt-0.5 shrink-0" />
                                                        : <Link2Off className="h-4 w-4 mt-0.5 shrink-0" />}
                                                    <div>
                                                        {linkResolved?.sheet && (
                                                            <p className="text-xs font-black">{linkResolved.sheet.name}</p>
                                                        )}
                                                        <p className="text-[11px] font-bold leading-relaxed">
                                                            {linkResolved?.message || "Escriba el código del establecimiento en el Paso 1 para reconocer su hoja."}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100/80 space-y-4">
                                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1 flex items-center gap-1.5">
                                                <div className="w-1.5 h-3 bg-teal-500 rounded-sm" /> Restringir Columnas Visibles para este usuario
                                            </h4>
                                            <p className="text-[11px] text-slate-500">Marque las columnas que deben visualizarse en el reporte consolidado de stock.</p>
                                            
                                            <div className="bg-white p-4 rounded-xl border border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[220px] overflow-y-auto">
                                                {STOCK_COLUMNS.map(col => (
                                                    <div 
                                                        key={col.key} 
                                                        onClick={() => {
                                                            setLinkVisibleColumns(prev => 
                                                                prev.includes(col.key) 
                                                                    ? prev.filter(k => k !== col.key) 
                                                                    : [...prev, col.key]
                                                            );
                                                        }}
                                                        className="flex items-center gap-2.5 cursor-pointer bg-slate-50 hover:bg-slate-100 p-2.5 rounded-lg border border-gray-150 transition-colors select-none"
                                                    >
                                                        <div className={`w-5 h-5 rounded flex items-center justify-center border ${linkVisibleColumns.includes(col.key) ? 'bg-teal-600 border-teal-600' : 'bg-white border-gray-300'}`}>
                                                            {linkVisibleColumns.includes(col.key) && <Check className="w-3.5 h-3.5 text-white" />}
                                                        </div>
                                                        <span className="text-[11px] font-bold text-slate-700 leading-tight">{col.label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {linkVisibleColumns.length === 0 && (
                                                <p className="text-[10px] text-red-500 font-bold">Debe dejar al menos una columna visible.</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer Buttons */}
                            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                                {facilityModalStep > 1 ? (
                                    <button 
                                        type="button" 
                                        onClick={() => setFacilityModalStep(step => step - 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-200 bg-white hover:bg-gray-50 rounded-xl transition-all flex items-center gap-1"
                                    >
                                        <ChevronLeft className="h-4 w-4" /> Atrás
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        onClick={() => setIsFacilityModalOpen(false)} 
                                        className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all"
                                    >
                                        Cancelar
                                    </button>
                                )}

                                {facilityModalStep < 4 ? (
                                    <button 
                                        type="button" 
                                        disabled={
                                            facilityModalStep === 1 ? !isFacilityStep1Valid :
                                            facilityModalStep === 2 ? !isFacilityStep2Valid :
                                            !isFacilityStep3Valid
                                        }
                                        onClick={() => setFacilityModalStep(step => step + 1)} 
                                        className="px-5 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center gap-1 text-center"
                                    >
                                        Siguiente <ChevronRight className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button 
                                        type="button" 
                                        disabled={!isFacilityStep4Valid}
                                        onClick={() => handleSaveFacility()}
                                        className="px-6 py-2.5 text-sm font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center gap-2 shadow-lg hover:shadow-teal-100"
                                    >
                                        <Save className="h-4 w-4" /> {editingFacilityOriginalCode ? 'Actualizar IPRESS' : 'Guardar IPRESS'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* Spreadsheet-like Column Filter Popover */}
            {activeFilterId && activeFilterTriggerRect && createPortal(
                <>
                    {/* Click-outside backdrop shield */}
                    <div 
                        className="fixed inset-0 z-[9998] bg-transparent cursor-default" 
                        onClick={() => {
                            setActiveFilterId(null);
                            setActiveFilterTriggerRect(null);
                        }}
                    />
                    
                    {/* Floating Dropdown Card */}
                    <div 
                        style={popoverStyle}
                        className="bg-white border border-slate-200 shadow-xl shadow-slate-200/80 rounded-2xl flex flex-col z-[9999] animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="bg-slate-50/80 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                            <span className="text-[10px] font-black text-slate-700 uppercase tracking-wider">
                                Filtrar {activeFilterTitle}
                            </span>
                            {activeFilterValue && (
                                <button 
                                    type="button"
                                    onClick={() => {
                                        activeFilterOnChange?.('');
                                        setActiveFilterValue('');
                                        setActiveFilterId(null);
                                        setActiveFilterTriggerRect(null);
                                        toast.success(`Filtro de ${activeFilterTitle} limpiado`);
                                    }}
                                    className="text-[10px] font-extrabold text-teal-600 hover:text-teal-700 underline cursor-pointer"
                                >
                                    Limpiar
                                </button>
                            )}
                        </div>

                        {/* Search input if options length has substantial items (> 3) */}
                        {activeFilterOptions.length > 3 && (
                            <div className="p-2 border-b border-slate-100/60 bg-white">
                                <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/10 transition">
                                    <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-1.5" />
                                    <input 
                                        type="text"
                                        placeholder="Buscar opción..."
                                        value={headerFilterSearch}
                                        onChange={(e) => setHeaderFilterSearch(e.target.value)}
                                        className="w-full bg-transparent border-none text-xs text-slate-700 font-bold outline-none placeholder:text-slate-400 placeholder:font-normal"
                                    />
                                    {headerFilterSearch && (
                                        <button 
                                            type="button"
                                            onClick={() => setHeaderFilterSearch('')}
                                            className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Scrollable list of options */}
                        <div className="flex-1 overflow-y-auto max-h-[190px] py-1 select-none">
                            {filteredOptionsList.length === 0 ? (
                                <div className="py-6 text-center text-xs font-bold text-slate-400">
                                    No hay coincidencias
                                </div>
                            ) : (
                                filteredOptionsList.map((opt) => {
                                    const isSelected = activeFilterValue === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => {
                                                activeFilterOnChange?.(opt.value);
                                                setActiveFilterValue(opt.value);
                                                setActiveFilterId(null);
                                                setActiveFilterTriggerRect(null);
                                            }}
                                            className={`w-full text-left px-4 py-2 border-none transition-all flex items-center justify-between text-xs cursor-pointer ${
                                                isSelected 
                                                    ? 'bg-teal-50/70 hover:bg-teal-50 text-teal-800 font-extrabold' 
                                                    : 'hover:bg-slate-50 text-slate-600 font-bold'
                                            }`}
                                        >
                                            <span className="truncate pr-4">{opt.label}</span>
                                            {isSelected && (
                                                <Check className="h-3.5 w-3.5 text-teal-600 stroke-[3px] shrink-0" />
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer info stats */}
                        <div className="bg-slate-50/60 border-t border-slate-100 px-4 py-2 flex items-center justify-between select-none shrink-0">
                            <span className="text-[9px] text-slate-400 font-extrabold">
                                {filteredOptionsList.length} opciones
                            </span>
                            <button 
                                type="button"
                                onClick={() => {
                                    setActiveFilterId(null);
                                    setActiveFilterTriggerRect(null);
                                }}
                                className="px-2.5 py-1 text-[10px] font-black text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </>,
                document.body
            )}
        </div>
    );
};
