import {
  ComplianceFlag,
  FreightGstMode,
  Paise,
  SupplierTaxProfile,
  WorkspaceTaxProfile,
  formatINR,
  toPaise,
} from './types.js';
import { computeGstLine } from './gst.js';
import { normalizeUnitRate } from './units.js';

export interface QuoteCostInput {
  quoteId: string;
  supplier: SupplierTaxProfile;
  quantity: number;
  rawRateRupees: number;
  rawUnit: string;
  explicitPackSize?: number | null;
  gstPct: number;
  isGstInclusive?: boolean;
  freightTotalRupees?: number;
  freightGstMode?: FreightGstMode;
  packingHandlingTotalRupees?: number;
  cashDiscountPct?: number;
  creditDays: number; // Positive = credit days after delivery; Negative = advance payment days before delivery (financing COST!)
  hasWrittenAgreement?: boolean; // Formal PO = true (45-day 43B(h) cap); Verbal = false (15-day cap)
  leadTimeDays?: number | null;
  moq?: number | null;
  hsnOrItemText?: string | null;
  explicitBlockedCredit?: boolean;
  itcRecoveryPct?: number; // 0..100 for Rule 42/43 partial ITC
  historicalBenchmarkLandedPaise?: Paise | null;
}

export interface LandedCostBreakdown {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  quantity: number;
  canonicalUnit: string;
  normalizationNote: string;

  // Per-unit components (all in integer paise)
  baseUnitPaise: Paise;
  discountUnitPaise: Paise;
  freightUnitPaise: Paise;
  packingUnitPaise: Paise;
  taxableUnitPaise: Paise;
  gstUnitPaise: Paise;
  itcRecoverableUnitPaise: Paise;
  nonRecoverableGstUnitPaise: Paise;
  invoiceOutflowUnitPaise: Paise; // Actual cash paid to vendor per unit (incl. GST)

  // True Economic Cost
  netLandedUnitPaise: Paise; // Net of recoverable ITC, before credit-days financing benefit
  effectiveCreditDaysUsed: number;
  waccPctUsed: number;
  creditBenefitUnitPaise: Paise;
  creditAdjustedRealUnitPaise: Paise; // The CFO ranking metric!

  // Order totals
  totalInvoicePayablePaise: Paise;
  totalNetLandedPaise: Paise;
  totalCreditAdjustedPaise: Paise;

  // Price creep & compliance
  priceDeltaPct: number | null; // Positive = rate hike vs historical
  isPriceCreepAlert: boolean;
  leadTimeDays: number | null;
  moq: number | null;
  ineligibleReason: string | null;
  reliabilityScore: number | null;
  flags: ComplianceFlag[];
}

export function evaluateMsme43bh(params: {
  supplier: SupplierTaxProfile;
  quotedCreditDays: number;
  hasWrittenAgreement: boolean;
  orderTaxableTotalPaise: Paise;
}): { effectiveCreditDays: number; legalCapDays: number | null; flag: ComplianceFlag | null } {
  // Office Memorandum No. 5/2(2)/2021: Wholesale and Retail Traders registered on Udyam
  // are explicitly excluded from the delayed payment provisions of Chapter V of the MSMED Act.
  const isTrader =
    Boolean(params.supplier.isTrader) ||
    params.supplier.udyamTier === 'trader' ||
    Boolean(params.supplier.category && /trader|retail|wholesale/i.test(params.supplier.category));

  const isCoveredMsme =
    !isTrader && (params.supplier.udyamTier === 'micro' || params.supplier.udyamTier === 'small');

  // Preserve negative creditDays (advance payments lock up working capital and incur financing COST!)
  if (!isCoveredMsme) {
    return {
      effectiveCreditDays: params.quotedCreditDays,
      legalCapDays: null,
      flag: null,
    };
  }

  const legalCapDays = params.hasWrittenAgreement ? 45 : 15;
  if (params.quotedCreditDays <= legalCapDays) {
    return {
      effectiveCreditDays: params.quotedCreditDays,
      legalCapDays,
      flag: null,
    };
  }

  // Approximate income tax disallowance risk (~25.17% domestic company / ~30% firm)
  const estimatedTaxShockPaise = Math.round(params.orderTaxableTotalPaise * 0.25);

  return {
    effectiveCreditDays: legalCapDays,
    legalCapDays,
    flag: {
      code: 'msme_43bh_tax_risk',
      severity: 'critical',
      title: `Section 43B(h) MSME Cap: ${params.quotedCreditDays}d Credit Illegal (Capped at ${legalCapDays}d)`,
      detail: `${params.supplier.name} is a Udyam-registered ${params.supplier.udyamTier.toUpperCase()} enterprise. Law overrides ${params.quotedCreditDays}-day terms to max ${legalCapDays} days${params.hasWrittenAgreement ? ' (written PO)' : ' (no written agreement)'}. Missing deadline across March 31 disallows the entire expense + triggers non-deductible 3× RBI compound interest.`,
      impactPaise: estimatedTaxShockPaise,
      statutoryRef: 'Section 43B(h) Income Tax Act & Section 15/16 MSMED Act',
      recommendedAction: `Cap credit benefit at ${legalCapDays} days in comparison, issue written PO with Net ${legalCapDays} Days, and clear before due date.`,
    },
  };
}

