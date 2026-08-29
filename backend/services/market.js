// Market comparison — a "compare at" reference price for the same trip.
//
// Shown under the locked price so a rider can see the difference without
// leaving to check.
//
// NO COMPETITOR IS NAMED. This follows the ordinary retail "Compare At"
// convention (Burlington, TJ Maxx, outlet pricing): a reference price for a
// comparable item sold on an everyday basis. Naming Uber or Lyft would turn a
// price display into comparative advertising about identified companies —
// their trademarks, their prices, and a claim each of them could dispute.
// The number is exactly as useful to the rider either way.
//
// The convention carries its own obligation: a "compare at" figure must be a
// real everyday price for a comparable purchase, not an invented anchor.
// Three rules keep ours defensible:
//
//  1. It is an ESTIMATE, presented as a range and rounded to whole dollars.
//     Anything more precise reads as a live quote, which it is not — we do not
//     call anyone's API, and rideshare prices surge.
//  2. Surge is never modelled. Ignoring it means the reference price is the
//     LOWEST it realistically goes, which matches "everyday basis, excluding
//     special promotions" and understates our advantage rather than
//     overstating it.
//  3. It only appears when we are cheaper than the cheapest comparable option
//     by a clear margin. On a short hop our $12 minimum makes us dearer; the
//     line simply does not render, rather than quietly flattering us.
//
// Rates are derived from published West Palm Beach per-mile and minimum fares
// for the two largest rideshare services, with 2026 national averages for base
// fare, per-minute and booking fee. Kept as named constants internally so the
// figures stay auditable — the names are never sent to the browser. All
// env-overridable so they can be corrected without a deploy.
//
// Set SHOW_MARKET_COMPARISON=false to switch the whole feature off instantly.

const num = (key, fallback) => Number(process.env[key]) || fallback;

// Reference operator A (larger of the two by share).
const UBER = {
  label: 'Uber',
  base: num('MARKET_UBER_BASE', 1.0),
  perMile: num('MARKET_UBER_PER_MILE', 0.97),
  perMinute: num('MARKET_UBER_PER_MIN', 0.32),
  booking: num('MARKET_UBER_BOOKING', 3.2),
  minimum: num('MARKET_UBER_MIN', 6.09),
};

// Reference operator B.
const LYFT = {
  label: 'Lyft',
  base: num('MARKET_LYFT_BASE', 1.0),
  perMile: num('MARKET_LYFT_PER_MILE', 0.9),
  perMinute: num('MARKET_LYFT_PER_MIN', 0.32),
  booking: num('MARKET_LYFT_BOOKING', 3.2),
  minimum: num('MARKET_LYFT_MIN', 3.62),
};

// How much cheaper we must be before the line appears at all. Below this the
// difference is inside the noise of their surge pricing and not worth a claim.
const MIN_MARGIN = num('MARKET_MIN_MARGIN', 0.08);

const ENABLED = String(process.env.SHOW_MARKET_COMPARISON || 'true').toLowerCase() !== 'false';

function quoteFor(rates, miles, minutes) {
  const fare = rates.base + rates.perMile * miles + rates.perMinute * minutes + rates.booking;
  return Math.max(rates.minimum, fare);
}

// Returns null when there is nothing honest to say — the caller then renders
// nothing at all, rather than an empty or hedged line.
function compare(ourFare, miles, minutes) {
  if (!ENABLED) return null;
  if (!Number.isFinite(ourFare) || !Number.isFinite(miles) || miles <= 0) return null;

  const mins = Number.isFinite(minutes) && minutes > 0 ? minutes : (miles / 28) * 60;

  const uber = quoteFor(UBER, miles, mins);
  const lyft = quoteFor(LYFT, miles, mins);

  const low = Math.min(uber, lyft);
  const high = Math.max(uber, lyft);

  // Compared against the CHEAPER of the two, so the claim holds against both.
  if (ourFare > low * (1 - MIN_MARGIN)) return null;

  const lowRounded = Math.round(low);
  const highRounded = Math.round(high);

  return {
    low: lowRounded,
    high: highRounded,
    // Collapse to a single figure when rounding makes the two identical —
    // "$17–$17" reads like a bug.
    single: lowRounded === highRounded,
    saving: Math.round(low - ourFare),
    savingPct: Math.round(((low - ourFare) / low) * 100),
  };
}

module.exports = { compare, quoteFor, UBER, LYFT, ENABLED, MIN_MARGIN };
