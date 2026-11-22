import { ComplianceFlag, formatINR, OutreachPackage, SummaryStats } from './api';
import { OutreachModalRequest } from '../components/OutreachModal';

export type NavTab = 'new_task' | 'inbox' | 'buying' | 'daily' | 'suppliers';

export type WorkflowStageId =
  | 'source_rfq'
  | 'collect_quotes'
  | 'negotiate_po'
  | 'receive_track'
  | 'audit_settle';

export interface GuidedPromptExample {
  id: string;
  label: string;
  prompt: string;
  channel: string;
  badge?: string;
}

export interface WorkflowStageDef {
  stepNumber: 1 | 2 | 3 | 4 | 5;
  id: WorkflowStageId;
  shortTitle: string;
  title: string;
  oneLiner: string;
  nextStageHint: string;
  primaryTab: NavTab;
  channel: string;
  defaultPrompt: string;
  examples: GuidedPromptExample[];
}

export interface IngestResponse {
  intake: {
    verbClass: string;
    pillar: string;
    requiresApprovalGate: boolean;
    detectedPromptInjection: boolean;
    rationale: string;
  };
  sourceEvent: {
    id: string;
    channel: string;
    parsedSummary: string;
    needsVerification: boolean;
    confidenceScore: number;
  };
  extracted: {
    engine: string;
    documentKind: string;
    supplierName: string | null;
    summary: string;
    missingFields: string[];
    needsVerification: boolean;
    evidence: Array<{
      field: string;
      value: unknown;
      confidence: number;
      evidenceQuote: string;
    }>;
  };
  created: {
    rfq?: { id: string; rfqNumber: string; title: string };
    quote?: { id: string; netLandedUnitPaise: number; creditAdjustedUnitPaise: number };
    landedCost?: { flags: ComplianceFlag[]; normalizationNote: string };
    audit?: {
      cfoVerdict: string;
      imsSuggestedAction: string;
      totalMoneyLeakPaise: number;
      flags: ComplianceFlag[];
    };
    task?: { id: string; title: string; dueAt: string };
    pendingVerificationReason?: string;
  };
  suggestedOutreach: OutreachPackage | null;
  asrNote: string | null;
  agentReport?: {
    agentId: string;
    agentName: string;
    detectedState: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    headline: string;
    executiveVerdict: string;
    reasoningSteps: string[];
  } | null;
}

export interface GlobalWorkflowTools {
  onNavigate: (tab: NavTab) => void;
  onOpenOutreach: (req: OutreachModalRequest) => void;
  onOpenDiscover: (initialQuery?: string) => void;
  onOpenBomImport: (initialCsvText?: string) => void;
  onOpenGstr2b: () => void;
  onOpenNegotiation: (rfqId?: string) => Promise<{ ok: boolean; message?: string }>;
  onDataMutated: () => void;
}

