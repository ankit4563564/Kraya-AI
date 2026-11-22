/**
 * Kraya Zero-Cost Cloudflare Email Routing Ingress Worker.
 *
 * Deploy once on Cloudflare Workers Free Tier (`npx wrangler deploy` inside this folder),
 * attach Email Routing rule `rfq@yourdomain.in` or `bills@yourdomain.in` -> this Worker.
 * Every vendor email (including PDF quotes, scanned bills, Excel sheets, and photos) is
 * parsed via Web-standard MIME parsing and forwarded directly to Kraya's
 * `POST /api/webhooks/email-inbound` endpoint with HMAC replay protection!
 */

interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
}

interface Env {
  KRAYA_API_URL: string; // e.g. https://kraya-api.your-subdomain.workers.dev
  INBOUND_WEBHOOK_SECRET: string;
  KRAYA_WORKSPACE_ID: string;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Lightweight RFC-2045 multipart MIME extractor (zero external deps, runs natively in Workers).
 * Extracts plain text body + base64-encoded PDF/Image/Spreadsheet attachments.
 */
function parseRawEmailSimple(rawText: string): {
  text: string;
  attachments: Array<{ fileName: string; mimeType: string; contentBase64: string }>;
} {
  const boundaryMatch = rawText.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    const splitIdx = rawText.indexOf('\r\n\r\n');
    const body = splitIdx >= 0 ? rawText.slice(splitIdx + 4) : rawText;
    return { text: body.trim().slice(0, 20_000), attachments: [] };
  }

  const boundary = boundaryMatch[1];
  const parts = rawText.split(`--${boundary}`);
  const textChunks: string[] = [];
  const attachments: Array<{ fileName: string; mimeType: string; contentBase64: string }> = [];

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const hdr = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4).trim();
    const ctMatch = hdr.match(/Content-Type:\s*([^;\r\n]+)/i);
    const mimeType = (ctMatch?.[1] || 'text/plain').trim().toLowerCase();
    const fileMatch = hdr.match(/(?:filename|name)="?([^"\r\n;]+)"?/i);
    const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(hdr);

    if (fileMatch?.[1] && isBase64) {
      attachments.push({
        fileName: fileMatch[1].trim(),
        mimeType,
        contentBase64: body.replace(/\s+/g, ''),
      });
    } else if (mimeType === 'text/plain' && !fileMatch) {
      textChunks.push(body);
    }
  }

  return {
    text: textChunks.join('\n').trim().slice(0, 20_000),
    attachments,
  };
}

export default {
  async email(message: EmailMessage, env: Env) {
    const rawBuf = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(rawBuf);
    const { text, attachments } = parseRawEmailSimple(rawText);

    const subject = message.headers.get('subject') || '(No Subject)';
    const messageId =
      message.headers.get('message-id') || `cf-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestampSec = String(Math.floor(Date.now() / 1000));

    const target = `${env.KRAYA_API_URL.replace(/\/+$/, '')}/api/webhooks/email-inbound`;
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kraya-webhook-secret': env.INBOUND_WEBHOOK_SECRET,
        'x-kraya-workspace-id': env.KRAYA_WORKSPACE_ID,
        'x-kraya-webhook-timestamp': timestampSec,
        'x-kraya-delivery-id': messageId,
      },
      body: JSON.stringify({
        messageId,
        fromEmail: message.from,
        subject,
        text: text || `Inbound email from ${message.from} (${rawBuf.byteLength} bytes)`,
        attachments: attachments.length > 0 ? attachments : undefined,
        rawBackupPreviewSize: rawBuf.byteLength,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[Kraya Email Ingress] Forward failed (${res.status}): ${err.slice(0, 200)}`);
    }
  },
};
export { uint8ToBase64 };
