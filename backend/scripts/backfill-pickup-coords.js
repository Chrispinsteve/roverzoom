// Re-resolve stored booking coordinates against Google Places.
//
// Places-first geocoding fixed NEW bookings. Existing rows still hold whatever
// OpenStreetMap returned when they were created, and on a live booking that was
// 51.7m out — far enough to put the pin on a different house, verified against
// Google's own building labels.
//
// Dry run by default. Nothing is written without --apply.
//
//   node backend/scripts/backfill-pickup-coords.js            # report
//   node backend/scripts/backfill-pickup-coords.js --active   # live rides only
//   node backend/scripts/backfill-pickup-coords.js --apply    # write
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { geocodeOne } = require('../services/geocode');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Below this the difference does not change which building a driver stops at,
// and rewriting rows for it is churn.
const MIN_DRIFT_M = 15;
// Above this the two geocoders are not disagreeing about a doorstep, they are
// naming different places. Rewriting on that basis could move a pickup to
// another town, so it is reported for a human instead of applied.
const MAX_AUTO_M = 500;

const R = 6378137, rad = (x) => (x * Math.PI) / 180;
const metres = (a, b) => {
  const dp = rad(b.lat - a.lat), dl = rad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const ACTIVE = ['pending', 'accepted', 'driver_assigned', 'driver_en_route', 'arrived'];

async function resolve(addr, lat, lng) {
  if (!addr || lat == null || lng == null) return null;
  const stored = { lat: Number(lat), lng: Number(lng) };
  let g;
  try { g = await geocodeOne(addr); } catch { return null; }
  if (!g || g.source !== 'google_places' || g.precision !== 'rooftop') {
    return { stored, skip: g ? `precision=${g.precision || '?'} source=${g.source || '?'}` : 'no result' };
  }
  const drift = metres(stored, { lat: g.lat, lng: g.lng });
  return { stored, next: g, drift };
}

(async () => {
  const apply = process.argv.includes('--apply');
  const activeOnly = process.argv.includes('--active');

  let q = sb.from('bookings')
    .select('id,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,status,created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (activeOnly) q = q.in('status', ACTIVE);
  const { data, error } = await q;
  if (error) { console.error('  query failed:', error.message); process.exit(1); }

  console.log(`\n  ${apply ? 'APPLYING' : 'DRY RUN'} — ${data.length} booking(s), drift window ${MIN_DRIFT_M}-${MAX_AUTO_M}m\n`);
  let moved = 0, flagged = 0, clean = 0;

  for (const b of data) {
    const patch = {};
    const notes = [];
    for (const kind of ['pickup', 'dropoff']) {
      const r = await resolve(b[`${kind}_address`], b[`${kind}_lat`], b[`${kind}_lng`]);
      if (!r || r.skip) continue;
      if (r.drift < MIN_DRIFT_M) continue;
      if (r.drift > MAX_AUTO_M) {
        notes.push(`${kind} ${r.drift.toFixed(0)}m TOO FAR — needs a human`);
        flagged++;
        continue;
      }
      notes.push(`${kind} ${r.drift.toFixed(1)}m -> ${r.next.lat.toFixed(6)},${r.next.lng.toFixed(6)}`);
      patch[`${kind}_lat`] = r.next.lat;
      patch[`${kind}_lng`] = r.next.lng;
      moved++;
    }
    if (!notes.length) { clean++; continue; }
    console.log(`  ${b.status.padEnd(16)} ${(b.pickup_address || '').slice(0, 46)}`);
    for (const nline of notes) console.log(`      ${nline}`);
    if (apply && Object.keys(patch).length) {
      // The old values are printed above before anything is written, so a
      // mistaken run can be reversed from this output.
      const { error: upErr } = await sb.from('bookings').update(patch).eq('id', b.id);
      console.log(upErr ? `      WRITE FAILED: ${upErr.message}` : '      written');
    }
  }
  console.log(`\n  ${moved} coordinate(s) ${apply ? 'updated' : 'would move'}, ${flagged} flagged, ${clean} already correct\n`);
})();
