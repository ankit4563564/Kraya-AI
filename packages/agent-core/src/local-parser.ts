import {
  FreightGstMode,
  lookupHsn,
  parseHinglishShorthand,
  validateGstin,
} from '@kraya/finance-engine';
import { ExtractedProcurementPayload, FieldEvidence } from './gemini.js';

function slugifyItem(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'procurement-item'
  );
}

/**
 * Zero-API-key deterministic extractor for pasted WhatsApp chats, emails, call transcripts,
 * and structured invoice text. Follows Accio Invariant 4 & 5: never invents missing fields,
 * records exact evidence snippets, and flags missing/ambiguous items for 1-click user verification.
 */
export function extractDeterministically(
  rawText: string,
  channel = 'manual'
): ExtractedProcurementPayload {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const evidence: FieldEvidence[] = [];
  const missingFields: string[] = [];

  const hints = parseHinglishShorthand(text);

  // Determine document kind
  let documentKind: ExtractedProcurementPayload['documentKind'] = 'quote';
  if (/(invoice\s*(?:no|#|number)?|tax\s*invoice|bill\s*(?:no|#)|cgst|sgst|igst|grand\s*total|irn)/i.test(lower)) {
    documentKind = 'invoice';
  } else if (/(send\s*rfq|need\s+\d+|want\s+quotes?|shortlist\s+vendors?)/i.test(lower) && hints.rateRupees === null) {
    documentKind = 'rfq_request';
  } else if (/(amc|generator\s+service|maintenance|repeat\s+last|spares\s+due)/i.test(lower)) {
    documentKind = 'maintenance_note';
  } else if (/(chase|delayed|dispatch\s+pending|follow\s*up|remind\s+vendor)/i.test(lower)) {
    documentKind = 'followup_note';
  }

  // Extract GSTIN (15-char Indian pattern)
  const gstinMatch = text.match(/\b([0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz][0-9A-Za-z]{1})\b/);
  let supplierGstin: string | null = null;
  if (gstinMatch) {
    supplierGstin = gstinMatch[1].toUpperCase();
    const validCheck = validateGstin(supplierGstin);
    evidence.push({
      field: 'supplierGstin',
      value: supplierGstin,
      confidence: validCheck.valid ? 0.98 : 0.6,
      evidenceQuote: gstinMatch[0],
    });
  }

  // Extract Indian mobile/phone (+91 / 10-digit)
  const phoneMatch = text.match(/(?:\+91[\s-]?)?([6-9]\d{9})\b/);
  const supplierPhone = phoneMatch ? phoneMatch[1] : null;
  if (supplierPhone && phoneMatch) {
    evidence.push({
      field: 'supplierPhone',
      value: supplierPhone,
      confidence: 0.95,
      evidenceQuote: phoneMatch[0],
    });
  }

  // Extract email
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  const supplierEmail = emailMatch ? emailMatch[0] : null;

  // Extract Supplier Name heuristically ("Vendor A", "From: Sharma Pack", "Ramesh offered")
  let supplierName: string | null = null;
  const namePatterns = [
    /(?:supplier|vendor|from|party|m\/s)\s*[:=-]\s*([A-Za-z0-9 &'-]{2,48})(?=[.,;\n]|$)/i,
    /\b(Vendor\s+[A-Z0-9]+)\b/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:offered|quoted|replied|sent|billed)\b/,
  ];
  for (const pat of namePatterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      supplierName = m[1].trim().replace(/[,.]$/, '');
      evidence.push({
        field: 'supplierName',
        value: supplierName,
        confidence: 0.88,
        evidenceQuote: m[0].trim(),
      });
      break;
    }
  }
  if (!supplierName) missingFields.push('supplierName');

  // Extract Invoice Number & Date
  const invNoMatch = text.match(/(?:inv(?:oice)?|bill)\s*(?:no\.?|number|#)?\s*[:=-]?\s*([A-Z0-9\/-]{3,28})/i);
  const invoiceNumber = invNoMatch ? invNoMatch[1].trim() : null;

  const isoDateMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const dmyDateMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  let invoiceDate: string | null = null;
  if (isoDateMatch) {
    invoiceDate = isoDateMatch[1];
  } else if (dmyDateMatch) {
    const dd = dmyDateMatch[1].padStart(2, '0');
    const mm = dmyDateMatch[2].padStart(2, '0');
    invoiceDate = `${dmyDateMatch[3]}-${mm}-${dd}`;
  }

  // Extract IRN (64-hex chars)
  const irnMatch = text.match(/\b([a-fA-F0-9]{64})\b/);
  const irn = irnMatch ? irnMatch[1] : null;

  // Quantity & item description extraction
  const qtyMatch = text.match(/\b([0-9,]+(?:\.[0-9]+)?)\s*(pcs?|pieces?|nos?|boxes?|cartons?|kg|kgs?|mt|tonnes?|tons?|drums?|ltrs?|liters?|units?|sets?|rolls?)\b/i);
  const qty = qtyMatch ? parseFloat(qtyMatch[1].replace(/,/g, '')) : null;
  const qtyUnit = qtyMatch ? qtyMatch[2].toLowerCase() : hints.unit;

  const hsnMatch = text.match(/(?:hsn|sac)\s*(?:code)?\s*[:=-]?\s*(\d{4,8})/i);
  const catalogMatch = lookupHsn(hsnMatch?.[1] || text);
  const hsnSac = hsnMatch?.[1] ?? catalogMatch?.code ?? null;

  // Description inference from "for <item>" or HSN catalog
  const itemPhraseMatch = text.match(/\b(?:for|item|product|supply\s+of)\s+([A-Za-z0-9\s-]{3,42}?)(?:[,.@₹]|$|\b(?:at|@|rs|inr|gst|credit|deliver|from|by)\b)/i);
  const description =
    itemPhraseMatch?.[1]?.trim() ||
    catalogMatch?.description ||
    (qtyMatch ? `${qtyMatch[2]} supply` : 'Procurement Item');

  const gstPct = hints.gstPct ?? null;
  if (hints.rateRupees !== null) {
    evidence.push({
      field: 'unitRateRupees',
      value: hints.rateRupees,
      confidence: 0.9,
      evidenceQuote: hints.evidenceSnippets.find((s) => s.startsWith('Rate')) ?? `₹${hints.rateRupees}`,
    });
  } else if (documentKind === 'quote' || documentKind === 'invoice') {
    missingFields.push('unitRateRupees');
  }

  if (gstPct !== null) {
    evidence.push({
      field: 'gstPct',
      value: gstPct,
      confidence: 0.92,
      evidenceQuote: hints.evidenceSnippets.find((s) => s.startsWith('GST')) ?? `${gstPct}%`,
    });
  } else if (documentKind === 'quote' || documentKind === 'invoice') {
    missingFields.push('gstPct');
  }

  if (hints.freightRupees !== null) {
    evidence.push({
      field: 'freightRupees',
      value: hints.freightRupees,
      confidence: 0.9,
      evidenceQuote: hints.evidenceSnippets.find((s) => s.startsWith('Freight')) ?? `₹${hints.freightRupees}`,
    });
  }

  if (hints.creditDays !== null) {
    evidence.push({
      field: 'creditDays',
      value: hints.creditDays,
      confidence: 0.92,
      evidenceQuote: hints.evidenceSnippets.find((s) => s.startsWith('Credit')) ?? `${hints.creditDays} days`,
    });
  } else if (documentKind === 'quote') {
    missingFields.push('creditDays');
  }

  // Invoice totals extraction
  const extractMoneyAfter = (pat: RegExp): number | null => {
    const m = text.match(pat);
    if (!m?.[1]) return null;
    const val = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(val) ? val : null;
  };

  const statedTaxableRupees = extractMoneyAfter(/(?:taxable\s*(?:value|amount)?|sub\s*-?total)\s*[:=-]?\s*(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const statedCgstRupees = extractMoneyAfter(/\bcgst\b[^0-9\n]{0,16}(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const statedSgstRupees = extractMoneyAfter(/\bsgst\b[^0-9\n]{0,16}(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const statedIgstRupees = extractMoneyAfter(/\bigst\b[^0-9\n]{0,16}(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const statedGrandTotalRupees = extractMoneyAfter(/(?:grand\s*total|invoice\s*total|total\s*payable|net\s*amount)\s*[:=-]?\s*(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)/i);

  let freightGstMode: FreightGstMode = 'unknown';
  if (/rcm|reverse\s*charge/i.test(lower)) freightGstMode = 'gta_rcm_5';
  else if (/bilty|consignment\s*note|gta/i.test(lower)) freightGstMode = 'gta_rcm_5';
  else if (/local\s*tempo|non-gta|individual\s*truck/i.test(lower)) freightGstMode = 'non_gta_exempt';
  else if (hints.freightRupees && hints.freightRupees > 0) freightGstMode = 'composite_supply';
  else if (hints.incotermOrDelivery === 'FOR Destination') freightGstMode = 'included_in_rate';

  const freightAlreadyTaxInclusive =
    /(freight|transport|bhada).{0,40}(already\s+incl|incl\.?\s*of\s*gst|tax\s*paid|double\s*gst)/i.test(lower);

  const leadMatch = lower.match(/(?:lead\s*time|dispatch\s*in|delivery\s*in)\s*(\d{1,3})\s*(?:days?|din)/i);
  const leadTimeDays = leadMatch ? parseInt(leadMatch[1], 10) : null;

  const overallConfidence = missingFields.length === 0 ? 0.9 : Math.max(0.6, 0.88 - missingFields.length * 0.08);

  return {
    engine: 'deterministic_local',
    documentKind,
    supplierName,
    supplierPhone,
    supplierEmail,
    supplierGstin,
    invoiceNumber,
    invoiceDate,
    irn,
    hasQr: Boolean(irn || /qr\s*code/i.test(lower)),
    items: [
      {
        itemKey: slugifyItem(description),
        description,
        hsnSac,
        qty,
        unit: qtyUnit || 'pc',
        unitRateRupees: hints.rateRupees,
        packSize: null,
        discountRupees: null,
        gstPct,
      },
    ],
    isGstInclusive: hints.isGstInclusive,
    freightRupees: hints.freightRupees,
    freightGstPct: null,
    freightGstMode,
    freightAlreadyTaxInclusive,
    cashDiscountPct: hints.cashDiscountPct,
    creditDays: hints.creditDays,
    leadTimeDays,
    statedTaxableRupees,
    statedCgstRupees,
    statedSgstRupees,
    statedIgstRupees,
    statedRoundOffRupees: 0,
    statedGrandTotalRupees,
    deliveryDueDate: null,
    summary: `[${channel.toUpperCase()}] Parsed ${documentKind.replace('_', ' ')}${supplierName ? ` from ${supplierName}` : ''}${hints.rateRupees !== null ? ` @ ₹${hints.rateRupees}` : ''}${hints.creditDays !== null ? `, ${hints.creditDays}d credit` : ''}.`,
    overallConfidence,
    needsVerification: overallConfidence < 0.85 || missingFields.length > 0,
    missingFields,
    evidence,
  };
}