export const WORKFLOW_STAGES: WorkflowStageDef[] = [
  {
    stepNumber: 1,
    id: 'source_rfq',
    shortTitle: 'Request & Source',
    title: '1. Request & Source Vendors',
    oneLiner: 'Tell Kraya what you need to buy, paste a BOM, or find live GST-verified suppliers.',
    nextStageHint: 'Next → Collect vendor quotes to compare true landed cost',
    primaryTab: 'buying',
    channel: 'manual',
    defaultPrompt:
      'Send RFQ to 4 vendors for 5,000 5-ply corrugated boxes (HSN 4819), delivery within 10 days',
    examples: [
      {
        id: 'ex-rfq',
        label: 'Create New RFQ',
        prompt:
          'Send RFQ to 4 vendors for 5,000 5-ply corrugated boxes (HSN 4819), delivery within 10 days',
        channel: 'manual',
        badge: 'RFQ',
      },
      {
        id: 'ex-discover',
        label: 'Find Live Verified Vendors',
        prompt: 'Find corrugated box manufacturers in Pune with GSTIN',
        channel: 'manual',
        badge: 'Live Sourcing',
      },
      {
        id: 'ex-bom',
        label: 'Bulk Import BOM / Indent',
        prompt: 'Import BOM CSV to create multiple RFQs at once',
        channel: 'manual',
        badge: 'Bulk BOM',
      },
    ],
  },
  {
    stepNumber: 2,
    id: 'collect_quotes',
    shortTitle: 'Collect Quotes',
    title: '2. Log Quotes & Landed Cost',
    oneLiner:
      'Paste WhatsApp/Email replies, Hinglish voice notes, or PDFs — Kraya normalizes GST, freight & WACC.',
    nextStageHint: 'Next → Run AI BATNA Negotiation & approve the winning GST PO',
    primaryTab: 'buying',
    channel: 'whatsapp',
    defaultPrompt:
      'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
    examples: [
      {
        id: 'ex-wa-quote',
        label: 'Log WhatsApp Quote',
        prompt:
          'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
        channel: 'whatsapp',
        badge: 'WhatsApp',
      },
      {
        id: 'ex-phone-quote',
        label: 'Log 2nd Quote (Compare)',
        prompt:
          'From: Shakti Packaging. 5000 boxes @ ₹24 flat cash on delivery, 5% GST incl, Monday dispatch',
        channel: 'phone',
        badge: 'Compare',
      },
    ],
  },
  {
    stepNumber: 3,
    id: 'negotiate_po',
    shortTitle: 'Negotiate & PO',
    title: '3. AI Negotiate & Approve PO',
    oneLiner:
      'Generate multi-quote BATNA counter-offers in Hinglish/English, then issue a legally-binding GST PO.',
    nextStageHint: 'Next → Track delivery, record GRN & run daily expeditor sweep',
    primaryTab: 'buying',
    channel: 'manual',
    defaultPrompt: 'Negotiate my open RFQ with AI BATNA strategy',
    examples: [
      {
        id: 'ex-negotiate',
        label: 'Run AI BATNA Negotiation',
        prompt: 'Negotiate my open RFQ with AI BATNA strategy',
        channel: 'manual',
        badge: 'AI Playbook',
      },
      {
        id: 'ex-counter',
        label: 'Log Counter-Offer Reply',
        prompt: 'Ramesh offered ₹21.50 + 5% GST with 45 days credit for 5000 boxes, FOR delivery',
        channel: 'phone',
        badge: 'Counter',
      },
    ],
  },
  {
    stepNumber: 4,
    id: 'receive_track',
    shortTitle: 'Receive & Track',
    title: '4. Receive Goods (GRN) & Daily Ops',
    oneLiner:
      'Sweep overdue deliveries, track 43B(h) MSME clocks, log GRN receipts, and schedule machinery AMCs.',
    nextStageHint: 'Next → Audit supplier invoice against PO to stop overpayments',
    primaryTab: 'daily',
    channel: 'manual',
    defaultPrompt: 'Run autonomous expeditor sweep for overdue deliveries and 43B(h) deadlines',
    examples: [
      {
        id: 'ex-sweep',
        label: 'Run Expeditor Sweep',
        prompt: 'Run autonomous expeditor sweep for overdue deliveries and 43B(h) deadlines',
        channel: 'manual',
        badge: 'Autopilot',
      },
      {
        id: 'ex-amc',
        label: 'Track Machinery AMC',
        prompt: 'Track 125 kVA DG generator quarterly AMC & hydraulic oil spares due this month',
        channel: 'manual',
        badge: 'AMC',
      },
    ],
  },
  {
    stepNumber: 5,
    id: 'audit_settle',
    shortTitle: 'Audit & Reconcile',
    title: '5. Audit Bills, Stop Leaks & Export',
    oneLiner:
      'Check bills vs POs in 60s, block double freight GST, reconcile GSTR-2B/IMS, and export to Tally/Zoho.',
    nextStageHint: 'Cycle Complete → Clean books, ₹0 leaks, CA-ready exports',
    primaryTab: 'daily',
    channel: 'pdf',
    defaultPrompt:
      'Audit Invoice #INV-412 from Shakti Packaging: 5000 boxes @ ₹26.50 + 5% GST, freight ₹5000 already incl of GST taxed at 18% again, Grand Total ₹145025',
    examples: [
      {
        id: 'ex-audit',
        label: '60s Invoice Leak Audit',
        prompt:
          'Audit Invoice #INV-412 from Shakti Packaging: 5000 boxes @ ₹26.50 + 5% GST, freight ₹5000 already incl of GST taxed at 18% again, Grand Total ₹145025',
        channel: 'pdf',
        badge: 'Leak Guard',
      },
      {
        id: 'ex-gstr2b',
        label: 'Reconcile GSTR-2B / IMS',
        prompt: 'Reconcile GSTR-2B and GST IMS portal return against our bills',
        channel: 'manual',
        badge: 'GST 2.0',
      },
      {
        id: 'ex-export',
        label: 'Export Tally / Zoho / CA Pack',
        prompt: 'Export Tally Prime XML, Zoho Books CSV, and CA GST Audit Pack',
        channel: 'manual',
        badge: 'ERP Export',
      },
    ],
  },
];

