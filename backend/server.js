require('dotenv').config();
const express = require('express');
const cors = require('cors');

const quoteRoutes = require('./routes/quote');
const bookingRoutes = require('./routes/bookings');
const driverRoutes = require('./routes/driver');
const paymentsRoutes = require('./routes/payments');
const assistantRoutes = require('./routes/assistant');
const checkrRoutes = require('./routes/checkr');

const app = express();
app.use(cors());

// Stripe webhook signature verification needs the raw, unparsed body — this
// must be registered (and scoped to just this one path) BEFORE the global
// express.json() below, or by the time the request reaches the webhook
// handler the body has already been consumed/parsed and constructEvent()
// fails. Every other /api/payments/* route gets normal JSON parsing.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
// Checkr webhook likewise needs the raw body to verify its signature.
app.use('/api/checkr/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Reports which optional integrations are wired, so a deployment can be
// checked without shell access. Booleans only — never a key, a number, or
// anything that would help someone probe the account.
app.get('/api/health', (req, res) => {
  const { isConfigured: smsConfigured } = require('./services/sms');
  res.json({
    ok: true,
    service: 'roverzoom-api',
    integrations: {
      // sendSms() fails silently by design so a texting outage cannot fail a
      // booking. That makes a misconfiguration invisible in production unless
      // it is reported somewhere — here.
      sms: smsConfigured(),
      cards: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY),
      maps: !!process.env.GOOGLE_MAPS_API_KEY,
      assistant: !!process.env.ANTHROPIC_API_KEY,
      screening: !!process.env.CHECKR_API_KEY,
    },
  });
});
app.use('/api', quoteRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/checkr', checkrRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only bind a port for local/standalone use (`node server.js`). When this
// file is required by api/index.js on Vercel, the exported app is invoked
// per-request by the serverless runtime instead — it must not also listen.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`RoverZoom API on http://localhost:${PORT}`));
}

module.exports = app;
