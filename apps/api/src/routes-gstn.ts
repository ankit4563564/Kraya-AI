import type { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { verifyGstinLive, LiveGstnVerificationResult } from '@kraya/agent-core';
import { validateGstin } from '@kraya/finance-engine';
import { getDb, KrayaDb } from './db/client.js';
import * as schema from './db/schema.js';
import { AppHelpers, AppVariables, recordAuditLog, uid } from './context.js';

export async function lookupOrVerifyGstin(params: {
  db: KrayaDb;
  workspaceId: string;
  rawGstin: string;
  forceRefresh?: boolean;
  helpers: AppHelpers;
}): Promise<{ result: LiveGstnVerificationResult; fromCache: boolean }> {
  const local = validateGstin(params.rawGstin);
  const normalized = local.normalized || (params.rawGstin || '').trim().toUpperCase();

  // Check 30-day PostgreSQL cache first unless forceRefresh requested
  if (!params.forceRefresh && normalized) {
    const [cached] = await params.db
      .select()
      .from(schema.gstnVerifications)
      .where(
        and(
          eq(schema.gstnVerifications.workspaceId, params.workspaceId),
          eq(schema.gstnVerifications.gstin, normalized)
        )
      )
      .limit(1);

    if (cached && cached.cacheExpiresAt.getTime() > Date.now()) {
      return {
        fromCache: true,
        result: {
          gstin: cached.gstin,
          checksumValid: cached.checksumValid,
          liveVerified: cached.liveVerified,
          provider: cached.provider as LiveGstnVerificationResult['provider'],
          taxpayerStatus: cached.taxpayerStatus as LiveGstnVerificationResult['taxpayerStatus'],
          legalName: cached.legalName,
          tradeName: cached.tradeName,
          taxpayerType: cached.taxpayerType as LiveGstnVerificationResult['taxpayerType'],
          inferredGstRegime: cached.inferredGstRegime as LiveGstnVerificationResult['inferredGstRegime'],
          eInvoiceEnabled: cached.eInvoiceEnabled,
          registrationDate: cached.registrationDate,
          cancellationDate: cached.cancellationDate,
          stateCode: local.stateCode,
          stateName: local.stateName,
          pan: local.pan,
          panEntityLabel: local.panEntityLabel,
          tds194cRatePct: local.tds194cRatePct,
          filingComplianceNote: cached.liveVerified
            ? `Cached Live GSTN Record (${cached.taxpayerStatus} · ${cached.taxpayerType})`
            : `Cached Offline Checksum (${local.stateName || 'India'})`,
          riskLevel: cached.riskLevel as LiveGstnVerificationResult['riskLevel'],
          riskFlags: Array.isArray(cached.riskFlagsJson) ? (cached.riskFlagsJson as string[]) : [],
          officialPortalUrl: 'https://services.gst.gov.in/services/searchtp',
          verifiedAt: cached.verifiedAt.toISOString(),
          cacheExpiresAt: cached.cacheExpiresAt.toISOString(),
          rawSummary: (cached.rawSummaryJson as Record<string, unknown> | null) || undefined,
        },
      };
    }
  }

  const result = await verifyGstinLive(params.rawGstin, {
    provider: params.helpers.getEnv('GSTN_API_PROVIDER'),
    apiKey: params.helpers.getEnv('GSTN_API_KEY') || params.helpers.getEnv('GSTIN_LOOKUP_API_KEY'),
    apiUrl: params.helpers.getEnv('GSTN_API_URL') || params.helpers.getEnv('GSTIN_LOOKUP_API_URL'),
  });

  if (result.gstin) {
    const existing = await params.db
      .select({ id: schema.gstnVerifications.id })
      .from(schema.gstnVerifications)
      .where(
        and(
          eq(schema.gstnVerifications.workspaceId, params.workspaceId),
          eq(schema.gstnVerifications.gstin, result.gstin)
        )
      )
      .limit(1);

    const payload = {
      checksumValid: result.checksumValid,
      liveVerified: result.liveVerified,
      provider: result.provider,
      taxpayerStatus: result.taxpayerStatus,
      legalName: result.legalName,
      tradeName: result.tradeName,
      taxpayerType: result.taxpayerType,
      inferredGstRegime: result.inferredGstRegime,
      eInvoiceEnabled: result.eInvoiceEnabled,
      registrationDate: result.registrationDate,
      cancellationDate: result.cancellationDate,
      riskLevel: result.riskLevel,
      riskFlagsJson: result.riskFlags,
      rawSummaryJson: result.rawSummary ?? null,
      verifiedAt: new Date(result.verifiedAt),
      cacheExpiresAt: new Date(result.cacheExpiresAt),
    };

    if (existing[0]) {
      await params.db
        .update(schema.gstnVerifications)
        .set(payload)
        .where(eq(schema.gstnVerifications.id, existing[0].id));
    } else {
      await params.db.insert(schema.gstnVerifications).values({
        id: uid('gstn'),
        workspaceId: params.workspaceId,
        gstin: result.gstin,
        ...payload,
      });
    }
  }

  return { result, fromCache: false };
}

export function registerGstnRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // GET cached GSTN verifications for current workspace
  app.get('/api/gstin/cache', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const rows = await db
      .select()
      .from(schema.gstnVerifications)
      .where(eq(schema.gstnVerifications.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.gstnVerifications.verifiedAt));
    return c.json({ verifications: rows });
  });

  // POST live GSTN verification with 30-day Postgres cache + optional Supplier auto-enrichment
  app.post('/api/gstin/verify-live', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      gstin?: string;
      supplierId?: string;
      forceRefresh?: boolean;
      applyToSupplier?: boolean;
    }>();

    const rawGstin = (body.gstin || '').trim();
    if (!rawGstin) {
      return c.json({ error: 'gstin is required.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const { result, fromCache } = await lookupOrVerifyGstin({
      db,
      workspaceId: ctx.workspaceId,
      rawGstin,
      forceRefresh: Boolean(body.forceRefresh),
      helpers,
    });

    let supplierUpdated = false;
    if (body.supplierId && body.applyToSupplier !== false && ctx.role !== 'ca' && result.checksumValid) {
      const [sup] = await db
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.id, body.supplierId),
            eq(schema.suppliers.workspaceId, ctx.workspaceId)
          )
        )
        .limit(1);

      if (sup) {
        await db
          .update(schema.suppliers)
          .set({
            gstin: result.gstin,
            stateCode: result.stateCode || sup.stateCode,
            panEntityType: result.panEntityLabel || sup.panEntityType,
            gstRegime: result.liveVerified ? result.inferredGstRegime : sup.gstRegime,
            eInvoiceRequired:
              result.eInvoiceEnabled !== null ? result.eInvoiceEnabled : sup.eInvoiceRequired,
          })
          .where(eq(schema.suppliers.id, sup.id));
        supplierUpdated = true;
      }
    }

    await recordAuditLog(db, ctx, 'gstn_verified', 'gstn_verification', result.gstin, {
      fromCache,
      provider: result.provider,
      liveVerified: result.liveVerified,
      taxpayerStatus: result.taxpayerStatus,
      taxpayerType: result.taxpayerType,
      supplierId: body.supplierId || null,
      supplierUpdated,
    });

    return c.json({
      ...result,
      fromCache,
      supplierUpdated,
    });
  });
}
