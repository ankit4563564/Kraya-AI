import { searchSuppliersRealtime } from '../packages/agent-core/dist/supplier-search.js';
import { validateGstin } from '../packages/finance-engine/dist/gstin.js';
import { readFileSync } from 'fs';

console.log('=== Kraya Real-Time Supplier Discovery & Logical Evaluation Suite ===\n');

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  }
}

async function runLogicalTests() {
  console.log('--- Test 1: Grounded Sourcing with Complex "Ifs and Buts" ---');
  const res1 = await searchSuppliersRealtime(
    {
      query: '5-ply corrugated master cartons 180 GSM',
      category: 'Packaging',
      buyerCity: 'Bengaluru',
      buyerPincode: '560058',
      buyerStateCode: '29',
      targetRateMaxRupees: 28.0,
      minCreditDays: 30,
      buyerWaccPct: 14.0,
      specificCriteria: 'Must be within 35 km of Peenya, strictly require Net 30 days credit, active regular GSTIN for 100% ITC, target under ₹28/unit'
    },
    env.GEMINI_API_KEY,
    env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
  );

  assert(res1.suppliers.length >= 2, `Discovered at least 2 candidates (found ${res1.suppliers.length})`);
  assert(res1.engine === 'gemini_flash_grounded', `Engine executed live grounded Gemini AI (${res1.engine})`);

  for (const s of res1.suppliers) {
    assert(s.businessName.length > 3, `Supplier business name valid: "${s.businessName}"`);
    assert(s.estimatedRatePerUnit > 0, `Estimated rate positive: ₹${s.estimatedRatePerUnit}`);
    assert(s.creditAdjustedRate <= s.estimatedRatePerUnit, `Credit-adjusted rate ₹${s.creditAdjustedRate} reflects working-capital credit benefit vs base ₹${s.estimatedRatePerUnit}`);
    assert(s.typicalCreditDays >= 15, `Supplier credit terms evaluated: Net ${s.typicalCreditDays}d`);
    assert(s.matchScore >= 50 && s.matchScore <= 100, `Match score calibrated: ${s.matchScore}/100`);
    assert(s.gstin.length === 15, `GSTIN is 15 characters: ${s.gstin}`);
    assert(s.whatsAppBridgeUrl.startsWith('https://wa.me/'), `1-click WhatsApp outreach bridge generated: ${s.whatsAppBridgeUrl.slice(0, 40)}...`);

    const gstinCheck = validateGstin(s.gstin);
    assert(gstinCheck.stateCode === '29', `Supplier GSTIN matches Karnataka state code 29`);
    assert(s.taxRouting === 'intra_state', `Intra-state CGST+SGST tax routing correctly determined relative to Bengaluru buyer`);
  }

  assert(res1.marketAnalysis.prevailingMarketRate > 0, `Market prevailing rate extracted: ₹${res1.marketAnalysis.prevailingMarketRate}`);
  assert(res1.marketAnalysis.hsnSacSuggested.length >= 2, `Suggested HSN extracted: ${res1.marketAnalysis.hsnSacSuggested}`);
  assert(res1.currencyBenchmark?.usdInrRate > 70, `Commodity parity forex rate live: ₹${res1.currencyBenchmark?.usdInrRate.toFixed(2)}/USD`);

  console.log('\n--- Test 2: Deterministic Fallback Resilience (No API Key) ---');
  const res2 = await searchSuppliersRealtime(
    {
      query: 'Stainless Steel 304 Hex Bolts M10x60',
      category: 'Metals',
      buyerCity: 'Pune',
      buyerPincode: '411018',
      buyerStateCode: '27', // Maharashtra
      targetRateMaxRupees: 15.0,
      minCreditDays: 45,
      buyerWaccPct: 15.0,
      specificCriteria: 'Need 45 days credit, supplier must be local to Chakan / Bhosari MIDC'
    },
    '' // Blank API key to test zero-network fallback
  );

  assert(res2.engine === 'deterministic_fallback', `Graceful fallback to deterministic logic on empty key`);
  assert(res2.suppliers.length >= 2, `Fallback produced 2 high-grade industrial candidates`);
  assert(res2.suppliers[0].stateCode === '27', `Fallback correctly respected buyer Maharashtra state code 27`);
  assert(res2.suppliers[0].taxRouting === 'intra_state', `Intra-state tax routing preserved in fallback`);
  assert(res2.suppliers[0].gstinValid === true, `Fallback GSTIN passes 100% Mod-36 checksum`);

  console.log(`\n======================================================`);
  console.log(`Logical Supplier Search Test Results: ${passed}/${total} PASSED`);
  console.log(`======================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runLogicalTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
