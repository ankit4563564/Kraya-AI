import React, { useState } from 'react';
import {
  Sparkles,
  TrendingDown,
  ShieldCheck,
  MessageCircle,
  Mail,
  Copy,
  Check,
  Award,
  Zap,
} from 'lucide-react';
import { formatINR } from '../lib/api';
import { ModalDialog } from './ModalDialog';
import { OutreachModalRequest } from './OutreachModal';

export interface SupplierNegotiationTacticItem {
  supplierId: string;
  supplierName: string;
  currentRatePaise: number;
  currentLandedPaise: number;
  targetCounterRatePaise: number;
  potentialSavingsPaise: number;
  leveragePoints: string[];
  recommendedTactics: string[];
  riskAssessment: string;
  counterOfferMessages: {
    hinglish: string;
    english: string;
    hindi: string;
  };
  whatsAppBridgeUrl: string;
  emailBridgeUrl: string;
}

export interface RfqNegotiationData {
  rfqTitle: string;
  quantity: number;
  unit: string;
  quoteCount: number;
  spread: {
    lowestLandedPaise: number;
    highestLandedPaise: number;
    spreadPaise: number;
    spreadPct: number;
    maxOrderSavingsPaise: number;
  };
  batna: {
    supplierName: string;
    ratePaise: number;
    effectiveRatePaise: number;
    creditDays: number;
    keyAdvantage: string;
  };
  supplierTactics: SupplierNegotiationTacticItem[];
  strategicAdvice: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  data: RfqNegotiationData | null;
  onOpenOutreach?: (req: OutreachModalRequest) => void;
}

export function NegotiationModal({ open, onClose, data, onOpenOutreach }: Props) {
  const [activeLang, setActiveLang] = useState<'hinglish' | 'english' | 'hindi'>('hinglish');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!data) return null;

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="AI Multi-Quote Negotiation Playbook (BATNA Engine)"
      footer={
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            BATNA: Best Alternative To a Negotiated Agreement · Indian Factory Trade-Offs
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {/* Strategic Overview & BATNA Anchor Card */}
        <div
          className="card"
          style={{
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            padding: 14,
            borderRadius: 8,
          }}
        >
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="row" style={{ gap: 6, fontWeight: 600, fontSize: 13.5, color: 'var(--accent)' }}>
              <Award size={16} /> Best Alternative (BATNA Anchor): {data.batna.supplierName}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="pill pill-success" style={{ fontWeight: 600 }}>
                {data.spread.spreadPct}% Quote Spread
              </span>
              <span className="pill pill-accent">
                Potential Savings: {formatINR(data.spread.maxOrderSavingsPaise)}
              </span>
            </div>
          </div>
          <p style={{ margin: '0 0 6px 0', fontSize: 12.5, color: 'var(--text-primary)' }}>
            <strong>CFO Strategic Advice:</strong> {data.strategicAdvice}
          </p>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Anchor Rate: <strong>{formatINR(data.batna.effectiveRatePaise)}</strong>/{data.unit} ({data.batna.keyAdvantage})
          </div>
        </div>

        {/* Language Selector for Generated Counter-Offers */}
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            Supplier Counter-Offer Tactical Strategies ({data.supplierTactics.length})
          </span>
          <div className="row" style={{ gap: 4 }}>
            <button
              type="button"
              className={`btn btn-sm ${activeLang === 'hinglish' ? 'btn-primary' : ''}`}
              onClick={() => setActiveLang('hinglish')}
            >
              Hinglish (Recommended)
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeLang === 'english' ? 'btn-primary' : ''}`}
              onClick={() => setActiveLang('english')}
            >
              English
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeLang === 'hindi' ? 'btn-primary' : ''}`}
              onClick={() => setActiveLang('hindi')}
            >
              हिन्दी
            </button>
          </div>
        </div>

        {/* Supplier Tactic Cards */}
        <div className="stack" style={{ gap: 12 }}>
          {data.supplierTactics.map((tactic, idx) => {
            const messageText = tactic.counterOfferMessages[activeLang];
            const isWinner = idx === 0;

            return (
              <div
                key={tactic.supplierId}
                className="card"
                style={{
                  padding: 14,
                  border: isWinner ? '1.5px solid var(--primary)' : '1px solid var(--border-soft)',
                  borderRadius: 8,
                  background: isWinner ? 'var(--surface-sunken)' : 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Header: Supplier + Target Price + Savings */}
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        #{idx + 1} {tactic.supplierName}
                      </span>
                      {isWinner ? (
                        <span className="pill pill-primary">Top Pick (Target Volume Concession)</span>
                      ) : (
                        <span className="pill pill-warning">Higher Quote (Target Price Match)</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Current: {formatINR(tactic.currentRatePaise)}/{data.unit} · Real Landed: {formatINR(tactic.currentLandedPaise)}/{data.unit}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>
                      Target: {formatINR(tactic.targetCounterRatePaise)}
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}> /{data.unit}</span>
                    </div>
                    {tactic.potentialSavingsPaise > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                        <TrendingDown size={11} />
                        Save {formatINR(tactic.potentialSavingsPaise)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Leverage Points & Tactics */}
                <div className="grid-2" style={{ gap: 10, fontSize: 12 }}>
                  <div style={{ background: 'var(--bg-app)', padding: 8, borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      <Zap size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} /> Leverage Angle:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)' }}>
                      {tactic.leveragePoints.map((lp, i) => (
                        <li key={i}>{lp}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ background: 'var(--bg-app)', padding: 8, borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      <Sparkles size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} /> Actionable Play:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)' }}>
                      {tactic.recommendedTactics.map((rt, i) => (
                        <li key={i}>{rt}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Generated Message Preview */}
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-soft)',
                    borderRadius: 6,
                    padding: 10,
                    position: 'relative',
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: 'inherit',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.45,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {messageText}
                  </pre>
                  <button
                    type="button"
                    onClick={() => handleCopy(tactic.supplierId, messageText)}
                    className="btn btn-sm"
                    style={{ position: 'absolute', top: 6, right: 6, padding: '2px 6px', fontSize: 11 }}
                  >
                    {copiedId === tactic.supplierId ? (
                      <span className="row" style={{ gap: 3 }}>
                        <Check size={11} /> Copied
                      </span>
                    ) : (
                      <span className="row" style={{ gap: 3 }}>
                        <Copy size={11} /> Copy
                      </span>
                    )}
                  </button>
                </div>

                {/* Dispatch Buttons */}
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  <a
                    href={tactic.whatsAppBridgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-whatsapp btn-sm"
                  >
                    <MessageCircle size={13} /> Send via WhatsApp
                  </a>

                  {tactic.emailBridgeUrl && (
                    <a href={tactic.emailBridgeUrl} className="btn btn-sm">
                      <Mail size={13} /> Send Email
                    </a>
                  )}

                  {onOpenOutreach && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        onClose();
                        onOpenOutreach({
                          scenario: 'counter_offer',
                          supplierName: tactic.supplierName,
                          itemDescription: data.rfqTitle,
                          quantity: data.quantity,
                          unit: data.unit,
                          quotedRatePaise: tactic.currentRatePaise,
                          targetRatePaise: tactic.targetCounterRatePaise,
                        });
                      }}
                    >
                      Customize with Voice Note
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
}
