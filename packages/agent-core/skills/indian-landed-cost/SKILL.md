---
name: indian-landed-cost
description: Build a credit-adjusted Indian landed-cost comparison across supplier quotes, normalizing B2B units (MT/quintal/dozen/carton), GST 2.0 ITC recoverability, GTA/composite freight, WACC credit-day benefit, and MSME Section 43B(h) 45-day caps. Use when comparing 2+ quotes or evaluating who is truly cheapest delivered. Do NOT use for final invoice-vs-PO audits.
---

# Indian Landed-Cost Comparison Skill

## Procedure
1. Extract atomic fields only (raw rate, unit, pack size, GST %, inclusive/exclusive, freight, freight GST mode, credit days, lead time). Never guess missing fields — leave null and flag for 1-click user verification.
2. Call deterministic `@kraya/finance-engine` (`rankSupplierQuotes`) using workspace GST regime and editable WACC %.
3. Enforce Section 43B(h) legal credit cap (45d written / 15d unwritten) for Micro/Small Udyam suppliers.
4. Surface price-creep delta against `price_history`.
5. Export live-formula `.xlsx` via `generateLandedCostWorkbook` so editing WACC re-ranks live.
6. Return 3-line CFO judgment naming the winner, rupee savings, and any compliance traps.
