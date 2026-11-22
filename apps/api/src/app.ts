import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { desc, eq, and, isNull } from 'drizzle-orm';
import {
  addCalendarDays,
  auditSupplierInvoice,
  BookInvoiceRecord,
  computeGstLine,
  computeLandedCost,
  exportImsActionCsv,
  formatINR,
  fromPaise,
  FreightGstMode,
  GstRegime,
  InvoiceAuditInput,
  parseGstr2bPayload,
  rankSupplierQuotes,
  reconcileGstr2b,
  SupplierTaxProfile,
  toPaise,
  TurnoverBand,
  UdyamTier,
  validateGstin,
  WorkspaceTaxProfile,
} from '@kraya/finance-engine';
import {
  buildOutreachPackage,
  classifyProcurementIntake,
  extractDeterministically,
  extractWithGemini,
  generateGstPoPdf,
  generateLandedCostWorkbook,
  generateMonthlyCaAuditPack,
  generateTallyPurchaseXml,
  OutreachLanguage,
  OutreachScenario,
  parseWhatsAppCloudWebhook,
  sendViaResendEmail,
  sendViaWhatsAppCloudApi,
  synthesizeElevenLabsVoiceNote,
  synthesizeVoiceStudioVoiceNote,
  resolveVoiceStudioVoice,
  checkVoiceStudioHealth,
  createVoiceStudioCloneProfile,
  VOICE_CALIBRATION_SCRIPTS,
  transcribeWithVoiceStudio,
  transcribeWithElevenLabsScribe,
  transcribeWithGroqWhisper,
  searchSuppliersRealtime,
  buildNegotiationStrategy,
} from '@kraya/agent-core';
import {
  DEFAULT_WORKSPACE_ID,
  ensureDevWorkspaceIfPermitted,
  getAppliedMigrations,
  getDb,
  getDbMode,
} from './db/client.js';
import * as schema from './db/schema.js';
import {
  buildSessionCookie,
  parseCookies,
  SESSION_COOKIE_NAME,
  verifyMetaWebhookSignature,
} from './auth.js';
import {
  AppEnv,
  AppHelpers,
  AppVariables,
  AuthContext,
  isHttpsRequest,
  recordAuditLog,
  todayIso,
  uid,
} from './context.js';
import { MAX_UPLOAD_BYTES, PersistentVaultStorage } from './storage.js';
import {
  buildSecurityHeaders,
  extractClientIp,
  sanitizeErrorMessage,
  SlidingWindowRateLimiter,
} from './security.js';
import { registerAuthAndTeamRoutes } from './routes-auth.js';
import { persistWorkspaceFile, registerFileRoutes } from './routes-files.js';
import { registerLifecycleRoutes } from './routes-lifecycle.js';

export type { AppEnv };

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

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

function toSupplierProfile(s: typeof schema.suppliers.$inferSelect): SupplierTaxProfile {
  return {
    id: s.id,
    name: s.name,
    gstin: s.gstin,
    stateCode: s.stateCode,
    gstRegime: s.gstRegime as GstRegime,
    udyamTier: s.udyamTier as UdyamTier,
    eInvoiceRequired: s.eInvoiceRequired,
    reliabilityScore: s.reliabilityScore,
  };
}

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/gstin/validate',
  '/api/market/fx-rates',
  '/api/auth/signup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/invitations/accept',
]);

const CA_ALLOWED_POST_PATHS = new Set([
  '/api/auth/logout',
  '/api/auth/switch-workspace',
  '/api/gst/gstr2b-reconcile',
]);

const AUTH_RATE_LIMITED_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/invitations/accept',
]);

