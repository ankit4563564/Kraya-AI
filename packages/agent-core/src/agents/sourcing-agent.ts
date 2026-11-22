import { formatINR, toPaise } from '@kraya/finance-engine';
import {
  searchSuppliersRealtime,
  RealtimeSupplierCriteria,
  SupplierDiscoveryResult,
} from '../supplier-search.js';
import {
  searchLiveBusinessDirectory,
  LiveDirectoryBusiness,
} from '../connectors/places-directory.js';
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

export interface SourcingAgentInput {
  criteria: RealtimeSupplierCriteria;
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface SourcingAgentData {
  discovery: SupplierDiscoveryResult;
  liveDirectoryBusinesses: LiveDirectoryBusiness[];
  liveDirectoryProvider: string;
  dualSourcingRecommended: boolean;
  localVendorCount: number;
  interStateVendorCount: number;
  msmeVendorCount: number;
  liveWebIntelligenceSummary?: string;
}

/**
 * AGENT 2: Real-Time Sourcing & Supplier Intelligence Mind.
 * Combines live FX benchmarks, Gemini Google Search Grounding (when API key active),
 * OpenStreetMap/Google Maps road distance, GLEIF/GSTIN checks, and workspace supplier history
 * to evaluate dual-sourcing risk, intra-vs-inter-state logistics, and 43B(h) cash impact.
 */
export async function runSourcingIntelligenceAgent(
  input: SourcingAgentInput
): Promise<SpecialistAgentReport<SourcingAgentData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const buyerStateCode = input.criteria.buyerStateCode || input.memory.workspace.stateCode || '29';
  const buyerWaccPct = input.criteria.buyerWaccPct ?? input.memory.workspace.waccPct ?? 15;

  const [discovery, liveDirectory] = await Promise.all([
    searchSuppliersRealtime(
      {
        ...input.criteria,
        buyerStateCode,
        buyerWaccPct,
        googleMapsApiKey: input.config?.googleMapsApiKey,
        openCorporatesApiKey: input.config?.openCorporatesApiKey,
      },
      input.config?.skipNetwork ? undefined : input.config?.geminiApiKey,
      input.config?.geminiModel
    ),
    input.config?.skipNetwork
      ? Promise.resolve({
          providerUsed: 'none_configured' as const,
          businesses: [] as LiveDirectoryBusiness[],
          queryUsed: input.criteria.query,
        })
      : searchLiveBusinessDirectory({
          query: input.criteria.query,
          city: input.criteria.buyerCity,
          googleMapsApiKey: input.config?.googleMapsApiKey,
          serperApiKey: input.config?.serperApiKey,
          tavilyApiKey: input.config?.tavilyApiKey,
        }),
  ]);

  const reasoningSteps: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const whatIfScenarios: WhatIfScenario[] = [];
  const proposedActions: ProposedAgentAction[] = [];

  const suppliers = discovery.suppliers;
  const localVendors = suppliers.filter((s) => s.taxRouting === 'intra_state');
  const interStateVendors = suppliers.filter((s) => s.taxRouting === 'inter_state');
  const msmeVendors = suppliers.filter((s) => s.udyamTier === 'micro' || s.udyamTier === 'small');
  const validGstinVendors = suppliers.filter((s) => s.gstinValid);

  // Check if workspace already has suppliers in this category
  const existingCategorySuppliers = input.memory.suppliers.filter((s) =>
    (s.category || '').toLowerCase().includes((input.criteria.category || input.criteria.query).toLowerCase().slice(0, 6))
  );

  reasoningSteps.push(
    `1. Evaluated sourcing brief "${input.criteria.query}" for Buyer State ${buyerStateCode} (WACC ${buyerWaccPct}%, live USD/INR ₹${ctx.fx.usdInr}).`
  );
  reasoningSteps.push(
    `2. Discovered ${suppliers.length} candidate vendor(s) via ${discovery.engine}: ${localVendors.length} intra-state (CGST+SGST), ${interStateVendors.length} inter-state (IGST), ${msmeVendors.length} Micro/Small MSME (43B-h regulated).`
  );

  // Optional live Google Search Grounding market check when Gemini key is available
  let liveWebIntelligenceSummary: string | undefined;
  let groundingSources: Array<{ title: string; uri: string }> = [];
  let brainMode: SpecialistAgentReport['brainMode'] =
    discovery.engine === 'gemini_flash_grounded'
      ? 'neuro_symbolic_gemini_live'
      : 'neuro_symbolic_deterministic';
  let modelUsed = discovery.engine === 'gemini_flash_grounded' ? input.config?.geminiModel || 'gemini-2.5-flash' : undefined;