export interface WorkspaceGuidance {
  recommendedStage: WorkflowStageId;
  stageStatus: Record<WorkflowStageId, 'completed' | 'current' | 'upcoming'>;
  headline: string;
  subtext: string;
  ctaLabel: string;
  ctaPrompt: string;
  ctaTab: NavTab;
  stageCounts: Record<WorkflowStageId, number>;
}

/**
 * Computes the live recommended next step from real workspace counts so
 * users immediately know where they are and what comes next.
 */
export function computeWorkspaceGuidance(summary: SummaryStats | null): WorkspaceGuidance {
  const suppliersCount = summary?.suppliersCount ?? 0;
  const openRfqsCount = summary?.openRfqsCount ?? 0;
  const pendingVerifications = summary?.pendingVerificationsCount ?? 0;
  const inboxCount = summary?.inboxCount ?? 0;
  const posIssuedCount = summary?.posIssuedCount ?? 0;
  const openTasksCount = summary?.openTasksCount ?? 0;
  const invoicesAuditedCount = summary?.invoicesAuditedCount ?? 0;
  const activeLeaksCount = summary?.activeLeaksCount ?? 0;

  const stageCounts: Record<WorkflowStageId, number> = {
    source_rfq: openRfqsCount || suppliersCount,
    collect_quotes: pendingVerifications > 0 ? pendingVerifications : inboxCount,
    negotiate_po: posIssuedCount,
    receive_track: openTasksCount,
    audit_settle: activeLeaksCount > 0 ? activeLeaksCount : invoicesAuditedCount,
  };

  let recommendedStage: WorkflowStageId = 'source_rfq';
  let headline = 'Step 1: Start by telling Kraya what you need to buy';
  let subtext =
    'Type a requirement, import a BOM CSV, or discover live GST-verified suppliers in seconds.';
  let ctaLabel = 'Create First RFQ';
  let ctaPrompt = WORKFLOW_STAGES[0].defaultPrompt;
  let ctaTab: NavTab = 'new_task';

  if (activeLeaksCount > 0) {
    recommendedStage = 'audit_settle';
    headline = `Step 5 Action: ${activeLeaksCount} active money leak${activeLeaksCount > 1 ? 's' : ''} waiting for recovery`;
    subtext =
      'Dispute flagged overcharges on WhatsApp, reconcile GSTR-2B/IMS, and export clean vouchers to Tally or Zoho.';
    ctaLabel = 'Resolve Leaks & Reconcile';
    ctaPrompt = 'Reconcile GSTR-2B and GST IMS portal return against our bills';
    ctaTab = 'daily';
  } else if (pendingVerifications > 0) {
    recommendedStage = 'collect_quotes';
    headline = `Step 2 Action: ${pendingVerifications} extracted item${pendingVerifications > 1 ? 's' : ''} need 1-click verification`;
    subtext =
      'Confirm extracted figures in Unified Inbox so landed-cost rankings and audits stay 100% accurate.';
    ctaLabel = 'Verify in Unified Inbox';
    ctaPrompt = WORKFLOW_STAGES[1].defaultPrompt;
    ctaTab = 'inbox';
  } else if (openRfqsCount > 0 && posIssuedCount === 0) {
    recommendedStage = 'negotiate_po';
    headline = `Step 3 Action: Compare quotes, run AI Negotiation & issue your PO`;
    subtext = `You have ${openRfqsCount} open RFQ${openRfqsCount > 1 ? 's' : ''}. Log 2+ vendor quotes to unlock AI BATNA negotiation and 1-click GST PO approval.`;
    ctaLabel = 'Negotiate & Approve PO';
    ctaPrompt = 'Negotiate my open RFQ with AI BATNA strategy';
    ctaTab = 'buying';
  } else if (posIssuedCount > 0 && invoicesAuditedCount < posIssuedCount) {
    recommendedStage = 'receive_track';
    headline = `Step 4 → 5 Action: Record GRN for ${posIssuedCount} issued PO${posIssuedCount > 1 ? 's' : ''} & audit supplier bill`;
    subtext =
      'Log Goods Receipt (GRN) when material arrives, then drop the supplier invoice to catch GST, freight & rate-creep leaks.';
    ctaLabel = 'Audit Supplier Invoice';
    ctaPrompt = WORKFLOW_STAGES[4].defaultPrompt;
    ctaTab = 'daily';
  } else if (openRfqsCount > 0 || suppliersCount > 0) {
    recommendedStage = 'collect_quotes';
    headline = 'Step 2 Action: Drop a vendor quote (WhatsApp, Email, Voice, or PDF)';
    subtext =
      'Kraya normalizes GST 2.0 ITC, freight, and WACC credit days side by side so you never overpay.';
    ctaLabel = 'Log Vendor Quote';
    ctaPrompt = WORKFLOW_STAGES[1].defaultPrompt;
    ctaTab = 'new_task';
  }

  const order: WorkflowStageId[] = [
    'source_rfq',
    'collect_quotes',
    'negotiate_po',
    'receive_track',
    'audit_settle',
  ];
  const recIdx = order.indexOf(recommendedStage);

  const stageStatus = {} as Record<WorkflowStageId, 'completed' | 'current' | 'upcoming'>;
  order.forEach((id, idx) => {
    if (id === recommendedStage) {
      stageStatus[id] = 'current';
    } else if (idx < recIdx) {
      stageStatus[id] = 'completed';
    } else {
      // Also mark earlier stages completed if real data exists for them
      const hasDone =
        (id === 'source_rfq' && (openRfqsCount > 0 || suppliersCount > 0)) ||
        (id === 'collect_quotes' && inboxCount > 0 && pendingVerifications === 0) ||
        (id === 'negotiate_po' && posIssuedCount > 0) ||
        (id === 'receive_track' && posIssuedCount > 0 && openTasksCount === 0) ||
        (id === 'audit_settle' && invoicesAuditedCount > 0 && activeLeaksCount === 0);
      stageStatus[id] = hasDone ? 'completed' : 'upcoming';
    }
  });

  return {
    recommendedStage,
    stageStatus,
    headline,
    subtext,
    ctaLabel,
    ctaPrompt,
    ctaTab,
    stageCounts,
  };
}

