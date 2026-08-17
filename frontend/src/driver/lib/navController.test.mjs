// Drives the NavController with a simulated GPS stream and asserts the full
// navigation lifecycle. Run: node frontend/src/driver/lib/navController.test.mjs
import assert from 'node:assert';
import { NavController, RequestGuard } from './navController.js';

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

console.log(`\nnavController: ${n}/9 lifecycle groups passed`);