/**
 * Deterministic CFO-grade Indian Landed Cost & Credit-Adjusted Real Cost Calculator.
 */
export function computeLandedCost(
  input: QuoteCostInput,
  buyer: WorkspaceTaxProfile
): LandedCostBreakdown {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error(`Invalid quote quantity: ${input.quantity}. Quantity must be > 0.`);
  }
  if (!Number.isFinite(input.rawRateRupees) || input.rawRateRupees < 0) {
    throw new Error(`Invalid quote unit rate: ${input.rawRateRupees}. Rate must be >= 0.`);
  }
  if (input.cashDiscountPct !== undefined && input.cashDiscountPct !== null) {
    if (
      typeof input.cashDiscountPct !== 'number' ||
      !Number.isFinite(input.cashDiscountPct) ||
      input.cashDiscountPct < 0 ||
      input.cashDiscountPct > 100
    ) {
      throw new Error(
        `Invalid cash discount percentage: ${input.cashDiscountPct}. Must be a finite number between 0 and 100.`
      );
    }
  }
  const qty = input.quantity;
  const flags: ComplianceFlag[] = [];

  // 1. Unit normalization (lossless)
  const norm = normalizeUnitRate({
    rawRateRupees: input.rawRateRupees,
    rawUnit: input.rawUnit,
    explicitPackSize: input.explicitPackSize,
  });

  // 2. Back out GST if quoted as "GST inclusive / flat net"
  let baseUnitPaise = norm.normalizedUnitRatePaise;
  if (input.isGstInclusive && input.gstPct > 0) {
    baseUnitPaise = Math.round((norm.normalizedUnitRatePaise * 100) / (100 + input.gstPct));
  }

  // 3. Cash / trade discount
  const discountUnitPaise =
    input.cashDiscountPct && input.cashDiscountPct > 0
      ? Math.round((baseUnitPaise * input.cashDiscountPct) / 100)
      : 0;

  const netBaseUnitPaise = Math.max(0, baseUnitPaise - discountUnitPaise);

  // 4. Freight & Packing allocated per unit (NEVER round per-unit packing before multiplying back by qty!)
  const freightTotalPaise = toPaise(input.freightTotalRupees ?? 0);
  const packingTotalPaise = toPaise(input.packingHandlingTotalRupees ?? 0);
  const freightUnitPaise = Math.round(freightTotalPaise / qty);
  const packingUnitPaise = Math.round(packingTotalPaise / qty);

  // 5. GST on goods (+ packing) and freight separately per Section 8 / GTA rules (Exact order total!)
  const goodsTaxableTotalPaise = Math.round(netBaseUnitPaise * qty) + packingTotalPaise;
  const goodsGst = computeGstLine({
    taxablePaise: goodsTaxableTotalPaise,
    gstRatePct: input.gstPct,
    buyer,
    supplier: input.supplier,
    hsnOrItemText: input.hsnOrItemText,
    explicitBlockedCredit: input.explicitBlockedCredit,
    itcRecoveryPct: input.itcRecoveryPct,
  });
  flags.push(...goodsGst.flags);

  const freightMode: FreightGstMode =
    input.freightGstMode ?? (freightTotalPaise > 0 ? 'composite_supply' : 'included_in_rate');

  let freightGstRate = 0;
  if (freightMode === 'composite_supply') freightGstRate = input.gstPct;
  else if (freightMode === 'gta_fcm_5') freightGstRate = 5;
  else if (freightMode === 'gta_fcm_18') freightGstRate = 18;
  else freightGstRate = 0; // gta_rcm_5 (0 on vendor bill, 5% buyer RCM) or non_gta_exempt

  const freightGst =
    freightTotalPaise > 0
      ? computeGstLine({
          taxablePaise: freightTotalPaise,
          gstRatePct: freightGstRate,
          buyer,
          supplier: input.supplier,
          isFreightLine: true,
          freightGstMode: freightMode,
          principalGoodsGstPct: input.gstPct,
          itcRecoveryPct: input.itcRecoveryPct,
        })
      : null;

  if (freightGst) flags.push(...freightGst.flags);

  const totalTaxablePaise = goodsTaxableTotalPaise + freightTotalPaise;
  const totalGstOnInvoicePaise = goodsGst.totalGstPaise + (freightGst?.totalGstPaise ?? 0);
  const totalItcRecoverablePaise =
    goodsGst.itcRecoverablePaise + (freightGst?.itcRecoverablePaise ?? 0);
  const totalNonRecoverableGstPaise =
    goodsGst.nonRecoverableGstPaise +
    (freightGst?.nonRecoverableGstPaise ?? 0) +
    (buyer.gstRegime !== 'regular' ? freightGst?.rcmPayablePaise ?? 0 : 0);

  const totalInvoicePayablePaise = totalTaxablePaise + totalGstOnInvoicePaise;
  const totalNetLandedPaise = totalTaxablePaise + totalNonRecoverableGstPaise;

  const taxableUnitPaise = Math.round(totalTaxablePaise / qty);
  const gstUnitPaise = Math.round(totalGstOnInvoicePaise / qty);
  const itcRecoverableUnitPaise = Math.round(totalItcRecoverablePaise / qty);
  const nonRecoverableGstUnitPaise = Math.round(totalNonRecoverableGstPaise / qty);
  const invoiceOutflowUnitPaise = Math.round(totalInvoicePayablePaise / qty);
  const netLandedUnitPaise = Math.round(totalNetLandedPaise / qty);

  // 6. MSME Section 43B(h) cap check
  const msmeCheck = evaluateMsme43bh({
    supplier: input.supplier,
    quotedCreditDays: input.creditDays,
    hasWrittenAgreement: input.hasWrittenAgreement ?? true,
    orderTaxableTotalPaise: totalTaxablePaise,
  });
  if (msmeCheck.flag) flags.push(msmeCheck.flag);

  // 7. Working-Capital Credit-Day Benefit
  // Financed amount = total invoice cash outflow (buyer holds the full payable during credit window)
  const waccPctUsed = buyer.waccPct;
  const totalCreditBenefitPaise = Math.round(
    totalInvoicePayablePaise * (waccPctUsed / 100) * (msmeCheck.effectiveCreditDays / 365)
  );
  const creditBenefitUnitPaise = Math.round(totalCreditBenefitPaise / qty);
  const totalCreditAdjustedPaise = totalNetLandedPaise - totalCreditBenefitPaise;
  const creditAdjustedRealUnitPaise = netLandedUnitPaise - creditBenefitUnitPaise;

  // 8. Historical Price-Creep Alert (> 2% increase vs past order)
  let priceDeltaPct: number | null = null;
  let isPriceCreepAlert = false;
  if (input.historicalBenchmarkLandedPaise && input.historicalBenchmarkLandedPaise > 0) {
    priceDeltaPct = Number(
      (
        ((netLandedUnitPaise - input.historicalBenchmarkLandedPaise) /
          input.historicalBenchmarkLandedPaise) *
        100
      ).toFixed(2)
    );
    if (priceDeltaPct >= 2.0) {
      isPriceCreepAlert = true;
      const creepOrderImpactPaise =
        (netLandedUnitPaise - input.historicalBenchmarkLandedPaise) * qty;
      flags.push({
        code: 'rate_creep',
        severity: priceDeltaPct >= 5 ? 'critical' : 'warning',
        title: `Silent Rate Creep: +${priceDeltaPct}% vs. Last Order`,
        detail: `${input.supplier.name} quoted ${formatINR(netLandedUnitPaise)}/${norm.canonicalUnit} landed vs. historical benchmark ${formatINR(input.historicalBenchmarkLandedPaise)}/${norm.canonicalUnit} (+${formatINR(creepOrderImpactPaise)} extra on ${qty.toLocaleString('en-IN')} units).`,
        impactPaise: creepOrderImpactPaise,
        statutoryRef: 'Historical Purchase Benchmark',
        recommendedAction: 'Send polite counter-offer anchoring to previous order rate before approving.',
      });
    }
  }

  return {
    quoteId: input.quoteId,
    supplierId: input.supplier.id,
    supplierName: input.supplier.name,
    quantity: qty,
    canonicalUnit: norm.canonicalUnit,
    normalizationNote: norm.normalizationNote,
    baseUnitPaise: netBaseUnitPaise,
    discountUnitPaise,
    freightUnitPaise,
    packingUnitPaise,
    taxableUnitPaise,
    gstUnitPaise,
    itcRecoverableUnitPaise,
    nonRecoverableGstUnitPaise,
    invoiceOutflowUnitPaise,
    netLandedUnitPaise,
    effectiveCreditDaysUsed: msmeCheck.effectiveCreditDays,
    waccPctUsed,
    creditBenefitUnitPaise,
    creditAdjustedRealUnitPaise,
    totalInvoicePayablePaise,
    totalNetLandedPaise,
    totalCreditAdjustedPaise,
    priceDeltaPct,
    isPriceCreepAlert,
    leadTimeDays: input.leadTimeDays ?? null,
    moq: input.moq ?? null,
    ineligibleReason: null,
    reliabilityScore: input.supplier.reliabilityScore ?? null,
    flags,
  };
}

