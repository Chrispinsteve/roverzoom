// NavController — the driver-navigation state machine, with zero React/Google
// dependencies so it can be driven by a simulated GPS stream in tests.
//
// It owns: the active route (single source of truth), where the driver is along
// it (projection), which maneuver step is current (forward-only), whether a
// reroute is warranted (sustained deviation), the follow/free/overview camera
// mode, a stable heading, and locally-derived remaining distance/ETA.
//
// The React layer (NavMap) only: fetches routes from Google, feeds positions in,
// applies the camera imperatively, and renders the banner/card from getters.

import {
  cumulativeDistances, projectToRoute, evaluateReroute, nextHeading,
  lookAheadCenter, zoomForSpeed, shouldRepan, isMateriallyBetter,
  snapToRoute, slicePath, routeBearingAt, SNAP_CORRIDOR_M,
} from './navMath.js';

export const NAV_DEFAULTS = {
  deviationThreshM: 65,    // beyond this from the route = off-route (tunable)
  sustainedTicks: 3,       // consecutive off-route fixes before a reroute
  cooldownMs: 8000,        // min gap between reroutes
  repanThreshM: 8,         // min driver movement before the camera re-pans
  headingMoveThreshM: 6,   // below this movement, hold heading (no spin)
  aheadFraction: 0.26,
  alternateCheckMs: 120000, // how often to look for a faster route while following
  alternateMinRemainSec: 300, // do not bother looking inside the last five minutes
  snapCorridorM: SNAP_CORRIDOR_M, // how far off the line we still DRAW on it
  // Approaching the destination is a different task from driving to it. Route
  // following answers "which road next"; the last two hundred metres answer
  // "where exactly do I stop", and that needs a tighter, less forward-leaning
  // camera. Thresholds are in metres of route remaining, not straight-line
  // distance, so a driver on the far side of a divided road is still treated
  // as far away — because they are.
  approachM: 200,
  arrivingM: 60,     // camera centre this fraction of the viewport ahead of the driver: always more route ahead than behind; lower-third only when heading is northerly (north-up map)
};

export class NavController {
  constructor(config = {}) {
    this.config = { ...NAV_DEFAULTS, ...config };
    this.viewportH = 320;
    this.reset();
  }

  reset() {
    this.mode = 'overview';   // 'overview' | 'follow' | 'free'
    this.hasRoute = false;
    this.path = [];
    this.cum = [];
    this.vertexStep = [];
    this.stepMeta = [];
    this.totalDistM = 0;
    this.totalDurSec = 0;
    this.stepIndex = 0;
    this.progressM = 0;
    this.offStreak = 0;
    this.lastRerouteAt = -Infinity; // first reroute isn't gated by the cooldown
    this.stableHeading = null;
    this.lastSpeedMph = 0;
    this.lastPos = null;
    this.lastSnap = null;
    this.lastCenter = null;
    this.lastAlternateCheckAt = -Infinity;
    this.lastLateralM = Infinity; // how far the last fix sat off the line
    this.routeVersion = 0; // bumped on every new route, so renderers can cache
  }

  setViewport(h) { if (h > 0) this.viewportH = h; }

  // route = { path:[{lat,lng,step}], steps:[{action,road,maneuver,instruction}],
  //           totalDistM, totalDurSec }
  // On a reroute we keep the camera mode; the first route starts in 'overview'.
  // Either way the nav state (step/progress/streak/center) is fully reset so no
  // stale value from the old route survives.
  setRoute(route, { reroute = false } = {}) {
    this.hasRoute = true;
    this.routeVersion++;
    this.path = route.path.map((p) => ({ lat: p.lat, lng: p.lng }));
    this.vertexStep = route.path.map((p) => (p.step ?? 0));
    this.cum = cumulativeDistances(this.path);
    this.stepMeta = route.steps || [];
    this.totalDistM = route.totalDistM || (this.cum[this.cum.length - 1] || 0);
    this.totalDurSec = route.totalDurSec || 0;

    this.stepIndex = 0;
    this.progressM = 0;
    this.offStreak = 0;
    this.lastCenter = null;
    if (!reroute) this.mode = 'overview';

    // Immediately place the driver on the NEW route so the banner is correct —
    // and recompute where to DRAW them, because the cached one was measured
    // against geometry that no longer exists. Without this the vehicle sits on
    // the old line until the next GPS fix, which after a reroute is the exact
    // moment the driver is looking at the map.
    if (this.lastPos) {
      this._locate(this.lastPos);
      this.lastSnap = this.visualFor(this.lastPos);
    }
  }

