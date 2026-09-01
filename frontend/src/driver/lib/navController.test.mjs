// Drives the NavController with a simulated GPS stream and asserts the full
// navigation lifecycle. Run: node frontend/src/driver/lib/navController.test.mjs
import assert from 'node:assert';
import { NavController, RequestGuard } from './navController.js';
import { bearing, distanceMeters } from './navMath.js';

const LNG = -80.1;
const v = (lat, step = 0) => ({ lat, lng: LNG, step });
let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

// A 2-step route heading north on lng -80.1: Step 0 (A→B), turn, Step 1 (B→C).
function pickupRoute() {
  return {
    path: [v(26.3500, 0), v(26.3520, 0), v(26.3540, 0), v(26.3550, 0),
           v(26.3550, 1), v(26.3580, 1), v(26.3620, 1), v(26.3650, 1)],
    steps: [
      { action: 'Continue straight', road: 'Main St', maneuver: 'straight' },
      { action: 'Turn right', road: '2nd Ave', maneuver: 'turn-right' },
    ],
    totalDurSec: 240,
  };
}
// A different route (to a dropoff), for the pickup→destination swap.
function dropoffRoute() {
  return {
    path: [v(26.3650, 0), v(26.3700, 0), v(26.3750, 0)],
    steps: [{ action: 'Continue straight', road: 'Ocean Blvd', maneuver: 'straight' }],
    totalDurSec: 120,
  };
}

// --- Tests 1–4: camera state machine --------------------------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  assert.equal(c.mode, 'overview');                 // Test 1: initial → overview
  c.startFollowing();
  assert.equal(c.mode, 'follow');                    // Test 2: begin driving → follow
  const r = c.onPosition(v(26.3500), 1000);
  assert.ok(r.camera, 'follow yields a camera');
  c.onUserGesture();
  assert.equal(c.mode, 'free');                       // Test 3: pan → free
  const r2 = c.onPosition(v(26.3520), 2000);
  assert.equal(r2.camera, null, 'no camera control while free');
  const cam = c.recenter();
  assert.equal(c.mode, 'follow');                     // Test 4: recenter → follow
  assert.ok(cam, 'recenter returns a camera immediately');
  ok('camera: overview → follow → free → recenter → follow (never fights user)');
}

// --- Tests 5–6: maneuver tracks the CURRENT step, forward-only ------------
{
  const c = new NavController();
  c.setRoute(pickupRoute()); c.startFollowing();
  c.onPosition(v(26.3500), 100);
  assert.equal(c.currentStep().action, 'Continue straight'); // Test 5
  c.onPosition(v(26.3540), 200);
  assert.equal(c.stepIndex, 0, 'still step 0 before the intersection');
  c.onPosition(v(26.3560), 300);                              // past the turn
  assert.equal(c.stepIndex, 1);                               // Test 6
  assert.equal(c.currentStep().action, 'Turn right');
  c.onPosition(v(26.3540), 400);                              // GPS bounces backward
  assert.equal(c.stepIndex, 1, 'never regresses to an earlier maneuver');
  ok('maneuver: advances on real progress, forward-only, no backward flip');
}

// --- Test (point 1): wrong turn at intersection must NOT advance -----------
{
  const c = new NavController();
  c.setRoute(pickupRoute()); c.startFollowing();
  c.onPosition(v(26.3540), 100);
  assert.equal(c.stepIndex, 0);
  c.onPosition({ lat: 26.3550, lng: -80.0980 }, 200); // ~200m east — wrong road
  assert.equal(c.stepIndex, 0, 'off-route driver does not advance the maneuver');
  ok('point 1: taking the wrong road does not confidently advance the maneuver');
}

