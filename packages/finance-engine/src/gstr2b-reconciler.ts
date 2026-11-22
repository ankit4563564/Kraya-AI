import { Paise, toPaise, fromPaise, ImsSuggestedAction, formatINR } from './types.js';

export interface Gstr2bEntry {
  supplierGstin: string;
  supplierName?: string;
  invoiceNumber: string;
  invoiceDate?: string;
  taxablePaise: Paise;
  igstPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  totalTaxPaise: Paise;
  grandTotalPaise: Paise;
  itcAvailable?: 'Y' | 'N';
}

export interface BookInvoiceRecord {
  id: string;
  supplierId?: string | null;
  supplierName: string;
  supplierPhone?: string | null;
  supplierGstin?: string | null;
  invoiceNumber: string;
  invoiceDate?: string | null;
  taxablePaise: Paise;
  gstPaise: Paise;
  grandTotalPaise: Paise;
  auditStatus: string; // 'clean' | 'mismatch' | 'partial' | 'pending'
  grnAccepted?: boolean;
}

export type ReconciliationStatus =
  | 'MATCHED'
  | 'VALUE_MISMATCH'
  | 'MISSING_IN_2B'
  | 'MISSING_IN_BOOKS';

export interface ReconciliationItem {
  key: string;
  status: ReconciliationStatus;
  imsAction: ImsSuggestedAction;
  supplierGstin: string;
  supplierName: string;
  supplierPhone?: string | null;
  invoiceNumber: string;
  bookInvoiceId: string | null;
  bookTaxablePaise: Paise;
  bookTaxPaise: Paise;
  portalTaxablePaise: Paise;
  portalTaxPaise: Paise;
  taxDiffPaise: Paise; // portal - book
  itcEligiblePaise: Paise;
  itcAtRiskPaise: Paise;
  reason: string;
  whatsappChaseUrl?: string;
  whatsappChaseMessage?: string;
}

export interface Gstr2bReconciliationSummary {
  totalBookInvoices: number;
  totalPortalEntries: number;
  matchedCount: number;
  mismatchCount: number;
  missingIn2bCount: number;
  missingInBooksCount: number;
  totalBookItcPaise: Paise;
  totalPortalItcPaise: Paise;
  safeClaimableItcPaise: Paise;
  itcAtRiskPaise: Paise;
  items: ReconciliationItem[];
}

/**
 * Normalize Indian invoice numbers for reliable cross-matching between Tally/Kraya and GSTN GSTR-2B.
 * Example: "INV/26-27/0042" and "INV-26-27-42" normalize cleanly.
 */
