
import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LabelList
} from 'recharts';
import { BarChart3, Package, X } from 'lucide-react';
import { AuraAnalysisResult, StockStatus, DashboardViewMode } from '../types';

interface DashboardProps {
  result: AuraAnalysisResult;
  viewMode?: DashboardViewMode;
  onViewModeChange?: (mode: DashboardViewMode) => void;
  scopeFilter?: 'ALL' | 'DME';
  onScopeFilterChange?: (scope: 'ALL' | 'DME') => void;
  selectedStatusFilter?: StockStatus | null;
  onStatusFilterChange?: (status: StockStatus | null) => void;
}

const COLORS = {
  [StockStatus.DESABASTECIDO]: '#EF4444', // Red-500
  [StockStatus.SUBSTOCK]: '#F59E0B', // Amber-500
  [StockStatus.NORMOSTOCK]: '#10B981', // Emerald-500
  [StockStatus.SOBRESTOCK]: '#6366F1', // Indigo-500
  [StockStatus.SIN_ROTACION]: '#9CA3AF', // Gray-400
};

const BORDER_COLORS = {
  [StockStatus.DESABASTECIDO]: '#B91C1C', // Red-700
  [StockStatus.SUBSTOCK]: '#B45309', // Amber-700
  [StockStatus.NORMOSTOCK]: '#047857', // Emerald-700
  [StockStatus.SOBRESTOCK]: '#4338CA', // Indigo-700
  [StockStatus.SIN_ROTACION]: '#4B5563', // Gray-600
};

// Descriptions for Tooltip
const STATUS_DESC = {
  [StockStatus.DESABASTECIDO]: 'Stock = 0 (Crítico)',
  [StockStatus.SUBSTOCK]: 'Stock < 2 meses (Alerta)',
  [StockStatus.NORMOSTOCK]: '2 a 6 meses (Ideal)',
  [StockStatus.SOBRESTOCK]: '> 6 meses (Exceso)',
  [StockStatus.SIN_ROTACION]: 'Sin consumo (Inmovilizado)',
};

