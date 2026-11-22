import type { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, KrayaDb } from './db/client.js';
import * as schema from './db/schema.js';
import { AppHelpers, AppVariables, AuthContext, recordAuditLog, uid } from './context.js';
import {
  buildWorkspaceStorageKey,
  PersistentVaultStorage,
  ValidatedUpload,
  validateUploadFile,
} from './storage.js';

export async function persistWorkspaceFile(params: {
  db: KrayaDb | any;
  storage: PersistentVaultStorage;
  workspaceId: string;
  uploadedByUserId: string | null;
  fileName: string;
  mimeType: string | null | undefined;
  bytes: Uint8Array;
  category?: ValidatedUpload['category'];
  sourceEventId?: string | null;
  quoteId?: string | null;
  invoiceId?: string | null;
  poId?: string | null;
}) {
  const validated = await validateUploadFile({
    fileName: params.fileName,
    mimeType: params.mimeType,
    bytes: params.bytes,
    category: params.category,
  });

  const fileId = uid('fil');
  const storageKey = buildWorkspaceStorageKey(
    params.workspaceId,
    validated.category,
    fileId,
    validated.safeFileName
  );

  await params.storage.putObject(storageKey, params.bytes, validated.mimeType);

  const [saved] = await params.db
    .insert(schema.storedFiles)
    .values({
      id: fileId,
      workspaceId: params.workspaceId,
      uploadedByUserId: params.uploadedByUserId,
      category: validated.category,
      originalFileName: validated.safeFileName,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      storageProvider: params.storage.mode,
      storageKey,
      sourceEventId: params.sourceEventId ?? null,
      quoteId: params.quoteId ?? null,
      invoiceId: params.invoiceId ?? null,
      poId: params.poId ?? null,
    })
    .returning();

  return saved;
}