// --- Tests 7–8: reroute ignores noise, fires on sustained deviation --------
{
  const c = new NavController();
  c.setRoute(pickupRoute()); c.startFollowing();
  let r = c.onPosition({ lat: 26.3520, lng: -80.0997 }, 100); // ~30m noise (on-route)
  assert.equal(r.needsReroute, false);
  assert.equal(c.offStreak, 0);
  r = c.onPosition({ lat: 26.3520, lng: -80.0988 }, 200);     // ~120m spike, 1 tick
  assert.equal(r.needsReroute, false, 'single spike does not reroute'); // Test 7
  assert.equal(c.offStreak, 1);
  c.onPosition(v(26.3540), 300);                              // back on route
  assert.equal(c.offStreak, 0, 'returning to the route clears the streak');

  // Sustained departure → reroute (Test 8)
  const c2 = new NavController();
  c2.setRoute(pickupRoute()); c2.startFollowing();
  c2.onPosition({ lat: 26.3520, lng: -80.0988 }, 1000);
  c2.onPosition({ lat: 26.3525, lng: -80.0985 }, 2000);
  const r3 = c2.onPosition({ lat: 26.3530, lng: -80.0982 }, 3000);
  assert.equal(r3.needsReroute, true, 'sustained deviation reroutes');
  assert.ok(r3.rerouteOrigin, 'reroute carries the current origin');
  ok('reroute: ignores noise & single spikes, fires only on sustained deviation');
}

// --- Test 9: after a reroute, nav state is fully recalculated --------------
{
  const c = new NavController();
  c.setRoute(pickupRoute()); c.startFollowing();
  // advance partway so progress/step are non-zero
  c.onPosition(v(26.3560), 100);
  assert.ok(c.stepIndex === 1 && c.progressM > 0);
  const oldPath = c.path;
  // A real reroute is computed FROM the driver's current position, so its path
  // begins at the driver (~26.3560) — step 0 should start right there.
  const fresh = {
    path: [v(26.3560, 0), v(26.3600, 0), v(26.3650, 0)],
    steps: [{ action: 'Continue straight', road: 'Reroute Rd', maneuver: 'straight' }],
    totalDurSec: 180,
  };
  c.setRoute(fresh, { reroute: true });
  assert.notStrictEqual(c.path, oldPath, 'route geometry replaced');
  assert.equal(c.stepIndex, 0, 'step index recalculated from the new route start');
  assert.ok(c.progressM < 50, 'progress recalculated (near start of the new route)');
  assert.equal(c.mode, 'follow', 'reroute keeps the driver in follow');
  assert.equal(c.currentStep().road, 'Reroute Rd', 'banner reflects the NEW route');
  ok('reroute: new route is the single source of truth (no stale step/progress/mode)');
}

// --- Test 10: pickup → destination swap leaves no leftover state -----------
{
  const c = new NavController();
  c.setRoute(pickupRoute()); c.startFollowing();
  c.onPosition(v(26.3600, 1), 100); // drive most of the pickup route
  assert.ok(c.progressM > 0);
  // reaching pickup → the screen swaps to the dropoff route (fresh objective)
  c.setRoute(dropoffRoute()); // reroute:false → fresh
  assert.equal(c.stepIndex, 0);
  assert.equal(c.mode, 'overview', 'fresh objective starts in overview');
  assert.equal(c.currentStep().road, 'Ocean Blvd', 'now navigating to the dropoff');
  assert.equal(c.stepMeta.length, 1, 'no leftover pickup steps');
  ok('pickup → destination swap resets to the new objective cleanly');
}

// --- Tests 11–12: heading is stable at rest, resumes when moving -----------
{
  const c = new NavController();
  c.onPosition({ lat: 26.3500, lng: LNG, heading: 90 }, 100);
  assert.equal(c.stableHeading, 90, 'initial heading from GPS');
  c.onPosition({ lat: 26.350001, lng: LNG, heading: 270 }, 200); // ~0.1m move, noisy heading
  assert.equal(c.stableHeading, 90, 'heading HELD while stopped (no spin)'); // Test 11
  c.onPosition({ lat: 26.3510, lng: LNG, heading: 5 }, 300);      // ~120m move
  assert.equal(c.stableHeading, 5, 'heading resumes when actually moving');   // Test 12
  // heading derived from travel when GPS heading is missing
  const c2 = new NavController();
  c2.onPosition({ lat: 26.3500, lng: LNG, heading: 0 }, 100);
  c2.onPosition({ lat: 26.3600, lng: LNG, heading: null }, 200); // moved north, no gps heading
  assert.ok(c2.stableHeading < 5 || c2.stableHeading > 355, `derived heading ~north, got ${c2.stableHeading}`);
  ok('heading: held at rest, resumes moving, derived from travel when GPS lacks it');
}