export const Dashboard: React.FC<DashboardProps> = React.memo(({ 
  result, 
  viewMode = 'INITIAL', 
  onViewModeChange,
  scopeFilter = 'ALL',
  onScopeFilterChange,
  selectedStatusFilter,
  onStatusFilterChange
}) => {
  const { medications, indicators } = result;

  const handleBarClick = (statusKey: StockStatus) => {
    if (!onStatusFilterChange) return;
    if (selectedStatusFilter === statusKey) {
      onStatusFilterChange(null);
    } else {
      onStatusFilterChange(statusKey);
    }
  };

  // Chart items depending on scopeFilter (ALL = 100% of medications/insumos in current table selection, DME = essential medications only)
  const chartItems = scopeFilter === 'DME'
    ? medications.filter(m => {
        const isMed = (m.medtip || '').toUpperCase().trim() === 'M';
        const isPet = (m.medpet || '').toUpperCase().trim() === 'P';
        const est = (m.medest || '').toUpperCase().trim();
        const isEst = est === '_' || est === 'S';
        return isMed && isPet && isEst;
      })
    : medications;

  const chartTotalItems = chartItems.length;
  const totalItems = chartItems.length;

  // --- 1. Data for Availability Bar Chart ---
  const statusData = [
    { name: 'Desabastecido', key: StockStatus.DESABASTECIDO, value: chartItems.filter(m => m.status === StockStatus.DESABASTECIDO).length },
    { name: 'SubStock', key: StockStatus.SUBSTOCK, value: chartItems.filter(m => m.status === StockStatus.SUBSTOCK).length },
    { name: 'NormoStock', key: StockStatus.NORMOSTOCK, value: chartItems.filter(m => m.status === StockStatus.NORMOSTOCK).length },
    { name: 'SobreStock', key: StockStatus.SOBRESTOCK, value: chartItems.filter(m => m.status === StockStatus.SOBRESTOCK).length },
    { name: 'Sin Rotación', key: StockStatus.SIN_ROTACION, value: chartItems.filter(m => m.status === StockStatus.SIN_ROTACION).length },
  ].map(item => ({
    ...item,
    percentageStr: chartTotalItems > 0 ? ((item.value / chartTotalItems) * 100).toFixed(1) : "0.0",
    numericPercentage: chartTotalItems > 0 ? (item.value / chartTotalItems) * 100 : 0
  }));

  // --- 2. Calculate Availability Score for Center Card directly from chartItems ---
  const availableItemsCount = chartItems.filter(m => 
    m.status === StockStatus.NORMOSTOCK || m.status === StockStatus.SOBRESTOCK
  ).length;

  const availabilityScore = chartTotalItems > 0 ? (availableItemsCount / chartTotalItems) * 100 : 0;

  let availabilityStatus = 'BAJO';
  if (availabilityScore >= 90) availabilityStatus = 'OPTIMO';
  else if (availabilityScore >= 80) availabilityStatus = 'ALTO';
  else if (availabilityScore >= 70) availabilityStatus = 'REGULAR';

  // --- 3. Data for Distribution Chart (Meds vs Insumos) from chartItems ---
  const typeStats = chartItems.reduce((acc, item) => {
    const rawType = (item.medtip || '').toUpperCase().trim();
    let category = 'OTROS';
    if (rawType.startsWith('M') || item.name.includes('TABLET')) category = 'MEDICAMENTOS';
    else if (rawType.startsWith('I')) category = 'INSUMOS';
    else category = 'MEDICAMENTOS'; 

    if (!acc[category]) acc[category] = { count: 0, money: 0 };
    acc[category].count += 1;
    acc[category].money += (item.estimatedInvestment || 0); // Defensive check
    return acc;
  }, {} as Record<string, { count: number; money: number }>);

  // Convert to array for Bar Chart
  const distributionData = [
    { name: 'MEDS', value: typeStats['MEDICAMENTOS']?.count || 0, money: typeStats['MEDICAMENTOS']?.money || 0, color: '#3B82F6' }, // Blue
    { name: 'INSUMOS', value: typeStats['INSUMOS']?.count || 0, money: typeStats['INSUMOS']?.money || 0, color: '#A855F7' }, // Purple
  ];

  // Helper for Indicator Style
  const getIndicatorStyle = (status: string) => {
    switch(status) {
      case 'OPTIMO': return { container: 'bg-blue-50 border-blue-100', text: 'text-blue-800', badge: 'bg-blue-200 text-blue-900' };
      case 'ALTO': return { container: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-800', badge: 'bg-emerald-200 text-emerald-900' };
      case 'REGULAR': return { container: 'bg-amber-50 border-amber-200', text: 'text-amber-800', badge: 'bg-amber-200 text-amber-900' };
      default: return { container: 'bg-red-50 border-red-100', text: 'text-red-800', badge: 'bg-red-200 text-red-900' };
    }
  };
  const indicatorStyle = getIndicatorStyle(availabilityStatus);

  // --- Custom Tooltips ---
  const CustomBarLabel = (props: any) => {
    const { x, y, width, index } = props;
    const item = statusData[index];
    const value = item.value; 
    const percentage = item.percentageStr;

    if (value === 0) return null;
    return (
      <g>
        <text x={x + width / 2} y={y - 20} fill="#1F2937" textAnchor="middle" dy={0} fontSize={12} fontWeight="800">
          {value}
        </text>
        <text x={x + width / 2} y={y - 8} fill="#6B7280" textAnchor="middle" dy={0} fontSize={9} fontWeight="600">
          {percentage}%
        </text>
      </g>
    );
  };

  const CustomStatusTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-white p-3 border border-gray-200 shadow-xl rounded-lg text-xs z-50">
                <p className="font-bold text-sm mb-1" style={{ color: COLORS[data.key as StockStatus] }}>
                    {data.name}
                </p>
                <div className="text-gray-600 mb-1">
                    Cantidad: <span className="font-bold text-gray-900">{data.value}</span>
                </div>
                <div className="text-gray-500 mb-1">
                    Porcentaje: <span className="font-bold text-gray-900">{data.percentageStr}%</span>
                </div>
                <div className="text-[10px] text-gray-400 italic mt-1 border-t pt-1 border-gray-100">
                    {STATUS_DESC[data.key as StockStatus]}
                </div>
            </div>
        );
    }
    return null;
  };

  const CustomDistTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-2 border border-gray-200 shadow-md rounded text-xs z-50">
          <p className="font-bold uppercase" style={{ color: data.color }}>{data.name}</p>
          <p className="text-gray-900 font-bold">{data.value} ítems</p>
          <p className="text-gray-500">S/ {(data.money || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4 2xl:space-y-6">
        
        {/* --- COMPACT CONTROLS TOOLBAR --- */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center gap-3">
                <div className="bg-teal-500/10 text-teal-700 p-2 rounded-xl shrink-0 border border-teal-500/10">
                    <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                        Diagnóstico de Disponibilidad
                    </h3>
                </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* Switch 1: Horizon (Inicial vs Proyectado Simple vs Proyectado Ajustado) */}
                <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 text-xs font-bold">
                    <button
                        onClick={() => onViewModeChange?.('INITIAL')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                            viewMode === 'INITIAL'
                                ? 'bg-white text-teal-900 shadow-sm border border-slate-200 font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Stock Actual con CPA Simple (sin pedidos)"
                    >
                        <span className={`h-2 w-2 rounded-full ${viewMode === 'INITIAL' ? 'bg-teal-500' : 'bg-slate-300'}`} />
                        Stock Inicial
                    </button>
                    <button
                        onClick={() => onViewModeChange?.('PROJECTED_SIMPLE')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                            viewMode === 'PROJECTED_SIMPLE'
                                ? 'bg-white text-blue-900 shadow-sm border border-slate-200 font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Proyectado con pedido validado evaluado con CPA Simple (sin ajustes)"
                    >
                        <span className={`h-2 w-2 rounded-full ${viewMode === 'PROJECTED_SIMPLE' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                        Proyectado (CPA Simple)
                    </button>
                    <button
                        onClick={() => onViewModeChange?.('PROJECTED_ADJUSTED')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                            viewMode === 'PROJECTED_ADJUSTED'
                                ? 'bg-white text-purple-900 shadow-sm border border-slate-200 font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Proyectado con pedido validado evaluado con CPA Ajustado por atipicidades"
                    >
                        <span className={`h-2 w-2 rounded-full ${viewMode === 'PROJECTED_ADJUSTED' ? 'bg-purple-500' : 'bg-slate-300'}`} />
                        Proyectado (CPA Ajust.)
                    </button>
                </div>

                {/* Switch 2: Scope (Todos vs DME) */}
                <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 text-xs font-bold">
                    <button
                        onClick={() => onScopeFilterChange?.('ALL')}
                        className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                            scopeFilter === 'ALL' || !scopeFilter
                                ? 'bg-white text-slate-900 shadow-sm border border-slate-200 font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        Todos (100%)
                    </button>
                    <button
                        onClick={() => onScopeFilterChange?.('DME')}
                        className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                            scopeFilter === 'DME'
                                ? 'bg-indigo-600 text-white shadow-sm font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="Filtrar gráficos para Medicamentos Esenciales"
                    >
                        Esenciales (DME)
                    </button>
                </div>
            </div>
        </div>
        
        {/* Esenciales (DME) sin ítems: se explica por qué sale en cero, en vez de dejar los
            gráficos vacíos sin decir nada. */}
        {scopeFilter === 'DME' && chartTotalItems === 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-indigo-900">
                    <strong>No hay medicamentos esenciales (DME) en este archivo.</strong>{' '}
                    Se consideran esenciales los ítems con MEDTIP «M», MEDPET «P» y MEDEST «S» o «_».
                </p>
                <button
                    onClick={() => onScopeFilterChange?.('ALL')}
                    className="shrink-0 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                    Ver todos los ítems
                </button>
            </div>
        )}

        {/* --- TOP SECTION: 3 COLUMNS --- */}
        {/* Layout: Changed to stack on mobile/tablet, and row on XL screens */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_0.8fr_1.1fr] gap-4 2xl:gap-6 items-stretch">
            
            {/* 1. LEFT: Availability Bar Chart */}
            <div className="bg-white p-4 2xl:p-8 rounded-2xl border border-gray-100 shadow-sm flex flex-col h-full min-h-[280px] 2xl:min-h-[380px]">
                <div className="flex justify-between items-center mb-4 2xl:mb-6">
                   <h4 className="text-[10px] 2xl:text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Distribución de Disponibilidad
                   </h4>
                   {selectedStatusFilter && (
                      <button
                         onClick={() => onStatusFilterChange?.(null)}
                         className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-xs"
                         title="Quitar filtro de la matriz"
                      >
                         <span>Filtro: {selectedStatusFilter}</span>
                         <X className="h-3 w-3 text-slate-300 hover:text-white" />
                      </button>
                   )}
                </div>

                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                            data={statusData} 
                            margin={{ top: 30, right: 10, left: 0, bottom: 0 }} 
                            barSize={30}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                            <XAxis 
                                dataKey="name" 
                                axisLine={{ stroke: '#E5E7EB', strokeWidth: 1.5 }} 
                                tickLine={false} 
                                tick={(props: any) => {
                                  const { x, y, payload, index } = props;
                                  const itemKey = statusData[index]?.key as StockStatus;
                                  const isSelected = selectedStatusFilter === itemKey;
                                  return (
                                    <g transform={`translate(${x},${y})`}>
                                      <text
                                        x={0}
                                        y={0}
                                        dy={12}
                                        textAnchor="middle"
                                        fontSize={9}
                                        fontWeight={isSelected ? 900 : 600}
                                        fill={isSelected ? COLORS[itemKey] : '#6B7280'}
                                        className="cursor-pointer select-none hover:underline"
                                        onClick={() => handleBarClick(itemKey)}
                                      >
                                        {payload.value}
                                      </text>
                                    </g>
                                  );
                                }} 
                                interval={0}
                            />
                            <YAxis 
                                axisLine={{ stroke: '#E5E7EB', strokeWidth: 1.5 }}
                                tickLine={false}
                                tick={{ fill: '#9CA3AF', fontSize: 9, fontWeight: 500 }}
                                domain={[0, 100]}
                                ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                                tickFormatter={(value) => `${value}%`}
                                width={30}
                            />
                            <Tooltip content={<CustomStatusTooltip />} cursor={{ fill: '#F9FAFB' }} />
                            <Bar 
                                dataKey="numericPercentage" 
                                radius={[6, 6, 0, 0]}
                                onClick={(entry: any) => {
                                  if (entry && entry.key) {
                                    handleBarClick(entry.key as StockStatus);
                                  }
                                }}
                            >
                                {statusData.map((entry, index) => {
                                    const isSelected = selectedStatusFilter === entry.key;
                                    const isAnySelected = !!selectedStatusFilter;
                                    return (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={COLORS[entry.key as StockStatus]}
                                            opacity={isAnySelected ? (isSelected ? 1 : 0.3) : 1}
                                            stroke={isSelected ? BORDER_COLORS[entry.key as StockStatus] : undefined}
                                            strokeWidth={isSelected ? 2.5 : 0}
                                            className="cursor-pointer transition-all duration-200 hover:opacity-80"
                                            onClick={() => handleBarClick(entry.key as StockStatus)}
                                        />
                                    );
                                })}
                                <LabelList content={<CustomBarLabel />} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 2. CENTER: Availability Indicator Card */}
            <div className={`rounded-2xl p-6 2xl:p-8 border flex flex-col items-center justify-center text-center shadow-sm relative h-full min-h-[280px] 2xl:min-h-[380px] ${indicatorStyle.container}`}>
                <h4 className="text-[9px] 2xl:text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1 2xl:mb-2">
                    {scopeFilter === 'DME' ? '% DISPONIBILIDAD ESENCIALES (DME)' : '% DISPONIBILIDAD DE ÍTEMS'}
                </h4>
                <div className={`text-5xl 2xl:text-7xl font-black mb-3 2xl:mb-4 ${indicatorStyle.text} tracking-tighter`}>
                    {availabilityScore.toFixed(1)}%
                </div>
                <div className={`px-3 py-1 2xl:px-4 2xl:py-1.5 rounded-full text-[9px] 2xl:text-[10px] font-bold uppercase tracking-wide mb-3 2xl:mb-4 ${indicatorStyle.badge}`}>
                    {availabilityStatus}
                </div>
                <p className="text-[9px] 2xl:text-[10px] text-gray-500 max-w-[200px] leading-relaxed mb-4 2xl:mb-6">
                    {scopeFilter === 'DME' 
                        ? 'Medicamentos esenciales con stock disponible (NormoStock + SobreStock).' 
                        : 'Medicamentos e insumos seleccionados con stock disponible en el establecimiento.'}
                </p>
                <div className="absolute bottom-4 2xl:bottom-6 w-full px-6 2xl:px-8 flex justify-between text-[8px] 2xl:text-[9px] font-bold uppercase text-gray-400/80">
                      <span>Meta: &gt;90%</span>
                      <span>{availableItemsCount} / {chartTotalItems}</span>
                </div>
            </div>

            {/* 3. RIGHT: Distribution Card */}
            <div className="bg-white p-4 2xl:p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col h-full min-h-[280px] 2xl:min-h-[380px]">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 2xl:mb-4 flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-purple-500" />
                    Distribución de Ítems
                </h4>
                
                <div className="flex-1 w-full min-h-0 flex flex-col justify-center">
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart 
                            data={distributionData} 
                            layout="vertical" 
                            margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                            barCategoryGap={15}
                        >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3F4F6" />
                            <XAxis type="number" hide />
                            <YAxis 
                                dataKey="name" 
                                type="category" 
                                axisLine={false} 
                                tickLine={false}
                                tick={{ fontSize: 9, fontWeight: 'bold', fill: '#6B7280' }}
                                width={50}
                            />
                            <Tooltip content={<CustomDistTooltip />} cursor={{fill: 'transparent'}} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                                {distributionData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                                <LabelList 
                                    dataKey="value" 
                                    position="right" 
                                    style={{ fontSize: 10, fontWeight: 'bold', fill: '#374151' }} 
                                    formatter={(val: number) => `${val} (${((val/totalItems)*100).toFixed(0)}%)`}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className="mt-auto pt-3 border-t border-gray-50 flex justify-between items-center px-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Total de Ítems</span>
                    <span className="text-lg font-black text-gray-800">{totalItems}</span>
                </div>
            </div>

        </div>

    </div>
  );
});
