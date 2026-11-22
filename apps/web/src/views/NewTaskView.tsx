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
  Clock,
  Zap,
  Pause,
  Play,
  Bot,
  FileCode2,
  FileSpreadsheet,
  RotateCcw,
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

const MANUAL_STEPS = [
  {
    title: '1. Decipher handwritten parchis & WhatsApp chats',
    desc: 'Meticulously re-type messy phone notes, WhatsApp audio quotes, and crumpled slips into spreadsheets.',
  },
  {
    title: '2. Chase vendors for revised quotes & missing terms',
    desc: 'Spend hours playing phone tag to clarify whether freight is included or extra, and who pays GTA tax.',
  },
  {
    title: '3. Manually check GST portal for active filing status',
    desc: "Open government GST portal to manually verify GSTIN validity and ensure ITC won't be blocked.",
  },
  {
    title: '4. Build complex Excel sheets with mixed tax rates',
    desc: 'Manually balance varying GST rates (5%, 12%, 18%), packaging charges, and transit insurance fees.',
  },
  {
    title: '5. Guess credit-adjusted cost across payment terms',
    desc: 'Blindly compare 15-day cash discounts with 60-day credit without calculating true WACC cost of capital.',
  },
  {
    title: '6. Overlook silent ₹0.50/kg vendor rate creep',
    desc: 'Repeat raw material purchases slowly rise in unit rate unnoticed until quarterly accounting audits.',
  },
  {
    title: '7. Double GST charged on GTA freight transportation',
    desc: 'Transporter levies GST on consignment notes while the supplier also adds GST on the same freight line.',
  },
  {
    title: '8. Scramble to reconcile missing e-Invoices & IRNs',
    desc: 'Chasing suppliers before GSTR-2B filing deadlines for missing e-way bills and mandatory QR codes.',
  },
  {
    title: '9. Risk Section 43B(h) MSME payment disallowance',
    desc: 'Delayed payments past 45 days lead to non-deductible tax liabilities and compound penal interest.',
  },
  {
    title: '10. Manual voucher entry errors into Tally ERP',
    desc: 'Typos in ledgers, tax heads, and invoice dates require weeks of painful reconciliation before CA audit.',
  },
];

const AI_STEPS = [
  {
    title: '1. Multimodal Document Ingestion',
    desc: 'Drop a WhatsApp quote, bill PDF, handwritten parchi, or Hinglish voice note—parsed instantly with zero typing.',
  },
  {
    title: '2. Deterministic GST 2.0 & Landed Cost Engine',
    desc: 'Validates GSTINs offline with Mod-36 checksums, computes credit-adjusted unit rates, and applies exact WACC.',
  },
  {
    title: '3. Pre-Payment Money Leak Radar',
    desc: 'Exposes duplicate freight GST, silent rate creep, and MSME 43B(h) payment deadlines before cheques are issued.',
  },
  {
    title: '4. 1-Click WhatsApp Counter-Offer & Tally Export',
    desc: 'Auto-generates structured counter-offers and exports verified purchase vouchers directly into Tally XML.',
  },
];

const CASE_STUDIES = [
  {
    author: 'Rajesh Sharma',
    role: 'Managing Director, Apex Precision Castings (Pune)',
    image: '/images/director.jpg',
    quote:
      'Before Kraya, our accounts team was blindsided by freight double-taxation and late MSME payments. Kraya catches rate creep on WhatsApp before our accounts head signs the cheque. It paid for itself in the first 14 days.',
    stat1Val: '₹4.8L+',
    stat1Label: 'Annual Money Leaks caught before payment',
    stat2Val: '100%',
    stat2Label: 'GST 2.0 ITC reconciled with zero CA penalties',
    ctaLabel: 'Open Landed Cost Comparison',
    ctaTab: 'buying' as const,
  },
  {
    author: 'Meenakshi Sundaram',
    role: 'VP Finance, Peenya Precision Components (Bengaluru)',
    image: '/images/avatar-5.jpg',
    quote:
      'Normalizing 30-day vs 60-day supplier credit terms used to take our purchase clerk half a day in Excel. Kraya computes WACC-adjusted landed cost in 60 seconds and drafts our WhatsApp counter-offer automatically.',
    stat1Val: '94%',
    stat1Label: 'Faster quote-to-PO turnaround across 3 plants',
    stat2Val: '₹0',
    stat2Label: 'Section 43B(h) MSME tax disallowances in FY26',
    ctaLabel: 'Explore Daily Audit',
    ctaTab: 'daily' as const,
  },
  {
    author: 'Harishankar Nair',
    role: 'Managing Partner, Coimbatore Foundry Works',
    image: '/images/avatar-2.jpg',
    quote:
      'Our shop-floor supervisors send Hinglish and Tamil voice notes directly from the receiving bay. Kraya matches quantities against POs, flags short deliveries, and exports clean Tally XML for our CA.',
    stat1Val: '6.2%',
    stat1Label: 'Average raw-material unit cost reduction',
    stat2Val: '14 Days',
    stat2Label: 'Time to full ROI after onboarding suppliers',
    ctaLabel: 'View Supplier Directory',
    ctaTab: 'suppliers' as const,
  },
];