export type PromptIntentKind =
  | 'discover_suppliers'
  | 'bulk_bom'
  | 'negotiate_rfq'
  | 'gstr2b_reconcile'
  | 'autonomous_sweep'
  | 'export_accounting'
  | 'guide_me'
  | 'ask_cfo'
  | 'ingest_rfq'
  | 'ingest_quote'
  | 'ingest_invoice'
  | 'ingest_maintenance';

export interface CfoQaResponseData {
  question: string;
  topic: string;
  isCrossQuestion: boolean;
  previousTopic: string | null;
  headline: string;
  directAnswer: string;
  mathProof: Array<{
    label: string;
    value: string;
    formula: string;
    highlight?: boolean;
  }>;
  statutoryCitations: Array<{
    act: string;
    section: string;
    ruleSummary: string;
  }>;
  pncMatrix: Array<{
    condition: string;
    outcome: string;
    impact: string;
  }>;
  suggestedCrossQuestions: string[];
}

export interface PromptIntentPreview {
  kind: PromptIntentKind;
  stageId: WorkflowStageId;
  stageStep: 1 | 2 | 3 | 4 | 5;
  actionLabel: string;
  detail: string;
  extractedQuery?: string;
}

/**
 * Instant, deterministic client-side prompt intent preview & smart router.
 * Guarantees users see what Kraya will do BEFORE pressing Enter and routes
 * seamlessly to all backend engines & modals with zero dead ends.
 */
