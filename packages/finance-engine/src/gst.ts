import {
  ComplianceFlag,
  FreightGstMode,
  GstRegime,
  Paise,
  SupplierTaxProfile,
  TaxSplitType,
  WorkspaceTaxProfile,
  formatINR,
} from './types.js';
import { getStateName, validateGstin } from './gstin.js';
import { lookupHsn } from './hsn-catalog.js';

/** GST 2.0 rate rationalization effective date (late September 2025) */
export const GST_2_EFFECTIVE_DATE = '2025-09-22';

export const GST_2_PRIMARY_SLABS = [0, 5, 18, 40] as const;
export const GST_LEGACY_SLABS = [0, 5, 12, 18, 28] as const;

export interface GstSplitComputation {
  taxSplitType: TaxSplitType;
  taxablePaise: Paise;
  gstRatePct: number;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  totalGstPaise: Paise;
  grandTotalPaise: Paise;
  itcRecoverablePaise: Paise;
  nonRecoverableGstPaise: Paise;
  rcmPayablePaise: Paise;
  flags: ComplianceFlag[];
}

export function determineTaxSplit(
  supplierStateCode: string | null | undefined,
  placeOfSupplyStateCode: string | null | undefined,
  gstRatePct: number
): TaxSplitType {
  if (gstRatePct <= 0) return 'exempt_or_nil';
  if (!supplierStateCode || !placeOfSupplyStateCode) return 'intra_cgst_sgst';
  return supplierStateCode === placeOfSupplyStateCode ? 'intra_cgst_sgst' : 'inter_igst';
}

export function isPostGst2Date(isoDate?: string | null): boolean {
  if (!isoDate) return true; // Default to current GST 2.0 regime
  return isoDate.slice(0, 10) >= GST_2_EFFECTIVE_DATE;
}

/**
 * Checks whether GST is recoverable as Input Tax Credit (ITC) for the buyer.
 */
export function evaluateItcEligibility(params: {
  buyerRegime: GstRegime;
  supplierRegime: GstRegime;
  hsnOrItemText?: string | null;
  explicitBlockedCredit?: boolean;
}): { recoverable: boolean; reason: string; blocked17_5: boolean } {
  if (params.buyerRegime !== 'regular') {
    return {
      recoverable: false,
      reason: `Buyer is under '${params.buyerRegime}' GST status — Input Tax Credit is not claimable.`,
      blocked17_5: false,
    };
  }
  if (params.supplierRegime !== 'regular') {
    return {
      recoverable: false,
      reason: `Supplier is '${params.supplierRegime}' — buyer cannot claim ITC (Section 10/16 CGST Act).`,
      blocked17_5: false,
    };
  }
  if (params.explicitBlockedCredit) {
    return {
      recoverable: false,
      reason: 'Item marked as Section 17(5) Blocked Credit — GST adds to real cost.',
      blocked17_5: true,
    };
  }
  const hsnMatch = lookupHsn(params.hsnOrItemText);
  if (hsnMatch?.blockedCredit17_5) {
    return {
      recoverable: false,
      reason: hsnMatch.blockedCreditReason ?? 'Blocked Credit under Section 17(5) CGST Act.',
      blocked17_5: true,
    };
  }
  return {
    recoverable: true,
    reason: 'Eligible for 100% Input Tax Credit (subject to supplier GSTR-1 & buyer IMS/GSTR-2B acceptance).',
    blocked17_5: false,
  };
}

/**
 * Deterministic GST & ITC calculator for quotes, POs, and invoices.
 * Uses integer paise arithmetic with half-up rounding.
 */
