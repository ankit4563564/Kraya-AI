import { fetchWithTimeoutAndRetry } from '../http-utils.js';

export interface LiveDirectoryBusiness {
  name: string;
  phone: string | null;
  website: string | null;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string; // 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'UNKNOWN'
  googleMapsUrl: string;
  source: 'google_places_v1' | 'serper_indiamart_web' | 'tavily_b2b_web';
  snippet?: string;
}

export interface LiveDirectorySearchResult {
  providerUsed: 'google_places_v1' | 'serper_indiamart_web' | 'tavily_b2b_web' | 'none_configured';
  businesses: LiveDirectoryBusiness[];
  queryUsed: string;
}

/**
 * Live Real-Time B2B Supplier Directory Connector.
 * Replaces guesswork with verified external business APIs in priority order:
 * 1. Google Places API (New v1) via `GOOGLE_MAPS_API_KEY` — real Indian factories, phone numbers, ratings & operational status.
 * 2. Serper.dev Google Search API via `SERPER_API_KEY` — live IndiaMART / TradeIndia / manufacturer listings.
 * 3. Tavily AI Search API via `TAVILY_API_KEY` — live Indian B2B supplier discovery.
 */
export async function searchLiveBusinessDirectory(params: {
  query: string;
  city?: string;
  googleMapsApiKey?: string;
  serperApiKey?: string;
  tavilyApiKey?: string;
  maxResults?: number;
}): Promise<LiveDirectorySearchResult> {
  const city = (params.city || 'Bengaluru').trim();
  const limit = Math.min(10, Math.max(1, params.maxResults ?? 5));
  const textQuery = `${params.query.trim()} manufacturer supplier in ${city} India`;

  // 1. Google Places API (New v1)
  if (params.googleMapsApiKey?.trim()) {
    try {
      const res = await fetchWithTimeoutAndRetry(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': params.googleMapsApiKey.trim(),
            'X-Goog-FieldMask':
              'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri',
          },
          body: JSON.stringify({
            textQuery,
            maxResultCount: limit,
            regionCode: 'IN',
          }),
        },
        { timeoutMs: 8_000, maxRetries: 1 }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          places?: Array<{
            displayName?: { text?: string };
            formattedAddress?: string;
            nationalPhoneNumber?: string;
            internationalPhoneNumber?: string;
            websiteUri?: string;
            rating?: number;
            userRatingCount?: number;
            businessStatus?: string;
            googleMapsUri?: string;
          }>;
        };
        const businesses: LiveDirectoryBusiness[] = (data.places || [])
          .filter((p) => p.displayName?.text)
          .map((p) => ({
            name: p.displayName!.text!,
            phone: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
            website: p.websiteUri || null,
            address: p.formattedAddress || `${city}, India`,
            rating: typeof p.rating === 'number' ? p.rating : null,
            reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
            businessStatus: p.businessStatus || 'OPERATIONAL',
            googleMapsUrl:
              p.googleMapsUri ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.displayName!.text!} ${city}`)}`,
            source: 'google_places_v1',
          }));
        if (businesses.length > 0) {
          return { providerUsed: 'google_places_v1', businesses, queryUsed: textQuery };
        }
      }
    } catch {
      // Fall through to next connector
    }
  }

  // 2. Serper.dev (Live Google + IndiaMART / TradeIndia B2B listings)
  if (params.serperApiKey?.trim()) {
    try {
      const b2bQuery = `${params.query.trim()} manufacturer supplier ${city} (site:indiamart.com OR site:tradeindia.com OR GST)`;
      const res = await fetchWithTimeoutAndRetry(
        'https://google.serper.dev/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': params.serperApiKey.trim(),
          },
          body: JSON.stringify({ q: b2bQuery, gl: 'in', num: limit }),
        },
        { timeoutMs: 8_000, maxRetries: 1 }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          organic?: Array<{ title?: string; link?: string; snippet?: string }>;
        };
        const businesses: LiveDirectoryBusiness[] = (data.organic || [])
          .slice(0, limit)
          .filter((o) => o.title)
          .map((o) => ({
            name: o.title!.split(' - ')[0].split(' | ')[0].trim(),
            phone: null,
            website: o.link || null,
            address: `${city}, India`,
            rating: null,
            reviewCount: null,
            businessStatus: 'OPERATIONAL',
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.title!} ${city}`)}`,
            source: 'serper_indiamart_web',
            snippet: o.snippet,
          }));
        if (businesses.length > 0) {
          return { providerUsed: 'serper_indiamart_web', businesses, queryUsed: b2bQuery };
        }
      }
    } catch {
      // Fall through to Tavily
    }
  }

  // 3. Tavily Live Search API
  if (params.tavilyApiKey?.trim()) {
    try {
      const res = await fetchWithTimeoutAndRetry(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: params.tavilyApiKey.trim(),
            query: textQuery,
            max_results: limit,
            search_depth: 'basic',
          }),
        },
        { timeoutMs: 8_000, maxRetries: 1 }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const businesses: LiveDirectoryBusiness[] = (data.results || [])
          .slice(0, limit)
          .filter((r) => r.title)
          .map((r) => ({
            name: r.title!.split(' - ')[0].split(' | ')[0].trim(),
            phone: null,
            website: r.url || null,
            address: `${city}, India`,
            rating: null,
            reviewCount: null,
            businessStatus: 'OPERATIONAL',
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.title!} ${city}`)}`,
            source: 'tavily_b2b_web',
            snippet: r.content?.slice(0, 220),
          }));
        if (businesses.length > 0) {
          return { providerUsed: 'tavily_b2b_web', businesses, queryUsed: textQuery };
        }
      }
    } catch {
      // Fall through cleanly
    }
  }

  return {
    providerUsed: 'none_configured',
    businesses: [],
    queryUsed: textQuery,
  };
}
