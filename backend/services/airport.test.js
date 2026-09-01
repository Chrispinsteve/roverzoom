// Airport detection and the details stored from it.
// Run: node backend/services/airport.test.js
const assert = require('node:assert');
const { detectAirportLeg, cleanFlightDetails, airportFor } = require('./airport');

let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

// Direction is derived, never asked. Getting it backwards sends a driver to
// the wrong side of an airport — departures and arrivals are different roads.
{
  const out = detectAirportLeg({ pickupAddress: '5941 Deerfield Pl', dropoffAddress: 'Palm Beach International Airport, West Palm Beach, FL' });
  assert.equal(out.role, 'departure', 'airport as the DROP-OFF means flying out');
  const back = detectAirportLeg({ pickupAddress: 'Miami International Airport', dropoffAddress: 'Hotel, Miami Beach' });
  assert.equal(back.role, 'arrival', 'airport as the PICKUP means landed');
  ok('direction is derived from which end of the trip the airport is');
}

// A false positive interrupts an ordinary booking with an irrelevant question,
// so the match has to be tight.
{
  for (const addr of ['1000 Airport Rd, Boca Raton, FL', 'Airport Diner, Lantana', '200 Airport Plaza']) {
    assert.equal(detectAirportLeg({ pickupAddress: addr, dropoffAddress: 'Publix' }), null,
      `"${addr}" is not an airport`);
  }
  assert.equal(detectAirportLeg({ pickupAddress: 'Home', dropoffAddress: 'Boca Raton City Hall' }), null);
  assert.equal(detectAirportLeg({}), null, 'no addresses, no claim');
  ok('street names containing "airport" do not trigger the question');
}

// Each served airport is recognised and offers zones a rider can actually read
// off a boarding pass.
{
  for (const [q, code] of [
    ['Palm Beach International Airport', 'PBI'],
    ['Fort Lauderdale-Hollywood International Airport', 'FLL'],
    ['Miami International Airport, Miami, FL', 'MIA'],
  ]) {
    const a = airportFor(q);
    assert.ok(a, `${q} recognised`);
    assert.equal(a.code, code);
    assert.ok(a.zones.length > 0, `${code} offers zones`);
    assert.ok(['Terminal', 'Concourse'].includes(a.zoneLabel), `${code} labels its zones`);
  }
  ok('every served airport is recognised and offers pickable zones');
}

// What gets stored is bounded and normalised — these strings are shown to a
// driver at a kerb.
{
  const leg = detectAirportLeg({ pickupAddress: 'Home', dropoffAddress: 'Palm Beach International Airport' });
  const row = cleanFlightDetails({ zone: '  Concourse   B ', airline: 'jetBlue', flight: 'b6 1442' }, leg);
  assert.equal(row.airport_zone, 'Concourse B', 'whitespace collapsed');
  assert.equal(row.airport_flight, 'B6 1442', 'flight number upper-cased');
  assert.equal(row.airport_role, 'departure');
  assert.equal(row.airport_code, 'PBI');

  const long = cleanFlightDetails({ zone: 'x'.repeat(500) }, leg);
  assert.ok(long.airport_zone.length <= 40, 'a 500-character terminal is truncated, not stored');
  ok('stored values are trimmed, normalised and bounded');
}

// Nothing given, nothing written — a rider who skips still gets a booking.
{
  const leg = detectAirportLeg({ pickupAddress: 'Home', dropoffAddress: 'Palm Beach International Airport' });
  assert.equal(cleanFlightDetails({ zone: '', airline: '  ', flight: null }, leg), null, 'blank answers store nothing');
  assert.equal(cleanFlightDetails(null, leg), null, 'no answers at all store nothing');
  assert.equal(cleanFlightDetails({ zone: 'Terminal 1' }, null), null, 'not an airport ride, nothing stored');
  ok('skipping the question is a supported outcome, not an error');
}

console.log(`\n  airport: ${n}/5 groups passed\n`);
