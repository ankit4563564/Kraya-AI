import { fetchWithTimeoutAndRetry } from '../http-utils.js';

export type KrayaAutomationEventType =
  | 'po.approved'
  | 'po.amended'
  | 'po.cancelled'
  | 'grn.received'
  | 'invoice.audited'
  | 'invoice.leak_detected'
  | 'invoice.clean_ready_to_pay'
  | 'msme.43bh_cliff'
  | 'gstn.cancelled_alert'
  | 'rfq.created'
  | 'agent.critical_escalation'
  | 'morning.sweep_completed'
  | 'supplier.risk_drop_detected'
  | 'contract.redline_required'
  | 'pr.approval_required'
  | 'feedback.reliability_updated'
  | 'connector.test';

export interface AutomationWebhookTarget {
  id: string;
  name: string;
  targetUrl: string;
  signingSecret?: string | null;
  subscribedEvents: string[]; // ['*'] or list of KrayaAutomationEventType
  enabled: boolean;
}

export interface AutomationEventEnvelope {
  deliveryId: string;
  eventType: KrayaAutomationEventType;
  workspaceId: string;
  occurredAt: string;
  source: 'kraya-api';
  payload: Record<string, unknown>;
}

export interface AutomationDispatchResult {
  webhookId: string;
  webhookName: string;
  targetUrl: string;
  deliveryId: string;
  eventType: KrayaAutomationEventType;
  ok: boolean;
  httpStatus: number;
  durationMs: number;
  responsePreview: string;
}

async function computeHmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function webhookSubscribesTo(
  target: AutomationWebhookTarget,
  eventType: KrayaAutomationEventType
): boolean {
  if (!target.enabled) return false;
  if (eventType === 'connector.test') return true;
  if (!target.subscribedEvents || target.subscribedEvents.length === 0) return true;
  return (
    target.subscribedEvents.includes('*') ||
    target.subscribedEvents.includes(eventType)
  );
}

/**
 * Dispatches a cryptographically signed HMAC-SHA256 event envelope to an n8n / Make / Zapier / custom webhook.
 * Compatible with Cloudflare Workers and Node 22 (uses WebCrypto).
 */
export async function dispatchAutomationEvent(
  target: AutomationWebhookTarget,
  envelope: AutomationEventEnvelope
): Promise<AutomationDispatchResult> {
  const start = Date.now();
  const body = JSON.stringify(envelope);
  const timestampSec = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Kraya-Automation-Bus/1.0',
    'X-Kraya-Event': envelope.eventType,
    'X-Kraya-Delivery-Id': envelope.deliveryId,
    'X-Kraya-Timestamp': timestampSec,
  };

  if (target.signingSecret?.trim()) {
    const sigHex = await computeHmacSha256Hex(
      target.signingSecret.trim(),
      `${timestampSec}.${body}`
    );
    headers['X-Kraya-Signature-256'] = `sha256=${sigHex}`;
  }

  try {
    const res = await fetchWithTimeoutAndRetry(
      target.targetUrl,
      { method: 'POST', headers, body },
      { timeoutMs: 8_000, maxRetries: 1 }
    );
    const text = await res.text().catch(() => '');
    return {
      webhookId: target.id,
      webhookName: target.name,
      targetUrl: target.targetUrl,
      deliveryId: envelope.deliveryId,
      eventType: envelope.eventType,
      ok: res.ok,
      httpStatus: res.status,
      durationMs: Date.now() - start,
      responsePreview: text.slice(0, 300),
    };
  } catch (err) {
    return {
      webhookId: target.id,
      webhookName: target.name,
      targetUrl: target.targetUrl,
      deliveryId: envelope.deliveryId,
      eventType: envelope.eventType,
      ok: false,
      httpStatus: 0,
      durationMs: Date.now() - start,
      responsePreview: err instanceof Error ? err.message.slice(0, 300) : 'Network failure',
    };
  }
}

