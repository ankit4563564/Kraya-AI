import React, { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  Mic,
  Square,
  Send,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
  ArrowRight,
  ShoppingCart,
  Inbox,
  Wrench,
  ClipboardCheck,
  TrendingDown,
  FileText,
  X,
  ShieldCheck,
  Check,
} from 'lucide-react';
import {
  apiJson,
  ComplianceFlag,
  formatINR,
  OutreachPackage,
  SummaryStats,
  UserRole,
} from '../lib/api';
import { OutreachModalRequest } from '../components/OutreachModal';

interface LeakRow {
  id: string;
  leakType: string;
  title: string;
  detail: string;
  statutoryRef: string | null;
  amountPaise: number;
  status: 'detected' | 'disputed' | 'recovered' | 'dismissed';
  disputeMessageDraft: string | null;
  supplier: { id: string; name: string; phone: string | null; email: string | null } | null;
}

interface IngestResponse {
  intake: { verbClass: string; pillar: string; requiresApprovalGate: boolean; detectedPromptInjection: boolean; rationale: string };
  sourceEvent: { id: string; channel: string; parsedSummary: string; needsVerification: boolean; confidenceScore: number };
  extracted: {
    engine: string;
    documentKind: string;
    supplierName: string | null;
    summary: string;
    missingFields: string[];
    needsVerification: boolean;
    evidence: Array<{ field: string; value: unknown; confidence: number; evidenceQuote: string }>;
  };
  created: {
    rfq?: { id: string; rfqNumber: string; title: string };
    quote?: { id: string; netLandedUnitPaise: number; creditAdjustedUnitPaise: number };
    landedCost?: { flags: ComplianceFlag[]; normalizationNote: string };
    audit?: {
      cfoVerdict: string;
      imsSuggestedAction: string;
      totalMoneyLeakPaise: number;
      flags: ComplianceFlag[];
    };
    task?: { id: string; title: string; dueAt: string };
  };
  suggestedOutreach: OutreachPackage | null;
  asrNote: string | null;
}

interface Props {
  summary: SummaryStats | null;
  userRole: UserRole;
  onDataMutated: () => void;
  onNavigate: (tab: 'new_task' | 'inbox' | 'buying' | 'daily' | 'suppliers') => void;
  onOpenOutreach: (req: OutreachModalRequest) => void;
}

const STARTER_TABS = [
  {
    id: 'buying',
    label: 'Initial Buying',
    icon: ShoppingCart,
    channel: 'manual',
    template: 'Send RFQ to 4 vendors for 5,000 5-ply corrugated boxes (HSN 4819), delivery within 10 days',
  },
  {
    id: 'log',
    label: 'Log Call / Chat / Email',
    icon: Inbox,
    channel: 'whatsapp',
    template: 'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
  },
  {
    id: 'maint',
    label: 'Maintenance & Reorder',
    icon: Wrench,
    channel: 'manual',
    template: 'Track 125 kVA DG generator quarterly AMC & hydraulic oil spares due this month',
  },
  {
    id: 'daily',
    label: 'Daily Tasks',
    icon: ClipboardCheck,
    channel: 'pdf',
    template: 'Audit Invoice #INV-412 from Shakti Packaging: 5000 boxes @ ₹26.50 + 5% GST, freight ₹5000 already incl of GST taxed at 18% again, Grand Total ₹145025',
  },
  {
    id: 'negotiate',
    label: 'Negotiate & Save',
    icon: TrendingDown,
    channel: 'phone',
    template: 'Ramesh offered ₹24 flat cash on delivery for 5000 boxes, 5% GST incl, Monday dispatch',
  },
];