export function normalizeInvoiceNumber(raw: string): string {
  const cleaned = (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned;
}

function normalizeInvoiceLoose(raw: string): string {
  // Split on separators and strip leading zeros from each numeric segment
  // Example: "INV/26-27/001" -> "INV26271", "INV-26-27-1" -> "INV26271"
  return (raw || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((seg) => seg.replace(/^0+(?=[0-9])/, ''))
    .join('');
}

/**
 * Parse official GSTN GSTR-2B JSON (data.docdata.b2b), simplified JSON arrays, or CSV text.
 */
export function parseGstr2bPayload(input: string | Record<string, unknown> | unknown[]): Gstr2bEntry[] {
  if (!input) return [];

  let parsedObj: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      parsedObj = JSON.parse(trimmed);
    } else {
      return parseGstr2bCsv(trimmed);
    }
  }

  // Case 1: Official GSTN GSTR-2B JSON schema: { data: { docdata: { b2b: [...] } } } or { docdata: { b2b: [...] } }
  const obj = parsedObj as Record<string, any>;
  const b2bList = obj?.data?.docdata?.b2b || obj?.docdata?.b2b || obj?.b2b;
  if (Array.isArray(b2bList)) {
    const entries: Gstr2bEntry[] = [];
    for (const supplierBlock of b2bList) {
      const ctin = String(supplierBlock?.ctin || '').trim().toUpperCase();
      const trdnm = supplierBlock?.trdnm ? String(supplierBlock.trdnm).trim() : undefined;
      const invoices = Array.isArray(supplierBlock?.inv) ? supplierBlock.inv : [];
      for (const inv of invoices) {
        let taxable = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        if (Array.isArray(inv?.items) || Array.isArray(inv?.itms)) {
          const itemArr = inv.items || inv.itms;
          for (const it of itemArr) {
            const det = it?.itm_det || it;
            taxable += toPaise(Number(det?.txval || 0));
            igst += toPaise(Number(det?.igst ?? det?.iamt ?? 0));
            cgst += toPaise(Number(det?.cgst ?? det?.camt ?? 0));
            sgst += toPaise(Number(det?.sgst ?? det?.samt ?? 0));
          }
        } else {
          taxable = toPaise(Number(inv?.txval || 0));
          igst = toPaise(Number(inv?.igst ?? inv?.iamt ?? 0));
          cgst = toPaise(Number(inv?.cgst ?? inv?.camt ?? 0));
          sgst = toPaise(Number(inv?.sgst ?? inv?.samt ?? 0));
        }
        const totalTax = igst + cgst + sgst;
        const grandTotal = inv?.val != null ? toPaise(Number(inv.val)) : taxable + totalTax;
        entries.push({
          supplierGstin: ctin,
          supplierName: trdnm,
          invoiceNumber: String(inv?.inum || '').trim(),
          invoiceDate: inv?.dt || inv?.idt ? String(inv.dt || inv.idt) : undefined,
          taxablePaise: taxable,
          igstPaise: igst,
          cgstPaise: cgst,
          sgstPaise: sgst,
          totalTaxPaise: totalTax,
          grandTotalPaise: grandTotal,
          itcAvailable: inv?.itcavl === 'N' ? 'N' : 'Y',
        });
      }
    }
    return entries;
  }

  // Case 2: Flat array of simplified GSTR-2B rows
  if (Array.isArray(parsedObj)) {
    return parsedObj
      .filter((row): row is Record<string, any> => Boolean(row && typeof row === 'object'))
      .map((row) => {
        const taxablePaise =
          row.taxablePaise != null ? Math.round(Number(row.taxablePaise)) : toPaise(Number(row.taxableValue ?? row.taxable ?? 0));
        const igstPaise =
          row.igstPaise != null ? Math.round(Number(row.igstPaise)) : toPaise(Number(row.igst ?? 0));
        const cgstPaise =
          row.cgstPaise != null ? Math.round(Number(row.cgstPaise)) : toPaise(Number(row.cgst ?? 0));
        const sgstPaise =
          row.sgstPaise != null ? Math.round(Number(row.sgstPaise)) : toPaise(Number(row.sgst ?? 0));
        const totalTaxPaise =
          row.totalTaxPaise != null
            ? Math.round(Number(row.totalTaxPaise))
            : row.gst != null
              ? toPaise(Number(row.gst))
              : igstPaise + cgstPaise + sgstPaise;
        const grandTotalPaise =
          row.grandTotalPaise != null
            ? Math.round(Number(row.grandTotalPaise))
            : row.totalValue != null
              ? toPaise(Number(row.totalValue))
              : taxablePaise + totalTaxPaise;
        return {
          supplierGstin: String(row.supplierGstin || row.gstin || row.ctin || '').trim().toUpperCase(),
          supplierName: row.supplierName || row.trdnm ? String(row.supplierName || row.trdnm).trim() : undefined,
          invoiceNumber: String(row.invoiceNumber || row.inum || '').trim(),
          invoiceDate: row.invoiceDate || row.dt ? String(row.invoiceDate || row.dt) : undefined,
          taxablePaise,
          igstPaise,
          cgstPaise,
          sgstPaise,
          totalTaxPaise,
          grandTotalPaise,
          itcAvailable: (row.itcAvailable === 'N' ? 'N' : 'Y') as 'Y' | 'N',
        };
      })
      .filter((e) => e.supplierGstin && e.invoiceNumber);
  }

  return [];
}

