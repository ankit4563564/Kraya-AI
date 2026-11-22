import React, { useEffect, useState } from 'react';
import {
  Plug,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  XCircle,
  Clock,
  Key,
  Database,
  HardDrive,
  Sparkles,
  MessageSquare,
  Mail,
  Mic,
  Volume2,
  CreditCard,
  FileSpreadsheet,
  BookOpen,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Terminal,
  Play,
  Check,
  Copy,
  Info,
} from 'lucide-react';
import { apiJson } from '../lib/api';
import { ModalDialog } from './ModalDialog';

export type IntegrationStatus =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'FALLBACK_ACTIVE'
  | 'NOT_CONFIGURED'
  | 'ERROR'
  | 'UNVERIFIED';

export interface IntegrationCard {
  id: string;
  name: string;
  category: 'Database' | 'Storage' | 'Intelligence' | 'Messaging' | 'Voice' | 'ERP & Banking' | 'Compliance';
  icon: string;
  status: IntegrationStatus;
  providerMode: string;
  isConfigured: boolean;
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  missingEnvVars: string[];
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  supportedOperations: string[];
  details: Record<string, unknown>;
  setupGuide: {
    description: string;
    docsUrl?: string;
    sampleEnv: string;
  };
}

export interface IntegrationsResponse {
  ok: boolean;
  summary: {
    total: number;
    connected: number;
    fallbackActive: number;
    notConfigured: number;
    unverified: number;
    error: number;
  };
  integrations: IntegrationCard[];
}

interface WebhookEntry {
  id: string;
  name: string;
  provider: string;
  targetUrl: string;
  hasSigningSecret: boolean;
  subscribedEvents: string[];
  enabled: boolean;
}

