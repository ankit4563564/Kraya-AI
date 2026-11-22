# Kraya — Procurement Roles Research & End-to-End Automation Blueprint

> **Purpose:** Research & architecture handoff for the **AI Procurement Workspace PRD Plan** agent (`658ba3ad-b3fd-47ba-8fa6-3fad0000db92`).  
> **Goal:** Map all **9 traditional manual procurement roles** and the **7-stage manual workflow** directly onto Kraya's existing Phases 0–14 codebase (`packages/finance-engine`, `packages/agent-core`, `apps/api`, `apps/web`), identify every remaining manual/data-entry gap, and specify concrete, deterministic modules to automate 85–95% of manual procurement work while preserving human approval gates.

---

## 1. Strategic Positioning: Wedge First, Full-Department Autonomy Under the Hood

Do **not** pitch Kraya on Day 1 as *"fire your entire procurement team."* Indian SMB owners and Procurement Managers buy **speed, leak prevention, and control**, not organizational disruption.

| Layer | Market Positioning (What You Pitch) | Target Manual Roles | Core Value Delivered |
|---|---|---|---|
| **Layer 1: Beachhead Wedge (Day-1 Onboarding)** | **AI Procurement Assistant** — *"Eliminate WhatsApp/PDF/Excel quote chasing & data entry in 5 minutes"* | **Purchase Executive / Buyer**, **Sourcing Specialist**, **Purchase Coordinator** | Collects quotes from WhatsApp/Email/PDFs, normalizes landed cost + GST + credit, recommends the best supplier, and queues a 1-click approval brief for the Procurement Manager. |
| **Layer 2: Operational Expansion (Month 1–3)** | **Autonomous Back-Office & Leak Shield** — *"Zero manual 3-way match, GSTR-2B recon, shipment chasing, or QC debit notes"* | **Accounts Payable Executive**, **Vendor Management Executive**, **Logistics Coordinator**, **Quality Assurance Executive** | Eliminates data entry across GRNs, LR/E-Way Bills, CoA/QC rejections, vendor scorecards, GSTR-2B IMS actions, and Tally/Zoho/Bank payment batches. |
| **Layer 3: Strategic Intelligence (Month 3+)** | **AI Procurement Control Tower** — *"Predict shortages before the line stops & enforce budget/approval policies"* | **Inventory / Materials Planner**, **Procurement Manager** | Demand/reorder-point forecasting, auto-drafted Purchase Requisitions, spend/price-creep radar, approval-threshold routing, and rate-contract enforcement. |

> [!IMPORTANT]
> **UX Discipline:** Keep Kraya's existing 5-tab sidebar (`+ New Task`, `Unified Inbox`, `Buying & RFQs`, `Maintenance & Daily`, `My Suppliers`). Every new role automation should plug into these existing views as cards, tabs, or modals—never create 9 separate role dashboards.

---

## 2. Complete 9-Role Audit: Manual Tasks vs. Built in Kraya (Phases 0–14) vs. Automation Gaps

### Role 1: Sourcing Specialist
- **Manual Work:** Searching Google/IndiaMART/directories, verifying GSTIN/MSME/company legitimacy, checking distance/freight feasibility, collecting KYC docs (GST cert, cancelled cheque, Udyam, PAN), maintaining vendor master lists.
- **Already Built in Kraya:**
  - `packages/agent-core/src/supplier-search.ts` — Natural-language multi-criteria supplier discovery, Mod-36 GSTIN validation, CGST+SGST vs IGST state routing, working-capital credit parity, 1-click WhatsApp/Email outreach.
  - `packages/agent-core/src/location-engine.ts` — Google Maps + ₹0 OSM/OSRM driving distance/freight estimation.
  - `packages/agent-core/src/verification-engine.ts` — GLEIF ISO 17442 global entity verification.
  - `packages/agent-core/src/autonomous-sweep.ts` — `SupplierKycScore` completeness scoring + 1-click Hinglish WhatsApp KYC chase.
