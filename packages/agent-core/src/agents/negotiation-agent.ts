import { formatINR, Paise } from '@kraya/finance-engine';
import {
  buildNegotiationStrategy,
  NegotiationQuoteInput,
  RfqNegotiationAnalysis,
} from '../negotiation.js';
import { buildOutreachPackage, OutreachLanguage } from '../outreach.js';
import { buildRealTimeMarketContext, callGeminiAgentBrain } from '../realtime-context.js';
import type {
  AgentRuntimeConfig,
  ConditionEvaluation,
  ProposedAgentAction,
  RiskLevel,
  SpecialistAgentReport,
  WhatIfScenario,
  WorkspaceLiveMemory,
} from './types.js';

export type NegotiationPosture =
  | 'anchor_to_batna'
  | 'early_pay_discount_swap'
  | 'volume_consolidation'
  | 'freight_absorption'
  | 'incumbent_loyalty_challenge'
  | 'split_award_leverage'
  | 're_source_no_batna';

export interface NegotiationAgentInput {
  rfqTitle: string;
  quotes: NegotiationQuoteInput[];
  preferredLanguage?: OutreachLanguage;
  historicalBenchmarkPaise?: Paise | null;
  urgencyDays?: number | null;
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface NegotiationAgentData {
  analysis: RfqNegotiationAnalysis;
  recommendedPosture: NegotiationPosture;
  localizedCounterOffer: {
    language: OutreachLanguage;
    subject: string;
    body: string;
    whatsappUrl: string;
    mailtoUrl: string;
  };
  estimatedTotalNegotiableSavingsPaise: Paise;
}

/**
 * AGENT 4: Game-Theoretic Negotiation & Outreach Mind.
 * Evaluates full leverage state (BATNA spread, single-bid risk, incumbent rate-creep,
 * WACC cash-discount arbitrage, and urgency) and crafts culturally respectful Indian B2B
 * counter-offers across all 6 languages strictly grounded in real numbers (never inventing bids).
 */
export async function runNegotiationAgent(
  input: NegotiationAgentInput
): Promise<SpecialistAgentReport<NegotiationAgentData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const buyer = input.memory.workspace;
  const preferredLang =
    input.preferredLanguage || (buyer.defaultOutreachLang as OutreachLanguage) || 'hinglish';

  const analysis = buildNegotiationStrategy(input.rfqTitle, buyer.legalName, input.quotes);
  const reasoningSteps: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const whatIfScenarios: WhatIfScenario[] = [];
  const proposedActions: ProposedAgentAction[] = [];

  const spreadPct = analysis.spread.spreadPct;
  const quoteCount = analysis.quoteCount;
  const best = analysis.supplierTactics[0];
  const historicalBenchmark = input.historicalBenchmarkPaise ?? null;

  reasoningSteps.push(
    `1. Evaluated ${quoteCount} binding quote(s) for "${input.rfqTitle}": L1 BATNA = ${analysis.batna.supplierName} (${formatINR(analysis.batna.effectiveRatePaise)}/${analysis.unit}), price spread = ${spreadPct}% (${formatINR(analysis.spread.maxOrderSavingsPaise)} across order).`
  );

  // Determine Leverage State & Tactical Posture
  let detectedState = 'tight_spread_commodity';
  let recommendedPosture: NegotiationPosture = 'anchor_to_batna';
  let riskLevel: RiskLevel = 'low';

  const incumbentCreepPct =
    historicalBenchmark && historicalBenchmark > 0
      ? Math.round(((best.currentRatePaise - historicalBenchmark) / historicalBenchmark) * 1000) / 10
      : null;

  if (quoteCount === 1) {
    detectedState = 'monopoly_single_bid';
    recommendedPosture = 're_source_no_batna';
    riskLevel = 'high';
    conditions.push({
      id: 'batna_strength',
      label: 'BATNA / Competing Bid Leverage',
      status: 'fail',
      detail: `Only 1 quote received (${best.supplierName}). Negotiating without a real competing bid weakens leverage — never invent fake competitor quotes (Accio Invariant #4); collect 2 more quotes first or trade early payment for a 2% Cash Discount.`,
      metric: '1 quote (Weak BATNA)',
    });
  } else if (spreadPct >= 10) {
    detectedState = 'wide_spread_high_leverage';
    recommendedPosture = 'anchor_to_batna';
    riskLevel = 'low';
    conditions.push({
      id: 'batna_strength',
      label: 'BATNA / Competing Bid Leverage',
      status: 'pass',
      detail: `Wide ${spreadPct}% spread across ${quoteCount} quotes (${formatINR(analysis.spread.maxOrderSavingsPaise)} gap). Strong leverage to ask L2/L3 to match L1 or ask L1 for a 2–3% closing concession.`,
      metric: `${spreadPct}% spread`,
    });
  } else {
    detectedState = 'tight_spread_commodity';
    recommendedPosture = 'early_pay_discount_swap';
    riskLevel = 'low';
    conditions.push({
      id: 'batna_strength',
      label: 'BATNA / Competing Bid Leverage',
      status: 'info',
      detail: `Tight ${spreadPct}% commodity spread — suppliers are near floor pricing. Shift negotiation from raw unit rate to Cash Discount (2% CD), Freight Absorption (FOR delivery), or Net 45 credit terms.`,
      metric: `${spreadPct}% spread`,
    });
  }

