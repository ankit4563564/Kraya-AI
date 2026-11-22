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

describe('Concurrency Safety — PO Amendments & GRN Partial Deliveries', () => {
  let tmpDir: string;
  let pgDir: string;
  let vaultDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraya-concurrency-test-'));
    pgDir = path.join(tmpDir, 'pg');
    vaultDir = path.join(tmpDir, 'vault');
    process.env.PGLITE_DATA_DIR = pgDir;
    resetDbCache();
  });

  afterAll(async () => {
    resetDbCache();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('1. Concurrent PO Amendments maintain strict sequential revision numbers without overwriting', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'concurrency-lifecycle-secret-key-32',
      RATE_LIMIT_MAX_AUTH: '500',
    });

    // 1. Signup & Onboarding
    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Arjun Nair',
        companyName: 'Nair Precision Engineering',
        email: 'arjun@nairprecision.in',
        password: 'Password@123',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const cookie = extractSessionCookie(signupRes);

    const obRes = await app.request('/api/workspace/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        legalName: 'Nair Precision Engineering Pvt Ltd',
        gstin: mkGstin('29AAACN1234F1Z'),
        gstRegime: 'regular',
        stateCode: '29',
        turnoverBand: '5cr_to_10cr',
        waccPct: 15,
        businessAddress: 'Plot 10, Industrial Area, Bengaluru',
        primaryContactName: 'Arjun Nair',
        primaryContactPhone: '+91 9845000022',
        primaryContactEmail: 'arjun@nairprecision.in',
      }),
    });
    expect(obRes.status).toBe(200);

    // 2. Supplier
    const supRes = await app.request('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Belgaum Castings Ltd',
        gstin: mkGstin('29AAACB5678L1Z'),
        udyamTier: 'medium',
        creditDays: 30,
      }),
    });
    expect(supRes.status).toBe(201);
    const sup = await supRes.json();

    // 3. RFQ -> Quote -> PO Approve
    const rfqRes = await app.request('/api/rfqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: '1,000 Flange Castings',
        itemDescription: 'Flange 100mm Cast Iron',
        hsnSac: '7325',
        qty: 1000,
        unit: 'pc',
      }),
    });
    expect(rfqRes.status).toBe(201);
    const rfq = await rfqRes.json();

    const quoteRes = await app.request('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        rfqId: rfq.id,
        supplierId: sup.id,
        quantity: 1000,
        rawRateRupees: 250,
        rawUnit: 'pc',
        gstPct: 18,
        creditDays: 30,
      }),
    });
    expect(quoteRes.status).toBe(201);
    const qt = await quoteRes.json();

    const poRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        quoteId: qt.quote.id,
        approvedBy: 'Arjun Nair',
        explicitApprovalConfirmed: true,
      }),
    });
    expect(poRes.status).toBe(201);
    const po = (await poRes.json()).po;
    expect(po.revisionNumber).toBe(1);

    // 4. Concurrently fire 2 amendment requests targeting the same PO
    const [amend1Res, amend2Res] = await Promise.all([
      app.request(`/api/pos/${po.id}/amend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          qty: 1200,
          reason: 'Client requested batch expansion to 1,200',
        }),
      }),
      app.request(`/api/pos/${po.id}/amend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          qty: 1500,
          reason: 'Client finalized quantity at 1,500',
        }),
      }),
    ]);

    expect(amend1Res.status).toBe(200);
    expect(amend2Res.status).toBe(200);

    const amend1 = await amend1Res.json();
    const amend2 = await amend2Res.json();

    const revisions = [amend1.revisionNumber, amend2.revisionNumber].sort((a, b) => a - b);
    expect(revisions).toEqual([2, 3]);

    // 5. Verify DB state & revision history
    const db = await getDb();
    const [finalPo] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, po.id));

    expect(finalPo.revisionNumber).toBe(3);
    const revHistory = finalPo.revisionsJson as any[];
    expect(revHistory.length).toBe(2);
    expect(revHistory[0].revisionNumber).toBe(1);
    expect(revHistory[1].revisionNumber).toBe(2);

    // 6. Stale amendment with expectedRevision: 1 MUST fail with 409 Conflict
    const staleAmendRes = await app.request(`/api/pos/${po.id}/amend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        qty: 2000,
        expectedRevision: 1,
        reason: 'Attempting amendment on outdated Revision 1',
      }),
    });
    expect(staleAmendRes.status).toBe(409);
    expect((await staleAmendRes.json()).error).toContain('Conflict');
  });

  it('2. Concurrent GRN submissions cannot exceed ordered PO quantity and rollback on over-delivery', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'concurrency-lifecycle-secret-key-32',
      RATE_LIMIT_MAX_AUTH: '500',
    });

    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sunita Rao',
        companyName: 'Rao Auto Components',
        email: 'sunita@raoauto.in',
        password: 'Password@123',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const cookie = extractSessionCookie(signupRes);

    const ob2Res = await app.request('/api/workspace/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        legalName: 'Rao Auto Components Ltd',
        gstin: mkGstin('29AAACR4321F1Z'),
        gstRegime: 'regular',
        stateCode: '29',
        turnoverBand: '5cr_to_10cr',
        waccPct: 15,
        businessAddress: 'Plot 15, Auto Complex, Hubli',
        primaryContactName: 'Sunita Rao',
        primaryContactPhone: '+91 9845000033',
        primaryContactEmail: 'sunita@raoauto.in',
      }),
    });
    expect(ob2Res.status).toBe(200);

    const supRes = await app.request('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Hubli Springs & Fasteners',
        gstin: mkGstin('29AAACH8765L1Z'),
        udyamTier: 'small',
        creditDays: 30,
      }),
    });
    expect(supRes.status).toBe(201);
    const sup = await supRes.json();

    // Create PO for exactly 500 units
    const rfqRes = await app.request('/api/rfqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: '500 Compression Springs',
        itemDescription: 'Compression Spring CS50',
        hsnSac: '7320',
        qty: 500,
        unit: 'pc',
      }),
    });
    expect(rfqRes.status).toBe(201);
    const rfq = await rfqRes.json();

    const quoteRes = await app.request('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        rfqId: rfq.id,
        supplierId: sup.id,
        quantity: 500,
        rawRateRupees: 50,
        rawUnit: 'pc',
        gstPct: 18,
        creditDays: 30,
      }),
    });
    expect(quoteRes.status).toBe(201);
    const qt = await quoteRes.json();

    const poRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        quoteId: qt.quote.id,
        approvedBy: 'Sunita Rao',
        explicitApprovalConfirmed: true,
      }),
    });
    expect(poRes.status).toBe(201);
    const po = (await poRes.json()).po;

    // Two simultaneous deliveries at gate:
    // Truck A brings 350 units (accepted: 350)
    // Truck B brings 300 units (accepted: 300)
    // Total attempted = 650 > 500! Exactly ONE must succeed, and the other MUST be rejected!
    const [grnA, grnB] = await Promise.all([
      app.request('/api/grns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          poId: po.id,
          challanNumber: 'DC-TRUCK-A',
          receivedDate: '2026-11-22',
          items: [{ itemKey: 'compression-spring-cs50', receivedQty: 350, acceptedQty: 350, rejectedQty: 0 }],
        }),
      }),
      app.request('/api/grns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          poId: po.id,
          challanNumber: 'DC-TRUCK-B',
          receivedDate: '2026-11-22',
          items: [{ itemKey: 'compression-spring-cs50', receivedQty: 300, acceptedQty: 300, rejectedQty: 0 }],
        }),
      }),
    ]);

    const statuses = [grnA.status, grnB.status].sort();
    expect(statuses).toEqual([201, 400]);

    const rejectedRes = grnA.status === 400 ? grnA : grnB;
    const acceptedRes = grnA.status === 201 ? grnA : grnB;

    const rejectedBody = await rejectedRes.json();
    const acceptedBody = await acceptedRes.json();

    expect(rejectedBody.error).toMatch(/exceeds (?:ordered PO quantity|PO ordered quantity)/i);
    expect(acceptedBody.poFulfillment.cumulativeAcceptedQty).toBeLessThanOrEqual(500);

    // Verify DB integrity: Only 1 GRN was created, cumulative quantity is not corrupted
    const db = await getDb();
    const grnRows = await db
      .select()
      .from(schema.grnReceipts)
      .where(eq(schema.grnReceipts.poId, po.id));

    expect(grnRows.length).toBe(1);
    const dbAcceptedTotal = (grnRows[0].itemsJson as any[]).reduce((s, i) => s + i.acceptedQty, 0);
    expect(dbAcceptedTotal).toBe(acceptedBody.poFulfillment.cumulativeAcceptedQty);
  });

  it('3. Concurrent valid partial deliveries succeed sequentially and preserve consistent quantities', async () => {
    const app = createApp({
      LOCAL_VAULT_DIR: vaultDir,
      REQUIRE_AUTH: 'true',
      SESSION_SECRET: 'concurrency-lifecycle-secret-key-32',
      RATE_LIMIT_MAX_AUTH: '500',
    });

    const signupRes = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pooja Hegde',
        companyName: 'Hegde Motors Pvt Ltd',
        email: 'pooja@hegdemotors.in',
        password: 'Password@123',
        dpdpConsentAccepted: true,
      }),
    });
    expect(signupRes.status).toBe(201);
    const cookie = extractSessionCookie(signupRes);

    const ob3Res = await app.request('/api/workspace/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        legalName: 'Hegde Motors Pvt Ltd',
        gstin: mkGstin('29AAACH9999F1Z'),
        gstRegime: 'regular',
        stateCode: '29',
        turnoverBand: '5cr_to_10cr',
        waccPct: 15,
        businessAddress: 'Plot 22, Industrial Estate, Shimoga',
        primaryContactName: 'Pooja Hegde',
        primaryContactPhone: '+91 9845000044',
        primaryContactEmail: 'pooja@hegdemotors.in',
      }),
    });
    expect(ob3Res.status).toBe(200);

    const supRes = await app.request('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Shimoga Gaskets & Seals',
        gstin: mkGstin('29AAACS1122L1Z'),
        udyamTier: 'micro',
        creditDays: 15,
      }),
    });
    expect(supRes.status).toBe(201);
    const sup = await supRes.json();

    // Create PO for 300 units
    const rfqRes = await app.request('/api/rfqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: '300 Engine Gaskets',
        itemDescription: 'Engine Gasket Set',
        hsnSac: '8484',
        qty: 300,
        unit: 'pc',
      }),
    });
    expect(rfqRes.status).toBe(201);
    const rfq = await rfqRes.json();

    const quoteRes = await app.request('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        rfqId: rfq.id,
        supplierId: sup.id,
        quantity: 300,
        rawRateRupees: 120,
        rawUnit: 'pc',
        gstPct: 18,
        creditDays: 15,
      }),
    });
    expect(quoteRes.status).toBe(201);
    const qt = await quoteRes.json();

    const poRes = await app.request('/api/pos/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        quoteId: qt.quote.id,
        approvedBy: 'Pooja Hegde',
        explicitApprovalConfirmed: true,
      }),
    });
    expect(poRes.status).toBe(201);
    const po = (await poRes.json()).po;

    // Concurrently deliver two valid partials:
    // Delivery 1: received 120, accepted 100, rejected 20
    // Delivery 2: received 150, accepted 150, rejected 0
    // Total accepted: 100 + 150 = 250 <= 300. BOTH MUST SUCCEED!
    const [p1Res, p2Res] = await Promise.all([
      app.request('/api/grns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          poId: po.id,
          challanNumber: 'PART-1',
          items: [{ itemKey: 'engine-gasket-set', receivedQty: 120, acceptedQty: 100, rejectedQty: 20 }],
        }),
      }),
      app.request('/api/grns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          poId: po.id,
          challanNumber: 'PART-2',
          items: [{ itemKey: 'engine-gasket-set', receivedQty: 150, acceptedQty: 150, rejectedQty: 0 }],
        }),
      }),
    ]);

    expect(p1Res.status).toBe(201);
    expect(p2Res.status).toBe(201);

    const db = await getDb();
    const grns = await db
      .select()
      .from(schema.grnReceipts)
      .where(eq(schema.grnReceipts.poId, po.id));

    expect(grns.length).toBe(2);

    const totalAccepted = grns.reduce((s, g) => {
      const items = g.itemsJson as any[];
      return s + items.reduce((is, item) => is + item.acceptedQty, 0);
    }, 0);
    const totalRejected = grns.reduce((s, g) => {
      const items = g.itemsJson as any[];
      return s + items.reduce((is, item) => is + item.rejectedQty, 0);
    }, 0);

    expect(totalAccepted).toBe(250);
    expect(totalRejected).toBe(20);

    // Final delivery of remaining 50 units
    const finalGrnRes = await app.request('/api/grns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po.id,
        challanNumber: 'PART-FINAL',
        items: [{ itemKey: 'engine-gasket-set', receivedQty: 50, acceptedQty: 50, rejectedQty: 0 }],
      }),
    });
    expect(finalGrnRes.status).toBe(201);
    const finalGrn = await finalGrnRes.json();
    expect(finalGrn.poFulfillment.cumulativeAcceptedQty).toBe(300);
    expect(finalGrn.poFulfillment.remainingQty).toBe(0);
    expect(finalGrn.poFulfillment.fulfillmentPct).toBe(100);

    // Any further delivery attempt must now be completely rejected (0 remaining)
    const excessGrnRes = await app.request('/api/grns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        poId: po.id,
        items: [{ itemKey: 'engine-gasket-set', receivedQty: 10, acceptedQty: 10, rejectedQty: 0 }],
      }),
    });
    expect(excessGrnRes.status).toBe(400);
    expect((await excessGrnRes.json()).error).toContain('exceeds');
  });
});
