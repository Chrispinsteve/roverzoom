// Simulates a driver moving through positions and asserts NavMap's decisions.
// Run: node frontend/src/driver/lib/navMath.test.mjs
import assert from 'node:assert';
import {
  distanceMeters, distanceToPath, advanceStepIndex,
  shouldReroute, shouldRepan, followCamera, zoomForDistance,
} from './navMath.js';

const P = (lat, lng = -80.1) => ({ lat, lng });
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

// --- A. Proximity zoom tightens as the driver nears the destination -------
{
  assert.equal(zoomForDistance(5000), 13);
  assert.equal(zoomForDistance(1500), 15);
  assert.equal(zoomForDistance(500), 16);
  assert.equal(zoomForDistance(200), 17);
  assert.equal(zoomForDistance(80), 18);
  // monotonic non-decreasing as distance shrinks (no zoom-out while approaching)
  let prev = 0;
  for (const d of [6000, 3000, 1500, 600, 200, 50]) {
    const z = zoomForDistance(d);
    assert.ok(z >= prev, `zoom should not drop: ${d}m -> ${z}`);
    prev = z;
  }
  ok('proximity zoom: farther=overview, closer=street-level, monotonic');
}

// --- B. Maneuver step advances as the driver passes each step end ---------
{
  const steps = [{ end: P(26.3510) }, { end: P(26.3520) }, { end: P(26.3530) }];
  let idx = 0;
  idx = advanceStepIndex(idx, steps, P(26.3490)); assert.equal(idx, 0);      // before step 0 end
  idx = advanceStepIndex(idx, steps, P(26.3512)); assert.equal(idx, 1);      // ~22m past step 0 end
  idx = advanceStepIndex(idx, steps, P(26.3521)); assert.equal(idx, 2);      // ~11m past step 1 end
  idx = advanceStepIndex(idx, steps, P(26.3540)); assert.equal(idx, 2);      // never past the last
  assert.equal(advanceStepIndex(2, steps, P(26.3490)), 2);                   // never goes backward
  ok('maneuver step tracks current step by position, forward-only');
}

// --- C. Reroute only on real deviation, respecting a cooldown -------------
{
  const path = [P(26.3500), P(26.3600)]; // N–S segment at lng -80.1
  const onRoute = distanceToPath(P(26.3550), path);
  assert.ok(onRoute < 5, `on-route ~${onRoute.toFixed(1)}m`);

  const noise = distanceToPath(P(26.3550, -80.0997), path); // ~30m east (GPS jitter)
  assert.ok(noise > 20 && noise < 45, `noise ~${noise.toFixed(1)}m`);
  assert.equal(shouldReroute({ noRoute: false, deviationM: noise, lastRerouteAt: 0, now: 1e5 }), false);

  const off = distanceToPath(P(26.3550, -80.0988), path); // ~120m east (wrong turn)
  assert.ok(off > 100, `off-route ~${off.toFixed(1)}m`);
  assert.equal(shouldReroute({ noRoute: false, deviationM: off, lastRerouteAt: 0, now: 1e5 }), true);
  // ...but not again inside the 8s cooldown
  assert.equal(shouldReroute({ noRoute: false, deviationM: off, lastRerouteAt: 99000, now: 1e5 }), false);
  // ...and the first fetch is always allowed
  assert.equal(shouldReroute({ noRoute: true, deviationM: 0, lastRerouteAt: 0, now: 0 }), true);
  ok('reroute: ignores GPS noise, fires on real deviation, throttled by cooldown');
}

// --- D. GPS noise must not shake the camera -------------------------------
{
  const c = P(26.3550);
  assert.equal(shouldRepan(c, P(26.35503)), false); // ~3m jitter -> no repan
  assert.equal(shouldRepan(c, P(26.35513)), true);  // ~14m real move -> repan
  assert.equal(shouldRepan(null, c), true);         // no prior center -> repan
  ok('camera anti-jitter: ignores tiny GPS moves, follows real movement');
}

// --- E. Follow camera looks AHEAD (vehicle sits lower third) --------------
{
  const dest = P(26.4000);
  const camN = followCamera({ ...P(26.3550), heading: 0 }, dest, 600); // heading north
  assert.ok(camN.center.lat > 26.3550, 'center ahead (north) of driver');
  assert.equal(camN.zoom, zoomForDistance(distanceMeters(P(26.3550), dest)));

  const camNoHeading = followCamera({ ...P(26.3550), heading: null }, dest, 600);
  assert.ok(camNoHeading.center.lat > 26.3550, 'no heading -> looks toward destination, still ahead');
  ok('follow camera centers ahead of the driver (road ahead visible)');
}

console.log(`\nnavMath: ${passed}/5 groups passed`);
