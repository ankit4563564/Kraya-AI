import {
  formatINR,
  rankSupplierQuotes,
  QuoteCostInput,
  LandedCostBreakdown,
  Paise,
} from '@kraya/finance-engine';
import { buildRealTimeMarketContext } from '../realtime-context.js';
import type {
  AgentRuntimeConfig,
  ConditionEvaluation,
  ProposedAgentAction,
  RiskLevel,
  SpecialistAgentReport,
  WhatIfScenario,
  WorkspaceLiveMemory,
} from './types.js';

export interface CfoStrategistInput {
  rfqTitle: string;
  quotes: QuoteCostInput[];
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface CashDiscountArbitrageAnalysis {
  supplierName: string;
  discountPct: number;
  earlyPayDaysSaved: number;
  annualizedReturnPct: number;
  buyerWaccPct: number;
  verdict: 'TAKE_CASH_DISCOUNT' | 'KEEP_CREDIT_TERMS';
  netBenefitPaise: Paise;
  explanation: string;
}

export interface CfoStrategistData {
  ranked: LandedCostBreakdown[];
  winnerSupplierId: string | null;
  winnerSupplierName: string | null;
  savingsVsWorstPaise: Paise;
  cashDiscountArbitrage: CashDiscountArbitrageAnalysis[];
  reliabilityAdjustedBestSupplier: string | null;
}

/**
 * AGENT 3: CFO Financial & Landed-Cost Strategist Mind.
 * Evaluates quotes strictly via integer-paise deterministic CFO math across all Indian tax/credit states:
 * - Regular vs Composition GST traps
 * - Section 17(5) blocked credits & Rule 42/43 partial ITC
 * - GTA 5% RCM / Composite Supply freight
 * - Section 43B(h) MSME 15d/45d caps + March 31 tax-year disallowance impact
 * - Cash-Discount Arbitrage vs Buyer WACC % (e.g., 2% CD for 30d = 24.3% annualized > 15% WACC!)
 * - Reliability-weighted risk vs lowest price tradeoff
 * - Multi-scenario What-If simulations.
 */
export async function runCfoStrategistAgent(
  input: CfoStrategistInput
): Promise<SpecialistAgentReport<CfoStrategistData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const buyer = input.memory.workspace;
  const reasoningSteps: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const whatIfScenarios: WhatIfScenario[] = [];
  const proposedActions: ProposedAgentAction[] = [];

  if (input.quotes.length === 0) {
    return {
      agentId: 'cfo_strategist',
      agentName: 'CFO Landed-Cost Strategist Agent',
      roleTitle: 'Working-Capital, GST 2.0 ITC & Cash-Discount Arbitrage Mind',
      brainMode: 'neuro_symbolic_deterministic',
      timestamp: new Date().toISOString(),
      detectedState: 'incomplete_quotes_pending',
      possibleNextStates: ['capture_supplier_quotes', 'supplier_discovery'],
      riskLevel: 'low',
      confidence: 1.0,
      headline: `No Quotes to Evaluate Yet for "${input.rfqTitle}"`,
      executiveVerdict:
        'Capture at least 2 supplier quotes (WhatsApp, PDF, email, or voice note) so the CFO Strategist can compute true credit-adjusted landed cost and tax traps.',
      reasoningSteps: [
        '1. Inspected RFQ quote table: 0 quotes available. Refusing to fabricate bids (Accio Invariant #4).',
      ],
      conditionsEvaluated: [],
      whatIfScenarios: [],
      proposedActions: [
        {
          id: 'act_source_vendors',
          title: 'Discover & Float RFQ to 3 Verified Suppliers',
          actionType: 'create_rfq',
          requiresHumanApproval: true,
          priority: 'high',
          rationale: 'Competitive comparison requires at least 2–3 binding bids.',
        },
      ],
      realTimeContextUsed: {
        usdInr: ctx.fx.usdInr,
        financialYear: ctx.regulatoryClock.financialYear,
        daysToMarch31TaxCliff: ctx.regulatoryClock.daysToMarch31TaxCliff,
        isMarch31MsmeRedZone: ctx.regulatoryClock.isMarch31MsmeRedZone,
      },
      structuredData: {
        ranked: [],
        winnerSupplierId: null,
        winnerSupplierName: null,
        savingsVsWorstPaise: 0,
        cashDiscountArbitrage: [],
        reliabilityAdjustedBestSupplier: null,
      },
    };
  }

