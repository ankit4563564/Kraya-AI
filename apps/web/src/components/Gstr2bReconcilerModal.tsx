import React, { useState } from 'react';
import {
  FileCheck2,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageCircle,
  Download,
  XCircle,
} from 'lucide-react';
import { apiJson, formatINR } from '../lib/api';
import { ModalDialog } from './ModalDialog';

export interface ReconciliationItem {
  key: string;
  status: 'MATCHED' | 'VALUE_MISMATCH' | 'MISSING_IN_2B' | 'MISSING_IN_BOOKS';
  imsAction: 'ACCEPT' | 'KEEP_PENDING' | 'REJECT' | 'NOT_APPLICABLE';
  supplierGstin: string;
  supplierName: string;
  supplierPhone?: string | null;
  invoiceNumber: string;
  bookInvoiceId: string | null;
  bookTaxablePaise: number;
  bookTaxPaise: number;
  portalTaxablePaise: number;
  portalTaxPaise: number;
  taxDiffPaise: number;
  itcEligiblePaise: number;
  itcAtRiskPaise: number;
  reason: string;
  whatsappChaseUrl?: string;
  whatsappChaseMessage?: string;
}

export interface Gstr2bReconciliationSummary {
  totalBookInvoices: number;
  totalPortalEntries: number;
  matchedCount: number;
  mismatchCount: number;
  missingIn2bCount: number;
  missingInBooksCount: number;
  totalBookItcPaise: number;
  totalPortalItcPaise: number;
  safeClaimableItcPaise: number;
  itcAtRiskPaise: number;
  items: ReconciliationItem[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Gstr2bReconcilerModal({ open, onClose }: Props) {
  const [payloadText, setPayloadText] = useState('');
  const [toleranceRupees, setToleranceRupees] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Gstr2bReconciliationSummary | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setPayloadText(text);
      setError(null);
    } catch {
      setError('Could not read selected file.');
    }
  };

  const runReconciliation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!payloadText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const tolerancePaise = Math.max(0, Math.round(Number(toleranceRupees || '1') * 100));
      const data = await apiJson<Gstr2bReconciliationSummary>('/api/gst/gstr2b-reconcile', {
        method: 'POST',
        body: JSON.stringify({
          payload: payloadText.trim(),
          tolerancePaise,
          format: 'json',
        }),
      });
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GSTR-2B reconciliation failed.');
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = async () => {
    if (!payloadText.trim()) return;
    try {
      const tolerancePaise = Math.max(0, Math.round(Number(toleranceRupees || '1') * 100));
      const res = await fetch('/api/gst/gstr2b-reconcile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: payloadText.trim(),
          tolerancePaise,
          format: 'csv',
        }),
      });
      if (!res.ok) throw new Error('CSV export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kraya-ims-actions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export CSV.');
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="GSTR-2B / GSTN IMS Live Reconciler"
      footer={
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            100% deterministic integer-paise matching · Sec 16(2)(aa) &amp; 16(2)(b) ITC guardrails
          </span>
          <div className="row" style={{ gap: 8 }}>
            {summary && (
              <button type="button" className="btn btn-sm" onClick={downloadCsv}>
                <Download size={13} /> Export IMS CSV
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <form onSubmit={runReconciliation} className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600 }}>
              Upload GSTN GSTR-2B JSON / CSV (or paste below)
            </label>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <label className="btn btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                <Upload size={13} /> Choose JSON/CSV
                <input
                  type="file"
                  accept=".json,.csv,.txt"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </label>
              <div className="row" style={{ gap: 4, alignItems: 'center', fontSize: 12 }}>
                <span>Tolerance (₹):</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={toleranceRupees}
                  onChange={(e) => setToleranceRupees(e.target.value)}
                  style={{ width: 64, padding: '4px 6px' }}
                />
              </div>
            </div>
          </div>

          <textarea
            rows={5}
            className="mono"
            style={{ fontSize: 11.5, width: '100%' }}
            placeholder={'Paste GSTN GSTR-2B JSON ({"data":{"docdata":{"b2b":[...]}}}) or CSV:\ngstin,supplierName,invoiceNumber,taxableValue,cgst,sgst,igst'}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
          />

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="submit"
              disabled={loading || !payloadText.trim()}
              className="btn btn-primary btn-sm"
            >
              <FileCheck2 size={14} /> {loading ? 'Reconciling...' : 'Run Deterministic GSTR-2B Reconciliation'}
            </button>
          </div>
        </form>

        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: 10, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {summary && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid-3" style={{ gap: 8 }}>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Safe Claimable ITC</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--success)' }}>
                  {formatINR(summary.safeClaimableItcPaise)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {summary.matchedCount} matched / {summary.totalBookInvoices} book bills
                </div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ITC At Risk / Blocked</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: summary.itcAtRiskPaise > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {formatINR(summary.itcAtRiskPaise)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {summary.missingIn2bCount} missing in 2B · {summary.mismatchCount} mismatched
                </div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unbooked Portal Bills</div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>
                  {summary.missingInBooksCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Total 2B ITC: {formatINR(summary.totalPortalItcPaise)}
                </div>
              </div>
            </div>

            {summary.items.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                No invoices found in Kraya books or the uploaded GSTR-2B file.
              </div>
            ) : (
              <div className="stack" style={{ gap: 8, maxHeight: 340, overflowY: 'auto' }}>
                {summary.items.map((item) => (
                  <div
                    key={item.key}
                    className="card"
                    style={{
                      padding: 10,
                      borderColor:
                        item.status === 'MATCHED' && item.imsAction === 'ACCEPT'
                          ? 'var(--success)'
                          : item.imsAction === 'REJECT' || item.status === 'MISSING_IN_2B'
                            ? 'var(--danger)'
                            : 'var(--warning)',
                    }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        {item.imsAction === 'ACCEPT' && <CheckCircle2 size={14} color="var(--success)" />}
                        {item.imsAction === 'REJECT' && <XCircle size={14} color="var(--danger)" />}
                        {item.imsAction === 'KEEP_PENDING' && <Clock size={14} color="var(--warning)" />}
                        {item.status === 'MISSING_IN_2B' && <AlertTriangle size={14} color="var(--danger)" />}
                        <strong style={{ fontSize: 13 }}>{item.supplierName}</strong>
                        <span className="mono" style={{ fontSize: 11.5 }}>#{item.invoiceNumber}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.supplierGstin}</span>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <span className={`pill ${item.imsAction === 'ACCEPT' ? 'pill-success' : item.imsAction === 'REJECT' || item.status === 'MISSING_IN_2B' ? 'pill-danger' : 'pill-warning'}`}>
                          IMS: {item.imsAction}
                        </span>
                        <span className="pill">{item.status}</span>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 14, fontSize: 11.5, marginTop: 6, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                      <span>Book GST: <strong>{formatINR(item.bookTaxPaise)}</strong></span>
                      <span>GSTR-2B GST: <strong>{formatINR(item.portalTaxPaise)}</strong></span>
                      {item.taxDiffPaise !== 0 && (
                        <span style={{ color: 'var(--danger)' }}>
                          Variance: <strong>{formatINR(item.taxDiffPaise)}</strong>
                        </span>
                      )}
                    </div>

                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                      {item.reason}
                    </p>

                    {item.whatsappChaseUrl && (
                      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                        <a
                          href={item.whatsappChaseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-whatsapp btn-sm"
                        >
                          <MessageCircle size={12} /> Chase Vendor for GSTR-1 on WhatsApp
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
