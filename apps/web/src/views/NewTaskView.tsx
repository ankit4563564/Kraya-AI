import React, { useEffect, useId, useRef, useState } from 'react';
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
  FileText,
  X,
  ShieldCheck,
  Check,
  Bot,
  FileCode2,
  FileSpreadsheet,
  RotateCcw,
  ShoppingBag,
  CalendarCheck,
  Users,
  Inbox,
  TrendingDown,
  Clock,
} from 'lucide-react';
import {
  API_BASE,
  apiJson,
  formatINR,
  SummaryStats,
  UserRole,
} from '../lib/api';
import { OutreachModalRequest } from '../components/OutreachModal';
import {
  buildNextStepsForIngest,
  CfoQaResponseData,
  computeWorkspaceGuidance,
  detectPromptIntent,
  GlobalWorkflowTools,
  GuidedNextStep,
  IngestResponse,
  NavTab,
  WORKFLOW_STAGES,
  WorkflowStageId,
} from '../lib/workflow';

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

interface SessionCard {
  id: string;
  userPrompt: string;
  completedStep: 1 | 2 | 3 | 4 | 5;
  badge: string;
  title: string;
  nextStepLabel: string;
  tone: 'accent' | 'success' | 'warning' | 'danger';
  ingest?: IngestResponse;
  qa?: CfoQaResponseData;
  showExports?: boolean;
  nextSteps: GuidedNextStep[];
}

interface Props {
  summary: SummaryStats | null;
  userRole: UserRole;
  onDataMutated: () => void;
  onNavigate: (tab: NavTab) => void;
  onOpenOutreach: (req: OutreachModalRequest) => void;
  tools: GlobalWorkflowTools;
  prefillPrompt?: { text: string; channel?: string; stageId?: WorkflowStageId; nonce: number } | null;
}