export interface RankComparisonOptions {
  maxLeadTimeDays?: number | null;
  targetQuantity?: number | null;
}

export interface RankedComparisonResult {
  ranked: LandedCostBreakdown[];
  winner: LandedCostBreakdown | null;
  unitMismatchWarning: string | null;
  savingsVsWorstPaise: Paise;
  savingsVsSecondBestPaise: Paise;
  cfoSummary: string;
}

/**
 * Ranks normalized supplier quotes by true Credit-Adjusted Real Unit Cost.
 * Refuses apples-vs-oranges unit comparisons, enforces delivery deadlines & MOQ,
 * and normalizes savings to a common target quantity.
 */
export function rankSupplierQuotes(
  inputs: QuoteCostInput[],
  buyer: WorkspaceTaxProfile,
  options?: RankComparisonOptions
): RankedComparisonResult {
  if (inputs.length === 0) {
    return {
      ranked: [],
      winner: null,
      unitMismatchWarning: null,
      savingsVsWorstPaise: 0,
      savingsVsSecondBestPaise: 0,
      cfoSummary: 'No quotes available to compare yet.',
    };
  }

  const breakdowns = inputs.map((q) => {
    const b = computeLandedCost(q, buyer);
    const reasons: string[] = [];
    if (
      options?.maxLeadTimeDays !== undefined &&
      options.maxLeadTimeDays !== null &&
      b.leadTimeDays !== null &&
      b.leadTimeDays > options.maxLeadTimeDays
    ) {
      reasons.push(`Misses delivery deadline (${b.leadTimeDays}d > max ${options.maxLeadTimeDays}d)`);
    }
    if (
      options?.targetQuantity !== undefined &&
      options.targetQuantity !== null &&
      b.moq !== null &&
      options.targetQuantity < b.moq
    ) {
      reasons.push(`Order qty (${options.targetQuantity}) below supplier MOQ (${b.moq})`);
    }
    b.ineligibleReason = reasons.length > 0 ? reasons.join('; ') : null;
    return b;
  });

  // Guard: Never silently crown a winner across incompatible canonical units (e.g., kg vs pc)!
  const distinctUnits = Array.from(new Set(breakdowns.map((b) => b.canonicalUnit)));
  if (distinctUnits.length > 1) {
    const unitMismatchWarning = `Incompatible units detected (${distinctUnits.join(' vs. ')}). Provide a pack/weight conversion factor before ranking suppliers.`;
    return {
      ranked: breakdowns,
      winner: null,
      unitMismatchWarning,
      savingsVsWorstPaise: 0,
      savingsVsSecondBestPaise: 0,
      cfoSummary: `CANNOT RANK: ${unitMismatchWarning}`,
    };
  }

  // Eligible (deadline/MOQ-compliant) quotes ALWAYS rank ahead of ineligible quotes
  const ranked = [...breakdowns].sort((a, b) => {
    const aInelig = a.ineligibleReason ? 1 : 0;
    const bInelig = b.ineligibleReason ? 1 : 0;
    if (aInelig !== bInelig) return aInelig - bInelig;
    return a.creditAdjustedRealUnitPaise - b.creditAdjustedRealUnitPaise;
  });

  const eligible = ranked.filter((r) => !r.ineligibleReason);
  const winner = eligible.length > 0 ? eligible[0] : null;

  if (!winner) {
    return {
      ranked,
      winner: null,
      unitMismatchWarning: null,
      savingsVsWorstPaise: 0,
      savingsVsSecondBestPaise: 0,
      cfoSummary: `No supplier satisfies your constraints (${ranked.map((r) => `${r.supplierName}: ${r.ineligibleReason}`).join(' | ')}).`,
    };
  }

  const comparisonQty = options?.targetQuantity ?? winner.quantity;
  const worst = ranked[ranked.length - 1];
  const second = ranked.length > 1 ? ranked[1] : null;

  // Compute savings apples-to-apples on unit cost delta × common comparisonQty (or exact totals when quantities match)
  const sameQtyWorst = worst.quantity === winner.quantity;
  const sameQtySecond = second ? second.quantity === winner.quantity : true;

  const savingsVsWorstPaise = sameQtyWorst
    ? worst.totalCreditAdjustedPaise - winner.totalCreditAdjustedPaise
    : Math.round((worst.creditAdjustedRealUnitPaise - winner.creditAdjustedRealUnitPaise) * comparisonQty);

  const savingsVsSecondBestPaise = second
    ? sameQtySecond
      ? second.totalCreditAdjustedPaise - winner.totalCreditAdjustedPaise
      : Math.round((second.creditAdjustedRealUnitPaise - winner.creditAdjustedRealUnitPaise) * comparisonQty)
    : 0;

  let cfoSummary = `Cheapest compliant real cost: ${winner.supplierName} at ${formatINR(winner.creditAdjustedRealUnitPaise)}/${winner.canonicalUnit} effective (${formatINR(winner.netLandedUnitPaise)} net landed, ${winner.effectiveCreditDaysUsed}-day credit @ ${winner.waccPctUsed}% WACC).`;

  if (second) {
    cfoSummary += ` Beats ${second.supplierName} (${formatINR(second.creditAdjustedRealUnitPaise)}/${second.canonicalUnit}${second.ineligibleReason ? ` — ${second.ineligibleReason}` : ''}) by ${formatINR(Math.max(0, savingsVsSecondBestPaise))} on ${comparisonQty.toLocaleString('en-IN')} ${winner.canonicalUnit}.`;
  }

  const criticalCount = winner.flags.filter((f) => f.severity === 'critical').length;
  if (criticalCount > 0) {
    cfoSummary += ` Caution: ${winner.supplierName} has ${criticalCount} critical compliance flag(s) to resolve before issuing PO.`;
  }

  return {
    ranked,
    winner,
    unitMismatchWarning: null,
    savingsVsWorstPaise,
    savingsVsSecondBestPaise,
    cfoSummary,
  };
}
