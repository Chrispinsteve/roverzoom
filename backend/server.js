require('dotenv').config();
const express = require('express');
const cors = require('cors');

const quoteRoutes = require('./routes/quote');
const bookingRoutes = require('./routes/bookings');
const aiRoutes = require('./routes/ai');
const driverRoutes = require('./routes/driver');
const trackRoutes = require('./routes/track');
const adminRoutes = require('./routes/admin');

const app = express();

// ------------------------------------------------------------
// CORS
//
// This used to be a bare cors() — every origin allowed. That was fine
// while the only caller was the app's own frontend on the same domain,
// and it stops being fine now for two reasons:
//
//   1. The admin dashboard is landing on a SEPARATE domain, so the
//      allowed origins genuinely need to be enumerated rather than left
//      implicit.
//   2. Wide-open CORS lets any page on the internet make credentialed
//      cross-origin calls with a victim's driver token, which matters a
//      lot more now that those endpoints write GPS and advance trip
//      state instead of only reading a schedule.
//
// CORS_ORIGINS is a comma-separated allowlist. Left empty it falls back
// to allow-all, which keeps local development frictionless — but it
// should be set in production. Requests with no Origin header at all
// (server-to-server, curl, health checks) are allowed through: CORS is a
// browser mechanism and rejecting those would break monitoring without
// adding protection.
// ------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  // x-admin-key has to be listed explicitly — the browser will not send
  // a non-standard header on a cross-origin request unless the preflight
  // response names it, so the admin dashboard silently fails without it.
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
}));

// Location batches are the largest payload the API takes (up to 200
// pings), and they are still small. Capping the body size stops an
// oversized or malicious POST from being parsed into memory at all.
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'roverzoom-api' }));
app.use('/api', quoteRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // A rejected CORS origin is a client mistake, not a server fault, and
  // returning 500 for it sends developers hunting through server logs
  // for a problem that is actually a missing entry in CORS_ORIGINS.
  if (err && /not allowed by CORS/.test(err.message || '')) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
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