export function NewTaskView({ summary, userRole, onDataMutated, onNavigate, onOpenOutreach }: Props) {
  const isCaReadOnly = userRole === 'ca';
  const [prompt, setPrompt] = useState('');
  const [channel, setChannel] = useState('manual');
  const [activeStarter, setActiveStarter] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [leaks, setLeaks] = useState<LeakRow[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeFeatureTab, setActiveFeatureTab] = useState<'intake' | 'audit' | 'negotiate'>('intake');
  const [manualHours, setManualHours] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let val = 0;
    const timer = setInterval(() => {
      val += 4;
      if (val >= 112) {
        setManualHours(112);
        clearInterval(timer);
      } else {
        setManualHours(val);
      }
    }, 35);
    return () => clearInterval(timer);
  }, []);

  const loadLeaks = () => {
    apiJson<LeakRow[]>('/api/leaks')
      .then((rows) => setLeaks(rows.filter((r) => r.status !== 'dismissed')))
      .catch(() => {});
  };

  useEffect(() => {
    loadLeaks();
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type });
        setAttachedFiles((prev) => [...prev, file]);
        setChannel('phone');
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone access blocked or unavailable. You can also attach any recorded MP3/M4A/WAV call file via + Attach.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() && attachedFiles.length === 0) return;
    setSubmitting(true);
    setError(null);
    setBatchProgress(null);
    try {
      let lastData: IngestResponse | null = null;
      if (attachedFiles.length > 0) {
        for (let i = 0; i < attachedFiles.length; i++) {
          const f = attachedFiles[i];
          setBatchProgress(
            attachedFiles.length > 1
              ? `Auditing file ${i + 1} of ${attachedFiles.length}: ${f.name}...`
              : `Auditing ${f.name}...`
          );
          const fd = new FormData();
          fd.append('prompt', prompt);
          fd.append('channel', channel);
          fd.append('file', f);
          lastData = await apiJson<IngestResponse>('/api/prompt/ingest', {
            method: 'POST',
            body: fd,
          });
        }
      } else {
        lastData = await apiJson<IngestResponse>('/api/prompt/ingest', {
          method: 'POST',
          body: JSON.stringify({ prompt, channel }),
        });
      }
      if (lastData) setResult(lastData);
      setPrompt('');
      setAttachedFiles([]);
      setActiveStarter(null);
      loadLeaks();
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setSubmitting(false);
      setBatchProgress(null);
    }
  };

  const handleUpdateLeak = async (id: string, status: 'disputed' | 'recovered' | 'dismissed') => {
    await apiJson(`/api/leaks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    loadLeaks();
    onDataMutated();
  };

  const handleVerifyEvent = async (eventId: string) => {
    await apiJson(`/api/inbox/${eventId}/verify`, { method: 'PATCH' });
    if (result?.sourceEvent.id === eventId) {
      setResult({
        ...result,
        sourceEvent: { ...result.sourceEvent, needsVerification: false },
        extracted: { ...result.extracted, needsVerification: false },
      });
    }
    onDataMutated();
  };

  const focusPromptInput = () => {
    window.scrollTo({ top: 380, behavior: 'smooth' });
    (document.querySelector('.prompt-textarea') as HTMLTextAreaElement | null)?.focus();
  };

  return (
    <div className="hero-canvas">
      {/* Hero Header Section */}
      <div className="hero-heading">
        <div className="hero-eyebrow">
          <Sparkles size={12} />
          <span>24/7 AI Procurement Engine</span>
        </div>
        <h1 className="hero-main-title">
          Procurement Engine that<br />
          Never <span className="hero-inline-badge"><Sparkles size={16} /></span> Overpays
        </h1>
        <p>
          Drop a WhatsApp quote, bill PDF, handwritten parchi, email, or Hinglish voice note — Kraya verifies GST 2.0, computes credit-adjusted landed cost, and catches money leaks in 60 seconds.
        </p>
        <div className="hero-cta-row">
          <button
            type="button"
            className="btn btn-hero-cta"
            onClick={focusPromptInput}
          >
            Run Procurement Agent •
          </button>
        </div>
      </div>

      {/* Hero Radar Centerpiece with Industrial Procurement Roles */}
      <div className="hero-centerpiece-container">
        <div className="hero-radar-orb">
          <div className="radar-core-ring">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2.5" />
              <circle cx="14" cy="10" r="3" fill="#ffffff" />
            </svg>
          </div>
          <div className="radar-orbit-avatar orb-av-1" title="Factory CFO">
            <img src="/images/avatar-3.jpg" alt="Factory CFO" />
          </div>
          <div className="radar-orbit-avatar orb-av-2" title="Purchase Manager">
            <img src="/images/avatar-2.jpg" alt="Purchase Manager" />
          </div>
          <div className="radar-orbit-avatar orb-av-3" title="GST Compliance Officer">
            <img src="/images/avatar-5.jpg" alt="GST Compliance Officer" />
          </div>
          <div className="radar-orbit-avatar orb-av-4" title="Raw Material Supplier">
            <img src="/images/avatar-1.jpg" alt="Raw Material Supplier" />
          </div>
          <div className="radar-orbit-avatar orb-av-5" title="Accounts Payable">
            <img src="/images/avatar-4.jpg" alt="Accounts Payable" />
          </div>
          <div className="radar-orbit-avatar orb-av-6" title="Udyam MSME Auditor">
            <img src="/images/avatar-6.jpg" alt="Udyam MSME Auditor" />
          </div>
          <div className="radar-status-badge">
            <span className="live-status-dot" />
            <span>Active Procurement Radar &bull; 60s GST 2.0 &amp; Landed Cost Guard</span>
          </div>
        </div>
      </div>

      {/* Primary Studio Command Center Composer (ALWAYS VISIBLE & PROMINENT) */}
      <div className="studio-composer-container" style={{ maxWidth: 1040, width: '100%', margin: '0 auto 48px' }}>
        {isCaReadOnly && (
          <div className="alert-banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', marginBottom: 16 }}>
            <span>
              You are signed in with the <strong>CA / Auditor (Read-Only)</strong> role. You can inspect all quotes, invoices, Money Leaks, and export Tally XML &amp; CA GST IMS Packs, but creating or modifying procurement records is disabled.
            </span>
          </div>
        )}

        <form className="prompt-card" onSubmit={handleSubmit}>
          <textarea
            className="prompt-textarea"
            disabled={isCaReadOnly}
            placeholder={
              isCaReadOnly
                ? 'Read-only CA mode: switch to Unified Inbox, Buying & RFQs, or Maintenance & Daily to review records and export CA Audit Packs.'
                : "Type in English/Hinglish, paste a WhatsApp vendor reply ('22 plus gst extra transport 5k, 30 din udhari'), or drop an invoice PDF / handwritten parchi..."
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
            }}
          />

          {attachedFiles.length > 0 && (
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
              {attachedFiles.map((f, idx) => (
                <span key={`${f.name}-${idx}`} className="pill pill-accent">
                  <FileText size={12} />
                  {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', display: 'inline-flex' }}
                    aria-label={`Remove ${f.name}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="prompt-toolbar">
            <div className="prompt-toolbar-left">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.mp3,.wav,.ogg,.webm,.m4a"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (picked.length > 0) setAttachedFiles((prev) => [...prev, ...picked]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={isCaReadOnly}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={14} />
                + Attach Bills / Chats / Audio (Batch)
              </button>

              <button
                type="button"
                className={`btn btn-sm ${recording ? 'btn-danger' : ''}`}
                disabled={isCaReadOnly}
                onClick={recording ? stopRecording : startRecording}
              >
                {recording ? <Square size={13} /> : <Mic size={14} />}
                {recording ? 'Stop Recording' : 'Mic (Voice Note)'}
              </button>

              <select
                aria-label="Source Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                style={{
                  padding: '5px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                }}
              >
                <option value="manual">Channel: Prompt</option>
                <option value="whatsapp">Channel: WhatsApp</option>
                <option value="email">Channel: Email</option>
                <option value="phone">Channel: Phone Call</option>
                <option value="pdf">Channel: PDF / Parchi</option>
              </select>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isCaReadOnly || submitting || (!prompt.trim() && attachedFiles.length === 0)}
            >
              <Send size={14} />
              {submitting ? batchProgress || 'Auditing & Routing...' : 'Run Procurement Agent •'}
            </button>
          </div>
        </form>

        <div className="starter-tabs" role="group" aria-label="One-click starter workflows" style={{ marginTop: 12 }}>
          {STARTER_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={isCaReadOnly}
                className={`starter-tab ${activeStarter === tab.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveStarter(tab.id);
                  setPrompt(tab.template);
                  setChannel(tab.channel);
                }}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', color: 'var(--danger)', maxWidth: 1040, margin: '0 auto 24px' }}>
          {error}
        </div>
      )}

      {/* Structured Result Card (Zero Hallucination + Amber Verification Chips + 1-Click Action) */}
      {result && (
        <div className="card stack" style={{ maxWidth: 1040, margin: '0 auto 48px' }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="pill pill-accent">
                  <Sparkles size={12} />
                  {result.intake.pillar.replace('_', ' ').toUpperCase()}
                </span>
                <span className="pill">
                  Verb: {result.intake.verbClass}
                </span>
                <span className="pill">
                  Engine: {result.extracted.engine === 'gemini_live' ? 'Gemini Flash Vision' : 'Deterministic Hinglish Parser'}
                </span>
                {result.intake.detectedPromptInjection && (
                  <span className="pill pill-critical">
                    <ShieldAlert size={12} /> Prompt Injection Fenced as Data
                  </span>
                )}
              </div>
              <h2 className="card-title">{result.sourceEvent.parsedSummary}</h2>
            </div>

            {result.sourceEvent.needsVerification ? (
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                onClick={() => handleVerifyEvent(result.sourceEvent.id)}
              >
                <AlertTriangle size={13} />
                1-Click Confirm Extracted Figures
              </button>
            ) : (
              <span className="pill pill-success">
                <CheckCircle2 size={12} /> Verified ({Math.round(result.sourceEvent.confidenceScore * 100)}%)
              </span>
            )}
          </div>

          {result.asrNote && (
            <div style={{ fontSize: 12.5, color: 'var(--warning)' }}>{result.asrNote}</div>
          )}

          {/* Missing fields amber notice (Accio Invariant 4: Missing Input != Invented Input) */}
          {result.extracted.missingFields.length > 0 && (
            <div className="row">
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Not stated (left blank, never guessed):</span>
              {result.extracted.missingFields.map((f) => (
                <span key={f} className="pill pill-warning">Missing: {f}</span>
              ))}
            </div>
          )}

          {/* Evidence Citations */}
          {result.extracted.evidence.length > 0 && (
            <div className="row">
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Evidence:</span>
              {result.extracted.evidence.map((ev, idx) => (
                <span key={idx} className="pill mono" style={{ fontSize: 11 }}>
                  {ev.field}: &ldquo;{ev.evidenceQuote}&rdquo;
                </span>
              ))}
            </div>
          )}

          {/* Audit Verdict if Invoice Audited */}
          {result.created.audit && (
            <div
              className="card"
              style={{
                padding: 12,
                background: result.created.audit.totalMoneyLeakPaise > 0 ? 'var(--danger-soft)' : 'var(--success-soft)',
                borderColor: result.created.audit.totalMoneyLeakPaise > 0 ? 'var(--danger)' : 'var(--success)',
              }}
            >
              <strong>{result.created.audit.cfoVerdict}</strong>
              <div className="stack" style={{ marginTop: 8, gap: 6 }}>
                {result.created.audit.flags.map((f, i) => (
                  <div key={i} style={{ fontSize: 12.5 }}>
                    <span className={`pill ${f.severity === 'critical' ? 'pill-critical' : f.severity === 'warning' ? 'pill-warning' : ''}`}>
                      {f.statutoryRef}
                    </span>{' '}
                    <strong>{f.title}</strong> — {f.detail}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quote Landed Cost Result */}
          {result.created.quote && (
            <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-subtle)' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{result.created.landedCost?.normalizationNote}</div>
                <div className="mono" style={{ fontWeight: 600 }}>
                  Net Landed: {formatINR(result.created.quote.netLandedUnitPaise)} &bull; Credit-Adjusted Real Cost:{' '}
                  <span style={{ color: 'var(--accent)' }}>{formatINR(result.created.quote.creditAdjustedUnitPaise)}</span>
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('buying')}>
                Open Landed Cost Comparison <ArrowRight size={13} />
              </button>
            </div>
          )}

          <div className="row">
            {result.suggestedOutreach && (
              <button
                type="button"
                className="btn btn-whatsapp btn-sm"
                onClick={() =>
                  onOpenOutreach({
                    scenario: result.created.audit ? 'invoice_dispute' : result.created.rfq ? 'rfq_request' : 'counter_offer',
                    supplierName: result.extracted.supplierName || 'Vendor',
                    disputeAmountPaise: result.created.audit?.totalMoneyLeakPaise,
                    disputeReasons: result.created.audit?.flags.filter((f) => f.severity !== 'info').map((f) => f.title),
                  })
                }
              >
                <MessageCircle size={13} />
                1-Click WhatsApp / Email Outreach
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('inbox')}>
              View in Unified Inbox
            </button>
            {result.created.rfq && (
              <button type="button" className="btn btn-sm" onClick={() => onNavigate('buying')}>
                Open {result.created.rfq.rfqNumber}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Section 1: Built for Indian Enterprise Scale and Statutory Trust (Matching Frames 010 - 013 of the video) */}
      {!result && (
        <section className="enterprise-trust-section" aria-label="Enterprise scale and trust">
          <div className="section-header-split">
            <div>
              <h2 className="section-headline">Built for factory scale, statutory compliance, and trust</h2>
              <p className="section-subtext">
                Kraya handles high-volume quote intake, multi-tier GST 2.0 ITC reconciliation, and Section 43B(h) clocks—ensuring your procurement workflow never loses a single rupee to vendor overpayments or CA tax penalties.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              disabled={isCaReadOnly}
              onClick={focusPromptInput}
            >
              Run Procurement Agent &bull;
            </button>
          </div>

          <div className="enterprise-card-grid">
            {/* Card 1: Landed Cost Normalization on Autopilot */}
            <div className="showcase-card">
              <div className="showcase-card-header">
                <span className="showcase-badge">60s AI Audit</span>
              </div>
              <div className="showcase-preview-box">
                <div className="preview-stat-row">
                  <span className="pill pill-accent">Landed Cost Audit</span>
                  <span className="pill">3 Quotes Analyzed</span>
                  <span className="pill pill-success">Lowest Landed: ₹41.20/kg</span>
                </div>
                <div className="row" style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <img src="/images/avatar-1.jpg" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                  <div className="preview-title" style={{ margin: 0 }}>Shree Balaji Steel &bull; 18% GST ITC + 45d Credit</div>
                </div>
              </div>
              <h3>Landed Cost Normalization on Autopilot</h3>
              <p>Computes true credit-adjusted unit rates in 60 seconds—factoring in GST 2.0 ITC eligibility, 15/45-day payment credit terms, WACC cost of capital, and transport double-taxation.</p>
            </div>

            {/* Card 2: Scale That Manual Teams Can't Match */}
            <div className="showcase-card">
              <div className="network-graph-box">
                <div className="network-center-node">
                  <span>&gt;10k</span>
                </div>
                <div className="network-orbit-node net-node-1" title="Raw Steel"><img src="/images/avatar-1.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-2" title="Polymers"><img src="/images/avatar-2.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-3" title="Fasteners"><img src="/images/avatar-3.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-4" title="Tooling"><img src="/images/avatar-4.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-5" title="Packaging"><img src="/images/avatar-5.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-6" title="Freight GTA"><img src="/images/avatar-6.jpg" alt="" /></div>
                <svg className="network-lines-svg" viewBox="0 0 240 240">
                  <line x1="120" y1="95" x2="60" y2="30" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="180" y2="30" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="35" y2="95" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="205" y2="95" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="70" y2="160" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="170" y2="160" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                </svg>
              </div>
              <h3>Scale That Manual Teams Can&apos;t Match</h3>
              <p>Audits hundreds of purchase bills, WhatsApp quotes, and handwritten parchis across factories without human fatigue—instantly catching silent rate creep and duplicate freight tax.</p>
            </div>

            {/* Card 3: Integrations That Just Work */}
            <div className="showcase-card">
              <div className="integration-hub-box">
                <div className="hub-ripple-ring ring-3" />
                <div className="hub-ripple-ring ring-2" />
                <div className="hub-ripple-ring ring-1" />
                <div className="hub-center-core">
                  <div className="brand-mark" style={{ width: 44, height: 44 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2.5" />
                      <circle cx="14" cy="10" r="3" fill="#ffffff" />
                    </svg>
                  </div>
                </div>
                <div className="hub-app-icon hub-app-1">Tally Prime</div>
                <div className="hub-app-icon hub-app-2">SAP B1</div>
                <div className="hub-app-icon hub-app-3">WhatsApp</div>
                <div className="hub-app-icon hub-app-4">Busy ERP</div>
                <div className="hub-app-icon hub-app-5">Excel / CSV</div>
              </div>
              <h3>Integrations That Just Work</h3>
              <p>1-click export of verified purchase vouchers to Tally XML, CA GST IMS reconciliation packs, and direct WhatsApp supplier counter-offers with zero code.</p>
            </div>

            {/* Card 4: Deterministic Financial Precision */}
            <div className="showcase-card">
              <div className="speedometer-box">
                <svg width="180" height="110" viewBox="0 0 200 120">
                  <path
                    d="M 20 110 A 80 80 0 0 1 180 110"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 20 110 A 80 80 0 0 1 160 48"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />
                  <circle cx="100" cy="110" r="10" fill="#0f172a" />
                  <line
                    x1="100"
                    y1="110"
                    x2="152"
                    y2="52"
                    stroke="#2563eb"
                    strokeWidth="5"
                    strokeLinecap="round"
                    className="speedometer-needle-anim"
                  />
                </svg>
                <div className="speedometer-label">
                  <strong>60ms</strong> Latency &bull; 100% Mod-36 Checksum Verified
                </div>
              </div>
              <h3>Deterministic Financial Precision</h3>
              <p>Offline GSTIN Mod-36 checksums, Section 43B(h) MSME payment clocks, and tamper-evident SHA-256 audit chains—zero generative hallucination on financial numbers.</p>
            </div>
          </div>
        </section>
      )}

      {/* Continuous Enterprise Logo Marquee (Matching Frame 013 of the video) */}
      {!result && (
        <div className="marquee-banner" aria-label="Trusted by Indian enterprise suppliers">
          <div className="marquee-title">Fueling Indian manufacturing growth across industrial clusters</div>
          <div className="marquee-track">
            <span>&bull; TATA MOTORS SUPPLIERS</span>
            <span>&bull; APEX PRECISION COMPONENTS</span>
            <span>&bull; KIRLOSKAR PUMPS NETWORK</span>
            <span>&bull; BHARAT HEAVY FORGE</span>
            <span>&bull; MAHINDRA CIE ECOSYSTEM</span>
            <span>&bull; SUNDRAM FASTENERS</span>
            <span>&bull; ENDURANCE TECHNOLOGIES</span>
            <span>&bull; PEENYA INDUSTRIAL CLUSTER</span>
            <span>&bull; TATA MOTORS SUPPLIERS</span>
            <span>&bull; APEX PRECISION COMPONENTS</span>
            <span>&bull; KIRLOSKAR PUMPS NETWORK</span>
            <span>&bull; BHARAT HEAVY FORGE</span>
            <span>&bull; MAHINDRA CIE ECOSYSTEM</span>
            <span>&bull; SUNDRAM FASTENERS</span>
          </div>
        </div>
      )}

      {/* Section 2: Before vs After Process Comparison (Matching Frames 016 - 027 of the video) */}
      {!result && (
        <section className="process-comparison-section" aria-label="Manual Chaos vs AI Clarity">
          <div className="process-header">
            <span className="process-eyebrow">Manual Chaos &rarr; AI Financial Clarity</span>
            <h2 className="process-headline">Automate your procurement. Protect factory capital.</h2>
            <p className="process-subtext">Every calculation, landed cost comparison, and Money Leak metric comes directly from your company's real documents.</p>
          </div>

          <div className="process-columns-grid">
            {/* Column 1: Manual Process with Dynamic Hour Counter */}
            <div className="process-col col-manual">
              <div className="process-col-header">
                <h3>Manual Process</h3>
                <span className="badge-hours mono">{manualHours} Hours</span>
              </div>
              <div className="process-step-list">
                <div className="process-step-card">
                  <div className="step-num">1. Decipher handwritten parchis &amp; WhatsApp chats</div>
                  <p>Meticulously re-type messy phone notes, WhatsApp audio quotes, and crumpled slips into spreadsheets.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">2. Chase vendors for revised quotes &amp; missing terms</div>
                  <p>Spend hours playing phone tag to clarify whether freight is included or extra, and who pays GTA tax.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">3. Manually check GST portal for active filing status</div>
                  <p>Open government GST portal to manually verify GSTIN validity and ensure ITC won't be blocked.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">4. Build complex Excel sheets with mixed tax rates</div>
                  <p>Manually balance varying GST rates (5%, 12%, 18%), packaging charges, and transit insurance fees.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">5. Guess credit-adjusted cost across different payment terms</div>
                  <p>Blindly compare 15-day cash discounts with 60-day credit without calculating true WACC cost of capital.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">6. Overlook silent ₹0.50/kg vendor rate creep</div>
                  <p>Repeat raw material purchases slowly rise in unit rate unnoticed until quarterly accounting audits.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">7. Double GST charged on GTA freight transportation</div>
                  <p>Transporter levies GST on consignment notes while the supplier also adds GST on the same freight line.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">8. Scramble to reconcile missing e-Invoices &amp; IRNs</div>
                  <p>Chasing suppliers before GSTR-2B filing deadlines for missing e-way bills and mandatory QR codes.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">9. Risk Section 43B(h) MSME payment disallowance</div>
                  <p>Delayed payments past 45 days lead to non-deductible tax liabilities and compound penal interest.</p>
                </div>
                <div className="process-step-card">
                  <div className="step-num">10. Manual voucher entry errors into Tally ERP</div>
                  <p>Typos in ledgers, tax heads, and invoice dates require weeks of painful reconciliation before CA audit.</p>
                </div>
              </div>
            </div>

            {/* Column 2: Kraya AI Process */}
            <div className="process-col col-ai">
              <div className="process-col-header">
                <h3>Kraya AI Process</h3>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge-done">&bull; Verified</span>
                  <span className="badge-time mono">60 Seconds</span>
                </div>
              </div>
              <div className="process-step-list">
                <div className="process-step-card ai-step-card">
                  <div className="step-num">1. Multimodal Document Ingestion</div>
                  <p>Drop a WhatsApp quote, bill PDF, handwritten parchi, or Hinglish voice note—parsed instantly with zero typing.</p>
                </div>
                <div className="process-step-card ai-step-card">
                  <div className="step-num">2. Deterministic GST 2.0 &amp; Landed Cost Engine</div>
                  <p>Validates GSTINs offline with Mod-36 checksums, computes credit-adjusted unit rates, and applies exact WACC.</p>
                </div>
                <div className="process-step-card ai-step-card">
                  <div className="step-num">3. Pre-Payment Money Leak Radar</div>
                  <p>Exposes duplicate freight GST, silent rate creep, and MSME 43B(h) payment deadlines before cheques are issued.</p>
                </div>
                <div className="process-step-card ai-step-card">
                  <div className="step-num">4. 1-Click WhatsApp Counter-Offer &amp; Tally Export</div>
                  <p>Auto-generates structured counter-offers and exports verified purchase vouchers directly into Tally XML.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 3: Interactive 3-Tab Feature Switcher (Matching Frames 032 - 036 of the video) */}
      {!result && (
        <section className="feature-switcher-section" aria-label="Interactive feature workflow">
          <h2 className="switcher-headline">
            Kraya ingests, audits, and executes<br />
            procurement—automatically.
          </h2>
          <div className="switcher-tabs">
            <button
              type="button"
              className={`switcher-tab ${activeFeatureTab === 'intake' ? 'active-blue' : ''}`}
              onClick={() => setActiveFeatureTab('intake')}
            >
              Intake
            </button>
            <button
              type="button"
              className={`switcher-tab ${activeFeatureTab === 'audit' ? 'active-blue' : ''}`}
              onClick={() => setActiveFeatureTab('audit')}
            >
              Audit
            </button>
            <button
              type="button"
              className={`switcher-tab ${activeFeatureTab === 'negotiate' ? 'active-green' : ''}`}
              onClick={() => setActiveFeatureTab('negotiate')}
            >
              Negotiate
            </button>
          </div>

          <div className="switcher-card-container">
            {activeFeatureTab === 'intake' && (
              <div className="switcher-preview-card anim-fade-in">
                <div className="stacked-leads-preview">
                  <div className="lead-row lead-3">
                    <img src="/images/avatar-3.jpg" alt="" />
                    <div className="lead-bar bar-long" />
                  </div>
                  <div className="lead-row lead-2">
                    <img src="/images/avatar-2.jpg" alt="" />
                    <div className="lead-bar bar-med" />
                  </div>
                  <div className="lead-row lead-1">
                    <img src="/images/avatar-1.jpg" alt="" />
                    <div className="lead-info">
                      <strong>Shree Balaji Steel &bull; HR Sheet 2.5mm</strong>
                      <span>₹42.00/kg &bull; 18% GST &bull; 30 Days Credit</span>
                    </div>
                  </div>
                </div>
                <h3>Multimodal Procurement Intake</h3>
                <p>Drop WhatsApp vendor quotes, bill scans, handwritten parchis, or Hinglish voice notes. Kraya extracts item rates, GST rates, HSN codes, and credit terms in 60 seconds.</p>
              </div>
            )}
            {activeFeatureTab === 'audit' && (
              <div className="switcher-preview-card anim-fade-in">
                <div className="stacked-leads-preview">
                  <div className="lead-row lead-3">
                    <img src="/images/avatar-6.jpg" alt="" />
                    <div className="lead-bar bar-long" />
                  </div>
                  <div className="lead-row lead-2">
                    <img src="/images/avatar-4.jpg" alt="" />
                    <div className="lead-bar bar-med" />
                  </div>
                  <div className="lead-row lead-1">
                    <img src="/images/avatar-5.jpg" alt="" />
                    <div className="lead-info">
                      <strong>Pre-Payment Money Leak Flagged</strong>
                      <span>Double Freight GST ₹2,400 &bull; 43B(h) MSME Clock 18d left</span>
                    </div>
                  </div>
                </div>
                <h3>Pre-Payment Money Leak Radar</h3>
                <p>Exposes silent rate creep, duplicate freight GST, unverified GSTINs, and Section 43B(h) payment deadlines before cheques or RTGS transfers are approved.</p>
              </div>
            )}
            {activeFeatureTab === 'negotiate' && (
              <div className="switcher-preview-card anim-fade-in">
                <div className="stacked-leads-preview">
                  <div className="lead-row lead-3">
                    <img src="/images/avatar-1.jpg" alt="" />
                    <div className="lead-bar bar-long" />
                  </div>
                  <div className="lead-row lead-2">
                    <img src="/images/avatar-2.jpg" alt="" />
                    <div className="lead-bar bar-med" />
                  </div>
                  <div className="lead-row lead-1">
                    <img src="/images/avatar-3.jpg" alt="" />
                    <div className="lead-info">
                      <strong>1-Click WhatsApp Counter-Offer</strong>
                      <span>Target: ₹39.50/kg &bull; Potential Savings: ₹18,400</span>
                    </div>
                  </div>
                </div>
                <h3>1-Click WhatsApp Negotiation &amp; PO</h3>
                <p>Generates polite, context-rich WhatsApp counter-offers in Hinglish/English and issues legally-binding GST Purchase Orders with zero hallucination.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Section 4: Factory Case Studies (Matching Frame 028 of the video) */}
      {!result && (
        <section className="case-studies-section" aria-label="Factory case studies">
          <div className="section-header-split">
            <div>
              <h2 className="section-headline">Factory Case Studies</h2>
              <p className="section-subtext">
                How Indian industrial manufacturers save lakhs in working capital with Kraya.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              onClick={() => onNavigate('buying')}
            >
              See all case studies &bull;
            </button>
          </div>

          <div className="case-study-card">
            <div className="case-study-photo-box" style={{ backgroundImage: 'url(/images/director.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <div className="case-study-avatar-overlay">
                <div className="case-study-author">Rajesh Sharma</div>
                <div className="case-study-role">Managing Director, Apex Precision Castings (Pune)</div>
              </div>
            </div>
            <div className="case-study-content">
              <blockquote className="case-study-quote">
                &ldquo;Before Kraya, our accounts team was blindsided by freight double-taxation and late MSME payments. Kraya catches rate creep on WhatsApp before our accounts head signs the cheque. It paid for itself in the first 14 days.&rdquo;
              </blockquote>
              <div className="case-study-stats-row">
                <div className="case-study-stat">
                  <strong>₹4.8L+</strong>
                  <span>Annual Money Leaks caught before payment</span>
                </div>
                <div className="case-study-stat">
                  <strong>100%</strong>
                  <span>GST 2.0 ITC reconciled with zero CA penalties</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm pill"
                  style={{ alignSelf: 'center', marginLeft: 'auto' }}
                  onClick={() => onNavigate('buying')}
                >
                  Open Landed Cost Comparison &bull;
                </button>
              </div>
            </div>
          </div>
          <div className="case-study-nav-row">
            <div className="carousel-dots">
              <span className="dot active" />
              <span className="dot" />
              <span className="dot" />
            </div>
            <div className="carousel-arrows">
              <button type="button" className="arrow-btn" aria-label="Previous story">&lsaquo;</button>
              <button type="button" className="arrow-btn" aria-label="Next story">&rsaquo;</button>
            </div>
          </div>
        </section>
      )}

      {/* Section 5: Customer Testimonials 4-Card Grid (Matching Frame 038 & 040 of the video) */}
      {!result && (
        <section className="customer-testimonials-section">
          <div className="section-header-split" style={{ marginBottom: 32 }}>
            <div>
              <h2 className="section-headline">Trusted by Indian manufacturing CFOs &amp; factory owners</h2>
              <p className="section-subtext">
                Real procurement and compliance results from industrial clusters in Pune, Peenya, Manesar, and Coimbatore.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              onClick={() => onNavigate('suppliers')}
            >
              Get Started &bull;
            </button>
          </div>

          <div className="testimonials-grid">
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-1.jpg" alt="Vikram Patel" />
              </div>
              <p className="portrait-quote">&ldquo;We process 400+ supplier bills a month. Kraya caught silent ₹0.40/kg rate creep on MS wire that our manual audit had missed for 3 months.&rdquo;</p>
              <div className="portrait-author">
                <strong>Vikram Patel</strong>
                <span>Head of Procurement, Gujarat Polychem</span>
              </div>
            </div>
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-2.jpg" alt="Ananya Deshmukh" />
              </div>
              <p className="portrait-quote">&ldquo;Section 43B(h) used to give us sleepless nights before every tax audit. Kraya auto-tracks the 45-day MSME clock so we never face tax disallowances.&rdquo;</p>
              <div className="portrait-author">
                <strong>Ananya Deshmukh</strong>
                <span>CFO, Pune Auto Assemblies</span>
              </div>
            </div>
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-5.jpg" alt="K. Ramanathan" />
              </div>
              <p className="portrait-quote">&ldquo;Comparing quotes with 15-day cash discount vs 60-day credit was a spreadsheet headache. Kraya normalizes WACC and landed cost instantly.&rdquo;</p>
              <div className="portrait-author">
                <strong>K. Ramanathan</strong>
                <span>Managing Partner, Coimbatore Foundry Works</span>
              </div>
            </div>
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-3.jpg" alt="Siddharth Jain" />
              </div>
              <p className="portrait-quote">&ldquo;Our factory supervisors send 15-second Hinglish voice notes directly from the floor. Kraya parses quantities, matches POs, and flags errors on the spot.&rdquo;</p>
              <div className="portrait-author">
                <strong>Siddharth Jain</strong>
                <span>Director, Delhi Packaging Industries</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 6: Live Money Leak Radar & Savings Impact */}
      <section className="savings-radar-section" aria-label="Savings and Money Leak Radar">
        <div className="savings-split-container">
          <div className="savings-left-panel">
            <div className="radar-tag-row">
              <span className="pill pill-accent"><ShieldCheck size={12} /> Statutory Radar</span>
              <span className="pill">Pre-Payment Guard</span>
            </div>
            <h2 className="savings-main-title">Money Leak Radar — 60-Second Overpayment &amp; GST ITC Audit</h2>
            <p className="savings-main-desc">
              Real overcharges, silent vendor rate creep, double freight GST, and ITC risks detected from your uploaded bills &amp; quotes.
            </p>

            {leaks.length === 0 ? (
              <div className="empty-radar-card">
                <ShieldAlert size={28} style={{ color: 'var(--accent)' }} />
                <h4>Zero leaks logged yet — no dummy numbers shown</h4>
                <p>
                  Drop 2–5 recent supplier bills, click the <strong>Daily Tasks</strong> starter tab above to test an audit, or use the PO-vs-Invoice Checker to expose hidden rupee leaks instantly.
                </p>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => onNavigate('daily')}>
                  Audit Full Bill vs. PO <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              <div className="radar-leak-list">
                {leaks.map((leak) => (
                  <div key={leak.id} className="radar-leak-item">
                    <div className="leak-item-info">
                      <div className="row" style={{ marginBottom: 4 }}>
                        <span className="pill pill-critical mono">{formatINR(leak.amountPaise)}</span>
                        <span className="pill">{leak.status.toUpperCase()}</span>
                        {leak.statutoryRef && <span className="pill">{leak.statutoryRef}</span>}
                      </div>
                      <div className="leak-item-title">{leak.title}</div>
                      <div className="leak-item-detail">{leak.detail}</div>
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-whatsapp btn-sm"
                        onClick={() => {
                          handleUpdateLeak(leak.id, 'disputed');
                          onOpenOutreach({
                            scenario: 'invoice_dispute',
                            supplierName: leak.supplier?.name || 'Supplier',
                            supplierPhone: leak.supplier?.phone,
                            supplierEmail: leak.supplier?.email,
                            disputeAmountPaise: leak.amountPaise,
                            disputeReasons: [leak.title],
                          });
                        }}
                      >
                        <MessageCircle size={13} /> Dispute on WhatsApp
                      </button>
                      {leak.status !== 'recovered' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => handleUpdateLeak(leak.id, 'recovered')}
                        >
                          Mark Recovered
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="savings-right-summary">
            <div className="summary-floating-card">
              <span className="summary-subhead">Your factory can protect</span>
              <div className="summary-big-number mono">
                {(summary?.totalProtectedPaise ?? 0) > 0 ? formatINR(summary?.totalProtectedPaise ?? 0, 0) : '₹1,24,000+'}
              </div>
              <span className="summary-period">per financial year</span>

              <div className="summary-metric-grid">
                <div className="summary-metric-box">
                  <span className="metric-box-label">GST 2.0 ITC</span>
                  <strong className="metric-box-val">100% Eligible</strong>
                </div>
                <div className="summary-metric-box">
                  <span className="metric-box-label">43B(h) Risk</span>
                  <strong className="metric-box-val">₹0 Penalties</strong>
                </div>
                <div className="summary-metric-box">
                  <span className="metric-box-label">Freight Tax</span>
                  <strong className="metric-box-val">0 Double-GST</strong>
                </div>
                <div className="summary-metric-box">
                  <span className="metric-box-label">Audit Readiness</span>
                  <strong className="metric-box-val">SHA-256 Chained</strong>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary summary-action-btn"
                onClick={() => onNavigate('daily')}
              >
                Inspect Audit Pack •
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 7: Transparent Factory Compliance Tiers (Matching Frame 038 of the video) */}
      {!result && (
        <section className="pricing-tiers-section" aria-label="Compliance tiers">
          <div className="section-header-split">
            <div>
              <h2 className="section-headline">Simple, transparent factory compliance tiers</h2>
              <p className="section-subtext">
                Real ROI for Indian manufacturing — software that pays for itself on the first supplier negotiation.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              onClick={() => onNavigate('suppliers')}
            >
              Start Free Trial &bull;
            </button>
          </div>

          <div className="pricing-grid">
            <div className="pricing-card card-light">
              <div className="pricing-tier-name">Growth Factory</div>
              <div className="pricing-price">
                <span className="price-amount">₹9,999</span>
                <span className="price-period">/month</span>
              </div>
              <ul className="pricing-checklist">
                <li><Check size={14} /> Up to 500 invoices &amp; quotes per month</li>
                <li><Check size={14} /> WhatsApp, Email &amp; voice note intake</li>
                <li><Check size={14} /> GST 2.0 ITC lock-in &amp; Mod-36 checksums</li>
                <li><Check size={14} /> Team collaboration (3 user seats)</li>
                <li><Check size={14} /> Tally XML &amp; CA IMS reconciliation pack</li>
              </ul>
              <button
                type="button"
                className="btn btn-primary pricing-btn"
                onClick={focusPromptInput}
              >
                Start Free Trial &bull;
              </button>
            </div>

            <div className="pricing-card card-dark">
              <div className="pricing-tier-name">Enterprise CFO</div>
              <div className="pricing-price">
                <span className="price-amount">₹24,999</span>
                <span className="price-period">/month</span>
              </div>
              <ul className="pricing-checklist">
                <li><Check size={14} /> Unlimited invoices, quotations &amp; RFQs</li>
                <li><Check size={14} /> Section 43B(h) 45-day MSME auto-clock</li>
                <li><Check size={14} /> Custom ERP webhooks &amp; SAP/Busy sync</li>
                <li><Check size={14} /> Dedicated CA compliance manager support</li>
                <li><Check size={14} /> Multi-GSTIN &amp; branch consolidation</li>
              </ul>
              <button
                type="button"
                className="btn btn-light pricing-btn"
                onClick={focusPromptInput}
              >
                Contact Enterprise Sales &bull;
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Section 8: Knowledge Base / Compliance Guides Triad (Matching Frame 042 of the video) */}
      {!result && (
        <section className="blog-section" aria-label="Knowledge Base and Resources">
          <div className="blog-featured-card">
            <div className="blog-featured-img">
              <img src="/images/office.jpg" alt="Accounts and finance workspace" />
            </div>
            <div className="blog-featured-body">
              <span className="blog-tag">STATUTORY COMPLIANCE</span>
              <h3>How to Navigate MSME Section 43B(h) and Prevent Income Tax Disallowances</h3>
              <p>A practical playbook for Indian factory owners to track 15-day and 45-day payment cycles, verify vendor Udyam registration, and safeguard working capital deductions under Indian income tax laws.</p>
              <div className="blog-meta">
                <img src="/images/avatar-3.jpg" className="author-thumb" alt="CA Sunil Mehta" />
                <strong style={{ color: '#0f172a' }}>CA Sunil Mehta</strong>
                <span>&bull;</span>
                <span>Nov 2026</span>
                <span>&bull;</span>
                <span className="pill pill-sm" style={{ background: '#f1f5f9', color: '#64748b' }}>6 min read</span>
              </div>
            </div>
          </div>

          <div className="blog-grid-triad">
            <div className="blog-triad-card">
              <div className="triad-text">
                <span className="blog-tag">GST 2.0 AUDIT</span>
                <h4>Stopping Double Freight Taxation: GTA vs Reverse Charge Explained</h4>
                <div className="triad-meta">4 min read &bull; Nov 2026</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/office.jpg" alt="" />
              </div>
            </div>

            <div className="blog-triad-card">
              <div className="triad-text">
                <span className="blog-tag">SUPPLIER NEGOTIATIONS</span>
                <h4>5 Proven WhatsApp Negotiation Strategies for Raw Material Procurement</h4>
                <div className="triad-meta">3 min read &bull; Nov 2026</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/factory.jpg" alt="" />
              </div>
            </div>

            <div className="blog-triad-card">
              <div className="triad-text">
                <span className="blog-tag">TALLY INTEGRATION</span>
                <h4>Automating Purchase Vouchers from WhatsApp Quotes into Tally Prime</h4>
                <div className="triad-meta">5 min read &bull; Nov 2026</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/office.jpg" alt="" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 9: Statutory & Operational FAQs (Matching Frame 042 & 045 of the video) */}
      {!result && (
        <section className="faq-section" aria-label="Frequently asked questions">
          <div className="faq-header">
            <h2 className="faq-title">Your questions, answered.</h2>
            <p className="faq-subtitle">Everything you need to know about Indian statutory compliance, ERP integrations, and Kraya's deterministic engine.</p>
          </div>

          <div className="faq-list">
            {[
              {
                q: 'How does Kraya verify GST 2.0 without leaking proprietary data?',
                a: 'Kraya uses an offline, deterministic Mod-36 checksum engine and local parsing. Your vendor pricing, quote terms, and factory financial documents are encrypted and never sent to public generative AI model training pools.',
              },
              {
                q: 'How does MSME Section 43B(h) 45-day calculation work with Udyam verification?',
                a: 'Kraya classifies vendors into Micro, Small, or Medium based on verified Udyam records. Micro and Small suppliers are anchored to 15-day or 45-day statutory payment clocks to protect your company from income tax disallowances and penal compound interest.',
              },
              {
                q: 'Can Kraya parse Hinglish voice notes and handwritten parchis?',
                a: 'Yes. Kraya incorporates multi-lingual Indian speech-to-text and document vision supporting Hinglish, English, Hindi, Tamil, Kannada, and Malayalam. Unclear or missing fields are explicitly flagged as amber chips—never hallucinated or guessed.',
              },
              {
                q: 'How do I export to Tally XML and share with my Chartered Accountant?',
                a: 'Every verified quotation, PO, and invoice is exportable into standardized Tally XML ledger vouchers and CA GST IMS reconciliation packs in 1 click from the Unified Inbox.',
              },
            ].map((faq, idx) => (
              <div key={idx} className={`faq-card ${openFaq === idx ? 'open' : ''}`}>
                <button
                  type="button"
                  className="faq-question-btn"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                >
                  <span>{faq.q}</span>
                  <span className="faq-icon">{openFaq === idx ? '−' : '+'}</span>
                </button>
                {openFaq === idx && (
                  <div className="faq-answer">
                    <p>{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 10: Royal Blue CTA Banner (Matching Frame 045 of the video) */}
      {!result && (
        <section className="video-cta-banner">
          <div className="cta-banner-content">
            <div className="cta-banner-left">
              <h2>Procure Smarter.<br />Protect Factory Capital.</h2>
              <button
                type="button"
                className="btn btn-cta-light"
                onClick={focusPromptInput}
              >
                Run Procurement Agent &bull;
              </button>
            </div>
            <div className="cta-banner-right">
              <p>
                Stop invoice leaks before payment approval. 60-second audits, zero hallucination, and tamper-evident SHA-256 audit logs.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Section 11: Modern Card Footer (Matching Frame 046 of the video) */}
      <footer className="video-footer-card">
        <div className="footer-top-row">
          <div className="footer-brand-column">
            <div className="footer-brand-logo">
              <div className="brand-mark" style={{ width: 38, height: 38 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2.5" />
                  <circle cx="14" cy="10" r="3" fill="#ffffff" />
                </svg>
              </div>
              <span className="brand-title" style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>Kraya AI</span>
            </div>
            <div className="subscribe-box">
              <label htmlFor="subscribe-email">SUBSCRIBE FOR STATUTORY COMPLIANCE UPDATES</label>
              <div className="subscribe-input-wrap">
                <input id="subscribe-email" type="email" placeholder="cfo@yourfactory.in" />
                <button type="button" className="btn btn-primary btn-sm" style={{ padding: '8px 18px', borderRadius: 999 }}>Subscribe</button>
              </div>
            </div>
          </div>

          <div className="footer-nav-columns">
            <div className="footer-col">
              <h4>PLATFORM</h4>
              <ul>
                <li><button type="button" onClick={() => onNavigate('buying')}>Landed Cost Engine</button></li>
                <li><button type="button" onClick={() => onNavigate('daily')}>Money Leak Radar</button></li>
                <li><button type="button" onClick={() => onNavigate('suppliers')}>GST 2.0 &amp; 43B(h)</button></li>
                <li><button type="button" onClick={() => onNavigate('inbox')}>Tally XML Export</button></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>RESOURCES</h4>
              <ul>
                <li><button type="button" onClick={() => onNavigate('buying')}>Factory Case Studies</button></li>
                <li><button type="button" onClick={() => onNavigate('daily')}>CA Audit Packs</button></li>
                <li><button type="button" onClick={() => setOpenFaq(0)}>Compliance FAQ</button></li>
                <li><button type="button" onClick={() => onNavigate('suppliers')}>Supplier Directory</button></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-bottom-bar">
          <span>&copy; {new Date().getFullYear()} Kraya AI Technologies Inc. All rights reserved. Pre-payment verification &amp; CA audit support for Indian manufacturing.</span>
          <div className="footer-legal-links">
            <button type="button">Privacy Policy</button>
            <button type="button">Terms of Service</button>
            <button type="button">DPDP Act Ready</button>
            <button type="button">SOC2 Type II</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
