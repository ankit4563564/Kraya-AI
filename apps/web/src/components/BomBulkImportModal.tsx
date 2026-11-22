import React, { useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiJson } from '../lib/api';
import { ModalDialog } from './ModalDialog';

interface BulkImportResponse {
  createdCount: number;
  createdRfqs: Array<{ id: string; rfqNumber: string; title: string; qty: number; unit: string }>;
  skippedRows: Array<{ rowNumber: number; reason: string }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  initialCsvText?: string;
}

export function BomBulkImportModal({ open, onClose, onImported, initialCsvText = '' }: Props) {
  const [csvText, setCsvText] = useState(initialCsvText);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResponse | null>(null);

  useEffect(() => {
    if (open && initialCsvText) {
      setCsvText(initialCsvText);
      setError(null);
      setResult(null);
    }
  }, [open, initialCsvText]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCsvText(await file.text());
      setError(null);
      setResult(null);
    } catch {
      setError('Could not read file.');
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const data = await apiJson<BulkImportResponse>('/api/rfqs/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ csvText: csvText.trim() }),
      });
      setResult(data);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BOM import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Bulk Import Factory BOM / Purchase Indent (Zero Data Entry)"
      footer={
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Paste directly from Excel/Google Sheets or upload a CSV · Missing rates stay blank (never invented)
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <form onSubmit={handleImport} className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: 12.5, fontWeight: 600 }}>
              BOM / Indent Table (CSV or Tab-Separated from Excel)
            </label>
            <label className="btn btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
              <Upload size={13} /> Upload CSV
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display: 'none' }} />
            </label>
          </div>

          <textarea
            rows={6}
            className="mono"
            style={{ fontSize: 11.5, width: '100%' }}
            placeholder={
              'item,qty,unit,category,hsn,targetRate,creditDays,dueDate\n5-Ply Corrugated Master Carton 180 GSM,5000,pcs,Packaging,4819,26.50,30,2026-12-05\nSS304 Hex Bolt M8x50,10000,nos,Fasteners,7318,4.20,45,2026-12-10'
            }
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={importing || !csvText.trim()}
              className="btn btn-primary btn-sm"
            >
              <FileSpreadsheet size={14} /> {importing ? 'Creating RFQs...' : 'Batch Create RFQs'}
            </button>
          </div>
        </form>

        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: 10, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {result && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="card" style={{ borderColor: 'var(--success)', padding: 10, fontSize: 12.5 }}>
              <div className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600, color: 'var(--success)' }}>
                <CheckCircle2 size={15} /> Created {result.createdCount} RFQs automatically!
              </div>
              <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                {result.createdRfqs.map((r) => (
                  <div key={r.id} style={{ fontSize: 12 }}>
                    <span className="mono">{r.rfqNumber}</span> — {r.title}
                  </div>
                ))}
              </div>
            </div>
            {result.skippedRows.length > 0 && (
              <div className="card" style={{ borderColor: 'var(--warning)', padding: 10, fontSize: 12 }}>
                <div className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--warning)' }}>
                  <AlertTriangle size={14} /> Skipped {result.skippedRows.length} invalid row(s)
                </div>
                {result.skippedRows.map((s) => (
                  <div key={s.rowNumber}>
                    Row {s.rowNumber}: {s.reason}
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
