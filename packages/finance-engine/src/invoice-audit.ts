import {
  ComplianceFlag,
  FreightGstMode,
  ImsSuggestedAction,
  Paise,
  SupplierTaxProfile,
  WorkspaceTaxProfile,
  formatINR,
  toPaise,
} from './types.js';
import {
  addCalendarDays,
  computeGstLine,
  evaluateTdsAdvisory,
  validateEInvoiceIrn,
  validateInvoiceTaxSplit,
} from './gst.js';
import { validateGstin } from './gstin.js';

export interface InvoiceLineItemInput {
  itemKey: string;
  description: string;
  hsnSac?: string | null;
  qty: number;
  unit: string;
  unitRateRupees: number;
  discountRupees?: number;
  gstPct: number;
  statedLineTaxableRupees?: number | null;
}

export interface PoLineItemReference {
  itemKey: string;
  description: string;
  agreedQty: number;
  agreedUnitRateRupees: number;
  agreedGstPct: number;
}

export interface InvoiceAuditInput {
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  supplier: SupplierTaxProfile;
  supplierGstinOnBill?: string | null;
  irn?: string | null;
  hasQr?: boolean;
  items: InvoiceLineItemInput[];
  freightRupees?: number;
  freightGstPct?: number;
  freightGstMode?: FreightGstMode;
  freightAlreadyTaxInclusive?: boolean; // Detects double-GST on freight!
  statedTaxableRupees: number;
  statedCgstRupees: number;
  statedSgstRupees: number;
  statedIgstRupees: number;
  statedRoundOffRupees?: number;
  statedGrandTotalRupees: number;
  creditDaysAgreed?: number;
  hasWrittenPo?: boolean;
  poItems?: PoLineItemReference[];
  historicalUnitRatesPaise?: Record<string, Paise>; // itemKey -> previous landed unit rate
  fyCumulativeSpendPaise?: Paise;
  isServiceOrAmcOrGta?: boolean;
}

export interface InvoiceAuditResult {
  invoiceNumber: string;
  mathReconciled: boolean;
  computedTaxablePaise: Paise;
  computedTotalGstPaise: Paise;
  computedGrandTotalPaise: Paise;
  statedGrandTotalPaise: Paise;
  mathDiscrepancyPaise: Paise; // Positive = vendor billed MORE than true math
  poMatchStatus: 'matched' | 'partial' | 'mismatch' | 'unlinked';
  imsSuggestedAction: ImsSuggestedAction;
  directCommercialOverchargePaise: Paise;
  itcAtRiskPaise: Paise;
  totalMoneyLeakPaise: Paise;
  paymentDueDate: string;
  msme43bhDueDate: string | null;
  rule37_180DayCliffDate: string;
  flags: ComplianceFlag[];
  cfoVerdict: string;
}

/**
 * Self-Verifying Invoice Auditor + PO Mismatch + Money Leak Radar Engine.
 * Runs 100% deterministically in integer paise.
 */
