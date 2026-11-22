import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { hmacSha256Hex } from '../src/auth.js';
import { resetDbCache } from '../src/db/client.js';

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/kraya_session=([^;]+)/);
  if (!match) throw new Error(`Missing kraya_session cookie. Got: ${raw}`);
  return `kraya_session=${match[1]}`;
}

describe('Commercial SaaS Billing, Usage Metering & Razorpay Webhook', () => {
  let tmpRoot = '';
  let pgDir = '';
  let vaultDir = '';
  let prevPgDir: string | undefined;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kraya-billing-test-'));
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

  it('tracks real workspace usage, allows owner pilot upgrade, and verifies signed Razorpay webhook', async () => {
    const rzpWebhookSecret = 'rzp_whsec_test_2026';
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      RAZORPAY_WEBHOOK_SECRET: rzpWebhookSecret,
    });

    const signup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Billing Test Industries',
        name: 'Founder',
        email: 'billing@kraya.test',
        password: 'StrongPassword#2026',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signup.status).toBe(201);
    const cookie = extractCookie(signup);
    const me = (await (await app.request('/api/auth/me', { headers: { Cookie: cookie } })).json()) as {
      workspaceId: string;
    };

    // 1. Default free_pilot status & live usage metering
    const st1 = await app.request('/api/billing/status', { headers: { Cookie: cookie } });
    expect(st1.status).toBe(200);
    const j1 = (await st1.json()) as {
      subscription: { planCode: string };
      plans: unknown[];
      usage: { teamSeatsUsed: number };
    };
    expect(j1.subscription.planCode).toBe('free_pilot');
    expect(j1.plans).toHaveLength(3);
    expect(j1.usage.teamSeatsUsed).toBeGreaterThanOrEqual(1);

    // 2. Owner activates growth_1499 in pilot mode
    const upg = await app.request('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ planCode: 'growth_1499' }),
    });
    expect(upg.status).toBe(200);
    const upgJson = (await upg.json()) as { mode: string };
    expect(upgJson.mode).toBe('pilot_activated');

    // 3. Signed Razorpay webhook upgrades workspace to enterprise_4999
    const rzpBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_998877',
            order_id: 'order_test_1122',
            notes: { workspaceId: me.workspaceId, planCode: 'enterprise_4999' },
          },
        },
      },
    });
    const badWh = await app.request('/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'bad_sig' },
      body: rzpBody,
    });
    expect(badWh.status).toBe(401);

    const validSig = await hmacSha256Hex(rzpBody, rzpWebhookSecret);
    const goodWh = await app.request('/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': validSig },
      body: rzpBody,
    });
    expect(goodWh.status).toBe(200);
    const whJson = (await goodWh.json()) as { ok: boolean; activatedPlan: string };
    expect(whJson.activatedPlan).toBe('enterprise_4999');

    // Confirm upgraded plan reflected live
    const st2 = await app.request('/api/billing/status', { headers: { Cookie: cookie } });
    const j2 = (await st2.json()) as { subscription: { planCode: string; monthlyPriceInr: number } };
    expect(j2.subscription.planCode).toBe('enterprise_4999');
    expect(j2.subscription.monthlyPriceInr).toBe(4999);
  });
});
