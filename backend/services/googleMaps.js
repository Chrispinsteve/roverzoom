// ============================================================
// Google Maps Platform — server side
// ============================================================
// Everything in this file runs on the SERVER and uses
// GOOGLE_MAPS_API_KEY, which is a DIFFERENT key from the browser's
// VITE_GOOGLE_MAPS_API_KEY.
//
// This is not belt-and-braces, it is a hard requirement. A browser key
// is locked down with an HTTP-referrer restriction; server-to-server
// calls send no Referer header, so Google rejects them with
// REQUEST_DENIED. Conversely a server key restricted by IP cannot be
// used from a browser. One key cannot carry both restriction types.
// See ENV_SETUP.md for how to provision the pair.
//
// Design notes:
//   * Every function degrades instead of throwing. A dead routing API
//     must never take down the booking flow — the fare falls back to
//     the straight-line estimate and the rider still books a car.
//   * Routing tries Routes API, then legacy Directions API, then gives
//     up. Which of the two a given Google Cloud project has enabled
//     varies, and silently falling through to a straight-line guess
//     because the wrong one was switched on is a very expensive kind of
//     "working".
//   * Autocomplete uses session tokens. Without them Google bills every
//     keystroke as a standalone request; with them, an entire typing
//     session plus the final Place Details lookup bills as one.
// ============================================================

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const REGION = process.env.GOOGLE_MAPS_REGION || 'us';

// Bias suggestions and routing toward the service area so "Main St"
// resolves to a Florida address rather than one 1,200 miles away.
const BIAS_LAT = Number(process.env.SERVICE_AREA_LAT) || 26.7153;   // West Palm Beach
const BIAS_LNG = Number(process.env.SERVICE_AREA_LNG) || -80.0534;
const BIAS_RADIUS_M = Number(process.env.SERVICE_AREA_RADIUS_M) || 120000; // ~75 mi

const isConfigured = () => API_KEY.length > 10;

// ------------------------------------------------------------
// Tiny TTL cache
//
// Caveat for Vercel: each serverless invocation may get a cold process,
// so this cache helps within a warm instance and does nothing across
// cold starts. It is a cost optimization, not a correctness mechanism.
// The durable cache for route geometry is the bookings.route_* columns.
// ------------------------------------------------------------
const cache = new Map();
const CACHE_MAX = 500;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  // Cheap bound: drop the oldest entry once full. Map preserves
  // insertion order, so the first key is the oldest.
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

// Rounding coordinates to ~11m before using them as a cache key means two
// riders standing on the same corner share one routing result instead of
// billing two. 4 decimal places is the sweet spot: tight enough that the
// route is genuinely the same, loose enough to actually get hits.
const coordKey = (p) => `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`;

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  // AbortController rather than a bare fetch: a hung Google request
  // would otherwise hold the booking request open until the platform's
  // own timeout kills it, turning a slow dependency into a failed
  // booking rather than a degraded one.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error?.message || body?.error_message || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// ROUTING
// ============================================================

/**
 * Real driving route between two points.
 *
 * Returns { distanceMeters, durationSeconds, polyline, source } or null
 * if routing is unavailable — callers must handle null and fall back.
 *
 * departureTime (ISO string, optional) enables traffic-aware duration.
 * For a scheduled-ride product this is the whole point: a 9am airport
 * run and a 2pm airport run are not the same trip, and quoting them
 * identically is how you end up underpaying drivers on rush-hour rides.
 */
async function getRoute(origin, destination, departureTime = null) {
  if (!isConfigured()) return null;
  if (origin?.lat == null || destination?.lat == null) return null;

  // Bucket the departure time to the hour for caching. Traffic
  // predictions do not meaningfully differ minute to minute, and an
  // unbucketed timestamp would make every cache key unique.
  const hourBucket = departureTime
    ? new Date(departureTime).toISOString().slice(0, 13)
    : 'now';
  const key = `route:${coordKey(origin)}:${coordKey(destination)}:${hourBucket}`;

  const cached = cacheGet(key);
  if (cached) return cached;

  let result = null;
  try {
    result = await routesApi(origin, destination, departureTime);
  } catch (err) {
    console.warn('[googleMaps] Routes API failed:', err.message);
    try {
      result = await directionsApi(origin, destination, departureTime);
    } catch (fallbackErr) {
      console.warn('[googleMaps] Directions API also failed:', fallbackErr.message);
      return null;
    }
  }

  if (result) cacheSet(key, result, 30 * 60 * 1000); // 30 min
  return result;
}

