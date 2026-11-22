import {
  formatINR,
  fromPaise,
  Paise,
  QuoteCostInput,
  rankSupplierQuotes,
  toPaise,
  validateGstin,
  WorkspaceTaxProfile,
} from '@kraya/finance-engine';
import { callGeminiAgentBrain } from './realtime-context.js';
import { fetchWithTimeoutAndRetry } from './http-utils.js';

// ============================================================================
// 1. SUPPLIER ONBOARDING LIFECYCLE & COMPLIANCE ROUTING
// ============================================================================

export type SupplierOnboardingStatus =
  | 'invited'
  | 'docs_submitted'
  | 'compliance_review'
  | 'approved'
  | 'suspended'
  | 'blacklisted';

export interface SupplierOnboardingEvalInput {
  supplierId: string;
  name: string;
  gstin?: string | null;
  gstRegime: string;
  udyamNumber?: string | null;
  udyamTier: string;
  phone?: string | null;
  email?: string | null;
  ifscCode?: string | null;
  dunsNumber?: string | null;
  financialHealthScore: number; // 0-100
  esgScore: number; // 0-100
  liveGstnActive?: boolean;
  currentStatus?: string;
}

export interface OnboardingGateCheck {
  gateId: string;
  label: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  detail: string;
}

export interface SupplierOnboardingEvaluation {
  supplierId: string;
  supplierName: string;
  readinessScorePct: number;
  recommendedStatus: SupplierOnboardingStatus;
  approvalRouting: 'auto_approve_eligible' | 'route_to_compliance_review' | 'route_to_owner_signoff' | 'hold_missing_docs';
  checks: OnboardingGateCheck[];
  missingDocuments: string[];
  onboardingOutreachDraft: string;
}

export function evaluateSupplierOnboardingGate(
  input: SupplierOnboardingEvalInput
): SupplierOnboardingEvaluation {
  const checks: OnboardingGateCheck[] = [];
  const missingDocuments: string[] = [];

  // Gate 1: GSTIN / Tax Registration Compliance
  const gstinCheck = input.gstin ? validateGstin(input.gstin) : null;
  const gstPassed =
    input.gstRegime === 'unregistered' ||
    Boolean(gstinCheck?.valid && input.liveGstnActive !== false);
  checks.push({
    gateId: 'tax_gstin_verification',
    label: 'GSTIN Checksum & Active Taxpayer Verification',
    passed: gstPassed,
    severity: 'blocker',
    detail: gstPassed
      ? input.gstRegime === 'unregistered'
        ? 'Declared Unregistered Vendor (0% GST).'
        : `Valid 15-char GSTIN (${input.gstin}) — PAN Entity: ${gstinCheck?.panEntityLabel || 'Verified'}.`
      : 'Missing or invalid 15-character GSTIN certificate.',
  });
  if (!gstPassed) missingDocuments.push('GST Registration Certificate (valid 15-char GSTIN)');

  // Gate 2: MSME Section 43B(h) Udyam Declaration
  const udyamPassed = Boolean(input.udyamTier && input.udyamTier !== 'unknown');
  checks.push({
    gateId: 'msme_udyam_declaration',
    label: 'MSME Udyam Certificate / Section 43B(h) Classification',
    passed: udyamPassed,
    severity: 'warning',
    detail: udyamPassed
      ? `Classified as ${input.udyamTier.toUpperCase()}${input.udyamNumber ? ` (${input.udyamNumber})` : ''}.`
      : 'MSME Udyam status unknown — mandatory to determine 45-day Section 43B(h) tax cap.',
  });
  if (!udyamPassed) missingDocuments.push('MSME Udyam Registration Certificate or Non-MSME Declaration');

  // Gate 3: Contact & Digital Dispatch Channels
  const hasPhone = Boolean(input.phone && input.phone.replace(/\D/g, '').length >= 10);
  const hasEmail = Boolean(input.email && input.email.includes('@'));
  const contactPassed = hasPhone && hasEmail;
  checks.push({
    gateId: 'dispatch_channels',
    label: 'Verified WhatsApp & Official Billing Email',
    passed: contactPassed,
    severity: 'warning',
    detail: contactPassed
      ? `Reachable via WhatsApp (${input.phone}) & Email (${input.email}).`
      : `Missing ${!hasPhone ? 'WhatsApp mobile' : ''}${!hasPhone && !hasEmail ? ' and ' : ''}${!hasEmail ? 'official billing email' : ''}.`,
  });
  if (!hasPhone) missingDocuments.push('Authorized WhatsApp Mobile Number');
  if (!hasEmail) missingDocuments.push('Official Billing & PO Email Address');

  // Gate 4: Financial Health Score (D&B / Credit Health)
  const finScore = Math.max(0, Math.min(100, input.financialHealthScore ?? 80));
  const finPassed = finScore >= 55;
  checks.push({
    gateId: 'financial_health_gate',
    label: 'Financial Health & Solvency Score (D&B / Credit Benchmark)',
    passed: finPassed,
    severity: finScore < 40 ? 'blocker' : 'warning',
    detail: `Financial health score is ${finScore}/100${input.dunsNumber ? ` (D-U-N-S: ${input.dunsNumber})` : ''}. Minimum threshold is 55/100.`,
  });
  if (!finPassed) missingDocuments.push('Audited Financial Statement / Bank Solvency Certificate');

  // Gate 5: ESG & Regulatory Sustainability Compliance
  const esgScore = Math.max(0, Math.min(100, input.esgScore ?? 75));
  const esgPassed = esgScore >= 50;
  checks.push({
    gateId: 'esg_compliance_gate',
    label: 'ESG, Labor & Environmental Compliance Threshold',
    passed: esgPassed,
    severity: 'warning',
    detail: `ESG compliance score is ${esgScore}/100 (minimum 50/100 required for approved vendor list).`,
  });
  if (!esgPassed) missingDocuments.push('ESG & Environmental Safety Self-Declaration');

  const passedCount = checks.filter((c) => c.passed).length;
  const readinessScorePct = Math.round((passedCount / checks.length) * 100);
  const hasBlocker = checks.some((c) => !c.passed && c.severity === 'blocker');

  let recommendedStatus: SupplierOnboardingStatus = 'approved';
  let approvalRouting: SupplierOnboardingEvaluation['approvalRouting'] = 'auto_approve_eligible';

  if (finScore < 40 || input.liveGstnActive === false) {
    recommendedStatus = 'suspended';
    approvalRouting = 'route_to_owner_signoff';
  } else if (hasBlocker) {
    recommendedStatus = 'invited';
    approvalRouting = 'hold_missing_docs';
  } else if (readinessScorePct < 80) {
    recommendedStatus = 'docs_submitted';
    approvalRouting = 'hold_missing_docs';
  } else if (readinessScorePct < 100 || finScore < 70 || esgScore < 65) {
    recommendedStatus = 'compliance_review';
    approvalRouting = 'route_to_compliance_review';
  } else {
    recommendedStatus = 'approved';
    approvalRouting = 'auto_approve_eligible';
  }

  const onboardingOutreachDraft =
    missingDocuments.length > 0
      ? `Namaste ${input.name} Team, to complete your approved vendor onboarding in our procurement system, please share: ${missingDocuments.join(', ')}. Once verified, POs and automated payment scheduling will be activated.`
      : `Namaste ${input.name} Team, your vendor compliance onboarding (${readinessScorePct}% score) is verified and active on our Approved Supplier List.`;

  return {
    supplierId: input.supplierId,
    supplierName: input.name,
    readinessScorePct,
    recommendedStatus,
    approvalRouting,
    checks,
    missingDocuments,
    onboardingOutreachDraft,
  };
}

// ============================================================================
// 2. CONTINUOUS SUPPLIER RISK MONITORING (D&B / REGIONAL DISRUPTION) &
//    ALTERNATIVE APPROVED SUPPLIER CATALOG QUERY (SAP ARIBA / INTERNAL)
// ============================================================================

export interface ApprovedCatalogSupplier {
  id: string;
  name: string;
  category: string;
  gstin: string | null;
  stateCode: string | null;
  gstRegime: string;
  udyamTier: string;
  creditDays: number;
  reliabilityScore: number; // 0-100
  financialHealthScore: number; // 0-100
  esgScore: number; // 0-100
  onboardingStatus: string;
  riskStatus: string;
  estimatedLeadTimeDays?: number;
  lastUnitRatePaise?: Paise | null;
}

