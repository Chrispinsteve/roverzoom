// Pure navigation math — no React, no Google, so it can be unit-tested by
// simulating a driver moving through positions. NavMap imports all of its
// camera/route/step decisions from here.

export const R_EARTH = 6378137;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function bearing(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// A point `dist` metres from origin along `brng` degrees.
export function offsetPoint(origin, brng, dist) {
  const d = dist / R_EARTH;
  const t = toRad(brng);
  const p1 = toRad(origin.lat), l1 = toRad(origin.lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lng: toDeg(l2) };
}

export function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos(toRad(lat))) / 2 ** zoom;
}

// Discrete zoom bands by distance-to-destination. Coarse on purpose: fewer,
// larger bands mean the zoom only changes at meaningful thresholds instead of
// jittering between levels on every GPS tick.
export function zoomForDistance(m) {
  if (m > 4000) return 13;
  if (m > 2000) return 14;
  if (m > 900) return 15;
  if (m > 350) return 16;
  if (m > 140) return 17;
  return 18;
}

// Shortest distance (metres) from point p to segment a→b, via a local
// equirectangular projection (accurate for the short segments in a route).
function distanceToSegment(p, a, b) {
  const lat0 = toRad(a.lat);
  const x = (lng) => toRad(lng - a.lng) * Math.cos(lat0) * R_EARTH;
  const y = (lat) => toRad(lat - a.lat) * R_EARTH;
  const px = x(p.lng), py = y(p.lat);
  const bx = x(b.lng), by = y(b.lat);
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - bx * t, dy = py - by * t;
  return Math.sqrt(dx * dx + dy * dy);
}

// Shortest distance from a point to the whole route polyline. Used to decide
// whether the driver has actually left the route (reroute) vs. just GPS noise.
export function distanceToPath(p, path) {
  if (!path || path.length === 0) return Infinity;
  if (path.length === 1) return distanceMeters(p, path[0]);
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegment(p, path[i], path[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

// Which maneuver step the driver is on: advance past any step whose end they've
// already reached (within `thresh` m). Never goes backward, never past the last.
export function advanceStepIndex(currentIdx, steps, driver, thresh = 40) {
  if (!steps || steps.length === 0) return 0;
  let idx = Math.max(0, Math.min(currentIdx, steps.length - 1));
  while (idx < steps.length - 1 && distanceMeters(driver, steps[idx].end) < thresh) idx++;
  return idx;
}

// Should we recompute the route? Only when the driver is meaningfully OFF the
// current route (not on normal movement), and not more often than `cooldownMs`.
// `noRoute` forces the initial fetch.
export function shouldReroute({ noRoute, deviationM, lastRerouteAt, now, deviationThreshM = 65, cooldownMs = 8000 }) {
  if (noRoute) return true;
  if (deviationM <= deviationThreshM) return false;
  return now - (lastRerouteAt || 0) >= cooldownMs;
}

// Should the follow-camera actually re-pan? Only if the driver moved more than
// `thresholdM` since the last camera center — kills the shake from tiny GPS
// fluctuations while stationary or crawling.
export function shouldRepan(lastCenter, driver, thresholdM = 8) {
  if (!lastCenter) return true;
  return distanceMeters(lastCenter, driver) >= thresholdM;
}

// The camera target for follow mode: a point ahead of the driver (along heading,
// or toward the destination if heading is unknown) so the vehicle sits ~lower
// third with the road ahead visible. Returns { center, zoom }.
export function followCamera(driver, destination, viewportH, aheadFraction = 0.26) {
  const toDest = destination ? distanceMeters(driver, destination) : 1000;
  const zoom = zoomForDistance(toDest);
  const brng = (driver.heading != null && !Number.isNaN(driver.heading))
    ? driver.heading
    : (destination ? bearing(driver, destination) : 0);
  const aheadM = metersPerPixel(driver.lat, zoom) * viewportH * aheadFraction;
  return { center: offsetPoint(driver, brng, aheadM), zoom };
}