export function auditSupplierInvoice(
  input: InvoiceAuditInput,
  buyer: WorkspaceTaxProfile
): InvoiceAuditResult {
  const flags: ComplianceFlag[] = [];

  // 1. Offline GSTIN Mod-36 Checksum Validation
  const billGstin = input.supplierGstinOnBill ?? input.supplier.gstin;
  if (billGstin) {
    const gstinCheck = validateGstin(billGstin);
    if (!gstinCheck.valid) {
      flags.push({
        code: 'invalid_gstin',
        severity: 'critical',
        title: `Invalid Supplier GSTIN on Bill (${billGstin})`,
        detail: gstinCheck.errors.join('; '),
        impactPaise: toPaise(input.statedCgstRupees + input.statedSgstRupees + input.statedIgstRupees),
        statutoryRef: 'Section 31 & Rule 46 CGST Rules',
        recommendedAction: 'HOLD payment — invalid GSTIN will block your GSTR-2B ITC.',
      });
    }
  }

  // 2. Line-by-line deterministic math + GST 2.0 + PO mismatch + historical rate creep
  let computedItemsTaxablePaise = 0;
  let computedItemsGstPaise = 0;
  let poHasMismatch = false;

  const principalGstPct = input.items.length > 0 ? Math.max(...input.items.map((i) => i.gstPct)) : 18;

  for (const item of input.items) {
    const lineGrossPaise = Math.round(toPaise(item.unitRateRupees) * item.qty);
    const lineDiscountPaise = toPaise(item.discountRupees ?? 0);
    const lineTaxablePaise = Math.max(0, lineGrossPaise - lineDiscountPaise);
    computedItemsTaxablePaise += lineTaxablePaise;

    const lineGst = computeGstLine({
      taxablePaise: lineTaxablePaise,
      gstRatePct: item.gstPct,
      buyer,
      supplier: input.supplier,
      hsnOrItemText: item.hsnSac || item.description,
      invoiceDate: input.invoiceDate,
    });
    computedItemsGstPaise += lineGst.totalGstPaise;
    flags.push(...lineGst.flags);

    // PO vs Invoice Match Check (3-Way Control: Rate, Qty, GST%, Unordered Items)
    if (input.poItems && input.poItems.length > 0) {
      const poRef = input.poItems.find(
        (p) =>
          p.itemKey.toLowerCase() === item.itemKey.toLowerCase() ||
          p.description.toLowerCase() === item.description.toLowerCase()
      );
      if (poRef) {
        const agreedRatePaise = toPaise(poRef.agreedUnitRateRupees);
        const billedRatePaise = toPaise(item.unitRateRupees);

        // Exact non-overlapping variance decomposition:
        // Rate variance applies ONLY on authorized qty = min(billedQty, agreedQty);
        // Excess qty applies at full billedRate — so sum == exact (billedTotal - agreedTotal)!
        if (billedRatePaise > agreedRatePaise) {
          poHasMismatch = true;
          const authorizedQty = Math.min(item.qty, poRef.agreedQty);
          const overchargePaise = Math.round((billedRatePaise - agreedRatePaise) * authorizedQty);
          flags.push({
            code: 'po_rate_overcharge',
            severity: 'critical',
            title: `PO Rate Overcharge on ${item.description}`,
            detail: `Billed at ${formatINR(billedRatePaise)}/${item.unit} vs. PO agreed rate ${formatINR(agreedRatePaise)}/${item.unit} across ${authorizedQty} authorized ${item.unit} (+${formatINR(overchargePaise)} overcharge).`,
            impactPaise: overchargePaise,
            statutoryRef: 'PO 3-Way Match Control',
            recommendedAction: 'Keep Pending in GST IMS & demand Credit Note for the rate difference.',
          });
        }
        if (item.qty < poRef.agreedQty) {
          poHasMismatch = true;
          const shortQty = poRef.agreedQty - item.qty;
          const shortValPaise = Math.round(shortQty * agreedRatePaise);
          flags.push({
            code: 'po_qty_short_shipment',
            severity: 'warning',
            title: `Short Shipment / Qty Mismatch on ${item.description}`,
            detail: `Invoice billed ${item.qty} ${item.unit} vs. PO quantity ${poRef.agreedQty} ${item.unit} (${shortQty} short, value ${formatINR(shortValPaise)}). Verify GRN/physical receipt.`,
            impactPaise: 0,
            statutoryRef: 'PO vs. GRN Quantity Check',
            recommendedAction: 'Log short shipment against supplier reliability score & confirm balance dispatch date.',
          });
        }
        if (item.qty > poRef.agreedQty) {
          poHasMismatch = true;
          const excessQty = item.qty - poRef.agreedQty;
          const excessValPaise = Math.round(excessQty * billedRatePaise);
          flags.push({
            code: 'po_qty_short_shipment',
            severity: 'critical',
            title: `Excess Billed Quantity on ${item.description}`,
            detail: `Invoice billed ${item.qty} ${item.unit} vs. PO authorized ${poRef.agreedQty} ${item.unit} (+${excessQty} unapproved units @ ${formatINR(billedRatePaise)} = ${formatINR(excessValPaise)}).`,
            impactPaise: excessValPaise,
            statutoryRef: 'PO Quantity Authorization',
            recommendedAction: 'Confirm physical receipt; if unreceived, deduct excess before payment.',
          });
        }
        if (item.gstPct !== poRef.agreedGstPct) {
          poHasMismatch = true;
          const taxDeltaPct = Math.max(0, item.gstPct - poRef.agreedGstPct);
          const gstDiffPaise = Math.round((lineTaxablePaise * taxDeltaPct) / 100);
          flags.push({
            code: 'po_gst_mismatch',
            severity: taxDeltaPct > 0 ? 'critical' : 'warning',
            title: `PO GST Slab Mismatch on ${item.description} (Billed ${item.gstPct}% vs. PO ${poRef.agreedGstPct}%)`,
            detail: `Invoice applied ${item.gstPct}% GST instead of PO agreed ${poRef.agreedGstPct}% GST${gstDiffPaise > 0 ? ` (+${formatINR(gstDiffPaise)} excess tax billed)` : ''}.`,
            impactPaise: gstDiffPaise,
            statutoryRef: 'PO Tax Rate Control',
            recommendedAction: 'Confirm HSN classification and request revised invoice if vendor applied wrong slab.',
          });
        }
      } else {
        // CRITICAL: Unordered / extra item billed that does NOT exist on the PO!
        poHasMismatch = true;
        flags.push({
          code: 'po_unordered_item',
          severity: 'critical',
          title: `Unordered Item Billed (Not on PO): ${item.description}`,
          detail: `Vendor billed ${item.qty} ${item.unit} of "${item.description}" (${formatINR(lineTaxablePaise)}) which was NOT authorized on the linked Purchase Order.`,
          impactPaise: lineTaxablePaise,
          statutoryRef: 'PO Line-Item Authorization',
          recommendedAction: 'Hold payment & dispute unauthorized line item unless covered by written PO amendment.',
        });
      }
    }

    // Historical Price Creep Check — ONLY when no contractual PO overcharge was already flagged on this line
    // (Prevents double-counting the same rate hike as both PO overcharge + historical price creep!)
    const alreadyFlaggedPoRateOvercharge = flags.some(
      (f) => f.code === 'po_rate_overcharge' && f.title.includes(item.description)
    );
    const histRatePaise = input.historicalUnitRatesPaise?.[item.itemKey];
    if (!alreadyFlaggedPoRateOvercharge && histRatePaise && histRatePaise > 0) {
      const billedRatePaise = toPaise(item.unitRateRupees);
      const deltaPct = Number((((billedRatePaise - histRatePaise) / histRatePaise) * 100).toFixed(2));
      if (deltaPct >= 2.0) {
        const creepPaise = Math.round((billedRatePaise - histRatePaise) * item.qty);
        flags.push({
          code: 'rate_creep',
          severity: deltaPct >= 5 ? 'critical' : 'warning',
          title: `Silent +${deltaPct}% Rate Creep on ${item.description}`,
          detail: `Billed at ${formatINR(billedRatePaise)}/${item.unit} vs. your last paid rate of ${formatINR(histRatePaise)}/${item.unit} (+${formatINR(creepPaise)} extra).`,
          impactPaise: creepPaise,
          statutoryRef: 'Historical Price Memory',
          recommendedAction: 'Send 1-click WhatsApp dispute asking why rate increased without prior written approval.',
        });
      }
    }
  }

  // 2b. Check for Missing PO Items (items ordered on PO but omitted from this invoice)
  if (input.poItems && input.poItems.length > 0) {
    for (const poRef of input.poItems) {
      const present = input.items.some(
        (it) =>
          it.itemKey.toLowerCase() === poRef.itemKey.toLowerCase() ||
          it.description.toLowerCase() === poRef.description.toLowerCase()
      );
      if (!present) {
        poHasMismatch = true;
        flags.push({
          code: 'po_missing_item',
          severity: 'warning',
          title: `PO Item Omitted from Invoice: ${poRef.description}`,
          detail: `PO ordered ${poRef.agreedQty} of "${poRef.description}", which is absent from this invoice (partial billing or missing dispatch).`,
          impactPaise: 0,
          statutoryRef: 'PO Completeness Control',
          recommendedAction: 'Confirm whether remaining item will ship on a separate partial invoice.',
        });
      }
    }
  }

  // 3. Freight GST & Double-GST Detection
  const freightPaise = toPaise(input.freightRupees ?? 0);
  let computedFreightGstPaise = 0;
  if (freightPaise > 0) {
    const freightGstPct = input.freightGstPct ?? principalGstPct;
    const freightMode: FreightGstMode = input.freightGstMode ?? 'composite_supply';

    if (input.freightAlreadyTaxInclusive && freightGstPct > 0) {
      const doubleTaxPaise = Math.round((freightPaise * freightGstPct) / 100);
      flags.push({
        code: 'double_gst_freight',
        severity: 'critical',
        title: `GST Charged Twice on Freight (${formatINR(doubleTaxPaise)})`,
        detail: `Freight amount (${formatINR(freightPaise)}) already includes transporter tax, yet ${freightGstPct}% GST (${formatINR(doubleTaxPaise)}) was added again on the invoice.`,
        impactPaise: doubleTaxPaise,
        statutoryRef: 'Section 15 CGST Act (Valuation)',
        recommendedAction: 'Demand deduction of duplicate freight GST before releasing payment.',
      });
    }

    const freightEval = computeGstLine({
      taxablePaise: freightPaise,
      gstRatePct: freightGstPct,
      buyer,
      supplier: input.supplier,
      isFreightLine: true,
      freightGstMode: freightMode,
      principalGoodsGstPct: principalGstPct,
      invoiceDate: input.invoiceDate,
    });
    computedFreightGstPaise = freightEval.totalGstPaise;
    flags.push(...freightEval.flags);
  }

  // 4. Tax Split State Validation (CGST+SGST vs IGST)
  const statedCgstPaise = toPaise(input.statedCgstRupees);
  const statedSgstPaise = toPaise(input.statedSgstRupees);
  const statedIgstPaise = toPaise(input.statedIgstRupees);
  const statedTotalGstPaise = statedCgstPaise + statedSgstPaise + statedIgstPaise;

  const splitFlag = validateInvoiceTaxSplit({
    supplierGstin: billGstin,
    supplierStateCode: input.supplier.stateCode,
    buyerStateCode: buyer.stateCode,
    billedCgstPaise: statedCgstPaise,
    billedSgstPaise: statedSgstPaise,
    billedIgstPaise: statedIgstPaise,
  });
  if (splitFlag) flags.push(splitFlag);

  // 5. E-Invoice IRN Validation (>₹5 Cr vendors)
  const irnFlag = validateEInvoiceIrn({
    supplier: input.supplier,
    irn: input.irn,
    hasQr: input.hasQr,
    totalGstPaise: statedTotalGstPaise,
  });
  if (irnFlag) flags.push(irnFlag);

  // 6. Self-Verifying Arithmetic Reconciliation (Tolerance: ₹1 = 100 paise for rounding)
  const computedTaxablePaise = computedItemsTaxablePaise + freightPaise;
  const computedTotalGstPaise = computedItemsGstPaise + computedFreightGstPaise;
  const roundOffPaise = toPaise(input.statedRoundOffRupees ?? 0);
  const computedGrandTotalPaise = computedTaxablePaise + computedTotalGstPaise + roundOffPaise;
  const statedGrandTotalPaise = toPaise(input.statedGrandTotalRupees);
  const mathDiscrepancyPaise = statedGrandTotalPaise - computedGrandTotalPaise;
  const mathReconciled = Math.abs(mathDiscrepancyPaise) <= 100; // ₹1 rounding tolerance

  if (!mathReconciled) {
    flags.push({
      code: 'math_overcharge',
      severity: mathDiscrepancyPaise > 0 ? 'critical' : 'warning',
      title:
        mathDiscrepancyPaise > 0
          ? `Invoice Total Arithmetic Overcharge (+${formatINR(mathDiscrepancyPaise)})`
          : `Invoice Total Math Discrepancy (${formatINR(mathDiscrepancyPaise)})`,
      detail: `Line items + GST compute to ${formatINR(computedGrandTotalPaise)}, but invoice states ${formatINR(statedGrandTotalPaise)}. Verify OCR digits or dispute arithmetic error with vendor.`,
      impactPaise: mathDiscrepancyPaise > 0 ? mathDiscrepancyPaise : 0,
      statutoryRef: 'Deterministic Invoice Math Reconciler',
      recommendedAction:
        mathDiscrepancyPaise > 0
          ? 'Verify extracted bill numbers; if vendor mis-added the bill, deduct difference.'
          : 'Double-check extracted discounts or hidden charges on the bill.',
    });
  }

  // 7. TDS Advisory (194C / 194Q)
  const tdsFlag = evaluateTdsAdvisory({
    buyer,
    supplier: input.supplier,
    taxablePaise: computedTaxablePaise,
    isServiceOrAmcOrGta: input.isServiceOrAmcOrGta ?? false,
    fyCumulativeSpendPaise: input.fyCumulativeSpendPaise,
  });
  if (tdsFlag) flags.push(tdsFlag);

  // 8. Statutory Payment Clocks: Agreed Credit Due, MSME 43B(h) Due, Rule 37 180-Day Cliff
  const agreedDays = input.creditDaysAgreed ?? 30;
  const paymentDueDate = addCalendarDays(input.invoiceDate, agreedDays);
  // Office Memorandum No. 5/2(2)/2021: Wholesale/Retail Traders excluded from 43B(h)
  const isTrader =
    Boolean(input.supplier.isTrader) ||
    input.supplier.udyamTier === 'trader' ||
    Boolean(input.supplier.category && /trader|retail|wholesale/i.test(input.supplier.category));
  const isCoveredMsme =
    !isTrader &&
    (input.supplier.udyamTier === 'micro' || input.supplier.udyamTier === 'small');
  const msmeCapDays = input.hasWrittenPo ? 45 : 15;
  const msme43bhDueDate = isCoveredMsme
    ? addCalendarDays(input.invoiceDate, msmeCapDays)
    : null;
  const rule37_180DayCliffDate = addCalendarDays(input.invoiceDate, 180);

  // Rule 37 CGST Rules: Emit 150-day warning & 180-day ITC reversal alert for unpaid bills
  const nowIso = new Date().toISOString().slice(0, 10);
  const invMs = Date.parse(`${input.invoiceDate.slice(0, 10)}T00:00:00Z`);
  const nowMs = Date.parse(`${nowIso}T00:00:00Z`);
  const ageDays = Number.isFinite(invMs) ? Math.floor((nowMs - invMs) / (24 * 60 * 60 * 1000)) : 0;

  if (buyer.gstRegime === 'regular' && statedTotalGstPaise > 0 && ageDays >= 150) {
    const overdue180 = ageDays > 180;
    flags.push({
      code: 'rule37_180d_warning',
      severity: overdue180 ? 'critical' : 'warning',
      title: overdue180
        ? `Rule 37 Breach: Unpaid >180 Days (${ageDays}d) — ITC Reversal Required!`
        : `Rule 37 Warning: Invoice ${ageDays} Days Old (180-Day Cliff: ${rule37_180DayCliffDate})`,
      detail: overdue180
        ? `Invoice has crossed 180 days unpaid. Claimed ITC of ${formatINR(statedTotalGstPaise)} must be reversed with interest under Rule 37 (re-claimable after payment).`
        : `Clear payment before ${rule37_180DayCliffDate} to avoid mandatory reversal of ${formatINR(statedTotalGstPaise)} GST ITC with interest.`,
      impactPaise: overdue180 ? statedTotalGstPaise : 0,
      statutoryRef: 'Section 16(2) Proviso & Rule 37 CGST Rules',
      recommendedAction: overdue180
        ? 'Consult CA for GSTR-3B ITC reversal and settle vendor dues immediately.'
        : `Prioritize payment before ${rule37_180DayCliffDate}.`,
    });
  }

  // 9. Aggregate Real Financial Exposure WITHOUT Overlapping Double-Counts:
  //    (a) Direct commercial cash overcharges (deductible from vendor payable)
  //    (b) ITC-at-risk exposure — ALL ITC-blocking defects jeopardize the SAME single GST pool (capped at statedTotalGstPaise!)
  const directOverchargeCodes = new Set([
    'rate_creep',
    'po_rate_overcharge',
    'po_qty_short_shipment',
    'po_unordered_item',
    'po_gst_mismatch',
    'double_gst_freight',
    'wrong_freight_gst_rate',
    'stale_gst_slab',
    'math_overcharge',
    'composition_tax_fraud',
    'non_gta_illegal_tax',
  ]);
  const itcRiskCodes = new Set([
    'invalid_gstin',
    'wrong_tax_split_state',
    'missing_irn_itc_risk',
    'rule37_180d_warning',
  ]);

  // Avoid double-counting stale_gst_slab when po_gst_mismatch already captured the tax excess
  const hasPoGstMismatch = flags.some((f) => f.code === 'po_gst_mismatch' && f.impactPaise > 0);
  const directCommercialOverchargePaise = flags
    .filter((f) => {
      if (!directOverchargeCodes.has(f.code) || f.impactPaise <= 0) return false;
      if (f.code === 'stale_gst_slab' && hasPoGstMismatch) return false;
      return true;
    })
    .reduce((acc, f) => acc + f.impactPaise, 0);

  const maxSingleItcRiskPaise = flags
    .filter((f) => itcRiskCodes.has(f.code) && f.impactPaise > 0)
    .reduce((max, f) => Math.max(max, f.impactPaise), 0);
  const itcAtRiskPaise = Math.min(statedTotalGstPaise, maxSingleItcRiskPaise);

  const totalMoneyLeakPaise = directCommercialOverchargePaise + itcAtRiskPaise;

  // 10. Determine PO match status & GST IMS Portal Recommended Action
  const poMatchStatus: InvoiceAuditResult['poMatchStatus'] =
    !input.poItems || input.poItems.length === 0
      ? 'unlinked'
      : poHasMismatch
        ? 'mismatch'
        : 'matched';

  const hasCriticalTaxError = flags.some((f) =>
    [
      'wrong_tax_split_state',
      'invalid_gstin',
      'composition_tax_fraud',
      'missing_irn_itc_risk',
    ].includes(f.code)
  );
  const hasCriticalCommercialError = flags.some(
    (f) => f.severity === 'critical' && !hasCriticalTaxError
  );

  let imsSuggestedAction: ImsSuggestedAction = 'ACCEPT';
  if (buyer.gstRegime !== 'regular' || statedTotalGstPaise === 0) {
    imsSuggestedAction = 'NOT_APPLICABLE';
  } else if (hasCriticalTaxError) {
    imsSuggestedAction = 'REJECT';
  } else if (hasCriticalCommercialError || poMatchStatus === 'mismatch' || !mathReconciled) {
    imsSuggestedAction = 'KEEP_PENDING';
  }

  const cfoVerdict =
    totalMoneyLeakPaise > 0
      ? `HOLD PAYMENT: ${formatINR(totalMoneyLeakPaise)} in overcharges / ITC risks detected across ${flags.filter((f) => f.severity !== 'info').length} flag(s). GST IMS action: ${imsSuggestedAction}.`
      : `CLEAR TO PAY: Invoice reconciles to ${formatINR(statedGrandTotalPaise)} with zero detected money leaks. GST IMS action: ${imsSuggestedAction}.`;

  return {
    invoiceNumber: input.invoiceNumber,
    mathReconciled,
    computedTaxablePaise,
    computedTotalGstPaise,
    computedGrandTotalPaise,
    statedGrandTotalPaise,
    mathDiscrepancyPaise,
    poMatchStatus,
    imsSuggestedAction,
    directCommercialOverchargePaise,
    itcAtRiskPaise,
    totalMoneyLeakPaise,
    paymentDueDate,
    msme43bhDueDate,
    rule37_180DayCliffDate,
    flags,
    cfoVerdict,
  };
}
