// Driver payout: the driver keeps a fixed share of the rider fare.
//
// (The current pricing model is flat — fare = drive time × hourly rate, no
// time-of-day discount — so the payout is simply a share of that fare. Tunable
// via DRIVER_CUT_PCT; the actual disbursement is a separate, admin-triggered
// Stripe Transfer step. This just computes what a driver earns per ride.)
const DRIVER_SHARE = Number(process.env.DRIVER_CUT_PCT) || 0.575;

function driverPayout(fare) {
  return Math.round(Number(fare || 0) * DRIVER_SHARE * 100) / 100;
}

module.exports = { DRIVER_SHARE, driverPayout };