  const comparison = rankSupplierQuotes(input.quotes, buyer);
  const ranked = comparison.ranked;

  if (comparison.unitMismatchWarning || !comparison.winner) {
    return {
      agentId: 'cfo_strategist',
      agentName: 'CFO Landed-Cost Strategist Agent',
      roleTitle: 'Working-Capital, GST 2.0 ITC & Cash-Discount Arbitrage Mind',
      brainMode: 'neuro_symbolic_deterministic',
      timestamp: new Date().toISOString(),
      detectedState: 'incomplete_quotes_pending',
      possibleNextStates: ['clarify_unit_conversion', 'capture_supplier_quotes'],
      riskLevel: 'medium',
      confidence: 0.95,
      headline: comparison.unitMismatchWarning
        ? 'Unit Mismatch Blocked Unsafe Ranking'
        : 'No Eligible Supplier Satisfies Order Constraints',
      executiveVerdict: comparison.cfoSummary,
      reasoningSteps: [
        `1. Evaluated ${ranked.length} quote(s); refused to crown an unsafe winner: ${comparison.cfoSummary}`,
      ],
      conditionsEvaluated: [
        {
          id: 'unit_or_eligibility_guard',
          label: 'Apples-to-Apples Unit & Eligibility Guard',
          status: 'fail',
          detail: comparison.cfoSummary,
        },
      ],
      whatIfScenarios: [],
      proposedActions: [
        {
          id: 'act_verify_units',
          title: 'Provide Pack/Weight Conversion Factor or Adjust Constraints',
          actionType: 'verify_fields',
          requiresHumanApproval: true,
          priority: 'high',
          rationale: comparison.cfoSummary,
        },
      ],
      realTimeContextUsed: {
        usdInr: ctx.fx.usdInr,
        financialYear: ctx.regulatoryClock.financialYear,
        daysToMarch31TaxCliff: ctx.regulatoryClock.daysToMarch31TaxCliff,
        isMarch31MsmeRedZone: ctx.regulatoryClock.isMarch31MsmeRedZone,
      },
      structuredData: {
        ranked,
        winnerSupplierId: null,
        winnerSupplierName: null,
        savingsVsWorstPaise: 0,
        cashDiscountArbitrage: [],
        reliabilityAdjustedBestSupplier: null,
      },
    };
  }

  const winner = comparison.winner;
  const qty = Math.max(1, winner.quantity || 1);
  const savingsVsWorstPaise = Math.max(0, comparison.savingsVsWorstPaise);

  reasoningSteps.push(
    `1. Ranked ${ranked.length} quote(s) for "${input.rfqTitle}" using buyer profile (Regime=${buyer.gstRegime}, State=${buyer.stateCode}, WACC=${buyer.waccPct}% p.a., integer-paise precision).`
  );
  reasoningSteps.push(
    `2. L1 Winner on true credit-adjusted cost: ${winner.supplierName} at ${formatINR(winner.creditAdjustedRealUnitPaise)}/${winner.canonicalUnit} (Invoice Landed: ${formatINR(winner.netLandedUnitPaise)}, Credit Benefit: ${formatINR(winner.creditBenefitUnitPaise)}/unit, Effective Credit: ${winner.effectiveCreditDaysUsed}d).`
  );

  // Detect Composition traps, 43B(h) caps, price creep, blocked credits
  const compositionQuotes = input.quotes.filter((q) => q.supplier.gstRegime === 'composition');
  const capFlags = ranked.flatMap((r) =>
    r.flags.filter((f) => f.code === 'msme_43bh_tax_risk')
  );
  const creepQuotes = ranked.filter((r) => r.isPriceCreepAlert || (r.priceDeltaPct ?? 0) >= 3);
  const blockedCreditQuotes = ranked.filter(
    (r) => r.nonRecoverableGstUnitPaise > 0 && buyer.gstRegime === 'regular'
  );

