// ============================================================
// Address search — Google first, free providers as fallback
// ============================================================
// Provider order, and why:
//
//   1. Google Places Autocomplete  (needs GOOGLE_MAPS_API_KEY)
//   2. OpenStreetMap Nominatim     (free, no key)
//   3. Photon                      (free, no key)
//
// Google leads because address quality is not a nice-to-have in a ride
// product — it is the difference between a car arriving and a car not
// arriving. Nominatim is genuinely good at named places and full street
// addresses but weak at exactly the inputs riders actually type:
// partial addresses, business names, airport terminals, apartment
// complexes. It also has no real autocomplete; it matches whole strings.
//
// The free providers stay wired up as fallback rather than being
// deleted, because they cost nothing and they mean an expired card on
// the Google Cloud account degrades address search instead of breaking
// booking entirely.
//
// Nominatim is STRICT: it requires a descriptive User-Agent with real
// contact info and throttles to <=1 req/sec. A generic UA gets 403s.
// ============================================================

const google = require('./googleMaps');

// IMPORTANT: keep a real contact email/URL here. Nominatim's usage
// policy requires it, and a vague UA is a common cause of 403 responses.
const USER_AGENT = 'RoverZoom/1.0 (https://roverzoom.com; support@roverzoom.com)';

function normalizeNominatim(rows) {
  return rows.map((r) => ({
    label: r.name || r.display_name.split(',')[0],
    sublabel: r.display_name.split(',').slice(1, 4).join(',').trim(),
    address: r.display_name,
    placeId: null,
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
      placeId: null,
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

/**
 * Address suggestions for a partial query.
 *
 * Google results come back WITHOUT coordinates (lat/lng null) and WITH a
 * placeId. That is deliberate, not an omission: Places Autocomplete does
 * not return coordinates, and fetching them for all five suggestions
 * would mean five Place Details calls to display a dropdown the rider
 * will pick one row from. The caller resolves coordinates for the single
 * chosen row via resolvePlace() instead.
 *
 * Fallback-provider results DO include coordinates inline, since those
 * APIs return them for free. Callers must therefore handle both shapes —
 * see routes/quote.js.
 *
 * @param {string} query
 * @param {number} limit
 * @param {string=} sessionToken groups keystrokes into one billable session
 */
async function geocode(query, limit = 5, sessionToken = null) {
  if (!query || query.trim().length < 3) return [];

  if (google.isConfigured()) {
    try {
      const rows = await google.autocomplete(query, sessionToken);
      if (rows && rows.length) return rows.slice(0, limit);
      // An empty Google result for a US query usually means the input is
      // genuinely unresolvable rather than that Google is broken, but the
      // free providers occasionally catch obscure POIs Google misses, so
      // fall through rather than returning [] immediately.
    } catch (err) {
      console.warn('[geocode] Google autocomplete failed, falling back:', err.message);
    }
  }

  try {
    const rows = await tryNominatim(query, limit);
    if (rows.length) return rows;
    return await tryPhoton(query, limit);
  } catch (primaryErr) {
    console.warn('[geocode] Nominatim failed, trying Photon:', primaryErr.message);
    try {
      return await tryPhoton(query, limit);
    } catch (fallbackErr) {
      console.error('[geocode] all providers failed:', fallbackErr.message);
      // Signal a soft failure — the route returns [] and the UI lets the
      // user type a plain address and continue anyway.
      const e = new Error('GEOCODE_UNAVAILABLE');
      e.code = 'GEOCODE_UNAVAILABLE';
      throw e;
    }
  }
}

/**
 * Turn a suggestion the rider picked into a definite { address, lat, lng }.
 *
 * Handles both suggestion shapes: a Google row (placeId, no coords) needs
 * a Place Details lookup; a fallback-provider row already carries coords
 * and passes straight through.
 */
async function resolvePlace(pick, sessionToken = null) {
  if (!pick) return null;
  if (pick.lat != null && pick.lng != null) {
    return { address: pick.address, lat: pick.lat, lng: pick.lng };
  }
  if (pick.placeId && google.isConfigured()) {
    try {
      return await google.getPlaceDetails(pick.placeId, sessionToken);
    } catch (err) {
      console.warn('[geocode] place details failed:', err.message);
    }
  }
  return null;
}

/**
 * Single best coordinate match for a free-text address.
 * Used by the AI booking flow, where there is no dropdown to pick from.
 */
async function geocodeOne(query) {
  if (google.isConfigured()) {
    try {
      // Full Geocoding (not Autocomplete) is right here: it resolves a
      // complete address string directly to coordinates in one call,
      // with no place_id round trip.
      const hit = await google.geocodeAddress(query);
      if (hit) return hit;
    } catch (err) {
      console.warn('[geocode] Google geocode failed, falling back:', err.message);
    }
  }
  const results = await geocode(query, 1).catch(() => []);
  const first = results[0];
  if (!first) return null;
  if (first.lat != null) return first;
  return resolvePlace(first);
}

module.exports = { geocode, geocodeOne, resolvePlace };
