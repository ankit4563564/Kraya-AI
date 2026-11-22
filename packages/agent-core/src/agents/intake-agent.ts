import { formatINR, toPaise } from '@kraya/finance-engine';
import { classifyProcurementIntake } from '../constitution.js';
import { extractWithGemini, ExtractedProcurementPayload } from '../gemini.js';
import { extractDeterministically } from '../local-parser.js';
import { parseBomIndentTable } from '../bom-import.js';
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

export interface IntakeAgentInput {
  promptText: string;
  channel: string;
  fileName?: string | null;
  fileMime?: string | null;
  mediaBase64?: string;
  transcriptText?: string | null;
  memory: WorkspaceLiveMemory;
  config?: AgentRuntimeConfig;
}

export interface IntakeAgentData {
  extracted: ExtractedProcurementPayload;
  intakeClassification: ReturnType<typeof classifyProcurementIntake>;
  reExtractionTriggered: boolean;
  mathReconciliation: {
    checked: boolean;
    passed: boolean;
    computedTaxablePaise: number | null;
    statedTaxablePaise: number | null;
    computedGrandTotalPaise: number | null;
    statedGrandTotalPaise: number | null;
    discrepancyPaise: number;
  };
  bomPreview?: {
    detected: boolean;
    validRowCount: number;
    skippedRowCount: number;
  };
  focusedClarificationQuestion: string | null;
}

function checkExtractedMath(ex: ExtractedProcurementPayload): IntakeAgentData['mathReconciliation'] {
  const validItems = ex.items.filter(
    (it) => typeof it.qty === 'number' && it.qty > 0 && typeof it.unitRateRupees === 'number'
  );
  if (validItems.length === 0 || (ex.statedTaxableRupees === null && ex.statedGrandTotalRupees === null)) {
    return {
      checked: false,
      passed: true,
      computedTaxablePaise: null,
      statedTaxablePaise: ex.statedTaxableRupees !== null ? toPaise(ex.statedTaxableRupees) : null,
      computedGrandTotalPaise: null,
      statedGrandTotalPaise: ex.statedGrandTotalRupees !== null ? toPaise(ex.statedGrandTotalRupees) : null,
      discrepancyPaise: 0,
    };
  }

  let computedTaxablePaise = 0;
  let computedTaxPaise = 0;
  for (const it of validItems) {
    const qty = it.qty!;
    const unitPaise = toPaise(it.unitRateRupees!);
    const disc = it.discountRupees ? toPaise(it.discountRupees) : 0;
    const lineTaxable = Math.max(0, Math.round(qty * unitPaise) - disc);
    computedTaxablePaise += lineTaxable;
    const gstPct = it.gstPct ?? 18;
    computedTaxPaise += Math.round((lineTaxable * gstPct) / 100);
  }
  const freightPaise = ex.freightRupees ? toPaise(ex.freightRupees) : 0;
  if (freightPaise > 0 && ex.freightGstMode === 'composite_supply') {
    const leadGst = validItems[0]?.gstPct ?? 18;
    computedTaxablePaise += freightPaise;
    computedTaxPaise += Math.round((freightPaise * leadGst) / 100);
  } else if (freightPaise > 0) {
    computedTaxablePaise += freightPaise;
  }

  const roundOffPaise = ex.statedRoundOffRupees ? toPaise(ex.statedRoundOffRupees) : 0;
  const computedGrandTotalPaise = computedTaxablePaise + computedTaxPaise + roundOffPaise;

  const statedTaxablePaise = ex.statedTaxableRupees !== null ? toPaise(ex.statedTaxableRupees) : null;
  const statedGrandTotalPaise =
    ex.statedGrandTotalRupees !== null ? toPaise(ex.statedGrandTotalRupees) : null;

  let discrepancyPaise = 0;
  if (statedTaxablePaise !== null) {
    discrepancyPaise = Math.max(discrepancyPaise, Math.abs(computedTaxablePaise - statedTaxablePaise));
  }
  if (statedGrandTotalPaise !== null) {
    discrepancyPaise = Math.max(
      discrepancyPaise,
      Math.abs(computedGrandTotalPaise - statedGrandTotalPaise)
    );
  }

  // Tolerance: ₹1 (100 paise) for invoice rounding
  const passed = discrepancyPaise <= 100;
  return {
    checked: true,
    passed,
    computedTaxablePaise,
    statedTaxablePaise,
    computedGrandTotalPaise,
    statedGrandTotalPaise,
    discrepancyPaise,
  };
}