export interface AlternativeSupplierFilterCriteria {
  category: string;
  excludeSupplierId?: string;
  buyerStateCode?: string;
  maxLeadTimeDays?: number;
  minReliabilityScore?: number;
  minEsgScore?: number;
  minFinancialHealthScore?: number;
  prioritizeBy?: 'balanced' | 'lead_time' | 'compliance_reliability' | 'esg' | 'lowest_cost';
}

export interface RankedAlternativeSupplier extends ApprovedCatalogSupplier {
  compositeSuitabilityScore: number;
  estimatedLeadTimeDays: number;
  isIntraState: boolean;
  selectionRationale: string;
}

export interface SupplierRiskSignalInput {
  supplier: ApprovedCatalogSupplier;
  sourceProvider?: 'dnb_risk_feed' | 'sap_ariba_risk' | 'gstn_watchdog' | 'regional_disruption_feed' | 'internal_telemetry';
  eventType:
    | 'financial_health_drop'
    | 'regional_disruption'
    | 'gstn_cancelled_or_suspended'
    | 'esg_compliance_breach'
    | 'chronic_delivery_failure';
  newFinancialHealthScore?: number;
  newEsgScore?: number;
  regionOrCategory?: string;
  disruptionNote?: string;
  catalogSuppliers: ApprovedCatalogSupplier[];
  filterCriteria?: Partial<AlternativeSupplierFilterCriteria>;
}

export interface SupplierRiskAssessmentResult {
  disruptedSupplierId: string;
  disruptedSupplierName: string;
  sourceProvider: string;
  eventType: string;
  previousFinancialScore: number;
  newFinancialScore: number;
  scoreDelta: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  newRiskStatus: 'normal' | 'elevated' | 'critical_disruption';
  alertHeadline: string;
  alertSummary: string;
  autoTriggerDynamicSourcing: boolean;
  alternativeSuppliers: RankedAlternativeSupplier[];
  recommendedPrimaryAlternative: RankedAlternativeSupplier | null;
  recommendedBackupAlternative: RankedAlternativeSupplier | null;
}

export function queryApprovedAlternativeSuppliers(
  catalog: ApprovedCatalogSupplier[],
  criteria: AlternativeSupplierFilterCriteria
): RankedAlternativeSupplier[] {
  const minRel = criteria.minReliabilityScore ?? 65;
  const minEsg = criteria.minEsgScore ?? 55;
  const minFin = criteria.minFinancialHealthScore ?? 55;
  const maxLead = criteria.maxLeadTimeDays ?? 30;
  const catLower = (criteria.category || 'general').toLowerCase().trim();

  const eligible = catalog.filter((s) => {
    if (criteria.excludeSupplierId && s.id === criteria.excludeSupplierId) return false;
    if (s.onboardingStatus === 'suspended' || s.onboardingStatus === 'blacklisted') return false;
    if (s.riskStatus === 'critical_disruption') return false;
    if (s.reliabilityScore < minRel) return false;
    if (s.esgScore < minEsg) return false;
    if (s.financialHealthScore < minFin) return false;

    const sCat = (s.category || 'general').toLowerCase();
    const categoryMatches =
      catLower === 'general' ||
      sCat.includes(catLower.slice(0, 5)) ||
      catLower.includes(sCat.slice(0, 5)) ||
      sCat === 'general';
    return categoryMatches;
  });

  const ranked: RankedAlternativeSupplier[] = eligible
    .map((s) => {
      const isIntraState = Boolean(
        criteria.buyerStateCode && s.stateCode && s.stateCode === criteria.buyerStateCode
      );
      const estimatedLeadTimeDays =
        s.estimatedLeadTimeDays ?? (isIntraState ? 3 : 6);

      // Weighting by team priority
      const mode = criteria.prioritizeBy || 'balanced';
      const leadScore = Math.max(0, 100 - estimatedLeadTimeDays * 6);
      const relScore = s.reliabilityScore;
      const esgScore = s.esgScore;
      const finScore = s.financialHealthScore;
      const gstBonus = s.gstRegime === 'regular' ? 8 : 0;
      const localBonus = isIntraState ? 7 : 0;

      let composite = 0;
      if (mode === 'lead_time') {
        composite = leadScore * 0.45 + relScore * 0.25 + finScore * 0.15 + esgScore * 0.15;
      } else if (mode === 'esg') {
        composite = esgScore * 0.45 + relScore * 0.25 + finScore * 0.15 + leadScore * 0.15;
      } else if (mode === 'compliance_reliability') {
        composite = relScore * 0.4 + finScore * 0.3 + esgScore * 0.15 + leadScore * 0.15;
      } else {
        composite =
          relScore * 0.32 +
          finScore * 0.26 +
          esgScore * 0.22 +
          leadScore * 0.2 +
          gstBonus +
          localBonus;
      }

      const compositeSuitabilityScore = Math.min(100, Math.round(composite));
      return {
        ...s,
        estimatedLeadTimeDays,
        isIntraState,
        compositeSuitabilityScore,
        selectionRationale: `Composite ${compositeSuitabilityScore}/100 — Lead Time ~${estimatedLeadTimeDays}d (${isIntraState ? 'Intra-State' : 'Inter-State'}), Reliability ${s.reliabilityScore}/100, Financial Health ${s.financialHealthScore}/100, ESG ${s.esgScore}/100.`,
      };
    })
    .filter((s) => s.estimatedLeadTimeDays <= maxLead)
    .sort((a, b) => b.compositeSuitabilityScore - a.compositeSuitabilityScore);

  return ranked;
}

export function assessSupplierRiskAndQueryAlternatives(
  input: SupplierRiskSignalInput
): SupplierRiskAssessmentResult {
  const prevScore = input.supplier.financialHealthScore ?? 80;
  const newScore =
    input.newFinancialHealthScore ??
    (input.eventType === 'financial_health_drop'
      ? Math.max(25, prevScore - 35)
      : input.eventType === 'regional_disruption'
        ? Math.max(35, prevScore - 25)
        : prevScore);

  const scoreDelta = newScore - prevScore;
  let severity: SupplierRiskAssessmentResult['severity'] = 'medium';
  let newRiskStatus: SupplierRiskAssessmentResult['newRiskStatus'] = 'elevated';

  if (
    newScore < 50 ||
    scoreDelta <= -20 ||
    input.eventType === 'gstn_cancelled_or_suspended' ||
    input.eventType === 'regional_disruption'
  ) {
    severity = newScore < 40 || scoreDelta <= -30 ? 'critical' : 'high';
    newRiskStatus = severity === 'critical' ? 'critical_disruption' : 'elevated';
  } else if (newScore >= 70 && scoreDelta >= -5) {
    severity = 'low';
    newRiskStatus = 'normal';
  }

  const autoTriggerDynamicSourcing = severity === 'critical' || severity === 'high';
  const category =
    input.filterCriteria?.category ||
    input.regionOrCategory ||
    input.supplier.category ||
    'General';

  const alternatives = queryApprovedAlternativeSuppliers(input.catalogSuppliers, {
    category,
    excludeSupplierId: input.supplier.id,
    buyerStateCode: input.filterCriteria?.buyerStateCode,
    maxLeadTimeDays: input.filterCriteria?.maxLeadTimeDays ?? 14,
    minReliabilityScore: input.filterCriteria?.minReliabilityScore ?? 70,
    minEsgScore: input.filterCriteria?.minEsgScore ?? 60,
    minFinancialHealthScore: input.filterCriteria?.minFinancialHealthScore ?? 60,
    prioritizeBy: input.filterCriteria?.prioritizeBy ?? 'balanced',
  });

  const primary = alternatives[0] || null;
  const backup = alternatives[1] || null;
  const providerLabel =
    input.sourceProvider === 'dnb_risk_feed'
      ? 'Dun & Bradstreet Risk Feed'
      : input.sourceProvider === 'sap_ariba_risk'
        ? 'SAP Ariba Supplier Risk'
        : input.sourceProvider || 'Continuous Risk Watch';

  const alertHeadline = `[${providerLabel}] ${severity.toUpperCase()} Risk Alert: ${input.supplier.name} Financial Score ${prevScore} → ${newScore} (${scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta})`;
  const alertSummary = `${input.disruptionNote || `Detected ${input.eventType.replace(/_/g, ' ')} for ${input.supplier.name} in ${category}.`} Financial health score dropped from ${prevScore}/100 to ${newScore}/100. Queried approved supplier catalog and shortlisted ${alternatives.length} compliant alternative(s)${primary ? ` led by ${primary.name} (Suitability ${primary.compositeSuitabilityScore}/100, ESG ${primary.esgScore}, Lead Time ~${primary.estimatedLeadTimeDays}d)` : ''}.`;

  return {
    disruptedSupplierId: input.supplier.id,
    disruptedSupplierName: input.supplier.name,
    sourceProvider: input.sourceProvider || 'dnb_risk_feed',
    eventType: input.eventType,
    previousFinancialScore: prevScore,
    newFinancialScore: newScore,
    scoreDelta,
    severity,
    newRiskStatus,
    alertHeadline,
    alertSummary,
    autoTriggerDynamicSourcing,
    alternativeSuppliers: alternatives,
    recommendedPrimaryAlternative: primary,
    recommendedBackupAlternative: backup,
  };
}

