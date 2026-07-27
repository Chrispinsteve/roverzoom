// Driver payout model: drivers keep 57.5% of the STANDARD fare.
//
// The rider-paid fare already has the marketing discount baked in (see
// FARE_MULTIPLIER in fare.js). The promo comes mostly out of the platform's cut:
// drivers earn their share of the full, pre-discount fare (giving up only a small
// slice), so take-home is largely shielded from the discount. Expressed against
// the discounted fare the rider actually pays (and hands the driver, for
// cash/Zelle rides), that's a higher effective share:
//     effective = base_share / fare_multiplier   →   0.575 / 0.85 ≈ 0.676
const { FARE_MULTIPLIER } = require('./fare');

// Driver's share of the standard, pre-discount fare (tunable via env).
const DRIVER_BASE_SHARE = Number(process.env.DRIVER_CUT_PCT) || 0.575;

// Share of the actual (discounted) fare, capped at 100%. This is what keeps
// take-home flat as the discount changes — deepen the promo and the driver's
// share of the paid fare rises to match.
const DRIVER_CUT_PCT = Math.min(1, Math.round((DRIVER_BASE_SHARE / (FARE_MULTIPLIER || 1)) * 10000) / 10000);

function driverPayout(fare) {
  return Math.round(fare * DRIVER_CUT_PCT * 100) / 100;
}

module.exports = { DRIVER_CUT_PCT, DRIVER_BASE_SHARE, driverPayout };