export function computeGstLine(params: {
  taxablePaise: Paise;
  gstRatePct: number;
  buyer: WorkspaceTaxProfile;
  supplier: SupplierTaxProfile;
  placeOfSupplyStateCode?: string | null;
  hsnOrItemText?: string | null;
  invoiceDate?: string | null;
  explicitBlockedCredit?: boolean;
  itcRecoveryPct?: number; // 0..100 for Rule 42/43 partial ITC (default 100 when eligible)
  isFreightLine?: boolean;
  freightGstMode?: FreightGstMode;
  principalGoodsGstPct?: number;
}): GstSplitComputation {
  const flags: ComplianceFlag[] = [];
  const { taxablePaise, buyer, supplier } = params;
  const gstRatePct = Math.max(0, params.gstRatePct);

  // 1. Composition dealer / unregistered supplier tax fraud check
  if (supplier.gstRegime === 'composition' && gstRatePct > 0) {
    const illegalTaxPaise = Math.round((taxablePaise * gstRatePct) / 100);
    flags.push({
      code: 'composition_tax_fraud',
      severity: 'critical',
      title: 'Composition Vendor Charging GST Illegally',
      detail: `${supplier.name} is registered under GST Composition Scheme and cannot legally collect ${gstRatePct}% GST (${formatINR(illegalTaxPaise)}). You also receive ₹0 ITC.`,
      impactPaise: illegalTaxPaise,
      statutoryRef: 'Section 10(4) CGST Act',
      recommendedAction: 'Demand a revised Bill of Supply with 0% tax before payment.',
    });
  }

  // 2. GST 2.0 slab validation (official statutory slabs + HSN rate cross-check)
  const postGst2 = isPostGst2Date(params.invoiceDate);
  const validSlabs: readonly number[] = postGst2
    ? [0, 0.25, 3, 5, 18, 40] // Includes 0.25% rough diamonds & 3% gold/bullion statutory rates + GST 2.0 slabs
    : [0, 0.25, 3, 5, 12, 18, 28];

  if (!params.isFreightLine) {
    if (params.gstRatePct < 0 || !validSlabs.includes(gstRatePct)) {
      const isLegacyReformSlab = postGst2 && (gstRatePct === 12 || gstRatePct === 28);
      const hsn = lookupHsn(params.hsnOrItemText);
      const expectedSlab = hsn ? hsn.gst2RatePct : gstRatePct === 12 ? 5 : 18;
      const deltaPct = Math.max(0, gstRatePct - expectedSlab);
      const overchargePaise = Math.round((taxablePaise * deltaPct) / 100);

      flags.push({
        code: 'stale_gst_slab',
        severity: isLegacyReformSlab ? 'warning' : 'critical',
        title: isLegacyReformSlab
          ? `Legacy ${gstRatePct}% GST Slab Detected (Post GST 2.0 Reform)`
          : `Invalid / Non-Statutory GST Rate (${params.gstRatePct}%)`,
        detail: isLegacyReformSlab
          ? `India GST 2.0 (effective Sept 2025) streamlined primary slabs to 5% and 18%. Verify if ${gstRatePct}% is an outdated ERP rate${hsn ? ` (HSN ${hsn.code} expects ${hsn.gst2RatePct}%)` : ''}.`
          : `${params.gstRatePct}% is not a valid Indian GST slab under ${postGst2 ? 'GST 2.0 (0/5/18/40%)' : 'legacy GST (0/5/12/18/28%)'}. Verify tax calculation immediately.`,
        impactPaise: overchargePaise,
        statutoryRef: 'CGST Rate Notifications & GST 2.0 Rationalization',
        recommendedAction: `Verify HSN slab with vendor before IMS acceptance; request corrected invoice if overcharged.`,
      });
    } else if (postGst2) {
      // Even if slab is valid (e.g., 18%), check if it exceeds the known HSN catalog rate (e.g., HSN 4819 = 5%)
      const hsn = lookupHsn(params.hsnOrItemText);
      if (hsn && gstRatePct !== hsn.gst2RatePct && gstRatePct > 0) {
        const deltaPct = Math.max(0, gstRatePct - hsn.gst2RatePct);
        const overchargePaise = Math.round((taxablePaise * deltaPct) / 100);
        flags.push({
          code: 'stale_gst_slab',
          severity: deltaPct > 0 ? 'critical' : 'warning',
          title: `HSN ${hsn.code} Slab Mismatch: Billed ${gstRatePct}% vs. Expected ${hsn.gst2RatePct}%`,
          detail: `${hsn.description} (HSN ${hsn.code}) maps to ${hsn.gst2RatePct}% under GST 2.0, but bill/quote applies ${gstRatePct}%.`,
          impactPaise: overchargePaise,
          statutoryRef: `GST 2.0 Rate Schedule — HSN ${hsn.code}`,
          recommendedAction: `Confirm exact 6/8-digit HSN classification with vendor/CA before payment.`,
        });
      }
    }
  }

  // 3. Freight & GTA rules (Composite Supply vs GTA RCM 5% vs GTA FCM 18% vs Non-GTA Exempt)
  let rcmPayablePaise = 0;
  if (params.isFreightLine && params.freightGstMode) {
    if (
      params.freightGstMode === 'composite_supply' &&
      params.principalGoodsGstPct !== undefined &&
      gstRatePct !== params.principalGoodsGstPct
    ) {
      const diffPaise = Math.round(
        (taxablePaise * Math.abs(gstRatePct - params.principalGoodsGstPct)) / 100
      );
      flags.push({
        code: 'wrong_freight_gst_rate',
        severity: gstRatePct > params.principalGoodsGstPct ? 'critical' : 'warning',
        title: `Composite Supply Freight Taxed at ${gstRatePct}% Instead of ${params.principalGoodsGstPct}%`,
        detail: `When a supplier bills freight on the same goods invoice, Section 8 Composite Supply mandates freight takes the principal goods GST rate (${params.principalGoodsGstPct}%).`,
        impactPaise: gstRatePct > params.principalGoodsGstPct ? diffPaise : 0,
        statutoryRef: 'Section 8(a) CGST Act (Composite Supply)',
        recommendedAction: `Ask vendor to correct freight GST from ${gstRatePct}% to ${params.principalGoodsGstPct}%.`,
      });
    } else if (params.freightGstMode === 'gta_rcm_5') {
      rcmPayablePaise = Math.round((taxablePaise * 5) / 100);
      if (gstRatePct > 0) {
        const illegalForwardPaise = Math.round((taxablePaise * gstRatePct) / 100);
        flags.push({
          code: 'double_gst_freight',
          severity: 'critical',
          title: 'GTA Billed Forward GST on a 5% RCM Consignment',
          detail: `GTA operating under default 5% RCM must not charge ${gstRatePct}% tax (${formatINR(illegalForwardPaise)}) on the invoice. Buyer pays 5% RCM directly via GSTR-3B.`,
          impactPaise: illegalForwardPaise,
          statutoryRef: 'Notification 13/2017-CT(R) & GTA Rules',
          recommendedAction: 'Confirm whether GTA filed Annexure V for Forward Charge; otherwise remove GST from vendor bill.',
        });
      } else {
        flags.push({
          code: 'rcm_unaccounted',
          severity: 'info',
          title: `5% RCM Liability on GTA Freight (${formatINR(rcmPayablePaise)})`,
          detail: `Pay ${formatINR(rcmPayablePaise)} in cash under Reverse Charge in GSTR-3B${buyer.gstRegime === 'regular' ? ' and claim full ITC in the same return' : ''}.`,
          impactPaise: buyer.gstRegime === 'regular' ? 0 : rcmPayablePaise,
          statutoryRef: 'Section 9(3) CGST Act — GTA RCM',
          recommendedAction: 'Include in monthly RCM ledger for your CA.',
        });
      }
    } else if (params.freightGstMode === 'gta_fcm_18' && gstRatePct === 12) {
      flags.push({
        code: 'stale_gst_slab',
        severity: 'warning',
        title: 'Outdated 12% GTA Forward Charge Rate',
        detail: 'Under GST 2.0 rate rationalization, the 12% GTA forward charge rate was rationalized to 18% (with full ITC to GTA). Confirm GTA Annexure V declaration.',
        impactPaise: 0,
        statutoryRef: 'GST 2.0 GTA Rate Rationalization',
        recommendedAction: 'Verify GTA tax invoice compliance before claiming ITC.',
      });
    } else if (params.freightGstMode === 'non_gta_exempt' && gstRatePct > 0) {
      const illegalPaise = Math.round((taxablePaise * gstRatePct) / 100);
      flags.push({
        code: 'non_gta_illegal_tax',
        severity: 'critical',
        title: 'GST Charged by Non-GTA Individual Truck/Tempo Operator',
        detail: `Road transport without a Consignment Note (Bilty/LR) is 100% exempt from GST. ${formatINR(illegalPaise)} tax charged is invalid.`,
        impactPaise: illegalPaise,
        statutoryRef: 'Entry 18, Notification 12/2017-CT(R)',
        recommendedAction: 'Reject GST line item unless a valid GSTIN + Consignment Note is provided.',
      });
    }
  }

  // 4. Tax split computation (Intra vs Inter state)
  const supplierState =
    supplier.stateCode ??
    (supplier.gstin ? validateGstin(supplier.gstin).stateCode : null) ??
    buyer.stateCode;
  const posState = params.placeOfSupplyStateCode ?? buyer.stateCode;
  const taxSplitType = determineTaxSplit(supplierState, posState, gstRatePct);

  const totalGstPaise = Math.round((taxablePaise * gstRatePct) / 100);
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (taxSplitType === 'intra_cgst_sgst') {
    cgstPaise = Math.round(totalGstPaise / 2);
    sgstPaise = totalGstPaise - cgstPaise; // Ensures cgst + sgst === totalGstPaise to exact paisa
  } else if (taxSplitType === 'inter_igst') {
    igstPaise = totalGstPaise;
  }

  // 5. ITC eligibility
  const itc = evaluateItcEligibility({
    buyerRegime: buyer.gstRegime,
    supplierRegime: supplier.gstRegime,
    hsnOrItemText: params.hsnOrItemText,
    explicitBlockedCredit: params.explicitBlockedCredit,
  });

  if (itc.blocked17_5 && totalGstPaise > 0) {
    flags.push({
      code: 'blocked_credit_17_5',
      severity: 'warning',
      title: `Section 17(5) Blocked Credit — GST Added to Net Cost (${formatINR(totalGstPaise)})`,
      detail: itc.reason,
      impactPaise: totalGstPaise,
      statutoryRef: 'Section 17(5) CGST Act',
      recommendedAction: 'Expense GST into P&L / Landed Cost; do NOT claim in GSTR-3B.',
    });
  }

  const recoveryRatio =
    params.itcRecoveryPct !== undefined
      ? Math.min(100, Math.max(0, params.itcRecoveryPct)) / 100
      : 1;
  const itcRecoverablePaise = itc.recoverable ? Math.round(totalGstPaise * recoveryRatio) : 0;
  const nonRecoverableGstPaise = totalGstPaise - itcRecoverablePaise;

  if (
    params.itcRecoveryPct !== undefined &&
    params.itcRecoveryPct < 100 &&
    itc.recoverable &&
    nonRecoverableGstPaise > 0
  ) {
    flags.push({
      code: 'rule42_43_partial_itc',
      severity: 'info',
      title: `Rule 42/43 Partial ITC (${params.itcRecoveryPct}%) — ${formatINR(nonRecoverableGstPaise)} Added to Cost`,
      detail: `Under Rule 42 & 43 of CGST Rules, business/exempt turnover apportionment restricts ITC to ${params.itcRecoveryPct}%. Non-creditable tax of ${formatINR(nonRecoverableGstPaise)} is added to landed cost.`,
      impactPaise: nonRecoverableGstPaise,
      statutoryRef: 'Rule 42 & 43 CGST Rules',
      recommendedAction: 'Ensure monthly Rule 42/43 reversal ratio is reconciled with annual return (GSTR-9).',
    });
  }

  return {
    taxSplitType,
    taxablePaise,
    gstRatePct,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalGstPaise,
    grandTotalPaise: taxablePaise + totalGstPaise,
    itcRecoverablePaise,
    nonRecoverableGstPaise,
    rcmPayablePaise,
    flags,
  };
}

