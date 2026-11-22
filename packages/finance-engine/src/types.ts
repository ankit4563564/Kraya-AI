/**
 * Integer paise representation eliminates IEEE-754 floating-point drift on INR math.
 * 1 INR = 100 paise.
 */
export type Paise = number;

export function toPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

export function fromPaise(paise: Paise): number {
  return Math.round(paise) / 100;
}

export function formatINR(paise: Paise, decimals = 2): string {
  const rupees = fromPaise(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rupees);
}

export type GstRegime = 'regular' | 'composition' | 'unregistered';
export type TurnoverBand = 'under_5cr' | '5cr_to_10cr' | 'above_10cr';
export type UdyamTier =
  | 'micro'
  | 'small'
  | 'medium'
  | 'trader'
  | 'unregistered'
  | 'unknown';

export type FreightGstMode =
  | 'included_in_rate'
  | 'composite_supply' // Supplier charges freight on same goods invoice (Sec 8 CGST)
  | 'gta_rcm_5' // Independent GTA with Bilty/CN — default 5% Reverse Charge by buyer
  | 'gta_fcm_5' // Independent GTA — 5% Forward Charge (Annexure V, no ITC to GTA)
  | 'gta_fcm_18' // Independent GTA — 18% Forward Charge (post-2025 GST 2.0, replaced 12%)
  | 'non_gta_exempt' // Individual truck/tempo without Consignment Note — 0% Exempt
  | 'unknown';

export type TaxSplitType = 'intra_cgst_sgst' | 'inter_igst' | 'exempt_or_nil';

export type ImsSuggestedAction =
  | 'ACCEPT'
  | 'KEEP_PENDING'
  | 'REJECT'
  | 'NOT_APPLICABLE';

export type MoneyLeakType =
  | 'rate_creep'
  | 'po_rate_overcharge'
  | 'po_qty_short_shipment'
  | 'grn_short_receipt_overbill'
  | 'po_unordered_item'
  | 'po_missing_item'
  | 'po_gst_mismatch'
  | 'double_gst_freight'
  | 'wrong_freight_gst_rate'
  | 'wrong_tax_split_state'
  | 'stale_gst_slab'
  | 'math_overcharge'
  | 'composition_tax_fraud'
  | 'missing_irn_itc_risk'
  | 'rcm_unaccounted'
  | 'non_gta_illegal_tax'
  | 'msme_43bh_tax_risk';

export type Severity = 'critical' | 'warning' | 'info';

export interface ComplianceFlag {
  code:
    | MoneyLeakType
    | 'blocked_credit_17_5'
    | 'rule37_180d_warning'
    | 'rule42_43_partial_itc'
    | 'tds_194c'
    | 'tds_194q'
    | 'invalid_gstin';
  severity: Severity;
  title: string;
  detail: string;
  impactPaise: Paise;
  statutoryRef: string;
  recommendedAction: string;
}

export interface WorkspaceTaxProfile {
  legalName: string;
  gstin?: string | null;
  stateCode: string; // 2-digit Indian state code e.g. '27'
  gstRegime: GstRegime;
  waccPct: number; // Annual cost of capital e.g. 15.0 (Indian SMB CC/OD typical 12-18%)
  turnoverBand: TurnoverBand;
}

export interface SupplierTaxProfile {
  id: string;
  name: string;
  gstin?: string | null;
  stateCode?: string | null;
  gstRegime: GstRegime;
  udyamTier: UdyamTier;
  category?: string | null; // e.g. 'Trader', 'Wholesale Trader', 'Manufacturer', 'Services'
  isTrader?: boolean; // Office Memorandum No. 5/2(2)/2021: Traders excluded from MSME 43B(h)
  eInvoiceRequired?: boolean;
  reliabilityScore?: number; // 0-100
}
