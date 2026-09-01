// Real driving distance and duration for a trip.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
// This function decides what a rider is charged. RoverZoom's whole promise is
// that the price is locked and fair, so the number it returns has to be the
// trip the driver will actually drive, at the time they will drive it.
//
// Three engines, in order:
//
//   1. Google Routes API, TRAFFIC_AWARE, with the SCHEDULED pickup time as the
//      departure time. This is the one that matters: a 7am airport run and a
//      5pm one down the same road are not the same journey, and pricing both
//      off a free-flow estimate is wrong in both directions.
//
//   2. OSRM. Free, no key, no traffic. Was the primary until now, which meant
//      fares depended on a public demo server with no SLA — and on its 4s
//      timeout, after which the caller silently fell back to haversine x 1.3,
//      about 10% high. Fine as a second opinion, not as the source of truth.
//
//   3. null — the caller then uses its own haversine estimate. Genuinely last
//      resort now rather than a routine occurrence.
//
// Every layer fails soft: a routing outage must never stop someone booking.

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || '';

// Routes API rejects a departureTime in the past, and predictive traffic is
// only meaningful ahead of now. Rides booked for a past time (or with no time
// yet, during an early price peek) simply go without one, which yields
// current-conditions traffic instead of predicted.
function departureTimeFor(whenIso) {
  if (!whenIso) return null;
  const t = new Date(whenIso);
  if (isNaN(t.getTime())) return null;
  // A small margin so a booking for "in one minute" cannot land in the past
  // between building the request and Google reading it.
  if (t.getTime() <= Date.now() + 30_000) return null;
  return t.toISOString();
}

async function googleRoute(pickup, dropoff, whenIso) {
  const key = googleKey();
  if (!key) return null;

  const departureTime = departureTimeFor(whenIso);
  const body = {
    origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
    destination: { location: { latLng: { latitude: dropoff.lat, longitude: dropoff.lng } } },
    travelMode: 'DRIVE',
    // TRAFFIC_AWARE is the point of this whole function. TRAFFIC_UNAWARE would
    // be cheaper and faster and would return the same fiction OSRM does.
    routingPreference: 'TRAFFIC_AWARE',
    ...(departureTime ? { departureTime } : {}),
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(GOOGLE_ROUTES_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // Required by Routes API — an unmasked request is rejected outright,
        // and asking for less is also what keeps it in the cheaper billing tier.
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration',
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[routing] Routes API', res.status, (await res.text()).slice(0, 180));
      return null;
    }
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route || !Number.isFinite(route.distanceMeters)) return null;

    // Durations come back as protobuf strings, e.g. "1234s".
    const secs = (v) => {
      const n = parseFloat(String(v || '').replace('s', ''));
      return Number.isFinite(n) ? n : null;
    };
    const withTraffic = secs(route.duration);
    const freeFlow = secs(route.staticDuration);
    if (withTraffic == null) return null;

    return {
      miles: route.distanceMeters / 1609.344,
      minutes: withTraffic / 60,
      // Kept so callers can see how much of the journey is congestion rather
      // than distance — the difference is what a free-flow estimate hides.
      freeFlowMinutes: freeFlow != null ? freeFlow / 60 : null,
      trafficAware: true,
      source: 'google',
    };
  } catch {
    return null; // timeout, network, malformed response
  }
}

async function osrmRoute(pickup, dropoff) {
  const url = `${OSRM_URL}/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=false&alternatives=false`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route || !Number.isFinite(route.distance)) return null;
    return {
      miles: route.distance / 1609.344,
      minutes: route.duration / 60,
      freeFlowMinutes: route.duration / 60,
      trafficAware: false,
      source: 'osrm',
    };
  } catch {
    return null;
  }
}

// `whenIso` is the SCHEDULED pickup time. Passing it is what makes the quote
// reflect traffic at the hour the ride actually happens.
async function roadRoute(pickup, dropoff, whenIso) {
  if (!pickup || !dropoff) return null;
  const a = { lat: Number(pickup.lat), lng: Number(pickup.lng) };
  const b = { lat: Number(dropoff.lat), lng: Number(dropoff.lng) };
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;

  return (await googleRoute(a, b, whenIso)) || (await osrmRoute(a, b));
}

module.exports = { roadRoute, googleRoute, osrmRoute };
