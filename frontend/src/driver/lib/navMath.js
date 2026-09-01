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
// Navigation zoom, chosen by SPEED rather than by how far is left to drive.
//
// zoomForDistance below does the opposite, and that was the bug: it zoomed out
// as a function of trip length, so a driver ten miles from the dropoff got
// zoom 13 — street names unreadable, no idea which turning is theirs. The
// length of the trip says nothing about how much road you need to see. What
// matters is how fast you are covering it: at 25 mph the next 200 metres is
// enough, at 70 mph you need to see the exit coming.
//
// Fractional zooms are deliberate — Google Maps interpolates them, so the
// camera eases between levels instead of stepping.
export function zoomForSpeed(mph) {
  const v = Number.isFinite(mph) ? Math.max(0, mph) : 0;
  if (v >= 60) return 16.2;   // highway: see the exit well ahead
  if (v >= 45) return 16.8;
  if (v >= 30) return 17.4;   // arterial
  if (v >= 12) return 18.0;   // town streets
  // Stopped or crawling. 18.6, not 18.2, because Google does not draw house
  // numbers below about zoom 19 — measured by rendering this street at 17,
  // 17.5, 18, 18.5 and 19, where only 19 carried them. At walking pace the
  // house number is the entire question, so the camera has to get close
  // enough that the map can answer it.
  return 18.6;
}

// Kept for the OVERVIEW camera, where fitting the whole route IS the job.
// Never use this for follow mode.
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

