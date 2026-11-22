import React, { useEffect, useState } from 'react';
import {
  Plus,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
  History,
  ShieldCheck,
  Compass,
} from 'lucide-react';
import { apiJson, formatINR, SupplierRecord, UserRole } from '../lib/api';
import { NavTab } from '../lib/workflow';
import { ModalDialog } from '../components/ModalDialog';
import { OutreachModalRequest } from '../components/OutreachModal';
import { SupplierDiscoveryModal } from '../components/SupplierDiscoveryModal';
import { NextStepBanner } from '../components/WorkflowJourneyRail';

interface TimelineResponse {
  events: Array<{ id: string; channel: string; parsedSummary: string; createdAt: string }>;
  priceHistory: Array<{ id: string; itemDescription: string; netLandedUnitPaise: number; unit: string; recordedAt: string }>;
  purchaseOrders: Array<{ id: string; poNumber: string; totalPaise: number; poDate: string }>;
  invoices: Array<{ id: string; invoiceNumber: string; totalMoneyLeakPaise: number; imsSuggestedAction: string }>;
}

interface Props {
  userRole: UserRole;
  onDataMutated: () => void;
  onOpenOutreach: (req: OutreachModalRequest) => void;
  onNavigate?: (tab: NavTab) => void;
  refreshTick?: number;
}

