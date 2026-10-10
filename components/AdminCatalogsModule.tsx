import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { Plus, Trash2, Edit, Save, Search, FileText, Briefcase, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useIsDesktop } from './ui/useIsDesktop';
import { FloatingActionButton } from './ui/FloatingActionButton';
import { ResponsiveDialog, dialogPrimaryButton, dialogSecondaryButton } from './ui/ResponsiveDialog';
import { ConfirmationDialog } from './ui/ConfirmationDialog';
import { FormField, inputClass } from './ui/kit';

interface CatalogItem {
  id: string;
  name: string;
  description: string;
}

type CatalogKind = 'regime' | 'profession';
type CatalogForm = { kind: CatalogKind; id?: string; name: string; description: string };

interface AdminCatalogsModuleProps {
  onChanged: () => void;
  /** Usuarios cargados en Administración: para contar quién tiene asignado cada elemento. */
  users: any[];
}

const KIND_TEXT: Record<CatalogKind, { title: string; subtitle: string; one: string; newLabel: string; editTitle: string; newTitle: string; nameHint: string; descHint: string; lacks: string }> = {
  regime: {
    title: 'Regímenes laborales',
    subtitle: 'Modalidad de contrato del personal',
    one: 'régimen',
    newLabel: 'Nuevo régimen',
    editTitle: 'Editar régimen laboral',
    newTitle: 'Nuevo régimen laboral',
    nameHint: 'Ej.: D.L. 1057 (CAS)',
    descHint: 'Ej.: Contrato administrativo de servicios',
    lacks: 'sin régimen laboral',
  },
  profession: {
    title: 'Profesiones',
    subtitle: 'Profesión u ocupación del personal',
    one: 'profesión',
    newLabel: 'Nueva profesión',
    editTitle: 'Editar profesión',
    newTitle: 'Nueva profesión',
    nameHint: 'Ej.: Químico Farmacéutico',
    descHint: 'Ej.: Personal profesional de farmacia',
    lacks: 'sin profesión',
  },
};

const usersLabel = (n: number) => (n ? `${n} ${n === 1 ? 'usuario' : 'usuarios'}` : 'Sin usuarios');

/**
 * Regímenes laborales y profesiones (Administración). En escritorio, las dos listas lado a
 * lado; en el celular, una pestaña para cada una. Crear y editar van en `ResponsiveDialog`;
 * eliminar, en `ConfirmationDialog` con cuántos usuarios quedan sin ese dato.
 */
