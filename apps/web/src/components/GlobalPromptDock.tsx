import React, { useId, useRef, useState } from 'react';
import {
  Send,
  Paperclip,
  Sparkles,
  ArrowRight,
  X,
  FileText,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  FileSpreadsheet,
  Bot,
  MessageCircle,
} from 'lucide-react';
import { API_BASE, apiJson, formatINR, SummaryStats, UserRole } from '../lib/api';
import {
  buildNextStepsForIngest,
  CfoQaResponseData,
  computeWorkspaceGuidance,
  detectPromptIntent,
  GlobalWorkflowTools,
  GuidedNextStep,
  IngestResponse,
  NavTab,
} from '../lib/workflow';

interface DockResult {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  tone: 'accent' | 'success' | 'warning' | 'danger';
  ingest?: IngestResponse;
  qa?: CfoQaResponseData;
  showExports?: boolean;
  nextSteps: GuidedNextStep[];
}

interface Props {
  activeTab: NavTab;
  summary: SummaryStats | null;
  userRole: UserRole;
  tools: GlobalWorkflowTools;
  prefillPrompt?: { text: string; channel?: string; nonce: number } | null;
}

const TAB_DOCK_CONFIG: Record<
  Exclude<NavTab, 'new_task'>,
  {
    placeholder: string;
    chips: Array<{ label: string; prompt: string; channel?: string }>;
  }
> = {
  inbox: {
    placeholder:
      'Prompt Kraya here: paste a WhatsApp vendor reply, drop a bill PDF, or type "What should I do next?"...',
    chips: [
      {
        label: 'Log WhatsApp Quote',
        prompt: 'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
        channel: 'whatsapp',
      },
      {
        label: 'Audit a Bill',
        prompt:
          'Audit Invoice #INV-412 from Shakti Packaging: 5000 boxes @ ₹26.50 + 5% GST, freight ₹5000 already incl of GST taxed at 18% again, Grand Total ₹145025',
        channel: 'pdf',
      },
      { label: 'What should I do next?', prompt: 'What should I do next?' },
    ],
  },
  buying: {
    placeholder:
      'Type what to buy, paste a vendor quote, or say "Find steel suppliers in Pune", "Import BOM", or "Negotiate my RFQ"...',
    chips: [
      { label: 'Find Verified Vendors', prompt: 'Find corrugated box manufacturers in Pune' },
      { label: 'Import BOM CSV', prompt: 'Import BOM CSV to create multiple RFQs at once' },
      {
        label: 'Log Vendor Quote',
        prompt: 'From: Bharat Packaging. 5000 boxes @ 22 plus gst 5% extra transport 5k, 30 din udhari',
        channel: 'whatsapp',
      },
      { label: 'AI BATNA Negotiate', prompt: 'Negotiate my open RFQ with AI BATNA strategy' },
    ],
  },
  daily: {
    placeholder:
      'Drop an invoice to audit, schedule an AMC, or type "Run autonomous sweep", "Reconcile GSTR-2B", or "Export Tally"...',
    chips: [
      { label: 'Run Expeditor Sweep', prompt: 'Run autonomous expeditor sweep for overdue deliveries and 43B(h) deadlines' },
      { label: 'Reconcile GSTR-2B', prompt: 'Reconcile GSTR-2B and GST IMS portal return against our bills' },
      { label: 'Export Tally / Zoho', prompt: 'Export Tally Prime XML, Zoho Books CSV, and CA GST Audit Pack' },
      {
        label: 'Schedule AMC',
        prompt: 'Track 125 kVA DG generator quarterly AMC & hydraulic oil spares due this month',
      },
    ],
  },
  suppliers: {
    placeholder:
      'Type "Find packaging suppliers in Bengaluru" to discover live GST-verified vendors, or create an RFQ...',
    chips: [
      { label: 'Live AI Sourcing', prompt: 'Find industrial packaging suppliers in Pune with GSTIN' },
      {
        label: 'Create RFQ for Vendors',
        prompt: 'Send RFQ to 4 vendors for 5,000 5-ply corrugated boxes (HSN 4819), delivery within 10 days',
      },
      { label: 'What should I do next?', prompt: 'What should I do next?' },
    ],
  },
};

