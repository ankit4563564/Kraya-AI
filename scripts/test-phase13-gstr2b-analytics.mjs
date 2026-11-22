import {
  parseGstr2bPayload,
  reconcileGstr2b,
  exportImsActionCsv,
  toPaise,
  computeGstinChecksum,
} from '../packages/finance-engine/dist/index.js';
import { createApp } from '../apps/api/dist/app.js';
import { resetDbCache } from '../apps/api/dist/db/client.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

console.log('=== Kraya Phase 13 — GSTR-2B / IMS Reconciliation & CFO Intelligence Test Suite ===\n');

let passed = 0;
let total = 0;

function assert(cond, msg) {
  total++;
  if (cond) {
    passed++;
    console.log(`  ✓ PASS: ${msg}`);
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('--- Part 1: Deterministic GSTR-2B JSON & CSV Parsing ---');
  const gstnJson = {
    data: {
      docdata: {
        b2b: [
          {
            ctin: '29AABCP1234D1Z5',
            trdnm: 'Peenya Packaging Pvt Ltd',
            inv: [
              {
                inum: 'INV-26-27-1',
                dt: '15-11-2026',
                val: 118000,
                itcavl: 'Y',
                items: [{ txval: 100000, cgst: 9000, sgst: 9000, igst: 0 }],
              },
              {
                inum: 'INV-26-27-2',
                dt: '16-11-2026',
                val: 59000,
                itcavl: 'Y',
                items: [{ txval: 50000, cgst: 4500, sgst: 4500, igst: 0 }],
              },
              {
                inum: 'INV-26-27-99',
                dt: '18-11-2026',
                val: 23600,
                itcavl: 'Y',
                items: [{ txval: 20000, cgst: 1800, sgst: 1800, igst: 0 }],
              },
            ],
          },
          {
            ctin: '27AAACK5671C1ZL',
            trdnm: 'Pune Steel Works',
            inv: [
              {
                inum: 'PSW/2026/005',
                dt: '17-11-2026',
                val: 125000,
                itcavl: 'Y',
                items: [{ txval: 100000, igst: 25000, cgst: 0, sgst: 0 }],
              },
            ],
          },
        ],
      },
    },
  };

  const parsedJson = parseGstr2bPayload(gstnJson);
  assert(parsedJson.length === 4, `Parsed 4 B2B entries from official GSTN GSTR-2B JSON`);
  assert(parsedJson[0].totalTaxPaise === toPaise(18000), `Exact integer paise tax extracted (₹18,000 = 1800000 paise)`);

  const csvPayload = [
    'gstin,supplierName,invoiceNumber,invoiceDate,taxableValue,cgst,sgst,igst,totalValue',
    '29AABCP1234D1Z5,Peenya Packaging Pvt Ltd,INV/26-27/001,2026-11-15,100000,9000,9000,0,118000',
  ].join('\n');
  const parsedCsv = parseGstr2bPayload(csvPayload);
  assert(parsedCsv.length === 1, `Parsed 1 B2B entry from CSV payload`);
  assert(parsedCsv[0].grandTotalPaise === toPaise(118000), `CSV grand total parsed in exact paise`);

  console.log('\n--- Part 2: Deterministic IMS Classification & Sec 16(2)(aa)/(b) Guardrails ---');
  const bookInvoices = [
    {
      id: 'inv-1',
      supplierName: 'Peenya Packaging Pvt Ltd',
      supplierPhone: '9845112233',
      supplierGstin: '29AABCP1234D1Z5',
      invoiceNumber: 'INV/26-27/001', // Should match INV-26-27-1 via normalized matching!
      taxablePaise: toPaise(100000),
      gstPaise: toPaise(18000),
      grandTotalPaise: toPaise(118000),
      auditStatus: 'clean',
      grnAccepted: true,
    },
    {
      id: 'inv-2',
      supplierName: 'Peenya Packaging Pvt Ltd',
      supplierPhone: '9845112233',
      supplierGstin: '29AABCP1234D1Z5',
      invoiceNumber: 'INV-26-27-2',
      taxablePaise: toPaise(50000),
      gstPaise: toPaise(9000),
      grandTotalPaise: toPaise(59000),
      auditStatus: 'clean',
      grnAccepted: false, // Goods not yet GRN-accepted -> Sec 16(2)(b) KEEP_PENDING!
    },
    {
      id: 'inv-3',
      supplierName: 'Pune Steel Works',
      supplierPhone: '9822001122',
      supplierGstin: '27AAACK5671C1ZL',
      invoiceNumber: 'PSW/2026/005',
      taxablePaise: toPaise(100000),
      gstPaise: toPaise(18000), // Portal has 25000 -> VALUE_MISMATCH + REJECT
      grandTotalPaise: toPaise(118000),
      auditStatus: 'clean',
      grnAccepted: true,
    },
    {
      id: 'inv-4',
      supplierName: 'Defaulting Trader Co',
      supplierPhone: '9880998877',
      supplierGstin: '29AADCD9999E1Z1',
      invoiceNumber: 'DTC-884',
      taxablePaise: toPaise(40000),
      gstPaise: toPaise(7200), // Not filed in GSTR-2B -> MISSING_IN_2B + WhatsApp chase!
      grandTotalPaise: toPaise(47200),
      auditStatus: 'clean',
      grnAccepted: true,
    },
  ];

  const recon = reconcileGstr2b(bookInvoices, parsedJson, { tolerancePaise: 100 });
  assert(recon.matchedCount === 2, `Matched 2 invoices (including normalized INV/26-27/001 <-> INV-26-27-1)`);
  assert(recon.mismatchCount === 1, `Flagged 1 value mismatch (Pune Steel Works GST variance)`);
  assert(recon.missingIn2bCount === 1, `Flagged 1 invoice missing in GSTR-2B (Defaulting Trader Co)`);
  assert(recon.missingInBooksCount === 1, `Flagged 1 unbooked portal bill (INV-26-27-99)`);
  assert(recon.safeClaimableItcPaise === toPaise(18000), `Safe claimable ITC is exactly ₹18,000 (excluding GRN-pending bill)`);

  const item1 = recon.items.find((i) => i.bookInvoiceId === 'inv-1');
  const item2 = recon.items.find((i) => i.bookInvoiceId === 'inv-2');
  const item3 = recon.items.find((i) => i.bookInvoiceId === 'inv-3');
  const item4 = recon.items.find((i) => i.bookInvoiceId === 'inv-4');
  const itemUnbooked = recon.items.find((i) => i.status === 'MISSING_IN_BOOKS');

  assert(item1?.imsAction === 'ACCEPT', `Clean matched GRN-accepted bill marked IMS: ACCEPT`);
  assert(item2?.imsAction === 'KEEP_PENDING', `GRN-unaccepted bill marked IMS: KEEP_PENDING per Sec 16(2)(b)`);
  assert(item3?.imsAction === 'REJECT' && item3.taxDiffPaise === toPaise(7000), `Over-billed portal GST marked IMS: REJECT with exact ₹7,000 variance`);
  assert(item4?.status === 'MISSING_IN_2B' && item4.whatsappChaseUrl?.startsWith('https://wa.me/919880998877'), `Missing-in-2B bill generates 1-click Hinglish WhatsApp GSTR-1 chase link`);
  assert(itemUnbooked?.imsAction === 'KEEP_PENDING', `Unbooked portal invoice marked IMS: KEEP_PENDING`);

  const csvOut = exportImsActionCsv(recon);
  assert(csvOut.includes('IMS Action') && csvOut.includes('KEEP_PENDING') && csvOut.includes('MISSING_IN_2B'), `CA-ready IMS CSV exported cleanly`);

  console.log('\n--- Part 3: Live API Integration (GSTR-2B Reconcile + CFO Intelligence) ---');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraya-p13-'));
  process.env.PGLITE_DATA_DIR = tmpDir;
  resetDbCache();

  const app = createApp({ REQUIRE_AUTH: 'true', NODE_ENV: 'test' });

  const signupRes = await app.request('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'CFO Owner',
      companyName: 'Kraya Precision Mfg',
      email: 'cfo-p13@kraya.in',
      password: 'Password123!',
      dpdpConsentAccepted: true,
    }),
  });
  const setCookie = signupRes.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  assert(signupRes.status === 201 && Boolean(cookie), `Workspace created and session cookie issued`);

  // Add a supplier with a valid Mod-36 GSTIN
  const validGstin = `29AABCP1234D1Z${computeGstinChecksum('29AABCP1234D1Z')}`;
  const supRes = await app.request('/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: 'Peenya Packaging Pvt Ltd',
      phone: '9845112233',
      category: 'Packaging',
      gstin: validGstin,
      stateCode: '29',
      gstRegime: 'regular',
      udyamTier: 'small',
      creditDays: 30,
    }),
  });
  const sup = await supRes.json();
  assert(supRes.status === 201 && Boolean(sup.id), `Supplier added to workspace`);

  // Call GSTR-2B reconcile API (JSON + CSV)
  const recJsonRes = await app.request('/api/gst/gstr2b-reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ payload: gstnJson, tolerancePaise: 100 }),
  });
  const recJson = await recJsonRes.json();
  assert(recJsonRes.status === 200 && recJson.totalPortalEntries === 4, `POST /api/gst/gstr2b-reconcile returns 200 with 4 portal entries`);

  const recCsvRes = await app.request('/api/gst/gstr2b-reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ payload: gstnJson, format: 'csv' }),
  });
  const recCsvText = await recCsvRes.text();
  assert(recCsvRes.status === 200 && recCsvText.includes('IMS Action'), `POST /api/gst/gstr2b-reconcile (format=csv) returns valid CSV`);

  // Call CFO Intelligence Analytics API
  const intelRes = await app.request('/api/analytics/cfo-intelligence', {
    headers: { Cookie: cookie },
  });
  const intel = await intelRes.json();
  assert(
    intelRes.status === 200 &&
      intel.totals &&
      typeof intel.totals.totalPoSpendPaise === 'number' &&
      Array.isArray(intel.priceCreepAlerts) &&
      Array.isArray(intel.paymentCliffs),
    `GET /api/analytics/cfo-intelligence returns structured integer-paise CFO intelligence`
  );

  await fs.rm(tmpDir, { recursive: true, force: true });

  console.log(`\n======================================================`);
  console.log(`Phase 13 GSTR-2B & CFO Intelligence Results: ${passed}/${total} PASSED`);
  console.log(`======================================================\n`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
