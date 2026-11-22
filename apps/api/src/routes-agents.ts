import type { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import {
  buildRealTimeMarketContext,
  KRAYA_AGENT_FLEET,
  runAuditorAgent,
  runAutonomousOperationsAgent,
  runCfoQuestionAnsweringAgent,
  runCfoStrategistAgent,
  runComplianceTaxShieldAgent,
  runIntakeForensicsAgent,
  runNegotiationAgent,
  runOrchestratorAgent,
  runSourcingIntelligenceAgent,
  AgentRuntimeConfig,
  QaConversationTurn,
  SpecialistAgentId,
  SpecialistAgentReport,
  WorkspaceLiveMemory,
  OutreachLanguage,
} from '@kraya/agent-core';
import {
  FreightGstMode,
  GstRegime,
  QuoteCostInput,
  SupplierTaxProfile,
  TurnoverBand,
  UdyamTier,
} from '@kraya/finance-engine';
import { getDb, KrayaDb } from './db/client.js';
import * as schema from './db/schema.js';
import {
  AppEnv,
  AppHelpers,
  AppVariables,
  recordAuditLog,
  uid,
  verifyWorkspaceAuditChain,
} from './context.js';
import { lookupOrVerifyGstin } from './routes-gstn.js';

export async function loadWorkspaceLiveMemory(
  db: KrayaDb,
  workspaceId: string
): Promise<WorkspaceLiveMemory | null> {
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  if (!ws) return null;

  const [
    suppliersList,
    rfqsList,
    quotesList,
    posList,
    grnsList,
    invoicesList,
    leaksList,
    amcsList,
    tasksList,
    priceHistList,
  ] = await Promise.all([
    db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, workspaceId)),
    db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, workspaceId)),
    db.select().from(schema.quotes).where(eq(schema.quotes.workspaceId, workspaceId)),
    db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, workspaceId)),
    db.select().from(schema.grnReceipts).where(eq(schema.grnReceipts.workspaceId, workspaceId)),
    db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, workspaceId)),
    db.select().from(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, workspaceId)),
    db.select().from(schema.amcSchedules).where(eq(schema.amcSchedules.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.dailyTasks)
      .where(and(eq(schema.dailyTasks.workspaceId, workspaceId), eq(schema.dailyTasks.status, 'open'))),
    db
      .select({ id: schema.priceHistory.id })
      .from(schema.priceHistory)
      .where(eq(schema.priceHistory.workspaceId, workspaceId)),
  ]);

  const supNameById = new Map(suppliersList.map((s) => [s.id, s.name]));
  const quoteCountByRfq = new Map<string, number>();
  for (const q of quotesList) {
    quoteCountByRfq.set(q.rfqId, (quoteCountByRfq.get(q.rfqId) || 0) + 1);
  }
  const grnCountByPo = new Map<string, number>();
  for (const g of grnsList) {
    grnCountByPo.set(g.poId, (grnCountByPo.get(g.poId) || 0) + 1);
  }

  const totalAnnualSpendPaise = invoicesList.reduce((acc, i) => acc + i.taxablePaise, 0);

  return {
    workspace: {
      id: ws.id,
      legalName: ws.legalName,
      gstin: ws.gstin,
      stateCode: ws.stateCode,
      gstRegime: ws.gstRegime as GstRegime,
      waccPct: ws.waccPct,
      turnoverBand: ws.turnoverBand as TurnoverBand,
      defaultOutreachLang: ws.defaultOutreachLang,
      policyPatchMd: ws.policyPatchMd,
      businessAddress: ws.businessAddress,
    },
    suppliers: suppliersList.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email,
      category: s.category,
      gstin: s.gstin,
      stateCode: s.stateCode,
      gstRegime: s.gstRegime,
      panEntityType: s.panEntityType,
      udyamTier: s.udyamTier,
      eInvoiceRequired: s.eInvoiceRequired,
      creditDays: s.creditDays,
      reliabilityScore: s.reliabilityScore,
    })),
    rfqs: rfqsList.map((r) => ({
      id: r.id,
      rfqNumber: r.rfqNumber,
      title: r.title,
      status: r.status,
      quoteCount: quoteCountByRfq.get(r.id) || 0,
      createdAt: r.createdAt,
    })),
    purchaseOrders: posList.map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      supplierId: p.supplierId,
      supplierName: supNameById.get(p.supplierId),
      totalPaise: p.totalPaise,
      paymentTermsDays: p.paymentTermsDays,
      deliveryDueAt: p.deliveryDueAt,
      invoiceStatus: p.invoiceStatus,
      revisionNumber: p.revisionNumber,
      cancelledAt: p.cancelledAt,
      hasFullGrn: (grnCountByPo.get(p.id) || 0) > 0,
    })),
    invoices: invoicesList.map((i) => ({
      id: i.id,
      poId: i.poId,
      supplierId: i.supplierId,
      supplierName: supNameById.get(i.supplierId),
      supplierGstin: i.supplierGstin,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      taxablePaise: i.taxablePaise,
      gstPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
      grandTotalPaise: i.grandTotalPaise,
      poMatchStatus: i.poMatchStatus,
      imsSuggestedAction: i.imsSuggestedAction,
      totalMoneyLeakPaise: i.totalMoneyLeakPaise,
      msme43bhDueAt: i.msme43bhDueAt,
      rule37CliffAt: i.rule37CliffAt,
      paidAt: i.paidAt,
    })),
    moneyLeaks: leaksList.map((l) => ({
      id: l.id,
      leakType: l.leakType,
      title: l.title,
      amountPaise: l.amountPaise,
      status: l.status,
      supplierId: l.supplierId,
    })),
    amcs: amcsList.map((a) => ({
      id: a.id,
      assetName: a.assetName,
      supplierId: a.supplierId,
      supplierName: a.supplierId ? supNameById.get(a.supplierId) || null : null,
      nextDueAt: a.nextDueAt,
      status: a.status,
    })),
    openTasks: tasksList.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      priority: t.priority,
      dueAt: t.dueAt,
      relatedId: t.relatedId,
      supplierId: t.supplierId,
    })),
    priceHistoryCount: priceHistList.length,
    totalAnnualSpendPaise,
  };
}