/**
 * AGENT 1: Intake & Document Forensics Mind.
 * Handles messy WhatsApp chats, Hinglish shorthand, PDFs, scanned parchis, voice transcripts, and BOM tables.
 * Enforces Prompt Injection defense, self-verifying arithmetic with targeted re-extraction pass, and
 * single-question clarification discipline (never inventing missing fields).
 */
export async function runIntakeForensicsAgent(
  input: IntakeAgentInput
): Promise<SpecialistAgentReport<IntakeAgentData>> {
  const ctx =
    input.config?.realTimeContext ??
    (await buildRealTimeMarketContext({ skipNetwork: input.config?.skipNetwork }));

  const combinedText = [input.promptText, input.transcriptText].filter(Boolean).join('\n').trim();
  const hasAttachment = Boolean(input.mediaBase64 || input.fileName);
  const intake = classifyProcurementIntake(combinedText || input.fileName || '', hasAttachment);

  const reasoningSteps: string[] = [];
  const conditions: ConditionEvaluation[] = [];
  const proposedActions: ProposedAgentAction[] = [];
  const whatIfScenarios: WhatIfScenario[] = [];

  reasoningSteps.push(
    `1. Classified incoming ${input.channel} signal: verb="${intake.verbClass}", pillar="${intake.pillar}", attachment=${hasAttachment ? input.fileName || input.fileMime : 'none'}.`
  );

  // Condition 1: Prompt Injection Firewall (Accio Invariant 14)
  if (intake.detectedPromptInjection) {
    conditions.push({
      id: 'prompt_injection_firewall',
      label: 'Prompt Injection Firewall (Content is Data)',
      status: 'fail',
      detail:
        'Embedded instruction-override phrasing detected inside external text. Isolated strictly inside <untrusted_vendor_data> fence and stripped of all execution privileges.',
      statutoryRef: 'Accio Invariant #14',
    });
    reasoningSteps.push(
      '2. SECURITY ALERT: Neutralized embedded directive attempt inside input text; proceeding purely as untrusted data extraction with zero auto-approvals.'
    );
  } else {
    conditions.push({
      id: 'prompt_injection_firewall',
      label: 'Prompt Injection Firewall',
      status: 'pass',
      detail: 'No instruction-override or privilege-escalation strings detected.',
    });
  }

  // Condition 2: Detect Tabular BOM / Purchase Indent
  const looksTabular =
    combinedText.includes('\n') &&
    (combinedText.includes(',') || combinedText.includes('\t')) &&
    /(item|description|qty|quantity|hsn|unit)/i.test(combinedText.split('\n')[0] || '');
  const bomParsed = looksTabular ? parseBomIndentTable(combinedText) : null;
  const isBomTable = Boolean(bomParsed && bomParsed.validRows.length >= 2);
  if (isBomTable) {
    conditions.push({
      id: 'bom_table_detected',
      label: 'Multi-Row BOM / Purchase Indent Detected',
      status: 'info',
      detail: `Detected ${bomParsed!.validRows.length} valid procurement line items (${bomParsed!.skippedRows.length} skipped). Suitable for 1-click Bulk RFQ Import.`,
      metric: `${bomParsed!.validRows.length} items`,
    });
    reasoningSteps.push(
      `2b. Recognized structured CSV/TSV Bill of Materials with ${bomParsed!.validRows.length} items; recommending bulk RFQ creation instead of single-quote parsing.`
    );
  }

  // Stage 2: Extract atomic structured fields via Gemini Live or Deterministic Parser
  let extracted: ExtractedProcurementPayload;
  let brainMode: SpecialistAgentReport['brainMode'] = 'neuro_symbolic_deterministic';
  let modelUsed: string | undefined;
  let reExtractionTriggered = false;

  if (input.config?.geminiApiKey && !input.config.skipNetwork) {
    try {
      extracted = await extractWithGemini({
        apiKey: input.config.geminiApiKey,
        model: input.config.geminiModel,
        workspace: input.memory.workspace,
        policyPatchMd: input.memory.workspace.policyPatchMd,
        channel: input.channel,
        textInput: combinedText,
        mediaBase64: input.mediaBase64,
        mediaMimeType: input.fileMime || undefined,
      });
      brainMode = 'neuro_symbolic_gemini_live';
      modelUsed = input.config.geminiModel || 'gemini-2.5-flash';
      reasoningSteps.push(
        `3. Extracted atomic fields via live Gemini Multimodal (${modelUsed}): kind="${extracted.documentKind}", confidence=${Math.round(extracted.overallConfidence * 100)}%, items=${extracted.items.length}.`
      );
    } catch (err) {
      extracted = extractDeterministically(combinedText || input.fileName || '', input.channel);
      reasoningSteps.push(
        `3. Live Gemini unavailable (${err instanceof Error ? err.message.slice(0, 80) : 'timeout'}); fell back cleanly to deterministic Indian Hinglish parser.`
      );
    }
  } else {
    extracted = extractDeterministically(combinedText || input.fileName || '', input.channel);
    reasoningSteps.push(
      `3. Extracted atomic fields via deterministic Indian Hinglish & shorthand parser: kind="${extracted.documentKind}", confidence=${Math.round(extracted.overallConfidence * 100)}%, items=${extracted.items.length}.`
    );
  }

  // Stage 3: Self-Verifying Invoice Math Audit + Automatic Targeted Re-Extraction Pass
  let mathCheck = checkExtractedMath(extracted);
  if (mathCheck.checked && !mathCheck.passed && input.config?.geminiApiKey && !input.config.skipNetwork) {
    reExtractionTriggered = true;
    const hint = `Computed taxable=${mathCheck.computedTaxablePaise !== null ? formatINR(mathCheck.computedTaxablePaise) : 'n/a'} vs stated taxable=${mathCheck.statedTaxablePaise !== null ? formatINR(mathCheck.statedTaxablePaise) : 'n/a'}; computed grand total=${mathCheck.computedGrandTotalPaise !== null ? formatINR(mathCheck.computedGrandTotalPaise) : 'n/a'} vs stated=${mathCheck.statedGrandTotalPaise !== null ? formatINR(mathCheck.statedGrandTotalPaise) : 'n/a'} (gap ${formatINR(mathCheck.discrepancyPaise)}). Verify whether any digit in qty, rate, discount, freight, or GST % was misread.`;
    reasoningSteps.push(
      `4. Math Self-Audit FAILED (gap ${formatINR(mathCheck.discrepancyPaise)} > ₹1 tolerance). Triggering targeted second re-extraction pass.`
    );
    try {
      const retryExtracted = await extractWithGemini({
        apiKey: input.config.geminiApiKey,
        model: input.config.geminiModel,
        workspace: input.memory.workspace,
        policyPatchMd: input.memory.workspace.policyPatchMd,
        channel: input.channel,
        textInput: combinedText,
        mediaBase64: input.mediaBase64,
        mediaMimeType: input.fileMime || undefined,
        reExtractionHint: hint,
      });
      const retryMath = checkExtractedMath(retryExtracted);
      if (retryMath.discrepancyPaise < mathCheck.discrepancyPaise) {
        extracted = retryExtracted;
        mathCheck = retryMath;
        reasoningSteps.push(
          `4b. Re-extraction improved math accuracy (new gap ${formatINR(mathCheck.discrepancyPaise)}, passed=${mathCheck.passed}).`
        );
      } else {
        reasoningSteps.push(
          `4b. Re-extraction confirmed persistent ${formatINR(mathCheck.discrepancyPaise)} arithmetic discrepancy — likely genuine Supplier Arithmetic Overcharge (Money Leak) or smudged bill.`
        );
      }
    } catch {
      reasoningSteps.push('4b. Re-extraction pass skipped due to transient API error; retaining discrepancy flag.');
    }
  }

  if (mathCheck.checked) {
    conditions.push({
      id: 'math_self_audit',
      label: 'Self-Verifying Arithmetic Reconciliation',
      status: mathCheck.passed ? 'pass' : 'fail',
      detail: mathCheck.passed
        ? 'Line-item Qty × Rate + Tax reconciles within ₹1.00 tolerance.'
        : `Arithmetic mismatch of ${formatINR(mathCheck.discrepancyPaise)} detected between line items and stated totals. Requires verification or Money Leak dispute.`,
      metric: mathCheck.passed ? 'Matched (≤₹1)' : `Gap: ${formatINR(mathCheck.discrepancyPaise)}`,
    });
  }

  // Condition 4: Missing Critical Indian Procurement Fields (Never Invent!)
  const criticalMissing: string[] = [...extracted.missingFields];
  if (extracted.documentKind === 'quote' || extracted.documentKind === 'invoice') {
    if (extracted.freightRupees === null && extracted.freightGstMode === 'unknown' && !criticalMissing.includes('freight')) {
      criticalMissing.push('freight_terms');
    }
    if (extracted.creditDays === null && extracted.documentKind === 'quote' && !criticalMissing.includes('credit_days')) {
      criticalMissing.push('credit_days');
    }
    if (extracted.isGstInclusive === null && !criticalMissing.includes('gst_inclusive_or_extra')) {
      criticalMissing.push('gst_inclusive_or_extra');
    }
  }

  conditions.push({
    id: 'completeness_check',
    label: 'Atomic Field Completeness (Zero-Hallucination Check)',
    status: criticalMissing.length === 0 ? 'pass' : 'warning',
    detail:
      criticalMissing.length === 0
        ? 'All pricing, tax, freight, and payment term fields explicitly present with raw evidence quotes.'
        : `Missing fields kept strictly null (never guessed): ${criticalMissing.join(', ')}.`,
    metric: `${extracted.evidence.length} cited quotes`,
  });

  // Condition 5: Indian Shorthand & Confidence Gate (< 0.85)
  const lowConfFields = extracted.evidence.filter((e) => e.confidence < 0.85);
  conditions.push({
    id: 'confidence_gate',
    label: 'OCR / Hinglish Confidence Gate (Threshold ≥ 85%)',
    status: extracted.overallConfidence >= 0.85 && lowConfFields.length === 0 ? 'pass' : 'warning',
    detail:
      lowConfFields.length === 0 && extracted.overallConfidence >= 0.85
        ? `High-confidence capture (${Math.round(extracted.overallConfidence * 100)}%).`
        : `${lowConfFields.length || 1} uncertain field(s) flagged for 1-click human verification before any PO or outbound dispute.`,
    metric: `${Math.round(extracted.overallConfidence * 100)}%`,
  });

  // Determine exact state from the 9-state Intake FSM
  let detectedState = 'clean_quote';
  let riskLevel: RiskLevel = 'low';
  let possibleNextStates: string[] = ['cfo_landed_cost_comparison', 'negotiation_strategy'];

  if (intake.detectedPromptInjection) {
    detectedState = 'prompt_injection_blocked';
    riskLevel = 'critical';
    possibleNextStates = ['manual_human_review'];
  } else if (isBomTable) {
    detectedState = 'bom_table';
    riskLevel = 'low';
    possibleNextStates = ['bulk_rfq_import', 'supplier_discovery'];
  } else if (extracted.documentKind === 'invoice') {
    if (mathCheck.checked && !mathCheck.passed) {
      detectedState = 'math_mismatch_invoice';
      riskLevel = 'high';
      possibleNextStates = ['money_leak_dispute', 'human_ocr_verify'];
    } else if (extracted.overallConfidence < 0.85) {
      detectedState = 'handwritten_parchi_low_conf';
      riskLevel = 'medium';
      possibleNextStates = ['human_ocr_verify', 'po_3way_audit'];
    } else {
      detectedState = 'clean_invoice';
      riskLevel = 'low';
      possibleNextStates = ['po_3way_audit', 'gstr2b_reconciliation'];
    }
  } else if (extracted.documentKind === 'rfq_request' || intake.pillar === 'initial_rfq') {
    detectedState = 'new_rfq_request';
    riskLevel = 'low';
    possibleNextStates = ['supplier_discovery', 'draft_rfq_outreach'];
  } else if (
    extracted.documentKind === 'maintenance_note' ||
    extracted.documentKind === 'followup_note'
  ) {
    detectedState = 'maintenance_or_followup';
    riskLevel = 'low';
    possibleNextStates = ['operations_daily_task', 'amc_schedule'];
  } else if (extracted.overallConfidence < 0.85 || criticalMissing.length >= 2) {
    detectedState = 'ambiguous_hinglish_quote';
    riskLevel = 'medium';
    possibleNextStates = ['human_ocr_verify', 'vendor_clarification_whatsapp'];
  } else {
    detectedState = 'clean_quote';
    riskLevel = 'low';
    possibleNextStates = ['cfo_landed_cost_comparison', 'negotiation_strategy', 'po_approval_gate'];
  }

  // Build focused 1-question clarification (Accio Invariant #2)
  let focusedClarificationQuestion: string | null = null;
  if (criticalMissing.includes('freight_terms') && criticalMissing.includes('credit_days')) {
    focusedClarificationQuestion =
      'Before ranking landed cost: is freight included (FOR) or extra, and what are the exact credit days?';
  } else if (criticalMissing.includes('freight_terms')) {
    focusedClarificationQuestion =
      'Is freight/transport included in this rate (FOR) or charged extra (Ex-Works / GTA Bilty)?';
  } else if (criticalMissing.includes('credit_days')) {
    focusedClarificationQuestion =
      'What payment credit terms (Advance / Net 15 / Net 30 / Net 45) apply to this quote?';
  } else if (criticalMissing.includes('gst_inclusive_or_extra')) {
    focusedClarificationQuestion = 'Is the quoted unit rate GST-extra (+18%/5%) or GST-inclusive?';
  }

  // Propose concrete actions
  if (detectedState === 'bom_table') {
    proposedActions.push({
      id: 'act_bulk_bom',
      title: `Import ${bomParsed!.validRows.length} BOM rows as RFQs`,
      actionType: 'create_rfq',
      requiresHumanApproval: true,
      priority: 'high',
      rationale: 'Structured multi-row indent detected; bulk import saves manual RFQ entry.',
      suggestedPayload: { rowCount: bomParsed!.validRows.length },
    });
  }
  if (extracted.needsVerification || !mathCheck.passed) {
    proposedActions.push({
      id: 'act_verify_intake',
      title: '1-Click Verify Uncertain / Mismatched Fields in Inbox',
      actionType: 'verify_fields',
      requiresHumanApproval: true,
      priority: !mathCheck.passed ? 'critical' : 'high',
      rationale: !mathCheck.passed
        ? `Math mismatch of ${formatINR(mathCheck.discrepancyPaise)} must be confirmed as OCR blur vs genuine supplier overcharge.`
        : `Confidence ${Math.round(extracted.overallConfidence * 100)}% or missing fields (${criticalMissing.join(', ')}) require human confirmation.`,
    });
  }
  if (focusedClarificationQuestion && extracted.supplierName) {
    proposedActions.push({
      id: 'act_clarify_vendor',
      title: `Ask ${extracted.supplierName} for missing commercial terms`,
      actionType: 'send_whatsapp',
      requiresHumanApproval: true,
      priority: 'medium',
      rationale: focusedClarificationQuestion,
    });
  }

  // What-if scenario for ambiguous quote terms
  if (extracted.items[0]?.unitRateRupees && extracted.isGstInclusive === null) {
    const ratePaise = toPaise(extracted.items[0].unitRateRupees);
    const gstSwing = Math.round(ratePaise * 0.18);
    whatIfScenarios.push({
      id: 'whatif_gst_inclusive',
      title: 'GST-Extra vs GST-Inclusive Rate Swing',
      assumption: 'If the stated rate turns out to be GST-extra (+18%) instead of inclusive',
      impactSummary: `Cash outflow increases by ${formatINR(gstSwing)}/unit upfront (recoverable only if Regular GST + non-17(5) item).`,
      financialDeltaPaise: gstSwing * (extracted.items[0].qty || 1),
      recommendation: 'Confirm GST-inclusive vs GST-extra in writing before issuing PO.',
    });
  }

  const headline =
    detectedState === 'prompt_injection_blocked'
      ? 'Prompt Injection Neutralized — Data Isolated Safely'
      : detectedState === 'math_mismatch_invoice'
        ? `Invoice Math Discrepancy (${formatINR(mathCheck.discrepancyPaise)}) Flagged for Audit`
        : detectedState === 'bom_table'
          ? `Multi-Line BOM Detected (${bomParsed!.validRows.length} Items Ready for Bulk RFQs)`
          : `${extracted.documentKind.replace(/_/g, ' ').toUpperCase()} Captured (${Math.round(extracted.overallConfidence * 100)}% Confidence)`;

  const executiveVerdict =
    detectedState === 'math_mismatch_invoice'
      ? `Stop and check: stated bill totals differ from line-item math by ${formatINR(mathCheck.discrepancyPaise)}. Confirm whether this is an OCR misread or a supplier arithmetic overcharge before approving payment.`
      : focusedClarificationQuestion
        ? `${extracted.summary} ${focusedClarificationQuestion}`
        : `${extracted.summary} Cleanly structured with ${extracted.evidence.length} cited evidence quote(s) and ready for downstream CFO evaluation.`;

  return {
    agentId: 'intake',
    agentName: 'Intake & Document Forensics Agent',
    roleTitle: 'Multimodal Extraction, Math Self-Audit & Hinglish Normalizer',
    brainMode,
    modelUsed,
    timestamp: new Date().toISOString(),
    detectedState,
    possibleNextStates,
    riskLevel,
    confidence: extracted.overallConfidence,
    headline,
    executiveVerdict,
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
      extracted,
      intakeClassification: intake,
      reExtractionTriggered,
      mathReconciliation: mathCheck,
      bomPreview: bomParsed
        ? {
            detected: isBomTable,
            validRowCount: bomParsed.validRows.length,
            skippedRowCount: bomParsed.skippedRows.length,
          }
        : undefined,
      focusedClarificationQuestion,
    },
  };
}
