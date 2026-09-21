import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FilterX,
  FileText,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { CustomSelect } from "./ui/CustomSelect";
import {
  getCurrentImmunizationPeriod,
  getImmunizationScope,
  ImmunizationScope,
  immunizationApi
} from "../services/immunizationApi";
import {
  HealthFacility,
  ImmunizationDistributionBatch,
  ImmunizationDistributionCriterion,
  ImmunizationDistributionFlow,
  ImmunizationDistributionItem,
  ImmunizationDistributionStatus,
  ImmunizationProduct,
  ImmunizationReceptionInput,
  ImmunizationReceptionReason,
  ImmunizationStockLayer,
  Unget
} from "../types";
import { distributionDestinationUngetId, distributionOriginUngetId, distributionFlow } from "../services/immunizationDomain";
import { immunizationInputClass as inputClassName, normalizeImmunizationText as normalizeText, ImmunizationTableHeader as HeaderCell, ImmunizationField as Field, formatImmunizationDate as formatDate, ImmunizationKpiCard, immunizationSelectClass as selectClassName } from "./ui/immunization";

type DistributionItemDraft = ImmunizationDistributionItem & { tempId: string };
type AllocationMode = "FEFO" | "MANUAL";

interface StockProductGroup {
  productId: string;
  product: ImmunizationProduct;
  layers: ImmunizationStockLayer[];
  total: number;
}

const currentPeriod = getCurrentImmunizationPeriod();
const statusLabel = (status: ImmunizationDistributionStatus) => {
  if (status === "SENT") return "Pendiente recepcion";
  if (status === "RECEIVED") return "Recibido";
  if (status === "OBSERVED") return "Observado";
  if (status === "VOIDED") return "Anulado";
  return "Borrador";
};

const criterionLabel = (criterion?: ImmunizationDistributionCriterion) => {
  if (criterion === "CONSUMPTION") return "Consumo";
  if (criterion === "AVAILABILITY") return "Disponibilidad";
  if (criterion === "CAMPAIGN") return "Campaña";
  if (criterion === "OTHER") return "Otro criterio";
  return "Regular";
};

const DEFAULT_REGIONAL_WAREHOUSE_ID = "DIRESA_SAN_MARTIN_REGIONAL";

