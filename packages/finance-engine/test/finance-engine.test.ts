import { describe, it, expect } from 'vitest';
import {
  auditSupplierInvoice,
  computeGstinChecksum,
  computeGstLine,
  computeLandedCost,
  determineTaxSplit,
  evaluateMsme43bh,
  formatINR,
  fromPaise,
  lookupHsn,
  normalizeUnitRate,
  parseHinglishShorthand,
  rankSupplierQuotes,
  toPaise,
  validateGstin,
  validateInvoiceTaxSplit,
  WorkspaceTaxProfile,
  SupplierTaxProfile,
} from '../src/index.js';

const MH_REGULAR_BUYER: WorkspaceTaxProfile = {
  legalName: 'Apex Packaging Pvt Ltd',
  stateCode: '27', // Maharashtra
  gstRegime: 'regular',
  waccPct: 18.0, // Indian SMB working-capital WACC (18% p.a. => ₹100 on 45d credit ≈ ₹97.78!)
  turnoverBand: '5cr_to_10cr',
};

const MH_COMPOSITION_BUYER: WorkspaceTaxProfile = {
  legalName: 'Shree Ganesh Traders',
  stateCode: '27',
  gstRegime: 'composition',
  waccPct: 15.0,
  turnoverBand: 'under_5cr',
};

function makeValidGstin(prefix14: string): string {
  return prefix14 + computeGstinChecksum(prefix14);
}

const VALID_MH_COMPANY_GSTIN = makeValidGstin('27AAPCA1234F1Z');
const VALID_GJ_PROP_GSTIN = makeValidGstin('24ABCPK5678L1Z');

describe('1. GSTIN Structural & Official Mod-36 Checksum Validation', () => {
  it('validates a well-formed Maharashtra Company GSTIN and extracts PAN entity + 2% 194C TDS', () => {
    const res = validateGstin(VALID_MH_COMPANY_GSTIN);
    expect(res.valid).toBe(true);
    expect(res.stateCode).toBe('27');
    expect(res.stateName).toBe('Maharashtra');
    expect(res.pan).toBe('AAPCA1234F');
    expect(res.panEntityCode).toBe('C');
    expect(res.tds194cRatePct).toBe(2);
  });

  it('extracts 1% Section 194C TDS rate for Individual/Proprietor PAN (4th char P)', () => {
    const res = validateGstin(VALID_GJ_PROP_GSTIN);
    expect(res.valid).toBe(true);
    expect(res.stateCode).toBe('24');
    expect(res.stateName).toBe('Gujarat');
    expect(res.panEntityCode).toBe('P');
    expect(res.tds194cRatePct).toBe(1);
  });

  it('rejects a GSTIN with a tampered 15th checksum character', () => {
    const badLastChar = VALID_MH_COMPANY_GSTIN[14] === 'A' ? 'B' : 'A';
    const tampered = VALID_MH_COMPANY_GSTIN.slice(0, 14) + badLastChar;
    const res = validateGstin(tampered);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Checksum mismatch'))).toBe(true);
  });

  it('rejects invalid state code 95 and short strings', () => {
    expect(validateGstin('95AAPCA1234F1Z5').valid).toBe(false);
    expect(validateGstin('27AAPCA').valid).toBe(false);
    expect(validateGstin('').valid).toBe(false);
  });
});

