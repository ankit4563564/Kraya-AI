/**
 * Portable resilient HTTP client (Node 22 + Cloudflare Workers) with AbortController timeouts
 * and bounded exponential backoff for transient 429/502/503/504 errors.
 */

export interface ResilientFetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeoutAndRetry(
  url: string,
  init: RequestInit,
  opts: ResilientFetchOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 400;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt === maxRetries) {
        return res;
      }
      // Consume body to free connection before retrying
      await res.text().catch(() => '');
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 5_000)
          : baseDelayMs * Math.pow(2, attempt);
      await sleep(waitMs);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`External request failed after ${maxRetries + 1} attempts: ${msg.slice(0, 180)}`);
}
