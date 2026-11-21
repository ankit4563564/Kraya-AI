import React, { useEffect, useState } from 'react';
import { Copy, Check, Mail, MessageCircle, ShieldCheck, Volume2, Download } from 'lucide-react';
import { API_BASE, apiJson, getStoredAuthToken, OutreachLang, OutreachPackage } from '../lib/api';
import { ModalDialog } from './ModalDialog';

export interface OutreachModalRequest {
  scenario: 'rfq_request' | 'counter_offer' | 'invoice_dispute' | 'po_issued' | 'delivery_chase';
  supplierName: string;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  itemDescription?: string;
  quantity?: number;
  unit?: string;
  targetRatePaise?: number;
  quotedRatePaise?: number;
  poNumber?: string;
  invoiceNumber?: string;
  disputeAmountPaise?: number;
  disputeReasons?: string[];
  dueDate?: string;
  creditDays?: number;
}

interface Props {
  request: OutreachModalRequest | null;
  defaultLanguage: OutreachLang;
  onClose: () => void;
}

const LANGUAGE_OPTIONS: Array<{ id: OutreachLang; label: string }> = [
  { id: 'english', label: 'English' },
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'hindi', label: 'हिन्दी' },
  { id: 'kannada', label: 'ಕನ್ನಡ' },
  { id: 'tamil', label: 'தமிழ்' },
  { id: 'malayalam', label: 'മലയാളം' },
];