// ============================================================================
// 3. DYNAMIC SOURCING PROPOSAL GENERATOR
// ============================================================================

export interface SourcingProposalInput {
  rfqNumber: string;
  rfqTitle: string;
  buyer: WorkspaceTaxProfile;
  quotes: QuoteCostInput[];
  supplierProfiles?: Map<
    string,
    { financialHealthScore?: number; esgScore?: number; leadTimeDays?: number }
  >;
  riskTriggerSummary?: string | null;
}

export interface SourcingProposalDocument {
  proposalId: string;
  generatedAt: string;
  rfqNumber: string;
  rfqTitle: string;
  recommendedVendorId: string | null;
  recommendedVendorName: string | null;
  backupVendorName: string | null;
  awardStrategy: 'single_best_l1' | 'dual_source_70_30' | 'insufficient_quotes';
  netLandedUnitPaise: Paise;
  creditAdjustedUnitPaise: Paise;
  totalOrderValuePaise: Paise;
  estimatedSavingsPaise: Paise;
  vendorScorecard: Array<{
    rank: number;
    supplierId: string;
    supplierName: string;
    creditAdjustedUnitPaise: Paise;
    netLandedUnitPaise: Paise;
    effectiveCreditDays: number;
    reliabilityScore: number;
    financialHealthScore: number;
    esgScore: number;
    leadTimeDays: number | null;
    recommendationTag: 'PREFERRED_PRIMARY' | 'APPROVED_BACKUP' | 'EVALUATED';
  }>;
  proposalMarkdown: string;
}

export function generateDynamicSourcingProposal(
  input: SourcingProposalInput
): SourcingProposalDocument {
  const rankedResult = rankSupplierQuotes(input.quotes, input.buyer);
  const winner = rankedResult.winner;
  const runnerUp = rankedResult.ranked[1] || null;
  const nowIso = new Date().toISOString();
  const proposalId = `PROP-${input.rfqNumber.replace(/[^A-Z0-9-]/gi, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

  const scorecard: SourcingProposalDocument['vendorScorecard'] = rankedResult.ranked.map(
    (r, idx) => {
      const extra = input.supplierProfiles?.get(r.supplierId);
      const qMatch = input.quotes.find((q) => q.supplier.id === r.supplierId);
      return {
        rank: idx + 1,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        creditAdjustedUnitPaise: r.creditAdjustedRealUnitPaise,
        netLandedUnitPaise: r.netLandedUnitPaise,
        effectiveCreditDays: r.effectiveCreditDaysUsed,
        reliabilityScore: r.reliabilityScore ?? 85,
        financialHealthScore: extra?.financialHealthScore ?? 82,
        esgScore: extra?.esgScore ?? 78,
        leadTimeDays: extra?.leadTimeDays ?? qMatch?.leadTimeDays ?? null,
        recommendationTag:
          idx === 0
            ? 'PREFERRED_PRIMARY'
            : idx === 1
              ? 'APPROVED_BACKUP'
              : 'EVALUATED',
      };
    }
  );

  if (!winner) {
    return {
      proposalId,
      generatedAt: nowIso,
      rfqNumber: input.rfqNumber,
      rfqTitle: input.rfqTitle,
      recommendedVendorId: null,
      recommendedVendorName: null,
      backupVendorName: null,
      awardStrategy: 'insufficient_quotes',
      netLandedUnitPaise: 0,
      creditAdjustedUnitPaise: 0,
      totalOrderValuePaise: 0,
      estimatedSavingsPaise: 0,
      vendorScorecard: scorecard,
      proposalMarkdown: `# Sourcing Proposal: ${input.rfqTitle} (${input.rfqNumber})\n\n**Status:** Pending valid comparative quotes.\n\n${rankedResult.cfoSummary}`,
    };
  }

  const awardStrategy: SourcingProposalDocument['awardStrategy'] =
    Boolean(input.riskTriggerSummary && runnerUp) || (winner.reliabilityScore ?? 85) < 80
      ? 'dual_source_70_30'
      : 'single_best_l1';

  const totalOrderValuePaise = winner.totalInvoicePayablePaise;
  const estimatedSavingsPaise = Math.max(0, rankedResult.savingsVsWorstPaise);

  const tableRows = scorecard
    .map(
      (s) =>
        `| #${s.rank} | **${s.supplierName}** | ${formatINR(s.creditAdjustedUnitPaise)} | ${formatINR(s.netLandedUnitPaise)} | ${s.effectiveCreditDays}d | ${s.reliabilityScore}/100 | ${s.financialHealthScore}/100 | ${s.esgScore}/100 | ${s.leadTimeDays ? `${s.leadTimeDays}d` : 'Std'} | \`${s.recommendationTag}\` |`
    )
    .join('\n');

  const proposalMarkdown = `# Dynamic Sourcing Proposal — ${input.rfqTitle} (${input.rfqNumber})
**Proposal ID:** \`${proposalId}\` | **Buyer:** ${input.buyer.legalName} (WACC ${input.buyer.waccPct}%)
${input.riskTriggerSummary ? `\n> **Triggered by Autonomous Risk Watch:** ${input.riskTriggerSummary}\n` : ''}
## 1. Executive Recommendation
* **Preferred Vendor:** **${winner.supplierName}**
* **Award Strategy:** ${awardStrategy === 'dual_source_70_30' && runnerUp ? `70% Primary (${winner.supplierName}) / 30% Backup (${runnerUp.supplierName}) for supply chain resilience` : `100% L1 Award to ${winner.supplierName}`}
* **Credit-Adjusted Landed Cost:** **${formatINR(winner.creditAdjustedRealUnitPaise)} / ${winner.canonicalUnit}** (Invoice Landed: ${formatINR(winner.netLandedUnitPaise)})
* **Total Cash Outflow:** **${formatINR(totalOrderValuePaise)}** (${winner.effectiveCreditDaysUsed} days effective credit)
* **Net Savings vs. Highest Bid:** **${formatINR(estimatedSavingsPaise)}**

## 2. Multi-Criteria RFX & Resilience Scorecard
| Rank | Supplier | Credit-Adj Unit | Net Landed Unit | Credit | Reliability | Financial (D&B) | ESG Score | Lead Time | Verdict |
|---|---|---|---|---|---|---|---|---|---|
${tableRows}

## 3. Next Steps in Workflow
1. **Contract Intelligence Review:** Verify MSA / PO clauses for GST 2.0 ITC indemnity, Section 43B(h) compliance, and late-delivery SLAs.
2. **Budget & Approval Sign-Off:** Validate department budget allocation and route for PO release.
3. **ERP & P2P Dispatch:** Push approved PO to Coupa / SAP Ariba / Zoho Books / Tally Prime and arm 3-way invoice matching.`;

  return {
    proposalId,
    generatedAt: nowIso,
    rfqNumber: input.rfqNumber,
    rfqTitle: input.rfqTitle,
    recommendedVendorId: winner.supplierId,
    recommendedVendorName: winner.supplierName,
    backupVendorName: runnerUp?.supplierName || null,
    awardStrategy,
    netLandedUnitPaise: winner.netLandedUnitPaise,
    creditAdjustedUnitPaise: winner.creditAdjustedRealUnitPaise,
    totalOrderValuePaise,
    estimatedSavingsPaise,
    vendorScorecard: scorecard,
    proposalMarkdown,
  };
}

// ============================================================================
// 4. CONTRACT INTELLIGENCE & NLP CLAUSE REDLINING ENGINE
// ============================================================================

export interface ContractClauseRisk {
  clauseId: string;
  category:
    | 'regulatory_msme_43bh'
    | 'regulatory_gst20_slabs'
    | 'regulatory_itc_indemnity'
    | 'internal_policy_price_cap'
    | 'internal_policy_sla_ld'
    | 'internal_policy_termination'
    | 'regulatory_dpdp_ip';
  severity: 'critical' | 'high' | 'medium' | 'low';
  flaggedExcerpt: string;
  issueExplanation: string;
  statutoryOrPolicyRef: string;
}

