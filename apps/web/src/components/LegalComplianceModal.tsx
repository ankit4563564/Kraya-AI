import React, { useEffect, useState } from 'react';
import { ShieldCheck, CreditCard, FileText, CheckCircle2 } from 'lucide-react';
import { apiJson } from '../lib/api';
import { ModalDialog } from './ModalDialog';

interface BillingStatusResponse {
  subscription: {
    planCode: string;
    planName: string;
    status: string;
    monthlyPriceInr: number;
    currentPeriodEnd: string | null;
  };
  usage: {
    invoicesAudited: number;
    agentRunsExecuted: number;
    vaultUsedMb: number;
    teamSeatsUsed: number;
    gstnLookupsCached: number;
  };
  limits: {
    maxInvoicesPerMonth: number;
    maxAgentRunsPerMonth: number;
    maxVaultMb: number;
    maxTeamSeats: number;
  };
  razorpayConfigured: boolean;
  plans: Array<{
    code: 'free_pilot' | 'growth_1499' | 'enterprise_4999';
    name: string;
    monthlyPriceInr: number;
    features: string[];
  }>;
}

interface Props {
  open: boolean;
  initialTab?: 'plans' | 'dpdp' | 'terms';
  isOwner: boolean;
  onClose: () => void;
}

export function LegalComplianceModal({ open, initialTab = 'plans', isOwner, onClose }: Props) {
  const [tab, setTab] = useState<'plans' | 'dpdp' | 'terms'>(initialTab);
  const [billing, setBilling] = useState<BillingStatusResponse | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  const loadBilling = () => {
    apiJson<BillingStatusResponse>('/api/billing/status')
      .then(setBilling)
      .catch(() => {});
  };

  useEffect(() => {
    if (open) loadBilling();
  }, [open]);

  const handleSelectPlan = async (planCode: 'free_pilot' | 'growth_1499' | 'enterprise_4999') => {
    setBusyPlan(planCode);
    setMsg(null);
    try {
      const res = await apiJson<{ mode: string; note?: string; orderId?: string }>(
        '/api/billing/checkout',
        {
          method: 'POST',
          body: JSON.stringify({ planCode }),
        }
      );
      setMsg(
        res.mode === 'razorpay_live_order'
          ? `Razorpay Order ${res.orderId} created — complete payment to activate.`
          : res.note || 'Plan updated successfully.'
      );
      loadBilling();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Plan update failed');
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Plans, Usage Metering & DPDP Act 2023 Legal Shield"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'plans' ? 'btn-primary' : ''}`}
          onClick={() => setTab('plans')}
        >
          <CreditCard size={12} /> Plans &amp; Usage
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'dpdp' ? 'btn-primary' : ''}`}
          onClick={() => setTab('dpdp')}
        >
          <ShieldCheck size={12} /> DPDP Act 2023 Privacy
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'terms' ? 'btn-primary' : ''}`}
          onClick={() => setTab('terms')}
        >
          <FileText size={12} /> Terms &amp; CA Disclaimer
        </button>
      </div>

      {msg && (
        <div className="card" style={{ padding: 10, marginBottom: 12, background: 'var(--bg-subtle)', fontSize: 12.5 }}>
          {msg}
        </div>
      )}

      {tab === 'plans' && billing && (
        <div>
          <div className="card" style={{ padding: 12, marginBottom: 12, background: 'var(--bg-subtle)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Active Plan</div>
                <strong style={{ fontSize: 15 }}>
                  {billing.subscription.planName} (₹{billing.subscription.monthlyPriceInr.toLocaleString('en-IN')}/mo)
                </strong>
              </div>
              <span className="pill pill-success">{billing.subscription.status.toUpperCase()}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 10, fontSize: 12 }}>
              <div>
                Invoices: <strong className="mono">{billing.usage.invoicesAudited}/{billing.limits.maxInvoicesPerMonth}</strong>
              </div>
              <div>
                AI Agent Runs: <strong className="mono">{billing.usage.agentRunsExecuted}/{billing.limits.maxAgentRunsPerMonth}</strong>
              </div>
              <div>
                Vault: <strong className="mono">{billing.usage.vaultUsedMb}/{billing.limits.maxVaultMb} MB</strong>
              </div>
              <div>
                Seats: <strong className="mono">{billing.usage.teamSeatsUsed}/{billing.limits.maxTeamSeats}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {billing.plans.map((p) => {
              const isCurrent = p.code === billing.subscription.planCode;
              return (
                <div
                  key={p.code}
                  className="card"
                  style={{
                    padding: 12,
                    border: isCurrent ? '1.5px solid var(--accent)' : undefined,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 8px' }}>
                      ₹{p.monthlyPriceInr.toLocaleString('en-IN')}
                      <span style={{ fontSize: 11, fontWeight: 400 }}>/mo</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                      {p.features.map((f, idx) => (
                        <li key={idx}>{f}</li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-sm ${isCurrent ? '' : 'btn-primary'}`}
                    disabled={isCurrent || !isOwner || busyPlan !== null}
                    onClick={() => handleSelectPlan(p.code)}
                  >
                    {isCurrent ? (
                      <>
                        <CheckCircle2 size={12} /> Current Plan
                      </>
                    ) : busyPlan === p.code ? (
                      'Updating...'
                    ) : (
                      `Switch to ${p.name}`
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'dpdp' && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <h4 style={{ marginTop: 0, color: 'var(--text-primary)' }}>
            Digital Personal Data Protection (DPDP) Act 2023 &amp; Rules 2025 Notice
          </h4>
          <ul>
            <li><strong>Purpose Limitation:</strong> Supplier phone numbers, emails, GSTINs (containing embedded PANs), invoices, and quotes are processed strictly for procurement verification, landed-cost math, and audit records inside your isolated tenant workspace.</li>
            <li><strong>Zero-Training Commercial AI Guarantee:</strong> Production deployments use zero-retention paid AI APIs so commercial supplier bills and negotiated prices are never used to train third-party models.</li>
            <li><strong>1-Year Immutable Audit Retention:</strong> Every PO approval, invoice audit, GSTN check, and data access event is sealed inside a SHA-256 tamper-evident hash chain verifiable at any time.</li>
            <li><strong>Data Principal Rights (Self-Service):</strong> Workspace Owners can export 100% of company data (`GET /api/compliance/export-data`) or trigger complete workspace erasure including physical deletion of all stored vault files (`DELETE /api/compliance/erase-workspace`) inside Settings &amp; Team.</li>
          </ul>
        </div>
      )}

      {tab === 'terms' && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <h4 style={{ marginTop: 0, color: 'var(--text-primary)' }}>
            Terms of Service &amp; Indian Tax / Statutory Disclaimer
          </h4>
          <ul>
            <li><strong>Automated Pre-Payment Verification Only:</strong> Kraya provides deterministic GST 2.0, Section 43B(h) MSME, Rule 37, TDS 194C/194Q, and GSTR-2B/IMS pre-payment verification. Final GST ITC claims, IMS actions, and Income Tax filings remain subject to verification by your Chartered Accountant.</li>
            <li><strong>Human-in-the-Loop Execution Gate:</strong> Kraya never issues binding Purchase Orders, sends outbound WhatsApp/Email messages, or releases bank payouts without explicit human confirmation.</li>
            <li><strong>Zero-Ban WhatsApp Policy:</strong> Step 1 outreach uses official `wa.me` links and Step 2 uses the Official Meta WhatsApp Cloud API only.</li>
          </ul>
        </div>
      )}
    </ModalDialog>
  );
}