- **Remaining Manual Gaps to Automate:**
  1. **Self-Serve Vendor Onboarding Portal Link:** Send a signed, zero-login mobile link via WhatsApp where the supplier uploads GST cert, Udyam cert, and cancelled cheque; Gemini Vision extracts IFSC/Account No./GSTIN/Udyam directly into `suppliers` (zero manual typing).
  2. **Automated GST Filing-Discipline Pre-Check:** Flag suppliers with poor GSTR-1 filing history (derived from workspace GSTR-2B history or public GSTN status) *before* onboarding.
- **Automation Level:** ~75% built → **95% achievable**.

---

### Role 2: Purchase Executive / Buyer
- **Manual Work:** Creating RFQs from factory indents/BOMs, contacting 3–10 suppliers via WhatsApp/calls/emails, re-typing quotes from PDFs/Excel/voice notes into comparison sheets, normalizing units (`kg` vs `MT` vs `bags`), comparing base price + GST + freight + credit terms, negotiating rates, issuing POs.
- **Already Built in Kraya:**
  - `packages/agent-core/src/bom-import.ts` — Bulk BOM/Indent CSV/TSV → multi-item RFQ creation.
  - `packages/agent-core/src/gemini.ts` + `local-parser.ts` + `voicestudio.ts` / `elevenlabs.ts` / `groq-asr.ts` — Multimodal extraction from PDFs, photos, WhatsApp text, and Hindi/Hinglish/English voice notes.
  - `packages/finance-engine/src/landed-cost.ts` + `units.ts` + `gst.ts` — Deterministic integer-paise WACC credit-adjusted landed cost & Indian B2B unit normalization.
  - `packages/agent-core/src/negotiation.ts` — Game-theoretic BATNA analysis + Hinglish/English/Hindi counter-offer generator.
  - `packages/agent-core/src/documents.ts` — `pdf-lib` GST PO PDF + `exceljs` live-formula comparison sheet.
- **Remaining Manual Gaps to Automate:**
  1. **Multi-Criteria Weighted Supplier Recommendation Engine:** Today Kraya ranks primarily by landed cost. Add deterministic weighted scoring combining **Landed Cost (e.g., 50%) + Lead Time / Delivery Speed (20%) + Historical Vendor Quality/OTIF Score (20%) + GST Filing Compliance (10%)**, outputting a plain-English **"Why Kraya Recommends Vendor X"** decision card.
  2. **Auto-Link Inbound Quotes to Open RFQs:** When a supplier replies on WhatsApp/Email with a PDF or text quote, automatically match it to the open `rfq_id` (by RFQ number, supplier phone/email, or item similarity) and update the comparison matrix without human filing.
  3. **Split-Order / Partial-Award Optimization:** When no single supplier can meet full quantity or tight delivery deadline, recommend an optimal split (e.g., 60% L1 + 40% fastest-delivery L2).
- **Automation Level:** ~80% built → **95% achievable**.

---

### Role 3: Purchase Coordinator
- **Manual Work:** Relaying requirements between internal departments and suppliers, chasing unanswered RFQs, sending delivery reminders, filing documents across email/WhatsApp/folders, maintaining PO revision trails.
- **Already Built in Kraya:**
  - `packages/agent-core/src/autonomous-sweep.ts` — Automated morning sweep detecting stale RFQs (>24h), overdue deliveries, AMC renewals, and incomplete KYC, with pre-written Hinglish WhatsApp follow-ups.
  - `apps/api/src/routes-lifecycle.ts` — PO Amendment (`Rev 2+`) & cancellation lifecycle with SHA-256 tamper-evident `audit_logs`.
  - `apps/api/src/storage.ts` — Cloudflare R2 + local persistent file vault.
- **Remaining Manual Gaps to Automate:**
  1. **True Scheduled Autonomous Dispatch (Cron/Worker Trigger):** Run `planAutonomousProcurementSweep` automatically on a daily schedule (Cloudflare Cron Trigger / Node cron) with configurable escalation tiers (T+24h polite nudge → T+48h firm reminder → T+72h flag to manager), auto-sending approved templates via WhatsApp Cloud API / Resend.
  2. **Internal Purchase Requisition (PR) Intake via WhatsApp/Voice:** Allow floor supervisors/maintenance engineers to send a 10-second Hinglish voice note (*"Plant 2 ke liye 50 kg welding rod chahiye Friday tak"*) that auto-creates a structured PR awaiting approval and converts 1-click into an RFQ.