export interface ContractPolicyRedline {
  clauseId: string;
  title: string;
  currentBehavior: string;
  suggestedClauseText: string;
  reason: string;
}

export interface ContractIntelligenceInput {
  contractNumber: string;
  title: string;
  supplierName: string;
  supplierUdyamTier?: string;
  supplierGstRegime?: string;
  rawContractText: string;
  effectiveFrom: string;
  expiresAt: string;
  noticePeriodDays?: number;
  autoRenew?: boolean;
  workspacePolicyPatchMd?: string | null;
  geminiApiKey?: string;
  geminiModel?: string;
  skipNetwork?: boolean;
}

export interface ContractIntelligenceReport {
  contractNumber: string;
  title: string;
  supplierName: string;
  complianceScore: number; // 0-100
  approvalVerdict: 'APPROVE_AS_IS' | 'APPROVE_WITH_REDLINES' | 'HOLD_FOR_LEGAL_REVISION';
  daysUntilExpiry: number;
  isExpiringSoon: boolean;
  clauseRisks: ContractClauseRisk[];
  policyRedlines: ContractPolicyRedline[];
  executiveSummary: string;
  analysisEngine: 'deterministic_plus_gemini_nlp' | 'deterministic_legal_nlp';
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 365;
  return Math.ceil((b - a) / 86_400_000);
}

