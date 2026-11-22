import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getAppliedMigrations, getDb, getDbMode } from './db/client.js';
import { hmacSha256Hex } from './auth.js';
import type { AppHelpers, AppVariables } from './context.js';

export function registerNeonRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  const { getEnv } = helpers;

  const resolveFunctionUrl = (fnName = 'hello'): string => {
    const branchId = getEnv('NEON_BRANCH_ID') || 'br-withered-fog-a1k4obmo';
    const rawSuffix = getEnv('NEON_FUNCTION_HOST_SUFFIX') || '.compute.ap-southeast-1.aws.neon.tech';
    // Neon function URLs on c-1 cluster use .compute.c-1.<region>.aws.neon.tech
    const normalizedSuffix = rawSuffix.includes('.compute.c-1.')
      ? rawSuffix
      : rawSuffix.replace('.compute.', '.compute.c-1.');
    return `https://${branchId}-${fnName}${normalizedSuffix}/`;
  };

  // 1. Lakebase Postgres verification endpoint
  app.get('/api/neon/postgres', async (c) => {
    const dbUrl = getEnv('DATABASE_URL');
    const unpooledUrl = getEnv('DATABASE_URL_UNPOOLED');
    const db = await getDb(dbUrl);
    const metaRes = await db.execute(
      sql.raw(`
        SELECT
          version() AS pg_version,
          current_database() AS db_name,
          pg_current_xact_id()::text AS current_txid,
          (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS public_tables,
          (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'neon_auth') AS neon_auth_tables
      `)
    );
    const rows =
      (metaRes as unknown as { rows?: Array<Record<string, unknown>> })?.rows ??
      (Array.isArray(metaRes) ? (metaRes as Array<Record<string, unknown>>) : []);
    const row = rows[0] ?? {};

    return c.json({
      ok: true,
      service: 'neon-postgres',
      driver: '@neondatabase/serverless + drizzle-orm/neon-http',
      dbMode: getDbMode(),
      pooledConfigured: Boolean(dbUrl && dbUrl.includes('-pooler')),
      unpooledConfigured: Boolean(unpooledUrl),
      branch: getEnv('NEON_BRANCH') || 'production',
      branchId: getEnv('NEON_BRANCH_ID') || null,
      database: row.db_name ?? 'neondb',
      pgVersion: row.pg_version ?? null,
      currentTxId: row.current_txid ?? null,
      publicTablesCount: Number(row.public_tables ?? 0),
      neonAuthTablesCount: Number(row.neon_auth_tables ?? 0),
      appliedMigrations: getAppliedMigrations(),
    });
  });

  // 2. Neon Auth (Managed Better Auth) verification endpoint
  app.get('/api/neon/auth', async (c) => {
    const baseUrl = getEnv('NEON_AUTH_BASE_URL');
    const jwksUrl = getEnv('NEON_AUTH_JWKS_URL');
    if (!baseUrl || !jwksUrl) {
      return c.json({ ok: false, service: 'neon-auth', error: 'NEON_AUTH_BASE_URL or NEON_AUTH_JWKS_URL missing' }, 503);
    }

    const jwksRes = await fetch(jwksUrl);
    const jwksData = (await jwksRes.json().catch(() => ({}))) as {
      keys?: Array<{ kid?: string; alg?: string; crv?: string; kty?: string }>;
    };

    const db = await getDb(getEnv('DATABASE_URL'));
    const authTablesRes = await db.execute(
      sql.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'neon_auth'
        ORDER BY table_name ASC
      `)
    );
    const tableRows =
      (authTablesRes as unknown as { rows?: Array<{ table_name: string }> })?.rows ??
      (Array.isArray(authTablesRes) ? (authTablesRes as Array<{ table_name: string }>) : []);

    return c.json({
      ok: jwksRes.ok && Array.isArray(jwksData.keys) && jwksData.keys.length > 0,
      service: 'neon-auth',
      baseUrl,
      jwksUrl,
      jwksStatus: jwksRes.status,
      activeKeys: (jwksData.keys ?? []).map((k) => ({
        kid: k.kid,
        alg: k.alg,
        crv: k.crv,
        kty: k.kty,
      })),
      schemaTables: tableRows.map((r) => r.table_name),
    });
  });

  // 3. Neon AI Gateway verification & model catalog endpoint
  app.get('/api/neon/ai-gateway', async (c) => {
    const baseUrl = getEnv('NEON_AI_GATEWAY_BASE_URL');
    const token = getEnv('NEON_AI_GATEWAY_TOKEN');
    if (!baseUrl || !token) {
      return c.json(
        { ok: false, service: 'neon-ai-gateway', error: 'NEON_AI_GATEWAY_BASE_URL or NEON_AI_GATEWAY_TOKEN missing' },
        503
      );
    }

    const modelsUrl = `${baseUrl.replace(/\/$/, '')}/v1/models`;
    const res = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id: string; owned_by?: string; display_name?: string; context_length?: number }>;
    };
    const models = data.data ?? [];

    return c.json({
      ok: res.ok,
      service: 'neon-ai-gateway',
      baseUrl,
      status: res.status,
      modelsCount: models.length,
      sampleModels: models.slice(0, 8).map((m) => ({
        id: m.id,
        ownedBy: m.owned_by,
        displayName: m.display_name,
        contextLength: m.context_length,
      })),
    });
  });

  // 4. Neon Functions verification endpoint
  app.get('/api/neon/functions', async (c) => {
    const fnUrl = resolveFunctionUrl('hello');
    const res = await fetch(fnUrl);
    const bodyText = await res.text();

    return c.json({
      ok: res.ok,
      service: 'neon-functions',
      functionName: 'hello',
      url: fnUrl,
      status: res.status,
      response: bodyText.trim(),
    });
  });

  // 5. Neon Realtime live query sealing & verification endpoint
  const ALLOWED_REALTIME_TABLES: Record<string, string> = {
    workspaces: 'SELECT id, legal_name, gstin, state_code, gst_regime, wacc_pct FROM workspaces WHERE id = $1 LIMIT 20',
    suppliers: 'SELECT id, workspace_id, legal_name, gstin, state_code, udyam_tier FROM suppliers WHERE workspace_id = $1 ORDER BY legal_name ASC LIMIT 50',
    quotes: 'SELECT id, workspace_id, supplier_id, item_description, total_paise, landed_cost_paise FROM quotes WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50',
    invoices: 'SELECT id, workspace_id, invoice_number, supplier_name, payable_paise, audit_status FROM invoices WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50',
    agent_runs: 'SELECT id, workspace_id, agent_id, trigger_source, status, confidence FROM agent_runs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50',
  };

  app.get('/api/neon/realtime', async (c) => {
    const realtimeUrl = getEnv('NEON_REALTIME_URL');
    const realtimeSecret = getEnv('NEON_REALTIME_SECRET');
    if (!realtimeUrl || !realtimeSecret) {
      return c.json(
        { ok: false, service: 'neon-realtime', error: 'NEON_REALTIME_URL or NEON_REALTIME_SECRET missing' },
        503
      );
    }

    const ctx = c.get('auth');
    const workspaceId = ctx?.workspaceId || 'ws-primary';
    const sqlQuery = ALLOWED_REALTIME_TABLES.workspaces;
    const payload = JSON.stringify({
      db: 'neondb',
      sql: sqlQuery,
      params: [workspaceId],
    });
    const signature = await hmacSha256Hex(realtimeSecret, payload);

    const db = await getDb(getEnv('DATABASE_URL'));
    const txRes = await db.execute(sql.raw(`SELECT pg_current_xact_id()::text AS txid`));
    const txRows =
      (txRes as unknown as { rows?: Array<{ txid: string }> })?.rows ??
      (Array.isArray(txRes) ? (txRes as Array<{ txid: string }>) : []);

    return c.json({
      ok: true,
      service: 'neon-realtime',
      realtimeUrl,
      secretConfigured: realtimeSecret.startsWith('nrt_'),
      currentTxId: txRows[0]?.txid ?? null,
      sealedQuery: {
        db: 'neondb',
        table: 'workspaces',
        sql: sqlQuery,
        params: [workspaceId],
        signature,
      },
    });
  });

  app.post('/api/neon/realtime/seal', async (c) => {
    const realtimeUrl = getEnv('NEON_REALTIME_URL');
    const realtimeSecret = getEnv('NEON_REALTIME_SECRET');
    if (!realtimeUrl || !realtimeSecret) {
      return c.json(
        { ok: false, service: 'neon-realtime', error: 'NEON_REALTIME_URL or NEON_REALTIME_SECRET missing' },
        503
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { table?: string };
    const tableKey = body.table && ALLOWED_REALTIME_TABLES[body.table] ? body.table : 'suppliers';
    const sqlQuery = ALLOWED_REALTIME_TABLES[tableKey];
    const ctx = c.get('auth');
    const workspaceId = ctx?.workspaceId || 'ws-primary';

    const payload = JSON.stringify({
      db: 'neondb',
      sql: sqlQuery,
      params: [workspaceId],
    });
    const signature = await hmacSha256Hex(realtimeSecret, payload);

    const db = await getDb(getEnv('DATABASE_URL'));
    const txRes = await db.execute(sql.raw(`SELECT pg_current_xact_id()::text AS txid`));
    const txRows =
      (txRes as unknown as { rows?: Array<{ txid: string }> })?.rows ??
      (Array.isArray(txRes) ? (txRes as Array<{ txid: string }>) : []);

    return c.json({
      ok: true,
      service: 'neon-realtime',
      realtimeUrl,
      currentTxId: txRows[0]?.txid ?? null,
      sealedQuery: {
        db: 'neondb',
        table: tableKey,
        sql: sqlQuery,
        params: [workspaceId],
        signature,
      },
    });
  });

  // 6. Consolidated End-to-End Neon Suite Verification
  app.get('/api/neon/status', async (c) => {
    const dbUrl = getEnv('DATABASE_URL');
    const authJwksUrl = getEnv('NEON_AUTH_JWKS_URL');
    const aiBaseUrl = getEnv('NEON_AI_GATEWAY_BASE_URL');
    const aiToken = getEnv('NEON_AI_GATEWAY_TOKEN');
    const fnUrl = resolveFunctionUrl('hello');
    const realtimeUrl = getEnv('NEON_REALTIME_URL');
    const realtimeSecret = getEnv('NEON_REALTIME_SECRET');

    const [pgCheck, authCheck, aiCheck, fnCheck] = await Promise.all([
      (async () => {
        const db = await getDb(dbUrl);
        const res = await db.execute(sql.raw(`SELECT current_database() AS db, pg_current_xact_id()::text AS txid`));
        const rows =
          (res as unknown as { rows?: Array<{ db: string; txid: string }> })?.rows ??
          (Array.isArray(res) ? (res as Array<{ db: string; txid: string }>) : []);
        return {
          ok: getDbMode() === 'neon-postgres' && rows.length > 0,
          mode: getDbMode(),
          database: rows[0]?.db ?? 'neondb',
          txid: rows[0]?.txid ?? null,
          migrations: getAppliedMigrations(),
        };
      })(),
      (async () => {
        if (!authJwksUrl) return { ok: false, keysCount: 0 };
        const res = await fetch(authJwksUrl);
        const data = (await res.json().catch(() => ({}))) as { keys?: unknown[] };
        return {
          ok: res.ok && Array.isArray(data.keys) && data.keys.length > 0,
          status: res.status,
          keysCount: data.keys?.length ?? 0,
        };
      })(),
      (async () => {
        if (!aiBaseUrl || !aiToken) return { ok: false, modelsCount: 0 };
        const res = await fetch(`${aiBaseUrl.replace(/\/$/, '')}/v1/models`, {
          headers: { Authorization: `Bearer ${aiToken}` },
        });
        const data = (await res.json().catch(() => ({}))) as { data?: unknown[] };
        return {
          ok: res.ok && Array.isArray(data.data),
          status: res.status,
          modelsCount: data.data?.length ?? 0,
        };
      })(),
      (async () => {
        const res = await fetch(fnUrl);
        const text = await res.text();
        return {
          ok: res.ok && text.includes('Hello from Neon Functions'),
          status: res.status,
          url: fnUrl,
          response: text.trim(),
        };
      })(),
    ]);

    const realtimeSig =
      realtimeSecret && realtimeUrl
        ? await hmacSha256Hex(realtimeSecret, JSON.stringify({ db: 'neondb', url: realtimeUrl }))
        : null;
    const realtimeCheck = {
      ok: Boolean(realtimeUrl && realtimeSecret && realtimeSig),
      url: realtimeUrl ?? null,
      sealedTokenPreview: realtimeSig ? `${realtimeSig.slice(0, 16)}...` : null,
    };

    const allOk = pgCheck.ok && authCheck.ok && aiCheck.ok && fnCheck.ok && realtimeCheck.ok;

    return c.json({
      ok: allOk,
      branch: getEnv('NEON_BRANCH') || 'production',
      branchId: getEnv('NEON_BRANCH_ID') || null,
      services: {
        postgres: pgCheck,
        auth: authCheck,
        aiGateway: aiCheck,
        functions: fnCheck,
        realtime: realtimeCheck,
      },
      timestamp: new Date().toISOString(),
    });
  });
}