  if (incumbentCreepPct !== null && incumbentCreepPct >= 3) {
    detectedState = 'incumbent_rate_creep';
    recommendedPosture = 'incumbent_loyalty_challenge';
    riskLevel = 'medium';
    conditions.push({
      id: 'historical_rate_anchor',
      label: 'Historical Purchase Rate Anchor',
      status: 'warning',
      detail: `Even L1 rate (${formatINR(best.currentRatePaise)}) is +${incumbentCreepPct}% above your prior verified purchase rate (${formatINR(historicalBenchmark!)}). Anchor counter-offer on your historical bill.`,
      metric: `+${incumbentCreepPct}% vs history`,
    });
  }

  if (input.urgencyDays !== undefined && input.urgencyDays !== null && input.urgencyDays <= 4) {
    detectedState = 'urgent_low_leverage';
    recommendedPosture = 'early_pay_discount_swap';
    riskLevel = 'medium';
    conditions.push({
      id: 'urgency_constraint',
      label: 'Urgent Delivery Window Constraint',
      status: 'warning',
      detail: `Urgent ${input.urgencyDays}-day requirement limits aggressive rate haggling. Prioritize guaranteed dispatch date + offer fast RTGS on GRN for 1.5%–2% discount.`,
    });
  }

  // Cash-Discount vs Credit Swap Check using real workspace WACC
  const l1Input = input.quotes.find((q) => q.supplierId === best.supplierId);
  const l1CreditDays = l1Input?.creditDays ?? 30;
  const cd2Annualized = l1CreditDays > 0 ? Math.round(((2 / 98) * (365 / l1CreditDays)) * 1000) / 10 : 0;
  if (l1CreditDays >= 20 && cd2Annualized > buyer.waccPct) {
    conditions.push({
      id: 'cd_swap_math',
      label: 'Early-Pay Cash Discount Arbitrage Check',
      status: 'pass',
      detail: `Offering immediate payment on delivery for a 2% Cash Discount earns ${cd2Annualized}% annualized vs your ${buyer.waccPct}% WACC — a win-win lever Indian suppliers love.`,
      metric: `${cd2Annualized}% vs ${buyer.waccPct}% WACC`,
    });
    whatIfScenarios.push({
      id: 'whatif_cd_negotiation',
      title: 'Trade Net Credit for 2% Cash Discount on Delivery',
      assumption: `Pay ${best.supplierName} within 48h of GRN in exchange for 2% off ${formatINR(best.currentRatePaise)}`,
      impactSummary: `Cuts unit rate by ${formatINR(Math.round(best.currentRatePaise * 0.02))}/${analysis.unit} and beats your ${buyer.waccPct}% borrowing cost.`,
      financialDeltaPaise: -Math.round(best.currentRatePaise * 0.02 * analysis.quantity),
      recommendation: 'Include "OR 2% CD for immediate RTGS on delivery" as Option B in WhatsApp message.',
    });
  }

  // What-If: Split award if >= 2 quotes
  if (analysis.supplierTactics.length >= 2) {
    const second = analysis.supplierTactics[1];
    whatIfScenarios.push({
      id: 'whatif_match_l1',
      title: `Ask Preferred Vendor (${second.supplierName}) to Match L1`,
      assumption: `${second.supplierName} drops from ${formatINR(second.currentRatePaise)} to target ${formatINR(second.targetCounterRatePaise)}`,
      impactSummary: `Unlocks ${formatINR(second.potentialSavingsPaise)} in direct order savings while keeping a trusted vendor.`,
      financialDeltaPaise: -second.potentialSavingsPaise,
      recommendation: `Send respectful counter-offer anchored strictly on verified ${formatINR(second.targetCounterRatePaise)} target.`,
    });
  }

  // Generate localized 6-language counter-offer package
  const targetTactic = analysis.supplierTactics[analysis.supplierTactics.length > 1 ? 1 : 0];
  const targetQuoteObj = input.quotes.find((q) => q.supplierId === targetTactic.supplierId);
  let localizedCounterOffer = buildOutreachPackage({
    scenario: 'counter_offer',
    language: preferredLang,
    buyerCompany: buyer.legalName,
    supplierName: targetTactic.supplierName,
    supplierPhone: targetQuoteObj?.supplierPhone,
    supplierEmail: targetQuoteObj?.supplierEmail,
    itemDescription: input.rfqTitle,
    quantity: analysis.quantity,
    unit: analysis.unit,
    targetRatePaise: targetTactic.targetCounterRatePaise,
    quotedRatePaise: targetTactic.currentRatePaise,
    creditDays: targetQuoteObj?.creditDays || 30,
  });

