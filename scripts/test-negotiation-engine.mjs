import { buildNegotiationStrategy } from '../packages/agent-core/dist/negotiation.js';

console.log('=== Kraya Phase 12 — AI Multi-Quote Negotiation Engine Test ===\n');

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

const quotes = [
  {
    quoteId: 'q1',
    supplierId: 's1',
    supplierName: 'Sri Venkateshwara Packaging',
    supplierPhone: '9845012345',
    supplierEmail: 'sales@svpack.in',
    baseUnitPaise: 2400, // ₹24.00
    netLandedUnitPaise: 2400,
    creditAdjustedUnitPaise: 2360, // ₹23.60 after 30d credit WACC
    creditDays: 30,
    leadTimeDays: 5,
    reliabilityScore: 95,
    quantity: 5000,
    unit: 'boxes',
  },
  {
    quoteId: 'q2',
    supplierId: 's2',
    supplierName: 'Karnataka Corrugators Ltd',
    supplierPhone: '9886234567',
    supplierEmail: 'orders@karnatakabox.com',
    baseUnitPaise: 2250, // ₹22.50
    netLandedUnitPaise: 2250,
    creditAdjustedUnitPaise: 2230, // ₹22.30 (BATNA winner)
    creditDays: 15,
    leadTimeDays: 7,
    reliabilityScore: 92,
    quantity: 5000,
    unit: 'boxes',
  },
  {
    quoteId: 'q3',
    supplierId: 's3',
    supplierName: 'Apex Packaging Industries',
    supplierPhone: '9741189012',
    supplierEmail: 'contact@apexpack.in',
    baseUnitPaise: 2650, // ₹26.50 (Highest)
    netLandedUnitPaise: 2650,
    creditAdjustedUnitPaise: 2600, // ₹26.00
    creditDays: 45,
    leadTimeDays: 4,
    reliabilityScore: 98,
    quantity: 5000,
    unit: 'boxes',
  },
];

const strategy = buildNegotiationStrategy(
  '5-Ply Heavy Duty Corrugated Master Boxes 180 GSM',
  'Karnataka Precision Works Pvt Ltd',
  quotes
);

assert(strategy.quoteCount === 3, `Evaluated 3 competitive supplier quotes`);
assert(strategy.batna.supplierName === 'Karnataka Corrugators Ltd', `BATNA anchor identifies lowest landed cost supplier (${strategy.batna.supplierName})`);
assert(strategy.spread.spreadPaise === 370, `Spread between best (₹22.30) and worst (₹26.00) is ₹3.70/unit (paise: ${strategy.spread.spreadPaise})`);
assert(strategy.spread.spreadPct === 16.6, `Spread percentage accurately computed: ${strategy.spread.spreadPct}%`);
assert(strategy.spread.maxOrderSavingsPaise === 1850000, `Potential order savings across spread: ₹${(strategy.spread.maxOrderSavingsPaise / 100).toFixed(2)} (₹18,500.00)`);

// Check tactics for top pick vs higher pick
const topPickTactic = strategy.supplierTactics.find((t) => t.supplierName === 'Karnataka Corrugators Ltd');
assert(Boolean(topPickTactic), `Generated strategy for top pick`);
assert(topPickTactic.targetCounterRatePaise < topPickTactic.currentRatePaise, `Top pick targeted for volume concession (Target: ₹${(topPickTactic.targetCounterRatePaise / 100).toFixed(2)} vs ₹${(topPickTactic.currentRatePaise / 100).toFixed(2)})`);
assert(topPickTactic.counterOfferMessages.hinglish.includes('PO release karna chahte hain'), `Hinglish message offers immediate PO release`);

const higherQuoteTactic = strategy.supplierTactics.find((t) => t.supplierName === 'Apex Packaging Industries');
assert(Boolean(higherQuoteTactic), `Generated strategy for higher quote`);
assert(higherQuoteTactic.leveragePoints.some((l) => l.toLowerCase().includes('competing verified benchmark')), `Leverage cites verified alternative benchmark`);
assert(higherQuoteTactic.counterOfferMessages.hinglish.includes('benchmark se thoda uncha hai'), `Hinglish message politely cites competitive benchmark`);
assert(higherQuoteTactic.whatsAppBridgeUrl.startsWith('https://wa.me/919741189012'), `Pre-formatted WhatsApp bridge URL ready for 1-click dispatch`);

console.log(`\n======================================================`);
console.log(`Phase 12 Negotiation Engine Test Results: ${passed}/${total} PASSED`);
console.log(`======================================================\n`);

if (passed !== total) {
  process.exit(1);
}
