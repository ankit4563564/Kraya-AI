import type { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import {
  buildRazorpayXPayoutDraft,
  dispatchAutomationEvent,
  generateTallyPurchaseXml,
  KrayaAutomationEventType,
  N8N_WORKFLOW_TEMPLATES,
  pushBillToZohoBooks,
  pushVoucherToTallyPrime,
  runAutonomousOperationsAgent,
  runCfoStrategistAgent,
  runComplianceTaxShieldAgent,
  runIntakeForensicsAgent,
  runNegotiationAgent,
  runOrchestratorAgent,
  runSourcingIntelligenceAgent,
  SpecialistAgentId,
  SpecialistAgentReport,
  verifyIndianIfscLive,
  verifySupplierGlobalRegistry,
  verifyUdyamLive,
  webhookSubscribesTo,
} from '@kraya/agent-core';
import {
  FreightGstMode,
  GstRegime,
  QuoteCostInput,
  SupplierTaxProfile,
  UdyamTier,
} from '@kraya/finance-engine';
import { getDb, KrayaDb } from './db/client.js';
import * as schema from './db/schema.js';
import { AppHelpers, AppVariables, recordAuditLog, uid, verifyWorkspaceAuditChain } from './context.js';
import { lookupOrVerifyGstin } from './routes-gstn.js';
import {
  buildAgentRuntimeConfig,
  loadWorkspaceLiveMemory,
  persistAgentRun,
} from './routes-agents.js';

/**
 * Emits a signed HMAC-SHA256 automation event to all matching enabled webhooks
 * (n8n / Make / Zapier / custom) configured for the workspace, plus optional global N8N_DEFAULT_WEBHOOK_URL.
 * Never throws or blocks primary procurement transactions.
 */
export async function emitWorkspaceAutomationEvent(params: {
  db: KrayaDb;
  workspaceId: string;
  eventType: KrayaAutomationEventType;
  payload: Record<string, unknown>;
  helpers: AppHelpers;
}): Promise<{ dispatchedCount: number; successes: number }> {
  try {
    const targets = await params.db
      .select()
      .from(schema.automationWebhooks)
      .where(
        and(
          eq(schema.automationWebhooks.workspaceId, params.workspaceId),
          eq(schema.automationWebhooks.enabled, true)
        )
      );

    const allTargets = targets.map((t) => ({
      id: t.id,
      name: t.name,
      provider: t.provider,
      targetUrl: t.targetUrl,
      signingSecret: t.signingSecret,
      subscribedEvents: Array.isArray(t.subscribedEventsJson)
        ? (t.subscribedEventsJson as string[])
        : ['*'],
      enabled: t.enabled,
    }));

    const globalUrl = params.helpers.getEnv('N8N_DEFAULT_WEBHOOK_URL')?.trim();
    if (globalUrl && !allTargets.some((t) => t.targetUrl === globalUrl)) {
      allTargets.push({
        id: 'env-default-n8n',
        name: 'Default n8n Webhook (Env)',
        provider: 'n8n',
        targetUrl: globalUrl,
        signingSecret: params.helpers.getEnv('N8N_WEBHOOK_SECRET') || null,
        subscribedEvents: ['*'],
        enabled: true,
      });
    }

    const matching = allTargets.filter((t) => webhookSubscribesTo(t, params.eventType));
    if (matching.length === 0) return { dispatchedCount: 0, successes: 0 };

    let successes = 0;
    for (const target of matching) {
      const deliveryId = uid('dlv');
      const res = await dispatchAutomationEvent(target, {
        deliveryId,
        eventType: params.eventType,
        workspaceId: params.workspaceId,
        occurredAt: new Date().toISOString(),
        source: 'kraya-api',
        payload: params.payload,
      });
      if (res.ok) successes++;

      await params.db.insert(schema.automationDeliveries).values({
        id: deliveryId,
        workspaceId: params.workspaceId,
        webhookId: target.id === 'env-default-n8n' ? null : target.id,
        provider: target.provider,
        eventType: params.eventType,
        targetUrl: target.targetUrl,
        ok: res.ok,
        httpStatus: res.httpStatus,
        durationMs: res.durationMs,
        responsePreview: res.responsePreview,
      });
    }

    return { dispatchedCount: matching.length, successes };
  } catch (err) {
    console.warn('[Kraya Automation Bus] Dispatch warning:', err);
    return { dispatchedCount: 0, successes: 0 };
  }
}

export function registerConnectorRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // 1. Full External Connector & API Integration Catalog + Workspace Webhooks + Recent Deliveries
  app.get('/api/connectors/catalog', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [webhooks, deliveries] = await Promise.all([
      db
        .select()
        .from(schema.automationWebhooks)
        .where(eq(schema.automationWebhooks.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.automationWebhooks.createdAt)),
      db
        .select()
        .from(schema.automationDeliveries)
        .where(eq(schema.automationDeliveries.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.automationDeliveries.createdAt))
        .limit(20),
    ]);

    const connectors = [
      {
        id: 'n8n_bus',
        name: 'n8n Bi-Directional Event Bus & Live API',
        category: 'Workflow Automation',
        status:
          webhooks.some((w) => w.enabled) ||
          Boolean(helpers.getEnv('N8N_DEFAULT_WEBHOOK_URL')) ||
          Boolean(helpers.getEnv('N8N_API_URL') && helpers.getEnv('N8N_API_KEY'))
            ? 'connected'
            : 'ready_to_connect',
        envVars: ['N8N_API_URL', 'N8N_API_KEY', 'N8N_DEFAULT_WEBHOOK_URL', 'N8N_WEBHOOK_SECRET'],
        description:
          'Streams signed HMAC-SHA256 events (Money Leaks, PO Approvals, 43B-h Cliffs, Morning Sweeps) to live n8n workflows and accepts callbacks back into Kraya.',
      },
      {
        id: 'gemini_live',
        name: 'Google Gemini 3.8 Flash + Google Search Grounding',
        category: 'AI & Multimodal OCR',
        status: helpers.getEnv('GEMINI_API_KEY') ? 'connected' : 'fallback_active',
        envVars: ['GEMINI_API_KEY', 'GEMINI_MODEL'],
        description: 'Reads PDFs, WhatsApp screenshots, handwritten parchis, and grounds live Indian market intelligence.',
      },
      {
        id: 'live_directory',
        name: 'Real-Time B2B Supplier Directory (Google Places / Serper / Tavily)',
        category: 'Supplier Sourcing',
        status:
          helpers.getEnv('GOOGLE_MAPS_API_KEY') ||
          helpers.getEnv('SERPER_API_KEY') ||
          helpers.getEnv('TAVILY_API_KEY')
            ? 'connected'
            : 'fallback_active',
        envVars: ['GOOGLE_MAPS_API_KEY', 'SERPER_API_KEY', 'TAVILY_API_KEY'],
        description: 'Pulls real Indian factory addresses, phone numbers, Google ratings, and IndiaMART/TradeIndia leads.',
      },
      {
        id: 'gstn_live',
        name: 'Live GSTN Taxpayer Verification (30-Day Cached)',
        category: 'Indian Tax Compliance',
        status:
          helpers.getEnv('GSTN_API_KEY') || helpers.getEnv('GSTN_API_URL')
            ? 'connected'
            : 'offline_checksum_active',
        envVars: ['GSTN_API_PROVIDER', 'GSTN_API_KEY', 'GSTN_API_URL'],
        description: 'Checks live Active/Cancelled/Composition/e-Invoice status via AppyFlow, GSTZen, or MasterGST.',
      },
      {
        id: 'udyam_live',
        name: 'Live Udyam MSME Verification (Section 43B-h)',
        category: 'Indian Tax Compliance',
        status:
          helpers.getEnv('UDYAM_API_KEY') || helpers.getEnv('UDYAM_API_URL')
            ? 'connected'
            : 'offline_format_active',
        envVars: ['UDYAM_API_PROVIDER', 'UDYAM_API_KEY', 'UDYAM_API_URL'],
        description: 'Verifies Micro/Small vs Trading classification via Surepass / Sandbox.co.in for legal 45-day caps.',
      },
      {
        id: 'zoho_books',
        name: 'Zoho Books India Direct API Push',
        category: 'Accounting & ERP',
        status:
          helpers.getEnv('ZOHO_BOOKS_ACCESS_TOKEN') && helpers.getEnv('ZOHO_BOOKS_ORG_ID')
            ? 'connected'
            : 'csv_and_dry_run_ready',
        envVars: ['ZOHO_BOOKS_ACCESS_TOKEN', 'ZOHO_BOOKS_ORG_ID', 'ZOHO_BOOKS_API_DOMAIN'],
        description: 'Pushes audited Purchase Bills directly to Zoho Books India API (or exports Zoho CSV / syncs via n8n).',
      },
      {
        id: 'tally_prime',
        name: 'Tally Prime Live HTTP XML Push',
        category: 'Accounting & ERP',
        status: helpers.getEnv('TALLY_SERVER_URL') ? 'connected' : 'xml_export_ready',
        envVars: ['TALLY_SERVER_URL', 'TALLY_AUTH_HEADER'],
        description: 'Pushes Purchase Vouchers directly into Tally Prime port 9000 via Cloudflare Tunnel (or downloads Tally XML).',
      },
      {
        id: 'razorpay_ifsc_payouts',
        name: 'Razorpay Live IFSC (Free) + RazorpayX Payout Drafts',
        category: 'Banking & Payouts',
        status:
          helpers.getEnv('RAZORPAYX_KEY_ID') && helpers.getEnv('RAZORPAYX_KEY_SECRET')
            ? 'connected'
            : 'free_ifsc_live',
        envVars: ['RAZORPAYX_KEY_ID', 'RAZORPAYX_KEY_SECRET', 'RAZORPAYX_ACCOUNT_NUMBER'],
        description: '100% free live Indian Bank IFSC verification + approval-gated NEFT/RTGS payout drafts.',
      },
      {
        id: 'whatsapp_email',
        name: 'Meta WhatsApp Cloud API + Resend + Cloudflare Email Routing',
        category: 'Messaging & Ingress',
        status:
          helpers.getEnv('WHATSAPP_ACCESS_TOKEN') || helpers.getEnv('RESEND_API_KEY')
            ? 'connected'
            : 'zero_ban_bridges_active',
        envVars: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'RESEND_API_KEY', 'INBOUND_WEBHOOK_SECRET'],
        description: 'Two-way WhatsApp automation, Resend transactional email, and zero-cost Cloudflare Email Routing PDF ingestion.',
      },
    ];

    return c.json({
      connectors,
      webhooks: webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        provider: w.provider,
        targetUrl: w.targetUrl,
        hasSigningSecret: Boolean(w.signingSecret),
        subscribedEvents: w.subscribedEventsJson,
        enabled: w.enabled,
        createdAt: w.createdAt,
      })),
      recentDeliveries: deliveries,
      n8nTemplates: N8N_WORKFLOW_TEMPLATES.map((t) => ({
        slug: t.slug,
        title: t.title,
        description: t.description,
        triggers: t.triggers,
        requiredCredentials: t.requiredCredentials,
        downloadPath: `/api/connectors/n8n-templates/${t.slug}`,
      })),
    });
  });

  // 2. Download any of the 4 Ready-to-Import n8n Workflow JSON Templates
  app.get('/api/connectors/n8n-templates/:slug', (c) => {
    const slug = c.req.param('slug');
    const tpl = N8N_WORKFLOW_TEMPLATES.find((t) => t.slug === slug);
    if (!tpl) return c.json({ error: 'n8n workflow template not found.' }, 404);
    c.header('Content-Disposition', `attachment; filename="kraya-n8n-${tpl.slug}.json"`);
    return c.json(tpl.workflowJson);
  });

  // 3. Register an n8n / Make / Zapier / Custom Outbound Webhook
  app.post('/api/connectors/webhooks', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role === 'ca') {
      return c.json({ error: 'CA read-only role cannot configure automation webhooks.' }, 403);
    }
    const body = await c.req.json<{
      name?: string;
      provider?: string;
      targetUrl?: string;
      signingSecret?: string;
      subscribedEvents?: string[];
      enabled?: boolean;
    }>();

    const name = (body.name || '').trim();
    const targetUrl = (body.targetUrl || '').trim();
    if (!name || !/^https?:\/\/.+/.test(targetUrl)) {
      return c.json({ error: 'Valid webhook name and http(s) targetUrl are required.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [created] = await db
      .insert(schema.automationWebhooks)
      .values({
        id: uid('whk'),
        workspaceId: ctx.workspaceId,
        name,
        provider: (body.provider || 'n8n').trim().toLowerCase(),
        targetUrl,
        signingSecret: body.signingSecret?.trim() || null,
        subscribedEventsJson:
          Array.isArray(body.subscribedEvents) && body.subscribedEvents.length > 0
            ? body.subscribedEvents
            : ['*'],
        enabled: body.enabled !== false,
        createdBy: ctx.email,
      })
      .returning();

    await recordAuditLog(db, ctx, 'automation_webhook_created', 'automation_webhook', created.id, {
      name,
      provider: created.provider,
      targetUrl,
    });

    return c.json(
      {
        id: created.id,
        name: created.name,
        provider: created.provider,
        targetUrl: created.targetUrl,
        hasSigningSecret: Boolean(created.signingSecret),
        subscribedEvents: created.subscribedEventsJson,
        enabled: created.enabled,
      },
      201
    );
  });

  // 4. Fire a Signed Test Event to a Configured Webhook
  app.post('/api/connectors/webhooks/:id/test', async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [wh] = await db
      .select()
      .from(schema.automationWebhooks)
      .where(
        and(
          eq(schema.automationWebhooks.id, id),
          eq(schema.automationWebhooks.workspaceId, ctx.workspaceId)
        )
      )
      .limit(1);
    if (!wh) return c.json({ error: 'Webhook not found in this workspace.' }, 404);

    const deliveryId = uid('dlv');
    const result = await dispatchAutomationEvent(
      {
        id: wh.id,
        name: wh.name,
        targetUrl: wh.targetUrl,
        signingSecret: wh.signingSecret,
        subscribedEvents: ['*'],
        enabled: true,
      },
      {
        deliveryId,
        eventType: 'connector.test',
        workspaceId: ctx.workspaceId,
        occurredAt: new Date().toISOString(),
        source: 'kraya-api',
        payload: {
          message: 'Test event from Kraya Automation Bus',
          triggeredBy: ctx.email,
        },
      }
    );

    await db.insert(schema.automationDeliveries).values({
      id: deliveryId,
      workspaceId: ctx.workspaceId,
      webhookId: wh.id,
      provider: wh.provider,
      eventType: 'connector.test',
      targetUrl: wh.targetUrl,
      ok: result.ok,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      responsePreview: result.responsePreview,
    });

    return c.json(result);
  });

  // 5. Delete an Automation Webhook
  app.delete('/api/connectors/webhooks/:id', async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    await db
      .delete(schema.automationWebhooks)
      .where(
        and(
          eq(schema.automationWebhooks.id, id),
          eq(schema.automationWebhooks.workspaceId, ctx.workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  // 6. Bi-Directional n8n Callback Receiver (Secret-Protected)
  // Allows n8n workflows to mark invoices paid (UTR), record Zoho/Tally sync IDs, or update Udyam tier!
  app.post('/api/connectors/n8n/callback', async (c) => {
    const expectedSecret =
      helpers.getEnv('N8N_WEBHOOK_SECRET') || helpers.getEnv('INBOUND_WEBHOOK_SECRET');
    const provided = c.req.header('x-kraya-webhook-secret') || c.req.header('x-kraya-n8n-secret');
    if (!expectedSecret || provided !== expectedSecret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-webhook-secret required.' }, 401);
    }

    const wsId =
      c.req.header('x-kraya-workspace-id') || helpers.getEnv('WEBHOOK_DEFAULT_WORKSPACE_ID');
    if (!wsId) {
      return c.json({ error: 'x-kraya-workspace-id header is required.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      action: 'mark_invoice_paid' | 'record_erp_sync' | 'update_supplier_udyam';
      invoiceId?: string;
      supplierId?: string;
      paymentUtr?: string;
      erpProvider?: string;
      externalVoucherId?: string;
      udyamNumber?: string;
      udyamTier?: string;
    }>();

    if (body.action === 'mark_invoice_paid' && body.invoiceId) {
      const [updated] = await db
        .update(schema.invoices)
        .set({ paidAt: new Date() })
        .where(and(eq(schema.invoices.id, body.invoiceId), eq(schema.invoices.workspaceId, wsId)))
        .returning();
      if (!updated) return c.json({ error: 'Invoice not found.' }, 404);
      await recordAuditLog(
        db,
        { workspaceId: wsId, email: 'n8n@kraya.automation', role: 'owner' },
        'n8n_invoice_marked_paid',
        'invoice',
        updated.id,
        { paymentUtr: body.paymentUtr || null }
      );
      return c.json({ ok: true, action: body.action, invoiceId: updated.id, paidAt: updated.paidAt });
    }

    if (body.action === 'record_erp_sync' && body.invoiceId) {
      await recordAuditLog(
        db,
        { workspaceId: wsId, email: 'n8n@kraya.automation', role: 'owner' },
        'n8n_erp_voucher_synced',
        'invoice',
        body.invoiceId,
        {
          erpProvider: body.erpProvider || 'zoho_books',
          externalVoucherId: body.externalVoucherId || null,
        }
      );
      return c.json({
        ok: true,
        action: body.action,
        invoiceId: body.invoiceId,
        externalVoucherId: body.externalVoucherId || null,
      });
    }

    if (body.action === 'update_supplier_udyam' && body.supplierId && body.udyamTier) {
      const [updated] = await db
        .update(schema.suppliers)
        .set({
          udyamNumber: body.udyamNumber || undefined,
          udyamTier: body.udyamTier,
        })
        .where(and(eq(schema.suppliers.id, body.supplierId), eq(schema.suppliers.workspaceId, wsId)))
        .returning();
      if (!updated) return c.json({ error: 'Supplier not found.' }, 404);
      return c.json({ ok: true, action: body.action, supplierId: updated.id, udyamTier: updated.udyamTier });
    }

    return c.json({ error: 'Unsupported n8n callback action or missing entity ID.' }, 400);
  });

  // 7. Direct ERP Push (Zoho Books India API OR Tally Prime HTTP XML Push + RazorpayX Payout Draft)
  app.post('/api/connectors/erp/push-invoice', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role === 'ca') {
      return c.json({ error: 'CA read-only role cannot push ERP vouchers.' }, 403);
    }
    const body = await c.req.json<{
      invoiceId: string;
      provider: 'zoho_books' | 'tally_prime';
      zohoVendorId?: string;
    }>();

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [[ws], [inv]] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId)).limit(1),
      db
        .select()
        .from(schema.invoices)
        .where(
          and(eq(schema.invoices.id, body.invoiceId), eq(schema.invoices.workspaceId, ctx.workspaceId))
        )
        .limit(1),
    ]);

    if (!ws || !inv) return c.json({ error: 'Invoice not found in this workspace.' }, 404);
    const [sup] = await db
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, inv.supplierId), eq(schema.suppliers.workspaceId, ctx.workspaceId)))
      .limit(1);

    const rawItems = Array.isArray(inv.itemsJson)
      ? (inv.itemsJson as Array<{
          description?: string;
          hsnSac?: string | null;
          qty?: number;
          unit?: string;
          unitRateRupees?: number;
        }>)
      : [];

    const items =
      rawItems.length > 0
        ? rawItems.map((it) => ({
            description: it.description || 'Goods',
            hsnSac: it.hsnSac ?? null,
            qty: it.qty ?? 1,
            unit: it.unit || 'pc',
            unitRatePaise: Math.round((it.unitRateRupees ?? inv.taxablePaise / 100) * 100),
            taxablePaise: inv.taxablePaise,
          }))
        : [
            {
              description: 'Audited Goods',
              hsnSac: null,
              qty: 1,
              unit: 'lot',
              unitRatePaise: inv.taxablePaise,
              taxablePaise: inv.taxablePaise,
            },
          ];

    let pushResult;
    if (body.provider === 'tally_prime') {
      const tallyXml = generateTallyPurchaseXml({
        buyerCompany: ws.legalName,
        vouchers: [
          {
            voucherNumber: inv.invoiceNumber,
            dateIso: inv.invoiceDate,
            supplierName: sup?.name || 'Supplier',
            supplierGstin: inv.supplierGstin || sup?.gstin,
            taxablePaise: inv.taxablePaise,
            cgstPaise: inv.cgstPaise,
            sgstPaise: inv.sgstPaise,
            igstPaise: inv.igstPaise,
            grandTotalPaise: inv.grandTotalPaise,
            narration: `Audited by Kraya CFO Engine (${inv.poMatchStatus})`,
          },
        ],
      });
      pushResult = await pushVoucherToTallyPrime(tallyXml, inv.invoiceNumber, {
        tallyServerUrl: helpers.getEnv('TALLY_SERVER_URL'),
        authHeader: helpers.getEnv('TALLY_AUTH_HEADER'),
      });
    } else {
      pushResult = await pushBillToZohoBooks(
        {
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.paymentDueAt,
          supplierName: sup?.name || 'Supplier',
          supplierGstin: inv.supplierGstin || sup?.gstin,
          buyerCompanyName: ws.legalName,
          items,
          taxablePaise: inv.taxablePaise,
          cgstPaise: inv.cgstPaise,
          sgstPaise: inv.sgstPaise,
          igstPaise: inv.igstPaise,
          grandTotalPaise: inv.grandTotalPaise,
        },
        {
          accessToken: helpers.getEnv('ZOHO_BOOKS_ACCESS_TOKEN'),
          organizationId: helpers.getEnv('ZOHO_BOOKS_ORG_ID'),
          apiDomain: helpers.getEnv('ZOHO_BOOKS_API_DOMAIN'),
          vendorId: body.zohoVendorId,
        }
      );
    }

    const payoutDraft = buildRazorpayXPayoutDraft({
      invoiceNumber: inv.invoiceNumber,
      supplierName: sup?.name || 'Supplier',
      netPayablePaise: inv.grandTotalPaise,
      hasLiveRazorpayXCreds: Boolean(
        helpers.getEnv('RAZORPAYX_KEY_ID') && helpers.getEnv('RAZORPAYX_KEY_SECRET')
      ),
    });

    await recordAuditLog(db, ctx, 'erp_push_executed', 'invoice', inv.id, {
      provider: body.provider,
      mode: pushResult.mode,
      ok: pushResult.ok,
      externalId: pushResult.externalId,
    });

    return c.json({ ...pushResult, payoutDraft });
  });

  // 8. Live Udyam MSME Verification (Section 43B-h)
  app.post('/api/connectors/verify-udyam', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      udyamNumber?: string;
      supplierId?: string;
      applyToSupplier?: boolean;
      skipNetwork?: boolean;
    }>();
    if (!body.udyamNumber?.trim()) {
      return c.json({ error: 'udyamNumber is required (e.g. UDYAM-KA-03-0012345).' }, 400);
    }

    const res = await verifyUdyamLive(body.udyamNumber, {
      provider: helpers.getEnv('UDYAM_API_PROVIDER'),
      apiKey: helpers.getEnv('UDYAM_API_KEY'),
      apiUrl: helpers.getEnv('UDYAM_API_URL'),
      skipNetwork: Boolean(body.skipNetwork),
    });

    let supplierUpdated = false;
    if (body.supplierId && body.applyToSupplier !== false && ctx.role !== 'ca' && res.formatValid) {
      const db = await getDb(helpers.getEnv('DATABASE_URL'));
      await db
        .update(schema.suppliers)
        .set({
          udyamNumber: res.udyamNumber,
          ...(res.liveVerified ? { udyamTier: res.enterpriseTier } : {}),
        })
        .where(
          and(
            eq(schema.suppliers.id, body.supplierId),
            eq(schema.suppliers.workspaceId, ctx.workspaceId)
          )
        );
      supplierUpdated = true;
    }

    return c.json({ ...res, supplierUpdated });
  });

  // 9. 100% Free Live Indian Bank IFSC Verification (Razorpay Public API)
  app.get('/api/connectors/ifsc/:code', async (c) => {
    const code = c.req.param('code');
    const skipNetwork = c.req.query('offline') === 'true';
    const res = await verifyIndianIfscLive(code, skipNetwork);
    return c.json(res, res.valid ? 200 : 400);
  });

  // 10. Live n8n Instance Workflows & Executions Inspector (via N8N_API_URL + N8N_API_KEY)
  app.get('/api/connectors/n8n/live-workflows', async (c) => {
    const baseUrl = helpers.getEnv('N8N_API_URL')?.trim().replace(/\/+$/, '');
    const apiKey = helpers.getEnv('N8N_API_KEY')?.trim();
    if (!baseUrl || !apiKey) {
      return c.json({
        connected: false,
        baseUrl: baseUrl || null,
        workflows: [],
        recentExecutions: [],
      });
    }

    try {
      const [wfRes, exRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/workflows`, {
          headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' },
        }),
        fetch(`${baseUrl}/api/v1/executions?limit=10`, {
          headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' },
        }),
      ]);
      const wfData = wfRes.ok
        ? ((await wfRes.json()) as {
            data?: Array<{ id: string; name: string; active: boolean; updatedAt?: string }>;
          })
        : { data: [] };
      const exData = exRes.ok
        ? ((await exRes.json()) as {
            data?: Array<{ id: string; workflowId: string; status: string; finished: boolean; startedAt?: string }>;
          })
        : { data: [] };

      return c.json({
        connected: wfRes.ok,
        baseUrl,
        defaultWebhookUrl: helpers.getEnv('N8N_DEFAULT_WEBHOOK_URL') || null,
        workflows: (wfData.data || []).map((w) => ({
          id: w.id,
          name: w.name,
          active: Boolean(w.active),
          updatedAt: w.updatedAt || null,
          editorUrl: `${baseUrl}/workflow/${w.id}`,
        })),
        recentExecutions: (exData.data || []).map((e) => ({
          id: e.id,
          workflowId: e.workflowId,
          status: e.status,
          finished: Boolean(e.finished),
          startedAt: e.startedAt || null,
        })),
      });
    } catch (err) {
      return c.json({
        connected: false,
        baseUrl,
        error: err instanceof Error ? err.message : 'Could not reach n8n instance',
        workflows: [],
        recentExecutions: [],
      });
    }
  });

  // 11. Secret-Authenticated n8n -> Kraya Specialist Agent Brain Runner
  // Lets live n8n workflows invoke ANY of Kraya's 8 Specialist Agents against real PostgreSQL workspace data!
  app.post('/api/internal/n8n/agent-run', async (c) => {
    const expectedSecret =
      helpers.getEnv('N8N_WEBHOOK_SECRET') || helpers.getEnv('INBOUND_WEBHOOK_SECRET');
    const provided =
      c.req.header('x-kraya-webhook-secret') || c.req.header('x-kraya-n8n-secret');
    if (!expectedSecret || provided !== expectedSecret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-webhook-secret required.' }, 401);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      workspaceId?: string;
      agentId?: SpecialistAgentId;
      promptText?: string;
      query?: string;
      rfqId?: string;
      buyerCity?: string;
      skipNetwork?: boolean;
    }>();

    let wsId = (
      body.workspaceId ||
      c.req.header('x-kraya-workspace-id') ||
      helpers.getEnv('WEBHOOK_DEFAULT_WORKSPACE_ID') ||
      ''
    ).trim();

    if (!wsId) {
      const [firstWs] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
      wsId = firstWs?.id || '';
    }
    if (!wsId) return c.json({ error: 'No workspace available.' }, 404);

    const memory = await loadWorkspaceLiveMemory(db, wsId);
    if (!memory) return c.json({ error: `Workspace ${wsId} not found.` }, 404);

    const agentId: SpecialistAgentId = body.agentId || 'orchestrator';
    const start = Date.now();
    const config = buildAgentRuntimeConfig(helpers.getEnv, Boolean(body.skipNetwork));
    let report: SpecialistAgentReport<unknown>;

    if (agentId === 'compliance') {
      const chain = await verifyWorkspaceAuditChain(db, wsId);
      report = await runComplianceTaxShieldAgent({ memory, auditChainValid: chain.valid, config });
    } else if (agentId === 'operations') {
      report = await runAutonomousOperationsAgent({ memory, config });
    } else if (agentId === 'intake') {
      report = await runIntakeForensicsAgent({
        promptText: body.promptText || '',
        channel: 'n8n',
        memory,
        config,
      });
    } else if (agentId === 'sourcing') {
      report = await runSourcingIntelligenceAgent({
        criteria: {
          query: body.query || body.promptText || 'Industrial packaging boxes',
          buyerCity: body.buyerCity || 'Bengaluru',
          buyerStateCode: memory.workspace.stateCode,
          buyerWaccPct: memory.workspace.waccPct,
        },
        memory,
        config,
      });
    } else if (agentId === 'cfo_strategist' || agentId === 'negotiation') {
      const targetRfq = body.rfqId
        ? memory.rfqs.find((r) => r.id === body.rfqId)
        : memory.rfqs.find((r) => r.quoteCount > 0) || memory.rfqs[0];
      const dbQuotes = targetRfq
        ? await db
            .select()
            .from(schema.quotes)
            .where(and(eq(schema.quotes.workspaceId, wsId), eq(schema.quotes.rfqId, targetRfq.id)))
        : [];
      const supById = new Map(memory.suppliers.map((s) => [s.id, s]));

      if (agentId === 'negotiation' && dbQuotes.length > 0 && targetRfq) {
        report = await runNegotiationAgent({
          rfqTitle: targetRfq.title,
          memory,
          config,
          quotes: dbQuotes.map((q) => {
            const sup = supById.get(q.supplierId);
            return {
              quoteId: q.id,
              supplierId: q.supplierId,
              supplierName: sup?.name || 'Supplier',
              supplierPhone: sup?.phone,
              supplierEmail: sup?.email,
              baseUnitPaise: q.baseUnitPaise,
              netLandedUnitPaise: q.netLandedUnitPaise,
              creditAdjustedUnitPaise: q.creditAdjustedUnitPaise,
              creditDays: q.creditDays,
              leadTimeDays: q.leadTimeDays,
              reliabilityScore: sup?.reliabilityScore ?? 85,
              quantity: q.quantity,
              unit: q.rawUnit,
            };
          }),
        });
      } else {
        const quoteInputs: QuoteCostInput[] = dbQuotes.map((q) => {
          const sup = supById.get(q.supplierId);
          const supProfile: SupplierTaxProfile = {
            id: q.supplierId,
            name: sup?.name || 'Supplier',
            gstin: sup?.gstin,
            stateCode: sup?.stateCode,
            gstRegime: (sup?.gstRegime as GstRegime) || 'regular',
            udyamTier: (sup?.udyamTier as UdyamTier) || 'unknown',
            eInvoiceRequired: sup?.eInvoiceRequired ?? false,
            reliabilityScore: sup?.reliabilityScore ?? 85,
          };
          return {
            quoteId: q.id,
            supplier: supProfile,
            quantity: q.quantity,
            rawRateRupees: q.rawRateRupees,
            rawUnit: q.rawUnit,
            gstPct: q.gstPct,
            isGstInclusive: q.isGstInclusive,
            freightTotalRupees: q.freightPaise / 100,
            freightGstMode: (q.freightGstMode as FreightGstMode) || 'composite_supply',
            creditDays: q.creditDays,
            hasWrittenAgreement: true,
            leadTimeDays: q.leadTimeDays,
          };
        });
        report = await runCfoStrategistAgent({
          rfqTitle: targetRfq?.title || 'Active RFQ',
          quotes: quoteInputs,
          memory,
          config,
        });
      }
    } else {
      report = await runOrchestratorAgent({
        promptText: body.promptText || 'Run comprehensive procurement review',
        channel: 'n8n',
        memory,
        config,
      });
    }

    const runId = await persistAgentRun(db, wsId, report, 'n8n_workflow', Date.now() - start);
    return c.json({ ok: true, workspaceId: wsId, runId, report });
  });

  // 12. Secret-Authenticated n8n -> Kraya Complete Supplier KYC Verification (GSTN + Udyam + IFSC + GLEIF)
  app.post('/api/internal/n8n/verify-supplier', async (c) => {
    const expectedSecret =
      helpers.getEnv('N8N_WEBHOOK_SECRET') || helpers.getEnv('INBOUND_WEBHOOK_SECRET');
    const provided =
      c.req.header('x-kraya-webhook-secret') || c.req.header('x-kraya-n8n-secret');
    if (!expectedSecret || provided !== expectedSecret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-webhook-secret required.' }, 401);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      workspaceId?: string;
      companyName?: string;
      gstin?: string;
      udyamNumber?: string;
      ifsc?: string;
    }>();

    let wsId = (
      body.workspaceId ||
      c.req.header('x-kraya-workspace-id') ||
      helpers.getEnv('WEBHOOK_DEFAULT_WORKSPACE_ID') ||
      ''
    ).trim();
    if (!wsId) {
      const [firstWs] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
      wsId = firstWs?.id || 'ws-primary';
    }

    const [gstnRes, udyamRes, ifscRes, gleifRes] = await Promise.all([
      body.gstin
        ? lookupOrVerifyGstin({ db, workspaceId: wsId, rawGstin: body.gstin, helpers })
        : Promise.resolve(null),
      body.udyamNumber
        ? verifyUdyamLive(body.udyamNumber, {
            provider: helpers.getEnv('UDYAM_API_PROVIDER'),
            apiKey: helpers.getEnv('UDYAM_API_KEY'),
            apiUrl: helpers.getEnv('UDYAM_API_URL'),
          })
        : Promise.resolve(null),
      body.ifsc ? verifyIndianIfscLive(body.ifsc) : Promise.resolve(null),
      body.companyName
        ? verifySupplierGlobalRegistry(body.companyName, helpers.getEnv('OPENCORPORATES_API_KEY'))
        : Promise.resolve(null),
    ]);

    let score = 0;
    const checks: string[] = [];
    if (gstnRes?.result.checksumValid) {
      score += 35;
      checks.push(`GSTIN Mod-36 Valid (${gstnRes.result.stateName}, TDS 194C ${gstnRes.result.tds194cRatePct}%)`);
    } else if (body.gstin) {
      checks.push('GSTIN INVALID — DO NOT PAY GST');
    }
    if (udyamRes?.formatValid) {
      score += 20;
      checks.push(`Udyam Valid (${udyamRes.udyamNumber})`);
    }
    if (ifscRes?.valid) {
      score += 25;
      checks.push(`Bank IFSC Live Verified (${ifscRes.bank || ifscRes.ifsc}${ifscRes.branch ? ` - ${ifscRes.branch}` : ''})`);
    }
    if (gleifRes?.isVerified) {
      score += 20;
      checks.push(`Global Registry Verified (${gleifRes.registrySource})`);
    } else if (body.companyName) {
      score += 10;
      checks.push('Local Indian SME (Unlisted in GLEIF)');
    }

    const verdict =
      gstnRes && !gstnRes.result.checksumValid
        ? 'BLOCK_INVALID_GSTIN'
        : score >= 70
          ? 'APPROVED_FOR_PO'
          : 'PARTIAL_KYC_COLLECT_DOCS';

    return c.json({
      ok: true,
      workspaceId: wsId,
      companyName: body.companyName || null,
      kycScorePct: Math.min(100, score),
      verdict,
      checks,
      gstn: gstnRes ? { ...gstnRes.result, fromCache: gstnRes.fromCache } : null,
      udyam: udyamRes,
      bankIfsc: ifscRes,
      globalRegistry: gleifRes,
    });
  });
}
