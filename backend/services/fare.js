// ============================================================
// Fare model: $50 per hour of estimated trip duration.
// ============================================================
// Two estimators live here:
//
//   estimate()       — synchronous, straight-line (haversine x road
//                      factor). Zero dependencies, zero cost, always
//                      available. This is the fallback and the original
//                      behaviour.
//
//   estimateRoute()  — async, real Google driving route with
//                      traffic-aware duration. Opt-in via
//                      USE_GOOGLE_ROUTING=true.
//
// Why this is opt-in rather than just switched on:
//
// Fare here is a pure function of DURATION (durationMinutes / 60 x
// $50). The straight-line estimator assumes a flat 28 mph average for
// every trip, and that single assumption is wrong in BOTH directions
// depending on the trip profile:
//
//   West Palm Beach -> Miami Intl   quotes 181 min / $150.83
//                                   actual ~70 min  / ~$58
//                                   -> overcharges ~2.6x
//
//   Miami Beach -> Brickell         quotes  12 min / $12 (min fare)
//                                   actual ~20 min  / ~$17
//                                   -> undercharges
//
// Highway miles are covered far faster than 28 mph and dense urban
// miles far slower, so the flat average punishes long airport runs —
// the exact rides a scheduled-booking product is built to win — while
// quietly underpricing short city hops. The overcharge is the more
// urgent commercial problem: a $150 quote on a $58 ride does not lose
// margin, it loses the booking outright.
//
// Turning real routing on is still a pricing change, not just a
// technical upgrade, so it stays behind a flag. Run both estimators
// side by side on real bookings, look at the delta across your actual
// trip mix, then decide whether $50/hr is still the right rate once
// duration is honest. The flag makes that decision deliberate and
// reversible rather than a side effect of deploying a map.
// ============================================================

const google = require('./googleMaps');

const HOURLY_RATE = Number(process.env.HOURLY_RATE) || 50;
const ROAD_FACTOR = 1.3;
const AVG_SPEED_MPH = 28;
const MIN_FARE = 12;
const MAX_DISTANCE_MILES = 200; // Service area cap — beyond this, warn the rider.

const USE_GOOGLE_ROUTING = String(process.env.USE_GOOGLE_ROUTING || '').toLowerCase() === 'true';

const EARTH_MILES = 3958.8;
const METERS_PER_MILE = 1609.344;
const toRad = (d) => (d * Math.PI) / 180;

function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// Shared final step so both estimators price identically off their
// respective distance/duration inputs. Keeping this in one place is what
// guarantees that switching estimators changes the measurement and
// nothing else about how money is computed.
function priceFrom(distanceMiles, durationMinutes, source, polyline) {
  const tooFar = distanceMiles > MAX_DISTANCE_MILES;
  const cappedMiles = tooFar ? MAX_DISTANCE_MILES : distanceMiles;
  const minutes = Math.max(8, Math.round(durationMinutes));
  const fare = Math.max(MIN_FARE, Math.round((minutes / 60) * HOURLY_RATE * 100) / 100);

  return {
    distanceMiles: Math.round(cappedMiles * 10) / 10,
    durationMinutes: minutes,
    durationLabel: formatDuration(minutes),
    fare,
    tooFar,
    rawDistanceMiles: tooFar ? Math.round(distanceMiles * 10) / 10 : undefined,
    source,
    polyline: polyline || null,
  };
}

/**
 * Straight-line estimate. Synchronous, always succeeds.
 * Kept as-is so existing callers and the fallback path are unchanged.
 */
function estimate(pickup, dropoff) {
  let distanceMiles = 6;
  if (
    pickup?.lat != null && pickup?.lng != null &&
    dropoff?.lat != null && dropoff?.lng != null
  ) {
    distanceMiles = haversineMiles(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * ROAD_FACTOR;
  }
  const cappedMiles = Math.min(distanceMiles, MAX_DISTANCE_MILES);
  const durationMinutes = Math.max(8, Math.round((cappedMiles / AVG_SPEED_MPH) * 60));
  return priceFrom(distanceMiles, durationMinutes, 'haversine', null);
}

/**
 * Real-route estimate, with automatic fallback.
 *
 * Always resolves — never rejects. If Google is unconfigured, disabled,
 * rate-limited or simply down, this returns exactly what estimate()
 * would have returned. A rider must always be able to get a price.
 *
 * @param {{lat,lng}} pickup
 * @param {{lat,lng}} dropoff
 * @param {string=} scheduledAt ISO timestamp — enables traffic prediction
 *                              for the actual hour of the ride.
 */
async function estimateRoute(pickup, dropoff, scheduledAt = null) {
  const fallback = estimate(pickup, dropoff);

  if (!USE_GOOGLE_ROUTING || !google.isConfigured()) return fallback;
  if (pickup?.lat == null || dropoff?.lat == null) return fallback;

  try {
    const route = await google.getRoute(pickup, dropoff, scheduledAt);
    if (!route || route.distanceMeters == null || route.durationSeconds == null) {
      return fallback;
    }
    return priceFrom(
      route.distanceMeters / METERS_PER_MILE,
      route.durationSeconds / 60,
      'google',
      route.polyline
    );
  } catch (err) {
    console.warn('[fare] routing failed, using straight-line estimate:', err.message);
    return fallback;
  }
}

module.exports = {
  estimate,
  estimateRoute,
  haversineMiles,
  formatDuration,
  HOURLY_RATE,
  USE_GOOGLE_ROUTING,
};
