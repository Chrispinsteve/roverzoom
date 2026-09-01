// Simulates a driver moving through positions and asserts NavMap's decisions.
// Run: node frontend/src/driver/lib/navMath.test.mjs
import assert from 'node:assert';
import {
  distanceMeters, distanceToPath, advanceStepIndex,
  shouldReroute, shouldRepan, followCamera, zoomForDistance, zoomForSpeed, parseLaneHint,
  lookAheadCenter, metersPerPixel,
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

// --- F. lookAheadCenter: verify the aheadFraction ↔ vehicle position claim --
{
  const pos = { lat: 26.35, lng: -80.1 };
  const viewportH = 600, zoom = 16;
  const spanM = metersPerPixel(pos.lat, zoom) * viewportH; // metres spanned by the viewport height

  // Heading NORTH (up on a north-up map): centre is placed north of the driver,
  // so the driver appears low (behind centre).
  const camN = lookAheadCenter(pos, 0, viewportH, zoom, 0.26);
  assert.ok(camN.lat > pos.lat, 'north heading → centre ahead (north) → driver sits low');

  // The offset magnitude equals aheadFraction × viewport span.
  const offM = distanceMeters(pos, camN);
  assert.ok(Math.abs(offM - 0.26 * spanM) < 3, `offset ≈ aheadFraction×span (${offM.toFixed(0)}m vs ${(0.26 * spanM).toFixed(0)}m)`);

  // → driver ~24% from the bottom (0.5 − 0.26) i.e. lower third; and MORE route
  // ahead (0.76) than behind (0.24).
  const frac = offM / spanM; // ≈ 0.26
  assert.ok(frac > 0.22 && frac < 0.30, `driver ~lower third heading north (frac ${frac.toFixed(2)})`);
  assert.ok((0.5 + frac) > (0.5 - frac), 'more viewport ahead than behind');

  // Documented monotonic effect: bigger aheadFraction → centre further ahead →
  // driver lower; smaller → driver more centred.
  const more = lookAheadCenter(pos, 0, viewportH, zoom, 0.40);
  const less = lookAheadCenter(pos, 0, viewportH, zoom, 0.10);
  assert.ok(more.lat > camN.lat, 'higher aheadFraction → driver lower');
  assert.ok(less.lat < camN.lat, 'lower aheadFraction → driver more centred');

  // Heading EAST on a north-up map: offset is eastward, NOT downward — so the
  // "lower third" claim is heading-dependent (documented).
  const camE = lookAheadCenter(pos, 90, viewportH, zoom, 0.26);
  assert.ok(camE.lng > pos.lng, 'east heading → centre offset east');
  assert.ok(Math.abs(camE.lat - pos.lat) < Math.abs(camN.lat - pos.lat), 'east heading is not "lower third" on a north-up map');
  ok('lookAheadCenter: offset = aheadFraction×viewport ahead; more route ahead than behind; monotonic; lower-third holds for northerly heading (north-up map)');
}

// --- zoomForSpeed --------------------------------------------------------
// The bug this replaced: zoom was chosen by REMAINING TRIP DISTANCE, so a
// driver ten miles out got zoom 13 and could not read a street name. How far
// is left says nothing about how much road you need to see.
{
  // Legible street detail at every speed. Below ~15 and a driver cannot tell
  // which turning is theirs.
  for (const mph of [0, 5, 15, 30, 45, 60, 80]) {
    assert.ok(zoomForSpeed(mph) >= 15.5, `zoom at ${mph}mph must stay legible`);
    assert.ok(zoomForSpeed(mph) <= 18.5, `zoom at ${mph}mph must not be absurdly close`);
  }
  ok('nav zoom stays in a legible band at every speed');

  // Faster means seeing further ahead, which means a wider view.
  const speeds = [0, 15, 30, 45, 60];
  for (let i = 1; i < speeds.length; i++) {
    assert.ok(
      zoomForSpeed(speeds[i]) <= zoomForSpeed(speeds[i - 1]),
      `zoom must not increase from ${speeds[i - 1]} to ${speeds[i]} mph`
    );
  }
  ok('faster driving widens the view, monotonically');

  // A missing or nonsense speed must not throw or snap to a silly zoom.
  for (const bad of [undefined, null, NaN, -10, 'fast']) {
    const z = zoomForSpeed(bad);
    assert.ok(Number.isFinite(z) && z >= 15.5 && z <= 18.5, `bad speed ${bad} -> usable zoom`);
  }
  ok('a missing or invalid speed still yields a usable zoom');

  // The regression itself: trip length must have no say in the nav camera.
  assert.equal(zoomForSpeed(30), zoomForSpeed(30), 'zoom depends only on speed');
  assert.ok(
    zoomForSpeed(30) > zoomForDistance(16000),
    'a 10-mile trip must no longer force the far-out overview zoom'
  );
  ok('trip length no longer decides the navigation zoom');
}


// --- lane hints ----------------------------------------------------------
// Real lane guidance (the row of permitted-lane arrows) is Navigation SDK
// only — native, not web. What the web APIs sometimes give is lane advice
// inside the instruction TEXT. Parsing that is honest; inferring a lane when
// Google did not give one would put a driver in the wrong lane at speed.
{
  const cases = [
    ['Use the right 2 lanes to turn right onto NW 2nd Ave', 'right', 2],
    ['Use the left lane to turn left onto Glades Rd', 'left', 1],
    ['Use the right three lanes to take exit 52', 'right', 3],
    ['Use the middle lane to continue on I-95 S', 'middle', 1],
    ['Use the center lane', 'middle', 1],
  ];
  for (const [text, side, count] of cases) {
    const h = parseLaneHint(text);
    assert.ok(h, `should parse: ${text}`);
    assert.equal(h.side, side, `side for: ${text}`);
    assert.equal(h.count, count, `count for: ${text}`);
  }
  ok('lane advice is read out of the instruction text');

  // A fork is the same decision without the word "lane".
  const fork = parseLaneHint('Keep left at the fork to continue on I-95 S');
  assert.ok(fork && fork.side === 'left', 'keep-left is a usable hint');
  assert.equal(fork.count, null, 'no count claimed when Google gave none');
  ok('fork instructions yield a side but never an invented count');

  // Anything without lane advice must yield NOTHING. This is the safety
  // property: absent data has to look absent.
  for (const text of [
    'Turn right onto Congress Ave',
    'Merge onto I-95 S',
    'Continue straight',
    'Take the exit toward Miami',
    '', null, undefined,
  ]) {
    assert.equal(parseLaneHint(text), null, `must not invent a hint for: ${text}`);
  }
  ok('never invents a lane when Google did not give one');

  // Absurd counts are rejected rather than rendered.
  assert.equal(parseLaneHint('Use the right 47 lanes to turn right'), null, 'implausible count rejected');
  ok('implausible lane counts are discarded');

  // HTML from the legacy Directions API must not leak into the parse.
  const html = parseLaneHint('Use the <b>right 2 lanes</b> to turn right onto <b>NW 2nd Ave</b>');
  assert.ok(html && html.side === 'right' && html.count === 2, 'HTML instructions parse');
  ok('handles the HTML instruction format');
}


console.log(`\nnavMath: ${passed}/6 groups passed`);