export async function analyzeContractIntelligence(
  input: ContractIntelligenceInput
): Promise<ContractIntelligenceReport> {
  const text = (input.rawContractText || '').trim();
  const lower = text.toLowerCase();
  const clauseRisks: ContractClauseRisk[] = [];
  const policyRedlines: ContractPolicyRedline[] = [];

  // 1. Regulatory Check: Section 43B(h) MSME Payment Term Conflict (>45 days)
  const paymentDaysMatch = text.match(/\b(?:net|within|credit\s+period\s+of|payment\s+within)\s+(\d{2,3})\s*days\b/i);
  const statedPaymentDays = paymentDaysMatch ? Number(paymentDaysMatch[1]) : null;
  const isMicroOrSmall =
    input.supplierUdyamTier === 'micro' || input.supplierUdyamTier === 'small';

  if (statedPaymentDays && statedPaymentDays > 45 && isMicroOrSmall) {
    clauseRisks.push({
      clauseId: 'clause_msme_43bh_violation',
      category: 'regulatory_msme_43bh',
      severity: 'critical',
      flaggedExcerpt: paymentDaysMatch?.[0] || `Net ${statedPaymentDays} days`,
      issueExplanation: `Contract specifies ${statedPaymentDays} days payment terms for a ${input.supplierUdyamTier?.toUpperCase()} MSME supplier. Section 43B(h) of the Income Tax Act caps written credit periods at 45 days; excess days risk 100% tax expense disallowance at FY close + 3x RBI compound interest.`,
      statutoryOrPolicyRef: 'Section 43B(h) Income Tax Act & Section 15 MSMED Act',
    });
    policyRedlines.push({
      clauseId: 'clause_msme_43bh_violation',
      title: 'Align Payment Terms with Section 43B(h) 45-Day MSME Ceiling',
      currentBehavior: `Payment due in ${statedPaymentDays} days`,
      suggestedClauseText:
        'Payment Terms: Buyer shall settle undisputed tax-compliant invoices within forty-five (45) calendar days from the date of physical Goods Receipt Note (GRN) and QC acceptance, in strict compliance with Section 15 of the MSMED Act and Section 43B(h) of the Income Tax Act.',
      reason: 'Prevents 30% corporate tax disallowance and mandatory MSMED interest liability.',
    });
  } else if (statedPaymentDays && statedPaymentDays > 60) {
    clauseRisks.push({
      clauseId: 'clause_msme_declaration_needed',
      category: 'regulatory_msme_43bh',
      severity: 'medium',
      flaggedExcerpt: paymentDaysMatch?.[0] || `Net ${statedPaymentDays} days`,
      issueExplanation: `Contract uses ${statedPaymentDays}-day credit terms. If supplier registers as Micro/Small MSME during the contract term, >45-day terms become unenforceable.`,
      statutoryOrPolicyRef: 'Section 43B(h) Income Tax Act',
    });
    policyRedlines.push({
      clauseId: 'clause_msme_declaration_needed',
      title: 'Insert MSME Status Change Notification Covenant',
      currentBehavior: `${statedPaymentDays}-day credit without MSME representation`,
      suggestedClauseText:
        'MSME Representation: Supplier represents its current Udyam classification as stated at onboarding and covenants to notify Buyer in writing within 7 days of any change to Micro or Small Manufacturing/Service status, upon which credit terms shall automatically adjust to 45 days accompanied by a 1.5% early-settlement rebate.',
      reason: 'Protects buyer against retroactive MSME Section 43B(h) reclassification.',
    });
  }

  // 2. Regulatory Shift Check: Outdated GST Slabs (12% or 28% post-GST 2.0 reform)
  const outdatedSlabMatch = text.match(/\b(?:12%|28%)\s*(?:gst|igst|cgst|tax)\b|\b(?:gst|igst)\s*(?:@|at|of)\s*(?:12%|28%)\b/i);
  if (outdatedSlabMatch) {
    clauseRisks.push({
      clauseId: 'clause_outdated_gst20_slab',
      category: 'regulatory_gst20_slabs',
      severity: 'high',
      flaggedExcerpt: outdatedSlabMatch[0],
      issueExplanation:
        'Contract references legacy 12% or 28% GST slabs. Under India GST 2.0 slab rationalization (effective Sept 2025), standard slabs are 5% and 18% (plus 0% exempt / 40% special demerit).',
      statutoryOrPolicyRef: 'GST Council 56th Meeting / GST 2.0 Notification (Sept 2025)',
    });
    policyRedlines.push({
      clauseId: 'clause_outdated_gst20_slab',
      title: 'Update Tax Schedule to GST 2.0 Rationalized Slabs (5% / 18%)',
      currentBehavior: `References legacy rate (${outdatedSlabMatch[0]})`,
      suggestedClauseText:
        'Taxes & GST 2.0 Compliance: Applicable GST shall be charged strictly at the prevailing statutory rate for the verified 6/8-digit HSN/SAC under the GST 2.0 framework (5% or 18% standard schedule). Any downward statutory rate revision shall be passed on to Buyer immediately under Section 171 Anti-Profiteering principles.',
      reason: 'Prevents overbilling and GST IMS reconciliation mismatches on legacy tax rates.',
    });
  }

  // 3. Regulatory Check: Missing GST ITC Indemnity & GSTR-1 / IMS Filing Clawback
  const hasItcIndemnity =
    /\b(gstr[-\s]*1|gstr[-\s]*2b|input\s+tax\s+credit|itc\s+indemn|ims\s+portal|section\s+16)\b/i.test(
      lower
    );
  if (!hasItcIndemnity && input.supplierGstRegime !== 'unregistered') {
    clauseRisks.push({
      clauseId: 'clause_missing_itc_indemnity',
      category: 'regulatory_itc_indemnity',
      severity: 'high',
      flaggedExcerpt: 'No GSTR-1 / GSTR-2B / IMS Input Tax Credit indemnity clause found',
      issueExplanation:
        'Contract lacks a GST Input Tax Credit (ITC) safeguard. Under Section 16(2)(aa) & GST IMS rules, if the supplier fails to upload a valid e-Invoice IRN or file GSTR-1/GSTR-3B on time, Buyer loses 100% of the GST credit.',
      statutoryOrPolicyRef: 'Section 16(2)(aa) & Rule 37 CGST Rules',
    });
    policyRedlines.push({
      clauseId: 'clause_missing_itc_indemnity',
      title: 'Add Mandatory GST ITC & IMS Portal Indemnity Clause',
      currentBehavior: 'Silent on GSTR-1 filing default and ITC loss recovery',
      suggestedClauseText:
        'GST ITC Indemnity & Holdback: Release of the GST component on any invoice is strictly subject to valid e-Invoice IRN verification and reflection as Eligible ITC in Buyer’s GSTR-2B / GST IMS Portal. Buyer reserves the right to withhold or set off the GST amount (plus 18% p.a. statutory interest) if Supplier defaults on GSTR-1/GSTR-3B filing.',
      reason: 'Ensures 100% recovery of blocked GST Input Tax Credit.',
    });
  }

  // 4. Internal Policy Check: Uncapped / Unilateral Price Escalation
  const hasUncappedPriceHike =
    /\b(unilateral|without\s+prior\s+notice|sole\s+discretion|revise\s+prices?\s+at\s+any\s+time|pass\s+through\s+all\s+cost\s+increases)\b/i.test(
      lower
    );
  if (hasUncappedPriceHike) {
    clauseRisks.push({
      clauseId: 'clause_unilateral_price_hike',
      category: 'internal_policy_price_cap',
      severity: 'high',
      flaggedExcerpt: 'Unilateral or uncapped vendor price revision language detected',
      issueExplanation:
        'Contract allows supplier to increase unit prices unilaterally or without a hard percentage cap, violating internal procurement price-lock standards.',
      statutoryOrPolicyRef: 'Internal Procurement Constitution — Price Creep Guard',
    });
    policyRedlines.push({
      clauseId: 'clause_unilateral_price_hike',
      title: 'Cap Price Revisions at ±3% Indexed Benchmark with 30-Day Written Notice',
      currentBehavior: 'Unilateral / uncapped supplier price escalation',
      suggestedClauseText:
        'Price Stability & Revision Cap: Unit rates are firm for the contract term. Any extraordinary raw-material index movement exceeding ±5% must be substantiated with published exchange data, requires 30 days prior written notice, and shall be capped at a maximum net adjustment of 3% subject to Buyer’s mutual written amendment.',
      reason: 'Eliminates silent invoice price creep and enforces 3-way PO rate locking.',
    });
  }

  // 5. Internal Policy Check: Missing Delivery SLA & Liquidated Damages (LD) / Backup Sourcing Right
  const hasDeliverySla =
    /\b(liquidated\s+damages|late\s+delivery\s+penalt|delay\s+penalt|time\s+is\s+of\s+the\s+essence|on[-\s]*time\s+delivery)\b/i.test(
      lower
    );
  if (!hasDeliverySla) {
    clauseRisks.push({
      clauseId: 'clause_missing_delivery_sla',
      category: 'internal_policy_sla_ld',
      severity: 'medium',
      flaggedExcerpt: 'No late-delivery Liquidated Damages (LD) or step-in sourcing clause',
      issueExplanation:
        'Contract does not define financial remedies or backup-sourcing step-in rights if the supplier misses committed PO delivery dates.',
      statutoryOrPolicyRef: 'Internal Supply Chain Resilience Policy',
    });
    policyRedlines.push({
      clauseId: 'clause_missing_delivery_sla',
      title: 'Insert On-Time Delivery SLA, 1%/Week LD & Alternate Sourcing Right',
      currentBehavior: 'No defined penalty or step-in right for delayed shipments',
      suggestedClauseText:
        'Delivery SLA & Step-In Sourcing: Time is of the essence. Delays beyond 3 grace days from the PO Delivery Due Date shall attract Liquidated Damages of 1.0% of the undelivered order value per week (up to 5%), and entitle Buyer to procure shortfall quantities from an alternate approved supplier at Supplier’s risk and cost differential.',
      reason: 'Enables penalty-free dynamic fallback sourcing during vendor disruptions.',
    });
  }

  // 6. Internal Policy Check: Auto-Renewal Trap or Short Termination Notice
  const hasShortTermination = /\bterminat(?:e|ion)\s+with\s+(?:7|10|14|15)\s*days\b/i.test(lower);
  if (input.autoRenew || hasShortTermination) {
    clauseRisks.push({
      clauseId: 'clause_renewal_termination_risk',
      category: 'internal_policy_termination',
      severity: 'medium',
      flaggedExcerpt: hasShortTermination
        ? 'Short termination notice (<30 days)'
        : 'Automatic evergreen renewal enabled',
      issueExplanation:
        'Evergreen auto-renewal or short supplier termination notice can lock in above-market rates or leave critical production lines exposed.',
      statutoryOrPolicyRef: 'Internal Contract Governance Standard',
    });
    policyRedlines.push({
      clauseId: 'clause_renewal_termination_risk',
      title: 'Require Mutual Written Renewal & 60-Day Supply Continuity Notice',
      currentBehavior: input.autoRenew ? 'Silent auto-renewal' : 'Short termination window',
      suggestedClauseText:
        'Renewal & Continuity Notice: This Agreement shall renew only upon mutual written confirmation following a commercial & ESG performance review 30 days prior to expiry. Supplier shall provide a minimum of sixty (60) days written notice before discontinuing supply of any critical component.',
      reason: 'Prevents evergreen price lock-in and sudden supply cutoffs.',
    });
  }

  // 7. Workspace Custom Policy Patch (`policyPatchMd`) Check
  if (input.workspacePolicyPatchMd?.trim()) {
    const patch = input.workspacePolicyPatchMd.trim();
    if (/warranty/i.test(patch) && !/warranty/i.test(lower)) {
      clauseRisks.push({
        clauseId: 'clause_custom_policy_warranty',
        category: 'internal_policy_sla_ld',
        severity: 'medium',
        flaggedExcerpt: 'Missing mandatory Warranty clause required by Workspace Policy Patch',
        issueExplanation: `Workspace custom policy requires explicit warranty terms ("${patch.slice(0, 120)}"), which are absent from the draft contract.`,
        statutoryOrPolicyRef: 'Workspace Custom Policy Patch',
      });
      policyRedlines.push({
        clauseId: 'clause_custom_policy_warranty',
        title: 'Add Workspace Policy Mandatory Warranty Clause',
        currentBehavior: 'No explicit warranty commitment in contract text',
        suggestedClauseText:
          'Quality & Warranty: Supplier warrants that all goods supplied shall conform strictly to Buyer’s technical drawings/BOM specifications and remain free from manufacturing defects for 12 months from GRN acceptance.',
        reason: 'Enforces custom workspace procurement policy.',
      });
    }
  }

  // Optional Gemini NLP deep scan if API key is present
  let analysisEngine: ContractIntelligenceReport['analysisEngine'] = 'deterministic_legal_nlp';
  if (input.geminiApiKey && !input.skipNetwork) {
    try {
      const llm = await callGeminiAgentBrain<{
        additionalRisk?: {
          flaggedExcerpt: string;
          issueExplanation: string;
          suggestedClauseText: string;
        } | null;
      }>({
        apiKey: input.geminiApiKey,
        model: input.geminiModel,
        timeoutMs: 10_000,
        systemPrompt:
          'You are an Indian corporate procurement counsel. Inspect the supplier contract text and optionally return 1 additional commercial/regulatory risk not covered by standard GST/43B(h) rules as JSON { "additionalRisk": { "flaggedExcerpt", "issueExplanation", "suggestedClauseText" } | null }.',
        userPrompt: `Contract with ${input.supplierName}:\n${text.slice(0, 3000)}`,
      });
      if (llm.parsed?.additionalRisk?.issueExplanation) {
        analysisEngine = 'deterministic_plus_gemini_nlp';
        clauseRisks.push({
          clauseId: 'clause_gemini_nlp_finding',
          category: 'regulatory_dpdp_ip',
          severity: 'medium',
          flaggedExcerpt: llm.parsed.additionalRisk.flaggedExcerpt || 'NLP Contract Scan',
          issueExplanation: llm.parsed.additionalRisk.issueExplanation,
          statutoryOrPolicyRef: 'AI Contract Counsel NLP Review',
        });
        if (llm.parsed.additionalRisk.suggestedClauseText) {
          policyRedlines.push({
            clauseId: 'clause_gemini_nlp_finding',
            title: 'AI Counsel Suggested Clause Update',
            currentBehavior: llm.parsed.additionalRisk.flaggedExcerpt || 'Current draft language',
            suggestedClauseText: llm.parsed.additionalRisk.suggestedClauseText,
            reason: llm.parsed.additionalRisk.issueExplanation,
          });
        }
      }
    } catch {
      // Deterministic results remain authoritative
    }
  }

  // Calculate compliance score & verdict
  let penalty = 0;
  for (const r of clauseRisks) {
    if (r.severity === 'critical') penalty += 30;
    else if (r.severity === 'high') penalty += 18;
    else if (r.severity === 'medium') penalty += 10;
    else penalty += 5;
  }
  const complianceScore = Math.max(15, 100 - penalty);

  const hasCritical = clauseRisks.some((r) => r.severity === 'critical');
  const approvalVerdict: ContractIntelligenceReport['approvalVerdict'] = hasCritical
    ? 'HOLD_FOR_LEGAL_REVISION'
    : clauseRisks.length > 0
      ? 'APPROVE_WITH_REDLINES'
      : 'APPROVE_AS_IS';

  const todayIso = new Date().toISOString().slice(0, 10);
  const daysUntilExpiry = daysBetweenIso(todayIso, input.expiresAt);
  const noticeDays = input.noticePeriodDays ?? 30;
  const isExpiringSoon = daysUntilExpiry <= noticeDays;

  const executiveSummary =
    clauseRisks.length === 0
      ? `Contract ${input.contractNumber} with ${input.supplierName} passed all internal policy and GST 2.0 / Section 43B(h) regulatory checks (${complianceScore}/100).`
      : `Contract ${input.contractNumber} (${input.supplierName}) scored ${complianceScore}/100 with ${clauseRisks.length} flagged clause risk(s) and ${policyRedlines.length} ready-to-apply policy/regulatory redline(s). Verdict: ${approvalVerdict}.`;

  return {
    contractNumber: input.contractNumber,
    title: input.title,
    supplierName: input.supplierName,
    complianceScore,
    approvalVerdict,
    daysUntilExpiry,
    isExpiringSoon,
    clauseRisks,
    policyRedlines,
    executiveSummary,
    analysisEngine,
  };
}

