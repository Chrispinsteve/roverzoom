// Pickup accuracy audit.
//
// Runs the full resolution pipeline for a list of addresses and reports where
// each stage lands, so an inaccurate pickup can be attributed to a stage rather
// than guessed at:
//
//   address -> geocode (source + precision) -> route -> road access point
//                                                    -> offset -> verdict
//
// This exists because pickup accuracy failed silently and invisibly. The
// Geocoding API is not enabled for this project, so every address fell through
// to OpenStreetMap, and nothing anywhere reported that it had happened or how
// far off the result was.
//
//   node backend/scripts/pickup-audit.js ["addr one" "addr two" ...]
require('dotenv').config();
const { geocodeOne } = require('../services/geocode');
const { navRoute, metresBetween, ACCESS_VERIFY_THRESHOLD_M } = require('../services/routing');

// Representative pickup shapes. Each is a different way a coordinate can be
// wrong, not just a different address.
const SCENARIOS = [
  ['A residential',        '5941 Deerfield Pl, Greenacres, FL'],
  ['B apartment complex',  'Camden Boca Raton, 1400 NW 15th Ave, Boca Raton, FL'],
  ['C shopping centre',    'Town Center at Boca Raton, Boca Raton, FL'],
  ['D commercial tower',   '5000 T-Rex Ave, Boca Raton, FL'],
  ['E divided highway',    '1515 N Federal Hwy, Boca Raton, FL'],
  ['F cul-de-sac',         '5875 Deerfield Pl, Greenacres, FL'],
  ['G airport terminal',   'Palm Beach International Airport, West Palm Beach, FL'],
  ['H hospital campus',    'Boca Raton Regional Hospital, Boca Raton, FL'],
];

// A driver origin far enough away that the route is a real one.
const ORIGIN = { lat: 26.5905, lng: -80.1400 };

(async () => {
  const custom = process.argv.slice(2);
  const rows = custom.length ? custom.map((a, i) => [`custom ${i + 1}`, a]) : SCENARIOS;
  console.log(`\n  pickup audit — threshold ${ACCESS_VERIFY_THRESHOLD_M}m\n`);
  let flagged = 0;
  for (const [name, query] of rows) {
    const g = await geocodeOne(query);
    if (!g) { console.log(`  ${name.padEnd(22)} GEOCODE FAILED`); continue; }
    const r = await navRoute(ORIGIN, { lat: g.lat, lng: g.lng });
    const off = r.ok && r.accessOffsetM != null ? r.accessOffsetM : null;
    const verdict = !r.ok ? `no route (${r.reason})`
      : off > ACCESS_VERIFY_THRESHOLD_M ? 'VERIFY WITH RIDER' : 'ok';
    if (verdict === 'VERIFY WITH RIDER') flagged++;
    console.log(`  ${name.padEnd(22)} ${String(g.source || '?').padEnd(14)} ${String(g.precision || '?').padEnd(10)}` +
      ` access ${off == null ? '   —  ' : (off.toFixed(1) + 'm').padStart(7)}   ${verdict}`);
    console.log(`  ${''.padEnd(22)} ${g.address?.slice(0, 68) || ''}`);
  }
  console.log(`\n  ${rows.length} audited, ${flagged} flagged for verification\n`);
})();
