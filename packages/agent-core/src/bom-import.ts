import { toPaise, Paise } from '@kraya/finance-engine';

export interface BomRfqRow {
  rowNumber: number;
  title: string;
  itemDescription: string;
  qty: number;
  unit: string;
  category: string;
  hsnCode: string | null;
  targetRatePaise: Paise | null;
  targetCreditDays: number;
  requiredByDate: string | null;
}

export interface BomImportParseResult {
  validRows: BomRfqRow[];
  skippedRows: Array<{ rowNumber: number; reason: string }>;
}

function splitRow(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

/**
 * Deterministic parser for factory Bill of Materials (BOM) / Purchase Indent CSV or Excel-pasted TSV.
 * Eliminates manual RFQ data entry by converting tabular sheets into structured RFQ records.
 * Strictly follows Accio invariant: Missing Input != Invented Input (missing rates/HSN stay null).
 */
export function parseBomIndentTable(rawText: string): BomImportParseResult {
  const lines = (rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      validRows: [],
      skippedRows: [{ rowNumber: 1, reason: 'Provide a header row plus at least 1 BOM item row.' }],
    };
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitRow(lines[0], delimiter).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const findCol = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));

  const cItem = findCol(['item', 'itemdescription', 'description', 'material', 'sku', 'partname', 'name', 'product']);
  const cQty = findCol(['qty', 'quantity', 'orderqty', 'reqqty', 'count']);
  const cUnit = findCol(['unit', 'uom', 'units']);
  const cCat = findCol(['category', 'dept', 'department', 'group']);
  const cHsn = findCol(['hsn', 'hsncode', 'sac', 'hsnsac']);
  const cRate = findCol(['targetrate', 'rate', 'unitrate', 'budgetrate', 'price', 'maxrate']);
  const cCredit = findCol(['creditdays', 'credit', 'paymentterms', 'terms']);
  const cDue = findCol(['requireddate', 'duedate', 'deliverydate', 'neededby']);

  if (cItem < 0 || cQty < 0) {
    return {
      validRows: [],
      skippedRows: [
        {
          rowNumber: 1,
          reason: 'Header must include at least an Item/Description column and a Qty/Quantity column.',
        },
      ],
    };
  }

  const validRows: BomRfqRow[] = [];
  const skippedRows: Array<{ rowNumber: number; reason: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i], delimiter);
    const itemDesc = (cols[cItem] || '').trim();
    const rawQty = Number((cols[cQty] || '').replace(/[^0-9.]/g, ''));

    if (!itemDesc) {
      skippedRows.push({ rowNumber: i + 1, reason: 'Missing item description' });
      continue;
    }
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      skippedRows.push({ rowNumber: i + 1, reason: `Invalid quantity "${cols[cQty] || ''}"` });
      continue;
    }

    const unit = cUnit >= 0 && cols[cUnit] ? cols[cUnit].trim() : 'pcs';
    const category = cCat >= 0 && cols[cCat] ? cols[cCat].trim() : 'General';
    const hsnRaw = cHsn >= 0 && cols[cHsn] ? cols[cHsn].replace(/[^0-9]/g, '') : '';
    const hsnCode = hsnRaw.length >= 4 ? hsnRaw.slice(0, 8) : null;

    const rateNum = cRate >= 0 && cols[cRate] ? Number(cols[cRate].replace(/[^0-9.]/g, '')) : NaN;
    const targetRatePaise = Number.isFinite(rateNum) && rateNum > 0 ? toPaise(rateNum) : null;

    const creditNum = cCredit >= 0 && cols[cCredit] ? Number(cols[cCredit].replace(/[^0-9]/g, '')) : NaN;
    const targetCreditDays = Number.isFinite(creditNum) && creditNum >= 0 ? Math.min(180, Math.round(creditNum)) : 30;

    const dueRaw = cDue >= 0 && cols[cDue] ? cols[cDue].trim() : '';
    const requiredByDate = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;

    validRows.push({
      rowNumber: i + 1,
      title: `${itemDesc.slice(0, 60)} (${rawQty} ${unit})`,
      itemDescription: itemDesc,
      qty: rawQty,
      unit,
      category,
      hsnCode,
      targetRatePaise,
      targetCreditDays,
      requiredByDate,
    });
  }

  return { validRows, skippedRows };
}
