import React, { useEffect, useState } from 'react';
import {
  Plus,
  FileSpreadsheet,
  FileCheck2,
  Download,
  RefreshCw,
  Award,
  MessageCircle,
  AlertTriangle,
  ShieldCheck,
  Compass,
  Sparkles,
} from 'lucide-react';
import { API_BASE, apiJson, ComplianceFlag, formatINR, SupplierRecord, UserRole } from '../lib/api';
import { NavTab } from '../lib/workflow';
import { ModalDialog } from '../components/ModalDialog';
import { OutreachModalRequest } from '../components/OutreachModal';
import { SupplierDiscoveryModal } from '../components/SupplierDiscoveryModal';
import { NegotiationModal, RfqNegotiationData } from '../components/NegotiationModal';
import { BomBulkImportModal } from '../components/BomBulkImportModal';
import { NextStepBanner } from '../components/WorkflowJourneyRail';

interface LandedRow {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  quantity: number;
  canonicalUnit: string;
  normalizationNote: string;
  baseUnitPaise: number;
  freightUnitPaise: number;
  nonRecoverableGstUnitPaise: number;
  netLandedUnitPaise: number;
  effectiveCreditDaysUsed: number;
  waccPctUsed: number;
  creditBenefitUnitPaise: number;
  creditAdjustedRealUnitPaise: number;
  totalInvoicePayablePaise: number;
  totalCreditAdjustedPaise: number;
  priceDeltaPct: number | null;
  isPriceCreepAlert: boolean;
  leadTimeDays: number | null;
  reliabilityScore: number | null;
  flags: ComplianceFlag[];
}

interface RfqRecord {
  id: string;
  rfqNumber: string;
  title: string;
  type: string;
  deliveryDueAt: string | null;
  status: string;
  quotesCount: number;
  comparison: {
    ranked: LandedRow[];
    winner: LandedRow | null;
    savingsVsWorstPaise: number;
    savingsVsSecondBestPaise: number;
    cfoSummary: string;
  };
}

interface PoRecord {
  id: string;
  poNumber: string;
  poDate: string;
  deliveryDueAt: string;
  paymentTermsDays: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  invoiceStatus: string;
  pdfFileId?: string | null;
  revisionNumber?: number;
  cancelReason?: string | null;
  orderedQty?: number;
  cumulativeAcceptedQty?: number;
  itemsJson?: Array<{ itemKey: string; description: string; qty: number; unit: string; unitRatePaise: number; gstPct: number }>;
  supplier: SupplierRecord | null;
}

interface Props {
  userRole: UserRole;
  onDataMutated: () => void;
  onOpenOutreach: (req: OutreachModalRequest) => void;
  onNavigate?: (tab: NavTab) => void;
  refreshTick?: number;
}

