import { validateGstin, GstRegime } from '@kraya/finance-engine';
import { fetchWithTimeoutAndRetry } from './http-utils.js';

export type GstnTaxpayerStatus = 'Active' | 'Cancelled' | 'Suspended' | 'Inactive' | 'Unverified';
export type GstnTaxpayerType = 'Regular' | 'Composition' | 'SEZ' | 'ISD' | 'Casual' | 'Unknown';

export interface LiveGstnConfig {
  provider?: string; // 'appyflow' | 'gstzen' | 'mastergst' | 'custom'
  apiKey?: string;
  apiUrl?: string; // Custom endpoint template supporting {gstin}
  skipNetwork?: boolean;
}

export interface LiveGstnVerificationResult {
  gstin: string;
  checksumValid: boolean;
  liveVerified: boolean;
  provider: 'appyflow' | 'gstzen' | 'mastergst' | 'custom_gstn_api' | 'offline_checksum_only';
  taxpayerStatus: GstnTaxpayerStatus;
  legalName: string | null;
  tradeName: string | null;
  taxpayerType: GstnTaxpayerType;
  inferredGstRegime: GstRegime;
  eInvoiceEnabled: boolean | null;
  registrationDate: string | null;
  cancellationDate: string | null;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  panEntityLabel: string | null;
  tds194cRatePct: number | null;
  filingComplianceNote: string;
  riskLevel: 'safe' | 'warning' | 'critical';
  riskFlags: string[];
  officialPortalUrl: string;
  verifiedAt: string;
  cacheExpiresAt: string;
  rawSummary?: Record<string, unknown>;
}

const CACHE_TTL_DAYS = 30;

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function normalizeStatus(raw?: string | null): GstnTaxpayerStatus {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('active')) return 'Active';
  if (s.includes('cancel')) return 'Cancelled';
  if (s.includes('suspend')) return 'Suspended';
  if (s.includes('inactive') || s.includes('provisional')) return 'Inactive';
  return 'Unverified';
}

function normalizeTaxpayerType(raw?: string | null): { type: GstnTaxpayerType; regime: GstRegime } {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('composition')) return { type: 'Composition', regime: 'composition' };
  if (s.includes('regular')) return { type: 'Regular', regime: 'regular' };
  if (s.includes('sez')) return { type: 'SEZ', regime: 'regular' };
  if (s.includes('isd')) return { type: 'ISD', regime: 'regular' };
  if (s.includes('casual')) return { type: 'Casual', regime: 'regular' };
  return { type: 'Unknown', regime: 'regular' };
}

/**
 * Live GSTN Taxpayer Verification Engine with Offline Mod-36 Pre-Validation & 30-Day Cache Metadata.
 * Supports AppyFlow, GSTZen, MasterGST, or any custom GSTN API endpoint.
 * Never fabricates live portal status when API credentials are absent — honestly reports `offline_checksum_only`
 * and supplies a 1-click official GST portal link.
 */
