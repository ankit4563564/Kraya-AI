import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  Mail,
  Phone,
  FileText,
  Search,
  Download,
} from 'lucide-react';
import { API_BASE, apiJson, UserRole } from '../lib/api';

interface SourceEventRow {
  id: string;
  channel: string;
  pillar: string;
  rawContent: string;
  mediaFileName: string | null;
  fileId: string | null;
  transcriptText: string | null;
  parsedSummary: string;
  confidenceScore: number;
  needsVerification: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

interface Props {
  userRole: UserRole;
  onDataMutated: () => void;
}

export function UnifiedInboxView({ userRole, onDataMutated }: Props) {
  const isCaReadOnly = userRole === 'ca';
  const [events, setEvents] = useState<SourceEventRow[]>([]);
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [query, setQuery] = useState('');

  const load = () => {
    apiJson<SourceEventRow[]>('/api/inbox')
      .then(setEvents)
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const handleVerify = async (id: string) => {
    await apiJson(`/api/inbox/${id}/verify`, { method: 'PATCH' });
    load();
    onDataMutated();
  };

  const filtered = events.filter((e) => {
    if (filterChannel !== 'all' && e.channel !== filterChannel) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        e.parsedSummary.toLowerCase().includes(q) ||
        e.rawContent.toLowerCase().includes(q) ||
        e.pillar.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const channelIcon = (ch: string) => {
    if (ch === 'whatsapp') return <MessageSquare size={14} />;
    if (ch === 'email') return <Mail size={14} />;
    if (ch === 'phone') return <Phone size={14} />;
    return <FileText size={14} />;
  };

  return (
    <div className="stack">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21 }}>Unified Multi-Source Inbox</h1>
          <p className="card-subtitle">
            Every WhatsApp chat, email PDF, handwritten parchi, and phone call transcript permanently linked in one searchable audit timeline.
          </p>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          {['all', 'whatsapp', 'email', 'phone', 'pdf', 'manual'].map((ch) => (
            <button
              key={ch}
              type="button"
              className={`btn btn-sm ${filterChannel === ch ? 'btn-primary' : ''}`}
              onClick={() => setFilterChannel(ch)}
            >
              {ch === 'all' ? 'All Channels' : ch.toUpperCase()}
            </button>
          ))}
        </div>
        <search style={{ position: 'relative', minWidth: 240 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input
            type="search"
            aria-label="Search unified inbox"
            placeholder="Search quotes, vendors, bills..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 10px 7px 32px',
              borderRadius: 8,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
            }}
          />
        </search>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <h3>Unified Inbox is clean</h3>
          <p>Drop a WhatsApp message, call recording, email, or PDF bill on the + New Task screen to log your first unified event.</p>
        </div>
      ) : (
        <div className="stack">
          {filtered.map((evt) => (
            <div key={evt.id} className="card">
              <div className="card-header" style={{ marginBottom: 8 }}>
                <div className="row">
                  <span className="pill pill-accent">
                    {channelIcon(evt.channel)}
                    {evt.channel.toUpperCase()}
                  </span>
                  <span className="pill">{evt.pillar.replace('_', ' ')}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(evt.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>

                {evt.needsVerification && !evt.verifiedAt ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={isCaReadOnly}
                    style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                    onClick={() => handleVerify(evt.id)}
                  >
                    <AlertTriangle size={13} />
                    Verify Low-Confidence Extraction ({Math.round(evt.confidenceScore * 100)}%)
                  </button>
                ) : (
                  <span className="pill pill-success">
                    <CheckCircle2 size={12} /> Verified Audit Trail
                  </span>
                )}
              </div>

              <div style={{ fontWeight: 600, marginBottom: 6 }}>{evt.parsedSummary}</div>
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--bg-subtle)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                }}
              >
                {evt.rawContent}
              </pre>
              {evt.mediaFileName && (
                <div className="row" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, justifyContent: 'space-between' }}>
                  <span>
                    Attachment: <strong>{evt.mediaFileName}</strong>
                  </span>
                  {evt.fileId && (
                    <a
                      href={`${API_BASE}/api/files/${evt.fileId}/download`}
                      className="btn btn-sm"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download size={12} /> Download from Vault
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
