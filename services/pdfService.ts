
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ensurePdfUnicodeFont, PDF_UNICODE_FONT } from "./pdfUnicodeFont";
import { AuraAnalysisResult, StockStatus, AnalyzedMedication, AdditionalItem, DashboardViewMode } from "../types";

// --- COLORS PALETTE (PREMIUM UI MATCH) ---
const COLORS = {
  TEAL_HEADER: [0, 150, 136] as [number, number, number], // #009688
  TEAL_DARK: [13, 148, 136] as [number, number, number],
  TEXT_DARK: [17, 24, 39] as [number, number, number], // Gray-900
  TEXT_GRAY: [107, 114, 128] as [number, number, number], // Gray-500
  WHITE: [255, 255, 255] as [number, number, number],
  BLACK: [0, 0, 0] as [number, number, number],
  PURPLE: [147, 51, 234] as [number, number, number], // Purple-600 for extra items
  
  // Status Colors
  RED: [239, 68, 68] as [number, number, number],      // Desabastecido
  ORANGE: [245, 158, 11] as [number, number, number],  // Substock
  GREEN: [16, 185, 129] as [number, number, number],   // Normostock
  INDIGO: [99, 102, 241] as [number, number, number],  // Sobrestock
  GRAY: [107, 114, 128] as [number, number, number],   // Sin Rotacion (Text)
  
  // Chart Colors
  PIE_BLUE: [59, 130, 246] as [number, number, number], // Blue-500
  PIE_PURPLE: [168, 85, 247] as [number, number, number], // Purple-500

  // Backgrounds for Cards
  BG_RED_LIGHT: [254, 242, 242] as [number, number, number], 
  BG_GREEN_LIGHT: [236, 253, 245] as [number, number, number], 
  
  // Table Highlights
  YELLOW_HIGHLIGHT: [255, 215, 0] as [number, number, number],
  BG_GREEN_CELL: [220, 252, 231] as [number, number, number], // Green-100
  TEXT_GREEN_DARK: [20, 83, 45] as [number, number, number], // Green-900
  
  // CPA Active Backgrounds
  BG_ACTIVE_SIMPLE: [191, 219, 254] as [number, number, number], // Blue-200 (Darker than Blue-50)
  BG_ACTIVE_ADJUSTED: [153, 246, 228] as [number, number, number], // Teal-200 (Darker than Teal-50)
  TEXT_INACTIVE: [156, 163, 175] as [number, number, number], // Gray-400

  // New Status Colors for Cells
  BG_GRAY_EXCLUDED: [229, 231, 235] as [number, number, number], // Gray-200
  TEXT_GRAY_EXCLUDED: [107, 114, 128] as [number, number, number], // Gray-500
  BG_ORANGE_LOW: [255, 237, 213] as [number, number, number], // Orange-100
  TEXT_ORANGE_LOW: [154, 52, 18] as [number, number, number], // Orange-800
};

