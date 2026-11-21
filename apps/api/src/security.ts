/**
 * Security Hardening Utilities for Kraya API:
 * - In-memory sliding-window rate limiter (per IP + route bucket)
 * - Security response headers (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS)
 * - Request size guards
 * - Safe log redaction (never logs passwords, tokens, or API keys)
 */

interface RateBucket {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  check(
    key: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const cutoff = now - windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Evict expired timestamps
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    // Opportunistic map pruning to keep memory bounded
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) {
        if (v.timestamps.length === 0 || v.timestamps[v.timestamps.length - 1] <= cutoff) {
          this.buckets.delete(k);
        }
      }
    }

    if (bucket.timestamps.length >= limit) {
      const oldest = bucket.timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    bucket.timestamps.push(now);
    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.timestamps.length),
      retryAfterSeconds: 0,
    };
  }

  peek(
    key: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const cutoff = now - windowMs;
    const bucket = this.buckets.get(key);
    if (!bucket) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length >= limit) {
      const oldest = bucket.timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: limit - bucket.timestamps.length, retryAfterSeconds: 0 };
  }

  record(key: string): void {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }
    bucket.timestamps.push(now);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export function extractClientIp(headers: {
  get(name: string): string | undefined | null;
}): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return '127.0.0.1';
}

export function buildSecurityHeaders(isHttps: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), microphone=(self)',
    'X-DNS-Prefetch-Control': 'off',
    'Content-Security-Policy':
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; connect-src 'self'",
  };
  if (isHttps) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Strip any accidental bearer tokens / API key fragments from error logs
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(key|token|secret|password)=[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}
