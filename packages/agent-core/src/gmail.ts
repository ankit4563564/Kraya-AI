import { fetchWithTimeoutAndRetry } from './http-utils.js';

export interface GmailCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  userEmail?: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailSendReceipt {
  accepted: boolean;
  channel: 'gmail_api';
  providerMessageId: string | null;
  threadId: string | null;
  statusNote: string;
}

export interface GmailAttachmentMeta {
  partId: string;
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

export interface GmailVendorMessage {
  id: string;
  threadId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  date: string;
  snippet: string;
  attachments: GmailAttachmentMeta[];
}

export interface GoogleOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export const GMAIL_DEFAULT_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Constructs the official Google OAuth 2.0 user consent authorization URL.
 */
export function buildGmailAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state?: string;
  accessType?: 'offline' | 'online';
  prompt?: string;
  scopes?: string[];
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId.trim());
  url.searchParams.set('redirect_uri', params.redirectUri.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (params.scopes && params.scopes.length > 0 ? params.scopes : GMAIL_DEFAULT_OAUTH_SCOPES).join(' '));
  url.searchParams.set('access_type', params.accessType || 'offline');
  url.searchParams.set('prompt', params.prompt || 'consent');
  if (params.state) {
    url.searchParams.set('state', params.state);
  }
  return url.toString();
}

/**
 * Exchanges a Google OAuth 2.0 authorization code for access and refresh tokens.
 */
export async function exchangeGoogleOAuthCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleOAuthTokenResponse> {
  const res = await fetchWithTimeoutAndRetry(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: params.clientId.trim(),
        client_secret: params.clientSecret.trim(),
        code: params.code.trim(),
        redirect_uri: params.redirectUri.trim(),
        grant_type: 'authorization_code',
      }).toString(),
    },
    { timeoutMs: 15_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google OAuth token exchange failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Google OAuth token endpoint returned no access_token.');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 3600,
    tokenType: data.token_type ?? 'Bearer',
    scope: data.scope,
  };
}

/**
 * Resolves an active Google OAuth2 Bearer token from direct accessToken
 * or exchanges a refresh_token at https://oauth2.googleapis.com/token.
 */
export async function resolveGmailAccessToken(creds: GmailCredentials): Promise<string> {
  const directToken = creds.accessToken?.trim();
  if (directToken) {
    return directToken;
  }

  const refreshToken = creds.refreshToken?.trim();
  const clientId = creds.clientId?.trim();
  const clientSecret = creds.clientSecret?.trim();

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      'Missing Gmail OAuth credentials. Provide GMAIL_ACCESS_TOKEN or (GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET).'
    );
  }

  const res = await fetchWithTimeoutAndRetry(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    },
    { timeoutMs: 10_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Google OAuth token endpoint returned an empty access_token.');
  }

  return data.access_token;
}

/**
 * Checks connectivity and verifies user profile on the official Google Gmail REST API.
 */
