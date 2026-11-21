import React, { useState, useEffect } from 'react';
import {
  Search,
  Sparkles,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
  Mail,
  Plus,
  ShieldCheck,
  TrendingDown,
  Building2,
  DollarSign,
} from 'lucide-react';
import { apiJson, formatINR, SupplierRecord } from '../lib/api';
import { ModalDialog } from './ModalDialog';
import { OutreachModalRequest } from './OutreachModal';

export interface DiscoveredSupplierItem {
  id: string;
  businessName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
  gstinValid: boolean;
  stateCode: string;
  panEntityLabel: string;
  tds194cRatePct: number;
  taxRouting: 'intra_state' | 'inter_state';
  materialsOffered: string[];
  estimatedRatePerUnit: number;
  creditBenefitPerUnit: number;
  creditAdjustedRate: number;
  moq: number;
  typicalCreditDays: number;
  itcEligible: boolean;
  udyamTier: 'micro' | 'small' | 'medium' | 'trader' | 'unregistered';
  section43BhCapDays: 15 | 45 | null;
  distanceKmEstimate: number;
  matchScore: number;
  matchReason: string;
  criteriaFit: Record<string, { pass: boolean; note: string }>;
  whatsAppBridgeUrl: string;
  emailBridgeUrl: string;
}

export interface DiscoveryResponse {
  engine: 'gemini_flash_grounded' | 'deterministic_fallback';
  query: string;
  suppliers: DiscoveredSupplierItem[];
  marketAnalysis: {
    prevailingMarketRate: number;
    leadTimeDays: number;
    hsnSacSuggested: string;
    gstRatePct: number;
    sourcingAdvice: string;
    riskFactors: string[];
  };
  currencyBenchmark?: {
    usdInrRate: number;
    importedParityNote: string;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  onSupplierAdded?: () => void;
  onOpenOutreach?: (req: OutreachModalRequest) => void;
}

export function SupplierDiscoveryModal({
  open,
  onClose,
  initialQuery = '',
  onSupplierAdded,
  onOpenOutreach,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState('Packaging');
  const [buyerCity, setBuyerCity] = useState('Bengaluru');
  const [buyerPincode, setBuyerPincode] = useState('560058');
  const [targetRateMax, setTargetRateMax] = useState('');
  const [minCreditDays, setMinCreditDays] = useState('30');
  const [specificCriteria, setSpecificCriteria] = useState('');

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initialQuery && initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setError(null);
    try {
      const data = await apiJson<DiscoveryResponse>('/api/suppliers/discover', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          category: category.trim() || undefined,
          buyerCity: buyerCity.trim() || 'Bengaluru',
          buyerPincode: buyerPincode.trim() || '560058',
          targetRateMaxRupees: targetRateMax ? Number(targetRateMax) : undefined,
          minCreditDays: minCreditDays ? Number(minCreditDays) : 30,
          specificCriteria: specificCriteria.trim() || undefined,
        }),
      });
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery query failed');
    } finally {
      setSearching(false);
    }
  };

  const handleAddSupplier = async (sup: DiscoveredSupplierItem) => {
    setAddingId(sup.id);
    try {
      await apiJson('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: sup.businessName,
          phone: sup.phone || undefined,
          email: sup.email || undefined,
          category: category || 'General',
          gstin: sup.gstinValid ? sup.gstin : undefined,
          stateCode: sup.stateCode || '29',
          gstRegime: 'regular',
          udyamTier: sup.udyamTier,
          eInvoiceRequired: false,
          creditDays: sup.typicalCreditDays || 30,
          notes: `${sup.matchReason} (Found via Live Sourcing Engine)`,
        }),
      });
      setAddedIds((prev) => new Set(prev).add(sup.id));
      if (onSupplierAdded) onSupplierAdded();
    } catch (err) {
      alert(`Could not add supplier: ${err instanceof Error ? err.message : 'Server error'}`);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Live Supplier Discovery & Real-Time Sourcing Engine"
      footer={
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Grounded by Gemini 3.5 Flash Lite · Mod-36 GSTIN Checked · 43B(h) MSME Calibrated
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {/* Search & Criteria Formulation */}
        <form onSubmit={handleSearch} className="stack" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="disc-query">
              Procurement Requirement / Item Specs &quot;If&apos;s and But&apos;s&quot;
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="disc-query"
                required
                placeholder="e.g. 5-ply corrugated master cartons 180 GSM, or SS304 hex bolts M8x50"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="btn btn-primary"
                style={{ minWidth: 140 }}
              >
                {searching ? (
                  <span className="row" style={{ gap: 6 }}>
                    <Sparkles size={14} className="spin" /> Sourcing...
                  </span>
                ) : (
                  <span className="row" style={{ gap: 6 }}>
                    <Search size={14} /> Find Suppliers
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="grid-3" style={{ gap: 8 }}>
            <div className="field">
              <label htmlFor="disc-cat">Category</label>
              <select
                id="disc-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="Packaging">Corrugated &amp; Packaging</option>
                <option value="Metals">Metals &amp; Sheet Fabrication</option>
                <option value="Fasteners">Fasteners &amp; Hardware</option>
                <option value="Polymers">Polymers &amp; Moulding</option>
                <option value="Electricals">Electricals &amp; Automation</option>
                <option value="Chemicals">Industrial Chemicals</option>
                <option value="Logistics">Logistics &amp; Transport</option>
                <option value="Maintenance">Maintenance &amp; Spares</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="disc-pin">Delivery Location &amp; PIN</label>
              <input
                id="disc-pin"
                placeholder="Bengaluru (560058)"
                value={buyerPincode}
                onChange={(e) => setBuyerPincode(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="disc-credit">Min Credit Required</label>
              <select
                id="disc-credit"
                value={minCreditDays}
                onChange={(e) => setMinCreditDays(e.target.value)}
              >
                <option value="15">Net 15 Days</option>
                <option value="30">Net 30 Days (Standard)</option>
                <option value="45">Net 45 Days (MSME Max)</option>
                <option value="60">Net 60 Days</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="disc-crit">
              Detailed Criteria, Conditions &amp; Constraints (If&apos;s and But&apos;s)
            </label>
            <input
              id="disc-crit"
              placeholder="e.g. Reject suppliers with &lt;30d credit; must be located within 30km of Peenya; must have active GSTIN for 100% ITC; max ₹26/box"
              value={specificCriteria}
              onChange={(e) => setSpecificCriteria(e.target.value)}
            />
          </div>
        </form>

        {error && (
          <div
            className="card"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              padding: 10,
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        {/* Market Benchmark Box */}
        {results?.marketAnalysis && (
          <div
            className="card"
            style={{
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-soft)',
              padding: 12,
              borderRadius: 8,
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div
                className="row"
                style={{ gap: 6, fontWeight: 600, fontSize: 13, color: 'var(--primary)' }}
              >
                <Sparkles size={14} /> Market Intelligence Benchmark
              </div>
              <div className="row" style={{ gap: 8, fontSize: 11.5 }}>
                <span className="pill">HSN {results.marketAnalysis.hsnSacSuggested}</span>
                <span className="pill">GST {results.marketAnalysis.gstRatePct}%</span>
                {results.currencyBenchmark && (
                  <span className="pill pill-accent">
                    USD/INR ₹{results.currencyBenchmark.usdInrRate.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {results.marketAnalysis.sourcingAdvice}
            </p>
          </div>
        )}

        {/* Supplier Cards List */}
        {results?.suppliers && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                Matched Suppliers ({results.suppliers.length})
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Sorted by Landed Cost &amp; Criteria Fit
              </span>
            </div>

            {results.suppliers.map((sup) => {
              const isAdded = addedIds.has(sup.id);
              return (
                <div
                  key={sup.id}
                  className="card"
                  style={{
                    padding: 14,
                    border: '1px solid var(--border-soft)',
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{sup.businessName}</span>
                        <span className="pill pill-success">
                          <ShieldCheck size={11} /> {sup.matchScore}% Match
                        </span>
                        {sup.taxRouting === 'intra_state' ? (
                          <span className="pill">CGST+SGST (Local)</span>
                        ) : (
                          <span className="pill pill-accent">IGST (Inter-State)</span>
                        )}
                        <span
                          className={`pill ${
                            sup.udyamTier === 'micro' || sup.udyamTier === 'small' ? 'pill-warning' : ''
                          }`}
                        >
                          Udyam: {sup.udyamTier.toUpperCase()}
                          {sup.section43BhCapDays ? ` (${sup.section43BhCapDays}d Cap)` : ''}
                        </span>
                      </div>
                      <div
                        className="row"
                        style={{
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          gap: 12,
                          marginTop: 3,
                          alignItems: 'center',
                        }}
                      >
                        <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                          <MapPin size={12} /> {sup.address} (~{sup.distanceKmEstimate} km)
                        </span>
                        {sup.contactPerson && <span>Contact: {sup.contactPerson}</span>}
                        {sup.phone && <span>Mobile: +91 {sup.phone}</span>}
                      </div>
                    </div>

                    {/* Financial Rates & Credit Working Capital Benefit */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)' }}>
                        ₹{sup.estimatedRatePerUnit.toFixed(2)}{' '}
                        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                          / unit
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--success)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <TrendingDown size={11} />
                        Real Landed: ₹{sup.creditAdjustedRate.toFixed(2)} (Net {sup.typicalCreditDays}d)
                      </div>
                    </div>
                  </div>

                  {/* GSTIN & Compliance Badges */}
                  <div
                    className="row"
                    style={{
                      fontSize: 11.5,
                      background: 'var(--surface-sunken)',
                      padding: '4px 8px',
                      borderRadius: 4,
                      justifyContent: 'space-between',
                    }}
                  >
                    <span className="mono">
                      GSTIN: {sup.gstin}{' '}
                      {sup.gstinValid ? (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Mod-36 Verified</span>
                      ) : (
                        <span style={{ color: 'var(--danger)' }}>⚠ Checksum Warning</span>
                      )}{' '}
                      · {sup.panEntityLabel} (194C TDS: {sup.tds194cRatePct}%)
                    </span>
                    <span>MOQ: {sup.moq.toLocaleString('en-IN')} units</span>
                  </div>

                  {/* Match Reason addressing user's if's & but's */}
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <strong>Criteria Fit:</strong> {sup.matchReason}
                  </p>

                  {/* Action Buttons: 1-Click Save, 1-Click WhatsApp, 1-Click Email */}
                  <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                    <a
                      href={sup.whatsAppBridgeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-whatsapp btn-sm"
                    >
                      <MessageCircle size={13} /> Send WhatsApp RFQ
                    </a>

                    {sup.emailBridgeUrl && (
                      <a href={sup.emailBridgeUrl} className="btn btn-sm">
                        <Mail size={13} /> Email RFQ
                      </a>
                    )}

                    <button
                      type="button"
                      disabled={isAdded || addingId === sup.id}
                      onClick={() => handleAddSupplier(sup)}
                      className={`btn btn-sm ${isAdded ? 'btn-success' : 'btn-primary'}`}
                    >
                      {isAdded ? (
                        <span className="row" style={{ gap: 4 }}>
                          <CheckCircle2 size={13} /> Saved in Book
                        </span>
                      ) : addingId === sup.id ? (
                        'Saving...'
                      ) : (
                        <span className="row" style={{ gap: 4 }}>
                          <Plus size={13} /> Add to My Suppliers
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
