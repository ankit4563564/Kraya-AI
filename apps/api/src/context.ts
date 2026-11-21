import type { Context } from 'hono';
import { asc, desc, eq } from 'drizzle-orm';
import type { KrayaDb } from './db/client.js';
import * as schema from './db/schema.js';
import type { PersistentVaultStorage, R2BucketLike } from './storage.js';
import { sha256Hex } from './auth.js';

export interface AppEnv {
  NODE_ENV?: string;
  APP_ORIGIN?: string;
  DATABASE_URL?: string;
  REQUIRE_AUTH?: string;
  SESSION_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
  RATE_LIMIT_MAX_AUTH?: string;
  RATE_LIMIT_MAX_API?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_STT_MODEL?: string;
  ELEVENLABS_TTS_MODEL?: string;
  ELEVENLABS_VOICE_ID?: string;
  /** VoiceStudio (local voice cloning) service root, e.g. http://localhost:3900 */
  VOICESTUDIO_BASE_URL?: string;
  /** Bearer key for non-loopback VoiceStudio deployments (OMNIVOICE_API_KEY) */
  VOICESTUDIO_API_KEY?: string;
  /** JSON map of outreach language -> cloned voice profile id, e.g. {"hinglish":"…","default":"…"} */
  VOICESTUDIO_VOICE_MAP?: string;
  /** Single fallback voice profile id when no per-language clone exists */
  VOICESTUDIO_VOICE_ID?: string;
  VOICESTUDIO_MODEL?: string;
  /** Fixed seed for consistent delivery across voice notes */
  VOICESTUDIO_SEED?: string;
  /** Use VoiceStudio's local STT for vendor voice notes before cloud ASR ("true" to enable) */
  VOICESTUDIO_STT_ENABLED?: string;
  GROQ_API_KEY?: string;
  GROQ_WHISPER_MODEL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  INBOUND_WEBHOOK_SECRET?: string;
  WEBHOOK_DEFAULT_WORKSPACE_ID?: string;
  VAULT_BUCKET?: R2BucketLike;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_ENDPOINT?: string;
  LOCAL_VAULT_DIR?: string;
  GOOGLE_MAPS_API_KEY?: string;
  OPENCORPORATES_API_KEY?: string;
}

export interface AuthContext {
  workspaceId: string;
  userId: string | null;
  userName: string;
  email: string;
  role: 'owner' | 'clerk' | 'ca';
  authenticated: boolean;
  sessionToken: string | null;
}

export type AppVariables = {
  auth: AuthContext;
};

export interface AppHelpers {
  getEnv: <K extends keyof AppEnv>(key: K) => AppEnv[K];
  getStorage: () => PersistentVaultStorage;
  isProduction: () => boolean;
  isAuthRequired: () => boolean;
  getSessionTtlSeconds: () => number;
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isHttpsRequest(c: Context): boolean {
  const xfProto = c.req.header('x-forwarded-proto');
  if (xfProto) return xfProto.toLowerCase().includes('https');
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function stableJson(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map((v) => stableJson(v)).join(',')}]`;
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

async function computeAuditEntryHash(entry: {
  seqNum: number;
  prevHash: string;
  workspaceId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadataJson: unknown;
}): Promise<string> {
  const payload = [
    String(entry.seqNum),
    entry.prevHash,
    entry.workspaceId,
    entry.actorEmail,
    entry.actorRole,
    entry.action,
    entry.entityType,
    entry.entityId ?? '',
    stableJson(entry.metadataJson ?? null),
  ].join('|');
  return sha256Hex(payload);
}

/**
 * Records a tamper-evident, SHA-256 hash-chained audit trail entry scoped to the workspace.
 */
export async function recordAuditLog(
  db: KrayaDb,
  ctx: Pick<AuthContext, 'workspaceId' | 'email' | 'role'>,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  const [last] = await db
    .select({
      seqNum: schema.auditLogs.seqNum,
      entryHash: schema.auditLogs.entryHash,
    })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.workspaceId, ctx.workspaceId))
    .orderBy(desc(schema.auditLogs.seqNum), desc(schema.auditLogs.createdAt))
    .limit(1);

  const seqNum = (last?.seqNum ?? 0) + 1;
  const prevHash = last?.entryHash ?? 'GENESIS';
  const entryHash = await computeAuditEntryHash({
    seqNum,
    prevHash,
    workspaceId: ctx.workspaceId,
    actorEmail: ctx.email,
    actorRole: ctx.role,
    action,
    entityType,
    entityId: entityId ?? null,
    metadataJson: metadata ?? null,
  });

  await db.insert(schema.auditLogs).values({
    id: uid('aud'),
    workspaceId: ctx.workspaceId,
    actorEmail: ctx.email,
    actorRole: ctx.role,
    action,
    entityType,
    entityId: entityId ?? null,
    metadataJson: metadata ?? null,
    seqNum,
    prevHash,
    entryHash,
  });
}

export interface AuditChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  latestHash: string | null;
  brokenEntryId: string | null;
  brokenSeqNum: number | null;
  reason: string | null;
}

/**
 * Independently walks the entire workspace audit log chain and verifies every SHA-256 hash link.
 * Detects any row tampering, deletion, or out-of-order modification.
 */
export async function verifyWorkspaceAuditChain(
  db: KrayaDb,
  workspaceId: string
): Promise<AuditChainVerificationResult> {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.workspaceId, workspaceId))
    .orderBy(asc(schema.auditLogs.seqNum), asc(schema.auditLogs.createdAt));

  if (rows.length === 0) {
    return {
      valid: true,
      totalEntries: 0,
      verifiedEntries: 0,
      latestHash: null,
      brokenEntryId: null,
      brokenSeqNum: null,
      reason: null,
    };
  }

  let expectedPrevHash = 'GENESIS';
  let expectedSeq = 1;
  let verified = 0;

  for (const row of rows) {
    if (row.seqNum !== expectedSeq) {
      return {
        valid: false,
        totalEntries: rows.length,
        verifiedEntries: verified,
        latestHash: expectedPrevHash === 'GENESIS' ? null : expectedPrevHash,
        brokenEntryId: row.id,
        brokenSeqNum: row.seqNum,
        reason: `Sequence gap or reorder detected: expected seq ${expectedSeq}, found ${row.seqNum}.`,
      };
    }

    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEntries: rows.length,
        verifiedEntries: verified,
        latestHash: expectedPrevHash === 'GENESIS' ? null : expectedPrevHash,
        brokenEntryId: row.id,
        brokenSeqNum: row.seqNum,
        reason: `Broken hash link at seq ${row.seqNum}: prev_hash does not match preceding entry.`,
      };
    }

    const recomputed = await computeAuditEntryHash({
      seqNum: row.seqNum,
      prevHash: row.prevHash,
      workspaceId: row.workspaceId,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      metadataJson: row.metadataJson ?? null,
    });

    if (row.entryHash !== recomputed) {
      return {
        valid: false,
        totalEntries: rows.length,
        verifiedEntries: verified,
        latestHash: expectedPrevHash === 'GENESIS' ? null : expectedPrevHash,
        brokenEntryId: row.id,
        brokenSeqNum: row.seqNum,
        reason: `Tampered audit entry detected at seq ${row.seqNum} (${row.action}): recomputed SHA-256 hash mismatch.`,
      };
    }

    expectedPrevHash = row.entryHash;
    expectedSeq++;
    verified++;
  }

  return {
    valid: true,
    totalEntries: rows.length,
    verifiedEntries: verified,
    latestHash: expectedPrevHash,
    brokenEntryId: null,
    brokenSeqNum: null,
    reason: null,
  };
}