describe('2. GST 2.0, Intra/Inter Split, Composition Trap, Freight/GTA & Blocked Credits', () => {
  const mhRegularVendor: SupplierTaxProfile = {
    id: 'sup-1',
    name: 'Bharat Corrugators',
    gstin: VALID_MH_COMPANY_GSTIN,
    stateCode: '27',
    gstRegime: 'regular',
    udyamTier: 'small',
  };

  const gjRegularVendor: SupplierTaxProfile = {
    id: 'sup-2',
    name: 'Surat Box Works',
    gstin: VALID_GJ_PROP_GSTIN,
    stateCode: '24',
    gstRegime: 'regular',
    udyamTier: 'medium',
  };

  it('splits intra-state tax 50/50 into CGST+SGST reconciling to exact paisa', () => {
    const res = computeGstLine({
      taxablePaise: toPaise(10001), // odd rupee amount
      gstRatePct: 5,
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
    });
    expect(res.taxSplitType).toBe('intra_cgst_sgst');
    expect(res.cgstPaise + res.sgstPaise).toBe(res.totalGstPaise);
    expect(res.igstPaise).toBe(0);
    expect(res.itcRecoverablePaise).toBe(res.totalGstPaise);
    expect(res.nonRecoverableGstPaise).toBe(0);
  });

  it('applies IGST for inter-state Gujarat -> Maharashtra supply', () => {
    expect(determineTaxSplit('24', '27', 18)).toBe('inter_igst');
    const res = computeGstLine({
      taxablePaise: toPaise(50000),
      gstRatePct: 18,
      buyer: MH_REGULAR_BUYER,
      supplier: gjRegularVendor,
    });
    expect(res.igstPaise).toBe(toPaise(9000));
    expect(res.cgstPaise).toBe(0);
    expect(res.sgstPaise).toBe(0);
  });

  it('flags illegal GST collection by a Composition Scheme vendor (Section 10)', () => {
    const compVendor: SupplierTaxProfile = {
      ...mhRegularVendor,
      gstRegime: 'composition',
    };
    const res = computeGstLine({
      taxablePaise: toPaise(100000),
      gstRatePct: 18,
      buyer: MH_REGULAR_BUYER,
      supplier: compVendor,
    });
    expect(res.flags.some((f) => f.code === 'composition_tax_fraud')).toBe(true);
    expect(res.itcRecoverablePaise).toBe(0);
    expect(res.nonRecoverableGstPaise).toBe(toPaise(18000));
  });

  it('flags legacy 12% slab after GST 2.0 Sept 2025 reform on corrugated boxes (HSN 4819 -> 5%)', () => {
    const res = computeGstLine({
      taxablePaise: toPaise(100000),
      gstRatePct: 12,
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
      hsnOrItemText: '4819 corrugated boxes',
      invoiceDate: '2026-10-15',
    });
    const flag = res.flags.find((f) => f.code === 'stale_gst_slab');
    expect(flag).toBeDefined();
    expect(flag?.impactPaise).toBe(toPaise(7000)); // 12% vs 5% = 7% overcharge
  });

  it('does NOT flag historical 12% invoice dated before Sept 22, 2025', () => {
    const res = computeGstLine({
      taxablePaise: toPaise(100000),
      gstRatePct: 12,
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
      hsnOrItemText: '4819',
      invoiceDate: '2025-04-10',
    });
    expect(res.flags.some((f) => f.code === 'stale_gst_slab')).toBe(false);
  });

  it('adds Section 17(5) Blocked Credit GST (e.g. outdoor catering / civil works) into non-recoverable cost', () => {
    const res = computeGstLine({
      taxablePaise: toPaise(50000),
      gstRatePct: 18,
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
      hsnOrItemText: '9954 factory shed construction',
    });
    expect(res.itcRecoverablePaise).toBe(0);
    expect(res.nonRecoverableGstPaise).toBe(toPaise(9000));
    expect(res.flags.some((f) => f.code === 'blocked_credit_17_5')).toBe(true);
  });

  it('enforces Composite Supply freight rate = principal goods GST rate (Section 8)', () => {
    const res = computeGstLine({
      taxablePaise: toPaise(10000),
      gstRatePct: 18,
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
      isFreightLine: true,
      freightGstMode: 'composite_supply',
      principalGoodsGstPct: 5,
    });
    const flag = res.flags.find((f) => f.code === 'wrong_freight_gst_rate');
    expect(flag).toBeDefined();
    expect(flag?.impactPaise).toBe(toPaise(1300)); // 13% excess on ₹10,000 freight
  });

  it('handles GTA 5% RCM liability and flags illegal GST by Non-GTA tempo operator', () => {
    const rcmRes = computeGstLine({
      taxablePaise: toPaise(20000),
      gstRatePct: 0,
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
      isFreightLine: true,
      freightGstMode: 'gta_rcm_5',
    });
    expect(rcmRes.rcmPayablePaise).toBe(toPaise(1000));
    expect(rcmRes.flags.some((f) => f.code === 'rcm_unaccounted')).toBe(true);

    const nonGtaRes = computeGstLine({
      taxablePaise: toPaise(8000),
      gstRatePct: 18,
      buyer: MH_REGULAR_BUYER,
      supplier: { ...mhRegularVendor, gstRegime: 'unregistered' },
      isFreightLine: true,
      freightGstMode: 'non_gta_exempt',
    });
    expect(nonGtaRes.flags.some((f) => f.code === 'non_gta_illegal_tax')).toBe(true);
  });

  it('catches CGST+SGST wrongly billed on inter-state supply', () => {
    const flag = validateInvoiceTaxSplit({
      supplierGstin: VALID_GJ_PROP_GSTIN,
      buyerStateCode: '27',
      billedCgstPaise: toPaise(4500),
      billedSgstPaise: toPaise(4500),
      billedIgstPaise: 0,
    });
    expect(flag?.code).toBe('wrong_tax_split_state');
    expect(flag?.impactPaise).toBe(toPaise(9000));
  });

  it('correctly calculates Rule 42/43 partial ITC restriction (80%) and flags non-creditable GST capitalized into cost', () => {
    const res = computeGstLine({
      taxablePaise: toPaise(100000), // ₹1,00,000 taxable
      gstRatePct: 18, // 18% GST = ₹18,000
      buyer: MH_REGULAR_BUYER,
      supplier: mhRegularVendor,
      itcRecoveryPct: 80, // 80% creditable, 20% non-creditable under Rule 42/43
    });

    expect(res.totalGstPaise).toBe(toPaise(18000));
    expect(res.itcRecoverablePaise).toBe(toPaise(14400)); // 80% of 18,000 = ₹14,400
    expect(res.nonRecoverableGstPaise).toBe(toPaise(3600)); // 20% of 18,000 = ₹3,600
    expect(res.flags.some((f) => f.code === 'rule42_43_partial_itc')).toBe(true);
    const rule42Flag = res.flags.find((f) => f.code === 'rule42_43_partial_itc');
    expect(rule42Flag?.impactPaise).toBe(toPaise(3600));
    expect(rule42Flag?.statutoryRef).toContain('Rule 42 & 43');
  });
});