- **Automation Level:** ~65% built → **95% achievable**.

---

### Role 4: Procurement Manager
- **Manual Work:** Reviewing comparative statements, approving vendors & POs, enforcing department budgets, negotiating annual rate contracts, monitoring price creep, auditing compliance & spend leakage.
- **Already Built in Kraya:**
  - `GET /api/analytics/cfo-intelligence` — Integer-paise PO/Invoice spend, GST paid, money leaks recovered vs. open, price-creep radar, MSME 43B(h)/Rule 37 payment cliffs.
  - `packages/agent-core/src/negotiation.ts` — Negotiation leverage & BATNA briefs.
  - `apps/api/src/auth.ts` — Role-based access (`owner` / `clerk` / `ca`).
- **Remaining Manual Gaps to Automate:**
  1. **Configurable Approval Policy & Delegation Matrix (`approval_policies`):** Rules like:
     - `≤ ₹25,000` & within historical price ±3% → Auto-approve (or clerk-issue).
     - `₹25,001 – ₹2,00,000` → 1-click Manager approval (WhatsApp/Web card).
     - `> ₹2,00,000` or >5% price creep or unverified vendor → Mandatory Owner/CFO sign-off.
  2. **Rate Contracts / Blanket POs (`rate_contracts`):** Lock negotiated annual/quarterly unit rates with preferred suppliers; auto-flag any quote/invoice that exceeds the contracted rate; track volume-rebate milestones.
  3. **1-Click Manager Approval Digest:** Daily morning WhatsApp/Web executive summary with *"3 POs ready to approve (₹4.2L total, ₹18,400 saved vs L2), 1 price-creep alert, 2 MSME 43B(h) payments due in 5 days."*
- **Automation Level:** ~55% built → **85% assisted** *(human retains final strategic sign-off)*.

---

### Role 5: Vendor Management Executive
- **Manual Work:** Maintaining supplier relationships, tracking on-time delivery & defect rates, managing vendor renewals/AMCs, conducting periodic vendor reviews, chasing compliance documents.
- **Already Built in Kraya:**
  - `suppliers` + `amc_schedules` tables, `SuppliersView.tsx`, KYC completeness scoring in `autonomous-sweep.ts`.
- **Remaining Manual Gaps to Automate:**
  1. **Deterministic 0–100 Vendor Reliability Scorecard:** Automatically compute and continuously update every supplier's score from live database evidence:
     - **OTIF (On-Time In-Full) — 35%:** Derived from `grn_receipts.receivedAt <= purchase_orders.deliveryDueAt` & quantity completeness.
     - **Quality Acceptance Rate — 25%:** Derived from `(acceptedQty / receivedQty)` on GRNs.
     - **Billing & Price Accuracy — 20%:** Penalize per `money_leaks` event (rate overcharge, qty mismatch, tax error).
     - **GST / GSTR-1 Filing Discipline — 20%:** Derived from `gstr2b-reconciler` (`ACCEPT` vs `MISSING_IN_2B`).
  2. **Automated Quarterly Vendor Review & Tiering (`Preferred` / `Approved` / `Watchlist` / `Blocked`):** Auto-demote suppliers whose score drops below 60 or who repeatedly miss GSTR-1 filings (protecting buyer ITC under Sec 16(2)(aa)).
- **Automation Level:** ~30% built → **90% achievable**.

---

### Role 6: Inventory / Materials Planner *(Major Gap — High Value)*
- **Manual Work:** Checking stock levels in Tally/Excel/store register, calculating material consumption rates, forecasting shortages, identifying reorder points, raising purchase indents before stockouts halt production.
- **Already Built in Kraya:**
  - `bom-import.ts` handles reactive BOM uploads, and `price_history` tracks past purchases—**but there is currently no inventory/stock-level or reorder-point module.**