  if (compositionQuotes.length > 0 && buyer.gstRegime === 'regular') {
    conditions.push({
      id: 'composition_trap',
      label: 'Composition Dealer ITC Trap Evaluated',
      status: 'warning',
      detail: `${compositionQuotes.map((q) => q.supplier.name).join(', ')} is under Composition Scheme (0% ITC). Full gross bill was included in landed cost comparison so you are not fooled by "no GST" pricing.`,
      statutoryRef: 'Section 10 CGST Act',
    });
  }

  if (capFlags.length > 0) {
    conditions.push({
      id: 'msme_43bh_cap',
      label: 'MSME Section 43B(h) 45-Day Legal Cap Enforced',
      status: ctx.regulatoryClock.isMarch31MsmeRedZone ? 'fail' : 'warning',
      detail: `${capFlags.length} quote(s) offered >45 days credit from a Micro/Small Udyam supplier. Legal ceiling capped credit benefit at 45 days (written PO mandatory!).${ctx.regulatoryClock.isMarch31MsmeRedZone ? ` MARCH 31 RED ZONE (${ctx.regulatoryClock.daysToMarch31TaxCliff}d left)!` : ''}`,
      statutoryRef: 'Section 43B(h) Income Tax Act',
    });
  } else {
    conditions.push({
      id: 'msme_43bh_cap',
      label: 'MSME Section 43B(h) Credit Terms Check',
      status: 'pass',
      detail: 'No quote exceeds statutory Micro/Small MSME payment ceilings.',
      statutoryRef: 'Section 43B(h) Income Tax Act',
    });
  }

  if (creepQuotes.length > 0) {
    conditions.push({
      id: 'price_creep_check',
      label: 'Silent Vendor Price-Creep Radar',
      status: 'warning',
      detail: `${creepQuotes.map((c) => `${c.supplierName} (+${c.priceDeltaPct?.toFixed(1)}%)`).join(', ')} quoted ≥3% above historical workspace purchase rate.`,
    });
  }

  if (blockedCreditQuotes.length > 0) {
    conditions.push({
      id: 'blocked_credit_check',
      label: 'Non-Recoverable GST / Section 17(5) Impact',
      status: 'info',
      detail: `${blockedCreditQuotes.length} quote(s) have non-recoverable GST factored directly into landed unit cost.`,
      statutoryRef: 'Section 17(5) CGST Act',
    });
  }

  // Cash Discount Arbitrage Analysis (e.g., 2% CD for paying 30 days early = 24.33% annualized vs 15% WACC)
  const cashDiscountArbitrage: CashDiscountArbitrageAnalysis[] = [];
  for (const r of ranked) {
    if (r.effectiveCreditDaysUsed >= 15) {
      const testCdPct = 2.0; // Standard Indian B2B 2% Cash Discount (CD) benchmark
      const annualizedReturnPct =
        Math.round((testCdPct / (100 - testCdPct)) * (365 / r.effectiveCreditDaysUsed) * 1000) / 10;
      const shouldTakeCd = annualizedReturnPct > buyer.waccPct;
      const orderCash = r.invoiceOutflowUnitPaise * qty;
      const cdGrossSave = Math.round((orderCash * testCdPct) / 100);
      const financingCost = Math.round(
        (orderCash * (buyer.waccPct / 100) * r.effectiveCreditDaysUsed) / 365
      );
      const netBenefitPaise = cdGrossSave - financingCost;

      cashDiscountArbitrage.push({
        supplierName: r.supplierName,
        discountPct: testCdPct,
        earlyPayDaysSaved: r.effectiveCreditDaysUsed,
        annualizedReturnPct,
        buyerWaccPct: buyer.waccPct,
        verdict: shouldTakeCd ? 'TAKE_CASH_DISCOUNT' : 'KEEP_CREDIT_TERMS',
        netBenefitPaise,
        explanation: shouldTakeCd
          ? `Negotiating a 2% Cash Discount to pay upfront instead of Net ${r.effectiveCreditDaysUsed}d yields ${annualizedReturnPct}% annualized ROI vs your ${buyer.waccPct}% WACC — net gain of ${formatINR(netBenefitPaise)} on this order!`
          : `Keep Net ${r.effectiveCreditDaysUsed}d credit: a 2% Cash Discount (${annualizedReturnPct}% annualized) does not beat your ${buyer.waccPct}% cost of capital.`,
      });
    }
  }

