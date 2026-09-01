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

// --- Google (preferred provider when GOOGLE_MAPS_API_KEY is set) -------------
// Enable BOTH "Geocoding API" and "Places API (New)" on the key in Google Cloud.
// When present it powers precise address geocoding and nearby place search;
// when absent everything transparently falls back to the free Nominatim/Photon
// stack below, so the app never hard-depends on it.
function googleKey() { return process.env.GOOGLE_MAPS_API_KEY || ''; }
function isGoogleEnabled() { return !!googleKey(); }

// Set once the Geocoding API has told us it will not serve this project, so we
// stop paying a round-trip to be refused on every single address.
//
// Measured against the live project: the key is refused with "You must enable
// Billing on the Google Cloud Project", which is a standing condition, not a
// transient one — 14 requests, 100% errors. Retrying it per lookup added
// latency to every pickup resolution and produced nothing but error-rate.
//
// Deliberately a runtime probe rather than a config flag: the day billing or
// the key restriction is fixed, a restart picks it up with no code change, and
// nothing has to remember to flip a switch.
let googleGeocodeDisabled = null; // null = untried, string = reason it is off

// Places Text Search is capped at 100 requests PER DAY on this project
// (quota_limit_value 100, quota_unit 1/d/{project}). That is a hard ceiling on
// how many distinct pickup addresses can be resolved accurately in a day,
// shared across every rider booking — and when it is gone, geocodeOne falls
// back to OpenStreetMap, which is the source measured 51.7m out on a live
// booking. Running out does not fail loudly; it quietly starts sending drivers
// to the wrong house.
//
// Two defences here. First, a cache, so the same address never costs twice —
// a rider retrying a booking, or a driver screen re-resolving, previously
// burned a fresh request every time. Second, exhaustion is recorded and
// reported rather than swallowed, so it can be seen instead of inferred from
// bad pickups.
let placesQuotaExhaustedAt = null;
const _placesCache = new Map();
const PLACES_TTL_MS = 24 * 60 * 60 * 1000; // an address does not move

async function googleGeocode(query) {
  const key = googleKey();
  if (!key) return null;
  if (googleGeocodeDisabled) return null;
  const params = new URLSearchParams({ address: query, key, region: 'us' });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (!res.ok) throw new Error(`google geocode ${res.status}`);
  const data = await res.json();
  // REQUEST_DENIED is a project/key condition, not a bad query: no address will
  // ever succeed until a human changes something in the Cloud Console. ZERO_RESULTS
  // and the like are per-query and must NOT disable the provider.
  if (data.status === 'REQUEST_DENIED') {
    googleGeocodeDisabled = data.error_message || 'REQUEST_DENIED';
    console.warn('[geocode] Geocoding API disabled for this project, using Places instead:', googleGeocodeDisabled.slice(0, 140));
    return null;
  }
  if (data.status !== 'OK' || !data.results || !data.results.length) return null;
  const r = data.results[0];
  const parts = r.formatted_address.split(',');
  return {
    label: parts[0],
    sublabel: parts.slice(1, 4).join(',').trim(),
    address: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  };
}

// Google Places "Text Search" (New API), biased to a point — the strongest way
// to turn "Publix" near a location into the actual nearest branch.
async function googleSearchNear(query, anchor, limit) {
  const key = googleKey();
  if (!key) return [];
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: 'US',
      maxResultCount: Math.min(limit || 6, 10),
      locationBias: { circle: { center: { latitude: anchor.lat, longitude: anchor.lng }, radius: 40000 } },
    }),
  });
  if (!res.ok) throw new Error(`google places ${res.status}`);
  const data = await res.json();
  return (data.places || []).map((p) => ({
    label: (p.displayName && p.displayName.text) || query,
    sublabel: '',
    address: p.formattedAddress || (p.displayName && p.displayName.text) || query,
    lat: p.location && p.location.latitude,
    lng: p.location && p.location.longitude,
  }));
}

// How precise is a coordinate, really?
//
// Every geocoder returns a lat/lng with the same number of decimal places
// whether it found the building or guessed the middle of the street. Carrying
// the distinction is the difference between routing a driver to a door and
// routing them to a block.
function precisionFromPlaceTypes(types = []) {
  const t = new Set(types);
  if (t.has('subpremise') || t.has('premise') || t.has('street_address')) return 'rooftop';
  if (t.has('route') || t.has('intersection')) return 'street';
  if (t.has('postal_code') || t.has('locality') || t.has('neighborhood')) return 'area';
  return 'unknown';
}

