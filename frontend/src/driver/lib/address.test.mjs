// Address display. Run: node frontend/src/driver/lib/address.test.mjs
import assert from 'node:assert';
import { shortAddress, addressLines } from './address.js';
let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

// The exact string that produced "5941, Deerfield Place" on the driver's
// screen. OSM puts the house number in its own comma part.
{
  const osm = '5941, Deerfield Place, Palm Beach County, Florida, 33463, United States';
  assert.equal(shortAddress(osm), '5941 Deerfield Place');
  ok('the house number rejoins its street instead of reading as a list');
}

// Google returns state and ZIP as ONE part ("FL 33487"); filtering them
// separately missed both and left the tail on, which forced the truncation.
{
  assert.equal(shortAddress('6001 Broken Sound Parkway Northwest, Boca Raton, FL 33487, USA'),
    '6001 Broken Sound Parkway Northwest, Boca Raton');
  assert.equal(shortAddress('12 Main St, Atlanta, GA 30301, USA'), '12 Main St, Atlanta');
  assert.equal(shortAddress('200 S Biscayne Blvd, Miami, FL 33131-2310, USA'), '200 S Biscayne Blvd, Miami');
  ok('state and ZIP are dropped in either format, in any state');
}

// Two-line display: the street number must never share a line with anything
// that could push it into a truncation.
{
  const l = addressLines('5941 Deerfield Pl, Greenacres, FL 33463, USA');
  assert.equal(l.street, '5941 Deerfield Pl');
  assert.equal(l.locality, 'Greenacres');
  ok('street and locality split for a two-line card');
}

// Degenerate input must not throw.
{
  for (const bad of ['', null, undefined, ',,,', '   ']) {
    const l = addressLines(bad);
    assert.equal(typeof l.street, 'string');
    assert.equal(typeof l.locality, 'string');
  }
  assert.equal(shortAddress(null), '');
  ok('empty and malformed addresses degrade quietly');
}

console.log(`\n  address: ${n}/4 groups passed\n`);