- **Remaining Manual Gaps to Automate:**
  1. **Lightweight Inventory & Reorder Engine (`inventory_items`, `stock_movements`):**
     - Import current stock via Tally XML / Excel CSV or update automatically when a GRN is recorded (`+acceptedQty`) and daily consumption/production is logged (`-consumedQty`).
     - Deterministic **Reorder Point (ROP) & Safety Stock Formula:**
       $$\text{ROP} = (\text{Avg Daily Usage} \times \text{Supplier Lead Time Days}) + \text{Safety Stock}$$
       where $\text{Safety Stock} = Z \times \sigma_{\text{usage}} \times \sqrt{\text{Lead Time}}$ (or configurable buffer days for SMBs).
  2. **Predictive Shortage Alerts & Auto-Drafted RFQs:**
     - Add an `inventory_reorder` check to `autonomous-sweep.ts`: whenever `onHandQty + onOrderQty <= reorderPoint`, automatically calculate days-until-stockout and **pre-draft an RFQ** (pre-filled with preferred supplier, last rate, HSN, and EOQ/reorder qty) for 1-click launch.
- **Automation Level:** ~10% built → **85% achievable**.

---

### Role 7: Quality Assurance (QA) Executive *(Major Gap — High Value)*
- **Manual Work:** Checking incoming materials against PO specs, verifying Lab Test Certificates / Certificates of Analysis (CoA) / Material Test Certificates (MTC), logging partial rejections, raising Debit Notes, coordinating replacement shipments.
- **Already Built in Kraya:**
  - `grn_receipts` (partial GRN receipt tracking) and `credit_notes` (credit/debit note records) exist in `apps/api/src/db/schema.ts` and `routes-lifecycle.ts`.
- **Remaining Manual Gaps to Automate:**
  1. **Structured Incoming Quality Control (IQC) on GRN:** Extend `grn_receipts` with `acceptedQty`, `rejectedQty`, `qcStatus` (`pending` | `passed` | `partial_reject` | `rejected`), `rejectionReason`, `qcCertificateFileId`, and `defectPhotoFileId`.
  2. **Multimodal CoA / MTC & Defect Verification:** Upload a supplier's PDF Test Certificate or WhatsApp photo of damaged goods → Gemini Vision compares chemical/dimensional specs (e.g., GSM, thickness, grade, batch/expiry) against PO line specs and flags out-of-spec parameters.
  3. **Zero-Touch Rejection-to-Debit-Note Loop:** When `rejectedQty > 0`, automatically:
     - Compute exact pro-rata Debit Note value (including proportional GST reversal) in integer paise.
     - Pre-create a draft `credit_notes` (Debit Note) entry.
     - Generate a Hinglish/English WhatsApp rejection notice with photo evidence requesting replacement or credit note.
     - Deduct points from the supplier's Quality Score.
- **Automation Level:** ~25% built → **80% achievable** *(physical inspection stays human; all verification, math, paperwork, and vendor recovery are automated)*.

---