/**
 * Checks whether an invoice's billed CGST/SGST vs IGST matches Supplier State vs Buyer Place of Supply.
 */
export function validateInvoiceTaxSplit(params: {
  supplierGstin?: string | null;
  supplierStateCode?: string | null;
  buyerStateCode: string;
  billedCgstPaise: Paise;
  billedSgstPaise: Paise;
  billedIgstPaise: Paise;
}): ComplianceFlag | null {
  const supplierState =
    params.supplierStateCode ??
    (params.supplierGstin ? validateGstin(params.supplierGstin).stateCode : null);

  if (!supplierState || !params.buyerStateCode) return null;

  const isInterState = supplierState !== params.buyerStateCode;
  const billedIntra = params.billedCgstPaise + params.billedSgstPaise;
  const billedInter = params.billedIgstPaise;

  if (isInterState && billedIntra > 0 && billedInter === 0) {
    return {
      code: 'wrong_tax_split_state',
      severity: 'critical',
      title: 'Wrong Tax Type: CGST+SGST Billed on Inter-State Supply',
      detail: `Supplier is in ${getStateName(supplierState)} (${supplierState}) and Place of Supply is ${getStateName(params.buyerStateCode)} (${params.buyerStateCode}). Invoice MUST charge IGST, not CGST+SGST (${formatINR(billedIntra)} ITC at risk!).`,
      impactPaise: billedIntra,
      statutoryRef: 'Section 7 IGST Act & Section 16 CGST Act',
      recommendedAction: 'HOLD payment & mark REJECT in GST IMS portal until vendor issues corrected IGST invoice.',
    };
  }

  if (!isInterState && billedInter > 0 && billedIntra === 0) {
    return {
      code: 'wrong_tax_split_state',
      severity: 'critical',
      title: 'Wrong Tax Type: IGST Billed on Intra-State Supply',
      detail: `Both Supplier and Buyer are in ${getStateName(params.buyerStateCode)} (${params.buyerStateCode}). Invoice MUST split 50/50 into CGST+SGST, not IGST (${formatINR(billedInter)} ITC at risk!).`,
      impactPaise: billedInter,
      statutoryRef: 'Section 8 IGST Act & Section 16 CGST Act',
      recommendedAction: 'HOLD payment & request revised intra-state CGST+SGST invoice.',
    };
  }

  return null;
}