// --- Point 5: ETA/distance update LOCALLY, no reroute needed ---------------
{
  const c = new NavController();
  c.setRoute(pickupRoute()); c.startFollowing();
  c.onPosition(v(26.3500), 100);
  const early = c.remaining();
  c.onPosition(v(26.3620, 1), 200); // progressed most of the way — no reroute
  const late = c.remaining();
  assert.ok(late.distM < early.distM, 'remaining distance shrinks locally');
  assert.ok(late.sec < early.sec, 'remaining ETA shrinks locally');
  ok('point 5: remaining distance/ETA update locally from progress (no extra Directions call)');
}

// --- Point 12: only the latest route response wins ------------------------
{
  const g = new RequestGuard();
  const tokenA = g.begin();      // request A dispatched
  const tokenB = g.begin();      // request B dispatched (newer)
  assert.equal(g.isCurrent(tokenB), true, 'newest response applies');
  assert.equal(g.isCurrent(tokenA), false, 'stale (older) response is rejected');
  ok('race guard: a late/stale route response cannot overwrite a newer route');
}

// --- remaining(): summed, not interpolated -------------------------------
// A route that is mostly fast highway and then slow city streets. Interpolating
// total duration by distance costs every mile the same, so the ETA barely moves
// through the highway leg and then collapses in the city leg. Summing the steps
// still ahead gives the truth at every point.
{
  // 10km of highway in 5 min, then 2km of city in 10 min.
  const path = [];
  for (let i = 0; i <= 100; i++) path.push({ lat: 26.0 + i * 0.001, lng: -80.1, step: i < 84 ? 0 : 1 });
  const steps = [
    { action: 'Continue', road: 'I-95', distM: 10000, durSec: 300 },
    { action: 'Turn right', road: 'Main St', distM: 2000, durSec: 600 },
  ];
  const c = new NavController();
  c.setRoute({ path, steps, totalDistM: 12000, totalDurSec: 900 });

  // At the very start, the whole 15 minutes is ahead.
  let r = c.remaining();
  assert.ok(Math.abs(r.sec - 900) < 30, `at the start ~900s remain, got ${Math.round(r.sec)}`);

  // Simulate having driven the entire highway leg: 10km done, 2km of city left.
  c.progressM = 10000;
  c.stepIndex = 1;
  r = c.remaining();

  // The truth: the 10-minute city leg is what remains.
  assert.ok(Math.abs(r.sec - 600) < 30, `after the highway ~600s remain, got ${Math.round(r.sec)}`);

  // What the old interpolation would have claimed: 900 * (2000/12000) = 150s.
  // Two and a half minutes for a leg that genuinely takes ten.
  const interpolated = 900 * (2000 / 12000);
  assert.ok(
    r.sec > interpolated * 3,
    `summed estimate (${Math.round(r.sec)}s) must far exceed the interpolated one (${Math.round(interpolated)}s)`
  );
  ok('remaining time sums the steps ahead instead of interpolating the total');

  // Distance stays exact either way.
  assert.ok(Math.abs(r.distM - 2000) < 1, 'remaining distance is route length minus progress');
  ok('remaining distance is unaffected');
}

{
  // A route with no per-step timings (an older response, or a provider that
  // omits them) must still produce a sane number rather than zero.
  const path = [];
  for (let i = 0; i <= 50; i++) path.push({ lat: 26.0 + i * 0.001, lng: -80.1, step: 0 });
  const c = new NavController();
  c.setRoute({ path, steps: [{ action: 'Continue', road: 'X' }], totalDistM: 5000, totalDurSec: 600 });
  c.progressM = 2500;
  const r = c.remaining();
  assert.ok(r.sec > 0, 'falls back to interpolation when steps carry no durations');
  ok('degrades to interpolation when per-step timings are missing');
}


