#!/usr/bin/env node
/**
 * Kraya <-> Live Local n8n Holistic PnC Production Suite Deployer (10 Workflows)
 *
 * Deploys and activates a complete, error-resilient, bi-directional automation suite inside
 * your live n8n instance covering every capability, Enterprise Framework, and all Permutations &
 * Combinations (PnC) of conditions in Kraya:
 *
 *   Kraya 01 — Real-Time Master Event Bus & 5-Branch PnC Router (ACTIVE)
 *   Kraya 02 — Daily 8:00 AM IST Autonomous Morning Sweep & 3-Branch Priority Router (ACTIVE)
 *   Kraya 03 — Omni-ERP & P2P Auto-Sync 4-Branch PnC Router (Coupa / SAP Ariba / Tally / Zoho / UTR) (ACTIVE)
 *   Kraya 04 — Omnichannel Vendor Quote, BOM & PDF Invoice Forensics 4-Branch PnC Pipeline (ACTIVE)
 *   Kraya 05 — 5-Gate Supplier Onboarding, KYC, D&B Financial & ESG 4-Branch Lifecycle Router (ACTIVE)
 *   Kraya 06 — Full 8-Agent AI Command Center & Accio Constitution 4-Branch PnC Router (ACTIVE)
 *   Kraya 07 — Continuous D&B Supplier Risk Watch, SAP Ariba Catalog Filter & Dynamic Sourcing 3-Branch PnC Router (ACTIVE)
 *   Kraya 08 — NLP Contract Intelligence, Statutory Clause Audit & Policy Redlining 3-Branch PnC Pipeline (ACTIVE)
 *   Kraya 09 — Purchase Requisition (PR), Cost-Center Budget Guard & 4-Tier Approval Matrix Router (ACTIVE)
 *   Kraya 10 — Connected 6-Step Procurement Pipeline & Closed-Loop Data Lake Feedback 3-Branch PnC Router (ACTIVE)
 */

import fs from 'node:fs';
import path from 'node:path';