  _locate(pos) {
    if (!this.hasRoute || this.path.length < 2) return { deviationM: Infinity, onRoute: false };
    const proj = projectToRoute(pos, this.path, this.cum);
    this.lastLateralM = proj.lateral;
    const onRoute = proj.lateral <= this.config.deviationThreshM;
    if (onRoute) {
      if (proj.distanceAlong > this.progressM) this.progressM = proj.distanceAlong; // forward-only
      const raw = this.vertexStep[proj.index] ?? this.stepIndex;
      if (raw > this.stepIndex) this.stepIndex = raw; // forward-only
    }
    return { deviationM: proj.lateral, onRoute };
  }

  // Which of the three driving tasks the camera should serve.
  //
  //   cruise    following a route      — look well ahead, zoom by speed
  //   approach  the destination is in  — tighten, so the stopping point and
  //             play                     the doors around it are legible
  //   arriving  find the exact spot    — tightest, and stop leaning forward:
  //                                      what matters is now BESIDE the driver,
  //                                      not ahead of them
  approachPhase() {
    if (!this.hasRoute) return 'cruise';
    const d = this.remaining().distM;
    if (d > 0 && d <= this.config.arrivingM) return 'arriving';
    if (d > 0 && d <= this.config.approachM) return 'approach';
    return 'cruise';
  }

  cameraFor(pos) {
    const p = { lat: Number(pos.lat), lng: Number(pos.lng) };
    const phase = this.approachPhase();
    // Speed, not remaining distance. See zoomForSpeed for why.
    let zoom = zoomForSpeed(this.lastSpeedMph);
    // Floors, never ceilings: a driver still doing 40mph a hundred metres out
    // must not be zoomed in past what they can react to, so this only ever
    // tightens a camera that speed has already left wide.
    if (phase === 'approach') zoom = Math.max(zoom, 17.6);
    if (phase === 'arriving') zoom = Math.max(zoom, 18.4);
    // Look-ahead collapses on arrival. Holding the driver in the lower third
    // pushes the pickup off the top of the screen exactly when it is the only
    // thing that matters.
    const ahead = phase === 'arriving' ? 0.06 : this.config.aheadFraction;
    const center = lookAheadCenter(p, this.stableHeading ?? 0, this.viewportH, zoom, ahead);
    this.lastCenter = { lat: p.lat, lng: p.lng };
    return { center, zoom, phase };
  }

  // Feed a GPS fix. `now` is injectable for deterministic tests.
  // Returns { camera, needsReroute, rerouteOrigin }.
  onPosition(pos, now = Date.now()) {
    const p = { lat: Number(pos.lat), lng: Number(pos.lng) };
    // Held so cameraFor() can pick a zoom from how fast the driver is moving.
    // Kept as the last KNOWN speed rather than defaulting to 0 on a fix that
    // omits it — a GPS sample without speed should not snap the camera to the
    // stopped zoom mid-motorway.
    if (Number.isFinite(pos.speedMph)) this.lastSpeedMph = pos.speedMph;

    let needsReroute = false;
    let rerouteOrigin = null;

    // Locate BEFORE heading. Placing the driver on the route first means the
    // heading step can fall back to the road's own bearing, which is what the
    // car should point along when it is being drawn on that road.
    if (this.hasRoute && this.path.length >= 2) {
      const { onRoute } = this._locate(p);
      this.offStreak = onRoute ? 0 : this.offStreak + 1;
      if (evaluateReroute({
        offStreak: this.offStreak, lastRerouteAt: this.lastRerouteAt, now,
        sustainedTicks: this.config.sustainedTicks, cooldownMs: this.config.cooldownMs,
      })) {
        needsReroute = true;
        rerouteOrigin = p;
        this.lastRerouteAt = now;
        this.offStreak = 0;
      }
    }

    // Only borrow the road's bearing when the driver is actually being drawn
    // on it. Off-route, the road under the projection is not the road they are
    // on, and pointing the car along it would be worse than pointing it nowhere.
    const snap = this.visualFor(p);
    this.stableHeading = nextHeading(
      this.stableHeading, this.lastPos, p, pos.heading,
      this.config.headingMoveThreshM, snap.snapped ? snap.courseDeg : null,
    );
    this.lastSnap = snap;

    // Follow what is DRAWN, not the raw fix. Centring on the raw coordinate
    // while the car is drawn on the road lets the vehicle wander up to a
    // corridor's width away from the centre of the screen and back — the map
    // holds still and the car slides around on it, which is precisely the
    // "not attached to the road" feel that snapping exists to remove.
    const drawn = { lat: snap.lat, lng: snap.lng };
    let camera = null;
    if (this.mode === 'follow' && shouldRepan(this.lastCenter, drawn, this.config.repanThreshM)) {
      camera = this.cameraFor(drawn);
    }

    this.lastPos = p;
    return { camera, needsReroute, rerouteOrigin, visual: snap };
  }