describe('3. Unit Normalization & Hinglish Shorthand Parser', () => {
  it('normalizes carton/box pack sizes, MT, quintal, and dozen losslessly with explicit notes', () => {
    const carton = normalizeUnitRate({ rawRateRupees: 1180, rawUnit: 'carton of 50 pcs' });
    expect(fromPaise(carton.normalizedUnitRatePaise)).toBeCloseTo(23.6, 2);
    expect(carton.canonicalUnit).toBe('pc');
    expect(carton.normalizationNote).toContain('÷ 50');

    const mt = normalizeUnitRate({ rawRateRupees: 58000, rawUnit: 'MT' });
    expect(fromPaise(mt.normalizedUnitRatePaise)).toBe(58);
    expect(mt.canonicalUnit).toBe('kg');

    const doz = normalizeUnitRate({ rawRateRupees: 240, rawUnit: 'dozen' });
    expect(fromPaise(doz.normalizedUnitRatePaise)).toBe(20);
  });

  it('parses messy Hinglish WhatsApp quotes accurately', () => {
    const parsed = parseHinglishShorthand(
      'Bhai 22 plus gst 18% extra transport 5k, 30 din udhari, CD 2%, Ex-factory'
    );
    expect(parsed.rateRupees).toBe(22);
    expect(parsed.gstPct).toBe(18);
    expect(parsed.isGstExtra).toBe(true);
    expect(parsed.freightRupees).toBe(5000);
    expect(parsed.creditDays).toBe(30);
    expect(parsed.cashDiscountPct).toBe(2);
    expect(parsed.incotermOrDelivery).toBe('Ex-Factory / EXW');
  });

  it('parses verbal phone call flat cash quote', () => {
    const parsed = parseHinglishShorthand('Ramesh offered ₹24 flat cash on delivery, Monday dispatch');
    expect(parsed.rateRupees).toBe(24);
    expect(parsed.isGstInclusive).toBe(true);
    expect(parsed.creditDays).toBe(0);
  });
});

