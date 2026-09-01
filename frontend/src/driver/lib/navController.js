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
  lookAheadCenter, zoomForSpeed, shouldRepan,
} from './navMath.js';

export const NAV_DEFAULTS = {
  deviationThreshM: 65,    // beyond this from the route = off-route (tunable)
  sustainedTicks: 3,       // consecutive off-route fixes before a reroute
  cooldownMs: 8000,        // min gap between reroutes
  repanThreshM: 8,         // min driver movement before the camera re-pans
  headingMoveThreshM: 6,   // below this movement, hold heading (no spin)
  aheadFraction: 0.26,     // camera centre this fraction of the viewport ahead of the driver: always more route ahead than behind; lower-third only when heading is northerly (north-up map)
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
    this.lastCenter = null;
  }

  setViewport(h) { if (h > 0) this.viewportH = h; }

  // route = { path:[{lat,lng,step}], steps:[{action,road,maneuver,instruction}],
  //           totalDistM, totalDurSec }
  // On a reroute we keep the camera mode; the first route starts in 'overview'.
  // Either way the nav state (step/progress/streak/center) is fully reset so no
  // stale value from the old route survives.
  setRoute(route, { reroute = false } = {}) {
    this.hasRoute = true;
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

    // Immediately place the driver on the NEW route so the banner is correct.
    if (this.lastPos) this._locate(this.lastPos);
  }

  _locate(pos) {
    if (!this.hasRoute || this.path.length < 2) return { deviationM: Infinity, onRoute: false };
    const proj = projectToRoute(pos, this.path, this.cum);
    const onRoute = proj.lateral <= this.config.deviationThreshM;
    if (onRoute) {
      if (proj.distanceAlong > this.progressM) this.progressM = proj.distanceAlong; // forward-only
      const raw = this.vertexStep[proj.index] ?? this.stepIndex;
      if (raw > this.stepIndex) this.stepIndex = raw; // forward-only
    }
    return { deviationM: proj.lateral, onRoute };
  }

  cameraFor(pos) {
    const p = { lat: Number(pos.lat), lng: Number(pos.lng) };
    // Speed, not remaining distance. See zoomForSpeed for why.
    const zoom = zoomForSpeed(this.lastSpeedMph);
    const center = lookAheadCenter(p, this.stableHeading ?? 0, this.viewportH, zoom, this.config.aheadFraction);
    this.lastCenter = { lat: p.lat, lng: p.lng };
    return { center, zoom };
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
    this.stableHeading = nextHeading(this.stableHeading, this.lastPos, p, pos.heading, this.config.headingMoveThreshM);

    let needsReroute = false;
    let rerouteOrigin = null;

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

    let camera = null;
    if (this.mode === 'follow' && shouldRepan(this.lastCenter, p, this.config.repanThreshM)) {
      camera = this.cameraFor(p);
    }

    this.lastPos = p;
    return { camera, needsReroute, rerouteOrigin };
  }

  onUserGesture() { if (this.mode === 'follow') this.mode = 'free'; }

  // Explicit recenter → resume follow, and return a camera immediately.
  recenter() {
    this.mode = 'follow';
    this.lastCenter = null;
    return this.lastPos ? this.cameraFor(this.lastPos) : null;
  }

  // Called after the initial overview has been shown.
  startFollowing() { if (this.mode === 'overview') this.mode = 'follow'; }

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
