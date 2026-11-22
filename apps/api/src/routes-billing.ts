import type { Hono } from 'hono';
import { eq, isNull, and } from 'drizzle-orm';
import { fetchWithTimeoutAndRetry } from '@kraya/agent-core';
import { getDb } from './db/client.js';
import * as schema from './db/schema.js';
import { verifyHmacSha256Hex } from './auth.js';
import { AppHelpers, AppVariables, recordAuditLog } from './context.js';

export interface PlanDefinition {
  code: 'free_pilot' | 'growth_1499' | 'enterprise_4999';
  name: string;
  monthlyPriceInr: number;
  maxInvoicesPerMonth: number;
  maxAgentRunsPerMonth: number;
  maxVaultMb: number;
  maxTeamSeats: number;
  features: string[];
}

export const KRAYA_SAAS_PLANS: PlanDefinition[] = [
  {
    code: 'free_pilot',
    name: 'Pilot Free',
    monthlyPriceInr: 0,
    maxInvoicesPerMonth: 50,
    maxAgentRunsPerMonth: 250,
    maxVaultMb: 500,
    maxTeamSeats: 3,
    features: [
      '8 Specialist AI Procurement Agents',
      '100% Deterministic GST 2.0, 43B(h) & Money Leak Radar',
      'GST PO PDF, Live-Formula Excel & Tally/Zoho Exports',
      'Zero-ban wa.me & mailto outreach bridges',
    ],
  },
  {
    code: 'growth_1499',
    name: 'Growth SMB',
    monthlyPriceInr: 1499,
    maxInvoicesPerMonth: 500,
    maxAgentRunsPerMonth: 5000,
    maxVaultMb: 10240,
    maxTeamSeats: 15,
    features: [
      'Zero-training Commercial AI Tier (DPDP Ready)',
      'Automated 8:00 AM IST Morning Cron Sweep',
      'Live GSTN & Udyam Verification + 30-day Caching',
      'n8n Bi-Directional Event Bus + Direct Zoho/Tally Push',
      'CA Read-Only Auditor Seats & SHA-256 Tamper-Evident Chain',
    ],
  },
  {
    code: 'enterprise_4999',
    name: 'Multi-Plant Enterprise',
    monthlyPriceInr: 4999,
    maxInvoicesPerMonth: 10000,
    maxAgentRunsPerMonth: 50000,
    maxVaultMb: 102400,
    maxTeamSeats: 100,
    features: [
      'Unlimited Multi-Company / Multi-GSTIN Workspaces',
      'Dedicated WhatsApp Cloud API + Custom Email Routing Domain',
      'RazorpayX Approval-Gated Payout Rail Integration',
      'Custom Workspace Policy Patches & Priority Onboarding',
    ],
  },
];