// --- looking for a faster route -------------------------------------------
{
  const path = [];
  for (let i = 0; i <= 100; i++) path.push({ lat: 26.0 + i * 0.001, lng: -80.1, step: 0 });
  const steps = [{ action: 'Continue', road: 'I-95', distM: 20000, durSec: 1800 }];
  const mk = () => {
    const c = new NavController();
    c.setRoute({ path, steps, totalDistM: 20000, totalDurSec: 1800 });
    c.startFollowing();
    return c;
  };

  // Not while still showing the initial overview — the driver has not started.
  const overview = new NavController();
  overview.setRoute({ path, steps, totalDistM: 20000, totalDurSec: 1800 });
  assert.equal(overview.shouldCheckAlternate(0), false, 'no alternate check during overview');
  ok('does not hunt for alternates before the driver sets off');

  // First check is allowed; a second immediately after is not.
  const c = mk();
  assert.equal(c.shouldCheckAlternate(0), true, 'first check allowed');
  c.markAlternateChecked(0);
  assert.equal(c.shouldCheckAlternate(1000), false, 'no re-check one second later');
  assert.equal(c.shouldCheckAlternate(130000), true, 're-check after the interval');
  ok('alternate checks are rate limited');

  // Near the end, a switch cannot save enough to be worth redrawing the route.
  const nearlyThere = mk();
  nearlyThere.progressM = 19500;      // ~30s of a 30-minute route left
  nearlyThere.markAlternateChecked(-Infinity);
  assert.equal(nearlyThere.shouldCheckAlternate(999999), false, 'no checks in the last minutes');
  ok('stops hunting for alternates near the destination');

  // Never hunt for an alternate while off-route: a deviation reroute is
  // already coming, the two share the RequestGuard, and a candidate would be
  // judged against a route the driver has left.
  const strayed = mk();
  strayed.markAlternateChecked(-Infinity);
  for (let i = 0; i < 2; i++) strayed.onPosition({ lat: 26.05, lng: -80.4, speedMph: 40 }, 1000 + i * 1000);
  assert.ok(strayed.offStreak > 0, 'driver is off-route for this check');
  assert.equal(strayed.shouldCheckAlternate(999999), false, 'no alternate hunt while off-route');
  ok('does not hunt for alternates while off-route');

  // And the acceptance bar itself.
  const d = mk();                      // 1800s remaining
  assert.equal(d.isWorthSwitching(1500), true, '5 minutes faster is worth it');
  assert.equal(d.isWorthSwitching(1740), false, '1 minute faster is noise');
  assert.equal(d.isWorthSwitching(1800), false, 'no saving is not a reason to switch');
  assert.equal(d.isWorthSwitching(2400), false, 'never switch to a slower route');
  ok('only a materially faster route is adopted');
}


// --- visual position: snapping, and refusing to snap ----------------------
// The distinction this group exists for: a car drawn on a road it is not on is
// worse than a car drawn slightly off the road. Noise gets absorbed; a genuine
// departure gets shown.
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();

  // A fix 15m east of the line — ordinary urban GPS error.
  const noisy = { lat: 26.3530, lng: LNG + 0.00015 };
  c.onPosition(noisy);
  const a = c.visualPosition();
  assert.ok(a.snapped, 'a fix inside the corridor is drawn on the road');
  assert.ok(Math.abs(a.lng - LNG) < 1e-9, 'snapped position sits ON the line');
  ok('GPS noise inside the corridor is absorbed onto the route');

  // A fix ~150m east — the driver is on a different road.
  const off = { lat: 26.3535, lng: LNG + 0.0015 };
  c.onPosition(off);
  const b = c.visualPosition();
  assert.equal(b.snapped, false, 'a genuine departure is NOT snapped');
  assert.ok(Math.abs(b.lng - off.lng) < 1e-9, 'off-route draws the raw fix');
  ok('a real departure is drawn where the driver actually is');

  // The corridor is stricter than the reroute threshold, on purpose: there is a
  // band where we still believe the route but no longer claim the exact road.
  assert.ok(c.config.snapCorridorM < c.config.deviationThreshM,
    'snap corridor must be tighter than the reroute threshold');
  ok('drawing is more conservative than rerouting');
}

