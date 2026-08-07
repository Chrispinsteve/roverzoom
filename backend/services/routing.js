// Real driving distance + duration from a routing engine, so quotes reflect the
// actual road route instead of a straight line × a flat factor (which inflates
// direct highway trips — e.g. Boca Raton → FLL is ~21 mi driving, but
// haversine×1.3 gave ~28). Uses the free public OSRM server (no key). Returns
// null on any failure so the caller falls back to the haversine estimate.
//
// Point OSRM_URL at a self-hosted OSRM (or swap in Google's Routes/Distance
// Matrix API once its billing is enabled) for production-grade reliability.
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';

async function roadRoute(pickup, dropoff) {
  if (!pickup || !dropoff) return null;
  const { lat: aLat, lng: aLng } = pickup;
  const { lat: bLat, lng: bLng } = dropoff;
  if (![aLat, aLng, bLat, bLng].every((n) => Number.isFinite(n))) return null;

  const url = `${OSRM_URL}/route/v1/driving/${aLng},${aLat};${bLng},${bLat}?overview=false&alternatives=false`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data && Array.isArray(data.routes) && data.routes[0];
    if (!route || !Number.isFinite(route.distance)) return null;
    return {
      miles: route.distance / 1609.344,
      minutes: route.duration / 60,
    };
  } catch {
    return null; // timeout / network / bad response — caller uses the fallback
  }
}

module.exports = { roadRoute };
