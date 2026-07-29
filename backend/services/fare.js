// Fare model: $50 per hour of estimated trip duration, then a marketing
// discount applied on top. Includes distance cap, human-readable duration,
// and service-area warning.

const HOURLY_RATE = Number(process.env.HOURLY_RATE) || 50;
const ROAD_FACTOR = 1.3;
const AVG_SPEED_MPH = 28;
const MIN_FARE = 12;
// Time-of-day marketing discount ("up to 25% less"): rides scheduled in the
// early-morning window get the deeper discount, everything else the standard one.
// Both tunable via env; set to 1 for full price.
const FARE_MULTIPLIER_MORNING = Number(process.env.FARE_MULTIPLIER_MORNING) || 0.75; // 25% off, 4–10am
const FARE_MULTIPLIER_DEFAULT = Number(process.env.FARE_MULTIPLIER) || 0.85;         // 15% off otherwise
const MORNING_START_HOUR = 4;
const MORNING_END_HOUR = 10; // window is [4:00, 10:00) local time
// The service runs on Eastern time (Florida); the scheduled time is stored in
// UTC, so we read its hour in this zone to decide the discount (handles DST).
const SERVICE_TZ = process.env.SERVICE_TZ || 'America/New_York';
const MAX_DISTANCE_MILES = 200; // Service area cap — beyond this, warn the rider.

// Which discount multiplier applies to a ride at this scheduled time. No time
// given (e.g. an early price peek before a slot is chosen) → the standard one.
function multiplierForTime(whenIso) {
  if (!whenIso) return FARE_MULTIPLIER_DEFAULT;
  const d = new Date(whenIso);
  if (isNaN(d.getTime())) return FARE_MULTIPLIER_DEFAULT;
  let hour;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: SERVICE_TZ, hour: 'numeric', hour12: false }).formatToParts(d);
    hour = Number((parts.find((p) => p.type === 'hour') || {}).value);
  } catch {
    hour = d.getHours();
  }
  if (hour === 24) hour = 0; // some environments render midnight as 24
  return (hour >= MORNING_START_HOUR && hour < MORNING_END_HOUR) ? FARE_MULTIPLIER_MORNING : FARE_MULTIPLIER_DEFAULT;
}

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

function estimate(pickup, dropoff, whenIso) {
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
  const multiplier = multiplierForTime(whenIso);
  const baseFare = Math.max(MIN_FARE, (durationMinutes / 60) * HOURLY_RATE);
  const fare = Math.round(baseFare * multiplier * 100) / 100;

  return {
    distanceMiles: Math.round(cappedMiles * 10) / 10,
    durationMinutes,
    durationLabel: formatDuration(durationMinutes),
    fare,
    discountPct: Math.round((1 - multiplier) * 100),
    tooFar,
    rawDistanceMiles: tooFar ? Math.round(distanceMiles * 10) / 10 : undefined,
  };
}

module.exports = { estimate, haversineMiles, HOURLY_RATE, multiplierForTime };
