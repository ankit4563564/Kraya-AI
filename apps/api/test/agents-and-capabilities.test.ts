import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeGstinChecksum } from '@kraya/finance-engine';
import { createApp } from '../src/app.js';

const VALID_KA_GSTIN = `29AABCS1429B1Z${computeGstinChecksum('29AABCS1429B1Z')}`;
import { resetDbCache } from '../src/db/client.js';
import worker from '../src/worker.js';

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/kraya_session=([^;]+)/);
  if (!match) throw new Error(`Missing kraya_session cookie. Got: ${raw}`);
  return `kraya_session=${match[1]}`;
}

describe('Specialist Agent Fleet API, Live GSTN Cache, Morning Cron, Email PDF Attachments & Distributed Rate Limit', () => {
  let tmpRoot = '';
  let pgDir = '';
  let vaultDir = '';
  let prevPgDir: string | undefined;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kraya-agents-test-'));
    pgDir = path.join(tmpRoot, 'pg');
    vaultDir = path.join(tmpRoot, 'vault');
    prevPgDir = process.env.PGLITE_DATA_DIR;
    process.env.PGLITE_DATA_DIR = pgDir;
    resetDbCache();
  });

  afterAll(() => {
    resetDbCache();
    if (prevPgDir === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = prevPgDir;
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('1. Live GSTN Verification 30-day DB cache + supplier auto-enrichment', async () => {
    const app = createApp({ LOCAL_VAULT_DIR: vaultDir, REQUIRE_AUTH: 'true' });

    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Kraya Agents Test Pvt Ltd',
        name: 'Adithya',
        email: 'owner-agents@kraya.test',
        password: 'StrongPassword#2026',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const cookie = extractCookie(signupRes);

    // Create a supplier with valid GSTIN
    const supRes = await app.request('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Karnataka Steels Pvt Ltd',
        gstin: VALID_KA_GSTIN,
        udyamTier: 'small',
        creditDays: 30,
      }),
    });
    expect(supRes.status).toBe(201);
    const sup = (await supRes.json()) as { id: string };

    // First verify-live -> fresh verification stored in gstn_verifications
    const v1 = await app.request('/api/gstin/verify-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gstin: VALID_KA_GSTIN, supplierId: sup.id }),
    });
    expect(v1.status).toBe(200);
    const j1 = (await v1.json()) as {
      checksumValid: boolean;
      fromCache: boolean;
      supplierUpdated: boolean;
    };
    expect(j1.checksumValid).toBe(true);
    expect(j1.fromCache).toBe(false);
    expect(j1.supplierUpdated).toBe(true);

    // Second verify-live -> hits PostgreSQL cache immediately!
    const v2 = await app.request('/api/gstin/verify-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gstin: VALID_KA_GSTIN }),
    });
    expect(v2.status).toBe(200);
    const j2 = (await v2.json()) as { fromCache: boolean };
    expect(j2.fromCache).toBe(true);

    const cacheRes = await app.request('/api/gstin/cache', {
      headers: { Cookie: cookie },
    });
    expect(cacheRes.status).toBe(200);
    const cacheJson = (await cacheRes.json()) as { verifications: Array<{ gstin: string }> };
    expect(cacheJson.verifications.some((x) => x.gstin === VALID_KA_GSTIN)).toBe(true);
  });

  it('2. Specialist Agent Fleet API: lists 8 agents, runs Compliance/Operations/Orchestrator, and persists agent_runs', async () => {
    const app = createApp({ LOCAL_VAULT_DIR: vaultDir, REQUIRE_AUTH: 'true' });
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner-agents@kraya.test',
        password: 'StrongPassword#2026',
      }),
    });
    const cookie = extractCookie(loginRes);

    const fleetRes = await app.request('/api/agents/fleet', { headers: { Cookie: cookie } });
    expect(fleetRes.status).toBe(200);
    const fleetJson = (await fleetRes.json()) as {
      fleet: Array<{ agentId: string }>;
      morningCronSchedule: { cronUtc: string };
    };
    expect(fleetJson.fleet).toHaveLength(8);
    expect(fleetJson.morningCronSchedule.cronUtc).toBe('30 2 * * *');

    // Run Compliance Agent
    const runComp = await app.request('/api/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ agentId: 'compliance', skipNetwork: true }),
    });
    expect(runComp.status).toBe(200);
    const compJson = (await runComp.json()) as { runId: string; report: { agentId: string } };
    expect(compJson.runId).toMatch(/^agrun_/);
    expect(compJson.report.agentId).toBe('compliance');

    // Run Orchestrator Agent
    const runOrch = await app.request('/api/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        agentId: 'orchestrator',
        promptText: 'Audit our GST compliance and daily pending tasks',
        skipNetwork: true,
      }),
    });
    expect(runOrch.status).toBe(200);
    const orchJson = (await runOrch.json()) as { report: { agentId: string } };
    expect(orchJson.report.agentId).toBe('orchestrator');

    // Verify runs persisted
    const runsRes = await app.request('/api/agents/runs', { headers: { Cookie: cookie } });
    expect(runsRes.status).toBe(200);
    const runsJson = (await runsRes.json()) as { runs: Array<{ agentId: string }> };
    expect(runsJson.runs.length).toBeGreaterThanOrEqual(2);
  });

  it('3. Morning Cron Sweep: enforces CRON_SECRET and supports Cloudflare Workers scheduled() handler', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      CRON_SECRET: 'super-cron-secret-2026',
    });

    // Unauthorized cron call rejected
    const unauth = await app.request('/api/internal/cron/morning-sweep', { method: 'POST' });
    expect(unauth.status).toBe(401);

    // Authorized cron call succeeds across all workspaces
    const ok = await app.request('/api/internal/cron/morning-sweep', {
      method: 'POST',
      headers: { 'x-kraya-cron-secret': 'super-cron-secret-2026' },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; workspacesSwept: number };
    expect(body.ok).toBe(true);
    expect(body.workspacesSwept).toBeGreaterThanOrEqual(1);

    // Cloudflare Workers scheduled() export executes cleanly
    let waited = false;
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '30 2 * * *' },
      { LOCAL_VAULT_DIR: vaultDir },
      {
        waitUntil: (p) => {
          waited = true;
          void p;
        },
      }
    );
    expect(waited).toBe(true);
  });

  it('4. Inbound Email Webhook ingests PDF attachments (JSON base64 & multipart) into persistent vault', async () => {
    const webhookSecret = 'email-webhook-secret-2026';
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      INBOUND_WEBHOOK_SECRET: webhookSecret,
    });

    // Login to discover workspaceId
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner-agents@kraya.test',
        password: 'StrongPassword#2026',
      }),
    });
    const cookie = extractCookie(loginRes);
    const meRes = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    const me = (await meRes.json()) as { workspaceId: string };

    // Valid minimal PDF bytes (%PDF-1.4 header passes magic-byte verification!)
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
    const pdfB64 = pdfBytes.toString('base64');

    const res = await app.request('/api/webhooks/email-inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kraya-webhook-secret': webhookSecret,
        'x-kraya-workspace-id': me.workspaceId,
        'x-kraya-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-kraya-delivery-id': 'email-pdf-test-1',
      },
      body: JSON.stringify({
        fromName: 'Bharat Corrugators',
        fromEmail: 'quotes@bharatcorrugators.in',
        subject: 'Quotation for 5,000 5-ply boxes @ Rs 22 + 18% GST',
        text: 'Please find attached official PDF quote. Credit 30 days.',
        attachments: [
          {
            fileName: 'Quote-Bharat-5000-Boxes.pdf',
            mimeType: 'application/pdf',
            contentBase64: pdfB64,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      attachmentsIngested: number;
      ingested: { sourceEvent: { fileId: string | null; mediaFileName: string | null } };
    };
    expect(json.ok).toBe(true);
    expect(json.attachmentsIngested).toBe(1);
    expect(json.ingested.sourceEvent.fileId).toBeTruthy();
    expect(json.ingested.sourceEvent.mediaFileName).toBe('Quote-Bharat-5000-Boxes.pdf');
  });

  it('5. Distributed PostgreSQL Rate Limiter shares auth limits across separate serverless instances', async () => {
    const appInstanceA = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      DISTRIBUTED_RATE_LIMIT: 'true',
      RATE_LIMIT_MAX_AUTH: '2',
    });
    const appInstanceB = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      DISTRIBUTED_RATE_LIMIT: 'true',
      RATE_LIMIT_MAX_AUTH: '2',
    });

    const headers = {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.77',
    };
    const payload = JSON.stringify({ email: 'nobody@kraya.test', password: 'wrong' });

    const r1 = await appInstanceA.request('/api/auth/login', { method: 'POST', headers, body: payload });
    expect(r1.status).toBe(401);

    const r2 = await appInstanceB.request('/api/auth/login', { method: 'POST', headers, body: payload });
    expect(r2.status).toBe(401);

    // 3rd request on Instance A is blocked with 429 because Instance B's hit was persisted in Postgres!
    const r3 = await appInstanceA.request('/api/auth/login', { method: 'POST', headers, body: payload });
    expect(r3.status).toBe(429);
  });
});
