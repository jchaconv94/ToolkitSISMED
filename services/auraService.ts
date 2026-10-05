
import { MedicationInput, AuraAnalysisResult, StockStatus, AnalyzedMedication } from "../types";
import { classifyStock } from "./stockStatus";
import { isVaccineProduct } from "./vaccines";

// Helper: Calculate Median
export const calculateMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// 1. Math Helpers (SISMED + Spike Detection)
export const calculateAdjustedCPM = (history: number[]): { adjusted: number; adjustedNoLows: number; raw: number; spikes: number; details: string; threshold: number; lowThreshold: number; lows: number; isSporadic: boolean } => {
  const nonZeroMonths = history.filter(val => val > 0);
  const frequency = nonZeroMonths.length;
  
  if (frequency === 0) {
    return { adjusted: 0, adjustedNoLows: 0, raw: 0, spikes: 0, details: "Sin consumo histórico", threshold: 0, lowThreshold: 0, lows: 0, isSporadic: false };
  }

  const rawSum = nonZeroMonths.reduce((a, b) => a + b, 0);

  // --- LOGIC CHANGE: SPORADIC CONSUMPTION ---
  // RULE: Frequency <= 5 is considered Sporadic (Low Rotation).
  if (frequency <= 5) {
      const activeMonthsAverage = rawSum / frequency;
      return {
          adjusted: activeMonthsAverage,
          adjustedNoLows: activeMonthsAverage,
          raw: activeMonthsAverage, 
          spikes: 0,
          details: `Consumo Esporádico (${frequency} salidas/año). CPA basado en meses activos.`,
          threshold: 5, 
          lowThreshold: 0,
          lows: 0,
          isSporadic: true
      };
  }

  // --- NORMAL LOGIC (High Frequency > 5 months) ---
  const rawAvg = rawSum / frequency;
  const median = calculateMedian(nonZeroMonths);
  
  // Threshold logic: 
  // Ficha Técnica N° 30: "Si un mes específico supera en más del 50% a la mediana histórica"
  const threshold = median * 1.5;

  // Low Threshold Logic (New Feature)
  // Detect "very low" consumption (e.g., < 30% of median)
  const lowThreshold = median * 0.3;

  // Identify normal values vs spikes vs lows
  // Note: Lows are NOT excluded from calculation in the current logic, just flagged.
  // Only spikes (> threshold) are excluded.
  const validMonths = nonZeroMonths.filter(val => val <= threshold);
  const spikes = nonZeroMonths.filter(val => val > threshold);
  const lows = nonZeroMonths.filter(val => val < lowThreshold);
  
  // New: Calculate adjusted average excluding BOTH spikes AND lows
  const validMonthsNoLows = nonZeroMonths.filter(val => val <= threshold && val >= lowThreshold);

  let adjustedAvg = 0;
  if (validMonths.length > 0) {
    adjustedAvg = validMonths.reduce((a, b) => a + b, 0) / validMonths.length;
  } else {
    adjustedAvg = median;
  }

  let adjustedNoLowsAvg = 0;
  if (validMonthsNoLows.length > 0) {
    adjustedNoLowsAvg = validMonthsNoLows.reduce((a, b) => a + b, 0) / validMonthsNoLows.length;
  } else {
    // Fallback if everything is filtered out (unlikely but possible if all are spikes or lows)
    adjustedNoLowsAvg = adjustedAvg; 
  }

  let details = `Promedio: ${adjustedAvg.toFixed(1)}`;
  if (spikes.length > 0) {
    details = `Se excluyeron ${spikes.length} picos atípicos (Ref: >${threshold.toFixed(0)})`;
  }
  if (lows.length > 0) {
    details += ` | ${lows.length} consumos muy bajos detectados (<${lowThreshold.toFixed(1)})`;
  }

  return { 
    adjusted: adjustedAvg, 
    adjustedNoLows: adjustedNoLowsAvg,
    raw: rawAvg, 
    spikes: spikes.length, 
    details,
    threshold,
    lowThreshold,
    lows: lows.length,
    isSporadic: false
  };
};

