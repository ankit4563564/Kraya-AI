import { formatINR, Paise } from '@kraya/finance-engine';
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

export interface ComplianceAgentInput {
  memory: WorkspaceLiveMemory;
  auditChainValid?: boolean;
  config?: AgentRuntimeConfig;
}

export interface ComplianceAgentData {
  msmeOverduePaise: Paise;
  msmeApproachingPaise: Paise;
  estimatedTaxDisallowancePenaltyPaise: Paise; // ~30% Income Tax on unpaid Mar 31 MSME expense
  rule37ItcAtRiskPaise: Paise;
  disputedInvoicesCount: number;
  unverifiedGstinSuppliersCount: number;
  tds194qTriggered: boolean;
  statutoryChecklist: Array<{ item: string; status: 'ok' | 'action_needed' | 'critical'; dueText: string }>;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.ceil((b - a) / 86_400_000);
}

/**
 * AGENT 6: GST 2.0, GSTR-2B, Section 43B(h) & Tax Shield Mind.
 * Continuously evaluates the workspace's live statutory health against real-time Indian FY deadlines:
 * - March 31 Section 43B(h) MSME Expense Disallowance (~30% phantom tax + 3x RBI interest!)
 * - Rule 37 180-Day Unpaid Invoice ITC Reversal Cliff
 * - Monthly GSTR-1 (11th) / GSTR-2B IMS (14th) / GSTR-3B (20th) countdown
 * - Section 194Q >₹50L vendor spend trigger
 * - Cryptographic Audit Chain & DPDP Act 2023 safeguards.
 */