describe('4. Credit-Adjusted Real Cost, Working-Capital Math & Section 43B(h) MSME Cap', () => {
  it('proves ₹100 on 45-day credit beats ₹98.50 cash advance under 18% Indian SMB WACC', () => {
    const vendorA: SupplierTaxProfile = {
      id: 'v-credit',
      name: 'Shreeji Pack (45d)',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'small',
    };
    const vendorB: SupplierTaxProfile = {
      id: 'v-cash',
      name: 'QuickCash Box (0d)',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'medium',
    };

    const comparison = rankSupplierQuotes(
      [
        {
          quoteId: 'q1',
          supplier: vendorA,
          quantity: 1000,
          rawRateRupees: 100,
          rawUnit: 'pc',
          gstPct: 5,
          creditDays: 45,
          hasWrittenAgreement: true,
        },
        {
          quoteId: 'q2',
          supplier: vendorB,
          quantity: 1000,
          rawRateRupees: 98.5,
          rawUnit: 'pc',
          gstPct: 5,
          creditDays: 0,
        },
      ],
      MH_REGULAR_BUYER
    );

    expect(comparison.winner?.supplierId).toBe('v-credit');
    // ₹105 cash outflow * 18% * (45/365) = ₹2.33/unit financing benefit => ₹97.67 effective!
    expect(fromPaise(comparison.winner!.creditAdjustedRealUnitPaise)).toBeLessThan(98.0);
    expect(comparison.savingsVsSecondBestPaise).toBeGreaterThan(0);
  });

  it('enforces Section 43B(h) hard cap: overrides 60-day credit from Small MSME to 45 days (and 15 days without written PO)', () => {
    const smallMsme: SupplierTaxProfile = {
      id: 'msme-1',
      name: 'Ramesh Micro Works',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'micro',
    };

    const withPo = evaluateMsme43bh({
      supplier: smallMsme,
      quotedCreditDays: 60,
      hasWrittenAgreement: true,
      orderTaxableTotalPaise: toPaise(200000),
    });
    expect(withPo.effectiveCreditDays).toBe(45);
    expect(withPo.flag?.code).toBe('msme_43bh_tax_risk');

    const verbalOnly = evaluateMsme43bh({
      supplier: smallMsme,
      quotedCreditDays: 30,
      hasWrittenAgreement: false,
      orderTaxableTotalPaise: toPaise(200000),
    });
    expect(verbalOnly.effectiveCreditDays).toBe(15);
    expect(verbalOnly.flag?.code).toBe('msme_43bh_tax_risk');
  });

  it('does NOT cap credit days for Medium enterprises or pure Traders under 43B(h)', () => {
    const trader: SupplierTaxProfile = {
      id: 'tr-1',
      name: 'National Wholesale Traders',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'trader',
    };
    const res = evaluateMsme43bh({
      supplier: trader,
      quotedCreditDays: 90,
      hasWrittenAgreement: true,
      orderTaxableTotalPaise: toPaise(500000),
    });
    expect(res.effectiveCreditDays).toBe(90);
    expect(res.flag).toBeNull();
  });

  it('exempts Udyam Micro/Small Traders from Section 43B(h) per Office Memorandum No. 5/2(2)/2021 while restricting Manufacturers', () => {
    // 1. Udyam Micro enterprise flagged as trader via isTrader flag
    const microTrader: SupplierTaxProfile = {
      id: 'tr-micro',
      name: 'Agarwal Paper Traders (Micro Udyam)',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'micro',
      isTrader: true,
    };
    const resMicroTrader = evaluateMsme43bh({
      supplier: microTrader,
      quotedCreditDays: 60,
      hasWrittenAgreement: true,
      orderTaxableTotalPaise: toPaise(250000),
    });
    expect(resMicroTrader.effectiveCreditDays).toBe(60);
    expect(resMicroTrader.legalCapDays).toBeNull();
    expect(resMicroTrader.flag).toBeNull();

    // 2. Udyam Small enterprise classified under category: 'Wholesale Trader'
    const smallRetailTrader: SupplierTaxProfile = {
      id: 'tr-small',
      name: 'Bombay Packaging Supplies',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'small',
      category: 'Wholesale and Retail Trader',
    };
    const resSmallTrader = evaluateMsme43bh({
      supplier: smallRetailTrader,
      quotedCreditDays: 75,
      hasWrittenAgreement: true,
      orderTaxableTotalPaise: toPaise(400000),
    });
    expect(resSmallTrader.effectiveCreditDays).toBe(75);
    expect(resSmallTrader.legalCapDays).toBeNull();
    expect(resSmallTrader.flag).toBeNull();

    // 3. Contrast with Udyam Small Manufacturer who MUST be capped at 45 days
    const smallManufacturer: SupplierTaxProfile = {
      id: 'mfg-small',
      name: 'Gujarat Corrugators Pvt Ltd',
      stateCode: '24',
      gstRegime: 'regular',
      udyamTier: 'small',
      category: 'Corrugated Box Manufacturing',
      isTrader: false,
    };
    const resMfg = evaluateMsme43bh({
      supplier: smallManufacturer,
      quotedCreditDays: 60,
      hasWrittenAgreement: true,
      orderTaxableTotalPaise: toPaise(400000),
    });
    expect(resMfg.effectiveCreditDays).toBe(45);
    expect(resMfg.legalCapDays).toBe(45);
    expect(resMfg.flag?.code).toBe('msme_43bh_tax_risk');
  });

  it('adds non-recoverable GST to landed cost for Composition buyers & flags >2% silent price creep', () => {
    const regularVendor: SupplierTaxProfile = {
      id: 'v1',
      name: 'Metro Boxes',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'medium',
    };
    const res = computeLandedCost(
      {
        quoteId: 'q-creep',
        supplier: regularVendor,
        quantity: 5000,
        rawRateRupees: 25,
        rawUnit: 'pc',
        gstPct: 18,
        creditDays: 0,
        historicalBenchmarkLandedPaise: toPaise(27.0), // Net landed now is 25*1.18 = 29.50 -> +9.26% creep!
      },
      MH_COMPOSITION_BUYER
    );
    expect(fromPaise(res.netLandedUnitPaise)).toBeCloseTo(29.5, 2);
    expect(res.isPriceCreepAlert).toBe(true);
    expect(res.priceDeltaPct).toBeGreaterThan(9);
  });

  describe('Cash Discount Validation & Boundary Hardening', () => {
    const testVendor: SupplierTaxProfile = {
      id: 'sup-cd',
      name: 'Alpha Packaging Ltd',
      stateCode: '27',
      gstRegime: 'regular',
      udyamTier: 'medium',
    };

    it('preserves valid zero cash discount (0%)', () => {
      const res = computeLandedCost(
        {
          quoteId: 'q-cd-0',
          supplier: testVendor,
          quantity: 100,
          rawRateRupees: 100,
          rawUnit: 'pc',
          creditDays: 0,
          cashDiscountPct: 0,
          gstPct: 18,
        },
        MH_REGULAR_BUYER
      );
      expect(fromPaise(res.baseUnitPaise)).toBe(100);
      expect(fromPaise(res.discountUnitPaise)).toBe(0);
    });

    it('preserves valid decimal cash discount (10.5%)', () => {
      const res = computeLandedCost(
        {
          quoteId: 'q-cd-10.5',
          supplier: testVendor,
          quantity: 100,
          rawRateRupees: 100,
          rawUnit: 'pc',
          creditDays: 0,
          cashDiscountPct: 10.5,
          gstPct: 18,
        },
        MH_REGULAR_BUYER
      );
      // Base: ₹100, Discount 10.5% => ₹10.50, Net Base: ₹89.50
      expect(fromPaise(res.baseUnitPaise)).toBeCloseTo(89.5, 2);
      expect(fromPaise(res.discountUnitPaise)).toBeCloseTo(10.5, 2);
    });

    it('preserves valid boundary 100% cash discount', () => {
      const res = computeLandedCost(
        {
          quoteId: 'q-cd-100',
          supplier: testVendor,
          quantity: 100,
          rawRateRupees: 100,
          rawUnit: 'pc',
          creditDays: 0,
          cashDiscountPct: 100,
          gstPct: 18,
        },
        MH_REGULAR_BUYER
      );
      expect(fromPaise(res.baseUnitPaise)).toBe(0);
      expect(fromPaise(res.discountUnitPaise)).toBe(100);
    });

    it('rejects negative cash discount (-1%) with clear validation error', () => {
      expect(() =>
        computeLandedCost(
          {
            quoteId: 'q-cd-neg',
            supplier: testVendor,
            quantity: 100,
            rawRateRupees: 100,
            rawUnit: 'pc',
            creditDays: 0,
            cashDiscountPct: -1,
            gstPct: 18,
          },
          MH_REGULAR_BUYER
        )
      ).toThrow(/Invalid cash discount percentage: -1/);
    });

    it('rejects cash discount exceeding 100% (100.01%) with clear validation error', () => {
      expect(() =>
        computeLandedCost(
          {
            quoteId: 'q-cd-over',
            supplier: testVendor,
            quantity: 100,
            rawRateRupees: 100,
            rawUnit: 'pc',
            creditDays: 0,
            cashDiscountPct: 100.01,
            gstPct: 18,
          },
          MH_REGULAR_BUYER
        )
      ).toThrow(/Invalid cash discount percentage: 100.01/);
    });

    it('rejects NaN cash discount with clear validation error', () => {
      expect(() =>
        computeLandedCost(
          {
            quoteId: 'q-cd-nan',
            supplier: testVendor,
            quantity: 100,
            rawRateRupees: 100,
            rawUnit: 'pc',
            creditDays: 0,
            cashDiscountPct: NaN,
            gstPct: 18,
          },
          MH_REGULAR_BUYER
        )
      ).toThrow(/Invalid cash discount percentage: NaN/);
    });

    it('rejects Infinity cash discount with clear validation error', () => {
      expect(() =>
        computeLandedCost(
          {
            quoteId: 'q-cd-inf',
            supplier: testVendor,
            quantity: 100,
            rawRateRupees: 100,
            rawUnit: 'pc',
            creditDays: 0,
            cashDiscountPct: Infinity,
            gstPct: 18,
          },
          MH_REGULAR_BUYER
        )
      ).toThrow(/Invalid cash discount percentage: Infinity/);
    });
  });
});

