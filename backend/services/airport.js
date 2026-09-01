// Airport rides need three facts the driver cannot work out from a map:
// which terminal, which side of it, and which airline desk.
//
// Today the driver asks the rider through the window. That fails exactly when
// it matters most — a driver who is deaf, a driver and rider without a shared
// language, a rider who has just got off a red-eye — and it fails at the kerb,
// where there is nowhere to stop and work it out. Asking at BOOKING time, once,
// in the rider's own language and their own time, removes the conversation from
// the kerb entirely.
//
// Direction is DERIVED, never asked. If the airport is the drop-off the rider
// is flying out; if it is the pickup they have landed. Asking a question whose
// answer is already known is how forms get abandoned.

// Matched on the geocoded address text. Deliberately a small list of the
// airports actually served rather than a general "is this an airport" guess —
// a false positive interrupts an ordinary booking with an irrelevant question.
const AIRPORTS = [
  {
    code: 'PBI',
    name: 'Palm Beach International',
    match: /palm beach international|\bPBI\b|james l\.? turnage/i,
    // One terminal, three concourses. Riders read the concourse off a boarding
    // pass, so those are the useful chips.
    zones: ['Concourse A', 'Concourse B', 'Concourse C'],
    zoneLabel: 'Concourse',
  },
  {
    code: 'FLL',
    name: 'Fort Lauderdale–Hollywood International',
    match: /fort lauderdale[- –]?hollywood|\bFLL\b|fort lauderdale international/i,
    zones: ['Terminal 1', 'Terminal 2', 'Terminal 3', 'Terminal 4'],
    zoneLabel: 'Terminal',
  },
  {
    code: 'MIA',
    name: 'Miami International',
    match: /miami international airport|\bMIA\b/i,
    zones: ['Concourse D', 'Concourse E', 'Concourse F', 'Concourse G', 'Concourse H', 'Concourse J'],
    zoneLabel: 'Concourse',
  },
];

// Airlines common at these three, so the rider taps rather than types. Free
// text stays available: this list is a shortcut, not a constraint.
const COMMON_AIRLINES = [
  'American', 'Delta', 'United', 'Southwest', 'JetBlue',
  'Spirit', 'Frontier', 'Alaska', 'Air Canada', 'British Airways',
];

function airportFor(address) {
  if (!address) return null;
  const text = String(address);
  return AIRPORTS.find((a) => a.match.test(text)) || null;
}

// Which end of the trip is the airport, and therefore what the rider is doing.
// Returns null when neither end is one, which is almost every ride.
function detectAirportLeg({ pickupAddress, dropoffAddress }) {
  const drop = airportFor(dropoffAddress);
  if (drop) return { role: 'departure', code: drop.code, name: drop.name, zones: drop.zones, zoneLabel: drop.zoneLabel };
  const pick = airportFor(pickupAddress);
  if (pick) return { role: 'arrival', code: pick.code, name: pick.name, zones: pick.zones, zoneLabel: pick.zoneLabel };
  return null;
}

// Trim and bound what gets stored. These strings are displayed to a driver at
// the kerb, so a 500-character "terminal" is not a value, it is a problem.
function cleanFlightDetails(input, leg) {
  if (!leg || !input) return null;
  const str = (v, max) => {
    const t = String(v ?? '').trim().replace(/\s+/g, ' ');
    return t ? t.slice(0, max) : null;
  };
  const zone = str(input.zone, 40);
  const airline = str(input.airline, 40);
  const flight = str(input.flight, 12);
  if (!zone && !airline && !flight) return null;
  return {
    airport_role: leg.role,
    airport_code: leg.code,
    airport_zone: zone,
    airport_airline: airline,
    airport_flight: flight ? flight.toUpperCase() : null,
  };
}

module.exports = { AIRPORTS, COMMON_AIRLINES, airportFor, detectAirportLeg, cleanFlightDetails };