  if (input.config?.geminiApiKey && !input.config.skipNetwork) {
    try {
      const liveBrief = await callGeminiAgentBrain<{
        commodityTrendSummary: string;
        supplyRiskNote: string;
      }>({
        apiKey: input.config.geminiApiKey,
        model: input.config.geminiModel,
        enableGoogleSearchGrounding: true,
        timeoutMs: 12_000,
        systemPrompt:
          'You are an Indian industrial sourcing market analyst. Return strict JSON with keys "commodityTrendSummary" and "supplyRiskNote". Keep factual, concise (max 2 sentences each), anchored in current Indian market conditions.',
        userPrompt: `What is the current Indian B2B market supply and price trend for "${input.criteria.query}" (HSN ${discovery.marketAnalysis.hsnSacSuggested}) near ${input.criteria.buyerCity || 'India'} with USD/INR at ₹${ctx.fx.usdInr}?`,
      });
      liveWebIntelligenceSummary = `${liveBrief.parsed.commodityTrendSummary} ${liveBrief.parsed.supplyRiskNote}`.trim();
      groundingSources = liveBrief.groundingSources;
      brainMode = 'neuro_symbolic_gemini_live';
      modelUsed = liveBrief.modelUsed;
      reasoningSteps.push(
        `3. Grounded live web commodity intelligence via Google Search (${groundingSources.length} web citation(s)).`
      );
    } catch {
      reasoningSteps.push(
        '3. Live web grounding unavailable/timed out; relying on deterministic FX, road-distance, and GSTN heuristics.'
      );
    }
  } else {
    reasoningSteps.push(
      `3. Using live FX benchmark (₹${ctx.fx.usdInr}/USD) + OSM/Geo road routing + GSTIN structural validation.`
    );
  }

  // Evaluate Conditions
  conditions.push({
    id: 'gstin_checksum_coverage',
    label: 'GSTIN Structural Verification Coverage',
    status: validGstinVendors.length === suppliers.length && suppliers.length > 0 ? 'pass' : 'warning',
    detail: `${validGstinVendors.length}/${suppliers.length} discovered suppliers pass offline GSTIN Mod-36 checksum. Run Live GSTN Verify before issuing POs.`,
    metric: `${validGstinVendors.length}/${suppliers.length} valid`,
  });

  conditions.push({
    id: 'intra_vs_inter_state_logistics',
    label: 'Intra-State vs Inter-State Freight & Tax Routing',
    status: localVendors.length > 0 ? 'pass' : 'warning',
    detail:
      localVendors.length > 0
        ? `${localVendors.length} local intra-state supplier(s) available (lower freight + faster replenishment, CGST+SGST).`
        : 'All candidates are inter-state (IGST) — verify e-Way Bill threshold (>₹50,000) and transit buffer days.',
    metric: `${localVendors.length} local / ${interStateVendors.length} inter-state`,
  });

  if (msmeVendors.length > 0) {
    conditions.push({
      id: 'msme_43bh_sourcing_impact',
      label: 'MSME Section 43B(h) Working Capital Check',
      status: ctx.regulatoryClock.isMarch31MsmeRedZone ? 'warning' : 'info',
      detail: `${msmeVendors.length} candidate(s) are Micro/Small MSMEs (45-day hard legal ceiling with written PO).${ctx.regulatoryClock.isMarch31MsmeRedZone ? ` MARCH 31 RED ZONE (${ctx.regulatoryClock.daysToMarch31TaxCliff}d left): ensure cash liquidity before awarding!` : ''}`,
      statutoryRef: 'Section 43B(h) Income Tax Act',
    });
  }

  const dualSourcingRecommended =
    suppliers.length >= 2 &&
    ((input.criteria.urgencyDays !== undefined && input.criteria.urgencyDays <= 5) ||
      existingCategorySuppliers.length <= 1);

  conditions.push({
    id: 'concentration_dual_sourcing',
    label: 'Single-Vendor Dependency & Dual-Sourcing Check',
    status: dualSourcingRecommended ? 'warning' : 'pass',
    detail: dualSourcingRecommended
      ? `Only ${existingCategorySuppliers.length} incumbent vendor(s) in this category or tight urgency (${input.criteria.urgencyDays ?? 'standard'}d). Recommend 70/30 dual-sourcing split.`
      : `Healthy vendor pool (${existingCategorySuppliers.length} existing + ${suppliers.length} new leads).`,
  });

  if (ctx.fx.usdInr >= 85) {
    conditions.push({
      id: 'fx_import_parity',
      label: 'Import Parity & FX Pressure (USD/INR)',
      status: 'info',
      detail: `USD/INR is at ₹${ctx.fx.usdInr}. Polymer, electronics, chemical, and metal quotes linked to imported feedstock face upward rate-revision risk — lock 30-day rate validity in PO.`,
      metric: `₹${ctx.fx.usdInr}/USD`,
    });
  }

  // Determine exact state
  let detectedState = 'local_intra_state_optimal';
  let riskLevel: RiskLevel = 'low';