export function SuppliersView({ userRole, onDataMutated, onOpenOutreach, onNavigate, refreshTick = 0 }: Props) {
  const isCaReadOnly = userRole === 'ca';
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [gstnLiveResults, setGstnLiveResults] = useState<
    Record<
      string,
      {
        taxpayerStatus: string;
        taxpayerType: string;
        liveVerified: boolean;
        fromCache: boolean;
        riskLevel: string;
        filingComplianceNote: string;
        officialPortalUrl: string;
      }
    >
  >({});

  // Add Supplier Form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('Packaging');
  const [gstin, setGstin] = useState('');
  const [gstRegime, setGstRegime] = useState<'regular' | 'composition' | 'unregistered'>('regular');
  const [udyamTier, setUdyamTier] = useState<SupplierRecord['udyamTier']>('small');
  const [eInvoiceRequired, setEInvoiceRequired] = useState(false);
  const [creditDays, setCreditDays] = useState('30');
  const [gstinCheck, setGstinCheck] = useState<{ valid: boolean; msg: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () => {
    apiJson<SupplierRecord[]>('/api/suppliers')
      .then(setSuppliers)
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const handleLiveVerifyGstin = async (sup: SupplierRecord) => {
    if (!sup.gstin) return;
    setVerifyingId(sup.id);
    try {
      const res = await apiJson<{
        taxpayerStatus: string;
        taxpayerType: string;
        liveVerified: boolean;
        fromCache: boolean;
        riskLevel: string;
        filingComplianceNote: string;
        officialPortalUrl: string;
      }>('/api/gstin/verify-live', {
        method: 'POST',
        body: JSON.stringify({
          gstin: sup.gstin,
          supplierId: sup.id,
          applyToSupplier: !isCaReadOnly,
        }),
      });
      setGstnLiveResults((prev) => ({ ...prev, [sup.id]: res }));
      load();
    } catch {
      // ignore transient error
    } finally {
      setVerifyingId(null);
    }
  };

  const handleGstinChange = async (val: string) => {
    const clean = val.trim().toUpperCase();
    setGstin(clean);
    if (!clean) {
      setGstinCheck(null);
      return;
    }
    if (clean.length === 15) {
      const res = await apiJson<{
        valid: boolean;
        stateName: string | null;
        stateCode: string | null;
        panEntityLabel: string | null;
        tds194cRatePct: number | null;
        errors: string[];
      }>('/api/gstin/validate', {
        method: 'POST',
        body: JSON.stringify({ gstin: clean }),
      });
      if (res.valid) {
        setGstinCheck({
          valid: true,
          msg: `Valid Mod-36 · ${res.stateName} (${res.stateCode}) · ${res.panEntityLabel} (194C: ${res.tds194cRatePct}%)`,
        });
      } else {
        setGstinCheck({ valid: false, msg: res.errors[0] || 'Invalid GSTIN' });
      }
    } else {
      setGstinCheck({ valid: false, msg: `${clean.length}/15 chars` });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await apiJson('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          phone,
          email,
          category,
          gstin: gstin || undefined,
          gstRegime,
          udyamTier,
          eInvoiceRequired,
          creditDays: Number(creditDays) || 30,
        }),
      });
      setShowAdd(false);
      setName('');
      setPhone('');
      setEmail('');
      setGstin('');
      setGstinCheck(null);
      load();
      onDataMutated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create supplier');
    }
  };

  const openTimeline = async (sup: SupplierRecord) => {
    setSelectedSupplier(sup);
    setTimeline(null);
    const data = await apiJson<TimelineResponse>(`/api/suppliers/${sup.id}/timeline`);
    setTimeline(data);
  };

  return (
    <div className="stack">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21 }}>My Suppliers — Unified Vendor Book</h1>
          <p className="card-subtitle">
            Contacts, GSTIN Mod-36 verification, Udyam Section 43B(h) classification, e-Invoice requirement, credit terms, and multi-channel history.
          </p>
        </div>
        {!isCaReadOnly && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowDiscover(true)}>
              <Compass size={15} /> Live AI Sourcing
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={15} /> Add Supplier
            </button>
          </div>
        )}
      </div>

      {suppliers.length === 0 ? (
        <div className="empty-state">
          <h3>Your Supplier Book is empty</h3>
          <p>Discover vetted local Indian vendors via real-time AI sourcing, or add them manually with instant Mod-36 GSTIN &amp; Udyam 43B(h) verification.</p>
          <div className="row" style={{ marginTop: 12, gap: 10, justifyContent: 'center' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowDiscover(true)}>
              <Compass size={14} /> Live AI Sourcing
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add First Supplier
            </button>
          </div>
        </div>
      ) : (
        <div tabIndex={0} role="region" aria-labelledby="suppliers-table-cap" className="table-wrapper">
          <table className="data-table">
            <caption id="suppliers-table-cap">Active Supplier Directory ({suppliers.length})</caption>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>GSTIN & Regime</th>
                <th>Udyam (43B-h)</th>
                <th>Terms</th>
                <th>Reliability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <th>
                    <div>{s.name}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-muted)' }}>
                      {[s.phone ? `+91 ${s.phone}` : null, s.email].filter(Boolean).join(' · ') || 'No contact saved'}
                    </div>
                  </th>
                  <td data-label="GSTIN & Regime">
                    <div className="mono" style={{ fontSize: 12 }}>{s.gstin || 'Not set'}</div>
                    <div className="row" style={{ marginTop: 2 }}>
                      <span className={`pill ${s.gstRegime === 'composition' ? 'pill-warning' : ''}`}>
                        {s.gstRegime}
                      </span>
                      {s.eInvoiceRequired && <span className="pill pill-accent">IRN Req (&gt;₹5Cr)</span>}
                      {gstnLiveResults[s.id] && (
                        <a
                          href={gstnLiveResults[s.id].officialPortalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`pill ${gstnLiveResults[s.id].riskLevel === 'critical' ? 'pill-danger' : gstnLiveResults[s.id].liveVerified ? 'pill-success' : 'pill-warning'}`}
                          title={gstnLiveResults[s.id].filingComplianceNote}
                        >
                          {gstnLiveResults[s.id].liveVerified
                            ? `GSTN: ${gstnLiveResults[s.id].taxpayerStatus}`
                            : 'Mod-36 OK · Portal ↗'}
                        </a>
                      )}
                    </div>
                  </td>
                  <td data-label="Udyam (43B-h)">
                    <span
                      className={`pill ${
                        s.udyamTier === 'micro' || s.udyamTier === 'small' ? 'pill-warning' : ''
                      }`}
                    >
                      {s.udyamTier.toUpperCase()}
                      {s.udyamTier === 'micro' || s.udyamTier === 'small' ? ' (45d Cap)' : ''}
                    </span>
                  </td>
                  <td data-label="Terms" className="mono">
                    Net {s.creditDays}d
                  </td>
                  <td data-label="Reliability">
                    <span className="pill pill-success">
                      <ShieldCheck size={12} /> {s.reliabilityScore}/100
                    </span>
                  </td>
                  <td data-label="Actions">
                    <div className="row">
                      {s.gstin && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={verifyingId === s.id}
                          onClick={() => handleLiveVerifyGstin(s)}
                          title="Verify GSTN status (30-day cached)"
                        >
                          <ShieldCheck size={13} />{' '}
                          {verifyingId === s.id ? 'Checking...' : 'Verify GSTN'}
                        </button>
                      )}
                      <button type="button" className="btn btn-sm" onClick={() => openTimeline(s)}>
                        <History size={13} /> History
                      </button>
                      <button
                        type="button"
                        className="btn btn-whatsapp btn-sm"
                        onClick={() =>
                          onOpenOutreach({
                            scenario: 'rfq_request',
                            supplierName: s.name,
                            supplierPhone: s.phone,
                            supplierEmail: s.email,
                          })
                        }
                      >
                        <MessageCircle size={13} /> RFQ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onNavigate && (
        <NextStepBanner
          stepLabel="Step 1 → Step 2"
          title="Suppliers verified? Float an RFQ & collect quotes next"
          description="Create an RFQ or drop WhatsApp/Email replies from your vendors to compare Credit-Adjusted Landed Cost and unlock AI BATNA negotiation."
          primaryActionLabel="Go to Buying & RFQs"
          onPrimaryAction={() => onNavigate('buying')}
          secondaryActionLabel="Open Guided Prompt Studio"
          onSecondaryAction={() => onNavigate('new_task')}
        />
      )}

      {/* Add Supplier Modal */}
      <ModalDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add Local Supplier to Unified Book"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" form="add-supplier-form" className="btn btn-primary">Save Supplier</button>
          </>
        }
      >
        <form id="add-supplier-form" onSubmit={handleCreate}>
          {formError && (
            <div className="card" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', marginBottom: 12, padding: 10 }}>
              {formError}
            </div>
          )}
          <div className="field">
            <label htmlFor="sup-name">Supplier / Party Legal Name</label>
            <input id="sup-name" required placeholder="e.g. Bharat Corrugators Pvt Ltd" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="sup-phone">WhatsApp / Mobile (10 digits)</label>
              <span className="hint">Used for 1-click official wa.me bridges</span>
              <input id="sup-phone" type="tel" pattern="[0-9]{10}" placeholder="9820012345" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <div className="error-msg">Enter a 10-digit Indian mobile number.</div>
            </div>
            <div className="field">
              <label htmlFor="sup-email">Email</label>
              <input id="sup-email" type="email" placeholder="sales@vendor.in" value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="error-msg">Enter a valid email address.</div>
            </div>
          </div>

          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="sup-gstin">Supplier GSTIN (Optional)</label>
              <span className="hint">Instant Mod-36 checksum + State + 194C TDS</span>
              <input id="sup-gstin" maxLength={15} className="mono" placeholder="27AAPCA1234F1Z5" value={gstin} onChange={(e) => handleGstinChange(e.target.value)} />
              {gstinCheck && (
                <div style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4, color: gstinCheck.valid ? 'var(--success)' : 'var(--danger)' }}>
                  {gstinCheck.valid ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                  {gstinCheck.msg}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="sup-cat">Category</label>
              <input id="sup-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="sup-regime">GST Regime</label>
              <select id="sup-regime" value={gstRegime} onChange={(e) => setGstRegime(e.target.value as SupplierRecord['gstRegime'])}>
                <option value="regular">Regular (ITC Eligible)</option>
                <option value="composition">Composition (0% GST / No ITC)</option>
                <option value="unregistered">Unregistered</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sup-udyam">Udyam Tier (43B-h)</label>
              <select id="sup-udyam" value={udyamTier} onChange={(e) => setUdyamTier(e.target.value as SupplierRecord['udyamTier'])}>
                <option value="unknown">Unknown</option>
                <option value="micro">Micro Mfg/Svc (45d Cap)</option>
                <option value="small">Small Mfg/Svc (45d Cap)</option>
                <option value="medium">Medium (Exempt 43B-h)</option>
                <option value="trader">Trader (Exempt 43B-h)</option>
                <option value="unregistered">Not Udyam Registered</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sup-credit">Default Credit Days</label>
              <input id="sup-credit" type="number" value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
            </div>
          </div>

          <label className="row" style={{ fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={eInvoiceRequired} onChange={(e) => setEInvoiceRequired(e.target.checked)} />
            Supplier turnover &gt; ₹5 Cr (Mandatory E-Invoice IRN + QR required on every bill)
          </label>
        </form>
      </ModalDialog>

      {/* Supplier Multi-Channel Timeline Modal */}
      <ModalDialog
        open={Boolean(selectedSupplier)}
        onClose={() => setSelectedSupplier(null)}
        title={`Multi-Channel Audit History — ${selectedSupplier?.name || ''}`}
      >
        {!timeline ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading timeline...</div>
        ) : (
          <div className="stack">
            <div>
              <strong>Price History ({timeline.priceHistory.length})</strong>
              {timeline.priceHistory.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No approved PO rates recorded yet.</div>
              ) : (
                timeline.priceHistory.map((p) => (
                  <div key={p.id} className="mono" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {p.itemDescription}: {formatINR(p.netLandedUnitPaise)}/{p.unit} ({new Date(p.recordedAt).toLocaleDateString('en-IN')})
                  </div>
                ))
              )}
            </div>
            <div>
              <strong>Multi-Channel Events ({timeline.events.length})</strong>
              {timeline.events.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No WhatsApp/Email/Call events logged yet.</div>
              ) : (
                timeline.events.map((e) => (
                  <div key={e.id} style={{ fontSize: 12.5, marginTop: 6, padding: 8, borderRadius: 8, background: 'var(--bg-subtle)' }}>
                    <span className="pill">{e.channel.toUpperCase()}</span> {e.parsedSummary}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </ModalDialog>

      <SupplierDiscoveryModal
        open={showDiscover}
        onClose={() => setShowDiscover(false)}
        onSupplierAdded={() => {
          load();
          onDataMutated();
        }}
        onOpenOutreach={onOpenOutreach}
      />
    </div>
  );
}
