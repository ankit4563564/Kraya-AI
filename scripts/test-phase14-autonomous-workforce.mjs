import {
  parseBomIndentTable,
  planAutonomousProcurementSweep,
  generateZohoBooksBillsCsv,
} from '../packages/agent-core/dist/index.js';
import { toPaise } from '../packages/finance-engine/dist/index.js';
import { createApp } from '../apps/api/dist/app.js';
import { resetDbCache } from '../apps/api/dist/db/client.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

console.log('=== Kraya Phase 14 — Autonomous Procurement Workforce Test Suite ===\n');

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
  console.log('--- Part 1: Bulk BOM / Purchase Indent Parser (Zero Manual Data Entry) ---');
  const bomCsv = [
    'item,qty,unit,category,hsn,targetRate,creditDays,dueDate',
    '5-Ply Corrugated Master Carton 180 GSM,5000,pcs,Packaging,4819,26.50,30,2026-12-05',
    'SS304 Hex Bolt M8x50,10000,nos,Fasteners,7318,,45,2026-12-10',
    'Bad Row Missing Qty,0,pcs,Packaging,4819,10,30,2026-12-10',
  ].join('\n');

  const parsedBom = parseBomIndentTable(bomCsv);
  assert(parsedBom.validRows.length === 2, `Parsed 2 valid BOM rows from CSV`);
  assert(parsedBom.skippedRows.length === 1, `Cleanly skipped 1 invalid row (qty=0)`);
  assert(parsedBom.validRows[0].targetRatePaise === toPaise(26.5), `Exact integer paise rate (₹26.50 = 2650 paise)`);
  assert(parsedBom.validRows[1].targetRatePaise === null, `Missing rate stayed null (Accio invariant: never invented)`);

  const bomTsv = 'Description\tQty\tUOM\nKraft Paper Roll 140 GSM\t12\tMT';
  const parsedTsv = parseBomIndentTable(bomTsv);
  assert(parsedTsv.validRows.length === 1 && parsedTsv.validRows[0].unit === 'MT', `Parsed Excel-pasted TSV BOM cleanly`);

  console.log('\n--- Part 2: Autonomous Expeditor, KYC Officer & Compliance Sweep ---');
  const sweepPlan = planAutonomousProcurementSweep({
    todayIso: '2026-11-22',
    rfqs: [
      { id: 'rfq-1', rfqNumber: 'RFQ-2026-0001', title: 'Master Cartons', status: 'open', quoteCount: 1, createdAt: '2026-11-20T08:00:00Z' },
    ],
    pos: [
      { id: 'po-1', poNumber: 'PO-2026-0001', supplierId: 'sup-1', supplierName: 'Peenya Packaging', deliveryDueAt: '2026-11-20', invoiceStatus: 'pending', cancelledAt: null, hasFullGrn: false },
    ],
    invoices: [
      { id: 'inv-1', invoiceNumber: 'INV-101', supplierId: 'sup-1', supplierName: 'Peenya Packaging', grandTotalPaise: toPaise(118000), msme43bhDueAt: '2026-11-25', rule37CliffAt: '2026-12-10', paidAt: null },
    ],
    amcs: [
      { id: 'amc-1', assetName: 'CNC Lathe #2', supplierId: 'sup-2', supplierName: 'Apex Maintenance', nextDueAt: '2026-11-24', status: 'active' },
    ],
    suppliers: [
      { id: 'sup-1', name: 'Peenya Packaging', phone: '9845112233', email: null, gstin: null, gstRegime: 'regular', udyamTier: 'unknown', creditDays: 30 },
    ],
    existingOpenTasks: [],
  });

  assert(sweepPlan.summary.staleRfqsFound === 1, `Detected 1 stale RFQ (>20h with <2 quotes)`);
  assert(sweepPlan.summary.overdueDeliveriesFound === 1, `Detected 1 overdue PO delivery`);
  assert(sweepPlan.summary.msmeCliffsFound === 1, `Detected 1 upcoming MSME 43B(h) payment cliff (<=7d)`);
  assert(sweepPlan.summary.rule37CliffsFound === 1, `Detected 1 upcoming GST Rule 37 180-day cliff (<=30d)`);
  assert(sweepPlan.summary.amcsDueFound === 1, `Detected 1 upcoming AMC renewal (<=7d)`);
  assert(sweepPlan.summary.incompleteKycSuppliers === 1, `Detected 1 supplier with incomplete KYC`);
  assert(sweepPlan.plannedTasks.length === 6, `Generated 6 prioritized autonomous follow-up tasks`);
  assert(sweepPlan.kycScores[0].scorePct === 40 && sweepPlan.kycScores[0].whatsappKycUrl.startsWith('https://wa.me/919845112233'), `Computed KYC score (40%) + 1-click WhatsApp KYC chase URL`);

  console.log('\n--- Part 3: Zoho Books Bills Import CSV Exporter ---');
  const zohoCsv = generateZohoBooksBillsCsv([
    {
      billNumber: 'INV-101',
      billDate: '2026-11-15',
      dueDate: '2026-12-15',
      vendorName: 'Peenya Packaging',
      vendorGstin: '29AABCP1234D1Z5',
      taxablePaise: toPaise(100000),
      cgstPaise: toPaise(9000),
      sgstPaise: toPaise(9000),
      igstPaise: 0,
      grandTotalPaise: toPaise(118000),
      notes: 'Kraya Verified',
    },
  ]);
  assert(zohoCsv.includes('Bill Number') && zohoCsv.includes('CGST+SGST') && zohoCsv.includes('118000.00'), `Generated valid Zoho Books Bills CSV`);

  console.log('\n--- Part 4: Live API Integration (Bulk BOM + Autonomous Sweep + Zoho CSV) ---');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraya-p14-'));
  process.env.PGLITE_DATA_DIR = tmpDir;
  resetDbCache();

  const app = createApp({ REQUIRE_AUTH: 'true', NODE_ENV: 'test' });
  const signupRes = await app.request('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Auto Owner',
      companyName: 'Kraya Autonomous Factory',
      email: 'auto-p14@kraya.in',
      password: 'Password123!',
      dpdpConsentAccepted: true,
    }),
  });
  const cookie = (signupRes.headers.get('set-cookie') || '').split(';')[0];
  assert(signupRes.status === 201 && Boolean(cookie), `Workspace created for Phase 14 API test`);

  // Add incomplete KYC supplier
  await app.request('/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: 'Incomplete KYC Vendor',
      phone: '9845001122',
      category: 'Packaging',
      gstRegime: 'regular',
      udyamTier: 'unknown',
      creditDays: 30,
    }),
  });

  // Bulk import BOM CSV
  const importRes = await app.request('/api/rfqs/bulk-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ csvText: bomCsv }),
  });
  const importData = await importRes.json();
  assert(importRes.status === 201 && importData.createdCount === 2, `POST /api/rfqs/bulk-import batch-created 2 RFQs`);

  // Run autonomous sweep #1
  const sweep1Res = await app.request('/api/automation/run-sweep', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const sweep1 = await sweep1Res.json();
  assert(sweep1Res.status === 200 && sweep1.createdTasksCount >= 1 && sweep1.summary.incompleteKycSuppliers === 1, `POST /api/automation/run-sweep queued KYC chase task`);

  // Run autonomous sweep #2 -> must deduplicate (0 new duplicate tasks!)
  const sweep2Res = await app.request('/api/automation/run-sweep', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const sweep2 = await sweep2Res.json();
  assert(sweep2Res.status === 200 && sweep2.createdTasksCount === 0, `Second sweep is idempotent (0 duplicate tasks created)`);

  // Export Zoho Books CSV
  const zohoRes = await app.request('/api/exports/zoho-books.csv', {
    headers: { Cookie: cookie },
  });
  const zohoText = await zohoRes.text();
  assert(zohoRes.status === 200 && zohoText.includes('Bill Number'), `GET /api/exports/zoho-books.csv returns 200 CSV`);

  await fs.rm(tmpDir, { recursive: true, force: true });

  console.log(`\n======================================================`);
  console.log(`Phase 14 Autonomous Workforce Results: ${passed}/${total} PASSED`);
  console.log(`======================================================\n`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