const analyzeItemLocally = (item: MedicationInput): AnalyzedMedication => {
  const history = item.monthlyConsumption;
  const { adjusted: cpm, adjustedNoLows: cpmExcludingLows, raw: rawCpm, spikes, details, threshold, lowThreshold, lows, isSporadic } = calculateAdjustedCPM(history);
  
  // 1. Estado inicial: regla única de DIGEMID (services/stockStatus.ts).
  const { months: monthsOfProvision, status } = classifyStock(item.currentStock, cpm);

  // 2. Anomaly Details Appending
  let finalAnomalyDetails = details;
  
  // Detect special handling items
  const upperName = item.name.toUpperCase();
  const isVaccineOrDiluent = isVaccineProduct(upperName);

  // Suggest Order Quantity
  let quantityToOrder = 0;

  if (!isVaccineOrDiluent && status !== StockStatus.SOBRESTOCK && status !== StockStatus.SIN_ROTACION) {
     
     const MIN_SAFETY_STOCK = 2; // Always maintain at least 2 units physically
     let targetStock = 0;

     if (isSporadic) {
        // --- SPORADIC LOGIC (BAJA ROTACIÓN) ---
        // Frequency <= 5 months.
        // STRATEGY: Aim for 3 months coverage (Buffer Zone).
        // Why? User request: 2 months is too risky. If we order just enough for 2 months, 
        // a single consumption event drops the item back into Substock immediately.
        // 3 months provides a buffer to stay within Normostock (2-6) after a sale.
        
        targetStock = cpm * 3; 

        // Hard Floor: Never aim for less than 2 units physically.
        targetStock = Math.max(targetStock, MIN_SAFETY_STOCK);

        if (item.currentStock < targetStock) {
            if (!finalAnomalyDetails.includes("Normostock")) {
                 finalAnomalyDetails += " | Ajuste: Cobertura Estratégica (3 meses)";
             }
        }

     } else {
        // --- NORMAL LOGIC (ALTA ROTACIÓN) ---
        // Frequency > 5 months.
        // STRATEGY: Build stock for 6 months coverage (Normostock Ceiling).
        targetStock = cpm * 6;
        targetStock = Math.max(targetStock, MIN_SAFETY_STOCK);
     }

     if (item.currentStock < targetStock) {
        quantityToOrder = Math.ceil(targetStock - item.currentStock);
     }
  }
  
  if (quantityToOrder < 0) quantityToOrder = 0;

  let expirationRisk = "BAJO";
  if (status === StockStatus.SIN_ROTACION || monthsOfProvision > 18) {
    expirationRisk = "ALTO";
  } else if (monthsOfProvision > 12) {
    expirationRisk = "MEDIO";
  }

  if (isVaccineOrDiluent) {
      finalAnomalyDetails = "Item de Inmunizaciones (No genera req.)";
  }

  return {
    id: item.id,
    name: item.name,
    currentStock: item.currentStock,
    unitPrice: item.unitPrice,
    medtip: item.medtip,
    medpet: item.medpet,
    medest: item.medest,
    ff: item.ff,
    
    cpm: cpm, 
    cpmExcludingLows: cpmExcludingLows,
    rawCpm: rawCpm,
    monthsOfProvision: monthsOfProvision,
    status: status,
    
    expirationRisk: expirationRisk,
    quantityToOrder: quantityToOrder,
    estimatedInvestment: quantityToOrder * item.unitPrice,
    
    anomalyDetails: finalAnomalyDetails,
    hasSpikes: spikes > 0,
    spikesCount: spikes,
    spikeThreshold: threshold, 
    
    hasLows: lows > 0,
    lowThreshold: lowThreshold,

    isSporadic: isSporadic,
    originalHistory: history
  };
};

