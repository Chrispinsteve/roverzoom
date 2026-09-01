// Map styling invariants. Run: node frontend/src/driver/lib/mapStyle.test.mjs
import assert from 'node:assert';
import { NAV_STYLES, DETAIL_STYLES, DETAIL_ZOOM, stylesForZoom, mapOptionsFor } from './mapStyle.js';
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
  for (const z of [17.6, 18.4]) {
    assert.strictEqual(stylesForZoom(z), DETAIL_STYLES, `arrival zoom ${z} must show house numbers`);
  }
  assert.ok(DETAIL_ZOOM < 17.6, 'the threshold sits below the approach zoom');
  ok('both camera arrival zooms reveal the numbers');
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
  ok('a missing or nonsense zoom still styles the map');
}

console.log(`\n  mapStyle: ${n}/5 groups passed\n`);
