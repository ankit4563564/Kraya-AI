import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { resetDbCache } from '../src/db/client.js';

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/kraya_session=([^;]+)/);
  if (!match) throw new Error(`Missing kraya_session cookie. Got: ${raw}`);
  return `kraya_session=${match[1]}`;
}

describe('External Connector Hub, n8n Bi-Directional Bridge, ERP Live Push, Udyam & IFSC Rails', () => {
  let tmpRoot = '';
  let pgDir = '';
  let vaultDir = '';
  let prevPgDir: string | undefined;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kraya-connectors-test-'));
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

  it('1. Connector Catalog, 4 n8n Workflow JSON Downloads & Webhook CRUD', async () => {
    const app = createApp({ LOCAL_VAULT_DIR: vaultDir, REQUIRE_AUTH: 'true' });

    const signup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Connectors Test Mfg Pvt Ltd',
        name: 'Adithya',
        email: 'connectors@kraya.test',
        password: 'StrongPassword#2026',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signup.status).toBe(201);
    const cookie = extractCookie(signup);

    // Inspect connector catalog
    const catRes = await app.request('/api/connectors/catalog', { headers: { Cookie: cookie } });
    expect(catRes.status).toBe(200);
    const cat = (await catRes.json()) as {
      connectors: Array<{ id: string }>;
      n8nTemplates: Array<{ slug: string }>;
    };
    expect(cat.connectors.length).toBeGreaterThanOrEqual(9);
    expect(cat.n8nTemplates).toHaveLength(4);

    // Download an n8n workflow JSON blueprint
    const tplRes = await app.request('/api/connectors/n8n-templates/gmail-pdf-to-kraya', {
      headers: { Cookie: cookie },
    });
    expect(tplRes.status).toBe(200);
    const tplJson = (await tplRes.json()) as { name: string; nodes: unknown[] };
    expect(tplJson.name).toContain('Kraya');
    expect(tplJson.nodes.length).toBeGreaterThanOrEqual(3);

    // Register an n8n outbound webhook
    const whRes = await app.request('/api/connectors/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'n8n CFO Alerts',
        provider: 'n8n',
        targetUrl: 'https://n8n.example.com/webhook/kraya-alerts',
        signingSecret: 'hmac-secret-123',
        subscribedEvents: ['invoice.leak_detected', 'msme.43bh_cliff'],
      }),
    });
    expect(whRes.status).toBe(201);
    const wh = (await whRes.json()) as { id: string; hasSigningSecret: boolean };
    expect(wh.hasSigningSecret).toBe(true);

    // Delete webhook cleanly
    const delRes = await app.request(`/api/connectors/webhooks/${wh.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(delRes.status).toBe(200);
  });

  it('2. Bi-Directional n8n Callback, ERP Dry-Run Push (Zoho & Tally), Udyam & IFSC Verification', async () => {
    const n8nSecret = 'n8n-callback-secret-2026';
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      N8N_WEBHOOK_SECRET: n8nSecret,
    });

    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'connectors@kraya.test',
        password: 'StrongPassword#2026',
      }),
    });
    const cookie = extractCookie(login);
    const me = (await (await app.request('/api/auth/me', { headers: { Cookie: cookie } })).json()) as {
      workspaceId: string;
    };

    // Create supplier + audit an invoice so we can push to Zoho/Tally and test n8n callback
    const sup = (await (
      await app.request('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Southern Fasteners',
          udyamTier: 'small',
          creditDays: 30,
        }),
      })
    ).json()) as { id: string };

    // Verify Udyam MSME format & auto-update supplier
    const udyamOk = await app.request('/api/connectors/verify-udyam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        udyamNumber: 'UDYAM-KA-03-0012345',
        supplierId: sup.id,
        skipNetwork: true,
      }),
    });
    expect(udyamOk.status).toBe(200);
    const udyamJson = (await udyamOk.json()) as { formatValid: boolean; supplierUpdated: boolean };
    expect(udyamJson.formatValid).toBe(true);
    expect(udyamJson.supplierUpdated).toBe(true);

    // Verify Indian Bank IFSC format (offline test mode)
    const ifscOk = await app.request('/api/connectors/ifsc/HDFC0000001?offline=true', {
      headers: { Cookie: cookie },
    });
    expect(ifscOk.status).toBe(200);
    const ifscBad = await app.request('/api/connectors/ifsc/INVALID123?offline=true', {
      headers: { Cookie: cookie },
    });
    expect(ifscBad.status).toBe(400);

    // Create an audited invoice
    const invRes = await app.request('/api/invoices/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        supplierId: sup.id,
        invoiceNumber: 'SF-2026-101',
        invoiceDate: '2026-06-15',
        itemKey: 'bolts-m8',
        description: 'M8 SS Bolts',
        qty: 1000,
        unit: 'pc',
        unitRateRupees: 10,
        gstPct: 18,
        statedTaxableRupees: 10000,
        statedCgstRupees: 900,
        statedSgstRupees: 900,
        statedIgstRupees: 0,
        statedGrandTotalRupees: 11800,
      }),
    });
    expect(invRes.status).toBe(201);
    const inv = ((await invRes.json()) as { invoice: { id: string } }).invoice;

    // Push to Zoho Books (dry-run preview when OAuth creds unset) + RazorpayX payout draft
    const zohoRes = await app.request('/api/connectors/erp/push-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ invoiceId: inv.id, provider: 'zoho_books' }),
    });
    expect(zohoRes.status).toBe(200);
    const zohoJson = (await zohoRes.json()) as {
      mode: string;
      ok: boolean;
      payoutDraft: { mode: string; requiresHumanApproval: boolean };
    };
    expect(zohoJson.mode).toBe('dry_run_preview');
    expect(zohoJson.ok).toBe(true);
    expect(zohoJson.payoutDraft.requiresHumanApproval).toBe(true);

    // Push to Tally Prime XML (dry-run preview)
    const tallyRes = await app.request('/api/connectors/erp/push-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ invoiceId: inv.id, provider: 'tally_prime' }),
    });
    expect(tallyRes.status).toBe(200);
    const tallyJson = (await tallyRes.json()) as { provider: string; payloadPreview: string };
    expect(tallyJson.provider).toBe('tally_prime');
    expect(tallyJson.payloadPreview).toContain('<ENVELOPE>');

    // Unauthorized n8n callback rejected
    const unauthCb = await app.request('/api/connectors/n8n/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_invoice_paid', invoiceId: inv.id }),
    });
    expect(unauthCb.status).toBe(401);

    // Authorized n8n callback marks invoice paid with UTR!
    const okCb = await app.request('/api/connectors/n8n/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kraya-webhook-secret': n8nSecret,
        'x-kraya-workspace-id': me.workspaceId,
      },
      body: JSON.stringify({
        action: 'mark_invoice_paid',
        invoiceId: inv.id,
        paymentUtr: 'UTR20260615000199',
      }),
    });
    expect(okCb.status).toBe(200);
    const cbJson = (await okCb.json()) as { ok: boolean; paidAt: string };
    expect(cbJson.ok).toBe(true);
    expect(cbJson.paidAt).toBeTruthy();
  });
});