export async function verifyGstinLive(
  rawGstin: string,
  config: LiveGstnConfig = {}
): Promise<LiveGstnVerificationResult> {
  const local = validateGstin(rawGstin);
  const nowIso = new Date().toISOString();
  const expiresIso = addDaysIso(CACHE_TTL_DAYS);
  const officialPortalUrl = `https://services.gst.gov.in/services/searchtp`;

  if (!local.valid || !local.normalized) {
    return {
      gstin: (rawGstin || '').trim().toUpperCase(),
      checksumValid: false,
      liveVerified: false,
      provider: 'offline_checksum_only',
      taxpayerStatus: 'Unverified',
      legalName: null,
      tradeName: null,
      taxpayerType: 'Unknown',
      inferredGstRegime: 'unregistered',
      eInvoiceEnabled: null,
      registrationDate: null,
      cancellationDate: null,
      stateCode: local.stateCode,
      stateName: local.stateName,
      pan: local.pan,
      panEntityLabel: local.panEntityLabel,
      tds194cRatePct: local.tds194cRatePct,
      filingComplianceNote: `Failed offline Mod-36 checksum: ${local.errors.join('; ')}`,
      riskLevel: 'critical',
      riskFlags: [
        `INVALID GSTIN STRUCTURE/CHECKSUM: ${local.errors.join('; ')}. Do NOT release GST portion of payment until supplier provides a valid 15-character GSTIN.`,
      ],
      officialPortalUrl,
      verifiedAt: nowIso,
      cacheExpiresAt: expiresIso,
    };
  }

  const gstin = local.normalized;
  const providerKey = (config.provider || '').toLowerCase().trim();
  const apiKey = config.apiKey?.trim();
  const customUrl = config.apiUrl?.trim();

  if (!config.skipNetwork && (apiKey || customUrl)) {
    try {
      let endpoint = '';
      const headers: Record<string, string> = { Accept: 'application/json' };
      let resolvedProvider: LiveGstnVerificationResult['provider'] = 'custom_gstn_api';

      if (customUrl) {
        endpoint = customUrl.includes('{gstin}')
          ? customUrl.replace('{gstin}', encodeURIComponent(gstin))
          : `${customUrl.replace(/\/+$/, '')}/${encodeURIComponent(gstin)}`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        resolvedProvider = 'custom_gstn_api';
      } else if (providerKey === 'appyflow') {
        endpoint = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(apiKey!)}`;
        resolvedProvider = 'appyflow';
      } else if (providerKey === 'gstzen') {
        endpoint = `https://my.gstzen.in/~gstzen/a/post-gstin-search/gstin/${encodeURIComponent(gstin)}/`;
        headers['Token'] = apiKey!;
        resolvedProvider = 'gstzen';
      } else if (providerKey === 'mastergst') {
        endpoint = `https://api.mastergst.com/public/search?gstin=${encodeURIComponent(gstin)}`;
        headers['client_secret'] = apiKey!;
        resolvedProvider = 'mastergst';
      } else {
        // Default AppyFlow-style endpoint when only GSTN_API_KEY is supplied
        endpoint = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(apiKey!)}`;
        resolvedProvider = 'appyflow';
      }

      const res = await fetchWithTimeoutAndRetry(
        endpoint,
        { method: 'GET', headers },
        { timeoutMs: 8000, maxRetries: 1 }
      );

      if (res.ok) {
        const raw = (await res.json()) as Record<string, unknown>;
        // Normalize across AppyFlow (`taxpayerInfo`), GSTZen (`company_details`), MasterGST (`data`), and flat custom JSON
        const info = (raw.taxpayerInfo || raw.data || raw.company_details || raw) as Record<
          string,
          unknown
        >;

        const statusRaw = String(info.sts || info.status || info.taxpayerStatus || '');
        const dtyRaw = String(info.dty || info.taxpayerType || info.registrationType || '');
        const legalName = info.lgnm || info.legalName ? String(info.lgnm || info.legalName) : null;
        const tradeName = info.tradeNam || info.tradeName ? String(info.tradeNam || info.tradeName) : null;
        const regDate = info.rgdt || info.registrationDate ? String(info.rgdt || info.registrationDate) : null;
        const cancelDate = info.cxdt || info.cancellationDate ? String(info.cxdt || info.cancellationDate) : null;
        const einvRaw = info.einvoiceStatus ?? info.eInvoiceEnabled ?? info.einv;
        const eInvoiceEnabled =
          typeof einvRaw === 'boolean'
            ? einvRaw
            : typeof einvRaw === 'string'
              ? /^(yes|true|enabled|y|active)$/i.test(einvRaw.trim())
              : null;

        const taxpayerStatus = normalizeStatus(statusRaw);
        const { type: taxpayerType, regime: inferredGstRegime } = normalizeTaxpayerType(dtyRaw);

        const riskFlags: string[] = [];
        let riskLevel: LiveGstnVerificationResult['riskLevel'] = 'safe';

        if (taxpayerStatus === 'Cancelled' || taxpayerStatus === 'Suspended') {
          riskLevel = 'critical';
          riskFlags.push(
            `CRITICAL GSTN ALERT: GSTIN ${gstin} is ${taxpayerStatus.toUpperCase()}${cancelDate ? ` (effective ${cancelDate})` : ''}. 100% of ITC on invoices issued after cancellation will be disallowed under Section 16 CGST Act.`
          );
        } else if (taxpayerStatus === 'Inactive' || taxpayerStatus === 'Unverified') {
          riskLevel = 'warning';
          riskFlags.push(
            `GSTIN status returned "${taxpayerStatus}". Verify active filing status on official GST portal before releasing large GST payments.`
          );
        }

        if (taxpayerType === 'Composition') {
          riskLevel = riskLevel === 'critical' ? 'critical' : 'warning';
          riskFlags.push(
            `COMPOSITION DEALER (Section 10): Supplier CANNOT legally charge GST on invoices and buyer gets 0% ITC. Always compare against Regular suppliers on full gross cost.`
          );
        }

        if (eInvoiceEnabled === true) {
          riskFlags.push(
            `E-INVOICE MANDATED: GSTN indicates e-Invoicing is enabled for this supplier. Reject any B2B tax invoice missing a 64-char IRN + QR Code.`
          );
        }

        return {
          gstin,
          checksumValid: true,
          liveVerified: taxpayerStatus !== 'Unverified' || Boolean(legalName),
          provider: resolvedProvider,
          taxpayerStatus,
          legalName,
          tradeName,
          taxpayerType,
          inferredGstRegime,
          eInvoiceEnabled,
          registrationDate: regDate,
          cancellationDate: cancelDate,
          stateCode: local.stateCode,
          stateName: local.stateName,
          pan: local.pan,
          panEntityLabel: local.panEntityLabel,
          tds194cRatePct: local.tds194cRatePct,
          filingComplianceNote:
            taxpayerStatus === 'Active'
              ? `Live GSTN Verified: Active ${taxpayerType} taxpayer (${legalName || tradeName || gstin}). Cached for ${CACHE_TTL_DAYS} days.`
              : `Live GSTN returned status: ${taxpayerStatus}.`,
          riskLevel,
          riskFlags,
          officialPortalUrl,
          verifiedAt: nowIso,
          cacheExpiresAt: expiresIso,
          rawSummary: {
            sts: statusRaw || null,
            dty: dtyRaw || null,
            lgnm: legalName,
            tradeNam: tradeName,
            einvoiceStatus: einvRaw ?? null,
          },
        };
      }
    } catch {
      // Fall through cleanly to offline verification with honest notice
    }
  }

  return {
    gstin,
    checksumValid: true,
    liveVerified: false,
    provider: 'offline_checksum_only',
    taxpayerStatus: 'Unverified',
    legalName: null,
    tradeName: null,
    taxpayerType: 'Unknown',
    inferredGstRegime: 'regular',
    eInvoiceEnabled: null,
    registrationDate: null,
    cancellationDate: null,
    stateCode: local.stateCode,
    stateName: local.stateName,
    pan: local.pan,
    panEntityLabel: local.panEntityLabel,
    tds194cRatePct: local.tds194cRatePct,
    filingComplianceNote: `Offline Mod-36 checksum PASSED (${local.stateName}, ${local.panEntityLabel}, TDS 194C: ${local.tds194cRatePct}%). Configure GSTN_API_KEY (AppyFlow / GSTZen / MasterGST) for automated live Active/Cancelled/Composition checks, or verify via official GST portal.`,
    riskLevel: 'warning',
    riskFlags: [
      `Checksum valid (${local.stateName} · ${local.panEntityLabel}), but live GSTN Active/Composition status has not been fetched yet. Configure GSTN_API_KEY or click Official GST Portal link.`,
    ],
    officialPortalUrl,
    verifiedAt: nowIso,
    cacheExpiresAt: addDaysIso(1), // Retry live check sooner when offline-only
  };
}