  const bestArbitrage = cashDiscountArbitrage.find(
    (a) => a.verdict === 'TAKE_CASH_DISCOUNT' && a.netBenefitPaise > 0
  );
  if (bestArbitrage) {
    conditions.push({
      id: 'cash_discount_arbitrage',
      label: 'Cash Discount vs WACC Arbitrage Opportunity',
      status: 'info',
      detail: bestArbitrage.explanation,
      metric: `${bestArbitrage.annualizedReturnPct}% ROI vs ${buyer.waccPct}% WACC`,
    });
    whatIfScenarios.push({
      id: 'whatif_cd_arbitrage',
      title: `Cash-Discount Arbitrage (2% CD vs Net ${bestArbitrage.earlyPayDaysSaved}d)`,
      assumption: `Pay ${bestArbitrage.supplierName} upfront in exchange for a 2% Cash Discount (at ${buyer.waccPct}% WACC)`,
      impactSummary: bestArbitrage.explanation,
      financialDeltaPaise: -bestArbitrage.netBenefitPaise,
      recommendation: 'Offer immediate RTGS/UPI on delivery if supplier grants ≥2% Cash Discount.',
    });
  }

  // What-If 2: WACC +3% Working Capital Stress Test
  if (input.quotes.length >= 2) {
    const stressed = rankSupplierQuotes(input.quotes, { ...buyer, waccPct: buyer.waccPct + 3 });
    if (stressed.winner) {
      const flipped = stressed.winner.supplierId !== winner.supplierId;
      whatIfScenarios.push({
        id: 'whatif_wacc_stress',
        title: `Working-Capital Stress Test (WACC ${buyer.waccPct}% → ${buyer.waccPct + 3}%)`,
        assumption: 'If your CC/OD borrowing cost tightens by +3% p.a. during peak season',
        impactSummary: flipped
          ? `WINNER FLIPS! ${stressed.winner.supplierName} overtakes ${winner.supplierName} due to superior credit terms (${stressed.winner.effectiveCreditDaysUsed}d).`
          : `${winner.supplierName} remains L1 winner even under +3% higher working-capital cost.`,
        recommendation: flipped
          ? `Consider favoring ${stressed.winner.supplierName} if cashflow is tight this quarter.`
          : `${winner.supplierName} is robust across interest-rate shifts.`,
      });
    }
  }

  // Reliability vs Price Tradeoff Check
  const winnerReliability = winner.reliabilityScore ?? 85;
  const highRelAlt = ranked.find(
    (r) => r.supplierId !== winner.supplierId && (r.reliabilityScore ?? 85) >= winnerReliability + 12
  );
  let reliabilityAdjustedBestSupplier = winner.supplierName;

  if (highRelAlt && winnerReliability < 75) {
    const premiumPaise = Math.round(
      (highRelAlt.creditAdjustedRealUnitPaise - winner.creditAdjustedRealUnitPaise) * qty
    );
    reliabilityAdjustedBestSupplier = highRelAlt.supplierName;
    conditions.push({
      id: 'reliability_tradeoff',
      label: 'Reliability vs L1 Price Tradeoff',
      status: 'warning',
      detail: `L1 vendor ${winner.supplierName} has low reliability (${winnerReliability}/100). ${highRelAlt.supplierName} (${highRelAlt.reliabilityScore}/100) costs only ${formatINR(premiumPaise)} more total.`,
    });
    whatIfScenarios.push({
      id: 'whatif_reliability_upgrade',
      title: 'Pay Small Premium for Reliable Delivery',
      assumption: `Award to ${highRelAlt.supplierName} (Reliability ${highRelAlt.reliabilityScore}/100) instead of ${winner.supplierName} (${winnerReliability}/100)`,
      impactSummary: `Costs ${formatINR(premiumPaise)} extra on the order but sharply reduces factory line-stoppage risk.`,
      financialDeltaPaise: premiumPaise,
      recommendation: 'For production-critical materials, consider awarding L2 or negotiating L2 down toward L1.',
    });
  }

