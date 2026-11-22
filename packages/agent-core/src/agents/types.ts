import type { WorkspaceTaxProfile, Paise } from '@kraya/finance-engine';
import type { RealTimeMarketContext } from '../realtime-context.js';
import type { VerbClass, ProcurementPillar } from '../constitution.js';

export type SpecialistAgentId =
  | 'orchestrator'
  | 'intake'
  | 'sourcing'
  | 'cfo_strategist'
  | 'negotiation'
  | 'auditor'
  | 'compliance'
  | 'operations';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ConditionEvaluation {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'info';
  detail: string;
  metric?: string;
  statutoryRef?: string;
}

export interface WhatIfScenario {
  id: string;
  title: string;
  assumption: string;
  impactSummary: string;
  financialDeltaPaise?: Paise;
  recommendation: string;
}

export interface ProposedAgentAction {
  id: string;
  title: string;
  actionType:
    | 'verify_fields'
    | 'create_rfq'
    | 'approve_po'
    | 'send_whatsapp'
    | 'send_email'
    | 'hold_payment'
    | 'reject_ims'
    | 'request_credit_note'
    | 'release_msme_payment'
    | 'verify_gstin_live'
    | 'split_order'
    | 'run_gstr2b'
    | 'escalate_delivery'
    | 'renew_amc'
    | 'no_action';
  requiresHumanApproval: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  rationale: string;
  suggestedPayload?: Record<string, unknown>;
}

export interface SpecialistAgentReport<TData = Record<string, unknown>> {
  agentId: SpecialistAgentId;
  agentName: string;
  roleTitle: string;
  brainMode: 'neuro_symbolic_gemini_live' | 'neuro_symbolic_deterministic';
  modelUsed?: string;
  timestamp: string;
  detectedState: string;
  possibleNextStates: string[];
  riskLevel: RiskLevel;
  confidence: number; // 0.0 - 1.0
  headline: string;
  executiveVerdict: string;
  reasoningSteps: string[];
  conditionsEvaluated: ConditionEvaluation[];
  whatIfScenarios: WhatIfScenario[];
  proposedActions: ProposedAgentAction[];
  groundingSources?: Array<{ title: string; uri: string }>;
  realTimeContextUsed: {
    usdInr: number;
    financialYear: string;
    daysToMarch31TaxCliff: number;
    isMarch31MsmeRedZone: boolean;
  };
  structuredData?: TData;
}

export interface WorkspaceLiveMemory {
  workspace: WorkspaceTaxProfile & {
    id: string;
    defaultOutreachLang?: string;
    policyPatchMd?: string | null;
    businessAddress?: string | null;
  };
  suppliers: Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    category: string | null;
    gstin: string | null;
    stateCode: string | null;
    gstRegime: string;
    panEntityType: string | null;
    udyamTier: string;
    eInvoiceRequired: boolean;
    creditDays: number;
    reliabilityScore: number;
  }>;
  rfqs: Array<{
    id: string;
    rfqNumber: string;
    title: string;
    status: string;
    quoteCount: number;
    createdAt: Date | string;
  }>;
  purchaseOrders: Array<{
    id: string;
    poNumber: string;
    supplierId: string;
    supplierName?: string;
    totalPaise: number;
    paymentTermsDays: number;
    deliveryDueAt: string;
    invoiceStatus: string;
    revisionNumber: number;
    cancelledAt: Date | string | null;
    hasFullGrn?: boolean;
  }>;
  invoices: Array<{
    id: string;
    poId: string | null;
    supplierId: string;
    supplierName?: string;
    supplierGstin?: string | null;
    invoiceNumber: string;
    invoiceDate: string;
    taxablePaise: number;
    gstPaise: number;
    grandTotalPaise: number;
    poMatchStatus: string;
    imsSuggestedAction: string;
    totalMoneyLeakPaise: number;
    msme43bhDueAt: string | null;
    rule37CliffAt: string | null;
    paidAt: Date | string | null;
  }>;
  moneyLeaks: Array<{
    id: string;
    leakType: string;
    title: string;
    amountPaise: number;
    status: string;
    supplierId: string | null;
  }>;
  amcs: Array<{
    id: string;
    assetName: string;
    supplierId: string | null;
    supplierName?: string | null;
    nextDueAt: string;
    status: string;
  }>;
  openTasks: Array<{
    id: string;
    kind: string;
    title: string;
    priority: string;
    dueAt: string;
    relatedId: string | null;
    supplierId: string | null;
  }>;
  priceHistoryCount: number;
  totalAnnualSpendPaise: number;
}