export function GlobalPromptDock({ activeTab, summary, userRole, tools, prefillPrompt }: Props) {
  const inputId = useId();
  const isCaReadOnly = userRole === 'ca';
  const [prompt, setPrompt] = useState('');
  const [channel, setChannel] = useState('manual');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dockResult, setDockResult] = useState<DockResult | null>(null);
  const [qaHistory, setQaHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string; topic?: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (prefillPrompt?.text) {
      setPrompt(prefillPrompt.text);
      if (prefillPrompt.channel) setChannel(prefillPrompt.channel);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [prefillPrompt]);

  if (activeTab === 'new_task') return null;

  const config = TAB_DOCK_CONFIG[activeTab];
  const liveIntent = prompt.trim() || attachedFile ? detectPromptIntent(prompt, Boolean(attachedFile)) : null;

  const runPromptText = async (overrideText?: string, overrideChannel?: string) => {
    const raw = (overrideText ?? prompt).trim();
    const useChannel = overrideChannel ?? channel;
    if (!raw && !attachedFile) return;

    setRunning(true);
    setError(null);
    const intent = detectPromptIntent(raw, Boolean(attachedFile));

    try {
      if (intent.kind === 'discover_suppliers') {
        tools.onOpenDiscover(intent.extractedQuery || raw);
        setPrompt('');
        setDockResult({
          id: `res-${Date.now()}`,
          title: 'Live AI Supplier Sourcing Opened',
          subtitle: `Searching GST-verified suppliers for "${intent.extractedQuery || raw}". Save your best matches, then create an RFQ or log quotes.`,
          badge: 'STEP 1 · SOURCING',
          tone: 'accent',
          nextSteps: [
            {
              id: 'after-src-rfq',
              label: 'Create RFQ for Sourced Vendors',
              hint: 'Float structured inquiry',
              kind: 'prefill_prompt',
              prompt:
                'Send RFQ to 4 vendors for 5,000 5-ply corrugated boxes (HSN 4819), delivery within 10 days',
            },
            {
              id: 'after-src-dir',
              label: 'View My Suppliers',
              hint: 'Inspect GSTIN & credit terms',
              kind: 'navigate',
              tab: 'suppliers',
            },
          ],
        });
        return;
      }

      if (intent.kind === 'bulk_bom') {
        tools.onOpenBomImport(intent.extractedQuery || '');
        setPrompt('');
        return;
      }

      if (intent.kind === 'gstr2b_reconcile') {
        tools.onOpenGstr2b();
        setPrompt('');
        return;
      }

      if (intent.kind === 'negotiate_rfq') {
        const res = await tools.onOpenNegotiation();
        setPrompt('');
        if (!res.ok) {
          setDockResult({
            id: `res-${Date.now()}`,
            title: 'Add 2+ Quotes to Unlock AI BATNA Negotiation',
            subtitle:
              res.message ||
              'Multi-quote negotiation compares at least 2 supplier quotes on the same RFQ to compute leverage and counter-offer targets.',
            badge: 'STEP 2 → STEP 3',
            tone: 'warning',
            nextSteps: [
              {
                id: 'neg-log-q',
                label: 'Log a Vendor Quote Now',
                hint: 'Paste WhatsApp or phone quote',
                primary: true,
                kind: 'prefill_prompt',
                prompt:
                  'From: Shakti Packaging. 5000 boxes @ ₹24 flat cash on delivery, 5% GST incl, Monday dispatch',
                channel: 'whatsapp',
              },
              {
                id: 'neg-go-buying',
                label: 'Open Buying & RFQs',
                hint: 'Review open RFQs & quotes',
                kind: 'navigate',
                tab: 'buying',
              },
            ],
          });
        }
        return;
      }

      if (intent.kind === 'autonomous_sweep') {
        if (isCaReadOnly) {
          setError('CA / Auditor role is read-only. Ask an Owner or Purchase Clerk to run the Autonomous Expeditor Sweep.');
          return;
        }
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
        tools.onDataMutated();
        setPrompt('');
        setDockResult({
          id: `res-${Date.now()}`,
          title: `Autonomous Expeditor Sweep Complete (${res.createdTasksCount} New Task${res.createdTasksCount === 1 ? '' : 's'})`,
          subtitle: `Scanned workspace: ${res.summary.staleRfqsFound} stale RFQs · ${res.summary.overdueDeliveriesFound} overdue deliveries · ${res.summary.msmeCliffsFound} MSME 43B(h) cliffs · ${res.summary.amcsDueFound} AMCs due · ${res.summary.incompleteKycSuppliers} incomplete KYC vendors.`,
          badge: 'STEP 4 · AUTOPILOT',
          tone: 'success',
          nextSteps: [
            {
              id: 'sw-daily',
              label: 'Review Follow-Up Queue',
              hint: 'Send 1-click WhatsApp nudges',
              primary: true,
              kind: 'navigate',
              tab: 'daily',
            },
            {
              id: 'sw-gstr2b',
              label: 'Reconcile GSTR-2B / IMS',
              hint: 'Verify GST ITC eligibility',
              kind: 'gstr2b',
            },
          ],
        });
        return;
      }

      if (intent.kind === 'export_accounting') {
        setPrompt('');
        setDockResult({
          id: `res-${Date.now()}`,
          title: 'Accounting & CA Audit Exports Ready',
          subtitle:
            'Download deterministic, GST 2.0-verified purchase vouchers for Tally Prime, Zoho Books, or your Chartered Accountant.',
          badge: 'STEP 5 · ERP EXPORT',
          tone: 'success',
          showExports: true,
          nextSteps: [
            {
              id: 'exp-2b',
              label: 'Run GSTR-2B / IMS Check First',
              hint: 'Ensure 100% portal ITC match',
              kind: 'gstr2b',
            },
          ],
        });
        return;
      }

      if (intent.kind === 'guide_me') {
        const g = computeWorkspaceGuidance(summary);
        setPrompt('');
        setDockResult({
          id: `res-${Date.now()}`,
          title: g.headline,
          subtitle: g.subtext,
          badge: 'LIVE WORKFLOW GUIDE',
          tone: 'accent',
          nextSteps: [
            {
              id: 'guide-cta',
              label: g.ctaLabel,
              hint: 'Recommended next action',
              primary: true,
              kind: 'prefill_prompt',
              prompt: g.ctaPrompt,
            },
            {
              id: 'guide-tab',
              label: 'Open Recommended View',
              hint: 'Jump straight to workspace section',
              kind: 'navigate',
              tab: g.ctaTab,
            },
          ],
        });
        return;
      }

      if (intent.kind === 'ask_cfo') {
        const res = await apiJson<{ runId: string; qa: CfoQaResponseData }>('/api/agents/ask', {
          method: 'POST',
          body: JSON.stringify({
            question: raw,
            conversationHistory: qaHistory.slice(-6),
          }),
        });
        setQaHistory((prev) => [
          ...prev,
          { role: 'user', text: raw, topic: res.qa.topic },
          { role: 'assistant', text: res.qa.directAnswer, topic: res.qa.topic },
        ]);
        setPrompt('');
        setDockResult({
          id: `res-${Date.now()}`,
          title: res.qa.headline,
          subtitle: res.qa.directAnswer,
          badge: res.qa.isCrossQuestion
            ? `CROSS-QUESTION · ${res.qa.topic.replace(/_/g, ' ').toUpperCase()}`
            : `CFO Q&A · ${res.qa.topic.replace(/_/g, ' ').toUpperCase()}`,
          tone: 'accent',
          qa: res.qa,
          nextSteps: [],
        });
        return;
      }

      if (isCaReadOnly) {
        setError('CA / Auditor role is read-only. You can still run "Reconcile GSTR-2B", "Export Tally", or "What should I do next?".');
        return;
      }

      // Standard multimodal / text prompt ingestion
      let data: IngestResponse;
      if (attachedFile) {
        const fd = new FormData();
        fd.append('prompt', raw);
        fd.append('channel', useChannel);
        fd.append('file', attachedFile);
        data = await apiJson<IngestResponse>('/api/prompt/ingest', { method: 'POST', body: fd });
      } else {
        data = await apiJson<IngestResponse>('/api/prompt/ingest', {
          method: 'POST',
          body: JSON.stringify({ prompt: raw, channel: useChannel }),
        });
      }

      const nextInfo = buildNextStepsForIngest(data);
      tools.onDataMutated();
      setPrompt('');
      setAttachedFile(null);
      setDockResult({
        id: `res-${Date.now()}`,
        title: data.sourceEvent.parsedSummary,
        subtitle: nextInfo.nextStepLabel,
        badge: `STEP ${nextInfo.completedStep} DONE`,
        tone: data.created.audit?.totalMoneyLeakPaise ? 'danger' : 'success',
        ingest: data,
        nextSteps: nextInfo.steps,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run prompt.');
    } finally {
      setRunning(false);
    }
  };

  const handleNextStepClick = async (step: GuidedNextStep) => {
    if (step.kind === 'navigate' && step.tab) {
      tools.onNavigate(step.tab);
      return;
    }
    if (step.kind === 'discover') {
      tools.onOpenDiscover(step.query || '');
      return;
    }
    if (step.kind === 'gstr2b') {
      tools.onOpenGstr2b();
      return;
    }
    if (step.kind === 'negotiate') {
      await runPromptText('Negotiate my open RFQ with AI BATNA strategy', 'manual');
      return;
    }
    if (step.kind === 'sweep') {
      await runPromptText('Run autonomous expeditor sweep for overdue deliveries and 43B(h) deadlines', 'manual');
      return;
    }
    if (step.kind === 'outreach' && step.outreach) {
      tools.onOpenOutreach(step.outreach);
      return;
    }
    if (step.kind === 'prefill_prompt' && step.prompt) {
      setPrompt(step.prompt);
      if (step.channel) setChannel(step.channel);
      inputRef.current?.focus();
    }
  };

  const handleVerify = async (eventId: string) => {
    await apiJson(`/api/inbox/${eventId}/verify`, { method: 'PATCH' });
    setDockResult((prev) =>
      prev?.ingest && prev.ingest.sourceEvent.id === eventId
        ? {
            ...prev,
            ingest: {
              ...prev.ingest,
              sourceEvent: { ...prev.ingest.sourceEvent, needsVerification: false },
            },
          }
        : prev
    );
    tools.onDataMutated();
  };

  return (
    <div className="global-prompt-dock">
      <form
        className="dock-form"
        onSubmit={(e) => {
          e.preventDefault();
          runPromptText();
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Ask Kraya or enter a procurement prompt
        </label>
        <div className="dock-input-row">
          <Sparkles size={15} className="dock-lead-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className="dock-text-input"
            placeholder={config.placeholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                runPromptText();
              }
            }}
          />

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.mp3,.wav,.ogg,.webm,.m4a"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              if (f) setAttachedFile(f);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            className="btn btn-sm"
            disabled={isCaReadOnly}
            onClick={() => fileRef.current?.click()}
            title="Attach bill PDF, WhatsApp screenshot, or audio note"
          >
            <Paperclip size={13} aria-hidden="true" />
            <span className="dock-btn-label">Attach</span>
          </button>

          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={running || (!prompt.trim() && !attachedFile)}
          >
            <Send size={13} aria-hidden="true" />
            <span>{running ? 'Running...' : 'Run'}</span>
          </button>
        </div>

        {attachedFile && (
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <span className="pill pill-accent">
              <FileText size={12} aria-hidden="true" />
              {attachedFile.name}
              <button
                type="button"
                aria-label={`Remove ${attachedFile.name}`}
                onClick={() => setAttachedFile(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'inline-flex', padding: 0 }}
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}

        <div className="dock-meta-row">
          {liveIntent ? (
            <div className="dock-intent-preview" aria-live="polite">
              <Bot size={13} aria-hidden="true" />
              <strong>{liveIntent.actionLabel}:</strong>
              <span>{liveIntent.detail}</span>
            </div>
          ) : (
            <div className="dock-chips-row" role="group" aria-label="Quick guided prompts">
              <span className="dock-chips-label">Try:</span>
              {config.chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="dock-chip-btn"
                  onClick={() => {
                    setPrompt(chip.prompt);
                    if (chip.channel) setChannel(chip.channel);
                    inputRef.current?.focus();
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="alert-banner alert-danger" role="alert" style={{ marginTop: 10 }}>
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={12} />
          </button>
        </div>
      )}

      {dockResult && (
        <div className={`dock-result-card tone-${dockResult.tone}`} aria-live="polite">
          <div className="dock-result-header">
            <div className="row" style={{ gap: 8 }}>
              <span className="pill pill-accent">{dockResult.badge}</span>
              <strong style={{ fontSize: 13.5 }}>{dockResult.title}</strong>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {dockResult.ingest?.sourceEvent.needsVerification && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                  onClick={() => handleVerify(dockResult.ingest!.sourceEvent.id)}
                >
                  <AlertTriangle size={12} /> Confirm Figures
                </button>
              )}
              {dockResult.ingest && !dockResult.ingest.sourceEvent.needsVerification && (
                <span className="pill pill-success">
                  <CheckCircle2 size={12} /> Verified
                </span>
              )}
              <button
                type="button"
                className="btn btn-sm"
                aria-label="Close prompt result"
                onClick={() => setDockResult(null)}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          <div className="dock-result-sub">{dockResult.subtitle}</div>

          {dockResult.ingest?.created.audit && (
            <div className="dock-audit-strip">
              <strong>{dockResult.ingest.created.audit.cfoVerdict}</strong>
              {dockResult.ingest.created.audit.totalMoneyLeakPaise > 0 && (
                <span className="pill pill-critical mono">
                  Leak: {formatINR(dockResult.ingest.created.audit.totalMoneyLeakPaise)}
                </span>
              )}
            </div>
          )}

          {dockResult.ingest?.created.quote && (
            <div className="dock-audit-strip mono">
              <span>
                Net Landed: <strong>{formatINR(dockResult.ingest.created.quote.netLandedUnitPaise)}</strong> · Credit-Adjusted:{' '}
                <strong style={{ color: 'var(--accent)' }}>
                  {formatINR(dockResult.ingest.created.quote.creditAdjustedUnitPaise)}
                </strong>
              </span>
            </div>
          )}

          {dockResult.qa && (
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {dockResult.qa.mathProof.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
                  {dockResult.qa.mathProof.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: m.highlight ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        border: m.highlight ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{m.label}</div>
                      <div className="mono" style={{ fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>
                        {m.value}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{m.formula}</div>
                    </div>
                  ))}
                </div>
              )}

              {dockResult.qa.pncMatrix.length > 0 && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-subtle)', fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Permutations &amp; Combinations (PnC) Matrix:</div>
                  <div className="stack" style={{ gap: 4 }}>
                    {dockResult.qa.pncMatrix.map((row, idx) => (
                      <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <strong>{row.condition}:</strong>
                        <span>{row.outcome}</span>
                        <span className="pill" style={{ fontSize: 10.5 }}>{row.impact}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dockResult.qa.suggestedCrossQuestions.length > 0 && (
                <div className="dock-next-steps" style={{ flexWrap: 'wrap' }}>
                  <span className="dock-next-label">Cross-Question CFO:</span>
                  {dockResult.qa.suggestedCrossQuestions.map((cq, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`btn btn-sm ${idx === 0 ? 'btn-primary' : ''}`}
                      onClick={() => runPromptText(cq, 'manual')}
                    >
                      <span>{cq}</span>
                      <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {dockResult.showExports && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <a href={`${API_BASE}/api/exports/tally.xml`} className="btn btn-primary btn-sm" target="_blank" rel="noreferrer">
                <FileCode2 size={13} /> Download Tally Prime XML
              </a>
              <a href={`${API_BASE}/api/exports/zoho-books.csv`} className="btn btn-sm" target="_blank" rel="noreferrer">
                <FileSpreadsheet size={13} /> Download Zoho Books CSV
              </a>
              <a href={`${API_BASE}/api/exports/ca-audit-pack.xlsx`} className="btn btn-sm" target="_blank" rel="noreferrer">
                <FileSpreadsheet size={13} /> Download CA GST IMS Pack (.xlsx)
              </a>
            </div>
          )}

          {dockResult.nextSteps.length > 0 && (
            <div className="dock-next-steps">
              <span className="dock-next-label">Up next:</span>
              {dockResult.nextSteps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={`btn btn-sm ${step.primary ? 'btn-primary' : ''}`}
                  onClick={() => handleNextStepClick(step)}
                >
                  {step.kind === 'outreach' && <MessageCircle size={12} aria-hidden="true" />}
                  <span>{step.label}</span>
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
