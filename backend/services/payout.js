// Driver payout model: drivers keep 60% of the rider-paid fare.

const DRIVER_CUT_PCT = Number(process.env.DRIVER_CUT_PCT) || 0.6;

function driverPayout(fare) {
  return Math.round(fare * DRIVER_CUT_PCT * 100) / 100;
}

module.exports = { DRIVER_CUT_PCT, driverPayout };