### Role 8: Logistics Coordinator *(Major Gap — High Value for Indian SMBs)*
- **Manual Work:** Tracking dispatches, chasing transporters for LR (Lorry Receipt / Bilty) numbers, checking E-Way Bill validity (so trucks aren't seized under GST Sec 129), coordinating unloading slots, updating delivery ETAs.
- **Already Built in Kraya:**
  - `location-engine.ts` (distance/route calculation) and `delivery_chase` task in `autonomous-sweep.ts`.
- **Remaining Manual Gaps to Automate:**
  1. **Shipment & E-Way Bill Tracker (`shipments` table):** Track `poId`, `transporterName`, `lrNumber`, `vehicleNumber`, `ewayBillNumber`, `ewayBillValidUntil`, `dispatchedAt`, `etaAt`, `status` (`booked` | `in_transit` | `out_for_delivery` | `delivered` | `delayed`).
  2. **Zero-Entry LR / Bilty & E-Way Bill Ingestion:** Supplier forwards a photo of the handwritten/printed LR or E-Way Bill PDF on WhatsApp → Gemini extracts LR #, vehicle #, E-Way Bill #, and validity expiry → auto-attaches to the matching PO.
  3. **E-Way Bill Expiry & Delay Guardrails:** Add `eway_bill_expiry` to `autonomous-sweep.ts` to alert 8 hours before an E-Way Bill expires (preventing 200% GST penalty seizures) and auto-notify the warehouse/gate clerk 24 hours before ETA to prepare for GRN.
- **Automation Level:** ~15% built → **85% achievable**.

---

### Role 9: Accounts Payable (AP) Executive
- **Manual Work:** Entering vendor invoices into Tally/Zoho, manually matching Invoice vs. PO vs. GRN (3-way match), checking GST/HSN/IRN/e-Invoice QR, reconciling GSTR-2B every month, tracking MSME 43B(h) 15/45-day deadlines and Rule 37 180-day ITC cliffs, calculating TDS (194Q/194C), preparing NEFT/RTGS bank payment files.
- **Already Built in Kraya:**
  - `packages/finance-engine/src/invoice-audit.ts` — Deterministic 3-Way Match (`PO vs. GRN vs. Invoice`) & Money Leak Radar.
  - `packages/finance-engine/src/gstr2b-reconciler.ts` — Official GSTN GSTR-2B JSON/CSV Reconciler + IMS Actions (`ACCEPT` / `KEEP_PENDING` / `REJECT`) + CA CSV + WhatsApp GSTR-1 chase.
  - `packages/agent-core/src/documents.ts` — Tally Prime Purchase XML, Zoho Books export, Excel CA Audit Pack.
  - `autonomous-sweep.ts` — MSME 43B(h) & Rule 37 payment cliff alerts.
- **Remaining Manual Gaps to Automate:**
  1. **Deterministic TDS Calculator (`packages/finance-engine/src/tds.ts`):** Auto-detect **Section 194Q** (0.1% TDS on goods purchases > ₹50L/vendor/FY for buyers with > ₹10Cr turnover) and **Section 194C** (1%/2% on GTA/contractor services), computing net payable paise automatically.
  2. **Payment-Ready Bank Batch Generator (NEFT/RTGS/IMPS CSV):** Once an invoice passes **3-Way Match = CLEAN** AND **GSTR-2B = ACCEPT** (or approved override), generate bank-uploadable bulk payout files (HDFC, ICICI, SBI, Axis standard CSV formats) sorted by MSME 43B(h) urgency, and ingest bank UTR receipts to auto-mark `paidAt`.
- **Automation Level:** ~80% built → **95% achievable**.

---

## 3. End-to-End 7-Stage Workflow Coverage Summary

| Workflow Stage | Primary Manual Role(s) | Current Kraya Coverage (Phases 0–14) | Target Coverage (Post-Roadmap) | Human-in-the-Loop Gate |
|---|---|---|---|---|
| **1. Requirement Identification** | Inventory Planner, Dept Heads | 25% (BOM CSV import) | **85%** (ROP forecast + WhatsApp voice PR) | Approve PR / budget exception |
| **2. Supplier Discovery & KYC** | Sourcing Specialist | 75% (NL search, GSTIN, OSRM, KYC score) | **95%** (+ self-serve KYC link & GST history) | Approve new vendor tier |
| **3. RFQ Collection & Chasing** | Purchase Exec, Coordinator | 75% (BOM→RFQ, sweep, WA/Email) | **95%** (+ cron auto-chase & auto-link replies) | Approve non-standard terms |
| **4. Quotation Standardization & Comparison** | Buyer, Purchase Exec | 85% (Gemini/Voice/WACC/Units) | **95%** (+ weighted cost/lead-time/quality score) | Review AI recommendation |
| **5. Negotiation** | Buyer, Procurement Mgr | 85% (BATNA engine + Hinglish scripts) | **90%** (+ multi-round counter-offer tracking) | Approve final counter-offer |
| **6. Purchase Approval & PO Issue** | Procurement Manager | 65% (GST PO PDF, Rev 2+ amend) | **90%** (+ threshold policy matrix & rate contracts) | 1-click PO approval |
| **7. Order, Logistics, QA & AP** | Logistics, QA, Vendor Mgmt, AP | 55% (GRN, 3-Way Match, GSTR-2B, Tally/Zoho) | **92%** (+ E-Way/LR, IQC→Debit Note, Scorecard, TDS, Bank Batch) | Physical QC check & Bank OTP |

---

## 4. Recommended Implementation Roadmap (Phases 15A–15D for the PRD Agent)

Ordered by **highest customer acquisition impact** (strengthening the Day-1 AI Assistant wedge first, then closing the remaining 4 department roles):

### Phase 15A — Decision Intelligence & Manager Control (Wedge Multiplier)
- **Weighted Supplier Recommendation Engine** (`packages/finance-engine/src/supplier-scoring.ts`): Combine WACC landed cost + lead time + historical OTIF/Quality/GSTR-1 reliability score into a deterministic 0–100 recommendation with explainable rationale.
- **Approval Policy Engine** (`approval_policies` table + middleware): Auto-route POs by amount threshold, budget variance, and price-creep %, with 1-click Manager Approval cards.
- **Vendor Reliability Scorecard** (`GET /api/suppliers/:id/scorecard`): Live 0–100 score + `Preferred / Approved / Watchlist / Blocked` badge on `SuppliersView.tsx` and inside `BuyingRfqsView.tsx` quote comparisons.

### Phase 15B — Digital IQC (QA) & Shipment/E-Way Bill Tracker (Logistics)
- **IQC & Defect-to-Debit-Note Loop:** Extend `grn_receipts` with `acceptedQty`, `rejectedQty`, `qcStatus`, `rejectionReason`, `qcCertificateFileId`; Gemini CoA/spec check; 1-click auto-draft Debit Note (`credit_notes`) + WhatsApp rejection notice.
- **Logistics & E-Way Bill Module:** Add `shipments` table; Gemini Vision parser for transporter LR/Bilty & E-Way Bill PDFs; add `eway_bill_expiry` (8h warning) and `arrival_prep` alerts to `autonomous-sweep.ts`.

### Phase 15C — Predictive Inventory & Rate Contracts (Materials Planner + Manager)
- **Inventory & Reorder Point Engine:** Add `inventory_items` & `stock_movements` tables; Tally/CSV stock sync; deterministic ROP/safety-stock calculator; auto-drafted RFQs in `autonomous-sweep.ts` when `onHand + onOrder <= ROP`.
- **Rate Contracts / Blanket POs:** Add `rate_contracts` table; automatic price-lock variance alerts during quote comparison and invoice audit.

### Phase 15D — Zero-Touch AP Finish Line (AP Executive)
- **TDS 194Q / 194C Deterministic Engine** (`packages/finance-engine/src/tds.ts`): Track cumulative FY spend per supplier PAN and auto-compute TDS deductions in integer paise.
- **Bank Bulk Payout CSV Generator:** Export HDFC/ICICI/SBI NEFT/RTGS payment batches for 3-Way-Matched + GSTR-2B-Accepted invoices prioritized by MSME 43B(h) deadline, plus UTR import to auto-close `paidAt`.
- **Self-Serve Supplier KYC Link:** Signed mobile upload page for GST/Udyam/Cancelled Cheque with Gemini auto-fill into `suppliers`.

---

## 5. Why Companies Will Join Kraya (Sales & Adoption Framing)

1. **Zero Rip-and-Replace:** Works alongside Tally Prime / Zoho Books and the WhatsApp/PDF/Excel chaos Indian suppliers already use.
2. **Immediate Measurable ROI (Week 1):** Stops 3–8% money leaks (rate overcharges, GST/HSN errors, blocked ITC, MSME 43B(h) tax disallowance) before a single manual role is even restructured.
3. **Deterministic CFO Trust:** Every rupee is computed in integer paise (`@kraya/finance-engine`), every action is SHA-256 audit-logged, and AI never invents missing numbers or spends money without policy/human approval.
4. **Clear Path from Assistant → Autonomous Department:** Starts as a 1-person superpower for a Purchase Executive/Owner, and scales seamlessly to automate all 9 procurement functions as order volume grows.