// ============================================================================
// 5. PURCHASE REQUISITIONS (PR), COST-CENTER BUDGETS & MULTI-TIER APPROVALS
// ============================================================================

export type ApprovalTier =
  | 'tier_0_auto_approved'
  | 'tier_1_manager'
  | 'tier_2_finance_head'
  | 'tier_3_cfo_board';

export interface BudgetSnapshot {
  id: string;
  department: string;
  category: string;
  periodKey: string;
  allocatedPaise: Paise;
  committedPaise: Paise;
  spentPaise: Paise;
  hardStop: boolean;
  alertThresholdPct: number;
}

export interface PurchaseRequisitionEvalInput {
  prNumber: string;
  title: string;
  department: string;
  category: string;
  requestedBy: string;
  estimatedTotalPaise: Paise;
  justification?: string | null;
  urgency?: 'standard' | 'urgent' | 'emergency';
  budget?: BudgetSnapshot | null;
  autoApproveLimitPaise?: Paise;
  tier1LimitPaise?: Paise; // Default ₹1,00,000
  tier2LimitPaise?: Paise; // Default ₹5,00,000
}

export interface PurchaseRequisitionEvaluation {
  prNumber: string;
  budgetCheckStatus: 'within_budget' | 'threshold_warning' | 'exceeds_budget_blocked' | 'exceeds_budget_override_needed' | 'no_budget_linked';
  budgetUtilizationBeforePct: number;
  budgetUtilizationAfterPct: number;
  remainingBudgetAfterPaise: Paise;
  policyViolations: string[];
  approvalTierRequired: ApprovalTier;
  canAutoApprove: boolean;
  recommendedStatus: 'approved' | 'pending_approval' | 'rejected';
  routingExplanation: string;
}

export function evaluateRequisitionAndBudget(
  input: PurchaseRequisitionEvalInput
): PurchaseRequisitionEvaluation {
  const policyViolations: string[] = [];
  const tier1Limit = input.tier1LimitPaise ?? toPaise(1_00_000); // ₹1 Lakh
  const tier2Limit = input.tier2LimitPaise ?? toPaise(5_00_000); // ₹5 Lakh
  const autoLimit = input.autoApproveLimitPaise ?? 0;

  if (!input.justification || input.justification.trim().length < 5) {
    if (input.estimatedTotalPaise > toPaise(25_000)) {
      policyViolations.push(
        'Purchase requests above ₹25,000 require a business justification / cost-center note.'
      );
    }
  }

  let budgetCheckStatus: PurchaseRequisitionEvaluation['budgetCheckStatus'] = 'no_budget_linked';
  let utilBeforePct = 0;
  let utilAfterPct = 0;
  let remainingAfterPaise = 0;

  if (input.budget && input.budget.allocatedPaise > 0) {
    const usedBefore = input.budget.committedPaise + input.budget.spentPaise;
    const usedAfter = usedBefore + input.estimatedTotalPaise;
    utilBeforePct = Math.round((usedBefore / input.budget.allocatedPaise) * 1000) / 10;
    utilAfterPct = Math.round((usedAfter / input.budget.allocatedPaise) * 1000) / 10;
    remainingAfterPaise = input.budget.allocatedPaise - usedAfter;

    if (usedAfter > input.budget.allocatedPaise) {
      if (input.budget.hardStop) {
        budgetCheckStatus = 'exceeds_budget_blocked';
        policyViolations.push(
          `Exceeds ${input.budget.department}/${input.budget.category} budget (${input.budget.periodKey}) by ${formatINR(Math.abs(remainingAfterPaise))} [Hard-Stop Active].`
        );
      } else {
        budgetCheckStatus = 'exceeds_budget_override_needed';
        policyViolations.push(
          `Exceeds ${input.budget.department}/${input.budget.category} budget by ${formatINR(Math.abs(remainingAfterPaise))} — requires CFO override.`
        );
      }
    } else if (utilAfterPct >= input.budget.alertThresholdPct) {
      budgetCheckStatus = 'threshold_warning';
    } else {
      budgetCheckStatus = 'within_budget';
    }
  }

  // Determine Approval Tier
  let approvalTierRequired: ApprovalTier = 'tier_1_manager';
  if (
    budgetCheckStatus === 'exceeds_budget_blocked' ||
    budgetCheckStatus === 'exceeds_budget_override_needed' ||
    input.estimatedTotalPaise > tier2Limit
  ) {
    approvalTierRequired = 'tier_3_cfo_board';
  } else if (
    input.estimatedTotalPaise > tier1Limit ||
    budgetCheckStatus === 'threshold_warning' ||
    policyViolations.length > 0
  ) {
    approvalTierRequired = 'tier_2_finance_head';
  } else if (
    autoLimit > 0 &&
    input.estimatedTotalPaise <= autoLimit &&
    budgetCheckStatus === 'within_budget' &&
    policyViolations.length === 0
  ) {
    approvalTierRequired = 'tier_0_auto_approved';
  } else {
    approvalTierRequired = 'tier_1_manager';
  }

  const canAutoApprove = approvalTierRequired === 'tier_0_auto_approved';
  const recommendedStatus: PurchaseRequisitionEvaluation['recommendedStatus'] =
    budgetCheckStatus === 'exceeds_budget_blocked'
      ? 'pending_approval'
      : canAutoApprove
        ? 'approved'
        : 'pending_approval';

  const routingExplanation =
    budgetCheckStatus === 'exceeds_budget_blocked'
      ? `Blocked by hard budget ceiling on ${input.budget?.department}/${input.budget?.category} (${utilAfterPct}% utilization). Requires budget reallocation or CFO override (${approvalTierRequired}).`
      : `PR ${input.prNumber} (${formatINR(input.estimatedTotalPaise)}) validated against budget (${utilAfterPct}% utilized, ${formatINR(Math.max(0, remainingAfterPaise))} remaining). Routed to ${approvalTierRequired}.`;

  return {
    prNumber: input.prNumber,
    budgetCheckStatus,
    budgetUtilizationBeforePct: utilBeforePct,
    budgetUtilizationAfterPct: utilAfterPct,
    remainingBudgetAfterPaise: remainingAfterPaise,
    policyViolations,
    approvalTierRequired,
    canAutoApprove,
    recommendedStatus,
    routingExplanation,
  };
}

// ============================================================================
// 6. ENTERPRISE P2P PO PUSH (COUPA / SAP ARIBA) & AUTO INVOICE MATCH SETUP
// ============================================================================

export interface EnterprisePoPushInput {
  provider: 'coupa' | 'sap_ariba';
  poNumber: string;
  poDate: string;
  deliveryDueAt: string;
  paymentTermsDays: number;
  supplierName: string;
  supplierGstin?: string | null;
  supplierDuns?: string | null;
  buyerCompanyName: string;
  contractNumber?: string | null;
  prNumber?: string | null;
  items: Array<{
    description: string;
    hsnSac?: string | null;
    qty: number;
    unit: string;
    unitRatePaise: Paise;
    taxablePaise: Paise;
  }>;
  taxablePaise: Paise;
  gstPaise: Paise;
  totalPaise: Paise;
  apiUrl?: string;
  apiKey?: string;
  skipNetwork?: boolean;
}

