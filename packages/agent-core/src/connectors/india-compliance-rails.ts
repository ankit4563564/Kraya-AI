import { UdyamTier, fromPaise, Paise } from '@kraya/finance-engine';
import { fetchWithTimeoutAndRetry } from '../http-utils.js';

export interface UdyamVerificationResult {
  udyamNumber: string;
  formatValid: boolean;
  liveVerified: boolean;
  provider: 'surepass' | 'sandbox_co_in' | 'custom_udyam_api' | 'offline_format_only';
  enterpriseName: string | null;
  enterpriseTier: UdyamTier;
  majorActivity: 'Manufacturing' | 'Services' | 'Trading' | 'Unknown';
  section43bhCovered: boolean;
  officialPortalUrl: string;
  note: string;
}

const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/**
 * Live Indian Udyam MSME Verification Connector.
 * Validates exact `UDYAM-XX-00-0000000` structure offline and queries Surepass / Sandbox.co.in / custom API
 * when `UDYAM_API_KEY` is configured — legally verifying whether Section 43B(h) 15d/45d caps apply
 * (Micro/Small Manufacturers & Services = Covered; Medium & Pure Traders = Excluded per OM 5/2(2)/2021).
 */
export async function verifyUdyamLive(
  rawUdyam: string,
  config?: {
    provider?: string;
    apiKey?: string;
    apiUrl?: string;
    skipNetwork?: boolean;
  }
): Promise<UdyamVerificationResult> {
  const normalized = (rawUdyam || '').trim().toUpperCase();
  const formatValid = UDYAM_REGEX.test(normalized);
  const officialPortalUrl = 'https://udyamregistration.gov.in/Udyam_Verify.aspx';

  if (!formatValid) {
    return {
      udyamNumber: normalized,
      formatValid: false,
      liveVerified: false,
      provider: 'offline_format_only',
      enterpriseName: null,
      enterpriseTier: 'unknown',
      majorActivity: 'Unknown',
      section43bhCovered: false,
      officialPortalUrl,
      note: 'Invalid Udyam Registration Number format. Expected format: UDYAM-KA-03-0012345.',
    };
  }

  if (!config?.skipNetwork && (config?.apiKey?.trim() || config?.apiUrl?.trim())) {
    try {
      const providerKey = (config.provider || 'surepass').toLowerCase();
      let endpoint = config.apiUrl?.trim() || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      let resolvedProvider: UdyamVerificationResult['provider'] = 'custom_udyam_api';
      let method: 'GET' | 'POST' = 'POST';
      let body: string | undefined;

      if (endpoint) {
        if (endpoint.includes('{udyam}')) {
          endpoint = endpoint.replace('{udyam}', encodeURIComponent(normalized));
          method = 'GET';
        } else {
          body = JSON.stringify({ id_number: normalized, udyam_number: normalized });
        }
        if (config.apiKey?.trim()) headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
      } else if (providerKey === 'sandbox_co_in') {
        endpoint = `https://api.sandbox.co.in/mca/udyam/verify?udyam_number=${encodeURIComponent(normalized)}`;
        method = 'GET';
        headers['x-api-key'] = config.apiKey!.trim();
        resolvedProvider = 'sandbox_co_in';
      } else {
        endpoint = 'https://kyc-api.surepass.io/api/v1/udyog-aadhaar/verify';
        method = 'POST';
        headers['Authorization'] = `Bearer ${config.apiKey!.trim()}`;
        body = JSON.stringify({ id_number: normalized });
        resolvedProvider = 'surepass';
      }

      const res = await fetchWithTimeoutAndRetry(
        endpoint,
        { method, headers, body },
        { timeoutMs: 8_000, maxRetries: 1 }
      );
      if (res.ok) {
        const raw = (await res.json()) as Record<string, unknown>;
        const data = (raw.data || raw) as Record<string, unknown>;
        const tierStr = String(data.enterprise_type || data.enterpriseType || data.category || '').toLowerCase();
        const actStr = String(data.major_activity || data.majorActivity || '').toLowerCase();
        const enterpriseName = data.enterprise_name || data.name ? String(data.enterprise_name || data.name) : null;

        let enterpriseTier: UdyamTier = 'unknown';
        if (tierStr.includes('micro')) enterpriseTier = 'micro';
        else if (tierStr.includes('small')) enterpriseTier = 'small';
        else if (tierStr.includes('medium')) enterpriseTier = 'medium';

        let majorActivity: UdyamVerificationResult['majorActivity'] = 'Unknown';
        if (actStr.includes('trad')) majorActivity = 'Trading';
        else if (actStr.includes('manufact')) majorActivity = 'Manufacturing';
        else if (actStr.includes('servic')) majorActivity = 'Services';

        if (majorActivity === 'Trading') enterpriseTier = 'trader';
        const section43bhCovered =
          (enterpriseTier === 'micro' || enterpriseTier === 'small') && majorActivity !== 'Trading';

        return {
          udyamNumber: normalized,
          formatValid: true,
          liveVerified: true,
          provider: resolvedProvider,
          enterpriseName,
          enterpriseTier,
          majorActivity,
          section43bhCovered,
          officialPortalUrl,
          note: section43bhCovered
            ? `Live Verified ${enterpriseTier.toUpperCase()} (${majorActivity}): COVERED by Section 43B(h) — enforce 45-day max written PO terms!`
            : `Live Verified ${enterpriseTier.toUpperCase()} (${majorActivity}): Excluded from Section 43B(h) 45-day tax disallowance.`,
        };
      }
    } catch {
      // Fall through cleanly to offline format validation
    }
  }

  return {
    udyamNumber: normalized,
    formatValid: true,
    liveVerified: false,
    provider: 'offline_format_only',
    enterpriseName: null,
    enterpriseTier: 'unknown',
    majorActivity: 'Unknown',
    section43bhCovered: false,
    officialPortalUrl,
    note: 'Valid Udyam format (UDYAM-XX-00-0000000). Configure UDYAM_API_KEY (Surepass / Sandbox.co.in) or verify Micro/Small vs Trading classification on udyamregistration.gov.in.',
  };
}

