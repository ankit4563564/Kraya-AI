import {
  auditSupplierInvoice,
  formatINR,
  InvoiceAuditInput,
  InvoiceAuditResult,
  validateGstin,
  toPaise,
  Paise,
} from '@kraya/finance-engine';
import { LiveGstnVerificationResult } from '../gstn-live.js';
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

export type PaymentReleaseDecision =
  | 'RELEASE_PAYMENT'
  | 'RELEASE_WITH_TDS_DEDUCTION'
  | 'HOLD_AND_REQUEST_CREDIT_NOTE'
  | 'BLOCK_PAYMENT_AND_REJECT_IN_IMS';

export interface AuditorAgentInput {
  auditInput: InvoiceAuditInput;
  liveGstn?: LiveGstnVerificationResult | null;
  grnAcceptedQty?: number | null;
  invoicedQty?: number | null;
  isServiceOrAmcOrFreight?: boolean;
  annualVendorSpendPaise?: Paise;
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface AuditorAgentData {
  auditResult: InvoiceAuditResult;
  paymentDecision: PaymentReleaseDecision;
  tdsAdvisory: {
    applicable: boolean;
    section: '194C' | '194Q' | null;
    ratePct: number;
    tdsAmountPaise: Paise;
    netPayableAfterTdsPaise: Paise;
    note: string;
  };
  totalBlockedExposurePaise: Paise;
}

/**
 * AGENT 5: PO Governance, GRN & 3-Way Match Forensics Mind.
 * Audits supplier bills against PO, GRN accepted quantity, GST 2.0 rules, IRN mandate,
 * Live GSTN Active/Cancelled status, Price History, and TDS 194C/194Q before ₹1 leaves the bank.
 */
export async function runAuditorAgent(
  input: AuditorAgentInput
): Promise<SpecialistAgentReport<AuditorAgentData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const buyer = input.memory.workspace;
  const auditResult = auditSupplierInvoice(input.auditInput, buyer);
  const reasoningSteps: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const whatIfScenarios: WhatIfScenario[] = [];
  const proposedActions: ProposedAgentAction[] = [];

  const statedGrandTotalPaise = toPaise(input.auditInput.statedGrandTotalRupees);
  const statedTaxablePaise = toPaise(input.auditInput.statedTaxableRupees);
  const statedGstPaise =
    toPaise(input.auditInput.statedCgstRupees) +
    toPaise(input.auditInput.statedSgstRupees) +
    toPaise(input.auditInput.statedIgstRupees);

  reasoningSteps.push(
    `1. Executed deterministic 3-Way Match & GST 2.0 Forensics on Invoice #${input.auditInput.invoiceNumber} (${input.auditInput.supplier.name}, Grand Total ${formatINR(statedGrandTotalPaise)}).`
  );

  let totalBlockedExposurePaise = auditResult.totalMoneyLeakPaise;
  let criticalGstBlocker = false;

  // Check Live GSTN Status if available
  if (input.liveGstn) {
    if (
      input.liveGstn.taxpayerStatus === 'Cancelled' ||
      input.liveGstn.taxpayerStatus === 'Suspended'
    ) {
      criticalGstBlocker = true;
      totalBlockedExposurePaise += statedGstPaise;
      conditions.push({
        id: 'live_gstn_status',
        label: 'Live GSTN Taxpayer Status Check',
        status: 'fail',
        detail: `GSTIN ${input.liveGstn.gstin} is ${input.liveGstn.taxpayerStatus.toUpperCase()} on GSTN! Paying GST of ${formatINR(statedGstPaise)} risks 100% ITC disallowance.`,
        statutoryRef: 'Section 16 CGST Act',
        metric: input.liveGstn.taxpayerStatus,
      });
    } else if (input.liveGstn.liveVerified) {
      conditions.push({
        id: 'live_gstn_status',
        label: 'Live GSTN Taxpayer Status Check',
        status: 'pass',
        detail: `Live verified Active ${input.liveGstn.taxpayerType} taxpayer (${input.liveGstn.legalName || input.liveGstn.gstin}).`,
        metric: 'Active',
      });
    }
  }

  // Check GRN 3-Way Quantity Guard
  const hasGrnShortfall =
    typeof input.grnAcceptedQty === 'number' &&
    typeof input.invoicedQty === 'number' &&
    input.invoicedQty > input.grnAcceptedQty;

  if (hasGrnShortfall) {
    const excessQty = input.invoicedQty! - input.grnAcceptedQty!;
    conditions.push({
      id: 'grn_3way_guard',
      label: 'GRN Physical Receipt 3-Way Quantity Guard',
      status: 'fail',
      detail: `Supplier billed ${input.invoicedQty} units but factory GRN accepted only ${input.grnAcceptedQty} units (${excessQty} unit short-delivery / rejection). Hold payment for unreceived units.`,
      metric: `Short by ${excessQty} units`,
    });
  } else if (typeof input.grnAcceptedQty === 'number') {
    conditions.push({
      id: 'grn_3way_guard',
      label: 'GRN Physical Receipt 3-Way Quantity Guard',
      status: 'pass',
      detail: `Invoiced quantity matches GRN QC-accepted receipt (${input.grnAcceptedQty} units).`,
    });
  }

