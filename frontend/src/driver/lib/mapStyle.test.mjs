// Map styling invariants. Run: node frontend/src/driver/lib/mapStyle.test.mjs
import assert from 'node:assert';
import { NAV_STYLES, DETAIL_STYLES, DETAIL_ZOOM, stylesFor, stylesForZoom, mapOptionsFor } from './mapStyle.js';
import { NavController } from './navController.js';
let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

const blanketLabelsOff = (a) => a.some((r) => r.elementType === 'labels' && !r.featureType && !r.featureType);

// House numbers are a zoom decision, not a style decision: noise at speed,
// the entire task at the kerb.
{
  assert.ok(blanketLabelsOff(NAV_STYLES), 'route-following style suppresses labels wholesale');
  assert.ok(!blanketLabelsOff(DETAIL_STYLES), 'close-in style does not');
  assert.strictEqual(stylesForZoom(16), NAV_STYLES, 'quiet while route following');
  assert.strictEqual(stylesForZoom(19), DETAIL_STYLES, 'numbers close in');
  ok('house numbers are gated on zoom, not always on or always off');
}

// The camera forces 17.6 on approach and 18.4 on arrival. Both must reveal the
// numbers, or driving up to a pickup would not show the one label that matters.
{
  // Read the zooms OUT OF THE CAMERA rather than hardcoding them. They were
  // written in as 17.6 and 18.4, and when the camera moved to 18.0 and 19 this
  // test kept asserting the old pair — passing on numbers the app no longer
  // uses, which is worse than not testing it. Derived, it cannot drift again.
  const camZoom = (phase) => {
    const c = new NavController();
    const path = [];
    for (let i = 0; i < 40; i++) path.push({ lat: 26.30 + i * 0.0002, lng: -80.1, step: 0 });
    c.setRoute({ path, steps: [{ action: 'x', road: 'A', maneuver: 'straight', distM: 880, durSec: 90 }],
      totalDistM: 880, totalDurSec: 90 });
    c.startFollowing();
    // Place the driver where that phase applies, then read what the camera picks.
    const idx = phase === 'arriving' ? 38 : 33;
    c.onPosition({ lat: path[idx].lat, lng: path[idx].lng, speedMph: 35 });
    const cam = c.cameraFor(c.lastPos);
    assert.equal(cam.phase, phase, `expected phase ${phase}, got ${cam.phase}`);
    return cam.zoom;
  };
  // Two different things have to line up, and only one of them is ours:
  //
  //   the STYLE must enable the labels        — ours, driven by phase or zoom
  //   the TILES must actually carry them      — Google's, and only from ~19
  //
  // So approach enables the labels early (harmless: nothing to draw yet), and
  // the arriving camera is what has to clear the zoom where Google renders
  // them. Asserting the second is the one that catches a real regression.
  for (const phase of ['approach', 'arriving']) {
    assert.strictEqual(stylesFor({ zoom: camZoom(phase), phase }), DETAIL_STYLES,
      `the ${phase} phase must enable house-number labels`);
  }
  const arriving = camZoom('arriving');
  assert.ok(arriving >= DETAIL_ZOOM,
    `the arriving camera (${arriving}) must reach the zoom where labels render (${DETAIL_ZOOM})`);
  assert.ok(arriving >= 19,
    `Google draws house numbers from ~19; arriving camera is ${arriving}`);
  ok('the arriving camera reaches the zoom where numbers actually render');

  // Approaching is a statement about the TASK, not the scale. The opening
  // overview sits below any sensible zoom threshold, and a driver looking at
  // the map during it still needs to see which house they are heading for.
  assert.strictEqual(stylesFor({ zoom: 14, phase: 'approach' }), DETAIL_STYLES,
    'approaching reveals numbers even when zoomed out');
  assert.strictEqual(stylesFor({ zoom: 14, phase: 'arriving' }), DETAIL_STYLES,
    'arriving reveals numbers even when zoomed out');
  assert.strictEqual(stylesFor({ zoom: 14, phase: 'cruise' }), NAV_STYLES,
    'cruising far out stays quiet');
  ok('the approach phase reveals numbers regardless of zoom');
}

// Clutter stays gone at every zoom. Re-admitting labels must not re-admit
// points of interest and transit with them.
{
  for (const styles of [NAV_STYLES, DETAIL_STYLES]) {
    const off = (ft) => styles.some((r) => r.featureType === ft &&
      r.stylers?.some((s) => s.visibility === 'off'));
    assert.ok(off('poi'), 'points of interest stay off');
    assert.ok(off('transit'), 'transit stays off');
  }
  ok('POIs and transit stay suppressed in both styles');
}

// A mapId silently disables the styles array, so the two must never be sent
// together — that combination logs a warning and drops the styling.
{
  const raster = mapOptionsFor('');
  assert.ok(raster.styles && !raster.mapId, 'no mapId -> styled raster map');
  const vector = mapOptionsFor('abc123');
  assert.ok(vector.mapId && !vector.styles, 'mapId -> no styles array');
  ok('styles and mapId are never sent together');
}

// Degenerate zooms must still yield a usable style.
{
  for (const z of [undefined, null, NaN, -1]) {
    assert.ok(Array.isArray(stylesForZoom(z)), `zoom ${z} still yields a style array`);
  }
  assert.ok(Array.isArray(stylesFor()), 'no arguments still yields a style array');
  assert.ok(Array.isArray(stylesFor({})), 'an empty descriptor still yields a style array');
  ok('a missing or nonsense zoom still styles the map');
}

console.log(`\n  mapStyle: ${n}/5 groups passed\n`);
