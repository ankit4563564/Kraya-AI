import type { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import {
  addCalendarDays,
  computeGstLine,
  computeLandedCost,
  formatINR,
  FreightGstMode,
  GstRegime,
  QuoteCostInput,
  SupplierTaxProfile,
  toPaise,
  TurnoverBand,
  UdyamTier,
  validateGstin,
  WorkspaceTaxProfile,
} from '@kraya/finance-engine';
import {
  analyzeContractIntelligence,
  ApprovedCatalogSupplier,
  assessSupplierRiskAndQueryAlternatives,
  buildRazorpayXPayoutDraft,
  computeSupplierPerformanceFeedback,
  evaluateGovernanceBestPractices,
  evaluateRequisitionAndBudget,
  evaluateSupplierOnboardingGate,
  generateDynamicSourcingProposal,
  generateTallyPurchaseXml,
  normalizeWorkspaceAutonomyConfig,
  pushBillToZohoBooks,
  pushPoToEnterpriseP2P,
  pushVoucherToTallyPrime,
  queryApprovedAlternativeSuppliers,
  verifyIndianIfscLive,
  verifySupplierGlobalRegistry,
  verifyUdyamLive,
} from '@kraya/agent-core';
import { getDb } from './db/client.js';
import * as schema from './db/schema.js';
import {
  AppHelpers,
  AppVariables,
  recordAuditLog,
  todayIso,
  uid,
  verifyWorkspaceAuditChain,
} from './context.js';
import { emitWorkspaceAutomationEvent } from './routes-connectors.js';

function toBuyerProfile(ws: typeof schema.workspaces.$inferSelect): WorkspaceTaxProfile {
  return {
    legalName: ws.legalName,
    gstin: ws.gstin,
    stateCode: ws.stateCode,
    gstRegime: ws.gstRegime as GstRegime,
    waccPct: ws.waccPct,
    turnoverBand: ws.turnoverBand as TurnoverBand,
  };
}

function toCatalogSupplier(s: typeof schema.suppliers.$inferSelect): ApprovedCatalogSupplier {
  return {
    id: s.id,
    name: s.name,
    category: s.category || 'General',
    gstin: s.gstin,
    stateCode: s.stateCode,
    gstRegime: s.gstRegime,
    udyamTier: s.udyamTier,
    creditDays: s.creditDays,
    reliabilityScore: s.reliabilityScore,
    financialHealthScore: s.financialHealthScore ?? 80,
    esgScore: s.esgScore ?? 75,
    onboardingStatus: s.onboardingStatus || 'approved',
    riskStatus: s.riskStatus || 'normal',
  };
}

export function registerEnterpriseRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // =========================================================================
  // 0. UNIFIED ENTERPRISE LIFECYCLE & GOVERNANCE OVERVIEW
  // =========================================================================
  app.get('/api/enterprise/overview', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));

    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: 'Workspace not found.' }, 404);

    const [
      suppliersList,
      riskEventsList,
      contractsList,
      budgetsList,
      requisitionsList,
      perfLogsList,
      priceHistoryList,
      agentRunsList,
      auditVerification,
    ] = await Promise.all([
      db
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.suppliers.createdAt)),
      db
        .select()
        .from(schema.supplierRiskEvents)
        .where(eq(schema.supplierRiskEvents.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.supplierRiskEvents.createdAt))
        .limit(30),
      db
        .select()
        .from(schema.supplierContracts)
        .where(eq(schema.supplierContracts.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.supplierContracts.createdAt))
        .limit(30),
      db
        .select()
        .from(schema.procurementBudgets)
        .where(eq(schema.procurementBudgets.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.procurementBudgets.createdAt)),
      db
        .select()
        .from(schema.purchaseRequisitions)
        .where(eq(schema.purchaseRequisitions.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.purchaseRequisitions.createdAt))
        .limit(30),
      db
        .select()
        .from(schema.supplierPerformanceLogs)
        .where(eq(schema.supplierPerformanceLogs.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.supplierPerformanceLogs.recordedAt))
        .limit(40),
      db
        .select({ id: schema.priceHistory.id })
        .from(schema.priceHistory)
        .where(eq(schema.priceHistory.workspaceId, ctx.workspaceId)),
      db
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.workspaceId, ctx.workspaceId)),
      verifyWorkspaceAuditChain(db, ctx.workspaceId),
    ]);

    const autonomyConfig = normalizeWorkspaceAutonomyConfig(
      (ws.autonomyConfigJson as Record<string, unknown>) || {}
    );
    const verifiedGstinSuppliers = suppliersList.filter(
      (s) => s.gstRegime === 'unregistered' || (s.gstin && validateGstin(s.gstin).valid)
    ).length;

    const governanceReport = evaluateGovernanceBestPractices({
      totalSuppliers: suppliersList.length,
      verifiedGstinSuppliers,
      priceHistoryCount: priceHistoryList.length,
      performanceLogsCount: perfLogsList.length,
      activeBudgetsCount: budgetsList.length,
      customPolicyConfigured: Boolean(ws.policyPatchMd?.trim()),
      auditChainIntact: auditVerification.valid,
      agentRunsCount: agentRunsList.length,
      autonomyConfig,
    });

    return c.json({
      workspaceId: ctx.workspaceId,
      autonomyConfig,
      governanceReport,
      suppliers: suppliersList,
      riskEvents: riskEventsList,
      contracts: contractsList,
      budgets: budgetsList,
      requisitions: requisitionsList,
      performanceLogs: perfLogsList,
    });
  });

  // =========================================================================
  // 1. SUPPLIER ONBOARDING COMPLIANCE GATE & LIFECYCLE ROUTING
  // =========================================================================
  app.post('/api/enterprise/suppliers/:id/onboarding-evaluate', async (c) => {
    const ctx = c.get('auth');
    const supplierId = c.req.param('id');
    const body = await c.req.json<{
      financialHealthScore?: number;
      esgScore?: number;
      dunsNumber?: string;
      ifscCode?: string;
      onboardingStatusOverride?: string;
    }>().catch(() => ({} as Record<string, undefined>));

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [sup] = await db
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, supplierId), eq(schema.suppliers.workspaceId, ctx.workspaceId)))
      .limit(1);

    if (!sup) return c.json({ error: 'Supplier not found in this workspace.' }, 404);

    const nextFinScore =
      typeof body.financialHealthScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(body.financialHealthScore)))
        : sup.financialHealthScore ?? 80;
    const nextEsgScore =
      typeof body.esgScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(body.esgScore)))
        : sup.esgScore ?? 75;
    const nextDuns = body.dunsNumber?.trim() || sup.dunsNumber || null;

    const evaluation = evaluateSupplierOnboardingGate({
      supplierId: sup.id,
      name: sup.name,
      gstin: sup.gstin,
      gstRegime: sup.gstRegime,
      udyamNumber: sup.udyamNumber,
      udyamTier: sup.udyamTier,
      phone: sup.phone,
      email: sup.email,
      ifscCode: body.ifscCode,
      dunsNumber: nextDuns,
      financialHealthScore: nextFinScore,
      esgScore: nextEsgScore,
      currentStatus: sup.onboardingStatus,
    });

    const finalStatus = body.onboardingStatusOverride?.trim() || evaluation.recommendedStatus;

    const [updatedSupplier] = await db
      .update(schema.suppliers)
      .set({
        onboardingStatus: finalStatus,
        financialHealthScore: nextFinScore,
        esgScore: nextEsgScore,
        dunsNumber: nextDuns,
      })
      .where(and(eq(schema.suppliers.id, sup.id), eq(schema.suppliers.workspaceId, ctx.workspaceId)))
      .returning();

    await recordAuditLog(db, ctx, 'supplier_onboarding_evaluated', 'supplier', sup.id, {
      supplierName: sup.name,
      readinessScorePct: evaluation.readinessScorePct,
      onboardingStatus: finalStatus,
      financialHealthScore: nextFinScore,
      esgScore: nextEsgScore,
    });

    return c.json({
      supplier: updatedSupplier,
      evaluation,
    });
  });

  // =========================================================================
  // 2. CONTINUOUS SUPPLIER RISK WATCH (D&B / REGIONAL DISRUPTION) &
  //    APPROVED CATALOG ALTERNATIVE QUERY (SAP ARIBA / INTERNAL)
  // =========================================================================
  app.post('/api/enterprise/risk/monitor', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      supplierId: string;
      sourceProvider?: 'dnb_risk_feed' | 'sap_ariba_risk' | 'gstn_watchdog' | 'regional_disruption_feed';
      eventType?:
        | 'financial_health_drop'
        | 'regional_disruption'
        | 'gstn_cancelled_or_suspended'
        | 'esg_compliance_breach'
        | 'chronic_delivery_failure';
      newFinancialHealthScore?: number;
      newEsgScore?: number;
      regionOrCategory?: string;
      disruptionNote?: string;
      prioritizeBy?: 'balanced' | 'lead_time' | 'compliance_reliability' | 'esg' | 'lowest_cost';
      maxLeadTimeDays?: number;
      minEsgScore?: number;
      autoCreateFallbackRfq?: boolean;
      componentTitle?: string;
      qty?: number;
      unit?: string;
    }>();

    if (!body.supplierId) {
      return c.json({ error: 'supplierId is required to evaluate risk signal.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    const allSuppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, ctx.workspaceId));

    const targetSup = allSuppliers.find((s) => s.id === body.supplierId);
    if (!targetSup) return c.json({ error: 'Supplier not found in workspace.' }, 404);

    const catalog = allSuppliers.map(toCatalogSupplier);
    const assessment = assessSupplierRiskAndQueryAlternatives({
      supplier: toCatalogSupplier(targetSup),
      sourceProvider: body.sourceProvider || 'dnb_risk_feed',
      eventType: body.eventType || 'financial_health_drop',
      newFinancialHealthScore: body.newFinancialHealthScore,
      newEsgScore: body.newEsgScore,
      regionOrCategory: body.regionOrCategory || targetSup.category || 'Electronics',
      disruptionNote: body.disruptionNote,
      catalogSuppliers: catalog,
      filterCriteria: {
        category: body.regionOrCategory || targetSup.category || 'General',
        buyerStateCode: ws?.stateCode || '29',
        maxLeadTimeDays: body.maxLeadTimeDays ?? 14,
        minEsgScore: body.minEsgScore ?? 60,
        prioritizeBy: body.prioritizeBy ?? 'balanced',
      },
    });

    // Update disrupted supplier's financial score and risk status
    await db
      .update(schema.suppliers)
      .set({
        financialHealthScore: assessment.newFinancialScore,
        ...(typeof body.newEsgScore === 'number' ? { esgScore: body.newEsgScore } : {}),
        riskStatus: assessment.newRiskStatus,
        lastRiskAssessedAt: new Date(),
      })
      .where(and(eq(schema.suppliers.id, targetSup.id), eq(schema.suppliers.workspaceId, ctx.workspaceId)));

    // Auto-create dynamic fallback RFQ if requested and risk is high/critical
    let triggeredRfq: typeof schema.rfqs.$inferSelect | null = null;
    if (body.autoCreateFallbackRfq && assessment.autoTriggerDynamicSourcing) {
      const existingRfqs = await db
        .select({ id: schema.rfqs.id })
        .from(schema.rfqs)
        .where(eq(schema.rfqs.workspaceId, ctx.workspaceId));
      const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(existingRfqs.length + 1).padStart(3, '0')}`;
      const title =
        body.componentTitle?.trim() ||
        `Fallback Sourcing: ${targetSup.category || 'Critical Components'} (Replacing ${targetSup.name})`;

      const [createdRfq] = await db
        .insert(schema.rfqs)
        .values({
          id: uid('rfq'),
          workspaceId: ctx.workspaceId,
          rfqNumber,
          title,
          type: 'risk_fallback',
          itemsJson: [
            {
              itemKey: title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32),
              description: title,
              hsnSac: '8542',
              qty: body.qty && body.qty > 0 ? body.qty : 500,
              unit: body.unit || 'pc',
            },
          ],
          deliveryDueAt: addCalendarDays(todayIso(), 7),
          status: 'open',
        })
        .returning();
      triggeredRfq = createdRfq;
    }

    const [riskEvent] = await db
      .insert(schema.supplierRiskEvents)
      .values({
        id: uid('risk'),
        workspaceId: ctx.workspaceId,
        supplierId: targetSup.id,
        sourceProvider: assessment.sourceProvider,
        eventType: assessment.eventType,
        severity: assessment.severity,
        previousFinancialScore: assessment.previousFinancialScore,
        newFinancialScore: assessment.newFinancialScore,
        regionOrCategory: body.regionOrCategory || targetSup.category || 'General',
        summary: assessment.alertSummary,
        recommendedAlternativesJson: assessment.alternativeSuppliers,
        triggeredRfqId: triggeredRfq?.id || null,
        status: 'open',
      })
      .returning();

    await recordAuditLog(db, ctx, 'supplier_risk_alert_triggered', 'supplier_risk_event', riskEvent.id, {
      supplierId: targetSup.id,
      supplierName: targetSup.name,
      previousFinancialScore: assessment.previousFinancialScore,
      newFinancialScore: assessment.newFinancialScore,
      severity: assessment.severity,
      alternativesFound: assessment.alternativeSuppliers.length,
      triggeredRfqId: triggeredRfq?.id || null,
    });

    await emitWorkspaceAutomationEvent({
      db,
      workspaceId: ctx.workspaceId,
      eventType: 'agent.critical_escalation',
      payload: {
        headline: assessment.alertHeadline,
        cfoVerdict: assessment.alertSummary,
        disruptedSupplier: targetSup.name,
        alternativesShortlisted: assessment.alternativeSuppliers.map((a) => a.name),
        triggeredRfqNumber: triggeredRfq?.rfqNumber || null,
      },
      helpers,
    });

    return c.json({
      riskEvent,
      assessment,
      triggeredRfq,
    });
  });

  // Query approved alternative suppliers directly (SAP Ariba / Internal Catalog filter)
  app.get('/api/enterprise/catalog/alternatives', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    const allSuppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, ctx.workspaceId));

    const ranked = queryApprovedAlternativeSuppliers(allSuppliers.map(toCatalogSupplier), {
      category: c.req.query('category') || 'General',
      excludeSupplierId: c.req.query('excludeSupplierId') || undefined,
      buyerStateCode: ws?.stateCode || '29',
      maxLeadTimeDays: c.req.query('maxLeadTimeDays') ? Number(c.req.query('maxLeadTimeDays')) : 21,
      minReliabilityScore: c.req.query('minReliabilityScore')
        ? Number(c.req.query('minReliabilityScore'))
        : 65,
      minEsgScore: c.req.query('minEsgScore') ? Number(c.req.query('minEsgScore')) : 55,
      minFinancialHealthScore: c.req.query('minFinancialHealthScore')
        ? Number(c.req.query('minFinancialHealthScore'))
        : 55,
      prioritizeBy:
        (c.req.query('prioritizeBy') as
          | 'balanced'
          | 'lead_time'
          | 'compliance_reliability'
          | 'esg'
          | 'lowest_cost') || 'balanced',
    });

    return c.json({ alternatives: ranked });
  });

  // =========================================================================
  // 3. DYNAMIC SOURCING PROPOSAL GENERATOR
  // =========================================================================
  app.post('/api/enterprise/sourcing/proposal', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{ rfqId: string; riskTriggerSummary?: string }>();
    if (!body.rfqId) return c.json({ error: 'rfqId is required.' }, 400);

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: 'Workspace not found.' }, 404);

    const [rfq] = await db
      .select()
      .from(schema.rfqs)
      .where(and(eq(schema.rfqs.id, body.rfqId), eq(schema.rfqs.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!rfq) return c.json({ error: 'RFQ not found in workspace.' }, 404);

    const rfqQuotes = await db
      .select()
      .from(schema.quotes)
      .where(and(eq(schema.quotes.rfqId, rfq.id), eq(schema.quotes.workspaceId, ctx.workspaceId)));
    const allSuppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, ctx.workspaceId));
    const supById = new Map(allSuppliers.map((s) => [s.id, s]));

    const supplierProfiles = new Map<
      string,
      { financialHealthScore?: number; esgScore?: number; leadTimeDays?: number }
    >();
    const quoteInputs: QuoteCostInput[] = rfqQuotes.map((q) => {
      const sup = supById.get(q.supplierId);
      supplierProfiles.set(q.supplierId, {
        financialHealthScore: sup?.financialHealthScore ?? 80,
        esgScore: sup?.esgScore ?? 75,
        leadTimeDays: q.leadTimeDays ?? undefined,
      });
      const supProfile: SupplierTaxProfile = {
        id: q.supplierId,
        name: sup?.name || 'Supplier',
        gstin: sup?.gstin || null,
        stateCode: sup?.stateCode || ws.stateCode,
        gstRegime: (sup?.gstRegime as GstRegime) || 'regular',
        udyamTier: (sup?.udyamTier as UdyamTier) || 'unknown',
        eInvoiceRequired: sup?.eInvoiceRequired ?? false,
        reliabilityScore: sup?.reliabilityScore ?? 85,
      };
      return {
        quoteId: q.id,
        supplier: supProfile,
        hsnOrItemText: rfq.title,
        quantity: q.quantity,
        rawRateRupees: q.rawRateRupees,
        rawUnit: q.rawUnit,
        gstPct: q.gstPct,
        isGstInclusive: q.isGstInclusive,
        freightTotalRupees: q.freightPaise / 100,
        freightGstMode: q.freightGstMode as FreightGstMode,
        creditDays: q.creditDays,
        leadTimeDays: q.leadTimeDays ?? undefined,
      };
    });

    const proposal = generateDynamicSourcingProposal({
      rfqNumber: rfq.rfqNumber,
      rfqTitle: rfq.title,
      buyer: toBuyerProfile(ws),
      quotes: quoteInputs,
      supplierProfiles,
      riskTriggerSummary: body.riskTriggerSummary || null,
    });

    return c.json({ proposal });
  });

  // =========================================================================
  // 4. CONTRACT INTELLIGENCE & NLP CLAUSE REDLINING
  // =========================================================================
  app.get('/api/enterprise/contracts', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const contracts = await db
      .select()
      .from(schema.supplierContracts)
      .where(eq(schema.supplierContracts.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.supplierContracts.createdAt));
    return c.json({ contracts });
  });

  app.post('/api/enterprise/contracts/analyze', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      supplierId: string;
      rfqId?: string;
      poId?: string;
      contractNumber?: string;
      title: string;
      contractType?: 'msa' | 'rate_contract' | 'sla' | 'nda' | 'po_terms';
      effectiveFrom?: string;
      expiresAt?: string;
      autoRenew?: boolean;
      noticePeriodDays?: number;
      contractValueRupees?: number;
      rawContractText: string;
      skipNetwork?: boolean;
    }>();

    if (!body.supplierId || !body.title?.trim() || !body.rawContractText?.trim()) {
      return c.json({ error: 'supplierId, title, and rawContractText are required.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    const [sup] = await db
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, body.supplierId), eq(schema.suppliers.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!sup) return c.json({ error: 'Supplier not found in workspace.' }, 404);

    const existingContracts = await db
      .select({ id: schema.supplierContracts.id })
      .from(schema.supplierContracts)
      .where(eq(schema.supplierContracts.workspaceId, ctx.workspaceId));

    const contractNumber =
      body.contractNumber?.trim() ||
      `CNT-${new Date().getFullYear()}-${String(existingContracts.length + 1).padStart(3, '0')}`;
    const effectiveFrom = body.effectiveFrom || todayIso();
    const expiresAt = body.expiresAt || addCalendarDays(effectiveFrom, 365);

    const report = await analyzeContractIntelligence({
      contractNumber,
      title: body.title.trim(),
      supplierName: sup.name,
      supplierUdyamTier: sup.udyamTier,
      supplierGstRegime: sup.gstRegime,
      rawContractText: body.rawContractText,
      effectiveFrom,
      expiresAt,
      noticePeriodDays: body.noticePeriodDays ?? 30,
      autoRenew: Boolean(body.autoRenew),
      workspacePolicyPatchMd: ws?.policyPatchMd || null,
      geminiApiKey: helpers.getEnv('GEMINI_API_KEY'),
      geminiModel: helpers.getEnv('GEMINI_MODEL'),
      skipNetwork: body.skipNetwork ?? true,
    });

    const contractStatus =
      report.approvalVerdict === 'APPROVE_AS_IS'
        ? 'active'
        : report.isExpiringSoon
          ? 'expiring_soon'
          : 'under_review';

    const [createdContract] = await db
      .insert(schema.supplierContracts)
      .values({
        id: uid('cnt'),
        workspaceId: ctx.workspaceId,
        supplierId: sup.id,
        rfqId: body.rfqId || null,
        poId: body.poId || null,
        contractNumber,
        title: body.title.trim(),
        contractType: body.contractType || 'msa',
        status: contractStatus,
        effectiveFrom,
        expiresAt,
        autoRenew: Boolean(body.autoRenew),
        noticePeriodDays: body.noticePeriodDays ?? 30,
        contractValuePaise: toPaise(body.contractValueRupees || 0),
        rawContractText: body.rawContractText,
        clauseRisksJson: report.clauseRisks,
        policyRedlinesJson: report.policyRedlines,
        complianceScore: report.complianceScore,
        approvedBy: contractStatus === 'active' ? ctx.email : null,
        approvedAt: contractStatus === 'active' ? new Date() : null,
      })
      .returning();

    await recordAuditLog(db, ctx, 'contract_intelligence_analyzed', 'supplier_contract', createdContract.id, {
      contractNumber,
      supplierName: sup.name,
      complianceScore: report.complianceScore,
      clauseRisksCount: report.clauseRisks.length,
      policyRedlinesCount: report.policyRedlines.length,
      approvalVerdict: report.approvalVerdict,
    });

    return c.json({
      contract: createdContract,
      report,
    }, 201);
  });

  app.post('/api/enterprise/contracts/:id/approve', async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    const body = await c.req.json<{ applySuggestedRedlines?: boolean }>().catch(() => ({
      applySuggestedRedlines: true,
    }));

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [cnt] = await db
      .select()
      .from(schema.supplierContracts)
      .where(and(eq(schema.supplierContracts.id, id), eq(schema.supplierContracts.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!cnt) return c.json({ error: 'Contract not found.' }, 404);

    let nextText = cnt.rawContractText;
    if (body.applySuggestedRedlines && Array.isArray(cnt.policyRedlinesJson) && cnt.policyRedlinesJson.length > 0) {
      const redlineAddendum = (cnt.policyRedlinesJson as Array<{ title: string; suggestedClauseText: string }>)
        .map((r, idx) => `\n[POLICY REDLINE ADDENDUM #${idx + 1} — ${r.title}]:\n${r.suggestedClauseText}`)
        .join('\n');
      nextText = `${cnt.rawContractText}\n\n--- INCORPORATION OF APPROVED KRAYA POLICY & STATUTORY REDLINES ---${redlineAddendum}`;
    }

    const [updated] = await db
      .update(schema.supplierContracts)
      .set({
        status: 'active',
        rawContractText: nextText,
        complianceScore: 100,
        approvedBy: ctx.email,
        approvedAt: new Date(),
      })
      .where(and(eq(schema.supplierContracts.id, cnt.id), eq(schema.supplierContracts.workspaceId, ctx.workspaceId)))
      .returning();

    await recordAuditLog(db, ctx, 'contract_approved', 'supplier_contract', cnt.id, {
      contractNumber: cnt.contractNumber,
      applySuggestedRedlines: Boolean(body.applySuggestedRedlines),
    });

    return c.json({ contract: updated });
  });

  // =========================================================================
  // 5. COST-CENTER BUDGETS & MULTI-TIER PURCHASE REQUISITIONS (PR-TO-PO)
  // =========================================================================
  app.get('/api/enterprise/budgets', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const budgets = await db
      .select()
      .from(schema.procurementBudgets)
      .where(eq(schema.procurementBudgets.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.procurementBudgets.createdAt));
    return c.json({ budgets });
  });

  app.post('/api/enterprise/budgets', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      department: string;
      category: string;
      periodKey?: string;
      allocatedRupees: number;
      hardStop?: boolean;
      alertThresholdPct?: number;
    }>();

    if (!body.department?.trim() || !body.category?.trim() || !(body.allocatedRupees > 0)) {
      return c.json({ error: 'department, category, and allocatedRupees (> 0) are required.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const periodKey = body.periodKey?.trim() || 'FY2026-27';
    const allocatedPaise = toPaise(body.allocatedRupees);

    const existing = await db
      .select()
      .from(schema.procurementBudgets)
      .where(
        and(
          eq(schema.procurementBudgets.workspaceId, ctx.workspaceId),
          eq(schema.procurementBudgets.department, body.department.trim()),
          eq(schema.procurementBudgets.category, body.category.trim()),
          eq(schema.procurementBudgets.periodKey, periodKey)
        )
      )
      .limit(1);

    if (existing[0]) {
      const [updated] = await db
        .update(schema.procurementBudgets)
        .set({
          allocatedPaise,
          hardStop: body.hardStop ?? existing[0].hardStop,
          alertThresholdPct: body.alertThresholdPct ?? existing[0].alertThresholdPct,
          updatedAt: new Date(),
        })
        .where(eq(schema.procurementBudgets.id, existing[0].id))
        .returning();
      return c.json({ budget: updated });
    }

    const [created] = await db
      .insert(schema.procurementBudgets)
      .values({
        id: uid('bdg'),
        workspaceId: ctx.workspaceId,
        department: body.department.trim(),
        category: body.category.trim(),
        periodKey,
        allocatedPaise,
        committedPaise: 0,
        spentPaise: 0,
        hardStop: body.hardStop ?? true,
        alertThresholdPct: body.alertThresholdPct ?? 80,
      })
      .returning();

    await recordAuditLog(db, ctx, 'budget_configured', 'procurement_budget', created.id, {
      department: created.department,
      category: created.category,
      periodKey: created.periodKey,
      allocatedPaise: created.allocatedPaise,
    });

    return c.json({ budget: created }, 201);
  });

  app.get('/api/enterprise/requisitions', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const requisitions = await db
      .select()
      .from(schema.purchaseRequisitions)
      .where(eq(schema.purchaseRequisitions.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.purchaseRequisitions.createdAt));
    return c.json({ requisitions });
  });

  app.post('/api/enterprise/requisitions', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      title: string;
      department?: string;
      category?: string;
      estimatedTotalRupees: number;
      justification?: string;
      urgency?: 'standard' | 'urgent' | 'emergency';
      items?: Array<{ description: string; qty: number; unit: string; estimatedUnitRateRupees: number }>;
    }>();

    if (!body.title?.trim() || !(body.estimatedTotalRupees > 0)) {
      return c.json({ error: 'title and estimatedTotalRupees (> 0) are required.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    const autonomy = normalizeWorkspaceAutonomyConfig(
      (ws?.autonomyConfigJson as Record<string, unknown>) || {}
    );

    const department = body.department?.trim() || 'Operations';
    const category = body.category?.trim() || 'General';
    const estimatedTotalPaise = toPaise(body.estimatedTotalRupees);

    // Find matching budget by department + category (or department fallback)
    const budgets = await db
      .select()
      .from(schema.procurementBudgets)
      .where(eq(schema.procurementBudgets.workspaceId, ctx.workspaceId));
    const matchedBudget =
      budgets.find(
        (b) =>
          b.department.toLowerCase() === department.toLowerCase() &&
          b.category.toLowerCase() === category.toLowerCase()
      ) ||
      budgets.find((b) => b.department.toLowerCase() === department.toLowerCase()) ||
      budgets[0] ||
      null;

    const existingPrs = await db
      .select({ id: schema.purchaseRequisitions.id })
      .from(schema.purchaseRequisitions)
      .where(eq(schema.purchaseRequisitions.workspaceId, ctx.workspaceId));
    const prNumber = `PR-${new Date().getFullYear()}-${String(existingPrs.length + 1).padStart(3, '0')}`;

    const evaluation = evaluateRequisitionAndBudget({
      prNumber,
      title: body.title.trim(),
      department,
      category,
      requestedBy: ctx.email,
      estimatedTotalPaise,
      justification: body.justification,
      urgency: body.urgency || 'standard',
      budget: matchedBudget,
      autoApproveLimitPaise:
        autonomy.workflows.pr_budget_routing === 'autonomous_under_limit'
          ? autonomy.autoApprovePoLimitPaise
          : 0,
      tier1LimitPaise: autonomy.tier1ManagerLimitPaise,
      tier2LimitPaise: autonomy.tier2FinanceLimitPaise,
    });

    const [createdPr] = await db
      .insert(schema.purchaseRequisitions)
      .values({
        id: uid('pr'),
        workspaceId: ctx.workspaceId,
        prNumber,
        title: body.title.trim(),
        department,
        category,
        requestedBy: ctx.email,
        budgetId: matchedBudget?.id || null,
        estimatedTotalPaise,
        itemsJson: body.items || [
          {
            description: body.title.trim(),
            qty: 1,
            unit: 'lot',
            estimatedUnitRateRupees: body.estimatedTotalRupees,
          },
        ],
        justification: body.justification || null,
        urgency: body.urgency || 'standard',
        approvalTierRequired: evaluation.approvalTierRequired,
        budgetCheckStatus: evaluation.budgetCheckStatus,
        policyViolationsJson: evaluation.policyViolations,
        status: evaluation.recommendedStatus,
        approvedBy: evaluation.canAutoApprove ? 'Kraya Autonomous Budget Engine' : null,
        approvedAt: evaluation.canAutoApprove ? new Date() : null,
      })
      .returning();

    if (evaluation.canAutoApprove && matchedBudget) {
      await db
        .update(schema.procurementBudgets)
        .set({
          committedPaise: matchedBudget.committedPaise + estimatedTotalPaise,
          updatedAt: new Date(),
        })
        .where(eq(schema.procurementBudgets.id, matchedBudget.id));
    }

    await recordAuditLog(db, ctx, 'purchase_requisition_created', 'purchase_requisition', createdPr.id, {
      prNumber,
      estimatedTotalPaise,
      budgetCheckStatus: evaluation.budgetCheckStatus,
      approvalTierRequired: evaluation.approvalTierRequired,
      status: createdPr.status,
    });

    return c.json({
      requisition: createdPr,
      evaluation,
    }, 201);
  });

  app.post('/api/enterprise/requisitions/:id/approve', async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    const body = await c.req.json<{
      convertToRfq?: boolean;
      overrideBudgetHardStop?: boolean;
    }>().catch(() => ({ convertToRfq: false, overrideBudgetHardStop: false }));

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [pr] = await db
      .select()
      .from(schema.purchaseRequisitions)
      .where(and(eq(schema.purchaseRequisitions.id, id), eq(schema.purchaseRequisitions.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!pr) return c.json({ error: 'Purchase Requisition not found.' }, 404);

    if (pr.budgetCheckStatus === 'exceeds_budget_blocked' && !body.overrideBudgetHardStop && ctx.role !== 'owner') {
      return c.json(
        { error: 'Requisition exceeds hard budget limit. Only Workspace Owner can authorize a budget override.' },
        403
      );
    }

    let linkedRfqId = pr.linkedRfqId;
    if (body.convertToRfq && !linkedRfqId) {
      const existingRfqs = await db
        .select({ id: schema.rfqs.id })
        .from(schema.rfqs)
        .where(eq(schema.rfqs.workspaceId, ctx.workspaceId));
      const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(existingRfqs.length + 1).padStart(3, '0')}`;
      const [newRfq] = await db
        .insert(schema.rfqs)
        .values({
          id: uid('rfq'),
          workspaceId: ctx.workspaceId,
          rfqNumber,
          title: pr.title,
          type: 'pr_sourced',
          itemsJson: pr.itemsJson,
          deliveryDueAt: addCalendarDays(todayIso(), 10),
          status: 'open',
        })
        .returning();
      linkedRfqId = newRfq.id;
    }

    if (pr.status !== 'approved' && pr.budgetId) {
      const [bdg] = await db
        .select()
        .from(schema.procurementBudgets)
        .where(eq(schema.procurementBudgets.id, pr.budgetId))
        .limit(1);
      if (bdg) {
        await db
          .update(schema.procurementBudgets)
          .set({
            committedPaise: bdg.committedPaise + pr.estimatedTotalPaise,
            updatedAt: new Date(),
          })
          .where(eq(schema.procurementBudgets.id, bdg.id));
      }
    }

    const [updatedPr] = await db
      .update(schema.purchaseRequisitions)
      .set({
        status: linkedRfqId ? 'converted_to_rfq' : 'approved',
        approvedBy: ctx.email,
        approvedAt: new Date(),
        linkedRfqId,
      })
      .where(eq(schema.purchaseRequisitions.id, pr.id))
      .returning();

    await recordAuditLog(db, ctx, 'purchase_requisition_approved', 'purchase_requisition', pr.id, {
      prNumber: pr.prNumber,
      linkedRfqId,
    });

    return c.json({ requisition: updatedPr });
  });

  // =========================================================================
  // 6. ENTERPRISE P2P PO PUSH (COUPA / SAP ARIBA) & AUTO INVOICE MATCH SETUP
  // =========================================================================
  app.post('/api/enterprise/p2p/push-po', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      poId: string;
      provider?: 'coupa' | 'sap_ariba';
      contractNumber?: string;
      prNumber?: string;
    }>();
    if (!body.poId) return c.json({ error: 'poId is required.' }, 400);

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    const [po] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, body.poId), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!po) return c.json({ error: 'Purchase Order not found.' }, 404);

    const [sup] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, po.supplierId))
      .limit(1);

    const items = (po.itemsJson as Array<{
      description: string;
      hsnSac?: string;
      qty: number;
      unit: string;
      unitRatePaise: number;
      taxablePaise: number;
    }>) || [];

    const result = await pushPoToEnterpriseP2P({
      provider: body.provider || 'coupa',
      poNumber: po.poNumber,
      poDate: po.poDate,
      deliveryDueAt: po.deliveryDueAt,
      paymentTermsDays: po.paymentTermsDays,
      supplierName: sup?.name || 'Approved Supplier',
      supplierGstin: sup?.gstin,
      supplierDuns: sup?.dunsNumber,
      buyerCompanyName: ws?.legalName || 'Buyer Workspace',
      contractNumber: body.contractNumber || null,
      prNumber: body.prNumber || null,
      items,
      taxablePaise: po.taxablePaise,
      gstPaise: po.cgstPaise + po.sgstPaise + po.igstPaise,
      totalPaise: po.totalPaise,
      apiUrl: String(
        helpers.getEnv(body.provider === 'sap_ariba' ? 'SAP_ARIBA_API_URL' : 'COUPA_API_URL') || ''
      ) || undefined,
      apiKey: String(
        helpers.getEnv(body.provider === 'sap_ariba' ? 'SAP_ARIBA_API_KEY' : 'COUPA_API_KEY') || ''
      ) || undefined,
    });

    await recordAuditLog(db, ctx, 'enterprise_p2p_po_pushed', 'purchase_order', po.id, {
      poNumber: po.poNumber,
      provider: result.provider,
      externalPoId: result.externalPoId,
      invoiceMatchingArmed: result.invoiceMatchingArmed,
    });

    return c.json({ syncResult: result });
  });

  // =========================================================================
  // 7. POST-TRANSACTION CLOSED-LOOP FEEDBACK ENGINE (PROCUREMENT DATA LAKE)
  // =========================================================================
  app.post('/api/enterprise/feedback/record', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      supplierId: string;
      eventSource?: 'grn_delivery' | 'invoice_3way_audit' | 'rfq_quote_response' | 'integrated_post_transaction';
      relatedEntityId?: string;
      poDeliveryDueAt?: string;
      grnReceivedDate?: string;
      orderedQty?: number;
      acceptedQty?: number;
      invoiceHadMoneyLeak?: boolean;
      invoiceMoneyLeakRupees?: number;
      invoiceTotalRupees?: number;
      rfqResponseHours?: number;
      notes?: string;
    }>();

    if (!body.supplierId) return c.json({ error: 'supplierId is required.' }, 400);

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [sup] = await db
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, body.supplierId), eq(schema.suppliers.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!sup) return c.json({ error: 'Supplier not found in workspace.' }, 404);

    const feedback = computeSupplierPerformanceFeedback({
      supplierId: sup.id,
      supplierName: sup.name,
      currentReliabilityScore: sup.reliabilityScore,
      eventSource: body.eventSource || 'integrated_post_transaction',
      relatedEntityId: body.relatedEntityId || null,
      poDeliveryDueAt: body.poDeliveryDueAt,
      grnReceivedDate: body.grnReceivedDate,
      orderedQty: body.orderedQty,
      acceptedQty: body.acceptedQty,
      invoiceHadMoneyLeak: body.invoiceHadMoneyLeak,
      invoiceMoneyLeakPaise: toPaise(body.invoiceMoneyLeakRupees || 0),
      invoiceTotalPaise: toPaise(body.invoiceTotalRupees || 0),
      rfqResponseHours: body.rfqResponseHours,
    });

    const [logEntry] = await db
      .insert(schema.supplierPerformanceLogs)
      .values({
        id: uid('perf'),
        workspaceId: ctx.workspaceId,
        supplierId: sup.id,
        eventSource: feedback.eventSource,
        relatedEntityId: body.relatedEntityId || null,
        onTimeDeliveryScore: feedback.onTimeDeliveryScore,
        quantityFillRatePct: feedback.quantityFillRatePct,
        invoiceAccuracyScore: feedback.invoiceAccuracyScore,
        rfqResponseHours: body.rfqResponseHours ?? 4,
        previousReliabilityScore: feedback.previousReliabilityScore,
        newReliabilityScore: feedback.newReliabilityScore,
        notes: body.notes || feedback.feedbackSummary,
      })
      .returning();

    const [updatedSupplier] = await db
      .update(schema.suppliers)
      .set({
        reliabilityScore: feedback.newReliabilityScore,
      })
      .where(eq(schema.suppliers.id, sup.id))
      .returning();

    await recordAuditLog(db, ctx, 'supplier_performance_feedback_logged', 'supplier_performance_log', logEntry.id, {
      supplierId: sup.id,
      supplierName: sup.name,
      previousReliabilityScore: feedback.previousReliabilityScore,
      newReliabilityScore: feedback.newReliabilityScore,
    });

    return c.json({
      feedback,
      performanceLog: logEntry,
      supplier: updatedSupplier,
    }, 201);
  });

  // =========================================================================
  // 8. GRADUAL AI ROLLOUT & AUTONOMY GOVERNANCE CONFIGURATION
  // =========================================================================
  app.put('/api/enterprise/governance/autonomy', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can modify AI Rollout & Autonomy Governance settings.' }, 403);
    }
    const body = await c.req.json<Record<string, unknown>>();
    const normalized = normalizeWorkspaceAutonomyConfig(body);

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    await db
      .update(schema.workspaces)
      .set({
        autonomyConfigJson: normalized,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, ctx.workspaceId));

    await recordAuditLog(db, ctx, 'autonomy_governance_updated', 'workspace', ctx.workspaceId, {
      rolloutPhase: normalized.rolloutPhase,
      autoApprovePoLimitPaise: normalized.autoApprovePoLimitPaise,
      workflows: normalized.workflows,
    });

    return c.json({ autonomyConfig: normalized });
  });

  // =========================================================================
  // 9. END-TO-END INTEGRATED 6-STEP MANAGER WORKFLOW RUNNER
  //    (D&B Risk Drop -> SAP Ariba Alternative Query -> Dynamic Sourcing & Proposal ->
  //     NLP Contract Intelligence -> Budget + Coupa PO Sync -> Post-Transaction Data Lake Feedback)
  // =========================================================================
  app.post('/api/enterprise/integrated-workflow/run', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      componentName?: string;
      category?: string;
      qty?: number;
      targetUnitRateRupees?: number;
      department?: string;
    }>().catch(() => ({} as Record<string, undefined>));

    const componentName = body.componentName?.trim() || 'Industrial STM32 Microcontroller Module (Critical Electronic Component)';
    const category = body.category?.trim() || 'Electronics';
    const qty = body.qty && body.qty > 0 ? body.qty : 1000;
    const baseRateRupees = body.targetUnitRateRupees && body.targetUnitRateRupees > 0 ? body.targetUnitRateRupees : 420;
    const department = body.department?.trim() || 'Manufacturing';

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: 'Workspace not found.' }, 404);
    const buyer = toBuyerProfile(ws);

    // Ensure at least 1 disrupted incumbent supplier + 2 approved alternative suppliers exist in this category
    let currentSuppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, ctx.workspaceId));

    let disruptedSup = currentSuppliers.find(
      (s) => (s.category || '').toLowerCase() === category.toLowerCase()
    );
    if (!disruptedSup) {
      const [inserted] = await db
        .insert(schema.suppliers)
        .values({
          id: uid('sup'),
          workspaceId: ctx.workspaceId,
          name: 'Apex Silicon Dynamics Ltd',
          category,
          gstin: '27AABCA8812F1ZV',
          stateCode: '27',
          gstRegime: 'regular',
          udyamTier: 'medium',
          creditDays: 30,
          reliabilityScore: 86,
          financialHealthScore: 84,
          esgScore: 76,
          dunsNumber: '65-102-8841',
          onboardingStatus: 'approved',
          riskStatus: 'normal',
        })
        .returning();
      disruptedSup = inserted;
    }

    let altSuppliers = currentSuppliers.filter(
      (s) => s.id !== disruptedSup!.id && s.onboardingStatus !== 'suspended'
    );
    if (altSuppliers.length < 2) {
      const [alt1] = await db
        .insert(schema.suppliers)
        .values({
          id: uid('sup'),
          workspaceId: ctx.workspaceId,
          name: 'Bharat SemiTech Electronics Pvt Ltd',
          category,
          gstin: '29AABCB4419K1ZK',
          stateCode: ws.stateCode,
          gstRegime: 'regular',
          udyamTier: 'small',
          eInvoiceRequired: true,
          creditDays: 45,
          reliabilityScore: 93,
          financialHealthScore: 91,
          esgScore: 89,
          dunsNumber: '86-419-2210',
          onboardingStatus: 'approved',
          riskStatus: 'normal',
        })
        .returning();

      const [alt2] = await db
        .insert(schema.suppliers)
        .values({
          id: uid('sup'),
          workspaceId: ctx.workspaceId,
          name: 'Deccan Precision Circuits LLP',
          category,
          gstin: '36AABCD9920L1ZD',
          stateCode: '36',
          gstRegime: 'regular',
          udyamTier: 'medium',
          eInvoiceRequired: true,
          creditDays: 30,
          reliabilityScore: 88,
          financialHealthScore: 86,
          esgScore: 84,
          dunsNumber: '86-773-9104',
          onboardingStatus: 'approved',
          riskStatus: 'normal',
        })
        .returning();

      altSuppliers = [alt1, alt2];
    }

    currentSuppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, ctx.workspaceId));

    // STEP 1 & 2: Dun & Bradstreet Financial Health Drop Detection + SAP Ariba / Catalog Alternative Query
    const riskAssessment = assessSupplierRiskAndQueryAlternatives({
      supplier: toCatalogSupplier(disruptedSup),
      sourceProvider: 'dnb_risk_feed',
      eventType: 'financial_health_drop',
      newFinancialHealthScore: 41,
      regionOrCategory: category,
      disruptionNote: `Dun & Bradstreet continuous feed detected sudden drop in financial health score (84 → 41) for ${disruptedSup.name} due to regional logistics & working-capital disruption.`,
      catalogSuppliers: currentSuppliers.map(toCatalogSupplier),
      filterCriteria: {
        category,
        buyerStateCode: ws.stateCode,
        maxLeadTimeDays: 14,
        minEsgScore: 70,
        minReliabilityScore: 75,
        prioritizeBy: 'balanced',
      },
    });

    await db
      .update(schema.suppliers)
      .set({
        financialHealthScore: riskAssessment.newFinancialScore,
        riskStatus: riskAssessment.newRiskStatus,
        lastRiskAssessedAt: new Date(),
      })
      .where(eq(schema.suppliers.id, disruptedSup.id));

    // STEP 3: Trigger Dynamic Sourcing Action (Create Fallback RFQ, Evaluate RFX Responses & Draft Sourcing Proposal)
    const existingRfqs = await db
      .select({ id: schema.rfqs.id })
      .from(schema.rfqs)
      .where(eq(schema.rfqs.workspaceId, ctx.workspaceId));
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(existingRfqs.length + 1).padStart(3, '0')}`;
    const deliveryDueAt = addCalendarDays(todayIso(), 7);

    const [createdRfq] = await db
      .insert(schema.rfqs)
      .values({
        id: uid('rfq'),
        workspaceId: ctx.workspaceId,
        rfqNumber,
        title: componentName,
        type: 'dynamic_risk_sourcing',
        itemsJson: [
          {
            itemKey: 'critical_component',
            description: componentName,
            hsnSac: '8542',
            qty,
            unit: 'pc',
          },
        ],
        deliveryDueAt,
        status: 'open',
      })
      .returning();

    const [savedRiskEvent] = await db
      .insert(schema.supplierRiskEvents)
      .values({
        id: uid('risk'),
        workspaceId: ctx.workspaceId,
        supplierId: disruptedSup.id,
        sourceProvider: 'dnb_risk_feed',
        eventType: 'financial_health_drop',
        severity: riskAssessment.severity,
        previousFinancialScore: riskAssessment.previousFinancialScore,
        newFinancialScore: riskAssessment.newFinancialScore,
        regionOrCategory: category,
        summary: riskAssessment.alertSummary,
        recommendedAlternativesJson: riskAssessment.alternativeSuppliers,
        triggeredRfqId: createdRfq.id,
        status: 'mitigated_sourcing_active',
      })
      .returning();

    const shortlisted =
      riskAssessment.alternativeSuppliers.length >= 2
        ? riskAssessment.alternativeSuppliers.slice(0, 2)
        : altSuppliers.slice(0, 2).map(toCatalogSupplier);

    const quoteInputs: QuoteCostInput[] = [];
    const supplierProfilesMap = new Map<
      string,
      { financialHealthScore?: number; esgScore?: number; leadTimeDays?: number }
    >();
    let primaryQuoteRow: typeof schema.quotes.$inferSelect | null = null;

    for (let i = 0; i < shortlisted.length; i++) {
      const cand = shortlisted[i];
      const rate = i === 0 ? baseRateRupees : Math.round(baseRateRupees * 1.045);
      const creditDays = i === 0 ? 45 : 30;
      const leadDays = i === 0 ? 4 : 7;

      const supTaxProfile: SupplierTaxProfile = {
        id: cand.id,
        name: cand.name,
        gstin: cand.gstin,
        stateCode: cand.stateCode || ws.stateCode,
        gstRegime: (cand.gstRegime as GstRegime) || 'regular',
        udyamTier: (cand.udyamTier as UdyamTier) || 'small',
        eInvoiceRequired: true,
        reliabilityScore: cand.reliabilityScore,
      };

      const qInput: QuoteCostInput = {
        quoteId: `temp_${i}`,
        supplier: supTaxProfile,
        hsnOrItemText: '8542',
        quantity: qty,
        rawRateRupees: rate,
        rawUnit: 'pc',
        gstPct: 18,
        isGstInclusive: false,
        freightTotalRupees: i === 0 ? 2500 : 6000,
        freightGstMode: 'composite_supply',
        creditDays,
        leadTimeDays: leadDays,
      };

      const lc = computeLandedCost(qInput, buyer);
      const [insertedQuote] = await db
        .insert(schema.quotes)
        .values({
          id: uid('qt'),
          workspaceId: ctx.workspaceId,
          rfqId: createdRfq.id,
          supplierId: cand.id,
          quantity: qty,
          rawRateRupees: rate,
          rawUnit: 'pc',
          baseUnitPaise: lc.baseUnitPaise,
          gstPct: 18,
          isGstInclusive: false,
          freightPaise: toPaise(i === 0 ? 2500 : 6000),
          freightGstMode: 'composite_supply',
          creditDays,
          effectiveCreditDays: lc.effectiveCreditDaysUsed,
          leadTimeDays: leadDays,
          netLandedUnitPaise: lc.netLandedUnitPaise,
          creditAdjustedUnitPaise: lc.creditAdjustedRealUnitPaise,
          flagsJson: lc.flags,
          evidenceJson: [`RFX Response from ${cand.name}: ₹${rate}/pc + 18% GST, Net ${creditDays}d, Delivery ${leadDays}d`],
        })
        .returning();

      if (i === 0) primaryQuoteRow = insertedQuote;
      qInput.quoteId = insertedQuote.id;
      quoteInputs.push(qInput);
      supplierProfilesMap.set(cand.id, {
        financialHealthScore: cand.financialHealthScore,
        esgScore: cand.esgScore,
        leadTimeDays: leadDays,
      });
    }

    const sourcingProposal = generateDynamicSourcingProposal({
      rfqNumber: createdRfq.rfqNumber,
      rfqTitle: createdRfq.title,
      buyer,
      quotes: quoteInputs,
      supplierProfiles: supplierProfilesMap,
      riskTriggerSummary: riskAssessment.alertHeadline,
    });

    const winnerSup =
      shortlisted.find((s) => s.id === sourcingProposal.recommendedVendorId) || shortlisted[0];

    // STEP 4: Contract Intelligence (NLP scan flags outdated clauses & suggests policy + regulatory redlines)
    const draftContractText = `MASTER COMPONENT SUPPLY AGREEMENT
Supplier: ${winnerSup.name}
Component: ${componentName} (Qty: ${qty} pcs @ ₹${baseRateRupees}/pc)
1. Payment Terms: Buyer shall pay invoices within Net 60 days from invoice date.
2. Tax Clause: Applicable GST @ 12% shall be charged extra on electronics supply.
3. Price Revision: Supplier reserves the right to revise prices at any time at its sole discretion to pass through all cost increases.
4. Term: 12 months, subject to automatic evergreen renewal unless terminated with 14 days notice.`;

    const existingContracts = await db
      .select({ id: schema.supplierContracts.id })
      .from(schema.supplierContracts)
      .where(eq(schema.supplierContracts.workspaceId, ctx.workspaceId));
    const contractNumber = `CNT-${new Date().getFullYear()}-${String(existingContracts.length + 1).padStart(3, '0')}`;

    const contractReport = await analyzeContractIntelligence({
      contractNumber,
      title: `Supply Contract — ${componentName}`,
      supplierName: winnerSup.name,
      supplierUdyamTier: winnerSup.udyamTier,
      supplierGstRegime: winnerSup.gstRegime,
      rawContractText: draftContractText,
      effectiveFrom: todayIso(),
      expiresAt: addCalendarDays(todayIso(), 365),
      noticePeriodDays: 30,
      autoRenew: true,
      workspacePolicyPatchMd: ws.policyPatchMd,
      skipNetwork: true,
    });

    const [savedContract] = await db
      .insert(schema.supplierContracts)
      .values({
        id: uid('cnt'),
        workspaceId: ctx.workspaceId,
        supplierId: winnerSup.id,
        rfqId: createdRfq.id,
        contractNumber,
        title: `Supply Contract — ${componentName}`,
        contractType: 'rate_contract',
        status: 'active',
        effectiveFrom: todayIso(),
        expiresAt: addCalendarDays(todayIso(), 365),
        autoRenew: false,
        noticePeriodDays: 30,
        contractValuePaise: sourcingProposal.totalOrderValuePaise,
        rawContractText: draftContractText,
        clauseRisksJson: contractReport.clauseRisks,
        policyRedlinesJson: contractReport.policyRedlines,
        complianceScore: contractReport.complianceScore,
        approvedBy: ctx.email,
        approvedAt: new Date(),
      })
      .returning();

    // STEP 5: Budget Validation, PO Generation & Push to Coupa P2P (arming automated 3-way invoice match)
    const periodKey = 'FY2026-27';
    let [deptBudget] = await db
      .select()
      .from(schema.procurementBudgets)
      .where(
        and(
          eq(schema.procurementBudgets.workspaceId, ctx.workspaceId),
          eq(schema.procurementBudgets.department, department),
          eq(schema.procurementBudgets.category, category),
          eq(schema.procurementBudgets.periodKey, periodKey)
        )
      )
      .limit(1);

    if (!deptBudget) {
      const [createdBdg] = await db
        .insert(schema.procurementBudgets)
        .values({
          id: uid('bdg'),
          workspaceId: ctx.workspaceId,
          department,
          category,
          periodKey,
          allocatedPaise: Math.max(toPaise(25_00_000), sourcingProposal.totalOrderValuePaise * 3),
          committedPaise: 0,
          spentPaise: 0,
          hardStop: true,
          alertThresholdPct: 80,
        })
        .returning();
      deptBudget = createdBdg;
    }

    const existingPos = await db
      .select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.workspaceId, ctx.workspaceId));
    const poNumber = `PO-${new Date().getFullYear()}-${String(existingPos.length + 1).padStart(3, '0')}`;
    const goodsTaxablePaise = toPaise(qty * baseRateRupees);
    const freightPaise = toPaise(2500);
    const totalTaxablePaise = goodsTaxablePaise + freightPaise;

    const gstLine = computeGstLine({
      taxablePaise: totalTaxablePaise,
      gstRatePct: 18,
      buyer,
      supplier: {
        id: winnerSup.id,
        name: winnerSup.name,
        gstin: winnerSup.gstin,
        stateCode: winnerSup.stateCode || ws.stateCode,
        gstRegime: (winnerSup.gstRegime as GstRegime) || 'regular',
        udyamTier: (winnerSup.udyamTier as UdyamTier) || 'small',
        eInvoiceRequired: true,
        reliabilityScore: winnerSup.reliabilityScore,
      },
      hsnOrItemText: '8542',
    });

    const poItems = [
      {
        itemKey: 'critical_component',
        description: componentName,
        hsnSac: '8542',
        qty,
        unit: 'pc',
        unitRatePaise: toPaise(baseRateRupees),
        gstPct: 18,
        taxablePaise: goodsTaxablePaise,
      },
    ];

    const [createdPo] = await db
      .insert(schema.purchaseOrders)
      .values({
        id: uid('po'),
        workspaceId: ctx.workspaceId,
        rfqId: createdRfq.id,
        quoteId: primaryQuoteRow?.id || null,
        supplierId: winnerSup.id,
        poNumber,
        poDate: todayIso(),
        itemsJson: poItems,
        freightPaise,
        taxablePaise: totalTaxablePaise,
        cgstPaise: gstLine.cgstPaise,
        sgstPaise: gstLine.sgstPaise,
        igstPaise: gstLine.igstPaise,
        totalPaise: gstLine.grandTotalPaise,
        paymentTermsDays: 45,
        deliveryDueAt,
        invoiceStatus: 'pending',
        paymentDueAt: addCalendarDays(deliveryDueAt, 45),
        approvedBy: ctx.email,
      })
      .returning();

    await db
      .update(schema.procurementBudgets)
      .set({
        committedPaise: deptBudget.committedPaise + createdPo.totalPaise,
        updatedAt: new Date(),
      })
      .where(eq(schema.procurementBudgets.id, deptBudget.id));

    const coupaSync = await pushPoToEnterpriseP2P({
      provider: 'coupa',
      poNumber: createdPo.poNumber,
      poDate: createdPo.poDate,
      deliveryDueAt: createdPo.deliveryDueAt,
      paymentTermsDays: createdPo.paymentTermsDays,
      supplierName: winnerSup.name,
      supplierGstin: winnerSup.gstin,
      buyerCompanyName: ws.legalName,
      contractNumber: savedContract.contractNumber,
      items: poItems,
      taxablePaise: createdPo.taxablePaise,
      gstPaise: createdPo.cgstPaise + createdPo.sgstPaise + createdPo.igstPaise,
      totalPaise: createdPo.totalPaise,
      skipNetwork: true,
    });

    // STEP 6: Post-Transaction Closed-Loop Feedback into Procurement Data Lake
    const feedback = computeSupplierPerformanceFeedback({
      supplierId: winnerSup.id,
      supplierName: winnerSup.name,
      currentReliabilityScore: winnerSup.reliabilityScore,
      eventSource: 'integrated_post_transaction',
      relatedEntityId: createdPo.id,
      poDeliveryDueAt: createdPo.deliveryDueAt,
      grnReceivedDate: createdPo.deliveryDueAt, // Delivered on time
      orderedQty: qty,
      acceptedQty: qty, // 100% QC accepted
      invoiceHadMoneyLeak: false,
      invoiceMoneyLeakPaise: 0,
      invoiceTotalPaise: createdPo.totalPaise,
      rfqResponseHours: 2.5,
    });

    const [perfLog] = await db
      .insert(schema.supplierPerformanceLogs)
      .values({
        id: uid('perf'),
        workspaceId: ctx.workspaceId,
        supplierId: winnerSup.id,
        eventSource: 'integrated_post_transaction',
        relatedEntityId: createdPo.id,
        onTimeDeliveryScore: feedback.onTimeDeliveryScore,
        quantityFillRatePct: feedback.quantityFillRatePct,
        invoiceAccuracyScore: feedback.invoiceAccuracyScore,
        rfqResponseHours: 2.5,
        previousReliabilityScore: feedback.previousReliabilityScore,
        newReliabilityScore: feedback.newReliabilityScore,
        notes: feedback.feedbackSummary,
      })
      .returning();

    await db
      .update(schema.suppliers)
      .set({
        reliabilityScore: feedback.newReliabilityScore,
      })
      .where(eq(schema.suppliers.id, winnerSup.id));

    await recordAuditLog(db, ctx, 'integrated_6step_workflow_executed', 'purchase_order', createdPo.id, {
      disruptedSupplier: disruptedSup.name,
      awardedSupplier: winnerSup.name,
      rfqNumber: createdRfq.rfqNumber,
      contractNumber: savedContract.contractNumber,
      poNumber: createdPo.poNumber,
      totalOrderValueInr: formatINR(createdPo.totalPaise),
      updatedReliabilityScore: feedback.newReliabilityScore,
    });

    return c.json({
      workflowExecuted: true,
      steps: {
        step1_dnbRiskDetection: {
          disruptedSupplierName: disruptedSup.name,
          previousFinancialScore: riskAssessment.previousFinancialScore,
          newFinancialScore: riskAssessment.newFinancialScore,
          severity: riskAssessment.severity,
          headline: riskAssessment.alertHeadline,
          riskEventId: savedRiskEvent.id,
        },
        step2_approvedCatalogQuery: {
          totalAlternativesShortlisted: riskAssessment.alternativeSuppliers.length,
          alternatives: riskAssessment.alternativeSuppliers,
        },
        step3_dynamicSourcingProposal: {
          rfqId: createdRfq.id,
          rfqNumber: createdRfq.rfqNumber,
          proposal: sourcingProposal,
        },
        step4_contractIntelligenceNlp: {
          contractId: savedContract.id,
          contractNumber: savedContract.contractNumber,
          report: contractReport,
        },
        step5_budgetAndCoupaPoPush: {
          poId: createdPo.id,
          poNumber: createdPo.poNumber,
          totalPaise: createdPo.totalPaise,
          budgetDepartment: deptBudget.department,
          coupaSync,
        },
        step6_closedLoopDataLakeFeedback: {
          performanceLogId: perfLog.id,
          feedback,
        },
      },
    }, 201);
  });

  // =========================================================================
  // 10. SECRET-AUTHENTICATED N8N HOLISTIC PnC DISPATCHER
  //     Handles all Permutations & Combinations (PnC) across Kraya 03, 05, 07, 08, 09, 10
  // =========================================================================
  app.post('/api/internal/n8n/enterprise/execute', async (c) => {
    const expectedSecret =
      helpers.getEnv('N8N_WEBHOOK_SECRET') || helpers.getEnv('INBOUND_WEBHOOK_SECRET');
    const provided =
      c.req.header('x-kraya-webhook-secret') || c.req.header('x-kraya-n8n-secret');
    if (!expectedSecret || provided !== expectedSecret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-webhook-secret required.' }, 401);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const rawBody = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));
    const body = ((rawBody.body && typeof rawBody.body === 'object' ? rawBody.body : rawBody) ||
      {}) as Record<string, unknown>;

    // Resolve target workspace safely (never fails even if caller passes 'ws-primary' or omits workspaceId)
    let requestedWsId = String(
      body.workspaceId ||
        c.req.header('x-kraya-workspace-id') ||
        helpers.getEnv('WEBHOOK_DEFAULT_WORKSPACE_ID') ||
        ''
    ).trim();

    let [ws] = requestedWsId
      ? await db
          .select()
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, requestedWsId))
          .limit(1)
      : [];
    if (!ws) {
      [ws] = await db.select().from(schema.workspaces).limit(1);
    }
    if (!ws) {
      return c.json({ error: 'No workspace initialized in database.' }, 404);
    }
    const wsId = ws.id;
    const buyer = toBuyerProfile(ws);
    const sysCtx = { workspaceId: wsId, email: 'n8n@kraya.automation', role: 'owner' as const };
    const operation = String(body.operation || 'integrated_6step_or_feedback_pnc').trim();

    // Helper: Ensure a supplier exists in wsId
    const resolveOrCreateSupplier = async (defaults?: {
      name?: string;
      category?: string;
      gstin?: string | null;
      udyamTier?: string;
      financialHealthScore?: number;
      esgScore?: number;
    }) => {
      const supId = typeof body.supplierId === 'string' ? body.supplierId.trim() : '';
      if (supId) {
        const [found] = await db
          .select()
          .from(schema.suppliers)
          .where(and(eq(schema.suppliers.id, supId), eq(schema.suppliers.workspaceId, wsId)))
          .limit(1);
        if (found) return found;
      }
      const supName = String(
        body.supplierName || body.companyName || body.name || defaults?.name || 'Bharat Industrial Components Pvt Ltd'
      ).trim();
      const existingByName = await db
        .select()
        .from(schema.suppliers)
        .where(and(eq(schema.suppliers.workspaceId, wsId), eq(schema.suppliers.name, supName)))
        .limit(1);
      if (existingByName[0]) return existingByName[0];

      const rawGstin =
        typeof body.gstin === 'string'
          ? body.gstin.trim()
          : defaults?.gstin !== undefined
            ? defaults.gstin
            : '29AABCB4419K1ZK';
      const gstMeta = rawGstin ? validateGstin(rawGstin) : null;

      const [created] = await db
        .insert(schema.suppliers)
        .values({
          id: uid('sup'),
          workspaceId: wsId,
          name: supName,
          phone: typeof body.phone === 'string' ? body.phone : '+91 9845011223',
          email: typeof body.email === 'string' ? body.email : 'billing@bharatcomponents.in',
          category: String(body.category || defaults?.category || 'Electronics'),
          gstin: gstMeta?.valid ? gstMeta.normalized : rawGstin || null,
          stateCode: gstMeta?.stateCode || ws.stateCode,
          gstRegime: String(body.gstRegime || 'regular'),
          udyamNumber: typeof body.udyamNumber === 'string' ? body.udyamNumber : 'UDYAM-KA-03-0012345',
          udyamTier: String(body.udyamTier || defaults?.udyamTier || 'small'),
          eInvoiceRequired: true,
          creditDays: typeof body.creditDays === 'number' ? body.creditDays : 45,
          reliabilityScore: typeof body.reliabilityScore === 'number' ? body.reliabilityScore : 88,
          financialHealthScore:
            typeof body.financialHealthScore === 'number'
              ? body.financialHealthScore
              : defaults?.financialHealthScore ?? 84,
          esgScore:
            typeof body.esgScore === 'number' ? body.esgScore : defaults?.esgScore ?? 82,
          dunsNumber: typeof body.dunsNumber === 'string' ? body.dunsNumber : '86-419-2210',
          onboardingStatus: 'approved',
          riskStatus: 'normal',
        })
        .returning();
      return created;
    };

    // -----------------------------------------------------------------------
    // PnC OPERATION A: 5-Gate Supplier Onboarding, KYC, D&B & ESG Router
    // -----------------------------------------------------------------------
    if (operation === 'onboarding_kyc_pnc') {
      const hasExplicitGstin = typeof body.gstin === 'string' && body.gstin.trim().length > 0;
      const gstinCheck = hasExplicitGstin ? validateGstin(String(body.gstin)) : null;
      const sup = await resolveOrCreateSupplier({
        name: String(body.companyName || body.supplierName || 'Kaveri Precision Components Pvt Ltd'),
        gstin: hasExplicitGstin && gstinCheck?.valid ? gstinCheck.normalized : null,
      });

      const finScore =
        typeof body.financialHealthScore === 'number'
          ? body.financialHealthScore
          : sup.financialHealthScore ?? 82;
      const esgScore =
        typeof body.esgScore === 'number' ? body.esgScore : sup.esgScore ?? 78;
      const gstinToEval = hasExplicitGstin ? String(body.gstin).trim() : sup.gstin;
      const liveGstnActive =
        body.liveGstnActive === false ||
        String(body.taxpayerStatus || '').toLowerCase() === 'cancelled'
          ? false
          : true;

      const [udyamRes, ifscRes, gleifRes] = await Promise.all([
        body.udyamNumber
          ? verifyUdyamLive(String(body.udyamNumber), { skipNetwork: true })
          : Promise.resolve(null),
        body.ifsc ? verifyIndianIfscLive(String(body.ifsc), true) : Promise.resolve(null),
        sup.name
          ? verifySupplierGlobalRegistry(sup.name, helpers.getEnv('OPENCORPORATES_API_KEY'))
          : Promise.resolve(null),
      ]);

      const evaluation = evaluateSupplierOnboardingGate({
        supplierId: sup.id,
        name: sup.name,
        gstin: gstinToEval,
        gstRegime: String(body.gstRegime || sup.gstRegime || 'regular'),
        udyamNumber: typeof body.udyamNumber === 'string' ? body.udyamNumber : sup.udyamNumber,
        udyamTier: String(body.udyamTier || sup.udyamTier || 'small'),
        phone: body.phone !== undefined ? (body.phone ? String(body.phone) : null) : sup.phone,
        email: body.email !== undefined ? (body.email ? String(body.email) : null) : sup.email,
        ifscCode: typeof body.ifsc === 'string' ? body.ifsc : null,
        dunsNumber: typeof body.dunsNumber === 'string' ? body.dunsNumber : sup.dunsNumber,
        financialHealthScore: finScore,
        esgScore,
        liveGstnActive,
      });

      let pncBranch:
        | 'blocked_invalid_gstin_or_insolvent'
        | 'approved_for_po_onboarding_complete'
        | 'compliance_review_required'
        | 'hold_missing_kyc_docs' = 'approved_for_po_onboarding_complete';

      if (
        (hasExplicitGstin && !gstinCheck?.valid) ||
        !liveGstnActive ||
        finScore < 40 ||
        evaluation.recommendedStatus === 'suspended'
      ) {
        pncBranch = 'blocked_invalid_gstin_or_insolvent';
      } else if (evaluation.recommendedStatus === 'approved') {
        pncBranch = 'approved_for_po_onboarding_complete';
      } else if (evaluation.recommendedStatus === 'compliance_review') {
        pncBranch = 'compliance_review_required';
      } else {
        pncBranch = 'hold_missing_kyc_docs';
      }

      await db
        .update(schema.suppliers)
        .set({
          onboardingStatus:
            pncBranch === 'blocked_invalid_gstin_or_insolvent'
              ? 'suspended'
              : evaluation.recommendedStatus,
          financialHealthScore: finScore,
          esgScore,
        })
        .where(eq(schema.suppliers.id, sup.id));

      return c.json({
        ok: true,
        workspaceId: wsId,
        operation,
        pncBranch,
        supplierId: sup.id,
        supplierName: sup.name,
        evaluation,
        registries: {
          gstinValid: gstinToEval ? validateGstin(gstinToEval).valid : false,
          udyam: udyamRes,
          bankIfsc: ifscRes,
          globalRegistry: gleifRes,
        },
      });
    }

    // -----------------------------------------------------------------------
    // PnC OPERATION B: Continuous D&B Risk Watch, Catalog Filter & Sourcing Proposal
    // -----------------------------------------------------------------------
    if (operation === 'risk_sourcing_pnc') {
      const category = String(body.category || body.regionOrCategory || 'Electronics');
      const targetSup = await resolveOrCreateSupplier({
        name: String(body.supplierName || 'Apex Silicon Dynamics Ltd'),
        category,
        financialHealthScore: 84,
        esgScore: 76,
      });

      // Ensure at least 2 approved alternative suppliers exist in catalog
      let allSuppliers = await db
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.workspaceId, wsId));
      const others = allSuppliers.filter((s) => s.id !== targetSup.id && s.onboardingStatus === 'approved');
      if (others.length < 2) {
        await db.insert(schema.suppliers).values([
          {
            id: uid('sup'),
            workspaceId: wsId,
            name: 'Bharat SemiTech Electronics Pvt Ltd',
            category,
            gstin: '29AABCB4419K1ZK',
            stateCode: ws.stateCode,
            gstRegime: 'regular',
            udyamTier: 'small',
            eInvoiceRequired: true,
            creditDays: 45,
            reliabilityScore: 94,
            financialHealthScore: 91,
            esgScore: 89,
            onboardingStatus: 'approved',
            riskStatus: 'normal',
          },
          {
            id: uid('sup'),
            workspaceId: wsId,
            name: 'Deccan Precision Circuits LLP',
            category,
            gstin: '36AABCD9920L1ZD',
            stateCode: '36',
            gstRegime: 'regular',
            udyamTier: 'medium',
            eInvoiceRequired: true,
            creditDays: 30,
            reliabilityScore: 89,
            financialHealthScore: 87,
            esgScore: 85,
            onboardingStatus: 'approved',
            riskStatus: 'normal',
          },
        ]);
        allSuppliers = await db
          .select()
          .from(schema.suppliers)
          .where(eq(schema.suppliers.workspaceId, wsId));
      }

      const newFinScore =
        typeof body.newFinancialHealthScore === 'number' ? body.newFinancialHealthScore : 41;
      const assessment = assessSupplierRiskAndQueryAlternatives({
        supplier: toCatalogSupplier(targetSup),
        sourceProvider:
          (body.sourceProvider as 'dnb_risk_feed' | 'sap_ariba_risk' | 'gstn_watchdog') ||
          'dnb_risk_feed',
        eventType:
          (body.eventType as
            | 'financial_health_drop'
            | 'regional_disruption'
            | 'gstn_cancelled_or_suspended'
            | 'esg_compliance_breach') || 'financial_health_drop',
        newFinancialHealthScore: newFinScore,
        regionOrCategory: category,
        disruptionNote: typeof body.disruptionNote === 'string' ? body.disruptionNote : undefined,
        catalogSuppliers: allSuppliers.map(toCatalogSupplier),
        filterCriteria: {
          category,
          buyerStateCode: ws.stateCode,
          maxLeadTimeDays: typeof body.maxLeadTimeDays === 'number' ? body.maxLeadTimeDays : 14,
          minEsgScore: typeof body.minEsgScore === 'number' ? body.minEsgScore : 60,
          prioritizeBy:
            (body.prioritizeBy as 'balanced' | 'lead_time' | 'compliance_reliability' | 'esg') ||
            'balanced',
        },
      });

      await db
        .update(schema.suppliers)
        .set({
          financialHealthScore: assessment.newFinancialScore,
          riskStatus: assessment.newRiskStatus,
          lastRiskAssessedAt: new Date(),
        })
        .where(eq(schema.suppliers.id, targetSup.id));

      let pncBranch:
        | 'critical_disruption_dual_source_70_30'
        | 'elevated_risk_backup_rfq_standby'
        | 'healthy_supplier_no_fallback_needed' = 'critical_disruption_dual_source_70_30';

      if (assessment.severity === 'critical' || assessment.newFinancialScore < 45) {
        pncBranch = 'critical_disruption_dual_source_70_30';
      } else if (assessment.severity === 'high' || assessment.severity === 'medium') {
        pncBranch = 'elevated_risk_backup_rfq_standby';
      } else {
        pncBranch = 'healthy_supplier_no_fallback_needed';
      }

      // Generate dynamic sourcing proposal across top alternatives when risk is elevated/critical
      let proposal = null;
      let triggeredRfqId: string | null = null;
      if (pncBranch !== 'healthy_supplier_no_fallback_needed' && assessment.alternativeSuppliers.length > 0) {
        const componentTitle = String(
          body.componentTitle || `Fallback Sourcing: ${category} Components`
        );
        const qty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : 500;
        const baseRate =
          typeof body.targetUnitRateRupees === 'number' && body.targetUnitRateRupees > 0
            ? body.targetUnitRateRupees
            : 380;

        const existingRfqs = await db
          .select({ id: schema.rfqs.id })
          .from(schema.rfqs)
          .where(eq(schema.rfqs.workspaceId, wsId));
        const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(existingRfqs.length + 1).padStart(3, '0')}`;
        const [newRfq] = await db
          .insert(schema.rfqs)
          .values({
            id: uid('rfq'),
            workspaceId: wsId,
            rfqNumber,
            title: componentTitle,
            type: 'risk_fallback',
            itemsJson: [{ itemKey: 'comp', description: componentTitle, hsnSac: '8542', qty, unit: 'pc' }],
            deliveryDueAt: addCalendarDays(todayIso(), 7),
            status: 'open',
          })
          .returning();
        triggeredRfqId = newRfq.id;

        const qInputs: QuoteCostInput[] = assessment.alternativeSuppliers.slice(0, 2).map((alt, i) => ({
          quoteId: `q_alt_${i}`,
          supplier: {
            id: alt.id,
            name: alt.name,
            gstin: alt.gstin,
            stateCode: alt.stateCode || ws.stateCode,
            gstRegime: (alt.gstRegime as GstRegime) || 'regular',
            udyamTier: (alt.udyamTier as UdyamTier) || 'small',
            eInvoiceRequired: true,
            reliabilityScore: alt.reliabilityScore,
          },
          hsnOrItemText: '8542',
          quantity: qty,
          rawRateRupees: i === 0 ? baseRate : Math.round(baseRate * 1.04),
          rawUnit: 'pc',
          gstPct: 18,
          isGstInclusive: false,
          freightTotalRupees: i === 0 ? 2000 : 4500,
          freightGstMode: 'composite_supply',
          creditDays: alt.creditDays || 45,
          leadTimeDays: alt.estimatedLeadTimeDays,
        }));

        proposal = generateDynamicSourcingProposal({
          rfqNumber,
          rfqTitle: componentTitle,
          buyer,
          quotes: qInputs,
          riskTriggerSummary: assessment.alertHeadline,
        });
      }

      const [riskEvt] = await db
        .insert(schema.supplierRiskEvents)
        .values({
          id: uid('risk'),
          workspaceId: wsId,
          supplierId: targetSup.id,
          sourceProvider: assessment.sourceProvider,
          eventType: assessment.eventType,
          severity: assessment.severity,
          previousFinancialScore: assessment.previousFinancialScore,
          newFinancialScore: assessment.newFinancialScore,
          regionOrCategory: category,
          summary: assessment.alertSummary,
          recommendedAlternativesJson: assessment.alternativeSuppliers,
          triggeredRfqId,
          status: 'open',
        })
        .returning();

      return c.json({
        ok: true,
        workspaceId: wsId,
        operation,
        pncBranch,
        riskEventId: riskEvt.id,
        assessment,
        triggeredRfqId,
        proposal,
      });
    }

    // -----------------------------------------------------------------------
    // PnC OPERATION C: NLP Contract Intelligence & Clause Redlining Router
    // -----------------------------------------------------------------------
    if (operation === 'contract_nlp_pnc') {
      const sup = await resolveOrCreateSupplier({
        name: String(body.supplierName || 'Bharat SemiTech Electronics Pvt Ltd'),
        udyamTier: String(body.supplierUdyamTier || 'small'),
      });
      const existingContracts = await db
        .select({ id: schema.supplierContracts.id })
        .from(schema.supplierContracts)
        .where(eq(schema.supplierContracts.workspaceId, wsId));
      const contractNumber =
        typeof body.contractNumber === 'string' && body.contractNumber.trim()
          ? body.contractNumber.trim()
          : `CNT-${new Date().getFullYear()}-${String(existingContracts.length + 1).padStart(3, '0')}`;
      const title = String(body.title || `Master Component Supply Agreement — ${sup.name}`);
      const rawText = String(
        body.rawContractText ||
          '1. Payment Terms: Net 60 days from invoice.\n2. Tax: GST @ 12% extra.\n3. Supplier may revise prices at its sole discretion.\n4. Automatic evergreen renewal unless terminated with 14 days notice.'
      );
      const effectiveFrom = String(body.effectiveFrom || todayIso());
      const expiresAt = String(body.expiresAt || addCalendarDays(effectiveFrom, 365));

      const report = await analyzeContractIntelligence({
        contractNumber,
        title,
        supplierName: sup.name,
        supplierUdyamTier: String(body.supplierUdyamTier || sup.udyamTier || 'small'),
        supplierGstRegime: String(body.supplierGstRegime || sup.gstRegime || 'regular'),
        rawContractText: rawText,
        effectiveFrom,
        expiresAt,
        noticePeriodDays: typeof body.noticePeriodDays === 'number' ? body.noticePeriodDays : 30,
        autoRenew: body.autoRenew !== undefined ? Boolean(body.autoRenew) : true,
        workspacePolicyPatchMd: ws.policyPatchMd,
        skipNetwork: true,
      });

      const autoApply = Boolean(body.autoApplyRedlines);
      const finalText =
        autoApply && report.policyRedlines.length > 0
          ? `${rawText}\n\n--- INCORPORATION OF APPROVED KRAYA POLICY & STATUTORY REDLINES ---\n${report.policyRedlines
              .map((r, i) => `[REDLINE #${i + 1} — ${r.title}]: ${r.suggestedClauseText}`)
              .join('\n')}`
          : rawText;

      const [saved] = await db
        .insert(schema.supplierContracts)
        .values({
          id: uid('cnt'),
          workspaceId: wsId,
          supplierId: sup.id,
          contractNumber,
          title,
          contractType: String(body.contractType || 'msa'),
          status:
            report.approvalVerdict === 'APPROVE_AS_IS' || autoApply ? 'active' : 'under_review',
          effectiveFrom,
          expiresAt,
          autoRenew: Boolean(body.autoRenew),
          noticePeriodDays: 30,
          contractValuePaise: toPaise(Number(body.contractValueRupees || 450000)),
          rawContractText: finalText,
          clauseRisksJson: report.clauseRisks,
          policyRedlinesJson: report.policyRedlines,
          complianceScore: autoApply ? 100 : report.complianceScore,
          approvedBy:
            report.approvalVerdict === 'APPROVE_AS_IS' || autoApply ? 'n8n@kraya.automation' : null,
          approvedAt:
            report.approvalVerdict === 'APPROVE_AS_IS' || autoApply ? new Date() : null,
        })
        .returning();

      let pncBranch:
        | 'critical_statutory_hold_for_redline'
        | 'commercial_policy_redlines_suggested'
        | 'clean_contract_approved_active' = 'clean_contract_approved_active';

      if (report.approvalVerdict === 'HOLD_FOR_LEGAL_REVISION' && !autoApply) {
        pncBranch = 'critical_statutory_hold_for_redline';
      } else if (report.approvalVerdict === 'APPROVE_WITH_REDLINES' && !autoApply) {
        pncBranch = 'commercial_policy_redlines_suggested';
      } else {
        pncBranch = 'clean_contract_approved_active';
      }

      return c.json({
        ok: true,
        workspaceId: wsId,
        operation,
        pncBranch,
        contract: saved,
        report,
      });
    }

    // -----------------------------------------------------------------------
    // PnC OPERATION D: Purchase Requisition (PR), Budget Guard & Approval Matrix
    // -----------------------------------------------------------------------
    if (operation === 'pr_budget_pnc') {
      const department = String(body.department || 'Manufacturing').trim();
      const category = String(body.category || 'Electronics').trim();
      const periodKey = String(body.periodKey || 'FY2026-27').trim();
      const estimatedRupees = Number(body.estimatedTotalRupees || 75000);
      const estimatedTotalPaise = toPaise(estimatedRupees);
      const allocatedRupees = Number(body.allocatedBudgetRupees || 500000);

      let [budget] = await db
        .select()
        .from(schema.procurementBudgets)
        .where(
          and(
            eq(schema.procurementBudgets.workspaceId, wsId),
            eq(schema.procurementBudgets.department, department),
            eq(schema.procurementBudgets.category, category),
            eq(schema.procurementBudgets.periodKey, periodKey)
          )
        )
        .limit(1);

      if (!budget) {
        [budget] = await db
          .insert(schema.procurementBudgets)
          .values({
            id: uid('bdg'),
            workspaceId: wsId,
            department,
            category,
            periodKey,
            allocatedPaise: toPaise(allocatedRupees),
            committedPaise: 0,
            spentPaise: 0,
            hardStop: body.hardStop !== undefined ? Boolean(body.hardStop) : true,
            alertThresholdPct: 80,
          })
          .returning();
      } else if (typeof body.allocatedBudgetRupees === 'number') {
        [budget] = await db
          .update(schema.procurementBudgets)
          .set({
            allocatedPaise: toPaise(allocatedRupees),
            hardStop: body.hardStop !== undefined ? Boolean(body.hardStop) : budget.hardStop,
          })
          .where(eq(schema.procurementBudgets.id, budget.id))
          .returning();
      }

      const autonomy = normalizeWorkspaceAutonomyConfig(
        (ws.autonomyConfigJson as Record<string, unknown>) || {}
      );
      const existingPrs = await db
        .select({ id: schema.purchaseRequisitions.id })
        .from(schema.purchaseRequisitions)
        .where(eq(schema.purchaseRequisitions.workspaceId, wsId));
      const prNumber = `PR-${new Date().getFullYear()}-${String(existingPrs.length + 1).padStart(3, '0')}`;
      const title = String(body.title || 'Industrial Microcontroller & Sensor Batch');

      const evaluation = evaluateRequisitionAndBudget({
        prNumber,
        title,
        department,
        category,
        requestedBy: String(body.requestedBy || 'n8n@kraya.automation'),
        estimatedTotalPaise,
        justification:
          body.justification !== undefined
            ? String(body.justification)
            : 'Production line requirement',
        urgency: (body.urgency as 'standard' | 'urgent' | 'emergency') || 'standard',
        budget,
        autoApproveLimitPaise:
          typeof body.autoApproveLimitRupees === 'number'
            ? toPaise(body.autoApproveLimitRupees)
            : autonomy.autoApprovePoLimitPaise,
        tier1LimitPaise: autonomy.tier1ManagerLimitPaise,
        tier2LimitPaise: autonomy.tier2FinanceLimitPaise,
      });

      let linkedRfqId: string | null = null;
      if (evaluation.canAutoApprove) {
        const existingRfqs = await db
          .select({ id: schema.rfqs.id })
          .from(schema.rfqs)
          .where(eq(schema.rfqs.workspaceId, wsId));
        const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(existingRfqs.length + 1).padStart(3, '0')}`;
        const [newRfq] = await db
          .insert(schema.rfqs)
          .values({
            id: uid('rfq'),
            workspaceId: wsId,
            rfqNumber,
            title,
            type: 'pr_auto_sourced',
            itemsJson: [{ itemKey: 'pr_item', description: title, qty: 1, unit: 'lot' }],
            deliveryDueAt: addCalendarDays(todayIso(), 10),
            status: 'open',
          })
          .returning();
        linkedRfqId = newRfq.id;

        await db
          .update(schema.procurementBudgets)
          .set({
            committedPaise: budget.committedPaise + estimatedTotalPaise,
            updatedAt: new Date(),
          })
          .where(eq(schema.procurementBudgets.id, budget.id));
      }

      const [savedPr] = await db
        .insert(schema.purchaseRequisitions)
        .values({
          id: uid('pr'),
          workspaceId: wsId,
          prNumber,
          title,
          department,
          category,
          requestedBy: String(body.requestedBy || 'n8n@kraya.automation'),
          budgetId: budget.id,
          estimatedTotalPaise,
          itemsJson: [{ description: title, qty: 1, unit: 'lot', estimatedUnitRateRupees: estimatedRupees }],
          justification: body.justification ? String(body.justification) : 'Production line requirement',
          urgency: String(body.urgency || 'standard'),
          approvalTierRequired: evaluation.approvalTierRequired,
          budgetCheckStatus: evaluation.budgetCheckStatus,
          policyViolationsJson: evaluation.policyViolations,
          status: linkedRfqId ? 'converted_to_rfq' : evaluation.recommendedStatus,
          approvedBy: evaluation.canAutoApprove ? 'Kraya Autonomous Budget Engine' : null,
          approvedAt: evaluation.canAutoApprove ? new Date() : null,
          linkedRfqId,
        })
        .returning();

      let pncBranch:
        | 'exceeds_budget_hard_stop_cfo_board'
        | 'tier_2_finance_head_review'
        | 'tier_1_department_manager_approval'
        | 'tier_0_autonomous_auto_approved_to_rfq' = 'tier_1_department_manager_approval';

      if (
        evaluation.budgetCheckStatus === 'exceeds_budget_blocked' ||
        evaluation.budgetCheckStatus === 'exceeds_budget_override_needed' ||
        evaluation.approvalTierRequired === 'tier_3_cfo_board'
      ) {
        pncBranch = 'exceeds_budget_hard_stop_cfo_board';
      } else if (evaluation.approvalTierRequired === 'tier_2_finance_head') {
        pncBranch = 'tier_2_finance_head_review';
      } else if (evaluation.approvalTierRequired === 'tier_0_auto_approved') {
        pncBranch = 'tier_0_autonomous_auto_approved_to_rfq';
      } else {
        pncBranch = 'tier_1_department_manager_approval';
      }

      return c.json({
        ok: true,
        workspaceId: wsId,
        operation,
        pncBranch,
        requisition: savedPr,
        evaluation,
        linkedRfqId,
      });
    }

    // -----------------------------------------------------------------------
    // PnC OPERATION E: Omni-ERP & P2P Router (Coupa / SAP Ariba / Tally / Zoho / UTR)
    // -----------------------------------------------------------------------
    if (operation === 'erp_p2p_pnc') {
      const payload = ((body.payload && typeof body.payload === 'object' ? body.payload : body) ||
        {}) as Record<string, unknown>;
      const provider = String(
        payload.erpProvider || payload.provider || body.erpProvider || body.provider || 'zoho_books'
      )
        .toLowerCase()
        .trim();
      const paymentUtr = String(payload.paymentUtr || body.paymentUtr || '').trim();
      const ifsc = String(payload.supplierIfsc || body.supplierIfsc || 'HDFC0000001')
        .trim()
        .toUpperCase();
      const sup = await resolveOrCreateSupplier();

      const ifscVerify = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)
        ? await verifyIndianIfscLive(ifsc, true)
        : null;

      if (paymentUtr) {
        const invId = String(payload.invoiceId || body.invoiceId || '').trim();
        let paidAtIso = new Date().toISOString();
        if (invId) {
          const [upd] = await db
            .update(schema.invoices)
            .set({ paidAt: new Date() })
            .where(and(eq(schema.invoices.id, invId), eq(schema.invoices.workspaceId, wsId)))
            .returning();
          if (upd?.paidAt) paidAtIso = upd.paidAt.toISOString();
        }
        await recordAuditLog(db, sysCtx, 'n8n_invoice_marked_paid', 'invoice', invId || 'utr_settlement', {
          paymentUtr,
          ifsc: ifscVerify?.ifsc || null,
        });
        return c.json({
          ok: true,
          workspaceId: wsId,
          operation,
          pncBranch: 'payment_utr_settlement',
          action: 'mark_invoice_paid',
          invoiceId: invId || 'settled',
          paymentUtr,
          paidAt: paidAtIso,
          bankVerification: ifscVerify,
          auditSealedInKraya: true,
        });
      }

      if (provider === 'coupa' || provider === 'sap_ariba') {
        const poNumber = String(payload.poNumber || body.poNumber || `PO-${new Date().getFullYear()}-901`);
        const totalPaise = toPaise(Number(payload.totalRupees || body.totalRupees || 495600));
        const taxablePaise = Math.round(totalPaise / 1.18);
        const gstPaise = totalPaise - taxablePaise;

        const p2pResult = await pushPoToEnterpriseP2P({
          provider: provider as 'coupa' | 'sap_ariba',
          poNumber,
          poDate: todayIso(),
          deliveryDueAt: addCalendarDays(todayIso(), 7),
          paymentTermsDays: 45,
          supplierName: sup.name,
          supplierGstin: sup.gstin,
          supplierDuns: sup.dunsNumber,
          buyerCompanyName: ws.legalName,
          items: [
            {
              description: String(payload.componentName || 'Industrial Electronic Sub-Assembly'),
              hsnSac: '8542',
              qty: 100,
              unit: 'pc',
              unitRatePaise: Math.round(taxablePaise / 100),
              taxablePaise,
            },
          ],
          taxablePaise,
          gstPaise,
          totalPaise,
          skipNetwork: true,
        });

        await recordAuditLog(db, sysCtx, 'n8n_enterprise_p2p_synced', 'purchase_order', poNumber, {
          provider,
          externalPoId: p2pResult.externalPoId,
          invoiceMatchingArmed: p2pResult.invoiceMatchingArmed,
        });

        return c.json({
          ok: true,
          workspaceId: wsId,
          operation,
          pncBranch: 'coupa_or_sap_ariba_p2p',
          action: 'record_erp_sync',
          externalVoucherId: p2pResult.externalPoId,
          p2pResult,
          bankVerification: ifscVerify,
          auditSealedInKraya: true,
        });
      }

      if (provider === 'tally_prime') {
        const invNum = String(payload.invoiceNumber || body.invoiceNumber || 'INV-TALLY-2026');
        const taxablePaise = toPaise(Number(payload.taxableRupees || 100000));
        const cgstPaise = toPaise(9000);
        const sgstPaise = toPaise(9000);
        const grandTotalPaise = taxablePaise + cgstPaise + sgstPaise;
        const xml = generateTallyPurchaseXml({
          buyerCompany: ws.legalName,
          vouchers: [
            {
              voucherNumber: invNum,
              dateIso: todayIso(),
              supplierName: sup.name,
              supplierGstin: sup.gstin,
              taxablePaise,
              cgstPaise,
              sgstPaise,
              igstPaise: 0,
              grandTotalPaise,
              narration: 'Auto-synced via Kraya n8n Bridge',
            },
          ],
        });
        const tallyRes = await pushVoucherToTallyPrime(xml, invNum, {});
        await recordAuditLog(db, sysCtx, 'n8n_erp_voucher_synced', 'invoice', invNum, {
          erpProvider: 'tally_prime',
          externalVoucherId: `TALLY-${invNum}`,
        });
        return c.json({
          ok: true,
          workspaceId: wsId,
          operation,
          pncBranch: 'tally_prime_xml_push',
          action: 'record_erp_sync',
          invoiceId: String(payload.invoiceId || invNum),
          externalVoucherId: `TALLY-${invNum}`,
          tallyResult: tallyRes,
          bankVerification: ifscVerify,
          auditSealedInKraya: true,
        });
      }

      // Default: Zoho Books India Bill Push + RazorpayX Payout Draft
      const invNum = String(payload.invoiceNumber || body.invoiceNumber || 'INV-ZOHO-2026');
      const taxablePaise = toPaise(Number(payload.taxableRupees || 100000));
      const cgstPaise = toPaise(9000);
      const sgstPaise = toPaise(9000);
      const grandTotalPaise = taxablePaise + cgstPaise + sgstPaise;
      const zohoRes = await pushBillToZohoBooks({
        invoiceNumber: invNum,
        invoiceDate: todayIso(),
        supplierName: sup.name,
        supplierGstin: sup.gstin,
        buyerCompanyName: ws.legalName,
        items: [
          {
            description: 'Audited Goods',
            hsnSac: '8542',
            qty: 100,
            unit: 'pc',
            unitRatePaise: Math.round(taxablePaise / 100),
            taxablePaise,
          },
        ],
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise: 0,
        grandTotalPaise,
      });
      const payoutDraft = buildRazorpayXPayoutDraft({
        invoiceNumber: invNum,
        supplierName: sup.name,
        netPayablePaise: grandTotalPaise,
        hasLiveRazorpayXCreds: false,
      });
      const extId = String(payload.externalVoucherId || `ZOHO-${invNum}`);
      await recordAuditLog(db, sysCtx, 'n8n_erp_voucher_synced', 'invoice', String(payload.invoiceId || invNum), {
        erpProvider: 'zoho_books',
        externalVoucherId: extId,
      });

      return c.json({
        ok: true,
        workspaceId: wsId,
        operation,
        pncBranch: 'zoho_books_bill_push',
        action: 'record_erp_sync',
        invoiceId: String(payload.invoiceId || invNum),
        externalVoucherId: extId,
        zohoResult: zohoRes,
        payoutDraft,
        bankVerification: ifscVerify,
        auditSealedInKraya: true,
      });
    }

    // -----------------------------------------------------------------------
    // PnC OPERATION F: Connected 6-Step Workflow OR Closed-Loop Feedback Lake
    // -----------------------------------------------------------------------
    const mode = String(body.mode || 'full_6step').trim();
    if (mode === 'feedback_only') {
      const sup = await resolveOrCreateSupplier();
      const feedback = computeSupplierPerformanceFeedback({
        supplierId: sup.id,
        supplierName: sup.name,
        currentReliabilityScore: sup.reliabilityScore,
        eventSource: 'integrated_post_transaction',
        poDeliveryDueAt: typeof body.poDeliveryDueAt === 'string' ? body.poDeliveryDueAt : todayIso(),
        grnReceivedDate:
          typeof body.grnReceivedDate === 'string'
            ? body.grnReceivedDate
            : body.lateDeliveryDays
              ? addCalendarDays(todayIso(), Number(body.lateDeliveryDays))
              : todayIso(),
        orderedQty: typeof body.orderedQty === 'number' ? body.orderedQty : 1000,
        acceptedQty: typeof body.acceptedQty === 'number' ? body.acceptedQty : 1000,
        invoiceHadMoneyLeak: Boolean(body.invoiceHadMoneyLeak),
        invoiceMoneyLeakPaise: toPaise(Number(body.invoiceMoneyLeakRupees || 0)),
        invoiceTotalPaise: toPaise(Number(body.invoiceTotalRupees || 420000)),
        rfqResponseHours: typeof body.rfqResponseHours === 'number' ? body.rfqResponseHours : 3,
      });

      const [logEntry] = await db
        .insert(schema.supplierPerformanceLogs)
        .values({
          id: uid('perf'),
          workspaceId: wsId,
          supplierId: sup.id,
          eventSource: feedback.eventSource,
          onTimeDeliveryScore: feedback.onTimeDeliveryScore,
          quantityFillRatePct: feedback.quantityFillRatePct,
          invoiceAccuracyScore: feedback.invoiceAccuracyScore,
          rfqResponseHours: typeof body.rfqResponseHours === 'number' ? body.rfqResponseHours : 3,
          previousReliabilityScore: feedback.previousReliabilityScore,
          newReliabilityScore: feedback.newReliabilityScore,
          notes: feedback.feedbackSummary,
        })
        .returning();

      await db
        .update(schema.suppliers)
        .set({ reliabilityScore: feedback.newReliabilityScore })
        .where(eq(schema.suppliers.id, sup.id));

      const pncBranch =
        feedback.reliabilityDelta >= 0
          ? 'post_transaction_reliability_upgraded'
          : 'post_transaction_reliability_penalized';

      return c.json({
        ok: true,
        workspaceId: wsId,
        operation,
        pncBranch,
        feedback,
        performanceLogId: logEntry.id,
      });
    }

    // Full 6-Step Integrated Pipeline execution via internal n8n call
    const componentName = String(
      body.componentName || 'Industrial STM32 Microcontroller Module (Critical Electronic Component)'
    );
    const category = String(body.category || 'Electronics');
    const qty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : 1000;
    const baseRateRupees =
      typeof body.targetUnitRateRupees === 'number' && body.targetUnitRateRupees > 0
        ? body.targetUnitRateRupees
        : 420;

    const disruptedSup = await resolveOrCreateSupplier({
      name: 'Apex Silicon Dynamics Ltd',
      category,
      financialHealthScore: 84,
      esgScore: 76,
    });

    let allSuppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, wsId));
    if (allSuppliers.filter((s) => s.id !== disruptedSup.id).length < 2) {
      await db.insert(schema.suppliers).values([
        {
          id: uid('sup'),
          workspaceId: wsId,
          name: 'Bharat SemiTech Electronics Pvt Ltd',
          category,
          gstin: '29AABCB4419K1ZK',
          stateCode: ws.stateCode,
          gstRegime: 'regular',
          udyamTier: 'small',
          eInvoiceRequired: true,
          creditDays: 45,
          reliabilityScore: 93,
          financialHealthScore: 91,
          esgScore: 89,
          onboardingStatus: 'approved',
          riskStatus: 'normal',
        },
        {
          id: uid('sup'),
          workspaceId: wsId,
          name: 'Deccan Precision Circuits LLP',
          category,
          gstin: '36AABCD9920L1ZD',
          stateCode: '36',
          gstRegime: 'regular',
          udyamTier: 'medium',
          eInvoiceRequired: true,
          creditDays: 30,
          reliabilityScore: 88,
          financialHealthScore: 86,
          esgScore: 84,
          onboardingStatus: 'approved',
          riskStatus: 'normal',
        },
      ]);
      allSuppliers = await db
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.workspaceId, wsId));
    }

    const riskAssessment = assessSupplierRiskAndQueryAlternatives({
      supplier: toCatalogSupplier(disruptedSup),
      sourceProvider: 'dnb_risk_feed',
      eventType: 'financial_health_drop',
      newFinancialHealthScore: 41,
      regionOrCategory: category,
      catalogSuppliers: allSuppliers.map(toCatalogSupplier),
      filterCriteria: {
        category,
        buyerStateCode: ws.stateCode,
        maxLeadTimeDays: 14,
        minEsgScore: 65,
        prioritizeBy: 'balanced',
      },
    });

    const winnerSup = riskAssessment.recommendedPrimaryAlternative || toCatalogSupplier(allSuppliers[0]);
    const contractReport = await analyzeContractIntelligence({
      contractNumber: `CNT-N8N-${Date.now().toString(36).toUpperCase()}`,
      title: `Supply Contract — ${componentName}`,
      supplierName: winnerSup.name,
      supplierUdyamTier: winnerSup.udyamTier,
      supplierGstRegime: winnerSup.gstRegime,
      rawContractText:
        '1. Payment Terms: Net 60 days.\n2. Tax: GST @ 12% extra.\n3. Supplier may revise prices at its sole discretion.\n4. Automatic evergreen renewal.',
      effectiveFrom: todayIso(),
      expiresAt: addCalendarDays(todayIso(), 365),
      autoRenew: true,
      workspacePolicyPatchMd: ws.policyPatchMd,
      skipNetwork: true,
    });

    const totalTaxablePaise = toPaise(qty * baseRateRupees + 2500);
    const totalPaise = Math.round(totalTaxablePaise * 1.18);
    const coupaSync = await pushPoToEnterpriseP2P({
      provider: 'coupa',
      poNumber: `PO-N8N-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      poDate: todayIso(),
      deliveryDueAt: addCalendarDays(todayIso(), 7),
      paymentTermsDays: 45,
      supplierName: winnerSup.name,
      supplierGstin: winnerSup.gstin,
      buyerCompanyName: ws.legalName,
      items: [
        {
          description: componentName,
          hsnSac: '8542',
          qty,
          unit: 'pc',
          unitRatePaise: toPaise(baseRateRupees),
          taxablePaise: toPaise(qty * baseRateRupees),
        },
      ],
      taxablePaise: totalTaxablePaise,
      gstPaise: totalPaise - totalTaxablePaise,
      totalPaise,
      skipNetwork: true,
    });

    const feedback = computeSupplierPerformanceFeedback({
      supplierId: winnerSup.id,
      supplierName: winnerSup.name,
      currentReliabilityScore: winnerSup.reliabilityScore,
      eventSource: 'integrated_post_transaction',
      poDeliveryDueAt: addCalendarDays(todayIso(), 7),
      grnReceivedDate: addCalendarDays(todayIso(), 7),
      orderedQty: qty,
      acceptedQty: qty,
      invoiceHadMoneyLeak: false,
      rfqResponseHours: 2.0,
    });

    return c.json({
      ok: true,
      workspaceId: wsId,
      operation,
      pncBranch: 'full_6step_pipeline_executed',
      steps: {
        step1_dnbRiskAlert: riskAssessment.alertHeadline,
        step2_alternativesShortlisted: riskAssessment.alternativeSuppliers.length,
        step3_preferredVendor: winnerSup.name,
        step4_contractRedlinesGenerated: contractReport.policyRedlines.length,
        step5_coupaPoSynced: coupaSync.externalPoId,
        step6_reliabilityScoreUpdated: `${feedback.previousReliabilityScore} -> ${feedback.newReliabilityScore}`,
      },
      riskAssessment,
      contractReport,
      coupaSync,
      feedback,
    });
  });

  // =========================================================================
  // 11. TRIGGER ANY LIVE N8N WORKFLOW & PnC SCENARIO FROM KRAYA UI
  // =========================================================================
  app.post('/api/enterprise/n8n/trigger', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      webhookPath: string;
      payload?: Record<string, unknown>;
    }>();

    const cleanPath = String(body.webhookPath || '').replace(/^\/+|\/+$/g, '');
    if (!cleanPath) {
      return c.json({ error: 'webhookPath is required (e.g. kraya-risk-sourcing).' }, 400);
    }

    const n8nBase = (helpers.getEnv('N8N_API_URL') || 'http://localhost:5678')
      .trim()
      .replace(/\/+$/, '');
    const targetUrl = `${n8nBase}/webhook/${cleanPath}`;
    const payload = {
      workspaceId: ctx.workspaceId,
      ...(body.payload || {}),
    };

    const start = Date.now();
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kraya-workspace-id': ctx.workspaceId,
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // non-json
      }
      return c.json({
        ok: res.ok,
        httpStatus: res.status,
        durationMs: Date.now() - start,
        webhookUrl: targetUrl,
        n8nResponse: parsed,
      });
    } catch (err) {
      return c.json(
        {
          ok: false,
          httpStatus: 0,
          durationMs: Date.now() - start,
          webhookUrl: targetUrl,
          error: err instanceof Error ? err.message : 'Failed to reach live n8n webhook',
        },
        502
      );
    }
  });
}