export function BuyingRfqsView({ userRole, onDataMutated, onOpenOutreach, onNavigate, refreshTick = 0 }: Props) {
  const isCaReadOnly = userRole === 'ca';
  const isOwner = userRole === 'owner';
  const [rfqs, setRfqs] = useState<RfqRecord[]>([]);
  const [pos, setPos] = useState<PoRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  // Modals
  const [showNewRfq, setShowNewRfq] = useState(false);
  const [showBomImport, setShowBomImport] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [quoteModalRfq, setQuoteModalRfq] = useState<RfqRecord | null>(null);
  const [negotiationData, setNegotiationData] = useState<RfqNegotiationData | null>(null);
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [negotiatingRfqId, setNegotiatingRfqId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ rfq: RfqRecord; row: LandedRow } | null>(null);
  const [approverName, setApproverName] = useState('Owner');
  const [approving, setApproving] = useState(false);

  // PO Lifecycle Modals (GRN / Amend / Cancel)
  const [grnPo, setGrnPo] = useState<PoRecord | null>(null);
  const [grnChallan, setGrnChallan] = useState('');
  const [grnReceivedQty, setGrnReceivedQty] = useState('');
  const [grnAcceptedQty, setGrnAcceptedQty] = useState('');
  const [grnRejectedQty, setGrnRejectedQty] = useState('0');
  const [grnAcceptedDate, setGrnAcceptedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [grnNotes, setGrnNotes] = useState('');

  const [amendPo, setAmendPo] = useState<PoRecord | null>(null);
  const [amendQty, setAmendQty] = useState('');
  const [amendRate, setAmendRate] = useState('');
  const [amendDelivery, setAmendDelivery] = useState('');
  const [amendReason, setAmendReason] = useState('');

  const [cancelPo, setCancelPo] = useState<PoRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  // New RFQ form
  const [rfqTitle, setRfqTitle] = useState('');
  const [rfqItem, setRfqItem] = useState('');
  const [rfqHsn, setRfqHsn] = useState('4819');
  const [rfqQty, setRfqQty] = useState('5000');
  const [rfqUnit, setRfqUnit] = useState('pc');

  // Add Quote form
  const [qSupplierId, setQSupplierId] = useState('');
  const [qRate, setQRate] = useState('');
  const [qUnit, setQUnit] = useState('pc');
  const [qQty, setQQty] = useState('5000');
  const [qGst, setQGst] = useState('5');
  const [qInclusive, setQInclusive] = useState(false);
  const [qFreight, setQFreight] = useState('0');
  const [qCreditDays, setQCreditDays] = useState('30');
  const [qLeadDays, setQLeadDays] = useState('5');
  const [qChannel, setQChannel] = useState('whatsapp');

  const loadAll = () => {
    Promise.all([
      apiJson<RfqRecord[]>('/api/rfqs'),
      apiJson<PoRecord[]>('/api/pos'),
      apiJson<SupplierRecord[]>('/api/suppliers'),
    ])
      .then(([r, p, s]) => {
        setRfqs(r);
        setPos(p);
        setSuppliers(s);
        if (s.length > 0 && !qSupplierId) setQSupplierId(s[0].id);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAll();
  }, [refreshTick]);

  const handleCreateRfq = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiJson('/api/rfqs', {
      method: 'POST',
      body: JSON.stringify({
        title: rfqTitle || `${rfqQty} ${rfqItem}`,
        itemDescription: rfqItem,
        hsnSac: rfqHsn,
        qty: Number(rfqQty) || 1000,
        unit: rfqUnit,
      }),
    });
    setShowNewRfq(false);
    setRfqTitle('');
    setRfqItem('');
    loadAll();
    onDataMutated();
  };

  const handleAddQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteModalRfq || !qSupplierId) return;
    await apiJson('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({
        rfqId: quoteModalRfq.id,
        supplierId: qSupplierId,
        quantity: Number(qQty) || 1000,
        rawRateRupees: Number(qRate),
        rawUnit: qUnit,
        gstPct: Number(qGst),
        isGstInclusive: qInclusive,
        freightRupees: Number(qFreight) || 0,
        creditDays: Number(qCreditDays) || 0,
        leadTimeDays: Number(qLeadDays) || null,
        channel: qChannel,
      }),
    });
    setQuoteModalRfq(null);
    setQRate('');
    setQFreight('0');
    loadAll();
    onDataMutated();
  };

  const handleOpenNegotiation = async (rfq: RfqRecord) => {
    setNegotiatingRfqId(rfq.id);
    try {
      const data = await apiJson<RfqNegotiationData>(`/api/rfqs/${rfq.id}/negotiation-strategy`, {
        method: 'POST',
      });
      setNegotiationData(data);
      setShowNegotiation(true);
    } catch (err) {
      alert(`Could not generate negotiation playbook: ${err instanceof Error ? err.message : 'Server error'}`);
    } finally {
      setNegotiatingRfqId(null);
    }
  };

  const handleConfirmApprovePo = async () => {
    if (!approveTarget) return;
    setApproving(true);
    try {
      const res = await apiJson<{ po: PoRecord }>('/api/pos/approve', {
        method: 'POST',
        body: JSON.stringify({
          quoteId: approveTarget.row.quoteId,
          approvedBy: approverName,
          explicitApprovalConfirmed: true,
        }),
      });
      setApproveTarget(null);
      loadAll();
      onDataMutated();
      const sup = suppliers.find((s) => s.id === approveTarget.row.supplierId);
      onOpenOutreach({
        scenario: 'po_issued',
        supplierName: approveTarget.row.supplierName,
        supplierPhone: sup?.phone,
        supplierEmail: sup?.email,
        poNumber: res.po.poNumber,
        itemDescription: approveTarget.rfq.title,
        quantity: approveTarget.row.quantity,
        unit: approveTarget.row.canonicalUnit,
        creditDays: approveTarget.row.effectiveCreditDaysUsed,
        dueDate: res.po.deliveryDueAt,
      });
    } finally {
      setApproving(false);
    }
  };

  const handleRepeatOrder = async (rfqId: string) => {
    await apiJson(`/api/rfqs/${rfqId}/repeat`, { method: 'POST' });
    loadAll();
    onDataMutated();
  };

  const handleRecordGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grnPo) return;
    setLifecycleError(null);
    try {
      const first = grnPo.itemsJson?.[0];
      await apiJson('/api/grns', {
        method: 'POST',
        body: JSON.stringify({
          poId: grnPo.id,
          challanNumber: grnChallan || undefined,
          receivedDate: grnAcceptedDate,
          acceptedDate: grnAcceptedDate,
          notes: grnNotes || undefined,
          items: [
            {
              itemKey: first?.itemKey || 'item',
              description: first?.description || grnPo.poNumber,
              receivedQty: Number(grnReceivedQty),
              acceptedQty: Number(grnAcceptedQty),
              rejectedQty: Number(grnRejectedQty) || 0,
            },
          ],
        }),
      });
      setGrnPo(null);
      setGrnChallan('');
      setGrnNotes('');
      loadAll();
      onDataMutated();
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : 'Failed to record GRN');
    }
  };

  const handleAmendPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amendPo) return;
    setLifecycleError(null);
    try {
      await apiJson(`/api/pos/${amendPo.id}/amend`, {
        method: 'POST',
        body: JSON.stringify({
          qty: Number(amendQty) || undefined,
          unitRateRupees: Number(amendRate) || undefined,
          deliveryDueAt: amendDelivery || undefined,
          reason: amendReason,
        }),
      });
      setAmendPo(null);
      setAmendReason('');
      loadAll();
      onDataMutated();
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : 'Failed to amend PO');
    }
  };

  const handleCancelPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelPo) return;
    setLifecycleError(null);
    try {
      await apiJson(`/api/pos/${cancelPo.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      });
      setCancelPo(null);
      setCancelReason('');
      loadAll();
      onDataMutated();
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : 'Failed to cancel PO');
    }
  };

  return (
    <div className="stack">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21 }}>Buying, RFQs & Credit-Adjusted Landed Cost</h1>
          <p className="card-subtitle">
            Compare multi-channel supplier quotes normalized for GST 2.0 ITC, freight, WACC working capital, and MSME 43B(h) 45-day caps.
          </p>
        </div>
        {!isCaReadOnly && (
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDiscoverQuery('');
                setShowDiscover(true);
              }}
            >
              <Compass size={15} /> Live AI Sourcing
            </button>
            <button type="button" className="btn" onClick={() => setShowBomImport(true)}>
              <FileSpreadsheet size={15} /> Bulk Import BOM
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowNewRfq(true)}>
              <Plus size={15} /> New RFQ
            </button>
          </div>
        )}
      </div>

      {/* Active RFQs & Side-by-Side Comparison Tables */}
      {rfqs.length === 0 ? (
        <div className="empty-state">
          <h3>No active RFQs yet</h3>
          <p>Discover real-time verified vendors, or create an RFQ to compare landed costs across suppliers.</p>
          <div className="row" style={{ marginTop: 12, gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDiscoverQuery('');
                setShowDiscover(true);
              }}
            >
              <Compass size={14} /> Live AI Sourcing
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowNewRfq(true)}>
              <Plus size={14} /> Create First RFQ
            </button>
          </div>
        </div>
      ) : (
        rfqs.map((rfq) => (
          <div key={rfq.id} className="card stack">
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="pill pill-accent mono">{rfq.rfqNumber}</span>
                  <span className="pill">{rfq.status.toUpperCase()}</span>
                  {rfq.deliveryDueAt && <span className="pill">Due: {rfq.deliveryDueAt}</span>}
                </div>
                <h2 className="card-title">{rfq.title}</h2>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => {
                    setDiscoverQuery(rfq.title);
                    setShowDiscover(true);
                  }}
                >
                  <Compass size={13} /> Source Vendors
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setQuoteModalRfq(rfq);
                  }}
                >
                  <Plus size={13} /> Add Quote
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleRepeatOrder(rfq.id)}
                >
                  <RefreshCw size={13} /> 1-Click Reorder
                </button>
                {rfq.quotesCount >= 2 && (
                  <button
                    type="button"
                    disabled={negotiatingRfqId === rfq.id}
                    className="btn btn-sm btn-primary"
                    onClick={() => handleOpenNegotiation(rfq)}
                  >
                    <Sparkles size={13} /> {negotiatingRfqId === rfq.id ? 'Analyzing...' : 'Negotiate with AI'}
                  </button>
                )}
                {rfq.quotesCount > 0 && (
                  <a
                    href={`${API_BASE}/api/rfqs/${rfq.id}/export.xlsx`}
                    className="btn btn-sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileSpreadsheet size={13} /> Live-Formula .xlsx
                  </a>
                )}
              </div>
            </div>

            {/* Inline 4-Step RFQ Progress Tracker */}
            <div className="mini-flow-strip" aria-label={`Workflow progress for ${rfq.rfqNumber}`}>
              <span className="mini-flow-node is-done">1. RFQ Created</span>
              <span className="mini-flow-sep" aria-hidden="true">→</span>
              <span className={`mini-flow-node ${rfq.quotesCount > 0 ? 'is-done' : 'is-current'}`}>
                2. Quotes Logged ({rfq.quotesCount})
              </span>
              <span className="mini-flow-sep" aria-hidden="true">→</span>
              <span className={`mini-flow-node ${rfq.status === 'awarded' || rfq.status === 'closed' ? 'is-done' : rfq.quotesCount >= 2 ? 'is-current' : ''}`}>
                3. AI Negotiate
              </span>
              <span className="mini-flow-sep" aria-hidden="true">→</span>
              <span className={`mini-flow-node ${rfq.status === 'awarded' || rfq.status === 'closed' ? 'is-done' : rfq.quotesCount >= 1 ? 'is-current' : ''}`}>
                4. Approve &amp; PO
              </span>
              <span className="mini-flow-hint">
                {rfq.quotesCount === 0
                  ? 'Next: Source vendors or log 1st quote'
                  : rfq.quotesCount === 1
                    ? 'Next: Add a 2nd quote to unlock AI BATNA negotiation, or Approve & PO'
                    : rfq.status === 'awarded' || rfq.status === 'closed'
                      ? 'PO issued — track GRN & Invoice below'
                      : 'Next: Click "Negotiate with AI" or "Approve & PO" on your winner'}
              </span>
            </div>

            {rfq.comparison.ranked.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                No quotes logged yet. Paste a vendor WhatsApp reply in the prompt bar above or click <strong>+ Add Quote</strong>.
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  <Award size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  {rfq.comparison.cfoSummary}
                </div>

                {/* Responsive Table per modern-web-guidance `responsive-table` */}
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={`tbl-cap-${rfq.id}`}
                  className="table-wrapper"
                >
                  <table className="data-table">
                    <caption id={`tbl-cap-${rfq.id}`}>
                      Ranked Supplier Quotes — Sorted by Credit-Adjusted Real Unit Cost
                    </caption>
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Base + Freight</th>
                        <th>Net Landed</th>
                        <th>Credit (43B-h)</th>
                        <th>Real Effective Cost</th>
                        <th>Order Total</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rfq.comparison.ranked.map((row, idx) => (
                        <tr key={row.quoteId} className={idx === 0 ? 'winner-row' : ''}>
                          <th>
                            <div>
                              #{idx + 1} {row.supplierName}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                              {row.normalizationNote}
                            </div>
                            {row.flags.length > 0 && (
                              <div className="row" style={{ marginTop: 4 }}>
                                {row.flags.map((f, fi) => (
                                  <span
                                    key={fi}
                                    className={`pill ${f.severity === 'critical' ? 'pill-critical' : 'pill-warning'}`}
                                    style={{ fontSize: 10.5 }}
                                  >
                                    <AlertTriangle size={11} /> {f.title}
                                  </span>
                                ))}
                              </div>
                            )}
                          </th>
                          <td data-label="Base + Freight" className="mono">
                            {formatINR(row.baseUnitPaise)} + {formatINR(row.freightUnitPaise)}
                          </td>
                          <td data-label="Net Landed" className="mono">
                            {formatINR(row.netLandedUnitPaise)}/{row.canonicalUnit}
                          </td>
                          <td data-label="Credit (43B-h)" className="mono">
                            {row.effectiveCreditDaysUsed}d (−{formatINR(row.creditBenefitUnitPaise)})
                          </td>
                          <td data-label="Real Effective Cost" className="mono" style={{ fontWeight: 700, color: idx === 0 ? 'var(--accent)' : 'inherit' }}>
                            {formatINR(row.creditAdjustedRealUnitPaise)}/{row.canonicalUnit}
                          </td>
                          <td data-label="Order Total" className="mono">
                            {formatINR(row.totalInvoicePayablePaise, 0)}
                          </td>
                          <td data-label="Action">
                            <div className="row">
                              {isOwner && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => setApproveTarget({ rfq, row })}
                                >
                                  <FileCheck2 size={13} /> Approve &amp; PO
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => {
                                  const sup = suppliers.find((s) => s.id === row.supplierId);
                                  onOpenOutreach({
                                    scenario: 'counter_offer',
                                    supplierName: row.supplierName,
                                    supplierPhone: sup?.phone,
                                    supplierEmail: sup?.email,
                                    itemDescription: rfq.title,
                                    quotedRatePaise: row.netLandedUnitPaise,
                                    targetRatePaise: rfq.comparison.winner?.netLandedUnitPaise,
                                    creditDays: row.effectiveCreditDaysUsed,
                                  });
                                }}
                              >
                                <MessageCircle size={13} /> Counter
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ))
      )}

      {/* Issued GST Purchase Orders */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Issued GST Purchase Orders ({pos.length})</h2>
            <p className="card-subtitle">Every PO prints written Net Credit Days (protecting your 45-day Section 43B(h) window) and auto-creates a delivery chase task.</p>
          </div>
        </div>
        {pos.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No Purchase Orders issued yet.</div>
        ) : (
          <div className="stack">
            {pos.map((po) => (
              <div
                key={po.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-app)',
                }}
              >
                <div>
                  <div className="row" style={{ marginBottom: 3 }}>
                    <strong className="mono">{po.poNumber}</strong>
                    {(po.revisionNumber ?? 1) > 1 && (
                      <span className="pill pill-warning mono">Rev {po.revisionNumber}</span>
                    )}
                    <span>{po.supplier?.name || 'Supplier'}</span>
                    <span
                      className={`pill ${
                        po.invoiceStatus === 'mismatch' || po.invoiceStatus === 'cancelled'
                          ? 'pill-critical'
                          : po.invoiceStatus === 'matched'
                            ? 'pill-success'
                            : ''
                      }`}
                    >
                      {po.invoiceStatus === 'cancelled' ? 'CANCELLED' : `Invoice: ${po.invoiceStatus.toUpperCase()}`}
                    </span>
                    {(po.orderedQty ?? 0) > 0 && (
                      <span className="pill mono">
                        GRN: {po.cumulativeAcceptedQty ?? 0}/{po.orderedQty}
                      </span>
                    )}
                    {po.pdfFileId && <span className="pill pill-accent">PDF Archived</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }} className="mono">
                    Total: {formatINR(po.totalPaise)} (Taxable {formatINR(po.taxablePaise)}
                    {po.igstPaise > 0
                      ? ` + IGST ${formatINR(po.igstPaise)}`
                      : ` + CGST ${formatINR(po.cgstPaise)} + SGST ${formatINR(po.sgstPaise)}`}
                    ) · Net {po.paymentTermsDays}d · Delivery Due: {po.deliveryDueAt}
                    {po.cancelReason ? ` · Cancelled: ${po.cancelReason}` : ''}
                  </div>
                  {po.invoiceStatus !== 'cancelled' && (
                    <div className="mini-flow-strip" style={{ marginTop: 6, padding: '4px 8px' }}>
                      <span className="mini-flow-node is-done">1. PO Issued</span>
                      <span className="mini-flow-sep" aria-hidden="true">→</span>
                      <span className={`mini-flow-node ${(po.cumulativeAcceptedQty ?? 0) > 0 ? 'is-done' : 'is-current'}`}>
                        2. GRN {(po.cumulativeAcceptedQty ?? 0) > 0 ? 'Recorded' : 'Pending'}
                      </span>
                      <span className="mini-flow-sep" aria-hidden="true">→</span>
                      <span className={`mini-flow-node ${po.invoiceStatus === 'matched' ? 'is-done' : (po.cumulativeAcceptedQty ?? 0) > 0 ? 'is-current' : ''}`}>
                        3. Invoice {po.invoiceStatus === 'matched' ? 'Audited' : 'Audit'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="row">
                  {!isCaReadOnly && po.invoiceStatus !== 'cancelled' && (
                    <button
                      type="button"
                      className={`btn btn-sm ${(po.cumulativeAcceptedQty ?? 0) === 0 ? 'btn-primary' : ''}`}
                      onClick={() => {
                        setLifecycleError(null);
                        setGrnPo(po);
                        const rem = Math.max(0, (po.orderedQty ?? 0) - (po.cumulativeAcceptedQty ?? 0));
                        setGrnReceivedQty(String(rem || po.orderedQty || 1));
                        setGrnAcceptedQty(String(rem || po.orderedQty || 1));
                        setGrnRejectedQty('0');
                      }}
                    >
                      Record GRN
                    </button>
                  )}
                  {onNavigate && po.invoiceStatus !== 'cancelled' && po.invoiceStatus !== 'matched' && (po.cumulativeAcceptedQty ?? 0) > 0 && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onNavigate('daily')}
                    >
                      Audit Bill →
                    </button>
                  )}
                  {isOwner && po.invoiceStatus !== 'cancelled' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setLifecycleError(null);
                          setAmendPo(po);
                          const first = po.itemsJson?.[0];
                          setAmendQty(String(first?.qty ?? po.orderedQty ?? 1));
                          setAmendRate(String(first ? first.unitRatePaise / 100 : 0));
                          setAmendDelivery(po.deliveryDueAt);
                        }}
                      >
                        Amend PO
                      </button>
                      {po.invoiceStatus !== 'matched' && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            setLifecycleError(null);
                            setCancelPo(po);
                          }}
                        >
                          Cancel PO
                        </button>
                      )}
                    </>
                  )}
                  <a
                    href={`${API_BASE}/api/pos/${po.id}/pdf`}
                    className="btn btn-primary btn-sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={13} /> Download GST PO PDF
                  </a>
                  <button
                    type="button"
                    className="btn btn-whatsapp btn-sm"
                    onClick={() =>
                      onOpenOutreach({
                        scenario: 'po_issued',
                        supplierName: po.supplier?.name || 'Vendor',
                        supplierPhone: po.supplier?.phone,
                        supplierEmail: po.supplier?.email,
                        poNumber: po.poNumber,
                        creditDays: po.paymentTermsDays,
                        dueDate: po.deliveryDueAt,
                      })
                    }
                  >
                    <MessageCircle size={13} /> Share PO
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {onNavigate && (
        <NextStepBanner
          stepLabel="Step 4 & 5 · After PO Approval"
          title="Next: Track Deliveries, Audit Supplier Invoices & Reconcile GSTR-2B"
          description="Once goods arrive and you record GRN, audit the vendor bill against your PO to stop GST/freight leaks and export clean Tally/Zoho vouchers."
          primaryActionLabel="Go to Maintenance, Daily & Audit"
          onPrimaryAction={() => onNavigate('daily')}
          secondaryActionLabel="View Supplier Directory"
          onSecondaryAction={() => onNavigate('suppliers')}
        />
      )}

      {/* Create RFQ Modal */}
      <ModalDialog
        open={showNewRfq}
        onClose={() => setShowNewRfq(false)}
        title="Create New Procurement RFQ"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setShowNewRfq(false)}>Cancel</button>
            <button type="submit" form="new-rfq-form" className="btn btn-primary">Create RFQ</button>
          </>
        }
      >
        <form id="new-rfq-form" onSubmit={handleCreateRfq}>
          <div className="field">
            <label htmlFor="rfq-item">Item Description</label>
            <input id="rfq-item" required placeholder="e.g. 5-Ply Corrugated Boxes 12x10x8" value={rfqItem} onChange={(e) => setRfqItem(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="rfq-title">RFQ Title (Optional)</label>
            <input id="rfq-title" placeholder="e.g. Nov Packaging Batch — 5,000 Boxes" value={rfqTitle} onChange={(e) => setRfqTitle(e.target.value)} />
          </div>
          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="rfq-qty">Quantity</label>
              <input id="rfq-qty" type="number" required value={rfqQty} onChange={(e) => setRfqQty(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rfq-unit">Unit</label>
              <input id="rfq-unit" required value={rfqUnit} onChange={(e) => setRfqUnit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rfq-hsn">HSN / SAC</label>
              <input id="rfq-hsn" className="mono" value={rfqHsn} onChange={(e) => setRfqHsn(e.target.value)} />
            </div>
          </div>
        </form>
      </ModalDialog>

      {/* Add Quote Modal */}
      <ModalDialog
        open={Boolean(quoteModalRfq)}
        onClose={() => setQuoteModalRfq(null)}
        title={`Log Supplier Quote — ${quoteModalRfq?.rfqNumber || ''}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setQuoteModalRfq(null)}>Cancel</button>
            <button type="submit" form="add-quote-form" className="btn btn-primary" disabled={!qSupplierId}>
              Compute Landed Cost & Save
            </button>
          </>
        }
      >
        <form id="add-quote-form" onSubmit={handleAddQuote}>
          {suppliers.length === 0 ? (
            <div className="card" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', marginBottom: 12 }}>
              Add at least one supplier in <strong>My Suppliers</strong> first (or paste a quote with vendor name in <strong>+ New Task</strong>).
            </div>
          ) : (
            <div className="field">
              <label htmlFor="q-sup">Supplier</label>
              <select id="q-sup" required value={qSupplierId} onChange={(e) => setQSupplierId(e.target.value)}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.gstRegime} · Udyam: {s.udyamTier})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="q-rate">Quoted Rate (₹)</label>
              <input id="q-rate" type="number" step="0.01" required value={qRate} onChange={(e) => setQRate(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="q-unit">Quoted Unit</label>
              <span className="hint">e.g. pc, carton of 50, MT</span>
              <input id="q-unit" required value={qUnit} onChange={(e) => setQUnit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="q-qty">Order Qty</label>
              <input id="q-qty" type="number" required value={qQty} onChange={(e) => setQQty(e.target.value)} />
            </div>
          </div>

          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="q-gst">GST %</label>
              <select id="q-gst" value={qGst} onChange={(e) => setQGst(e.target.value)}>
                <option value="0">0% (Exempt / Comp)</option>
                <option value="5">5% (GST 2.0)</option>
                <option value="18">18% (GST 2.0)</option>
                <option value="12">12% (Legacy Check)</option>
                <option value="40">40% (Special)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-freight">Total Freight (₹)</label>
              <input id="q-freight" type="number" step="1" value={qFreight} onChange={(e) => setQFreight(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="q-credit">Credit Days</label>
              <input id="q-credit" type="number" value={qCreditDays} onChange={(e) => setQCreditDays(e.target.value)} />
            </div>
          </div>

          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="q-lead">Lead Time (Days)</label>
              <input id="q-lead" type="number" value={qLeadDays} onChange={(e) => setQLeadDays(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="q-chan">Source Channel</label>
              <select id="q-chan" value={qChannel} onChange={(e) => setQChannel(e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email PDF</option>
                <option value="phone">Phone Call</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>

          <label className="row" style={{ fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={qInclusive} onChange={(e) => setQInclusive(e.target.checked)} />
            Rate is GST-inclusive ("flat / net rate")
          </label>
        </form>
      </ModalDialog>

      {/* Code-Enforced PO Approval Gate Modal */}
      <ModalDialog
        open={Boolean(approveTarget)}
        onClose={() => setApproveTarget(null)}
        title="Confirm Human Approval — Issue GST Purchase Order"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setApproveTarget(null)} autoFocus>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={approving}
              onClick={handleConfirmApprovePo}
            >
              <ShieldCheck size={14} />
              {approving ? 'Issuing PO PDF...' : 'Approve & Generate GST PO'}
            </button>
          </>
        }
      >
        {approveTarget && (
          <div className="stack">
            <div className="pill pill-accent">
              <ShieldCheck size={13} /> Accio Invariant 3: Explicit Human Sign-Off Required Before Commitment
            </div>
            <div className="card" style={{ background: 'var(--bg-app)' }}>
              <div>Supplier: <strong>{approveTarget.row.supplierName}</strong></div>
              <div>RFQ: <strong>{approveTarget.rfq.rfqNumber} — {approveTarget.rfq.title}</strong></div>
              <div className="mono" style={{ marginTop: 6 }}>
                Quantity: {approveTarget.row.quantity} {approveTarget.row.canonicalUnit} · Written Terms: <strong>Net {approveTarget.row.effectiveCreditDaysUsed} Days</strong>
              </div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 6, color: 'var(--accent)' }}>
                Total Payable (incl. GST): {formatINR(approveTarget.row.totalInvoicePayablePaise)}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="approver-name">Approving Authority Name</label>
              <input id="approver-name" value={approverName} onChange={(e) => setApproverName(e.target.value)} />
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Record GRN (Goods Received Note) Modal */}
      <ModalDialog
        open={Boolean(grnPo)}
        onClose={() => setGrnPo(null)}
        title={`Record GRN (Goods Received Note) — ${grnPo?.poNumber || ''}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setGrnPo(null)}>Cancel</button>
            <button type="submit" form="grn-form" className="btn btn-primary">Save GRN Receipt</button>
          </>
        }
      >
        <form id="grn-form" onSubmit={handleRecordGrn}>
          {lifecycleError && (
            <div className="alert-banner alert-danger" role="alert">{lifecycleError}</div>
          )}
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="grn-challan">Delivery Challan / LR Number</label>
              <input id="grn-challan" placeholder="DC-2026-088" value={grnChallan} onChange={(e) => setGrnChallan(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="grn-date">Physical Acceptance Date (MSME 43B-h Clock) *</label>
              <input id="grn-date" type="date" required value={grnAcceptedDate} onChange={(e) => setGrnAcceptedDate(e.target.value)} />
            </div>
          </div>
          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="grn-rec">Received Qty *</label>
              <input id="grn-rec" type="number" step="0.01" required value={grnReceivedQty} onChange={(e) => setGrnReceivedQty(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="grn-acc">QC Accepted Qty *</label>
              <input id="grn-acc" type="number" step="0.01" required value={grnAcceptedQty} onChange={(e) => setGrnAcceptedQty(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="grn-rej">QC Rejected Qty</label>
              <input id="grn-rej" type="number" step="0.01" value={grnRejectedQty} onChange={(e) => setGrnRejectedQty(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="grn-notes">QC / Damage Notes</label>
            <input id="grn-notes" placeholder="e.g. 50 wet cartons rejected on gate inspection" value={grnNotes} onChange={(e) => setGrnNotes(e.target.value)} />
          </div>
        </form>
      </ModalDialog>

      {/* Amend PO Modal */}
      <ModalDialog
        open={Boolean(amendPo)}
        onClose={() => setAmendPo(null)}
        title={`Issue PO Amendment — ${amendPo?.poNumber || ''} (Rev ${(amendPo?.revisionNumber ?? 1) + 1})`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setAmendPo(null)}>Cancel</button>
            <button type="submit" form="amend-po-form" className="btn btn-primary">Issue Amended PO &amp; PDF</button>
          </>
        }
      >
        <form id="amend-po-form" onSubmit={handleAmendPo}>
          {lifecycleError && (
            <div className="alert-banner alert-danger" role="alert">{lifecycleError}</div>
          )}
          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="am-qty">Revised Quantity *</label>
              <input id="am-qty" type="number" step="0.01" required value={amendQty} onChange={(e) => setAmendQty(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="am-rate">Revised Unit Rate (₹) *</label>
              <input id="am-rate" type="number" step="0.01" required value={amendRate} onChange={(e) => setAmendRate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="am-due">Delivery Due Date</label>
              <input id="am-due" type="date" value={amendDelivery} onChange={(e) => setAmendDelivery(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="am-reason">Amendment Reason (Logged to Audit Trail) *</label>
            <input id="am-reason" required placeholder="e.g. Revised order qty after festival demand spike" value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
          </div>
        </form>
      </ModalDialog>

      {/* Cancel PO Modal */}
      <ModalDialog
        open={Boolean(cancelPo)}
        onClose={() => setCancelPo(null)}
        title={`Cancel Purchase Order — ${cancelPo?.poNumber || ''}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCancelPo(null)}>Keep PO Active</button>
            <button type="submit" form="cancel-po-form" className="btn btn-danger">Confirm PO Cancellation</button>
          </>
        }
      >
        <form id="cancel-po-form" onSubmit={handleCancelPo}>
          {lifecycleError && (
            <div className="alert-banner alert-danger" role="alert">{lifecycleError}</div>
          )}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
            Cancelling this PO permanently blocks future supplier invoices from matching against it and writes an immutable entry to the audit trail.
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="cn-reason">Cancellation Reason *</label>
            <input id="cn-reason" required placeholder="e.g. Supplier unable to meet 7-day dispatch deadline" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
        </form>
      </ModalDialog>

      <SupplierDiscoveryModal
        open={showDiscover}
        initialQuery={discoverQuery}
        onClose={() => setShowDiscover(false)}
        onSupplierAdded={() => {
          loadAll();
          onDataMutated();
        }}
        onOpenOutreach={onOpenOutreach}
      />

      <NegotiationModal
        open={showNegotiation}
        onClose={() => setShowNegotiation(false)}
        data={negotiationData}
        onOpenOutreach={onOpenOutreach}
      />

      <BomBulkImportModal
        open={showBomImport}
        onClose={() => setShowBomImport(false)}
        onImported={() => {
          loadAll();
          onDataMutated();
        }}
      />
    </div>
  );
}
