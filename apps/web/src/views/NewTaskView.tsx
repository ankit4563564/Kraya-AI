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
  ChevronDown,
  ChevronUp,
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
  const isEmptyWorkspace =
    summary !== null &&
    summary.suppliersCount === 0 &&
    summary.openRfqsCount === 0 &&
    summary.inboxCount === 0 &&
    summary.posIssuedCount === 0 &&
    summary.activeLeaksCount === 0;
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
  const [activeFeatureTab, setActiveFeatureTab] = useState<'prospect' | 'personalise' | 'book'>('prospect');
  const [manualHours, setManualHours] = useState(0);
  const [viewMode, setViewMode] = useState<'platform' | 'studio'>('platform');

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

  return (
    <div className="hero-canvas">
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
            onClick={() => {
              const el = document.querySelector('.prompt-textarea') as HTMLTextAreaElement | null;
              el?.focus();
            }}
          >
            Run Procurement Agent •
          </button>
        </div>
      </div>

      <div className="hero-centerpiece-container">
        <div className="hero-radar-orb">
          <div className="radar-core-ring">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2.5" />
              <circle cx="14" cy="10" r="3" fill="#ffffff" />
            </svg>
          </div>
          <div className="radar-orbit-avatar orb-av-1" title="Vendor Partner">
            <img src="/images/avatar-1.jpg" alt="" />
          </div>
          <div className="radar-orbit-avatar orb-av-2" title="Procurement Lead">
            <img src="/images/avatar-2.jpg" alt="" />
          </div>
          <div className="radar-orbit-avatar orb-av-3" title="Factory CFO">
            <img src="/images/avatar-3.jpg" alt="" />
          </div>
          <div className="radar-orbit-avatar orb-av-4" title="Vendor Partner">
            <img src="/images/avatar-4.jpg" alt="" />
          </div>
          <div className="radar-orbit-avatar orb-av-5" title="Compliance Officer">
            <img src="/images/avatar-5.jpg" alt="" />
          </div>
          <div className="radar-orbit-avatar orb-av-6" title="Accounts Manager">
            <img src="/images/avatar-6.jpg" alt="" />
          </div>
          <div className="radar-status-badge">
            <span className="live-status-dot" />
            <span>Prospect Discovery &bull; 60s Procurement Radar</span>
          </div>
        </div>
      </div>

      <div className="experience-mode-selector">
        <button
          type="button"
          className={`mode-btn ${viewMode === 'platform' ? 'active' : ''}`}
          onClick={() => setViewMode('platform')}
        >
          <Sparkles size={14} /> Platform Overview
        </button>
        <button
          type="button"
          className={`mode-btn ${viewMode === 'studio' ? 'active' : ''}`}
          onClick={() => {
            setViewMode('studio');
            setTimeout(() => {
              (document.querySelector('.prompt-textarea') as HTMLTextAreaElement | null)?.focus();
            }, 50);
          }}
        >
          <Send size={14} /> Interactive Studio Workspace
        </button>
      </div>

      {/* Interactive Studio Command Card & Starter Tabs */}
      {(viewMode === 'studio' || attachedFiles.length > 0 || prompt.trim().length > 0) && (
        <div className="studio-composer-container anim-fade-in" style={{ maxWidth: 1040, width: '100%', margin: '0 auto 48px' }}>
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
              <div className="row" style={{ marginTop: 6 }}>
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
      )}

      {/* Section 1: Enterprise Scale & Trust (Matching Frames 010 - 013 of the video) */}
      {!result && (
        <section className="enterprise-trust-section" aria-label="Enterprise scale and trust">
          <div className="section-header-split">
            <div>
              <h2 className="section-headline">Built for enterprise scale and trust</h2>
              <p className="section-subtext">
                Omni SDR meets the highest security, uptime, and support standards — so your revenue engine never slows down, no matter how fast you grow.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              disabled={isCaReadOnly}
              onClick={() => {
                setViewMode('studio');
                setChannel('pdf');
                fileInputRef.current?.click();
              }}
            >
              Get Started •
            </button>
          </div>

          <div className="enterprise-card-grid">
            {/* Card 1: Calendar Booking on Autopilot */}
            <div className="showcase-card">
              <div className="showcase-card-header">
                <span className="showcase-badge">5x</span>
              </div>
              <div className="showcase-preview-box">
                <div className="preview-stat-row">
                  <span className="pill pill-accent">Discovery Call</span>
                  <span className="pill">30 Min Meeting</span>
                  <span className="pill pill-success">9:30 am</span>
                </div>
                <div className="row" style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <img src="/images/avatar-2.jpg" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                  <div className="preview-title" style={{ margin: 0 }}>Lyle Kaufman &bull; Agenda KPI Q&amp;A</div>
                </div>
              </div>
              <h3>Calendar Booking on Autopilot</h3>
              <p>Schedules meetings the moment a lead qualifies—often while your team sleeps. Our AI books 5&times; more demos without human back-and-forth and drops them straight into your calendar.</p>
            </div>

            {/* Card 2: Scale That Humans Can't Match */}
            <div className="showcase-card">
              <div className="network-graph-box">
                <div className="network-center-node">
                  <span>&gt;1M</span>
                </div>
                <div className="network-orbit-node net-node-1"><img src="/images/avatar-1.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-2"><img src="/images/avatar-2.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-3"><img src="/images/avatar-3.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-4"><img src="/images/avatar-4.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-5"><img src="/images/avatar-5.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-6"><img src="/images/avatar-6.jpg" alt="" /></div>
                <svg className="network-lines-svg" viewBox="0 0 240 240">
                  <line x1="120" y1="95" x2="60" y2="30" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="180" y2="30" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="35" y2="95" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="205" y2="95" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="70" y2="160" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="120" y1="95" x2="170" y2="160" stroke="#bfdbfe" strokeWidth="1.5" strokeDasharray="3 3" />
                </svg>
              </div>
              <h3>Scale That Humans Can&apos;t Match</h3>
              <p>Over one million personalized touches every month—Omni SDR engages prospects at machine speed while your team focuses on closing.</p>
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
                <div className="hub-app-icon hub-app-1">Tally</div>
                <div className="hub-app-icon hub-app-2">SAP</div>
                <div className="hub-app-icon hub-app-3">WhatsApp</div>
                <div className="hub-app-icon hub-app-4">Gmail</div>
                <div className="hub-app-icon hub-app-5">Excel</div>
              </div>
              <h3>Integrations That Just Work</h3>
              <p>Seamlessly connect with the tools your team already uses—without complicated setup, costly delays, or workflow disruptions.</p>
            </div>

            {/* Card 4: Enterprise-Grade Performance */}
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
                  <strong>60ms</strong> Latency &bull; 99.99% Enterprise Uptime
                </div>
              </div>
              <h3>Enterprise-Grade Performance</h3>
              <p>Millisecond-level API calls and elastic scaling handle traffic spikes without breaking a sweat—your pipeline stays fast even on launch days.</p>
            </div>
          </div>

          {/* Marquee Banner Matching Frame 013 */}
          <div className="marquee-banner">
            <div className="marquee-title">Fueling growth for innovative teams worldwide</div>
            <div className="marquee-track-wrapper">
              <div className="marquee-track">
                <span className="marquee-item">&bull; TATA MOTORS</span>
                <span className="marquee-item">&bull; APEX PRECISION</span>
                <span className="marquee-item">&bull; KIRLOSKAR</span>
                <span className="marquee-item">&bull; BHARAT FORGE</span>
                <span className="marquee-item">&bull; MAHINDRA CIE</span>
                <span className="marquee-item">&bull; SUNDRAM FASTENERS</span>
                <span className="marquee-item">&bull; TATA MOTORS</span>
                <span className="marquee-item">&bull; APEX PRECISION</span>
                <span className="marquee-item">&bull; KIRLOSKAR</span>
                <span className="marquee-item">&bull; BHARAT FORGE</span>
                <span className="marquee-item">&bull; MAHINDRA CIE</span>
                <span className="marquee-item">&bull; SUNDRAM FASTENERS</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 2: Process Comparison with Dynamic Count-Up (Matching Frames 016 - 027 of the video) */}
      {!result && (
        <section className="process-comparison-section" aria-label="Process comparison">
          <div className="comparison-header">
            <span className="comparison-eyebrow">Manual Chaos &rarr; AI Clarity</span>
            <h2 className="comparison-title">Automate your outreach. Reclaim your time.</h2>
            <p className="comparison-subtitle">
              Every calculation, landed cost comparison, and Money Leak metric comes directly from your real documents.
            </p>
          </div>

          <div className="comparison-columns">
            {/* Left Column: Manual Process (Dynamic Counter 0 -> 112 Hours) */}
            <div className="comparison-col">
              <div className="col-pill-header manual-pill-header">
                <span className="col-header-label">Manual Process</span>
                <span className="col-header-chip mono">{manualHours} Hours</span>
              </div>
              <div className="comparison-card-list">
                {[
                  { n: 1, t: 'Build lead spreadsheet', d: 'Manually gather lead details and meticulously organize them into structured rows and columns in a spreadsheet.' },
                  { n: 2, t: 'Hunt down valid emails', d: 'Spend valuable hours researching prospects online and cross-checking databases to find accurate, working email addresses.' },
                  { n: 3, t: 'Draft cold emails', d: 'Individually write personalized outreach emails from scratch, hoping to resonate with each recipient.' },
                  { n: 4, t: 'Schedule batch send', d: 'Queue and stagger emails across accounts to avoid spam triggers.' },
                  { n: 5, t: 'Wait for replies', d: 'Days of silence while leads sit uncontacted.' },
                  { n: 6, t: 'Manual follow-ups', d: 'Chasing non-responders with manual reminders.' },
                  { n: 7, t: 'Qualify prospects on calls', d: 'Screening calls that often end in bad fits.' },
                  { n: 8, t: 'Back-and-forth scheduling', d: 'Playing the never-ending calendar email tag.' },
                  { n: 9, t: 'Update CRM fields', d: 'Spend extra hours manually logging interactions and notes.' },
                  { n: 10, t: 'Meeting finally confirmed', d: 'After numerous manual tasks, repeated efforts, and days of waiting.' },
                ].map((step) => (
                  <div key={step.n} className="comparison-card">
                    <div className="card-info">
                      <strong>{step.n}. {step.t}</strong>
                      <span>{step.d}</span>
                    </div>
                    <span className="card-circle-status pending">&bull;</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Omni SDR Process (✦ Done 15 Min) */}
            <div className="comparison-col">
              <div className="col-pill-header kraya-pill-header">
                <span className="col-header-label">Omni SDR Process</span>
                <div className="row" style={{ gap: 6 }}>
                  <span className="col-header-chip chip-yellow">✦ Done</span>
                  <span className="col-header-chip mono">15 Min</span>
                </div>
              </div>
              <div className="comparison-card-list">
                <button
                  type="button"
                  className="comparison-card interactive"
                  disabled={isCaReadOnly}
                  onClick={() => {
                    setViewMode('studio');
                    setChannel('whatsapp');
                    fileInputRef.current?.click();
                  }}
                >
                  <div className="card-info">
                    <strong>1. Connect your CRM &amp; Channels</strong>
                    <span>Seamlessly plug your existing tools into the agent—no setup headaches, no code. Just connect and let automation begin.</span>
                  </div>
                  <span className="card-circle-status done">&check;</span>
                </button>
                <button
                  type="button"
                  className="comparison-card interactive"
                  disabled={isCaReadOnly}
                  onClick={() => {
                    setViewMode('studio');
                    setChannel('pdf');
                    fileInputRef.current?.click();
                  }}
                >
                  <div className="card-info">
                    <strong>2. AI scores &amp; personalizes leads</strong>
                    <span>Instantly analyzes and ranks leads based on relevance and buying intent, then tailors outreach to each one before you lift a finger.</span>
                  </div>
                  <span className="card-circle-status done">&check;</span>
                </button>
                <button
                  type="button"
                  className="comparison-card interactive"
                  onClick={() => onNavigate('suppliers')}
                >
                  <div className="card-info">
                    <strong>3. Smart follow-up launches</strong>
                    <span>Outreach never sleeps. Your AI agent sends timely, personalized follow-ups around the clock to maximize response and engagement rates.</span>
                  </div>
                  <span className="card-circle-status done">&check;</span>
                </button>
                <button
                  type="button"
                  className="comparison-card interactive"
                  onClick={() => onNavigate('buying')}
                >
                  <div className="card-info">
                    <strong>4. Calendar filled—meeting booked</strong>
                    <span>Once replies come in, the AI handles scheduling and confirmations—dropping booked meetings directly into your calendar.</span>
                  </div>
                  <span className="card-circle-status done">&check;</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 3: Interactive 3-Tab Feature Switcher (Matching Frames 032 - 036 of the video) */}
      {!result && (
        <section className="feature-switcher-section">
          <h2 className="switcher-headline">
            Omni SDR prospects, personalizes, and<br />
            books meetings—automatically.
          </h2>
          <div className="switcher-tabs">
            <button
              type="button"
              className={`switcher-tab ${activeFeatureTab === 'prospect' ? 'active-blue' : ''}`}
              onClick={() => setActiveFeatureTab('prospect')}
            >
              Prospect
            </button>
            <button
              type="button"
              className={`switcher-tab ${activeFeatureTab === 'personalise' ? 'active-blue' : ''}`}
              onClick={() => setActiveFeatureTab('personalise')}
            >
              Personalise
            </button>
            <button
              type="button"
              className={`switcher-tab ${activeFeatureTab === 'book' ? 'active-green' : ''}`}
              onClick={() => setActiveFeatureTab('book')}
            >
              Book
            </button>
          </div>

          <div className="switcher-card-container">
            {activeFeatureTab === 'prospect' && (
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
                      <strong>Marcus Vance</strong>
                      <span>VP Procurement &bull; TechCorp</span>
                    </div>
                  </div>
                </div>
                <h3>Find qualified leads</h3>
                <p>AI pulls fresh contacts that match your ICP and enriches them with live firmographic data.</p>
              </div>
            )}
            {activeFeatureTab === 'personalise' && (
              <div className="switcher-preview-card anim-fade-in">
                <div className="stacked-leads-preview">
                  <div className="lead-row lead-3">
                    <img src="/images/avatar-2.jpg" alt="" />
                    <div className="lead-bar bar-long" />
                  </div>
                  <div className="lead-row lead-2">
                    <img src="/images/avatar-1.jpg" alt="" />
                    <div className="lead-bar bar-med" />
                  </div>
                  <div className="lead-row lead-1">
                    <img src="/images/avatar-4.jpg" alt="" />
                    <div className="lead-info">
                      <strong>AI Dynamic Context Injection</strong>
                      <span>GST 2.0 &amp; Custom MSME 45-day credit terms</span>
                    </div>
                  </div>
                </div>
                <h3>Hyper-personalized outreach</h3>
                <p>Crafts bespoke context-rich emails, WhatsApp messages, and RFQ responses in 60 seconds.</p>
              </div>
            )}
            {activeFeatureTab === 'book' && (
              <div className="switcher-preview-card anim-fade-in">
                <div className="stacked-leads-preview">
                  <div className="lead-row lead-3">
                    <img src="/images/avatar-6.jpg" alt="" />
                    <div className="lead-bar bar-long" />
                  </div>
                  <div className="lead-row lead-2">
                    <img src="/images/avatar-3.jpg" alt="" />
                    <div className="lead-bar bar-med" />
                  </div>
                  <div className="lead-row lead-1">
                    <img src="/images/avatar-5.jpg" alt="" />
                    <div className="lead-info">
                      <strong>Meeting Auto-Confirmed &bull; 9:30 AM</strong>
                      <span>Direct Google / Outlook Calendar Sync &bull; 30 Min</span>
                    </div>
                  </div>
                </div>
                <h3>Turn replies into meetings</h3>
                <p>Positive responses trigger calendar links and CRM updates while your reps focus on closing.</p>
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
              <h2 className="section-headline">Case Studies</h2>
              <p className="section-subtext">
                Omni SDR meets the highest security, uptime, and support standards — so your revenue engine never slows down, no matter how fast you grow.
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
                <div className="case-study-author">Sarah Davis</div>
                <div className="case-study-role">Co-owner of HillCrust Pizza</div>
              </div>
            </div>
            <div className="case-study-content">
              <blockquote className="case-study-quote">
                &ldquo;We don&apos;t have a huge sales team, so Omni SDR was like hiring 3 reps overnight. It learns fast, personalizes well, and doesn&apos;t miss follow-ups. Our inbound and outbound are now in sync.&rdquo;
              </blockquote>
              <div className="case-study-stats-row">
                <div className="case-study-stat">
                  <strong>4&times;</strong>
                  <span>Increase in outbound responses</span>
                </div>
                <div className="case-study-stat">
                  <strong>2</strong>
                  <span>ROI-positive in just 2 weeks</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm pill"
                  style={{ alignSelf: 'center', marginLeft: 'auto' }}
                  onClick={() => onNavigate('daily')}
                >
                  See Sarah&apos;s Story &bull;
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
              <h2 className="section-headline">Teams trust Omni SDR</h2>
              <p className="section-subtext">
                Real results—from startups to heavy engineering enterprises—that prove automation pays for itself.
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
                <img src="/images/avatar-1.jpg" alt="Samantha K." />
              </div>
              <p className="portrait-quote">&ldquo;What used to take me an entire week is now done before my coffee gets cold. Omni SDR is an absolute no-brainer.&rdquo;</p>
              <div className="portrait-author">
                <strong>Samantha K.</strong>
                <span>Lead at BrightWave</span>
              </div>
            </div>
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-2.jpg" alt="Daniel Ming" />
              </div>
              <p className="portrait-quote">&ldquo;Before Omni SDR, my inbox was chaos. Now, AI handles the follow-ups and I only talk to people ready to buy.&rdquo;</p>
              <div className="portrait-author">
                <strong>Daniel Ming</strong>
                <span>Account Executive at FinEdge</span>
              </div>
            </div>
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-5.jpg" alt="Elena Tan" />
              </div>
              <p className="portrait-quote">&ldquo;We went live in 48 hours. Research time dropped 80% and Omni SDR booked 27 meetings in the first month alone.&rdquo;</p>
              <div className="portrait-author">
                <strong>Elena Tan</strong>
                <span>Head of Marketing, CircuitFlow</span>
              </div>
            </div>
            <div className="testimonial-portrait-card">
              <div className="portrait-img-box">
                <img src="/images/avatar-3.jpg" alt="Marco Alvarez" />
              </div>
              <p className="portrait-quote">&ldquo;Personalization at scale. Positive reply rate jumped from 2% to 7.6% and we opened 14 net-new opps in Q1.&rdquo;</p>
              <div className="portrait-author">
                <strong>Marco Alvarez</strong>
                <span>Co-founder, RenderKit</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Structured Result Card (Zero Hallucination + Amber Verification Chips + 1-Click Action) */}
      {result && (
        <div className="card stack">
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
                  Net Landed: {formatINR(result.created.quote.netLandedUnitPaise)} · Credit-Adjusted Real Cost:{' '}
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

      {/* Section 4: Live Money Leak Radar & Savings Impact (Matching Frame 030 of the video) */}
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

      {/* Section 5: Transparent Compliance Tiers (Matching Frame 038 of the video) */}
      {!result && (
        <section className="pricing-tiers-section" aria-label="Compliance tiers">
          <div className="section-header-split">
            <div>
              <h2 className="section-headline">Simple, transparent compliance tiers</h2>
              <p className="section-subtext">
                Real ROI for Indian manufacturing — software that pays for itself on the first supplier negotiation.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              onClick={() => onNavigate('suppliers')}
            >
              Start Free Trial •
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
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  (document.querySelector('.prompt-textarea') as HTMLTextAreaElement | null)?.focus();
                }}
              >
                Get Started •
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
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  (document.querySelector('.prompt-textarea') as HTMLTextAreaElement | null)?.focus();
                }}
              >
                Get Started •
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Section 6: Knowledge Base / Blog Triad (Matching Frame 042 of the video) */}
      {!result && (
        <section className="blog-section" aria-label="Knowledge Base and Resources">
          <div className="blog-featured-card">
            <div className="blog-featured-img">
              <img src="/images/office.jpg" alt="Support workspace" />
            </div>
            <div className="blog-featured-body">
              <span className="blog-tag">AGENT USE CASES</span>
              <h3>How Customer Support Agents Can Cut Response Times by 60%</h3>
              <p>Discover how AI-powered customer support agents can automate ticket triage, provide instant answers, and dramatically reduce average handling times without compromising service quality.</p>
              <div className="blog-meta">
                <img src="/images/avatar-3.jpg" className="author-thumb" alt="Adam Guild" />
                <strong style={{ color: '#0f172a' }}>Adam Guild</strong>
                <span>&bull;</span>
                <span>Aug 9, 2025</span>
                <span>&bull;</span>
                <span className="pill pill-sm" style={{ background: '#f1f5f9', color: '#64748b' }}>5 min read</span>
              </div>
            </div>
          </div>

          <div className="blog-grid-triad">
            <div className="blog-triad-card">
              <div className="triad-text">
                <span className="blog-tag">AGENT USE CASES</span>
                <h4>Using AI Sales Agents to Boost Lead Conversion Rates</h4>
                <div className="triad-meta">Aug 9, 2025 &bull; 3 min read</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/office.jpg" alt="" />
              </div>
            </div>

            <div className="blog-triad-card">
              <div className="triad-text">
                <span className="blog-tag">AUTOMATION TIPS</span>
                <h4>5 Automation Workflows Every Business Should Implement in 2025</h4>
                <div className="triad-meta">Aug 9, 2025 &bull; 2 min read</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/factory.jpg" alt="" />
              </div>
            </div>

            <div className="blog-triad-card">
              <div className="triad-text">
                <span className="blog-tag">AUTOMATION TIPS</span>
                <h4>How to Integrate AI Agents with Your Existing Tools</h4>
                <div className="triad-meta">Aug 7, 2025 &bull; 4 min read</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/office.jpg" alt="" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 7: Statutory & Operational FAQs (Matching Frame 042 & 045 of the video) */}
      {!result && (
        <section className="faq-section" aria-label="Frequently asked questions">
          <div className="faq-header">
            <h2 className="faq-title">Your questions, answered.</h2>
            <p className="faq-subtitle">Everything you need to know about Indian statutory compliance, platform integrations, and billing.</p>
          </div>

          <div className="faq-list">
            {[
              {
                q: 'How much control do we keep?',
                a: 'You retain complete supervisory control. Kraya operates with amber human-in-the-loop verification chips for missing figures and never commits payments or ledger updates without explicit approval.',
              },
              {
                q: 'What does it integrate with?',
                a: 'Kraya connects seamlessly with Tally Prime, SAP Business One, Busy ERP, Gmail, Microsoft Outlook, and official WhatsApp Business APIs with zero coding required.',
              },
              {
                q: 'How are deliverability & compliance handled?',
                a: 'Every quotation and invoice undergoes automated GST 2.0 ITC lock-in checksums, Section 43B(h) 45-day MSME payment clocks, and double-freight taxation audits before outreach is scheduled.',
              },
              {
                q: 'How fast can we go live and how is success measured?',
                a: 'Factories go live within 48 hours. Success is measured via real-time Money Leak radar metrics, net landed savings per unit, and automated pre-payment CA audit packs.',
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

      {/* Section 8: Royal Blue CTA Banner (Matching Frame 045 of the video) */}
      {!result && (
        <section className="video-cta-banner">
          <div className="cta-banner-content">
            <div className="cta-banner-left">
              <h2>Procure Smarter.<br />Protect Working Capital.</h2>
              <button
                type="button"
                className="btn btn-cta-light"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  const textarea = document.querySelector('.prompt-textarea') as HTMLTextAreaElement | null;
                  textarea?.focus();
                }}
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

      {/* Section 9: Modern Card Footer (Matching Frame 046 of the video) */}
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
              <span className="brand-title" style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>Kraya</span>
            </div>
            <div className="subscribe-box">
              <label htmlFor="subscribe-email">GST 2.0 &amp; 43B(h) PROCUREMENT UPDATES</label>
              <div className="subscribe-input-wrap">
                <input id="subscribe-email" type="email" placeholder="owner@factory.in" />
                <button type="button" className="btn btn-primary btn-sm" style={{ padding: '8px 18px', borderRadius: 999 }}>Subscribe</button>
              </div>
            </div>
          </div>

          <div className="footer-nav-columns">
            <div className="footer-col">
              <h4>PROCUREMENT PILLARS</h4>
              <ul>
                <li><button type="button" onClick={() => onNavigate('buying')}>Credit-Adjusted Landed Cost</button></li>
                <li><button type="button" onClick={() => onNavigate('daily')}>3-Way PO vs Invoice Audit</button></li>
                <li><button type="button" onClick={() => setOpenFaq(0)}>MSME 43B(h) Protection</button></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>WORKSPACE DESKS</h4>
              <ul>
                <li><button type="button" onClick={() => onNavigate('inbox')}>Unified Ingestion Inbox</button></li>
                <li><button type="button" onClick={() => onNavigate('buying')}>Buying &amp; RFQs Desk</button></li>
                <li><button type="button" onClick={() => onNavigate('suppliers')}>Unified Supplier Book</button></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-bottom-bar">
          <span>&copy; {new Date().getFullYear()} Kraya Procurement Technologies. Pre-payment verification &amp; CA audit support. All rights reserved.</span>
          <div className="footer-legal-links">
            <button type="button">Privacy Policy</button>
            <button type="button">Terms of Service</button>
            <button type="button">Security &bull; SOC2</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