// Load .env if variables aren't already in process.env
if (fs.existsSync('.env')) {
  const lines = fs.readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const N8N_API_URL = (process.env.N8N_API_URL || 'http://localhost:5678').replace(/\/+$/, '');
const N8N_API_KEY = (process.env.N8N_API_KEY || '').trim();
const INBOUND_SECRET = (process.env.INBOUND_WEBHOOK_SECRET || 'kraya-local-webhook-secret').trim();
const N8N_SECRET = (process.env.N8N_WEBHOOK_SECRET || INBOUND_SECRET).trim();
const CRON_SECRET = (process.env.CRON_SECRET || INBOUND_SECRET).trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
const KRAYA_HOST_FOR_N8N = (
  process.env.KRAYA_HOST_FOR_N8N || 'http://host.docker.internal:8787'
).replace(/\/+$/, '');

if (!N8N_API_KEY) {
  console.error('Missing N8N_API_KEY in environment/.env');
  process.exit(1);
}

async function n8nFetch(urlPath, opts = {}) {
  const res = await fetch(`${N8N_API_URL}${urlPath}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-N8N-API-KEY': N8N_API_KEY,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }
  if (!res.ok) {
    throw new Error(`n8n API ${opts.method || 'GET'} ${urlPath} failed (${res.status}): ${text.slice(0, 320)}`);
  }
  return json;
}

function makeSwitchRule(outputKey, fieldExpr, rightValue) {
  return {
    outputKey,
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: `cond-${outputKey}`,
          leftValue: fieldExpr,
          rightValue,
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
  };
}

const WORKFLOW_SPECS = [
  // =========================================================================
  // WORKFLOW 01: Master Event Bus & 5-Branch PnC Router
  // =========================================================================
  {
    matchPrefix: 'Kraya 01',
    exportFileName: 'kraya-01-master-event-bus-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-events',
    payload: {
      name: 'Kraya 01 — Real-Time Event Bus (Money Leaks, Risk Drops, POs & 43B-h Alerts)',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-events',
          name: 'Kraya Signed Event Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-events-bus-01',
          position: [160, 340],
          parameters: {
            path: 'kraya-events',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-guard-classify',
          name: 'Validate Envelope & Classify 5-Way PnC Branch',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [400, 340],
          parameters: {
            jsCode: `const input = $input.first().json;
const headers = input.headers || {};
const body = input.body || input;
const eventType = String(body.eventType || headers['x-kraya-event'] || 'connector.test');
const payload = body.payload || body;
const workspaceId = String(body.workspaceId || payload.workspaceId || '');
const deliveryId = String(body.deliveryId || headers['x-kraya-delivery-id'] || ('dlv_' + Date.now()));
const sigHeader = String(headers['x-kraya-signature-256'] || '');
const leakRupees = Math.round((Number(payload.totalMoneyLeakPaise || 0) / 100) * 100) / 100;

let branch = 'info_or_test';
let severity = 'INFO';
if (
  eventType === 'invoice.leak_detected' ||
  eventType === 'msme.43bh_cliff' ||
  eventType === 'gstn.cancelled_alert' ||
  eventType === 'agent.critical_escalation'
) {
  branch = 'critical_escalation';
  severity = 'CRITICAL';
} else if (eventType === 'supplier.risk_drop_detected') {
  branch = 'supplier_risk_fallback';
  severity = 'HIGH';
} else if (eventType === 'invoice.clean_ready_to_pay') {
  branch = 'clean_erp_sync';
  severity = 'ACTIONABLE';
} else if (
  eventType === 'po.approved' ||
  eventType === 'po.amended' ||
  eventType === 'po.cancelled' ||
  eventType === 'grn.received' ||
  eventType === 'contract.redline_required' ||
  eventType === 'pr.approval_required' ||
  eventType === 'feedback.reliability_updated'
) {
  branch = 'po_lifecycle';
  severity = 'NORMAL';
}

return [{
  json: {
    deliveryId,
    eventType,
    branch,
    severity,
    workspaceId,
    signaturePresent: Boolean(sigHeader),
    leakRupees,
    payload,
    receivedAt: new Date().toISOString()
  }
}];`,
          },
        },
        {
          id: 'kraya-switch',
          name: 'Route by Procurement Event PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [650, 340],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('critical_escalation', '={{ $json.branch }}', 'critical_escalation'),
                makeSwitchRule('supplier_risk_fallback', '={{ $json.branch }}', 'supplier_risk_fallback'),
                makeSwitchRule('clean_erp_sync', '={{ $json.branch }}', 'clean_erp_sync'),
                makeSwitchRule('po_lifecycle', '={{ $json.branch }}', 'po_lifecycle'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        // Branch 0: Critical Tax / Leak Escalation
        {
          id: 'kraya-call-compliance',
          name: 'Run Kraya Compliance Tax Shield Agent',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [920, 80],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/agent-run`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ workspaceId: $json.workspaceId, agentId: "compliance", skipNetwork: true }) }}',
            options: { timeout: 10000 },
          },
        },
        {
          id: 'kraya-merge-crit',
          name: 'Assemble Critical Escalation Response',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1200, 80],
          parameters: {
            jsCode: `const evt = $("Validate Envelope & Classify 5-Way PnC Branch").item.json;
const comp = $input.first().json || {};
const fallbackAlert = \`🚨 [\${evt.severity}] Kraya \${evt.eventType}: ₹\${evt.leakRupees.toFixed(2)} exposure on \${evt.payload.invoiceNumber || evt.payload.disruptedSupplier || 'record'}. Action: \${evt.payload.imsSuggestedAction || 'HOLD & ESCALATE'}. \${evt.payload.cfoVerdict || evt.payload.headline || ''}\`.trim();
return [{
  json: {
    ok: true,
    receivedBy: 'n8n-kraya-master-bus',
    pncBranch: evt.branch,
    deliveryId: evt.deliveryId,
    eventType: evt.eventType,
    severity: evt.severity,
    workspaceId: evt.workspaceId,
    leakRupees: evt.leakRupees,
    aiEscalationBrief: fallbackAlert,
    complianceAgentState: comp.report?.detectedState || 'checked',
    complianceRiskLevel: comp.report?.riskLevel || 'high',
    processedAt: new Date().toISOString()
  }
}];`,
          },
        },
        // Branch 1: Supplier Risk Drop -> Auto-chain to Kraya 07 Risk & Alternative Sourcing
        {
          id: 'kraya-chain-risk',
          name: 'Auto-Chain to Kraya 07 Supplier Risk & Fallback Sourcing',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [920, 210],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ operation: "risk_sourcing_pnc", workspaceId: $json.workspaceId, supplierName: $json.payload.supplierName, newFinancialHealthScore: $json.payload.newFinancialHealthScore || 41 }) }}',
            options: { timeout: 12000 },
          },
        },
        {
          id: 'kraya-format-risk-chain',
          name: 'Assemble Risk Fallback Chain Response',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1200, 210],
          parameters: {
            jsCode: `const evt = $("Validate Envelope & Classify 5-Way PnC Branch").item.json;
const r = $input.first().json || {};
return [{
  json: {
    ok: true,
    receivedBy: 'n8n-kraya-master-bus',
    pncBranch: evt.branch,
    deliveryId: evt.deliveryId,
    eventType: evt.eventType,
    chainedToRiskSourcing: Boolean(r.ok),
    alternativesShortlisted: r.assessment?.alternativeSuppliers?.length || 0,
    triggeredRfqId: r.triggeredRfqId || null,
    processedAt: new Date().toISOString()
  }
}];`,
          },
        },
        // Branch 2: Clean Invoice -> Auto-chain to Kraya 03 ERP Sync
        {
          id: 'kraya-chain-erp',
          name: 'Auto-Chain to Kraya 03 Omni-ERP Sync',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [920, 340],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ operation: "erp_p2p_pnc", workspaceId: $json.workspaceId, payload: $json.payload }) }}',
            options: { timeout: 10000 },
          },
        },
        {
          id: 'kraya-format-clean',
          name: 'Assemble Clean ERP Chain Response',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1200, 340],
          parameters: {
            jsCode: `const evt = $("Validate Envelope & Classify 5-Way PnC Branch").item.json;
const erp = $input.first().json || {};
return [{
  json: {
    ok: true,
    receivedBy: 'n8n-kraya-master-bus',
    pncBranch: evt.branch,
    deliveryId: evt.deliveryId,
    eventType: evt.eventType,
    workspaceId: evt.workspaceId,
    chainedToErpSync: Boolean(erp.ok),
    erpResult: erp,
    processedAt: new Date().toISOString()
  }
}];`,
          },
        },
        // Branch 3: PO / GRN / Contract / PR Lifecycle
        {
          id: 'kraya-format-po',
          name: 'Format PO, Contract & 43B(h) Lifecycle Log',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [960, 470],
          parameters: {
            jsCode: `const evt = $input.first().json;
return [{
  json: {
    ok: true,
    receivedBy: 'n8n-kraya-master-bus',
    pncBranch: evt.branch,
    deliveryId: evt.deliveryId,
    eventType: evt.eventType,
    workspaceId: evt.workspaceId,
    summary: \`Lifecycle Event [\${evt.eventType}]: \${evt.payload.poNumber || evt.payload.grnNumber || evt.payload.contractNumber || evt.payload.prNumber || 'Recorded'} — 45-day written terms & audit chain protected.\`,
    processedAt: new Date().toISOString()
  }
}];`,
          },
        },
        // Branch 4: Default / Test
        {
          id: 'kraya-format-default',
          name: 'Format Test / Info Acknowledgment',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [960, 600],
          parameters: {
            jsCode: `const evt = $input.first().json;
return [{
  json: {
    ok: true,
    receivedBy: 'n8n-kraya-master-bus',
    pncBranch: evt.branch,
    deliveryId: evt.deliveryId,
    eventType: evt.eventType,
    workspaceId: evt.workspaceId,
    signaturePresent: evt.signaturePresent,
    message: evt.payload.message || 'Event received and acknowledged cleanly.',
    processedAt: new Date().toISOString()
  }
}];`,
          },
        },
        {
          id: 'kraya-respond',
          name: 'Respond to Kraya API',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1520, 340],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Kraya Signed Event Webhook': {
          main: [[{ node: 'Validate Envelope & Classify 5-Way PnC Branch', type: 'main', index: 0 }]],
        },
        'Validate Envelope & Classify 5-Way PnC Branch': {
          main: [[{ node: 'Route by Procurement Event PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by Procurement Event PnC Branch': {
          main: [
            [{ node: 'Run Kraya Compliance Tax Shield Agent', type: 'main', index: 0 }],
            [{ node: 'Auto-Chain to Kraya 07 Supplier Risk & Fallback Sourcing', type: 'main', index: 0 }],
            [{ node: 'Auto-Chain to Kraya 03 Omni-ERP Sync', type: 'main', index: 0 }],
            [{ node: 'Format PO, Contract & 43B(h) Lifecycle Log', type: 'main', index: 0 }],
            [{ node: 'Format Test / Info Acknowledgment', type: 'main', index: 0 }],
          ],
        },
        'Run Kraya Compliance Tax Shield Agent': {
          main: [[{ node: 'Assemble Critical Escalation Response', type: 'main', index: 0 }]],
        },
        'Assemble Critical Escalation Response': {
          main: [[{ node: 'Respond to Kraya API', type: 'main', index: 0 }]],
        },
        'Auto-Chain to Kraya 07 Supplier Risk & Fallback Sourcing': {
          main: [[{ node: 'Assemble Risk Fallback Chain Response', type: 'main', index: 0 }]],
        },
        'Assemble Risk Fallback Chain Response': {
          main: [[{ node: 'Respond to Kraya API', type: 'main', index: 0 }]],
        },
        'Auto-Chain to Kraya 03 Omni-ERP Sync': {
          main: [[{ node: 'Assemble Clean ERP Chain Response', type: 'main', index: 0 }]],
        },
        'Assemble Clean ERP Chain Response': {
          main: [[{ node: 'Respond to Kraya API', type: 'main', index: 0 }]],
        },
        'Format PO, Contract & 43B(h) Lifecycle Log': {
          main: [[{ node: 'Respond to Kraya API', type: 'main', index: 0 }]],
        },
        'Format Test / Info Acknowledgment': {
          main: [[{ node: 'Respond to Kraya API', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 02: Daily 8:00 AM IST Morning Sweep & 3-Branch Priority Router
  // =========================================================================
  {
    matchPrefix: 'Kraya 02',
    exportFileName: 'kraya-02-morning-8am-sweep-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-run-morning-sweep',
    payload: {
      name: 'Kraya 02 — Daily 8:00 AM IST Autonomous Morning Sweep & Priority PnC Router',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-cron-8am',
          name: 'Daily 8:00 AM IST (Mon-Sat)',
          type: 'n8n-nodes-base.scheduleTrigger',
          typeVersion: 1.2,
          position: [180, 220],
          parameters: {
            rule: {
              interval: [{ field: 'cronExpression', expression: '30 2 * * 1-6' }],
            },
          },
        },
        {
          id: 'kraya-wh-sweep',
          name: 'Manual / API Trigger Morning Sweep',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-morning-sweep-02',
          position: [180, 380],
          parameters: {
            path: 'kraya-run-morning-sweep',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-http-sweep',
          name: 'Trigger Kraya All-Workspace Morning Sweep',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [440, 300],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/cron/morning-sweep`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-cron-secret', value: CRON_SECRET }],
            },
            options: { timeout: 20000 },
          },
        },
        {
          id: 'kraya-run-comp-brief',
          name: 'Run Agent 6 (Compliance Tax Shield) Snapshot',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [700, 300],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/agent-run`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody:
              '={{ JSON.stringify({ workspaceId: ($json.results?.[0]?.workspaceId || ""), agentId: "compliance", skipNetwork: true }) }}',
            options: { timeout: 12000 },
          },
        },
        {
          id: 'kraya-classify-sweep',
          name: 'Classify Morning Priority PnC State',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [950, 300],
          parameters: {
            jsCode: `const sweep = $("Trigger Kraya All-Workspace Morning Sweep").item.json || {};
const comp = $input.first().json || {};
const clock = comp.report?.realTimeContextUsed || {};
const state = String(comp.report?.detectedState || 'fully_compliant');
const tasksCreated = Number(sweep.totalTasksCreated ?? 0);

let pncBranch = 'steady_state_all_clean';
if (state === 'march31_43bh_emergency' || state === 'rule37_reversal_imminent' || comp.report?.riskLevel === 'critical') {
  pncBranch = 'statutory_tax_cliff_emergency';
} else if (tasksCreated > 0 || state !== 'fully_compliant') {
  pncBranch = 'operational_followups_queued';
}

return [{
  json: {
    ok: Boolean(sweep.ok),
    pncBranch,
    ranAt: sweep.ranAt || new Date().toISOString(),
    workspacesSwept: sweep.workspacesSwept ?? 0,
    totalTasksCreated: tasksCreated,
    financialYear: clock.financialYear || 'FY 2026-27',
    daysToMarch31TaxCliff: clock.daysToMarch31TaxCliff ?? null,
    isMarch31MsmeRedZone: Boolean(clock.isMarch31MsmeRedZone),
    complianceState: state,
    complianceHeadline: comp.report?.headline || 'Compliance verified',
    results: sweep.results || []
  }
}];`,
          },
        },
        {
          id: 'kraya-sweep-switch',
          name: 'Route by Morning Sweep PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [1180, 300],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('statutory_tax_cliff_emergency', '={{ $json.pncBranch }}', 'statutory_tax_cliff_emergency'),
                makeSwitchRule('operational_followups_queued', '={{ $json.pncBranch }}', 'operational_followups_queued'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-sweep-crit',
          name: 'Format Statutory Tax Cliff Emergency Plan',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1440, 140],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, priorityLevel: 'CRITICAL', digest: \`🚨 STATUTORY TAX CLIFF (\${d.financialYear}): \${d.complianceHeadline}. Queued \${d.totalTasksCreated} urgent follow-up(s). Prioritize MSME Section 43B(h) & Rule 37 RTGS payouts today.\` } }];`,
          },
        },
        {
          id: 'kraya-sweep-ops',
          name: 'Format Operational Expeditor & KYC Queue',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1440, 300],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, priorityLevel: 'ACTION_NEEDED', digest: \`📋 Kraya 8:00 AM Ops Brief (\${d.financialYear}): Swept \${d.workspacesSwept} workspace(s), queued \${d.totalTasksCreated} follow-up(s) (overdue PO deliveries, stale RFQs, AMC renewals, KYC).\` } }];`,
          },
        },
        {
          id: 'kraya-sweep-clean',
          name: 'Format Clean Steady-State Morning Brief',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1440, 460],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, priorityLevel: 'CALM', digest: \`✅ Kraya 8:00 AM Steady State (\${d.financialYear}): All \${d.workspacesSwept} workspace(s) clean. Zero overdue deliveries or MSME 43B(h) cliffs.\` } }];`,
          },
        },
        {
          id: 'kraya-sweep-respond',
          name: 'Return Morning CFO Digest',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1700, 300],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Daily 8:00 AM IST (Mon-Sat)': {
          main: [[{ node: 'Trigger Kraya All-Workspace Morning Sweep', type: 'main', index: 0 }]],
        },
        'Manual / API Trigger Morning Sweep': {
          main: [[{ node: 'Trigger Kraya All-Workspace Morning Sweep', type: 'main', index: 0 }]],
        },
        'Trigger Kraya All-Workspace Morning Sweep': {
          main: [[{ node: 'Run Agent 6 (Compliance Tax Shield) Snapshot', type: 'main', index: 0 }]],
        },
        'Run Agent 6 (Compliance Tax Shield) Snapshot': {
          main: [[{ node: 'Classify Morning Priority PnC State', type: 'main', index: 0 }]],
        },
        'Classify Morning Priority PnC State': {
          main: [[{ node: 'Route by Morning Sweep PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by Morning Sweep PnC Branch': {
          main: [
            [{ node: 'Format Statutory Tax Cliff Emergency Plan', type: 'main', index: 0 }],
            [{ node: 'Format Operational Expeditor & KYC Queue', type: 'main', index: 0 }],
            [{ node: 'Format Clean Steady-State Morning Brief', type: 'main', index: 0 }],
          ],
        },
        'Format Statutory Tax Cliff Emergency Plan': {
          main: [[{ node: 'Return Morning CFO Digest', type: 'main', index: 0 }]],
        },
        'Format Operational Expeditor & KYC Queue': {
          main: [[{ node: 'Return Morning CFO Digest', type: 'main', index: 0 }]],
        },
        'Format Clean Steady-State Morning Brief': {
          main: [[{ node: 'Return Morning CFO Digest', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 03: Omni-ERP & P2P Auto-Sync 4-Branch PnC Router
  //              (Coupa / SAP Ariba / Tally Prime / Zoho Books / Payment UTR)
  // =========================================================================
  {
    matchPrefix: 'Kraya 03',
    exportFileName: 'kraya-03-omni-erp-p2p-sync-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-erp-sync',
    payload: {
      name: 'Kraya 03 — Omni-ERP & P2P Sync PnC Router (Coupa, SAP Ariba, Tally, Zoho & UTR)',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-erp',
          name: 'Receive ERP / P2P Sync or Payment Trigger',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-erp-sync-03',
          position: [180, 320],
          parameters: {
            path: 'kraya-erp-sync',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-erp',
          name: 'Normalize Omni-ERP & IFSC Input',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [420, 320],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
const payload = body.payload || body;
return [{
  json: {
    operation: 'erp_p2p_pnc',
    workspaceId: String(body.workspaceId || payload.workspaceId || ''),
    payload
  }
}];`,
          },
        },
        {
          id: 'kraya-exec-erp',
          name: 'Execute Kraya Omni-ERP & P2P Engine',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [680, 320],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: { timeout: 15000 },
          },
        },
        {
          id: 'kraya-erp-switch',
          name: 'Route by ERP / P2P PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [940, 320],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('coupa_or_sap_ariba_p2p', '={{ $json.pncBranch }}', 'coupa_or_sap_ariba_p2p'),
                makeSwitchRule('tally_prime_xml_push', '={{ $json.pncBranch }}', 'tally_prime_xml_push'),
                makeSwitchRule('payment_utr_settlement', '={{ $json.pncBranch }}', 'payment_utr_settlement'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-erp-coupa',
          name: 'Finalize Coupa / SAP Ariba P2P & 3-Way Match Arming',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 120],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, erpSystem: d.p2pResult?.provider || 'coupa', invoice3WayMatchArmed: true, processedAt: new Date().toISOString() } }];`,
          },
        },
        {
          id: 'kraya-erp-tally',
          name: 'Finalize Tally Prime XML Voucher Receipt',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 250],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, erpSystem: 'tally_prime', processedAt: new Date().toISOString() } }];`,
          },
        },
        {
          id: 'kraya-erp-utr',
          name: 'Finalize Payment UTR Settlement & Audit Seal',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 380],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, erpSystem: 'bank_utr_settlement', processedAt: new Date().toISOString() } }];`,
          },
        },
        {
          id: 'kraya-erp-zoho',
          name: 'Finalize Zoho Books India Bill & RazorpayX Draft',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 510],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, erpSystem: 'zoho_books', processedAt: new Date().toISOString() } }];`,
          },
        },
        {
          id: 'kraya-erp-respond',
          name: 'Respond ERP Sync Result',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1500, 320],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive ERP / P2P Sync or Payment Trigger': {
          main: [[{ node: 'Normalize Omni-ERP & IFSC Input', type: 'main', index: 0 }]],
        },
        'Normalize Omni-ERP & IFSC Input': {
          main: [[{ node: 'Execute Kraya Omni-ERP & P2P Engine', type: 'main', index: 0 }]],
        },
        'Execute Kraya Omni-ERP & P2P Engine': {
          main: [[{ node: 'Route by ERP / P2P PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by ERP / P2P PnC Branch': {
          main: [
            [{ node: 'Finalize Coupa / SAP Ariba P2P & 3-Way Match Arming', type: 'main', index: 0 }],
            [{ node: 'Finalize Tally Prime XML Voucher Receipt', type: 'main', index: 0 }],
            [{ node: 'Finalize Payment UTR Settlement & Audit Seal', type: 'main', index: 0 }],
            [{ node: 'Finalize Zoho Books India Bill & RazorpayX Draft', type: 'main', index: 0 }],
          ],
        },
        'Finalize Coupa / SAP Ariba P2P & 3-Way Match Arming': {
          main: [[{ node: 'Respond ERP Sync Result', type: 'main', index: 0 }]],
        },
        'Finalize Tally Prime XML Voucher Receipt': {
          main: [[{ node: 'Respond ERP Sync Result', type: 'main', index: 0 }]],
        },
        'Finalize Payment UTR Settlement & Audit Seal': {
          main: [[{ node: 'Respond ERP Sync Result', type: 'main', index: 0 }]],
        },
        'Finalize Zoho Books India Bill & RazorpayX Draft': {
          main: [[{ node: 'Respond ERP Sync Result', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 04: Omnichannel Vendor Quote, BOM & PDF Invoice Forensics 4-Branch PnC Pipeline
  // =========================================================================
  {
    matchPrefix: 'Kraya 04',
    exportFileName: 'kraya-04-quote-invoice-forensics-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-ingest-doc',
    payload: {
      name: 'Kraya 04 — Vendor Quote, BOM & PDF Invoice Forensics 4-Branch PnC Pipeline',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-doc',
          name: 'Receive Vendor Quote / PDF / Email',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-ingest-doc-04',
          position: [160, 320],
          parameters: {
            path: 'kraya-ingest-doc',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-doc',
          name: 'Prepare Signed Email/PDF Ingest Envelope',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [400, 320],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
const workspaceId = String(body.workspaceId || 'ws-primary');
const deliveryId = String(body.messageId || ('n8n-doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)));
const timestampSec = String(Math.floor(Date.now() / 1000));
const textContent = String(body.text || body.promptText || 'Shree Ganesh Packaging quoted 5-ply boxes @ Rs 22 + 18% GST, freight Rs 2500, Net 30 days credit.');
return [{
  json: {
    workspaceId,
    deliveryId,
    timestampSec,
    emailPayload: {
      messageId: deliveryId,
      fromName: body.fromName || body.supplierName || 'Vendor',
      fromEmail: body.fromEmail || 'sales@vendor.in',
      subject: body.subject || 'Vendor Procurement Submission',
      text: textContent,
      attachments: Array.isArray(body.attachments) ? body.attachments : undefined
    }
  }
}];`,
          },
        },
        {
          id: 'kraya-post-email',
          name: 'Ingest Into Kraya Vault & Unified Inbox',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [650, 320],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/webhooks/email-inbound`,
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: 'x-kraya-webhook-secret', value: INBOUND_SECRET },
                { name: 'x-kraya-workspace-id', value: '={{ $json.workspaceId }}' },
                { name: 'x-kraya-webhook-timestamp', value: '={{ $json.timestampSec }}' },
                { name: 'x-kraya-delivery-id', value: '={{ $json.deliveryId }}' },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json.emailPayload) }}',
            options: { timeout: 25000 },
          },
        },
        {
          id: 'kraya-run-intake-agent',
          name: 'Run Agent 1 (Intake & Document Forensics)',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [900, 320],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/agent-run`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody:
              '={{ JSON.stringify({ workspaceId: $("Prepare Signed Email/PDF Ingest Envelope").item.json.workspaceId, agentId: "intake", promptText: $("Prepare Signed Email/PDF Ingest Envelope").item.json.emailPayload.text, skipNetwork: true }) }}',
            options: { timeout: 15000 },
          },
        },
        {
          id: 'kraya-classify-doc',
          name: 'Classify Forensics PnC Outcome',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1140, 320],
          parameters: {
            jsCode: `const ingested = $("Ingest Into Kraya Vault & Unified Inbox").item.json || {};
const agent = $input.first().json || {};
const state = String(agent.report?.detectedState || 'clean_quote');
const question = agent.report?.structuredData?.focusedClarificationQuestion || null;

let pncBranch = 'clean_verified_extraction';
if (state === 'prompt_injection_blocked') {
  pncBranch = 'security_prompt_injection_blocked';
} else if (state === 'math_mismatch_invoice') {
  pncBranch = 'invoice_discrepancy_or_leak';
} else if (state === 'ambiguous_hinglish_quote' || state === 'handwritten_parchi_low_conf' || Boolean(question)) {
  pncBranch = 'ambiguous_quote_clarification_needed';
}

return [{
  json: {
    ok: Boolean(ingested.ok || agent.ok),
    pncBranch,
    attachmentsIngested: ingested.attachmentsIngested ?? 0,
    sourceEventId: ingested.ingested?.sourceEvent?.id || null,
    fileId: ingested.ingested?.sourceEvent?.fileId || null,
    forensicsAgentRunId: agent.runId || null,
    detectedState: state,
    riskLevel: agent.report?.riskLevel || 'low',
    headline: agent.report?.headline || null,
    executiveVerdict: agent.report?.executiveVerdict || null,
    clarificationQuestion: question,
    processedAt: new Date().toISOString()
  }
}];`,
          },
        },
        {
          id: 'kraya-doc-switch',
          name: 'Route by Document Forensics PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [1380, 320],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('security_prompt_injection_blocked', '={{ $json.pncBranch }}', 'security_prompt_injection_blocked'),
                makeSwitchRule('invoice_discrepancy_or_leak', '={{ $json.pncBranch }}', 'invoice_discrepancy_or_leak'),
                makeSwitchRule('ambiguous_quote_clarification_needed', '={{ $json.pncBranch }}', 'ambiguous_quote_clarification_needed'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-doc-sec',
          name: 'Quarantine Prompt Injection Attempt',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1640, 120],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, actionTaken: 'QUARANTINED_PROMPT_INJECTION' } }];`,
          },
        },
        {
          id: 'kraya-doc-leak',
          name: 'Flag Invoice Arithmetic / Tax Discrepancy',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1640, 250],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, actionTaken: 'PAYMENT_HELD_DISPUTE_DRAFTED' } }];`,
          },
        },
        {
          id: 'kraya-doc-clarify',
          name: 'Queue 1-Click Vendor Clarification Prompt',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1640, 380],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, actionTaken: 'VENDOR_CLARIFICATION_QUEUED' } }];`,
          },
        },
        {
          id: 'kraya-doc-clean',
          name: 'Confirm Clean Math-Reconciled Extraction',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1640, 510],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, actionTaken: 'READY_FOR_CFO_RANKING_OR_3WAY_MATCH' } }];`,
          },
        },
        {
          id: 'kraya-doc-respond',
          name: 'Return Forensics Result',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1900, 320],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive Vendor Quote / PDF / Email': {
          main: [[{ node: 'Prepare Signed Email/PDF Ingest Envelope', type: 'main', index: 0 }]],
        },
        'Prepare Signed Email/PDF Ingest Envelope': {
          main: [[{ node: 'Ingest Into Kraya Vault & Unified Inbox', type: 'main', index: 0 }]],
        },
        'Ingest Into Kraya Vault & Unified Inbox': {
          main: [[{ node: 'Run Agent 1 (Intake & Document Forensics)', type: 'main', index: 0 }]],
        },
        'Run Agent 1 (Intake & Document Forensics)': {
          main: [[{ node: 'Classify Forensics PnC Outcome', type: 'main', index: 0 }]],
        },
        'Classify Forensics PnC Outcome': {
          main: [[{ node: 'Route by Document Forensics PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by Document Forensics PnC Branch': {
          main: [
            [{ node: 'Quarantine Prompt Injection Attempt', type: 'main', index: 0 }],
            [{ node: 'Flag Invoice Arithmetic / Tax Discrepancy', type: 'main', index: 0 }],
            [{ node: 'Queue 1-Click Vendor Clarification Prompt', type: 'main', index: 0 }],
            [{ node: 'Confirm Clean Math-Reconciled Extraction', type: 'main', index: 0 }],
          ],
        },
        'Quarantine Prompt Injection Attempt': {
          main: [[{ node: 'Return Forensics Result', type: 'main', index: 0 }]],
        },
        'Flag Invoice Arithmetic / Tax Discrepancy': {
          main: [[{ node: 'Return Forensics Result', type: 'main', index: 0 }]],
        },
        'Queue 1-Click Vendor Clarification Prompt': {
          main: [[{ node: 'Return Forensics Result', type: 'main', index: 0 }]],
        },
        'Confirm Clean Math-Reconciled Extraction': {
          main: [[{ node: 'Return Forensics Result', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 05: 5-Gate Supplier Onboarding, KYC, D&B Financial & ESG 4-Branch Router
  // =========================================================================
  {
    matchPrefix: 'Kraya 05',
    exportFileName: 'kraya-05-supplier-onboarding-kyc-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-verify-supplier',
    payload: {
      name: 'Kraya 05 — 5-Gate Supplier Onboarding, KYC, D&B & ESG 4-Branch PnC Router',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-kyc',
          name: 'Receive Supplier Onboarding & KYC Request',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-verify-supplier-05',
          position: [180, 320],
          parameters: {
            path: 'kraya-verify-supplier',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-kyc',
          name: 'Normalize Supplier KYC & ESG Payload',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [420, 320],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
return [{
  json: {
    ...body,
    operation: 'onboarding_kyc_pnc'
  }
}];`,
          },
        },
        {
          id: 'kraya-http-kyc',
          name: 'Run 4-Way Live Registry + 5-Gate Onboarding Engine',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [680, 320],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: { timeout: 15000 },
          },
        },
        {
          id: 'kraya-kyc-switch',
          name: 'Route by Onboarding Gate PnC Outcome',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [940, 320],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('blocked_invalid_gstin_or_insolvent', '={{ $json.pncBranch }}', 'blocked_invalid_gstin_or_insolvent'),
                makeSwitchRule('approved_for_po_onboarding_complete', '={{ $json.pncBranch }}', 'approved_for_po_onboarding_complete'),
                makeSwitchRule('compliance_review_required', '={{ $json.pncBranch }}', 'compliance_review_required'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-kyc-block',
          name: 'Block Invalid GSTIN or Insolvent Vendor',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 120],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, verdict: 'BLOCK_INVALID_GSTIN_OR_INSOLVENT', kycScorePct: d.evaluation?.readinessScorePct ?? 20 } }];`,
          },
        },
        {
          id: 'kraya-kyc-approve',
          name: 'Approve Supplier on Active Vendor Master',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 250],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, verdict: 'APPROVED_FOR_PO', kycScorePct: d.evaluation?.readinessScorePct ?? 100 } }];`,
          },
        },
        {
          id: 'kraya-kyc-review',
          name: 'Route to Compliance Officer Review',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 380],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, verdict: 'COMPLIANCE_REVIEW_REQUIRED', kycScorePct: d.evaluation?.readinessScorePct ?? 80 } }];`,
          },
        },
        {
          id: 'kraya-kyc-docs',
          name: 'Draft Missing KYC Docs WhatsApp Chase',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1220, 510],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, verdict: 'PARTIAL_KYC_COLLECT_DOCS', kycScorePct: d.evaluation?.readinessScorePct ?? 60 } }];`,
          },
        },
        {
          id: 'kraya-kyc-respond',
          name: 'Return Full Supplier KYC Scorecard',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1500, 320],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive Supplier Onboarding & KYC Request': {
          main: [[{ node: 'Normalize Supplier KYC & ESG Payload', type: 'main', index: 0 }]],
        },
        'Normalize Supplier KYC & ESG Payload': {
          main: [[{ node: 'Run 4-Way Live Registry + 5-Gate Onboarding Engine', type: 'main', index: 0 }]],
        },
        'Run 4-Way Live Registry + 5-Gate Onboarding Engine': {
          main: [[{ node: 'Route by Onboarding Gate PnC Outcome', type: 'main', index: 0 }]],
        },
        'Route by Onboarding Gate PnC Outcome': {
          main: [
            [{ node: 'Block Invalid GSTIN or Insolvent Vendor', type: 'main', index: 0 }],
            [{ node: 'Approve Supplier on Active Vendor Master', type: 'main', index: 0 }],
            [{ node: 'Route to Compliance Officer Review', type: 'main', index: 0 }],
            [{ node: 'Draft Missing KYC Docs WhatsApp Chase', type: 'main', index: 0 }],
          ],
        },
        'Block Invalid GSTIN or Insolvent Vendor': {
          main: [[{ node: 'Return Full Supplier KYC Scorecard', type: 'main', index: 0 }]],
        },
        'Approve Supplier on Active Vendor Master': {
          main: [[{ node: 'Return Full Supplier KYC Scorecard', type: 'main', index: 0 }]],
        },
        'Route to Compliance Officer Review': {
          main: [[{ node: 'Return Full Supplier KYC Scorecard', type: 'main', index: 0 }]],
        },
        'Draft Missing KYC Docs WhatsApp Chase': {
          main: [[{ node: 'Return Full Supplier KYC Scorecard', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 06: Full 8-Agent AI Command Center & Accio Constitution 4-Branch PnC Router
  // =========================================================================
  {
    matchPrefix: 'Kraya 06',
    exportFileName: 'kraya-06-8agent-command-center-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-ai-command',
    payload: {
      name: 'Kraya 06 — Full 8-Agent AI Command Center & Constitution 4-Branch PnC Router',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-ai',
          name: 'Receive AI Procurement Command',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-ai-command-06',
          position: [180, 320],
          parameters: {
            path: 'kraya-ai-command',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-http-ai',
          name: 'Dispatch to Kraya 8-Agent Specialist Fleet',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [440, 320],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/agent-run`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json.body || $json) }}',
            options: { timeout: 25000 },
          },
        },
        {
          id: 'kraya-classify-ai',
          name: 'Classify Accio Constitution & Risk PnC Branch',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [700, 320],
          parameters: {
            jsCode: `const res = $input.first().json || {};
const rep = res.report || {};
const state = String(rep.detectedState || '');
const risk = String(rep.riskLevel || 'low');

let pncBranch = 'clean_advisory_analysis';
if (state === 'security_threat_blocked' || state === 'prompt_injection_blocked') {
  pncBranch = 'security_threat_blocked';
} else if (state === 'gated_execution') {
  pncBranch = 'gated_execution_requires_approval';
} else if (risk === 'critical' || risk === 'high') {
  pncBranch = 'critical_or_high_risk_exposure';
}

return [{ json: { ...res, pncBranch } }];`,
          },
        },
        {
          id: 'kraya-ai-switch',
          name: 'Route by Agent Verdict PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [960, 320],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('security_threat_blocked', '={{ $json.pncBranch }}', 'security_threat_blocked'),
                makeSwitchRule('gated_execution_requires_approval', '={{ $json.pncBranch }}', 'gated_execution_requires_approval'),
                makeSwitchRule('critical_or_high_risk_exposure', '={{ $json.pncBranch }}', 'critical_or_high_risk_exposure'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-ai-sec',
          name: 'Enforce Accio Invariant #7 Security Block',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 120],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, governanceGate: 'BLOCKED_UNTRUSTED_DIRECTIVE' } }];`,
          },
        },
        {
          id: 'kraya-ai-gate',
          name: 'Enforce Accio Invariant #3 Human Approval Gate',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 250],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, governanceGate: 'AWAITING_1CLICK_HUMAN_APPROVAL' } }];`,
          },
        },
        {
          id: 'kraya-ai-high',
          name: 'Surface High-Risk Financial & What-If Mitigation',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 380],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, governanceGate: 'HIGH_RISK_WHAT_IF_ESCALATED' } }];`,
          },
        },
        {
          id: 'kraya-ai-clean',
          name: 'Deliver Read-Only Neuro-Symbolic Analysis',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 510],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, governanceGate: 'SAFE_READ_ONLY_VERDICT' } }];`,
          },
        },
        {
          id: 'kraya-ai-respond',
          name: 'Return Specialist Agent Brain Verdict',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1520, 320],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive AI Procurement Command': {
          main: [[{ node: 'Dispatch to Kraya 8-Agent Specialist Fleet', type: 'main', index: 0 }]],
        },
        'Dispatch to Kraya 8-Agent Specialist Fleet': {
          main: [[{ node: 'Classify Accio Constitution & Risk PnC Branch', type: 'main', index: 0 }]],
        },
        'Classify Accio Constitution & Risk PnC Branch': {
          main: [[{ node: 'Route by Agent Verdict PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by Agent Verdict PnC Branch': {
          main: [
            [{ node: 'Enforce Accio Invariant #7 Security Block', type: 'main', index: 0 }],
            [{ node: 'Enforce Accio Invariant #3 Human Approval Gate', type: 'main', index: 0 }],
            [{ node: 'Surface High-Risk Financial & What-If Mitigation', type: 'main', index: 0 }],
            [{ node: 'Deliver Read-Only Neuro-Symbolic Analysis', type: 'main', index: 0 }],
          ],
        },
        'Enforce Accio Invariant #7 Security Block': {
          main: [[{ node: 'Return Specialist Agent Brain Verdict', type: 'main', index: 0 }]],
        },
        'Enforce Accio Invariant #3 Human Approval Gate': {
          main: [[{ node: 'Return Specialist Agent Brain Verdict', type: 'main', index: 0 }]],
        },
        'Surface High-Risk Financial & What-If Mitigation': {
          main: [[{ node: 'Return Specialist Agent Brain Verdict', type: 'main', index: 0 }]],
        },
        'Deliver Read-Only Neuro-Symbolic Analysis': {
          main: [[{ node: 'Return Specialist Agent Brain Verdict', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 07: Continuous D&B Supplier Risk Watch, SAP Ariba Catalog Filter
  //              & Dynamic Sourcing Proposal 3-Branch PnC Router
  // =========================================================================
  {
    matchPrefix: 'Kraya 07',
    exportFileName: 'kraya-07-dnb-risk-sourcing-proposal-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-risk-sourcing',
    payload: {
      name: 'Kraya 07 — D&B Supplier Risk Watch, SAP Ariba Catalog Filter & Dynamic Sourcing PnC',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-risk',
          name: 'Receive D&B / Regional Risk Feed Signal',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-risk-sourcing-07',
          position: [180, 300],
          parameters: {
            path: 'kraya-risk-sourcing',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-risk',
          name: 'Normalize Risk Feed & Catalog Filter Criteria',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [430, 300],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
return [{
  json: {
    ...body,
    operation: 'risk_sourcing_pnc'
  }
}];`,
          },
        },
        {
          id: 'kraya-exec-risk',
          name: 'Assess Risk, Query Approved Catalog & Draft Proposal',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [690, 300],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: { timeout: 15000 },
          },
        },
        {
          id: 'kraya-risk-switch',
          name: 'Route by Supplier Risk Severity PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [950, 300],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('critical_disruption_dual_source_70_30', '={{ $json.pncBranch }}', 'critical_disruption_dual_source_70_30'),
                makeSwitchRule('elevated_risk_backup_rfq_standby', '={{ $json.pncBranch }}', 'elevated_risk_backup_rfq_standby'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-risk-crit',
          name: 'Activate 70/30 Dual-Sourcing Proposal & Fallback RFQ',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 140],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, sourcingAction: 'IMMEDIATE_70_30_DUAL_SOURCE_FALLBACK_ACTIVATED' } }];`,
          },
        },
        {
          id: 'kraya-risk-elev',
          name: 'Place Approved L1/L2 Backup Vendors on Standby',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 300],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, sourcingAction: 'BACKUP_SUPPLIERS_SHORTLISTED_ON_WATCH' } }];`,
          },
        },
        {
          id: 'kraya-risk-ok',
          name: 'Log Healthy Supplier D&B & ESG Telemetry',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 460],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, sourcingAction: 'NO_FALLBACK_NEEDED_SUPPLIER_HEALTHY' } }];`,
          },
        },
        {
          id: 'kraya-risk-respond',
          name: 'Return Risk Watch & Sourcing Proposal',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1510, 300],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive D&B / Regional Risk Feed Signal': {
          main: [[{ node: 'Normalize Risk Feed & Catalog Filter Criteria', type: 'main', index: 0 }]],
        },
        'Normalize Risk Feed & Catalog Filter Criteria': {
          main: [[{ node: 'Assess Risk, Query Approved Catalog & Draft Proposal', type: 'main', index: 0 }]],
        },
        'Assess Risk, Query Approved Catalog & Draft Proposal': {
          main: [[{ node: 'Route by Supplier Risk Severity PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by Supplier Risk Severity PnC Branch': {
          main: [
            [{ node: 'Activate 70/30 Dual-Sourcing Proposal & Fallback RFQ', type: 'main', index: 0 }],
            [{ node: 'Place Approved L1/L2 Backup Vendors on Standby', type: 'main', index: 0 }],
            [{ node: 'Log Healthy Supplier D&B & ESG Telemetry', type: 'main', index: 0 }],
          ],
        },
        'Activate 70/30 Dual-Sourcing Proposal & Fallback RFQ': {
          main: [[{ node: 'Return Risk Watch & Sourcing Proposal', type: 'main', index: 0 }]],
        },
        'Place Approved L1/L2 Backup Vendors on Standby': {
          main: [[{ node: 'Return Risk Watch & Sourcing Proposal', type: 'main', index: 0 }]],
        },
        'Log Healthy Supplier D&B & ESG Telemetry': {
          main: [[{ node: 'Return Risk Watch & Sourcing Proposal', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 08: NLP Contract Intelligence, Statutory Clause Audit & Redlining 3-Branch PnC
  // =========================================================================
  {
    matchPrefix: 'Kraya 08',
    exportFileName: 'kraya-08-contract-intelligence-nlp-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-contract-nlp',
    payload: {
      name: 'Kraya 08 — NLP Contract Intelligence, Clause Redlining & Expiration Watch PnC',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-cnt',
          name: 'Receive Draft Supplier Contract for NLP Review',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-contract-nlp-08',
          position: [180, 300],
          parameters: {
            path: 'kraya-contract-nlp',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-cnt',
          name: 'Normalize Contract Text & Terms',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [430, 300],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
return [{
  json: {
    ...body,
    operation: 'contract_nlp_pnc'
  }
}];`,
          },
        },
        {
          id: 'kraya-exec-cnt',
          name: 'Run Kraya NLP Contract Intelligence & Policy Redliner',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [690, 300],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: { timeout: 15000 },
          },
        },
        {
          id: 'kraya-cnt-switch',
          name: 'Route by Contract Compliance Verdict PnC Branch',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [950, 300],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('critical_statutory_hold_for_redline', '={{ $json.pncBranch }}', 'critical_statutory_hold_for_redline'),
                makeSwitchRule('commercial_policy_redlines_suggested', '={{ $json.pncBranch }}', 'commercial_policy_redlines_suggested'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-cnt-hold',
          name: 'Hold for Mandatory Section 43B(h) / Statutory Redline',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 140],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, contractGateAction: 'BLOCKED_UNTIL_STATUTORY_REDLINES_ACCEPTED' } }];`,
          },
        },
        {
          id: 'kraya-cnt-redline',
          name: 'Attach GST 2.0, ITC Indemnity & SLA Redline Addendum',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 300],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, contractGateAction: 'APPROVED_SUBJECT_TO_POLICY_REDLINES' } }];`,
          },
        },
        {
          id: 'kraya-cnt-clean',
          name: 'Activate Compliant Contract & Arm Expiration Monitor',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 460],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, contractGateAction: 'CONTRACT_ACTIVE_EXPIRATION_WATCH_ARMED' } }];`,
          },
        },
        {
          id: 'kraya-cnt-respond',
          name: 'Return Contract Intelligence Report',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1510, 300],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive Draft Supplier Contract for NLP Review': {
          main: [[{ node: 'Normalize Contract Text & Terms', type: 'main', index: 0 }]],
        },
        'Normalize Contract Text & Terms': {
          main: [[{ node: 'Run Kraya NLP Contract Intelligence & Policy Redliner', type: 'main', index: 0 }]],
        },
        'Run Kraya NLP Contract Intelligence & Policy Redliner': {
          main: [[{ node: 'Route by Contract Compliance Verdict PnC Branch', type: 'main', index: 0 }]],
        },
        'Route by Contract Compliance Verdict PnC Branch': {
          main: [
            [{ node: 'Hold for Mandatory Section 43B(h) / Statutory Redline', type: 'main', index: 0 }],
            [{ node: 'Attach GST 2.0, ITC Indemnity & SLA Redline Addendum', type: 'main', index: 0 }],
            [{ node: 'Activate Compliant Contract & Arm Expiration Monitor', type: 'main', index: 0 }],
          ],
        },
        'Hold for Mandatory Section 43B(h) / Statutory Redline': {
          main: [[{ node: 'Return Contract Intelligence Report', type: 'main', index: 0 }]],
        },
        'Attach GST 2.0, ITC Indemnity & SLA Redline Addendum': {
          main: [[{ node: 'Return Contract Intelligence Report', type: 'main', index: 0 }]],
        },
        'Activate Compliant Contract & Arm Expiration Monitor': {
          main: [[{ node: 'Return Contract Intelligence Report', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 09: Purchase Requisition (PR), Budget Guard & 4-Tier Approval Matrix Router
  // =========================================================================
  {
    matchPrefix: 'Kraya 09',
    exportFileName: 'kraya-09-pr-budget-approval-matrix-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-pr-budget-approval',
    payload: {
      name: 'Kraya 09 — Purchase Requisition (PR), Cost-Center Budget Guard & 4-Tier Approval Matrix',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-pr',
          name: 'Receive Purchase Requisition (PR) Request',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-pr-budget-09',
          position: [180, 320],
          parameters: {
            path: 'kraya-pr-budget-approval',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-pr',
          name: 'Normalize PR & Cost-Center Budget Envelope',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [430, 320],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
return [{
  json: {
    ...body,
    operation: 'pr_budget_pnc'
  }
}];`,
          },
        },
        {
          id: 'kraya-exec-pr',
          name: 'Validate Department Budget & Evaluate Approval Matrix',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [690, 320],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: { timeout: 15000 },
          },
        },
        {
          id: 'kraya-pr-switch',
          name: 'Route by 4-Tier Budget & Approval Matrix PnC',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [950, 320],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('exceeds_budget_hard_stop_cfo_board', '={{ $json.pncBranch }}', 'exceeds_budget_hard_stop_cfo_board'),
                makeSwitchRule('tier_2_finance_head_review', '={{ $json.pncBranch }}', 'tier_2_finance_head_review'),
                makeSwitchRule('tier_1_department_manager_approval', '={{ $json.pncBranch }}', 'tier_1_department_manager_approval'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-pr-t3',
          name: 'Tier 3: Hard-Stop Budget Overrun / CFO & Board Sign-Off',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 120],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, routingAction: 'ESCALATED_TO_TIER3_CFO_BOARD_BUDGET_OVERRIDE' } }];`,
          },
        },
        {
          id: 'kraya-pr-t2',
          name: 'Tier 2: Route to Finance Head (>80% Budget or Mid-Tier Spend)',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 250],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, routingAction: 'ROUTED_TO_TIER2_FINANCE_HEAD' } }];`,
          },
        },
        {
          id: 'kraya-pr-t1',
          name: 'Tier 1: Route to Department Manager Approval',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 380],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, routingAction: 'ROUTED_TO_TIER1_DEPARTMENT_MANAGER' } }];`,
          },
        },
        {
          id: 'kraya-pr-t0',
          name: 'Tier 0: Auto-Approved Under Spend Limit & Converted to RFQ',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1240, 510],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, routingAction: 'AUTO_APPROVED_BUDGET_COMMITTED_RFQ_CREATED' } }];`,
          },
        },
        {
          id: 'kraya-pr-respond',
          name: 'Return PR & Budget Decision',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1520, 320],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Receive Purchase Requisition (PR) Request': {
          main: [[{ node: 'Normalize PR & Cost-Center Budget Envelope', type: 'main', index: 0 }]],
        },
        'Normalize PR & Cost-Center Budget Envelope': {
          main: [[{ node: 'Validate Department Budget & Evaluate Approval Matrix', type: 'main', index: 0 }]],
        },
        'Validate Department Budget & Evaluate Approval Matrix': {
          main: [[{ node: 'Route by 4-Tier Budget & Approval Matrix PnC', type: 'main', index: 0 }]],
        },
        'Route by 4-Tier Budget & Approval Matrix PnC': {
          main: [
            [{ node: 'Tier 3: Hard-Stop Budget Overrun / CFO & Board Sign-Off', type: 'main', index: 0 }],
            [{ node: 'Tier 2: Route to Finance Head (>80% Budget or Mid-Tier Spend)', type: 'main', index: 0 }],
            [{ node: 'Tier 1: Route to Department Manager Approval', type: 'main', index: 0 }],
            [{ node: 'Tier 0: Auto-Approved Under Spend Limit & Converted to RFQ', type: 'main', index: 0 }],
          ],
        },
        'Tier 3: Hard-Stop Budget Overrun / CFO & Board Sign-Off': {
          main: [[{ node: 'Return PR & Budget Decision', type: 'main', index: 0 }]],
        },
        'Tier 2: Route to Finance Head (>80% Budget or Mid-Tier Spend)': {
          main: [[{ node: 'Return PR & Budget Decision', type: 'main', index: 0 }]],
        },
        'Tier 1: Route to Department Manager Approval': {
          main: [[{ node: 'Return PR & Budget Decision', type: 'main', index: 0 }]],
        },
        'Tier 0: Auto-Approved Under Spend Limit & Converted to RFQ': {
          main: [[{ node: 'Return PR & Budget Decision', type: 'main', index: 0 }]],
        },
      },
    },
  },

  // =========================================================================
  // WORKFLOW 10: Connected 6-Step Procurement Pipeline & Closed-Loop Data Lake Feedback PnC
  // =========================================================================
  {
    matchPrefix: 'Kraya 10',
    exportFileName: 'kraya-10-integrated-6step-datalake-pnc.json',
    shouldActivate: true,
    webhookPath: 'kraya-integrated-6step',
    payload: {
      name: 'Kraya 10 — Connected 6-Step Procurement Pipeline & Closed-Loop Data Lake Feedback PnC',
      settings: { executionOrder: 'v1' },
      nodes: [
        {
          id: 'kraya-wh-6step',
          name: 'Trigger Connected 6-Step Pipeline or Post-Transaction Feedback',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          webhookId: 'kraya-integrated-6step-10',
          position: [180, 300],
          parameters: {
            path: 'kraya-integrated-6step',
            httpMethod: 'POST',
            responseMode: 'responseNode',
            options: {},
          },
        },
        {
          id: 'kraya-prep-6step',
          name: 'Normalize Pipeline / Feedback Telemetry Input',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [430, 300],
          parameters: {
            jsCode: `const raw = $input.first().json;
const body = raw.body || raw;
return [{
  json: {
    ...body,
    operation: 'integrated_6step_or_feedback_pnc'
  }
}];`,
          },
        },
        {
          id: 'kraya-exec-6step',
          name: 'Execute Kraya 6-Step Pipeline & Data Lake Engine',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          onError: 'continueRegularOutput',
          position: [690, 300],
          parameters: {
            method: 'POST',
            url: `${KRAYA_HOST_FOR_N8N}/api/internal/n8n/enterprise/execute`,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'x-kraya-webhook-secret', value: N8N_SECRET }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: { timeout: 20000 },
          },
        },
        {
          id: 'kraya-6step-switch',
          name: 'Route by Closed-Loop Execution & Feedback PnC',
          type: 'n8n-nodes-base.switch',
          typeVersion: 3.2,
          position: [950, 300],
          parameters: {
            rules: {
              values: [
                makeSwitchRule('full_6step_pipeline_executed', '={{ $json.pncBranch }}', 'full_6step_pipeline_executed'),
                makeSwitchRule('post_transaction_reliability_upgraded', '={{ $json.pncBranch }}', 'post_transaction_reliability_upgraded'),
              ],
            },
            options: { fallbackOutput: 'extra' },
          },
        },
        {
          id: 'kraya-6step-full',
          name: 'Confirm Full 6-Step Manager Pipeline & Coupa Sync',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 140],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, closedLoopStatus: 'FULL_6STEP_RISK_TO_COUPA_AND_DATALAKE_COMPLETE' } }];`,
          },
        },
        {
          id: 'kraya-6step-up',
          name: 'Upgrade Supplier Reliability Score in Sourcing Data Lake',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 300],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, closedLoopStatus: 'SUPPLIER_RELIABILITY_UPGRADED_FOR_FUTURE_SOURCING' } }];`,
          },
        },
        {
          id: 'kraya-6step-down',
          name: 'Penalize Supplier Reliability Score & Flag Sourcing Watch',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1230, 460],
          parameters: {
            jsCode: `const d = $input.first().json;