export interface AgentRuntimeConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  googleMapsApiKey?: string;
  openCorporatesApiKey?: string;
  serperApiKey?: string;
  tavilyApiKey?: string;
  gstnProvider?: string;
  gstnApiKey?: string;
  gstnApiUrl?: string;
  skipNetwork?: boolean;
  realTimeContext?: RealTimeMarketContext;
}

export interface AgentFleetProfile {
  agentId: SpecialistAgentId;
  agentName: string;
  stepNumber: number;
  stepName: string;
  roleTitle: string;
  primarySkills: string[];
  statesHandled: string[];
  realTimeSignals: string[];
  invariantsEnforced: string[];
}

export interface OrchestratorRoutingDecision {
  verbClass: VerbClass;
  pillar: ProcurementPillar;
  primaryAgent: SpecialistAgentId;
  supportingAgents: SpecialistAgentId[];
  detectedPromptInjection: boolean;
  requiresApprovalGate: boolean;
}

export const KRAYA_AGENT_FLEET: AgentFleetProfile[] = [
  {
    agentId: 'orchestrator',
    agentName: 'Kraya Chief Orchestrator',
    stepNumber: 0,
    stepName: 'Master Routing & Invariant Firewall',
    roleTitle: 'Multi-Agent Coordinator & Accio Constitution Guard',
    primarySkills: ['verb-respect', 'intent-routing', 'approval-gating', 'prompt-injection-firewall'],
    statesHandled: ['read_only_analysis', 'draft_construction', 'diagnostic_investigation', 'gated_execution', 'security_threat_blocked'],
    realTimeSignals: ['Live Workspace Memory', 'Indian FY & GST Calendar', 'Live FX Benchmarks'],
    invariantsEnforced: ['Verb Respect', 'Gate Consequence', 'Content is Data', 'Zero Invented Data'],
  },
  {
    agentId: 'intake',
    agentName: 'Intake & Document Forensics Agent',
    stepNumber: 1,
    stepName: 'Multi-Source Capture & OCR Verification',
    roleTitle: 'Multimodal Extraction, Math Self-Audit & Hinglish Normalizer',
    primarySkills: ['intake-forensics', 'hinglish-shorthand', 'bom-indent-parsing', 'self-verifying-ocr'],
    statesHandled: ['clean_quote', 'ambiguous_hinglish_quote', 'clean_invoice', 'math_mismatch_invoice', 'handwritten_parchi_low_conf', 'new_rfq_request', 'bom_table', 'maintenance_or_followup', 'prompt_injection_blocked'],
    realTimeSignals: ['Gemini Multimodal Vision', 'VoiceStudio / ElevenLabs / Groq ASR', 'Deterministic Math Reconciler'],
    invariantsEnforced: ['Evidence Separation', 'Missing Input != Invented Input', 'LLM Never Does Arithmetic'],
  },
  {
    agentId: 'sourcing',
    agentName: 'Real-Time Sourcing Intelligence Agent',
    stepNumber: 2,
    stepName: 'Supplier Discovery & Dual-Sourcing Strategy',
    roleTitle: 'Live Market Scout, Geo-Logistics & Registry Verifier',
    primarySkills: ['supplier-sourcing', 'geo-logistics', 'dual-sourcing-risk'],
    statesHandled: ['local_intra_state_optimal', 'inter_state_freight_tradeoff', 'single_source_risk', 'urgent_lead_time_crunch', 'msme_43bh_cash_impact', 'import_fx_parity_alert', 'low_verified_supply'],
    realTimeSignals: ['Gemini Google Search Grounding', 'Live USD/INR FX', 'Google Maps / OSM OSRM Distance', 'GLEIF & Live GSTN'],
    invariantsEnforced: ['Explicit Assumptions', 'Verified Registry Separation', 'Gated Outreach'],
  },
  {
    agentId: 'cfo_strategist',
    agentName: 'CFO Landed-Cost Strategist Agent',
    stepNumber: 3,
    stepName: 'True Cash-Adjusted Quote Evaluation',
    roleTitle: 'Working-Capital, GST 2.0 ITC & Cash-Discount Arbitrage Mind',
    primarySkills: ['indian-landed-cost', 'wacc-arbitrage', 'msme-43bh-modeling'],
    statesHandled: ['clear_l1_winner', 'composition_trap_detected', 'cash_discount_arbitrage_win', 'msme_43bh_cap_distortion', 'price_creep_alert', 'reliability_vs_price_tradeoff', 'incomplete_quotes_pending'],
    realTimeSignals: ['Buyer Live WACC %', 'March 31 43B(h) Red Zone', 'Workspace Price History'],
    invariantsEnforced: ['Integer Paise Precision', 'Zero Hidden Normalization Assumptions', 'What-If Transparency'],
  },
  {
    agentId: 'negotiation',
    agentName: 'Game-Theoretic Negotiation Agent',
    stepNumber: 4,
    stepName: 'BATNA Strategy & Multilingual Counter-Offers',
    roleTitle: 'Indian B2B Relationship-Preserving Deal Maker',
    primarySkills: ['vendor-negotiation', 'batna-modeling', 'multilingual-outreach'],
    statesHandled: ['wide_spread_high_leverage', 'tight_spread_commodity', 'monopoly_single_bid', 'incumbent_rate_creep', 'early_pay_discount_swap', 'credit_extension_play', 'urgent_low_leverage'],
    realTimeSignals: ['Competing Live Quotes', 'Price History Benchmark', 'WACC Cash-Discount Breakeven'],
    invariantsEnforced: ['Never Invent Competitor Bids', 'Culturally Respectful Tone', '1-Click Approval Gate'],
  },
  {
    agentId: 'auditor',
    agentName: 'PO Governance & 3-Way Match Auditor Agent',
    stepNumber: 5,
    stepName: 'PO Lifecycle, GRN Guard & Money Leak Radar',
    roleTitle: 'Forensic Pre-Payment Shield & Dispute Recovery Specialist',
    primarySkills: ['money-leak-audit', 'gst-po-generator', 'grn-3way-match', 'tds-194c-194q'],
    statesHandled: ['clean_ready_to_pay', 'po_rate_or_qty_leak', 'grn_short_delivery_block', 'gst_tax_split_or_slab_error', 'missing_irn_itc_blocker', 'composition_tax_fraud', 'freight_double_gst_leak', 'arithmetic_mismatch'],
    realTimeSignals: ['Live GSTN Status', 'PO + GRN Ledger', 'GST 2.0 Slab Matrix', 'Price History'],
    invariantsEnforced: ['100% Real Rupee Leaks', 'Exact Statutory References', 'Hold Payment Before Leak Leaves Bank'],
  },
  {
    agentId: 'compliance',
    agentName: 'GST 2.0, GSTR-2B & Tax Shield Agent',
    stepNumber: 6,
    stepName: 'Statutory Compliance, IMS & March 31 Defense',
    roleTitle: 'Indian Indirect/Direct Tax Guardrail & CA Pack Strategist',
    primarySkills: ['gst-compliance-shield', 'gstr2b-ims-reconciliation', 'section-43bh-defense', 'rule37-180d-watch'],
    statesHandled: ['fully_compliant', 'march31_43bh_emergency', 'ims_itc_at_risk', 'rule37_reversal_imminent', 'tds_deduction_required', 'audit_chain_alert'],
    realTimeSignals: ['Live Indian FY Clock', 'GSTR-1/2B/3B Monthly Deadlines', 'RBI 3x MSME Interest Rate'],
    invariantsEnforced: ['CA Verification Disclaimer', 'Tamper-Evident SHA-256 Chain', 'DPDP Act 2023 Safeguards'],
  },
  {
    agentId: 'operations',
    agentName: 'Autonomous Procurement Operations Agent',
    stepNumber: 7,
    stepName: 'Proactive Morning Sweep & Tiered Escalations',
    roleTitle: 'Autonomous Purchase Expeditor, KYC Officer & AMC Planner',
    primarySkills: ['autonomous-operations', 'tiered-escalation', 'amc-preventive-watch', 'vendor-kyc-scoring'],
    statesHandled: ['calm_steady_state', 'routine_followups_queued', 'delivery_escalation_needed', 'statutory_cliff_urgent', 'kyc_hygiene_gap'],
    realTimeSignals: ['Daily Morning Cron (8 AM IST)', 'Open RFQs/POs/GRNs/Invoices/AMCs', 'Supplier KYC Completeness'],
    invariantsEnforced: ['Deduplicated Task Queue', 'Escalation Ladder Discipline', 'Zero Silent Outbound Sends'],
  },
];