const RADAR_STATUS_MESSAGES = [
  'Active Procurement Radar • 60s GST 2.0 & Landed Cost Guard',
  'Offline Mod-36 GSTIN Verification • Zero Hallucination',
  'MSME Section 43B(h) 45-Day Payment Clock Active',
  'GTA Double-Freight Tax & Rate Creep Shield Running',
];

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
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeFeatureTab, setActiveFeatureTab] = useState<'intake' | 'audit' | 'negotiate'>('intake');
  const [activeCaseStudy, setActiveCaseStudy] = useState(0);
  const [marqueePaused, setMarqueePaused] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [radarMsgIdx, setRadarMsgIdx] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const processSectionRef = useRef<HTMLElement>(null);

  const result = sessionCards[0] ?? null;
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

  // Subtle live status cycle in Hero Radar pill (respects reduced motion)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      setRadarMsgIdx((i) => (i + 1) % RADAR_STATUS_MESSAGES.length);
    }, 3600);
    return () => window.clearInterval(id);
  }, []);

  // Scroll-driven progress tracker for the Process Comparison section (drives live header fill, hour counter, and step checkmarks)
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setProcessProgress(1);
      return;
    }

    let rafId = 0;
    const updateProgress = () => {
      const el = processSectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Start progressing as the section enters the middle of the viewport, finish near its bottom
      const start = vh * 0.72;
      const totalDistance = Math.max(1, rect.height - vh * 0.35);
      const traveled = start - rect.top;
      const ratio = Math.max(0, Math.min(1, traveled / totalDistance));
      setProcessProgress(ratio);
    };

    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Fallback IntersectionObserver for .scroll-reveal when CSS scroll-driven view() animations are unsupported
  useEffect(() => {
    const supportsViewTimeline =
      typeof CSS !== 'undefined' &&
      CSS.supports('(animation-timeline: view()) and (animation-range: entry)');
    const noReducedMotion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

    if (supportsViewTimeline || !noReducedMotion) return;

    const nodes = document.querySelectorAll<HTMLElement>('.scroll-reveal');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 }
    );

    nodes.forEach((n) => {
      n.classList.add('io-fallback-init');
      observer.observe(n);
    });
    return () => observer.disconnect();
  }, []);

  // Fallback scroll progress bar for browsers without CSS animation-timeline: scroll()
  useEffect(() => {
    const supportsScrollTimeline =
      typeof CSS !== 'undefined' && CSS.supports('animation-timeline', 'scroll()');
    const noReducedMotion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
    if (supportsScrollTimeline || !noReducedMotion) return;

    const bar = document.querySelector<HTMLElement>('.scroll-progress-bar');
    if (!bar) return;

    const onScroll = () => {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.min(1, Math.max(0, window.scrollY / scrollable));
      bar.style.transform = `scaleX(${pct})`;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
      // Smart Client-Side Routing for specialized engines (Live Sourcing, BOM, Negotiation, Sweep, GSTR-2B, Exports, Guide)
      if (intent.kind === 'discover_suppliers') {
        tools.onOpenDiscover(intent.extractedQuery || rawPrompt);
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: 1,
            badge: 'STEP 1 · LIVE AI SOURCING',
            title: `Searching GST-verified suppliers for "${intent.extractedQuery || rawPrompt}"`,
            nextStepLabel: 'Step 1 Sourcing Opened → Save top suppliers, then float your RFQ or log their quotes',
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
                label: 'Step 2: Paste First Vendor Quote →',
                hint: 'Compute WACC landed cost',
                kind: 'prefill_prompt',
                prompt: WORKFLOW_STAGES[1].defaultPrompt,
                channel: 'whatsapp',
              },
              {
                id: 'src-next-dir',
                label: 'Open My Suppliers',
                hint: 'Review saved vendor book',
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
              badge: 'STEP 2 → STEP 3 PREREQUISITE',
              title: 'Log at least 2 supplier quotes on an RFQ to run AI BATNA Negotiation',
              nextStepLabel:
                res.message ||
                'Kraya compares 2+ quotes on the same RFQ to compute spread, BATNA leverage, and counter-offer targets.',
              tone: 'warning',
              nextSteps: [
                {
                  id: 'neg-prefill-q',
                  label: 'Log a 2nd Vendor Quote Now',
                  hint: 'Paste WhatsApp or phone quote',
                  primary: true,
                  kind: 'prefill_prompt',
                  prompt:
                    'From: Shakti Packaging. 5000 boxes @ ₹24 flat cash on delivery, 5% GST incl, Monday dispatch',
                  channel: 'whatsapp',
                },
                {
                  id: 'neg-open-buying',
                  label: 'Open Buying & RFQs',
                  hint: 'View existing RFQs & quotes',
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
        onDataMutated();
        setPrompt('');
        setSessionCards((prev) => [
          {
            id: `card-${Date.now()}`,
            userPrompt: rawPrompt,
            completedStep: 4,
            badge: 'STEP 4 · AUTONOMOUS SWEEP',
            title: `Expeditor Sweep Complete — ${res.createdTasksCount} new action item${res.createdTasksCount === 1 ? '' : 's'} queued`,
            nextStepLabel: `Found ${res.summary.staleRfqsFound} stale RFQs · ${res.summary.overdueDeliveriesFound} overdue POs · ${res.summary.msmeCliffsFound} MSME 43B(h) payment cliffs · ${res.summary.amcsDueFound} due AMCs · ${res.summary.incompleteKycSuppliers} incomplete KYC vendors.`,
            tone: 'success',
            nextSteps: [
              {
                id: 'sw-open-daily',
                label: 'Open Daily Follow-Up Queue',
                hint: 'Send 1-click WhatsApp nudges',
                primary: true,
                kind: 'navigate',
                tab: 'daily',
              },
              {
                id: 'sw-step5-audit',
                label: 'Step 5: Audit a Supplier Invoice →',
                hint: 'Check bills against POs',
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
            title: 'Accounting Vouchers & CA GST IMS Audit Pack Ready',
            nextStepLabel: 'Export verified purchase vouchers directly to Tally Prime, Zoho Books, or your Chartered Accountant.',
            tone: 'success',
            showExports: true,
            nextSteps: [
              {
                id: 'exp-check-2b',
                label: 'Reconcile GSTR-2B / IMS First',
                hint: 'Confirm 100% portal ITC match',
                kind: 'gstr2b',
              },
              {
                id: 'exp-open-daily',
                label: 'Open Full Audit Register',
                hint: 'View all audited bills & CFO intelligence',
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
            badge: 'GUIDED WORKFLOW BRIEFING',
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

  const focusPromptInput = () => {
    const el = document.querySelector('.studio-composer-container');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 260);
  };

  // Derived scroll-driven values for Process Comparison
  const manualFill = Math.min(1, processProgress * 1.04);
  const manualHoursLive = Math.round(manualFill * 112);
  const aiFill = Math.min(1, processProgress * 2.6);
  const aiSecondsLive = Math.round(aiFill * 60);
  const aiDone = aiFill >= 0.98;

  const currentStory = CASE_STUDIES[activeCaseStudy];
  const switcherIndex = activeFeatureTab === 'intake' ? 0 : activeFeatureTab === 'audit' ? 1 : 2;

  return (
    <div className="hero-canvas">
      {/* Hero Header Section with Ambient Blue Aurora */}
      <div className="hero-stage">
        <div className="hero-aurora-clouds" aria-hidden="true" />
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
              Run Procurement Agent <span className="cta-dot" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Hero Radar Centerpiece with Rotating Sweep & Floating Procurement Roles */}
        <div className="hero-centerpiece-container">
          <div className="hero-radar-orb">
            <div className="radar-sweep-beam" aria-hidden="true" />
            <div className="radar-pulse-ring radar-pulse-1" aria-hidden="true" />
            <div className="radar-pulse-ring radar-pulse-2" aria-hidden="true" />
            <div className="radar-core-ring">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2.5" />
                <circle cx="14" cy="10" r="3" fill="#ffffff" />
              </svg>
            </div>
            <div className="radar-orbit-avatar orb-av-1" data-role="Factory CFO" title="Factory CFO">
              <img src="/images/avatar-3.jpg" alt="Factory CFO" />
            </div>
            <div className="radar-orbit-avatar orb-av-2" data-role="Purchase Lead" title="Purchase Manager">
              <img src="/images/avatar-2.jpg" alt="Purchase Manager" />
            </div>
            <div className="radar-orbit-avatar orb-av-3" data-role="GST Officer" title="GST Compliance Officer">
              <img src="/images/avatar-5.jpg" alt="GST Compliance Officer" />
            </div>
            <div className="radar-orbit-avatar orb-av-4" data-role="Steel Supplier" title="Raw Material Supplier">
              <img src="/images/avatar-1.jpg" alt="Raw Material Supplier" />
            </div>
            <div className="radar-orbit-avatar orb-av-5" data-role="Accounts Payable" title="Accounts Payable">
              <img src="/images/avatar-4.jpg" alt="Accounts Payable" />
            </div>
            <div className="radar-orbit-avatar orb-av-6" data-role="MSME Auditor" title="Udyam MSME Auditor">
              <img src="/images/avatar-6.jpg" alt="Udyam MSME Auditor" />
            </div>
            <div className="radar-status-badge" aria-live="polite">
              <span className="live-status-dot" />
              <span key={radarMsgIdx} className="radar-status-text">
                {RADAR_STATUS_MESSAGES[radarMsgIdx]}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Studio Command Center Composer (ALWAYS VISIBLE & PROMINENT) */}
      <div className="studio-composer-container">
        {isCaReadOnly && (
          <div className="alert-banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', marginBottom: 16 }}>
            <span>
              You are signed in with the <strong>CA / Auditor (Read-Only)</strong> role. You can inspect all quotes, invoices, Money Leaks, run GSTR-2B reconciliation, and export Tally XML &amp; CA GST IMS Packs, while creating or modifying records is disabled.
            </span>
          </div>
        )}

        {/* Guided 5-Step Flow Bar directly above the prompt box so users always know the order */}
        <div className="guided-studio-header">
          <div className="guided-studio-title-row">
            <span className="pill pill-accent" style={{ fontSize: 11 }}>
              <Sparkles size={11} aria-hidden="true" /> 5-Step Guided Procurement Prompt
            </span>
            <span className="guided-studio-next-cue">
              {guidance.headline}
            </span>
          </div>

          <ol className="studio-step-pills" aria-label="Choose a procurement workflow step">
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
            Tell Kraya what procurement step to run next
          </label>
          <textarea
            ref={textareaRef}
            id={promptFieldId}
            className="prompt-textarea prompt-textarea-autogrow"
            placeholder={
              isCaReadOnly
                ? 'CA Read-Only mode: try "Reconcile GSTR-2B", "Export Tally XML", or "What should I do next?"'
                : `${activeStageDef.oneLiner} (Press Enter to run, Shift+Enter for new line)`
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
              <Bot size={14} aria-hidden="true" />
              <strong>{liveIntent.actionLabel}</strong>
              <span>— {liveIntent.detail}</span>
            </div>
          )}

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
                + Attach Bills / Chats / Audio
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
              disabled={submitting || (!prompt.trim() && attachedFiles.length === 0)}
            >
              <Send size={14} />
              {submitting ? batchProgress || 'Auditing & Routing...' : 'Run Procurement Agent'}
            </button>
          </div>
        </form>

        {/* Contextual 1-Click Examples for the Selected Step + "What should I do next?" */}
        <div className="starter-tabs" role="group" aria-label={`Guided prompts for ${activeStageDef.shortTitle}`} style={{ marginTop: 14 }}>
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
              <Sparkles size={12} aria-hidden="true" />
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
            <span>Ask CFO / Cross-Question</span>
            <span className="starter-mini-badge">PnC Q&amp;A</span>
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
        <div className="card" role="alert" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', color: 'var(--danger)', maxWidth: 1040, margin: '0 auto 24px' }}>
          {error}
        </div>
      )}

      {/* Guided Session Feed: Structured Results + Sequential Next-Step Prompts */}
      {sessionCards.length > 0 && (
        <div className="stack" style={{ maxWidth: 1040, margin: '0 auto 48px', gap: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill pill-accent">Active Guided Session ({sessionCards.length})</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Follow the &ldquo;Up Next&rdquo; buttons below or type your next instruction above.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSessionCards([])}
            >
              <RotateCcw size={13} aria-hidden="true" /> Back to Full Overview
            </button>
          </div>

          {sessionCards.map((card) => {
            const ingest = card.ingest;
            return (
              <div key={card.id} className="card stack guided-result-card">
                <div className="guided-prompt-echo">
                  <span className="pill" style={{ fontSize: 11 }}>You asked</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{card.userPrompt}</span>
                </div>

                <div className="card-header" style={{ marginBottom: 0 }}>
                  <div>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <span className={`pill ${card.tone === 'danger' ? 'pill-critical' : card.tone === 'warning' ? 'pill-warning' : card.tone === 'success' ? 'pill-success' : 'pill-accent'}`}>
                        <Sparkles size={12} />
                        {card.badge}
                      </span>
                      {ingest && (
                        <>
                          <span className="pill">
                            {ingest.intake.pillar.replace('_', ' ').toUpperCase()}
                          </span>
                          <span className="pill">
                            Engine: {ingest.extracted.engine === 'gemini_live' ? 'Gemini Flash Vision' : 'Deterministic Hinglish Parser'}
                          </span>
                          {ingest.intake.detectedPromptInjection && (
                            <span className="pill pill-critical">
                              <ShieldAlert size={12} /> Prompt Injection Fenced as Data
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
                        style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                        onClick={() => handleVerifyEvent(ingest.sourceEvent.id)}
                      >
                        <AlertTriangle size={13} />
                        1-Click Confirm Extracted Figures
                      </button>
                    ) : (
                      <span className="pill pill-success">
                        <CheckCircle2 size={12} /> Verified ({Math.round(ingest.sourceEvent.confidenceScore * 100)}%)
                      </span>
                    ))}
                </div>

                {ingest?.asrNote && (
                  <div style={{ fontSize: 12.5, color: 'var(--warning)' }}>{ingest.asrNote}</div>
                )}

                {ingest?.created.pendingVerificationReason && (
                  <div className="alert-banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                    {ingest.created.pendingVerificationReason}
                  </div>
                )}

                {ingest && ingest.extracted.missingFields.length > 0 && (
                  <div className="row">
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Not stated (left blank, never guessed):</span>
                    {ingest.extracted.missingFields.map((f) => (
                      <span key={f} className="pill pill-warning">Missing: {f}</span>
                    ))}
                  </div>
                )}

                {ingest && ingest.extracted.evidence.length > 0 && (
                  <div className="row">
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Evidence:</span>
                    {ingest.extracted.evidence.map((ev, idx) => (
                      <span key={idx} className="pill mono" style={{ fontSize: 11 }}>
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
                      borderColor: ingest.created.audit.totalMoneyLeakPaise > 0 ? 'var(--danger)' : 'var(--success)',
                    }}
                  >
                    <strong>{ingest.created.audit.cfoVerdict}</strong>
                    <div className="stack" style={{ marginTop: 8, gap: 6 }}>
                      {ingest.created.audit.flags.map((f, i) => (
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

                {ingest?.created.quote && (
                  <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'var(--bg-subtle)' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ingest.created.landedCost?.normalizationNote}</div>
                      <div className="mono" style={{ fontWeight: 600 }}>
                        Net Landed: {formatINR(ingest.created.quote.netLandedUnitPaise)} &bull; Credit-Adjusted Real Cost:{' '}
                        <span style={{ color: 'var(--accent)' }}>{formatINR(ingest.created.quote.creditAdjustedUnitPaise)}</span>
                      </div>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('buying')}>
                      Open Landed Cost Comparison <ArrowRight size={13} />
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
                  <div className="stack" style={{ gap: 12 }}>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-primary)' }}>
                      {card.qa.directAnswer}
                    </p>

                    {card.qa.mathProof.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
                        {card.qa.mathProof.map((m, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              background: m.highlight ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                              border: m.highlight ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                              fontSize: 12.5,
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{m.label}</div>
                            <div className="mono" style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13.5, marginTop: 3 }}>
                              {m.value}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                              {m.formula}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {card.qa.pncMatrix.length > 0 && (
                      <div className="card" style={{ padding: 12, background: 'var(--bg-subtle)' }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                          Permutations &amp; Combinations (PnC) Logical Matrix
                        </div>
                        <div className="stack" style={{ gap: 6 }}>
                          {card.qa.pncMatrix.map((row, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'space-between',
                                gap: 8,
                                padding: '6px 8px',
                                borderRadius: 6,
                                background: 'var(--bg-surface)',
                                fontSize: 12,
                              }}
                            >
                              <div>
                                <strong>{row.condition}</strong> → {row.outcome}
                              </div>
                              <span className="pill mono" style={{ fontSize: 10.5 }}>
                                {row.impact}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {card.qa.statutoryCitations.length > 0 && (
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {card.qa.statutoryCitations.map((c, idx) => (
                          <span key={idx} className="pill" title={c.ruleSummary} style={{ fontSize: 11 }}>
                            <ShieldCheck size={11} /> {c.act} · {c.section}
                          </span>
                        ))}
                      </div>
                    )}

                    {card.qa.suggestedCrossQuestions.length > 0 && (
                      <div className="card" style={{ padding: 12, borderColor: 'var(--accent)' }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                          Follow-Up Cross-Questions (Click to Challenge or Drill Down)
                        </div>
                        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                          {card.qa.suggestedCrossQuestions.map((cq, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`btn btn-sm ${idx === 0 ? 'btn-primary' : ''}`}
                              onClick={() => executePrompt(cq, 'manual')}
                            >
                              <span>{cq}</span>
                              <ArrowRight size={12} aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Crystal-Clear "Up Next" Guided Step Tray */}
                <div className="guided-next-tray">
                  <div className="guided-next-tray-header">
                    <span className="pill pill-accent" style={{ fontSize: 11 }}>
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
                          {step.kind === 'outreach' && <MessageCircle size={13} aria-hidden="true" />}
                          <span>{step.label}</span>
                          <ArrowRight size={13} aria-hidden="true" />
                        </span>
                        <span className="guided-next-btn-hint">{step.hint}</span>
                      </button>
                    ))}
                    {ingest && (
                      <button type="button" className="guided-next-btn" onClick={() => onNavigate('inbox')}>
                        <span className="guided-next-btn-top">
                          <span>Inspect in Unified Inbox</span>
                          <ArrowRight size={13} aria-hidden="true" />
                        </span>
                        <span className="guided-next-btn-hint">View permanent audit trail</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Section 1: Built for Indian Enterprise Scale and Statutory Trust (Matching Frames 010 - 012) */}
      {!result && (
        <section className="enterprise-trust-section scroll-reveal" aria-label="Enterprise scale and trust">
          <div className="section-header-split">
            <div>
              <h2 className="section-headline">Built for factory scale,<br />statutory compliance, and trust</h2>
              <p className="section-subtext">
                Kraya handles high-volume quote intake, multi-tier GST 2.0 ITC reconciliation, and Section 43B(h) clocks—ensuring your procurement workflow never loses a rupee.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary pill-cta"
              disabled={isCaReadOnly}
              onClick={focusPromptInput}
            >
              Run Procurement Agent <span className="cta-dot" aria-hidden="true" />
            </button>
          </div>

          <div className="enterprise-card-grid">
            {/* Card 1: Landed Cost Normalization on Autopilot (Centered Circular Badge + 3D Layered Deck) */}
            <div className="showcase-card scroll-reveal">
              <div className="showcase-visual-stage">
                <div className="showcase-circle-badge">60s</div>
                <div className="layered-quote-deck">
                  <div className="layered-quote-back" aria-hidden="true">
                    <span>Apex Fasteners &bull; ₹43.80/kg</span>
                    <span>30d Credit</span>
                  </div>
                  <div className="layered-quote-front">
                    <div className="layered-quote-top">
                      <span className="pill-dark-mini">Landed Cost Audit</span>
                      <span className="layered-quote-meta">3 Quotes Ranked</span>
                    </div>
                    <div className="layered-quote-body">
                      <img src="/images/avatar-1.jpg" className="layered-quote-avatar" alt="" />
                      <div className="layered-quote-info">
                        <strong>Shree Balaji Steel</strong>
                        <span>18% GST ITC &bull; 45d Credit</span>
                      </div>
                      <span className="layered-quote-winner">
                        <span className="winner-dot" /> ₹41.20/kg
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <h3>Landed Cost Normalization on Autopilot</h3>
              <p>Computes true credit-adjusted unit rates in 60 seconds—factoring in GST 2.0 ITC eligibility, 15/45-day payment credit terms, WACC cost of capital, and transport double-taxation.</p>
            </div>

            {/* Card 2: Scale That Manual Teams Can't Match */}
            <div className="showcase-card scroll-reveal">
              <div className="network-graph-box">
                <div className="network-radial-backdrop" aria-hidden="true" />
                <div className="network-center-node">
                  <span>&gt;10k</span>
                </div>
                <div className="network-orbit-node net-node-1" data-role="Raw Steel" title="Raw Steel"><img src="/images/avatar-1.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-2" data-role="Polymers" title="Polymers"><img src="/images/avatar-2.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-3" data-role="Fasteners" title="Fasteners"><img src="/images/avatar-3.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-4" data-role="Tooling" title="Tooling"><img src="/images/avatar-4.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-5" data-role="Packaging" title="Packaging"><img src="/images/avatar-5.jpg" alt="" /></div>
                <div className="network-orbit-node net-node-6" data-role="Freight GTA" title="Freight GTA"><img src="/images/avatar-6.jpg" alt="" /></div>
                <svg className="network-lines-svg" viewBox="0 0 280 200" aria-hidden="true">
                  <path d="M 140 100 L 100 45 L 55 45" fill="none" stroke="#93c5fd" strokeWidth="1.5" />
                  <path d="M 140 100 L 180 45 L 225 45" fill="none" stroke="#93c5fd" strokeWidth="1.5" />
                  <path d="M 140 100 L 42 100" fill="none" stroke="#93c5fd" strokeWidth="1.5" />
                  <path d="M 140 100 L 238 100" fill="none" stroke="#93c5fd" strokeWidth="1.5" />
                  <path d="M 140 100 L 100 155 L 55 155" fill="none" stroke="#93c5fd" strokeWidth="1.5" />
                  <path d="M 140 100 L 180 155 L 225 155" fill="none" stroke="#93c5fd" strokeWidth="1.5" />
                </svg>
              </div>
              <h3>Scale That Manual Teams Can&apos;t Match</h3>
              <p>Audits hundreds of purchase bills, WhatsApp quotes, and handwritten parchis across factories without human fatigue—instantly catching silent rate creep and duplicate freight tax.</p>
            </div>

            {/* Card 3: Integrations That Just Work */}
            <div className="showcase-card scroll-reveal">
              <div className="integration-hub-box">
                <div className="hub-ripple-ring ring-3" aria-hidden="true" />
                <div className="hub-ripple-ring ring-2" aria-hidden="true" />
                <div className="hub-ripple-ring ring-1" aria-hidden="true" />
                <div className="hub-center-core">
                  <div className="brand-mark" style={{ width: 46, height: 46 }}>
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
            <div className="showcase-card scroll-reveal">
              <div className="speedometer-box">
                <svg width="190" height="120" viewBox="0 0 200 124" aria-hidden="true">
                  <defs>
                    <linearGradient id="krayaGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#93c5fd" />
                      <stop offset="100%" stopColor="#2563eb" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M 24 108 A 76 76 0 0 1 176 108"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 24 108 A 76 76 0 0 1 162 52"
                    fill="none"
                    stroke="url(#krayaGaugeGrad)"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />
                  <line
                    x1="100"
                    y1="108"
                    x2="148"
                    y2="52"
                    stroke="#2563eb"
                    strokeWidth="6"
                    strokeLinecap="round"
                    className="speedometer-needle-anim"
                  />
                  <circle cx="100" cy="108" r="10" fill="#1d4ed8" />
                  <circle cx="100" cy="108" r="4" fill="#ffffff" />
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

      {/* Continuous Single-Line Enterprise Logo Marquee (Matching Frame 013) */}
      {!result && (
        <div className="marquee-banner scroll-reveal" aria-label="Trusted by Indian enterprise suppliers">
          <div className="marquee-header-row">
            <div className="marquee-title">Fueling Indian manufacturing growth across industrial clusters</div>
            <button
              type="button"
              className="marquee-pause-btn"
              onClick={() => setMarqueePaused((p) => !p)}
              aria-label={marqueePaused ? 'Play brand ticker' : 'Pause brand ticker'}
            >
              {marqueePaused ? <Play size={12} /> : <Pause size={12} />}
              <span>{marqueePaused ? 'Play' : 'Pause'}</span>
            </button>
          </div>
          <div className="marquee-track-wrapper">
            <div className={`marquee-track ${marqueePaused ? 'is-paused' : ''}`}>
              <span className="marquee-item">&bull; TATA MOTORS SUPPLIERS</span>
              <span className="marquee-item">&bull; APEX PRECISION COMPONENTS</span>
              <span className="marquee-item">&bull; KIRLOSKAR PUMPS NETWORK</span>
              <span className="marquee-item">&bull; BHARAT HEAVY FORGE</span>
              <span className="marquee-item">&bull; MAHINDRA CIE ECOSYSTEM</span>
              <span className="marquee-item">&bull; SUNDRAM FASTENERS</span>
              <span className="marquee-item">&bull; ENDURANCE TECHNOLOGIES</span>
              <span className="marquee-item">&bull; PEENYA INDUSTRIAL CLUSTER</span>
              <span className="marquee-item" aria-hidden="true">&bull; TATA MOTORS SUPPLIERS</span>
              <span className="marquee-item" aria-hidden="true">&bull; APEX PRECISION COMPONENTS</span>
              <span className="marquee-item" aria-hidden="true">&bull; KIRLOSKAR PUMPS NETWORK</span>
              <span className="marquee-item" aria-hidden="true">&bull; BHARAT HEAVY FORGE</span>
              <span className="marquee-item" aria-hidden="true">&bull; MAHINDRA CIE ECOSYSTEM</span>
              <span className="marquee-item" aria-hidden="true">&bull; SUNDRAM FASTENERS</span>
              <span className="marquee-item" aria-hidden="true">&bull; ENDURANCE TECHNOLOGIES</span>
              <span className="marquee-item" aria-hidden="true">&bull; PEENYA INDUSTRIAL CLUSTER</span>
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Scroll-Driven Process Comparison with Sticky Progress Fill Bars (Matching Frames 018 - 027) */}
      {!result && (
        <section
          ref={processSectionRef}
          className="process-comparison-section"
          aria-label="Manual Chaos vs AI Clarity"
        >
          <div className="process-header scroll-reveal">
            <span className="process-eyebrow">Manual Chaos &rarr; AI Financial Clarity</span>
            <h2 className="process-headline">Automate your procurement.<br />Protect factory capital.</h2>
            <p className="process-subtext">
              Scroll to compare: watch Kraya finish in 60 seconds while manual procurement takes 112 hours every month.
            </p>
          </div>

          <div className="process-columns-grid">
            {/* Column 1: Manual Process with Scroll-Driven Dark Fill Bar & Live Hour Counter */}
            <div className="process-col col-manual">
              <div className="process-col-header sticky-progress-header">
                <div
                  className="header-progress-fill fill-manual"
                  style={{ transform: `scaleX(${manualFill})` }}
                  aria-hidden="true"
                />
                <div className="header-bar-content">
                  <h3 style={{ color: manualFill > 0.35 ? '#ffffff' : '#0f172a' }}>Manual Process</h3>
                  <div className="header-counter-group">
                    <span className="badge-hours mono">{manualHoursLive}</span>
                    <span
                      className="header-unit-label"
                      style={{ color: manualFill > 0.88 ? '#ffffff' : '#0f172a' }}
                    >
                      Hours
                    </span>
                  </div>
                </div>
              </div>

              <div className="process-step-list">
                {MANUAL_STEPS.map((step, idx) => {
                  const threshold = (idx + 0.5) / MANUAL_STEPS.length;
                  const completed = manualFill >= threshold;
                  const isCurrent =
                    manualFill >= idx / MANUAL_STEPS.length &&
                    manualFill < (idx + 1) / MANUAL_STEPS.length;
                  return (
                    <div
                      key={step.title}
                      className={`process-step-card ${completed ? 'is-completed' : ''} ${isCurrent ? 'is-current' : ''}`}
                    >
                      <div className="step-row-top">
                        <div className="step-title-group">
                          <Clock size={15} className="step-lead-icon manual-icon" />
                          <span className="step-num">{step.title}</span>
                        </div>
                        <span
                          className={`step-check-circle ${completed ? 'checked-manual' : ''}`}
                          aria-hidden="true"
                        >
                          <Check size={11} strokeWidth={3} />
                        </span>
                      </div>
                      <p>{step.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Kraya AI Process with Fast Royal Blue Fill Bar & Yellow ⚡ Done Pill */}
            <div className="process-col col-ai">
              <div className="process-col-header sticky-progress-header">
                <div
                  className="header-progress-fill fill-ai"
                  style={{ transform: `scaleX(${aiFill})` }}
                  aria-hidden="true"
                />
                <div className="header-bar-content">
                  <div className="row" style={{ gap: 10 }}>
                    <h3 style={{ color: aiFill > 0.25 ? '#ffffff' : '#0f172a' }}>Kraya AI Process</h3>
                    <span className={`badge-done ${aiDone ? 'is-visible' : ''}`}>
                      <Zap size={11} fill="currentColor" /> Done
                    </span>
                  </div>
                  <div className="header-counter-group">
                    <span className="badge-hours mono">{aiSecondsLive}</span>
                    <span
                      className="header-unit-label"
                      style={{ color: aiFill > 0.85 ? '#ffffff' : '#0f172a' }}
                    >
                      Sec
                    </span>
                  </div>
                </div>
              </div>

              <div className="process-step-list">
                {AI_STEPS.map((step, idx) => {
                  const threshold = (idx + 0.45) / AI_STEPS.length;
                  const completed = aiFill >= threshold;
                  const isCurrent =
                    aiFill >= idx / AI_STEPS.length && aiFill < (idx + 1) / AI_STEPS.length;
                  return (
                    <div
                      key={step.title}
                      className={`process-step-card ai-step-card ${completed ? 'is-completed-ai' : ''} ${isCurrent ? 'is-current-ai' : ''}`}
                    >
                      <div className="step-row-top">
                        <div className="step-title-group">
                          <Sparkles size={15} className="step-lead-icon ai-icon" />
                          <span className="step-num">{step.title}</span>
                        </div>
                        <span
                          className={`step-check-circle ${completed ? 'checked-ai' : ''}`}
                          aria-hidden="true"
                        >
                          <Check size={11} strokeWidth={3} />
                        </span>
                      </div>
                      <p>{step.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* Sticky Completion Impact Card balances the 10-step Manual column while user scrolls */}
              <div className={`ai-completion-summary-card ${aiDone ? 'is-visible' : ''}`}>
                <div className="ai-summary-eyebrow">
                  <Zap size={13} fill="currentColor" /> Kraya Finished — Manual Still Running ({manualHoursLive}h)
                </div>
                <div className="ai-summary-metric-row">
                  <div className="ai-summary-stat">
                    <strong className="mono">111+ hrs</strong>
                    <span>Saved every month</span>
                  </div>
                  <div className="ai-summary-stat">
                    <strong className="mono">₹0 Leaks</strong>
                    <span>GST 2.0 &amp; 43B(h) safe</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%', borderRadius: 999, justifyContent: 'center' }}
                  onClick={focusPromptInput}
                >
                  Audit Your First Bill in 60s <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 3: Interactive 3-Tab Feature Switcher with Sliding Pill (Matching Frames 032 - 035) */}
      {!result && (
        <section className="feature-switcher-section scroll-reveal" aria-label="Interactive feature workflow">
          <h2 className="switcher-headline">
            Kraya ingests, audits, and executes<br />
            procurement—automatically.
          </h2>
          <div className="switcher-tabs" role="tablist" aria-label="Procurement automation stages">
            <div
              className={`switcher-active-pill ${activeFeatureTab === 'negotiate' ? 'pill-green' : 'pill-blue'}`}
              style={{ transform: `translateX(${switcherIndex * 100}%)` }}
              aria-hidden="true"
            />
            <button
              type="button"
              role="tab"
              aria-selected={activeFeatureTab === 'intake'}
              className={`switcher-tab ${activeFeatureTab === 'intake' ? 'is-active' : ''}`}
              onClick={() => setActiveFeatureTab('intake')}
            >
              Intake
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeFeatureTab === 'audit'}
              className={`switcher-tab ${activeFeatureTab === 'audit' ? 'is-active' : ''}`}
              onClick={() => setActiveFeatureTab('audit')}
            >
              Audit
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeFeatureTab === 'negotiate'}
              className={`switcher-tab ${activeFeatureTab === 'negotiate' ? 'is-active' : ''}`}
              onClick={() => setActiveFeatureTab('negotiate')}
            >
              Negotiate
            </button>
          </div>

          <div className="switcher-card-container">
            {activeFeatureTab === 'intake' && (
              <div key="intake" className="switcher-preview-card anim-fade-in">
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
              <div key="audit" className="switcher-preview-card anim-fade-in">
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
              <div key="negotiate" className="switcher-preview-card anim-fade-in">
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

      {/* Section 4: Working Factory Case Studies Carousel (Matching Frame 028) */}
      {!result && (
        <section className="case-studies-section scroll-reveal" aria-label="Factory case studies">
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
              See all case studies <span className="cta-dot" aria-hidden="true" />
            </button>
          </div>

          <div key={activeCaseStudy} className="case-study-card anim-fade-in">
            <div
              className="case-study-photo-box"
              style={{ backgroundImage: `url(${currentStory.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              <div className="case-study-avatar-overlay">
                <div className="case-study-author">{currentStory.author}</div>
                <div className="case-study-role">{currentStory.role}</div>
              </div>
            </div>
            <div className="case-study-content">
              <blockquote className="case-study-quote">
                &ldquo;{currentStory.quote}&rdquo;
              </blockquote>
              <div className="case-study-stats-row">
                <div className="case-study-stat">
                  <strong>{currentStory.stat1Val}</strong>
                  <span>{currentStory.stat1Label}</span>
                </div>
                <div className="case-study-stat">
                  <strong>{currentStory.stat2Val}</strong>
                  <span>{currentStory.stat2Label}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm pill"
                  style={{ alignSelf: 'center', marginLeft: 'auto' }}
                  onClick={() => onNavigate(currentStory.ctaTab)}
                >
                  {currentStory.ctaLabel} &bull;
                </button>
              </div>
            </div>
          </div>

          <div className="case-study-nav-row">
            <div className="carousel-dots" role="tablist" aria-label="Case study slides">
              {CASE_STUDIES.map((cs, idx) => (
                <button
                  key={cs.author}
                  type="button"
                  role="tab"
                  aria-selected={activeCaseStudy === idx}
                  aria-label={`View case study: ${cs.author}`}
                  className={`dot ${activeCaseStudy === idx ? 'active' : ''}`}
                  onClick={() => setActiveCaseStudy(idx)}
                />
              ))}
            </div>
            <div className="carousel-arrows">
              <button
                type="button"
                className="arrow-btn"
                aria-label="Previous story"
                onClick={() =>
                  setActiveCaseStudy((prev) => (prev - 1 + CASE_STUDIES.length) % CASE_STUDIES.length)
                }
              >
                &lsaquo;
              </button>
              <button
                type="button"
                className="arrow-btn"
                aria-label="Next story"
                onClick={() => setActiveCaseStudy((prev) => (prev + 1) % CASE_STUDIES.length)}
              >
                &rsaquo;
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Section 5: Customer Testimonials 4-Card Grid (Matching Frames 038 & 040) */}
      {!result && (
        <section className="customer-testimonials-section scroll-reveal">
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
              Get Started <span className="cta-dot" aria-hidden="true" />
            </button>
          </div>

          <div className="testimonials-grid">
            <div className="testimonial-portrait-card scroll-reveal">
              <div className="portrait-img-box">
                <img src="/images/avatar-1.jpg" alt="Vikram Patel" />
              </div>
              <p className="portrait-quote">&ldquo;We process 400+ supplier bills a month. Kraya caught silent ₹0.40/kg rate creep on MS wire that our manual audit had missed for 3 months.&rdquo;</p>
              <div className="portrait-author">
                <strong>Vikram Patel</strong>
                <span>Head of Procurement, Gujarat Polychem</span>
              </div>
            </div>
            <div className="testimonial-portrait-card scroll-reveal">
              <div className="portrait-img-box">
                <img src="/images/avatar-2.jpg" alt="Ananya Deshmukh" />
              </div>
              <p className="portrait-quote">&ldquo;Section 43B(h) used to give us sleepless nights before every tax audit. Kraya auto-tracks the 45-day MSME clock so we never face tax disallowances.&rdquo;</p>
              <div className="portrait-author">
                <strong>Ananya Deshmukh</strong>
                <span>CFO, Pune Auto Assemblies</span>
              </div>
            </div>
            <div className="testimonial-portrait-card scroll-reveal">
              <div className="portrait-img-box">
                <img src="/images/avatar-5.jpg" alt="K. Ramanathan" />
              </div>
              <p className="portrait-quote">&ldquo;Comparing quotes with 15-day cash discount vs 60-day credit was a spreadsheet headache. Kraya normalizes WACC and landed cost instantly.&rdquo;</p>
              <div className="portrait-author">
                <strong>K. Ramanathan</strong>
                <span>Managing Partner, Coimbatore Foundry Works</span>
              </div>
            </div>
            <div className="testimonial-portrait-card scroll-reveal">
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
      <section className="savings-radar-section scroll-reveal" aria-label="Savings and Money Leak Radar">
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
                Inspect Audit Pack <span className="cta-dot" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 7: Transparent Factory Compliance Tiers (Matching Frame 038) */}
      {!result && (
        <section className="pricing-tiers-section scroll-reveal" aria-label="Compliance tiers">
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
              Start Free Trial <span className="cta-dot" aria-hidden="true" />
            </button>
          </div>

          <div className="pricing-grid">
            <div className="pricing-card card-light scroll-reveal">
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

            <div className="pricing-card card-dark scroll-reveal">
              <div className="pricing-card-top-row">
                <div className="pricing-tier-name">Enterprise CFO</div>
                <span className="pricing-popular-badge">Most Popular</span>
              </div>
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

      {/* Section 8: Knowledge Base / Compliance Guides Triad (Matching Frame 042) */}
      {!result && (
        <section className="blog-section scroll-reveal" aria-label="Knowledge Base and Resources">
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
            <div className="blog-triad-card scroll-reveal">
              <div className="triad-text">
                <span className="blog-tag">GST 2.0 AUDIT</span>
                <h4>Stopping Double Freight Taxation: GTA vs Reverse Charge Explained</h4>
                <div className="triad-meta">4 min read &bull; Nov 2026</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/office.jpg" alt="" />
              </div>
            </div>

            <div className="blog-triad-card scroll-reveal">
              <div className="triad-text">
                <span className="blog-tag">SUPPLIER NEGOTIATIONS</span>
                <h4>5 Proven WhatsApp Negotiation Strategies for Raw Material Procurement</h4>
                <div className="triad-meta">3 min read &bull; Nov 2026</div>
              </div>
              <div className="triad-thumb">
                <img src="/images/factory.jpg" alt="" />
              </div>
            </div>

            <div className="blog-triad-card scroll-reveal">
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

      {/* Section 9: Statutory & Operational FAQs (Matching Frames 042 & 045) */}
      {!result && (
        <section className="faq-section scroll-reveal" aria-label="Frequently asked questions">
          <div className="faq-header">
            <h2 className="faq-title">Your questions, answered.</h2>
            <p className="faq-subtitle">Everything you need to know about Indian statutory compliance, ERP integrations, and Kraya&apos;s deterministic engine.</p>
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
                  aria-expanded={openFaq === idx}
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                >
                  <span>{faq.q}</span>
                  <span className="faq-icon" aria-hidden="true">+</span>
                </button>
                {openFaq === idx && (
                  <div className="faq-answer anim-fade-in">
                    <p>{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 10: Royal Blue CTA Banner (Matching Frame 045) */}
      {!result && (
        <section className="video-cta-banner scroll-reveal">
          <div className="cta-banner-content">
            <div className="cta-banner-left">
              <h2>Procure Smarter.<br />Protect Factory Capital.</h2>
              <button
                type="button"
                className="btn btn-cta-light"
                onClick={focusPromptInput}
              >
                Run Procurement Agent <span className="cta-dot cta-dot-blue" aria-hidden="true" />
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

      {/* Section 11: Modern Card Footer (Matching Frame 046) */}
      <footer className="video-footer-card scroll-reveal">
        <div className="footer-top-row">
          <div className="footer-brand-column">
            <div className="footer-brand-logo">
              <div className="brand-mark" style={{ width: 38, height: 38 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#ffffff" strokeWidth="2.5" />
                  <circle cx="14" cy="10" r="3" fill="#ffffff" />
                </svg>
              </div>
              <span className="brand-title">Kraya AI</span>
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