interface DeliveryEntry {
  id: string;
  eventType: string;
  targetUrl: string;
  ok: boolean;
  httpStatus: number;
  durationMs: number;
  responsePreview: string | null;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConnectorHubModal({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'control_center' | 'webhooks_n8n'>('control_center');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [expandedSetup, setExpandedSetup] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // n8n webhooks
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryEntry[]>([]);
  const [whName, setWhName] = useState('n8n Procurement Bus');
  const [whProvider, setWhProvider] = useState('n8n');
  const [whUrl, setWhUrl] = useState('');
  const [whSecret, setWhSecret] = useState('');

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const res = await apiJson<IntegrationsResponse>('/api/integrations');
      setData(res);

      // Load webhooks catalog in parallel
      apiJson<{ webhooks: WebhookEntry[]; recentDeliveries: DeliveryEntry[] }>('/api/connectors/catalog')
        .then((cat) => {
          setWebhooks(cat.webhooks || []);
          setDeliveries(cat.recentDeliveries || []);
        })
        .catch(() => {});
    } catch (err) {
      setToastMsg(`Error loading integrations: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadIntegrations();
    }
  }, [open]);

  const testSingleIntegration = async (serviceId: string) => {
    setTestingService(serviceId);
    try {
      const res = await apiJson<{
        ok: boolean;
        service: string;
        status: IntegrationStatus;
        latencyMs: number;
        lastError: string | null;
      }>(`/api/integrations/test/${serviceId}`, { method: 'POST' });

      setToastMsg(
        res.ok
          ? `✓ ${serviceId.toUpperCase()} test succeeded (${res.latencyMs}ms)`
          : `✗ ${serviceId.toUpperCase()} test failed: ${res.lastError || 'Unknown error'}`
      );
      loadIntegrations();
    } catch (err) {
      setToastMsg(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingService(null);
    }
  };

  const testAllIntegrations = async () => {
    setTestingAll(true);
    try {
      const res = await apiJson<{ ok: boolean }>(`/api/integrations/test-all`, { method: 'POST' });
      setToastMsg(res.ok ? '✓ Diagnostic sweep completed across all 11 services!' : 'Sweep encountered errors.');
      loadIntegrations();
    } catch (err) {
      setToastMsg(`Sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingAll(false);
    }
  };

  const toggleSetup = (id: string) => {
    setExpandedSetup((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderServiceIcon = (icon: string) => {
    switch (icon) {
      case 'Database': return <Database size={16} className="text-cyan-400" />;
      case 'HardDrive': return <HardDrive size={16} className="text-purple-400" />;
      case 'Sparkles': return <Sparkles size={16} className="text-indigo-400" />;
      case 'MessageSquare': return <MessageSquare size={16} className="text-emerald-400" />;
      case 'Mail': return <Mail size={16} className="text-blue-400" />;
      case 'Mic': return <Mic size={16} className="text-amber-400" />;
      case 'Volume2': return <Volume2 size={16} className="text-rose-400" />;
      case 'CreditCard': return <CreditCard size={16} className="text-teal-400" />;
      case 'FileSpreadsheet': return <FileSpreadsheet size={16} className="text-emerald-400" />;
      case 'BookOpen': return <BookOpen size={16} className="text-blue-400" />;
      case 'ShieldAlert': return <ShieldAlert size={16} className="text-amber-400" />;
      default: return <Plug size={16} className="text-slate-400" />;
    }
  };

  const renderStatusBadge = (status: IntegrationStatus) => {
    switch (status) {
      case 'CONNECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            CONNECTED
          </span>
        );
      case 'FALLBACK_ACTIVE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-950/40 text-cyan-400 border border-cyan-500/30" title="Running on verified local or deterministic fallback">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
            FALLBACK ACTIVE
          </span>
        );
      case 'UNVERIFIED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-950/40 text-purple-300 border border-purple-500/30">
            <Clock size={11} />
            UNVERIFIED
          </span>
        );
      case 'DEGRADED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/40 text-amber-400 border border-amber-500/30">
            <AlertTriangle size={11} />
            DEGRADED
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-950/40 text-rose-400 border border-rose-500/30">
            <XCircle size={11} />
            ERROR
          </span>
        );
      case 'NOT_CONFIGURED':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Key size={11} />
            NOT CONFIGURED
          </span>
        );
    }
  };

  const filteredIntegrations = (data?.integrations || []).filter((item) => {
    if (categoryFilter === 'all') return true;
    if (categoryFilter === 'db_storage') return item.category === 'Database' || item.category === 'Storage';
    if (categoryFilter === 'ai_voice') return item.category === 'Intelligence' || item.category === 'Voice';
    if (categoryFilter === 'comms') return item.category === 'Messaging';
    if (categoryFilter === 'erp_finance') return item.category === 'ERP & Banking';
    if (categoryFilter === 'compliance') return item.category === 'Compliance';
    return true;
  });

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Integration Control Center & External Infrastructure"
      
      footer={
        <div className="flex items-center justify-between w-full text-xs">
          <div className="text-slate-400">
            {data?.summary ? (
              <span>
                Evidence: <strong className="text-emerald-400">{data.summary.connected} Connected</strong> •{' '}
                <strong className="text-cyan-400">{data.summary.fallbackActive} Fallbacks</strong> •{' '}
                <strong className="text-slate-400">{data.summary.notConfigured} Unconfigured</strong>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm flex items-center gap-1.5"
              onClick={loadIntegrations}
              disabled={loading || testingAll}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refresh Status</span>
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">

        {/* Global Toast / Notice */}
        {toastMsg && (
          <div className="p-2.5 rounded-lg bg-slate-800 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
            <span>{toastMsg}</span>
            <button type="button" onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Header Tabs & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('control_center')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'control_center'
                  ? 'bg-indigo-600/20 text-cyan-300 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ⚡ 11 Core Service Integrations
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('webhooks_n8n')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'webhooks_n8n'
                  ? 'bg-indigo-600/20 text-cyan-300 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🔗 n8n Webhook Bus & Tools ({webhooks.length})
            </button>
          </div>

          {activeTab === 'control_center' && (
            <button
              type="button"
              className="btn btn-sm btn-primary flex items-center gap-1.5 text-xs shrink-0"
              onClick={testAllIntegrations}
              disabled={testingAll || loading}
            >
              <Play size={12} className={testingAll ? 'animate-spin' : ''} />
              <span>{testingAll ? 'Testing All Services...' : 'Test All 11 Integrations'}</span>
            </button>
          )}
        </div>

        {/* TAB 1: INTEGRATION CONTROL CENTER */}
        {activeTab === 'control_center' && (
          <div className="space-y-4">

            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {[
                { key: 'all', label: 'All Services' },
                { key: 'db_storage', label: 'Database & Storage' },
                { key: 'ai_voice', label: 'AI & Speech' },
                { key: 'comms', label: 'Messaging & Email' },
                { key: 'erp_finance', label: 'ERP & Banking' },
                { key: 'compliance', label: 'GST & Compliance' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setCategoryFilter(f.key)}
                  className={`px-2.5 py-1 rounded-md transition ${
                    categoryFilter === f.key
                      ? 'bg-slate-700 text-white font-medium border border-slate-600'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Service Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredIntegrations.map((item) => {
                const isTesting = testingService === item.id;
                const isExpanded = expandedSetup[item.id] || false;

                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 transition flex flex-col justify-between space-y-3"
                  >
                    <div>
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-slate-800 border border-slate-700/80">
                            {renderServiceIcon(item.icon)}
                          </div>
                          <div>
                            <div className="font-semibold text-white text-xs">{item.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              Mode: <span className="text-slate-300">{item.providerMode}</span>
                            </div>
                          </div>
                        </div>
                        <div>{renderStatusBadge(item.status)}</div>
                      </div>

                      {/* Diagnostic & Telemetry Bar */}
                      <div className="flex items-center gap-3 text-[10px] text-slate-400 py-1.5 border-y border-slate-800/80 mb-2 font-mono">
                        <div>
                          LATENCY:{' '}
                          <span className={item.latencyMs ? 'text-cyan-400' : 'text-slate-500'}>
                            {item.latencyMs ? `${item.latencyMs} ms` : '—'}
                          </span>
                        </div>
                        <div>
                          LAST TESTED:{' '}
                          <span className="text-slate-300">
                            {item.lastTestedAt ? new Date(item.lastTestedAt).toLocaleTimeString() : 'Never'}
                          </span>
                        </div>
                      </div>

                      {/* Error Alert Box (if present) */}
                      {item.lastError && (
                        <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-800/50 text-[11px] text-rose-300 mb-2">
                          <strong className="font-semibold">Last Error:</strong> {item.lastError}
                        </div>
                      )}

                      {/* Supported Operations */}
                      <div className="space-y-1 mb-2">
                        <div className="text-[10px] font-medium text-slate-400">Supported Capabilities:</div>
                        <div className="flex flex-wrap gap-1">
                          {item.supportedOperations.slice(0, 3).map((op, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded text-[9.5px] bg-slate-800/80 text-slate-300 border border-slate-700/60"
                            >
                              {op}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Setup Guide Accordion */}
                      {isExpanded && (
                        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-xs space-y-2 mt-2">
                          <div className="text-[11px] text-slate-300">{item.setupGuide.description}</div>
                          
                          <div className="space-y-1">
                            <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                              <span>SAMPLE .ENV CONFIGURATION:</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(item.setupGuide.sampleEnv, item.id)}
                                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                              >
                                {copiedKey === item.id ? <Check size={11} /> : <Copy size={11} />}
                                <span>{copiedKey === item.id ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                            <pre className="p-2 rounded bg-black/60 border border-slate-800 font-mono text-[10px] text-emerald-400 overflow-x-auto whitespace-pre-wrap">
                              {item.setupGuide.sampleEnv}
                            </pre>
                          </div>

                          {item.setupGuide.docsUrl && (
                            <div className="pt-1">
                              <a
                                href={item.setupGuide.docsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                              >
                                <span>Official Provider Docs ↗</span>
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-xs">
                      <button
                        type="button"
                        onClick={() => toggleSetup(item.id)}
                        className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        <span>{isExpanded ? 'Hide Setup' : 'Configure Credentials'}</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm flex items-center gap-1.5"
                        onClick={() => testSingleIntegration(item.id)}
                        disabled={isTesting || testingAll}
                      >
                        <RefreshCw size={11} className={isTesting ? 'animate-spin' : ''} />
                        <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* TAB 2: n8n WEBHOOKS & DIRECTORY TOOLS */}
        {activeTab === 'webhooks_n8n' && (
          <div className="space-y-4 text-xs">
            
            {/* Notice on n8n Integration Contract */}
            <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-slate-300 space-y-1">
              <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                <Info size={14} />
                <span>External Automation Contract</span>
              </div>
              <p className="text-[11px] text-slate-400">
                n8n workflow instances and triggers are connected via HMAC-signed webhooks. Primary factory transactions continue unblocked if the webhook target is offline.
              </p>
            </div>

            {/* Registered Webhooks */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <h4 className="font-semibold text-white">Registered Workspace Webhooks</h4>
              {webhooks.length === 0 ? (
                <div className="text-slate-500 py-3 text-center">No external webhooks registered yet.</div>
              ) : (
                <div className="space-y-2">
                  {webhooks.map((wh) => (
                    <div key={wh.id} className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-200">{wh.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{wh.targetUrl}</div>
                      </div>
                      <span className="pill pill-success text-[10px]">Active</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Deliveries */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
              <h4 className="font-semibold text-white">Recent Automation Deliveries</h4>
              {deliveries.length === 0 ? (
                <div className="text-slate-500 py-2 text-center">No webhook dispatches recorded.</div>
              ) : (
                <div className="space-y-1.5 font-mono text-[11px]">
                  {deliveries.slice(0, 5).map((d) => (
                    <div key={d.id} className="p-2 rounded bg-slate-800/60 flex items-center justify-between">
                      <span className="text-cyan-400">{d.eventType}</span>
                      <span className={d.ok ? 'text-emerald-400' : 'text-rose-400'}>
                        HTTP {d.httpStatus} ({d.durationMs}ms)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </ModalDialog>
  );
}
