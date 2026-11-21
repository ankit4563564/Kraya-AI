import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { sql } from 'drizzle-orm';
import { SQL_MIGRATIONS, splitSqlStatements } from './migrations.js';

export type KrayaDb = PgliteDatabase<typeof schema> | NeonHttpDatabase<typeof schema>;

let cachedDb: KrayaDb | null = null;
let cachedConnKey: string | null = null;
let cachedMode: 'pglite-local' | 'neon-postgres' = 'pglite-local';
let appliedMigrationsList: string[] = [];

/**
 * Legacy dev-only workspace ID. NEVER used in production (NODE_ENV=production) or when REQUIRE_AUTH=true.
 */
export const DEFAULT_WORKSPACE_ID = 'ws-primary';

export function getDbMode(): 'pglite-local' | 'neon-postgres' {
  return cachedMode;
}

export function getAppliedMigrations(): string[] {
  return [...appliedMigrationsList];
}

export function resetDbCache(): void {
  cachedDb = null;
  cachedConnKey = null;
  appliedMigrationsList = [];
}

async function runMigrations(db: KrayaDb): Promise<string[]> {
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS _kraya_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
  );

  const appliedRes = await db.execute(sql.raw(`SELECT version FROM _kraya_migrations ORDER BY version ASC`));
  const rows = (appliedRes as unknown as { rows?: Array<{ version: string }> })?.rows ?? (Array.isArray(appliedRes) ? (appliedRes as Array<{ version: string }>) : []);
  const appliedSet = new Set(rows.map((r) => String(r.version)));

  for (const mig of SQL_MIGRATIONS) {
    if (appliedSet.has(mig.version)) continue;
    const statements = splitSqlStatements(mig.sql);
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
    await db.execute(
      sql`INSERT INTO _kraya_migrations (version, name) VALUES (${mig.version}, ${mig.name}) ON CONFLICT (version) DO NOTHING`
    );
    appliedSet.add(mig.version);
  }

  return Array.from(appliedSet).sort();
}

export async function ensureDevWorkspaceIfPermitted(db: KrayaDb, allowDevWorkspace: boolean): Promise<void> {
  if (!allowDevWorkspace) return;
  const existing = await db
    .select()
    .from(schema.workspaces)
    .where(sql`${schema.workspaces.id} = ${DEFAULT_WORKSPACE_ID}`)
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.workspaces).values({
      id: DEFAULT_WORKSPACE_ID,
      legalName: 'Local Dev Workspace',
      gstin: null,
      stateCode: '29',
      gstRegime: 'regular',
      waccPct: 15.0,
      turnoverBand: 'under_5cr',
      defaultOutreachLang: 'english',
      policyPatchMd: null,
    });
  }
}

export async function getDb(databaseUrl?: string): Promise<KrayaDb> {
  const conn = databaseUrl ?? (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined);
  const dataDir = (typeof process !== 'undefined' ? process.env.PGLITE_DATA_DIR : undefined) || './data/kraya-pg';
  const connKey = conn && conn.trim().startsWith('postgres') ? `neon:${conn.trim()}` : `pglite:${dataDir}`;

  if (cachedDb && cachedConnKey === connKey) return cachedDb;

  if (conn && conn.trim().startsWith('postgres')) {
    const client = neon(conn.trim());
    cachedDb = drizzleNeon(client, { schema });
    cachedMode = 'neon-postgres';
  } else {
    // Lazy dynamic import so Cloudflare Workers deploying with Neon never bundle PGlite WASM!
    const [{ PGlite }, { drizzle: drizzlePglite }, fs, path] = await Promise.all([
      import('@electric-sql/pglite'),
      import('drizzle-orm/pglite'),
      import('node:fs'),
      import('node:path'),
    ]);
    const resolvedDataDir = path.resolve(dataDir);
    fs.mkdirSync(path.dirname(resolvedDataDir), { recursive: true });
    const pg = new PGlite(dataDir);
    await pg.waitReady;
    cachedDb = drizzlePglite(pg, { schema });
    cachedMode = 'pglite-local';
  }

  appliedMigrationsList = await runMigrations(cachedDb);
  await ensureDevWorkspaceIfPermitted(cachedDb, true);
  cachedConnKey = connKey;
  return cachedDb;
}
