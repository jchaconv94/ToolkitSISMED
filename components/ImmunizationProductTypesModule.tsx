import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { getImmunizationScope, immunizationApi } from "../services/immunizationApi";
import { ImmunizationProductTypeItem } from "../types";
import {
  ImmunizationField,
  ImmunizationKpiCard,
  ImmunizationStatusChip,
  ImmunizationTableHeader as HeaderCell,
  immunizationInputClass as inputClassName,
  normalizeImmunizationText as normalizeText
} from "./ui/immunization";

interface ImmunizationProductTypesModuleProps {
  onBack?: () => void;
}

export const ImmunizationProductTypesModule: React.FC<ImmunizationProductTypesModuleProps> = ({ onBack }) => {
  const { user } = useAuth();
  const scope = useMemo(() => getImmunizationScope(user), [user]);
  const canManage = scope.level === "GLOBAL" || scope.ownerType === "DIRESA" || scope.level === "DIRESA";

  const [types, setTypes] = useState<ImmunizationProductTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingType, setEditingType] = useState<ImmunizationProductTypeItem | null>(null);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formActive, setFormActive] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<ImmunizationProductTypeItem | null>(null);

  const generateUniqueProductTypeCode = (existingTypes: ImmunizationProductTypeItem[]): string => {
    const tpNumbers = existingTypes
      .map(t => t.code)
      .filter(code => /^TP-\d+$/i.test(code))
      .map(code => parseInt(code.replace(/^TP-/i, ""), 10))
      .filter(num => !isNaN(num));

    const maxNum = tpNumbers.length > 0 ? Math.max(...tpNumbers) : 0;
    const nextNum = maxNum + 1;
    const padded = String(nextNum).padStart(3, "0");
    return `TP-${padded}`;
  };

  const loadTypes = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await immunizationApi.listProductTypes(true);
      setTypes(rows);
    } catch {
      toast.error("No se pudieron cargar los tipos de producto.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const filteredTypes = useMemo(() => {
    const query = normalizeText(search);
    return types.filter(item =>
      !query ||
      normalizeText(item.code).includes(query) ||
      normalizeText(item.name).includes(query) ||
      normalizeText(item.description || "").includes(query)
    );
  }, [types, search]);

  const totals = useMemo(() => ({
    all: types.length,
    active: types.filter(item => item.isActive !== false).length,
    inactive: types.filter(item => item.isActive === false).length
  }), [types]);

  const openCreate = () => {
    setEditingType(null);
    setFormName("");
    setFormDescription("");
    setFormActive(true);
    setFormOpen(true);
  };

  const openEdit = (typeItem: ImmunizationProductTypeItem) => {
    setEditingType(typeItem);
    setFormName(typeItem.name);
    setFormDescription(typeItem.description || "");
    setFormActive(typeItem.isActive !== false);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingType(null);
    setFormName("");
    setFormDescription("");
    setFormActive(true);
  };

  const saveTypeItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = formName.trim();
    if (!name) {
      toast.warning("Ingrese el nombre del tipo de producto.");
      return;
    }

    const normalizedNewName = normalizeText(name);
    const duplicate = types.find(
      t => t.id !== editingType?.id && normalizeText(t.name) === normalizedNewName
    );
    if (duplicate) {
      toast.warning(`Ya existe un tipo de producto registrado con el nombre "${duplicate.name}".`);
      return;
    }

    const code = editingType ? editingType.code : generateUniqueProductTypeCode(types);
    setSaving(true);
    try {
      const result = await immunizationApi.saveProductType({
        ...editingType,
        code,
        name,
        description: formDescription.trim() || undefined,
        isActive: formActive,
        createdBy: editingType?.createdBy || user?.username,
        updatedBy: user?.username
      });
      if (!result.success || !result.typeItem) {
        toast.error(result.message || "No se pudo guardar el tipo de producto.");
        return;
      }
      setTypes(current => [
        ...current.filter(row => row.id !== result.typeItem?.id),
        result.typeItem as ImmunizationProductTypeItem
      ].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(editingType ? "Tipo de producto actualizado" : "Tipo de producto registrado");
      closeForm();
    } catch (err: any) {
      console.error("Error guardando tipo de producto:", err);
      toast.error(err?.message || "Ocurrió un error al guardar el tipo de producto.");
    } finally {
      setSaving(false);
    }
  };

  const deactivateType = async () => {
    if (!deleteTarget?.id) return;
    setSaving(true);
    try {
      const result = await immunizationApi.deleteProductType(deleteTarget.id, user?.username);
      if (!result.success) {
        toast.error(result.message || "No se pudo desactivar el tipo de producto.");
        return;
      }
      setTypes(current => current.map(item => item.id === deleteTarget.id
        ? { ...item, isActive: false, updatedBy: user?.username, updatedAt: new Date().toISOString() }
        : item
      ));
      toast.success("Tipo de producto desactivado");
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const reactivateType = async (typeItem: ImmunizationProductTypeItem) => {
    setSaving(true);
    try {
      const result = await immunizationApi.saveProductType({
        ...typeItem,
        isActive: true,
        updatedBy: user?.username
      });
      if (!result.success || !result.typeItem) {
        toast.error(result.message || "No se pudo reactivar el tipo de producto.");
        return;
      }
      setTypes(current => current.map(row => row.id === result.typeItem?.id ? result.typeItem as ImmunizationProductTypeItem : row));
      toast.success("Tipo de producto reactivado");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4 text-slate-500" />
          Volver a Configuraciones
        </button>
      )}

      {/* Header Banner */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-teal-50 p-3 text-teal-700">
              <Tag className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-slate-900">Tipos de Producto</h2>
                <span className="rounded-lg border border-teal-100 bg-teal-50 px-2 py-1 text-[10px] font-black uppercase text-teal-700">
                  Catálogo DIRESA
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Administra la clasificación de productos biológicos, insumos y accesorios del sistema.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void loadTypes()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
            {canManage && (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-teal-700"
              >
                <Plus className="h-4 w-4" />
                Nuevo tipo
              </button>
            )}
          </div>
        </div>
      </section>

      {!canManage && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-black">Mantenimiento restringido</h3>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Solo el perfil DIRESA o Administrador puede crear, editar o desactivar tipos de producto.
            </p>
          </div>
        </section>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ImmunizationKpiCard label="Total Tipos" value={totals.all} tone="info" icon={<Tag className="h-5 w-5" />} />
        <ImmunizationKpiCard label="Activos" value={totals.active} tone="success" icon={<CheckCircle2 className="h-5 w-5" />} />
        <ImmunizationKpiCard label="Inactivos" value={totals.inactive} tone="neutral" icon={<AlertTriangle className="h-5 w-5" />} />
      </div>

      {/* Main Table Section */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Catálogo de Tipos</h3>
            <p className="mt-1 text-xs text-slate-500">Busca, edita o gestiona los tipos disponibles para productos.</p>
          </div>
          <div className="relative w-full md:w-96">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
              placeholder="Buscar tipo de producto..."
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 p-10 text-sm font-bold text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
            Cargando tipos de producto...
          </div>
        ) : filteredTypes.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-black text-slate-700">No hay tipos de producto para mostrar.</p>
            <p className="mt-1 text-xs text-slate-500">Registra un nuevo tipo para habilitarlo en la gestión del catálogo biológico.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <HeaderCell>Código</HeaderCell>
                  <HeaderCell>Nombre / Descripción</HeaderCell>
                  <HeaderCell>Estado</HeaderCell>
                  <HeaderCell align="right">Acciones</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTypes.map(item => {
                  const isActive = item.isActive !== false;
                  return (
                    <tr key={item.id || item.code} className="hover:bg-slate-50/80 transition-colors">
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs font-mono font-bold text-slate-900">
                        <span className="rounded-md bg-slate-100 px-2 py-1 border border-slate-200 text-slate-800">
                          {item.code}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs font-bold text-slate-900">{item.name}</p>
                        {item.description && (
                          <p className="mt-0.5 text-[11px] text-slate-500">{item.description}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs">
                        <ImmunizationStatusChip
                          label={isActive ? "Activo" : "Inactivo"}
                          tone={isActive ? "success" : "neutral"}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right text-xs font-medium">
                        {canManage && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                              title="Editar tipo"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            {isActive ? (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(item)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                                title="Desactivar tipo"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Desactivar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void reactivateType(item)}
                                disabled={saving}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                                title="Reactivar tipo"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Reactivar
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal Form */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4">
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {editingType ? "Editar Tipo de Producto" : "Nuevo Tipo de Producto"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={e => { void saveTypeItem(e); }} className="p-6 space-y-4">
              <ImmunizationField label="Nombre del tipo" required>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Ej: Dispositivo Médico"
                  disabled={saving}
                  className={inputClassName}
                />
              </ImmunizationField>

              <ImmunizationField label="Descripción corta (opcional)">
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Ej: Jeringas, agujas y material descartable de aplicación"
                  disabled={saving}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                />
              </ImmunizationField>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="formActiveCheck"
                  checked={formActive}
                  onChange={e => setFormActive(e.target.checked)}
                  disabled={saving}
                  className="h-4 w-4 rounded border border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <label htmlFor="formActiveCheck" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Tipo activo (disponible en selector de productos)
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-teal-700 transition-colors disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingType ? "Guardar cambios" : "Registrar tipo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2.5 text-red-600 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Desactivar tipo de producto?</h3>
                <p className="mt-1 text-xs text-slate-500">
                  El tipo <strong className="text-slate-800">{deleteTarget.name} ({deleteTarget.code})</strong> quedará inactivo. Los productos existentes no se eliminarán pero no aparecerá en nuevos registros.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void deactivateType()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Sí, desactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
