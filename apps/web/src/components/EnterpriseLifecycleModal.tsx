import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  Layers,
  Play,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { apiJson, formatINR } from '../lib/api';
import { ModalDialog } from './ModalDialog';

interface EnterpriseOverviewResponse {
  workspaceId: string;
  autonomyConfig: {
    rolloutPhase: string;
    autoApprovePoLimitPaise: number;
    tier1ManagerLimitPaise: number;
    tier2FinanceLimitPaise: number;
    minSupplierEsgScore: number;
    minSupplierFinancialScore: number;
    workflows: Record<string, string>;
  };
  governanceReport: {
    overallReadinessScorePct: number;
    pillars: {
      dataAccuracyAndHygiene: {
        scorePct: number;
        recommendation: string;
      };
      standardsAndAiGovernance: {
        scorePct: number;
        recommendation: string;
      };
      employeeReadinessAndTransparency: {
        scorePct: number;
        recommendation: string;
      };
      gradualControlledRollout: {
        scorePct: number;
        rolloutPhase: string;
        recommendation: string;
      };
    };
  };
  suppliers: Array<{
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    onboardingStatus: string;
    financialHealthScore: number;
    esgScore: number;
    reliabilityScore: number;
    riskStatus: string;
  }>;
  riskEvents: Array<{
    id: string;
    supplierId: string;
    sourceProvider: string;
    eventType: string;
    severity: string;
    previousFinancialScore: number;
    newFinancialScore: number;
    summary: string;
    createdAt: string;
  }>;
  contracts: Array<{
    id: string;
    contractNumber: string;
    title: string;
    status: string;
    expiresAt: string;
    complianceScore: number;
    clauseRisksJson: Array<{
      clauseId: string;
      severity: string;
      flaggedExcerpt: string;
      issueExplanation: string;
      statutoryOrPolicyRef: string;
    }>;
    policyRedlinesJson: Array<{
      clauseId: string;
      title: string;
      suggestedClauseText: string;
    }>;
  }>;
  budgets: Array<{
    id: string;
    department: string;
    category: string;
    periodKey: string;
    allocatedPaise: number;
    committedPaise: number;
    spentPaise: number;
    hardStop: boolean;
  }>;
  requisitions: Array<{
    id: string;
    prNumber: string;
    title: string;
    department: string;
    category: string;
    estimatedTotalPaise: number;
    approvalTierRequired: string;
    budgetCheckStatus: string;
    status: string;
  }>;
  performanceLogs: Array<{
    id: string;
    supplierId: string;
    eventSource: string;
    onTimeDeliveryScore: number;
    quantityFillRatePct: number;
    invoiceAccuracyScore: number;
    previousReliabilityScore: number;
    newReliabilityScore: number;
    notes: string;
    recordedAt: string;
  }>;
}

interface IntegratedRunResponse {
  workflowExecuted: boolean;
  steps: {
    step1_dnbRiskDetection: {
      disruptedSupplierName: string;
      previousFinancialScore: number;
      newFinancialScore: number;
      severity: string;
      headline: string;
    };
    step2_approvedCatalogQuery: {
      totalAlternativesShortlisted: number;
      alternatives: Array<{
        name: string;
        compositeSuitabilityScore: number;
        estimatedLeadTimeDays: number;
        esgScore: number;
        reliabilityScore: number;
      }>;
    };
    step3_dynamicSourcingProposal: {
      rfqNumber: string;
      proposal: {
        proposalId: string;
        recommendedVendorName: string;
        backupVendorName: string | null;
        awardStrategy: string;
        creditAdjustedUnitPaise: number;
        totalOrderValuePaise: number;
        estimatedSavingsPaise: number;
        proposalMarkdown: string;
      };
    };
    step4_contractIntelligenceNlp: {
      contractNumber: string;
      report: {
        complianceScore: number;
        approvalVerdict: string;
        clauseRisks: Array<{
          clauseId: string;
          severity: string;
          issueExplanation: string;
        }>;
        policyRedlines: Array<{
          title: string;
          suggestedClauseText: string;
        }>;
      };
    };
    step5_budgetAndCoupaPoPush: {
      poNumber: string;
      totalPaise: number;
      budgetDepartment: string;
      coupaSync: {
        provider: string;
        externalPoId: string;
        invoiceMatchingArmed: boolean;
        message: string;
      };
    };
    step6_closedLoopDataLakeFeedback: {
      feedback: {
        supplierName: string;
        previousReliabilityScore: number;
        newReliabilityScore: number;
        onTimeDeliveryScore: number;
        invoiceAccuracyScore: number;
        feedbackSummary: string;
      };
    };
  };
}