export async function persistAgentRun(
  db: KrayaDb,
  workspaceId: string,
  report: SpecialistAgentReport<unknown>,
  triggerSource: string,
  durationMs: number
): Promise<string> {
  const id = uid('agrun');
  try {
    await db.insert(schema.agentRuns).values({
      id,
      workspaceId,
      agentId: report.agentId,
      triggerSource,
      detectedState: report.detectedState,
      riskLevel: report.riskLevel,
      confidence: report.confidence,
      brainMode: report.brainMode,
      headline: report.headline,
      executiveVerdict: report.executiveVerdict,
      reportJson: report as unknown as Record<string, unknown>,
      durationMs: Math.max(0, Math.round(durationMs)),
    });
  } catch (err) {
    console.warn('[Kraya AgentRuns] Could not persist agent run:', err);
  }
  return id;
}

export function buildAgentRuntimeConfig(
  getEnv: <K extends keyof AppEnv>(key: K) => AppEnv[K],
  skipNetwork = false
): AgentRuntimeConfig {
  return {
    geminiApiKey: getEnv('GEMINI_API_KEY'),
    geminiModel: getEnv('GEMINI_MODEL'),
    googleMapsApiKey: getEnv('GOOGLE_MAPS_API_KEY'),
    openCorporatesApiKey: getEnv('OPENCORPORATES_API_KEY'),
    serperApiKey: getEnv('SERPER_API_KEY'),
    tavilyApiKey: getEnv('TAVILY_API_KEY'),
    gstnProvider: getEnv('GSTN_API_PROVIDER'),
    gstnApiKey: getEnv('GSTN_API_KEY'),
    gstnApiUrl: getEnv('GSTN_API_URL'),
    skipNetwork,
  };
}

/**
 * Reusable Morning Autonomous Sweep executor for a single workspace.
 * Runs Agent 7 (Operations Escalation Mind), creates deduplicated daily_tasks,
 * persists the agent_runs record, and logs to the tamper-evident audit chain.
 */