// --- Routes API (current generation) ---
async function routesApi(origin, destination, departureTime) {
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: 'DRIVE',
    polylineQuality: 'HIGH_QUALITY',
    languageCode: 'en-US',
    units: 'IMPERIAL',
  };

  // TRAFFIC_AWARE_OPTIMAL is the most accurate tier but also the
  // slowest and priciest; TRAFFIC_AWARE is the right trade for a quote
  // that a human is waiting on. Google rejects a departureTime in the
  // past, so only send it when it is genuinely in the future — a rider
  // booking a ride for "now" gets live traffic instead.
  const departsInFuture = departureTime && new Date(departureTime).getTime() > Date.now() + 60000;
  if (departsInFuture) {
    body.routingPreference = 'TRAFFIC_AWARE';
    body.departureTime = new Date(departureTime).toISOString();
  } else {
    body.routingPreference = 'TRAFFIC_AWARE';
  }

  const data = await fetchJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      // The field mask is mandatory on the Routes API and it is also a
      // billing control: requesting only these three fields keeps the
      // call in the cheaper Essentials tier rather than pulling the full
      // turn-by-turn payload we have no use for server-side.
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify(body),
  });

  const route = data?.routes?.[0];
  if (!route) return null;

  return {
    distanceMeters: route.distanceMeters ?? null,
    // Routes API returns duration as a protobuf duration string: "1234s".
    durationSeconds: route.duration ? parseInt(String(route.duration).replace('s', ''), 10) : null,
    polyline: route.polyline?.encodedPolyline || null,
    source: 'google',
  };
}

// --- Legacy Directions API (fallback) ---
async function directionsApi(origin, destination, departureTime) {
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: 'driving',
    region: REGION,
    key: API_KEY,
  });

  const departsInFuture = departureTime && new Date(departureTime).getTime() > Date.now() + 60000;
  // departure_time is what unlocks duration_in_traffic. Unix seconds.
  params.set('departure_time', departsInFuture
    ? String(Math.floor(new Date(departureTime).getTime() / 1000))
    : 'now');

  const data = await fetchJson(`https://maps.googleapis.com/maps/api/directions/json?${params}`);

  // The Directions API returns HTTP 200 even when it has failed; the
  // real outcome lives in the status field, so it must be checked
  // explicitly or a REQUEST_DENIED reads as success with no routes.
  if (data.status !== 'OK') throw new Error(data.status || 'DIRECTIONS_FAILED');

  const leg = data.routes?.[0]?.legs?.[0];
  if (!leg) return null;

  return {
    distanceMeters: leg.distance?.value ?? null,
    // Prefer the traffic-adjusted figure when Google supplies it.
    durationSeconds: leg.duration_in_traffic?.value ?? leg.duration?.value ?? null,
    polyline: data.routes[0].overview_polyline?.points || null,
    source: 'google',
  };
}

// ============================================================
// PLACES AUTOCOMPLETE  (Places API (New))
// ============================================================
// These call places.googleapis.com/v1, NOT the older
// maps.googleapis.com/maps/api/place/* endpoints.
//
// That is not a style preference. Google moved the old service to
// "Places API (Legacy)" and it CAN NO LONGER BE ENABLED ON NEW CLOUD
// PROJECTS. Code written against the legacy endpoints works only on
// projects that already had it switched on before the cutoff, and fails
// with REQUEST_DENIED everywhere else. Since RoverZoom may well get a
// fresh project, the legacy path is not a safe thing to depend on.
//
// Practical differences from the legacy API:
//   * POST with a JSON body, not GET with query parameters
//   * Key goes in the X-Goog-Api-Key header, not a `key` parameter
//   * Responses use camelCase and carry no top-level `status` field —
//     failures are real HTTP error codes
//   * Place Details requires an explicit field mask
// ============================================================

/**
 * Address suggestions for a partial query.
 *
 * sessionToken must be a stable client-generated UUID that persists
 * across every keystroke of one address entry and is then passed to
 * getPlaceDetails() for the pick. That grouping is what collapses a
 * whole typing session plus the final details lookup into one billable
 * unit. Get it wrong and the bill scales with typing speed.
 */