  // Map all deterministic Money Leak flags into condition evaluations
  for (const flag of auditResult.flags) {
    conditions.push({
      id: `audit_flag_${flag.code}`,
      label: flag.title,
      status: flag.severity === 'critical' ? 'fail' : flag.severity === 'warning' ? 'warning' : 'info',
      detail: flag.detail,
      metric: flag.impactPaise > 0 ? formatINR(flag.impactPaise) : undefined,
      statutoryRef: flag.statutoryRef,
    });
    if (
      flag.code === 'missing_irn_itc_risk' ||
      flag.code === 'composition_tax_fraud' ||
      flag.code === 'wrong_tax_split_state'
    ) {
      criticalGstBlocker = true;
    }
  }

  // Compute Section 194C / 194Q TDS Advisory deterministically
  const gstinToCheck = input.auditInput.supplierGstinOnBill || input.auditInput.supplier.gstin;
  const gstinParsed = gstinToCheck ? validateGstin(gstinToCheck) : null;
  const singleBillThreshold194c = 30_000 * 100; // ₹30,000
  const annualThreshold194c = 1_00_000 * 100; // ₹1,00,000
  const annualThreshold194q = 50_00_000 * 100; // ₹50,00,000
  const annualSpend = (input.annualVendorSpendPaise || 0) + statedTaxablePaise;

  let tdsAdvisory: AuditorAgentData['tdsAdvisory'] = {
    applicable: false,
    section: null,
    ratePct: 0,
    tdsAmountPaise: 0,
    netPayableAfterTdsPaise: statedGrandTotalPaise,
    note: 'No TDS 194C/194Q threshold crossed on this bill.',
  };

  if (
    (input.isServiceOrAmcOrFreight || input.auditInput.isServiceOrAmcOrGta) &&
    (statedTaxablePaise > singleBillThreshold194c || annualSpend > annualThreshold194c)
  ) {
    const ratePct = gstinParsed?.tds194cRatePct ?? 2;
    const tdsAmountPaise = Math.round((statedTaxablePaise * ratePct) / 100);
    tdsAdvisory = {
      applicable: true,
      section: '194C',
      ratePct,
      tdsAmountPaise,
      netPayableAfterTdsPaise: Math.max(0, statedGrandTotalPaise - tdsAmountPaise),
      note: `Section 194C TDS @ ${ratePct}% (${gstinParsed?.panEntityLabel || 'Company/Firm'} from PAN 4th char) on taxable value ${formatINR(statedTaxablePaise)} = ${formatINR(tdsAmountPaise)}. Pay supplier net ${formatINR(Math.max(0, statedGrandTotalPaise - tdsAmountPaise))}.`,
    };
    conditions.push({
      id: 'tds_194c',
      label: 'TDS Section 194C Deduction Required',
      status: 'info',
      detail: tdsAdvisory.note,
      metric: `TDS ${formatINR(tdsAmountPaise)} (${ratePct}%)`,
      statutoryRef: 'Section 194C Income Tax Act',
    });
  } else if (buyer.turnoverBand === 'above_10cr' && annualSpend > annualThreshold194q) {
    const excessTaxable = Math.min(statedTaxablePaise, annualSpend - annualThreshold194q);
    const tdsAmountPaise = Math.round(excessTaxable * 0.001); // 0.1%
    tdsAdvisory = {
      applicable: true,
      section: '194Q',
      ratePct: 0.1,
      tdsAmountPaise,
      netPayableAfterTdsPaise: Math.max(0, statedGrandTotalPaise - tdsAmountPaise),
      note: `Section 194Q TDS @ 0.1% applies (buyer turnover >₹10 Cr & annual vendor purchases >₹50 Lakh): deduct ${formatINR(tdsAmountPaise)} on taxable value.`,
    };
    conditions.push({
      id: 'tds_194q',
      label: 'TDS Section 194Q (Goods >₹50L/FY) Required',
      status: 'info',
      detail: tdsAdvisory.note,
      metric: `TDS ${formatINR(tdsAmountPaise)} (0.1%)`,
      statutoryRef: 'Section 194Q Income Tax Act',
    });
  }

  // Decide exact State & Payment Release Verdict
  let detectedState = 'clean_ready_to_pay';
  let paymentDecision: PaymentReleaseDecision = tdsAdvisory.applicable
    ? 'RELEASE_WITH_TDS_DEDUCTION'
    : 'RELEASE_PAYMENT';
  let riskLevel: RiskLevel = 'low';

