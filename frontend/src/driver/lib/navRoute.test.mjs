// Proves the DRIVER-VISIBLE pipeline end to end, on a real captured Routes API
// response:
//
//   server payload -> decoded road geometry -> route state -> driver projection
//   -> remaining geometry -> the arrays the polylines are actually drawn from
//
// This exists because that chain was broken end to end for the entire life of
// the driver map and nothing caught it: the browser's DirectionsService returns
// REQUEST_DENIED for this project, NavMap swallowed the failure with an early
// return, and the symptom was an empty map — no error, no log, no failing test.
// Unit tests on the controller all passed, because the controller was never
// given a route. So the assertion that matters here is the crude one: real
// bytes from Google end up as a line with length, following real roads.
//
// Run: node frontend/src/driver/lib/navRoute.test.mjs
import assert from 'node:assert';
import { parseNavRoute } from './navRoute.js';
import { NavController } from './navController.js';
import { distanceMeters } from './navMath.js';

let n = 0;
const ok = (name) => { n++; console.log('  \u2713', name); };

// Google's polyline algorithm. The browser uses the geometry library for this;
// implementing it here keeps the test free of a Maps dependency AND
// independently checks that what the server sent decodes to real coordinates.
function decodePath(encoded) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

// Captured from the live Routes API: Glades Rd -> NW 8th Ave, Boca Raton.
const FIXTURE = {
  "ok": true,
  "distanceMeters": 2048,
  "durationSec": 284,
  "polyline": "{`}_DddahNK?e@DWBM@_ANM@W?U@wCDaA@a@@q@@]@i@Aa@GSECAAACAYK?ACAIGOKSSQUGKCE?AGOIWEQEWAKCY?o@?eAEgABgF?iA?cF?g@AwB?_@?wAAmB?kA?GAgCFa@eJ@_C?cH?sB??s@?e@?W?Y?Y?MCOEMEMWc@X[VWTW@CbAmAFGVYn@w@@UKQe@k@",
  "steps": [
    {
      "polyline": "{`}_DddahNK?e@DWBM@_ANM@W?U@wCDaA@a@@q@@]@i@Aa@GSECAAACAYK?ACAIGOKSSQUGKCE?AGOIWEQEWAKCY?o@?eAEgABgF?iA?cF?g@AwB?_@?wAAmB?kA?GAgC",
      "distanceMeters": 1171,
      "durationSec": 119,
      "maneuver": "DEPART",
      "instruction": "Head north on Butts Rd toward Glades Rd"
    },
    {
      "polyline": "{y}_Dlt_hNFa@eJ@_C?cH?sB?",
      "distanceMeters": 514,
      "durationSec": 51,
      "maneuver": "TURN_LEFT",
      "instruction": "Turn left onto N Military Trl"
    },
    {
      "polyline": "qu~_Dls_hN?s@?e@?W?Y?Y?MCOEMEMWc@",
      "distanceMeters": 136,
      "durationSec": 18,
      "maneuver": "TURN_RIGHT",
      "instruction": "Turn right onto Banyan Trail"
    },
    {
      "polyline": "yv~_Dhk_hNX[VWTW@CbAmAFGVYn@w@@UKQe@k@",
      "distanceMeters": 228,
      "durationSec": 61,
      "maneuver": "TURN_RIGHT",
      "instruction": "Turn right\nDestination will be on the right"
    }
  ]
};

// --- 1. server payload -> geometry ---------------------------------------
const parsed = parseNavRoute(FIXTURE, decodePath);
assert.ok(parsed, 'payload parsed');
assert.ok(parsed.path.length > 20, `expected a detailed path, got ${parsed.path.length} points`);
assert.equal(parsed.steps.length, FIXTURE.steps.length, 'every step survived');
ok(`decoded ${parsed.path.length} road points from ${FIXTURE.steps.length} steps`);

// The line must FOLLOW ROADS, not cut between endpoints. A straight line
// between the two ends would be materially shorter than the driving distance.
const straight = distanceMeters(parsed.path[0], parsed.path[parsed.path.length - 1]);
let along = 0;
for (let i = 0; i < parsed.path.length - 1; i++) along += distanceMeters(parsed.path[i], parsed.path[i + 1]);
assert.ok(along > straight * 1.15,
  `geometry looks like a straight line: ${Math.round(along)}m along vs ${Math.round(straight)}m direct`);
assert.ok(Math.abs(along - FIXTURE.distanceMeters) < FIXTURE.distanceMeters * 0.05,
  `decoded length ${Math.round(along)}m should match Google's ${FIXTURE.distanceMeters}m`);
ok(`geometry follows roads: ${Math.round(along)}m along vs ${Math.round(straight)}m direct`);