  // Time to look for a faster route? Only while actually driving a route, and
  // not in the final minutes, when a reroute cannot save enough to be worth
  // the disruption of changing the picture the driver is holding.
  shouldCheckAlternate(now = Date.now()) {
    if (!this.hasRoute || this.mode === 'overview') return false;
    // Never while off-route. A deviation reroute is either in flight or about
    // to be, and the two requests share the RequestGuard: whichever starts
    // last wins, so a candidate check can discard the reroute response. Worse,
    // isWorthSwitching would then judge the candidate against the remaining
    // time on a route the driver has already left, which is meaningless.
    if (this.offStreak > 0) return false;
    if (this.remaining().sec < this.config.alternateMinRemainSec) return false;
    return now - this.lastAlternateCheckAt >= this.config.alternateCheckMs;
  }

  markAlternateChecked(now = Date.now()) { this.lastAlternateCheckAt = now; }

  // Accept a candidate route only if it is materially faster than what is
  // left of the current one. Returns true when the caller should adopt it.
  isWorthSwitching(candidateDurSec) {
    return isMateriallyBetter(this.remaining().sec, candidateDurSec);
  }

  onUserGesture() { if (this.mode === 'follow') this.mode = 'free'; }

  // Explicit recenter → resume follow, and return a camera immediately.
  recenter() {
    this.mode = 'follow';
    this.lastCenter = null;
    const at = this.lastSnap || this.lastPos;
    return at ? this.cameraFor({ lat: at.lat, lng: at.lng }) : null;
  }

  // Called after the initial overview has been shown.
  startFollowing() { if (this.mode === 'overview') this.mode = 'follow'; }

  // Where to DRAW the driver for a given fix. See snapToRoute: on the road
  // when the fix is close enough that the offset is credibly GPS error, at the
  // raw coordinate when it is not.
  visualFor(pos) {
    return snapToRoute(pos, this.path, this.cum, this.progressM, this.lastLateralM, this.config.snapCorridorM);
  }

  // The last computed visual position, for renderers that missed the fix.
  visualPosition() {
    if (this.lastSnap) return this.lastSnap;
    return this.lastPos ? { ...this.lastPos, snapped: false, courseDeg: null } : null;
  }

  // Where the current maneuver ends, in metres along the route.
  //
  // Taken from the PATH's own vertices rather than by summing step distances.
  // Google's per-step distances and the decoded polyline disagree by a few
  // metres, and a seam derived from the wrong one drifts further from the
  // geometry with every step until the highlight no longer matches the road.
  stepEndDistance(stepIdx = this.stepIndex) {
    if (!this.path.length) return 0;
    let last = -1;
    for (let i = 0; i < this.vertexStep.length; i++) if (this.vertexStep[i] <= stepIdx) last = i;
    if (last < 0) return 0;
    return this.cum[Math.min(last, this.cum.length - 1)] || 0;
  }

  // Where the current maneuver STARTS, in metres along the route.
  stepStartDistance(stepIdx = this.stepIndex) {
    return stepIdx <= 0 ? 0 : this.stepEndDistance(stepIdx - 1);
  }