/**
 * Checks E-Invoicing (IRN + Signed QR) mandatory compliance for suppliers with AATO > ₹5 Cr.
 */
export function validateEInvoiceIrn(params: {
  supplier: SupplierTaxProfile;
  irn?: string | null;
  hasQr?: boolean;
  totalGstPaise: Paise;
}): ComplianceFlag | null {
  if (!params.supplier.eInvoiceRequired) return null;
  const validIrn = Boolean(params.irn && /^[a-fA-F0-9]{64}$/.test(params.irn.trim()));
  const qrMissing = params.hasQr === false;

  if (validIrn && !qrMissing) return null;

  return {
    code: 'missing_irn_itc_risk',
    severity: 'critical',
    title: !validIrn
      ? 'Missing / Invalid E-Invoice IRN — Entire GST ITC at Risk!'
      : 'Missing Signed E-Invoice QR Code (Rule 48(4) Defect)',
    detail: !validIrn
      ? `${params.supplier.name} is flagged as e-Invoice applicable (AATO > ₹5 Cr; verify no sector exemption such as GTA/banking/SEZ). An invoice without a valid 64-character IRP IRN & signed QR code is invalid under Rule 48(4), risking ${formatINR(params.totalGstPaise)} ITC disallowance.`
      : `${params.supplier.name} printed an IRN string, but the mandatory IRP-signed QR code is missing. Verify IRN authenticity on einvoice1.gst.gov.in before releasing payment.`,
    impactPaise: params.totalGstPaise,
    statutoryRef: 'Rule 48(4) & 48(5) CGST Rules (₹5 Cr PAN Threshold)',
    recommendedAction: 'DO NOT release payment; ask vendor for genuine IRP-registered e-Invoice PDF with both IRN & signed QR.',
  };
}