async function autocomplete(query, sessionToken) {
  if (!isConfigured()) return null;
  if (!query || query.trim().length < 3) return [];

  const body = {
    input: query,
    includedRegionCodes: [REGION],
    languageCode: 'en',
    locationBias: {
      circle: {
        center: { latitude: BIAS_LAT, longitude: BIAS_LNG },
        radius: BIAS_RADIUS_M,
      },
    },
  };
  if (sessionToken) body.sessionToken = sessionToken;

  const data = await fetchJson('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  // An empty response object is how Autocomplete (New) says "no
  // matches" — there is no ZERO_RESULTS status to check.
  const suggestions = data?.suggestions || [];

  // Shaped to match the existing /api/geocode contract that
  // AddressInput.jsx already consumes, with one addition: placeId, and
  // lat/lng left null. Autocomplete returns no coordinates — they cost
  // a second call, so they are fetched only for the one suggestion the
  // rider actually picks, not for all five shown.
  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction;
      return {
        label: p.structuredFormat?.mainText?.text || p.text?.text || '',
        sublabel: p.structuredFormat?.secondaryText?.text || '',
        address: p.text?.text || p.structuredFormat?.mainText?.text || '',
        placeId: p.placeId,
        lat: null,
        lng: null,
      };
    });
}

/**
 * Resolve a placeId from autocomplete() into real coordinates.
 * Pass the same sessionToken used for the autocomplete keystrokes.
 */
async function getPlaceDetails(placeId, sessionToken) {
  if (!isConfigured() || !placeId) return null;

  const params = new URLSearchParams({ languageCode: 'en' });
  if (sessionToken) params.set('sessionToken', sessionToken);

  // The field mask is mandatory here, and it also selects the BILLING
  // TIER. id / formattedAddress / location / displayName are all
  // Place Details Essentials fields. Adding anything richer — rating,
  // reviews, opening hours, photos — silently promotes the same call to
  // the Pro or Enterprise SKU at several times the price. A pickup
  // point needs coordinates and a label and nothing else, so the mask
  // stays deliberately narrow.
  const data = await fetchJson(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${params}`,
    {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'id,formattedAddress,location,displayName',
      },
    }
  );

  const loc = data?.location;
  if (!loc || loc.latitude == null) return null;

  return {
    address: data.formattedAddress || data.displayName?.text || '',
    lat: loc.latitude,
    lng: loc.longitude,
  };
}

// ============================================================
// GEOCODING
// ============================================================

/** Free-text address -> coordinates. Used by the AI booking flow. */
async function geocodeAddress(address) {
  if (!isConfigured() || !address) return null;

  const key = `geo:${address.toLowerCase().trim()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    address,
    key: API_KEY,
    region: REGION,
    // A viewport bias, unlike components=country, is a soft preference —
    // it favours local matches without making an out-of-area address
    // impossible to book.
    bounds: `${BIAS_LAT - 1.5},${BIAS_LNG - 1.5}|${BIAS_LAT + 1.5},${BIAS_LNG + 1.5}`,
  });

  const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') throw new Error(data.status || 'GEOCODE_FAILED');

  const r = data.results?.[0];
  if (!r) return null;

  const out = {
    label: r.address_components?.[0]?.long_name || r.formatted_address.split(',')[0],
    sublabel: r.formatted_address.split(',').slice(1, 4).join(',').trim(),
    address: r.formatted_address,
    placeId: r.place_id,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  };

  cacheSet(key, out, 24 * 60 * 60 * 1000); // addresses are stable; cache a day
  return out;
}

/** Coordinates -> street address. Used to label a driver's live position. */
async function reverseGeocode(lat, lng) {
  if (!isConfigured() || lat == null || lng == null) return null;

  const key = `rev:${coordKey({ lat, lng })}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: API_KEY,
    result_type: 'street_address|route|premise',
  });

  try {
    const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (data.status !== 'OK') return null;
    const address = data.results?.[0]?.formatted_address || null;
    if (address) cacheSet(key, address, 60 * 60 * 1000);
    return address;
  } catch (err) {
    console.warn('[googleMaps] reverse geocode failed:', err.message);
    return null;
  }
}

module.exports = {
  isConfigured,
  getRoute,
  autocomplete,
  getPlaceDetails,
  geocodeAddress,
  reverseGeocode,
};