export function registerFileRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // List all active files in authenticated workspace
  app.get('/api/files', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const rows = await db
      .select({
        id: schema.storedFiles.id,
        category: schema.storedFiles.category,
        originalFileName: schema.storedFiles.originalFileName,
        mimeType: schema.storedFiles.mimeType,
        sizeBytes: schema.storedFiles.sizeBytes,
        sha256: schema.storedFiles.sha256,
        storageProvider: schema.storedFiles.storageProvider,
        sourceEventId: schema.storedFiles.sourceEventId,
        quoteId: schema.storedFiles.quoteId,
        invoiceId: schema.storedFiles.invoiceId,
        poId: schema.storedFiles.poId,
        createdAt: schema.storedFiles.createdAt,
      })
      .from(schema.storedFiles)
      .where(
        and(
          eq(schema.storedFiles.workspaceId, ctx.workspaceId),
          isNull(schema.storedFiles.deletedAt)
        )
      )
      .orderBy(desc(schema.storedFiles.createdAt));

    return c.json(rows);
  });

  // Upload a persistent document/image/spreadsheet/audio file scoped to workspace
  app.post('/api/files/upload', async (c) => {
    const ctx = c.get('auth');
    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required for file uploads.' }, 400);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Missing file field in multipart upload.' }, 400);
    }

    const categoryRaw = String(form.get('category') || '').trim();
    const validCategories = new Set(['quote', 'invoice', 'audio', 'po_pdf', 'spreadsheet', 'document']);
    const category = validCategories.has(categoryRaw)
      ? (categoryRaw as ValidatedUpload['category'])
      : undefined;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const storage = helpers.getStorage();

    // Validate any linked entity belongs to THIS workspace (prevents cross-tenant attachment injection)
    const sourceEventId = form.get('sourceEventId') ? String(form.get('sourceEventId')) : null;
    const quoteId = form.get('quoteId') ? String(form.get('quoteId')) : null;
    const invoiceId = form.get('invoiceId') ? String(form.get('invoiceId')) : null;
    const poId = form.get('poId') ? String(form.get('poId')) : null;

    if (sourceEventId) {
      const [ev] = await db
        .select({ id: schema.sourceEvents.id })
        .from(schema.sourceEvents)
        .where(and(eq(schema.sourceEvents.id, sourceEventId), eq(schema.sourceEvents.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!ev) return c.json({ error: 'Linked sourceEventId not found in this workspace.' }, 404);
    }
    if (quoteId) {
      const [q] = await db
        .select({ id: schema.quotes.id })
        .from(schema.quotes)
        .where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!q) return c.json({ error: 'Linked quoteId not found in this workspace.' }, 404);
    }
    if (invoiceId) {
      const [inv] = await db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!inv) return c.json({ error: 'Linked invoiceId not found in this workspace.' }, 404);
    }
    if (poId) {
      const [po] = await db
        .select({ id: schema.purchaseOrders.id })
        .from(schema.purchaseOrders)
        .where(and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!po) return c.json({ error: 'Linked poId not found in this workspace.' }, 404);
    }

    const saved = await persistWorkspaceFile({
      db,
      storage,
      workspaceId: ctx.workspaceId,
      uploadedByUserId: ctx.userId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
      category,
      sourceEventId,
      quoteId,
      invoiceId,
      poId,
    });

    await recordAuditLog(db, ctx, 'file_uploaded', 'stored_file', saved.id, {
      fileName: saved.originalFileName,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      storageProvider: saved.storageProvider,
    });

    return c.json(
      {
        id: saved.id,
        category: saved.category,
        originalFileName: saved.originalFileName,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        sha256: saved.sha256,
        storageProvider: saved.storageProvider,
        createdAt: saved.createdAt,
        downloadUrl: `/api/files/${saved.id}/download`,
      },
      201
    );
  });

  // Generate a short-lived HMAC-signed download URL (5-minute TTL, read-only so CAs can download too)
  app.get('/api/files/:id/signed-url', async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [fileRow] = await db
      .select()
      .from(schema.storedFiles)
      .where(
        and(
          eq(schema.storedFiles.id, id),
          eq(schema.storedFiles.workspaceId, ctx.workspaceId),
          isNull(schema.storedFiles.deletedAt)
        )
      )
      .limit(1);

    if (!fileRow) return c.json({ error: 'File not found in this workspace.' }, 404);

    const storage = helpers.getStorage();
    const signed = await storage.createSignedDownloadQuery(fileRow.id, ctx.workspaceId, 300);
    return c.json({
      fileId: fileRow.id,
      fileName: fileRow.originalFileName,
      expiresAt: new Date(signed.expiresAt * 1000).toISOString(),
      url: `/api/files/${fileRow.id}/download?${signed.queryString}`,
    });
  });

  // Download file (authorized via session cookie/Bearer OR valid short-lived HMAC signed URL)
  app.get('/api/files/:id/download', async (c) => {
    const id = c.req.param('id');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const storage = helpers.getStorage();

    let authorizedWorkspaceId: string | null = null;
    const ctx = c.get('auth') as AuthContext | undefined;

    const exp = c.req.query('exp');
    const wsParam = c.req.query('ws');
    const sig = c.req.query('sig');

    if (exp && wsParam && sig) {
      const valid = await storage.verifySignedDownloadQuery(id, wsParam, exp, sig);
      if (!valid) {
        return c.json({ error: 'Invalid or expired signed download URL.' }, 401);
      }
      authorizedWorkspaceId = wsParam;
    } else if (ctx?.workspaceId) {
      authorizedWorkspaceId = ctx.workspaceId;
    } else {
      return c.json({ error: 'Authentication required to download file.' }, 401);
    }

    const [fileRow] = await db
      .select()
      .from(schema.storedFiles)
      .where(
        and(
          eq(schema.storedFiles.id, id),
          eq(schema.storedFiles.workspaceId, authorizedWorkspaceId),
          isNull(schema.storedFiles.deletedAt)
        )
      )
      .limit(1);

    if (!fileRow) {
      return c.json({ error: 'File not found or access denied.' }, 404);
    }

    const bytes = await storage.getObject(fileRow.storageKey);
    if (!bytes) {
      return c.json({ error: 'Stored object missing from vault.' }, 404);
    }

    const disposition =
      c.req.query('inline') === '1' &&
      (fileRow.mimeType === 'application/pdf' || fileRow.mimeType.startsWith('image/') || fileRow.mimeType.startsWith('audio/'))
        ? 'inline'
        : 'attachment';

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': fileRow.mimeType,
        'Content-Disposition': `${disposition}; filename="${fileRow.originalFileName.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  });

  // Delete file metadata AND physically delete underlying R2 / vault object
  app.delete('/api/files/:id', async (c) => {
    const ctx = c.get('auth');
    const id = c.req.param('id');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [fileRow] = await db
      .select()
      .from(schema.storedFiles)
      .where(
        and(
          eq(schema.storedFiles.id, id),
          eq(schema.storedFiles.workspaceId, ctx.workspaceId),
          isNull(schema.storedFiles.deletedAt)
        )
      )
      .limit(1);

    if (!fileRow) return c.json({ error: 'File not found in this workspace.' }, 404);

    const storage = helpers.getStorage();
    await storage.deleteObject(fileRow.storageKey);

    await db
      .update(schema.storedFiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.storedFiles.id, id), eq(schema.storedFiles.workspaceId, ctx.workspaceId)));

    await recordAuditLog(db, ctx, 'file_deleted', 'stored_file', id, {
      fileName: fileRow.originalFileName,
      storageProvider: fileRow.storageProvider,
    });

    return c.json({ ok: true, id, objectDeleted: true });
  });
}