  if (suppliers.length === 0) {
    detectedState = 'low_verified_supply';
    riskLevel = 'high';
  } else if (input.criteria.urgencyDays !== undefined && input.criteria.urgencyDays <= 4) {
    detectedState = 'urgent_lead_time_crunch';
    riskLevel = 'high';
  } else if (msmeVendors.length === suppliers.length && ctx.regulatoryClock.isMarch31MsmeRedZone) {
    detectedState = 'msme_43bh_cash_impact';
    riskLevel = 'medium';
  } else if (localVendors.length === 0) {
    detectedState = 'inter_state_freight_tradeoff';
    riskLevel = 'medium';
  } else if (dualSourcingRecommended) {
    detectedState = 'single_source_risk';
    riskLevel = 'medium';
  }

  const best = [...suppliers].sort((a, b) => a.creditAdjustedRate - b.creditAdjustedRate)[0];
  const runnerUp = [...suppliers].sort((a, b) => a.creditAdjustedRate - b.creditAdjustedRate)[1];

  if (best && runnerUp) {
    const gapPaise = Math.max(0, toPaise(runnerUp.creditAdjustedRate - best.creditAdjustedRate));
    whatIfScenarios.push({
      id: 'whatif_dual_source',
      title: '70/30 Dual-Sourcing Insurance vs 100% Single Vendor',
      assumption: `Award 70% to ${best.businessName} (L1) and 30% to ${runnerUp.businessName} (L2)`,
      impactSummary: `Adds only ${formatINR(Math.round(gapPaise * 0.3))}/unit blended cost while cutting factory stockout risk and preserving bargaining power on future reorders.`,
      financialDeltaPaise: Math.round(gapPaise * 0.3 * (best.moq || 100)),
      recommendation: dualSourcingRecommended
        ? 'Strongly recommended for production-critical items.'
        : 'Optional unless L1 lead time exceeds requirement.',
    });
  }

  if (best) {
    proposedActions.push({
      id: 'act_verify_top_gstin',
      title: `Live GSTN Verify ${best.businessName} (${best.gstin})`,
      actionType: 'verify_gstin_live',
      requiresHumanApproval: false,
      priority: 'high',
      rationale: 'Confirm Active vs Cancelled/Composition status on GSTN before floating formal PO.',
      suggestedPayload: { gstin: best.gstin, supplierName: best.businessName },
    });
    proposedActions.push({
      id: 'act_float_rfq_top3',
      title: `Send WhatsApp / Email RFQ to Top ${Math.min(3, suppliers.length)} Shortlisted Vendors`,
      actionType: 'send_whatsapp',
      requiresHumanApproval: true,
      priority: 'high',
      rationale: `Solicit written binding quotes (with HSN, GST %, freight terms, and Net credit days) to trigger competitive BATNA bidding.`,
    });
  }

  return {
    agentId: 'sourcing',
    agentName: 'Real-Time Sourcing Intelligence Agent',
    roleTitle: 'Live Market Scout, Geo-Logistics & Registry Verifier',
    brainMode,
    modelUsed,
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates: ['live_gstn_verification', 'rfq_outreach', 'cfo_landed_cost_comparison'],
    riskLevel,
    confidence: discovery.engine === 'gemini_flash_grounded' ? 0.88 : 0.76,
    headline: best
      ? `Top Lead: ${best.businessName} (Est. ₹${best.creditAdjustedRate}/unit credit-adj, ${best.distanceKmEstimate} km)`
      : `Sourcing Search Completed (${suppliers.length} leads)`,
    executiveVerdict: best
      ? `${best.businessName} leads on credit-adjusted economics (est. ₹${best.creditAdjustedRate}/unit with Net ${best.typicalCreditDays}d terms, ${best.taxRouting.replace('_', ' ')}). ${dualSourcingRecommended ? 'Float RFQs to top 3 leads and qualify L2 as a 30% backup to prevent single-vendor lock-in.' : 'Float binding RFQs to confirm exact rates and verify GSTN live before ordering.'}${liveWebIntelligenceSummary ? ` Live market signal: ${liveWebIntelligenceSummary}` : ''}`
      : 'No matching suppliers returned; broaden pincode radius or relax target rate cap.',
    reasoningSteps,
    conditionsEvaluated: conditions,
    whatIfScenarios,
    proposedActions,
    groundingSources: groundingSources.length > 0 ? groundingSources : undefined,
    realTimeContextUsed: {
      usdInr: ctx.fx.usdInr,
      financialYear: ctx.regulatoryClock.financialYear,
      daysToMarch31TaxCliff: ctx.regulatoryClock.daysToMarch31TaxCliff,
      isMarch31MsmeRedZone: ctx.regulatoryClock.isMarch31MsmeRedZone,
    },
    structuredData: {
      discovery,
      liveDirectoryBusinesses: liveDirectory.businesses,
      liveDirectoryProvider: liveDirectory.providerUsed,
      dualSourcingRecommended,
      localVendorCount: localVendors.length,
      interStateVendorCount: interStateVendors.length,
      msmeVendorCount: msmeVendors.length,
      liveWebIntelligenceSummary,
    },
  };
}