// Every vertex must be attributable to a step, or the maneuver banner and the
// current-step highlight have nothing to key on.
assert.ok(parsed.path.every((p) => Number.isInteger(p.step)), 'every vertex carries a step index');
assert.ok(new Set(parsed.path.map((p) => p.step)).size > 1, 'vertices span multiple steps');
ok('every vertex is attributed to a maneuver step');

// --- 2. geometry -> route state ------------------------------------------
const c = new NavController();
c.setRoute(parsed);
assert.ok(c.hasRoute && c.path.length === parsed.path.length, 'controller holds the route');
assert.ok(c.totalDistM > 0 && c.totalDurSec > 0, 'route has distance and duration');
ok('route state accepted by the controller');

// --- 3. projection -> lanes -> what gets drawn ---------------------------
c.startFollowing();
const mid = Math.floor(parsed.path.length / 2);
c.onPosition({ lat: parsed.path[mid].lat, lng: parsed.path[mid].lng, speedMph: 30 });

const v = c.visualPosition();
assert.ok(v.snapped, 'a driver standing exactly on the route snaps to it');
const L = c.traceLanes();
const done = [...L.donePast, ...L.doneNow];
const live = [...L.now, ...L.ahead];
assert.ok(done.length > 1, 'the completed lane is drawable');
assert.ok(live.length > 1, 'the remaining lane is drawable');
assert.ok(Math.abs(done[done.length - 1].lat - live[0].lat) < 1e-9, 'the lanes meet');
ok(`lanes drawable at the halfway point: ${done.length} done / ${live.length} remaining`);

// --- 4. what the driver reads --------------------------------------------
const rem = c.remaining();
assert.ok(rem.distM > 0, 'remaining distance is not zero mid-route');
assert.ok(rem.sec > 0, 'remaining time is not zero mid-route');
assert.ok(rem.distM < c.totalDistM, 'remaining is less than the whole route');
const mi = rem.distM / 1609.34;
assert.ok(mi.toFixed(1) !== '0.0' || rem.distM < 161,
  'a non-trivial remaining distance must never format as 0.0 mi');
ok(`remaining reads ${mi.toFixed(2)} mi / ${Math.round(rem.sec / 60)} min`);

// The banner must show the step the driver is ON, not steps[0]. Proven by
// driving the whole route and checking the banner against the step each vertex
// actually belongs to.
//
// (An earlier version of this test asserted the driver was past step 0 at the
// halfway VERTEX. That was wrong about the data, not the code: step 0 here is
// 1171m of 2048m and holds 50 of the 76 vertices, so the halfway vertex is
// genuinely still step 0.)
{
  const walk = new NavController();
  walk.setRoute(parsed);
  walk.startFollowing();
  const seen = [];
  let lastIdx = -1;
  let regressions = 0;
  for (let i = 0; i < parsed.path.length; i++) {
    walk.onPosition({ lat: parsed.path[i].lat, lng: parsed.path[i].lng, speedMph: 25 });
    if (walk.stepIndex < lastIdx) regressions++;
    lastIdx = walk.stepIndex;
    if (!seen.includes(walk.stepIndex)) seen.push(walk.stepIndex);
    const s = walk.currentStep();
    assert.ok(s && s.action, `step ${walk.stepIndex} has an action to display`);
  }
  assert.equal(regressions, 0, 'the banner never goes backwards');
  assert.ok(seen.length > 1, `banner stayed on one step for the whole route: ${seen}`);
  assert.equal(seen[0], 0, 'starts at the first step');
  assert.equal(walk.stepIndex, parsed.steps.length - 1, 'ends on the final step');
  ok(`banner tracks progress through steps ${seen.join(' -> ')}, never backwards`);

  // And at the end of the route the driver has actually arrived.
  const end = walk.remaining();
  assert.ok(end.distM < 60, `expected to be at the destination, ${Math.round(end.distM)}m left`);
  ok('remaining distance reaches zero at the destination');
}

// --- 5. the failure that started all this --------------------------------
// A denied or empty response must produce NOTHING, so the caller shows its
// error state rather than a half-drawn map.
assert.equal(parseNavRoute({ ok: false }, decodePath), null, 'a failed payload yields null');
assert.equal(parseNavRoute(FIXTURE, undefined), null, 'no decoder yields null, not a crash');
const emptyParsed = parseNavRoute({ steps: [] }, decodePath);
assert.ok(!emptyParsed || emptyParsed.path.length < 2, 'an empty payload cannot produce a drawable line');
ok('an unusable response yields nothing to draw, not a broken line');

console.log(`\n  navRoute pipeline: ${n}/5 stages passed\n`);
