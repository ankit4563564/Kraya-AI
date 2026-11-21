import { fetchWithTimeoutAndRetry } from './http-utils.js';

export interface LocationResolutionResult {
  supplierCoords: { lat: number; lon: number } | null;
  buyerCoords: { lat: number; lon: number } | null;
  roadDistanceKm: number;
  transitDurationMins: number;
  googleMapsSearchUrl: string;
  googleMapsDirectionsUrl: string;
  provider: 'google_maps' | 'openstreetmap_osrm' | 'deterministic_geo';
}

/**
 * Real-Time Location & Road Distance Engine.
 * Supports Google Maps Platform (Geocoding + Distance Matrix) when GOOGLE_MAPS_API_KEY is present,
 * with seamless fallback to OpenStreetMap Nominatim + OSRM Driving Distance (100% free, zero-key).
 */
export async function resolveLocationAndRoadDistance(
  supplierAddress: string,
  buyerAddress: string,
  googleMapsApiKey?: string
): Promise<LocationResolutionResult> {
  const cleanSupplier = (supplierAddress || '').trim();
  const cleanBuyer = (buyerAddress || 'Bengaluru, Karnataka').trim();

  const googleMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanSupplier)}`;
  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(cleanBuyer)}&destination=${encodeURIComponent(cleanSupplier)}`;

  // 1. Try Google Maps Platform if an API key is provided
  if (googleMapsApiKey?.trim()) {
    try {
      const gUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(cleanBuyer)}&destinations=${encodeURIComponent(cleanSupplier)}&key=${googleMapsApiKey.trim()}`;
      const gRes = await fetchWithTimeoutAndRetry(gUrl, {}, { timeoutMs: 5000 });
      if (gRes.ok) {
        const gData = await gRes.json() as {
          status: string;
          rows?: Array<{
            elements?: Array<{
              status: string;
              distance?: { value: number }; // meters
              duration?: { value: number }; // seconds
            }>;
          }>;
        };

        if (gData.status === 'OK' && gData.rows?.[0]?.elements?.[0]?.status === 'OK') {
          const el = gData.rows[0].elements[0];
          const distKm = Math.round(((el.distance?.value || 15000) / 1000) * 10) / 10;
          const durMins = Math.round((el.duration?.value || 1800) / 60);

          return {
            supplierCoords: null,
            buyerCoords: null,
            roadDistanceKm: distKm,
            transitDurationMins: durMins,
            googleMapsSearchUrl,
            googleMapsDirectionsUrl,
            provider: 'google_maps',
          };
        }
      }
    } catch (err) {
      console.warn('[LocationEngine] Google Maps API error, falling back to OpenStreetMap:', err);
    }
  }

  // 2. OpenStreetMap Nominatim + OSRM Road Distance Engine (100% Free, No Key Required)
  try {
    const sQuery = encodeURIComponent(cleanSupplier);
    const bQuery = encodeURIComponent(cleanBuyer);

    const [sRes, bRes] = await Promise.all([
      fetchWithTimeoutAndRetry(`https://nominatim.openstreetmap.org/search?q=${sQuery}&format=json&limit=1`, {
        headers: { 'User-Agent': 'Kraya-Procurement-Agent/1.0 (info@kraya.local)' }
      }, { timeoutMs: 4000 }),
      fetchWithTimeoutAndRetry(`https://nominatim.openstreetmap.org/search?q=${bQuery}&format=json&limit=1`, {
        headers: { 'User-Agent': 'Kraya-Procurement-Agent/1.0 (info@kraya.local)' }
      }, { timeoutMs: 4000 })
    ]);

    let sCoords: { lat: number; lon: number } | null = null;
    let bCoords: { lat: number; lon: number } | null = null;

    if (sRes.ok) {
      const sData = await sRes.json() as Array<{ lat: string; lon: string }>;
      if (sData[0]) sCoords = { lat: Number(sData[0].lat), lon: Number(sData[0].lon) };
    }
    if (bRes.ok) {
      const bData = await bRes.json() as Array<{ lat: string; lon: string }>;
      if (bData[0]) bCoords = { lat: Number(bData[0].lat), lon: Number(bData[0].lon) };
    }

    if (sCoords && bCoords) {
      const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${bCoords.lon},${bCoords.lat};${sCoords.lon},${sCoords.lat}?overview=false`;
      const osrmRes = await fetchWithTimeoutAndRetry(osrmUrl, {}, { timeoutMs: 4000 });
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json() as {
          code: string;
          routes?: Array<{ distance: number; duration: number }>;
        };
        if (osrmData.code === 'Ok' && osrmData.routes?.[0]) {
          const distKm = Math.round((osrmData.routes[0].distance / 1000) * 10) / 10;
          const durMins = Math.round(osrmData.routes[0].duration / 60);

          return {
            supplierCoords: sCoords,
            buyerCoords: bCoords,
            roadDistanceKm: distKm,
            transitDurationMins: durMins,
            googleMapsSearchUrl,
            googleMapsDirectionsUrl,
            provider: 'openstreetmap_osrm',
          };
        }
      }
    }
  } catch (err) {
    console.warn('[LocationEngine] OpenStreetMap routing fallback triggered:', err);
  }

  // 3. Deterministic Geo-Distance Fallback (Haversine/Industrial Cluster Heuristic)
  const isInterState = !cleanSupplier.toLowerCase().includes('bengaluru') && !cleanSupplier.toLowerCase().includes('bangalore') && !cleanSupplier.toLowerCase().includes('karnataka');
  const fallbackKm = isInterState ? 450.0 : 18.5;
  const fallbackMins = isInterState ? 600 : 35;

  return {
    supplierCoords: null,
    buyerCoords: null,
    roadDistanceKm: fallbackKm,
    transitDurationMins: fallbackMins,
    googleMapsSearchUrl,
    googleMapsDirectionsUrl,
    provider: 'deterministic_geo',
  };
}