export async function getGmailUserProfile(creds: GmailCredentials): Promise<GmailProfile> {
  const token = await resolveGmailAccessToken(creds);
  const user = creds.userEmail || 'me';
  const url = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/profile`;

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
    { timeoutMs: 10_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gmail API getProfile failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    emailAddress?: string;
    messagesTotal?: number;
    threadsTotal?: number;
    historyId?: string;
  };

  return {
    emailAddress: data.emailAddress || 'authenticated-user@gmail.com',
    messagesTotal: Number(data.messagesTotal ?? 0),
    threadsTotal: Number(data.threadsTotal ?? 0),
    historyId: String(data.historyId || '0'),
  };
}

/**
 * Converts a raw UTF-8 string into RFC 4648 base64url encoding (as required by Gmail API).
 */
export function toBase64Url(strOrBytes: string | Uint8Array): string {
  let b64: string;
  if (typeof strOrBytes === 'string') {
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(strOrBytes, 'utf8').toString('base64');
    } else {
      b64 = btoa(unescape(encodeURIComponent(strOrBytes)));
    }
  } else {
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(strOrBytes).toString('base64');
    } else {
      let binary = '';
      for (let i = 0; i < strOrBytes.byteLength; i++) {
        binary += String.fromCharCode(strOrBytes[i]);
      }
      b64 = btoa(binary);
    }
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Builds an RFC 2822 MIME message for sending via Gmail API (including text, HTML, and attachments).
 */
export function buildRfc2822MimeMessage(params: {
  fromEmail?: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  htmlText?: string;
  attachments?: Array<{ filename: string; mimeType: string; base64Data: string }>;
}): string {
  const boundary = `kraya_boundary_${Date.now().toString(16)}`;
  const lines: string[] = [
    `To: ${params.toEmail}`,
    params.fromEmail ? `From: ${params.fromEmail}` : '',
    `Subject: =?UTF-8?B?${toBase64Url(params.subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.bodyText,
  ].filter(Boolean);

  if (params.htmlText) {
    lines.push(
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      params.htmlText
    );
  }

  if (Array.isArray(params.attachments)) {
    for (const att of params.attachments) {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        att.base64Data
      );
    }
  }

  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

/**
 * Sends an email natively via Google's official Gmail REST API.
 */
export async function sendViaGmailApi(params: {
  creds: GmailCredentials;
  toEmail: string;
  subject: string;
  bodyText: string;
  htmlText?: string;
  attachments?: Array<{ filename: string; mimeType: string; base64Data: string }>;
  threadId?: string;
}): Promise<GmailSendReceipt> {
  const token = await resolveGmailAccessToken(params.creds);
  const user = params.creds.userEmail || 'me';

  const rawMime = buildRfc2822MimeMessage({
    toEmail: params.toEmail,
    subject: params.subject,
    bodyText: params.bodyText,
    htmlText: params.htmlText,
    attachments: params.attachments,
  });

  const rawBase64Url = toBase64Url(rawMime);
  const endpoint = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages/send`;

  const bodyPayload: Record<string, unknown> = { raw: rawBase64Url };
  if (params.threadId) {
    bodyPayload.threadId = params.threadId;
  }

  const res = await fetchWithTimeoutAndRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    },
    { timeoutMs: 15_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gmail API messages.send failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id?: string; threadId?: string };
  return {
    accepted: Boolean(data.id),
    channel: 'gmail_api',
    providerMessageId: data.id ?? null,
    threadId: data.threadId ?? null,
    statusNote: data.id
      ? 'Dispatched directly via official Google Gmail API mailbox.'
      : 'No message ID returned by Gmail API.',
  };
}

/**
 * Searches the user's Gmail mailbox for vendor quotes, parchis, rate sheets, and invoices.
 */
export async function searchGmailVendorMessages(params: {
  creds: GmailCredentials;
  query?: string;
  maxResults?: number;
}): Promise<Array<{ id: string; threadId: string }>> {
  const token = await resolveGmailAccessToken(params.creds);
  const user = params.creds.userEmail || 'me';
  const q =
    params.query ||
    'has:attachment (filename:pdf OR filename:xlsx OR filename:png OR filename:jpg) ("quote" OR "quotation" OR "rate" OR "tax invoice" OR "bill")';

  const url = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages?q=${encodeURIComponent(q)}&maxResults=${params.maxResults ?? 20}`;

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
    { timeoutMs: 12_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gmail API messages.list failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { messages?: Array<{ id?: string; threadId?: string }> };
  return (data.messages ?? []).filter(
    (m): m is { id: string; threadId: string } => Boolean(m.id && m.threadId)
  );
}

/**
 * Downloads a specific attachment's raw byte buffer from the Gmail API.
 */
export async function downloadGmailAttachmentBytes(params: {
  creds: GmailCredentials;
  messageId: string;
  attachmentId: string;
}): Promise<Uint8Array> {
  const token = await resolveGmailAccessToken(params.creds);
  const user = params.creds.userEmail || 'me';
  const url = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages/${encodeURIComponent(params.messageId)}/attachments/${encodeURIComponent(params.attachmentId)}`;

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
    { timeoutMs: 15_000, maxRetries: 2 }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gmail API attachments.get failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: string };
  const rawB64 = (data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(rawB64, 'base64'));
  }
  const binary = atob(rawB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Revokes an OAuth token (access or refresh token) using Google's OAuth 2.0 revocation endpoint.
 */
export async function revokeGoogleOAuthToken(token: string): Promise<boolean> {
  if (!token?.trim()) return true;
  try {
    const res = await fetchWithTimeoutAndRetry(
      'https://oauth2.googleapis.com/revoke',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token.trim() }).toString(),
      },
      { timeoutMs: 10_000, maxRetries: 2 }
    );
    return res.ok;
  } catch {
    return false;
  }
}