function parseGstr2bCsv(csv: string): Gstr2bEntry[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));

  const cGstin = idx(['gstin', 'suppliergstin', 'ctin']);
  const cName = idx(['suppliername', 'supplier', 'trdnm', 'name']);
  const cInv = idx(['invoicenumber', 'invoiceno', 'inum', 'invoice']);
  const cDate = idx(['invoicedate', 'date', 'idt', 'dt']);
  const cTaxable = idx(['taxablevalue', 'taxable', 'txval']);
  const cIgst = idx(['igst', 'iamt']);
  const cCgst = idx(['cgst', 'camt']);
  const cSgst = idx(['sgst', 'samt']);
  const cTotal = idx(['totalvalue', 'grandtotal', 'val', 'total']);

  if (cGstin < 0 || cInv < 0) return [];

  const rows: Gstr2bEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const supplierGstin = (cols[cGstin] || '').toUpperCase();
    const invoiceNumber = cols[cInv] || '';
    if (!supplierGstin || !invoiceNumber) continue;

    const taxablePaise = cTaxable >= 0 ? toPaise(Number(cols[cTaxable] || 0)) : 0;
    const igstPaise = cIgst >= 0 ? toPaise(Number(cols[cIgst] || 0)) : 0;
    const cgstPaise = cCgst >= 0 ? toPaise(Number(cols[cCgst] || 0)) : 0;
    const sgstPaise = cSgst >= 0 ? toPaise(Number(cols[cSgst] || 0)) : 0;
    const totalTaxPaise = igstPaise + cgstPaise + sgstPaise;
    const grandTotalPaise =
      cTotal >= 0 && cols[cTotal] ? toPaise(Number(cols[cTotal])) : taxablePaise + totalTaxPaise;

    rows.push({
      supplierGstin,
      supplierName: cName >= 0 ? cols[cName] : undefined,
      invoiceNumber,
      invoiceDate: cDate >= 0 ? cols[cDate] : undefined,
      taxablePaise,
      igstPaise,
      cgstPaise,
      sgstPaise,
      totalTaxPaise,
      grandTotalPaise,
      itcAvailable: 'Y',
    });
  }
  return rows;
}

function buildGstr1ChaseMessage(supplierName: string, invoiceNumber: string, gstPaise: Paise): string {
  return `Namaste ${supplierName} ji, Invoice #${invoiceNumber} (GST ${formatINR(gstPaise)}) abhi tak hamare GSTR-2B portal mein reflect nahi hua hai. Kripya GSTR-1 turant file/amend kijiye taaki ITC clear ho sake aur payment release mein koi delay na ho. Dhanyawad!`;
}

/**
 * Deterministic GSTR-2B vs Kraya Books Reconciler with GSTN IMS Action Classification.
 */