export function detectPromptIntent(promptText: string, hasAttachments = false): PromptIntentPreview {
  const text = promptText.trim();
  const lower = text.toLowerCase();

  // If user pasted multi-line tabular BOM/CSV data (even without saying "import bom")
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const looksLikeBomCsv =
    !hasAttachments &&
    lines.length >= 2 &&
    (lines[0].includes(',') || lines[0].includes('\t')) &&
    /(item|description|qty|quantity|hsn|unit|material)/i.test(lines[0]);

  if (
    looksLikeBomCsv ||
    (!hasAttachments && /\b(import\s+bom|bulk\s+bom|bulk\s+rfq|upload\s+bom|bom\s+csv)\b/i.test(lower))
  ) {
    return {
      kind: 'bulk_bom',
      stageId: 'source_rfq',
      stageStep: 1,
      actionLabel: 'Step 1 · Open Bulk BOM Importer',
      detail: looksLikeBomCsv
        ? `Detected ${lines.length - 1} BOM row(s) — will pre-fill Bulk RFQ Importer`
        : 'Will open Bulk BOM CSV/Excel Importer to create multiple RFQs at once',
      extractedQuery: looksLikeBomCsv ? text : '',
    };
  }

  if (
    !hasAttachments &&
    /\b(find|discover|source|search)\b.*\b(supplier|vendor|manufacturer|factory|distributor|dealer|maker)s?\b/i.test(
      lower
    )
  ) {
    const cleaned = text
      .replace(/^(please\s+)?(find|discover|source|search\s+for|search)\s+/i, '')
      .replace(/\s+with\s+gstin$/i, '')
      .trim();
    return {
      kind: 'discover_suppliers',
      stageId: 'source_rfq',
      stageStep: 1,
      actionLabel: 'Step 1 · Launch Live AI Supplier Sourcing',
      detail: `Will search verified suppliers for "${cleaned || text}" with Mod-36 GSTIN & Maps routing`,
      extractedQuery: cleaned || text,
    };
  }

  if (
    !hasAttachments &&
    /\b(reconcile\s*gstr|gstr[\s-]*2b|gst\s*ims|match\s*2b|portal\s*return)\b/i.test(lower)
  ) {
    return {
      kind: 'gstr2b_reconcile',
      stageId: 'audit_settle',
      stageStep: 5,
      actionLabel: 'Step 5 · Open GSTR-2B / IMS Reconciler',
      detail: 'Will open live GSTR-2B JSON/CSV reconciler against your audited bills',
    };
  }

  if (
    !hasAttachments &&
    /\b(autonomous\s*sweep|expeditor\s*sweep|run\s*sweep|daily\s*sweep|check\s*overdue|43b\(h\)\s*deadlines?|morning\s*briefing)\b/i.test(
      lower
    )
  ) {
    return {
      kind: 'autonomous_sweep',
      stageId: 'receive_track',
      stageStep: 4,
      actionLabel: 'Step 4 · Run Autonomous Expeditor Sweep',
      detail: 'Will scan stale RFQs, overdue POs, 43B(h) payment cliffs, AMCs & incomplete KYC',
    };
  }

  if (
    !hasAttachments &&
    /\b(export\s+tally|tally\s+xml|zoho\s+books|ca\s+(gst\s+)?audit\s+pack|download\s+(vouchers?|exports?))\b/i.test(
      lower
    )
  ) {
    return {
      kind: 'export_accounting',
      stageId: 'audit_settle',
      stageStep: 5,
      actionLabel: 'Step 5 · Prepare ERP & CA Exports',
      detail: 'Will provide 1-click downloads for Tally Prime XML, Zoho Books CSV & CA Audit Pack',
    };
  }

  if (
    !hasAttachments &&
    (/\b(batna|negotiation\s+(strategy|playbook))\b/i.test(lower) ||
      (/^\s*(run\s+ai\s+|start\s+)?negotiate\b/i.test(lower) && !/\b(offered|quoted|@|₹|rs\.?)\b/i.test(lower)))
  ) {
    return {
      kind: 'negotiate_rfq',
      stageId: 'negotiate_po',
      stageStep: 3,
      actionLabel: 'Step 3 · Launch AI BATNA Negotiation Playbook',
      detail: 'Will analyze your open RFQ quotes and draft Hinglish/English counter-offers',
    };
  }

  if (
    !hasAttachments &&
    /^(what\s+(should|do)\s+i\s+do\s+next|what'?s\s+next|guide\s+me|help\s+me|show\s+status|workflow\s+status)\b/i.test(
      lower
    )
  ) {
    return {
      kind: 'guide_me',
      stageId: 'source_rfq',
      stageStep: 1,
      actionLabel: 'Workflow Guide · Personalized Next Steps',
      detail: 'Will inspect your live workspace and recommend the exact next procurement step',
    };
  }

  // Conversational CFO Questions & Multi-Turn Cross-Questions
  const looksLikeQuestionOrCrossQuestion =
    !hasAttachments &&
    !/^(audit\s+invoice|from:|send\s+rfq|create\s+rfq|track\s+\d)/i.test(lower) &&
    (/^(why\b|what\s+if\b|and\s+what\s+if\b|wait\b|but\s+what\b|how\s+(does|do|is|can|should|come)\b|when\s+(do|does|is|should)\b|can\s+(we|i|a\s+vendor)\b|does\s+(section|the|it|43b|rule|wacc|gst)\b|explain\b|at\s+what\s+(wacc|point|rate|credit)\b|what\s+happens\s+if\b|what\s+is\s+(our|the)\b|show\s+me\s+the\s+(exact\s+)?(math|formula))/i.test(
      lower
    ) ||
      text.endsWith('?'));

  if (looksLikeQuestionOrCrossQuestion) {
    return {
      kind: 'ask_cfo',
      stageId: 'negotiate_po',
      stageStep: 3,
      actionLabel: 'Ask Kraya CFO · Live Math, Tax Law & Cross-Question Engine',
      detail: 'Will compute deterministic WACC/GST/43B(h)/TDS proof, PnC matrix & follow-up cross-questions',
      extractedQuery: text,
    };
  }

  // Standard /api/prompt/ingest pillar preview
  if (
    /\b(invoice|bill|inv[-#/\s]|audit|irn|taxed\s+at|grand\s+total|overcharge|double\s+gst)\b/i.test(
      lower
    )
  ) {
    return {
      kind: 'ingest_invoice',
      stageId: 'audit_settle',
      stageStep: 5,
      actionLabel: 'Step 5 · 60s GST 2.0 & Money Leak Invoice Audit',
      detail: 'Will verify line-item math, GST split, freight double-tax & 43B(h) deadline',
    };
  }

  if (/\b(amc|generator|maintenance|service\s+due|spares|calibration|reorder|chase|follow\s*up)\b/i.test(lower)) {
    return {
      kind: 'ingest_maintenance',
      stageId: 'receive_track',
      stageStep: 4,
      actionLabel: 'Step 4 · Log Daily Task / Maintenance Schedule',
      detail: 'Will add to Daily Follow-Up Queue and draft a 1-click vendor nudge',
    };
  }

  if (
    /\b(send\s+rfq|create\s+rfq|need\s+\d|want\s+to\s+buy|request\s+quotes?|rfq\s+for|float\s+rfq)\b/i.test(
      lower
    ) &&
    !/\b(from:|offered|quoted|@|udhari)\b/i.test(lower)
  ) {
    return {
      kind: 'ingest_rfq',
      stageId: 'source_rfq',
      stageStep: 1,
      actionLabel: 'Step 1 · Create Structured RFQ & Vendor Outreach',
      detail: 'Will open an RFQ in Buying & RFQs and prepare WhatsApp/Email vendor requests',
    };
  }

  if (/\b(from:|offered|quoted|@|₹|rs\.?|udhari|plus\s+gst|gst\s+incl|per\s+kg|per\s+pc)\b/i.test(lower)) {
    return {
      kind: 'ingest_quote',
      stageId: 'collect_quotes',
      stageStep: 2,
      actionLabel: 'Step 2 · Parse Quote & Compute WACC Landed Cost',
      detail: 'Will extract price, GST, freight & credit days and rank in Buying & RFQs',
    };
  }

  if (hasAttachments) {
    return {
      kind: 'ingest_invoice',
      stageId: 'collect_quotes',
      stageStep: 2,
      actionLabel: 'Multimodal Audit & Auto-Route Attachment',
      detail: 'Will OCR/transcribe attached file, verify figures & route to the right stage',
    };
  }

  return {
    kind: 'ingest_rfq',
    stageId: 'source_rfq',
    stageStep: 1,
    actionLabel: 'Auto-Classify & Route via Kraya Agent',
    detail: 'Will parse your request, log in Unified Inbox & show guided next steps',
  };
}

export interface GuidedNextStep {
  id: string;
  label: string;
  hint: string;
  primary?: boolean;
  kind: 'navigate' | 'prefill_prompt' | 'discover' | 'negotiate' | 'gstr2b' | 'outreach' | 'sweep' | 'export';
  tab?: NavTab;
  prompt?: string;
  channel?: string;
  query?: string;
  rfqId?: string;
  outreach?: OutreachModalRequest;
}

/**
 * Generates clear, sequential "What Comes Next?" guided actions after any
 * prompt ingest response so the user never hits a dead end.
 */
export function buildNextStepsForIngest(result: IngestResponse): {
  completedStep: 1 | 2 | 3 | 4 | 5;
  nextStepLabel: string;
  steps: GuidedNextStep[];
} {
  const steps: GuidedNextStep[] = [];

  if (result.created.audit) {
    const leakPaise = result.created.audit.totalMoneyLeakPaise;
    if (leakPaise > 0) {
      steps.push({
        id: 'next-dispute',
        label: `Dispute ${formatINR(leakPaise)} on WhatsApp`,
        hint: 'Send statutory breakdown to vendor',
        primary: true,
        kind: 'outreach',
        outreach: {
          scenario: 'invoice_dispute',
          supplierName: result.extracted.supplierName || 'Vendor',
          disputeAmountPaise: leakPaise,
          disputeReasons: result.created.audit.flags
            .filter((f) => f.severity !== 'info')
            .map((f) => f.title),
        },
      });
    }
    steps.push({
      id: 'next-gstr2b',
      label: 'Reconcile GSTR-2B / IMS',
      hint: 'Verify ITC against GST portal',
      primary: leakPaise === 0,
      kind: 'gstr2b',
    });
    steps.push({
      id: 'next-daily',
      label: 'Open Audit Register & Exports',
      hint: 'Credit notes, Tally XML & Zoho CSV',
      kind: 'navigate',
      tab: 'daily',
    });
    return {
      completedStep: 5,
      nextStepLabel:
        leakPaise > 0
          ? 'Step 5 Audit Caught a Leak → Dispute or Record Credit Note next'
          : 'Step 5 Audit Clean → Reconcile GSTR-2B & Export to Tally/Zoho',
      steps,
    };
  }

  if (result.created.quote) {
    steps.push({
      id: 'next-2nd-quote',
      label: 'Log a 2nd Vendor Quote',
      hint: 'Compare 2+ quotes to unlock AI BATNA',
      primary: true,
      kind: 'prefill_prompt',
      prompt:
        'From: Shakti Packaging. 5000 boxes @ ₹24 flat cash on delivery, 5% GST incl, Monday dispatch',
      channel: 'whatsapp',
    });
    steps.push({
      id: 'next-negotiate',
      label: 'Run AI BATNA Negotiation',
      hint: 'Draft counter-offers across quotes',
      kind: 'negotiate',
    });
    steps.push({
      id: 'next-buying',
      label: 'Compare Landed Cost & Issue PO',
      hint: 'View ranked table in Buying & RFQs',
      kind: 'navigate',
      tab: 'buying',
    });
    return {
      completedStep: 2,
      nextStepLabel: 'Step 2 Done (Quote Ranked) → Add another quote or move to Step 3 (Negotiate & PO)',
      steps,
    };
  }

  if (result.created.rfq) {
    steps.push({
      id: 'next-discover',
      label: `Find Live Vendors for "${result.created.rfq.title.slice(0, 28)}"`,
      hint: 'Discover GSTIN-verified suppliers nearby',
      primary: true,
      kind: 'discover',
      query: result.created.rfq.title,
    });
    if (result.suggestedOutreach) {
      steps.push({
        id: 'next-send-rfq',
        label: 'Send RFQ on WhatsApp / Email',
        hint: 'Ready-to-send multi-language draft',
        kind: 'outreach',
        outreach: {
          scenario: 'rfq_request',
          supplierName: result.extracted.supplierName || 'Vendor',
          itemDescription: result.created.rfq.title,
        },
      });
    }
    steps.push({
      id: 'next-log-quote',
      label: 'Step 2: Paste First Vendor Quote →',
      hint: 'Log reply to compute WACC landed cost',
      kind: 'prefill_prompt',
      prompt:
        'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
      channel: 'whatsapp',
    });
    return {
      completedStep: 1,
      nextStepLabel: `Step 1 Done (${result.created.rfq.rfqNumber}) → Source vendors or log quotes next`,
      steps,
    };
  }

  if (result.created.task) {
    steps.push({
      id: 'next-sweep',
      label: 'Run Autonomous Expeditor Sweep',
      hint: 'Check all overdue POs, 43B(h) & AMCs',
      primary: true,
      kind: 'sweep',
    });
    steps.push({
      id: 'next-daily-ops',
      label: 'Open Daily Queue & AMC Tracker',
      hint: 'Manage tasks & 1-click vendor nudges',
      kind: 'navigate',
      tab: 'daily',
    });
    return {
      completedStep: 4,
      nextStepLabel: 'Step 4 Done (Task Queued) → Run Expeditor Sweep or track in Maintenance & Daily',
      steps,
    };
  }

  // Fallback (logged in Unified Inbox / pending verification)
  steps.push({
    id: 'next-inbox',
    label: 'Review in Unified Inbox',
    hint: 'Verify extracted fields & attachments',
    primary: true,
    kind: 'navigate',
    tab: 'inbox',
  });
  steps.push({
    id: 'next-buying-fallback',
    label: 'Open Buying & RFQs',
    hint: 'Compare quotes or create an RFQ',
    kind: 'navigate',
    tab: 'buying',
  });
  return {
    completedStep: 2,
    nextStepLabel: 'Logged to Unified Inbox → Verify details and continue to Buying or Audit',
    steps,
  };
}
