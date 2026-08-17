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

// Camera centre a fixed distance ahead of the driver along `headingDeg`, so the
// vehicle sits in the lower third with the road ahead visible. Zoom is computed
// separately (from remaining route distance).
export function lookAheadCenter(pos, headingDeg, viewportH, zoom, aheadFraction = 0.26) {
  const aheadM = metersPerPixel(pos.lat, zoom) * viewportH * aheadFraction;
  return offsetPoint(pos, (headingDeg == null || Number.isNaN(headingDeg)) ? 0 : headingDeg, aheadM);
}

// --- Route projection: "where along the route is the driver, and how far off" -
// Cumulative distance (m) to each vertex of a polyline.
export function cumulativeDistances(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + distanceMeters(path[i - 1], path[i]);
  return cum;
}

// Project p onto segment a→b (local equirectangular). Returns { t, lateral } —
// t is clamped 0..1 along the segment, lateral is the perpendicular distance (m).
function projectOnSegment(p, a, b) {
  const lat0 = toRad(a.lat);
  const x = (lng) => (lng - a.lng) * Math.cos(lat0) * 111320;
  const y = (lat) => (lat - a.lat) * 110540;
  const px = x(p.lng), py = y(p.lat), bx = x(b.lng), by = y(b.lat);
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - bx * t, dy = py - by * t;
  return { t, lateral: Math.sqrt(dx * dx + dy * dy) };
}

// Project the driver onto the whole route. Returns the nearest segment, the
// distance travelled ALONG the route to that point, and the perpendicular
// deviation. This is what makes step progress + deviation robust: a driver who
// turns off the route projects back near where they left it (deviation grows),
// rather than jumping ahead just because a coordinate was crossed.
export function projectToRoute(p, path, cum) {
  if (!path || path.length < 2) return { index: 0, t: 0, lateral: Infinity, distanceAlong: 0 };
  let best = { index: 0, t: 0, lateral: Infinity, distanceAlong: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const s = projectOnSegment(p, path[i], path[i + 1]);
    if (s.lateral < best.lateral) {
      best = { index: i, t: s.t, lateral: s.lateral, distanceAlong: cum[i] + s.t * (cum[i + 1] - cum[i]) };
    }
  }
  return best;
}

// --- Reroute decision: needs SUSTAINED deviation, not a single spike --------
// offStreak = consecutive position updates seen off-route (beyond threshold).
// Only reroute once the streak is sustained AND the cooldown has elapsed.
export function evaluateReroute({ offStreak, lastRerouteAt, now, sustainedTicks = 3, cooldownMs = 8000 }) {
  if ((offStreak || 0) < sustainedTicks) return false;
  return now - (lastRerouteAt || 0) >= cooldownMs;
}

// --- Heading: stable at low speed, never spins when stopped -----------------
// Hold the previous heading when the driver has barely moved (GPS heading is
// unreliable at rest); otherwise use the GPS heading, or derive it from travel.
export function nextHeading(prevHeading, prevPos, newPos, gpsHeading, moveThreshM = 6) {
  if (prevPos && distanceMeters(prevPos, newPos) < moveThreshM) return prevHeading; // stopped/creeping → hold
  if (gpsHeading != null && !Number.isNaN(Number(gpsHeading))) return Number(gpsHeading);
  if (prevPos) return bearing(prevPos, newPos); // derive from movement
  return prevHeading;
}

// --- Maneuver text: a trusted ACTION + a secondary road name ----------------
const MANEUVER_ACTION = {
  'turn-left': 'Turn left', 'turn-right': 'Turn right',
  'turn-slight-left': 'Slight left', 'turn-slight-right': 'Slight right',
  'turn-sharp-left': 'Sharp left', 'turn-sharp-right': 'Sharp right',
  'uturn-left': 'Make a U-turn', 'uturn-right': 'Make a U-turn',
  'roundabout-left': 'At the roundabout', 'roundabout-right': 'At the roundabout',
  'fork-left': 'Keep left', 'fork-right': 'Keep right',
  'keep-left': 'Keep left', 'keep-right': 'Keep right',
  'ramp-left': 'Take the ramp', 'ramp-right': 'Take the ramp', 'ramp': 'Take the ramp',
  'merge': 'Merge', 'straight': 'Continue straight',
  'ferry': 'Take the ferry', 'ferry-train': 'Take the ferry',
};
export function actionForManeuver(m) { return MANEUVER_ACTION[m] || 'Continue straight'; }

export function roadFromInstruction(instruction) {
  if (!instruction) return '';
  const m = instruction.match(/\b(?:onto|toward|towards|on)\s+(.+)$/i);
  let road = m ? m[1] : '';
  road = road.replace(/\s+(?:toward|towards|for|and then|then).*$/i, '').replace(/\s*\(.*$/, '').trim();
  return road;
}

// { action, road } — action is from Google's maneuver field (trusted); road is
// best-effort from the instruction text. Never a live distance.
export function parseManeuver(step) {
  if (!step) return { action: '', road: '', maneuver: null, instruction: '' };
  return {
    action: step.maneuver ? actionForManeuver(step.maneuver) : 'Continue straight',
    road: roadFromInstruction(step.instruction || ''),
    maneuver: step.maneuver || null,
    instruction: step.instruction || '',
  };
}