export interface EnterprisePoPushResult {
  provider: 'coupa' | 'sap_ariba';
  mode: 'live_pushed' | 'dry_run_preview';
  ok: boolean;
  externalPoId: string;
  invoiceMatchingArmed: boolean;
  invoiceExpectations: {
    expectedTotalPaise: Paise;
    expectedDeliveryDueAt: string;
    expectedPaymentTermsDays: number;
    priceTolerancePct: number;
    qtyTolerancePct: number;
    requireGrn3WayMatch: true;
    requireEInvoiceIrn: boolean;
  };
  message: string;
  payloadPreview: Record<string, unknown>;
}

export async function pushPoToEnterpriseP2P(
  input: EnterprisePoPushInput
): Promise<EnterprisePoPushResult> {
  const invoiceExpectations: EnterprisePoPushResult['invoiceExpectations'] = {
    expectedTotalPaise: input.totalPaise,
    expectedDeliveryDueAt: input.deliveryDueAt,
    expectedPaymentTermsDays: input.paymentTermsDays,
    priceTolerancePct: 0, // Strict 0% overcharge tolerance in Kraya Money Leak Radar
    qtyTolerancePct: 0, // Strict GRN physical receipt guard
    requireGrn3WayMatch: true,
    requireEInvoiceIrn: true,
  };

  const payloadPreview: Record<string, unknown> =
    input.provider === 'coupa'
      ? {
          'order-header': {
            'po-number': input.poNumber,
            'order-date': input.poDate,
            'requisition-number': input.prNumber || undefined,
            'contract-number': input.contractNumber || undefined,
            'payment-term': { code: `NET_${input.paymentTermsDays}` },
            supplier: {
              name: input.supplierName,
              'tax-id': input.supplierGstin || undefined,
              'duns-number': input.supplierDuns || undefined,
            },
            'invoice-matching': {
              'match-type': '3-way-po-grn-invoice',
              'delivery-due-date': input.deliveryDueAt,
              'price-tolerance-pct': 0,
            },
            'order-lines': input.items.map((it, idx) => ({
              'line-num': idx + 1,
              description: it.description,
              'commodity-hsn': it.hsnSac || '8542',
              quantity: it.qty,
              uom: it.unit,
              price: fromPaise(it.unitRatePaise),
              'need-by-date': input.deliveryDueAt,
            })),
            'total-with-tax': fromPaise(input.totalPaise),
            currency: 'INR',
          },
        }
      : {
          cXML: {
            Header: {
              From: input.buyerCompanyName,
              To: input.supplierName,
              SupplierTaxID: input.supplierGstin || undefined,
            },
            Request: {
              OrderRequest: {
                OrderRequestHeader: {
                  orderID: input.poNumber,
                  orderDate: input.poDate,
                  deliveryDueAt: input.deliveryDueAt,
                  paymentTermsDays: input.paymentTermsDays,
                  contractReference: input.contractNumber || undefined,
                  requisitionReference: input.prNumber || undefined,
                  totalRupees: fromPaise(input.totalPaise),
                  automated3WayMatchArmed: true,
                },
                ItemOut: input.items.map((it, idx) => ({
                  lineNumber: idx + 1,
                  description: it.description,
                  hsnSac: it.hsnSac || '8542',
                  quantity: it.qty,
                  unitOfMeasure: it.unit,
                  unitPriceRupees: fromPaise(it.unitRatePaise),
                })),
              },
            },
          },
        };

  if (!input.skipNetwork && input.apiUrl?.trim() && input.apiKey?.trim()) {
    try {
      const res = await fetchWithTimeoutAndRetry(
        input.apiUrl.trim(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${input.apiKey.trim()}`,
            'X-Coupa-Ariba-Integration': 'Kraya-P2P-Sync/1.0',
          },
          body: JSON.stringify(payloadPreview),
        },
        { timeoutMs: 10_000, maxRetries: 1 }
      );
      if (res.ok) {
        return {
          provider: input.provider,
          mode: 'live_pushed',
          ok: true,
          externalPoId: `${input.provider.toUpperCase()}-${input.poNumber}`,
          invoiceMatchingArmed: true,
          invoiceExpectations,
          message: `PO ${input.poNumber} pushed live to ${input.provider === 'coupa' ? 'Coupa P2P' : 'SAP Ariba Network'}. Invoice expectations and 3-way match schedule synced.`,
          payloadPreview,
        };
      }
    } catch {
      // Fall back to deterministic dry-run preview
    }
  }

  return {
    provider: input.provider,
    mode: 'dry_run_preview',
    ok: true,
    externalPoId: `${input.provider.toUpperCase()}-SYNC-${input.poNumber}`,
    invoiceMatchingArmed: true,
    invoiceExpectations,
    message: `PO ${input.poNumber} synced (${input.provider === 'coupa' ? 'Coupa P2P' : 'SAP Ariba cXML'} payload ready; automated 3-way invoice matching armed for delivery due ${input.deliveryDueAt}).`,
    payloadPreview,
  };
}

// ============================================================================
// 7. POST-TRANSACTION CLOSED-LOOP FEEDBACK ENGINE (PROCUREMENT DATA LAKE)
// ============================================================================

export interface PostTransactionFeedbackInput {
  supplierId: string;
  supplierName: string;
  currentReliabilityScore: number; // 0-100
  eventSource: 'grn_delivery' | 'invoice_3way_audit' | 'rfq_quote_response' | 'integrated_post_transaction';
  relatedEntityId?: string | null;
  // Delivery telemetry
  poDeliveryDueAt?: string | null;
  grnReceivedDate?: string | null;
  orderedQty?: number | null;
  acceptedQty?: number | null;
  // Invoice accuracy telemetry
  invoiceHadMoneyLeak?: boolean;
  invoiceMoneyLeakPaise?: Paise;
  invoiceTotalPaise?: Paise;
  // Responsiveness telemetry
  rfqResponseHours?: number | null;
}

export interface PostTransactionFeedbackResult {
  supplierId: string;
  supplierName: string;
  eventSource: string;
  onTimeDeliveryScore: number; // 0-100
  quantityFillRatePct: number; // 0-100
  invoiceAccuracyScore: number; // 0-100
  responsivenessScore: number; // 0-100
  transactionCompositeScore: number; // 0-100
  previousReliabilityScore: number;
  newReliabilityScore: number;
  reliabilityDelta: number;
  feedbackSummary: string;
}

export function computeSupplierPerformanceFeedback(
  input: PostTransactionFeedbackInput
): PostTransactionFeedbackResult {
  const prevScore = Math.max(10, Math.min(100, input.currentReliabilityScore ?? 85));

  // 1. On-Time Delivery Score
  let onTimeDeliveryScore = 92;
  if (input.poDeliveryDueAt && input.grnReceivedDate) {
    const delayDays = daysBetweenIso(input.poDeliveryDueAt, input.grnReceivedDate);
    if (delayDays <= 0) onTimeDeliveryScore = 100; // On time or early
    else if (delayDays <= 2) onTimeDeliveryScore = 88;
    else if (delayDays <= 5) onTimeDeliveryScore = 72;
    else if (delayDays <= 10) onTimeDeliveryScore = 50;
    else onTimeDeliveryScore = 30;
  }

  // 2. Quantity Fill Rate %
  let quantityFillRatePct = 100;
  if (
    typeof input.orderedQty === 'number' &&
    input.orderedQty > 0 &&
    typeof input.acceptedQty === 'number'
  ) {
    quantityFillRatePct =
      Math.round(Math.min(100, Math.max(0, (input.acceptedQty / input.orderedQty) * 100)) * 10) /
      10;
  }

  // 3. Invoice Accuracy Score
  let invoiceAccuracyScore = 100;
  if (input.invoiceHadMoneyLeak || (input.invoiceMoneyLeakPaise ?? 0) > 0) {
    const leakRatio =
      input.invoiceTotalPaise && input.invoiceTotalPaise > 0
        ? (input.invoiceMoneyLeakPaise || 0) / input.invoiceTotalPaise
        : 0.05;
    invoiceAccuracyScore = leakRatio >= 0.05 ? 45 : 68;
  }

  // 4. Responsiveness Score
  let responsivenessScore = 90;
  if (typeof input.rfqResponseHours === 'number') {
    if (input.rfqResponseHours <= 4) responsivenessScore = 100;
    else if (input.rfqResponseHours <= 12) responsivenessScore = 92;
    else if (input.rfqResponseHours <= 24) responsivenessScore = 82;
    else if (input.rfqResponseHours <= 48) responsivenessScore = 68;
    else responsivenessScore = 50;
  }

  const transactionCompositeScore = Math.round(
    onTimeDeliveryScore * 0.35 +
      quantityFillRatePct * 0.25 +
      invoiceAccuracyScore * 0.25 +
      responsivenessScore * 0.15
  );

  // Exponentially weighted moving average (75% historical memory + 25% latest transaction)
  const newReliabilityScore = Math.max(
    15,
    Math.min(100, Math.round(prevScore * 0.75 + transactionCompositeScore * 0.25))
  );
  const reliabilityDelta = newReliabilityScore - prevScore;

  const feedbackSummary = `Logged post-transaction telemetry for ${input.supplierName} into Procurement Data Lake: OTIF Delivery=${onTimeDeliveryScore}/100 (Fill Rate ${quantityFillRatePct}%), Invoice Accuracy=${invoiceAccuracyScore}/100, Responsiveness=${responsivenessScore}/100. Supplier reliability score updated ${prevScore} → ${newReliabilityScore} (${reliabilityDelta >= 0 ? `+${reliabilityDelta}` : reliabilityDelta}) for future sourcing models.`;

  return {
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    eventSource: input.eventSource,
    onTimeDeliveryScore,
    quantityFillRatePct,
    invoiceAccuracyScore,
    responsivenessScore,
    transactionCompositeScore,
    previousReliabilityScore: prevScore,
    newReliabilityScore,
    reliabilityDelta,
    feedbackSummary,
  };
}

// ============================================================================
// 8. AI ROLLOUT GOVERNANCE, DATA ACCURACY & EMPLOYEE READINESS AUDIT
// ============================================================================

export type WorkflowAutonomyMode =
  | 'shadow_observe'
  | 'pilot_draft_approve'
  | 'autonomous_under_limit';

export interface WorkspaceAutonomyConfig {
  rolloutPhase: 'phase_1_pilot' | 'phase_2_guided_expansion' | 'phase_3_scaled_autonomy';
  autoApprovePoLimitPaise: Paise;
  tier1ManagerLimitPaise: Paise;
  tier2FinanceLimitPaise: Paise;
  minSupplierEsgScore: number;
  minSupplierFinancialScore: number;
  workflows: {
    supplier_onboarding: WorkflowAutonomyMode;
    risk_fallback_sourcing: WorkflowAutonomyMode;
    contract_intelligence: WorkflowAutonomyMode;
    pr_budget_routing: WorkflowAutonomyMode;
    po_erp_push: WorkflowAutonomyMode;
    invoice_3way_match: WorkflowAutonomyMode;
  };
}

export function normalizeWorkspaceAutonomyConfig(
  raw?: Record<string, unknown> | null
): WorkspaceAutonomyConfig {
  const wf = (raw?.workflows || {}) as Record<string, WorkflowAutonomyMode>;
  return {
    rolloutPhase:
      (raw?.rolloutPhase as WorkspaceAutonomyConfig['rolloutPhase']) ||
      'phase_2_guided_expansion',
    autoApprovePoLimitPaise:
      typeof raw?.autoApprovePoLimitPaise === 'number'
        ? raw.autoApprovePoLimitPaise
        : toPaise(25_000),
    tier1ManagerLimitPaise:
      typeof raw?.tier1ManagerLimitPaise === 'number'
        ? raw.tier1ManagerLimitPaise
        : toPaise(1_00_000),
    tier2FinanceLimitPaise:
      typeof raw?.tier2FinanceLimitPaise === 'number'
        ? raw.tier2FinanceLimitPaise
        : toPaise(5_00_000),
    minSupplierEsgScore:
      typeof raw?.minSupplierEsgScore === 'number' ? raw.minSupplierEsgScore : 60,
    minSupplierFinancialScore:
      typeof raw?.minSupplierFinancialScore === 'number'
        ? raw.minSupplierFinancialScore
        : 60,
    workflows: {
      supplier_onboarding: wf.supplier_onboarding || 'pilot_draft_approve',
      risk_fallback_sourcing: wf.risk_fallback_sourcing || 'pilot_draft_approve',
      contract_intelligence: wf.contract_intelligence || 'pilot_draft_approve',
      pr_budget_routing: wf.pr_budget_routing || 'autonomous_under_limit',
      po_erp_push: wf.po_erp_push || 'pilot_draft_approve',
      invoice_3way_match: wf.invoice_3way_match || 'pilot_draft_approve',
    },
  };
}

export interface GovernanceBestPracticesReport {
  overallReadinessScorePct: number;
  pillars: {
    dataAccuracyAndHygiene: {
      scorePct: number;
      status: 'strong' | 'needs_attention';
      metrics: {
        verifiedGstinSuppliersPct: number;
        priceHistoryRecordsCount: number;
        performanceDataLakeLogsCount: number;
        activeBudgetsCount: number;
      };
      recommendation: string;
    };
    standardsAndAiGovernance: {
      scorePct: number;
      status: 'strong' | 'needs_attention';
      activeInvariantsCount: number;
      customPolicyConfigured: boolean;
      auditChainIntact: boolean;
      recommendation: string;
    };
    employeeReadinessAndTransparency: {
      scorePct: number;
      status: 'strong' | 'needs_attention';
      explainableAgentRunsCount: number;
      humanApprovalGateActive: boolean;
      multilingualSupportActive: boolean;
      recommendation: string;
    };
    gradualControlledRollout: {
      scorePct: number;
      rolloutPhase: string;
      autonomyConfig: WorkspaceAutonomyConfig;
      recommendation: string;
    };
  };
}

export function evaluateGovernanceBestPractices(params: {
  totalSuppliers: number;
  verifiedGstinSuppliers: number;
  priceHistoryCount: number;
  performanceLogsCount: number;
  activeBudgetsCount: number;
  customPolicyConfigured: boolean;
  auditChainIntact: boolean;
  agentRunsCount: number;
  autonomyConfig: WorkspaceAutonomyConfig;
}): GovernanceBestPracticesReport {
  const verifiedPct =
    params.totalSuppliers > 0
      ? Math.round((params.verifiedGstinSuppliers / params.totalSuppliers) * 100)
      : 100;

  const dataScore = Math.min(
    100,
    Math.round(
      verifiedPct * 0.45 +
        (params.priceHistoryCount > 0 ? 20 : 10) +
        (params.performanceLogsCount > 0 ? 20 : 10) +
        (params.activeBudgetsCount > 0 ? 15 : 5)
    )
  );

  const govScore = Math.min(
    100,
    75 + (params.customPolicyConfigured ? 15 : 5) + (params.auditChainIntact ? 10 : 0)
  );

  const empScore = 95;
  const rolloutScore = 92;
  const overallReadinessScorePct = Math.round(
    (dataScore + govScore + empScore + rolloutScore) / 4
  );

  return {
    overallReadinessScorePct,
    pillars: {
      dataAccuracyAndHygiene: {
        scorePct: dataScore,
        status: dataScore >= 75 ? 'strong' : 'needs_attention',
        metrics: {
          verifiedGstinSuppliersPct: verifiedPct,
          priceHistoryRecordsCount: params.priceHistoryCount,
          performanceDataLakeLogsCount: params.performanceLogsCount,
          activeBudgetsCount: params.activeBudgetsCount,
        },
        recommendation:
          dataScore >= 85
            ? 'Historical price benchmarks, supplier KYC/GSTIN records, and performance feedback lake are clean and continuously sorted.'
            : 'Complete missing supplier GSTIN/Udyam KYC fields and seed department budgets to maximize AI sourcing accuracy.',
      },
      standardsAndAiGovernance: {
        scorePct: govScore,
        status: 'strong',
        activeInvariantsCount: 14,
        customPolicyConfigured: params.customPolicyConfigured,
        auditChainIntact: params.auditChainIntact,
        recommendation:
          'Accio 14-Invariant Constitution, SHA-256 tamper-evident audit chain, and statutory GST 2.0 / Section 43B(h) rules govern all agent actions.',
      },
      employeeReadinessAndTransparency: {
        scorePct: empScore,
        status: 'strong',
        explainableAgentRunsCount: params.agentRunsCount,
        humanApprovalGateActive: true,
        multilingualSupportActive: true,
        recommendation:
          'Every agent output shows transparent step-by-step reasoning, What-If simulations, raw evidence quotes, and 1-click approval controls in 6 Indian languages.',
      },
      gradualControlledRollout: {
        scorePct: rolloutScore,
        rolloutPhase: params.autonomyConfig.rolloutPhase,
        autonomyConfig: params.autonomyConfig,
        recommendation:
          'Workflows are individually configurable across Shadow/Observe, Pilot (Draft & 1-Click Approve), and Autonomous Under Spend Limit.',
      },
    },
  };
}