export function registerBillingRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // 1. Live Subscription Status & Real Monthly Usage Metering
  app.get('/api/billing/status', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));

    const [[sub], invoices, agentRuns, files, members, gstnCache] = await Promise.all([
      db
        .select()
        .from(schema.workspaceSubscriptions)
        .where(eq(schema.workspaceSubscriptions.workspaceId, ctx.workspaceId))
        .limit(1),
      db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(eq(schema.invoices.workspaceId, ctx.workspaceId)),
      db
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.workspaceId, ctx.workspaceId)),
      db
        .select({ sizeBytes: schema.storedFiles.sizeBytes })
        .from(schema.storedFiles)
        .where(
          and(
            eq(schema.storedFiles.workspaceId, ctx.workspaceId),
            isNull(schema.storedFiles.deletedAt)
          )
        ),
      db
        .select({ id: schema.workspaceMemberships.id })
        .from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.workspaceId, ctx.workspaceId)),
      db
        .select({ id: schema.gstnVerifications.id })
        .from(schema.gstnVerifications)
        .where(eq(schema.gstnVerifications.workspaceId, ctx.workspaceId)),
    ]);

    const currentCode = (sub?.planCode as PlanDefinition['code']) || 'free_pilot';
    const currentPlan =
      KRAYA_SAAS_PLANS.find((p) => p.code === currentCode) || KRAYA_SAAS_PLANS[0];
    const vaultUsedMb =
      Math.round((files.reduce((acc, f) => acc + f.sizeBytes, 0) / (1024 * 1024)) * 100) / 100;

    return c.json({
      subscription: {
        planCode: currentPlan.code,
        planName: currentPlan.name,
        status: sub?.status || 'active',
        monthlyPriceInr: currentPlan.monthlyPriceInr,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      },
      usage: {
        invoicesAudited: invoices.length,
        agentRunsExecuted: agentRuns.length,
        vaultUsedMb,
        teamSeatsUsed: Math.max(1, members.length),
        gstnLookupsCached: gstnCache.length,
      },
      limits: {
        maxInvoicesPerMonth: currentPlan.maxInvoicesPerMonth,
        maxAgentRunsPerMonth: currentPlan.maxAgentRunsPerMonth,
        maxVaultMb: currentPlan.maxVaultMb,
        maxTeamSeats: currentPlan.maxTeamSeats,
      },
      razorpayConfigured: Boolean(
        helpers.getEnv('RAZORPAY_KEY_ID') && helpers.getEnv('RAZORPAY_KEY_SECRET')
      ),
      plans: KRAYA_SAAS_PLANS,
    });
  });

  // 2. Create Razorpay Checkout Order (or Pilot Plan Switch)
  app.post('/api/billing/checkout', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can change subscription plans.' }, 403);
    }

    const body = await c.req.json<{ planCode?: PlanDefinition['code'] }>();
    const plan = KRAYA_SAAS_PLANS.find((p) => p.code === body.planCode);
    if (!plan) {
      return c.json({ error: 'Invalid planCode. Choose free_pilot, growth_1499, or enterprise_4999.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const rzpKey = helpers.getEnv('RAZORPAY_KEY_ID')?.trim();
    const rzpSec = helpers.getEnv('RAZORPAY_KEY_SECRET')?.trim();

    if (plan.monthlyPriceInr > 0 && rzpKey && rzpSec) {
      const authB64 =
        typeof Buffer !== 'undefined'
          ? Buffer.from(`${rzpKey}:${rzpSec}`).toString('base64')
          : btoa(`${rzpKey}:${rzpSec}`);
      const res = await fetchWithTimeoutAndRetry(
        'https://api.razorpay.com/v1/orders',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${authB64}`,
          },
          body: JSON.stringify({
            amount: plan.monthlyPriceInr * 100, // paise
            currency: 'INR',
            receipt: `kraya_${ctx.workspaceId}_${Date.now()}`.slice(0, 40),
            notes: {
              workspaceId: ctx.workspaceId,
              planCode: plan.code,
            },
          }),
        },
        { timeoutMs: 10_000, maxRetries: 1 }
      );
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return c.json({ error: `Razorpay order creation failed (${res.status}): ${err.slice(0, 200)}` }, 502);
      }
      const order = (await res.json()) as { id: string; amount: number; currency: string };
      return c.json({
        mode: 'razorpay_live_order',
        keyId: rzpKey,
        orderId: order.id,
        amountPaise: order.amount,
        currency: order.currency,
        plan,
      });
    }

    // Pilot / Dev mode instant activation (or downgrade to free_pilot)
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);
    const existing = await db
      .select()
      .from(schema.workspaceSubscriptions)
      .where(eq(schema.workspaceSubscriptions.workspaceId, ctx.workspaceId))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.workspaceSubscriptions)
        .set({
          planCode: plan.code,
          status: 'active',
          monthlyPriceInr: plan.monthlyPriceInr,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceSubscriptions.workspaceId, ctx.workspaceId));
    } else {
      await db.insert(schema.workspaceSubscriptions).values({
        workspaceId: ctx.workspaceId,
        planCode: plan.code,
        status: 'active',
        monthlyPriceInr: plan.monthlyPriceInr,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
      });
    }

    await recordAuditLog(db, ctx, 'subscription_plan_updated', 'workspace_subscription', ctx.workspaceId, {
      planCode: plan.code,
      monthlyPriceInr: plan.monthlyPriceInr,
      mode: rzpKey ? 'free_downgrade' : 'pilot_preview_activation',
    });

    return c.json({
      mode: 'pilot_activated',
      plan,
      currentPeriodEnd: periodEnd.toISOString(),
      note: rzpKey
        ? 'Plan updated.'
        : 'Activated in Pilot mode. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET & RAZORPAY_WEBHOOK_SECRET for live INR billing.',
    });
  });

  // 3. Verified Razorpay Payment Webhook (HMAC-SHA256)
  app.post('/api/webhooks/razorpay', async (c) => {
    const webhookSecret = helpers.getEnv('RAZORPAY_WEBHOOK_SECRET')?.trim();
    const signature = c.req.header('x-razorpay-signature') || '';
    const rawBody = await c.req.text();

    if (!webhookSecret || !(await verifyHmacSha256Hex(rawBody, signature, webhookSecret))) {
      return c.json({ error: 'Invalid or missing x-razorpay-signature.' }, 401);
    }

    const payload = JSON.parse(rawBody) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            notes?: { workspaceId?: string; planCode?: PlanDefinition['code'] };
          };
        };
      };
    };

    const entity = payload.payload?.payment?.entity;
    const wsId = entity?.notes?.workspaceId;
    const planCode = entity?.notes?.planCode;
    const plan = KRAYA_SAAS_PLANS.find((p) => p.code === planCode);

    if (payload.event === 'payment.captured' && wsId && plan) {
      const db = await getDb(helpers.getEnv('DATABASE_URL'));
      const periodEnd = new Date(Date.now() + 30 * 86_400_000);
      const existing = await db
        .select()
        .from(schema.workspaceSubscriptions)
        .where(eq(schema.workspaceSubscriptions.workspaceId, wsId))
        .limit(1);

      if (existing[0]) {
        await db
          .update(schema.workspaceSubscriptions)
          .set({
            planCode: plan.code,
            status: 'active',
            monthlyPriceInr: plan.monthlyPriceInr,
            razorpayOrderId: entity?.order_id ?? null,
            razorpayPaymentId: entity?.id ?? null,
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
            updatedAt: new Date(),
          })
          .where(eq(schema.workspaceSubscriptions.workspaceId, wsId));
      } else {
        await db.insert(schema.workspaceSubscriptions).values({
          workspaceId: wsId,
          planCode: plan.code,
          status: 'active',
          monthlyPriceInr: plan.monthlyPriceInr,
          razorpayOrderId: entity?.order_id ?? null,
          razorpayPaymentId: entity?.id ?? null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        });
      }

      await recordAuditLog(
        db,
        { workspaceId: wsId, email: 'razorpay@kraya.billing', role: 'owner' },
        'razorpay_payment_captured',
        'workspace_subscription',
        wsId,
        { planCode: plan.code, paymentId: entity?.id ?? null }
      );
      return c.json({ ok: true, activatedPlan: plan.code });
    }

    return c.json({ ok: true, ignoredEvent: payload.event || 'unknown' });
  });
}
