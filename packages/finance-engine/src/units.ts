import { Paise, toPaise } from './types.js';

export type CanonicalUnit = 'pc' | 'kg' | 'ltr' | 'sqm' | 'mtr' | 'service';

export interface NormalizedRate {
  rawRatePaise: Paise;
  rawUnit: string;
  canonicalUnit: CanonicalUnit;
  normalizedUnitRatePaise: Paise;
  packMultiplier: number;
  normalizationNote: string;
}

const UNIT_CONVERSIONS: Record<string, { canonical: CanonicalUnit; multiplier: number; label: string }> = {
  pc: { canonical: 'pc', multiplier: 1, label: 'pc' },
  pcs: { canonical: 'pc', multiplier: 1, label: 'pc' },
  piece: { canonical: 'pc', multiplier: 1, label: 'pc' },
  pieces: { canonical: 'pc', multiplier: 1, label: 'pc' },
  no: { canonical: 'pc', multiplier: 1, label: 'pc' },
  nos: { canonical: 'pc', multiplier: 1, label: 'pc' },
  unit: { canonical: 'pc', multiplier: 1, label: 'pc' },
  units: { canonical: 'pc', multiplier: 1, label: 'pc' },
  nag: { canonical: 'pc', multiplier: 1, label: 'pc' }, // Common Hindi/Marathi unit for pieces
  dozen: { canonical: 'pc', multiplier: 12, label: 'dozen (12 pcs)' },
  doz: { canonical: 'pc', multiplier: 12, label: 'dozen (12 pcs)' },
  dz: { canonical: 'pc', multiplier: 12, label: 'dozen (12 pcs)' },
  gross: { canonical: 'pc', multiplier: 144, label: 'gross (144 pcs)' },
  rim: { canonical: 'pc', multiplier: 500, label: 'rim (500 sheets)' },
  ream: { canonical: 'pc', multiplier: 500, label: 'ream (500 sheets)' },
  kg: { canonical: 'kg', multiplier: 1, label: 'kg' },
  kgs: { canonical: 'kg', multiplier: 1, label: 'kg' },
  kilogram: { canonical: 'kg', multiplier: 1, label: 'kg' },
  gm: { canonical: 'kg', multiplier: 0.001, label: 'gram (0.001 kg)' },
  g: { canonical: 'kg', multiplier: 0.001, label: 'gram (0.001 kg)' },
  gram: { canonical: 'kg', multiplier: 0.001, label: 'gram (0.001 kg)' },
  quintal: { canonical: 'kg', multiplier: 100, label: 'quintal (100 kg)' },
  qtl: { canonical: 'kg', multiplier: 100, label: 'quintal (100 kg)' },
  mt: { canonical: 'kg', multiplier: 1000, label: 'MT (1,000 kg)' },
  ton: { canonical: 'kg', multiplier: 1000, label: 'ton (1,000 kg)' },
  tonne: { canonical: 'kg', multiplier: 1000, label: 'tonne (1,000 kg)' },
  ltr: { canonical: 'ltr', multiplier: 1, label: 'ltr' },
  l: { canonical: 'ltr', multiplier: 1, label: 'ltr' },
  liter: { canonical: 'ltr', multiplier: 1, label: 'ltr' },
  litre: { canonical: 'ltr', multiplier: 1, label: 'ltr' },
  ml: { canonical: 'ltr', multiplier: 0.001, label: 'ml (0.001 ltr)' },
  barrel: { canonical: 'ltr', multiplier: 210, label: 'standard industrial drum/barrel (210 ltr)' },
  drum: { canonical: 'ltr', multiplier: 210, label: 'standard drum (210 ltr)' },
  sqm: { canonical: 'sqm', multiplier: 1, label: 'sq.m' },
  sqft: { canonical: 'sqm', multiplier: 0.092903, label: 'sq.ft (0.0929 sq.m)' },
  mtr: { canonical: 'mtr', multiplier: 1, label: 'mtr' },
  meter: { canonical: 'mtr', multiplier: 1, label: 'mtr' },
  ft: { canonical: 'mtr', multiplier: 0.3048, label: 'ft (0.3048 mtr)' },
  amc: { canonical: 'service', multiplier: 1, label: 'service' },
  job: { canonical: 'service', multiplier: 1, label: 'service' },
  visit: { canonical: 'service', multiplier: 1, label: 'service' },
  service: { canonical: 'service', multiplier: 1, label: 'service' },
};

/**
 * Losslessly normalizes quoted unit prices into a comparable canonical unit.
 * Supports explicit pack sizes like "carton of 50", "box (25 pcs)", "bundle of 100",
 * and Indian B2B units like MT, quintal, dozen, gross, nag.
 * Always produces an explicit normalization note (Accio Spec §7.1: zero hidden assumptions).
 */
