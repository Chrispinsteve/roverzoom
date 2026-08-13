// Driver payout model: drivers keep 57.5% of the STANDARD (pre-discount) fare.
//
// Rider fares carry a time-of-day marketing discount (see fare.js — 25% off in
// the morning window, 15% otherwise). That promo comes out of the platform's
// cut, not the driver's: we reconstruct the standard fare using the SAME
// multiplier that produced this fare (from its scheduled time) and pay the
// driver their fixed share of it. So take-home is identical whether the rider
// got 15% or 25% off — the driver's share of the DISCOUNTED fare simply rises
// to keep the standard-fare share constant.
const { multiplierForTime } = require('./fare');

// Driver's share of the standard, pre-discount fare (tunable via env).
const DRIVER_BASE_SHARE = Number(process.env.DRIVER_CUT_PCT) || 0.575;

function driverPayout(fare, whenIso) {
  const multiplier = multiplierForTime(whenIso) || 1;
  const baseFare = fare / multiplier;
  return Math.round(baseFare * DRIVER_BASE_SHARE * 100) / 100;
}

module.exports = { DRIVER_BASE_SHARE, driverPayout };
