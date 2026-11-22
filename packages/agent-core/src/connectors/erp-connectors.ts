import { fromPaise, Paise } from '@kraya/finance-engine';
import { fetchWithTimeoutAndRetry } from '../http-utils.js';

export interface ErpInvoicePushInput {
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate?: string | null;
  supplierName: string;
  supplierGstin?: string | null;
  buyerCompanyName: string;
  items: Array<{
    description: string;
    hsnSac?: string | null;
    qty: number;
    unit: string;
    unitRatePaise: Paise;
    taxablePaise: Paise;
  }>;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  grandTotalPaise: Paise;
  notes?: string;
}

export interface ErpPushResult {
  provider: 'zoho_books' | 'tally_prime';
  mode: 'live_pushed' | 'dry_run_preview';
  ok: boolean;
  externalId: string | null;
  message: string;
  payloadPreview: unknown;
}

/**
 * Direct Zoho Books India REST API Connector (`https://www.zohoapis.in/books/v3/bills`).
 * When credentials (`accessToken` + `organizationId`) are supplied, pushes audited bills directly;
 * otherwise returns an exact ready-to-send dry-run payload preview.
 */
export async function pushBillToZohoBooks(
  invoice: ErpInvoicePushInput,
  config?: {
    accessToken?: string;
    organizationId?: string;
    apiDomain?: string; // Default: https://www.zohoapis.in
    vendorId?: string;
  }
): Promise<ErpPushResult> {
  const apiDomain = (config?.apiDomain || 'https://www.zohoapis.in').replace(/\/+$/, '');
  const zohoPayload = {
    ...(config?.vendorId ? { vendor_id: config.vendorId } : { vendor_name: invoice.supplierName }),
    bill_number: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    due_date: invoice.dueDate || invoice.invoiceDate,
    gst_no: invoice.supplierGstin || undefined,
    notes:
      invoice.notes ||
      `Audited & approved via Kraya CFO Engine. CGST: ₹${fromPaise(invoice.cgstPaise)}, SGST: ₹${fromPaise(invoice.sgstPaise)}, IGST: ₹${fromPaise(invoice.igstPaise)}.`,
    line_items: invoice.items.map((it) => ({
      name: it.description,
      hsn_or_sac: it.hsnSac || undefined,
      quantity: it.qty,
      unit: it.unit,
      rate: fromPaise(it.unitRatePaise),
    })),
  };

  if (!config?.accessToken?.trim() || !config?.organizationId?.trim()) {
    return {
      provider: 'zoho_books',
      mode: 'dry_run_preview',
      ok: true,
      externalId: null,
      message:
        'Dry-run preview generated. Set ZOHO_BOOKS_ACCESS_TOKEN and ZOHO_BOOKS_ORG_ID (or connect via n8n Zoho Books node / Zoho Books Marketplace plugin) for live 1-click API push.',
      payloadPreview: zohoPayload,
    };
  }

  try {
    const endpoint = `${apiDomain}/books/v3/bills?organization_id=${encodeURIComponent(config.organizationId.trim())}`;
    const res = await fetchWithTimeoutAndRetry(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Zoho-oauthtoken ${config.accessToken.trim()}`,
        },
        body: JSON.stringify(zohoPayload),
      },
      { timeoutMs: 12_000, maxRetries: 1 }
    );
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      bill?: { bill_id?: string };
    };
    if (res.ok && data.bill?.bill_id) {
      return {
        provider: 'zoho_books',
        mode: 'live_pushed',
        ok: true,
        externalId: data.bill.bill_id,
        message: `Bill #${invoice.invoiceNumber} pushed to Zoho Books India (Bill ID: ${data.bill.bill_id}).`,
        payloadPreview: zohoPayload,
      };
    }
    return {
      provider: 'zoho_books',
      mode: 'live_pushed',
      ok: false,
      externalId: null,
      message: `Zoho Books API rejected bill (${res.status}): ${data.message || 'Check vendor_id / OAuth token scope.'}`,
      payloadPreview: zohoPayload,
    };
  } catch (err) {
    return {
      provider: 'zoho_books',
      mode: 'live_pushed',
      ok: false,
      externalId: null,
      message: `Zoho Books request failed: ${err instanceof Error ? err.message : String(err)}`,
      payloadPreview: zohoPayload,
    };
  }
}

/**
 * Direct Tally Prime HTTP XML Server Push Connector (`http://localhost:9000` or Cloudflare Tunnel URL).
 * Sends deterministic Tally Purchase Voucher XML and parses Tally's `<CREATED>` / `<LINEERROR>` response.
 */
export async function pushVoucherToTallyPrime(
  tallyXml: string,
  invoiceNumber: string,
  config?: { tallyServerUrl?: string; authHeader?: string }
): Promise<ErpPushResult> {
  if (!config?.tallyServerUrl?.trim()) {
    return {
      provider: 'tally_prime',
      mode: 'dry_run_preview',
      ok: true,
      externalId: null,
      message:
        'Dry-run Tally Prime XML ready. Set TALLY_SERVER_URL (e.g. your Cloudflare Tunnel to local Tally Prime port 9000) or use the n8n Tally Sync workflow to push directly.',
      payloadPreview: tallyXml.slice(0, 1200),
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
    };
    if (config.authHeader?.trim()) {
      headers['Authorization'] = config.authHeader.trim();
    }

    const res = await fetchWithTimeoutAndRetry(
      config.tallyServerUrl.trim(),
      { method: 'POST', headers, body: tallyXml },
      { timeoutMs: 10_000, maxRetries: 1 }
    );
    const xmlResp = await res.text();
    const createdMatch = xmlResp.match(/<CREATED>(\d+)<\/CREATED>/i);
    const errorMatch = xmlResp.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i);
    const createdCount = createdMatch ? Number(createdMatch[1]) : 0;

    if (res.ok && createdCount > 0 && !errorMatch) {
      return {
        provider: 'tally_prime',
        mode: 'live_pushed',
        ok: true,
        externalId: `TALLY-${invoiceNumber}`,
        message: `Tally Prime imported ${createdCount} Purchase Voucher(s) for Invoice #${invoiceNumber}.`,
        payloadPreview: xmlResp.slice(0, 400),
      };
    }

    return {
      provider: 'tally_prime',
      mode: 'live_pushed',
      ok: false,
      externalId: null,
      message: errorMatch
        ? `Tally Prime LINEERROR: ${errorMatch[1].trim()}`
        : `Tally Prime responded HTTP ${res.status} (CREATED=${createdCount}). Verify ledger names match Tally.`,
      payloadPreview: xmlResp.slice(0, 400),
    };
  } catch (err) {
    return {
      provider: 'tally_prime',
      mode: 'live_pushed',
      ok: false,
      externalId: null,
      message: `Tally Prime HTTP push failed: ${err instanceof Error ? err.message : String(err)}`,
      payloadPreview: tallyXml.slice(0, 400),
    };
  }
}
