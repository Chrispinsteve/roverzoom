// Shared lazy Stripe client. Same rationale as the inline one in
// routes/payments.js: the API must still boot and non-card flows must still
// work when STRIPE_SECRET_KEY isn't set. Returns null when unconfigured;
// callers answer 503 rather than crash.
let client = null;

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!client) client = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return client;
}

module.exports = { stripe };
