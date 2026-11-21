import type { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import {
  addCalendarDays,
  computeGstLine,
  GstRegime,
  SupplierTaxProfile,
  toPaise,
  TurnoverBand,
  UdyamTier,
  WorkspaceTaxProfile,
} from '@kraya/finance-engine';
import { generateGstPoPdf } from '@kraya/agent-core';
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
import { persistWorkspaceFile } from './routes-files.js';

function toBuyer(ws: typeof schema.workspaces.$inferSelect): WorkspaceTaxProfile {
  return {
    legalName: ws.legalName,
    gstin: ws.gstin,
    stateCode: ws.stateCode,
    gstRegime: ws.gstRegime as GstRegime,
    waccPct: ws.waccPct,
    turnoverBand: ws.turnoverBand as TurnoverBand,
  };
}

function toSup(s: typeof schema.suppliers.$inferSelect): SupplierTaxProfile {
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

export function registerLifecycleRoutes(
  app: Hono<{ Variables: AppVariables }>,
  helpers: AppHelpers
): void {
  // =========================================================================
  // 1. PO CANCELLATION (Owner-Only, Immutable Audit Trail)
  // =========================================================================
  app.post('/api/pos/:id/cancel', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can cancel a Purchase Order.' }, 403);
    }
    const id = c.req.param('id');
    const body = await c.req.json<{ reason?: string }>();
    const reason = (body.reason || '').trim();
    if (!reason) {
      return c.json({ error: 'A cancellation reason is required for audit compliance.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [po] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
      .limit(1);

    if (!po) return c.json({ error: 'Purchase Order not found in this workspace.' }, 404);
    if (po.invoiceStatus === 'cancelled') {
      return c.json({ error: `PO ${po.poNumber} is already cancelled.` }, 409);
    }
    if (po.invoiceStatus === 'matched') {
      return c.json(
        { error: `PO ${po.poNumber} is already matched against a supplier invoice and cannot be cancelled.` },
        400
      );
    }

    const [updated] = await db
      .update(schema.purchaseOrders)
      .set({
        invoiceStatus: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      })
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
      .returning();

    await recordAuditLog(db, ctx, 'po_cancelled', 'purchase_order', po.id, {
      poNumber: po.poNumber,
      revisionNumber: po.revisionNumber,
      reason,
    });

    return c.json(updated);
  });

  // =========================================================================
  // 2. PO AMENDMENT (Rev 2, Rev 3... + Deterministic GST Recalc + Archived PDF)
  // =========================================================================
  app.post('/api/pos/:id/amend', async (c) => {
    const ctx = c.get('auth');
    if (ctx.role !== 'owner') {
      return c.json({ error: 'Only Workspace Owners can issue Purchase Order amendments.' }, 403);
    }
    const id = c.req.param('id');
    const body = await c.req.json<{
      qty?: number;
      unitRateRupees?: number;
      gstPct?: number;
      freightRupees?: number;
      paymentTermsDays?: number;
      deliveryDueAt?: string;
      reason: string;
    }>();

    const reason = (body.reason || '').trim();
    if (!reason) {
      return c.json({ error: 'Amendment reason is required for PO revision audit trail.' }, 400);
    }

    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const [po] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
      .limit(1);

    if (!po) return c.json({ error: 'Purchase Order not found in this workspace.' }, 404);
    if (po.invoiceStatus === 'cancelled') {
      return c.json({ error: `Cancelled PO ${po.poNumber} cannot be amended.` }, 400);
    }

    const [[ws], [sup]] = await Promise.all([
      db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId)).limit(1),
      db
        .select()
        .from(schema.suppliers)
        .where(and(eq(schema.suppliers.id, po.supplierId), eq(schema.suppliers.workspaceId, ctx.workspaceId)))
        .limit(1),
    ]);
    if (!ws || !sup) return c.json({ error: 'Workspace or supplier missing.' }, 404);

    const prevItems = po.itemsJson as Array<{
      itemKey: string;
      description: string;
      hsnSac?: string | null;
      qty: number;
      unit: string;
      unitRatePaise: number;
      gstPct: number;
      taxablePaise: number;
    }>;
    const first = prevItems[0];
    if (!first) return c.json({ error: 'PO has no line items to amend.' }, 400);

    const nextQty = typeof body.qty === 'number' ? body.qty : first.qty;
    const nextUnitRatePaise =
      typeof body.unitRateRupees === 'number' ? toPaise(body.unitRateRupees) : first.unitRatePaise;
    const nextGstPct = typeof body.gstPct === 'number' ? body.gstPct : first.gstPct;
    const nextFreightPaise =
      typeof body.freightRupees === 'number' ? toPaise(body.freightRupees) : po.freightPaise;
    const nextPaymentTerms =
      typeof body.paymentTermsDays === 'number' ? body.paymentTermsDays : po.paymentTermsDays;
    const nextDeliveryDueAt = body.deliveryDueAt || po.deliveryDueAt;

    if (!Number.isFinite(nextQty) || nextQty <= 0 || nextUnitRatePaise < 0) {
      return c.json({ error: 'Amended quantity must be > 0 and unit rate >= 0.' }, 400);
    }

    const goodsTaxablePaise = Math.round(nextUnitRatePaise * nextQty);
    const totalTaxablePaise = goodsTaxablePaise + nextFreightPaise;
    const buyer = toBuyer(ws);
    const gstCalc = computeGstLine({
      taxablePaise: totalTaxablePaise,
      gstRatePct: nextGstPct,
      buyer,
      supplier: toSup(sup),
      hsnOrItemText: first.hsnSac || first.description,
    });

    const newItems = [
      {
        ...first,
        qty: nextQty,
        unitRatePaise: nextUnitRatePaise,
        gstPct: nextGstPct,
        taxablePaise: goodsTaxablePaise,
      },
      ...prevItems.slice(1),
    ];

    const nextRevision = (po.revisionNumber || 1) + 1;
    const priorRevisions = Array.isArray(po.revisionsJson) ? po.revisionsJson : [];
    const snapshot = {
      revisionNumber: po.revisionNumber || 1,
      itemsJson: po.itemsJson,
      freightPaise: po.freightPaise,
      taxablePaise: po.taxablePaise,
      totalPaise: po.totalPaise,
      paymentTermsDays: po.paymentTermsDays,
      deliveryDueAt: po.deliveryDueAt,
      amendedAt: new Date().toISOString(),
      amendedBy: ctx.email,
      reason,
    };

    const nextPaymentDueAt = addCalendarDays(nextDeliveryDueAt, nextPaymentTerms);

    // Regenerate & retain amended PO PDF in persistent vault
    let pdfFileId = po.pdfFileId;
    try {
      const pdfBytes = await generateGstPoPdf({
        poNumber: `${po.poNumber}-Rev${nextRevision}`,
        poDate: todayIso(),
        deliveryDueDate: nextDeliveryDueAt,
        paymentTermsDays: nextPaymentTerms,
        buyer,
        supplier: {
          name: sup.name,
          gstin: sup.gstin,
          stateCode: sup.stateCode,
          phone: sup.phone,
          email: sup.email,
          udyamTier: sup.udyamTier,
        },
        items: newItems,
        freightPaise: nextFreightPaise,
        taxableTotalPaise: totalTaxablePaise,
        cgstPaise: gstCalc.cgstPaise,
        sgstPaise: gstCalc.sgstPaise,
        igstPaise: gstCalc.igstPaise,
        grandTotalPaise: gstCalc.grandTotalPaise,
      });
      const storedPdf = await persistWorkspaceFile({
        db,
        storage: helpers.getStorage(),
        workspaceId: ctx.workspaceId,
        uploadedByUserId: ctx.userId,
        fileName: `${po.poNumber}-Rev${nextRevision}.pdf`,
        mimeType: 'application/pdf',
        bytes: new Uint8Array(pdfBytes),
        category: 'po_pdf',
        poId: po.id,
      });
      pdfFileId = storedPdf.id;
    } catch {
      // Non-fatal
    }

    const [updated] = await db
      .update(schema.purchaseOrders)
      .set({
        revisionNumber: nextRevision,
        itemsJson: newItems,
        freightPaise: nextFreightPaise,
        taxablePaise: totalTaxablePaise,
        cgstPaise: gstCalc.cgstPaise,
        sgstPaise: gstCalc.sgstPaise,
        igstPaise: gstCalc.igstPaise,
        totalPaise: gstCalc.grandTotalPaise,
        paymentTermsDays: nextPaymentTerms,
        deliveryDueAt: nextDeliveryDueAt,
        paymentDueAt: nextPaymentDueAt,
        pdfFileId,
        revisionsJson: [...priorRevisions, snapshot],
      })
      .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
      .returning();

    await recordAuditLog(db, ctx, 'po_amended', 'purchase_order', po.id, {
      poNumber: po.poNumber,
      previousRevision: po.revisionNumber,
      newRevision: nextRevision,
      previousTotalPaise: po.totalPaise,
      newTotalPaise: updated.totalPaise,
      reason,
      pdfFileId,
    });

    return c.json(updated);
  });

  // =========================================================================
  // 3. GRN (GOODS RECEIVED NOTE) — CUMULATIVE PARTIAL DELIVERIES & 43B(h) ACCEPTANCE
  // =========================================================================
  app.get('/api/grns', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const poIdFilter = c.req.query('poId');
    const rows = await db
      .select()
      .from(schema.grnReceipts)
      .where(
        poIdFilter
          ? and(eq(schema.grnReceipts.workspaceId, ctx.workspaceId), eq(schema.grnReceipts.poId, poIdFilter))
          : eq(schema.grnReceipts.workspaceId, ctx.workspaceId)
      )
      .orderBy(desc(schema.grnReceipts.createdAt));
    return c.json(rows);
  });

  app.post('/api/grns', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      poId: string;
      challanNumber?: string;
      receivedDate?: string;
      acceptedDate?: string;
      items: Array<{
        itemKey?: string;
        description?: string;
        receivedQty: number;
        acceptedQty: number;
        rejectedQty?: number;
      }>;
      notes?: string;
    }>();

    if (!body.poId || !Array.isArray(body.items) || body.items.length === 0) {
      return c.json({ error: 'poId and at least one received line item are required.' }, 400);
    }

    const [po] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, body.poId), eq(schema.purchaseOrders.workspaceId, ctx.workspaceId)))
      .limit(1);

    if (!po) return c.json({ error: 'Purchase Order not found in this workspace.' }, 404);
    if (po.invoiceStatus === 'cancelled') {
      return c.json({ error: `Cannot record GRN against cancelled PO ${po.poNumber}.` }, 400);
    }

    const poItems = po.itemsJson as Array<{ itemKey: string; description: string; qty: number }>;
    const normalizedItems = body.items.map((it, idx) => {
      const ref = poItems.find((p) => p.itemKey === it.itemKey) || poItems[idx] || poItems[0];
      const receivedQty = Number(it.receivedQty);
      const acceptedQty = Number(it.acceptedQty);
      const rejectedQty =
        typeof it.rejectedQty === 'number' ? Number(it.rejectedQty) : Math.max(0, receivedQty - acceptedQty);
      if (
        !Number.isFinite(receivedQty) ||
        receivedQty <= 0 ||
        !Number.isFinite(acceptedQty) ||
        acceptedQty < 0 ||
        !Number.isFinite(rejectedQty) ||
        rejectedQty < 0 ||
        acceptedQty + rejectedQty > receivedQty + 0.0001
      ) {
        throw new Error('Invalid GRN quantities: acceptedQty + rejectedQty cannot exceed receivedQty.');
      }
      return {
        itemKey: ref?.itemKey || it.itemKey || 'item',
        description: ref?.description || it.description || 'Received Goods',
        orderedQty: ref?.qty ?? 0,
        receivedQty,
        acceptedQty,
        rejectedQty,
      };
    });

    const totalAccepted = normalizedItems.reduce((s, i) => s + i.acceptedQty, 0);
    const totalRejected = normalizedItems.reduce((s, i) => s + i.rejectedQty, 0);
    const qcStatus =
      totalAccepted === 0 ? 'rejected' : totalRejected > 0 ? 'partial' : 'accepted';

    const existingGrns = await db
      .select()
      .from(schema.grnReceipts)
      .where(eq(schema.grnReceipts.workspaceId, ctx.workspaceId));
    const grnNumber = `GRN-${new Date().getFullYear()}-${String(existingGrns.length + 1).padStart(4, '0')}`;
    const receivedDate = body.receivedDate || todayIso();
    const acceptedDate = body.acceptedDate || receivedDate;

    const [created] = await db
      .insert(schema.grnReceipts)
      .values({
        id: uid('grn'),
        workspaceId: ctx.workspaceId,
        poId: po.id,
        supplierId: po.supplierId,
        grnNumber,
        challanNumber: body.challanNumber?.trim() || null,
        receivedDate,
        acceptedDate,
        itemsJson: normalizedItems,
        qcStatus,
        notes: body.notes?.trim() || null,
        createdBy: ctx.email,
      })
      .returning();

    // Calculate cumulative accepted qty across all GRNs on this PO
    const poGrns = existingGrns.filter((g) => g.poId === po.id).concat([created]);
    const cumulativeAcceptedQty = poGrns.reduce((sum, g) => {
      const items = (g.itemsJson as Array<{ acceptedQty: number }>) || [];
      return sum + items.reduce((s, x) => s + (x.acceptedQty || 0), 0);
    }, 0);
    const orderedQty = poItems.reduce((s, i) => s + i.qty, 0);

    await recordAuditLog(db, ctx, 'grn_recorded', 'grn_receipt', created.id, {
      grnNumber,
      poId: po.id,
      poNumber: po.poNumber,
      challanNumber: created.challanNumber,
      acceptedDate,
      acceptedQty: totalAccepted,
      rejectedQty: totalRejected,
      cumulativeAcceptedQty,
      orderedQty,
    });

    return c.json(
      {
        grn: created,
        poFulfillment: {
          orderedQty,
          cumulativeAcceptedQty,
          remainingQty: Math.max(0, orderedQty - cumulativeAcceptedQty),
          fulfillmentPct: orderedQty > 0 ? Math.min(100, Math.round((cumulativeAcceptedQty / orderedQty) * 1000) / 10) : 0,
        },
      },
      201
    );
  });

  // =========================================================================
  // 4. CREDIT NOTE / DEBIT NOTE VOUCHER LEDGER (Settles Disputed Leaks!)
  // =========================================================================
  app.get('/api/credit-notes', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const rows = await db
      .select()
      .from(schema.creditNotes)
      .where(eq(schema.creditNotes.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.creditNotes.createdAt));
    return c.json(rows);
  });

  app.post('/api/credit-notes', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const body = await c.req.json<{
      invoiceId: string;
      voucherType?: 'credit_note' | 'debit_note';
      voucherNumber: string;
      voucherDate?: string;
      taxableRupees: number;
      cgstRupees?: number;
      sgstRupees?: number;
      igstRupees?: number;
      reason: string;
    }>();

    if (
      !body.invoiceId ||
      !body.voucherNumber?.trim() ||
      !body.reason?.trim() ||
      !Number.isFinite(body.taxableRupees) ||
      body.taxableRupees <= 0
    ) {
      return c.json(
        { error: 'invoiceId, voucherNumber, reason, and taxableRupees > 0 are required.' },
        400
      );
    }

    const [inv] = await db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.id, body.invoiceId), eq(schema.invoices.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!inv) return c.json({ error: 'Invoice not found in this workspace.' }, 404);

    // Duplicate voucher guard per supplier
    const dup = await db
      .select({ id: schema.creditNotes.id })
      .from(schema.creditNotes)
      .where(
        and(
          eq(schema.creditNotes.workspaceId, ctx.workspaceId),
          eq(schema.creditNotes.supplierId, inv.supplierId),
          eq(schema.creditNotes.voucherNumber, body.voucherNumber.trim())
        )
      )
      .limit(1);
    if (dup.length > 0) {
      return c.json({ error: `Voucher ${body.voucherNumber} already recorded for this supplier.` }, 409);
    }

    const taxablePaise = toPaise(body.taxableRupees);
    const cgstPaise = toPaise(body.cgstRupees ?? 0);
    const sgstPaise = toPaise(body.sgstRupees ?? 0);
    const igstPaise = toPaise(body.igstRupees ?? 0);
    const totalPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
    const voucherType = body.voucherType === 'debit_note' ? 'debit_note' : 'credit_note';

    const [created] = await db
      .insert(schema.creditNotes)
      .values({
        id: uid('cn'),
        workspaceId: ctx.workspaceId,
        invoiceId: inv.id,
        supplierId: inv.supplierId,
        voucherType,
        voucherNumber: body.voucherNumber.trim(),
        voucherDate: body.voucherDate || todayIso(),
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalPaise,
        reason: body.reason.trim(),
        status: 'applied',
        createdBy: ctx.email,
      })
      .returning();

    // Calculate cumulative credits on this invoice & settle linked money_leaks if covered
    const allCredits = await db
      .select()
      .from(schema.creditNotes)
      .where(and(eq(schema.creditNotes.invoiceId, inv.id), eq(schema.creditNotes.workspaceId, ctx.workspaceId)));
    const totalCreditedPaise = allCredits.reduce((s, cn) => s + cn.totalPaise, 0);
    const totalCreditedTaxablePaise = allCredits.reduce((s, cn) => s + cn.taxablePaise, 0);

    let leaksSettled = 0;
    if (totalCreditedPaise >= inv.totalMoneyLeakPaise || totalCreditedTaxablePaise >= inv.totalMoneyLeakPaise) {
      const openLeaks = await db
        .select()
        .from(schema.moneyLeaks)
        .where(and(eq(schema.moneyLeaks.invoiceId, inv.id), eq(schema.moneyLeaks.workspaceId, ctx.workspaceId)));

      for (const lk of openLeaks) {
        if (lk.status === 'detected' || lk.status === 'disputed') {
          await db
            .update(schema.moneyLeaks)
            .set({ status: 'recovered', resolvedAt: new Date() })
            .where(eq(schema.moneyLeaks.id, lk.id));
          leaksSettled++;
        }
      }
    }

    await recordAuditLog(db, ctx, 'credit_note_recorded', 'credit_note', created.id, {
      voucherType,
      voucherNumber: created.voucherNumber,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      totalPaise,
      leaksSettled,
    });

    return c.json(
      {
        creditNote: created,
        invoiceSummary: {
          invoiceId: inv.id,
          grandTotalPaise: inv.grandTotalPaise,
          totalCreditedPaise,
          netPayablePaise: Math.max(0, inv.grandTotalPaise - totalCreditedPaise),
          leaksSettled,
        },
      },
      201
    );
  });

  // =========================================================================
  // 5. CRYPTOGRAPHIC AUDIT TRAIL INTEGRITY VERIFIER
  // =========================================================================
  app.get('/api/compliance/audit-logs/verify', async (c) => {
    const ctx = c.get('auth');
    const db = await getDb(helpers.getEnv('DATABASE_URL'));
    const report = await verifyWorkspaceAuditChain(db, ctx.workspaceId);
    return c.json(report);
  });
}
