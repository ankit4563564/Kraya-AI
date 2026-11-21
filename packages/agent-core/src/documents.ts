import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import {
  fromPaise,
  getStateName,
  LandedCostBreakdown,
  Paise,
  WorkspaceTaxProfile,
} from '@kraya/finance-engine';

export interface GstPoPdfInput {
  poNumber: string;
  poDate: string; // YYYY-MM-DD
  deliveryDueDate: string;
  paymentTermsDays: number;
  buyer: WorkspaceTaxProfile;
  supplier: {
    name: string;
    gstin?: string | null;
    stateCode?: string | null;
    phone?: string | null;
    email?: string | null;
    udyamTier?: string;
  };
  items: Array<{
    description: string;
    hsnSac?: string | null;
    qty: number;
    unit: string;
    unitRatePaise: Paise;
    gstPct: number;
    taxablePaise: Paise;
  }>;
  freightPaise: Paise;
  taxableTotalPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  grandTotalPaise: Paise;
  notes?: string;
}

function pdfInr(paise: Paise): string {
  // pdf-lib StandardFonts (Helvetica) use WinAnsi encoding where ₹ glyph isn't built-in; use 'Rs.' safely!
  return `Rs. ${fromPaise(paise).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Deterministic Indian GST Purchase Order PDF Generator (pdf-lib).
 * Explicitly prints written payment terms to protect the buyer's 45-day Section 43B(h) window.
 */
export async function generateGstPoPdf(input: GstPoPdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.09, 0.11, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const accent = rgb(0.06, 0.38, 0.35);
  const border = rgb(0.86, 0.88, 0.91);

  let y = height - 48;

  // Header Banner
  page.drawText('PURCHASE ORDER (GST COMPLIANT)', {
    x: 42,
    y,
    size: 16,
    font: fontBold,
    color: accent,
  });
  page.drawText(`PO No: ${input.poNumber}`, {
    x: width - 200,
    y: y + 2,
    size: 11,
    font: fontBold,
    color: ink,
  });
  y -= 16;
  page.drawText(`Date: ${input.poDate}  |  Delivery Due: ${input.deliveryDueDate}`, {
    x: width - 260,
    y,
    size: 9,
    font: fontRegular,
    color: muted,
  });

  // Divider
  y -= 14;
  page.drawLine({ start: { x: 42, y }, end: { x: width - 42, y }, thickness: 1, color: border });
  y -= 20;

  // Buyer & Supplier Two-Column Block
  const leftX = 42;
  const rightX = 310;

  page.drawText('BUYER (BILL TO / SHIP TO)', { x: leftX, y, size: 8, font: fontBold, color: muted });
  page.drawText('SUPPLIER (VENDOR)', { x: rightX, y, size: 8, font: fontBold, color: muted });
  y -= 14;

  page.drawText(input.buyer.legalName, { x: leftX, y, size: 11, font: fontBold, color: ink });
  page.drawText(input.supplier.name, { x: rightX, y, size: 11, font: fontBold, color: ink });
  y -= 14;

  page.drawText(`GSTIN: ${input.buyer.gstin || 'Unregistered / Pending'}`, { x: leftX, y, size: 9, font: fontRegular, color: ink });
  page.drawText(`GSTIN: ${input.supplier.gstin || 'Pending Verification'}`, { x: rightX, y, size: 9, font: fontRegular, color: ink });
  y -= 13;

  page.drawText(`Place of Supply: ${getStateName(input.buyer.stateCode)} (${input.buyer.stateCode})`, {
    x: leftX,
    y,
    size: 9,
    font: fontRegular,
    color: muted,
  });
  page.drawText(
    `State: ${getStateName(input.supplier.stateCode || input.buyer.stateCode)} (${input.supplier.stateCode || input.buyer.stateCode})`,
    { x: rightX, y, size: 9, font: fontRegular, color: muted }
  );
  y -= 13;

  if (input.supplier.phone || input.supplier.email) {
    page.drawText(
      `Contact: ${[input.supplier.phone, input.supplier.email].filter(Boolean).join(' | ')}`,
      { x: rightX, y, size: 8.5, font: fontRegular, color: muted }
    );
  }
  y -= 22;

  // Line Items Table Header
  page.drawRectangle({
    x: 42,
    y: y - 4,
    width: width - 84,
    height: 20,
    color: rgb(0.95, 0.96, 0.97),
  });
  const cols = { desc: 48, hsn: 245, qty: 300, rate: 365, gst: 435, amt: 478 };
  page.drawText('Item Description', { x: cols.desc, y: y + 2, size: 8.5, font: fontBold, color: ink });
  page.drawText('HSN/SAC', { x: cols.hsn, y: y + 2, size: 8.5, font: fontBold, color: ink });
  page.drawText('Qty', { x: cols.qty, y: y + 2, size: 8.5, font: fontBold, color: ink });
  page.drawText('Rate', { x: cols.rate, y: y + 2, size: 8.5, font: fontBold, color: ink });
  page.drawText('GST', { x: cols.gst, y: y + 2, size: 8.5, font: fontBold, color: ink });
  page.drawText('Taxable', { x: cols.amt, y: y + 2, size: 8.5, font: fontBold, color: ink });
  y -= 22;

  for (const item of input.items) {
    page.drawText(item.description.slice(0, 36), { x: cols.desc, y, size: 9, font: fontRegular, color: ink });
    page.drawText(item.hsnSac || '-', { x: cols.hsn, y, size: 9, font: fontRegular, color: muted });
    page.drawText(`${item.qty} ${item.unit}`, { x: cols.qty, y, size: 9, font: fontRegular, color: ink });
    page.drawText(pdfInr(item.unitRatePaise), { x: cols.rate, y, size: 9, font: fontRegular, color: ink });
    page.drawText(`${item.gstPct}%`, { x: cols.gst, y, size: 9, font: fontRegular, color: ink });
    page.drawText(pdfInr(item.taxablePaise), { x: cols.amt, y, size: 9, font: fontBold, color: ink });
    y -= 18;
  }

  if (input.freightPaise > 0) {
    page.drawText('Freight / Delivery Charges', { x: cols.desc, y, size: 9, font: fontRegular, color: muted });
    page.drawText('9965', { x: cols.hsn, y, size: 9, font: fontRegular, color: muted });
    page.drawText('1', { x: cols.qty, y, size: 9, font: fontRegular, color: muted });
    page.drawText('-', { x: cols.rate, y, size: 9, font: fontRegular, color: muted });
    page.drawText('-', { x: cols.gst, y, size: 9, font: fontRegular, color: muted });
    page.drawText(pdfInr(input.freightPaise), { x: cols.amt, y, size: 9, font: fontRegular, color: ink });
    y -= 18;
  }

  y -= 6;
  page.drawLine({ start: { x: 42, y }, end: { x: width - 42, y }, thickness: 1, color: border });
  y -= 18;

  // Totals Summary Block (Right aligned)
  const labelX = 360;
  const valX = 472;
  const drawTotalRow = (label: string, val: string, bold = false) => {
    page.drawText(label, { x: labelX, y, size: bold ? 10 : 9, font: bold ? fontBold : fontRegular, color: bold ? accent : muted });
    page.drawText(val, { x: valX, y, size: bold ? 10 : 9, font: bold ? fontBold : fontRegular, color: bold ? ink : ink });
    y -= 16;
  };

  drawTotalRow('Taxable Value:', pdfInr(input.taxableTotalPaise));
  if (input.cgstPaise > 0 || input.sgstPaise > 0) {
    drawTotalRow('CGST:', pdfInr(input.cgstPaise));
    drawTotalRow('SGST / UTGST:', pdfInr(input.sgstPaise));
  }
  if (input.igstPaise > 0) {
    drawTotalRow('IGST:', pdfInr(input.igstPaise));
  }
  drawTotalRow('GRAND TOTAL:', pdfInr(input.grandTotalPaise), true);

  // Commercial & Statutory Terms Box (Protects Section 43B(h) written 45-day agreement!)
  y -= 20;
  page.drawText('WRITTEN PAYMENT & COMPLIANCE TERMS (SECTION 43B(h) / GST)', {
    x: 42,
    y,
    size: 8.5,
    font: fontBold,
    color: accent,
  });
  y -= 14;
  const terms = [
    `1. Written Payment Terms: Net ${input.paymentTermsDays} Days from date of goods acceptance & valid tax invoice receipt.`,
    `2. Mandatory E-Invoice: If supplier AATO > Rs. 5 Crore, valid 64-char IRP IRN & signed QR code is mandatory on invoice.`,
    `3. GST IMS / GSTR-2B: Mention PO #${input.poNumber} on Tax Invoice. Discrepant bills will be held Pending in GST IMS.`,
    `4. Delivery: Supply must reach Place of Supply by ${input.deliveryDueDate}. Short-shipments require Credit Note.`,
  ];
  if (input.notes) terms.push(`5. Notes: ${input.notes}`);

  for (const t of terms) {
    page.drawText(t.slice(0, 96), { x: 42, y, size: 8.5, font: fontRegular, color: ink });
    y -= 13;
  }

  // Footer Signature
  page.drawText(`For ${input.buyer.legalName}`, { x: 42, y: 80, size: 9, font: fontBold, color: ink });
  page.drawText('Authorized Signatory (Approved via Kraya Procurement Workspace)', {
    x: 42,
    y: 52,
    size: 8,
    font: fontRegular,
    color: muted,
  });

  return pdfDoc.save();
}