/**
 * Computes TDS advisories under Section 194C (AMC/Maintenance/GTA) and 194Q (Goods > ₹50L for >₹10Cr buyers).
 */
export function evaluateTdsAdvisory(params: {
  buyer: WorkspaceTaxProfile;
  supplier: SupplierTaxProfile;
  taxablePaise: Paise;
  isServiceOrAmcOrGta: boolean;
  fyCumulativeSpendPaise?: Paise;
}): ComplianceFlag | null {
  const gstinMeta = params.supplier.gstin ? validateGstin(params.supplier.gstin) : null;
  const fyTotal = (params.fyCumulativeSpendPaise ?? 0) + params.taxablePaise;

  if (params.isServiceOrAmcOrGta) {
    // 194C threshold: ₹30,000 single payment or ₹1,00,000 annual aggregate
    if (params.taxablePaise > 30_000_00 || fyTotal > 100_000_00) {
      const ratePct = gstinMeta?.tds194cRatePct ?? 2;
      const tdsPaise = Math.round((params.taxablePaise * ratePct) / 100);
      return {
        code: 'tds_194c',
        severity: 'info',
        title: `TDS Section 194C Applicable (${ratePct}% = ${formatINR(tdsPaise)})`,
        detail: `Service/AMC/Contract bill exceeds Section 194C threshold (₹30k single / ₹1L FY). Deduct ${ratePct}% (${gstinMeta?.panEntityLabel ?? 'default company/firm rate'}) on taxable value before remitting net payment.`,
        impactPaise: tdsPaise,
        statutoryRef: 'Section 194C Income Tax Act',
        recommendedAction: `Deduct ${formatINR(tdsPaise)} TDS and remit net payable.`,
      };
    }
  } else if (params.buyer.turnoverBand === 'above_10cr' && fyTotal > 5_000_000_00) {
    // Section 194Q: 0.1% on purchases exceeding ₹50 Lakh per supplier per FY
    const excessPaise = Math.min(params.taxablePaise, fyTotal - 5_000_000_00);
    const tdsPaise = Math.round(excessPaise * 0.001);
    return {
      code: 'tds_194q',
      severity: 'info',
      title: `TDS Section 194Q Applicable (0.1% = ${formatINR(tdsPaise)})`,
      detail: `Buyer turnover >₹10 Cr and FY purchases from ${params.supplier.name} exceed ₹50 Lakh. Deduct 0.1% TDS on taxable value above ₹50L.`,
      impactPaise: tdsPaise,
      statutoryRef: 'Section 194Q Income Tax Act',
      recommendedAction: `Deduct ${formatINR(tdsPaise)} under 194Q before payment.`,
    };
  }

  return null;
}

/**
 * Adds N calendar days to an ISO date string (YYYY-MM-DD) safely in UTC.
 * Throws explicit error on malformed or out-of-range dates instead of silent NaN/RangeError.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = (isoDate || '').trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO date '${isoDate}'. Expected YYYY-MM-DD.`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`Invalid calendar date '${isoDate}'.`);
  }
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
