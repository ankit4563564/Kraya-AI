import { fetchWithTimeoutAndRetry } from './http-utils.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
];

export function buildGeminiModelCandidates(preferred?: string): string[] {
  const list = [preferred?.trim(), ...GEMINI_FALLBACK_MODELS].filter(
    (m): m is string => Boolean(m)
  );
  return Array.from(new Set(list));
}

export interface LiveFxBenchmarks {
  usdInr: number;
  eurInr: number;
  cnyInr: number;
  source: 'live_open_er_api' | 'cached_live' | 'fallback_reference';
  fetchedAt: string;
}

export interface IndianRegulatoryClock {
  todayIso: string;
  financialYear: string; // e.g. "FY 2026-27"
  gstRegimePhase: 'gst_2_0_post_sept_2025';
  daysToMarch31TaxCliff: number;
  isMarch31MsmeRedZone: boolean; // Feb 1 - Mar 31 critical Section 43B(h) period
  daysToNextGstr1: number; // 11th of month
  daysToNextGstr2b: number; // 14th of month (IMS generation)
  daysToNextGstr3b: number; // 20th of month (tax payment & ITC offset)
  rbiBankRatePct: number;
  msme43bhPenaltyInterestPct: number; // 3x RBI Bank Rate compounded monthly
  eInvoiceTurnoverThresholdCrores: number; // ₹5 Cr
  tds194qThresholdLakhs: number; // ₹50 Lakh/FY
  activeAlerts: string[];
}

export interface RealTimeMarketContext {
  fx: LiveFxBenchmarks;
  regulatoryClock: IndianRegulatoryClock;
  fetchedAt: string;
}

let cachedFx: { data: LiveFxBenchmarks; expiresAt: number } | null = null;
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches live FX rates (USD/INR, EUR/INR, CNY/INR) from open.er-api.com (free, zero-key)
 * with 1-hour in-memory cache and non-blocking graceful fallback.
 */
export async function fetchLiveFxBenchmarks(skipNetwork = false): Promise<LiveFxBenchmarks> {
  const now = Date.now();
  if (cachedFx && cachedFx.expiresAt > now) {
    return { ...cachedFx.data, source: 'cached_live' };
  }

  if (!skipNetwork) {
    try {
      const res = await fetchWithTimeoutAndRetry(
        'https://open.er-api.com/v6/latest/USD',
        {},
        { timeoutMs: 3000, maxRetries: 1 }
      );
      if (res.ok) {
        const json = (await res.json()) as { rates?: Record<string, number> };
        const inr = json.rates?.INR;
        const eur = json.rates?.EUR;
        const cny = json.rates?.CNY;
        if (inr && Number.isFinite(inr)) {
          const data: LiveFxBenchmarks = {
            usdInr: Math.round(inr * 100) / 100,
            eurInr: eur ? Math.round((inr / eur) * 100) / 100 : Math.round(inr * 1.08 * 100) / 100,
            cnyInr: cny ? Math.round((inr / cny) * 100) / 100 : Math.round((inr / 7.2) * 100) / 100,
            source: 'live_open_er_api',
            fetchedAt: new Date(now).toISOString(),
          };
          cachedFx = { data, expiresAt: now + FX_CACHE_TTL_MS };
          return data;
        }
      }
    } catch {
      // Fall through to reference benchmark
    }
  }

  return {
    usdInr: 86.5,
    eurInr: 93.4,
    cnyInr: 11.95,
    source: 'fallback_reference',
    fetchedAt: new Date(now).toISOString(),
  };
}

