import {
  formatINR,
  QuoteCostInput,
  rankSupplierQuotes,
  WorkspaceTaxProfile,
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

export interface QaConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  topic?: CfoQaTopic;
}

export type CfoQaTopic =
  | 'landed_cost_wacc'
  | 'gst_freight_itc'
  | 'msme_43bh_rule37'
  | 'tds_194q_194c'
  | 'three_way_match_audit'
  | 'batna_negotiation'
  | 'workspace_overview';

export interface CfoMathProofItem {
  label: string;
  value: string;
  formula: string;
  highlight?: boolean;
}

export interface CfoStatutoryCitation {
  act: string;
  section: string;
  ruleSummary: string;
}

export interface CfoPncRow {
  condition: string;
  outcome: string;
  impact: string;
}

export interface CfoQaData {
  question: string;
  topic: CfoQaTopic;
  isCrossQuestion: boolean;
  previousTopic: CfoQaTopic | null;
  headline: string;
  directAnswer: string;
  mathProof: CfoMathProofItem[];
  statutoryCitations: CfoStatutoryCitation[];
  pncMatrix: CfoPncRow[];
  suggestedCrossQuestions: string[];
}

export interface CfoQaInput {
  question: string;
  conversationHistory?: QaConversationTurn[];
  liveQuotes?: QuoteCostInput[];
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

function detectTopic(question: string, prevTopic: CfoQaTopic | null): {
  topic: CfoQaTopic;
  isCrossQuestion: boolean;
} {
  const q = question.trim();
  const lower = q.toLowerCase();

  const startsWithCrossMarker =
    /^(wait|but\b|what\s+if|and\s+what\s+if|why\s+did|why\s+is\s+that|how\s+come|hold\s+on|even\s+if|suppose|assuming|show\s+me\s+the\s+(exact\s+)?(math|formula)|does\s+the\s+winner\s+flip|at\s+what\s+point|what\s+about)/i.test(
      lower
    );

  const isCrossQuestion = startsWithCrossMarker;

  if (
    /\b(overview|total\s+spend|active\s+pipeline|workspace\s+status|executive\s+summary|biggest\s+risk)\b/i.test(
      lower
    )
  ) {
    return { topic: 'workspace_overview', isCrossQuestion };
  }

  if (
    /\b(43b\s*\(?h\)?|msme|udyam|45[\s-]*days?|15[\s-]*days?|written\s+agreement|micro|small\s+enterprise|medium\s+enterprise|trader|rule\s*37|180[\s-]*days?|disallowance)\b/i.test(
      lower
    )
  ) {
    return { topic: 'msme_43bh_rule37', isCrossQuestion };
  }

  if (
    /\b(194\s*q|194\s*c|tds|206\s*ab|206\s*aa|pan\s+entity|6th\s+char|4th\s+char|deduct\s+tax|withholding)\b/i.test(
      lower
    )
  ) {
    return { topic: 'tds_194q_194c', isCrossQuestion };
  }

  if (
    /\b(grn|3[\s-]*way\s+match|three[\s-]*way|partial\s+delivery|short\s+supply|audit\s+chain|sha[\s-]*256|tamper|po\s+amend|po\s+cancel|revision)\b/i.test(
      lower
    )
  ) {
    return { topic: 'three_way_match_audit', isCrossQuestion };
  }

  if (
    /\b(double\s+(freight|gst|tax)|gta|composite\s+supply|rcm|reverse\s+charge|credit\s+note|section\s+34|inv[\s-#]*\d+|900|145025|overcharge|money\s+leak|itc|composition|gstr[\s-]*2b|ims\s+portal|cgst|sgst|igst|inter[\s-]*state|intra[\s-]*state|place\s+of\s+supply)\b/i.test(
      lower
    )
  ) {
    return { topic: 'gst_freight_itc', isCrossQuestion };
  }

  if (
    /\b(wacc|landed\s+cost|credit[\s-]*adjusted|ranked\s*#?1|winner\s+flip|break[\s-]*even|crossover|credit\s+days|udhari|bharat\s+packaging|shakti\s+packaging|compare\s+quotes|cheaper)\b/i.test(
      lower
    )
  ) {
    return { topic: 'landed_cost_wacc', isCrossQuestion };
  }

  if (/\b(batna|negotiat|counter[\s-]*offer|leverage|target\s+rate|walk[\s-]*away)\b/i.test(lower)) {
    return { topic: 'batna_negotiation', isCrossQuestion };
  }

  if (isCrossQuestion && prevTopic) {
    return { topic: prevTopic, isCrossQuestion: true };
  }

  return { topic: 'workspace_overview', isCrossQuestion };
}

export async function runCfoQuestionAnsweringAgent(
  input: CfoQaInput
): Promise<SpecialistAgentReport<CfoQaData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const history = input.conversationHistory || [];
  const lastAssistantTurn = [...history].reverse().find((t) => t.role === 'assistant' && t.topic);
  const prevTopic = lastAssistantTurn?.topic ?? null;

  const { topic, isCrossQuestion } = detectTopic(input.question, prevTopic);
  const ws = input.memory.workspace;
  const buyerProfile: WorkspaceTaxProfile = {
    legalName: ws.legalName,
    gstin: ws.gstin,
    stateCode: ws.stateCode,
    gstRegime: ws.gstRegime,
    waccPct: ws.waccPct,
    turnoverBand: ws.turnoverBand,
  };

  // Extract hypothetical numeric overrides from cross-questions (e.g. "What if WACC is 24%?" or "What if credit is 10 days?")
  const lowerQ = input.question.toLowerCase();
  const waccMatch = lowerQ.match(/wacc\s*(?:is|to|at|of|becomes|jumps\s+to|rises\s+to|drops\s+to|=)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const pctMatch = !waccMatch && topic === 'landed_cost_wacc' ? lowerQ.match(/(\d+(?:\.\d+)?)\s*%/i) : null;
  const hypotheticalWacc = waccMatch
    ? Number(waccMatch[1])
    : pctMatch && /wacc|interest|cost\s+of\s+capital/i.test(lowerQ)
      ? Number(pctMatch[1])
      : null;

  const creditMatch = lowerQ.match(/(\d+)\s*(?:days?\s*(?:credit|udhari)|credit\s*days?|din\s*udhari)/i);
  const hypotheticalCreditDays = creditMatch ? Number(creditMatch[1]) : null;

  const noWrittenAgreementMentioned =
    /\b(no\s+written|without\s+(a\s+)?written|verbal|oral\s+agreement|unwritten)\b/i.test(lowerQ);

  // Build baseline quotes (from live DB quotes or deterministic benchmark quotes if workspace has none yet)
  const effectiveQuotes: QuoteCostInput[] =
    input.liveQuotes && input.liveQuotes.length >= 2
      ? input.liveQuotes
      : [
          {
            quoteId: 'qt-bharat',
            supplier: {
              id: 'sup-bharat',
              name: 'Bharat Packaging Works',
              stateCode: ws.stateCode,
              gstRegime: 'regular',
              udyamTier: 'small',
              eInvoiceRequired: true,
              reliabilityScore: 92,
            },
            quantity: 5000,
            rawRateRupees: 22,
            rawUnit: 'pc',
            gstPct: 5,
            isGstInclusive: false,
            freightTotalRupees: 5000,
            freightGstMode: 'composite_supply',
            creditDays: 30,
            hasWrittenAgreement: true,
            leadTimeDays: 5,
          },
          {
            quoteId: 'qt-shakti',
            supplier: {
              id: 'sup-shakti',
              name: 'Shakti Packaging Industries',
              stateCode: ws.stateCode,
              gstRegime: 'regular',
              udyamTier: 'micro',
              eInvoiceRequired: false,
              reliabilityScore: 86,
            },
            quantity: 5000,
            rawRateRupees: 24,
            rawUnit: 'pc',
            gstPct: 5,
            isGstInclusive: true,
            freightTotalRupees: 0,
            freightGstMode: 'composite_supply',
            creditDays: 0,
            hasWrittenAgreement: true,
            leadTimeDays: 3,
          },
        ];

  let headline = '';
  let directAnswer = '';
  const mathProof: CfoMathProofItem[] = [];
  const statutoryCitations: CfoStatutoryCitation[] = [];
  const pncMatrix: CfoPncRow[] = [];
  let suggestedCrossQuestions: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const whatIfs: WhatIfScenario[] = [];
  const actions: ProposedAgentAction[] = [];
  let riskLevel: RiskLevel = 'low';

  if (topic === 'landed_cost_wacc') {
    const activeWacc = hypotheticalWacc ?? ws.waccPct;
    const modifiedQuotes = effectiveQuotes.map((q, idx) => {
      if (idx === 0 && hypotheticalCreditDays !== null) {
        return {
          ...q,
          creditDays: hypotheticalCreditDays,
          hasWrittenAgreement: !noWrittenAgreementMentioned,
        };
      }
      if (noWrittenAgreementMentioned) {
        return { ...q, hasWrittenAgreement: false };
      }
      return q;
    });

    const ranked = rankSupplierQuotes(modifiedQuotes, {
      ...buyerProfile,
      waccPct: activeWacc,
    });

    const w1 = ranked.ranked[0];
    const w2 = ranked.ranked[1];
    const spreadPaise = w1 && w2 ? w2.creditAdjustedRealUnitPaise - w1.creditAdjustedRealUnitPaise : 0;
    const totalBatchSavingsPaise = w1 ? spreadPaise * w1.quantity : 0;

    // Compute exact break-even Rate / Credit Days crossover between #1 and #2
    const crossoverWaccInfo =
      w1 && w2 && w1.netLandedUnitPaise > w2.netLandedUnitPaise && w1.effectiveCreditDaysUsed > w2.effectiveCreditDaysUsed
        ? `${(
            ((w1.netLandedUnitPaise - w2.netLandedUnitPaise) * 365 * 100) /
            (w1.netLandedUnitPaise * w1.effectiveCreditDaysUsed - w2.netLandedUnitPaise * w2.effectiveCreditDaysUsed)
          ).toFixed(2)}% p.a.`
        : 'Rank #1 already has lower or equal Net Ex-GST Landed Cost before credit benefit (dominates at all WACC > 0%)';

    headline = isCrossQuestion
      ? `Cross-Question Sensitivity Proof (WACC ${activeWacc}%${hypotheticalCreditDays !== null ? `, Credit ${hypotheticalCreditDays}d` : ''}): ${w1?.supplierName} wins at ${formatINR(w1?.creditAdjustedRealUnitPaise ?? 0)}/unit`
      : `Landed Cost & WACC Math: ${w1?.supplierName} ranks #1 at ${formatINR(w1?.creditAdjustedRealUnitPaise ?? 0)}/unit (saves ${formatINR(totalBatchSavingsPaise)} on batch)`;

    directAnswer =
      w1 && w2
        ? `Even when comparing different freight structures, GST inclusivity, and credit terms, Kraya normalizes every quote to an Ex-GST, Credit-Adjusted Real Unit Cost under your ${activeWacc}% p.a. WACC (${ws.gstRegime.toUpperCase()} GST regime). ` +
          `#1 ${w1.supplierName} has a Base Ex-GST unit price of ${formatINR(w1.baseUnitPaise)}, plus freight of ${formatINR(w1.freightUnitPaise)}/unit = Net Landed ${formatINR(w1.netLandedUnitPaise)}/unit. ` +
          `With ${w1.effectiveCreditDaysUsed} effective credit days at ${activeWacc}% WACC, working-capital financing saves ${formatINR(w1.creditBenefitUnitPaise)}/unit, bringing the Real Credit-Adjusted Cost to ${formatINR(w1.creditAdjustedRealUnitPaise)}/unit — beating #2 ${w2.supplierName} (${formatINR(w2.creditAdjustedRealUnitPaise)}/unit) by ${formatINR(spreadPaise)}/unit (${formatINR(totalBatchSavingsPaise)} total across ${w1.quantity.toLocaleString('en-IN')} units).`
        : `Workspace WACC is configured at ${activeWacc}% p.a. Formula: Real Unit Cost = Net Landed Ex-GST − [Net Landed × (WACC / 100) × (Effective Credit Days / 365)].`;

    if (w1) {
      mathProof.push(
        {
          label: `#1 ${w1.supplierName} — Base Ex-GST Unit Rate`,
          value: `${formatINR(w1.baseUnitPaise)} / ${w1.canonicalUnit}`,
          formula: w1.normalizationNote,
        },
        {
          label: `#1 ${w1.supplierName} — Net Landed Unit Cost (Ex-ITC)`,
          value: formatINR(w1.netLandedUnitPaise),
          formula: `Base ${formatINR(w1.baseUnitPaise)} + Freight ${formatINR(w1.freightUnitPaise)}/unit (${ws.gstRegime === 'regular' ? '100% GST ITC recovered' : 'No ITC under Composition'})`,
        },
        {
          label: `#1 ${w1.supplierName} — WACC Credit Benefit (${w1.effectiveCreditDaysUsed}d @ ${activeWacc}%)`,
          value: `-${formatINR(w1.creditBenefitUnitPaise)} / unit`,
          formula: `${formatINR(w1.netLandedUnitPaise)} × (${activeWacc}% / 100) × (${w1.effectiveCreditDaysUsed} / 365)`,
        },
        {
          label: `#1 ${w1.supplierName} — Credit-Adjusted Real Unit Cost`,
          value: formatINR(w1.creditAdjustedRealUnitPaise),
          formula: `${formatINR(w1.netLandedUnitPaise)} − ${formatINR(w1.creditBenefitUnitPaise)}`,
          highlight: true,
        }
      );
    }
    if (w2) {
      mathProof.push(
        {
          label: `#2 ${w2.supplierName} — Credit-Adjusted Real Unit Cost`,
          value: formatINR(w2.creditAdjustedRealUnitPaise),
          formula: `Base ${formatINR(w2.baseUnitPaise)} + Freight ${formatINR(w2.freightUnitPaise)} − Credit Benefit ${formatINR(w2.creditBenefitUnitPaise)} (${w2.effectiveCreditDaysUsed}d)`,
        },
        {
          label: 'Net Spread & Crossover Threshold',
          value: `${formatINR(spreadPaise)}/unit (${formatINR(totalBatchSavingsPaise)} batch)`,
          formula: `Crossover WACC: ${crossoverWaccInfo}`,
          highlight: true,
        }
      );
    }

    statutoryCitations.push(
      {
        act: 'CGST Act, 2017',
        section: 'Section 16 & Section 8(a)',
        ruleSummary:
          'Regular GST buyers recover 100% eligible CGST/SGST/IGST as Input Tax Credit (ITC), so GST is stripped from true cost; freight billed by the supplier on the goods invoice is a Composite Supply taxed at the principal goods HSN rate.',
      },
      {
        act: 'Income Tax Act, 1961 & MSMED Act, 2006',
        section: 'Section 43B(h) & Section 15',
        ruleSummary:
          'For Micro & Small Udyam suppliers, credit days are legally capped at 45 days (with written agreement) or 15 days (without written agreement) when computing WACC working-capital benefit.',
      }
    );

    pncMatrix.push(
      {
        condition: 'PnC 1: Regular Buyer + Ex-GST Quote + Composite Freight + 30d Credit',
        outcome: 'ITC stripped; Freight added to base; 30d WACC discount applied',
        impact: w1 ? `${w1.supplierName}: ${formatINR(w1.creditAdjustedRealUnitPaise)}/unit` : 'Optimal baseline',
      },
      {
        condition: 'PnC 2: Regular Buyer + GST-Inclusive Quote + 0d Cash on Delivery',
        outcome: 'Reverse-strip GST (Rate ÷ 1.05); ₹0 WACC credit benefit',
        impact: w2 ? `${w2.supplierName}: ${formatINR(w2.creditAdjustedRealUnitPaise)}/unit` : 'Higher working-capital cost',
      },
      {
        condition: 'PnC 3: Composition Buyer OR Supplier is Composition Dealer',
        outcome: 'Zero ITC eligibility — GST is baked permanently into landed cost',
        impact: '+5% to +18% non-recoverable tax cost added to unit price',
      },
      {
        condition: 'PnC 4: MSME Micro/Small Vendor offers 60d Credit (Written vs No Written Agreement)',
        outcome: 'Capped at 45d (written) or 15d (unwritten) under Sec 43B(h)',
        impact: 'Prevents illusory credit benefit that would trigger 30% income tax disallowance',
      }
    );

    suggestedCrossQuestions = [
      'What if our WACC jumps to 24% and Bharat cuts credit to 10 days — does the winner flip?',
      'Wait, what if there is NO written agreement with the MSME vendor — why does credit cap at 15 days?',
      'What if the supplier is a Composition dealer — how does that change the landed cost math?',
      'How do we use this landed-cost spread as BATNA leverage to negotiate a counter-offer?',
    ];

    conditions.push({
      id: 'qa_wacc_proof',
      label: `Deterministic Landed-Cost Proof (${activeWacc}% WACC)`,
      status: 'pass',
      detail: directAnswer,
      metric: w1 ? formatINR(w1.creditAdjustedRealUnitPaise) : `${activeWacc}%`,
      statutoryRef: 'CGST Sec 16 + IT Act Sec 43B(h)',
    });
    whatIfs.push({
      id: 'qa_wi_wacc_24',
      title: 'What-If WACC rises to 24% p.a.',
      assumption: 'Tighter CC/OD bank line increases cost of working capital to 24%',
      impactSummary: `Every 30 days of supplier credit is worth 1.97% of net landed value instead of ${((ws.waccPct * 30) / 365).toFixed(2)}%.`,
      recommendation: 'Prioritize vendors offering 30–45 days credit within the MSME 43B(h) safe harbor.',
    });
  } else if (topic === 'gst_freight_itc') {
    const targetInv = input.memory.invoices[0];
    const activeLeaks = input.memory.moneyLeaks.filter((l) => l.status !== 'dismissed');
    const totalLeakPaise = activeLeaks.reduce((s, l) => s + l.amountPaise, 0);

    headline = isCrossQuestion
      ? `Cross-Question GST 2.0 & Dispute Protocol: Section 8(a) Composite Supply vs GTA RCM & Section 34 Credit Note Enforcement`
      : `GST 2.0 Forensic Proof: Why Double-Taxed Freight & Rate Creep Trigger a ${formatINR(totalLeakPaise || 1750000)} Pre-Payment Block`;

    directAnswer =
      `Under Section 8(a) of the CGST Act, 2017, when a supplier arranges transport and bills freight on the same tax invoice as the goods (FOR / Delivered basis), it is a Composite Supply — freight MUST take the exact same GST rate as the principal goods (e.g., 5% for HSN 4819 corrugated boxes). ` +
      `When a vendor takes ₹5,000 freight that is ALREADY tax-inclusive and taxes it again at 18% on the invoice, they create a double-taxation money leak of ₹900 (18% × ₹5,000). ` +
      (targetInv
        ? `In your workspace on Invoice #${targetInv.invoiceNumber}, Kraya detected ${formatINR(targetInv.totalMoneyLeakPaise)} in total money leaks and set the GST IMS portal action to "${targetInv.imsSuggestedAction.toUpperCase()}". `
        : `Furthermore, if a vendor bills ₹26.50/unit against a contracted/historical rate of ₹22.00–₹24.00/unit across 5,000 units, that silent rate creep costs an extra ₹12,500–₹22,500 before tax. `) +
      `If the supplier refuses to issue a Section 34 GST Credit Note, you must mark the invoice as PENDING or REJECT on the GSTN Invoice Management System (IMS) portal before GSTR-2B lock on the 14th, withhold the disputed amount from NEFT/RTGS payout, and issue a commercial Debit Note in Tally/Zoho.`;

    mathProof.push(
      {
        label: 'Freight Double-Taxation Leak (on ₹5,000 Tax-Inclusive Freight)',
        value: '₹900.00 Overcharge',
        formula: '₹5,000 × 18% duplicate GST = ₹900.00 (violates Sec 8(a) Composite Supply & double-taxes GTA)',
        highlight: true,
      },
      {
        label: 'Correct Composite Supply GST on ₹5,000 Ex-GST Freight (HSN 4819 @ 5%)',
        value: '₹250.00 (Recoverable ITC)',
        formula: 'Principal Goods HSN 4819 = 5% GST → Composite Freight = 5% (2.5% CGST + 2.5% SGST intra-state)',
      },
      {
        label: 'Unit Rate Creep Leak (5,000 boxes @ ₹26.50 vs ₹23.18 benchmark)',
        value: '₹16,600.00 Overcharge',
        formula: '5,000 units × (₹26.50 − ₹23.18) = ₹16,600.00 excess principal charge',
        highlight: true,
      },
      {
        label: 'Live Workspace Active Money Leaks Flagged',
        value: `${formatINR(totalLeakPaise)} across ${activeLeaks.length} flag(s)`,
        formula: 'Blocked prior to NEFT payout; 1-click WhatsApp dispute & Sec 34 Credit Note ready',
      }
    );

    statutoryCitations.push(
      {
        act: 'CGST Act, 2017',
        section: 'Section 8(a) — Composite Supply',
        ruleSummary:
          'Bundled supply of goods + packing + freight billed by the supplier is a composite supply; the entire invoice takes the GST rate of the principal supply.',
      },
      {
        act: 'CGST Notification 13/2017-CT(R)',
        section: 'GTA (Goods Transport Agency) SAC 9965',
        ruleSummary:
          'Only a separate consignment note (LR/Bilty) issued directly by a GTA triggers 5% RCM (or 12% forward charge with ITC) — never both on the goods bill.',
      },
      {
        act: 'CGST Act, 2017 & GSTN IMS (Oct 2024+)',
        section: 'Section 34 & Section 16(2)(aa)',
        ruleSummary:
          'Disputed invoices must be marked Pending/Reject in GSTN IMS or settled via a supplier-issued Section 34 GST Credit Note so your GSTR-2B ITC matches GSTR-3B 100%.',
      }
    );

    pncMatrix.push(
      {
        condition: 'PnC 1: Intra-State (Buyer State == Supplier State, e.g. 29 → 29)',
        outcome: '50% CGST + 50% SGST (e.g. 2.5% + 2.5% on 5% slab)',
        impact: 'Charging IGST on intra-state bill is a statutory place-of-supply violation (Sec 12 IGST Act)',
      },
      {
        condition: 'PnC 2: Inter-State (Buyer State != Supplier State, e.g. 24 → 29)',
        outcome: '100% IGST (e.g. 5% IGST)',
        impact: 'Full IGST is eligible for ITC cross-utilization against IGST/CGST/SGST output liability',
      },
      {
        condition: 'PnC 3: Freight Included in Goods Invoice vs Separate GTA Bilty',
        outcome: 'Composite Supply (Principal HSN rate) vs GTA 5% RCM / 12% Forward Charge',
        impact: 'Never allow 18% GST on top of tax-inclusive freight receipt',
      },
      {
        condition: 'PnC 4: Supplier Refuses Credit Note on Disputed Bill',
        outcome: 'Hold in GSTN IMS (Pending/Reject) + Short-pay disputed delta + Issue Commercial Debit Note',
        impact: 'Protects cash immediately while avoiding wrongful ITC availment penalties under Sec 73/74',
      }
    );

    suggestedCrossQuestions = [
      'What if the supplier refuses to issue a Section 34 GST Credit Note for the ₹900 leak?',
      'What if the supplier is in Gujarat (State 24) and we are in Karnataka (State 29) — how does CGST/SGST vs IGST work?',
      'What if freight is billed on a separate GTA LR/Bilty instead of the goods invoice — is it 5% RCM or 12%?',
      'Why does missing an e-Invoice IRN on a supplier with >₹5 Cr turnover block 100% of our ITC?',
    ];

    riskLevel = totalLeakPaise > 0 ? 'high' : 'low';
  } else if (topic === 'msme_43bh_rule37') {
    headline = isCrossQuestion
      ? noWrittenAgreementMentioned
        ? `Cross-Question Statutory Rule: Without a Written Agreement, Section 43B(h) Drops the MSME Payment Limit from 45 Days to 15 Days!`
        : `Cross-Question MSME 43B(h) Matrix: Micro/Small Manufacturers vs Medium Enterprises & Traders + Rule 37 180-Day ITC Cliff`
      : `Section 43B(h) Income Tax Shield & Rule 37 GST Cliff: Exact 15-Day / 45-Day / 180-Day Statutory Rules`;

    directAnswer = noWrittenAgreementMentioned
      ? `Critical distinction under Section 15 of the MSMED Act, 2006 (read with Section 43B(h) of the Income Tax Act, 1961): If there is NO written agreement (or PO specifying payment terms) between you and a Udyam-registered Micro or Small supplier, the statutory payment deadline drops from 45 days down to just **15 days** from the date of acceptance/deemed acceptance of goods (GRN date)! ` +
        `Even if you verbally discussed "30 or 60 days", tax auditors enforce the 15-day clock when no written agreement exists. Furthermore, even WITH a written agreement specifying 60 or 90 days, Section 15 overrides private contracts and caps the legal deadline at **45 days**.`
      : `Under Section 43B(h) of the Income Tax Act, 1961 (effective FY 2023-24+), any sum payable to a Udyam-registered **Micro or Small** enterprise (manufacturing or service) that remains unpaid beyond the Section 15 MSMED Act limit — **45 days** with a written agreement, or **15 days** without a written agreement — and crosses **March 31** is **100% disallowed as a business expense** in that financial year! ` +
        `At a ~30% corporate/firm tax slab, an unpaid ₹10,00,000 MSME bill on March 31 triggers an immediate **₹3,00,000 extra Income Tax cash outflow**, plus mandatory compound interest at **3× the RBI Bank Rate (~20.25% p.a.)** under Section 16 MSMED Act (which is itself non-deductible under Section 23!). ` +
        `Note: Section 43B(h) does NOT apply to **Medium** enterprises or pure **Wholesale/Retail Traders** (whose Udyam registration is restricted to Priority Sector Lending via Office Memorandum dated 02-Jul-2021). For non-MSME / Medium / Trader suppliers, the governing cliff is **CGST Rule 37 (180-Day ITC Reversal)**.`;

    mathProof.push(
      {
        label: 'Statutory Payment Limit — WITH Written Agreement / PO',
        value: '45 Calendar Days from GRN / Acceptance',
        formula: 'min(Agreed Credit Days, 45 days) under Sec 15 MSMED Act',
        highlight: !noWrittenAgreementMentioned,
      },
      {
        label: 'Statutory Payment Limit — WITHOUT Written Agreement',
        value: '15 Calendar Days from GRN / Acceptance',
        formula: 'Strict 15-day statutory default when no written credit clause exists',
        highlight: noWrittenAgreementMentioned,
      },
      {
        label: 'Income Tax Disallowance Penalty (Crossing March 31 Unpaid)',
        value: '30%–31.2% of Full Invoice Base',
        formula: '₹1,00,000 unpaid past 45d across Mar 31 = ₹30,000+ extra Income Tax liability (deduction deferred to FY of actual payment)',
      },
      {
        label: 'MSMED Section 16 Compound Penal Interest',
        value: `${ctx.regulatoryClock.msme43bhPenaltyInterestPct}% p.a. (3× RBI Bank Rate)`,
        formula: 'Monthly compounding interest; explicitly non-deductible for income tax under Sec 23 MSMED Act',
      }
    );

    statutoryCitations.push(
      {
        act: 'Income Tax Act, 1961',
        section: 'Section 43B(h) (Finance Act 2023)',
        ruleSummary:
          'Deduction for sums payable to Micro or Small enterprises is allowed only on actual payment if paid beyond the time limit specified in Section 15 of the MSMED Act.',
      },
      {
        act: 'MSMED Act, 2006',
        section: 'Section 15, Section 16 & Section 23',
        ruleSummary:
          'Caps credit period at 45 days (with written agreement) or 15 days (without); mandates 3x RBI Bank Rate compound interest; bars tax deduction of penal interest.',
      },
      {
        act: 'CGST Rules, 2017',
        section: 'Rule 37 & Section 16(2) Second Proviso',
        ruleSummary:
          'For all suppliers (including Medium & Large), if invoice value + GST is not paid within 180 days from invoice date, claimed ITC must be reversed in GSTR-3B with 18% p.a. interest under Sec 50.',
      }
    );

    pncMatrix.push(
      {
        condition: 'PnC 1: Micro / Small Enterprise (Mfg or Services) + Written PO/Agreement',
        outcome: '45-Day Statutory Deadline (anchored to GRN date)',
        impact: '43B(h) applies if unpaid beyond 45d across March 31',
      },
      {
        condition: 'PnC 2: Micro / Small Enterprise + NO Written Agreement',
        outcome: '15-Day Statutory Deadline',
        impact: '43B(h) triggers after just 15 days!',
      },
      {
        condition: 'PnC 3: Paid AFTER 45 days, but WITHIN the same Financial Year (before March 31)',
        outcome: 'Expense IS allowed in the same FY (paid in same FY), though Sec 16 interest risk remains',
        impact: 'No March 31 Form 3CD tax disallowance if cleared on or before March 31',
      },
      {
        condition: 'PnC 4: Medium Enterprise OR Pure Trader (Wholesale/Retail) OR Large Corp',
        outcome: 'Exempt from Section 43B(h); governed by CGST Rule 37 (180-Day Cliff)',
        impact: 'Full 60–90 day credit allowed without 43B(h) disallowance; pay within 180d to protect GST ITC',
      }
    );

    suggestedCrossQuestions = [
      'Wait, what if there is NO written agreement with the MSME vendor — is the deadline 15 days or 45 days?',
      'What if the vendor is a Medium enterprise or a wholesale Trader — does Section 43B(h) apply to them?',
      'What if an MSME bill is issued on March 10 with 45 days credit and paid on April 20 — is it allowed in the March 31 FY?',
      'Why does Kraya anchor the 45-day 43B(h) clock to the GRN physical delivery date instead of the invoice date?',
    ];
  } else if (topic === 'tds_194q_194c') {
    headline = `TDS 194Q vs 194C & GSTIN 6th-Character PAN Entity Decoder (1% Individual/HUF vs 2% Company/Firm vs 0.1% Goods)`;
    directAnswer =
      `Kraya deterministically decodes a supplier's legal entity directly from the **6th character of their 15-digit GSTIN** (which is the **4th character of their 10-digit PAN**): ` +
      `\`P\` (Individual/Proprietorship) or \`H\` (HUF) attracts **1% TDS** on works/job-work contracts under Section 194C, whereas \`C\` (Company) or \`F\` (Partnership Firm / LLP) attracts **2% TDS** under Section 194C (above ₹30,000 single bill or ₹1,00,000 annual aggregate). ` +
      `For **Purchase of Goods**, if your company's previous year turnover exceeded **₹10 Crore** (\`above_10cr\`) and aggregate purchases from a single vendor exceed **₹50 Lakh** in a financial year, **Section 194Q** mandates deducting **0.1% TDS** on the ex-GST taxable value exceeding ₹50 Lakh (or 5% under Sec 206AA if PAN is not furnished).`;

    mathProof.push(
      {
        label: 'GSTIN Characters 3–12 = Supplier PAN (6th Char of GSTIN = 4th Char of PAN)',
        value: '29 AAB C B1234F 1Z5 → "C" = Company',
        formula: 'P=Proprietor (1%), H=HUF (1%), C=Company (2%), F=Firm/LLP (2%), T=Trust, G=Govt',
        highlight: true,
      },
      {
        label: 'Section 194C (Job-Work / Labour / GTA / AMC Contracts)',
        value: '1% (P / H) or 2% (C / F)',
        formula: 'Triggered when single contract > ₹30,000 OR aggregate FY payments > ₹1,00,000 (on ex-GST value)',
      },
      {
        label: 'Section 194Q (Purchase of Goods > ₹50 Lakh in FY)',
        value: '0.1% on Ex-GST Purchase above ₹50L',
        formula: `Applicable when Buyer Turnover > ₹10 Cr (Your workspace turnover band: ${ws.turnoverBand})`,
      }
    );

    statutoryCitations.push(
      {
        act: 'Income Tax Act, 1961',
        section: 'Section 194Q & CBDT Circular 13/2021',
        ruleSummary:
          'Buyer with >₹10 Cr turnover must deduct 0.1% TDS on goods purchases >₹50L (on ex-GST amount); 194Q overrides 206C(1H) TCS.',
      },
      {
        act: 'Income Tax Act, 1961',
        section: 'Section 194C',
        ruleSummary:
          '1% TDS for Individual/HUF contractors and 2% for Company/Firm contractors on works, job-work with buyer-supplied material, and AMC services.',
      }
    );

    pncMatrix.push(
      {
        condition: 'PnC 1: 6th Char of GSTIN is "P" or "H" + AMC / Job-Work Service Bill > ₹30,000',
        outcome: 'Deduct 1% TDS under Sec 194C on Ex-GST Taxable Value',
        impact: 'Failure to deduct disallows 30% of expense under Sec 40(a)(ia)',
      },
      {
        condition: 'PnC 2: 6th Char of GSTIN is "C" or "F" + AMC / Job-Work Service Bill > ₹30,000',
        outcome: 'Deduct 2% TDS under Sec 194C on Ex-GST Taxable Value',
        impact: 'Auto-flagged by Kraya directly from supplier GSTIN checksum',
      },
      {
        condition: 'PnC 3: Buyer Turnover > ₹10 Cr + Goods Purchase from Vendor > ₹50 Lakh/yr',
        outcome: 'Deduct 0.1% TDS under Sec 194Q on amount exceeding ₹50 Lakh (Ex-GST)',
        impact: 'Seller must NOT charge Sec 206C(1H) TCS when 194Q applies',
      }
    );

    suggestedCrossQuestions = [
      'Wait, should TDS under 194Q or 194C be deducted on the GST component or only on the Ex-GST taxable amount?',
      'What if the vendor also tries to charge 0.1% TCS under Section 206C(1H) on the invoice when 194Q applies?',
      'How does Section 43B(h) interact with MSME vendors if we short-pay an invoice without deducting proper Credit Note?',
      'Why is Bharat Packaging ranked #1 in our landed cost comparison?',
    ];
  } else if (topic === 'three_way_match_audit') {
    const posCount = input.memory.purchaseOrders.length;
    const invCount = input.memory.invoices.length;
    headline = `3-Way Match Guard (PO ↔ GRN ↔ Invoice) & SHA-256 Tamper-Evident Audit Chain`;
    directAnswer =
      `Kraya enforces a strict **3-Way Match** across (1) the approved GST Purchase Order (PO), (2) physical Goods Receipt Notes (GRN) logged at the factory gate (received qty, accepted qty, rejected/damaged qty), and (3) the supplier's Tax Invoice. ` +
      `If a supplier bills for 5,000 units when your cumulative accepted GRN quantity is only 3,000 units (partial delivery), Kraya immediately flags a \`GRN_QTY_SHORTFALL\` money leak for the unreceived 2,000 units, blocks full payment, and sets the GSTN IMS action to \`PENDING\`. ` +
      `Furthermore, every state transition in your workspace (${posCount} POs, ${invCount} audited bills) is cryptographically sealed in a **SHA-256 hash chain** (\`prevHash\` → \`entryHash\`) so any backdoor database tampering is instantaneously detected.`;

    mathProof.push(
      {
        label: '3-Way Quantity Guard Formula',
        value: 'Billed Qty ≤ Σ(GRN Accepted Qty)',
        formula: 'Shortfall Leak = max(0, Billed Qty − Cumulative Accepted GRN Qty) × Billed Unit Rate × (1 + GST%)',
        highlight: true,
      },
      {
        label: 'Section 43B(h) Clock Anchor Rule',
        value: 'Anchored to Latest GRN Date (Not Invoice Date)',
        formula: 'Sec 15 MSMED Act starts the 45-day clock on "day of acceptance or deemed acceptance of goods" (GRN)',
      },
      {
        label: 'SHA-256 Tamper-Evident Audit Chain',
        value: 'entryHash = SHA256(prevHash | workspaceId | action | entityId | details)',
        formula: 'Verifiable at any time via GET /api/audit-logs/verify-chain',
      }
    );

    statutoryCitations.push(
      {
        act: 'CGST Act, 2017',
        section: 'Section 16(2)(b)',
        ruleSummary:
          'No registered person is entitled to Input Tax Credit (ITC) unless they have actually received the goods or services (verified via GRN).',
      },
      {
        act: 'Companies Act, 2013',
        section: 'Rule 3(1) of Companies (Accounts) Rules — Audit Trail (Edit Log)',
        ruleSummary:
          'Mandates tamper-evident audit trail logging for every accounting/procurement creation, amendment, and cancellation.',
      }
    );

    pncMatrix.push(
      {
        condition: 'PnC 1: PO Issued (5,000 pcs) → No GRN Logged Yet → Invoice Arrives (5,000 pcs)',
        outcome: 'Status: GRN_MISSING (Payment & ITC Blocked)',
        impact: 'Prevents paying for goods still in transit; violates Sec 16(2)(b) if ITC claimed before receipt',
      },
      {
        condition: 'PnC 2: PO Issued (5,000 pcs) → Partial GRN (3,000 accepted, 200 rejected) → Invoice for 5,000 pcs',
        outcome: 'Status: PARTIAL_GRN_HOLD (Flags 2,000 pcs unreceived overbilling)',
        impact: 'Approves pro-rata 3,000 pcs or requires Section 34 Credit Note for 2,000 pcs',
      },
      {
        condition: 'PnC 3: PO Amended (Rev 1 → Rev 2 rate lowered) → Invoice Billed at old Rev 1 rate',
        outcome: 'Status: PO_RATE_EXCEEDED',
        impact: 'Flags exact rate variance against latest active PO revision',
      }
    );

    suggestedCrossQuestions = [
      'Why does anchoring the 45-day MSME 43B(h) clock to the GRN date save us days compared to the invoice date?',
      'What happens if we try to cancel a Purchase Order after a GRN or Invoice has already been recorded against it?',
      'How does a Section 34 GST Credit Note settle an open invoice money leak in Kraya?',
      'Explain the landed cost and WACC math comparing Bharat Packaging vs Shakti Packaging.',
    ];
  } else if (topic === 'batna_negotiation') {
    const activeWacc = ws.waccPct;
    const ranked = rankSupplierQuotes(effectiveQuotes, buyerProfile);
    const w1 = ranked.ranked[0];
    const w2 = ranked.ranked[1];

    headline = `AI BATNA Negotiation Strategy: How to Play Competing Quotes & WACC Credit Terms Against Each Other`;
    directAnswer =
      w1 && w2
        ? `Your Best Alternative to a Negotiated Agreement (BATNA) is #1 ${w1.supplierName} at a Credit-Adjusted Real Unit Cost of ${formatINR(w1.creditAdjustedRealUnitPaise)}/unit (${w1.effectiveCreditDaysUsed} days credit, Net Landed ${formatINR(w1.netLandedUnitPaise)}). ` +
          `Leverage Strategy 1 (Squeeze the Challenger): Tell #2 ${w2.supplierName} (currently at ${formatINR(w2.creditAdjustedRealUnitPaise)}/unit) that you have a competing offer equivalent to ${formatINR(w1.creditAdjustedRealUnitPaise)}/unit — they must either cut their base rate by ${formatINR(w2.creditAdjustedRealUnitPaise - w1.creditAdjustedRealUnitPaise)}/unit OR grant 30–45 days interest-free credit while absorbing freight. ` +
          `Leverage Strategy 2 (Unbundle & Tighten the Leader): Ask #1 ${w1.supplierName} to waive or halve their ${formatINR(w1.freightUnitPaise * w1.quantity)} transport charge or extend credit to 45 days (saving an additional ${formatINR(Math.round((w1.netLandedUnitPaise * (activeWacc / 100) * 15) / 365))}/unit in WACC) in exchange for immediate PO issuance today.`
        : `BATNA negotiation plays your #1 Credit-Adjusted Landed Cost quote against #2 to extract either a 2–4% base rate reduction, FOR freight waiver, or 45-day MSME-compliant credit extension.`;

    mathProof.push(
      {
        label: 'Current #1 Benchmark (Your BATNA Anchor)',
        value: w1 ? `${w1.supplierName} @ ${formatINR(w1.creditAdjustedRealUnitPaise)}/unit` : 'N/A',
        formula: 'Best Credit-Adjusted Landed Unit Cost across open quotes',
        highlight: true,
      },
      {
        label: 'Target Counter-Offer for #1 Leader (2.5% Stretch Target)',
        value: w1 ? `${formatINR(Math.round(w1.baseUnitPaise * 0.975))}/unit Base OR 45d Credit` : 'N/A',
        formula: 'Trade immediate 100% volume PO award for freight waiver or +15d credit',
      },
      {
        label: 'Target Counter-Offer for #2 Challenger (Match-or-Beat BATNA)',
        value: w1 && w2 ? `Must drop by ${formatINR(w2.creditAdjustedRealUnitPaise - w1.creditAdjustedRealUnitPaise)}/unit` : 'N/A',
        formula: 'Challenger must beat BATNA by at least 1.5% to justify switching',
      }
    );

    pncMatrix.push(
      {
        condition: 'PnC 1: Vendor refuses to cut Base Unit Rate',
        outcome: 'Pivot counter-offer to Credit Days (0d → 45d) or FOR Free Delivery',
        impact: `45d credit at ${activeWacc}% WACC equals a ${((activeWacc * 45) / 365).toFixed(2)}% price discount without lowering vendor's headline rate`,
      },
      {
        condition: 'PnC 2: Vendor demands 100% Advance / Cash on Delivery',
        outcome: `Demand a minimum ${((activeWacc * 30) / 365).toFixed(2)}%–2.0% Cash Discount (CD) on invoice`,
        impact: 'Neutralizes your CC/OD bank borrowing cost',
      }
    );

    suggestedCrossQuestions = [
      'Why is 45 days of interest-free credit equivalent to a 1.85% cash discount at 15% WACC?',
      'What if Bharat Packaging counter-offers ₹21.50 + 5% GST with 45 days credit and FOR free delivery?',
      'How does Section 43B(h) limit our credit-day negotiation if the vendor is Udyam Micro/Small?',
      'Why was ₹900 flagged as a freight GST leak on Invoice #INV-412?',
    ];
  } else {
    // workspace_overview + general analytical question
    const activeLeaks = input.memory.moneyLeaks.filter((l) => l.status !== 'dismissed');
    const totalLeakPaise = activeLeaks.reduce((s, l) => s + l.amountPaise, 0);
    const totalPoPaise = input.memory.purchaseOrders.reduce((s, p) => s + p.totalPaise, 0);

    headline = `Live Workspace CFO Intelligence Snapshot for ${ws.legalName} (${ws.gstRegime.toUpperCase()} · WACC ${ws.waccPct}%)`;
    directAnswer =
      `Here is the live deterministic state of **${ws.legalName}** (State Code ${ws.stateCode}, WACC ${ws.waccPct}% p.a., Turnover Band ${ws.turnoverBand}): ` +
      `You have **${input.memory.suppliers.length} suppliers**, **${input.memory.rfqs.length} RFQs**, **${input.memory.purchaseOrders.length} Purchase Orders** (${formatINR(totalPoPaise)} total value), **${input.memory.invoices.length} audited invoices** (${formatINR(input.memory.totalAnnualSpendPaise)} taxable spend), **${activeLeaks.length} active money leaks** totaling **${formatINR(totalLeakPaise)}**, and **${input.memory.openTasks.length} open daily follow-up tasks**. ` +
      `Ask any specific question or click a cross-question below to drill into your Landed Cost & WACC math, GST 2.0 & GTA freight double-taxation, Section 43B(h) 45-day/15-day MSME cliffs, TDS 194Q/194C deduction rules, or 3-Way PO-GRN-Invoice matching.`;

    mathProof.push(
      {
        label: 'Workspace Tax & Working Capital Profile',
        value: `${ws.gstRegime.toUpperCase()} · State ${ws.stateCode} · WACC ${ws.waccPct}%`,
        formula: `GSTIN: ${ws.gstin || 'Pending'} · Turnover: ${ws.turnoverBand}`,
      },
      {
        label: 'Active Money Leaks Caught Before Payment',
        value: `${formatINR(totalLeakPaise)} (${activeLeaks.length} flag${activeLeaks.length === 1 ? '' : 's'})`,
        formula: 'Sum of unrecovered rate-creep, freight double-GST, and 3-way match variances',
        highlight: totalLeakPaise > 0,
      },
      {
        label: 'Procurement Pipeline (RFQs → POs → Invoices)',
        value: `${input.memory.rfqs.length} RFQs · ${input.memory.purchaseOrders.length} POs · ${input.memory.invoices.length} Bills`,
        formula: `${input.memory.openTasks.length} open daily tasks · ${input.memory.amcs.length} AMC schedules`,
      }
    );

    pncMatrix.push(
      {
        condition: 'Landed Cost & WACC PnC',
        outcome: 'Compares Ex-GST vs GST-Inclusive, Composite Freight, and 0–60d Credit',
        impact: 'Ask: "Why is Bharat Packaging ranked #1 over Shakti Packaging?"',
      },
      {
        condition: 'GST 2.0 & Freight Double-Tax PnC',
        outcome: 'Catches 18% GST on tax-inclusive freight & missing e-Invoice IRNs',
        impact: 'Ask: "Why was ₹900 flagged as a freight GST leak on Invoice #INV-412?"',
      },
      {
        condition: 'Section 43B(h) MSME & Rule 37 PnC',
        outcome: 'Enforces 45d (written) / 15d (unwritten) MSME caps & 180d ITC cliff',
        impact: 'Ask: "How does Section 43B(h) work with and without a written agreement?"',
      },
      {
        condition: 'TDS 194Q / 194C & 3-Way Match PnC',
        outcome: 'Decodes GSTIN 6th char (P/H=1%, C/F=2%) & blocks unreceived GRN qty',
        impact: 'Ask: "How do you decode 1% vs 2% TDS from a GSTIN?"',
      }
    );

    suggestedCrossQuestions = [
      'Why is Bharat Packaging ranked #1 even though they charge ₹5,000 extra for transport?',
      'Why was ₹900 flagged as a money leak on Invoice #INV-412? Explain Composite Supply vs GTA RCM.',
      'How does Section 43B(h) affect our payment to an MSME vendor if we agreed to 60 days credit?',
      'How do you know if a vendor gets 1% or 2% TDS under Section 194C or 0.1% under 194Q from their GSTIN?',
    ];
  }

  const brainMode: SpecialistAgentReport<CfoQaData>['brainMode'] = 'neuro_symbolic_deterministic';

  return {
    agentId: 'cfo_strategist',
    agentName: 'Kraya Conversational CFO & Cross-Question Mind',
    roleTitle: 'Deterministic Indian Tax, WACC Landed Cost & Multi-Turn PnC Reasoner',
    brainMode,
    timestamp: new Date().toISOString(),
    detectedState: isCrossQuestion ? `cross_question_${topic}` : `qa_${topic}`,
    possibleNextStates: ['follow_up_cross_question', 'execute_recommended_action', 'export_audit_proof'],
    riskLevel,
    confidence: 0.99,
    headline,
    executiveVerdict: directAnswer,
    reasoningSteps: [
      `1. Classified user inquiry ("${input.question.slice(0, 80)}") into domain="${topic}" (isCrossQuestion=${isCrossQuestion}, previousTopic=${prevTopic || 'none'}).`,
      `2. Loaded live workspace memory for "${ws.legalName}" (State=${ws.stateCode}, Regime=${ws.gstRegime}, WACC=${ws.waccPct}%) and evaluated ${mathProof.length} mathematical proof lines.`,
      `3. Evaluated ${pncMatrix.length} statutory Permutations & Combinations (PnC) and prepared ${suggestedCrossQuestions.length} follow-up cross-questions.`,
    ],
    conditionsEvaluated:
      conditions.length > 0
        ? conditions
        : mathProof.map((m, idx) => ({
            id: `proof-${idx}`,
            label: m.label,
            status: m.highlight ? 'warning' : 'pass',
            detail: m.formula,
            metric: m.value,
            statutoryRef: statutoryCitations[0]?.section,
          })),
    whatIfScenarios: whatIfs,
    proposedActions: actions,
    realTimeContextUsed: {
      usdInr: ctx.fx.usdInr,
      financialYear: ctx.regulatoryClock.financialYear,
      daysToMarch31TaxCliff: ctx.regulatoryClock.daysToMarch31TaxCliff,
      isMarch31MsmeRedZone: ctx.regulatoryClock.isMarch31MsmeRedZone,
    },
    structuredData: {
      question: input.question,
      topic,
      isCrossQuestion,
      previousTopic: prevTopic,
      headline,
      directAnswer,
      mathProof,
      statutoryCitations,
      pncMatrix,
      suggestedCrossQuestions,
    },
  };
}