export function createApp(envOverride?: Partial<AppEnv>) {
  const app = new Hono<{ Variables: AppVariables }>();
  const rateLimiter = new SlidingWindowRateLimiter();

  const getEnv = <K extends keyof AppEnv>(key: K): AppEnv[K] => {
    if (envOverride && envOverride[key] !== undefined) {
      return envOverride[key];
    }
    if (typeof process !== 'undefined' && key !== 'VAULT_BUCKET') {
      return process.env[key as string] as AppEnv[K];
    }
    return undefined;
  };

  const isProduction = () => getEnv('NODE_ENV') === 'production';
  const isAuthRequired = () => isProduction() || getEnv('REQUIRE_AUTH') !== 'false';
  const getSessionTtlSeconds = () => {
    const raw = Number(getEnv('SESSION_TTL_SECONDS'));
    if (Number.isFinite(raw) && raw >= 5) return raw;
    return 7 * 24 * 60 * 60; // 7 days default with sliding renewal
  };

  const storageInstance = new PersistentVaultStorage({
    r2Binding: getEnv('VAULT_BUCKET'),
    r2AccountId: getEnv('R2_ACCOUNT_ID'),
    r2AccessKeyId: getEnv('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: getEnv('R2_SECRET_ACCESS_KEY'),
    r2BucketName: getEnv('R2_BUCKET_NAME'),
    r2Endpoint: getEnv('R2_ENDPOINT'),
    localVaultDir: getEnv('LOCAL_VAULT_DIR'),
    signingSecret:
      getEnv('SESSION_SECRET') ||
      getEnv('INBOUND_WEBHOOK_SECRET') ||
      'kraya-dev-file-signing-secret',
  });

  const helpers: AppHelpers = {
    getEnv,
    getStorage: () => storageInstance,
    isProduction,
    isAuthRequired,
    getSessionTtlSeconds,
  };

  // =========================================================================
  // GLOBAL ERROR HANDLER (Zero secret leakage, clean 400 mapping)
  // =========================================================================
  app.onError((err, c) => {
    const safeMsg = sanitizeErrorMessage(err);
    if (
      err instanceof SyntaxError ||
      safeMsg.includes('JSON') ||
      safeMsg.startsWith('Invalid ')
    ) {
      return c.json({ error: 'Invalid request payload', detail: safeMsg }, 400);
    }
    // Map PostgreSQL unique violation (23505) to 409 Conflict
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '23505') {
      return c.json({ error: 'Duplicate record conflict.' }, 409);
    }
    if (pgCode === '23503') {
      return c.json({ error: 'Referenced record does not exist.' }, 400);
    }
    console.error('[Kraya API Error]', safeMsg);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // =========================================================================
  // SECURITY HEADERS & CREDENTIAL-SAFE CORS
  // =========================================================================
  app.use('*', async (c, next) => {
    await next();
    const secHeaders = buildSecurityHeaders(isProduction() || isHttpsRequest(c));
    for (const [k, v] of Object.entries(secHeaders)) {
      if (!c.res.headers.has(k)) {
        c.res.headers.set(k, v);
      }
    }
  });

  const configuredOrigins = (getEnv('APP_ORIGIN') || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return configuredOrigins[0] || '';
        if (configuredOrigins.includes(origin)) return origin;
        if (!isProduction() && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return origin;
        }
        return '';
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Kraya-Workspace-Id'],
    })
  );

  // =========================================================================
  // REQUEST SIZE GUARD + SLIDING-WINDOW RATE LIMITER
  // =========================================================================
  app.use('/api/*', async (c, next) => {
    const contentLength = Number(c.req.header('content-length') || '0');
    const contentType = c.req.header('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');
    const maxAllowed = isMultipart ? MAX_UPLOAD_BYTES + 1024 * 1024 : 1024 * 1024; // 16 MB multipart, 1 MB JSON

    if (Number.isFinite(contentLength) && contentLength > maxAllowed) {
      return c.json(
        {
          error: `Request payload too large. Maximum allowed is ${Math.round(maxAllowed / (1024 * 1024))} MB.`,
        },
        413
      );
    }

    const ip = extractClientIp(c.req.raw.headers);
    const reqPath = c.req.path;
    const isAuthPath = AUTH_RATE_LIMITED_PATHS.has(reqPath);
    const authLimit = Number(getEnv('RATE_LIMIT_MAX_AUTH')) || 25;
    const apiLimit = Number(getEnv('RATE_LIMIT_MAX_API')) || 240;

    const bucketKey = isAuthPath ? `auth:${ip}` : `api:${ip}`;
    const limit = isAuthPath ? authLimit : apiLimit;
    const check = rateLimiter.check(bucketKey, limit, 60_000);
    if (!check.allowed) {
      c.header('Retry-After', String(check.retryAfterSeconds));
      return c.json(
        { error: 'Too many requests. Please slow down and try again shortly.' },
        429
      );
    }

    return next();
  });

  // =========================================================================
  // CENTRAL MULTI-TENANT AUTH, COOKIE SESSION & RBAC MIDDLEWARE
  // =========================================================================
  app.use('/api/*', async (c, next) => {
    const reqPath = c.req.path;
    if (
      PUBLIC_PATHS.has(reqPath) ||
      reqPath.startsWith('/api/webhooks/') ||
      (c.req.method === 'GET' && /^\/api\/auth\/invitations\/[^/]+$/.test(reqPath))
    ) {
      return next();
    }

    // Signed URL downloads handle their own HMAC signature + workspace ACL verification
    const isSignedFileDownload =
      c.req.method === 'GET' &&
      /^\/api\/files\/[^/]+\/download$/.test(reqPath) &&
      Boolean(c.req.query('sig')) &&
      Boolean(c.req.query('exp')) &&
      Boolean(c.req.query('ws'));
    if (isSignedFileDownload) {
      return next();
    }

    const db = await getDb(getEnv('DATABASE_URL'));
    const cookies = parseCookies(c.req.header('cookie'));
    const authHeader = c.req.header('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const sessionToken = cookies[SESSION_COOKIE_NAME] || bearer || '';

    let ctx: AuthContext | null = null;
    if (sessionToken) {
      const [sess] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.token, sessionToken))
        .limit(1);

      if (sess) {
        const now = new Date();
        if (sess.expiresAt <= now) {
          // Expired session — purge and reject
          await db.delete(schema.sessions).where(eq(schema.sessions.token, sessionToken));
        } else {
          const [usr] = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, sess.userId))
            .limit(1);

          if (usr) {
            // Confirm active workspace membership still exists
            const [mem] = await db
              .select()
              .from(schema.workspaceMemberships)
              .where(
                and(
                  eq(schema.workspaceMemberships.userId, usr.id),
                  eq(schema.workspaceMemberships.workspaceId, sess.workspaceId)
                )
              )
              .limit(1);

            const effectiveRole = (mem?.role ?? sess.role) as AuthContext['role'];
            if (mem || usr.workspaceId === sess.workspaceId) {
              ctx = {
                workspaceId: sess.workspaceId,
                userId: usr.id,
                userName: usr.name,
                email: usr.email,
                role: effectiveRole,
                authenticated: true,
                sessionToken: sess.token,
              };

              // Sliding session renewal when <50% lifetime remains
              const ttlSeconds = getSessionTtlSeconds();
              const remainingMs = sess.expiresAt.getTime() - now.getTime();
              if (remainingMs < (ttlSeconds * 1000) / 2) {
                const renewedExpires = new Date(now.getTime() + ttlSeconds * 1000);
                await db
                  .update(schema.sessions)
                  .set({ expiresAt: renewedExpires, lastSeenAt: now })
                  .where(eq(schema.sessions.token, sess.token));
                const secureCookie = isProduction() || isHttpsRequest(c);
                c.header(
                  'Set-Cookie',
                  buildSessionCookie(sess.token, { maxAgeSeconds: ttlSeconds, secure: secureCookie })
                );
              }
            }
          }
        }
      }

      if (!ctx && isAuthRequired()) {
        return c.json({ error: 'Invalid or expired session. Please sign in again.' }, 401);
      }
    }

    if (!ctx) {
      if (isAuthRequired()) {
        return c.json({ error: 'Authentication required.' }, 401);
      }
      // Explicit local-dev / automated non-auth test mode ONLY (blocked in NODE_ENV=production)
      await ensureDevWorkspaceIfPermitted(db, !isProduction());
      ctx = {
        workspaceId: DEFAULT_WORKSPACE_ID,
        userId: null,
        userName: 'Local Dev Owner',
        email: 'local-owner@kraya.local',
        role: 'owner',
        authenticated: false,
        sessionToken: null,
      };
    }

    // CA / Auditor role is strictly read-only across all mutating procurement endpoints
    const method = c.req.method.toUpperCase();
    if (
      ctx.role === 'ca' &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      !CA_ALLOWED_POST_PATHS.has(reqPath)
    ) {
      return c.json(
        { error: 'CA/Auditor role is read-only and cannot modify procurement records.' },
        403
      );
    }

    c.set('auth', ctx);
    return next();
  });

  // Register Auth, Onboarding, Team, Persistent File Vault & Procurement Lifecycle routes
  registerAuthAndTeamRoutes(app, helpers);
  registerFileRoutes(app, helpers);
  registerLifecycleRoutes(app, helpers);

  // Scoped media download & inline viewing endpoint (P1 local media vault fallback)
  app.get('/api/uploads/:key{.*}', async (c) => {
    const ctx = c.get('auth');
    const rawKey = c.req.param('key') || c.req.path.replace(/^\/api\/uploads\//, '');
    const decodedKey = decodeURIComponent(rawKey);

    if (decodedKey.includes('..') || decodedKey.startsWith('/')) {
      return c.json({ error: 'Invalid storage key path traversal blocked' }, 400);
    }

    const db = await getDb(getEnv('DATABASE_URL'));

    // Check workspace scoping: key must belong to ctx.workspaceId
    let effectiveStorageKey = decodedKey;
    if (!decodedKey.startsWith(`${ctx.workspaceId}/`)) {
      const [matchedFile] = await db
        .select()
        .from(schema.storedFiles)
        .where(
          and(
            eq(schema.storedFiles.workspaceId, ctx.workspaceId),
            eq(schema.storedFiles.storageKey, decodedKey)
          )
        )
        .limit(1);

      if (!matchedFile) {
        const [matchedEvent] = await db
          .select()
          .from(schema.sourceEvents)
          .where(
            and(
              eq(schema.sourceEvents.workspaceId, ctx.workspaceId),
              eq(schema.sourceEvents.mediaStorageKey, decodedKey)
            )
          )
          .limit(1);

        if (matchedEvent) {
          effectiveStorageKey = matchedEvent.mediaStorageKey || decodedKey;
        } else {
          effectiveStorageKey = `${ctx.workspaceId}/${decodedKey}`;
        }
      }
    }

    let bytes = await storageInstance.getObject(effectiveStorageKey);
    if (!bytes && effectiveStorageKey !== decodedKey) {
      bytes = await storageInstance.getObject(decodedKey);
    }

    // Direct local disk fallback if R2 not configured
    if (!bytes && typeof process !== 'undefined') {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const localUploadsDir = getEnv('LOCAL_VAULT_DIR') || './data/uploads';
        const candidate1 = path.resolve(localUploadsDir, effectiveStorageKey);
        const candidate2 = path.resolve(localUploadsDir, decodedKey);
        const root = path.resolve(localUploadsDir);
        for (const candidate of [candidate1, candidate2]) {
          if (candidate.startsWith(root)) {
            const buf = await fs.readFile(candidate).catch(() => null);
            if (buf) {
              bytes = new Uint8Array(buf);
              break;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (!bytes) {
      return c.json({ error: 'Uploaded media file not found or unauthorized' }, 404);
    }

    let mimeType = 'application/octet-stream';
    const lower = decodedKey.toLowerCase();
    if (lower.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (lower.endsWith('.png')) mimeType = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (lower.endsWith('.webp')) mimeType = 'image/webp';
    else if (lower.endsWith('.webm')) mimeType = 'audio/webm';
    else if (lower.endsWith('.mp3')) mimeType = 'audio/mp3';
    else if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) mimeType = 'audio/mp4';
    else if (lower.endsWith('.wav')) mimeType = 'audio/wav';
    else if (lower.endsWith('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return new Response(new Uint8Array(bytes) as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  // =========================================================================
  // DPDP ACT 2023 COMPLIANCE (AUDIT LOGS, DATA EXPORT, RIGHT TO ERASURE + R2 DELETE)
  // =========================================================================
  app.get('/api/compliance/audit-logs', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(100);
    return c.json(logs);
  });

  app.get('/api/compliance/export-data', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const wsId = ctx.workspaceId;

    const [ws, sups, evts, rfqsList, quotesList, posList, invsList, leaksList, tasksList, histList, amcList, filesList, logs] =
      await Promise.all([
        db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
        db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
        db.select().from(schema.sourceEvents).where(eq(schema.sourceEvents.workspaceId, wsId)),
        db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, wsId)),
        db.select().from(schema.quotes).where(eq(schema.quotes.workspaceId, wsId)),
        db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, wsId)),
        db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)),
        db.select().from(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, wsId)),
        db.select().from(schema.dailyTasks).where(eq(schema.dailyTasks.workspaceId, wsId)),
        db.select().from(schema.priceHistory).where(eq(schema.priceHistory.workspaceId, wsId)),
        db.select().from(schema.amcSchedules).where(eq(schema.amcSchedules.workspaceId, wsId)),
        db.select().from(schema.storedFiles).where(and(eq(schema.storedFiles.workspaceId, wsId), isNull(schema.storedFiles.deletedAt))),
        db.select().from(schema.auditLogs).where(eq(schema.auditLogs.workspaceId, wsId)),
      ]);

    await recordAuditLog(db, ctx, 'data_exported', 'workspace', wsId);

    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        compliance: 'India DPDP Act 2023 — Right to Access & Data Portability Export',
        workspace: ws[0] ?? null,
        suppliers: sups,
        sourceEvents: evts,
        rfqs: rfqsList,
        quotes: quotesList,
        purchaseOrders: posList,
        invoices: invsList,
        moneyLeaks: leaksList,
        dailyTasks: tasksList,
        priceHistory: histList,
        amcSchedules: amcList,
        storedFiles: filesList.map((f) => ({
          id: f.id,
          originalFileName: f.originalFileName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          sha256: f.sha256,
          storageProvider: f.storageProvider,
          createdAt: f.createdAt,
        })),
        auditLogs: logs,
      },
      null,
      2
    );

    return new Response(payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="kraya-dpdp-export-${todayIso()}.json"`,
      },
    });
  });

  app.delete('/api/compliance/erase-workspace', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can trigger DPDP workspace erasure.' }, 403);
    }
    const body = await c.req.json<{ confirmPhrase?: string }>();
    if (body.confirmPhrase !== 'ERASE WORKSPACE') {
      return c.json({ error: 'Type exact confirmation phrase "ERASE WORKSPACE" to proceed.' }, 400);
    }
    const db = await getDb(getEnv('DATABASE_URL'));
    const wsId = ctx.workspaceId;

    // Physically delete every stored file object from R2 / local vault!
    const filesToDelete = await db
      .select()
      .from(schema.storedFiles)
      .where(and(eq(schema.storedFiles.workspaceId, wsId), isNull(schema.storedFiles.deletedAt)));

    let objectsDeletedCount = 0;
    for (const f of filesToDelete) {
      await storageInstance.deleteObject(f.storageKey);
      objectsDeletedCount++;
    }

    // Delete child records in FK-safe order
    await db.delete(schema.creditNotes).where(eq(schema.creditNotes.workspaceId, wsId));
    await db.delete(schema.grnReceipts).where(eq(schema.grnReceipts.workspaceId, wsId));
    await db.delete(schema.storedFiles).where(eq(schema.storedFiles.workspaceId, wsId));
    await db.delete(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, wsId));
    await db.delete(schema.dailyTasks).where(eq(schema.dailyTasks.workspaceId, wsId));
    await db.delete(schema.amcSchedules).where(eq(schema.amcSchedules.workspaceId, wsId));
    await db.delete(schema.priceHistory).where(eq(schema.priceHistory.workspaceId, wsId));
    await db.delete(schema.invoices).where(eq(schema.invoices.workspaceId, wsId));
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, wsId));
    await db.delete(schema.quotes).where(eq(schema.quotes.workspaceId, wsId));
    await db.delete(schema.rfqs).where(eq(schema.rfqs.workspaceId, wsId));
    await db.delete(schema.sourceEvents).where(eq(schema.sourceEvents.workspaceId, wsId));
    await db.delete(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId));

    await recordAuditLog(db, ctx, 'data_erased', 'workspace', wsId, {
      reason: 'DPDP Right to Erasure executed by Owner',
      objectsDeletedCount,
    });

    return c.json({
      ok: true,
      objectsDeletedCount,
      message:
        'All procurement records and stored files permanently erased; mandatory DPDP audit receipt logged.',
    });
  });

  // =========================================================================
  // HEALTH & GSTIN VALIDATOR (PUBLIC)
  // =========================================================================
  app.get('/api/health', async (c) => {
    await getDb(getEnv('DATABASE_URL'));
    const vsBase = getEnv('VOICESTUDIO_BASE_URL');
    const vsReachable = vsBase
      ? await checkVoiceStudioHealth({ baseUrl: vsBase, apiKey: getEnv('VOICESTUDIO_API_KEY') })
      : false;
    const ownVoiceCloneConfigured = Boolean(
      resolveVoiceStudioVoice({
        voiceMapJson: getEnv('VOICESTUDIO_VOICE_MAP'),
        fallbackVoiceId: getEnv('VOICESTUDIO_VOICE_ID'),
      })
    );
    return c.json({
      ok: true,
      service: 'kraya-api',
      dbMode: getDbMode(),
      appliedMigrations: getAppliedMigrations(),
      storageEngine: storageInstance.mode,
      aiExtractionEngine: getEnv('GEMINI_API_KEY') ? 'gemini_live' : 'deterministic_local',
      voiceAsrEngine:
        vsBase && vsReachable && getEnv('VOICESTUDIO_STT_ENABLED') === 'true'
          ? 'voicestudio_local'
          : getEnv('ELEVENLABS_API_KEY')
            ? 'elevenlabs_scribe_v2'
            : getEnv('GROQ_API_KEY')
              ? 'groq_whisper_v3_turbo'
              : 'browser_text_only',
      voiceNoteTtsEnabled: Boolean(getEnv('ELEVENLABS_API_KEY')) || (vsReachable && ownVoiceCloneConfigured),
      voiceStudio: vsBase
        ? { configured: true, reachable: vsReachable, ownVoiceCloneConfigured }
        : { configured: false, reachable: false, ownVoiceCloneConfigured: false },
      emailEngine: getEnv('RESEND_API_KEY') ? 'resend_api' : 'mailto_bridge',
      whatsappEngine:
        getEnv('WHATSAPP_ACCESS_TOKEN') && getEnv('WHATSAPP_PHONE_NUMBER_ID')
          ? 'whatsapp_cloud_api_live'
          : 'wa_me_zero_ban_bridge',
      requireAuth: isAuthRequired(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/gstin/validate', async (c) => {
    const body = await c.req.json<{ gstin?: string }>();
    return c.json(validateGstin(body.gstin));
  });

  // =========================================================================
  // WORKSPACE SETTINGS & LIVE REAL-DATA SUMMARY (TENANT SCOPED)
  // =========================================================================
  app.get('/api/workspace', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    let [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId));

    if (!ws && ctx.workspaceId === DEFAULT_WORKSPACE_ID) {
      await ensureDevWorkspaceIfPermitted(db, true);
      [ws] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, ctx.workspaceId));
    }

    if (!ws) {
      return c.json({ error: 'Workspace not found', workspaceId: ctx.workspaceId }, 404);
    }
    return c.json(ws, 200);
  });

  app.put('/api/workspace', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json(
        { error: 'Only Workspace Owners can update GST/WACC workspace settings.' },
        403
      );
    }
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      legalName?: string;
      gstin?: string | null;
      stateCode?: string;
      gstRegime?: GstRegime;
      waccPct?: number;
      turnoverBand?: TurnoverBand;
      defaultOutreachLang?: OutreachLanguage;
      policyPatchMd?: string | null;
      businessAddress?: string | null;
      primaryContactName?: string | null;
      primaryContactPhone?: string | null;
      primaryContactEmail?: string | null;
    }>();

    let resolvedState = body.stateCode;
    const normalizedGstin = body.gstin?.trim().toUpperCase() || null;
    if (normalizedGstin) {
      const check = validateGstin(normalizedGstin);
      if (!check.valid) {
        return c.json({ error: 'Invalid GSTIN', details: check.errors }, 400);
      }
      resolvedState = resolvedState || check.stateCode || undefined;
    }

    const [updated] = await db
      .update(schema.workspaces)
      .set({
        ...(body.legalName ? { legalName: body.legalName.trim() } : {}),
        ...(body.gstin !== undefined ? { gstin: normalizedGstin } : {}),
        ...(resolvedState ? { stateCode: resolvedState } : {}),
        ...(body.gstRegime ? { gstRegime: body.gstRegime } : {}),
        ...(typeof body.waccPct === 'number' && body.waccPct >= 0 && body.waccPct <= 100
          ? { waccPct: body.waccPct }
          : {}),
        ...(body.turnoverBand ? { turnoverBand: body.turnoverBand } : {}),
        ...(body.defaultOutreachLang ? { defaultOutreachLang: body.defaultOutreachLang } : {}),
        ...(body.policyPatchMd !== undefined ? { policyPatchMd: body.policyPatchMd } : {}),
        ...(body.businessAddress !== undefined ? { businessAddress: body.businessAddress?.trim() || null } : {}),
        ...(body.primaryContactName !== undefined ? { primaryContactName: body.primaryContactName?.trim() || null } : {}),
        ...(body.primaryContactPhone !== undefined ? { primaryContactPhone: body.primaryContactPhone?.trim() || null } : {}),
        ...(body.primaryContactEmail !== undefined ? { primaryContactEmail: body.primaryContactEmail?.trim().toLowerCase() || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .returning();

    await recordAuditLog(db, ctx, 'workspace_updated', 'workspace', ctx.workspaceId, {
      gstin: normalizedGstin,
      waccPct: body.waccPct,
    });

    return c.json(updated);
  });

  app.get('/api/summary', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [leaks, rfqsList, tasksList, suppliersList, eventsList, posList, invsList, filesList] =
      await Promise.all([
        db.select().from(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, wsId)),
        db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, wsId)),
        db.select().from(schema.dailyTasks).where(eq(schema.dailyTasks.workspaceId, wsId)),
        db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
        db.select().from(schema.sourceEvents).where(eq(schema.sourceEvents.workspaceId, wsId)),
        db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, wsId)),
        db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)),
        db
          .select({ id: schema.storedFiles.id })
          .from(schema.storedFiles)
          .where(and(eq(schema.storedFiles.workspaceId, wsId), isNull(schema.storedFiles.deletedAt))),
      ]);

    const activeLeaks = leaks.filter((l) => l.status !== 'dismissed');
    const totalProtectedPaise = activeLeaks.reduce((sum, l) => sum + l.amountPaise, 0);
    const recoveredPaise = leaks
      .filter((l) => l.status === 'recovered')
      .reduce((sum, l) => sum + l.amountPaise, 0);

    return c.json({
      totalProtectedPaise,
      recoveredPaise,
      activeLeaksCount: activeLeaks.length,
      openRfqsCount: rfqsList.filter((r) => r.status !== 'closed').length,
      posIssuedCount: posList.length,
      invoicesAuditedCount: invsList.length,
      openTasksCount: tasksList.filter((t) => t.status === 'open').length,
      suppliersCount: suppliersList.length,
      pendingVerificationsCount: eventsList.filter((e) => e.needsVerification && !e.verifiedAt).length,
      inboxCount: eventsList.length,
      storedFilesCount: filesList.length,
    });
  });

  // =========================================================================
  // INTERNAL SHARED INGEST HELPER (PERSISTS ATTACHMENTS TO R2/VAULT!)
  // =========================================================================
  async function runScopedIngest(params: {
    wsId: string;
    userId: string | null;
    promptText: string;
    channel: string;
    targetRfqId: string | null;
    fileName: string | null;
    fileMime: string | null;
    fileBuffer: Uint8Array | null;
  }) {
    const db = await getDb(getEnv('DATABASE_URL'));
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, params.wsId));
    if (!ws) throw new Error('Invalid workspace');
    const buyer = toBuyerProfile(ws);

    let promptText = params.promptText;
    const { channel, targetRfqId, fileName, fileMime, fileBuffer } = params;

    // Persist attachment securely BEFORE extraction (validates size, MIME, magic bytes)
    let persistedFile: typeof schema.storedFiles.$inferSelect | null = null;
    let fallbackMediaKey: string | null = null;
    if (fileBuffer && fileName) {
      try {
        persistedFile = await persistWorkspaceFile({
          db,
          storage: storageInstance,
          workspaceId: params.wsId,
          uploadedByUserId: params.userId,
          fileName,
          mimeType: fileMime,
          bytes: fileBuffer,
        });
      } catch (err) {
        if (!getEnv('R2_BUCKET_NAME') && typeof process !== 'undefined') {
          try {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const uploadsDir = path.resolve(getEnv('LOCAL_VAULT_DIR') || './data/uploads', params.wsId);
            await fs.mkdir(uploadsDir, { recursive: true });
            const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const relKey = `${params.wsId}/${Date.now()}_${sanitized}`;
            const targetPath = path.resolve(getEnv('LOCAL_VAULT_DIR') || './data/uploads', relKey);
            await fs.writeFile(targetPath, fileBuffer);
            fallbackMediaKey = relKey;
          } catch {
            // ignore
          }
        }
      }
    }

    const effectiveMime = persistedFile?.mimeType || fileMime;

    let transcriptText: string | null = null;
    let asrNote: string | null = null;
    if (fileBuffer && effectiveMime?.startsWith('audio/')) {
      const audioFileName = persistedFile?.originalFileName || fileName || 'voice-note.webm';
      const vsBase = getEnv('VOICESTUDIO_BASE_URL');
      const elevenKey = getEnv('ELEVENLABS_API_KEY');
      const groqKey = getEnv('GROQ_API_KEY');

      // Ordered provider chain: local/private VoiceStudio first, then cloud fallbacks.
      const providers: Array<{ name: string; run: () => Promise<{ text: string }> }> = [];
      if (vsBase && getEnv('VOICESTUDIO_STT_ENABLED') === 'true') {
        providers.push({
          name: 'VoiceStudio local STT',
          run: () =>
            transcribeWithVoiceStudio({
              baseUrl: vsBase,
              apiKey: getEnv('VOICESTUDIO_API_KEY'),
              audioBuffer: fileBuffer,
              fileName: audioFileName,
              mimeType: effectiveMime,
            }),
        });
      }
      if (elevenKey) {
        providers.push({
          name: 'ElevenLabs STT',
          run: () =>
            transcribeWithElevenLabsScribe({
              apiKey: elevenKey,
              audioBuffer: fileBuffer,
              fileName: audioFileName,
              mimeType: effectiveMime,
              modelId: getEnv('ELEVENLABS_STT_MODEL'),
            }),
        });
      }
      if (groqKey) {
        providers.push({
          name: 'Groq Whisper',
          run: () =>
            transcribeWithGroqWhisper({
              apiKey: groqKey,
              audioBuffer: fileBuffer,
              fileName: audioFileName,
              mimeType: effectiveMime,
              model: getEnv('GROQ_WHISPER_MODEL'),
            }),
        });
      }

      if (providers.length === 0) {
        asrNote =
          'Audio stored in persistent vault. Set VOICESTUDIO_BASE_URL (+ VOICESTUDIO_STT_ENABLED=true), ELEVENLABS_API_KEY or GROQ_API_KEY in .env for live call transcription.';
      } else {
        const failures: string[] = [];
        for (const provider of providers) {
          try {
            const asr = await provider.run();
            transcriptText = asr.text;
            promptText = [promptText, transcriptText].filter(Boolean).join('\n');
            if (failures.length > 0) {
              asrNote = `${failures.join(' ')} Automatically fell back to ${provider.name}.`;
            }
            break;
          } catch (err) {
            failures.push(`${provider.name} failed (${sanitizeErrorMessage(err).slice(0, 80)}).`);
          }
        }
        if (transcriptText === null) {
          asrNote = `${failures.join(' ')} Audio retained safely in vault.`;
        }
      }
    }

    const intake = classifyProcurementIntake(promptText, Boolean(fileBuffer));

    const geminiKey = getEnv('GEMINI_API_KEY');
    let extracted;
    if (geminiKey) {
      try {
        extracted = await extractWithGemini({
          apiKey: geminiKey,
          model: getEnv('GEMINI_MODEL'),
          workspace: buyer,
          policyPatchMd: ws.policyPatchMd,
          channel,
          textInput: promptText,
          mediaBase64:
            fileBuffer && !effectiveMime?.startsWith('audio/')
              ? uint8ToBase64(fileBuffer)
              : undefined,
          mediaMimeType: effectiveMime && !effectiveMime.startsWith('audio/') ? effectiveMime : undefined,
        });
      } catch {
        extracted = extractDeterministically(promptText, channel);
      }
    } else {
      extracted = extractDeterministically(promptText, channel);
      if (fileBuffer && !effectiveMime?.startsWith('audio/') && !promptText) {
        extracted.needsVerification = true;
        extracted.missingFields.push('Add GEMINI_API_KEY in .env for live Vision OCR on images/PDFs');
      }
    }

    let supplierRecord: typeof schema.suppliers.$inferSelect | null = null;
    if (extracted.supplierName) {
      const allSuppliers = await db
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.workspaceId, params.wsId));

      supplierRecord =
        allSuppliers.find((s) => s.name.toLowerCase() === extracted.supplierName!.toLowerCase()) ??
        null;

      if (!supplierRecord) {
        const gstinCheck = extracted.supplierGstin ? validateGstin(extracted.supplierGstin) : null;
        const [createdSup] = await db
          .insert(schema.suppliers)
          .values({
            id: uid('sup'),
            workspaceId: params.wsId,
            name: extracted.supplierName,
            phone: extracted.supplierPhone,
            email: extracted.supplierEmail,
            gstin: gstinCheck?.valid ? gstinCheck.normalized : extracted.supplierGstin,
            stateCode: gstinCheck?.stateCode ?? ws.stateCode,
            panEntityType: gstinCheck?.panEntityCode ?? null,
            creditDays: extracted.creditDays ?? 30,
          })
          .returning();
        supplierRecord = createdSup;
      }
    }

    const eventId = uid('evt');
    const [sourceEvent] = await db
      .insert(schema.sourceEvents)
      .values({
        id: eventId,
        workspaceId: params.wsId,
        channel,
        pillar: intake.pillar,
        supplierId: supplierRecord?.id ?? null,
        rfqId: targetRfqId,
        rawContent: promptText || `[File uploaded: ${persistedFile?.originalFileName || fileName}]`,
        mediaFileName: persistedFile?.originalFileName || fileName,
        mediaMimeType: effectiveMime,
        mediaStorageKey: persistedFile?.storageKey || fallbackMediaKey || null,
        fileId: persistedFile?.id ?? null,
        transcriptText,
        parsedSummary: asrNote ? `${extracted.summary} (${asrNote})` : extracted.summary,
        extractedJson: extracted,
        confidenceScore: extracted.overallConfidence,
        needsVerification: extracted.needsVerification || intake.detectedPromptInjection,
      })
      .returning();

    if (persistedFile) {
      await db
        .update(schema.storedFiles)
        .set({ sourceEventId: eventId })
        .where(eq(schema.storedFiles.id, persistedFile.id));
    }

    const createdEntities: Record<string, unknown> = {};
    if (persistedFile) {
      createdEntities.storedFile = {
        id: persistedFile.id,
        originalFileName: persistedFile.originalFileName,
        mimeType: persistedFile.mimeType,
        sizeBytes: persistedFile.sizeBytes,
        storageProvider: persistedFile.storageProvider,
        downloadUrl: `/api/files/${persistedFile.id}/download`,
      };
    }

    const outreachLang = (ws.defaultOutreachLang || 'english') as OutreachLanguage;
    let suggestedOutreach = null;
    const firstItem = extracted.items[0];

    if (intake.pillar === 'initial_rfq' || extracted.documentKind === 'rfq_request') {
      const existingRfqs = await db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, params.wsId));
      const rfqNum = `RFQ-${new Date().getFullYear()}-${String(existingRfqs.length + 1).padStart(3, '0')}`;
      const [rfq] = await db
        .insert(schema.rfqs)
        .values({
          id: uid('rfq'),
          workspaceId: params.wsId,
          rfqNumber: rfqNum,
          title: `${firstItem?.qty ? `${firstItem.qty.toLocaleString('en-IN')} ` : ''}${firstItem?.description || 'New Procurement RFQ'}`,
          type: 'initial',
          itemsJson: extracted.items,
          deliveryDueAt: extracted.deliveryDueDate || addCalendarDays(todayIso(), 10),
          status: 'open',
        })
        .returning();
      createdEntities.rfq = rfq;
      suggestedOutreach = buildOutreachPackage({
        scenario: 'rfq_request',
        language: outreachLang,
        buyerCompany: ws.legalName,
        supplierName: supplierRecord?.name || 'Partner',
        supplierPhone: supplierRecord?.phone,
        supplierEmail: supplierRecord?.email,
        itemDescription: firstItem?.description || rfq.title,
        quantity: firstItem?.qty ?? undefined,
        unit: firstItem?.unit ?? 'pcs',
        dueDate: rfq.deliveryDueAt ?? undefined,
      });
    } else if (
      (intake.pillar === 'quote_capture' || extracted.documentKind === 'quote') &&
      firstItem?.unitRateRupees !== null &&
      supplierRecord
    ) {
      let rfqId = targetRfqId;
      if (!rfqId) {
        const openRfqs = await db
          .select()
          .from(schema.rfqs)
          .where(eq(schema.rfqs.workspaceId, params.wsId))
          .orderBy(desc(schema.rfqs.createdAt));

        const matchingRfq = openRfqs.find(
          (r) =>
            r.status !== 'closed' &&
            (r.title.toLowerCase().includes((firstItem.description || '').toLowerCase().slice(0, 10)) ||
              openRfqs.length === 1)
        );
        if (matchingRfq) {
          rfqId = matchingRfq.id;
        } else {
          const rfqNum = `RFQ-${new Date().getFullYear()}-${String(openRfqs.length + 1).padStart(3, '0')}`;
          const [newRfq] = await db
            .insert(schema.rfqs)
            .values({
              id: uid('rfq'),
              workspaceId: params.wsId,
              rfqNumber: rfqNum,
              title: `${firstItem.qty ? `${firstItem.qty.toLocaleString('en-IN')} ` : ''}${firstItem.description}`,
              type: 'initial',
              itemsJson: extracted.items,
              deliveryDueAt: addCalendarDays(todayIso(), 7),
              status: 'comparing',
            })
            .returning();
          rfqId = newRfq.id;
          createdEntities.rfq = newRfq;
        }
      }

      const histRows = await db
        .select()
        .from(schema.priceHistory)
        .where(
          and(
            eq(schema.priceHistory.workspaceId, params.wsId),
            eq(schema.priceHistory.itemKey, firstItem.itemKey)
          )
        )
        .orderBy(desc(schema.priceHistory.recordedAt))
        .limit(1);

      const missingCriticalPricing =
        firstItem.gstPct === null || !firstItem.qty || firstItem.qty <= 0;

      if (missingCriticalPricing) {
        createdEntities.pendingVerificationReason = `Quote held in Unified Inbox pending human confirmation of missing required fields: ${[
          firstItem.gstPct === null ? 'GST %' : null,
          !firstItem.qty || firstItem.qty <= 0 ? 'Quantity' : null,
        ]
          .filter(Boolean)
          .join(', ')}. Never fabricated.`;
      } else {
        const qty = firstItem.qty!;
        const gstPct = firstItem.gstPct!;
        const creditDays = extracted.creditDays ?? 0;

        const breakdown = computeLandedCost(
          {
            quoteId: 'pending',
            supplier: toSupplierProfile(supplierRecord),
            quantity: qty,
            rawRateRupees: firstItem.unitRateRupees!,
            rawUnit: firstItem.unit || 'pc',
            explicitPackSize: firstItem.packSize,
            gstPct,
            isGstInclusive: Boolean(extracted.isGstInclusive),
            freightTotalRupees: extracted.freightRupees ?? 0,
            freightGstMode: extracted.freightGstMode,
            cashDiscountPct: extracted.cashDiscountPct ?? 0,
            creditDays,
            hasWrittenAgreement: true,
            leadTimeDays: extracted.leadTimeDays,
            hsnOrItemText: firstItem.hsnSac || firstItem.description,
            historicalBenchmarkLandedPaise: histRows[0]?.netLandedUnitPaise ?? null,
          },
          buyer
        );

        const [savedQuote] = await db
          .insert(schema.quotes)
          .values({
            id: uid('qt'),
            workspaceId: params.wsId,
            rfqId,
            supplierId: supplierRecord.id,
            sourceEventId: eventId,
            fileId: persistedFile?.id ?? null,
            quantity: qty,
            rawRateRupees: firstItem.unitRateRupees!,
            rawUnit: firstItem.unit || 'pc',
            normalizationNote: breakdown.normalizationNote,
            baseUnitPaise: breakdown.baseUnitPaise,
            gstPct,
            isGstInclusive: Boolean(extracted.isGstInclusive),
            freightPaise: toPaise(extracted.freightRupees ?? 0),
            freightGstMode: extracted.freightGstMode,
            creditDays,
            effectiveCreditDays: breakdown.effectiveCreditDaysUsed,
            leadTimeDays: extracted.leadTimeDays,
            netLandedUnitPaise: breakdown.netLandedUnitPaise,
            creditAdjustedUnitPaise: breakdown.creditAdjustedRealUnitPaise,
            priceDeltaPct: breakdown.priceDeltaPct,
            flagsJson: breakdown.flags,
            evidenceJson: extracted.evidence,
            needsVerification: extracted.needsVerification,
          })
          .returning();

        if (persistedFile) {
          await db
            .update(schema.storedFiles)
            .set({ quoteId: savedQuote.id, category: 'quote' })
            .where(eq(schema.storedFiles.id, persistedFile.id));
        }

        await db
          .update(schema.sourceEvents)
          .set({ rfqId })
          .where(and(eq(schema.sourceEvents.id, eventId), eq(schema.sourceEvents.workspaceId, params.wsId)));

        for (const flag of breakdown.flags) {
          if (flag.impactPaise > 0 && flag.severity !== 'info') {
            await db.insert(schema.moneyLeaks).values({
              id: uid('leak'),
              workspaceId: params.wsId,
              sourceEventId: eventId,
              quoteId: savedQuote.id,
              supplierId: supplierRecord.id,
              leakType: flag.code,
              title: flag.title,
              detail: flag.detail,
              statutoryRef: flag.statutoryRef,
              amountPaise: flag.impactPaise,
              status: 'detected',
            });
          }
        }

        createdEntities.quote = savedQuote;
        createdEntities.landedCost = breakdown;

        if (breakdown.isPriceCreepAlert && histRows[0]) {
          suggestedOutreach = buildOutreachPackage({
            scenario: 'counter_offer',
            language: outreachLang,
            buyerCompany: ws.legalName,
            supplierName: supplierRecord.name,
            supplierPhone: supplierRecord.phone,
            supplierEmail: supplierRecord.email,
            itemDescription: firstItem.description,
            quotedRatePaise: breakdown.netLandedUnitPaise,
            targetRatePaise: histRows[0].netLandedUnitPaise,
            creditDays: breakdown.effectiveCreditDaysUsed,
          });
        }
      }
    } else if (intake.pillar === 'invoice_audit' || extracted.documentKind === 'invoice') {
      const sup: SupplierTaxProfile = supplierRecord
        ? toSupplierProfile(supplierRecord)
        : {
            id: 'unassigned',
            name: extracted.supplierName || 'Unknown Vendor',
            gstin: extracted.supplierGstin,
            stateCode: extracted.supplierGstin ? validateGstin(extracted.supplierGstin).stateCode : ws.stateCode,
            gstRegime: 'regular',
            udyamTier: 'unknown',
          };

      const itemQty = firstItem?.qty && firstItem.qty > 0 ? firstItem.qty : 1;
      const itemRate = firstItem?.unitRateRupees ?? (extracted.statedTaxableRupees ?? 0);
      const itemGst = firstItem?.gstPct ?? 18;
      const fallbackTaxable = extracted.statedTaxableRupees ?? itemRate * itemQty;
      const fallbackGst = Math.round(fallbackTaxable * (itemGst / 100) * 100) / 100;
      const statedCgst = extracted.statedCgstRupees ?? (extracted.statedIgstRupees ? 0 : fallbackGst / 2);
      const statedSgst = extracted.statedSgstRupees ?? (extracted.statedIgstRupees ? 0 : fallbackGst / 2);
      const statedIgst = extracted.statedIgstRupees ?? 0;
      const statedGrand =
        extracted.statedGrandTotalRupees ??
        fallbackTaxable + (extracted.freightRupees ?? 0) + statedCgst + statedSgst + statedIgst;

      const allHist = await db
        .select()
        .from(schema.priceHistory)
        .where(eq(schema.priceHistory.workspaceId, params.wsId))
        .orderBy(desc(schema.priceHistory.recordedAt));
      const histMap: Record<string, number> = {};
      for (const h of allHist) {
        if (!(h.itemKey in histMap)) histMap[h.itemKey] = h.netLandedUnitPaise;
      }

      const auditInput: InvoiceAuditInput = {
        invoiceNumber: extracted.invoiceNumber || `BILL-${Date.now().toString().slice(-4)}`,
        invoiceDate: extracted.invoiceDate || todayIso(),
        supplier: sup,
        supplierGstinOnBill: extracted.supplierGstin,
        irn: extracted.irn,
        hasQr: extracted.hasQr,
        items: [
          {
            itemKey: firstItem?.itemKey || 'billed-item',
            description: firstItem?.description || 'Billed Supply',
            hsnSac: firstItem?.hsnSac,
            qty: itemQty,
            unit: firstItem?.unit || 'pc',
            unitRateRupees: itemRate,
            gstPct: itemGst,
          },
        ],
        freightRupees: extracted.freightRupees ?? 0,
        freightGstPct: extracted.freightGstPct ?? undefined,
        freightGstMode: extracted.freightGstMode,
        freightAlreadyTaxInclusive: extracted.freightAlreadyTaxInclusive,
        statedTaxableRupees: fallbackTaxable,
        statedCgstRupees: statedCgst,
        statedSgstRupees: statedSgst,
        statedIgstRupees: statedIgst,
        statedRoundOffRupees: extracted.statedRoundOffRupees ?? 0,
        statedGrandTotalRupees: statedGrand,
        creditDaysAgreed: extracted.creditDays ?? supplierRecord?.creditDays ?? 30,
        hasWrittenPo: true,
        historicalUnitRatesPaise: histMap,
      };

      const audit = auditSupplierInvoice(auditInput, buyer);

      const [savedInv] = await db
        .insert(schema.invoices)
        .values({
          id: uid('inv'),
          workspaceId: params.wsId,
          supplierId: supplierRecord?.id ?? 'unassigned',
          sourceEventId: eventId,
          fileId: persistedFile?.id ?? null,
          invoiceNumber: audit.invoiceNumber,
          invoiceDate: auditInput.invoiceDate,
          supplierGstin: extracted.supplierGstin,
          irn: extracted.irn,
          itemsJson: auditInput.items,
          taxablePaise: audit.computedTaxablePaise,
          cgstPaise: toPaise(statedCgst),
          sgstPaise: toPaise(statedSgst),
          igstPaise: toPaise(statedIgst),
          grandTotalPaise: audit.statedGrandTotalPaise,
          mathReconciled: audit.mathReconciled,
          poMatchStatus: audit.poMatchStatus,
          imsSuggestedAction: audit.imsSuggestedAction,
          totalMoneyLeakPaise: audit.totalMoneyLeakPaise,
          flagsJson: audit.flags,
          cfoVerdict: audit.cfoVerdict,
          paymentDueAt: audit.paymentDueDate,
          msme43bhDueAt: audit.msme43bhDueDate,
          rule37CliffAt: audit.rule37_180DayCliffDate,
        })
        .returning();

      if (persistedFile) {
        await db
          .update(schema.storedFiles)
          .set({ invoiceId: savedInv.id, category: 'invoice' })
          .where(eq(schema.storedFiles.id, persistedFile.id));
      }

      const disputeReasons = audit.flags
        .filter((f) => f.severity !== 'info')
        .map((f) => f.title);

      if (audit.totalMoneyLeakPaise > 0) {
        suggestedOutreach = buildOutreachPackage({
          scenario: 'invoice_dispute',
          language: outreachLang,
          buyerCompany: ws.legalName,
          supplierName: sup.name,
          supplierPhone: supplierRecord?.phone,
          supplierEmail: supplierRecord?.email,
          invoiceNumber: audit.invoiceNumber,
          disputeAmountPaise: audit.totalMoneyLeakPaise,
          disputeReasons,
        });

        for (const flag of audit.flags) {
          if (flag.impactPaise > 0 && flag.severity !== 'info') {
            await db.insert(schema.moneyLeaks).values({
              id: uid('leak'),
              workspaceId: params.wsId,
              sourceEventId: eventId,
              invoiceId: savedInv.id,
              supplierId: supplierRecord?.id ?? null,
              leakType: flag.code,
              title: flag.title,
              detail: flag.detail,
              statutoryRef: flag.statutoryRef,
              amountPaise: flag.impactPaise,
              status: 'detected',
              disputeMessageDraft: suggestedOutreach.body,
            });
          }
        }
      }

      createdEntities.invoice = savedInv;
      createdEntities.audit = audit;
    } else if (intake.pillar === 'maintenance_reorder' || intake.pillar === 'daily_followup') {
      const [task] = await db
        .insert(schema.dailyTasks)
        .values({
          id: uid('tsk'),
          workspaceId: params.wsId,
          kind: intake.pillar === 'maintenance_reorder' ? 'maintenance_due' : 'chase_delivery',
          title: promptText.slice(0, 120),
          supplierId: supplierRecord?.id ?? null,
          priority: 'high',
          dueAt: extracted.deliveryDueDate || addCalendarDays(todayIso(), 2),
          suggestedMessage: buildOutreachPackage({
            scenario: 'delivery_chase',
            language: outreachLang,
            buyerCompany: ws.legalName,
            supplierName: supplierRecord?.name || 'Vendor',
            itemDescription: firstItem?.description || promptText.slice(0, 50),
          }).body,
          status: 'open',
        })
        .returning();
      createdEntities.task = task;
    }

    return {
      intake,
      sourceEvent,
      extracted,
      supplier: supplierRecord,
      created: createdEntities,
      suggestedOutreach,
      asrNote,
    };
  }

  // =========================================================================
  // UNIVERSAL PROMPT & MULTI-SOURCE CAPTURE
  // =========================================================================
  app.post('/api/prompt/ingest', async (c) => {
    const ctx = c.get('auth');
    const contentType = c.req.header('content-type') || '';
    let promptText = '';
    let channel = 'manual';
    let targetRfqId: string | null = null;
    let fileName: string | null = null;
    let fileMime: string | null = null;
    let fileBuffer: Uint8Array | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      promptText = String(form.get('prompt') || '').trim();
      channel = String(form.get('channel') || 'manual');
      targetRfqId = form.get('rfqId') ? String(form.get('rfqId')) : null;
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        fileName = file.name;
        fileMime = file.type || 'application/octet-stream';
        fileBuffer = new Uint8Array(await file.arrayBuffer());
        if (channel === 'manual') {
          if (fileMime.startsWith('audio/')) channel = 'phone';
          else if (fileMime === 'application/pdf') channel = 'pdf';
          else if (fileMime.startsWith('image/')) channel = 'whatsapp';
        }
      }
    } else {
      const body = await c.req.json<{ prompt?: string; channel?: string; rfqId?: string | null }>();
      promptText = (body.prompt || '').trim();
      channel = body.channel || 'manual';
      targetRfqId = body.rfqId ?? null;
    }

    if (!promptText && !fileBuffer) {
      return c.json({ error: 'Provide a prompt, pasted text, voice note, or file attachment.' }, 400);
    }

    const result = await runScopedIngest({
      wsId: ctx.workspaceId,
      userId: ctx.userId,
      promptText,
      channel,
      targetRfqId,
      fileName,
      fileMime,
      fileBuffer,
    });
    const db = await getDb(getEnv('DATABASE_URL'));
    await recordAuditLog(db, ctx, 'prompt_ingested', 'source_event', result.sourceEvent.id, {
      channel,
      pillar: result.intake.pillar,
      hasAttachment: Boolean(fileBuffer),
    });
    return c.json(result);
  });

  // =========================================================================
  // UNIFIED INBOX (TENANT SCOPED)
  // =========================================================================
  app.get('/api/inbox', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const events = await db
      .select()
      .from(schema.sourceEvents)
      .where(eq(schema.sourceEvents.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.sourceEvents.createdAt));
    return c.json(events);
  });

  app.patch('/api/inbox/:id/verify', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const [updated] = await db
      .update(schema.sourceEvents)
      .set({ needsVerification: false, verifiedAt: new Date() })
      .where(and(eq(schema.sourceEvents.id, id), eq(schema.sourceEvents.workspaceId, ctx.workspaceId)))
      .returning();
    if (!updated) return c.json({ error: 'Source event not found' }, 404);
    return c.json(updated);
  });

  // =========================================================================
  // BUYING & RFQs + COMPARISON + LIVE EXCEL EXPORT (TENANT SCOPED)
  // =========================================================================
  app.get('/api/rfqs', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [rfqsList, quotesList, suppliersList, wsList] = await Promise.all([
      db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, wsId)).orderBy(desc(schema.rfqs.createdAt)),
      db.select().from(schema.quotes).where(eq(schema.quotes.workspaceId, wsId)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
    ]);

    const buyer = toBuyerProfile(wsList[0]);
    const supMap = new Map(suppliersList.map((s) => [s.id, s]));

    const enriched = rfqsList.map((rfq) => {
      const rfqQuotes = quotesList.filter((q) => q.rfqId === rfq.id);
      const comparison = rankSupplierQuotes(
        rfqQuotes.map((q) => {
          const sup = supMap.get(q.supplierId);
          return {
            quoteId: q.id,
            supplier: sup
              ? toSupplierProfile(sup)
              : { id: q.supplierId, name: 'Supplier', stateCode: buyer.stateCode, gstRegime: 'regular', udyamTier: 'unknown' },
            quantity: q.quantity,
            rawRateRupees: q.rawRateRupees,
            rawUnit: q.rawUnit,
            gstPct: q.gstPct,
            isGstInclusive: q.isGstInclusive,
            freightTotalRupees: fromPaise(q.freightPaise),
            freightGstMode: q.freightGstMode as FreightGstMode,
            creditDays: q.creditDays,
            hasWrittenAgreement: true,
            leadTimeDays: q.leadTimeDays,
          };
        }),
        buyer
      );
      return { ...rfq, quotesCount: rfqQuotes.length, quotes: rfqQuotes, comparison };
    });

    return c.json(enriched);
  });

  app.post('/api/rfqs', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      title: string;
      type?: 'initial' | 'reorder' | 'maintenance';
      itemDescription: string;
      hsnSac?: string;
      qty: number;
      unit: string;
      deliveryDueAt?: string;
    }>();

    if (!body.itemDescription?.trim() || !Number.isFinite(body.qty) || body.qty <= 0) {
      return c.json({ error: 'Valid itemDescription and quantity > 0 are required.' }, 400);
    }

    const existing = await db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, ctx.workspaceId));
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(existing.length + 1).padStart(3, '0')}`;

    const [created] = await db
      .insert(schema.rfqs)
      .values({
        id: uid('rfq'),
        workspaceId: ctx.workspaceId,
        rfqNumber,
        title: (body.title || `${body.qty} ${body.itemDescription}`).trim(),
        type: body.type || 'initial',
        itemsJson: [
          {
            itemKey: body.itemDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: body.itemDescription.trim(),
            hsnSac: body.hsnSac || null,
            qty: body.qty,
            unit: body.unit || 'pc',
          },
        ],
        deliveryDueAt: body.deliveryDueAt || addCalendarDays(todayIso(), 10),
        status: 'open',
      })
      .returning();

    await recordAuditLog(db, ctx, 'rfq_created', 'rfq', created.id, {
      rfqNumber: created.rfqNumber,
      title: created.title,
    });

    return c.json(created, 201);
  });

  app.post('/api/rfqs/:id/repeat', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const [orig] = await db
      .select()
      .from(schema.rfqs)
      .where(and(eq(schema.rfqs.id, id), eq(schema.rfqs.workspaceId, ctx.workspaceId)));
    if (!orig) return c.json({ error: 'RFQ not found' }, 404);

    const all = await db.select().from(schema.rfqs).where(eq(schema.rfqs.workspaceId, ctx.workspaceId));
    const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(all.length + 1).padStart(3, '0')}`;
    const [repeated] = await db
      .insert(schema.rfqs)
      .values({
        id: uid('rfq'),
        workspaceId: ctx.workspaceId,
        rfqNumber,
        title: `${orig.title} (Reorder)`,
        type: 'reorder',
        itemsJson: orig.itemsJson,
        deliveryDueAt: addCalendarDays(todayIso(), 7),
        status: 'open',
      })
      .returning();

    return c.json(repeated, 201);
  });

  app.get('/api/rfqs/:id/export.xlsx', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const [rfq] = await db
      .select()
      .from(schema.rfqs)
      .where(and(eq(schema.rfqs.id, id), eq(schema.rfqs.workspaceId, wsId)));
    if (!rfq) return c.json({ error: 'RFQ not found' }, 404);

    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId));
    const rfqQuotes = await db
      .select()
      .from(schema.quotes)
      .where(and(eq(schema.quotes.rfqId, id), eq(schema.quotes.workspaceId, wsId)));
    const suppliersList = await db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId));
    const supMap = new Map(suppliersList.map((s) => [s.id, s]));
    const buyer = toBuyerProfile(ws);

    const comparison = rankSupplierQuotes(
      rfqQuotes.map((q) => {
        const sup = supMap.get(q.supplierId);
        return {
          quoteId: q.id,
          supplier: sup
            ? toSupplierProfile(sup)
            : { id: q.supplierId, name: 'Supplier', stateCode: buyer.stateCode, gstRegime: 'regular', udyamTier: 'unknown' },
          quantity: q.quantity,
          rawRateRupees: q.rawRateRupees,
          rawUnit: q.rawUnit,
          gstPct: q.gstPct,
          isGstInclusive: q.isGstInclusive,
          freightTotalRupees: fromPaise(q.freightPaise),
          freightGstMode: q.freightGstMode as FreightGstMode,
          creditDays: q.creditDays,
          hasWrittenAgreement: true,
          leadTimeDays: q.leadTimeDays,
        };
      }),
      buyer
    );

    const bytes = await generateLandedCostWorkbook({ title: rfq.title, buyer, ranked: comparison.ranked });

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${rfq.rfqNumber}-landed-cost.xlsx"`,
      },
    });
  });

  app.post('/api/rfqs/:id/negotiation-strategy', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const [rfq] = await db
      .select()
      .from(schema.rfqs)
      .where(and(eq(schema.rfqs.id, id), eq(schema.rfqs.workspaceId, wsId)));
    if (!rfq) return c.json({ error: 'RFQ not found' }, 404);

    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId));
    const rfqQuotes = await db
      .select()
      .from(schema.quotes)
      .where(and(eq(schema.quotes.rfqId, id), eq(schema.quotes.workspaceId, wsId)));
    if (rfqQuotes.length === 0) {
      return c.json({ error: 'No quotes recorded for this RFQ to negotiate.' }, 400);
    }

    const suppliersList = await db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId));
    const supMap = new Map(suppliersList.map((s) => [s.id, s]));

    const quoteInputs = rfqQuotes.map((q) => {
      const sup = supMap.get(q.supplierId);
      return {
        quoteId: q.id,
        supplierId: q.supplierId,
        supplierName: sup?.name || 'Supplier',
        supplierPhone: sup?.phone,
        supplierEmail: sup?.email,
        baseUnitPaise: q.baseUnitPaise,
        netLandedUnitPaise: q.netLandedUnitPaise,
        creditAdjustedUnitPaise: q.creditAdjustedUnitPaise,
        creditDays: q.effectiveCreditDays || q.creditDays || 0,
        leadTimeDays: q.leadTimeDays,
        reliabilityScore: sup?.reliabilityScore ?? 90,
        quantity: q.quantity,
        unit: q.rawUnit,
      };
    });

    const strategy = buildNegotiationStrategy(rfq.title, ws?.legalName || 'Our Company', quoteInputs);
    return c.json(strategy);
  });

  // =========================================================================
  // QUOTES (TENANT SCOPED + STRICT VALIDATION)
  // =========================================================================
  app.post('/api/quotes', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      rfqId: string;
      supplierId: string;
      quantity: number;
      rawRateRupees: number;
      rawUnit: string;
      gstPct: number;
      isGstInclusive?: boolean;
      freightRupees?: number;
      freightGstMode?: FreightGstMode;
      creditDays: number;
      leadTimeDays?: number | null;
      channel?: string;
      rawNotes?: string;
    }>();

    if (!Number.isFinite(body.quantity) || body.quantity <= 0 || !Number.isFinite(body.rawRateRupees) || body.rawRateRupees < 0) {
      return c.json({ error: 'Quantity must be > 0 and rate must be >= 0.' }, 400);
    }

    const [[ws], [sup], [rfq]] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
      db.select().from(schema.suppliers).where(and(eq(schema.suppliers.id, body.supplierId), eq(schema.suppliers.workspaceId, wsId))),
      db.select().from(schema.rfqs).where(and(eq(schema.rfqs.id, body.rfqId), eq(schema.rfqs.workspaceId, wsId))),
    ]);

    if (!sup || !rfq) return c.json({ error: 'Supplier or RFQ not found in this workspace' }, 404);
    const buyer = toBuyerProfile(ws);

    const rfqItems = (rfq.itemsJson as Array<{ itemKey?: string; description?: string; hsnSac?: string }>) || [];
    const itemKey = rfqItems[0]?.itemKey || 'item';

    const hist = await db
      .select()
      .from(schema.priceHistory)
      .where(and(eq(schema.priceHistory.workspaceId, wsId), eq(schema.priceHistory.itemKey, itemKey)))
      .orderBy(desc(schema.priceHistory.recordedAt))
      .limit(1);

    const breakdown = computeLandedCost(
      {
        quoteId: 'new',
        supplier: toSupplierProfile(sup),
        quantity: body.quantity,
        rawRateRupees: body.rawRateRupees,
        rawUnit: body.rawUnit || 'pc',
        gstPct: body.gstPct,
        isGstInclusive: body.isGstInclusive,
        freightTotalRupees: body.freightRupees ?? 0,
        freightGstMode: body.freightGstMode ?? 'composite_supply',
        creditDays: body.creditDays,
        hasWrittenAgreement: true,
        leadTimeDays: body.leadTimeDays,
        hsnOrItemText: rfqItems[0]?.hsnSac || rfqItems[0]?.description || rfq.title,
        historicalBenchmarkLandedPaise: hist[0]?.netLandedUnitPaise ?? null,
      },
      buyer
    );

    const [evt] = await db
      .insert(schema.sourceEvents)
      .values({
        id: uid('evt'),
        workspaceId: wsId,
        channel: body.channel || 'manual',
        pillar: 'quote_capture',
        supplierId: sup.id,
        rfqId: rfq.id,
        rawContent: body.rawNotes || `${sup.name} quoted ₹${body.rawRateRupees}/${body.rawUnit} (+${body.gstPct}% GST, ${body.creditDays}d credit)`,
        parsedSummary: `${sup.name}: ${formatINR(breakdown.creditAdjustedRealUnitPaise)}/${breakdown.canonicalUnit} real cost (${breakdown.effectiveCreditDaysUsed}d credit)`,
        confidenceScore: 1.0,
        needsVerification: false,
      })
      .returning();

    const [quote] = await db
      .insert(schema.quotes)
      .values({
        id: uid('qt'),
        workspaceId: wsId,
        rfqId: rfq.id,
        supplierId: sup.id,
        sourceEventId: evt.id,
        quantity: body.quantity,
        rawRateRupees: body.rawRateRupees,
        rawUnit: body.rawUnit || 'pc',
        normalizationNote: breakdown.normalizationNote,
        baseUnitPaise: breakdown.baseUnitPaise,
        gstPct: body.gstPct,
        isGstInclusive: Boolean(body.isGstInclusive),
        freightPaise: toPaise(body.freightRupees ?? 0),
        freightGstMode: body.freightGstMode ?? 'composite_supply',
        creditDays: body.creditDays,
        effectiveCreditDays: breakdown.effectiveCreditDaysUsed,
        leadTimeDays: body.leadTimeDays ?? null,
        netLandedUnitPaise: breakdown.netLandedUnitPaise,
        creditAdjustedUnitPaise: breakdown.creditAdjustedRealUnitPaise,
        priceDeltaPct: breakdown.priceDeltaPct,
        flagsJson: breakdown.flags,
        evidenceJson: [],
        needsVerification: false,
      })
      .returning();

    await db.update(schema.rfqs).set({ status: 'comparing' }).where(and(eq(schema.rfqs.id, rfq.id), eq(schema.rfqs.workspaceId, wsId)));

    await recordAuditLog(db, ctx, 'quote_logged', 'quote', quote.id, {
      rfqId: rfq.id,
      supplierId: sup.id,
      creditAdjustedUnitPaise: quote.creditAdjustedUnitPaise,
    });

    return c.json({ quote, breakdown }, 201);
  });

  // =========================================================================
  // GST PURCHASE ORDERS (OWNER-GATED + IDEMPOTENCY 409 + PERSISTENT PDF VAULT)
  // =========================================================================
  app.get('/api/pos', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [pos, suppliersList, grnsList] = await Promise.all([
      db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, wsId)).orderBy(desc(schema.purchaseOrders.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
      db.select().from(schema.grnReceipts).where(eq(schema.grnReceipts.workspaceId, wsId)).orderBy(desc(schema.grnReceipts.createdAt)),
    ]);
    const supMap = new Map(suppliersList.map((s) => [s.id, s]));
    return c.json(
      pos.map((p) => {
        const poGrns = grnsList.filter((g) => g.poId === p.id);
        const poItems = (p.itemsJson as Array<{ qty?: number }>) || [];
        const orderedQty = poItems.reduce((s, it) => s + (it.qty || 0), 0);
        const cumulativeAcceptedQty = poGrns.reduce((sum, g) => {
          const items = (g.itemsJson as Array<{ acceptedQty?: number }>) || [];
          return sum + items.reduce((s, x) => s + (x.acceptedQty || 0), 0);
        }, 0);
        return {
          ...p,
          supplier: supMap.get(p.supplierId) ?? null,
          grns: poGrns,
          orderedQty,
          cumulativeAcceptedQty,
        };
      })
    );
  });

  app.post('/api/pos/approve', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Owner role required to issue legally binding GST Purchase Orders.' }, 403);
    }
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      quoteId: string;
      approvedBy: string;
      deliveryDueAt?: string;
      explicitApprovalConfirmed: boolean;
    }>();

    if (!body.explicitApprovalConfirmed) {
      return c.json({ error: 'Explicit human approval confirmation is required before issuing a GST PO.' }, 403);
    }

    const [quote] = await db
      .select()
      .from(schema.quotes)
      .where(and(eq(schema.quotes.id, body.quoteId), eq(schema.quotes.workspaceId, wsId)));
    if (!quote) return c.json({ error: 'Quote not found in this workspace' }, 404);

    // P0 Idempotency Guard: Prevent duplicate GST POs for the same quote!
    const existingForQuote = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.quoteId, quote.id), eq(schema.purchaseOrders.workspaceId, wsId)))
      .limit(1);
    if (existingForQuote.length > 0) {
      return c.json(
        { error: `Purchase Order ${existingForQuote[0].poNumber} already issued for this quote.`, existingPo: existingForQuote[0] },
        409
      );
    }

    const [[ws], [sup], [rfq], existingPos] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
      db.select().from(schema.suppliers).where(and(eq(schema.suppliers.id, quote.supplierId), eq(schema.suppliers.workspaceId, wsId))),
      db.select().from(schema.rfqs).where(and(eq(schema.rfqs.id, quote.rfqId), eq(schema.rfqs.workspaceId, wsId))),
      db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, wsId)),
    ]);
    if (!sup) return c.json({ error: 'Supplier not found' }, 404);

    const buyer = toBuyerProfile(ws);
    const rfqItems = (rfq?.itemsJson as Array<{ itemKey?: string; description?: string; hsnSac?: string }>) || [];
    const descText = rfqItems[0]?.description || rfq?.title || 'Procurement Supply';
    const hsnSac = rfqItems[0]?.hsnSac || null;

    const goodsTaxablePaise = Math.round(quote.baseUnitPaise * quote.quantity);
    const totalTaxablePaise = goodsTaxablePaise + quote.freightPaise;
    const gstCalc = computeGstLine({
      taxablePaise: totalTaxablePaise,
      gstRatePct: quote.gstPct,
      buyer,
      supplier: toSupplierProfile(sup),
      hsnOrItemText: hsnSac || descText,
    });

    const poNumber = `PO-${new Date().getFullYear()}-${String(existingPos.length + 101).padStart(4, '0')}`;
    const poDate = todayIso();
    const deliveryDueAt = body.deliveryDueAt || rfq?.deliveryDueAt || addCalendarDays(poDate, quote.leadTimeDays ?? 7);
    const paymentTermsDays = quote.effectiveCreditDays;
    const paymentDueAt = addCalendarDays(deliveryDueAt, paymentTermsDays);

    const poItems = [
      {
        itemKey: rfqItems[0]?.itemKey || descText.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: descText,
        hsnSac,
        qty: quote.quantity,
        unit: quote.rawUnit,
        unitRatePaise: quote.baseUnitPaise,
        gstPct: quote.gstPct,
        taxablePaise: goodsTaxablePaise,
      },
    ];

    const [po] = await db
      .insert(schema.purchaseOrders)
      .values({
        id: uid('po'),
        workspaceId: wsId,
        rfqId: quote.rfqId,
        quoteId: quote.id,
        supplierId: sup.id,
        poNumber,
        poDate,
        itemsJson: poItems,
        freightPaise: quote.freightPaise,
        taxablePaise: totalTaxablePaise,
        cgstPaise: gstCalc.cgstPaise,
        sgstPaise: gstCalc.sgstPaise,
        igstPaise: gstCalc.igstPaise,
        totalPaise: gstCalc.grandTotalPaise,
        paymentTermsDays,
        deliveryDueAt,
        paymentDueAt,
        invoiceStatus: 'pending',
        approvedBy: body.approvedBy || ctx.email,
      })
      .returning();

    // Generate & retain GST PO PDF in persistent R2 / vault storage
    let pdfFileId: string | null = null;
    try {
      const pdfBytes = await generateGstPoPdf({
        poNumber: po.poNumber,
        poDate: po.poDate,
        deliveryDueDate: po.deliveryDueAt,
        paymentTermsDays: po.paymentTermsDays,
        buyer,
        supplier: {
          name: sup.name,
          gstin: sup.gstin,
          stateCode: sup.stateCode,
          phone: sup.phone,
          email: sup.email,
          udyamTier: sup.udyamTier,
        },
        items: poItems,
        freightPaise: po.freightPaise,
        taxableTotalPaise: po.taxablePaise,
        cgstPaise: po.cgstPaise,
        sgstPaise: po.sgstPaise,
        igstPaise: po.igstPaise,
        grandTotalPaise: po.totalPaise,
      });
      const storedPdf = await persistWorkspaceFile({
        db,
        storage: storageInstance,
        workspaceId: wsId,
        uploadedByUserId: ctx.userId,
        fileName: `${po.poNumber}.pdf`,
        mimeType: 'application/pdf',
        bytes: new Uint8Array(pdfBytes),
        category: 'po_pdf',
        poId: po.id,
      });
      pdfFileId = storedPdf.id;
      await db
        .update(schema.purchaseOrders)
        .set({ pdfFileId })
        .where(and(eq(schema.purchaseOrders.id, po.id), eq(schema.purchaseOrders.workspaceId, wsId)));
    } catch {
      // Non-fatal: GET /api/pos/:id/pdf can regenerate on demand
    }

    if (rfq) {
      await db.update(schema.rfqs).set({ status: 'po_issued' }).where(and(eq(schema.rfqs.id, rfq.id), eq(schema.rfqs.workspaceId, wsId)));
    }

    await db.insert(schema.priceHistory).values({
      id: uid('ph'),
      workspaceId: wsId,
      itemKey: poItems[0].itemKey,
      itemDescription: descText,
      supplierId: sup.id,
      netLandedUnitPaise: quote.netLandedUnitPaise,
      unit: quote.rawUnit,
    });

    const outreachLang = (ws.defaultOutreachLang || 'english') as OutreachLanguage;
    const chaseDraft = buildOutreachPackage({
      scenario: 'delivery_chase',
      language: outreachLang,
      buyerCompany: ws.legalName,
      supplierName: sup.name,
      supplierPhone: sup.phone,
      supplierEmail: sup.email,
      poNumber,
      itemDescription: descText,
      dueDate: deliveryDueAt,
    });

    await db.insert(schema.dailyTasks).values({
      id: uid('tsk'),
      workspaceId: wsId,
      kind: 'chase_delivery',
      title: `Confirm dispatch for ${poNumber} — ${sup.name} (${descText})`,
      supplierId: sup.id,
      relatedId: po.id,
      priority: 'medium',
      dueAt: deliveryDueAt,
      suggestedMessage: chaseDraft.body,
      status: 'open',
    });

    const poOutreach = buildOutreachPackage({
      scenario: 'po_issued',
      language: outreachLang,
      buyerCompany: ws.legalName,
      supplierName: sup.name,
      supplierPhone: sup.phone,
      supplierEmail: sup.email,
      poNumber,
      itemDescription: descText,
      quantity: quote.quantity,
      unit: quote.rawUnit,
      creditDays: paymentTermsDays,
      dueDate: deliveryDueAt,
    });

    await recordAuditLog(db, ctx, 'po_approved', 'purchase_order', po.id, {
      poNumber,
      totalPaise: po.totalPaise,
      supplierId: sup.id,
      pdfFileId,
    });

    return c.json({ po: { ...po, pdfFileId }, outreach: poOutreach }, 201);
  });

  app.get('/api/pos/:id/pdf', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const [po] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.workspaceId, wsId)));
    if (!po) return c.json({ error: 'PO not found' }, 404);

    // Serve retained PDF from persistent R2 / vault storage if available
    if (po.pdfFileId) {
      const [fileRow] = await db
        .select()
        .from(schema.storedFiles)
        .where(
          and(
            eq(schema.storedFiles.id, po.pdfFileId),
            eq(schema.storedFiles.workspaceId, wsId),
            isNull(schema.storedFiles.deletedAt)
          )
        )
        .limit(1);
      if (fileRow) {
        const storedBytes = await storageInstance.getObject(fileRow.storageKey);
        if (storedBytes) {
          return new Response(new Uint8Array(storedBytes), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `inline; filename="${po.poNumber}.pdf"`,
              'X-Kraya-Storage': fileRow.storageProvider,
            },
          });
        }
      }
    }

    const [[ws], [sup]] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
      db.select().from(schema.suppliers).where(and(eq(schema.suppliers.id, po.supplierId), eq(schema.suppliers.workspaceId, wsId))),
    ]);

    const pdfBytes = await generateGstPoPdf({
      poNumber: po.poNumber,
      poDate: po.poDate,
      deliveryDueDate: po.deliveryDueAt,
      paymentTermsDays: po.paymentTermsDays,
      buyer: toBuyerProfile(ws),
      supplier: {
        name: sup?.name || 'Supplier',
        gstin: sup?.gstin,
        stateCode: sup?.stateCode,
        phone: sup?.phone,
        email: sup?.email,
        udyamTier: sup?.udyamTier,
      },
      items: po.itemsJson as Array<{
        description: string;
        hsnSac?: string | null;
        qty: number;
        unit: string;
        unitRatePaise: number;
        gstPct: number;
        taxablePaise: number;
      }>,
      freightPaise: po.freightPaise,
      taxableTotalPaise: po.taxablePaise,
      cgstPaise: po.cgstPaise,
      sgstPaise: po.sgstPaise,
      igstPaise: po.igstPaise,
      grandTotalPaise: po.totalPaise,
    });

    return new Response(new Uint8Array(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${po.poNumber}.pdf"`,
      },
    });
  });

  // =========================================================================
  // INVOICES & MONEY LEAK RADAR (TENANT SCOPED + DUPLICATE 409 GUARD)
  // =========================================================================
  app.get('/api/invoices', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [invs, sups, cns] = await Promise.all([
      db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)).orderBy(desc(schema.invoices.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
      db.select().from(schema.creditNotes).where(eq(schema.creditNotes.workspaceId, wsId)).orderBy(desc(schema.creditNotes.createdAt)),
    ]);
    const supMap = new Map(sups.map((s) => [s.id, s]));
    return c.json(
      invs.map((i) => {
        const invCns = cns.filter((cn) => cn.invoiceId === i.id);
        const totalCreditedPaise = invCns.reduce((s, cn) => s + cn.totalPaise, 0);
        return {
          ...i,
          supplier: supMap.get(i.supplierId) ?? null,
          creditNotes: invCns,
          totalCreditedPaise,
          netPayablePaise: Math.max(0, i.grandTotalPaise - totalCreditedPaise),
        };
      })
    );
  });

  app.post('/api/invoices/audit', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      poId?: string | null;
      supplierId: string;
      invoiceNumber: string;
      invoiceDate: string;
      supplierGstinOnBill?: string | null;
      irn?: string | null;
      hasQr?: boolean;
      itemKey: string;
      description: string;
      hsnSac?: string | null;
      qty: number;
      unit: string;
      unitRateRupees: number;
      gstPct: number;
      freightRupees?: number;
      freightGstPct?: number;
      freightGstMode?: FreightGstMode;
      freightAlreadyTaxInclusive?: boolean;
      statedTaxableRupees: number;
      statedCgstRupees: number;
      statedSgstRupees: number;
      statedIgstRupees: number;
      statedGrandTotalRupees: number;
    }>();

    if (!body.invoiceNumber?.trim() || !Number.isFinite(body.qty) || body.qty <= 0 || body.unitRateRupees < 0) {
      return c.json({ error: 'Valid invoiceNumber, qty > 0, and rate >= 0 are required.' }, 400);
    }

    const dup = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.workspaceId, wsId),
          eq(schema.invoices.supplierId, body.supplierId),
          eq(schema.invoices.invoiceNumber, body.invoiceNumber.trim())
        )
      )
      .limit(1);
    if (dup.length > 0) {
      return c.json(
        { error: `Invoice ${body.invoiceNumber} from this supplier was already audited.`, existingInvoice: dup[0] },
        409
      );
    }

    const [[ws], [sup]] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
      db.select().from(schema.suppliers).where(and(eq(schema.suppliers.id, body.supplierId), eq(schema.suppliers.workspaceId, wsId))),
    ]);
    if (!sup) return c.json({ error: 'Supplier not found in this workspace' }, 404);
    const buyer = toBuyerProfile(ws);

    let poItemsRef = undefined;
    let grnAcceptedQtyForItem: number | null = null;
    let cumulativeBilledQtyBefore = 0;
    let latestGrnAcceptedDate: string | null = null;

    if (body.poId) {
      const [po] = await db
        .select()
        .from(schema.purchaseOrders)
        .where(and(eq(schema.purchaseOrders.id, body.poId), eq(schema.purchaseOrders.workspaceId, wsId)));
      if (!po) {
        return c.json({ error: 'Linked Purchase Order not found in this workspace.' }, 404);
      }
      if (po.supplierId !== body.supplierId) {
        return c.json(
          { error: `PO supplier mismatch: PO ${po.poNumber} belongs to a different supplier and cannot be matched to this invoice.` },
          400
        );
      }
      if (po.invoiceStatus === 'cancelled') {
        return c.json(
          { error: `PO ${po.poNumber} is cancelled and cannot accept invoices.` },
          400
        );
      }

      // Fetch prior invoices & GRNs on this PO for cumulative partial-delivery 3-way match!
      const [priorPoInvoices, poGrns] = await Promise.all([
        db
          .select()
          .from(schema.invoices)
          .where(and(eq(schema.invoices.poId, po.id), eq(schema.invoices.workspaceId, wsId))),
        db
          .select()
          .from(schema.grnReceipts)
          .where(and(eq(schema.grnReceipts.poId, po.id), eq(schema.grnReceipts.workspaceId, wsId))),
      ]);

      const priorBilledByKey = new Map<string, number>();
      for (const prevInv of priorPoInvoices) {
        const prevItems = (prevInv.itemsJson as Array<{ itemKey?: string; description?: string; qty?: number }>) || [];
        for (const pi of prevItems) {
          const k = pi.itemKey || (pi.description || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          priorBilledByKey.set(k, (priorBilledByKey.get(k) || 0) + (pi.qty || 0));
        }
      }
      cumulativeBilledQtyBefore = priorBilledByKey.get(body.itemKey) || 0;

      if (poGrns.length > 0) {
        let acceptedSum = 0;
        for (const g of poGrns) {
          if (!latestGrnAcceptedDate || g.acceptedDate > latestGrnAcceptedDate) {
            latestGrnAcceptedDate = g.acceptedDate;
          }
          const gItems = (g.itemsJson as Array<{ itemKey?: string; acceptedQty?: number }>) || [];
          for (const gi of gItems) {
            if (!gi.itemKey || gi.itemKey === body.itemKey) {
              acceptedSum += gi.acceptedQty || 0;
            }
          }
        }
        grnAcceptedQtyForItem = acceptedSum;
      }

      const items = po.itemsJson as Array<{ itemKey: string; description: string; qty: number; unitRatePaise: number; gstPct: number }>;
      poItemsRef = items.map((i) => {
        const prevBilled = priorBilledByKey.get(i.itemKey) || 0;
        return {
          itemKey: i.itemKey,
          description: i.description,
          agreedQty: Math.max(0, i.qty - prevBilled),
          agreedUnitRateRupees: fromPaise(i.unitRatePaise),
          agreedGstPct: i.gstPct,
        };
      });
    }

    const hist = await db
      .select()
      .from(schema.priceHistory)
      .where(and(eq(schema.priceHistory.workspaceId, wsId), eq(schema.priceHistory.itemKey, body.itemKey)))
      .orderBy(desc(schema.priceHistory.recordedAt))
      .limit(1);

    const audit = auditSupplierInvoice(
      {
        invoiceNumber: body.invoiceNumber.trim(),
        invoiceDate: body.invoiceDate,
        supplier: toSupplierProfile(sup),
        supplierGstinOnBill: body.supplierGstinOnBill ?? sup.gstin,
        irn: body.irn,
        hasQr: body.hasQr,
        items: [
          {
            itemKey: body.itemKey,
            description: body.description,
            hsnSac: body.hsnSac,
            qty: body.qty,
            unit: body.unit,
            unitRateRupees: body.unitRateRupees,
            gstPct: body.gstPct,
          },
        ],
        freightRupees: body.freightRupees ?? 0,
        freightGstPct: body.freightGstPct,
        freightGstMode: body.freightGstMode ?? 'composite_supply',
        freightAlreadyTaxInclusive: Boolean(body.freightAlreadyTaxInclusive),
        statedTaxableRupees: body.statedTaxableRupees,
        statedCgstRupees: body.statedCgstRupees,
        statedSgstRupees: body.statedSgstRupees,
        statedIgstRupees: body.statedIgstRupees,
        statedGrandTotalRupees: body.statedGrandTotalRupees,
        creditDaysAgreed: sup.creditDays,
        hasWrittenPo: Boolean(body.poId),
        poItems: poItemsRef,
        historicalUnitRatesPaise: hist[0] ? { [body.itemKey]: hist[0].netLandedUnitPaise } : undefined,
      },
      buyer
    );

    // GRN 3-Way Physical Receipt Guard: catch billing more than cumulative GRN accepted qty!
    if (grnAcceptedQtyForItem !== null) {
      const totalBilledWithCurrent = cumulativeBilledQtyBefore + body.qty;
      if (totalBilledWithCurrent > grnAcceptedQtyForItem) {
        const excessOverGrn = totalBilledWithCurrent - grnAcceptedQtyForItem;
        const alreadyCountedExcess = audit.flags
          .filter((f) => f.code === 'po_qty_short_shipment')
          .reduce((s, f) => s + f.impactPaise, 0);
        const grnLeakPaise = Math.max(0, Math.round(excessOverGrn * toPaise(body.unitRateRupees)) - alreadyCountedExcess);
        audit.flags.push({
          code: 'grn_short_receipt_overbill',
          severity: 'critical',
          title: `Billed Qty Exceeds GRN Accepted Qty (${totalBilledWithCurrent} billed vs ${grnAcceptedQtyForItem} accepted)`,
          detail: `Cumulative invoiced qty (${totalBilledWithCurrent}) exceeds physically accepted GRN qty (${grnAcceptedQtyForItem}) by ${excessOverGrn} ${body.unit}. Hold payment for unaccepted/rejected goods.`,
          impactPaise: grnLeakPaise,
          statutoryRef: '3-Way Match Control (PO vs. GRN vs. Invoice)',
          recommendedAction: 'Hold payment & request Credit Note for unaccepted/short-delivered quantity.',
        });
        audit.totalMoneyLeakPaise += grnLeakPaise;
        audit.poMatchStatus = 'mismatch';
        audit.imsSuggestedAction = 'REJECT';
      } else {
        // GRN-verified valid partial delivery: downgrade pure short-qty mismatch to 'partial'
        const nonShortFlags = audit.flags.filter(
          (f) => !(f.code === 'po_qty_short_shipment' && f.severity === 'warning' && f.impactPaise === 0)
        );
        if (audit.poMatchStatus === 'mismatch' && nonShortFlags.every((f) => f.severity === 'info')) {
          audit.poMatchStatus = 'partial';
          audit.imsSuggestedAction = 'ACCEPT';
        }
      }
    }

    // Anchor MSME Section 43B(h) deadline to GRN acceptedDate (Section 2(b) MSMED Act) when GRNs exist
    if (latestGrnAcceptedDate && audit.msme43bhDueDate) {
      const msmeDays = body.poId ? Math.min(sup.creditDays || 45, 45) : 15;
      audit.msme43bhDueDate = addCalendarDays(latestGrnAcceptedDate, msmeDays);
    }

    const [savedInv] = await db
      .insert(schema.invoices)
      .values({
        id: uid('inv'),
        workspaceId: wsId,
        poId: body.poId ?? null,
        supplierId: sup.id,
        invoiceNumber: audit.invoiceNumber,
        invoiceDate: body.invoiceDate,
        supplierGstin: body.supplierGstinOnBill ?? sup.gstin,
        irn: body.irn ?? null,
        itemsJson: [{ itemKey: body.itemKey, description: body.description, qty: body.qty, unit: body.unit, unitRateRupees: body.unitRateRupees, gstPct: body.gstPct }],
        taxablePaise: audit.computedTaxablePaise,
        cgstPaise: toPaise(body.statedCgstRupees),
        sgstPaise: toPaise(body.statedSgstRupees),
        igstPaise: toPaise(body.statedIgstRupees),
        grandTotalPaise: audit.statedGrandTotalPaise,
        mathReconciled: audit.mathReconciled,
        poMatchStatus: audit.poMatchStatus,
        imsSuggestedAction: audit.imsSuggestedAction,
        totalMoneyLeakPaise: audit.totalMoneyLeakPaise,
        flagsJson: audit.flags,
        cfoVerdict: audit.cfoVerdict,
        paymentDueAt: audit.paymentDueDate,
        msme43bhDueAt: audit.msme43bhDueDate,
        rule37CliffAt: audit.rule37_180DayCliffDate,
      })
      .returning();

    if (body.poId) {
      await db
        .update(schema.purchaseOrders)
        .set({ invoiceStatus: audit.poMatchStatus === 'mismatch' ? 'mismatch' : 'matched' })
        .where(and(eq(schema.purchaseOrders.id, body.poId), eq(schema.purchaseOrders.workspaceId, wsId)));
    }

    const outreach =
      audit.totalMoneyLeakPaise > 0
        ? buildOutreachPackage({
            scenario: 'invoice_dispute',
            language: (ws.defaultOutreachLang || 'english') as OutreachLanguage,
            buyerCompany: ws.legalName,
            supplierName: sup.name,
            supplierPhone: sup.phone,
            supplierEmail: sup.email,
            invoiceNumber: audit.invoiceNumber,
            disputeAmountPaise: audit.totalMoneyLeakPaise,
            disputeReasons: audit.flags.filter((f) => f.severity !== 'info').map((f) => f.title),
          })
        : null;

    for (const flag of audit.flags) {
      if (flag.impactPaise > 0 && flag.severity !== 'info') {
        await db.insert(schema.moneyLeaks).values({
          id: uid('leak'),
          workspaceId: wsId,
          invoiceId: savedInv.id,
          supplierId: sup.id,
          leakType: flag.code,
          title: flag.title,
          detail: flag.detail,
          statutoryRef: flag.statutoryRef,
          amountPaise: flag.impactPaise,
          status: 'detected',
          disputeMessageDraft: outreach?.body ?? null,
        });
      }
    }

    if (audit.msme43bhDueDate) {
      await db.insert(schema.dailyTasks).values({
        id: uid('tsk'),
        workspaceId: wsId,
        kind: 'payment_43bh',
        title: `MSME 43B(h) Tax Shield: Pay ${sup.name} (${audit.invoiceNumber}) before ${audit.msme43bhDueDate}`,
        supplierId: sup.id,
        relatedId: savedInv.id,
        priority: 'high',
        dueAt: audit.msme43bhDueDate,
        status: 'open',
      });
    }

    await recordAuditLog(db, ctx, 'invoice_audited', 'invoice', savedInv.id, {
      invoiceNumber: savedInv.invoiceNumber,
      poId: body.poId ?? null,
      poMatchStatus: audit.poMatchStatus,
      imsSuggestedAction: audit.imsSuggestedAction,
      totalMoneyLeakPaise: audit.totalMoneyLeakPaise,
      msme43bhDueDate: audit.msme43bhDueDate,
    });

    return c.json({ invoice: savedInv, audit, outreach }, 201);
  });

  app.get('/api/leaks', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [leaks, sups] = await Promise.all([
      db.select().from(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, wsId)).orderBy(desc(schema.moneyLeaks.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
    ]);
    const supMap = new Map(sups.map((s) => [s.id, s]));
    return c.json(leaks.map((l) => ({ ...l, supplier: l.supplierId ? supMap.get(l.supplierId) ?? null : null })));
  });

  app.patch('/api/leaks/:id', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const body = await c.req.json<{ status: 'detected' | 'disputed' | 'recovered' | 'dismissed' }>();
    const [updated] = await db
      .update(schema.moneyLeaks)
      .set({
        status: body.status,
        resolvedAt: body.status === 'recovered' || body.status === 'dismissed' ? new Date() : null,
      })
      .where(and(eq(schema.moneyLeaks.id, id), eq(schema.moneyLeaks.workspaceId, ctx.workspaceId)))
      .returning();
    if (!updated) return c.json({ error: 'Money leak not found' }, 404);
    return c.json(updated);
  });

  // =========================================================================
  // SUPPLIERS BOOK (100% TENANT SCOPED)
  // =========================================================================
  app.get('/api/suppliers', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const list = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.suppliers.createdAt));
    return c.json(list);
  });

  app.post('/api/suppliers', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      name: string;
      phone?: string;
      email?: string;
      category?: string;
      gstin?: string;
      stateCode?: string;
      gstRegime?: GstRegime;
      udyamNumber?: string;
      udyamTier?: UdyamTier;
      eInvoiceRequired?: boolean;
      creditDays?: number;
      notes?: string;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'Supplier name is required.' }, 400);

    let gstinMeta = null;
    if (body.gstin?.trim()) {
      gstinMeta = validateGstin(body.gstin);
      if (!gstinMeta.valid) {
        return c.json({ error: 'Invalid Supplier GSTIN', details: gstinMeta.errors }, 400);
      }
    }

    const [created] = await db
      .insert(schema.suppliers)
      .values({
        id: uid('sup'),
        workspaceId: ctx.workspaceId,
        name: body.name.trim(),
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        category: body.category || 'General',
        gstin: gstinMeta?.normalized ?? null,
        stateCode: gstinMeta?.stateCode ?? body.stateCode ?? '29',
        gstRegime: body.gstRegime || 'regular',
        panEntityType: gstinMeta?.panEntityCode ?? null,
        udyamNumber: body.udyamNumber?.trim() || null,
        udyamTier: body.udyamTier || 'unknown',
        eInvoiceRequired: Boolean(body.eInvoiceRequired),
        creditDays: body.creditDays ?? 30,
        notes: body.notes || null,
      })
      .returning();

    await recordAuditLog(db, ctx, 'supplier_created', 'supplier', created.id, {
      name: created.name,
      gstin: created.gstin,
      udyamTier: created.udyamTier,
    });

    return c.json(created, 201);
  });

  app.get('/api/suppliers/:id/timeline', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');

    const [sup] = await db
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.workspaceId, wsId)));
    if (!sup) return c.json({ error: 'Supplier not found' }, 404);

    const [events, quotesList, posList, invsList, histList] = await Promise.all([
      db.select().from(schema.sourceEvents).where(and(eq(schema.sourceEvents.supplierId, id), eq(schema.sourceEvents.workspaceId, wsId))).orderBy(desc(schema.sourceEvents.createdAt)),
      db.select().from(schema.quotes).where(and(eq(schema.quotes.supplierId, id), eq(schema.quotes.workspaceId, wsId))).orderBy(desc(schema.quotes.createdAt)),
      db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.supplierId, id), eq(schema.purchaseOrders.workspaceId, wsId))).orderBy(desc(schema.purchaseOrders.createdAt)),
      db.select().from(schema.invoices).where(and(eq(schema.invoices.supplierId, id), eq(schema.invoices.workspaceId, wsId))).orderBy(desc(schema.invoices.createdAt)),
      db.select().from(schema.priceHistory).where(and(eq(schema.priceHistory.supplierId, id), eq(schema.priceHistory.workspaceId, wsId))).orderBy(desc(schema.priceHistory.recordedAt)),
    ]);
    return c.json({ events, quotes: quotesList, purchaseOrders: posList, invoices: invsList, priceHistory: histList });
  });

  // REAL-TIME SUPPLIER SEARCH & DISCOVERY ENGINE (HYPER-GROUNDED WITH GEMINI FLASH LITE)
  app.post('/api/suppliers/discover', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
    const buyerProfile = ws ? toBuyerProfile(ws) : null;

    const body = await c.req.json<{
      query: string;
      category?: string;
      buyerCity?: string;
      buyerPincode?: string;
      buyerStateCode?: string;
      targetRateMaxRupees?: number;
      minCreditDays?: number;
      specificCriteria?: string;
    }>();

    if (!body.query?.trim()) {
      return c.json({ error: 'Search query is required' }, 400);
    }

    const apiKey = getEnv('GEMINI_API_KEY');
    const model = getEnv('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
    const googleMapsApiKey = getEnv('GOOGLE_MAPS_API_KEY');
    const openCorporatesApiKey = getEnv('OPENCORPORATES_API_KEY');

    const discovery = await searchSuppliersRealtime(
      {
        query: body.query.trim(),
        category: body.category,
        buyerCity: body.buyerCity || 'Bengaluru',
        buyerPincode: body.buyerPincode || '560058',
        buyerStateCode: body.buyerStateCode || buyerProfile?.stateCode || '29',
        targetRateMaxRupees: body.targetRateMaxRupees,
        minCreditDays: body.minCreditDays,
        buyerWaccPct: buyerProfile?.waccPct ?? 14.0,
        specificCriteria: body.specificCriteria,
        googleMapsApiKey,
        openCorporatesApiKey,
      },
      apiKey,
      model
    );

    return c.json(discovery);
  });

  // FREE LIVE MARKET CURRENCY & COMMODITY BENCHMARK
  app.get('/api/market/fx-rates', async (c) => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (res.ok) {
        const data = await res.json() as { rates?: Record<string, number>; time_last_update_utc?: string };
        return c.json({
          base: 'USD',
          inrRate: data.rates?.INR || 93.37,
          updatedAt: data.time_last_update_utc || new Date().toISOString(),
          rates: data.rates,
        });
      }
    } catch {
      // fallback
    }
    return c.json({
      base: 'USD',
      inrRate: 93.37,
      updatedAt: new Date().toISOString(),
      rates: { INR: 93.37 },
    });
  });

  // =========================================================================
  // MAINTENANCE, AMC & DAILY TASKS (100% TENANT SCOPED)
  // =========================================================================
  app.get('/api/tasks', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [tasks, sups] = await Promise.all([
      db.select().from(schema.dailyTasks).where(eq(schema.dailyTasks.workspaceId, wsId)).orderBy(desc(schema.dailyTasks.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
    ]);
    const supMap = new Map(sups.map((s) => [s.id, s]));
    return c.json(tasks.map((t) => ({ ...t, supplier: t.supplierId ? supMap.get(t.supplierId) ?? null : null })));
  });

  app.post('/api/tasks', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      kind: string;
      title: string;
      supplierId?: string | null;
      priority?: string;
      dueAt: string;
      suggestedMessage?: string;
    }>();
    const [created] = await db
      .insert(schema.dailyTasks)
      .values({
        id: uid('tsk'),
        workspaceId: ctx.workspaceId,
        kind: body.kind,
        title: body.title,
        supplierId: body.supplierId ?? null,
        priority: body.priority || 'medium',
        dueAt: body.dueAt,
        suggestedMessage: body.suggestedMessage ?? null,
        status: 'open',
      })
      .returning();
    await recordAuditLog(db, ctx, 'task_created', 'daily_task', created.id, {
      kind: created.kind,
      title: created.title,
    });

    return c.json(created, 201);
  });

  app.patch('/api/tasks/:id', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const id = c.req.param('id');
    const body = await c.req.json<{ status: 'open' | 'done' | 'snoozed' }>();
    const [updated] = await db
      .update(schema.dailyTasks)
      .set({ status: body.status })
      .where(and(eq(schema.dailyTasks.id, id), eq(schema.dailyTasks.workspaceId, ctx.workspaceId)))
      .returning();
    if (!updated) return c.json({ error: 'Task not found' }, 404);
    return c.json(updated);
  });

  app.get('/api/amc', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [amcs, sups] = await Promise.all([
      db.select().from(schema.amcSchedules).where(eq(schema.amcSchedules.workspaceId, wsId)).orderBy(desc(schema.amcSchedules.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
    ]);
    const supMap = new Map(sups.map((s) => [s.id, s]));
    return c.json(amcs.map((a) => ({ ...a, supplier: a.supplierId ? supMap.get(a.supplierId) ?? null : null })));
  });

  app.post('/api/amc', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      assetName: string;
      supplierId?: string | null;
      frequencyDays: number;
      nextDueAt: string;
      lastRateRupees?: number;
      notes?: string;
    }>();
    const [created] = await db
      .insert(schema.amcSchedules)
      .values({
        id: uid('amc'),
        workspaceId: ctx.workspaceId,
        assetName: body.assetName,
        supplierId: body.supplierId ?? null,
        frequencyDays: body.frequencyDays || 90,
        nextDueAt: body.nextDueAt,
        lastRatePaise: body.lastRateRupees ? toPaise(body.lastRateRupees) : null,
        notes: body.notes ?? null,
      })
      .returning();

    await db.insert(schema.dailyTasks).values({
      id: uid('tsk'),
      workspaceId: ctx.workspaceId,
      kind: 'maintenance_due',
      title: `AMC / Spares Due: ${body.assetName}`,
      supplierId: body.supplierId ?? null,
      relatedId: created.id,
      priority: 'medium',
      dueAt: body.nextDueAt,
      status: 'open',
    });

    await recordAuditLog(db, ctx, 'amc_created', 'amc_schedule', created.id, {
      assetName: created.assetName,
      nextDueAt: created.nextDueAt,
    });

    return c.json(created, 201);
  });

  // =========================================================================
  // OUTREACH DRAFTS, ELEVENLABS VOICE NOTES & CODE-GATED LIVE SEND
  // =========================================================================
  app.post('/api/outreach/draft', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
    const body = await c.req.json<{
      scenario: OutreachScenario;
      language: OutreachLanguage;
      supplierName: string;
      supplierPhone?: string | null;
      supplierEmail?: string | null;
      itemDescription?: string;
      quantity?: number;
      unit?: string;
      targetRatePaise?: number;
      quotedRatePaise?: number;
      poNumber?: string;
      invoiceNumber?: string;
      disputeAmountPaise?: number;
      disputeReasons?: string[];
      dueDate?: string;
      creditDays?: number;
    }>();

    return c.json(buildOutreachPackage({ ...body, buyerCompany: ws.legalName }));
  });

  app.post('/api/outreach/voice', async (c) => {
    const ctx = c.get('auth');
    const body = await c.req.json<{
      text?: string;
      language?: string;
      voiceId?: string;
      modelId?: string;
      useMyVoice?: boolean;
    }>();
    const cleanText = (body.text || '').trim();
    if (!cleanText) return c.json({ error: 'Message text is required.' }, 400);
    if (cleanText.length > 1500) {
      return c.json({ error: 'Voice notes are limited to 1,500 characters. Shorten the message.' }, 400);
    }

    const elevenKey = getEnv('ELEVENLABS_API_KEY');
    const vsBase = getEnv('VOICESTUDIO_BASE_URL');
    const wantsOwnVoice = body.useMyVoice !== false;
    const clone = resolveVoiceStudioVoice({
      language: body.language,
      voiceMapJson: getEnv('VOICESTUDIO_VOICE_MAP'),
      fallbackVoiceId: getEnv('VOICESTUDIO_VOICE_ID'),
    });

    let ownVoiceError: string | null = null;
    if (wantsOwnVoice && vsBase && clone) {
      try {
        const seedRaw = Number(getEnv('VOICESTUDIO_SEED'));
        const result = await synthesizeVoiceStudioVoiceNote({
          baseUrl: vsBase,
          apiKey: getEnv('VOICESTUDIO_API_KEY'),
          text: cleanText,
          voiceId: clone.voiceId,
          language: body.language,
          model: getEnv('VOICESTUDIO_MODEL'),
          format: 'opus',
          seed: Number.isFinite(seedRaw) && getEnv('VOICESTUDIO_SEED') ? seedRaw : undefined,
        });
        const db = await getDb(getEnv('DATABASE_URL'));
        // Only a preview is generated here; sending still requires the human approval gate.
        await recordAuditLog(db, ctx, 'voice_note_generated', 'outreach', null, {
          provider: 'voicestudio_own_voice',
          language: body.language ?? null,
          matchedVoiceLanguage: clone.matchedLanguage,
          chars: cleanText.length,
        });
        return new Response(new Uint8Array(result.audio), {
          headers: {
            'Content-Type': result.mimeType,
            'Content-Disposition': 'inline; filename="kraya-voice-note.ogg"',
            'X-Kraya-Voice-Provider': 'voicestudio_own_voice',
            'X-Kraya-Voice-Language': clone.matchedLanguage,
          },
        });
      } catch (err) {
        ownVoiceError = `Your cloned voice is unavailable (${sanitizeErrorMessage(err).slice(0, 120)}).`;
        if (!elevenKey) return c.json({ error: `${ownVoiceError} Is VoiceStudio running?` }, 502);
      }
    }

    if (!elevenKey) {
      return c.json(
        {
          error:
            wantsOwnVoice && !clone
              ? 'No cloned voice configured. Run `pnpm voice:setup` to clone your voice, or add ELEVENLABS_API_KEY.'
              : 'Configure VoiceStudio (VOICESTUDIO_BASE_URL) or ELEVENLABS_API_KEY in .env to generate voice notes.',
        },
        400
      );
    }

    const mp3Bytes = await synthesizeElevenLabsVoiceNote({
      apiKey: elevenKey,
      text: cleanText,
      voiceId: body.voiceId || getEnv('ELEVENLABS_VOICE_ID'),
      modelId: body.modelId || getEnv('ELEVENLABS_TTS_MODEL'),
    });

    return new Response(new Uint8Array(mp3Bytes), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline; filename="kraya-vendor-voice-note.mp3"',
        'X-Kraya-Voice-Provider': 'elevenlabs_stock_voice',
        ...(ownVoiceError ? { 'X-Kraya-Voice-Fallback-Reason': ownVoiceError.slice(0, 200) } : {}),
      },
    });
  });

  // =========================================================================
  // BROWSER-DIRECT OWN-VOICE RECORDING, FFMPEG MASTERING & VOICESTUDIO CLONE
  // =========================================================================
  app.get('/api/voice/status', async (c) => {
    const vsBase = getEnv('VOICESTUDIO_BASE_URL') || 'http://localhost:3900';
    const reachable = await checkVoiceStudioHealth({
      baseUrl: vsBase,
      apiKey: getEnv('VOICESTUDIO_API_KEY'),
    });
    let voiceMap: Record<string, string> = {};
    try {
      const raw = getEnv('VOICESTUDIO_VOICE_MAP');
      if (raw) voiceMap = JSON.parse(raw);
    } catch {
      voiceMap = {};
    }
    const masteredLanguages: string[] = [];
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.resolve(process.cwd(), 'data', 'voice-profiles');
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          const m = f.match(/^mastered-([a-z]+)\.wav$/);
          if (m) masteredLanguages.push(m[1]);
        }
      }
    } catch {
      // ignore on edge runtimes without local fs
    }
    return c.json({
      baseUrl: vsBase,
      reachable,
      defaultVoiceId: getEnv('VOICESTUDIO_VOICE_ID') || voiceMap.default || null,
      voiceMap,
      masteredLanguages,
      calibrationScripts: VOICE_CALIBRATION_SCRIPTS,
    });
  });

  app.get('/api/voice/reference/:lang', async (c) => {
    const lang = (c.req.param('lang') || 'hinglish').toLowerCase().replace(/[^a-z]/g, '');
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const wavPath = path.resolve(process.cwd(), 'data', 'voice-profiles', `mastered-${lang}.wav`);
      if (!fs.existsSync(wavPath)) {
        return c.json({ error: `No mastered reference clip for ${lang} yet.` }, 404);
      }
      const bytes = fs.readFileSync(wavPath);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Disposition': `inline; filename="mastered-${lang}.wav"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      return c.json({ error: sanitizeErrorMessage(err) }, 500);
    }
  });

  app.post('/api/voice/clone', async (c) => {
    const ctx = c.get('auth');
    const form = await c.req.formData();
    const file = form.get('audio');
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Please record or attach an audio clip.' }, 400);
    }
    const lang = String(form.get('language') || 'hinglish')
      .toLowerCase()
      .replace(/[^a-z]/g, '') || 'hinglish';
    const refText =
      String(form.get('refText') || '').trim() ||
      VOICE_CALIBRATION_SCRIPTS[lang] ||
      VOICE_CALIBRATION_SCRIPTS.default;

    const rawBytes = new Uint8Array(await file.arrayBuffer());
    if (rawBytes.byteLength < 1000) {
      return c.json({ error: 'Recording is too short. Please record 7–12 seconds of clear speech.' }, 400);
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const cp = await import('node:child_process');
    const dir = path.resolve(process.cwd(), 'data', 'voice-profiles');
    fs.mkdirSync(dir, { recursive: true });

    const ext = (file.name.split('.').pop() || 'webm').replace(/[^a-z0-9]/gi, '') || 'webm';
    const rawPath = path.join(dir, `raw-${lang}-${Date.now()}.${ext}`);
    const masteredPath = path.join(dir, `mastered-${lang}.wav`);
    fs.writeFileSync(rawPath, rawBytes);

    let masteredWithFfmpeg = false;
    try {
      cp.execFileSync(
        'ffmpeg',
        [
          '-y',
          '-i',
          rawPath,
          '-af',
          'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,silenceremove=start_periods=1:start_silence=0.15:start_threshold=-45dB',
          '-ar',
          '24000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          masteredPath,
        ],
        { stdio: 'ignore' }
      );
      masteredWithFfmpeg = true;
    } catch {
      fs.copyFileSync(rawPath, masteredPath);
    }
    try {
      fs.unlinkSync(rawPath);
    } catch {
      // ignore
    }

    const masteredBytes = new Uint8Array(fs.readFileSync(masteredPath));
    const vsBase = getEnv('VOICESTUDIO_BASE_URL') || 'http://localhost:3900';
    const vsApiKey = getEnv('VOICESTUDIO_API_KEY');
    const reachable = await checkVoiceStudioHealth({ baseUrl: vsBase, apiKey: vsApiKey });

    let profileId: string | null = null;
    let voiceStudioSynced = false;
    let syncError: string | null = null;

    let voiceMap: Record<string, string> = {};
    try {
      const existing = getEnv('VOICESTUDIO_VOICE_MAP');
      if (existing) voiceMap = JSON.parse(existing);
    } catch {
      voiceMap = {};
    }

    if (reachable) {
      try {
        const created = await createVoiceStudioCloneProfile({
          baseUrl: vsBase,
          apiKey: vsApiKey,
          name: `Kraya Owner (${lang})`,
          wavBytes: masteredBytes,
          refText,
          language: lang,
        });
        profileId = created.profileId;
        voiceStudioSynced = true;
        voiceMap[lang] = profileId;
        if (!voiceMap.default) voiceMap.default = profileId;

        if (typeof process !== 'undefined' && process.env) {
          process.env.VOICESTUDIO_BASE_URL = vsBase;
          process.env.VOICESTUDIO_VOICE_ID = voiceMap.default;
          process.env.VOICESTUDIO_VOICE_MAP = JSON.stringify(voiceMap);
          process.env.VOICESTUDIO_SEED = '42';
        }

        // Persist into .env file on disk so restarts preserve the clone
        const envPath = path.resolve(process.cwd(), '.env');
        let envContent = fs.existsSync(envPath)
          ? fs.readFileSync(envPath, 'utf8')
          : fs.existsSync(`${envPath}.example`)
            ? fs.readFileSync(`${envPath}.example`, 'utf8')
            : '';
        const upsert = (k: string, v: string) => {
          const re = new RegExp(`^${k}=.*$`, 'm');
          if (re.test(envContent)) envContent = envContent.replace(re, `${k}=${v}`);
          else envContent = `${envContent.trimEnd()}\n${k}=${v}\n`;
        };
        upsert('VOICESTUDIO_BASE_URL', vsBase);
        upsert('VOICESTUDIO_VOICE_ID', voiceMap.default);
        upsert('VOICESTUDIO_VOICE_MAP', JSON.stringify(voiceMap));
        upsert('VOICESTUDIO_SEED', '42');
        fs.writeFileSync(envPath, envContent, 'utf8');
      } catch (err) {
        syncError = sanitizeErrorMessage(err);
      }
    }

    const db = await getDb(getEnv('DATABASE_URL'));
    await recordAuditLog(db, ctx, 'voice_clone_recorded', 'workspace', ctx.workspaceId, {
      language: lang,
      masteredWithFfmpeg,
      voiceStudioSynced,
      profileId,
    });

    return c.json({
      ok: true,
      language: lang,
      masteredWithFfmpeg,
      masteredWavPath: `data/voice-profiles/mastered-${lang}.wav`,
      referenceAudioUrl: `/api/voice/reference/${lang}?t=${Date.now()}`,
      voiceStudioReachable: reachable,
      voiceStudioSynced,
      profileId,
      voiceMap,
      syncError,
    });
  });

  app.post('/api/outreach/send-live', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      channel: 'whatsapp_cloud_api' | 'resend_email';
      explicitApprovalConfirmed: boolean;
      toPhone?: string;
      toEmail?: string;
      subject?: string;
      bodyText: string;
    }>();

    if (!body.explicitApprovalConfirmed) {
      return c.json({ error: 'Explicit human approval confirmation required before live external send.' }, 403);
    }

    if (body.channel === 'whatsapp_cloud_api') {
      const accessToken = getEnv('WHATSAPP_ACCESS_TOKEN');
      const phoneNumberId = getEnv('WHATSAPP_PHONE_NUMBER_ID');
      if (!accessToken || !phoneNumberId) {
        return c.json({ error: 'WhatsApp Cloud API credentials not configured in .env.' }, 400);
      }
      const receipt = await sendViaWhatsAppCloudApi({
        accessToken,
        phoneNumberId,
        toPhone: body.toPhone || '',
        bodyText: body.bodyText,
      });
      await recordAuditLog(db, ctx, 'live_send', 'whatsapp_cloud_api', receipt.providerMessageId, { toPhone: body.toPhone });
      return c.json(receipt);
    }

    const resendKey = getEnv('RESEND_API_KEY');
    const fromEmail = getEnv('RESEND_FROM_EMAIL') || 'procurement@kraya.in';
    if (!resendKey) {
      return c.json({ error: 'RESEND_API_KEY not configured in .env.' }, 400);
    }
    const receipt = await sendViaResendEmail({
      apiKey: resendKey,
      fromEmail,
      toEmail: body.toEmail || '',
      subject: body.subject || 'Procurement Message',
      bodyText: body.bodyText,
    });
    await recordAuditLog(db, ctx, 'live_send', 'resend_email', receipt.providerMessageId, { toEmail: body.toEmail });
    return c.json(receipt);
  });

  // =========================================================================
  // PHASE 13 — GSTR-2B / IMS RECONCILIATION & CFO SPEND INTELLIGENCE
  // =========================================================================
  app.post('/api/gst/gstr2b-reconcile', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));

    const body = await c.req.json<{
      payload: string | Record<string, unknown> | unknown[];
      tolerancePaise?: number;
      format?: 'json' | 'csv';
    }>();

    if (!body.payload) {
      return c.json({ error: 'GSTR-2B JSON or CSV payload is required.' }, 400);
    }

    let gstr2bEntries;
    try {
      gstr2bEntries = parseGstr2bPayload(body.payload);
    } catch (err) {
      return c.json(
        { error: `Invalid GSTR-2B payload format: ${err instanceof Error ? err.message : 'parse failed'}` },
        400
      );
    }

    const [invs, sups, grns] = await Promise.all([
      db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)).orderBy(desc(schema.invoices.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
      db.select().from(schema.grnReceipts).where(eq(schema.grnReceipts.workspaceId, wsId)),
    ]);

    const supMap = new Map(sups.map((s) => [s.id, s]));
    const grnAcceptedPoIds = new Set(
      grns.filter((g) => g.qcStatus === 'accepted' || g.qcStatus === 'partial').map((g) => g.poId)
    );

    const bookRecords: BookInvoiceRecord[] = invs.map((inv) => {
      const sup = supMap.get(inv.supplierId);
      const gstPaise = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
      const grnAccepted = inv.poId ? grnAcceptedPoIds.has(inv.poId) || inv.poMatchStatus === 'clean' : true;
      return {
        id: inv.id,
        supplierId: inv.supplierId,
        supplierName: sup?.name || 'Supplier',
        supplierPhone: sup?.phone ?? null,
        supplierGstin: inv.supplierGstin ?? sup?.gstin ?? null,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        taxablePaise: inv.taxablePaise,
        gstPaise,
        grandTotalPaise: inv.grandTotalPaise,
        auditStatus: inv.poMatchStatus === 'mismatch' || inv.imsSuggestedAction === 'REJECT' ? 'mismatch' : inv.poMatchStatus,
        grnAccepted,
      };
    });

    const summary = reconcileGstr2b(bookRecords, gstr2bEntries, {
      tolerancePaise: typeof body.tolerancePaise === 'number' ? Math.max(0, Math.round(body.tolerancePaise)) : 100,
    });

    if (body.format === 'csv') {
      const csv = exportImsActionCsv(summary);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="kraya-ims-actions-${todayIso()}.csv"`,
        },
      });
    }

    return c.json(summary);
  });

  app.get('/api/analytics/cfo-intelligence', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));

    const [invs, pos, sups, leaks, history] = await Promise.all([
      db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)),
      db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workspaceId, wsId)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
      db.select().from(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, wsId)),
      db.select().from(schema.priceHistory).where(eq(schema.priceHistory.workspaceId, wsId)),
    ]);

    const supMap = new Map(sups.map((s) => [s.id, s]));

    // 1. Totals (strict integer paise)
    const activePos = pos.filter((p) => !p.cancelledAt);
    const totalPoSpendPaise = activePos.reduce((acc, p) => acc + p.totalPaise, 0);
    const totalInvoicedPaise = invs.reduce((acc, i) => acc + i.grandTotalPaise, 0);
    const totalGstPaidPaise = invs.reduce((acc, i) => acc + i.cgstPaise + i.sgstPaise + i.igstPaise, 0);
    const totalLeaksDetectedPaise = leaks.reduce((acc, l) => acc + l.amountPaise, 0);
    const totalLeaksRecoveredPaise = leaks
      .filter((l) => l.status === 'recovered' || l.status === 'resolved')
      .reduce((acc, l) => acc + l.amountPaise, 0);

    // 2. Spend by Category & Top Suppliers
    const categoryTotals = new Map<string, number>();
    const supplierTotals = new Map<string, { supplierId: string; name: string; category: string; spendPaise: number; invoiceCount: number }>();

    for (const inv of invs) {
      const sup = supMap.get(inv.supplierId);
      const cat = sup?.category || 'General';
      categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + inv.grandTotalPaise);

      const cur = supplierTotals.get(inv.supplierId) || {
        supplierId: inv.supplierId,
        name: sup?.name || 'Supplier',
        category: cat,
        spendPaise: 0,
        invoiceCount: 0,
      };
      cur.spendPaise += inv.grandTotalPaise;
      cur.invoiceCount += 1;
      supplierTotals.set(inv.supplierId, cur);
    }

    const spendByCategory = [...categoryTotals.entries()]
      .map(([category, spendPaise]) => ({ category, spendPaise }))
      .sort((a, b) => b.spendPaise - a.spendPaise);

    const topSuppliers = [...supplierTotals.values()]
      .sort((a, b) => b.spendPaise - a.spendPaise)
      .slice(0, 8);

    // 3. Price-Creep Radar (compare earliest vs latest recorded landed unit rate per itemKey+supplier)
    const groupedHistory = new Map<string, typeof history>();
    for (const row of history) {
      const k = `${row.itemKey}::${row.supplierId}`;
      const arr = groupedHistory.get(k) || [];
      arr.push(row);
      groupedHistory.set(k, arr);
    }

    const priceCreepAlerts: Array<{
      itemDescription: string;
      supplierName: string;
      unit: string;
      baselineUnitPaise: number;
      latestUnitPaise: number;
      deltaPct: number;
      observations: number;
    }> = [];

    for (const rows of groupedHistory.values()) {
      if (rows.length < 2) continue;
      const sorted = [...rows].sort(
        (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      );
      const first = sorted[0];
      const latest = sorted[sorted.length - 1];
      if (first.netLandedUnitPaise <= 0) continue;
      const deltaPct =
        Math.round(((latest.netLandedUnitPaise - first.netLandedUnitPaise) / first.netLandedUnitPaise) * 1000) / 10;
      if (deltaPct >= 2.0) {
        priceCreepAlerts.push({
          itemDescription: latest.itemDescription,
          supplierName: supMap.get(latest.supplierId)?.name || 'Supplier',
          unit: latest.unit,
          baselineUnitPaise: first.netLandedUnitPaise,
          latestUnitPaise: latest.netLandedUnitPaise,
          deltaPct,
          observations: sorted.length,
        });
      }
    }
    priceCreepAlerts.sort((a, b) => b.deltaPct - a.deltaPct);

    // 4. MSME Section 43B(h) & Rule 37 Payment Cliff
    const todayMs = new Date(`${todayIso()}T00:00:00Z`).getTime();
    const paymentCliffs = invs
      .filter((inv) => !inv.paidAt && (inv.msme43bhDueAt || inv.rule37CliffAt || inv.paymentDueAt))
      .map((inv) => {
        const sup = supMap.get(inv.supplierId);
        const msmeDays = inv.msme43bhDueAt
          ? Math.ceil((new Date(`${inv.msme43bhDueAt}T00:00:00Z`).getTime() - todayMs) / 86400000)
          : null;
        const rule37Days = inv.rule37CliffAt
          ? Math.ceil((new Date(`${inv.rule37CliffAt}T00:00:00Z`).getTime() - todayMs) / 86400000)
          : null;
        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplierName: sup?.name || 'Supplier',
          udyamTier: sup?.udyamTier || 'unknown',
          grandTotalPaise: inv.grandTotalPaise,
          msme43bhDueAt: inv.msme43bhDueAt,
          msmeDaysRemaining: msmeDays,
          rule37CliffAt: inv.rule37CliffAt,
          rule37DaysRemaining: rule37Days,
          urgency:
            (msmeDays !== null && msmeDays <= 7) || (rule37Days !== null && rule37Days <= 15)
              ? 'critical'
              : (msmeDays !== null && msmeDays <= 15) || (rule37Days !== null && rule37Days <= 30)
                ? 'warning'
                : 'normal',
        };
      })
      .sort((a, b) => {
        const da = a.msmeDaysRemaining ?? a.rule37DaysRemaining ?? 999;
        const db = b.msmeDaysRemaining ?? b.rule37DaysRemaining ?? 999;
        return da - db;
      });

    return c.json({
      totals: {
        totalPoSpendPaise,
        totalInvoicedPaise,
        totalGstPaidPaise,
        totalLeaksDetectedPaise,
        totalLeaksRecoveredPaise,
        openLeaksPaise: Math.max(0, totalLeaksDetectedPaise - totalLeaksRecoveredPaise),
      },
      spendByCategory,
      topSuppliers,
      priceCreepAlerts,
      paymentCliffs,
    });
  });

  // =========================================================================
  // TALLY PRIME XML & CA MONTHLY AUDIT PACK (100% TENANT SCOPED)
  // =========================================================================
  app.get('/api/exports/tally.xml', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [[ws], invs, sups] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
      db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)).orderBy(desc(schema.invoices.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
    ]);
    const supMap = new Map(sups.map((s) => [s.id, s]));

    const safeInvoices = invs.filter((i) => i.imsSuggestedAction !== 'REJECT');
    const xml = generateTallyPurchaseXml({
      buyerCompany: ws.legalName,
      vouchers: safeInvoices.map((inv) => {
        const sup = supMap.get(inv.supplierId);
        return {
          voucherNumber: inv.invoiceNumber,
          dateIso: inv.invoiceDate,
          supplierName: sup?.name || 'Sundry Creditor',
          supplierGstin: inv.supplierGstin ?? sup?.gstin ?? null,
          narration: `Kraya Verified (${inv.poMatchStatus.toUpperCase()} · IMS: ${inv.imsSuggestedAction})`,
          taxablePaise: inv.taxablePaise,
          cgstPaise: inv.cgstPaise,
          sgstPaise: inv.sgstPaise,
          igstPaise: inv.igstPaise,
          grandTotalPaise: inv.grandTotalPaise,
        };
      }),
    });

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="kraya-tally-vouchers-${todayIso()}.xml"`,
      },
    });
  });

  app.get('/api/exports/ca-audit-pack.xlsx', async (c) => {
    const ctx = c.get('auth');
    const wsId = ctx.workspaceId;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [[ws], invs, leaks, sups] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, wsId)),
      db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, wsId)).orderBy(desc(schema.invoices.createdAt)),
      db.select().from(schema.moneyLeaks).where(eq(schema.moneyLeaks.workspaceId, wsId)).orderBy(desc(schema.moneyLeaks.createdAt)),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.workspaceId, wsId)),
    ]);
    const supMap = new Map(sups.map((s) => [s.id, s]));

    const bytes = await generateMonthlyCaAuditPack({
      buyer: toBuyerProfile(ws),
      invoices: invs.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        supplierName: supMap.get(i.supplierId)?.name || 'Unknown Supplier',
        supplierGstin: i.supplierGstin,
        irn: i.irn,
        taxablePaise: i.taxablePaise,
        cgstPaise: i.cgstPaise,
        sgstPaise: i.sgstPaise,
        igstPaise: i.igstPaise,
        grandTotalPaise: i.grandTotalPaise,
        poMatchStatus: i.poMatchStatus,
        imsSuggestedAction: i.imsSuggestedAction,
        totalMoneyLeakPaise: i.totalMoneyLeakPaise,
        msme43bhDueAt: i.msme43bhDueAt,
        rule37CliffAt: i.rule37CliffAt,
        cfoVerdict: i.cfoVerdict,
      })),
      leaks: leaks.map((l) => ({
        title: l.title,
        supplierName: l.supplierId ? supMap.get(l.supplierId)?.name || 'Unknown' : 'General',
        leakType: l.leakType,
        statutoryRef: l.statutoryRef,
        amountPaise: l.amountPaise,
        status: l.status,
      })),
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="kraya-ca-gst-ims-pack-${todayIso()}.xlsx"`,
      },
    });
  });

  // =========================================================================
  // FAIL-CLOSED LIVE WEBHOOKS (META HMAC-SHA256 + REPLAY PROTECTION + TENANT ROUTING)
  // =========================================================================
  async function resolveWebhookWorkspaceId(headerWsId: string | undefined): Promise<string | null> {
    const candidate = headerWsId?.trim() || getEnv('WEBHOOK_DEFAULT_WORKSPACE_ID')?.trim() || '';
    if (!candidate) return null;
    const db = await getDb(getEnv('DATABASE_URL'));
    const [ws] = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, candidate))
      .limit(1);
    return ws ? ws.id : null;
  }

  function isTimestampWithinReplayWindow(tsHeader: string | undefined): boolean {
    if (!tsHeader) return true; // Optional unless sender includes it
    const tsSec = Number(tsHeader);
    if (!Number.isFinite(tsSec)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.abs(nowSec - tsSec) <= 300; // ±5 minutes
  }

  async function recordWebhookReceiptOrDetectReplay(
    provider: string,
    externalId: string | null | undefined,
    workspaceId: string
  ): Promise<boolean> {
    if (!externalId) return false;
    const db = await getDb(getEnv('DATABASE_URL'));
    const existing = await db
      .select({ id: schema.webhookReceipts.id })
      .from(schema.webhookReceipts)
      .where(
        and(
          eq(schema.webhookReceipts.provider, provider),
          eq(schema.webhookReceipts.externalId, externalId)
        )
      )
      .limit(1);
    if (existing.length > 0) return true; // Replay detected!
    await db.insert(schema.webhookReceipts).values({
      id: uid('whr'),
      provider,
      externalId,
      workspaceId,
    });
    return false;
  }

  app.get('/api/webhooks/whatsapp', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    const expected = getEnv('WHATSAPP_VERIFY_TOKEN');
    if (expected && mode === 'subscribe' && token === expected && challenge) {
      return c.text(challenge, 200);
    }
    return c.text('Forbidden', 403);
  });

  app.post('/api/webhooks/whatsapp', async (c) => {
    const appSecret = getEnv('WHATSAPP_APP_SECRET');
    const rawBody = await c.req.text();
    const sigHeader = c.req.header('x-hub-signature-256');
    const verified = await verifyMetaWebhookSignature(rawBody, sigHeader, appSecret);
    if (!verified) {
      return c.json({ error: 'Invalid or missing Meta X-Hub-Signature-256 webhook signature.' }, 401);
    }
    if (!isTimestampWithinReplayWindow(c.req.header('x-kraya-webhook-timestamp'))) {
      return c.json({ error: 'Webhook timestamp outside allowed ±5 minute replay window.' }, 401);
    }

    const targetWsId = await resolveWebhookWorkspaceId(c.req.header('x-kraya-workspace-id'));
    if (!targetWsId) {
      return c.json({ error: 'Valid x-kraya-workspace-id header (or WEBHOOK_DEFAULT_WORKSPACE_ID) required.' }, 400);
    }

    const deliveryIdHeader = c.req.header('x-kraya-delivery-id') || c.req.header('x-hub-delivery');
    if (deliveryIdHeader && (await recordWebhookReceiptOrDetectReplay('whatsapp', deliveryIdHeader, targetWsId))) {
      return c.json({ ok: true, duplicateIgnored: true, duplicatesIgnored: 1 }, 200);
    }

    const payload = JSON.parse(rawBody);
    const normalized = parseWhatsAppCloudWebhook(payload);
    const ingested: string[] = [];
    let duplicatesIgnored = 0;

    for (const msg of normalized) {
      const isReplay = await recordWebhookReceiptOrDetectReplay(
        'whatsapp',
        msg.externalMessageId,
        targetWsId
      );
      if (isReplay) {
        duplicatesIgnored++;
        continue;
      }
      const res = await runScopedIngest({
        wsId: targetWsId,
        userId: null,
        channel: 'whatsapp',
        promptText: msg.senderPhone ? `${msg.text} (Phone: ${msg.senderPhone})` : msg.text,
        targetRfqId: null,
        fileName: null,
        fileMime: null,
        fileBuffer: null,
      });
      ingested.push(res.sourceEvent.id);
    }

    if (normalized.length > 0 && duplicatesIgnored === normalized.length) {
      return c.json(
        {
          ok: true,
          duplicateIgnored: true,
          received: normalized.length,
          ingestedEventIds: [],
          duplicatesIgnored,
        },
        200
      );
    }

    return c.json({
      ok: true,
      received: normalized.length,
      ingestedEventIds: ingested,
      duplicatesIgnored,
    });
  });

  app.post('/api/webhooks/email-inbound', async (c) => {
    const secret = getEnv('INBOUND_WEBHOOK_SECRET');
    if (!secret || c.req.header('x-kraya-webhook-secret') !== secret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-webhook-secret required.' }, 401);
    }
    if (!isTimestampWithinReplayWindow(c.req.header('x-kraya-webhook-timestamp'))) {
      return c.json({ error: 'Webhook timestamp outside allowed ±5 minute replay window.' }, 401);
    }

    const targetWsId = await resolveWebhookWorkspaceId(c.req.header('x-kraya-workspace-id'));
    if (!targetWsId) {
      return c.json({ error: 'Valid x-kraya-workspace-id header (or WEBHOOK_DEFAULT_WORKSPACE_ID) required.' }, 400);
    }

    const body = await c.req.json<{
      messageId?: string;
      fromName?: string;
      fromEmail?: string;
      subject?: string;
      text?: string;
    }>();

    const deliveryId =
      c.req.header('x-kraya-delivery-id') ||
      c.req.header('message-id') ||
      body.messageId ||
      null;
    if (await recordWebhookReceiptOrDetectReplay('email', deliveryId, targetWsId)) {
      return c.json({ ok: true, duplicateIgnored: true });
    }

    const combined = [
      body.fromName ? `From: ${body.fromName}.` : body.fromEmail ? `From: ${body.fromEmail}.` : '',
      body.subject ? `Subject: ${body.subject}.` : '',
      body.text || '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await runScopedIngest({
      wsId: targetWsId,
      userId: null,
      channel: 'email',
      promptText: combined,
      targetRfqId: null,
      fileName: null,
      fileMime: null,
      fileBuffer: null,
    });
    return c.json({ ok: true, ingested: result });
  });

  app.post('/api/webhooks/call-recording', async (c) => {
    const secret = getEnv('INBOUND_WEBHOOK_SECRET');
    if (!secret || c.req.header('x-kraya-webhook-secret') !== secret) {
      return c.json({ error: 'Unauthorized: valid x-kraya-webhook-secret required.' }, 401);
    }
    if (!isTimestampWithinReplayWindow(c.req.header('x-kraya-webhook-timestamp'))) {
      return c.json({ error: 'Webhook timestamp outside allowed ±5 minute replay window.' }, 401);
    }

    const targetWsId = await resolveWebhookWorkspaceId(c.req.header('x-kraya-workspace-id'));
    if (!targetWsId) {
      return c.json({ error: 'Valid x-kraya-workspace-id header (or WEBHOOK_DEFAULT_WORKSPACE_ID) required.' }, 400);
    }

    const deliveryId =
      c.req.header('x-kraya-delivery-id') || c.req.header('message-id') || null;
    if (await recordWebhookReceiptOrDetectReplay('call', deliveryId, targetWsId)) {
      return c.json({ ok: true, duplicateIgnored: true });
    }

    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      const file = form.get('file');
      const fileObj = file && typeof file !== 'string' ? file : null;
      const result = await runScopedIngest({
        wsId: targetWsId,
        userId: null,
        channel: 'phone',
        promptText: String(form.get('prompt') || ''),
        targetRfqId: null,
        fileName: fileObj?.name ?? null,
        fileMime: fileObj?.type ?? null,
        fileBuffer: fileObj ? new Uint8Array(await fileObj.arrayBuffer()) : null,
      });
      return c.json(result);
    }
    const body = await c.req.json<{ callerName?: string; callerPhone?: string; transcript?: string }>();
    const combined = `${body.callerName ? `From: ${body.callerName}. ` : ''}${body.transcript || ''}${body.callerPhone ? ` (Phone: ${body.callerPhone})` : ''}`;
    const result = await runScopedIngest({
      wsId: targetWsId,
      userId: null,
      channel: 'phone',
      promptText: combined,
      targetRfqId: null,
      fileName: null,
      fileMime: null,
      fileBuffer: null,
    });
    return c.json(result);
  });

  return app;
}