const formatCurrency = (val: number) => `S/ ${val.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const getMonthHeaders = (refDate?: string, numMonths = 12) => {
    if (!refDate) {
        const headers = [];
        for (let i = 1; i <= numMonths; i++) headers.push(`M${i}`);
        return headers;
    }
    const [yearStr, monthStr] = refDate.split('-');
    const date = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
    const headers = [];
    for (let i = 0; i < numMonths; i++) {
        const d = new Date(date);
        d.setMonth(d.getMonth() - ((numMonths - 1) - i));
        const mName = d.toLocaleString('es-ES', { month: 'short' }).toUpperCase().replace('.', '');
        const yShort = d.getFullYear().toString().slice(2);
        headers.push(`${mName}-${yShort}`);
    }
    return headers;
};

// --- HELPER: Replicate Logic for PDF Dynamic Calculation ---
const calculateDynamicMetricsPDF = (item: AnalyzedMedication) => {
    let activeCpm = 0;
    const excludedIndices = item.excludedIndices || [];
    let mode = item.selectedCpaMode || 'ADJUSTED';

    if (excludedIndices.length === 0) {
        activeCpm = mode === 'SIMPLE' ? item.rawCpm : item.cpm;
    } else {
        // Manual Recalculation
        const history = item.originalHistory;
        const threshold = item.spikeThreshold || 0;
        const isSporadic = item.isSporadic;
        
        const valuesToAverage: number[] = [];

        history.forEach((val, idx) => {
            if (val === 0) return; // Ignore zeros
            if (excludedIndices.includes(idx)) return; // User excluded

            if (mode === 'SIMPLE') {
                valuesToAverage.push(val);
            } else {
                // ADJUSTED MODE
                if (isSporadic) {
                    // Sporadic: No spike exclusion, just average active months
                    valuesToAverage.push(val);
                } else {
                    // Normal: Exclude spikes
                    if (val <= threshold) {
                        valuesToAverage.push(val);
                    }
                }
            }
        });

        activeCpm = valuesToAverage.length > 0
            ? valuesToAverage.reduce((a, b) => a + b, 0) / valuesToAverage.length
            : 0;
    }
    
    // Calculate Months
    const activeMonths = activeCpm > 0 
        ? item.currentStock / activeCpm 
        : (item.currentStock > 0 ? Infinity : 0);

    const roundedMonths = isFinite(activeMonths) ? parseFloat(activeMonths.toFixed(1)) : Infinity;

    // Calculate Status
    let activeStatus = StockStatus.NORMOSTOCK;
    if (item.currentStock === 0) {
        activeStatus = StockStatus.DESABASTECIDO;
    } else if (activeCpm === 0 && item.currentStock > 0) {
        activeStatus = StockStatus.SIN_ROTACION;
    } else if (roundedMonths > 6) {
        activeStatus = StockStatus.SOBRESTOCK;
    } else if (roundedMonths >= 2 && roundedMonths <= 6) {
        activeStatus = StockStatus.NORMOSTOCK;
    } else {
        activeStatus = StockStatus.SUBSTOCK;
    }

    return { activeCpm, activeMonths, activeStatus };
};

const formatDateToMonthYear = (dateStr?: string) => {
    if (!dateStr) return 'ACTUAL';
    try {
        const [year, month] = dateStr.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        // Check if date is valid
        if (isNaN(date.getTime())) return dateStr;
        
        const monthName = date.toLocaleString('es-ES', { month: 'long' });
        return `${monthName.toUpperCase()} ${year}`;
    } catch (e) {
        return dateStr;
    }
};

/** Celda de meses con valor infinito (stock sin consumo). */
const isInfinityCell = (data: any) =>
  (data.column?.dataKey === 'currentMonths' || data.column?.dataKey === 'monthsProvision') && data.cell?.raw === '∞';

/** Dibuja «∞» con dos óvalos, centrado en la celda y del color de su texto. */
const drawInfinity = (data: any) => {
  const doc = data.doc;
  const { x, y, width, height } = data.cell;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const color = data.cell.styles?.textColor;
  if (Array.isArray(color)) doc.setDrawColor(color[0], color[1], color[2]);
  else doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.28);
  doc.ellipse(cx - 0.75, cy, 0.75, 0.55, 'S');
  doc.ellipse(cx + 0.75, cy, 0.75, 0.55, 'S');
};

export const generateFullReportPDF = async (
    result: AuraAnalysisResult, 
    filteredTableItems?: AnalyzedMedication[],
    additionalItems?: AdditionalItem[],
    establishmentName: string = 'ESTABLECIMIENTO DE SALUD',
    responsibleName: string = '',
    viewMode: DashboardViewMode = 'INITIAL'
): Promise<void> => {
  try {
      // 1. Initialize Landscape PDF (A4 Landscape: 297mm x 210mm)
      const doc = new jsPDF('l', 'mm', 'a4');
      const activeFont = await ensurePdfUnicodeFont(doc);
      const pageWidth = doc.internal.pageSize.width; 
      
      // ==========================================
      // PAGE 1: DASHBOARD & GRAPHS
      // ==========================================
      
      doc.setFillColor(COLORS.TEAL_HEADER[0], COLORS.TEAL_HEADER[1], COLORS.TEAL_HEADER[2]);
      doc.rect(0, 0, pageWidth, 24, "F");
      
      doc.setTextColor(COLORS.WHITE[0], COLORS.WHITE[1], COLORS.WHITE[2]);
      doc.setFont(activeFont, "bold");
      doc.setFontSize(20);
      doc.text("DISPONIBILIDAD DE MEDICAMENTOS ESENCIALES", 15, 14);

      // Date subtitle on left
      const formattedDate = formatDateToMonthYear(result.referenceDate);
      doc.setFontSize(10);
      doc.setFont(activeFont, "normal");
      doc.setTextColor(240, 240, 240);
      doc.text(`CORTE: ${formattedDate}  |  DIAGNÓSTICO DE DISPONIBILIDAD (FOTOGRAFÍA INICIAL)`, 15, 20);
      
      // Establishment Info (with Code & Category if available)
      const facilityName = result.establishmentName ? result.establishmentName.toUpperCase() : establishmentName.toUpperCase();
      const facilityText = result.codEess 
        ? `${result.codEess.toUpperCase()} - ${facilityName}`
        : facilityName;

      const hasMicrored = !!result.microred;

      doc.setFontSize(12);
      doc.setFont(activeFont, "bold");
      doc.setTextColor(COLORS.WHITE[0], COLORS.WHITE[1], COLORS.WHITE[2]);
      doc.text(facilityText, pageWidth - 15, hasMicrored ? 12 : 15, { align: "right" });

      // Microred Info
      if (hasMicrored) {
        doc.setFontSize(10);
        doc.setFont(activeFont, "bold");
        doc.setTextColor(220, 245, 235); // Slight minty white highlight for microred
        doc.text(`MICRORED: ${result.microred!.toUpperCase()}`, pageWidth - 15, 18, { align: "right" });
      }

      // --- LAYOUT CALCULATIONS (SYMMETRY) ---
      const margin = 15;
      const startY = 32;
      const totalWidth = pageWidth - (margin * 2); // 297 - 30 = 267mm
      const gap = 10;
      
      // Right Column Width (Fixed for Indicators) approx 1/3
      const rightColW = 92;
      // Left Column Width (Fluid for Chart) approx 2/3
      const leftColW = totalWidth - rightColW - gap;

      // Heights Calculation
      const cardGap = 8;
      const leftCardH = 95; // Taller left panel (Non-flattened)
      const topRightH = 80; // Taller top-right (DME Indicator)
      const bottomRightH = 68; // Taller bottom-right (Distribution)

      // Coordinates
      const leftX = margin;
      const rightX = margin + leftColW + gap;
      
      const dmeY = startY;
      const distY = startY + topRightH + cardGap;


      // 1. LEFT PANEL: AVAILABILITY CHART
      doc.setDrawColor(220, 220, 220); // Light Gray Border
      doc.setLineWidth(0.3);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(leftX, startY, leftColW, leftCardH, 4, 4, "S"); // Stroke only for clean look
  

      // --- RECALCULATE STATUSES FOR CHARTS ---
      const recalculatedMedications = result.medications
          .filter(m => {
              const isMed = (m.medtip || '').toUpperCase().trim() === 'M';
              const isPet = (m.medpet || '').toUpperCase().trim() === 'P';
              const est = (m.medest || '').toUpperCase().trim();
              const isEst = est === '_' || est === 'S';
              return isMed && isPet && isEst;
          })
          .map(m => {
              const rawCpm = m.rawCpm || 0;
              const stock = m.currentStock || 0;
              const months = rawCpm > 0 ? stock / rawCpm : (stock > 0 ? Infinity : 0);
              const roundedMonths = isFinite(months) ? parseFloat(months.toFixed(1)) : Infinity;
              let status = StockStatus.NORMOSTOCK;
              if (stock === 0) status = StockStatus.DESABASTECIDO;
              else if (rawCpm === 0 && stock > 0) status = StockStatus.SIN_ROTACION;
              else if (roundedMonths > 6) status = StockStatus.SOBRESTOCK;
              else if (roundedMonths >= 2 && roundedMonths <= 6) status = StockStatus.NORMOSTOCK;
              else status = StockStatus.SUBSTOCK;

              return { ...m, status };
          });

      const stats = [
        { label: "Desabastecido", val: recalculatedMedications.filter(m => m.status === StockStatus.DESABASTECIDO).length, color: COLORS.RED },
        { label: "SubStock", val: recalculatedMedications.filter(m => m.status === StockStatus.SUBSTOCK).length, color: COLORS.ORANGE },
        { label: "NormoStock", val: recalculatedMedications.filter(m => m.status === StockStatus.NORMOSTOCK).length, color: COLORS.GREEN },
        { label: "SobreStock", val: recalculatedMedications.filter(m => m.status === StockStatus.SOBRESTOCK).length, color: COLORS.INDIGO },
        { label: "Sin Rotación", val: recalculatedMedications.filter(m => m.status === StockStatus.SIN_ROTACION).length, color: COLORS.GRAY },
      ];
      const maxVal = Math.max(...stats.map(s => s.val), 1);
      const totalItems = result.indicators?.totalItems || 1; // Keep original total or recalculate? Recalculate is safer.
      const recalculatedTotal = recalculatedMedications.length || 1;

      // Chart Dimensions
      const chartBottomMargin = 15;
      const chartTopMargin = 22;
      const chartAreaH = leftCardH - chartBottomMargin - chartTopMargin;
      const chartBaseY = startY + leftCardH - chartBottomMargin;
      
      const barWidth = 22;
      const totalBarsWidth = (barWidth * stats.length);
      const availableSpaceForSpacing = leftColW - 30 - totalBarsWidth; // 15mm padding each side
      const barGap = availableSpaceForSpacing / (stats.length - 1);

      doc.setDrawColor(245, 245, 245);
      doc.line(leftX + 10, chartBaseY, leftX + leftColW - 10, chartBaseY); // X-Axis

      let currentBarX = leftX + 15;

      stats.forEach(stat => {
          const barHeight = (stat.val / maxVal) * chartAreaH;
          const percentage = ((stat.val / recalculatedTotal) * 100).toFixed(1) + "%";

          doc.setFillColor(stat.color[0], stat.color[1], stat.color[2]);
          doc.rect(currentBarX, chartBaseY - barHeight, barWidth, barHeight, "F");

          doc.setFontSize(11);
          doc.setFont(activeFont, "bold");
          doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2]);
          doc.text(stat.val.toString(), currentBarX + (barWidth / 2), chartBaseY - barHeight - 7, { align: "center" });

          doc.setFontSize(7.5);
          doc.setFont(activeFont, "normal");
          doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
          doc.text(percentage, currentBarX + (barWidth / 2), chartBaseY - barHeight - 2, { align: "center" });

          doc.setFontSize(7.5); 
          doc.setFont(activeFont, "bold"); 
          doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
          doc.text(stat.label, currentBarX + (barWidth / 2), chartBaseY + 5, { align: "center" });

          currentBarX += barWidth + barGap;
      });

      // 2. RIGHT TOP: DME INDICATOR
      // Recalculate DME Score
      const availableItemsCount = recalculatedMedications.filter(m => 
          m.status === StockStatus.NORMOSTOCK || 
          m.status === StockStatus.SOBRESTOCK
      ).length;
      
      const dmeScore = recalculatedTotal > 0 ? (availableItemsCount / recalculatedTotal) * 100 : 0;
      
      let indicatorStatus = 'BAJO';
      if (dmeScore >= 90) indicatorStatus = 'OPTIMO';
      else if (dmeScore >= 80) indicatorStatus = 'ALTO';
      else if (dmeScore >= 70) indicatorStatus = 'REGULAR';

      let cardBg: [number, number, number] = [254, 242, 242]; // pale red
      let cardText: [number, number, number] = [185, 28, 28]; // dark red
      let badgeBg: [number, number, number] = [254, 202, 202]; // soft red badge

      if (indicatorStatus === 'OPTIMO') {
        cardBg = [239, 246, 255]; // pale blue
        cardText = [30, 64, 175]; // dark blue
        badgeBg = [191, 219, 254]; // soft blue
      } else if (indicatorStatus === 'ALTO') {
        cardBg = [240, 253, 244]; // pale green
        cardText = [21, 128, 61]; // dark green
        badgeBg = [187, 247, 208]; // soft green
      } else if (indicatorStatus === 'REGULAR') {
        cardBg = [255, 251, 235]; // pale amber
        cardText = [180, 83, 9]; // dark amber/brown
        badgeBg = [253, 230, 138]; // soft amber
      }

      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
      doc.roundedRect(rightX, dmeY, rightColW, topRightH, 4, 4, "FD");

      doc.setFontSize(9);
      doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
      doc.setFont(activeFont, "bold");
      doc.text("INDICADOR DME", rightX + (rightColW/2), dmeY + 13, { align: "center" });

      doc.setFontSize(32);
      doc.setTextColor(cardText[0], cardText[1], cardText[2]);
      doc.setFont(activeFont, "bold");
      doc.text(`${dmeScore.toFixed(1)}%`, rightX + (rightColW/2), dmeY + 33, { align: "center" });

      doc.setFillColor(badgeBg[0], badgeBg[1], badgeBg[2]);
      const badgeW = 34;
      doc.roundedRect(rightX + (rightColW/2) - (badgeW/2), dmeY + 39, badgeW, 6, 3, 3, "F");
      doc.setFontSize(7.5);
      doc.setTextColor(cardText[0], cardText[1], cardText[2]);
      doc.setFont(activeFont, "bold");
      doc.text(indicatorStatus, rightX + (rightColW/2), dmeY + 43.2, { align: "center" });

      doc.setFontSize(7.5);
      doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
      doc.setFont(activeFont, "normal");
      doc.text("Porcentaje de medicamentos esenciales", rightX + (rightColW/2), dmeY + 53, { align: "center" });
      doc.text("con stock disponible (Normo + Sobre).", rightX + (rightColW/2), dmeY + 57, { align: "center" });

      doc.setDrawColor(200, 200, 200);
      doc.line(rightX + 8, dmeY + 65, rightX + rightColW - 8, dmeY + 65);
      doc.setFontSize(7.5);
      doc.setFont(activeFont, "bold");
      doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
      doc.text("META: >90%", rightX + 10, dmeY + 73);
      doc.text(`Solo medicamentos esenciales: ${availableItemsCount}/${recalculatedTotal}`, rightX + rightColW - 10, dmeY + 73, { align: "right" });

      // 3. RIGHT BOTTOM: DISTRIBUTION
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(rightX, distY, rightColW, bottomRightH, 4, 4, "S");

      doc.setFontSize(9);
      doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
      doc.setFont(activeFont, "bold");
      doc.text("DISTRIBUCIÓN DE ÍTEMS", rightX + 10, distY + 12);

      const typeStats = result.medications.reduce((acc, item) => {
        const rawType = (item.medtip || '').toUpperCase().trim();
        const cat = (rawType.startsWith('M') || item.name.includes('TABLET')) ? 'MEDS' : 'INSUMOS';
        if (!acc[cat]) acc[cat] = { count: 0, money: 0 };
        acc[cat].count++;
        acc[cat].money += item.estimatedInvestment;
        return acc;
      }, {} as Record<string, {count: number, money: number}>);

      const itemsData = [
          { label: 'MEDICAMENTOS', val: typeStats['MEDS']?.count || 0, money: typeStats['MEDS']?.money || 0, color: COLORS.PIE_BLUE },
          { label: 'INSUMOS', val: typeStats['INSUMOS']?.count || 0, money: typeStats['INSUMOS']?.money || 0, color: COLORS.PIE_PURPLE }
      ];
      const total = itemsData.reduce((a,b) => a + b.val, 0);

      let barY = distY + 22;
      itemsData.forEach(item => {
          doc.setFontSize(7.5);
          doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
          doc.setFont(activeFont, "bold");
          doc.text(item.label, rightX + 10, barY - 1.5);

          const maxBarW = rightColW - 55;
          const pct = total > 0 ? item.val / total : 0;
          const barW = pct * maxBarW;

          doc.setFillColor(243, 244, 246);
          doc.roundedRect(rightX + 10, barY, maxBarW, 4, 1.5, 1.5, "F");
          doc.setFillColor(item.color[0], item.color[1], item.color[2]);
          if (barW > 0) {
              doc.roundedRect(rightX + 10, barY, barW, 4, 1.5, 1.5, "F");
          }

          doc.setFontSize(8);
          doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2]);
          doc.text(`${item.val} (${(pct*100).toFixed(0)}%)`, rightX + rightColW - 10, barY + 3, { align: "right" });

          doc.setFontSize(7.5);
          doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
          doc.setFont(activeFont, "normal");
          doc.text(formatCurrency(item.money), rightX + 10, barY + 7.5);
          barY += 16; 
      });

      doc.setDrawColor(240, 240, 240);
      doc.line(rightX + 10, distY + 52, rightX + rightColW - 10, distY + 52);
      doc.setFontSize(7.5);
      doc.setFont(activeFont, "bold");
      doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
      doc.text("TOTAL ÍTEMS", rightX + 10, distY + 59);
      doc.setFontSize(9);
      doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2]);
      doc.text(total.toString(), rightX + rightColW - 10, distY + 59, { align: "right" });

      // Calculate stats for the legend
      const normoCount = recalculatedMedications.filter(m => m.status === StockStatus.NORMOSTOCK).length;
      const sobreCount = recalculatedMedications.filter(m => m.status === StockStatus.SOBRESTOCK).length;
      const desabastecidoCount = recalculatedMedications.filter(m => m.status === StockStatus.DESABASTECIDO).length;
      const subCount = recalculatedMedications.filter(m => m.status === StockStatus.SUBSTOCK).length;
      const sinRotacionCount = recalculatedMedications.filter(m => m.status === StockStatus.SIN_ROTACION).length;

      // We skip adding a new page and just append the legend at the bottom of Page 1.
      let currentY = startY + leftCardH + cardGap;

      // COLUMN 1: SITUACIÓN DE STOCK (Left Column, below bar chart)
      doc.setFontSize(11);
      doc.setFont(activeFont, "bold");
      doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2]);
      doc.text("SITUACIÓN DE STOCK", 15, currentY + 5);

      let legendY = currentY + 14;

      const drawStatRowLeft = (y: number, label: string, count: number, color: number[], description: string) => {
         doc.setFillColor(color[0], color[1], color[2]);
         doc.circle(18, y - 1, 2, "F");
         
         doc.setFontSize(10);
         doc.setFont(activeFont, "bold");
         doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2]);
         doc.text(`${count.toString()}`, 30, y, { align: 'right' });
         
         doc.text(label, 38, y);

         doc.setFontSize(9);
         doc.setFont(activeFont, "normal");
         doc.setTextColor(COLORS.TEXT_GRAY[0], COLORS.TEXT_GRAY[1], COLORS.TEXT_GRAY[2]);
         doc.text(`- ${description}`, 68, y);
      };

      drawStatRowLeft(legendY, "Normostock", normoCount, COLORS.GREEN, "Cubre de 2 a 6 meses de demanda"); legendY += 9;
      drawStatRowLeft(legendY, "Sobrestock", sobreCount, COLORS.INDIGO, "Mayor a 6 meses (Riesgo de vencimiento u obsolescencia)"); legendY += 9;
      drawStatRowLeft(legendY, "Substock", subCount, COLORS.ORANGE, "Menor a 2 meses (Riesgo de desabastecimiento)"); legendY += 9;
      drawStatRowLeft(legendY, "Desabastecido", desabastecidoCount, COLORS.RED, "Stock agotado (0) con historial de consumo"); legendY += 9;
      drawStatRowLeft(legendY, "Sin Rotación", sinRotacionCount, COLORS.GRAY, "Sin rotación reciente (No suma a la disponibilidad)");

      // Footer Page 1
      const pageHeight = doc.internal.pageSize.height;
      doc.setFontSize(8);
      doc.setFont(activeFont, "bold");
      doc.setTextColor(150, 150, 150);
      doc.text(`RESPONSABLE: ${responsibleName.toUpperCase()}`, pageWidth - 15, pageHeight - 10, { align: "right" });

      // ==========================================
      // PAGE 2+: DATA MATRIX (DEDICATED START)
      // ==========================================
      // PAGE 2+: DETAILED TABLE
      // ==========================================
      doc.addPage();

      // Table Start Position
      const tableStartY = 35;

      const runAutoTable = (autoTable as any).default || (autoTable as any);
      const numMonths = result.medications.length > 0 && result.medications[0].originalHistory ? result.medications[0].originalHistory.length : 12;
      const monthHeaders = getMonthHeaders(result.referenceDate, numMonths);
      
      const columns = [
        { header: 'COD', dataKey: 'id' },
        { header: 'DESCRIPCIÓN', dataKey: 'name' },
        { header: 'F.F.', dataKey: 'ff' }, 
        { header: 'TIP', dataKey: 'type' },
        { header: 'PET', dataKey: 'pet' },
        { header: 'EST', dataKey: 'est' },
        ...monthHeaders.map((m, i) => ({ header: m, dataKey: `m${i}` })),
        { header: 'STOCK', dataKey: 'stock' }, 
        { header: 'CPA(S)', dataKey: 'rawCpm' },
        { header: 'CPA(A)', dataKey: 'cpm' },
        { header: 'M. ACT', dataKey: 'currentMonths' },
        { header: 'M. EST', dataKey: 'monthsProvision' }, 
        { header: 'ESTADO', dataKey: 'status' },
        { header: 'REQ', dataKey: 'req' },
      ];

      const rawItems = filteredTableItems || result.medications;
      // Garantizar orden alfabético estricto A-Z por DESCRIPCIÓN en todas las hojas del reporte PDF
      const itemsToRender = [...rawItems].sort((a, b) => {
        const comp = (a.name || '').trim().localeCompare((b.name || '').trim(), 'es', { sensitivity: 'base', numeric: true });
        if (comp !== 0) return comp;
        return (a.id || '').localeCompare(b.id || '');
      });

      const tableData = itemsToRender.map(item => {
        // --- KEY CHANGE: Use Dynamic Metrics + Projected Requisition for PDF Report ---
        const { activeCpm, activeMonths } = calculateDynamicMetricsPDF(item);
        
        const reqQty = item.quantityToOrder > 0 ? item.quantityToOrder : 0;
        const projectedStock = item.currentStock + reqQty;

        const projectedMonths = activeCpm > 0 
            ? projectedStock / activeCpm 
            : (projectedStock > 0 ? Infinity : 0);

        const roundedProjectedMonths = isFinite(projectedMonths) ? parseFloat(projectedMonths.toFixed(1)) : Infinity;

        let projectedStatus = StockStatus.NORMOSTOCK;
        if (projectedStock === 0) {
            projectedStatus = StockStatus.DESABASTECIDO;
        } else if (activeCpm === 0 && projectedStock > 0) {
            projectedStatus = StockStatus.SIN_ROTACION;
        } else if (roundedProjectedMonths > 6) {
            projectedStatus = StockStatus.SOBRESTOCK;
        } else if (roundedProjectedMonths >= 2 && roundedProjectedMonths <= 6) {
            projectedStatus = StockStatus.NORMOSTOCK;
        } else {
            projectedStatus = StockStatus.SUBSTOCK;
        }

        const row: any = {
            id: item.id,
            name: item.name,
            ff: item.ff || '-',
            type: item.medtip || 'MED',
            pet: item.medpet || '-',
            est: item.medest || '-',
            stock: item.currentStock.toLocaleString(),
            rawCpm: item.rawCpm.toFixed(1),
            cpm: item.cpm.toFixed(1),
            // Current actual months
            currentMonths: isFinite(activeMonths) ? activeMonths.toFixed(1) : '∞',
            // Use projected calculated values
            monthsProvision: isFinite(projectedMonths) ? projectedMonths.toFixed(1) : '∞',
            status: projectedStatus,
            req: item.quantityToOrder > 0 ? item.quantityToOrder : '-',
            _spikeThreshold: item.spikeThreshold,
            _lowThreshold: item.lowThreshold || 0,
            _excludedIndices: item.excludedIndices || [],
            _history: item.originalHistory,
            _statusEnum: projectedStatus, // Use projected status for coloring
            _selectedMode: item.selectedCpaMode || 'ADJUSTED' // Pass mode to parse cell
        };
        item.originalHistory.forEach((val, idx) => { row[`m${idx}`] = val; });
        return row;
      });

      runAutoTable(doc, {
        columns: columns,
        body: tableData,
        startY: tableStartY,
        theme: 'grid',
        margin: { top: 15, left: 4, right: 4 },
        styles: { 
            font: activeFont,
            fontSize: 6, 
            cellPadding: 1, 
            valign: 'middle', 
            halign: 'center', 
            textColor: [17, 24, 39], // Texto oscuro de alta nitidez para impresión
            lineColor: [75, 85, 99], // Líneas de cuadrícula gris oscuro nítidas (#4B5563)
            lineWidth: 0.22 // Grosor reforzado para que se imprima claramente
        },
        headStyles: { 
            fillColor: COLORS.BLACK, 
            textColor: 255, 
            fontSize: 6, 
            fontStyle: 'bold', 
            halign: 'center',
            lineColor: [255, 255, 255], // Líneas blancas divisorias entre columnas de cabecera
            lineWidth: 0.25
        },
        columnStyles: {
            id: { cellWidth: 9, fontStyle: 'bold', textColor: [17, 24, 39] },
            name: { cellWidth: 'auto', halign: 'left', textColor: [17, 24, 39] },
            ff: { cellWidth: 12, textColor: [31, 41, 55] },
            type: { cellWidth: 6, textColor: [31, 41, 55] },
            pet: { cellWidth: 6, textColor: [31, 41, 55] },
            est: { cellWidth: 6, textColor: [31, 41, 55] },
            stock: { cellWidth: 11, fontStyle: 'bold', textColor: [17, 24, 39] },
            rawCpm: { cellWidth: 9 },
            cpm: { cellWidth: 9 },
            currentMonths: { cellWidth: 9, fontStyle: 'bold', textColor: [31, 41, 55] },
            monthsProvision: { cellWidth: 9, fontStyle: 'bold', textColor: [17, 24, 39] },
            status: { cellWidth: 18, fontSize: 5.5, fontStyle: 'bold' },
            req: { cellWidth: 9, fontStyle: 'bold' }
        },
        didDrawPage: function(data: any) {
            // Header on every page of the table -> now only on first page of the table
            if (data.pageNumber === 1) {
                doc.setFillColor(COLORS.BLACK[0], COLORS.BLACK[1], COLORS.BLACK[2]);
                doc.rect(0, 0, pageWidth, 24, "F");

                doc.setTextColor(255, 255, 255);
                doc.setFontSize(14);
                doc.setFont(activeFont, "bold");
                doc.text("MATRIZ DE REQUERIMIENTO DETALLADA", 15, 12);
                
                // Subtitle
                const formattedDate = formatDateToMonthYear(result.referenceDate);
                doc.setFontSize(10);
                doc.setFont(activeFont, "normal");
                doc.setTextColor(240, 240, 240);
                doc.text(`CORTE: ${formattedDate}`, 15, 18);

                // Establishment Info
                const facilityName = result.establishmentName ? result.establishmentName.toUpperCase() : establishmentName.toUpperCase();
                const facilityText = result.codEess 
                  ? `${result.codEess.toUpperCase()} - ${facilityName}`
                  : facilityName;

                const hasMicrored = !!result.microred;
                doc.setFontSize(12);
                doc.setFont(activeFont, "bold");
                doc.setTextColor(COLORS.WHITE[0], COLORS.WHITE[1], COLORS.WHITE[2]);
                doc.text(facilityText, pageWidth - 15, hasMicrored ? 12 : 15, { align: "right" });

                // Microred Info
                if (hasMicrored) {
                  doc.setFontSize(10);
                  doc.setFont(activeFont, "bold");
                  doc.setTextColor(220, 245, 235); // Slight minty highlight
                  doc.text(`MICRORED: ${result.microred!.toUpperCase()}`, pageWidth - 15, 18, { align: "right" });
                }
            }

            // Footer Page 3+
            const pageHeight = doc.internal.pageSize.height;
            doc.setFontSize(8);
            doc.setFont(activeFont, "bold");
            doc.setTextColor(150, 150, 150);
            doc.text(`RESPONSABLE: ${responsibleName.toUpperCase()}`, pageWidth - 15, pageHeight - 10, { align: "right" });
        },
        didParseCell: function(data: any) {
            if (data.section !== 'body') return;
            const row = data.row.raw;

            // Meses infinitos (stock sin consumo): el «∞» no existe en la letra del PDF y salía
            // como `";`. Se deja la celda vacía y se dibuja el símbolo en `didDrawCell`.
            if (isInfinityCell(data)) data.cell.text = [''];
            
            // Highlight Months
            if (data.column.dataKey && String(data.column.dataKey).startsWith('m')) {
                const idx = parseInt(String(data.column.dataKey).substring(1));
                const val = row._history ? row._history[idx] : 0;
                const threshold = row._spikeThreshold;
                const lowThreshold = row._lowThreshold;
                const isExcluded = row._excludedIndices && row._excludedIndices.includes(idx);

                if (isExcluded) {
                    data.cell.styles.fillColor = [229, 231, 235]; // Gray-200
                    data.cell.styles.textColor = [75, 85, 99]; // Gray-600 legible
                } else if (val > threshold && val > 0) {
                    data.cell.styles.fillColor = [254, 240, 138]; // Yellow-200
                    data.cell.styles.textColor = [153, 27, 27]; // Red-800 oscuro nítido
                    data.cell.styles.fontStyle = 'bold';
                } else if (val < lowThreshold && val > 0) {
                    data.cell.styles.fillColor = [254, 215, 170]; // Orange-200
                    data.cell.styles.textColor = [154, 52, 18]; // Orange-800
                    data.cell.styles.fontStyle = 'bold';
                } else if (val > 0) {
                    data.cell.styles.fillColor = [220, 252, 231]; // Green-100
                    data.cell.styles.textColor = [20, 83, 45]; // Green-900 oscuro
                    data.cell.styles.fontStyle = 'bold';
                } else {
                    if (val === 0) {
                        data.cell.styles.textColor = [100, 116, 139]; // Slate-500 legible en impresión
                    }
                }
            }

            // Highlight Active CPA Column
            if (data.column.dataKey === 'rawCpm') { // CPA Simple
                if (row._selectedMode === 'SIMPLE') {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.textColor = [30, 58, 138]; // Blue-900 oscuro
                    data.cell.styles.fillColor = [219, 234, 254]; // Blue-100
                } else {
                    data.cell.styles.textColor = [75, 85, 99]; // Slate-600 nítido
                }
            }

            if (data.column.dataKey === 'cpm') { // CPA Adjusted
                if (row._selectedMode === 'ADJUSTED') {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.textColor = [30, 58, 138]; // Blue-900 oscuro
                    data.cell.styles.fillColor = [219, 234, 254]; // Blue-100
                } else {
                    data.cell.styles.textColor = [75, 85, 99]; // Slate-600 nítido
                }
            }

            // Style Stock Column
            if (data.column.dataKey === 'stock') {
                data.cell.styles.fillColor = [220, 252, 231]; // light green
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.textColor = [17, 24, 39];
            }

            // Style Req Column
            if (data.column.dataKey === 'req') {
                if (row.req !== '-') {
                    data.cell.styles.fillColor = [219, 234, 254]; // blue-100 highlight
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.textColor = [29, 78, 216]; // Blue-700 nítido
                } else {
                    data.cell.styles.textColor = [100, 116, 139];
                }
            }

            // Color Status
            if (data.column.dataKey === 'status') {
                 data.cell.styles.fontStyle = 'bold';
                 if (row._statusEnum === StockStatus.DESABASTECIDO) {
                     data.cell.styles.fillColor = [254, 226, 226]; 
                     data.cell.styles.textColor = [185, 28, 28]; // Red-700
                 } else if (row._statusEnum === StockStatus.SOBRESTOCK) {
                     data.cell.styles.fillColor = [224, 231, 255]; 
                     data.cell.styles.textColor = [29, 78, 216]; // Blue-700
                 } else if (row._statusEnum === StockStatus.NORMOSTOCK) {
                     data.cell.styles.fillColor = [209, 250, 229]; 
                     data.cell.styles.textColor = [6, 95, 70]; // Emerald-800
                 } else if (row._statusEnum === StockStatus.SUBSTOCK) {
                     data.cell.styles.fillColor = [255, 237, 213]; 
                     data.cell.styles.textColor = [194, 65, 12]; // Orange-700
                 } else if (row._statusEnum === StockStatus.SIN_ROTACION) {
                     data.cell.styles.fillColor = [243, 244, 246]; 
                     data.cell.styles.textColor = [55, 65, 81]; // Gray-700
                 }
            }
        },
        didDrawCell: function(data: any) {
            if (data.section !== 'body') return;
            const row = data.row.raw;
            if (isInfinityCell(data)) drawInfinity(data);
            // Draw Strikethrough for Excluded Months OR Yellow Spikes (in Adjusted Mode)
            if (data.column.dataKey && String(data.column.dataKey).startsWith('m')) {
                 const idx = parseInt(String(data.column.dataKey).substring(1));
                 const val = row._history ? row._history[idx] : 0;
                 const threshold = row._spikeThreshold;
                 const isExcluded = row._excludedIndices && row._excludedIndices.includes(idx);
                 const isSpike = val > threshold && val > 0;
                 const isAdjustedMode = row._selectedMode === 'ADJUSTED';

                 // Condition: User Excluded OR (Is Spike AND Adjusted Mode)
                 if (isExcluded || (isSpike && isAdjustedMode)) {
                     const doc = data.doc;
                     const { x, y, width, height } = data.cell;
                     
                     // Use a softer tone for strikethrough so digits remain clearly readable
                     if (isExcluded) {
                        doc.setDrawColor(156, 163, 175); // Gray-400 suave
                     } else {
                        doc.setDrawColor(220, 80, 80); // Rojo suave para no tapar los dígitos
                     }
                     
                     doc.setLineWidth(0.18); // Trazo más fino para que se lea el número perfectamente
                     // Horizontal line in the middle
                     doc.line(x + 1.5, y + height / 2, x + width - 1.5, y + height / 2);
                 }
            }
        }
      });

      // ==========================================
      // PAGE FINAL: ADDITIONAL ITEMS (IF ANY)
      // ==========================================
      if (additionalItems && additionalItems.length > 0) {
          doc.addPage();
          
          // Header Page Final - PURPLE
          doc.setFillColor(COLORS.PURPLE[0], COLORS.PURPLE[1], COLORS.PURPLE[2]);
          doc.rect(0, 0, pageWidth, 24, "F");

          doc.setTextColor(255, 255, 255);
          doc.setFontSize(16);
          doc.setFont(activeFont, "bold");
          doc.text("REQUERIMIENTOS ADICIONALES", 15, 16);
          
          doc.setFontSize(10);
          doc.setFont(activeFont, "normal");
          // FIX: Align Right to prevent overlap
          doc.text("ÍTEMS AGREGADOS MANUALMENTE", pageWidth - 15, 16, { align: "right" });

          // Ordenar ítems adicionales alfabéticamente por descripción
          const sortedAdditionalItems = [...additionalItems].sort((a, b) => {
              const comp = (a.name || '').trim().localeCompare((b.name || '').trim(), 'es', { sensitivity: 'base', numeric: true });
              if (comp !== 0) return comp;
              return (a.sismedCode || '').localeCompare(b.sismedCode || '');
          });

          const addTableData = sortedAdditionalItems.map((item, index) => ({
              idx: index + 1,
              code: item.sismedCode || '-',
              name: item.name,
              ff: item.ff || '-',
              qty: item.quantity,
              obs: item.observation || '-'
          }));

          runAutoTable(doc, {
              startY: 35,
              theme: 'grid',
              columns: [
                  { header: '#', dataKey: 'idx' },
                  { header: 'CÓDIGO', dataKey: 'code' },
                  { header: 'DESCRIPCIÓN DEL PRODUCTO', dataKey: 'name' },
                  { header: 'F.F.', dataKey: 'ff' },
                  { header: 'CANTIDAD', dataKey: 'qty' },
                  { header: 'OBSERVACIÓN', dataKey: 'obs' },
              ],
              body: addTableData,
              headStyles: { 
                  fillColor: COLORS.PURPLE, 
                  textColor: 255, 
                  fontSize: 9, 
                  fontStyle: 'bold', 
                  halign: 'center',
                  lineColor: [255, 255, 255],
                  lineWidth: 0.25
              },
              styles: { 
                  font: activeFont, 
                  fontSize: 9, 
                  cellPadding: 2.5, 
                  valign: 'middle',
                  textColor: [17, 24, 39],
                  lineColor: [75, 85, 99],
                  lineWidth: 0.22
              },
              columnStyles: {
                  idx: { cellWidth: 15, halign: 'center', fontStyle: 'bold', textColor: [17, 24, 39] },
                  code: { cellWidth: 25, halign: 'center', fontStyle: 'bold', textColor: [17, 24, 39] },
                  name: { halign: 'left', textColor: [17, 24, 39] },
                  ff: { cellWidth: 25, halign: 'left', textColor: [31, 41, 55] },
                  qty: { cellWidth: 25, halign: 'center', fontStyle: 'bold', textColor: [126, 34, 206] },
                  obs: { cellWidth: 60, halign: 'left', textColor: [31, 41, 55] }
              }
          });
      }

      doc.save(`Reporte_Toolkit_SISMED_${new Date().toISOString().split('T')[0]}.pdf`);

  } catch (error: any) {
      console.error(error);
      alert("Error generando el PDF: " + (error.message || "Error desconocido"));
  }
};