  // The route split into the states the driver reads at a glance:
  //
  //   done     where they have been      — recedes, carries no instruction
  //   now      the maneuver they are on  — dominant, answers "which road NOW"
  //   ahead    the rest of the journey   — present, but not competing
  //
  // Returned as FOUR pieces rather than three, cut at the current step's
  // boundaries as well as at the driver:
  //
  //   donePast  route start  -> step start   long,  changes only on a new step
  //   doneNow   step start   -> driver       short, changes every fix
  //   now       driver       -> step end     short, changes every fix
  //   ahead     step end     -> route end    long,  changes only on a new step
  //
  // The split is about cost, not looks. Cutting only at the driver would make
  // both halves span the whole route, so every GPS fix would hand the map two
  // fresh multi-thousand-point arrays to re-tessellate — a few times a minute,
  // on a phone that is also running GPS and a screen at full brightness. Cut
  // this way, the arrays that change every fix are bounded by a single step,
  // and the long ones are handed over only when the driver finishes a maneuver.
  //
  // donePast/doneNow are drawn identically, as are now/ahead's casings, so the
  // seams are invisible: same colour, same width, meeting at a shared point.
  //
  // Every cut is interpolated, so the done/now seam sits exactly under the
  // vehicle instead of at the nearest vertex.
  traceLanes() {
    const empty = { donePast: [], doneNow: [], now: [], ahead: [] };
    if (!this.hasRoute || this.path.length < 2) return empty;
    const total = this.cum[this.cum.length - 1] || 0;
    const p = Math.min(Math.max(0, this.progressM), total);
    const start = Math.min(this.stepStartDistance(), p);
    const end = Math.min(Math.max(this.stepEndDistance(), p), total);
    return {
      donePast: slicePath(this.path, this.cum, 0, start),
      doneNow: slicePath(this.path, this.cum, start, p),
      now: slicePath(this.path, this.cum, p, end),
      ahead: slicePath(this.path, this.cum, end, total),
    };
  }

  currentStep() { return this.stepMeta[this.stepIndex] || null; }
  nextStep() { return this.stepMeta[this.stepIndex + 1] || null; }

  // Remaining distance is exact (route length minus progress along it).
  //
  // Remaining TIME used to be that fraction applied to the total duration,
  // which silently assumed every mile takes the same time. On a route that is
  // mostly highway and then city streets, the ETA barely moves for twenty
  // minutes and then collapses — because the highway miles were being costed
  // at the average, and the city miles at the average too.
  //
  // Now: the current step is prorated by how far through it the driver is, and
  // every later step contributes its own duration. Falls back to the old
  // interpolation when a route arrived without per-step timings.
  remaining() {
    const distM = Math.max(0, this.totalDistM - this.progressM);

    const haveStepTimings = this.stepMeta.some((s) => s && s.durSec > 0);
    if (!haveStepTimings || !this.stepMeta.length) {
      const sec = this.totalDistM > 0 ? this.totalDurSec * (distM / this.totalDistM) : this.totalDurSec;
      return { distM, sec };
    }

    // Where the current step started along the route, so we know how much of
    // it is already behind the driver.
    let startOfStep = 0;
    for (let i = 0; i < this.stepIndex && i < this.stepMeta.length; i++) {
      startOfStep += this.stepMeta[i].distM || 0;
    }
    const cur = this.stepMeta[this.stepIndex] || { distM: 0, durSec: 0 };
    const intoStep = Math.max(0, this.progressM - startOfStep);
    const curLeft = Math.max(0, (cur.distM || 0) - intoStep);
    const curFrac = cur.distM > 0 ? curLeft / cur.distM : 0;

    let sec = (cur.durSec || 0) * curFrac;
    for (let i = this.stepIndex + 1; i < this.stepMeta.length; i++) {
      sec += this.stepMeta[i].durSec || 0;
    }
    return { distM, sec };
  }
}

// Guards against out-of-order async route responses overwriting a newer route:
// each request gets an incrementing token; only the response whose token is
// still current is applied.
export class RequestGuard {
  constructor() { this.seq = 0; }
  begin() { return ++this.seq; }
  isCurrent(token) { return token === this.seq; }
}