// Single-address resolution via Places Text Search.
//
// This exists because the Geocoding API is NOT enabled for this project — it
// returns REQUEST_DENIED, so googleGeocode() above has always resolved to null
// and every pickup silently fell through to OpenStreetMap. For US residential
// addresses that is a real accuracy problem, not a theoretical one: measured on
// a live booking, "5941 Deerfield Place" resolved 51.7m from where Places puts
// it — about the spacing between two houses on that street, and enough to send
// a driver to the wrong door.
//
// Places IS enabled, and is the same index Google Maps itself answers from —
// which also matters because the driver's "Open in Maps" fallback goes there.
async function googlePlacesGeocode(query) {
  const key = googleKey();
  if (!key) return null;

  const cacheKey = String(query).toLowerCase().trim();
  const hit = _placesCache.get(cacheKey);
  if (hit && Date.now() - hit.t < PLACES_TTL_MS) return hit.row;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.formattedAddress,places.shortFormattedAddress,places.location,places.types,places.displayName',
    },
    body: JSON.stringify({ textQuery: query, regionCode: 'US', maxResultCount: 1 }),
  });
  if (res.status === 429) {
    placesQuotaExhaustedAt = Date.now();
    console.error('[geocode] PLACES DAILY QUOTA EXHAUSTED — pickups will fall back to OpenStreetMap, '
      + 'which is measurably less accurate. Raise the SearchTextRequest per-day limit in Cloud Console.');
    throw new Error('google places geocode 429');
  }
  if (!res.ok) throw new Error(`google places geocode ${res.status}`);
  const pl = (await res.json())?.places?.[0];
  // A negative result is cached too. Without that, an address Places genuinely
  // cannot find costs a request on every single retry.
  if (!pl?.location) { _placesCache.set(cacheKey, { t: Date.now(), row: null }); return null; }
  const full = pl.formattedAddress || pl.shortFormattedAddress || query;
  const parts = full.split(',');
  const row = {
    label: parts[0].trim(),
    sublabel: parts.slice(1, 3).join(',').trim(),
    address: full,
    lat: pl.location.latitude,
    lng: pl.location.longitude,
    // Carried through so callers can tell a rooftop from a guess.
    precision: precisionFromPlaceTypes(pl.types),
    source: 'google_places',
  };
  _placesCache.set(cacheKey, { t: Date.now(), row });
  return row;
}

function normalizeNominatim(rows) {
  return rows.map((r) => ({
    label: r.name || r.display_name.split(',')[0],
    sublabel: r.display_name.split(',').slice(1, 4).join(',').trim(),
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    // OSM's own classification. 'house'/'building' is a mapped structure;
    // anything else is a street or an area, and should not be presented to a
    // driver as if it were a doorstep.
    precision: /^(house|building|residential)$/i.test(r.type || '') ? 'rooftop'
      : /^(road|residential|street)$/i.test(r.class || '') ? 'street' : 'unknown',
    source: 'osm_nominatim',
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
      precision: p.housenumber ? 'rooftop' : p.street ? 'street' : 'unknown',
      source: 'osm_photon',
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
  const MAX_MI = 80;
  const rank = (rows) => rows
    .map((r) => ({ ...r, miles: milesBetween(lat, lng, r.lat, r.lng) }))
    .filter((r) => Number.isFinite(r.miles) && r.miles <= MAX_MI)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);

  // Preferred: Google Places (best chain/POI coverage), biased to the anchor.
  if (isGoogleEnabled()) {
    try {
      const g = rank(await googleSearchNear(query, anchor, 10));
      if (g.length) return g;
    } catch (e) { console.warn('google places failed, falling back:', e.message); }
  }

  // Free fallback. Photon (point-biased) beats Nominatim for "nearest branch"
  // coverage, so try it first; Nominatim (box-bounded to the rider) backs it up.
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
  let rows = [];
  try { rows = await viaPhoton(); } catch { rows = []; }
  if (!rows.length) { try { rows = await viaNominatim(); } catch { rows = []; } }
  return rank(rows);
}

async function geocodeOne(query) {
  // Prefer Google for precise single-address resolution (pickup/dropoff, and the
  // anchor point for nearby place search); fall back to the free stack.
  if (isGoogleEnabled()) {
    // Geocoding API first — but it is NOT enabled for this project and returns
    // REQUEST_DENIED, so this has always yielded null. Kept because it is the
    // right call the day the API is switched on, and it costs one attempt.
    try { const g = await googleGeocode(query); if (g) return { ...g, precision: 'unknown', source: 'google_geocoding' }; }
    catch (e) { console.warn('google geocode failed, falling back:', e.message); }
    // Places IS enabled, and is what actually resolves addresses today.
    try { const p = await googlePlacesGeocode(query); if (p) return p; }
    catch (e) { console.warn('google places geocode failed, falling back:', e.message); }
  }
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

// Exposed so an operator can see WHY geocoding is running on Places without
// reading logs — and so a health check can report it.
function geocodeProviderStatus() {
  return {
    googleGeocodingDisabledReason: googleGeocodeDisabled,
    // Non-null means pickups are currently being resolved by OpenStreetMap and
    // are less accurate than they should be. Worth alerting on.
    placesQuotaExhaustedAt: placesQuotaExhaustedAt ? new Date(placesQuotaExhaustedAt).toISOString() : null,
    placesCacheSize: _placesCache.size,
  };
}

module.exports = { geocode, geocodeOne, reverseGeocode, searchNear, milesBetween, googleGeocode, googlePlacesGeocode, isGoogleEnabled, geocodeProviderStatus };
