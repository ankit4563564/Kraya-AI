import React, { useEffect, useState } from 'react';
import {
  Plug,
  Download,
  Send,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import { API_BASE, apiJson } from '../lib/api';
import { ModalDialog } from './ModalDialog';

interface ConnectorEntry {
  id: string;
  name: string;
  category: string;
  status: string;
  envVars: string[];
  description: string;
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

interface N8nTemplateEntry {
  slug: string;
  title: string;
  description: string;
  triggers: string[];
  requiredCredentials: string[];
  downloadPath: string;
}

interface CatalogResponse {
  connectors: ConnectorEntry[];
  webhooks: WebhookEntry[];
  recentDeliveries: DeliveryEntry[];
  n8nTemplates: N8nTemplateEntry[];
}

interface LiveN8nStatus {
  connected: boolean;
  baseUrl: string | null;
  defaultWebhookUrl?: string | null;
  workflows: Array<{
    id: string;
    name: string;
    active: boolean;
    editorUrl: string;
  }>;
  recentExecutions: Array<{
    id: string;
    workflowId: string;
    status: string;
    finished: boolean;
    startedAt: string | null;
  }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConnectorHubModal({ open, onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [liveN8n, setLiveN8n] = useState<LiveN8nStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New n8n webhook form
  const [whName, setWhName] = useState('n8n Procurement Bus');
  const [whProvider, setWhProvider] = useState('n8n');
  const [whUrl, setWhUrl] = useState('');
  const [whSecret, setWhSecret] = useState('');

  // Quick Udyam & IFSC Live Checkers
  const [udyamInput, setUdyamInput] = useState('');
  const [udyamRes, setUdyamRes] = useState<{ formatValid: boolean; note: string; officialPortalUrl: string } | null>(null);
  const [ifscInput, setIfscInput] = useState('');
  const [ifscRes, setIfscRes] = useState<{ valid: boolean; bank: string | null; branch: string | null; city: string | null; neft: boolean; rtgs: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, n8nData] = await Promise.all([
        apiJson<CatalogResponse>('/api/connectors/catalog'),
        apiJson<LiveN8nStatus>('/api/connectors/n8n/live-workflows').catch(() => null),
      ]);
      setCatalog(data);
      setLiveN8n(n8nData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Connector Hub');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiJson('/api/connectors/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name: whName,
          provider: whProvider,
          targetUrl: whUrl,
          signingSecret: whSecret || undefined,
          subscribedEvents: ['*'],
        }),
      });
      setWhUrl('');
      setWhSecret('');
      setNotice('Webhook registered! Click "Test Event" to fire a signed HMAC-SHA256 payload.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add webhook');
    }
  };

  const handleTestWebhook = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiJson<{ ok: boolean; httpStatus: number; durationMs: number; responsePreview: string }>(
        `/api/connectors/webhooks/${id}/test`,
        { method: 'POST' }
      );
      setNotice(
        res.ok
          ? `Test event delivered (HTTP ${res.httpStatus} in ${res.durationMs}ms).`
          : `Test delivery returned HTTP ${res.httpStatus}: ${res.responsePreview}`
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test dispatch failed');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    await apiJson(`/api/connectors/webhooks/${id}`, { method: 'DELETE' }).catch(() => {});
    load();
  };

  const handleVerifyUdyam = async () => {
    if (!udyamInput.trim()) return;
    setError(null);
    try {
      const res = await apiJson<{ formatValid: boolean; note: string; officialPortalUrl: string }>(
        '/api/connectors/verify-udyam',
        {
          method: 'POST',
          body: JSON.stringify({ udyamNumber: udyamInput.trim() }),
        }
      );
      setUdyamRes(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Udyam check failed');
    }
  };

  const handleVerifyIfsc = async () => {
    if (!ifscInput.trim()) return;
    setError(null);
    try {
      const res = await apiJson<{
        valid: boolean;
        bank: string | null;
        branch: string | null;
        city: string | null;
        neft: boolean;
        rtgs: boolean;
      }>(`/api/connectors/ifsc/${encodeURIComponent(ifscInput.trim().toUpperCase())}`);
      setIfscRes(res);
    } catch (err) {
      setIfscRes({ valid: false, bank: null, branch: null, city: null, neft: false, rtgs: false });
      setError(err instanceof Error ? err.message : 'Invalid IFSC code');
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Connectors, API Keys & n8n Automation Hub"
      footer={
        <>
          <button type="button" className="btn" onClick={load} disabled={loading}>
            <RefreshCw size={13} /> Refresh Status
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {error && (
        <div className="card" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: 10, marginBottom: 10, fontSize: 12.5 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="card" style={{ background: 'var(--success-soft)', color: 'var(--success)', padding: 10, marginBottom: 10, fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      {/* 0. Live Connected n8n Instance Monitor */}
      {liveN8n?.connected && (
        <div className="card" style={{ padding: 12, marginBottom: 14, border: '1px solid var(--success)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={14} color="var(--success)" /> Live n8n Connected ({liveN8n.baseUrl})
            </div>
            <span className="pill pill-success" style={{ fontSize: 10 }}>
              {liveN8n.workflows.filter((w) => w.active).length}/{liveN8n.workflows.length} Active
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {liveN8n.workflows.map((wf) => (
              <div
                key={wf.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-subtle)',
                }}
              >
                <span>{wf.name}</span>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`pill ${wf.active ? 'pill-success' : 'pill-warning'}`} style={{ fontSize: 10 }}>
                    {wf.active ? 'ACTIVE' : 'READY (Add OAuth)'}
                  </span>
                  <a href={wf.editorUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
                    Open ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 1. Ready-to-Import n8n Workflow Blueprints */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plug size={14} /> Ready-to-Import n8n Workflows (End-to-End Automation)
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(catalog?.n8nTemplates || []).map((tpl) => (
            <div
              key={tpl.slug}
              className="card"
              style={{ padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{tpl.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{tpl.description}</div>
              </div>
              <a
                className="btn btn-sm"
                href={`${API_BASE}${tpl.downloadPath}`}
                download={`kraya-n8n-${tpl.slug}.json`}
                style={{ whiteSpace: 'nowrap' }}
              >
                <Download size={12} /> JSON
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Connect n8n / Zapier / Make Webhook */}
      <div className="card" style={{ padding: 12, marginBottom: 16, background: 'var(--bg-subtle)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          Connect Outbound n8n / Automation Webhook (Signed HMAC-SHA256)
        </div>
        <form onSubmit={handleAddWebhook} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="grid-2" style={{ gap: 8 }}>
            <input
              placeholder="Webhook Name (e.g. n8n Money Leak Alerts)"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              required
            />
            <select value={whProvider} onChange={(e) => setWhProvider(e.target.value)}>
              <option value="n8n">n8n Workflow</option>
              <option value="make">Make.com</option>
              <option value="zapier">Zapier</option>
              <option value="custom">Custom HTTP Webhook</option>
            </select>
          </div>
          <input
            type="url"
            placeholder="https://your-n8n-instance.app.n8n.cloud/webhook/kraya-events"
            value={whUrl}
            onChange={(e) => setWhUrl(e.target.value)}
            required
          />
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Optional HMAC Signing Secret"
              value={whSecret}
              onChange={(e) => setWhSecret(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-sm btn-primary">
              + Connect Webhook
            </button>
          </div>
        </form>

        {(catalog?.webhooks || []).length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {catalog!.webhooks.map((wh) => (
              <div
                key={wh.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  fontSize: 12,
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <strong>{wh.name}</strong> <span className="pill" style={{ fontSize: 10 }}>{wh.provider}</span>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                    {wh.targetUrl}
                  </div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-sm" onClick={() => handleTestWebhook(wh.id)}>
                    <Send size={11} /> Test
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => handleDeleteWebhook(wh.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Instant Live Indian Verification Tools (Udyam MSME + Free Razorpay IFSC) */}
      <div className="grid-2" style={{ gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <ShieldCheck size={13} /> Udyam MSME Verifier (43B-h)
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              placeholder="UDYAM-KA-03-0012345"
              value={udyamInput}
              onChange={(e) => setUdyamInput(e.target.value)}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button type="button" className="btn btn-sm" onClick={handleVerifyUdyam}>
              Verify
            </button>
          </div>
          {udyamRes && (
            <div style={{ fontSize: 11.5, marginTop: 6, color: udyamRes.formatValid ? 'var(--text-secondary)' : 'var(--danger)' }}>
              {udyamRes.note}{' '}
              <a href={udyamRes.officialPortalUrl} target="_blank" rel="noreferrer">
                Official Portal ↗
              </a>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Building2 size={13} /> Live Indian Bank IFSC Lookup (Free)
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              placeholder="HDFC0000001"
              value={ifscInput}
              onChange={(e) => setIfscInput(e.target.value)}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button type="button" className="btn btn-sm" onClick={handleVerifyIfsc}>
              Lookup
            </button>
          </div>
          {ifscRes && (
            <div style={{ fontSize: 11.5, marginTop: 6, color: ifscRes.valid ? 'var(--success)' : 'var(--danger)' }}>
              {ifscRes.valid
                ? `${ifscRes.bank || 'Valid IFSC'}${ifscRes.branch ? ` · ${ifscRes.branch}` : ''}${ifscRes.city ? ` (${ifscRes.city})` : ''} · ${ifscRes.rtgs ? 'RTGS/NEFT OK' : 'NEFT'}`
                : 'Invalid IFSC code'}
            </div>
          )}
        </div>
      </div>

      {/* 4. External API & Connector Status Grid */}
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>External API Connectors &amp; Secrets Status</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(catalog?.connectors || []).map((c) => {
            const isConnected = c.status === 'connected' || c.status === 'free_ifsc_live';
            return (
              <div
                key={c.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{c.name}</strong>
                  <span className={`pill ${isConnected ? 'pill-success' : 'pill-warning'}`} style={{ fontSize: 10 }}>
                    {isConnected ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}{' '}
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{c.description}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  Env: {c.envVars.join(', ')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
}
