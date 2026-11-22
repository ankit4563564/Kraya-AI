import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { computeGstinChecksum } from '@kraya/finance-engine';
import { createApp } from '../src/app.js';
import { resetDbCache } from '../src/db/client.js';

const mkGstin = (p14: string) => p14 + computeGstinChecksum(p14);

function extractSessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/kraya_session=([^;]+)/);
  if (!match) throw new Error(`Expected kraya_session cookie, got: ${raw}`);
  return `kraya_session=${match[1]}`;
}

describe('Enterprise Procurement Lifecycle Frameworks & 6-Step Integrated Manager Workflow', () => {
  let tmpDir: string;
  let pgDir: string;
  let vaultDir: string;
  let prevPgDir: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraya-enterprise-test-'));
    pgDir = path.join(tmpDir, 'pg');
    vaultDir = path.join(tmpDir, 'vault');
    prevPgDir = process.env.PGLITE_DATA_DIR;
    process.env.PGLITE_DATA_DIR = pgDir;
    resetDbCache();
  });

  afterAll(async () => {
    resetDbCache();
    if (prevPgDir === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = prevPgDir;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('1. Executes the complete 6-Step Integrated Manager Workflow (D&B Risk Drop -> SAP Ariba Catalog Filter -> Dynamic Sourcing Proposal -> NLP Contract Redlining -> Budget & Coupa PO Push -> Closed-Loop Data Lake Feedback)', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'enterprise-lifecycle-test-secret-32b',
    });

    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rohan Mehta',
        companyName: 'Bharat Global Electronics Manufacturing Ltd',
        email: 'rohan@bharatelectronics.in',
        password: 'StrongPassword#2026',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const cookie = extractSessionCookie(signupRes);

    // Run 6-Step Integrated Workflow
    const runRes = await app.request('/api/enterprise/integrated-workflow/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        componentName: 'STM32 Industrial Microcontroller Unit',
        category: 'Electronics',
        qty: 1000,
        targetUnitRateRupees: 420,
        department: 'Manufacturing',
      }),
    });
    expect(runRes.status).toBe(201);
    const body = await runRes.json();

    expect(body.workflowExecuted).toBe(true);
    // Step 1: D&B Risk Drop
    expect(body.steps.step1_dnbRiskDetection.previousFinancialScore).toBeGreaterThan(70);
    expect(body.steps.step1_dnbRiskDetection.newFinancialScore).toBe(41);
    expect(['high', 'critical']).toContain(body.steps.step1_dnbRiskDetection.severity);

    // Step 2: Approved Catalog Alternatives filtered by Lead Time, Compliance, ESG
    expect(body.steps.step2_approvedCatalogQuery.totalAlternativesShortlisted).toBeGreaterThanOrEqual(2);
    expect(
      body.steps.step2_approvedCatalogQuery.alternatives[0].compositeSuitabilityScore
    ).toBeGreaterThanOrEqual(75);

    // Step 3: Dynamic Sourcing Proposal
    expect(body.steps.step3_dynamicSourcingProposal.proposal.recommendedVendorName).toBeTruthy();
    expect(body.steps.step3_dynamicSourcingProposal.proposal.proposalMarkdown).toContain(
      'Dynamic Sourcing Proposal'
    );

    // Step 4: Contract Intelligence NLP
    expect(
      body.steps.step4_contractIntelligenceNlp.report.clauseRisks.length
    ).toBeGreaterThanOrEqual(3);
    expect(
      body.steps.step4_contractIntelligenceNlp.report.policyRedlines.length
    ).toBeGreaterThanOrEqual(3);

    // Step 5: Budget Check + Coupa P2P PO Push with 3-Way Match Armed
    expect(body.steps.step5_budgetAndCoupaPoPush.poNumber).toMatch(/^PO-/);
    expect(body.steps.step5_budgetAndCoupaPoPush.coupaSync.provider).toBe('coupa');
    expect(body.steps.step5_budgetAndCoupaPoPush.coupaSync.invoiceMatchingArmed).toBe(true);

    // Step 6: Post-Transaction Closed-Loop Feedback into Data Lake
    expect(
      body.steps.step6_closedLoopDataLakeFeedback.feedback.newReliabilityScore
    ).toBeGreaterThanOrEqual(
      body.steps.step6_closedLoopDataLakeFeedback.feedback.previousReliabilityScore
    );
  });

  it('2. Modular Enterprise Frameworks: Supplier Onboarding Gate, Contract Redline Approval, PR Budget Routing & Gradual AI Rollout Governance', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'enterprise-lifecycle-test-secret-32b',
    });

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rohan@bharatelectronics.in',
        password: 'StrongPassword#2026',
      }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = extractSessionCookie(loginRes);

    // 1. Create a supplier and evaluate onboarding gate
    const supRes = await app.request('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Kaveri Precision Sensors Pvt Ltd',
        category: 'Electronics',
        gstin: mkGstin('29AABCK7788F1Z'),
        udyamTier: 'small',
        phone: '+91 9845012345',
        email: 'billing@kaverisensors.in',
        esgScore: 88,
        financialHealthScore: 85,
      }),
    });
    expect(supRes.status).toBe(201);
    const sup = await supRes.json();

    const obEvalRes = await app.request(
      `/api/enterprise/suppliers/${sup.id}/onboarding-evaluate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ financialHealthScore: 90, esgScore: 92, dunsNumber: '86-111-2233' }),
      }
    );
    expect(obEvalRes.status).toBe(200);
    const obEval = await obEvalRes.json();
    expect(obEval.evaluation.readinessScorePct).toBe(100);
    expect(obEval.evaluation.recommendedStatus).toBe('approved');

    // 2. Analyze Contract with MSME 43B(h) & GST 2.0 violations, then approve with redlines
    const cntRes = await app.request('/api/enterprise/contracts/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        supplierId: sup.id,
        title: 'Sensor Module Supply Agreement',
        rawContractText:
          'Payment shall be made within Net 75 days. GST @ 28% extra. Supplier may revise prices at any time.',
        autoRenew: true,
      }),
    });
    expect(cntRes.status).toBe(201);
    const cntJson = await cntRes.json();
    expect(cntJson.report.approvalVerdict).toBe('HOLD_FOR_LEGAL_REVISION');
    expect(
      cntJson.report.clauseRisks.some((r: { clauseId: string }) => r.clauseId === 'clause_msme_43bh_violation')
    ).toBe(true);

    const approveCntRes = await app.request(
      `/api/enterprise/contracts/${cntJson.contract.id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ applySuggestedRedlines: true }),
      }
    );
    expect(approveCntRes.status).toBe(200);
    const approvedCnt = await approveCntRes.json();
    expect(approvedCnt.contract.status).toBe('active');
    expect(approvedCnt.contract.complianceScore).toBe(100);
    expect(approvedCnt.contract.rawContractText).toContain('POLICY REDLINE ADDENDUM');

    // 3. Configure Department Budget & Submit Purchase Requisitions (within budget vs exceeding budget)
    const bdgRes = await app.request('/api/enterprise/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        department: 'R&D',
        category: 'Electronics',
        periodKey: 'FY2026-27',
        allocatedRupees: 200000,
        hardStop: true,
      }),
    });
    expect(bdgRes.status).toBe(201);

    const pr1Res = await app.request('/api/enterprise/requisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: 'Prototype Sensor Array Lot',
        department: 'R&D',
        category: 'Electronics',
        estimatedTotalRupees: 80000,
        justification: 'New EV sensor validation rig',
      }),
    });
    expect(pr1Res.status).toBe(201);
    const pr1 = await pr1Res.json();
    expect(pr1.evaluation.budgetCheckStatus).toBe('within_budget');

    // Approve PR1 and convert to RFQ
    const prApproveRes = await app.request(
      `/api/enterprise/requisitions/${pr1.requisition.id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ convertToRfq: true }),
      }
    );
    expect(prApproveRes.status).toBe(200);
    const prApproved = await prApproveRes.json();
    expect(prApproved.requisition.status).toBe('converted_to_rfq');
    expect(prApproved.requisition.linkedRfqId).toBeTruthy();

    // Submit PR2 that exceeds remaining R&D budget (₹80k committed + ₹150k new > ₹200k allocated)
    const pr2Res = await app.request('/api/enterprise/requisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: 'High-Altitude Thermal Chamber',
        department: 'R&D',
        category: 'Electronics',
        estimatedTotalRupees: 150000,
        justification: 'Environmental stress testing',
      }),
    });
    expect(pr2Res.status).toBe(201);
    const pr2 = await pr2Res.json();
    expect(pr2.evaluation.budgetCheckStatus).toBe('exceeds_budget_blocked');
    expect(pr2.evaluation.approvalTierRequired).toBe('tier_3_cfo_board');

    // 4. Update Gradual AI Rollout Governance & check Overview
    const govUpdateRes = await app.request('/api/enterprise/governance/autonomy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        rolloutPhase: 'phase_2_guided_expansion',
        autoApprovePoLimitPaise: 5000000,
        workflows: {
          supplier_onboarding: 'pilot_draft_approve',
          risk_fallback_sourcing: 'pilot_draft_approve',
          contract_intelligence: 'pilot_draft_approve',
          pr_budget_routing: 'autonomous_under_limit',
          po_erp_push: 'pilot_draft_approve',
          invoice_3way_match: 'pilot_draft_approve',
        },
      }),
    });
    expect(govUpdateRes.status).toBe(200);

    const overviewRes = await app.request('/api/enterprise/overview', {
      headers: { Cookie: cookie },
    });
    expect(overviewRes.status).toBe(200);
    const ov = await overviewRes.json();
    expect(ov.governanceReport.overallReadinessScorePct).toBeGreaterThanOrEqual(80);
    expect(ov.riskEvents.length).toBeGreaterThanOrEqual(1);
    expect(ov.contracts.length).toBeGreaterThanOrEqual(2);
    expect(ov.budgets.length).toBeGreaterThanOrEqual(2);
    expect(ov.requisitions.length).toBe(2);
    expect(ov.performanceLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('3. Holistic n8n Enterprise PnC Dispatcher: verifies all Permutations & Combinations across Kraya 03, 05, 07, 08, 09 & 10', async () => {
    const n8nSecret = 'holistic-n8n-pnc-secret-2026';
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'enterprise-lifecycle-test-secret-32b',
      N8N_WEBHOOK_SECRET: n8nSecret,
    });

    const callN8nPnc = async (payload: Record<string, unknown>) => {
      const res = await app.request('/api/internal/n8n/enterprise/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kraya-webhook-secret': n8nSecret,
        },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { ok: boolean; pncBranch: string; [k: string]: unknown };
    };

    // A. Onboarding & KYC PnC (4 branches)
    expect(
      (
        await callN8nPnc({
          operation: 'onboarding_kyc_pnc',
          companyName: 'Approved Tier1 Vendor',
          gstin: mkGstin('29AABCB4419K1Z'),
          udyamTier: 'small',
          phone: '+91 9845011223',
          email: 'ok@vendor.in',
          financialHealthScore: 91,
          esgScore: 88,
        })
      ).pncBranch
    ).toBe('approved_for_po_onboarding_complete');

    expect(
      (
        await callN8nPnc({
          operation: 'onboarding_kyc_pnc',
          companyName: 'Moderate ESG Vendor',
          gstin: mkGstin('29AABCB4419K1Z'),
          udyamTier: 'small',
          phone: '+91 9845011223',
          email: 'mod@vendor.in',
          financialHealthScore: 62,
          esgScore: 58,
        })
      ).pncBranch
    ).toBe('compliance_review_required');

    expect(
      (
        await callN8nPnc({
          operation: 'onboarding_kyc_pnc',
          companyName: 'Missing Docs Vendor',
          gstin: mkGstin('29AABCB4419K1Z'),
          udyamTier: 'unknown',
          phone: '',
          email: '',
          financialHealthScore: 78,
          esgScore: 75,
        })
      ).pncBranch
    ).toBe('hold_missing_kyc_docs');

    expect(
      (
        await callN8nPnc({
          operation: 'onboarding_kyc_pnc',
          companyName: 'Insolvent Cancelled Vendor',
          financialHealthScore: 30,
          liveGstnActive: false,
        })
      ).pncBranch
    ).toBe('blocked_invalid_gstin_or_insolvent');

    // B. Supplier Risk & Sourcing Proposal PnC (3 branches)
    expect(
      (
        await callN8nPnc({
          operation: 'risk_sourcing_pnc',
          newFinancialHealthScore: 38,
          prioritizeBy: 'esg',
        })
      ).pncBranch
    ).toBe('critical_disruption_dual_source_70_30');

    expect(
      (
        await callN8nPnc({
          operation: 'risk_sourcing_pnc',
          newFinancialHealthScore: 55,
          prioritizeBy: 'lead_time',
        })
      ).pncBranch
    ).toBe('elevated_risk_backup_rfq_standby');

    expect(
      (
        await callN8nPnc({
          operation: 'risk_sourcing_pnc',
          newFinancialHealthScore: 86,
        })
      ).pncBranch
    ).toBe('healthy_supplier_no_fallback_needed');

    // C. Contract Intelligence NLP PnC (3 branches)
    expect(
      (
        await callN8nPnc({
          operation: 'contract_nlp_pnc',
          supplierUdyamTier: 'small',
          rawContractText: 'Payment within Net 75 days. GST @ 28% extra.',
        })
      ).pncBranch
    ).toBe('critical_statutory_hold_for_redline');

    expect(
      (
        await callN8nPnc({
          operation: 'contract_nlp_pnc',
          supplierUdyamTier: 'medium',
          rawContractText: 'Payment within Net 30 days. Supplier may revise prices at its sole discretion.',
        })
      ).pncBranch
    ).toBe('commercial_policy_redlines_suggested');

    expect(
      (
        await callN8nPnc({
          operation: 'contract_nlp_pnc',
          autoApplyRedlines: true,
        })
      ).pncBranch
    ).toBe('clean_contract_approved_active');

    // D. PR & 4-Tier Budget Matrix PnC (4 branches)
    expect(
      (
        await callN8nPnc({
          operation: 'pr_budget_pnc',
          department: 'Assembly',
          category: 'Sensors',
          allocatedBudgetRupees: 500000,
          estimatedTotalRupees: 15000,
          autoApproveLimitRupees: 25000,
          justification: 'Line replenishment',
        })
      ).pncBranch
    ).toBe('tier_0_autonomous_auto_approved_to_rfq');

    expect(
      (
        await callN8nPnc({
          operation: 'pr_budget_pnc',
          department: 'Assembly',
          category: 'Sensors',
          estimatedTotalRupees: 60000,
          autoApproveLimitRupees: 25000,
          justification: 'Standard batch',
        })
      ).pncBranch
    ).toBe('tier_1_department_manager_approval');

    expect(
      (
        await callN8nPnc({
          operation: 'pr_budget_pnc',
          department: 'Assembly',
          category: 'Sensors',
          estimatedTotalRupees: 220000,
          justification: 'Mid-tier tooling',
        })
      ).pncBranch
    ).toBe('tier_2_finance_head_review');

    expect(
      (
        await callN8nPnc({
          operation: 'pr_budget_pnc',
          department: 'Assembly',
          category: 'Sensors',
          estimatedTotalRupees: 600000,
          hardStop: true,
        })
      ).pncBranch
    ).toBe('exceeds_budget_hard_stop_cfo_board');

    // E. Omni-ERP & P2P Sync PnC (4 branches)
    expect(
      (await callN8nPnc({ operation: 'erp_p2p_pnc', erpProvider: 'coupa', poNumber: 'PO-C-1' }))
        .pncBranch
    ).toBe('coupa_or_sap_ariba_p2p');

    expect(
      (await callN8nPnc({ operation: 'erp_p2p_pnc', erpProvider: 'tally_prime' })).pncBranch
    ).toBe('tally_prime_xml_push');

    expect(
      (await callN8nPnc({ operation: 'erp_p2p_pnc', erpProvider: 'zoho_books' })).pncBranch
    ).toBe('zoho_books_bill_push');

    expect(
      (await callN8nPnc({ operation: 'erp_p2p_pnc', paymentUtr: 'UTR99112233' })).pncBranch
    ).toBe('payment_utr_settlement');

    // F. Connected 6-Step & Closed-Loop Data Lake Feedback PnC (3 branches)
    expect(
      (await callN8nPnc({ operation: 'integrated_6step_or_feedback_pnc', mode: 'full_6step' }))
        .pncBranch
    ).toBe('full_6step_pipeline_executed');

    expect(
      (
        await callN8nPnc({
          operation: 'integrated_6step_or_feedback_pnc',
          mode: 'feedback_only',
          lateDeliveryDays: 0,
          invoiceHadMoneyLeak: false,
        })
      ).pncBranch
    ).toBe('post_transaction_reliability_upgraded');

    expect(
      (
        await callN8nPnc({
          operation: 'integrated_6step_or_feedback_pnc',
          mode: 'feedback_only',
          lateDeliveryDays: 14,
          acceptedQty: 600,
          orderedQty: 1000,
          invoiceHadMoneyLeak: true,
          invoiceMoneyLeakRupees: 45000,
        })
      ).pncBranch
    ).toBe('post_transaction_reliability_penalized');
  });
});
