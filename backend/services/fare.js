// Fare model per the brief: $50 per hour of estimated trip duration.
// Distance is straight-line (haversine) scaled by a road factor, and duration
// is derived from an average city speed. Swap in a real routing API later for
// exact drive distance/time without changing the callers.

const HOURLY_RATE = Number(process.env.HOURLY_RATE) || 50;
const ROAD_FACTOR = 1.3; // straight-line -> approx road distance
const AVG_SPEED_MPH = 28; // average incl. stops
const MIN_FARE = 12; // floor so very short trips aren't trivial

const EARTH_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;

function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * @returns {{distanceMiles:number, durationMinutes:number, fare:number}}
 */
function estimate(pickup, dropoff) {
  let distanceMiles = 6; // fallback when coords are missing
  if (
    pickup?.lat != null &&
    pickup?.lng != null &&
    dropoff?.lat != null &&
    dropoff?.lng != null
  ) {
    distanceMiles = haversineMiles(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * ROAD_FACTOR;
  }
  const durationMinutes = Math.max(8, Math.round((distanceMiles / AVG_SPEED_MPH) * 60));
  const fare = Math.max(MIN_FARE, Math.round((durationMinutes / 60) * HOURLY_RATE * 100) / 100);
  return {
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    durationMinutes,
    fare,
  };
}

module.exports = { estimate, haversineMiles, HOURLY_RATE };
