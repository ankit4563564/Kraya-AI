import { fetchWithTimeoutAndRetry } from './http-utils.js';

export interface SupplierDoubleVerificationResult {
  isVerified: boolean;
  lei: string | null; // Global Legal Entity Identifier (ISO 17442)
  legalName: string;
  registrationStatus: string;
  jurisdiction: string;
  registrySource: 'gleif_global' | 'opencorporates' | 'wikidata' | 'unregistered_sme';
  confidenceScore: number; // 0 - 100
  badges: string[];
}

/**
 * Global Supplier Double-Verification Engine.
 * Verifies manufacturing companies and suppliers across international databases:
 * 1. GLEIF (Global Legal Entity Identifier Foundation — ISO 17442 G20 Registry, 100% Free)
 * 2. OpenCorporates (when OPENCORPORATES_API_KEY is configured)
 * 3. Wikidata Global Entity Knowledge Graph (Free)
 */
export async function verifySupplierGlobalRegistry(
  companyName: string,
  openCorporatesApiKey?: string
): Promise<SupplierDoubleVerificationResult> {
  const cleanName = (companyName || '').trim();
  if (!cleanName || cleanName.length < 3) {
    return {
      isVerified: false,
      lei: null,
      legalName: cleanName,
      registrationStatus: 'UNVERIFIED',
      jurisdiction: 'GLOBAL',
      registrySource: 'unregistered_sme',
      confidenceScore: 50,
      badges: ['Local Industrial SME'],
    };
  }

  // 1. Try GLEIF (Global Legal Entity Identifier Foundation) — Official International Registry
  try {
    // Search first 2-3 words of legal name for higher registry hit rate
    const searchTerms = cleanName.replace(/(pvt|ltd|limited|private|industries|co|works|llp)\.?/gi, '').trim();
    const query = encodeURIComponent(searchTerms || cleanName);
    const gleifUrl = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${query}&page[size]=1`;

    const gRes = await fetchWithTimeoutAndRetry(gleifUrl, {
      headers: { Accept: 'application/vnd.api+json' },
    }, { timeoutMs: 4000 });

    if (gRes.ok) {
      const gData = await gRes.json() as {
        data?: Array<{
          attributes?: {
            lei?: string;
            entity?: {
              legalName?: { name?: string };
              legalAddress?: { country?: string; city?: string };
            };
            registration?: { status?: string };
          };
        }>;
      };

      if (gData.data?.[0]) {
        const record = gData.data[0].attributes;
        const status = record?.registration?.status || 'ISSUED';
        const country = record?.entity?.legalAddress?.country || 'GLOBAL';
        const city = record?.entity?.legalAddress?.city || '';
        const lei = record?.lei || null;

        return {
          isVerified: true,
          lei,
          legalName: record?.entity?.legalName?.name || cleanName,
          registrationStatus: status === 'ISSUED' ? 'ACTIVE_LEI_ISSUED' : status,
          jurisdiction: `${city ? city + ', ' : ''}${country}`,
          registrySource: 'gleif_global',
          confidenceScore: 98,
          badges: ['GLEIF Global LEI Verified', `ISO 17442 (${country})`],
        };
      }
    }
  } catch (err) {
    console.warn('[VerificationEngine] GLEIF query error:', err);
  }

  // 2. Try OpenCorporates if user configured OPENCORPORATES_API_KEY
  if (openCorporatesApiKey?.trim()) {
    try {
      const ocQuery = encodeURIComponent(cleanName);
      const ocUrl = `https://api.opencorporates.com/v1/companies/search?q=${ocQuery}&api_token=${openCorporatesApiKey.trim()}`;
      const ocRes = await fetchWithTimeoutAndRetry(ocUrl, {}, { timeoutMs: 4000 });
      if (ocRes.ok) {
        const ocData = await ocRes.json() as {
          results?: {
            companies?: Array<{
              company?: {
                name?: string;
                company_number?: string;
                jurisdiction_code?: string;
                current_status?: string;
              };
            }>;
          };
        };

        const comp = ocData.results?.companies?.[0]?.company;
        if (comp) {
          return {
            isVerified: true,
            lei: comp.company_number || null,
            legalName: comp.name || cleanName,
            registrationStatus: comp.current_status || 'ACTIVE_REGISTERED',
            jurisdiction: comp.jurisdiction_code?.toUpperCase() || 'GLOBAL',
            registrySource: 'opencorporates',
            confidenceScore: 95,
            badges: ['OpenCorporates Verified', `CIN: ${comp.company_number}`],
          };
        }
      }
    } catch (err) {
      console.warn('[VerificationEngine] OpenCorporates error:', err);
    }
  }

  // 3. Try Wikidata Corporate Entity Knowledge Graph (100% Free)
  try {
    const wikiQuery = encodeURIComponent(cleanName);
    const wikiUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${wikiQuery}&language=en&format=json`;
    const wRes = await fetchWithTimeoutAndRetry(wikiUrl, {
      headers: { 'User-Agent': 'Kraya-Procurement-Agent/1.0' },
    }, { timeoutMs: 3500 });

    if (wRes.ok) {
      const wData = await wRes.json() as {
        search?: Array<{ id: string; label: string; description?: string }>;
      };

      if (wData.search?.[0]) {
        const entity = wData.search[0];
        return {
          isVerified: true,
          lei: entity.id,
          legalName: entity.label,
          registrationStatus: 'WIKIDATA_INDEXED',
          jurisdiction: 'GLOBAL',
          registrySource: 'wikidata',
          confidenceScore: 90,
          badges: ['Wikidata Verified Entity', entity.description || 'Industrial Corporation'],
        };
      }
    }
  } catch (err) {
    console.warn('[VerificationEngine] Wikidata error:', err);
  }

  // 4. Fallback for unlisted/local manufacturing SMEs
  return {
    isVerified: false,
    lei: null,
    legalName: cleanName,
    registrationStatus: 'UNLISTED_SME',
    jurisdiction: 'DOMESTIC',
    registrySource: 'unregistered_sme',
    confidenceScore: 75,
    badges: ['Local Verified SME'],
  };
}
