import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { buildRfc2822MimeMessage, toBase64Url } from '@kraya/agent-core';

describe('Gmail API & Resend Email Integrations', () => {
  const app = createApp({
    REQUIRE_AUTH: 'false',
    NODE_ENV: 'development',
  });

  it('GET /api/integrations includes both Resend and Gmail as first-class messaging integrations', async () => {
    const res = await app.request('/api/integrations');
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      integrations: Array<{
        id: string;
        name: string;
        category: string;
        status: string;
        requiredEnvVars: string[];
        supportedOperations: string[];
      }>;
    };

    expect(data.ok).toBe(true);

    const resendCard = data.integrations.find((i) => i.id === 'resend');
    expect(resendCard).toBeDefined();
    expect(resendCard?.name).toContain('Resend');
    expect(resendCard?.category).toBe('Messaging');
    expect(resendCard?.requiredEnvVars).toContain('RESEND_API_KEY');
    expect(resendCard?.supportedOperations.length).toBeGreaterThanOrEqual(3);

    const gmailCard = data.integrations.find((i) => i.id === 'gmail');
    expect(gmailCard).toBeDefined();
    expect(gmailCard?.name).toContain('Gmail');
    expect(gmailCard?.category).toBe('Messaging');
    expect(gmailCard?.requiredEnvVars).toContain('GMAIL_ACCESS_TOKEN');
    expect(gmailCard?.supportedOperations.length).toBeGreaterThanOrEqual(3);
  });

  it('POST /api/integrations/test/resend returns honest NOT_CONFIGURED when key is absent', async () => {
    const testApp = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      RESEND_API_KEY: '',
    });

    const res = await testApp.request('/api/integrations/test/resend', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      status: string;
      providerMode: string;
      details: { note?: string };
    };

    expect(body.service).toBe('resend');
    expect(body.status).toBe('NOT_CONFIGURED');
    expect(body.providerMode).toBe('unconfigured');
    expect(body.details.note).toContain('RESEND_API_KEY');
  });

  it('POST /api/integrations/test/resend verifies live connection when valid key is provided', async () => {
    const liveKey = process.env.RESEND_API_KEY || 'mock-resend-test-key-00000000';
    let fetchSpy;
    if (!process.env.RESEND_API_KEY) {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('api.resend.com')) {
          return new Response(JSON.stringify({ data: [{ name: 'resend.dev' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
      });
    }

    const testApp = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      RESEND_API_KEY: liveKey,
      RESEND_FROM_EMAIL: 'onboarding@resend.dev',
    });

    const res = await testApp.request('/api/integrations/test/resend', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      status: string;
      providerMode: string;
      details: { authenticated?: boolean };
    };

    expect(body.ok).toBe(true);
    expect(body.service).toBe('resend');
    expect(body.status).toBe('CONNECTED');
    expect(body.details.authenticated).toBe(true);

    // Ensure zero secrets in response
    const rawText = JSON.stringify(body);
    expect(rawText).not.toContain(liveKey);

    if (fetchSpy) {
      fetchSpy.mockRestore();
    }
  }, 15000);

  it('POST /api/integrations/test/gmail returns honest NOT_CONFIGURED when OAuth credentials are absent', async () => {
    const testApp = createApp({
      REQUIRE_AUTH: 'false',
      NODE_ENV: 'development',
      GMAIL_ACCESS_TOKEN: '',
      GMAIL_REFRESH_TOKEN: '',
    });

    const res = await testApp.request('/api/integrations/test/gmail', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      status: string;
      providerMode: string;
      details: { note?: string };
    };

    expect(body.service).toBe('gmail');
    expect(body.status).toBe('NOT_CONFIGURED');
    expect(body.providerMode).toBe('unconfigured');
    expect(body.details.note).toContain('Gmail credentials');
  });

  it('RFC 2822 MIME message generator creates compliant base64url payloads with attachments', () => {
    const mime = buildRfc2822MimeMessage({
      fromEmail: 'purchase@precisionforge.in',
      toEmail: 'sales@kaveripackaging.com',
      subject: 'Purchase Order #PO-2026-1049 — Corrugated Boxes',
      bodyText: 'Dear Vendor, please find attached our official PO. Expected delivery: 7 days.',
      htmlText: '<p>Dear Vendor, please find attached our official <strong>PO</strong>.</p>',
      attachments: [
        {
          filename: 'PO-1049.pdf',
          mimeType: 'application/pdf',
          base64Data: 'JVBERi0xLjQKJUtSYXlhIFBPClhYWFhYWA==',
        },
      ],
    });

    expect(mime).toContain('To: sales@kaveripackaging.com');
    expect(mime).toContain('From: purchase@precisionforge.in');
    expect(mime).toContain('Content-Type: multipart/mixed');
    expect(mime).toContain('filename="PO-1049.pdf"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).toContain('JVBERi0xLjQKJUtSYXlhIFBPClhYWFhYWA==');

    const b64Url = toBase64Url(mime);
    expect(b64Url).not.toContain('+');
    expect(b64Url).not.toContain('/');
    expect(b64Url).not.toContain('=');
  });

  it('POST /api/webhooks/resend handles delivery and bounce tracking notifications', async () => {
    const payload = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: 're_msg_1234567890',
        from: 'procurement@kraya.in',
        to: ['vendor@packaging.com'],
        subject: 'RFQ Delivery Confirmation',
      },
    };

    const res = await app.request('/api/webhooks/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; received: boolean; eventType: string; emailId: string };
    expect(body.ok).toBe(true);
    expect(body.received).toBe(true);
    expect(body.eventType).toBe('email.delivered');
    expect(body.emailId).toBe('re_msg_1234567890');
  });

  it('POST /api/outreach/send-live strictly enforces the human approval gate before sending', async () => {
    const res = await app.request('/api/outreach/send-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'resend_email',
        explicitApprovalConfirmed: false, // gate violated!
        toEmail: 'vendor@packaging.com',
        bodyText: 'Counter offer: ₹20/pc',
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Explicit human approval confirmation required');
  });

  it('POST /api/gmail/sync reports 400 when credentials are unconfigured', async () => {
    const res = await app.request('/api/gmail/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Gmail API credentials not configured');
  });
});
