import { formatIndianPhoneForWa } from './outreach.js';
import { fetchWithTimeoutAndRetry } from './http-utils.js';

/**
 * Step 2 Official Channel Connectors (Zero Ban Risk, Accio Invariant 9 Verified Receipts):
 * 1. Official Meta WhatsApp Business Cloud API (Inbound = FREE, 1,000 service replies/mo FREE)
 * 2. Resend Free Tier Email API (3,000 emails/mo FREE)
 * 3. Inbound Webhook Normalizers (WhatsApp Cloud API + Cloudflare Email Routing)
 */

export interface LiveSendReceipt {
  accepted: boolean;
  channel: 'whatsapp_cloud_api' | 'resend_email';
  providerMessageId: string | null;
  statusNote: string;
}

export async function sendViaWhatsAppCloudApi(params: {
  accessToken: string;
  phoneNumberId: string;
  toPhone: string;
  bodyText: string;
}): Promise<LiveSendReceipt> {
  const to = formatIndianPhoneForWa(params.toPhone);
  if (!to || to.length < 10) {
    throw new Error('Valid Indian WhatsApp phone number is required.');
  }

  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(params.phoneNumberId)}/messages`;
  const res = await fetchWithTimeoutAndRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: params.bodyText },
      }),
    },
    { timeoutMs: 15_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp Cloud API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { messages?: Array<{ id?: string }> };
  const msgId = data.messages?.[0]?.id ?? null;

  return {
    accepted: Boolean(msgId),
    channel: 'whatsapp_cloud_api',
    providerMessageId: msgId,
    statusNote: msgId
      ? 'Accepted by Meta WhatsApp Cloud API (note: acceptance confirms platform handoff, not vendor read receipt).'
      : 'No message ID returned by Meta.',
  };
}

export async function sendViaResendEmail(params: {
  apiKey: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
}): Promise<LiveSendReceipt> {
  if (!params.toEmail.includes('@')) {
    throw new Error('Valid recipient email address is required.');
  }

  const res = await fetchWithTimeoutAndRetry(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.fromEmail,
        to: [params.toEmail],
        subject: params.subject,
        text: params.bodyText,
      }),
    },
    { timeoutMs: 15_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id?: string };
  return {
    accepted: Boolean(data.id),
    channel: 'resend_email',
    providerMessageId: data.id ?? null,
    statusNote: data.id
      ? 'Accepted by Resend SMTP pipeline (delivery confirmed, read status separate).'
      : 'No Resend receipt ID returned.',
  };
}

export interface NormalizedInboundMessage {
  channel: 'whatsapp' | 'email' | 'phone';
  senderName: string | null;
  senderPhone: string | null;
  senderEmail: string | null;
  text: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  externalMessageId?: string | null;
}

/**
 * Parses official Meta WhatsApp Business Cloud API webhook payloads into normalized messages.
 */
export function parseWhatsAppCloudWebhook(payload: unknown): NormalizedInboundMessage[] {
  const results: NormalizedInboundMessage[] = [];
  const root = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: Array<{
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
            caption?: string;
            image?: { caption?: string; id?: string; mime_type?: string };
            document?: { caption?: string; filename?: string; id?: string; mime_type?: string };
            audio?: { id?: string; mime_type?: string };
          }>;
        };
      }>;
    }>;
  };

  for (const entry of root?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const val = change.value;
      const contactMap = new Map<string, string>();
      for (const c of val?.contacts ?? []) {
        if (c.wa_id && c.profile?.name) contactMap.set(c.wa_id, c.profile.name);
      }
      for (const msg of val?.messages ?? []) {
        const fromDigits = msg.from || '';
        const senderName = contactMap.get(fromDigits) ?? null;
        const phone10 = fromDigits.length === 12 && fromDigits.startsWith('91') ? fromDigits.slice(2) : fromDigits;

        let text = '';
        let mediaMimeType: string | null = null;
        if (msg.type === 'text') {
          text = msg.text?.body || '';
        } else if (msg.type === 'image') {
          text = msg.image?.caption || '[WhatsApp Image Attachment]';
          mediaMimeType = msg.image?.mime_type || 'image/jpeg';
        } else if (msg.type === 'document') {
          text = msg.document?.caption || `[WhatsApp Document: ${msg.document?.filename || 'file'}]`;
          mediaMimeType = msg.document?.mime_type || 'application/pdf';
        } else if (msg.type === 'audio') {
          text = '[WhatsApp Voice Note]';
          mediaMimeType = msg.audio?.mime_type || 'audio/ogg';
        }

        if (text) {
          results.push({
            channel: 'whatsapp',
            senderName,
            senderPhone: phone10 || null,
            senderEmail: null,
            text: senderName ? `From: ${senderName}. ${text}` : text,
            mediaMimeType,
            externalMessageId: msg.id ?? null,
          });
        }
      }
    }
  }
  return results;
}