/**
 * Deterministic Live-Formula Excel (.xlsx) Workbook Generator (Accio Spec §7.1):
 * Changing the WACC cell on the Assumptions sheet dynamically recalculates & re-evaluates
 * every supplier's credit-adjusted landed cost!
 */
export async function generateLandedCostWorkbook(params: {
  title: string;
  buyer: WorkspaceTaxProfile;
  ranked: LandedCostBreakdown[];
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kraya Procurement Workspace';
  wb.created = new Date();

  // Sheet 1: Assumptions (Live editable inputs)
  const assumptions = wb.addWorksheet('Assumptions');
  assumptions.columns = [
    { header: 'Parameter', key: 'param', width: 34 },
    { header: 'Value', key: 'val', width: 22 },
    { header: 'Notes', key: 'note', width: 52 },
  ];
  assumptions.addRow({ param: 'Buyer Company', val: params.buyer.legalName, note: 'Workspace legal entity' });
  assumptions.addRow({ param: 'Buyer GST Regime', val: params.buyer.gstRegime, note: 'Determines ITC recoverability' });
  assumptions.addRow({
    param: 'Annual Cost of Capital (WACC %)',
    val: params.buyer.waccPct / 100,
    note: 'EDIT THIS CELL — Ranked Comparison formulas recalculate live!',
  });
  assumptions.getCell('B4').numFmt = '0.00%';
  assumptions.getRow(1).font = { bold: true };

  // Sheet 2: Ranked Comparison (100% live Excel formulas!)
  const sheet = wb.addWorksheet('Ranked Comparison');
  sheet.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Supplier', key: 'supplier', width: 28 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Base Unit (INR)', key: 'base', width: 16 },
    { header: 'Freight/Unit (INR)', key: 'freight', width: 16 },
    { header: 'Non-Recov GST/Unit', key: 'nonRecGst', width: 18 },
    { header: 'Net Landed/Unit (Formula)', key: 'netLanded', width: 22 },
    { header: 'Invoice Outflow/Unit', key: 'outflow', width: 18 },
    { header: 'Eff. Credit Days (43B-h)', key: 'creditDays', width: 20 },
    { header: 'Credit Benefit/Unit (Formula)', key: 'creditBenefit', width: 24 },
    { header: 'Real Effective Cost/Unit (Formula)', key: 'effective', width: 26 },
    { header: 'Total Real Cost (Formula)', key: 'totalReal', width: 22 },
    { header: 'Normalization & Compliance Notes', key: 'notes', width: 48 },
  ];
  sheet.getRow(1).font = { bold: true };

  params.ranked.forEach((row, idx) => {
    const r = idx + 2;
    const flagSummary =
      row.flags.length > 0
        ? `${row.normalizationNote} | Flags: ${row.flags.map((f) => f.title).join('; ')}`
        : row.normalizationNote;

    sheet.addRow({
      rank: idx + 1,
      supplier: row.supplierName,
      qty: row.quantity,
      unit: row.canonicalUnit,
      base: fromPaise(row.baseUnitPaise),
      freight: fromPaise(row.freightUnitPaise),
      nonRecGst: fromPaise(row.nonRecoverableGstUnitPaise),
      netLanded: { formula: `=E${r}+F${r}+G${r}` },
      outflow: fromPaise(row.invoiceOutflowUnitPaise),
      creditDays: row.effectiveCreditDaysUsed,
      creditBenefit: { formula: `=I${r}*Assumptions!$B$4*(J${r}/365)` },
      effective: { formula: `=H${r}-K${r}` },
      totalReal: { formula: `=L${r}*C${r}` },
      notes: flagSummary,
    });

    ['E', 'F', 'G', 'H', 'I', 'K', 'L', 'M'].forEach((col) => {
      sheet.getCell(`${col}${r}`).numFmt = '₹#,##0.00';
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface TallyVoucherExportInput {
  buyerCompany: string;
  vouchers: Array<{
    voucherNumber: string;
    dateIso: string; // YYYY-MM-DD -> Tally YYYYMMDD
    supplierName: string;
    supplierGstin?: string | null;
    narration: string;
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    grandTotalPaise: Paise;
  }>;
}

/**
 * Generates genuine Tally Prime importable Purchase Voucher XML.
 * Accountants import via: Gateway of Tally -> Import -> Vouchers.
 */
export function generateTallyPurchaseXml(input: TallyVoucherExportInput): string {
  const voucherXml = input.vouchers
    .map((v) => {
      const tallyDate = v.dateIso.replace(/-/g, '').slice(0, 8);
      const grand = fromPaise(v.grandTotalPaise).toFixed(2);
      const taxable = fromPaise(v.taxablePaise).toFixed(2);
      const cgst = fromPaise(v.cgstPaise).toFixed(2);
      const sgst = fromPaise(v.sgstPaise).toFixed(2);
      const igst = fromPaise(v.igstPaise).toFixed(2);

      const taxEntries: string[] = [];
      if (v.cgstPaise > 0) {
        taxEntries.push(`
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${cgst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`);
      }
      if (v.sgstPaise > 0) {
        taxEntries.push(`
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${sgst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`);
      }
      if (v.igstPaise > 0) {
        taxEntries.push(`
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Input IGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${igst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`);
      }

      return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>${tallyDate}</DATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(v.voucherNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(v.supplierName)}</PARTYLEDGERNAME>
          ${v.supplierGstin ? `<PARTYGSTIN>${escapeXml(v.supplierGstin)}</PARTYGSTIN>` : ''}
          <NARRATION>${escapeXml(v.narration)}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(v.supplierName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${grand}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Purchase Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${taxable}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>${taxEntries.join('')}
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(input.buyerCompany)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${voucherXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export interface CaAuditPackInput {
  buyer: WorkspaceTaxProfile;
  invoices: Array<{
    invoiceNumber: string;
    invoiceDate: string;
    supplierName: string;
    supplierGstin?: string | null;
    irn?: string | null;
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    grandTotalPaise: Paise;
    poMatchStatus: string;
    imsSuggestedAction: string;
    totalMoneyLeakPaise: Paise;
    msme43bhDueAt?: string | null;
    rule37CliffAt?: string | null;
    cfoVerdict: string;
  }>;
  leaks: Array<{
    title: string;
    supplierName: string;
    leakType: string;
    statutoryRef?: string | null;
    amountPaise: Paise;
    status: string;
  }>;
}

/**
 * Generates a CA-Ready Monthly GST IMS, MSME Section 43B(h) & Money Leak Excel Pack (.xlsx).
 */
export async function generateMonthlyCaAuditPack(input: CaAuditPackInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kraya Procurement CFO';
  wb.created = new Date();

  // Sheet 1: GST IMS & GSTR-2B Action Register
  const imsSheet = wb.addWorksheet('GST IMS Register');
  imsSheet.columns = [
    { header: 'Invoice No', key: 'invNo', width: 18 },
    { header: 'Date', key: 'date', width: 13 },
    { header: 'Supplier', key: 'sup', width: 26 },
    { header: 'Supplier GSTIN', key: 'gstin', width: 18 },
    { header: 'IRN Present?', key: 'irn', width: 13 },
    { header: 'Taxable (INR)', key: 'taxable', width: 15 },
    { header: 'CGST', key: 'cgst', width: 12 },
    { header: 'SGST', key: 'sgst', width: 12 },
    { header: 'IGST', key: 'igst', width: 12 },
    { header: 'Grand Total', key: 'total', width: 15 },
    { header: 'PO Match', key: 'poMatch', width: 13 },
    { header: 'IMS Action', key: 'ims', width: 15 },
    { header: 'Leak Flagged (INR)', key: 'leak', width: 17 },
    { header: 'MSME 43B(h) Due', key: 'due43', width: 16 },
    { header: 'Rule 37 (180d Cliff)', key: 'cliff', width: 18 },
    { header: 'CFO Verdict', key: 'verdict', width: 46 },
  ];
  imsSheet.getRow(1).font = { bold: true };

  for (const inv of input.invoices) {
    imsSheet.addRow({
      invNo: inv.invoiceNumber,
      date: inv.invoiceDate,
      sup: inv.supplierName,
      gstin: inv.supplierGstin || 'Missing',
      irn: inv.irn ? 'YES' : 'NO',
      taxable: fromPaise(inv.taxablePaise),
      cgst: fromPaise(inv.cgstPaise),
      sgst: fromPaise(inv.sgstPaise),
      igst: fromPaise(inv.igstPaise),
      total: fromPaise(inv.grandTotalPaise),
      poMatch: inv.poMatchStatus.toUpperCase(),
      ims: inv.imsSuggestedAction,
      leak: fromPaise(inv.totalMoneyLeakPaise),
      due43: inv.msme43bhDueAt || 'N/A',
      cliff: inv.rule37CliffAt || '',
      verdict: inv.cfoVerdict,
    });
  }

  // Sheet 2: Money Leaks & Recovery Ledger
  const leakSheet = wb.addWorksheet('Money Leaks Audit');
  leakSheet.columns = [
    { header: 'Supplier', key: 'sup', width: 24 },
    { header: 'Leak Type', key: 'type', width: 22 },
    { header: 'Finding', key: 'title', width: 38 },
    { header: 'Statutory / Control Ref', key: 'ref', width: 28 },
    { header: 'Amount (INR)', key: 'amt', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  leakSheet.getRow(1).font = { bold: true };
  for (const l of input.leaks) {
    leakSheet.addRow({
      sup: l.supplierName,
      type: l.leakType,
      title: l.title,
      ref: l.statutoryRef || '',
      amt: fromPaise(l.amountPaise),
      status: l.status.toUpperCase(),
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