export function reconcileGstr2b(
  bookInvoices: BookInvoiceRecord[],
  gstr2bEntries: Gstr2bEntry[],
  options?: { tolerancePaise?: number }
): Gstr2bReconciliationSummary {
  const tolerance = options?.tolerancePaise ?? 100; // ₹1.00 standard Indian CA rounding tolerance

  const portalByExact = new Map<string, { entry: Gstr2bEntry; used: boolean }>();
  const portalByLoose = new Map<string, { entry: Gstr2bEntry; used: boolean }>();

  for (const entry of gstr2bEntries) {
    const gstin = entry.supplierGstin.toUpperCase();
    const exactKey = `${gstin}::${normalizeInvoiceNumber(entry.invoiceNumber)}`;
    const looseKey = `${gstin}::${normalizeInvoiceLoose(entry.invoiceNumber)}`;
    const wrapped = { entry, used: false };
    portalByExact.set(exactKey, wrapped);
    if (!portalByLoose.has(looseKey)) {
      portalByLoose.set(looseKey, wrapped);
    }
  }

  const items: ReconciliationItem[] = [];
  let matchedCount = 0;
  let mismatchCount = 0;
  let missingIn2bCount = 0;
  let missingInBooksCount = 0;
  let totalBookItcPaise = 0;
  let totalPortalItcPaise = 0;
  let safeClaimableItcPaise = 0;
  let itcAtRiskPaise = 0;

  for (const e of gstr2bEntries) {
    totalPortalItcPaise += e.totalTaxPaise;
  }

  for (const book of bookInvoices) {
    totalBookItcPaise += book.gstPaise;
    const gstin = (book.supplierGstin || '').trim().toUpperCase();
    const exactKey = `${gstin}::${normalizeInvoiceNumber(book.invoiceNumber)}`;
    const looseKey = `${gstin}::${normalizeInvoiceLoose(book.invoiceNumber)}`;

    const match =
      (portalByExact.get(exactKey) && !portalByExact.get(exactKey)!.used
        ? portalByExact.get(exactKey)
        : undefined) ||
      (portalByLoose.get(looseKey) && !portalByLoose.get(looseKey)!.used
        ? portalByLoose.get(looseKey)
        : undefined);

    if (!match) {
      missingIn2bCount++;
      itcAtRiskPaise += book.gstPaise;
      const chaseMsg = buildGstr1ChaseMessage(book.supplierName, book.invoiceNumber, book.gstPaise);
      const digits = (book.supplierPhone || '').replace(/\D/g, '');
      const waPhone = digits.length === 10 ? `91${digits}` : digits;
      items.push({
        key: `book::${book.id}`,
        status: 'MISSING_IN_2B',
        imsAction: 'NOT_APPLICABLE',
        supplierGstin: gstin || 'MISSING_GSTIN',
        supplierName: book.supplierName,
        supplierPhone: book.supplierPhone,
        invoiceNumber: book.invoiceNumber,
        bookInvoiceId: book.id,
        bookTaxablePaise: book.taxablePaise,
        bookTaxPaise: book.gstPaise,
        portalTaxablePaise: 0,
        portalTaxPaise: 0,
        taxDiffPaise: -book.gstPaise,
        itcEligiblePaise: 0,
        itcAtRiskPaise: book.gstPaise,
        reason: `Invoice booked in Kraya with ${formatINR(book.gstPaise)} GST, but supplier has NOT filed it in GSTR-1/2B. ITC blocked under Sec 16(2)(aa).`,
        whatsappChaseMessage: chaseMsg,
        whatsappChaseUrl: waPhone
          ? `https://wa.me/${waPhone}?text=${encodeURIComponent(chaseMsg)}`
          : `https://wa.me/?text=${encodeURIComponent(chaseMsg)}`,
      });
      continue;
    }

    match.used = true;
    const portal = match.entry;
    const taxDiffPaise = portal.totalTaxPaise - book.gstPaise;
    const taxableDiffPaise = portal.taxablePaise - book.taxablePaise;

    const withinTolerance =
      Math.abs(taxDiffPaise) <= tolerance && Math.abs(taxableDiffPaise) <= tolerance;

    if (book.auditStatus === 'mismatch') {
      mismatchCount++;
      itcAtRiskPaise += Math.max(book.gstPaise, portal.totalTaxPaise);
      items.push({
        key: `match::${book.id}`,
        status: 'VALUE_MISMATCH',
        imsAction: 'REJECT',
        supplierGstin: portal.supplierGstin,
        supplierName: book.supplierName,
        supplierPhone: book.supplierPhone,
        invoiceNumber: book.invoiceNumber,
        bookInvoiceId: book.id,
        bookTaxablePaise: book.taxablePaise,
        bookTaxPaise: book.gstPaise,
        portalTaxablePaise: portal.taxablePaise,
        portalTaxPaise: portal.totalTaxPaise,
        taxDiffPaise,
        itcEligiblePaise: 0,
        itcAtRiskPaise: Math.max(book.gstPaise, portal.totalTaxPaise),
        reason: 'Flagged by Kraya 3-Way PO/GRN Audit as MISMATCH. Reject in GSTN IMS until supplier issues a Credit Note.',
      });
    } else if (withinTolerance) {
      matchedCount++;
      if (book.grnAccepted === false) {
        itcAtRiskPaise += portal.totalTaxPaise;
        items.push({
          key: `match::${book.id}`,
          status: 'MATCHED',
          imsAction: 'KEEP_PENDING',
          supplierGstin: portal.supplierGstin,
          supplierName: book.supplierName,
          supplierPhone: book.supplierPhone,
          invoiceNumber: book.invoiceNumber,
          bookInvoiceId: book.id,
          bookTaxablePaise: book.taxablePaise,
          bookTaxPaise: book.gstPaise,
          portalTaxablePaise: portal.taxablePaise,
          portalTaxPaise: portal.totalTaxPaise,
          taxDiffPaise,
          itcEligiblePaise: 0,
          itcAtRiskPaise: portal.totalTaxPaise,
          reason: 'Values match GSTR-2B, but Goods Receipt (GRN) is pending. Keep PENDING in IMS per Sec 16(2)(b) until delivery accepted.',
        });
      } else {
        safeClaimableItcPaise += portal.totalTaxPaise;
        items.push({
          key: `match::${book.id}`,
          status: 'MATCHED',
          imsAction: 'ACCEPT',
          supplierGstin: portal.supplierGstin,
          supplierName: book.supplierName,
          supplierPhone: book.supplierPhone,
          invoiceNumber: book.invoiceNumber,
          bookInvoiceId: book.id,
          bookTaxablePaise: book.taxablePaise,
          bookTaxPaise: book.gstPaise,
          portalTaxablePaise: portal.taxablePaise,
          portalTaxPaise: portal.totalTaxPaise,
          taxDiffPaise,
          itcEligiblePaise: portal.totalTaxPaise,
          itcAtRiskPaise: 0,
          reason: 'Exact match between Kraya Books and GSTN GSTR-2B. Safe to ACCEPT in IMS and claim 100% ITC.',
        });
      }
    } else {
      mismatchCount++;
      const risk = Math.abs(taxDiffPaise) > 0 ? Math.abs(taxDiffPaise) : Math.abs(taxableDiffPaise);
      itcAtRiskPaise += risk;
      items.push({
        key: `match::${book.id}`,
        status: 'VALUE_MISMATCH',
        imsAction: taxDiffPaise > 0 ? 'REJECT' : 'KEEP_PENDING',
        supplierGstin: portal.supplierGstin,
        supplierName: book.supplierName,
        supplierPhone: book.supplierPhone,
        invoiceNumber: book.invoiceNumber,
        bookInvoiceId: book.id,
        bookTaxablePaise: book.taxablePaise,
        bookTaxPaise: book.gstPaise,
        portalTaxablePaise: portal.taxablePaise,
        portalTaxPaise: portal.totalTaxPaise,
        taxDiffPaise,
        itcEligiblePaise: Math.min(book.gstPaise, portal.totalTaxPaise),
        itcAtRiskPaise: risk,
        reason: `GST/Taxable mismatch between Books (${formatINR(book.gstPaise)} GST) and GSTR-2B (${formatINR(portal.totalTaxPaise)} GST). Variance: ${formatINR(taxDiffPaise)}.`,
      });
    }
  }

  // Remaining portal entries not found in Kraya books
  for (const wrapped of portalByExact.values()) {
    if (wrapped.used) continue;
    const portal = wrapped.entry;
    missingInBooksCount++;
    itcAtRiskPaise += portal.totalTaxPaise;
    items.push({
      key: `portal::${portal.supplierGstin}::${portal.invoiceNumber}`,
      status: 'MISSING_IN_BOOKS',
      imsAction: 'KEEP_PENDING',
      supplierGstin: portal.supplierGstin,
      supplierName: portal.supplierName || portal.supplierGstin,
      invoiceNumber: portal.invoiceNumber,
      bookInvoiceId: null,
      bookTaxablePaise: 0,
      bookTaxPaise: 0,
      portalTaxablePaise: portal.taxablePaise,
      portalTaxPaise: portal.totalTaxPaise,
      taxDiffPaise: portal.totalTaxPaise,
      itcEligiblePaise: 0,
      itcAtRiskPaise: portal.totalTaxPaise,
      reason: 'Present in GSTR-2B portal, but not recorded in Kraya Purchase Ledger. Keep PENDING in IMS until verified with factory store.',
    });
  }

  return {
    totalBookInvoices: bookInvoices.length,
    totalPortalEntries: gstr2bEntries.length,
    matchedCount,
    mismatchCount,
    missingIn2bCount,
    missingInBooksCount,
    totalBookItcPaise,
    totalPortalItcPaise,
    safeClaimableItcPaise,
    itcAtRiskPaise,
    items,
  };
}