export async function runAutonomousSweepForWorkspace(params: {
  db: KrayaDb;
  workspaceId: string;
  actorEmail: string;
  actorRole: 'owner' | 'clerk' | 'ca';
  triggerSource: 'manual' | 'morning_cron' | 'agent_api';
  config?: AgentRuntimeConfig;
}): Promise<{
  workspaceId: string;
  createdTasksCount: number;
  createdTasks: Array<typeof schema.dailyTasks.$inferSelect>;
  agentReport: SpecialistAgentReport<unknown>;
}> {
  const start = Date.now();
  const memory = await loadWorkspaceLiveMemory(params.db, params.workspaceId);
  if (!memory) {
    throw new Error(`Workspace ${params.workspaceId} not found`);
  }

  const report = await runAutonomousOperationsAgent({
    memory,
    config: params.config,
  });

  const planned = report.structuredData?.sweepPlan.plannedTasks ?? [];
  const createdTasks: Array<typeof schema.dailyTasks.$inferSelect> = [];

  for (const t of planned) {
    const [row] = await params.db
      .insert(schema.dailyTasks)
      .values({
        id: uid('tsk'),
        workspaceId: params.workspaceId,
        kind: t.kind,
        title: t.title,
        supplierId: t.supplierId,
        relatedId: t.relatedId,
        priority: t.priority,
        dueAt: t.dueAt,
        suggestedMessage: t.suggestedMessage,
        status: 'open',
      })
      .returning();
    if (row) createdTasks.push(row);
  }

  await persistAgentRun(
    params.db,
    params.workspaceId,
    report,
    params.triggerSource,
    Date.now() - start
  );

  await recordAuditLog(
    params.db,
    { workspaceId: params.workspaceId, email: params.actorEmail, role: params.actorRole },
    params.triggerSource === 'morning_cron' ? 'autonomous_morning_cron_sweep' : 'autonomous_sweep_executed',
    'daily_task',
    null,
    {
      triggerSource: params.triggerSource,
      createdCount: createdTasks.length,
      detectedState: report.detectedState,
      riskLevel: report.riskLevel,
      summary: report.structuredData?.sweepPlan.summary,
    }
  );

  return {
    workspaceId: params.workspaceId,
    createdTasksCount: createdTasks.length,
    createdTasks,
    agentReport: report,
  };
}

/**
 * Multi-Workspace Morning Cron Runner (Cloudflare Workers `scheduled()` @ 08:00 AM IST / 02:30 UTC).
 * Sweeps every active workspace cleanly with zero cross-tenant leakage.
 */
export async function runAutonomousSweepAllWorkspaces(env?: Partial<AppEnv>): Promise<{
  ok: boolean;
  ranAt: string;
  workspacesSwept: number;
  totalTasksCreated: number;
  results: Array<{ workspaceId: string; createdTasksCount: number; detectedState: string }>;
}> {
  const dbUrl = env?.DATABASE_URL ?? (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined);
  const db = await getDb(dbUrl);
  const allWorkspaces = await db.select({ id: schema.workspaces.id }).from(schema.workspaces);

  const realTimeContext = await buildRealTimeMarketContext();
  const config: AgentRuntimeConfig = {
    geminiApiKey: env?.GEMINI_API_KEY,
    geminiModel: env?.GEMINI_MODEL,
    realTimeContext,
  };

  let totalTasksCreated = 0;
  const results: Array<{ workspaceId: string; createdTasksCount: number; detectedState: string }> = [];

  for (const ws of allWorkspaces) {
    try {
      const res = await runAutonomousSweepForWorkspace({
        db,
        workspaceId: ws.id,
        actorEmail: 'cron@kraya.system',
        actorRole: 'owner',
        triggerSource: 'morning_cron',
        config,
      });
      totalTasksCreated += res.createdTasksCount;
      results.push({
        workspaceId: ws.id,
        createdTasksCount: res.createdTasksCount,
        detectedState: res.agentReport.detectedState,
      });
    } catch (err) {
      console.error(`[Kraya Morning Cron] Sweep failed for workspace ${ws.id}:`, err);
    }
  }

  return {
    ok: true,
    ranAt: new Date().toISOString(),
    workspacesSwept: results.length,
    totalTasksCreated,
    results,
  };
}