// --- forward-only: noise must never reverse the car ----------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();
  c.onPosition({ lat: 26.3540, lng: LNG });
  const first = c.visualPosition();
  // A fix that lands slightly BEHIND the last one, which is constant at low
  // speed. The car must hold, not reverse.
  c.onPosition({ lat: 26.35398, lng: LNG + 0.00002 });
  const second = c.visualPosition();
  assert.ok(second.lat >= first.lat - 1e-9, 'visual position never moves backwards');
  ok('a backwards fix does not reverse the vehicle');
}

// --- trace lanes ---------------------------------------------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();
  c.onPosition({ lat: 26.3540, lng: LNG });

  const L = c.traceLanes();
  const done = [...L.donePast, ...L.doneNow];
  const live = [...L.now, ...L.ahead];
  assert.ok(done.length >= 2, 'the travelled road is drawable');
  assert.ok(live.length >= 2, 'the road ahead is drawable');

  // The seam has to sit exactly under the car, not at the nearest vertex.
  const seam = done[done.length - 1];
  const head = live[0];
  assert.ok(Math.abs(seam.lat - head.lat) < 1e-9 && Math.abs(seam.lng - head.lng) < 1e-9,
    'travelled ends exactly where the road ahead begins');
  const car = c.visualPosition();
  assert.ok(Math.abs(seam.lat - car.lat) < 1e-6, 'the seam sits under the vehicle');
  ok('trace lanes meet exactly at the vehicle');

  // Internal seams must be exact too, or the shared-colour trick shows a gap.
  if (L.donePast.length && L.doneNow.length) {
    const j = L.donePast[L.donePast.length - 1];
    assert.ok(Math.abs(j.lat - L.doneNow[0].lat) < 1e-9, 'donePast meets doneNow');
  }
  if (L.now.length && L.ahead.length) {
    const j = L.now[L.now.length - 1];
    assert.ok(Math.abs(j.lat - L.ahead[0].lat) < 1e-9, 'now meets ahead');
  }
  ok('the internal seams are exact, so the shared colours read as one line');

  // End to end: the four pieces reconstruct the whole route.
  assert.ok(Math.abs(L.donePast.length ? L.donePast[0].lat : done[0].lat - c.path[0].lat) < 1,
    'coverage starts at the route start');
  const last = L.ahead[L.ahead.length - 1];
  assert.ok(Math.abs(last.lat - c.path[c.path.length - 1].lat) < 1e-9,
    'coverage reaches the destination');
  ok('the four lanes cover the route end to end');

  // The per-fix arrays must stay bounded by ONE STEP, which is the whole point
  // of cutting at the step boundary as well as at the driver.
  assert.ok(L.doneNow.length <= c.path.length && L.now.length <= c.path.length);
  assert.ok(L.donePast.length + L.doneNow.length + L.now.length + L.ahead.length
    <= c.path.length + 8, 'no piece duplicates the whole route');
  ok('the arrays redrawn every fix are bounded by the current step');

  // Before any fix, nothing has been travelled — the whole route is ahead.
  const fresh = new NavController();
  fresh.setRoute(pickupRoute());
  const l0 = fresh.traceLanes();
  assert.equal(l0.donePast.length + l0.doneNow.length, 0, 'nothing travelled before the first fix');
  ok('a fresh route shows no false progress');

  // No route at all must not throw or invent geometry.
  assert.deepEqual(new NavController().traceLanes(),
    { donePast: [], doneNow: [], now: [], ahead: [] });
  ok('no route yields empty lanes rather than a crash');
}

// --- the camera follows what is DRAWN ------------------------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();
  c.onPosition({ lat: 26.3500, lng: LNG });
  // A fix inside the corridor but off the line. The camera must centre on the
  // snapped point, or the car slides around a map that is holding still.
  const r = c.onPosition({ lat: 26.3540, lng: LNG + 0.0002 });
  assert.ok(r.camera, 'a camera update was produced');
  const v = c.visualPosition();
  assert.ok(v.snapped, 'precondition: this fix snaps');
  // lookAheadCenter offsets ahead of the driver, so compare longitude, which
  // the look-ahead does not move when heading north.
  assert.ok(Math.abs(r.camera.center.lng - v.lng) < Math.abs(r.camera.center.lng - 
    (LNG + 0.0002)), 'camera tracks the drawn position, not the raw fix');
  ok('the camera follows the vehicle as drawn');
}