/**
 * Generate a CA-ready CSV of IMS actions (ACCEPT / KEEP_PENDING / REJECT).
 */
export function exportImsActionCsv(summary: Gstr2bReconciliationSummary): string {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [
    'Status',
    'IMS Action',
    'Supplier GSTIN',
    'Supplier Name',
    'Invoice Number',
    'Book Taxable (INR)',
    'Book GST (INR)',
    'GSTR-2B Taxable (INR)',
    'GSTR-2B GST (INR)',
    'Tax Variance (INR)',
    'Safe ITC (INR)',
    'ITC At Risk (INR)',
    'Audit Note',
  ].join(',');

  const rows = summary.items.map((item) =>
    [
      esc(item.status),
      esc(item.imsAction),
      esc(item.supplierGstin),
      esc(item.supplierName),
      esc(item.invoiceNumber),
      fromPaise(item.bookTaxablePaise).toFixed(2),
      fromPaise(item.bookTaxPaise).toFixed(2),
      fromPaise(item.portalTaxablePaise).toFixed(2),
      fromPaise(item.portalTaxPaise).toFixed(2),
      fromPaise(item.taxDiffPaise).toFixed(2),
      fromPaise(item.itcEligiblePaise).toFixed(2),
      fromPaise(item.itcAtRiskPaise).toFixed(2),
      esc(item.reason),
    ].join(',')
  );

  return [header, ...rows].join('\n');
}