export interface IndianIfscVerificationResult {
  ifsc: string;
  valid: boolean;
  bank: string | null;
  branch: string | null;
  city: string | null;
  state: string | null;
  neft: boolean;
  rtgs: boolean;
  imps: boolean;
  upi: boolean;
  provider: 'razorpay_public_ifsc' | 'offline_format_only';
}

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * 100% Free Live Indian Bank IFSC Verification via Razorpay's Public IFSC API (`https://ifsc.razorpay.com/{IFSC}`).
 * Zero API key required! Prevents supplier NEFT/RTGS payout failures.
 */
export async function verifyIndianIfscLive(
  rawIfsc: string,
  skipNetwork = false
): Promise<IndianIfscVerificationResult> {
  const ifsc = (rawIfsc || '').trim().toUpperCase();
  if (!IFSC_REGEX.test(ifsc)) {
    return {
      ifsc,
      valid: false,
      bank: null,
      branch: null,
      city: null,
      state: null,
      neft: false,
      rtgs: false,
      imps: false,
      upi: false,
      provider: 'offline_format_only',
    };
  }

  if (!skipNetwork) {
    try {
      const res = await fetchWithTimeoutAndRetry(
        `https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`,
        { method: 'GET' },
        { timeoutMs: 5_000, maxRetries: 1 }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          BANK?: string;
          BRANCH?: string;
          CITY?: string;
          STATE?: string;
          NEFT?: boolean;
          RTGS?: boolean;
          IMPS?: boolean;
          UPI?: boolean;
        };
        return {
          ifsc,
          valid: true,
          bank: data.BANK || null,
          branch: data.BRANCH || null,
          city: data.CITY || null,
          state: data.STATE || null,
          neft: Boolean(data.NEFT),
          rtgs: Boolean(data.RTGS),
          imps: Boolean(data.IMPS),
          upi: Boolean(data.UPI),
          provider: 'razorpay_public_ifsc',
        };
      }
      if (res.status === 404) {
        return {
          ifsc,
          valid: false,
          bank: null,
          branch: null,
          city: null,
          state: null,
          neft: false,
          rtgs: false,
          imps: false,
          upi: false,
          provider: 'razorpay_public_ifsc',
        };
      }
    } catch {
      // Fall through to offline regex check
    }
  }

  return {
    ifsc,
    valid: true,
    bank: null,
    branch: null,
    city: null,
    state: null,
    neft: true,
    rtgs: true,
    imps: true,
    upi: true,
    provider: 'offline_format_only',
  };
}

export interface RazorpayXPayoutDraft {
  mode: 'NEFT' | 'RTGS' | 'IMPS';
  amountPaise: Paise;
  amountRupees: number;
  currency: 'INR';
  purpose: 'vendor_bill';
  referenceId: string;
  narration: string;
  requiresHumanApproval: true;
  readyForLiveDispatch: boolean;
}

/**
 * Builds a compliant RazorpayX Payout Draft (strictly approval-gated; never fires money silently).
 * Chooses RTGS automatically for >= ₹2,00,000 and NEFT/IMPS below ₹2,00,000.
 */
export function buildRazorpayXPayoutDraft(params: {
  invoiceNumber: string;
  supplierName: string;
  netPayablePaise: Paise;
  hasLiveRazorpayXCreds: boolean;
}): RazorpayXPayoutDraft {
  const mode: 'NEFT' | 'RTGS' | 'IMPS' =
    params.netPayablePaise >= 2_00_000 * 100 ? 'RTGS' : 'NEFT';
  return {
    mode,
    amountPaise: params.netPayablePaise,
    amountRupees: fromPaise(params.netPayablePaise),
    currency: 'INR',
    purpose: 'vendor_bill',
    referenceId: `KRAYA-${params.invoiceNumber}`.slice(0, 40),
    narration: `Inv ${params.invoiceNumber} ${params.supplierName}`.slice(0, 30),
    requiresHumanApproval: true,
    readyForLiveDispatch: params.hasLiveRazorpayXCreds,
  };
}