// Camera centre placed aheadFraction × (viewport height, in metres) ahead of the
// driver along `headingDeg`. This ALWAYS puts more route ahead than behind
// (ahead ≈ 0.5 + aheadFraction of the viewport, behind ≈ 0.5 − aheadFraction).
// The map is NORTH-UP (only the marker rotates), so the vehicle sits in the
// lower third specifically when the heading is northerly; for other headings the
// driver is offset toward the heading direction, not necessarily downward. A
// true "always lower-third" would require a heading-up (rotated) map — a Phase-2
// change, intentionally not done here. Zoom is computed separately.
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
// Priority, in order:
//   1. hold while stopped   — a parked car must not spin. GPS heading is
//                             meaningless at zero speed and phones emit noise.
//   2. device heading       — the only true measure of where the car POINTS,
//                             as opposed to where it has been.
//   3. the road's bearing   — when snapped to the route. Smooth and correct at
//                             any speed, where a fix-to-fix bearing is noisy
//                             when crawling and undefined when stopped.
//   4. movement bearing     — off-route, where there is no road to borrow from.
export function nextHeading(prevHeading, prevPos, newPos, gpsHeading, moveThreshM = 6, routeCourse = null) {
  if (prevPos && distanceMeters(prevPos, newPos) < moveThreshM) return prevHeading; // stopped/creeping → hold
  const g = Number(gpsHeading);
  // Reject NaN and out-of-range values as well as null: a device reporting -1
  // or 999 for "unknown" would otherwise be believed and point the car nowhere.
  if (gpsHeading != null && Number.isFinite(g) && g >= 0 && g <= 360) return g % 360;
  if (Number.isFinite(routeCourse)) return routeCourse;
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
export function actionForManeuver(m) { return MANEUVER_ACTION[normalizeManeuver(m)] || 'Continue straight'; }

// The Routes API names maneuvers in SCREAMING_SNAKE ('TURN_LEFT'); the legacy
// Directions API used kebab ('turn-left'), which is what the glyphs and the
// action table above are keyed on. Normalising here means the rest of the
// navigation stack never learns which engine produced a route — and if the
// browser DirectionsService is ever re-enabled, both shapes keep working.
const ROUTES_API_ALIASES = {
  depart: 'straight',
  'name-change': 'straight',
  'roundabout-clockwise': 'roundabout-right',
  'roundabout-counterclockwise': 'roundabout-left',
  'roundabout-exit-clockwise': 'roundabout-right',
  'roundabout-exit-counterclockwise': 'roundabout-left',
  'roundabout-left-clockwise': 'roundabout-left',
  'roundabout-right-counterclockwise': 'roundabout-right',
  'roundabout-straight-clockwise': 'roundabout-right',
  'roundabout-straight-counterclockwise': 'roundabout-left',
  'roundabout-sharp-left-clockwise': 'roundabout-left',
  'roundabout-sharp-right-clockwise': 'roundabout-right',
  'roundabout-slight-left-clockwise': 'roundabout-left',
  'roundabout-slight-right-clockwise': 'roundabout-right',
  'merge-left': 'merge',
  'merge-right': 'merge',
  'fork-straight': 'straight',
  'uturn': 'uturn-left',
};
export function normalizeManeuver(m) {
  if (!m) return null;
  const k = String(m).toLowerCase().replace(/_/g, '-');
  if (MANEUVER_ACTION[k]) return k;
  if (ROUTES_API_ALIASES[k]) return ROUTES_API_ALIASES[k];
  // Unknown roundabout or merge variants degrade to their family rather than
  // to "Continue straight", which would tell a driver to drive into a circle.
  if (k.startsWith('roundabout')) return k.includes('left') ? 'roundabout-left' : 'roundabout-right';
  if (k.startsWith('merge')) return 'merge';
  if (k.startsWith('ramp')) return k.includes('left') ? 'ramp-left' : 'ramp-right';
  return k;
}

export function roadFromInstruction(instruction) {
  if (!instruction) return '';
  const m = instruction.match(/\b(?:onto|toward|towards|on)\s+(.+)$/i);
  let road = m ? m[1] : '';
  road = road.replace(/\s+(?:toward|towards|for|and then|then).*$/i, '').replace(/\s*\(.*$/, '').trim();
  return road;
}

// Lane guidance, as far as it can honestly be provided.
//
// WHAT THIS IS NOT
// Google's real lane guidance — the row of arrows showing which lanes are
// valid — comes only from the Navigation SDK, which is native iOS/Android.
// The web APIs do not expose lane counts, lane arrows, or which lanes are
// permitted. The Routes API returns a maneuver and an instruction string and
// nothing else.
//
// WHAT THIS IS
// Google sometimes puts the lane advice INTO the instruction text: "Use the
// right 2 lanes to turn right onto NW 2nd Ave". When it does, that is real
// guidance from Google and worth showing properly instead of burying it in a
// sentence. When it does not, this returns null and the UI shows nothing.
//
// The rule that matters: never infer, never guess a lane count, never fall
// back to "probably the right lane". A driver who trusts an invented lane hint
// at 60mph on I-95 is in danger. Absent data must look absent.
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export function parseLaneHint(instruction) {
  if (!instruction) return null;
  const text = String(instruction).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // "keep left/right" carries no "lane" but is the same decision at a fork or
  // an exit, which is exactly where a driver needs it most.
  if (!/\blanes?\b/i.test(text) && !/\bkeep (left|right)\b/i.test(text)) return null;

  // "Use the right 2 lanes", "Use the left lane", "Use the middle lane"
  const use = text.match(/\buse the (left|right|middle|center|centre)\s*(\d+|one|two|three|four|five)?\s*lanes?\b/i);
  if (use) {
    const side = use[1].toLowerCase().replace(/^(center|centre)$/, 'middle');
    const raw = (use[2] || '').toLowerCase();
    const count = raw ? (WORD_NUMBERS[raw] ?? parseInt(raw, 10)) : 1;
    if (!Number.isFinite(count) || count < 1 || count > 6) return null;
    return { side, count, source: 'google', text };
  }

  // "Keep left"/"Keep right" phrased with lanes — a side, but no count. Report
  // the side and leave the count null rather than assuming one lane.
  const keep = text.match(/\bkeep (left|right)\b/i);
  if (keep) return { side: keep[1].toLowerCase(), count: null, source: 'google', text };

  return null;
}


// { action, road } — action is from Google's maneuver field (trusted); road is
// best-effort from the instruction text. Never a live distance.
export function parseManeuver(step) {
  if (!step) return { action: '', road: '', maneuver: null, instruction: '', lane: null };
  return {
    action: step.maneuver ? actionForManeuver(step.maneuver) : 'Continue straight',
    road: roadFromInstruction(step.instruction || ''),
    // Normalised, so the glyph table and any downstream comparison see one
    // vocabulary regardless of which Google API produced the route.
    maneuver: normalizeManeuver(step.maneuver),
    instruction: step.instruction || '',
    // Carried so remaining time can be summed over the steps still ahead
    // rather than interpolated from the total. Default 0 keeps older callers
    // (and the tests) working unchanged.
    distM: Number(step.distM) || 0,
    durSec: Number(step.durSec) || 0,
    // Lane advice IF Google put any in the instruction text, null otherwise.
    // Parsed here so every consumer gets it from one place and none of them
    // has to decide for itself what to do when there is no lane data.
    lane: parseLaneHint(step.instruction || ''),
  };
}


// Is a freshly-fetched route worth switching to mid-trip?
//
// Rerouting today only happens when the driver leaves the route. That misses
// the case navigation is most useful for: the road ahead has just gone wrong
// and a better one exists. But swapping routes is disruptive — the line moves,
// the next turn changes, and a driver who had built a picture of the journey
// loses it. So the bar is deliberately high, and BOTH tests must pass:
//
//   * an absolute saving, so a two-minute trip is not rerouted to save nine
//     seconds, and
//   * a proportional saving, so a ninety-minute trip is not rerouted for a
//     rounding error that congestion will erase again in a minute.
//
// Numbers chosen to sit above normal traffic-model noise. Google's own
// estimates for the same route drift by tens of seconds between calls.
export const REROUTE_MIN_SAVING_SEC = 120;
export const REROUTE_MIN_SAVING_FRAC = 0.10;

export function isMateriallyBetter(currentSec, candidateSec, opts = {}) {
  const minSec = opts.minSec ?? REROUTE_MIN_SAVING_SEC;
  const minFrac = opts.minFrac ?? REROUTE_MIN_SAVING_FRAC;
  if (!Number.isFinite(currentSec) || !Number.isFinite(candidateSec)) return false;
  if (currentSec <= 0 || candidateSec <= 0) return false;
  const saving = currentSec - candidateSec;
  if (saving < minSec) return false;
  return saving / currentSec >= minFrac;
}

// ============================================================
// Trace Lane geometry — position and route as the driver SEES them
// ============================================================
// The controller already knew where the driver was along the route; it just
// never told the renderer. These turn "distance along the route" into points
// and sub-paths, which is what the Trace Lane and the vehicle are drawn from.

// How far off the line the driver can be and still be DRAWN on it.
//
// Deliberately far tighter than deviationThreshM (65m, the point at which we
// declare the driver off-route and reroute). Those two numbers answer different
// questions and must not be the same:
//
//   deviationThreshM  "should we compute a new route?"   — expensive to get wrong
//                                                          in either direction,
//                                                          so it is forgiving
//   SNAP_CORRIDOR_M   "should we DRAW the car on the road?" — a lie here is
//                                                          read by the driver as
//                                                          fact, so it is strict
//
// At 65m a driver on a frontage road running beside I-95 would be painted onto
// the highway, and the map would be confidently showing them somewhere they are
// not. 28m covers ordinary urban GPS error (a typical phone fix is 5-20m) and
// stops well short of the next road over.
export const SNAP_CORRIDOR_M = 28;

// The point that lies `distM` along the path, interpolated WITHIN a segment
// rather than rounded to the nearest vertex. Rounding to vertices would make
// the car tick from vertex to vertex on a sparse highway polyline where the
// gaps run to hundreds of metres.
export function pointAtDistance(path, cum, distM) {
  if (!path || path.length === 0) return null;
  if (path.length === 1) return { lat: path[0].lat, lng: path[0].lng, index: 0, t: 0 };
  const total = cum[cum.length - 1] || 0;
  const d = Math.min(Math.max(0, distM), total);
  // Last segment whose start is at or before d.
  let i = 0;
  for (let k = 0; k < cum.length - 1; k++) { if (cum[k] <= d) i = k; else break; }
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (d - cum[i]) / segLen : 0;
  return {
    lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
    lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
    index: i,
    t,
  };
}

// The stretch of route between two distances, with both ends interpolated so
// the cut lands exactly where asked. This is what makes the completed/remaining
// seam sit UNDER the vehicle instead of at whichever vertex happens to be near
// it — a seam that visibly leads or trails the car is the tell that a map is
// faking its progress.
export function slicePath(path, cum, fromM, toM) {
  if (!path || path.length < 2) return [];
  const total = cum[cum.length - 1] || 0;
  const a = Math.min(Math.max(0, fromM), total);
  const b = Math.min(Math.max(0, toM), total);
  if (b <= a) return [];
  const start = pointAtDistance(path, cum, a);
  const end = pointAtDistance(path, cum, b);
  const out = [{ lat: start.lat, lng: start.lng }];
  for (let i = start.index + 1; i <= end.index; i++) out.push({ lat: path[i].lat, lng: path[i].lng });
  out.push({ lat: end.lat, lng: end.lng });
  return out;
}

// Which way the ROAD points at a given distance along it.
//
// Used to orient the vehicle when it is drawn on the route. A bearing taken
// between two consecutive GPS fixes is noisy at low speed and meaningless when
// stopped; the road's own direction is neither, and a car drawn on a road
// should point along it.
export function routeBearingAt(path, cum, distM) {
  if (!path || path.length < 2) return null;
  const at = pointAtDistance(path, cum, distM);
  if (!at) return null;
  const i = Math.min(at.index, path.length - 2);
  return bearing(path[i], path[i + 1]);
}

// Where to DRAW the driver, which is not always where the GPS says.
//
// Two failure modes bracket this, and the whole design is about refusing both:
//
//   Draw the raw fix         the car wanders off the road, crosses buildings,
//                            and shivers in place while parked
//   Snap unconditionally     the car is painted onto a road the driver has
//                            genuinely left, and the map lies at the exact
//                            moment the driver most needs the truth
//
// So snapping is conditional on the fix being close enough to the line that the
// difference is credibly GPS error. Inside the corridor the driver is drawn on
// the road at their forward-only progress; outside it they are drawn exactly
// where the GPS puts them, off the line, which is both honest and the clearest
// possible signal that something has diverged.
//
// progressM is passed in rather than recomputed because it is forward-only.
// That is what stops the car twitching backwards when a fix lands slightly
// behind the last one, which is otherwise constant at low speed.
export function snapToRoute(pos, path, cum, progressM, lateralM, corridorM = SNAP_CORRIDOR_M) {
  const raw = { lat: Number(pos.lat), lng: Number(pos.lng) };
  if (!path || path.length < 2 || !Number.isFinite(lateralM) || lateralM > corridorM) {
    return { lat: raw.lat, lng: raw.lng, snapped: false, courseDeg: null };
  }
  const at = pointAtDistance(path, cum, progressM);
  if (!at) return { lat: raw.lat, lng: raw.lng, snapped: false, courseDeg: null };
  return { lat: at.lat, lng: at.lng, snapped: true, courseDeg: routeBearingAt(path, cum, progressM) };
}

// How wide to draw the Trace Lane at a given zoom.
//
// A fixed stroke weight is wrong at both ends of the range. Google's polylines
// are specified in SCREEN pixels, not metres, so a width tuned for navigation
// zoom becomes a fat ribbon swallowing the junction when the driver zooms in,
// and a thread when they zoom out to see the whole trip.
//
// Target at navigation zoom: a 13-14px lane with a 9-10px interior. Heavier
// than a map line has any business being, on purpose — this is the object the
// driver is following at speed, and a thin line reads as data drawn over a map
// rather than as the road they are on. The casing is 2px per side: enough to
// hold the colour away from the grey underneath at any brightness.
export function traceWeights(zoom) {
  const z = Number.isFinite(zoom) ? zoom : 17;
  let core;
  if (z >= 18) core = 10;
  else if (z >= 17) core = 9;
  else if (z >= 16) core = 8;
  else if (z >= 15) core = 7;
  else core = 6;
  return {
    core,
    casing: core + 4,
    // The completed lane is deliberately narrower as well as duller: it has
    // already been driven, so it should read as a trace, not as a road.
    done: Math.max(4, core - 1),
  };
}
