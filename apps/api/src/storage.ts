import { hmacSha256Hex, sha256Hex, toHex, verifyHmacSha256Hex } from './auth.js';

/**
 * Persistent File Storage Layer for Kraya:
 * 1. Cloudflare Workers R2 Binding (`VAULT_BUCKET`) — zero-egress production on Workers
 * 2. Cloudflare R2 S3-Compatible API (WebCrypto AWS SigV4) — works on Node 22 & Workers
 * 3. Persistent Local Disk Vault (`./data/uploads`) — honest local dev fallback when R2 creds absent
 *
 * Enforces strict MIME allowlist + magic-byte sniffing, 15 MB size cap, filename sanitization,
 * workspace-isolated object keys, HMAC-signed temporary download URLs, and true object deletion.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export type StorageProviderMode = 'cloudflare_r2_binding' | 'cloudflare_r2_s3' | 'local_dev_vault';

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string | Blob,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

export interface StorageConfig {
  r2Binding?: R2BucketLike;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  r2Endpoint?: string;
  localVaultDir?: string;
  signingSecret?: string;
}

export interface ValidatedUpload {
  safeFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: 'quote' | 'invoice' | 'audio' | 'po_pdf' | 'spreadsheet' | 'document';
}

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
]);

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
};

const BLOCKED_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.js', '.mjs', '.cjs', '.ts', '.exe', '.sh', '.bat', '.cmd', '.php', '.py', '.rb', '.jar', '.dll',
]);

export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() || 'upload.bin';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'upload.bin';
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function verifyMagicBytes(mime: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (mime === 'application/pdf') {
    return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
  }
  if (mime === 'image/png') {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47]); // \x89PNG
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mime === 'image/webp') {
    return (
      hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]); // ZIP/XLSX
  }
  if (mime === 'application/vnd.ms-excel') {
    return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0]); // OLE2
  }
  if (mime === 'text/csv') {
    // Reject HTML/script payloads disguised as CSV
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).toLowerCase();
    return !head.includes('<html') && !head.includes('<script') && !head.includes('<svg');
  }
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') {
    // ID3 tag or MPEG frame sync (0xFF 0xE0..0xFF)
    return hasPrefix(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  if (mime === 'audio/wav' || mime === 'audio/x-wav') {
    return (
      hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x41 &&
      bytes[10] === 0x56 &&
      bytes[11] === 0x45
    );
  }
  if (mime === 'audio/ogg') {
    return hasPrefix(bytes, [0x4f, 0x67, 0x67, 0x53]); // OggS
  }
  if (mime === 'audio/webm') {
    return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]); // EBML
  }
  if (mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a') {
    return bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // ftyp
  }
  return false;
}

export async function validateUploadFile(params: {
  fileName: string;
  mimeType: string | null | undefined;
  bytes: Uint8Array;
  category?: ValidatedUpload['category'];
  maxBytes?: number;
}): Promise<ValidatedUpload> {
  const maxBytes = params.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!params.bytes || params.bytes.byteLength === 0) {
    throw new Error('Invalid upload: file is empty (0 bytes).');
  }
  if (params.bytes.byteLength > maxBytes) {
    throw new Error(
      `Invalid upload: file exceeds maximum allowed size of ${Math.round(maxBytes / (1024 * 1024))} MB.`
    );
  }

  const safeFileName = sanitizeFileName(params.fileName || 'document');
  const ext = getExtension(safeFileName);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Invalid upload: file extension "${ext}" is blocked for security reasons.`);
  }

  let normalizedMime = (params.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!normalizedMime || normalizedMime === 'application/octet-stream') {
    normalizedMime = EXT_TO_MIME[ext] || '';
  }
  if (normalizedMime === 'image/jpg') normalizedMime = 'image/jpeg';
  if (normalizedMime === 'audio/mp3') normalizedMime = 'audio/mpeg';
  if (normalizedMime === 'audio/x-wav') normalizedMime = 'audio/wav';
  if (normalizedMime === 'audio/m4a' || normalizedMime === 'audio/x-m4a') normalizedMime = 'audio/mp4';

  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new Error(
      `Invalid upload: unsupported file type "${normalizedMime || ext || 'unknown'}". Allowed: PDF, PNG, JPEG, WEBP, XLSX, XLS, CSV, MP3, WAV, OGG, WEBM, M4A.`
    );
  }

  if (!verifyMagicBytes(normalizedMime, params.bytes)) {
    throw new Error(
      `Invalid upload: file content signature does not match declared type "${normalizedMime}".`
    );
  }

  const sha256 = await sha256Hex(params.bytes);
  const inferredCategory: ValidatedUpload['category'] =
    params.category ||
    (normalizedMime.startsWith('audio/')
      ? 'audio'
      : normalizedMime.includes('spreadsheet') || normalizedMime.includes('excel') || normalizedMime === 'text/csv'
        ? 'spreadsheet'
        : 'document');

  return {
    safeFileName,
    mimeType: normalizedMime,
    sizeBytes: params.bytes.byteLength,
    sha256,
    category: inferredCategory,
  };
}

export function buildWorkspaceStorageKey(
  workspaceId: string,
  category: string,
  fileId: string,
  safeFileName: string
): string {
  const safeWs = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeCat = category.replace(/[^a-zA-Z0-9_-]/g, '');
  return `workspaces/${safeWs}/${safeCat}/${fileId}-${sanitizeFileName(safeFileName)}`;
}

// ============================================================================
// AWS Signature V4 (WebCrypto — Zero Dependencies, Works in Node 22 & Workers)
// ============================================================================

async function hmacBytes(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function deriveAwsSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<Uint8Array> {
  const kDate = await hmacBytes(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

function encodeR2UriPath(pathStr: string): string {
  return pathStr
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function signedR2Fetch(
  cfg: Required<Pick<StorageConfig, 'r2AccountId' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'>> & {
    r2Endpoint?: string;
  },
  method: 'PUT' | 'GET' | 'DELETE',
  storageKey: string,
  body?: Uint8Array,
  contentType?: string
): Promise<Response> {
  const endpointBase = (
    cfg.r2Endpoint || `https://${cfg.r2AccountId}.r2.cloudflarestorage.com`
  ).replace(/\/+$/, '');
  const url = new URL(`${endpointBase}/${encodeURIComponent(cfg.r2BucketName)}/${encodeR2UriPath(storageKey)}`);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadHash = body ? await sha256Hex(body) : await sha256Hex('');
  const headersMap: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType && method === 'PUT') {
    headersMap['content-type'] = contentType;
  }

  const sortedKeys = Object.keys(headersMap).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headersMap[k].trim()}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveAwsSigningKey(cfg.r2SecretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacBytes(signingKey, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.r2AccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    return await fetch(url.toString(), {
      method,
      headers: {
        ...headersMap,
        Authorization: authorization,
      },
      body: body ? new Uint8Array(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class PersistentVaultStorage {
  private readonly cfg: StorageConfig;
  public readonly mode: StorageProviderMode;

  constructor(cfg: StorageConfig) {
    this.cfg = cfg;
    if (cfg.r2Binding) {
      this.mode = 'cloudflare_r2_binding';
    } else if (
      cfg.r2AccountId &&
      cfg.r2AccessKeyId &&
      cfg.r2SecretAccessKey &&
      cfg.r2BucketName
    ) {
      this.mode = 'cloudflare_r2_s3';
    } else {
      this.mode = 'local_dev_vault';
    }
  }

  private get localRoot(): string {
    return this.cfg.localVaultDir || (typeof process !== 'undefined' ? process.env.LOCAL_VAULT_DIR : undefined) || './data/uploads';
  }

  private async resolveSafeLocalPath(storageKey: string): Promise<string> {
    const pathMod = await import('node:path');
    const root = pathMod.resolve(this.localRoot);
    const resolved = pathMod.resolve(root, storageKey);
    if (!resolved.startsWith(root + pathMod.sep)) {
      throw new Error('Invalid storage key path traversal attempt blocked.');
    }
    return resolved;
  }

  async putObject(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    if (this.mode === 'cloudflare_r2_binding' && this.cfg.r2Binding) {
      await this.cfg.r2Binding.put(storageKey, bytes, {
        httpMetadata: { contentType: mimeType },
      });
      return;
    }

    if (this.mode === 'cloudflare_r2_s3') {
      const res = await signedR2Fetch(
        {
          r2AccountId: this.cfg.r2AccountId!,
          r2AccessKeyId: this.cfg.r2AccessKeyId!,
          r2SecretAccessKey: this.cfg.r2SecretAccessKey!,
          r2BucketName: this.cfg.r2BucketName!,
          r2Endpoint: this.cfg.r2Endpoint,
        },
        'PUT',
        storageKey,
        bytes,
        mimeType
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Cloudflare R2 PUT failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      return;
    }

    // Local dev filesystem persistent vault
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const fullPath = await this.resolveSafeLocalPath(storageKey);
    await fs.mkdir(pathMod.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, bytes);
  }

  async getObject(storageKey: string): Promise<Uint8Array | null> {
    if (this.mode === 'cloudflare_r2_binding' && this.cfg.r2Binding) {
      const obj = await this.cfg.r2Binding.get(storageKey);
      if (!obj) return null;
      return new Uint8Array(await obj.arrayBuffer());
    }

    if (this.mode === 'cloudflare_r2_s3') {
      const res = await signedR2Fetch(
        {
          r2AccountId: this.cfg.r2AccountId!,
          r2AccessKeyId: this.cfg.r2AccessKeyId!,
          r2SecretAccessKey: this.cfg.r2SecretAccessKey!,
          r2BucketName: this.cfg.r2BucketName!,
          r2Endpoint: this.cfg.r2Endpoint,
        },
        'GET',
        storageKey
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Cloudflare R2 GET failed (${res.status})`);
      }
      return new Uint8Array(await res.arrayBuffer());
    }

    const fs = await import('node:fs/promises');
    const fullPath = await this.resolveSafeLocalPath(storageKey);
    try {
      const buf = await fs.readFile(fullPath);
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    if (this.mode === 'cloudflare_r2_binding' && this.cfg.r2Binding) {
      await this.cfg.r2Binding.delete(storageKey);
      return;
    }

    if (this.mode === 'cloudflare_r2_s3') {
      const res = await signedR2Fetch(
        {
          r2AccountId: this.cfg.r2AccountId!,
          r2AccessKeyId: this.cfg.r2AccessKeyId!,
          r2SecretAccessKey: this.cfg.r2SecretAccessKey!,
          r2BucketName: this.cfg.r2BucketName!,
          r2Endpoint: this.cfg.r2Endpoint,
        },
        'DELETE',
        storageKey
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`Cloudflare R2 DELETE failed (${res.status})`);
      }
      return;
    }

    const fs = await import('node:fs/promises');
    const fullPath = await this.resolveSafeLocalPath(storageKey);
    await fs.rm(fullPath, { force: true });
  }

  async objectExists(storageKey: string): Promise<boolean> {
    const obj = await this.getObject(storageKey);
    return obj !== null;
  }

  async createSignedDownloadQuery(
    fileId: string,
    workspaceId: string,
    ttlSeconds = 300
  ): Promise<{ expiresAt: number; signature: string; queryString: string }> {
    const secret = this.cfg.signingSecret || 'kraya-dev-file-signing-secret';
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `download:${fileId}:${workspaceId}:${expiresAt}`;
    const signature = await hmacSha256Hex(payload, secret);
    return {
      expiresAt,
      signature,
      queryString: `exp=${expiresAt}&ws=${encodeURIComponent(workspaceId)}&sig=${signature}`,
    };
  }

  async verifySignedDownloadQuery(
    fileId: string,
    workspaceId: string,
    expParam: string | undefined,
    sigParam: string | undefined
  ): Promise<boolean> {
    if (!expParam || !sigParam) return false;
    const exp = Number(expParam);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const secret = this.cfg.signingSecret || 'kraya-dev-file-signing-secret';
    const payload = `download:${fileId}:${workspaceId}:${exp}`;
    return verifyHmacSha256Hex(payload, sigParam, secret);
  }
}