describe('5. Invoice Self-Auditor, PO 3-Way Match & Money Leak Radar', () => {
  const bigVendor: SupplierTaxProfile = {
    id: 'sup-big',
    name: 'Shakti Packaging Industries',
    gstin: VALID_MH_COMPANY_GSTIN,
    stateCode: '27',
    gstRegime: 'regular',
    udyamTier: 'small',
    eInvoiceRequired: true,
  };

  it('catches PO rate overcharge, double GST on freight, missing e-Invoice IRN, and sets IMS=REJECT', () => {
    const audit = auditSupplierInvoice(
      {
        invoiceNumber: 'INV/26-27/0412',
        invoiceDate: '2026-11-10',
        supplier: bigVendor,
        supplierGstinOnBill: VALID_MH_COMPANY_GSTIN,
        irn: null, // Missing IRN!
        items: [
          {
            itemKey: 'box-5ply-12x10',
            description: '5-Ply Corrugated Box 12x10',
            hsnSac: '4819',
            qty: 5000,
            unit: 'pc',
            unitRateRupees: 26.5, // PO agreed was 25.00 -> ₹7,500 overcharge
            gstPct: 5,
          },
        ],
        freightRupees: 5000,
        freightGstPct: 18, // Composite supply should be 5%, PLUS already tax inclusive!
        freightGstMode: 'composite_supply',
        freightAlreadyTaxInclusive: true,
        statedTaxableRupees: 137500,
        statedCgstRupees: 3762.5,
        statedSgstRupees: 3762.5,
        statedIgstRupees: 0,
        statedGrandTotalRupees: 145025,
        creditDaysAgreed: 30,
        hasWrittenPo: true,
        poItems: [
          {
            itemKey: 'box-5ply-12x10',
            description: '5-Ply Corrugated Box 12x10',
            agreedQty: 5000,
            agreedUnitRateRupees: 25.0,
            agreedGstPct: 5,
          },
        ],
      },
      MH_REGULAR_BUYER
    );

    expect(audit.poMatchStatus).toBe('mismatch');
    expect(audit.imsSuggestedAction).toBe('REJECT'); // Missing IRN is critical tax defect
    expect(audit.flags.some((f) => f.code === 'po_rate_overcharge')).toBe(true);
    expect(audit.flags.some((f) => f.code === 'double_gst_freight')).toBe(true);
    expect(audit.flags.some((f) => f.code === 'wrong_freight_gst_rate')).toBe(true);
    expect(audit.flags.some((f) => f.code === 'missing_irn_itc_risk')).toBe(true);
    expect(audit.totalMoneyLeakPaise).toBeGreaterThan(toPaise(15000));
    expect(audit.msme43bhDueDate).toBe('2026-12-25'); // +45 days
    expect(audit.rule37_180DayCliffDate).toBe('2027-05-09'); // +180 days
  });

  it('passes a clean matched invoice with valid IRN and sets IMS=ACCEPT', () => {
    const validIrn = 'a'.repeat(64);
    const audit = auditSupplierInvoice(
      {
        invoiceNumber: 'INV/26-27/0501',
        invoiceDate: '2026-11-15',
        supplier: bigVendor,
        supplierGstinOnBill: VALID_MH_COMPANY_GSTIN,
        irn: validIrn,
        hasQr: true,
        items: [
          {
            itemKey: 'box-5ply-12x10',
            description: '5-Ply Corrugated Box 12x10',
            hsnSac: '4819',
            qty: 2000,
            unit: 'pc',
            unitRateRupees: 25.0,
            gstPct: 5,
          },
        ],
        statedTaxableRupees: 50000,
        statedCgstRupees: 1250,
        statedSgstRupees: 1250,
        statedIgstRupees: 0,
        statedGrandTotalRupees: 52500,
        creditDaysAgreed: 30,
        hasWrittenPo: true,
        poItems: [
          {
            itemKey: 'box-5ply-12x10',
            description: '5-Ply Corrugated Box 12x10',
            agreedQty: 2000,
            agreedUnitRateRupees: 25.0,
            agreedGstPct: 5,
          },
        ],
      },
      MH_REGULAR_BUYER
    );

    expect(audit.mathReconciled).toBe(true);
    expect(audit.poMatchStatus).toBe('matched');
    expect(audit.imsSuggestedAction).toBe('ACCEPT');
    expect(audit.totalMoneyLeakPaise).toBe(0);
    expect(audit.cfoVerdict).toContain('CLEAR TO PAY');
  });

  it('detects arithmetic overcharge when vendor mis-adds the grand total by ₹2,000', () => {
    const audit = auditSupplierInvoice(
      {
        invoiceNumber: 'BILL-99',
        invoiceDate: '2026-11-18',
        supplier: { ...bigVendor, eInvoiceRequired: false },
        supplierGstinOnBill: VALID_MH_COMPANY_GSTIN,
        items: [
          {
            itemKey: 'oil-20l',
            description: 'Hydraulic Oil',
            hsnSac: '2710',
            qty: 10,
            unit: 'drum',
            unitRateRupees: 4000,
            gstPct: 18,
          },
        ],
        statedTaxableRupees: 40000,
        statedCgstRupees: 3600,
        statedSgstRupees: 3600,
        statedIgstRupees: 0,
        statedGrandTotalRupees: 49200, // True total is 47,200!
      },
      MH_REGULAR_BUYER
    );

    expect(audit.mathReconciled).toBe(false);
    expect(audit.mathDiscrepancyPaise).toBe(toPaise(2000));
    expect(audit.flags.some((f) => f.code === 'math_overcharge')).toBe(true);
    expect(audit.imsSuggestedAction).toBe('KEEP_PENDING');
  });

  it('formats INR cleanly and resolves HSN catalog entries', () => {
    expect(formatINR(toPaise(38400))).toContain('38,400.00');
    expect(lookupHsn('corrugated boxes')?.code).toBe('4819');
    expect(lookupHsn('9963')?.blockedCredit17_5).toBe(true);
  });
});
