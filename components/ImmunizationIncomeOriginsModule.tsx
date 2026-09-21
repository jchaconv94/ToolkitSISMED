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
  Trash2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { getImmunizationScope, immunizationApi } from "../services/immunizationApi";
import { ImmunizationIncomeOrigin } from "../types";
import { ImmunizationKpiCard, immunizationInputClass as inputClassName, normalizeImmunizationText as normalizeText, ImmunizationTableHeader as HeaderCell } from "./ui/immunization";

interface ImmunizationIncomeOriginsModuleProps {
  onBack?: () => void;
}

export const ImmunizationIncomeOriginsModule: React.FC<ImmunizationIncomeOriginsModuleProps> = ({ onBack }) => {
  const { user } = useAuth();
  const scope = useMemo(() => getImmunizationScope(user), [user]);
  const canManage = scope.level === "GLOBAL" || scope.ownerType === "DIRESA" || scope.level === "DIRESA";

  const [origins, setOrigins] = useState<ImmunizationIncomeOrigin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrigin, setEditingOrigin] = useState<ImmunizationIncomeOrigin | null>(null);
  const [formName, setFormName] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ImmunizationIncomeOrigin | null>(null);

  const loadOrigins = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await immunizationApi.listIncomeOrigins(true);
      setOrigins(rows);
    } catch {
      toast.error("No se pudieron cargar los orígenes de ingreso.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrigins();
  }, [loadOrigins]);

  const filteredOrigins = useMemo(() => {
    const query = normalizeText(search);
    return origins.filter(origin => !query || normalizeText(origin.name).includes(query));
  }, [origins, search]);

  const totals = useMemo(() => ({
    all: origins.length,
    active: origins.filter(origin => origin.isActive !== false).length,
    inactive: origins.filter(origin => origin.isActive === false).length
  }), [origins]);

  const openCreate = () => {
    setEditingOrigin(null);
    setFormName("");
    setFormActive(true);
    setFormOpen(true);
  };

  const openEdit = (origin: ImmunizationIncomeOrigin) => {
    setEditingOrigin(origin);
    setFormName(origin.name);
    setFormActive(origin.isActive !== false);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingOrigin(null);
    setFormName("");
    setFormActive(true);
  };

  const saveOrigin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = formName.trim();
    if (!name) {
      toast.warning("Ingrese el nombre del origen.");
      return;
    }
    setSaving(true);
    try {
      const result = await immunizationApi.saveIncomeOrigin({
        ...editingOrigin,
        name,
        isActive: formActive,
        createdBy: editingOrigin?.createdBy || user?.username,
        updatedBy: user?.username
      });
      if (!result.success || !result.origin) {
        toast.error(result.message || "No se pudo guardar el origen.");
        return;
      }
      setOrigins(current => [
        ...current.filter(row => row.id !== result.origin?.id),
        result.origin as ImmunizationIncomeOrigin
      ].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(editingOrigin ? "Origen actualizado" : "Origen registrado");
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  const deactivateOrigin = async () => {
    if (!deleteTarget?.id) return;
    setSaving(true);
    try {
      const result = await immunizationApi.deleteIncomeOrigin(deleteTarget.id, user?.username);
      if (!result.success) {
        toast.error(result.message || "No se pudo eliminar el origen.");
        return;
      }
      setOrigins(current => current.map(origin => origin.id === deleteTarget.id
        ? { ...origin, isActive: false, updatedBy: user?.username, updatedAt: new Date().toISOString() }
        : origin
      ));
      toast.success("Origen desactivado");
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const reactivateOrigin = async (origin: ImmunizationIncomeOrigin) => {
    setSaving(true);
    try {
      const result = await immunizationApi.saveIncomeOrigin({
        ...origin,
        isActive: true,
        updatedBy: user?.username
      });
      if (!result.success || !result.origin) {
        toast.error(result.message || "No se pudo reactivar el origen.");
        return;
      }
      setOrigins(current => current.map(row => row.id === result.origin?.id ? result.origin as ImmunizationIncomeOrigin : row));
      toast.success("Origen reactivado");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-2 animate-in fade-in duration-300">
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
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-teal-700">Catálogo DIRESA</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadOrigins()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 shadow-2xs disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar
          </button>
          {canManage && (
            <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-teal-700">
              <Plus className="h-4 w-4" />Nuevo origen
            </button>
          )}
        </div>
      </div>

      {!canManage && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-black">Mantenimiento restringido</h3>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Solo DIRESA o administrador puede crear, editar o eliminar orígenes de ingreso.
            </p>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ImmunizationKpiCard label="Total" value={totals.all} tone="info" />
        <ImmunizationKpiCard label="Activos" value={totals.active} tone="success" />
        <ImmunizationKpiCard label="Inactivos" value={totals.inactive} tone="neutral" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Catálogo de orígenes</h3>
            <p className="mt-1 text-xs text-slate-500">Busca, edita o desactiva los orígenes disponibles para ingresos regionales.</p>
          </div>
          <div className="relative w-full md:w-96">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100" placeholder="Buscar origen..." />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 p-10 text-sm font-bold text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-teal-600" />Cargando orígenes...
          </div>
        ) : filteredOrigins.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-black text-slate-700">No hay orígenes para mostrar.</p>
            <p className="mt-1 text-xs text-slate-500">Registra un origen para habilitarlo en el formulario de ingreso regional.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <HeaderCell>Origen</HeaderCell>
                  <HeaderCell>Estado</HeaderCell>
                  <HeaderCell>Última actualización</HeaderCell>
                  <HeaderCell align="right">Acciones</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrigins.map(origin => (
                  <tr key={origin.id || origin.name} className="hover:bg-slate-50/80">
                    <td className="px-4 py-4">
                      <p className="text-sm font-black text-slate-900">{origin.name}</p>
                      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Origen de ingreso regional</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${origin.isActive !== false ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"}`}>
                        {origin.isActive !== false ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs font-semibold text-slate-500">
                      {origin.updatedAt ? new Date(origin.updatedAt).toLocaleString("es-PE") : "-"}
                      {origin.updatedBy && <span className="block text-[10px] uppercase tracking-wide text-slate-400">por {origin.updatedBy}</span>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openEdit(origin)} disabled={!canManage || saving} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                          <Edit3 className="h-4 w-4" />Editar
                        </button>
                        {origin.isActive === false ? (
                          <button type="button" onClick={() => void reactivateOrigin(origin)} disabled={!canManage || saving} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">
                            <CheckCircle2 className="h-4 w-4" />Reactivar
                          </button>
                        ) : (
                          <button type="button" onClick={() => setDeleteTarget(origin)} disabled={!canManage || saving} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40">
                            <Trash2 className="h-4 w-4" />Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formOpen && (
        <div className="fixed inset-0 z-[1190000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <form onSubmit={saveOrigin} className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-teal-50 to-white px-6 py-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">Catálogo de orígenes</p>
                <h3 className="mt-1 text-lg font-black text-slate-900">{editingOrigin ? "Editar origen" : "Nuevo origen"}</h3>
                <p className="mt-1 text-xs text-slate-500">Este dato aparecerá en el selector de ingresos regionales.</p>
              </div>
              <button type="button" onClick={closeForm} disabled={saving} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-700">Nombre del origen <span className="text-red-500">*</span></span>
                <input value={formName} onChange={event => setFormName(event.target.value)} disabled={saving} className={inputClassName} placeholder="Ej. CENARES, OGESS Alto Mayo, transferencia regional..." autoFocus />
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <input type="checkbox" checked={formActive} onChange={event => setFormActive(event.target.checked)} disabled={saving} className="h-4 w-4 rounded border border-slate-300 text-teal-600 focus:ring-teal-500" />
                <span>
                  <span className="block text-sm font-black text-slate-800">Origen activo</span>
                  <span className="block text-xs text-slate-500">Si está inactivo, no se mostrará al registrar ingresos.</span>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button type="button" onClick={closeForm} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                Cancelar
              </button>
              <button type="submit" disabled={saving || !formName.trim()} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-black text-white hover:bg-teal-700 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[1190001] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3 border-b border-slate-100 bg-red-50 px-6 py-5">
              <div className="rounded-2xl bg-white p-3 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Desactivar origen</h3>
                <p className="mt-1 text-sm text-slate-600">
                  El origen <span className="font-black">{deleteTarget.name}</span> dejará de aparecer en nuevos ingresos. El histórico no se elimina.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 bg-white px-6 py-4">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                Cancelar
              </button>
              <button type="button" onClick={() => void deactivateOrigin()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Desactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

