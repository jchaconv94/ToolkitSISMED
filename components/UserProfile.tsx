
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  User as UserIcon, 
  Building2, 
  Phone, 
  Mail, 
  Loader2, 
  Fingerprint, 
  Lock, 
  UserCircle, 
  Save, 
  Pencil,
  X,
  Briefcase,
  ShieldCheck,
  KeyRound,
  Shield,
  RefreshCw,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { CustomSelect } from './ui/CustomSelect';
import { api } from '../services/api';
import { QuickAccessCard } from './QuickAccessCard';

export const UserProfile: React.FC = () => {
  const { user, updateUserContext, refreshUserData } = useAuth();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [diresas, setDiresas] = useState<any[]>([]);
  const [ogess, setOgess] = useState<any[]>([]);
  const [ungets, setUngets] = useState<any[]>([]);
  const [microredes, setMicroredes] = useState<any[]>([]);
  const [laborRegimes, setLaborRegimes] = useState<any[]>([]);
  const [professions, setProfessions] = useState<any[]>([]);

  // Form State
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
      firstName: '',
      lastName: '',
      dni: '',
      phone: '',
      email: '',
      birthDate: '',
      username: '',
      newPassword: '',
      confirmPassword: '',
      laborRegimeId: '',
      professionId: ''
  });

  // Load organization lookups
  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [dList, oList, uList, mList, rList, pList] = await Promise.all([
          api.getDiresas(),
          api.getOgess(),
          api.getUngets(),
          api.getMicroredes(),
          api.getLaborRegimes(),
          api.getProfessions()
        ]);
        setDiresas(dList || []);
        setOgess(oList || []);
        setUngets(uList || []);
        setMicroredes(mList || []);
        setLaborRegimes(rList || []);
        setProfessions(pList || []);
      } catch (e) {
        console.warn("Error loading organization catalogs", e);
      }
    };
    loadLookups();
  }, []);

  // AUTO REFRESH ON MOUNT: Get latest data from DB immediately when opening profile
  useEffect(() => {
      const fetchLatest = async () => {
          setIsRefreshing(true);
          await refreshUserData();
          setIsRefreshing(false);
      };
      fetchLatest();
  }, []);

  // Load data into form when modal opens
  useEffect(() => {
    if (isEditModalOpen && user?.personnelData) {
        setFormData({
            firstName: user.personnelData.firstName,
            lastName: user.personnelData.lastName,
            dni: user.personnelData.dni,
            phone: user.personnelData.phone || '',
            email: user.personnelData.email || '',
            birthDate: user.personnelData.birthDate || '',
            username: user.username,
            newPassword: '',
            confirmPassword: '',
            laborRegimeId: user.personnelData.laborRegimeId || '',
            professionId: user.personnelData.professionId || ''
        });
        setError(null);
        setCurrentStep(1);
    }
  }, [isEditModalOpen]); // Removed user from dependency array to prevent resetting form and step on save

  if (!user || !user.personnelData) return null;

  const handleManualRefresh = async () => {
      setIsRefreshing(true);
      await refreshUserData();
      setIsRefreshing(false);
  };

  const executeSave = async (isFinalStep: boolean = false) => {
      setError(null);

      // Basic Validations
      if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.dni.trim() || !formData.username.trim()) {
          setError("Los campos Nombre, Apellido, DNI y Usuario son obligatorios.");
          return false;
      }

      // Password Validation
      if (formData.newPassword || formData.confirmPassword) {
          if (formData.newPassword !== formData.confirmPassword) {
              setError("Las nuevas contraseñas no coinciden.");
              return false;
          }
          if (formData.newPassword.length < 4) {
              setError("La contraseña es muy corta.");
              return false;
          }
      }

      const hasChanges = (
          formData.firstName !== (user?.personnelData?.firstName || '') ||
          formData.lastName !== (user?.personnelData?.lastName || '') ||
          formData.dni !== (user?.personnelData?.dni || '') ||
          formData.phone !== (user?.personnelData?.phone || '') ||
          formData.email !== (user?.personnelData?.email || '') ||
          formData.birthDate !== (user?.personnelData?.birthDate || '') ||
          formData.username !== user?.username ||
          formData.laborRegimeId !== (user?.personnelData?.laborRegimeId || '') ||
          formData.professionId !== (user?.personnelData?.professionId || '') ||
          formData.newPassword !== ''
      );

      if (!hasChanges) {
          if (isFinalStep) {
              setIsEditModalOpen(false);
          }
          return true;
      }

      setIsSaving(true);
      
      const payload: any = {
          firstName: formData.firstName,
          lastName: formData.lastName,
          dni: formData.dni,
          phone: formData.phone,
          email: formData.email,
          birthDate: formData.birthDate,
          username: formData.username,
          laborRegimeId: formData.laborRegimeId,
          professionId: formData.professionId
      };

      if (formData.newPassword) {
          payload.password = formData.newPassword;
      }

      const response = await api.updateProfile(user.personnelId, payload);
      
      if (response.success) {
          // 1. Update local context optimistic (for speed)
          updateUserContext({
              username: formData.username,
              personnelData: {
                  ...user.personnelData!,
                  firstName: formData.firstName,
                  lastName: formData.lastName,
                  dni: formData.dni,
                  phone: formData.phone,
                  email: formData.email,
                  birthDate: formData.birthDate,
                  laborRegimeId: formData.laborRegimeId,
                  professionId: formData.professionId
              }
          });
          
          // 2. CRITICAL: Force full refresh from DB immediately to update Header/Session
          await refreshUserData(formData.username);

          if (isFinalStep) {
              setIsEditModalOpen(false);
              toast.success("Perfil actualizado con éxito");
          } else {
              toast.success("Los datos se actualizaron correctamente");
          }
      } else {
          setError(response.message || "Error al guardar los cambios.");
      }

      setIsSaving(false);
      return response.success;
  };

  const handleSave = async () => {
      await executeSave(true);
  };

  const handleNextStep = async () => {
      setError(null);
      if (currentStep === 1) {
          if (!formData.firstName.trim()) {
              setError("Nombres son obligatorios.");
              return;
          }
          if (!formData.lastName.trim()) {
              setError("Apellidos son obligatorios.");
              return;
          }
          if (!formData.dni.trim()) {
              setError("DNI es obligatorio.");
              return;
          }
          if (formData.dni.trim().length !== 8) {
              setError("El DNI debe tener exactamente 8 dígitos.");
              return;
          }
          const saved = await executeSave(false);
          if (saved) setCurrentStep(2);
      } else if (currentStep === 2) {
          if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
              setError("El formato de correo electrónico es inválido.");
              return;
          }
          const saved = await executeSave(false);
          if (saved) setCurrentStep(3);
      }
  };

  const handlePrevStep = () => {
      setError(null);
      if (currentStep > 1) {
          setCurrentStep(currentStep - 1);
      }
  };

  return (
    <>
    <div className="max-w-6xl mx-auto px-4 py-6 2xl:py-8 animate-in fade-in slide-in-from-bottom-4">
        
        {/* Header Section Container */}
        <div className="relative mb-6 2xl:mb-8">
            
            {/* Banner Background */}
            <div className="h-32 2xl:h-48 rounded-t-2xl 2xl:rounded-t-3xl bg-gradient-to-r from-gray-900 via-teal-900 to-gray-900 relative overflow-hidden">
                 <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
                 <div className="absolute bottom-4 right-6 text-white/10 font-black text-4xl 2xl:text-6xl select-none hidden sm:block">ToolKit SISMED Web</div>
                 
                 {/* Manual Refresh Button (Top Right) */}
                 <button 
                    onClick={handleManualRefresh}
                    disabled={isRefreshing}
                    className="absolute top-4 right-4 bg-black/20 hover:bg-black/40 text-white p-2 rounded-full transition-all backdrop-blur-sm border border-white/10"
                    title="Sincronizar datos con Base de Datos"
                 >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                 </button>
            </div>
            
            {/* Profile Info Bar (Matching Gradient Card Overlapping Banner) */}
            <div className="bg-gradient-to-r from-gray-900 via-teal-900 to-gray-900 rounded-b-2xl 2xl:rounded-b-3xl shadow-xl border-x border-b border-gray-800 px-6 pb-4 2xl:pb-6 pt-0 relative z-10">
                <div className="flex flex-col sm:flex-row items-center sm:items-end -mt-12 sm:-mt-16 2xl:-mt-20 gap-4 2xl:gap-6">
                    
                    {/* Avatar */}
                    <div className="relative group shrink-0">
                        <div className="h-24 w-24 sm:h-32 sm:w-32 2xl:h-40 2xl:w-40 bg-gray-900 rounded-full p-2 shadow-xl border border-gray-800">
                            <div className="h-full w-full bg-gray-800 rounded-full flex items-center justify-center overflow-hidden border border-gray-700">
                                 <UserIcon className="h-12 w-12 2xl:h-16 2xl:w-16 text-gray-500" />
                            </div>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-green-500 h-4 w-4 2xl:h-6 2xl:w-6 rounded-full border-4 border-gray-900 shadow-sm" title="Activo"></div>
                    </div>
                    
                    {/* Info & Actions */}
                    <div className="flex-1 w-full flex flex-col sm:flex-row sm:items-end justify-between gap-4 text-center sm:text-left pb-2">
                        <div>
                            <h1 className="text-2xl 2xl:text-3xl font-black text-white flex items-center justify-center sm:justify-start gap-2 drop-shadow-sm">
                                {user.personnelData.firstName} {user.personnelData.lastName}
                                <ShieldCheck className="h-5 w-5 2xl:h-6 2xl:w-6 text-teal-400" />
                            </h1>
                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-y-2 gap-x-4 mt-2 text-gray-300">
                                <span className="bg-black/30 text-teal-300 px-2 py-0.5 2xl:px-3 2xl:py-1 rounded-full text-[10px] 2xl:text-xs font-bold uppercase tracking-wider border border-white/10 shadow-sm backdrop-blur-sm">
                                    {user.role}
                                </span>
                                <span className="flex items-center gap-1 text-xs 2xl:text-sm font-medium">
                                    <Fingerprint className="h-3 w-3 2xl:h-4 2xl:w-4 text-teal-400/80" />
                                    <span className="font-mono text-gray-200">{user.personnelData.dni}</span>
                                </span>
                                <span className="hidden sm:inline text-gray-600">|</span>
                                <span className="flex items-center gap-1 text-xs 2xl:text-sm font-medium text-gray-300">
                                    <UserCircle className="h-3 w-3 2xl:h-4 2xl:w-4 text-teal-400/80" />
                                    {user.username}
                                </span>
                            </div>
                        </div>

                        <div className="shrink-0">
                            <button 
                                onClick={() => setIsEditModalOpen(true)}
                                className="flex items-center justify-center gap-2 bg-white text-gray-900 px-4 py-2 2xl:px-6 2xl:py-3 rounded-xl font-bold shadow-lg transition-all hover:bg-gray-100 hover:-translate-y-0.5 active:translate-y-0 w-full sm:w-auto text-xs 2xl:text-sm border border-gray-200"
                            >
                                <Pencil className="h-3 w-3 2xl:h-4 2xl:w-4" />
                                <span>Editar Perfil</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
            
            {/* Left Column: Contact & Security Info */}
            <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 2xl:p-6 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <Phone className="h-20 w-20 2xl:h-24 2xl:w-24 text-gray-300" />
                    </div>
                    <h3 className="text-[10px] 2xl:text-xs font-bold text-teal-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                        Detalles de Contacto
                    </h3>
                    
                    <div className="space-y-4 2xl:space-y-5 relative z-10">
                        <div className="flex gap-3 items-start">
                            <div className="bg-blue-50 p-2 rounded-xl text-blue-600 shrink-0">
                                <Phone className="h-4 w-4" />
                            </div>
                            <div>
                                <label className="block text-[10px] 2xl:text-xs font-bold text-gray-400 uppercase tracking-wider">Teléfono Celular</label>
                                <p className="text-xs font-semibold text-gray-800 leading-relaxed mt-0.5">
                                    {user.personnelData.phone || <span className="text-gray-400 italic font-normal text-xs">No registrado</span>}
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 items-start">
                            <div className="bg-purple-50 p-2 rounded-xl text-purple-600 shrink-0">
                                <Mail className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <label className="block text-[10px] 2xl:text-xs font-bold text-gray-400 uppercase tracking-wider">Correo Electrónico</label>
                                <p className="text-xs font-semibold text-gray-800 leading-relaxed break-all mt-0.5">
                                    {user.personnelData.email || <span className="text-gray-400 italic font-normal text-xs">No registrado</span>}
                                </p>
                            </div>
                        </div>


                    </div>
                </div>

                <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl shadow-sm border border-gray-200 p-5 2xl:p-6">
                    <h3 className="text-[10px] 2xl:text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 2xl:mb-4 flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                        Seguridad
                    </h3>
                    <div className="flex items-center gap-3">
                        <div className="bg-gray-200 p-2 rounded-full">
                            <UserCircle className="h-4 w-4 2xl:h-5 2xl:w-5 text-gray-600" />
                        </div>
                        <div>
                            <label className="text-[10px] text-gray-400 font-bold uppercase">Usuario de Sistema</label>
                            <p className="text-xs font-semibold text-gray-800 leading-relaxed font-mono">{user.username}</p>
                        </div>
                    </div>
                </div>

                <QuickAccessCard />
            </div>

            {/* Middle & Right Column: Labor Information */}
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 2xl:p-8 h-fit relative">
                    <div className="absolute top-6 right-6 opacity-5 hidden sm:block">
                        <Briefcase className="h-24 w-24 text-gray-300" />
                    </div>
                    <h3 className="text-[10px] 2xl:text-xs font-bold text-teal-600 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <Briefcase className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                        Información Laboral
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                        {/* Establishments banner/block */}
                        <div className="sm:col-span-2 flex gap-4 items-start bg-gray-50/55 p-4 rounded-xl border border-gray-100">
                            <div className="bg-teal-50 p-2.5 rounded-xl text-teal-600 shrink-0 hidden sm:block">
                                <Building2 className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start pb-3.5 border-b border-gray-100">
                                    <div className="sm:col-span-4 space-y-1 pt-0.5">
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Establecimiento</label>
                                        {isRefreshing ? (
                                            <div className="h-6 w-3/4 bg-gray-100 animate-pulse rounded mt-1"></div>
                                        ) : (
                                            <p className="text-xs font-semibold text-gray-800 leading-relaxed whitespace-normal break-words">
                                                {user.facilityData?.code ? `${user.facilityData.code} | ` : ''}{user.facilityData?.name || <span className="text-gray-400 italic font-normal">No asignado</span>}
                                            </p>
                                        )}
                                    </div>

                                    {/* Category */}
                                    <div className="sm:col-span-4 space-y-1">
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Categoría</label>
                                        <p className="text-xs font-semibold text-gray-800 leading-relaxed whitespace-normal break-words">
                                            {user.facilityData?.category || '---'}
                                        </p>
                                    </div>

                                    {/* Microred */}
                                    <div className="sm:col-span-4 space-y-1">
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Microred</label>
                                        <p className="text-xs font-semibold text-gray-800 leading-relaxed whitespace-normal break-words uppercase">
                                            {microredes.find(m => m.id === (user.personnelData?.microredId || user.facilityData?.microredId))?.name || <span className="text-gray-400 italic font-normal text-xs normal-case">No asignada</span>}
                                        </p>
                                    </div>
                                </div>

                                {/* Row for UNGET, OGESS, and DIRESA side-by-side */}
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
                                    <div className="sm:col-span-4 space-y-0.5">
                                        <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">UNGET</span>
                                        <p className="text-xs font-semibold text-gray-800 leading-relaxed whitespace-normal break-words">
                                            {ungets.find(u => u.id === (user.personnelData?.ungetId || user.facilityData?.ungetId))?.name || <span className="text-gray-400 italic font-normal">No asignada</span>}
                                        </p>
                                    </div>
                                    <div className="sm:col-span-4 space-y-0.5">
                                        <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">OGESS</span>
                                        <p className="text-xs font-semibold text-gray-800 leading-relaxed whitespace-normal break-words">
                                            {ogess.find(o => o.id === (user.personnelData?.ogessId || user.facilityData?.ogessId))?.name || <span className="text-gray-400 italic font-normal">No asignada</span>}
                                        </p>
                                    </div>
                                    <div className="sm:col-span-4 space-y-0.5">
                                        <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">DIRESA</span>
                                        <p className="text-xs font-semibold text-gray-800 leading-relaxed whitespace-normal break-words">
                                            {diresas.find(d => d.id === (user.personnelData?.diresaId || user.facilityData?.diresaId))?.name || <span className="text-gray-400 italic font-normal">No asignada</span>}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Régimen Laboral */}
                        <div className="flex gap-4 items-start">
                            <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600 shrink-0">
                                <Briefcase className="h-5 w-5" />
                            </div>
                            <div>
                                <label className="block text-[10px] 2xl:text-xs font-bold text-[#9ca3af] uppercase mb-1">Régimen Laboral</label>
                                <p className="text-xs font-semibold text-gray-800 leading-relaxed mt-0.5">
                                    {user.personnelData?.laborRegimeData?.name || user.personnelData?.laborRegime || <span className="text-gray-400 italic font-normal text-xs">No registrado</span>}
                                </p>
                            </div>
                        </div>

                        {/* Profesión */}
                        <div className="flex gap-4 items-start">
                            <div className="bg-cyan-50 p-2.5 rounded-xl text-cyan-600 shrink-0">
                                <UserIcon className="h-5 w-5" />
                            </div>
                            <div>
                                <label className="block text-[10px] 2xl:text-xs font-bold text-gray-400 uppercase mb-1">Profesión</label>
                                <p className="text-xs font-semibold text-gray-800 leading-relaxed mt-0.5">
                                    {user.personnelData?.professionData?.name || <span className="text-gray-400 italic font-normal">No registrada</span>}
                                </p>
                            </div>
                        </div>
                    </div>


                </div>
            </div>
        </div>
    </div>

    {/* EDIT MODAL */}
    {isEditModalOpen && (
        <div className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                
                {/* Modal Header */}
                <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-teal-500/20 p-2 rounded-lg">
                            <UserIcon className="h-5 w-5 text-teal-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Editar Perfil</h3>
                            <p className="text-xs text-gray-400">Actualice sus datos personales y credenciales en tres sencillos pasos.</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsEditModalOpen(false)}
                        className="text-gray-400 hover:text-white transition-colors hover:bg-white/10 p-1 rounded-full"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Progress Stepper Accent */}
                <div className="bg-gray-50 border-b border-gray-150 px-6 py-4 shrink-0">
                    <div className="flex items-center justify-between relative max-w-md mx-auto">
                        {/* Stepper Line Container to prevent line sticking out of the circles */}
                        <div className="absolute left-[16px] right-[16px] top-[16px] h-0.5 z-0 pointer-events-none">
                            {/* Stepper Base Line */}
                            <div className="absolute inset-0 bg-gray-200" />
                            {/* Stepper Active Line Progress */}
                            <div 
                                className="absolute left-0 top-0 bottom-0 bg-teal-600 transition-all duration-500 ease-out" 
                                style={{ width: `${currentStep === 1 ? '0%' : currentStep === 2 ? '50%' : '100%'}` }}
                            />
                        </div>
                        
                        {/* Step 1 Button */}
                        <button 
                            type="button"
                            onClick={() => setCurrentStep(1)}
                            className="relative z-10 flex flex-col items-center focus:outline-none"
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${
                                currentStep >= 1 
                                    ? 'bg-teal-600 text-white ring-4 ring-teal-100 shadow-sm' 
                                    : 'bg-white text-gray-400 border border-gray-200'
                            }`}>
                                <UserIcon className="h-4 w-4" />
                            </div>
                            <span className={`text-[10px] font-bold mt-1 transition-colors duration-200 ${currentStep === 1 ? 'text-teal-600 font-extrabold' : 'text-gray-400'}`}>
                                Personales
                            </span>
                        </button>

                        {/* Step 2 Button */}
                        <button 
                            type="button"
                            onClick={() => {
                                if (formData.firstName.trim() && formData.lastName.trim() && formData.dni.trim().length === 8) {
                                    setCurrentStep(2);
                                }
                            }}
                            className="relative z-10 flex flex-col items-center focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!formData.firstName.trim() || !formData.lastName.trim() || formData.dni.trim().length !== 8}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${
                                currentStep >= 2 
                                    ? 'bg-teal-600 text-white ring-4 ring-teal-100 shadow-sm' 
                                    : 'bg-white text-gray-400 border border-gray-200'
                            }`}>
                                <Phone className="h-4 w-4" />
                            </div>
                            <span className={`text-[10px] font-bold mt-1 transition-colors duration-200 ${currentStep === 2 ? 'text-teal-600 font-extrabold' : 'text-gray-400'}`}>
                                Contacto y Laboral
                            </span>
                        </button>

                        {/* Step 3 Button */}
                        <button 
                            type="button"
                            onClick={() => {
                                if (formData.firstName.trim() && formData.lastName.trim() && formData.dni.trim().length === 8 && (!formData.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim()))) {
                                    setCurrentStep(3);
                                }
                            }}
                            className="relative z-10 flex flex-col items-center focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!formData.firstName.trim() || !formData.lastName.trim() || formData.dni.trim().length !== 8}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${
                                currentStep >= 3 
                                    ? 'bg-teal-600 text-white ring-4 ring-teal-100 shadow-sm' 
                                    : 'bg-white text-gray-400 border border-gray-200'
                            }`}>
                                <KeyRound className="h-4 w-4" />
                            </div>
                            <span className={`text-[10px] font-bold mt-1 transition-colors duration-200 ${currentStep === 3 ? 'text-teal-600 font-extrabold' : 'text-gray-400'}`}>
                                Seguridad
                            </span>
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    
                    {error && (
                        <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded text-red-700 text-sm font-medium flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            {error}
                        </div>
                    )}

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentStep}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            {currentStep === 1 && (
                                <div className="space-y-4">
                                    <div className="bg-teal-50/50 p-4 rounded-xl border border-teal-100/80 mb-2">
                                        <h4 className="text-sm font-bold text-teal-800 flex items-center gap-2">
                                            <Fingerprint className="h-4 w-4" /> Paso 1: Datos Personales de Identidad
                                        </h4>
                                        <p className="text-xs text-teal-600 mt-1">Por favor ingrese su información oficial como se muestra en su documento de identidad.</p>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Nombres <span className="text-red-500">*</span></label>
                                            <input 
                                                type="text" 
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 transition-shadow"
                                                value={formData.firstName}
                                                onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                                                placeholder="Ej. Shirley Ariceli"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Apellidos <span className="text-red-500">*</span></label>
                                            <input 
                                                type="text" 
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 transition-shadow"
                                                value={formData.lastName}
                                                onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                                                placeholder="Ej. Fasabi Paredes"
                                            />
                                        </div>
                                        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Documento Nacional de Identidad (DNI) <span className="text-red-500">*</span></label>
                                                <input 
                                                    type="text" 
                                                    maxLength={8}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none font-mono bg-white text-gray-900 transition-shadow"
                                                    value={formData.dni}
                                                    onChange={(e) => setFormData({...formData, dni: e.target.value.replace(/\D/g, '')})}
                                                    placeholder="8 dígitos numéricos"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {currentStep === 2 && (
                                <div className="space-y-4">
                                    <div className="bg-teal-50/50 p-4 rounded-xl border border-teal-100/80 mb-2">
                                        <h4 className="text-sm font-bold text-teal-800 flex items-center gap-2">
                                            <Phone className="h-4 w-4" /> Paso 2: Contacto y Laboral
                                        </h4>
                                        <p className="text-xs text-teal-600 mt-1">Facilite sus vías de comunicación e información laboral para coordinaciones farmacéuticas.</p>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Teléfono Móvil</label>
                                            <input 
                                                type="tel" 
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 transition-shadow"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                                placeholder="Ej. 956958745"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Correo Electrónico de Trabajo</label>
                                            <input 
                                                type="email" 
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 transition-shadow"
                                                value={formData.email}
                                                onChange={(e) => setFormData({...formData, email: e.target.value})}
                                                placeholder="Ej. farmacia@gmail.com"
                                            />
                                        </div>
                                        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-150 pt-4 mt-2">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Régimen Laboral</label>
                                                <CustomSelect 
                                                    value={formData.laborRegimeId}
                                                    onChange={(val) => setFormData({...formData, laborRegimeId: val})}
                                                    options={[
                                                        { value: "", label: "Seleccione Régimen..." },
                                                        ...laborRegimes.map(r => ({ value: r.id, label: r.name }))
                                                    ]}
                                                    ariaLabel="Régimen Laboral"
                                                    className="h-10 border-gray-300"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Profesión</label>
                                                <CustomSelect 
                                                    value={formData.professionId}
                                                    onChange={(val) => setFormData({...formData, professionId: val})}
                                                    options={[
                                                        { value: "", label: "Seleccione Profesión..." },
                                                        ...professions.map(p => ({ value: p.id, label: p.name }))
                                                    ]}
                                                    ariaLabel="Profesión"
                                                    className="h-10 border-gray-300"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {currentStep === 3 && (
                                <div className="space-y-4">
                                    <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200/60 mb-2">
                                        <h4 className="text-sm font-bold text-yellow-800 flex items-center gap-2">
                                            <KeyRound className="h-4 w-4" /> Paso 3: Credenciales y Seguridad
                                        </h4>
                                        <p className="text-xs text-yellow-700 mt-1">Configure su nombre de usuario único y actualice su contraseña secreta si así lo requiere.</p>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Nombre de Usuario <span className="text-red-500">*</span></label>
                                            <input 
                                                type="text" 
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 font-mono transition-shadow"
                                                value={formData.username}
                                                onChange={(e) => setFormData({...formData, username: e.target.value})}
                                            />
                                        </div>
                                        
                                        <div className="pt-4 border-t border-gray-150 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="col-span-2 text-[11px] text-gray-500 font-medium">
                                                Deje los campos de contraseña vacíos si no desea cambiar su clave de acceso.
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Nueva Contraseña</label>
                                                <input 
                                                    type="password" 
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 transition-shadow"
                                                    value={formData.newPassword}
                                                    onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                                                    autoComplete="new-password"
                                                    placeholder="Mínimo 4 caracteres"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Confirmar Nueva Contraseña</label>
                                                <input 
                                                    type="password" 
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-900 transition-shadow"
                                                    value={formData.confirmPassword}
                                                    onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                                                    autoComplete="new-password"
                                                    placeholder="Repita la clave"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
                    <div>
                        {currentStep > 1 ? (
                            <button 
                                type="button"
                                onClick={handlePrevStep}
                                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                                disabled={isSaving}
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Atrás
                            </button>
                        ) : (
                            <button 
                                type="button"
                                onClick={() => setIsEditModalOpen(false)}
                                className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                disabled={isSaving}
                            >
                                Cancelar
                            </button>
                        )}
                    </div>

                    <div className="flex gap-3">
                        {currentStep > 1 && (
                            <button 
                                type="button"
                                onClick={() => setIsEditModalOpen(false)}
                                className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                disabled={isSaving}
                            >
                                Cancelar
                            </button>
                        )}
                        
                        {currentStep < 3 ? (
                            <button 
                                type="button"
                                onClick={handleNextStep}
                                className="bg-gray-900 hover:bg-black text-white font-bold py-2.5 px-6 rounded-lg shadow-md transition-all flex items-center gap-2 text-sm"
                                disabled={isSaving}
                            >
                                Siguiente
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        ) : (
                            <button 
                                type="button"
                                onClick={handleSave}
                                disabled={isSaving}
                                className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-md transition-all flex items-center gap-2 text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Guardar Cambios
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )}
    </>
  );
};
