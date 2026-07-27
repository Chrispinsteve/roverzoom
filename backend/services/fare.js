// Fare model: $50 per hour of estimated trip duration, then a marketing
// discount applied on top. Includes distance cap, human-readable duration,
// and service-area warning.

const HOURLY_RATE = Number(process.env.HOURLY_RATE) || 50;
const ROAD_FACTOR = 1.3;
const AVG_SPEED_MPH = 28;
const MIN_FARE = 12;
// Marketing discount: every quoted fare is 25% below the base rate, to undercut
// competitors ("Pay 25% less"). Tunable via FARE_MULTIPLIER (0.75 = 25% off);
// set it to 1 to price at the full rate.
const FARE_MULTIPLIER = Number(process.env.FARE_MULTIPLIER) || 0.75;
const MAX_DISTANCE_MILES = 200; // Service area cap — beyond this, warn the rider.

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

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function estimate(pickup, dropoff) {
  let distanceMiles = 6;
  if (
    pickup?.lat != null && pickup?.lng != null &&
    dropoff?.lat != null && dropoff?.lng != null
  ) {
    distanceMiles = haversineMiles(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * ROAD_FACTOR;
  }

  // Cap at service area max
  const tooFar = distanceMiles > MAX_DISTANCE_MILES;
  const cappedMiles = tooFar ? MAX_DISTANCE_MILES : distanceMiles;

  const durationMinutes = Math.max(8, Math.round((cappedMiles / AVG_SPEED_MPH) * 60));
  const baseFare = Math.max(MIN_FARE, (durationMinutes / 60) * HOURLY_RATE);
  const fare = Math.round(baseFare * FARE_MULTIPLIER * 100) / 100;

  return {
    distanceMiles: Math.round(cappedMiles * 10) / 10,
    durationMinutes,
    durationLabel: formatDuration(durationMinutes),
    fare,
    tooFar,
    rawDistanceMiles: tooFar ? Math.round(distanceMiles * 10) / 10 : undefined,
  };
}

module.exports = { estimate, haversineMiles, HOURLY_RATE, FARE_MULTIPLIER };