export const ImmunizationDistributionsModule: React.FC = () => {
  const { user } = useAuth();
  const userScope = useMemo(() => getImmunizationScope(user), [user]);
  const isAdmin = userScope.level === "GLOBAL";
  const isRegionalOperator = isAdmin || userScope.ownerType === "DIRESA" || userScope.level === "DIRESA";
  const isSupervisorView = isAdmin || ["DIRESA", "OGESS"].includes(userScope.level);
  const isIpressUser = userScope.level === "IPRESS" && Boolean(userScope.facilityCode);
  const operationFlow: ImmunizationDistributionFlow = isRegionalOperator ? "DIRESA_UNGET" : "UNGET_IPRESS";

  const [ungets, setUngets] = useState<Unget[]>([]);
  const [facilities, setFacilities] = useState<HealthFacility[]>([]);
  const [distributions, setDistributions] = useState<ImmunizationDistributionBatch[]>([]);
  const [detailByDistribution, setDetailByDistribution] = useState<Record<string, ImmunizationDistributionItem[]>>({});
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState("");
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const [receivingId, setReceivingId] = useState("");
  const [receptionOpen, setReceptionOpen] = useState(false);
  const [receptionDistribution, setReceptionDistribution] = useState<ImmunizationDistributionBatch | null>(null);
  const [receptionItems, setReceptionItems] = useState<ImmunizationDistributionItem[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [stockLayers, setStockLayers] = useState<ImmunizationStockLayer[]>([]);
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState(currentPeriod);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ImmunizationDistributionStatus>("ALL");
  const [criterionFilter, setCriterionFilter] = useState<"ALL" | ImmunizationDistributionCriterion>("ALL");
  const [ungetFilter, setUngetFilter] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showDateFilters, setShowDateFilters] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getUngets(), api.getFacilities()])
      .then(([ungetRows, facilityRows]) => {
        if (!active) return;
        const sortedUngets = [...ungetRows].sort((a, b) => a.name.localeCompare(b.name));
        const sortedFacilities = [...facilityRows].sort((a, b) => a.name.localeCompare(b.name));
        setUngets(sortedUngets);
        setFacilities(sortedFacilities);
      })
      .catch(() => toast.error("No se pudo cargar la organizacion"));
    return () => { active = false; };
  }, []);

  const listScope = useMemo<ImmunizationScope>(() => {
    if (userScope.ownerType === "DIRESA" || userScope.ownerType === "UNGET" || userScope.level === "IPRESS") return userScope;
    return { level: userScope.level, diresaId: userScope.diresaId, ogessId: userScope.ogessId };
  }, [userScope]);

  const currentUngetId = userScope.ownerType === "UNGET"
      ? userScope.ungetId || ""
      : "";

  const selectedUnget = ungets.find(unget => unget.id === currentUngetId);
  const canCreateRegional = isRegionalOperator;
  const canCreateUnget = Boolean(currentUngetId) && userScope.ownerType === "UNGET";
  const canCreate = canCreateRegional || canCreateUnget;

  const availableFilterUngets = useMemo(() => {
    if (userScope.level === "UNGET" && userScope.ungetId) return ungets.filter(unget => unget.id === userScope.ungetId);
    if (userScope.level === "OGESS" && userScope.ogessId) return ungets.filter(unget => unget.ogessId === userScope.ogessId);
    if (userScope.level === "DIRESA" && userScope.diresaId) return ungets.filter(unget => unget.diresaId === userScope.diresaId);
    return ungets;
  }, [ungets, userScope]);

  const availableFilterFacilities = useMemo(() => {
    const allowedUngetIds = new Set(availableFilterUngets.map(unget => unget.id));
    if (userScope.level === "IPRESS" && userScope.facilityCode) return facilities.filter(facility => facility.code === userScope.facilityCode);
    if (allowedUngetIds.size === 0) return facilities;
    return facilities.filter(facility => facility.ungetId && allowedUngetIds.has(facility.ungetId));
  }, [availableFilterUngets, facilities, userScope]);

  const destinationFacilities = useMemo(
    () => facilities.filter(facility => facility.ungetId === currentUngetId),
    [currentUngetId, facilities]
  );
  const destinationUngets = useMemo(() => {
    if (userScope.level === "OGESS" && userScope.ogessId) return ungets.filter(unget => unget.ogessId === userScope.ogessId);
    if (userScope.level === "DIRESA" && userScope.diresaId) return ungets.filter(unget => unget.diresaId === userScope.diresaId);
    return ungets;
  }, [ungets, userScope]);

  const loadDistributions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await immunizationApi.listDistributionBatches(listScope);
      setDistributions(rows);
      setExpandedId("");
      setDetailByDistribution({});
    } catch {
      toast.error("No se pudieron cargar las distribuciones");
    } finally {
      setLoading(false);
    }
  }, [listScope]);

  useEffect(() => {
    void loadDistributions();
  }, [loadDistributions]);

  const getDetails = async (distribution: ImmunizationDistributionBatch) => {
    const id = distribution.id || "";
    if (!id) return [];
    if (detailByDistribution[id]) return detailByDistribution[id];
    setLoadingDetailId(id);
    try {
      const items = await immunizationApi.getDistributionItems(id);
      setDetailByDistribution(current => ({ ...current, [id]: items }));
      return items;
    } catch {
      toast.error("No se pudo cargar el detalle de la distribucion");
      return [];
    } finally {
      setLoadingDetailId("");
    }
  };

  const toggleDetail = async (distribution: ImmunizationDistributionBatch) => {
    const id = distribution.id || "";
    if (expandedId === id) {
      setExpandedId("");
      return;
    }
    setExpandedId(id);
    await getDetails(distribution);
  };

  const openForm = async () => {
    if (!canCreate) {
      toast.warning("El usuario no tiene alcance operativo para distribuir.");
      return;
    }
    if (operationFlow === "DIRESA_UNGET" && destinationUngets.length === 0) {
      toast.warning("No hay UNGET disponibles como destino regional.");
      return;
    }
    if (operationFlow === "UNGET_IPRESS" && destinationFacilities.length === 0) {
      toast.warning("La UNGET seleccionada no tiene IPRESS vinculadas.");
      return;
    }
    setLoadingForm(true);
    try {
      const rows = operationFlow === "DIRESA_UNGET"
        ? await immunizationApi.getStockLayers({ level: "DIRESA", ownerType: "DIRESA" })
        : await immunizationApi.getStockLayers({ level: "UNGET", ownerType: "UNGET", ungetId: currentUngetId });
      const activeRows = rows.filter(layer => layer.isActive && layer.currentQuantity > 0);
      if (activeRows.length === 0) {
        toast.warning(operationFlow === "DIRESA_UNGET" ? "DIRESA no tiene stock regional disponible para distribuir." : "La UNGET no tiene stock disponible para distribuir.");
        return;
      }
      setStockLayers(activeRows);
      setFormOpen(true);
    } catch {
      toast.error(operationFlow === "DIRESA_UNGET" ? "No se pudo cargar el stock regional DIRESA" : "No se pudo cargar el stock UNGET");
    } finally {
      setLoadingForm(false);
    }
  };

  const saveAndSendDistribution = async (distribution: ImmunizationDistributionBatch, items: ImmunizationDistributionItem[]) => {
    setSaving(true);
    try {
      const created = await immunizationApi.createDistributionBatch(distribution, items);
      if (!created.success || !created.distribution?.id) {
        toast.error(created.message || "No se pudo guardar la distribucion");
        return;
      }

      const sent = await immunizationApi.sendDistributionBatch(created.distribution.id, user?.username);
      if (!sent.success) {
        toast.warning(sent.message || "La distribucion quedo en borrador, pero no se pudo enviar.");
        setFormOpen(false);
        await loadDistributions();
        return;
      }

      toast.success(operationFlow === "DIRESA_UNGET" ? "Distribucion regional enviada y pendiente de aceptacion UNGET" : "Distribucion enviada y pendiente de aceptacion IPRESS");
      setFormOpen(false);
      await loadDistributions();
    } catch {
      toast.error("Ocurrio un error inesperado al registrar la distribucion");
    } finally {
      setSaving(false);
    }
  };

  const sendExistingDistribution = async (distribution: ImmunizationDistributionBatch) => {
    if (!distribution.id) return;
    setSendingId(distribution.id);
    try {
      const result = await immunizationApi.sendDistributionBatch(distribution.id, user?.username);
      if (!result.success) {
        toast.error(result.message || "No se pudo enviar la distribucion");
        return;
      }
      toast.success(distributionFlow(distribution) === "DIRESA_UNGET" ? "Distribucion enviada a la UNGET" : "Distribucion enviada a la IPRESS");
      await loadDistributions();
    } finally {
      setSendingId("");
    }
  };

  const openReceptionModal = async (distribution: ImmunizationDistributionBatch) => {
    if (!distribution.id) return;
    setReceivingId(distribution.id);
    try {
      const items = await getDetails(distribution);
      if (items.length === 0) {
        toast.error("La distribucion no tiene detalle para recepcionar.");
        return;
      }
      setReceptionDistribution(distribution);
      setReceptionItems(items);
      setReceptionOpen(true);
    } finally {
      setReceivingId("");
    }
  };

  const receiveDistribution = async (distribution: ImmunizationDistributionBatch, reception: ImmunizationReceptionInput) => {
    if (!distribution.id) return;
    setReceivingId(distribution.id);
    try {
      const result = await immunizationApi.receiveDistributionBatch(distribution.id, user?.username, reception);
      if (!result.success) {
        toast.error(result.message || "No se pudo aceptar la recepcion");
        return;
      }
      const destinationLabel = result.distribution ? (distributionFlow(result.distribution) === "DIRESA_UNGET" ? "UNGET" : "IPRESS") : "destino";
      toast.success(result.distribution?.status === "OBSERVED" ? `Recepcion observada registrada y stock ${destinationLabel} actualizado.` : `Recepcion conforme. El stock ${destinationLabel} fue actualizado.`);
      setReceptionOpen(false);
      setReceptionDistribution(null);
      setReceptionItems([]);
      await loadDistributions();
    } finally {
      setReceivingId("");
    }
  };

  const periodOptions = useMemo(() => {
    const periods = new Set(distributions.map(distribution => distribution.period).filter(Boolean));
    periods.add(currentPeriod);
    return Array.from(periods).sort((a, b) => b.localeCompare(a));
  }, [distributions]);

  const visibleDistributions = useMemo(() => {
    const query = normalizeText(search);
    const allowedUngetIds = new Set(availableFilterUngets.map(unget => unget.id));
    const allowedFacilityCodes = new Set(availableFilterFacilities.map(facility => facility.code));

    return distributions.filter(distribution => {
      const flow = distribution.flowType || (distribution.destinationOwnerType === "UNGET" || distribution.destinationUngetId ? "DIRESA_UNGET" : "UNGET_IPRESS");
      const destinationUngetId = distribution.destinationUngetId || (flow === "DIRESA_UNGET" ? distribution.ungetId : undefined);
      const originUngetId = distribution.originUngetId || (flow === "UNGET_IPRESS" ? distribution.ungetId : undefined);
      const isIpressDestination = flow === "UNGET_IPRESS";
      if (userScope.level === "UNGET" && userScope.ungetId && originUngetId !== userScope.ungetId && destinationUngetId !== userScope.ungetId) return false;
      if (userScope.level === "IPRESS" && userScope.facilityCode && distribution.destinationFacilityCode !== userScope.facilityCode) return false;
      if (isSupervisorView && allowedUngetIds.size > 0 && !allowedUngetIds.has(distribution.ungetId) && (!destinationUngetId || !allowedUngetIds.has(destinationUngetId))) return false;
      if (isIpressDestination && allowedFacilityCodes.size > 0 && !allowedFacilityCodes.has(distribution.destinationFacilityCode)) return false;
      if (ungetFilter && distribution.ungetId !== ungetFilter && destinationUngetId !== ungetFilter) return false;
      if (facilityFilter && distribution.destinationFacilityCode !== facilityFilter) return false;
      if (periodFilter !== "ALL" && distribution.period !== periodFilter) return false;
      if (statusFilter !== "ALL" && distribution.status !== statusFilter) return false;
      if (criterionFilter !== "ALL" && distribution.criterion !== criterionFilter) return false;

      const distributionDate = (distribution.sentAt || distribution.createdAt || "").slice(0, 10);
      if (dateFrom && distributionDate && distributionDate < dateFrom) return false;
      if (dateTo && distributionDate && distributionDate > dateTo) return false;

      if (query) {
        const haystack = normalizeText([
          distribution.period,
          flow === "DIRESA_UNGET" ? "DIRESA Regional" : ungetName(originUngetId, ungets),
          flow === "DIRESA_UNGET" ? ungetName(destinationUngetId, ungets) : facilityName(distribution.destinationFacilityCode, facilities),
          criterionLabel(distribution.criterion),
          statusLabel(distribution.status),
          distribution.referenceDocument,
          distribution.observation,
          distribution.createdBy,
          distribution.sentBy,
          distribution.receivedBy
        ].filter(Boolean).join(" "));
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [availableFilterFacilities, availableFilterUngets, criterionFilter, dateFrom, dateTo, distributions, facilities, facilityFilter, isSupervisorView, periodFilter, search, statusFilter, ungetFilter, ungets, userScope]);

  /**
   * Etiquetas y permisos de una distribución.
   *
   * Lo usan la tabla de escritorio y las tarjetas de celular. Estaba calculado dentro del
   * `map` de la tabla; al extraerlo, ambas vistas comparten el mismo criterio y no pueden
   * desincronizarse.
   */
  const describeDistribution = useCallback((distribution: ImmunizationDistributionBatch) => {
    const flow = distributionFlow(distribution);
    const destinationUngetId = distributionDestinationUngetId(distribution);
    const originUngetId = distributionOriginUngetId(distribution);
    return {
      flow,
      originLabel: flow === "DIRESA_UNGET" ? "DIRESA Regional" : ungetName(originUngetId, ungets),
      originMeta: flow === "DIRESA_UNGET" ? "ALMACEN REGIONAL" : "UNGET",
      destinationLabel: flow === "DIRESA_UNGET"
        ? ungetName(destinationUngetId, ungets)
        : facilityName(distribution.destinationFacilityCode, facilities),
      destinationMeta: flow === "DIRESA_UNGET" ? "UNGET" : distribution.destinationFacilityCode,
      canSendDraft: distribution.status === "DRAFT" && (
        (flow === "DIRESA_UNGET" && isRegionalOperator) ||
        (flow === "UNGET_IPRESS" && canCreateUnget && originUngetId === currentUngetId)
      ),
      canReceiveSent: distribution.status === "SENT" && (
        (flow === "DIRESA_UNGET" && userScope.ownerType === "UNGET" && destinationUngetId === currentUngetId) ||
        (flow === "UNGET_IPRESS" && isIpressUser && distribution.destinationFacilityCode === userScope.facilityCode)
      )
    };
  }, [canCreateUnget, currentUngetId, facilities, isIpressUser, isRegionalOperator, ungets, userScope]);

  const hasFilters = Boolean(search || periodFilter !== currentPeriod || statusFilter !== "ALL" || criterionFilter !== "ALL" || ungetFilter || facilityFilter || dateFrom || dateTo);
  const clearFilters = () => {
    setSearch("");
    setPeriodFilter(currentPeriod);
    setStatusFilter("ALL");
    setCriterionFilter("ALL");
    setUngetFilter("");
    setFacilityFilter("");
    setDateFrom("");
    setDateTo("");
  };

  const totals = useMemo(() => ({
    total: visibleDistributions.length,
    sent: visibleDistributions.filter(distribution => distribution.status === "SENT").length,
    received: visibleDistributions.filter(distribution => distribution.status === "RECEIVED").length,
    observed: visibleDistributions.filter(distribution => distribution.status === "OBSERVED").length
  }), [visibleDistributions]);

  const pageTitle = isIpressUser
    ? "Recepciones IPRESS"
    : operationFlow === "DIRESA_UNGET"
      ? "Distribucion Regional"
      : "Distribucion a IPRESS";
  const pageDescription = isIpressUser
    ? "Acepta las distribuciones recibidas y valida el fisico por lote antes de incorporarlo al stock."
    : operationFlow === "DIRESA_UNGET"
      ? "Distribuye biologicos desde el almacen regional DIRESA hacia las UNGET. La UNGET debe aceptar la recepcion."
      : "Distribuye biologicos desde el stock de la UNGET hacia sus IPRESS. La IPRESS debe aceptar la recepcion.";
  const operationLabel = operationFlow === "DIRESA_UNGET"
    ? "Almacen regional DIRESA"
    : `UNGET ${selectedUnget?.name || "operativa"}`;

  return (
    <div className="space-y-4 pb-2 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-teal-700">Periodo {currentPeriod}</span>
          {(canCreate || isIpressUser) && (
            <span className="text-xs font-bold text-slate-600">
              Operación: <span className="font-black text-teal-700">{operationLabel}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadDistributions()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 shadow-2xs disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar
          </button>
          {canCreate && (
            <button type="button" onClick={() => void openForm()} disabled={loadingForm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-sky-800 disabled:opacity-60">
              {loadingForm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{loadingForm ? "Preparando..." : operationFlow === "DIRESA_UNGET" ? "Nueva distribución regional" : "Nueva distribución"}
            </button>
          )}
        </div>
      </div>

      {!canCreate && !isIpressUser && (
        <section className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-950">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-black">Vista de supervision de distribuciones</h3>
            <p className="mt-1 text-xs leading-5 text-blue-800">Puede consultar y filtrar distribuciones. El registro operativo lo realiza DIRESA para UNGET y la UNGET para IPRESS.</p>
          </div>
        </section>
      )}

      {isIpressUser && (
        <section className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-950">
          <PackageCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-black">Recepciones pendientes de tu IPRESS</h3>
            <p className="mt-1 text-xs leading-5 text-emerald-800">Confirma la cantidad fisica recibida por lote. Si existe diferencia, registra motivo y observacion antes de recepcionar.</p>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ImmunizationKpiCard tone="info" label="Distribuciones" value={totals.total.toString()} icon={<ArrowRightLeft className="h-5 w-5" />} />
        <ImmunizationKpiCard tone="info" label="Pendientes" value={totals.sent.toString()} icon={<Send className="h-5 w-5" />} />
        <ImmunizationKpiCard tone="info" label="Conformes" value={totals.received.toString()} icon={<CheckCircle2 className="h-5 w-5" />} />
        <ImmunizationKpiCard tone="info" label="Observadas" value={totals.observed.toString()} icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100" placeholder="Buscar distribuciones..." />
          </div>

          {isSupervisorView && (
            <div className="xl:w-52">
              <CustomSelect
                value={ungetFilter}
                onChange={setUngetFilter}
                options={[
                  { value: "", label: "Todas las UNGET" },
                  ...availableFilterUngets.map(unget => ({ value: unget.id, label: unget.name }))
                ]}
                ariaLabel="Filtrar por UNGET"
                className="h-10"
              />
            </div>
          )}

          {isSupervisorView && (
            <div className="xl:w-56">
              <CustomSelect
                value={facilityFilter}
                onChange={setFacilityFilter}
                options={[
                  { value: "", label: "Todas las IPRESS" },
                  ...availableFilterFacilities.map(facility => ({ value: facility.code, label: facility.name }))
                ]}
                ariaLabel="Filtrar por IPRESS"
                className="h-10"
              />
            </div>
          )}

          <div className="xl:w-36">
            <CustomSelect
              value={periodFilter}
              onChange={setPeriodFilter}
              options={[
                { value: "ALL", label: "Todos los meses" },
                ...periodOptions.map(period => ({ value: period, label: period }))
              ]}
              ariaLabel="Filtrar por periodo"
              className="h-10"
            />
          </div>

          <div className="xl:w-44">
            <CustomSelect
              value={statusFilter}
              onChange={val => setStatusFilter(val as "ALL" | ImmunizationDistributionStatus)}
              options={[
                { value: "ALL", label: "Todos los estados" },
                { value: "SENT", label: "Pendiente recepción" },
                { value: "RECEIVED", label: "Recibidas" },
                { value: "DRAFT", label: "Borradores" },
                { value: "OBSERVED", label: "Observadas" },
                { value: "VOIDED", label: "Anuladas" }
              ]}
              ariaLabel="Filtrar por estado"
              className="h-10"
            />
          </div>

          <div className="xl:w-44">
            <CustomSelect
              value={criterionFilter}
              onChange={val => setCriterionFilter(val as "ALL" | ImmunizationDistributionCriterion)}
              options={[
                { value: "ALL", label: "Todos los criterios" },
                { value: "REGULAR", label: "Regular" },
                { value: "CONSUMPTION", label: "Consumo" },
                { value: "AVAILABILITY", label: "Disponibilidad" },
                { value: "CAMPAIGN", label: "Campaña" },
                { value: "OTHER", label: "Otro" }
              ]}
              ariaLabel="Filtrar por criterio"
              className="h-10"
            />
          </div>

          <button type="button" onClick={() => setShowDateFilters(current => !current)} className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black transition-colors ${dateFrom || dateTo || showDateFilters ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            <CalendarDays className="h-4 w-4" /> Fechas
            <ChevronDown className={`h-4 w-4 transition-transform ${showDateFilters ? "rotate-180" : ""}`} />
          </button>

          <button type="button" onClick={clearFilters} disabled={!hasFilters} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            <FilterX className="h-4 w-4" /> Limpiar
          </button>
        </div>

        {(showDateFilters || dateFrom || dateTo) && (
          <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-400">Desde</span>
                <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-400">Hasta</span>
                <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" />
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Mostrando <span className="font-black text-slate-800">{visibleDistributions.length}</span> de <span className="font-black text-slate-800">{distributions.length}</span>
            </p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <FileText className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Historial de distribuciones</h3>
        </div>
        {loading && distributions.length === 0 ? (
          <div className="flex justify-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" /></div>
        ) : visibleDistributions.length === 0 ? (
          <div className="p-10 text-center">
            <ArrowRightLeft className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <h3 className="font-black text-slate-800">{distributions.length === 0 ? "Sin distribuciones registradas" : "Sin resultados para los filtros"}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {distributions.length === 0
                ? (canCreate ? "Registre la primera distribucion segun su alcance operativo." : "Aqui apareceran las distribuciones segun su alcance.")
                : "Modifique o limpie los filtros para ampliar la busqueda."}
            </p>
            {distributions.length > 0 && <button type="button" onClick={clearFilters} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">Limpiar filtros</button>}
          </div>
        ) : (
          <div className={loading ? "opacity-60 pointer-events-none transition-opacity duration-200" : "transition-opacity duration-200"}>
            {/* En celular la tabla de 8 columnas obliga a desplazarse: se usan tarjetas. */}
            <div className="divide-y divide-slate-100 md:hidden">
              {visibleDistributions.map(distribution => {
                const { originLabel, destinationLabel, destinationMeta, canSendDraft, canReceiveSent } =
                  describeDistribution(distribution);
                return (
                  <article key={distribution.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-black text-slate-900">{destinationLabel}</p>
                          {distribution.isInitialProvision && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800">
                              Remesa Inicial
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">{destinationMeta || "-"}</p>
                      </div>
                      <StatusBadge status={distribution.status} />
                    </div>

                    <p className="mt-2 text-xs font-bold text-slate-600">
                      Desde {originLabel}
                      <span className="ml-2 font-mono text-teal-700">{distribution.period}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(distribution.sentAt || distribution.createdAt)}
                      {distribution.referenceDocument ? ` · ${distribution.referenceDocument}` : ""}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {canSendDraft && (
                        <button
                          type="button"
                          onClick={() => void sendExistingDistribution(distribution)}
                          disabled={sendingId === distribution.id}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-sky-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-60"
                        >
                          {sendingId === distribution.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Enviar
                        </button>
                      )}
                      {canReceiveSent && (
                        <button
                          type="button"
                          onClick={() => void openReceptionModal(distribution)}
                          disabled={receivingId === distribution.id}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-60"
                        >
                          {receivingId === distribution.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Recepcionar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleDetail(distribution)}
                        className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-700"
                      >
                        {expandedId === distribution.id ? "Ocultar" : "Ver detalle"}
                      </button>
                    </div>

                    {expandedId === distribution.id && (
                      <div className="mt-3">
                        <DistributionDetail
                          items={detailByDistribution[distribution.id || ""] || []}
                          loading={loadingDetailId === distribution.id}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <HeaderCell>Fecha / periodo</HeaderCell>
                  <HeaderCell>Origen</HeaderCell>
                  <HeaderCell>Destino</HeaderCell>
                  <HeaderCell>Criterio</HeaderCell>
                  <HeaderCell>Referencia</HeaderCell>
                  <HeaderCell>Usuario</HeaderCell>
                  <HeaderCell>Estado</HeaderCell>
                  <HeaderCell align="right">Acciones</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleDistributions.map(distribution => {
                  const { originLabel, originMeta, destinationLabel, destinationMeta, canSendDraft, canReceiveSent } =
                    describeDistribution(distribution);
                  return (
                  <React.Fragment key={distribution.id}>
                    <tr className="hover:bg-slate-50/70">
                      <td className="px-4 py-3"><p className="text-xs font-black text-slate-800">{formatDate(distribution.sentAt || distribution.createdAt)}</p><p className="mt-1 font-mono text-[10px] font-bold text-teal-700">{distribution.period}</p></td>
                      <td className="px-4 py-3"><p className="text-xs font-black text-slate-800">{originLabel}</p><p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{originMeta}</p></td>
                      <td className="max-w-xs px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="line-clamp-1 text-xs font-black text-slate-800">{destinationLabel}</p>
                          {distribution.isInitialProvision && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800">
                              Remesa Inicial
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">{destinationMeta || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-600">{criterionLabel(distribution.criterion)}</td>
                      <td className="max-w-xs px-4 py-3"><p className="line-clamp-1 text-xs font-bold text-slate-600">{distribution.referenceDocument || "-"}</p>{distribution.observation && <p className="mt-1 line-clamp-1 text-[10px] text-slate-500">{distribution.observation}</p>}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{distribution.receivedBy || distribution.sentBy || distribution.createdBy || "-"}</td>
                      <td className="px-4 py-3"><StatusBadge status={distribution.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {canSendDraft && (
                            <button type="button" onClick={() => void sendExistingDistribution(distribution)} disabled={sendingId === distribution.id} className="inline-flex items-center gap-1 rounded-xl bg-sky-700 px-3 py-2 text-xs font-black text-white hover:bg-sky-800 disabled:opacity-60">
                              {sendingId === distribution.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Enviar
                            </button>
                          )}
                          {canReceiveSent && (
                            <button type="button" onClick={() => void openReceptionModal(distribution)} disabled={receivingId === distribution.id} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60">
                              {receivingId === distribution.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Recepcionar
                            </button>
                          )}
                          <button type="button" onClick={() => void toggleDetail(distribution)} aria-label="Ver detalle" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                            {expandedId === distribution.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === distribution.id && (
                      <tr>
                        <td colSpan={8} className="bg-slate-50/70 px-4 py-3">
                          <DistributionDetail items={detailByDistribution[distribution.id || ""] || []} loading={loadingDetailId === distribution.id} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>

      <DistributionModal
        isOpen={formOpen}
        flow={operationFlow}
        ungets={destinationUngets}
        facilities={destinationFacilities}
        currentUngetId={currentUngetId}
        stockLayers={stockLayers}
        period={currentPeriod}
        username={user?.username}
        isSaving={saving}
        onClose={() => { if (!saving) setFormOpen(false); }}
        onSubmit={(distribution, items) => void saveAndSendDistribution(distribution, items)}
      />
      <ReceptionModal
        isOpen={receptionOpen}
        distribution={receptionDistribution}
        items={receptionItems}
        isSaving={Boolean(receivingId)}
        onClose={() => {
          if (receivingId) return;
          setReceptionOpen(false);
          setReceptionDistribution(null);
          setReceptionItems([]);
        }}
        onSubmit={(distribution, reception) => void receiveDistribution(distribution, reception)}
      />
    </div>
  );
};

function DistributionModal({
  isOpen,
  flow,
  ungets,
  facilities,
  currentUngetId,
  stockLayers,
  period,
  username,
  isSaving,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  flow: ImmunizationDistributionFlow;
  ungets: Unget[];
  facilities: HealthFacility[];
  currentUngetId: string;
  stockLayers: ImmunizationStockLayer[];
  period: string;
  username?: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (distribution: ImmunizationDistributionBatch, items: ImmunizationDistributionItem[]) => void;
}) {
  const facilitySearchRef = useRef<HTMLInputElement>(null);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const [destinationFacilityCode, setDestinationFacilityCode] = useState("");
  const [facilitySearch, setFacilitySearch] = useState("");
  const [facilityResultsOpen, setFacilityResultsOpen] = useState(false);
  const [activeFacilityIndex, setActiveFacilityIndex] = useState(0);
  const [criterion, setCriterion] = useState<ImmunizationDistributionCriterion>("REGULAR");
  const [isInitialProvision, setIsInitialProvision] = useState(false);
  const [destinationInitialized, setDestinationInitialized] = useState<boolean | null>(null);
  const [checkingFacility, setCheckingFacility] = useState(false);
  const [referenceDocument, setReferenceDocument] = useState("");
  const [observation, setObservation] = useState("");
  const [items, setItems] = useState<DistributionItemDraft[]>([]);
  const [error, setError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("FEFO");
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [itemObservation, setItemObservation] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setDestinationFacilityCode("");
    setFacilitySearch("");
    setFacilityResultsOpen(false);
    setActiveFacilityIndex(0);
    setCriterion("REGULAR");
    setIsInitialProvision(false);
    setDestinationInitialized(null);
    setCheckingFacility(false);
    setReferenceDocument("");
    setObservation("");
    setItems([]);
    setError("");
    setProductSearch("");
    setSelectedProductId("");
    setResultsOpen(false);
    setActiveResultIndex(0);
    setAllocationMode("FEFO");
    setSelectedLayerId("");
    setQuantity("");
    setItemObservation("");
    const timer = window.setTimeout(() => facilitySearchRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!destinationFacilityCode || flow === "DIRESA_UNGET") {
      setDestinationInitialized(null);
      setCheckingFacility(false);
      return;
    }
    let active = true;
    setCheckingFacility(true);
    immunizationApi.isFacilityInitialized({ ownerType: "IPRESS", facilityCode: destinationFacilityCode })
      .then(isInit => {
        if (!active) return;
        setDestinationInitialized(isInit);
        if (!isInit) {
          setIsInitialProvision(true);
        }
      })
      .catch(() => {
        if (active) setDestinationInitialized(null);
      })
      .finally(() => {
        if (active) setCheckingFacility(false);
      });
    return () => { active = false; };
  }, [destinationFacilityCode, flow]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isSaving, onClose]);

  const reservedByLayer = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(item => map.set(item.sourceStockLayerId, (map.get(item.sourceStockLayerId) || 0) + item.quantity));
    return map;
  }, [items]);

  const productGroups = useMemo<StockProductGroup[]>(() => {
    const map = new Map<string, StockProductGroup>();
    stockLayers.forEach(layer => {
      if (!layer.product || layer.currentQuantity <= 0) return;
      const reserved = reservedByLayer.get(layer.id) || 0;
      const available = layer.currentQuantity - reserved;
      if (available <= 0) return;
      const current = map.get(layer.productId) || {
        productId: layer.productId,
        product: layer.product,
        layers: [],
        total: 0
      };
      current.layers.push(layer);
      current.total += available;
      map.set(layer.productId, current);
    });
    return Array.from(map.values())
      .map(group => ({
        ...group,
        layers: [...group.layers].sort((a, b) => a.expirationDate.localeCompare(b.expirationDate))
      }))
      .sort((a, b) => a.product.descripcion.localeCompare(b.product.descripcion));
  }, [reservedByLayer, stockLayers]);

  const selectedGroup = productGroups.find(group => group.productId === selectedProductId);

  const filteredProducts = useMemo(() => {
    const query = normalizeText(productSearch);
    if (!query || selectedProductId) return [];
    return productGroups
      .filter(group => normalizeText(`${group.product.codigoSismed} ${group.product.descripcion}`).includes(query))
      .slice(0, 10);
  }, [productGroups, productSearch, selectedProductId]);

  const isRegionalFlow = flow === "DIRESA_UNGET";
  const destinationOptions = useMemo(() => (
    isRegionalFlow
      ? ungets.map(unget => ({
        id: unget.id,
        code: unget.id,
        name: unget.name,
        meta: "UNGET",
        detail: [unget.province, unget.district].filter(Boolean).join(" - ")
      }))
      : facilities.map(facility => ({
        id: facility.code,
        code: facility.code,
        name: facility.name,
        meta: facility.category || "IPRESS",
        detail: facility.type || ""
      }))
  ), [facilities, isRegionalFlow, ungets]);
  const selectedDestination = destinationOptions.find(option => option.id === destinationFacilityCode);

  const filteredDestinations = useMemo(() => {
    const query = normalizeText(facilitySearch);
    const rows = !query
      ? destinationOptions
      : destinationOptions.filter(destination => normalizeText(`${destination.code} ${destination.name} ${destination.meta} ${destination.detail}`).includes(query));
    return rows.slice(0, 12);
  }, [destinationOptions, facilitySearch]);

  if (!isOpen) return null;

  const selectProduct = (group: StockProductGroup) => {
    setSelectedProductId(group.productId);
    setProductSearch(`${group.product.codigoSismed} - ${group.product.descripcion}`);
    setSelectedLayerId(group.layers[0]?.id || "");
    setResultsOpen(false);
    setActiveResultIndex(0);
  };

  const selectDestination = (destination: { id: string; code: string; name: string }) => {
    setDestinationFacilityCode(destination.id);
    setFacilitySearch(`${destination.code} - ${destination.name}`);
    setFacilityResultsOpen(false);
    setActiveFacilityIndex(0);
    setError("");
  };

  const handleFacilitySearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!facilityResultsOpen || filteredDestinations.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveFacilityIndex(current => Math.min(current + 1, filteredDestinations.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveFacilityIndex(current => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectDestination(filteredDestinations[activeFacilityIndex]);
    } else if (event.key === "Escape") {
      setFacilityResultsOpen(false);
    }
  };

  const handleProductSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!resultsOpen || filteredProducts.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex(current => Math.min(current + 1, filteredProducts.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex(current => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectProduct(filteredProducts[activeResultIndex]);
    } else if (event.key === "Escape") {
      setResultsOpen(false);
    }
  };

  const resetProductForm = () => {
    setSelectedProductId("");
    setProductSearch("");
    setSelectedLayerId("");
    setQuantity("");
    setItemObservation("");
    setAllocationMode("FEFO");
    window.setTimeout(() => productSearchRef.current?.focus(), 0);
  };

  const appendItemForLayer = (layer: ImmunizationStockLayer, allocationQuantity: number) => {
    const existingIndex = items.findIndex(item => item.sourceStockLayerId === layer.id);
    if (existingIndex >= 0) {
      setItems(current => current.map((item, index) => index === existingIndex ? { ...item, quantity: item.quantity + allocationQuantity } : item));
      return;
    }
    const draft: DistributionItemDraft = {
      tempId: `distribution-item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: layer.productId,
      sourceStockLayerId: layer.id,
      codigoSismedSnapshot: layer.product?.codigoSismed || "",
      lote: layer.lote,
      expirationDate: layer.expirationDate,
      quantity: allocationQuantity,
      unitPrice: layer.unitPrice,
      fundingSource: layer.fundingSource,
      supplyType: layer.supplyType,
      observation: itemObservation.trim() || undefined,
      product: layer.product
    };
    setItems(current => [...current, draft]);
  };

  const addItem = () => {
    const requestedQuantity = Number(quantity);
    if (!selectedGroup) {
      setError("Seleccione un producto con stock disponible.");
      return;
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      setError("Ingrese una cantidad valida mayor a cero.");
      return;
    }

    if (allocationMode === "MANUAL") {
      const layer = selectedGroup.layers.find(row => row.id === selectedLayerId);
      if (!layer) {
        setError("Seleccione el lote que desea distribuir.");
        return;
      }
      const available = layer.currentQuantity - (reservedByLayer.get(layer.id) || 0);
      if (requestedQuantity > available) {
        setError(`El lote seleccionado solo tiene ${available} disponible.`);
        return;
      }
      appendItemForLayer(layer, requestedQuantity);
      setError("");
      resetProductForm();
      return;
    }

    let remaining = requestedQuantity;
    const allocations: { layer: ImmunizationStockLayer; quantity: number }[] = [];
    selectedGroup.layers.forEach(layer => {
      if (remaining <= 0) return;
      const available = layer.currentQuantity - (reservedByLayer.get(layer.id) || 0);
      if (available <= 0) return;
      const allocated = Math.min(available, remaining);
      allocations.push({ layer, quantity: allocated });
      remaining -= allocated;
    });

    if (remaining > 0) {
      setError(`Stock insuficiente. Disponible para el producto: ${selectedGroup.total}.`);
      return;
    }

    allocations.forEach(allocation => appendItemForLayer(allocation.layer, allocation.quantity));
    setError("");
    resetProductForm();
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isRegionalFlow && !currentUngetId) {
      setError("No hay una UNGET origen valida.");
      return;
    }
    if (!destinationFacilityCode) {
      setError(isRegionalFlow ? "Seleccione la UNGET destino." : "Seleccione la IPRESS destino.");
      return;
    }
    if (items.length === 0) {
      setError("Agregue al menos un producto/lote a distribuir.");
      return;
    }
    const distribution: ImmunizationDistributionBatch = {
      flowType: flow,
      originOwnerType: isRegionalFlow ? "DIRESA" : "UNGET",
      destinationOwnerType: isRegionalFlow ? "UNGET" : "IPRESS",
      regionalWarehouseId: isRegionalFlow ? DEFAULT_REGIONAL_WAREHOUSE_ID : undefined,
      originUngetId: isRegionalFlow ? undefined : currentUngetId,
      destinationUngetId: isRegionalFlow ? destinationFacilityCode : undefined,
      ungetId: isRegionalFlow ? destinationFacilityCode : currentUngetId,
      destinationFacilityCode: isRegionalFlow ? "" : destinationFacilityCode,
      period,
      criterion,
      isInitialProvision: !isRegionalFlow ? isInitialProvision : false,
      status: "DRAFT",
      referenceDocument: referenceDocument.trim() || undefined,
      observation: observation.trim() || undefined,
      createdBy: username
    };
    onSubmit(distribution, items.map(({ tempId, ...item }) => item));
  };

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[1190000] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm animate-in fade-in duration-200 sm:p-5"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="distribution-modal-title" className="my-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-3 duration-200">
        <header className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-sky-50 to-white px-5 py-5 sm:px-7">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-sky-100 p-3 text-sky-700"><PackageCheck className="h-6 w-6" /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-700">{isRegionalFlow ? "Distribucion regional" : "Distribucion UNGET"}</p>
              <h2 id="distribution-modal-title" className="mt-1 text-xl font-black text-slate-900">{isRegionalFlow ? "Nueva distribucion a UNGET" : "Nueva distribucion a IPRESS"}</h2>
              <p className="mt-1 text-xs text-slate-500">FEFO automatico por defecto. Puede seleccionar un lote manual si necesita omitir la sugerencia.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Cerrar formulario" className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="max-h-[72vh] space-y-5 overflow-y-auto overflow-x-hidden p-5 sm:p-7">
            <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-3 flex items-center gap-2"><Building2 className="h-4 w-4 text-sky-700" /><h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Datos de destino</h3></div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(360px,1fr)_260px]">
                <Field label={isRegionalFlow ? "UNGET destino" : "IPRESS destino"} required>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-3.5 z-10 h-5 w-5 text-slate-400" />
                    <input
                      ref={facilitySearchRef}
                      type="search"
                      role="combobox"
                      aria-expanded={facilityResultsOpen}
                      value={facilitySearch}
                      onFocus={() => {
                        if (!destinationFacilityCode) setFacilityResultsOpen(true);
                      }}
                      onBlur={() => window.setTimeout(() => setFacilityResultsOpen(false), 150)}
                      onKeyDown={handleFacilitySearchKeyDown}
                      onChange={event => {
                        setFacilitySearch(event.target.value);
                        setDestinationFacilityCode("");
                        setFacilityResultsOpen(true);
                        setActiveFacilityIndex(0);
                      }}
                      disabled={isSaving}
                      autoComplete="off"
                      placeholder={isRegionalFlow ? "Buscar UNGET por nombre..." : "Buscar IPRESS por codigo o nombre..."}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-sm font-semibold text-slate-800 outline-none transition-shadow placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                    />
                    {destinationFacilityCode && (
                      <button
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => {
                          setDestinationFacilityCode("");
                          setFacilitySearch("");
                          setFacilityResultsOpen(true);
                          window.setTimeout(() => facilitySearchRef.current?.focus(), 0);
                        }}
                        aria-label={isRegionalFlow ? "Cambiar UNGET destino" : "Cambiar IPRESS destino"}
                        className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {facilityResultsOpen && !destinationFacilityCode && (
                      <div className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl">
                        {filteredDestinations.length === 0 ? (
                          <div className="px-4 py-6 text-center">
                            <p className="text-sm font-black text-slate-700">{isRegionalFlow ? "UNGET no encontrada" : "IPRESS no encontrada"}</p>
                            <p className="mt-1 text-xs text-slate-500">{isRegionalFlow ? "Busca por nombre dentro del ambito DIRESA." : "Busca por codigo o nombre dentro de la UNGET."}</p>
                          </div>
                        ) : filteredDestinations.map((destination, index) => (
                          <button
                            key={destination.id}
                            type="button"
                            onMouseDown={event => event.preventDefault()}
                            onMouseEnter={() => setActiveFacilityIndex(index)}
                            onClick={() => selectDestination(destination)}
                            className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${index === activeFacilityIndex ? "bg-sky-50" : "hover:bg-slate-50"}`}
                          >
                            <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-black text-teal-700">{destination.code}</span>
                            <span className="min-w-0">
                              <span className="block text-sm font-black text-slate-900">{destination.name}</span>
                              <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-400">{destination.meta}{destination.detail ? ` - ${destination.detail}` : ""}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedDestination && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="font-black text-emerald-800">{selectedDestination.code}</span>
                      <span className="font-bold text-slate-700">{selectedDestination.name}</span>
                      <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-black uppercase text-slate-500">{selectedDestination.meta}</span>
                    </div>
                  )}
                </Field>
                <Field label="Criterio" required>
                  <select value={criterion} onChange={event => setCriterion(event.target.value as ImmunizationDistributionCriterion)} disabled={isSaving} className={selectClassName}>
                    <option value="REGULAR">Regular</option>
                    <option value="CONSUMPTION">Por consumo</option>
                    <option value="AVAILABILITY">Por disponibilidad</option>
                    <option value="CAMPAIGN">Campaña / barrido</option>
                    <option value="OTHER">Otro criterio</option>
                  </select>
                </Field>
              </div>

              {!isRegionalFlow && selectedDestination && (
                <div className={`mt-4 rounded-2xl border p-4 transition-colors ${isInitialProvision ? "border-amber-200 bg-amber-50/80" : "border-slate-200 bg-white"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <label htmlFor="is-initial-provision" className="text-xs font-black uppercase tracking-wide text-slate-800 cursor-pointer">
                          Entrega Especial / Remesa Inicial
                        </label>
                        {isInitialProvision && (
                          <span className="rounded-md bg-amber-200/80 px-2 py-0.5 text-[10px] font-black uppercase text-amber-900">
                            Habilitación de IPRESS
                          </span>
                        )}
                        {checkingFacility && (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                            <Loader2 className="h-3 w-3 animate-spin" /> Verificando apertura...
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">
                        {destinationInitialized === false
                          ? "⚠️ Esta IPRESS aún no tiene inventario inicial cerrado. Marcar como Remesa Inicial le permitirá recepcionar los biológicos y cerrará automáticamente su apertura de inventario."
                          : "Marque esta opción únicamente si se trata de una entrega de apertura para una IPRESS nueva que aún no realizó su inventario inicial."}
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center shrink-0">
                      <input
                        id="is-initial-provision"
                        type="checkbox"
                        checked={isInitialProvision}
                        onChange={e => setIsInitialProvision(e.target.checked)}
                        disabled={isSaving}
                        className="peer sr-only"
                      />
                      <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300" />
                    </label>
                  </div>
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Field label="Referencia interna">
                  <input value={referenceDocument} onChange={event => setReferenceDocument(event.target.value)} disabled={isSaving} className={inputClassName} placeholder="Opcional" />
                </Field>
                <div className="lg:col-span-2">
                  <Field label="Observacion general">
                    <input value={observation} onChange={event => setObservation(event.target.value)} disabled={isSaving} className={inputClassName} placeholder="Sustento u observacion de la distribucion..." />
                  </Field>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-sky-700" /><h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Agregar producto/lote</h3></div>
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                  <button type="button" onClick={() => setAllocationMode("FEFO")} className={`rounded-lg px-3 py-1.5 text-xs font-black ${allocationMode === "FEFO" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"}`}>FEFO automatico</button>
                  <button type="button" onClick={() => setAllocationMode("MANUAL")} className={`rounded-lg px-3 py-1.5 text-xs font-black ${allocationMode === "MANUAL" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"}`}>Elegir lote</button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <div className="xl:col-span-5">
                  <label htmlFor="distribution-product-search" className="mb-1.5 block text-xs font-black text-slate-700">Producto con stock {isRegionalFlow ? "DIRESA" : "UNGET"} <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-3.5 z-10 h-5 w-5 text-slate-400" />
                    <input
                      ref={productSearchRef}
                      id="distribution-product-search"
                      type="search"
                      role="combobox"
                      aria-expanded={resultsOpen}
                      value={productSearch}
                      onFocus={() => setResultsOpen(true)}
                      onBlur={() => window.setTimeout(() => setResultsOpen(false), 150)}
                      onKeyDown={handleProductSearchKeyDown}
                      onChange={event => {
                        setProductSearch(event.target.value);
                        setSelectedProductId("");
                        setSelectedLayerId("");
                        setResultsOpen(true);
                        setActiveResultIndex(0);
                      }}
                      disabled={isSaving}
                      autoComplete="off"
                      placeholder="Buscar codigo SISMED o descripcion..."
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-sm font-semibold text-slate-800 outline-none transition-shadow placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                    />
                    {selectedProductId && (
                      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setSelectedProductId(""); setProductSearch(""); setSelectedLayerId(""); setResultsOpen(true); }} aria-label="Cambiar producto" className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {resultsOpen && !selectedProductId && productSearch.trim() && (
                      <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl">
                        {filteredProducts.length === 0 ? (
                          <div className="px-4 py-6 text-center"><p className="text-sm font-black text-slate-700">Producto no disponible</p><p className="mt-1 text-xs text-slate-500">Debe tener stock en {isRegionalFlow ? "DIRESA" : "la UNGET"}.</p></div>
                        ) : filteredProducts.map((group, index) => (
                          <button key={group.productId} type="button" onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveResultIndex(index)} onClick={() => selectProduct(group)} className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${index === activeResultIndex ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                            <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-black text-teal-700">{group.product.codigoSismed}</span>
                            <span className="min-w-0"><span className="block text-sm font-bold text-slate-900">{group.product.descripcion}</span><span className="mt-0.5 block text-[10px] font-black uppercase tracking-wide text-slate-400">{group.product.tipoProducto} · {group.product.dosisUnidad} dosis/unidad · Stock {group.total}</span></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedGroup && <p className="mt-2 text-xs font-bold text-emerald-700">Disponible total: {selectedGroup.total.toLocaleString("es-PE")} fco/unid.</p>}
                </div>

                {allocationMode === "MANUAL" && (
                  <div className="xl:col-span-3">
                    <Field label="Lote" required>
                      <select value={selectedLayerId} onChange={event => setSelectedLayerId(event.target.value)} disabled={isSaving || !selectedGroup} className={selectClassName}>
                        <option value="">Seleccione lote...</option>
                        {selectedGroup?.layers.map(layer => {
                          const available = layer.currentQuantity - (reservedByLayer.get(layer.id) || 0);
                          return <option key={layer.id} value={layer.id}>{layer.lote} · vence {layer.expirationDate} · disp. {available}</option>;
                        })}
                      </select>
                    </Field>
                  </div>
                )}

                <div className={allocationMode === "MANUAL" ? "xl:col-span-2" : "xl:col-span-3"}>
                  <Field label="Cantidad" required>
                    <input type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={isSaving} className={inputClassName} placeholder="0" />
                  </Field>
                </div>
                <div className={allocationMode === "MANUAL" ? "xl:col-span-2" : "xl:col-span-4"}>
                  <Field label="Observacion del item">
                    <input value={itemObservation} onChange={event => setItemObservation(event.target.value)} disabled={isSaving} className={inputClassName} placeholder="Opcional" />
                  </Field>
                </div>
                <div className="flex items-end xl:col-span-2">
                  <button type="button" onClick={addItem} disabled={isSaving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
                    <Plus className="h-4 w-4" />Agregar
                  </button>
                </div>
              </div>

              {selectedGroup && allocationMode === "FEFO" && (
                <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  FEFO tomara primero el lote mas proximo a vencer y, si no alcanza, continuara con el siguiente lote disponible.
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Productos de la distribucion</h3>
                <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
                  <span className="rounded-lg bg-sky-50 px-2 py-1 text-sky-700">{items.length} lotes</span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">{totalQuantity.toLocaleString("es-PE")} fco/unid.</span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">S/ {totalValue.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              {items.length === 0 ? (
                <div className="p-8 text-center"><PackageCheck className="mx-auto mb-2 h-9 w-9 text-slate-300" /><p className="text-sm font-bold text-slate-600">Aun no agregaste productos a la distribucion.</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50"><tr><HeaderCell>Codigo</HeaderCell><HeaderCell>Producto</HeaderCell><HeaderCell>Lote</HeaderCell><HeaderCell>Vencimiento</HeaderCell><HeaderCell align="right">Cantidad</HeaderCell><HeaderCell align="right">Precio</HeaderCell><HeaderCell>Fuente</HeaderCell><HeaderCell>Suministro</HeaderCell><HeaderCell align="right">Quitar</HeaderCell></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map(item => (
                        <tr key={item.tempId}>
                          <td className="px-3 py-3 font-mono text-xs font-black text-teal-700">{item.codigoSismedSnapshot}</td>
                          <td className="max-w-sm px-3 py-3 text-xs font-bold text-slate-800">{item.product?.descripcion || "-"}</td>
                          <td className="px-3 py-3 text-xs font-black text-slate-700">{item.lote}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">{item.expirationDate}</td>
                          <td className="px-3 py-3 text-right text-xs font-black text-slate-900">{item.quantity.toLocaleString("es-PE")}</td>
                          <td className="px-3 py-3 text-right text-xs font-bold text-slate-600">S/ {item.unitPrice.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">{item.fundingSource}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">{item.supplyType}</td>
                          <td className="px-3 py-3 text-right"><button type="button" onClick={() => setItems(current => current.filter(row => row.tempId !== item.tempId))} disabled={isSaving} className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:justify-end sm:px-7">
            <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSaving || items.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-sky-800 disabled:opacity-50">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSaving ? "Enviando..." : "Guardar y enviar"}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  );
}

const receptionReasonOptions: Array<{ value: ImmunizationReceptionReason; label: string }> = [
  { value: "FALTANTE_FISICO", label: "Faltante fisico" },
  { value: "SOBRANTE_FISICO", label: "Sobrante fisico" },
  { value: "LOTE_NO_COINCIDE", label: "Lote no coincide" },
  { value: "VENCIMIENTO_NO_COINCIDE", label: "Vencimiento no coincide" },
  { value: "PRODUCTO_DETERIORADO", label: "Producto deteriorado" },
  { value: "OTRO", label: "Otro motivo" }
];

function ReceptionModal({
  isOpen,
  distribution,
  items,
  isSaving,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  distribution: ImmunizationDistributionBatch | null;
  items: ImmunizationDistributionItem[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (distribution: ImmunizationDistributionBatch, reception: ImmunizationReceptionInput) => void;
}) {
  const [receivedByItem, setReceivedByItem] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<"" | ImmunizationReceptionReason>("");
  const [observation, setObservation] = useState("");
  const [forceIncident, setForceIncident] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<string, string> = {};
    items.forEach(item => {
      if (item.id) initial[item.id] = String(item.receivedQuantity ?? item.quantity);
    });
    setReceivedByItem(initial);
    setReason("");
    setObservation("");
    setForceIncident(false);
    setError("");
  }, [isOpen, items]);

  if (!isOpen || !distribution) return null;

  const parsedRows = items.map(item => {
    const itemId = item.id || "";
    const raw = receivedByItem[itemId] ?? String(item.quantity);
    const receivedQuantity = raw === "" ? NaN : Number(raw);
    const difference = Number.isFinite(receivedQuantity) ? receivedQuantity - item.quantity : NaN;
    return { item, itemId, raw, receivedQuantity, difference };
  });
  const hasInvalidQuantity = parsedRows.some(row => !row.itemId || !Number.isFinite(row.receivedQuantity) || row.receivedQuantity < 0);
  const hasDifference = parsedRows.some(row => Number.isFinite(row.difference) && row.difference !== 0);
  const hasIncident = hasDifference || forceIncident;
  const totalSent = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalReceived = parsedRows.reduce((sum, row) => sum + (Number.isFinite(row.receivedQuantity) ? row.receivedQuantity : 0), 0);
  const totalDifference = totalReceived - totalSent;
  const flow = distributionFlow(distribution);
  const destinationLabel = flow === "DIRESA_UNGET" ? "UNGET" : "IPRESS";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasInvalidQuantity) {
      setError("Revise las cantidades recibidas; no pueden quedar vacias ni ser negativas.");
      return;
    }
    if (hasIncident && !reason) {
      setError("Seleccione el motivo de la incidencia.");
      return;
    }
    if (hasIncident && !observation.trim()) {
      setError("Registre una observacion explicando la incidencia fisica.");
      return;
    }
    onSubmit(distribution, {
      reason: reason || undefined,
      observation: observation.trim() || undefined,
      items: parsedRows.map(row => ({
        itemId: row.itemId,
        receivedQuantity: row.receivedQuantity
      }))
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1195000] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm animate-in fade-in duration-200 sm:p-5"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="reception-modal-title" className="my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-3 duration-200">
        <header className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-5 sm:px-7">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700"><CheckCircle2 className="h-6 w-6" /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Recepcion {destinationLabel}</p>
              <h2 id="reception-modal-title" className="mt-1 text-xl font-black text-slate-900">Verificar fisico recibido</h2>
              <p className="mt-1 text-xs text-slate-500">Confirme por lote lo que llego fisicamente. Si no coincide, seleccione motivo y registre observacion.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Cerrar recepcion" className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="max-h-[72vh] space-y-4 overflow-y-auto overflow-x-hidden p-5 sm:p-7">
            {distribution.isInitialProvision && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl">🌟</span>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wide text-amber-900">
                      Remesa Inicial para Apertura de IPRESS
                    </h3>
                    <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                      Esta entrega especial corresponde a la remesa inicial de biológicos. Al confirmar esta recepción, el sistema creará y cerrará automáticamente el <strong>Inventario Inicial</strong> de su establecimiento con las cantidades recibidas, habilitando a su IPRESS para todas sus operaciones regulares (consumos, devoluciones, reajustes y cierre mensual).
                    </p>
                  </div>
                </div>
              </div>
            )}

            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Periodo</p>
                <p className="mt-1 text-xl font-black text-slate-900">{distribution.period}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Enviado</p>
                <p className="mt-1 text-xl font-black text-slate-900">{totalSent.toLocaleString("es-PE")} <span className="text-sm font-bold text-slate-400">fco/unid.</span></p>
              </div>
              <div className={`rounded-2xl border p-4 ${hasIncident ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <p className={`text-[10px] font-black uppercase tracking-wide ${hasIncident ? "text-amber-700" : "text-emerald-700"}`}>{hasIncident ? "Recepcion observada" : "Recepcion conforme"}</p>
                <p className={`mt-1 text-xl font-black ${hasIncident ? "text-amber-900" : "text-emerald-900"}`}>{totalReceived.toLocaleString("es-PE")} <span className="text-sm font-bold opacity-70">recibido</span></p>
                {hasDifference && <p className="mt-1 text-xs font-black text-amber-800">Diferencia: {totalDifference > 0 ? "+" : ""}{totalDifference.toLocaleString("es-PE")}</p>}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Detalle por lote</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <HeaderCell>Codigo</HeaderCell>
                      <HeaderCell>Producto</HeaderCell>
                      <HeaderCell>Lote / vencimiento</HeaderCell>
                      <HeaderCell align="right">Enviado</HeaderCell>
                      <HeaderCell align="right">Fisico recibido</HeaderCell>
                      <HeaderCell align="right">Diferencia</HeaderCell>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.map(row => (
                      <tr key={row.itemId || `${row.item.productId}-${row.item.lote}`}>
                        <td className="px-3 py-3 font-mono text-xs font-black text-teal-700">{row.item.codigoSismedSnapshot}</td>
                        <td className="max-w-sm px-3 py-3 text-xs font-bold text-slate-800">{row.item.product?.descripcion || "-"}</td>
                        <td className="px-3 py-3 text-xs text-slate-600"><span className="font-black text-slate-800">{row.item.lote}</span><br />{row.item.expirationDate}</td>
                        <td className="px-3 py-3 text-right text-xs font-black text-slate-900">{row.item.quantity.toLocaleString("es-PE")}</td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.raw}
                            onChange={event => setReceivedByItem(current => ({ ...current, [row.itemId]: event.target.value }))}
                            disabled={isSaving || !row.itemId}
                            className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-right text-sm font-black text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className={`rounded-lg px-2 py-1 text-xs font-black ${!Number.isFinite(row.difference) ? "bg-red-50 text-red-700" : row.difference === 0 ? "bg-emerald-50 text-emerald-700" : row.difference > 0 ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                            {!Number.isFinite(row.difference) ? "Error" : `${row.difference > 0 ? "+" : ""}${row.difference.toLocaleString("es-PE")}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 ${hasIncident ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50 hover:border-teal-200 hover:bg-teal-50/40"}`}>
              <input
                type="checkbox"
                checked={hasIncident}
                disabled={hasDifference || isSaving}
                onChange={event => setForceIncident(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border border-slate-300 text-amber-600 focus:ring-amber-500 disabled:opacity-70"
              />
              <span>
                <span className={`block text-sm font-black ${hasIncident ? "text-amber-950" : "text-slate-800"}`}>Registrar incidencia de recepcion</span>
                <span className={`mt-0.5 block text-xs ${hasIncident ? "text-amber-800" : "text-slate-500"}`}>
                  Use esta opcion si la cantidad coincide, pero el lote, vencimiento, estado fisico u otro dato no coincide con lo recibido.
                </span>
              </span>
            </label>

            {hasIncident && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div>
                    <h3 className="text-sm font-black text-amber-950">Incidencia de recepcion</h3>
                    <p className="mt-0.5 text-xs text-amber-800">El registro quedara observado y auditado con el motivo y sustento indicado.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[260px_1fr]">
                  <Field label="Motivo" required>
                    <select value={reason} onChange={event => setReason(event.target.value as "" | ImmunizationReceptionReason)} disabled={isSaving} className={selectClassName}>
                      <option value="">Seleccione motivo...</option>
                      {receptionReasonOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Observacion" required>
                    <textarea value={observation} onChange={event => setObservation(event.target.value)} disabled={isSaving} className="min-h-[74px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100" placeholder="Detalle la diferencia encontrada, guia, caja, lote observado u otro sustento..." />
                  </Field>
                </div>
              </section>
            )}

            {!hasIncident && (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
                Las cantidades fisicas coinciden con lo enviado. Al confirmar, el stock {destinationLabel} se incrementara por los lotes recibidos.
              </section>
            )}

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:justify-end sm:px-7">
            <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSaving} className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-white shadow-sm disabled:opacity-50 ${hasIncident ? "bg-amber-700 hover:bg-amber-800" : "bg-emerald-700 hover:bg-emerald-800"}`}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : hasIncident ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {isSaving ? "Registrando..." : hasIncident ? "Registrar recepcion observada" : "Confirmar recepcion conforme"}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  );
}

function DistributionDetail({ items, loading }: { items: ImmunizationDistributionItem[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-sky-600" /></div>;
  if (items.length === 0) return <p className="py-4 text-center text-sm text-slate-500">Sin detalle disponible.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50"><tr><HeaderCell>Codigo</HeaderCell><HeaderCell>Producto</HeaderCell><HeaderCell>Lote</HeaderCell><HeaderCell>Vencimiento</HeaderCell><HeaderCell align="right">Enviado</HeaderCell><HeaderCell align="right">Fisico</HeaderCell><HeaderCell align="right">Dif.</HeaderCell><HeaderCell align="right">Precio</HeaderCell><HeaderCell align="right">Valor</HeaderCell><HeaderCell>Fuente</HeaderCell><HeaderCell>Suministro</HeaderCell></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {items.map(item => {
            const hasReception = typeof item.receivedQuantity === "number";
            const receivedQuantity = hasReception ? Number(item.receivedQuantity) : null;
            const difference = receivedQuantity === null ? null : receivedQuantity - item.quantity;
            return (
              <tr key={item.id || `${item.productId}-${item.lote}`}>
                <td className="px-3 py-3 font-mono text-xs font-black text-teal-700">{item.codigoSismedSnapshot}</td>
                <td className="max-w-sm px-3 py-3 text-xs font-bold text-slate-800">{item.product?.descripcion || "-"}</td>
                <td className="px-3 py-3 text-xs font-black text-slate-700">{item.lote}</td>
                <td className="px-3 py-3 text-xs text-slate-600">{item.expirationDate}</td>
                <td className="px-3 py-3 text-right text-xs font-black text-slate-900">{item.quantity.toLocaleString("es-PE")}</td>
                <td className="px-3 py-3 text-right text-xs font-black text-slate-700">{receivedQuantity === null ? "-" : receivedQuantity.toLocaleString("es-PE")}</td>
                <td className="px-3 py-3 text-right">
                  {difference === null ? (
                    <span className="text-xs font-bold text-slate-400">-</span>
                  ) : (
                    <span className={`rounded-lg px-2 py-1 text-xs font-black ${difference === 0 ? "bg-emerald-50 text-emerald-700" : difference > 0 ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                      {difference > 0 ? "+" : ""}{difference.toLocaleString("es-PE")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right text-xs font-bold text-slate-600">S/ {item.unitPrice.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                <td className="px-3 py-3 text-right text-xs font-black text-slate-700">S/ {(item.quantity * item.unitPrice).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-3 text-xs text-slate-600">{item.fundingSource}</td>
                <td className="px-3 py-3 text-xs text-slate-600">{item.supplyType}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: ImmunizationDistributionStatus }) {
  const className = status === "RECEIVED"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "SENT"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : status === "OBSERVED"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "VOIDED"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`inline-flex rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${className}`}>{statusLabel(status)}</span>;
}

function ungetName(ungetId: string | undefined, ungets: Unget[]) {
  if (!ungetId) return "-";
  return ungets.find(unget => unget.id === ungetId)?.name || `UNGET ${ungetId}`;
}

function facilityName(code: string | undefined, facilities: HealthFacility[]) {
  if (!code) return "-";
  const facility = facilities.find(item => item.code === code);
  return facility ? `${facility.name}` : `IPRESS ${code}`;
}