export function EnterpriseLifecycleModal({
  open,
  onClose,
  onMutated,
}: {
  open: boolean;
  onClose: () => void;
  onMutated?: () => void;
}) {
  const [tab, setTab] = useState<'integrated' | 'risk' | 'contracts' | 'budgets_prs' | 'governance' | 'n8n_pnc'>('integrated');
  const [overview, setOverview] = useState<EnterpriseOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningFlow, setRunningFlow] = useState(false);
  const [flowResult, setFlowResult] = useState<IntegratedRunResponse | null>(null);
  const [n8nTriggerResult, setN8nTriggerResult] = useState<{
    webhookUrl: string;
    httpStatus: number;
    durationMs: number;
    n8nResponse: Record<string, unknown>;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Contract quick analyzer state
  const [contractTitle, setContractTitle] = useState('Annual Electronic Component Rate Contract');
  const [contractText, setContractText] = useState(
    '1. Payment Terms: Buyer shall pay all invoices within Net 60 days.\n2. GST shall be charged at 12% extra.\n3. Supplier may revise prices at its sole discretion to pass through cost increases.\n4. Automatic evergreen renewal unless terminated with 14 days notice.'
  );

  // PR & Budget quick creation state
  const [bdgDept, setBdgDept] = useState('Manufacturing');
  const [bdgCat, setBdgCat] = useState('Electronics');
  const [bdgAmount, setBdgAmount] = useState('2500000');
  const [prTitle, setPrTitle] = useState('500x Industrial Power Relay Modules');
  const [prAmount, setPrAmount] = useState('185000');
  const [prJustification, setPrJustification] = useState('Q4 assembly line expansion buffer stock');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiJson<EnterpriseOverviewResponse>('/api/enterprise/overview');
      setOverview(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load enterprise lifecycle overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadOverview();
    }
  }, [open, loadOverview]);

  const handleRunIntegratedWorkflow = async () => {
    setRunningFlow(true);
    setErrorMsg(null);
    try {
      const res = await apiJson<IntegratedRunResponse>('/api/enterprise/integrated-workflow/run', {
        method: 'POST',
        body: JSON.stringify({
          componentName: 'Industrial STM32 Microcontroller Module (Critical Electronic Component)',
          category: 'Electronics',
          qty: 1000,
          targetUnitRateRupees: 420,
          department: 'Manufacturing',
        }),
      });
      setFlowResult(res);
      await loadOverview();
      onMutated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to run integrated 6-step workflow.');
    } finally {
      setRunningFlow(false);
    }
  };

  const handleAnalyzeContract = async () => {
    if (!overview?.suppliers[0]) {
      setErrorMsg('Run the Integrated 6-Step Workflow first or add a supplier to analyze a contract.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await apiJson('/api/enterprise/contracts/analyze', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: overview.suppliers[0].id,
          title: contractTitle,
          rawContractText: contractText,
          autoRenew: true,
        }),
      });
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Contract analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBudget = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await apiJson('/api/enterprise/budgets', {
        method: 'POST',
        body: JSON.stringify({
          department: bdgDept,
          category: bdgCat,
          allocatedRupees: Number(bdgAmount) || 1000000,
        }),
      });
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save budget.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePr = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await apiJson('/api/enterprise/requisitions', {
        method: 'POST',
        body: JSON.stringify({
          title: prTitle,
          department: bdgDept,
          category: bdgCat,
          estimatedTotalRupees: Number(prAmount) || 50000,
          justification: prJustification,
        }),
      });
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create requisition.');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerLiveN8n = async (webhookPath: string, payload: Record<string, unknown>) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiJson<{
        ok: boolean;
        httpStatus: number;
        durationMs: number;
        webhookUrl: string;
        n8nResponse: Record<string, unknown>;
      }>('/api/enterprise/n8n/trigger', {
        method: 'POST',
        body: JSON.stringify({ webhookPath, payload }),
      });
      setN8nTriggerResult(res);
      await loadOverview();
      onMutated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to trigger live n8n workflow.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Enterprise Procurement Lifecycle & AI Governance Hub"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'integrated' ? 'btn-primary' : ''}`}
            onClick={() => setTab('integrated')}
          >
            <Layers size={13} /> 1. End-to-End 6-Step Workflow
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'risk' ? 'btn-primary' : ''}`}
            onClick={() => setTab('risk')}
          >
            <AlertTriangle size={13} /> 2. Onboarding, D&amp;B Risk &amp; ESG ({overview?.riskEvents.length || 0})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'contracts' ? 'btn-primary' : ''}`}
            onClick={() => setTab('contracts')}
          >
            <FileSignature size={13} /> 3. Contract Intelligence NLP ({overview?.contracts.length || 0})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'budgets_prs' ? 'btn-primary' : ''}`}
            onClick={() => setTab('budgets_prs')}
          >
            <Wallet size={13} /> 4. PRs, Budgets &amp; Approvals ({overview?.requisitions.length || 0})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'governance' ? 'btn-primary' : ''}`}
            onClick={() => setTab('governance')}
          >
            <ShieldCheck size={13} /> 5. Data Lake &amp; Rollout Governance
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'n8n_pnc' ? 'btn-primary' : ''}`}
            onClick={() => setTab('n8n_pnc')}
          >
            <Activity size={13} /> 6. Live n8n PnC Suite (10 Workflows)
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={loadOverview}
            disabled={loading}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {errorMsg && (
          <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg, #fff5f5)', padding: 10, fontSize: 12.5 }}>
            <strong>Alert:</strong> {errorMsg}
          </div>
        )}

        {tab === 'integrated' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 14 }}>
                    Connected 6-Stage Autonomous Procurement Pipeline
                  </h4>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                    Executes the complete connected chain: D&amp;B Financial Risk Detection → SAP Ariba / Approved Catalog Filter (Lead Time, Compliance, ESG) → Dynamic RFX Sourcing Proposal → NLP Contract Clause Redlining → Budget Check + Coupa PO Push (3-Way Match Armed) → Post-Transaction Data Lake Reliability Feedback Loop.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRunIntegratedWorkflow}
                  disabled={runningFlow}
                >
                  <Play size={14} /> {runningFlow ? 'Executing 6-Step Pipeline...' : 'Run Connected 6-Step Workflow'}
                </button>
              </div>
            </div>

            {flowResult && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div className="badge badge-danger" style={{ marginBottom: 6 }}>Step 1 · D&amp;B Real-Time Risk Alert</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{flowResult.steps.step1_dnbRiskDetection.disruptedSupplierName}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Financial Health Score dropped <strong>{flowResult.steps.step1_dnbRiskDetection.previousFinancialScore} → {flowResult.steps.step1_dnbRiskDetection.newFinancialScore}</strong> ({flowResult.steps.step1_dnbRiskDetection.severity.toUpperCase()}).
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="badge badge-warning" style={{ marginBottom: 6 }}>Step 2 · Approved Catalog &amp; ESG Query</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {flowResult.steps.step2_approvedCatalogQuery.totalAlternativesShortlisted} Approved Alternatives Ranked
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {flowResult.steps.step2_approvedCatalogQuery.alternatives.slice(0, 2).map((a) => (
                      <div key={a.name}>• {a.name} (Suitability {a.compositeSuitabilityScore}/100, ESG {a.esgScore}, Lead {a.estimatedLeadTimeDays}d)</div>
                    ))}
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="badge badge-success" style={{ marginBottom: 6 }}>Step 3 · Dynamic Sourcing Proposal</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Preferred: {flowResult.steps.step3_dynamicSourcingProposal.proposal.recommendedVendorName}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    RFQ {flowResult.steps.step3_dynamicSourcingProposal.rfqNumber} · Strategy: {flowResult.steps.step3_dynamicSourcingProposal.proposal.awardStrategy} · Total: {formatINR(flowResult.steps.step3_dynamicSourcingProposal.proposal.totalOrderValuePaise)}
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="badge badge-warning" style={{ marginBottom: 6 }}>Step 4 · Contract Intelligence (NLP)</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {flowResult.steps.step4_contractIntelligenceNlp.contractNumber} ({flowResult.steps.step4_contractIntelligenceNlp.report.complianceScore}/100)
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Flagged {flowResult.steps.step4_contractIntelligenceNlp.report.clauseRisks.length} outdated clauses (43B-h, GST 2.0, ITC Indemnity, Price Cap) &amp; generated {flowResult.steps.step4_contractIntelligenceNlp.report.policyRedlines.length} redlines.
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="badge badge-success" style={{ marginBottom: 6 }}>Step 5 · Budget &amp; Coupa P2P PO Sync</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {flowResult.steps.step5_budgetAndCoupaPoPush.poNumber} → {flowResult.steps.step5_budgetAndCoupaPoPush.coupaSync.externalPoId}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {flowResult.steps.step5_budgetAndCoupaPoPush.coupaSync.message}
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="badge badge-success" style={{ marginBottom: 6 }}>Step 6 · Closed-Loop Data Lake Feedback</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Reliability Score: {flowResult.steps.step6_closedLoopDataLakeFeedback.feedback.previousReliabilityScore} → {flowResult.steps.step6_closedLoopDataLakeFeedback.feedback.newReliabilityScore}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    OTIF Delivery {flowResult.steps.step6_closedLoopDataLakeFeedback.feedback.onTimeDeliveryScore}/100 · Invoice Accuracy {flowResult.steps.step6_closedLoopDataLakeFeedback.feedback.invoiceAccuracyScore}/100 logged to improve future sourcing.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'risk' && overview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ margin: 0, fontSize: 13.5 }}>Approved Supplier Risk, D&amp;B Financial Health &amp; ESG Roster</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {overview.suppliers.map((s) => (
                <div key={s.id} className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>{s.name}</strong>
                    <span className={`badge ${s.riskStatus === 'normal' ? 'badge-success' : 'badge-danger'}`}>
                      {s.riskStatus}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Onboarding: <strong>{s.onboardingStatus}</strong> · Reliability: <strong>{s.reliabilityScore}/100</strong>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    D&amp;B Financial Health: <strong>{s.financialHealthScore}/100</strong> · ESG Score: <strong>{s.esgScore}/100</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'contracts' && overview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>NLP Contract Clause &amp; Policy Redline Analyzer</h4>
              <input
                className="input"
                value={contractTitle}
                onChange={(e) => setContractTitle(e.target.value)}
                placeholder="Contract Title"
                style={{ marginBottom: 8 }}
              />
              <textarea
                className="input"
                rows={4}
                value={contractText}
                onChange={(e) => setContractText(e.target.value)}
                style={{ marginBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={handleAnalyzeContract} disabled={loading}>
                <FileSignature size={13} /> Analyze Clauses &amp; Suggest Policy Redlines
              </button>
            </div>

            {overview.contracts.map((c) => (
              <div key={c.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{c.contractNumber} — {c.title}</strong>
                  <span className="badge badge-warning">Compliance Score: {c.complianceScore}/100 · {c.status}</span>
                </div>
                <div style={{ fontSize: 12, marginTop: 8 }}>
                  {Array.isArray(c.policyRedlinesJson) && c.policyRedlinesJson.map((r) => (
                    <div key={r.clauseId} style={{ marginBottom: 6, padding: 8, background: 'var(--bg-subtle, #f8fafc)', borderRadius: 6 }}>
                      <strong>Redline — {r.title}:</strong>
                      <div className="muted" style={{ marginTop: 2 }}>{r.suggestedClauseText}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'budgets_prs' && overview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>Configure Cost-Center Budget</h4>
                <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                  <input className="input" value={bdgDept} onChange={(e) => setBdgDept(e.target.value)} placeholder="Department" />
                  <input className="input" value={bdgCat} onChange={(e) => setBdgCat(e.target.value)} placeholder="Category" />
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" type="number" value={bdgAmount} onChange={(e) => setBdgAmount(e.target.value)} placeholder="Allocated ₹" />
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleCreateBudget}>Save Budget</button>
                </div>
              </div>

              <div className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>Raise Purchase Requisition (PR)</h4>
                <input className="input" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder="Requisition Title" style={{ marginBottom: 6 }} />
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" type="number" value={prAmount} onChange={(e) => setPrAmount(e.target.value)} placeholder="Est. Total ₹" />
                  <input className="input" value={prJustification} onChange={(e) => setPrJustification(e.target.value)} placeholder="Justification" />
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleCreatePr}>Submit PR</button>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>Active Department Budgets &amp; Requisitions</h4>
              {overview.budgets.map((b) => (
                <div key={b.id} style={{ fontSize: 12.5, marginBottom: 6 }}>
                  <strong>{b.department} / {b.category} ({b.periodKey}):</strong> Allocated {formatINR(b.allocatedPaise)} · Committed {formatINR(b.committedPaise)} · Spent {formatINR(b.spentPaise)}
                </div>
              ))}
              {overview.requisitions.map((r) => (
                <div key={r.id} style={{ fontSize: 12.5, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                  <strong>{r.prNumber} — {r.title}</strong> ({formatINR(r.estimatedTotalPaise)}) · Budget: <code>{r.budgetCheckStatus}</code> · Tier: <code>{r.approvalTierRequired}</code> · Status: <strong>{r.status}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'governance' && overview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>1. Data Accuracy &amp; Hygiene</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{overview.governanceReport.pillars.dataAccuracyAndHygiene.scorePct}%</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{overview.governanceReport.pillars.dataAccuracyAndHygiene.recommendation}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>2. Standards &amp; AI Governance</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{overview.governanceReport.pillars.standardsAndAiGovernance.scorePct}%</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{overview.governanceReport.pillars.standardsAndAiGovernance.recommendation}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>3. Employee Readiness</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{overview.governanceReport.pillars.employeeReadinessAndTransparency.scorePct}%</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{overview.governanceReport.pillars.employeeReadinessAndTransparency.recommendation}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>4. Gradual Controlled Rollout</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{overview.governanceReport.pillars.gradualControlledRollout.scorePct}%</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{overview.governanceReport.pillars.gradualControlledRollout.recommendation}</div>
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>
                <TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Procurement Performance Data Lake (Closed-Loop Reliability Logs)
              </h4>
              {overview.performanceLogs.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>No post-transaction performance feedback logs yet. Run the 6-Step Integrated Workflow to see closed-loop reliability updates.</div>
              ) : (
                overview.performanceLogs.map((log) => (
                  <div key={log.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>Reliability {log.previousReliabilityScore} → {log.newReliabilityScore}</strong> (OTIF {log.onTimeDeliveryScore}/100, Fill {log.quantityFillRatePct}%, Invoice Accuracy {log.invoiceAccuracyScore}/100) — <span className="muted">{log.notes}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'n8n_pnc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: 12 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 13.5 }}>
                1-Click Live n8n Multi-Branch PnC Workflow Runner (10 Active Workflows on Port 5678)
              </h4>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Click any permutation below to fire a live webhook directly into your local n8n instance and test its Switch router branch end-to-end.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 10 }}>
              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 01 — Event Bus (5 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-events', { eventType: 'invoice.leak_detected', totalMoneyLeakPaise: 1450000, invoiceNumber: 'INV-991' })}>Critical Leak</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-events', { eventType: 'supplier.risk_drop_detected', supplierName: 'Apex Silicon Dynamics Ltd', newFinancialHealthScore: 39 })}>Risk Drop Chain</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-events', { eventType: 'po.approved', poNumber: 'PO-2026-501' })}>PO Approved</button>
                </div>
              </div>

              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 03 — Omni-ERP &amp; P2P (4 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-erp-sync', { erpProvider: 'coupa', poNumber: 'PO-COUPA-771', totalRupees: 495600 })}>Coupa P2P</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-erp-sync', { erpProvider: 'sap_ariba', poNumber: 'PO-ARIBA-772', totalRupees: 610000 })}>SAP Ariba cXML</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-erp-sync', { erpProvider: 'tally_prime', invoiceNumber: 'INV-TALLY-88' })}>Tally XML</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-erp-sync', { paymentUtr: 'UTR2026112299881', supplierIfsc: 'HDFC0000001' })}>UTR Paid</button>
                </div>
              </div>

              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 05 — 5-Gate Onboarding (4 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-verify-supplier', { companyName: 'Bharat SemiTech Pvt Ltd', gstin: '29AABCB4419K1ZK', udyamTier: 'small', financialHealthScore: 91, esgScore: 89 })}>Approve All Gates</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-verify-supplier', { companyName: 'Moderate ESG Vendor', gstin: '29AABCB4419K1ZK', financialHealthScore: 62, esgScore: 58 })}>Compliance Review</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-verify-supplier', { companyName: 'Insolvent Vendor', financialHealthScore: 30, liveGstnActive: false })}>Block Insolvent</button>
                </div>
              </div>

              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 07 — D&amp;B Risk &amp; Sourcing (3 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-risk-sourcing', { newFinancialHealthScore: 38, prioritizeBy: 'esg' })}>Critical 70/30 Fallback</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-risk-sourcing', { newFinancialHealthScore: 54, prioritizeBy: 'lead_time' })}>Elevated Standby</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-risk-sourcing', { newFinancialHealthScore: 85 })}>Healthy Check</button>
                </div>
              </div>

              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 08 — Contract Intelligence NLP (3 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-contract-nlp', { supplierUdyamTier: 'small', rawContractText: 'Payment within Net 75 days. GST @ 28% extra.' })}>43B(h) Hold</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-contract-nlp', { supplierUdyamTier: 'medium', rawContractText: 'Payment within Net 30 days. Supplier may revise prices at its sole discretion.' })}>Policy Redlines</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-contract-nlp', { autoApplyRedlines: true })}>Auto-Incorporate Redlines</button>
                </div>
              </div>

              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 09 — PR &amp; 4-Tier Budget Matrix (4 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-pr-budget-approval', { title: 'Sensor Connector Kit', estimatedTotalRupees: 18000, autoApproveLimitRupees: 25000, allocatedBudgetRupees: 500000 })}>Tier 0 Auto-RFQ</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-pr-budget-approval', { title: 'PCB Batch', estimatedTotalRupees: 65000, autoApproveLimitRupees: 25000, allocatedBudgetRupees: 500000 })}>Tier 1 Manager</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-pr-budget-approval', { title: 'SMT Pick & Place Tooling', estimatedTotalRupees: 240000, allocatedBudgetRupees: 500000 })}>Tier 2 Finance</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-pr-budget-approval', { title: 'Cleanroom Line Overrun', estimatedTotalRupees: 650000, allocatedBudgetRupees: 500000, hardStop: true })}>Tier 3 Budget Block</button>
                </div>
              </div>

              <div className="card" style={{ padding: 10 }}>
                <strong style={{ fontSize: 12.5 }}>Kraya 10 — 6-Step Pipeline &amp; Data Lake (3 PnC Branches)</strong>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => handleTriggerLiveN8n('kraya-integrated-6step', { mode: 'full_6step' })}>Full 6-Step Flow</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-integrated-6step', { mode: 'feedback_only', lateDeliveryDays: 0, invoiceHadMoneyLeak: false })}>Upgrade Reliability</button>
                  <button type="button" className="btn btn-sm" onClick={() => handleTriggerLiveN8n('kraya-integrated-6step', { mode: 'feedback_only', lateDeliveryDays: 12, acceptedQty: 700, orderedQty: 1000, invoiceHadMoneyLeak: true, invoiceMoneyLeakRupees: 45000 })}>Penalize Reliability</button>
                </div>
              </div>
            </div>

            {n8nTriggerResult && (
              <div className="card" style={{ padding: 12, background: 'var(--bg-subtle, #f8fafc)' }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: 12.5 }}>Live n8n Execution Response ({n8nTriggerResult.webhookUrl})</strong>
                  <span className="badge badge-success">HTTP {n8nTriggerResult.httpStatus} · {n8nTriggerResult.durationMs}ms</span>
                </div>
                <pre style={{ margin: 0, fontSize: 11, maxHeight: 220, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {JSON.stringify(n8nTriggerResult.n8nResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
