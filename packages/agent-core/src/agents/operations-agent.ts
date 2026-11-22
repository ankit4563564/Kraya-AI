import {
  planAutonomousProcurementSweep,
  AutonomousSweepPlan,
  PlannedFollowupTask,
} from '../autonomous-sweep.js';
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

export type EscalationTier = 'tier_1_gentle' | 'tier_2_firm' | 'tier_3_critical_escalation';

export interface EscalatedTaskItem extends PlannedFollowupTask {
  escalationTier: EscalationTier;
  daysOverdueOrRemaining: number;
  escalationGuidance: string;
}

export interface OperationsAgentInput {
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface OperationsAgentData {
  sweepPlan: AutonomousSweepPlan;
  escalatedTasks: EscalatedTaskItem[];
  averageKycScorePct: number;
  criticalEscalationsCount: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.ceil((b - a) / 86_400_000);
}

/**
 * AGENT 7: Autonomous Procurement Workforce & Tiered Escalation Mind.
 * Runs the morning autonomous sweep across RFQs, POs, GRNs, Invoices, AMCs, and Vendor KYC,
 * assigning an explicit Escalation Tier (Gentle -> Firm -> Critical Escalation + Backup Sourcing)
 * so Purchase Clerks & Owners know the exact priority order every morning at 8:00 AM IST.
 */
export async function runAutonomousOperationsAgent(
  input: OperationsAgentInput
): Promise<SpecialistAgentReport<OperationsAgentData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const today = ctx.regulatoryClock.todayIso;
  const mem = input.memory;
  const supNameById = new Map(mem.suppliers.map((s) => [s.id, s.name]));