export const analyzeInventoryWithAura = async (
  inventory: MedicationInput[], 
  referenceDate?: string,
  vaccinesExcluded: boolean = false
): Promise<AuraAnalysisResult> => {
  try {
    const analyzedMedications = inventory.map(analyzeItemLocally);

    // Filter essential medications for DME indicator
    const essentialMedications = analyzedMedications.filter(m => {
        const isMed = (m.medtip || '').toUpperCase().trim() === 'M';
        const isPet = (m.medpet || '').toUpperCase().trim() === 'P';
        const est = (m.medest || '').toUpperCase().trim();
        const isEst = est === '_' || est === 'S';
        return isMed && isPet && isEst;
    });

    // Indicator 39 Classification (Using ONLY Essential Medications)
    const normoCount = essentialMedications.filter(m => m.status === StockStatus.NORMOSTOCK).length;
    const sobreCount = essentialMedications.filter(m => m.status === StockStatus.SOBRESTOCK).length;
    const desabastecidoCount = essentialMedications.filter(m => m.status === StockStatus.DESABASTECIDO).length;
    const subCount = essentialMedications.filter(m => m.status === StockStatus.SUBSTOCK).length;
    const sinRotacionCount = essentialMedications.filter(m => m.status === StockStatus.SIN_ROTACION).length;

    // Evaluated items for indicator (Using ALL essential items, including Sin Rotacion, following PDF logic)
    const evaluatedItemsCount = essentialMedications.length;
    // Adequate availability (Numerator)
    const availableItems = essentialMedications.filter(m => 
        m.status === StockStatus.NORMOSTOCK || 
        m.status === StockStatus.SOBRESTOCK
    ).length;

    const dmeScore = evaluatedItemsCount > 0 ? (availableItems / evaluatedItemsCount) * 100 : 0;
    
    let indicatorStatus: 'ÓPTIMA' | 'ACEPTABLE' | 'EN ALERTA' | 'CRÍTICA' = 'CRÍTICA';
    let rawStatus: 'OPTIMO' | 'ALTO' | 'REGULAR' | 'BAJO' = 'BAJO';

    if (dmeScore >= 90) { indicatorStatus = 'ÓPTIMA'; rawStatus = 'OPTIMO'; }
    else if (dmeScore >= 80) { indicatorStatus = 'ACEPTABLE'; rawStatus = 'ALTO'; }
    else if (dmeScore >= 70) { indicatorStatus = 'EN ALERTA'; rawStatus = 'REGULAR'; }
    else { indicatorStatus = 'CRÍTICA'; rawStatus = 'BAJO'; }

    // Calculate Stats for Summary
    const spikesFound = analyzedMedications.filter(m => m.hasSpikes).length;
    const investment = analyzedMedications.reduce((sum, m) => sum + m.estimatedInvestment, 0);

    let summary = `ANÁLISIS DE DISPONIBILIDAD (Ficha Técnica FT-EAM-001)\n\n`;
    summary += `Se han procesado ${analyzedMedications.length} ítems en total. Para el cálculo del indicador se evaluaron ${evaluatedItemsCount} medicamentos esenciales.\n\n`;
    summary += `Disponibilidad de Medicamentos Esenciales (DME): ${dmeScore.toFixed(1)}% — Nivel ${indicatorStatus.toUpperCase()}.\n\n`;
    
    summary += `Distribución de Stock:\n`;
    summary += ` • Normostock: ${normoCount} ítems\n`;
    summary += ` • Sobrestock: ${sobreCount} ítems\n`;
    summary += ` • Substock: ${subCount} ítems (Riesgo inminente de desabastecimiento)\n`;
    summary += ` • Desabastecidos: ${desabastecidoCount} ítems (Con CPM > 0 y Stock 0)\n`;
    summary += ` • Sin Rotación / Consumo nulo: ${sinRotacionCount} ítems (Excluidos de la evaluación)\n\n`;

    summary += `Análisis de Requerimientos y Ajustes (Toolkit):\n`;
    if (spikesFound > 0) {
        summary += `El sistema re-calculó el CPM ajustando ${spikesFound} ítems detectados con picos atípicos de consumo para evitar un sobrestock futuro injustificado.\n`;
    }
    summary += `Estrategia de Baja Rotación: Los ítems con movimiento esporádico (< 6 meses al año) asegurarán una cobertura de 3 meses para evitar desabastecimientos inmediatos.\n`;
    summary += `Inversión Sugerida para Reabastecimiento del Petitorio: S/ ${investment.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;

    return {
      medications: analyzedMedications,
      indicators: {
        dmeScore,
        status: rawStatus,
        totalItems: evaluatedItemsCount, // Total evaluated for indicator
        availableItems
      },
      executiveSummary: summary,
      timestamp: new Date().toISOString(),
      referenceDate: referenceDate,
      analysisConfig: {
        vaccinesExcluded 
      }
    };

  } catch (error) {
    console.error("Aura analysis failed:", error);
    const analyzed = inventory.map(analyzeItemLocally);
    return {
        medications: analyzed,
        indicators: {
          dmeScore: 0,
          status: 'BAJO',
          totalItems: analyzed.length,
          availableItems: 0
        },
        executiveSummary: "Error en el cálculo local.",
        timestamp: new Date().toISOString(),
        referenceDate: referenceDate,
        analysisConfig: { vaccinesExcluded: false }
    };
  }
};
