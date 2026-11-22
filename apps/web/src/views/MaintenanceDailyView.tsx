import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ShieldAlert,
  Wrench,
  MessageCircle,
  Plus,
  FileSearch,
  FileSpreadsheet,
  FileCode2,
  FileCheck2,
  TrendingUp,
  Bot,
} from 'lucide-react';
import { API_BASE, apiJson, ComplianceFlag, formatINR, SupplierRecord, UserRole } from '../lib/api';
import { ModalDialog } from '../components/ModalDialog';
import { OutreachModalRequest } from '../components/OutreachModal';
import { Gstr2bReconcilerModal } from '../components/Gstr2bReconcilerModal';

interface CfoIntelligence {
  totals: {
    totalPoSpendPaise: number;
    totalInvoicedPaise: number;
    totalGstPaidPaise: number;
    totalLeaksDetectedPaise: number;
    totalLeaksRecoveredPaise: number;
    openLeaksPaise: number;
  };
  spendByCategory: Array<{ category: string; spendPaise: number }>;
  topSuppliers: Array<{ supplierId: string; name: string; category: string; spendPaise: number; invoiceCount: number }>;
  priceCreepAlerts: Array<{
    itemDescription: string;
    supplierName: string;
    unit: string;
    baselineUnitPaise: number;
    latestUnitPaise: number;
    deltaPct: number;
    observations: number;
  }>;
  paymentCliffs: Array<{
    invoiceId: string;
    invoiceNumber: string;
    supplierName: string;
    udyamTier: string;
    grandTotalPaise: number;
    msme43bhDueAt: string | null;
    msmeDaysRemaining: number | null;
    rule37CliffAt: string | null;
    rule37DaysRemaining: number | null;
    urgency: 'critical' | 'warning' | 'normal';
  }>;
}

interface DailyTaskRow {
  id: string;
  kind: string;
  title: string;
  priority: string;
  dueAt: string;
  suggestedMessage: string | null;
  status: 'open' | 'done' | 'snoozed';
  supplier: SupplierRecord | null;
}

interface AmcRow {
  id: string;
  assetName: string;
  frequencyDays: number;
  nextDueAt: string;
  lastRatePaise: number | null;
  notes: string | null;
  supplier: SupplierRecord | null;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  grandTotalPaise: number;
  mathReconciled: boolean;
  poMatchStatus: string;
  imsSuggestedAction: string;
  totalMoneyLeakPaise: number;
  cfoVerdict: string;
  msme43bhDueAt: string | null;
  rule37CliffAt: string | null;
  flagsJson: ComplianceFlag[];
  supplier: SupplierRecord | null;
  totalCreditedPaise?: number;
  netPayablePaise?: number;
  creditNotes?: Array<{ id: string; voucherType: string; voucherNumber: string; totalPaise: number; reason: string }>;
}

interface PoOption {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier: SupplierRecord | null;
}

interface Props {
  userRole: UserRole;
  onDataMutated: () => void;
  onOpenOutreach: (req: OutreachModalRequest) => void;
}