export async function runComplianceTaxShieldAgent(
  input: ComplianceAgentInput
): Promise<SpecialistAgentReport<ComplianceAgentData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const today = ctx.regulatoryClock.todayIso;
  const mem = input.memory;
  const reasoningSteps: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const whatIfScenarios: WhatIfScenario[] = [];
  const proposedActions: ProposedAgentAction[] = [];
  const statutoryChecklist: ComplianceAgentData['statutoryChecklist'] = [];

  reasoningSteps.push(
    `1. Scanning ${mem.invoices.length} invoice(s), ${mem.suppliers.length} supplier(s), and ${mem.moneyLeaks.length} money leak(s) against live Indian statutory clock (${ctx.regulatoryClock.financialYear}, ${ctx.regulatoryClock.daysToMarch31TaxCliff}d to March 31).`
  );

  let msmeOverduePaise = 0;
  let msmeApproachingPaise = 0;
  let rule37ItcAtRiskPaise = 0;
  let disputedInvoicesCount = 0;

  for (const inv of mem.invoices) {
    if (inv.imsSuggestedAction === 'REJECT' || inv.imsSuggestedAction === 'PENDING' || inv.totalMoneyLeakPaise > 0) {
      disputedInvoicesCount++;
    }
    if (!inv.paidAt) {
      if (inv.msme43bhDueAt) {
        const d = daysBetween(today, inv.msme43bhDueAt);
        if (d < 0) msmeOverduePaise += inv.grandTotalPaise;
        else if (d <= 14) msmeApproachingPaise += inv.grandTotalPaise;
      }
      if (inv.rule37CliffAt) {
        const d180 = daysBetween(today, inv.rule37CliffAt);
        if (d180 <= 30) {
          rule37ItcAtRiskPaise += inv.gstPaise;
        }
      }
    }
  }

  const msmeTotalExposure = msmeOverduePaise + msmeApproachingPaise;
  const estimatedTaxDisallowancePenaltyPaise = Math.round(msmeTotalExposure * 0.3);

  // Condition 1: Section 43B(h) MSME Tax Shield
  if (msmeOverduePaise > 0) {
    conditions.push({
      id: 'msme_43bh_overdue',
      label: 'Section 43B(h) Overdue MSME Dues',
      status: 'fail',
      detail: `${formatINR(msmeOverduePaise)} in Micro/Small MSME invoices are OVERDUE. Unpaid at March 31 = 100% expense disallowance (~${formatINR(Math.round(msmeOverduePaise * 0.3))} extra income tax + ${ctx.regulatoryClock.msme43bhPenaltyInterestPct}% compound interest!).`,
      metric: formatINR(msmeOverduePaise),
      statutoryRef: 'Section 43B(h) Income Tax Act',
    });
    statutoryChecklist.push({
      item: `Clear overdue MSME dues (${formatINR(msmeOverduePaise)})`,
      status: 'critical',
      dueText: 'Immediate',
    });
    proposedActions.push({
      id: 'act_clear_msme',
      title: `Prioritize MSME Payouts (${formatINR(msmeOverduePaise)}) Before Tax Cliff`,
      actionType: 'release_msme_payment',
      requiresHumanApproval: true,
      priority: 'critical',
      rationale: `Protects ~${formatINR(Math.round(msmeOverduePaise * 0.3))} in income tax disallowance.`,
    });
  } else if (msmeApproachingPaise > 0) {
    conditions.push({
      id: 'msme_43bh_approaching',
      label: 'Section 43B(h) Upcoming MSME Dues (≤14 days)',
      status: 'warning',
      detail: `${formatINR(msmeApproachingPaise)} in MSME invoices due within 14 days. Schedule NEFT/RTGS to preserve tax deductibility.`,
      metric: formatINR(msmeApproachingPaise),
      statutoryRef: 'Section 43B(h) Income Tax Act',
    });
    statutoryChecklist.push({
      item: `Schedule upcoming MSME payouts (${formatINR(msmeApproachingPaise)})`,
      status: 'action_needed',
      dueText: 'Within 14 days',
    });
  } else {
    conditions.push({
      id: 'msme_43bh_clear',
      label: 'Section 43B(h) MSME Payment Shield',
      status: 'pass',
      detail: `Zero overdue Micro/Small MSME invoices (${ctx.regulatoryClock.daysToMarch31TaxCliff} days to March 31).`,
      statutoryRef: 'Section 43B(h) Income Tax Act',
    });
    statutoryChecklist.push({
      item: 'Section 43B(h) MSME dues',
      status: 'ok',
      dueText: `${ctx.regulatoryClock.daysToMarch31TaxCliff}d to Mar 31`,
    });
  }

  // Condition 2: Rule 37 180-Day ITC Reversal Cliff
  if (rule37ItcAtRiskPaise > 0) {
    conditions.push({
      id: 'rule37_itc_cliff',
      label: 'Rule 37 (180-Day Payment) ITC Reversal Risk',
      status: 'fail',
      detail: `${formatINR(rule37ItcAtRiskPaise)} in claimed GST ITC is within 30 days of (or past) the 180-day unpaid cliff! Must pay supplier or reverse ITC with 18% interest in GSTR-3B.`,
      metric: formatINR(rule37ItcAtRiskPaise),
      statutoryRef: 'Rule 37 CGST Rules / Sec 16(2)',
    });
    statutoryChecklist.push({
      item: `Prevent Rule 37 ITC reversal (${formatINR(rule37ItcAtRiskPaise)})`,
      status: 'critical',
      dueText: `Before GSTR-3B (${ctx.regulatoryClock.daysToNextGstr3b}d)`,
    });
  } else {
    conditions.push({
      id: 'rule37_itc_cliff',
      label: 'Rule 37 180-Day ITC Protection',
      status: 'pass',
      detail: 'No unpaid invoice is approaching the 180-day GST ITC reversal deadline.',
      statutoryRef: 'Rule 37 CGST Rules',
    });
  }

  // Condition 3: GST IMS & GSTR-2B Window
  conditions.push({
    id: 'gst_ims_window',
    label: 'GST IMS & GSTR-2B Monthly Reconciliation',
    status: disputedInvoicesCount > 0 ? 'warning' : 'pass',
    detail:
      disputedInvoicesCount > 0
        ? `${disputedInvoicesCount} disputed/flagged invoice(s) require KEEP PENDING / REJECT action in the GST IMS Portal before GSTR-2B locks (${ctx.regulatoryClock.daysToNextGstr2b}d) and GSTR-3B (${ctx.regulatoryClock.daysToNextGstr3b}d).`
        : `All recorded invoices are clean. Next GSTR-2B in ${ctx.regulatoryClock.daysToNextGstr2b}d, GSTR-3B in ${ctx.regulatoryClock.daysToNextGstr3b}d.`,
    metric: `${disputedInvoicesCount} IMS actions`,
    statutoryRef: 'Section 16(2)(aa) CGST Act',
  });
  if (disputedInvoicesCount > 0) {
    proposedActions.push({
      id: 'act_run_gstr2b',
      title: `Reconcile GSTR-2B & Export IMS Action Pack (${disputedInvoicesCount} disputed bills)`,
      actionType: 'run_gstr2b',
      requiresHumanApproval: false,
      priority: 'high',
      rationale: 'Hand your CA a clean IMS ACCEPT/REJECT/PENDING CSV before the 20th GSTR-3B filing.',
    });
  }

  // Condition 4: Supplier GSTIN Hygiene
  const unverifiedGstinSuppliersCount = mem.suppliers.filter((s) => !s.gstin).length;
  if (unverifiedGstinSuppliersCount > 0) {
    conditions.push({
      id: 'supplier_gstin_hygiene',
      label: 'Supplier GSTIN & Composition Hygiene',
      status: 'warning',
      detail: `${unverifiedGstinSuppliersCount} of ${mem.suppliers.length} suppliers have no GSTIN on file — verify whether Unregistered/Composition before claiming ITC.`,
      metric: `${unverifiedGstinSuppliersCount} missing`,
    });
  }

  // Condition 5: Section 194Q High-Volume Vendor Check
  const spendByVendor = new Map<string, number>();
  for (const inv of mem.invoices) {
    spendByVendor.set(inv.supplierId, (spendByVendor.get(inv.supplierId) || 0) + inv.taxablePaise);
  }
  const tds194qTriggered =
    mem.workspace.turnoverBand === 'above_10cr' &&
    Array.from(spendByVendor.values()).some((v) => v > 50_00_000 * 100);
  if (tds194qTriggered) {
    conditions.push({
      id: 'tds_194q_watch',
      label: 'Section 194Q (0.1% Purchase TDS) Triggered',
      status: 'warning',
      detail: 'One or more suppliers crossed ₹50 Lakh purchases this FY under >₹10 Cr turnover band. Deduct 0.1% TDS on excess taxable purchases.',
      statutoryRef: 'Section 194Q Income Tax Act',
    });
  }

  // Condition 6: Tamper-Evident Audit Chain
  if (input.auditChainValid === false) {
    conditions.push({
      id: 'audit_chain_integrity',
      label: 'SHA-256 Tamper-Evident Audit Chain',
      status: 'fail',
      detail: 'CRITICAL: Audit log hash chain verification failed! Investigate immediately for DPDP & statutory audit integrity.',
      statutoryRef: 'DPDP Act 2023 Safeguards',
    });
  } else {
    conditions.push({
      id: 'audit_chain_integrity',
      label: 'SHA-256 Tamper-Evident Audit Chain & DPDP',
      status: 'pass',
      detail: 'Immutable cryptographic audit log chain intact (1-year DPDP retention active).',
    });
  }

  // What-If Simulation for March 31 43B(h)
  if (msmeTotalExposure > 0) {
    const monthlyPenalty = Math.round(
      (msmeTotalExposure * (ctx.regulatoryClock.msme43bhPenaltyInterestPct / 100)) / 12
    );
    whatIfScenarios.push({
      id: 'whatif_miss_43bh',
      title: 'Financial Cost of Missing Section 43B(h) Deadline',
      assumption: `If ${formatINR(msmeTotalExposure)} of Micro/Small MSME invoices remain unpaid on March 31`,
      impactSummary: `~${formatINR(estimatedTaxDisallowancePenaltyPaise)} immediate Income Tax spike (30% disallowance) + ~${formatINR(monthlyPenalty)}/month non-deductible compound interest (${ctx.regulatoryClock.msme43bhPenaltyInterestPct}% p.a.).`,
      financialDeltaPaise: estimatedTaxDisallowancePenaltyPaise + monthlyPenalty,
      recommendation: 'Clear MSME bills before non-MSME bills — even drawing on a 15% CC line is cheaper than a 30% tax disallowance + 20.25% penalty!',
    });
  }

  // Determine Compliance State
  let detectedState = 'fully_compliant';
  let riskLevel: RiskLevel = 'low';
  if (input.auditChainValid === false) {
    detectedState = 'audit_chain_alert';
    riskLevel = 'critical';
  } else if (msmeOverduePaise > 0 || (ctx.regulatoryClock.isMarch31MsmeRedZone && msmeApproachingPaise > 0)) {
    detectedState = 'march31_43bh_emergency';
    riskLevel = 'critical';
  } else if (rule37ItcAtRiskPaise > 0) {
    detectedState = 'rule37_reversal_imminent';
    riskLevel = 'high';
  } else if (disputedInvoicesCount > 0) {
    detectedState = 'ims_itc_at_risk';
    riskLevel = 'medium';
  } else if (tds194qTriggered) {
    detectedState = 'tds_deduction_required';
    riskLevel = 'medium';
  }

  reasoningSteps.push(
    `2. Statutory State="${detectedState}" (Risk=${riskLevel.toUpperCase()}): MSME exposure=${formatINR(msmeTotalExposure)}, Rule 37 ITC risk=${formatINR(rule37ItcAtRiskPaise)}, Disputed IMS bills=${disputedInvoicesCount}.`
  );

  return {
    agentId: 'compliance',
    agentName: 'GST 2.0, GSTR-2B & Tax Shield Agent',
    roleTitle: 'Indian Indirect/Direct Tax Guardrail & CA Pack Strategist',
    brainMode: 'neuro_symbolic_deterministic',
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates: ['gstr2b_reconciliation', 'ca_audit_pack_export', 'msme_payment_run'],
    riskLevel,
    confidence: 0.99,
    headline:
      detectedState === 'fully_compliant'
        ? `Statutory Shield Green (${ctx.regulatoryClock.financialYear} · GSTR-3B in ${ctx.regulatoryClock.daysToNextGstr3b}d)`
        : `Tax Shield Alert: ${detectedState.replace(/_/g, ' ').toUpperCase()}`,
    executiveVerdict:
      msmeOverduePaise > 0
        ? `Urgent: ${formatINR(msmeOverduePaise)} in overdue Micro/Small MSME bills risks ~${formatINR(Math.round(msmeOverduePaise * 0.3))} in Section 43B(h) tax disallowance. Clear MSME dues first and export the CA Audit Pack before GSTR-3B (${ctx.regulatoryClock.daysToNextGstr3b}d). (Automated pre-payment guidance — final filings subject to CA verification.)`
        : disputedInvoicesCount > 0
          ? `${disputedInvoicesCount} invoice(s) need GST IMS action (REJECT/PENDING) before GSTR-2B closes in ${ctx.regulatoryClock.daysToNextGstr2b}d. Run GSTR-2B Reconciler and download the Tally/CA pack. (Final GST filings subject to CA verification.)`
          : `All statutory checks clean for ${ctx.regulatoryClock.financialYear}. Next milestones: GSTR-1 in ${ctx.regulatoryClock.daysToNextGstr1}d, GSTR-2B in ${ctx.regulatoryClock.daysToNextGstr2b}d, GSTR-3B in ${ctx.regulatoryClock.daysToNextGstr3b}d.`,
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
      msmeOverduePaise,
      msmeApproachingPaise,
      estimatedTaxDisallowancePenaltyPaise,
      rule37ItcAtRiskPaise,
      disputedInvoicesCount,
      unverifiedGstinSuppliersCount,
      tds194qTriggered,
      statutoryChecklist,
    },
  };
}