function daysUntilNextDayOfMonth(now: Date, targetDay: number): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (d <= targetDay) return targetDay - d;
  const nextMonthDate = new Date(Date.UTC(y, m + 1, targetDay));
  return Math.max(0, Math.ceil((nextMonthDate.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Computes exact real-time Indian statutory procurement & GST calendar context.
 */
export function computeIndianRegulatoryClock(nowDate = new Date()): IndianRegulatoryClock {
  const year = nowDate.getUTCFullYear();
  const month = nowDate.getUTCMonth() + 1; // 1..12
  const todayIso = nowDate.toISOString().slice(0, 10);

  const fyStartYear = month >= 4 ? year : year - 1;
  const fyEndYearShort = String((fyStartYear + 1) % 100).padStart(2, '0');
  const financialYear = `FY ${fyStartYear}-${fyEndYearShort}`;

  const march31Year = month <= 3 ? year : year + 1;
  const march31Date = new Date(Date.UTC(march31Year, 2, 31, 23, 59, 59));
  const daysToMarch31TaxCliff = Math.max(
    0,
    Math.ceil((march31Date.getTime() - nowDate.getTime()) / 86_400_000)
  );
  const isMarch31MsmeRedZone = month === 2 || month === 3 || daysToMarch31TaxCliff <= 60;

  const daysToNextGstr1 = daysUntilNextDayOfMonth(nowDate, 11);
  const daysToNextGstr2b = daysUntilNextDayOfMonth(nowDate, 14);
  const daysToNextGstr3b = daysUntilNextDayOfMonth(nowDate, 20);

  const rbiBankRatePct = 6.75;
  const msme43bhPenaltyInterestPct = Math.round(rbiBankRatePct * 3 * 100) / 100; // 20.25% p.a. compounded monthly

  const activeAlerts: string[] = [];
  if (isMarch31MsmeRedZone) {
    activeAlerts.push(
      `MARCH 31 43B(h) RED ZONE (${daysToMarch31TaxCliff}d left): Any overdue Micro/Small MSME bill unpaid on Mar 31 is 100% disallowed as business expense (~30% tax hit + ${msme43bhPenaltyInterestPct}% compound interest).`
    );
  }
  if (daysToNextGstr2b <= 3) {
    activeAlerts.push(
      `GSTR-2B / IMS window opens in ${daysToNextGstr2b}d (14th): Reconcile disputed bills & mark REJECT/PENDING in GST IMS portal before GSTR-3B.`
    );
  }
  if (daysToNextGstr3b <= 4) {
    activeAlerts.push(
      `GSTR-3B filing due in ${daysToNextGstr3b}d (20th): Finalize ITC claims and GTA 5% RCM cash payments.`
    );
  }

  return {
    todayIso,
    financialYear,
    gstRegimePhase: 'gst_2_0_post_sept_2025',
    daysToMarch31TaxCliff,
    isMarch31MsmeRedZone,
    daysToNextGstr1,
    daysToNextGstr2b,
    daysToNextGstr3b,
    rbiBankRatePct,
    msme43bhPenaltyInterestPct,
    eInvoiceTurnoverThresholdCrores: 5,
    tds194qThresholdLakhs: 50,
    activeAlerts,
  };
}

export async function buildRealTimeMarketContext(opts?: {
  skipNetwork?: boolean;
  now?: Date;
}): Promise<RealTimeMarketContext> {
  const [fx, regulatoryClock] = await Promise.all([
    fetchLiveFxBenchmarks(opts?.skipNetwork),
    Promise.resolve(computeIndianRegulatoryClock(opts?.now)),
  ]);
  return {
    fx,
    regulatoryClock,
    fetchedAt: new Date().toISOString(),
  };
}

export interface GeminiBrainCallOptions {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  enableGoogleSearchGrounding?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export interface GeminiBrainResponse<T = Record<string, unknown>> {
  parsed: T;
  groundingSources: Array<{ title: string; uri: string }>;
  modelUsed: string;
}

/**
 * Shared neuro-symbolic LLM reasoning caller for specialist agents.
 * Supports optional live Google Search Grounding (`google_search` tool) for real-time market intelligence.
 * Never throws ungracefully when callers wrap in fallback; strictly parses structured JSON.
 */
export async function callGeminiAgentBrain<T = Record<string, unknown>>(
  opts: GeminiBrainCallOptions
): Promise<GeminiBrainResponse<T>> {
  const candidates = buildGeminiModelCandidates(opts.model);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      ...(opts.enableGoogleSearchGrounding ? {} : { responseMimeType: 'application/json' }),
    },
  };

  if (opts.enableGoogleSearchGrounding) {
    body.tools = [{ google_search: {} }];
  }

  let res: Response | null = null;
  let model = candidates[0];
  let lastErr = '';

  for (const candidateModel of candidates) {
    model = candidateModel;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
    try {
      const attempt = await fetchWithTimeoutAndRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        { timeoutMs: opts.timeoutMs ?? 12_000, maxRetries: 1 }
      );
      if (attempt.ok) {
        res = attempt;
        break;
      }
      lastErr = await attempt.text().catch(() => '');
      if (![404, 429, 503].includes(attempt.status)) {
        throw new Error(`Gemini Agent Brain error (${attempt.status}): ${lastErr.slice(0, 240)}`);
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (lastErr.startsWith('Gemini Agent Brain error (')) throw err;
    }
  }

  if (!res) {
    const procEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const gatewayUrl = procEnv?.NEON_AI_GATEWAY_BASE_URL;
    const gatewayToken = procEnv?.NEON_AI_GATEWAY_TOKEN;
    if (gatewayUrl && gatewayToken) {
      try {
        const gwAttempt = await fetchWithTimeoutAndRetry(
          `${gatewayUrl.replace(/\/$/, '')}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${gatewayToken}`,
            },
            body: JSON.stringify({
              model: 'gemini-3-flash',
              messages: [
                { role: 'system', content: opts.systemPrompt },
                { role: 'user', content: opts.userPrompt },
              ],
              temperature: opts.temperature ?? 0.2,
            }),
          },
          { timeoutMs: opts.timeoutMs ?? 12_000, maxRetries: 1 }
        );
        if (gwAttempt.ok) {
          const gwData = (await gwAttempt.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            model?: string;
          };
          const gwText = gwData.choices?.[0]?.message?.content || '';
          let jsonStr = gwText.trim();
          const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
          if (fenced?.[1]) {
            jsonStr = fenced[1].trim();
          } else {
            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
              jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
            }
          }
          return {
            parsed: JSON.parse(jsonStr) as T,
            groundingSources: [],
            modelUsed: gwData.model || 'neon-ai-gateway/gemini-3-flash',
          };
        }
      } catch {
        // Proceed to throw primary error below
      }
    }
    throw new Error(`Gemini Agent Brain unavailable across models [${candidates.join(', ')}]: ${lastErr.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };

  const candidate = data.candidates?.[0];
  const rawText = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!rawText.trim()) {
    throw new Error('Gemini Agent Brain returned empty content.');
  }

  // Extract JSON safely even if wrapped in markdown fences (common when google_search tool is enabled)
  let jsonStr = rawText.trim();
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    jsonStr = fenced[1].trim();
  } else {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  const parsed = JSON.parse(jsonStr) as T;
  const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const groundingSources = groundingChunks
    .filter((c) => c.web?.uri)
    .map((c) => ({
      title: c.web?.title || 'Live Web Source',
      uri: c.web?.uri || '',
    }));

  return {
    parsed,
    groundingSources,
    modelUsed: model,
  };
}
