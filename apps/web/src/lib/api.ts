export const API_BASE = import.meta.env.VITE_API_BASE || '';

export function formatINR(paise: number, decimals = 2): string {
  const rupees = Math.round(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rupees);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export class ApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let unauthorizedListener: (() => void) | null = null;

export const AUTH_TOKEN_KEY = 'kraya_auth_token';

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

export function setUnauthorizedListener(fn: (() => void) | null): void {
  unauthorizedListener = fn;
}

/**
 * Authenticated JSON API client.
 * Supports Bearer token in localStorage (kraya_auth_token) and HTTP-only session cookies.
 */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = {
    ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };

  let res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  let data = await res.json().catch(() => ({}));

  // If proxy returned a raw 500/502/503/504 with no structured JSON error (e.g. API server warming up), retry once after 600ms
  if (
    !res.ok &&
    res.status >= 500 &&
    !(data as { error?: string }).error
  ) {
    await new Promise((r) => setTimeout(r, 600));
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
    data = await res.json().catch(() => ({}));
  }

  if (!res.ok) {
    if (res.status === 401 && unauthorizedListener && !path.startsWith('/api/auth/')) {
      unauthorizedListener();
    }
    const msg =
      (data as { error?: string; details?: string[]; detail?: string }).error ||
      `Request failed (${res.status})`;
    const details = (data as { details?: string[]; detail?: string }).details;
    const singleDetail = (data as { detail?: string }).detail;
    const suffix = details?.length
      ? `: ${details.join('; ')}`
      : singleDetail
        ? `: ${singleDetail}`
        : '';
    throw new ApiError(`${msg}${suffix}`, res.status);
  }
  return data as T;
}

export type ThemePref = 'system' | 'light' | 'dark';

export function getStoredThemePref(): ThemePref {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

export function applyThemePref(pref: ThemePref): void {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const content = pref === 'system' ? 'light dark' : pref;
  if (meta) meta.setAttribute('content', content);
  try {
    if (pref === 'system') localStorage.removeItem('color-scheme');
    else localStorage.setItem('color-scheme', pref);
  } catch {
    // ignore storage errors
  }
}

export type OutreachLang =
  | 'english'
  | 'hinglish'
  | 'hindi'
  | 'kannada'
  | 'tamil'
  | 'malayalam';

export type UserRole = 'owner' | 'clerk' | 'ca';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  workspaceId: string;
}

export interface WorkspaceMembershipInfo {
  membershipId: string;
  workspaceId: string;
  role: UserRole;
  legalName: string;
  gstin: string | null;
  stateCode: string;
  onboardingCompletedAt: string | null;
}

export interface WorkspaceProfile {
  id: string;
  legalName: string;
  gstin: string | null;
  stateCode: string;
  gstRegime: 'regular' | 'composition' | 'unregistered';
  waccPct: number;
  turnoverBand: 'under_5cr' | '5cr_to_10cr' | 'above_10cr';
  defaultOutreachLang: OutreachLang;
  policyPatchMd: string | null;
  businessAddress: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  onboardingCompletedAt: string | null;
}

export interface AuthMeResponse {
  authenticated: boolean;
  requireAuthMode: boolean;
  user: AuthUser | null;
  workspaceId: string;
  role: UserRole;
  email: string;
  workspace: WorkspaceProfile | null;
  workspaces: WorkspaceMembershipInfo[];
  needsOnboarding: boolean;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  joinedAt: string;
}

export interface TeamInvitation {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface StoredFileRecord {
  id: string;
  category: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageProvider: string;
  sourceEventId: string | null;
  quoteId: string | null;
  invoiceId: string | null;
  poId: string | null;
  createdAt: string;
}

export interface SummaryStats {
  totalProtectedPaise: number;
  recoveredPaise: number;
  activeLeaksCount: number;
  openRfqsCount: number;
  posIssuedCount: number;
  invoicesAuditedCount: number;
  openTasksCount: number;
  suppliersCount: number;
  pendingVerificationsCount: number;
  inboxCount: number;
  storedFilesCount: number;
}

export interface HealthInfo {
  ok: boolean;
  dbMode: string;
  appliedMigrations?: string[];
  storageEngine?: string;
  aiExtractionEngine: string;
  voiceAsrEngine: string;
  voiceNoteTtsEnabled?: boolean;
  emailEngine: string;
  whatsappEngine: string;
  requireAuth?: boolean;
}

export interface ComplianceFlag {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  impactPaise: number;
  statutoryRef: string;
  recommendedAction: string;
}

export interface OutreachPackage {
  language: OutreachLang;
  subject: string;
  body: string;
  whatsappUrl: string;
  mailtoUrl: string;
}

export interface SupplierRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  category: string | null;
  gstin: string | null;
  stateCode: string | null;
  gstRegime: 'regular' | 'composition' | 'unregistered';
  panEntityType: string | null;
  udyamNumber: string | null;
  udyamTier: 'micro' | 'small' | 'medium' | 'trader' | 'unregistered' | 'unknown';
  eInvoiceRequired: boolean;
  creditDays: number;
  reliabilityScore: number;
  notes: string | null;
}

export const INDIAN_STATES: Array<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
];