  let brainMode: SpecialistAgentReport['brainMode'] = 'neuro_symbolic_deterministic';
  let modelUsed: string | undefined;

  if (input.config?.geminiApiKey && !input.config.skipNetwork) {
    try {
      const refined = await callGeminiAgentBrain<{
        refinedMessage: string;
        tacticalRationale: string;
      }>({
        apiKey: input.config.geminiApiKey,
        model: input.config.geminiModel,
        timeoutMs: 12_000,
        systemPrompt:
          'You are an experienced Indian B2B procurement negotiator. Polish the counter-offer message in the requested language so it sounds respectful, natural, and firm. NEVER invent competitor names or numbers not provided in the prompt. Return strict JSON: {"refinedMessage": string, "tacticalRationale": string}.',
        userPrompt: `Language: ${preferredLang}\nBuyer: ${buyer.legalName}\nSupplier: ${targetTactic.supplierName}\nItem: ${input.rfqTitle} (${analysis.quantity} ${analysis.unit})\nCurrent Quoted Rate: ${formatINR(targetTactic.currentRatePaise)}\nVerified Target Rate: ${formatINR(targetTactic.targetCounterRatePaise)}\nPosture: ${recommendedPosture}\nBase Draft:\n${localizedCounterOffer.body}`,
      });
      if (refined.parsed.refinedMessage?.trim()) {
        localizedCounterOffer = {
          ...localizedCounterOffer,
          body: refined.parsed.refinedMessage.trim(),
        };
        brainMode = 'neuro_symbolic_gemini_live';
        modelUsed = refined.modelUsed;
        reasoningSteps.push(
          `2. Culturally calibrated ${preferredLang} counter-offer via live Gemini (${modelUsed}) anchored strictly to verified target ${formatINR(targetTactic.targetCounterRatePaise)}.`
        );
      }
    } catch {
      reasoningSteps.push(
        `2. Crafted ${preferredLang} counter-offer deterministically with zero invented competitor claims.`
      );
    }
  } else {
    reasoningSteps.push(
      `2. Selected tactical posture "${recommendedPosture}" and drafted respectful ${preferredLang} counter-offer anchored strictly to verified target ${formatINR(targetTactic.targetCounterRatePaise)}.`
    );
  }

  const estimatedTotalNegotiableSavingsPaise = Math.max(
    targetTactic.potentialSavingsPaise,
    best.potentialSavingsPaise
  );

  proposedActions.push({
    id: 'act_send_counter_offer',
    title: `Send Counter-Offer to ${targetTactic.supplierName} (${preferredLang.toUpperCase()})`,
    actionType: 'send_whatsapp',
    requiresHumanApproval: true,
    priority: 'high',
    rationale: `Targets ${formatINR(targetTactic.targetCounterRatePaise)}/${analysis.unit} (potential saving ${formatINR(targetTactic.potentialSavingsPaise)}). Requires 1-click user confirmation before sending.`,
    suggestedPayload: {
      supplierId: targetTactic.supplierId,
      language: preferredLang,
      whatsappUrl: localizedCounterOffer.whatsappUrl,
      body: localizedCounterOffer.body,
    },
  });

  if (quoteCount === 1) {
    proposedActions.push({
      id: 'act_get_competing_bids',
      title: 'Source 2 Competing Bids to Establish Real BATNA',
      actionType: 'create_rfq',
      requiresHumanApproval: true,
      priority: 'high',
      rationale: 'Never bluff fake bids — gather 2 real local quotes to unlock 5–12% genuine leverage.',
    });
  }

  return {
    agentId: 'negotiation',
    agentName: 'Game-Theoretic Negotiation Agent',
    roleTitle: 'BATNA Strategy & Multilingual Counter-Offers',
    brainMode,
    modelUsed,
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates: ['send_gated_counter_offer', 'revised_quote_capture', 'po_approval_gate'],
    riskLevel,
    confidence: quoteCount >= 2 ? 0.94 : 0.78,
    headline: `Posture: ${recommendedPosture.replace(/_/g, ' ').toUpperCase()} — Target Saving ${formatINR(estimatedTotalNegotiableSavingsPaise)}`,
    executiveVerdict: `Anchor on ${analysis.batna.supplierName} (${formatINR(analysis.batna.effectiveRatePaise)}/${analysis.unit} eff.). Counter ${targetTactic.supplierName} at ${formatINR(targetTactic.targetCounterRatePaise)}/${analysis.unit} in ${preferredLang}${l1CreditDays >= 20 && cd2Annualized > buyer.waccPct ? ' or offer immediate payment for a 2% Cash Discount' : ''}.`,
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
      analysis,
      recommendedPosture,
      localizedCounterOffer,
      estimatedTotalNegotiableSavingsPaise,
    },
  };
}