export function normalizeUnitRate(params: {
  rawRateRupees: number;
  rawUnit: string;
  explicitPackSize?: number | null;
}): NormalizedRate {
  const rawRatePaise = toPaise(params.rawRateRupees);
  const unitClean = (params.rawUnit || 'pc').trim().toLowerCase();

  // Check explicit pack syntax: "carton of 30", "box of 500", "pack 25 pcs", "20L bucket"
  const packMatch = unitClean.match(
    /(?:carton|box|pack|bundle|bag|case|roll|drum|bucket|can|set)\s*(?:of|\(|x|\*)?\s*(\d+(?:\.\d+)?)\s*(pcs?|nos?|kg|ltr|l|mtr|sheets?)?/i
  );

  if (params.explicitPackSize && params.explicitPackSize > 0) {
    const normalized = Math.round(rawRatePaise / params.explicitPackSize);
    return {
      rawRatePaise,
      rawUnit: params.rawUnit,
      canonicalUnit: 'pc',
      normalizedUnitRatePaise: normalized,
      packMultiplier: params.explicitPackSize,
      normalizationNote: `Normalized: ₹${params.rawRateRupees}/${params.rawUnit} ÷ ${params.explicitPackSize} = ₹${(normalized / 100).toFixed(2)}/pc`,
    };
  }

  if (packMatch) {
    const qtyInPack = parseFloat(packMatch[1]);
    const innerUnitRaw = (packMatch[2] || 'pc').toLowerCase();
    const innerConv = UNIT_CONVERSIONS[innerUnitRaw] ?? { canonical: 'pc' as CanonicalUnit, multiplier: 1, label: 'pc' };
    const totalCanonical = qtyInPack * innerConv.multiplier;
    const normalized = Math.round(rawRatePaise / totalCanonical);
    return {
      rawRatePaise,
      rawUnit: params.rawUnit,
      canonicalUnit: innerConv.canonical,
      normalizedUnitRatePaise: normalized,
      packMultiplier: totalCanonical,
      normalizationNote: `Normalized: ₹${params.rawRateRupees}/${params.rawUnit} ÷ ${totalCanonical} = ₹${(normalized / 100).toFixed(2)}/${innerConv.canonical}`,
    };
  }

  // Direct unit lookup (e.g., "MT", "quintal", "dozen", "kg", "pcs")
  const token = unitClean.replace(/[^a-z]/g, '');
  const conv = UNIT_CONVERSIONS[token];
  if (conv) {
    const normalized = Math.round(rawRatePaise / conv.multiplier);
    const note =
      conv.multiplier === 1
        ? `No unit conversion (${conv.canonical})`
        : `Normalized: ₹${params.rawRateRupees} per ${conv.label} ÷ ${conv.multiplier} = ₹${(normalized / 100).toFixed(2)}/${conv.canonical}`;
    return {
      rawRatePaise,
      rawUnit: params.rawUnit,
      canonicalUnit: conv.canonical,
      normalizedUnitRatePaise: normalized,
      packMultiplier: conv.multiplier,
      normalizationNote: note,
    };
  }

  return {
    rawRatePaise,
    rawUnit: params.rawUnit,
    canonicalUnit: 'pc',
    normalizedUnitRatePaise: rawRatePaise,
    packMultiplier: 1,
    normalizationNote: `Unrecognized unit '${params.rawUnit}' — treated as 1:1 (verify pack size)`,
  };
}

export interface ParsedHinglishQuoteHint {
  rateRupees: number | null;
  unit: string | null;
  gstPct: number | null;
  isGstExtra: boolean | null;
  isGstInclusive: boolean | null;
  freightRupees: number | null;
  freightExtra: boolean;
  creditDays: number | null;
  cashDiscountPct: number | null;
  incotermOrDelivery: string | null;
  evidenceSnippets: string[];
}

/**
 * Deterministic regex extractor for common Indian WhatsApp / Hinglish shorthand:
 * e.g., "22 plus gst extra transport 5k, 30 din udhari, CD 2%"
 * Used both as a zero-key fast parser and as a cross-check against LLM extraction!
 */
export function parseHinglishShorthand(text: string): ParsedHinglishQuoteHint {
  const lower = text.toLowerCase();
  const evidenceSnippets: string[] = [];

  // Parse K/lakh suffix numbers helper
  const parseIndianNum = (raw: string): number => {
    const cleaned = raw.replace(/,/g, '').trim().toLowerCase();
    if (cleaned.endsWith('k')) return parseFloat(cleaned.slice(0, -1)) * 1000;
    if (cleaned.endsWith('l') || cleaned.includes('lakh')) {
      return parseFloat(cleaned.replace(/[^0-9.]/g, '')) * 100_000;
    }
    return parseFloat(cleaned);
  };

  // Rate extraction: prioritize revised/current rate ("ab 28 kar diya" / "now 28") before initial rate!
  let rateRupees: number | null = null;
  let unit: string | null = null;
  const revisedRateMatch = text.match(/(?:ab|now|revised\s*to|increased\s*to|hiked\s*to)\s*(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const rateMatch =
    revisedRateMatch ||
    text.match(/(?:₹|rs\.?|inr|@|rate\s*[:=-]?|offered)\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:\/|per)\s*([a-zA-Z0-9\s]{1,18}))?/i) ||
    text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:\+|plus)\s*(?:gst|tax)/i) ||
    text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:flat|net|all\s*incl)/i);

  if (rateMatch) {
    rateRupees = parseFloat(rateMatch[1].replace(/,/g, ''));
    unit = rateMatch[2]?.trim() || null;
    evidenceSnippets.push(`Rate cue: "${rateMatch[0].trim()}"`);
  }

  // GST extraction
  let gstPct: number | null = null;
  const gstPctMatch = lower.match(/(?:gst|tax)\s*@?\s*(\d{1,2})\s*%|(\d{1,2})\s*%\s*(?:gst|tax)/i);
  if (gstPctMatch) {
    gstPct = parseInt(gstPctMatch[1] || gstPctMatch[2], 10);
    evidenceSnippets.push(`GST cue: "${gstPctMatch[0].trim()}"`);
  }

  const isGstExtra =
    /(\+|plus)\s*(gst|tax)|(gst|tax)\s*(extra|alag|additional|excl)/i.test(lower) ? true : null;
  const isGstInclusive =
    /(incl|including|inclusive|all\s*in|net|flat)\s*(of\s*)?(gst|tax)?/i.test(lower) && !isGstExtra
      ? true
      : null;

  // Freight / Bhada / Transport extraction
  let freightRupees: number | null = null;
  const freightMatch = text.match(
    /(?:freight|transport|bhada|delivery\s*charge|cartage|tempo|truck)\s*(?:extra|alag|rs\.?|₹|:|=|-|\s)*\s*(?:₹|rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?\s*k?)/i
  );
  if (freightMatch && freightMatch[1]) {
    freightRupees = parseIndianNum(freightMatch[1]);
    evidenceSnippets.push(`Freight cue: "${freightMatch[0].trim()}"`);
  }
  const freightExtra =
    freightRupees !== null || /(freight|transport|bhada)\s*(extra|alag|buyer)/i.test(lower);

  // Credit days extraction: "30-day credit", "45 days", "30 din udhari", "cash on delivery", "payment advance"
  let creditDays: number | null = null;
  const creditMatch = lower.match(/(\d{1,3})\s*(?:-|\s)?(?:days?|din)\s*(?:credit|udhari|udhar|net|terms)?/i);
  if (creditMatch) {
    creditDays = parseInt(creditMatch[1], 10);
    evidenceSnippets.push(`Credit cue: "${creditMatch[0].trim()}"`);
  } else if (/(cash\s*on\s*delivery|\bcod\b|cash\s*advance|100%\s*advance|immediate\s*cash|cash\s*flat|advance\s*payment|payment\s*advance)/i.test(lower)) {
    creditDays = 0;
    evidenceSnippets.push('Credit cue: Cash / 0-day terms');
  }

  // Cash discount extraction: "CD 2%" or "CD 2 percent"
  let cashDiscountPct: number | null = null;
  const cdMatch = lower.match(/(?:cd|cash\s*discount)\s*(\d+(?:\.\d+)?)\s*(?:%|percent|pct)/i);
  if (cdMatch) {
    cashDiscountPct = parseFloat(cdMatch[1]);
    evidenceSnippets.push(`Cash discount cue: "${cdMatch[0].trim()}"`);
  }

  // Delivery terms: FOR / Ex-factory / Ex-works
  let incotermOrDelivery: string | null = null;
  if (/\bfor\b|free\s*on\s*road|delivered\s*to\s*godown|door\s*delivery/i.test(lower)) {
    incotermOrDelivery = 'FOR Destination';
  } else if (/\bexw\b|ex-?factory|ex-?works|ex-?godown/i.test(lower)) {
    incotermOrDelivery = 'Ex-Factory / EXW';
  }

  return {
    rateRupees,
    unit,
    gstPct,
    isGstExtra,
    isGstInclusive,
    freightRupees,
    freightExtra,
    creditDays,
    cashDiscountPct,
    incotermOrDelivery,
    evidenceSnippets,
  };
}