export function OutreachModal({ request, defaultLanguage, onClose }: Props) {
  const [lang, setLang] = useState<OutreachLang>(defaultLanguage);
  const [pkg, setPkg] = useState<OutreachPackage | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  // VoiceStudio (Own-Voice Clone) + ElevenLabs Fallback Voice Note state
  const [useMyVoice, setUseMyVoice] = useState(true);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState<string | null>(null);
  const [voiceFileExt, setVoiceFileExt] = useState<'ogg' | 'mp3'>('ogg');
  const [voiceProviderNote, setVoiceProviderNote] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Step 2 Direct API Send (Resend / WhatsApp Cloud API) with Accio Invariant 9 Receipt
  const [liveReceipt, setLiveReceipt] = useState<string | null>(null);
  const [liveSending, setLiveSending] = useState(false);

  useEffect(() => {
    if (!request) return;
    setLang(defaultLanguage);
    setVoiceError(null);
    setVoiceProviderNote(null);
    setVoiceAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [request, defaultLanguage]);

  useEffect(() => {
    if (!request) return;
    let active = true;
    setLoading(true);
    setVoiceError(null);
    setVoiceProviderNote(null);
    apiJson<OutreachPackage>('/api/outreach/draft', {
      method: 'POST',
      body: JSON.stringify({ ...request, language: lang }),
    })
      .then((res) => {
        if (!active) return;
        setPkg(res);
        setEditedBody(res.body);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [request, lang]);

  const phoneDigits = (request?.supplierPhone || '').replace(/[^0-9]/g, '');
  const waPhone = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
  const waUrl = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(editedBody)}`
    : `https://wa.me/?text=${encodeURIComponent(editedBody)}`;

  const mailtoUrl = `mailto:${encodeURIComponent(request?.supplierEmail || '')}?subject=${encodeURIComponent(pkg?.subject || 'Procurement Message')}&body=${encodeURIComponent(editedBody)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleGenerateVoiceNote = async () => {
    if (!editedBody.trim()) return;
    setVoiceLoading(true);
    setVoiceError(null);
    setVoiceProviderNote(null);
    try {
      const token = getStoredAuthToken();
      const res = await fetch(`${API_BASE}/api/outreach/voice`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: editedBody,
          language: lang,
          useMyVoice,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Voice synthesis failed (${res.status})`);
      }
      const provider = res.headers.get('x-kraya-voice-provider');
      const fallbackReason = res.headers.get('x-kraya-voice-fallback-reason');
      const matchedLang = res.headers.get('x-kraya-voice-language');
      const contentType = res.headers.get('content-type') || '';
      setVoiceFileExt(contentType.includes('ogg') || contentType.includes('opus') ? 'ogg' : 'mp3');
      if (provider === 'voicestudio_own_voice') {
        setVoiceProviderNote(
          `Synthesized locally in your cloned voice via VoiceStudio (profile: ${matchedLang || 'default'})`
        );
      } else if (provider === 'elevenlabs_stock_voice') {
        setVoiceProviderNote(
          fallbackReason
            ? `${fallbackReason} Fell back to ElevenLabs stock voice.`
            : 'Synthesized with ElevenLabs stock voice.'
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setVoiceAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Failed to generate voice note');
    } finally {
      setVoiceLoading(false);
    }
  };

  const handleDirectLiveSend = async (channel: 'whatsapp_cloud_api' | 'resend_email') => {
    if (!editedBody.trim()) return;
    setLiveSending(true);
    setLiveReceipt(null);
    try {
      const res = await apiJson<{ accepted: boolean; providerMessageId: string | null; statusNote: string }>(
        '/api/outreach/send-live',
        {
          method: 'POST',
          body: JSON.stringify({
            channel,
            explicitApprovalConfirmed: true,
            toPhone: request?.supplierPhone || '',
            toEmail: request?.supplierEmail || '',
            subject: pkg?.subject || 'Procurement Message',
            bodyText: editedBody,
          }),
        }
      );
      setLiveReceipt(`Receipt ${res.providerMessageId || 'OK'}: ${res.statusNote}`);
    } catch (err) {
      setLiveReceipt(err instanceof Error ? err.message : 'Direct send failed');
    } finally {
      setLiveSending(false);
    }
  };

  return (
    <ModalDialog
      open={Boolean(request)}
      onClose={onClose}
      title="Approve & Send Vendor Outreach"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy Text'}
          </button>
          <a href={mailtoUrl} className="btn" target="_blank" rel="noreferrer">
            <Mail size={14} />
            Open Email
          </a>
          <a href={waUrl} className="btn btn-whatsapp" target="_blank" rel="noreferrer">
            <MessageCircle size={14} />
            Send on WhatsApp
          </a>
        </>
      }
    >
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="pill pill-accent">
            <ShieldCheck size={13} />
            Human-Gated · Official wa.me (₹0) + ElevenLabs Voice Note
          </span>
        </div>

        <div className="row" role="group" aria-label="Select outreach language">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`btn btn-sm ${lang === opt.id ? 'btn-primary' : ''}`}
              onClick={() => setLang(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Recipient: <strong>{request?.supplierName}</strong>
            {request?.supplierPhone ? ` · +91 ${request.supplierPhone}` : ''}
            {request?.supplierEmail ? ` · ${request.supplierEmail}` : ''}
          </div>
          {pkg?.subject && (
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              Subject: <strong>{pkg.subject}</strong>
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="outreach-body">Message Preview (Editable before sending)</label>
          <textarea
            id="outreach-body"
            rows={7}
            value={loading ? 'Drafting message...' : editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
          />
        </div>

        {/* VoiceStudio Own-Voice Clone + ElevenLabs 1-Click Voice Note Generator for WhatsApp */}
        <div className="card" style={{ padding: 12, background: 'var(--bg-app)' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong style={{ fontSize: 13 }}>WhatsApp Voice Note (Your Cloned Voice · VoiceStudio)</strong>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Local vendors reply 2× faster when they hear your own familiar voice in {lang}.
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useMyVoice}
                  onChange={(e) => setUseMyVoice(e.target.checked)}
                />
                Use my cloned voice
              </label>
              <button
                type="button"
                className="btn btn-sm"
                disabled={voiceLoading || !editedBody.trim()}
                onClick={handleGenerateVoiceNote}
              >
                <Volume2 size={13} />
                {voiceLoading ? 'Synthesizing...' : 'Generate Voice Note'}
              </button>
            </div>
          </div>

          {voiceProviderNote && (
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6 }}>{voiceProviderNote}</div>
          )}

          {voiceError && (
            <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>{voiceError}</div>
          )}

          {voiceAudioUrl && (
            <div className="row" style={{ marginTop: 10 }}>
              <audio controls src={voiceAudioUrl} style={{ height: 34, flex: 1 }} />
              <a
                href={voiceAudioUrl}
                download={`kraya-${request?.supplierName || 'vendor'}-${lang}.${voiceFileExt}`}
                className="btn btn-primary btn-sm"
              >
                <Download size={13} /> Download {voiceFileExt.toUpperCase()}
              </a>
            </div>
          )}
        </div>

        {/* Step 2 Optional Direct API Send with Verified Delivery Receipt */}
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>Step 2 Direct API (optional if keys configured):</span>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={liveSending || !request?.supplierEmail}
              onClick={() => handleDirectLiveSend('resend_email')}
            >
              Send Live Email (Resend)
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={liveSending || !request?.supplierPhone}
              onClick={() => handleDirectLiveSend('whatsapp_cloud_api')}
            >
              Send via WA Cloud API
            </button>
          </div>
        </div>
        {liveReceipt && (
          <div className="card" style={{ padding: 10, fontSize: 12, background: 'var(--bg-subtle)' }}>
            {liveReceipt}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