// --- a reroute must not leave the car on the old line ---------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();
  c.onPosition({ lat: 26.3540, lng: LNG });
  assert.ok(c.visualPosition().snapped, 'precondition: on the first route');

  // A new route on a different street. The cached snap was measured against
  // geometry that no longer exists.
  c.setRoute({
    path: [{ lat: 26.3540, lng: -80.2, step: 0 }, { lat: 26.3600, lng: -80.2, step: 0 }],
    steps: [{ action: 'Continue straight', road: 'New Rd', maneuver: 'straight' }],
    totalDurSec: 120,
  }, { reroute: true });

  const v = c.visualPosition();
  const onNew = Math.abs(v.lng - (-80.2)) < 1e-6;
  assert.ok(onNew || !v.snapped,
    'after a reroute the car is on the NEW line, or honestly off it — never on the old one');
  ok('a reroute re-places the vehicle immediately');
}

// --- heading borrows the road, but only when snapped ---------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();
  // Moving north along the route with NO device heading. The road's own
  // bearing should orient the car, not a noisy fix-to-fix bearing.
  c.onPosition({ lat: 26.3500, lng: LNG, heading: null });
  c.onPosition({ lat: 26.3530, lng: LNG + 0.00012, heading: null });
  const h = c.stableHeading;
  assert.ok(h != null && (h < 20 || h > 340), `expected ~north, got ${h}`);
  ok('the road orients the car when the device reports no heading');

  // A device heading, when present and sane, wins over the road.
  c.onPosition({ lat: 26.3545, lng: LNG, heading: 88 });
  assert.equal(c.stableHeading, 88, 'device heading takes priority');
  ok('device heading outranks the road bearing');

  // Junk headings are rejected rather than believed.
  const before = c.stableHeading;
  c.onPosition({ lat: 26.3560, lng: LNG, heading: -1 });
  assert.notEqual(c.stableHeading, -1, 'an out-of-range heading is refused');
  ok('out-of-range device headings are discarded');
}


// --- approaching the pickup ----------------------------------------------
// The last 200m is a different task from route following. "Which road next"
// becomes "where exactly do I stop", and the camera has to change job.
{
  const path = [];
  for (let i = 0; i < 40; i++) path.push({ lat: 26.30 + i * 0.0002, lng: LNG, step: 0 });
  const c = new NavController();
  c.setRoute({ path, steps: [{ action: 'Continue straight', road: 'A', maneuver: 'straight', distM: 880, durSec: 90 }],
    totalDistM: 880, totalDurSec: 90 });
  c.startFollowing();

  const phaseAt = (i) => { c.onPosition({ lat: path[i].lat, lng: path[i].lng, speedMph: 35 }); return c.cameraFor(c.lastPos); };
  assert.equal(phaseAt(0).phase, 'cruise', 'far out is cruise');
  assert.equal(phaseAt(28).phase, 'cruise', 'still cruise at ~250m');
  const approach = phaseAt(33);
  assert.equal(approach.phase, 'approach', 'inside 200m is approach');
  const arriving = phaseAt(38);
  assert.equal(arriving.phase, 'arriving', 'inside 60m is arriving');
  ok('the camera changes task as the destination comes in');

  // Tightening only. A driver still moving fast must never be zoomed in past
  // what they can react to, so the phase sets a FLOOR, not a value.
  assert.ok(arriving.zoom > approach.zoom, 'arriving is tighter than approach');
  const fast = new NavController();
  fast.setRoute({ path, steps: [{ action: 'x', road: 'A', maneuver: 'straight', distM: 880, durSec: 90 }],
    totalDistM: 880, totalDurSec: 90 });
  fast.startFollowing();
  fast.onPosition({ lat: path[38].lat, lng: path[38].lng, speedMph: 0 });
  const stopped = fast.cameraFor(fast.lastPos);
  assert.ok(stopped.zoom >= arriving.zoom, 'a stopped driver is never zoomed out by the phase');
  ok('phases raise the zoom floor and never override speed downward');

  // No route: no phase machinery, no crash.
  assert.equal(new NavController().approachPhase(), 'cruise', 'no route means cruise');
  ok('the phase degrades safely with no route');
}