  if (criticalGstBlocker || auditResult.imsSuggestedAction === 'REJECT') {
    detectedState = auditResult.flags.some((f) => f.code === 'missing_irn_itc_risk')
      ? 'missing_irn_itc_blocker'
      : auditResult.flags.some((f) => f.code === 'composition_tax_fraud')
        ? 'composition_tax_fraud'
        : 'gst_tax_split_or_slab_error';
    paymentDecision = 'BLOCK_PAYMENT_AND_REJECT_IN_IMS';
    riskLevel = 'critical';
  } else if (hasGrnShortfall) {
    detectedState = 'grn_short_delivery_block';
    paymentDecision = 'HOLD_AND_REQUEST_CREDIT_NOTE';
    riskLevel = 'high';
  } else if (!auditResult.mathReconciled) {
    detectedState = 'arithmetic_mismatch';
    paymentDecision = 'HOLD_AND_REQUEST_CREDIT_NOTE';
    riskLevel = 'high';
  } else if (totalBlockedExposurePaise > 0) {
    detectedState = auditResult.flags.some((f) => f.code === 'double_gst_freight')
      ? 'freight_double_gst_leak'
      : 'po_rate_or_qty_leak';
    paymentDecision = 'HOLD_AND_REQUEST_CREDIT_NOTE';
    riskLevel = 'high';
  }

  reasoningSteps.push(
    `2. Verdict: ${paymentDecision} (Detected state="${detectedState}", Money Leak / ITC Exposure=${formatINR(totalBlockedExposurePaise)}, GST IMS Action=${auditResult.imsSuggestedAction}).`
  );
  if (tdsAdvisory.applicable) {
    reasoningSteps.push(`3. TDS Check: ${tdsAdvisory.note}`);
  }

  // Actions & What-If
  if (paymentDecision === 'BLOCK_PAYMENT_AND_REJECT_IN_IMS') {
    proposedActions.push({
      id: 'act_reject_ims',
      title: `Mark Invoice #${input.auditInput.invoiceNumber} as ${auditResult.imsSuggestedAction} in GST IMS Portal`,
      actionType: 'reject_ims',
      requiresHumanApproval: true,
      priority: 'critical',
      rationale: `Prevents ${formatINR(totalBlockedExposurePaise)} in ITC disallowance or illegal GST payout.`,
    });
    proposedActions.push({
      id: 'act_dispute_whatsapp',
      title: `Send GST Revision / Credit Note Demand to ${input.auditInput.supplier.name}`,
      actionType: 'request_credit_note',
      requiresHumanApproval: true,
      priority: 'critical',
      rationale: 'Stop bank transfer until supplier issues compliant e-Invoice / revised tax split.',
    });
    whatIfScenarios.push({
      id: 'whatif_pay_anyway',
      title: 'Cost of Paying This Bill Without Correction',
      assumption: 'If accounts payable pays full invoice without fixing GST/IRN defect',
      impactSummary: `Direct cash + ITC disallowance risk of ${formatINR(totalBlockedExposurePaise)} plus 18% GST interest under Section 50 CGST Act.`,
      financialDeltaPaise: totalBlockedExposurePaise,
      recommendation: 'HOLD bank payment immediately until corrected bill/credit note arrives.',
    });
  } else if (paymentDecision === 'HOLD_AND_REQUEST_CREDIT_NOTE') {
    proposedActions.push({
      id: 'act_hold_for_cn',
      title: `Hold Disputed ${formatINR(totalBlockedExposurePaise)} & Request Credit Note`,
      actionType: 'request_credit_note',
      requiresHumanApproval: true,
      priority: 'high',
      rationale: 'Pay undisputed portion (or hold full bill) and log Credit Note upon receipt to close Money Leak.',
    });
  } else {
    proposedActions.push({
      id: 'act_schedule_payment',
      title: tdsAdvisory.applicable
        ? `Approve Net Payment ${formatINR(tdsAdvisory.netPayableAfterTdsPaise)} (Deduct ${formatINR(tdsAdvisory.tdsAmountPaise)} TDS ${tdsAdvisory.section})`
        : `Approve Clean Payment ${formatINR(statedGrandTotalPaise)}`,
      actionType: 'no_action',
      requiresHumanApproval: true,
      priority: 'low',
      rationale: '3-Way Match, GST 2.0, and arithmetic reconciliation all passed.',
    });
  }

  return {
    agentId: 'auditor',
    agentName: 'PO Governance & 3-Way Match Auditor Agent',
    roleTitle: 'Forensic Pre-Payment Shield & Dispute Recovery Specialist',
    brainMode: 'neuro_symbolic_deterministic',
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates:
      paymentDecision.startsWith('RELEASE')
        ? ['gstr2b_reconciliation', 'payment_settlement', 'tally_zoho_export']
        : ['send_dispute_notice', 'record_credit_note', 'reject_in_gst_ims'],
    riskLevel,
    confidence: 0.99,
    headline:
      totalBlockedExposurePaise > 0
        ? `${paymentDecision.replace(/_/g, ' ')}: ${formatINR(totalBlockedExposurePaise)} Protected`
        : `Clean 3-Way Match — Ready for Payment (${formatINR(tdsAdvisory.netPayableAfterTdsPaise)} net)`,
    executiveVerdict: `${auditResult.cfoVerdict}${tdsAdvisory.applicable ? ` ${tdsAdvisory.note}` : ''}`,
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
      auditResult,
      paymentDecision,
      tdsAdvisory,
      totalBlockedExposurePaise,
    },
  };
}