  const sweepPlan = planAutonomousProcurementSweep({
    todayIso: today,
    rfqs: mem.rfqs.map((r) => ({
      id: r.id,
      rfqNumber: r.rfqNumber,
      title: r.title,
      status: r.status,
      quoteCount: r.quoteCount,
      createdAt: r.createdAt,
    })),
    pos: mem.purchaseOrders.map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      supplierId: p.supplierId,
      supplierName: p.supplierName || supNameById.get(p.supplierId) || 'Supplier',
      deliveryDueAt: p.deliveryDueAt,
      invoiceStatus: p.invoiceStatus,
      cancelledAt: p.cancelledAt,
      hasFullGrn: Boolean(p.hasFullGrn),
    })),
    invoices: mem.invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      supplierId: i.supplierId,
      supplierName: i.supplierName || supNameById.get(i.supplierId) || 'Supplier',
      grandTotalPaise: i.grandTotalPaise,
      msme43bhDueAt: i.msme43bhDueAt,
      rule37CliffAt: i.rule37CliffAt,
      paidAt: i.paidAt,
    })),
    amcs: mem.amcs.map((a) => ({
      id: a.id,
      assetName: a.assetName,
      supplierId: a.supplierId,
      supplierName: a.supplierName || (a.supplierId ? supNameById.get(a.supplierId) || null : null),
      nextDueAt: a.nextDueAt,
      status: a.status,
    })),
    suppliers: mem.suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email,
      gstin: s.gstin,
      gstRegime: s.gstRegime,
      udyamTier: s.udyamTier,
      creditDays: s.creditDays,
    })),
    existingOpenTasks: mem.openTasks.map((t) => ({
      kind: t.kind,
      relatedId: t.relatedId,
    })),
  });

  // Apply intelligent multi-tier escalation state machine to each planned task
  const escalatedTasks: EscalatedTaskItem[] = sweepPlan.plannedTasks.map((t) => {
    const deltaDays = daysBetween(today, t.dueAt);
    let escalationTier: EscalationTier = 'tier_1_gentle';
    let escalationGuidance = 'Send polite 1-click WhatsApp nudge.';

    if (t.kind === 'payment_43bh' || t.kind === 'rule37_itc_cliff') {
      if (deltaDays <= 3) {
        escalationTier = 'tier_3_critical_escalation';
        escalationGuidance =
          'CRITICAL STATUTORY DEADLINE: Escalate directly to Owner/CFO for immediate RTGS release to prevent tax disallowance or ITC reversal.';
      } else {
        escalationTier = 'tier_2_firm';
        escalationGuidance = 'Queue in this week’s payment batch and alert Accounts Payable.';
      }
    } else if (t.kind === 'delivery_chase') {
      if (deltaDays <= -4) {
        escalationTier = 'tier_3_critical_escalation';
        escalationGuidance =
          'OVERDUE 4+ DAYS: Demand LR/Bilty tracking proof immediately AND activate L2 backup supplier via Sourcing Agent.';
      } else if (deltaDays <= -1) {
        escalationTier = 'tier_2_firm';
        escalationGuidance = 'Request firm revised dispatch date + vehicle number today.';
      }
    } else if (t.kind === 'rfq_chase') {
      escalationTier = deltaDays <= -3 ? 'tier_2_firm' : 'tier_1_gentle';
      escalationGuidance =
        deltaDays <= -3
          ? 'RFQ stale >3 days: expand RFQ to 2 additional suppliers via Discovery.'
          : 'Send quick quote reminder to shortlisted suppliers.';
    } else if (t.kind === 'amc_renewal') {
      escalationTier = deltaDays <= 3 ? 'tier_3_critical_escalation' : 'tier_2_firm';
      escalationGuidance =
        deltaDays <= 3
          ? 'Machinery AMC expires within 3 days — confirm service visit to prevent unplanned plant downtime.'
          : 'Request renewal quote + check TDS 194C applicability.';
    }

    return {
      ...t,
      escalationTier,
      daysOverdueOrRemaining: deltaDays,
      escalationGuidance,
    };
  });

  const criticalEscalationsCount = escalatedTasks.filter(
    (t) => t.escalationTier === 'tier_3_critical_escalation'
  ).length;
  const averageKycScorePct =
    sweepPlan.kycScores.length > 0
      ? Math.round(
          sweepPlan.kycScores.reduce((acc, s) => acc + s.scorePct, 0) / sweepPlan.kycScores.length
        )
      : 100;

  const reasoningSteps: string[] = [
    `1. Executed autonomous morning sweep for ${mem.workspace.legalName} (${today}): scanned ${mem.rfqs.length} RFQs, ${mem.purchaseOrders.length} POs, ${mem.invoices.length} Invoices, ${mem.amcs.length} AMCs, and ${mem.suppliers.length} Suppliers.`,
    `2. Identified ${escalatedTasks.length} new deduplicated follow-up(s): ${criticalEscalationsCount} Tier-3 Critical Escalation(s), average supplier KYC score ${averageKycScorePct}%.`,
  ];

  const conditions: ConditionEvaluation[] = [
    {
      id: 'ops_deliveries',
      label: 'PO Delivery & GRN Watch',
      status: sweepPlan.summary.overdueDeliveriesFound > 0 ? 'fail' : 'pass',
      detail:
        sweepPlan.summary.overdueDeliveriesFound > 0
          ? `${sweepPlan.summary.overdueDeliveriesFound} PO(s) past delivery due date without full GRN.`
          : 'All active POs are on schedule or received via GRN.',
      metric: `${sweepPlan.summary.overdueDeliveriesFound} overdue`,
    },
    {
      id: 'ops_statutory_cliffs',
      label: 'MSME 43B(h) & Rule 37 180-Day Cliffs',
      status:
        sweepPlan.summary.msmeCliffsFound + sweepPlan.summary.rule37CliffsFound > 0 ? 'fail' : 'pass',
      detail: `${sweepPlan.summary.msmeCliffsFound} MSME 43B(h) alert(s) and ${sweepPlan.summary.rule37CliffsFound} Rule 37 180-day alert(s) detected.`,
    },
    {
      id: 'ops_rfq_amc',
      label: 'Stale RFQs & Machinery AMC Renewals',
      status:
        sweepPlan.summary.staleRfqsFound + sweepPlan.summary.amcsDueFound > 0 ? 'warning' : 'pass',
      detail: `${sweepPlan.summary.staleRfqsFound} stale RFQ(s) awaiting quotes; ${sweepPlan.summary.amcsDueFound} AMC renewal(s) approaching.`,
    },
    {
      id: 'ops_kyc_hygiene',
      label: 'Supplier Master KYC Completeness',
      status: sweepPlan.summary.incompleteKycSuppliers > 0 ? 'warning' : 'pass',
      detail: `Average KYC score ${averageKycScorePct}% (${sweepPlan.summary.incompleteKycSuppliers} supplier(s) missing GSTIN/Udyam/Phone).`,
      metric: `${averageKycScorePct}% avg`,
    },
  ];

  const proposedActions: ProposedAgentAction[] = escalatedTasks.slice(0, 5).map((t, idx) => ({
    id: `act_ops_${idx}`,
    title: t.title,
    actionType:
      t.kind === 'payment_43bh'
        ? 'release_msme_payment'
        : t.kind === 'delivery_chase'
          ? 'escalate_delivery'
          : t.kind === 'amc_renewal'
            ? 'renew_amc'
            : 'send_whatsapp',
    requiresHumanApproval: true,
    priority:
      t.escalationTier === 'tier_3_critical_escalation'
        ? 'critical'
        : t.escalationTier === 'tier_2_firm'
          ? 'high'
          : 'medium',
    rationale: t.escalationGuidance,
    suggestedPayload: {
      kind: t.kind,
      relatedId: t.relatedId,
      supplierId: t.supplierId,
      suggestedMessage: t.suggestedMessage,
    },
  }));

  const whatIfScenarios: WhatIfScenario[] = [];
  if (sweepPlan.summary.overdueDeliveriesFound > 0) {
    whatIfScenarios.push({
      id: 'whatif_delivery_slip',
      title: 'Production Line Stoppage Risk on Overdue POs',
      assumption: `If ${sweepPlan.summary.overdueDeliveriesFound} overdue delivery slips another 5 days`,
      impactSummary: 'Factory production delays or emergency spot-market buying at 8–15% premium.',
      recommendation: 'Trigger Tier-3 escalation today and keep an L2 backup supplier on standby.',
    });
  }

  let detectedState = 'calm_steady_state';
  let riskLevel: RiskLevel = 'low';
  if (sweepPlan.summary.msmeCliffsFound > 0 || sweepPlan.summary.rule37CliffsFound > 0) {
    detectedState = 'statutory_cliff_urgent';
    riskLevel = 'critical';
  } else if (sweepPlan.summary.overdueDeliveriesFound > 0) {
    detectedState = 'delivery_escalation_needed';
    riskLevel = 'high';
  } else if (escalatedTasks.length > 0) {
    detectedState = 'routine_followups_queued';
    riskLevel = 'medium';
  } else if (sweepPlan.summary.incompleteKycSuppliers > 0) {
    detectedState = 'kyc_hygiene_gap';
    riskLevel = 'low';
  }

  return {
    agentId: 'operations',
    agentName: 'Autonomous Procurement Operations Agent',
    roleTitle: 'Autonomous Purchase Expeditor, KYC Officer & AMC Planner',
    brainMode: 'neuro_symbolic_deterministic',
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates: ['execute_gated_followups', 'activate_backup_sourcing', 'next_morning_cron'],
    riskLevel,
    confidence: 0.97,
    headline:
      escalatedTasks.length === 0
        ? `Operations Clear — 0 New Urgent Follow-Ups (KYC ${averageKycScorePct}%)`
        : `${escalatedTasks.length} Action(s) Queued (${criticalEscalationsCount} Critical Escalation${criticalEscalationsCount === 1 ? '' : 's'})`,
    executiveVerdict:
      escalatedTasks.length === 0
        ? `Morning sweep complete: no overdue deliveries, statutory payment cliffs, or urgent AMC renewals detected. Average vendor KYC completeness is ${averageKycScorePct}%.`
        : `Morning sweep queued ${escalatedTasks.length} prioritized follow-up(s) (${criticalEscalationsCount} critical). Start with Tier-3 escalations first — all outbound WhatsApp/Email nudges remain safely gated behind 1-click approval.`,
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
      sweepPlan,
      escalatedTasks,
      averageKycScorePct,
      criticalEscalationsCount,
    },
  };
}