export function registerAgentRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // 1. Agent Fleet Overview + Live Real-Time Context + Latest Runs
  app.get('/api/agents/fleet', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [realTimeContext, recentRuns] = await Promise.all([
      buildRealTimeMarketContext(),
      db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(24),
    ]);

    const latestByAgent = new Map<string, typeof schema.agentRuns.$inferSelect>();
    for (const r of recentRuns) {
      if (!latestByAgent.has(r.agentId)) latestByAgent.set(r.agentId, r);
    }

    return c.json({
      fleet: KRAYA_AGENT_FLEET.map((profile) => {
        const latest = latestByAgent.get(profile.agentId);
        return {
          ...profile,
          lastRun: latest
            ? {
                id: latest.id,
                detectedState: latest.detectedState,
                riskLevel: latest.riskLevel,
                confidence: latest.confidence,
                headline: latest.headline,
                brainMode: latest.brainMode,
                createdAt: latest.createdAt,
              }
            : null,
        };
      }),
      realTimeContext,
      morningCronSchedule: {
        cronUtc: '30 2 * * *',
        humanSchedule: 'Daily at 08:00 AM IST (02:30 UTC)',
        endpoint: '/api/internal/cron/morning-sweep',
      },
      aiCapabilities: {
        geminiLiveEnabled: Boolean(helpers.getEnv('GEMINI_API_KEY')),
        geminiModel: helpers.getEnv('GEMINI_MODEL') || 'gemini-3.8-flash',
        liveGstnApiEnabled: Boolean(helpers.getEnv('GSTN_API_KEY') || helpers.getEnv('GSTN_API_URL')),
        googleMapsEnabled: Boolean(helpers.getEnv('GOOGLE_MAPS_API_KEY')),
      },
    });
  });

  // 2. Real-Time Context & Live Workspace Memory Snapshot
  app.get('/api/agents/context', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [realTimeContext, memory] = await Promise.all([
      buildRealTimeMarketContext(),
      loadWorkspaceLiveMemory(db, ctx.workspaceId),
    ]);
    return c.json({
      realTimeContext,
      workspaceMemorySummary: memory
        ? {
            legalName: memory.workspace.legalName,
            gstRegime: memory.workspace.gstRegime,
            waccPct: memory.workspace.waccPct,
            suppliersCount: memory.suppliers.length,
            rfqsCount: memory.rfqs.length,
            purchaseOrdersCount: memory.purchaseOrders.length,
            invoicesCount: memory.invoices.length,
            activeLeaksCount: memory.moneyLeaks.filter((l) => l.status !== 'dismissed').length,
            openTasksCount: memory.openTasks.length,
            totalAnnualSpendPaise: memory.totalAnnualSpendPaise,
          }
        : null,
    });
  });

  // 3. Recent Agent Reasoning History
  app.get('/api/agents/runs', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(40);
    return c.json({ runs });
  });

  // 4. Execute Any Specialist Agent On-Demand Against Live Workspace Memory + Real-Time Data
  app.post('/api/agents/run', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      agentId: SpecialistAgentId;
      promptText?: string;
      rfqId?: string;
      invoiceId?: string;
      query?: string;
      buyerCity?: string;
      buyerPincode?: string;
      urgencyDays?: number;
      preferredLanguage?: OutreachLanguage;
      skipNetwork?: boolean;
    }>();

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const memory = await loadWorkspaceLiveMemory(db, ctx.workspaceId);
    if (!memory) return c.json({ error: 'Workspace not found.' }, 404);

    const start = Date.now();
    const config = buildAgentRuntimeConfig(helpers.getEnv, Boolean(body.skipNetwork));
    let report: SpecialistAgentReport<unknown>;

    switch (body.agentId) {
      case 'orchestrator': {
        report = await runOrchestratorAgent({
          promptText: body.promptText || 'Run full workspace procurement health check',
          memory,
          config,
        });
        break;
      }
      case 'intake': {
        report = await runIntakeForensicsAgent({
          promptText: body.promptText || '',
          channel: 'manual',
          memory,
          config,
        });
        break;
      }
      case 'sourcing': {
        report = await runSourcingIntelligenceAgent({
          criteria: {
            query: body.query || body.promptText || 'Corrugated packaging boxes 5-ply',
            buyerCity: body.buyerCity,
            buyerPincode: body.buyerPincode,
            buyerStateCode: memory.workspace.stateCode,
            buyerWaccPct: memory.workspace.waccPct,
            urgencyDays: body.urgencyDays,
          },
          memory,
          config,
        });
        break;
      }
      case 'cfo_strategist': {
        // Load RFQ quotes (either specified rfqId or most recent RFQ with quotes)
        const targetRfq = body.rfqId
          ? memory.rfqs.find((r) => r.id === body.rfqId)
          : memory.rfqs.find((r) => r.quoteCount > 0) || memory.rfqs[0];

        let quoteInputs: QuoteCostInput[] = [];
        if (targetRfq) {
          const dbQuotes = await db
            .select()
            .from(schema.quotes)
            .where(
              and(
                eq(schema.quotes.workspaceId, ctx.workspaceId),
                eq(schema.quotes.rfqId, targetRfq.id)
              )
            );
          const supById = new Map(memory.suppliers.map((s) => [s.id, s]));
          quoteInputs = dbQuotes.map((q) => {
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
        }
        report = await runCfoStrategistAgent({
          rfqTitle: targetRfq?.title || 'Active RFQ',
          quotes: quoteInputs,
          memory,
          config,
        });
        break;
      }
      case 'negotiation': {
        const targetRfq = body.rfqId
          ? memory.rfqs.find((r) => r.id === body.rfqId)
          : memory.rfqs.find((r) => r.quoteCount > 0) || memory.rfqs[0];
        if (body.rfqId && !targetRfq) {
          return c.json({ error: 'Specified RFQ not found in workspace.' }, 404);
        }
        const dbQuotes = targetRfq
          ? await db
              .select()
              .from(schema.quotes)
              .where(
                and(
                  eq(schema.quotes.workspaceId, ctx.workspaceId),
                  eq(schema.quotes.rfqId, targetRfq.id)
                )
              )
          : [];
        const supById = new Map(memory.suppliers.map((s) => [s.id, s]));
        const mappedQuotes =
          dbQuotes.length > 0
            ? dbQuotes.map((q) => {
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
              })
            : [
                {
                  quoteId: 'sim-qt-1',
                  supplierId: 'sim-sup-1',
                  supplierName: 'Bharat Packaging (Simulation Baseline)',
                  supplierPhone: null,
                  supplierEmail: null,
                  baseUnitPaise: 2200,
                  netLandedUnitPaise: 2300,
                  creditAdjustedUnitPaise: 2272,
                  creditDays: 30,
                  leadTimeDays: 5,
                  reliabilityScore: 92,
                  quantity: 5000,
                  unit: 'pc',
                },
                {
                  quoteId: 'sim-qt-2',
                  supplierId: 'sim-sup-2',
                  supplierName: 'Shakti Packaging (Simulation Challenger)',
                  supplierPhone: null,
                  supplierEmail: null,
                  baseUnitPaise: 2286,
                  netLandedUnitPaise: 2286,
                  creditAdjustedUnitPaise: 2286,
                  creditDays: 0,
                  leadTimeDays: 3,
                  reliabilityScore: 86,
                  quantity: 5000,
                  unit: 'pc',
                },
              ];
        report = await runNegotiationAgent({
          rfqTitle: targetRfq?.title || body.promptText || '5,000 5-Ply Corrugated Boxes (BATNA Simulation)',
          preferredLanguage: body.preferredLanguage,
          urgencyDays: body.urgencyDays,
          memory,
          config,
          quotes: mappedQuotes,
        });
        break;
      }
      case 'auditor': {
        const targetInv = body.invoiceId
          ? memory.invoices.find((i) => i.id === body.invoiceId)
          : memory.invoices[0];
        if (body.invoiceId && !targetInv) {
          return c.json({ error: 'Specified invoice not found in workspace.' }, 404);
        }
        if (!targetInv) {
          report = await runAuditorAgent({
            auditInput: {
              invoiceNumber: 'SIM-INV-412',
              invoiceDate: new Date().toISOString().slice(0, 10),
              supplier: {
                id: 'sim-sup',
                name: 'Shakti Packaging (Forensic Diagnostic Preview)',
                stateCode: memory.workspace.stateCode,
                gstRegime: 'regular',
                udyamTier: 'micro',
                eInvoiceRequired: true,
                reliabilityScore: 85,
              },
              items: [
                {
                  itemKey: '5-ply-corrugated-box',
                  description: '5-Ply Corrugated Boxes (HSN 4819)',
                  hsnSac: '4819',
                  qty: 5000,
                  unit: 'pc',
                  unitRateRupees: 26.5,
                  gstPct: 5,
                },
              ],
              freightRupees: 5000,
              freightGstPct: 18,
              freightGstMode: 'gta_fcm_18',
              freightAlreadyTaxInclusive: true,
              statedTaxableRupees: 137500,
              statedCgstRupees: 3762.5,
              statedSgstRupees: 3762.5,
              statedIgstRupees: 0,
              statedGrandTotalRupees: 145025,
            },
            liveGstn: null,
            memory,
            config,
          });
          break;
        }
        const [fullInv] = await db
          .select()
          .from(schema.invoices)
          .where(and(eq(schema.invoices.id, targetInv.id), eq(schema.invoices.workspaceId, ctx.workspaceId)))
          .limit(1);
        const sup = memory.suppliers.find((s) => s.id === targetInv.supplierId);
        let liveGstn = null;
        if (fullInv?.supplierGstin || sup?.gstin) {
          const cached = await lookupOrVerifyGstin({
            db,
            workspaceId: ctx.workspaceId,
            rawGstin: (fullInv?.supplierGstin || sup?.gstin)!,
            helpers,
          });
          liveGstn = cached.result;
        }
        const rawItems = Array.isArray(fullInv?.itemsJson)
          ? (fullInv.itemsJson as Array<{
              itemKey?: string;
              description?: string;
              hsnSac?: string | null;
              qty?: number;
              unit?: string;
              unitRateRupees?: number;
              gstPct?: number;
            }>)
          : [];
        report = await runAuditorAgent({
          auditInput: {
            invoiceNumber: targetInv.invoiceNumber,
            invoiceDate: targetInv.invoiceDate,
            supplier: {
              id: targetInv.supplierId,
              name: sup?.name || 'Supplier',
              gstin: sup?.gstin,
              stateCode: sup?.stateCode,
              gstRegime: (sup?.gstRegime as GstRegime) || 'regular',
              udyamTier: (sup?.udyamTier as UdyamTier) || 'unknown',
              eInvoiceRequired: sup?.eInvoiceRequired ?? false,
              reliabilityScore: sup?.reliabilityScore ?? 85,
            },
            supplierGstinOnBill: fullInv?.supplierGstin,
            irn: fullInv?.irn,
            items:
              rawItems.length > 0
                ? rawItems.map((it, idx) => ({
                    itemKey: it.itemKey || `item-${idx}`,
                    description: it.description || 'Item',
                    hsnSac: it.hsnSac,
                    qty: it.qty ?? 1,
                    unit: it.unit || 'pc',
                    unitRateRupees: it.unitRateRupees ?? targetInv.taxablePaise / 100,
                    gstPct: it.gstPct ?? 18,
                  }))
                : [
                    {
                      itemKey: 'bill-total',
                      description: 'Invoice Goods',
                      qty: 1,
                      unit: 'lot',
                      unitRateRupees: targetInv.taxablePaise / 100,
                      gstPct: 18,
                    },
                  ],
            statedTaxableRupees: targetInv.taxablePaise / 100,
            statedCgstRupees: (fullInv?.cgstPaise ?? 0) / 100,
            statedSgstRupees: (fullInv?.sgstPaise ?? 0) / 100,
            statedIgstRupees: (fullInv?.igstPaise ?? 0) / 100,
            statedGrandTotalRupees: targetInv.grandTotalPaise / 100,
          },
          liveGstn,
          memory,
          config,
        });
        break;
      }
      case 'compliance': {
        const chainCheck = await verifyWorkspaceAuditChain(db, ctx.workspaceId);
        report = await runComplianceTaxShieldAgent({
          memory,
          auditChainValid: chainCheck.valid,
          config,
        });
        break;
      }
      case 'operations': {
        report = await runAutonomousOperationsAgent({
          memory,
          config,
        });
        break;
      }
      default:
        return c.json({ error: `Unknown specialist agentId: ${String(body.agentId)}` }, 400);
    }

    const runId = await persistAgentRun(db, ctx.workspaceId, report, 'agent_api', Date.now() - start);
    return c.json({ runId, report });
  });

  // 4b. Conversational CFO Question & Cross-Question Engine (All PnC & Multi-Turn Follow-Ups)
  app.post('/api/agents/ask', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      question: string;
      conversationHistory?: QaConversationTurn[];
      rfqId?: string;
      skipNetwork?: boolean;
    }>();

    if (!body.question?.trim()) {
      return c.json({ error: 'Please provide a question or cross-question.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const memory = await loadWorkspaceLiveMemory(db, ctx.workspaceId);
    if (!memory) return c.json({ error: 'Workspace not found.' }, 404);

    const targetRfq = body.rfqId
      ? memory.rfqs.find((r) => r.id === body.rfqId)
      : memory.rfqs.find((r) => r.quoteCount > 0) || memory.rfqs[0];

    let liveQuotes: QuoteCostInput[] = [];
    if (targetRfq) {
      const dbQuotes = await db
        .select()
        .from(schema.quotes)
        .where(
          and(
            eq(schema.quotes.workspaceId, ctx.workspaceId),
            eq(schema.quotes.rfqId, targetRfq.id)
          )
        );
      const supById = new Map(memory.suppliers.map((s) => [s.id, s]));
      liveQuotes = dbQuotes.map((q) => {
        const sup = supById.get(q.supplierId);
        return {
          quoteId: q.id,
          supplier: {
            id: q.supplierId,
            name: sup?.name || 'Supplier',
            gstin: sup?.gstin,
            stateCode: sup?.stateCode || memory.workspace.stateCode,
            gstRegime: (sup?.gstRegime as GstRegime) || 'regular',
            udyamTier: (sup?.udyamTier as UdyamTier) || 'unknown',
            eInvoiceRequired: sup?.eInvoiceRequired ?? false,
            reliabilityScore: sup?.reliabilityScore ?? 85,
          },
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
    }

    const start = Date.now();
    const config = buildAgentRuntimeConfig(helpers.getEnv, Boolean(body.skipNetwork));
    const report = await runCfoQuestionAnsweringAgent({
      question: body.question.trim(),
      conversationHistory: body.conversationHistory,
      liveQuotes,
      memory,
      config,
    });

    const runId = await persistAgentRun(db, ctx.workspaceId, report, 'cfo_qa', Date.now() - start);
    return c.json({
      runId,
      qa: report.structuredData,
      report,
    });
  });

  // 5. Internal Morning Cron Endpoint (for Node.js / External Cron / Manual Trigger with Secret)
  app.post('/api/internal/cron/morning-sweep', async (c) => {
    const expectedSecret =
      helpers.getEnv('CRON_SECRET') || helpers.getEnv('INBOUND_WEBHOOK_SECRET');
    const provided = c.req.header('x-kraya-cron-secret') || c.req.header('x-kraya-webhook-secret');
    if (!expectedSecret || provided !== expectedSecret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-cron-secret required.' }, 401);
    }

    const result = await runAutonomousSweepAllWorkspaces({
      DATABASE_URL: helpers.getEnv('DATABASE_URL'),
      GEMINI_API_KEY: helpers.getEnv('GEMINI_API_KEY'),
      GEMINI_MODEL: helpers.getEnv('GEMINI_MODEL'),
    });
    return c.json(result);
  });
}