  // Determine CFO Strategist State
  let detectedState = 'clear_l1_winner';
  let riskLevel: RiskLevel = 'low';

  if (capFlags.length > 0 && ctx.regulatoryClock.isMarch31MsmeRedZone) {
    detectedState = 'msme_43bh_cap_distortion';
    riskLevel = 'high';
  } else if (compositionQuotes.length > 0 && buyer.gstRegime === 'regular') {
    detectedState = 'composition_trap_detected';
    riskLevel = 'medium';
  } else if (creepQuotes.length > 0) {
    detectedState = 'price_creep_alert';
    riskLevel = 'medium';
  } else if (highRelAlt && winnerReliability < 75) {
    detectedState = 'reliability_vs_price_tradeoff';
    riskLevel = 'medium';
  } else if (bestArbitrage) {
    detectedState = 'cash_discount_arbitrage_win';
    riskLevel = 'low';
  }

  proposedActions.push({
    id: 'act_approve_l1',
    title: `Approve PO to ${winner.supplierName} (${formatINR(winner.creditAdjustedRealUnitPaise)}/${winner.canonicalUnit} eff.)`,
    actionType: 'approve_po',
    requiresHumanApproval: true,
    priority: 'high',
    rationale: `Saves ${formatINR(savingsVsWorstPaise)} vs highest quote; prints explicit Net ${winner.effectiveCreditDaysUsed}d terms on GST PO PDF.`,
    suggestedPayload: {
      supplierId: winner.supplierId,
      effectiveCreditDays: winner.effectiveCreditDaysUsed,
    },
  });

  if (ranked.length >= 2) {
    proposedActions.push({
      id: 'act_negotiate_before_po',
      title: 'Run Negotiation Counter-Offer Before Issuing PO',
      actionType: 'send_whatsapp',
      requiresHumanApproval: true,
      priority: 'medium',
      rationale: `Use ${winner.supplierName}'s BATNA to squeeze an additional 2–4% concession or 2% Cash Discount.`,
    });
  }

  return {
    agentId: 'cfo_strategist',
    agentName: 'CFO Landed-Cost Strategist Agent',
    roleTitle: 'Working-Capital, GST 2.0 ITC & Cash-Discount Arbitrage Mind',
    brainMode: 'neuro_symbolic_deterministic',
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates: ['negotiation_counter_offer', 'po_approval_gate', 'excel_cfo_export'],
    riskLevel,
    confidence: 0.98,
    headline: `L1 Winner: ${winner.supplierName} at ${formatINR(winner.creditAdjustedRealUnitPaise)}/${winner.canonicalUnit} (Saves ${formatINR(savingsVsWorstPaise)})`,
    executiveVerdict: `${winner.supplierName} wins on true credit-adjusted landed cost (${formatINR(winner.creditAdjustedRealUnitPaise)}/${winner.canonicalUnit}, saving ${formatINR(savingsVsWorstPaise)} vs L${ranked.length}). ${bestArbitrage ? `Bonus CFO move: ${bestArbitrage.explanation}` : `Always issue a written GST PO stating Net ${winner.effectiveCreditDaysUsed}d to protect Section 43B(h) compliance.`}`,
    reasoningSteps,
    conditionsEvaluated: conditions,
    whatIfScenarios,
    proposedActions,
    realTimeContextUsed: {
      usdInr: ctx.fx.usdInr,
      financialYear: ctx.regulatoryClock.financialYear,
      daysToMarch31TaxCliff: ctx.regulatoryClock.daysToMarch31TaxCliff,
      isMarch31MsmeRedZone: ctx.regulatoryClock.isMarch31MsmeRedZone,
    },
    structuredData: {
      ranked,
      winnerSupplierId: winner.supplierId,
      winnerSupplierName: winner.supplierName,
      savingsVsWorstPaise,
      cashDiscountArbitrage,
      reliabilityAdjustedBestSupplier,
    },
  };
}