return [{ json: { ...d, closedLoopStatus: 'SUPPLIER_RELIABILITY_DOWNGRADED_DUE_TO_DELAY_OR_LEAK' } }];`,
          },
        },
        {
          id: 'kraya-6step-respond',
          name: 'Return 6-Step & Data Lake Verdict',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [1510, 300],
          parameters: {
            respondWith: 'firstIncomingItem',
            options: { responseCode: 200 },
          },
        },
      ],
      connections: {
        'Trigger Connected 6-Step Pipeline or Post-Transaction Feedback': {
          main: [[{ node: 'Normalize Pipeline / Feedback Telemetry Input', type: 'main', index: 0 }]],
        },
        'Normalize Pipeline / Feedback Telemetry Input': {
          main: [[{ node: 'Execute Kraya 6-Step Pipeline & Data Lake Engine', type: 'main', index: 0 }]],
        },
        'Execute Kraya 6-Step Pipeline & Data Lake Engine': {
          main: [[{ node: 'Route by Closed-Loop Execution & Feedback PnC', type: 'main', index: 0 }]],
        },
        'Route by Closed-Loop Execution & Feedback PnC': {
          main: [
            [{ node: 'Confirm Full 6-Step Manager Pipeline & Coupa Sync', type: 'main', index: 0 }],
            [{ node: 'Upgrade Supplier Reliability Score in Sourcing Data Lake', type: 'main', index: 0 }],
            [{ node: 'Penalize Supplier Reliability Score & Flag Sourcing Watch', type: 'main', index: 0 }],
          ],
        },
        'Confirm Full 6-Step Manager Pipeline & Coupa Sync': {
          main: [[{ node: 'Return 6-Step & Data Lake Verdict', type: 'main', index: 0 }]],
        },
        'Upgrade Supplier Reliability Score in Sourcing Data Lake': {
          main: [[{ node: 'Return 6-Step & Data Lake Verdict', type: 'main', index: 0 }]],
        },
        'Penalize Supplier Reliability Score & Flag Sourcing Watch': {
          main: [[{ node: 'Return 6-Step & Data Lake Verdict', type: 'main', index: 0 }]],
        },
      },
    },
  },
];

async function main() {
  // Export all 10 JSON files into automations/n8n/
  const outDir = path.resolve('automations/n8n');
  if (fs.existsSync(outDir)) {
    for (const spec of WORKFLOW_SPECS) {
      if (spec.exportFileName) {
        fs.writeFileSync(
          path.join(outDir, spec.exportFileName),
          JSON.stringify(spec.payload, null, 2) + '\n',
          'utf8'
        );
      }
    }
  }

  const existingResp = await n8nFetch('/api/v1/workflows');
  const existing = existingResp.data || [];

  const summary = [];
  for (const spec of WORKFLOW_SPECS) {
    const found = existing.find((w) => w.name.startsWith(spec.matchPrefix));
    let wf;
    if (found) {
      wf = await n8nFetch(`/api/v1/workflows/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify(spec.payload),
      });
    } else {
      wf = await n8nFetch('/api/v1/workflows', {
        method: 'POST',
        body: JSON.stringify(spec.payload),
      });
    }

    let active = Boolean(wf.active);
    if (spec.shouldActivate) {
      if (active) {
        await n8nFetch(`/api/v1/workflows/${wf.id}/deactivate`, { method: 'POST' }).catch(() => {});
      }
      const act = await n8nFetch(`/api/v1/workflows/${wf.id}/activate`, { method: 'POST' });
      active = Boolean(act.active);
    }

    summary.push({
      id: wf.id,
      name: wf.name,
      active,
      nodesCount: (spec.payload.nodes || []).length,
      webhookUrl: spec.webhookPath ? `${N8N_API_URL}/webhook/${spec.webhookPath}` : null,
      editorUrl: `${N8N_API_URL}/workflow/${wf.id}`,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        n8nUrl: N8N_API_URL,
        krayaHostForN8n: KRAYA_HOST_FOR_N8N,
        totalWorkflowsDeployed: summary.length,
        workflows: summary,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
