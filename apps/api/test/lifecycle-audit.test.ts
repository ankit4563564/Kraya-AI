import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { computeGstinChecksum } from '@kraya/finance-engine';
import { createApp } from '../src/app.js';
import { getDb, resetDbCache } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

const mkGstin = (p14: string) => p14 + computeGstinChecksum(p14);

function extractSessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/kraya_session=([^;]+)/);
  if (!match) throw new Error(`Expected kraya_session cookie, got: ${raw}`);
  return `kraya_session=${match[1]}`;
}

describe('Phase 9 & 10 — GRN Partial Deliveries, PO Amend/Cancel, Credit Notes & Tamper-Evident Audit Chain', () => {
  let tmpDir: string;
  let pgDir: string;
  let vaultDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraya-lifecycle-test-'));
    pgDir = path.join(tmpDir, 'pg');
    vaultDir = path.join(tmpDir, 'vault');
    process.env.PGLITE_DATA_DIR = pgDir;
    resetDbCache();
  });

  afterAll(async () => {
    resetDbCache();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('1. Full Indian Factory Lifecycle: PO -> Amend Rev2 -> Partial GRNs -> Split Invoices (3-Way GRN Guard + 43B-h Anchor) -> Credit Note Settlement -> Cancel PO -> SHA-256 Audit Chain Verification & Tamper Detection', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'lifecycle-audit-secret-32-bytes',
      RATE_LIMIT_MAX_AUTH: '100',
    });

    // 1. Signup & Onboarding
    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Vikram Shetty',
        companyName: 'Peenya Packaging India Pvt Ltd',
        email: 'vikram@peenya.in',
        password: 'FactoryPassword123',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const cookie = extractSessionCookie(signupRes);
    const wsId = (await signupRes.json()).workspace.id;

    const obRes = await app.request('/api/workspace/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        legalName: 'Peenya Packaging India Pvt Ltd',
        gstin: mkGstin('29AABCP1111F1Z'),
        gstRegime: 'regular',
        stateCode: '29',
        turnoverBand: '5cr_to_10cr',
        waccPct: 15,
        businessAddress: 'Plot 12, Peenya Phase 2, Bengaluru',
        primaryContactName: 'Vikram Shetty',
        primaryContactPhone: '+91 9845000011',
        primaryContactEmail: 'vikram@peenya.in',
      }),
    });
    expect(obRes.status).toBe(200);

    // 2. Add Small MSME Supplier (45-day Section 43B(h) statutory cap)
    const supRes = await app.request('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Cauvery Board Mills',
        gstin: mkGstin('29AABCC2222F1Z'),
        udyamTier: 'small',
        creditDays: 45,
      }),
    });
    expect(supRes.status).toBe(201);
    const sup = await supRes.json();

    // 3. Create RFQ -> Log Quote -> Approve PO (Rev 1)
    const rfq = await (
      await app.request('/api/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          title: '5,000 5-Ply Cartons',
          itemDescription: '5-Ply Corrugated Box',
          hsnSac: '4819',
          qty: 5000,
          unit: 'pc',
        }),
      })
    ).json();

    const qt = await (
      await app.request('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          rfqId: rfq.id,
          supplierId: sup.id,
          quantity: 5000,
          rawRateRupees: 22,
          rawUnit: 'pc',
          gstPct: 5,
          creditDays: 45,
        }),
      })
    ).json();

    const poRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        quoteId: qt.quote.id,
        approvedBy: 'Vikram Shetty',
        explicitApprovalConfirmed: true,
      }),
    });
    expect(poRes.status).toBe(201);
    const po = (await poRes.json()).po;
    expect(po.revisionNumber).toBe(1);

    // 4. Amend PO -> Rev 2 (6,000 pcs @ ₹21.50/pc)
    const amendRes = await app.request(`/api/pos/${po.id}/amend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        qty: 6000,
        unitRateRupees: 21.5,
        reason: 'Festival batch expanded to 6,000 pcs at negotiated ₹21.50 rate',
      }),
    });
    expect(amendRes.status).toBe(200);
    const amendedPo = await amendRes.json();
    expect(amendedPo.revisionNumber).toBe(2);
    expect(amendedPo.taxablePaise).toBe(6000 * 2150); // ₹1,29,000 exact
    expect(amendedPo.revisionsJson.length).toBe(1);

    // 5. Partial GRN 1 (2,100 received, 2,000 accepted, 100 wet/rejected on 2026-11-10)
    const grn1Res = await app.request('/api/grns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po.id,
        challanNumber: 'DC-001',
        receivedDate: '2026-11-10',
        acceptedDate: '2026-11-10',
        items: [{ itemKey: '5-ply-corrugated-box', receivedQty: 2100, acceptedQty: 2000, rejectedQty: 100 }],
        notes: '100 damp cartons rejected at factory gate',
      }),
    });
    expect(grn1Res.status).toBe(201);
    const grn1 = await grn1Res.json();
    expect(grn1.grn.qcStatus).toBe('partial');
    expect(grn1.poFulfillment.cumulativeAcceptedQty).toBe(2000);

    // 6. Partial GRN 2 (3,000 accepted on 2026-11-15 -> cumulative accepted = 5,000)
    const grn2Res = await app.request('/api/grns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po.id,
        challanNumber: 'DC-002',
        receivedDate: '2026-11-14',
        acceptedDate: '2026-11-15',
        items: [{ itemKey: '5-ply-corrugated-box', receivedQty: 3000, acceptedQty: 3000, rejectedQty: 0 }],
      }),
    });
    expect(grn2Res.status).toBe(201);
    expect((await grn2Res.json()).poFulfillment.cumulativeAcceptedQty).toBe(5000);

    // 7. Split Invoice 1 (2,000 pcs @ ₹21.50 + 5% GST) -> Clean MATCH & 43B-h anchored to 2026-11-15 + 45d = 2026-12-30!
    const inv1Res = await app.request('/api/invoices/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po.id,
        supplierId: sup.id,
        invoiceNumber: 'CBM-INV-101',
        invoiceDate: '2026-11-10',
        itemKey: '5-ply-corrugated-box',
        description: '5-Ply Corrugated Box',
        hsnSac: '4819',
        qty: 2000,
        unit: 'pc',
        unitRateRupees: 21.5,
        gstPct: 5,
        statedTaxableRupees: 43000,
        statedCgstRupees: 1075,
        statedSgstRupees: 1075,
        statedIgstRupees: 0,
        statedGrandTotalRupees: 45150,
      }),
    });
    expect(inv1Res.status).toBe(201);
    const inv1 = await inv1Res.json();
    expect(inv1.audit.poMatchStatus).toBe('partial');
    expect(inv1.audit.imsSuggestedAction).toBe('ACCEPT');
    expect(inv1.audit.totalMoneyLeakPaise).toBe(0);
    expect(inv1.audit.msme43bhDueDate).toBe('2026-12-30'); // 2026-11-15 (GRN acceptance) + 45d!

    // 8. Split Invoice 2 (3,500 pcs @ ₹21.50 -> cumulative billed 5,500 <= PO 6,000, BUT > GRN accepted 5,000!)
    // Must catch the 500-pc unaccepted/undelivered overbilling (500 * ₹21.50 = ₹10,750 = 1,075,000 paise)!
    const inv2Res = await app.request('/api/invoices/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po.id,
        supplierId: sup.id,
        invoiceNumber: 'CBM-INV-102',
        invoiceDate: '2026-11-16',
        itemKey: '5-ply-corrugated-box',
        description: '5-Ply Corrugated Box',
        hsnSac: '4819',
        qty: 3500,
        unit: 'pc',
        unitRateRupees: 21.5,
        gstPct: 5,
        statedTaxableRupees: 75250,
        statedCgstRupees: 1881.25,
        statedSgstRupees: 1881.25,
        statedIgstRupees: 0,
        statedGrandTotalRupees: 79012.5,
      }),
    });
    expect(inv2Res.status).toBe(201);
    const inv2 = await inv2Res.json();
    expect(inv2.audit.poMatchStatus).toBe('mismatch');
    expect(inv2.audit.imsSuggestedAction).toBe('REJECT');
    expect(inv2.audit.flags.some((f: { code: string }) => f.code === 'grn_short_receipt_overbill')).toBe(true);
    expect(inv2.audit.totalMoneyLeakPaise).toBe(1075000); // Exact ₹10,750.00!

    // 9. Supplier issues Credit Note CN-2026-01 for ₹10,750 + 5% GST -> settles leak to 'recovered' & lowers Net Payable!
    const cnRes = await app.request('/api/credit-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        invoiceId: inv2.invoice.id,
        voucherType: 'credit_note',
        voucherNumber: 'CN-2026-01',
        taxableRupees: 10750,
        cgstRupees: 268.75,
        sgstRupees: 268.75,
        igstRupees: 0,
        reason: 'Credit note for 500 unaccepted/short-delivered cartons',
      }),
    });
    expect(cnRes.status).toBe(201);
    const cnData = await cnRes.json();
    expect(cnData.invoiceSummary.leaksSettled).toBe(1);
    expect(cnData.invoiceSummary.netPayablePaise).toBe(7901250 - 1128750); // ₹67,725.00 exact!

    // Summary now reflects recoveredPaise = ₹10,750!
    const summary = await (await app.request('/api/summary', { headers: { Cookie: cookie } })).json();
    expect(summary.recoveredPaise).toBe(1075000);

    // 10. Second PO Cancellation Guard
    const rfq2 = await (
      await app.request('/api/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ title: 'Cancel Test RFQ', itemDescription: 'BOPP Tape', qty: 200, unit: 'roll' }),
      })
    ).json();
    const qt2 = await (
      await app.request('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          rfqId: rfq2.id,
          supplierId: sup.id,
          quantity: 200,
          rawRateRupees: 40,
          rawUnit: 'roll',
          gstPct: 18,
          creditDays: 30,
        }),
      })
    ).json();
    const po2 = (
      await (
        await app.request('/api/pos/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ quoteId: qt2.quote.id, approvedBy: 'Vikram', explicitApprovalConfirmed: true }),
        })
      ).json()
    ).po;

    const cancelRes = await app.request(`/api/pos/${po2.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ reason: 'Vendor missed dispatch window' }),
    });
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).invoiceStatus).toBe('cancelled');

    // GRN against cancelled PO MUST be rejected (400)
    const grnCancelled = await app.request('/api/grns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po2.id,
        items: [{ itemKey: 'bopp-tape', receivedQty: 100, acceptedQty: 100 }],
      }),
    });
    expect(grnCancelled.status).toBe(400);

    // 11. CRYPTOGRAPHIC AUDIT TRAIL VERIFICATION (End-to-End SHA-256 Chain!)
    const verifyRes = await app.request('/api/compliance/audit-logs/verify', {
      headers: { Cookie: cookie },
    });
    expect(verifyRes.status).toBe(200);
    const verify = await verifyRes.json();
    expect(verify.valid).toBe(true);
    expect(verify.totalEntries).toBeGreaterThanOrEqual(14);
    expect(verify.verifiedEntries).toBe(verify.totalEntries);
    expect(verify.latestHash).toMatch(/^[a-f0-9]{64}$/);

    // Check every expected lifecycle action is logged in the audit trail
    const logs = await (
      await app.request('/api/compliance/audit-logs', { headers: { Cookie: cookie } })
    ).json();
    const actions = new Set(logs.map((l: { action: string }) => l.action));
    for (const requiredAction of [
      'auth_signup',
      'company_onboarding_completed',
      'supplier_created',
      'rfq_created',
      'quote_logged',
      'po_approved',
      'po_amended',
      'grn_recorded',
      'invoice_audited',
      'credit_note_recorded',
      'po_cancelled',
    ]) {
      expect(actions.has(requiredAction)).toBe(true);
    }

    // 12. TAMPER DETECTION PROOF: Mutate 1 row directly in Postgres and confirm verifier catches it!
    const db = await getDb();
    const targetLog = logs.find((l: { action: string }) => l.action === 'po_amended');
    await db
      .update(schema.auditLogs)
      .set({ action: 'po_tampered_fake' })
      .where(eq(schema.auditLogs.id, targetLog.id));

    const verifyAfterTamper = await (
      await app.request('/api/compliance/audit-logs/verify', { headers: { Cookie: cookie } })
    ).json();
    expect(verifyAfterTamper.valid).toBe(false);
    expect(verifyAfterTamper.brokenEntryId).toBe(targetLog.id);
    expect(verifyAfterTamper.reason).toContain('Tampered audit entry');
    expect(wsId).toBeTruthy();
  });
});