// --- the off-route connector ---------------------------------------------
// A car drawn at its real coordinate while the route starts somewhere else
// reads as broken, even though it is the honest rendering. The dashed link
// says "you are here, the route is there" without faking a snap.
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();

  // On the line: nothing to draw.
  c.onPosition({ lat: 26.3530, lng: LNG });
  assert.ok(c.visualPosition().snapped, 'precondition: snapped');
  assert.equal(c.routeConnector(), null, 'no connector while the car is on the route');
  ok('no connector is drawn when the vehicle is on the line');

  // Off the line: a two-point link from the car to the nearest route point.
  c.onPosition({ lat: 26.3535, lng: LNG + 0.0015 });
  const link = c.routeConnector();
  assert.ok(Array.isArray(link) && link.length === 2, 'connector is a two-point path');
  assert.ok(Math.abs(link[0].lng - (LNG + 0.0015)) < 1e-9, 'it starts at the real GPS fix');
  assert.ok(Math.abs(link[1].lng - LNG) < 1e-6, 'it ends on the route');
  ok('off the line, the connector spans the real gap');

  // No route at all: nothing, rather than a crash or a line to nowhere.
  assert.equal(new NavController().routeConnector(), null, 'no route means no connector');
  ok('the connector degrades safely with no route');
}


// --- the camera must not hide the destination ----------------------------
// Reproduces the screenshot: parked facing north-east with the pickup to the
// west. Aiming the look-ahead along the heading pushed the pin off the left
// edge while a third of the map showed empty ground behind the car.
{
  const car = { lat: 26.592330, lng: -80.138560 };
  const pick = { lat: 26.592553, lng: -80.138948 };
  const path = [car, { lat: 26.592400, lng: -80.138700 }, pick].map((p) => ({ ...p, step: 0 }));
  const c = new NavController();
  c.setViewport(700);
  c.setRoute({ path, steps: [{ action: 'x', road: 'Deerfield Pl', maneuver: 'straight', distM: 50, durSec: 30 }],
    totalDistM: 50, totalDurSec: 30 });
  c.startFollowing();
  c.onPosition({ lat: car.lat, lng: car.lng, heading: 45, speedMph: 0 });
  c.stableHeading = 45; // stale: facing north-east, pickup is west

  const cam = c.cameraFor(c.lastPos);
  const toDest = bearing(car, pick);
  const toCam = bearing(car, cam.center);
  const apart = Math.abs(((toCam - toDest + 540) % 360) - 180);
  assert.ok(apart < 15, `camera should aim at the destination, ${apart.toFixed(0)}deg off`);
  ok('approaching, the camera aims at the destination rather than a stale heading');

  // While actually driving a route it must still look AHEAD, not at a
  // destination that may be miles away in another direction.
  const long = [];
  for (let i = 0; i < 60; i++) long.push({ lat: 26.30 + i * 0.002, lng: -80.1, step: 0 });
  const d = new NavController();
  d.setViewport(700);
  d.setRoute({ path: long, steps: [{ action: 'x', road: 'A', maneuver: 'straight', distM: 13000, durSec: 900 }],
    totalDistM: 13000, totalDurSec: 900 });
  d.startFollowing();
  d.onPosition({ lat: long[2].lat, lng: long[2].lng, heading: 0, speedMph: 40 });
  const cruise = d.cameraFor(d.lastPos);
  assert.equal(cruise.phase, 'cruise', 'precondition: still cruising');
  const ahead = bearing(d.lastPos, cruise.center);
  assert.ok(Math.abs(((ahead - 0 + 540) % 360) - 180) < 15, 'cruise camera looks along the heading');
  ok('cruising, the camera still looks along the road ahead');
}