export const AdminCatalogsModule: React.FC<AdminCatalogsModuleProps> = ({ onChanged, users }) => {
  const { user, can } = useAuth();
  const isSuperAdmin = user?.role === 'ADMIN';
  // Acciones que el rol puede usar (Configuración de Roles).
  const canCreate = can('ADMIN_CATALOGS', 'create');
  const canEdit = can('ADMIN_CATALOGS', 'edit');
  const canDelete = isSuperAdmin && can('ADMIN_CATALOGS', 'delete');
  const isDesktop = useIsDesktop();

  const [regimes, setRegimes] = useState<CatalogItem[]>([]);
  const [professions, setProfessions] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState<Record<CatalogKind, string>>({ regime: '', profession: '' });
  const [mobileTab, setMobileTab] = useState<CatalogKind>('regime');
  const [form, setForm] = useState<CatalogForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toDelete, setToDelete] = useState<{ kind: CatalogKind; id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [rData, pData] = await Promise.all([
        api.getLaborRegimes(),
        api.getProfessions()
      ]);
      setRegimes(rData);
      setProfessions(pData);
    } catch (e) {
      toast.error('Error al cargar catálogos');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Cuántos usuarios tienen asignado cada régimen y cada profesión.
  const usage = useMemo(() => {
    const regime = new Map<string, number>();
    const profession = new Map<string, number>();
    users.forEach(u => {
      const p = u.personnel;
      const rId = p?.laborRegimeId || p?.laborRegimeData?.id;
      const pId = p?.professionId || p?.professionData?.id;
      if (rId) regime.set(rId, (regime.get(rId) || 0) + 1);
      if (pId) profession.set(pId, (profession.get(pId) || 0) + 1);
    });
    return { regime, profession };
  }, [users]);

  const itemsOf = (kind: CatalogKind) => (kind === 'regime' ? regimes : professions);
  const filtered = (kind: CatalogKind) => {
    const q = search[kind].toLowerCase();
    return itemsOf(kind).filter(item => item.name.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form?.name.trim()) return;
    const { kind, ...data } = form;
    setIsSaving(true);
    const tid = toast.loading(kind === 'regime' ? 'Guardando régimen...' : 'Guardando profesión...');
    try {
      const res = kind === 'regime' ? await api.saveLaborRegime(data) : await api.saveProfession(data);
      if (res.success) {
        toast.success(kind === 'regime' ? 'Régimen laboral guardado' : 'Profesión guardada', { id: tid });
        setForm(null);
        await loadData();
        onChanged();
      } else {
        toast.error(res.message || 'Error al guardar', { id: tid });
      }
    } catch (err: any) {
      toast.error(err.message, { id: tid });
    } finally {
      setIsSaving(false);
    }
  };

  const executeDelete = async () => {
    if (!toDelete) return;
    const { kind, id } = toDelete;
    setIsDeleting(true);
    const tid = toast.loading(kind === 'regime' ? 'Eliminando régimen...' : 'Eliminando profesión...');
    try {
      const res = kind === 'regime' ? await api.deleteLaborRegime(id) : await api.deleteProfession(id);
      if (res.success) {
        toast.success(kind === 'regime' ? 'Régimen laboral eliminado' : 'Profesión eliminada', { id: tid });
        setToDelete(null);
        await loadData();
        onChanged();
      } else {
        toast.error(res.message || 'Error al eliminar', { id: tid });
      }
    } catch (err: any) {
      toast.error(err.message, { id: tid });
    } finally {
      setIsDeleting(false);
    }
  };

  const renderList = (kind: CatalogKind) => {
    const text = KIND_TEXT[kind];
    const counts = usage[kind];
    const items = filtered(kind);
    const Icon = kind === 'regime' ? FileText : Briefcase;
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isDesktop && (
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><Icon className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-black text-slate-900">{text.title} <span className="font-semibold text-slate-400">· {itemsOf(kind).length}</span></h3>
              <p className="text-[12.5px] text-slate-500">{text.subtitle}</p>
            </div>
            {canCreate && <button
              type="button"
              onClick={() => setForm({ kind, name: '', description: '' })}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-teal-600 px-3 text-[13px] font-bold text-white transition-colors hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" /> {text.newLabel}
            </button>}
          </div>
        )}
        <div className="border-b border-slate-100 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={kind === 'regime' ? 'Buscar régimen…' : 'Buscar profesión…'}
              aria-label={kind === 'regime' ? 'Buscar régimen' : 'Buscar profesión'}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              value={search[kind]}
              onChange={e => setSearch(prev => ({ ...prev, [kind]: e.target.value }))}
            />
          </div>
        </div>
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {kind === 'regime' ? 'No se encontraron regímenes.' : 'No se encontraron profesiones.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map(item => {
              const n = counts.get(item.id) || 0;
              return (
                <div key={item.id} className="flex min-h-[60px] items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[14px] font-bold text-slate-900">{item.name}</p>
                    <p className="text-[12.5px] text-slate-500">
                      {item.description ? `${item.description} · ` : ''}
                      <span className={n ? 'text-slate-600' : 'text-slate-400'}>{usersLabel(n)}</span>
                    </p>
                  </div>
                  {canEdit && <button
                    type="button"
                    onClick={() => setForm({ kind, id: item.id, name: item.name, description: item.description || '' })}
                    title="Editar"
                    aria-label={`Editar ${item.name}`}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-teal-50 hover:text-teal-600"
                  >
                    <Edit className="h-[18px] w-[18px]" />
                  </button>}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => setToDelete({ kind, id: item.id, name: item.name })}
                      title="Eliminar"
                      aria-label={`Eliminar ${item.name}`}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-red-600"
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <div className="w-8 h-8 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
        <span className="text-slate-500 font-medium text-sm">Cargando catálogos del sistema...</span>
      </div>
    );
  }

  const formText = form ? KIND_TEXT[form.kind] : null;
  const formUsers = form?.id ? usage[form.kind].get(form.id) || 0 : 0;
  const deleteUsers = toDelete ? usage[toDelete.kind].get(toDelete.id) || 0 : 0;

  return (
    <div className="animate-in fade-in duration-300">
      {isDesktop ? (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {renderList('regime')}
          {renderList('profession')}
        </div>
      ) : (
        <>
          <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1">
            {(['regime', 'profession'] as CatalogKind[]).map(kind => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={mobileTab === kind}
                onClick={() => setMobileTab(kind)}
                className={`flex h-10 items-center justify-center rounded-lg text-[13.5px] font-bold transition-colors ${mobileTab === kind ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-600'}`}
              >
                {kind === 'regime' ? 'Regímenes' : 'Profesiones'} · {itemsOf(kind).length}
              </button>
            ))}
          </div>
          {renderList(mobileTab)}
          {canCreate && <FloatingActionButton icon={<Plus />} label={KIND_TEXT[mobileTab].newLabel} onClick={() => setForm({ kind: mobileTab, name: '', description: '' })} />}
        </>
      )}

      {/* Nuevo / editar */}
      <ResponsiveDialog
        open={!!form}
        onClose={() => setForm(null)}
        onSubmit={handleSave}
        busy={isSaving}
        title={form?.id ? formText?.editTitle || '' : formText?.newTitle || ''}
        subtitle={form?.id ? `${form.name} · ${usersLabel(formUsers)}` : undefined}
        footer={
          <>
            <button type="button" onClick={() => setForm(null)} className={dialogSecondaryButton}>Cancelar</button>
            <button type="submit" disabled={isSaving || !form?.name.trim()} className={dialogPrimaryButton}>
              <Save className="h-4 w-4" /> {isSaving ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        }
      >
        {form && formText && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <FormField label="Nombre" required>
              <input
                type="text"
                required
                autoFocus
                placeholder={formText.nameHint}
                className={inputClass}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <FormField label="Descripción" hint="Opcional. Ayuda a elegir el correcto.">
              <input
                type="text"
                placeholder={formText.descHint}
                className={inputClass}
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
              />
            </FormField>
            {form.id && formUsers > 0 && (
              <p className="text-[12.5px] text-slate-500">{formUsers === 1 ? 'El cambio se verá en el usuario que lo tiene asignado.' : `El cambio se verá en los ${formUsers} usuarios que lo tienen asignado.`}</p>
            )}
          </div>
        )}
      </ResponsiveDialog>

      {/* Eliminar */}
      <ConfirmationDialog
        isOpen={!!toDelete}
        tone="danger"
        icon={<Trash2 />}
        isConfirming={isDeleting}
        title={`¿Eliminar «${toDelete?.name || ''}»?`}
        description="Ya no se podrá elegir al registrar personal."
        confirmLabel="Eliminar"
        onConfirm={executeDelete}
        onCancel={() => setToDelete(null)}
      >
        {deleteUsers > 0 && toDelete && (
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{deleteUsers} {deleteUsers === 1 ? 'usuario lo tiene asignado y quedará' : 'usuarios lo tienen asignado y quedarán'} {KIND_TEXT[toDelete.kind].lacks}.</span>
          </div>
        )}
      </ConfirmationDialog>
    </div>
  );
};
