require('dotenv').config();
const express = require('express');
const cors = require('cors');

const quoteRoutes = require('./routes/quote');
const bookingRoutes = require('./routes/bookings');
const driverRoutes = require('./routes/driver');
const paymentsRoutes = require('./routes/payments');
const assistantRoutes = require('./routes/assistant');

const app = express();
app.use(cors());

// Stripe webhook signature verification needs the raw, unparsed body — this
// must be registered (and scoped to just this one path) BEFORE the global
// express.json() below, or by the time the request reaches the webhook
// handler the body has already been consumed/parsed and constructEvent()
// fails. Every other /api/payments/* route gets normal JSON parsing.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'roverzoom-api' }));
app.use('/api', quoteRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/assistant', assistantRoutes);

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
