import { classifyProcurementIntake } from '../constitution.js';
import { buildRealTimeMarketContext } from '../realtime-context.js';
import { runIntakeForensicsAgent } from './intake-agent.js';
import { runComplianceTaxShieldAgent } from './compliance-agent.js';
import { runAutonomousOperationsAgent } from './operations-agent.js';
import { runSourcingIntelligenceAgent } from './sourcing-agent.js';
import type {
  AgentRuntimeConfig,
  ConditionEvaluation,
  OrchestratorRoutingDecision,
  ProposedAgentAction,
  RiskLevel,
  SpecialistAgentId,
  SpecialistAgentReport,
  WorkspaceLiveMemory,
} from './types.js';

export interface OrchestratorInput {
  promptText: string;
  channel?: string;
  fileName?: string | null;
  fileMime?: string | null;
  mediaBase64?: string;
  transcriptText?: string | null;
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface OrchestratorData {
  routing: OrchestratorRoutingDecision;
  specialistReports: SpecialistAgentReport<unknown>[];
}

/**
 * AGENT 0: Kraya Chief Orchestrator Mind.
 * Enforces Accio's 14 Invariants (Verb Respect, Gate Consequence, Prompt Injection Firewall),
 * inspects full live workspace memory + real-time Indian market/regulatory context,
 * dispatches the right Specialist Agent(s), and synthesizes a unified command verdict.
 */
export async function runOrchestratorAgent(
  input: OrchestratorInput
): Promise<SpecialistAgentReport<OrchestratorData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const text = (input.promptText || '').trim();
  const hasAttachment = Boolean(input.mediaBase64 || input.fileName);
  const intake = classifyProcurementIntake(text || input.fileName || '', hasAttachment);

  // Route to the right primary + supporting specialist agents
  let primaryAgent: SpecialistAgentId = 'intake';
  const supportingAgents: SpecialistAgentId[] = [];

  if (/\b(gstr|2b|ims|43b|rule\s*37|tds|194c|194q|tax\s*shield|compliance|audit\s*chain)\b/i.test(text)) {
    primaryAgent = 'compliance';
    supportingAgents.push('operations');
  } else if (/\b(sweep|morning|daily\s*ops|escalat|kyc|overdue|chase|amc|maintenance)\b/i.test(text)) {
    primaryAgent = 'operations';
    supportingAgents.push('compliance');
  } else if (/\b(find\s+supplier|discover|source|new\s+vendor|manufacturers?\s+near|search\s+vendor)\b/i.test(text) && !hasAttachment) {
    primaryAgent = 'sourcing';
    supportingAgents.push('compliance');
  } else if (intake.pillar === 'invoice_audit') {
    primaryAgent = 'intake';
    supportingAgents.push('compliance');
  } else {
    primaryAgent = 'intake';
  }

  const routing: OrchestratorRoutingDecision = {
    verbClass: intake.verbClass,
    pillar: intake.pillar,
    primaryAgent,
    supportingAgents,
    detectedPromptInjection: intake.detectedPromptInjection,
    requiresApprovalGate: intake.requiresApprovalGate,
  };

  const sharedConfig: AgentRuntimeConfig = {
    ...input.config,
    realTimeContext: ctx,
  };

  const specialistReports: SpecialistAgentReport<unknown>[] = [];

  if (primaryAgent === 'compliance') {
    specialistReports.push(
      await runComplianceTaxShieldAgent({ memory: input.memory, config: sharedConfig })
    );
  } else if (primaryAgent === 'operations') {
    specialistReports.push(
      await runAutonomousOperationsAgent({ memory: input.memory, config: sharedConfig })
    );
  } else if (primaryAgent === 'sourcing') {
    specialistReports.push(
      await runSourcingIntelligenceAgent({
        criteria: {
          query: text,
          buyerStateCode: input.memory.workspace.stateCode,
          buyerWaccPct: input.memory.workspace.waccPct,
        },
        memory: input.memory,
        config: sharedConfig,
      })
    );
  } else {
    specialistReports.push(
      await runIntakeForensicsAgent({
        promptText: text,
        channel: input.channel || 'manual',
        fileName: input.fileName,
        fileMime: input.fileMime,
        mediaBase64: input.mediaBase64,
        transcriptText: input.transcriptText,
        memory: input.memory,
        config: sharedConfig,
      })
    );
  }

  // Attach proactive compliance watch if we are in March 31 Red Zone or supporting compliance requested
  if (
    primaryAgent !== 'compliance' &&
    (supportingAgents.includes('compliance') || ctx.regulatoryClock.isMarch31MsmeRedZone)
  ) {
    specialistReports.push(
      await runComplianceTaxShieldAgent({ memory: input.memory, config: sharedConfig })
    );
  }

  const primaryReport = specialistReports[0];
  const conditions: ConditionEvaluation[] = [
    {
      id: 'accio_verb_respect',
      label: `Verb Respect Gate (${intake.verbClass.toUpperCase()})`,
      status: intake.requiresApprovalGate ? 'warning' : 'pass',
      detail: intake.requiresApprovalGate
        ? 'Write/Outbound verb detected — all external sends and PO commitments remain strictly gated behind 1-click human approval.'
        : `Non-destructive "${intake.verbClass}" intent — safe to analyze without mutating external commitments.`,
      statutoryRef: 'Accio Invariant #1 & #3',
    },
    ...primaryReport.conditionsEvaluated,
  ];

  const allProposedActions: ProposedAgentAction[] = specialistReports.flatMap(
    (r) => r.proposedActions
  );

  const highestRiskOrder: Record<RiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  let riskLevel: RiskLevel = primaryReport.riskLevel;
  for (const r of specialistReports) {
    if (highestRiskOrder[r.riskLevel] > highestRiskOrder[riskLevel]) {
      riskLevel = r.riskLevel;
    }
  }
  if (intake.detectedPromptInjection) riskLevel = 'critical';

  const detectedState = intake.detectedPromptInjection
    ? 'security_threat_blocked'
    : intake.requiresApprovalGate
      ? 'gated_execution'
      : intake.verbClass === 'diagnose'
        ? 'diagnostic_investigation'
        : intake.verbClass === 'construct'
          ? 'draft_construction'
          : 'read_only_analysis';

  const reasoningSteps = [
    `0. Orchestrator analyzed prompt under Accio Constitution: verb="${intake.verbClass}", pillar="${intake.pillar}", primary specialist="${primaryAgent}", supporting=[${supportingAgents.join(', ')}].`,
    ...primaryReport.reasoningSteps,
  ];

  return {
    agentId: 'orchestrator',
    agentName: 'Kraya Chief Orchestrator',
    roleTitle: 'Multi-Agent Coordinator & Accio Constitution Guard',
    brainMode: primaryReport.brainMode,
    modelUsed: primaryReport.modelUsed,
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates: primaryReport.possibleNextStates,
    riskLevel,
    confidence: primaryReport.confidence,
    headline: primaryReport.headline,
    executiveVerdict: primaryReport.executiveVerdict,
    reasoningSteps,
    conditionsEvaluated: conditions,
    whatIfScenarios: specialistReports.flatMap((r) => r.whatIfScenarios),
    proposedActions: allProposedActions,
    groundingSources: primaryReport.groundingSources,
    realTimeContextUsed: primaryReport.realTimeContextUsed,
    structuredData: {
      routing,
      specialistReports,
    },
  };
}