// --- heading must not be believed at crawling speed ----------------------
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();
  c.onPosition({ lat: 26.3500, lng: LNG, heading: 0, speedMph: 30 });
  // Driving properly: the device knows which way the car points.
  c.onPosition({ lat: 26.3530, lng: LNG, heading: 88, speedMph: 30 });
  assert.equal(c.stableHeading, 88, 'a moving car trusts its device heading');
  ok('at speed the device heading is used');

  // Crawling: CoreLocation derives course from position deltas, so at walking
  // pace it is mostly noise. The road is the better answer.
  const slow = new NavController();
  slow.setRoute(pickupRoute());
  slow.startFollowing();
  slow.onPosition({ lat: 26.3500, lng: LNG, heading: 0, speedMph: 1 });
  slow.onPosition({ lat: 26.3530, lng: LNG, heading: 217, speedMph: 1 });
  assert.notEqual(slow.stableHeading, 217, 'a crawling car does not believe a wild device heading');
  assert.ok(slow.stableHeading < 20 || slow.stableHeading > 340,
    `expected the road bearing (~north), got ${slow.stableHeading}`);
  ok('at crawling speed the road bearing wins over the device');
}

// --- which side of the road to stop on -----------------------------------
{
  // Eastbound road; north is left, south is right.
  const path = [{ lat: 26.5, lng: -80.10, step: 0 }, { lat: 26.5, lng: -80.099, step: 0 }, { lat: 26.5, lng: -80.098, step: 0 }];
  const mk = () => {
    const c = new NavController();
    c.setRoute({ path, steps: [{ action: 'x', road: 'A', maneuver: 'straight', distM: 200, durSec: 30 }],
      totalDistM: 200, totalDurSec: 30 });
    return c;
  };
  assert.equal(mk().arrivalSide({ lat: 26.5003, lng: -80.098 }), 'left', 'north of an eastbound road is left');
  assert.equal(mk().arrivalSide({ lat: 26.4997, lng: -80.098 }), 'right', 'south of an eastbound road is right');
  ok('the side of the road is derived from the direction of travel');

  // Silence beats a confident wrong answer: a driver told "on your right" who
  // stops opposite the rider is worse off than one told nothing.
  assert.equal(mk().arrivalSide({ lat: 26.5, lng: -80.0975 }), null, 'straight ahead has no side');
  assert.equal(mk().arrivalSide({ lat: 26.5, lng: -80.098 }), null, 'a point on the road has no side');
  assert.equal(mk().arrivalSide(null), null, 'no address point, no claim');
  assert.equal(mk().arrivalSide({ lat: NaN, lng: 0 }), null, 'a nonsense point makes no claim');
  assert.equal(new NavController().arrivalSide({ lat: 26.5, lng: -80.1 }), null, 'no route, no claim');
  ok('the side is withheld whenever it would not be trustworthy');
}


// --- distance to the next maneuver ---------------------------------------
// "Turn right onto Deerfield Pl" without a distance is a fact, not an
// instruction: the driver still has to work out whether it means now or after
// the next two junctions.
{
  const c = new NavController();
  c.setRoute(pickupRoute());
  c.startFollowing();

  assert.equal(new NavController().distanceToManeuver(), null, 'no route, no claim');

  c.onPosition({ lat: 26.3500, lng: LNG });
  const far = c.distanceToManeuver();
  c.onPosition({ lat: 26.3530, lng: LNG });
  const near = c.distanceToManeuver();
  assert.ok(far > near, `must count down: ${far} then ${near}`);
  assert.ok(near >= 0, 'never negative');
  ok('the distance to the turn counts down as the driver approaches it');

  // It must reset upward at a step boundary rather than going negative — the
  // next maneuver is further away than the one just taken.
  c.onPosition({ lat: 26.3550, lng: LNG }); // end of step 0
  const atTurn = c.distanceToManeuver();
  c.onPosition({ lat: 26.3560, lng: LNG }); // into step 1
  assert.equal(c.stepIndex, 1, 'precondition: advanced a step');
  assert.ok(c.distanceToManeuver() > atTurn, 'the next maneuver is further away again');
  ok('it re-targets the next maneuver at a step boundary');

  // Never larger than what is left of the whole route.
  assert.ok(c.distanceToManeuver() <= c.remaining().distM + 1,
    'a maneuver cannot be beyond the end of the route');
  ok('it never exceeds the distance remaining');
}


console.log(`\nnavController: ${n}/9 lifecycle groups passed`);