export function MaintenanceDailyView({ userRole, onDataMutated, onOpenOutreach }: Props) {
  const isCaReadOnly = userRole === 'ca';
  const [tasks, setTasks] = useState<DailyTaskRow[]>([]);
  const [amcs, setAmcs] = useState<AmcRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [pos, setPos] = useState<PoOption[]>([]);

  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showAmcModal, setShowAmcModal] = useState(false);
  const [showGstr2bModal, setShowGstr2bModal] = useState(false);
  const [cfoIntel, setCfoIntel] = useState<CfoIntelligence | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepBanner, setSweepBanner] = useState<string | null>(null);
  const [cnInvoice, setCnInvoice] = useState<InvoiceRow | null>(null);
  const [cnType, setCnType] = useState<'credit_note' | 'debit_note'>('credit_note');
  const [cnNumber, setCnNumber] = useState('');
  const [cnTaxable, setCnTaxable] = useState('');
  const [cnCgst, setCnCgst] = useState('0');
  const [cnSgst, setCnSgst] = useState('0');
  const [cnIgst, setCnIgst] = useState('0');
  const [cnReason, setCnReason] = useState('');
  const [cnError, setCnError] = useState<string | null>(null);

  // Invoice Audit Form
  const [invSupplierId, setInvSupplierId] = useState('');
  const [invPoId, setInvPoId] = useState('');
  const [invNo, setInvNo] = useState('');
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invIrn, setInvIrn] = useState('');
  const [invDesc, setInvDesc] = useState('5-Ply Corrugated Box');
  const [invHsn, setInvHsn] = useState('4819');
  const [invQty, setInvQty] = useState('5000');
  const [invRate, setInvRate] = useState('26.50');
  const [invGst, setInvGst] = useState('5');
  const [invFreight, setInvFreight] = useState('5000');
  const [invFreightGst, setInvFreightGst] = useState('18');
  const [invDoubleFreight, setInvDoubleFreight] = useState(false);
  const [invCgst, setInvCgst] = useState('3762.50');
  const [invSgst, setInvSgst] = useState('3762.50');
  const [invIgst, setInvIgst] = useState('0');
  const [invGrand, setInvGrand] = useState('145025');

  // AMC Form
  const [amcAsset, setAmcAsset] = useState('');
  const [amcSupId, setAmcSupId] = useState('');
  const [amcFreq, setAmcFreq] = useState('90');
  const [amcDue, setAmcDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [amcRate, setAmcRate] = useState('');

  const loadAll = () => {
    Promise.all([
      apiJson<DailyTaskRow[]>('/api/tasks'),
      apiJson<AmcRow[]>('/api/amc'),
      apiJson<InvoiceRow[]>('/api/invoices'),
      apiJson<SupplierRecord[]>('/api/suppliers'),
      apiJson<PoOption[]>('/api/pos'),
      apiJson<CfoIntelligence>('/api/analytics/cfo-intelligence').catch(() => null),
    ])
      .then(([t, a, inv, s, p, intel]) => {
        setTasks(t);
        setAmcs(a);
        setInvoices(inv);
        setSuppliers(s);
        setPos(p);
        setCfoIntel(intel);
        if (s.length > 0 && !invSupplierId) {
          setInvSupplierId(s[0].id);
          setAmcSupId(s[0].id);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAll();
  }, []);

  const runAutonomousSweep = async () => {
    setSweeping(true);
    setSweepBanner(null);
    try {
      const res = await apiJson<{
        createdTasksCount: number;
        summary: {
          staleRfqsFound: number;
          overdueDeliveriesFound: number;
          msmeCliffsFound: number;
          rule37CliffsFound: number;
          amcsDueFound: number;
          incompleteKycSuppliers: number;
        };
      }>('/api/automation/run-sweep', { method: 'POST' });
      setSweepBanner(
        `Autonomous Sweep complete: ${res.createdTasksCount} new task(s) queued (${res.summary.staleRfqsFound} stale RFQs · ${res.summary.overdueDeliveriesFound} overdue POs · ${res.summary.msmeCliffsFound} 43B(h) cliffs · ${res.summary.incompleteKycSuppliers} incomplete KYC vendors).`
      );
      loadAll();
      onDataMutated();
    } catch (err) {
      setSweepBanner(err instanceof Error ? err.message : 'Sweep failed.');
    } finally {
      setSweeping(false);
    }
  };

  const toggleTask = async (id: string, current: 'open' | 'done' | 'snoozed') => {
    await apiJson(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: current === 'done' ? 'open' : 'done' }),
    });
    loadAll();
    onDataMutated();
  };

  const handleAuditInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invSupplierId) return;
    const qty = Number(invQty) || 1;
    const rate = Number(invRate) || 0;
    const freight = Number(invFreight) || 0;
    await apiJson('/api/invoices/audit', {
      method: 'POST',
      body: JSON.stringify({
        poId: invPoId || null,
        supplierId: invSupplierId,
        invoiceNumber: invNo || `INV-${Date.now().toString().slice(-4)}`,
        invoiceDate: invDate,
        irn: invIrn.trim() || null,
        itemKey: invDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: invDesc,
        hsnSac: invHsn,
        qty,
        unit: 'pc',
        unitRateRupees: rate,
        gstPct: Number(invGst) || 0,
        freightRupees: freight,
        freightGstPct: Number(invFreightGst) || 0,
        freightGstMode: 'composite_supply',
        freightAlreadyTaxInclusive: invDoubleFreight,
        statedTaxableRupees: qty * rate + freight,
        statedCgstRupees: Number(invCgst) || 0,
        statedSgstRupees: Number(invSgst) || 0,
        statedIgstRupees: Number(invIgst) || 0,
        statedGrandTotalRupees: Number(invGrand) || 0,
      }),
    });
    setShowAuditModal(false);
    setInvNo('');
    loadAll();
    onDataMutated();
  };

  const handleCreateAmc = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiJson('/api/amc', {
      method: 'POST',
      body: JSON.stringify({
        assetName: amcAsset,
        supplierId: amcSupId || null,
        frequencyDays: Number(amcFreq) || 90,
        nextDueAt: amcDue,
        lastRateRupees: Number(amcRate) || undefined,
      }),
    });
    setShowAmcModal(false);
    setAmcAsset('');
    setAmcRate('');
    loadAll();
    onDataMutated();
  };

  const handleRecordCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnInvoice) return;
    setCnError(null);
    try {
      await apiJson('/api/credit-notes', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: cnInvoice.id,
          voucherType: cnType,
          voucherNumber: cnNumber,
          taxableRupees: Number(cnTaxable),
          cgstRupees: Number(cnCgst) || 0,
          sgstRupees: Number(cnSgst) || 0,
          igstRupees: Number(cnIgst) || 0,
          reason: cnReason,
        }),
      });
      setCnInvoice(null);
      setCnNumber('');
      setCnReason('');
      loadAll();
      onDataMutated();
    } catch (err) {
      setCnError(err instanceof Error ? err.message : 'Failed to record Credit/Debit Note');
    }
  };

  return (
    <div className="stack">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21 }}>Maintenance, Daily Tasks & PO-vs-Invoice Audit</h1>
          <p className="card-subtitle">
            Automated daily checklist: delivery chases, MSME Section 43B(h) tax-shield deadlines, GST IMS bill audits, and machinery AMC schedules.
          </p>
        </div>
        {!isCaReadOnly && (
          <div className="row">
            <button type="button" className="btn" onClick={() => setShowAmcModal(true)}>
              <Wrench size={14} /> Add AMC / Spares Schedule
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowAuditModal(true)}>
              <FileSearch size={14} /> Audit Invoice vs. PO
            </button>
          </div>
        )}
      </div>

      {/* Phase 13 — CFO Spend, Price-Creep & 43B(h) Payment Cliff Intelligence */}
      {cfoIntel && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">CFO Spend, Price-Creep &amp; Payment Cliff Intelligence</h2>
              <p className="card-subtitle">Live integer-paise aggregation of PO spend, GST ITC paid, silent vendor price creep, and statutory MSME 43B(h) deadlines.</p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowGstr2bModal(true)}>
              <FileCheck2 size={14} /> Reconcile GSTR-2B / IMS
            </button>
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total PO Spend · GST Paid</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{formatINR(cfoIntel.totals.totalPoSpendPaise)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Invoiced: {formatINR(cfoIntel.totals.totalInvoicedPaise)} · GST: {formatINR(cfoIntel.totals.totalGstPaidPaise)}
              </div>
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Money Leaks Caught vs. Recovered</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: cfoIntel.totals.openLeaksPaise > 0 ? 'var(--danger)' : 'var(--success)' }}>
                {formatINR(cfoIntel.totals.totalLeaksDetectedPaise)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Recovered: {formatINR(cfoIntel.totals.totalLeaksRecoveredPaise)} · Open: {formatINR(cfoIntel.totals.openLeaksPaise)}
              </div>
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Price-Creep &amp; 43B(h) Cliffs</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                {cfoIntel.priceCreepAlerts.length} Creep · {cfoIntel.paymentCliffs.length} Upcoming
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                {cfoIntel.paymentCliffs.filter((c) => c.urgency === 'critical').length} critical within 7 days
              </div>
            </div>
          </div>

          {cfoIntel.priceCreepAlerts.length > 0 && (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                <TrendingUp size={13} color="var(--danger)" /> Active Silent Price-Creep Alerts (&ge; 2%)
              </div>
              {cfoIntel.priceCreepAlerts.slice(0, 4).map((alert, idx) => (
                <div
                  key={`${alert.supplierName}-${idx}`}
                  className="row"
                  style={{ justifyContent: 'space-between', fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'color-mix(in srgb, var(--danger-soft) 25%, var(--bg-surface))' }}
                >
                  <span>
                    <strong>{alert.itemDescription}</strong> ({alert.supplierName})
                  </span>
                  <span className="mono">
                    {formatINR(alert.baselineUnitPaise)} &rarr; <strong>{formatINR(alert.latestUnitPaise)}</strong>/{alert.unit}{' '}
                    <span style={{ color: 'var(--danger)', fontWeight: 700 }}>(+{alert.deltaPct}%)</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Today's Automated Checklist */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Daily Follow-Up & Compliance Queue ({tasks.filter((t) => t.status === 'open').length} Open)</h2>
            <p className="card-subtitle">Auto-populated from approved POs, MSME 43B(h) invoices, incomplete vendor KYC, and recurring AMC schedules.</p>
          </div>
          {!isCaReadOnly && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={sweeping}
              onClick={runAutonomousSweep}
            >
              <Bot size={14} /> {sweeping ? 'Sweeping...' : 'Run Autonomous Expeditor Sweep'}
            </button>
          )}
        </div>

        {sweepBanner && (
          <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-app)', border: '1px solid var(--border)', marginBottom: 10 }}>
            {sweepBanner}
          </div>
        )}

        {tasks.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No open daily tasks yet.</div>
        ) : (
          <div className="stack">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  opacity: t.status === 'done' ? 0.6 : 1,
                }}
              >
                <div className="row" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => toggleTask(t.id, t.status)}
                    aria-label={t.status === 'done' ? 'Mark task open' : 'Mark task done'}
                  >
                    <CheckCircle2 size={14} style={{ color: t.status === 'done' ? 'var(--success)' : 'var(--text-muted)' }} />
                  </button>
                  <div>
                    <div className="row" style={{ marginBottom: 2 }}>
                      <span className={`pill ${t.kind === 'payment_43bh' ? 'pill-critical' : t.priority === 'high' ? 'pill-warning' : ''}`}>
                        {t.kind.replace('_', ' ').toUpperCase()}
                      </span>
                      <span className="pill">
                        <Clock size={11} /> Due {t.dueAt}
                      </span>
                    </div>
                    <div style={{ fontWeight: 500, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                      {t.title}
                    </div>
                  </div>
                </div>
                {t.supplier && (
                  <button
                    type="button"
                    className="btn btn-whatsapp btn-sm"
                    onClick={() =>
                      onOpenOutreach({
                        scenario: 'delivery_chase',
                        supplierName: t.supplier!.name,
                        supplierPhone: t.supplier!.phone,
                        supplierEmail: t.supplier!.email,
                        itemDescription: t.title,
                        dueDate: t.dueAt,
                      })
                    }
                  >
                    <MessageCircle size={13} /> 1-Click Nudge
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audited Invoices & GST IMS Decisions */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">PO-vs-Invoice Mismatch &amp; GST IMS Register ({invoices.length})</h2>
            <p className="card-subtitle">Every bill checked for math reconciliation, CGST/IGST state split, IRN compliance, and MSME 43B(h) + 180-day Rule 37 dates.</p>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <a
              href={`${API_BASE}/api/exports/tally.xml`}
              className="btn btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <FileCode2 size={13} /> Tally Prime XML
            </a>
            <a
              href={`${API_BASE}/api/exports/zoho-books.csv`}
              className="btn btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <FileSpreadsheet size={13} /> Zoho Books CSV
            </a>
            <a
              href={`${API_BASE}/api/exports/ca-audit-pack.xlsx`}
              className="btn btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <FileSpreadsheet size={13} /> CA GST IMS Pack (.xlsx)
            </a>
          </div>
        </div>
        {invoices.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No supplier invoices audited yet. Click <strong>Audit Invoice vs. PO</strong> above or drop a bill in <strong>+ New Task</strong>.</div>
        ) : (
          <div className="stack">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${inv.totalMoneyLeakPaise > 0 ? 'var(--danger)' : 'var(--border)'}`,
                  background: inv.totalMoneyLeakPaise > 0 ? 'color-mix(in srgb, var(--danger-soft) 35%, var(--bg-surface))' : 'var(--bg-app)',
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <div className="row">
                    <strong className="mono">{inv.invoiceNumber}</strong>
                    <span>{inv.supplier?.name || 'Supplier'}</span>
                    <span className={`pill ${inv.imsSuggestedAction === 'REJECT' ? 'pill-critical' : inv.imsSuggestedAction === 'KEEP_PENDING' ? 'pill-warning' : 'pill-success'}`}>
                      GST IMS: {inv.imsSuggestedAction}
                    </span>
                    <span className="pill">PO: {inv.poMatchStatus.toUpperCase()}</span>
                  </div>
                  <strong className="mono">{formatINR(inv.grandTotalPaise)}</strong>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{inv.cfoVerdict}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }} className="mono">
                  Invoice Date: {inv.invoiceDate}
                  {inv.msme43bhDueAt ? ` · MSME 43B(h) Max Pay Date: ${inv.msme43bhDueAt}` : ''}
                  {inv.rule37CliffAt ? ` · Rule 37 (180d ITC Reversal Cliff): ${inv.rule37CliffAt}` : ''}
                  {(inv.totalCreditedPaise ?? 0) > 0
                    ? ` · Credited: −${formatINR(inv.totalCreditedPaise ?? 0)} · Net Payable: ${formatINR(inv.netPayablePaise ?? inv.grandTotalPaise)}`
                    : ''}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {inv.totalMoneyLeakPaise > 0 && (
                    <button
                      type="button"
                      className="btn btn-whatsapp btn-sm"
                      onClick={() =>
                        onOpenOutreach({
                          scenario: 'invoice_dispute',
                          supplierName: inv.supplier?.name || 'Supplier',
                          supplierPhone: inv.supplier?.phone,
                          supplierEmail: inv.supplier?.email,
                          invoiceNumber: inv.invoiceNumber,
                          disputeAmountPaise: inv.totalMoneyLeakPaise,
                          disputeReasons: (inv.flagsJson || []).filter((f) => f.severity !== 'info').map((f) => f.title),
                        })
                      }
                    >
                      <ShieldAlert size={13} /> Dispute {formatINR(inv.totalMoneyLeakPaise)} on WhatsApp
                    </button>
                  )}
                  {!isCaReadOnly && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setCnError(null);
                        setCnInvoice(inv);
                        setCnNumber(`CN-${inv.invoiceNumber}`);
                        setCnTaxable(String(Math.round((inv.totalMoneyLeakPaise || 0) / 100)));
                        setCnReason('Overcharge / GST variance settlement');
                      }}
                    >
                      Record Credit / Debit Note
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recurring Maintenance & AMC Schedules */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Machinery AMC, Spares & Recurring Maintenance ({amcs.length})</h2>
            <p className="card-subtitle">Never miss generator servicing, calibration renewals, or routine consumable reorders.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setShowAmcModal(true)}>
            <Plus size={13} /> Add Asset / AMC
          </button>
        </div>
        {amcs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No AMC schedules tracked yet.</div>
        ) : (
          <div className="grid-2">
            {amcs.map((a) => (
              <div key={a.id} className="card" style={{ background: 'var(--bg-app)', padding: 12 }}>
                <div style={{ fontWeight: 600 }}>{a.assetName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                  Vendor: {a.supplier?.name || 'Unassigned'} · Every {a.frequencyDays} days
                </div>
                <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                  <span className="pill pill-warning">Next Due: {a.nextDueAt}</span>
                  {a.lastRatePaise && <span className="mono" style={{ fontSize: 12 }}>Last: {formatINR(a.lastRatePaise)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Structured Invoice vs PO Audit Modal */}
      <ModalDialog
        open={showAuditModal}
        onClose={() => setShowAuditModal(false)}
        title="60-Second PO vs. Supplier Invoice Audit"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setShowAuditModal(false)}>Cancel</button>
            <button type="submit" form="audit-inv-form" className="btn btn-primary" disabled={!invSupplierId}>
              Run Deterministic GST & Leak Audit
            </button>
          </>
        }
      >
        <form id="audit-inv-form" onSubmit={handleAuditInvoice}>
          {suppliers.length === 0 && (
            <div className="card" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', marginBottom: 12 }}>
              Add a supplier in <strong>My Suppliers</strong> first to link an invoice audit.
            </div>
          )}
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="aud-sup">Supplier</label>
              <select id="aud-sup" required value={invSupplierId} onChange={(e) => setInvSupplierId(e.target.value)}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.gstRegime})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="aud-po">Compare Against Issued PO (Optional)</label>
              <select id="aud-po" value={invPoId} onChange={(e) => setInvPoId(e.target.value)}>
                <option value="">— Standalone Audit (Check GST, Math & Price Creep) —</option>
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>{p.poNumber} ({p.supplier?.name})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="aud-no">Invoice No.</label>
              <input id="aud-no" required placeholder="INV/26-27/0412" value={invNo} onChange={(e) => setInvNo(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="aud-date">Invoice Date</label>
              <input id="aud-date" type="date" required value={invDate} onChange={(e) => setInvDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aud-irn">E-Invoice IRN (64-char)</label>
              <input id="aud-irn" className="mono" placeholder="Leave blank if missing" value={invIrn} onChange={(e) => setInvIrn(e.target.value)} />
            </div>
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="aud-desc">Item Description</label>
              <input id="aud-desc" required value={invDesc} onChange={(e) => setInvDesc(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aud-hsn">HSN/SAC</label>
              <input id="aud-hsn" className="mono" value={invHsn} onChange={(e) => setInvHsn(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aud-qty">Billed Qty</label>
              <input id="aud-qty" type="number" required value={invQty} onChange={(e) => setInvQty(e.target.value)} />
            </div>
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="aud-rate">Billed Unit Rate (₹)</label>
              <input id="aud-rate" type="number" step="0.01" required value={invRate} onChange={(e) => setInvRate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aud-gst">Item GST %</label>
              <input id="aud-gst" type="number" required value={invGst} onChange={(e) => setInvGst(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aud-fr">Freight Billed (₹) & GST %</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="aud-fr" type="number" value={invFreight} onChange={(e) => setInvFreight(e.target.value)} placeholder="₹" />
                <input type="number" aria-label="Freight GST %" value={invFreightGst} onChange={(e) => setInvFreightGst(e.target.value)} style={{ width: 70 }} />
              </div>
            </div>
          </div>

          <label className="row" style={{ fontSize: 12.5, marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={invDoubleFreight} onChange={(e) => setInvDoubleFreight(e.target.checked)} />
            Freight amount already included transporter tax (check for Double-GST leak)
          </label>

          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label>Stated CGST / SGST / IGST (₹)</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="number" step="0.01" aria-label="CGST" placeholder="CGST" value={invCgst} onChange={(e) => setInvCgst(e.target.value)} />
                <input type="number" step="0.01" aria-label="SGST" placeholder="SGST" value={invSgst} onChange={(e) => setInvSgst(e.target.value)} />
                <input type="number" step="0.01" aria-label="IGST" placeholder="IGST" value={invIgst} onChange={(e) => setInvIgst(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="aud-grand">Stated Grand Total on Bill (₹)</label>
              <input id="aud-grand" type="number" step="0.01" required value={invGrand} onChange={(e) => setInvGrand(e.target.value)} />
            </div>
          </div>
        </form>
      </ModalDialog>

      {/* Add AMC Schedule Modal */}
      <ModalDialog
        open={showAmcModal}
        onClose={() => setShowAmcModal(false)}
        title="Add Recurring Machinery AMC / Spares Schedule"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setShowAmcModal(false)}>Cancel</button>
            <button type="submit" form="amc-form" className="btn btn-primary">Save Schedule</button>
          </>
        }
      >
        <form id="amc-form" onSubmit={handleCreateAmc}>
          <div className="field">
            <label htmlFor="amc-asset">Machine / Asset / Recurring Supply</label>
            <input id="amc-asset" required placeholder="e.g. 125 kVA Kirloskar DG Generator Quarterly Service" value={amcAsset} onChange={(e) => setAmcAsset(e.target.value)} autoFocus />
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="amc-sup">AMC / Spares Vendor</label>
              <select id="amc-sup" value={amcSupId} onChange={(e) => setAmcSupId(e.target.value)}>
                <option value="">Unassigned</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="amc-due">Next Due Date</label>
              <input id="amc-due" type="date" required value={amcDue} onChange={(e) => setAmcDue(e.target.value)} />
            </div>
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="amc-freq">Frequency (Days)</label>
              <input id="amc-freq" type="number" value={amcFreq} onChange={(e) => setAmcFreq(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="amc-rate">Last Contract / Service Rate (₹)</label>
              <input id="amc-rate" type="number" value={amcRate} onChange={(e) => setAmcRate(e.target.value)} />
            </div>
          </div>
        </form>
      </ModalDialog>

      {/* Credit Note / Debit Note Modal */}
      <ModalDialog
        open={Boolean(cnInvoice)}
        onClose={() => setCnInvoice(null)}
        title={`Record Credit / Debit Note — ${cnInvoice?.invoiceNumber || ''}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCnInvoice(null)}>Cancel</button>
            <button type="submit" form="credit-note-form" className="btn btn-primary">Save Voucher &amp; Settle Leak</button>
          </>
        }
      >
        <form id="credit-note-form" onSubmit={handleRecordCreditNote}>
          {cnError && (
            <div className="alert-banner alert-danger" role="alert">{cnError}</div>
          )}
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="cn-type">Voucher Type</label>
              <select id="cn-type" value={cnType} onChange={(e) => setCnType(e.target.value as 'credit_note' | 'debit_note')}>
                <option value="credit_note">Supplier Credit Note (Sec 34)</option>
                <option value="debit_note">Buyer Debit Note</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cn-num">Voucher Number *</label>
              <input id="cn-num" required value={cnNumber} onChange={(e) => setCnNumber(e.target.value)} />
            </div>
          </div>
          <div className="grid-4" style={{ gap: 8, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div className="field">
              <label htmlFor="cn-tax">Taxable (₹) *</label>
              <input id="cn-tax" type="number" step="0.01" required value={cnTaxable} onChange={(e) => setCnTaxable(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cn-cgst">CGST (₹)</label>
              <input id="cn-cgst" type="number" step="0.01" value={cnCgst} onChange={(e) => setCnCgst(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cn-sgst">SGST (₹)</label>
              <input id="cn-sgst" type="number" step="0.01" value={cnSgst} onChange={(e) => setCnSgst(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cn-igst">IGST (₹)</label>
              <input id="cn-igst" type="number" step="0.01" value={cnIgst} onChange={(e) => setCnIgst(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="cn-why">Reason *</label>
            <input id="cn-why" required value={cnReason} onChange={(e) => setCnReason(e.target.value)} />
          </div>
        </form>
      </ModalDialog>

      <Gstr2bReconcilerModal open={showGstr2bModal} onClose={() => setShowGstr2bModal(false)} />
    </div>
  );
}