export function NewTaskView({
  summary,
  userRole,
  onDataMutated,
  onNavigate,
  onOpenOutreach,
  tools,
  prefillPrompt,
}: Props) {
  const promptFieldId = useId();
  const isCaReadOnly = userRole === 'ca';
  const guidance = computeWorkspaceGuidance(summary);
  const [prompt, setPrompt] = useState('');
  const [channel, setChannel] = useState('manual');
  const [selectedStageId, setSelectedStageId] = useState<WorkflowStageId>(guidance.recommendedStage);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionCards, setSessionCards] = useState<SessionCard[]>([]);
  const [qaHistory, setQaHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string; topic?: string }>>([]);
  const [leaks, setLeaks] = useState<LeakRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const activeStageDef =
    WORKFLOW_STAGES.find((s) => s.id === selectedStageId) ?? WORKFLOW_STAGES[0];
  const liveIntent =
    prompt.trim() || attachedFiles.length > 0
      ? detectPromptIntent(prompt, attachedFiles.length > 0)
      : null;

  useEffect(() => {
    if (prefillPrompt?.text) {
      setPrompt(prefillPrompt.text);
      if (prefillPrompt.channel) setChannel(prefillPrompt.channel);
      if (prefillPrompt.stageId) setSelectedStageId(prefillPrompt.stageId);
      setTimeout(() => {
        const el = document.querySelector('.studio-composer-container');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textareaRef.current?.focus();
      }, 80);
    }
  }, [prefillPrompt]);

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
      setError('Microphone access blocked or unavailable. You can also attach any recorded audio file via + Attach.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const focusPromptInput = () => {
    const el = document.querySelector('.studio-composer-container');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 150);
  };

  const executePrompt = async (overridePrompt?: string, overrideChannel?: string) => {
    const rawPrompt = (overridePrompt ?? prompt).trim();
    const effectiveChannel = overrideChannel ?? channel;
    if (!rawPrompt && attachedFiles.length === 0) return;

    setSubmitting(true);
    setError(null);
    setBatchProgress(null);

    const intent = detectPromptIntent(rawPrompt, attachedFiles.length > 0);
    setSelectedStageId(intent.stageId);

    try {
      if (intent.kind === 'discover_suppliers') {
        tools.onOpenDiscover(intent.extractedQuery || rawPrompt);
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: 1,
            badge: 'STEP 1 · SUPPLIER SOURCING',
            title: `Searching verified suppliers for "${intent.extractedQuery || rawPrompt}"`,
            nextStepLabel: 'Sourcing view opened. Save suppliers to your directory or float an RFQ.',
            tone: 'accent',
            nextSteps: [
              {
                id: 'src-next-rfq',
                label: 'Create RFQ for Sourced Vendors',
                hint: 'Float structured inquiry',
                primary: true,
                kind: 'prefill_prompt',
                prompt: WORKFLOW_STAGES[0].defaultPrompt,
                channel: 'manual',
              },
              {
                id: 'src-next-quote',
                label: 'Log Received Quote',
                hint: 'Compute WACC landed cost',
                kind: 'prefill_prompt',
                prompt: WORKFLOW_STAGES[1].defaultPrompt,
                channel: 'whatsapp',
              },
              {
                id: 'src-next-dir',
                label: 'Open Suppliers Directory',
                hint: 'Review saved suppliers',
                kind: 'navigate',
                tab: 'suppliers',
              },
            ],
          },
          ...prev,
        ]);
        setPrompt('');
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
          setSessionCards((prev) => [
            {
              id: `card-${Date.now()}`,
              userPrompt: rawPrompt,
              completedStep: 2,
              badge: 'STEP 2 → STEP 3 REQUIREMENT',
              title: 'Log at least 2 quotes on an RFQ to run AI BATNA Negotiation',
              nextStepLabel:
                res.message ||
                'Kraya compares multiple quotes on the same RFQ to compute spread, BATNA leverage, and counter-offer targets.',
              tone: 'warning',
              nextSteps: [
                {
                  id: 'neg-prefill-q',
                  label: 'Log a Second Quote Now',
                  hint: 'Paste quote from WhatsApp/email',
                  primary: true,
                  kind: 'prefill_prompt',
                  prompt:
                    'From: Shakti Packaging. 5000 boxes @ ₹24 flat cash on delivery, 5% GST incl, Monday dispatch',
                  channel: 'whatsapp',
                },
                {
                  id: 'neg-open-buying',
                  label: 'Open Buying & RFQs',
                  hint: 'View existing RFQs',
                  kind: 'navigate',
                  tab: 'buying',
                },
              ],
            },
            ...prev,
          ]);
        }
        return;
      }

      if (intent.kind === 'autonomous_sweep') {
        if (isCaReadOnly) {
          setError('CA / Auditor role is read-only. Ask an Owner or Purchaser to run the Expeditor Sweep.');
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
        onDataMutated();
        setPrompt('');
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: 4,
            badge: 'STEP 4 · EXPEDITOR SWEEP',
            title: `Expeditor Sweep Complete — ${res.createdTasksCount} action item${res.createdTasksCount === 1 ? '' : 's'} queued`,
            nextStepLabel: `Identified ${res.summary.staleRfqsFound} stale RFQs · ${res.summary.overdueDeliveriesFound} overdue POs · ${res.summary.msmeCliffsFound} MSME 43B(h) payment cliffs · ${res.summary.amcsDueFound} due AMCs.`,
            tone: 'success',
            nextSteps: [
              {
                id: 'sw-open-daily',
                label: 'Open Daily Queue',
                hint: 'Send vendor reminders',
                primary: true,
                kind: 'navigate',
                tab: 'daily',
              },
              {
                id: 'sw-step5-audit',
                label: 'Audit Supplier Invoice',
                hint: 'Reconcile bills against POs',
                kind: 'prefill_prompt',
                prompt: WORKFLOW_STAGES[4].defaultPrompt,
                channel: 'pdf',
              },
            ],
          },
          ...prev,
        ]);
        return;
      }

      if (intent.kind === 'export_accounting') {
        setPrompt('');
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: 5,
            badge: 'STEP 5 · ERP & CA EXPORTS',
            title: 'Accounting Vouchers & CA GST Audit Pack Ready',
            nextStepLabel: 'Export verified purchase vouchers directly to Tally Prime XML, Zoho Books CSV, or CA Audit Pack.',
            tone: 'success',
            showExports: true,
            nextSteps: [
              {
                id: 'exp-check-2b',
                label: 'Reconcile GSTR-2B / IMS First',
                hint: 'Confirm portal ITC match',
                kind: 'gstr2b',
              },
              {
                id: 'exp-open-daily',
                label: 'Open Audit Register',
                hint: 'View all audited bills',
                kind: 'navigate',
                tab: 'daily',
              },
            ],
          },
          ...prev,
        ]);
        return;
      }

      if (intent.kind === 'guide_me') {
        const g = computeWorkspaceGuidance(summary);
        setPrompt('');
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: WORKFLOW_STAGES.find((s) => s.id === g.recommendedStage)?.stepNumber ?? 1,
            badge: 'WORKFLOW RECOMMENDATION',
            title: g.headline,
            nextStepLabel: g.subtext,
            tone: 'accent',
            nextSteps: [
              {
                id: 'guide-run',
                label: g.ctaLabel,
                hint: 'Pre-fill recommended prompt',
                primary: true,
                kind: 'prefill_prompt',
                prompt: g.ctaPrompt,
              },
              {
                id: 'guide-nav',
                label: 'Jump to Recommended Section',
                hint: 'Open workspace tab',
                kind: 'navigate',
                tab: g.ctaTab,
              },
            ],
          },
          ...prev,
        ]);
        return;
      }

      if (intent.kind === 'ask_cfo') {
        const res = await apiJson<{ runId: string; qa: CfoQaResponseData }>('/api/agents/ask', {
          method: 'POST',
          body: JSON.stringify({
            question: rawPrompt,
            conversationHistory: qaHistory.slice(-6),
          }),
        });
        setQaHistory((prev) => [
          ...prev,
          { role: 'user', text: rawPrompt, topic: res.qa.topic },
          { role: 'assistant', text: res.qa.directAnswer, topic: res.qa.topic },
        ]);
        setPrompt('');
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: 3,
            badge: res.qa.isCrossQuestion
              ? `CROSS-QUESTION · ${res.qa.topic.replace(/_/g, ' ').toUpperCase()}`
              : `CFO Q&A · ${res.qa.topic.replace(/_/g, ' ').toUpperCase()}`,
            title: res.qa.headline,
            nextStepLabel: res.qa.directAnswer,
            tone: 'accent',
            qa: res.qa,
            nextSteps: [],
          },
          ...prev,
        ]);
        return;
      }

      if (isCaReadOnly) {
        setError('CA / Auditor role is read-only. You can still run "Reconcile GSTR-2B", "Export Tally XML", or "What should I do next?".');
        return;
      }

      // Standard multimodal / text prompt ingestion
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
          fd.append('prompt', rawPrompt);
          fd.append('channel', effectiveChannel);
          fd.append('file', f);
          lastData = await apiJson<IngestResponse>('/api/prompt/ingest', {
            method: 'POST',
            body: fd,
          });
        }
      } else {
        lastData = await apiJson<IngestResponse>('/api/prompt/ingest', {
          method: 'POST',
          body: JSON.stringify({ prompt: rawPrompt, channel: effectiveChannel }),
        });
      }

      if (lastData) {
        const nextInfo = buildNextStepsForIngest(lastData);
        const nextStageMap: Record<number, WorkflowStageId> = {
          1: 'collect_quotes',
          2: 'negotiate_po',
          3: 'receive_track',
          4: 'audit_settle',
          5: 'audit_settle',
        };
        setSelectedStageId(nextStageMap[nextInfo.completedStep] || 'source_rfq');
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt || attachedFiles.map((f) => f.name).join(', '),
            completedStep: nextInfo.completedStep,
            badge: `STEP ${nextInfo.completedStep} COMPLETE`,
            title: lastData.sourceEvent.parsedSummary,
            nextStepLabel: nextInfo.nextStepLabel,
            tone: lastData.created.audit?.totalMoneyLeakPaise ? 'danger' : 'success',
            ingest: lastData,
            nextSteps: nextInfo.steps,
          },
          ...prev,
        ]);
      }
      setPrompt('');
      setAttachedFiles([]);
      loadLeaks();
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setSubmitting(false);
      setBatchProgress(null);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await executePrompt();
  };

  const handleGuidedNextStep = async (step: GuidedNextStep) => {
    if (step.kind === 'navigate' && step.tab) {
      onNavigate(step.tab);
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
      await executePrompt('Negotiate my open RFQ with AI BATNA strategy', 'manual');
      return;
    }
    if (step.kind === 'sweep') {
      await executePrompt('Run autonomous expeditor sweep for overdue deliveries and 43B(h) deadlines', 'manual');
      return;
    }
    if (step.kind === 'outreach' && step.outreach) {
      onOpenOutreach(step.outreach);
      return;
    }
    if (step.kind === 'prefill_prompt' && step.prompt) {
      setPrompt(step.prompt);
      if (step.channel) setChannel(step.channel);
      const nextIntent = detectPromptIntent(step.prompt, false);
      setSelectedStageId(nextIntent.stageId);
      focusPromptInput();
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
    setSessionCards((prev) =>
      prev.map((card) =>
        card.ingest?.sourceEvent.id === eventId
          ? {
              ...card,
              ingest: {
                ...card.ingest,
                sourceEvent: { ...card.ingest.sourceEvent, needsVerification: false },
                extracted: { ...card.ingest.extracted, needsVerification: false },
              },
            }
          : card
      )
    );
    onDataMutated();
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      {/* 1. Executive Metrics & Workstation Health Bar */}
      <div className="grid-4">
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Protected Spend</span>
            <ShieldCheck size={14} style={{ color: 'var(--success)' }} />
          </div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {formatINR(summary?.totalProtectedPaise ?? 0, 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Leaks caught pre-payment
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Open RFQs</span>
            <ShoppingBag size={14} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {summary?.openRfqsCount ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Active sourcing cycles
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Audited Invoices</span>
            <CalendarCheck size={14} style={{ color: 'var(--info)' }} />
          </div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {summary?.invoicesAuditedCount ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            3-way matched against POs
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Monitored Suppliers</span>
            <Users size={14} style={{ color: 'var(--warning)' }} />
          </div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {summary?.suppliersCount ?? 0}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            GSTN &amp; MSME tracked
          </div>
        </div>
      </div>

      {/* 2. Studio Command Center Composer */}
      <div className="studio-composer-container">
        {isCaReadOnly && (
          <div className="alert-banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'var(--warning-border)', marginBottom: 16 }}>
            <span>
              You are signed in with the <strong>CA / Auditor (Read-Only)</strong> role. Modifying records is disabled. You can inspect all quotes, invoices, and run GSTR-2B or ERP exports.
            </span>
          </div>
        )}

        <div className="guided-studio-header">
          <div className="guided-studio-title-row">
            <span className="pill pill-accent" style={{ fontSize: 11.5 }}>
              <Sparkles size={11} aria-hidden="true" />
              Procurement Intelligence Studio
            </span>
            <span className="guided-studio-next-cue">
              {guidance.headline}
            </span>
          </div>

          <ol className="studio-step-pills" aria-label="Procurement lifecycle stages">
            {WORKFLOW_STAGES.map((stage) => {
              const isSelected = selectedStageId === stage.id;
              const isRec = guidance.recommendedStage === stage.id;
              const status = guidance.stageStatus[stage.id];
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    className={`studio-step-pill ${isSelected ? 'is-selected' : ''} ${isRec ? 'is-recommended' : ''}`}
                    aria-current={isSelected ? 'step' : undefined}
                    onClick={() => {
                      setSelectedStageId(stage.id);
                      setChannel(stage.channel);
                    }}
                  >
                    <span className="studio-step-dot" aria-hidden="true">
                      {status === 'completed' ? <Check size={10} strokeWidth={3} /> : stage.stepNumber}
                    </span>
                    <span>{stage.shortTitle}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="studio-stage-explainer">
            <div>
              <strong>{activeStageDef.title}:</strong> {activeStageDef.oneLiner}
            </div>
            <span className="studio-stage-next-arrow">{activeStageDef.nextStageHint}</span>
          </div>
        </div>

        <form className="prompt-card" onSubmit={handleSubmit}>
          <label htmlFor={promptFieldId} className="visually-hidden">
            Describe what to buy, paste vendor quote, or drop bill
          </label>
          <textarea
            ref={textareaRef}
            id={promptFieldId}
            className="prompt-textarea"
            placeholder={
              isCaReadOnly
                ? 'Auditor mode: e.g. "Reconcile GSTR-2B", "Export Tally XML", or "What should I do next?"'
                : `${activeStageDef.oneLiner} (Press Enter to execute, Shift+Enter for new line)`
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                handleSubmit();
              } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {liveIntent && (
            <div className="live-intent-banner" aria-live="polite">
              <Bot size={13} aria-hidden="true" />
              <strong>{liveIntent.actionLabel}</strong>
              <span>— {liveIntent.detail}</span>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
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
                <Paperclip size={13} />
                Attach File
              </button>

              <button
                type="button"
                className={`btn btn-sm ${recording ? 'btn-danger' : ''}`}
                disabled={isCaReadOnly}
                onClick={recording ? stopRecording : startRecording}
              >
                {recording ? <Square size={12} /> : <Mic size={13} />}
                {recording ? 'Stop Recording' : 'Voice Note'}
              </button>

              <select
                aria-label="Source Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="manual">Channel: Prompt</option>
                <option value="whatsapp">Channel: WhatsApp</option>
                <option value="email">Channel: Email</option>
                <option value="phone">Channel: Phone Call</option>
                <option value="pdf">Channel: PDF / Bill</option>
              </select>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || (!prompt.trim() && attachedFiles.length === 0)}
            >
              <Send size={13} />
              {submitting ? batchProgress || 'Executing...' : 'Execute'}
            </button>
          </div>
        </form>

        {/* Contextual Workflow Chips */}
        <div className="starter-tabs" role="group" aria-label="Suggested procurement actions" style={{ marginTop: 12 }}>
          {activeStageDef.examples.map((ex) => (
            <button
              key={ex.id}
              type="button"
              className={`starter-tab ${prompt === ex.prompt ? 'active' : ''}`}
              onClick={() => {
                setPrompt(ex.prompt);
                setChannel(ex.channel);
                textareaRef.current?.focus();
              }}
            >
              <span>{ex.label}</span>
              {ex.badge && <span className="starter-mini-badge">{ex.badge}</span>}
            </button>
          ))}
          <button
            type="button"
            className="starter-tab"
            onClick={() =>
              executePrompt(
                'Why is Bharat Packaging ranked #1 even though they charge ₹5,000 extra for transport?',
                'manual'
              )
            }
          >
            <Bot size={12} aria-hidden="true" />
            <span>Ask CFO (PnC Analysis)</span>
          </button>
          <button
            type="button"
            className="starter-tab"
            onClick={() => executePrompt('What should I do next?', 'manual')}
          >
            <Bot size={12} aria-hidden="true" />
            <span>What should I do next?</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner" role="alert" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-border)', color: 'var(--danger)', maxWidth: 960, margin: '0 auto' }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* 3. Session Results Stream */}
      {sessionCards.length > 0 && (
        <div className="stack" style={{ maxWidth: 960, margin: '0 auto', gap: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill pill-accent">Active Session ({sessionCards.length})</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Deterministic audit results and guided execution
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSessionCards([])}
            >
              <RotateCcw size={12} aria-hidden="true" /> Clear Results
            </button>
          </div>

          {sessionCards.map((card) => {
            const ingest = card.ingest;
            return (
              <div key={card.id} className="card stack guided-result-card">
                <div className="guided-prompt-echo">
                  <span className="pill" style={{ fontSize: 10.5 }}>Input</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{card.userPrompt}</span>
                </div>

                <div className="card-header" style={{ marginBottom: 0 }}>
                  <div>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <span className={`pill ${card.tone === 'danger' ? 'pill-critical' : card.tone === 'warning' ? 'pill-warning' : card.tone === 'success' ? 'pill-success' : 'pill-accent'}`}>
                        {card.badge}
                      </span>
                      {ingest && (
                        <>
                          <span className="pill">
                            {ingest.intake.pillar.replace('_', ' ').toUpperCase()}
                          </span>
                          <span className="pill">
                            Parser: {ingest.extracted.engine === 'gemini_live' ? 'Multimodal LLM' : 'Deterministic'}
                          </span>
                          {ingest.intake.detectedPromptInjection && (
                            <span className="pill pill-critical">
                              <ShieldAlert size={12} /> Prompt Injection Neutralized
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <h2 className="card-title">{card.title}</h2>
                  </div>

                  {ingest &&
                    (ingest.sourceEvent.needsVerification ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'var(--warning-border)' }}
                        onClick={() => handleVerifyEvent(ingest.sourceEvent.id)}
                      >
                        <AlertTriangle size={13} />
                        Confirm Extracted Figures
                      </button>
                    ) : (
                      <span className="pill pill-success">
                        <CheckCircle2 size={12} /> Verified ({Math.round(ingest.sourceEvent.confidenceScore * 100)}%)
                      </span>
                    ))}
                </div>

                {ingest?.asrNote && (
                  <div style={{ fontSize: 12, color: 'var(--warning)' }}>{ingest.asrNote}</div>
                )}

                {ingest?.created.pendingVerificationReason && (
                  <div className="alert-banner" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}>
                    {ingest.created.pendingVerificationReason}
                  </div>
                )}

                {ingest && ingest.extracted.missingFields.length > 0 && (
                  <div className="row">
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Not specified (never fabricated):</span>
                    {ingest.extracted.missingFields.map((f) => (
                      <span key={f} className="pill pill-warning">Missing: {f}</span>
                    ))}
                  </div>
                )}

                {ingest && ingest.extracted.evidence.length > 0 && (
                  <div className="row">
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Evidence:</span>
                    {ingest.extracted.evidence.map((ev, idx) => (
                      <span key={idx} className="pill mono" style={{ fontSize: 10.5 }}>
                        {ev.field}: &ldquo;{ev.evidenceQuote}&rdquo;
                      </span>
                    ))}
                  </div>
                )}

                {ingest?.created.audit && (
                  <div
                    className="card"
                    style={{
                      padding: 12,
                      background: ingest.created.audit.totalMoneyLeakPaise > 0 ? 'var(--danger-soft)' : 'var(--success-soft)',
                      borderColor: ingest.created.audit.totalMoneyLeakPaise > 0 ? 'var(--danger-border)' : 'var(--success-border)',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ingest.created.audit.cfoVerdict}</div>
                    <div className="stack" style={{ marginTop: 8, gap: 6 }}>
                      {ingest.created.audit.flags.map((f, i) => (
                        <div key={i} style={{ fontSize: 12 }}>
                          <span className={`pill ${f.severity === 'critical' ? 'pill-critical' : f.severity === 'warning' ? 'pill-warning' : ''}`} style={{ fontSize: 10.5 }}>
                            {f.statutoryRef}
                          </span>{' '}
                          <strong>{f.title}</strong> — {f.detail}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ingest?.created.quote && (
                  <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-subtle)' }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{ingest.created.landedCost?.normalizationNote}</div>
                      <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                        Net Landed: {formatINR(ingest.created.quote.netLandedUnitPaise)} · Real WACC Cost:{' '}
                        <span style={{ color: 'var(--accent)' }}>{formatINR(ingest.created.quote.creditAdjustedUnitPaise)}</span>
                      </div>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('buying')}>
                      Open Landed Cost Ranking <ArrowRight size={13} />
                    </button>
                  </div>
                )}

                {card.showExports && (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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

                {card.qa && (
                  <div className="stack" style={{ gap: 10 }}>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-primary)' }}>
                      {card.qa.directAnswer}
                    </p>

                    {card.qa.mathProof.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                        {card.qa.mathProof.map((m, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: m.highlight ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                              border: m.highlight ? '1px solid var(--accent)' : '1px solid var(--border)',
                              fontSize: 12,
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{m.label}</div>
                            <div className="mono" style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13, marginTop: 2 }}>
                              {m.value}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                              {m.formula}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {card.qa.suggestedCrossQuestions.length > 0 && (
                      <div className="card" style={{ padding: 12, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, color: 'var(--text-muted)' }}>
                          Follow-Up Inquiries
                        </div>
                        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                          {card.qa.suggestedCrossQuestions.map((cq, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`btn btn-sm ${idx === 0 ? 'btn-primary' : ''}`}
                              onClick={() => executePrompt(cq, 'manual')}
                            >
                              <span>{cq}</span>
                              <ArrowRight size={11} aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* "Up Next" Actions */}
                <div className="guided-next-tray">
                  <div className="guided-next-tray-header">
                    <span className="pill pill-accent" style={{ fontSize: 10.5 }}>
                      Step {card.completedStep} of 5
                    </span>
                    <strong>{card.nextStepLabel}</strong>
                  </div>
                  <div className="guided-next-actions">
                    {card.nextSteps.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        className={`guided-next-btn ${step.primary ? 'is-primary' : ''}`}
                        onClick={() => handleGuidedNextStep(step)}
                      >
                        <span className="guided-next-btn-top">
                          {step.kind === 'outreach' && <MessageCircle size={12} aria-hidden="true" />}
                          <span>{step.label}</span>
                          <ArrowRight size={12} aria-hidden="true" />
                        </span>
                        <span className="guided-next-btn-hint">{step.hint}</span>
                      </button>
                    ))}
                    {ingest && (
                      <button type="button" className="guided-next-btn" onClick={() => onNavigate('inbox')}>
                        <span className="guided-next-btn-top">
                          <span>Inspect in Unified Inbox</span>
                          <ArrowRight size={12} aria-hidden="true" />
                        </span>
                        <span className="guided-next-btn-hint">Permanent audit trail</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Active Money Leaks Radar (Pre-Payment Defense Table) */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 2 }}>
              <h2 className="card-title">Pre-Payment Money Leak Radar</h2>
              {leaks.length > 0 ? (
                <span className="pill pill-critical">{leaks.length} Open Leaks</span>
              ) : (
                <span className="pill pill-success">Zero Overcharges Detected</span>
              )}
            </div>
            <p className="card-subtitle">
              Automated statutory checks for GTA duplicate freight GST, Section 43B(h) MSME payment clocks, and silent vendor rate creep before cheques are issued.
            </p>
          </div>
          {leaks.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onNavigate('daily')}
            >
              Open Full Audit Register <ArrowRight size={12} />
            </button>
          )}
        </div>

        {leaks.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <CheckCircle2 size={24} style={{ color: 'var(--success)', margin: '0 auto 6px' }} />
            <h3 style={{ fontSize: 14 }}>All purchase orders and invoices match perfectly</h3>
            <p style={{ fontSize: 12 }}>No GTA duplicate tax, rate creep, or unbacked tax lines detected across active records.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Leak Title &amp; Statutory Ref</th>
                  <th>Supplier</th>
                  <th>Amount Protected</th>
                  <th>Status</th>
                  <th>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {leaks.map((leak) => (
                  <tr key={leak.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{leak.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {leak.statutoryRef || leak.detail}
                      </div>
                    </td>
                    <td>{leak.supplier?.name || 'Unknown Supplier'}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>
                      {formatINR(leak.amountPaise)}
                    </td>
                    <td>
                      <span className={`pill ${leak.status === 'disputed' ? 'pill-warning' : 'pill-critical'}`}>
                        {leak.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {leak.disputeMessageDraft && (
                          <button
                            type="button"
                            className="btn btn-whatsapp btn-sm"
                            disabled={isCaReadOnly}
                            onClick={() => {
                              onOpenOutreach({
                                scenario: 'invoice_dispute',
                                supplierName: leak.supplier?.name || 'Supplier',
                                supplierPhone: leak.supplier?.phone,
                                supplierEmail: leak.supplier?.email,
                                disputeAmountPaise: leak.amountPaise,
                                disputeReasons: [leak.title, leak.statutoryRef || leak.detail].filter(Boolean) as string[],
                              });
                            }}
                          >
                            <MessageCircle size={12} /> Dispute via WhatsApp
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={isCaReadOnly}
                          onClick={() => handleUpdateLeak(leak.id, 'recovered')}
                        >
                          Mark Settled
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon"
                          disabled={isCaReadOnly}
                          onClick={() => handleUpdateLeak(leak.id, 'dismissed')}
                          title="Dismiss this alert"
                          aria-label="Dismiss alert"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Direct Workspace Capabilities */}
      <div className="grid-4">
        <div
          className="card"
          style={{ cursor: 'pointer', transition: 'border-color 140ms ease' }}
          onClick={() => onNavigate('buying')}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Landed Cost Optimizer</span>
            <ShoppingBag size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Compare supplier quotes, normalize freight &amp; GST ITC, and factor in payment credit terms with exact WACC.
          </p>
          <div className="row" style={{ marginTop: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
            <span>Open RFQs</span>
            <ArrowRight size={12} />
          </div>
        </div>

        <div
          className="card"
          style={{ cursor: 'pointer', transition: 'border-color 140ms ease' }}
          onClick={() => onNavigate('daily')}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Pre-Payment Audit</span>
            <CalendarCheck size={16} style={{ color: 'var(--info)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Automate 3-way matching between POs, GRN delivery challans, and supplier tax invoices before issuing payment.
          </p>
          <div className="row" style={{ marginTop: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
            <span>Open Daily Audit</span>
            <ArrowRight size={12} />
          </div>
        </div>

        <div
          className="card"
          style={{ cursor: 'pointer', transition: 'border-color 140ms ease' }}
          onClick={() => onNavigate('suppliers')}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Supplier Directory</span>
            <Users size={16} style={{ color: 'var(--warning)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            1-click live GSTN portal status verification, Mod-36 checksum, and MSME Section 43B(h) categorization.
          </p>
          <div className="row" style={{ marginTop: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
            <span>Open Suppliers</span>
            <ArrowRight size={12} />
          </div>
        </div>

        <div
          className="card"
          style={{ cursor: 'pointer', transition: 'border-color 140ms ease' }}
          onClick={() => onNavigate('inbox')}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Unified Inbox</span>
            <Inbox size={16} style={{ color: 'var(--success)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Every WhatsApp quote, email invoice PDF, parchi scan, and phone call transcript linked in one searchable audit trail.
          </p>
          <div className="row" style={{ marginTop: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 500 }}>
            <span>Open Inbox</span>
            <ArrowRight size={12} />
          </div>
        </div>
      </div>
    </div>
  );
}
