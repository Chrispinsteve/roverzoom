// Server-side forward geocoding.
//
// Primary: OpenStreetMap Nominatim (no key). Nominatim is STRICT — it requires
// a descriptive User-Agent with real contact info and throttles to <=1 req/sec.
// A generic UA gets 403s. If Nominatim fails, we fall back to the Photon
// geocoder (also free, no key) so address search never hard-fails.
//
// For production scale, self-host Nominatim or use a paid geocoder (Mapbox,
// Google, LocationIQ) — set it here and the rest of the app is unchanged.

// IMPORTANT: put a real contact email/URL here. Nominatim's usage policy
// requires it, and a vague UA is a common cause of 403 responses.
const USER_AGENT = 'RoverZoom/1.0 (https://roverzoom.com; support@roverzoom.com)';

function normalizeNominatim(rows) {
  return rows.map((r) => ({
    label: r.name || r.display_name.split(',')[0],
    sublabel: r.display_name.split(',').slice(1, 4).join(',').trim(),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

function normalizePhoton(features) {
  return features.map((f) => {
    const p = f.properties || {};
    const [lng, lat] = f.geometry.coordinates;
    const line = [p.name, p.street, p.city, p.state].filter(Boolean).join(', ');
    return {
      label: p.name || p.street || p.city || 'Location',
      sublabel: [p.city, p.state, p.country].filter(Boolean).join(', '),
      address: line || p.name || 'Location',
      lat,
      lng,
    };
  });
}

async function tryNominatim(query, limit) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
    countrycodes: 'us',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return normalizeNominatim(await res.json());
}

async function tryPhoton(query, limit) {
  const params = new URLSearchParams({ q: query, limit: String(limit), lang: 'en' });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = await res.json();
  return normalizePhoton(data.features || []);
}

// Small in-memory cache: the assistant often geocodes the same pickup/dropoff
// several times in one booking (find_place, then get_quote, then create_booking),
// so this cuts redundant calls — faster, and gentler on Nominatim's rate limit.
const _geoCache = new Map();
const GEO_TTL_MS = 10 * 60 * 1000;

async function geocode(query, limit = 5) {
  if (!query || query.trim().length < 3) return [];
  const key = `${limit}|${query.toLowerCase().trim()}`;
  const hit = _geoCache.get(key);
  if (hit && Date.now() - hit.t < GEO_TTL_MS) return hit.rows;
  const rows = await geocodeUncached(query, limit);
  _geoCache.set(key, { t: Date.now(), rows });
  return rows;
}

async function geocodeUncached(query, limit) {
  // Try Nominatim first; on any failure, fall back to Photon.
  try {
    const rows = await tryNominatim(query, limit);
    if (rows.length) return rows;
    // empty result — try the fallback too
    return await tryPhoton(query, limit);
  } catch (primaryErr) {
    console.warn('geocode primary failed, trying fallback:', primaryErr.message);
    try {
      return await tryPhoton(query, limit);
    } catch (fallbackErr) {
      console.error('geocode fallback also failed:', fallbackErr.message);
      // Signal a soft failure — the route returns [] and the UI lets the
      // user type a plain address and continue anyway.
      const e = new Error('GEOCODE_UNAVAILABLE');
      e.code = 'GEOCODE_UNAVAILABLE';
      throw e;
    }
  }
}

// Great-circle distance in miles between two lat/lng points.
function milesBetween(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Proximity place search: places matching `query` NEAR an anchor point, sorted
// nearest-first and hard-capped to a radius so a same-name business in another
// city can never win (the "Publix in Tampa for a rider in Lantana" bug). Tries
// Nominatim bounded to a box around the anchor, then Photon biased to the point;
// both results are distance-filtered.
async function searchNear(query, anchor, limit = 6) {
  if (!query || !anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return [];
  const { lat, lng } = anchor;
  const dLat = 0.6, dLng = 0.7; // ~40-mile box around the rider
  const viewbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;

  const viaNominatim = async () => {
    const params = new URLSearchParams({
      q: query, format: 'json', addressdetails: '1', limit: '10',
      countrycodes: 'us', viewbox, bounded: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return normalizeNominatim(await res.json());
  };
  const viaPhoton = async () => {
    const params = new URLSearchParams({ q: query, limit: '15', lang: 'en', lat: String(lat), lon: String(lng) });
    const res = await fetch(`https://photon.komoot.io/api/?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    return normalizePhoton((await res.json()).features || []);
  };

  // Photon (point-biased) has far better chain/POI coverage than Nominatim for
  // "nearest branch" lookups, so try it first; Nominatim (box-bounded) backs it up.
  let rows = [];
  try { rows = await viaPhoton(); } catch { rows = []; }
  if (!rows.length) { try { rows = await viaNominatim(); } catch { rows = []; } }

  const MAX_MI = 80;
  return rows
    .map((r) => ({ ...r, miles: milesBetween(lat, lng, r.lat, r.lng) }))
    .filter((r) => Number.isFinite(r.miles) && r.miles <= MAX_MI)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);
}

async function geocodeOne(query) {
  const results = await geocode(query, 1).catch(() => []);
  return results[0] || null;
}

// Reverse geocode: coordinates -> a human address. Powers the kiosk's
// "This trip" GPS pickup button. Same Nominatim provider as forward search.
async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lng), format: 'json', zoom: '18', addressdetails: '1',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`Nominatim reverse ${res.status}`);
  const data = await res.json();
  if (!data || data.error) return null;
  return {
    address: data.display_name,
    lat: Number(data.lat),
    lng: Number(data.lon),
  };
}

module.exports = { geocode, geocodeOne, reverseGeocode, searchNear, milesBetween };