export interface N8nWorkflowBlueprint {
  slug: string;
  title: string;
  description: string;
  triggers: string[];
  requiredCredentials: string[];
  workflowJson: Record<string, unknown>;
}

/**
 * 4 Ready-to-Import Production n8n Workflow Blueprints for Kraya SMBs.
 * Users import the JSON directly into n8n (Cloud or Self-Hosted) and paste their KRAYA_API_URL + secret.
 */
export const N8N_WORKFLOW_TEMPLATES: N8nWorkflowBlueprint[] = [
  {
    slug: 'gmail-pdf-to-kraya',
    title: '1. Gmail / Outlook Vendor PDF Quotes & Bills → Kraya Inbox',
    description:
      'Watches your procurement inbox for incoming vendor quotes/invoices with PDF/image attachments and forwards them directly to Kraya /api/webhooks/email-inbound for automatic OCR, Math Audit & Money Leak Radar.',
    triggers: ['Gmail / Outlook Email Trigger (Every 5 mins)'],
    requiredCredentials: ['Gmail OAuth2', 'KRAYA_API_URL', 'INBOUND_WEBHOOK_SECRET', 'KRAYA_WORKSPACE_ID'],
    workflowJson: {
      name: 'Kraya — Gmail Vendor PDFs to Unified Inbox',
      nodes: [
        {
          id: 'gmail-trigger',
          name: 'Gmail Vendor Inbox',
          type: 'n8n-nodes-base.gmailTrigger',
          typeVersion: 1.2,
          position: [240, 300],
          parameters: {
            pollTimes: { item: [{ mode: 'everyMinute', minute: 5 }] },
            filters: { q: 'has:attachment (quote OR quotation OR invoice OR bill OR proforma)' },
            simple: false,
            options: { downloadAttachments: true },
          },
        },
        {
          id: 'prep-payload',
          name: 'Encode Attachments to Base64',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [480, 300],
          parameters: {
            jsCode: `const item = $input.first();
const attachments = [];
if (item.binary) {
  for (const [key, bin] of Object.entries(item.binary)) {
    const buf = await this.helpers.getBinaryDataBuffer(0, key);
    attachments.push({
      fileName: bin.fileName || key + '.pdf',
      mimeType: bin.mimeType || 'application/pdf',
      contentBase64: buf.toString('base64')
    });
  }
}
return [{
  json: {
    messageId: item.json.id || item.json.messageId,
    fromName: item.json.from?.value?.[0]?.name || '',
    fromEmail: item.json.from?.value?.[0]?.address || item.json.from || '',
    subject: item.json.subject || '',
    text: item.json.text || item.json.snippet || '',
    attachments,
    timestampSec: String(Math.floor(Date.now() / 1000))
  }
}];`,
          },
        },
        {
          id: 'post-kraya',
          name: 'POST to Kraya Inbound Email Webhook',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [740, 300],
          parameters: {
            method: 'POST',
            url: '={{ $env.KRAYA_API_URL }}/api/webhooks/email-inbound',
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: 'x-kraya-webhook-secret', value: '={{ $env.INBOUND_WEBHOOK_SECRET }}' },
                { name: 'x-kraya-workspace-id', value: '={{ $env.KRAYA_WORKSPACE_ID }}' },
                { name: 'x-kraya-webhook-timestamp', value: '={{ $json.timestampSec }}' },
                { name: 'x-kraya-delivery-id', value: '={{ $json.messageId }}' },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ messageId: $json.messageId, fromName: $json.fromName, fromEmail: $json.fromEmail, subject: $json.subject, text: $json.text, attachments: $json.attachments }) }}',
          },
        },
      ],
      connections: {
        'Gmail Vendor Inbox': { main: [[{ node: 'Encode Attachments to Base64', type: 'main', index: 0 }]] },
        'Encode Attachments to Base64': { main: [[{ node: 'POST to Kraya Inbound Email Webhook', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    slug: 'money-leak-escalation-alerts',
    title: '2. Money Leak & Section 43B(h) Cliff → WhatsApp / Slack / Google Sheets',
    description:
      'Receives real-time signed events from Kraya whenever a supplier overcharge, missing IRN, or March 31 MSME cliff is detected — instantly alerts the Owner on WhatsApp/Slack and logs every leak to a CFO Google Sheet.',
    triggers: ['invoice.leak_detected', 'msme.43bh_cliff', 'gstn.cancelled_alert', 'agent.critical_escalation'],
    requiredCredentials: ['Slack or WhatsApp Cloud API', 'Google Sheets OAuth2'],
    workflowJson: {
      name: 'Kraya — Money Leak & 43B(h) Escalation Alerts',
      nodes: [
        {
          id: 'kraya-webhook',
          name: 'Kraya Signed Event Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'kraya-money-leak-alerts',
            httpMethod: 'POST',
            responseMode: 'onReceived',
          },
        },
        {
          id: 'format-alert',
          name: 'Format CFO Alert Message',
          type: 'n8n-nodes-base.set',
          typeVersion: 3.4,
          position: [480, 300],
          parameters: {
            assignments: {
              assignments: [
                {
                  id: 'msg',
                  name: 'alertText',
                  type: 'string',
                  value: '=🚨 KRAYA CFO ALERT [{{ $json.body.eventType }}]\nWorkspace: {{ $json.body.workspaceId }}\nSummary: {{ $json.body.payload.headline || $json.body.payload.cfoVerdict || "Action required" }}\nExposure: ₹{{ (($json.body.payload.totalMoneyLeakPaise || 0) / 100).toFixed(2) }}\nIMS Action: {{ $json.body.payload.imsSuggestedAction || "REVIEW" }}',
                },
              ],
            },
          },
        },
        {
          id: 'slack-notify',
          name: 'Notify Finance Channel (Slack / Swap for WhatsApp or Telegram)',
          type: 'n8n-nodes-base.slack',
          typeVersion: 2.2,
          position: [740, 220],
          parameters: {
            resource: 'message',
            operation: 'post',
            text: '={{ $json.alertText }}',
          },
        },
        {
          id: 'sheets-log',
          name: 'Append to CFO Money Leak Ledger (Google Sheets)',
          type: 'n8n-nodes-base.googleSheets',
          typeVersion: 4.5,
          position: [740, 380],
          parameters: {
            operation: 'append',
            columns: { mappingMode: 'autoMapInputData' },
          },
        },
      ],
      connections: {
        'Kraya Signed Event Webhook': { main: [[{ node: 'Format CFO Alert Message', type: 'main', index: 0 }]] },
        'Format CFO Alert Message': {
          main: [
            [
              { node: 'Notify Finance Channel (Slack / Swap for WhatsApp or Telegram)', type: 'main', index: 0 },
              { node: 'Append to CFO Money Leak Ledger (Google Sheets)', type: 'main', index: 0 },
            ],
          ],
        },
      },
    },
  },
  {
    slug: 'zoho-tally-erp-auto-sync',
    title: '3. Clean Audited Invoices → Auto-Sync Zoho Books / Tally Prime + Callback',
    description:
      'Listens to Kraya invoice.clean_ready_to_pay events, pushes the verified bill directly into Zoho Books India or Tally Prime HTTP XML server, and posts the synced ERP voucher reference back to Kraya.',
    triggers: ['invoice.clean_ready_to_pay', 'po.approved'],
    requiredCredentials: ['Zoho Books India OAuth2 OR Tally Tunnel URL', 'KRAYA_API_URL', 'INBOUND_WEBHOOK_SECRET'],
    workflowJson: {
      name: 'Kraya — Zoho Books & Tally Prime Auto-Sync',
      nodes: [
        {
          id: 'kraya-clean-inv',
          name: 'Kraya Clean Invoice Event',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'kraya-erp-sync',
            httpMethod: 'POST',
            responseMode: 'onReceived',
          },
        },
        {
          id: 'push-zoho',
          name: 'Create Bill in Zoho Books India',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [500, 300],
          parameters: {
            method: 'POST',
            url: 'https://www.zohoapis.in/books/v3/bills?organization_id={{ $env.ZOHO_BOOKS_ORG_ID }}',
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'Authorization', value: '=Zoho-oauthtoken {{ $env.ZOHO_BOOKS_ACCESS_TOKEN }}' }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ bill_number: $json.body.payload.invoiceNumber, date: $json.body.payload.invoiceDate, notes: "Auto-audited by Kraya CFO Engine" }) }}',
          },
        },
        {
          id: 'callback-kraya',
          name: 'Report ERP Sync Back to Kraya',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [760, 300],
          parameters: {
            method: 'POST',
            url: '={{ $env.KRAYA_API_URL }}/api/connectors/n8n/callback',
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: 'x-kraya-webhook-secret', value: '={{ $env.INBOUND_WEBHOOK_SECRET }}' },
                { name: 'x-kraya-workspace-id', value: '={{ $("Kraya Clean Invoice Event").item.json.body.workspaceId }}' },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ action: "record_erp_sync", invoiceId: $("Kraya Clean Invoice Event").item.json.body.payload.invoiceId, erpProvider: "zoho_books", externalVoucherId: $json.bill?.bill_id || "synced" }) }}',
          },
        },
      ],
      connections: {
        'Kraya Clean Invoice Event': { main: [[{ node: 'Create Bill in Zoho Books India', type: 'main', index: 0 }]] },
        'Create Bill in Zoho Books India': { main: [[{ node: 'Report ERP Sync Back to Kraya', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    slug: 'morning-8am-cfo-briefing',
    title: '4. Daily 8:00 AM IST Autonomous Morning Sweep & CFO Digest',
    description:
      'Runs every morning at 8:00 AM IST, triggers Kraya’s Autonomous Operations Agent sweep across all workspaces, and sends a crisp daily digest of overdue deliveries, March 31 43B(h) dues, and GSTR-2B deadlines.',
    triggers: ['Schedule Trigger: Daily 08:00 AM IST (Mon-Sat)'],
    requiredCredentials: ['KRAYA_API_URL', 'CRON_SECRET', 'Email / WhatsApp / Telegram'],
    workflowJson: {
      name: 'Kraya — 8:00 AM IST Morning Sweep & CFO Briefing',
      nodes: [
        {
          id: 'cron-8am',
          name: 'Daily 8:00 AM IST Schedule',
          type: 'n8n-nodes-base.scheduleTrigger',
          typeVersion: 1.2,
          position: [240, 300],
          parameters: {
            rule: { interval: [{ field: 'cronExpression', expression: '30 2 * * 1-6' }] },
          },
        },
        {
          id: 'trigger-sweep',
          name: 'Trigger Kraya Autonomous Sweep',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [500, 300],
          parameters: {
            method: 'POST',
            url: '={{ $env.KRAYA_API_URL }}/api/internal/cron/morning-sweep',
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-cron-secret', value: '={{ $env.CRON_SECRET }}' }],
            },
          },
        },
        {
          id: 'send-digest',
          name: 'Email Morning CFO Digest',
          type: 'n8n-nodes-base.emailSend',
          typeVersion: 2.1,
          position: [760, 300],
          parameters: {
            subject: '=Kraya Morning Procurement Brief — {{ $json.totalTasksCreated }} New Action(s)',
            text: '=Morning autonomous sweep completed at {{ $json.ranAt }}.\nWorkspaces swept: {{ $json.workspacesSwept }}\nNew prioritized follow-ups queued: {{ $json.totalTasksCreated }}\n\nOpen Kraya Maintenance & Daily tab to approve 1-click vendor follow-ups.',
          },
        },
      ],
      connections: {
        'Daily 8:00 AM IST Schedule': { main: [[{ node: 'Trigger Kraya Autonomous Sweep', type: 'main', index: 0 }]] },
        'Trigger Kraya Autonomous Sweep': { main: [[{ node: 'Email Morning CFO Digest', type: 'main', index: 0 }]] },
      },
    },
  },
];
